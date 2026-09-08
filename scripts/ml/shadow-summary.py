#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Shadow summary — fixed KPI order + CER_live + half-life.

  python3 scripts/ml/shadow-summary.py
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "HVT-A-ET-20260830"
SHADOW_DIR = ROOT / "ml" / "shadow" / MODEL_ID
REPORT = ROOT / "回测报告"
ORACLE_INCR_BENCH = 0.0381  # historical Oracle opportunity (+3.81pp)
TRAIN_END = "2026-08-24"


def roll_sum(s: pd.Series, n: int) -> float:
    if s is None or len(s) == 0:
        return float("nan")
    return float(s.tail(n).sum())


def main():
    ledger_path = SHADOW_DIR / "ledger_daily.csv"
    signal_path = SHADOW_DIR / "ledger_signals.csv"
    status_path = SHADOW_DIR / "shadow_status.json"
    half_path = SHADOW_DIR / "signal_halflife.json"
    status = json.loads(status_path.read_text(encoding="utf-8")) if status_path.exists() else {}
    half = json.loads(half_path.read_text(encoding="utf-8")) if half_path.exists() else {}
    stamp = datetime.utcnow().strftime("%Y-%m-%d")

    lines = [
        f"# Shadow Summary — {MODEL_ID}",
        "",
        f"生成：{stamp}",
        "",
        "## 正式状态印章",
        "",
        "```text",
        "V3.6.1              = Production Baseline = FROZEN",
        "HVT-A-ET-20260830   = ML Challenger Gen-1 = FROZEN",
        "Shadow              = ACTIVE",
        "Fast Path           = NOT CONNECTED",
        "Production ML       = BLOCKED",
        "```",
        "",
        "## 运行状态",
        "",
        f"- status: **{status.get('status', 'n/a')}**",
        f"- breaker: `{status.get('breaker_level', '')}`",
        f"- FastPath Permission: **{status.get('fastpath_permission', 'n/a')}**",
        f"- reason: `{status.get('degrade_reason', '')}`",
        f"- asof: {status.get('asof', '')}",
        "",
    ]

    REPORT.mkdir(parents=True, exist_ok=True)
    out = REPORT / f"V4.0-Shadow-Summary-{MODEL_ID}-{stamp}.md"

    if not ledger_path.exists():
        lines += [
            "尚无官方 ledger。等待 `train_end=2026-08-24` 之后的交易日。",
            "",
            "日终：`bash scripts/ops/run-shadow-eod.sh [YYYY-MM-DD]`",
            "",
        ]
        out.write_text("\n".join(lines), encoding="utf-8")
        print("\n".join(lines))
        print(f"wrote {out}")
        return

    df = pd.read_csv(ledger_path)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")
    oos = df[df["date"] > pd.Timestamp(TRAIN_END)]
    use = oos if len(oos) else df

    sig = pd.read_csv(signal_path) if signal_path.exists() else pd.DataFrame()
    if not sig.empty:
        sig["date"] = pd.to_datetime(sig["date"])

    incr = float(df["incr_pnl"].sum())
    cer_live = incr / ORACLE_INCR_BENCH if ORACLE_INCR_BENCH else float("nan")

    ready = (
        sig[sig["outcome_ready"].astype(str).isin(["True", "true", "1"])]
        if (not sig.empty and "outcome_ready" in sig.columns)
        else pd.DataFrame()
    )
    fast = (
        ready[ready["ml_fast"].astype(str).isin(["True", "true", "1"])]
        if len(ready) else pd.DataFrame()
    )
    precision = float((fast["outcome_class"] == "A").mean()) if len(fast) else float("nan")
    false_cost = float("nan")
    if len(fast) and "mae" in fast.columns and (fast["outcome_class"] == "D").any():
        false_cost = float(fast.loc[fast["outcome_class"] == "D", "mae"].mean())

    cal_note = "n/a"
    if len(ready) and {"calibrated_probability", "y_reached_s4"}.issubset(ready.columns):
        p = ready["calibrated_probability"].astype(float)
        y = ready["y_reached_s4"].astype(float)
        if len(ready) >= 5:
            cal_note = (
                f"meanP={p.mean():.2f} hit={y.mean():.2f} "
                f"brier={float(np.mean((p - y) ** 2)):.3f}"
            )

    raw_n = int(df["raw_signal_count"].sum()) if "raw_signal_count" in df.columns else int(df["signals"].sum())
    indep_n = (
        int(df["independent_event_count"].sum())
        if "independent_event_count" in df.columns
        else raw_n
    )

    lines += [
        "## 五个生产 KPI（固定顺序）",
        "",
        f"1. **Incremental Alpha** Σ `{incr:+.4%}` | 30D `{roll_sum(use['incr_pnl'], 30):+.4%}` | 90D `{roll_sum(use['incr_pnl'], 90):+.4%}`",
        "2. **Timing Gain**：待 outcome 窗填满后统计",
        (
            f"3. **Fast Path Precision**：{precision:.1%}"
            if precision == precision else "3. **Fast Path Precision**：n/a"
        ),
        (
            f"4. **False Fast Path Cost (MAE)**：{false_cost:.2%}"
            if false_cost == false_cost else "4. **False Fast Path Cost**：n/a"
        ),
        f"5. **Calibration**：{cal_note}",
        "",
        "## CER_live",
        "",
        f"- Realized ML Alpha：`{incr:+.4%}`",
        f"- Historical Oracle Opportunity：`{ORACLE_INCR_BENCH:.2%}`",
        f"- **CER_live = {cer_live:.1%}**",
        "- 健康带 **60%～80%**（研究期 77.4%）；若仅 20%～30% → regime dependency 警告",
        "",
        "## Signal Half-Life（只观察，不改 Gen-1）",
        "",
        f"- n_fast：{half.get('n_fast', 'n/a')}",
        f"- mean P path：{half.get('mean_probability_path', 'n/a')}",
        f"- half-life days：**{half.get('halflife_days', 'n/a')}**",
        "",
        "## 样本稀释",
        "",
        f"- Raw Signal Count：{raw_n}",
        f"- Independent Event Count：{indep_n}",
        "",
        "## Permission / Outcome",
        "",
        f"- day-of A Effective：{int(df['permission_A_effective'].sum()) if 'permission_A_effective' in df.columns else 0}",
        f"- day-of B Blocked：{int(df['permission_B_blocked'].sum()) if 'permission_B_blocked' in df.columns else 0}",
    ]
    if len(ready) and "outcome_class" in ready.columns:
        oc = ready["outcome_class"].value_counts()
        lines += [
            f"- outcome A：{int(oc.get('A', 0))}",
            f"- outcome B：{int(oc.get('B', 0))}",
            f"- outcome C Missed：{int(oc.get('C', 0))}",
            f"- outcome D False Fast：{int(oc.get('D', 0))}",
            "",
            "B/C 只记录，本阶段不改 Rule。",
            "",
        ]

    lines += [
        "## 四道门",
        "",
        "```text",
        "SHADOW → CANARY → LIMITED PRODUCTION → FULL PRODUCTION",
        "```",
        "",
        "当前停在 **SHADOW**。第一次正式复盘只问：Alpha>0？ Timing 真实？ False Cost 可控？",
        "",
        "## 纪律",
        "",
        "- Gen-1 冻结；Shadow 禁止回流训练",
        "- Gen-2 仅 `ml/gen2/`，不可改 Gen-1 manifest",
        "- 生产仍执行 V3.6.1；Fast Path OFF",
        "",
        f"- `{ledger_path.relative_to(ROOT)}`",
        f"- `{signal_path.relative_to(ROOT)}`",
        f"- `{status_path.relative_to(ROOT)}`",
        "",
    ]

    out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:55]))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
