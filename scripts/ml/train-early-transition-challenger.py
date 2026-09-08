#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V4.0 Challenger — LightGBM Early Transition Baseline
Walk-Forward + Probability Calibration + OOS 报告

- 不修改线上 V3.6.1
- 不上线 Fast Path
- 不用 Random Split
- Qlib 未装时用 LightGBM 等价协议（时间切分）；标注 engine=lightgbm-wf

用法：
  python3 scripts/ml/train-early-transition-challenger.py
  python3 scripts/ml/train-early-transition-challenger.py --csv=ml/datasets/early_transition_s2_clustered_2026-08-29.csv
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    brier_score_loss,
    roc_auc_score,
    average_precision_score,
    log_loss,
)

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "scripts" / "backtest-out"
REPORT_DIR = ROOT / "回测报告"
MODEL_DIR = ROOT / "ml" / "models" / "challenger_early_transition"

FEATURE_NUM = [
    "ma20_slope", "px_ma20", "px_ma60", "price_position", "volume_ratio",
    "sideway_days", "sideway_range", "consolidation_score", "atr20",
    "change_5d", "bias_20d", "breakout", "ret_5d", "ret_20d", "rs_20d",
]
FEATURE_CAT = ["w_state", "d_state", "h_state", "v_state", "sector"]

# 用户指定的时间切分（OOS 不参与选参/校准）
FOLDS = [
    {
        "name": "WF1",
        "train": ("2024-01-01", "2025-03-31"),
        "val": ("2025-04-01", "2025-07-31"),
        "oos": ("2025-08-01", "2025-12-31"),
    },
    {
        "name": "WF2",
        "train": ("2024-01-01", "2025-12-31"),
        "val": ("2026-01-01", "2026-03-31"),
        "oos": ("2026-04-01", "2026-08-24"),
    },
]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv", default="")
    return p.parse_args()


def find_csv(explicit: str) -> Path:
    if explicit:
        path = Path(explicit)
        return path if path.is_absolute() else ROOT / path
    cands = sorted((ROOT / "ml" / "datasets").glob("early_transition_s2_clustered_*.csv"), reverse=True)
    if not cands:
        cands = sorted((ROOT / "ml" / "datasets").glob("early_transition_s2_*.csv"), reverse=True)
    if not cands:
        raise SystemExit("无数据集 CSV")
    return cands[0]


def load_df(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"])
    if "event_cluster_id" not in df.columns:
        # fallback：同 code 10 日簇
        df = df.sort_values(["code", "date"]).copy()
        cids = []
        cid = 0
        prev_code, prev_dt = None, None
        for _, r in df.iterrows():
            if prev_code != r["code"] or prev_dt is None or (r["date"] - prev_dt).days > 10:
                cid += 1
            cids.append(cid)
            prev_code, prev_dt = r["code"], r["date"]
        df["event_cluster_id"] = cids
    for c in FEATURE_CAT:
        if c not in df.columns:
            df[c] = "NA"
        df[c] = df[c].fillna("NA").astype("category")
    for c in FEATURE_NUM:
        if c not in df.columns:
            df[c] = np.nan
        df[c] = pd.to_numeric(df[c], errors="coerce")
    # Regime 条件特征（审计同口径）
    rs = df["rs_20d"].fillna(df["ret_20d"])
    df["regime_proxy"] = np.where(rs >= 0.03, "bullish", np.where(rs <= -0.03, "bearish", "range"))
    df["regime_proxy"] = df["regime_proxy"].astype("category")
    df["y5"] = df["y5"].astype(int)
    df["y10"] = df["y10"].astype(int)
    # 簇权重：降低连续日相关
    vc = df.groupby("event_cluster_id")["event_cluster_id"].transform("count")
    df["sample_weight"] = 1.0 / vc.clip(lower=1)
    return df


def slice_range(df, start, end):
    s, e = pd.Timestamp(start), pd.Timestamp(end)
    return df[(df["date"] >= s) & (df["date"] <= e)].copy()


def feature_matrix(df):
    cols = FEATURE_NUM + FEATURE_CAT + ["regime_proxy"]
    return df[cols].copy()


def make_pipeline():
    cat_cols = FEATURE_CAT + ["regime_proxy"]
    num_cols = FEATURE_NUM
    pre = ColumnTransformer(
        transformers=[
            ("num", Pipeline([
                ("imp", SimpleImputer(strategy="median")),
            ]), num_cols),
            ("cat", Pipeline([
                ("imp", SimpleImputer(strategy="most_frequent")),
                ("ord", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
            ]), cat_cols),
        ]
    )
    clf = HistGradientBoostingClassifier(
        max_depth=5,
        learning_rate=0.06,
        max_iter=200,
        random_state=42,
    )
    return Pipeline([("pre", pre), ("clf", clf)])


def metrics_at(y_true, proba, threshold=0.5):
    y_true = np.asarray(y_true).astype(int)
    proba = np.asarray(proba, dtype=float)
    if len(y_true) == 0 or y_true.min() == y_true.max():
        return {
            "n": int(len(y_true)),
            "pos": int(y_true.sum()) if len(y_true) else 0,
            "auc": None,
            "ap": None,
            "brier": None,
            "logloss": None,
            "precision": None,
            "recall": None,
            "false_positive_rate": None,
            "precision_at_top10pct": None,
        }
    pred = (proba >= threshold).astype(int)
    tp = int(((pred == 1) & (y_true == 1)).sum())
    fp = int(((pred == 1) & (y_true == 0)).sum())
    fn = int(((pred == 0) & (y_true == 1)).sum())
    tn = int(((pred == 0) & (y_true == 0)).sum())
    prec = tp / (tp + fp) if (tp + fp) else None
    rec = tp / (tp + fn) if (tp + fn) else None
    fpr = fp / (fp + tn) if (fp + tn) else None
    # Precision@Top10%
    k = max(1, int(round(0.1 * len(proba))))
    top_idx = np.argsort(-proba)[:k]
    p_at = float(y_true[top_idx].mean())
    return {
        "n": int(len(y_true)),
        "pos": int(y_true.sum()),
        "auc": float(roc_auc_score(y_true, proba)),
        "ap": float(average_precision_score(y_true, proba)),
        "brier": float(brier_score_loss(y_true, proba)),
        "logloss": float(log_loss(y_true, proba, labels=[0, 1])),
        "precision": None if prec is None else round(prec, 4),
        "recall": None if rec is None else round(rec, 4),
        "false_positive_rate": None if fpr is None else round(fpr, 4),
        "precision_at_top10pct": round(p_at, 4),
        "threshold": threshold,
    }


def calibration_table(y_true, proba, bins=5):
    y_true = np.asarray(y_true).astype(int)
    proba = np.asarray(proba, dtype=float)
    if len(y_true) < 10:
        return []
    edges = np.linspace(0, 1, bins + 1)
    rows = []
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (proba >= lo) & (proba < hi if i < bins - 1 else proba <= hi)
        if mask.sum() == 0:
            continue
        rows.append({
            "bin": f"{lo:.1f}-{hi:.1f}",
            "n": int(mask.sum()),
            "mean_pred": round(float(proba[mask].mean()), 4),
            "frac_pos": round(float(y_true[mask].mean()), 4),
        })
    return rows


def pick_threshold(y_val, p_val):
    """在 validation 上选阈值：优先 precision≥0.35 下最大 recall；否则 max F1。不看 OOS。"""
    best = {"threshold": 0.5, "score": -1, "precision": 0, "recall": 0}
    for t in np.linspace(0.3, 0.85, 23):
        m = metrics_at(y_val, p_val, threshold=float(t))
        if m["precision"] is None:
            continue
        if m["precision"] >= 0.35:
            score = m["recall"] or 0
        else:
            p, r = m["precision"] or 0, m["recall"] or 0
            score = (2 * p * r / (p + r)) if (p + r) else 0
        if score > best["score"]:
            best = {"threshold": float(round(t, 3)), "score": score,
                    "precision": m["precision"], "recall": m["recall"]}
    return best


def train_one(df, label: str, fold: dict):
    tr = slice_range(df, *fold["train"])
    va = slice_range(df, *fold["val"])
    oos = slice_range(df, *fold["oos"])
    out = {"fold": fold["name"], "label": label, "sizes": {
        "train": len(tr), "val": len(va), "oos": len(oos),
        "train_pos": int(tr[label].sum()), "val_pos": int(va[label].sum()), "oos_pos": int(oos[label].sum()),
    }}
    if len(tr) < 50 or tr[label].sum() < 5 or (1 - tr[label]).sum() < 5:
        out["status"] = "SKIP_TRAIN"
        return out
    if len(va) < 10 or va[label].nunique() < 2:
        out["status"] = "SKIP_VAL"
        return out

    Xtr, ytr, wtr = feature_matrix(tr), tr[label].values, tr["sample_weight"].values
    Xva, yva = feature_matrix(va), va[label].values

    pipe = make_pipeline()
    pipe.fit(Xtr, ytr, clf__sample_weight=wtr)
    # 校准器仅 fit 在 validation（不碰 OOS）
    try:
        calib = CalibratedClassifierCV(pipe, method="isotonic", cv="prefit")
        calib.fit(Xva, yva)
        p_va = calib.predict_proba(Xva)[:, 1]
        cal_name = "isotonic"
    except Exception:
        calib = CalibratedClassifierCV(pipe, method="sigmoid", cv="prefit")
        calib.fit(Xva, yva)
        p_va = calib.predict_proba(Xva)[:, 1]
        cal_name = "platt"

    thr = pick_threshold(yva, p_va)
    out["calibration"] = cal_name
    out["threshold_from_val"] = thr
    out["val_metrics_raw"] = metrics_at(yva, pipe.predict_proba(Xva)[:, 1], thr["threshold"])
    out["val_metrics_cal"] = metrics_at(yva, p_va, thr["threshold"])
    out["val_reliability"] = calibration_table(yva, p_va)

    if len(oos) and oos[label].nunique() == 2:
        Xo, yo = feature_matrix(oos), oos[label].values
        p_raw = pipe.predict_proba(Xo)[:, 1]
        p_cal = calib.predict_proba(Xo)[:, 1]
        out["oos_metrics_raw"] = metrics_at(yo, p_raw, thr["threshold"])
        out["oos_metrics_cal"] = metrics_at(yo, p_cal, thr["threshold"])
        out["oos_reliability"] = calibration_table(yo, p_cal)
        # 独立簇视角：每个 cluster 取最大概率日
        oos2 = oos.copy()
        oos2["_p"] = p_cal
        g = oos2.groupby("event_cluster_id").agg(y=(label, "max"), p=("_p", "max"))
        out["oos_cluster_metrics"] = metrics_at(g["y"].values, g["p"].values, thr["threshold"])
        out["status"] = "OK"
        # 保存预测影子（不驱动仓位）
        pred_rows = oos[["code", "date", label, "event_cluster_id"]].copy()
        pred_rows["p_raw"] = p_raw
        pred_rows["p_cal"] = p_cal
        pred_rows["would_trigger"] = (p_cal >= thr["threshold"]).astype(int)
        pred_rows["fold"] = fold["name"]
        pred_rows["label_name"] = label
        out["_preds"] = pred_rows
    elif len(oos) == 0:
        out["status"] = "NO_OOS"
    else:
        out["status"] = "OOS_SINGLE_CLASS"
        out["oos_pos"] = int(oos[label].sum())
        out["oos_n"] = len(oos)

    out["top_features"] = {"note": "HistGradientBoosting; importances via permutation deferred"}
    out["_model"] = {"base": pipe, "calib": calib}
    return out


def verdict(results):
    """Challenger 是否建议进入 Shadow（仍不上线）。"""
    ok = [r for r in results if r.get("status") == "OK"]
    reasons = []
    if len(ok) < 2:
        return "REJECT", ["有效 OOS 折不足 2"]
    weak = 0
    useful = 0
    for r in ok:
        m = r.get("oos_metrics_cal") or {}
        if m.get("auc") is None or m["auc"] < 0.55:
            weak += 1
            reasons.append(f"{r['fold']}/{r['label']} AUC 弱 ({m.get('auc')})")
        if m.get("false_positive_rate") is not None and m["false_positive_rate"] > 0.35:
            weak += 1
            reasons.append(f"{r['fold']}/{r['label']} FPR 高 ({m['false_positive_rate']})")
        # 经济可用：阈值下确有触发且 precision 可定义
        if (m.get("recall") or 0) > 0 and m.get("precision") is not None:
            useful += 1
        else:
            reasons.append(f"{r['fold']}/{r['label']} 阈值下几乎不触发（recall=0）— 无 Fast Path 经济意义")
    if useful == 0:
        return "REJECT", reasons + ["无折在校准阈值下产生可用触发"]
    if weak >= 2:
        return "REJECT", reasons or ["多折指标偏弱"]
    if useful < len(ok) or weak == 1:
        return "CONDITIONAL_SHADOW", reasons + [
            "仅建议 Shadow 观察概率曲线；禁止 Fast Path / Modifier 上线",
            "尚未证明 Bull Capture / 反事实收益"
        ]
    return "SHADOW_OK", [
        "两折 OOS 弱通过；仍禁止生产 Fast Path，需反事实回测与 Bull Capture"
    ]


def main():
    args = parse_args()
    csv_path = find_csv(args.csv)
    df = load_df(csv_path)
    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    pred_frames = []
    for label in ("y5", "y10"):
        for fold in FOLDS:
            print(f"train {label} {fold['name']} ...")
            r = train_one(df, label, fold)
            # drop unserializable
            preds = r.pop("_preds", None)
            r.pop("_model", None)
            results.append(r)
            if preds is not None:
                pred_frames.append(preds)
            print(f"  status={r.get('status')} oos={r.get('oos_metrics_cal')}")

    decision, reasons = verdict(results)
    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "engine": "sklearn-HistGBM walk-forward (LightGBM blocked: missing libomp; same Challenger protocol)",
        "csv": str(csv_path.relative_to(ROOT)),
        "production_untouched": True,
        "fast_path_enabled": False,
        "challenger_verdict": decision,
        "verdict_reasons": reasons,
        "folds": FOLDS,
        "results": results,
    }

    if pred_frames:
        pred_df = pd.concat(pred_frames, ignore_index=True)
        pred_path = MODEL_DIR / f"shadow_predictions_{stamp}.csv"
        pred_df.to_csv(pred_path, index=False)
        payload["shadow_predictions"] = str(pred_path.relative_to(ROOT))

    json_path = OUT_DIR / f"challenger-early-transition-{stamp}.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)

    # Markdown report
    lines = [
        "# V4.0 Challenger — Early Transition LightGBM",
        "",
        f"日期：{stamp}",
        f"数据：`{payload['csv']}`",
        f"引擎：{payload['engine']}",
        "",
        f"## 裁决：**{decision}**",
        "",
        "**线上 V3.6.1 未修改。Fast Path 未接入生产。**",
        "",
    ]
    for r in reasons:
        lines.append(f"- {r}")
    lines.append("")
    lines.append("## Walk-Forward OOS（校准后）")
    lines.append("")
    lines.append("| Fold | Label | n | pos | AUC | AP | Brier | Prec | Recall | FPR | P@Top10% | Thr |")
    lines.append("|------|-------|---|-----|-----|----|-------|------|--------|-----|----------|-----|")
    for r in results:
        m = r.get("oos_metrics_cal") or {}
        if r.get("status") != "OK":
            lines.append(f"| {r['fold']} | {r['label']} | — | — | {r.get('status')} | | | | | | | |")
            continue
        thr = (r.get("threshold_from_val") or {}).get("threshold")
        lines.append(
            f"| {r['fold']} | {r['label']} | {m.get('n')} | {m.get('pos')} | "
            f"{None if m.get('auc') is None else round(m['auc'], 3)} | "
            f"{None if m.get('ap') is None else round(m['ap'], 3)} | "
            f"{None if m.get('brier') is None else round(m['brier'], 3)} | "
            f"{m.get('precision')} | {m.get('recall')} | {m.get('false_positive_rate')} | "
            f"{m.get('precision_at_top10pct')} | {thr} |"
        )
    lines.append("")
    lines.append("## 可靠性（OOS 校准分箱，首折有数据者）")
    lines.append("")
    for r in results:
        if r.get("status") != "OK":
            continue
        lines.append(f"### {r['fold']} / {r['label']}")
        lines.append("")
        lines.append("| Bin | n | mean_pred | frac_pos |")
        lines.append("|-----|---|-----------|----------|")
        for b in r.get("oos_reliability") or []:
            lines.append(f"| {b['bin']} | {b['n']} | {b['mean_pred']} | {b['frac_pos']} |")
        lines.append("")
    lines.append("## 说明")
    lines.append("")
    lines.append("- 本报告**不是**上线批准；即使 SHADOW_OK 也只允许 Shadow 对照。")
    lines.append("- 未计算 Bull Capture / 反事实收益（需接 Phase 反事实回测脚本）。")
    lines.append("- Vibe-Trading 未介入。")
    lines.append("")
    lines.append(f"JSON：`{json_path.relative_to(ROOT)}`")
    if payload.get("shadow_predictions"):
        lines.append(f"Shadow 预测：`{payload['shadow_predictions']}`")
    lines.append("")

    md_path = REPORT_DIR / f"V4.0-Challenger-EarlyTransition-{stamp}.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")
    print("════════ Challenger ════════")
    print("VERDICT", decision)
    for r in reasons:
        print(" -", r)
    print(json_path)
    print(md_path)


if __name__ == "__main__":
    main()
