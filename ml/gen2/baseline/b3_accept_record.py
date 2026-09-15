"""B3 Frozen OOS 的**接受记录**（失败取证收口）—— 与 B1 的 `b1_frozen_run.accept_merge()` 对称。

**终态不同**：B1 的终态是 `ACCEPTED`；B3 的终态是 **`ACCEPTED_FAIL`**。
「接受」的是**结论与证据**（`verdict = FAIL` 不变），**不是**「通过」——
它只是让运行状态不再永久停在 `PENDING_REVIEW`，并把这次运行正式归档为
**Rule V2.0.1 的经济失败基线**。

为什么是**独立模块**（而不是给 `b3_frozen_oos.py` 加一个子命令）
--------------------------------------------------------------
`ml/gen2/baseline/b3_frozen_oos.py` **本身**是 B3 manifest 的 `run_implementation`
记录条目之一（`b3_frozen_oos` → `2543233e…`）。接受记录的**校验 ②** 会拿**磁盘字节**
重算 `run_implementation` 的每一项 ⇒ 只要该文件改一个字节，接受就会（**正确地**）
拒绝写入（`b3_frozen_oos` 摘要不一致）。把接受逻辑放进**新文件**：

  * 被记录的工具链字节**保持不变** ⇒ 接受既合法、又可被第三方独立复核；
  * 同理，**报告措辞**也不能靠改 `render_report` 来变 —— 本模块复用
    `b3_frozen_oos.render_report()` 的正文，再对**状态锚点**做**断言式替换**
    （任一锚点未唯一命中即抛错，**绝不**静默产出仍写着 `PENDING_REVIEW` 的报告）。

契约（与 B1 同构，顺序即契约，任一不过即拒绝写入）
------------------------------------------------
⓪ **工作树干净**（两态）：接受时 `git status` 无受控改动；且 manifest 记录的**取证时**
   `working_tree_dirty=false`。任一为脏 ⇒ 磁盘字节与提交字节无法对应，哈希校验失去意义。

① **执行提交是 `<SHA>` 的祖先**：`source_state.git_head_commit` 必须是 `master_commit`
   的祖先 —— 证明「接受的就是这次执行所依据的那份源码」。

② **摘要逐位一致**：**锁定组件**（lock 文件 + `immutable_set` 逐项 + 折叠摘要）、
   **B3 工具链**（`run_implementation` 逐项 + 折叠摘要）、**输入摘要**、**输出摘要**
   （运行目录产物 + 报告）与 manifest **逐项**一致。不只比折叠摘要 —— 逐项才能指出
   「**哪一条路径**变了」。

③ **`<SHA>` 的树中包含已承诺证据且哈希匹配**：报告 / manifest / **协议**三个文件必须
   **存在于 `master_commit` 的树里**（拿**提交里的 blob** 算哈希，不是拿磁盘文件算），
   且分别匹配：报告 ← manifest 承诺的 `outputs.committed_report.sha256`；
   manifest ← 接受时所依据的那份 manifest 字节的哈希（自引用，故由本记录承诺）；
   协议 ← manifest `protocol.sha256`（**判据在结果前冻结**的那份文档）。

④ **另行记录**（不是相等要求）：`accepted_master_commit` / `accepted_master_tree_sha`
   / `execution_source_tree_sha`。⚠️ **不要求** `accepted_master_tree_sha ==
   execution_source_tree_sha`：报告 / manifest 是**执行之后**才提交的 ⇒ 两树**必然不同**。

运行::

    PYTHONPATH=ml python -m gen2.baseline.b3_accept_record \
        --accept-merge --master-commit <PR #33 的 merge SHA>
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

import pandas as pd

from gen2.baseline import b3_frozen_oos as b3
from gen2.baseline.b1_frozen_run import (
    FrozenAttestationError,
    _abs,
    _aggregate_digest,
    _git,
    _git_blob_sha256,
    _git_run,
    _join_run_dir,
    _rel,
    _sha,
    _write_manifest,
    source_state,
    verify_manifest,
)

# ---------------------------------------------------------------- 常量

MANIFEST_REL = "ml/gen2/manifests/GEN2_B3_FROZEN_OOS_MANIFEST_20260915.json"
REPORT_REL = "ml/gen2/reports/gen2_b3_frozen_oos_20260915.md"

STATUS_PENDING_REVIEW = b3.STATUS_PENDING_REVIEW          # "PENDING_REVIEW"
STATUS_ACCEPTED_FAIL = "ACCEPTED_FAIL"

#: 接受记录必须落在**独立分支**的独立 PR 上评审合并（与 B1 同一约定）。
ACCEPT_BRANCH = "chore/gen2-b3-accept-fail-v201"
DEFAULT_MASTER_REF = "origin/master"

# ---------------------------------------------------------------- 报告措辞改写

# 这四条锚点**逐字**来自 `b3_frozen_oos.render_report()` 的产出。命中数必须恰为 1，
# 否则抛错（fail-closed）—— 报告模板一旦变化，宁可拒绝写入也不能产出措辞错误的报告。
TITLE_OLD = "# Gen-2 B3 Frozen OOS 报告（冻结规则 · 样本外验证 · 待裁决）"
TITLE_NEW = "# Gen-2 B3 Frozen OOS 报告（冻结规则 · 样本外验证 · 失败取证已接受）"

STATUS_OLD = "｜ **状态**：`%s`（本地产出，待用户裁决）" % STATUS_PENDING_REVIEW
STATUS_NEW = ("｜ **状态**：`%s`（失败取证已接受；本报告为 Rule V2.0.1 的**经济失败基线**）"
              % STATUS_ACCEPTED_FAIL)

BOUNDARY_OLD = "- **边界**：离线只读；不部署、不提 authority、不写正式仓位；未改规则/参数/实现/样本边界/成本口径。"
STATUS_BLOCK = "\n".join([
    "> **状态口径**：接受记录已写入 manifest（`acceptance_record.accepted_master_commit` /",
    "> `accepted_master_tree_sha` / `execution_head_commit`）。本报告的措辞由接受记录 PR",
    "> （分支 `%s`）改写；`run_status = %s` = **失败取证已接受归档**，" % (ACCEPT_BRANCH, STATUS_ACCEPTED_FAIL),
    "> ⚠️ **不等于通过**：`verdict = FAIL` 不变，仍**不部署、不提 authority、不写正式仓位**。",
])
BOUNDARY_NEW = BOUNDARY_OLD + "\n" + STATUS_BLOCK

DISPOSITION_OLD = "- 本报告为**本地产出、待用户裁决**；`run_status = %s`。" % STATUS_PENDING_REVIEW
DISPOSITION_NEW = ("- 本报告**已随 B3 接受记录 PR 归档**为 Rule V2.0.1 的**经济失败基线**"
                   "（`run_status = %s`）；归档的是**结论与证据**，**不是**「通过」。" % STATUS_ACCEPTED_FAIL)

#: 四条锚点：报告模板若改动，命中数必然偏离 1 ⇒ 拒绝写入（见 `_apply_accepted_wording`）。
REPORT_ANCHORS = (TITLE_OLD, STATUS_OLD, BOUNDARY_OLD, DISPOSITION_OLD)


def _apply_accepted_wording(raw: str) -> str:
    """把「待裁决」措辞的报告正文改写为「失败取证已接受」措辞。

    **四个锚点各必须恰好命中一次**；否则抛 `FrozenAttestationError`。
    用断言而不是 `str.replace` 静默失败：报告模板变了就必须**拒绝写入**，
    而不是产出一份仍写着 `PENDING_REVIEW` 的「已接受」报告。
    """
    subs = ((TITLE_OLD, TITLE_NEW), (STATUS_OLD, STATUS_NEW),
            (BOUNDARY_OLD, BOUNDARY_NEW), (DISPOSITION_OLD, DISPOSITION_NEW))
    out = raw
    for old, new in subs:
        hits = out.count(old)
        if hits != 1:
            raise FrozenAttestationError(
                "接受记录**拒绝**写入：报告措辞锚点命中数 != 1（实际 %d）⇒ 报告模板已变，"
                "不能安全改写状态措辞。锚点：%r" % (hits, old[:100]))
        out = out.replace(old, new)
    return out


def _render_raw(m: dict, econ: pd.DataFrame, yearly: pd.DataFrame) -> str:
    """渲染「**与提交的那份逐字一致**」的原始正文（状态置回 `PENDING_REVIEW`）。

    两个刻意的还原动作 —— 否则重渲染出的正文会与磁盘上的报告**不同**：

    1. `run_status` 强制回到 `PENDING_REVIEW`：无论调用时 manifest 处于哪个状态，
       原始正文都确定可复现，锚点替换才有唯一解；
    2. **移除 `outputs.committed_report`**：运行期渲染发生在 `outputs` 写入**之前**
       （阶段 2），所以报告 §13 表里**没有**「本报告」那一行。若带着它渲染，会补出一行
       显示**旧哈希**却标注「（本报告）」—— 那是**误导**（接受后真实哈希已变）。
       一并去掉，才能保证「接受后的报告 = 提交的那份 + 仅措辞改动」。
    """
    base = copy.deepcopy(m)
    base["run_status"] = STATUS_PENDING_REVIEW
    base.setdefault("outputs", {}).pop("committed_report", None)
    return b3.render_report(base, econ, yearly)


def assert_report_reproduces(m: dict, econ: pd.DataFrame, yearly: pd.DataFrame,
                             disk_text: str) -> None:
    """断言「从 manifest 复原数据重渲染 **==** 磁盘上被承诺的那份报告」。

    这是「**接受只改措辞、不动正文**」的**机器证明**。不相等 ⇒ 说明正文复原不出来
    （模板变了 / manifest 被改 / 磁盘报告不是那次运行的那份）⇒ **拒绝写入**，
    而不是产出一份无法追溯到原件的「已接受」报告。
    """
    raw = _render_raw(m, econ, yearly)
    if raw == disk_text:
        return
    a, b = raw.splitlines(), disk_text.splitlines()
    first = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
    ctx = "\n".join("%s | %s" % (x[:110], y[:110])
                    for x, y in zip(a[first:first + 3], b[first:first + 3]))
    raise FrozenAttestationError(
        "接受记录**拒绝**写入：从 manifest 复原数据**重渲染不出**磁盘上被承诺的那份报告"
        "（行数 rerender=%d / disk=%d，首个差异在第 %d 行）⇒ 正文不可追溯，"
        "不能只改措辞。差异上下文（左=rerender，右=disk）：\n%s" % (len(a), len(b), first + 1, ctx))


def render_accepted_report(m: dict, econ: pd.DataFrame, yearly: pd.DataFrame) -> str:
    """产出「失败取证已接受」措辞的报告正文（**不含**自身哈希，无自引用）。

    ⚠️ 复用 `b3_frozen_oos.render_report()` 而**不是**重写模板、也**不是**去改
    `b3_frozen_oos.py`（它是 `run_implementation` 的记录条目，改一字节即令校验 ② 失败）。
    """
    return _apply_accepted_wording(_render_raw(m, econ, yearly))


# ---------------------------------------------------------------- 已承诺证据

def _evidence_row(commit: str, path: str, *, role: str, expected: str | None) -> dict:
    """核一条「已承诺证据」：`path` 是否**存在于 `commit` 的树里**，且其 **blob** 哈希匹配期望值。"""
    blob = _git_blob_sha256(commit, path)
    return {
        "role": role,
        "path": path,
        "present_in_merge_tree": blob is not None,
        "blob_sha256": blob,
        "expected_sha256": expected,
        "matches": bool(blob) and bool(expected) and blob == expected,
    }


def b3_committed_evidence(commit: str, m: dict, manifest_path: str | Path, *,
                          already: bool, report_expected: str | None) -> list[dict]:
    """核对「**执行之后**才提交进 B3 分支」的三份产物是否真的在 `commit` 的树里，且哈希匹配。

    与 B1 的 `committed_evidence()` 同构，但第三条不同：
      * B1 第三条是「审计快照」（§9 归因的依据）；
      * B3 第三条是「**协议文档**」—— 判据在结果前冻结的那份 `plan`，其哈希由
        manifest `protocol.sha256` 承诺。协议是 B3 论证「判据不是事后定的」的**唯一凭据**，
        所以必须和报告、manifest 一样被绑进合并提交的树里。

    期望值来源（都是**已被承诺**的值，不是新约定）：
      * `run_report`   ← manifest `outputs.committed_report.sha256`（复跑时回退到首次接受承诺值）；
      * `run_manifest` ← 自引用（manifest 记不了自身哈希）⇒ 由**接受记录**承诺
        `accepted_manifest_input_sha256`，复跑时以它为准；
      * `protocol`     ← manifest `protocol.sha256`。
    """
    man = Path(manifest_path)
    rep_rel = _rel(_abs(((m.get("outputs") or {}).get("committed_report") or {}).get("file")
                        or m["report"]))
    man_rel = _rel(man)
    man_expected = (((m.get("acceptance_record") or {}).get("accepted_manifest_input_sha256"))
                    if already else _sha(man))
    proto = m.get("protocol") or {}
    return [
        _evidence_row(commit, rep_rel, role="run_report", expected=report_expected),
        _evidence_row(commit, man_rel, role="run_manifest", expected=man_expected),
        _evidence_row(commit, proto.get("file") or "", role="protocol",
                      expected=proto.get("sha256")),
    ]


# ---------------------------------------------------------------- 接受记录

def accept_fail_merge(master_commit: str,
                      manifest_path: str | Path | None = None,
                      report_path: str | Path | None = None,
                      master_ref: str = DEFAULT_MASTER_REF) -> dict:
    """把 B3 失败运行**绑定到 PR #33 的合并提交**，写入接受记录（`ACCEPTED_FAIL`）。

    **这条命令会修改受版本控制的 manifest / 报告** ⇒ 在受保护的 `master` 下它**不是**
    「PR #33 合并后跑一下就算完成」的动作，而必须落在**独立的接受记录 PR**
    （分支 `chore/gen2-b3-accept-fail-v201`）里评审、合并；该 PR 合并后才可正式归档为
    「**Rule V2.0.1 已接受的经济失败基线**」。

    四校验见模块 docstring；全过才写 `acceptance_record` 与 `run_status = ACCEPTED_FAIL`，
    并把报告措辞改为「失败取证已接受」。这一步落实的正是「**内容哈希不变则无需重跑**」——
    该前提是被**校验**的，不是被约定的；**本命令不重跑 B3，也不改变 `verdict = FAIL`**。
    """
    man = Path(manifest_path) if manifest_path else _abs(MANIFEST_REL)
    m = json.loads(man.read_text(encoding="utf-8"))

    already = m.get("run_status") == STATUS_ACCEPTED_FAIL
    prev_rec = m.get("acceptance_record") or {}
    rep_obj = (m.get("outputs") or {}).get("committed_report") or {}
    rep_now_path = _abs(rep_obj.get("file") or m["report"])
    # 报告期望值：**首跑**时磁盘报告就是被承诺的那份（= manifest 记录的哈希）；**复跑**时磁盘报告
    # 已被本命令改写成「已接受」版本 ⇒ 期望值回退到**首次接受**时承诺的哈希（见校验 ③）。
    rep_expected = (rep_obj.get("sha256") if not already
                    else (prev_rec.get("bound_digests") or {}).get("committed_report_sha256"))

    # ---- 校验 ⓪：工作树干净（接受时 + 取证时，两态都要）----
    now_state = source_state()
    if now_state["working_tree_dirty"]:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：**当前工作树脏**（未提交的受控改动：%s）⇒ 磁盘字节与 `<SHA>` "
            "树中的字节无法对应，摘要校验失去意义。请先提交 / 清理工作树，再运行接受命令。"
            % (", ".join(now_state["dirty_tracked_paths"] or []) or "未识别"))

    ss = m.get("source_state") or {}
    execution_head_declared = ss.get("git_head_commit")
    execution_tree = ss.get("source_tree_sha")
    if not execution_tree or not execution_head_declared:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：manifest 未记录 `source_state.git_head_commit` / "
            "`source_tree_sha`（取证版本过旧）⇒ 无法证明「接受的是哪次执行的源码」⇒ 必须重跑 B3。")
    if ss.get("working_tree_dirty"):
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：**取证时** `working_tree_dirty=true`（未提交的受控改动：%s）"
            "⇒ 组件 / 工具链哈希不代表实际参与运行的字节。请先提交，再**重跑 B3**。"
            % (", ".join(ss.get("dirty_tracked_paths") or []) or "未识别"))

    # ---- 校验 ①：**执行提交**必须是 `<SHA>` 的祖先 ----
    resolved_master = _git("rev-parse", master_commit)
    if not resolved_master:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：`%s` 在本地不可解析（不是本仓库的提交）。" % master_commit)
    execution_head = _git("rev-parse", execution_head_declared) or execution_head_declared
    anc = _git_run("merge-base", "--is-ancestor", execution_head, resolved_master)
    if anc is None:
        raise FrozenAttestationError("接受记录**拒绝**写入：无法执行 git（仓库不可用）。")
    if anc.returncode != 0:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：**执行提交** `%s` **不是** `%s` 的祖先 ⇒ 无法证明 `<SHA>` 包含"
            "本次执行所依据的源码（B3 PR 未合并 / 传错提交 / 分支被重写？）。"
            "请传入 PR #33 合并进 `master` 之后的那次提交。"
            % (execution_head, resolved_master))
    master_tree = _git("rev-parse", "%s^{tree}" % resolved_master)
    if not master_tree:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：无法解析 `%s^{tree}`。" % resolved_master)

    # ---- 校验 ②：锁定组件 / B3 工具链 / 输入 / 输出摘要**逐项**逐位一致 ----
    declared: dict = {}
    recomputed: dict = {}

    def _cmp(key: str, expected, actual) -> None:
        declared[key] = expected
        recomputed[key] = actual

    fi = m["frozen_input"]
    _cmp("lock.lock_sha256", fi["lock"]["lock_sha256"], _sha(fi["lock"]["lock_file"]))
    for e in fi["immutable_set"]:
        _cmp("lock.component[%s]" % e["id"], e["actual"], _sha(e["file"]))
    _cmp("lock.component_digest", fi["lock_component_digest"],
         _aggregate_digest([(e["id"], _sha(e["file"]) or "") for e in fi["immutable_set"]]))

    for e in m["run_implementation"]:
        _cmp("toolchain[%s]" % e["id"], e["sha256"], _sha(e["file"]))
    _cmp("toolchain.digest",
         _aggregate_digest([(e["id"], e["sha256"]) for e in m["run_implementation"]]),
         _aggregate_digest([(e["id"], _sha(e["file"]) or "") for e in m["run_implementation"]]))

    for f in m["input_data"]["files"]:
        _cmp("input.daily[%s]" % f["code"], f["sha256"], _sha(f["file"]))
    for e in m["input_data"]["meta_files"]:
        _cmp("input.meta[%s]" % e["id"], e["sha256"], _sha(e["file"]))
    _cmp("input.content_digest", m["input_data"]["content_digest"],
         _aggregate_digest([("daily:%s" % f["code"], _sha(f["file"]) or "")
                            for f in m["input_data"]["files"]]
                           + [("meta:%s" % e["id"], _sha(e["file"]) or "")
                              for e in m["input_data"]["meta_files"]]))

    for a in m["artifacts"]:
        _cmp("output[%s]" % a["file"], a["sha256"], _sha(_join_run_dir(m, a)))
    if rep_expected and not already:
        _cmp("output[committed_report]", rep_expected, _sha(rep_now_path))

    diffs = {k: {"declared": declared[k], "recomputed": recomputed[k]}
             for k in declared if declared[k] != recomputed[k]}
    if diffs:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：锁定组件 / B3 工具链 / 输入 / 输出摘要与 B3 manifest 不一致 "
            "⇒ 必须重跑 B3。逐项差异：" + json.dumps(diffs, ensure_ascii=False))

    # ---- 校验 ③：`<SHA>` 的**树中**必须包含已承诺证据，且哈希匹配 ----
    evidence = b3_committed_evidence(resolved_master, m, man,
                                    already=already, report_expected=rep_expected)
    bad_evidence = [e for e in evidence if not (e["present_in_merge_tree"] and e["matches"])]
    if bad_evidence:
        raise FrozenAttestationError(
            "接受记录**拒绝**写入：`%s` 的树中未包含已承诺证据，或哈希不匹配 ⇒ 合并进去的不是本次"
            "运行承诺的那份产物（报告 / manifest / 协议）。明细：%s"
            % (resolved_master, json.dumps(bad_evidence, ensure_ascii=False)))

    # ---- 记录 ④：三项 SHA + 信息性 master-ref 可达性（**不作拒绝条件**）----
    reach = None
    if _git("rev-parse", "--verify", "--quiet", master_ref):
        rr = _git_run("merge-base", "--is-ancestor", resolved_master, master_ref)
        reach = (rr.returncode == 0) if rr is not None else None

    m["acceptance_record"] = {
        "status": STATUS_ACCEPTED_FAIL,
        "accepted_master_commit": resolved_master,
        "accepted_master_commit_input": master_commit,
        "accepted_master_tree_sha": master_tree,
        "execution_head_commit": execution_head,
        "execution_source_tree_sha": execution_tree,
        "execution_head_is_ancestor_of_accepted_master_commit": True,
        "trees_required_to_be_equal": False,
        "tree_relation": "accepted_master_tree_contains_committed_evidence",
        "tree_relation_note": (
            "`accepted_master_tree_sha` = **接受时仓库快照**，`execution_source_tree_sha` = "
            "**执行时语义源码快照**。报告 / manifest 是**执行之后**才被提交进 B3 分支的 "
            "⇒ 两者**应当不同**；**不要求相等**。二者的关联由校验 ② 的摘要族与校验 ③ 的"
            "已承诺证据哈希建立。"),
        "accepted_manifest_input_sha256": _sha(man),
        "committed_evidence": evidence,
        "master_ref": master_ref,
        "master_ref_is_blocking": False,
        "accepted_master_commit_reachable_from_master_ref": reach,
        "accepted_at": pd.Timestamp.now("UTC").isoformat(),
        "digests_unchanged": True,
        "no_rerun_required": True,
        "verdict": (m.get("criteria") or {}).get("verdict"),
        "verdict_unchanged_by_acceptance": True,
        "economic_eligibility": "NOT_PRODUCTION_ELIGIBLE",
        "verifications": [
            {"check": "working_tree_clean_at_accept", "ok": True,
             "dirty_tracked_paths": now_state["dirty_tracked_paths"]},
            {"check": "working_tree_clean_at_attestation", "ok": True,
             "dirty_tracked_paths": ss.get("dirty_tracked_paths") or []},
            {"check": "execution_head_is_ancestor_of_accepted_master_commit",
             "execution_head_commit": execution_head,
             "accepted_master_commit": resolved_master, "ok": True},
            {"check": "digests_unchanged", "compared_items": sorted(declared), "ok": True},
            {"check": "accepted_master_tree_contains_committed_evidence",
             "committed_evidence": evidence, "ok": True},
        ],
        "bound_digests": {
            "lock_sha256": declared["lock.lock_sha256"],
            "lock_component_digest": declared["lock.component_digest"],
            "toolchain_digest": declared["toolchain.digest"],
            "input_content_digest": declared["input.content_digest"],
            "committed_report_sha256": rep_expected,
            "accepted_manifest_input_sha256": _sha(man),
            "protocol_sha256": next((e["expected_sha256"] for e in evidence
                                     if e["role"] == "protocol"), None),
            "run_dir_artifacts": {a["file"]: a["sha256"] for a in m["artifacts"]},
        },
        "acceptance_branch": ACCEPT_BRANCH,
        "landed_via_pull_request_required": True,
        "note": ("本记录由 `--accept-merge` 写出，**会修改受版本控制的 manifest / 报告** ⇒ "
                 "必须落在独立分支 `%s` 的**接受记录 PR** 上评审合并。该 PR 合并**之后**，"
                 "本次运行才正式归档为「**Rule V2.0.1 已接受的经济失败基线**」。"
                 "四项校验全过（⓪ 工作树干净（接受 + 取证两态）/ ① 执行提交 `%s` 是 `%s` 的祖先 / "
                 "② 锁定组件·工具链·输入·输出摘要**逐项**一致 / ③ `<SHA>` 树含报告·manifest·"
                 "协议且哈希匹配）⇒ **无需重跑**，只做绑定。"
                 "⚠️ `run_status = %s` 表示**失败取证已接受归档**，**不表示通过**："
                 "`verdict = FAIL` 不变，Rule V2.0.1 **不具备生产资格**。"
                 % (ACCEPT_BRANCH, (execution_head or "")[:12], (resolved_master or "")[:12],
                    STATUS_ACCEPTED_FAIL)),
    }
    m["run_status"] = STATUS_ACCEPTED_FAIL
    m["run_status_note"] = (
        "**失败取证已接受归档**（见 `acceptance_record`）：本次运行绑定到 B3 PR #33 的合并提交 "
        "`%s`。⚠️ 接受的是**结论与证据**，**不是**「通过」——`verdict = FAIL` 不变，"
        "Rule V2.0.1 **不具备生产资格**；不部署、不提 authority、不写正式仓位。"
        % (resolved_master or "")[:12])

    out_dir = _abs(m["run_dir"])
    rep = Path(report_path) if report_path else rep_now_path
    econ = pd.DataFrame(m["oos_econ"])
    yearly = pd.DataFrame(m["yearly_returns"])
    # 「只改措辞、不动正文」的机器证明 —— 必须在**改写之前**读原件比对。
    assert_report_reproduces(m, econ, yearly, rep.read_text(encoding="utf-8"))
    rep.write_text(render_accepted_report(m, econ, yearly), encoding="utf-8")

    m.setdefault("outputs", {})["committed_report"] = {
        "file": _rel(rep), "exists": rep.is_file(),
        "sha256": _sha(rep), "bytes": rep.stat().st_size if rep.is_file() else None,
    }
    m["self_check"] = verify_manifest(m)
    if not m["self_check"]["all_pass"]:
        raise FrozenAttestationError(
            "接受记录写入后自校验失败："
            + json.dumps(m["self_check"]["detail"], ensure_ascii=False, default=str))
    _write_manifest(m, out_dir, man)
    return m


# ---------------------------------------------------------------- CLI

def main() -> int:
    ap = argparse.ArgumentParser(
        description="B3 Frozen OOS 接受记录（失败取证收口，终态 ACCEPTED_FAIL）")
    ap.add_argument("--accept-merge", action="store_true",
                    help="写入接受记录（必填；会修改受版本控制的 manifest / 报告）")
    ap.add_argument("--master-commit", default=None,
                    help="PR #33 合并进 master 之后的那次提交（--accept-merge 必填）")
    ap.add_argument("--manifest", default=None)
    ap.add_argument("--report", default=None)
    ap.add_argument("--master-ref", default=DEFAULT_MASTER_REF,
                    help="仅用于**信息性**可达性记录，不参与拒绝条件")
    args = ap.parse_args()

    if not args.accept_merge:
        ap.error("本入口只做接受记录：请显式传 --accept-merge（运行 B3 请用 "
                 "`python -m gen2.baseline.b3_frozen_oos`）")
    if not args.master_commit:
        ap.error("--accept-merge 需要 --master-commit <SHA>")

    try:
        m = accept_fail_merge(args.master_commit, args.manifest, args.report, args.master_ref)
    except FrozenAttestationError as exc:
        print("[B3-ACCEPT] REFUSED:", exc)
        return 2

    ar = m["acceptance_record"]
    print("[B3-ACCEPT] run status :", m["run_status"])
    print("[B3-ACCEPT] verdict    :", ar["verdict"], "(unchanged:",
          ar["verdict_unchanged_by_acceptance"], ")")
    print("[B3-ACCEPT] eligibility:", ar["economic_eligibility"])
    print("[B3-ACCEPT] merged     :", ar["accepted_master_commit"])
    print("[B3-ACCEPT] merge tree :", ar["accepted_master_tree_sha"])
    print("[B3-ACCEPT] exec head  :", ar["execution_head_commit"])
    print("[B3-ACCEPT] no rerun   :", ar["no_rerun_required"])
    print("[B3-ACCEPT] evidence   :")
    for e in ar["committed_evidence"]:
        print("   - %-13s %s  in_tree=%s  matches=%s"
              % (e["role"], e["path"], e["present_in_merge_tree"], e["matches"]))
    print("[B3-ACCEPT] self_check :", m["self_check"]["passed"], "/", m["self_check"]["checks"])
    print("[B3-ACCEPT] report     :", m["outputs"]["committed_report"]["file"],
          m["outputs"]["committed_report"]["sha256"][:16], "…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
