"""WP-G2-01 —— Gen-2 场景夹具的 Python 侧测试接缝。

覆盖：
  1. 夹具 schema 与三层结构（与 Node 侧同一份夹具）；
  2. 跑 Python 端 runner，校验**该端**全部已确认不变量；
  3. PENDING_SEAM 场景必须写明 deferred_to / deferred_reason；
  4. known_differences 每条必须带定位（location）与合法 status。

只读：不写库、不改规则、不部署。
运行：PYTHONPATH=ml python -m unittest gen2.tests.test_scenario_parity
"""
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "fixtures" / "gen2" / "golden_scenarios_v1.json"
RUNNER = ROOT / "scripts" / "parity" / "run_gen2_scenarios.py"

VALID_STATUS = {"ALIGNED", "EXPLAINED", "PENDING_RULING", "EXCLUDED_BY_DESIGN"}


def load_runner():
    spec = importlib.util.spec_from_file_location("gen2_scenario_runner", RUNNER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def get_path(obj, dotted: str):
    cur = obj
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


class TestScenarioParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.runner = load_runner()
        cls.observations = {"engine": "python", "scenarios": {}, "pending": []}
        for sc in cls.fixture["scenarios"]:
            if sc["status"] != "RUNNABLE":
                continue
            handler = cls.runner.HANDLERS[sc["handler"]]
            cls.observations["scenarios"][sc["id"]] = handler(sc)

    def test_fixture_layers_and_schema(self):
        meta = self.fixture["meta"]
        self.assertEqual(sorted(meta["layer_contract"].keys()), ["input", "invariants", "observations"])
        for sc in self.fixture["scenarios"]:
            for key in ("id", "title", "tier", "status", "seam"):
                self.assertTrue(sc.get(key), f"{sc.get('id')} 缺 {key}")
            self.assertTrue(sc["seam"]["python"] and sc["seam"]["js"])
            if sc["status"] == "RUNNABLE":
                self.assertTrue(sc.get("handler"))
                self.assertTrue(sc.get("input"))
                self.assertTrue(sc.get("invariants"))
            else:
                self.assertTrue(sc.get("deferred_to") and sc.get("deferred_reason"))

    def test_runner_covers_all_runnable(self):
        for sc in self.fixture["scenarios"]:
            if sc["status"] == "RUNNABLE":
                self.assertIn(sc["id"], self.observations["scenarios"], f"{sc['id']} 未产出")

    def test_confirmed_invariants_pass_on_python(self):
        checked = 0
        for sc in self.fixture["scenarios"]:
            node = self.observations["scenarios"].get(sc["id"])
            if node is None:
                continue
            for inv in sc["invariants"]:
                if inv["applies_to"] not in ("both", "python"):
                    continue
                case = node.get(inv["case"], {}) if inv.get("case") else node
                actual = get_path(case, inv["field"])
                op, val = inv["op"], inv.get("value")
                if op == "eq":
                    ok = actual == val
                elif op == "ne":
                    ok = actual != val
                elif op == "gte":
                    ok = isinstance(actual, (int, float)) and not isinstance(actual, bool) and actual >= val
                elif op == "lte":
                    ok = isinstance(actual, (int, float)) and not isinstance(actual, bool) and actual <= val
                elif op == "is_true":
                    ok = actual is True
                elif op == "is_false":
                    ok = actual is False
                elif op == "is_null":
                    ok = actual is None
                elif op == "not_null":
                    ok = actual is not None
                elif op == "contains":
                    ok = isinstance(actual, str) and str(val) in actual
                else:
                    raise AssertionError(f"unknown op {op}")
                self.assertTrue(
                    ok, f"不变量失败 {sc['id']}/{inv['id']}（python）：{inv['field']} {op} {val} → 实际 {actual!r}"
                )
                checked += 1
        self.assertGreater(checked, 0, "未校验任何不变量")

    def test_known_differences_are_located(self):
        for e in self.fixture.get("known_differences", []):
            self.assertIn(e["status"], VALID_STATUS, f"{e['id']} status 非法")
            self.assertNotEqual(e["status"], "ALIGNED")
            for key in ("id", "scenario", "status", "reason", "location"):
                self.assertTrue(e.get(key), f"差异登记 {e.get('id')} 缺 {key}")
            self.assertTrue(e.get("fields") or e.get("field"), f"{e['id']} 缺 fields")

    def test_resolved_differences_keep_audit_trail(self):
        scenario_ids = {s["id"] for s in self.fixture["scenarios"]}
        invariant_ids = {inv["id"] for s in self.fixture["scenarios"] for inv in s.get("invariants", [])}
        resolved = self.fixture.get("resolved_differences", [])
        self.assertTrue(resolved, "必须登记已结案差异（D-001）")
        for e in resolved:
            self.assertEqual(e["status"], "RESOLVED", f"{e['id']} 结案项 status 必须为 RESOLVED")
            for key in ("id", "scenario", "ruling", "fixed_in", "semantic_change"):
                self.assertTrue(e.get(key), f"结案项 {e.get('id')} 缺 {key}")
            self.assertIn(e["scenario"], scenario_ids)
            self.assertTrue(e.get("regression_invariants"), f"{e['id']} 必须登记回归不变量")
            for inv_id in e["regression_invariants"]:
                self.assertIn(inv_id, invariant_ids, f"{e['id']} 引用不存在的不变量 {inv_id}")

    def test_seam_contracts_declared(self):
        sc = self.fixture.get("seam_contracts", {})
        self.assertIn("roles_panel", sc)
        self.assertIn("canonical_input", sc["roles_panel"])
        self.assertIn("side_adapters", sc["roles_panel"])
        states = sc.get("run_status_gate", {}).get("states", {})
        for st in ("running", "completed", "blocked", "failed"):
            self.assertIn(st, states, f"四态契约缺 {st}")

    def test_pending_scenarios_declare_owner(self):
        for sc in self.fixture["scenarios"]:
            if sc["status"] == "RUNNABLE":
                continue
            self.assertTrue(sc["deferred_to"].startswith("WP-"), f"{sc['id']} deferred_to 非法")

    def test_no_pending_seam_and_no_pending_ruling(self):
        """WP-G2-03 收尾：不得再有 PENDING_SEAM 场景，也不得有 PENDING_RULING 差异。"""
        pending_seam = [s["id"] for s in self.fixture["scenarios"] if s["status"] != "RUNNABLE"]
        self.assertFalse(pending_seam, f"仍有 PENDING_SEAM 场景：{pending_seam}")
        pending_ruling = [e["id"] for e in self.fixture.get("known_differences", [])
                          if e["status"] == "PENDING_RULING"]
        self.assertFalse(pending_ruling, f"仍有 PENDING_RULING 差异：{pending_ruling}")

    def test_v2_role_authority_declared(self):
        mig = self.fixture.get("seam_contracts", {}).get("role_engine_migration", {})
        self.assertEqual(mig.get("authoritative"), "ml/gen2/baseline/rule_v2_ab.py::build_v2_roles",
                         "必须标明 V2 唯一权威角色实现")
        # legacy 独立状态机必须处于「已停用」而非「仍可用」
        self.assertEqual(mig.get("legacy", {}).get("status"), "DISABLED_FAIL_FAST")
        self.assertEqual(mig.get("legacy", {}).get("consumers"), [], "legacy 实现必须零消费者")
        self.assertIn("v2_role_view", mig.get("research_view", ""), "必须登记研究视图作为展示列来源")
        for rel in ("ml/gen2/baseline/rule_rotation.py", "ml/gen2/baseline/sensitivity_matrix.py",
                    "ml/gen2/evaluation/attribution.py", "scripts/parity/run_gen2_scenarios.py"):
            self.assertIn(rel, mig.get("blocked_v2_paths", []), f"{rel} 必须在禁用清单中")
        self.assertTrue(mig.get("work_item", "").startswith("WP-"), "迁移必须登记为明确工作项")

    def test_run_status_gate_order_declared(self):
        gate = self.fixture.get("seam_contracts", {}).get("run_status_gate", {})
        order = gate.get("gate_order", [])
        # WP-G2-05R：规则 bundle 闸门优先级最高（先于任何数据闸门）
        expect = ["RULE_BUNDLE_INCOMPLETE", "NAN_OR_MISSING_FIELD", "DUPLICATE_TRADE_DATE", "BENCHMARK_MISSING",
                  "BENCHMARK_INSUFFICIENT_HISTORY", "STALE_BATCH", "NO_ELIGIBLE_TODAY",
                  "UNIVERSE_INCOMPLETE", "PUBLISH_VALIDATION_FAILED"]
        self.assertEqual(len(order), len(expect), "闸门顺序条目数不符")
        for i, name in enumerate(expect):
            self.assertIn(name, order[i], f"闸门顺序第 {i + 1} 位应为 {name}")
        # RULE_BUNDLE_INCOMPLETE 必须是最先的闸门，且明确登记为 blocked reason
        self.assertTrue(any("RULE_BUNDLE_INCOMPLETE" in r for r in gate.get("rules", [])),
                        "rules 必须登记 RULE_BUNDLE_INCOMPLETE")

    def test_rule_bundle_scenario_declared(self):
        """WP-G2-05R：必须存在规则 bundle 闸门的跨端 blocked 回归场景。"""
        sc = next((s for s in self.fixture["scenarios"] if s["id"] == "G2S-09"), None)
        self.assertIsNotNone(sc, "缺 G2S-09（规则 bundle 闸门双端 blocked 回归）")
        self.assertEqual(sc["handler"], "rule_bundle_gate")
        self.assertEqual(sc["status"], "RUNNABLE")
        cases = {c["id"] for c in sc["input"]["cases"]}
        self.assertEqual(cases, {"missing_role_thresholds", "legacy_only_no_role_thresholds",
                                 "invalid_role_thresholds", "complete_role_thresholds",
                                 "trap_reads_missing_role_thresholds",
                                 "trap_reads_complete_role_thresholds"})
        fields = {inv["field"] for inv in sc["invariants"]}
        self.assertIn("status_reason", fields)
        self.assertIn("early_gate_data_gate", fields)
        self.assertIn("data_source_reads", fields)
        self.assertIn("data_source_trap_raised", fields)
        self.assertIn("bundle_selection_base", sc["input"])

    def test_g2s10_portfolio_build_declared(self):
        """WP-G2-06（F4）：必须存在统一候选组合构建的跨端**逐日**对表场景。"""
        sc = next((s for s in self.fixture["scenarios"] if s["id"] == "G2S-10"), None)
        self.assertIsNotNone(sc, "缺 G2S-10（统一候选组合构建跨端对表）")
        self.assertEqual(sc["handler"], "portfolio_build")
        self.assertEqual(sc["status"], "RUNNABLE")
        self.assertEqual({c["id"] for c in sc["input"]["cases"]}, {"undefended", "regime_path"})
        panel = sc["input"]["panel"]
        for key in ("roles", "priority", "benchmark", "portfolio_config", "defense_config"):
            self.assertIn(key, panel, "G2S-10 panel 缺 " + key)
        # priority 必须显式注入，且夹具**不含 rank 列**（无法回退 legacy rank）
        self.assertTrue(panel["priority"], "G2S-10 必须显式声明注入 score")
        self.assertFalse(any("rank" in r for r in panel["roles"]), "roles 不得携带 legacy rank")

        fields = {inv["field"] for inv in sc["invariants"]}
        # 对表不只比「有无腿」：每只 ETF / 现金 / 防守腿的权重、权重和、上限、priority、hash
        required = [
            "days.2026-03-02.weights.513310", "days.2026-03-02.weights.159570",
            "days.2026-03-02.cash_weight", "days.2026-03-02.weight_sum",
            "days.2026-03-03.cash_weight", "days.2026-03-03.weight_sum",
            "days.2026-03-02.priority.159582", "days.2026-03-02.priority.CASH",
            "days.2026-03-03.defense_weight", "days.2026-03-03.weights.513310",
            "max_single_seen", "max_cluster_seen", "max_tech_seen",
            "sleeve", "final_target_present", "priority_hash", "config_hash",
            "priority_source_all_injected",
        ]
        for needle in required:
            self.assertIn(needle, fields, "G2S-10 对表口径缺 " + needle)

    def test_rule_bundle_order_proof_cases_declared(self):
        """裁决追加验证：G2S-09 必须带「数据源一读就抛错」的顺序证明 case（主控 + 正控）。"""
        sc = next(s for s in self.fixture["scenarios"] if s["id"] == "G2S-09")
        cases = {c["id"]: c for c in sc["input"]["cases"]}
        trap = [c for c in cases.values() if c.get("trap_reads")]
        self.assertEqual(len(trap), 2, "必须成对声明 trap_reads 主控 + 正控")
        main = cases.get("trap_reads_missing_role_thresholds")
        ctrl = cases.get("trap_reads_complete_role_thresholds")
        self.assertIsNotNone(main, "缺顺序证明主控 case")
        self.assertIsNotNone(ctrl, "缺顺序证明正控 case")
        # 主控必须用**完整横截面**：空数据下「拿到 RULE_BUNDLE_*」不足以证明「先于读取」，
        # 必须给定可用数据仍零读取，才是顺序证据。
        self.assertEqual(main["data"], "full_panel")
        self.assertEqual(ctrl["data"], "full_panel")
        self.assertTrue((ctrl.get("bundle_selection_overrides") or {}).get("role_thresholds"),
                        "正控必须补上显式 role_thresholds（否则闸门再早也不会放行）")
        inv = sc["invariants"]
        must = [
            ("trap_reads_missing_role_thresholds", "status", "eq", "blocked"),
            ("trap_reads_missing_role_thresholds", "status_reason", "eq", "RULE_BUNDLE_INCOMPLETE"),
            ("trap_reads_missing_role_thresholds", "data_source_reads", "eq", 0),
            ("trap_reads_missing_role_thresholds", "data_source_trap_raised", "is_false", None),
            ("trap_reads_complete_role_thresholds", "status", "eq", "failed"),
            ("trap_reads_complete_role_thresholds", "status_reason", "eq", "SYSTEM_ERROR"),
            ("trap_reads_complete_role_thresholds", "data_source_trap_raised", "is_true", None),
        ]
        for case, field, op, value in must:
            hit = [i for i in inv
                   if i.get("case") == case and i.get("field") == field and i.get("op") == op]
            self.assertTrue(hit, f"缺顺序证明不变量：{case}/{field}/{op}")
            if value is not None:
                self.assertEqual(hit[0].get("value"), value,
                                 f"{case}/{field} 期望值不符")


if __name__ == "__main__":
    unittest.main()
