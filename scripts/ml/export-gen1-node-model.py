"""Export the frozen Gen-1 sklearn artifact to a read-only Node.js format.

The export preserves the three calibrated ExtraTrees folds, imputers,
ordinal categories, and isotonic calibration knots.  It never trains or
changes the source model.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib


def number(value):
    return None if value is None else float(value)


def export_tree(tree):
    raw = tree.tree_
    nodes = []
    for index in range(raw.node_count):
        counts = raw.value[index][0]
        total = float(sum(counts))
        nodes.append({
            "left": int(raw.children_left[index]),
            "right": int(raw.children_right[index]),
            "feature": int(raw.feature[index]),
            "threshold": number(raw.threshold[index]),
            "p1": float(counts[1] / total) if total else 0.0,
        })
    return nodes


def export_fold(calibrated):
    pipeline = calibrated.estimator
    pre = pipeline.named_steps["pre"]
    numeric = pre.named_transformers_["num"]
    categorical = pre.named_transformers_["cat"]
    encoder = categorical.named_steps["enc"]
    calibrator = calibrated.calibrators[0]
    forest = pipeline.named_steps["clf"]
    return {
        "numeric_medians": [number(value) for value in numeric.statistics_],
        "categorical_modes": [str(value) for value in categorical.named_steps["imp"].statistics_],
        "categories": [[str(value) for value in values] for values in encoder.categories_],
        "isotonic": {
            "x": [number(value) for value in calibrator.X_thresholds_],
            "y": [number(value) for value in calibrator.y_thresholds_],
        },
        "trees": [export_tree(tree) for tree in forest.estimators_],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    model = joblib.load(args.model)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if type(model).__name__ != "CalibratedClassifierCV":
        raise RuntimeError(f"Expected CalibratedClassifierCV, received {type(model)!r}")

    result = {
        "format": "gen1-extra-trees-isotonic-v1",
        "model_id": manifest["model_id"],
        "features_core": manifest["features_core"],
        "features_cat": manifest["features_cat"],
        "folds": [export_fold(fold) for fold in model.calibrated_classifiers_],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Exported {len(result['folds'])} calibrated folds to {args.output}")


if __name__ == "__main__":
    main()
