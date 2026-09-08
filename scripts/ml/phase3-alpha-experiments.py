#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V4.0 Phase 3 — Alpha Experiments (3A / 3B / 3C)

3A: Y5 vs Y_HVT 标签对比
3B: 扩展特征 + Permutation Importance
3C: Logistic / HistGBM / ExtraTrees + ≥3 WF Fold + Abstain 诊断
     Challenger Score 强调 WorstFold

不改 V3.6.1；不上线；Vibe 不介入本脚本。

  python3 scripts/ml/phase3-alpha-experiments.py
"""
from __future__ import annotations

import argparse
import json
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder, StandardScaler

warnings.filterwarnings("ignore", category=UserWarning)

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "scripts" / "backtest-out"
REPORT_DIR = ROOT / "回测报告"
DIAG = ROOT / "ml" / "diagnostics"
MODEL_DIR = ROOT / "ml" / "models" / "phase3_hvt"

FEATURE_CORE = [
    "ma20_slope", "px_ma20", "px_ma60", "price_position", "volume_ratio",
    "sideway_days", "sideway_range", "consolidation_score", "atr20",
    "change_5d", "bias_20d", "breakout", "ret_5d", "ret_20d", "rs_20d",
]
FEATURE_NEW = [
    "rs_5d", "slope_accel_5", "vol_accel_5", "breakout_distance_atr",
    "atr_compression", "vol_compression", "market_mom_20d", "rs_x_mkt",
]
FEATURE_NUM = FEATURE_CORE + FEATURE_NEW
FEATURE_CAT = ["w_state", "d_state", "h_state", "v_state", "sector"]

# ≥3 不重叠 OOS 窗
FOLDS = [
    {
        "name": "WF0",
        "train": ("2024-01-01", "2024-09-30"),
        "val": ("2024-10-01", "2024-12-31"),
        "oos": ("2025-01-01", "2025-06-30"),
    },
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
    cands = sorted((ROOT / "ml" / "datasets").glob("high_value_transition_*.csv"), reverse=True)
    if not cands:
        raise SystemExit("缺少 high_value_transition_*.csv — 先跑 export-high-value-transition-dataset.js")
    return cands[0]


def load_train(path: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"])
    for c in FEATURE_CAT:
        if c not in df.columns:
            df[c] = "NA"
        df[c] = df[c].astype(str).fillna("NA")
    for c in FEATURE_NUM:
        if c not in df.columns:
            df[c] = np.nan
    train = df[df.get("role", "train") == "train"].copy() if "role" in df.columns else df.copy()
    neg = df[df["role"] == "negative_control"].copy() if "role" in df.columns else pd.DataFrame()
    return train, neg


def make_pipe(model: str, use_new_features: bool):
    nums = FEATURE_NUM if use_new_features else FEATURE_CORE
    if model == "logistic":
        pre = ColumnTransformer(
            [
                ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), nums),
                (
                    "cat",
                    Pipeline(
                        [
                            ("imp", SimpleImputer(strategy="most_frequent")),
                            ("enc", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
                        ]
                    ),
                    FEATURE_CAT,
                ),
            ]
        )
        clf = LogisticRegression(max_iter=500, class_weight="balanced", C=0.5, random_state=42)
    elif model == "extratrees":
        pre = ColumnTransformer(
            [
                ("num", SimpleImputer(strategy="median"), nums),
                (
                    "cat",
                    Pipeline(
                        [
                            ("imp", SimpleImputer(strategy="most_frequent")),
                            ("enc", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
                        ]
                    ),
                    FEATURE_CAT,
                ),
            ]
        )
        clf = ExtraTreesClassifier(
            n_estimators=200, max_depth=6, min_samples_leaf=8,
            class_weight="balanced_subsample", random_state=42, n_jobs=1
        )
    else:  # histgbm
        pre = ColumnTransformer(
            [
                ("num", SimpleImputer(strategy="median"), nums),
                (
                    "cat",
                    Pipeline(
                        [
                            ("imp", SimpleImputer(strategy="most_frequent")),
                            ("enc", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
                        ]
                    ),
                    FEATURE_CAT,
                ),
            ]
        )
        clf = HistGradientBoostingClassifier(
            max_depth=4, learning_rate=0.06, max_iter=180, random_state=42
        )
    return Pipeline([("pre", pre), ("clf", clf)]), nums


def safe_auc(y, p):
    y = np.asarray(y).astype(int)
    if len(y) < 10 or y.sum() < 2 or (len(y) - y.sum()) < 2:
        return float("nan")
    return float(roc_auc_score(y, p))


def safe_ap(y, p):
    y = np.asarray(y).astype(int)
    if len(y) < 10 or y.sum() < 1:
        return float("nan")
    return float(average_precision_score(y, p))


def top_decile_lift(y, p):
    y = np.asarray(y).astype(float)
    p = np.asarray(p).astype(float)
    if len(y) < 20:
        return float("nan")
    thr = np.quantile(p, 0.9)
    mask = p >= thr
    if mask.sum() < 3:
        return float("nan")
    base = y.mean()
    if base <= 0:
        return float("nan")
    return float(y[mask].mean() / base)


def abstain_metrics(y, p, low=0.35, high=0.65):
    """模糊带 abstain；仅对高置信打点评估。"""
    y = np.asarray(y).astype(int)
    p = np.asarray(p).astype(float)
    conf = (p >= high) | (p <= low)
    abstain_rate = float(1.0 - conf.mean()) if len(p) else float("nan")
    if conf.sum() < 10:
        return {"abstain_rate": abstain_rate, "auc_confident": float("nan"), "n_confident": int(conf.sum())}
    return {
        "abstain_rate": abstain_rate,
        "auc_confident": safe_auc(y[conf], p[conf]),
        "n_confident": int(conf.sum()),
        "precision_high": float(y[p >= high].mean()) if (p >= high).sum() else float("nan"),
        "n_high": int((p >= high).sum()),
    }


def run_wf(df: pd.DataFrame, label: str, model: str, use_new: bool) -> list[dict]:
    pipe_factory = lambda: make_pipe(model, use_new)
    rows = []
    for fold in FOLDS:
        tr0, tr1 = fold["train"]
        o0, o1 = fold["oos"]
        train = df[(df["date"] >= tr0) & (df["date"] <= tr1)].copy()
        oos = df[(df["date"] >= o0) & (df["date"] <= o1)].copy()
        if label not in train.columns or label not in oos.columns:
            continue
        ytr = train[label].astype(int)
        yo = oos[label].astype(int)
        if ytr.sum() < 8 or (len(ytr) - ytr.sum()) < 20 or len(oos) < 30:
            rows.append({
                "fold": fold["name"], "label": label, "model": model, "features": "new" if use_new else "core",
                "n_oos": len(oos), "pos": int(yo.sum()), "auc": float("nan"), "skip": True
            })
            continue
        pipe, nums = pipe_factory()
        cols = nums + FEATURE_CAT
        try:
            # 小样本：isotonic cv=3 可能失败，回退 raw
            cal = CalibratedClassifierCV(pipe_factory()[0], method="isotonic", cv=3)
            cal.fit(train[cols], ytr)
            p = cal.predict_proba(oos[cols])[:, 1]
        except Exception:
            pipe.fit(train[cols], ytr)
            p = pipe.predict_proba(oos[cols])[:, 1]
        ab = abstain_metrics(yo.values, p)
        rows.append({
            "fold": fold["name"],
            "label": label,
            "model": model,
            "features": "new" if use_new else "core",
            "n_oos": len(oos),
            "pos": int(yo.sum()),
            "auc": safe_auc(yo, p),
            "ap": safe_ap(yo, p),
            "brier": float(brier_score_loss(yo, p)) if yo.nunique() > 1 else float("nan"),
            "lift_top10": top_decile_lift(yo.values, p),
            "abstain_rate": ab["abstain_rate"],
            "auc_confident": ab["auc_confident"],
            "precision_high": ab.get("precision_high", float("nan")),
            "n_high": ab.get("n_high", 0),
            "skip": False,
        })
    return rows


def challenger_score(fold_rows: list[dict]) -> dict:
    """CS = 0.4*mean_auc + 0.3*worst_auc + 0.3*mean_lift_norm（粗代理经济价值）"""
    ok = [r for r in fold_rows if not r.get("skip") and r["auc"] == r["auc"]]
    if not ok:
        return {"cs": float("nan"), "mean_auc": float("nan"), "worst_auc": float("nan"), "mean_lift": float("nan")}
    aucs = [r["auc"] for r in ok]
    lifts = [r["lift_top10"] for r in ok if r["lift_top10"] == r["lift_top10"]]
    mean_auc = float(np.mean(aucs))
    worst = float(np.min(aucs))
    mean_lift = float(np.mean(lifts)) if lifts else float("nan")
    # lift 归一：1.0→0，3.0→1 clip
    lift_n = 0.0 if mean_lift != mean_lift else float(np.clip((mean_lift - 1.0) / 2.0, 0, 1))
    cs = 0.4 * mean_auc + 0.3 * worst + 0.3 * lift_n
    return {"cs": cs, "mean_auc": mean_auc, "worst_auc": worst, "mean_lift": mean_lift, "n_folds": len(ok)}


def permutation_on_last_fold(df: pd.DataFrame, label: str) -> pd.DataFrame:
    """在 WF2 train 上拟合 HistGBM+new，对 OOS 做 permutation importance。"""
    fold = FOLDS[-1]
    tr0, tr1 = fold["train"]
    o0, o1 = fold["oos"]
    train = df[(df["date"] >= tr0) & (df["date"] <= tr1)].copy()
    oos = df[(df["date"] >= o0) & (df["date"] <= o1)].copy()
    ytr = train[label].astype(int)
    yo = oos[label].astype(int)
    if ytr.sum() < 8 or len(oos) < 30:
        return pd.DataFrame()
    pipe, nums = make_pipe("histgbm", True)
    cols = nums + FEATURE_CAT
    pipe.fit(train[cols], ytr)

    def scorer(est, X, y):
        p = est.predict_proba(X)[:, 1]
        a = safe_auc(y, p)
        return a if a == a else 0.5

    r = permutation_importance(
        pipe, oos[cols], yo, n_repeats=8, random_state=42, scoring=scorer, n_jobs=1
    )
    out = pd.DataFrame({
        "feature": cols,
        "importance_mean": r.importances_mean,
        "importance_std": r.importances_std,
    }).sort_values("importance_mean", ascending=False)
    return out


def neg_control_score(train_df: pd.DataFrame, neg_df: pd.DataFrame, label: str) -> dict:
    """训练池拟合后，对黄金负对照打高分比例（应低）。"""
    if neg_df.empty or label not in train_df.columns:
        return {"n": 0, "high_rate": float("nan")}
    fold = FOLDS[-1]
    tr = train_df[(train_df["date"] >= fold["train"][0]) & (train_df["date"] <= fold["train"][1])]
    if tr[label].sum() < 8:
        return {"n": 0, "high_rate": float("nan")}
    pipe, nums = make_pipe("histgbm", True)
    cols = nums + FEATURE_CAT
    pipe.fit(tr[cols], tr[label].astype(int))
    p = pipe.predict_proba(neg_df[cols])[:, 1]
    thr = 0.65
    return {
        "n": int(len(neg_df)),
        "mean_p": float(np.mean(p)),
        "high_rate": float((p >= thr).mean()),
        "thr": thr,
    }


def write_report(stamp: str, summary: dict, pi: pd.DataFrame, all_rows: list[dict]):
    DIAG.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    pd.DataFrame(all_rows).to_csv(DIAG / f"phase3_wf_metrics_{stamp}.csv", index=False)
    if not pi.empty:
        pi.to_csv(DIAG / f"phase3_perm_importance_{stamp}.csv", index=False)
    (OUT_DIR / f"phase3-alpha-experiments-{stamp}.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False, default=str), encoding="utf-8"
    )

    lines = [
        "# V4.0 Phase 3 — Alpha / Label / Feature Experiments",
        "",
        f"日期：{stamp}",
        "",
        "## 战略状态",
        "",
        "```text",
        "V3.6.1 = Production Baseline (FROZEN)",
        "ML Early Transition = Research Candidate",
        "Status = RESEARCH_CONTINUE",
        "Economic Value = PASS (Phase2)",
        "Risk Impact = PASS",
        "Prediction Stability = CONDITIONAL",
        "Production = BLOCKED",
        "Ladder = Level 2",
        "```",
        "",
        "## 3A — Label：Y5 vs Y_HVT",
        "",
        f"- Train S2：{summary['n_train']}",
        f"- Y5+：{summary['n_y5']}（{summary['rate_y5']:.1%}）",
        f"- Y_HVT+：{summary['n_hvt']}（{summary['rate_hvt']:.1%}；占 Y5 的 {summary['hvt_of_y5']:.1%}）",
        "",
        "HVT = Fast5 ∧ Ret10>2% ∧ Persist10≥50% —— 学的是「值得提前下注」而非「会进入 S4」。",
        "",
        "## 3C — 模型 × 标签 × 特征（Walk-Forward ≥3）",
        "",
        "| Model | Label | Feat | Mean AUC | WorstFold | Lift@Top10 | CS | Abstain |",
        "|-------|-------|------|----------|-----------|------------|----|---------|",
    ]
    for key, sc in summary["challenger_scores"].items():
        lines.append(
            f"| {sc['model']} | {sc['label']} | {sc['features']} | "
            f"{sc['mean_auc']:.3f} | {sc['worst_auc']:.3f} | "
            f"{sc['mean_lift']:.2f}× | {sc['cs']:.3f} | {sc.get('mean_abstain', float('nan')):.0%} |"
        )
    lines += [
        "",
        "Challenger Score ≈ `0.4·MeanAUC + 0.3·WorstFold + 0.3·LiftNorm`（奖励稳定）。",
        "",
        "### Fold 明细",
        "",
        "| Fold | Model | Label | Feat | AUC | AP | Lift | Abs% | Prec@High |",
        "|------|-------|-------|------|-----|----|------|------|-----------|",
    ]
    for r in all_rows:
        if r.get("skip"):
            continue
        lines.append(
            f"| {r['fold']} | {r['model']} | {r['label']} | {r['features']} | "
            f"{r['auc']:.3f} | {r['ap']:.3f} | {r['lift_top10']:.2f}× | "
            f"{r['abstain_rate']:.0%} | {r.get('precision_high', float('nan')):.2f} |"
        )

    lines += ["", "## 3B — Permutation Importance（WF2 OOS，HistGBM + new，label=y_hvt）", ""]
    if pi.empty:
        lines.append("_样本不足，未产出_")
    else:
        lines += ["| Feature | Imp mean | Imp std |", "|---------|----------|---------|"]
        for _, row in pi.head(15).iterrows():
            lines.append(f"| {row['feature']} | {row['importance_mean']:.4f} | {row['importance_std']:.4f} |")
        rs = pi[pi["feature"].isin(["rs_20d", "rs_5d", "rs_x_mkt"])]
        if len(rs):
            lines += ["", "**Relative Strength 相关：**", ""]
            for _, row in rs.iterrows():
                lines.append(f"- `{row['feature']}`：{row['importance_mean']:.4f}")

    nc = summary.get("neg_control", {})
    lines += [
        "",
        "## Negative Control（518880 黄金）",
        "",
        f"- n={nc.get('n', 0)}；mean P={nc.get('mean_p', float('nan')):.3f}；"
        f"P≥{nc.get('thr', 0.65)} 比例={nc.get('high_rate', float('nan')):.1%}",
        "",
        "> 若黄金也大量高分，说明模型可能在学「上涨」而非「结构性启动」。",
        "",
        "## 裁决",
        "",
        f"**{summary['verdict']}**",
        "",
    ]
    for r in summary.get("reasons", []):
        lines.append(f"- {r}")
    lines += [
        "",
        "## 下一步（仍不上线）",
        "",
        "- 若 HVT 的 WorstFold 与 CS 优于 Y5 → 反事实改用 HVT 触发再测 Capture",
        "- 若 Logistic ≈ HistGBM → Alpha 偏线性，优先特征/标签而非堆树深",
        "- Vibe-Trading 仅假设生成；须回本脚本 / Qlib OOS",
        "- Capture 60%+ 为软目标，非硬门槛",
        "",
        "## 文件",
        "",
        f"- `scripts/backtest-out/phase3-alpha-experiments-{stamp}.json`",
        f"- `ml/diagnostics/phase3_wf_metrics_{stamp}.csv`",
        f"- `ml/diagnostics/phase3_perm_importance_{stamp}.csv`",
        "",
    ]
    (REPORT_DIR / f"V4.0-Phase3-Alpha-Experiments-{stamp}.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def main():
    args = parse_args()
    stamp = datetime.now().strftime("%Y-%m-%d")
    path = find_csv(args.csv)
    print(f"load {path}")
    df, neg = load_train(path)
    print(f"train S2={len(df)} neg={len(neg)}")

    n_y5 = int(df["y5"].sum()) if "y5" in df.columns else 0
    n_hvt = int(df["y_hvt"].sum()) if "y_hvt" in df.columns else 0

    configs = []
    for label in ["y5", "y_hvt"]:
        if label not in df.columns:
            continue
        for model in ["logistic", "histgbm", "extratrees"]:
            for use_new in [False, True]:
                configs.append((label, model, use_new))

    all_rows = []
    score_map = {}
    for label, model, use_new in configs:
        print(f"WF {model} {label} feat={'new' if use_new else 'core'}...")
        rows = run_wf(df, label, model, use_new)
        all_rows.extend(rows)
        sc = challenger_score(rows)
        abs_rates = [r["abstain_rate"] for r in rows if not r.get("skip") and r["abstain_rate"] == r["abstain_rate"]]
        key = f"{model}|{label}|{'new' if use_new else 'core'}"
        score_map[key] = {
            "model": model,
            "label": label,
            "features": "new" if use_new else "core",
            **sc,
            "mean_abstain": float(np.mean(abs_rates)) if abs_rates else float("nan"),
        }

    print("permutation importance...")
    label_pi = "y_hvt" if "y_hvt" in df.columns and df["y_hvt"].sum() >= 20 else "y5"
    pi = permutation_on_last_fold(df, label_pi)

    print("negative control...")
    nc = neg_control_score(df, neg, label_pi)

    # Verdict heuristics
    best_key = max(score_map.keys(), key=lambda k: score_map[k]["cs"] if score_map[k]["cs"] == score_map[k]["cs"] else -1)
    best = score_map[best_key]
    y5_h = score_map.get("histgbm|y5|new") or score_map.get("histgbm|y5|core")
    hvt_h = score_map.get("histgbm|y_hvt|new") or score_map.get("histgbm|y_hvt|core")
    log_h = score_map.get("logistic|y_hvt|new") or score_map.get("logistic|y5|new")

    reasons = []
    verdict = "RESEARCH_CONTINUE"
    if hvt_h and y5_h and hvt_h["worst_auc"] == hvt_h["worst_auc"] and y5_h["worst_auc"] == y5_h["worst_auc"]:
        if hvt_h["cs"] > y5_h["cs"] + 0.01:
            reasons.append("Y_HVT 的 Challenger Score 优于 Y5 → 经济标签方向成立，下一刀用 HVT 重跑反事实")
        else:
            reasons.append("Y_HVT 尚未稳定打赢 Y5 → 继续调 HVT 阈值/定义，或加强特征，不改母系统")
    if log_h and hvt_h and log_h["mean_auc"] == log_h["mean_auc"] and hvt_h["mean_auc"] == hvt_h["mean_auc"]:
        gap = hvt_h["mean_auc"] - log_h["mean_auc"]
        if abs(gap) < 0.05:
            reasons.append(f"Logistic≈树模型（ΔAUC={gap:+.3f}）→ Alpha 偏可解释线性结构，优先特征而非堆复杂度")
        elif gap > 0.08:
            reasons.append(f"树模型明显强于 Logistic（ΔAUC={gap:+.3f}）→ 存在非线性，可保留 HistGBM 但盯 WorstFold")
    if best["worst_auc"] == best["worst_auc"] and best["worst_auc"] < 0.60:
        reasons.append(f"最佳配置 WorstFold AUC={best['worst_auc']:.3f}<0.60 → Stability 仍 CONDITIONAL，Production 继续 BLOCKED")
        verdict = "RESEARCH_CONTINUE_STABILITY_GAP"
    if nc.get("high_rate") == nc.get("high_rate") and nc["high_rate"] > 0.25:
        reasons.append("黄金负对照高分比例偏高 → 警惕「学上涨」而非结构性启动")
    if not reasons:
        reasons.append("保持 RESEARCH_CONTINUE；Capture 60%+ 为软目标；不上线 Fast Path")

    summary = {
        "stamp": stamp,
        "csv": str(path),
        "n_train": len(df),
        "n_y5": n_y5,
        "n_hvt": n_hvt,
        "rate_y5": n_y5 / len(df) if len(df) else 0,
        "rate_hvt": n_hvt / len(df) if len(df) else 0,
        "hvt_of_y5": n_hvt / n_y5 if n_y5 else 0,
        "challenger_scores": score_map,
        "best": best_key,
        "neg_control": nc,
        "perm_label": label_pi,
        "verdict": verdict,
        "reasons": reasons,
        "ladder": "Level 2",
        "production": "BLOCKED",
    }
    write_report(stamp, summary, pi, all_rows)
    print(json.dumps({"verdict": verdict, "best": best_key, "cs": best.get("cs"), "neg_high": nc.get("high_rate")}, indent=2))
    print(f"report: 回测报告/V4.0-Phase3-Alpha-Experiments-{stamp}.md")


if __name__ == "__main__":
    main()
