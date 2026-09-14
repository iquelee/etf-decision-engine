"""角色语义权威性守卫（WP-G2-03 剩余切片）。

背景（用户裁决 2026-09-11，收紧版）：
  * **V2 唯一权威角色实现 = ``gen2.baseline.rule_v2_ab.build_v2_roles``**
    （B1 账本 / B3 OOS / 360 行 parity 的实际使用者，且唯一含 NO_CORE 硬门槛与 Selection Permission）。
  * ``gen2.portfolio.role_engine.build_daily_roles``（legacy 独立状态机）**已停用**：
    调用即抛 ``RuntimeError``，仓库内**零消费者**；V2 回测 / 敏感性 / 归因 / parity 一律不得调用。
  * 需要 legacy 展示列（rank / rank_percentile / leadership_score / persistence_days）的研究脚本
    统一走 ``gen2.baseline.v2_role_view.build_v2_role_view``（角色语义仍来自权威实现）。
  * 若未来确需保留 ``build_daily_roles``，只能改造为「调用权威实现的兼容包装层」（WP-G2-05）。

覆盖：
  1. 权威实现与视图可导入；
  2. V2 / 研究 / parity 路径（6 个文件）**不得出现** legacy 角色实现；
  3. 全仓库 **零 legacy 消费者**（``LEGACY_V1_CONSUMER_ALLOWLIST`` 必须为空且无例外）；
  4. legacy 实现 fail-fast（调用抛 RuntimeError，且错误信息指向权威实现）；
  5. 研究视图必须委托权威实现（不得自带角色决策）；
  6. D-004 审计码（CLUSTER_CAP_DEMOTED）在 rule_v2_ab 的追加位置正确（cap 之后、finalize 之前）。
"""
from __future__ import annotations

import ast
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ml"))

from gen2.portfolio.role_engine import (  # noqa: E402
    LEGACY_V1_CONSUMER_ALLOWLIST,
    V2_AUTHORITATIVE_ROLE_IMPL,
    V2_PATH_FORBIDDEN_ROLE_IMPL,
)

ML_ROOT = ROOT / "ml"
PARITY_DIR = ROOT / "scripts" / "parity"
LEGACY_IMPL_OWNER = ROOT / "ml" / "gen2" / "portfolio" / "role_engine.py"


def _module_name(path: Path) -> str:
    try:
        rel = path.relative_to(ML_ROOT)
    except ValueError:
        return str(path.relative_to(ROOT)).replace("/", ".").replace("\\", ".").removesuffix(".py")
    return str(rel).replace("/", ".").replace("\\", ".").removesuffix(".py")


def _imports_build_daily_roles(path: Path) -> bool:
    """AST 级判定：是否从 role_engine 导入 build_daily_roles（含别名 / 函数内导入）。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "gen2.portfolio.role_engine":
            for alias in node.names:
                if alias.name == "build_daily_roles":
                    return True
    return False


def _py_files(*dirs: Path):
    for d in dirs:
        for p in sorted(d.rglob("*.py")):
            if "__pycache__" in p.parts:
                continue
            yield p


class TestRoleImplementationAuthority(unittest.TestCase):
    def test_authoritative_constant_points_to_rule_v2_ab(self):
        self.assertEqual(V2_AUTHORITATIVE_ROLE_IMPL, "gen2.baseline.rule_v2_ab.build_v2_roles")
        from gen2.baseline.rule_v2_ab import build_v2_roles
        self.assertTrue(callable(build_v2_roles), "权威实现必须可导入")

    def test_v2_and_research_paths_do_not_reference_legacy_role_impl(self):
        self.assertEqual(
            set(V2_PATH_FORBIDDEN_ROLE_IMPL),
            {
                "ml/gen2/baseline/rule_v2_ab.py",
                "ml/gen2/baseline/rule_v21_ab.py",
                "ml/gen2/baseline/rule_rotation.py",
                "ml/gen2/baseline/sensitivity_matrix.py",
                "ml/gen2/evaluation/attribution.py",
                "scripts/parity/run_gen2_scenarios.py",
            },
            "V2 / 研究 / parity 禁用清单必须覆盖这 6 条路径",
        )
        for rel in V2_PATH_FORBIDDEN_ROLE_IMPL:
            path = ROOT / rel
            self.assertTrue(path.exists(), f"禁用清单中的文件不存在：{rel}")
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("build_daily_roles", text,
                             f"{rel} 不得引用 legacy 角色实现（V2 语义请用 build_v2_roles）")
            self.assertFalse(_imports_build_daily_roles(path), f"{rel} 仍有 legacy 导入")

    def test_zero_legacy_consumers_in_repo(self):
        consumers = set()
        for path in _py_files(ML_ROOT, PARITY_DIR):
            if path == LEGACY_IMPL_OWNER:
                continue  # 定义处不算消费者
            if _imports_build_daily_roles(path):
                consumers.add(_module_name(path))
        self.assertEqual(
            consumers, set(),
            f"仓库内不允许任何 legacy 角色实现消费者，实际发现：{sorted(consumers)}；"
            "角色语义请用 rule_v2_ab.build_v2_roles，需要展示列请用 v2_role_view.build_v2_role_view",
        )
        self.assertEqual(
            set(LEGACY_V1_CONSUMER_ALLOWLIST), set(),
            "LEGACY_V1_CONSUMER_ALLOWLIST 必须为空（legacy 实现已停用、零消费者）",
        )

    def test_legacy_impl_fails_fast(self):
        import pandas as pd
        from gen2.portfolio import role_engine

        rankings = pd.DataFrame([{
            "trade_date": "2026-01-05", "code": "NEW", "name": "NEW",
            "rank": 1, "rank_percentile": 1.0, "leadership_score": 90, "correlation_cluster": "new",
        }])
        with self.assertRaises(RuntimeError) as ctx:
            role_engine.build_daily_roles(rankings, config={"portfolio": {}})
        msg = str(ctx.exception)
        self.assertIn("build_v2_roles", msg, "错误信息必须指向 V2 权威实现")
        self.assertIn("v2_role_view", msg, "错误信息必须指向研究视图")

    def test_legacy_state_machine_code_is_removed(self):
        """legacy 状态机实现体必须已删除（避免死代码被再次复活/分叉）。"""
        src = LEGACY_IMPL_OWNER.read_text(encoding="utf-8")
        self.assertNotIn("proposed_role", src, "legacy 状态机的角色决策代码必须移除")
        self.assertNotIn("above_core_days", src, "legacy 状态机的 persistence 代码必须移除")
        self.assertIn("raise RuntimeError", src, "必须保留 fail-fast 守卫")

    def test_research_view_delegates_to_authoritative_impl(self):
        """研究视图只能委托权威实现，不得自带角色决策。"""
        path = ML_ROOT / "gen2" / "baseline" / "v2_role_view.py"
        src = path.read_text(encoding="utf-8")
        self.assertIn("from gen2.baseline.rule_v2_ab import build_v2_roles", src)
        self.assertIn("build_v2_roles(features, rankings, config, selection_scores=selection_scores)", src)
        self.assertIn("canonical_selection_scores", src,
                      "视图必须显式使用 canonical 评分入口（WP-G2-05）")
        for forbidden in ("proposed_role", "current_roles", "PROMOTION_CONFIRMED", "NO_CORE_TREND_GATE"):
            self.assertNotIn(forbidden, src, f"研究视图不得包含角色决策逻辑：{forbidden}")
        # 三个研究脚本必须改用视图
        for rel in ("ml/gen2/baseline/rule_rotation.py", "ml/gen2/baseline/sensitivity_matrix.py",
                    "ml/gen2/evaluation/attribution.py"):
            text = (ROOT / rel).read_text(encoding="utf-8")
            self.assertIn("build_v2_role_view", text, f"{rel} 必须改用权威视图")

    def test_d004_audit_code_appended_between_cap_and_finalize(self):
        """D-004：cap 降级审计码必须追加在 cap 之后、finalize 之前（与 JS 同序）。"""
        src = (ML_ROOT / "gen2" / "baseline" / "rule_v2_ab.py").read_text(encoding="utf-8")
        i_cap = src.index('day["role"] = _cap_core_roles(')
        i_audit = src.index('"|CLUSTER_CAP_DEMOTED"')
        i_final = src.index("finalize_roles(day, current_roles")
        self.assertLess(i_cap, i_audit, "CLUSTER_CAP_DEMOTED 必须在 cap 之后追加")
        self.assertLess(i_audit, i_final, "CLUSTER_CAP_DEMOTED 必须在 finalize_roles 之前追加")
        self.assertRegex(
            src,
            r"cap_demoted\s*=\s*\(day\[\"role_before_cap\"\]\s*==\s*\"CORE\"\)\s*&\s*\(day\[\"role\"\]\s*!=\s*\"CORE\"\)",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
