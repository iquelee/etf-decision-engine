"""WP-G2-06（F4）验收边界 —— 候选组合构建统一（**红基线 / pinning tests**）。

裁决（2026-09-14）给出的验收边界，本文件逐条固化为可执行门禁：

  B1  候选组合**不得**把角色层的单只 / cluster / 广义科技上限重置为等权；
  B2  ``priority`` **必须**来自本轮显式注入的 selection score，**禁止** legacy ``rank``；
  B3  现金腿与防守腿**必须**进入研究组合（进研究账本见 06b）；
  B4  研究路径与权威路径（``rule_v2_ab.run_v2_backtest``）**同口径**，不得各算一套权重；
  B5  ``priority`` 全覆盖 / 有限值 / 按 score 降序、**同分按 code 升序**稳定；写入 source/hash；
  B6  现金 / 防守腿**逐日进账本**，且标注 **Gen-2 candidate sleeve**，绝不写成 V3.6.1 ``final_target``；
  B7  ``G2S-10`` 跨端**逐日**对表：每只 ETF / 现金 / 防守腿的权重、权重和、上限、priority、
      score/config hash（不只比「有无腿」）。

本文件曾是 WP-G2-06 的**红基线（pinning tests）**：开工时 11/11 红，红灯即缺陷的可复现描述。
实现完成、全部转绿后**移入 `ml/gen2/tests/` 并纳入 CI 门禁**（Stage B：`unittest discover`）。

裁决（2026-09-14）追加的三项硬验收也已固化在此（B5/B6/B7），合计 29 条。

背景（F4 缺陷，已修，见 ml/gen2/reports/gen2_wp_g2_06_plan_20260914.md）::

    build_portfolio_candidates 曾把 CORE 权重重置为等权 1/n（丢弃 build_v2_roles 计算的
    单只/cluster/广义科技上限），并以 legacy rank 作为 priority，且组合里没有现金腿与防守腿。

运行::

    PYTHONPATH=ml python -m unittest ml.gen2.tests.test_wp_g2_06_portfolio
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import pandas as pd

# 本文件位于 ml/gen2/tests/，向上找到带 ml/ 的仓库根
_here = Path(__file__).resolve()
ROOT = next(p for p in _here.parents if (p / "ml" / "gen2").is_dir())
sys.path.insert(0, str(ROOT / "ml"))

from gen2.portfolio.portfolio_builder import (  # noqa: E402
    CASH_CODE as PB_CASH_CODE,
    PRIORITY_SOURCE,
    PRIORITY_SOURCE_RESIDUAL,
    SLEEVE,
    PortfolioBuildError,
    build_portfolio_candidates,
    build_research_ledger,
    ledger_signals,
    priority_from_roles,
    priority_hash,
)

#: 权威路径的权重上限（与 ml/gen2/config/gen2.yaml portfolio 段一致）
MAX_SINGLE = 0.25
MAX_CLUSTER = 0.40
MAX_TECH = 0.65
TECH_CLUSTERS = {"tech_hardware", "software_ai"}
HEDGE_CODE = "518880"
CASH_CODE = "CASH"

_PORTFOLIO_CFG = {
    "max_single_weight": MAX_SINGLE,
    "max_cluster_weight": MAX_CLUSTER,
    "max_tech_weight": MAX_TECH,
    "tech_clusters": sorted(TECH_CLUSTERS),
}


def _authoritative_roles() -> pd.DataFrame:
    """模拟 ``build_v2_roles`` 的**权威输出**：CORE 权重已被单只/cluster/科技上限裁剪。

    刻意做成**非等权**（0.25 / 0.15 / 0.10）—— 等权 1/3 ≈ 0.3333 与三者都不同，
    因此任何「重置为等权」的实现都必然被 B1 抓住。

    * 3 只 CORE：2 只同属 tech_hardware（cluster 合计 0.40 = 上限，刚好不越界），1 只 biotech；
    * 广义科技合计 0.40 <= 0.65（不触顶，避免与 cluster 上限相互干扰）；
    * 1 只 SATELLITE（权重 0）、1 只 HEDGE（518880，权重 0，由防守腿给权）。
    """
    d = "2026-03-02"
    return pd.DataFrame([
        {"trade_date": d, "code": "513310", "name": "中韩半导体", "correlation_cluster": "tech_hardware",
         "role": "CORE", "target_weight": 0.25, "rank": 1, "alpha_score_v2": 90.0},
        {"trade_date": d, "code": "515880", "name": "AI互联", "correlation_cluster": "tech_hardware",
         "role": "CORE", "target_weight": 0.15, "rank": 3, "alpha_score_v2": 70.0},
        {"trade_date": d, "code": "159570", "name": "港股通创新药", "correlation_cluster": "biotech",
         "role": "CORE", "target_weight": 0.10, "rank": 2, "alpha_score_v2": 80.0},
        {"trade_date": d, "code": "159915", "name": "创业板", "correlation_cluster": "broad",
         "role": "SATELLITE", "target_weight": 0.0, "rank": 4, "alpha_score_v2": 60.0},
        {"trade_date": d, "code": HEDGE_CODE, "name": "黄金", "correlation_cluster": "hedge",
         "role": "HEDGE", "target_weight": 0.0, "rank": 5, "alpha_score_v2": 50.0},
    ])


def _injected_priority() -> dict:
    """显式注入的 selection score：**刻意与 legacy rank 顺序相反**。

    rank 顺序        : 513310(1) → 159570(2) → 515880(3)
    score 顺序       : 513310(90) → 159570(80) → 515880(70)
    为了让两者可区分，把 515880 的分数抬到最高：
    """
    return {"2026-03-02": {"513310": 10.0, "515880": 99.0, "159570": 50.0,
                           "159915": 40.0, HEDGE_CODE: 5.0}}


def _bench_features(risk_off: bool) -> pd.DataFrame:
    """benchmark 510300 的 regime 输入。

    market_score = 50 + 500*(ma20_dev + ma60_dev)：
      * RISK_OFF 需 score <= 45 → ma20_dev=-0.03, ma60_dev=-0.05 → score=10
      * NORMAL   需 45 < score < 55 → ma20_dev=0.0, ma60_dev=0.0 → score=50
    """
    ma20, ma60 = (-0.03, -0.05) if risk_off else (0.0, 0.0)
    return pd.DataFrame([{
        "trade_date": "2026-03-02", "code": "510300",
        "benchmark_px_ma20": ma20, "benchmark_px_ma60": ma60,
        "realized_vol20": 0.30,  # 高于 vol_target(0.17) → NORMAL 下也会缩仓，便于观察
    }])


def _build(roles=None, priority=None, **kw):
    """统一调用入口：WP-G2-06 起 ``priority`` 必须显式注入。"""
    return build_portfolio_candidates(roles if roles is not None else _authoritative_roles(),
                                      priority=priority if priority is not None else _injected_priority(),
                                      portfolio_config=_PORTFOLIO_CFG, **kw)


class B1_CapsNotResetToEqualWeightTest(unittest.TestCase):
    """B1：候选组合不得把角色层的单只/cluster/广义科技上限重置为等权。"""

    def test_core_weights_are_preserved_not_equal_weighted(self):
        roles = _authoritative_roles()
        want = {r.code: r.target_weight for r in roles.itertuples() if r.role == "CORE"}
        out = _build(roles)
        got = {r.code: round(float(r.target_weight), 10)
               for r in out.itertuples() if r.role == "CORE"}
        self.assertEqual(got, want,
                         "CORE 权重被改写：权威权重 %s → 实得 %s（等权 1/3≈%.4f 是缺陷特征）"
                         % (want, got, 1.0 / 3.0))
        # 显式排除「恰好等于 1/n」这一等权特征
        n = len(want)
        self.assertFalse(any(abs(w - 1.0 / n) < 1e-12 for w in got.values()),
                         "出现 1/n 等权值，说明权威权重被重置")

    def test_caps_still_respected_after_build(self):
        out = _build()
        core = out[out["role"] == "CORE"]
        # 单只上限
        self.assertLessEqual(float(core["target_weight"].max()), MAX_SINGLE + 1e-12,
                             "单只上限被突破")
        # cluster 上限
        by_cluster = core.groupby("correlation_cluster")["target_weight"].sum()
        self.assertLessEqual(float(by_cluster.max()), MAX_CLUSTER + 1e-12,
                             "cluster 上限被突破：%s" % by_cluster.to_dict())
        # 广义科技上限
        tech = float(core[core["correlation_cluster"].isin(TECH_CLUSTERS)]["target_weight"].sum())
        self.assertLessEqual(tech, MAX_TECH + 1e-12, "广义科技上限被突破：%s" % tech)

    def test_cluster_exposure_reflects_authoritative_weights(self):
        """cluster 敞口必须来自权威权重（研究脚本用它做归因）。"""
        from gen2.portfolio.portfolio_builder import build_cluster_exposure

        exp = build_cluster_exposure(_build()).set_index("correlation_cluster")["target_weight"]
        self.assertAlmostEqual(float(exp["tech_hardware"]), 0.40, places=10,
                               msg="tech_hardware 敞口应为 0.25+0.15=0.40，实得 %s" % float(exp["tech_hardware"]))
        self.assertAlmostEqual(float(exp["biotech"]), 0.10, places=10)


class B2_PriorityFromInjectedScoreTest(unittest.TestCase):
    """B2：priority 必须来自显式注入的 selection score；禁止 legacy rank。"""

    def test_priority_follows_injected_score_not_rank(self):
        out = _build()
        got = {r.code: int(r.priority) for r in out.itertuples()}
        # 注入分数：515880(99) > 159570(50) > 159915(40) > 513310(10) > 518880(5)
        self.assertEqual(got["515880"], 1, "priority 未跟随注入 score（515880 分数最高应为 1）")
        self.assertEqual(got["159570"], 2)
        self.assertEqual(got["159915"], 3)
        self.assertEqual(got["513310"], 4)
        self.assertEqual(got[HEDGE_CODE], 5)
        # 反例护栏：legacy rank 顺序是 513310(1) > 159570(2) > 515880(3)
        self.assertNotEqual(got["513310"], 1, "priority 仍在跟随 legacy rank（513310 rank=1）")

    def test_missing_priority_is_rejected(self):
        """缺显式 priority 必须失败：研究路径不得静默回退 legacy rank。

        期望抛出 ``PortfolioBuildError``（WP-G2-06 新增；实现完成前本用例为红）。
        """
        from gen2.portfolio.portfolio_builder import PortfolioBuildError  # noqa: PLC0415

        with self.assertRaises(PortfolioBuildError):
            build_portfolio_candidates(_authoritative_roles(), portfolio_config=_PORTFOLIO_CFG)

    def test_source_does_not_read_legacy_rank(self):
        """静态守卫：实现里不得再出现 ``out["rank"]`` 直接赋给 priority。"""
        src = (ROOT / "ml" / "gen2" / "portfolio" / "portfolio_builder.py").read_text(encoding="utf-8")
        self.assertNotIn('out["rank"]', src, "portfolio_builder 仍直接读 rank")
        self.assertNotIn("'rank'", src.split("def build_portfolio_candidates")[1].split("def ")[0],
                         "build_portfolio_candidates 仍读 rank")


class B3_CashAndDefenseLegsTest(unittest.TestCase):
    """B3：现金腿与防守腿必须进入研究组合。"""

    def test_cash_leg_present_with_residual_weight(self):
        out = _build()
        cash = out[out["code"] == CASH_CODE]
        self.assertFalse(cash.empty, "研究组合缺现金腿（CASH 行）")
        for d, g in out.groupby("trade_date"):
            whole = float(g[g["code"] != CASH_CODE]["target_weight"].sum())
            c = float(g[g["code"] == CASH_CODE]["target_weight"].iloc[0])
            self.assertAlmostEqual(c, round(1.0 - whole, 10), places=8,
                                   msg="现金腿 != 1 - 持仓合计（%s）" % d)

    def test_defense_leg_present_and_scaled_under_risk_off(self):
        out = _build(features=_bench_features(risk_off=True), apply_defense=True)
        hedge = out[out["code"] == HEDGE_CODE]
        self.assertFalse(hedge.empty, "研究组合缺防守腿（hedge_code 行）")
        self.assertTrue((hedge["defense_state"] == "RISK_OFF").all(),
                        "RISK_OFF 下防守腿未标记状态：%s" % hedge["defense_state"].tolist())
        # 防守腿权重 = risk_off_hedge_weight（默认 0.15）
        self.assertAlmostEqual(float(hedge["target_weight"].iloc[0]), 0.15, places=8,
                               msg="防守腿权重不等于 risk_off_hedge_weight")
        # CORE 腿按 (exposure_scale - hedge_weight) 缩仓：0.50 - 0.15 = 0.35
        core = out[out["role"] == "CORE"].set_index("code")["target_weight"]
        self.assertAlmostEqual(float(core["513310"]), round(0.25 * 0.35, 10), places=8,
                               msg="RISK_OFF 下 CORE 未按 core_scale 缩仓")

    def test_defense_state_recorded_when_normal(self):
        out = _build(features=_bench_features(risk_off=False), apply_defense=True)
        self.assertIn("defense_state", out.columns, "未记录 defense_state（无法进账本归因）")
        self.assertTrue((out["defense_state"] == "NORMAL").all())


class B4_SingleBuilderSameCaliberTest(unittest.TestCase):
    """B4：研究路径与权威路径同口径 —— 只允许存在**一个**候选组合构建口径。"""

    def test_research_path_weights_equal_authoritative_weights(self):
        """``build_portfolio_candidates`` 必须直接沿用 ``build_v2_roles`` 的权威权重。

        这是 B4 的最小可执行形态：研究路径不得自行重算一套权重。
        （完整的 JS Shadow ↔ Python 回测逐日对表见 WP-G2-06b / 跨端场景扩展。）
        """
        roles = _authoritative_roles()
        out = _build(roles)
        merged = out.merge(roles[["trade_date", "code", "target_weight"]],
                           on=["trade_date", "code"], suffixes=("_out", "_auth"))
        merged = merged[merged["role"] == "CORE"]
        for r in merged.itertuples():
            self.assertAlmostEqual(float(r.target_weight_out), float(r.target_weight_auth), places=10,
                                   msg="%s 研究路径权重 %s != 权威权重 %s"
                                       % (r.code, r.target_weight_out, r.target_weight_auth))

    def test_no_second_weight_algorithm(self):
        """静态守卫：研究侧不得再出现 1/n 等权分配。"""
        src = (ROOT / "ml" / "gen2" / "portfolio" / "portfolio_builder.py").read_text(encoding="utf-8")
        self.assertNotIn("1.0 / len", src, "portfolio_builder 仍自行做 1/n 等权分配")
        self.assertNotIn("rdiv(1.0)", src, "portfolio_builder 仍自行做 1/n 等权分配")


# --------------------------------------------------------------------------- #
# 裁决 2026-09-14 追加的三项硬验收
# --------------------------------------------------------------------------- #

_DAYS = ("2026-03-02", "2026-03-03", "2026-03-04")


def _roles_days(days=_DAYS) -> pd.DataFrame:
    frames = []
    for d in days:
        f = _authoritative_roles().copy()
        f["trade_date"] = d
        frames.append(f)
    return pd.concat(frames, ignore_index=True)


def _priority_days(days=_DAYS) -> dict:
    one = _injected_priority()["2026-03-02"]
    return {d: dict(one) for d in days}


def _returns_for(roles: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for d in sorted(roles["trade_date"].unique()):
        for c in sorted(str(x) for x in roles["code"].unique() if str(x) != CASH_CODE):
            rows.append({"trade_date": d, "code": c, "ret_1d": 0.001})
    return pd.DataFrame(rows)


def _bench_features_days(risk_off: bool, days=_DAYS) -> pd.DataFrame:
    one = _bench_features(risk_off)
    frames = []
    for d in days:
        f = one.copy()
        f["trade_date"] = d
        frames.append(f)
    return pd.concat(frames, ignore_index=True)


class B5_PriorityCompletenessTest(unittest.TestCase):
    """B5：priority 必须全覆盖、有限值、按 score 降序；同分按 code 稳定排序 + source/hash。"""

    def test_priority_covers_every_leg_and_is_dense_rank(self):
        out = _build()
        legs = out[out["code"] != CASH_CODE]
        for d, g in legs.groupby("trade_date"):
            self.assertEqual(sorted(int(x) for x in g["priority"]), list(range(1, len(g) + 1)),
                             "priority 不是 1..n 的稠密排名（%s）" % d)
            # 降序：priority 升序 ⟺ score 降序
            ordered = g.sort_values("priority")
            scores = [float(x) for x in ordered["priority_score"]]
            self.assertEqual(scores, sorted(scores, reverse=True),
                             "priority 未按 score 降序（%s）：%s" % (d, scores))

    def test_priority_ties_break_by_code_stably(self):
        """同分必须按 code 升序裁决，且**与输入行序无关**（打乱行序结果不变）。"""
        roles = _authoritative_roles()
        prio = {"2026-03-02": {"513310": 10.0, "515880": 10.0, "159570": 10.0,
                               "159915": 10.0, HEDGE_CODE: 10.0}}
        a = _build(roles, prio)
        shuffled = roles.sample(frac=1.0, random_state=7).reset_index(drop=True)
        b = _build(shuffled, prio)
        pa = {r.code: int(r.priority) for r in a.itertuples() if r.code != CASH_CODE}
        pb = {r.code: int(r.priority) for r in b.itertuples() if r.code != CASH_CODE}
        self.assertEqual(pa, pb, "同分排序依赖输入行序（不确定）")
        # 全部同分 → 纯按 code 升序
        by_code = sorted(pa)
        self.assertEqual([c for c, _ in sorted(pa.items(), key=lambda kv: kv[1])], by_code,
                         "同分未按 code 升序裁决")

    def test_missing_score_for_one_code_is_rejected(self):
        prio = _injected_priority()
        del prio["2026-03-02"]["159915"]
        with self.assertRaises(PortfolioBuildError):
            _build(priority=prio)

    def test_non_finite_score_is_rejected(self):
        prio = _injected_priority()
        prio["2026-03-02"]["159915"] = float("nan")
        with self.assertRaises(PortfolioBuildError):
            _build(priority=prio)

    def test_priority_source_and_hash_recorded_and_deterministic(self):
        prio = _injected_priority()
        out = _build(priority=prio)
        self.assertIn("priority_source", out.columns)
        self.assertIn("priority_hash", out.columns)
        self.assertTrue((out[out["code"] != CASH_CODE]["priority_source"] == PRIORITY_SOURCE).all())
        h = priority_hash(prio)
        self.assertTrue((out["priority_hash"] == h).all(), "priority_hash 与注入 score 不一致")
        # 跨进程/跨端确定性：同一映射重复计算结果相同
        self.assertEqual(priority_hash(dict(prio)), h)

    def test_priority_from_roles_uses_injected_score_not_rank(self):
        roles = _authoritative_roles()
        prio = priority_from_roles(roles)
        self.assertEqual(prio["2026-03-02"]["515880"], 70.0)   # 取自 alpha_score_v2
        out = _build(roles, prio)
        got = {r.code: int(r.priority) for r in out.itertuples() if r.code != CASH_CODE}
        self.assertEqual(got["513310"], 1)   # 90 分最高（注意 legacy rank=1 也是它，用下面反例）
        self.assertEqual(got["159570"], 2)
        self.assertEqual(got["515880"], 3)

    def test_cash_leg_priority_is_residual_and_finite(self):
        out = _build()
        cash = out[out["code"] == PB_CASH_CODE].iloc[0]
        n = len(out[(out["trade_date"] == cash["trade_date"]) & (out["code"] != PB_CASH_CODE)])
        self.assertEqual(int(cash["priority"]), n + 1, "现金腿 priority 应为 当日证券腿数+1")
        self.assertEqual(cash["priority_source"], PRIORITY_SOURCE_RESIDUAL)


class B6_CashDefenseLedgerSleeveTest(unittest.TestCase):
    """B6：现金/防守腿逐日进入账本；归属 Gen-2 candidate sleeve，绝不写成 final_target。"""

    def _candidates_with_defense(self, risk_off: bool):
        roles = _roles_days()
        return _build(roles, _priority_days(),
                      features=_bench_features_days(risk_off), apply_defense=True)

    def test_cash_leg_excluded_from_ledger_signals(self):
        cand = self._candidates_with_defense(risk_off=False)
        sig = ledger_signals(cand)
        self.assertNotIn(PB_CASH_CODE, set(sig["code"]), "现金腿不得直接喂账本（会重复计数）")
        self.assertEqual(set(sig.columns), {"trade_date", "code", "target_weight"})

    def test_cash_and_defense_enter_ledger_daily(self):
        cand = self._candidates_with_defense(risk_off=True)
        led = build_research_ledger(cand, _returns_for(_roles_days()))
        for col in ("cash_weight", "defense_weight", "sleeve"):
            self.assertIn(col, led.columns, "账本缺列 " + col)
        self.assertEqual(set(led["sleeve"]), {SLEEVE}, "sleeve 必须为 Gen-2 candidate sleeve")
        self.assertEqual(len(led), len(_DAYS), "账本未逐日记录")
        # 防守腿（RISK_OFF）逐日权重 = risk_off_hedge_weight
        self.assertTrue((led["defense_weight"] > 0).all(), "防守腿未逐日入账")
        self.assertTrue(all(abs(float(x) - 0.15) < 1e-8 for x in led["defense_weight"]))
        # 现金腿：账本自带 cash_weight（>=0），即组合的现金腿
        self.assertTrue((led["cash_weight"] >= 0).all())

    def test_normal_regime_ledger_has_zero_defense(self):
        cand = self._candidates_with_defense(risk_off=False)
        led = build_research_ledger(cand, _returns_for(_roles_days()))
        self.assertTrue(all(abs(float(x)) < 1e-12 for x in led["defense_weight"]),
                        "NORMAL 下不应有防守腿权重")

    def test_ledger_never_writes_final_target(self):
        cand = self._candidates_with_defense(risk_off=True)
        led = build_research_ledger(cand, _returns_for(_roles_days()))
        self.assertNotIn("final_target", led.columns,
                         "Gen-2 candidate sleeve 结果不得写成 V3.6.1 的 final_target")

    def test_research_ledger_module_does_not_define_final_target(self):
        src = (ROOT / "ml" / "gen2" / "backtest" / "ledger.py").read_text(encoding="utf-8")
        self.assertNotIn("final_target", src, "权威账本不得引入 V3.6.1 的 final_target 口径")


class B7_G2S10CaliberTest(unittest.TestCase):
    """B7：G2S-10 逐日对表必须覆盖权重 / 权重和 / 上限 / 优先级 / score / config / hash。"""

    @classmethod
    def setUpClass(cls):
        import sys as _sys

        _sys.path.insert(0, str(ROOT / "scripts" / "parity"))
        cls.fixture = json.loads(
            (ROOT / "fixtures" / "gen2" / "golden_scenarios_v1.json").read_text(encoding="utf-8"))
        sc = next((s for s in cls.fixture["scenarios"] if s["id"] == "G2S-10"), None)
        assert sc is not None, "缺 G2S-10（WP-G2-06 跨端逐日对表）"
        from run_gen2_scenarios import h_portfolio_build  # noqa: PLC0415

        cls.sc = sc
        cls.obs = h_portfolio_build(sc)

    def test_cases_and_daily_observation_complete(self):
        self.assertEqual(set(self.obs), {"undefended", "regime_path"})
        for cid, o in self.obs.items():
            self.assertIsNone(o["error"], f"{cid} 构建失败：{o['error']}")
            days = {str(k): v for k, v in o["days"].items()}
            self.assertEqual(sorted(days), ["2026-03-02", "2026-03-03"], "未逐日对表")
            for d, day in days.items():
                # 每只 ETF 的权重都在（不是只比「有无腿」）
                self.assertEqual(set(day["weights"]),
                                 {"513310", "159582", "159570", "159915", HEDGE_CODE})
                for key in ("cash_weight", "defense_weight", "weight_sum", "priority"):
                    self.assertIn(key, day, f"{cid}/{d} 缺 {key}")

    def test_weight_sums_conserve_to_one(self):
        for cid, o in self.obs.items():
            for d, day in o["days"].items():
                self.assertAlmostEqual(float(day["weight_sum"]), 1.0, places=9,
                                       msg=f"{cid}/{d} 权重和不为 1：{day['weight_sum']}")

    def test_caps_reported_and_within_limits(self):
        for cid, o in self.obs.items():
            self.assertLessEqual(float(o["max_single_seen"]), MAX_SINGLE + 1e-9)
            self.assertLessEqual(float(o["max_cluster_seen"]), MAX_CLUSTER + 1e-9)
            self.assertLessEqual(float(o["max_tech_seen"]), MAX_TECH + 1e-9)

    def test_priority_comes_from_score_not_weight(self):
        day = self.obs["undefended"]["days"]["2026-03-02"]
        # 分数最高的 159582（95）→ 1；权重最高的 159570（0.25）分数只排 3 → 证明不是按权重/legacy rank
        self.assertEqual(day["priority"]["159582"], 1)
        self.assertEqual(day["priority"]["159570"], 3)
        self.assertEqual(day["priority"]["CASH"], 6)
        self.assertEqual(sorted(day["priority"].values()), [1, 2, 3, 4, 5, 6])

    def test_authoritative_weights_preserved_and_sleeve_tagged(self):
        for cid, o in self.obs.items():
            self.assertEqual(o["sleeve"], SLEEVE)
            self.assertFalse(o["final_target_present"], "不得写入 V3.6.1 final_target")
            self.assertTrue(o["priority_source_all_injected"])
            self.assertTrue(o["priority_hash"])
            self.assertTrue(o["config_hash"])
        w = self.obs["undefended"]["days"]["2026-03-02"]["weights"]
        self.assertEqual(w["513310"], "0.2000000000")
        self.assertEqual(w["159582"], "0.2000000000")
        self.assertEqual(w["159570"], "0.2500000000")
        self.assertNotEqual(w["513310"], "0.3333333333", "权威权重被重置为 1/n 等权")

    def test_defense_leg_only_under_risk_off(self):
        self.assertEqual(self.obs["regime_path"]["days"]["2026-03-02"]["defense_weight"],
                         "0.0000000000")
        self.assertEqual(self.obs["regime_path"]["days"]["2026-03-03"]["defense_weight"],
                         "0.1500000000")


if __name__ == "__main__":
    unittest.main(verbosity=2)
