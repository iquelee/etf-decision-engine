#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build frozen Gen-1 inference rows from the newest local stage panel.

Inference-only: never retrains or modifies the freeze manifest.
"""
from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATASETS = ROOT / "ml" / "datasets"
MAIN5 = {"513310", "515880", "159582", "518880", "159570"}
SECTORS = {"513310": "storage", "515880": "ai_network", "159582": "semi_equip", "518880": "gold", "159570": "biotech"}
FEATURES = [
    "ma20_slope", "px_ma20", "px_ma60", "price_position", "volume_ratio",
    "sideway_days", "sideway_range", "consolidation_score", "atr20", "change_5d",
    "bias_20d", "breakout", "ret_5d", "ret_20d", "rs_20d", "w_state",
    "d_state", "h_state", "v_state", "sector",
]


def latest_panel() -> Path:
    files = sorted(DATASETS.glob("daily_stage_panel_*.csv"), reverse=True)
    if not files:
        raise SystemExit("missing daily stage panel; run export-daily-stage-panel.js first")
    return files[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="", help="optional YYYY-MM-DD source trading date")
    args = ap.parse_args()
    panel_path = latest_panel()
    panel = pd.read_csv(panel_path, dtype={"code": str})
    if panel.empty or "date" not in panel.columns:
        raise SystemExit(f"invalid stage panel: {panel_path}")
    panel["code"] = panel["code"].astype(str)
    panel["date"] = panel["date"].astype(str).str.slice(0, 10)
    available = panel[panel["code"].isin(MAIN5)].copy()
    if available.empty:
        raise SystemExit(f"stage panel has no Main5 rows: {panel_path}")
    day = args.date or sorted(available["date"].unique())[-1]
    rows = available[available["date"] == day].copy()
    missing = sorted(MAIN5 - set(rows["code"]))
    if missing:
        raise SystemExit(f"Main5 EOD panel incomplete for {day}: {','.join(missing)}")

    for field in FEATURES:
        if field not in rows.columns:
            rows[field] = None
    rows["sector"] = rows["code"].map(SECTORS).fillna(rows["sector"]).fillna("NA")
    rows["source_trade_date"] = day
    rows["main5"] = True
    rows["role"] = "inference"
    rows["event_cluster_id"] = rows["code"].map(lambda code: f"{code}_{day}")
    keep = [
        "code", "name", "sector", "main5", "date", "source_trade_date", "stage_t",
        "close", "ret_1d", "ret_5d", "stage", "stage_display", "event_cluster_id", "role",
    ] + FEATURES
    output = rows.reindex(columns=list(dict.fromkeys(keep)))
    destination = DATASETS / f"hvt_live_inference_{datetime.now():%Y-%m-%d}.csv"
    output.to_csv(destination, index=False)
    print(f"wrote {destination.relative_to(ROOT)} source_trade_date={day} rows={len(output)}")


if __name__ == "__main__":
    main()
