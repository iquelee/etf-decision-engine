"""WP9.2 Permission-Conditioned OOS —— regime 归因资格复核。

背景：`evaluation/walk_forward.py` 在「全部评价日」上统计 alpha Rank IC，未区分市场状态。
但冻结后的 Gen-2 决策链真实行为是 Permission-conditioned：
    RISK_ON  → Selection Permission = ACTIVE  （可进攻选池/晋升）
    RANGE    → REDUCED（降档）
    RISK_OFF → DISABLED（禁新晋升，不清现任 CORE）
即 RISK_OFF 时系统本就「不使用」这个 alpha 做选池。

因此把「全 OOS IC 是否稳定」当作资格判据，需先回答 2022 年 −0.134 的失败归属：
    A. RISK_OFF（被 Permission 隔离的禁用态）贡献了绝大多数负 IC —— 真实系统不会用到它
    B. RISK_ON / RANGE（本该选的日子）也选错 —— Alpha 本身失效 → §31 Case C 坐实

本模块**不改任何策略参数**（alpha 权重 / 55-45 regime / promotion / demotion /
replacement / portfolio cap / V3.6.1 / Gen-1），只重新切片既有 OOS 输出。

口径（与 walk_forward 完全一致）：
    - 评价日 = rankings 日历；OOS 日 = 冻结规则 walk-forward fold 的 test 段（2021 起逐年）
    - score = alpha_score_v2；label = y_rank_vs_market_20d（vs-market 绝对超额）
    - IC/TB spread 逐日算、按日等权平均；excess = future_20d_excess_vs_market

运行：
    PYTHONPATH=ml python -m gen2.evaluation.permission_oos
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from gen2.evaluation.walk_forward import WalkForwardConfig, build_walk_forward_folds
from gen2.portfolio.regime import RISK_OFF, RISK_ON, RANGE, classify_regime
from gen2.portfolio.selection_permission import ACTIVE, DISABLED, REDUCED, selection_mode

SCORE_COL = "alpha_score_v2"
LABEL_COL = "y_rank_vs_market_20d"
EXCESS_COL = "future_20d_excess_vs_market"
CORE_PCT = 0.80  # 晋升候选门槛（alpha 前 20%），与 build_v2_roles 一致


def _day_metrics(g: pd.DataFrame) -> dict:
    """单日横截面指标（与 walk_forward.evaluate_fold 同口径）。"""
    sub = g.dropna(subset=[SCORE_COL, LABEL_COL])
    ic = float("nan")
    if len(sub) >= 3 and sub[SCORE_COL].nunique() >= 2 and sub[LABEL_COL].nunique() >= 2:
        x = sub[SCORE_COL].rank(method="average")
        y = sub[LABEL_COL].rank(method="average")
        ic = float(x.corr(y, method="pearson"))
    ex = g.dropna(subset=[EXCESS_COL])
    top = bot = tb = float("nan")
    if len(ex) >= 5:
        k = max(1, int(len(ex) * 0.2))
        s = ex.sort_values(SCORE_COL, ascending=False)
        top = float(s[EXCESS_COL].iloc[:k].mean())
        bot = float(s[EXCESS_COL].iloc[-k:].mean())
        tb = top - bot
    return {"rank_ic": ic, "top_excess": top, "bottom_excess": bot, "tb_spread": tb}


def _summarize(day_scores: dict, day_excess: dict, day_regimes: dict) -> dict:
    """对一组「日级指标」做等权平均汇总。"""
    ics = [v for v in day_scores.values() if not np.isnan(v)]
    return {
        "n_days": len(day_scores),
        "rank_ic": float(np.mean(ics)) if ics else float("nan"),
        "ic_pos": float(np.mean([1.0 if v > 0 else 0.0 for v in ics])) if ics else float("nan"),
        "tb_spread": float(np.nanmean([v for v in day_excess.values()])) if day_excess else float("nan"),
        "top_excess": float(np.nanmean([v[0] for v in day_excess.values()])) if day_excess else float("nan"),
        "bottom_excess": float(np.nanmean([v[1] for v in day_excess.values()])) if day_excess else float("nan"),
        "regime_mix": "|".join(f"{k}:{v}" for k, v in sorted(pd.Series(day_regimes.values()).value_counts().to_dict().items())),
    }


def run_permission_oos(features, rankings, labels, cfg: WalkForwardConfig | None = None) -> pd.DataFrame:
    """主入口：对 OOS 日做 regime / permission / promotion / year×regime 切片。"""
    from gen2.baseline.alpha_score import compute_alpha_score_v2

    alpha = compute_alpha_score_v2(features, eligible_only=True)

    # ---- 晋升候选日（系统可实际提议 CORE 晋升的日子）----
    # 用 rankings×alpha 集合算 alpha_pct（与 build_v2_roles 一致：alpha 前 20% 且 px_ma60>0）
    rk = rankings[["trade_date", "code"]].merge(
        alpha[["trade_date", "code", SCORE_COL, "px_ma60"]], on=["trade_date", "code"], how="left")
    rk = rk.sort_values(["trade_date", SCORE_COL], ascending=[True, False])
    rk["alpha_rank"] = rk.groupby("trade_date").cumcount() + 1
    n = rk.groupby("trade_date")["code"].transform("size")
    rk["alpha_pct"] = (n - rk["alpha_rank"] + 1) / n
    promo_days = set(rk[(rk["alpha_pct"] >= CORE_PCT) & (rk["px_ma60"] > 0)].groupby("trade_date").size().index)

    # ---- 合并评价样本（rankings × alpha × labels）----
    df = rankings.merge(alpha[["trade_date", "code", SCORE_COL, "market_score"]], on=["trade_date", "code"], how="inner")
    df = df.merge(labels[["trade_date", "code", LABEL_COL, EXCESS_COL]], on=["trade_date", "code"], how="inner")
    # market_score 由 benchmark 合成、同日恒定 → 按日取首个
    ms_by_day = df.groupby("trade_date")["market_score"].first()
    df["regime"] = df["trade_date"].map(ms_by_day.map(classify_regime))
    df["perm"] = df["trade_date"].map(ms_by_day.map(selection_mode))

    # ---- OOS 日（folds test 段并集）----
    dates = sorted(rankings["trade_date"].unique())
    folds = build_walk_forward_folds(dates, cfg or WalkForwardConfig())
    oos_days = sorted({d for f in folds for d in f["test_dates"]})
    if not oos_days:
        raise ValueError("无 OOS 日（评价日历太短？）")

    # 逐日预计算（只算 OOS 日）
    day_df = {d: g for d, g in df.groupby("trade_date") if d in set(oos_days)}
    day_year = {d: pd.Timestamp(d).year for d in day_df}
    day_metrics = {d: _day_metrics(g) for d, g in day_df.items()}

    def _agg(pred) -> dict:
        sel = {d: v for d, v in day_metrics.items() if pred(d)}
        if not sel:
            return {"n_days": 0, "rank_ic": float("nan"), "ic_pos": float("nan"),
                    "tb_spread": float("nan"), "top_excess": float("nan"), "bottom_excess": float("nan"), "regime_mix": ""}
        ms = {d: day_metrics[d] for d in sel}
        days = {d: (day_metrics[d]["rank_ic"],) for d in sel}
        ex = {d: (day_metrics[d]["top_excess"], day_metrics[d]["bottom_excess"]) for d in sel}
        rg = {d: day_df[d]["regime"].iloc[0] for d in sel}
        return _summarize({d: v["rank_ic"] for d, v in ms.items()}, ex, rg)

    rows = []
    # 全 OOS（raw / actionable / promotion-candidate）
    rows.append({"slice": "oos_raw", **{k: v for k, v in _agg(lambda d: True).items() if k != "regime_mix"}})
    rows.append({"slice": "oos_actionable(perm!=DISABLED)",
                 **{k: v for k, v in _agg(lambda d: day_df[d]["perm"].iloc[0] != DISABLED).items() if k != "regime_mix"}})
    rows.append({"slice": "oos_promotion_candidate_days",
                 **{k: v for k, v in _agg(lambda d: d in promo_days).items() if k != "regime_mix"}})
    # regime（raw + actionable）
    for reg in (RISK_ON, RANGE, RISK_OFF):
        rows.append({"slice": f"oos_{reg}",
                     **{k: v for k, v in _agg(lambda d, r=reg: day_df[d]["regime"].iloc[0] == r).items() if k != "regime_mix"}})
        rows.append({"slice": f"oos_{reg}_actionable",
                     **{k: v for k, v in _agg(lambda d, r=reg: day_df[d]["regime"].iloc[0] == r and day_df[d]["perm"].iloc[0] != DISABLED).items() if k != "regime_mix"}})
    # 逐年（raw）与 2021-2026 每 regime 分布
    for y in sorted(set(day_year.values())):
        rows.append({"slice": f"oos_{y}",
                     **{k: v for k, v in _agg(lambda d, yy=y: day_year[d] == yy).items() if k != "regime_mix"}})
        for reg in (RISK_ON, RANGE, RISK_OFF):
            rows.append({"slice": f"oos_{y}_{reg}",
                         **{k: v for k, v in _agg(lambda d, yy=y, r=reg: day_year[d] == yy and day_df[d]["regime"].iloc[0] == r).items() if k != "regime_mix"}})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    from gen2.data.loader import load_daily_bars, load_gen2_config, load_universe_records
    from gen2.features.build_features import build_feature_matrix
    from gen2.ranking.rank_engine import run_rank_engine
    from gen2.labels.build_labels import build_labels_vs_market

    pd.set_option("display.width", 220)
    pd.set_option("display.max_rows", 200)
    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    rankings = run_rank_engine(features)
    labels = build_labels_vs_market(features)
    out = run_permission_oos(features, rankings, labels)
    print("\n## WP9.2 Permission-Conditioned OOS（冻结规则，OOS 日切片）\n")
    print(out.to_string(index=False))
    # 关键诊断：2022 × regime
    print("\n## 2022 失败归因（A=RISK_OFF 主导 vs B=全 regime 失效）")
    for _, r in out.iterrows():
        if r["slice"] in {"oos_2022", "oos_2022_RISK_ON", "oos_2022_RANGE", "oos_2022_RISK_OFF", "oos_RISK_OFF", "oos_RISK_ON", "oos_actionable(perm!=DISABLED)"}:
            print(f"  {r['slice']:<28} n_days={r['n_days']:<5} rank_ic={r['rank_ic']:+.4f}  ic_pos={r['ic_pos']:.3f}  tb={r['tb_spread']:+.5f}  top={r['top_excess']:+.5f}  bot={r['bottom_excess']:+.5f}")
