"""F09 替换门（replacement gate）Python 移植的回归测试。

直接测 rule_v2_ab._apply_replacement_gate 的 REVOKE 路径（边际不足撤销替换），
与 Node 端 tests/gen2-gate.test.js 的 P0-5 用例对称，锁死跨语言一致。
"""
from __future__ import annotations

import unittest

import pandas as pd

from gen2.baseline.rule_v2_ab import _apply_replacement_gate


class ReplacementGateTest(unittest.TestCase):
    def _day(self, rows):
        df = pd.DataFrame(rows)
        df["reason_codes"] = ""
        return df

    def test_revoke_restores_incumbent_and_demotes_weakest_same_cluster(self):
        # 场景：科技现任 513310(alpha90) 被 cluster cap 降级；同 cluster 晋升者 512480(95)/159995(94)
        # 边际（95-90-5=0、94-90-5=-1）均 < 8 → 应撤销替换：恢复 513310，退回最弱同 cluster 晋升者 159995。
        day = self._day([
            {"code": "512480", "role": "CORE", "role_before_cap": "CORE", "alpha_score_v2": 95.0, "correlation_cluster": "tech_hardware"},
            {"code": "159995", "role": "CORE", "role_before_cap": "CORE", "alpha_score_v2": 94.0, "correlation_cluster": "tech_hardware"},
            {"code": "513310", "role": "SATELLITE", "role_before_cap": "CORE", "alpha_score_v2": 90.0, "correlation_cluster": "tech_hardware"},
            {"code": "512800", "role": "CORE", "role_before_cap": "CORE", "alpha_score_v2": 85.0, "correlation_cluster": "financial"},
        ])
        prev_roles = {"513310": "CORE", "512480": "RESERVE", "159995": "RESERVE", "512800": "RESERVE"}

        _apply_replacement_gate(day, prev_roles, base_max_core=5, max_core_per_cluster=2)

        roles = dict(zip(day["code"], day["role"]))
        self.assertEqual(roles["513310"], "CORE")       # 现任被恢复
        self.assertEqual(roles["159995"], "CHALLENGER")  # 最弱同 cluster 晋升者被退回
        self.assertEqual(roles["512480"], "CORE")
        self.assertEqual(roles["512800"], "CORE")
        # 约束：tech_hardware CORE ≤2
        tech_cores = sum(1 for c, r in roles.items() if r == "CORE" and c in {"512480", "159995", "513310"})
        self.assertLessEqual(tech_cores, 2)

    def test_accept_keeps_demotion_when_edge_sufficient(self):
        # 边际足够（challenger alpha 远高于现任）→ 接受替换，现任保持降级。
        day = self._day([
            {"code": "512480", "role": "CORE", "role_before_cap": "CORE", "alpha_score_v2": 99.0, "correlation_cluster": "tech_hardware"},
            {"code": "513310", "role": "SATELLITE", "role_before_cap": "CORE", "alpha_score_v2": 70.0, "correlation_cluster": "tech_hardware"},
        ])
        prev_roles = {"513310": "CORE", "512480": "RESERVE"}
        _apply_replacement_gate(day, prev_roles, base_max_core=5, max_core_per_cluster=2)
        roles = dict(zip(day["code"], day["role"]))
        self.assertEqual(roles["513310"], "SATELLITE")  # 边际 99-70-5=24 ≥ 8 → 接受，保持降级
        self.assertEqual(roles["512480"], "CORE")


if __name__ == "__main__":
    unittest.main()
