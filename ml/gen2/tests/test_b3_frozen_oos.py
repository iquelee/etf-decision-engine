"""B3 Frozen OOS 回归（`ml/gen2/baseline/b3_frozen_oos.py`）。

设计原则（沿用本项目纪律）：
  * 夹具**不能自证**：核对类断言必须让「正确的输入通过、错误的输入失败」两侧都跑到；
  * 精度口径用**往返测试**钉住（报告显示精度 ⇄ 数值），避免「看起来一致但比出来不等」；
  * **不依赖本地日线池**：本文件全部用例只用合成数据 + 已入库的 manifest/报告（CI 与本地一致）。
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

from gen2.baseline import b3_frozen_oos as b3
from gen2.baseline.b1_frozen_run import FrozenAttestationError
from gen2.data.loader import GEN2_ROOT
from gen2.evaluation.walk_forward import WalkForwardConfig


def _synthetic_calendar(years=range(2018, 2027), per_year=250) -> list[dt.date]:
    out = []
    for y in years:
        d, n = dt.date(y, 1, 1), 0
        while n < per_year:
            if d.weekday() < 5:
                out.append(d)
                n += 1
            d += dt.timedelta(days=1)
    return out


def _daily(strategy: str, dates: list[str], nets: list[float], *, bps: float = 10.0,
           turnover: list[float] | None = None) -> pd.DataFrame:
    tv = turnover or [0.0] * len(dates)
    return pd.DataFrame({
        "trade_date": dates, "strategy": strategy, "cost_bps": bps,
        "net_return": nets, "turnover": tv,
        "cost": [t * bps / 1e4 for t in tv],
        "conservation_error": [0.0] * len(dates), "cash_weight": [0.1] * len(dates),
        "over_allocated": [False] * len(dates),
    })


class OosWindowTest(unittest.TestCase):
    """OOS 边界必须**由既有 walk-forward 口径推导**，不得自定。"""

    def test_oos_window_is_fold_test_union(self):
        oos = b3.derive_oos_window(_synthetic_calendar())
        wf = WalkForwardConfig()
        self.assertEqual(oos["config"]["train_years"], wf.train_years)
        self.assertEqual([int(f["test_year"]) for f in oos["folds"]], [2021, 2022, 2023, 2024, 2025, 2026])
        self.assertEqual(oos["first_date"][:4], "2021")
        self.assertEqual(oos["days"], 6 * 250)
        self.assertTrue(oos["contiguous_in_calendar"])

    def test_oos_window_reports_both_date_types(self):
        """`dates` 必须是 `date` 对象（供 evaluate_fold 的 isin），`dates_str` 必须是字符串。"""
        oos = b3.derive_oos_window(_synthetic_calendar())
        self.assertIsInstance(oos["dates"][0], dt.date)
        self.assertIsInstance(oos["dates_str"][0], str)
        self.assertEqual(len(oos["dates"]), len(oos["dates_str"]))

    def test_raises_when_history_too_short(self):
        with self.assertRaises(FrozenAttestationError):
            b3.derive_oos_window(_synthetic_calendar(range(2018, 2020)))

    def test_window_is_strict_suffix_of_common_calendar(self):
        """OOS 是评价日历的后段（连续无缺口）—— 这是「只切片、不冷启动」的前提。"""
        oos = b3.derive_oos_window(_synthetic_calendar())
        self.assertEqual(oos["calendar_days_inside"], oos["days"])
        self.assertEqual(oos["evaluation_calendar"]["last_date"], oos["last_date"])


class AcceptedB1ReferenceTest(unittest.TestCase):
    def test_accepted_manifest_is_accepted_and_report_hash_matches(self):
        acc = b3.load_accepted_b1()
        self.assertEqual(acc["run_status"], "ACCEPTED")
        self.assertTrue(acc["lock_sha256"].startswith("d3d40f99"), acc["lock_sha256"])
        self.assertTrue(acc["report_sha256"] and acc["manifest_sha256"])
        self.assertEqual(acc["input_content_digest"][:8], "7b5018e4")

    def test_report_readings_parse_to_5x4_grid(self):
        rows = b3.parse_report_readings((GEN2_ROOT / "reports" / b3.ACCEPTED_B1_REPORT_REL.split("/")[-1])
                                        .read_text(encoding="utf-8"))
        self.assertEqual(len(rows), 20)
        self.assertEqual(sorted({r["strategy"] for r in rows}),
                         ["gen2_v2_defended", "gen2_v2_undefended", "main5_equal_weight",
                          "market_510300", "universe_equal_weight"])
        self.assertEqual(sorted({r["cost_bps"] for r in rows}), [0.0, 5.0, 10.0, 20.0])
        d10 = next(r for r in rows if r["strategy"] == "gen2_v2_defended" and r["cost_bps"] == 10.0)
        self.assertAlmostEqual(d10["cumulative_return_pct"], 61.01, places=6)
        self.assertAlmostEqual(d10["sharpe"], 0.55, places=6)

    def test_parse_ignores_header_and_separator_rows(self):
        rows = b3.parse_report_readings("| 策略 | cost_bps |\n|---|---|\n")
        self.assertEqual(rows, [])

    def test_rejects_non_accepted_manifest(self):
        """run_status 非 ACCEPTED ⇒ 拒绝作为对照锚（fail-closed）。"""
        tmp = Path(tempfile.mkdtemp())
        man = json.loads((GEN2_ROOT / "manifests" / b3.ACCEPTED_B1_MANIFEST_REL.split("/")[-1])
                         .read_text(encoding="utf-8"))
        man["run_status"] = "PENDING_MERGE"
        (tmp / "m.json").write_text(json.dumps(man), encoding="utf-8")
        (tmp / "r.md").write_text("x", encoding="utf-8")
        with mock.patch.object(b3, "ACCEPTED_B1_MANIFEST_REL", str(tmp / "m.json")), \
                mock.patch.object(b3, "ACCEPTED_B1_REPORT_REL", str(tmp / "r.md")):
            with self.assertRaises(FrozenAttestationError):
                b3.load_accepted_b1()

    def test_rejects_report_hash_mismatch(self):
        """报告被改写（与 manifest 声明不符）⇒ 拒绝作对照。"""
        tmp = Path(tempfile.mkdtemp())
        man = json.loads((GEN2_ROOT / "manifests" / b3.ACCEPTED_B1_MANIFEST_REL.split("/")[-1])
                         .read_text(encoding="utf-8"))
        (tmp / "m.json").write_text(json.dumps(man), encoding="utf-8")
        (tmp / "r.md").write_text("tampered", encoding="utf-8")
        with mock.patch.object(b3, "ACCEPTED_B1_MANIFEST_REL", str(tmp / "m.json")), \
                mock.patch.object(b3, "ACCEPTED_B1_REPORT_REL", str(tmp / "r.md")):
            with self.assertRaises(FrozenAttestationError):
                b3.load_accepted_b1()


class ReproductionTest(unittest.TestCase):
    """H5：重算读数 vs 已接受报告表，按**报告显示精度**逐位比对。"""

    def _accepted_rows(self):
        return b3.parse_report_readings(
            (GEN2_ROOT / "reports" / b3.ACCEPTED_B1_REPORT_REL.split("/")[-1]).read_text(encoding="utf-8"))

    def test_detects_mismatched_cell(self):
        rows = self._accepted_rows()
        summary = pd.DataFrame([{
            "strategy": r["strategy"], "cost_bps": r["cost_bps"],
            "terminal_nav": r["terminal_nav"] + 0.0001 if i == 0 else r["terminal_nav"],
            "cumulative_return": r["cumulative_return_pct"] / 100.0,
            "cagr": r["cagr_pct"] / 100.0, "sharpe": r["sharpe"],
            "mdd": r["mdd_pct"] / 100.0, "total_turnover": r["total_turnover"],
            "total_cost": r["total_cost"],
        } for i, r in enumerate(rows)])
        out = b3.verify_reproduction(summary, rows)
        self.assertFalse(out["all_match"])
        self.assertGreaterEqual(out["mismatched_cells"], 1)

    def test_roundtrip_at_display_precision_passes(self):
        """把报告表反解成数值再比 —— 精度口径自洽（否则会「同值比不等」）。"""
        rows = self._accepted_rows()
        summary = pd.DataFrame([{
            "strategy": r["strategy"], "cost_bps": r["cost_bps"],
            "terminal_nav": r["terminal_nav"],
            "cumulative_return": r["cumulative_return_pct"] / 100.0,
            "cagr": r["cagr_pct"] / 100.0, "sharpe": r["sharpe"],
            "mdd": r["mdd_pct"] / 100.0, "total_turnover": r["total_turnover"],
            "total_cost": r["total_cost"],
        } for r in rows])
        out = b3.verify_reproduction(summary, rows)
        self.assertTrue(out["all_match"], msg=json.dumps(out["mismatches"][:2], ensure_ascii=False))
        self.assertEqual(out["compared_cells"], 20 * 7)

    def test_missing_strategy_row_is_a_mismatch(self):
        rows = self._accepted_rows()
        summary = pd.DataFrame([{"strategy": "gen2_v2_defended", "cost_bps": 10.0,
                                 "terminal_nav": 1.6101, "cumulative_return": 0.6101,
                                 "cagr": 0.0791, "sharpe": 0.55, "mdd": -0.2335,
                                 "total_turnover": 140.330, "total_cost": 0.1403}])
        out = b3.verify_reproduction(summary, rows)
        self.assertFalse(out["all_match"])

    def test_empty_accepted_rows_is_not_a_pass(self):
        """空表不得被当成「全对」（防止「0 个单元格 ⇒ all_match」的假绿）。"""
        out = b3.verify_reproduction(pd.DataFrame([{"strategy": "x", "cost_bps": 0.0}]), [])
        self.assertFalse(out["all_match"])


class ToolchainReuseTest(unittest.TestCase):
    def test_shared_ids_with_b1_match_accepted_manifest(self):
        """与 B1 同文件的工具链条目必须逐项哈希一致 ⇒ 复用同一条已取证工具链。"""
        acc = b3.load_accepted_b1()
        impl = [{"id": iid, "role": role, "file": rel, "exists": True, "sha256": b3._sha(rel)}
                for iid, role, rel in b3.B3_RUN_IMPLEMENTATION]
        out = b3.verify_toolchain_reuse(impl, acc)
        self.assertEqual(sorted(r["id"] for r in out["rows"]), sorted(b3.SHARED_WITH_B1))
        self.assertTrue(out["all_match"], msg=json.dumps(out["rows"], ensure_ascii=False))

    def test_tampered_file_breaks_reuse(self):
        acc = b3.load_accepted_b1()
        impl = [{"id": "ledger", "file": "ml/gen2/backtest/ledger.py", "sha256": "0" * 64}]
        out = b3.verify_toolchain_reuse(impl, acc)
        self.assertFalse(out["all_match"])


class SliceAndMetricsTest(unittest.TestCase):
    def test_slice_reports_missing_oos_days(self):
        daily = pd.concat([_daily("gen2_v2_defended", ["2021-01-04", "2021-01-05"], [0.01, 0.01])])
        oos = ["2021-01-04", "2021-01-05", "2021-01-06"]
        sub, meta = b3.slice_oos(daily, oos)
        self.assertFalse(meta["all_oos_days_present"])
        self.assertEqual(meta["oos_days_in_ledger_calendar"], 2)
        self.assertEqual(len(sub), 2)

    def test_oos_econ_rebases_nav_from_one_and_sums_turnover(self):
        daily = _daily("gen2_v2_defended", ["2021-01-04", "2021-01-05"], [0.10, -0.10],
                       turnover=[1.0, 2.0])
        econ = b3.oos_econ(daily, [10.0])
        r = econ.iloc[0]
        self.assertEqual(int(r["days"]), 2)
        self.assertAlmostEqual(r["terminal_nav"], 1.1 * 0.9, places=12)
        self.assertAlmostEqual(r["cumulative_return"], 1.1 * 0.9 - 1.0, places=12)
        self.assertAlmostEqual(r["total_turnover"], 3.0, places=12)

    def test_increment_bootstrap_uses_paired_daily_difference(self):
        a = _daily("gen2_v2_defended", ["2021-01-04", "2021-01-05"], [0.02, 0.02])
        m = _daily("main5_equal_weight", ["2021-01-04", "2021-01-05"], [0.01, 0.01])
        out = b3.increment_bootstrap(pd.concat([a, m]))
        self.assertEqual(out["n"], 2)
        self.assertAlmostEqual(out["mean"], 0.01, places=12)

    def test_yearly_returns_compound_within_year(self):
        daily = _daily("gen2_v2_defended", ["2021-12-30", "2021-12-31", "2022-01-04"],
                       [0.05, 0.05, 0.10])
        daily = pd.concat([daily, _daily("main5_equal_weight", ["2021-12-30", "2021-12-31", "2022-01-04"],
                                         [0.01, 0.01, 0.01])])
        y = b3.yearly_returns(daily, ["gen2_v2_defended", "main5_equal_weight"])
        r2021 = y[y["year"] == "2021"].iloc[0]
        self.assertAlmostEqual(r2021["gen2_v2_defended"], 1.05 * 1.05 - 1.0, places=12)
        self.assertAlmostEqual(r2021["main5_equal_weight"], 1.01 * 1.01 - 1.0, places=12)


class CriteriaTest(unittest.TestCase):
    """协议 §7.2 判据 —— 与结果无关的**规则**测试（两侧都要跑到）。"""

    def _econ(self, *, defended_cum: float, defended_sharpe: float, main5_cum: float = 0.30,
              main5_sharpe: float = 0.70, bps: float = 10.0) -> pd.DataFrame:
        return pd.DataFrame([
            {"strategy": "gen2_v2_defended", "cost_bps": bps, "days": 100,
             "cumulative_return": defended_cum, "sharpe": defended_sharpe},
            {"strategy": "main5_equal_weight", "cost_bps": bps, "days": 100,
             "cumulative_return": main5_cum, "sharpe": main5_sharpe},
        ])

    def _ic(self, rank_ic: float) -> dict:
        return {"aggregate": {"rank_ic": rank_ic, "n_days": 100, "ic_pos": 0.6,
                              "top_bottom_spread": 0.01}}

    def _yearly(self, defended: list[float], main5: list[float]) -> pd.DataFrame:
        return pd.DataFrame({"year": [str(2021 + i) for i in range(len(defended))],
                             "gen2_v2_defended": defended, "main5_equal_weight": main5})

    def test_losing_to_main5_fails_even_with_positive_ic(self):
        """否决规则：IC 为正但成本后输 Main5 ⇒ 一律 FAIL。"""
        out = b3.evaluate_criteria(self._econ(defended_cum=0.20, defended_sharpe=0.60),
                                   self._ic(0.05),
                                   {"ci_low": 0.0001, "ci_high": 0.002, "mean": 0.001, "n": 100},
                                   self._yearly([0.10], [0.12]))
        self.assertEqual(out["verdict"], "FAIL")
        self.assertTrue(out["nok_rule_applied"])

    def test_pass_requires_all_four_criteria(self):
        out = b3.evaluate_criteria(self._econ(defended_cum=0.45, defended_sharpe=0.80),
                                   self._ic(0.05),
                                   {"ci_low": 0.0001, "ci_high": 0.002, "mean": 0.001, "n": 100},
                                   self._yearly([0.30], [0.25]))
        self.assertTrue(all(c["ok"] for c in out["checks"]))
        self.assertEqual(out["verdict"], b3.VERDICT_PASS)
        self.assertFalse(out["nok_rule_applied"])

    def test_c3_fails_when_ci_lower_bound_below_tolerance(self):
        out = b3.evaluate_criteria(self._econ(defended_cum=0.45, defended_sharpe=0.80),
                                   self._ic(0.05),
                                   {"ci_low": -0.001, "ci_high": 0.002, "mean": 0.0005, "n": 100},
                                   self._yearly([0.30], [0.25]))
        c3 = next(c for c in out["checks"] if c["id"] == "C3")
        self.assertFalse(c3["ok"])
        self.assertEqual(out["verdict"], "FAIL")

    def test_c4_flags_disaster_year(self):
        out = b3.evaluate_criteria(self._econ(defended_cum=0.45, defended_sharpe=0.80),
                                   self._ic(0.05),
                                   {"ci_low": 0.0001, "ci_high": 0.002, "mean": 0.001, "n": 100},
                                   self._yearly([0.05, -0.20], [0.10, 0.10]))
        c4 = next(c for c in out["checks"] if c["id"] == "C4")
        self.assertFalse(c4["ok"])
        self.assertAlmostEqual(c4["worst_year_gap"], -0.30, places=12)

    def test_c2_uses_strict_greater_or_equal(self):
        out = b3.evaluate_criteria(self._econ(defended_cum=0.45, defended_sharpe=0.70),
                                   self._ic(0.05),
                                   {"ci_low": 0.0001, "ci_high": 0.002, "mean": 0.001, "n": 100},
                                   self._yearly([0.30], [0.25]))
        c2 = next(c for c in out["checks"] if c["id"] == "C2")
        self.assertTrue(c2["ok"], "Sharpe 相等应判 PASS（判据为 ≥）")

    def test_missing_strategy_raises(self):
        with self.assertRaises(FrozenAttestationError):
            b3.evaluate_criteria(self._econ(defended_cum=0.2, defended_sharpe=0.5).iloc[:1],
                                 self._ic(0.05), {"ci_low": 0.0, "ci_high": 0.0, "mean": 0.0, "n": 1},
                                 self._yearly([0.1], [0.1]))


class CriteriaFrozenTest(unittest.TestCase):
    """判据必须**写在代码里**（结果前定死），且与本协议文件一致。"""

    def test_thresholds_are_pinned_constants(self):
        self.assertEqual(b3.CRITERIA["C3"]["threshold"]["ci_low_min"], -1e-4)
        self.assertEqual(b3.NO_DISASTER_TOLERANCE, -0.15)
        self.assertEqual(b3.PRIMARY_COST_BPS, 10.0)

    def test_protocol_file_exists_and_is_hashed(self):
        p = b3._abs(b3.PROTOCOL_REL)
        self.assertTrue(p.is_file(), "协议文件必须入库（其 SHA 进 manifest）")
        txt = p.read_text(encoding="utf-8")
        for token in ("C1", "C2", "C3", "C4", "否决规则", "1376"):
            self.assertIn(token, txt)

    def test_b3_does_not_touch_b1_toolchain_sources(self):
        """B3 的运行实现不得包含 B1 的入口文件（否则等于改 B1 工具链）。"""
        files = {rel for _, _, rel in b3.B3_RUN_IMPLEMENTATION}
        self.assertNotIn("ml/gen2/baseline/b1_frozen_run.py", files)
        self.assertIn("ml/gen2/baseline/b3_frozen_oos.py", files)

    def test_abort_codes_are_distinct(self):
        codes = {b3.STATUS_PENDING_REVIEW, b3.ABORT_B1_MISMATCH, b3.ABORT_LEDGER,
                 b3.ABORT_WINDOW, b3.ABORT_SOURCE_MUTATED, b3.ABORT_B1_INPUT_CHANGED}
        self.assertEqual(len(codes), 6)


class ReportRenderContractTest(unittest.TestCase):
    """报告渲染的**键名契约**回归。

    背景（真实缺陷，2026-09-15）：`render_report` 曾对 `immutable_set` 条目取 `e['sha256']`
    渲染锁定组件表，而该键**只存在于** `run_implementation` 条目（锁定组件条目用的是
    `actual`/`expected`）。重算与判据全部通过后，**在写报告那一步**抛 `KeyError: 'sha256'`
    ⇒ 整个运行白跑。教训：链路末端（渲染）的取值点也要有契约测试，不能只测重算。
    """

    B1_MANIFEST_REL = "ml/gen2/manifests/GEN2_B1_FROZEN_RUN_MANIFEST_20260914.json"

    def test_immutable_set_entries_expose_actual_not_sha256(self):
        """锁定组件条目的哈希键是 `actual`；`sha256` 是 `run_implementation` 的键。"""
        p = b3._abs(self.B1_MANIFEST_REL)
        if not p.is_file():
            self.skipTest("已接受 B1 manifest 不在本工作区（源码导出包）")
        m = json.loads(p.read_text(encoding="utf-8"))

        for e in m["frozen_input"]["immutable_set"]:
            self.assertIn("actual", e)
            self.assertIn("expected", e)
            self.assertNotIn("sha256", e,
                             "`immutable_set` 无 `sha256` 键 —— 渲染时写 `e['sha256']` 会 KeyError")
        for e in m["run_implementation"]:
            self.assertIn("sha256", e)
        # 两者键集必须不同，否则上面这条「别写错」的断言就没有区分力
        self.assertNotEqual(set(m["frozen_input"]["immutable_set"][0]),
                            set(m["run_implementation"][0]))

    def test_frozen_lock_entries_are_what_render_report_reads(self):
        """契约：`verify_frozen_lock` 产出的条目键集 == 报告渲染实际读取的键。"""
        lock = b3.verify_frozen_lock()
        self.assertTrue(lock["immutable_set"])
        for e in lock["immutable_set"]:
            for k in ("id", "file", "actual"):
                self.assertIn(k, e)
        # 报告 §4 表读的正是这三个键 —— 若实现改名，此处先红
        rendered = "| ├ 组件 `%s` | `%s…` (%s) |" % (
            lock["immutable_set"][0]["id"], lock["immutable_set"][0]["actual"][:16],
            lock["immutable_set"][0]["file"])
        self.assertIn(lock["immutable_set"][0]["actual"][:16], rendered)

    # ---- 冒烟：整份报告能否渲染（真实键名，最小 manifest）----

    def _econ(self) -> pd.DataFrame:
        rows = []
        for strat, cum, sharpe, turn in (
                ("gen2_v2_defended", 0.3753722702946902, 0.428618972910738, 133.4241214776206),
                ("main5_equal_weight", 2.4715009642419603, 0.9854811113915825, 11.52542022303929),
                ("universe_equal_weight", 1.0, 0.5, 20.0),
                ("market_510300", 0.3, 0.4, 5.0)):
            for bps in (0.0, 5.0, 10.0, 20.0):
                cost = turn * bps / 1e4
                rows.append({"strategy": strat, "cost_bps": bps, "days": 1376,
                             "terminal_nav": 1.0 + cum - cost, "cumulative_return": cum - cost,
                             "cagr": 0.06, "sharpe": sharpe, "mdd": -0.23,
                             "total_turnover": turn, "total_cost": cost,
                             "conservation_max_error": 0.0, "cash_min": 0.0,
                             "over_allocated_days": 0})
        return pd.DataFrame(rows)

    def _yearly(self) -> pd.DataFrame:
        return pd.DataFrame({"year": [2021, 2022],
                             "gen2_v2_defended": [0.0231, -0.19],
                             "main5_equal_weight": [0.0686, 0.10],
                             "universe_equal_weight": [0.157, 0.05],
                             "market_510300": [-0.0432, 0.02]})

    def _manifest(self) -> dict:
        imm_actual = "a" * 64
        imm_expected = "b" * 64          # 故意与 actual 不同：用错键会被断言抓到
        return {
            "run_id": "b3_frozen_oos_20260915_frozen_v201",
            "run_status": b3.STATUS_PENDING_REVIEW,
            "frozen_input": {
                "lock": {"bundle_version": "gen2-rule-v2.0.1", "lock_revision": 3,
                         "bundle_sha256": "f" * 64, "lock_sha256": "d" * 64,
                         "root_anchor_in_sync": True},
                "lock_component_digest": "8" * 64,
                "immutable_set": [
                    {"id": "bundle", "role": "rules", "file": "ml/gen2/manifests/x.json",
                     "expected": imm_expected, "actual": imm_actual, "match": True},
                ],
            },
            "input_data": {"content_digest": "7" * 64, "rows_total": 38083,
                           "codes": [513310, 515880], "date_range": {
                               "first_date": "2011-12-09", "last_date": "2026-09-04"}},
            "environment": {"python": "3.13.14", "pandas": "3.0.5", "numpy": "2.5.3"},
            "hard_gates": [
                {"id": "H1", "name": "锁", "ok": True, "detail": {"lock_revision": 3}},
                {"id": "H2", "name": "漂移", "ok": True, "detail": {"rules_checked": 17}},
                {"id": "H5b", "name": "工具链", "ok": True,
                 "detail": {"shared_ids": ["baseline_builder"],
                            "rows": [{"id": "baseline_builder", "file": "x.py",
                                      "b3_sha256": "c" * 64, "b1_sha256": "c" * 64,
                                      "match": True}], "all_match": True}},
            ],
            "accepted_b1_reference": {"run_id": "b1_ledger_baseline_20260914_frozen_v201",
                                      "run_status": "ACCEPTED", "manifest_sha256": "1" * 64,
                                      "report_sha256": "2" * 64,
                                      "lock_component_digest": "8" * 64},
            "b1_reproduction": {"all_match": True, "compared_cells": 140,
                                "mismatched_cells": 0},
            "oos_gate": {"pass": True, "conservation_max_error": 0.0, "cash_min": 0.0,
                         "over_allocated_days_total": 0},
            "source_mutation_check": {"mutated": False, "head_now": "97f2d136a67f"},
            "oos_window": {"source": "WalkForwardConfig(train_years=3, …)",
                           "definition": "各 fold 的 test 段并集",
                           "first_date": "2021-01-04", "last_date": "2026-09-04",
                           "days": 1376, "contiguous_in_calendar": True,
                           "folds": [{"fold": 0, "test_year": 2021, "test_start": "2021-01-04",
                                      "test_end": "2021-12-31", "n_test": 243,
                                      "train_end": "2020-12-31"}]},
            "oos_slice": {"ledger_calendar": {"first_date": "2020-03-10",
                                              "last_date": "2026-09-04", "days": 1577},
                          "all_oos_days_present": True},
            "oos_ic": {"score_col": "alpha_score_v2", "label_col": "y_rank_vs_market_20d",
                       "aggregate": {"fold": 0, "test_year": "OOS_ALL", "n_days": 1376,
                                     "rank_ic": 0.0271, "ic_pos": 0.5288,
                                     "top_bottom_spread": 0.0061},
                       "per_fold": []},
            "increment_bootstrap": {"strategy": "gen2_v2_defended",
                                    "reference": "main5_equal_weight", "cost_bps": 10.0,
                                    "n": 1376, "mean": -0.000758, "ci_low": -0.001477,
                                    "ci_high": -0.000148},
            "criteria": {
                "cost_bps": 10.0,
                "rank_ic_oos": 0.0271, "nok_rule_applied": True,
                "verdict": b3.VERDICT_FAIL,
                "verdict_note": "未满足全部判据 ⇒ FAIL",
                "checks": [
                    {"id": "C1", "name": "n1", "ok": False, "defended": 0.3753722702946902,
                     "main5": 2.4715009642419603, "delta": -2.09612869394727},
                    {"id": "C2", "name": "n2", "ok": False, "defended": 0.428618972910738,
                     "main5": 0.9854811113915825, "delta": -0.5568621384808444},
                    {"id": "C3", "name": "n3", "ok": False, "ci_low": -0.0014772235,
                     "ci_high": -0.0001478, "mean": -0.0007582, "threshold": -1e-4},
                    {"id": "C4", "name": "n4", "ok": False, "worst_year_gap": -0.492989457,
                     "threshold": -0.15},
                ],
            },
            # 渲染发生在本字段之后、`self_check` 与 `outputs` 之前（三阶段写出）
            "self_check_pre_report": {"checks": 52, "passed": 52, "failed": 0,
                                      "all_pass": True, "detail": []},
            "artifacts": [{"file": "ledger_daily.csv", "exists": True,
                           "sha256": "e" * 64, "bytes": 4951772}],
        }

    def test_render_report_does_not_raise(self):
        m = self._manifest()
        text = b3.render_report(m, self._econ(), self._yearly())
        self.assertIn("Gen-2 B3 Frozen OOS 报告", text)
        # 硬门表 6 行（H1–H5b）+ 报告另行渲染的 H5c / H6 / H7
        for gid in ("H1", "H2", "H5b", "H5c", "H6", "H7"):
            self.assertIn(gid, text)
        self.assertIn(b3.VERDICT_FAIL, text)

    def test_render_report_uses_actual_sha_for_immutable_components(self):
        """必须是 `actual`；若改回 `sha256` → KeyError，改成 `expected` → 断言失败。"""
        m = self._manifest()
        text = b3.render_report(m, self._econ(), self._yearly())
        actual_prefix = m["frozen_input"]["immutable_set"][0]["actual"][:16]
        expected_prefix = m["frozen_input"]["immutable_set"][0]["expected"][:16]
        self.assertIn(actual_prefix, text)
        self.assertNotIn(expected_prefix, text)

    def test_render_report_requires_h5b_detail_rows(self):
        m = self._manifest()
        del m["hard_gates"][-1]["detail"]["rows"]
        with self.assertRaises(KeyError):
            b3.render_report(m, self._econ(), self._yearly())

    def test_render_report_does_not_require_stage3_fields(self):
        """渲染发生在阶段 2 末（写报告），此时 `self_check` / `outputs` **尚未写入**。

        真实缺陷（2026-09-15）：报告 §13 曾读 `m['self_check']['passed']` —— 该字段是阶段 3
        才写入的 ⇒ 修完 `immutable_set` 键名后仍会在**第二次**运行再崩一次。夹具刻意不含
        `self_check` / `outputs`，以此把「渲染只依赖阶段 1–2 字段」钉成契约。
        """
        m = self._manifest()
        self.assertNotIn("self_check", m)
        self.assertNotIn("outputs", m)
        text = b3.render_report(m, self._econ(), self._yearly())
        self.assertIn("自校验（报告写出前执行", text)
        self.assertIn("拒绝产出交付物", text)

    def test_render_report_includes_own_hash_row_when_outputs_present(self):
        """阶段 3 重写 manifest 后若再次渲染，应能带上报告自身哈希行（分支可用）。"""
        m = self._manifest()
        m["outputs"] = {"committed_report": {"file": "ml/gen2/reports/gen2_b3_frozen_oos_x.md",
                                             "exists": True, "sha256": "9" * 64,
                                             "bytes": 12345}}
        text = b3.render_report(m, self._econ(), self._yearly())
        self.assertIn("9" * 64, text)
        self.assertIn("（本报告）", text)

    def test_render_report_reports_pending_review_never_accepted(self):
        """B3 是本地产出：报告不得自称已接受 / 已通过。"""
        m = self._manifest()
        text = b3.render_report(m, self._econ(), self._yearly())
        self.assertIn(b3.STATUS_PENDING_REVIEW, text)
        self.assertIn("维持 Shadow / CANARY", text)


if __name__ == "__main__":
    unittest.main()
