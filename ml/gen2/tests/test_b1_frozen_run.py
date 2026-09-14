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

第三次裁决（同日）再加两道收口：

  5. **产出降级 + 差异归因数据化**（`AttributionTest`）：报告必须标为「待合并冻结运行」
     （`PENDING_MERGE`，不得写成项目最终 Frozen B1）；§9 的旧/新数值对照表必须由**两边的
     `ledger_summary` 数据**生成（旧基线读数固化为入库快照 `GEN2_B1_AUDIT_BASELINE_20260911.json`），
     且四项已登记变更（D-001 / F1+F2 / F4 / 统一账本）的「能否解释本次 Δ」由**时间线判定规则**
     推导而非叙述。基准策略不经过规则实现 ⇒ 其 Δ 必须**恰为 0**（可机检控制项）。
  6. **接受记录**（`AcceptanceRecordTest`）：`accept_merge(master_commit)` 前置重算三类摘要
     （锁 SHA + 组件折叠摘要 / 输入内容摘要 / 运行实现摘要），任一变化即**拒绝写入并要求重跑**；
     三者不变则写入 `accepted_master_commit` / `source_tree_sha` 并把措辞切为「Frozen B1 已接受」。

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
from unittest import mock

import pandas as pd

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
            # ⑤ 复核结论：接受记录写入前必须是「待合并冻结运行」，且报告写出前自校验已如实记录
            self.assertEqual(m["run_status"], B.STATUS_PENDING_MERGE)
            self.assertNotIn("acceptance_record", m)
            self.assertTrue(m["self_check_pre_report"]["all_pass"],
                            m["self_check_pre_report"]["detail"])
            self.assertEqual(m["self_check_pre_report"]["checks"], m["self_check"]["checks"] - 1,
                             "报告写出前自校验应恰好少一项（本报告自身哈希）")
            # ⑨ 归因必须随 manifest 落盘；本测试用**裁剪窗口** ⇒ 与快照窗口不同 ⇒
            #    控制项必须降级为「不适用」（不得假报「基准 Δ ≠ 0 ⇒ 账本变了」）。
            att = m["attribution"]
            self.assertFalse(att["controls"]["comparable"])
            self.assertIsNone(att["controls"]["benchmark_bit_identical"])
            self.assertIsNone(att["controls"]["benchmark_max_abs_cum_return_delta"])
            self.assertGreater(att["controls"]["window_mismatch"]["run"]["days"], 0)
            self.assertEqual(att["controls"]["window_mismatch"]["audit_baseline"]["days"], 1577)
            self.assertEqual(
                [c["id"] for c in att["changes"] if c["numeric_contribution"] == "material"],
                ["F4"], "只有 F4 应能解释本 Δ（D-001 / 统一账本已在旧基线内；F1/F2 默认等价）")
            # 报告内容：可对照性判定 + 数值对照表 + 更正后的方向性表述 + 不出现假阴性自校验行
            text = Path(r["report"]).read_text(encoding="utf-8")
            self.assertIn("### 9.0 可对照性判定", text)
            self.assertIn("### 9.1 数值对照表", text)
            self.assertIn("Δ净值", text)
            self.assertIn("Δ换手", text)
            self.assertIn("n/a", text, "窗口不一致时 Δ 列必须显示 n/a，不得给出不可解释的差值")
            self.assertIn("### 9.3 逐项归因", text)
            self.assertIn("净收益被低估、表现更悲观", text)
            self.assertIn("此前把这里写成「旧读数偏乐观」是**错误的**", text,
                          "更正必须**显式**写出被更正的旧说法，而不是悄悄删掉")
            self.assertNotIn("❌ 存在失配", text)
            self.assertIn("待合并冻结运行", text)
            self.assertNotIn("Frozen B1 已接受", text)
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


class AttributionTest(unittest.TestCase):
    """⑤⑨ 第三次裁决：产出降级 + 差异归因必须**由数据生成**，且判定规则可机检。

    §9 的旧/新数值对照表不允许手工誊抄 —— 旧基线读数固化为入库快照
    （`manifests/GEN2_B1_AUDIT_BASELINE_20260911.json`，20 行 = 5 策略 × 4 成本档），
    表格由**两边的 `ledger_summary` 数据**生成。本 TestCase 把这句话变成可执行断言。
    """

    @classmethod
    def setUpClass(cls):
        cls.audit = B.load_audit_baseline()
        # 与快照同窗口 ⇒ 可对照（这是「全量运行」应有的窗口）
        w = cls.audit["window"]
        cls.window = {"first_date": w["date_from"], "last_date": w["date_to"], "days": w["days"]}

    # ---- 快照本身：入库证据必须完整、可复现 ----

    def test_snapshot_covers_every_strategy_cost_cell(self):
        rows = self.audit["rows"]
        cells = {(r["strategy"], float(r["cost_bps"])) for r in rows}
        self.assertEqual(len(cells), len(rows), "快照存在重复 (strategy, cost_bps) 单元格")
        self.assertEqual(len(cells), 5 * 4, "快照应为 5 策略 × 4 成本档")
        self.assertEqual(sorted({float(r["cost_bps"]) for r in rows}), [0.0, 5.0, 10.0, 20.0])
        for r in rows:
            for k in ("terminal_nav", "cumulative_return", "cagr", "sharpe", "mdd",
                      "total_turnover", "total_cost"):
                self.assertIn(k, r, f"快照行缺 {k}：无法生成 §9 对照表")

    def test_snapshot_provenance_is_pinned(self):
        self.assertEqual(len(self.audit["captured_from_sha256"]), 64)
        self.assertNotEqual(self.audit["captured_from_sha256"], "0" * 64)
        self.assertTrue(self.audit["captured_from"], "快照必须记录来源")
        self.assertEqual({r["days"] for r in self.audit["rows"]},
                         {self.audit["window"]["days"]},
                         "快照行天数与声明的窗口不一致")

    def test_attribution_reports_the_snapshot_it_used(self):
        att = B.build_attribution(self._summary(), self.audit, run_window=self.window)
        self.assertEqual(att["audit_baseline"]["snapshot_file"], B.AUDIT_BASELINE_REL)
        self.assertEqual(att["audit_baseline"]["snapshot_sha256"], B._sha(B.AUDIT_BASELINE_REL))
        self.assertEqual(att["audit_baseline"]["run_id"], self.audit["run_id"])
        self.assertIn("code_state_timeline", att["audit_baseline"])

    # ---- 对照表：必须由数据算出，不能手工誊抄 ----

    def _summary(self, *, mutate=None) -> pd.DataFrame:
        rows = []
        for r in self.audit["rows"]:
            r = dict(r)
            if mutate:
                mutate(r)
            rows.append(r)
        return pd.DataFrame(rows)

    def test_delta_is_computed_from_both_sides(self):
        att = B.build_attribution(self._summary(), self.audit, run_window=self.window)
        self.assertEqual(len(att["rows"]), len(self.audit["rows"]))
        for row in att["rows"]:
            self.assertIsNotNone(row["old"], "快照应覆盖全部单元格")
            for k, d in row["delta"].items():
                self.assertAlmostEqual(d, 0.0, places=12,
                                       msg=f"new ≡ old 时 {k} 的 Δ 必须恰为 0")
        self.assertEqual(att["controls"]["benchmark_max_abs_cum_return_delta"], 0.0)
        self.assertTrue(att["controls"]["benchmark_bit_identical"])

    def test_table_tracks_a_real_difference(self):
        """人为把某策略 10bps 净值挪 +0.1 ⇒ Δ 必须如实反映（证明表是算出来的）。"""
        def bump(r):
            if r["strategy"] == "gen2_v2_defended" and float(r["cost_bps"]) == 10.0:
                r["cumulative_return"] += 0.1
                r["terminal_nav"] += 0.1

        att = B.build_attribution(self._summary(mutate=bump), self.audit, run_window=self.window)
        hit = [r for r in att["rows"]
               if r["strategy"] == "gen2_v2_defended" and r["cost_bps"] == 10.0]
        self.assertEqual(len(hit), 1)
        self.assertAlmostEqual(hit[0]["delta"]["cumulative_return"], 0.1, places=12)
        self.assertAlmostEqual(hit[0]["delta"]["terminal_nav"], 0.1, places=12)
        for row in att["rows"]:
            if row is hit[0]:
                continue
            for k, d in row["delta"].items():
                self.assertEqual(d, 0.0, f"未改动的单元格 {row['strategy']}@{row['cost_bps']} "
                                          f"{k} 不应出现 Δ")

    def test_absent_cell_is_null_not_a_fabricated_zero(self):
        """反例：旧侧缺该 (策略 × 成本档) ⇒ Δ 必须留空，不得伪造成 0。"""
        extra = dict(self.audit["rows"][0])
        extra["strategy"] = "brand_new_strategy"
        df = pd.concat([self._summary(), pd.DataFrame([extra])], ignore_index=True)
        att = B.build_attribution(df, self.audit, run_window=self.window)
        new_row = [r for r in att["rows"] if r["strategy"] == "brand_new_strategy"][0]
        self.assertIsNone(new_row["old"])
        self.assertIsNone(new_row["delta"], "旧侧无读数时必须留空（None），不得填 0")

    # ---- 逐项归因：由「是否落在旧基线内」这条规则推导，不是叙述 ----

    def test_change_judgement_follows_the_timeline_rule(self):
        att = B.build_attribution(self._summary(), self.audit, run_window=self.window)
        got = {c["id"]: c for c in att["changes"]}
        self.assertEqual(sorted(got), sorted(c["id"] for c in B.REGISTERED_CHANGES))
        for cid in ("D-001", "统一账本"):
            self.assertTrue(got[cid]["in_audit_baseline"], cid)
            self.assertFalse(got[cid]["in_this_delta"], cid)
            self.assertEqual(got[cid]["numeric_contribution"],
                             "none_already_in_audit_baseline", cid)
        self.assertFalse(got["F1/F2"]["in_audit_baseline"])
        self.assertEqual(got["F1/F2"]["numeric_contribution"], "none_by_default_equivalence")
        self.assertFalse(got["F4"]["in_audit_baseline"])
        self.assertEqual(got["F4"]["numeric_contribution"], "material")
        self.assertEqual([c["id"] for c in att["changes"]
                          if c["numeric_contribution"] == "material"], ["F4"],
                         "只有 F4 应能解释本次 Δ")

    def test_control_flag_catches_benchmark_drift(self):
        """反例：基准策略 Δ 不为 0 ⇒ 控制项必须报警（说明账本/基准路径也变了）。"""
        def bump(r):
            if r["strategy"] == "market_510300":
                r["cumulative_return"] += 1e-6

        att = B.build_attribution(self._summary(mutate=bump), self.audit, run_window=self.window)
        self.assertFalse(att["controls"]["benchmark_bit_identical"])
        self.assertGreater(att["controls"]["benchmark_max_abs_cum_return_delta"], 0.0)
        self.assertIn("market_510300", att["controls"]["benchmark_strategies"])
        self.assertEqual([c["id"] for c in att["changes"]
                          if c["numeric_contribution"] == "material"], ["F4"])

    # ---- 可对照性：窗口不同 ⇒ 必须降级为「不适用」，不得假报 ----

    def test_window_mismatch_disables_the_control_verdict(self):
        """反例：本次窗口 ≠ 快照窗口 ⇒ 控制项必须标「不适用」，**不得**判 True/False。

        这正是「拿两个不同问题相减」的防护：裁剪窗口运行里基准策略的 Δ 必然 ≠ 0，
        若把它当成「账本被改了」的证据，就是**假报警**（会让审阅者去查一个不存在的缺陷）。
        """
        att = B.build_attribution(self._summary(), self.audit,
                                  run_window={"first_date": "2025-01-02",
                                              "last_date": "2026-09-04", "days": 407})
        ctl = att["controls"]
        self.assertFalse(ctl["comparable"])
        self.assertIsNone(ctl["benchmark_bit_identical"],
                          "窗口不一致时必须标「不适用」而非判 True/False")
        self.assertIsNone(ctl["benchmark_max_abs_cum_return_delta"])
        self.assertEqual(ctl["window_mismatch"]["run"]["days"], 407)
        self.assertEqual(ctl["window_mismatch"]["audit_baseline"]["days"], 1577)
        self.assertIn("不适用", ctl["note"])
        # 时点判定与窗口无关 ⇒ 在不可对照模式下依然有效
        self.assertEqual([c["id"] for c in att["changes"]
                          if c["numeric_contribution"] == "material"], ["F4"])

    def test_missing_run_window_is_not_treated_as_comparable(self):
        """fail-closed：未提供运行窗口 ⇒ 同样标「不适用」，不得默认判为可对照。"""
        att = B.build_attribution(self._summary(), self.audit)
        self.assertFalse(att["controls"]["comparable"])
        self.assertIsNone(att["controls"]["benchmark_bit_identical"])

    def test_cost_level_subset_does_not_block_comparability(self):
        """成本档少于快照（如仅 10bps）**不**构成阻断：个别单元格缺席，其余 Δ 仍可解释。"""
        df = self._summary()
        df = df[df["cost_bps"] == 10.0]
        att = B.build_attribution(df, self.audit, run_window=self.window)
        self.assertTrue(att["controls"]["comparable"], "窗口一致 ⇒ 仍可对照（成本档差异仅信息性）")
        self.assertEqual(att["controls"]["cost_level_mismatch"]["run"], [10.0])
        self.assertTrue(att["controls"]["benchmark_bit_identical"])

    def test_window_with_date_objects_still_compares_equal(self):
        """回归（真实假报警）：日历给的是 `date` 对象、快照里是字符串 ⇒ 归一化后必须相等。

        `ledger.assert_common_calendar` 返回 `date` / `Timestamp`，不比字符。若不归一化，
        **同一个全窗口运行**会被判成「不可对照」→ §9 整页降级 → 审阅者去查一个不存在的缺陷。
        这条断言就是那次失配的钉子。
        """
        import datetime as _dt

        w = self.audit["window"]
        att = B.build_attribution(self._summary(), self.audit, run_window={
            "first_date": _dt.date.fromisoformat(w["date_from"]),
            "last_date": _dt.date.fromisoformat(w["date_to"]),
            "days": w["days"]})
        self.assertTrue(att["controls"]["comparable"], "同值不同型不得判为不可对照")
        self.assertIsNone(att["controls"]["window_mismatch"])
        self.assertTrue(att["controls"]["benchmark_bit_identical"])
        self.assertEqual(B._norm_window({"first_date": _dt.date(2020, 3, 10),
                                         "last_date": _dt.date(2026, 9, 4),
                                         "days": 1577}),
                         {"first_date": "2020-03-10", "last_date": "2026-09-04", "days": 1577})


class F4MechanismValidityTest(unittest.TestCase):
    """反例：证明「候选权重语义：1/n 等权 → 权威权重 + 上限」**真的**会移动数值。

    旧基线的候选权重实测为 1/n 等权（CORE=1 → 1.0）。把它喂进冻结上限
    （`max_single_weight = 0.25`）必然**抛错**、绝不静默缩 —— 所以 F4「不再重置为等权、
    不再丢弃单只/cluster/科技上限」一定改变权重路径，`numeric_contribution = material`
    因此是**机制结论**而非叙述。再把上限放宽到 1.0，同一输入就不再被拒 ——
    说明该拒绝是**上限驱动**的，不是无差别拦截。
    """

    @staticmethod
    def _roles(weights):
        return pd.DataFrame([
            {"trade_date": "2020-05-27", "code": code, "role": "CORE",
             "correlation_cluster": "tech_hardware", "target_weight": w,
             "alpha_score_v2": 0.9 - i * 0.1}
            for i, (code, w) in enumerate(weights)
        ])

    def test_old_equal_weight_breaches_frozen_single_cap(self):
        from gen2.portfolio import portfolio_builder as P

        roles = self._roles([("513310", 1.0)])  # 1/n 等权（CORE=1）
        with self.assertRaises(P.PortfolioBuildError) as ctx:
            P.build_portfolio_candidates(roles, priority=P.priority_from_roles(roles))
        self.assertIn(P.CANDIDATE_ERR["CAP_SINGLE"], str(ctx.exception))

    def test_same_input_passes_once_the_cap_is_loosened(self):
        from gen2.portfolio import portfolio_builder as P

        roles = self._roles([("513310", 1.0)])
        out = P.build_portfolio_candidates(
            roles, priority=P.priority_from_roles(roles),
            portfolio_config={"max_single_weight": 1.0, "max_cluster_weight": 1.0,
                              "max_tech_weight": 1.0})
        got = float(out.loc[out["code"] == "513310", "target_weight"].iloc[0])
        self.assertEqual(got, 1.0, "上限放宽后同一输入应被接受（拒绝确由上限触发）")

    def test_old_equal_weight_breaches_cluster_and_tech_caps(self):
        from gen2.portfolio import portfolio_builder as P

        roles = self._roles([("513310", 1 / 3), ("515880", 1 / 3), ("159582", 1 / 3)])
        pmap = P.priority_from_roles(roles)
        common = {"max_single_weight": 1.0}
        with self.assertRaises(P.PortfolioBuildError) as ctx:
            P.build_portfolio_candidates(
                roles, priority=pmap,
                portfolio_config={**common, "max_cluster_weight": 0.4, "max_tech_weight": 1.0})
        self.assertIn(P.CANDIDATE_ERR["CAP_CLUSTER"], str(ctx.exception))
        with self.assertRaises(P.PortfolioBuildError) as ctx2:
            P.build_portfolio_candidates(
                roles, priority=pmap,
                portfolio_config={**common, "max_cluster_weight": 1.0, "max_tech_weight": 0.65})
        self.assertIn(P.CANDIDATE_ERR["CAP_TECH"], str(ctx2.exception))


class AcceptanceRecordTest(unittest.TestCase):
    """④（第三次裁决）接受记录：三类摘要不变 ⇒ 绑定到 master；变 ⇒ 拒绝并要求重跑。"""

    def setUp(self):
        if not _b1_dataset_available():
            raise unittest.SkipTest(
                "本地 Gen-2 日线池不可用 → 接受记录（需真实 manifest 的三类摘要）在 CI 跳过")

    @staticmethod
    def _run(tmp: str) -> dict:
        return B.run(date_tag="20260914", report_dir=Path(tmp) / "rep",
                     manifest_path=Path(tmp) / "manifest.json",
                     output_root=Path(tmp) / "out",
                     cost_levels=[10.0], date_from="2025-01-01")

    @staticmethod
    def _fake_git(*args):
        """`git rev-parse` 一律返回替身 SHA（无 git 环境也可复现）。"""
        return "a" * 40 if args and args[0] == "rev-parse" else None

    def test_accept_merge_binds_digests_and_switches_wording(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            self.assertEqual(r["manifest_data"]["run_status"], B.STATUS_PENDING_MERGE)
            with mock.patch.object(B, "_git", side_effect=self._fake_git):
                m = B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            self.assertEqual(m["run_status"], B.STATUS_ACCEPTED)
            self.assertNotIn("run_status_note", m, "接受后不应再保留「待合并」口径说明")

            rec = m["acceptance_record"]
            self.assertEqual(rec["status"], B.STATUS_ACCEPTED)
            self.assertEqual(rec["accepted_master_commit"], "a" * 40)
            self.assertEqual(rec["accepted_master_commit_input"], "HEAD")
            self.assertEqual(rec["source_tree_sha"], "a" * 40)
            self.assertTrue(rec["digests_unchanged"])
            self.assertTrue(rec["no_rerun_required"], "内容哈希未变 ⇒ 无需重跑")
            for k in ("lock_sha256", "lock_component_digest", "input_content_digest",
                      "run_implementation_digest", "committed_report_sha256"):
                self.assertTrue(rec["bound_digests"].get(k), f"接受记录缺摘要绑定：{k}")
            self.assertEqual(rec["bound_digests"]["lock_sha256"],
                             m["frozen_input"]["lock"]["lock_sha256"])
            self.assertEqual(rec["bound_digests"]["input_content_digest"],
                             m["input_data"]["content_digest"])

            text = Path(m["outputs"]["committed_report"]["file"]).read_text(encoding="utf-8")
            self.assertIn("Frozen B1 已接受", text)
            self.assertIn("已接受", text.splitlines()[0])
            self.assertNotIn("待合并冻结运行", text)
            self.assertNotIn("不得据此启动 B3", text)
            self.assertTrue(m["self_check"]["all_pass"], m["self_check"]["detail"])

            on_disk = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            self.assertEqual(on_disk["run_status"], B.STATUS_ACCEPTED,
                             "接受记录必须随 committed manifest 一起落盘")
            self.assertEqual(on_disk["acceptance_record"]["accepted_master_commit"], "a" * 40)

    def test_accept_merge_refuses_when_a_frozen_component_changed(self):
        """反例：取证后有人动了冻结实现 ⇒ 三类摘要不一致 ⇒ 拒绝写入，必须重跑 B1。"""
        target = B._abs("ml/gen2/baseline/selection_scores.py")
        self.assertTrue(target.is_file(), "反例目标文件缺失")
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            original = target.read_bytes()
            try:
                target.write_bytes(original + b"\n# tampered-after-attestation\n")
                with self.assertRaises(B.FrozenAttestationError) as ctx:
                    B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            finally:
                target.write_bytes(original)  # 必须按原字节写回
            msg = str(ctx.exception)
            self.assertIn("拒绝", msg)
            self.assertIn("lock_component_digest", msg, "越界项应定位到组件折叠摘要")
            self.assertEqual(target.read_bytes(), original)

            on_disk = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            self.assertEqual(on_disk["run_status"], B.STATUS_PENDING_MERGE,
                             "拒绝时必须保持「待合并」，不得半写接受记录")
            self.assertNotIn("acceptance_record", on_disk)


if __name__ == "__main__":
    unittest.main(verbosity=2)
