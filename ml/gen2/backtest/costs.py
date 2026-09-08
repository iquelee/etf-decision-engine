from __future__ import annotations

import numpy as np
import pandas as pd

CASH = "__cash__"


def apply_turnover_cost(weights: pd.DataFrame, returns: pd.DataFrame, cost_bps: float = 10.0, return_col: str = "ret_1d") -> pd.DataFrame:
    """Apply net return = gross - turnover * cost_rate，维护真实持仓（F07 修复）。

    weights: trade_date, code, target_weight
    returns: trade_date, code, {return_col}

    成本按「成交差额」计算，而非「今天目标权重 − 昨天目标权重」：
      - 剩余权重（1 − Σ target）作为显式现金资产（收益 0），参与漂移与调仓；
      - 昨日持仓 holdings 经当日收益漂移后，交易前权重
        pre_trade = holdings*(1+ret) / Σ(holdings*(1+ret))
      - 当日换手 = Σ|target_with_cash − pre_trade|（含现金↔股票的真实转换成本）
      - 当日毛收益 = Σ(holdings_stock × ret)
    等权基准不再获得免费再平衡；有现金的策略也不再被错误计入现金进出成本。
    """
    w = weights.pivot(index="trade_date", columns="code", values="target_weight").fillna(0.0).sort_index()
    r = returns.pivot(index="trade_date", columns="code", values=return_col).reindex(w.index).fillna(0.0)
    common = w.columns.intersection(r.columns)
    w = w[common]
    r = r[common]

    # 现金列（剩余权重，clip 到非负；超配忽略）
    cash = (1.0 - w.sum(axis=1)).clip(lower=0.0)
    w = w.copy()
    w[CASH] = cash

    n_stock = len(common)
    cols = list(w.columns)  # [stock..., __cash__]
    holdings = np.zeros(len(cols))
    turnovers, grosses, nets = [], [], []
    for i in range(len(w)):
        target = w.iloc[i].values.astype(float)
        ret = np.zeros(len(cols))
        ret[:n_stock] = r.iloc[i].values.astype(float)  # 现金收益 0
        if i == 0:
            # 首日：期初空仓，建仓到 target（含现金），换手 = Σ|target|
            turnover = float(np.abs(target).sum())
            gross = 0.0
        else:
            end_val = holdings * (1.0 + ret)
            total = float(end_val.sum())
            pre_trade = end_val / total if total > 0 else end_val
            turnover = float(np.abs(target - pre_trade).sum())
            gross = float((holdings * ret).sum())
        cost = turnover * (cost_bps / 10000.0)
        net = gross - cost
        turnovers.append(turnover)
        grosses.append(gross)
        nets.append(net)
        holdings = target.copy()

    return pd.DataFrame({
        "trade_date": w.index,
        "gross_return": grosses,
        "turnover": turnovers,
        "cost_bps": cost_bps,
        "net_return": nets,
    })
