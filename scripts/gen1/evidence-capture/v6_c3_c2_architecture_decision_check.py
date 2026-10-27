#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""v6_c3_c2_architecture_decision_check.py —— C-3 / C-2 架构裁定 + 部署治理裁定 只读检查器。

职责（⛔ 只读）：
  校验两份交付件
    A) docs/gen1/GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md
    B) docs/gen1/GEN1_DEPLOYMENT_GOVERNANCE_DECISION_20261003.md
  显式断言（owner 指定）：
    C3_OLD_CLAIM = RETRACTED / C3_CONTRACT_DECISION = PRESENT /
    C2_A_PLUS_B = ANALYZED / C2_A_PLUS_C = ANALYZED /
    C2_AUTHORITY = EXPLICIT / C2_AUDIT = EXPLICIT / C2_STATE_TRANSITION = EXPLICIT /
    AUDIT_CARRIER = EXPLICIT / P1..P5 = EXPLICIT /
    IMPLEMENTATION_AUTHORIZED = NO / PRODUCTION_WRITE = 0 / DEPLOY = NO /
    AUTHORITY_CHANGE = NO / CANARY = OFF / GE04 = NO / STOP = YES

运行：
  python v6_c3_c2_architecture_decision_check.py                 # 常规
  python v6_c3_c2_architecture_decision_check.py --redproof RP-1 # 打红自证

⛔ 本脚本不修改 production / DB / manifest / authority / docs；不 deploy / merge / tag / 不推送远端。
⛔ RED_PROOF 只做 AST/字符串变异，⛔ 从不执行任何真实生产命令。
"""
import ast
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DOC1_REL = os.path.join("docs", "gen1", "GEN1_C3_C2_ARCHITECTURE_DECISION_20261003.md")
DOC2_REL = os.path.join("docs", "gen1", "GEN1_DEPLOYMENT_GOVERNANCE_DECISION_20261003.md")
SELF_REL = os.path.join("scripts", "gen1", "evidence-capture",
                        "v6_c3_c2_architecture_decision_check.py")

# ---------------- 契约常量 ----------------

SECTIONS1 = ["## §0", "## §1", "## §2", "## §3", "## §4"]
SECTIONS2 = ["## §0", "## §1", "## §2", "## §3", "## §4", "## §5"]

# C-3 逐维分析（owner 指定 8 维）
C3_DIMS = ["**状态源重复**", "**schema coupling**", "**health state 膨胀**",
           "**runtime vs diagnostic evidence 职责边界**", "**replay**",
           "**backward compatibility**", "**consumer impact**",
           "**是否真的有 downstream consumer 需要它**"]

# feasibility matrix 维度（owner 指定 13 维）
MATRIX_DIMS = ["| 人工输入面 |", "| authority enforcement |", "| auditability |",
               "| reviewer identity |", "| reason / evidence |", "| replay |",
               "| rollback |", "| anti-bypass |", "| DB write |", "| API surface |",
               "| 与现有 governance 一致性 |", "| 新增复杂度 |", "| 现有代码复用 |"]

# 最小契约 R1..R8
MIN_CONTRACT = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]

# 审计 8 字段
AUDIT_FIELDS = ["`actor`", "`timestamp`", "`previous_state`", "`new_state`", "`reason`",
                "`evidence_reference`", "`authority_decision`", "`correlation/request id`"]

# 审计载体盘点 6 类（owner 指定）
CARRIERS = ["**promotion script fields**", "**CloudBase logs（CLS）**",
            "**admin operation logs**", "**DB audit collection**",
            "**immutable evidence**", "**Git / deployment records**"]

# 需撤回的旧文档（C-3）
RETRACT_DOCS = ["GEN1_PRE_LAUNCH_INVENTORY_20261002.md",
                "GEN1_OWNER_DECISION_MATRIX_20261003.md",
                "GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md"]

# 既有可复用机制（owner 指定 5 类）
REUSE_MECHS = ["**authority**", "**approval**", "**review**", "**audit**", "**promotion**"]

# A+B / A+C 定义锚点（★ 长串，删一行即失效）
AB_DEF = "**A+B** = A（timer 保持自动检测/状态写入） + B（新增最小 admin release route）"
AC_DEF = "**A+C** = A（timer 保持自动检测/状态写入） + C（复用或扩展既有 promotion / governance channel）"

# C3-A / C3-B 定义锚点
C3A_DEF = "**C3-A** —— 「coarse 权威状态」"
C3B_DEF = "**C3-B** —— 「明细入权威状态」"

# 审计落点裁定锚点
LOCUS_DEF = "AUDIT_CARRIER_LOCUS = docs/gen1/artifacts/**"

# P1..P5 裁定锚点
P_RULINGS = {
    "P1": "P1_RULING = ADD_D007",
    "P2": "P2_RULING = ADD_BASELINE_ACCEPTED_NOT_AUTHORIZATION",
    "P3": "P3_RULING = MANDATORY_FOR_NEW_DEPLOY_DEBT_FOR_LEGACY",
    "P4": "P4_RULING = MASTER_IS_NOT_THE_ONLY_AUTHORITY",
    "P5": "P5_RULING = FORK_FROM_ONLINE_PARITY_ANCHORED_COMMIT",
}

# STOP 字段（doc1 §4 代码块）
STOP1_EXPECT = {
    "C3_STATUS": "RECLASSIFY", "C3_OLD_CLAIM": "RETRACTED",
    "C3_CONTRACT_DECISION": "C3-A", "C3_R2_AUTHORIZED": "NO",
    "C2_ARCHITECTURE_OPTIONS_COMPLETE": "YES",
    "C2_A_PLUS_B": "ANALYZED", "C2_A_PLUS_C": "ANALYZED",
    "C2_AUTHORITY": "EXPLICIT", "C2_AUDIT": "EXPLICIT",
    "C2_STATE_TRANSITION": "EXPLICIT", "C2_RELEASE_CONTRACT_IMPLEMENTED": "NO",
    "AUDIT_CARRIER": "EXPLICIT", "AUDIT_CARRIER_LOCUS": "DOCS_GEN1_ARTIFACTS",
    "AUDIT_CARRIER_LOCUS_CHOSEN": "YES",
    "IMPLEMENTATION_AUTHORIZED": "NO", "PRODUCTION_WRITE": "0", "DB_WRITE": "0",
    "DEPLOY": "NO", "AUTHORITY_CHANGE": "NO", "CANARY": "OFF",
    "EVIDENCE_EXECUTION": "NO", "GE04": "NO", "STOP": "YES",
}
# STOP 字段（doc2 §5 代码块）
STOP2_EXPECT = {
    "P1": "EXPLICIT", "P2": "EXPLICIT", "P3": "EXPLICIT", "P4": "EXPLICIT",
    "P5": "EXPLICIT",
    "P1_EXECUTED": "NO", "P2_EXECUTED": "NO", "P3_EXECUTED": "NO",
    "P4_EXECUTED": "NO", "P5_EXECUTED": "NO",
    "ONLINE_DEPLOYMENT": "MIXED",
    "DEPLOYMENT_AUTHORITY_SOURCE": "REMOTE_VISIBLE_REF_PLUS_AUTHORIZATION",
    "MASTER_IS_ONLY_AUTHORITY": "NO", "PACKAGE_LEVEL_PARITY": "NOT_REVERIFIED",
    "LEDGER_HISTORY_MODIFIED": "NO",
    "IMPLEMENTATION_AUTHORIZED": "NO", "PRODUCTION_WRITE": "0", "DB_WRITE": "0",
    "DEPLOY": "NO", "AUTHORITY_CHANGE": "NO", "CANARY": "OFF",
    "EVIDENCE_EXECUTION": "NO", "GE04": "NO", "STOP": "YES",
}

OVERCLAIM = re.compile(
    r"Deploy\s*=\s*YES|Canary\s*=\s*ON|auto_execution\s*=\s*true"
    r"|GE-04\s*=\s*AUTHORIZED|Produces?\s+production\s+authorization"
    r"|MASTER_IS_ONLY_AUTHORITY\s*=\s*YES"
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


def stop_fields(doc, marker):
    """只解析指定章节的**代码块**；逐行 ^KEY = VALUE$（剥离行尾注释）。"""
    sec = slice_section(doc, marker, None)
    blocks = re.findall(r"```[a-zA-Z]*\n(.*?)```", sec, re.S)
    body = "\n".join(blocks)
    got = {}
    for line in body.splitlines():
        line = line.split("#", 1)[0].rstrip()
        m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*([A-Za-z0-9_.-]+)\s*$", line)
        if m:
            got.setdefault(m.group(1), set()).add(m.group(2).upper())
    return body, got


class Checker:
    def __init__(self):
        self.rows = []

    def chk(self, cid, desc, ok, detail=""):
        self.rows.append({"id": cid, "desc": desc, "ok": bool(ok), "detail": detail})


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

    # ---- A-01 自证只读 ----
    with io.open(os.path.join(ROOT, SELF_REL), "r", encoding="utf-8") as f:
        selfsrc = f.read()
    sc = SelfScan()
    sc.visit(ast.parse(selfsrc))
    C.chk("A-01.self-readonly", "本检查器无写模式 open / 无 exec / 无部署 token",
          not sc.write_open and not sc.exec_calls and not sc.token_hits,
          "open=%s exec=%s tok=%s" % (sc.write_open, sc.exec_calls, sc.token_hits))

    # ---- A-02 两件存在且非空 ----
    C.chk("A-02.docs-present", "两份交付件存在且非空",
          len(d1) > 3000 and len(d2) > 3000, "d1=%d d2=%d" % (len(d1), len(d2)))

    # ---- A-03 / A-04 章节齐全 ----
    m1 = [s for s in SECTIONS1 if s not in d1]
    C.chk("A-03.doc1-sections", "架构裁定件 §0–§4 齐全", not m1, "missing=%s" % m1)
    m2 = [s for s in SECTIONS2 if s not in d2]
    C.chk("A-04.doc2-sections", "部署治理裁定件 §0–§5 齐全", not m2, "missing=%s" % m2)

    # ---- A-05 C3_OLD_CLAIM = RETRACTED（正文登记 + STOP 取值 双向）----
    body1, got1 = stop_fields(d1, "## §4")
    ok5 = ("C3_OLD_CLAIM = RETRACTED" in n1
           and got1.get("C3_OLD_CLAIM") == {"RETRACTED"}
           and "⛔ **RETRACTED**（非工作项）" in d1
           and "C3-α" in d1 and "C3-β" in d1)
    C.chk("A-05.c3-old-claim-retracted",
          "旧 Gap 旧表述 RETRACTED（正文 + STOP 双向，且给出 C3-α/C3-β 去向）", ok5)

    # ---- A-06 C3_CONTRACT_DECISION 存在且裁定 = C3-A ----
    ok6 = ("C3_CONTRACT_DECISION = C3-A" in n1
           and got1.get("C3_CONTRACT_DECISION") == {"C3-A"}
           and "C3_STATUS = RECLASSIFY" in n1
           and got1.get("C3_STATUS") == {"RECLASSIFY"})
    C.chk("A-06.c3-contract-decision", "C3_CONTRACT_DECISION = C3-A 且 C3_STATUS = RECLASSIFY", ok6)

    # ---- A-07 C3-A 定义完整（★ 篡改即红）----
    ok7 = (C3A_DEF in d1
           and "`OK` / `WARNING` / `DEGRADED` / `ML_OFF`" in d1
           and "`ML_SHADOW_SIGNAL`" in d1)
    C.chk("A-07.c3-a-defined", "C3-A 定义完整（coarse 状态 + 明细归 ML_SHADOW_SIGNAL）", ok7)

    # ---- A-08 C3-B 定义完整 + 明确不被采用（★ 篡改即红）----
    ok8 = (C3B_DEF in d1 and "`missing_features` / data_health detail" in d1
           and "C3_CONTRACT_DECISION = C3-A" in n1)
    C.chk("A-08.c3-b-defined-and-rejected", "C3-B 定义完整且裁定未采用 C3-B", ok8)

    # ---- A-09 C-3 逐维分析（owner 8 维）----
    m = [k for k in C3_DIMS if k not in d1]
    C.chk("A-09.c3-dimensions", "C-3 逐维分析覆盖 owner 指定 8 维", not m, "missing=%s" % m)

    # ---- A-10 downstream consumer 实测（结论：无消费者）----
    ok10 = ("**不存在任何 downstream consumer 需要 `missing_features` 进入权威 health state。**" in d1
            and "runGen1ShadowEod/index.js:234" in d1
            and "runDecisionEngine/index.js:781-782" in d1)
    C.chk("A-10.no-downstream-consumer", "实测确认无下游消费者（写入点唯一 + 对照粗粒度有消费者）", ok10)

    # ---- A-11 既有架构先例（信号侧快照分列）----
    ok11 = ("gen1_signal_health_snapshot" in d1
            and "不得影响 `effective_*`" in d1
            and "gen1-health-single-truth.test.js" in d1
            and "违反本仓已确立且已测的「健康单一真相 + 审计分列」原则" in d1)
    C.chk("A-11.architectural-precedent", "引用既有『健康单一真相 + 审计分列』先例作为裁定依据", ok11)

    # ---- A-12 RATIONALE + RECLASSIFY 去向表 ----
    ok12 = ("**RATIONALE**" in d1 and "为什么是 `RECLASSIFY` 而不是 `CLOSE`" in d1
            and "为什么不是 `REMAIN_BLOCKER`" in d1
            and "C3-γ" in d1 and "C3-δ" in d1)
    C.chk("A-12.rationale", "给出 RATIONALE 且解释 RECLASSIFY 的三选一取舍与去向", ok12)

    # ---- A-13 CLOSE 式四项附随交付 ----
    ok13 = ("**① Gap closure evidence" in d1 and "**② 为什么不需要 production implementation" in d1
            and "**③ 哪些旧文档必须标记 RETRACTED**" in d1
            and "**④ 后续是否只保留 observability improvement backlog**" in d1)
    m = [k for k in RETRACT_DOCS if k not in d1]
    C.chk("A-13.close-annex", "四项附随交付齐备 + 旧文档 RETRACTED 清单指名",
          ok13 and not m, "annex=%s missing_docs=%s" % (ok13, m))

    # ---- A-14 R2 独立残留项（边界逐字）----
    ok14 = ("R2 = 规格 / 口径修正" in n1 and "R2 ≠ 功能已修复" in n1
            and "R2 ≠ 已授权" in n1 and "C3_R2_AUTHORIZED" in d1
            and "不得过度归因" in d1)
    C.chk("A-14.r2-residual", "R2 独立残留项登记且边界与过度归因禁令齐备", ok14)

    # ---- A-15 C2_A_PLUS_B = ANALYZED（★ 删定义行即红）----
    ok15 = (AB_DEF in d1 and "| Dimension | **A+B** | **A+C** |" in d1
            and got1.get("C2_A_PLUS_B") == {"ANALYZED"})
    C.chk("A-15.a-plus-b-analyzed", "A+B 已分析（定义行 + 矩阵列 + STOP 取值）", ok15)

    # ---- A-16 C2_A_PLUS_C = ANALYZED（★ 删定义行即红）----
    ok16 = (AC_DEF in d1 and "| Dimension | **A+B** | **A+C** |" in d1
            and got1.get("C2_A_PLUS_C") == {"ANALYZED"})
    C.chk("A-16.a-plus-c-analyzed", "A+C 已分析（定义行 + 矩阵列 + STOP 取值）", ok16)

    # ---- A-17 C2_ARCHITECTURE_OPTIONS_COMPLETE ----
    C.chk("A-17.options-complete", "C2_ARCHITECTURE_OPTIONS_COMPLETE = YES",
          got1.get("C2_ARCHITECTURE_OPTIONS_COMPLETE") == {"YES"})

    # ---- A-18 feasibility matrix 13 维齐备 ----
    m = [k for k in MATRIX_DIMS if k not in d1]
    C.chk("A-18.feasibility-matrix", "feasibility matrix 覆盖 owner 指定 13 维",
          not m, "missing=%s" % m)

    # ---- A-19 ★ 「C 是 governance channel 还是 mutation utility？」----
    ok19 = ("**裁定：`C` 现在是 `production mutation utility`" in d1
            and "已被治理文档声明、但未被实现兑现的承诺" in d1
            and "不得因为它能写 DB，就认为它具备 release authority" in d1
            and "promote-v361-cutover.js:54" in d1
            and "promote-ml-shadow-observe.js:61" in d1)
    C.chk("A-19.c-is-mutation-utility", "裁定 C 为 mutation utility（6 项证据 + 治理指定落差）", ok19)

    # ---- A-20 既有机制盘点（owner 5 类）----
    m = [k for k in REUSE_MECHS if k not in d1]
    ok20 = (not m) and ("全仓 grep `audit_log` / `operation_log` / `admin_log`" in d1)
    C.chk("A-20.reusable-mechanisms", "既有 authority/approval/review/audit/promotion 盘点齐备",
          ok20, "missing=%s" % m)

    # ---- A-21 最小契约 R1..R8 ----
    m = [k for k in MIN_CONTRACT if not re.search(r"^  " + k + r"  ", d1, re.M)]
    ok21 = (not m) and ("C2_MINIMAL_CONTRACT" in d1)
    C.chk("A-21.minimal-contract", "C2_MINIMAL_CONTRACT R1..R8 齐备", ok21, "missing=%s" % m)

    # ---- A-22/23/24/25 四项显式输出 ----
    ok22 = ("C2_REQUIRED_AUTHORITY" in d1 and "authorityAllows" in d1
            and "可指认的自然人/会话身份" in d1)
    C.chk("A-22.c2-authority", "C2_REQUIRED_AUTHORITY 显式（复用 authority + 自然人身份要求）", ok22)
    ok23 = ("C2_REQUIRED_AUDIT" in d1 and "落点与执行面耦合" in d1)
    C.chk("A-23.c2-audit", "C2_REQUIRED_AUDIT 显式（8 字段 + 落点耦合）", ok23)
    ok24 = ("C2_REQUIRED_STATE_TRANSITION" in d1 and "recovery_applied = true" in d1
            and "仅分支①" in d1)
    C.chk("A-24.c2-state-transition", "C2_REQUIRED_STATE_TRANSITION 显式（仅分支①）", ok24)
    ok25 = ("C2_IMPLEMENTATION_SURFACE" in d1
            and "cloudfunctions/adminGateway/index.js（+1 route + handler + 审计写）" in d1
            and "scripts/promote-gen1-health-release.js" in d1)
    C.chk("A-25.c2-impl-surface", "C2_IMPLEMENTATION_SURFACE 显式（A+B / A+C 两形态）", ok25)

    # ---- A-26 ⛔ 不排名 / 不自行选 ----
    ok26 = ("⛔ **不排名、不自行选型**" in d1) and ("不为了验证 release contract 而真的执行 release" in d1)
    C.chk("A-26.no-ranking", "声明不排名/不自行选型 + 只做静态验证", ok26)

    # ---- A-27 审计 8 字段 ----
    m = [k for k in AUDIT_FIELDS if k not in d1]
    ok27 = (not m) and ("不得把 `updated_at` 当审计" in d1)
    C.chk("A-27.audit-fields", "审计职责 8 字段齐备 + 禁止以 updated_at 充审计",
          ok27, "missing=%s" % m)

    # ---- A-28 AUDIT_CARRIER_LOCUS 终裁（★ 删裁定即红）----
    ok28 = (LOCUS_DEF in d1
            and got1.get("AUDIT_CARRIER") == {"EXPLICIT"}
            and got1.get("AUDIT_CARRIER_LOCUS") == {"DOCS_GEN1_ARTIFACTS"}
            and got1.get("AUDIT_CARRIER_LOCUS_CHOSEN") == {"YES"}
            and "gen1_health_state.reviewed_at / reviewed_by" in d1)
    C.chk("A-28.audit-carrier-locus", "AUDIT_CARRIER_LOCUS 已终裁（git-tracked artifact + 状态内建）", ok28)

    # ---- A-29 ★ deliverables/** 不在 git 的更正 ----
    ok29 = ("`.gitignore:23`" in d1 and "从未进入任何 commit" in d1
            and "不可作权威审计落点" in d1
            and "docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json" in d1)
    C.chk("A-29.deliverables-not-in-git", "更正前件：deliverables/** 不在版本控制内（附反向对照）", ok29)

    # ---- A-30 载体盘点 6 类 ----
    m = [k for k in CARRIERS if k not in d1]
    ok30 = (not m) and ("⛔ **不存在**" in d1)
    C.chk("A-30.carrier-inventory", "审计载体盘点覆盖 owner 指定 6 类（存在/不存在均给证据）",
          ok30, "missing=%s" % m)

    # ---- A-31 缺口表（8 字段逐项缺什么）----
    ok31 = ("**明确缺口（现有载体缺什么" in d1
            and "`authority_decision` | ⛔ **无**（`authorityAllows()` 结果**不被记录**）" in d1)
    C.chk("A-31.gap-table", "逐字段列出现有载体缺口", ok31)

    # ---- A-32 与 C-2 选项的耦合 ----
    ok32 = ("**A+C**" in d1 and "**A+B**" in d1
            and "运行时不能写 git" in d1 and "只读导出" in d1)
    C.chk("A-32.locus-coupling", "声明审计落点与 C-2 选项的耦合（A+B 需只读导出）", ok32)

    # ---- A-33 doc1 STOP 代码块 ----
    bad1 = []
    for f, v in STOP1_EXPECT.items():
        if f not in got1:
            bad1.append(f + ":MISSING")
        elif got1[f] != {v}:
            bad1.append("%s:%s" % (f, sorted(got1[f])))
    C.chk("A-33.stop-doc1", "架构裁定件 §4 STOP 代码块字段齐全且非放行",
          bool(body1) and not bad1, "bad=%s" % bad1)

    # ---- A-34..A-38 P1..P5 逐项裁定（★ 删任一即红）----
    for pid, anchor in P_RULINGS.items():
        C.chk("A-%d.%s-ruling" % (33 + int(pid[1]), pid.lower()),
              "%s 裁定存在且锚点完整" % pid, anchor in d2, "anchor=%s" % anchor)

    # ---- A-39 doc2 STOP 代码块 ----
    body2, got2 = stop_fields(d2, "## §5")
    bad2 = []
    for f, v in STOP2_EXPECT.items():
        if f not in got2:
            bad2.append(f + ":MISSING")
        elif got2[f] != {v}:
            bad2.append("%s:%s" % (f, sorted(got2[f])))
    C.chk("A-39.stop-doc2", "部署治理件 §5 STOP 代码块字段齐全且非放行",
          bool(body2) and not bad2, "bad=%s" % bad2)

    # ---- A-40 P4 反证（master 不是唯一权威源）----
    ok40 = ("假设不成立。`master` ⛔ 不是唯一部署权威源。" in d2
            and "∉ `origin/master` 祖先" in d2
            and "没有合法来源" in d2)
    C.chk("A-40.p4-reductio", "P4 给出反证（master 唯一权威 ⇒ 线上内容无合法来源 ⇒ 矛盾）", ok40)

    # ---- A-41 P5 先证明后裁定 ----
    ok41 = ("`git show 8fc3ba66:cloudfunctions/adminGateway/index.js`" in d2
            and "997 → 1134 行" in d2
            and "5 个 commit" in d2
            and "FORK_FROM_ONLINE_PARITY_ANCHORED_COMMIT" in d2)
    C.chk("A-41.p5-proof", "P5 先证明（8fc3ba66 逐字节 = 线上）再裁定分叉起点", ok41)

    # ---- A-42 无越界肯定式 ----
    hit = OVERCLAIM.findall(d1) + OVERCLAIM.findall(d2)
    C.chk("A-42.no-overclaim", "两件均不含越界肯定式", not hit, "hits=%s" % hit)

    # ---- A-43 无部署 token ----
    hits = [t for t in _deploy_tokens() if (t in d1 or t in d2)]
    C.chk("A-43.no-deploy-token", "两件均不含部署/变更命令 token", not hits, "hits=%s" % hits)

    # ---- A-44 显式声明『不构成实施授权』+ 放行口令 ----
    ok44a = ("不构成实施授权" in d1) and ("不代表已获授权" in d1)
    ok44b = bool(re.search(r"AGENT[ _]IMPLEMENTATION[ _]AUTHORIZED", d1))
    forbid = re.findall(r"已完成授权|已获授权实现|AUTHORIZED\s*=\s*YES", d1 + d2)
    C.chk("A-44.no-implicit-authorization",
          "显式声明『不构成实施授权』+ 引用放行口令 + ⛔ 无『已授权』肯定式",
          ok44a and ok44b and not forbid,
          "a=%s b=%s forbid=%s" % (ok44a, ok44b, forbid))

    # ---- A-45 零写声明 ----
    ok45 = ("PRODUCTION_WRITE = 0" in n1) and ("DB_WRITE = 0" in n1) \
           and ("PRODUCTION_WRITE = 0" in n2) and ("DB_WRITE = 0" in n2)
    C.chk("A-45.zero-write", "两件均声明零写（PRODUCTION_WRITE / DB_WRITE = 0）", ok45)

    # ---- A-46 裁定 ≠ 执行（P1..P5_EXECUTED = NO）----
    ok46 = all(got2.get(k) == {"NO"} for k in
               ("P1_EXECUTED", "P2_EXECUTED", "P3_EXECUTED", "P4_EXECUTED", "P5_EXECUTED"))
    C.chk("A-46.ruling-not-executed", "P1..P5 裁定 ≠ 执行（EXECUTED 全 NO）", ok46)

    # ---- A-47 台账历史行未改 ----
    ok47 = got2.get("LEDGER_HISTORY_MODIFIED") == {"NO"} \
           and ("未改部署台账的任何历史行" in d2)
    C.chk("A-47.ledger-history-intact", "声明未改部署台账历史行", ok47)

    # ---- A-48 与 C-2 的交界登记 ----
    ok48 = ("与 C-2 的交界" in d2) and ("`P5` 的分叉裁定是其硬前置" in d2)
    C.chk("A-48.c2-interface", "部署治理件显式登记与 C-2 的交界（P5 → A+B 前置）", ok48)

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

    if case == "RP-1":      # 篡改 C3-A 定义 ⇒ A-07 红
        mut = d1.replace(C3A_DEF, "**C3-A** —— 「随便什么」")
        ok, bad = fails_after(mut, d2, "A-07.c3-a-defined")
        return report("RP-1", ok and mut != d1, bad)
    if case == "RP-2":      # 篡改 C3-B 定义 ⇒ A-08 红
        mut = d1.replace(C3B_DEF, "**C3-B** —— 「已被采用」")
        ok, bad = fails_after(mut, d2, "A-08.c3-b-defined-and-rejected")
        return report("RP-2", ok and mut != d1, bad)
    if case == "RP-3":      # 删 C3 RETRACTED ⇒ A-05 红
        mut = d1.replace("C3_OLD_CLAIM                     = RETRACTED",
                         "C3_OLD_CLAIM                     = ACCEPTED")
        mut = mut.replace("⛔ **RETRACTED**（非工作项）", "✅ 成立（工作项）")
        ok, bad = fails_after(mut, d2, "A-05.c3-old-claim-retracted")
        return report("RP-3", ok and mut != d1, bad)
    if case == "RP-4":      # C3 契约裁定被改为 C3-B ⇒ A-06 红
        mut = re.sub(r"C3_CONTRACT_DECISION(\s*)= C3-A",
                     r"C3_CONTRACT_DECISION\1= C3-B", d1)
        ok, bad = fails_after(mut, d2, "A-06.c3-contract-decision")
        return report("RP-4", ok and mut != d1, bad)
    if case == "RP-5":      # 删 A+B 定义 ⇒ A-15 红
        mut = d1.replace(AB_DEF, "（A+B 定义已移除）")
        ok, bad = fails_after(mut, d2, "A-15.a-plus-b-analyzed")
        return report("RP-5", ok and mut != d1, bad)
    if case == "RP-6":      # 删 A+C 定义 ⇒ A-16 红
        mut = d1.replace(AC_DEF, "（A+C 定义已移除）")
        ok, bad = fails_after(mut, d2, "A-16.a-plus-c-analyzed")
        return report("RP-6", ok and mut != d1, bad)
    if case == "RP-7":      # 删 audit carrier 裁定 ⇒ A-28 红
        mut = d1.replace(LOCUS_DEF, "AUDIT_CARRIER_LOCUS = （未定）")
        mut = mut.replace("AUDIT_CARRIER_LOCUS              = DOCS_GEN1_ARTIFACTS",
                          "AUDIT_CARRIER_LOCUS              = UNDECIDED")
        ok, bad = fails_after(mut, d2, "A-28.audit-carrier-locus")
        return report("RP-7", ok and mut != d1, bad)
    if case == "RP-8":      # 删 P4 裁定 ⇒ A-37 红
        mut = d2.replace(P_RULINGS["P4"], "（P4 裁定已移除）")
        ok, bad = fails_after(d1, mut, "A-37.p4-ruling")
        return report("RP-8", ok and mut != d2, bad)
    if case == "RP-9":      # 删 P5 裁定 ⇒ A-38 红
        mut = d2.replace(P_RULINGS["P5"], "（P5 裁定已移除）")
        ok, bad = fails_after(d1, mut, "A-38.p5-ruling")
        return report("RP-9", ok and mut != d2, bad)
    if case == "RP-10":     # IMPLEMENTATION_AUTHORIZED = YES ⇒ A-33 红
        mut = re.sub(r"IMPLEMENTATION_AUTHORIZED(\s*)= NO",
                     r"IMPLEMENTATION_AUTHORIZED\1= YES", d1)
        ok, bad = fails_after(mut, d2, "A-33.stop-doc1")
        return report("RP-10", ok and mut != d1, bad)
    if case == "RP-11":     # 注入越界肯定式（★ 运行时拼装）⇒ A-42 红
        corpus = " ".join(("Deploy", "=", "YES"))
        mut = d2.replace("## §5", corpus + "\n\n## §5")
        ok, bad = fails_after(d1, mut, "A-42.no-overclaim")
        return report("RP-11", ok and mut != d2, bad)
    if case == "RP-12":     # 注入部署 token（运行时拼装）⇒ A-43 红
        corpus = " ".join(("git", "push"))
        mut = d1.replace("## §4", corpus + "\n\n## §4")
        ok, bad = fails_after(mut, d2, "A-43.no-deploy-token")
        return report("RP-12", ok and mut != d1, bad)
    if case == "RP-13":     # 注入『已授权』肯定式 ⇒ A-44 红
        mut = d1.replace("不构成实施授权", "已完成授权")
        ok, bad = fails_after(mut, d2, "A-44.no-implicit-authorization")
        return report("RP-13", ok and mut != d1, bad)
    if case == "RP-14":     # 篡改 P4 结论为「master 唯一」⇒ A-40/A-39 红
        mut = d2.replace("MASTER_IS_ONLY_AUTHORITY    = NO",
                         "MASTER_IS_ONLY_AUTHORITY    = YES")
        ok, bad = fails_after(d1, mut, "A-39.stop-doc2")
        return report("RP-14", ok and mut != d2, bad)
    if case == "RP-15":     # 反证自证：未变异时必须全绿
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
