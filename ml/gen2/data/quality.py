from __future__ import annotations

from pathlib import Path

import pandas as pd

from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_universe_records
from gen2.data.schema import validate_daily_bars


def build_quality_report(bars: pd.DataFrame, min_history_days: int = 120) -> tuple[pd.DataFrame, pd.DataFrame]:
    validate_daily_bars(bars)
    records = load_universe_records()
    rows = []
    missing_rows = []

    benchmark_dates = sorted(bars.loc[bars["code"] == "510300", "trade_date"].unique())
    benchmark_set = set(benchmark_dates)

    for code, g in bars.groupby("code"):
        g = g.sort_values("trade_date")
        dates = list(g["trade_date"])
        expected = [d for d in benchmark_dates if dates[0] <= d <= dates[-1]]
        actual_set = set(dates)
        missing = [d for d in expected if d not in actual_set]
        returns = g["close"].pct_change()
        outliers = g.loc[returns.abs() > 0.20, "trade_date"].tolist()
        dup = int(g.duplicated(["code", "trade_date"]).sum())
        feature_ready = dates[min_history_days - 1] if len(dates) >= min_history_days else None
        stale_days = int(sum((pd.Timestamp(b) - pd.Timestamp(a)).days > 7 for a, b in zip(dates, dates[1:])))

        rec = records.get(code)
        rows.append({
            "code": code,
            "name": rec.name if rec else "",
            "cluster": rec.correlation_cluster if rec else "",
            "rows": len(g),
            "start_date": dates[0],
            "end_date": dates[-1],
            "listing_age_days": len(dates),
            "feature_ready_date": feature_ready,
            "missing_days_vs_benchmark": len(missing),
            "stale_days_gt_7_calendar_days": stale_days,
            "duplicate_rows": dup,
            "outlier_rows_abs_ret_gt_20pct": len(outliers),
            "amount_estimated_rows": int(g.get("amount_estimated", pd.Series(False, index=g.index)).sum()),
        })
        for d in missing:
            missing_rows.append({"code": code, "missing_trade_date": d})

    return pd.DataFrame(rows), pd.DataFrame(missing_rows, columns=["code", "missing_trade_date"])


def write_quality_outputs(output_dir: str | Path | None = None) -> Path:
    bars = load_daily_bars()
    coverage, missing = build_quality_report(bars)
    out = Path(output_dir) if output_dir else GEN2_ROOT / "outputs"
    out.mkdir(parents=True, exist_ok=True)
    coverage_path = out / "universe_data_quality_v0.csv"
    missing_path = out / "missing_days_v0.csv"
    coverage.to_csv(coverage_path, index=False)
    missing.to_csv(missing_path, index=False)

    report = GEN2_ROOT / "reports" / "universe_data_quality_v0.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    total_missing = int(coverage["missing_days_vs_benchmark"].sum())
    total_dup = int(coverage["duplicate_rows"].sum())
    total_outliers = int(coverage["outlier_rows_abs_ret_gt_20pct"].sum())
    lines = [
        "# Gen-2 Universe Data Quality v0",
        "",
        "**数据范围**：`deliverables/etf_daily_ml_pool/` 本地前复权日线",
        "",
        "## 汇总",
        "",
        f"- ETF 数量：{len(coverage)}",
        f"- 总行数：{int(coverage['rows'].sum())}",
        f"- 日期范围：{coverage['start_date'].min()} 至 {coverage['end_date'].max()}",
        f"- 缺失交易日（相对沪深300日历）：{total_missing}",
        f"- 重复行：{total_dup}",
        f"- 绝对单日涨跌 >20% 异常行：{total_outliers}",
        f"- 成交额缺失后按 close×volume 估算行：{int(coverage['amount_estimated_rows'].sum())}",
        "",
        "## 覆盖明细",
        "",
        "```csv",
        coverage.to_csv(index=False).strip(),
        "```",
        "",
        "## 判定",
        "",
        "PASS：唯一键、OHLC 合法性、非负成交量/成交额、source_trade_date <= trade_date 均已通过硬断言。",
        f"数据截止日：{coverage['end_date'].max()}；最早截止标的：{coverage['end_date'].min()}。后续若出现截止日不一致，需在横截面排名中标注数据新鲜度。",
    ]
    report.write_text("\n".join(lines), encoding="utf-8")
    return report


if __name__ == "__main__":
    path = write_quality_outputs()
    print(f"OK: {path}")
