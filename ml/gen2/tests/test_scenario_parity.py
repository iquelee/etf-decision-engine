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

    def test_pending_scenarios_declare_owner(self):
        for sc in self.fixture["scenarios"]:
            if sc["status"] == "RUNNABLE":
                continue
            self.assertTrue(sc["deferred_to"].startswith("WP-"), f"{sc['id']} deferred_to 非法")


if __name__ == "__main__":
    unittest.main()
