#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fill MAE/MFE + future stages + outcome classes A/B/C/D on Shadow signal ledger.

  python3 scripts/ml/shadow-reconcile-outcomes.py
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "HVT-A-ET-20260830"
SHADOW_DIR = ROOT / "ml" / "shadow" / MODEL_ID


def latest(pat: str) -> Path:
    hits = sorted(ROOT.glob(pat), reverse=True)
    if not hits:
        raise SystemExit(f"missing {pat}")
    return hits[0]


def stage_rank(s: str) -> int:
    try:
        return int(str(s).lstrip("Ss"))
    except Exception:
        return -1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=10)
    args = ap.parse_args()
    h = int(args.horizon)

    path = SHADOW_DIR / "ledger_signals.csv"
    if not path.exists():
        raise SystemExit("missing ledger_signals.csv")

    sig = pd.read_csv(path)
    sig["date"] = pd.to_datetime(sig["date"])
    sig["code"] = sig["code"].astype(str)

    panel = pd.read_csv(latest("ml/datasets/daily_stage_panel_*.csv"))
    panel["date"] = pd.to_datetime(panel["date"])
    panel["code"] = panel["code"].astype(str)
    panel = panel.sort_values(["code", "date"]).reset_index(drop=True)
    by_code = {c: g.reset_index(drop=True) for c, g in panel.groupby("code")}

    rows = []
    for _, r in sig.iterrows():
        row = r.to_dict()
        g = by_code.get(str(r["code"]))
        if g is None or "close" not in g.columns:
            rows.append(row)
            continue
        d0 = pd.Timestamp(r["date"])
        hit = g.index[g["date"] == d0]
        if len(hit) == 0:
            rows.append(row)
            continue
        i0 = int(hit[0])
        if i0 + h >= len(g):
            rows.append(row)
            continue

        entry = float(g.iloc[i0]["close"])
        fut = g.iloc[i0 + 1 : i0 + h + 1]
        if not np.isfinite(entry) or entry <= 0 or fut.empty:
            rows.append(row)
            continue

        rets = fut["close"].astype(float) / entry - 1.0
        mae = float(rets.min())
        mfe = float(rets.max())
        ret_h = float(rets.iloc[-1])
        st5 = str(fut.iloc[min(4, len(fut) - 1)]["stage"])
        st10 = str(fut.iloc[-1]["stage"])
        reached = any(stage_rank(s) >= 4 for s in fut["stage"].astype(str))

        ml_fast = str(r.get("ml_fast")) in ("True", "true", "1")
        gate = str(r.get("rule_gate", ""))
        if ml_fast and gate == "PERMIT" and reached:
            oc = "A"
        elif ml_fast and gate == "BLOCK":
            oc = "B"
        elif (not ml_fast) and reached:
            oc = "C"
        elif ml_fast and gate == "PERMIT" and not reached:
            oc = "D"
        else:
            oc = ""

        row.update({
            "future_5d_stage": st5,
            "future_10d_stage": st10,
            "future_10d_return": ret_h,
            "mae": mae,
            "mfe": mfe,
            "y_reached_s4": float(reached),
            "outcome_class": oc,
            "outcome_ready": True,
        })
        rows.append(row)

    out = pd.DataFrame(rows)
    out.to_csv(path, index=False)
    ready = out[out["outcome_ready"].astype(str).isin(["True", "true", "1"])]
    summary = {
        "n_signals": int(len(out)),
        "n_ready": int(len(ready)),
        "class_counts": ready["outcome_class"].value_counts().to_dict() if len(ready) else {},
        "mean_mae_on_fast": float(
            ready.loc[ready["ml_fast"].astype(str).isin(["True", "true", "1"]), "mae"].mean()
        ) if len(ready) else None,
        "mean_mfe_on_fast": float(
            ready.loc[ready["ml_fast"].astype(str).isin(["True", "true", "1"]), "mfe"].mean()
        ) if len(ready) else None,
    }
    (SHADOW_DIR / "outcome_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False, default=str), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
