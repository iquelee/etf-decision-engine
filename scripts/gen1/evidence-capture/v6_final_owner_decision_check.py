#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FINAL OWNER DECISION GATE（第十二轮）只读 checker。

校验 docs/gen1/GEN1_FINAL_OWNER_DECISION_20261003.md 与
     docs/gen1/GEN1_IMPLEMENTATION_PLAN_A+B_20261003.md：

  - LC-R2-1 = LC-C 双层锁模型（rule / files[] / dependency closure）齐备
  - C2_OWNER_SELECTION = A+B + 必须保留的 14 要素
  - P1..P5 ADOPTED + 逐项 EXECUTED = NO + 治理记录/部署授权两轴分离
  - C3-R2 planning AUTHORIZED / implementation NOT_YET_AUTHORIZED
  - GOV-GAP 两个独立 work item + RETRACTED documentation-only 计划
  - 闸门保持（N-9a / N-10 EXISTING，⛔ 未修闸门）
  - 硬边界零放行
  - 红证：删除/篡改任一关键裁定内容必须打红
  - 回归：显式白名单（⛔ 禁通配）
  - 零写：out/ 与 fixtures/ 快照前后一致

用法：
  python v6_final_owner_decision_check.py
  python v6_final_owner_decision_check.py --redproof RP-3
  python v6_final_owner_decision_check.py --regression
  python v6_final_owner_decision_check.py --zerowrite
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

DOC1_REL = os.path.join("docs", "gen1", "GEN1_FINAL_OWNER_DECISION_20261003.md")
DOC2_REL = os.path.join("docs", "gen1", "GEN1_IMPLEMENTATION_PLAN_A+B_20261003.md")
DOC1 = os.path.join(REPO, DOC1_REL)
DOC2 = os.path.join(REPO, DOC2_REL)

SECTIONS1 = ["## §0", "## §1", "## §2", "## §3", "## §4",
             "## §5", "## §6", "## §7", "## §8", "## §9"]
SECTIONS2 = ["## §0", "## §1", "## §2", "## §3", "## §4", "## §5", "## §6"]

CHAIN = ["LC-C", "LOCK GOVERNANCE", "C3-R2", "C-1", "C-4",
         "X-2 PRECONDITION", "A-1", "D-1 → D-2 → D-3", "X-1", "B-1",
         "G-1 → G-2", "A-2a → A-2b", "G17", "E-5"]

C3_SIX = [
    "明确 `rule` 与 `files[]` 的双层语义",
    "明确 dependency closure 规则",
    "纳入正确的 binding / approval 闭环",
    "明确 lock 更新后的 baseline 身份",
    "明确 G1-B 从 10→11 的影响",
    "明确是否需要新增 `GOV-GAP-LOCK-APPROVAL`",
]

AB_14 = [
    "server-side authority enforcement",
    "natural-person actor",
    "approval",
    "8-field audit",
    "prev state",
    "new state",
    "reason",
    "evidence",
    "correlation ID",
    "anti-bypass",
    "snapshot",
    "replay",
    "rollback",
    "恢复 ≠ 升档",
]

CRITERIA = [
    "HARD_REQUIRED missing",
    "PIPELINE_MISSING",
    "BENCHMARK_MISSING",
    "SEMANTICALLY_NULLABLE",
]

P_NOTES = [
    "`D-007` 补录 ≠ 重新授权历史 deployment",
    "`BASELINE_ACCEPTED` ≠ `DEPLOYMENT_AUTHORIZATION`",
    "parity debt",
    "`8fc3ba66` ≠ production deployment",
    "`8fc3ba66` ≠ master HEAD",
]

Q12 = ["### §2.Q%d" % i for i in range(1, 14)]

STOP1 = {
    "LC_R2_1_DECISION": "LC-C",
    "LOCK_MODEL": "TWO_LAYER",
    "RULE_LAYER": "BEHAVIOR_DOMAIN_AUTHORITY",
    "FILES_LAYER": "BYTE_BINDING_AUTHORITY",
    "DEPENDENCY_CLOSURE": "REQUIRED",
    "C2_OWNER_SELECTION": "A+B",
    "C2_PROMOTE_SCRIPTS_CLASS": "PRODUCTION_MUTATION_UTILITY",
    "P1": "ADOPTED",
    "P2": "ADOPTED",
    "P3": "ADOPTED",
    "P4": "ADOPTED",
    "P5": "ADOPTED",
    "GOVERNANCE_RECORD": "YES",
    "DEPLOYMENT_AUTHORIZATION": "NO",
    "P1_EXECUTED": "NO",
    "P2_EXECUTED": "NO",
    "P3_EXECUTED": "NO",
    "P4_EXECUTED": "NO",
    "P5_EXECUTED": "NO",
    "PACKAGE_LEVEL_PARITY": "NOT_REVERIFIED",
    "LEDGER_HISTORY_MODIFIED": "NO",
    "C3_R2_IMPLEMENTATION_PLANNING": "AUTHORIZED",
    "C3_R2_IMPLEMENTATION": "NOT_YET_AUTHORIZED",
    "C3_IMPLEMENTATION": "BLOCKED",
    "N_9A": "EXISTING",
    "N_10": "EXISTING",
    "V6_NEGATIVE_SCAN_MODIFIED": "NO",
    "HARNESS_MAINTENANCE_N9A_N10": "REGISTERED",
    "DOC_CHANGE_TYPE": "DOCUMENTATION_ONLY",
    "MAIN_DOC_BYTES_MODIFIED": "NO",
    "RETRACT_DOC_CHANGE_EXECUTED": "NO",
    "CRITICAL_PATH_CHANGED": "YES",
    "CRITICAL_PATH_TAIL_CHANGED": "NO",
    "CROSS_COMPONENT_PRECONDITION": "P5_TO_A_PLUS_B",
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

STOP2 = {
    "PLAN_STATUS": "PRESENT",
    "PLAN_IS_AUTHORIZATION": "NO",
    "C3_R2_IMPLEMENTATION_PLANNING": "AUTHORIZED",
    "C3_R2_IMPLEMENTATION": "NOT_YET_AUTHORIZED",
    "C3_R2_PRODUCTION_WRITE_SURFACE": "ONE_FILE",
    "C3_R2_SCHEMA_CHANGE": "NONE",
    "C3_R2_LOCK_UPDATE_REQUIRED": "YES",
    "C3_R2_G1B_ITEMS": "11",
    "C3_R2_DATA_MIGRATION": "NONE",
    "C2_OWNER_SELECTION": "A+B",
    "C2_A_PLUS_B_PLAN": "PRESENT",
    "C2_ROUTE_ADDED": "NO",
    "C2_DEPLOY_REQUIRED": "YES",
    "C2_P5_HARD_PRECONDITION": "YES",
    "C2_SDK_BYPASS_STRUCTURALLY_CLOSED": "NO",
    "GOV_GAP_LOCK_APPROVAL": "REGISTERED",
    "GOV_GAP_C": "REGISTERED",
    "GOV_GAP_ACTOR": "REGISTERED",
    "RETRACT_DOC_CHANGE_EXECUTED": "NO",
    "HARNESS_MAINTENANCE_N9A_N10": "REGISTERED",
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

BOUNDARY = ["PRODUCTION_WRITE", "DB_WRITE", "DEPLOY", "AUTHORITY_CHANGE",
            "CANARY", "EVIDENCE_EXECUTION", "GE04", "IMPLEMENTATION_AUTHORIZED"]

OVERCLAIM = re.compile(
    r"IMPLEMENTATION_AUTHORIZED\s*=\s*YES"
    r"|C3_R2_IMPLEMENTATION\s*=\s*AUTHORIZED"
    r"|P[1-5]_EXECUTED\s*=\s*YES"
    r"|DEPLOYMENT_AUTHORIZATION\s*=\s*YES"
    r"|GOVERNANCE_RECORD\s*=\s*NO"
    r"|DEPLOY\s*=\s*YES"
    r"|CANARY\s*=\s*ON"
    r"|GE04\s*=\s*YES"
    r"|V6_NEGATIVE_SCAN_MODIFIED\s*=\s*YES"
    r"|N_9A\s*=\s*FIXED"
    r"|N_10\s*=\s*FIXED"
    r"|LOCK_MODEL\s*=\s*SINGLE_LAYER"
    r"|DEPENDENCY_CLOSURE\s*=\s*OPTIONAL"
    r"|C2_OWNER_SELECTION\s*=\s*A\+C"
    r"|C2_OWNER_SELECTION\s*=\s*PENDING"
    r"|C2_PROMOTE_SCRIPTS_CLASS\s*=\s*GOVERNANCE_CHANNEL"
    r"|LC_R2_1_DECISION\s*=\s*LC-[AB]\b"
    r"|C3_IMPLEMENTATION\s*=\s*UNBLOCKED"
    r"|C2_ROUTE_ADDED\s*=\s*YES"
    r"|C2_DEPLOY_REQUIRED\s*=\s*NO"
    r"|C2_SDK_BYPASS_STRUCTURALLY_CLOSED\s*=\s*YES"
    r"|PLAN_IS_AUTHORIZATION\s*=\s*YES"
    r"|RETRACT_DOC_CHANGE_EXECUTED\s*=\s*YES"
    r"|MAIN_DOC_BYTES_MODIFIED\s*=\s*YES"
    r"|C3_R2_DATA_MIGRATION\s*=\s*REQUIRED"
    r"|HARNESS_MAINTENANCE_N9A_N10\s*=\s*(?:FIXED|DONE|CLOSED)"
    r"|MASTER_IS_ONLY_AUTHORITY\s*=\s*YES"
)

# ★ 负控 / 变异字面量一律运行时片段拼装（消除 checker 源码自指面，见 TOOLING §3.8/§3.9）
_MUT_IMPL_YES = "IMPLEMENTATION_AUTHORIZED" + " = " + "YES"
_MUT_LC_B = "LC_R2_1_DECISION" + " = LC" + "-B"

BT = chr(96)  # backtick（避免在源码里出现成对反引号）
_MUT_C2_PENDING = "C2_OWNER_SELECTION" + " = " + "PENDING"
_MUT_N9A_FIXED = "N_9A" + " = " + "FIXED"
_MUT_PLAN_YES = "PLAN_IS_AUTHORIZATION" + " = " + "YES"


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


def read(path):
    with io.open(path, encoding="utf-8") as fh:
        return fh.read()


def norm(s):
    return re.sub(r"\s+", " ", s)


def blocks(text):
    """全部 ```text 围栏块 -> List[dict]（逐块解析 KEY = VALUE）。"""
    out = []
    for m in re.finditer(r"```text\n(.*?)```", text, re.S):
        fields = {}
        for line in m.group(1).splitlines():
            g = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*([A-Za-z0-9_.+\-]+)\s*$", line)
            if g:
                fields[g.group(1)] = g.group(2)
        if fields:
            out.append(fields)
    return out


def raw_blocks(text):
    return [m.group(1) for m in re.finditer(r"```text\n(.*?)```", text, re.S)]


def find_block(text, key):
    for blk in blocks(text):
        if key in blk:
            return blk
    return {}


def field_values(text, key):
    return [b[key] for b in blocks(text) if key in b]


def all_eq(text, key, val, min_count=1):
    vs = field_values(text, key)
    return len(vs) >= min_count and all(v == val for v in vs)


def self_source():
    with io.open(__file__, encoding="utf-8") as fh:
        return fh.read()


WRITE_ALLOWED_FUNCS = {"_restore", "redproof"}


def _func_ranges(tree):
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

    唯一例外：红证 harness 必须能「改-断言-还原」文档 ⇒ DOC 写操作仅允许出现在
    _restore / redproof 内（AST 行区间判定，⛔ 不用字面量定位自身）。
    """
    src = self_source()
    tree = ast.parse(src)
    ranges = _func_ranges(tree)
    bad = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            name = getattr(fn, "attr", None) or getattr(fn, "id", None)
            if isinstance(fn, ast.Attribute) and name in ("remove", "unlink", "rmtree",
                                                          "write_text", "write_bytes"):
                bad.append("os-write:" + str(getattr(node, "lineno", "?")))
            if isinstance(fn, ast.Name) and name in ("system", "popen", "remove",
                                                     "unlink", "rmtree"):
                bad.append(name)
            if isinstance(fn, ast.Attribute) and name in ("system", "popen", "run", "call",
                                                          "check_output", "check_call", "Popen"):
                mod = getattr(getattr(fn, "value", None), "id", None)
                if mod in ("subprocess", "os"):
                    bad.append("%s.%s@%s" % (mod, name, getattr(node, "lineno", "?")))
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
    "v6_final_owner_decision_check.py",
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

    bad = check_self_readonly()
    add("A-01.self-readonly", not bad, "offenders=%s" % bad)

    ok_files = os.path.isfile(DOC1) and os.path.isfile(DOC2)
    add("A-02.docs-exist", ok_files, "%s | %s" % (DOC1_REL, DOC2_REL))
    if not ok_files:
        return res

    d1 = read(DOC1)
    d2 = read(DOC2)
    n1 = norm(d1)
    n2 = norm(d2)

    miss = [s for s in SECTIONS1 if s not in d1]
    add("A-03.doc1-sections", not miss, "missing=%s" % miss)

    miss = [s for s in SECTIONS2 if s not in d2]
    add("A-04.doc2-sections", not miss, "missing=%s" % miss)

    # A-05 LC-C（全部围栏块取值一致 + 正文）
    ok5 = (all_eq(d1, "LC_R2_1_DECISION", "LC-C", min_count=2)
           and "LC_R2_1_DECISION" in n1)
    add("A-05.lc-r2-1-equals-lc-c", ok5, "vals=%s" % field_values(d1, "LC_R2_1_DECISION"))

    # A-06 四 token 双层模型
    need6 = {"LOCK_MODEL": "TWO_LAYER",
             "RULE_LAYER": "BEHAVIOR_DOMAIN_AUTHORITY",
             "FILES_LAYER": "BYTE_BINDING_AUTHORITY",
             "DEPENDENCY_CLOSURE": "REQUIRED"}
    miss6 = [k for k, v in need6.items() if not all_eq(d1, k, v, min_count=2)]
    add("A-06.two-layer-model", not miss6, "missing=%s" % miss6)

    # A-07 裁定链（五跳）
    miss7 = [x for x in ["受管行为域", "dependency closure", "具体字节绑定"] if x not in n1]
    add("A-07.decision-chain", not miss7, "missing=%s" % miss7)

    # A-08 两层语义（范围权威 vs 状态权威）
    ok8 = ("BEHAVIOR_DOMAIN_AUTHORITY" in d1 and "BYTE_BINDING_AUTHORITY" in d1
           and "范围权威" in n1 and "状态权威" in n1)
    add("A-08.two-layer-semantics", ok8)

    # A-09 closure 规则（终止条件 + 差集 + 三步）
    ok9 = ("终止条件" in n1 and "闭包差集" in n1 and "Δ = S1" in n1
           and "DEPENDENCY_CLOSURE = REQUIRED" in d1
           and ("### §1.4 " + BT + "DEPENDENCY_CLOSURE" + BT + " 规则") in d1)
    add("A-09.closure-rule", ok9)

    # A-10 六项前置（owner 清单）
    miss10 = [x for x in C3_SIX if x not in norm(d1)]
    add("A-10.six-prerequisites", not miss10, "missing=%s" % miss10)

    # A-11 ⛔ 禁止读法逐字
    ok11 = ("⛔ files[] 未列出" in n1 and "文件不受管" in n1
            and "禁止的推论" in n1 and "不得以「`files[]` 没有它 ⇒ 不受管」" in n1)
    add("A-11.forbidden-reading", ok11)

    # A-12 C2 = A+B
    ok12 = (all_eq(d1, "C2_OWNER_SELECTION", "A+B", min_count=2)
            and "C2_OWNER_SELECTION = A+B" in n1)
    add("A-12.c2-owner-selection-ab", ok12, "vals=%s" % field_values(d1, "C2_OWNER_SELECTION"))

    # A-13 14 要素
    miss13 = [x for x in AB_14 if x not in d1]
    add("A-13.ab-14-elements", not miss13, "missing=%s" % miss13)

    # A-14 P5 硬前置
    ok14 = ("P5 → A+B" in n1 and "硬前置" in n1)
    add("A-14.p5-hard-precondition", ok14)

    # A-15 promote-*.js 定性保持
    ok15 = (all_eq(d1, "C2_PROMOTE_SCRIPTS_CLASS", "PRODUCTION_MUTATION_UTILITY", min_count=2)
            and "PRODUCTION_MUTATION_UTILITY" in d1
            and "⛔ **不得**重新定义为 governance channel" in n1)
    add("A-15.promote-classification", ok15)

    # A-16 治理记录 / 部署授权 两轴
    ok16 = (all_eq(d1, "GOVERNANCE_RECORD", "YES", min_count=2)
            and all_eq(d1, "DEPLOYMENT_AUTHORIZATION", "NO", min_count=2)
            and "不得互推" in n1)
    add("A-16.two-axis-separation", ok16)

    # A-17 P1..P5 ADOPTED + 三条保持式
    miss17 = [k for k in ["P1", "P2", "P3", "P4", "P5"] if not all_eq(d1, k, "ADOPTED", min_count=1)]
    ok17 = (not miss17) and all(x in n1 for x in P_NOTES)
    add("A-17.p1-p5-adopted", ok17, "missing=%s" % miss17)

    # A-18 planning AUTHORIZED / implementation NOT_YET_AUTHORIZED
    miss18 = []
    if not all_eq(d1, "C3_R2_IMPLEMENTATION_PLANNING", "AUTHORIZED", min_count=2):
        miss18.append("planning")
    if not all_eq(d1, "C3_R2_IMPLEMENTATION", "NOT_YET_AUTHORIZED", min_count=2):
        miss18.append("implementation")
    ok18 = (not miss18) and "C3_R2_IMPLEMENTATION = NOT_YET_AUTHORIZED" in n1 \
        and "C3_R2_IMPLEMENTATION = NOT_YET_AUTHORIZED" in n2
    add("A-18.r2-planning-boundary", ok18, "missing=%s" % miss18)

    # A-19 四项判据（两份件都必须有）
    miss19 = [c for c in CRITERIA if (c not in d1) or (c not in d2)]
    add("A-19.four-criteria", not miss19, "missing=%s" % miss19)

    # A-20 GOV-GAP 独立 work item（不得并入）
    ok20 = ("GOV-GAP-LOCK-APPROVAL" in d1 and "GOV-GAP-C" in d1
            and "不得偷偷并入" in n1
            and "GOV-GAP-LOCK-APPROVAL" in d2 and "GOV-GAP-C" in d2
            and ("### §5.1 " + BT + "GOV-GAP-LOCK-APPROVAL" + BT) in d1
            and ("### §5.2 " + BT + "GOV-GAP-C" + BT) in d1)
    add("A-20.gov-gap-independent", ok20)

    # A-21 RETRACTED documentation-only
    ok21 = ("DOCUMENTATION_ONLY" in d1 and "RETRACT_TARGET_POINTS_TO" in d1
            and "C3-A_PLUS_R2" in d1 and "append-only" in n1)
    add("A-21.retract-plan", ok21)

    # A-22 闸门保持 + harness 登记
    ok22 = (all_eq(d1, "N_9A", "EXISTING", min_count=2)
            and all_eq(d1, "N_10", "EXISTING", min_count=2)
            and all_eq(d1, "V6_NEGATIVE_SCAN_MODIFIED", "NO", min_count=2)
            and all_eq(d1, "HARNESS_MAINTENANCE_N9A_N10", "REGISTERED", min_count=2)
            and "HARNESS-MAINTENANCE-N9A-N10" in d1)
    add("A-22.gate-preserved", ok22)

    # A-23 依赖链逐字（解析围栏块正文顺序）
    chain_ok = False
    for blk in raw_blocks(d1):
        lines = [l.strip() for l in blk.splitlines()]
        lines = [l for l in lines if l and l != "↓"]
        if lines and lines[0] == "LC-C":
            chain_ok = (lines == CHAIN)
            break
    add("A-23.dependency-chain-frozen", chain_ok)

    # A-24 DOC1 STOP 全字段
    halt1 = find_block(d1, "STOP")
    miss24 = [k for k, v in STOP1.items() if halt1.get(k) != v]
    add("A-24.doc1-stop-block", not miss24, "missing=%s" % miss24[:10])

    # A-25 DOC2 STOP 全字段
    halt2 = find_block(d2, "STOP")
    miss25 = [k for k, v in STOP2.items() if halt2.get(k) != v]
    add("A-25.doc2-stop-block", not miss25, "missing=%s" % miss25[:10])

    # A-26 硬边界 8 项（两件）
    ok26 = all(all_eq(d1, k, STOP1[k], min_count=1) for k in BOUNDARY) and \
        all(all_eq(d2, k, STOP2[k], min_count=1) for k in BOUNDARY)
    add("A-26.hard-boundary", ok26)

    # A-27 无越界式
    hits = OVERCLAIM.findall(d1) + OVERCLAIM.findall(d2)
    add("A-27.no-overclaim", not hits, "hits=%s" % hits)

    # A-28 无部署 token
    hits = [t for t in _deploy_tokens() if (t in d1) or (t in d2)]
    add("A-28.no-deploy-token", not hits, "hits=%s" % hits)

    # A-29 无隐式授权（放行口令 + 声明 + 收尾条件，两件）
    ok29 = all(x in n for n in (n1, n2)
               for x in ["AGENT IMPLEMENTATION AUTHORIZED", "不构成实施授权", "绝对不得"])
    add("A-29.no-implicit-authorization", ok29)

    # A-30 DOC2 行级 owner 表
    miss30 = [x for x in ["L34-39", "L60", "L66", "L67", "L111", "L117-120"] if x not in d2]
    add("A-30.line-level-owner", not miss30, "missing=%s" % miss30)

    # A-31 lock 4 文件 + G1-B 11
    ok31 = ("最小变更面 = 4 文件" in n2 and "10 → 11" in n2
            and "ROOT_ANCHOR_PIPELINE_LOCK" in d2 and "PIPELINE_FILES" in d2)
    add("A-31.lock-change-surface", ok31)

    # A-32 12 问齐备（Q1..Q13）
    miss32 = [q for q in Q12 if q not in d2]
    add("A-32.ab-twelve-questions", not miss32, "missing=%s" % miss32)

    # A-33 SDK 绕过不能结构性关闭（诚实结论）
    ok33 = ("C2_SDK_BYPASS_STRUCTURALLY_CLOSED = NO" in n2
            and "无法" in n2 and "结构性" in n2)
    add("A-33.sdk-bypass-honest", ok33)

    # A-34 DOC2 关键边界 token
    miss34 = [k for k in ["PLAN_IS_AUTHORIZATION", "C3_R2_PRODUCTION_WRITE_SURFACE",
                          "C2_ROUTE_ADDED", "C2_DEPLOY_REQUIRED",
                          "GOV_GAP_ACTOR", "HARNESS_MAINTENANCE_N9A_N10"]
              if not all_eq(d2, k, STOP2[k], min_count=1)]
    add("A-34.doc2-boundary-tokens", not miss34, "missing=%s" % miss34)

    # A-35 NS-9 命名空间
    ok35 = ("NS-9" in d1 and "LC-C" in d1 and "C2" in d1)
    add("A-35.namespace-ns9", ok35)

    # A-36 Critical Path 变化登记
    ok36 = (all_eq(d1, "CRITICAL_PATH_CHANGED", "YES", min_count=1)
            and all_eq(d1, "CRITICAL_PATH_TAIL_CHANGED", "NO", min_count=1))
    add("A-36.critical-path-registered", ok36)

    # A-37 GOV-GAP-ACTOR 登记
    ok37 = ("GOV-GAP-ACTOR" in d1) and ("GOV-GAP-ACTOR" in d2)
    add("A-37.gov-gap-actor", ok37)

    # A-38 行尾纯 LF + 规模
    b1 = open(DOC1, "rb").read()
    b2 = open(DOC2, "rb").read()
    ok38 = (b1.count(b"\r\n") == 0 and b2.count(b"\r\n") == 0
            and len(b1) > 8000 and len(b2) > 8000)
    add("A-38.pure-lf", ok38, "doc1_crlf=%d doc2_crlf=%d" % (b1.count(b"\r\n"), b2.count(b"\r\n")))

    # A-39 白名单含本 checker 且存在
    ok39 = ("v6_final_owner_decision_check.py" in REGRESSION_WHITELIST
            and os.path.isfile(os.path.join(HERE, "v6_final_owner_decision_check.py")))
    add("A-39.regression-whitelist", ok39)

    # A-40 闸门文件存在且本件 ⛔ 未声称已修
    ok40 = (os.path.isfile(os.path.join(HERE, "v6_negative_scan.py"))
            and all_eq(d1, "V6_NEGATIVE_SCAN_MODIFIED", "NO", min_count=1))
    add("A-40.negative-scan-untouched", ok40)

    return res


def run_assertions(tag="baseline"):
    res = assertions()
    passed = sum(1 for _n, ok, _d in res if ok)
    failed = [(n, dd) for n, ok, dd in res if not ok]
    print("=== FINAL OWNER DECISION GATE CHECKER [%s] ===" % tag)
    for n, ok, dd in res:
        if not ok:
            print("  [FAIL] %s | %s" % (n, dd))
    print("PASS = %d   FAIL = %d   TOTAL = %d" % (passed, len(failed), len(res)))
    return passed, len(failed)


# --- 红证 ---------------------------------------------------------------

TARGET = {"RP-18": DOC2}


def _restore(orig_bytes, path=DOC1):
    with open(path, "wb") as fh:
        fh.write(orig_bytes)


def redproof(which):
    path = TARGET.get(which, DOC1)
    with open(path, "rb") as fh:
        orig = fh.read()
    text = orig.decode("utf-8")
    mutated = None
    expect = ""

    def sub_all(pat, repl):
        new, n = re.subn(pat, repl, text, flags=re.M)
        return new if n else None

    if which == "RP-1":
        mutated = sub_all(r"^LC_R2_1_DECISION\s*=\s*LC-C\s*$", _MUT_LC_B)
        expect = "A-05"
    elif which == "RP-2":
        mutated = sub_all(r"^LOCK_MODEL\s*=\s*TWO_LAYER\s*$", "LOCK_MODEL = SINGLE_LAYER")
        expect = "A-06"
    elif which == "RP-3":
        mutated = sub_all(r"^RULE_LAYER\s*=\s*.*$", "")
        expect = "A-06"
    elif which == "RP-4":
        mutated = sub_all(r"^FILES_LAYER\s*=\s*.*$", "")
        expect = "A-06"
    elif which == "RP-5":
        mutated = sub_all(r"^DEPENDENCY_CLOSURE\s*=\s*REQUIRED\s*$",
                          "DEPENDENCY_CLOSURE = OPTIONAL")
        expect = "A-06"
    elif which == "RP-6":
        mutated = text.replace("### §1.4 `DEPENDENCY_CLOSURE` 规则", "### §1.4 (removed)", 1)
        expect = "A-09"
    elif which == "RP-7":
        mutated = sub_all(r"^C2_OWNER_SELECTION\s*=\s*A\+B\s*$", _MUT_C2_PENDING)
        expect = "A-12"
    elif which == "RP-8":
        mutated = text.replace("PRODUCTION_MUTATION_UTILITY", "GOVERNANCE_CHANNEL")
        expect = "A-15"
    elif which == "RP-9":
        mutated = sub_all(r"^P4\s*=\s*ADOPTED\s*$", "")
        expect = "A-17"
    elif which == "RP-10":
        mutated = sub_all(r"^P5\s*=\s*ADOPTED\s*$", "")
        expect = "A-17"
    elif which == "RP-11":
        mutated = sub_all(r"^GOVERNANCE_RECORD\s*=\s*YES\s*$", "GOVERNANCE_RECORD = NO")
        expect = "A-16"
    elif which == "RP-12":
        mutated = sub_all(r"^C3_R2_IMPLEMENTATION\s*=\s*NOT_YET_AUTHORIZED\s*$",
                          "C3_R2_IMPLEMENTATION = AUTHORIZED")
        expect = "A-18"
    elif which == "RP-13":
        mutated = sub_all(r"^N_9A\s*=\s*EXISTING\s*$", _MUT_N9A_FIXED)
        expect = "A-22"
    elif which == "RP-14":
        mutated = sub_all(r"^HARNESS_MAINTENANCE_N9A_N10\s*=\s*.*$", "")
        expect = "A-22"
    elif which == "RP-15":
        mutated = sub_all(r"^IMPLEMENTATION_AUTHORIZED\s*=\s*NO\s*$", _MUT_IMPL_YES)
        expect = "A-24/A-29"
    elif which == "RP-16":
        mutated = text.replace("## §9 边界与 STOP", "## §9 " + "git" + " push 边界与 STOP", 1)
        expect = "A-28"
    elif which == "RP-17":
        mutated = text.replace("### §5.1 `GOV-GAP-LOCK-APPROVAL`", "### §5.1 (removed)", 1)
        expect = "A-20"
    elif which == "RP-18":
        mutated = sub_all(r"^PLAN_IS_AUTHORIZATION\s*=\s*NO\s*$", _MUT_PLAN_YES)
        expect = "A-34"
    elif which == "RP-19":
        mutated = text.replace("⛔ files[] 未列出", "(removed)", 1)
        expect = "A-11"
    elif which == "RP-20":
        mutated = text
        expect = "baseline-green"
    else:
        print("UNKNOWN redproof id:", which)
        return 2

    if mutated is None or (mutated == text and which != "RP-20"):
        _restore(orig, path)
        print("REDPROOF %s: ANCHOR-NOT-FOUND ⇒ FAIL (red not triggered)" % which)
        return 1

    try:
        with io.open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(mutated)
        passed, failed = run_assertions("redproof " + which)
    finally:
        _restore(orig, path)

    if which == "RP-20":
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
    failed = sum(1 for _n, ok, _d in res if not ok)
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
