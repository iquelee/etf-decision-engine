"""WP-G2-06（F4）验收边界 —— 候选组合构建统一（**红基线 / pinning tests**）。

裁决（2026-09-14）给出的验收边界，本文件逐条固化为可执行门禁：

  B1  候选组合**不得**把角色层的单只 / cluster / 广义科技上限重置为等权；
  B2  ``priority`` **必须**来自本轮显式注入的 selection score，**禁止** legacy ``rank``；
  B3  现金腿与防守腿**必须**进入研究组合（进研究账本见 06b）；
  B4  研究路径与权威路径（``rule_v2_ab.run_v2_backtest``）**同口径**，不得各算一套权重。

本文件在 WP-G2-06 开工时**故意为红**：红 = 缺陷已被精确描述（可复现、可定位），
而不是「还没写」。实现完成后必须全绿，并作为 WP-G2-04 冻结前的资格门禁之一。

背景（F4 现状，见 ml/gen2/reports/gen2_b1_research_baselines_20260911.md）::

    build_portfolio_candidates 把 CORE 权重重置为等权 1/n（丢弃 build_v2_roles 计算的
    单只/cluster/广义科技上限），并以 legacy rank（leadership 排名）作为 priority；
    run_rotation_backtest 亦不含防守腿。

运行（**必须显式指定路径**；pending/ 刻意不被 ``unittest discover`` 覆盖，
因为本文件在实现完成前为红，不能污染 CI）::

    PYTHONPATH=ml python -m unittest ml.gen2.tests.pending.test_wp_g2_06_portfolio

WP-G2-06 实现完成、本文件全绿后，把它移回 ``ml/gen2/tests/`` 并纳入 Stage B 门禁。
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd

# 本文件位于 ml/gen2/tests/pending/，向上找到带 ml/ 的仓库根
_here = Path(__file__).resolve()
ROOT = next(p for p in _here.parents if (p / "ml" / "gen2").is_dir())
sys.path.insert(0, str(ROOT / "ml"))

from gen2.portfolio.portfolio_builder import build_portfolio_candidates  # noqa: E402

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
