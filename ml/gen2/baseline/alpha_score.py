"""Gen-2 V2 Alpha Leadership Score（与 Portfolio Utility 分离）。

P0 诊断结论：V1 把「找赢家(Alpha)」和「控风险(Utility)」混成一个 Leadership Score，
导致正 IC 的 Alpha 因子被负 IC 的风险/组合因子抵消（Rank IC≈0）。

本模块按结构重构拆成两个正交分数：
  - AlphaScore-v2：只回答「谁更可能成为未来 20D 领导资产」，第一版 = Trend + RS + Breakout 等权；
  - UtilityScore-v2：回答「强者里谁更适合一起持有」，= Volatility / Diversification / Liquidity，
    不参与排名，只用于组合构建（Cluster 约束 / 仓位 / 拥挤度）。
"""

from gen2.baseline.leadership_score import add_component_scores

# AlphaScore-v2 第一版权重：Trend + RS + Breakout 等权（报告建议，不做全样本优化）
ALPHA_WEIGHTS_V2 = {"trend": 1 / 3, "rs": 1 / 3, "breakout": 1 / 3}


def compute_alpha_score_v2(features, eligible_only: bool = True):
    """返回带 `alpha_score_v2` 列的 DataFrame。

    alpha_score_v2 = mean(trend_score, rs_score, breakout_approach_score)
    三个子分都已是同日横截面百分位（0-100），直接等权平均。

    P1-4 修复：eligible_only=True 时先固定「可排名集合」= ELIGIBLE 且非 benchmark，
    再算横截面（与 JS 端「只给当前合格代码评分」一致）。否则 benchmark/不合格资产
    会污染横截面排名分母。
    """
    from gen2.data.loader import load_gen2_config

    scored_all = add_component_scores(features)
    if eligible_only:
        cfg = load_gen2_config()
        benchmark_code = cfg["data"].get("benchmark_code", "510300")
        mask = (scored_all["eligibility"] == "ELIGIBLE") & (scored_all["code"].astype(str).str.zfill(6) != benchmark_code)
        # 先对可排名集合重算横截面，非合格资产 alpha 置 NaN
        eligible = scored_all[mask].copy()
        # 横截面百分位依赖 add_component_scores 内部 groupby("trade_date")，这里对 eligible 子集重算
        from gen2.baseline.leadership_score import add_component_scores as _acs
        eligible_scored = _acs(eligible)
        eligible_scored["alpha_score_v2"] = (
            eligible_scored["trend_score"] + eligible_scored["rs_score"] + eligible_scored["breakout_approach_score"]
        ) / 3.0
        out = features.copy()
        out["alpha_score_v2"] = float("nan")
        out = out.drop(columns=["alpha_score_v2"])
        merged = out.merge(eligible_scored[["trade_date", "code", "alpha_score_v2"]], on=["trade_date", "code"], how="left")
        return merged
    scored_all["alpha_score_v2"] = (
        scored_all["trend_score"] + scored_all["rs_score"] + scored_all["breakout_approach_score"]
    ) / 3.0
    return scored_all


def compute_utility_score_v2(features):
    """返回带 `utility_score_v2` 列的 DataFrame。

    只用于组合构建，不参与排名。第一版 = VolatilityQuality(0.4) + Diversification(0.3) + Liquidity(0.3)。
    """
    scored = add_component_scores(features)
    scored["utility_score_v2"] = (
        scored["volatility_quality_score"] * 0.4
        + scored["diversification_score_v1"] * 0.3
        + scored["liquidity_score"] * 0.3
    )
    return scored
