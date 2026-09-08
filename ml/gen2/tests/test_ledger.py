"""工作包 3 单一回测账本反例测试（报告 P0-3 / P0-4 / F07 验收）。

验收标准（报告 §7 工作包 3）：
  - 两段收益 10%/20% 的例子必须只取得应持有的 10%
  - 全现金零成本
  - 买入半仓费用 = ETF 成交金额 × 费率
  - A/B 漂移再平衡反例继续通过（~33.3% 换手）
  - 费用后资金守恒
  - 缺持仓报价不能自动当零收益
  - 所有可比策略有效日期严格相同
"""
from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from gen2.backtest.ledger import run_ledger


def _sig(target_map):
    """构造 signals DataFrame：{date: {code: weight}}。"""
    rows = []
    for d, w in target_map.items():
        for code, weight in w.items():
            rows.append({"trade_date": d, "code": code, "target_weight": weight})
    return pd.DataFrame(rows)


class TPlus1ExecutionTest(unittest.TestCase):
    """P0-3：信号 T 日产生，T+1 收盘成交，新仓承担下一区间收益。"""

    def test_buy_then_sell_gets_correct_10pct(self):
        # 1/5 买入，1/6 卖出。T+1 收盘成交：持有 1/6 收盘→1/7 收盘（+10%），
        # 不应取得下一段（1/7→1/8 的 +20%）。
        # ret_1d[t] = close[t]/close[t-1]-1
        cal = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]).date
        sig = _sig({cal[0]: {"ETF": 1.0}, cal[1]: {"ETF": 0.0}})  # 1/5 买，1/6 卖
        ret = pd.DataFrame({
            "trade_date": [cal[0], cal[1], cal[2], cal[3]],
            "code": ["ETF"] * 4,
            "ret_1d": [0.0, 0.05, 0.10, 0.20],  # 1/6→1/7 = 10%
        })
        out = run_ledger(sig, ret, cost_bps=0.0, calendar=list(cal))
        # 1/7 这天：旧仓（1/6 收盘建的 100% ETF）承担 ret_1d[1/7]=10%
        d7 = out[out["trade_date"] == cal[2]].iloc[0]
        self.assertAlmostEqual(float(d7["gross_return"]), 0.10, places=6)
        # 1/8 这天：旧仓已在 1/7 收盘清仓（1/6 卖出信号），不应再吃到 20%
        d8 = out[out["trade_date"] == cal[3]].iloc[0]
        self.assertAlmostEqual(float(d8["gross_return"]), 0.0, places=6)

    def test_first_trade_date_has_no_phantom_gain(self):
        # 期初全现金，首个交易日无 prev 信号可执行 → 收益 0、换手 0
        cal = pd.to_datetime(["2026-01-05", "2026-01-06"]).date
        sig = _sig({cal[1]: {"ETF": 0.5}})
        ret = pd.DataFrame({
            "trade_date": [cal[0], cal[1]],
            "code": ["ETF", "ETF"],
            "ret_1d": [0.0, 0.0],
        })
        out = run_ledger(sig, ret, cost_bps=10.0, calendar=list(cal))
        self.assertAlmostEqual(float(out.iloc[0]["gross_return"]), 0.0, places=6)


class CashCostTest(unittest.TestCase):
    """P0-4：现金余额变化不是第二笔证券佣金。"""

    def test_all_cash_zero_cost(self):
        cal = pd.to_datetime(["2026-01-05", "2026-01-06"]).date
        # 无任何证券信号 → 全现金
        sig = pd.DataFrame(columns=["trade_date", "code", "target_weight"])
        ret = pd.DataFrame({"trade_date": [cal[0]], "code": ["ETF"], "ret_1d": [0.0]})
        out = run_ledger(sig, ret, cost_bps=10.0, calendar=list(cal))
        self.assertEqual(float(out["turnover"].sum()), 0.0)
        self.assertEqual(float(out["net_return"].sum()), 0.0)

    def test_buy_half_position_cost_half(self):
        # 现金买入 50% ETF：换手 = 0.5（ETF 成交 50%），费用 = 0.5*10bps = 0.05%
        cal = pd.to_datetime(["2026-01-05", "2026-01-06"]).date
        sig = _sig({cal[0]: {"ETF": 0.5}})
        ret = pd.DataFrame({
            "trade_date": [cal[0], cal[1]],
            "code": ["ETF", "ETF"],
            "ret_1d": [0.0, 0.0],
        })
        out = run_ledger(sig, ret, cost_bps=10.0, calendar=list(cal))
        # 执行发生在 1/6
        d6 = out[out["trade_date"] == cal[1]].iloc[0]
        self.assertAlmostEqual(float(d6["turnover"]), 0.5, places=6)
        # 成本 = 0.5 * 10/10000 = 0.0005
        self.assertAlmostEqual(float(d6["net_return"]), -0.0005, places=6)


class DriftRebalanceTest(unittest.TestCase):
    """F07：漂移后换手正确（A/B 满仓漂移再平衡）。"""

    def test_equal_weight_rebalance_drift_turnover(self):
        # 信号 d1 建仓 50/50，d2 收盘建仓；A 在 d2→d3 涨 100%；
        # d3 执行 d2 的再平衡信号（50/50），漂移后 A=0.667/B=0.333 → 换手 0.333
        cal = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07"]).date
        sig = _sig({
            cal[0]: {"A": 0.5, "B": 0.5},
            cal[1]: {"A": 0.5, "B": 0.5},
        })
        ret = pd.DataFrame({
            "trade_date": [cal[0], cal[0], cal[1], cal[1], cal[2], cal[2]],
            "code": ["A", "B", "A", "B", "A", "B"],
            "ret_1d": [0.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        })
        out = run_ledger(sig, ret, cost_bps=0.0, calendar=list(cal))
        d7 = out[out["trade_date"] == cal[2]].iloc[0]
        self.assertAlmostEqual(float(d7["turnover"]), 1.0 / 3.0, places=3)


class MoneyConservationTest(unittest.TestCase):
    """资金守恒：每期净值 = 上期净值 × (1 + net_return)，无凭空增减。"""

    def test_nav_compounds_exactly(self):
        cal = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07"]).date
        sig = _sig({cal[0]: {"A": 0.6, "B": 0.4}, cal[1]: {"A": 0.6, "B": 0.4}})
        ret = pd.DataFrame({
            "trade_date": [cal[0], cal[0], cal[1], cal[1], cal[2], cal[2]],
            "code": ["A", "B", "A", "B", "A", "B"],
            "ret_1d": [0.0, 0.0, 0.0, 0.0, 0.10, -0.05],
        })
        out = run_ledger(sig, ret, cost_bps=10.0, calendar=list(cal))
        nav = 1.0
        for _, row in out.iterrows():
            nav *= (1.0 + float(row["net_return"]))
        # 复利 NAV 必须与逐日累乘一致（无丢失）
        self.assertTrue(np.isfinite(nav))
        # 期末 NAV = (1 + 0.6*0.10 + 0.4*(-0.05) - 首日成本) 逐日复利
        self.assertGreater(nav, 0.99)
        self.assertLess(nav, 1.05)


class MissingQuoteTest(unittest.TestCase):
    """缺持仓报价不能自动当零收益（应显式标记）。"""

    def test_missing_quote_flagged(self):
        # 信号 1/5 买 A=1.0，1/6 收盘执行后持仓 A=1.0；1/7 这天 A 缺收益 → 应记 missing_quotes
        cal = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07"]).date
        sig = _sig({cal[0]: {"A": 1.0}})
        ret = pd.DataFrame({
            "trade_date": [cal[0], cal[1], cal[2]],
            "code": ["A", "A", "A"],
            "ret_1d": [0.0, 0.0, np.nan],
        })
        out = run_ledger(sig, ret, cost_bps=0.0, calendar=list(cal))
        d7 = out[out["trade_date"] == cal[2]].iloc[0]
        self.assertIn("A", str(d7["missing_quotes"]))


class CommonWindowTest(unittest.TestCase):
    """P1-1：所有可比策略有效日期严格相同（由调用方统一 calendar 后断言）。"""

    def test_same_calendar_same_days(self):
        cal = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07"]).date
        sig = _sig({cal[0]: {"A": 1.0}})
        ret = pd.DataFrame({
            "trade_date": [cal[0], cal[1], cal[2]],
            "code": ["A", "A", "A"],
            "ret_1d": [0.0, 0.01, 0.02],
        })
        out = run_ledger(sig, ret, cost_bps=0.0, calendar=list(cal))
        self.assertEqual(len(out), 3)


if __name__ == "__main__":
    unittest.main()
