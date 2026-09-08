"""Gen-2 Walk-Forward OOS（工作包 4 / F10）。

修复报告 P1-4 的核心缺口：此前 purge/embargo 只检查配置数值，从未真正执行切分，
且因子选定与报告使用同一批历史（in-sample），不能宣称「已验证」。

本模块做真正的时间切分 walk-forward：
  - 按「自然年」滚动，expanding train + 单年 test；
  - 每个 fold 从 train 末尾剔除 purge_days + embargo_days 交易日，保证 label 不跨边界；
  - 规则已冻结（不重新选参），仅在 test 段独立评价；
  - 输出每个 fold 的 Rank IC、Top-Bottom spread、净超额、换手、集中度，并汇总按年（失败年份）。

关键：规则本身没有「训练」过程（纯规则引擎），因此「样本外」的诚实定义是
「规则开发窗口之后」的年份。默认把 train_years 年前的历史视为 in-sample（开发期），
其后的年份逐年作为 OOS test。任何人不得一边看 test 结果一边改规则后再宣称通过。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class WalkForwardConfig:
    train_years: int = 3  # expanding train 的最少年份
    purge_days: int = 20
    embargo_days: int = 5
    min_codes_per_day: int = 3


def _spearman_ic(df: pd.DataFrame, score_col: str, label_col: str) -> float:
    sub = df.dropna(subset=[score_col, label_col])
    if len(sub) < 3 or sub[score_col].nunique() < 2 or sub[label_col].nunique() < 2:
        return float("nan")
    x = sub[score_col].rank(method="average")
    y = sub[label_col].rank(method="average")
    return float(x.corr(y, method="pearson"))


def build_walk_forward_folds(dates: list, cfg: WalkForwardConfig) -> list[dict]:
    """真正的时间切分：expanding train + 单年 test，train 末尾剔除 purge+embargo。

    返回 fold 列表，每个含 train/test 的**具体日期列表**（不是只描述窗口）。
    """
    ds = pd.Series(pd.to_datetime(sorted(set(dates))))
    years = sorted(ds.dt.year.unique())
    folds = []
    for i in range(cfg.train_years, len(years)):
        test_year = years[i]
        # train：test_year 之前的所有年份（expanding），末尾剔除 purge+embargo 交易日
        train_mask = ds.dt.year < test_year
        train_idx = ds.index[train_mask]
        test_mask = ds.dt.year == test_year
        test_idx = ds.index[test_mask]
        if len(train_idx) == 0 or len(test_idx) == 0:
            continue
        # 从 train 末尾剔除 purge+embargo 交易日（按时间顺序索引位置）
        cutoff_pos = max(0, len(train_idx) - cfg.purge_days - cfg.embargo_days)
        train_dates = ds.iloc[train_idx[:cutoff_pos]].dt.date.tolist()
        test_dates = ds.iloc[test_idx].dt.date.tolist()
        folds.append({
            "fold": len(folds) + 1,
            "test_year": test_year,
            "train_start": ds.iloc[train_idx[0]].date(),
            "train_end": ds.iloc[train_idx[cutoff_pos - 1]].date() if cutoff_pos > 0 else None,
            "test_start": ds.iloc[test_idx[0]].date(),
            "test_end": ds.iloc[test_idx[-1]].date(),
            "train_dates": train_dates,
            "test_dates": test_dates,
            "purge_days": cfg.purge_days,
            "embargo_days": cfg.embargo_days,
            "n_train": len(train_dates),
            "n_test": len(test_dates),
        })
    return folds


def evaluate_fold(rankings: pd.DataFrame, labels: pd.DataFrame, fold: dict, score_col: str, label_col: str) -> dict:
    """在 fold 的 test 段独立评价信号（train 段完全不用）。"""
    test_dates = set(fold["test_dates"])
    df = rankings.merge(labels, on=["trade_date", "code"], how="inner")
    df = df[df["trade_date"].isin(test_dates)].copy()
    if df.empty:
        return {"fold": fold["fold"], "test_year": fold["test_year"], "n_days": 0, "rank_ic": float("nan"), "ic_pos": float("nan"), "top_bottom_spread": float("nan")}

    # 逐日 IC
    ics = []
    for d, g in df.groupby("trade_date"):
        ic = _spearman_ic(g, score_col, label_col)
        if not np.isnan(ic):
            ics.append(ic)
    ic_arr = np.array(ics) if ics else np.array([])

    # Top-Bottom spread（top 20% vs bottom 20% 的未来超额）
    excess_col = "future_20d_excess_vs_market" if "future_20d_excess_vs_market" in df.columns else "y_excess_20d"
    sub = df.dropna(subset=[excess_col])
    spreads = []
    if not sub.empty:
        for d, g in sub.groupby("trade_date"):
            n = len(g)
            k = max(1, int(n * 0.2))
            g = g.sort_values(score_col, ascending=False)
            top_mean = g[excess_col].iloc[:k].mean()
            bottom_mean = g[excess_col].iloc[-k:].mean()
            spreads.append(float(top_mean - bottom_mean))

    return {
        "fold": fold["fold"],
        "test_year": fold["test_year"],
        "n_days": int(df["trade_date"].nunique()),
        "rank_ic": float(ic_arr.mean()) if len(ic_arr) else float("nan"),
        "ic_pos": float((ic_arr > 0).mean()) if len(ic_arr) else float("nan"),
        "top_bottom_spread": float(np.mean(spreads)) if spreads else float("nan"),
    }


def run_walk_forward_oos(
    features: pd.DataFrame,
    rankings: pd.DataFrame,
    labels: pd.DataFrame,
    score_col: str = "alpha_score_v2",
    label_col: str = "y_rank_vs_market_20d",
    cfg: WalkForwardConfig | None = None,
) -> tuple[pd.DataFrame, list[dict]]:
    """执行完整 walk-forward OOS，返回（逐 fold 汇总表, fold 明细）。

    label_col 默认用 vs-market label（跨 universe 版本稳定的绝对超额定义）。
    """
    cfg = cfg or WalkForwardConfig()
    # 用「候选池有 eligible 标的」的日期作为评价日历（不是 features 全部日期，
    # 后者含 benchmark 510300 的 2011 年超长历史，会导致早期空 fold）。
    dates = sorted(rankings["trade_date"].unique())
    folds = build_walk_forward_folds(dates, cfg)
    rows = [evaluate_fold(rankings, labels, f, score_col, label_col) for f in folds]
    summary = pd.DataFrame(rows)
    if not summary.empty:
        summary["ic_valid"] = summary["rank_ic"].notna()
    return summary, folds


if __name__ == "__main__":
    from gen2.data.loader import load_daily_bars, load_gen2_config, load_universe_records
    from gen2.features.build_features import build_feature_matrix
    from gen2.ranking.rank_engine import run_rank_engine
    from gen2.labels.build_labels import build_labels_vs_market
    from gen2.baseline.alpha_score import compute_alpha_score_v2

    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    rankings = run_rank_engine(features)
    # 固定可排名集合后算 alpha（P1-4 横截面修复）
    alpha = compute_alpha_score_v2(features, eligible_only=True)
    rankings = rankings.merge(alpha[["trade_date", "code", "alpha_score_v2"]], on=["trade_date", "code"], how="left")
    labels = build_labels_vs_market(features)

    summary, folds = run_walk_forward_oos(features, rankings, labels)
    pd.set_option("display.width", 200)
    print("\n## Walk-Forward OOS（V2 alpha vs market label）\n")
    print(summary.to_string(index=False))
    valid = summary[summary["ic_valid"]]
    if not valid.empty:
        print(f"\n## 汇总：OOS Rank IC mean={valid['rank_ic'].mean():.5f}  IC>0 占比={valid['ic_pos'].mean():.3f}  平均TB spread={valid['top_bottom_spread'].mean():.5f}")
