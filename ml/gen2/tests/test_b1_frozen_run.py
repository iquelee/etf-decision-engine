"""WP-G2-04 / B1 冻结运行（Frozen Run）验收边界。

裁决（2026-09-14）：B1 必须**以 `gen2-rule-v2.0.1` 的 bundle/实现锁为唯一输入**，
输出隔离的新 run ID 与完整 manifest。本文件把「唯一输入」这句话固化为可执行断言：

  1. **锁 ↔ 磁盘**：8 项 `immutable_set` + 2 项 `build_artifacts` 声明 + `ROOT_ANCHORS`
     自锚全部一致才能运行；任一失配 → `FrozenAttestationError`（fail-closed，不降级）；
  2. **配置零漂移**：冻结 bundle 的每个规则键都必须与运行配置逐值一致，
     否则拒绝运行（不存在「bundle 一份、yaml 一份、谁先谁赢」的隐式口径）；
  3. **跨实现常量交叉核对**：`bundle.regime` 55/45 必须等于 `portfolio/regime.py` 常量，
     `bundle.alpha` 必须等于 canonical Alpha 权重；
  4. **隔离 run ID**：由 `bundle_version` 派生，与旧 run ID 不同名（旧报告只作审计基线）。

另按 2026-09-14 第二次裁决补齐四类哈希的**记录与校验**（`RunInputHashTest`）：
最终 LOCK SHA + 完整组件哈希；运行侧实现（入口 / 账本 / 费用）哈希；输入行情与 ETF 主数据的
内容哈希 + 日期范围 + 环境版本；输出报告与指标文件哈希（`self_check` 逐项重算）。

端到端跑 `run()` 需要本地日线池（未入库），在 CI 跳过 —— 与 `test_b1_baseline_contract`
同策略：**显式跳过而不是伪造通过**。

运行::

    PYTHONPATH=ml python -m unittest ml.gen2.tests.test_b1_frozen_run
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

_here = Path(__file__).resolve()
ROOT = next(p for p in _here.parents if (p / "ml" / "gen2").is_dir())
sys.path.insert(0, str(ROOT / "ml"))

from gen2.baseline import b1_frozen_run as B  # noqa: E402
from gen2.data.loader import load_gen2_config  # noqa: E402

OLD_RUN_ID = "b1_ledger_baseline_20260911"


def _b1_dataset_available() -> bool:
    try:
        from gen2.data.loader import load_daily_bars
        bars = load_daily_bars(validate=False)
        return bars is not None and len(bars) > 0
    except Exception:  # noqa: BLE001
        return False


class FrozenAttestationTest(unittest.TestCase):
    """① 锁 ↔ 磁盘：唯一输入必须真的被锁住。"""

    @classmethod
    def setUpClass(cls):
        cls.attest = B.verify_frozen_lock()
        cls.bundle = json.loads(B._abs(B.BUNDLE_REL).read_text(encoding="utf-8"))

    def test_all_eight_frozen_objects_match_disk(self):
        entries = self.attest["immutable_set"]
        self.assertEqual(len(entries), 8)
        self.assertEqual(
            sorted(e["id"] for e in entries),
            ["bundle", "js_implementation", "python_candidate", "python_defense",
             "python_regime", "python_role_thresholds", "python_rule", "python_selection_scores"])
        for e in entries:
            self.assertTrue(e["match"], f"{e['id']}（{e['file']}）SHA 与锁不一致")

    def test_role_thresholds_contract_is_part_of_the_input(self):
        """B1 的唯一输入必须包含阈值加载/校验契约 —— 否则它可以在 bundle 不变时改语义。"""
        files = {e["file"] for e in self.attest["immutable_set"]}
        self.assertIn("ml/gen2/portfolio/role_thresholds.py", files)

    def test_selection_scores_and_regime_are_part_of_the_input(self):
        """lock_revision 3：显式 Alpha 实现与统一 regime 契约同样是 B1 的唯一输入。"""
        files = {e["file"] for e in self.attest["immutable_set"]}
        self.assertIn("ml/gen2/baseline/selection_scores.py", files)
        self.assertIn("ml/gen2/portfolio/regime.py", files)

    def test_build_artifacts_declared_and_consistent(self):
        arts = self.attest["build_artifacts"]
        self.assertEqual({a["id"] for a in arts}, {"dist_bundle", "dist_index"})
        for a in arts:
            self.assertTrue(a["declared_match_mirror"], f"{a['id']} 声明与其镜像冻结源不一致")

    def test_root_anchor_in_sync(self):
        self.assertTrue(self.attest["root_anchor_in_sync"])
        self.assertEqual(self.attest["lock_revision"], 3)
        self.assertEqual(self.attest["bundle_version"], "gen2-rule-v2.0.1")

    def test_tampered_frozen_file_refuses_to_run(self):
        """反例：任一冻结对象 SHA 被改动 → 拒绝运行（不是打警告继续）。"""
        real = B.normalized_sha256
        B.normalized_sha256 = lambda p: ("0" * 64) if "role_thresholds" in str(p) else real(p)
        try:
            with self.assertRaises(B.FrozenAttestationError) as ctx:
                B.verify_frozen_lock()
        finally:
            B.normalized_sha256 = real
        self.assertIn("python_role_thresholds", str(ctx.exception))

    def test_stale_root_anchor_refuses_to_run(self):
        """反例：重新封印后忘了同步 ROOT_ANCHORS → 同样拒绝运行。"""
        import re

        real_verifier = B.VERIFIER_REL
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "verify-immutable.js"
            src = B._abs(real_verifier).read_text(encoding="utf-8")
            # 把该 lock 的锚点改成全 0（模拟「忘记同步」）
            src = re.sub(
                r"(lock:\s*'" + re.escape(B.LOCK_REL) + r"'\s*,\s*sha256:\s*')[0-9a-f]{64}(')",
                r"\g<1>" + "0" * 64 + r"\g<2>", src)
            fake.write_text(src, encoding="utf-8")
            B.VERIFIER_REL = str(fake)
            try:
                with self.assertRaises(B.FrozenAttestationError) as ctx:
                    B.verify_frozen_lock()
            finally:
                B.VERIFIER_REL = real_verifier
        self.assertIn("ROOT_ANCHORS", str(ctx.exception))


class ConfigAttestationTest(unittest.TestCase):
    """②③ 配置与跨实现常量：bundle 是权威，不一致就拒绝。"""

    @classmethod
    def setUpClass(cls):
        cls.bundle = json.loads(B._abs(B.BUNDLE_REL).read_text(encoding="utf-8"))
        cls.base = load_gen2_config()

    def test_repo_config_has_zero_drift_against_frozen_bundle(self):
        _cfg, att = B.derive_config(self.bundle, self.base)
        self.assertEqual(att["drift"], [], "研究配置与冻结 bundle 出现漂移，必须先对齐再做 B1")
        self.assertEqual(att["cross_checks"], [], "跨实现常量与冻结 bundle 不一致")
        self.assertEqual(att["config_source"], "FROZEN_BUNDLE_OVERLAY")

    def test_rule_map_covers_the_rule_bearing_keys(self):
        keys = {r["key"] for r in B.derive_config(self.bundle, self.base)[1]["rule_map"]}
        for must in ("portfolio.max_tech_weight", "portfolio.role_thresholds",
                     "portfolio.defense.hedge_code", "data.benchmark_code", "universe.version",
                     "portfolio.max_core_count", "portfolio.promotion_persistence_days"):
            self.assertIn(must, keys, f"规则键 {must} 未纳入配置核验")

    def test_config_change_is_refused_not_silently_overridden(self):
        """反例：把研究配置改脏 → 拒绝运行（不能悄悄以 bundle 覆盖了事）。"""
        dirty = json.loads(json.dumps(self.base))
        dirty["portfolio"]["max_tech_weight"] = 0.99
        with self.assertRaises(B.FrozenAttestationError) as ctx:
            B.derive_config(self.bundle, dirty)
        self.assertIn("portfolio.max_tech_weight", str(ctx.exception))

    def test_non_strict_mode_overlays_bundle_as_authority(self):
        """`strict=False` 时 bundle 覆盖配置，且漂移被如实记录（供诊断用）。"""
        dirty = json.loads(json.dumps(self.base))
        dirty["portfolio"]["max_tech_weight"] = 0.99
        cfg, att = B.derive_config(self.bundle, dirty, strict=False)
        self.assertEqual(cfg["portfolio"]["max_tech_weight"],
                         self.bundle["portfolio"]["max_tech_weight"])
        self.assertEqual(len(att["drift"]), 1)
        self.assertEqual(att["drift"][0]["key"], "portfolio.max_tech_weight")

    def test_regime_impl_constant_cross_check_is_real(self):
        """反例：bundle 的 regime 与 `regime.py` 常量不一致 → 拒绝运行。"""
        bad = json.loads(json.dumps(self.bundle))
        bad["regime"]["risk_on_ge"] = 60
        with self.assertRaises(B.FrozenAttestationError) as ctx:
            B.derive_config(bad, self.base)
        self.assertIn("regime.risk_on_ge", str(ctx.exception))

    def test_alpha_cross_check_is_real(self):
        bad = json.loads(json.dumps(self.bundle))
        bad["alpha"]["trend"] = 0.5
        with self.assertRaises(B.FrozenAttestationError) as ctx:
            B.derive_config(bad, self.base)
        self.assertIn("alpha.trend", str(ctx.exception))

    def test_missing_rule_key_in_bundle_is_refused(self):
        bad = json.loads(json.dumps(self.bundle))
        bad["defense"].pop("hedge_code")
        with self.assertRaises(B.FrozenAttestationError) as ctx:
            B.derive_config(bad, self.base)
        self.assertIn("hedge_code", str(ctx.exception))


class RunIdTest(unittest.TestCase):
    """④ 隔离 run ID：与旧基线不同名，旧报告降为审计基线。"""

    def setUp(self):
        self.bundle = json.loads(B._abs(B.BUNDLE_REL).read_text(encoding="utf-8"))

    def test_run_id_is_isolated_from_old_baseline(self):
        rid = B.frozen_run_id(self.bundle, "20260914")
        self.assertEqual(rid, "b1_ledger_baseline_20260914_frozen_v201")
        self.assertNotEqual(rid, OLD_RUN_ID)

    def test_run_id_tracks_bundle_version(self):
        bumped = json.loads(json.dumps(self.bundle))
        bumped["bundle_version"] = "gen2-rule-v2.0.2"
        self.assertIn("v202", B.frozen_run_id(bumped, "20260914"))


class RunInputHashTest(unittest.TestCase):
    """②③④ 裁决补齐：运行实现 / 输入数据 / 输出 的哈希必须被记录且可复核。"""

    def test_run_implementation_covers_entry_ledger_and_cost(self):
        impl = B.implementation_attestation()
        by_id = {e["id"]: e for e in impl}
        self.assertEqual(sorted(by_id),
                         ["b1_frozen_run", "baseline_builder", "cost_impl", "ledger"])
        for want_id, want_file in (("b1_frozen_run", "ml/gen2/baseline/b1_frozen_run.py"),
                                   ("baseline_builder", "ml/gen2/baseline/rebuild_baselines.py"),
                                   ("ledger", "ml/gen2/backtest/ledger.py"),
                                   ("cost_impl", "ml/gen2/backtest/costs.py")):
            e = by_id[want_id]
            self.assertEqual(e["file"], want_file)
            self.assertTrue(e["exists"], f"{want_id} 文件缺失")
            self.assertEqual(len(e["sha256"] or ""), 64, f"{want_id} 未取到 SHA")

    def test_lock_component_digest_covers_all_components(self):
        """完整组件哈希 → 折叠摘要必须真的覆盖 8 项（改任一项摘要就变）。"""
        att = B.verify_frozen_lock()
        digest = att["lock_component_digest"]
        self.assertEqual(len(digest), 64)
        pairs = [(e["id"], e["actual"]) for e in att["immutable_set"]]
        self.assertEqual(digest, B._aggregate_digest(pairs))
        tampered = [(e["id"], ("0" * 64) if e["id"] == "bundle" else e["actual"])
                    for e in att["immutable_set"]]
        self.assertNotEqual(digest, B._aggregate_digest(tampered),
                            "组件摘要对单项改动不敏感 → 不可作为完整性锚点")

    def test_environment_version_is_recorded(self):
        env = B.environment_version()
        for k in ("python", "pandas", "numpy", "platform", "python_implementation"):
            self.assertIn(k, env)
            self.assertTrue(env[k])

    def test_input_attestation_hashes_and_date_range(self):
        if not _b1_dataset_available():
            raise unittest.SkipTest("本地 Gen-2 日线池不可用 → 输入哈希在 CI 跳过")
        att = B.input_data_attestation(load_gen2_config())
        self.assertTrue(att["files"], "输入行情未取到任何文件")
        self.assertEqual(att["date_range"]["first_date"],
                         min(f["first_date"] for f in att["files"]))
        self.assertEqual(att["date_range"]["last_date"],
                         max(f["last_date"] for f in att["files"]))
        self.assertEqual(att["rows_total"], sum(f["rows"] for f in att["files"]))
        for f in att["files"]:
            self.assertEqual(len(f["sha256"]), 64, f"{f['code']} 未取到内容哈希")
        self.assertEqual({e["id"] for e in att["meta_files"]},
                         {"etf_master", "universe_definition"})
        self.assertEqual(len(att["content_digest"]), 64)

    def test_verify_manifest_detects_tampered_hash(self):
        """反例：manifest 里任一哈希被改 → 自校验必须报 not all_pass（不是默认通过）。"""
        att = B.verify_frozen_lock()
        env = B.environment_version()
        inputs = B.input_data_attestation(load_gen2_config()) if _b1_dataset_available() else {
            "daily_dir": "x", "codes": [], "rows_total": 0,
            "date_range": {"first_date": None, "last_date": None},
            "files": [], "meta_files": [], "content_digest": "0" * 64,
        }
        m = {
            "frozen_input": {
                "lock": {"lock_file": att["lock_file"], "lock_sha256": att["lock_sha256"]},
                "immutable_set": att["immutable_set"],
                "lock_component_digest": att["lock_component_digest"],
            },
            "run_implementation": B.implementation_attestation(),
            "environment": env,
            "input_data": inputs,
            "run_dir": "ml/gen2/outputs/__none__",
            "artifacts": [],
        }
        self.assertTrue(B.verify_manifest(m)["all_pass"], B.verify_manifest(m)["detail"])
        m["frozen_input"]["lock"]["lock_sha256"] = "0" * 64
        res = B.verify_manifest(m)
        self.assertFalse(res["all_pass"])
        self.assertEqual(res["detail"][0]["check"], "lock.sha256")


class FrozenRunEndToEndTest(unittest.TestCase):
    """端到端：真跑 `run()`，校验隔离 run ID + 完整 manifest + 资金守恒。"""

    def setUp(self):
        if not _b1_dataset_available():
            raise unittest.SkipTest(
                "本地 Gen-2 日线池（deliverables/etf_daily_ml_pool，未入库）不可用 → "
                "B1 冻结运行端到端在 CI 跳过；「唯一输入」的核验门由上面三个 TestCase 用真实锁强制。")

    def test_run_writes_isolated_artifacts_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            # 裁剪窗口 + 单费用档（CI 可承受）；门禁断言与全量运行一致
            r = B.run(date_tag="20260914", report_dir=Path(tmp) / "rep",
                      manifest_path=Path(tmp) / "manifest.json",
                      output_root=Path(tmp) / "out",
                      cost_levels=[10.0], date_from="2025-01-01")
            m = r["manifest_data"]
            self.assertEqual(m["manifest_type"], "GEN2_B1_FROZEN_RUN")
            self.assertNotEqual(m["run_id"], OLD_RUN_ID)
            # 边界必须写死在 manifest 里
            b = m["boundaries"]
            self.assertFalse(b["deployed"])
            self.assertFalse(b["authority_promoted"])
            self.assertFalse(b["writes_position"])
            self.assertFalse(b["economic_claim_allowed"])
            self.assertEqual(b["stage"], "SHADOW/CANARY")
            # 冻结输入必须随 manifest 一起留痕
            self.assertEqual(m["frozen_input"]["lock"]["bundle_version"], "gen2-rule-v2.0.1")
            self.assertEqual(len(m["frozen_input"]["immutable_set"]), 8)
            self.assertEqual(m["frozen_input"]["lock"]["lock_revision"], 3)
            self.assertEqual(len(m["frozen_input"]["lock_component_digest"]), 64)
            self.assertTrue(m["frozen_input"]["lock"]["root_anchor_in_sync"])
            self.assertEqual(m["config_attestation"]["drift"], [])
            # ②③④ 补齐四类哈希
            self.assertEqual(sorted(e["id"] for e in m["run_implementation"]),
                             ["b1_frozen_run", "baseline_builder", "cost_impl", "ledger"])
            self.assertTrue(m["environment"]["python"])
            self.assertEqual(len(m["input_data"]["content_digest"]), 64)
            self.assertTrue(m["input_data"]["files"])
            self.assertEqual(m["input_data"]["date_range"]["first_date"],
                             min(f["first_date"] for f in m["input_data"]["files"]))
            self.assertIsNotNone(m["outputs"]["committed_report"]["sha256"])
            self.assertTrue(m["outputs"]["committed_report"]["exists"])
            self.assertEqual(m["self_check"]["failed"], 0, m["self_check"]["detail"])
            self.assertTrue(m["self_check"]["all_pass"])
            self.assertGreaterEqual(m["self_check"]["checks"], 8 + 4 + 2)
            # 验收
            a = m["acceptance"]
            self.assertTrue(a["gate_pass"], a)
            self.assertLessEqual(a["conservation_max_error"], 1e-9)
            self.assertGreaterEqual(a["cash_min"], -1e-9)
            self.assertEqual(len(a["strategies"]), 5)
            # 产物与报告落盘
            self.assertTrue(Path(r["manifest"]).is_file())
            self.assertTrue(Path(r["report"]).is_file())
            for art in m["artifacts"]:
                self.assertTrue(art["exists"], art["file"])
                self.assertIsNotNone(art["sha256"])

    def test_final_run_matches_candidate_run_at_10bps(self):
        """扩围只锁范围 ⇒ 最终 Frozen B1 的 10bps 读数必须与候选运行逐位一致。

        两次扩围（`lock_revision 2/3`）都未改 bundle 字节与规则参数，因此读数**应当一致**。
        若哪天不一致，就是「扩围顺带改了语义」——必须查清，也正是这条断言存在的意义。
        """
        with tempfile.TemporaryDirectory() as tmp:
            r = B.run(date_tag="20260914", report_dir=Path(tmp) / "rep",
                      manifest_path=Path(tmp) / "manifest.json",
                      output_root=Path(tmp) / "out", cost_levels=[10.0])
            rows = B._candidate_run_comparison(r["summary"])
            self.assertTrue(rows, "未取到任何可与候选运行对齐的策略")
            for name, ref, cum, shp, same in rows:
                self.assertTrue(
                    same, "%s：本次 %+.4f/Sharpe %.2f vs 候选 %+.4f/Sharpe %.2f —— "
                          "扩围改变了运行语义？" % (name, cum, shp,
                                                ref["cumulative_return"], ref["sharpe"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
