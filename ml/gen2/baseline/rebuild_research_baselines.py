"""WP-G2-02 / B1 —— 研究基线报告生成器（可复现；含「组合有效性」守卫）。

为什么要把它做成脚本（而不是一次性命令）：
  研究基线此前由临时命令产出，既不可复现，也**不会阻止**把「声明了旋钮、但组合结果与 baseline
  逐位相同」的场景当作组合敏感性结论来展示。这种场景的净值不具解释价值（F1，用户裁决 2026-09-11）。

守卫规则（**数据驱动**，不是手工标记）：
  * 逐场景把组合指标（累计收益 / 年化 / Sharpe / MDD / 总换手）与 `baseline` 比较：
      - 组合指标逐位相同、信号指标不同 → `portfolio_effective=false`、`signal_only=true`
        （只能进「信号层敏感性」表，仅 Rank IC 类指标）
      - 组合指标与信号指标都逐位相同   → `portfolio_effective=false`、`signal_only=false`
        （旋钮未被任何一层读取，报告里单列，且不得作为任何结论）
      - 组合指标不同                   → `portfolio_effective=true`（可进「组合敏感性」表）
  * 任何被判为无效的场景都必须在 `sensitivity_matrix.REGISTERED_INEFFECTIVE` 登记
    （对应 F1 / F2），否则**直接报错**：防止将来新出现的静默无效场景被当成结论展示。
  * 已登记的场景如果变回有效（例如 WP-G2-05 注入链修好之后），同样**直接报错**，
    强制更新登记表 —— 登记表不允许腐烂。

运行：
  PYTHONPATH=ml python -m gen2.baseline.rebuild_research_baselines
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from gen2.baseline.sensitivity_matrix import REGISTERED_INEFFECTIVE, scenario_specs
from gen2.data.loader import GEN2_ROOT

BASELINE_ID = "b1_ledger_baseline_20260911"
RESEARCH_DIRNAME = "research"
SENSITIVITY_CSV = "sensitivity_matrix_v2semantics_20260911.csv"
RULE_ROTATION_REPORT = "gen2_b1_research_rule_rotation_20260911.md"
REPORT_NAME = "gen2_b1_research_baselines_20260911.md"

#: 判定「组合是否有实质差异」用的指标（逐位比较，容差 1e-12）
PORTFOLIO_METRIC_KEYS = ("cumulative_return", "annualized_return", "sharpe", "max_drawdown", "total_turnover")
#: 信号层指标（组合无效时唯一允许展示的指标）
SIGNAL_METRIC_KEYS = ("rank_ic_mean", "rank_ic_pos_rate")

EFFECTIVE = "PORTFOLIO_EFFECTIVE"
SIGNAL_ONLY = "SIGNAL_ONLY"
NO_EFFECT_AT_ALL = "NO_EFFECT_AT_ALL"


def _same(a, b, atol: float = 1e-12) -> bool:
    """逐位比较（NaN 视为相同）。"""
    a, b = float(a), float(b)
    if np.isnan(a) and np.isnan(b):
        return True
    if np.isnan(a) or np.isnan(b):
        return False
    return abs(a - b) <= atol


def declared_fingerprint() -> str:
    """声明式场景定义的指纹（写进报告，便于判断报告与场景定义是否同一版）。"""
    payload = json.dumps(scenario_specs(), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def classify_scenarios(sens: pd.DataFrame) -> list[dict]:
    """逐场景分类：组合有效 / 仅信号有效 / 完全无效。"""
    if "scenario" not in sens.columns:
        raise ValueError("敏感性 CSV 缺少 scenario 列")
    rows = {str(r["scenario"]): r for _, r in sens.iterrows()}
    if "baseline" not in rows:
        raise ValueError("敏感性 CSV 缺少 baseline 行，无法判定组合有效性")
    base = rows["baseline"]

    specs = {s["name"]: s for s in scenario_specs()}
    base_spec = specs.get("baseline", {})

    out = []
    for name, row in rows.items():
        if name == "baseline":
            continue
        portfolio_same = all(_same(row.get(k, np.nan), base.get(k, np.nan)) for k in PORTFOLIO_METRIC_KEYS)
        signal_same = all(_same(row.get(k, np.nan), base.get(k, np.nan)) for k in SIGNAL_METRIC_KEYS)
        if not portfolio_same:
            status = EFFECTIVE
        elif not signal_same:
            status = SIGNAL_ONLY
        else:
            status = NO_EFFECT_AT_ALL

        spec = specs.get(name, {})
        weight_diff = {k: v for k, v in (spec.get("weights") or {}).items()
                       if (base_spec.get("weights") or {}).get(k) != v}
        knob_diff = {k: v for k, v in (spec.get("portfolio") or {}).items()
                     if (base_spec.get("portfolio") or {}).get(k) != v}
        out.append({
            "scenario": name,
            "status": status,
            "portfolio_effective": status == EFFECTIVE,
            "signal_only": status == SIGNAL_ONLY,
            "registered_problem": REGISTERED_INEFFECTIVE.get(name),
            "weight_diff": weight_diff,
            "portfolio_knob_diff": knob_diff,
            "rank_ic_mean": float(row.get("rank_ic_mean", np.nan)),
            "rank_ic_pos_rate": float(row.get("rank_ic_pos_rate", np.nan)),
            "metrics": {k: float(row.get(k, np.nan)) for k in PORTFOLIO_METRIC_KEYS},
        })
    return out


def check_registry(classified: list[dict]) -> None:
    """登记表守卫：无效场景必须已登记；已登记的不能悄悄变回有效。"""
    unregistered = [c["scenario"] for c in classified
                    if c["status"] != EFFECTIVE and not c["registered_problem"]]
    if unregistered:
        raise ValueError(
            "检测到未登记的「组合无效应」场景：%s。"
            "请在 ml/gen2/baseline/sensitivity_matrix.py::REGISTERED_INEFFECTIVE 登记问题编号，"
            "否则这些场景会以组合敏感性结论的形式误导读者。" % ", ".join(sorted(unregistered)))

    stale = [c["scenario"] for c in classified
             if c["status"] == EFFECTIVE and c["registered_problem"]]
    if stale:
        raise ValueError(
            "登记表已过期：%s 已变回组合有效（例如注入链修复后重跑）。"
            "请更新 REGISTERED_INEFFECTIVE（移除或改写这些条目）后再生成报告。" % ", ".join(sorted(stale)))


def load_inputs(research_dir: Path) -> dict:
    sens = pd.read_csv(research_dir / SENSITIVITY_CSV)
    attr_dir = research_dir / "attribution"
    return {
        "sens": sens,
        "attr_regime": pd.read_csv(attr_dir / "attribution_by_regime.csv"),
        "attr_tech": pd.read_csv(attr_dir / "attribution_by_tech.csv"),
        "rule_rotation": (GEN2_ROOT / "reports" / RULE_ROTATION_REPORT).read_text(encoding="utf-8"),
    }


def render_report(inputs: dict, classified: list[dict]) -> str:
    sens = inputs["sens"]
    attr_reg = inputs["attr_regime"]
    attr_tech = inputs["attr_tech"]
    rule_rotation = inputs["rule_rotation"]
    verdict = [l for l in rule_rotation.split("\n") if "Economic Gate" in l]

    effective = [c for c in classified if c["status"] == EFFECTIVE]
    signal_only = [c for c in classified if c["status"] == SIGNAL_ONLY]
    no_effect = [c for c in classified if c["status"] == NO_EFFECT_AT_ALL]
    sens_index = {str(r["scenario"]): r for _, r in sens.iterrows()}

    lines = [
        "# Gen-2 B1 研究基线（WP-G2-02）",
        "",
        "**口径**：唯一权威角色语义 `rule_v2_ab.build_v2_roles` + 唯一权威账本 `backtest/ledger.run_ledger`。",
        "产物目录：`ml/gen2/outputs/%s/%s/`（未入库，可复现）。" % (BASELINE_ID, RESEARCH_DIRNAME),
        "历史同类报告已标注为**旧角色语义审计基线**，不可与本文件逐位比较。",
        "",
        "> **组合有效性守卫（本报告自动执行）**：声明了旋钮、但组合指标与 `baseline` 逐位相同的场景",
        "> 一律判为 `portfolio_effective=false`，**不得作为组合敏感性结论引用**；",
        "> 信号层仍有差异的标 `signal_only=true`（只展示 Rank IC 类指标），两层都无差异的单列「完全无效」。",
        "> 场景声明指纹：`%s`；登记表：`sensitivity_matrix.REGISTERED_INEFFECTIVE`。" % declared_fingerprint(),
        "",
    ]

    if no_effect or signal_only:
        lines += [
            "> ⚠️ **本版有 %d 个场景不可作为组合结论**：%s"
            % (len(signal_only) + len(no_effect),
               "、".join("`%s`(%s)" % (c["scenario"], c["registered_problem"] or "?")
                        for c in signal_only + no_effect)),
            "> 组合敏感性结论**只能**引用下面的「组合敏感性」表。",
            "",
        ]

    lines += [
        "## 1. 角色基线回测（rule_rotation）",
        "",
        "- 报告：`ml/gen2/reports/%s`" % RULE_ROTATION_REPORT,
        "- Manifest：`.../%s/manifest_rule_baseline_v2semantics_20260911.json`（新实验记录，**未覆盖**历史 `gen2-exp-0002`）"
        % RESEARCH_DIRNAME,
        "- 结论：%s" % (verdict[0].lstrip("- ").strip() if verdict else "n/a"),
        "- 含义：在统一口径下 **Rule V2 的经济价值仍未被证明**（Sharpe 低于 Main5 PIT）；只有 B3 Frozen OOS 有资格给出正式结论。",
        "",
        "## 2. 归因基线（attribution）",
        "",
        "按 regime（rule / defended / main5 累计收益）：",
        "",
        "| regime | 天数 | rule 累计 | defended 累计 | main5 累计 |",
        "|---|---|---|---|---|",
    ]
    for _, r in attr_reg.iterrows():
        lines.append("| %s | %d | %+.2f%% | %+.2f%% | %+.2f%% |" % (
            r["regime"], r["days"], r["rule_cum"] * 100, r["defended_cum"] * 100, r["main5_cum"] * 100))
    lines += ["", "按科技敞口：", "", "| segment | 天数 | rule 累计 | defended 累计 | main5 累计 |", "|---|---|---|---|---|"]
    for _, r in attr_tech.iterrows():
        lines.append("| %s | %d | %+.2f%% | %+.2f%% | %+.2f%% |" % (
            r["segment"], r["days"], r["rule_cum"] * 100, r["defended_cum"] * 100, r["main5_cum"] * 100))

    # ---- 组合敏感性（只有组合有效的场景允许出现在这里）----
    lines += [
        "",
        "## 3. 组合敏感性（`portfolio_effective = true`）",
        "",
        "| 场景 | 累计收益 | Sharpe | MDD | 总换手 | RankIC 均值 | 声明差异 |",
        "|---|---|---|---|---|---|---|",
    ]
    base_row = sens_index.get("baseline")
    if base_row is not None:
        lines.append("| baseline | %+.3f | %.3f | %.3f | %.0f | %.5f | — |" % (
            base_row["cumulative_return"], base_row["sharpe"], base_row["max_drawdown"],
            base_row["total_turnover"], base_row["rank_ic_mean"]))
    for c in effective:
        r = sens_index[c["scenario"]]
        diff = "；".join(["%s=%s" % (k, v) for k, v in
                          {**c["portfolio_knob_diff"], **c["weight_diff"]}.items()]) or "—"
        lines.append("| %s | %+.3f | %.3f | %.3f | %.0f | %.5f | %s |" % (
            c["scenario"], r["cumulative_return"], r["sharpe"], r["max_drawdown"],
            r["total_turnover"], r["rank_ic_mean"], diff))

    # ---- 信号层敏感性（组合无效）----
    lines += [
        "",
        "## 3.1 信号层敏感性（`signal_only = true`，`portfolio_effective = false`）",
        "",
        "> 这些场景的旋钮**没有改变 V2 状态机消费的 Alpha**，其组合指标与 baseline 逐位相同，",
        "> 因此**只展示信号层指标**；组合净值 / Sharpe / MDD **不得引用**。",
        "> 修复工作项：WP-G2-05（`selection_scores` 显式注入链）。",
        "",
        "| 场景 | RankIC 均值 | IC>0 占比 | signal_only | portfolio_effective | 登记 |",
        "|---|---|---|---|---|---|",
    ]
    if not signal_only:
        lines.append("| — | — | — | — | — | 无 |")
    for c in signal_only:
        lines.append("| %s | %.5f | %.3f | true | false | %s |" % (
            c["scenario"], c["rank_ic_mean"], c["rank_ic_pos_rate"], c["registered_problem"] or "?"))

    lines += [
        "",
        "## 3.2 完全无效（旋钮未被任何一层读取，`signal_only=false`）",
        "",
        "> 这些场景既没有改变组合、也没有改变信号：声明的旋钮当前**没有任何代码读取**。",
        "> 不得作为任何结论展示；需按登记工作项改为显式角色阈值配置（`role_thresholds`）。",
        "",
        "| 场景 | 声明差异 | RankIC 均值 | signal_only | portfolio_effective | 登记 |",
        "|---|---|---|---|---|---|",
    ]
    if not no_effect:
        lines.append("| — | — | — | — | — | 无 |")
    for c in no_effect:
        diff = "；".join(["%s=%s" % (k, v) for k, v in
                          {**c["portfolio_knob_diff"], **c["weight_diff"]}.items()]) or "—"
        lines.append("| %s | %s | %.5f | false | false | %s |" % (
            c["scenario"], diff, c["rank_ic_mean"], c["registered_problem"] or "?"))

    lines += [
        "",
        "## 4. 问题登记与裁决（2026-09-11）",
        "",
        "### F1 · 权重类场景未进入 V2 状态机消费的 Alpha —— **必须修，进入 WP-G2-05**",
        "根因：`build_v2_roles` 内部对 `features` 静默重算 `alpha_score_v2` 并作为排名依据，",
        "外部传入的 `weights` 只作用于 `rankings.leadership_score`，**不影响角色决策**。",
        "裁决（用户）：" ,
        "1. 禁止 `build_v2_roles` 内部静默重算并覆盖外部已提供的 Alpha；",
        "2. 新增显式、可校验的 `selection_scores` 输入（键 `trade_date + code`；必须覆盖当日全部 eligible ETF；",
        "   分数必须有限；记录 `score_version` / `score_source` / 内容哈希；缺失、重复、覆盖不完整即失败，",
        "   **不得 fallback 到另一套分数**）；",
        "3. 正式 Rule V2 入口传 canonical Alpha，敏感性实验传替代 Alpha；",
        "4. **在本包合并前**，权重类场景必须从组合敏感性报告中移除或标记为 `signal_only = true` / `portfolio_effective = false`",
        "   （本报告已按此执行），只能保留为 Rank IC 的信号层分析。",
        "",
        "### F2 · `top_quantile` 语义含混且不生效 —— 改为显式角色分层配置",
        "裁决（用户）：**不删除配置，也不保留 `top_quantile`**，改为：",
        "",
        "```json",
        "{ \"role_thresholds\": { \"core_top_fraction\": 0.20, \"challenger_top_fraction\": 0.30, \"satellite_top_fraction\": 0.40 } }",
        "```",
        "",
        "含义为「位于前多少比例」（不需要 `1 - top_quantile` 反向推导）；校验规则：",
        "`0 < core_top_fraction <= challenger_top_fraction <= satellite_top_fraction < 1`；",
        "默认值必须与当前行为一致（避免把配置清理混成策略调参）；旧 `top_quantile` 仅作迁移审计字段保留，",
        "退出运行路径，新 bundle 生效后禁止再读取。",
        "",
        "### F3 · 敏感性费用档白跑 4 倍 —— **保留在 WP-G2-02（本包）**",
        "`evaluate_scenario` 只关心单档 `cost_bps`，但内层 `run_rotation_backtest` 自行重载配置跑满 4 档。",
        "已加 `cost_levels` 显式参数：运行时间约 38min → 10min，**数值不变**，不影响策略解释。",
        "",
        "## 5. 边界",
        "",
        "- 以上均为**研究基线**，不构成 Rule V2 的经济结论；不冻结 bundle/lock、不重跑 OOS、",
        "  不改 authority / 部署 / 正式仓位。",
        "- 复现：`PYTHONPATH=ml python -m gen2.baseline.rebuild_baselines`（B1 账本基线）、",
        "  三个研究脚本（角色基线 / 归因 / 敏感性，输出隔离到 `research/`）、",
        "  本报告：`PYTHONPATH=ml python -m gen2.baseline.rebuild_research_baselines`。",
        "",
    ]
    return "\n".join(lines)


def generate(research_dir: str | Path | None = None, report_dir: str | Path | None = None) -> dict:
    research = Path(research_dir) if research_dir else GEN2_ROOT / "outputs" / BASELINE_ID / RESEARCH_DIRNAME
    reports = Path(report_dir) if report_dir else GEN2_ROOT / "reports"

    inputs = load_inputs(research)
    classified = classify_scenarios(inputs["sens"])
    check_registry(classified)

    text = render_report(inputs, classified)
    reports.mkdir(parents=True, exist_ok=True)
    out = reports / REPORT_NAME
    out.write_text(text, encoding="utf-8")

    return {
        "report": str(out),
        "spec_fingerprint": declared_fingerprint(),
        "portfolio_effective": [c["scenario"] for c in classified if c["status"] == EFFECTIVE],
        "signal_only": [c["scenario"] for c in classified if c["status"] == SIGNAL_ONLY],
        "no_effect_at_all": [c["scenario"] for c in classified if c["status"] == NO_EFFECT_AT_ALL],
    }


def main() -> int:
    try:
        result = generate()
    except ValueError as exc:
        print("[FAIL] %s" % exc, file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
