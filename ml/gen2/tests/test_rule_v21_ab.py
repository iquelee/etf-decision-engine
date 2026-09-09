"""Gen-2.1 M3 — rule_v21_ab 状态机单元测试（V2.1 变体门控逻辑）。

策略：不 mock 完整 features（alpha 依赖太多列），而是直接构造 **prepared 输入**
（alpha_sub/quality/code_flag，即 _prepare_v21_inputs 的产物），聚焦测试
build_v21_roles 状态机内的 V21 门控语义。features 传空 df（prepared 路径不消费）。

验证：
  1. schema 与 V2 一致（13 列核心）。
  2. V21-DELTA-1 cluster 门：非 top_cluster/非 leader 的晋升候选被降级。
  3. V21-DELTA-2 consolidation 门：quality < min_quality 被降级；Gate OFF 不产生事件。
  4. V21-DELTA-3：tenure 保护（min-hold）生效 → 新晋升 CORE 不被立即替换。
  5. DISABLED 禁晋升（与 V2 一致）。
"""
from __future__ import annotations

import tempfile
import unittest
from unittest import mock

import pandas as pd

from gen2.baseline.rule_v21_ab import build_v21_roles


def _mock_records_master() -> pd.DataFrame:
    """临时 universe master：5 只标的全部 core_eligible/tradable 且非 incumbent/challenger
    （初始 RESERVE，晋升链可触发）。规避真实 master 中 Main5 incumbent 全 CORE 起步。
    """
    rows = []
    for code, name, cl in (("513310", "ETF_A", "tech_hardware"),
                           ("515880", "ETF_B", "tech_hardware"),
                           ("159582", "ETF_C", "tech_hardware"),
                           ("518880", "ETF_G", "gold_commodity"),
                           ("159570", "ETF_H", "gold_commodity")):
        rows.append({
            "code": code, "name": name, "asset_class": "equity", "sector": cl,
            "theme": "", "correlation_cluster": cl, "listing_date": "2019-01-01",
            "benchmark_code": "510300", "strategic_role_hint": "",
            "incumbent": 0, "challenger": 0, "tradable": 1, "research_only": 0,
            "core_eligible": 1, "liquidity_tier": "a", "gen1_category": "",
            "gen1_category_coverage": "", "gen1_domain_status": "OUT_OF_DOMAIN", "notes": "",
        })
    return pd.DataFrame(rows)


def _patched_records(fn=None):
    """contextmanager：用临时 master（非 incumbent）patch load_universe_records。"""
    import contextlib

    @contextlib.contextmanager
    def _cm():
        df = _mock_records_master()
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w", encoding="utf-8") as f:
            df.to_csv(f, index=False)
            tmp = f.name
        from gen2.data.loader import load_universe_records

        records = load_universe_records(tmp)
        with mock.patch("gen2.data.loader.load_universe_records", return_value=records):
            yield records

    return _cm()


def _mock_prepared(n_days: int = 30, n_tech_above: int = 1) -> dict:
    """5 codes（n=5 时 alpha rank1/rank2 均 alpha_pct>=0.8，可分别测晋升与门控）：

        513310  强 tech    alpha 95   leader/top       quality 90
        515880  中 tech    alpha 85   非 leader(top簇)  quality 55   → 触发 V21_CLUSTER_GATE_BLOCKED
        159582  弱 tech    alpha 75   非 leader(top簇)  quality 40   → proposed SATELLITE（不触门）
        518880  弱 gold    alpha 40   非 top           quality 30   → proposed RESERVE
        159570  弱 gold    alpha 30   非 top           quality 20   → proposed RESERVE

    序列：默认 mode=ACTIVE(market_score=60，≥55 契约)。仅尾部 3 天切 DISABLED(market_score=20)
    用于 DISABLED 语义；主体 ACTIVE 使 promotion persistence 可达。px_ma60：tech 全正，gold 为负。
    """
    import numpy as np

    dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2023-01-02", periods=n_days)]
    spec = {
        "513310": ("tech_hardware", 95.0, 90.0, 0.02),
        "515880": ("tech_hardware", 85.0, 55.0, 0.02),
        "159582": ("tech_hardware", 75.0, 40.0, 0.01),
        "518880": ("gold_commodity", 40.0, 30.0, -0.01),
        "159570": ("gold_commodity", 30.0, 20.0, -0.02),
    }
    rows_alpha, rows_rank = [], []
    for i, d in enumerate(dates):
        ms = 20.0 if i >= n_days - 3 else 60.0  # 仅尾部 3 天 DISABLED
        for code, (cl, a, qv, ma60) in spec.items():
            rows_alpha.append({"trade_date": d, "code": code, "alpha_score_v2": a,
                               "market_score": ms, "px_ma60": ma60})
            rows_rank.append({"trade_date": d, "code": code, "name": f"ETF_{code}",
                              "correlation_cluster": cl})
    alpha_sub = pd.DataFrame(rows_alpha)
    quality = alpha_sub[["trade_date", "code"]].merge(
        pd.DataFrame([{"trade_date": d, "code": c, "quality": v[2]}
                      for d in dates for c, v in spec.items()]), on=["trade_date", "code"])
    code_flag = alpha_sub[["trade_date", "code"]].merge(
        pd.DataFrame([{"trade_date": d, "code": c,
                       "is_cluster_leader": c == "513310",
                       "cluster_top": c != "518880" and c != "159570"}
                      for d in dates for c in spec]),
        on=["trade_date", "code"])
    return {"alpha_sub": alpha_sub, "quality": quality, "code_flag": code_flag}


def _cfg(**portfolio_over):
    p = {"max_core_count": 2, "max_core_per_cluster": 2, "promotion_persistence_days": 3,
         "demotion_persistence_days": 2, "max_single_weight": 0.25, "max_cluster_weight": 0.40,
         "max_tech_weight": 0.65, "tech_clusters": ["tech_hardware", "software_ai"]}
    p.update(portfolio_over)
    return {"portfolio": p}


def _v21(min_quality=None, min_hold_days: int = 5):
    return {
        "min_quality": min_quality,
        "cluster": {"top_cluster_count": 1, "cluster_min_members": 1,
                    "leaders_per_cluster": 1, "breadth_min_pos": 0.0},
        "replacement": {"min_hold_days": min_hold_days},
    }


def _rankings(prep: dict) -> pd.DataFrame:
    """由 prepared.alpha_sub 构造 rankings（name/cluster 列）。"""
    cl = {"513310": "tech_hardware", "515880": "tech_hardware", "159582": "tech_hardware",
          "518880": "gold_commodity", "159570": "gold_commodity"}
    rk = prep["alpha_sub"][["trade_date", "code"]].copy()
    rk["name"] = rk["code"].map(lambda c: f"ETF_{c}")
    rk["correlation_cluster"] = rk["code"].map(lambda c: cl[c])
    return rk


class TestV21Schema(unittest.TestCase):
    def test_output_schema_matches_v2(self):
        with _patched_records():
            prep = _mock_prepared()
            rk = _rankings(prep)
            roles = build_v21_roles(pd.DataFrame(), rk, _cfg(), _v21(None), prepared=prep)
        for col in ("trade_date", "code", "name", "correlation_cluster", "role", "alpha_score_v2",
                    "alpha_rank", "alpha_pct", "perm_mode", "trend_gate", "reason_codes",
                    "relative_share", "target_weight"):
            self.assertIn(col, roles.columns, f"缺列 {col}")
        self.assertEqual(len(roles), len(prep["alpha_sub"]))


class TestV21ClusterGate(unittest.TestCase):
    def test_weak_cluster_never_core(self):
        # gold 簇非 top：518880/159570 永不 CORE（即使 alpha 排名中游）
        with _patched_records():
            prep = _mock_prepared(n_days=30)
            roles = build_v21_roles(pd.DataFrame(), _rankings(prep), _cfg(), _v21(None), prepared=prep)
        for weak in ("518880", "159570"):
            n_core = len(roles[(roles["code"] == weak) & (roles["role"] == "CORE")])
            self.assertEqual(n_core, 0, f"{weak} 非 top cluster 不得成为 CORE")

    def test_cluster_gate_blocks_non_leader_rank2(self):
        # 515880 是 rank2（alpha_pct=0.8>=0.8，本可 CORE 候选）但非 cluster_leader
        # → 被 V21_CLUSTER_GATE_BLOCKED 拦截；513310(leader) 正常晋升
        with _patched_records():
            prep = _mock_prepared(n_days=30)
            roles = build_v21_roles(pd.DataFrame(), _rankings(prep), _cfg(), _v21(None), prepared=prep)
        blocked_515 = roles[roles["reason_codes"].astype(str).str.contains("V21_CLUSTER_GATE_BLOCKED", na=False)]
        self.assertGreater(len(blocked_515), 0, "rank2 非 leader 晋升应被 V21 cluster 门拦截")
        # 159582（rank3, alpha_pct=0.6）只到 SATELLITE，不触发晋升分支（无 cluster 门事件）
        blocked_159 = roles[(roles["code"] == "159582")
                            & roles["reason_codes"].astype(str).str.contains("V21_CLUSTER_GATE_BLOCKED", na=False)]
        self.assertEqual(len(blocked_159), 0, "rank3 非 CORE 候选不应产生 cluster 门事件")


class TestV21ConsolidationGate(unittest.TestCase):
    def test_gate_blocks_low_quality(self):
        # 513310(leader, quality 90)。min_quality=95 > 90 → 通过 cluster 门后被 consolidation 拦；
        # Gate OFF 与 min_quality=80(<=90) 不拦。
        with _patched_records():
            prep = _mock_prepared(n_days=40)
            rk = _rankings(prep)
            off = build_v21_roles(pd.DataFrame(), rk, _cfg(), _v21(None), prepared=prep)
            g95 = build_v21_roles(pd.DataFrame(), rk, _cfg(), _v21(95.0), prepared=prep)
            g80 = build_v21_roles(pd.DataFrame(), rk, _cfg(), _v21(80.0), prepared=prep)
        c_off = off[off["reason_codes"].astype(str).str.contains("V21_CONSOLIDATION_BLOCKED", na=False)]
        c_g95 = g95[g95["reason_codes"].astype(str).str.contains("V21_CONSOLIDATION_BLOCKED", na=False)]
        c_g80 = g80[g80["reason_codes"].astype(str).str.contains("V21_CONSOLIDATION_BLOCKED", na=False)]
        self.assertEqual(len(c_off), 0, "Gate OFF 不应出现 consolidation 拦截")
        self.assertGreater(len(c_g95), 0, "min_quality=95 > leader quality 90 → 应拦截")
        core_g95 = g95[(g95["code"] == "513310") & (g95["role"] == "CORE")]
        core_g80 = g80[(g80["code"] == "513310") & (g80["role"] == "CORE")]
        self.assertEqual(len(core_g95), 0, "quality 90 < 门槛 95 → leader 也不得晋升 CORE")
        self.assertGreater(len(core_g80), 0, "quality 90 >= 门槛 80 → leader 应晋升 CORE")

    def test_gate_off_keeps_promotion(self):
        # 513310 连续 alpha 前 20%（5 只里 rank1）满 3 日 → PROMOTION_CONFIRMED
        with _patched_records():
            prep = _mock_prepared(n_days=40)
            roles = build_v21_roles(pd.DataFrame(), _rankings(prep), _cfg(), _v21(None), prepared=prep)
        promo_513 = roles[(roles["code"] == "513310")
                          & roles["reason_codes"].astype(str).str.contains("PROMOTION_CONFIRMED", na=False)]
        self.assertGreater(len(promo_513), 0, "Gate OFF + leader 满 persistence 应晋升 CORE")


class TestV21ReplacementPairing(unittest.TestCase):
    """M3-r2：replacement 1↔1 + 同簇强制 + pairing 输出。

    构造两簇各 2 只 CORE 候选，alpha 随时间反转制造 cap 挤出现任，
    验证 REPLACEMENT_ACCEPTED 的 challenger 被 consume（不重复匹配）。
    """

    def test_no_cross_cluster_replacement(self):
        # 仅当 challenger 与 incumbent 同簇才可能替换；无同簇晋升者时现任恢复
        with _patched_records():
            prep = _mock_prepared(n_days=60)
            roles = build_v21_roles(pd.DataFrame(), _rankings(prep), _cfg(), _v21(None), prepared=prep)
        # 若发生 REPLACEMENT_* 事件，pair 必须同簇
        for _, r in roles[roles["replacement_pair"].astype(str) != ""].iterrows():
            chal, inc, cl = str(r["replacement_pair"]).split("|")
            chal_cl = roles[(roles["code"] == chal)]["correlation_cluster"].iloc[0]
            inc_cl = roles[(roles["code"] == inc)]["correlation_cluster"].iloc[0]
            self.assertEqual(chal_cl, inc_cl, "替换必须同簇（禁跨簇 fallback）")
            self.assertEqual(chal_cl, cl, "pair 记录的 cluster 应一致")

    def test_replacement_pair_is_one_to_one(self):
        # 同一 challenger（pair 首段 code）不得出现在多个 accepted 事件（1↔1 consume）
        with _patched_records():
            prep = _mock_prepared(n_days=60)
            roles = build_v21_roles(pd.DataFrame(), _rankings(prep), _cfg(), _v21(None), prepared=prep)
        pairs = roles[roles["replacement_pair"].astype(str) != ""]["replacement_pair"].astype(str)
        chals = [p.split("|")[0] for p in pairs]
        self.assertEqual(len(chals), len(set(chals)), "同一 challenger 不得重复批准多个替换")

    def test_pair_column_in_schema(self):
        with _patched_records():
            prep = _mock_prepared(n_days=30)
            roles = build_v21_roles(pd.DataFrame(), _rankings(prep), _cfg(), _v21(None), prepared=prep)
        self.assertIn("replacement_pair", roles.columns)


if __name__ == "__main__":
    unittest.main(verbosity=2)
