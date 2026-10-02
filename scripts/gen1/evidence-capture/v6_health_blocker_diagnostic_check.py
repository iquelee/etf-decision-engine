#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
GEN1 — HEALTH / PRODUCTION ATTESTATION BLOCKER DIAGNOSTIC 只读自检（executable check）。

对应文档：
  docs/gen1/GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md

性质（硬约束）：
  * **纯只读**：本脚本不写任何文件、不联网、不发任何 DB 命令。
    - 输入 ① = 本工作区源码（读）
    - 输入 ② = 只读通道归档的探针 JSON（读；由 `_cb-connect-20260921/cb_query.py` 产出）
    - 输入 ③ = 本工作区 git 对象（读）
  * **fail-closed**：任一输入缺失 ⇒ 直接判 FAIL（⛔ 不得静默跳过）。
  * 断言全部**逐条打印**；⛔ 不用「工具 success」替代断言。

用法：
  python v6_health_blocker_diagnostic_check.py
  可选环境变量：GEN1_PROBE_DIR  覆盖探针归档目录
"""
from __future__ import annotations

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

DOC = os.path.join(WT, "docs", "gen1", "GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md")
PREP = os.path.join(WT, "docs", "gen1", "GEN1_V366_FREEZE_ATTESTATION_GATE_PREP_20261002.md")

# 三绑定对象 + Seal + Key 2（sha256lf / raw 口径见证据契约 §6.5）
OBJ_CONTRACT = os.path.join(WT, "docs", "gen1", "GEN1_EVIDENCE_CONTRACT_V6.md")
OBJ_CAPTURE = os.path.join(WT, "scripts", "gen1", "evidence-capture", "c1_capture.py")
OBJ_REDPROOF = os.path.join(WT, "scripts", "gen1", "evidence-capture", "c1_gate_redproof.py")
OBJ_SEAL = os.path.join(WT, "docs", "gen1", "artifacts", "GEN1_EVIDENCE_FREEZE_SEAL_V6.json")
OBJ_KEY2 = os.path.join(WT, "ml", "manifests", "GEN1_GUARDED_EFFECTIVE_FREEZE.json")

SHA256LF = {
    OBJ_CONTRACT: "7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e",
    OBJ_CAPTURE: "d0acc9e427f6ce52de903abd40ef41c76e87f7e5ba3441dea92f6a3d013a4337",
    OBJ_REDPROOF: "e795c93445802249e8c33a29e9b01120833079fd7b38d9a660ea22ed590caba0",
}
RAW_SEAL = "a585a33a25cd1fe4b508fc6ce0d1e69f324000cc49f96584865c4811f46a7b62"
RAW_KEY2 = "35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5"


def sha256lf(path: str) -> str:
    b = open(path, "rb").read()
    return hashlib.sha256(b.replace(b"\r\n", b"\n").replace(b"\r", b"\n")).hexdigest()


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


def probe(name: str):
    """读探针归档（容忍 `- Executing command...` 前缀）；缺失 ⇒ raise（fail-closed）。"""
    p = os.path.join(PROBE_DIR, name)
    if not os.path.exists(p):
        raise FileNotFoundError("探针归档缺失（fail-closed）：%s" % p)
    s = read(p)
    s = s[s.index("{"):]
    d = json.loads(s)
    rows = d.get("data", {}).get("results", [[]])
    return rows[0] if rows else []


def doc_or_empty(path: str) -> str:
    return read(path) if os.path.exists(path) else ""


CHECKS = []


def chk(name, cond, detail=""):
    CHECKS.append((name, bool(cond), detail))


def main() -> int:
    cb = read(os.path.join(WT, "src", "common", "utils", "gen1-circuit-breaker.js"))
    hs = read(os.path.join(WT, "src", "common", "utils", "gen1-health-state.js"))
    dh = read(os.path.join(WT, "src", "common", "utils", "gen1-data-health.js"))
    vs = read(os.path.join(WT, "src", "common", "utils", "v3-shadow.js"))
    rde = read(os.path.join(WT, "cloudfunctions", "runDecisionEngine", "index.js"))
    shd = read(os.path.join(WT, "cloudfunctions", "runGen1ShadowEod", "index.js"))
    adm = read(os.path.join(WT, "cloudfunctions", "adminGateway", "index.js"))
    doc = doc_or_empty(DOC)
    prep = doc_or_empty(PREP)

    # ---------- H-1 HEALTH 枚举与标签 ----------
    chk("H-1 circuit-breaker HEALTH 枚举含 DEGRADED，标签 = 降级（禁止灰度）",
        "DEGRADED: '降级（禁止灰度）'" in cb and "HEALTH_LABEL" in cb,
        "gen1-circuit-breaker.js")

    # ---------- H-2 circuitGate(DEGRADED) ----------
    chk("H-2 circuitGate 语义：DEGRADED ⇒ allow_canary=false 且 requires_manual_review_to_restore=true",
        "allowCanary = false;" in cb
        and "requires_manual_review_to_restore: (h === HEALTH.DEGRADED || h === HEALTH.ML_OFF)" in cb,
        "gen1-circuit-breaker.js:93-110")

    # ---------- H-3 computeHealthStatus 输入轴 ----------
    chk("H-3 dataHealth=DEGRADED ⇒ 判 DEGRADED；economicHealth='PENDING' 单独不参与判定",
        "if (x.dataHealth === 'DEGRADED') status = worst(status, HEALTH.DEGRADED);" in cb
        and "x.economicHealth === 'DEGRADED'" in cb
        and "PENDING" in cb and "不参与" in cb,
        "gen1-circuit-breaker.js:62,66,64 注释")

    # ---------- H-4 禁止 auto reopen（核心 fail-closed） ----------
    chk("H-4 wasDown && nowUp 且无 manualReviewConfirmed ⇒ 保持 latch（recovery_rejected）",
        "if (wasDown && nowUp) {" in hs
        and "if (o.manualReviewConfirmed === true) {" in hs
        and "state.latched_health = prevLatched;" in hs
        and "recoveryRejected = true;" in hs,
        "gen1-health-state.js:137-153")

    # ---------- H-5 人工复核可恢复 ----------
    chk("H-5 manualReviewConfirmed === true ⇒ 才允许升回（reviewed_at/reviewed_by/recovery_allowed 置位）",
        "state.recovery_allowed = true;" in hs
        and "state.reviewed_at = now;" in hs
        and "state.reviewed_by = o.reviewedBy || 'manual';" in hs,
        "gen1-health-state.js:138-146")

    # ---------- H-6 manualReviewConfirmed 无生产调用方 ----------
    prod_hits = []
    for root in ("src", "cloudfunctions"):
        for dirpath, _dirs, files in os.walk(os.path.join(WT, root)):
            for f in files:
                if not f.endswith(".js"):
                    continue
                fp = os.path.join(dirpath, f)
                s = read(fp)
                if "manualReviewConfirmed" in s:
                    prod_hits.append(os.path.relpath(fp, WT))
    only_def = all(p.endswith(os.path.join("utils", "gen1-circuit-breaker.js"))
                   or p.endswith(os.path.join("utils", "gen1-health-state.js"))
                   for p in prod_hits)
    chk("H-6 manualReviewConfirmed **无生产调用方**（生产目录命中仅限定义/消费点）",
        len(prod_hits) > 0 and only_def,
        "命中=" + ",".join(sorted(prod_hits)))

    # ---------- H-7 adminGateway 只有 GET（无恢复端点） ----------
    chk("H-7 adminGateway 仅 GET /api/admin/gen1/health；无恢复端点、无 manualReviewConfirmed",
        adm.count("'/api/admin/gen1/health'") == 1
        and "getGen1Health()" in adm
        and "manualReviewConfirmed" not in adm
        and "manual_review_confirmed" not in adm,
        "adminGateway/index.js:1107-1108")

    # ---------- H-8 轴 B 机制：参数推导 ----------
    chk("H-8 resolveShadowEngineVersion 由参数推导（v3_6_1_enabled ⇒ 'v3.6.1'），与部署身份无关",
        "function resolveShadowEngineVersion(params)" in vs
        and "params.v3_6_1_enabled === true" in vs
        and "return 'v3.6.1';" in vs
        and "production_engine: productionEngine," in rde,
        "v3-shadow.js:74-81 · runDecisionEngine/index.js:1277/1358")

    # ---------- H-9 数据健康根因链 ----------
    chk("H-9 根因链：runGen1ShadowEod 聚合 worstData → computeHealthStatus → computeLatchedState → writeHealthState",
        "evaluateDataHealth({" in shd
        and "{ runtimeDataHealth: worstData }" in shd
        and "dataHealth: worstData" in shd
        and "writeHealthState(db, latched.state, COLLECTIONS)" in shd,
        "runGen1ShadowEod/index.js:174-193")

    chk("H-10 DATA_DEGRADED 定义 = 个别统计缺失（STATISTICAL_MISSING），允许 advisory / 禁止 canary",
        "STATUS.DATA_DEGRADED, REASON.STATISTICAL_MISSING" in dh
        and "禁止 canary" in dh,
        "gen1-data-health.js:116-120")

    # ---------- H-11 线上归档：轴 A / 轴 B 共存（自证） ----------
    rs = probe("probe_runtime_status.json")
    if not isinstance(rs, list):
        rs = [rs]
    rs = rs[0] if rs else {}
    ri = rs.get("v365_run_integrity") or {}
    chk("H-11 同一 runtime_status 内 production_engine='v3.6.1' 与 v365_run_integrity.engine_version='v3.6.5' **共存**",
        rs.get("production_engine") == "v3.6.1" and ri.get("engine_version") == "v3.6.5",
        "production_engine=%r engine_version=%r" % (rs.get("production_engine"), ri.get("engine_version")))

    # ---------- H-12 线上归档：run 轴自报 v3.6.5 ----------
    rh = probe("probe_run_history.json")
    rm = probe("probe_run_manifest.json")
    rh = rh if isinstance(rh, list) else [rh]
    rm = rm if isinstance(rm, list) else [rm]
    rh_v = {d.get("engine_version") for d in rh if isinstance(d, dict)}
    chk("H-12 run_history / run_manifest 全部自报 engine_version='v3.6.5'（V3.6.5 引入的 run 轴）",
        len(rh) >= 1 and rh_v == {"v3.6.5"} and len(rm) >= 1 and all(
            isinstance(d, dict) and d.get("run_id") for d in rm),
        "run_history 行=%d 版本=%s" % (len(rh), sorted(rh_v)))

    # ---------- H-13 闩锁文档（实时归档） ----------
    hst = probe("probe_gen1_health_state.json")
    hst = hst[0] if isinstance(hst, list) and hst and isinstance(hst[0], dict) else (
        hst if isinstance(hst, dict) else {})
    chk("H-13 闩锁 gen1_health_state：latched=DEGRADED · reviewed_at/by=null · recovery_allowed=false · read_reason_code=null",
        hst.get("key") == "gen1-health-state"
        and hst.get("latched_health") == "DEGRADED"
        and hst.get("current_health") == "DEGRADED"
        and hst.get("reviewed_at") is None and hst.get("reviewed_by") is None
        and hst.get("recovery_allowed") is False
        and hst.get("read_reason_code") is None
        and hst.get("manual_review_required") is True,
        "probe_gen1_health_state.json")

    chk("H-14 闩锁驱动输入：runtime_data_health='DEGRADED'（真因字段）；economic_health='PENDING'（不参与）",
        hst.get("runtime_data_health") == "DEGRADED"
        and hst.get("economic_health") == "PENDING"
        and hst.get("degraded_at") == "2026-09-21T14:20:27.241Z",
        "degraded_at=%r" % hst.get("degraded_at"))

    # ---------- H-15 runtime_status 派生位一致 ----------
    chk("H-15 runtime_status 派生位：status=DEGRADED · gate_status=ACTIVE · source=LATCH · manual_review_required=true · read_reason_code=null",
        rs.get("gen1_health_status") == "DEGRADED"
        and rs.get("gen1_health_gate_status") == "ACTIVE"
        and rs.get("gen1_health_source") == "GEN1_HEALTH_STATE_LATCH"
        and rs.get("gen1_health_manual_review_required") is True
        and rs.get("gen1_health_read_reason_code") is None,
        "71 键单例")

    chk("H-16 下游派生位一致：counterfactual_canary_health_allowed=false · guarded_effective_health_allowed=false",
        rs.get("gen1_counterfactual_canary_health_allowed") is False
        and rs.get("gen1_guarded_effective_health_allowed") is False
        and rs.get("gen1_counterfactual_canary_active") is False
        and rs.get("gen1_allow_canary") is False,
        "canary 被健康门阻断")

    # ---------- H-17 根因标的定位（515880） ----------
    ms = probe("probe_ml_shadow_signal.json")
    ms = [d for d in (ms if isinstance(ms, list) else [ms]) if isinstance(d, dict)]
    dates = sorted({d.get("date") for d in ms if d.get("date")})
    latest = dates[-1] if dates else None
    latest_rows = [d for d in ms if d.get("date") == latest]
    health_of = {}
    for d in latest_rows:
        v = d.get("data_health_status", d.get("data_health", d.get("dataHealth")))
        health_of[d.get("code")] = v
    chk("H-17 根因标的：最新交易日 515880=DATA_DEGRADED，且存在 DATA_OK 标的（⇒ worstData 由其单点驱动）",
        latest is not None
        and health_of.get("515880") == "DATA_DEGRADED"
        and any(v == "DATA_OK" for v in health_of.values()),
        "date=%s data_health=%s" % (latest, health_of))

    # ---------- H-18 HEALTH_READY 公式对当前实读值 = FALSE，且未满足项 == {B,D,E,H} ----------
    A = rs.get("gen1_health_gate_status") == "ACTIVE"          # FOUND 代理（PENDING/READ_ERROR 均非 ACTIVE）
    B = hst.get("latched_health") == "OK"
    C = rs.get("gen1_health_gate_status") == "ACTIVE"
    D = hst.get("manual_review_required") is False
    E = (hst.get("recovery_allowed") is True
         and hst.get("reviewed_at") is not None and hst.get("reviewed_by") is not None)
    F = rs.get("gen1_health_status") == hst.get("latched_health")
    G = rs.get("gen1_health_source") == "GEN1_HEALTH_STATE_LATCH"
    H = rs.get("gen1_counterfactual_canary_health_allowed") is True
    unmet = sorted([n for n, v in zip("ABCDEFGH", [A, B, C, D, E, F, G, H]) if not v])
    health_ready = all([A, B, C, D, E, F, G, H])
    chk("H-18 HEALTH_READY(now) == FALSE，且未满足项集合 == {B,D,E,H}",
        health_ready is False and unmet == ["B", "D", "E", "H"],
        "HEALTH_READY=%s unmet=%s" % (health_ready, unmet))

    # ---------- H-19 文档在场性 ----------
    must_doc = [
        "GEN1 — HEALTH / PRODUCTION ATTESTATION BLOCKER DIAGNOSTIC",
        "X-1 — Evidence Contract 归属 → **CLOSED**",
        "X-2 — R1 / R2 → **CLOSED**",
        "X-3 — W2 checkpoint → **CLOSED**",
        "X-4 — Freeze 制品形态 → **DECIDED**",
        "X-5 — Main branch reachability → **PENDING**",
        "X-6 — Production Health / DEGRADED → **BLOCKED / DIAGNOSIS REQUIRED**",
        "X-7 — Safety-wall evidence → **CLOSED**",
        "H1/H2_REQUIRED_EVIDENCE = FINAL 29/29 VERSION",
        "HEALTH_READY(now) ==",
        "AUTHORIZATION GATE",
        "ERRATA-1",
        "STATISTICAL_MISSING",
        "CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5",
        "HISTORICAL / SUPERSEDED",
    ]
    miss = [s for s in must_doc if s not in doc]
    chk("H-19 本件在场性（X-1…X-7 标题 · 29/29 · HEALTH_READY 式 · AUTHORIZATION GATE · ERRATA-1 · STATISTICAL_MISSING · 台账身份 · V5 标记）",
        not miss, "缺失=%s" % miss)

    # ---------- H-20 准备件已就地勘误 ----------
    chk("H-20 准备件 §2 第 9 行已带 ERRATA-1 就地标记（原文字保留）",
        "ERRATA-1" in prep
        and "V3.6.5 / V3.6.6 候选均未部署" in prep
        and "GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md" in prep,
        "prep §2 第 9 行")

    # ---------- H-21 ⛔ 零命中：无放行式 ----------
    bad = ["Deploy = YES", "Deploy = YES", "Canary = ON", "GE-04 = AUTHORIZED",
           "V3.6.6 FREEZE = AUTHORIZED", "HEALTH_READY = TRUE", "HEALTH_READY = READY"]
    hit = [b for b in set(bad) if b in doc]
    chk("H-21 ⛔ 本件零放行式（Deploy=YES / Canary=ON / GE-04=AUTHORIZED / V3.6.6 FREEZE=AUTHORIZED / HEALTH_READY=TRUE）",
        not hit, "命中=%s" % hit)

    # ---------- H-22 ⛔ .gitattributes 不存在 ----------
    main_root = repo_root()
    gattrs = [os.path.join(WT, ".gitattributes"), os.path.join(main_root, ".gitattributes")]
    chk("H-22 ⛔ .gitattributes 不存在（worktree / 主仓）⇒ 仓库级换行配置未改",
        not any(os.path.exists(p) for p in gattrs), "checked=%s" % gattrs)

    # ---------- H-23 ⛔ 三对象 / Seal / Key 2 未变 ----------
    got_lf = {p: sha256lf(p) for p in SHA256LF}
    ok_lf = all(got_lf[p] == v for p, v in SHA256LF.items())
    chk("H-23 三绑定对象 sha256lf 与绑定值逐位相同 · Seal 未重写 · Key 2 raw 未变",
        ok_lf and sha_raw(OBJ_SEAL) == RAW_SEAL and sha_raw(OBJ_KEY2) == RAW_KEY2,
        "lf_ok=%s seal=%s key2=%s" % (ok_lf, sha_raw(OBJ_SEAL)[:12], sha_raw(OBJ_KEY2)[:12]))

    # ---------- H-24 ⛔ 本脚本自身零写操作（★ 用 AST，避免自指悖论） ----------
    # 说明：不得用「源码子串」判定 —— 检查代码自身的字符串字面量会命中自己（自指悖论）。
    #       故改为 AST 结构化扫描：只看真正被调用的名字/属性 + import 集合。
    import ast  # noqa: PLC0415

    self_src = read(os.path.abspath(__file__))
    tree = ast.parse(self_src)
    bad_calls = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if isinstance(f, ast.Name) and f.id == "open":
            modes = []
            for a in node.args[1:]:
                if isinstance(a, ast.Constant) and isinstance(a.value, str):
                    modes.append(a.value)
            for kw in node.keywords:
                if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                    modes.append(str(kw.value.value))
            if any(any(c in m for c in "wax+") for m in modes):
                bad_calls.append("open(mode=%r)" % modes)
        # 仅列**文件系统/DB 写语义**方法名；⛔ 不含 str/bytes 的 .replace()（那是纯字符串运算）
        if isinstance(f, ast.Attribute) and f.attr in (
                "remove", "unlink", "rmtree", "rename", "mkdir", "makedirs",
                "upsert", "insert", "delete", "drop", "writeFile", "writeFileSync"):
            bad_calls.append("call .%s()" % f.attr)
    imports = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imports.update(a.name.split(".")[0] for a in n.names)
        elif isinstance(n, ast.ImportFrom) and n.module:
            imports.add(n.module.split(".")[0])
    str_consts = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    # ⛔ 拆字构造：任何「检查代码自身」的哨兵都必须避开自指 ——
    #    若把哨兵写成字面量，该字面量本身就会命中（本项目已两次实撞）。
    _CLI_SENTINEL = "t" + "cb"
    chk("H-24 ⛔ 本脚本零写操作（AST 扫描：无 open 写模式 · 无写/删方法调用 · 无 shutil 导入 · 无 CLI 工具字样常量）",
        not bad_calls and "shutil" not in imports and _CLI_SENTINEL not in str_consts,
        "bad_calls=%s imports_has_shutil=%s" % (bad_calls, "shutil" in imports))

    # ---------- 汇总 ----------
    fails = [c for c in CHECKS if not c[1]]
    print("=" * 78)
    print("GEN1 HEALTH / PRODUCTION ATTESTATION BLOCKER DIAGNOSTIC —— 只读自检")
    print("探针归档目录：%s" % PROBE_DIR)
    print("=" * 78)
    for name, ok, detail in CHECKS:
        print("  [%s] %s" % ("PASS" if ok else "FAIL", name))
        if detail:
            print("         · %s" % detail)
    print("-" * 78)
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
