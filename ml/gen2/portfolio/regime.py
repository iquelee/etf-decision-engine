"""Unified Market Regime Contract (single source of truth).

此前 Gen-2 存在三套互不一致的 risk 定义：
  - feature 层   market_score >=60 / <=40  (build_features.py)
  - attribution 层 market_score >=55 / <=45 (evaluation/attribution.py)
  - defense 层    benchmark_px_ma60 < -2%   (portfolio/defense_gate.py)

这导致 "894 天属于 RISK_OFF"（attribution 口径）与 Defense Gate 实际触发日期不一致，
进而把 undefended 的 -94.6% 误读成 "防守失效"。

本模块是唯一事实源：Selection / Attribution / Defense 三处都消费同一个
`market_score` 连续值 + `classify_regime` 分类，禁止各自发明阈值。
"""

import numpy as np
import pandas as pd

# 统一阈值（沿用原 attribution 层的 55/45，比 feature 层 60/40 更均衡）
RISK_ON_GE = 55.0
RISK_OFF_LE = 45.0

RISK_ON = "RISK_ON"
RANGE = "RANGE"
RISK_OFF = "RISK_OFF"


def market_score(benchmark_px_ma20, benchmark_px_ma60):
    """连续市场评分（0-100 量纲），由 benchmark 沪深300 的 MA20/MA60 偏离合成。

    px_ma20 / px_ma60 均为 close/MA-1（相对均线的百分比偏离）。支持标量或 Series。
    """
    return 50.0 + 500.0 * (benchmark_px_ma20 + benchmark_px_ma60)


def classify_regime(score) -> object:
    """单一 regime 分类契约。所有消费方必须调用本函数，不得自行写阈值。

    支持标量或 Series；NaN 归入 RANGE。
    """
    s = pd.Series(score) if not isinstance(score, pd.Series) else score
    out = np.where(pd.isna(s), RANGE,
                   np.where(s >= RISK_ON_GE, RISK_ON,
                            np.where(s <= RISK_OFF_LE, RISK_OFF, RANGE)))
    if isinstance(score, pd.Series):
        return pd.Series(out, index=score.index)
    return out[0]


def is_risk_off(score) -> object:
    return classify_regime(score) == RISK_OFF
