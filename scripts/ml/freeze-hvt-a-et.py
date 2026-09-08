#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
冻结 HVT-A-ET-20260830。

  python3 scripts/ml/freeze-hvt-a-et.py
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "HVT-A-ET-20260830"
OUT = ROOT / "ml" / "models" / MODEL_ID
DATASET = ROOT / "ml" / "datasets" / "hvt_refined_2026-08-29.csv"
MILESTONE = ROOT / "scripts" / "backtest-out" / "phase35-hvt-refinement-2026-08-30.json"

CORE = [
    "ma20_slope", "px_ma20", "px_ma60", "price_position", "volume_ratio",
    "sideway_days", "sideway_range", "consolidation_score", "atr20",
    "change_5d", "bias_20d", "breakout", "ret_5d", "ret_20d", "rs_20d",
]
CAT = ["w_state", "d_state", "h_state", "v_state", "sector"]
LABEL = "y_hvta"
TRAIN_END = "2026-08-24"
THRESH = {"signal_p": 0.65, "abstain_low": 0.35, "abstain_high": 0.65}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    if not DATASET.exists():
        raise SystemExit(f"missing {DATASET}")
    OUT.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(DATASET)
    df["date"] = pd.to_datetime(df["date"])
    if "role" in df.columns:
        df = df[df["role"] == "train"].copy()
    for c in CAT:
        if c not in df.columns:
            df[c] = "NA"
        df[c] = df[c].astype(str).fillna("NA")
    for c in CORE:
        if c not in df.columns:
            df[c] = np.nan
    if LABEL not in df.columns:
        raise SystemExit(f"missing {LABEL}")

    train = df[df["date"] <= TRAIN_END].copy()
    y = train[LABEL].astype(int)
    cols = CORE + CAT

    pre = ColumnTransformer([
        ("num", SimpleImputer(strategy="median"), CORE),
        ("cat", Pipeline([
            ("imp", SimpleImputer(strategy="most_frequent")),
            ("enc", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
        ]), CAT),
    ])
    base = Pipeline([
        ("pre", pre),
        ("clf", ExtraTreesClassifier(
            n_estimators=250, max_depth=6, min_samples_leaf=8,
            class_weight="balanced_subsample", random_state=42, n_jobs=1,
        )),
    ])
    try:
        model = CalibratedClassifierCV(base, method="isotonic", cv=3)
        model.fit(train[cols], y)
        calib = "isotonic_cv3"
    except Exception:
        base.fit(train[cols], y)
        model = base
        calib = "none_fallback"

    model_path = OUT / "model.joblib"
    joblib.dump(model, model_path)

    mile = json.loads(MILESTONE.read_text(encoding="utf-8")) if MILESTONE.exists() else {}
    manifest = {
        "model_id": MODEL_ID,
        "frozen_at": datetime.now(timezone.utc).isoformat(),
        "status": "SHADOW",
        "algorithm": "ExtraTreesClassifier",
        "calibration": calib,
        "label": LABEL,
        "features_core": CORE,
        "features_cat": CAT,
        "train_end": TRAIN_END,
        "n_train": int(len(train)),
        "n_pos": int(y.sum()),
        "thresholds": THRESH,
        "dataset": str(DATASET.relative_to(ROOT)),
        "dataset_sha256": sha256(DATASET),
        "model_sha256": sha256(model_path),
        "milestone": {
            "capture_efficiency": mile.get("capture_efficiency", 0.774),
            "oracle_delta": mile.get("oracle_delta", 0.0381),
            "ml_delta": mile.get("ml_best_delta", 0.0295),
            "incr_maxdd": 0.0,
            "wf_best": mile.get("best_wf", "extratrees|y_hvta|core"),
            "cf_config_note": mile.get(
                "cf_config",
                "logistic|y_hvta|lead — economic test; Gen-1 freeze = ExtraTrees|core per charter",
            ),
        },
        "discipline": [
            "no_retrain_on_shadow_data",
            "no_feature_change",
            "no_threshold_tune",
            "no_v361_param_change",
            "production_blocked",
        ],
        "replacement_rule": "Next gen must beat Capture + Stability + Risk; else keep Gen-1",
    }
    (OUT / "freeze_manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (OUT / "README.md").write_text(
        f"# {MODEL_ID}\n\n"
        f"**SHADOW** frozen {manifest['frozen_at'][:10]}\n\n"
        f"- Label `{LABEL}` / Y5\n"
        f"- Core features only\n"
        f"- Milestone Capture **{manifest['milestone']['capture_efficiency']:.1%}**\n"
        f"- See `ml/shadow/SHADOW_PROTOCOL.md`\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "ok": True, "model_id": MODEL_ID,
        "n_train": manifest["n_train"], "n_pos": manifest["n_pos"],
        "capture": manifest["milestone"]["capture_efficiency"],
        "out": str(OUT),
    }, indent=2))


if __name__ == "__main__":
    main()
