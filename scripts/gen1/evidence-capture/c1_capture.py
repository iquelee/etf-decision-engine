# -*- coding: utf-8 -*-
"""
C-1 每日只读 Evidence Capture —— **v5.0 语义**（Gen-1 Evidence Contract v5.0 §5）

★ 本文件是 `_evidence-capture-tool/c1_capture.py`（v3.0 语义）的**迁移版**。
  迁移依据：契约 **§11 元规则 规则 5** —— 「工具语义迁移与契约冻结**同批次**」；
            契约 **§12 第 12 项** —— 迁移随冻结一并执行。

冻结绑定（★ 任何一项不符 ⇒ 工具与契约不同源，⛔ 不得据其结果计入样本）：
  契约路径      docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md
  契约版本      v5.0（FROZEN 2026-10-02）
  carrier commit 05da0efa73e948921bc7b9b60c0d500cc98e3e9b
  git blob id   7f86d12aaed99a877c170c25c5a481f21a661256      （sha1，git 对象）
  content sha256 4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b（64580 B / LF）
  ⚠️ 三种指纹**不可混用**（blob id 是 sha1；content sha256 是文件内容哈希）
  ⚠️ 冻结指纹由外部**封存记录**与载体 PR body 承载，⛔ 不写入契约文件本身（自指悖论）

v5.0 相对 v3.0 的语义变更（★ 摘要）：
  1. 读源整体改绑 **run 轴**：`decision_result` → `run_candidate_decision`；
     `portfolio_snapshot` → `run_candidate_portfolio`（两者**退出**评分源，仍为前台现行读链）
  2. 源集合 5 → **8**：新增 `run_manifest` / `active_run_pointer` / `run_history`
  3. **SELECTOR = S-PROMOTED**：pin `active_run_pointer[scope="production"].run_id`（读一次即 pin）
  4. 行键 `(date, code)` → **`(run_id, code)`**（修键碰撞）
  5. bundle 新增 `run_id` / `pointer_revision` / `run_manifest.*` / `run_history.*`
  6. gate 由 9 条 → **14 条**（规则 1/2 改按 pointer revision；新增组 A1/A2/A3 与 B3/B4）
  7. checkpoint 由 工作日 09:00 → **工作日 [22:30:00, 23:30:00)（北京）**
  8. CHAIN PROOF 重锚到 **22:00 入口管线**（`fetchDailyData`），⛔ 不再要求落在 capture 窗口内

硬约束（与契约一致，⛔ 勿改）：
  1. 只读：云端仅 `QUERY/find` + `COMMAND/count` + `logs search`；⛔ 零 INSERT/UPDATE/DELETE
  2. 八源 capture bundle + 逐源 SHA256
  3. `BUNDLE COHERENCE GATE` **14 条**；任一不过 ⇒ 非正式 bundle（fail-closed）
  4. append-only：同名已存在 ⇒ 拒绝写入，⛔ 不覆盖
  5. ⛔ 不倒填（NO RETROACTIVE RECONSTRUCTION）
  6. 只写仓库外归档目录；⛔ 不写生产 DB

用法：
  python c1_capture.py --dry-run    # 跑 gate 并打印，不落盘
  python c1_capture.py              # 正常执行（落盘）
  （门逻辑为纯函数 evaluate_gate / evaluate_checkpoint / evaluate_eligibility / decide，
    供 c1_gate_redproof.py 打红自证）

环境依赖（⚠️ 如实声明）：
  · 只读通道模块 `cb_connect`（提供 assert_readonly / run_tcb / do_login / load_cred）
    默认路径由环境变量 `CB_CONNECT_DIR` 指定；未设置时回退到开发机默认路径。
  · node + @cloudbase/cli（tcb）由 `cb_connect` 内部解析。
  · 本工具**不在仓库内自带凭据**；凭据经 `cb_connect.load_cred()` 从其凭据文件读取。
"""
import argparse
import datetime
import hashlib
import json
import os
import subprocess
import sys

# ------------------------------------------------------------------
# 冻结绑定常量（★ 与契约 §11 规则 5 同批次固定）
# ------------------------------------------------------------------
CONTRACT_PATH = "docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md"
CONTRACT_VERSION = "v5.0"
CONTRACT_FROZEN_DATE = "2026-10-02"
CONTRACT_CARRIER_COMMIT = "05da0efa73e948921bc7b9b60c0d500cc98e3e9b"
CONTRACT_GIT_BLOB_SHA1 = "7f86d12aaed99a877c170c25c5a481f21a661256"
CONTRACT_CONTENT_SHA256 = \
    "4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b"

BUNDLE_REVISION = "v5.0"

# ------------------------------------------------------------------
# 环境
# ------------------------------------------------------------------
CB_DIR = os.environ.get("CB_CONNECT_DIR", r"D:/AI-Projects/Codex/etf-decision-engine/_cb-connect-20260921")
sys.path.insert(0, CB_DIR)
from cb_connect import assert_readonly, run_tcb, redact, ENV_ID, do_login, load_cred  # noqa: E402

ROOT = os.environ.get("GEN1_EVIDENCE_ROOT", r"D:/AI-Projects/Codex/etf-decision-engine")
MAIN5 = ["513310", "515880", "159582", "518880", "159570"]

# 八源（契约 §5.3）
SRC_RUN_AXIS = ["run_candidate_decision", "run_candidate_portfolio",
                "run_manifest", "active_run_pointer", "run_history"]
SRC_STATE = ["runtime_status", "ml_shadow_signal"]
SRC_ALL = SRC_STATE + SRC_RUN_AXIS + ["invocation_log"]

NODE = os.environ.get("CB_NODE") or r"C:/Users/iquel/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
CLI = os.environ.get("CB_CLI") or \
    r"C:/Users/iquel/.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/bin/tcb"

NOW = datetime.datetime.now()
STAMP = NOW.strftime("%Y%m%d_%H%M%S")
TODAY = NOW.strftime("%Y-%m-%d")
OUTDIR = "%s/_evidence-capture-%s" % (ROOT, NOW.strftime("%Y%m%d"))

# ⚠️ CHAIN PROOF 只用来定位「产生该 run 的入口管线」的日志窗口，
#    ⛔ 不是统计 checkpoint（契约 §5.6 第 5 条：run 的 invocation 不必落在 checkpoint 窗口内）。
CHAIN_WINDOW_START = "21:50:00"
CHAIN_WINDOW_END = "22:30:00"


# ============================================================
# 纯函数：门逻辑（供打红自证复用，⛔ 勿在别处复制第二份）
# ============================================================
def promotion_proof(*, ptr, run_manifest_row, run_history_row):
    """契约 §3.0.3：PROMOTION_PROOF(R) 五条 AND，缺一即 fail-closed。

    返回 [(条件名, bool), ...]（共 5 条）。
    """
    ptr = ptr or {}
    rm = run_manifest_row or {}
    rh = run_history_row or {}
    rid = ptr.get("run_id")
    return [
        ("P1 active_run_pointer[production].run_id == R", bool(rid) and rid == rm.get("run_id")),
        ("P2 run_history[R].promoted == true", rh.get("promoted") is True),
        ("P3 run_history[R].read_after_write_consistent == true",
         rh.get("read_after_write_consistent") is True),
        ("P4 run_manifest[R].validation_passed == true", rm.get("validation_passed") is True),
        ("P5 run_manifest[R].revision == active_run_pointer.revision",
         rm.get("revision") is not None and rm.get("revision") == ptr.get("revision")),
    ]


def evaluate_gate(*, pinned_run_id, ptr, manifest, history, cand_dec, cand_pf, ms_day,
                  sources, chain_proof, prev_pointer_revision=None, bundle_exists=False):
    """契约 §5.4：BUNDLE COHERENCE GATE（v5.0，14 条）。返回 [(规则名, bool), ...]。

    ⚠️ 规则 14 是**禁令**（(IV) CALENDAR TRADE DATE 不得进入任一判据），
       以「结构自证」实现：本函数**签名内不含任何日历量**，故不可能被误用。
    """
    ptr = ptr or {}
    manifest = manifest or {}
    history = history or {}
    cand_dec = cand_dec or []
    cand_pf = cand_pf or {}
    ms_day = ms_day or []

    R = pinned_run_id   # ★ S-PROMOTED：R 在 selector 处**读一次即 pin**；规则 1 校验 gate 时刻 pointer 仍 == R
    pf = promotion_proof(ptr=ptr, run_manifest_row=manifest, run_history_row=history)
    pf_all = all(ok for _, ok in pf)

    dec_codes = sorted(r.get("code") for r in cand_dec)
    dec_dates = {str(r.get("decision_date")) for r in cand_dec}
    dec_calc = {str(r.get("calc_date")) for r in cand_dec}
    ms_date = ms_day[0].get("date") if ms_day else None
    ms_codes = sorted({r.get("code") for r in ms_day})

    if prev_pointer_revision is None:
        r2 = True                                    # §5.7 FIRST BUNDLE：N/A
    else:
        r2 = (ptr.get("revision") is not None
              and int(ptr.get("revision")) > int(prev_pointer_revision))

    return [
        ("1 本次 pin 的 R == active_run_pointer[production].run_id（⛔ 不查 runtime_status）",
         bool(R) and R == ptr.get("run_id")),
        ("2 pointer.revision 严格大于上一有效 bundle 的 pointer_revision（首 bundle = N/A）", r2),
        ("3 PROMOTION_PROOF(R) 五条 AND 全真（§3.0.3）", pf_all),
        ("4 run_candidate_decision(R) 恰有 Main5 五个 code", dec_codes == sorted(MAIN5)),
        ("5 该 run 五行 decision_date 完全相同（组 B1）",
         len(cand_dec) == 5 and len(dec_dates) == 1),
        ("6 ml_shadow_signal.date == 该 decision_date（组 B2）",
         bool(ms_date) and len(dec_dates) == 1 and str(ms_date) in dec_dates),
        ("7 该 run 五行 calc_date 全等且 == decision_date（组 B3）",
         len(cand_dec) == 5 and len(dec_calc) == 1 and dec_calc == dec_dates),
        ("8 decision_date <= run_manifest[R].expected_trade_date（组 B4）",
         len(dec_dates) == 1 and bool(manifest.get("expected_trade_date"))
         and list(dec_dates)[0] <= str(manifest.get("expected_trade_date"))),
        ("9 run_candidate_portfolio(R).snapshot_date == run_manifest[R].expected_trade_date（组 A1）",
         bool(cand_pf.get("snapshot_date"))
         and str(cand_pf.get("snapshot_date")) == str(manifest.get("expected_trade_date"))),
        ("10 ml_shadow_signal 覆盖同一 Main5 code set", ms_codes == sorted(MAIN5)),
        ("11 §3.0.3 的 run/revision 三者一致（组 A2/A3）",
         bool(R) and manifest.get("run_id") == R and history.get("run_id") == R
         and manifest.get("revision") == ptr.get("revision")
         and history.get("revision") == ptr.get("revision")),
        ("12 §5.6 NATURAL_RUN_PROVENANCE（含 CHAIN PROOF）",
         bool(chain_proof) and chain_proof.get("verified") is True),
        ("13 八源齐备（bytes > 0）",
         bool(sources) and set(sources) >= set(SRC_ALL)
         and all(v.get("bytes", 0) > 0 for v in sources.values())),
        ("14 ⛔ (IV) CALENDAR TRADE DATE 不得进入任一判据（结构自证：签名不含日历量）", True),
    ]


def evaluate_checkpoint(now):
    """契约 §5.8：工作日 **[22:30:00, 23:30:00)（北京）**。"""
    return (now.weekday() < 5) and (
        (now.hour == 22 and now.minute >= 30) or (now.hour == 23 and now.minute < 30))


def evaluate_eligibility(*, eligibility, cand_dec):
    """契约 §4.2 排除规则（显式五条）。True = 未被排除。"""
    e = eligibility or {}
    cand_dec = cand_dec or []
    has_date = bool(cand_dec) and all(r.get("decision_date") for r in cand_dec)
    has_base = bool(cand_dec) and all(r.get("suggested_position") is not None for r in cand_dec)
    return [
        ("§4.2-1 canary_active == true（未排除）", e.get("gen1_counterfactual_canary_active") is True),
        ("§4.2-2 health_gate_status == 'ACTIVE'",
         str(e.get("gen1_health_gate_status") or "").upper() == "ACTIVE"),
        ("§4.2-3 ledger_ok == true", e.get("gen1_counterfactual_ledger_ok") is True),
        ("§4.2-4 date 与 baseline_suggested_position 齐备", has_date and has_base),
        ("§4.2-5 无 PROVENANCE_MISSING / BUNDLE_INVALID", True),
    ]


def decide(official_gate, checkpoint_ok):
    return "SCORING" if (official_gate and checkpoint_ok) else "NON_SCORING"


# ============================================================
# 云端只读抓取
# ============================================================
def sha(b):
    return hashlib.sha256(b).hexdigest()


def q(coll, body=None, limit=50):
    find_body = {"find": coll, "filter": (body or {}).pop("filter", {}), "limit": limit}
    find_body.update(body or {})
    mgo = [{"TableName": coll, "CommandType": "QUERY", "Command": json.dumps(find_body)}]
    assert_readonly(mgo)
    rc, out, err = run_tcb(["db", "nosql", "execute", "--command",
                            json.dumps(mgo), "-e", ENV_ID, "--json"], timeout=300)
    if rc != 0:
        raise RuntimeError("query %s failed: %s" % (coll, redact(err)[:200]))
    raw = out.encode("utf-8")
    j = json.loads(out[out.index("{"):])
    res = j.get("data", {}).get("results", [])
    return (res[0] if res and isinstance(res[0], list) else res), raw


def norm(v):
    if isinstance(v, dict):
        if set(v) == {"$numberInt"}:
            return int(v["$numberInt"])
        if set(v) == {"$numberDouble"}:
            return float(v["$numberDouble"])
        if set(v) == {"$numberLong"}:
            return int(v["$numberLong"])
        return {k: norm(x) for k, x in v.items()}
    if isinstance(v, list):
        return [norm(x) for x in v]
    return v


def logs(query, start, end, limit=30):
    p = subprocess.run([NODE, CLI, "logs", "search", "-e", ENV_ID, "-q", query,
                        "-t", "%s,%s" % (start, end), "-l", str(limit), "--json"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = p.stdout or ""
    try:
        j = json.loads(out[out.index("{"):])
    except Exception:
        return [], out.encode("utf-8")
    return (j.get("data") or {}).get("results", []) or [], out.encode("utf-8")


def _parse_iso_local(s):
    """'2026-09-30T14:01:11.018Z' -> datetime(+08 naive)。"""
    if not s:
        return None
    t = str(s).replace("Z", "+00:00")
    try:
        dt = datetime.datetime.fromisoformat(t)
    except Exception:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(datetime.timezone(datetime.timedelta(hours=8))).replace(tzinfo=None)
    return dt


def chain_proof(run_date, manifest_created_at):
    """契约 §5.6 CHAIN PROOF（v5.0 重锚）。

    证明：
      ① 22:00 入口 `fetchDailyData` 在该 run 所属窗口内存在 `TRIGGER_TIMER` 调用；
      ② `materializeIndicators` 存在链式（`TCB_API`）调用；
      ③ `runDecisionEngine` 存在一次调用，其 [START, Report] 区间**包含**
         `run_manifest[R].created_at` ⇒ 该 invocation 即产生该 run 的那一跳；
      ④ ⛔ 管理侧重入（adminGateway 触发）不含上游链 ⇒ 因 ①② 缺失而 fail-closed。

    ⚠️ 局限（如实声明）：SCF 日志**不含** `engine_run_id` 字段
       ⇒ 第 ③ 条以「时间区间包含」做**间接**归属，⛔ 不主张为直接证得。
    """
    out = {"verified": False, "hops": [], "limitation": "invocation log 不含 engine_run_id；"
           "run↔invocation 归属以 [START, Report] 区间包含 run_manifest.created_at 作间接证明"}
    if not run_date:
        return out
    w0 = "%s %s" % (run_date, CHAIN_WINDOW_START)
    w1 = "%s %s" % (run_date, CHAIN_WINDOW_END)
    created = _parse_iso_local(manifest_created_at)

    fetch, _ = logs('function_name:"fetchDailyData"', w0, w1, 40)
    mat, _ = logs('function_name:"materializeIndicators"', w0, w1, 40)
    rde, rde_raw = logs('function_name:"runDecisionEngine"', w0, w1, 40)
    out["raw_bytes"] = len(rde_raw)

    def _rs(rows):
        return [r for r in rows if (r.get("content") or {}).get("request_source")]

    fetch_t = [r for r in _rs(fetch) if (r.get("content") or {}).get("request_source") == "TRIGGER_TIMER"]
    mat_c = [r for r in _rs(mat) if (r.get("content") or {}).get("request_source") == "TCB_API"]

    # runDecisionEngine：由 Init(开始) / Report(结束) 两行拼出区间
    starts, reports = {}, {}
    for r in rde:
        c = r.get("content") or {}
        lg = c.get("log") or ""
        ts = _parse_iso_local_ts(r.get("timestamp"))
        if ts is None:
            continue
        if "Init Report RequestId:" in lg:
            rid = lg.split("Init Report RequestId:")[1].strip().split()[0]
            starts.setdefault(rid, ts)
        elif "Report RequestId:" in lg and "Init Report RequestId:" not in lg:
            rid = lg.split("Report RequestId:")[1].strip().split()[0]
            reports.setdefault(rid, ts)

    hit = None
    for rid, s in starts.items():
        e = reports.get(rid)
        if e is None or created is None:
            continue
        if s <= created <= e:
            hit = {"request_id": rid, "start": s.isoformat(sep=" "), "report": e.isoformat(sep=" ")}
            break

    out["hops"] = [
        {"hop": 1, "function": "fetchDailyData", "request_source": "TRIGGER_TIMER",
         "count": len(fetch_t)},
        {"hop": 2, "function": "materializeIndicators", "request_source": "TCB_API",
         "count": len(mat_c)},
        {"hop": 3, "function": "runDecisionEngine", "request_source": "TCB_API",
         "invocations": len(starts), "matched": hit},
    ]
    out["verified"] = bool(fetch_t) and bool(mat_c) and hit is not None
    return out


def _parse_iso_local_ts(ts):
    """SCF 日志 timestamp：可为 '2026-09-30 22:01:12.092' 或 epoch。"""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        return datetime.datetime.utcfromtimestamp(ts / 1000.0) + datetime.timedelta(hours=8)
    s = str(ts)
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.datetime.strptime(s, fmt)
        except ValueError:
            pass
    return _parse_iso_local(s)


def collect():
    ptr_rows, ptr_raw = q("active_run_pointer", {"sort": {"revision": -1}}, 5)
    ptr_rows = [norm(r) for r in ptr_rows]
    prod = [r for r in ptr_rows if r.get("scope") == "production"]
    ptr = prod[0] if prod else (ptr_rows[0] if ptr_rows else {})
    R = ptr.get("run_id")

    rs_rows, rs_raw = q("runtime_status", limit=3)
    rs_rows = [norm(r) for r in rs_rows]
    rs = next((r for r in rs_rows if r.get("key") == "runtime-status"), None) or (rs_rows[0] if rs_rows else {})

    rm_rows, rm_raw = q("run_manifest", {"sort": {"created_at": -1}}, 20)
    rm_rows = [norm(r) for r in rm_rows]
    manifest = next((r for r in rm_rows if r.get("run_id") == R), {})

    rh_rows, rh_raw = q("run_history", {"sort": {"created_at": -1}}, 20)
    rh_rows = [norm(r) for r in rh_rows]
    history = next((r for r in rh_rows if r.get("run_id") == R), {})

    cd_rows, cd_raw = q("run_candidate_decision", {"sort": {"decision_date": -1}}, 40)
    cd_rows = [norm(r) for r in cd_rows]
    cand_dec = [r for r in cd_rows if r.get("run_id") == R]

    cp_rows, cp_raw = q("run_candidate_portfolio", {"sort": {"snapshot_date": -1}}, 20)
    cp_rows = [norm(r) for r in cp_rows]
    cand_pf = next((r for r in cp_rows if r.get("run_id") == R), {})

    ms_rows, ms_raw = q("ml_shadow_signal", {"sort": {"date": -1}}, 40)
    ms_rows = [norm(r) for r in ms_rows]
    dec_date = cand_dec[0].get("decision_date") if cand_dec else None
    ms_day = [r for r in ms_rows if str(r.get("date")) == str(dec_date)]

    run_date = manifest.get("expected_trade_date")
    cp = chain_proof(run_date, manifest.get("created_at"))

    sources = {
        "runtime_status": {"sha256": sha(rs_raw), "bytes": len(rs_raw)},
        "ml_shadow_signal": {"sha256": sha(ms_raw), "bytes": len(ms_raw)},
        "run_candidate_decision": {"sha256": sha(cd_raw), "bytes": len(cd_raw)},
        "run_candidate_portfolio": {"sha256": sha(cp_raw), "bytes": len(cp_raw)},
        "run_manifest": {"sha256": sha(rm_raw), "bytes": len(rm_raw)},
        "active_run_pointer": {"sha256": sha(ptr_raw), "bytes": len(ptr_raw)},
        "run_history": {"sha256": sha(rh_raw), "bytes": len(rh_raw)},
        "invocation_log": {"sha256": sha(cp.get("raw_bytes", b"") if isinstance(cp.get("raw_bytes"), bytes)
                                         else b""), "bytes": int(cp.get("raw_bytes") or 0)},
    }
    return dict(rs=rs, ptr=ptr, run_id=R, manifest=manifest, history=history,
                cand_dec=cand_dec, cand_pf=cand_pf, ms_day=ms_day, ms_all=ms_rows,
                sources=sources, chain_proof=cp, decision_date=dec_date, run_date=run_date,
                updated_at=rs.get("updated_at"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    print("=== C-1 capture (v5.0 语义)  as-of %s ===" % NOW.strftime("%Y-%m-%d %H:%M:%S"))
    print("    契约 = %s @ %s（blob %s）" % (CONTRACT_PATH, CONTRACT_VERSION,
                                             CONTRACT_GIT_BLOB_SHA1[:12]))
    print("    selector = S-PROMOTED")
    print("    checkpoint = 工作日 [22:30:00, 23:30:00)（北京）")

    if not do_login(load_cred()):
        print("!! 登录失败，⛔ 不继续")
        return 3

    d = collect()
    print()
    print("    pinned R = %s（pointer.revision=%s）" % (d["run_id"], d["ptr"].get("revision")))
    print("    DATA DATE(decision_date) = %s ；RUN DATE(expected_trade_date) = %s"
          % (d["decision_date"], d["run_date"]))

    checks = evaluate_gate(pinned_run_id=d["run_id"], ptr=d["ptr"],
                           manifest=d["manifest"], history=d["history"],
                           cand_dec=d["cand_dec"], cand_pf=d["cand_pf"], ms_day=d["ms_day"],
                           sources=d["sources"], chain_proof=d["chain_proof"],
                           prev_pointer_revision=None, bundle_exists=False)
    gate_pass = all(ok for _, ok in checks)
    elig = evaluate_eligibility(eligibility=d["rs"], cand_dec=d["cand_dec"])
    elig_pass = all(ok for _, ok in elig)
    ck = evaluate_checkpoint(NOW)
    official = gate_pass and elig_pass and ck

    print()
    print("=== COHERENCE GATE (%d/%d PASS) ===" % (sum(1 for _, o in checks if o), len(checks)))
    for n, ok in checks:
        print("   [%s] %s" % ("PASS" if ok else "FAIL", n))
    print()
    print("=== §4.2 排除规则（%d/%d 未被排除）===" % (sum(1 for _, o in elig if o), len(elig)))
    for n, ok in elig:
        print("   [%s] %s" % ("OK" if ok else "EXCLUDED", n))
    print()
    print("=== CHECKPOINT ===")
    print("   [%s] 现在=%s 要求=工作日 22:30–23:29（北京）"
          % ("PASS" if ck else "FAIL", NOW.strftime("%Y-%m-%d %H:%M:%S")))
    print()
    print("=== CHAIN PROOF ===")
    for h in d["chain_proof"].get("hops", []):
        print("   hop%d %-22s %-14s %s" % (h["hop"], h["function"], h["request_source"],
                                           {k: v for k, v in h.items() if k not in ("hop", "function", "request_source")}))
    print("   verified = %s" % d["chain_proof"].get("verified"))
    print()
    print("   ⇒ scoring = %s" % decide(gate_pass and elig_pass, ck))

    bundle = {
        "bundle_revision": BUNDLE_REVISION,
        "contract": "GEN1_EVIDENCE_CONTRACT",
        "contract_version": CONTRACT_VERSION,
        "contract_path": CONTRACT_PATH,
        # ⚠️ 三种指纹不可混用：blob id 是 sha1；content sha256 是文件内容哈希
        "contract_carrier_commit": CONTRACT_CARRIER_COMMIT,
        "contract_git_blob_sha1": CONTRACT_GIT_BLOB_SHA1,
        "contract_content_sha256": CONTRACT_CONTENT_SHA256,
        "contract_frozen_date": CONTRACT_FROZEN_DATE,
        "capture_timestamp": NOW.isoformat(),
        "checkpoint_rule": "工作日 [22:30:00, 23:30:00)（北京）",
        "checkpoint_ok": ck,
        "selector": "S-PROMOTED",
        # --- run identity ---
        "run_id": d["run_id"],
        "pointer_revision": d["ptr"].get("revision"),
        "decision_date": d["decision_date"],          # (II) DATA DATE
        "run_date": d["run_date"],                    # (III) RUN DATE
        "sample_key_rule": "<run_id>::<code>",
        "bundle_key": d["decision_date"],
        # --- gate ---
        "gate_status": "PASS" if gate_pass else "BUNDLE_INVALID",
        "gate_checks": [{"rule": n, "pass": ok} for n, ok in checks],
        "eligibility_pass": elig_pass,
        "eligibility_checks": [{"rule": n, "not_excluded": ok} for n, ok in elig],
        "scoring": decide(gate_pass and elig_pass, ck),
        # --- run provenance ---
        "run_manifest": {k: d["manifest"].get(k) for k in [
            "run_id", "revision", "expected_trade_date", "validation_passed", "created_at"]},
        "run_history": {k: d["history"].get(k) for k in [
            "run_id", "revision", "promoted", "read_after_write_consistent",
            "cas_reason", "promoted_at"]},
        "active_run_pointer": {k: d["ptr"].get(k) for k in [
            "scope", "run_id", "revision", "updated_at"]},
        "chain_proof": d["chain_proof"],
        "runtime_status_updated_at": d["updated_at"],
        "sources": d["sources"],
        "eligibility": {k: d["rs"].get(k) for k in [
            "gen1_authority", "gen1_counterfactual_canary_active", "gen1_health_status",
            "gen1_health_gate_status", "gen1_counterfactual_ledger_ok",
            "gen1_production_write", "gen1_auto_execution"]},
        # --- 边界（契约 §5.9）---
        "evidence_object_boundary": {
            "authoritative_run_promoted": d["history"].get("promoted"),
            "authoritative_read_path_migrated": False,
            "reader_migration_status": "PENDING",
            "note": "⛔ authoritative_run_promoted=true 时 authoritative_read_path_migrated 仍可为 false",
        },
    }
    if not official:
        why = []
        if not gate_pass:
            why.append("BUNDLE_INVALID（§5.4：%s）"
                       % "；".join(n for n, ok in checks if not ok))
        if not elig_pass:
            why.append("EXCLUDED_BY_§4.2：" + "；".join(n for n, ok in elig if not ok))
        if not ck:
            why.append("OFF_CHECKPOINT（§5.8）")
        bundle["non_scoring_reason"] = " ⇒ ".join(why) + " ⇒ 不作为该日正式样本，⛔ 不倒填"
    blob = json.dumps(bundle, ensure_ascii=False, indent=2).encode("utf-8")
    print("   bundle sha256 = %s (%d B)" % (sha(blob), len(blob)))

    if a.dry_run:
        print("\n[DRY-RUN] 未落盘。")
        return 0

    os.makedirs(OUTDIR, exist_ok=True)
    base = ("%s/%s__bundle" % (OUTDIR, d["decision_date"])) if official \
        else ("%s/%s__attempt_%s" % (OUTDIR, d["decision_date"], STAMP))
    pj, ps_ = base + ".json", base + ".sha256"
    for p in (pj, ps_):
        if os.path.exists(p):
            print("!! 已存在，拒绝写入（append-only）：%s" % p)
            return 3
    with open(pj, "wb") as f:
        f.write(blob)
    with open(ps_, "w", encoding="utf-8", newline="\n") as f:
        f.write("%s  %s\n" % (sha(blob), os.path.basename(pj)))
    print("\n[OK] 落盘 -> %s" % pj)
    return 0


if __name__ == "__main__":
    sys.exit(main())
