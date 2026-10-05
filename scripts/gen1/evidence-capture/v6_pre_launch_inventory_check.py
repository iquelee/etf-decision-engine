# -*- coding: utf-8 -*-
"""
GEN1_PRE_LAUNCH_INVENTORY —— 只读 executable check（v6_pre_launch_inventory_check.py）

性质：**纯只读**。⛔ 不联网 / ⛔ 不调用任何 cloud CLI / ⛔ 不写任何文件 / ⛔ 不开子进程。
数据来源（全部为离线归档）：
  ① 线上部署源码 CodeInfo 归档：<_cb-connect>/codeinfo_20261002/*.index.js
  ② 线上函数详情归档：          <_cb-connect>/fndetail_*_20261002.json
  ③ 线上只读 HTTP 探针归档：    <_cb-connect>/probe_api_*_20261002.json
  ④ 线上只读 DB 探针归档：      <_cb-connect>/probe_*.json
  ⑤ 载体树 / 主仓源码：         carrier / dist-functions

★ §13 红线（owner 2026-10-02）：RED_PROOF MUST NEVER EXECUTE REAL PRODUCTION COMMANDS。
  本脚本红证仅使用 **AST mutation（合成源码字符串，永不落盘、永不执行）+ 内存内容变异**。

用法：
  python v6_pre_launch_inventory_check.py                # 全量断言
  python v6_pre_launch_inventory_check.py --redproof RP-A # 打红自证
退出码：0 = 全 PASS；1 = 有 FAIL；2 = fail-closed（证据缺失/结构异常）
"""
import ast
import hashlib
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

def dist_root():
    return os.path.join(os.path.dirname(repo_root()), "etf-decision-engine", "dist-functions")

EVD = evidence_dir()
CINFO = os.path.join(EVD, "codeinfo_20261002")

# ------------------------------------------------------------------ #
# 1. 自证扫描器（AST 结构化；⛔ 不扫自由字符串常量）
# ------------------------------------------------------------------ #
FORBIDDEN_CALLS = {
    "subprocess.run", "subprocess.Popen", "subprocess.call", "subprocess.check_call",
    "subprocess.check_output", "subprocess.getoutput", "subprocess.getstatusoutput",
    "os.system", "os.popen", "os.execv", "os.execve", "os.execvp", "os.execl", "os.execle",
    "os.spawnv", "os.spawnl", "shutil.rmtree", "eval", "exec", "compile", "__import__",
    "pty.spawn", "commands.getoutput",
}
FORBIDDEN_PREFIXES = ("tcb.", "cloudbase.", "gh.", "git.")
FORBIDDEN_BARE = {"tcb", "cloudbase", "gh"}


def _dotted(node):
    """把 Attribute/Name 链还原为点分名；失败返回 None。"""
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
                out.append({"line": getattr(node, "lineno", 0), "kind": "CALL",
                            "detail": name})
            elif name.startswith(FORBIDDEN_PREFIXES) or (
                    "." not in name and name in FORBIDDEN_BARE):
                out.append({"line": getattr(node, "lineno", 0), "kind": "PROD_CLI",
                            "detail": name})
        elif isinstance(node, ast.Attribute):
            pass
    # 写文件（只在 Call 形态下判定，避免误报字符串）
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "open":
            _mode_args = list(node.args[1:2]) + [k.value for k in node.keywords
                                                 if k.arg == "mode"]
            for a in _mode_args:
                if isinstance(a, ast.Constant) and isinstance(a.value, str) \
                        and any(ch in a.value for ch in "wax+"):
                    out.append({"line": getattr(node, "lineno", 0), "kind": "FILE_WRITE",
                                "detail": "open(mode=%r)" % a.value})
    return out


# -------------------------------------------------- 负样本（必不被命中） -------------------------------------------------- #
_MUTATION_NEGATIVE = [
    ("N-1", "字符串常量含 subprocess 字样（非调用）",
     'MSG = "subprocess.run([\'tcb\', \'fn\', \'deploy\'])"\n'),
    ("N-2", "注释含 tcb deploy",
     "# 禁止 subprocess.run(['tcb','fn','deploy','--force'])\nX = 1\n"),
    ("N-3", "定义但永不调用的函数（AST 仍应命中 ⇒ 本样本改名为安全名）",
     "def _probe_never_called():\n    return 'tcb fn deploy'\n"),
    ("N-4", "只读 open（无写模式）",
     "def r():\n    return open('/tmp/x', 'r').read()\n"),
]
# -------------------------------------------------- 正样本（必被命中） -------------------------------------------------- #
_MUTATION_CASES = [
    ("P-1", "subprocess.run 调 tcb deploy", "CALL",
     "def _rp_never_called():\n    import subprocess\n"
     "    subprocess.run(['tcb', 'fn', 'deploy', '--force'])\n"),
    ("P-2", "os.system", "CALL",
     "def _rp_never_called():\n    import os\n    os.system('tcb fn deploy')\n"),
    ("P-3", "eval", "CALL",
     "def _rp_never_called():\n    eval('1+1')\n"),
    ("P-4", "模块级 tcb 调用（PROD_CLI）", "PROD_CLI",
     "tcb.fn.deploy('apiGateway')\n"),
    ("P-5", "写文件", "FILE_WRITE",
     "def _rp_never_called():\n    open('x', 'w').write('1')\n"),
    ("P-6", "shutil.rmtree", "CALL",
     "def _rp_never_called():\n    import shutil\n    shutil.rmtree('/')\n"),
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


def _api_probe(name):
    s = _read(os.path.join(EVD, "probe_api_%s_20261002.json" % name))
    return json.loads(s[s.find("{"):])


def _fndetail(fn):
    s = _read(os.path.join(EVD, "fndetail_%s_20261002.json" % fn))
    return json.loads(s[s.find("{"):])["data"]


def load_evidence():
    ev = {}
    ev["codeinfo"] = {fn: _read(os.path.join(CINFO, "%s.index.js" % fn))
                      for fn in ("apiGateway", "adminGateway", "runDecisionEngine",
                                 "runGen1ShadowEod", "materializeIndicators")}
    ev["fndetail"] = {fn: _fndetail(fn)
                      for fn in ("apiGateway", "adminGateway", "runDecisionEngine",
                                 "runGen1ShadowEod", "materializeIndicators")}
    ev["api"] = {n: _api_probe(n)
                 for n in ("dashboard", "etf_list", "decisions_513310", "constants")}
    ev["db"] = {n: _probe_rows(n) for n in ("run_manifest", "run_history",
                                            "active_run_pointer", "run_candidate_decision",
                                            "run_candidate_portfolio", "ml_shadow_signal")}
    ev["carrier"] = {
        "selector": _read(os.path.join(repo_root(), "src", "common", "utils",
                                       "gen1-guarded-selector.js")),
    }
    ev["dist"] = {
        "apiGateway": os.path.join(dist_root(), "apiGateway", "index.js"),
        "rde": os.path.join(dist_root(), "runDecisionEngine", "index.js"),
    }
    return ev


# ------------------------------------------------------------------ #
# 3. 断言
# ------------------------------------------------------------------ #
class Ctx(object):
    def __init__(self):
        self.rows = []

    def ck(self, cid, desc, ok, detail=""):
        self.rows.append({"id": cid, "desc": desc, "ok": bool(ok), "detail": str(detail)[:160]})
        return bool(ok)


def sha_lf(txt):
    return hashlib.sha256(txt.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def run_checks(ev):
    C = Ctx()
    ci, fd, api, db = ev["codeinfo"], ev["fndetail"], ev["api"], ev["db"]

    # ---------------- A. 本脚本自证：零违规（§13 红线） ----------------
    self_src = io.open(os.path.abspath(__file__), "r", encoding="utf-8",
                       errors="replace").read()
    C.ck("R-1", "本 check 脚本零违规调用（AST 自证，§13 红线）",
         not scan_violations(self_src), scan_violations(self_src))

    # ---------------- B. 线上部署身份（§4.1） ----------------
    C.ck("R-2", "线上 apiGateway ModTime = 2026-09-08 11:32:53（早于 V3.6.5 部署）",
         fd["apiGateway"]["ModTime"] == "2026-09-08 11:32:53", fd["apiGateway"]["ModTime"])
    C.ck("R-3", "线上 adminGateway ModTime = 2026-09-08 11:32:23",
         fd["adminGateway"]["ModTime"] == "2026-09-08 11:32:23", fd["adminGateway"]["ModTime"])
    C.ck("R-4", "线上 runDecisionEngine ModTime = 2026-09-30 13:38:07（V3.6.5 写侧部署）",
         fd["runDecisionEngine"]["ModTime"] == "2026-09-30 13:38:07",
         fd["runDecisionEngine"]["ModTime"])
    C.ck("R-5", "线上 runDecisionEngine 与 dist-functions 逐字节同（部署源 = repo@dist）",
         sha_lf(ci["runDecisionEngine"]) == sha_lf(_read(ev["dist"]["rde"])),
         sha_lf(ci["runDecisionEngine"])[:16])
    C.ck("R-6", "线上 runGen1ShadowEod == 载体树 cloudfunctions 源",
         sha_lf(ci["runGen1ShadowEod"]) ==
         sha_lf(_read(os.path.join(repo_root(), "cloudfunctions",
                                   "runGen1ShadowEod", "index.js"))),
         sha_lf(ci["runGen1ShadowEod"])[:16])
    C.ck("R-7", "线上 apiGateway 与 dist-functions 不同（迁移版未部署）",
         sha_lf(ci["apiGateway"]) != sha_lf(_read(ev["dist"]["apiGateway"])),
         "online=%s dist=%s" % (sha_lf(ci["apiGateway"])[:12],
                                sha_lf(_read(ev["dist"]["apiGateway"]))[:12]))

    # ---------------- C. 读路径 = LEGACY（§4.2 / B-1） ----------------
    for fn in ("apiGateway", "adminGateway"):
        for tok in ("v365-active-read", "v365-publish-store", "resolveAuthoritative",
                    "active_run_pointer", "run_candidate"):
            C.ck("R-8.%s:%s" % (fn, tok),
                 "线上 %s 源码零命中 %r" % (fn, tok), ci[fn].count(tok) == 0,
                 ci[fn].count(tok))
    C.ck("R-9", "线上 apiGateway 含 legacy 读点 orderBy decision_date desc",
         "orderBy: [{ field: 'decision_date', direction: 'desc' }]" in ci["apiGateway"])
    C.ck("R-10", "线上 apiGateway 含 snapshot_date desc limit 1（legacy 快照读）",
         "orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 1"
         in ci["apiGateway"])
    C.ck("R-11", "线上 apiGateway 行数 968（三源皆异的旧版）",
         ci["apiGateway"].count("\n") >= 960 and ci["apiGateway"].count("\n") <= 975,
         ci["apiGateway"].count("\n") + 1)
    C.ck("R-12", "线上 runDecisionEngine 已接线写侧 v365-run-integrity / publish-store",
         ci["runDecisionEngine"].count("v365-run-integrity") >= 1
         and ci["runDecisionEngine"].count("v365-publish-store") >= 1)
    C.ck("R-13", "线上 runDecisionEngine 未含读侧模块 v365-active-read",
         ci["runDecisionEngine"].count("v365-active-read") == 0)

    # ---------------- D. 线上 HTTP 响应形状（第二重确认） ----------------
    for ep, keys in (("dashboard", ("authority", "mutable_axis")),
                     ("etf_list", ("authority", "mutable_axis"))):
        data = api[ep].get("data") or {}
        txt = json.dumps(data, ensure_ascii=False)
        for k in keys:
            C.ck("R-14.%s:%s" % (ep, k),
                 "线上 /%s 响应无 %r 键（⇒ 迁移版未部署）" % (ep, k),
                 k not in txt, txt.count(k))
    dash = api["dashboard"].get("data") or {}
    times = set(re.findall(r'"data_time":\s*"([^"]*)"',
                           json.dumps(dash, ensure_ascii=False)))
    C.ck("R-15", "线上 dashboard 全部 data_time = 2026-09-29（legacy decision_result 停写日）",
         times == {"2026-09-29"}, sorted(times))
    C.ck("R-16", "线上 dashboard.overview.snapshot_date = 2026-09-30",
         (dash.get("overview") or {}).get("snapshot_date") == "2026-09-30",
         (dash.get("overview") or {}).get("snapshot_date"))
    C.ck("R-17", "线上 decisions 端点返回 legacy 行且含 decision_date",
         isinstance(api["decisions_513310"].get("data"), list)
         and "decision_date" in api["decisions_513310"]["data"][0])
    C.ck("R-18", "线上 /api/constants 暴露 runtime_status",
         isinstance((api["constants"].get("data") or {}).get("runtime_status"), dict))

    # ---------------- E. 八源实读 ----------------
    rm = db["run_manifest"]
    C.ck("R-19", "run_manifest = 2 行（2 个 run）", len(rm) == 2, len(rm))
    C.ck("R-20", "run_manifest：09-30 validation_passed=True / ok；10-01=False / mixed_date_detected",
         {(r.get("run_id"), r.get("validation_passed"), r.get("validation_reason"))
          for r in rm} == {
             ("engine:2026-09-30:b1790776862980", True, "ok"),
             ("engine:2026-10-01:b1790812813101", False, "mixed_date_detected")})
    rh = db["run_history"]
    promoted = [r for r in rh if r.get("promoted") is True]
    C.ck("R-21", "run_history 恰 1 个 promoted=True", len(promoted) == 1, len(promoted))
    if promoted:
        p = promoted[0]
        C.ck("R-22", "promotion 证据完整：cas_reason=PROMOTED ∧ read_after_write_consistent=True "
                     "∧ engine_version=v3.6.5",
             p.get("cas_reason") == "PROMOTED"
             and p.get("read_after_write_consistent") is True
             and p.get("engine_version") == "v3.6.5", p.get("cas_reason"))
    C.ck("R-23", "run_history 含 revision / supersedes_run_id / same_trade_date_supersede "
                 "（revision 可追溯）",
         all(("revision" in r and "supersedes_run_id" in r
              and "same_trade_date_supersede" in r) for r in rh))
    ptr = db["active_run_pointer"]
    C.ck("R-24", "active_run_pointer 1 行且 _id = active_run_pointer::production",
         len(ptr) == 1 and ptr[0].get("_id") == "active_run_pointer::production",
         ptr[0].get("_id") if ptr else None)
    C.ck("R-25", "active_run_pointer.run_id 与已提升 run 一致（可追溯）",
         ptr and ptr[0].get("run_id") == "engine:2026-09-30:b1790776862980",
         ptr[0].get("run_id") if ptr else None)
    cand = db["run_candidate_decision"]
    C.ck("R-26", "run_candidate_decision = 10 行（2 run × 5 票）", len(cand) == 10, len(cand))
    C.ck("R-27", "★ 全部 candidate gen1_adopted=False（Gen-1 未被采纳）",
         all(r.get("gen1_adopted") is False for r in cand),
         sorted({r.get("gen1_adopted") for r in cand}))
    C.ck("R-28", "★ 全部 candidate decision_source='V361_SAFETY_CORE'（非 ..._WITH_GEN1）",
         all(r.get("decision_source") == "V361_SAFETY_CORE" for r in cand))
    C.ck("R-29", "全部 candidate engine_path='v3'（trend_stage_enabled 路由）",
         all(r.get("engine_path") == "v3" for r in cand))
    C.ck("R-30", "全部 candidate gen1_guarded_selector_source='BASELINE'",
         all(r.get("gen1_guarded_selector_source") == "BASELINE" for r in cand))
    acts = {r.get("run_id") for r in cand if r.get("gen1_run_id")}
    C.ck("R-31", "★ 当前 active run 的 candidate 无 gen1_run_id（G17 / F-4）",
         all(r.get("gen1_run_id") is None for r in cand
             if r.get("run_id") == "engine:2026-09-30:b1790776862980"))
    C.ck("R-32", "存在带 gen1_run_id 的 run（联动机制存在，但未提升）",
         any(r.get("gen1_run_id") for r in cand), sorted(acts))
    C.ck("R-33", "run_candidate_portfolio = 2 行", len(db["run_candidate_portfolio"]) == 2,
         len(db["run_candidate_portfolio"]))
    ms = db["ml_shadow_signal"][:6]
    C.ck("R-34", "ml_shadow_signal 探针有行且 ml_effective 恒 False",
         len(ms) > 0 and all(r.get("ml_effective") is False for r in ms), len(ms))

    # ---------------- F. runtime_status（经 /api/constants 只读实读） ----------------
    rs = (api["constants"].get("data") or {}).get("runtime_status") or {}
    exp = {
        "ml_effective": False,
        "gen1_guarded_selector_source": "BASELINE",
        "gen1_guarded_effective_active": False,
        "gen1_guarded_evidence_independent_events": 0,
        "gen1_guarded_evidence_seal_status": "PENDING",
        "gen1_guarded_freeze_seal_status": "PENDING",
        "gen1_production_write": False,
        "gen1_auto_execution": False,
        "gen1_authority": "CANARY",
        "gen1_health_status": "DEGRADED",
        "gen1_health_manual_review_required": True,
        "v365_mode": "ENFORCE",
        "v365_authoritative_publish_status": "NOT_PROMOTED",
        "v365_finality_status": "COMPLETE",
    }
    for k, v in exp.items():
        C.ck("R-35.%s" % k, "线上 runtime_status.%s == %r" % (k, v), rs.get(k) == v, rs.get(k))
    C.ck("R-36", "runtime_status.v365_run_integrity.engine_version = 'v3.6.5'（运行身份）",
         ((rs.get("v365_run_integrity") or {}).get("engine_version")) == "v3.6.5",
         (rs.get("v365_run_integrity") or {}).get("engine_version"))
    C.ck("R-37", "runtime_status.updated_at = 2026-10-01T00:00:22.690Z（无 10-02 运行）",
         rs.get("updated_at") == "2026-10-01T00:00:22.690Z", rs.get("updated_at"))

    # ---------------- G. selector 硬不变量（A-2） ----------------
    sel = ev["carrier"]["selector"]
    C.ck("R-38", "selector 硬编码 GE_02_BASELINE_AUTHORITATIVE = true",
         "const GE_02_BASELINE_AUTHORITATIVE = true;" in sel)
    C.ck("R-39", "selector 无条件返回 BASELINE（authoritativeSource 常量）",
         "const authoritativeSource = SELECTOR_SOURCE.BASELINE;" in sel
         and "const selected = baseline;" in sel)
    C.ck("R-40", "selector 对 GUARDED 分支 throw（无 cutover 通路）",
         "authoritativeSource === SELECTOR_SOURCE.GUARDED" in sel and "throw new Error" in sel)

    # ---------------- H. Rollback 缺席（§9 / G-2/G-3） ----------------
    rde_src = ci["runDecisionEngine"]
    C.ck("R-41", "线上 runDecisionEngine 无 rollback 函数定义（G-2）",
         not re.search(r"function\s+\w*rollback\w*\s*\(", rde_src, re.I)
         and not re.search(r"rollback\w*\s*[:=]\s*(async\s*)?\(", rde_src, re.I))
    runbook = os.path.join(repo_root(), "docs", "gen1", "GEN1_CANARY_GO_LIVE_RUNBOOK.md")
    rb = _read(runbook) if os.path.exists(runbook) else ""
    C.ck("R-42", "canary runbook 零 ROLLBACK 章节（G-3）", rb.count("ROLLBACK") == 0,
         rb.count("ROLLBACK"))

    # ---------------- I. 本件主交付物的存在与关键结论 ----------------
    inv = os.path.join(repo_root(), "docs", "gen1", "GEN1_PRE_LAUNCH_INVENTORY_20261002.md")
    txt = _read(inv)
    for needle, tag in (
            ("GEN1_PRODUCTION_READ_PATH_INTEGRATION = MISSING", "R-43"),
            ("PRODUCTION_READ_SOURCE = decision_result", "R-44"),
            ("GEN1_IN_DECISION_CHAIN = NOT READY", "R-45"),
            ("RED_PROOF MUST NEVER EXECUTE REAL PRODUCTION COMMANDS", "R-46"),
            ("AUDIT_CHAIN_INCOMPLETE = YES", "R-47"),
            ("G16_SELECTOR_CUTOVER_PATH_EXISTS", "R-48"),
            ("G17_GEN1_HAS_EFFECT_ON_DECISION", "R-49"),
            ("STOP = YES", "R-50"),
    ):
        C.ck(tag, "主件含关键结论：%s" % needle, needle in txt)
    C.ck("R-51", "主件含七分类标题（owner §12 的 7 类）",
         all(h in txt for h in (
             "### A 类 —— 功能缺口", "### B 类 —— 生产集成缺口",
             "### C 类 —— Health / 安全状态缺口", "### D 类 —— Evidence 缺口",
             "### E 类 —— Authorization 缺口", "### F 类 —— Observability / Audit 缺口",
             "### G 类 —— Rollback / Fail-closed 缺口")))
    C.ck("R-52", "主件含 §12.9 前身五类映射（承前件结构，⛔ 不丢历史）",
         "### 12.9 前身（初稿）5 类结构映射" in txt
         and "**A 类 —— 功能缺口**" in txt and "**E 类 —— Authorization 缺口**" in txt)
    C.ck("R-53", "主件含 §16 owner 六问逐项（含 A–E 与 owner 六问原文）",
         "## 16. owner 六问逐项答复" in txt
         and "production read path 是否仍读取" in txt
         and "selector cutover 条件是什么" in txt)
    C.ck("R-54", "主件含证据分级关键词 S-PROMOTED / REGISTERED / NOT RE-READ / STALE",
         all(k in txt for k in ("S-PROMOTED", "REGISTERED", "NOT RE-READ", "STALE")))
    C.ck("R-55", "主件登记 N-10 误报（F-5）与回归二次事故（§13.4）",
         "F-5" in txt and "N-10" in txt and "OPERATION SCOPE DRIFT" in txt
         and "NON_SCORING" in txt)
    C.ck("R-56", "主件 §13.2 含 owner §13 红线原文",
         "RED_PROOF MUST NEVER EXECUTE REAL PRODUCTION COMMANDS" in txt
         and "isolated fake binary" in txt)
    return C


# ------------------------------------------------------------------ #
# 4. 打红自证（AST mutation + 内存变异；⛔ 不落盘、⛔ 不执行）
# ------------------------------------------------------------------ #
def redproof(case):
    ev = load_evidence()
    base = run_checks(ev)
    n_fail = sum(1 for r in base.rows if not r["ok"])
    print("[RP-0] 干净基线：%d PASS / %d FAIL" % (len(base.rows) - n_fail, n_fail))
    if n_fail:
        print("   ⇒ 基线不干净，红证无意义。FAIL 项：")
        for r in base.rows:
            if not r["ok"]:
                print("      %s %s | %s" % (r["id"], r["desc"], r["detail"]))
        return 2

    if case == "RP-A":      # AST mutation：合成源码注入（永不执行）
        bad = 0
        for cid, desc, kind, src in _MUTATION_CASES:
            hits = scan_violations(src)
            ok = any(h["kind"] == kind for h in hits)
            print("   %-5s %-42s expect=%-10s got=%-10s %s"
                  % (cid, desc, kind, [h["kind"] for h in hits], "OK" if ok else "MISS"))
            bad += 0 if ok else 1
        for cid, desc, src in _MUTATION_NEGATIVE:
            hits = scan_violations(src)
            ok = len(hits) == 0
            print("   %-5s %-42s expect=none       got=%-10s %s"
                  % (cid, desc, [h["kind"] for h in hits], "OK" if ok else "FALSEPOS"))
            bad += 0 if ok else 1
        print("[RP-A] 变异全被捕获 / 无误报 = %s" % ("YES" if bad == 0 else "NO"))
        return 0 if bad == 0 else 1

    if case == "RP-B":      # 内存变异：抹掉 apiGateway 的 legacy 读点 ⇒ R-9 必 FAIL
        ev["codeinfo"]["apiGateway"] = ev["codeinfo"]["apiGateway"].replace(
            "orderBy: [{ field: 'decision_date', direction: 'desc' }]", "orderBy: []")
        C = run_checks(ev)
        fails = [r["id"] for r in C.rows if not r["ok"]]
        print("[RP-B] 预期 R-9 FAIL；实际 FAIL = %s" % fails)
        return 0 if "R-9" in fails else 1

    if case == "RP-C":      # 内存变异：给 HTTP 探针注入 authority 键 ⇒ R-14 必 FAIL
        d = ev["api"]["dashboard"]
        d["data"]["authority"] = {"authority_selector": "active_run_pointer.run_id"}
        C = run_checks(ev)
        fails = [r["id"] for r in C.rows if not r["ok"]]
        print("[RP-C] 预期 R-14.dashboard:authority FAIL；实际 FAIL = %s" % fails)
        return 0 if "R-14.dashboard:authority" in fails else 1

    if case == "RP-D":      # 内存变异：把 candidate 的 gen1_adopted 全置 True ⇒ R-27 必 FAIL
        for r in ev["db"]["run_candidate_decision"]:
            r["gen1_adopted"] = True
        C = run_checks(ev)
        fails = [r["id"] for r in C.rows if not r["ok"]]
        print("[RP-D] 预期 R-27 FAIL；实际 FAIL = %s" % fails)
        return 0 if "R-27" in fails else 1

    if case == "RP-E":      # 内存变异：改 runtime_status.ml_effective ⇒ R-35.ml_effective 必 FAIL
        ev["api"]["constants"]["data"]["runtime_status"]["ml_effective"] = True
        C = run_checks(ev)
        fails = [r["id"] for r in C.rows if not r["ok"]]
        print("[RP-E] 预期 R-35.ml_effective FAIL；实际 FAIL = %s" % fails)
        return 0 if "R-35.ml_effective" in fails else 1

    if case == "RP-F":      # AST mutation：把本脚本自身源码变异 ⇒ R-1 必 FAIL
        orig = io.open(os.path.abspath(__file__), "r", encoding="utf-8",
                       errors="replace").read()
        try:
            mutated = orig.replace(
                "    ev = load_evidence()",
                "    import subprocess\n    subprocess.run(['tcb', 'fn', 'deploy'])\n"
                "    ev = load_evidence()", 1)
            v = scan_violations(mutated)
            print("[RP-F] 变异后扫描命中 = %s" % [h["detail"] for h in v])
            return 0 if any(h["kind"] == "CALL" for h in v) else 1
        finally:
            del mutated

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
    for r in C.rows:
        if not r["ok"]:
            n_fail += 1
            print("FAIL %-30s %s | %s" % (r["id"], r["desc"], r["detail"]))
    print("-" * 72)
    print("PASS = %d   FAIL = %d   TOTAL = %d"
          % (len(C.rows) - n_fail, n_fail, len(C.rows)))
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
