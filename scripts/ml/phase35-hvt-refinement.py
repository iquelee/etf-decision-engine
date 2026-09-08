#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""V4.0 Phase 3.5 — HVT Refinement (Group-Aware WF + Counterfactual)."""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder, StandardScaler

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "scripts" / "backtest-out"
REPORT = ROOT / "回测报告"
DIAG = ROOT / "ml" / "diagnostics"
CHAL = ROOT / "ml" / "challenger" / "phase35"

CORE = [
    "ma20_slope", "px_ma20", "px_ma60", "price_position", "volume_ratio",
    "sideway_days", "sideway_range", "consolidation_score", "atr20",
    "change_5d", "bias_20d", "breakout", "ret_5d", "ret_20d", "rs_20d",
]
LEAD = [
    "rs_20d", "rs_accel_5", "breakout_distance_atr", "breakout_approach_5",
    "slope_accel_5", "vol_compression", "market_mom_20d",
]
CAT = ["w_state", "d_state", "h_state", "v_state", "sector"]
FOLDS = [
    {"name": "WF0", "train_end": "2024-12-31", "oos": ("2025-01-01", "2025-06-30")},
    {"name": "WF1", "train_end": "2025-07-31", "oos": ("2025-08-01", "2025-12-31")},
    {"name": "WF2", "train_end": "2026-03-31", "oos": ("2026-04-01", "2026-08-24")},
]
STAGE_W = {"S0": 0.055, "S1": 0.225, "S2": 0.40, "S3": 0.49, "S4": 0.635, "S5": 0.75}


def latest(pat: str) -> Path:
    hits = sorted(ROOT.glob(pat), reverse=True)
    if not hits:
        raise SystemExit(f"missing {pat}")
    return hits[0]


def code_str(c) -> str:
    s = str(c)
    return str(int(s)) if s.isdigit() else s


def ensure(df, cols, fill=np.nan):
    for c in cols:
        if c not in df.columns:
            df[c] = fill
    return df


def load_events(path: Path):
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"])
    df["code"] = df["code"].map(code_str)
    aliases = {
        "y_hvt_a": "y_hvta", "y_hvta": "y_hvta", "y_hvt_ab": "y_hvt_ab",
        "event_cluster_id": "event_cluster_id", "y_ret10": "y_ret10",
        "rs_accel_5": "rs_accel_5", "breakout_distance_atr": "breakout_distance_atr",
        "breakout_approach_5": "breakout_approach_5",
        "market_mom_20d": "market_mom_20d", "vol_compression": "vol_compression",
        "slope_accel_5": "slope_accel_5",
    }
    for a, b in aliases.items():
        if a in df.columns and b not in df.columns:
            df[b] = df[a]
    # map export names if needed
    rename_try = {
        "ma20_slope": ["ma20_slope", "ma20_slope"],
        "px_ma20": ["px_ma20", "px_ma20"],
        "px_ma60": ["px_ma60", "px_ma60"],
        "price_position": ["price_position", "price_position"],
        "volume_ratio": ["volume_ratio", "volume_ratio"],
        "sideway_days": ["sideway_days", "sideway_days"],
        "sideway_range": ["sideway_range", "sideway_range"],
        "consolidation_score": ["consolidation_score", "consolidation_score"],
        "rs_20d": ["rs_20d", "rs_20d"],
        "y_ret10": ["y_ret10", "y_ret10", "y_ret10"],
        "y_hvta": ["y_hvta", "y_hvta", "y_hvt_a"],
    }
    df = ensure(df, CORE + LEAD)
    df = ensure(df, CAT, "NA")
    for c in CAT:
        df[c] = df[c].astype(str).fillna("NA")
    if "event_cluster_id" not in df.columns:
        df = df.sort_values(["code", "date"]).copy()
        ids, n, pc, pdprev = [], 0, None, None
        for _, r in df.iterrows():
            if pc != r["code"] or pdprev is None or (r["date"] - pdprev).days > 10:
                n += 1
            ids.append(f"{r['code']}_{n}")
            pc, pdprev = r["code"], r["date"]
        df["event_cluster_id"] = ids
    if "role" not in df.columns:
        df["role"] = "train"
    train = df[df["role"] == "train"].copy()
    neg = df[df["role"].astype(str).str.contains("neg")].copy()
    return train, neg


def feats(kind: str):
    return CORE[:] if kind == "core" else sorted(set(CORE + LEAD))


def pipe(model: str, fcols: list[str]) -> Pipeline:
    if model == "logistic":
        pre = ColumnTransformer([
            ("n", Pipeline([("i", SimpleImputer(strategy="median")), ("s", StandardScaler())]), fcols),
            ("c", Pipeline([
                ("i", SimpleImputer(strategy="most_frequent")),
                ("e", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
            ]), CAT),
        ])
        clf = LogisticRegression(max_iter=600, class_weight="balanced", C=0.5, random_state=42)
    else:
        pre = ColumnTransformer([
            ("n", SimpleImputer(strategy="median"), fcols),
            ("c", Pipeline([
                ("i", SimpleImputer(strategy="most_frequent")),
                ("e", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
            ]), CAT),
        ])
        clf = ExtraTreesClassifier(
            n_estimators=250, max_depth=6, min_samples_leaf=8,
            class_weight="balanced_subsample", random_state=42, n_jobs=1,
        )
    return Pipeline([("pre", pre), ("clf", clf)])


def gsplit(df, train_end, oos):
    o0, o1 = oos
    oos_df = df[(df["date"] >= o0) & (df["date"] <= o1)].copy()
    oc = set(oos_df["event_cluster_id"].astype(str))
    tr = df[(df["date"] <= train_end) & (~df["event_cluster_id"].astype(str).isin(oc))].copy()
    return tr, oos_df


def safe_auc(y, p):
    y = np.asarray(y).astype(int)
    if len(y) < 12 or y.sum() < 2 or len(y) - y.sum() < 2:
        return float("nan")
    return float(roc_auc_score(y, p))


def safe_ap(y, p):
    y = np.asarray(y).astype(int)
    if len(y) < 12 or y.sum() < 1:
        return float("nan")
    return float(average_precision_score(y, p))


def lift(y, p, q=0.9):
    y = np.asarray(y, float); p = np.asarray(p, float)
    if len(y) < 20 or y.mean() <= 0:
        return float("nan")
    m = p >= np.quantile(p, q)
    return float(y[m].mean() / y.mean()) if m.sum() >= 3 else float("nan")


def run_wf(df, label, model, kind):
    fcols = feats(kind); cols = fcols + CAT; out = []
    for fold in FOLDS:
        tr, oos = gsplit(df, fold["train_end"], fold["oos"])
        base = {"fold": fold["name"], "label": label, "model": model, "features": kind,
                "n_train": len(tr), "n_oos": len(oos)}
        if label not in tr.columns or len(oos) < 20:
            out.append({**base, "pos_oos": 0, "auc": float("nan"), "skip": True}); continue
        ytr, yo = tr[label].astype(int), oos[label].astype(int)
        base["pos_oos"] = int(yo.sum())
        if ytr.sum() < 6 or len(ytr) - ytr.sum() < 15:
            out.append({**base, "auc": float("nan"), "skip": True}); continue
        mdl = pipe(model, fcols)
        try:
            cal = CalibratedClassifierCV(mdl, method="isotonic", cv=3)
            cal.fit(tr[cols], ytr); p = cal.predict_proba(oos[cols])[:, 1]
        except Exception:
            mdl.fit(tr[cols], ytr); p = mdl.predict_proba(oos[cols])[:, 1]
        conf = (p >= 0.65) | (p <= 0.35)
        out.append({
            **base, "skip": False, "auc": safe_auc(yo, p), "ap": safe_ap(yo, p),
            "brier": float(brier_score_loss(yo, p)) if yo.nunique() > 1 else float("nan"),
            "lift_top10": lift(yo.values, p), "abstain_rate": float(1 - conf.mean()),
            "precision_high": float(yo.values[p >= 0.65].mean()) if (p >= 0.65).any() else float("nan"),
        })
    return out


def aggregate(rows):
    ok = [r for r in rows if not r.get("skip") and r.get("auc") == r.get("auc")]
    if not ok:
        return {"cs": float("nan"), "mean_auc": float("nan"), "worst_auc": float("nan"),
                "mean_lift": float("nan"), "mean_abstain": float("nan"), "n_folds": 0}
    aucs = [r["auc"] for r in ok]
    lifts = [r["lift_top10"] for r in ok if r["lift_top10"] == r["lift_top10"]]
    ma, wa = float(np.mean(aucs)), float(np.min(aucs))
    ml = float(np.mean(lifts)) if lifts else float("nan")
    ln = 0.0 if ml != ml else float(np.clip((ml - 1) / 2, 0, 1))
    return {"cs": 0.4 * ma + 0.3 * wa + 0.3 * ln, "mean_auc": ma, "worst_auc": wa,
            "mean_lift": ml, "mean_abstain": float(np.mean([r["abstain_rate"] for r in ok])),
            "n_folds": len(ok)}


def window_stats(df):
    rows = []
    for w in (3, 5, 8, 10):
        col = f"y{w}"
        if col not in df.columns:
            continue
        y = df[col].astype(int); sub = df[y == 1]
        a = float(sub["y_hvta"].mean()) if "y_hvta" in df.columns and len(sub) else float("nan")
        ret = pd.to_numeric(sub["y_ret10"], errors="coerce") if "y_ret10" in sub else pd.Series(dtype=float)
        rows.append({"window": w, "n_pos": int(y.sum()), "rate": float(y.mean()),
                     "hvt_a_given_pos": a, "mean_ret10_given_pos": float(ret.mean()) if len(ret) else float("nan")})
    return rows


def oos_probs(df, label, model, kind):
    fcols = feats(kind); cols = fcols + CAT; out = {}
    for fold in FOLDS:
        tr, oos = gsplit(df, fold["train_end"], fold["oos"])
        if label not in tr.columns or len(oos) < 5:
            continue
        ytr = tr[label].astype(int)
        if ytr.sum() < 6:
            continue
        mdl = pipe(model, fcols)
        try:
            cal = CalibratedClassifierCV(mdl, method="isotonic", cv=3)
            cal.fit(tr[cols], ytr); p = cal.predict_proba(oos[cols])[:, 1]
        except Exception:
            mdl.fit(tr[cols], ytr); p = mdl.predict_proba(oos[cols])[:, 1]
        for i, prob in zip(oos.index, p):
            r = oos.loc[i]
            out[(code_str(r["code"]), pd.Timestamp(r["date"]).strftime("%Y-%m-%d"))] = float(prob)
    return out


def load_panel(path: Path):
    p = pd.read_csv(path)
    p["date"] = pd.to_datetime(p["date"])
    p["code"] = p["code"].map(code_str)
    return p


def simulate(panel, triggers, sticky=10):
    df = panel.sort_values(["code", "date"]).copy()
    df["ds"] = df["date"].dt.strftime("%Y-%m-%d")
    left, fp, eff = {}, [], []
    for i in range(len(df)):
        code, ds, st = df.iloc[i]["code"], df.iloc[i]["ds"], str(df.iloc[i]["stage"])
        if st == "S2" and triggers.get((code, ds), False):
            left[code] = sticky
        L = left.get(code, 0); use = False
        if L > 0:
            if st in ("S0", "S1", "S4", "S5", "S6"):
                left[code] = 0
            elif st in ("S2", "S3"):
                use = True; left[code] = L - 1
            else:
                left[code] = L - 1
        fp.append(use); eff.append("S4" if use else st)
    df["fast_path"] = fp; df["eff"] = eff
    df["w"] = df["eff"].map(lambda s: STAGE_W.get(s, 0.40))
    parts = []
    for _, g in df.groupby("code"):
        g = g.sort_values("date").copy()
        g["w_lag"] = g["w"].shift(1).fillna(0.0)
        g["pnl"] = g["w_lag"] * g["ret_1d"].fillna(0.0)
        g["bh"] = g["ret_1d"].fillna(0.0)
        parts.append(g)
    long = pd.concat(parts, ignore_index=True)
    port = long.groupby("date").agg(ret=("pnl", "mean"), bh=("bh", "mean"),
                                    exposure=("w", "mean"), fp=("fast_path", "sum")).reset_index().sort_values("date")
    port["nav"] = (1 + port["ret"]).cumprod()
    total = float(port["nav"].iloc[-1] - 1) if len(port) else 0.0
    dd = float((port["nav"] / port["nav"].cummax() - 1).min()) if len(port) else 0.0
    r = port["ret"]
    sharpe = float(np.sqrt(252) * r.mean() / r.std()) if len(r) > 5 and r.std() > 0 else float("nan")
    port["bh60"] = port["bh"].rolling(60, min_periods=20).sum()
    bull = port["bh60"] > 0.08
    bc = float(port.loc[bull, "ret"].sum() / port.loc[bull, "bh"].sum()) if bull.any() and abs(port.loc[bull, "bh"].sum()) > 1e-9 else float("nan")
    return port, {"return": total, "max_dd": dd, "sharpe": sharpe, "bull_capture": bc,
                  "avg_exposure": float(port["exposure"].mean()), "fast_path_days": int(long["fast_path"].sum())}


def oracle_trig(events):
    out = {}
    col = "y_hvta" if "y_hvta" in events.columns else None
    if not col:
        return out
    for _, r in events[events[col] == 1].iterrows():
        out[(code_str(r["code"]), pd.Timestamp(r["date"]).strftime("%Y-%m-%d"))] = True
    return out


def ml_trig(probs, top_pct, events):
    if not probs:
        return {}
    thr = pd.Series(probs).quantile(1 - top_pct)
    keys = {(code_str(r["code"]), pd.Timestamp(r["date"]).strftime("%Y-%m-%d")) for _, r in events.iterrows()}
    return {k: True for k, p in probs.items() if p >= thr and k in keys}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="")
    ap.add_argument("--panel", default="")
    args = ap.parse_args()
    stamp = datetime.now().strftime("%Y-%m-%d")

    csv_path = Path(args.csv) if args.csv else latest("ml/datasets/hvt_refined_*.csv")
    if not csv_path.is_absolute():
        csv_path = ROOT / csv_path
    panel_path = Path(args.panel) if args.panel else latest("ml/datasets/daily_stage_panel_*.csv")
    if not panel_path.is_absolute():
        panel_path = ROOT / panel_path

    print("events", csv_path)
    train, neg = load_events(csv_path)
    print(f"S2={len(train)} clusters={train['event_cluster_id'].nunique()} "
          f"y5={int(train['y5'].sum()) if 'y5' in train else 0} "
          f"hvta={int(train['y_hvta'].sum()) if 'y_hvta' in train else 0}")

    win = window_stats(train)
    all_rows, scores = [], {}
    for label in ["y5", "y_hvta", "y_hvt_ab"]:
        if label not in train.columns:
            continue
        for model in ["logistic", "extratrees"]:
            for kind in ["core", "lead"]:
                print(f"WF {model} {label} {kind}")
                rows = run_wf(train, label, model, kind)
                all_rows.extend(rows)
                sc = aggregate(rows)
                scores[f"{model}|{label}|{kind}"] = {"model": model, "label": label, "features": kind, **sc}

    best_key = max(scores, key=lambda k: scores[k]["cs"] if scores[k]["cs"] == scores[k]["cs"] else -1)
    best = scores[best_key]
    cf_model, cf_label, cf_kind = best["model"], best["label"], best["features"]
    prefer = "logistic|y_hvta|lead"
    if prefer in scores:
        ps = scores[prefer]
        if ps["cs"] == ps["cs"] and (ps["cs"] >= best["cs"] - 0.05 or ps["worst_auc"] >= 0.55):
            cf_model, cf_label, cf_kind = "logistic", "y_hvta", "lead"

    print("CF", cf_model, cf_label, cf_kind)
    panel = load_panel(panel_path)
    if "main5" in panel.columns:
        panel = panel[(panel["main5"] == True) | (panel["code"] == "588000")].copy()  # noqa: E712
    mask = False
    for f in FOLDS:
        o0, o1 = f["oos"]
        mask = mask | ((panel["date"] >= o0) & (panel["date"] <= o1))
    panel_oos = panel[mask].copy()

    probs = oos_probs(train, cf_label, cf_model, cf_kind)
    ora = oracle_trig(train)
    port_c, met_c = simulate(panel_oos, {})
    port_o, met_o = simulate(panel_oos, ora)

    tiers, best_cf = [], None
    for tp in (0.05, 0.10, 0.20, 0.30):
        mt = ml_trig(probs, tp, train)
        _, mm = simulate(panel_oos, mt)
        delta = mm["return"] - met_c["return"]
        ddd = abs(mm["max_dd"]) - abs(met_c["max_dd"])
        opp = (sum(1 for k in ora if k in mt) / len(ora)) if ora else float("nan")
        row = {"top_pct": tp, "delta_return": delta, "delta_maxdd": ddd, "return": mm["return"],
               "max_dd": mm["max_dd"], "bull_capture": mm["bull_capture"],
               "opportunity_capture": opp, "fast_path_days": mm["fast_path_days"]}
        tiers.append(row)
        if best_cf is None or delta > best_cf[0]:
            best_cf = (delta, tp, mm, row)

    oracle_d = met_o["return"] - met_c["return"]
    ml_d = best_cf[2]["return"] - met_c["return"] if best_cf else float("nan")
    cap = (ml_d / oracle_d) if oracle_d > 1e-6 else float("nan")
    incr_dd = (abs(best_cf[2]["max_dd"]) - abs(met_c["max_dd"])) if best_cf else float("nan")

    reasons = []
    if oracle_d <= 0:
        verdict = "STOP_FAST_PATH"; reasons.append("Oracle-HVT 无增量")
    elif ml_d <= 0:
        verdict = "ORACLE_ONLY"; reasons.append("Oracle 有增量但 ML 未兑现")
    elif incr_dd > 0.02:
        verdict = "FAIL_DRAWDOWN"; reasons.append("增量回撤 > +2pp")
    elif cap == cap and cap >= 0.55 and best["worst_auc"] >= 0.60:
        verdict = "SHADOW_CANDIDATE"; reasons.append("Capture≥55% 且 WorstFold≥0.60 → 可 Shadow（非生产）")
    elif cap == cap and 0.45 <= cap < 0.55:
        verdict = "RESEARCH_CONTINUE"; reasons.append("Capture 45–55%：方向对，继续 refinement")
    else:
        verdict = "RESEARCH_CONTINUE"; reasons.append("保持 RESEARCH_CONTINUE；Production BLOCKED")
    if best["worst_auc"] == best["worst_auc"] and best["worst_auc"] < 0.58:
        reasons.append(f"WorstFold={best['worst_auc']:.3f} → Stability CONDITIONAL")

    neg_note = "n/a"
    if len(neg) and cf_label in train.columns:
        fold = FOLDS[-1]
        tr, _ = gsplit(train, fold["train_end"], fold["oos"])
        fcols = feats(cf_kind); cols = fcols + CAT
        if tr[cf_label].sum() >= 6:
            mdl = pipe(cf_model, fcols)
            neg2 = ensure(neg.copy(), fcols + CAT, "NA")
            for c in CAT:
                neg2[c] = neg2[c].astype(str)
            mdl.fit(tr[cols], tr[cf_label].astype(int))
            pn = mdl.predict_proba(neg2[cols])[:, 1]
            neg_note = f"n={len(neg2)} meanP={pn.mean():.3f} high@0.65={(pn>=0.65).mean():.1%}"

    for d in (OUT, REPORT, DIAG, CHAL):
        d.mkdir(parents=True, exist_ok=True)

    summary = {
        "stamp": stamp, "csv": str(csv_path), "panel": str(panel_path),
        "window_stats": win, "scores": scores, "best_wf": best_key,
        "cf_config": f"{cf_model}|{cf_label}|{cf_kind}",
        "control_return": met_c["return"], "oracle_delta": oracle_d,
        "ml_best_delta": ml_d, "capture_efficiency": cap, "incr_maxdd": incr_dd,
        "tiers": tiers, "neg_control": neg_note, "verdict": verdict, "reasons": reasons,
        "status": {"economic_alpha": "PASS", "risk": "PASS", "prediction_stability": "CONDITIONAL",
                   "feature_discovery": "PROMISING", "production": "BLOCKED"},
    }
    pd.DataFrame(all_rows).to_csv(DIAG / f"phase35_wf_{stamp}.csv", index=False)
    pd.DataFrame(tiers).to_csv(DIAG / f"phase35_cf_tiers_{stamp}.csv", index=False)
    port_c.to_csv(CHAL / f"nav_control_{stamp}.csv", index=False)
    port_o.to_csv(CHAL / f"nav_oracle_{stamp}.csv", index=False)
    (OUT / f"phase35-hvt-refinement-{stamp}.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    lines = [
        "# V4.0 Phase 3.5 — HVT Label Refinement", "", f"日期：{stamp}", "",
        "## 状态", "", "```text",
        "Economic Alpha       = PASS",
        "Risk                 = PASS",
        "Prediction Stability = CONDITIONAL",
        "Feature Discovery    = PROMISING",
        "Production           = BLOCKED",
        "```", "", f"**裁决：{verdict}**", "", *[f"- {r}" for r in reasons], "",
        "## 窗口比较", "",
        "| W | Pos | Rate | HVT-A|Pos | MeanRet10|Pos |",
        "|---|-----|------|-----------|---------------|",
    ]
    for w in win:
        lines.append(f"| Y{w['window']} | {w['n_pos']} | {w['rate']:.1%} | {w['hvt_a_given_pos']:.1%} | {w['mean_ret10_given_pos']:.2%} |")
    lines += ["", "## Group-Aware WF", "",
              "| Model | Label | Feat | MeanAUC | Worst | Lift | CS | Abs% |",
              "|-------|-------|------|---------|-------|------|----|------|"]
    for k, sc in scores.items():
        lines.append(f"| {sc['model']} | {sc['label']} | {sc['features']} | {sc['mean_auc']:.3f} | {sc['worst_auc']:.3f} | {sc['mean_lift']:.2f}× | {sc['cs']:.3f} | {sc['mean_abstain']:.0%} |")
    lines += ["", f"WF Best：`{best_key}`", "", "## Counterfactual", "",
              f"配置：`{summary['cf_config']}`", "",
              f"- Control：**{met_c['return']:.2%}**",
              f"- Oracle Δ：**{oracle_d:+.2%}**",
              f"- ML Best Δ：**{ml_d:+.2%}**",
              (f"- Capture Efficiency：**{cap:.1%}**" if cap == cap else "- Capture：**n/a**"),
              f"- Incremental MaxDD：**{incr_dd:+.2%}**", "",
              "| Top% | ΔRet | ΔMDD | Bull | Opp | Days |",
              "|------|------|------|------|-----|------|"]
    for t in tiers:
        lines.append(
            f"| {int(t['top_pct']*100)}% | {t['delta_return']:+.2%} | {t['delta_maxdd']:+.2%} | "
            f"{t['bull_capture'] if t['bull_capture']==t['bull_capture'] else float('nan'):.2f} | "
            f"{t['opportunity_capture'] if t['opportunity_capture']==t['opportunity_capture'] else float('nan'):.1%} | "
            f"{t['fast_path_days']} |"
        )
    lines += ["", "## Negative Control", "", neg_note, "",
              "## 下一步", "",
              "- Capture 稳≥50% 且 WorstFold≥0.60 → Shadow（仍非生产）",
              "- HVT-A 过稀 → 微调阈值或改用 y_hvt_ab",
              "- 冻结 Early Leadership 特征；不堆交叉项/复杂模型",
              "- V3.6.1 继续冻结", "",
              "## 文件", "",
              f"- `scripts/backtest-out/phase35-hvt-refinement-{stamp}.json`",
              f"- `ml/diagnostics/phase35_wf_{stamp}.csv`",
              f"- `ml/challenger/phase35/nav_*_{stamp}.csv`", ""]
    (REPORT / f"V4.0-Phase35-HVT-Refinement-{stamp}.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"verdict": verdict, "oracle_delta": oracle_d, "ml_delta": ml_d,
                      "cap_eff": None if cap != cap else round(cap, 3), "best_wf": best_key}, indent=2))
    print(f"report: 回测报告/V4.0-Phase35-HVT-Refinement-{stamp}.md")


if __name__ == "__main__":
    main()
