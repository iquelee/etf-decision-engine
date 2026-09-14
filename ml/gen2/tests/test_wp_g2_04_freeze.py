"""WP-G2-04 验收边界 —— Gen-2 Rule V2 bundle/lock **重新冻结**（冻结一致性门禁）。

裁决（2026-09-14，PR #29 合并后）：**只做冻结，不部署**。四件事逐条固化为可执行断言：

  1. **离线迁移**：旧字段（``core_pct`` / ``challenger_pct`` / ``satellite_pct`` / ``top_quantile``）
     一次性换算为显式 ``selection.role_thresholds``，语义等价（不是调参）；
  2. **重建 bundle 与 lock**：``bundle_version`` 升为 ``gen2-rule-v2.0.1``，新 lock 与 bundle 同版；
  3. **lock 覆盖范围**：bundle SHA + JS 实现哈希 + Python 规则/候选/防守实现哈希 + 构建产物哈希；
  4. **构建产物与锁逐位一致**：由 ``scripts/verify-gen2-build-artifacts.js``（Stage F）负责，
     本文件只断言 lock 的声明自洽（每条产物的 ``must_equal`` 指向存在的冻结条目）。

另含两条「防遗忘」断言（都是真出过问题的形态）：

  * 冻结后 ``evaluate_rule_bundle_gate`` 必须用**真实冻结 bundle** 判 **completed**
    —— 即 WP-G2-04 确实解除了 ``blocked / RULE_BUNDLE_INCOMPLETE``（fail-closed 中间态的出口）；
  * ``scripts/verify-immutable.js`` 的 ROOT_ANCHORS 中该 lock 的 SHA 必须与磁盘锁**同步**
    —— 否则「重新封印」会因自锚失配而全量 FAIL（这是有意的审批动作，不是可忘的细节）。

运行::

    PYTHONPATH=ml python -m unittest ml.gen2.tests.test_wp_g2_04_freeze
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import unittest
from pathlib import Path

_here = Path(__file__).resolve()
ROOT = next(p for p in _here.parents if (p / "ml" / "gen2").is_dir())
sys.path.insert(0, str(ROOT / "ml"))

from gen2.data.loader import load_gen2_config  # noqa: E402
from gen2.data.run_gate import evaluate_rule_bundle_gate  # noqa: E402
from gen2.portfolio.role_thresholds import (  # noqa: E402
    DEFAULT_ROLE_THRESHOLDS,
    load_role_thresholds,
)

BUNDLE_REL = "ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json"
LOCK_REL = "ml/gen2/manifests/GEN2_RULE_V2_LOCK.json"
VERIFIER_REL = "scripts/verify-immutable.js"

LEGACY_FIELDS = ("core_pct", "challenger_pct", "satellite_pct", "top_quantile")

#: 迁移前 v2.0 的参数快照（迁移**不得**改动其中任何一项）
V20_PARAMS = {
    "alpha": {"trend": 0.3333333333, "rs": 0.3333333333, "breakout": 0.3333333333},
    "regime": {"risk_on_ge": 55, "risk_off_le": 45},
    "portfolio": {
        "max_single_weight": 0.25,
        "max_cluster_weight": 0.40,
        "max_tech_weight": 0.65,
        "tech_clusters": ["tech_hardware", "software_ai"],
    },
    "defense": {
        "risk_off_exposure_scale": 0.50,
        "risk_off_hedge_weight": 0.15,
        "hedge_code": "518880",
        "vol_target_enabled": True,
        "vol_target_annualized": 0.17,
    },
    "universe_version": "universe_v1",
    "benchmark_code": "510300",
    "selection_rest": {
        "promotion_persistence_days": 5,
        "demotion_persistence_days": 5,
        "max_core_count": 5,
        "max_core_per_cluster": 2,
        "min_replacement_edge": 8.0,
    },
}


def normalized_sha256(rel: str) -> str:
    """与 verify-immutable.js / freeze-gen2-rule-bundle.py 同口径（CRLF→LF 后 sha256）。"""
    text = (ROOT / rel).read_bytes().decode("utf-8").replace("\r\n", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def derive_from_legacy(audit: dict) -> dict:
    """旧字段 → role_thresholds（与 JS ``deriveRoleThresholdsFromLegacy`` 同式）。"""
    core = 1.0 - float(audit["top_quantile"])
    return {
        "core_top_fraction": round((1.0 - core) * 1e10) / 1e10,
        "challenger_top_fraction": round((1.0 - float(audit["challenger_pct"])) * 1e10) / 1e10,
        "satellite_top_fraction": round((1.0 - float(audit["satellite_pct"])) * 1e10) / 1e10,
    }


class WpG204FreezeTest(unittest.TestCase):
    """WP-G2-04：bundle/lock 重新冻结的一致性门禁。"""

    @classmethod
    def setUpClass(cls):
        cls.bundle = json.loads((ROOT / BUNDLE_REL).read_text(encoding="utf-8"))
        cls.lock = json.loads((ROOT / LOCK_REL).read_text(encoding="utf-8"))
        cls.selection = dict(cls.bundle["selection"])

    # ---------------- 1. bundle / lock 同版 ----------------

    def test_bundle_version_bumped_and_matches_lock(self):
        self.assertEqual(self.bundle["bundle_version"], "gen2-rule-v2.0.1")
        self.assertEqual(self.lock["bundle_version"], self.bundle["bundle_version"])
        self.assertNotEqual(self.bundle["bundle_version"], "gen2-rule-v2.0",
                            "迁移必须升 bundle_version（禁止静默改旧锁覆盖的同一版本）")
        self.assertEqual(self.lock["engine_id"], self.bundle["engine_id"])

    def test_lock_bundle_sha_matches_disk(self):
        self.assertEqual(self.lock["bundle_sha256"], normalized_sha256(BUNDLE_REL))

    # ---------------- 2. 迁移语义 ----------------

    def test_role_thresholds_present_and_equal_to_defaults(self):
        rt = self.selection.get("role_thresholds")
        self.assertIsInstance(rt, dict, "冻结 bundle 必须自带 selection.role_thresholds")
        self.assertEqual(rt, dict(DEFAULT_ROLE_THRESHOLDS))

    def test_legacy_fields_left_runtime_section_but_kept_for_audit(self):
        for f in LEGACY_FIELDS:
            self.assertNotIn(f, self.selection,
                             f"旧字段 {f} 不得留在运行 selection 段（必须移入 legacy_migration_audit）")
        audit = self.selection.get("legacy_migration_audit") or {}
        self.assertEqual(audit.get("core_pct"), 0.8)
        self.assertEqual(audit.get("challenger_pct"), 0.7)
        self.assertEqual(audit.get("satellite_pct"), 0.6)
        self.assertEqual(audit.get("top_quantile"), 0.2)
        self.assertEqual(audit.get("status"), "MIGRATION_AUDIT_ONLY")

    def test_migration_formula_agrees_cross_language(self):
        """烘焙值必须逐值等于「旧字段按同一公式换算」的结果（不是手写/拍脑袋的数）。"""
        audit = self.selection["legacy_migration_audit"]
        self.assertEqual(derive_from_legacy(audit), self.selection["role_thresholds"])

    def test_role_thresholds_match_research_yaml(self):
        """bundle 侧与 gen2.yaml 侧不能悄悄漂移。"""
        yaml_t = load_role_thresholds(load_gen2_config())
        for k, v in DEFAULT_ROLE_THRESHOLDS.items():
            self.assertAlmostEqual(self.selection["role_thresholds"][k], getattr(yaml_t, k), places=12,
                                   msg=f"{k} 在 bundle 与 gen2.yaml 之间漂移")

    # ---------------- 3. 参数未变（迁移不是调参） ----------------

    def test_no_parameter_drift_versus_v20(self):
        self.assertEqual(self.bundle["alpha"], V20_PARAMS["alpha"])
        self.assertEqual(self.bundle["regime"], V20_PARAMS["regime"])
        self.assertEqual(self.bundle["portfolio"], V20_PARAMS["portfolio"])
        self.assertEqual(self.bundle["defense"], V20_PARAMS["defense"])
        self.assertEqual(self.bundle["universe_version"], V20_PARAMS["universe_version"])
        self.assertEqual(self.bundle["benchmark_code"], V20_PARAMS["benchmark_code"])
        for k, v in V20_PARAMS["selection_rest"].items():
            self.assertEqual(self.selection.get(k), v, f"selection.{k} 被迁移改动")

    # ---------------- 4. lock 覆盖范围 ----------------

    def test_immutable_set_covers_five_required_files(self):
        entries = self.lock.get("immutable_set") or []
        self.assertEqual(len(entries), 5, "lock 必须覆盖 bundle + JS 实现 + Python 规则/候选/防守")
        self.assertEqual(
            sorted(e["id"] for e in entries),
            ["bundle", "js_implementation", "python_candidate", "python_defense", "python_rule"])

    def test_immutable_set_shas_match_disk(self):
        for e in self.lock["immutable_set"]:
            path = ROOT / e["file"]
            self.assertTrue(path.is_file(), f"冻结集合文件缺失：{e['file']}")
            self.assertEqual(normalized_sha256(e["file"]), e["sha256"],
                             f"{e['id']}（{e['file']}）SHA 与 lock 不一致")
        ids = {e["id"]: e["sha256"] for e in self.lock["immutable_set"]}
        self.assertEqual(self.lock["bundle_sha256"], ids["bundle"])

    def test_build_artifacts_declared_and_mirror_frozen_entries(self):
        arts = self.lock.get("build_artifacts") or []
        self.assertEqual(len(arts), 2, "构建产物须声明 2 项（云函数 bundle + 云函数 index.js）")
        ids = {e["id"]: e["sha256"] for e in self.lock["immutable_set"]}
        for a in arts:
            self.assertIn(a["must_equal"], ids, f"{a['id']} 的镜像目标必须在 immutable_set 内")
            self.assertEqual(a["sha256"], ids[a["must_equal"]],
                             f"{a['id']} 的预期 SHA 必须等于其镜像的冻结源 SHA")
            self.assertTrue(str(a["file"]).startswith("dist-functions/runGen2ShadowEod/"),
                            f"构建产物须位于云函数发布目录：{a['file']}")
        self.assertEqual({a["id"] for a in arts}, {"dist_bundle", "dist_index"})

    # ---------------- 5. 冻结的**目的**：规则闸门解除 ----------------

    def test_frozen_bundle_satisfies_rule_bundle_gate(self):
        """WP-G2-04 的目的本身：真实冻结 bundle 必须让规则闸门判 completed。"""
        rb = evaluate_rule_bundle_gate({"selection": dict(self.selection)})
        self.assertEqual(rb["status"], "completed", rb)
        self.assertIsNone(rb["status_reason"])
        self.assertIsNone(rb["data_gate"])
        self.assertEqual(rb["rule_bundle_status"], "COMPLETE")
        self.assertAlmostEqual(rb["role_thresholds"]["core_top_fraction"], 0.20, places=12)

    def test_frozen_bundle_thresholds_load_with_equivalent_cutpoints(self):
        t = load_role_thresholds({"selection": dict(self.selection)})
        self.assertAlmostEqual(t.core_pct, 0.80, places=12)
        self.assertAlmostEqual(t.challenger_pct, 0.70, places=12)
        self.assertAlmostEqual(t.satellite_pct, 0.60, places=12)

    # ---------------- 6. 防遗忘：自锚同步 ----------------

    def test_lock_root_anchor_in_verifier_is_in_sync(self):
        """verify-immutable.js 的 ROOT_ANCHORS 必须同步为**当前** lock 的 SHA。

        重新封印是有意的显式动作（PR diff 醒目）；忘了同步 → 全量 immutable FAIL。
        这条断言把「忘了同步」在 Stage B 就抓出来，而不是等到 Stage C。
        """
        src = (ROOT / VERIFIER_REL).read_text(encoding="utf-8")
        pat = re.compile(r"lock:\s*'" + re.escape(LOCK_REL) + r"'\s*,\s*sha256:\s*'([0-9a-f]{64})'")
        m = pat.search(src)
        self.assertIsNotNone(m, f"{VERIFIER_REL} 的 ROOT_ANCHORS 未登记 {LOCK_REL}")
        self.assertEqual(m.group(1), normalized_sha256(LOCK_REL),
                         "ROOT_ANCHORS 中该 lock 的 SHA 与磁盘锁不一致（重新封印后必须同步更新）")


if __name__ == "__main__":
    unittest.main(verbosity=2)
