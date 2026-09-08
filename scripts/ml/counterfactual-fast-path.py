#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V4.0 Phase 2 — Counterfactual Challenger
Control (V3.6.1) vs Oracle Fast Path vs ML Fast Path

- Fast Path = S2→S4 Stage 提前；Target 取 V34 Stage 曲线 mid（不改仓位公式本身）
- ML 仅解锁 Fast Path；不上线；不改 V3.6.1 参数
- 先做 Top 5/10/20/30% 分层，不争论固定 P 阈值

  python3 scripts/ml/counterfactual-fast-path.py
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "scripts" / "backtest-out"
REPORT_DIR = ROOT / "回测报告"
CHALLENGER = ROOT / "ml" / "challenger"
DIAG = ROOT / "ml" / "diagnostics"

# V34_STAGE_CURVE mid @ trendQuality≈0.55（与 v3-4-stage-position-engine 对齐）
STAGE_TARGET_MID = {
    "S0": 5.5,
    "S1": 22.5,
    "S2": 40.0,
    "S3": 49.0,
    "S4": 63.5,
    "S5": 75.0,
}

FEATURE_NUM = [
    "ma20_slope", "px_ma20", "px_ma60", "price_position", "volume_ratio",
    "sideway_days", "sideway_range", "consolidation_score", "atr20",
    "change_5d", "bias_20d", "breakout", "ret_5d", "ret_20d", "rs_20d",
]
FEATURE_CAT = ["w_state", "d_state", "h_state", "v_state", "sector"]

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

TOP_PCTS = [0.05, 0.10, 0.20, 0.30]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--panel", default="")
    p.add_argument("--events", default="")
    p.add_argument("--main5-only", action="store_true", default=True)
    return p.parse_args()


def latest(glob_pat: str) -> Path:
    cands = sorted(Path(ROOT).glob(glob_pat), reverse=True)
    if not cands:
        raise SystemExit(f"缺少文件: {glob_pat}")
    return cands[0]


def stage_target(stage: str) -> float:
    s = str(stage or "S0")
    if s in ("S6", "S7"):
        s = "S5" if s == "S6" else "S0"
    return float(STAGE_TARGET_MID.get(s, 40.0))


def rule_gate(row: pd.Series) -> bool:
    """
    保守 Fast Path Rule Gate（Level1）— 研究近似，不接线上 Regime 服务。
    Trend Integrity：结构未破（相对 MA60），不要求当日 ma20_slope>0
    （S2 盘整期斜率常接近 0，过严会把 Oracle 上界也掐死）。
    """
    # Regime ≠ Bear
    ret20 = row.get("ret_20d")
    px60 = row.get("px_ma60")
    if pd.notna(ret20) and float(ret20) < -0.12:
        return False
    if pd.notna(px60) and float(px60) < -0.08:
        return False
    # Trend Integrity：未深度跌破 MA60；允许浅回调
    if pd.notna(px60) and float(px60) < -0.05:
        return False
    px20 = row.get("px_ma20")
    if pd.notna(px20) and float(px20) < -0.05:
        return False
    # Breakout / Near-Breakout
    brk = int(row.get("breakout") or 0)
    pp = row.get("price_position")
    near = pd.notna(pp) and float(pp) >= 0.65
    if not (brk == 1 or near):
        return False
    # Volume Quality（mild）
    vr = row.get("volume_ratio")
    if pd.isna(vr) or float(vr) < 0.85:
        return False
    return True


def _key(code, date) -> tuple:
    ds = pd.Timestamp(date).strftime("%Y-%m-%d")
    return (str(int(code)) if str(code).isdigit() else str(code), ds)


def build_pipe():
    pre = ColumnTransformer(
        [
            ("num", Pipeline([("imp", SimpleImputer(strategy="median"))]), FEATURE_NUM),
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
    return Pipeline([("pre", pre), ("clf", clf)])


def walk_forward_probs(events: pd.DataFrame) -> pd.DataFrame:
    """仅在 OOS 窗产出校准概率（防泄漏）。"""
    df = events.copy()
    df["date"] = pd.to_datetime(df["date"])
    for c in FEATURE_CAT:
        if c not in df.columns:
            df[c] = "NA"
        df[c] = df[c].astype(str).fillna("NA")
    for c in FEATURE_NUM:
        if c not in df.columns:
            df[c] = np.nan

    parts = []
    for fold in FOLDS:
        tr0, tr1 = fold["train"]
        v0, v1 = fold["val"]
        o0, o1 = fold["oos"]
        train = df[(df["date"] >= tr0) & (df["date"] <= tr1)].copy()
        val = df[(df["date"] >= v0) & (df["date"] <= v1)].copy()
        oos = df[(df["date"] >= o0) & (df["date"] <= o1)].copy()
        if len(train) < 80 or train["y5"].sum() < 8 or len(oos) == 0:
            continue
        pipe = build_pipe()
        # 用 train+val 拟合并在 val 上 isotonic 校准（与 Challenger 一致的思路）
        fit_x = pd.concat([train, val], ignore_index=True)
        y = fit_x["y5"].astype(int).values
        if y.sum() < 5 or (1 - y).sum() < 5:
            continue
        try:
            base = build_pipe()
            base.fit(fit_x[FEATURE_NUM + FEATURE_CAT], y)
            # 简化：直接用 fit 模型在 OOS 打分；再用 val 做经验分位（阈值自由）
            # 校准：用 val 拟合 isotonic via CalibratedClassifierCV prefit 不可用时改用 raw rank
            cal = CalibratedClassifierCV(base, method="isotonic", cv=3)
            # 仅 train 拟合校准更干净
            if train["y5"].sum() >= 8 and (len(train) - train["y5"].sum()) >= 20:
                cal = CalibratedClassifierCV(build_pipe(), method="isotonic", cv=3)
                cal.fit(train[FEATURE_NUM + FEATURE_CAT], train["y5"].astype(int))
                p = cal.predict_proba(oos[FEATURE_NUM + FEATURE_CAT])[:, 1]
            else:
                p = base.predict_proba(oos[FEATURE_NUM + FEATURE_CAT])[:, 1]
        except Exception:
            pipe.fit(fit_x[FEATURE_NUM + FEATURE_CAT], y)
            p = pipe.predict_proba(oos[FEATURE_NUM + FEATURE_CAT])[:, 1]
        out = oos[["code", "date", "y5"]].copy()
        out["p_cal"] = p
        out["fold"] = fold["name"]
        parts.append(out)
    if not parts:
        return pd.DataFrame(columns=["code", "date", "y5", "p_cal", "fold"])
    return pd.concat(parts, ignore_index=True)


def simulate_arm(
    panel: pd.DataFrame,
    trigger_map: dict,
    name: str,
    sticky_days: int = 10,
) -> tuple[pd.DataFrame, dict]:
    """
    panel: 日频；trigger_map: (code, date_str) -> True 表示该日允许 Fast Path (S2→S4)
    Sticky：触发后最多 sticky_days 个交易日，在自然 Stage∈{S2,S3} 时保持至少 S4；
            自然到达 S4/S5 或回落 S0/S1 则解除。
    仓位：当日 target% / 100；收益 = 仓位_{t-1} * ret_1d_t（等权组合）
    """
    df = panel.sort_values(["code", "date"]).copy()
    df["code"] = df["code"].map(lambda c: str(int(c)) if str(c).isdigit() else str(c))
    df["date_str"] = df["date"].dt.strftime("%Y-%m-%d")
    df["eff_stage"] = df["stage"].astype(str)
    df["fast_path"] = False

    fp = []
    eff = []
    # per-code sticky remaining
    sticky_left = {}
    for i in range(len(df)):
        code = df.iloc[i]["code"]
        ds = df.iloc[i]["date_str"]
        st = str(df.iloc[i]["stage"])
        trig = bool(trigger_map.get((code, ds), False))
        if st == "S2" and trig:
            sticky_left[code] = sticky_days
        left = sticky_left.get(code, 0)
        use_fp = False
        if left > 0:
            if st in ("S0", "S1"):
                sticky_left[code] = 0
            elif st in ("S4", "S5", "S6"):
                sticky_left[code] = 0
                use_fp = False  # 自然已到，不再记为 Fast Path
            elif st in ("S2", "S3"):
                use_fp = True
                sticky_left[code] = left - 1
            else:
                sticky_left[code] = left - 1
        if use_fp:
            fp.append(True)
            eff.append("S4")
        else:
            fp.append(False)
            eff.append(st)
    df["fast_path"] = fp
    df["eff_stage"] = eff
    df["target_pct"] = df["eff_stage"].map(stage_target).astype(float)
    df["w"] = df["target_pct"] / 100.0

    # 组合：等权 ETF，日收益 = mean(w_{t-1} * ret_t)
    pieces = []
    for code, g in df.groupby("code"):
        g = g.sort_values("date").copy()
        g["w_lag"] = g["w"].shift(1).fillna(0.0)
        g["pnl"] = g["w_lag"] * g["ret_1d"].fillna(0.0)
        g["bh"] = g["ret_1d"].fillna(0.0)  # 满仓买入持有对照
        pieces.append(g[["date", "code", "pnl", "bh", "w", "fast_path", "y5", "stage", "eff_stage"]])
    long = pd.concat(pieces, ignore_index=True)

    port = long.groupby("date").agg(
        ret=("pnl", "mean"),
        bh_ret=("bh", "mean"),
        exposure=("w", "mean"),
        fp_count=("fast_path", "sum"),
        n=("code", "count"),
    ).reset_index().sort_values("date")
    port["nav"] = (1.0 + port["ret"]).cumprod()
    port["bh_nav"] = (1.0 + port["bh_ret"]).cumprod()

    metrics = compute_metrics(port, long, name)
    return port, metrics


def max_dd(nav: pd.Series) -> float:
    peak = nav.cummax()
    dd = nav / peak - 1.0
    return float(dd.min()) if len(dd) else 0.0


def sharpe(rets: pd.Series) -> float:
    r = rets.dropna()
    if len(r) < 5 or r.std() == 0:
        return float("nan")
    return float(np.sqrt(252) * r.mean() / r.std())


def compute_metrics(port: pd.DataFrame, long: pd.DataFrame, name: str) -> dict:
    total_ret = float(port["nav"].iloc[-1] - 1.0) if len(port) else 0.0
    bh_ret = float(port["bh_nav"].iloc[-1] - 1.0) if len(port) else 0.0
    # Bull leg：等权买入持有 60 日滚动收益 > 8% 且价在 60 均线之上的近似 → 用 rolling bh
    port = port.copy()
    port["bh_roll60"] = port["bh_ret"].rolling(60, min_periods=20).sum()
    bull = port["bh_roll60"] > 0.08
    if bull.any():
        eng_bull = float(port.loc[bull, "ret"].sum())
        bh_bull = float(port.loc[bull, "bh_ret"].sum())
        bull_cap = eng_bull / bh_bull if abs(bh_bull) > 1e-9 else float("nan")
    else:
        eng_bull = bh_bull = bull_cap = float("nan")

    fp_days = long[long["fast_path"]]
    fp_n = int(fp_days.shape[0])
    # False positive：触发且当日 y5=0（仅 S2 行有意义的标签）
    fp_s2 = fp_days[fp_days["stage"] == "S2"]
    if len(fp_s2):
        false_pos_rate = float((fp_s2["y5"] == 0).mean())
        true_pos = int((fp_s2["y5"] == 1).sum())
    else:
        false_pos_rate = float("nan")
        true_pos = 0

    return {
        "arm": name,
        "return": total_ret,
        "max_dd": max_dd(port["nav"]),
        "sharpe": sharpe(port["ret"]),
        "avg_exposure": float(port["exposure"].mean()),
        "bull_capture": bull_cap,
        "bull_engine_sum": eng_bull,
        "bull_bh_sum": bh_bull,
        "bh_return": bh_ret,
        "fast_path_events": fp_n,
        "fast_path_true_pos": true_pos,
        "false_positive_rate": false_pos_rate,
        "trade_proxy_days": int((long["w"].diff().fillna(0).abs() > 1e-6).sum()),
        "n_days": int(len(port)),
    }


def tier_triggers(probs: pd.DataFrame, top_pct: float) -> dict:
    """按 fold 内分位取 Top%。"""
    trig = {}
    if probs.empty:
        return trig
    p = probs.copy()
    p["code"] = p["code"].map(lambda c: str(int(c)) if str(c).isdigit() else str(c))
    for fold, g in p.groupby("fold"):
        thr = float(g["p_cal"].quantile(1.0 - top_pct))
        hit = g[g["p_cal"] >= thr]
        for _, r in hit.iterrows():
            trig[_key(r["code"], r["date"])] = True
    return trig


def oracle_triggers(panel: pd.DataFrame, gated: bool) -> dict:
    """
    Oracle 上界：未来 5 日确进 S4/S5 则当日允许 Fast Path。
    gated=False → 纯标签上界（回答「机会值不值得」）
    gated=True  → 同 ML 的 Rule Gate（回答「门控后还剩多少」）
    """
    trig = {}
    sub = panel[(panel["stage"].astype(str) == "S2") & (panel["y5"] == 1)]
    for _, r in sub.iterrows():
        if gated and not rule_gate(r):
            continue
        trig[_key(r["code"], r["date"])] = True
    return trig


def ml_triggers(panel: pd.DataFrame, probs: pd.DataFrame, top_pct: float, use_gate: bool = True) -> dict:
    base = tier_triggers(probs, top_pct)
    panel = panel.copy()
    panel["code"] = panel["code"].map(lambda c: str(int(c)) if str(c).isdigit() else str(c))
    panel["_ds"] = panel["date"].dt.strftime("%Y-%m-%d")
    idx = panel.set_index(["code", "_ds"], drop=False)
    out = {}
    for key in base:
        code, ds = key
        try:
            row = idx.loc[(code, ds)]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
        except KeyError:
            continue
        if str(row.get("stage")) != "S2":
            continue
        if use_gate and not rule_gate(row):
            continue
        out[key] = True
    return out


def opportunity_capture(oracle_trig: dict, ml_trig: dict) -> float:
    if not oracle_trig:
        return float("nan")
    hit = sum(1 for k in oracle_trig if k in ml_trig)
    return hit / len(oracle_trig)


def write_outputs(stamp: str, summary: dict, ports: dict, tier_rows: list):
    for d in [
        CHALLENGER / "control-v361",
        CHALLENGER / "oracle-fast-path",
        CHALLENGER / "ml-fast-path",
        DIAG,
        OUT_DIR,
        REPORT_DIR,
    ]:
        d.mkdir(parents=True, exist_ok=True)

    (OUT_DIR / f"counterfactual-fast-path-{stamp}.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False, default=str), encoding="utf-8"
    )
    pd.DataFrame(tier_rows).to_csv(DIAG / f"tier_lift_{stamp}.csv", index=False)

    for name, port in ports.items():
        sub = {
            "control": CHALLENGER / "control-v361",
            "oracle": CHALLENGER / "oracle-fast-path",
            "ml_top10": CHALLENGER / "ml-fast-path",
        }.get(name, CHALLENGER / "ml-fast-path")
        port.to_csv(sub / f"nav_{name}_{stamp}.csv", index=False)

    # Markdown report
    m = summary["metrics_table"]
    lines = [
        "# V4.0 Phase 2 — Counterfactual Challenger",
        "",
        f"日期：{stamp}",
        "",
        "> V3.6.1 冻结。Fast Path = Stage S2→S4 提前，Target 仍用 V34 Stage 曲线 mid。不上线。",
        "",
        "## 裁决建议",
        "",
        f"**{summary['verdict']}**",
        "",
        *([f"- {r}" for r in summary.get("verdict_reasons", [])]),
        "",
        "## 主表（OOS 窗：WF1∪WF2）",
        "",
        "| Arm | Return | MaxDD | Sharpe | Bull Capture | Avg Exp | FP Rate | FP Events |",
        "|-----|--------|-------|--------|--------------|---------|---------|-----------|",
    ]
    for row in m:
        def fmt(x, pct=False):
            if x is None or (isinstance(x, float) and x != x):
                return "—"
            return f"{x:.2%}" if pct else f"{x:.2f}"
        lines.append(
            f"| {row['arm']} | {fmt(row['return'], True)} | {fmt(row['max_dd'], True)} | "
            f"{fmt(row['sharpe'])} | {fmt(row['bull_capture'])} | "
            f"{fmt(row['avg_exposure'], True)} | "
            f"{fmt(row['false_positive_rate'], True)} | "
            f"{row['fast_path_events']} |"
        )
    lines += [
        "",
        "## Oracle Gap / ML Capture Efficiency",
        "",
        f"- Control Return: **{summary['control_return']:.2%}**",
        f"- Oracle Δ Return: **{summary['oracle_delta']:+.2%}**",
        f"- ML (best tier) Δ Return: **{summary['ml_best_delta']:+.2%}**",
        f"- ML Capture Efficiency: **{summary['capture_efficiency']}**",
        f"- Opportunity Capture (vs Oracle): **{summary['opportunity_capture']}**",
        f"- Incremental MaxDD (ML best − Control): **{summary['incr_maxdd']:+.2%}**",
        f"- Low-FP 候选（FP≤35%）：**{summary.get('low_fp_note', '—')}**",
        "",
        "## Top% 分层（ML，阈值自由）",
        "",
        "| Top% | ΔReturn | ΔMaxDD | Bull Cap | Opp Cap | FP Rate | Events |",
        "|------|---------|--------|----------|---------|---------|--------|",
    ]
    for t in tier_rows:
        lines.append(
            f"| Top {int(t['top_pct']*100)}% | {t['delta_return']:+.2%} | {t['delta_maxdd']:+.2%} | "
            f"{t['bull_capture']:.2f} | {t['opportunity_capture']:.2%} | "
            f"{t['false_positive_rate']:.2%} | {t['fast_path_events']} |"
        )
    lines += [
        "",
        "## 准入线对照",
        "",
        "| 指标 | 要求 | 结果 |",
        "|------|------|------|",
    ]
    for g in summary.get("gates", []):
        lines.append(f"| {g['name']} | {g['req']} | {g['result']} |")
    lines += [
        "",
        "## 说明",
        "",
        "- 本实验是**反事实研究**，不是上线批准。",
        "- Oracle：**无门控上界**（纯未来标签）；另报 `oracle_gated` 作门控敏感性。",
        "- ML：Walk-Forward OOS 概率 + Rule Gate + Top% 分层。",
        "- Fast Path Sticky：触发后最多 10 日，在自然 S2/S3 时保持至少 S4 Target。",
        "- Target：S2→40%、S4→63.5%（V34 mid），不做 ML +仓。",
        "",
        "## 文件",
        "",
        f"- JSON：`scripts/backtest-out/counterfactual-fast-path-{stamp}.json`",
        f"- 分层：`ml/diagnostics/tier_lift_{stamp}.csv`",
        f"- NAV：`ml/challenger/*/nav_*_{stamp}.csv`",
        "",
    ]
    (REPORT_DIR / f"V4.0-Phase2-Counterfactual-{stamp}.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def main():
    args = parse_args()
    stamp = datetime.now().strftime("%Y-%m-%d")

    panel_path = Path(args.panel) if args.panel else latest("ml/datasets/daily_stage_panel_*.csv")
    events_path = Path(args.events) if args.events else latest("ml/datasets/early_transition_s2_clustered_*.csv")
    if not panel_path.is_absolute():
        panel_path = ROOT / panel_path
    if not events_path.is_absolute():
        events_path = ROOT / events_path

    panel = pd.read_csv(panel_path)
    panel["date"] = pd.to_datetime(panel["date"])
    if args.main5_only:
        # Main5 标记 + 588000（若在面板中）
        m5 = panel["main5"] == True  # noqa: E712
        extra = panel["code"].astype(str) == "588000"
        # 若 main5 列全空，用池内四码
        if m5.sum() == 0:
            codes = {"515880", "159582", "513310", "159570", "588000"}
            panel = panel[panel["code"].astype(str).isin(codes)].copy()
        else:
            panel = panel[m5 | extra].copy()

    # OOS 评价窗
    oos_mask = False
    for fold in FOLDS:
        o0, o1 = fold["oos"]
        oos_mask = oos_mask | ((panel["date"] >= o0) & (panel["date"] <= o1))
    panel_oos = panel[oos_mask].copy()
    if panel_oos.empty:
        raise SystemExit("OOS 面板为空")

    events = pd.read_csv(events_path)
    print("walk-forward ML probs...")
    probs = walk_forward_probs(events)
    print(f"  probs n={len(probs)}")

    # Control
    port_c, met_c = simulate_arm(panel_oos, {}, "control")
    # Oracle 上界（无门控）+ 门控后 Oracle（诊断）
    ora = oracle_triggers(panel_oos, gated=False)
    ora_g = oracle_triggers(panel_oos, gated=True)
    port_o, met_o = simulate_arm(panel_oos, ora, "oracle")
    port_og, met_og = simulate_arm(panel_oos, ora_g, "oracle_gated")
    print(f"  oracle triggers={len(ora)} gated={len(ora_g)}")

    tier_rows = []
    ports = {"control": port_c, "oracle": port_o, "oracle_gated": port_og}
    metrics_table = [met_c, met_o, met_og]
    best = None

    for tp in TOP_PCTS:
        ml_t = ml_triggers(panel_oos, probs, tp, use_gate=True)
        port_m, met_m = simulate_arm(panel_oos, ml_t, f"ml_top{int(tp*100)}")
        ports[f"ml_top{int(tp*100)}"] = port_m
        metrics_table.append(met_m)
        delta_r = met_m["return"] - met_c["return"]
        delta_dd = met_m["max_dd"] - met_c["max_dd"]  # max_dd 为负，更负=更差；增量用绝对值差
        incr_dd_pp = abs(met_m["max_dd"]) - abs(met_c["max_dd"])
        opp = opportunity_capture(ora, ml_t)
        print(f"  ml top{int(tp*100)}% triggers={len(ml_t)} delta={delta_r:+.4f}")
        row = {
            "top_pct": tp,
            "delta_return": delta_r,
            "delta_maxdd": incr_dd_pp,
            "bull_capture": met_m["bull_capture"],
            "opportunity_capture": opp if opp == opp else float("nan"),
            "false_positive_rate": met_m["false_positive_rate"],
            "fast_path_events": met_m["fast_path_events"],
            "return": met_m["return"],
            "max_dd": met_m["max_dd"],
            "sharpe": met_m["sharpe"],
        }
        tier_rows.append(row)
        score = (delta_r, -incr_dd_pp if incr_dd_pp == incr_dd_pp else 0, met_m["bull_capture"] if met_m["bull_capture"] == met_m["bull_capture"] else -1)
        if best is None or score > best[0]:
            best = (score, tp, met_m, row)

    # 另记「低 FP 候选」：ΔReturn>0 且 FP≤35% 中收益最高者（生产更相关）
    low_fp = [t for t in tier_rows if t["delta_return"] > 0 and t["false_positive_rate"] == t["false_positive_rate"] and t["false_positive_rate"] <= 0.35]
    low_fp_best = max(low_fp, key=lambda t: t["delta_return"]) if low_fp else None

    oracle_delta = met_o["return"] - met_c["return"]
    ml_best_delta = best[2]["return"] - met_c["return"] if best else float("nan")
    if oracle_delta > 1e-6:
        cap_eff = ml_best_delta / oracle_delta
        cap_eff_s = f"{cap_eff:.1%}"
    else:
        cap_eff = float("nan")
        cap_eff_s = "N/A (Oracle 无正增量)"

    incr_maxdd = (abs(best[2]["max_dd"]) - abs(met_c["max_dd"])) if best else float("nan")
    opp_best = best[3]["opportunity_capture"] if best else float("nan")

    # Gates
    gates = []
    # OOS AUC 来自既有 Challenger 报告（此处不重训刷分）— 用分层 lift 代理
    # Top-decile lift：Top10% 事件中 y5 率 / 全样本
    lift = float("nan")
    if not probs.empty:
        p10 = tier_triggers(probs, 0.10)
        # join y5
        ys = []
        for (code, ds), _ in p10.items():
            hit = probs[(probs["code"].astype(str) == code) & (probs["date"] == pd.Timestamp(ds))]
            if len(hit):
                ys.append(float(hit.iloc[0]["y5"]))
        base_rate = float(probs["y5"].mean()) if len(probs) else 0
        if ys and base_rate > 0:
            lift = (sum(ys) / len(ys)) / base_rate
    gates.append({"name": "Top-decile Lift", "req": "≥1.5×", "result": f"{lift:.2f}×" if lift == lift else "n/a"})
    gates.append({
        "name": "Bull Capture vs Control",
        "req": "明显高于 Control",
        "result": (
            f"ML={best[2]['bull_capture']:.2f} vs C={met_c['bull_capture']:.2f}"
            if best and best[2]["bull_capture"] == best[2]["bull_capture"] and met_c["bull_capture"] == met_c["bull_capture"]
            else "n/a"
        ),
    })
    gates.append({"name": "Incremental Return", "req": ">0", "result": f"{ml_best_delta:+.2%}"})
    gates.append({"name": "Incremental MaxDD", "req": "≤ +2pp", "result": f"{incr_maxdd:+.2%}"})
    gates.append({"name": "Oracle Δ", "req": "机会本身值得做", "result": f"{oracle_delta:+.2%}"})
    gates.append({"name": "Capture Efficiency", "req": "≥30% 才值得继续", "result": cap_eff_s})

    # Verdict
    reasons = []
    verdict = "HOLD_V361"
    if oracle_delta <= 0:
        reasons.append("Oracle 相对 Control 无正增量收益 → Fast Path 机会本身不值得；停止折腾 ML Fast Path")
        verdict = "STOP_FAST_PATH"
    elif ml_best_delta <= 0:
        reasons.append("Oracle 有增量但 ML 未能兑现 → 模型/分层不够；可研究标签但不改母系统")
        verdict = "ORACLE_ONLY_NO_ML"
    elif incr_maxdd > 0.02 + 1e-9:
        reasons.append("ML 增量回撤超过 +2pp → 未过准入")
        verdict = "FAIL_DRAWDOWN"
    elif cap_eff == cap_eff and cap_eff < 0.30:
        reasons.append("Capture Efficiency <30% → 当前 ML 形式不适合继续硬推 Fast Path")
        verdict = "LOW_CAPTURE"
    elif cap_eff == cap_eff and cap_eff >= 0.60 and ml_best_delta > 0 and incr_maxdd <= 0.02:
        reasons.append("Capture≥60% 且收益/回撤过线 → 可进入 Shadow 观察（仍不上生产 Fast Path）")
        verdict = "SHADOW_CANDIDATE"
    elif cap_eff == cap_eff and 0.30 <= cap_eff < 0.60 and ml_best_delta > 0:
        reasons.append("Capture 30–60%：有价值，优先改标签/特征而非改 V3.6.1")
        verdict = "RESEARCH_CONTINUE"
    else:
        reasons.append("结果混合；保持 V3.6.1，Fast Path 不上线")

    # 至少一个 bull / 非 bull 覆盖：检查 OOS 是否跨 WF1+WF2
    has_wf1 = ((panel_oos["date"] >= "2025-08-01") & (panel_oos["date"] <= "2025-12-31")).any()
    has_wf2 = ((panel_oos["date"] >= "2026-04-01") & (panel_oos["date"] <= "2026-08-24")).any()
    gates.append({"name": "OOS 覆盖 WF1+WF2", "req": "必须", "result": "YES" if has_wf1 and has_wf2 else "PARTIAL"})

    summary = {
        "stamp": stamp,
        "panel": str(panel_path),
        "events": str(events_path),
        "verdict": verdict,
        "verdict_reasons": reasons,
        "control_return": met_c["return"],
        "oracle_delta": oracle_delta,
        "ml_best_tier": best[1] if best else None,
        "ml_best_delta": ml_best_delta,
        "capture_efficiency": cap_eff_s,
        "capture_efficiency_raw": cap_eff,
        "opportunity_capture": f"{opp_best:.1%}" if opp_best == opp_best else "n/a",
        "incr_maxdd": incr_maxdd,
        "low_fp_note": (
            f"Top {int(low_fp_best['top_pct']*100)}% Δ={low_fp_best['delta_return']:+.2%} FP={low_fp_best['false_positive_rate']:.0%}"
            if low_fp_best else "无（高收益档 FP 偏高，需收紧分层）"
        ),
        "metrics_table": metrics_table,
        "gates": gates,
        "tier_rows": tier_rows,
        "note": "Counterfactual research only; V3.6.1 frozen; no production Fast Path",
    }
    write_outputs(stamp, summary, ports, tier_rows)
    print(json.dumps({"verdict": verdict, "oracle_delta": oracle_delta, "ml_best_delta": ml_best_delta, "cap_eff": cap_eff_s}, indent=2))
    print(f"report: 回测报告/V4.0-Phase2-Counterfactual-{stamp}.md")


if __name__ == "__main__":
    main()
