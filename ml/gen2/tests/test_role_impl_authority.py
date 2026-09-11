"""角色语义权威性守卫（WP-G2-03 剩余切片）。

背景（用户裁决 2026-09-11）：
  * **V2 唯一权威角色实现 = ``gen2.baseline.rule_v2_ab.build_v2_roles``**
    （B1 账本 / B3 OOS / 360 行 parity 的实际使用者，且唯一含 NO_CORE 硬门槛与 Selection Permission）。
  * ``gen2.portfolio.role_engine.build_daily_roles`` 标为 **LEGACY_V1_ONLY**，不得再作为任何
    V2 回测 / 敏感性 / 归因 / 生产 parity 的独立角色实现。
  * 本包只阻断 V2 路径误用 + 增加调用源测试；研究脚本迁移登记为 WP-G2-05。

覆盖：
  1. 权威实通常量与实现可导入；
  2. V2 路径（rule_v2_ab / rule_v21_ab / parity runner）**不得**引用 legacy 角色实现；
  3. legacy 消费者的调用源必须与 ``LEGACY_V1_CONSUMER_ALLOWLIST`` 完全一致（新增消费者即失败）；
  4. D-004 审计码（CLUSTER_CAP_DEMOTED）在 rule_v2_ab 的追加位置正确（cap 之后、finalize 之前）。
"""
from __future__ import annotations

import ast
import re
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


def _module_name(path: Path) -> str:
    """文件路径 → 模块名（ml/ 下按包名，其余用相对路径）。"""
    try:
        rel = path.relative_to(ML_ROOT)
    except ValueError:
        return str(path.relative_to(ROOT)).replace("/", ".").replace("\\", ".").removesuffix(".py")
    return str(rel).replace("/", ".").replace("\\", ".").removesuffix(".py")


def _imports_build_daily_roles(path: Path) -> bool:
    """AST 级判定：是否从 role_engine 导入 build_daily_roles（或别名导入）。"""
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
        from gen2.baseline.rule_v2_ab import build_v2_roles  # noqa: F401
        self.assertTrue(callable(build_v2_roles), "权威实现必须可导入")

    def test_v2_paths_do_not_reference_legacy_role_impl(self):
        for rel in V2_PATH_FORBIDDEN_ROLE_IMPL:
            path = ROOT / rel
            self.assertTrue(path.exists(), f"V2 路径文件不存在：{rel}")
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("build_daily_roles", text,
                             f"{rel} 不得引用 legacy 角色实现 build_daily_roles（V2 语义请用 build_v2_roles）")
            self.assertFalse(_imports_build_daily_roles(path), f"{rel} 仍有 legacy 导入")

    def test_legacy_consumers_match_allowlist_exactly(self):
        consumers = set()
        for path in _py_files(ML_ROOT, PARITY_DIR):
            if _imports_build_daily_roles(path):
                consumers.add(_module_name(path))
        unexpected = consumers - set(LEGACY_V1_CONSUMER_ALLOWLIST)
        self.assertFalse(
            unexpected,
            f"出现未登记的 legacy 角色实现消费者：{sorted(unexpected)}；"
            "V2 语义请使用 rule_v2_ab.build_v2_roles，若确属 V1 分析路径请显式加入 LEGACY_V1_CONSUMER_ALLOWLIST",
        )
        stale = set(LEGACY_V1_CONSUMER_ALLOWLIST) - consumers
        self.assertFalse(stale, f"白名单中的消费者已不存在（请清理，避免白名单腐烂）：{sorted(stale)}")

    def test_d004_audit_code_appended_between_cap_and_finalize(self):
        """D-004：cap 降级审计码必须追加在 cap 之后、finalize 之前（与 JS 同序）。"""
        src = (ML_ROOT / "gen2" / "baseline" / "rule_v2_ab.py").read_text(encoding="utf-8")
        i_cap = src.index('day["role"] = _cap_core_roles(')
        i_audit = src.index('"|CLUSTER_CAP_DEMOTED"')
        i_final = src.index("finalize_roles(day, current_roles")
        self.assertLess(i_cap, i_audit, "CLUSTER_CAP_DEMOTED 必须在 cap 之后追加")
        self.assertLess(i_audit, i_final, "CLUSTER_CAP_DEMOTED 必须在 finalize_roles 之前追加")
        # 条件必须与 JS 同判：pre-cap CORE 且 cap 后非 CORE
        self.assertRegex(src, r"cap_demoted\s*=\s*\(day\[\"role_before_cap\"\]\s*==\s*\"CORE\"\)\s*&\s*\(day\[\"role\"\]\s*!=\s*\"CORE\"\)")

    def test_legacy_impl_is_flagged_legacy_in_docstring(self):
        src = (ML_ROOT / "gen2" / "portfolio" / "role_engine.py").read_text(encoding="utf-8")
        self.assertIn("LEGACY · V1-ONLY", src, "legacy 实现必须在 docstring 中显式标注")
        self.assertRegex(src, r"warnings\.warn\(", "legacy 实现必须发弃用告警")


if __name__ == "__main__":
    unittest.main(verbosity=2)
