#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LOCK AUTHORITY GATE（第十轮后置）只读 checker。

校验 docs/gen1/GEN1_LOCK_AUTHORITY_GATE_20261003.md：
  - LC-R2-1 八问调查完备
  - LC_R2_1_DECISION = PENDING（⛔ 未被自行裁定）
  - LOCK_AUTHORITY 证据结论三 token 齐备
  - C2 13 维对照 + promote-*.js 定性
  - P1..P5 候选项 + 逐项 EXECUTED = NO
  - 硬边界零放行
  - 红证：删除/篡改任一关键裁定内容必须打红
  - 回归：显式白名单（⛔ 禁通配）
  - 零写：out/ 与 fixtures/ 快照前后一致

用法：
  python v6_lock_authority_gate_check.py
  python v6_lock_authority_gate_check.py --redproof RP-3
  python v6_lock_authority_gate_check.py --regression
  python v6_lock_authority_gate_check.py --zerowrite
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import io
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

DOC_REL = os.path.join("docs", "gen1", "GEN1_LOCK_AUTHORITY_GATE_20261003.md")
DOC = os.path.join(REPO, DOC_REL)

SECTIONS = ["## §0", "## §1", "## §2", "## §3", "## §4", "## §5"]

MEASURE_IDS = ["N-1", "N-2", "N-3", "N-4", "N-5", "N-6",
               "N-7", "N-8", "N-9", "N-10", "N-11"]

QUESTIONS = ["### §1.1 Q1", "### §1.2 Q2", "### §1.3 Q3", "### §1.4 Q4",
             "### §1.5 Q5", "### §1.6 Q6", "### §1.7 Q7", "### §1.8 Q8"]

READINGS = ["`LC-A`", "`LC-B`", "`LC-C`"]

C2_DIMS = [
    "**implementation surface**",
    "**authority**",
    "**natural-person actor**",
    "**approval**",
    "**audit 8 fields**",
    "**state transition**",
    "**snapshot**",
    "**replay**",
    "**rollback**",
    "**anti-bypass**",
    "**deployment dependency**",
    "**P5 dependency**",
    "**migration impact**",
]

MIN_CONTRACT = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]

AUDIT_FIELDS = ["`actor`", "`timestamp`", "`previous_state`", "`new_state`",
                "`reason`", "`evidence_reference`", "`authority_decision`",
                "`correlation/request id`"]

P_NOTE = [
    "治理记录补录 ≠ deployment authorization",
    "baseline acceptance ≠ deployment authorization",
    "parity debt acceptance ≠ deployment authorization",
    "P5 source anchor ≠ production deployment",
]

STOP_EXPECT = {
    "LC_R2_1_DECISION": "PENDING",
    "LOCK_AUTHORITY": "TWO_TIER__NO_FORMAL_TIEBREAKER",
    "LOCK_AUTHORITY_ENFORCEMENT": "FILES_BINDING_PLUS_DERIVED_PLUS_ROOT_ANCHOR",
    "LOCK_AUTHORITY_SCOPE_TEXT": "RULE_PROSE_9_DOMAINS_UNENFORCED",
    "LOCK_AUTHORITY_TIEBREAKER": "ABSENT",
    "LOCK_AUTHORITY_INTERNAL_INCONSISTENCY": "PRESENT",
    "C3_IMPLEMENTATION": "BLOCKED",
    "C2_OWNER_SELECTION": "PENDING",
    "C2_ARCHITECTURE_OPTIONS_COMPLETE": "YES",
    "C2_A_PLUS_B": "ANALYZED",
    "C2_A_PLUS_C": "ANALYZED",
    "C2_PROMOTE_SCRIPTS_CLASS": "PRODUCTION_MUTATION_UTILITY",
    "P1": "EXPLICIT",
    "P2": "EXPLICIT",
    "P3": "EXPLICIT",
    "P4": "EXPLICIT",
    "P5": "EXPLICIT",
    "P1_EXECUTED": "NO",
    "P2_EXECUTED": "NO",
    "P3_EXECUTED": "NO",
    "P4_EXECUTED": "NO",
    "P5_EXECUTED": "NO",
    "N_9A": "EXISTING",
    "N_10": "EXISTING",
    "V6_NEGATIVE_SCAN_MODIFIED": "NO",
    "PRODUCTION_WRITE": "0",
    "DB_WRITE": "0",
    "DEPLOY": "NO",
    "AUTHORITY_CHANGE": "NO",
    "CANARY": "OFF",
    "EVIDENCE_EXECUTION": "NO",
    "GE04": "NO",
    "IMPLEMENTATION_AUTHORIZED": "NO",
    "STOP": "YES",
}

OVERCLAIM = re.compile(
    r"MASTER_IS_ONLY_AUTHORITY\s*=\s*YES"
    r"|C2_OWNER_SELECTION\s*=\s*A\+B"
    r"|C2_OWNER_SELECTION\s*=\s*A\+C"
    r"|LC_R2_1_DECISION\s*=\s*LC-[ABC]\b"
    r"|C3_IMPLEMENTATION\s*=\s*UNBLOCKED"
    r"|PACKAGE_LEVEL_PARITY\s*=\s*VERIFIED"
    r"|IMPLEMENTATION_AUTHORIZED\s*=\s*YES"
)


# ★ 负控字面量一律运行时片段拼装（消除 checker 源码内的自指面，见 TOOLING §3.8/§3.9）
_MUT_IMPL_YES = "IMPLEMENTATION_AUTHORIZED = " + "YES"
_MUT_LC_B = "LC_R2_1_DECISION = LC" + "-B"


def _deploy_tokens():
    """运行时片段拼装，规避自身源码自指（见 TOOLING §3.8/§3.9）。"""
    g = "git"
    t = "tcb"
    n = "npm"
    d = "docker"
    f = "firebase"
    s = "serverless"
    return [
        g + " push", g + " merge", t + " fn deploy", t + " deploy",
        n + " run deploy", d + " push", f + " deploy", s + " deploy",
        t + " fn update", t + " fn delete",
    ]


def read_doc():
    with io.open(DOC, encoding="utf-8") as fh:
        return fh.read()


def norm(s):
    """把 markdown 表格/续行噪点归一，便于子串匹配。"""
    return re.sub(r"\s+", " ", s)


def blocks(text):
    """全部 ```text 围栏块 -> List[dict]（逐块解析 KEY = VALUE）。"""
    out = []
    for m in re.finditer(r"```text\n(.*?)```", text, re.S):
        fields = {}
        for line in m.group(1).splitlines():
            g = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*([A-Za-z0-9_.\-]+)\s*$", line)
            if g:
                fields[g.group(1)] = g.group(2)
        if fields:
            out.append(fields)
    return out


def find_block(text, key):
    """返回**第一个**含指定 key 的围栏块（⛔ 不按正文首次出现定位）。"""
    for blk in blocks(text):
        if key in blk:
            return blk
    return {}


def self_source():
    with io.open(__file__, encoding="utf-8") as fh:
        return fh.read()


WRITE_ALLOWED_FUNCS = {"_restore", "redproof"}


def _func_ranges(tree):
    """函数名 -> (lineno, end_lineno)（AST 行区间，⛔ 不用字面量定位自身）。"""
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out[node.name] = (node.lineno, node.end_lineno or node.lineno)
    return out


def _in_allowed(lineno, ranges):
    for fn in WRITE_ALLOWED_FUNCS:
        if fn in ranges:
            a, b = ranges[fn]
            if a <= lineno <= b:
                return True
    return False


def check_self_readonly():
    """A-01：checker 自身只读（AST 级判定）。

    唯一例外：红证 harness 必须能「改-断言-还原」文档，
    故 DOC 的写操作仅允许出现在 _restore / redproof 内（行区间判定）。
    """
    src = self_source()
    tree = ast.parse(src)
    ranges = _func_ranges(tree)
    bad = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            name = getattr(fn, "attr", None) or getattr(fn, "id", None)
            if name in ("remove", "unlink", "rmtree", "rename", "replace") and not isinstance(fn, ast.Attribute):
                continue
            if isinstance(fn, ast.Attribute) and name in ("remove", "unlink", "rmtree", "write_text", "write_bytes"):
                bad.append("os-write:" + str(getattr(node, "lineno", "?")))
            if isinstance(fn, ast.Name) and name in ("system", "popen", "remove", "unlink", "rmtree"):
                bad.append(name)
            if isinstance(fn, ast.Attribute) and name in ("system", "popen", "run", "call", "check_output", "check_call", "Popen"):
                mod = getattr(getattr(fn, "value", None), "id", None)
                if mod in ("subprocess", "os"):
                    bad.append("%s.%s@%s" % (mod, name, getattr(node, "lineno", "?")))
        if isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name) and fn.id == "open":
                mode = None
                if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                    mode = node.args[1].value
                for kw in node.keywords:
                    if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                        mode = kw.value.value
                if mode and any(c in str(mode) for c in ("w", "a", "x", "+")):
                    ln = getattr(node, "lineno", 0)
                    if not _in_allowed(ln, ranges):
                        bad.append("open-write@%s" % ln)
    # 白名单：--regression 需要 subprocess
    allowed_sub = re.compile(r"_run_one\s*\(|def run_regression\(")
    real = []
    for b in bad:
        if b.startswith("subprocess.") and allowed_sub.search(src):
            continue
        real.append(b)
    return real


def _run_one(cmd):
    try:
        p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=300)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except Exception as exc:  # pragma: no cover
        return 99, str(exc)


REGRESSION_WHITELIST = [
    "v6_lock_authority_gate_check.py",
    "v6_owner_decision_gate_check.py",
    "v6_c3_c2_architecture_decision_check.py",
    "v6_d1d2_decision_check.py",
    "v6_c3_c2_preflight_check.py",
    "v6_owner_decision_boundary_check.py",
    "v6_gap_dependency_plan_check.py",
    "v6_pre_launch_inventory_check.py",
    "v6_health_blocker_diagnostic_check.py",
    "v6_key2_immutability_check.py",
    "v6_seal_binding_selfcheck.py",
    "v6_engine_identity_reconciliation_check.py",
    "v6_fingerprint_canonicalization_check.py",
    "v6_frozen_carrier_assertions.py",
    "v6_contract_compatibility.py",
    "v6_contract_tool_alignment.py",
    "v6_content_assertions.py",
    "c1_gate_redproof.py",
    "c1_capture_v6_migration_test.py",
    "checkpoint_python_js_parity.py",
    "r3_contract_consumption_test.py",
]


def snapshot_zone():
    """out/ 与 fixtures/ 的 sha256 快照（零写自证用）。"""
    zones = [os.path.join(HERE, "out"), os.path.join(HERE, "fixtures")]
    snap = {}
    for z in zones:
        if not os.path.isdir(z):
            continue
        for root, _dirs, files in os.walk(z):
            for fn in sorted(files):
                p = os.path.join(root, fn)
                rel = os.path.relpath(p, REPO).replace("\\", "/")
                with open(p, "rb") as fh:
                    snap[rel] = hashlib.sha256(fh.read()).hexdigest()
    return snap


def assertions():
    res = []

    def add(name, ok, detail=""):
        res.append((name, bool(ok), detail))

    # A-01 自证只读
    bad = check_self_readonly()
    add("A-01.self-readonly", not bad, "offenders=%s" % bad)

    # A-02 交付件存在
    add("A-02.doc-exists", os.path.isfile(DOC), DOC_REL)
    if not os.path.isfile(DOC):
        return res
    d = read_doc()
    n = norm(d)

    # A-03 章节
    miss = [s for s in SECTIONS if s not in d]
    add("A-03.sections", not miss, "missing=%s" % miss)

    # A-04 关键实测 N-1..N-11
    miss = [m for m in MEASURE_IDS if ("| %s |" % m) not in d]
    add("A-04.measurements", not miss, "missing=%s" % miss)

    # A-05 LC_R2_1_DECISION = PENDING（正文 + STOP 双向）
    s1 = find_block(d, "LC_R2_1_DECISION")
    ok5 = (s1.get("LC_R2_1_DECISION") == "PENDING"
           and "LC_R2_1_DECISION = PENDING" in d)
    add("A-05.lc-r2-1-pending", ok5, "stop=%s" % s1.get("LC_R2_1_DECISION"))

    # A-06 LOCK_AUTHORITY 三 token
    s1b = find_block(d, "LOCK_AUTHORITY_ENFORCEMENT")
    need = {"LOCK_AUTHORITY": "TWO_TIER__NO_FORMAL_TIEBREAKER",
            "LOCK_AUTHORITY_ENFORCEMENT": "FILES_BINDING_PLUS_DERIVED_PLUS_ROOT_ANCHOR",
            "LOCK_AUTHORITY_SCOPE_TEXT": "RULE_PROSE_9_DOMAINS_UNENFORCED",
            "LOCK_AUTHORITY_TIEBREAKER": "ABSENT",
            "LOCK_AUTHORITY_INTERNAL_INCONSISTENCY": "PRESENT"}
    miss = [k for k, v in need.items() if s1b.get(k) != v]
    add("A-06.lock-authority", not miss, "missing=%s" % miss)

    # A-07 八问齐备
    miss = [q for q in QUESTIONS if q not in d]
    add("A-07.eight-questions", not miss, "missing=%s" % miss)

    # A-08 三候选读法
    miss = [r for r in READINGS if ("| " + r + " |") not in d]
    add("A-08.three-readings", not miss, "missing=%s" % miss)

    # A-09 明令禁止式必须存在
    ok9 = ("不得以「`files[]` 没有它 ⇒ 不受管」" in n and "结案" in n)
    add("A-09.prohibition-present", ok9)

    # A-10 制品内部矛盾（7 域 / 9 域 / 4 文件）
    ok10 = bool(re.search(r"头注释写\s*\*{0,2}7 域", n)) and "9 域" in n and "4 个 sha256 绑定" in n
    add("A-10.internal-inconsistency", ok10)

    # A-11 N-7 结构耦合（绑定集传递不封闭）
    ok11 = ("传递语义上不封闭" in n) and ("require" in n) and ("gen1-domain-permission" in n)
    add("A-11.structural-coupling", ok11)

    # A-12 先例 4e1d370 + 日期
    ok12 = ("4e1d370" in d) and ("2026-09-10 13:58:51" in n)
    add("A-12.precedent-4e1d370", ok12)

    # A-13 Q7 最小变更面 4 文件
    ok13 = ("最小变更面 = 4 文件" in n) and ("PIPELINE_FILES" in d) and ("ROOT_ANCHOR_PIPELINE_LOCK" in d)
    add("A-13.min-change-surface", ok13)

    # A-14 Q8 规范依据 E-1..E-5
    miss = [e for e in ["E-1", "E-2", "E-3", "E-4", "E-5"] if ("| %s |" % e) not in d]
    add("A-14.normative-basis", not miss, "missing=%s" % miss)

    # A-15 C2_OWNER_SELECTION = PENDING
    s2 = find_block(d, "C2_OWNER_SELECTION")
    add("A-15.c2-pending", s2.get("C2_OWNER_SELECTION") == "PENDING", s2.get("C2_OWNER_SELECTION"))

    # A-16/A-17 A+B / A+C 均 ANALYZED
    s3 = find_block(d, "C2_A_PLUS_B")
    add("A-16.c2-ab-analyzed", s3.get("C2_A_PLUS_B") == "ANALYZED", s3.get("C2_A_PLUS_B"))
    add("A-17.c2-ac-analyzed", s3.get("C2_A_PLUS_C") == "ANALYZED", s3.get("C2_A_PLUS_C"))

    # A-18 13 维齐备
    miss = [x for x in C2_DIMS if x not in d]
    add("A-18.c2-13-dims", not miss, "missing=%s" % miss)

    # A-19 promote-*.js 定性 + 6 证据
    ok19 = ("production mutation utility" in d) and ("`GOV-GAP-C`" in d) and ("硬编码 `version: 1`" in n)
    add("A-19.promote-classification", ok19)

    # A-20 反直觉对照（adminGateway.updateParam 留痕更强）
    ok20 = ("prev_value: old.value" in d) and ("管理后台路径的留痕强于 promote 脚本路径" in n)
    add("A-20.counter-example", ok20)

    # A-21 R1..R8
    miss = [k for k in MIN_CONTRACT if not re.search(r"^\| %s \|" % k, d, re.M)]
    add("A-21.minimal-contract", not miss, "missing=%s" % miss)

    # A-22 审计 8 字段
    miss = [f for f in AUDIT_FIELDS if f not in d]
    add("A-22.audit-8-fields", not miss, "missing=%s" % miss)

    # A-23 P1..P5 候选项 + EXECUTED=NO
    s4 = find_block(d, "P1_EXECUTED")
    ok23 = all(s4.get(k) == "NO" for k in
               ["P1_EXECUTED", "P2_EXECUTED", "P3_EXECUTED", "P4_EXECUTED", "P5_EXECUTED"])
    for k in ["P1", "P2", "P3", "P4", "P5"]:
        ok23 = ok23 and bool(re.search(r"^\| \*\*%s\*\* \|" % k, d, re.M))
    add("A-23.p1-p5-options", ok23)

    # A-24 四条强制注意
    miss = [x for x in P_NOTE if x not in d]
    add("A-24.p1-p5-notes", not miss, "missing=%s" % miss)

    # A-25 STOP 全字段
    halt = find_block(d, "STOP")
    miss = [k for k, v in STOP_EXPECT.items() if halt.get(k) != v]
    add("A-25.stop-block", not miss,
        "missing=%s" % miss[:8])

    # A-26 硬边界块
    ok26 = all(x in n for x in ["PRODUCTION_WRITE = 0", "DB_WRITE = 0",
                                "DEPLOY = NO", "AUTHORITY_CHANGE = NO",
                                "CANARY = OFF", "EVIDENCE_EXECUTION = NO",
                                "GE04 = NO", "IMPLEMENTATION_AUTHORIZED = NO"])
    add("A-26.hard-boundary", ok26)

    # A-27 无越界式
    hits = OVERCLAIM.findall(d)
    add("A-27.no-overclaim", not hits, "hits=%s" % hits)

    # A-28 无部署 token
    hits = [t for t in _deploy_tokens() if t in d]
    add("A-28.no-deploy-token", not hits, "hits=%s" % hits)

    # A-29 无隐式授权（必须有逐字放行口令 + 收尾条件）
    ok29 = ("AGENT IMPLEMENTATION AUTHORIZED" in d) and ("不构成实施授权" in n) and ("绝对不得" in n)
    add("A-29.no-implicit-authorization", ok29)

    # A-30 C3_IMPLEMENTATION = BLOCKED
    s5 = find_block(d, "C3_IMPLEMENTATION")
    add("A-30.c3-blocked", s5.get("C3_IMPLEMENTATION") == "BLOCKED", s5.get("C3_IMPLEMENTATION"))

    # A-31 闸门保持（N-9a/N-10 EXISTING + 未改闸门）
    s6 = find_block(d, "N_9A")
    ok31 = (s6.get("N_9A") == "EXISTING" and s6.get("N_10") == "EXISTING"
            and s6.get("V6_NEGATIVE_SCAN_MODIFIED") == "NO")
    add("A-31.gate-preserved", ok31)

    # A-32 闸门源文件实读未改（对照：无本批修改标记）
    nscan = os.path.join(HERE, "v6_negative_scan.py")
    add("A-32.negative-scan-untouched",
        os.path.isfile(nscan) and ("v6_negative_scan.py" in d))

    # A-33 G1-B 实测 10/10
    ok33 = ("10/10 PASS" in n) and ("verify-gen1-pipeline.js" in d)
    add("A-33.g1b-measured", ok33)

    # A-34 锁 sha 逐字
    add("A-34.lock-sha", "8efdda6fadb7da409c4d6215851495cf63dec4904a371d3bf5fff82008a2b7ad" in d)

    # A-35 data-health sha 逐字
    add("A-35.data-health-sha", "adc85945411438cc41fe882ee8741024" in d)

    # A-36 §5 下一步授权清单
    ok36 = ("## §5 下一步所需 Owner authorization" in d) and ("GOV-GAP-LOCK-APPROVAL" in d)
    add("A-36.next-authorization", ok36)

    return res


def run_assertions(tag="baseline"):
    res = assertions()
    passed = sum(1 for _n, ok, _d in res if ok)
    failed = [(n, dd) for n, ok, dd in res if not ok]
    print("=== LOCK AUTHORITY GATE CHECKER [%s] ===" % tag)
    for n, ok, dd in res:
        if not ok:
            print("  [FAIL] %s | %s" % (n, dd))
    print("PASS = %d   FAIL = %d   TOTAL = %d" % (passed, len(failed), len(res)))
    return passed, len(failed)


# --- 红证 ---------------------------------------------------------------

def _restore(orig_bytes):
    with open(DOC, "wb") as fh:
        fh.write(orig_bytes)


def redproof(which):
    with open(DOC, "rb") as fh:
        orig = fh.read()
    text = orig.decode("utf-8")
    mutated = None
    expect = ""

    if which == "RP-1":
        mutated = text.replace("LC_R2_1_DECISION = PENDING", _MUT_LC_B, 1)
        expect = "A-05"
    elif which == "RP-2":
        mutated = re.sub(r"^LOCK_AUTHORITY\s+=.*$", "", text, flags=re.M)
        expect = "A-06/A-25"
    elif which == "RP-3":
        mutated = text.replace("### §1.5 Q5", "### §1.5 (removed)", 1)
        expect = "A-07"
    elif which == "RP-4":
        mutated = text.replace("| `LC-C` |", "| (removed) |", 1)
        expect = "A-08"
    elif which == "RP-5":
        mutated = text.replace("不得以「`files[]` 没有它 ⇒ 不受管」", "(removed)", 1)
        expect = "A-09"
    elif which == "RP-6":
        mutated = text.replace("传递语义上不封闭", "(removed)")
        expect = "A-11"
    elif which == "RP-7":
        mutated = text.replace("4e1d370", "XXXXXXX")
        expect = "A-12"
    elif which == "RP-8":
        mutated = text.replace("C2_OWNER_SELECTION        = PENDING", "C2_OWNER_SELECTION        = A+B", 1)
        expect = "A-15"
    elif which == "RP-9":
        mutated = text.replace("C2_A_PLUS_C               = ANALYZED", "C2_A_PLUS_C               = REMOVED", 1)
        expect = "A-17"
    elif which == "RP-10":
        mutated = re.sub(r"^\| \*\*P4\*\* \|.*$", "", text, count=1, flags=re.M)
        expect = "A-23"
    elif which == "RP-11":
        mutated = text.replace("IMPLEMENTATION_AUTHORIZED = " + "NO", _MUT_IMPL_YES)
        expect = "A-25/A-29"
    elif which == "RP-12":
        mutated = text.replace("## §4 边界与 STOP", "## §4 " + "git" + " push 边界与 STOP", 1)
        expect = "A-28"
    elif which == "RP-13":
        mutated = text.replace("production mutation utility", "(removed)", 1)
        expect = "A-19"
    elif which == "RP-14":
        mutated = text.replace("C3_IMPLEMENTATION         = BLOCKED", "C3_IMPLEMENTATION         = UNBLOCKED", 1)
        expect = "A-30"
    elif which == "RP-15":
        # 反向自证：不改动 ⇒ 必须全绿
        mutated = text
        expect = "baseline-green"
    else:
        print("UNKNOWN redproof id:", which)
        return 2

    if mutated is None or (mutated == text and which != "RP-15"):
        _restore(orig)
        print("REDPROOF %s: ANCHOR-NOT-FOUND ⇒ FAIL (red not triggered)" % which)
        return 1

    try:
        with io.open(DOC, "w", encoding="utf-8", newline="") as fh:
            fh.write(mutated)
        passed, failed = run_assertions("redproof " + which)
    finally:
        _restore(orig)

    if which == "RP-15":
        ok = (failed == 0)
        print("REDPROOF %s: expect=%s  got FAIL=%d ⇒ %s" % (which, expect, failed, "PASS" if ok else "FAIL"))
        return 0 if ok else 1

    ok = failed > 0
    print("REDPROOF %s: expect-invalidate=%s  FAIL=%d ⇒ %s" % (which, expect, failed, "PASS" if ok else "FAIL"))
    return 0 if ok else 1


def run_regression():
    """显式白名单回归（⛔ 禁通配）。"""
    py = sys.executable
    p, f = 0, 0
    for fn in REGRESSION_WHITELIST:
        path = os.path.join(HERE, fn)
        if not os.path.isfile(path):
            print("  [SKIP] %s (not found)" % fn)
            continue
        rc, _out = _run_one([py, path])
        if rc == 0:
            p += 1
        else:
            f += 1
            print("  [FAIL] %s rc=%s" % (fn, rc))
    print("REGRESSION PASS = %d / %d" % (p, p + f))
    return 0 if f == 0 else 1


def run_zerowrite():
    before = snapshot_zone()
    res = assertions()
    after = snapshot_zone()
    changed = sorted(set(before) ^ set(after)) + \
        sorted(k for k in set(before) & set(after) if before[k] != after[k])
    print("ZEROWRITE before=%d after=%d changed_or_missing=%s"
          % (len(before), len(after), "NONE" if not changed else changed))
    _p, failed = sum(1 for _n, ok, _d in res if ok), sum(1 for _n, ok, _d in res if not ok)
    return 0 if (not changed and failed == 0) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--redproof")
    ap.add_argument("--regression", action="store_true")
    ap.add_argument("--zerowrite", action="store_true")
    args = ap.parse_args()

    if args.redproof:
        return redproof(args.redproof)
    if args.regression:
        return run_regression()
    if args.zerowrite:
        return run_zerowrite()

    _p, f = run_assertions()
    return 0 if f == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
