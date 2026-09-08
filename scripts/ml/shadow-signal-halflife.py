#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Signal Half-Life observer (read-only). Does not change Gen-1.

For each Fast SIGNAL at T0, re-score same (code) on T+1..T+N using frozen model
and report mean calibrated probability path.

  python3 scripts/ml/shadow-signal-halflife.py
  python3 scripts/ml/shadow-signal-halflife.py --horizon=5
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "HVT-A-ET-20260830"
MODEL_DIR = ROOT / "ml" / "models" / MODEL_ID
SHADOW_DIR = ROOT / "ml" / "shadow" / MODEL_ID


def latest(pat: str) -> Path:
    hits = sorted(ROOT.glob(pat), reverse=True)
    if not hits:
        raise SystemExit(f"missing {pat}")
    return hits[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=5)
    args = ap.parse_args()
    h = int(args.horizon)

    sig_path = SHADOW_DIR / "ledger_signals.csv"
    if not sig_path.exists():
        # fall back to rehearsal for plumbing only
        alt = SHADOW_DIR / "_rehearsal_20251220" / "ledger_signals.csv"
        if not alt.exists():
            raise SystemExit("no ledger_signals.csv yet")
        sig_path = alt
        print("NOTE: using rehearsal ledger (not official OOS)")

    man = json.loads((MODEL_DIR / "freeze_manifest.json").read_text(encoding="utf-8"))
    model = joblib.load(MODEL_DIR / "model.joblib")
    core = list(man.get("features_core", []))
    cat = list(man.get("features_cat", []))
    cols = core + cat
    thr = float(man.get("thresholds", {}).get("signal_p", 0.65))

    events = pd.read_csv(latest("ml/datasets/hvt_refined_*.csv"))
    events["date"] = pd.to_datetime(events["date"])
    events["code"] = events["code"].astype(str)
    for c in cat:
        if c not in events.columns:
            events[c] = "NA"
        events[c] = events[c].astype(str).fillna("NA")
    for c in core:
        if c not in events.columns:
            events[c] = np.nan

    sig = pd.read_csv(sig_path)
    sig["date"] = pd.to_datetime(sig["date"])
    sig["code"] = sig["code"].astype(str)
    fast = sig[sig["ml_fast"].astype(str).isin(["True", "true", "1"])].copy()
    if fast.empty:
        print(json.dumps({"n_fast": 0, "halflife_days": None}, indent=2))
        return

    # score all event rows once
    events["p"] = model.predict_proba(events[cols])[:, 1]
    by = {(str(r.code), pd.Timestamp(r.date)): float(r.p) for r in events.itertuples()}

    paths = []
    for _, r in fast.iterrows():
        code = str(r["code"])
        d0 = pd.Timestamp(r["date"])
        series = []
        for k in range(0, h + 1):
            # next k event-days for this code after d0 (calendar approx via event dates)
            sub = events[(events["code"] == code) & (events["date"] >= d0)].sort_values("date")
            if len(sub) <= k:
                series.append(float("nan"))
            else:
                series.append(float(sub.iloc[k]["p"]))
        paths.append(series)

    arr = np.array(paths, dtype=float)
    mean_path = np.nanmean(arr, axis=0).tolist()
    # half-life: first k where mean_p <= 0.5 * mean_p[0] (or below signal thr)
    p0 = mean_path[0] if mean_path else float("nan")
    half = None
    if p0 == p0 and p0 > 0:
        target = max(0.5 * p0, thr * 0.85)
        for k, v in enumerate(mean_path):
            if k == 0:
                continue
            if v == v and v <= target:
                half = k
                break

    out = {
        "model_id": MODEL_ID,
        "n_fast": int(len(fast)),
        "horizon": h,
        "mean_probability_path": [None if (v != v) else round(float(v), 4) for v in mean_path],
        "halflife_days": half,
        "note": "Observe-only. Does not change Gen-1. Official half-life uses post-train_end Fast signals.",
    }
    out_path = SHADOW_DIR / "signal_halflife.json"
    if "_rehearsal_" in str(sig_path):
        out_path = sig_path.parent / "signal_halflife.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
