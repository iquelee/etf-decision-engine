#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""v6_d1d2_decision_check.py —— Owner Decision D-1/D-2/D-3/D-4/D-5 交付件只读检查器。

职责（⛔ 只读）：
  校验两份交付件
    A) docs/gen1/GEN1_D1_D2_DECISION_20261003.md
    B) docs/gen1/ONLINE_DEPLOYMENT_PROVENANCE_20261003.md
  显式断言：
    C3_R2_DEFINED / C3_OLD_CLAIM_RETRACTED / C2_RELEASE_CONTRACT_DESIGNED /
    AUDIT_CARRIER_IDENTIFIED / ONLINE_PROVENANCE_MAPPED /
    IMPLEMENTATION_AUTHORIZED = NO / PRODUCTION_WRITE = 0 / STOP = YES
  外加：关键路径正文顺序、无越界肯定式、无部署 token、自证只读。

运行：
  python v6_d1d2_decision_check.py                 # 常规
  python v6_d1d2_decision_check.py --redproof RP-1 # 打红自证

⛔ 本脚本不修改 production / DB / manifest / authority / docs；不 deploy / merge / tag / push。
"""
import ast
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DOC1_REL = os.path.join("docs", "gen1", "GEN1_D1_D2_DECISION_20261003.md")
DOC2_REL = os.path.join("docs", "gen1", "ONLINE_DEPLOYMENT_PROVENANCE_20261003.md")
SELF_REL = os.path.join("scripts", "gen1", "evidence-capture", "v6_d1d2_decision_check.py")

# ---------------- 契约常量 ----------------

SECTIONS = ["## §0", "## §1", "## §2", "## §3", "## §4", "## §5", "## §6", "## §7"]

C3_SUBCLAIMS = ["C3-a", "C3-b", "C3-c", "C3-d", "C3-e"]
QUESTIONS = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]
NINE_ELEMS = ["**WHO**", "**WHEN**", "**WHAT evidence**", "**AUTHORITY CHECK**",
              "**STATE TRANSITION**", "**AUDIT RECORD**", "**REPLAY**", "**ROLLBACK**",
              "**ANTI-BYPASS**"]
BRANCHES = ["① **release**", "② **hold（拒绝）**", "③ **仍下行**", "④ 上行态"]
AUDIT_FIELDS = ["reviewer identity", "review timestamp", "reason", "evidence reference",
                "previous state", "new state", "authority decision", "request/correlation id"]
ABC = ["**A：复用现有状态机制**", "**B：新增最小 admin release route**", "**C：其他现有治理通道**"]
FUNCTIONS = ["runDecisionEngine", "runGen1ShadowEod", "adminGateway", "apiGateway",
             "materializeIndicators", "runGen2ShadowEod", "extractFundamental",
             "fetchDailyData", "fetchFundamentalNews", "fetchRealtimeData"]
THREE_SRC = ["ONLINE SOURCE", "EXPECTED SOURCE", "AUTHORIZED SOURCE"]
GAPS = ["GAP-P1", "GAP-P2", "GAP-P3", "GAP-P4", "GAP-P5"]

# owner 对 provenance 件的 9 项要求（§0.1 映射表）
OWNER9 = ["每个线上函数的实际来源", "SHA256 / fingerprint", "对应本地 artifact",
          "对应 Git commit", "是否属于 frozen baseline", "是否属于 audit snapshot",
          "是否存在无法追溯来源的部分", "哪些差异是预期的", "哪些差异属于治理缺口"]

# 冻结关键路径（逐字保持，顺序不可调）
CP_SEQ = ["C-3", "C-2", "C-1", "C-4", "X-2", "A-1", "D-1", "D-2", "D-3",
          "X-1", "B-1", "G-1", "G-2", "A-2a", "A-2b", "G17", "E-5"]

# STOP 字段（doc1 §7 代码块）
STOP_EXPECT = {
    "C3_R2_DEFINED": "YES", "C3_OLD_CLAIM_RETRACTED": "YES", "C3_R2_AUTHORIZED": "NO",
    "C2_RELEASE_CONTRACT_DESIGNED": "YES", "C2_RELEASE_CONTRACT_IMPLEMENTED": "NO",
    "AUDIT_CARRIER_IDENTIFIED": "YES", "AUDIT_CARRIER_LOCUS_CHOSEN": "NO",
    "ONLINE_PROVENANCE_MAPPED": "YES", "IMPLEMENTATION_AUTHORIZED": "NO",
    "PRODUCTION_WRITE_AUTHORIZED": "NO", "EVIDENCE_EXECUTION_AUTHORIZED": "NO",
    "GE04_AUTHORIZED": "NO", "PRODUCTION_WRITE": "0", "DB_WRITE": "0", "DEPLOY": "NO",
    "AUTHORITY_CHANGE": "NO", "CANARY": "OFF", "EVIDENCE_EXECUTION": "NO",
    "GE04": "NO", "STOP": "YES",
}
# doc2 §7 代码块（owner 指定 8 项 + 零动作常量）
STOP2_EXPECT = {
    "ONLINE_PROVENANCE_MAPPED": "YES", "FUNCTIONS_TOTAL": "10",
    "FUNCTIONS_TRACED_TO_COMMIT": "10", "UNTRACEABLE_FUNCTIONS": "0",
    "PACKAGE_LEVEL_PARITY": "NOT_REVERIFIED", "PRODUCTION_WRITE": "0", "DB_WRITE": "0",
    "DEPLOY": "NO", "AUTHORITY_CHANGE": "NO", "CANARY": "OFF",
    "EVIDENCE_EXECUTION": "NO", "GE04": "NO", "IMPLEMENTATION_AUTHORIZED": "NO",
    "STOP": "YES",
}

OVERCLAIM = re.compile(
    r"Deploy\s*=\s*YES|Canary\s*=\s*ON|auto_execution\s*=\s*true"
    r"|GE-04\s*=\s*AUTHORIZED|Produces?\s+production\s+authorization"
)


def _deploy_tokens():
    """部署/变更命令 token —— ★ 运行时片段拼装，⛔ 不以完整字面量出现（防自指）。"""
    parts = [
        ("tcb", "fn", "deploy"),
        ("tcb", "deploy"),
        ("tcb", "fn", "update"),
        ("tcb", "fn", "delete"),
        ("firebase", "deploy"),
        ("serverless", "deploy"),
        ("git", "push"),
        ("git", "merge"),
        ("npm", "run", "deploy"),
        ("docker", "push"),
    ]
    return [" ".join(p) for p in parts]


# ---------------- 只读自证（AST） ----------------

def _dotted(node):
    try:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return _dotted(node.value) + "." + node.attr
    except Exception:
        pass
    return ""


class SelfScan(ast.NodeVisitor):
    def __init__(self):
        self.write_open = []
        self.exec_calls = []
        self.token_hits = []

    def visit_Call(self, node):
        name = _dotted(node.func)
        if name == "open":
            for kw in node.keywords:
                if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                    if any(c in str(kw.value.value) for c in ("w", "a", "x", "+")):
                        self.write_open.append(getattr(node, "lineno", 0))
        if name in ("subprocess.run", "subprocess.Popen", "subprocess.call",
                    "subprocess.check_output", "os.system", "os.popen"):
            self.exec_calls.append(getattr(node, "lineno", 0))
        self.generic_visit(node)

    def visit_Constant(self, node):
        if isinstance(node.value, str):
            for t in _deploy_tokens():
                if t in node.value:
                    self.token_hits.append((getattr(node, "lineno", 0), t))
        self.generic_visit(node)


# ---------------- 工具 ----------------

def normdoc(s):
    return re.sub(r"[ \t]+", " ", s)


def slice_section(doc, start_marker, end_marker=None):
    i = doc.find(start_marker)
    if i < 0:
        return ""
    j = doc.find(end_marker, i + len(start_marker)) if end_marker else len(doc)
    return doc[i:j if j > 0 else len(doc)]


def cp_sequence(cp):
    """★ 从正文按段抽取节点（段内按字符位置排序）—— ⛔ 不得只查静态常量表。"""
    seq = []
    for seg in cp.split(","):
        found = []
        for k in CP_SEQ:
            m = re.search(re.escape(k) + r"(?![A-Za-z0-9-])", seg)
            if m:
                found.append((m.start(), k))
        found.sort()
        for _, k in found:
            if k not in seq:
                seq.append(k)
    return seq


def stop_fields(doc, marker):
    """只解析指定章节的**代码块**；逐行 ^KEY = VALUE$（剥离行尾注释）。"""
    sec = slice_section(doc, marker, None)
    blocks = re.findall(r"```[a-zA-Z]*\n(.*?)```", sec, re.S)
    body = "\n".join(blocks)
    got = {}
    for line in body.splitlines():
        line = line.split("#", 1)[0].rstrip()
        m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*([A-Za-z0-9_]+)\s*$", line)
        if m:
            got.setdefault(m.group(1), set()).add(m.group(2).upper())
    return body, got


class Checker:
    def __init__(self):
        self.rows = []

    def chk(self, cid, desc, ok, detail=""):
        self.rows.append({"id": cid, "desc": desc, "ok": bool(ok), "detail": detail})


# ---------------- 载入 ----------------

def load():
    with io.open(os.path.join(ROOT, DOC1_REL), "r", encoding="utf-8") as f:
        d1 = f.read()
    with io.open(os.path.join(ROOT, DOC2_REL), "r", encoding="utf-8") as f:
        d2 = f.read()
    return d1, d2


# ---------------- 主检查 ----------------

def run_checks(d1, d2):
    C = Checker()
    n1 = normdoc(d1)
    n2 = normdoc(d2)

    # ---- D-01 自证只读 ----
    with io.open(os.path.join(ROOT, SELF_REL), "r", encoding="utf-8") as f:
        selfsrc = f.read()
    sc = SelfScan()
    sc.visit(ast.parse(selfsrc))
    C.chk("D-01.self-readonly",
          "本检查器无写模式 open / 无 exec / 无部署 token",
          not sc.write_open and not sc.exec_calls and not sc.token_hits,
          "open=%s exec=%s tok=%s" % (sc.write_open, sc.exec_calls, sc.token_hits))

    # ---- D-02 两件存在且非空 ----
    C.chk("D-02.docs-present", "两份交付件存在且非空",
          len(d1) > 3000 and len(d2) > 3000, "d1=%d d2=%d" % (len(d1), len(d2)))

    # ---- D-03/D-04 章节齐全 ----
    m1 = [s for s in SECTIONS if s not in d1]
    C.chk("D-03.doc1-sections", "D1/D2 决策件 §0–§7 齐全", not m1, "missing=%s" % m1)
    m2 = [s for s in SECTIONS if s not in d2]
    C.chk("D-04.doc2-sections", "Provenance 件 §0–§7 齐全", not m2, "missing=%s" % m2)

    # ---- D-05 C3_R2_DEFINED ----
    ok5 = ("C3_R2_DEFINED" in d1
           and "数据健康诊断已经产生并落库" in d1
           and "没有进入权威 runtime health/latch 载体" in d1)
    C.chk("D-05.c3-r2-defined", "C3_R2_DEFINED 定义齐备（含逐字定义句）", ok5)

    # ---- D-06 C3_OLD_CLAIM_RETRACTED ----
    # ★ 解析 §1.2 正文表格：⛔ 不得只查静态常量表/单词出现（否则逐行状态被改仍全绿）
    sec12 = slice_section(d1, "### §1.2", "### §1.3")
    rows12 = [ln for ln in sec12.splitlines() if ln.startswith("| 「")]
    ok6a = ("C3_OLD_CLAIM_RETRACTED" in d1
            and len(rows12) >= 3
            and all("RETRACTED" in ln for ln in rows12)
            and ("ACCEPTED" not in sec12))
    ok6b = ("产出但未落库" in d1) and ("已落库" in d1)
    ok6c = "不得为了满足旧 Gap 描述而制造一个不存在的「落库修复」" in n1
    C.chk("D-06.old-claim-retracted", "旧表述（产出但未落库）被显式撤回 + 禁止伪修复",
          ok6a and ok6b and ok6c, "a=%s b=%s c=%s" % (ok6a, ok6b, ok6c))

    # ---- D-07 七问逐项 ----
    m = [q for q in QUESTIONS if ("#### %s ·" % q) not in d1]
    C.chk("D-07.seven-questions", "owner 7 问逐项回答（Q1…Q7）", not m, "missing=%s" % m)

    # ---- D-08 C3-a…C3-e 子句 ----
    m = [k for k in C3_SUBCLAIMS if k not in d1]
    C.chk("D-08.c3-subclaims", "C3_R2_DEFINED 拆解子句 C3-a…C3-e 齐全", not m, "missing=%s" % m)

    # ---- D-09 R2 边界（≠ 已修复 / 未授权）----
    ok9 = ("R2 = 规格 / 口径修正" in n1) and ("R2 ≠ 功能已修复" in n1) \
          and ("C3_R2_AUTHORIZED = NO" in n1)
    C.chk("D-09.r2-boundary", "声明 R2 为口径修正、≠已修复、且未授权", ok9)

    # ---- D-10 C2_RELEASE_CONTRACT_DESIGNED ----
    ok10 = ("C2_RELEASE_CONTRACT_DESIGNED = YES" in n1) \
           and ("C2_RELEASE_CONTRACT_IMPLEMENTED = NO" in n1)
    C.chk("D-10.release-contract-designed",
          "C2_RELEASE_CONTRACT_DESIGNED=YES 且 IMPLEMENTED=NO", ok10)

    # ---- D-11 九要素 ----
    m = [k for k in NINE_ELEMS if k not in d1]
    C.chk("D-11.nine-elements", "release contract 九要素齐全", not m, "missing=%s" % m)

    # ---- D-12 状态机值域 + ⛔ 无 HEALTHY ----
    ok12 = ("OK: 'OK', WARNING: 'WARNING', DEGRADED: 'DEGRADED', ML_OFF: 'ML_OFF'" in d1) \
           and ("不存在 `HEALTHY`" in d1) and ("⛔ 不得在契约中引入 `HEALTHY`" in d1)
    C.chk("D-12.state-enum", "状态机值域以代码为准，且显式拒绝不存在的 HEALTHY", ok12)

    # ---- D-13 四分支 + recovery_allowed 瞬时性 ----
    m = [k for k in BRANCHES if k not in d1]
    ok13 = (not m) and ("`recovery_allowed` 不是持久状态" in d1)
    C.chk("D-13.branches", "四分支齐备 + 声明 recovery_allowed 非持久判据", ok13, "missing=%s" % m)

    # ---- D-14 A/B/C 三方案 + 不排名不选 ----
    m = [k for k in ABC if k not in d1]
    ok14 = (not m) and ("不排名" in d1) and ("不自行选" in d1)
    C.chk("D-14.abc-options", "A/B/C 三方案齐备且声明不排名/不自行选", ok14, "missing=%s" % m)

    # ---- D-15 §2.4 「是否真的需要新增 adminGateway write route」----
    ok15 = ("是否真的需要新增 `adminGateway` write route" in d1) and ("不是默认答案" in d1)
    C.chk("D-15.write-route-question", "显式回答『是否真的需要新增 write route』", ok15)

    # ---- D-16 AUDIT_CARRIER_IDENTIFIED ----
    # ---- D-16 审计载体已识别但落点未选（★ 正反双向）----
    ok16 = ("AUDIT_CARRIER_IDENTIFIED = YES" in n1) \
           and ("AUDIT_CARRIER_LOCUS_CHOSEN = NO" in n1) \
           and ("AUDIT_CARRIER_LOCUS_CHOSEN = YES" not in n1) \
           and ("尚未选定" in d1)
    C.chk("D-16.audit-carrier", "AUDIT_CARRIER_IDENTIFIED=YES 且落点未选（双向）", ok16)

    # ---- D-17 审计 8 字段 ----
    m = [k for k in AUDIT_FIELDS if k not in d1]
    C.chk("D-17.audit-fields", "审计行 8 字段齐全", not m, "missing=%s" % m)

    # ---- D-18 审计载体盘点（存在/不存在均给证据）----
    ok18 = ("专门的「admin 操作日志」集合" in d1) and ("⛔ **不存在**" in d1) \
           and ("`param_config`" in d1) and ("probe_param_config_20261003_auditcarrier.json" in d1)
    C.chk("D-18.audit-inventory", "审计载体盘点覆盖『存在/不存在』并附实测证据", ok18)

    # ---- D-19 ONLINE_PROVENANCE_MAPPED ----
    ok19 = ("ONLINE_PROVENANCE_MAPPED" in n2) and ("ONLINE_PROVENANCE_MAPPED = YES" in n2)
    C.chk("D-19.online-provenance-mapped", "ONLINE_PROVENANCE_MAPPED=YES", ok19)

    # ---- D-20 10/10 函数映射 ----
    m = [k for k in FUNCTIONS if k not in d2]
    ok20 = (not m) and ("FUNCTIONS_TRACED_TO_COMMIT = 10" in n2) \
           and ("UNTRACEABLE_FUNCTIONS = 0" in n2)
    C.chk("D-20.functions-mapped", "10/10 函数映射且零不可追溯", ok20, "missing=%s" % m)

    # ---- D-21 owner 9 项要求映射 ----
    m = [k for k in OWNER9 if k not in d2]
    C.chk("D-21.owner9-coverage", "owner 9 项要求 → 章节映射齐备", not m, "missing=%s" % m)

    # ---- D-22 三概念 ----
    m = [k for k in THREE_SRC if k not in d2]
    ok22 = (not m) and ("⛔ 三者不可互换" in d2)
    C.chk("D-22.three-concepts", "ONLINE/EXPECTED/AUTHORIZED SOURCE 三概念分离", ok22,
          "missing=%s" % m)

    # ---- D-23 ref-0908 定性更正 ----
    ok23 = ("`ref-0908`" in d2) and ("不是 authority" in d2) and ("8fc3ba66" in d2) \
           and ("REF_0908_IS_SNAPSHOT" in d2)
    C.chk("D-23.ref0908-correction", "ref-0908 被定性为快照（⛔ 非来源），权威=commit", ok23)

    # ---- D-24 GAP-P1…P5 ----
    m = [k for k in GAPS if k not in d2]
    C.chk("D-24.governance-gaps", "治理缺口 GAP-P1…GAP-P5 齐全", not m, "missing=%s" % m)

    # ---- D-25 关键路径正文顺序（★ 解析正文）----
    s6 = slice_section(d1, "## §6", "## §7")
    seq = cp_sequence(s6)
    C.chk("D-25.cp-order", "关键路径正文顺序 == 冻结序列", seq == CP_SEQ, "seq=%s" % "|".join(seq))
    C.chk("D-25b.cp-complete", "关键路径节点齐备（17 项）", len(seq) == len(CP_SEQ),
          "n=%d" % len(seq))
    ok25c = ("X-1" in seq and "A-1" in seq and seq.index("X-1") > seq.index("A-1")
             and "B-1" in seq and "A-2b" in seq and seq.index("B-1") < seq.index("A-2b"))
    C.chk("D-25c.two-rulings", "X-1 在 A-1 之后 且 B-1 先于 A-2b", ok25c)

    # ---- D-26 B-1 性质升级声明 ----
    ok26 = ("Deployment Provenance / Source-of-Truth clarification" in d1) \
           and ("性质升级" in d1) and ("不改位置、不改顺序" in d1)
    C.chk("D-26.b1-upgraded", "B-1 升级为 Deployment Provenance（位置/顺序不变）", ok26)

    # ---- D-27 无越界肯定式（两件都查）----
    hit = OVERCLAIM.findall(d1) + OVERCLAIM.findall(d2)
    C.chk("D-27.no-overclaim", "两件均不含越界肯定式", not hit, "hits=%s" % hit)

    # ---- D-28 无部署 token（两件都查）----
    hits = [t for t in _deploy_tokens() if (t in d1 or t in d2)]
    C.chk("D-28.no-deploy-token", "两件均不含部署/变更命令 token", not hits, "hits=%s" % hits)

    # ---- D-29 doc1 STOP 代码块字段与取值 ----
    body1, got1 = stop_fields(d1, "## §7")
    bad1 = []
    for f, v in STOP_EXPECT.items():
        if f not in got1:
            bad1.append(f + ":MISSING")
        elif got1[f] != {v}:
            bad1.append("%s:%s" % (f, sorted(got1[f])))
    C.chk("D-29.stop-state", "D1/D2 决策件 §7 STOP 代码块字段齐全且非放行",
          bool(body1) and not bad1, "bad=%s" % bad1)

    # ---- D-30 doc2 STOP 代码块字段与取值 ----
    body2, got2 = stop_fields(d2, "## §7")
    bad2 = []
    for f, v in STOP2_EXPECT.items():
        if f not in got2:
            bad2.append(f + ":MISSING")
        elif got2[f] != {v}:
            bad2.append("%s:%s" % (f, sorted(got2[f])))
    C.chk("D-30.stop-state-provenance", "Provenance 件 §7 STOP 代码块字段齐全且非放行",
          bool(body2) and not bad2, "bad=%s" % bad2)

    # ---- D-31 显式声明『不构成实施授权』（三条独立判据）----
    ok31a = ("不构成实施授权" in d1) and ("不代表已获授权" in d1)
    ok31b = "AGENT IMPLEMENTATION AUTHORIZED" in d1
    forbid = re.findall(r"已完成授权|已获授权实现|AUTHORIZED\s*=\s*YES", d1 + d2)
    C.chk("D-31.no-implicit-authorization",
          "显式声明『不构成实施授权』+ 引用放行口令 + ⛔ 无『已授权』肯定式",
          ok31a and ok31b and not forbid,
          "a=%s b=%s forbid=%s" % (ok31a, ok31b, forbid))

    # ---- D-32 零写声明 ----
    ok32 = ("PRODUCTION_WRITE = 0" in n1) and ("DB_WRITE = 0" in n1) \
           and ("PRODUCTION_WRITE = 0" in n2)
    C.chk("D-32.zero-write", "两件均声明零写（PRODUCTION_WRITE / DB_WRITE = 0）", ok32)

    return C


# ---------------- 红证 ----------------

def redproof(case):
    d1, d2 = load()
    base = run_checks(d1, d2)
    base_fail = [r["id"] for r in base.rows if not r["ok"]]

    def fails_after(mut1, mut2, expect_id):
        C = run_checks(mut1, mut2)
        bad = [r["id"] for r in C.rows if not r["ok"]]
        return (expect_id in bad), bad

    def report(tag, ok, bad):
        print("[%s] %s / fail=%s" % (tag, "PASS" if ok else "FAIL", bad))
        return 0 if ok else 1

    if case == "RP-1":      # 删 C3_R2_DEFINED 定义句 ⇒ D-05 打红
        mut = d1.replace("数据健康诊断已经产生并落库", "数据健康诊断有问题")
        ok, bad = fails_after(mut, d2, "D-05.c3-r2-defined")
        return report("RP-1", ok and mut != d1, bad)
    if case == "RP-2":      # 撤销『旧表述撤回』⇒ D-06 打红
        mut = d1.replace("RETRACTED（部分证伪）", "ACCEPTED（成立）")
        ok, bad = fails_after(mut, d2, "D-06.old-claim-retracted")
        return report("RP-2", ok and mut != d1, bad)
    if case == "RP-3":      # 把契约改成已实现 ⇒ D-10 打红
        mut = d1.replace("C2_RELEASE_CONTRACT_IMPLEMENTED = NO",
                         "C2_RELEASE_CONTRACT_IMPLEMENTED = YES")
        ok, bad = fails_after(mut, d2, "D-10.release-contract-designed")
        return report("RP-3", ok and mut != d1, bad)
    if case == "RP-4":      # 把审计落点改成『已选』⇒ D-16 打红（★ 覆盖多空格形态）
        mut = re.sub(r"AUDIT_CARRIER_LOCUS_CHOSEN\s*=\s*NO",
                     "AUDIT_CARRIER_LOCUS_CHOSEN = YES", d1)
        ok, bad = fails_after(mut, d2, "D-16.audit-carrier")
        return report("RP-4", ok and mut != d1, bad)
    if case == "RP-5":      # 篡改 provenance 映射 ⇒ D-20 打红
        mut = d2.replace("FUNCTIONS_TRACED_TO_COMMIT = 10", "FUNCTIONS_TRACED_TO_COMMIT = 5")
        ok, bad = fails_after(d1, mut, "D-20.functions-mapped")
        return report("RP-5", ok and mut != d2, bad)
    if case == "RP-6":      # 篡改 CP 顺序（X-1 前移）⇒ D-25/D-25c 打红
        mut = d1.replace(" → X-1\n → B-1", " → B-1\n → X-1")
        ok, bad = fails_after(mut, d2, "D-25.cp-order")
        return report("RP-6", ok and mut != d1, bad)
    if case == "RP-7":      # 篡改 STOP 值（IMPLEMENTATION_AUTHORIZED=NO→YES）⇒ D-29 打红
        mut = d1.replace("IMPLEMENTATION_AUTHORIZED       = NO",
                         "IMPLEMENTATION_AUTHORIZED       = YES")
        ok, bad = fails_after(mut, d2, "D-29.stop-state")
        return report("RP-7", ok and mut != d1, bad)
    if case == "RP-8":      # 注入越界肯定式（★ 运行时拼装，⛔ 无完整字面量）⇒ D-27 打红
        corpus = " ".join(("Deploy", "=", "YES"))
        mut = d2.replace("## §7", corpus + "\n\n## §7")
        ok, bad = fails_after(d1, mut, "D-27.no-overclaim")
        return report("RP-8", ok and mut != d2, bad)
    if case == "RP-9":      # 注入部署 token（运行时拼装）⇒ D-28 打红
        corpus = " ".join(("git", "push"))
        mut = d1.replace("## §7", corpus + "\n\n## §7")
        ok, bad = fails_after(mut, d2, "D-28.no-deploy-token")
        return report("RP-9", ok and mut != d1, bad)
    if case == "RP-10":     # 删 HEALTHY 禁令 ⇒ D-12 打红
        mut = d1.replace("⛔ 不得在契约中引入 `HEALTHY`", "可以引入 `HEALTHY`")
        ok, bad = fails_after(mut, d2, "D-12.state-enum")
        return report("RP-10", ok and mut != d1, bad)
    if case == "RP-11":     # 覆盖『不构成实施授权』⇒ D-31 打红
        mut = d1.replace("不构成实施授权", "已完成授权")
        ok, bad = fails_after(mut, d2, "D-31.no-implicit-authorization")
        return report("RP-11", ok and mut != d1, bad)
    if case == "RP-12":     # 反向自证：未变异时必须全绿
        print("[RP-12] baseline PASS=%d FAIL=%d" % (len(base.rows) - len(base_fail),
                                                    len(base_fail)))
        return 0 if not base_fail else 1
    print("未知 redproof case：%s" % case)
    return 2


def main(argv):
    if "--redproof" in argv:
        i = argv.index("--redproof")
        case = argv[i + 1] if i + 1 < len(argv) else ""
        try:
            return redproof(case)
        except (ValueError, IndexError) as exc:
            print("FAIL-CLOSED: %s" % exc)
            return 2
    try:
        d1, d2 = load()
        C = run_checks(d1, d2)
    except (IOError, OSError) as exc:
        print("FAIL-CLOSED: %s" % exc)
        return 2
    n_fail = 0
    for x in C.rows:
        if not x["ok"]:
            n_fail += 1
            print("FAIL %-34s %s | %s" % (x["id"], x["desc"], x["detail"]))
    print("-" * 72)
    print("PASS = %d   FAIL = %d   TOTAL = %d" % (len(C.rows) - n_fail, n_fail, len(C.rows)))
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
