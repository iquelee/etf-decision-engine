"""Gen-2 单一回测账本（工作包 3 重建）。

修复 P0-3（T+1 执行错位）与 P0-4（现金被当作收费交易腿）。

核心时间线（每个交易日 t 收盘，按 calendar 顺序推进）：
  1. 旧仓（t-1 收盘确定，含显式现金腿）在 t 收盘的毛收益 = Σ_证券 holdings[c] * ret_1d[t][c]
     （现金收益恒为 0）
  2. 漂移后证券权重 pre_trade[c] = holdings[c]*(1+ret_1d[t][c]) / (1+毛收益)
  3. 执行「上一交易日 t-1」产生的信号：target = signals[signal_date = prev(t)]
     （t-1 无信号则保持漂移后持仓，不调仓）
  4. 换手 turnover = Σ_证券 |target[c] - pre_trade[c]|（**现金腿不计佣金**）
  5. 成本 = turnover * cost_bps/10000
  6. 净收益 = 毛收益 - 成本
  7. 新仓 = target（现金 = 1 - Σ_证券 target，clip≥0）

关键不变量：
  - 信号在 signal_date 收盘后产生，在下一个交易日 execution_date 收盘成交；
  - 新仓从 execution_date 收盘持有，承担 ret_1d[execution_date 的下一交易日] 这一段收益；
  - 缺持仓报价（holdings>0 但 ret_1d 缺失）显式记入 missing_quotes，绝不静默当 0 收益。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

CASH = "__cash__"


def run_ledger(
    signals: pd.DataFrame,
    returns: pd.DataFrame,
    cost_bps: float = 10.0,
    calendar: list | None = None,
) -> pd.DataFrame:
    """单一账本回测。

    signals: DataFrame[signal_date, code, target_weight] —— 信号日（收盘后）产生的目标权重
    returns: DataFrame[trade_date, code, ret_1d] —— ret_1d[t] = close[t]/close[t-1] - 1

    返回每行一个 execution_date 的账本：
      trade_date / signal_date / gross_return / turnover / cost_bps / net_return / missing_quotes
    """
    sig = signals[["trade_date", "code", "target_weight"]].copy()
    sig["code"] = sig["code"].astype(str)
    ret = returns[["trade_date", "code", "ret_1d"]].copy()
    ret["code"] = ret["code"].astype(str)

    w_sig = sig.pivot(index="trade_date", columns="code", values="target_weight")
    r_mat = ret.pivot(index="trade_date", columns="code", values="ret_1d")

    # 统一交易日历：信号日 ∪ 收益日，排序
    if calendar is None:
        cal = sorted(set(w_sig.index) | set(r_mat.index))
    else:
        cal = sorted(calendar)
    codes = sorted(set(w_sig.columns) | set(r_mat.columns))

    w_sig = w_sig.reindex(index=cal, columns=codes).fillna(0.0)
    # 收益矩阵：缺失保留 NaN，用于缺失报价检测
    r_mat = r_mat.reindex(index=cal, columns=codes)

    prev = {cal[i]: cal[i - 1] for i in range(1, len(cal))}

    holdings = {c: 0.0 for c in codes}  # 证券权重，期初空仓
    cash = 1.0  # 期初全现金

    rows = []
    for t in cal:
        ret_t = r_mat.loc[t]
        # 1) 旧仓毛收益（现金收益 0）
        gross = 0.0
        missing = []
        for c in codes:
            h = holdings.get(c, 0.0)
            if h <= 0:
                continue
            rc = ret_t.get(c, np.nan)
            if pd.isna(rc):
                missing.append(c)  # 缺报价：显式标记，不静默当 0
            else:
                gross += h * rc

        # 2) 漂移后权重
        denom = 1.0 + gross
        pre_trade = {}
        for c in codes:
            h = holdings.get(c, 0.0)
            rc = ret_t.get(c, 0.0)
            if pd.isna(rc):
                rc = 0.0  # 停牌/缺报价：价格不变参与漂移，但已记 missing
            pre_trade[c] = h * (1.0 + rc) / denom if denom > 0 else 0.0

        # 3) 执行上一交易日信号
        sig_date = prev.get(t)
        if sig_date is not None and sig_date in w_sig.index:
            target = {c: float(w_sig.loc[sig_date, c]) for c in codes}
            # 超配拒绝：证券权重之和 > 1 时按比例缩到 1（显式约束）
            tsum = sum(target.values())
            if tsum > 1.0:
                for c in target:
                    target[c] = target[c] / tsum
        else:
            # 无信号：保持漂移后持仓，不调仓
            target = dict(pre_trade)

        # 4) 换手（只算证券腿）
        turnover = sum(abs(target[c] - pre_trade[c]) for c in codes)

        # 5) 成本
        cost = turnover * cost_bps / 10000.0
        net = gross - cost

        rows.append({
            "trade_date": t,
            "signal_date": sig_date,
            "gross_return": gross,
            "turnover": turnover,
            "cost_bps": cost_bps,
            "net_return": net,
            "missing_quotes": "|".join(missing) if missing else None,
        })

        # 7) 新仓
        holdings = {c: target[c] for c in codes}
        cash = max(0.0, 1.0 - sum(target.values()))

    return pd.DataFrame(rows)
