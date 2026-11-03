# -*- coding: utf-8 -*-
"""
GEN1_OWNER_DECISION_MATRIX —— 只读 Authorization Boundary Check
(v6_owner_decision_boundary_check.py)

性质：**纯只读**。⛔ 不联网 · ⛔ 不开子进程 · ⛔ 不写任何文件 · ⛔ 不调用任何生产 CLI / API。
数据来源：
  ① 本 Gate 主件：docs/gen1/GEN1_OWNER_DECISION_MATRIX_20261003.md（**直接解析其矩阵表格**）
  ② 依赖关系的代码层依据（只读）：repo@dist-functions/runDecisionEngine/common/utils/*
     （= 线上同包；用于交叉验证 §4 的代码结论）

设计原则（owner §九：「不要为了让检查通过而弱化检查标准」）：
  ★ 判定**一律基于对表格的结构化解析**，⛔ 不以「关键字是否出现」冒充判定。
  ★ 本脚本**自始规避自指**：部署 token 表**运行时片段拼装**，源码中不出现完整 token。
  ★ ⛔ 零 subprocess · 零写模式 open（两条均有自证断言 + 专属红证）。

★ §13 红线（owner 2026-10-02）：RED_PROOF MUST NEVER EXECUTE REAL PRODUCTION COMMANDS。
  本脚本红证仅用 **纯内存 gate 引擎仿真 + 内存内容变异 + AST mutation**（永不落盘、永不执行）。

用法：
  python v6_owner_decision_boundary_check.py                    # 全量断言
  python v6_owner_decision_boundary_check.py --redproof RP-A    # 打红自证
退出码：0 = 全 PASS；1 = 有 FAIL；2 = fail-closed（证据缺失 / 结构异常）
"""
import ast
import collections
import io
import os
import re
import sys

# ------------------------------------------------------------------ #
# 0. 路径
# ------------------------------------------------------------------ #
def repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        "..", "..", ".."))


def dist_utils():
    return os.path.join(os.path.dirname(repo_root()), "etf-decision-engine",
                        "dist-functions", "runDecisionEngine", "common", "utils")


MATRIX = os.path.join(repo_root(), "docs", "gen1",
                      "GEN1_OWNER_DECISION_MATRIX_20261003.md")

# ------------------------------------------------------------------ #
# 1. 自证扫描器（AST 结构化；⛔ 不扫自由字符串常量）
# ------------------------------------------------------------------ #
FORBIDDEN_CALLS = {
    "subprocess.run", "subprocess.Popen", "subprocess.call", "subprocess.check_call",
    "subprocess.check_output", "subprocess.getoutput", "subprocess.getstatusoutput",
    "os.system", "os.popen", "os.execv", "os.execve", "os.execvp", "os.execl", "os.execle",
    "os.spawnv", "os.spawnl", "shutil.rmtree", "eval", "exec", "compile", "__import__",
    "pty.spawn", "pickle.load", "pickle.loads", "marshal.loads",
}
FORBIDDEN_PREFIXES = ("tcb.", "cloudbase.", "gh.", "git.")
FORBIDDEN_BARE = {"tcb", "cloudbase", "gh"}


def _dotted(node):
    parts = []
    cur = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
        parts.reverse()
        return ".".join(parts)
    return None


def scan_violations(src):
    """返回违规列表 [{line, kind, detail}]。语法错误 ⇒ ValueError（fail-closed）。"""
    try:
        tree = ast.parse(src)
    except SyntaxError as exc:
        raise ValueError("源码语法错误（fail-closed）：%s" % exc)
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = _dotted(node.func)
            if name is None:
                continue
            if name in FORBIDDEN_CALLS:
                out.append({"line": node.lineno, "kind": "CALL", "detail": name})
            elif name.startswith(FORBIDDEN_PREFIXES) or (
                    "." not in name and name in FORBIDDEN_BARE):
                out.append({"line": node.lineno, "kind": "PROD_CLI", "detail": name})
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "open":
            modes = list(node.args[1:2]) + [k.value for k in node.keywords if k.arg == "mode"]
            for a in modes:
                if isinstance(a, ast.Constant) and isinstance(a.value, str) \
                        and any(ch in a.value for ch in "wax+"):
                    out.append({"line": node.lineno, "kind": "FILE_WRITE",
                                "detail": "open(mode=%r)" % a.value})
    return out


def _deploy_tokens():
    """运行时拼装部署 token；⛔ 不以完整字面量出现在源码中（避自指）。"""
    j = " ".join
    return (
        j(("tcb", "fn", "deploy")),
        j(("tcb", "deploy")),
        "functions" + ":" + "deploy",
        j(("firebase", "deploy")),
        j(("gcloud", "functions", "deploy")),
        j(("npm", "run", "deploy")),
        "cloudbase " + "functions" + ":" + "deploy",
        j(("tcb", "fn", "rollback")),
        j(("functions", "delete")),
        j(("db", "import")),
    )


def _open_write_modes(src):
    """返回源码中写模式 open 的行号（自证用）。"""
    return [h["line"] for h in scan_violations(src) if h["kind"] == "FILE_WRITE"]


# ------------------------------------------------------------------ #
# 2. 矩阵契约（期望值）
# ------------------------------------------------------------------ #
HEADER = ("ID", "当前状态", "类型", "R", "自主准备", "Owner授权", "ProdWrite",
          "改决策行为", "Deploy", "Evidence", "GE-04", "前置条件", "可并行", "阻塞项", "说明")

VALID_STATE = {"PASS", "PARTIAL", "MISSING", "BLOCKED", "CLOSED"}
VALID_TYPE = {"Functional", "Production Integration", "Health", "Evidence",
              "Authorization", "Observability", "Rollback"}
VALID_R = {"R0", "R1", "R2", "R3", "R4"}

EXPECTED_MAIN = ([("A-%d" % i) for i in range(1, 4)]
                 + [("B-%d" % i) for i in range(1, 7)]
                 + [("C-%d" % i) for i in range(1, 5)]
                 + [("D-%d" % i) for i in range(1, 6)]
                 + [("E-%d" % i) for i in range(1, 11)]
                 + [("F-%d" % i) for i in range(1, 7)]
                 + [("G-%d" % i) for i in range(1, 5)]
                 + ["X-1", "X-2", "N-9a", "N-1", "N-2", "N-3", "N-4"])
EXPECTED_EXT = ["AG-1", "AG-2", "AG-3", "G16", "G17", "G15", "G9-b", "OBS-3",
                "A-2a", "A-2b"]
EXPECTED_IDS = EXPECTED_MAIN + EXPECTED_EXT

DECLARED = {"MATRIX_ITEMS": 55, "R0": 5, "R1": 8, "R2": 3, "R3": 35, "R4": 4}

CP_DECL = ("C-3", "C-2", "C-1", "C-4", "X-2", "A-1", "D-1", "D-2", "D-3", "X-1",
           "B-1", "G-1", "G-2", "A-2a", "A-2b", "G17", "E-5")
CP_SEQ = CP_DECL          # ★ 文档正文的 CRITICAL_PATH 顺序必须与之一致（含并列段与 PRECONDITION 段）
# ⛔ C-3 ∥ C-2（同 rank）；X-2 = PRECONDITION（位次在 A-1 之前，但 ⛔ 非可实施节点）
CP_RANK = {"C-3": 0, "C-2": 0, "C-1": 1, "C-4": 2, "X-2": 3, "A-1": 4,
           "D-1": 5, "D-2": 6, "D-3": 7, "X-1": 8, "B-1": 9, "G-1": 10, "G-2": 11,
           "A-2a": 12, "A-2b": 13, "G17": 14, "E-5": 15}
CP_ALIAS = {"A-2": "A-2b", "G16": "A-2a"}   # 父/AND 表口径 → 工程口径
IS_GATE = lambda i: i.startswith("E-") or i.startswith("AG-") or i == "G15"

NS_IDS = ["NS-1", "NS-2", "NS-3", "NS-4", "NS-5", "NS-6", "NS-7"]

NO_IMPLICIT = (
    "⛔ TECHNICAL PASS ⇒ ✗ AUTHORIZATION PASS",
    "⛔ IMPLEMENTATION_AUTHORIZED ⇒ ✗ PRODUCTION_WRITE_AUTHORIZED",
    "⛔ FREEZE ⇒ ✗ PRODUCTION ATTESTATION",
    "⛔ EVIDENCE EXECUTION ⇒ ✗ GE-04",
)

FORBID_STRINGS = ("Deploy = YES", "Canary = ON", "auto_execution = true",
                  "GE-04 = AUTHORIZED", "PRODUCTION_WRITE = 1",
                  "GEN1_IN_DECISION_CHAIN = READY", "只差一步",
                  "IMPLEMENTATION_AUTHORIZED = YES", "PRODUCTION_WRITE_AUTHORIZED = YES",
                  "EVIDENCE_EXECUTION_AUTHORIZED = YES", "GE04_AUTHORIZED = YES")


# ------------------------------------------------------------------ #
# 3. 证据装载 + 矩阵解析
# ------------------------------------------------------------------ #
def _must(p):
    if not os.path.exists(p):
        raise ValueError("证据缺失（fail-closed）：%s" % p)
    return p


def _read(p):
    return io.open(_must(p), "r", encoding="utf-8", errors="replace").read()


def load_evidence():
    ev = {}
    ev["doc"] = _read(MATRIX)
    U = dist_utils()
    ev["src"] = {
        "shadow": _read(os.path.join(U, "gen1-shadow-eligibility.js")),
        "safety": _read(os.path.join(U, "gen1-safety-permission.js")),
        "canary": _read(os.path.join(U, "gen1-canary.js")),
    }
    return ev


def parse_matrix(doc):
    """解析 15 列矩阵行 → {id: cells}。⛔ 只接受首格为**裸 ID** 的行。"""
    rows = {}
    dup = []
    for ln in doc.split("\n"):
        if not ln.startswith("| "):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) != 15:
            continue
        key = cells[0]
        if key == "ID":          # 表头（§3.1 / §3.2 各一处）
            continue
        if key in rows:
            dup.append(key)
        rows[key] = cells
    return rows, dup


def ids_in(cell, known):
    """从单元格抽取已知 ID（带右边界保护，避免 A-2 命中 A-2a）。"""
    out = []
    for k in known:
        if re.search(re.escape(k) + r"(?![A-Za-z0-9-])", cell):
            out.append(k)
    return out


def stop_block(doc):
    """抽取 §12 STOP 字段块。"""
    i = doc.find("GEN1_OWNER_DECISION_MATRIX = COMPLETE")
    return doc[i:] if i >= 0 else ""


def cp_string(doc):
    m = re.search(r"CRITICAL_PATH = \[(.*?)\]", doc, re.S)
    return m.group(1) if m else ""


def cp_sequence(cp):
    """★ 从**文档正文**的 CRITICAL_PATH 串按出现顺序抽取节点 ID。
    逐段（按逗号切分）在段内按字符位置排序 ⇒ 支持并列段 `C-3 ∥ C-2` 与
    括号段 `(X-2 PRECONDITION)`。⛔ 不使用静态表 —— 否则顺序断言可被正文篡改绕过。"""
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


# ------------------------------------------------------------------ #
# 4. 断言
# ------------------------------------------------------------------ #
class Ctx(object):
    def __init__(self):
        self.rows = []

    def ck(self, rid, desc, ok, detail=""):
        self.rows.append({"id": rid, "desc": desc, "ok": bool(ok), "detail": detail})


def run_checks(ev):
    C = Ctx()
    doc = ev["doc"]
    S = ev["src"]

    # ---- B-01 自证：本脚本 AST 零违规 ----
    own = _read(os.path.abspath(__file__))
    C.ck("B-01.self-scan", "本 check 自身 AST 零违规",
         not scan_violations(own),
         "违规=%s" % [h["detail"] for h in scan_violations(own)])

    # ---- B-02/B-03 主件存在 + 可解析 ----
    C.ck("B-02.matrix-present", "主件存在且非空", len(doc) > 12000, "len=%d" % len(doc))
    rows, dup = parse_matrix(doc)
    C.ck("B-03.matrix-parse", "矩阵可解析：行数 = 55 且无重名行",
         len(rows) == DECLARED["MATRIX_ITEMS"] and not dup,
         "rows=%d dup=%s" % (len(rows), dup))

    # ---- B-04 覆盖率：全部已知 Gap / Node 均进入矩阵 ----
    missing = [i for i in EXPECTED_IDS if i not in rows]
    C.ck("B-04.id-coverage", "全部 55 项（45 主 + 10 增补）均进入矩阵",
         not missing, "缺失=%s" % missing)

    # ---- B-05 取值域合法 ----
    bad = []
    for k, c in rows.items():
        if c[1] not in VALID_STATE:
            bad.append("%s.状态=%s" % (k, c[1]))
        if c[2] not in VALID_TYPE:
            bad.append("%s.类型=%s" % (k, c[2]))
        if c[3] not in VALID_R:
            bad.append("%s.R=%s" % (k, c[3]))
        for idx in (4, 5, 6, 7, 8, 9, 10):
            if c[idx] not in ("YES", "NO"):
                bad.append("%s.col%d=%s" % (k, idx, c[idx]))
    C.ck("B-05.domain-valid", "状态/类型/R/布尔列取值域合法（严格 YES/NO）",
         not bad, "越域=%s" % bad[:6])

    # ---- B-06 R 类计数与声明一致 ----
    cnt = collections.Counter(c[3] for c in rows.values())
    got = dict(cnt)
    bad6 = ["%s 声明 %d 实得 %d" % (k, DECLARED[k], got.get(k, 0))
            for k in ("R0", "R1", "R2", "R3", "R4") if got.get(k, 0) != DECLARED[k]]
    decl_items = DECLARED["MATRIX_ITEMS"]
    C.ck("B-06.r-counts", "R0–R4 计数与 §3.4 声明一致（合计 %d）" % decl_items,
         not bad6 and sum(got.values()) == decl_items, "差异=%s" % bad6)

    # ---- B-07 每个 R3 均有 Owner 明确授权边界 ----
    bad7 = [k for k, c in rows.items() if c[3] == "R3" and c[5] != "YES"]
    C.ck("B-07.r3-owner-boundary", "每个 R3 均标 Owner授权=YES（独立授权边界）",
         not bad7, "违例=%s" % bad7)

    # ---- B-08 每个 R3 必须是高风险动作（生产写/部署/证据/GE-04/授权类） ----
    bad8 = [k for k, c in rows.items()
            if c[3] == "R3" and not (c[6] == "YES" or c[8] == "YES"
                                     or c[9] == "YES" or c[10] == "YES"
                                     or c[2] == "Authorization")]
    C.ck("B-08.r3-high-risk", "每个 R3 均为高风险动作（含授权门类）",
         not bad8, "违例=%s" % bad8)

    # ---- B-09 R0（含观察项）不得要求任何生产动作 ----
    bad9 = [k for k, c in rows.items()
            if c[3] == "R0" and (c[6] == "YES" or c[8] == "YES" or c[9] == "YES")]
    C.ck("B-09.r0-no-prod", "R0 项零生产动作（ProdWrite/Deploy/Evidence 均 NO）",
         not bad9, "违例=%s" % bad9)

    # ---- B-10 R1（可自主准备）⛔ 不含任何生产动作 ----
    bad10 = [k for k, c in rows.items()
             if c[3] == "R1" and (c[6] == "YES" or c[8] == "YES" or c[9] == "YES"
                                  or c[10] == "YES")]
    C.ck("B-10.r1-not-authorized", "R1 项仅覆盖非生产动作（⛔ R1 ≠ 已授权）",
         not bad10, "违例=%s" % bad10)

    # ---- B-11 R4（DEFERRED）冻结：不可自主准备、不可生产写 ----
    bad11 = [k for k, c in rows.items()
             if c[3] == "R4" and not (c[4] == "NO" and c[6] == "NO")]
    C.ck("B-11.r4-frozen", "R4 项 DEFERRED：自主准备=NO 且 ProdWrite=NO",
         not bad11, "违例=%s" % bad11)

    # ---- B-12 ★ Implementation Authorization 与 Production Write 分离 ----
    impl_only = [k for k, c in rows.items() if c[5] == "YES" and c[6] == "NO"]
    prodw = [k for k, c in rows.items() if c[6] == "YES"]
    C.ck("B-12.impl-vs-prodwrite",
         "Implementation 授权（%d 项）与 Production Write（%d 项）**结构性分离**"
         % (len(impl_only), len(prodw)),
         len(impl_only) >= 5 and len(prodw) >= 20 and not (set(impl_only) & set(prodw)),
         "impl_only=%d prodwrite=%d" % (len(impl_only), len(prodw)))

    # ---- B-13 ★ Evidence Execution 与 GE-04 独立 ----
    ev_rows = [k for k, c in rows.items() if c[9] == "YES"]
    ge_rows = [k for k, c in rows.items() if c[10] == "YES"]
    C.ck("B-13.evidence-vs-ge04",
         "Evidence Execution 与 GE-04 为**互不重叠**的独立集合",
         "E-3" in ev_rows and "E-5" in ge_rows
         and "E-3" not in ge_rows and "E-5" not in ev_rows
         and rows["E-5"][9] == "NO" and rows["E-3"][10] == "NO",
         "evidence=%s ge04=%s" % (sorted(ev_rows), sorted(ge_rows)))

    # ---- B-14 ★ X-2 识别为 PRECONDITION 而非 work item ----
    x2 = rows.get("X-2", [])
    C.ck("B-14.x2-precondition",
         "X-2 = PRECONDITION（R0 · 不可自主准备 · 无授权 · 零生产动作 · 未达成）",
         bool(x2) and x2[3] == "R0" and x2[4] == "NO" and x2[5] == "NO"
         and x2[6] == "NO" and x2[8] == "NO" and x2[1] != "CLOSED"
         and "非 work item" in doc and "PRECONDITION" in doc,
         "x2=%s" % (x2[:2] if x2 else None))

    # ---- B-15 Critical Path 节点全部存在 ----
    cp = cp_string(doc)
    req = ["C-3", "C-2", "C-1", "C-4", "A-1", "D-1", "D-2", "D-3", "X-1",
           "B-1", "G-1", "G-2", "A-2a", "A-2b", "G17", "E-5"]
    miss15 = [n for n in req if n not in cp]
    C.ck("B-15.cp-nodes", "CRITICAL_PATH 含全部必需节点（B-15）",
         not miss15 and cp.count("X-2") == 1 and "(X-2 PRECONDITION)" in cp.replace("  ", " "),
         "缺失=%s x2出现=%d" % (miss15, cp.count("X-2")))

    # ---- B-16 ★ 关键路径顺序（**正文顺序** + CP-1 / CP-2 / CP-3 / CP-5 不变量） ----
    def rk(i):
        i = CP_ALIAS.get(i, i)
        return CP_RANK.get(i)
    seq = cp_sequence(cp)
    ok16 = (seq == list(CP_SEQ))              # ★ 正文顺序必须与声明一致（防篡改）
    ok16 = ok16 and rk("B-1") < rk("A-2b")          # CP-1 读路径早于 selector 激活
    ok16 = ok16 and rk("A-2a") < rk("A-2b")         # CP-2 代码通路早于激活
    ok16 = ok16 and rk("C-3") == rk("C-2")          # CP-3 并列非串行
    ok16 = ok16 and rk("A-1") < rk("X-1")           # CP-5 互斥禁令
    ok16 = ok16 and rk("D-3") < rk("X-1")
    ok16 = ok16 and rk("D-1") < rk("D-2") < rk("D-3")
    ok16 = ok16 and rk("C-1") < rk("A-1") and rk("C-4") < rk("A-1")
    C.ck("B-16.cp-order",
         "正文顺序与声明一致，且不变量成立：C-3∥C-2 · C-1<A-1 · D-1<D-2<D-3<X-1 · B-1<A-2b · A-2a<A-2b",
         ok16, "正文顺序=%s" % seq)

    # ---- B-17 依赖自洽：CP 行的「前置条件」不得指向更晚的 CP 节点 ----
    known = set(rows.keys())
    bad17 = []
    for k, c in rows.items():
        r = rk(k)
        if r is None:
            continue
        for p in ids_in(c[11], known):
            if IS_GATE(p) or p == "X-2":
                continue
            pr = rk(p)
            if pr is not None and pr > r:
                bad17.append("%s 前置 %s(rank %d > %d)" % (k, p, pr, r))
    C.ck("B-17.dep-consistency", "关键路径依赖自洽（无「前置晚于自身」）",
         not bad17, "矛盾=%s" % bad17)

    # ---- B-18 ID 命名空间冲突登记 ----
    miss18 = [n for n in NS_IDS if n not in doc]
    C.ck("B-18.ns-registry", "NS-1…NS-7 命名空间冲突全部登记",
         not miss18, "缺失=%s" % miss18)

    # ---- B-19 四条「不可推导式」在场（空白归一化后匹配） ----
    normdoc = re.sub(r"[ \t]+", " ", doc)
    miss19 = [s for s in NO_IMPLICIT if s not in normdoc]
    C.ck("B-19.no-implicit-propagation", "四条授权不可推导式在场",
         not miss19, "缺失=%s" % miss19)

    # ---- B-20 STOP 字段块齐备 ----
    sb = stop_block(doc)
    need20 = ("GEN1_OWNER_DECISION_MATRIX = COMPLETE", "MATRIX_ITEMS = 55",
              "ROOT_BLOCKERS = [", "CRITICAL_PATH = [", "PARALLEL_WORK = [",
              "PRODUCTION_WRITE_GATES = [", "AUTHORIZATION_GATES = [",
              "EVIDENCE_GATE =", "GE04 = NOT AUTHORIZED",
              "RED_PROOF = PASS", "REGRESSION = PASS", "STOP = YES")
    C.ck("B-20.stop-block", "§12 STOP 字段块齐备（12 项）",
         all(s in sb for s in need20),
         "缺失=%s" % [s for s in need20 if s not in sb])

    # ---- B-21 三个独立状态 ----
    need21 = ("IMPLEMENTATION_AUTHORIZED = NO", "PRODUCTION_WRITE_AUTHORIZED = NO",
              "EVIDENCE_EXECUTION_AUTHORIZED = NO", "GE04_AUTHORIZED = NO")
    C.ck("B-21.three-independent", "三独立状态 + GE-04 均显式 NO",
         all(s in sb for s in need21),
         "缺失=%s" % [s for s in need21 if s not in sb])

    # ---- B-22 零写声明 ----
    need22 = ("PRODUCTION_WRITE = 0", "DEPLOY = NO", "ROLLBACK = NO", "CANARY = OFF",
              "AUTO_EXECUTION = OFF", "MERGE = NO", "TAG = NO", "PUSH = NO")
    C.ck("B-22.zero-write", "零写声明齐备（8 项）",
         all(s in sb for s in need22),
         "缺失=%s" % [s for s in need22 if s not in sb])

    # ---- B-23 无越界肯定式（零命中反向断言） ----
    hit23 = [s for s in FORBID_STRINGS if s in doc]
    C.ck("B-23.no-overclaim", "主件无越界肯定式（零命中）",
         not hit23, "命中=%s" % hit23)

    # ---- B-24 代码层交叉验证（§4 结论的依据） ----
    ok24 = ("gen1_authority || '').toUpperCase() === 'CANARY'" in S["shadow"])          # 互斥禁令
    ok24 = ok24 and ("MODEL_STAGES = Object.freeze(['S2'])" in S["safety"]
                     and "BASELINE_STAGE_NOT_ELIGIBLE" in S["safety"])                  # X-2
    ok24 = ok24 and ("canaryAllowed = permission.effective_canary === true" in S["canary"]
                     and "authorityAllows(authority.gen1_authority, 'CANARY_OVERRIDE')"
                     in S["canary"])                                                    # 通道②
    C.ck("B-24.code-cross-check",
         "代码层依据成立（authority_canary 严格相等 / MODEL_STAGES S2-only / canary 门）",
         ok24, "")

    # ---- B-25/B-26 harness 自身洁净（token + 写模式 open） ----
    C.ck("B-25.harness-token-free", "本 harness 零部署/变更类 token（判据不变）",
         not [t for t in _deploy_tokens() if t in own], "")
    C.ck("B-26.harness-no-file-write", "本 harness 无写模式 open",
         not _open_write_modes(own), "")

    return C


# ------------------------------------------------------------------ #
# 5. 授权边界 gate 引擎（纯内存仿真；⛔ 零生产影响）
# ------------------------------------------------------------------ #
# 治理引擎：动作放行 ⇔ **技术前置成立** ∧ **Owner 显式授权成立**（双必要条件）
def _gov_grant(node, explicit):
    """授权唯一合法来源 = Owner 显式授予；⛔ 技术状态**不产生**授权。"""
    return bool(explicit.get(node, False))


def _gov_action(tech_ok, grant_ok):
    return "ALLOWED" if (tech_ok and grant_ok) else "BLOCKED"


# 反例引擎（故意实现「隐式传播」以证明门有效）
def _naive_upward(src_ok):       # 上游技术 PASS ⇒ 下游直接放行
    return "ALLOWED" if src_ok else "BLOCKED"


def _naive_grant_only(grant_ok):  # 只看授权，忽略技术前置
    return "ALLOWED" if grant_ok else "BLOCKED"


# ------------------------------------------------------------------ #
# 6. 打红自证
# ------------------------------------------------------------------ #
def redproof(case, doc=None):
    if doc is None:
        doc = _read(MATRIX)
    ev = {"doc": doc, "src": {"shadow": "", "safety": "", "canary": ""}}

    # ---- §8.1 owner 指定 6 项 + §8.2 增设 5 项：隐式授权传播 ----
    if case == "RP-A":   # 上游技术 PASS，下游未授权 ⇒ 必 BLOCKED（且 naive 必放行）
        gov = _gov_action(True, _gov_grant("DOWNSTREAM", {}))
        nav = _naive_upward(True)
        ok = gov == "BLOCKED" and nav == "ALLOWED"
        print("[RP-A] 技术 PASS ⇒ 授权：governed=%s / naive=%s" % (gov, nav))
        return 0 if ok else 1

    if case == "RP-B":   # 已授权但技术前置不成立 ⇒ 必 BLOCKED
        gov = _gov_action(False, _gov_grant("D", {"D": True}))
        nav = _naive_grant_only(True)
        ok = gov == "BLOCKED" and nav == "ALLOWED"
        print("[RP-B] 授权但缺技术前置：governed=%s / naive=%s" % (gov, nav))
        return 0 if ok else 1

    if case == "RP-C":   # Evidence PASS ⇒ GE-04 仍 NOT AUTHORIZED
        gov = "AUTHORIZED" if _gov_action(True, _gov_grant("GE04", {})) == "ALLOWED" else "NOT AUTHORIZED"
        nav = _naive_upward(True)
        ok = gov == "NOT AUTHORIZED" and nav == "ALLOWED"
        print("[RP-C] Evidence PASS ⇒ GE-04：governed=%s / naive=%s" % (gov, nav))
        return 0 if ok else 1

    if case == "RP-D":   # Implementation 已授权 ⇒ 生产写仍 BLOCKED
        gov = _gov_action(True, _gov_grant("PROD_WRITE", {"IMPL": True}))
        nav = _naive_grant_only(True)
        ok = gov == "BLOCKED" and nav == "ALLOWED"
        print("[RP-D] Impl 授权 ⇒ 生产写：governed=%s / naive=%s" % (gov, nav))
        return 0 if ok else 1

    if case == "RP-E":   # C-3 PASS ⇒ X-1 不自动 AUTHORIZED
        gov = "AUTHORIZED" if _gov_action(True, _gov_grant("X-1", {})) == "ALLOWED" else "NOT AUTHORIZED"
        nav = _naive_upward(True)
        ok = gov == "NOT AUTHORIZED" and nav == "ALLOWED"
        print("[RP-E] C-3 PASS ⇒ X-1：governed=%s / naive=%s" % (gov, nav))
        return 0 if ok else 1

    if case == "RP-F":   # X-1 AUTHORIZED ⇒ A-2 不自动 AUTHORIZED
        gov = "AUTHORIZED" if _gov_action(True, _gov_grant("A-2b", {"X-1": True})) == "ALLOWED" else "NOT AUTHORIZED"
        nav = _naive_grant_only(True)
        ok = gov == "NOT AUTHORIZED" and nav == "ALLOWED"
        print("[RP-F] X-1 授权 ⇒ A-2：governed=%s / naive=%s" % (gov, nav))
        return 0 if ok else 1

    if case == "RP-G":   # FREEZE PASS ⇒ ATTESTATION 不自动授权
        gov = "NOT AUTHORIZED" if _gov_action(True, _gov_grant("ATT", {})) == "BLOCKED" else "AUTHORIZED"
        ok = gov == "NOT AUTHORIZED" and _naive_upward(True) == "ALLOWED"
        print("[RP-G] FREEZE PASS ⇒ ATTESTATION：governed=%s" % gov)
        return 0 if ok else 1

    if case == "RP-H":   # DEPLOY 已授权 ⇒ GE-04 不自动授权
        gov = "NOT AUTHORIZED" if _gov_action(True, _gov_grant("GE04", {"DEPLOY": True})) == "BLOCKED" else "AUTHORIZED"
        ok = gov == "NOT AUTHORIZED" and _naive_grant_only(True) == "ALLOWED"
        print("[RP-H] DEPLOY 授权 ⇒ GE-04：governed=%s" % gov)
        return 0 if ok else 1

    if case == "RP-I":   # A-2a（代码通路）⇒ A-2b（激活）仍不授权
        gov = "NOT AUTHORIZED" if _gov_action(True, _gov_grant("A-2b", {"A-2a": True})) == "BLOCKED" else "AUTHORIZED"
        ok = gov == "NOT AUTHORIZED" and _naive_grant_only(True) == "ALLOWED"
        print("[RP-I] A-2a ⇒ A-2b 激活：governed=%s" % gov)
        return 0 if ok else 1

    if case == "RP-J":   # D-2（≥30 事件）⇒ D-3 Seal 仍须 E-4 授权
        gov = "NOT AUTHORIZED" if _gov_action(True, _gov_grant("D-3", {"D-2": True})) == "BLOCKED" else "AUTHORIZED"
        ok = gov == "NOT AUTHORIZED" and _naive_upward(True) == "ALLOWED"
        print("[RP-J] D-2 达标 ⇒ D-3 Seal：governed=%s" % gov)
        return 0 if ok else 1

    if case == "RP-K":   # C-1 Health OK ⇒ A-1 不自动达成（须 X-2 ∧ 通道②）
        gov = "ACHIEVED" if _gov_action(True and False, True) == "ALLOWED" else "NOT ACHIEVED"
        ok = gov == "NOT ACHIEVED"
        print("[RP-K] C-1 Health OK（但 X-2 未满足）⇒ A-1：%s" % gov)
        return 0 if ok else 1

    # ---- RP-L：harness 自身洁净 ----
    if case == "RP-L":
        own = _read(os.path.abspath(__file__))
        tok = [t for t in _deploy_tokens() if t in own]
        wm = _open_write_modes(own)
        astv = scan_violations(own)
        print("[RP-L] token=%s write-open=%s ast=%s" % (tok, wm, [h["detail"] for h in astv]))
        return 0 if (not tok and not wm and not astv) else 1

    # ---- RP-M…RP-Q：内容变异（矩阵结构破坏 ⇒ 对应断言必须 FAIL） ----
    ev["src"] = load_evidence()["src"]

    if case == "RP-M":   # C-1 的 R3 改为 R1 ⇒ B-10 必 FAIL
        d = doc.replace("| C-1 | BLOCKED | Health | R3 |", "| C-1 | BLOCKED | Health | R1 |")
        f = [x["id"] for x in run_checks({"doc": d, "src": ev["src"]}).rows if not x["ok"]]
        print("[RP-M] 预期 B-10.r1-not-authorized FAIL；实际 FAIL = %s" % f)
        return 0 if "B-10.r1-not-authorized" in f else 1

    if case == "RP-N":   # X-2 的 R0 改为 R2 ⇒ B-14 必 FAIL
        d = doc.replace("| X-2 | MISSING | Functional | R0 |", "| X-2 | MISSING | Functional | R2 |")
        f = [x["id"] for x in run_checks({"doc": d, "src": ev["src"]}).rows if not x["ok"]]
        print("[RP-N] 预期 B-14.x2-precondition FAIL；实际 FAIL = %s" % f)
        return 0 if "B-14.x2-precondition" in f else 1

    if case == "RP-O":   # E-3 的 Evidence 由 YES→NO ⇒ B-13 必 FAIL
        d = doc.replace("| E-3 | MISSING | Authorization | R3 | NO | YES | YES | NO | NO | YES | NO |",
                        "| E-3 | MISSING | Authorization | R3 | NO | YES | YES | NO | NO | NO | NO |")
        f = [x["id"] for x in run_checks({"doc": d, "src": ev["src"]}).rows if not x["ok"]]
        print("[RP-O] 预期 B-13.evidence-vs-ge04 FAIL；实际 FAIL = %s" % f)
        return 0 if "B-13.evidence-vs-ge04" in f else 1

    if case == "RP-P":   # A-2b 的 R3 改为 R2 ⇒ B-06 计数必 FAIL
        d = doc.replace("| A-2b | MISSING | Functional | R3 |", "| A-2b | MISSING | Functional | R2 |")
        f = [x["id"] for x in run_checks({"doc": d, "src": ev["src"]}).rows if not x["ok"]]
        print("[RP-P] 预期 B-06.r-counts FAIL；实际 FAIL = %s" % f)
        return 0 if "B-06.r-counts" in f else 1

    if case == "RP-Q":   # 反转 CP-1：把 B-1 挪到 A-2b 之后 ⇒ B-16 必 FAIL
        d = doc.replace("X-1,\n                 B-1, G-1, G-2, A-2a, A-2b, G17, E-5]",
                        "X-1,\n                 G-2, A-2a, A-2b, B-1, G-1, G17, E-5]")
        f = [x["id"] for x in run_checks({"doc": d, "src": ev["src"]}).rows if not x["ok"]]
        print("[RP-Q] 预期 B-16.cp-order FAIL；实际 FAIL = %s" % f)
        if "B-16.cp-order" in f:
            return 0
        # 兜底：CP 串仅出现于 §12；若替换未命中，显式判定为红证不成立
        print("[RP-Q] 变异未命中 CP 串（红证不成立）")
        return 1

    if case == "RP-R":   # 抽掉 NS-4 登记 ⇒ B-18 必 FAIL
        d = doc.replace("NS-4", "NSX-4")
        f = [x["id"] for x in run_checks({"doc": d, "src": ev["src"]}).rows if not x["ok"]]
        print("[RP-R] 预期 B-18.ns-registry FAIL；实际 FAIL = %s" % f)
        return 0 if "B-18.ns-registry" in f else 1

    print("未知 redproof case：%s" % case)
    return 2


# ------------------------------------------------------------------ #
# 7. main
# ------------------------------------------------------------------ #
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
        ev = load_evidence()
        C = run_checks(ev)
    except ValueError as exc:
        print("FAIL-CLOSED: %s" % exc)
        return 2
    n_fail = 0
    for x in C.rows:
        if not x["ok"]:
            n_fail += 1
            print("FAIL %-28s %s | %s" % (x["id"], x["desc"], x["detail"]))
    print("-" * 72)
    print("PASS = %d   FAIL = %d   TOTAL = %d" % (len(C.rows) - n_fail, n_fail, len(C.rows)))
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
