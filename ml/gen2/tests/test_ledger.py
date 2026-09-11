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

from gen2.backtest.ledger import assert_common_calendar, ledger_summary, run_ledger


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


class B1AcceptanceTest(unittest.TestCase):
    """WP-G2-02 / B1 验收：统一账本的 T+1、现金费用、资金守恒、超配、末日、公共日历。"""

    def _three_day(self):
        cal = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07"]).date
        return list(cal)

    # ---------- 1. T+1 时序 ----------
    def test_execution_lag_semantics_differ_by_one_day(self):
        """signal-date(lag=1) 比 effective-date(lag=0) 晚一天成交：同输入不得等价。"""
        cal = self._three_day()
        sig = _sig({cal[0]: {"A": 1.0}})
        ret = pd.DataFrame({"trade_date": cal, "code": ["A"] * 3, "ret_1d": [0.0, 0.10, 0.20]})
        lag1 = run_ledger(sig, ret, cost_bps=0.0, calendar=cal, execution_lag=1)
        lag0 = run_ledger(sig, ret, cost_bps=0.0, calendar=cal, execution_lag=0)
        # lag=1：1/5 信号在 1/6 收盘成交 → 1/7 才吃到 0.20
        self.assertAlmostEqual(float(lag1[lag1["trade_date"] == cal[2]].iloc[0]["gross_return"]), 0.20, places=9)
        # lag=0：1/5 收盘即建仓 → 1/6 就吃到 0.10、1/7 吃到 0.20
        self.assertAlmostEqual(float(lag0[lag0["trade_date"] == cal[1]].iloc[0]["gross_return"]), 0.10, places=9)

    def test_earliest_execution_is_second_trading_day(self):
        """期初全现金：signal-date API 下最早成交发生在第二个交易日（首日无 prev 信号）。"""
        cal = self._three_day()
        sig = _sig({cal[0]: {"A": 0.5}})
        ret = pd.DataFrame({"trade_date": cal, "code": ["A"] * 3, "ret_1d": [0.01, 0.01, 0.01]})
        lag1 = run_ledger(sig, ret, cost_bps=0.0, calendar=cal, execution_lag=1)
        self.assertEqual(float(lag1.iloc[0]["turnover"]), 0.0, "首日不应有成交")
        self.assertAlmostEqual(float(lag1.iloc[1]["turnover"]), 0.5, places=9, msg="第二个交易日建仓 50%")

    def test_zero_weight_row_is_liquidation_not_no_signal(self):
        """全零权重的信号行 = 清仓；与该日没有信号行（保持漂移持仓）语义不同。

        时序：清仓信号在 d1 产生 → d2 收盘成交 → d3 起无敞口（不吃 d3 的 +50%）。
        """
        cal = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]).date
        ret = pd.DataFrame({"trade_date": list(cal), "code": ["A"] * 4, "ret_1d": [0.0, 0.0, 0.0, 0.5]})
        liquidate = run_ledger(_sig({cal[0]: {"A": 1.0}, cal[1]: {"A": 0.0}}), ret, cost_bps=0.0,
                               calendar=list(cal), execution_lag=1)
        hold = run_ledger(_sig({cal[0]: {"A": 1.0}}), ret, cost_bps=0.0, calendar=list(cal), execution_lag=1)
        # d2（成交日）换手 1.0 证明确实清仓；无信号的对照为 0
        self.assertAlmostEqual(float(liquidate[liquidate["trade_date"] == cal[2]].iloc[0]["turnover"]), 1.0, places=9)
        self.assertAlmostEqual(float(hold[hold["trade_date"] == cal[2]].iloc[0]["turnover"]), 0.0, places=9)
        # d3：清仓后无敞口（0.0），无信号则继续持有（0.5）
        self.assertAlmostEqual(float(liquidate[liquidate["trade_date"] == cal[3]].iloc[0]["gross_return"]), 0.0, places=9)
        self.assertAlmostEqual(float(hold[hold["trade_date"] == cal[3]].iloc[0]["gross_return"]), 0.5, places=9)

    # ---------- 2. 现金与费用 ----------
    def test_cash_leg_is_not_charged_twice(self):
        """现金↔证券是同一笔成交：100% 现金 → 100% 证券的换手必须是 1.0，不是 2.0。"""
        cal = pd.to_datetime(["2026-01-05", "2026-01-06"]).date
        sig = _sig({cal[0]: {"A": 1.0}})
        ret = pd.DataFrame({"trade_date": cal, "code": ["A", "A"], "ret_1d": [0.0, 0.0]})
        led = run_ledger(sig, ret, cost_bps=10.0, calendar=list(cal), execution_lag=1)
        d2 = led[led["trade_date"] == cal[1]].iloc[0]
        self.assertAlmostEqual(float(d2["turnover"]), 1.0, places=9, msg="单边名义额 = 1.0")
        self.assertAlmostEqual(float(d2["cost"]), 1.0 * 10 / 10000, places=12)
        self.assertAlmostEqual(float(d2["net_return"]), -0.001, places=9)

    def test_legacy_cash_charged_was_double(self):
        """反例量化：废弃口径「现金腿也计费」给出 2 倍换手（历史高估证据）。"""
        from gen2.backtest.costs import apply_turnover_cost, apply_turnover_cost_legacy_cash_charged
        w = pd.DataFrame([
            {"trade_date": "2026-01-05", "code": "A", "target_weight": 1.0},
            {"trade_date": "2026-01-06", "code": "A", "target_weight": 0.0},
        ])
        r = pd.DataFrame([
            {"trade_date": "2026-01-05", "code": "A", "ret_1d": 0.0},
            {"trade_date": "2026-01-06", "code": "A", "ret_1d": 0.0},
        ])
        new = float(apply_turnover_cost(w, r, cost_bps=0.0).iloc[1]["turnover"])
        old = float(apply_turnover_cost_legacy_cash_charged(w, r, cost_bps=0.0).iloc[1]["turnover"])
        self.assertAlmostEqual(new, 1.0, places=9)
        self.assertAlmostEqual(old, 2.0, places=9, msg="旧口径把清仓记成 2.0（现金腿 + 证券腿）")

    def test_costs_wrapper_delegates_to_authoritative_ledger(self):
        """兼容层必须与 run_ledger(execution_lag=0) 逐值一致（单一账本）。"""
        from gen2.backtest.costs import apply_turnover_cost
        cal = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07"]).date
        w = pd.DataFrame([{"trade_date": d, "code": "A", "target_weight": t}
                          for d, t in zip(cal, [0.7, 0.3, 0.5])])
        r = pd.DataFrame({"trade_date": cal, "code": ["A"] * 3, "ret_1d": [0.0, 0.02, -0.01]})
        compat = apply_turnover_cost(w, r, cost_bps=10.0)
        direct = run_ledger(w, r, cost_bps=10.0, calendar=list(cal), execution_lag=0)
        for col in ["gross_return", "turnover", "net_return"]:
            for a, b in zip(compat[col], direct[col]):
                self.assertAlmostEqual(float(a), float(b), places=12, msg=col)

    # ---------- 3. 资金守恒 ----------
    def test_conservation_holds_every_day(self):
        cal = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]).date
        sig = _sig({cal[0]: {"A": 0.6, "B": 0.3}, cal[1]: {"A": 0.2}, cal[2]: {"A": 0.9, "B": 0.4}})
        ret = pd.DataFrame({
            "trade_date": list(cal) * 2, "code": ["A"] * 4 + ["B"] * 4,
            "ret_1d": [0.0, 0.03, -0.02, 0.05, 0.0, -0.01, 0.04, 0.0],
        })
        led = run_ledger(sig, ret, cost_bps=10.0, calendar=list(cal), execution_lag=1, strict=True)
        for _, row in led.iterrows():
            # (a) Σtarget + cash == 1
            self.assertLessEqual(float(row["conservation_error"]), 1e-12)
            # (b) 现金不得为负
            self.assertGreaterEqual(float(row["cash_weight"]), -1e-12)
            # (c) net == gross - cost
            self.assertAlmostEqual(float(row["net_return"]),
                                   float(row["gross_return"]) - float(row["cost"]), places=12)
        # (d) equity == Π(1+net_return)
        expected = float((1.0 + led["net_return"]).prod())
        self.assertAlmostEqual(float(led["equity"].iloc[-1]), expected, places=12)
        # (e) 首日期初净值
        self.assertAlmostEqual(float(led["equity"].iloc[0]), 1.0 + float(led["net_return"].iloc[0]), places=12)

    # ---------- 4. 超配 ----------
    def test_overallocation_scaled_and_flagged(self):
        cal = pd.to_datetime(["2026-01-05", "2026-01-06"]).date
        sig = _sig({cal[0]: {"A": 0.8, "B": 0.8}})  # 合计 1.6
        ret = pd.DataFrame({"trade_date": [cal[0], cal[0], cal[1], cal[1]],
                            "code": ["A", "B", "A", "B"], "ret_1d": [0.0, 0.0, 0.0, 0.0]})
        led = run_ledger(sig, ret, cost_bps=0.0, calendar=list(cal), execution_lag=1)
        d2 = led[led["trade_date"] == cal[1]].iloc[0]
        self.assertTrue(bool(d2["over_allocated"]), "超配必须显式留痕")
        self.assertAlmostEqual(float(d2["gross_exposure"]), 1.0, places=9, msg="缩放到 100%")
        self.assertAlmostEqual(float(d2["cash_weight"]), 0.0, places=9)

    def test_overallocation_reject_policy_raises(self):
        cal = pd.to_datetime(["2026-01-05", "2026-01-06"]).date
        sig = _sig({cal[0]: {"A": 0.9, "B": 0.9}})
        ret = pd.DataFrame({"trade_date": [cal[0], cal[0], cal[1], cal[1]],
                            "code": ["A", "B", "A", "B"], "ret_1d": [0.0, 0.0, 0.0, 0.0]})
        with self.assertRaises(ValueError):
            run_ledger(sig, ret, cost_bps=0.0, calendar=list(cal), execution_lag=1,
                       overallocation_policy="reject")

    # ---------- 5. 末日处理 ----------
    def test_terminal_day_signal_dropped_and_nav_marked_to_market(self):
        cal = self._three_day()
        # 末日给出清仓信号：没有下一个交易日可成交 → 不执行，必须显式标记
        sig = _sig({cal[0]: {"A": 1.0}, cal[2]: {"A": 0.0}})
        ret = pd.DataFrame({"trade_date": cal, "code": ["A"] * 3, "ret_1d": [0.0, 0.0, 0.1]})
        led = run_ledger(sig, ret, cost_bps=0.0, calendar=cal, execution_lag=1)
        last = led.iloc[-1]
        self.assertTrue(bool(last["dropped_signal"]), "末日信号必须标记未执行")
        self.assertAlmostEqual(float(last["turnover"]), 0.0, places=12, msg="末日不得发生成交")
        s = ledger_summary(led)
        self.assertEqual(s["dropped_signal_days"], 1)
        self.assertAlmostEqual(s["terminal_nav"], 1.1, places=9, msg="期末净值 = mark-to-market")
        self.assertAlmostEqual(s["terminal_nav"], float(led["equity"].iloc[-1]), places=12)

    # ---------- 6. 公共日历 ----------
    def test_common_calendar_accepts_identical_and_rejects_mismatch(self):
        cal = self._three_day()
        sig = _sig({cal[0]: {"A": 1.0}})
        ret = pd.DataFrame({"trade_date": cal, "code": ["A"] * 3, "ret_1d": [0.0, 0.0, 0.0]})
        a = run_ledger(sig, ret, cost_bps=0.0, calendar=cal, execution_lag=1)
        b = run_ledger(sig, ret, cost_bps=5.0, calendar=cal, execution_lag=1)
        meta = assert_common_calendar({"a": a, "b": b})
        self.assertEqual(meta["days"], 3)
        # 少一天 → 必须报错
        c = run_ledger(sig, ret, cost_bps=0.0, calendar=cal[:2], execution_lag=1)
        with self.assertRaises(ValueError):
            assert_common_calendar({"a": a, "c": c})

    def test_summary_reports_contract_fields(self):
        cal = self._three_day()
        sig = _sig({cal[0]: {"A": 0.5}})
        ret = pd.DataFrame({"trade_date": cal, "code": ["A"] * 3, "ret_1d": [0.0, 0.01, 0.0]})
        led = run_ledger(sig, ret, cost_bps=10.0, calendar=cal, execution_lag=1)
        s = ledger_summary(led)
        for k in ["days", "terminal_nav", "total_turnover", "total_cost", "conservation_max_error",
                  "cash_min", "gross_exposure_max", "over_allocated_days", "missing_quote_days",
                  "dropped_signal_days"]:
            self.assertIn(k, s)
        self.assertLessEqual(s["conservation_max_error"], 1e-12)
        self.assertGreaterEqual(s["cash_min"], -1e-12)


if __name__ == "__main__":
    unittest.main()
