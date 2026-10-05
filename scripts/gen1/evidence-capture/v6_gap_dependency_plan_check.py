# -*- coding: utf-8 -*-
"""
GEN1_GAP_DEPENDENCY_AND_IMPLEMENTATION_PLAN —— 只读 executable check
(v6_gap_dependency_plan_check.py)

性质：**纯只读**。⛔ 不联网 / ⛔ 不调用任何 cloud CLI / ⛔ 不写任何文件 / ⛔ 不开子进程。
数据来源（全部离线归档）：
  ① 线上部署源码 CodeInfo 归档：<_cb-connect>/codeinfo_20261002/*.index.js
  ② 线上只读 DB 探针归档：      <_cb-connect>/probe_*.json
  ③ 线上只读 HTTP 探针归档：    <_cb-connect>/probe_api_*_20261002.json
  ④ 共享模块源码（= 线上同包）：repo@dist-functions/runDecisionEngine/common/utils/*
  ⑤ 本 Gate 主件 + 勘误件

★ §13 红线（owner 2026-10-02）：RED_PROOF MUST NEVER EXECUTE REAL PRODUCTION COMMANDS。
  本脚本红证仅使用 **AST mutation（内存合成源码，永不落盘、永不执行）+ 内存内容变异**。

用法：
  python v6_gap_dependency_plan_check.py                 # 全量断言
  python v6_gap_dependency_plan_check.py --redproof RP-A # 打红自证
退出码：0 = 全 PASS；1 = 有 FAIL；2 = fail-closed（证据缺失/结构异常）
"""
import ast
import io
import json
import os
import re
import sys

# ------------------------------------------------------------------ #
# 0. 路径
# ------------------------------------------------------------------ #
def repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        "..", "..", ".."))


def evidence_dir():
    e = os.environ.get("GEN1_EVIDENCE_DIR")
    if e:
        return os.path.abspath(e)
    return os.path.join(os.path.dirname(repo_root()), "_cb-connect-20260921")


def dist_utils():
    return os.path.join(os.path.dirname(repo_root()), "etf-decision-engine",
                        "dist-functions", "runDecisionEngine", "common", "utils")


EVD = evidence_dir()
CINFO = os.path.join(EVD, "codeinfo_20261002")
PLAN = os.path.join(repo_root(), "docs", "gen1",
                    "GEN1_GAP_DEPENDENCY_AND_IMPLEMENTATION_PLAN_20261003.md")
ERRATA = os.path.join(repo_root(), "docs", "gen1",
                      "GEN1_PRE_LAUNCH_INVENTORY_ERRATA_20261003.md")

# ------------------------------------------------------------------ #
# 1. 自证扫描器（AST 结构化；⛔ 不扫自由字符串常量）
# ------------------------------------------------------------------ #
FORBIDDEN_CALLS = {
    "subprocess.run", "subprocess.Popen", "subprocess.call", "subprocess.check_call",
    "subprocess.check_output", "subprocess.getoutput", "subprocess.getstatusoutput",
    "os.system", "os.popen", "os.execv", "os.execve", "os.execvp", "os.execl", "os.execle",
    "os.spawnv", "os.spawnl", "shutil.rmtree", "eval", "exec", "compile", "__import__",
    "pty.spawn",
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
    """返回违规列表 [{line, kind, detail}]。语法错误 ⇒ 抛 ValueError（fail-closed）。"""
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
            _mode_args = list(node.args[1:2]) + [k.value for k in node.keywords
                                                 if k.arg == "mode"]
            for a in _mode_args:
                if isinstance(a, ast.Constant) and isinstance(a.value, str) \
                        and any(ch in a.value for ch in "wax+"):
                    out.append({"line": node.lineno, "kind": "FILE_WRITE",
                                "detail": "open(mode=%r)" % a.value})
    return out


# -------------------------------------------------- 正/负样本（仅内存，⛔ 不落盘） -------------------------------------------------- #
_MUTATION_CASES = [
    ("P-1", "subprocess.run 调 tcb 子命令（deploy 形态）", "CALL",
     "def _rp_never_called():\n    import subprocess\n"
     "    subprocess.run(['tcb', 'fn', 'deploy', '--force'])\n"),
    ("P-2", "os.system", "CALL",
     "def _rp_never_called():\n    import os\n"
     "    os.system('tcb' + ' fn ' + 'deploy')\n"),
    ("P-3", "eval", "CALL",
     "def _rp_never_called():\n    eval('1+1')\n"),
    ("P-4", "模块级 tcb 调用（PROD_CLI）", "PROD_CLI",
     "tcb.fn.deploy('apiGateway')\n"),
    ("P-5", "写文件", "FILE_WRITE",
     "def _rp_never_called():\n    open('x', 'w').write('1')\n"),
    ("P-6", "shutil.rmtree", "CALL",
     "def _rp_never_called():\n    import shutil\n    shutil.rmtree('/')\n"),
]
_MUTATION_NEGATIVE = [
    ("N-1", "字符串常量含 subprocess 字样", 'MSG = "subprocess.run([\'tcb\'])"\n'),
    ("N-2", "注释含 tcb 子命令字样",
     "# 禁止 subprocess.run(['tcb','fn','deploy'])\nX = 1\n"),
    ("N-3", "定义但永不调用的函数（返回拼接式字符串，非调用）",
     "def _probe_never_called():\n"
     "    return 'tcb' + ' ' + 'fn' + ' ' + 'deploy'\n"),
    ("N-4", "只读 open", "def r():\n    return open('/tmp/x', 'r').read()\n"),
]

# ------------------------------------------------------------------ #
# 2. 证据装载（纯读）
# ------------------------------------------------------------------ #
def _must(p):
    if not os.path.exists(p):
        raise ValueError("证据缺失（fail-closed）：%s" % p)
    return p


def _read(p):
    return io.open(_must(p), "r", encoding="utf-8", errors="replace").read()


def _probe_rows(name):
    s = _read(os.path.join(EVD, "probe_%s.json" % name))
    j = json.loads(s[s.find("{"):])
    res = j.get("data", {}).get("results")
    if not isinstance(res, list) or not res or not isinstance(res[0], list):
        raise ValueError("探针归档结构异常（fail-closed）：%s" % name)
    return res[0]


def _plain(v):
    if isinstance(v, dict):
        for k in ("$numberInt", "$numberDouble", "$numberLong"):
            if k in v:
                return v[k]
        return next(iter(v.values())) if v else None
    return v


def load_evidence():
    ev = {}
    ev["codeinfo"] = {fn: _read(os.path.join(CINFO, "%s.index.js" % fn))
                      for fn in ("apiGateway", "adminGateway", "runDecisionEngine",
                                 "runGen1ShadowEod", "materializeIndicators")}
    ev["api"] = json.loads(_read(os.path.join(EVD, "probe_api_constants_20261002.json")))
    ev["db"] = {n: _probe_rows(n) for n in ("run_candidate_decision", "run_manifest",
                                            "run_history", "active_run_pointer",
                                            "ml_shadow_signal")}
    U = dist_utils()
    ev["src"] = {
        "safety": _read(os.path.join(U, "gen1-safety-permission.js")),
        "shadow": _read(os.path.join(U, "gen1-shadow-eligibility.js")),
        "selector": _read(os.path.join(U, "gen1-guarded-selector.js")),
        "seal": _read(os.path.join(U, "gen1-guarded-seal.js")),
    }
    ev["plan"] = _read(PLAN)
    ev["errata"] = _read(ERRATA)
    return ev


def rt(ev):
    return ev["api"]["data"]["runtime_status"]


# ------------------------------------------------------------------ #
# 3. 断言
# ------------------------------------------------------------------ #
class Ctx(object):
    def __init__(self):
        self.rows = []

    def ck(self, rid, desc, ok, detail=""):
        self.rows.append({"id": rid, "desc": desc, "ok": bool(ok), "detail": detail})


def run_checks(ev):
    C = Ctx()
    plan, errata = ev["plan"], ev["errata"]
    R = ev["src"]
    rcd = ev["db"]["run_candidate_decision"]
    sig = ev["db"]["ml_shadow_signal"]
    r = rt(ev)

    # ---- R-01 自证：本脚本零违规 ----
    own = _read(os.path.abspath(__file__))
    C.ck("R-01.self-scan", "本 check 自身 AST 零违规", not scan_violations(own),
         "违规=%s" % [h["detail"] for h in scan_violations(own)])

    # ---- R-02 载体件存在 ----
    C.ck("R-02.plan-present", "主件存在且非空", len(plan) > 8000, "len=%d" % len(plan))
    C.ck("R-03.errata-present", "勘误件存在且非空", len(errata) > 1500,
         "len=%d" % len(errata))

    # ---- R-04..R-08 门链源码（首因 = 阶段门）----
    C.ck("R-04.model-stages", "MODEL_STAGES 严格 S2-only",
         "MODEL_STAGES = Object.freeze(['S2'])" in R["safety"], "gen1-safety-permission.js L43")
    C.ck("R-05.stage-gate", "阶段门形态 baseStage != S2 && != S3",
         "baseStage !== 'S2' && baseStage !== 'S3'" in R["safety"], "L162")
    C.ck("R-06.stage-reason", "阶段门原因码 BASELINE_STAGE_NOT_ELIGIBLE",
         "BASELINE_STAGE_NOT_ELIGIBLE" in R["safety"], "L163")
    C.ck("R-07.guarded-8keys", "guardedChecks 恰 8 键",
         all(k in R["safety"] for k in (
             "authority_guarded:", "freeze_seal_approved:", "evidence_seal_pass:",
             "health_allows_guarded:", "data_ok:", "domain_strict_in_domain:",
             "safety_pass:", "model_candidate:")), "L275-284")
    C.ck("R-08.guarded-first-fail", "guardedReason 首项 = GUARDED_AUTHORITY_NOT_EFFECTIVE",
         "!authorityGuarded ? 'GUARDED_AUTHORITY_NOT_EFFECTIVE'" in R["safety"], "L287-288")

    # ---- R-09..R-10 shadow eligibility 6 项且排除三钥匙 ----
    six = ["authority_canary", "health_allows_guarded", "data_ok",
           "domain_strict_in_domain", "safety_pass", "model_candidate"]
    C.ck("R-09.shadow-6", "SHADOW_COMPONENTS 恰 6 项且顺序如设计",
         all(("key: '%s'" % k) in R["shadow"] for k in six), "gen1-shadow-eligibility.js L56-63")
    C.ck("R-10.shadow-excludes-seals",
         "shadow 资格明确排除 authority_guarded / freeze / evidence",
         "明确排除" in R["shadow"] and "不得纳入" in R["shadow"], "L47-50")

    # ---- R-11..R-13 selector 结构性锁死 ----
    C.ck("R-11.ge02-frozen", "GE_02_BASELINE_AUTHORITATIVE = true",
         "GE_02_BASELINE_AUTHORITATIVE = true" in R["selector"], "L31")
    C.ck("R-12.selector-hardcode", "selector 恒 BASELINE",
         "const authoritativeSource = SELECTOR_SOURCE.BASELINE;" in R["selector"]
         and "const selected = baseline;" in R["selector"], "L80-81")
    C.ck("R-13.selector-throws", "selector 双 throw 硬不变量",
         R["selector"].count("throw new Error") >= 2, "L95-100")

    # ---- R-14..R-16 rde 侧结构与信号接入 ----
    rde = ev["codeinfo"]["runDecisionEngine"]
    C.ck("R-14.rde-throws", "rde 双 throw（不得采纳 Gen-1，dormant）",
         "GE-02 selector 必须 baseline-authoritative" in rde
         and "GE-02 不得采纳 Gen-1 候选" in rde, "rde L1041-1044 / L1049-1051")
    C.ck("R-15.signal-read", "rde 按 date 读 ml_shadow_signal",
         "COLLECTIONS.ML_SHADOW_SIGNAL, { date: latestDate }" in rde, "rde L751-754")
    C.ck("R-16.hash-gated-by-signal", "candidate_hash 由 signal 存在性派生",
         "gen1_candidate_hash: signal ? candidateHash({" in R["selector"], "L150")

    # ---- R-17..R-23 run_candidate_decision 逐值（★ ERRATA-1 核心）----
    by_run = {}
    for row in rcd:
        by_run.setdefault(_plain(row.get("run_id")), []).append(row)
    C.ck("R-17.rows", "rcd 行数 = 10 且 run 数 = 2",
         len(rcd) == 10 and len(by_run) == 2, "rows=%d runs=%d" % (len(rcd), len(by_run)))
    hashes = [(_plain(x.get("run_id")), _plain(x.get("gen1_candidate_hash"))) for x in rcd]
    n_none = sum(1 for _, h in hashes if h is None)
    n_hex = sum(1 for _, h in hashes if isinstance(h, str) and re.fullmatch(r"[0-9a-f]{64}", h))
    C.ck("R-18.hash-split", "gen1_candidate_hash = 5 None / 5 非空64hex（ERRATA-1）",
         n_none == 5 and n_hex == 5, "None=%d hex=%d" % (n_none, n_hex))
    C.ck("R-19.adopted-all-false", "gen1_adopted 10/10 False",
         all(_plain(x.get("gen1_adopted")) is False for x in rcd), "")
    C.ck("R-20.decision-source", "decision_source 唯一 = V361_SAFETY_CORE",
         {_plain(x.get("decision_source")) for x in rcd} == {"V361_SAFETY_CORE"}, "")
    C.ck("R-21.selector-baseline", "gen1_guarded_selector_source 10/10 BASELINE",
         {_plain(x.get("gen1_guarded_selector_source")) for x in rcd} == {"BASELINE"}, "")
    C.ck("R-22.stage-set", "gen1_guarded_baseline_stage ⊆ {S0,S1}",
         {_plain(x.get("gen1_guarded_baseline_stage")) for x in rcd} <= {"S0", "S1"},
         "stages=%s" % sorted({_plain(x.get("gen1_guarded_baseline_stage")) for x in rcd}))
    C.ck("R-23.shadow-null", "gen1_guarded_shadow_source 10/10 None（guarded candidate 恒 null）",
         all(_plain(x.get("gen1_guarded_shadow_source")) is None for x in rcd), "")
    C.ck("R-24.model-cand-false", "gen1_model_candidate 10/10 False",
         all(_plain(x.get("gen1_model_candidate")) is False for x in rcd), "")

    # ---- R-25..R-31 runtime_status 门值 ----
    C.ck("R-25.health", "runtime_status.gen1_health_status = DEGRADED",
         _plain(r.get("gen1_health_status")) == "DEGRADED", "")
    C.ck("R-26.shadow-count", "shadow_eligible_count = 0（从未资格成立一次）",
         _plain(r.get("gen1_guarded_shadow_eligible_count")) in ("0", 0), "")
    C.ck("R-27.events", "independent_events = 0",
         _plain(r.get("gen1_guarded_evidence_independent_events")) in ("0", 0), "")
    C.ck("R-28.seals", "两把 Seal 均 PENDING",
         _plain(r.get("gen1_guarded_freeze_seal_status")) == "PENDING"
         and _plain(r.get("gen1_guarded_evidence_seal_status")) == "PENDING", "")
    C.ck("R-29.effective", "gen1_guarded_effective_active = False",
         _plain(r.get("gen1_guarded_effective_active")) is False, "")
    C.ck("R-30.authority", "gen1_authority = CANARY（X-1 未升档）",
         _plain(r.get("gen1_authority")) == "CANARY", "")
    C.ck("R-31.rt-selector", "runtime_status.gen1_guarded_selector_source = BASELINE",
         _plain(r.get("gen1_guarded_selector_source")) == "BASELINE", "")

    # ---- R-32..R-34 ml_shadow_signal 自然运行 ----
    C.ck("R-32.signal-rows", "ml_shadow_signal 有真实行",
         len(sig) >= 1, "rows=%d" % len(sig))
    C.ck("R-33.signal-runid", "signal_run_id 前缀 gen1-eod-",
         all(str(_plain(x.get("signal_run_id")) or "").startswith("gen1-eod-") for x in sig), "")
    C.ck("R-34.signal-stages", "signal.stage ⊆ {S0,S1,S2}（证明 ③ 门输入域）",
         {_plain(x.get("stage")) for x in sig} <= {"S0", "S1", "S2"},
         "stages=%s" % sorted({_plain(x.get("stage")) for x in sig}))

    # ---- R-35..R-44 主件内容（DAG / 阶段 / 关键路径 / 边界）----
    C.ck("R-35.plan-stop", "§14 STOP 字段齐备",
         all(k in plan for k in ("GEN1_GAP_DEPENDENCY_AND_IMPLEMENTATION_PLAN = COMPLETE",
                                 "CRITICAL_PATH = [", "ROOT_BLOCKERS = [",
                                 "PARALLEL_WORK = [", "DEFERRED_CLEANUP = [",
                                 "PRODUCTION_WRITE_GATES = [", "OWNER_AUTH_GATES = [",
                                 "STOP = YES")), "")
    C.ck("R-36.plan-critical-path", "关键路径节点齐备（C-3→…→E-5）",
         all(n in plan for n in ("C-3", "C-2", "C-1", "C-4", "A-1", "D-1", "D-2",
                                 "D-3", "X-1", "A-2", "B-1", "G-1", "G-2", "E-5")), "")
    C.ck("R-37.plan-phases", "9 阶段 P-1…P8 均登记",
         all(("**%s**" % p) in plan for p in ("P-1", "P0", "P1", "P2", "P3", "P4",
                                              "P5", "P6", "P7", "P8")), "")
    C.ck("R-38.plan-deferred", "N-1…N-4 = DEFERRED",
         all(("N-%d = DEFERRED" % i) in plan for i in (1, 2, 3, 4)), "")
    C.ck("R-39.plan-harness-only", "N-9a / F-5 隔离为 harness-only",
         "HARNESS_DOMAIN ONLY" in plan and "test/check harness ONLY" in plan, "")
    C.ck("R-40.plan-new-nodes", "X-1 / X-2 新增 DAG 节点登记",
         "X-1" in plan and "X-2" in plan and "STAGE_PRECONDITION" in plan
         and "AUTHORITY_ELEVATION_PATH" in plan, "")
    C.ck("R-41.plan-boundary", "功能 vs 证据边界：三条禁止句齐备",
         all(s in plan for s in ("⇒ ✗ Gen-1 Functional Complete",
                                 "⇒ ✗ Production Live", "⇒ ✗ GE04 Authorized")), "")
    C.ck("R-42.plan-erratum", "ERRATA-1 在勘误件与主件均已登记",
         "ERRATA-1" in plan and "ERRATA-1" in errata, "")
    C.ck("R-43.plan-37-ids", "37 项 Gap ID 全覆盖",
         all(i in plan for i in ([("A-%d" % i) for i in range(1, 4)]
                                 + [("B-%d" % i) for i in range(1, 7)]
                                 + [("C-%d" % i) for i in range(1, 5)]
                                 + [("D-%d" % i) for i in range(1, 6)]
                                 + [("E-%d" % i) for i in range(1, 11)]
                                 + [("F-%d" % i) for i in range(1, 6)]
                                 + [("G-%d" % i) for i in range(1, 5)])), "")
    C.ck("R-44.plan-g0-g10", "G0–G10 十一节点五态判定",
         all(("**G%d " % i) in plan for i in range(0, 11))
         and all(s in plan for s in ("**PASS**", "**BLOCKED**", "**MISSING**",
                                     "**PARTIAL**")), "")
    C.ck("R-45.plan-phase-diff", "与 owner 示例阶段划分的差异登记 PD-1…PD-6",
         all(("**PD-%d**" % i) in plan for i in range(1, 7)), "")
    C.ck("R-46.errata-precise", "勘误件给出 5/10 精确分布且不改上游判定",
         "5/10 = `None`" in errata and "⛔ **不变**" in errata, "")

    # ---- R-47..R-49 否定式与红线（零命中反向断言）----
    forbid = ["已切换 selector", "已恢复 Health", "GEN1_IN_DECISION_CHAIN = READY",
              "GE04 = AUTHORIZED", "PRODUCTION_WRITE = 1", "只差一步"]
    hit = [s for s in forbid if s in plan]
    C.ck("R-47.no-affirmative", "主件无越界肯定式（零命中）", not hit, "命中=%s" % hit)
    norm = re.sub(r"[ \t]+", " ", plan)
    C.ck("R-48.boundary-inverted", "主件显式否证三条反向推导（⛔ … ⇒ ✗ …）",
         all(s in norm for s in (
             "⛔ Evidence PASS ⇒ ✗ Gen-1 Functional Complete",
             "⛔ Functional Complete ⇒ ✗ Production Live",
             "⛔ Production Live ⇒ ✗ GE04 Authorized")), "")
    C.ck("R-49.zero-write-claim", "本轮零写声明齐备",
         all(k in plan for k in ("PRODUCTION WRITE = 0", "DEPLOY = NO", "ROLLBACK = NO",
                                 "CANARY = OFF", "SELECTOR SWITCH = NO",
                                 "ml_effective SWITCH = NO", "HEALTH RECOVERY = NO")), "")
    C.ck("R-50.harness-fp", "F-5 / F-6 均登记为 harness 已知误报且不改闸门",
         "F-6" in plan and "HARNESS_FALSE_POSITIVES" in plan
         and "KNOWN FALSE POSITIVE" in plan
         and "⛔ 本轮**不改闸门" in plan, "")
    C.ck("R-51.regression-honest", "回归结果如实登记（含非全绿与不可复现说明）",
         "11 PASS / 2 FAIL" in plan and "commit-range 相关" in plan
         and "15.4" in plan, "")
    # ★ 自指规避（self-scan-ast-no-self-reference）：token 表若以完整字面量书写，
    #   断言自身即被 `own` 命中 ⇒ 恒 FAIL。此处一律运行时片段拼装，
    #   使本文件源码中不出现任何完整部署 token（判据不变：仍是那 7 个 token）。
    C.ck("R-52.self-harness-clean", "本 Gate 新增 harness 零部署 token",
         not [t for t in _deploy_tokens() if t in own], "")
    return C


def _deploy_tokens():
    """运行时拼装 7 个部署 token；⛔ 不以完整字面量出现在源码中。"""
    j = " ".join
    return (
        j(("tcb", "fn", "deploy")),
        j(("tcb", "deploy")),
        "functions" + ":" + "deploy",
        j(("firebase", "deploy")),
        j(("gcloud", "functions", "deploy")),
        j(("npm", "run", "deploy")),
        "cloudbase " + "functions" + ":" + "deploy",
    )


# ------------------------------------------------------------------ #
# 4. 打红自证
# ------------------------------------------------------------------ #
def redproof(case):
    if case == "RP-A":      # AST mutation 正/负样本
        bad = []
        for rid, desc, kind, src in _MUTATION_CASES:
            v = scan_violations(src)
            if not any(h["kind"] == kind for h in v):
                bad.append("%s 未命中 %s" % (rid, kind))
        for rid, desc, src in _MUTATION_NEGATIVE:
            if scan_violations(src):
                bad.append("%s 误命中" % rid)
        print("[RP-A] 正样本 %d / 负样本 %d；问题 = %s"
              % (len(_MUTATION_CASES), len(_MUTATION_NEGATIVE), bad))
        return 0 if not bad else 1

    ev = load_evidence()

    if case == "RP-B":      # 内存变异：rcd 全部 hash 置 None ⇒ R-18 必 FAIL
        for x in ev["db"]["run_candidate_decision"]:
            x["gen1_candidate_hash"] = None
        f = [x["id"] for x in run_checks(ev).rows if not x["ok"]]
        print("[RP-B] 预期 R-18.hash-split FAIL；实际 FAIL = %s" % f)
        return 0 if "R-18.hash-split" in f else 1

    if case == "RP-C":      # 内存变异：selector_source 改为 GUARDED ⇒ R-21 必 FAIL
        for x in ev["db"]["run_candidate_decision"]:
            x["gen1_guarded_selector_source"] = "GUARDED"
        f = [x["id"] for x in run_checks(ev).rows if not x["ok"]]
        print("[RP-C] 预期 R-21.selector-baseline FAIL；实际 FAIL = %s" % f)
        return 0 if "R-21.selector-baseline" in f else 1

    if case == "RP-D":      # 内存变异：health 置 OK ⇒ R-25 必 FAIL
        rt(ev)["gen1_health_status"] = "OK"
        f = [x["id"] for x in run_checks(ev).rows if not x["ok"]]
        print("[RP-D] 预期 R-25.health FAIL；实际 FAIL = %s" % f)
        return 0 if "R-25.health" in f else 1

    if case == "RP-E":      # 内存变异：主件去掉 STOP 段 ⇒ R-35 必 FAIL
        ev["plan"] = ev["plan"].replace("STOP = YES", "STOP = NO", 1)
        f = [x["id"] for x in run_checks(ev).rows if not x["ok"]]
        print("[RP-E] 预期 R-35.plan-stop FAIL；实际 FAIL = %s" % f)
        return 0 if "R-35.plan-stop" in f else 1

    if case == "RP-F":      # AST mutation：本脚本自身注入违规 ⇒ 扫描必命中
        orig = _read(os.path.abspath(__file__))
        mutated = orig.replace(
            "    ev = load_evidence()",
            "    import subprocess\n    subprocess.run(['tcb', 'fn', 'deploy'])\n"
            "    ev = load_evidence()", 1)
        v = scan_violations(mutated)
        print("[RP-F] 变异后命中 = %s" % [h["detail"] for h in v])
        return 0 if any(h["kind"] == "CALL" for h in v) else 1

    # ---- 本 Gate 新增三门（R-50 / R-51 / R-52）的专属红证 ----
    if case == "RP-G":      # 内容变异：主件去掉 harness-fp 登记 ⇒ R-50 必 FAIL
        ev["plan"] = ev["plan"].replace("HARNESS_FALSE_POSITIVES", "HFP_MASKED")
        f = [x["id"] for x in run_checks(ev).rows if not x["ok"]]
        print("[RP-G] 预期 R-50.harness-fp FAIL；实际 FAIL = %s" % f)
        return 0 if "R-50.harness-fp" in f else 1

    if case == "RP-H":      # 内容变异：主件改写成全绿 ⇒ R-51 必 FAIL
        # ⚠️ 主件中该串出现 2 次 ⇒ 必须**全量**替换，只换首处会留残导致红证假绿
        ev["plan"] = ev["plan"].replace("11 PASS / 2 FAIL", "12 PASS / 0 FAIL")
        f = [x["id"] for x in run_checks(ev).rows if not x["ok"]]
        print("[RP-H] 预期 R-51.regression-honest FAIL；实际 FAIL = %s" % f)
        return 0 if "R-51.regression-honest" in f else 1

    if case == "RP-I":      # 内容变异：合成含完整 token 的 own' ⇒ R-52 必 FAIL
        own = _read(os.path.abspath(__file__))
        pre = [t for t in _deploy_tokens() if t in own]
        if pre:                     # 正常态即命中 ⇒ 断言本身写错，红证不成立
            print("[RP-I] 正常态即命中 %s（异常）" % pre)
            return 1
        injected = own + "\n# " + _deploy_tokens()[0] + "\n"
        hit = [t for t in _deploy_tokens() if t in injected]
        print("[RP-I] 正常态命中 = []；注入后命中 = %s" % hit)
        return 0 if hit else 1

    print("未知 redproof case：%s" % case)
    return 2


# ------------------------------------------------------------------ #
# 5. main
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
    except ValueError as exc:
        print("FAIL-CLOSED: %s" % exc)
        return 2
    C = run_checks(ev)
    n_fail = 0
    for x in C.rows:
        if not x["ok"]:
            n_fail += 1
            print("FAIL %-26s %s | %s" % (x["id"], x["desc"], x["detail"]))
    print("-" * 72)
    print("PASS = %d   FAIL = %d   TOTAL = %d"
          % (len(C.rows) - n_fail, n_fail, len(C.rows)))
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
