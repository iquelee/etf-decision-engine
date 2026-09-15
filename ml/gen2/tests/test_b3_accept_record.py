"""B3 接受记录回归（`ml/gen2/baseline/b3_accept_record.py`）。

设计原则（沿用本项目纪律）：
  * 夹具**不能自证**：核对类断言必须让「正确的输入通过、错误的输入失败」两侧都跑到；
  * **不依赖本地日线池**：只用已入库的 manifest / 报告（CI 与本地一致）；
  * 本文件在**接受记录写入前、写入后都必须绿**（CI 跑的是已接受的那棵树）——
    因此对 `run_status` 只断言「落在允许集合内」，不写死 `PENDING_REVIEW`。
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

from gen2.baseline import b3_accept_record as acc
from gen2.baseline import b3_frozen_oos as b3
from gen2.baseline import b1_frozen_run as b1
from gen2.baseline.b1_frozen_run import FrozenAttestationError, _sha
from gen2.data.loader import GEN2_ROOT

MANIFEST = GEN2_ROOT / "manifests" / "GEN2_B3_FROZEN_OOS_MANIFEST_20260915.json"
REPORT = GEN2_ROOT / "reports" / "gen2_b3_frozen_oos_20260915.md"


def _clean_state() -> dict:
    return {"working_tree_dirty": False, "dirty_tracked_paths": [], "git_head_commit": "x",
            "source_tree_sha": "y"}


def _dirty_state() -> dict:
    return {"working_tree_dirty": True, "dirty_tracked_paths": ["ml/x.py"],
            "git_head_commit": "x", "source_tree_sha": "y"}


class _Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        cls.disk = REPORT.read_text(encoding="utf-8")
        cls.econ = pd.DataFrame(cls.m["oos_econ"])
        cls.yearly = pd.DataFrame(cls.m["yearly_returns"])
        cls.raw = acc._render_raw(cls.m, cls.econ, cls.yearly)


# ---------------------------------------------------------------- 锚点

class AnchorsTest(_Base):
    def test_four_anchors_hit_exactly_once_in_real_report(self):
        for name, a in (("TITLE", acc.TITLE_OLD), ("STATUS", acc.STATUS_OLD),
                        ("BOUNDARY", acc.BOUNDARY_OLD), ("DISPOSITION", acc.DISPOSITION_OLD)):
            with self.subTest(anchor=name):
                self.assertEqual(1, self.raw.count(a),
                                 "锚点必须唯一命中，否则接受记录无法安全改写措辞")

    def test_apply_replaces_all_four(self):
        out = acc._apply_accepted_wording(self.raw)
        self.assertNotIn(acc.TITLE_OLD, out)
        self.assertNotIn(acc.STATUS_OLD, out)
        self.assertNotIn(acc.DISPOSITION_OLD, out)
        self.assertIn(acc.TITLE_NEW, out)
        self.assertIn(acc.STATUS_NEW, out)
        self.assertIn(acc.STATUS_BLOCK, out)

    def test_apply_raises_when_anchor_missing(self):
        broken = self.raw.replace(acc.TITLE_OLD, "# 标题被改掉了")
        with self.assertRaises(FrozenAttestationError):
            acc._apply_accepted_wording(broken)

    def test_apply_raises_when_anchor_duplicated(self):
        dup = self.raw + "\n" + acc.DISPOSITION_OLD + "\n"
        with self.assertRaises(FrozenAttestationError):
            acc._apply_accepted_wording(dup)

    def test_apply_is_wording_only(self):
        """改写**只**动措辞：3 行被替换 + 4 行状态口径块，其余逐行不变。"""
        out = acc._apply_accepted_wording(self.raw).splitlines()
        src = self.raw.splitlines()
        self.assertEqual(len(src) + 4, len(out), "只应新增 4 行状态口径块")
        removed = [l for l in src if l not in out]
        added = [l for l in out if l not in src]
        self.assertEqual(3, len(removed), "应恰有 3 行被替换：%s" % removed)
        self.assertEqual(7, len(added), "应恰有 7 行为新文字（3 替换 + 4 块）：%s" % added)


# ---------------------------------------------------------------- 正文可追溯

class ReproductionTest(_Base):
    def test_disk_report_matches_current_status(self):
        """磁盘报告必须与当前 `run_status` 对应的渲染结果**逐字**一致：

        接受**前** = `_render_raw`（「待裁决」）；接受**后** = `render_accepted_report`
        （「失败取证已接受」）。这样本文件在接受记录写入**前后都绿**，且**始终**在验证
        「从 manifest 复原数据 → 重渲染 == 磁盘」，而不是把某一版措辞写死。
        """
        expected = (self.raw if self.m["run_status"] == acc.STATUS_PENDING_REVIEW
                    else acc.render_accepted_report(self.m, self.econ, self.yearly))
        self.assertEqual(expected, self.disk)

    def test_assert_report_reproduces_passes_on_pending_report(self):
        """提交时那份「待裁决」报告必须能从 manifest 复原出来（接受后由 git 侧取证）。"""
        if self.m["run_status"] != acc.STATUS_PENDING_REVIEW:
            self.skipTest("磁盘报告已是改写版；追溯性由 bound_digests + 合并树 blob 证明")
        acc.assert_report_reproduces(self.m, self.econ, self.yearly, self.disk)

    def test_assert_report_reproduces_raises_on_tampered_text(self):
        with self.assertRaises(FrozenAttestationError):
            acc.assert_report_reproduces(self.m, self.econ, self.yearly,
                                         self.disk.replace("## 1. 一句话结论", "## 1. 结论"))

    def test_raw_render_omits_self_hash_row(self):
        """§13 不得出现「（本报告）」行 —— 否则会显示**旧**哈希却标注本报告（误导）。"""
        self.assertNotIn("（本报告）", self.raw)
        self.assertNotIn(self.m["outputs"]["committed_report"]["sha256"], self.raw)

    def test_render_accepted_report_is_rendered_status_independent(self):
        """无论 manifest 当前处于哪个状态，接受版正文都必须相同（幂等）。"""
        a = acc.render_accepted_report(self.m, self.econ, self.yearly)
        m2 = json.loads(json.dumps(self.m))
        m2["run_status"] = acc.STATUS_ACCEPTED_FAIL
        b = acc.render_accepted_report(m2, self.econ, self.yearly)
        self.assertEqual(a, b)


# ---------------------------------------------------------------- 状态契约

class StatusContractTest(_Base):
    def test_terminal_status_differs_from_b1(self):
        """B3 终态是 ACCEPTED_FAIL，**不是** B1 的 ACCEPTED（接受的是失败结论）。"""
        self.assertNotEqual(acc.STATUS_ACCEPTED_FAIL, b1.STATUS_ACCEPTED)
        self.assertEqual("ACCEPTED_FAIL", acc.STATUS_ACCEPTED_FAIL)

    def test_run_status_in_allowed_set(self):
        self.assertIn(self.m["run_status"],
                      {acc.STATUS_PENDING_REVIEW, acc.STATUS_ACCEPTED_FAIL})

    def test_verdict_is_fail(self):
        self.assertEqual("FAIL", self.m["criteria"]["verdict"])

    def test_accepted_report_contains_no_pending_review(self):
        out = acc.render_accepted_report(self.m, self.econ, self.yearly)
        self.assertNotIn(acc.STATUS_PENDING_REVIEW, out)
        self.assertIn(acc.STATUS_ACCEPTED_FAIL, out)
        self.assertIn("不等于通过", out)

    def test_accept_module_not_in_recorded_toolchain(self):
        """**本模块不得出现在 `run_implementation` 里** —— 这正是它必须是独立文件的原因：
        一旦 `b3_frozen_oos.py` 被改（例如为它加子命令），校验 ② 就会正确地拒绝写入。"""
        files = [e["file"] for e in self.m["run_implementation"]]
        self.assertNotIn("ml/gen2/baseline/b3_accept_record.py", files)

    def test_b3_entry_is_in_recorded_toolchain(self):
        files = [e["file"] for e in self.m["run_implementation"]]
        self.assertIn("ml/gen2/baseline/b3_frozen_oos.py", files)

    def test_accept_branch_is_not_the_run_branch(self):
        self.assertNotEqual(acc.ACCEPT_BRANCH, "feat/gen2-b3-frozen-oos")


# ---------------------------------------------------------------- 已承诺证据

class EvidenceTest(_Base):
    def test_evidence_roles_and_expectations(self):
        rows = acc.b3_committed_evidence("HEAD", self.m, MANIFEST,
                                        already=False, report_expected="x" * 64)
        self.assertEqual(["run_report", "run_manifest", "protocol"],
                         [r["role"] for r in rows])
        proto = next(r for r in rows if r["role"] == "protocol")
        self.assertEqual(self.m["protocol"]["file"], proto["path"])
        self.assertEqual(self.m["protocol"]["sha256"], proto["expected_sha256"])

    def test_missing_blob_is_not_present_and_not_matching(self):
        row = acc._evidence_row("HEAD", "no/such/file.md", role="protocol", expected="a" * 64)
        self.assertFalse(row["present_in_merge_tree"])
        self.assertFalse(row["matches"])
        self.assertIsNone(row["blob_sha256"])

    def test_real_evidence_blobs_present_in_head(self):
        """当前 HEAD 的树里必须能找到这三份产物（本地 = 已合并的那棵树）。"""
        rows = acc.b3_committed_evidence("HEAD", self.m, MANIFEST,
                                        already=False,
                                        report_expected=self.m["outputs"]["committed_report"]["sha256"])
        for r in rows:
            with self.subTest(role=r["role"]):
                self.assertTrue(r["present_in_merge_tree"],
                                "HEAD 树里找不到 %s" % r["path"])

    def test_protocol_expected_is_not_none(self):
        """协议哈希是 B3「判据结果前冻结」的唯一凭据，不能缺。"""
        self.assertTrue(self.m["protocol"]["sha256"])

    def test_accepted_tree_contains_pre_accept_report_blob(self):
        """接受记录承诺的**接受前**报告哈希，必须仍能在**被接受的合并树**里找到 blob。

        这是接受后仍可机器复核的追溯链：磁盘报告已被改写 ⇒ 原件的存在性只能由
        「PR #33 合并提交的树里那个 blob」来证明，而不是靠磁盘。
        """
        rec = self.m.get("acceptance_record")
        if not rec:
            self.skipTest("尚未写入接受记录")
        old = rec["bound_digests"]["committed_report_sha256"]
        new = self.m["outputs"]["committed_report"]["sha256"]
        self.assertNotEqual(old, new, "接受后报告哈希必须变化（措辞改写）")
        path = acc._rel(acc._abs(self.m["outputs"]["committed_report"]["file"]))
        self.assertEqual(old, b1._git_blob_sha256(rec["accepted_master_commit"], path))
        self.assertEqual(new, _sha(REPORT))


# ---------------------------------------------------------------- 接受记录结构

class AcceptanceRecordShapeTest(_Base):
    def test_record_shape_if_present(self):
        rec = self.m.get("acceptance_record")
        if not rec:
            self.skipTest("尚未写入接受记录（本文件在接受记录写入前后都必须绿）")
        self.assertEqual(acc.STATUS_ACCEPTED_FAIL, rec["status"])
        self.assertEqual("FAIL", rec["verdict"])
        self.assertTrue(rec["verdict_unchanged_by_acceptance"])
        self.assertEqual("NOT_PRODUCTION_ELIGIBLE", rec["economic_eligibility"])
        self.assertTrue(rec["no_rerun_required"])
        self.assertFalse(rec["trees_required_to_be_equal"])
        self.assertTrue(rec["landed_via_pull_request_required"])
        self.assertEqual(acc.ACCEPT_BRANCH, rec["acceptance_branch"])
        for key in ("accepted_master_commit", "accepted_master_tree_sha",
                    "execution_head_commit", "accepted_manifest_input_sha256"):
            self.assertTrue(rec.get(key), "缺字段 %s" % key)
        bd = rec["bound_digests"]
        self.assertEqual(self.m["frozen_input"]["lock"]["lock_sha256"], bd["lock_sha256"])
        self.assertEqual(self.m["frozen_input"]["lock_component_digest"],
                         bd["lock_component_digest"])
        self.assertEqual(self.m["input_data"]["content_digest"], bd["input_content_digest"])
        self.assertEqual(self.m["protocol"]["sha256"], bd["protocol_sha256"])
        self.assertTrue(all(v["ok"] for v in rec["verifications"]))
        for e in rec["committed_evidence"]:
            self.assertTrue(e["present_in_merge_tree"] and e["matches"], str(e))


# ---------------------------------------------------------------- fail-closed

class FailClosedTest(unittest.TestCase):
    def test_refuses_when_worktree_dirty(self):
        with mock.patch.object(acc, "source_state", _dirty_state):
            with self.assertRaises(FrozenAttestationError) as cm:
                acc.accept_fail_merge("HEAD", manifest_path=MANIFEST)
        self.assertIn("工作树脏", str(cm.exception))

    def test_refuses_when_manifest_lacks_source_state(self):
        m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        m.pop("source_state", None)
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td) / "man.json"
            tmp.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(acc, "source_state", _clean_state):
                with self.assertRaises(FrozenAttestationError) as cm:
                    acc.accept_fail_merge("HEAD", manifest_path=tmp)
        self.assertIn("source_state", str(cm.exception))

    def test_refuses_when_attestation_was_dirty(self):
        m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        m["source_state"]["working_tree_dirty"] = True
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td) / "man.json"
            tmp.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(acc, "source_state", _clean_state):
                with self.assertRaises(FrozenAttestationError) as cm:
                    acc.accept_fail_merge("HEAD", manifest_path=tmp)
        self.assertIn("取证时", str(cm.exception))

    def test_refuses_when_toolchain_digest_differs(self):
        """改一处**被记录的工具链**摘要 ⇒ 校验 ② 必须拒绝（并指出是哪一条）。"""
        m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        m["run_implementation"][0]["sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td) / "man.json"
            tmp.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(acc, "source_state", _clean_state):
                with self.assertRaises(FrozenAttestationError) as cm:
                    acc.accept_fail_merge("HEAD", manifest_path=tmp)
        self.assertIn("toolchain", str(cm.exception))

    def test_refuses_unresolvable_master_commit(self):
        with mock.patch.object(acc, "source_state", _clean_state):
            with self.assertRaises(FrozenAttestationError):
                acc.accept_fail_merge("no-such-commit-deadbeef", manifest_path=MANIFEST)


# ---------------------------------------------------------------- CLI

class CliTest(unittest.TestCase):
    def test_requires_accept_merge_flag(self):
        with mock.patch.object(sys, "argv", ["b3_accept_record"]):
            with self.assertRaises(SystemExit):
                acc.main()

    def test_requires_master_commit(self):
        with mock.patch.object(sys, "argv", ["b3_accept_record", "--accept-merge"]):
            with self.assertRaises(SystemExit):
                acc.main()


if __name__ == "__main__":
    unittest.main()
