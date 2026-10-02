#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
GEN1 — HEALTH / PRODUCTION ATTESTATION BLOCKER DIAGNOSTIC 只读自检（executable check）。

对应文档：
  docs/gen1/GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md

性质（硬约束）：
  * **纯只读**：本脚本不写任何文件、不联网、不发任何 DB 命令。
    - 输入 ① = 本工作区源码（读）
    - 输入 ② = 只读通道归档的探针 JSON（读；由 `_cb-connect-20260921/cb_query.py` 产出）
    - 输入 ③ = 本工作区 git 对象（读）
  * **fail-closed**：任一输入缺失 ⇒ 直接判 FAIL（⛔ 不得静默跳过）。
  * 断言全部**逐条打印**；⛔ 不用「工具 success」替代断言。

用法：
  python v6_health_blocker_diagnostic_check.py
  可选环境变量：GEN1_PROBE_DIR  覆盖探针归档目录
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# scripts/gen1/evidence-capture → 上溯 3 层 = 工作树根
WT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
if not os.path.isdir(os.path.join(WT, "docs", "gen1")):
    raise SystemExit("FAIL-CLOSED: 无法定位工作树根（猜测值 %r）" % WT)

DOC = os.path.join(WT, "docs", "gen1", "GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md")
PREP = os.path.join(WT, "docs", "gen1", "GEN1_V366_FREEZE_ATTESTATION_GATE_PREP_20261002.md")

# 三绑定对象 + Seal + Key 2（sha256lf / raw 口径见证据契约 §6.5）
OBJ_CONTRACT = os.path.join(WT, "docs", "gen1", "GEN1_EVIDENCE_CONTRACT_V6.md")
OBJ_CAPTURE = os.path.join(WT, "scripts", "gen1", "evidence-capture", "c1_capture.py")
OBJ_REDPROOF = os.path.join(WT, "scripts", "gen1", "evidence-capture", "c1_gate_redproof.py")
OBJ_SEAL = os.path.join(WT, "docs", "gen1", "artifacts", "GEN1_EVIDENCE_FREEZE_SEAL_V6.json")
OBJ_KEY2 = os.path.join(WT, "ml", "manifests", "GEN1_GUARDED_EFFECTIVE_FREEZE.json")

SHA256LF = {
    OBJ_CONTRACT: "7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e",
    OBJ_CAPTURE: "d0acc9e427f6ce52de903abd40ef41c76e87f7e5ba3441dea92f6a3d013a4337",
    OBJ_REDPROOF: "e795c93445802249e8c33a29e9b01120833079fd7b38d9a660ea22ed590caba0",
}
RAW_SEAL = "a585a33a25cd1fe4b508fc6ce0d1e69f324000cc49f96584865c4811f46a7b62"
RAW_KEY2 = "35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5"


def sha256lf(path: str) -> str:
    b = open(path, "rb").read()
    return hashlib.sha256(b.replace(b"\r\n", b"\n").replace(b"\r", b"\n")).hexdigest()


def sha_raw(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def read(path: str) -> str:
    return open(path, encoding="utf-8").read()


def git(*args: str) -> str:
    p = subprocess.run(["git", "-C", WT, *args], capture_output=True, text=True)
    return p.stdout


def repo_root() -> str:
    """主工作树根（linked worktree 的 git-common-dir 指向主工作树的 .git）。"""
    gd = git("rev-parse", "--git-common-dir").strip()
    if not gd:
        return WT
    gd = gd if os.path.isabs(gd) else os.path.normpath(os.path.join(WT, gd))
    return os.path.dirname(gd)


def find_probe_dir() -> str:
    """定位只读探针归档目录（候选探测，⛔ 不猜死路径）。"""
    env = os.environ.get("GEN1_PROBE_DIR")
    if env:
        return env
    rr = repo_root()
    cands = [
        os.path.join(os.path.dirname(rr), "_cb-connect-20260921"),  # 容器目录（当前实际布局）
        os.path.join(rr, "_cb-connect-20260921"),
        os.path.join(os.path.dirname(WT), "_cb-connect-20260921"),
        os.path.join(WT, "_cb-connect-20260921"),
    ]
    for c in cands:
        if os.path.exists(os.path.join(c, "probe_runtime_status.json")):
            return c
    return cands[0]  # 交给 probe() fail-closed


PROBE_DIR = find_probe_dir()


def probe(name: str):
    """读探针归档（容忍 `- Executing command...` 前缀）；缺失 ⇒ raise（fail-closed）。"""
    p = os.path.join(PROBE_DIR, name)
    if not os.path.exists(p):
        raise FileNotFoundError("探针归档缺失（fail-closed）：%s" % p)
    s = read(p)
    s = s[s.index("{"):]
    d = json.loads(s)
    rows = d.get("data", {}).get("results", [[]])
    return rows[0] if rows else []


def doc_or_empty(path: str) -> str:
    return read(path) if os.path.exists(path) else ""


# ======================================================================
# H-24 违规扫描器（★ AST 结构化；⛔ **不扫描自由字符串常量**）
# ----------------------------------------------------------------------
# 设计契约（owner 2026-10-02 裁定「H-24 新规则」）：
#
#   * 只分析 **AST 中的可执行结构**：Import / ImportFrom / Call / Assign /
#     AnnAssign / AugAssign / Expr / FunctionDef / AsyncFunctionDef / ClassDef /
#     If / For / While / Try / With / AsyncWith / Raise / Return。
#     → 本扫描器的命中源**只有** `ast.Call` 与 `ast.Assign`/`ast.AnnAssign`。
#
#   * ⛔ **不得**扫描：字符串常量 / 注释 / docstring / 测试说明文本 /
#     错误提示文本 / 本检查器自身用于检测违规模式的 pattern literal。
#     → 字符串**只有**在「作为某个 Call 节点的实参」时才被读取 —— 那时它已是
#        **可执行表达式的一部分**（例如 shell 命令向量），而非「自由字面量」。
#
#   * ⛔ **不得**采用 `if file == checker_file: skip` 之类的绕过 ——
#     本扫描器对自身源码与对外部源码走**完全相同**的代码路径（无分支）。
#
#   自指悖论（SELF-REFERENCE PARADOX）说明：旧版用「源码子串」判定，检查器
#   自身的说明文字会命中自己；改用**子串哨兵**后仍在 `ast.Constant` 层自撞。
#   根因 = 「被检查的载体」与「检查器的描述」共用同一个字符空间。正解 =
#   **只信可执行结构，不信文本**。
# ======================================================================

# 1) shell / 子进程入口（静态可解析的 dotted name）
_SHELL_ENTRY = {
    ("os", "system"), ("os", "popen"),
    ("os", "execv"), ("os", "execve"), ("os", "execvp"), ("os", "execvpe"),
    ("os", "spawnv"), ("os", "spawnve"), ("os", "spawnl"), ("os", "spawnlp"),
    ("subprocess", "run"), ("subprocess", "call"), ("subprocess", "check_call"),
    ("subprocess", "check_output"), ("subprocess", "Popen"),
}

# shell 命令向量中出现的**写语义子命令**（deploy / rollback / merge / tag …）
_WRITE_SUBCOMMANDS = {
    "deploy", "rollback", "merge", "tag", "push", "release",
    "publish", "freeze", "unfreeze",
}

# 2) 文件系统写语义方法名（⛔ 不含 str/bytes 的 .replace()：那是纯字符串运算）
_FS_WRITE_METHODS = {
    "writeFile", "writeFileSync", "appendFile", "appendFileSync",
    "unlink", "unlinkSync", "rmdir", "rmdirSync", "rmSync", "rmtree",
    "rename", "renameSync", "mkdir", "mkdirSync", "makedirs",
    "truncate", "chmod", "chown",
}

# 3) DB 写语义（**须**调用链内含 DB 标记，避免误伤 dict/ set 的 set/update/add）
_DB_MARKERS = {"collection", "doc", "table", "database", "where", "records", "query"}
_DB_WRITE_VERBS = {
    "set", "update", "add", "remove", "delete", "upsert",
    "insert", "drop", "save", "create", "setData",
}

# 4) 授权绕过：把授权/复核标志直接置 true
_AUTH_TARGETS = {
    "manualReviewConfirmed", "manual_review_confirmed",
    "force_authorize", "bypass_authorization", "skip_authorization",
}

# 5) open() 写模式字符
_OPEN_WRITE_CHARS = "wax+"


def _dotted(node) -> str | None:
    """把 Attribute/Name 链拼成 'a.b.c'；含非静态节点（Call/Subscript）⇒ None。"""
    parts = []
    cur = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
        return ".".join(reversed(parts))
    return None


def _subtree_attrs(node) -> set:
    """Call 子树内全部属性名（用于 DB 标记判定）。"""
    return {n.attr for n in ast.walk(node) if isinstance(n, ast.Attribute)}


def _literal_words(node) -> set:
    """仅从 **Call 实参**（可执行表达式）提取字面量词；⛔ 不触碰自由常量。"""
    words = set()

    def eat(n):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            for w in re.split(r"[^0-9A-Za-z_-]+", n.value.lower()):
                if w:
                    words.add(w)
        elif isinstance(n, (ast.List, ast.Tuple, ast.Set)):
            for e in n.elts:
                eat(e)

    for a in getattr(node, "args", []):
        eat(a)
    return words


def _is_shell_write(call) -> bool:
    """shell 调用是否具写语义：shell=True 或命令向量含写子命令。"""
    for kw in call.keywords:
        if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
            return True
    return bool(_literal_words(call) & _WRITE_SUBCOMMANDS)


def scan_violations(tree) -> list:
    """由 AST 提取违规；**只**命中可执行结构，⛔ 永不命中自由字符串常量。

    ⛔ 本函数**不得**读取 `ast.Constant` 作为独立命中源 —— 常量仅在
       `_literal_words()` 里、作为某个 Call 的实参被读取。
    """
    found = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            name = _dotted(f)

            # 1) shell / 子进程写调用
            if name is not None and tuple(name.split(".")) in _SHELL_ENTRY and _is_shell_write(node):
                found.append("SHELL_WRITE:" + name)

            # 2) 文件系统写语义方法
            if isinstance(f, ast.Attribute) and f.attr in _FS_WRITE_METHODS:
                found.append("FS_WRITE:" + f.attr)

            # 3) DB 写语义（须链内含 DB 标记）
            if isinstance(f, ast.Attribute) and f.attr in _DB_WRITE_VERBS \
                    and (_subtree_attrs(node) & _DB_MARKERS):
                found.append("DB_WRITE:" + f.attr)

            # 4) open() 写模式
            if isinstance(f, ast.Name) and f.id == "open":
                modes = [a.value for a in node.args[1:]
                         if isinstance(a, ast.Constant) and isinstance(a.value, str)]
                modes += [kw.value.value for kw in node.keywords
                          if kw.arg == "mode" and isinstance(kw.value, ast.Constant)]
                if any(any(c in m for c in _OPEN_WRITE_CHARS) for m in modes):
                    found.append("OPEN_WRITE_MODE:" + repr(modes))

            # 5) 授权绕过（关键字实参）
            for kw in node.keywords:
                if kw.arg in _AUTH_TARGETS and isinstance(kw.value, ast.Constant) \
                        and kw.value.value is True:
                    found.append("AUTH_BYPASS_KWARG:" + str(kw.arg))

        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            val = node.value
            for t in targets:
                if isinstance(t, ast.Name) and t.id in _AUTH_TARGETS \
                        and isinstance(val, ast.Constant) and val.value is True:
                    found.append("AUTH_BYPASS_ASSIGN:" + t.id)

    return found


# ----------------------------------------------------------------------
# ★ 自指红证语料（**故意**让本文件含有违规关键字字符串字面量）
#    ⛔ 这些常量**不是**注释/说明，而是被断言显式引用的测试输入；
#       它们的存在正是「自由字面量不得被判违规」的证明载体。
#    ⛔ 不得新增任何**可执行**的违规调用来这里 —— 只准放字符串。
# ----------------------------------------------------------------------
_SELF_REF_CORPUS = (
    "违禁子命令字样：deploy / rollback / merge / tag / push",
    "gh pr merge 999 --admin",
    "git tag v9.9.9-freeze",
    "os.system('git push --force origin master')",
    "db.collection('gen1_health_state').doc('gen1-health-state').remove()",
    "manualReviewConfirmed = true",
    "open('x.txt', 'w').write('y')",
    "shutil.rmtree('/tmp/nope')",
)

# ★ 真实执行路径变异语料（这些**会被解析为真正的 Call**，必须被抓住）
_MUTATION_CASES = (
    ("subprocess.run(['tcb', 'fn', 'deploy', '--force'])", "SHELL_WRITE:"),
    ("os.system('git tag v9.9.9')", "SHELL_WRITE:"),
    ("db.collection('c').doc('d').set({'a': 1})", "DB_WRITE:"),
    ("shutil.rmtree('/tmp/nope')", "FS_WRITE:"),
    ("open('x.txt', 'w').write('y')", "OPEN_WRITE_MODE:"),
    ("do_it(manualReviewConfirmed=True)", "AUTH_BYPASS_KWARG:"),
    ("manualReviewConfirmed = True", "AUTH_BYPASS_ASSIGN:"),
)

# ★ 负例（良性可执行结构，⛔ 必须**不**被抓住；防「宁可误杀」式放宽）
_MUTATION_NEGATIVE = (
    "subprocess.run(['git', '-C', '/repo', 'rev-parse', 'HEAD'], capture_output=True)",
    "imports.update(x for x in y)",
    "sorted(set(items))",
    "data.get('key', None)",
)


CHECKS = []


def chk(name, cond, detail=""):
    CHECKS.append((name, bool(cond), detail))


def main() -> int:
    cb = read(os.path.join(WT, "src", "common", "utils", "gen1-circuit-breaker.js"))
    hs = read(os.path.join(WT, "src", "common", "utils", "gen1-health-state.js"))
    dh = read(os.path.join(WT, "src", "common", "utils", "gen1-data-health.js"))
    vs = read(os.path.join(WT, "src", "common", "utils", "v3-shadow.js"))
    rde = read(os.path.join(WT, "cloudfunctions", "runDecisionEngine", "index.js"))
    shd = read(os.path.join(WT, "cloudfunctions", "runGen1ShadowEod", "index.js"))
    adm = read(os.path.join(WT, "cloudfunctions", "adminGateway", "index.js"))
    doc = doc_or_empty(DOC)
    prep = doc_or_empty(PREP)

    # ---------- H-1 HEALTH 枚举与标签 ----------
    chk("H-1 circuit-breaker HEALTH 枚举含 DEGRADED，标签 = 降级（禁止灰度）",
        "DEGRADED: '降级（禁止灰度）'" in cb and "HEALTH_LABEL" in cb,
        "gen1-circuit-breaker.js")

    # ---------- H-2 circuitGate(DEGRADED) ----------
    chk("H-2 circuitGate 语义：DEGRADED ⇒ allow_canary=false 且 requires_manual_review_to_restore=true",
        "allowCanary = false;" in cb
        and "requires_manual_review_to_restore: (h === HEALTH.DEGRADED || h === HEALTH.ML_OFF)" in cb,
        "gen1-circuit-breaker.js:93-110")

    # ---------- H-3 computeHealthStatus 输入轴 ----------
    chk("H-3 dataHealth=DEGRADED ⇒ 判 DEGRADED；economicHealth='PENDING' 单独不参与判定",
        "if (x.dataHealth === 'DEGRADED') status = worst(status, HEALTH.DEGRADED);" in cb
        and "x.economicHealth === 'DEGRADED'" in cb
        and "PENDING" in cb and "不参与" in cb,
        "gen1-circuit-breaker.js:62,66,64 注释")

    # ---------- H-4 禁止 auto reopen（核心 fail-closed） ----------
    chk("H-4 wasDown && nowUp 且无 manualReviewConfirmed ⇒ 保持 latch（recovery_rejected）",
        "if (wasDown && nowUp) {" in hs
        and "if (o.manualReviewConfirmed === true) {" in hs
        and "state.latched_health = prevLatched;" in hs
        and "recoveryRejected = true;" in hs,
        "gen1-health-state.js:137-153")

    # ---------- H-5 人工复核可恢复 ----------
    chk("H-5 manualReviewConfirmed === true ⇒ 才允许升回（reviewed_at/reviewed_by/recovery_allowed 置位）",
        "state.recovery_allowed = true;" in hs
        and "state.reviewed_at = now;" in hs
        and "state.reviewed_by = o.reviewedBy || 'manual';" in hs,
        "gen1-health-state.js:138-146")

    # ---------- H-6 manualReviewConfirmed 无生产调用方 ----------
    prod_hits = []
    for root in ("src", "cloudfunctions"):
        for dirpath, _dirs, files in os.walk(os.path.join(WT, root)):
            for f in files:
                if not f.endswith(".js"):
                    continue
                fp = os.path.join(dirpath, f)
                s = read(fp)
                if "manualReviewConfirmed" in s:
                    prod_hits.append(os.path.relpath(fp, WT))
    only_def = all(p.endswith(os.path.join("utils", "gen1-circuit-breaker.js"))
                   or p.endswith(os.path.join("utils", "gen1-health-state.js"))
                   for p in prod_hits)
    chk("H-6 manualReviewConfirmed **无生产调用方**（生产目录命中仅限定义/消费点）",
        len(prod_hits) > 0 and only_def,
        "命中=" + ",".join(sorted(prod_hits)))

    # ---------- H-7 adminGateway 只有 GET（无恢复端点） ----------
    chk("H-7 adminGateway 仅 GET /api/admin/gen1/health；无恢复端点、无 manualReviewConfirmed",
        adm.count("'/api/admin/gen1/health'") == 1
        and "getGen1Health()" in adm
        and "manualReviewConfirmed" not in adm
        and "manual_review_confirmed" not in adm,
        "adminGateway/index.js:1107-1108")

    # ---------- H-8 轴 B 机制：参数推导 ----------
    chk("H-8 resolveShadowEngineVersion 由参数推导（v3_6_1_enabled ⇒ 'v3.6.1'），与部署身份无关",
        "function resolveShadowEngineVersion(params)" in vs
        and "params.v3_6_1_enabled === true" in vs
        and "return 'v3.6.1';" in vs
        and "production_engine: productionEngine," in rde,
        "v3-shadow.js:74-81 · runDecisionEngine/index.js:1277/1358")

    # ---------- H-9 数据健康根因链 ----------
    chk("H-9 根因链：runGen1ShadowEod 聚合 worstData → computeHealthStatus → computeLatchedState → writeHealthState",
        "evaluateDataHealth({" in shd
        and "{ runtimeDataHealth: worstData }" in shd
        and "dataHealth: worstData" in shd
        and "writeHealthState(db, latched.state, COLLECTIONS)" in shd,
        "runGen1ShadowEod/index.js:174-193")

    chk("H-10 DATA_DEGRADED 定义 = 个别统计缺失（STATISTICAL_MISSING），允许 advisory / 禁止 canary",
        "STATUS.DATA_DEGRADED, REASON.STATISTICAL_MISSING" in dh
        and "禁止 canary" in dh,
        "gen1-data-health.js:116-120")

    # ---------- H-11 线上归档：轴 A / 轴 B 共存（自证） ----------
    rs = probe("probe_runtime_status.json")
    if not isinstance(rs, list):
        rs = [rs]
    rs = rs[0] if rs else {}
    ri = rs.get("v365_run_integrity") or {}
    chk("H-11 同一 runtime_status 内 production_engine='v3.6.1' 与 v365_run_integrity.engine_version='v3.6.5' **共存**",
        rs.get("production_engine") == "v3.6.1" and ri.get("engine_version") == "v3.6.5",
        "production_engine=%r engine_version=%r" % (rs.get("production_engine"), ri.get("engine_version")))

    # ---------- H-12 线上归档：run 轴自报 v3.6.5 ----------
    rh = probe("probe_run_history.json")
    rm = probe("probe_run_manifest.json")
    rh = rh if isinstance(rh, list) else [rh]
    rm = rm if isinstance(rm, list) else [rm]
    rh_v = {d.get("engine_version") for d in rh if isinstance(d, dict)}
    chk("H-12 run_history / run_manifest 全部自报 engine_version='v3.6.5'（V3.6.5 引入的 run 轴）",
        len(rh) >= 1 and rh_v == {"v3.6.5"} and len(rm) >= 1 and all(
            isinstance(d, dict) and d.get("run_id") for d in rm),
        "run_history 行=%d 版本=%s" % (len(rh), sorted(rh_v)))

    # ---------- H-13 闩锁文档（实时归档） ----------
    hst = probe("probe_gen1_health_state.json")
    hst = hst[0] if isinstance(hst, list) and hst and isinstance(hst[0], dict) else (
        hst if isinstance(hst, dict) else {})
    chk("H-13 闩锁 gen1_health_state：latched=DEGRADED · reviewed_at/by=null · recovery_allowed=false · read_reason_code=null",
        hst.get("key") == "gen1-health-state"
        and hst.get("latched_health") == "DEGRADED"
        and hst.get("current_health") == "DEGRADED"
        and hst.get("reviewed_at") is None and hst.get("reviewed_by") is None
        and hst.get("recovery_allowed") is False
        and hst.get("read_reason_code") is None
        and hst.get("manual_review_required") is True,
        "probe_gen1_health_state.json")

    chk("H-14 闩锁驱动输入：runtime_data_health='DEGRADED'（真因字段）；economic_health='PENDING'（不参与）",
        hst.get("runtime_data_health") == "DEGRADED"
        and hst.get("economic_health") == "PENDING"
        and hst.get("degraded_at") == "2026-09-21T14:20:27.241Z",
        "degraded_at=%r" % hst.get("degraded_at"))

    # ---------- H-15 runtime_status 派生位一致 ----------
    chk("H-15 runtime_status 派生位：status=DEGRADED · gate_status=ACTIVE · source=LATCH · manual_review_required=true · read_reason_code=null",
        rs.get("gen1_health_status") == "DEGRADED"
        and rs.get("gen1_health_gate_status") == "ACTIVE"
        and rs.get("gen1_health_source") == "GEN1_HEALTH_STATE_LATCH"
        and rs.get("gen1_health_manual_review_required") is True
        and rs.get("gen1_health_read_reason_code") is None,
        "71 键单例")

    chk("H-16 下游派生位一致：counterfactual_canary_health_allowed=false · guarded_effective_health_allowed=false",
        rs.get("gen1_counterfactual_canary_health_allowed") is False
        and rs.get("gen1_guarded_effective_health_allowed") is False
        and rs.get("gen1_counterfactual_canary_active") is False
        and rs.get("gen1_allow_canary") is False,
        "canary 被健康门阻断")

    # ---------- H-17 根因标的定位（515880） ----------
    ms = probe("probe_ml_shadow_signal.json")
    ms = [d for d in (ms if isinstance(ms, list) else [ms]) if isinstance(d, dict)]
    dates = sorted({d.get("date") for d in ms if d.get("date")})
    latest = dates[-1] if dates else None
    latest_rows = [d for d in ms if d.get("date") == latest]
    health_of = {}
    for d in latest_rows:
        v = d.get("data_health_status", d.get("data_health", d.get("dataHealth")))
        health_of[d.get("code")] = v
    chk("H-17 根因标的：最新交易日 515880=DATA_DEGRADED，且存在 DATA_OK 标的（⇒ worstData 由其单点驱动）",
        latest is not None
        and health_of.get("515880") == "DATA_DEGRADED"
        and any(v == "DATA_OK" for v in health_of.values()),
        "date=%s data_health=%s" % (latest, health_of))

    # ---------- H-18 HEALTH_READY 公式对当前实读值 = FALSE，且未满足项 == {B,D,E,H} ----------
    A = rs.get("gen1_health_gate_status") == "ACTIVE"          # FOUND 代理（PENDING/READ_ERROR 均非 ACTIVE）
    B = hst.get("latched_health") == "OK"
    C = rs.get("gen1_health_gate_status") == "ACTIVE"
    D = hst.get("manual_review_required") is False
    E = (hst.get("recovery_allowed") is True
         and hst.get("reviewed_at") is not None and hst.get("reviewed_by") is not None)
    F = rs.get("gen1_health_status") == hst.get("latched_health")
    G = rs.get("gen1_health_source") == "GEN1_HEALTH_STATE_LATCH"
    H = rs.get("gen1_counterfactual_canary_health_allowed") is True
    unmet = sorted([n for n, v in zip("ABCDEFGH", [A, B, C, D, E, F, G, H]) if not v])
    health_ready = all([A, B, C, D, E, F, G, H])
    chk("H-18 HEALTH_READY(now) == FALSE，且未满足项集合 == {B,D,E,H}",
        health_ready is False and unmet == ["B", "D", "E", "H"],
        "HEALTH_READY=%s unmet=%s" % (health_ready, unmet))

    # ---------- H-19 文档在场性 ----------
    must_doc = [
        "GEN1 — HEALTH / PRODUCTION ATTESTATION BLOCKER DIAGNOSTIC",
        "X-1 — Evidence Contract 归属 → **CLOSED**",
        "X-2 — R1 / R2 → **CLOSED**",
        "X-3 — W2 checkpoint → **CLOSED**",
        "X-4 — Freeze 制品形态 → **DECIDED**",
        "X-5 — Main branch reachability → **PENDING**",
        "X-6 — Production Health / DEGRADED → **BLOCKED / DIAGNOSIS REQUIRED**",
        "X-7 — Safety-wall evidence → **CLOSED**",
        "H1/H2_REQUIRED_EVIDENCE = FINAL 29/29 VERSION",
        "HEALTH_READY(now) ==",
        "AUTHORIZATION GATE",
        "ERRATA-1",
        "STATISTICAL_MISSING",
        "CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5",
        "HISTORICAL / SUPERSEDED",
        # ---- §11 本轮正式收口裁定（owner 2026-10-02）----
        "V3.6.5_CONTROLLED_DEPLOYMENT",
        "DEPLOYMENT_IDENTITY_MATCH",
        "2026-09-30T05:37:19Z",
        "e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4",
        "CURRENT_EFFECTIVE_ENGINE_RESOLUTION",
        "V3.6.5_DEPLOYMENT",
        "V3.6.5_RUNTIME_EVIDENCE",
        "ENGINE_VERSION_STATE",
        "MIXED / REQUIRES EXPLICIT RECONCILIATION",
        "no run_history record",
        "HEALTH_ROOT_CAUSE = 515880",
        "HEALTH_REASON",
        "AUTO_REOPEN",
        "MANUAL_REVIEW_REQUIRED",
        "PRODUCTION_WRITE_REQUIRED",
        "RECOVERY_AUTHORIZATION",
        "EFFECTIVE_ENGINE_SWITCH_REQUIRES_SEPARATE_AUTHORIZATION",
        "SELF-REFERENCE PARADOX",
        "SELF_REFERENCE_RED_PROOF",
        "REAL_EXECUTABLE_VIOLATION_RED_PROOF",
        "FAIL_CLOSED_RED_PROOF",
        "GEN1_PRE_LAUNCH_INVENTORY_20261002.md",
    ]
    miss = [s for s in must_doc if s not in doc]
    chk("H-19 本件在场性（X-1…X-7 标题 · 29/29 · HEALTH_READY 式 · AUTHORIZATION GATE · ERRATA-1 · STATISTICAL_MISSING · 台账身份 · V5 标记 · §11 裁定 · 三条红证 · INVENTORY 指向）",
        not miss, "缺失=%s" % miss)

    # ---------- H-20 准备件已就地勘误（含 owner 指定 ERRATA-1 全文） ----------
    must_prep = [
        "ERRATA-1",
        "V3.6.5 / V3.6.6 候选均未部署",                     # ⛔ 历史原文必须保留
        "GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md",
        # owner 2026-10-02 逐字指定的 ERRATA-1 五点
        "CURRENT_EFFECTIVE_ENGINE_RESOLUTION",
        "CONTROLLED_DEPLOYMENT_IDENTITY",
        "混为同一概念",
        "EXACT_MATCH",
        "v3_6_1_enabled=true",
        "双轴状态",
        "不修改历史证据，仅纠正语义解释",
    ]
    miss_prep = [s for s in must_prep if s not in prep]
    chk("H-20 准备件 §2 第 9 行已带 ERRATA-1 就地标记（历史原文保留 + owner 指定全文五点）",
        not miss_prep, "缺失=%s" % miss_prep)

    # ---------- H-21 ⛔ 零命中：无放行式 ----------
    bad = ["Deploy = YES", "Deploy = YES", "Canary = ON", "GE-04 = AUTHORIZED",
           "V3.6.6 FREEZE = AUTHORIZED", "HEALTH_READY = TRUE", "HEALTH_READY = READY"]
    hit = [b for b in set(bad) if b in doc]
    chk("H-21 ⛔ 本件零放行式（Deploy=YES / Canary=ON / GE-04=AUTHORIZED / V3.6.6 FREEZE=AUTHORIZED / HEALTH_READY=TRUE）",
        not hit, "命中=%s" % hit)

    # ---------- H-22 ⛔ .gitattributes 不存在 ----------
    main_root = repo_root()
    gattrs = [os.path.join(WT, ".gitattributes"), os.path.join(main_root, ".gitattributes")]
    chk("H-22 ⛔ .gitattributes 不存在（worktree / 主仓）⇒ 仓库级换行配置未改",
        not any(os.path.exists(p) for p in gattrs), "checked=%s" % gattrs)

    # ---------- H-23 ⛔ 三对象 / Seal / Key 2 未变 ----------
    got_lf = {p: sha256lf(p) for p in SHA256LF}
    ok_lf = all(got_lf[p] == v for p, v in SHA256LF.items())
    chk("H-23 三绑定对象 sha256lf 与绑定值逐位相同 · Seal 未重写 · Key 2 raw 未变",
        ok_lf and sha_raw(OBJ_SEAL) == RAW_SEAL and sha_raw(OBJ_KEY2) == RAW_KEY2,
        "lf_ok=%s seal=%s key2=%s" % (ok_lf, sha_raw(OBJ_SEAL)[:12], sha_raw(OBJ_KEY2)[:12]))

    # ---------- H-24 ⛔ 本脚本自身零写操作（★ AST 结构化，⛔ 不扫字符串常量） ----------
    self_path = os.path.abspath(__file__)
    self_src = read(self_path)
    self_tree = ast.parse(self_src)
    self_violations = scan_violations(self_tree)
    module_imports = set()
    for n in ast.walk(self_tree):
        if isinstance(n, ast.Import):
            module_imports.update(a.name.split(".")[0] for a in n.names)
        elif isinstance(n, ast.ImportFrom) and n.module:
            module_imports.add(n.module.split(".")[0])
    h24_ok = (not self_violations) and ("shutil" not in module_imports)
    chk("H-24 ⛔ 本脚本零写操作（AST 结构化：shell 写命令 / FS 写 / DB 写 / 授权绕过 / open 写模式；⛔ 不扫字符串常量）",
        h24_ok,
        "自源违规=%s imports_has_shutil=%s" % (self_violations, "shutil" in module_imports))

    # ---------- H-25 ★ SELF_REFERENCE_RED_PROOF ----------
    # 前提：本文件**确实**含违规关键字字符串字面量（见 _SELF_REF_CORPUS）。
    # 断言：这些自由字面量**不得**被判违规 ⇒ scan(本文件 AST) 必须为 0 命中。
    # ⛔ 若改成「跳过 check 自身」即属绕过，本红证将失去意义。
    corpus_all_present = all(s in self_src for s in _SELF_REF_CORPUS)
    keywords_all_present = all(
        any(k in s for s in _SELF_REF_CORPUS)
        for k in ("deploy", "merge", "tag", "push", "rmtree",
                  "manualReviewConfirmed", "collection", "remove", "open")
    )
    h25_ok = corpus_all_present and keywords_all_present and (not self_violations)
    chk("H-25 ★ SELF_REFERENCE_RED_PROOF（本文件含违规关键字 literal ⇒ AST 扫描仍必须 0 命中）",
        h25_ok,
        "语料条数=%d/%d 关键字齐=%s 自源违规=%s"
        % (sum(1 for s in _SELF_REF_CORPUS if s in self_src), len(_SELF_REF_CORPUS),
           keywords_all_present, self_violations))

    # ---------- H-26 ★ REAL_EXECUTABLE_VIOLATION_RED_PROOF ----------
    # 正例：注入**真实可执行 Call** ⇒ 必须被抓住（否则 H-24 是空门）。
    # 负例：良性可执行结构 ⇒ 必须**不**被抓住（否则是「宁可误杀」式放宽）。
    mut_detail, mut_ok = [], True
    for mut_src, expect in _MUTATION_CASES:
        got = scan_violations(ast.parse(mut_src))
        hit = any(g.startswith(expect) for g in got)
        mut_ok = mut_ok and hit
        mut_detail.append("%s@%s→%s" % (mut_src.split("(")[0][:22], expect.rstrip(":"),
                                        ",".join(got) if got else "∅"))
    neg_detail, neg_ok = [], True
    for neg_src in _MUTATION_NEGATIVE:
        got = scan_violations(ast.parse(neg_src))
        neg_ok = neg_ok and (not got)
        neg_detail.append("%s→%s" % (neg_src.split("(")[0][:22], ",".join(got) if got else "∅"))
    h26_ok = mut_ok and neg_ok
    chk("H-26 ★ REAL_EXECUTABLE_VIOLATION_RED_PROOF（真实违规 Call ⇒ 必命中；良性可执行结构 ⇒ 必不命中）",
        h26_ok,
        "正例=%s | 负例=%s" % ("; ".join(mut_detail), "; ".join(neg_detail)))

    # ---------- H-27 ★ FAIL_CLOSED_RED_PROOF ----------
    # 证据缺失（探针目录不存在）⇒ 子进程必须 exit 2 且**不**输出 ALL PASS。
    # ⛔ 只允许 FAIL；⛔ 不得 WARN / SKIP。
    h27_ok, h27_detail = False, "未执行"
    try:
        env_bad = dict(os.environ)
        env_bad["GEN1_PROBE_DIR"] = os.path.join(WT, "__no_such_probe_dir__")
        sub = subprocess.run([sys.executable, self_path], capture_output=True,
                             text=True, env=env_bad, timeout=180)
        combined = (sub.stdout or "") + (sub.stderr or "")
        has_fc = "FAIL-CLOSED" in combined
        has_pass = "ALL PASS" in combined
        h27_ok = (sub.returncode == 2) and has_fc and (not has_pass)
        h27_detail = "rc=%s 含FAIL-CLOSED=%s 含ALL PASS=%s" % (sub.returncode, has_fc, has_pass)
    except Exception as exc:  # noqa: BLE001 —— 红证自身异常只允许判 FAIL
        h27_detail = "红证执行异常（判 FAIL）：%s: %s" % (type(exc).__name__, exc)
    chk("H-27 ★ FAIL_CLOSED_RED_PROOF（证据缺失 ⇒ exit 2 · 零 PASS 输出；⛔ 不得 WARN/SKIP）",
        h27_ok, h27_detail)

    # ---------- H-28 ★ GEN1_PRE_LAUNCH_INVENTORY 在场性 + A–E 结构 ----------
    inv_path = os.path.join(WT, "docs", "gen1", "GEN1_PRE_LAUNCH_INVENTORY_20261002.md")
    inv = doc_or_empty(inv_path)
    must_inv = [
        "GEN1_PRE_LAUNCH_INVENTORY / FUNCTIONAL COMPLETENESS INVENTORY",
        "signal productionization 链",
        "A 类 —— 功能缺口",
        "B 类 —— 生产集成缺口",
        "C 类 —— Health / 安全状态缺口",
        "D 类 —— Evidence 缺口",
        "E 类 —— Authorization 缺口",
        # owner 指定六问
        "production read path 是否仍读取",
        "candidate / pointer 是否真正进入线上消费者",
        "Gen-1 promoted result 是否真正成为 production decision input",
        "selector cutover 条件是什么",
        "ml_effective` 条件是什么",
        "auto_execution` 与 GE-04 的边界是什么",
        # 关键实测锚点
        "S-PROMOTED",
        "REGISTERED",
        "NOT RE-READ",
        "STALE",
    ]
    miss_inv = [s for s in must_inv if s not in inv]
    chk("H-28 ★ INVENTORY 件在场性（A–E 五类 · owner 六问逐项 · S-PROMOTED · REGISTERED 语义 · NOT RE-READ / STALE 分级）",
        not miss_inv, "缺失=%s" % miss_inv)

    # ---------- H-29 ⛔ 零放行式（本件 + INVENTORY 件 + 准备件 三件同扫） ----------
    bad2 = ["Deploy = YES", "Canary = ON", "GE-04 = AUTHORIZED",
            "V3.6.6 FREEZE = AUTHORIZED", "HEALTH_READY = TRUE", "HEALTH_READY = READY",
            "PRODUCTION_ATTESTATION = PASS", "EVIDENCE_EXECUTION = AUTHORIZED"]
    hit2 = [("doc", b) for b in set(bad2) if b in doc]
    hit2 += [("inventory", b) for b in set(bad2) if b in inv]
    hit2 += [("prep", b) for b in set(bad2) if b in prep]
    chk("H-29 ⛔ 三件同扫零放行式（Deploy=YES / Canary=ON / GE-04=AUTHORIZED / FREEZE=AUTHORIZED / HEALTH_READY=READY / ATTESTATION=PASS）",
        not hit2, "命中=%s" % hit2)

    # ---------- 汇总 ----------
    fails = [c for c in CHECKS if not c[1]]
    print("=" * 78)
    print("GEN1 HEALTH / PRODUCTION ATTESTATION BLOCKER DIAGNOSTIC —— 只读自检")
    print("探针归档目录：%s" % PROBE_DIR)
    print("=" * 78)
    for name, ok, detail in CHECKS:
        print("  [%s] %s" % ("PASS" if ok else "FAIL", name))
        if detail:
            print("         · %s" % detail)
    print("-" * 78)
    print("RED-PROOF 状态（owner 2026-10-02 指定）:")
    print("  SELF_REFERENCE_RED_PROOF            = %s" % ("PASS" if h25_ok else "FAIL"))
    print("  REAL_EXECUTABLE_VIOLATION_RED_PROOF = %s" % ("PASS" if h26_ok else "FAIL"))
    print("  FAIL_CLOSED_RED_PROOF               = %s" % ("PASS" if h27_ok else "FAIL"))
    print("-" * 78)
    print("结论：%s（%d PASS / %d FAIL）" % ("✅ ALL PASS" if not fails else "❌ FAILED",
                                            len(CHECKS) - len(fails), len(fails)))
    print("=" * 78)
    return 0 if not fails else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # fail-closed
        print("❌ FAIL-CLOSED：%s: %s" % (type(exc).__name__, exc))
        sys.exit(2)
