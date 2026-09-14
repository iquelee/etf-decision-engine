"""[兼容层] 历史 `apply_turnover_cost` API —— 现已**委托**唯一权威账本
`gen2.backtest.ledger.run_ledger`，不再自带账本实现。

为什么降级（B1 / WP-G2-02）：
  本模块原实现把**现金腿也算进换手**：`turnover = Σ_全部腿 |target − pre_trade|`。
  现金↔证券的转换是**同一笔成交**，于是「现金腿 + 证券腿」被重复计数 ——
  只要策略持有现金缓冲（Gen-2 正是如此），换手与费用就被高估，最坏 **2 倍**
  （例：100% 现金 → 100% 证券，正确单边名义额 1.0，原实现给出 2.0）。
  全仓策略（无现金腿）恰好不受影响，因此该缺陷此前不易被察觉。

  权威口径（ledger.LEDGER_CONTRACT['turnover']）= **单边成交名义额** `Σ_证券|Δ|`。

调用约定（保持向后兼容，不改任何现有调用方的日期语义）：
  * 入参 `weights[trade_date]` = 「该交易日**收盘即建仓**」的目标权重（effective-date 语义）
  * 对应权威账本的 `execution_lag=0`；如需权威 signal-date 语义（T 出信号、T+1 成交），
    请直接调用 `run_ledger(..., execution_lag=1)`。
  * `return_col` 保持原义：该行持仓当日所赚收益列（`ret_1d` / `ret_1d_next` 均可）。
"""
from __future__ import annotations

import pandas as pd

from gen2.backtest.ledger import CASH, run_ledger  # noqa: F401  (CASH 供历史引用)

#: 兼容层输出列（与历史实现保持一致）
COMPAT_COLUMNS = ["trade_date", "gross_return", "turnover", "cost_bps", "net_return"]


def apply_turnover_cost(
    weights: pd.DataFrame,
    returns: pd.DataFrame,
    cost_bps: float = 10.0,
    return_col: str = "ret_1d",
) -> pd.DataFrame:
    """按单边成交名义额计费的净收益（委托 `ledger.run_ledger(execution_lag=0)`）。

    weights: trade_date, code, target_weight（该日收盘建仓）
    returns: trade_date, code, {return_col}
    """
    led = run_ledger(
        weights[["trade_date", "code", "target_weight"]],
        returns[["trade_date", "code", return_col]],
        cost_bps=cost_bps,
        calendar=None,
        execution_lag=0,          # effective-date 语义：权重行当日收盘建仓
        return_col=return_col,
    )
    return led[COMPAT_COLUMNS].copy()


def apply_turnover_cost_legacy_cash_charged(
    weights: pd.DataFrame,
    returns: pd.DataFrame,
    cost_bps: float = 10.0,
    return_col: str = "ret_1d",
) -> pd.DataFrame:
    """**仅供反例测试**：复刻已废弃的「现金腿也计费」口径，用于量化历史高估幅度。

    生产/研究路径一律使用 `apply_turnover_cost`（单边名义额）。
    """
    w = weights.pivot(index="trade_date", columns="code", values="target_weight").fillna(0.0).sort_index()
    r = returns.pivot(index="trade_date", columns="code", values=return_col).reindex(w.index).fillna(0.0)
    common = w.columns.intersection(r.columns)
    w = w[common].copy()
    r = r[common]
    cash = (1.0 - w.sum(axis=1)).clip(lower=0.0)
    w[CASH] = cash
    n_stock = len(common)
    cols = list(w.columns)
    holdings = pd.Series(0.0, index=cols)
    rows = []
    for i in range(len(w)):
        target = w.iloc[i].astype(float)
        ret = pd.Series(0.0, index=cols)
        ret.iloc[:n_stock] = r.iloc[i].values.astype(float)  # 现金收益 0
        if i == 0:
            turnover = float(target.abs().sum())
            gross = 0.0
        else:
            end_val = holdings * (1.0 + ret)
            total = float(end_val.sum())
            pre_trade = end_val / total if total > 0 else end_val
            # ← 缺陷所在：现金腿一并计入换手
            turnover = float((target - pre_trade).abs().sum())
            gross = float((holdings * ret).sum())
        cost = turnover * (cost_bps / 10000.0)
        rows.append({"trade_date": w.index[i], "gross_return": gross, "turnover": turnover,
                     "cost_bps": cost_bps, "net_return": gross - cost})
        holdings = target.copy()
    return pd.DataFrame(rows)
