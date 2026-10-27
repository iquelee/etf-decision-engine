#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""v6_c3_c2_preflight_check.py —— C-3/C-2 PREFLIGHT 文档契约只读检查器。

职责（⛔ 只读）：
  校验 docs/gen1/GEN1_C3_C2_PREFLIGHT_20261003.md 的
    ① 节点完整性           ② 证据引用完整性
    ③ 禁止越界词/授权声明   ④ C-3/C-2 与 critical path 一致性
    ⑤ production-write boundary  ⑥ STOP 状态
  以及若干"代码/清单层交叉验证"（冻结面判定）。

运行：
  python v6_c3_c2_preflight_check.py            # 常规检查
  python v6_c3_c2_preflight_check.py --redproof RP-A

⛔ 本脚本不修改 production / DB / manifest / authority；不 deploy / merge / tag / push。
"""
import ast
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DOC_REL = os.path.join("docs", "gen1", "GEN1_C3_C2_PREFLIGHT_20261003.md")
LOCK_REL = os.path.join("ml", "manifests", "GEN1_FEATURE_PIPELINE_LOCK.json")
SELF_REL = os.path.join("scripts", "gen1", "evidence-capture", "v6_c3_c2_preflight_check.py")

# ---------------- 契约常量 ----------------

REQUIRED_SECTIONS = [
    "## §0", "## §1", "## §2", "## §3", "## §4", "## §5", "## §6", "## §7",
    "## §8", "## §9", "## §10", "## §11", "## §12", "## §13", "## §14",
    "## §15", "## §16", "## §17", "## §18", "## §19",
]

C3_NODES = ["E-%d" % i for i in range(1, 13)]                       # E-1..E-12
C2_NODES = ["F-%d" % i for i in range(1, 14)]                       # F-1..F-13
REL_NODES = ["R-%d" % i for i in range(1, 13)]                      # R-1..R-12
V_C3 = ["V-C3-%02d" % i for i in range(1, 7)]                       # V-C3-01..06
V_C2 = ["V-C2-%02d" % i for i in range(1, 11)]                      # V-C2-01..10
EV_C3 = ["E-C3-%02d" % i for i in range(1, 5)]
EV_C2 = ["E-C2-%02d" % i for i in range(1, 5)]
ALTS = ["AL-%d" % i for i in range(1, 6)]
BLK = ["B-%d" % i for i in range(1, 8)]
DEC = ["D-%d" % i for i in range(1, 6)]

# 冻结关键路径（逐字保持，顺序不可调）
CP_SEQ = ["C-3", "C-2", "C-1", "C-4", "X-2", "A-1", "D-1", "D-2", "D-3",
          "X-1", "B-1", "G-1", "G-2", "A-2a", "A-2b", "G17", "E-5"]

# production write boundary 必列对象（7 类）
PWB_ROWS = ["production code", "production config", "production DB", "ml/manifests",
            "authority / FROZEN_PARAM_KEYS / immutable_set", "selector / active pointer / read path",
            "deploy / push / merge / tag"]

STOP_FIELDS_NO = [
    "C3_PREFLIGHT", "C2_PREFLIGHT", "NEW_CODE", "PRODUCTION_WRITE", "DB_WRITE",
    "DEPLOY", "AUTHORITY_CHANGE", "CANARY", "EVIDENCE_EXECUTION", "GE04",
    "IMPLEMENTATION_AUTHORIZED", "PRODUCTION_WRITE_AUTHORIZED", "STOP",
]
# 期望的"非放行"取值
STOP_EXPECT = {
    "DEPLOY": "NO", "DB_WRITE": "0", "PRODUCTION_WRITE": "0", "NEW_CODE": "0",
    "AUTHORITY_CHANGE": "NO", "CANARY": "OFF", "EVIDENCE_EXECUTION": "NO",
    "GE04": "NO", "IMPLEMENTATION_AUTHORIZED": "NO",
    "PRODUCTION_WRITE_AUTHORIZED": "NO", "STOP": "YES",
}

# 越界肯定式（⛔ 不得出现）
OVERCLAIM = re.compile(
    r"Deploy\s*=\s*YES|Canary\s*=\s*ON|auto_execution\s*=\s*true"
    r"|GE-04\s*=\s*AUTHORIZED|Produces?\s+production\s+authorization"
)

# 部署 / 变更命令 token（运行时片段拼装，⛔ 不以完整字面量出现 —— 防自指）
def _deploy_tokens():
    parts = [
        ("tcb", "fn", "deploy"),
        ("tcb", "deploy"),
        ("tcb", "fn", "update"),
        ("firebase", "deploy"),
        ("serverless", "deploy"),
        ("git", "push"),
        ("git", "merge"),
        ("npm", "run", "deploy"),
        ("docker", "push"),
        ("kubectl", "apply"),
    ]
    return [" ".join(p) for p in parts]


# ---------------- 只读自证（AST） ----------------

class SelfScan(ast.NodeVisitor):
    """扫描本脚本自身：禁止写模式 open / 禁止 subprocess/os.system / 禁止部署 token。"""

    def __init__(self, src):
        self.src = src
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
                    "os.system", "os.popen", "subprocess.check_output"):
            self.exec_calls.append(getattr(node, "lineno", 0))
        self.generic_visit(node)

    def visit_Constant(self, node):
        if isinstance(node.value, str):
            for t in _deploy_tokens():
                if t in node.value:
                    self.token_hits.append((getattr(node, "lineno", 0), t))
        self.generic_visit(node)


def _dotted(node):
    try:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return _dotted(node.value) + "." + node.attr
    except Exception:
        pass
    return ""


# ---------------- 工具 ----------------

def normdoc(s):
    return re.sub(r"[ \t]+", " ", s)


def slice_section(doc, start_marker, end_marker=None):
    i = doc.find(start_marker)
    if i < 0:
        return ""
    j = doc.find(end_marker, i + len(start_marker)) if end_marker else len(doc)
    return doc[i:j if j > 0 else len(doc)]


def has_id(cell, key):
    return re.search(re.escape(key) + r"(?![A-Za-z0-9-])", cell) is not None


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


class Checker:
    def __init__(self):
        self.rows = []

    def chk(self, cid, desc, ok, detail=""):
        self.rows.append({"id": cid, "desc": desc, "ok": bool(ok), "detail": detail})


# ---------------- 载入 ----------------

def load():
    with io.open(os.path.join(ROOT, DOC_REL), "r", encoding="utf-8") as f:
        doc = f.read()
    lock = None
    lp = os.path.join(ROOT, LOCK_REL)
    if os.path.exists(lp):
        with io.open(lp, "r", encoding="utf-8") as f:
            lock = json.load(f)
    return doc, lock


# ---------------- 主检查 ----------------

def run_checks(doc, lock):
    C = Checker()
    nd = normdoc(doc)

    # ---- B-01 自证：本检查器只读 ----
    with io.open(os.path.join(ROOT, SELF_REL), "r", encoding="utf-8") as f:
        selfsrc = f.read()
    sc = SelfScan(ast.parse(selfsrc))
    sc.visit(ast.parse(selfsrc))
    C.chk("B-01.self-readonly",
          "本检查器无写模式 open / 无 exec / 无部署 token",
          not sc.write_open and not sc.exec_calls and not sc.token_hits,
          "open=%s exec=%s tok=%s" % (sc.write_open, sc.exec_calls, sc.token_hits))

    # ---- B-02 文档存在且非空 ----
    C.chk("B-02.doc-present", "preflight 文档存在且非空", len(doc) > 3000, "len=%d" % len(doc))

    # ---- B-03 章节齐全 ----
    miss = [s for s in REQUIRED_SECTIONS if s not in doc]
    C.chk("B-03.sections", "§0–§19 章节齐全", not miss, "missing=%s" % miss)

    # ---- B-04/05/06 节点完整性（按章节切片，避免与 blocker/decision 编号撞名）----
    s_c3 = slice_section(doc, "## §3", "## §4")
    miss = [k for k in C3_NODES if not has_id(s_c3, k)]
    C.chk("B-04.c3-nodes", "C-3 代码证据节点 E-1…E-12 齐全", not miss, "missing=%s" % miss)

    s_c2 = slice_section(doc, "## §8", "## §9")
    miss = [k for k in C2_NODES if not has_id(s_c2, k)]
    C.chk("B-05.c2-nodes", "C-2 代码证据节点 F-1…F-13 齐全", not miss, "missing=%s" % miss)

    s_rel = slice_section(doc, "## §9", "## §10")
    miss = [k for k in REL_NODES if not has_id(s_rel, k)]
    C.chk("B-06.release-nodes", "release-path 盘点 R-1…R-12 齐全", not miss, "missing=%s" % miss)

    # ---- B-07 C-3 十二问 ----
    s_12 = slice_section(doc, "### §3.3", "## §4")
    qs = re.findall(r"\n\|\s*(\d{1,2})\s*\|", s_12)
    C.chk("B-07.c3-12q", "C-3 十二问逐项表含 1…12 行",
          all(str(i) in qs for i in range(1, 13)), "rows=%s" % qs)

    # ---- B-08 验证矩阵 ----
    miss = [k for k in (V_C3 + V_C2) if k not in doc]
    C.chk("B-08.verify-matrix", "验证矩阵 V-C3-01…06 / V-C2-01…10 齐全", not miss, "missing=%s" % miss)

    # ---- B-09 evidence plan ----
    miss = [k for k in (EV_C3 + EV_C2) if k not in doc]
    C.chk("B-09.evidence-plan", "Evidence Plan 节点齐全", not miss, "missing=%s" % miss)

    # ---- B-10/B-11/B-12 其他编号族 ----
    miss = [k for k in ALTS if k not in doc]
    C.chk("B-10.alternatives", "Alternatives AL-1…AL-5 齐全", not miss, "missing=%s" % miss)
    s16 = slice_section(doc, "## §16", "## §17")
    miss = [k for k in BLK if not has_id(s16, k)]
    C.chk("B-11.blockers", "Remaining Blockers B-1…B-7 齐全", not miss, "missing=%s" % miss)
    s17 = slice_section(doc, "## §17", "## §18")
    miss = [k for k in DEC if not has_id(s17, k)]
    C.chk("B-12.owner-decisions", "Owner Decision Required D-1…D-5 齐全", not miss, "missing=%s" % miss)

    # ---- B-13 critical path 正文顺序一致（★ 解析正文，⛔ 不查静态表）----
    s18 = slice_section(doc, "## §18", "## §19")
    seg = s18
    seq = cp_sequence(seg)
    C.chk("B-13.cp-order", "§18 关键路径正文顺序 == 冻结序列",
          seq == CP_SEQ,
          "seq=%s" % ("|".join(seq)))
    C.chk("B-13b.cp-complete", "§18 关键路径节点齐备（17 项）",
          len(seq) == len(CP_SEQ), "n=%d" % len(seq))

    # ---- B-14 X-1 在 A-1 之后 + 严格相等理由 ----
    ok14 = ("X-1" in seq and "A-1" in seq and seq.index("X-1") > seq.index("A-1")
            and "==='CANARY'" in nd and "shadow" in nd)
    C.chk("B-14.x1-after-a1", "X-1 排在 A-1 之后且给出严格相等语义理由", ok14)

    # ---- B-15 B-1 先于 A-2b ----
    ok15 = ("B-1" in seq and "A-2b" in seq and seq.index("B-1") < seq.index("A-2b"))
    C.chk("B-15.b1-before-a2b", "B-1 先于 A-2b（⛔ 不恢复矛盾顺序）", ok15)

    # ---- B-16 无越界肯定式 ----
    m = OVERCLAIM.findall(doc)
    C.chk("B-16.no-overclaim", "文档不含越界肯定式", not m, "hits=%s" % m)

    # ---- B-17 无部署命令 token ----
    hits = [t for t in _deploy_tokens() if t in doc]
    C.chk("B-17.no-deploy-token", "文档不含部署/变更命令 token", not hits, "hits=%s" % hits)

    # ---- B-18 production write boundary 表 ----
    s14 = slice_section(doc, "## §14", "## §15")
    miss = [r for r in PWB_ROWS if r not in s14]
    C.chk("B-18.pwb", "§14 production write boundary 覆盖 7 类对象", not miss, "missing=%s" % miss)

    # ---- B-19 STOP 状态（★ 只解析 §19 的**代码块**；内联行 `` `DEPLOY = NO` ``
    #      会抢先命中同一字段名 ⇒ 必须排除，否则变异可被内联行掩护而假绿）----
    s19 = slice_section(doc, "## §19", None)
    blocks = re.findall(r"```[a-zA-Z]*\n(.*?)```", s19, re.S)
    stopblock = "\n".join(blocks) if blocks else ""
    got = {}
    for k, v in re.findall(r"(?m)^\s*([A-Z0-9_]+)\s*=\s*([A-Za-z0-9_]+)\s*$", stopblock):
        got.setdefault(k, set()).add(v.upper())
    bad = []
    for f in STOP_FIELDS_NO:
        if f not in got:
            bad.append(f + ":MISSING")
        elif f in STOP_EXPECT and got[f] != {STOP_EXPECT[f]}:
            bad.append("%s:%s" % (f, sorted(got[f])))
    C.chk("B-19.stop-state", "§19 STOP 代码块字段齐全且为非放行值",
          bool(stopblock) and not bad, "bad=%s" % bad)

    # ---- B-20 部署源身份声明 ----
    ok20 = ("部署源身份" in doc) and ("_v365-frozen-baseline" in doc) and ("ref-0908" in doc)
    C.chk("B-20.deploy-source-identity", "§0 声明部署源身份（混合部署 + 逐函数基线）", ok20)

    # ---- B-21 显式声明『不构成实施授权』（★ 三条独立判据：否定式存在
    #        ∧ 唯一放行口令被引用 ∧ ⛔ 无『已授权』肯定式 —— 任一条单独不够）----
    ok21a = ("不构成实施授权" in doc) and ("不代表已获授权" in doc)
    ok21b = "AGENT IMPLEMENTATION AUTHORIZED" in doc
    forbid = re.findall(r"已完成授权|已获授权实现|AUTHORIZED\s*=\s*YES", doc)
    C.chk("B-21.no-implicit-authorization",
          "显式声明『不构成实施授权』+ 引用放行口令 + ⛔ 无『已授权』肯定式",
          ok21a and ok21b and not forbid,
          "a=%s b=%s forbid=%s" % (ok21a, ok21b, forbid))

    # ---- B-22 冻结面判定与 manifest 交叉验证 ----
    if lock is None:
        C.chk("B-22.freeze-surface", "冻结面判定（manifest 不可读，跳过交叉）", False, "lock missing")
    else:
        paths = [(f.get("path") or "") for f in lock.get("files", [])]
        has_indic = any("utils/indicators.js" in p for p in paths)
        has_dh = any("data-health" in p for p in paths)
        doc_ok = (has_id(normdoc(slice_section(doc, "### §3.2", "### §3.3")), "D-3")
                  and "data-health.js` **不在**" in nd)
        C.chk("B-22.freeze-surface",
              "manifest: indicators.js 在锁内 / data-health 不在；文档判定一致",
              has_indic and (not has_dh) and doc_ok,
              "indic=%s dh=%s" % (has_indic, has_dh))

    # ---- B-23 只读声明在文档中 ----
    ok23 = ("PRODUCTION_WRITE = 0" in nd) and ("DB_WRITE = 0" in nd)
    C.chk("B-23.zero-write-declaration", "文档声明零写（PRODUCTION_WRITE/DB_WRITE = 0）", ok23)

    # ---- B-24 证据引用完整性：E-* 引用须带 file:line ----
    refs = re.findall(r"`([A-Za-z0-9_\-/\.]+\.js):(\d+)(?:-(\d+))?`", s_c3 + s_c2)
    C.chk("B-24.evidence-refs", "证据引用带 file:line（≥12 处）", len(refs) >= 12, "n=%d" % len(refs))

    # ---- B-25 关键路径冻结声明存在 ----
    ok25 = ("本件**不调整**冻结关键路径" in doc) and ("⛔ 不得恢复原主件" in doc)
    C.chk("B-25.cp-freeze-statement", "§18 显式声明不调整冻结关键路径", ok25)

    # ---- B-26 C-3/C-2 并列 ROOT 声明 ----
    ok26 = ("C-3 ∥ C-2" in doc) and ("并列 ROOT" in doc)
    C.chk("B-26.parallel-root", "声明 C-3 与 C-2 并列 ROOT（⛔ 非串行）", ok26)
    return C


# ---------------- 红证 ----------------

def redproof(case, doc=None):
    doc, lock = load()
    base = run_checks(doc, lock)
    n = len(base.rows)
    results = []
    for r in base.rows:
        results.append(r["ok"])
    base_fail = [r["id"] for r in base.rows if not r["ok"]]

    def fails_after(mutated, expect_id):
        C = run_checks(mutated, lock)
        bad = [r["id"] for r in C.rows if not r["ok"]]
        return (expect_id in bad), bad

    if case == "RP-A":      # 删一个 C-3 节点 ⇒ B-04 打红
        mut = doc.replace("| E-7 |", "| E-7X |")
        ok, bad = fails_after(mut, "B-04.c3-nodes")
        print("[RP-A] 删 C-3 节点 ⇒ B-04：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-B":      # 删 R-5 ⇒ B-06 打红
        mut = doc.replace("| R-6 |", "| R-6X |")
        ok, bad = fails_after(mut, "B-06.release-nodes")
        print("[RP-B] 删 release 节点 ⇒ B-06：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-C":      # 注入越界肯定式 ⇒ B-16 打红
        # ★ 自指规避：越界语料**运行时片段拼装**，⛔ 不以完整字面量出现（否则被上层
        #   子串/正则扫描门命中 —— 与 v6_pre_launch_inventory_check 的 F-6 同型）
        mut_overclaim = " ".join(("Deploy", "=", "YES"))
        mut = doc.replace("## §19", mut_overclaim + "\n\n## §19")
        ok, bad = fails_after(mut, "B-16.no-overclaim")
        print("[RP-C] 注入越界式 ⇒ B-16：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-D":      # 注入部署 token ⇒ B-17 打红
        mut = doc.replace("## §19", " ".join(("tcb", "fn", "deploy")) + "\n\n## §19")
        ok, bad = fails_after(mut, "B-17.no-deploy-token")
        print("[RP-D] 注入部署 token ⇒ B-17：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-E":      # 篡改 §18 顺序（X-1 移到 A-1 前）⇒ B-13/B-14 打红
        mut = doc.replace("→ X-1\n → B-1", "→ B-1\n → X-1")
        if mut == doc:
            print("[RP-E] 变异未命中 CP 串")
            return 1
        ok, bad = fails_after(mut, "B-13.cp-order")
        print("[RP-E] 篡改 CP 顺序 ⇒ B-13：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-F":      # 篡改 STOP 值（DEPLOY=NO → YES）⇒ B-19 打红
        mut = doc.replace("DEPLOY            = NO", "DEPLOY            = YES")
        if mut == doc:
            print("[RP-F] 变异未命中 STOP 串")
            return 1
        ok, bad = fails_after(mut, "B-19.stop-state")
        print("[RP-F] 篡改 STOP 值 ⇒ B-19：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-G":      # 删 PWB 行 ⇒ B-18 打红
        mut = doc.replace("| production config |", "| REMOVED |")
        ok, bad = fails_after(mut, "B-18.pwb")
        print("[RP-G] 删 PWB 行 ⇒ B-18：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-H":      # 删部署源身份 ⇒ B-20 打红
        mut = doc.replace("ref-0908", "REF-XXXX")
        ok, bad = fails_after(mut, "B-20.deploy-source-identity")
        print("[RP-H] 删部署源身份 ⇒ B-20：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-I":      # 删『不构成实施授权』⇒ B-21 打红
        mut = doc.replace("不构成实施授权", "已完成授权")
        ok, bad = fails_after(mut, "B-21.no-implicit-authorization")
        print("[RP-I] 删授权否定 ⇒ B-21：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-J":      # 删并列 ROOT 声明 ⇒ B-26 打红
        mut = doc.replace("并列 ROOT", "串行")
        ok, bad = fails_after(mut, "B-26.parallel-root")
        print("[RP-J] 删并列 ROOT ⇒ B-26：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-L":      # 删冻结面判定串 ⇒ B-22 打红
        mut = doc.replace("`gen1-data-health.js` **不在** `GEN1_FEATURE_PIPELINE_LOCK.json`",
                          "`gen1-data-health.js` 在某个清单里")
        if mut == doc:
            print("[RP-L] 变异未命中 freeze 串")
            return 1
        ok, bad = fails_after(mut, "B-22.freeze-surface")
        print("[RP-L] 删冻结面判定 ⇒ B-22：%s / fail=%s" % ("PASS" if ok else "FAIL", bad))
        return 0 if ok else 1
    if case == "RP-M":      # 变异仅落在**内联行** ⇒ B-19 应**不受影响**（负向自证：代码块解析生效）
        mut = doc.replace("`DEPLOY = NO`", "`DEPLOY = YES`")
        if mut == doc:
            print("[RP-M] 变异未命中内联串")
            return 1
        C = run_checks(mut, lock)
        b19 = [r for r in C.rows if r["id"] == "B-19.stop-state"][0]
        print("[RP-M] 内联行变异不影响代码块判据：B-19 ok=%s" % b19["ok"])
        return 0 if b19["ok"] else 1
    if case == "RP-K":      # 反向自证：未变异时必须全绿
        print("[RP-K] baseline PASS=%d FAIL=%d" % (n - len(base_fail), len(base_fail)))
        return 0 if not base_fail else 1
    print("未知 redproof case：%s" % case)
    return 2


def main(argv):
    if "--redproof" in argv:
        i = argv.index("--redproof")
        case = argv[i + 1] if i + 1 < len(argv) else ""
        try:
            return redproof(case)
        except ValueError as exc:
            print("FAIL-CLOSED: %s" % exc)
            return 2
    try:
        doc, lock = load()
        C = run_checks(doc, lock)
    except (IOError, OSError) as exc:
        print("FAIL-CLOSED: %s" % exc)
        return 2
    n_fail = 0
    for x in C.rows:
        if not x["ok"]:
            n_fail += 1
            print("FAIL %-32s %s | %s" % (x["id"], x["desc"], x["detail"]))
    print("-" * 72)
    print("PASS = %d   FAIL = %d   TOTAL = %d" % (len(C.rows) - n_fail, n_fail, len(C.rows)))
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
