#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read-only capability audit for the frozen Gen-1 artifact.

This program never writes a model, threshold, feature definition, CloudBase
record, or trading decision.  It creates a dated report from immutable model
inputs and parallel research re-fits only, using group-purged outer OOS folds.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder, StandardScaler


ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "ml" / "models" / "HVT-A-ET-20260830"
DATASET = ROOT / "ml" / "datasets" / "hvt_refined_2026-08-29.csv"
LIVE_DATASET = ROOT / "ml" / "datasets" / "hvt_live_inference_2026-09-02.csv"
OUT_DIR = ROOT / "ml" / "diagnostics"

FOLDS = (
    ("WF1", "2024-12-20", "2025-01-01", "2025-06-30"),
    ("WF2", "2025-07-21", "2025-08-01", "2025-12-31"),
    ("WF3", "2026-03-21", "2026-04-01", "2026-08-24"),
)
THRESHOLDS = (0.55, 0.60, 0.65, 0.70, 0.75)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def code(value: object) -> str:
    text = str(value)
    return str(int(text)) if text.isdigit() else text


def finite(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def metric_auc(y: pd.Series, p: pd.Series) -> float | None:
    if y.nunique() < 2 or y.sum() < 2 or (len(y) - y.sum()) < 2:
        return None
    return float(roc_auc_score(y, p))


def metric_ap(y: pd.Series, p: pd.Series) -> float | None:
    if y.sum() < 1:
        return None
    return float(average_precision_score(y, p))


def pct(value: float | None) -> str:
    return "—" if value is None or not np.isfinite(value) else f"{value * 100:.1f}%"


def num(value: float | None, digits: int = 3) -> str:
    return "—" if value is None or not np.isfinite(value) else f"{value:.{digits}f}"


@dataclass(frozen=True)
class Spec:
    model_id: str
    core: tuple[str, ...]
    cat: tuple[str, ...]
    threshold: float
    train_end: str


def load_inputs() -> tuple[Spec, object, pd.DataFrame]:
    manifest = json.loads((MODEL_DIR / "freeze_manifest.json").read_text(encoding="utf-8"))
    model = joblib.load(MODEL_DIR / "model.joblib")
    data = pd.read_csv(DATASET)
    data = data[data["role"].astype(str) == "train"].copy()
    data["date"] = pd.to_datetime(data["date"])
    data["code"] = data["code"].map(code)
    data["event_cluster_id"] = data["event_cluster_id"].astype(str)
    for column in manifest["features_cat"]:
        data[column] = data[column].fillna("NA").astype(str)
    return (
        Spec(
            model_id=manifest["model_id"],
            core=tuple(manifest["features_core"]),
            cat=tuple(manifest["features_cat"]),
            threshold=float(manifest["thresholds"]["signal_p"]),
            train_end=str(manifest["train_end"]),
        ),
        model,
        data,
    )


def pipeline(spec: Spec, family: str, seed: int, core: tuple[str, ...] | None = None) -> Pipeline:
    numeric = list(core or spec.core)
    if family == "logistic":
        numeric_pipe = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scale", StandardScaler())])
        estimator = LogisticRegression(max_iter=1000, class_weight="balanced", C=0.5, random_state=seed)
    else:
        numeric_pipe = SimpleImputer(strategy="median")
        estimator = ExtraTreesClassifier(
            n_estimators=250, max_depth=6, min_samples_leaf=8,
            class_weight="balanced_subsample", random_state=seed, n_jobs=1,
        )
    pre = ColumnTransformer([
        ("num", numeric_pipe, numeric),
        ("cat", Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
        ]), list(spec.cat)),
    ])
    return Pipeline([("pre", pre), ("clf", estimator)])


def purged_split(data: pd.DataFrame, train_end: str, oos_start: str, oos_end: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    # HVT labels use a 10-day forward outcome.  A 10 calendar-day embargo avoids
    # a label generated near the boundary contaminating the OOS interpretation.
    cutoff = pd.Timestamp(train_end)
    oos = data[(data["date"] >= oos_start) & (data["date"] <= oos_end)].copy()
    blocked_clusters = set(oos["event_cluster_id"])
    train = data[(data["date"] <= cutoff) & (~data["event_cluster_id"].isin(blocked_clusters))].copy()
    return train, oos


def grouped_calibrator(base: Pipeline, train: pd.DataFrame, columns: list[str], label: str):
    groups = train["event_cluster_id"].astype(str).to_numpy()
    n_groups = len(set(groups))
    if n_groups < 3:
        base.fit(train[columns], train[label].astype(int))
        return base
    splitter = GroupKFold(n_splits=min(3, n_groups))
    splits = list(splitter.split(train[columns], train[label].astype(int), groups))
    calibrated = CalibratedClassifierCV(base, method="isotonic", cv=splits)
    calibrated.fit(train[columns], train[label].astype(int))
    return calibrated


def oof_predictions(data: pd.DataFrame, spec: Spec, family: str = "extra_trees", seed: int = 42,
                    core: tuple[str, ...] | None = None) -> tuple[pd.DataFrame, list[dict]]:
    label = "y_hvta"
    actual_core = tuple(core or spec.core)
    columns = list(actual_core + spec.cat)
    rows: list[pd.DataFrame] = []
    diagnostics: list[dict] = []
    for name, train_end, oos_start, oos_end in FOLDS:
        train, oos = purged_split(data, train_end, oos_start, oos_end)
        if train[label].sum() < 8 or len(oos) < 12 or oos[label].nunique() < 2:
            diagnostics.append({"fold": name, "skip": True, "n_train": len(train), "n_oos": len(oos)})
            continue
        model = grouped_calibrator(pipeline(spec, family, seed, actual_core), train, columns, label)
        part = oos[["date", "code", "event_cluster_id", label, "y_ret10"]].copy()
        part["p"] = model.predict_proba(oos[columns])[:, 1]
        part["fold"] = name
        rows.append(part)
        diagnostics.append({
            "fold": name, "skip": False, "n_train": len(train), "n_oos": len(oos),
            "n_events": int(oos["event_cluster_id"].nunique()), "pos_oos": int(oos[label].sum()),
            "auc_raw": metric_auc(part[label], part["p"]), "ap_raw": metric_ap(part[label], part["p"]),
        })
    if not rows:
        return pd.DataFrame(columns=["date", "code", "event_cluster_id", label, "y_ret10", "p", "fold"]), diagnostics
    return pd.concat(rows, ignore_index=True), diagnostics


def event_level(rows: pd.DataFrame) -> pd.DataFrame:
    if rows.empty:
        return rows
    selected = rows.sort_values("p", ascending=False).groupby("event_cluster_id", as_index=False).first()
    labels = rows.groupby("event_cluster_id", as_index=False)["y_hvta"].max()
    selected = selected.drop(columns=["y_hvta"]).merge(labels, on="event_cluster_id", how="left")
    return selected


def threshold_stats(events: pd.DataFrame, threshold: float) -> dict:
    hit = events[events["p"] >= threshold]
    positives = int(events["y_hvta"].sum())
    tp = int(hit["y_hvta"].sum())
    precision = (tp / len(hit)) if len(hit) else None
    capture = (tp / positives) if positives else None
    false = hit[hit["y_hvta"] == 0]
    values = pd.to_numeric(false["y_ret10"], errors="coerce").dropna()
    return {
        "threshold": threshold, "signals": int(len(hit)), "tp": tp, "positives": positives,
        "precision": precision, "capture": capture,
        "false_fast_path_mean_return": float(values.mean()) if len(values) else None,
        "false_fast_path_downside": float(values.clip(upper=0).mean()) if len(values) else None,
    }


def bootstrap(events: pd.DataFrame, threshold: float, draws: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    if events.empty or events["y_hvta"].sum() < 3:
        return {"draws": 0, "precision_bootstrap_ci": None, "precision_wilson_ci": None, "capture_ci": None}
    precision: list[float] = []
    capture: list[float] = []
    n = len(events)
    for _ in range(draws):
        sample = events.iloc[rng.integers(0, n, size=n)]
        stat = threshold_stats(sample, threshold)
        if stat["precision"] is not None:
            precision.append(stat["precision"])
        if stat["capture"] is not None:
            capture.append(stat["capture"])
    interval = lambda values: [float(np.quantile(values, 0.025)), float(np.quantile(values, 0.975))] if values else None
    observed = threshold_stats(events, threshold)
    return {
        "draws": draws,
        # Conditional bootstrap is degenerate when every observed signal is a
        # success. Wilson expresses the finite-signal uncertainty directly.
        "precision_bootstrap_ci": interval(precision),
        "precision_wilson_ci": wilson_interval(observed["tp"], observed["signals"]),
        "capture_ci": interval(capture),
    }


def wilson_interval(successes: int, total: int, z: float = 1.959963984540054) -> list[float] | None:
    if total <= 0:
        return None
    proportion = successes / total
    denominator = 1 + z * z / total
    center = (proportion + z * z / (2 * total)) / denominator
    radius = z * np.sqrt((proportion * (1 - proportion) + z * z / (4 * total)) / total) / denominator
    return [float(max(0, center - radius)), float(min(1, center + radius))]


def calibration(events: pd.DataFrame) -> list[dict]:
    if len(events) < 20:
        return []
    try:
        bins = pd.qcut(events["p"], q=min(5, events["p"].nunique()), duplicates="drop")
    except ValueError:
        return []
    frame = events.assign(bucket=bins).groupby("bucket", observed=True).agg(
        n=("y_hvta", "size"), predicted=("p", "mean"), observed=("y_hvta", "mean")
    ).reset_index()
    return [{"bucket": str(row.bucket), "n": int(row.n), "predicted": float(row.predicted), "observed": float(row.observed)}
            for row in frame.itertuples(index=False)]


def model_categories(model: object, spec: Spec) -> list[dict[str, set[str]]]:
    calibrated = getattr(model, "calibrated_classifiers_", [])
    if not calibrated:
        return [{column: set() for column in spec.cat}]
    output = []
    for calibrated_fold in calibrated:
        pre = calibrated_fold.estimator.named_steps["pre"]
        encoder = pre.named_transformers_["cat"].named_steps["enc"]
        output.append({column: {str(value) for value in values} for column, values in zip(spec.cat, encoder.categories_)})
    return output


def coverage(spec: Spec, model: object, data: pd.DataFrame) -> dict:
    fold_categories = model_categories(model, spec)
    union_categories = {column: set().union(*(fold[column] for fold in fold_categories)) for column in spec.cat}
    def classify(values: set[str]) -> dict[str, list[str]]:
        unknown_all: dict[str, list[str]] = {}
        partial: dict[str, list[str]] = {}
        for column in spec.cat:
            unknown_all[column] = sorted(values[column] - union_categories[column])
            partial[column] = sorted(value for value in values[column] & union_categories[column]
                                     if any(value not in fold[column] for fold in fold_categories))
        return {"unknown_all_folds": unknown_all, "partial_fold_coverage": partial}
    historical_values = {column: set(data[column].astype(str)) for column in spec.cat}
    historical = classify(historical_values)
    live_values = {column: set() for column in spec.cat}
    if LIVE_DATASET.exists():
        live_data = pd.read_csv(LIVE_DATASET)
        for column in spec.cat:
            if column in live_data:
                live_values[column] = set(live_data[column].dropna().astype(str))
    live = classify(live_values)
    missing = [column for column in spec.core + spec.cat if column not in data.columns]
    return {
        "missing_frozen_features": missing,
        "model_categories_by_calibration_fold": [
            {key: sorted(value) for key, value in fold.items()} for fold in fold_categories
        ],
        "historical_category_coverage": historical,
        "live_category_coverage": live,
        "status": "FAIL" if missing else (
            "WARN" if any(live["unknown_all_folds"].values()) or any(live["partial_fold_coverage"].values()) else "PASS"
        ),
    }


def stability(data: pd.DataFrame, spec: Spec, seeds: list[int]) -> tuple[list[dict], list[dict]]:
    rows: list[dict] = []
    for seed in seeds:
        daily, _ = oof_predictions(data, spec, seed=seed)
        events = event_level(daily)
        stat = threshold_stats(events, spec.threshold)
        rows.append({"family": "ExtraTrees", "seed": seed, "event_auc": metric_auc(events["y_hvta"], events["p"]),
                     "event_ap": metric_ap(events["y_hvta"], events["p"]), **stat})
    daily, _ = oof_predictions(data, spec, family="logistic", seed=42)
    events = event_level(daily)
    logistic = [{"family": "Logistic", "seed": 42, "event_auc": metric_auc(events["y_hvta"], events["p"]),
                 "event_ap": metric_ap(events["y_hvta"], events["p"]), **threshold_stats(events, spec.threshold)}]
    return rows, logistic


def ablation(data: pd.DataFrame, spec: Spec) -> list[dict]:
    results: list[dict] = []
    for feature in ("rs_20d", "breakout", "ma20_slope"):
        core = tuple(column for column in spec.core if column != feature)
        daily, _ = oof_predictions(data, spec, core=core)
        events = event_level(daily)
        results.append({"removed": feature, "event_auc": metric_auc(events["y_hvta"], events["p"]),
                        "event_ap": metric_ap(events["y_hvta"], events["p"]), **threshold_stats(events, spec.threshold)})
    return results


def verdict(coverage_data: dict, events: pd.DataFrame, default: dict, boot: dict, seeds: list[dict]) -> dict:
    prediction = "PASS" if (metric_auc(events["y_hvta"], events["p"]) or 0) >= 0.65 else "WARN"
    lower_capture = boot.get("capture_ci", [None, None])[0] if boot.get("capture_ci") else None
    robustness = "PASS" if lower_capture is not None and lower_capture > 0.35 else "WARN"
    stability_auc = [row["event_auc"] for row in seeds if row["event_auc"] is not None]
    stability = "PASS" if stability_auc and min(stability_auc) >= 0.60 else "WARN"
    return {
        "input_equivalence": coverage_data["status"],
        "prediction": prediction,
        "economic_value": "PENDING_LIVE_OOS",
        "calibration": "WARN" if len(events) < 80 else "REVIEW",
        "robustness": robustness,
        "seed_stability": stability,
        "live_oos": "PENDING",
        "note": "Historical audit is evidence, not permission to tune or replace frozen Gen-1.",
    }


def report(spec: Spec, manifest: dict, coverage_data: dict, folds: list[dict], events: pd.DataFrame,
           thresholds: list[dict], boot: dict, calibration_rows: list[dict], seed_rows: list[dict],
           logistic_rows: list[dict], ablation_rows: list[dict], verdict_data: dict) -> str:
    lines = [
        f"# Gen-1 Model Capability Audit — {spec.model_id}", "",
        "> 只读审计：不重训冻结工件、不改阈值、不写入 CloudBase、不改变任何交易/仓位决策。", "",
        "## 冻结输入核验", "",
        f"- `train_end`: {spec.train_end}",
        f"- dataset SHA-256: `{sha256(DATASET)}`", f"- model SHA-256: `{sha256(MODEL_DIR / 'model.joblib')}`",
        f"- manifest dataset hash match: **{sha256(DATASET) == manifest.get('dataset_sha256')}**",
        f"- manifest model hash match: **{sha256(MODEL_DIR / 'model.joblib') == manifest.get('model_sha256')}**", "",
        "## P0 — 特征等价与 OOD 覆盖", "",
        f"- Status: **{coverage_data['status']}**",
        f"- Missing frozen features: `{coverage_data['missing_frozen_features']}`",
        f"- Live unknown across all calibration folds: `{coverage_data['live_category_coverage']['unknown_all_folds']}`",
        f"- Live categories absent from at least one calibration fold: `{coverage_data['live_category_coverage']['partial_fold_coverage']}`", "",
        "## 独立事件级 Purged Walk-Forward", "",
        "| Fold | Train | OOS rows | OOS events | OOS positives | Raw AUC | Raw AP |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for row in folds:
        lines.append(f"| {row['fold']} | {row['n_train']} | {row['n_oos']} | {row.get('n_events', '—')} | {row.get('pos_oos', '—')} | {num(row.get('auc_raw'))} | {num(row.get('ap_raw'))} |")
    lines += ["", f"- Independent OOS events: **{len(events)}**; HVT-A events: **{int(events['y_hvta'].sum())}**",
              f"- Event AUC: **{num(metric_auc(events['y_hvta'], events['p']))}**; Event AP: **{num(metric_ap(events['y_hvta'], events['p']))}**", "",
              "## 阈值平台（研究评估；线上阈值仍冻结为 0.65）", "",
              "| Threshold | Signals | Precision | Capture | FP mean return | FP downside |",
              "|---:|---:|---:|---:|---:|---:|"]
    for row in thresholds:
        lines.append(f"| {row['threshold']:.2f} | {row['signals']} | {pct(row['precision'])} | {pct(row['capture'])} | {pct(row['false_fast_path_mean_return'])} | {pct(row['false_fast_path_downside'])} |")
    lines += ["", "## Event Bootstrap（0.65）", "",
              f"- draws: {boot['draws']}", f"- precision conditional-bootstrap CI: `{boot['precision_bootstrap_ci']}`",
              f"- precision Wilson 95% CI: `{boot['precision_wilson_ci']}`",
              f"- capture 95% CI: `{boot['capture_ci']}`", "",
              "## 五分位校准（样本量不支持十等分）", "",
              "| Probability bin | N | Mean predicted | Observed HVT-A |", "|---|---:|---:|---:|"]
    for row in calibration_rows:
        lines.append(f"| {row['bucket']} | {row['n']} | {pct(row['predicted'])} | {pct(row['observed'])} |")
    lines += ["", "## 稳定性与消融", "", "| Family / test | Seed | Event AUC | Event AP | Precision@.65 | Capture@.65 |",
              "|---|---:|---:|---:|---:|---:|"]
    for row in seed_rows + logistic_rows:
        lines.append(f"| {row['family']} | {row['seed']} | {num(row['event_auc'])} | {num(row['event_ap'])} | {pct(row['precision'])} | {pct(row['capture'])} |")
    for row in ablation_rows:
        lines.append(f"| ExtraTrees minus {row['removed']} | 42 | {num(row['event_auc'])} | {num(row['event_ap'])} | {pct(row['precision'])} | {pct(row['capture'])} |")
    lines += ["", "## 能力状态", "", "| Dimension | Status |", "|---|---|"]
    for key, value in verdict_data.items():
        if key != "note": lines.append(f"| {key} | **{value}** |")
    lines += ["", f"> {verdict_data['note']}", "", "## 结论边界", "",
              "- 历史 OOF 结果不是新的盲测；它只能检验分组、阈值、种子与特征扰动下的稳定性。",
              "- 真实 OOS 从 manifest 的 `train_end` 后开始；5/10 日 outcome 成熟前，经济价值与 live CER 必须保持 `PENDING`。",
              "- Cross-universe / negative-control 仅在特征分类语义一致时才可作为泛化证据；未知类别应先按 P0 修复或显式标记 OOD。"]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bootstrap-draws", type=int, default=2000)
    parser.add_argument("--seeds", default="1,7,19,42,88,2026")
    args = parser.parse_args()
    spec, frozen_model, data = load_inputs()
    manifest = json.loads((MODEL_DIR / "freeze_manifest.json").read_text(encoding="utf-8"))
    coverage_data = coverage(spec, frozen_model, data)
    daily, fold_rows = oof_predictions(data, spec)
    events = event_level(daily)
    threshold_rows = [threshold_stats(events, value) for value in THRESHOLDS]
    boot = bootstrap(events, spec.threshold, args.bootstrap_draws, seed=20260904)
    seed_rows, logistic_rows = stability(data, spec, [int(value) for value in args.seeds.split(",") if value.strip()])
    ablation_rows = ablation(data, spec)
    verdict_data = verdict(coverage_data, events, threshold_stats(events, spec.threshold), boot, seed_rows)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = pd.Timestamp.now(tz="Asia/Shanghai").strftime("%Y-%m-%d")
    json_path = OUT_DIR / f"gen1_capability_audit_{stamp}.json"
    md_path = OUT_DIR / f"gen1_capability_audit_{stamp}.md"
    payload = {
        "model_id": spec.model_id, "coverage": coverage_data, "folds": fold_rows,
        "event_summary": {"n": len(events), "positive": int(events["y_hvta"].sum()),
                          "auc": metric_auc(events["y_hvta"], events["p"]), "ap": metric_ap(events["y_hvta"], events["p"])},
        "thresholds": threshold_rows, "bootstrap": boot, "calibration_quintiles": calibration(events),
        "seed_stability": seed_rows, "logistic_baseline": logistic_rows, "ablation": ablation_rows,
        "verdict": verdict_data,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(report(spec, manifest, coverage_data, fold_rows, events, threshold_rows, boot,
                              calibration(events), seed_rows, logistic_rows, ablation_rows, verdict_data), encoding="utf-8")
    print(json.dumps({"json": str(json_path), "report": str(md_path), "verdict": verdict_data}, ensure_ascii=False))


if __name__ == "__main__":
    main()
