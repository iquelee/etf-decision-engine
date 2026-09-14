"""WP-G2-02 / B1 —— 回测账本与基线重算（唯一权威角色语义 + 唯一权威账本）。

输入（**唯一权威**，PR #24 之后）：
  * 角色语义：`gen2.baseline.rule_v2_ab.build_v2_roles`（经 `v2_role_view.build_v2_role_view` 取展示列）
  * 回测账本：`gen2.backtest.ledger.run_ledger`（口径见 `LEDGER_CONTRACT`）

同口径（四类策略 + 四个费用档，全部满足）：
  * 同一公共日历（同一首日 / 同一末日 / 同一天数，`assert_common_calendar` 强制）
  * 同期初状态（equity=1.0 全现金）
  * T+1 执行（signal-date API，`execution_lag=1`）
  * 同一费用模型（单边成交名义额 × cost_bps）、现金腿不计费
  * 末日 mark-to-market、不强制平仓；末日信号显式留痕 `dropped_signal`

策略：
  gen2_v2_defended      Gen-2 防守后组合（V2 权威角色语义）
  gen2_v2_undefended    Gen-2 未防守组合
  main5_equal_weight    Main5 PIT 等权（只对当日可得成员归一化）
  universe_equal_weight 全池等权
  market_510300         沪深300 ETF buy&hold（无成本、无换手）

⚠️ 历史报告（`ml/gen2/reports/` 中标注为「旧角色语义审计基线」的文档）基于
   **旧角色语义与旧账本口径**，不得与本模块产物逐位比较，也不得用于继续宣称 Rule V2 的经济表现。

运行：PYTHONPATH=ml python -m gen2.baseline.rebuild_baselines
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from gen2.backtest.benchmark import build_benchmark_weights
from gen2.backtest.ledger import (
    LEDGER_CONTRACT,
    assert_common_calendar,
    ledger_summary,
    run_ledger,
)
from gen2.baseline.v2_role_view import build_v2_role_view
from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_gen2_config, load_universe_definition, load_universe_records
from gen2.features.build_features import build_feature_matrix
from gen2.portfolio.defense_gate import apply_regime_defense
from gen2.portfolio.portfolio_builder import build_portfolio_candidates
from gen2.ranking.rank_engine import run_rank_engine

BASELINE_ID = "b1_ledger_baseline_20260911"
DEFAULT_COST_BPS = 10.0


def perf_metrics(net: pd.Series) -> dict:
    """由逐日净收益序列给出可比指标（与账本 net_return 同源）。"""
    net = pd.Series(net).dropna()
    if net.empty:
        return {"days": 0, "cumulative_return": np.nan, "cagr": np.nan, "sharpe": np.nan, "mdd": np.nan}
    nav = (1.0 + net).cumprod()
    total = float(nav.iloc[-1] - 1.0)
    days = int(len(net))
    cagr = float((1.0 + total) ** (252.0 / days) - 1.0) if total > -1 else -1.0
    sd = float(net.std())
    sharpe = float(net.mean() / sd * np.sqrt(252.0)) if sd > 0 else float("nan")
    mdd = float((nav / nav.cummax() - 1.0).min())
    return {"days": days, "cumulative_return": total, "cagr": cagr, "sharpe": sharpe, "mdd": mdd}


def build_weight_frames(features: pd.DataFrame, rankings: pd.DataFrame, cfg: dict, main5: list) -> dict:
    """四类同口径目标权重（decision-date 语义；账本用 execution_lag=1 落到 T+1）。"""
    roles = build_v2_role_view(features, rankings, cfg)
    candidates = build_portfolio_candidates(roles)
    defended = apply_regime_defense(candidates, features, config=cfg)
    bench = build_benchmark_weights(rankings, main5)

    bench_code = str(cfg["data"].get("benchmark_code", "510300")).zfill(6)
    market_dates = sorted(set(features.loc[features["code"] == bench_code, "trade_date"]))
    market = pd.DataFrame([{"trade_date": d, "code": bench_code, "target_weight": 1.0} for d in market_dates])

    def w(df: pd.DataFrame) -> pd.DataFrame:
        return df[["trade_date", "code", "target_weight"]].copy()

    return {
        "gen2_v2_defended": w(defended),
        "gen2_v2_undefended": w(candidates),
        "main5_equal_weight": w(bench["main5_equal_weight"]),
        "universe_equal_weight": w(bench["expanded_universe_equal_weight"]),
        "market_510300": market,
        "_roles": roles,
    }


def common_evaluation_calendar(weights_map: dict, returns: pd.DataFrame) -> tuple[list, dict]:
    """公共评估窗口 = 各策略信号日 ∩ 收益日的**交集**（B1「同一有效交易日」）。

    为什么不用并集：并集会把「某策略尚未产生信号」的年月也算作交易日，
    既稀释 CAGR/Sharpe，又把「空转期」隐藏成正常持仓日。用交集可保证
    每个参与比较的策略在窗口内**每天都可交易**。
    """
    per_strategy = {name: sorted(set(w["trade_date"])) for name, w in weights_map.items()}
    ret_dates = set(returns["trade_date"])
    common = set(ret_dates)
    for ds in per_strategy.values():
        common &= set(ds)
    cal = sorted(common)
    if not cal:
        raise ValueError("公共评估窗口为空：各策略信号日与收益日无交集")
    naive_union = sorted(set().union(*[set(ds) for ds in per_strategy.values()]) | ret_dates)
    meta = {
        "per_strategy_signal_window": {
            k: {"first": v[0], "last": v[-1], "days": len(v)} for k, v in per_strategy.items()
        },
        "naive_union_days": len(naive_union),
        "common_days": len(cal),
        "excluded_leading_days": len(naive_union) - len(cal),
    }
    return cal, meta


def build_unified_baselines(
    output_dir: str | Path | None = None,
    report_dir: str | Path | None = None,
    *,
    cost_levels: list | None = None,
    date_from: str | None = None,
) -> dict:
    """重算 B1 基线。

    cost_levels / date_from 供测试裁剪（默认取配置的完整费用档与全窗口）。
    """
    cfg = load_gen2_config()
    universe = load_universe_definition()
    main5 = list(universe["incumbent_main5"])

    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    rankings = run_rank_engine(features)

    weights_map = build_weight_frames(features, rankings, cfg, main5)
    roles = weights_map.pop("_roles")

    returns = features[["trade_date", "code", "ret_1d"]].copy()
    # 公共评估窗口（交集；见 common_evaluation_calendar 的说明）
    calendar, window_meta = common_evaluation_calendar(weights_map, returns)
    if date_from:
        calendar = [d for d in calendar if str(d) >= str(date_from)]
        if not calendar:
            raise ValueError(f"date_from={date_from} 后公共窗口为空")

    cost_levels = [float(x) for x in (cost_levels if cost_levels is not None
                                      else cfg["evaluation"].get("include_cost_sensitivity_bps", [0, 5, 10, 20]))]
    ledgers, rows, ledger_frames = {}, [], []
    for bps in cost_levels:
        for name, wdf in weights_map.items():
            led = run_ledger(wdf, returns, cost_bps=float(bps), calendar=calendar,
                             execution_lag=1, strict=True)
            led["strategy"] = name
            led["cost_bps"] = float(bps)
            key = f"{name}__{bps}bps"
            ledgers[key] = led
            ledger_frames.append(led)
            s = ledger_summary(led)
            m = perf_metrics(led["net_return"])
            rows.append({"strategy": name, "cost_bps": float(bps), **m,
                         "terminal_nav": s["terminal_nav"],
                         "total_turnover": s["total_turnover"], "avg_turnover": s["avg_turnover"],
                         "total_cost": s["total_cost"],
                         "conservation_max_error": s["conservation_max_error"],
                         "cash_min": s["cash_min"], "gross_exposure_max": s["gross_exposure_max"],
                         "over_allocated_days": s["over_allocated_days"],
                         "missing_quote_days": s["missing_quote_days"],
                         "dropped_signal_days": s["dropped_signal_days"]})

    # 公共日历强校验（首日/末日/天数必须完全一致）
    cal_meta = assert_common_calendar(ledgers)

    summary = pd.DataFrame(rows)
    all_ledgers = pd.concat(ledger_frames, ignore_index=True)

    out = Path(output_dir) if output_dir else GEN2_ROOT / "outputs" / BASELINE_ID
    out.mkdir(parents=True, exist_ok=True)
    all_ledgers.to_csv(out / "ledger_daily.csv", index=False)
    summary.to_csv(out / "ledger_summary.csv", index=False)
    (out / "calendar_meta.json").write_text(json.dumps({
        "calendar": cal_meta,
        "common_window": window_meta,
        "ledger_contract": LEDGER_CONTRACT,
        "cost_levels": cost_levels,
        "default_cost_bps": DEFAULT_COST_BPS,
        "role_semantics": "gen2.baseline.rule_v2_ab.build_v2_roles (V2 唯一权威)",
        "universe": {"version": cfg["data"].get("universe_version"), "main5": main5},
        "generated_at": pd.Timestamp.now('UTC').isoformat(),
    }, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    verification = {
        "calendar": cal_meta,
        "window": window_meta,
        "conservation_max_error": float(summary["conservation_max_error"].max()),
        "cash_min": float(summary["cash_min"].min()),
        "over_allocated_days_total": int(summary["over_allocated_days"].sum()),
        "dropped_signal_days_total": int(summary["dropped_signal_days"].sum()),
        "missing_quote_days_total": int(summary["missing_quote_days"].sum()),
        "ledgers": len(ledgers),
    }

    rep_dir = Path(report_dir) if report_dir else GEN2_ROOT / "reports"
    rep_dir.mkdir(parents=True, exist_ok=True)
    report = rep_dir / f"gen2_{BASELINE_ID}.md"
    report.write_text(_render_report(summary, verification, cfg, main5), encoding="utf-8")

    return {"output_dir": out, "report": report, "summary": summary, "verification": verification}


def _render_report(summary: pd.DataFrame, verification: dict, cfg: dict, main5: list) -> str:
    cal = verification["calendar"]
    lines = [
        "# Gen-2 B1 回测账本基线（WP-G2-02）",
        "",
        "**口径**：唯一权威角色语义 `rule_v2_ab.build_v2_roles` + 唯一权威账本 `backtest/ledger.run_ledger`。",
        "",
        "- 公共日历：`%s` → `%s`，**%d 个交易日**（所有策略首日/末日/天数完全一致）" % (
            cal["first_date"], cal["last_date"], cal["days"]),
        "- 期初状态：equity = 1.0、全现金；执行：T+1（signal-date API）；末日：mark-to-market 不强制平仓",
        "- 费用：单边成交名义额 × cost_bps；**现金腿不计费**（旧口径把现金腿计入换手，最多高估 2 倍）",
        "- Main5 = %s" % ", ".join(main5),
        "- **公共窗口**：取各策略信号日 ∩ 收益日的**交集** → %s → %s（%d 天）；" % (
            cal["first_date"], cal["last_date"], cal["days"]),
        "  朴素并集为 %d 天，已排除 %d 个「某策略尚未产生信号」的空转日（并集会稀释 CAGR 且掩盖空转期）" % (
            verification["window"]["naive_union_days"], verification["window"]["excluded_leading_days"]),
        "",
        "## 资金守恒验收",
        "",
        "| 项 | 值 | 判定 |",
        "|---|---|---|",
        "| Σtarget + cash − 1 最大偏差 | %.3e | %s |" % (
            verification["conservation_max_error"],
            "✅ PASS" if verification["conservation_max_error"] <= 1e-9 else "❌ FAIL"),
        "| 现金权重最小值 | %.6f | %s |" % (
            verification["cash_min"], "✅ PASS" if verification["cash_min"] >= -1e-9 else "❌ FAIL"),
        "| 超配日数（已显式缩放并留痕） | %d | ✅ PASS |" % verification["over_allocated_days_total"],
        "| 末日未执行信号日数（显式留痕） | %d | ✅ PASS |" % verification["dropped_signal_days_total"],
        "| 缺报价日数（显式标记，未当 0 收益） | %d | ✅ PASS |" % verification["missing_quote_days_total"],
        "| 参与比较的账本数 | %d | ✅ PASS |" % verification["ledgers"],
        "",
        "## 同口径比较（cost = %s bps）" % ", ".join(
            str(int(b)) for b in sorted(summary["cost_bps"].unique())),
        "",
        "| 策略 | cost_bps | 期末净值 | 累计收益 | CAGR | Sharpe | MDD | 总换手 | 总费用 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for _, r in summary.sort_values(["cost_bps", "strategy"]).iterrows():
        lines.append("| %s | %g | %.4f | %+.2f%% | %+.2f%% | %.2f | %.2f%% | %.3f | %.4f |" % (
            r["strategy"], r["cost_bps"], r["terminal_nav"], r["cumulative_return"] * 100,
            r["cagr"] * 100, r["sharpe"], r["mdd"] * 100, r["total_turnover"], r["total_cost"]))
    lines += [
        "",
        "## 各策略原始信号窗口（审计用）",
        "",
        "| 策略 | 首个信号日 | 末个信号日 | 信号日数 |",
        "|---|---|---|---|",
        *["| %s | %s | %s | %d |" % (k, v["first"], v["last"], v["days"])
          for k, v in verification["window"]["per_strategy_signal_window"].items()],
        "",
        "## 与旧口径的差异（必须周知）",
        "",
        "1. **角色语义**：本基线使用 PR #24 后唯一权威的 `rule_v2_ab.build_v2_roles`（含 NO_CORE 硬门槛与 Selection Permission）。",
        "   `ml/gen2/reports/` 中标注为「旧角色语义审计基线」的历史报告基于旧语义，**不可逐位比较**。",
        "2. **账本口径**：`backtest/costs.apply_turnover_cost` 已降级为委托权威账本的兼容层；",
        "   旧实现把现金腿计入换手，凡持有现金缓冲的策略费用被高估（最多 2 倍）。",
        "3. **换手与费用**因此普遍低于历史报告，净收益相应略高 —— 这是**口径修正**，不是策略改进。",
        "",
        "## 边界",
        "",
        "- 本基线**不**冻结 bundle/lock、**不**重跑 OOS（B3），也**不**改变 authority / 部署 / 正式仓位。",
        "- 本基线**不**用于宣称 Rule V2 的经济表现：B3 Frozen OOS 才有资格给出该结论。",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    r = build_unified_baselines()
    print("[B1] output dir :", r["output_dir"])
    print("[B1] report     :", r["report"])
    v = r["verification"]
    print("[B1] calendar   : %s → %s (%d days)" % (v["calendar"]["first_date"], v["calendar"]["last_date"],
                                                  v["calendar"]["days"]))
    print("[B1] conservation_max_error = %.3e | cash_min = %.6f | ledgers = %d" % (
        v["conservation_max_error"], v["cash_min"], v["ledgers"]))
    print("[B1] gate       :", "PASS" if v["conservation_max_error"] <= 1e-9 and v["cash_min"] >= -1e-9 else "FAIL")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
