#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WP-G2-04：离线迁移 + 重新冻结 Gen-2 Rule V2 的 bundle 与 lock。

背景（裁决 2026-09-14，PR #29 合并后立即进入）：

  * PR #26（WP-G2-05R）撤除了 JS 运行时对旧 ``top_quantile`` 的 fallback 之后，
    冻结 bundle 的 ``selection`` 段**没有** ``role_thresholds`` ⇒ Gen-2 Shadow
    每次运行都 ``blocked / RULE_BUNDLE_INCOMPLETE``（fail-closed 的预期中间态）。
  * PR #29（WP-G2-06）改变了候选组合语义（权威权重沿用 / 显式 selection score /
    现金腿 + 防守腿），因此冻结对象不再只是「参数」，还必须包含**实现**。

本脚本做两件事（**只做冻结，不部署**）：

  1. **离线迁移**：把 bundle 里残留的旧字段（``core_pct`` / ``challenger_pct`` /
     ``satellite_pct`` / ``top_quantile``）一次性换算为显式
     ``selection.role_thresholds``，写出新 ``bundle_version``（``gen2-rule-v2.0.1``）。
     换算规则与 JS ``deriveRoleThresholdsFromLegacy()`` **逐式一致**：

         core_top_fraction       = 1 - top_quantile
         challenger_top_fraction = 1 - challenger_pct
         satellite_top_fraction  = 1 - satellite_pct        （四舍五入到 1e-10）

     旧字段移入 ``selection.legacy_migration_audit``，此后**任何运行路径都不再读取**。
     **规则参数（alpha / regime / portfolio caps / defense / universe）一律不变** ——
     这次迁移不是策略调参。

  2. **重建 LOCK**：``GEN2_RULE_V2_LOCK.json`` 扩为覆盖
     bundle SHA + JS 实现哈希 + Python 规则/候选/防守实现哈希 + 构建产物哈希。

安全性设计：

  * bundle 用**文本splice**写出（只替换 ``bundle_version`` / ``selection`` / ``notes`` 三处），
    其余字节逐位不变；
  * 写出前断言「除这三处外，旧 bundle 与新 bundle 解析结果完全相等」—— 任何越界修改直接报错；
  * ``--check`` 只读校验（lock ↔ 磁盘），可在 CI / 日常复跑；
  * 幂等：重复执行不会二次改写（已迁移状态直接报告）。

用法::

    python3 scripts/ml/freeze-gen2-rule-bundle.py --check          # 只校验
    python3 scripts/ml/freeze-gen2-rule-bundle.py --dry-run        # 打印将写入的内容
    python3 scripts/ml/freeze-gen2-rule-bundle.py                  # 执行迁移 + 写 bundle/lock
    python3 scripts/ml/freeze-gen2-rule-bundle.py --rebuild-lock    # 只重建 lock（immutable_set 扩围）
    python3 scripts/ml/freeze-gen2-rule-bundle.py --print-root-anchor   # 打印 ROOT_ANCHORS 行

锁范围（``immutable_set``，共 6 项）::

    bundle / js_implementation / python_rule / python_candidate / python_defense
    / python_role_thresholds          # 2026-09-14 审查裁决扩围（lock_revision 2）

扩围只追加条目、不改规则：``--rebuild-lock`` 会断言 bundle 字节与 ``bundle_version`` 均未变。
本脚本自身**不入锁**（它不是运行时依赖，只在冻结时被人工执行）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

BUNDLE_PATH = ROOT / "ml" / "gen2" / "manifests" / "GEN2_RULE_V2_BUNDLE.json"
LOCK_PATH = ROOT / "ml" / "gen2" / "manifests" / "GEN2_RULE_V2_LOCK.json"

NEW_BUNDLE_VERSION = "gen2-rule-v2.0.1"
SEALED_AT = "2026-09-14"

#: 旧 selection 字段（迁移后只作审计，运行路径不得读取）
LEGACY_SELECTION_FIELDS = ("core_pct", "challenger_pct", "satellite_pct", "top_quantile")

#: 规则阈值默认值（与 ml/gen2/portfolio/role_thresholds.py DEFAULT_ROLE_THRESHOLDS 一致）
DEFAULT_LEGACY = {"top_quantile": 0.2, "challenger_pct": 0.70, "satellite_pct": 0.60}

#: 冻结实现集合（裁决要求：bundle SHA + JS 实现哈希 + Python 规则/候选/防守实现哈希）
#: 注：python_role_thresholds 为 2026-09-14 审查裁决**扩围**新增（lock_revision 2）。
IMMUTABLE_SET = [
    ("bundle", "规则单一真相源（Python 回测 + Node Shadow 共用）",
     "ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json"),
    ("js_implementation", "JS 权威实现：角色状态机 / 权威权重 / 候选组合 / 发布校验",
     "cloudfunctions/runGen2ShadowEod/index.js"),
    ("python_rule", "Python 规则实现：build_v2_roles 角色状态机",
     "ml/gen2/baseline/rule_v2_ab.py"),
    ("python_candidate", "Python 候选组合实现：build_portfolio_candidates",
     "ml/gen2/portfolio/portfolio_builder.py"),
    ("python_defense", "Python 防守实现：apply_regime_defense",
     "ml/gen2/portfolio/defense_gate.py"),
    ("python_role_thresholds", "Python 阈值加载/校验契约：load_role_thresholds / validate_role_thresholds",
     "ml/gen2/portfolio/role_thresholds.py"),
]

#: 构建产物（须与 immutable_set 中对应条目**逐位一致**）
BUILD_ARTIFACTS = [
    ("dist_bundle", "dist-functions/runGen2ShadowEod/GEN2_RULE_V2_BUNDLE.json", "bundle"),
    ("dist_index", "dist-functions/runGen2ShadowEod/index.js", "js_implementation"),
]

RULE_TEXT = (
    "GEN2_RULE_V2_BUNDLE 为 Rule V2 单一真相源，禁止静默修改；升级须新 bundle_version + 新 lock"
    "（Rule V2.1 另立）。LOCK 自 v2.0.1 起同时锚定 JS/Python **实现**哈希与构建产物哈希："
    "改任一实现文件必须重新封印（新 bundle_version + 新 lock + 同步 verify-immutable.js 的 ROOT_ANCHORS）。"
    "扩围 immutable_set（纳入新的运行期依赖文件）同样必须新 lock + 同步 ROOT_ANCHORS；bundle 字节不变时"
    "bundle_version 保持不变，扩围动作留痕于 lock_amendments。"
)

#: lock 版本号（结构性扩围 +1；变更需同步 verify-immutable.js 的期望条目数）
LOCK_REVISION = 2

#: lock 修订留痕（每次扩围/重新封印追加一条，不允许改写历史条目）
LOCK_AMENDMENTS = [
    {
        "at": "2026-09-14",
        "revision": 1,
        "action": "初始 v2.0.1 封印：bundle SHA + JS 实现 + Python 规则/候选/防守实现 + 构建产物",
        "reason": "PR #29 后冻结对象不再只是参数，还必须包含实现语义。",
    },
    {
        "at": "2026-09-14",
        "revision": 2,
        "action": "immutable_set 扩围：新增 [python_role_thresholds] ml/gen2/portfolio/role_thresholds.py",
        "reason": (
            "审查裁决：该模块直接定义线上阈值加载与校验（load_role_thresholds / "
            "validate_role_thresholds）；未锁定时，改它即可在 bundle 字节不变的前提下改变运行语义，"
            "形成旁路。迁移脚本 freeze-gen2-rule-bundle.py 不入锁（非运行时依赖）。"
        ),
        "bundle_bytes_changed": False,
        "bundle_version_changed": False,
    },
]

MIGRATION_NOTE = (
    "WP-G2-04（2026-09-14）：bundle_version 升为 gen2-rule-v2.0.1。selection 段新增显式 "
    "role_thresholds（= 旧 core_pct/challenger_pct/satellite_pct/top_quantile 的离线换算，语义等价），"
    "旧字段移入 legacy_migration_audit 且不再被任何运行路径读取。规则参数（alpha / regime / "
    "portfolio caps / defense / universe）一律未变。LOCK 同时锚定 JS/Python 实现与构建产物哈希。"
)


# ---------------------------------------------------------------- 工具

def normalized_sha256(path: Path) -> str:
    """冻结内容 sha256：先做 CRLF→LF 归一化（与 scripts/verify-immutable.js 同口径）。

    这样 lock 基准与平台 checkout 行尾无关（Windows worktree 是 CRLF，Linux CI 是 LF）；
    纯行尾差异不视为改动，真实内容差异仍必被抓。
    """
    text = path.read_bytes().decode("utf-8").replace("\r\n", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def derive_role_thresholds(sel: dict) -> dict:
    """旧字段 → 显式 role_thresholds（**逐式镜像** JS ``deriveRoleThresholdsFromLegacy``）。"""
    s = sel if isinstance(sel, dict) else {}
    tq = s.get("top_quantile")
    core_pct = 1.0 - (float(tq) if tq is not None else DEFAULT_LEGACY["top_quantile"])

    def _num(key: str) -> float:
        v = s.get(key)
        return float(v) if v is not None else DEFAULT_LEGACY[key]

    challenger_pct = _num("challenger_pct")
    satellite_pct = _num("satellite_pct")
    # 四舍五入到 1e-10：避免 1-(1-0.2)=0.19999999999999996 这类二进制噪声落进 bundle
    frac = lambda v: round((1.0 - v) * 1e10) / 1e10  # noqa: E731
    out = {
        "core_top_fraction": frac(core_pct),
        "challenger_top_fraction": frac(challenger_pct),
        "satellite_top_fraction": frac(satellite_pct),
    }
    validate_role_thresholds(out, "legacy 迁移派生 role_thresholds")
    return out


def validate_role_thresholds(rt: dict, label: str = "role_thresholds") -> dict:
    """与 JS ``validateTopFractions`` 同判：键齐全 + 0 < core <= challenger <= satellite < 1。"""
    keys = ("core_top_fraction", "challenger_top_fraction", "satellite_top_fraction")
    vals = {}
    for k in keys:
        v = rt.get(k) if isinstance(rt, dict) else None
        if v is None or isinstance(v, bool):
            raise ValueError(f"{label}.{k} 必须是有限数值，实际 {v!r}")
        try:
            vals[k] = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"{label}.{k} 必须是有限数值，实际 {v!r}") from None
    c, ch, sa = vals[keys[0]], vals[keys[1]], vals[keys[2]]
    if not (c > 0 and sa < 1) or not (c <= ch <= sa):
        raise ValueError(f"{label} 必须满足 0 < core <= challenger <= satellite < 1，实际 {c}/{ch}/{sa}")
    return vals


def _find_line(lines: list, predicate, start: int = 0) -> int:
    for i in range(start, len(lines)):
        if predicate(lines[i]):
            return i
    return -1


def wrap_block(key: str, value, *, trailing_comma: bool = False) -> str:
    """把 ``{key: value}`` 序列化成「顶层一行 + 2 空格缩进」的块文本（去掉外层 {} 行）。

    ``trailing_comma=True`` 时给末行补 ``,``（该键后面还有兄弟键时必须补）。
    """
    body = json.dumps({key: value}, ensure_ascii=False, indent=2).split("\n")
    assert body[0] == "{" and body[-1] == "}", body[:1] + body[-1:]
    inner = body[1:-1]
    if trailing_comma:
        inner[-1] = inner[-1] + ","
    return "\n".join(inner)


def splice_block(lines: list, open_pred, close_pred, new_block: str, label: str) -> list:
    """把 ``open_pred`` 命中的行到其后首个 ``close_pred`` 命中的行整块替换为 ``new_block``。"""
    i = _find_line(lines, open_pred)
    if i < 0:
        raise RuntimeError(f"未定位到 {label} 起始行（格式已变？请人工确认）")
    j = _find_line(lines, close_pred, i + 1)
    if j < 0:
        raise RuntimeError(f"未定位到 {label} 结束行（格式已变？请人工确认）")
    return lines[:i] + new_block.split("\n") + lines[j + 1:]


# ---------------------------------------------------------------- 迁移

def build_migrated_bundle_text() -> tuple[str, dict, dict]:
    """返回 (新文本, 旧对象, 新对象)。不写盘。"""
    raw = BUNDLE_PATH.read_bytes().decode("utf-8")
    old = json.loads(raw)
    old_sel = dict(old.get("selection") or {})

    if isinstance(old_sel.get("role_thresholds"), dict):
        existing = validate_role_thresholds(old_sel["role_thresholds"])
        derived = derive_role_thresholds(old_sel.get("legacy_migration_audit") or {})
        if existing != derived:
            raise RuntimeError(
                f"bundle 已含 role_thresholds={existing}，与按 legacy 重算的 {derived} 不一致；"
                "拒绝静默覆盖，请人工核对。")
        raise RuntimeError(
            "bundle 已迁移（selection.role_thresholds 已存在且自洽）。如需重新封印，请走新 bundle_version。")

    thresholds = derive_role_thresholds(old_sel)

    legacy_missing = [k for k in LEGACY_SELECTION_FIELDS if k not in old_sel]
    if legacy_missing:
        raise RuntimeError(
            f"旧 selection 缺字段 {legacy_missing}；迁移只接受**完整旧字段**的 bundle（拒绝猜测）。")

    audit = {k: old_sel[k] for k in LEGACY_SELECTION_FIELDS}
    audit.update({
        "status": "MIGRATION_AUDIT_ONLY",
        "note": (
            "WP-G2-04：旧字段一次性换算为 role_thresholds"
            "（core=1-top_quantile / challenger=1-challenger_pct / satellite=1-satellite_pct）。"
            "运行路径（Node main() / Python build_v2_roles）只读 selection.role_thresholds，"
            "本块仅为审计留痕。"),
    })

    new_sel = {
        "role_thresholds": thresholds,
        "promotion_persistence_days": old_sel["promotion_persistence_days"],
        "demotion_persistence_days": old_sel["demotion_persistence_days"],
        "max_core_count": old_sel["max_core_count"],
        "max_core_per_cluster": old_sel["max_core_per_cluster"],
        "min_replacement_edge": old_sel["min_replacement_edge"],
        "legacy_migration_audit": audit,
    }

    # ---- 文本 splice（保持其余字节逐位不变）----
    lines = raw.replace("\r\n", "\n").split("\n")

    ver_idx = _find_line(lines, lambda l: l.strip().startswith('"bundle_version"'))
    if ver_idx < 0:
        raise RuntimeError("未定位到 bundle_version 行")
    lines[ver_idx] = f'  "bundle_version": "{NEW_BUNDLE_VERSION}",'

    sel_block = wrap_block("selection", new_sel, trailing_comma=True)
    lines = splice_block(lines, lambda l: l.strip() == '"selection": {',
                         lambda l: l == "  },", sel_block, "selection")

    notes_block = wrap_block("notes", (old.get("notes") or []) + [MIGRATION_NOTE])
    lines = splice_block(lines, lambda l: l.strip() == '"notes": [',
                         lambda l: l == "  ]", notes_block, "notes")

    text = "\n".join(lines)
    new = json.loads(text)

    # ---- 安全断言：除三处意图修改外，其余字段必须完全相等 ----
    old_cmp = json.loads(json.dumps(old))
    new_cmp = json.loads(json.dumps(new))
    old_cmp.pop("bundle_version")
    new_cmp.pop("bundle_version")
    old_cmp["selection"] = None
    new_cmp["selection"] = None
    old_cmp["notes"] = None
    new_cmp["notes"] = None
    if old_cmp != new_cmp:
        diff = sorted(
            k for k in set(old_cmp) | set(new_cmp)
            if old_cmp.get(k) != new_cmp.get(k))
        raise RuntimeError(f"迁移越界：除 bundle_version/selection/notes 外还有字段被改动 {diff}")

    for k, v in (old.get("selection") or {}).items():
        if k in LEGACY_SELECTION_FIELDS:
            continue
        if new_sel.get(k) != v:
            raise RuntimeError(f"迁移丢失 selection.{k}：{v!r} → {new_sel.get(k)!r}")

    return text, old, new


def build_lock(new_bundle_text: str) -> dict:
    """构造新 lock（bundle 已写入磁盘后调用，保证哈希取的是落盘内容）。"""
    entries = []
    for eid, role, rel in IMMUTABLE_SET:
        p = ROOT / rel
        if not p.exists():
            raise RuntimeError(f"冻结集合文件缺失：{rel}")
        entries.append({"id": eid, "role": role, "file": rel, "sha256": normalized_sha256(p)})

    by_id = {e["id"]: e["sha256"] for e in entries}
    artifacts = []
    for aid, rel, mirror in BUILD_ARTIFACTS:
        artifacts.append({
            "id": aid,
            "file": rel,
            "must_equal": mirror,
            "sha256": by_id[mirror],
            "note": "构建产物必须与冻结源逐位一致（build-cloudfunctions 直接复制）；"
                    "由 scripts/verify-gen2-build-artifacts.js 校验。",
        })

    bundle_sha = by_id["bundle"]
    assert len(entries) == len(IMMUTABLE_SET), "冻结集合条目数与声明不一致"
    return {
        "engine_id": "gen2-rule-v2",
        "bundle_version": NEW_BUNDLE_VERSION,
        "bundle_sha256": bundle_sha,
        "sealed_at": SEALED_AT,
        "lock_revision": LOCK_REVISION,
        "rule": RULE_TEXT,
        "lock_amendments": LOCK_AMENDMENTS,
        "immutable_set": entries,
        "build_artifacts": artifacts,
    }


# ---------------------------------------------------------------- 校验

def rebuild_lock_only() -> int:
    """**只重建 lock**（bundle 字节不变）—— 用于 immutable_set 扩围。

    为什么需要独立入口：扩围（把新的运行期依赖文件纳入锁定）**不应**顺手改动规则。
    迁移入口 ``main()`` 见到「已迁移」会直接报错；本入口只重算哈希并追加 lock 元数据。

    前置断言（扩锁不得顺带改规则）：
      * bundle 已迁移（自带 ``selection.role_thresholds``，旧字段只在 ``legacy_migration_audit``）；
      * ``bundle_version`` 与已封印版本一致（扩锁不改版本号，bundle 字节也不变）。
    """
    print("== WP-G2-04：immutable_set 扩围，重建 lock（bundle 字节保持不变）==")
    before = normalized_sha256(BUNDLE_PATH)
    bundle = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))
    sel = bundle.get("selection") or {}

    if not isinstance(sel.get("role_thresholds"), dict):
        raise RuntimeError("bundle 尚未迁移（缺 selection.role_thresholds）；请先跑迁移入口")
    if bundle.get("bundle_version") != NEW_BUNDLE_VERSION:
        raise RuntimeError(
            f"bundle_version={bundle.get('bundle_version')!r} != {NEW_BUNDLE_VERSION!r}；"
            "扩围只允许在已封印版本上追加条目，不改变版本号")
    leaked = [k for k in LEGACY_SELECTION_FIELDS if k in sel]
    if leaked:
        raise RuntimeError(f"旧字段仍在运行 selection 段 {leaked}，拒绝扩锁")

    if LOCK_PATH.exists():
        old_lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
        print(f"  旧 lock : revision={old_lock.get('lock_revision', 1)}、"
              f"immutable_set={len(old_lock.get('immutable_set') or [])} 项")

    lock = build_lock(bundle["bundle_version"])
    LOCK_PATH.write_bytes((json.dumps(lock, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    after = normalized_sha256(BUNDLE_PATH)
    if before != after:
        raise RuntimeError("扩围过程中 bundle 字节发生变化（不允许）")
    print(f"  新 lock : revision={lock['lock_revision']}、"
          f"immutable_set={len(lock['immutable_set'])} 项 + 构建产物={len(lock['build_artifacts'])} 项")
    print(f"  扩围新增 : {[eid for eid, _, _ in IMMUTABLE_SET][-1]}（{IMMUTABLE_SET[-1][2]}）")
    print(f"  bundle   : 字节未变（sha256 {after}），bundle_version 保持 {lock['bundle_version']}")
    print("\n  下一步（必须）：把 verify-immutable.js 的 ROOT_ANCHORS 更新为下列值，否则它会拦下：")
    print_root_anchor()
    return check()


def check() -> int:
    """只读校验：lock ↔ 磁盘（含实现哈希与构建产物声明）。"""
    print("== WP-G2-04 冻结校验（lock ↔ 磁盘）==")
    if not LOCK_PATH.exists():
        print("  [FAIL] lock 文件不存在")
        return 1
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    failures = []

    bundle = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))
    ok = bundle.get("bundle_version") == lock.get("bundle_version")
    print(f"  [{'PASS' if ok else 'FAIL'}] bundle_version == lock.bundle_version"
          f"（{lock.get('bundle_version')}）")
    if not ok:
        failures.append("bundle_version")

    actual_bundle_sha = normalized_sha256(BUNDLE_PATH)
    ok = actual_bundle_sha == lock.get("bundle_sha256")
    detail = "" if ok else f"（lock {lock.get('bundle_sha256')} / actual {actual_bundle_sha}）"
    print(f"  [{'PASS' if ok else 'FAIL'}] bundle_sha256 == 磁盘实际{detail}")
    if not ok:
        failures.append("bundle_sha256")

    for e in lock.get("immutable_set") or []:
        p = ROOT / e["file"]
        if not p.exists():
            print(f"  [FAIL] {e['id']}：文件缺失 {e['file']}")
            failures.append(e["id"])
            continue
        actual = normalized_sha256(p)
        ok = actual == e["sha256"]
        print(f"  [{'PASS' if ok else 'FAIL'}] {e['id']} {e['file']}")
        if not ok:
            failures.append(e["id"])

    entries = lock.get("immutable_set") or []
    ok = len(entries) == len(IMMUTABLE_SET)
    print(f"  [{'PASS' if ok else 'FAIL'}] immutable_set 条目数 == {len(IMMUTABLE_SET)}"
          f"（实际 {len(entries)}；少条目也算未锁全）")
    if not ok:
        failures.append("immutable_set_count")
    locked_ids = sorted(e["id"] for e in entries)
    ok = locked_ids == sorted(eid for eid, _, _ in IMMUTABLE_SET)
    print(f"  [{'PASS' if ok else 'FAIL'}] immutable_set 条目 id 集合与声明一致（{locked_ids}）")
    if not ok:
        failures.append("immutable_set_ids")

    sel = bundle.get("selection") or {}
    has_rt = isinstance(sel.get("role_thresholds"), dict)
    print(f"  [{'PASS' if has_rt else 'FAIL'}] bundle.selection.role_thresholds 存在"
          f"（{json.dumps(sel.get('role_thresholds'), ensure_ascii=False) if has_rt else '缺失'}）")
    if not has_rt:
        failures.append("role_thresholds")
    leaked = [k for k in LEGACY_SELECTION_FIELDS if k in sel]
    print(f"  [{'PASS' if not leaked else 'FAIL'}] 旧字段已退出运行 selection 段"
          f"{'' if not leaked else f'（泄漏 {leaked}）'}")
    if leaked:
        failures.append("legacy_leak")

    print(f"\n=== 冻结校验：{'PASS' if not failures else 'FAIL ' + str(failures)} ===")
    return 1 if failures else 0


def print_root_anchor() -> int:
    if not LOCK_PATH.exists():
        print("lock 不存在", file=sys.stderr)
        return 1
    rel = "ml/gen2/manifests/GEN2_RULE_V2_LOCK.json"
    print(f"  {{ lock: '{rel}', sha256: '{normalized_sha256(LOCK_PATH)}' }},")
    return 0


# ---------------------------------------------------------------- 主流程

def main() -> int:
    ap = argparse.ArgumentParser(description="WP-G2-04：Gen-2 Rule V2 bundle/lock 离线迁移与重新冻结")
    ap.add_argument("--check", action="store_true", help="只读校验（lock ↔ 磁盘），不写任何文件")
    ap.add_argument("--dry-run", action="store_true", help="打印将写入的 bundle/lock，不落盘")
    ap.add_argument("--print-root-anchor", action="store_true", help="打印 verify-immutable.js ROOT_ANCHORS 行")
    ap.add_argument("--rebuild-lock", action="store_true",
                    help="只重建 lock（immutable_set 扩围用；bundle 字节不变、不改 bundle_version）")
    args = ap.parse_args()

    if args.check:
        return check()
    if args.print_root_anchor:
        return print_root_anchor()
    if args.rebuild_lock:
        return rebuild_lock_only()

    print("== WP-G2-04：离线迁移 selection.role_thresholds ==")
    text, old, new = build_migrated_bundle_text()
    old_sel = old["selection"]
    print(f"  bundle_version : {old['bundle_version']} → {new['bundle_version']}")
    print(f"  旧 selection   : {json.dumps({k: old_sel[k] for k in LEGACY_SELECTION_FIELDS}, ensure_ascii=False)}")
    print(f"  新 role_thresholds : {json.dumps(new['selection']['role_thresholds'], ensure_ascii=False)}"
          f"  → 派生切点 core_pct={1 - new['selection']['role_thresholds']['core_top_fraction']}")
    changed = [k for k in set(old) | set(new) if old.get(k) != new.get(k)]
    print(f"  变更字段       : {sorted(changed)}（其余字段逐位不变）")

    if args.dry_run:
        print("\n--- 新 bundle ---")
        print(text)
        return 0

    BUNDLE_PATH.write_bytes(text.encode("utf-8"))
    lock = build_lock(text)
    LOCK_PATH.write_bytes((json.dumps(lock, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(f"  已写入 {BUNDLE_PATH.relative_to(ROOT)}（sha256 {lock['bundle_sha256']}）")
    print(f"  已写入 {LOCK_PATH.relative_to(ROOT)}（{len(lock['immutable_set'])} 项实现 + "
          f"{len(lock['build_artifacts'])} 项构建产物）")
    print("\n  下一步（必须）：把 ROOT_ANCHORS 更新为下列值，否则 verify-immutable.js 会拦下：")
    print_root_anchor()
    return check()


if __name__ == "__main__":
    sys.exit(main())
