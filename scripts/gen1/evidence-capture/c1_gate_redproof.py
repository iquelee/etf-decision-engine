# -*- coding: utf-8 -*-
"""
C-1 门逻辑打红自证（mutation test）—— **v5.0 语义**

纪律（本仓既定）：
  · 真实数据作基线 ⇒ 先如实报告实时态；
  · 构造**归纳基线**（把 14 条显式置为可通过）⇒ 断言 14/14 PASS；
  · 逐条变异 ⇒ 断言**目标规则必 FAIL**；
  · 规则 14（禁令）为**结构性**判据 ⇒ 以**源码扫描**自证，⛔ 不用变异法（无对应状态位）。
  · ⛔ 只读：仅调用 c1_capture.collect()（内部走构造期只读门）；⛔ 不落盘任何 bundle。
"""
import copy
import datetime
import hashlib
import inspect
import sys

HERE = r"D:/AI-Projects/Codex/etf-decision-engine/_g1-contract-v5-20261002/scripts/gen1/evidence-capture"
sys.path.insert(0, HERE)
import c1_capture as C  # noqa: E402

ok_all = True

print("=== [0] 只读通道登录 ===")
if not C.do_login(C.load_cred()):
    print("!! 登录失败，⛔ 不继续")
    sys.exit(3)

print("=== [1] 抓取真实基线数据（只读）===")
d = C.collect()
R = d["run_id"]
print("    pinned R = %s ； pointer.revision = %s" % (R, d["ptr"].get("revision")))
REAL = dict(pinned_run_id=R, ptr=d["ptr"], manifest=d["manifest"], history=d["history"],
            cand_dec=d["cand_dec"], cand_pf=d["cand_pf"], ms_day=d["ms_day"],
            sources=d["sources"], chain_proof=d["chain_proof"],
            prev_pointer_revision=None, bundle_exists=False)
real = C.evaluate_gate(**REAL)
print("    ⚠️ 实时态（如实报告，不参与断言）：%d/%d PASS"
      % (sum(1 for _, o in real if o), len(real)))
for n, o in real:
    if not o:
        print("       [FAIL] %s" % n)

print()
print("=== [2] 构造归纳基线 ⇒ 断言 14/14 PASS ===")
BASE = copy.deepcopy(REAL)
BASE["ptr"] = {"scope": "production", "run_id": R, "revision": 1}
BASE["pinned_run_id"] = R
BASE["manifest"] = {"run_id": R, "revision": 1, "expected_trade_date": d["run_date"],
                    "validation_passed": True, "created_at": d["manifest"].get("created_at")}
BASE["history"] = {"run_id": R, "revision": 1, "promoted": True,
                   "read_after_write_consistent": True, "cas_reason": "PROMOTED"}
BASE["cand_pf"] = {"run_id": R, "snapshot_date": d["run_date"]}
BASE["chain_proof"] = {"verified": True, "hops": []}
BASE["sources"] = {k: {"sha256": "0" * 64, "bytes": 100} for k in C.SRC_ALL}
base = C.evaluate_gate(**BASE)
npass = sum(1 for _, o in base if o)
print("   归纳基线：%d/%d PASS" % (npass, len(base)))
for n, o in base:
    if not o:
        print("       [!! FAIL] %s" % n)
assert npass == len(base) == 14, "归纳基线必须 14/14 PASS"
print("   ✅ 归纳基线 14/14 PASS")


def run(**over):
    kw = copy.deepcopy(BASE)
    kw.update(over)
    return C.evaluate_gate(**kw)


print()
print("=== [3] 逐条变异 ⇒ 断言目标规则必 FAIL ===")
_cd_drop = copy.deepcopy(BASE["cand_dec"])[:-1]
_cd_date = copy.deepcopy(BASE["cand_dec"])
_cd_date[0]["decision_date"] = "1999-01-01"
_cd_calc = copy.deepcopy(BASE["cand_dec"])
_cd_calc[0]["calc_date"] = "1999-01-01"
_ms_date = copy.deepcopy(BASE["ms_day"])
_ms_date[0]["date"] = "1999-01-01"
_ms_drop = copy.deepcopy(BASE["ms_day"])[:-1]
_s8 = copy.deepcopy(BASE["sources"])
_s8[list(_s8)[0]] = {"sha256": "0" * 64, "bytes": 0}
_ptr0 = dict(BASE["ptr"])
_ptr2 = dict(BASE["ptr"], run_id="engine:1999-01-01:dead")
_mf8 = dict(BASE["manifest"], expected_trade_date="1999-01-01")
_pf9 = dict(BASE["cand_pf"], snapshot_date="1999-01-01")
_h11 = dict(BASE["history"], revision=99)

MUT = [
    ("R1 pin R != pointer.run_id", 0, run(ptr=_ptr2)),
    ("R2 pointer.revision 未前进", 1, run(prev_pointer_revision=1)),
    ("R3 PROMOTION_PROOF promoted=False", 2, run(history=dict(BASE["history"], promoted=False))),
    ("R4 少一只 code（4 只）", 3, run(cand_dec=_cd_drop)),
    ("R5 两行 decision_date 不同（B1）", 4, run(cand_dec=_cd_date)),
    ("R6 ml_shadow_signal.date 不匹配（B2）", 5, run(ms_day=_ms_date)),
    ("R7 calc_date != decision_date（B3）", 6, run(cand_dec=_cd_calc)),
    ("R8 decision_date > expected_trade_date（B4）", 7, run(manifest=_mf8)),
    ("R9 cand_pf.snapshot_date != expected_trade_date（A1）", 8, run(cand_pf=_pf9)),
    ("R10 ml_shadow_signal 少一只 code", 9, run(ms_day=_ms_drop)),
    ("R11 run/revision 三者不一致（A2/A3）", 10, run(history=_h11)),
    ("R12 CHAIN PROOF 未通过", 11, run(chain_proof={"verified": False})),
    ("R13 某源 bytes=0", 12, run(sources=_s8)),
]

for label, idx, res in MUT:
    target = res[idx]
    others = [n for i, (n, o) in enumerate(res) if i != idx and not o]
    good = (target[1] is False)
    ok_all &= good
    print("   [%s] %-46s ⇒ 目标规则 %s；连带 FAIL 数=%d %s"
          % ("OK" if good else "!!", label, "FAIL" if target[1] is False else "PASS(!!)",
             len(others), ("连带：" + str(others)) if others else ""))

print()
print("=== [4] 规则 14（禁令）结构性自证 ===")
src = inspect.getsource(C.evaluate_gate)
FORBIDDEN = ["calendar_version", "calendar_expected_trade_date", "v365_run_integrity",
             "runtime_status.decision_date"]
hits = [t for t in FORBIDDEN if t in src]
print("   扫描 evaluate_gate 源码，禁用日历量 = %s" % FORBIDDEN)
print("   命中 = %s" % (hits or "无"))
ok_all &= (not hits)
print("   [%s] 规则 14：签名与实现均不含日历量，⛔ 结构上不可能把 (IV) 混入判据" % ("OK" if not hits else "!!"))

print()
print("=== [5] §4.2 排除规则 打红自证 ===")
_live = C.evaluate_eligibility(eligibility=d["rs"], cand_dec=BASE["cand_dec"])
print("   ⚠️ 实时态：%d/%d 未被排除；被排除项 = %s"
      % (sum(1 for _, o in _live if o), len(_live),
         [n for n, o in _live if not o] or "无"))
_rs_clean = dict(d["rs"])
_rs_clean["gen1_counterfactual_canary_active"] = True
_rs_clean["gen1_health_gate_status"] = "ACTIVE"
_rs_clean["gen1_counterfactual_ledger_ok"] = True
ELIG = dict(eligibility=_rs_clean, cand_dec=BASE["cand_dec"])
e0 = C.evaluate_eligibility(**ELIG)
print("   构造基线：%d/%d 未被排除" % (sum(1 for _, o in e0 if o), len(e0)))
ok_all &= all(o for _, o in e0)
assert all(o for _, o in e0), "构造基线应全部未被排除"

EMUT = [
    ("§4.2-1 canary_active=False", 0,
     C.evaluate_eligibility(eligibility=dict(_rs_clean, gen1_counterfactual_canary_active=False),
                            cand_dec=BASE["cand_dec"])),
    ("§4.2-2 health_gate=PENDING", 1,
     C.evaluate_eligibility(eligibility=dict(_rs_clean, gen1_health_gate_status="PENDING"),
                            cand_dec=BASE["cand_dec"])),
    ("§4.2-3 ledger_ok=False", 2,
     C.evaluate_eligibility(eligibility=dict(_rs_clean, gen1_counterfactual_ledger_ok=False),
                            cand_dec=BASE["cand_dec"])),
    ("§4.2-4 baseline 缺失", 3,
     C.evaluate_eligibility(eligibility=_rs_clean,
                            cand_dec=[dict(r, suggested_position=None) for r in BASE["cand_dec"]])),
]
for label, idx, res in EMUT:
    good = (res[idx][1] is False)
    ok_all &= good
    print("   [%s] %-28s ⇒ 目标规则 %s" % ("OK" if good else "!!", label,
                                          "EXCLUDED" if good else "OK(!!)"))

print()
print("=== [6] checkpoint 边界（v5.0：工作日 [22:30, 23:30)）===")
CK = [
    ("2026-10-01 22:29 周四", datetime.datetime(2026, 10, 1, 22, 29), False),
    ("2026-10-01 22:30 周四", datetime.datetime(2026, 10, 1, 22, 30), True),
    ("2026-10-01 23:29 周四", datetime.datetime(2026, 10, 1, 23, 29), True),
    ("2026-10-01 23:30 周四", datetime.datetime(2026, 10, 1, 23, 30), False),
    ("2026-10-01 09:00 周四", datetime.datetime(2026, 10, 1, 9, 0), False),
    ("2026-10-01 22:35 周四", datetime.datetime(2026, 10, 1, 22, 35), True),
    ("2026-10-03 22:35 周六", datetime.datetime(2026, 10, 3, 22, 35), False),
    ("2026-10-04 22:35 周日", datetime.datetime(2026, 10, 4, 22, 35), False),
    ("2026-10-02 22:45 周五", datetime.datetime(2026, 10, 2, 22, 45), True),
]
for label, dt, expect in CK:
    got = C.evaluate_checkpoint(dt)
    good = (got == expect)
    ok_all &= good
    print("   [%s] %-24s expect=%-5s got=%-5s" % ("OK" if good else "!!", label, expect, got))

print()
print("=== [7] 总判定 SCORING / NON_SCORING 组合 ===")
for g, c, exp in [(True, True, "SCORING"), (True, False, "NON_SCORING"),
                  (False, True, "NON_SCORING"), (False, False, "NON_SCORING")]:
    got = C.decide(g, c)
    good = got == exp
    ok_all &= good
    print("   [%s] gate=%-5s checkpoint=%-5s ⇒ %s" % ("OK" if good else "!!", g, c, got))

print()
print("=== [8] 契约绑定常量自证 ===")
print("    contract_version      = %s" % C.CONTRACT_VERSION)
print("    carrier_commit        = %s" % C.CONTRACT_CARRIER_COMMIT)
print("    git_blob_sha1         = %s" % C.CONTRACT_GIT_BLOB_SHA1)
print("    content_sha256        = %s" % C.CONTRACT_CONTENT_SHA256)
print("    SRC_ALL 八源 = %s" % C.SRC_ALL)

print()
print("======================================================")
print("打红自证结果：%s（%d 项变异/边界/结构自证全部符合预期）"
      % ("✅ ALL PASS" if ok_all else "❌ 存在不符",
         len(MUT) + 1 + len(EMUT) + len(CK) + 4))
print("======================================================")
sys.exit(0 if ok_all else 1)
