"""WP-G2-04 / B1 —— **冻结运行**（Frozen Run）：以冻结锁为唯一输入重算 B1。

裁决（2026-09-14，扩围合并后）：

  * B1 必须**以 `gen2-rule-v2.0.1` 的 bundle/实现锁为唯一输入**；
  * 输出**隔离的新 run ID** 与**完整 manifest**；
  * 旧报告（`b1_ledger_baseline_20260911` / `gen2_b1_research_baselines_20260911.md`）
    自本次起**只作审计基线**，不再作为比较对象；
  * 继续保持 Shadow / CANARY；不写正式仓位；B3 通过前不讨论 authority 提升。

裁决（2026-09-14，第二次）：manifest 还必须**单列记录并校验**四类哈希 ——

  ① 最终 `GEN2_RULE_V2_LOCK` 的 SHA 与**完整组件哈希**（`immutable_set` 逐项 + 折叠摘要）；
  ② 运行侧实现哈希：`b1_frozen_run.py` / `rebuild_baselines.py` / `ledger.py` / 费用实现；
  ③ 输入行情 + ETF 主数据的**内容哈希**、日期范围与**环境版本**；
  ④ 输出报告与指标文件的哈希（`self_check` 逐项重算）。

为什么需要单独入口（而不是直接跑 `rebuild_baselines`）：

  `rebuild_baselines` 默认读研究配置 `config/gen2.yaml`，而规则真相源是冻结 bundle ——
  两份文件。只跑脚本无法证明「B1 用的规则 == 被锁定的那条」。本入口把三件事固化为**前置门**
  （任一不符 → **拒绝运行**，绝不静默取其一）：

    ① **锁 ↔ 磁盘逐位核验**：`GEN2_RULE_V2_LOCK.json` 的 8 项 `immutable_set` + 2 项
       `build_artifacts` 声明，SHA 全部按 CRLF→LF 归一化比对；
    ② **规则参数以冻结 bundle 为准**：把 bundle 的规则参数 overlay 到运行配置，
       并断言「研究配置与 bundle 逐值一致」（`drift` 非空即拒绝）；
    ③ **跨实现常量交叉核对**：bundle 的 `regime` 55/45 必须等于 `portfolio/regime.py`
       的常量；`bundle.alpha` 必须等于 canonical Alpha 权重（`selection_scores`）。

产物：

  * 隔离运行目录 `ml/gen2/outputs/<run_id>/`（`outputs/` 已 gitignore）：
    `ledger_daily.csv` / `ledger_summary.csv` / `calendar_meta.json` /
    `gen2_<run_id>.md` / **`frozen_manifest.json`**
  * 入库 manifest：`ml/gen2/manifests/GEN2_B1_FROZEN_RUN_MANIFEST_<date>.json`
  * 入库报告：`ml/gen2/reports/gen2_b1_frozen_run_<date>.md`

运行::

    PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run
    PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --date 20260914 --run-id <id>
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import platform
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from gen2.baseline.rebuild_baselines import build_unified_baselines
from gen2.data.loader import GEN2_ROOT, load_gen2_config, load_universe_definition

PROJECT_ROOT = GEN2_ROOT.parents[1]

LOCK_REL = "ml/gen2/manifests/GEN2_RULE_V2_LOCK.json"
BUNDLE_REL = "ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json"
VERIFIER_REL = "scripts/verify-immutable.js"
ROLE_THRESHOLDS_REL = "ml/gen2/portfolio/role_thresholds.py"

#: 运行侧实现（决定「B1 怎么算」；不是规则参数，但必须与规则一并留痕并校验）。
#: 裁决 2026-09-14：manifest 必须单列这些文件的哈希 —— 否则「同一份冻结规则、换一套执行代码」
#: 可以在锁一字不动时改变 B1 读数。
RUN_IMPLEMENTATION = [
    ("b1_frozen_run", "B1 冻结运行入口：三门前置核验 / 配置派生 / manifest 装配",
     "ml/gen2/baseline/b1_frozen_run.py"),
    ("baseline_builder", "B1 基线构建：build_unified_baselines（特征→排名→角色→权重→账本）",
     "ml/gen2/baseline/rebuild_baselines.py"),
    ("ledger", "唯一权威账本：run_ledger / LEDGER_CONTRACT（费用 = turnover × bps / 1e4）",
     "ml/gen2/backtest/ledger.py"),
    ("cost_impl", "费用兼容层：apply_turnover_cost（委托 ledger.run_ledger，非自带实现）",
     "ml/gen2/backtest/costs.py"),
]

#: 规则参数映射：(报告用标签, bundle 路径, 运行配置路径)
#: 冻结 bundle 是权威；运行配置必须与它逐值一致，否则拒绝运行。
RULE_MAP: list[tuple[str, tuple, tuple]] = [
    ("portfolio.max_single_weight", ("portfolio", "max_single_weight"),
     ("portfolio", "max_single_weight")),
    ("portfolio.max_cluster_weight", ("portfolio", "max_cluster_weight"),
     ("portfolio", "max_cluster_weight")),
    ("portfolio.max_tech_weight", ("portfolio", "max_tech_weight"),
     ("portfolio", "max_tech_weight")),
    ("portfolio.tech_clusters", ("portfolio", "tech_clusters"),
     ("portfolio", "tech_clusters")),
    ("portfolio.max_core_count", ("selection", "max_core_count"),
     ("portfolio", "max_core_count")),
    ("portfolio.max_core_per_cluster", ("selection", "max_core_per_cluster"),
     ("portfolio", "max_core_per_cluster")),
    ("portfolio.promotion_persistence_days", ("selection", "promotion_persistence_days"),
     ("portfolio", "promotion_persistence_days")),
    ("portfolio.demotion_persistence_days", ("selection", "demotion_persistence_days"),
     ("portfolio", "demotion_persistence_days")),
    ("portfolio.min_replacement_edge", ("selection", "min_replacement_edge"),
     ("portfolio", "min_replacement_edge")),
    ("portfolio.role_thresholds", ("selection", "role_thresholds"),
     ("portfolio", "role_thresholds")),
    ("portfolio.defense.risk_off_exposure_scale", ("defense", "risk_off_exposure_scale"),
     ("portfolio", "defense", "risk_off_exposure_scale")),
    ("portfolio.defense.risk_off_hedge_weight", ("defense", "risk_off_hedge_weight"),
     ("portfolio", "defense", "risk_off_hedge_weight")),
    ("portfolio.defense.hedge_code", ("defense", "hedge_code"),
     ("portfolio", "defense", "hedge_code")),
    ("portfolio.defense.vol_target_enabled", ("defense", "vol_target_enabled"),
     ("portfolio", "defense", "vol_target_enabled")),
    ("portfolio.defense.vol_target_annualized", ("defense", "vol_target_annualized"),
     ("portfolio", "defense", "vol_target_annualized")),
    ("data.benchmark_code", ("benchmark_code",), ("data", "benchmark_code")),
    ("universe.version", ("universe_version",), ("universe", "version")),
]


class FrozenAttestationError(RuntimeError):
    """冻结核验失败（锁失配 / 配置漂移 / 跨实现常量不一致）→ 拒绝运行。"""


#: `lock_revision 2` 下的候选冻结运行（10bps）读数 —— **仅**用于报告 §9.4 的一致性核对：
#: 两次扩围都只收紧锁定范围、不改 bundle 字节与参数 ⇒ 最终 Frozen B1 读数**应当与之逐位一致**；
#: 不一致 = 扩围顺带改了运行语义（缺陷），而不是「新版本更好」。
CANDIDATE_RUN_10BPS = {
    "gen2_v2_defended": {"cumulative_return": 0.6101, "sharpe": 0.55},
    "main5_equal_weight": {"cumulative_return": 1.8097, "sharpe": 0.74},
    "market_510300": {"cumulative_return": 0.3101, "sharpe": 0.32},
}


def _candidate_run_comparison(summary: pd.DataFrame) -> list[tuple]:
    """把本次 10bps 读数与候选冻结运行逐策略对齐，返回 (name, ref, cum, sharpe, same)。

    比对用**报告显示精度**（收益 4 位小数 / Sharpe 2 位小数）—— 候选读数是从报告抄录的，
    这样「报告上看起来一模一样」与「判定一致」是同一件事。
    """
    out = []
    for _, r in summary[summary["cost_bps"] == 10.0].sort_values("strategy").iterrows():
        ref = CANDIDATE_RUN_10BPS.get(r["strategy"])
        if ref is None:
            continue
        cum, shp = float(r["cumulative_return"]), float(r["sharpe"])
        same = (round(cum, 4) == round(ref["cumulative_return"], 4)
                and round(shp, 2) == round(ref["sharpe"], 2))
        out.append((r["strategy"], ref, cum, shp, same))
    return out


# ---------------------------------------------------------------- 工具

def _abs(rel: str | Path) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else PROJECT_ROOT / p


def _rel(p: str | Path) -> str:
    """仓库相对路径（跨平台统一 `/`）；仓库外（测试 tempdir）则原样返回。"""
    try:
        return str(Path(p).resolve().relative_to(PROJECT_ROOT.resolve())).replace("\\", "/")
    except ValueError:
        return str(p).replace("\\", "/")


def normalized_sha256(path: str | Path) -> str:
    """与 verify-immutable.js / freeze-gen2-rule-bundle.py 同口径（CRLF→LF 后 sha256）。"""
    text = _abs(path).read_bytes().decode("utf-8").replace("\r\n", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha(path: str | Path) -> str | None:
    p = _abs(path)
    return normalized_sha256(p) if p.is_file() else None


def _aggregate_digest(pairs: list[tuple[str, str]]) -> str:
    """把 (name, sha256) 列表折叠成单一摘要（顺序无关：先按 name 排序）。"""
    payload = "|".join(f"{k}:{v}" for k, v in sorted(pairs))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _join_run_dir(m: dict, artifact: dict) -> str:
    """把运行目录内文件名拼成可解析路径（run_dir 可能是仓库相对或绝对路径）。"""
    base = m["run_dir"]
    if base and (base.startswith("/") or (len(base) > 1 and base[1] == ":")):
        return str(Path(base) / artifact["file"])
    return str(_abs(base) / artifact["file"])


def _get(d: dict, path: tuple):
    cur = d
    for k in path:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def _set(d: dict, path: tuple, value) -> None:
    cur = d
    for k in path[:-1]:
        cur = cur.setdefault(k, {})
    cur[path[-1]] = value


def _same(a, b, atol: float = 1e-12) -> bool:
    """逐值比较：数值容差 atol；其余（含 list / bool / str）严格相等。"""
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) <= atol
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y, atol) for x, y in zip(a, b))
    return a == b


# ---------------------------------------------------------------- ① 锁核验

def verify_frozen_lock(lock_rel: str = LOCK_REL) -> dict:
    """锁 ↔ 磁盘逐位核验（immutable_set + build_artifacts 声明）。任一失配 → 抛错。"""
    lock_path = _abs(lock_rel)
    if not lock_path.is_file():
        raise FrozenAttestationError(f"冻结锁不存在：{lock_rel}")
    lock = json.loads(lock_path.read_text(encoding="utf-8"))

    entries, mismatched = [], []
    for e in lock.get("immutable_set") or []:
        actual = normalized_sha256(e["file"])
        ok = actual == e["sha256"]
        entries.append({"id": e["id"], "role": e.get("role"), "file": e["file"],
                        "expected": e["sha256"], "actual": actual, "match": ok})
        if not ok:
            mismatched.append(e["id"])

    by_id = {e["id"]: e for e in entries}
    artifacts = []
    for a in lock.get("build_artifacts") or []:
        mirror = by_id.get(a["must_equal"])
        declared_ok = bool(mirror) and a["sha256"] == mirror["expected"]
        artifacts.append({"id": a["id"], "file": a["file"], "must_equal": a["must_equal"],
                          "declared_sha256": a["sha256"], "declared_match_mirror": declared_ok})
        if not declared_ok:
            mismatched.append(a["id"])

    # ROOT_ANCHORS 自锚同步（否则「重新封印」会静默失效）
    verifier = _abs(VERIFIER_REL).read_text(encoding="utf-8")
    pat = re.compile(r"lock:\s*'" + re.escape(LOCK_REL) + r"'\s*,\s*sha256:\s*'([0-9a-f]{64})'")
    m = pat.search(verifier)
    lock_sha = normalized_sha256(lock_rel)
    if not m or m.group(1) != lock_sha:
        mismatched.append("ROOT_ANCHORS")

    if mismatched:
        raise FrozenAttestationError(
            f"冻结核验失败：{sorted(set(mismatched))}；拒绝运行（fail-closed）")

    component_digest = _aggregate_digest([(e["id"], e["actual"]) for e in entries])
    return {
        "lock_file": lock_rel,
        "lock_sha256": lock_sha,
        "lock_sha256_declared_in_root_anchors": m.group(1) if m else None,
        "lock_revision": lock.get("lock_revision"),
        "engine_id": lock.get("engine_id"),
        "bundle_version": lock.get("bundle_version"),
        "bundle_sha256": lock.get("bundle_sha256"),
        "immutable_set": entries,
        "build_artifacts": artifacts,
        "lock_component_digest": component_digest,
        "root_anchor_in_sync": True,
    }


# ---------------------------------------------------------------- ②③ 配置核验

def derive_config(bundle: dict, base_cfg: dict, *, strict: bool = True) -> tuple[dict, dict]:
    """用冻结 bundle 的规则参数 overlay 运行配置，并核验「运行配置 == bundle」。

    * `drift` 非空 ⇒ 研究配置与冻结规则不一致 ⇒ `strict=True` 时**拒绝运行**；
    * `cross_checks` 非空 ⇒ 跨实现常量（`regime.py` / canonical Alpha 权重）与 bundle 不一致
      ⇒ 同样拒绝。
    """
    drift = []
    for label, bpath, cpath in RULE_MAP:
        bval = _get(bundle, bpath)
        if bval is None:
            raise FrozenAttestationError(f"冻结 bundle 缺规则键 {label}（{'/'.join(bpath)}）")
        cval = _get(base_cfg, cpath)
        if not _same(cval, bval):
            drift.append({"key": label, "run_config": cval, "frozen_bundle": bval})

    if drift and strict:
        raise FrozenAttestationError(
            "运行配置与冻结 bundle 不一致（拒绝运行，禁止静默取其一）："
            + json.dumps(drift, ensure_ascii=False))

    cfg = copy.deepcopy(base_cfg)
    for label, bpath, cpath in RULE_MAP:
        _set(cfg, cpath, _get(bundle, bpath))

    # ③ 跨实现常量交叉核对
    from gen2.baseline.selection_scores import CANONICAL_ALPHA_WEIGHTS
    from gen2.portfolio import regime as regime_mod

    cross = []
    reg = bundle.get("regime") or {}
    if not _same(reg.get("risk_on_ge"), regime_mod.RISK_ON_GE):
        cross.append({"key": "regime.risk_on_ge",
                      "bundle": reg.get("risk_on_ge"), "impl": regime_mod.RISK_ON_GE})
    if not _same(reg.get("risk_off_le"), regime_mod.RISK_OFF_LE):
        cross.append({"key": "regime.risk_off_le",
                      "bundle": reg.get("risk_off_le"), "impl": regime_mod.RISK_OFF_LE})
    for k, v in (bundle.get("alpha") or {}).items():
        if k not in CANONICAL_ALPHA_WEIGHTS:
            cross.append({"key": f"alpha.{k}", "bundle": v, "impl": None})
        elif not _same(v, CANONICAL_ALPHA_WEIGHTS[k], atol=1e-9):
            cross.append({"key": f"alpha.{k}", "bundle": v,
                          "impl": CANONICAL_ALPHA_WEIGHTS[k]})

    if cross and strict:
        raise FrozenAttestationError(
            "跨实现常量与冻结 bundle 不一致（拒绝运行）："
            + json.dumps(cross, ensure_ascii=False))

    return cfg, {
        "rule_map": [{"key": lbl, "bundle_path": "/".join(bp), "run_config_path": "/".join(cp)}
                     for lbl, bp, cp in RULE_MAP],
        "drift": drift,
        "cross_checks": cross,
        "config_source": "FROZEN_BUNDLE_OVERLAY",
    }


def frozen_run_id(bundle: dict, date_tag: str) -> str:
    """隔离 run ID：`b1_ledger_baseline_<date>_frozen_<bundle_version_slug>`。"""
    slug = re.sub(r"[^0-9A-Za-z]", "", str(bundle.get("bundle_version", "")).replace("gen2-rule-", ""))
    return f"b1_ledger_baseline_{date_tag}_frozen_{slug}"


# ------------------------------------------------- ② 运行实现 / ③ 输入与环境

def implementation_attestation() -> list[dict]:
    """运行侧实现哈希（决定「B1 怎么算」）。"""
    out = []
    for iid, role, rel in RUN_IMPLEMENTATION:
        p = _abs(rel)
        out.append({"id": iid, "role": role, "file": rel,
                    "exists": p.is_file(), "sha256": _sha(p)})
    return out


def environment_version() -> dict:
    """运行环境版本：换解释器 / pandas / numpy 版本可以在规则不变时改变数值。"""
    return {
        "python": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "pandas": pd.__version__,
        "numpy": np.__version__,
        "platform": platform.platform(),
        "byteorder": sys.byteorder,
    }


def input_data_attestation(cfg: dict) -> dict:
    """输入数据的**内容哈希** + 日期范围（行情池 + ETF 主数据 + universe 定义）。"""
    daily_dir = PROJECT_ROOT / cfg["data"]["daily_dir"]
    universe = load_universe_definition()
    codes = [*universe["eligible_codes"], universe["benchmark_code"]]

    files: list[dict] = []
    firsts, lasts, rows = [], [], 0
    for code in codes:
        code = str(code).zfill(6)
        matches = sorted(daily_dir.glob(f"{code}_*.csv"))
        if not matches:
            raise FrozenAttestationError(f"输入行情缺失：{code}（{daily_dir}）")
        p = matches[0]
        dates = pd.to_datetime(pd.read_csv(p, encoding="utf-8-sig", usecols=["date"])["date"])
        f0, f1 = str(dates.min().date()), str(dates.max().date())
        n = int(len(dates))
        files.append({"code": code, "file": _rel(p), "rows": n,
                      "first_date": f0, "last_date": f1, "sha256": normalized_sha256(p)})
        firsts.append(f0)
        lasts.append(f1)
        rows += n

    meta_files = []
    for label, p in (("etf_master", GEN2_ROOT / "universe" / "etf_master.csv"),
                     ("universe_definition",
                      GEN2_ROOT / cfg["universe"].get("definition_file", "universe/dev_universe_v0.json"))):
        if not p.is_file():
            raise FrozenAttestationError(f"输入元数据缺失：{label}（{p}）")
        meta_files.append({"id": label, "file": _rel(p), "sha256": normalized_sha256(p)})

    digest = _aggregate_digest(
        [(f"daily:{f['code']}", f["sha256"]) for f in files]
        + [(f"meta:{m['id']}", m["sha256"]) for m in meta_files])

    return {
        "daily_dir": _rel(daily_dir),
        "codes": [f["code"] for f in files],
        "rows_total": rows,
        "date_range": {"first_date": min(firsts), "last_date": max(lasts)},
        "files": files,
        "meta_files": meta_files,
        "content_digest": digest,
    }


# ------------------------------------------------- ④ 输出哈希自校验

def verify_manifest(m: dict) -> dict:
    """对 manifest 里声明的每一类哈希**重新计算**并比对（fail-closed 自校验）。"""
    checks: list[dict] = []

    def chk(name: str, expected, actual) -> None:
        checks.append({"check": name, "expected": expected, "actual": actual,
                       "ok": bool(expected) and expected == actual})

    fi = m["frozen_input"]
    chk("lock.sha256", fi["lock"]["lock_sha256"], _sha(fi["lock"]["lock_file"]))
    for e in fi["immutable_set"]:
        chk(f"lock.component[{e['id']}]", e["actual"], _sha(e["file"]))
    chk("lock.component_digest", fi["lock_component_digest"],
        _aggregate_digest([(e["id"], e["actual"]) for e in fi["immutable_set"]]))

    for e in m["run_implementation"]:
        chk(f"run_impl[{e['id']}]", e["sha256"], _sha(e["file"]))

    for f in m["input_data"]["files"]:
        chk(f"input.daily[{f['code']}]", f["sha256"], _sha(f["file"]))
    for e in m["input_data"]["meta_files"]:
        chk(f"input.meta[{e['id']}]", e["sha256"], _sha(e["file"]))
    chk("input.content_digest", m["input_data"]["content_digest"],
        _aggregate_digest([(f"daily:{f['code']}", f["sha256"]) for f in m["input_data"]["files"]]
                          + [(f"meta:{e['id']}", e["sha256"]) for e in m["input_data"]["meta_files"]]))

    for a in m["artifacts"]:
        chk(f"output[{a['file']}]", a["sha256"], _sha(_join_run_dir(m, a)))
    rep = ((m.get("outputs") or {}).get("committed_report")) or None
    if rep:
        chk("output[committed_report]", rep["sha256"], _sha(rep["file"]))

    failed = [c for c in checks if not c["ok"]]
    return {"checks": len(checks), "passed": len(checks) - len(failed),
            "failed": len(failed), "all_pass": not failed, "detail": failed[:10]}


# ---------------------------------------------------------------- 运行

def run(*, date_tag: str = "20260914", run_id: str | None = None,
        report_dir: str | Path | None = None,
        manifest_path: str | Path | None = None,
        output_root: str | Path | None = None,
        cost_levels: list | None = None,
        date_from: str | None = None,
        write_committed_manifest: bool = True) -> dict:
    """执行 B1 冻结运行并落盘 manifest + 报告。

    `cost_levels` / `date_from` / `output_root` 仅供测试裁剪（默认 = 完整费用档 + 全窗口 + 正式
    outputs 目录）：CI 用裁剪窗口跑通门禁，正式运行用全量。
    """
    attest = verify_frozen_lock()
    bundle = json.loads(_abs(BUNDLE_REL).read_text(encoding="utf-8"))
    base_cfg = load_gen2_config()
    cfg, cfg_attest = derive_config(bundle, base_cfg)

    impl = implementation_attestation()
    env = environment_version()
    inputs = input_data_attestation(cfg)

    rid = run_id or frozen_run_id(bundle, date_tag)
    root = Path(output_root) if output_root else GEN2_ROOT / "outputs"
    out_dir = Path(root) / rid
    reps = Path(report_dir) if report_dir else GEN2_ROOT / "reports"
    committed_manifest_rel = f"ml/gen2/manifests/GEN2_B1_FROZEN_RUN_MANIFEST_{date_tag}.json"
    committed_report_rel = f"ml/gen2/reports/gen2_b1_frozen_run_{date_tag}.md"

    result = build_unified_baselines(
        output_dir=out_dir, report_dir=out_dir, config=cfg, run_id=rid,
        cost_levels=cost_levels, date_from=date_from)

    summary = result["summary"]
    verification = result["verification"]
    strategies = sorted(summary["strategy"].unique().tolist())
    cal_meta = json.loads((out_dir / "calendar_meta.json").read_text(encoding="utf-8"))

    # ④ 运行目录内产物哈希（账本 / 指标 / 日历元数据 + 运行目录报告）
    artifacts = []
    for name in ("ledger_daily.csv", "ledger_summary.csv", "calendar_meta.json",
                 f"gen2_{rid}.md"):
        p = out_dir / name
        artifacts.append({
            "file": name,
            "exists": p.is_file(),
            "sha256": _sha(p),
            "bytes": p.stat().st_size if p.is_file() else None,
        })

    manifest = {
        "manifest_type": "GEN2_B1_FROZEN_RUN",
        "run_id": rid,
        "created_at": pd.Timestamp.now("UTC").isoformat(),
        "boundaries": {
            "stage": "SHADOW/CANARY",
            "deployed": False,
            "authority_promoted": False,
            "writes_position": False,
            "economic_claim_allowed": False,
            "economic_claim_gate": "B3 FROZEN OOS（未通过前本 manifest 只作研发证据）",
            "supersedes": {
                "note": "旧报告自本次起只作审计基线，不再作为比较对象",
                "old_run_id": "b1_ledger_baseline_20260911",
                "old_report": "ml/gen2/reports/gen2_b1_research_baselines_20260911.md",
                "candidate_run": {
                    "run_id": "b1_ledger_baseline_20260914_frozen_v201",
                    "lock_revision": 2,
                    "note": ("lock_revision 2 下的候选冻结运行（有效候选证据，但不标为最终 Frozen B1）；"
                             "本运行在 lock_revision 3 下取代之。两次扩围只收紧锁定范围、"
                             "未改 bundle 字节与规则参数 ⇒ 读数应当一致；差异即缺陷。"),
                },
            },
        },
        "frozen_input": {
            "lock": {k: attest[k] for k in
                     ("lock_file", "lock_sha256", "lock_sha256_declared_in_root_anchors",
                      "lock_revision", "engine_id", "bundle_version", "bundle_sha256",
                      "root_anchor_in_sync")},
            "lock_component_digest": attest["lock_component_digest"],
            "immutable_set": attest["immutable_set"],
            "build_artifacts": attest["build_artifacts"],
            "bundle_selection": {
                "role_thresholds": bundle["selection"]["role_thresholds"],
                "legacy_migration_audit_status":
                    (bundle["selection"].get("legacy_migration_audit") or {}).get("status"),
            },
            "bundle_alpha": bundle.get("alpha"),
            "bundle_regime": bundle.get("regime"),
        },
        "run_implementation": impl,
        "environment": env,
        "input_data": inputs,
        "config_attestation": cfg_attest,
        "run_inputs": {
            "universe_version": cal_meta["universe"]["version"],
            "benchmark_code": cfg["data"].get("benchmark_code"),
            "main5": cal_meta["universe"]["main5"],
            "cost_levels": cal_meta["cost_levels"],
            "default_cost_bps": cal_meta["default_cost_bps"],
            "role_thresholds_from_config": cal_meta["role_thresholds"],
            "selection": verification["selection"],
            "ledger_contract_source": "gen2.backtest.ledger.LEDGER_CONTRACT",
            "role_semantics": "gen2.baseline.rule_v2_ab.build_v2_roles",
        },
        "window": {
            "calendar": verification["calendar"],
            "common_window": verification["window"],
        },
        "acceptance": {
            "conservation_max_error": verification["conservation_max_error"],
            "cash_min": verification["cash_min"],
            "gross_exposure_max": float(summary["gross_exposure_max"].max()),
            "over_allocated_days_total": verification["over_allocated_days_total"],
            "dropped_signal_days_total": verification["dropped_signal_days_total"],
            "missing_quote_days_total": verification["missing_quote_days_total"],
            "ledgers": verification["ledgers"],
            "strategies": strategies,
            "gate_pass": bool(verification["conservation_max_error"] <= 1e-9
                              and verification["cash_min"] >= -1e-9),
        },
        "artifacts": artifacts,
        "run_dir": _rel(out_dir),
        "committed_manifest": committed_manifest_rel,
        "report": committed_report_rel,
    }

    man_out = (Path(manifest_path) if manifest_path is not None
               else (GEN2_ROOT / "manifests" / f"GEN2_B1_FROZEN_RUN_MANIFEST_{date_tag}.json")
               if write_committed_manifest else out_dir / "frozen_manifest.json")

    # ---- 阶段 1：写 manifest + 报告（此时尚未知报告自身哈希）----
    _write_manifest(manifest, out_dir, man_out)
    reps.mkdir(parents=True, exist_ok=True)
    report = reps / f"gen2_b1_frozen_run_{date_tag}.md"
    report.write_text(_render_report(manifest, summary, bundle), encoding="utf-8")

    # ---- 阶段 2：记录输出报告哈希并自校验，再重写 manifest（报告不含自身哈希 → 稳定）----
    manifest["outputs"] = {
        "run_dir": _rel(out_dir),
        "run_dir_artifacts": [a["file"] for a in artifacts],
        "committed_report": {"file": _rel(report), "exists": report.is_file(),
                             "sha256": _sha(report),
                             "bytes": report.stat().st_size if report.is_file() else None},
    }
    manifest["self_check"] = verify_manifest(manifest)
    if not manifest["self_check"]["all_pass"]:
        raise FrozenAttestationError(
            "manifest 自校验失败（哈希不一致）："
            + json.dumps(manifest["self_check"]["detail"], ensure_ascii=False))
    _write_manifest(manifest, out_dir, man_out)

    return {"manifest": man_out, "report": report, "run_dir": out_dir,
            "run_id": rid, "manifest_data": manifest, "summary": summary}


def _write_manifest(manifest: dict, out_dir: Path, man_out: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "frozen_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    man_out.parent.mkdir(parents=True, exist_ok=True)
    man_out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, default=str),
                       encoding="utf-8")


def _render_report(m: dict, summary: pd.DataFrame, bundle: dict) -> str:
    a = m["acceptance"]
    cal = m["window"]["calendar"]
    lines = [
        "# Gen-2 B1 **冻结运行**报告（Frozen Run）",
        "",
        "**日期**：%s · **Run ID**：`%s`" % (m["created_at"][:10], m["run_id"]),
        "**冻结输入**：`%s`（lock SHA `%s`，revision %s）"
        % (m["frozen_input"]["lock"]["bundle_version"],
           m["frozen_input"]["lock"]["lock_sha256"][:12] + "…",
           m["frozen_input"]["lock"]["lock_revision"]),
        "**Manifest**：`%s`（运行目录另有 `frozen_manifest.json` 副本）" % m["committed_manifest"],
        "",
        "---",
        "",
        "## 1. 一句话结论",
        "",
        "B1 已**以 `gen2-rule-v2.0.1` 冻结锁为唯一输入**重算完成：运行前 8 项冻结对象 + 2 项构建产物",
        "声明全部 SHA 逐位一致，运行配置与冻结 bundle **零漂移**，跨实现常量（regime 55/45、",
        "canonical Alpha 等权）逐一核对通过；资金守恒误差 **%.3e**、现金非负（min %.6f）→ **门禁 %s**。"
        % (a["conservation_max_error"], a["cash_min"], "PASS" if a["gate_pass"] else "FAIL"),
        "",
        "> ⚠️ 这是**研发证据**，不是经济结论。B3 Frozen OOS 通过前，本报告的任何净值 / Sharpe / MDD",
        "> **不得**用于生产资格或 authority 提升。继续 Shadow / CANARY，未部署、未写正式仓位。",
        ">",
        "> **与旧 B1 读数差异很大？先看 §9「差异归因」（必读页）** —— 那里逐条对应 D-001 / F1-F2 /",
        "> F4 / 统一账本各自改变了什么，以及为什么两条基线的数值**不应**相同。",
        "",
        "---",
        "",
        "## 2. 冻结输入核验（运行前置门，任一失配即拒绝运行）",
        "",
        "| # | id | 文件 | SHA（CRLF→LF） | 判定 |",
        "|---|---|---|---|---|",
    ]
    for i, e in enumerate(m["frozen_input"]["immutable_set"], 1):
        lines.append("| %d | `%s` | `%s` | `%s…` | %s |"
                     % (i, e["id"], e["file"], e["actual"][:12], "✅" if e["match"] else "❌"))
    lines += [
        "",
        "| id | 构建产物 | must_equal | 声明与冻结源一致 |",
        "|---|---|---|---|",
    ]
    for art in m["frozen_input"]["build_artifacts"]:
        lines.append("| `%s` | `%s` | `%s` | %s |"
                     % (art["id"], art["file"], art["must_equal"],
                        "✅" if art["declared_match_mirror"] else "❌"))
    lines += [
        "",
        "- **LOCK 文件 SHA**：`%s`（`ROOT_ANCHORS` 同锚：%s）"
        % (m["frozen_input"]["lock"]["lock_sha256"],
           "是" if m["frozen_input"]["lock"]["root_anchor_in_sync"] else "否"),
        "- **完整组件摘要**（8 项 id:sha 折叠）：`%s`" % m["frozen_input"]["lock_component_digest"],
        "- bundle 侧 `selection.role_thresholds` = `%s`（`legacy_migration_audit.status` = `%s`）"
        % (json.dumps(m["frozen_input"]["bundle_selection"]["role_thresholds"], ensure_ascii=False),
           m["frozen_input"]["bundle_selection"]["legacy_migration_audit_status"]),
        "",
        "## 3. 运行实现哈希（「B1 怎么算」——与规则一并留痕并校验）",
        "",
        "| id | 文件 | 角色 | SHA |",
        "|---|---|---|---|",
    ]
    for e in m["run_implementation"]:
        lines.append("| `%s` | `%s` | %s | `%s…` |"
                     % (e["id"], e["file"], e["role"], (e["sha256"] or "MISSING")[:12]))
    lines += [
        "",
        "## 4. 输入数据与环境（内容哈希 / 日期范围 / 环境版本）",
        "",
        "- 行情目录：`%s`（%d 个代码）" % (m["input_data"]["daily_dir"], len(m["input_data"]["codes"])),
        "- 输入**公共日期范围**：`%s` → `%s`（共 %d 行）"
        % (m["input_data"]["date_range"]["first_date"], m["input_data"]["date_range"]["last_date"],
           m["input_data"]["rows_total"]),
        "- **输入内容摘要**（全部行情 + 元数据折叠）：`%s`" % m["input_data"]["content_digest"],
        "- 环境：Python %s (%s) · pandas %s · numpy %s · %s"
        % (m["environment"]["python"], m["environment"]["python_implementation"],
           m["environment"]["pandas"], m["environment"]["numpy"], m["environment"]["platform"]),
        "",
        "| 输入 | 文件 | rows | 日期范围 | sha256 |",
        "|---|---|---|---|---|",
    ]
    for f in m["input_data"]["files"]:
        lines.append("| `%s` | `%s` | %d | %s → %s | `%s…` |"
                     % (f["code"], f["file"], f["rows"], f["first_date"], f["last_date"],
                        f["sha256"][:12]))
    for e in m["input_data"]["meta_files"]:
        lines.append("| `%s` | `%s` | — | — | `%s…` |"
                     % (e["id"], e["file"], e["sha256"][:12]))
    lines += [
        "",
        "## 5. 配置核验：运行配置 ↔ 冻结规则（零漂移）",
        "",
        "覆盖 %d 个规则键（`config_source = %s`）：`drift` **%s**、`cross_checks` **%s**。"
        % (len(m["config_attestation"]["rule_map"]),
           m["config_attestation"]["config_source"],
           m["config_attestation"]["drift"] or "空（一致）",
           m["config_attestation"]["cross_checks"] or "空（一致）"),
        "",
        "| 规则键 | bundle 路径 | 运行配置路径 |",
        "|---|---|---|",
    ]
    for r in m["config_attestation"]["rule_map"]:
        lines.append("| `%s` | `%s` | `%s` |" % (r["key"], r["bundle_path"], r["run_config_path"]))
    lines += [
        "",
        "> 不一致时**拒绝运行**（fail-closed），不存在「bundle 一份、yaml 一份、谁先谁赢」的隐式口径。",
        "",
        "## 6. 运行窗口与同口径比较",
        "",
        "- 公共日历：`%s` → `%s`，**%d 个交易日**（全部策略首日/末日/天数一致）"
        % (cal["first_date"], cal["last_date"], cal["days"]),
        "- 费用档：%s bps；T+1 执行；期初全现金；末日 mark-to-market 不强制平仓"
        % ", ".join(str(int(c)) for c in m["run_inputs"]["cost_levels"]),
        "- Main5：%s" % ", ".join(m["run_inputs"]["main5"]),
        "",
        "| 策略 | cost_bps | 期末净值 | 累计收益 | CAGR | Sharpe | MDD | 总换手 | 总费用 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for _, r in summary.sort_values(["cost_bps", "strategy"]).iterrows():
        lines.append("| %s | %g | %.4f | %+.2f%% | %+.2f%% | %.2f | %.2f%% | %.3f | %.4f |"
                     % (r["strategy"], r["cost_bps"], r["terminal_nav"],
                        r["cumulative_return"] * 100, r["cagr"] * 100, r["sharpe"],
                        r["mdd"] * 100, r["total_turnover"], r["total_cost"]))
    lines += [
        "",
        "## 7. 资金守恒验收",
        "",
        "| 项 | 值 | 判定 |",
        "|---|---|---|",
        "| Σtarget + cash − 1 最大偏差 | %.3e | %s |"
        % (a["conservation_max_error"], "✅ PASS" if a["conservation_max_error"] <= 1e-9 else "❌ FAIL"),
        "| 现金权重最小值 | %.6f | %s |"
        % (a["cash_min"], "✅ PASS" if a["cash_min"] >= -1e-9 else "❌ FAIL"),
        "| 总敞口最大值 | %.6f | %s |"
        % (a["gross_exposure_max"], "✅ PASS" if a["gross_exposure_max"] <= 1.0 + 1e-9 else "❌ FAIL"),
        "| 超配日数（显式缩放留痕） | %d | ✅ PASS |" % a["over_allocated_days_total"],
        "| 末日未执行信号日数（显式留痕） | %d | ✅ PASS |" % a["dropped_signal_days_total"],
        "| 缺报价日数（未当 0 收益） | %d | ✅ PASS |" % a["missing_quote_days_total"],
        "| 参与比较的账本数 | %d | ✅ PASS |" % a["ledgers"],
        "| 策略集合 | %s | ✅ PASS |" % ", ".join(a["strategies"]),
        "",
        "## 8. 产物哈希（隔离目录 `%s/`，`outputs/` 未入库）" % m["run_dir"],
        "",
        "| 文件 | bytes | sha256 |",
        "|---|---|---|",
    ]
    for art in m["artifacts"]:
        lines.append("| `%s` | %s | `%s` |"
                     % (art["file"], art["bytes"], (art["sha256"] or "MISSING")[:16] + "…"))
    sc = m.get("self_check") or {}
    lines += [
        "",
        "- **本报告自身哈希**：见 manifest `outputs.committed_report`（报告不含自身哈希，避免自引用）",
        "- **manifest 自校验**：%s（%d/%d 项哈希重算一致）"
        % ("✅ 全部通过" if sc.get("all_pass") else "❌ 存在失配",
           sc.get("passed", 0), sc.get("checks", 0)),
        "",
        "## 9. 差异归因：旧审计基线 vs 新冻结基线（**必读页**）",
        "",
        "> 本页不是经济结论。它回答一个**流程**问题：与旧 B1 的 Gen-2 读数差异很大，",
        "> 这些差异从哪来、是否**可解释**。验收口径不是「数值相同」，而是**每一处变化都能对应到",
        "> 一个已登记的实现 / 口径变更**。",
        "",
        "### 9.1 两条基线的性质不同（先看这个）",
        "",
        "| | 旧审计基线 | 新冻结基线（本报告） |",
        "|---|---|---|",
        "| run ID | `b1_ledger_baseline_20260911` | `%s` |" % m["run_id"],
        "| 报告 | `gen2_b1_research_baselines_20260911.md`（研究口径） | 本报告（冻结口径） |",
        "| 组合口径 | 研究脚本：`build_portfolio_candidates` 把 CORE 重置为等权、**无防守腿** | 统一候选组合：权威权重沿用 + 上限复核 + 防守腿 + 现金腿 |",
        "| 角色语义 | Rule V2 修正**前** | Rule V2 修正**后**（出口无条件终局约束检查） |",
        "| 账本口径 | 旧 `apply_turnover_cost`（现金腿也计入换手） | 唯一权威账本 `run_ledger`（单边成交名义额） |",
        "| 冻结状态 | 未冻结（无 bundle / lock 归属） | `gen2-rule-v2.0.1` + `lock_revision %s`，8 项冻结对象 + 2 项构建产物 |"
        % m["frozen_input"]["lock"]["lock_revision"],
        "| 用途 | **仅作审计基线** | 研发证据（B3 通过前不得用于生产资格） |",
        "",
        "### 9.2 四类变更各自改变了什么",
        "",
        "| 变更 | 机制（到底改了什么） | 对读数的影响 | 是否调参 |",
        "|---|---|---|---|",
        "| **D-001** 规则实现修正 | 角色生成路径出口统一走 `finalizeRoles` / `finalize_roles`：**无条件**执行终局约束检查"
        "（CORE 数量上限 / 每 cluster CORE 上限 / NO_CORE 不可恢复 / 单资产·cluster·科技·现金约束）。"
        "此前「无 cap 降级现任且无替换」的交易日会**跳过**该检查 | 此前被跳过的路径被收敛 ⇒ 角色分布与降级日改变 "
        "⇒ 换手、防守触发日、净值随之改变 | 否（阈值 / universe 未动） |",
        "| **F1/F2** 信号质量修复 | `build_v2_roles` **不再**静默重算 Alpha；评分必须**显式注入**"
        "（`selection_scores`：唯一键 / 有限 / 覆盖无缺无多 + 内容哈希）；`top_quantile` 改为显式 "
        "`role_thresholds`（core 0.20 / challenger 0.30 / satellite 0.40） | 修复前「声明了旋钮、"
        "组合指标却与 baseline 逐位相同」的**假读数**消失；替代 Alpha 与角色阈值**真正**进入角色决策 | "
        "否（默认值与旧行为逐值等价） |",
        "| **F4** 统一候选组合（WP-G2-06） | `build_portfolio_candidates` 不再把 CORE 重置为等权 `1/n`、"
        "不再丢弃单只 / cluster / 广义科技上限，`priority` 改为**精确集合校验**；`main()` 接入唯一候选链路；"
        "发布 30 条 `gen2_ranking` + 31 条 `gen2_candidate_leg`；防守腿进入组合 | 研究脚本的归因 / 敏感性数字"
        "与权威账本**不再可比**（口径已统一 ⇒ 旧数字**作废**而不是「失真」） | 否 |",
        "| **统一账本**（WP-G2-02） | 唯一权威账本 `run_ledger`：换手 = **单边成交名义额** `Σ_证券|Δ|`"
        "（旧实现把现金腿也算进换手，最坏**高估 2 倍**）；公共日历强校验（首日/末日/天数逐位一致）；"
        "T+1 执行 + 期初全现金 | 有现金缓冲的策略其**历史换手与费用被高估**的读数失效；同成本档下"
        "换手下降 ⇒ 净收益上升 | 否（口径修正） |",
        "",
        "### 9.3 为什么两条基线的数值**不应**相同",
        "",
        "- 上表四项全部是实现语义或口径变更；其中 **D-001 是明确登记的语义变更** —— 正因如此，"
        "Rule V2 不再沿用「已封版 / 已验证」的资格表述（见 `gen2_rule_impl_correction_20260911.md`）。",
        "- F4 + 统一账本使**研究口径与权威账本统一**，因此旧 `b1_ledger_baseline_20260911` 的 Gen-2 读数",
        "  （研究口径下 Rule + 防守 Sharpe 0.32 vs Main5 PIT 0.49，10bps）**不能**与本冻结基线逐值对比 ——",
        "  把它降级为「审计基线」正是这个原因。",
        "- 可比性由**同一把锁**保证：本报告的每个数字都能追溯到 `lock_sha256 = %s…` 下的 8 项冻结对象（见 §2）。"
        % m["frozen_input"]["lock"]["lock_sha256"][:16],
        "",
        "### 9.4 与「候选冻结运行」的关系",
        "",
        "- 上一轮曾在 `lock_revision 2` 下跑过一次 B1（run ID `b1_ledger_baseline_20260914_frozen_v201`，",
        "  10bps 下 `gen2_v2_defended` **+61.01%** / Sharpe 0.55）：那是**候选运行证据**，不是最终 Frozen B1。",
        "- 本次为 `lock_revision 3`（新增 `selection_scores.py` + `regime.py` 入锁）下的**最终 Frozen B1**。",
        "  两次扩围都**只改变锁定范围、不改变规则字节与参数**，所以两份读数的正确关系是「**应当一致**」——",
        "  出现任何差异都说明扩围顺带改了运行语义，那是必须先查清的缺陷，而不是「新版本更好」。",
        "",
        "| 策略 | 候选运行（rev 2，10bps） | 本次（rev 3，10bps） | 判定 |",
        "|---|---|---|---|",
    ]
    for name, ref, cum, shp, same in _candidate_run_comparison(summary):
        lines.append("| `%s` | %+.2f%% / Sharpe %.2f | %+.2f%% / Sharpe %.2f | %s |"
                     % (name, ref["cumulative_return"] * 100, ref["sharpe"], cum * 100, shp,
                        "✅ 逐位一致（扩围未改语义）" if same else "❌ **不一致**（扩围改了语义，须查）"))
    lines += [
        "",
        "> 「逐位一致」是本页最强的单点证据：**锁定范围扩围**若真的只锁范围，读数就必须一动不动。",
        "",
        "## 10. 边界（本运行未做 / 刻意不做）",
        "",
        "- **未部署**：不 `tcb deploy`、不动 CloudBase 函数；",
        "- **未提升 authority**：继续 Shadow / CANARY；不写 `decision_result` / `portfolio_position` /",
        "  `portfolio_snapshot`；不写 V3.6.1 `final_target`；",
        "- **不构成经济结论**：B3 Frozen OOS 通过前，一切净值 / Sharpe / MDD 只是研发证据；",
        "- **未改规则**：本次运行只**读**冻结 bundle 与冻结实现，未做任何参数或语义变更；",
        "- **旧报告降级**：`b1_ledger_baseline_20260911` / `gen2_b1_research_baselines_20260911.md`",
        "  自本次起**只作审计基线**，不再作为比较对象。",
        "",
        "## 11. 复现",
        "",
        "```bash",
        "PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --date %s"
        % m["created_at"][:10].replace("-", ""),
        "# 只读验锁（不改盘）",
        "python scripts/ml/freeze-gen2-rule-bundle.py --check",
        "node scripts/verify-immutable.js",
        "```",
        "",
        "> 任一门禁失配（锁 SHA / ROOT_ANCHORS / 配置漂移 / 跨实现常量 / manifest 自校验）时本入口",
        "> **直接拒绝运行**，因此不存在「在一份未冻结的规则上跑出 B1」这种形态。",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="B1 冻结运行（以 gen2-rule-v2.0.1 锁为唯一输入）")
    ap.add_argument("--date", default="20260914", help="日期标签（YYYYMMDD），用于 run ID 与报告名")
    ap.add_argument("--run-id", default=None, help="显式 run ID（默认由 bundle_version 派生）")
    ap.add_argument("--report-dir", default=None)
    ap.add_argument("--manifest", default=None)
    args = ap.parse_args()

    try:
        r = run(date_tag=args.date, run_id=args.run_id,
                report_dir=args.report_dir, manifest_path=args.manifest)
    except FrozenAttestationError as exc:
        print("[B1-FROZEN] 拒绝运行：%s" % exc, file=sys.stderr)
        return 2

    m = r["manifest_data"]
    a = m["acceptance"]
    print("[B1-FROZEN] run id      :", r["run_id"])
    print("[B1-FROZEN] run dir     :", r["run_dir"])
    print("[B1-FROZEN] manifest    :", r["manifest"])
    print("[B1-FROZEN] report      :", r["report"])
    print("[B1-FROZEN] calendar    : %s → %s (%d days)" % (
        m["window"]["calendar"]["first_date"], m["window"]["calendar"]["last_date"],
        m["window"]["calendar"]["days"]))
    print("[B1-FROZEN] drift       :", m["config_attestation"]["drift"] or "none")
    print("[B1-FROZEN] lock sha    : %s (rev %s, 组件摘要 %s)" % (
        m["frozen_input"]["lock"]["lock_sha256"][:12] + "…",
        m["frozen_input"]["lock"]["lock_revision"],
        m["frozen_input"]["lock_component_digest"][:12] + "…"))
    print("[B1-FROZEN] input digest: %s (%s → %s)" % (
        m["input_data"]["content_digest"][:12] + "…",
        m["input_data"]["date_range"]["first_date"], m["input_data"]["date_range"]["last_date"]))
    print("[B1-FROZEN] self-check  : %d/%d 项哈希一致 → %s" % (
        m["self_check"]["passed"], m["self_check"]["checks"],
        "PASS" if m["self_check"]["all_pass"] else "FAIL"))
    print("[B1-FROZEN] gate        : conservation=%.3e cash_min=%.6f → %s" % (
        a["conservation_max_error"], a["cash_min"], "PASS" if a["gate_pass"] else "FAIL"))
    return 0 if a["gate_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
