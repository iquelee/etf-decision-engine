"""WP-G2-05 / F1 + F2 验收测试（+ WP-G2-05R 规则 bundle 闸门）。

F1：Alpha 必须显式注入 `build_v2_roles`（不得内部静默重算 / 覆盖 / fallback）
F2：角色阈值必须来自显式 `role_thresholds`（旧 `top_quantile` 退出运行路径）
WP-G2-05R：规则 bundle 缺显式 role_thresholds → run 状态 blocked / RULE_BUNDLE_INCOMPLETE
        （与 JS main() 同序同判；规则闸门抢在数据闸门之前）

用合成面板（不依赖本地日线池），CI 可跑。
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ml"))

from gen2.data.run_gate import evaluate_rule_bundle_gate, evaluate_run_gate  # noqa: E402
from gen2.baseline.rule_v2_ab import build_v2_roles  # noqa: E402
from gen2.baseline.selection_scores import (  # noqa: E402
    CANONICAL_SCORE_SOURCE,
    SELECTION_SCORE_COL,
    SelectionScores,
    SelectionScoresError,
    build_selection_scores,
    canonical_selection_scores,
    validate_selection_scores,
)
from gen2.data.loader import load_gen2_config, load_universe_records  # noqa: E402
from gen2.portfolio.role_thresholds import (  # noqa: E402
    DEFAULT_ROLE_THRESHOLDS,
    RoleThresholdError,
    load_role_thresholds,
    validate_role_thresholds,
)

# 8 只真实标的，各自不同 cluster（避免 cluster cap 干扰阈值对比），均非 incumbent / 非 hedge
CODES = ["159770", "159995", "159992", "510880", "159915", "512690", "512800", "159941"]
DAYS = [f"2026-03-{d:02d}" for d in range(2, 12)]  # 10 个交易日


def _panel(days=None, codes=None) -> pd.DataFrame:
    """确定性合成面板：breakout_distance 随 code 递增，其余组件可预测。

    market_score = 60（RISK_ON，允许晋升）；px_ma60 > 0（过 NO_CORE 趋势闸门）。
    """
    days = days or DAYS
    codes = codes or CODES
    records = load_universe_records()
    rows = []
    for d in days:
        for i, code in enumerate(codes):
            k = i + 1
            rows.append({
                "trade_date": d,
                "code": code,
                "name": records[code].name if code in records else code,
                "correlation_cluster": records[code].correlation_cluster if code in records else "other",
                "eligibility": "ELIGIBLE",
                "px_ma20": 0.02 + 0.001 * k,
                "px_ma60": 0.03 + 0.001 * k,
                "ma20_slope_5d": 0.001 * k,
                "ma60_slope_10d": 0.0005 * k,
                "rs20_vs_benchmark": 0.01 * k,
                "rs60_vs_benchmark": 0.008 * k,
                "rs_accel_5d": 0.002 * k,
                "sideway_days": k,
                "sideway_range": 0.05 * k,
                "volume_ratio_5_20": 1.0 + 0.05 * k,
                "momentum_accel_5_20": 0.01 * k,
                "breakout_distance": 0.02 * k,
                "atr20_pct": 0.01 * k,
                "realized_vol20": 0.2 + 0.01 * k,
                "max_drawdown_20d": -0.05 * k,
                "corr_to_portfolio_60d": 0.5,
                "avg_amount_20d": 1e8 + k,
                "corr_to_cluster_60d": 0.2,
                "ret_1d": 0.001,
                "market_score": 60.0,
            })
    return pd.DataFrame(rows)


def _rankings(panel: pd.DataFrame) -> pd.DataFrame:
    """角色状态机输入面板（模拟 run_rank_engine 的键与展示列）。"""
    rk = panel[["trade_date", "code", "name", "correlation_cluster"]].copy()
    rk["rank"] = rk.groupby("trade_date").cumcount() + 1
    rk["rank_percentile"] = 1.0 - (rk["rank"] - 1) / rk.groupby("trade_date")["code"].transform("size")
    rk["leadership_score"] = 50.0
    return rk


def _config(**portfolio_overrides):
    cfg = load_gen2_config()
    cfg = dict(cfg)
    cfg["portfolio"] = {**cfg["portfolio"], **portfolio_overrides}
    return cfg


class CanonicalScoresTest(unittest.TestCase):
    """canonical Alpha 必须与历史实现逐位一致（否则整个 B1 会被悄悄改动）。"""

    def test_canonical_matches_legacy_compute_alpha_score_v2(self):
        from gen2.baseline.alpha_score import compute_alpha_score_v2

        panel = _panel()
        legacy = compute_alpha_score_v2(panel)[["trade_date", "code", "alpha_score_v2"]]
        scores = canonical_selection_scores(panel)
        merged = legacy.merge(scores.frame, on=["trade_date", "code"], how="inner")
        self.assertGreater(len(merged), 0)
        diff = (merged["alpha_score_v2"] - merged[SELECTION_SCORE_COL]).abs().max()
        self.assertEqual(float(diff), 0.0, "canonical 评分必须与 compute_alpha_score_v2 逐位一致")

    def test_canonical_metadata(self):
        scores = canonical_selection_scores(_panel())
        meta = scores.metadata()
        self.assertEqual(meta["score_source"], CANONICAL_SCORE_SOURCE)
        self.assertEqual(meta["score_coverage"], len(CODES) * len(DAYS))
        self.assertEqual(len(meta["score_hash"]), 64, "必须记录内容哈希")
        self.assertTrue(meta["score_version"])

    def test_weights_must_be_known_and_non_negative(self):
        panel = _panel()
        with self.assertRaises(SelectionScoresError):
            build_selection_scores(panel, {"nope": 1.0}, score_version="v", score_source="t")
        with self.assertRaises(SelectionScoresError):
            build_selection_scores(panel, {"trend": -1.0}, score_version="v", score_source="t")
        with self.assertRaises(SelectionScoresError):
            build_selection_scores(panel, {"trend": 0.0}, score_version="v", score_source="t")


class ValidationTest(unittest.TestCase):
    """评分必须完整覆盖可排名集合：缺、多、重复、非有限 → 一律失败（不 fallback）。"""

    def setUp(self):
        self.panel = _panel()
        self.rankings = _rankings(self.panel)
        self.scores = canonical_selection_scores(self.panel)

    def test_happy_path(self):
        meta = validate_selection_scores(self.scores, self.rankings)
        self.assertEqual(meta["score_coverage"], len(self.rankings))

    def _mutate(self, fn) -> SelectionScores:
        frame = self.scores.frame.copy()
        frame = fn(frame)
        return SelectionScores(frame=frame, score_version="t", score_source="t",
                               content_hash="x", weights=self.scores.weights)

    def test_missing_coverage_fails(self):
        bad = self._mutate(lambda f: f.iloc[:-1])
        with self.assertRaises(SelectionScoresError) as ctx:
            validate_selection_scores(bad, self.rankings)
        self.assertIn("未覆盖", str(ctx.exception))

    def test_extra_key_fails(self):
        extra = pd.DataFrame([{"trade_date": DAYS[0], "code": "999999", SELECTION_SCORE_COL: 1.0}])
        bad = self._mutate(lambda f: pd.concat([f, extra], ignore_index=True))
        with self.assertRaises(SelectionScoresError) as ctx:
            validate_selection_scores(bad, self.rankings)
        self.assertIn("不属于可排名集合", str(ctx.exception))

    def test_duplicate_key_fails(self):
        bad = self._mutate(lambda f: pd.concat([f, f.iloc[[0]]], ignore_index=True))
        with self.assertRaises(SelectionScoresError) as ctx:
            validate_selection_scores(bad, self.rankings)
        self.assertIn("重复键", str(ctx.exception))

    def test_non_finite_fails(self):
        bad = self._mutate(lambda f: f.assign(**{SELECTION_SCORE_COL: np.nan}))
        with self.assertRaises(SelectionScoresError):
            validate_selection_scores(bad, self.rankings)

    def test_none_is_rejected(self):
        with self.assertRaises(SelectionScoresError):
            validate_selection_scores(None, self.rankings)

    def test_build_rejects_uncovered_eligible_rows(self):
        """面板有组件缺失导致非有限评分时，构造阶段就要报错。"""
        panel = _panel()
        panel.loc[panel["code"] == CODES[0], "breakout_distance"] = np.nan
        with self.assertRaises(SelectionScoresError):
            # 等权三因子：breakout 缺失 → 该行非有限
            build_selection_scores(panel, {"breakout": 1.0}, score_version="v", score_source="t")


class InjectionTest(unittest.TestCase):
    """F1：`build_v2_roles` 必须使用注入的评分，绝不重算或覆盖。"""

    def setUp(self):
        self.panel = _panel()
        self.rankings = _rankings(self.panel)
        self.cfg = _config()

    def test_selection_scores_is_required(self):
        with self.assertRaises(TypeError):
            build_v2_roles(self.panel, self.rankings, self.cfg)  # 缺少显式评分

    def test_injected_score_is_used_verbatim(self):
        """把评分改成「按 code 逆序」的显式值：角色输出的 alpha_score_v2 / alpha_rank 必须照此排列。"""
        frame = pd.DataFrame({
            "trade_date": self.panel["trade_date"],
            "code": self.panel["code"],
            SELECTION_SCORE_COL: self.panel["code"].map(
                {c: float(len(CODES) - i) for i, c in enumerate(CODES)}),  # 与 canonical 相反的顺序
        })
        injected = SelectionScores(frame=frame, score_version="t-reversed", score_source="TEST_REVERSED",
                                   content_hash="x", weights={"trend": 1.0})
        roles = build_v2_roles(self.panel, self.rankings, self.cfg, selection_scores=injected)

        canon = canonical_selection_scores(self.panel)
        canon_roles = build_v2_roles(self.panel, self.rankings, self.cfg, selection_scores=canon)

        # 1) 注入值原样出现在输出里（没有被重算覆盖）
        got = roles.set_index(["trade_date", "code"])["alpha_score_v2"]
        want = frame.set_index(["trade_date", "code"])[SELECTION_SCORE_COL]
        pd.testing.assert_series_equal(got.sort_index(), want.sort_index(), check_names=False)

        # 2) 排名完全跟随注入评分：注入评分按 code 升序递增 → 同日 rank 必须恰好是 8,7,...,1
        d0 = DAYS[-1]
        inj_order = (roles[roles["trade_date"] == d0]
                     .sort_values("alpha_rank")["code"].tolist())
        self.assertEqual(inj_order, list(CODES),
                         "角色排名必须完全由注入评分决定（证明没有被内部重算覆盖）")
        can_order = (canon_roles[canon_roles["trade_date"] == d0]
                     .sort_values("alpha_rank")["code"].tolist())
        self.assertNotEqual(inj_order, can_order, "注入评分与 canonical 的顺序必须不同（否则测试无区分度）")

    def test_alternative_alpha_changes_roles(self):
        """替代 Alpha 必须改变角色结果（F1 的核心诉求：不能只改 IC 不改组合）。"""
        canon = canonical_selection_scores(self.panel)
        # 替代 Alpha = canonical 取负号（同一天内顺序完全翻转，仍覆盖全部键且有限）
        flipped = canon.frame.assign(**{SELECTION_SCORE_COL: -canon.frame[SELECTION_SCORE_COL]})
        alt = SelectionScores(frame=flipped, score_version="scenario-flip",
                              score_source="SCENARIO_ALPHA", content_hash="x", weights=canon.weights)
        r_canon = build_v2_roles(self.panel, self.rankings, self.cfg, selection_scores=canon)
        r_alt = build_v2_roles(self.panel, self.rankings, self.cfg, selection_scores=alt)
        self.assertNotEqual(r_canon["alpha_score_v2"].round(6).tolist(),
                            r_alt["alpha_score_v2"].round(6).tolist())

        last = DAYS[-1]
        core_canon = set(r_canon[(r_canon["trade_date"] == last) & (r_canon["role"] == "CORE")]["code"])
        core_alt = set(r_alt[(r_alt["trade_date"] == last) & (r_alt["role"] == "CORE")]["code"])
        self.assertTrue(core_canon, "canonical 下应产生 CORE（否则测试面板无效）")
        self.assertNotEqual(core_canon, core_alt,
                            "替代 Alpha 必须改变 CORE 成员（否则组合层面仍不生效 = F1 未修复）")

    def test_alternative_alpha_via_weights_is_accepted(self):
        """按组件权重构造替代 Alpha 也必须可用（敏感性场景的正式入口）。"""
        alt = build_selection_scores(self.panel, {"breakout": 0.6, "trend": 0.2, "rs": 0.2},
                                     score_version="scenario-breakout",
                                     score_source="SCENARIO_ALPHA")
        meta = validate_selection_scores(alt, self.rankings, context="test")
        self.assertEqual(meta["score_source"], "SCENARIO_ALPHA")
        self.assertEqual(meta["score_weights"], {"breakout": 0.6, "trend": 0.2, "rs": 0.2})
        r = build_v2_roles(self.panel, self.rankings, self.cfg, selection_scores=alt)
        self.assertGreater(len(r), 0)


class RoleThresholdsTest(unittest.TestCase):
    """F2：角色阈值显式化，且默认值与历史行为完全一致。"""

    def test_defaults_are_behaviour_preserving(self):
        t = validate_role_thresholds(DEFAULT_ROLE_THRESHOLDS)
        self.assertEqual(t.core_pct, 0.80)
        self.assertEqual(t.challenger_pct, 0.70)
        self.assertEqual(t.satellite_pct, 0.60)

    def test_order_validation(self):
        with self.assertRaises(RoleThresholdError):
            validate_role_thresholds({"core_top_fraction": 0.5, "challenger_top_fraction": 0.3,
                                      "satellite_top_fraction": 0.4})
        with self.assertRaises(RoleThresholdError):
            validate_role_thresholds({"core_top_fraction": 0.0, "challenger_top_fraction": 0.3,
                                      "satellite_top_fraction": 0.4})
        with self.assertRaises(RoleThresholdError):
            validate_role_thresholds({"core_top_fraction": 0.2, "challenger_top_fraction": 0.3,
                                      "satellite_top_fraction": 1.0})
        # 相等合法（challenger 区间可退化为空）
        t = validate_role_thresholds({"core_top_fraction": 0.3, "challenger_top_fraction": 0.3,
                                      "satellite_top_fraction": 0.4})
        self.assertEqual(t.challenger_pct, t.core_pct)

    def test_unknown_and_missing_fields_fail(self):
        with self.assertRaises(RoleThresholdError) as ctx:
            validate_role_thresholds({**DEFAULT_ROLE_THRESHOLDS, "top_quantile": 0.2})
        self.assertIn("未知字段", str(ctx.exception))
        with self.assertRaises(RoleThresholdError):
            validate_role_thresholds({"core_top_fraction": 0.2})

    def test_legacy_top_quantile_is_not_read(self):
        """只有旧字段的配置必须报错（旧字段退出运行路径，不做隐式迁移）。"""
        with self.assertRaises(RoleThresholdError) as ctx:
            load_role_thresholds({"portfolio": {"top_quantile": 0.3}})
        self.assertIn("role_thresholds", str(ctx.exception))

    def test_committed_config_declares_explicit_thresholds(self):
        t = load_role_thresholds(load_gen2_config())
        self.assertEqual(t.core_top_fraction, DEFAULT_ROLE_THRESHOLDS["core_top_fraction"])
        self.assertEqual(t.source, "CONFIG_ROLE_THRESHOLDS")

    def test_threshold_change_actually_changes_roles(self):
        """F2：core_top_fraction 必须真正影响 CORE 数量（旧 top_quantile 完全不生效）。"""
        panel = _panel()
        rk = _rankings(panel)
        scores = canonical_selection_scores(panel)
        base = build_v2_roles(panel, rk, _config(), selection_scores=scores)
        wide = build_v2_roles(panel, rk, _config(role_thresholds={
            "core_top_fraction": 0.40, "challenger_top_fraction": 0.40, "satellite_top_fraction": 0.40,
        }), selection_scores=scores)
        base_last = int(((base["trade_date"] == DAYS[-1]) & (base["role"] == "CORE")).sum())
        wide_last = int(((wide["trade_date"] == DAYS[-1]) & (wide["role"] == "CORE")).sum())
        self.assertGreater(wide_last, base_last,
                           "扩大 core_top_fraction 必须增加 CORE 数量（否则阈值仍未被读取）")

    def test_config_without_role_thresholds_fails_loudly(self):
        cfg = load_gen2_config()
        cfg = {"portfolio": {k: v for k, v in cfg["portfolio"].items() if k != "role_thresholds"}}
        panel = _panel()
        with self.assertRaises(RoleThresholdError):
            build_v2_roles(panel, _rankings(panel), cfg,
                           selection_scores=canonical_selection_scores(panel))


class _TrapBars(dict):
    """数据源陷阱：**任何**读取访问都直接抛错。

    Python 侧等价于 JS 测试里「注入一个在任何读操作（query/find/get…）时直接抛错的 DB 客户端」。
    用来证明闸门顺序 —— 不是「结果上 blocked」而已，而是「压根没碰数据源」。
    """

    class AccessError(RuntimeError):
        """数据源被读取时抛出（说明闸门顺序错了）。"""

    def _boom(self, op):
        raise _TrapBars.AccessError(
            "DATA_SOURCE_TRAP: 规则 bundle 闸门之前访问了数据源 :: " + op)

    def __getitem__(self, k):
        self._boom("__getitem__(" + str(k) + ")")

    def __contains__(self, k):
        self._boom("__contains__")

    def __iter__(self):
        self._boom("__iter__")

    def __len__(self):
        self._boom("__len__")

    def get(self, *a, **kw):
        self._boom("get")

    def keys(self):
        self._boom("keys")

    def values(self):
        self._boom("values")

    def items(self):
        self._boom("items")


class RuleBundleGateTest(unittest.TestCase):
    """WP-G2-05R：规则 bundle 闸门（Python 侧 blocked 回归，与 JS main() 同序同判）。"""

    @staticmethod
    def _base_selection() -> dict:
        """冻结 manifest 的 selection 段 —— 与 JS 侧 G2S-09 吃的是同一份输入。"""
        manifest = json.loads(
            (ROOT / "ml" / "gen2" / "manifests" / "GEN2_RULE_V2_BUNDLE.json").read_text(encoding="utf-8"))
        return dict(manifest["selection"])

    def _cfg(self, **overrides) -> dict:
        selection = self._base_selection()
        selection.update(overrides)
        return {"selection": selection}

    def _cfg_missing(self, **overrides) -> dict:
        """显式构造「缺 role_thresholds」的输入。

        WP-G2-04 冻结之后，bundle 的 ``selection`` 段**已含** ``role_thresholds``
        （这正是 WP-G2-04 的目的：解除 ``blocked/RULE_BUNDLE_INCOMPLETE``）。因此
        「缺显式阈值」这一类回归必须**显式剥掉该键**，而不能依赖「bundle 恰好还没迁移」——
        否则冻结一落地，这些回归就会变成假绿/假红。
        """
        selection = self._base_selection()
        selection.pop("role_thresholds", None)
        selection.update(overrides)
        return {"selection": selection}

    def test_missing_role_thresholds_blocks(self):
        rb = evaluate_rule_bundle_gate(self._cfg_missing())
        self.assertEqual(rb["status"], "blocked")
        self.assertEqual(rb["status_reason"], "RULE_BUNDLE_INCOMPLETE")
        self.assertEqual(rb["data_gate"], "RULE_BUNDLE_ROLE_THRESHOLDS_MISSING")
        self.assertEqual(rb["rule_bundle_status"], "INCOMPLETE")

    def test_legacy_fields_do_not_satisfy_gate(self):
        """只有旧字段同样是 MISSING —— 运行路径绝不从旧字段派生阈值。"""
        rb = evaluate_rule_bundle_gate(
            self._cfg_missing(top_quantile=0.3, challenger_pct=0.7, satellite_pct=0.6))
        self.assertEqual(rb["status"], "blocked")
        self.assertEqual(rb["data_gate"], "RULE_BUNDLE_ROLE_THRESHOLDS_MISSING")

    def test_invalid_role_thresholds_blocks(self):
        rb = evaluate_rule_bundle_gate(self._cfg(role_thresholds={
            "core_top_fraction": 0.5, "challenger_top_fraction": 0.3, "satellite_top_fraction": 0.4}))
        self.assertEqual(rb["status"], "blocked")
        self.assertEqual(rb["status_reason"], "RULE_BUNDLE_INCOMPLETE")
        self.assertEqual(rb["data_gate"], "RULE_BUNDLE_ROLE_THRESHOLDS_INVALID")

    def test_complete_role_thresholds_pass(self):
        rb = evaluate_rule_bundle_gate(self._cfg(role_thresholds=dict(DEFAULT_ROLE_THRESHOLDS)))
        self.assertEqual(rb["status"], "completed")
        self.assertIsNone(rb["status_reason"])
        self.assertIsNone(rb["data_gate"])
        self.assertEqual(rb["rule_bundle_status"], "COMPLETE")
        self.assertEqual(rb["role_thresholds"]["core_top_fraction"], 0.20)

    def test_rule_gate_preempts_data_gate(self):
        """顺序证据：空数据 + 缺 role_thresholds → RULE_BUNDLE_*（而不是 BENCHMARK_MISSING）。"""
        bad = evaluate_run_gate({}, eligible_codes=["513310"], rule_bundle_config=self._cfg_missing())
        self.assertEqual(bad["status"], "blocked")
        self.assertEqual(bad["status_reason"], "RULE_BUNDLE_INCOMPLETE")
        self.assertEqual(bad["data_gate"], "RULE_BUNDLE_ROLE_THRESHOLDS_MISSING")
        # 正对照：同一空数据 + 完整 role_thresholds → 规则闸门放行，由数据闸门接手
        ok = evaluate_run_gate(
            {}, eligible_codes=["513310"],
            rule_bundle_config=self._cfg(role_thresholds=dict(DEFAULT_ROLE_THRESHOLDS)))
        self.assertEqual(ok["status_reason"], "DATA_OR_ELIGIBILITY_GATE")
        self.assertEqual(ok["data_gate"], "BENCHMARK_MISSING")

    def test_fixture_running_config_matches_yaml(self):
        """夹具声明的运行配置必须与 gen2.yaml 一致（两端不能悄悄漂移）。"""
        fixture = json.loads(
            (ROOT / "fixtures" / "gen2" / "golden_scenarios_v1.json").read_text(encoding="utf-8"))
        sc = next(s for s in fixture["scenarios"] if s["id"] == "G2S-08")
        declared = sc["input"]["panel"]["role_thresholds_running_config"]
        yaml_t = load_role_thresholds(load_gen2_config())
        for key in ("core_top_fraction", "challenger_top_fraction", "satellite_top_fraction"):
            self.assertAlmostEqual(declared[key], getattr(yaml_t, key), places=12,
                                   msg="%s 在夹具与 gen2.yaml 之间漂移" % key)

    def test_rule_gate_precedes_every_data_access(self):
        """顺序证明（裁决追加验证）：规则 bundle 闸门必须**先于任何数据访问**执行。

        Python 侧等价于「注入一个在任何读操作时直接抛错的数据源」：闸门若真的在最前，
        这次调用根本不会碰数据源；反之（闸门只是「结果上优先」而实际先读了数据）会抛 AccessError。
        """
        # 主控：缺 role_thresholds + 数据源「一读就抛错」 → 仍必须干净返回 blocked
        blocked = evaluate_run_gate(
            _TrapBars(), eligible_codes=["513310"],
            rule_bundle_config=self._cfg_missing())
        self.assertEqual(blocked["status"], "blocked")
        self.assertEqual(blocked["status_reason"], "RULE_BUNDLE_INCOMPLETE")
        self.assertEqual(blocked["data_gate"], "RULE_BUNDLE_ROLE_THRESHOLDS_MISSING")

        # 正控：同一陷阱 + 完整 role_thresholds → 闸门放行后**必然**触发数据访问并抛错。
        # 没有这条，「上面没抛错」可能只是陷阱没接线（空跑）。
        with self.assertRaises(_TrapBars.AccessError):
            evaluate_run_gate(
                _TrapBars(), eligible_codes=["513310"],
                rule_bundle_config=self._cfg(role_thresholds=dict(DEFAULT_ROLE_THRESHOLDS)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
