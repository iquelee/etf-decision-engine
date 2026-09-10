"""Gen-1 frozen model 的独立 Python 推理实现（WP-G1 / G1-08）。

用途：与 Node 侧 `cloudfunctions/runGen1ShadowEod/frozen-node-inference.js`
对**同一份** `frozen-model.json`（ExtraTrees×3 folds + isotonic 校准）做交叉验证，
证明两条语言的实现给出相同概率（max_abs_diff < 1e-10）。

注意：本实现刻意**独立重写** sklearn 语义（数值中位数填充、序数编码、ExtraTrees 平均、
isotonic 线性插值），不复用 Node 代码，以保证 parity 检查有意义。

不训练、不修改模型；只读。

CLI:
    python scripts/ml/gen1_frozen_inference.py --fixture <fixture.json> --out <out.json>
"""
from __future__ import annotations

import argparse
import json
import math
import os

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_MODEL = os.path.join(REPO, "cloudfunctions", "runGen1ShadowEod", "frozen-model.json")


def _finite(value, fallback):
    """对齐 JS Number.isFinite 语义：null/''/NaN/±Inf 一律回退。"""
    if value is None or value == "":
        return fallback
    try:
        n = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(n):
        return fallback
    return n


def encode_row(row, fold, features_core, features_cat):
    numeric = [_finite(row.get(name), fold["numeric_medians"][i]) for i, name in enumerate(features_core)]
    categorical = []
    for i, name in enumerate(features_cat):
        value = row.get(name)
        if value is None or value == "":
            value = fold["categorical_modes"][i]
        value = str(value)
        try:
            encoded = fold["categories"][i].index(value)
        except ValueError:
            encoded = -1
        categorical.append(encoded)
    return numeric + categorical


def tree_probability(nodes, values):
    node = 0
    for _ in range(128):
        if node < 0 or node >= len(nodes):
            raise ValueError("Invalid frozen Gen-1 tree node")
        current = nodes[node]
        if current["left"] < 0:
            return current["p1"]
        node = current["left"] if values[current["feature"]] <= current["threshold"] else current["right"]
    raise ValueError("Frozen Gen-1 tree depth exceeded guard")


def isotonic(raw, calibration):
    xs = calibration["x"]
    ys = calibration["y"]
    if raw <= xs[0]:
        return ys[0]
    last = len(xs) - 1
    if raw >= xs[last]:
        return ys[last]
    low, high = 0, last
    while high - low > 1:
        mid = (low + high) // 2
        if xs[mid] <= raw:
            low = mid
        else:
            high = mid
    fraction = (raw - xs[low]) / (xs[high] - xs[low])
    return ys[low] + (ys[high] - ys[low]) * fraction


def predict_probability(model, row):
    features_core = model["features_core"]
    features_cat = model["features_cat"]
    fold_probabilities = []
    for fold in model["folds"]:
        values = encode_row(row, fold, features_core, features_cat)
        raw = sum(tree_probability(tree, values) for tree in fold["trees"]) / len(fold["trees"])
        fold_probabilities.append(isotonic(raw, fold["isotonic"]))
    return sum(fold_probabilities) / len(fold_probabilities)


def load_model(path=None):
    with open(path or DEFAULT_MODEL, encoding="utf-8") as handle:
        return json.load(handle)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    model = load_model(args.model)
    if model.get("model_id") != "HVT-A-ET-20260830":
        raise SystemExit(f"unexpected model_id: {model.get('model_id')}")

    with open(args.fixture, encoding="utf-8") as handle:
        fixture = json.load(handle)

    out = []
    for entry in fixture["rows"]:
        payload = dict(entry["features"])
        payload["code"] = entry.get("code")
        out.append({"row_id": entry["row_id"], "probability": predict_probability(model, payload)})

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump({"model_id": model["model_id"], "rows": out}, handle, ensure_ascii=False)
    print(json.dumps({"ok": True, "rows": len(out), "out": args.out}))


if __name__ == "__main__":
    main()
