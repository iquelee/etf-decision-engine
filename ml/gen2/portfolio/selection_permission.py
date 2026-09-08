"""Selection Permission：市场状态决定进攻性 Ranking 是否 ACTIVE。

P0 诊断结论：Gen-2 不是不会选，而是「RISK_ON 会选（IC +0.075）、RISK_OFF 反着选（IC -0.083）」。
因此引入 Selection Permission——市场状态先决定能不能进攻，而不是「先选 5 个相对最强再统一砍仓」。

消费统一 regime 契约（gen2.portfolio.regime），禁止自行发明市场状态。
"""

from gen2.portfolio.regime import RANGE, RISK_OFF, RISK_ON, classify_regime

ACTIVE = "ACTIVE"
REDUCED = "REDUCED"
DISABLED = "DISABLED"

# 各模式允许的最大 CORE 数量
DEFAULT_MAX_CORE = 5
REDUCED_MAX_CORE = 3


def selection_mode(market_score) -> str:
    """市场状态 → Selection 模式。"""
    reg = classify_regime(market_score)
    if reg == RISK_ON:
        return ACTIVE
    if reg == RISK_OFF:
        return DISABLED
    return REDUCED  # RANGE


def max_core_count(market_score, base: int = DEFAULT_MAX_CORE) -> int:
    """按 Selection Permission 返回当日允许的最大 CORE 数。

    - ACTIVE   → base（默认 5）
    - REDUCED  → 3（降档）
    - DISABLED → 0（NO_CORE，进攻性 Ranking 关闭）
    """
    mode = selection_mode(market_score)
    if mode == ACTIVE:
        return base
    if mode == REDUCED:
        return REDUCED_MAX_CORE
    return 0


def selection_allowed(market_score) -> bool:
    """进攻性 Selection 是否允许（RISK_OFF 时关闭，进入防御模式）。"""
    return selection_mode(market_score) != DISABLED
