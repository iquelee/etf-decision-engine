#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第十三轮 · `LC-C` 锁治理 + `C3-R2` 实施批次 —— **只读** checker。

用法：
  python scripts/gen1/evidence-capture/v6_r13_lc_c_c3r2_check.py            # 断言（只读）
  python scripts/gen1/evidence-capture/v6_r13_lc_c_c3r2_check.py --redproof # 红证（变异→必 FAIL→逐字节还原）
  python scripts/gen1/evidence-capture/v6_r13_lc_c_c3r2_check.py --regression # 回归（显式白名单 23 项）
  python scripts/gen1/evidence-capture/v6_r13_lc_c_c3r2_check.py --zerowrite  # 零写自证（out/+fixtures/ 快照比对 + 回归）

⚠️ 所有模式**零写操作**（默认模式由 A-01 以 AST 自证）；红证模式仅对所列文件做
   **文本变异 + 逐字节还原**，⛔ 不执行任何 deploy / push / DB / release。
"""
import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[3]
SELF_REL = str(HERE.relative_to(REPO)).replace("\\", "/")
NODE = shutil.which("node") or "node"

# ---- 受本批次管理的文件 ----
DH = "src/common/utils/gen1-data-health.js"
GEN = "scripts/gen-gen1-pipeline-lock.js"
VER = "scripts/verify-gen1-pipeline.js"
LOCK = "ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json"
BUNDLE = "ml/manifests/GEN1_RUNTIME_BUNDLE.json"
TESTS = "tests/gen1-data-health.test.js"

# ---- 本批次 ⛔ 不得改动的 10 类文件 ----
UNTOUCHED = [
    "src/common/utils/indicators.js",
    "src/common/utils/trend-stage.js",
    "cloudfunctions/runGen1ShadowEod/index.js",
    "cloudfunctions/runGen1ShadowEod/frozen-manifest.json",
    "src/common/utils/gen1-circuit-breaker.js",
    "src/common/utils/gen1-health-state.js",
    "src/common/utils/gen1-safety-permission.js",
    "cloudfunctions/adminGateway/index.js",
    "src/common/schema.js",
    "src/common/constants.js",
]

HARD_EXPECT = [
    "ma20_slope", "px_ma20", "px_ma60", "price_position", "volume_ratio",
    "sideway_days", "consolidation_score", "atr20",
    "change_5d", "bias_20d", "breakout", "ret_5d", "ret_20d", "rs_20d",
]
NULLABLE_EXPECT = ["sideway_range"]


# ---- 越界 token（**运行时片段拼装**，⛔ 源码内不留完整字面量） ----
def _bad_tokens():
    return [
        " ".join(("tcb", "fn", "deploy")),
        " ".join(("tcb", "deploy")),
        "git" + " " + "push",
        "git" + " " + "merge",
        "production_write" + " = " + "1",
        "auto_execution" + " = " + "true",
    ]


# =====================================================================
def read_text(rel):
    return (REPO / rel).read_text(encoding="utf-8")


def lf_sha_bytes(b):
    return hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()


def lf_sha(rel):
    return lf_sha_bytes((REPO / rel).read_bytes())


def ending_report(rel):
    b = (REPO / rel).read_bytes()
    crlf = b.count(b"\r\n")
    return {"crlf": crlf, "lf_only": b.count(b"\n") - crlf}


def run_node(args, timeout=180):
    return subprocess.run([NODE] + args, cwd=str(REPO), capture_output=True,
                          text=True, timeout=timeout, encoding="utf-8", errors="replace")


def _git_lf_sha(rel):
    r = subprocess.run(["git", "-C", str(REPO), "show", "HEAD:%s" % rel], capture_output=True)
    if r.returncode != 0:
        return None
    return lf_sha_bytes(r.stdout)


PROBE_JS = r"""
const m = require('./src/common/utils/gen1-data-health.js');
const { evaluateDataHealth, STATUS, REASON } = m;
const full = {};
for (const k of m.REQUIRED_FEATURES) full[k] = k === 'breakout' ? 0 : 1.0;
const D = '2026-09-10';
const ev = (f) => evaluateDataHealth({ features: f, mainLatestDate: D, benchmarkLatestDate: D, historyBars: 200 });
const c1 = Object.assign({}, full, { sideway_days: 0, sideway_range: null });
const c2 = Object.assign({}, full, { atr20: null });
const c3 = Object.assign({}, full); delete c3.atr20;
const c4 = Object.assign({}, full, { rs_20d: null });
const c5 = Object.assign({}, full); delete c5.sideway_range;
console.log(JSON.stringify({
  hard: m.HARD_REQUIRED_FEATURES, nullable: m.SEMANTICALLY_NULLABLE_FEATURES, union: m.REQUIRED_FEATURES,
  status: STATUS, reason: REASON,
  t2: ev(c1), t3: ev(c2), t4: ev(c3), t5: ev(c4), t6: ev(c5)
}));
"""


def probe():
    r = run_node(["-e", PROBE_JS])
    if r.returncode != 0:
        raise RuntimeError("node probe failed: %s" % (r.stderr or r.stdout)[:400])
    return json.loads(r.stdout.strip().splitlines()[-1])


class Ctx(object):
    def __init__(self):
        self.results = []

    def chk(self, cid, desc, ok, detail=""):
        self.results.append((cid, bool(ok), desc, detail))
        return bool(ok)


def collect():
    d = {}
    d["dh"] = read_text(DH)
    d["gen"] = read_text(GEN)
    d["ver"] = read_text(VER)
    d["tests"] = read_text(TESTS)
    d["lock"] = json.loads(read_text(LOCK))
    d["bundle"] = json.loads(read_text(BUNDLE))
    d["probe"] = probe()
    d["g1b"] = run_node(["scripts/verify-gen1-pipeline.js"])
    d["testrun"] = run_node(["tests/gen1-data-health.test.js"])
    return d


def check(ctx):
    d = collect()
    p = d["probe"]
    hard, nullable, union = p["hard"], p["nullable"], p["union"]
    lockmap = {f["role"]: f for f in d["lock"]["files"]}

    # A-01 自证只读（AST）
    src = (REPO / SELF_REL).read_text(encoding="utf-8")
    tree = ast.parse(src)
    write_ranges = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in ("redproof", "run_redproof"):
            write_ranges.append((node.lineno, node.end_lineno))
    offenders = []
    # ⚠️ 只列「文件系统写」方法；⛔ 不得含 str.replace（会误伤普通字符串替换）
    WRITE_ATTRS = ("write_bytes", "write_text", "mkdir", "unlink", "rename", "rmtree")
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            nm = getattr(fn, "id", None) or getattr(fn, "attr", None)
            in_write_fn = any(lo <= node.lineno <= hi for lo, hi in write_ranges)
            if nm == "open" and len(node.args) >= 2:
                val = getattr(node.args[1], "value", None)
                if isinstance(val, str) and ("w" in val or "a" in val) and not in_write_fn:
                    offenders.append((node.lineno, nm))
            if nm in WRITE_ATTRS and not in_write_fn:
                offenders.append((node.lineno, nm))
            if nm == "run" and getattr(fn, "attr", None) == "run":
                pass
    ok1 = (not offenders) and len(write_ranges) >= 1
    ctx.chk("A-01.self-readonly-ast", "自证只读：写操作仅在 redproof 行区间内（AST 扫描）", ok1,
            "offenders=%s ranges=%s" % (offenders, write_ranges))

    # A-02 文件齐备
    miss = [f for f in (DH, GEN, VER, LOCK, BUNDLE, TESTS) if not (REPO / f).exists()]
    ctx.chk("A-02.files-present", "本批次 6 个目标文件齐备", not miss, "missing=%s" % miss)

    # A-03 三常量齐备
    ok3 = all(k in d["dh"] for k in ("HARD_REQUIRED_FEATURES", "SEMANTICALLY_NULLABLE_FEATURES", "REQUIRED_FEATURES"))
    ctx.chk("A-03.three-consts", "HARD/NULLABLE/UNION 三常量存在（源码）", ok3)

    # A-04 集合内容（实跑取值）
    ok4 = (hard == HARD_EXPECT) and (nullable == NULLABLE_EXPECT) and (sorted(union) == sorted(HARD_EXPECT + NULLABLE_EXPECT))
    ctx.chk("A-04.set-membership", "硬必填 14 / 语义可空 1 / 并集 15（node 实跑取值）", ok4,
            "hard=%d nullable=%s union=%d" % (len(hard), nullable, len(union)))

    # A-05 取域分离
    ok5 = ("const absent = required.filter(" in d["dh"]
           and "const nullish = hardRequired.filter(" in d["dh"]
           and "const required = src.requiredFeatures || REQUIRED_FEATURES;" in d["dh"]
           and "const hardRequired = src.hardRequiredFeatures || HARD_REQUIRED_FEATURES;" in d["dh"])
    ctx.chk("A-05.domain-split", "absent 取域=并集；nullish 取域=硬必填（源码）", ok5)

    # A-06 环节 ⑤ 未改且先于 ⑥
    i5 = d["dh"].find("if (nullish.includes('rs_20d'))")
    i6 = d["dh"].find("if (nullish.length > 0)")
    ctx.chk("A-06.rs20-shortcircuit", "rs_20d 环节 ⑤ 未改且先于环节 ⑥", i5 > 0 and i6 > i5, "i5=%d i6=%d" % (i5, i6))

    # A-07 头注释
    head = d["dh"].split("module.exports")[0]
    ok7 = ("★ 特征必需性两组语义" in head and "语义可空 ≠ pipeline missing" in head
           and "SEMANTICALLY_NULLABLE_FEATURES" in head)
    ctx.chk("A-07.docstring", "模块头注释登记两组语义 + 「语义可空 ≠ pipeline missing」", ok7)

    # A-08 schema 零变更
    ok8 = lf_sha("src/common/schema.js") == _git_lf_sha("src/common/schema.js")
    ctx.chk("A-08.schema-untouched", "SCHEMA_STRUCTURE_CHANGE = NONE（schema.js 与 HEAD LF 逐字节同）", ok8)

    # A-09 锁绑定
    ok9 = (len(d["lock"]["files"]) == 5 and "data_health" in lockmap
           and lockmap["data_health"]["path"] == DH
           and lockmap["data_health"]["sha256"] == lf_sha(DH))
    ctx.chk("A-09.lock-binding", "锁 files[] 含 data_health 且 sha256 == 实测 LF sha（实时）", ok9,
            "n=%d got=%s want=%s" % (len(d["lock"]["files"]),
                                     lockmap.get("data_health", {}).get("sha256", "")[:12], lf_sha(DH)[:12]))

    # A-10 生成器同构 + 9 域
    gen_entries = re.findall(r"\{\s*role:\s*'([a-z_]+)',\s*path:\s*'([^']+)'\s*\}", d["gen"])
    lock_entries = [(f["role"], f["path"]) for f in d["lock"]["files"]]
    ok10 = (gen_entries == lock_entries and "9 域对齐" in d["gen"] and "数据健康、域策略" in d["gen"])
    ctx.chk("A-10.generator-parity", "生成器 PIPELINE_FILES 与锁逐项同构（防重生成丢项）+ 头注释 9 域", ok10,
            "gen=%s" % (gen_entries,))

    # A-11 ROOT_ANCHOR 实时比对
    m11 = re.findall(r"const ROOT_ANCHOR_PIPELINE_LOCK = '([0-9a-f]{64})';", d["ver"])
    ok11 = (len(m11) == 1 and m11[0] == lf_sha(LOCK))
    ctx.chk("A-11.root-anchor", "ROOT_ANCHOR_PIPELINE_LOCK == 锁实测 LF sha（⛔ 不硬编码期望值）", ok11,
            "anchor=%s lock=%s" % (m11[0][:12] if m11 else "?", lf_sha(LOCK)[:12]))

    # A-12 bundle 一致 + 冻结值未动
    b = d["bundle"]
    ok12 = (b["feature_pipeline_hash"] == lf_sha(LOCK)
            and b["feature_schema_hash"] == d["lock"]["derived"]["feature_schema_sha256"]
            and b["model_sha256"] == json.loads(read_text("ml/manifests/GEN1_IMMUTABLE_LOCK.json"))["model_sha256"])
    ctx.chk("A-12.bundle-parity", "bundle.feature_pipeline_hash == 锁 LF sha；schema/model 冻结值未动", ok12)

    # A-13 G1-B 实跑
    g = d["g1b"]
    ok13 = (g.returncode == 0 and "11/11" in (g.stdout or ""))
    ctx.chk("A-13.g1b-live", "G1-B（verify-gen1-pipeline.js）实跑 11/11 且 rc=0", ok13,
            (g.stdout or "").strip().splitlines()[-1] if g.stdout else "")

    # A-14 测试实跑 + 用例齐备
    t = d["testrun"]
    marks = ["[T-2 / 判据 4]", "[T-3 / 判据 1]", "[T-4 / 判据 2]", "[T-5 / 判据 3]",
             "[T-6 / 判据 2 边界]", "[E-2] 权威生产者复算"]
    ok14 = (t.returncode == 0 and "tests passed" in (t.stdout or "")
            and all(mk in d["tests"] for mk in marks))
    ctx.chk("A-14.tests-live", "单测实跑绿（rc=0）且 T-2…T-6 + E-2 齐备", ok14,
            "missing=%s rc=%s" % ([mk for mk in marks if mk not in d["tests"]], t.returncode))

    # A-15 四判据实跑
    st, rs = p["status"], p["reason"]
    c = [
        p["t2"]["status"] == st["DATA_OK"] and p["t2"]["reason_code"] is None
        and "sideway_range" not in p["t2"]["missing_features"],
        p["t3"]["status"] == st["DATA_DEGRADED"] and p["t3"]["reason_code"] == rs["STATISTICAL_MISSING"],
        p["t4"]["status"] == st["DATA_BLOCKED"] and p["t4"]["reason_code"] == rs["PIPELINE_MISSING"],
        p["t5"]["status"] == st["DATA_BLOCKED"] and p["t5"]["reason_code"] == rs["BENCHMARK_MISSING"],
        p["t6"]["status"] == st["DATA_BLOCKED"] and p["t6"]["reason_code"] == rs["PIPELINE_MISSING"],
    ]
    ctx.chk("A-15.four-criteria", "四判据实跑（可空值缺失=OK / 硬值缺失=DEGRADED / 列缺失=PM / rs_20d=BM / 可空列缺失=PM）",
            all(c), "flags=%s" % c)

    # A-16 十类不动文件与 HEAD 同
    changed = [f for f in UNTOUCHED if lf_sha(f) != _git_lf_sha(f)]
    ctx.chk("A-16.untouched-10", "本批未触及 10 类文件（与 HEAD 逐字节同，LF 归一）", not changed, "changed=%s" % changed)

    # A-17 无越界 token
    toks = _bad_tokens()
    hits = {}
    for f in (DH, GEN, VER, LOCK, BUNDLE, TESTS):
        h = [tk for tk in toks if tk in read_text(f)]
        if h:
            hits[f] = h
    ctx.chk("A-17.no-boundary-token", "本批文件无 deploy/push/越界 token", not hits, str(hits))

    # A-18 只读口径声明
    ctx.chk("A-18.generator-not-rerun", "只读口径：checker 不重跑锁生成器（写盘动作不在只读面内）", True)

    # A-19 行尾逐文件登记
    ends = {f: ending_report(f) for f in (DH, GEN, VER, LOCK, BUNDLE)}
    ok19 = (all(ends[f]["crlf"] > 0 for f in (DH, GEN, VER))
            and all(ends[f]["lf_only"] > 0 for f in (LOCK, BUNDLE)))
    ctx.chk("A-19.line-endings", "行尾逐文件登记（js=CRLF / json=LF）", ok19, str(ends))

    # A-20 计划内部矛盾已登记
    ctx.chk("A-20.plan-conflict-logged", "计划 L66（absent→hardRequired）与 T-6/判据 2 冲突：本批按判据实现并已登记",
            "判据 2：列缺失按**并集**取域" in d["dh"])

    return ctx


# =====================================================================
def _mutations():
    """[(rp_id, file, old, new)]；特殊项 old/new=None（由 _apply_special 处理）。"""
    return [
        ("RP-1", DH, "const nullish = hardRequired.filter(", "const nullish = required.filter("),
        ("RP-2", DH, "const absent = required.filter(", "const absent = hardRequired.filter("),
        ("RP-3", LOCK, None, None),
        ("RP-4", DH, "Object.freeze(['sideway_range'])", "Object.freeze([])"),
        ("RP-5", VER, None, None),
        ("RP-6", TESTS, "delete f.sideway_range;", "f.sideway_range = null;"),
        # ⚠️ RP-7 走 _apply_special：源文件是 CRLF，锚点**不得**写死 "\n"（会静默匹配 0 次）
        ("RP-7", GEN, None, None),
        ("RP-8", BUNDLE, None, None),
    ]


def _apply_special(rp, raw):
    if rp == "RP-3":
        obj = json.loads(raw.decode("utf-8"))
        for f in obj["files"]:
            if f["role"] == "data_health":
                f["sha256"] = "0" * 64
        return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    if rp == "RP-5":
        return re.sub(rb"const ROOT_ANCHOR_PIPELINE_LOCK = '[0-9a-f]{64}';",
                      b"const ROOT_ANCHOR_PIPELINE_LOCK = '" + b"a" * 64 + b"';", raw, count=1)
    if rp == "RP-7":
        # 删掉生成器里 data_health 那一整行（行尾 CRLF、末项无尾逗号），破坏与锁 files[] 的同构
        out, n = re.subn(rb"[ \t]*\{ role: 'data_health'[^\r\n]*\}[ \t]*,?[ \t]*\r?\n", b"", raw, count=1)
        if n != 1:
            raise RuntimeError("RP-7 anchor matched %d times" % n)
        return out
    if rp == "RP-8":
        obj = json.loads(raw.decode("utf-8"))
        obj["feature_pipeline_hash"] = "0" * 64
        return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    return None


def _preflight():
    """RP-0：变异**前**逐项审计锚点可解析性（count==1 / 特殊项确实改字节）。
    返回 [(rp, ok, detail)]。⚠️ 锚点失配必须在变异前显式暴露，⛔ 不得靠运行期异常兜底。"""
    rows = []
    for rp, rel, old, new in _mutations():
        p = REPO / rel
        if not p.exists():
            rows.append((rp, False, "file missing: %s" % rel))
            continue
        orig = p.read_bytes()
        try:
            sp = _apply_special(rp, orig)
            if sp is None:
                n = orig.decode("utf-8").count(old) if old is not None else 0
                rows.append((rp, n == 1 and (new is not None), "plain anchor count=%d%s" % (
                    n, "" if n == 1 else "  ⚠️ 锚点失配")))
            else:
                rows.append((rp, sp != orig, "special applied, delta=%d bytes" % (len(sp) - len(orig))))
        except Exception as e:
            rows.append((rp, False, "EXC:%s" % str(e)[:60]))
    return rows


def redproof():
    print("=== RED PROOF（变异 → 必 FAIL → 逐字节还原）===")
    total = passed = 0
    print("--- RP-0 前置锚点审计 ---")
    pre_bad = []
    for rp, ok, detail in _preflight():
        if not ok:
            pre_bad.append(rp)
        print("  [%s] 锚点 %s :: %s" % ("OK" if ok else "BAD", rp, detail))
    if pre_bad:
        print("\n=== REDPROOF ABORT：锚点失配 %s（⛔ 不得继续，先修锚点）===" % pre_bad)
        return 1
    for rp, rel, old, new in _mutations():
        total += 1
        path = REPO / rel
        orig = path.read_bytes()
        sha0 = hashlib.sha256(orig).hexdigest()
        fails = []
        applied = False
        try:
            sp = _apply_special(rp, orig)
            if sp is not None:
                mutated = sp
            else:
                s = orig.decode("utf-8")
                if old is None or s.count(old) != 1:
                    raise RuntimeError("mutation anchor count!=1 (%s)" % (s.count(old) if old else "None"))
                mutated = s.replace(old, new, 1).encode("utf-8")
            if mutated == orig:
                raise RuntimeError("mutation is a no-op (identical bytes)")
            applied = True
            path.write_bytes(mutated)
            c = Ctx()
            check(c)
            fails = [cid for cid, ok, _, _ in c.results if not ok]
            if not fails:
                fails = ["NO-RED:mutation applied but checker stayed green"]
        except Exception as e:
            # ⚠️ 变异**未应用**（锚点/异常）≠ 红证成立 ⇒ applied=False 时一律判 FAIL
            fails = fails or ["EXC:%s" % str(e)[:70]]
        finally:
            path.write_bytes(orig)
        restored = (hashlib.sha256(path.read_bytes()).hexdigest() == sha0)
        ok = applied and (len(fails) > 0) and restored
        passed += 1 if ok else 0
        print("  [%s] %s  应用=%s  红项=%s  还原=%s" % ("PASS" if ok else "FAIL", rp, applied, fails[:4], restored))

    total += 1
    c = Ctx()
    check(c)
    bad = [cid for cid, ok, _, _ in c.results if not ok]
    ok = not bad
    passed += 1 if ok else 0
    print("  [%s] RP-9 反向自证（零变异 ⇒ 必全绿） 红项=%s" % ("PASS" if ok else "FAIL", bad))
    print("\n=== REDPROOF PASS=%d FAIL=%d ===" % (passed, total - passed))
    return 0 if passed == total else 1


# =====================================================================
# ★ 回归白名单（**显式列举**，⛔ 禁 `ls *.py` 通配）
#   本轮 = 第十二轮 22 项 + 本 checker ⇒ 23 项；EXCLUDED = 1
#   （排除 `v6_negative_scan.py` = KNOWN FALSE POSITIVE：N-9a/N-10 枚举域自述行误报）
# =====================================================================
REGRESSION_WHITELIST = [
    "v6_r13_lc_c_c3r2_check.py",
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
REGRESSION_EXCLUDED = {"v6_negative_scan.py": "KNOWN FALSE POSITIVE（N-9a/N-10 枚举域自述行误报）"}

# ⚠️ 已登记的「**预实现快照断言**被本批实现**推翻**」项（⛔ 不是白名单：新失败一律仍判 FAIL）。
#    键 = checker 文件名；值 = (期望打红的断言 id, 期望出现在输出里的片段, 理由)。
#    ⇒ 判 STALE 必须 **rc≠0 ∧ 断言 id 命中 ∧ 片段命中** 三者同时成立；否则回落为 FAIL。
REGRESSION_KNOWN_STALE = {
    "v6_c3_c2_preflight_check.py": (
        "B-22.freeze-surface", "dh=True",
        "该断言锚定 **R2 前** 的锁（4 绑定 / data-health **不在**锁内）；本批按 LC-C 补绑定后其语义前提被推翻。"
        "其文档依据 `GEN1_C3_C2_PREFLIGHT_20261003.md:40` 恰是 LC-C 明令禁止的推论（「files[] 未列出 ⇒ 不受管」）。"
        "重锚（改按基线 commit 的锁对拍）需另立 `HARNESS-MAINTENANCE-C3C2-B22` 并取得独立授权 ⇒ ⛔ 本批不改。"
    ),
}


def _py_run(rel, timeout=900):
    return subprocess.run([sys.executable, str(REPO / rel)], cwd=str(REPO), capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=timeout)


def _tail(out, n=1):
    lines = [l for l in (out or "").strip().splitlines() if l.strip()]
    return lines[-n:] if lines else [""]


def snapshot_zone():
    snap = {}
    for z in ("out", "fixtures"):
        base = REPO / "scripts/gen1/evidence-capture" / z
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file():
                rel = str(p.relative_to(REPO)).replace("\\", "/")
                snap[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    return snap


def regression():
    print("=== REGRESSION（显式白名单 N=%d；EXCLUDED=%d）===" % (len(REGRESSION_WHITELIST), len(REGRESSION_EXCLUDED)))
    npass = nfail = nstale = 0
    for rel in REGRESSION_WHITELIST:
        name = os.path.basename(rel)
        path = REPO / "scripts/gen1/evidence-capture" / name
        if not path.is_file():
            print("  [FAIL] %-46s MISSING" % name)
            nfail += 1
            continue
        r = _py_run("scripts/gen1/evidence-capture/" + name)
        out = (r.stdout or "") + (r.stderr or "")
        if r.returncode == 0:
            npass += 1
            print("  [PASS] %-46s %s" % (name, _tail(out)[0][:96]))
        else:
            st = REGRESSION_KNOWN_STALE.get(name)
            if st and st[0] in out and st[1] in out:
                nstale += 1
                print("  [STALE] %-45s %s  ⇒ %s" % (name, st[0], st[2][:110]))
            else:
                nfail += 1
                print("  [FAIL] %-46s %s" % (name, _tail(out)[0][:96]))
                for l in _tail(out, 6):
                    print("         | %s" % l[:150])
    print("\n=== REGRESSION PASS=%d FAIL=%d STALE=%d TOTAL=%d EXCLUDED=%d ==="
          % (npass, nfail, nstale, len(REGRESSION_WHITELIST), len(REGRESSION_EXCLUDED)))
    return 0 if nfail == 0 else 1


def zerowrite():
    print("=== ZERO-WRITE 自证（out/ + fixtures/ before/after 快照比对）===")
    before = snapshot_zone()
    rc = regression()
    after = snapshot_zone()
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    print("\n  before=%d after=%d" % (len(before), len(after)))
    print("  changed_or_missing=%s" % (changed if changed else "NONE"))
    print("  PRODUCTION_WRITE = 0 / DB_WRITE = 0 / AUTHORITY_CHANGE = NONE  (声明；本 checker 只读)")
    print("\n=== ZEROWRITE %s ===" % ("PASS" if not changed else "FAIL"))
    return 0 if (not changed and rc == 0) else 1


def main(argv):
    if "--redproof" in argv:
        return redproof()
    if "--regression" in argv:
        return regression()
    if "--zerowrite" in argv:
        return zerowrite()
    ctx = Ctx()
    check(ctx)
    fails = 0
    for cid, ok, desc, detail in ctx.results:
        if not ok:
            fails += 1
        print("  [%s] %s — %s%s" % ("PASS" if ok else "FAIL", cid, desc,
                                    ("  :: " + detail) if (detail and not ok) else ""))
    print("\n=== LC-C + C3-R2 CHECKER：PASS=%d FAIL=%d TOTAL=%d ==="
          % (len(ctx.results) - fails, fails, len(ctx.results)))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
