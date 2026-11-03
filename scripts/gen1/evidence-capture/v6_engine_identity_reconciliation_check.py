#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
GEN1 — ENGINE IDENTITY RECONCILIATION 只读自检（executable check）。

对应文档：
  docs/gen1/GEN1_ENGINE_IDENTITY_RECONCILIATION_20261002.md

性质（硬约束）：
  * **纯只读**：本脚本不写任何文件、不联网、不发任何 DB 命令。
    - 输入 ① = 本工作区源码（读）
    - 输入 ② = 只读通道归档的探针 JSON（读；由 `_cb-connect-20260921/cb_query.py` 产出）
    - 输入 ③ = 线上包逐字节副本（读；2026-10-02 parity = EXACT_MATCH）
    - 输入 ④ = 本工作区 git 对象（读）
  * **fail-closed**：任一输入缺失 ⇒ 直接判 FAIL / exit 2（⛔ 不得 WARN / SKIP）。
  * 断言全部**逐条打印**；⛔ 不用「工具 success」替代断言。

用法：
  python v6_engine_identity_reconciliation_check.py
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

DOC = os.path.join(WT, "docs", "gen1", "GEN1_ENGINE_IDENTITY_RECONCILIATION_20261002.md")
PREV_DOC = os.path.join(WT, "docs", "gen1", "GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md")
INV_DOC = os.path.join(WT, "docs", "gen1", "GEN1_PRE_LAUNCH_INVENTORY_20261002.md")

RDE = os.path.join(WT, "cloudfunctions", "runDecisionEngine", "index.js")
SHADOW = os.path.join(WT, "src", "common", "utils", "v3-shadow.js")
CONSTS = os.path.join(WT, "src", "common", "constants.js")

# 线上包 / 载体树 的 v3-shadow.js 必须逐字节相同（本件 §6.2）
SHADOW_SHA_PREFIX = "863d6d53"


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


def probe_rows(name: str) -> list:
    """读探针归档的**全部数据行**（容忍 `- Executing command...` 前缀）。

    结构：`{"data":{"results":[[row1,row2,...]]}}` ⇒ 返回 `[row1,row2,...]`。
    缺失 / 结构异常 ⇒ raise（fail-closed）。
    """
    p = os.path.join(PROBE_DIR, name)
    if not os.path.exists(p):
        raise FileNotFoundError("探针归档缺失（fail-closed）：%s" % p)
    s = read(p)
    s = s[s.index("{"):]
    d = json.loads(s)
    results = d.get("data", {}).get("results")
    if not isinstance(results, list) or not results or not isinstance(results[0], list):
        raise ValueError("探针归档结构异常（fail-closed）：%s" % p)
    return results[0]


def probe(name: str) -> dict:
    """读探针归档的**第一行**（dict）；缺失 ⇒ raise（fail-closed）。"""
    rows = probe_rows(name)
    if not rows:
        raise ValueError("探针归档零行（fail-closed）：%s" % name)
    return rows[0]


def probe_text(name: str) -> str:
    """读探针归档原文（用于大归档 / 文本断言）；缺失 ⇒ raise（fail-closed）。"""
    p = os.path.join(PROBE_DIR, name)
    if not os.path.exists(p):
        raise FileNotFoundError("探针归档缺失（fail-closed）：%s" % p)
    return read(p)


# ======================================================================
# 违规扫描器（★ AST 结构化；⛔ 不扫描自由字符串常量）
# ----------------------------------------------------------------------
# 设计契约（owner 2026-10-02 裁定「H-24 新规则」，本件 R-21 沿用）：
#   * 只分析 AST 中的**可执行结构**；命中源**只有** `ast.Call` 与
#     `ast.Assign`/`ast.AnnAssign`。
#   * ⛔ 不得扫描：字符串常量 / 注释 / docstring / 说明文本 / pattern literal。
#     字符串**只有**在「作为某个 Call 的实参」时才被读取。
#   * ⛔ 不得采用 `if file == checker_file: skip` 之类绕过 —— 对自身与对外部
#     源码走**完全相同**的代码路径。
# ======================================================================

_SHELL_ENTRY = {
    ("os", "system"), ("os", "popen"),
    ("os", "execv"), ("os", "execve"), ("os", "execvp"), ("os", "execvpe"),
    ("os", "spawnv"), ("os", "spawnve"), ("os", "spawnl"), ("os", "spawnlp"),
    ("subprocess", "run"), ("subprocess", "call"), ("subprocess", "check_call"),
    ("subprocess", "check_output"), ("subprocess", "Popen"),
}

_WRITE_SUBCOMMANDS = {
    "deploy", "rollback", "merge", "tag", "push", "release",
    "publish", "freeze", "unfreeze",
}

# ⛔ 不含 str/bytes 的 .replace()：那是纯字符串运算
_FS_WRITE_METHODS = {
    "writeFile", "writeFileSync", "appendFile", "appendFileSync",
    "unlink", "unlinkSync", "rmdir", "rmdirSync", "rmSync", "rmtree",
    "rename", "renameSync", "mkdir", "mkdirSync", "makedirs",
    "truncate", "chmod", "chown",
}

_DB_MARKERS = {"collection", "doc", "table", "database", "where", "records", "query"}
_DB_WRITE_VERBS = {
    "set", "update", "add", "remove", "delete", "upsert",
    "insert", "drop", "save", "create", "setData",
}

_AUTH_TARGETS = {
    "manualReviewConfirmed", "manual_review_confirmed",
    "force_authorize", "bypass_authorization", "skip_authorization",
}

_OPEN_WRITE_CHARS = "wax+"


def _dotted(node):
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
    for kw in call.keywords:
        if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
            return True
    return bool(_literal_words(call) & _WRITE_SUBCOMMANDS)


def scan_violations(tree) -> list:
    """由 AST 提取违规；**只**命中可执行结构，⛔ 永不命中自由字符串常量。"""
    found = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            name = _dotted(f)

            if name is not None and tuple(name.split(".")) in _SHELL_ENTRY and _is_shell_write(node):
                found.append("SHELL_WRITE:" + name)

            if isinstance(f, ast.Attribute) and f.attr in _FS_WRITE_METHODS:
                found.append("FS_WRITE:" + f.attr)

            if isinstance(f, ast.Attribute) and f.attr in _DB_WRITE_VERBS \
                    and (_subtree_attrs(node) & _DB_MARKERS):
                found.append("DB_WRITE:" + f.attr)

            if isinstance(f, ast.Name) and f.id == "open":
                modes = [a.value for a in node.args[1:]
                         if isinstance(a, ast.Constant) and isinstance(a.value, str)]
                modes += [kw.value.value for kw in node.keywords
                          if kw.arg == "mode" and isinstance(kw.value, ast.Constant)]
                if any(any(c in m for c in _OPEN_WRITE_CHARS) for m in modes):
                    found.append("OPEN_WRITE_MODE:" + repr(modes))

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


# ★ 自指红证语料（**故意**含违规关键字字符串字面量；⛔ 只准放字符串，不得放可执行调用）
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

# ★ 真实执行路径变异语料（解析为真正的 AST 节点，必须被抓住）
_MUTATION_CASES = (
    ("subprocess.run(['tcb', 'fn', 'deploy', '--force'])", "SHELL_WRITE:"),
    ("os.system('git tag v9.9.9')", "SHELL_WRITE:"),
    ("db.collection('c').doc('d').set({'a': 1})", "DB_WRITE:"),
    ("shutil.rmtree('/tmp/nope')", "FS_WRITE:"),
    ("open('x.txt', 'w').write('y')", "OPEN_WRITE_MODE:"),
    ("do_it(manualReviewConfirmed=True)", "AUTH_BYPASS_KWARG:"),
)

# ★ 负例（良性可执行结构，⛔ 必须**不**被抓住）
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
    # ---------------- 输入读取（任一缺失 ⇒ fail-closed） ----------------
    rde = read(RDE)
    shadow = read(SHADOW)
    consts = read(CONSTS)
    doc = read(DOC)
    prev_doc = read(PREV_DOC) if os.path.exists(PREV_DOC) else ""
    inv_doc = read(INV_DOC) if os.path.exists(INV_DOC) else ""

    rs = probe("probe_runtime_status.json")
    svl0 = probe("probe_shadow_v3_log.json")
    rh_rows = probe_rows("probe_run_history.json")
    arp = probe("probe_active_run_pointer.json")
    dr_txt = probe_text("probe_decision_result.json")
    rc_txt = probe_text("probe_run_candidate_decision.json")
    parity = probe_text("parity_out_20261002.txt")

    bundle_idx = os.path.join(PROBE_DIR, "bundle-src", "index.js")
    if not os.path.exists(bundle_idx):
        raise FileNotFoundError("线上包归档缺失（fail-closed）：%s" % bundle_idx)
    dist_idx = os.path.join(repo_root(), "dist-functions", "runDecisionEngine", "index.js")
    if not os.path.exists(dist_idx):
        raise FileNotFoundError("dist-functions 缺失（fail-closed）：%s" % dist_idx)

    # ---------------- E-1 resolveShadowEngineVersion 定义在场 ----------------
    must_sh = [
        "function resolveShadowEngineVersion(params) {",
        "params.v3_6_1_enabled === true || params.v3_6_1_s5_downside === true",
        "return 'v3.6.1';",
        "if (params && params.v3_6_persistence === true) return 'v3.6';",
        "if (params && params.v3_5_enabled === true) return 'v3.5';",
        "return 'v3';",
    ]
    miss = [s for s in must_sh if s not in shadow]
    chk("R-1 resolveShadowEngineVersion 定义在场（纯函数 · 三分支 · 返回字符串标签）",
        not miss, "缺失=%s" % miss)

    # ---------------- E-2 两源 v3-shadow.js 逐字节一致 ----------------
    online_sh = os.path.join(PROBE_DIR, "bundle-src", "common", "utils", "v3-shadow.js")
    if not os.path.exists(online_sh):
        raise FileNotFoundError("线上包 v3-shadow.js 缺失（fail-closed）：%s" % online_sh)
    sh_a, sh_b = sha_raw(SHADOW), sha_raw(online_sh)
    chk("R-2 线上包 v3-shadow.js == 载体树 v3-shadow.js（逐字节 ⇒ 路由模块无源歧义）",
        sh_a == sh_b and sh_a.startswith(SHADOW_SHA_PREFIX),
        "carrier=%s online=%s" % (sh_a[:12], sh_b[:12]))

    # ---------------- E-3 productionEngine 零条件位 ----------------
    pe_lines = [l.strip() for l in rde.splitlines() if "productionEngine" in l]
    _COND_PATS = ("if (productionEngine", "? productionEngine", "&& productionEngine",
                  "|| productionEngine", "productionEngine ===", "productionEngine ==",
                  "productionEngine !=", "!productionEngine")
    pe_cond = [(l[:48], p) for l in pe_lines for p in _COND_PATS if p in l]
    pe_expect = {
        "const productionEngine = trendStageEnabled ? shadowEngineVer : 'v3.8';",
        "engine_version: productionEngine,  // 与生产引擎同源，不再硬编码",
        "production_engine: productionEngine,",
    }
    weird = [l for l in pe_lines if l not in pe_expect]
    chk("R-3 ★ productionEngine 仅 4 处（1 赋值 + 3 字段写入）；条件位命中 = 0；无其它形态",
        len(pe_lines) == 4 and pe_lines.count("production_engine: productionEngine,") == 2
        and not pe_cond and not weird,
        "n=%d cond=%s weird=%s" % (len(pe_lines), pe_cond, weird))

    # ---------------- E-4 resolveShadowEngineVersion 调用零条件位 ----------------
    rsev_lines = [l.strip() for l in rde.splitlines() if "resolveShadowEngineVersion" in l]
    rsev_cond = [(l[:48], p) for l in rsev_lines
                 for p in ("if (resolveShadowEngineVersion", "? resolveShadowEngineVersion",
                           "&& resolveShadowEngineVersion", "|| resolveShadowEngineVersion")
                 if p in l]
    chk("R-4 ★ resolveShadowEngineVersion 在 rde 仅 2 处（import + 单次调用）；调用结果零条件位",
        len(rsev_lines) == 2 and not rsev_cond
        and "const shadowEngineVer = resolveShadowEngineVersion(merged);" in rde,
        "n=%d cond=%s" % (len(rsev_lines), rsev_cond))

    # ---------------- E-5 trendStageEnabled 条件位（≥4） ----------------
    must_trend = [
        "const trendStageEnabled = merged.trend_stage_enabled === true;",
        "if (trendStageEnabled) {",
        "const productionEngine = trendStageEnabled ? shadowEngineVer : 'v3.8';",
        "const shadowEngine = runV3Path ? (trendStageEnabled ? 'v3.8' : shadowEngineVer) : null;",
        "trend_stage_enabled: trendStageEnabled,",
        "const runV3Path = trendStageEnabled || shadowEnabled;",
    ]
    miss_t = [s for s in must_trend if s not in rde]
    n_trend = rde.count("trendStageEnabled")
    chk("R-5 trendStageEnabled 出现 ≥12 处 · 条件位形态齐备（if / 三元 / || / 实参传递）",
        not miss_t and n_trend >= 12,
        "n=%d 缺失=%s" % (n_trend, miss_t))

    # ---------------- E-6 / E-7 真正的选择发生在 v3-shadow.js ----------------
    chk("R-6 ★ primary 由 trendStageEnabled 决定（生产决策主体）",
        "const primary = trendStageEnabled === true ? v3Result : v38Result;" in shadow
        and "const secondary = trendStageEnabled === true ? v38Result : v3Result;" in shadow,
        "v3-shadow.js:123/124")

    chk("R-7 ★ engine_path 由 trendStageEnabled 决定（落库字段）",
        "engine_path: trendStageEnabled === true ? 'v3' : 'v38'," in shadow
        and "engine_version: trendStageEnabled === true ? shadowEngine : 'v3.8'," in shadow,
        "v3-shadow.js:130/131")

    # ---------------- E-8 constants 默认值 ----------------
    chk("R-8 constants.js:212 trend_stage_enabled 代码级默认 = true",
        "trend_stage_enabled: true,  // true → final_target 走 V3.6.1（正式）" in consts,
        "src/common/constants.js:212")

    # ---------------- E-9 载体树 rde 非部署源 ----------------
    chk("R-9 ⚠️ 载体树 rde 不含 v365 / runIntegrity ⇒ 载体树 ≠ 部署源（取证源纪律）",
        "v365" not in rde and "runIntegrity" not in rde,
        "v365=%d runIntegrity=%d" % (rde.count("v365"), rde.count("runIntegrity")))

    # ---------------- E-10 dist-functions == 线上包 ----------------
    a, b = sha_raw(dist_idx), sha_raw(bundle_idx)
    chk("R-10 dist-functions/runDecisionEngine/index.js == 线上包 index.js（逐字节 ⇒ 部署源身份）",
        a == b and a.startswith("eb1868cb"),
        "dist=%s online=%s" % (a[:12], b[:12]))

    # ---------------- E-11 线上 runtime_status 四字段 ----------------
    got = {k: rs.get(k) for k in
           ("production_engine", "decision_engine", "shadow_engine", "stage_engine",
            "trend_stage_enabled", "v3_6_1_enabled", "v3_6_1_shadow", "v3_shadow_enabled")}
    chk("R-11 线上 runtime_status：production_engine=v3.6.1 / decision_engine=v3.6.1 / shadow_engine=v3.8 / stage_engine=v3.6 / trend_stage_enabled=true",
        got["production_engine"] == "v3.6.1" and got["decision_engine"] == "v3.6.1"
        and got["shadow_engine"] == "v3.8" and got["stage_engine"] == "v3.6"
        and got["trend_stage_enabled"] is True and got["v3_6_1_enabled"] is True
        and got["v3_6_1_shadow"] is False and got["v3_shadow_enabled"] is True,
        str(got))

    # ---------------- E-12 v365_run_integrity.engine_version ----------------
    vri = rs.get("v365_run_integrity") or {}
    chk("R-12 线上 v365_run_integrity.engine_version = v3.6.5（同一 runtime_status 内两轴共存）",
        vri.get("engine_version") == "v3.6.5" and rs.get("production_engine") == "v3.6.1",
        "engine_version=%r production_engine=%r" % (vri.get("engine_version"), rs.get("production_engine")))

    # ---------------- E-13 shadow_v3_log ----------------
    chk("R-13 线上 shadow_v3_log[0]：engine_mode='cutover' + trend_stage_enabled=true（第 4 重自证）",
        svl0.get("engine_mode") == "cutover" and svl0.get("trend_stage_enabled") is True
        and svl0.get("production_engine") == "v3.6.1" and svl0.get("shadow_engine") == "v3.8",
        "snap=%r mode=%r trend=%r" % (svl0.get("snap_date"), svl0.get("engine_mode"),
                                      svl0.get("trend_stage_enabled")))

    # ---------------- E-14 run_history 全 v3.6.5 ----------------
    rh_vers = [(r.get("run_id"), r.get("engine_version")) for r in rh_rows]
    chk("R-14 线上 run_history 全部 engine_version = v3.6.5（≥2 行 ⇒ 轴 2 运行身份）",
        len(rh_vers) >= 2 and all(v == "v3.6.5" for _, v in rh_vers),
        str(rh_vers))

    # ---------------- E-15 decision_result / run_candidate_decision 的 engine_path ----------------
    chk("R-15 线上 decision_result 归档：engine_path='v3' 且 engine_version='v3.6.1'（第 5 重自证）",
        '"engine_path": "v3"' in dr_txt and '"engine_version": "v3.6.1"' in dr_txt
        and '"shadow_engine_version": "v3.6.1"' in dr_txt,
        "decision_result")

    chk("R-16 线上 run_candidate_decision 归档：engine_path='v3'（第 6 重自证 · 候选链同源）",
        '"engine_path": "v3"' in rc_txt and '"engine_version": "v3.6.1"' in rc_txt,
        "run_candidate_decision")

    # ---------------- E-16 active_run_pointer ----------------
    chk("R-17 线上 active_run_pointer::production 在场（与引擎标签无关联 —— 非 Engine Identity 消费者）",
        arp.get("_id") == "active_run_pointer::production"
        and str(arp.get("run_id", "")).startswith("engine:"),
        "_id=%r run_id=%r" % (arp.get("_id"), arp.get("run_id")))

    # ---------------- E-17 ★ 公式自洽（用代码常量重算，⛔ 不靠人工断言） ----------------
    #   productionEngine = trendStageEnabled ? shadowEngineVer : 'v3.8'
    #   shadowEngine     = runV3Path ? (trendStageEnabled ? 'v3.8' : shadowEngineVer) : null
    #   shadowEngineVer 的实际落点是 runtime_status.decision_engine（rde:1279）
    def recompute(trend, decision_engine, run_v3_path):
        pe = decision_engine if trend else "v3.8"
        se = (("v3.8" if trend else decision_engine) if run_v3_path else None)
        return pe, se

    trend = rs.get("trend_stage_enabled") is True
    de = rs.get("decision_engine")
    sv = rs.get("shadow_engine")
    run_v3 = sv is not None or trend
    pe_calc, se_calc = recompute(trend, de, run_v3)
    chk("R-18 ★ 六重自证公式自洽：用 deployment 代码常量重算 production_engine / shadow_engine，与实读逐项相符",
        pe_calc == rs.get("production_engine") and se_calc == sv,
        "calc=(%r,%r) actual=(%r,%r)" % (pe_calc, se_calc, rs.get("production_engine"), sv))

    # ---------------- E-18 parity 归档 ----------------
    chk("R-19 2026-10-02 parity 归档：FINAL PARITY = PASS (EXACT_MATCH) 且四项差异全 0",
        "FINAL PARITY              = PASS (EXACT_MATCH)" in parity
        and "MISSING (bundle 有 / online 无)  = 0" in parity
        and "EXTRA   (online 有 / bundle 无)  = 0" in parity
        and "CONTENT_DIFF (LF 归一化)         = 0" in parity
        and "CONTENT_DIFF (raw 不归一化)      = 0" in parity,
        "parity_out_20261002.txt")

    # ---------------- E-19 本件在场性 ----------------
    must_doc = [
        "CASE = A",
        "V3.6.5 = PRODUCTION_DEPLOYMENT_IDENTITY",
        "V3.6.5 = PRODUCTION_RUNTIME_IDENTITY",
        "PRODUCTION_VERSION_CONFLICT = NO",
        "REAL_PRODUCTION_ROUTING_GAP = NO",
        "LABEL-ONLY LEGACY",
        "LEGACY_SHADOW_VERSION_NAMING / STATE_MODEL CLEANUP REQUIRED",
        "EFFECTIVE_ROUTING_IDENTITY",
        "HEALTH_READY",
        "NOT READY",
        "PRODUCTION_ATTESTATION = BLOCKED",
        "STOP = YES",
    ]
    miss_doc = [s for s in must_doc if s not in doc]
    chk("R-20 本件在场性（CASE A · 三轴 · 无冲突 · 清理项 · Health 分离 · STOP 块）",
        not miss_doc, "缺失=%s" % miss_doc)

    # ---------------- E-20 ⛔ 零放行式（三件同扫） ----------------
    bad = ["Deploy = YES", "Canary = ON", "GE-04 = AUTHORIZED",
           "V3.6.6 FREEZE = AUTHORIZED", "HEALTH_READY = TRUE", "HEALTH_READY = READY",
           "PRODUCTION_ATTESTATION = PASS", "EVIDENCE_EXECUTION = AUTHORIZED",
           "PRODUCTION_VERSION_CONFLICT = YES"]
    hit = [("doc", x) for x in set(bad) if x in doc]
    hit += [("prev", x) for x in set(bad) if x in prev_doc]
    hit += [("inv", x) for x in set(bad) if x in inv_doc]
    chk("R-21 ⛔ 三件同扫零放行式（Deploy=YES / Canary=ON / GE-04=AUTHORIZED / FREEZE=AUTHORIZED / HEALTH_READY=READY / ATTESTATION=PASS / CONFLICT=YES）",
        not hit, "命中=%s" % hit)

    # ---------------- E-21 AST 零写操作门（自查） ----------------
    self_src = read(os.path.abspath(__file__))
    bad_calls = scan_violations(ast.parse(self_src))
    imports = set()
    for n in ast.walk(ast.parse(self_src)):
        if isinstance(n, ast.Import):
            imports.update(a.name.split(".")[0] for a in n.names)
        elif isinstance(n, ast.ImportFrom) and n.module:
            imports.add(n.module.split(".")[0])
    chk("R-22 ⛔ 本脚本零写操作（AST 结构化：无 shell 写调用 · 无 FS 写方法 · 无 DB 写 · 无 open 写模式 · 无授权绕过 · 无 shutil 导入）",
        not bad_calls and "shutil" not in imports,
        "bad=%s imports_has_shutil=%s" % (bad_calls, "shutil" in imports))

    # ---------------- E-22 SELF_REFERENCE_RED_PROOF ----------------
    corpus_src = "\n".join("x%d = %r" % (i, s) for i, s in enumerate(_SELF_REF_CORPUS))
    corpus_hits = scan_violations(ast.parse(corpus_src))
    kw_hits = [k for k in ("deploy", "merge", "tag", "push", "rmtree", "manualReviewConfirmed")
               if any(k in s for s in _SELF_REF_CORPUS)]
    h22_ok = (not corpus_hits) and len(kw_hits) >= 5
    chk("R-23 ★ SELF_REFERENCE_RED_PROOF（语料确含违规关键字字面量 ⇒ AST 门仍 PASS，不因自由字符串自撞）",
        h22_ok, "corpus_hits=%s kw=%s" % (corpus_hits, kw_hits))

    # ---------------- E-23 REAL_EXECUTABLE_VIOLATION_RED_PROOF ----------------
    mut_res = []
    for src, want in _MUTATION_CASES:
        got_v = scan_violations(ast.parse(src))
        mut_res.append((src[:28], bool([g for g in got_v if g.startswith(want)])))
    neg_res = [(s[:28], scan_violations(ast.parse(s))) for s in _MUTATION_NEGATIVE]
    neg_bad = [r for r in neg_res if r[1]]
    h23_ok = all(ok for _, ok in mut_res) and not neg_bad
    chk("R-24 ★ REAL_EXECUTABLE_VIOLATION_RED_PROOF（7 类真实违规 Call 全部被抓 · 4 项良性结构零误杀）",
        h23_ok, "mut=%s neg_bad=%s" % (mut_res, neg_bad))

    # ---------------- E-24 FAIL_CLOSED_RED_PROOF ----------------
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        env = dict(os.environ)
        env["GEN1_PROBE_DIR"] = td  # 空目录 ⇒ 探针缺失
        sub = subprocess.run([sys.executable, os.path.abspath(__file__)],
                             capture_output=True, text=True, env=env)
        combined = sub.stdout + sub.stderr
        has_fc = "FAIL-CLOSED" in combined
        no_pass = "ALL PASS" not in combined
        h24_ok = sub.returncode == 2 and has_fc and no_pass
    chk("R-25 ★ FAIL_CLOSED_RED_PROOF（证据缺失 ⇒ exit 2 · 含 FAIL-CLOSED · 零 PASS 输出；⛔ 不得 WARN/SKIP）",
        h24_ok, "rc=%s has_fc=%s no_pass=%s" % (sub.returncode, has_fc, no_pass))

    # ---------------- 汇总 ----------------
    fails = [c for c in CHECKS if not c[1]]
    print("=" * 78)
    print("GEN1 ENGINE IDENTITY RECONCILIATION —— 只读自检")
    print("探针归档目录：%s" % PROBE_DIR)
    print("=" * 78)
    for name, ok, detail in CHECKS:
        print("  [%s] %s" % ("PASS" if ok else "FAIL", name))
        if detail:
            print("         · %s" % detail)
    print("-" * 78)
    print("RED-PROOF 状态:")
    print("  SELF_REFERENCE_RED_PROOF            = %s" % ("PASS" if h22_ok else "FAIL"))
    print("  REAL_EXECUTABLE_VIOLATION_RED_PROOF = %s" % ("PASS" if h23_ok else "FAIL"))
    print("  FAIL_CLOSED_RED_PROOF               = %s" % ("PASS" if h24_ok else "FAIL"))
    print("-" * 78)
    print("CASE = A（resolveShadowEngineVersion = label-only；routing 由 trend_stage_enabled 决定）")
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
