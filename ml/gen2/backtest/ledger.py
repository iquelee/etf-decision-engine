"""Gen-2 **唯一权威回测账本**（WP-G2-02 / B1 统一）。

本模块是回测口径的单一事实源：T+1 时序、现金腿、费用、换手、资金守恒、公共日历、
期初状态与末日处理全部在此定义。**其他脚本不得再自行实现账本**（历史上
`backtest/costs.py` 曾是一套并行实现，口径与本模块不一致，现已降级为委托本模块的兼容层）。

=======================  口径契约（LEDGER_CONTRACT）  =======================

时间线（每个交易日 t 收盘，按 `calendar` 顺序推进）
  1. 旧仓（t-1 收盘确定，含显式现金腿）在 t 收盘的毛收益
        gross_t = Σ_证券 holdings_c × ret_1d[t][c]          （现金收益恒为 0）
  2. 漂移后权重
        pre_trade_c = holdings_c × (1 + ret_1d[t][c]) / (1 + gross_t)
  3. 执行信号：`execution_lag=1`（**权威默认**，signal-date API）
        执行 signal_date = prev(t) 的目标权重
     `execution_lag=0`（effective-date API，供 `costs.apply_turnover_cost` 兼容层使用）
        执行 signal_date = t 的目标权重（即「该行日期收盘即建仓」）
     判定按「该日**是否存在信号行**」：
       * 有信号行（含**全零权重 = 清仓信号**）→ 按该行调仓
       * 无信号行               → 保持漂移后持仓，不调仓
  4. 换手（**权威口径：单边成交名义额**）
        turnover_t = Σ_证券 |target_c − pre_trade_c|
     现金腿**不计费**：现金↔证券的转换是同一笔成交，不能用 Σ_全部腿|Δ|（那会翻倍）。
  5. 费用 = turnover_t × cost_bps / 10000
  6. 净收益 net_t = gross_t − 费用
  7. 新仓 = target；现金 cash_t = 1 − Σ_证券 target（clip ≥ 0）

资金守恒（逐日必须成立，测试逐行断言）
  * Σ_证券 target + cash = 1（`conservation_error` 即此式的偏差，必须为 0）
  * cash ≥ 0（超配被显式处理，见下）
  * equity_t = equity_{t-1} × (1 + net_t)（复利恒等，`equity` 列即此乘积）
  * net_t = gross_t − turnover_t × cost_bps / 10000（恒等，`cost` 列给出金额）

超配（Σ target > 1）
  * policy='scale'（默认）：按比例缩放到 1，并置 `over_allocated=True`（显式留痕，不静默）
  * policy='reject'：直接抛 ValueError

期初状态（initial_state='all_cash'）
  * equity_0 = 1.0，全部为现金；首个交易日无 prev 信号可执行 → gross=0、turnover=0
    （**不产生首日幻影收益**）；signal-date API 下最早成交发生在 calendar 的第二个交易日。

末日处理（terminal）
  * **不强制平仓**：期末净值 = 最后一个交易日的 equity（按 mark-to-market）
  * 最后一个交易日的信号**没有下一个交易日可成交** → 不执行，并置 `dropped_signal=True`
  * 缺持仓报价显式记入 `missing_quotes`（绝不静默当 0 收益）

公共日历
  * 调用方必须传入同一个 `calendar`；`calendar=None` 时退化为「信号日 ∪ 收益日」的并集。
  * 所有可比策略必须使用**同一 calendar**（同一首日、同一末日、同一天数），
    由 `assert_common_calendar()` 强制校验。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

CASH = "__cash__"

#: 口径常量（供测试 / 报告 / 兼容层引用）
LEDGER_CONTRACT = {
    "execution_lag_default": 1,
    "turnover": "one_way_stock_legs",   # Σ_证券|Δ|，现金腿不计费
    "cost": "turnover * cost_bps/10000",
    "initial_state": "all_cash",
    "initial_equity": 1.0,
    "terminal": "mark_to_market_no_liquidation",
    "conservation": "Σtarget + cash == 1 and cash >= 0 and equity_t == equity_{t-1}*(1+net_t)",
    "calendar": "caller-supplied shared calendar",
    "missing_quote": "explicit missing_quotes column, never treated as 0 return",
}

_EPS = 1e-12


def run_ledger(
    signals: pd.DataFrame,
    returns: pd.DataFrame,
    cost_bps: float = 10.0,
    calendar: list | None = None,
    *,
    execution_lag: int = 1,
    return_col: str = "ret_1d",
    overallocation_policy: str = "scale",
    strict: bool = False,
) -> pd.DataFrame:
    """单一账本回测（口径见模块 docstring / ``LEDGER_CONTRACT``）。

    signals: DataFrame[trade_date, code, target_weight]
    returns: DataFrame[trade_date, code, {return_col}]
      return_col='ret_1d' 时 ret_1d[t] = close[t]/close[t-1] - 1

    返回每行一个交易日 t 的账本：
      trade_date / signal_date / gross_return / turnover / cost_bps / cost /
      net_return / equity / cash_weight / gross_exposure / over_allocated /
      missing_quotes / dropped_signal / conservation_error
    """
    if execution_lag not in (0, 1):
        raise ValueError("execution_lag 只支持 0（effective-date API）或 1（signal-date API，权威默认）")
    if overallocation_policy not in ("scale", "reject"):
        raise ValueError("overallocation_policy 只支持 'scale' 或 'reject'")

    sig = signals[["trade_date", "code", "target_weight"]].copy()
    sig["code"] = sig["code"].astype(str)
    ret = returns[["trade_date", "code", return_col]].rename(columns={return_col: "ret_1d"}).copy()
    ret["code"] = ret["code"].astype(str)

    w_sig_raw = sig.pivot(index="trade_date", columns="code", values="target_weight")
    r_mat = ret.pivot(index="trade_date", columns="code", values="ret_1d")

    cal = sorted(set(w_sig_raw.index) | set(r_mat.index)) if calendar is None else sorted(calendar)
    codes = sorted(set(w_sig_raw.columns) | set(r_mat.columns))

    # 信号日的判定必须是「该日**存在信号行**」，而不是「该日权重非零」：
    # 全零目标权重是**清仓信号**，与「该日没有信号行（保持漂移后持仓，不调仓）」语义不同。
    sig_dates = set(w_sig_raw.index)
    w_sig = w_sig_raw.reindex(index=cal, columns=codes).fillna(0.0)
    r_mat = r_mat.reindex(index=cal, columns=codes)  # 缺失保留 NaN，用于缺失报价检测

    prev = {cal[i]: cal[i - 1] for i in range(1, len(cal))}
    nextday = {cal[i]: cal[i + 1] for i in range(len(cal) - 1)}

    holdings = {c: 0.0 for c in codes}  # 期初空仓（证券）
    equity = LEDGER_CONTRACT["initial_equity"]

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
                gross += h * float(rc)

        # 2) 漂移后权重
        denom = 1.0 + gross
        pre_trade = {}
        for c in codes:
            h = holdings.get(c, 0.0)
            rc = ret_t.get(c, 0.0)
            if pd.isna(rc):
                rc = 0.0  # 停牌/缺报价：价格不变参与漂移（已记 missing）
            pre_trade[c] = h * (1.0 + float(rc)) / denom if denom > 0 else 0.0

        # 3) 执行信号
        sig_date = prev.get(t) if execution_lag == 1 else t
        if sig_date is not None and sig_date in w_sig.index and sig_date in sig_dates:
            target = {c: float(w_sig.loc[sig_date, c]) for c in codes}
            tsum = sum(target.values())
            over_allocated = tsum > 1.0 + 1e-9
            if over_allocated:
                if overallocation_policy == "reject":
                    raise ValueError(f"超配被拒绝（policy=reject）：{t} 目标权重合计 {tsum:.6f} > 1")
                for c in target:
                    target[c] = target[c] / tsum  # 显式缩减，留痕 over_allocated
        else:
            target = dict(pre_trade)  # 无信号：保持漂移后持仓，不调仓
            over_allocated = False

        # 4) 换手（权威口径：单边成交名义额 = Σ_证券|Δ|；现金腿不计费）
        turnover = float(sum(abs(target[c] - pre_trade[c]) for c in codes))

        # 5) 费用
        cost = turnover * cost_bps / 10000.0

        # 6) 净收益与净值（资金守恒恒等）
        net = gross - cost
        equity = equity * (1.0 + net)

        # 7) 新仓 + 现金
        gross_exposure = float(sum(target.values()))
        cash_target = max(0.0, 1.0 - gross_exposure)
        conservation_error = abs(gross_exposure + cash_target - 1.0)

        if strict and conservation_error > 1e-9:
            raise AssertionError(f"资金守恒破坏 @ {t}: Σtarget+cash-1 = {conservation_error}")

        rows.append({
            "trade_date": t,
            "signal_date": sig_date,
            "gross_return": gross,
            "turnover": turnover,
            "cost_bps": cost_bps,
            "cost": cost,
            "net_return": net,
            "equity": equity,
            "cash_weight": cash_target,
            "gross_exposure": gross_exposure,
            "over_allocated": bool(over_allocated),
            "missing_quotes": "|".join(missing) if missing else None,
            "conservation_error": conservation_error,
            # 末日处理：最后一个交易日的信号无下一交易日可成交 → 不执行
            "dropped_signal": bool(t == cal[-1] and t in sig_dates and t not in nextday),
        })

        holdings = {c: target[c] for c in codes}

    return pd.DataFrame(rows)


def ledger_summary(led: pd.DataFrame) -> dict:
    """账本摘要（验收与报告用）：期末净值、守恒误差、换手、末日未执行信号等。"""
    if led is None or led.empty:
        return {"days": 0}
    return {
        "days": int(len(led)),
        "first_date": led["trade_date"].iloc[0],
        "last_date": led["trade_date"].iloc[-1],
        "terminal_nav": float(led["equity"].iloc[-1]),
        "cumulative_return": float(led["equity"].iloc[-1] - 1.0),
        "total_turnover": float(led["turnover"].sum()),
        "avg_turnover": float(led["turnover"].mean()),
        "total_cost": float(led["cost"].sum()),
        "total_gross_return": float(led["gross_return"].sum()),
        "conservation_max_error": float(led["conservation_error"].max()),
        "cash_min": float(led["cash_weight"].min()),
        "gross_exposure_max": float(led["gross_exposure"].max()),
        "over_allocated_days": int(led["over_allocated"].sum()),
        "missing_quote_days": int(led["missing_quotes"].notna().sum()),
        "dropped_signal_days": int(led["dropped_signal"].sum()),
    }


def assert_common_calendar(ledgers: dict) -> dict:
    """公共日历强校验：所有可比账本必须同一首日、同一末日、同一天数（否则抛错）。"""
    if not ledgers:
        raise ValueError("ledgers 为空")
    ref_name, ref = next(iter(ledgers.items()))
    if ref is None or ref.empty:
        raise ValueError(f"账本 {ref_name} 为空")
    ref_tuple = (ref["trade_date"].iloc[0], ref["trade_date"].iloc[-1], len(ref))
    for name, led in ledgers.items():
        if led is None or led.empty:
            raise ValueError(f"账本 {name} 为空，无法比较")
        tup = (led["trade_date"].iloc[0], led["trade_date"].iloc[-1], len(led))
        if tup != ref_tuple:
            raise ValueError(
                f"公共日历不一致：{name}={tup} vs {ref_name}={ref_tuple}（首日/末日/天数必须完全相同）"
            )
    return {"first_date": ref_tuple[0], "last_date": ref_tuple[1], "days": ref_tuple[2],
            "strategies": sorted(ledgers.keys())}
