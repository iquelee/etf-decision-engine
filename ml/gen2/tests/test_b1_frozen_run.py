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
  6. **接受记录 + 独立接受记录 PR 闸门**（`AcceptanceRecordTest`）：`accept_merge(master_commit)`
     的**第五次裁决（修正后）契约** —— ⓪ **工作树干净**（接受时 + 取证时两态）；① **执行提交**
     `source_state.git_head_commit` 是 `<B1 merge SHA>` 的**祖先**；② **锁定组件 / B1 工具链 /
     输入摘要 / 输出摘要**与 manifest **逐项**逐位一致；③ `<B1 merge SHA>` 的**树中包含**已承诺的
     **报告 / manifest / 审计快照**且**哈希匹配**（取提交里的 blob 算哈希）。任一不过即**拒绝写入
     并要求重跑**；全过才写入 `accepted_master_commit` / `accepted_master_tree_sha` /
     `execution_source_tree_sha`，并把措辞切为「Frozen B1 已接受」。该命令**会修改受版本控制的
     manifest / 报告**，因此必须落在独立分支 `chore/gen2-b1-accept-v201` 的**接受记录 PR** 上。
     ⚠️ **不得**再要求 `accepted_master_tree_sha == execution_source_tree_sha`：产物在**执行之后**
     才提交 ⇒ 两个 tree **必然不同**，要求相等会**必然失败**（早期版本的缺陷，已由本轮修正）。
  7. **归因口径限定**：§9 的结论**只**在「2026-09-11 审计基线 vs 本次运行、相同窗口/数据」这一组
     对照内成立，**不得**写成对所有历史结果的普遍因果结论（断言无限定的旧措辞不出现）。
  8. **执行窗口内源改动 = 正确的 fail-closed 中止**（`SourceMutationTest`）：`HEAD` 移动或
     `run_implementation` 文件被改 ⇒ `run_status` 记为 `ABORTED_SOURCE_MUTATED` 并中止产出。
     它不是「假失败」；**干净源上的重跑**才是可采信的门禁证据。
  9. **无日线池的环境（CI）必须与本地得出同一结论**：`verify_manifest` 的
     `input.content_digest` 只由**声明的** `files` / `meta_files` 重算（不读磁盘）⇒ 「无池」分支的
     空输入声明必须自洽（`_aggregate_digest([])`）。写死魔数会让断言**只在本地有池时**成立，
     在任何没有池子的环境恒判不一致 —— 那是**测试自身**的缺陷，不是被测代码的缺陷。
     `GitBlobEvidenceTest` 以「当前是 git 检出」为前提，在没有 `.git` 的源码导出包上**显式跳过**。

端到端跑 `run()` 需要本地日线池（未入库），在 CI 跳过 —— 与 `test_b1_baseline_contract`
同策略：**显式跳过而不是伪造通过**（且「跳过」不得被当成「通过」的等价物）。

运行::

    PYTHONPATH=ml python -m unittest ml.gen2.tests.test_b1_frozen_run
"""
from __future__ import annotations

import contextlib
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


def _empty_input_stub() -> dict:
    """无本地日线池（CI）时的**自洽**空输入声明。

    `verify_manifest` 的 `input.content_digest` 是由**声明的** `files` / `meta_files`
    **重算**出来的（`_aggregate_digest`），它不看磁盘。所以空清单必须声明
    `_aggregate_digest([])`；早期版本写死魔数 `"0" * 64`，于是这条断言**只在本地有日线池时**
    通过（走真 `input_data_attestation`），在任何没有池子的环境（CI）恒判不一致。
    """
    return {
        "daily_dir": "x",
        "codes": [],
        "rows_total": 0,
        "date_range": {"first_date": None, "last_date": None},
        "files": [],
        "meta_files": [],
        "content_digest": B._aggregate_digest([]),
    }


def _minimal_manifest(inputs: dict) -> dict:
    """一份**最小但自洽**的 manifest —— 让 `verify_manifest` 的四类校验都真的跑起来。

    锁定组件 / 运行实现 / 环境三块取**真实**attestation，只有输入数据由调用方给
    （本地有池用真输入，无池用 `_empty_input_stub()`）。
    """
    att = B.verify_frozen_lock()
    return {
        "frozen_input": {
            "lock": {"lock_file": att["lock_file"], "lock_sha256": att["lock_sha256"]},
            "immutable_set": att["immutable_set"],
            "lock_component_digest": att["lock_component_digest"],
        },
        "run_implementation": B.implementation_attestation(),
        "environment": B.environment_version(),
        "input_data": inputs,
        "run_dir": "ml/gen2/outputs/__none__",
        "artifacts": [],
    }


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
        inputs = (B.input_data_attestation(load_gen2_config())
                  if _b1_dataset_available() else _empty_input_stub())
        m = _minimal_manifest(inputs)
        self.assertTrue(B.verify_manifest(m)["all_pass"], B.verify_manifest(m)["detail"])
        m["frozen_input"]["lock"]["lock_sha256"] = "0" * 64
        res = B.verify_manifest(m)
        self.assertFalse(res["all_pass"])
        self.assertEqual(res["detail"][0]["check"], "lock.sha256")

    def test_empty_input_declaration_is_self_consistent(self):
        """**回归（CI 全红）**：无日线池环境走的空输入声明分支必须自洽。

        这条路径在**本地（有池）根本走不到**，只看本地门禁会留下「只有 CI 才失败」的盲区；
        这里显式跑一遍，等价于在 CI 上跑（不依赖池）。修复前的症状：4 个 `test` job 全红，
        失败项恰为 `input.content_digest`（声明 `"0"*64` vs 重算 `_aggregate_digest([])`）。
        """
        m = _minimal_manifest(_empty_input_stub())
        res = B.verify_manifest(m)
        self.assertTrue(res["all_pass"], res["detail"])
        # 自洽性本身就是被测对象：空清单的摘要必须等于空聚合，而不是任何魔数
        self.assertEqual(m["input_data"]["content_digest"], B._aggregate_digest([]))


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
            # 措辞闸门：报告**允许提及**「Frozen B1 已接受」这个**条件句**（§12：「该 PR 合并之后，
            # 本产出才可正式称为『Frozen B1 已接受』」）—— 所以不能拿子串全盘否定，那会把条件句误伤，
            # 逼着实现去删掉对闸门的说明（正是要保留的东西）。断言**具体口径**：
            self.assertIn("措辞不得写「已接受」", text, "待合并态必须显式声明措辞约束")
            self.assertNotIn("已接受", text.splitlines()[0], "标题不得出现「已接受」")
            self.assertNotIn("**Frozen B1 已接受**（生效以接受记录 PR 合并为准）", text,
                             "不得渲染「已接受」状态行")
            self.assertIn("| `run_status` | `PENDING_MERGE` |", text,
                          "§12 状态表必须明示 PENDING_MERGE")
            # ⑩（第四次裁决）归因口径限定 + 独立接受记录 PR 闸门 + 取证源码树
            ss = m["source_state"]
            self.assertEqual(len(ss["source_tree_sha"]), 40,
                             "manifest 必须记录取证时的源码树（接受记录据此比对 master^{tree}）")
            self.assertEqual(len(ss["git_head_commit"]), 40)
            self.assertIn("结论的适用范围", text)
            self.assertIn("F4 是唯一实质来源", text)
            self.assertNotIn("F4 是唯一实质性来源", text,
                             "不得保留未限定范围的旧措辞（普遍因果结论）")
            self.assertIn("普遍因果结论", text, "必须显式声明**不**推广为普遍因果结论")
            self.assertIn(B.ACCEPT_BRANCH, text)
            self.assertIn("接受记录 PR", text)
            self.assertIn("source_tree_sha", text)
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


class SourceStateTest(unittest.TestCase):
    """`source_state()` 的解析正确性 —— 它产出的文案会进**审计记录**，截断即假信号。"""

    @staticmethod
    def _state(stdout: str):
        proc = mock.Mock(returncode=0, stdout=stdout, stderr="")
        with mock.patch.object(B, "_git_run", return_value=proc), \
                mock.patch.object(B, "_git", side_effect=lambda *a: "a" * 40):
            return B.source_state()

    def test_porcelain_paths_keep_their_first_character(self):
        """回归：`_git()` 会 `.strip()` 整个输出，把**首行**的前导空格吃掉 ⇒ `l[3:]` 会多切一刀。

        历史缺陷：` M ml/gen2/...` 被 strip 成 `M ml/gen2/...`，`l[3:]` 交出 `l/gen2/...`
        —— 路径少了第一个字符，写进拒绝理由里会让人去查一个**不存在**的路径。
        """
        ss = self._state(" M ml/gen2/baseline/regime.py\n M ml/gen2/baseline/selection_scores.py\n")
        self.assertEqual(ss["dirty_tracked_paths"],
                         ["ml/gen2/baseline/regime.py", "ml/gen2/baseline/selection_scores.py"])
        self.assertTrue(ss["working_tree_dirty"])

    def test_untracked_and_blank_lines_are_not_controlled_changes(self):
        ss = self._state("?? scratch.txt\n\n")
        self.assertEqual(ss["dirty_tracked_paths"], [], "未跟踪文件不进入任何提交的 tree")
        self.assertFalse(ss["working_tree_dirty"])

    def test_clean_tree_reports_not_dirty(self):
        ss = self._state("")
        self.assertFalse(ss["working_tree_dirty"])
        self.assertEqual(ss["dirty_tracked_paths"], [])
        self.assertEqual(ss["source_tree_sha"], "a" * 40)


class _GitDoubles:
    """把 `_git` / `_git_run` / `_git_blob_sha256` / `source_state` 四个替身打包成一个上下文管理器。

    `accept_merge` 现在会**多处**调用 git（①祖先判定、③blob 取证、⓪接受时工作树状态）。分散 patch
    很容易漏掉一个 —— 漏了就落到**真实仓库**上：本地是脏树，用例会被⓪校验整体带崩（本轮踩到）。
    打包成单一 `with` 既省事，也让「替身覆盖面」这件事一眼可查。
    """

    def __init__(self, patches):
        self._patches = list(patches)
        self._stack = contextlib.ExitStack()

    def __enter__(self):
        self._stack.__enter__()
        for p in self._patches:
            self._stack.enter_context(p)
        return self

    def __exit__(self, *exc):
        return self._stack.__exit__(*exc)


def _evidence_expected(md: dict, manifest_path) -> dict:
    """从 manifest 反推「已承诺证据」三份产物的期望哈希 —— 替身据此返回**匹配**的 blob 哈希。"""
    rep_rel = B._rel(B._abs(((md.get("outputs") or {}).get("committed_report") or {})
                            .get("file") or md["report"]))
    attr = ((md.get("attribution") or {}).get("audit_baseline") or {})
    return {
        rep_rel: ((md.get("outputs") or {}).get("committed_report") or {}).get("sha256"),
        B._rel(Path(manifest_path)): B._sha(manifest_path),
        attr.get("snapshot_file"): attr.get("snapshot_sha256"),
    }


class AcceptanceRecordTest(unittest.TestCase):
    """⑤（第五次裁决 · 修正后契约）接受记录：四项校验全过 ⇒ 绑定 B1 合并提交；任一不过 ⇒ 拒绝重跑。

    ⚠️ 本类**故意**让替身返回的 `<SHA>^{tree}` 与 manifest 的 `execution_source_tree_sha`
    **不同**（`"a"*40` vs `"1"*40`）。这正是被修正的那条契约：报告 / manifest / 审计快照是
    **执行之后**才提交进 B1 分支的 ⇒ 两个 tree **必然不同**。早期版本要求「整棵树相等」，
    会让接受命令**必然失败** —— 所以「两棵树不同仍接受成功」本身就是**回归断言**。

    `--accept-merge` 会修改**受版本控制**的 manifest / 报告 ⇒ 必须落在独立分支
    `chore/gen2-b1-accept-v201` 的**接受记录 PR** 上（报告 §12 断言 + `landed_via_pull_request_required`）。
    """

    #: `source_state()` 的**干净替身**。本地开发时工作树通常是脏的；若让 `run()` / `accept_merge()`
    #: 走真实 git，⓪ 干净树校验会**先于**摘要校验触发，本类想覆盖的注入摘要根本到不了。
    #: 脏树前置本身由两个专门用例覆盖（取证时 / 接受时）。
    CLEAN_SOURCE_STATE = {
        "git_head_commit": "0" * 40,
        "source_tree_sha": "1" * 40,
        "working_tree_dirty": False,
        "dirty_tracked_paths": [],
        "note": "(test double)",
    }

    def setUp(self):
        if not _b1_dataset_available():
            raise unittest.SkipTest(
                "本地 Gen-2 日线池不可用 → 接受记录（需真实 manifest 的摘要）在 CI 跳过")

    @classmethod
    def _run(cls, tmp: str) -> dict:
        # `source_mutation_report()` 会**直接**问 git 要 `HEAD` ⇒ 连 `_git` 一起替身：
        # 否则真实 HEAD 与替身的 `git_head_commit` 不一致，`run()` 会以
        # `ABORTED_SOURCE_MUTATED` 中止（这正是新增检测在工作，但会掩盖本类想测的东西）。
        with mock.patch.object(B, "source_state", return_value=dict(cls.CLEAN_SOURCE_STATE)), \
                mock.patch.object(B, "_git",
                                  side_effect=lambda *a: cls.CLEAN_SOURCE_STATE["git_head_commit"]):
            return B.run(date_tag="20260914", report_dir=Path(tmp) / "rep",
                         manifest_path=Path(tmp) / "manifest.json",
                         output_root=Path(tmp) / "out",
                         cost_levels=[10.0], date_from="2025-01-01")

    def _fake_git(self, manifest_path, *, ancestor_ok=True, master_ref_exists=True,
                  tree="a" * 40, blob_missing=(), blob_override=None, accept_state=None):
        """git 替身（四件套，见 `_GitDoubles`）。

        - `ancestor_ok`：①「**执行提交**是 `<SHA>` 的祖先」的退出码；
        - `tree`：`<SHA>^{tree}`（**默认故意不等于** `execution_source_tree_sha`）；
        - `blob_missing`：模拟「该路径**不在** `<SHA>` 树里」（`git cat-file` 失败）；
        - `blob_override`：模拟「树里有这个路径，但**内容哈希不匹配**」；
        - `accept_state`：替换**接受时**的 `source_state()` 返回（默认干净）。
        """
        md = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        # 容错：`test_accept_refuses_when_manifest_lacks_source_tree_sha` 会**故意**删掉
        # `source_state` 来构造反例 —— 替身不能因此自己崩掉（那就成了「测替身」而不是「测契约」）。
        execution_head = (md.get("source_state") or {}).get("git_head_commit")
        table = _evidence_expected(md, manifest_path)
        table.update(blob_override or {})

        def fake_git(*args):
            if not args or args[0] != "rev-parse":
                return None
            target = args[-1]
            if "--verify" in args:
                return "a" * 40 if master_ref_exists else None
            if target.endswith("^{tree}"):
                return tree
            if target == execution_head:
                return execution_head
            return "a" * 40

        def fake_git_run(*args):
            return mock.Mock(returncode=0 if ancestor_ok else 1, stdout="", stderr="")

        def fake_blob(commit, path):
            return None if path in blob_missing else table.get(path)

        state = dict(self.CLEAN_SOURCE_STATE) if accept_state is None else accept_state
        return _GitDoubles([
            mock.patch.object(B, "_git", side_effect=fake_git),
            mock.patch.object(B, "_git_run", side_effect=fake_git_run),
            mock.patch.object(B, "_git_blob_sha256", side_effect=fake_blob),
            mock.patch.object(B, "source_state", return_value=state),
        ])

    # ---- 正向：绑定 + 措辞 + 记录字段 ----

    def test_accept_merge_binds_digests_and_switches_wording(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            md = r["manifest_data"]
            declared_head = md["source_state"]["git_head_commit"]
            declared_tree = md["source_state"]["source_tree_sha"]
            self.assertEqual(md["run_status"], B.STATUS_PENDING_MERGE)
            ss = md["source_state"]
            self.assertFalse(ss["working_tree_dirty"], "取证须在干净树上进行")
            self.assertEqual(ss["dirty_tracked_paths"], [])

            with self._fake_git(r["manifest"]):
                m = B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            self.assertEqual(m["run_status"], B.STATUS_ACCEPTED)
            self.assertNotIn("run_status_note", m, "接受后不应再保留「待合并」口径说明")

            rec = m["acceptance_record"]
            self.assertEqual(rec["status"], B.STATUS_ACCEPTED)
            self.assertEqual(rec["accepted_master_commit"], "a" * 40)
            self.assertEqual(rec["accepted_master_commit_input"], "HEAD")

            # ④ 三项 SHA 必须分别记录，且**语义区分**（接受时仓库快照 vs 执行时语义源码快照）
            self.assertEqual(rec["accepted_master_tree_sha"], "a" * 40)
            self.assertEqual(rec["execution_head_commit"], declared_head)
            self.assertEqual(rec["execution_source_tree_sha"], declared_tree)
            self.assertFalse(rec["trees_required_to_be_equal"],
                             "⚠️ 不得再要求两棵树相等（产物在执行后才提交 ⇒ 必然不同）")
            self.assertEqual(rec["tree_relation"],
                             "accepted_master_tree_contains_committed_evidence")
            self.assertIn("应当不同", rec["tree_relation_note"])
            self.assertIn("不要求相等", rec["tree_relation_note"])
            # 旧契约字段必须**彻底消失**（留着就会被读成「还有个树相等的要求」）
            for gone in ("tree_strictly_equal", "source_tree_match_mode",
                         "source_tree_diff_vs_master_commit", "source_tree_diff_allowed_paths",
                         "source_tree_matches_master_commit_tree", "ancestor_of_master_ref",
                         "source_tree_sha"):
                self.assertNotIn(gone, rec, "旧契约字段应已移除：%s" % gone)

            # ① 祖先关系：方向是「执行提交 → <SHA>」
            self.assertTrue(rec["execution_head_is_ancestor_of_accepted_master_commit"])
            # master_ref 只作信息性标注，**不作拒绝条件**
            self.assertFalse(rec["master_ref_is_blocking"])
            self.assertEqual(rec["master_ref"], B.DEFAULT_MASTER_REF)
            self.assertTrue(rec["accepted_master_commit_reachable_from_master_ref"])

            self.assertTrue(rec["digests_unchanged"])
            self.assertTrue(rec["no_rerun_required"], "内容哈希未变 ⇒ 无需重跑")

            # 四项校验必须逐条留痕
            self.assertEqual([v["check"] for v in rec["verifications"]],
                             ["working_tree_clean_at_accept",
                              "working_tree_clean_at_attestation",
                              "execution_head_is_ancestor_of_accepted_master_commit",
                              "digests_unchanged",
                              "accepted_master_tree_contains_committed_evidence"])

            # ③ 已承诺证据：三份产物都必须在 `<SHA>` 树中找到且哈希匹配
            evidence = {e["role"]: e for e in rec["committed_evidence"]}
            self.assertEqual(sorted(evidence),
                             ["audit_baseline", "run_manifest", "run_report"])
            for role, e in evidence.items():
                self.assertTrue(e["present_in_merge_tree"], role)
                self.assertTrue(e["matches"], role)
                self.assertEqual(e["blob_sha256"], e["expected_sha256"], role)
            self.assertEqual(evidence["run_report"]["expected_sha256"],
                             md["outputs"]["committed_report"]["sha256"])
            self.assertEqual(evidence["audit_baseline"]["expected_sha256"],
                             md["attribution"]["audit_baseline"]["snapshot_sha256"])

            # ② 摘要逐项留痕（逐项而非只折叠摘要）
            compared = rec["verifications"][3]["compared_items"]
            self.assertIn("lock.component_digest", compared)
            self.assertIn("toolchain.digest", compared)
            self.assertIn("input.content_digest", compared)
            self.assertTrue(any(k.startswith("lock.component[") for k in compared),
                            "必须**逐项**比对锁定组件，才能指出哪一条锁定路径变了")
            self.assertTrue(any(k.startswith("toolchain[") for k in compared))
            self.assertTrue(any(k.startswith("output[") for k in compared))

            # 流程闸门：这份改动必须走独立 PR，不能「本地跑一下就完」
            self.assertEqual(rec["acceptance_branch"], B.ACCEPT_BRANCH)
            self.assertTrue(rec["landed_via_pull_request_required"])
            self.assertIn("接受记录 PR", rec["note"])
            self.assertIn("不要求", rec["note"])

            # 摘要绑定
            for k in ("lock_sha256", "lock_component_digest", "toolchain_digest",
                      "input_content_digest", "committed_report_sha256",
                      "accepted_manifest_input_sha256", "audit_baseline_sha256"):
                self.assertTrue(rec["bound_digests"].get(k), "接受记录缺摘要绑定：%s" % k)
            self.assertEqual(sorted(rec["bound_digests"]["run_dir_artifacts"]),
                             sorted(a["file"] for a in m["artifacts"]))
            self.assertEqual(rec["bound_digests"]["lock_sha256"],
                             m["frozen_input"]["lock"]["lock_sha256"])
            self.assertEqual(rec["bound_digests"]["input_content_digest"],
                             m["input_data"]["content_digest"])

            text = Path(m["outputs"]["committed_report"]["file"]).read_text(encoding="utf-8")
            self.assertIn("Frozen B1 已接受", text)
            self.assertIn("已接受", text.splitlines()[0])
            self.assertIn(B.ACCEPT_BRANCH, text, "报告须写明接受记录 PR 分支")
            self.assertIn("本记录尚未生效", text, "接受记录 PR 合并前，措辞仍不得视为生效")
            self.assertIn("不要求", text, "报告须写明两个 tree **不要求**相等")
            self.assertNotIn("待合并冻结运行", text)
            self.assertNotIn("不得据此启动 B3", text)
            self.assertTrue(m["self_check"]["all_pass"], m["self_check"]["detail"])

            on_disk = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            self.assertEqual(on_disk["run_status"], B.STATUS_ACCEPTED,
                             "接受记录必须随 committed manifest 一起落盘")
            self.assertEqual(on_disk["acceptance_record"]["accepted_master_commit"], "a" * 40)
            self.assertNotIn("run_status_note", on_disk)

    # ---- 核心回归：产物导致的整树差异必须允许 ----

    def test_accept_succeeds_even_when_the_two_trees_are_different(self):
        """★ 被修正的契约：`accepted_master_tree_sha` 与 `execution_source_tree_sha` 不同 ⇒ **允许**。

        报告 / manifest / 审计快照是**执行之后**才提交进 B1 分支的，所以接受时仓库树**必然**比
        执行时源码树多出这些路径。早期版本要求两者「整棵树相等」（再放宽为「差异只允许是运行产物」），
        仍然是错的方向：真正该做的是**用摘要把两者关联**，而不是要求树相等。
        """
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            declared_tree = r["manifest_data"]["source_state"]["source_tree_sha"]
            with self._fake_git(r["manifest"], tree="b" * 40):
                m = B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            rec = m["acceptance_record"]
            self.assertEqual(rec["accepted_master_tree_sha"], "b" * 40)
            self.assertEqual(rec["execution_source_tree_sha"], declared_tree)
            self.assertNotEqual(rec["accepted_master_tree_sha"], rec["execution_source_tree_sha"],
                                "两棵树本就应当不同 —— 用例构造的就是这个情形")
            self.assertFalse(rec["trees_required_to_be_equal"])
            self.assertEqual(m["run_status"], B.STATUS_ACCEPTED,
                             "整树不同**不得**阻断接受：否则接受命令必然失败")

    def test_accept_still_succeeds_when_the_two_trees_happen_to_be_equal(self):
        """两棵树**恰好相同**时也必须照常接受 —— 恰好相等是允许的，不是必要条件。"""
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            declared_tree = r["manifest_data"]["source_state"]["source_tree_sha"]
            with self._fake_git(r["manifest"], tree=declared_tree):
                m = B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            self.assertEqual(m["run_status"], B.STATUS_ACCEPTED)
            self.assertEqual(m["acceptance_record"]["accepted_master_tree_sha"], declared_tree)

    # ---- 校验①：执行提交必须是 `<SHA>` 的祖先 ----

    def test_accept_refuses_when_execution_commit_is_not_an_ancestor(self):
        """反例：`<SHA>` 里不含本次执行所依据的源码（B1 PR 未合并 / 传错提交）⇒ 拒绝。"""
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            with self._fake_git(r["manifest"], ancestor_ok=False):
                with self.assertRaises(B.FrozenAttestationError) as ctx:
                    B.accept_merge("deadbeef", manifest_path=r["manifest"],
                                   report_path=r["report"])
            msg = str(ctx.exception)
            self.assertIn("祖先", msg)
            self.assertIn("执行提交", msg)
            self.assertIn("拒绝", msg)
            on_disk = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            self.assertEqual(on_disk["run_status"], B.STATUS_PENDING_MERGE)

    def test_master_ref_is_informational_and_never_blocks(self):
        """`master_ref` 只是**信息性**标注：本地没有该引用时记录 `None`，**不得**阻断接受。

        契约要求的祖先关系是「**执行提交**是 `<SHA>` 的祖先」，与「`<SHA>` 是否在某个 ref 上」无关。
        把它做成拒绝条件会凭空造出一条本地环境相关的失败路径（早期版本的问题）。
        """
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            with self._fake_git(r["manifest"], master_ref_exists=False):
                m = B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            rec = m["acceptance_record"]
            self.assertEqual(m["run_status"], B.STATUS_ACCEPTED)
            self.assertIsNone(rec["accepted_master_commit_reachable_from_master_ref"])
            self.assertFalse(rec["master_ref_is_blocking"])

    def test_accept_refuses_when_manifest_lacks_source_tree_sha(self):
        """反例：旧 manifest 没记录 `source_state` ⇒ 无法证明「接受的是哪次执行的源码」⇒ 拒绝。"""
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            man = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            man.pop("source_state", None)
            Path(r["manifest"]).write_text(json.dumps(man, ensure_ascii=False), encoding="utf-8")
            with self._fake_git(r["manifest"]):
                with self.assertRaises(B.FrozenAttestationError) as ctx:
                    B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            self.assertIn("source_tree_sha", str(ctx.exception))

    # ---- 校验⓪：工作树干净（两态） ----

    def test_accept_refuses_when_attested_on_a_dirty_tree(self):
        """反例：**取证时**磁盘上有未提交的受控改动 ⇒ 组件哈希不代表实际运行字节 ⇒ 拒绝。"""
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            man = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            man["source_state"]["working_tree_dirty"] = True
            man["source_state"]["dirty_tracked_paths"] = ["ml/gen2/portfolio/regime.py"]
            Path(r["manifest"]).write_text(json.dumps(man, ensure_ascii=False), encoding="utf-8")
            with self._fake_git(r["manifest"]):
                with self.assertRaises(B.FrozenAttestationError) as ctx:
                    B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            self.assertIn("working_tree_dirty", str(ctx.exception))
            self.assertIn("重跑 B1", str(ctx.exception))

    def test_accept_refuses_when_the_working_tree_is_dirty_at_accept_time(self):
        """反例：**接受时**工作树脏 ⇒ 磁盘字节与提交字节脱钩 ⇒ 拒绝（先提交再接受）。"""
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            dirty = dict(self.CLEAN_SOURCE_STATE)
            dirty["working_tree_dirty"] = True
            dirty["dirty_tracked_paths"] = ["ml/gen2/baseline/b1_frozen_run.py"]
            with self._fake_git(r["manifest"], accept_state=dirty):
                with self.assertRaises(B.FrozenAttestationError) as ctx:
                    B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            msg = str(ctx.exception)
            self.assertIn("当前工作树脏", msg)
            self.assertIn("b1_frozen_run.py", msg)
            on_disk = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            self.assertEqual(on_disk["run_status"], B.STATUS_PENDING_MERGE,
                             "拒绝时不得半写接受记录")

    # ---- 校验②：逐项摘要一致（任一锁定路径变化必须拒绝） ----

    def test_accept_merge_refuses_when_a_locked_component_changed(self):
        """反例：取证后有人动了**锁定实现** ⇒ 逐项摘要不一致 ⇒ 拒绝，必须重跑 B1。"""
        target = B._abs("ml/gen2/baseline/selection_scores.py")
        self.assertTrue(target.is_file(), "反例目标文件缺失")
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            original = target.read_bytes()
            try:
                target.write_bytes(original + b"\n# tampered-after-attestation\n")
                with self._fake_git(r["manifest"]):
                    with self.assertRaises(B.FrozenAttestationError) as ctx:
                        B.accept_merge("HEAD", manifest_path=r["manifest"],
                                       report_path=r["report"])
            finally:
                target.write_bytes(original)  # 必须按原字节写回
            msg = str(ctx.exception)
            self.assertIn("拒绝", msg)
            self.assertIn("lock.component[", msg, "越界项应**逐项**定位到具体锁定路径")
            self.assertIn("lock.component_digest", msg, "折叠摘要也须同时失配")
            self.assertEqual(target.read_bytes(), original)

            on_disk = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            self.assertEqual(on_disk["run_status"], B.STATUS_PENDING_MERGE,
                             "拒绝时必须保持「待合并」，不得半写接受记录")
            self.assertNotIn("acceptance_record", on_disk)

    def test_accept_merge_refuses_when_the_b1_toolchain_changed(self):
        """反例：换了**执行代码**（B1 工具链）而规则锁一字未动 ⇒ 必须拒绝。

        「同一份冻结规则、换一套执行代码」是能改变读数的 —— 所以工具链逐项比对与规则同等重要。
        """
        target = B._abs("ml/gen2/backtest/costs.py")
        self.assertTrue(target.is_file(), "反例目标文件缺失")
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            original = target.read_bytes()
            try:
                target.write_bytes(original + b"\n# tampered-toolchain\n")
                with self._fake_git(r["manifest"]):
                    with self.assertRaises(B.FrozenAttestationError) as ctx:
                        B.accept_merge("HEAD", manifest_path=r["manifest"],
                                       report_path=r["report"])
            finally:
                target.write_bytes(original)
            msg = str(ctx.exception)
            self.assertIn("toolchain[", msg, "工具链变化应逐项定位")
            self.assertIn("toolchain.digest", msg)
            self.assertEqual(target.read_bytes(), original)

    def test_accept_merge_refuses_when_the_committed_report_changed(self):
        """反例：报告被改动（输出摘要不一致）⇒ 拒绝；输出摘要是四类校验的一部分。"""
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            rep = Path(r["report"])
            original = rep.read_bytes()
            try:
                rep.write_bytes(original + b"\n<!-- tampered -->\n")
                with self._fake_git(r["manifest"]):
                    with self.assertRaises(B.FrozenAttestationError) as ctx:
                        B.accept_merge("HEAD", manifest_path=r["manifest"],
                                       report_path=r["report"])
            finally:
                rep.write_bytes(original)
            self.assertIn("output[committed_report]", str(ctx.exception))

    # ---- 校验③：`<SHA>` 树中必须含已承诺证据且哈希匹配 ----

    def test_accept_refuses_when_evidence_is_missing_from_the_merge_tree(self):
        """反例：报告**不在** `<SHA>` 的树里（例如 B1 PR 只合并了一部分）⇒ 拒绝。

        「本地有这份报告」证明不了「合并进去的是这份报告」—— 所以必须查**提交里的 blob**。
        """
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            md = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            rep_rel = B._rel(B._abs(md["outputs"]["committed_report"]["file"]))
            with self._fake_git(r["manifest"], blob_missing=(rep_rel,)):
                with self.assertRaises(B.FrozenAttestationError) as ctx:
                    B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            msg = str(ctx.exception)
            self.assertIn("未包含已承诺证据", msg)
            self.assertIn("run_report", msg)

    def test_accept_refuses_when_evidence_hash_mismatches(self):
        """反例：审计快照在树里的**内容哈希**与承诺值不符 ⇒ 拒绝（归因依据被替换过）。"""
        with tempfile.TemporaryDirectory() as tmp:
            r = self._run(tmp)
            md = json.loads(Path(r["manifest"]).read_text(encoding="utf-8"))
            snap_rel = md["attribution"]["audit_baseline"]["snapshot_file"]
            with self._fake_git(r["manifest"], blob_override={snap_rel: "0" * 64}):
                with self.assertRaises(B.FrozenAttestationError) as ctx:
                    B.accept_merge("HEAD", manifest_path=r["manifest"], report_path=r["report"])
            msg = str(ctx.exception)
            self.assertIn("哈希不匹配", msg)
            self.assertIn("audit_baseline", msg)


class SourceMutationTest(unittest.TestCase):
    """⑧ 执行窗口内源改动 = **正确的 fail-closed 中止**（`ABORTED_SOURCE_MUTATED`）。

    背景：门禁首跑报 44/45 时，失败项不是缺陷，而是「跑测试期间仓库被改」导致的
    「读数与源码对不上」。这类情形必须被**显式认出并作废**，不能混在泛化的哈希失配里当成
    「假失败」（措辞会误导人去查不存在的缺陷）。
    """

    def test_head_moved_is_detected(self):
        baseline = {"git_head_commit": "a" * 40}
        with mock.patch.object(B, "_git", side_effect=lambda *a: "b" * 40):
            rep = B.source_mutation_report(baseline, [])
        self.assertTrue(rep["mutated"])
        self.assertEqual(rep["status_if_mutated"], B.STATUS_ABORTED_SOURCE_MUTATED)
        self.assertEqual(rep["modified"][0]["kind"], "head_moved")

    def test_run_implementation_change_is_detected(self):
        impl = [{"id": "ledger", "file": "ml/gen2/backtest/ledger.py", "sha256": "c" * 64}]
        with mock.patch.object(B, "_git", side_effect=lambda *a: "a" * 40), \
                mock.patch.object(B, "_sha", side_effect=lambda p: "d" * 64):
            rep = B.source_mutation_report({"git_head_commit": "a" * 40}, impl)
        self.assertTrue(rep["mutated"])
        self.assertEqual(rep["modified"][0]["kind"], "file_changed")
        self.assertEqual(rep["modified"][0]["id"], "ledger")

    def test_static_source_is_not_reported_as_mutated(self):
        """静默窗口：HEAD 未动 + 运行实现哈希未变 ⇒ 不得误报（否则正常运行会被作废）。"""
        impl = [{"id": "ledger", "file": "ml/gen2/backtest/ledger.py", "sha256": "c" * 64}]
        with mock.patch.object(B, "_git", side_effect=lambda *a: "a" * 40), \
                mock.patch.object(B, "_sha", side_effect=lambda p: "c" * 64):
            rep = B.source_mutation_report({"git_head_commit": "a" * 40}, impl)
        self.assertFalse(rep["mutated"])
        self.assertEqual(rep["modified"], [])

    def test_abort_status_is_a_distinct_code_not_a_generic_failure(self):
        """`ABORTED_SOURCE_MUTATED` 必须是**独立状态码**（三种运行状态互不相同）。"""
        codes = {B.STATUS_PENDING_MERGE, B.STATUS_ACCEPTED, B.STATUS_ABORTED_SOURCE_MUTATED}
        self.assertEqual(len(codes), 3)


class GitBlobEvidenceTest(unittest.TestCase):
    """③ 的底层能力：从**提交里的 blob** 取内容哈希，且与磁盘侧同一口径（CRLF→LF）。"""

    #: 测试从不改写它（冻结清单），所以「磁盘内容 == HEAD 内容」是稳定的。
    PROBE = "ml/gen2/manifests/GEN2_RULE_V2_LOCK.json"

    def setUp(self):
        # 前提：当前目录是一个 git 工作区（本地检出、`git worktree`、CI 的 actions/checkout
        # 都满足）。`git archive` 导出的源码包没有 `.git` ⇒ 该能力无从验证，
        # 显式跳过而不是制造一条与实现无关的「失败」。
        if B._git("rev-parse", "--is-inside-work-tree") != "true":
            raise unittest.SkipTest(
                "非 git 工作区（源码导出包）→ blob 证据能力在检出环境验证")

    def test_blob_hash_equals_disk_normalized_hash(self):
        self.assertTrue(B._abs(self.PROBE).is_file())
        blob = B._git_blob_sha256("HEAD", self.PROBE)
        self.assertIsNotNone(blob, "应能从 HEAD 树中取到该 blob（git cat-file blob 可用）")
        self.assertEqual(blob, B.normalized_sha256(self.PROBE),
                         "blob 哈希必须与磁盘归一化哈希同口径（本机磁盘是 CRLF，故归一化必需）")

    def test_missing_path_yields_none(self):
        self.assertIsNone(B._git_blob_sha256("HEAD", "no/such/path.txt"))

    def test_evidence_row_flags_missing_and_mismatch(self):
        present = B._evidence_row("HEAD", self.PROBE, role="audit_baseline",
                                  expected=B.normalized_sha256(self.PROBE))
        self.assertTrue(present["present_in_merge_tree"])
        self.assertTrue(present["matches"])
        missing = B._evidence_row("HEAD", "no/such/path.txt", role="run_report", expected="x")
        self.assertFalse(missing["present_in_merge_tree"])
        self.assertFalse(missing["matches"])



if __name__ == "__main__":
    unittest.main(verbosity=2)
