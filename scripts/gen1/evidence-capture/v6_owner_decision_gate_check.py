#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""v6_owner_decision_gate_check.py —— Owner Decision Gate 只读检查器（第十轮）。

职责（⛔ 只读）：
  校验唯一交付件 docs/gen1/GEN1_OWNER_DECISION_GATE_20261003.md
  正向断言（owner 指定必查）：
    C-3 Owner Decision 影响（6 问）/ C-2 A+B / A+C 逐条对照 /
    P1..P5 Owner Decision 表 + 三条强制注意 /
    implementation dependency graph（★ 逐字 + Critical Path 未改）/
    仍未授权事项 / 下一步所需 Owner authorization / STOP = YES

运行：
  python v6_owner_decision_gate_check.py                   # 常规（正向断言）
  python v6_owner_decision_gate_check.py --redproof RP-1   # 打红自证
  python v6_owner_decision_gate_check.py --regression      # 回归（显式白名单）
  python v6_owner_decision_gate_check.py --zerowrite       # 零写自证

⛔ 本脚本不修改 production / DB / manifest / authority / docs；不部署 / 不合并不打 tag / 不推送远端。
⛔ RED_PROOF 只做字符串/AST 变异（在内存副本上），⛔ 从不执行任何真实生产命令。
⛔ 唯一的子进程调用点 = run_regression（显式白名单 + argv 首元素为 sys.executable + ⛔ 无 shell）。
"""
import ast
import hashlib
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DOC_REL = os.path.join("docs", "gen1", "GEN1_OWNER_DECISION_GATE_20261003.md")
SELF_REL = os.path.join("scripts", "gen1", "evidence-capture",
                        "v6_owner_decision_gate_check.py")
STOP_MARK = "## §5 边界与 STOP"

# ---------------- 契约常量 ----------------

SECTIONS = ["## §0", "## §1", "## §2", "## §3", "## §4", "## §5"]

# §1 六个子标题（owner 指定 6 问）
H_R2_SCOPE = "### §1.2 C3-γ → R2 的最小实施范围"
H_CONTRACT = "### §1.3 修改哪些契约 / 文档"
H_NOTOUCH = "### §1.4 明确不得修改哪些生产代码"
H_IMPACT = "### §1.5 是否会影响 C-1 / C-4 / X-2"
H_VMIN = "### §1.6 实施后的最小验证集"
H_ROLLBACK = "### §1.7 rollback 边界"

# §2 子标题
H_AB = "### §2.1 A+B —— 新增最小 admin release route"
H_AC = "### §2.2 A+C —— 复用 / 扩展既有 promotion channel"
H_CMP = "### §2.3 条目对照（owner 指定条目 · ⛔ 不排名）"

# R2 唯一生产写入面
R2_FILE = "src/common/utils/gen1-data-health.js"

# 不得修改的锁定文件（4/4 sha 绑定）
LOCKED_FILES = [
    "src/common/utils/indicators.js",
    "src/common/utils/trend-stage.js",
    "cloudfunctions/runGen1ShadowEod/index.js",
    "cloudfunctions/runGen1ShadowEod/frozen-manifest.json",
]
# 其他不得触碰面
NO_TOUCH_EXTRA = [
    "src/common/utils/gen1-circuit-breaker.js",
    "src/common/utils/gen1-health-state.js",
    "src/common/utils/gen1-safety-permission.js",
    "cloudfunctions/adminGateway/index.js",
]

# C-1 / C-4 / X-2 影响判据锚点
IMPACT_ANCHORS = [
    "**直接**（R2 是 C-1 的**已识别前置之一**）",
    "**间接**（R2 → C-1 → C-4）",
    "**无交集**",
    "不得过度归因",
]

# 最小验证集 V-1..V-8
VMIN_IDS = ["V-%d" % i for i in range(1, 9)]

# rollback 边界锚点
ROLLBACK_ANCHORS = [
    "还原 `src/common/utils/gen1-data-health.js` 至前一 commit",
    "⛔ **不需要**",
]

# A+B 逐条（owner 指定条目）
AB_ITEMS = [
    "最小新增 surface", "authority", "actor", "approval", "audit",
    "state transition", "replay", "rollback", "anti-bypass",
    "对现有生产代码的影响",
]
# A+C 逐条（owner 指定条目）
AC_ITEMS = [
    "必须具体说明需要扩展哪个既有机制",
    "为什么该机制能够承担 release authority",
    "需要补哪些 authority / audit / approval 字段",
    "是否会改变既有 promotion 语义",
    "replay 如何成立",
    "rollback 如何成立",
    "anti-bypass 如何成立",
    "对现有生产代码的影响",
]

# §2.3 对照表必须覆盖的条目
CMP_ROWS = [
    "| 最小新增 surface |", "| authority |", "| actor |", "| approval |",
    "| audit |", "| state transition |", "| replay |", "| rollback |",
    "| anti-bypass |", "| 对现有生产代码的影响 |",
]

# P1..P5 Owner Decision 表（★ 逐字行 · 删即红）
P_ROWS = {
    "P1": "| **P1** | D-007 缺失 | 是否补录 | deployment governance |",
    "P2": "| **P2** | PRE-GOVERNANCE | 是否写 BASELINE_ACCEPTED | baseline contract |",
    "P3": "| **P3** | package parity debt | 是否接受规则 | future deployment |",
    "P4": "| **P4** | master 非唯一 authority | 是否正式采纳 | deployment authority |",
    "P5": "| **P5** | `8fc3ba66` 为线上 `adminGateway` 对齐锚 | 是否采纳 | C-2 / A+B |",
}

# 三条强制注意（★ 逐字）
P_NOTES = [
    "补录 ≠ 重新授权",
    "PARITY_DEBT ≠ 当前 deployment authorization",
    "`8fc3ba66` ≠ master HEAD",
]

# Critical Path（★ 逐字复现 · ⛔ 不得改变）
CHAIN = ["C3-γ", "C-1", "C-4", "X-2 PRECONDITION", "A-1",
         "D-1 → D-2 → D-3", "X-1", "B-1", "G-1 → G-2",
         "A-2a → A-2b", "G17", "E-5"]

CROSS_PRECOND = "P5 → A+B"
CHAIN_START = "**Critical Path（owner 给定"

# 仍未授权事项 / 下一步授权
UNAUTH_ANCHORS = ["当前仍未授权事项", "下一步所需 Owner authorization"]
AUTH_PHRASE = "AGENT IMPLEMENTATION AUTHORIZED"

# LC-R2-1 歧义锚点
LC_ANCHORS = [
    "新发现歧义 `LC-R2-1`",
    "**不含** `src/common/utils/gen1-data-health.js`",
    "⛔ 本件不选边",
]

# STOP 字段（§5 代码块）
STOP_EXPECT = {
    "C3_DECISION": "RECLASSIFY", "C3_CONTRACT_DECISION": "C3-A",
    "C3_R2_SCOPE": "EXPLICIT", "C3_R2_AUTHORIZED": "NO",
    "C3_LOCK_AMBIGUITY": "LC_R2_1",
    "C2_OWNER_SELECTION": "PENDING",
    "C2_A_PLUS_B": "EXPLICIT", "C2_A_PLUS_C": "EXPLICIT",
    "C2_AUTHORITY": "EXPLICIT", "C2_AUDIT": "EXPLICIT",
    "C2_STATE_TRANSITION": "EXPLICIT",
    "P1": "EXPLICIT", "P2": "EXPLICIT", "P3": "EXPLICIT",
    "P4": "EXPLICIT", "P5": "EXPLICIT",
    "P1_EXECUTED": "NO", "P2_EXECUTED": "NO", "P3_EXECUTED": "NO",
    "P4_EXECUTED": "NO", "P5_EXECUTED": "NO",
    "CRITICAL_PATH_CHANGED": "NO",
    "CROSS_COMPONENT_PRECONDITION": "P5_TO_A_PLUS_B",
    "PRODUCTION_WRITE": "0", "DB_WRITE": "0",
    "DEPLOY": "NO", "AUTHORITY_CHANGE": "NO", "CANARY": "OFF",
    "EVIDENCE_EXECUTION": "NO", "GE04": "NO",
    "IMPLEMENTATION_AUTHORIZED": "NO", "STOP": "YES",
}

OVERCLAIM = re.compile(
    r"Deploy\s*=\s*YES|Canary\s*=\s*ON|auto_execution\s*=\s*true"
    r"|GE-04\s*=\s*AUTHORIZED|Produces?\s+production\s+authorization"
    r"|MASTER_IS_ONLY_AUTHORITY\s*=\s*YES"
)
C2_SEL_LINE = re.compile(r"^\s*C2_OWNER_SELECTION\s*=\s*(\S+)\s*$", re.M)


# 回归白名单（★ 显式枚举 · ⛔ 禁通配）
REGRESSION = [
    "v6_owner_decision_gate_check.py",
    "v6_c3_c2_architecture_decision_check.py",
    "v6_c3_c2_preflight_check.py",
    "v6_d1d2_decision_check.py",
    "v6_engine_identity_reconciliation_check.py",
    "v6_fingerprint_canonicalization_check.py",
    "v6_frozen_carrier_assertions.py",
    "v6_gap_dependency_plan_check.py",
    "v6_health_blocker_diagnostic_check.py",
    "v6_key2_immutability_check.py",
    "v6_owner_decision_boundary_check.py",
    "v6_pre_launch_inventory_check.py",
    "v6_seal_binding_selfcheck.py",
    "v6_contract_compatibility.py",
    "v6_contract_tool_alignment.py",
    "v6_content_assertions.py",
    "c1_gate_redproof.py",
    "c1_capture_v6_migration_test.py",
    "checkpoint_python_js_parity.py",
    "r3_contract_consumption_test.py",
]
REGRESSION_EXCLUDED = {
    "v6_negative_scan.py": "KNOWN FALSE POSITIVE（2 项既有 FAIL）· owner 明令 ⛔ 不得修改该闸门",
}


def _deploy_tokens():
    """部署/变更命令 token —— ★ 运行时片段拼装，⛔ 不以完整字面量出现（防自指）。"""
    parts = [
        ("tcb", "fn", "deploy"), ("tcb", "deploy"), ("tcb", "fn", "update"),
        ("tcb", "fn", "delete"), ("firebase", "deploy"), ("serverless", "deploy"),
        ("git", "push"), ("git", "merge"), ("npm", "run", "deploy"),
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
        self.shell_true = []
        self.loads = []

    def visit_Call(self, node):
        name = _dotted(node.func)
        if name == "open":
            for kw in node.keywords:
                if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                    if any(c in str(kw.value.value) for c in ("w", "a", "x", "+")):
                        self.write_open.append(getattr(node, "lineno", 0))
        if name.startswith("subprocess.") or name in ("os.system", "os.popen"):
            self.exec_calls.append(getattr(node, "lineno", 0))
        for kw in node.keywords:
            if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value:
                self.shell_true.append(getattr(node, "lineno", 0))
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


def stop_fields(doc, marker):
    sec = slice_section(doc, marker, None)
    blocks = re.findall(r"```[a-zA-Z]*\n(.*?)```", sec, re.S)
    body = "\n".join(blocks)
    got = {}
    for line in body.splitlines():
        line = line.split("#", 1)[0].rstrip()
        m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*([A-Za-z0-9_.-]+)\s*$", line)
        if m:
            got.setdefault(m.group(1), set()).add(m.group(2))
    return body, got


def extract_chain(doc):
    """从 §4 的 Critical Path 代码块中抽出去掉箭头后的节点序列。"""
    i = doc.find(CHAIN_START)
    if i < 0:
        return None
    seg = doc[i:]
    m = re.search(r"```[a-zA-Z]*\n(.*?)```", seg, re.S)
    if not m:
        return None
    out = []
    for raw in m.group(1).splitlines():
        t = raw.strip()
        if not t or t == "↓":
            continue
        out.append(t)
    return out


class Checker:
    def __init__(self):
        self.rows = []

    def chk(self, cid, desc, ok, detail=""):
        self.rows.append({"id": cid, "desc": desc, "ok": bool(ok), "detail": detail})


def load():
    with io.open(os.path.join(ROOT, DOC_REL), "r", encoding="utf-8") as f:
        return f.read()


# ---------------- 主检查 ----------------

def run_checks(d):
    C = Checker()
    n = normdoc(d)

    # ---- A-01 自证只读（exec 调用点限于 run_regression；无 shell=True）----
    with io.open(os.path.join(ROOT, SELF_REL), "r", encoding="utf-8") as f:
        selfsrc = f.read()
    sc = SelfScan()
    sc.visit(ast.parse(selfsrc))
    # ★ 用 AST 定位函数的真实行区间（⛔ 不用字符串自匹配，防自指）
    _tree = ast.parse(selfsrc)
    _rr = [nd for nd in _tree.body
           if isinstance(nd, ast.FunctionDef) and nd.name == "run_regression"]
    rr_lo_line = _rr[0].lineno if _rr else 10 ** 9
    rr_hi_line = getattr(_rr[0], "end_lineno", rr_lo_line) if _rr else -1
    exec_ok = all(rr_lo_line <= ln <= rr_hi_line for ln in sc.exec_calls)
    C.chk("A-01.self-readonly",
          "无写模式 open / 无部署 token / subprocess 仅存在于 run_regression / 无 shell=True",
          (not sc.write_open) and (not sc.token_hits) and exec_ok and (not sc.shell_true),
          "open=%s tok=%s exec=%s(shell_true=%s)" % (sc.write_open, sc.token_hits,
                                                     sc.exec_calls, sc.shell_true))

    # ---- A-02 交付件存在且非空 ----
    C.chk("A-02.doc-present", "Owner Decision Gate 交付件存在且非空",
          len(d) > 6000, "len=%d" % len(d))

    # ---- A-03 章节齐全 ----
    m = [s for s in SECTIONS if s not in d]
    C.chk("A-03.doc-sections", "交付件 §0–§5 齐全", not m, "missing=%s" % m)

    # ---- A-04 C-3 六问齐备 ----
    m = [h for h in (H_R2_SCOPE, H_CONTRACT, H_NOTOUCH, H_IMPACT, H_VMIN, H_ROLLBACK) if h not in d]
    C.chk("A-04.c3-six-questions", "C-3 Owner Decision 影响 6 问子节齐备", not m, "missing=%s" % m)

    # ---- A-05 冻结事实 + R2 边界逐字 ----
    ok5 = ("C3_DECISION           = RECLASSIFY" in d
           and "C3_CONTRACT_DECISION  = C3-A（coarse health state）" in d
           and "missing_features      = ML_SHADOW_SIGNAL diagnostic" in d
           and "旧「missing_features 未落库」声明 = RETRACTED" in d
           and "R2 = 规格 / 口径修正" in n
           and "R2 ≠ 功能已修复" in n and "R2 ≠ 已授权" in n)
    C.chk("A-05.frozen-facts-and-r2-boundary", "冻结事实与 R2 边界逐字（⛔ 不重新证明旧问题）", ok5)

    # ---- A-06 R2 最小实施范围（单文件 + 三处判定）----
    ok6 = (R2_FILE in d
           and "REQUIRED_FEATURES" in d and "15 项" in d
           and "HARD_REQUIRED" in d and "SEMANTICALLY_NULLABLE" in d
           and "第 ⑥ 步" in d and "假阳性降级" in d
           and "不含指标计算" in d and "不含阶段判定" in d)
    C.chk("A-06.r2-min-scope", "R2 最小范围=单文件+三处判定（含『不含指标/阶段』边界）", ok6)

    # ---- A-07 修改哪些契约/文档 + LC-R2-1 歧义 ----
    m = [k for k in LC_ANCHORS if k not in d]
    ok7 = (("### §1.3 修改哪些契约 / 文档" in d)
           and ("唯一" in d and "生产文件" in d)
           and (not m))
    C.chk("A-07.contract-docs-and-lock-ambiguity",
          "契约/文档清单齐备 + 新发现锁歧义 LC-R2-1（⛔ 不选边）", ok7, "missing=%s" % m)

    # ---- A-08 不得修改的生产代码（4 锁 + 4 其他 + 硬红线）----
    m = [k for k in LOCKED_FILES + NO_TOUCH_EXTRA if k not in d]
    ok8 = (H_NOTOUCH in d) and (not m) and ("FROZEN_PARAM_KEYS" in d) and ("永久锁" in d) \
          and ("R2 的**唯一**生产写入面" in d)
    C.chk("A-08.no-touch-list", "明确不得修改的生产代码清单（4 锁定 + 4 其他 + 硬红线）",
          ok8, "missing=%s" % m)

    # ---- A-09 C-1 / C-4 / X-2 影响判定 ----
    m = [k for k in IMPACT_ANCHORS if k not in d]
    ok9 = (not m) and ("**C-1**" in d) and ("**C-4**" in d) and ("**X-2**" in d) \
          and ("⛔ **否**" in d)
    C.chk("A-09.impact-c1-c4-x2", "C-1 直接 / C-4 间接 / X-2 无交集（+ 过度归因禁令）",
          ok9, "missing=%s" % m)

    # ---- A-10 实施后的最小验证集 V-1..V-8 ----
    miss = [k for k in VMIN_IDS if ("| %s |" % k) not in d]
    ok10 = (not miss) and ("反向断言" in d) and ("防「一刀切放宽」" in d) and ("V-3" in d)
    C.chk("A-10.min-verification-set", "最小验证集 V-1..V-8（含反向断言）", ok10, "missing=%s" % miss)

    # ---- A-11 rollback 边界 ----
    m = [k for k in ROLLBACK_ANCHORS if k not in d]
    ok11 = (not m) and ("不改历史行" in d) and ("跨代统计必须**显式声明口径**" in d)
    C.chk("A-11.rollback-boundary", "rollback 边界（单文件还原 + 无数据回滚 + 口径提示）",
          ok11, "missing=%s" % m)

    # ---- A-12 §2 三子节齐备 ----
    m = [h for h in (H_AB, H_AC, H_CMP) if h not in d]
    C.chk("A-12.c2-subsections", "C-2 对照三子节齐备（A+B / A+C / 条目对照）", not m, "missing=%s" % m)

    # ---- A-13 A+B 逐条（owner 指定 10 条）----
    miss = [k for k in AB_ITEMS if k not in d]
    ok13 = (H_AB in d) and (not miss) and ("POST /api/admin/gen1/health/release" in d) \
           and ("须追加一条只读导出步骤" in d) and ("零新集合" in d)
    C.chk("A-13.a-plus-b-items", "A+B 逐条（surface/authority/actor/approval/audit/transition/replay/rollback/anti-bypass/影响）",
          ok13, "missing=%s" % miss)

    # ---- A-14 A+C 逐条（owner 指定 8 条）----
    miss = [k for k in AC_ITEMS if k not in d]
    ok14 = (H_AC in d) and (not miss) and ("scripts/promote-*.js" in d) and ("骨架复用 + 目标集合更换" in d) \
           and ("现状不能" in d) and ("GOV-GAP-C" in d)
    C.chk("A-14.a-plus-c-items", "A+C 逐条（扩展哪个机制/为何能承担/补哪些字段/语义/三条成立性）",
          ok14, "missing=%s" % miss)

    # ---- A-15 §2.3 对照表覆盖 10 条 ----
    miss = [k for k in CMP_ROWS if k not in d]
    ok15 = (not miss) and ("⛔ **本件不排名、不推荐、不选边。**" in d)
    C.chk("A-15.comparison-table", "§2.3 对照表覆盖 owner 指定条目 + 不排名声明",
          ok15, "missing=%s" % miss)

    # ---- A-16 C2_OWNER_SELECTION = PENDING（★ 改值即红）----
    body, got = stop_fields(d, STOP_MARK)
    ok16 = (got.get("C2_OWNER_SELECTION") == {"PENDING"}) \
           and ("C2_OWNER_SELECTION = PENDING" in n) \
           and (all(v == "PENDING" for v in C2_SEL_LINE.findall(d))) \
           and ("不得由本件填值" in d)
    C.chk("A-16.c2-owner-selection-pending", "C2_OWNER_SELECTION = PENDING（显式未决 · 不得填值）", ok16)

    # ---- A-17 P1..P5 Owner Decision 表逐行（★ 删任一行即红）----
    miss = [k for k, v in P_ROWS.items() if v not in d]
    C.chk("A-17.p-decision-table", "P1..P5 Owner Decision 表（ID/证据结论/需决定什么/影响）",
          not miss, "missing=%s" % miss)

    # ---- A-18 三条强制注意 ----
    miss = [k for k in P_NOTES if k not in d]
    C.chk("A-18.p-notes", "三条强制注意逐字（补录≠授权 / PARITY_DEBT≠当前授权 / 8fc3ba66≠master HEAD）",
          not miss, "missing=%s" % miss)

    # ---- A-19 决定后影响细化（解锁 / 不解锁）----
    ok19 = ("决定后立即解锁什么" in d) and ("决定后 ⛔ 仍不解锁什么" in d) \
           and ("AUTHORIZATION = NOT_APPLICABLE (PRE_GOVERNANCE)" in d)
    C.chk("A-19.p-decision-impact", "各 P 项决定后影响细化（解锁 / ⛔ 仍不解锁）", ok19)

    # ---- A-20 dependency graph 逐字复现（★ 顺序与节点集合）----
    chain = extract_chain(d)
    ok20 = (chain == CHAIN)
    C.chk("A-20.dependency-graph", "implementation dependency graph 逐字复现（节点 + 顺序）",
          ok20, "got=%s" % chain)

    # ---- A-21 Critical Path 未改 ----
    ok21 = ("CRITICAL_PATH_CHANGED = NO" in n) and (got.get("CRITICAL_PATH_CHANGED") == {"NO"}) \
           and ("⛔ 未增删节点、⛔ 未调整次序、⛔ 未合并/拆分" in d)
    C.chk("A-21.critical-path-unchanged", "声明 Critical Path 未改（⛔ 未增删/未调序）", ok21)

    # ---- A-22 跨件前置 P5 → A+B ----
    ok22 = (CROSS_PRECOND in d) \
           and ("P5 → A+B" in d) \
           and (got.get("CROSS_COMPONENT_PRECONDITION") == {"P5_TO_A_PLUS_B"}) \
           and ("不构成对上面 Critical Path 的修改" in d)
    C.chk("A-22.cross-precondition", "跨件前置 P5 → A+B 显式标出（⛔ 不改 Critical Path）", ok22)

    # ---- A-23 节点释义表 ----
    m = [k for k in ("| `C3-γ` |", "| `C-1` |", "| `X-2 PRECONDITION` |", "| `G17` |", "| `E-5` |")
         if k not in d]
    ok23 = (not m) and ("G17_GEN1_HAS_EFFECT_ON_DECISION" in d)
    C.chk("A-23.node-legend", "节点释义表齐备（含 G17 最终验收条件）", ok23, "missing=%s" % m)

    # ---- A-24 NS 提示（NS-4 / NS-8）----
    ok24 = ("NS-4" in d) and ("NS-8" in d) and ("**授权风险等级**" in d) \
           and ("不同义" in d)
    C.chk("A-24.namespace-hints", "命名空间提示（NS-4 沿用 + NS-8 新增 R2 双义）", ok24)

    # ---- A-25 仍未授权事项 ----
    m = [k for k in UNAUTH_ANCHORS if k not in d]
    ok25 = (not m) and ("⛔ 未授权" in d) and ("`PENDING`" in d)
    C.chk("A-25.still-unauthorized", "列出当前仍未授权事项", ok25, "missing=%s" % m)

    # ---- A-26 下一步所需 Owner authorization ----
    ok26 = ("下一步所需 Owner authorization" in d) and (AUTH_PHRASE in d) \
           and ("**显式取** `A+B`" in d) and ("分别点名" in d)
    C.chk("A-26.next-authorization", "明确下一步所需 Owner authorization（最小放行集）", ok26)

    # ---- A-27 硬边界八项 ----
    ok27 = all(("`%s`" % k) in d for k in
               ("PRODUCTION_WRITE", "DB_WRITE", "DEPLOY", "AUTHORITY_CHANGE",
                "CANARY", "EVIDENCE_EXECUTION", "GE04", "IMPLEMENTATION_AUTHORIZED")) \
           and ("### §5.1 本轮硬边界" in d)
    C.chk("A-27.hard-boundaries", "§5.1 硬边界八项逐项声明", ok27)

    # ---- A-28 禁令清单逐字 ----
    ok28 = ("修改生产代码" in d) and ("修改 `FROZEN_PARAM_KEYS`" in d) \
           and ("修改 `immutable_set` / lock" in d) and ("修改 `v6_negative_scan.py`" in d) \
           and ("Evidence Execution" in d) and ("GE-04" in d)
    C.chk("A-28.prohibitions", "禁令清单逐字（含 ⛔ 不得修改 v6_negative_scan.py）", ok28)

    # ---- A-29 STOP 代码块（★ 改值即红）----
    bad = []
    for f, v in STOP_EXPECT.items():
        if f not in got:
            bad.append(f + ":MISSING")
        elif got[f] != {v}:
            bad.append("%s:%s" % (f, sorted(got[f])))
    C.chk("A-29.stop-block", "§5 STOP 代码块字段齐全且非放行", bool(body) and not bad, "bad=%s" % bad)

    # ---- A-30 无越界肯定式 ----
    hit = OVERCLAIM.findall(d)
    C.chk("A-30.no-overclaim", "不含越界肯定式（含 C2_OWNER_SELECTION 非 PENDING）",
          not hit, "hits=%s" % hit)

    # ---- A-31 无部署 token ----
    hits = [t for t in _deploy_tokens() if t in d]
    C.chk("A-31.no-deploy-token", "交付件不含部署/变更命令 token", not hits, "hits=%s" % hits)

    # ---- A-32 显式『不构成实施授权』+ 放行口令 ----
    ok32a = ("不构成实施授权" in d) and ("不代表已获授权" in d)
    ok32b = bool(re.search(r"AGENT[ _]IMPLEMENTATION[ _]AUTHORIZED", d))
    forbid = re.findall(r"已完成授权|已获授权实现|AUTHORIZED\s*=\s*YES", d)
    C.chk("A-32.no-implicit-authorization",
          "显式声明『不构成实施授权』+ 引用放行口令 + ⛔ 无『已授权』肯定式",
          ok32a and ok32b and not forbid,
          "a=%s b=%s forbid=%s" % (ok32a, ok32b, forbid))

    # ---- A-33 零写声明 ----
    ok33 = ("PRODUCTION_WRITE" in got) and got["PRODUCTION_WRITE"] == {"0"} \
           and got["DB_WRITE"] == {"0"}
    C.chk("A-33.zero-write-declared", "声明零写（PRODUCTION_WRITE / DB_WRITE = 0）", ok33)

    # ---- A-34 裁定 ≠ 执行 ----
    ok34 = all(got.get(k) == {"NO"} for k in
               ("P1_EXECUTED", "P2_EXECUTED", "P3_EXECUTED", "P4_EXECUTED", "P5_EXECUTED"))
    C.chk("A-34.ruling-not-executed", "P1..P5 与 R2 均『裁定 ≠ 执行』（EXECUTED 全 NO）", ok34)

    # ---- A-35 上游引用一致 ----
    ok35 = ("GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md" in d) \
           and ("GEN1_DEPLOYMENT_GOVERNANCE_DECISION_20261003.md" in d) \
           and ("6d7ef89" in d)
    C.chk("A-35.upstream-refs", "上游引用一致（两件 + carrier commit 6d7ef89）", ok35)

    return C


# ---------------- 零写自证 ----------------

ZERO_DIRS = ["out", "fixtures"]


def _snapshot():
    snap = {}
    for sub in ZERO_DIRS:
        d = os.path.join(HERE, sub)
        if not os.path.isdir(d):
            continue
        for root, _, fs in os.walk(d):
            for f in fs:
                p = os.path.join(root, f)
                try:
                    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
                except Exception:
                    h = "ERR"
                snap[os.path.relpath(p, HERE).replace(os.sep, "/")] = h
    return snap


def zerowrite():
    before = _snapshot()
    try:
        run_checks(load())
    except Exception as exc:                       # noqa: BLE001
        print("FAIL-CLOSED: %s" % exc)
        return 2
    after = _snapshot()
    changed = sorted(k for k in set(before) | set(after)
                     if before.get(k) != after.get(k))
    print("ZERO_WRITE before=%d after=%d changed_or_missing=%s"
          % (len(before), len(after), changed if changed else "NONE"))
    print("PRODUCTION_WRITE = 0   DB_WRITE = 0")
    return 0 if not changed else 1


# ---------------- 回归（显式白名单） ----------------

def run_regression():
    import subprocess
    ok = 0
    bad = []
    for name in REGRESSION:
        p = os.path.join(HERE, name)
        if not os.path.exists(p):
            bad.append((name, "MISSING"))
            print("FAIL %-52s MISSING" % name)
            continue
        cmd = [sys.executable, p]
        r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
        if r.returncode == 0:
            ok += 1
            print("PASS %-52s rc=0" % name)
        else:
            bad.append((name, "rc=%d" % r.returncode))
            print("FAIL %-52s rc=%d" % (name, r.returncode))
    for name, why in REGRESSION_EXCLUDED.items():
        print("SKIP %-52s %s" % (name, why))
    print("-" * 72)
    print("REGRESSION PASS = %d / %d   FAIL = %d   EXCLUDED = %d"
          % (ok, len(REGRESSION), len(bad), len(REGRESSION_EXCLUDED)))
    return 0 if not bad else 1


# ---------------- 红证 ----------------

def redproof(case):
    d = load()
    base = run_checks(d)
    base_fail = [r["id"] for r in base.rows if not r["ok"]]

    def fails_after(mut, expect_id):
        C = run_checks(mut)
        bad = [r["id"] for r in C.rows if not r["ok"]]
        return (expect_id in bad), bad

    def report(tag, ok, bad):
        print("[%s] %s / fail=%s" % (tag, "PASS" if ok else "FAIL", bad))
        return 0 if ok else 1

    if case == "RP-1":      # 删 R2 最小实施范围小节 ⇒ A-04/A-06 红
        mut = d.replace(H_R2_SCOPE, "### §1.2 （已删）")
        ok, bad = fails_after(mut, "A-04.c3-six-questions")
        return report("RP-1", ok and mut != d, bad)
    if case == "RP-2":      # 删「不得修改」小节 ⇒ A-04/A-08 红
        mut = d.replace(H_NOTOUCH, "### §1.4 （已删）")
        ok, bad = fails_after(mut, "A-08.no-touch-list")
        return report("RP-2", ok and mut != d, bad)
    if case == "RP-3":      # 删 A+B 小节 ⇒ A-12/A-13 红
        mut = d.replace(H_AB, "### §2.1 （已删）")
        ok, bad = fails_after(mut, "A-12.c2-subsections")
        return report("RP-3", ok and mut != d, bad)
    if case == "RP-4":      # 删 A+C 小节 ⇒ A-12/A-14 红
        mut = d.replace(H_AC, "### §2.2 （已删）")
        ok, bad = fails_after(mut, "A-14.a-plus-c-items")
        return report("RP-4", ok and mut != d, bad)
    if case == "RP-5":      # C2_OWNER_SELECTION 被填值 ⇒ A-16 红
        mut = re.sub(r"C2_OWNER_SELECTION(\s*)= PENDING",
                     r"C2_OWNER_SELECTION\1= A+B", d)
        ok, bad = fails_after(mut, "A-16.c2-owner-selection-pending")
        return report("RP-5", ok and mut != d, bad)
    if case == "RP-6":      # 删 P4 行 ⇒ A-17 红
        mut = d.replace(P_ROWS["P4"], "")
        ok, bad = fails_after(mut, "A-17.p-decision-table")
        return report("RP-6", ok and mut != d, bad)
    if case == "RP-7":      # 删 P5 行 ⇒ A-17 红
        mut = d.replace(P_ROWS["P5"], "")
        ok, bad = fails_after(mut, "A-17.p-decision-table")
        return report("RP-7", ok and mut != d, bad)
    if case == "RP-8":      # 删链节点 X-2 PRECONDITION ⇒ A-20 红
        mut = re.sub(r"\n\s*X-2 PRECONDITION\n\s*↓\n", "\n", d, count=1)
        ok, bad = fails_after(mut, "A-20.dependency-graph")
        return report("RP-8", ok and mut != d, bad)
    if case == "RP-9":      # 删跨件前置 ⇒ A-22 红
        mut = d.replace(CROSS_PRECOND, "（已删）")
        ok, bad = fails_after(mut, "A-22.cross-precondition")
        return report("RP-9", ok and mut != d, bad)
    if case == "RP-10":     # IMPLEMENTATION_AUTHORIZED = YES ⇒ A-29 红
        mut = re.sub(r"IMPLEMENTATION_AUTHORIZED(\s*)= NO",
                     r"IMPLEMENTATION_AUTHORIZED\1= YES", d)
        ok, bad = fails_after(mut, "A-29.stop-block")
        return report("RP-10", ok and mut != d, bad)
    if case == "RP-11":     # 注入越界肯定式（★ 运行时拼装）⇒ A-30 红
        corpus = " ".join(("Deploy", "=", "YES"))
        mut = d.replace("## §5 边界与 STOP", corpus + "\n\n## §5 边界与 STOP")
        ok, bad = fails_after(mut, "A-30.no-overclaim")
        return report("RP-11", ok and mut != d, bad)
    if case == "RP-12":     # 注入部署 token（★ 运行时拼装）⇒ A-31 红
        corpus = " ".join(("git", "push"))
        mut = d.replace("## §5 边界与 STOP", corpus + "\n\n## §5 边界与 STOP")
        ok, bad = fails_after(mut, "A-31.no-deploy-token")
        return report("RP-12", ok and mut != d, bad)
    if case == "RP-13":     # 删「补录 ≠ 重新授权」⇒ A-18 红
        mut = d.replace(P_NOTES[0], "（已删）")
        ok, bad = fails_after(mut, "A-18.p-notes")
        return report("RP-13", ok and mut != d, bad)
    if case == "RP-14":     # 删 LC-R2-1 歧义 ⇒ A-07 红
        mut = d.replace("新发现歧义 `LC-R2-1`", "（已删）")
        ok, bad = fails_after(mut, "A-07.contract-docs-and-lock-ambiguity")
        return report("RP-14", ok and mut != d, bad)
    if case == "RP-15":     # 反证自证：未变异必须全绿
        print("[RP-15] baseline PASS=%d FAIL=%d" % (len(base.rows) - len(base_fail),
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
    if "--regression" in argv:
        return run_regression()
    if "--zerowrite" in argv:
        return zerowrite()
    try:
        C = run_checks(load())
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
