"""Gen-2.1 M2 — Consolidation Quality Gate（晋升质量门，Development/Validation 层草案）。

设计（PLAN_GEN2_1 §6）：
    consolidation_quality = 0-100 透明评分（规则式、分档映射，权重固定草案 —— 本层只调 min_quality 门槛，
    不做分档/权重自由搜索，遵守「减少自由参数」纪律）
    组件：
      sideway_days（连续 range<=15% 交易日数）   —— 横盘时间
      sideway_range（20 日高低振幅）            —— 区间收敛
      volume_ratio_5_20                        —— 缩量
      volume_compression_slope                 —— 缩量趋势
      volatility_compression                   —— 波动压缩
      硬前置：px_ma60 > 0（趋势未破坏），否则 quality = 0

    gate 语义：consolidation_quality >= min_quality 才放行 promotion / replacement（M3 联调）。
    Gate 不进 alpha/排名 —— 只决定「现在值不值得晋升」。

本模块纯函数。panel 列：trade_date, code, sideway_days, sideway_range, volume_ratio_5_20,
volume_compression_slope, volatility_compression, px_ma60。

Validation(2024) 敏感度矩阵（选 min_quality，含 purge/口径字段）：
    PYTHONPATH=ml python -m gen2.portfolio.consolidation_gate --sensitivity
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# 分档映射（透明规则草案；Validation 只调 min_quality，不改分档）
# 单位契约（与 build_features.py 对齐）：
#   sideway_range = hh20/ll20 - 1.0  → 小数（6% = 0.06），档位为 0.06/0.09/0.12/0.15
#   sideway_days  = 连续半开区间 [lo, hi)：lo <= v < hi，禁止整数空洞（4/9/14/19/24 必须归档）
# 其余组件档位同侧：半开 [lo, hi)，无空洞。
_TIERS = {
    "sideway_days": [(0, 5, 0.0), (5, 10, 20.0), (10, 15, 40.0), (15, 20, 60.0), (20, 25, 80.0), (25, None, 100.0)],
    "sideway_range": [(None, 0.06, 100.0), (0.06, 0.09, 80.0), (0.09, 0.12, 60.0), (0.12, 0.15, 40.0), (0.15, None, 20.0)],
    "volume_ratio_5_20": [(None, 0.70, 100.0), (0.70, 0.85, 80.0), (0.85, 1.00, 60.0), (1.00, 1.15, 40.0), (1.15, None, 20.0)],
    "volume_compression_slope": [(None, -0.05, 100.0), (-0.05, 0.0, 80.0), (0.0, 0.10, 50.0), (0.10, None, 20.0)],
    "volatility_compression": [(None, -0.10, 100.0), (-0.10, 0.0, 80.0), (0.0, 0.20, 50.0), (0.20, None, 20.0)],
}
# 组件权重（固定草案，合计 1.0）
_W = {"sideway_days": 0.25, "sideway_range": 0.25, "volume_ratio_5_20": 0.20,
      "volume_compression_slope": 0.15, "volatility_compression": 0.15}


def _tier_score(value, tiers) -> float:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return 0.0
    for lo, hi, s in tiers:
        if (lo is None or value >= lo) and (hi is None or value < hi):
            return s
    return 0.0


def compute_consolidation_quality(panel: pd.DataFrame, weights: dict | None = None) -> pd.DataFrame:
    """per (trade_date, code) consolidation_quality 0-100；px_ma60<=0 硬前置 → 0。"""
    w = {**_W, **(weights or {})}
    cols = ["trade_date", "code", "px_ma60"] + list(_W.keys())
    df = panel[[c for c in cols if c in panel.columns]].copy()
    df["code"] = df["code"].astype(str).str.zfill(6)
    out = pd.DataFrame({"trade_date": df["trade_date"], "code": df["code"]})
    out["quality"] = 0.0
    for feat in _W:
        s = df[feat].apply(lambda v: _tier_score(v, _TIERS[feat]))
        out["quality"] = out["quality"] + w[feat] * s
    # 硬前置：px_ma60 缺失或 <=0 → 0（趋势未破坏是晋升窗口的前置条件）
    trend_ok = df["px_ma60"].notna() & (df["px_ma60"] > 0)
    out.loc[~trend_ok, "quality"] = 0.0
    out["quality"] = out["quality"].clip(0, 100).round(2)
    return out


def gate_pass(quality, min_quality: float) -> np.ndarray:
    q = np.asarray(quality, dtype=float)
    return q >= float(min_quality)


if __name__ == "__main__":
    import sys

    if "--sensitivity" not in sys.argv:
        print(__doc__)
        sys.exit(0)

    from gen2.baseline.alpha_score import compute_alpha_score_v2
    from gen2.data.loader import load_daily_bars, load_gen2_config, load_universe_records
    from gen2.features.build_features import build_feature_matrix
    from gen2.labels.build_labels import build_labels_vs_market
    from gen2.ranking.rank_engine import run_rank_engine
    from gen2.portfolio.cluster_leadership import compute_cluster_leadership

    pd.set_option("display.width", 240)
    pd.set_option("display.max_rows", 200)

    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    rankings = run_rank_engine(features)
    alpha = compute_alpha_score_v2(features, eligible_only=True)
    labels = build_labels_vs_market(features)
    quality = compute_consolidation_quality(features)
    ms = features.groupby("trade_date")["market_score"].first()
    cal = sorted(features["trade_date"].unique())

    # ---- 晋升候选代理（M2 阶段；M3 联调后以真实 PROMOTION 状态机复核）----
    # 参数从 GEN2_RULE_V21_DRAFT.json 读取（与 M1 audit 一致，消除 shadow config）：
    # cluster_leadership 段（top_cluster_count / cluster_min_members / leaders_per_cluster / breadth_min_pos）
    import json
    import os

    _draft = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "..",
                                         "ml", "gen2", "manifests", "GEN2_RULE_V21_DRAFT.json"),
                            encoding="utf-8"))
    _cl = _draft.get("cluster_leadership", {})
    _tpc = _cl.get("top_cluster_count")
    _cmm = _cl.get("cluster_min_members")
    _lpc = _cl.get("leaders_per_cluster")
    _bmp = _cl.get("breadth_min_pos")
    if None in (_tpc, _cmm, _lpc, _bmp):
        raise SystemExit("[FATAL] DRAFT cluster_leadership 参数未填齐，拒绝运行（防 shadow config 漂移）")
    _a90 = alpha.groupby("trade_date")["alpha_score_v2"].transform(lambda s: s.quantile(0.90))
    alpha["p90"] = _a90
    panel = rankings.merge(alpha[["trade_date", "code", "alpha_score_v2", "p90"]], on=["trade_date", "code"], how="left")
    panel = panel.merge(features[["trade_date", "code", "px_ma60"]], on=["trade_date", "code"], how="left")
    panel["code"] = panel["code"].astype(str).str.zfill(6)
    _, cf = compute_cluster_leadership(panel, top_cluster_count=_tpc, cluster_min_members=_cmm,
                                       leaders_per_cluster=_lpc, breadth_min_pos=_bmp)
    cand = cf[(cf["is_cluster_leader"] == True)].merge(  # noqa: E712
        alpha[["trade_date", "code", "alpha_score_v2", "p90"]], on=["trade_date", "code"], how="left")
    cand = cand[(cand["alpha_score_v2"] >= cand["p90"])].copy()
    cand = cand.merge(quality, on=["trade_date", "code"], how="left")
    cand = cand.merge(labels[["trade_date", "code", "future_20d_excess_vs_market"]],
                      on=["trade_date", "code"], how="left")

    # ---- 评价窗口 + purge（协议 §2.1.1：label 触及下一层 → purge；MAX_FORWARD_HORIZON=40）----
    from datetime import date

    dev_scan = "--dev-scan" in sys.argv  # 描述性对照（非选择依据）
    win_start = date(2023, 1, 1) if dev_scan else date(2024, 1, 1)
    win_end = date(2023, 12, 31) if dev_scan else date(2024, 12, 31)
    max_h = 40
    cal_d = [pd.Timestamp(x).date() for x in cal]
    win_days = [d for d in cal_d if win_start <= d <= win_end]
    # purge：signal 后第 40 个交易日仍 <= win_end（label 不触下一层）
    valid_signal = []
    purged_trade_dates = []
    for d in win_days:
        tail = [x for x in cal_d if x > d]
        if len(tail) >= max_h and tail[max_h - 1] <= win_end:
            valid_signal.append(d)
        else:
            purged_trade_dates.append(d)
    # 候选先限定窗口内（cand 是全研究周期 merge 结果），再按有效 signal 日切分
    cand_win = cand[cand["trade_date"].isin(win_days)].copy()
    cand_v = cand_win[cand_win["trade_date"].isin(valid_signal)].copy()
    purged_candidate_rows = int(len(cand_win) - len(cand_v))
    eff_start = str(min(valid_signal)) if valid_signal else None
    eff_end = str(max(valid_signal)) if valid_signal else None

    win_label = "Development(2023) 描述对照" if dev_scan else "Validation(2024) 阈值选择"
    print(f"\n## M2 敏感度矩阵（{win_label}）—— min_quality 选择（晋升候选 proxy）")
    print(f"   proxy 参数(DRAFT): top_cluster_count={_tpc} cluster_min_members={_cmm} "
          f"leaders_per_cluster={_lpc} breadth_min_pos={_bmp}")
    print(f"   口径字段: max_forward_horizon={max_h}  purged_trade_dates={len(purged_trade_dates)}  "
          f"purged_candidate_rows={purged_candidate_rows}  "
          f"effective_signal_start={eff_start}  effective_signal_end={eff_end}")
    print(f"   候选(proxy, 窗口内)总数: {len(cand_win)}（purged 剔除 {purged_candidate_rows}）  有效评价: {len(cand_v)}\n")

    rows = []
    for mq in [0, 20, 40, 50, 60, 70, 80]:
        passed = cand_v[cand_v["quality"] >= mq]
        fwd = passed["future_20d_excess_vs_market"].dropna()
        rows.append({
            "min_quality": mq,
            "n_passed": len(passed),
            "pass_ratio": len(passed) / len(cand_v) if len(cand_v) else float("nan"),
            "fwd20_mean": float(fwd.mean()) if len(fwd) else float("nan"),
            "fwd20_pos_ratio": float((fwd > 0).mean()) if len(fwd) else float("nan"),
            "false_promo_rate": float((fwd < 0).mean()) if len(fwd) else float("nan"),
        })
    sens = pd.DataFrame(rows)
    print(sens.to_string(index=False, float_format=lambda x: f"{x:.4f}"))
    sens.to_csv("outputs/gen2_v21_m2_sensitivity.csv", index=False)
    print("\n[OK] outputs/gen2_v21_m2_sensitivity.csv")
