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

裁决（2026-09-14，第三次 · 复核结论）：本次产出**降级为「待合并冻结运行」**，不得先写成项目最终 Frozen B1 ——

  * 冻结 PR 先合并 → B1 PR 自动改基后合并 → 从**新的 master** 建 `chore/gen2-b1-accept-v201`，
    运行 `--accept-merge --master-commit <B1 合并提交完整 SHA>`，再开并合并**独立的接受记录 PR**；
    该 PR 合并后才可正式称「Frozen B1 已接受」，**此后才允许启动 B3**；
  * `--accept-merge` **会修改受版本控制的 manifest / 报告** ⇒ 它自身也必须走 PR（见 §12）；
  * 接受命令的**校验**（fail-closed）—— 第五次裁决修正后的**正确契约**：
    ⓪ **工作树干净**（接受时 + 取证时两态）；
    ① **执行提交** `source_state.git_head_commit` 是 `<B1 merge SHA>` 的**祖先**；
    ② 当前**锁定组件 / B1 工具链 / 输入摘要 / 输出摘要**与 manifest **逐项**逐位一致；
    ③ `<B1 merge SHA>` 的**树中包含**已承诺的**报告 / manifest / 审计快照**，且**哈希匹配**；
    ④ 另行记录 `accepted_master_commit` / `accepted_master_tree_sha` / `execution_source_tree_sha`。
    ⚠️ **不再要求** `accepted_master_tree_sha == execution_source_tree_sha`：报告 / manifest /
    审计快照是**执行之后**才提交进 B1 分支的 ⇒ 两个 tree **必然不同**。前者是「接受时仓库快照」、
    后者是「执行时语义源码快照」，两者的关联由 ② 的摘要族与 ③ 的已承诺证据哈希建立。
    （早期版本要求「整棵树相等」，那会**必然失败** —— 已废弃。）；
  * §9 归因页必须给出**可审计的数值对照表**（不只是方向）：按 0/5/10/20bps、逐策略列
    净值 / CAGR / Sharpe / 换手 / 成本与差异，并逐项标注 D-001 / F1-F2 / F4 / 统一账本的归因。
    口径严格限定为「**在 2026-09-11 审计基线与本次相同窗口/数据的对照中，F4 是唯一实质来源**」，
    **不**扩展为对所有历史结果的普遍因果结论。

运行::

    PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run
    PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --date 20260914 --run-id <id>
    # B1 PR 合并后：在独立分支建接受记录（四项校验全过才写入；不变则无需重跑）
    git switch -c chore/gen2-b1-accept-v201 origin/master
    PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --accept-merge --master-commit <sha>
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import platform
import re
import subprocess
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


#: 旧审计基线数值快照（**入库**证据）—— `outputs/` 未入库，故把旧基线读数逐行转写成
#: 本文件，使 §9 的数值对照表**从数据生成**而不是手工誊抄，且在任何机器上可复现。
AUDIT_BASELINE_REL = "ml/gen2/manifests/GEN2_B1_AUDIT_BASELINE_20260911.json"

#: 运行接受状态：`PENDING_MERGE`（合并前）→ `ACCEPTED`（写入接受记录后）。
STATUS_PENDING_MERGE = "PENDING_MERGE"
STATUS_ACCEPTED = "ACCEPTED"

#: fail-closed 中止码：**执行窗口内源被改动**（`HEAD` 移动 / 运行实现文件被改）。
#: 命中即本次运行**不予采信、作废**，也**不得**当作门禁证据 —— 它的读数无法归因到某一版源码。
STATUS_ABORTED_SOURCE_MUTATED = "ABORTED_SOURCE_MUTATED"

#: 接受记录必须落在这条**独立分支**（进而独立 PR）上 —— `accept_merge` 会修改**受版本控制**的
#: manifest / 报告，在受保护的 `master` 下不能「合并 B1 后直接在本地跑一下就完事」。
ACCEPT_BRANCH = "chore/gen2-b1-accept-v201"

#: `--accept-merge` 记录用的**信息性**基准引用（用于在记录里标注「`<SHA>` 是否已进入 master」）。
#: ⚠️ **不作为拒绝条件** —— 契约要求的祖先关系是「**执行提交**（`source_state.git_head_commit`）
#: 是 `<SHA>` 的祖先」，而不是「`<SHA>` 是某个 ref 的祖先」。见 `accept_merge` ①。
DEFAULT_MASTER_REF = "origin/master"

#: 四项已登记变更 → 快照 `code_state_timeline` 的键。`in_this_delta` 由
#: 「是否落在旧基线产出之前」推导（落在旧基线内 ⇒ 不构成本次 Δ 的来源，只能解释
#: 「旧基线与更早报告」的差异）。这是本次归因的**判定规则**，不是叙述。
REGISTERED_CHANGES = [
    {"id": "D-001", "timeline_key": "d001",
     "name": "规则实现修正：出口无条件终局约束检查",
     "mechanism": ("角色生成路径出口统一走 `finalizeRoles` / `finalize_roles`，**无条件**执行终局约束检查"
                   "（CORE 数量上限 / 每 cluster CORE 上限 / NO_CORE 不可恢复 / 单资产·cluster·科技·现金约束）；"
                   "此前「无 cap 降级现任且无替换」的交易日会**跳过**该检查。"),
     "metric_moved": "角色分布 / 降级日 → 换手、防守触发日、净值"},
    {"id": "F1/F2", "timeline_key": "f1f2",
     "name": "信号质量修复：Alpha 显式注入 + 角色阈值显式化",
     "mechanism": ("`build_v2_roles` 不再静默重算 Alpha（评分必须显式注入并带覆盖校验与内容哈希）；"
                   "`top_quantile` 改为显式 `role_thresholds`。"),
     "metric_moved": "修复前「声明了旋钮、组合指标却与 baseline 逐位相同」的假读数消失"},
    {"id": "F4", "timeline_key": "f4",
     "name": "统一候选组合（WP-G2-06）",
     "mechanism": ("`build_portfolio_candidates` 不再把 CORE 重置为等权 `1/n`、不再丢弃单只 / cluster / "
                   "广义科技上限；`priority` 改为显式注入的未四舍五入 selection score；候选新增现金腿与防守腿；"
                   "`main()` 接入唯一候选链路。"),
     "metric_moved": "候选权重语义（1/n 等权 → 权威 target_weight + 上限）→ 敞口、换手、费用、净值"},
    {"id": "统一账本", "timeline_key": "ledger_unified",
     "name": "唯一权威账本（WP-G2-02）",
     "mechanism": ("换手 = **单边成交名义额** `Σ_证券|Δ|`（更早的实现在现金腿**重复计费**，"
                   "最坏把换手与费用高估 2 倍）；公共日历强校验；T+1 执行 + 期初全现金。"),
     "metric_moved": "换手与费用口径（费用偏高 ⇒ 净收益偏低）"},
]


def load_audit_baseline(rel: str = AUDIT_BASELINE_REL) -> dict:
    """读取旧审计基线数值快照（入库证据）。"""
    return json.loads(_abs(rel).read_text(encoding="utf-8"))


def _norm_window(w: dict | None) -> dict | None:
    """把运行窗口归一成**可跨序列化比较**的形式（日期 → `YYYY-MM-DD` 字符串，天数 → int）。

    `ledger.assert_common_calendar` 返回的 `first_date` / `last_date` 是 **`date` / `Timestamp`
    对象**，而快照（JSON）里是字符串。不归一化就会出现「**看起来一样、比出来不等**」：
    同一个全窗口运行会被判成「不可对照」，进而把 §9 整页降级 —— 这是**假报警**，
    会让审阅者去查一个不存在的缺陷。本函数专门消除这类「同值不同型」的比较失败。
    """
    if w is None:
        return None
    out = {}
    for k in ("first_date", "last_date", "days"):
        v = w.get(k)
        if v is None:
            out[k] = None
        elif k == "days":
            out[k] = int(v)
        else:
            out[k] = str(v)[:10]
    return out


def build_attribution(summary: pd.DataFrame, audit: dict,
                      run_window: dict | None = None) -> dict:
    """生成结构化差异归因：数值对照（旧 vs 新，全成本档）+ 逐项变更判定 + 控制项。

    - `rows`：按 (strategy, cost_bps) 对齐，给出旧 / 新 / Δ（净值、累计收益、CAGR、Sharpe、
      MDD、换手、费用）—— **全部来自两边的 `ledger_summary` 数据**，不手工誊抄；
    - `changes`：四项已登记变更的 `in_this_delta` 判定 + 依据（取自快照的 commit 时间线）；
    - `controls`：可机检的控制项 —— 基准策略（main5 / universe / market_510300）的 Δ 必须**恒为 0**
      （它们不经过规则实现；若不为 0，说明账本或基准路径也变了）。

    **可对照性（`controls.comparable`）**：Δ 只有在**两侧窗口一致**时才可解释。快照记录的是
    全窗口读数；若本次运行为裁剪窗口（或成本档不同），逐格相减就是**拿两个不同问题相减**，
    会造成「基准策略 Δ ≠ 0 ⇒ 账本变了」的**假报警**。故此处显式判定并降级：
    `comparable=False` 时 `benchmark_bit_identical` 为 `None`（**不适用**），报告不得据此下结论。
    """
    metrics = ("terminal_nav", "cumulative_return", "cagr", "sharpe", "mdd",
               "total_turnover", "total_cost")
    old = {(r["strategy"], float(r["cost_bps"])): r for r in audit["rows"]}
    rows = []
    for _, r in summary.iterrows():
        key = (r["strategy"], float(r["cost_bps"]))
        o = old.get(key)
        new_vals = {k: float(r[k]) for k in metrics}
        old_vals = None if o is None else {k: float(o[k]) for k in metrics}
        rows.append({
            "strategy": r["strategy"], "cost_bps": float(r["cost_bps"]),
            "old": old_vals, "new": new_vals,
            "delta": None if old_vals is None
                     else {k: round(new_vals[k] - old_vals[k], 10) for k in metrics},
        })

    # ---- 可对照性判定：窗口 / 成本档 ----
    aw = audit.get("window") or {}
    audit_win = _norm_window({"first_date": aw.get("date_from"), "last_date": aw.get("date_to"),
                              "days": aw.get("days")})
    run_win = _norm_window(run_window)
    audit_costs = sorted({float(r["cost_bps"]) for r in audit["rows"]})
    run_costs = sorted({float(r["cost_bps"]) for r in rows})
    window_mismatch = None
    if run_win is None:
        # 未提供运行窗口 ⇒ **不判定为可对照**（fail-closed：宁可标「不适用」，也不假报逐位相同）
        window_mismatch = {"audit_baseline": audit_win, "run": None}
    elif run_win != audit_win:
        window_mismatch = {"audit_baseline": audit_win, "run": run_win}
    cost_mismatch = None if run_costs == audit_costs \
        else {"audit_baseline": audit_costs, "run": run_costs}
    # **只有窗口是硬条件**：窗口一致时，两侧同窗口的单元格 Δ 才可解释。
    # 成本档差异只意味着个别单元格缺席（表中显示 `—`），不影响已有单元格的 Δ 解释。
    comparable = window_mismatch is None

    tl = audit["code_state_timeline"]
    changes = []
    for c in REGISTERED_CHANGES:
        node = tl[c["timeline_key"]]
        in_baseline = bool(node["in_this_baseline"])
        entry = {
            "id": c["id"], "name": c["name"], "mechanism": c["mechanism"],
            "metric_moved": c["metric_moved"],
            "in_audit_baseline": in_baseline,
            "in_this_delta": not in_baseline,
            "evidence": {k: node[k] for k in ("commit", "commits", "at", "files", "file", "note")
                         if k in node},
        }
        if c["id"] == "F1/F2":
            # 落在旧基线之后，但默认配置与旧行为逐值等价 ⇒ 对默认跑法数值贡献为 0。
            entry["numeric_contribution"] = "none_by_default_equivalence"
        elif in_baseline:
            entry["numeric_contribution"] = "none_already_in_audit_baseline"
        else:
            entry["numeric_contribution"] = "material"
        changes.append(entry)

    benchmarks = {"main5_equal_weight", "universe_equal_weight", "market_510300"}
    bench_deltas = [abs(r["delta"]["cumulative_return"]) for r in rows
                    if r["delta"] is not None and r["strategy"] in benchmarks]
    bit_identical = (bool(bench_deltas) and max(bench_deltas) == 0.0) if comparable else None
    controls = {
        "comparable": comparable,
        "window_mismatch": window_mismatch,
        "cost_level_mismatch": cost_mismatch,
        "audit_baseline_window": audit_win,
        "run_window": run_win,
        "benchmark_strategies": sorted(benchmarks),
        "benchmark_max_abs_cum_return_delta": (max(bench_deltas) if bench_deltas else None)
        if comparable else None,
        "benchmark_bit_identical": bit_identical,
        "note": ("基准策略不经过规则实现 ⇒ 其 Δ 必须恰为 0；为 0 同时证明**账本契约与基准路径未变**"
                 "（即「统一账本」不构成本次 Δ 的来源）。"
                 if comparable else
                 "**不适用**：本次运行与旧基线快照的**窗口**不一致，逐格相减没有意义 —— "
                 "只有与快照同窗口的运行才可据此判定基准路径是否变化。"),
    }
    return {
        "audit_baseline": {
            "run_id": audit["run_id"],
            "snapshot_file": AUDIT_BASELINE_REL,
            "snapshot_sha256": _sha(AUDIT_BASELINE_REL),
            "captured_from": audit["captured_from"],
            "captured_from_sha256": audit["captured_from_sha256"],
            "window": audit["window"],
            "cost_levels": audit_costs,
            "code_state_timeline": audit["code_state_timeline"],
            "measured_mechanism": audit.get("measured_mechanism"),
        },
        "changes": changes,
        "controls": controls,
        "rows": rows,
    }


def _gross_and_cost_split(attribution: dict) -> list[dict]:
    """把每个策略的 Δ 拆成「毛收益效应」（0bps 的 Δ）与「成本拖累变化」（同档成本拖累之差）。

    净值口径恒等式：累计收益 ≈ 毛收益 − 成本拖累，故
    `Δ(0bps)` 纯净地反映**持仓/权重路径**差异，`Δ(10bps) − Δ(0bps)` 反映**费用**差异。
    """
    def find(strategy, bps):
        for r in attribution["rows"]:
            if r["strategy"] == strategy and abs(r["cost_bps"] - bps) < 1e-9:
                return r
        return None

    out = []
    strategies = sorted({r["strategy"] for r in attribution["rows"]},
                        key=lambda s: (0 if s.startswith("gen2_") else 1, s))
    for strat in strategies:
        r0, r10 = find(strat, 0.0), find(strat, 10.0)
        if not r0 or not r10 or r0["old"] is None:
            continue
        old_drag = r0["old"]["cumulative_return"] - r10["old"]["cumulative_return"]
        new_drag = r0["new"]["cumulative_return"] - r10["new"]["cumulative_return"]
        out.append({
            "strategy": strat,
            "gross_effect_0bps": r0["delta"]["cumulative_return"],
            "old_cost_drag_10bps": old_drag,
            "new_cost_drag_10bps": new_drag,
            "cost_drag_relief": old_drag - new_drag,
            "net_effect_10bps": r10["delta"]["cumulative_return"],
        })
    return out


def _git(*args: str) -> str | None:
    """运行 git（仓库根目录），失败返回 None（不抛 —— 接受记录在无 git 环境也应可诊断）。"""
    try:
        r = subprocess.run(["git", *args], cwd=str(PROJECT_ROOT), capture_output=True,
                           text=True, check=False)
    except OSError:
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def _git_run(*args: str):
    """运行 git 并返回 `CompletedProcess` —— 供需要**退出码**的判定使用
    （如 `merge-base --is-ancestor`：祖先成立时返回 0、不成立返回 1，stdout 为空）。
    无法执行 git 时返回 `None`。"""
    try:
        return subprocess.run(["git", *args], cwd=str(PROJECT_ROOT),
                              capture_output=True, text=True, check=False)
    except OSError:
        return None


def _git_blob_bytes(commit: str, path: str) -> bytes | None:
    """取 `<commit>:<path>` 的 blob **原始字节**（不经 working-tree 的换行转换）。

    用 `git cat-file blob` 而非 `git show`：前者对 blob 是**逐字节直出**，不受
    `core.autocrlf` / smudge filter 影响，与磁盘侧 `normalized_sha256`（CRLF→LF 归一化）
    配合即可得到同口径哈希。blob 不存在返回 `None`。
    """
    try:
        r = subprocess.run(["git", "cat-file", "blob", "%s:%s" % (commit, path)],
                           cwd=str(PROJECT_ROOT), capture_output=True, check=False)
    except OSError:
        return None
    return r.stdout if r.returncode == 0 else None


def _git_blob_sha256(commit: str, path: str) -> str | None:
    """`<commit>:<path>` 的内容 sha256（CRLF→LF 归一化，与 `normalized_sha256` 同口径）。

    用于「**已承诺证据**是否真的在合并提交的树里」：拿 **提交里的 blob** 算哈希，
    而不是拿磁盘当前文件算 —— 后者只能证明「本地是这样」，证明不了「合并进去的是这样」。
    """
    data = _git_blob_bytes(commit, path)
    if data is None:
        return None
    try:
        text = data.decode("utf-8").replace("\r\n", "\n")
    except UnicodeDecodeError:
        return None
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def source_state() -> dict:
    """记录**源树状态**：本次取证所依据的 git 提交与其 **tree 对象 sha**。

    语义（第五次裁决修正）：`source_tree_sha` 是「**执行时**语义源码快照」，不是「接受时仓库快照」。
    接受记录**不要求**它等于 `<B1 merge SHA>^{tree}` —— 报告 / manifest / 审计快照是**执行之后**
    才被提交进 B1 分支的，两者**必然不同**。它们之间的关联由「组件 / 工具链 / 输入 / 输出摘要 +
    已承诺证据哈希」建立（见 `accept_merge`）。

    它真正承重的两件事：① `git_head_commit` 必须是 `<B1 merge SHA>` 的**祖先**
    （证明「接受的就是这次执行所依据的源码」）；② 幂等绑定 —— 同一次运行不因本命令被重复执行而失真。

    若 `working_tree_dirty` 为 true，说明取证时磁盘上存在**未提交的受控改动** ⇒
    `source_tree_sha` / 组件哈希不代表实际参与运行的字节 ⇒ `accept_merge` 会**拒绝**绑定
    （须先提交再重跑）。未跟踪文件（`??`）不算 —— 它们不进入任何提交的 tree。
    """
    head = _git("rev-parse", "HEAD")
    tree = _git("rev-parse", "HEAD^{tree}")
    # 必须用**未 strip** 的 stdout：`_git()` 会 `.strip()` 整个输出，把**首行**的
    # 前导空格吃掉 ⇒ `l[3:]` 会多切一个字符，把 `ml/gen2/...` 变成 `l/gen2/...`。
    # 这段文本是要进审计记录的，路径被截断本身就是「假信号」。
    por = _git_run("status", "--porcelain", "--untracked-files=no")
    dirty_tracked = []
    if por is not None and por.returncode == 0:
        for l in (por.stdout or "").splitlines():
            if len(l) < 4 or not l[:2].strip() or l.startswith("??"):
                continue          # 空行 / 非变更行 / 未跟踪（不进入任何提交的 tree）
            dirty_tracked.append(l[3:].strip())
    dirty_tracked = sorted(dirty_tracked)
    return {
        "git_head_commit": head,
        "source_tree_sha": tree,
        "working_tree_dirty": bool(dirty_tracked),
        "dirty_tracked_paths": dirty_tracked[:20],
        "note": ("`source_tree_sha` = **执行时**语义源码快照（`HEAD^{tree}`）。接受记录**不要求**它等于"
                 "`<B1 merge SHA>^{tree}`（产物在执行后才提交 ⇒ 必然不同）；承重的是"
                 "「`git_head_commit` 是 `<B1 merge SHA>` 的祖先」+ 组件 / 产物摘要一致。"
                 "`working_tree_dirty=true` 时哈希不代表实际参与运行的字节，接受时会拒绝绑定。"
                 "未跟踪文件不影响 tree。"),
    }


def source_mutation_report(baseline: dict, impl: list[dict]) -> dict:
    """重放「**执行窗口内源是否被改动**」的判定（fail-closed）。

    只看两样东西：① `HEAD` 提交是否还在原地；② `run_implementation` 每个文件的**当前**哈希是否
    仍等于取证时的值。

    **不能**顺手看 `git status` 是否脏 —— `run()` 自己就会写**受版本控制**的 manifest / 报告，
    那不算「源被改动」，拿脏树判定会**恒真**。要抓的正是「跑到一半有人提交/改文件」这种
    「读数与源码对不上」的情形（本轮门禁首跑 44/45 就是它）。

    命中 ⇒ `run_status = ABORTED_SOURCE_MUTATED`：该次运行**不予采信**，不是「假失败」，
    而是**正确的 fail-closed 中止**，不得当作门禁证据。
    """
    head_now = _git("rev-parse", "HEAD")
    modified = []
    if head_now != baseline.get("git_head_commit"):
        modified.append({"kind": "head_moved",
                         "at_attestation": baseline.get("git_head_commit"), "now": head_now})
    for e in impl:
        now = _sha(e["file"])
        if now != e["sha256"]:
            modified.append({"kind": "file_changed", "id": e["id"], "file": e["file"],
                             "at_attestation": e["sha256"], "now": now})
    return {
        "mutated": bool(modified),
        "status_if_mutated": STATUS_ABORTED_SOURCE_MUTATED,
        "head_at_attestation": baseline.get("git_head_commit"),
        "head_now": head_now,
        "modified": modified,
    }


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

def verify_manifest(m: dict, *, skip_report: bool = False) -> dict:
    """对 manifest 里声明的每一类哈希**重新计算**并比对（fail-closed 自校验）。

    `skip_report=True` 用于**报告写出之前**的自校验：报告尚未落盘，其自身哈希只能事后校验。
    报告 §8 展示的就是这一次（不含报告自身）的结果；完整结果（含报告哈希）写入
    `manifest["self_check"]`，`all_pass=False` 时本入口抛 `FrozenAttestationError` 拒绝产出交付物。
    """
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
    if rep and not skip_report:
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
    src = source_state()

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

    # ⑨ 差异归因（旧审计基线 vs 本次运行）：数值对照从**两边的 ledger_summary 数据**生成。
    #    必须带上本次窗口 —— Δ 只有在两侧窗口/成本档一致时才可解释（否则是拿两个不同问题相减）。
    attribution = build_attribution(summary, load_audit_baseline(),
                                    run_window=verification["calendar"])

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
        "run_status": STATUS_PENDING_MERGE,
        "run_status_note": (
            "**待合并冻结运行**：本运行已完成全部取证，但在「冻结 PR + B1 PR 合并 → 独立分支 "
            "`%s` 写入接受记录 → 该接受记录 PR 合并」完成之前，"
            "**不得**表述为项目最终 Frozen B1，也不得据此启动 B3。"
            % ACCEPT_BRANCH),
        "source_state": src,
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
        "attribution": attribution,
        "run_dir": _rel(out_dir),
        "committed_manifest": committed_manifest_rel,
        "report": committed_report_rel,
    }

    man_out = (Path(manifest_path) if manifest_path is not None
               else (GEN2_ROOT / "manifests" / f"GEN2_B1_FROZEN_RUN_MANIFEST_{date_tag}.json")
               if write_committed_manifest else out_dir / "frozen_manifest.json")

    # ---- 阶段 1：写 manifest（此时尚无 outputs / self_check）----
    _write_manifest(manifest, out_dir, man_out)

    # ---- 阶段 1.5：**执行窗口内源是否被改动**（fail-closed 中止，先于任何哈希自校验）----
    #   必须排在自校验之前：源被改动时 `verify_manifest` 也会失配，但那样只会给出泛化的
    #   「哈希不一致」，掩盖真实原因。这里给出**专属中止码** `ABORTED_SOURCE_MUTATED`，
    #   并把证据写进 manifest —— 该次运行**不予采信**，不得当作门禁证据（要重跑）。
    mutation = source_mutation_report(src, impl)
    manifest["source_mutation_check"] = mutation
    if mutation["mutated"]:
        manifest["run_status"] = STATUS_ABORTED_SOURCE_MUTATED
        manifest["run_status_note"] = (
            "**已中止（源在执行窗口内被改动）**：%s。本次读数无法归因到某一版源码 ⇒ "
            "**不予采信**，也不得当作门禁证据；请在**静止**的源码上重跑。"
            % (", ".join("%s(%s)" % (x["kind"], x.get("file") or x.get("now"))
                         for x in mutation["modified"]) or "未知"))
        _write_manifest(manifest, out_dir, man_out)
        raise FrozenAttestationError(
            "拒绝产出交付物：%s —— 执行窗口内源被改动（%s）。"
            "这不是「假失败」，是正确的 fail-closed 中止；请在源静止后重跑 B1。"
            % (STATUS_ABORTED_SOURCE_MUTATED,
               json.dumps(mutation["modified"], ensure_ascii=False)))

    # ---- 阶段 2：报告写出前的自校验（不含报告自身哈希）—— 报告据此**如实**展示，
    #      避免「报告先于自校验写出」导致 §8 恒报「0/0 ❌」的假阴性 ----
    manifest["self_check_pre_report"] = verify_manifest(manifest, skip_report=True)
    if not manifest["self_check_pre_report"]["all_pass"]:
        raise FrozenAttestationError(
            "报告写出前自校验失败（哈希不一致）："
            + json.dumps(manifest["self_check_pre_report"]["detail"], ensure_ascii=False))

    reps.mkdir(parents=True, exist_ok=True)
    report = reps / f"gen2_b1_frozen_run_{date_tag}.md"
    report.write_text(_render_report(manifest, summary, bundle), encoding="utf-8")

    # ---- 阶段 3：记录输出报告哈希并做**完整**自校验，再重写 manifest（报告不含自身哈希 → 稳定）----
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


def _evidence_row(commit: str, path: str, *, role: str, expected: str | None) -> dict:
    """核一条「已承诺证据」：`path` 是否**存在于 `commit` 的树里**，且其 **blob** 哈希匹配期望值。"""
    blob = _git_blob_sha256(commit, path)
    return {
        "role": role,
        "path": path,
        "present_in_merge_tree": blob is not None,
        "blob_sha256": blob,
        "expected_sha256": expected,
        "matches": bool(blob) and bool(expected) and blob == expected,
    }


def committed_evidence(commit: str, m: dict, manifest_path: str | Path, *,
                       already: bool, report_expected: str | None) -> list[dict]:
    """核对「**执行之后**才提交进 B1 分支」的三份产物是否真的在 `commit` 的树里，且哈希匹配。

    这三份产物正是「`execution_source_tree_sha` 与 `accepted_master_tree_sha` 必然不同」的原因，
    也**是**两者的关联 —— 所以必须拿**提交里的 blob** 算哈希（`git cat-file blob`），
    而不是拿磁盘上的文件算：后者只能证明「本地是这样」，证明不了「合并进去的是这样」。

    期望值来源（都是**已被承诺**的值，不是新约定）：
      * `run_report`     ← manifest `outputs.committed_report.sha256`（复跑时回退到首次接受承诺值）；
      * `run_manifest`   ← 自引用（manifest 记不了自身哈希）⇒ 由**接受记录**承诺
        `accepted_manifest_input_sha256`，复跑时以它为准；
      * `audit_baseline` ← manifest `attribution.audit_baseline.snapshot_sha256`（归因所依据的
        入库快照，§9 数值对照表的来源）。
    """
    man = Path(manifest_path)
    attr = ((m.get("attribution") or {}).get("audit_baseline") or {})
    rep_rel = _rel(_abs(((m.get("outputs") or {}).get("committed_report") or {}).get("file")
                        or m["report"]))
    man_rel = _rel(man)
    man_expected = (((m.get("acceptance_record") or {}).get("accepted_manifest_input_sha256"))
                    if already else _sha(man))
    return [
        _evidence_row(commit, rep_rel, role="run_report", expected=report_expected),
        _evidence_row(commit, man_rel, role="run_manifest", expected=man_expected),
        _evidence_row(commit, attr.get("snapshot_file") or AUDIT_BASELINE_REL,
                      role="audit_baseline", expected=attr.get("snapshot_sha256")),
    ]


def accept_merge(master_commit: str,
                 manifest_path: str | Path | None = None,
                 report_path: str | Path | None = None,
                 source_tree_sha: str | None = None,
                 master_ref: str = DEFAULT_MASTER_REF) -> dict:
    """把本次冻结运行的摘要**绑定到 B1 合并提交**，写入接受记录（`ACCEPTED`）。

    **这条命令会修改受版本控制的 manifest / 报告** ⇒ 在受保护的 `master` 下，它**不是**
    「B1 合并后跑一下就算完成」的动作，而必须落在**独立的接受记录 PR**
    （分支约定 `chore/gen2-b1-accept-v201`）里评审、合并；该 PR 合并后才可正式称为
    「Frozen B1 已接受」，也才允许启动 B3 Frozen OOS。

    **契约（第五次裁决修正 · fail-closed，任一不过即拒绝写入；即报告 §12 的顺序）**：

    ⓪ **工作树干净**（两态）：接受时 `git status` 无受控改动；且 manifest 记录的**取证时**
       `working_tree_dirty=false`。任一为脏 ⇒ 磁盘字节与提交字节无法对应，下面的哈希校验失去意义。

    ① **执行提交是 `<SHA>` 的祖先**：`source_state.git_head_commit` 必须是 `master_commit`
       的祖先 —— 这证明「接受的就是这次执行所依据的那份源码」。它**取代**了早期版本里那条
       「`<SHA>^{tree}` 严格等于 `source_tree_sha`」的要求（见下）。

    ② **摘要逐位一致**：当前**锁定组件**（lock 文件 + `immutable_set` 逐项 + 折叠摘要）、
       **B1 工具链**（`run_implementation` 逐项 + 折叠摘要）、**输入摘要**（逐码行情 + 元数据 +
       内容折叠摘要）、**输出摘要**（运行目录产物 + 报告）与 manifest **逐项**一致。
       不只比折叠摘要 —— 逐项才能把「**哪一条锁定路径**变了」直接指出来。

    ③ **`<SHA>` 的树中包含已承诺证据且哈希匹配**：报告 / manifest / 审计快照三个文件必须
       **存在于 `master_commit` 的树里**（拿**提交里的 blob** 算哈希，不是拿磁盘文件算），
       且分别匹配：报告 ← manifest 承诺的 `outputs.committed_report.sha256`；
       manifest ← 接受时所依据的那份 manifest 字节的哈希（自引用，故由本记录承诺）；
       审计快照 ← manifest `attribution.audit_baseline.snapshot_sha256`。

    ④ **另行记录**（不是相等要求）：
       `accepted_master_commit` / `accepted_master_tree_sha`（**接受时仓库快照**）/
       `execution_source_tree_sha`（**执行时语义源码快照**）。
       ⚠️ **不再要求** `accepted_master_tree_sha == execution_source_tree_sha`：
       报告 / manifest / 审计快照是**执行之后**才提交进 B1 分支的 ⇒ 两个 tree **必然不同**。
       把「执行时源码树」当成「接受时仓库树」来强校验，会**必然失败**（早期设计的缺陷）。
       两者的关联由 ② 的摘要族与 ③ 的已承诺证据哈希建立 —— 这才是可机器校验的绑定。

    全过 ⇒ 才写 `acceptance_record`，`run_status = ACCEPTED`，报告措辞改「Frozen B1 已接受」。
    这一步落实的正是「**内容哈希不变则无需重跑**」—— 该前提是被**校验**的，不是被约定的。
    """
    man = Path(manifest_path) if manifest_path else \
        (GEN2_ROOT / "manifests" / "GEN2_B1_FROZEN_RUN_MANIFEST_20260914.json")
    m = json.loads(man.read_text(encoding="utf-8"))

    already = m.get("run_status") == STATUS_ACCEPTED
    prev_rec = m.get("acceptance_record") or {}
    rep_obj = (m.get("outputs") or {}).get("committed_report") or {}
    rep_now_path = _abs(rep_obj.get("file") or m["report"])
    # 报告期望值：**首跑**时磁盘报告就是被承诺的那份（= manifest 记录的哈希）；**复跑**时磁盘报告
    # 已被本命令改写成「已接受」版本 ⇒ 期望值回退到**首次接受**时承诺的哈希（见校验 ③）。
    rep_expected = (rep_obj.get("sha256") if not already
                    else (prev_rec.get("bound_digests") or {}).get("committed_report_sha256"))

    # ---- 校验 ⓪：工作树干净（接受时 + 取证时，两态都要）----
    #   接受时的脏树会让「磁盘字节」与「提交字节」脱钩；取证时的脏树会让组件哈希失去意义。
    now_state = source_state()
    if now_state["working_tree_dirty"]:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：**当前工作树脏**（未提交的受控改动：%s）⇒ 磁盘字节与 `<SHA>` "
            "树中的字节无法对应，摘要校验失去意义。请先提交 / 清理工作树，再运行接受命令。"
            % (", ".join(now_state["dirty_tracked_paths"] or []) or "未识别"))

    ss = m.get("source_state") or {}
    execution_head_declared = ss.get("git_head_commit")
    execution_tree = ss.get("source_tree_sha")
    if not execution_tree or not execution_head_declared:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：manifest 未记录 `source_state.git_head_commit` / "
            "`source_tree_sha`（取证版本过旧）⇒ 无法证明「接受的是哪次执行的源码」⇒ 必须重跑 B1。")
    if source_tree_sha and source_tree_sha != execution_tree:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：`--source-tree-sha` 与 manifest 记录的 `source_tree_sha` 不一致。")
    if ss.get("working_tree_dirty"):
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：**取证时** `working_tree_dirty=true`（未提交的受控改动：%s）"
            "⇒ 组件 / 工具链哈希不代表实际参与运行的字节。请先提交，再**重跑 B1**。"
            % (", ".join(ss.get("dirty_tracked_paths") or []) or "未识别"))

    # ---- 校验 ①：**执行提交**必须是 `<SHA>` 的祖先（证明「接受的就是这次执行所依据的源码」）----
    #   注意方向：是「执行提交 → `<SHA>`」，不是「`<SHA>` → origin/master」。前者才是可校验的绑定。
    resolved_master = _git("rev-parse", master_commit)
    if not resolved_master:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：`%s` 在本地不可解析（不是本仓库的提交）。" % master_commit)
    execution_head = _git("rev-parse", execution_head_declared) or execution_head_declared
    anc = _git_run("merge-base", "--is-ancestor", execution_head, resolved_master)
    if anc is None:
        raise FrozenAttestationError("接受记录**拒绝**写入：无法执行 git（仓库不可用）。")
    if anc.returncode != 0:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：**执行提交** `%s` **不是** `%s` 的祖先 ⇒ 无法证明 `<SHA>` 包含"
            "本次执行所依据的源码（B1 PR 未合并 / 传错提交 / 分支被重写？）。"
            "请传入 B1 PR 合并进 `master` 之后的那次提交。"
            % (execution_head, resolved_master))
    master_tree = _git("rev-parse", "%s^{tree}" % resolved_master)
    if not master_tree:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：无法解析 `%s^{tree}`。" % resolved_master)

    # ---- 校验 ②：锁定组件 / B1 工具链 / 输入 / 输出摘要**逐项**逐位一致 ----
    declared: dict = {}
    recomputed: dict = {}

    def _cmp(key: str, expected, actual) -> None:
        declared[key] = expected
        recomputed[key] = actual

    fi = m["frozen_input"]
    _cmp("lock.lock_sha256", fi["lock"]["lock_sha256"], _sha(fi["lock"]["lock_file"]))
    for e in fi["immutable_set"]:
        _cmp("lock.component[%s]" % e["id"], e["actual"], _sha(e["file"]))
    _cmp("lock.component_digest", fi["lock_component_digest"],
         _aggregate_digest([(e["id"], _sha(e["file"]) or "") for e in fi["immutable_set"]]))

    for e in m["run_implementation"]:
        _cmp("toolchain[%s]" % e["id"], e["sha256"], _sha(e["file"]))
    _cmp("toolchain.digest",
         _aggregate_digest([(e["id"], e["sha256"]) for e in m["run_implementation"]]),
         _aggregate_digest([(e["id"], _sha(e["file"]) or "") for e in m["run_implementation"]]))

    for f in m["input_data"]["files"]:
        _cmp("input.daily[%s]" % f["code"], f["sha256"], _sha(f["file"]))
    for e in m["input_data"]["meta_files"]:
        _cmp("input.meta[%s]" % e["id"], e["sha256"], _sha(e["file"]))
    _cmp("input.content_digest", m["input_data"]["content_digest"],
         _aggregate_digest([("daily:%s" % f["code"], _sha(f["file"]) or "")
                            for f in m["input_data"]["files"]]
                           + [("meta:%s" % e["id"], _sha(e["file"]) or "")
                              for e in m["input_data"]["meta_files"]]))

    for a in m["artifacts"]:
        _cmp("output[%s]" % a["file"], a["sha256"], _sha(_join_run_dir(m, a)))
    if rep_expected and not already:
        _cmp("output[committed_report]", rep_expected, _sha(rep_now_path))

    diffs = {k: {"declared": declared[k], "recomputed": recomputed[k]}
             for k in declared if declared[k] != recomputed[k]}
    if diffs:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：锁定组件 / 工具链 / 输入 / 输出摘要与 B1 manifest 不一致 "
            "⇒ 必须重跑 B1。逐项差异：" + json.dumps(diffs, ensure_ascii=False))

    # ---- 校验 ③：`<SHA>` 的**树中**必须包含已承诺证据，且哈希匹配 ----
    evidence = committed_evidence(resolved_master, m, man,
                                  already=already, report_expected=rep_expected)
    bad_evidence = [e for e in evidence if not (e["present_in_merge_tree"] and e["matches"])]
    if bad_evidence:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：`%s` 的树中未包含已承诺证据，或哈希不匹配 ⇒ 合并进去的不是本次"
            "运行承诺的那份产物（报告 / manifest / 审计快照）。明细：%s"
            % (resolved_master, json.dumps(bad_evidence, ensure_ascii=False)))

    # ---- 记录 ④：三项 SHA（accepted master commit / accepted master tree / execution source tree）
    #      + 信息性 master-ref 可达性（**不作拒绝条件**）----
    reach = None
    if _git("rev-parse", "--verify", "--quiet", master_ref):
        rr = _git_run("merge-base", "--is-ancestor", resolved_master, master_ref)
        reach = (rr.returncode == 0) if rr is not None else None

    m["acceptance_record"] = {
        "status": STATUS_ACCEPTED,
        "accepted_master_commit": resolved_master,
        "accepted_master_commit_input": master_commit,
        "accepted_master_tree_sha": master_tree,
        "execution_head_commit": execution_head,
        "execution_source_tree_sha": execution_tree,
        "execution_head_is_ancestor_of_accepted_master_commit": True,
        "trees_required_to_be_equal": False,
        "tree_relation": "accepted_master_tree_contains_committed_evidence",
        "tree_relation_note": (
            "`accepted_master_tree_sha` = **接受时仓库快照**，`execution_source_tree_sha` = "
            "**执行时语义源码快照**。报告 / manifest / 审计快照是**执行之后**才被提交进 B1 分支的 "
            "⇒ 两者**应当不同**；**不要求相等**。二者的关联由校验 ② 的摘要族与校验 ③ 的"
            "已承诺证据哈希建立。"),
        "accepted_manifest_input_sha256": _sha(man),
        "committed_evidence": evidence,
        "master_ref": master_ref,
        "master_ref_is_blocking": False,
        "accepted_master_commit_reachable_from_master_ref": reach,
        "accepted_at": pd.Timestamp.now("UTC").isoformat(),
        "digests_unchanged": True,
        "no_rerun_required": True,
        "verifications": [
            {"check": "working_tree_clean_at_accept", "ok": True,
             "dirty_tracked_paths": now_state["dirty_tracked_paths"]},
            {"check": "working_tree_clean_at_attestation", "ok": True,
             "dirty_tracked_paths": ss.get("dirty_tracked_paths") or []},
            {"check": "execution_head_is_ancestor_of_accepted_master_commit",
             "execution_head_commit": execution_head,
             "accepted_master_commit": resolved_master, "ok": True},
            {"check": "digests_unchanged", "compared_items": sorted(declared), "ok": True},
            {"check": "accepted_master_tree_contains_committed_evidence",
             "committed_evidence": evidence, "ok": True},
        ],
        "bound_digests": {
            "lock_sha256": declared["lock.lock_sha256"],
            "lock_component_digest": declared["lock.component_digest"],
            "toolchain_digest": declared["toolchain.digest"],
            "input_content_digest": declared["input.content_digest"],
            "committed_report_sha256": rep_expected,
            "accepted_manifest_input_sha256": _sha(man),
            "audit_baseline_sha256": next((e["expected_sha256"] for e in evidence
                                           if e["role"] == "audit_baseline"), None),
            "run_dir_artifacts": {a["file"]: a["sha256"] for a in m["artifacts"]},
        },
        "acceptance_branch": ACCEPT_BRANCH,
        "landed_via_pull_request_required": True,
        "note": ("本记录由 `--accept-merge` 写出，**会修改受版本控制的 manifest / 报告** ⇒ "
                 "必须落在独立分支 `%s` 的**接受记录 PR** 上评审合并。该 PR 合并**之前**，本产出的"
                 "措辞**仍不得**称为「Frozen B1 已接受」，也不得启动 B3。"
                 "四项校验全过（⓪ 工作树干净（接受 + 取证两态）/ ① 执行提交 `%s` 是 `%s` 的祖先 / "
                 "② 锁定组件·工具链·输入·输出摘要**逐项**一致 / ③ `<SHA>` 树含报告·manifest·"
                 "审计快照且哈希匹配）⇒ **无需重跑**，只做绑定。⚠️ **不要求** "
                 "`accepted_master_tree_sha == execution_source_tree_sha`（产物在执行后才提交 ⇒ "
                 "必然不同；二者的关联由摘要族 + 已承诺证据哈希建立）。"
                 % (ACCEPT_BRANCH, (execution_head or "")[:12], (resolved_master or "")[:12])),
    }
    m["run_status"] = STATUS_ACCEPTED
    m.pop("run_status_note", None)

    out_dir = _abs(m["run_dir"])
    rep = Path(report_path) if report_path else _abs(
        ((m.get("outputs") or {}).get("committed_report") or {}).get("file") or m["report"])
    summary = pd.read_csv(out_dir / "ledger_summary.csv")
    bundle = json.loads(_abs(BUNDLE_REL).read_text(encoding="utf-8"))
    rep.write_text(_render_report(m, summary, bundle), encoding="utf-8")

    m.setdefault("outputs", {})["committed_report"] = {
        "file": _rel(rep), "exists": rep.is_file(),
        "sha256": _sha(rep), "bytes": rep.stat().st_size if rep.is_file() else None,
    }
    m["self_check"] = verify_manifest(m)
    if not m["self_check"]["all_pass"]:
        raise FrozenAttestationError(
            "接受记录写入后自校验失败："
            + json.dumps(m["self_check"]["detail"], ensure_ascii=False))
    _write_manifest(m, out_dir, man)
    return m


def _render_report(m: dict, summary: pd.DataFrame, bundle: dict) -> str:
    a = m["acceptance"]
    cal = m["window"]["calendar"]
    att = m["attribution"]
    accepted = m.get("run_status") == STATUS_ACCEPTED
    lines = [
        "# Gen-2 B1 冻结运行报告（Frozen Run）· %s" % ("已接受" if accepted else "待合并"),
        "",
        "**运行状态**：%s" % ("**Frozen B1 已接受**" if accepted
                          else "**待合并冻结运行**（PENDING-MERGE FROZEN RUN）"),
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
    ]
    if accepted:
        lines += [
            "> **状态口径**：接受记录已写入 manifest（`acceptance_record.accepted_master_commit` /",
            "> `source_tree_sha`），本次产出的正确表述是「**Frozen B1 已接受**」。",
            "> 三类摘要未变 ⇒ 无需重跑；**此时才允许启动 B3 Frozen OOS**（B3 本身仍不得据此提升 authority）。",
            ">",
        ]
    else:
        lines += [
            "> **状态口径（本次复核结论）**：在 **① 冻结 PR 合并 → ② B1 PR 自动改基后合并 → ③ 独立的",
            "> 接受记录 PR 合并** 这三步完成之前，本产出的正确表述是「**待合并冻结运行**」，**不是**项目",
            "> 最终 Frozen B1；也因此**不得**据此启动 B3。接受条件、四项校验与流程见 **§12**。",
            ">",
        ]
    lines += [
        "> **与旧 B1 读数差异很大？先看 §9「差异归因」** —— 那里给出**可审计的数值对照表**",
        "> （0/5/10/20bps × 逐策略 × 净值/CAGR/Sharpe/换手/成本/差异），并逐项标注",
        "> D-001 / F1-F2 / F4 / 统一账本的归因。",
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
    sc_pre = m.get("self_check_pre_report") or {}
    lines += [
        "",
        "- **本报告自身哈希**：见 manifest `outputs.committed_report`（报告不含自身哈希，避免自引用）",
        "- **manifest 自校验（报告写出前执行，不含报告自身哈希）**：%s（%d/%d 项哈希重算一致）"
        % ("✅ 全部通过" if sc_pre.get("all_pass") else "❌ 存在失配",
           sc_pre.get("passed", 0), sc_pre.get("checks", 0)),
        "- **manifest 完整自校验（含本报告哈希）**：结果写入 manifest `self_check`；"
        "`all_pass=false` 时本入口抛 `FrozenAttestationError` 并**拒绝产出交付物** —— "
        "因此本报告存在即等价于「完整自校验已通过」，此处不重复断言。",
        "",
        "## 9. 差异归因：旧审计基线 vs 本次冻结运行（**必读页**）",
        "",
        "> 本页不是经济结论。它回答**流程**问题：与旧 B1 的 Gen-2 读数差异很大，这些差异从哪来、",
        "> 是否**可解释**。验收口径**不是「数值相同」**，而是「每一处变化都对应一个已登记的实现 /",
        "> 口径变更，且数值差异可被数据解释」。",
        ">",
        "> **数据来源（可审计，非手工誊抄）**：本页表格由**两边的 `ledger_summary` 数据**生成 ——",
        "> 旧基线读数取自**入库快照** `%s`" % att["audit_baseline"]["snapshot_file"],
        "> （其转写来源 `%s`，字节 sha256 `%s…`；快照自身 sha256 `%s…`）；"
        % (att["audit_baseline"]["captured_from"],
           att["audit_baseline"]["captured_from_sha256"][:16],
           (att["audit_baseline"]["snapshot_sha256"] or "")[:16]),
        "> 本次读数取自本运行隔离目录 `%s/ledger_summary.csv`。" % m["run_dir"],
        ">",
        "> **口径限定（本页结论的适用范围）**：本页全部归因**只**在「**2026-09-11 审计基线** vs",
        "> **本次运行**、**相同窗口 / 相同数据**」这一组对照内成立。它是**这一次对照**的结论，",
        "> **不是**「F4 在一切历史结果上都是唯一原因」这类**普遍因果断言** —— 换一组基线 / 窗口 /",
        "> 数据，必须重做本页。",
        "",
    ]

    # ---- 可对照性：Δ 只有在两侧窗口 / 成本档一致时才可解释 ----
    comparable = bool(att["controls"]["comparable"])
    ctl = att["controls"]
    _aw = ctl.get("audit_baseline_window") or {}
    _rw = ctl.get("run_window") or {}
    lines += [
        "### 9.0 可对照性判定（先看这里：不一致则 Δ 不可解释）",
        "",
        "| 口径 | 旧审计基线快照 | 本次运行 | 一致？ |",
        "|---|---|---|---|",
        "| 窗口 | `%s` → `%s`（%s 日） | `%s` → `%s`（%s 日） | %s |"
        % (_aw.get("first_date"), _aw.get("last_date"), _aw.get("days"),
           _rw.get("first_date"), _rw.get("last_date"), _rw.get("days"),
           "—" if _rw.get("days") is None else ("✅" if ctl.get("window_mismatch") is None else "❌")),
        "| 成本档（bps） | %s | %s | %s |"
        % (", ".join("%g" % c for c in att["audit_baseline"].get("cost_levels", [])) or "—",
           ", ".join("%g" % c for c in sorted({r["cost_bps"] for r in att["rows"]})) or "—",
           "—" if _rw.get("days") is None
           else ("✅" if ctl.get("cost_level_mismatch") is None
                 else "⚠️ 仅个别单元格缺席（表中显示 `—`），不影响已有单元格")),
        "",
    ]
    if comparable:
        lines += [
            "✅ **可对照**：两侧窗口一致 ⇒ 下表的 Δ = 本次 − 旧基线，逐格相减有意义；",
            "§9.4 的基准控制项据此生效。",
            "",
        ]
    else:
        lines += [
            "⚠️ **不可对照（差异诊断模式）**：两侧**窗口不一致** ⇒ **Δ 列一律显示 `n/a`**。",
            "拿不同窗口的读数相减是**拿两个不同问题相减**，会假报「基准策略 Δ ≠ 0 ⇒ 账本变了」。",
            "本模式下 §9.1 只**并列列示**两侧原始读数（各自标注自己的窗口），§9.2 / §9.4 / §9.6",
            "一律标「不适用」—— **本页不构成对「旧基线为何变化」的量化解释**。",
            "要做量化解释，必须跑**与快照同窗口（0/5/10/20bps 全量）**的运行。",
            "",
        ]

    lines += [
        "### 9.1 数值对照表（净值 / CAGR / Sharpe / 换手 / 成本，含差异）",
        "",
        "口径：**Δ = 本次 − 旧审计基线**；净值 = 期末净值（累计收益 = 净值 − 1）。",
    ]
    if comparable:
        lines += ["公共窗口 `%s` → `%s`（%d 日）。" % (cal["first_date"], cal["last_date"], cal["days"])]
    else:
        lines += [
            "旧基线窗口 `%s` → `%s`（%s 日）；本次窗口 `%s` → `%s`（%s 日）—— **两者不同，Δ 不可解释。**"
            % (_aw.get("first_date"), _aw.get("last_date"), _aw.get("days"),
               _rw.get("first_date"), _rw.get("last_date"), _rw.get("days")),
        ]
    lines.append("")

    for bps in sorted({r["cost_bps"] for r in att["rows"]}):
        tag = "**毛收益口径**：Δ 全部来自持仓 / 权重路径（无费用）" if abs(bps) < 1e-9 \
            else "含费用"
        lines += [
            "#### cost = %g bps（%s）" % (bps, tag),
            "",
            "| 策略 | 净值 旧 | 净值 新 | Δ净值 | CAGR 旧 | CAGR 新 | ΔCAGR(pp) | Sharpe 旧 | Sharpe 新 | ΔSharpe"
            " | 换手 旧 | 换手 新 | Δ换手 | 成本 旧 | 成本 新 |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for r in att["rows"]:
            if abs(r["cost_bps"] - bps) > 1e-9:
                continue
            o, n, d = r["old"], r["new"], r["delta"]
            if o is None:
                lines.append("| %s | — | %.4f | — | — | %+.2f%% | — | — | %.2f | — | — | %.3f | — | — | %.4f |"
                             % (r["strategy"], n["terminal_nav"], n["cagr"] * 100, n["sharpe"],
                                n["total_turnover"], n["total_cost"]))
                continue
            if not comparable:
                # 差异诊断模式：只并列列示两侧原始读数，Δ 不给出（避免被误读为解释）
                lines.append(
                    "| %s | %.4f | %.4f | n/a | %+.2f%% | %+.2f%% | n/a | %.2f | %.2f | n/a"
                    " | %.3f | %.3f | n/a | %.4f | %.4f |"
                    % (r["strategy"], o["terminal_nav"], n["terminal_nav"],
                       o["cagr"] * 100, n["cagr"] * 100, o["sharpe"], n["sharpe"],
                       o["total_turnover"], n["total_turnover"], o["total_cost"], n["total_cost"]))
                continue
            lines.append(
                "| %s | %.4f | %.4f | %+.4f | %+.2f%% | %+.2f%% | %+.2f | %.2f | %.2f | %+.2f"
                " | %.3f | %.3f | %+.3f | %.4f | %.4f |"
                % (r["strategy"], o["terminal_nav"], n["terminal_nav"], d["terminal_nav"],
                   o["cagr"] * 100, n["cagr"] * 100, d["cagr"] * 100,
                   o["sharpe"], n["sharpe"], d["sharpe"],
                   o["total_turnover"], n["total_turnover"], d["total_turnover"],
                   o["total_cost"], n["total_cost"]))
        lines.append("")

    _split = _gross_and_cost_split(att) if comparable else []
    lines += [
        "### 9.2 Δ 的两段分解：毛收益效应 vs 成本拖累变化",
        "",
    ]
    if not comparable:
        lines += ["⚠️ **不适用**：两侧窗口不一致 ⇒ 不做两段分解（见 §9.0）。"]
    elif not _split:
        lines += [
            "⚠️ **本次运行未含 0 bps 成本档** ⇒ 无法把 Δ 拆成「毛收益效应」与「成本拖累变化」。",
            "这是**运行裁剪**（测试/CI 用单档）造成的，不是数据缺陷；正式全量运行含 0/5/10/20bps 四档。",
            "",
        ]
    else:
        lines += [
            "净值口径恒等式：累计收益 ≈ 毛收益 − 成本拖累。因此 `Δ(0bps)` **纯净地**反映持仓 / 权重路径差异，",
            "`Δ(10bps) − Δ(0bps)` 反映**费用**差异。",
            "",
            "| 策略 | 毛收益效应 Δ(0bps) | 成本拖累 旧@10bps | 成本拖累 新@10bps | 成本拖累缓解 | 净效应 Δ(10bps) |",
            "|---|---|---|---|---|---|",
        ]
        for s in _split:
            lines.append("| %s | %+.2fpp | %.2fpp | %.2fpp | %+.2fpp | %+.2fpp |"
                         % (s["strategy"], s["gross_effect_0bps"] * 100,
                            s["old_cost_drag_10bps"] * 100, s["new_cost_drag_10bps"] * 100,
                            s["cost_drag_relief"] * 100, s["net_effect_10bps"] * 100))
        lines += [
            "",
            "> 读法：**毛收益效应是主动作，成本拖累变化是反向缓冲。**",
        ]
    lines += [
        "",
        "### 9.3 逐项归因：四项已登记变更各自是否构成本次 Δ（**限本次同窗口对照**）",
        "",
        "> **结论的适用范围**：本节（含 §9.5 的方向性说明）**只**回答「在 **2026-09-11 审计基线** 与",
        "> **本次运行**、**相同窗口 / 相同数据**的对照中，**F4 是唯一实质来源**」。**不**推广为对",
        "> 所有历史结果的普遍因果结论；也不表示 F4 在其它窗口 / 数据下必然仍是主导项。",
        "",
        "**判定规则**（不是叙述）：把「旧基线产出时点」与各变更的落地时点比对 —— 落在旧基线**之内**的变更",
        "**不可能**解释本次 Δ（它只能解释「旧基线与更早报告」的差异）；落在旧基线**之后**的才可能。",
        "旧基线产出时点 = `2026-09-11 14:21`（其 `ledger_summary.csv` 文件 mtime）。",
        "",
        "> 本节是**时点判定**（与运行窗口无关）⇒ 即使在 §9.0 的「不可对照」模式下**依然有效**：",
        "> 它回答「哪些变更**有可能**解释差异」，但**不能**回答「差异有多大」（那需要可对照的数值表）。",
        "",
        "| 变更 | 落地 commit | 落地时间 | 落在旧基线内？ | 能解释本次 Δ？ | 对本次 Δ 的数值贡献 |",
        "|---|---|---|---|---|---|",
    ]
    _verdict_cn = {"none_already_in_audit_baseline": "无（已在旧基线内生效）",
                   "none_by_default_equivalence": "无（默认配置与旧行为逐值等价）",
                   "material": "**全部**（本次对照）"}
    for c in att["changes"]:
        ev = c["evidence"]
        commits = ev.get("commits") or [ev.get("commit")]
        commits = [x for x in commits if x]
        at = ev.get("at")
        at_s = ", ".join(at) if isinstance(at, list) else (at or "")
        explains = c["numeric_contribution"] == "material"
        lines.append("| **%s** %s | %s | %s | %s | %s | %s |"
                     % (c["id"], c["name"],
                        ", ".join("`%s`" % x for x in commits), at_s,
                        "✅ 是" if c["in_audit_baseline"] else "❌ 否（落在旧基线之后）",
                        "✅ 是" if explains else "❌ 否",
                        _verdict_cn.get(c["numeric_contribution"], c["numeric_contribution"])))
    lines += [
        "",
        "**机制（这些变更到底改了什么）**",
        "",
    ]
    for c in att["changes"]:
        lines.append("- **%s**：%s → 影响面：%s" % (c["id"], c["mechanism"], c["metric_moved"]))

    mm = att["audit_baseline"].get("measured_mechanism") or {}
    lines += [
        "",
        "### 9.4 控制项：基准策略逐位相同（可机检）",
        "",
        "基准策略（%s）**不经过规则实现** ⇒ 它们的 Δ 必须**恰为 0**；为 0 同时独立证明"
        % ", ".join("`%s`" % s for s in att["controls"]["benchmark_strategies"]),
        "**账本契约与基准路径未变** —— 也就是「统一账本」不构成本次 Δ 的来源。",
        "",
        "| 控制项 | 值 | 判定 |",
        "|---|---|---|",
    ]
    if comparable:
        lines += [
            "| 基准策略累计收益最大绝对差（全成本档） | %.3e | %s |"
            % (att["controls"]["benchmark_max_abs_cum_return_delta"] or 0.0,
               "✅ 逐位相同" if att["controls"]["benchmark_bit_identical"] else "❌ 不一致"),
            "| 基准策略换手（旧 → 新，@0bps） | %s | ✅ |"
            % " / ".join(
                "%s %.5f→%.5f" % (r["strategy"], r["old"]["total_turnover"], r["new"]["total_turnover"])
                for r in att["rows"]
                if abs(r["cost_bps"]) < 1e-9 and r["old"] is not None
                and r["strategy"] in att["controls"]["benchmark_strategies"]),
        ]
    else:
        lines += [
            "| 基准策略累计收益最大绝对差 | — | ⚠️ **不适用**（窗口不一致） |",
            "| 基准策略换手（旧 → 新） | — | ⚠️ **不适用**（两侧窗口不同，换手量级不可比） |",
        ]
    lines += [
        "",
    ]
    if not comparable:
        lines += [
            "> **不要**把 `benchmark_max_abs_cum_return_delta` 的非零读数当成「账本被改了」的证据 ——",
            "> 那是**窗口不同**的必然结果。判定「基准路径是否变化」必须用同窗口全量运行（§9.0）。",
            "",
        ]
    if mm.get("old_candidate_weights"):
        lines += [
            "**旧基线的权重语义（实测证据，解释 Δ 的方向）**",
            "",
            "| 观测 | 证据 |",
            "|---|---|",
            "| %s | %s |" % (mm["old_candidate_weights"]["finding"],
                              "；".join("`%s`" % e for e in mm["old_candidate_weights"]["evidence"])),
            "| bundle 上限被旧实现丢弃 | %s |"
            % "；".join("`%s = %s`" % (k, v) for k, v in mm.get("bundle_caps_ignored_by_old", {}).items()),
            "| 现金/敞口对照（defended @0bps） | 旧：非零现金 %s 日、均值 %.5f；新：非零现金 %s 日、均值 %.5f |"
            % (mm["exposure_evidence"]["defended_0bps_old_nonzero_cash_days"],
               mm["exposure_evidence"]["defended_0bps_old_mean_cash_weight"],
               mm["exposure_evidence"]["defended_0bps_new_nonzero_cash_days"],
               mm["exposure_evidence"]["defended_0bps_new_mean_cash_weight"]),
            "",
        ]

    _sp = next((s for s in _split if s["strategy"] == "gen2_v2_defended"), None)
    lines += [
        "### 9.5 旧基线的数字为什么变了（**方向性说明，已更正**）",
        "",
        "- **统一账本的方向（更正）**：更早的实现把**现金腿重复计入换手** ⇒ 换手与**费用被高估** ⇒",
        "  **净收益被低估、表现更悲观**。此前把这里写成「旧读数偏乐观」是**错误的**，本版已更正。",
        "  但请同时注意：**本次 Δ 与统一账本无关** —— 统一账本早已在旧审计基线内生效（§9.3 判定 + §9.4 机检）。",
        "- **本次 Δ 的方向由 F4 决定**（旧基线在权重语义上把 `1/n` 等权当作组合，并丢弃上限）：",
    ]
    if _sp:
        lines += [
            "  - 旧基线在 CORE 只有 1 只时把 **100%** 押在单只（例如 `2020-05-27` 的 `target_weight = 1.0`），",
            "    远超 bundle 的 `max_single_weight = 0.25` ⇒ **敞口更高、换手更大**；",
            "  - 在 2020–2026 这段行情里，这种集中敞口换来**更高的毛收益**：毛收益效应 **%+.2fpp**；"
            % (_sp["gross_effect_0bps"] * 100),
            "  - 同时更高的换手带来更重的费用：成本拖累 **%.2fpp → %.2fpp**（@10bps），"
            % (_sp["old_cost_drag_10bps"] * 100, _sp["new_cost_drag_10bps"] * 100),
            "    缓解 **%+.2fpp**；" % (_sp["cost_drag_relief"] * 100),
            "  - 净效应 **%+.2fpp**（@10bps）：**毛收益的下降（%+.2fpp）大于费用的缓解（%+.2fpp）**，"
            % (_sp["net_effect_10bps"] * 100, _sp["gross_effect_0bps"] * 100,
               _sp["cost_drag_relief"] * 100),
            "    所以旧基线看起来「更好」**不是因为旧账本更乐观**，而是因为旧的组合口径把上限约束**当成了不存在**。",
        ]
    else:
        _why = ("**不可对照**（两侧窗口不一致）⇒ 本节不给数值" if not comparable
                else "本次运行未含 0 bps 成本档 ⇒ 无法给毛收益效应/成本拖累数值")
        lines += [
            "  - ⚠️ %s。方向性结论仍然成立（它是**机制**层面的）：" % _why,
            "    旧基线丢弃 `max_single_weight / max_cluster_weight / max_tech_weight` ⇒ 敞口更高、换手更大；",
            "    在 2020–2026 的行情里换来了更高的毛收益，同时付出更重的费用 —— **在 2026-09-11 审计基线",
            "    与本次相同窗口/数据的对照中，F4 是唯一实质来源**（§9.3 判定 + `F4MechanismValidityTest`",
            "    的机制反例）。具体幅度需跑**同窗口全量运行**（0/5/10/20bps）补齐；本结论**不**推广为对全部历史结果的普遍因果。",
        ]
    lines += [
        "",
        "### 9.6 与「候选冻结运行」的关系（扩锁未改语义）",
        "",
        "> **口径澄清**：rev2 与 rev3 读数一致**只能**证明「扩锁未改变运行语义」，",
        "> **不能**代替 §9.1–§9.5 对「旧基线为何变化」的量化解释。两者是不同的问题。",
        "",
        "- 上一轮曾在 `lock_revision 2` 下跑过一次 B1（10bps 下 `gen2_v2_defended` **+61.01%** / Sharpe 0.55）：",
        "  那是**候选运行证据**，不是最终 Frozen B1。",
        "- 本次为 `lock_revision %s` 下的运行。两次扩围都**只改变锁定范围、不改变规则字节与参数**，"
        % m["frozen_input"]["lock"]["lock_revision"],
        "  所以两份读数的正确关系是「**应当一致**」—— 出现差异即说明扩围顺带改了运行语义（缺陷）。",
        "",
        "| 策略 | 候选运行（rev 2，10bps） | 本次（rev %s，10bps） | 判定 |"
        % m["frozen_input"]["lock"]["lock_revision"],
        "|---|---|---|---|",
    ]
    if comparable:
        for name, ref, cum, shp, same in _candidate_run_comparison(summary):
            lines.append("| `%s` | %+.2f%% / Sharpe %.2f | %+.2f%% / Sharpe %.2f | %s |"
                         % (name, ref["cumulative_return"] * 100, ref["sharpe"], cum * 100, shp,
                            "✅ 逐位一致（扩锁未改语义）" if same else "❌ **不一致**（扩锁改了语义，须查）"))
        lines += [
            "",
            "> 「逐位一致」是本页**针对扩锁**最强的单点证据：若扩围真的只锁范围，读数就必须一动不动。",
        ]
    else:
        lines += [
            "| — | — | — | ⚠️ **不适用** |",
            "",
            "> ⚠️ 本次为裁剪窗口（`%s` → `%s`），候选运行读数取自**全窗口**运行 ⇒ 两者不可比对。"
            % (_rw.get("first_date"), _rw.get("last_date")),
            "> 扩锁一致性核对**只**在全窗口运行时有效（`test_final_run_matches_candidate_run_at_10bps` 即用全窗口）。",
        ]
    lines.append("")
    lines += [
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
    ]
    lines += (["- **Frozen B1 已接受**：接受记录已写入（§12）；**此时才允许启动 B3 Frozen OOS** ——",
               "  但 B3 本身仍不得据此提升 authority / 部署 / 写正式仓位。",
               "  `%s / Sharpe %s`（候选读法）**不是**经济资格。" % ("+61.01%", "0.55")]
              if accepted else
              ["- **不据此启动 B3**：本产出是「待合并冻结运行」，在 §12 的接受记录写入之前不进入 B3 Frozen OOS；",
               "  `+61.01% / Sharpe 0.55` **不是**经济资格。"])
    lines += [
        "",
        "## 11. 复现",
        "",
        "```bash",
        "PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --date %s"
        % m["created_at"][:10].replace("-", ""),
        "# 只读验锁（不改盘）",
        "python scripts/ml/freeze-gen2-rule-bundle.py --check",
        "node scripts/verify-immutable.js",
        "# B1 PR 合并后：在独立分支建接受记录（四项校验全过才写入；内容哈希不变则无需重跑）",
        "git switch -c %s origin/master" % ACCEPT_BRANCH,
        "PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --accept-merge --master-commit <sha>",
        "```",
        "",
        "> 任一门禁失配（锁 SHA / ROOT_ANCHORS / 配置漂移 / 跨实现常量 / manifest 自校验）时本入口",
        "> **直接拒绝运行**，因此不存在「在一份未冻结的规则上跑出 B1」这种形态。",
        "",
        "## 12. 合并接受条件%s"
        % ("（接受记录已写入；**仍须经接受记录 PR 合并方生效**）" if accepted
           else "（写入接受记录前，本产出只是「待合并冻结运行」）"),
        "",
        "**顺序（不可跳）**：",
        "",
        "1. 合并**冻结 PR**（`feat/gen2-wp-g2-04-freeze` → `master`）；",
        "2. 合并 **B1 PR**（`feat/gen2-b1-frozen-run`，base 选冻结分支；冻结 PR 合并后 GitHub",
        "   自动把 base 改为 `master`）；",
        "3. 从**新的 master** 建 `%s`，运行接受命令：" % ACCEPT_BRANCH,
        "   `python -m gen2.baseline.b1_frozen_run --accept-merge --master-commit <B1 合并提交完整 SHA>`；",
        "4. 该命令**校验**（任一不过即拒绝写入并要求重跑，`FrozenAttestationError`）：",
        "   - ⓪ **工作树干净**（接受时 + 取证时两态）；",
        "   - ① **执行提交** `source_state.git_head_commit` 是 `<B1 merge SHA>` 的**祖先**",
        "     （证明「接受的就是这次执行所依据的源码」）；",
        "   - ② **锁定组件 / B1 工具链 / 输入摘要 / 输出摘要**与 manifest **逐项**逐位一致",
        "     （逐项才能指出**哪一条锁定路径**变了，不只比折叠摘要）；",
        "   - ③ `<B1 merge SHA>` 的**树中包含**已承诺的**报告 / manifest / 审计快照**，且**哈希匹配**",
        "     （取**提交里的 blob** 算哈希，不是取磁盘文件 —— 后者证明不了「合并进去的是这样」）。",
        "   > ⚠️ **不再要求** `accepted_master_tree_sha == execution_source_tree_sha`：报告 / manifest /",
        "   > 审计快照是**执行之后**才提交的 ⇒ 两个 tree **必然不同**。前者是「接受时仓库快照」、",
        "   > 后者是「执行时语义源码快照」，两者的关联由 ② 的摘要族与 ③ 的已承诺证据哈希建立。",
        "5. 开并合并**这一个很小的接受记录 PR**（`%s` → `master`）。" % ACCEPT_BRANCH,
        "",
        "> **为什么必须是独立 PR**：`--accept-merge` **会修改受版本控制**的 manifest / 报告；",
        "> 在受保护的 `master` 下不存在「B1 合并后在本地跑一下就算完成」的路径 —— 这一步本身也要",
        "> 留痕、可评审。**该 PR 合并之后**，本产出才可正式称为「Frozen B1 已接受」，也才允许启动",
        "> **B3 Frozen OOS**。",
        "",
        "当前状态：%s" % ("**Frozen B1 已接受**（生效以接受记录 PR 合并为准）" if accepted
                          else "**待合并**（接受记录尚未写入 → 措辞不得写「已接受」）"),
        "",
        "| 项 | 值 |",
        "|---|---|",
        "| `run_status` | `%s` |" % m.get("run_status"),
        "| `execution_source_tree_sha`（**执行时**语义源码快照；**不要求** == `<SHA>^{tree}`） | `%s` |"
        % ((m.get("source_state") or {}).get("source_tree_sha") or "—"),
        "| %s**组件摘要**（lock 8 项折叠） | `%s` |"
        % ("已绑定的" if accepted else "待绑定的", m["frozen_input"]["lock_component_digest"]),
        "| %s**输入摘要** | `%s` |"
        % ("已绑定的" if accepted else "待绑定的", m["input_data"]["content_digest"]),
        "| %s**输出摘要** | 见 manifest `outputs.committed_report.sha256`（报告不含自身哈希） |"
        % ("已绑定的" if accepted else "待绑定的"),
    ]
    if accepted:
        ar = m.get("acceptance_record") or {}
        lines += [
            "",
            "**接受记录（已写入 manifest `acceptance_record`）**",
            "",
            "| 字段 | 值 |",
            "|---|---|",
            "| `accepted_master_commit` | `%s` |" % ar.get("accepted_master_commit"),
            "| `accepted_master_commit_input` | `%s` |" % ar.get("accepted_master_commit_input"),
            "| `accepted_master_tree_sha`（**接受时**仓库快照） | `%s` |"
            % ar.get("accepted_master_tree_sha"),
            "| `execution_head_commit`（取证执行提交） | `%s` |" % ar.get("execution_head_commit"),
            "| `execution_source_tree_sha`（**执行时**语义源码快照） | `%s` |"
            % ar.get("execution_source_tree_sha"),
            "| 两个 tree 是否要求相等 | ❌ **不要求**（产物在执行后才提交 ⇒ 应当不同；由摘要族 + "
            "已承诺证据哈希关联） |",
            "| `master_ref`（**信息性**，不作拒绝条件） | `%s` |" % ar.get("master_ref"),
            "| `acceptance_branch`（须经该分支的 PR 合并才生效） | `%s` |" % ar.get("acceptance_branch"),
            "| `accepted_at` | `%s` |" % ar.get("accepted_at"),
            "| 四项校验 | %s |"
            % (" / ".join("✅ `%s`" % v.get("check") for v in (ar.get("verifications") or [])) or "—"),
            "| 已承诺证据（在 `<SHA>` 树中逐个核对） | %s |"
            % ("、".join("`%s`=%s" % (e.get("role"), "✅" if (e.get("present_in_merge_tree")
                                                              and e.get("matches")) else "❌")
                         for e in (ar.get("committed_evidence") or [])) or "—"),
            "| 摘要未变 | %s |" % ("✅ 是（无需重跑）" if ar.get("digests_unchanged") else "❌ 否"),
            "",
            "> **写入的前置与效果**：写入前入口 fail-closed 地校验 ⓪「工作树干净（接受 + 取证两态）」",
            "> ①「**执行提交**是 `<SHA>` 的祖先」②「锁定组件 / B1 工具链 / 输入 / **输出**摘要与 manifest",
            "> **逐项**逐位一致」③「`<SHA>` 的**树中**含报告 / manifest / 审计快照且**哈希匹配**」——",
            "> 任一不过即 `FrozenAttestationError` **拒绝写入并要求重跑 B1**。因此「内容哈希不变 ⇒",
            "> 无需重跑」在本文件中是**被校验的前提**，不是约定。",
            ">",
            "> ⚠️ **两个 tree 不要求相等**（早期版本要求「整棵树相等」，那会**必然失败**：报告 / manifest /",
            "> 审计快照在执行后才提交，`accepted_master_tree_sha` 里**必然**含有 `execution_source_tree_sha`",
            "> 所没有的路径 —— 这正是本次契约修正的原因）。",
            "",
            "> ⚠️ **本记录尚未生效**：`--accept-merge` 修改的是**受版本控制**的 manifest / 报告 ⇒ 必须经"
            "> `%s` 这条**接受记录 PR** 合并进 `master`；**该 PR 合并之后**，本产出才可正式称为" % ACCEPT_BRANCH,
            "> 「Frozen B1 已接受」，也才允许启动 **B3 Frozen OOS**（B3 本身仍不得据此提升 authority /",
            "> 部署 / 写正式仓位）。",
            ">",
            "> 复核命令（可重跑；已接受状态下会重新核对四项校验并提示）：",
            ">",
            "> ```bash",
            "> PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --accept-merge --master-commit <sha>",
            "> ```",
        ]
    else:
        lines += [
            "",
            "> **在接受记录写入之前**：不进入 B3 Frozen OOS、不提升 authority、不部署、不写正式仓位；",
            "> 本报告全部净值 / Sharpe 只作**研发证据**。",
            "",
            "> 接受记录命令（B1 PR 合并后，在**独立分支** `%s` 上执行；会先做四项校验，" % ACCEPT_BRANCH,
            "> 任一不过即**拒绝**并要求重跑；随后开并合并该接受记录 PR）：",
            ">",
            "> ```bash",
            "> git switch -c %s origin/master" % ACCEPT_BRANCH,
            "> PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --accept-merge --master-commit <sha>",
            "> # → 开「接受记录 PR」并合并；该 PR 合并后才可正式称「Frozen B1 已接受」",
            "> ```",
        ]
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="B1 冻结运行（以 gen2-rule-v2.0.1 锁为唯一输入）")
    ap.add_argument("--date", default="20260914", help="日期标签（YYYYMMDD），用于 run ID 与报告名")
    ap.add_argument("--run-id", default=None, help="显式 run ID（默认由 bundle_version 派生）")
    ap.add_argument("--report-dir", default=None)
    ap.add_argument("--report", default=None, help="报告路径（--accept-merge 时用于重写措辞）")
    ap.add_argument("--manifest", default=None)
    ap.add_argument("--accept-merge", action="store_true",
                    help="把本次运行的摘要绑定到合并后的 master 并写入接受记录（不重跑）；"
                         "会修改受版本控制的 manifest / 报告 ⇒ 须落在独立接受记录 PR 上")
    ap.add_argument("--master-commit", default=None, help="合并后的 master commit（--accept-merge 必填）")
    ap.add_argument("--master-ref", default=DEFAULT_MASTER_REF,
                    help="**信息性**引用（默认 origin/master）：仅在记录里标注 `<SHA>` 是否已进入该引用，"
                         "**不作拒绝条件**（契约要求的祖先关系是「执行提交是 <SHA> 的祖先」）")
    ap.add_argument("--source-tree-sha", default=None, help="显式指定 source tree sha（默认由 manifest 记录）")
    args = ap.parse_args()

    if args.accept_merge:
        if not args.master_commit:
            print("[B1-FROZEN] --accept-merge 需要 --master-commit", file=sys.stderr)
            return 2
        try:
            m = accept_merge(args.master_commit, manifest_path=args.manifest,
                             report_path=args.report, source_tree_sha=args.source_tree_sha,
                             master_ref=args.master_ref)
        except FrozenAttestationError as exc:
            print("[B1-FROZEN] 拒绝写入接受记录：%s" % exc, file=sys.stderr)
            return 2
        ar = m["acceptance_record"]
        print("[B1-FROZEN] status    :", m["run_status"])
        print("[B1-FROZEN] accepted  :", ar["accepted_master_commit"])
        print("[B1-FROZEN] ① ancestor :", ar["execution_head_commit"][:12],
              "（执行提交）→", ar["accepted_master_commit"][:12], "（B1 合并提交）✅ 祖先")
        print("[B1-FROZEN] ② digests  : ✅ 锁定组件 / 工具链 / 输入 / 输出摘要**逐项**一致（%d 项）"
              % len(ar["bound_digests"]["run_dir_artifacts"]))
        print("[B1-FROZEN] ③ evidence :", "、".join(
            "%s=%s" % (e["role"], "✅" if (e["present_in_merge_tree"] and e["matches"]) else "❌")
            for e in ar["committed_evidence"]))
        print("[B1-FROZEN] tree      : accepted %s ⊃ 证据 / execution %s（**不要求相等**）"
              % (ar["accepted_master_tree_sha"][:12], ar["execution_source_tree_sha"][:12]))
        print("[B1-FROZEN] no rerun  :", ar["no_rerun_required"])
        print("[B1-FROZEN] ⚠️ 下一步  : 把本改动（manifest + 报告）推到分支 `%s` 并开"
              "「接受记录 PR」；该 PR 合并后才可正式称「Frozen B1 已接受」并启动 B3。"
              % ar["acceptance_branch"])
        return 0

    try:
        r = run(date_tag=args.date, run_id=args.run_id,
                report_dir=args.report_dir, manifest_path=args.manifest)
    except FrozenAttestationError as exc:
        print("[B1-FROZEN] 拒绝运行：%s" % exc, file=sys.stderr)
        return 2

    m = r["manifest_data"]
    a = m["acceptance"]
    print("[B1-FROZEN] run id      :", r["run_id"])
    print("[B1-FROZEN] run status  :", m["run_status"])
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
    print("[B1-FROZEN] attribution : 基准逐位相同=%s；本次同窗口对照中能解释 Δ 的变更=%s" % (
        m["attribution"]["controls"]["benchmark_bit_identical"],
        ", ".join(c["id"] for c in m["attribution"]["changes"]
                  if c["numeric_contribution"] == "material") or "（无）"))
    print("[B1-FROZEN] self-check  : %d/%d 项哈希一致 → %s" % (
        m["self_check"]["passed"], m["self_check"]["checks"],
        "PASS" if m["self_check"]["all_pass"] else "FAIL"))
    print("[B1-FROZEN] gate        : conservation=%.3e cash_min=%.6f → %s" % (
        a["conservation_max_error"], a["cash_min"], "PASS" if a["gate_pass"] else "FAIL"))
    return 0 if a["gate_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
