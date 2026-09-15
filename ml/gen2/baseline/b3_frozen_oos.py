"""WP-B3 —— **Frozen OOS**：以已接受的冻结规则在**样本外**区间上做一次性验证。

授权（用户 2026-09-15 裁决，范围限定**离线、只读验证**）：

  * 固定使用 `gen2-rule-v2.0.1`、`lock_revision 3`、**已接受 B1 manifest**；
  * **不改**规则 / 参数 / 实现 / 样本边界 / 成本口径；
  * 输出 OOS 的数据摘要、锁 SHA、净收益 / Sharpe / 换手 / IC 与 Main5 对照；
  * **失败即维持 Shadow / CANARY，另立新假设研究**；禁止看结果后回调参数重跑；
  * **不部署、不提 authority、不写正式仓位**。

协议（判据在**结果前**定死）：`ml/gen2/reports/gen2_b3_frozen_oos_plan_20260915.md`。

设计要点
--------
1. **OOS 边界沿用仓库既有口径**，不自定：`evaluation/walk_forward.py` 的
   `WalkForwardConfig(train_years=3, purge_days=20, embargo_days=5)` 下 fold 的 test 段并集
   （本数据池 = `2021-01-04` → `2026-09-04`，1376 个交易日，与公共日历连续）。
2. **账本连续、只切片**：以与 B1 完全相同的调用跑全窗口账本（同 calendar / 同期初全现金 / 同 T+1 /
   同费用模型 / 同 `build_unified_baselines` 入口），再把逐日账本切到 OOS 段算指标 ——
   状态机与持仓在 OOS 起点连续，**不冷启动**，因此不产生首日建仓的换手/费用假象。
3. **必须重算，且必须与已接受读数逐位一致**：本机 `ml/gen2/outputs/` 已清理（`outputs/` 未入库），
   无法读回 B1 产物 ⇒ B3 重算全窗口，并与**已接受 B1 报告 §6 的表**逐位核对（H5）。
   该核对证明「B3 用的就是被接受的那条规则、那个账本、那份数据」。
4. **不 fork 口径**：三门前置、四类哈希、`self_check`、`source_state` 全部**复用** `b1_frozen_run`
   的既有实现（同一函数，而非另写一套）；指标复用 `rebuild_baselines.perf_metrics` /
   `ledger`/`walk_forward.evaluate_fold` / `bootstrap.block_bootstrap_mean`。
5. **不触碰 B1 取证**：只新增本文件与 B3 命名产物，不改锁定组件 / B1 工具链 / 输入 / 已承诺输出
   ⇒ 已取证的 B1 **不失效**、无需重跑。

运行::

    PYTHONPATH=ml python -m gen2.baseline.b3_frozen_oos
    PYTHONPATH=ml python -m gen2.baseline.b3_frozen_oos --date 20260915
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from gen2.baseline.b1_frozen_run import (
    BUNDLE_REL,
    FrozenAttestationError,
    _abs,
    _aggregate_digest,
    _rel,
    _sha,
    _write_manifest,
    derive_config,
    environment_version,
    input_data_attestation,
    source_mutation_report,
    source_state,
    verify_frozen_lock,
    verify_manifest,
)
from gen2.baseline.rebuild_baselines import build_unified_baselines, perf_metrics
from gen2.data.loader import (
    GEN2_ROOT,
    load_daily_bars,
    load_gen2_config,
    load_universe_records,
)
from gen2.evaluation.bootstrap import block_bootstrap_mean
from gen2.evaluation.walk_forward import WalkForwardConfig, build_walk_forward_folds, evaluate_fold
from gen2.features.build_features import build_feature_matrix
from gen2.labels.build_labels import build_labels_vs_market
from gen2.ranking.rank_engine import run_rank_engine

PROJECT_ROOT = GEN2_ROOT.parents[1]

#: B3 协议（判据在结果前定死）。协议文件本身的 SHA 进 manifest —— 判据被事后改写即失配。
PROTOCOL_REL = "ml/gen2/reports/gen2_b3_frozen_oos_plan_20260915.md"

#: 已接受 B1 的证据（B3 的**唯一**对照锚）。
ACCEPTED_B1_MANIFEST_REL = "ml/gen2/manifests/GEN2_B1_FROZEN_RUN_MANIFEST_20260914.json"
ACCEPTED_B1_REPORT_REL = "ml/gen2/reports/gen2_b1_frozen_run_20260914.md"

#: 主判据成本档（与 B1 `default_cost_bps` 一致）。
PRIMARY_COST_BPS = 10.0

#: 运行侧实现（决定「B3 怎么算」）。其中 3 项与 B1 工具链**同文件** ——
#: 运行时会逐项比对 B1 manifest 的对应哈希，证明「复用同一条已取证工具链」。
B3_RUN_IMPLEMENTATION = [
    ("b3_frozen_oos", "B3 冻结 OOS 入口：OOS 切分 / 切片指标 / 判据 / manifest 装配",
     "ml/gen2/baseline/b3_frozen_oos.py"),
    ("baseline_builder", "B1 基线构建（与 B1 **同一文件**）：build_unified_baselines",
     "ml/gen2/baseline/rebuild_baselines.py"),
    ("ledger", "唯一权威账本（与 B1 **同一文件**）：run_ledger / LEDGER_CONTRACT",
     "ml/gen2/backtest/ledger.py"),
    ("cost_impl", "费用兼容层（与 B1 **同一文件**）", "ml/gen2/backtest/costs.py"),
    ("walk_forward", "OOS 切分与 Rank IC 口径：build_walk_forward_folds / evaluate_fold",
     "ml/gen2/evaluation/walk_forward.py"),
    ("bootstrap", "增量置信区间：block_bootstrap_mean（n_boot=1000, block=20, seed=42）",
     "ml/gen2/evaluation/bootstrap.py"),
    ("selection_scores", "Canonical Alpha 评分唯一入口：canonical_selection_scores（亦为锁定组件）",
     "ml/gen2/baseline/selection_scores.py"),
]

#: 与 B1 工具链**同文件**的条目 → 逐项比对 B1 manifest 的哈希（证明同一条工具链）。
#: 注意：`selection_scores` 虽与规则一并被锁（`immutable_set`），但**不在** B1 的 `run_implementation`
#: 列表内 ⇒ 它的等价性由 H5a（锁定组件折叠摘要）保证，而不是由工具链哈希保证。
SHARED_WITH_B1 = ("baseline_builder", "ledger", "cost_impl")

#: 判据（协议 §7.2）—— **结果前定死**，不得因结果调整。
CRITERIA = {
    "C1": {"name": "OOS 累计净收益（10bps）defended > 同窗口 Main5 PIT 等权", "threshold": "strictly_greater"},
    "C2": {"name": "OOS Sharpe（10bps）defended >= 同窗口 Main5 PIT 等权", "threshold": ">="},
    "C3": {"name": "Selection Net Increment（日频 defended − main5）bootstrap 95% CI 下界 >= −1e-4/日",
           "threshold": {"ci_low_min": -1e-4}},
    "C4": {"name": "无灾难年份：每个 OOS 自然年 defended 年度净收益 >= 同年度 Main5 − 15pct",
           "threshold": {"worse_than_main5_max": -0.15}},
    "nok_rule": {"name": "否决规则：仅 raw IC 为正而成本后仍输 Main5 ⇒ 无论 IC 一律 FAIL",
                 "source": "PLAN_GEN2_1.md §10"},
}
NO_DISASTER_TOLERANCE = -0.15

#: 运行状态（四态口径的 B3 化）：本地产出**待裁决**；中止码见 `ABORT_*`。
STATUS_PENDING_REVIEW = "PENDING_REVIEW"
ABORT_B1_MISMATCH = "ABORTED_B1_MISMATCH"
ABORT_LEDGER = "ABORTED_LEDGER"
ABORT_WINDOW = "ABORTED_WINDOW_MISMATCH"
ABORT_SOURCE_MUTATED = "ABORTED_SOURCE_MUTATED"
ABORT_B1_INPUT_CHANGED = "ABORTED_B1_INPUT_CHANGED"

VERDICT_PASS = "PASS"
VERDICT_FAIL = "FAIL"


# ---------------------------------------------------------------- ① OOS 边界

def derive_oos_window(calendar: list, cfg: WalkForwardConfig | None = None) -> dict:
    """由**仓库既有**的 walk-forward 口径推导 OOS 窗口（不自定边界）。

    OOS = 各 fold 的 `test_dates` 并集（test 段 = 单个自然年）；同时报告与评价日历是否连续。

    返回同时带 `dates`（`datetime.date` 对象，供 `walk_forward.evaluate_fold` 的 `isin` 匹配）与
    `dates_str`（`YYYY-MM-DD`，供账本切片与展示）—— **类型必须分开**：账本读回后是字符串，
    而 fold 里是 `date` 对象，混用会导致「看起来一样、匹配为空」的假阴性。
    """
    wf = cfg or WalkForwardConfig()
    folds = build_walk_forward_folds(calendar, wf)
    if not folds:
        raise FrozenAttestationError("walk-forward 未产出任何 fold（评价日历太短）⇒ 无法定义 OOS 窗口")
    days = sorted({d for f in folds for d in f["test_dates"]})
    day_strs = [str(d) for d in days]
    cal_days = sorted({str(d)[:10] for d in calendar})
    inside = [d for d in cal_days if day_strs[0] <= d <= day_strs[-1]]
    return {
        "source": ("gen2.evaluation.walk_forward.WalkForwardConfig"
                   f"(train_years={wf.train_years}, purge_days={wf.purge_days}, embargo_days={wf.embargo_days})"),
        "definition": "各 fold 的 test 段（单个自然年）并集",
        "config": {"train_years": wf.train_years, "purge_days": wf.purge_days,
                   "embargo_days": wf.embargo_days, "min_codes_per_day": wf.min_codes_per_day},
        "folds": [{k: f[k] for k in ("fold", "test_year", "train_end", "test_start", "test_end",
                                     "n_train", "n_test")} for f in folds],
        "first_date": day_strs[0],
        "last_date": day_strs[-1],
        "days": len(days),
        "dates": days,
        "dates_str": day_strs,
        "contiguous_in_calendar": len(inside) == len(days),
        "calendar_days_inside": len(inside),
        "evaluation_calendar": {"first_date": cal_days[0], "last_date": cal_days[-1], "days": len(cal_days)},
    }


# ---------------------------------------------------------------- ② 已接受 B1 对照

def load_accepted_b1() -> dict:
    """读取已接受 B1 的 manifest + 报告，并核验报告哈希与其自身声明一致。"""
    man_path = _abs(ACCEPTED_B1_MANIFEST_REL)
    rep_path = _abs(ACCEPTED_B1_REPORT_REL)
    if not man_path.is_file():
        raise FrozenAttestationError(f"已接受 B1 manifest 缺失：{ACCEPTED_B1_MANIFEST_REL}")
    if not rep_path.is_file():
        raise FrozenAttestationError(f"已接受 B1 报告缺失：{ACCEPTED_B1_REPORT_REL}")
    man = json.loads(man_path.read_text(encoding="utf-8"))
    if man.get("run_status") != "ACCEPTED":
        raise FrozenAttestationError(
            f"B1 manifest run_status = {man.get('run_status')!r}（应为 ACCEPTED）⇒ 不得作为 B3 对照锚")
    declared = ((man.get("outputs") or {}).get("committed_report") or {}).get("sha256")
    actual = _sha(rep_path)
    if not declared or declared != actual:
        raise FrozenAttestationError(
            "已接受 B1 报告哈希与其 manifest 声明不一致（报告可能被改写）⇒ 拒绝以它作对照")
    return {
        "manifest_file": ACCEPTED_B1_MANIFEST_REL,
        "manifest_sha256": _sha(man_path),
        "report_file": ACCEPTED_B1_REPORT_REL,
        "report_sha256": actual,
        "run_id": man.get("run_id"),
        "run_status": man.get("run_status"),
        "lock_sha256": (man.get("frozen_input") or {}).get("lock", {}).get("lock_sha256"),
        "lock_component_digest": (man.get("frozen_input") or {}).get("lock_component_digest"),
        "input_content_digest": (man.get("input_data") or {}).get("content_digest"),
        "run_implementation": man.get("run_implementation") or [],
        "acceptance": man.get("acceptance"),
        "window": man.get("window"),
        "_manifest": man,
    }


_ROW_RE = re.compile(r"^\|\s*([a-z0-9_]+)\s*\|\s*(\d+)\s*\|(.*)\|\s*$")


def parse_report_readings(report_text: str) -> list[dict]:
    """解析已接受 B1 报告「同口径比较」表（20 行 = 5 策略 × 4 成本档）。

    表由**数据生成**（不是手工誊抄），故 B3 的核对也是「数据对数据」。
    """
    rows: list[dict] = []
    for line in report_text.splitlines():
        m = _ROW_RE.match(line.strip())
        if not m:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 9:
            continue
        try:
            rows.append({
                "strategy": cells[0],
                "cost_bps": float(cells[1]),
                "terminal_nav": float(cells[2]),
                "cumulative_return_pct": float(cells[3].replace("%", "")),
                "cagr_pct": float(cells[4].replace("%", "")),
                "sharpe": float(cells[5]),
                "mdd_pct": float(cells[6].replace("%", "")),
                "total_turnover": float(cells[7]),
                "total_cost": float(cells[8]),
            })
        except ValueError:
            continue
    return rows


def verify_reproduction(summary: pd.DataFrame, accepted_rows: list[dict]) -> dict:
    """H5：B3 重算的全窗口读数 vs 已接受 B1 报告表，按**报告显示精度**逐位比对。

    精度口径与 B1 的「候选运行一致性核对」一致（报告上看起来一致 ⇔ 判定一致）：
    净值 4 位 / 收益·CAGR·MDD 2 位百分比 / Sharpe 2 位 / 换手 3 位 / 费用 4 位。
    """
    got = {(r["strategy"], float(r["cost_bps"])): r for _, r in summary.iterrows()}
    checks, mismatches = [], []
    for a in accepted_rows:
        key = (a["strategy"], float(a["cost_bps"]))
        g = got.get(key)
        if g is None:
            mismatches.append({"strategy": key[0], "cost_bps": key[1], "reason": "本次运行缺该策略×成本档"})
            continue
        pair = {
            "terminal_nav": (a["terminal_nav"], round(float(g["terminal_nav"]), 4)),
            "cumulative_return_pct": (a["cumulative_return_pct"], round(float(g["cumulative_return"]) * 100, 2)),
            "cagr_pct": (a["cagr_pct"], round(float(g["cagr"]) * 100, 2)),
            "sharpe": (a["sharpe"], round(float(g["sharpe"]), 2)),
            "mdd_pct": (a["mdd_pct"], round(float(g["mdd"]) * 100, 2)),
            "total_turnover": (a["total_turnover"], round(float(g["total_turnover"]), 3)),
            "total_cost": (a["total_cost"], round(float(g["total_cost"]), 4)),
        }
        bad = {k: {"accepted": v[0], "recomputed": v[1]} for k, v in pair.items() if v[0] != v[1]}
        checks.append({"strategy": key[0], "cost_bps": key[1], "fields": len(pair), "mismatched": len(bad)})
        if bad:
            mismatches.append({"strategy": key[0], "cost_bps": key[1], "fields": bad})
    return {
        "accepted_rows": len(accepted_rows),
        "compared_cells": sum(c["fields"] for c in checks),
        "mismatched_cells": sum(c["mismatched"] for c in checks),
        "all_match": not mismatches and len(accepted_rows) > 0,
        "mismatches": mismatches,
        "precision": {"terminal_nav": 4, "cumulative_return_pct": 2, "cagr_pct": 2,
                      "sharpe": 2, "mdd_pct": 2, "total_turnover": 3, "total_cost": 4},
    }


def verify_toolchain_reuse(impl: list[dict], accepted: dict) -> dict:
    """证明「复用同一条已取证工具链」：与 B1 同文件的条目须与 B1 manifest 哈希逐项一致。"""
    theirs = {e.get("id"): e.get("sha256") for e in (accepted.get("run_implementation") or [])}
    rows = []
    for e in impl:
        if e["id"] not in SHARED_WITH_B1:
            continue
        rows.append({"id": e["id"], "file": e["file"],
                     "b3_sha256": e["sha256"], "b1_sha256": theirs.get(e["id"]),
                     "match": e["sha256"] is not None and e["sha256"] == theirs.get(e["id"])})
    return {"shared_ids": list(SHARED_WITH_B1), "rows": rows,
            "all_match": all(r["match"] for r in rows) and len(rows) == len(SHARED_WITH_B1)}


# ---------------------------------------------------------------- ③ OOS 切片指标

def _ledger_daily(run_dir: Path) -> pd.DataFrame:
    p = run_dir / "ledger_daily.csv"
    if not p.is_file():
        raise FrozenAttestationError(f"账本逐日产物缺失：{p}")
    df = pd.read_csv(p, dtype={"code": str})
    df["trade_date"] = df["trade_date"].astype(str).str.slice(0, 10)
    return df


def slice_oos(daily: pd.DataFrame, oos_dates: list[str]) -> tuple[pd.DataFrame, dict]:
    """把逐日账本切到 OOS 段，并核验 OOS 全部落在账本公共日历内（否则窗口不可比）。"""
    cal = sorted(daily["trade_date"].unique().tolist())
    have = set(cal)
    inside = [d for d in oos_dates if d in have]
    meta = {
        "ledger_calendar": {"first_date": cal[0], "last_date": cal[-1], "days": len(cal)},
        "oos_declared_days": len(oos_dates),
        "oos_days_in_ledger_calendar": len(inside),
        "missing_oos_days": [d for d in oos_dates if d not in have][:20],
        "all_oos_days_present": len(inside) == len(oos_dates),
    }
    return daily[daily["trade_date"].isin(set(inside))].copy(), meta


def oos_econ(daily_oos: pd.DataFrame, cost_levels: list[float]) -> pd.DataFrame:
    """OOS 段经济读数（净收益序列从 1.0 复利；换手/费用为段内求和）。"""
    rows = []
    for bps in cost_levels:
        sub = daily_oos[np.isclose(daily_oos["cost_bps"].astype(float), float(bps))]
        for strat in sorted(sub["strategy"].unique().tolist()):
            g = sub[sub["strategy"] == strat].sort_values("trade_date")
            m = perf_metrics(g["net_return"])
            rows.append({
                "strategy": strat, "cost_bps": float(bps), "days": int(len(g)),
                "first_date": str(g["trade_date"].iloc[0]), "last_date": str(g["trade_date"].iloc[-1]),
                "terminal_nav": float((1.0 + g["net_return"]).prod()),
                "cumulative_return": float(m["cumulative_return"]),
                "cagr": float(m["cagr"]), "sharpe": float(m["sharpe"]), "mdd": float(m["mdd"]),
                "total_turnover": float(g["turnover"].sum()),
                "avg_turnover": float(g["turnover"].mean()),
                "total_cost": float(g["cost"].sum()),
                "conservation_max_error": float(g["conservation_error"].max()),
                "cash_min": float(g["cash_weight"].min()),
                "over_allocated_days": int(g["over_allocated"].sum()),
            })
    return pd.DataFrame(rows)


def oos_ic(features: pd.DataFrame, rankings: pd.DataFrame, labels: pd.DataFrame, oos: dict,
           score_col: str = "alpha_score_v2", label_col: str = "y_rank_vs_market_20d") -> dict:
    """OOS 段 Rank IC：总量 + 逐 fold（年）。口径 = `walk_forward.evaluate_fold`（不新定义）。"""
    # 与 walk_forward.__main__ / permission_oos 同口径：canonical Alpha 显式注入 rankings
    from gen2.baseline.selection_scores import canonical_selection_scores

    scores = canonical_selection_scores(features)
    rk = rankings.merge(scores.merge_frame(), on=["trade_date", "code"], how="left")

    total = evaluate_fold(rk, labels,
                          {"fold": 0, "test_year": "OOS_ALL", "test_dates": oos["dates"]},
                          score_col, label_col)
    per_year = []
    for f in oos["folds"]:
        dates = [d for d in oos["dates"] if d.year == int(f["test_year"])]
        per_year.append(evaluate_fold(rk, labels,
                                      {"fold": f["fold"], "test_year": f["test_year"], "test_dates": dates},
                                      score_col, label_col))
    return {"score_col": score_col, "label_col": label_col, "aggregate": total, "per_fold": per_year}


def increment_bootstrap(daily_oos: pd.DataFrame, strategy: str = "gen2_v2_defended",
                        reference: str = "main5_equal_weight",
                        cost_bps: float = PRIMARY_COST_BPS) -> dict:
    """Selection Net Increment（日频 差异）的 block bootstrap 95% CI（复用既有 bootstrap 实现）。"""
    sub = daily_oos[np.isclose(daily_oos["cost_bps"].astype(float), float(cost_bps))]
    a = sub[sub["strategy"] == strategy].sort_values("trade_date").set_index("trade_date")["net_return"]
    b = sub[sub["strategy"] == reference].sort_values("trade_date").set_index("trade_date")["net_return"]
    diff = (a - b).dropna()
    stat = block_bootstrap_mean(diff)
    return {"strategy": strategy, "reference": reference, "cost_bps": float(cost_bps), **stat}


def yearly_returns(daily_oos: pd.DataFrame, strategies: list[str],
                   cost_bps: float = PRIMARY_COST_BPS) -> pd.DataFrame:
    """逐年净收益（OOS 段内按自然年复利），用于 C4「无灾难年份」。"""
    sub = daily_oos[np.isclose(daily_oos["cost_bps"].astype(float), float(cost_bps))]
    sub = sub[sub["strategy"].isin(strategies)].copy()
    sub["year"] = sub["trade_date"].str.slice(0, 4)
    out = []
    for y, g in sub.groupby("year"):
        row = {"year": y}
        for s in strategies:
            sg = g[g["strategy"] == s]
            row[s] = float((1.0 + sg["net_return"]).prod() - 1.0) if len(sg) else float("nan")
        out.append(row)
    return pd.DataFrame(out).sort_values("year")


# ---------------------------------------------------------------- ④ 二元判据

def evaluate_criteria(econ: pd.DataFrame, ic: dict, boot: dict, yearly: pd.DataFrame,
                      *, cost_bps: float = PRIMARY_COST_BPS) -> dict:
    """按协议 §7.2 判定（**结果前定死**）：C1 ∧ C2 ∧ C3 ∧ C4 ⇒ PASS，否则 FAIL。"""

    def row(strategy: str) -> dict | None:
        sub = econ[(econ["strategy"] == strategy) & np.isclose(econ["cost_bps"].astype(float), cost_bps)]
        return None if sub.empty else sub.iloc[0].to_dict()

    d, m = row("gen2_v2_defended"), row("main5_equal_weight")
    if d is None or m is None:
        raise FrozenAttestationError("OOS 经济表缺 defended 或 main5 → 无法判定")

    c1_ok = bool(d["cumulative_return"] > m["cumulative_return"])
    c2_ok = bool(d["sharpe"] >= m["sharpe"])
    c3_ok = bool(boot["ci_low"] >= CRITERIA["C3"]["threshold"]["ci_low_min"])
    worst_year = None
    for _, r in yearly.iterrows():
        gap = float(r["gen2_v2_defended"]) - float(r["main5_equal_weight"])
        worst_year = gap if worst_year is None else min(worst_year, gap)
    c4_ok = bool(worst_year is not None and worst_year >= NO_DISASTER_TOLERANCE)

    rank_ic = float(ic["aggregate"]["rank_ic"])
    nok_rule_applied = bool((not c1_ok or not c2_ok) and rank_ic > 0)

    checks = [
        {"id": "C1", "name": CRITERIA["C1"]["name"], "ok": c1_ok,
         "defended": float(d["cumulative_return"]), "main5": float(m["cumulative_return"]),
         "delta": float(d["cumulative_return"] - m["cumulative_return"])},
        {"id": "C2", "name": CRITERIA["C2"]["name"], "ok": c2_ok,
         "defended": float(d["sharpe"]), "main5": float(m["sharpe"]),
         "delta": float(d["sharpe"] - m["sharpe"])},
        {"id": "C3", "name": CRITERIA["C3"]["name"], "ok": c3_ok,
         "ci_low": float(boot["ci_low"]), "ci_high": float(boot["ci_high"]),
         "mean": float(boot["mean"]), "threshold": CRITERIA["C3"]["threshold"]["ci_low_min"]},
        {"id": "C4", "name": CRITERIA["C4"]["name"], "ok": c4_ok,
         "worst_year_gap": worst_year, "threshold": NO_DISASTER_TOLERANCE},
    ]
    verdict = VERDICT_PASS if all(c["ok"] for c in checks) else VERDICT_FAIL
    return {
        "cost_bps": float(cost_bps),
        "criteria_source": PROTOCOL_REL,
        "checks": checks,
        "rank_ic_oos": rank_ic,
        "nok_rule_applied": nok_rule_applied,
        "nok_rule_note": ("IC 为正但成本后仍输 Main5 ⇒ 按否决规则一律 FAIL（IC 不是资格）"
                          if nok_rule_applied else "未触发"),
        "verdict": verdict,
        "verdict_note": ("按协议 §7.2 全部判据满足 ⇒ 通过本协议判据（**不等于**可部署/提权）"
                         if verdict == VERDICT_PASS else
                         "未满足全部判据 ⇒ FAIL：维持 Shadow / CANARY，另立新假设研究；"
                         "禁止根据本次结果回调参数后重跑"),
    }


# ---------------------------------------------------------------- 运行

def run(*, date_tag: str = "20260915", run_id: str | None = None,
        report_dir: str | Path | None = None, manifest_path: str | Path | None = None,
        output_root: str | Path | None = None, write_committed_manifest: bool = True,
        oos_dates: list[str] | None = None, skip_ic: bool = False) -> dict:
    """执行 B3 冻结 OOS：三门前置 → 全窗口账本 → H5 核对 → OOS 切片 → 判据 → manifest/报告。"""
    # ---- 三门前置（与 B1 同一实现）----
    attest = verify_frozen_lock()
    bundle = json.loads(_abs(BUNDLE_REL).read_text(encoding="utf-8"))
    base_cfg = load_gen2_config()
    cfg, cfg_attest = derive_config(bundle, base_cfg)

    impl = [{"id": iid, "role": role, "file": rel, "exists": _abs(rel).is_file(), "sha256": _sha(rel)}
            for iid, role, rel in B3_RUN_IMPLEMENTATION]
    env = environment_version()
    inputs = input_data_attestation(cfg)
    src = source_state()
    accepted = load_accepted_b1()

    rid = run_id or ("b3_frozen_oos_%s_frozen_v201" % date_tag)
    root = Path(output_root) if output_root else GEN2_ROOT / "outputs"
    out_dir = Path(root) / rid
    reps = Path(report_dir) if report_dir else GEN2_ROOT / "reports"
    committed_manifest_rel = f"ml/gen2/manifests/GEN2_B3_FROZEN_OOS_MANIFEST_{date_tag}.json"
    committed_report_rel = f"ml/gen2/reports/gen2_b3_frozen_oos_{date_tag}.md"
    man_out = (Path(manifest_path) if manifest_path is not None
               else (GEN2_ROOT / "manifests" / f"GEN2_B3_FROZEN_OOS_MANIFEST_{date_tag}.json")
               if write_committed_manifest else out_dir / "b3_manifest.json")

    manifest: dict = {
        "manifest_type": "GEN2_B3_FROZEN_OOS",
        "run_id": rid,
        "created_at": pd.Timestamp.now("UTC").isoformat(),
        "run_status": STATUS_PENDING_REVIEW,
        "run_status_note": ("本地产出，**待用户裁决**：判据（协议 §7.2）在结果前定死；"
                            "在用户按 §8 处置之前，不得自称「已获得经济资格」。"),
        "boundaries": {
            "stage": "SHADOW/CANARY",
            "deployed": False, "authority_promoted": False, "writes_position": False,
            "offline_only": True, "network_calls": False, "writes_cloudbase": False,
            "params_changed": False, "sample_boundary_changed": False, "cost_caliber_changed": False,
            "economic_claim_allowed": "仅限本协议判据内，且需用户裁决",
        },
        "protocol": {"file": PROTOCOL_REL, "sha256": _sha(PROTOCOL_REL), "criteria": CRITERIA},
        "source_state": src,
        "frozen_input": {
            "lock": {k: attest[k] for k in
                     ("lock_file", "lock_sha256", "lock_sha256_declared_in_root_anchors",
                      "lock_revision", "engine_id", "bundle_version", "bundle_sha256",
                      "root_anchor_in_sync")},
            "lock_component_digest": attest["lock_component_digest"],
            "immutable_set": attest["immutable_set"],
            "build_artifacts": attest["build_artifacts"],
            "bundle_selection": {"role_thresholds": bundle["selection"]["role_thresholds"]},
            "bundle_alpha": bundle.get("alpha"),
            "bundle_regime": bundle.get("regime"),
        },
        "run_implementation": impl,
        "environment": env,
        "input_data": inputs,
        "config_attestation": cfg_attest,
        "accepted_b1_reference": {k: v for k, v in accepted.items() if k != "_manifest"},
        "run_dir": _rel(out_dir),
        "committed_manifest": committed_manifest_rel,
        "report": committed_report_rel,
    }

    def abort(code: str, detail: str) -> None:
        manifest["run_status"] = code
        manifest["run_status_note"] = f"**已中止（{code}）**：{detail}"
        manifest["abort"] = {"code": code, "detail": detail}
        _write_manifest(manifest, out_dir, man_out)
        raise FrozenAttestationError(f"{code}：{detail}")

    # ---- H 门（先于重算，全部 fail-closed）----
    reuse = verify_toolchain_reuse(impl, accepted)
    hard_gates = [
        {"id": "H1", "name": "锁 ↔ 磁盘逐位核验（8 项 + 构建产物声明 + ROOT_ANCHORS 自锚）",
         "ok": bool(attest["root_anchor_in_sync"]) and all(e["match"] for e in attest["immutable_set"]),
         "detail": {"lock_sha256": attest["lock_sha256"], "lock_revision": attest["lock_revision"]}},
        {"id": "H2", "name": "运行配置 ↔ 冻结 bundle 零漂移（17 个规则键）",
         "ok": not cfg_attest["drift"], "detail": {"rules_checked": len(cfg_attest["rule_map"])}},
        {"id": "H3", "name": "跨实现常量交叉核对（regime 55/45、canonical Alpha）",
         "ok": not cfg_attest["cross_checks"], "detail": {"mismatches": cfg_attest["cross_checks"]}},
        {"id": "H4", "name": "输入内容摘要 == 已接受 B1 manifest 的 input.content_digest",
         "ok": inputs["content_digest"] == accepted["input_content_digest"],
         "detail": {"now": inputs["content_digest"], "accepted_b1": accepted["input_content_digest"]}},
        {"id": "H5a", "name": "锁定组件摘要 == 已接受 B1（lock SHA + 8 项折叠摘要）",
         "ok": (attest["lock_sha256"] == accepted["lock_sha256"]
                and attest["lock_component_digest"] == accepted["lock_component_digest"]),
         "detail": {"lock_component_digest": attest["lock_component_digest"]}},
        {"id": "H5b", "name": "与 B1 同文件的工具链条目哈希一致（复用同一条已取证工具链）",
         "ok": reuse["all_match"], "detail": reuse},
    ]
    manifest["hard_gates"] = hard_gates
    for g in hard_gates:
        if not g["ok"]:
            code = ABORT_B1_INPUT_CHANGED if g["id"] == "H4" else ABORT_B1_MISMATCH
            abort(code, f"{g['id']} 失配：{json.dumps(g['detail'], ensure_ascii=False, default=str)}")

    # ---- 全窗口账本（与 B1 同一入口/同一口径；OOS 指标随后切片）----
    result = build_unified_baselines(output_dir=out_dir, report_dir=out_dir, config=cfg, run_id=rid)
    summary_full = result["summary"]
    verification = result["verification"]
    daily = _ledger_daily(out_dir)

    # ---- H5c：重算读数 == 已接受读数（逐位，报告显示精度）----
    accepted_rows = parse_report_readings(_abs(ACCEPTED_B1_REPORT_REL).read_text(encoding="utf-8"))
    repro = verify_reproduction(summary_full, accepted_rows)
    manifest["b1_reproduction"] = repro
    if not repro["all_match"]:
        abort(ABORT_B1_MISMATCH,
              f"重算读数与已接受 B1 报告不一致（{repro['mismatched_cells']} 个单元格）："
              + json.dumps(repro["mismatches"][:3], ensure_ascii=False, default=str))

    # ---- OOS 窗口 + 切片 ----
    features = build_feature_matrix(bars=load_daily_bars(), records=load_universe_records(), config=cfg)
    rankings = run_rank_engine(features)
    labels = build_labels_vs_market(features)

    oos = derive_oos_window(sorted(rankings["trade_date"].unique()))
    if oos_dates is not None:  # 仅供测试裁剪（字符串）
        import datetime as _dt

        trimmed = sorted({str(d)[:10] for d in oos_dates})
        oos = {**oos, "dates": [_dt.date.fromisoformat(x) for x in trimmed],
               "dates_str": trimmed, "days": len(trimmed),
               "first_date": trimmed[0], "last_date": trimmed[-1], "trimmed_for_test": True}
    daily_oos, slice_meta = slice_oos(daily, oos["dates_str"])
    if not slice_meta["all_oos_days_present"]:
        abort(ABORT_WINDOW,
              f"OOS 有 {len(slice_meta['missing_oos_days'])} 天不在账本公共日历内（窗口不可比）")

    cost_levels = [float(x) for x in (cfg["evaluation"].get("include_cost_sensitivity_bps") or [0, 5, 10, 20])]
    econ = oos_econ(daily_oos, cost_levels)

    # ---- H6：OOS 段账本验收 ----
    oos_gate = {
        "conservation_max_error": float(econ["conservation_max_error"].max()),
        "cash_min": float(econ["cash_min"].min()),
        "over_allocated_days_total": int(econ["over_allocated_days"].sum()),
        "days": int(econ["days"].max()),
        "strategies": sorted(econ["strategy"].unique().tolist()),
    }
    oos_gate["pass"] = bool(oos_gate["conservation_max_error"] <= 1e-9 and oos_gate["cash_min"] >= -1e-9
                            and oos_gate["over_allocated_days_total"] == 0)
    manifest["oos_gate"] = oos_gate
    if not oos_gate["pass"]:
        abort(ABORT_LEDGER, f"OOS 段账本验收失败：{json.dumps(oos_gate, ensure_ascii=False)}")

    # ---- IC / 增量 CI / 逐年 ----
    if skip_ic:
        ic = {"aggregate": {"rank_ic": float("nan"), "n_days": 0, "ic_pos": float("nan"),
                            "top_bottom_spread": float("nan")}, "per_fold": [],
              "score_col": "alpha_score_v2", "label_col": "y_rank_vs_market_20d", "skipped": True}
    else:
        ic = oos_ic(features, rankings, labels, oos)

    boot = increment_bootstrap(daily_oos)
    yearly = yearly_returns(daily_oos, ["gen2_v2_defended", "main5_equal_weight",
                                        "universe_equal_weight", "market_510300"])

    criteria = evaluate_criteria(econ, ic, boot, yearly)
    manifest.update({
        "run_inputs": {
            "universe_version": cfg["data"].get("universe_version"),
            "benchmark_code": cfg["data"].get("benchmark_code"),
            "main5": (accepted.get("_manifest") or {}).get("run_inputs", {}).get("main5"),
            "cost_levels": cost_levels, "default_cost_bps": PRIMARY_COST_BPS,
            "role_thresholds_from_config": json.loads(
                (out_dir / "calendar_meta.json").read_text(encoding="utf-8"))["role_thresholds"],
            "selection": verification["selection"],
            "ledger_contract_source": "gen2.backtest.ledger.LEDGER_CONTRACT",
            "role_semantics": "gen2.baseline.rule_v2_ab.build_v2_roles",
        },
        "full_window": {"calendar": verification["calendar"], "common_window": verification["window"]},
        "oos_window": {k: v for k, v in oos.items() if k != "dates"},
        "oos_slice": slice_meta,
        "oos_econ": econ.to_dict("records"),
        "oos_ic": ic,
        "increment_bootstrap": boot,
        "yearly_returns": yearly.to_dict("records"),
        "criteria": criteria,
    })

    # ---- 输出产物哈希（账本 / 指标 / 日历 / 运行侧报告）----
    artifacts = []
    for name in ("ledger_daily.csv", "ledger_summary.csv", "calendar_meta.json", f"gen2_{rid}.md"):
        p = out_dir / name
        artifacts.append({"file": name, "exists": p.is_file(), "sha256": _sha(p),
                          "bytes": p.stat().st_size if p.is_file() else None})
    manifest["artifacts"] = artifacts

    # ---- 阶段 1：写 manifest（尚无 outputs / self_check）----
    _write_manifest(manifest, out_dir, man_out)

    # ---- 阶段 1.5：执行窗口内源是否被改动（fail-closed，先于任何哈希自校验）----
    mutation = source_mutation_report(src, impl)
    manifest["source_mutation_check"] = mutation
    if mutation["mutated"]:
        abort(ABORT_SOURCE_MUTATED,
              "执行窗口内源被改动 ⇒ 本次读数无法归因到某一版源码，不予采信；请源静止后重跑 B3。"
              + json.dumps(mutation["modified"], ensure_ascii=False, default=str))

    # ---- 阶段 2：报告写出前自校验（不含报告自身哈希）----
    manifest["self_check_pre_report"] = verify_manifest(manifest, skip_report=True)
    if not manifest["self_check_pre_report"]["all_pass"]:
        raise FrozenAttestationError("报告写出前自校验失败："
                                     + json.dumps(manifest["self_check_pre_report"]["detail"],
                                                  ensure_ascii=False, default=str))

    reps.mkdir(parents=True, exist_ok=True)
    report = reps / f"gen2_b3_frozen_oos_{date_tag}.md"
    report.write_text(render_report(manifest, econ, yearly), encoding="utf-8")

    # ---- 阶段 3：记录报告哈希 → 完整自校验 → 重写 manifest ----
    manifest["outputs"] = {
        "run_dir": _rel(out_dir),
        "run_dir_artifacts": [a["file"] for a in artifacts],
        "committed_report": {"file": _rel(report), "exists": report.is_file(),
                             "sha256": _sha(report),
                             "bytes": report.stat().st_size if report.is_file() else None},
    }
    manifest["self_check"] = verify_manifest(manifest)
    if not manifest["self_check"]["all_pass"]:
        raise FrozenAttestationError("manifest 自校验失败："
                                     + json.dumps(manifest["self_check"]["detail"],
                                                  ensure_ascii=False, default=str))
    _write_manifest(manifest, out_dir, man_out)

    return {"manifest": man_out, "report": report, "run_dir": out_dir, "run_id": rid,
            "manifest_data": manifest, "econ": econ, "criteria": criteria}


# ---------------------------------------------------------------- 报告

def _pct(x: float) -> str:
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x * 100:+.2f}%"


def render_report(m: dict, econ: pd.DataFrame, yearly: pd.DataFrame) -> str:
    """渲染 B3 报告。**不含自身哈希**（无自引用）。"""
    oos, crit = m["oos_window"], m["criteria"]
    sc = m["self_check_pre_report"]
    L: list[str] = []
    add = L.append

    add("# Gen-2 B3 Frozen OOS 报告（冻结规则 · 样本外验证 · 待裁决）")
    add("")
    add(f"- **Run ID**：`{m['run_id']}` ｜ **状态**：`{m['run_status']}`（本地产出，待用户裁决）")
    add(f"- **判定**：**{crit['verdict']}**（判据 Cost = {crit['cost_bps']:g} bps；"
        f"协议 `{PROTOCOL_REL}`，判据在**结果前**定死）")
    add(f"- **冻结规则**：`{m['frozen_input']['lock']['bundle_version']}` / "
        f"`lock_revision {m['frozen_input']['lock']['lock_revision']}` / "
        f"bundle `{m['frozen_input']['lock']['bundle_sha256'][:12]}…` / "
        f"lock `{m['frozen_input']['lock']['lock_sha256'][:12]}…`")
    add(f"- **OOS 窗口**：`{oos['first_date']}` → `{oos['last_date']}`，**{oos['days']} 个交易日**"
        f"（{oos['source']}；与评价日历连续 = {oos['contiguous_in_calendar']}）")
    add("- **边界**：离线只读；不部署、不提 authority、不写正式仓位；未改规则/参数/实现/样本边界/成本口径。")
    add("")
    add("## 1. 一句话结论")
    add("")
    if crit["verdict"] == VERDICT_PASS:
        add("冻结规则在本 OOS 窗口上**满足协议全部判据（C1–C4）**。⚠️ 这**不**等于可部署："
            "authority 提升 / 部署仍需独立裁决。")
    else:
        add("冻结规则在本 OOS 窗口上**未通过协议判据** ⇒ **维持 Shadow / CANARY**，"
            "另立新假设研究；**禁止**根据本次结果回调参数后重跑。")
    add("")
    add("## 2. 硬门（先决；任一失配即中止，不做 PASS/FAIL 判定）")
    add("")
    add("| # | 硬门 | 判定 | 依据 |")
    add("|---|---|---|---|")
    for g in m["hard_gates"]:
        add(f"| {g['id']} | {g['name']} | {'✅ PASS' if g['ok'] else '❌ FAIL'} | "
            f"`{json.dumps(g['detail'], ensure_ascii=False, default=str)[:150]}` |")
    h5c = m["b1_reproduction"]
    add(f"| H5c | 重算全窗口读数 == 已接受 B1 报告表（逐位，报告显示精度） | "
        f"{'✅ PASS' if h5c['all_match'] else '❌ FAIL'} | 比对 {h5c['compared_cells']} 个单元格 / "
        f"失配 {h5c['mismatched_cells']} |")
    og = m["oos_gate"]
    add(f"| H6 | OOS 段资金守恒 / 现金非负 / 零超配 | {'✅ PASS' if og['pass'] else '❌ FAIL'} | "
        f"守恒误差 {og['conservation_max_error']:.3e} / 现金 min {og['cash_min']:.6f} / "
        f"超配 {og['over_allocated_days_total']} 天 |")
    mc = m.get("source_mutation_check") or {}
    add(f"| H7 | 执行窗口内源未被改动 | {'✅ PASS' if not mc.get('mutated', True) else '❌ FAIL'} | "
        f"HEAD `{str(mc.get('head_now'))[:12]}` |")
    add("")
    add("## 3. 与已接受 B1 的关系（为什么本次重算是可信的）")
    add("")
    ab = m["accepted_b1_reference"]
    add(f"- 已接受 B1：`{ab['run_id']}`，`run_status = {ab['run_status']}`，"
        f"manifest `{ab['manifest_sha256'][:12]}…`，报告 `{ab['report_sha256'][:12]}…`（哈希已核验）")
    add("- 本机 `ml/gen2/outputs/`（B1 运行目录）已被清理且 `outputs/` 未入库 ⇒ **无法读回 B1 产物**，"
        "B3 只能**重算**；因此 H5 用「重算 == 已接受读数」证明 B3 用的就是被接受的那条规则/账本/数据。")
    add(f"- 锁定组件摘要与已接受 B1 一致：`{ab['lock_component_digest'][:12]}…`；"
        f"输入内容摘要一致：`{m['input_data']['content_digest'][:12]}…`")
    h5b = next(g for g in m["hard_gates"] if g["id"] == "H5b")["detail"]
    add("- 与 B1 **同文件**的工具链条目哈希逐项一致（`" + "`, `".join(
        r["id"] for r in h5b["rows"]) + "`）⇒ 复用**同一条已取证工具链**（非另写一套口径）。")
    add("- **B1 取证未受影响**：B3 只新增文件与 B3 命名产物，未触碰锁定组件 / B1 工具链 / 输入 / 已承诺输出。")
    add("")
    add("## 4. 冻结输入核验与数据摘要")
    add("")
    add("| 项 | 值 |")
    add("|---|---|")
    add(f"| lock SHA | `{m['frozen_input']['lock']['lock_sha256']}` |")
    add(f"| lock 组件折叠摘要（8 项） | `{m['frozen_input']['lock_component_digest']}` |")
    add(f"| bundle SHA | `{m['frozen_input']['lock']['bundle_sha256']}` |")
    add(f"| ROOT_ANCHORS 自锚 | {m['frozen_input']['lock']['root_anchor_in_sync']} |")
    for e in m["frozen_input"]["immutable_set"]:
        add(f"| ├ 组件 `{e['id']}` | `{e['sha256'][:16]}…` ({e['file']}) |")
    add(f"| 输入内容摘要 | `{m['input_data']['content_digest']}` |")
    add(f"| 输入行数 / 代码数 | {m['input_data']['rows_total']} / {len(m['input_data']['codes'])} |")
    add(f"| 输入日期范围 | {m['input_data']['date_range']['first_date']} → "
        f"{m['input_data']['date_range']['last_date']} |")
    add(f"| 环境 | Python {m['environment']['python']} / pandas {m['environment']['pandas']} / "
        f"numpy {m['environment']['numpy']} |")
    add("")
    add("## 5. OOS 窗口（沿用既有 walk-forward 口径，未自定边界）")
    add("")
    add(f"- 来源：`{oos['source']}`；定义：{oos['definition']}")
    add("- fold 的 test 段：")
    add("")
    add("| fold | test 年 | test 起 | test 止 | test 天数 | train 止 |")
    add("|---|---|---|---|---|---|")
    for f in oos["folds"]:
        add(f"| {f['fold']} | {f['test_year']} | {f['test_start']} | {f['test_end']} | "
            f"{f['n_test']} | {f['train_end']} |")
    add("")
    add(f"- **并集 = OOS**：`{oos['first_date']}` → `{oos['last_date']}`，**{oos['days']} 日**，"
        f"与评价日历连续 = **{oos['contiguous_in_calendar']}**")
    sl = m["oos_slice"]
    add(f"- 账本公共日历：`{sl['ledger_calendar']['first_date']}` → `{sl['ledger_calendar']['last_date']}`"
        f"（{sl['ledger_calendar']['days']} 日）；OOS 全部落在其中 = **{sl['all_oos_days_present']}**")
    add("- 账本口径：与 B1 **同一入口**（`build_unified_baselines`）+ 同 calendar + 同 T+1 + 同期初全现金；")
    add("  OOS 指标 = OOS 段逐日净收益从 1.0 复利，换手/费用为段内求和 ⇒ 持仓与状态机在 OOS 起点**连续、不冷启动**。")
    add("")
    add("## 6. OOS 经济读数（5 策略 × 4 成本档）")
    add("")
    add("| 策略 | cost_bps | 交易日 | 期末净值 | 累计收益 | CAGR | Sharpe | MDD | 总换手 | 总费用 |")
    add("|---|---|---|---|---|---|---|---|---|---|")
    for _, r in econ.sort_values(["cost_bps", "strategy"]).iterrows():
        add(f"| {r['strategy']} | {r['cost_bps']:g} | {int(r['days'])} | {r['terminal_nav']:.4f} | "
            f"{_pct(r['cumulative_return'])} | {_pct(r['cagr'])} | {r['sharpe']:.2f} | {_pct(r['mdd'])} | "
            f"{r['total_turnover']:.3f} | {r['total_cost']:.4f} |")
    add("")
    add(f"### 6.1 与 Main5 PIT 等权的对照（cost = {crit['cost_bps']:g} bps）")
    add("")
    d = next(r for _, r in econ.iterrows() if r["strategy"] == "gen2_v2_defended"
             and r["cost_bps"] == crit["cost_bps"])
    mm = next(r for _, r in econ.iterrows() if r["strategy"] == "main5_equal_weight"
              and r["cost_bps"] == crit["cost_bps"])
    add("| 指标 | gen2_v2_defended | main5_equal_weight | Δ |")
    add("|---|---|---|---|")
    for key, label, fmt in (("cumulative_return", "累计净收益", _pct), ("sharpe", "Sharpe", lambda v: f"{v:.2f}"),
                            ("mdd", "MDD", _pct), ("cagr", "CAGR", _pct),
                            ("total_turnover", "总换手", lambda v: f"{v:.3f}")):
        add(f"| {label} | {fmt(float(d[key]))} | {fmt(float(mm[key]))} | "
            f"{fmt(float(d[key]) - float(mm[key]))} |")
    add("")
    add("## 7. OOS Rank IC（信号证据；**不是**资格判据）")
    add("")
    ic = m["oos_ic"]
    agg = ic["aggregate"]
    add(f"- 口径：`{ic['score_col']}` vs `{ic['label_col']}`，逐日横截面 Rank IC 后按日等权平均"
        f"（实现 = `walk_forward.evaluate_fold`，未新定义）")
    add("")
    add("| 切片 | 交易日 | Rank IC 均值 | IC>0 占比 | Top-Bottom spread |")
    add("|---|---|---|---|---|")
    add(f"| OOS 全体 | {agg['n_days']} | {agg['rank_ic']:+.4f} | {agg['ic_pos']:.3f} | "
        f"{agg['top_bottom_spread']:+.5f} |")
    for f in ic["per_fold"]:
        add(f"| fold {f['test_year']} | {f['n_days']} | {f['rank_ic']:+.4f} | {f['ic_pos']:.3f} | "
            f"{f['top_bottom_spread']:+.5f} |")
    add("")
    if crit["nok_rule_applied"]:
        add(f"> ⚠️ **否决规则生效**：OOS Rank IC = {crit['rank_ic_oos']:+.4f}（为正），"
            "但成本后仍输 Main5 ⇒ 按 `PLAN_GEN2_1.md` §10 **一律 FAIL**。IC 不能替代经济资格。")
    else:
        add(f"> 说明：IC 只用于解释「为什么通过 / 为什么失败」。当前 IC = {crit['rank_ic_oos']:+.4f}。")
    add("")
    add("## 8. Selection Net Increment（日频 defended − Main5）")
    add("")
    b = m["increment_bootstrap"]
    add(f"- 口径：`block_bootstrap_mean`（n_boot=1000, block=20, seed=42），"
        f"`{b['strategy']} − {b['reference']}` @ {b['cost_bps']:g} bps，n = {b['n']}")
    add(f"- 均值 **{b['mean']:+.6f}/日**，95% CI = [{b['ci_low']:+.6f}, {b['ci_high']:+.6f}]；"
        f"判据阈值（C3）下界 ≥ {CRITERIA['C3']['threshold']['ci_low_min']}")
    add("")
    add(f"## 9. 逐年净收益（cost = {crit['cost_bps']:g} bps）")
    add("")
    cols = [c for c in yearly.columns if c != "year"]
    add("| 年份 | " + " | ".join(cols) + " | defended − main5 |")
    add("|---" * (len(cols) + 2) + "|")
    for _, r in yearly.iterrows():
        gap = float(r["gen2_v2_defended"]) - float(r["main5_equal_weight"])
        flag = " ⚠️" if gap < NO_DISASTER_TOLERANCE else ""
        add(f"| {r['year']} | " + " | ".join(_pct(float(r[c])) for c in cols) + f" | {_pct(gap)}{flag} |")
    add("")
    add("## 10. 二元判定（协议 §7.2，判据结果前定死）")
    add("")
    add("| # | 判据 | 阈值 | 实测 | 判定 |")
    add("|---|---|---|---|---|")
    for c in crit["checks"]:
        if c["id"] == "C1":
            add(f"| C1 | {c['name']} | > 0 | defended {_pct(c['defended'])} vs main5 {_pct(c['main5'])}"
                f"（Δ {_pct(c['delta'])}） | {'✅ PASS' if c['ok'] else '❌ FAIL'} |")
        elif c["id"] == "C2":
            add(f"| C2 | {c['name']} | ≥ | defended {c['defended']:.2f} vs main5 {c['main5']:.2f}"
                f"（Δ {c['delta']:+.2f}） | {'✅ PASS' if c['ok'] else '❌ FAIL'} |")
        elif c["id"] == "C3":
            add(f"| C3 | {c['name']} | ≥ {c['threshold']} | CI 下界 {c['ci_low']:+.6f} | "
                f"{'✅ PASS' if c['ok'] else '❌ FAIL'} |")
        else:
            add(f"| C4 | {c['name']} | ≥ {c['threshold']} | 最差年份差 {_pct(c['worst_year_gap'])} | "
                f"{'✅ PASS' if c['ok'] else '❌ FAIL'} |")
    add("")
    add(f"**结论：`{crit['verdict']}`** —— {crit['verdict_note']}")
    add("")
    add("## 11. 处置")
    add("")
    add("- 本报告为**本地产出、待用户裁决**；`run_status = " + m["run_status"] + "`。")
    add("- FAIL ⇒ 按用户 09-15 授权：**维持 Shadow / CANARY**，另立新假设并新开研究任务书（新 "
        "`bundle_version` + 新 lock + 新审批门）；**禁止**根据本次结果回调参数后重跑。")
    add("- PASS ⇒ 仅表示通过**本协议判据**；部署 / 提 authority 仍需**独立**裁决。")
    add("- 无论 PASS/FAIL：**不部署、不提 authority、不写正式仓位**。")
    add("")
    add("## 12. 边界（本运行未做 / 刻意不做）")
    add("")
    add("- 未改规则 / 参数 / 实现 / 样本边界 / 成本口径；未调 Alpha 权重、未改 regime 阈值。")
    add("- 未联网、未写 CloudBase、未写任何生产集合；未部署、未提 authority、未写正式仓位。")
    add("- 未重跑 B1（不需要：四类摘要均未变，B1 取证继续有效）。")
    add("- 未修改判据（§7.2 在结果前写入；事后改判据视同重开协议）。")
    add("")
    add("## 13. 产物与自校验")
    add("")
    add(f"- 自校验（报告写出前，不含报告自身哈希）：**{sc['passed']}/{sc['checks']}**"
        f"（all_pass = {sc['all_pass']}）")
    add(f"- 自校验（完整，含报告自身哈希）：**{m['self_check']['passed']}/{m['self_check']['checks']}**"
        f"（all_pass = {m['self_check']['all_pass']}）")
    add("")
    add("| 产物 | sha256 | bytes |")
    add("|---|---|---|")
    for a in m["artifacts"]:
        add(f"| `{a['file']}` | `{a['sha256']}` | {a['bytes']} |")
    cr = (m.get("outputs") or {}).get("committed_report")
    if cr:
        add(f"| `{cr['file']}`（本报告） | `{cr['sha256']}` | {cr['bytes']} |")
    add("")
    add("## 14. 复现")
    add("")
    add("```bash")
    add("export PYTHONPATH=ml")
    add(f"python -m gen2.baseline.b3_frozen_oos --date {m['run_id'].split('_')[3]}")
    add("```")
    add("")
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Gen-2 B3 Frozen OOS（离线只读验证）")
    ap.add_argument("--date", default="20260915")
    ap.add_argument("--run-id", default=None)
    args = ap.parse_args()
    r = run(date_tag=args.date, run_id=args.run_id)
    m = r["manifest_data"]
    print("[B3] run id   :", r["run_id"])
    print("[B3] run dir  :", r["run_dir"])
    print("[B3] report   :", r["report"])
    print("[B3] OOS      : %s → %s (%d days)" % (m["oos_window"]["first_date"],
                                                m["oos_window"]["last_date"], m["oos_window"]["days"]))
    print("[B3] B1 repro :", m["b1_reproduction"]["all_match"],
          "(%d cells)" % m["b1_reproduction"]["compared_cells"])
    c = m["criteria"]
    for chk in c["checks"]:
        print("[B3] %s %s" % (chk["id"], "PASS" if chk["ok"] else "FAIL"))
    print("[B3] verdict  :", c["verdict"])
    print("[B3] selfcheck: %d/%d" % (m["self_check"]["passed"], m["self_check"]["checks"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
