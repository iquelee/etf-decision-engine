# -*- coding: utf-8 -*-
"""
**V6.0 CONTRACT ↔ EVIDENCE TOOLCHAIN 对齐校验**（V6.0 FREEZE 批次）

证明四层语义一致（⛔ 不是「只有 Contract 自己通过测试」）：

  L1  Contract §5.6  ↕  trigger_registry.js + fixtures/trigger_registry.json
  L2  Contract §5.8  ↕  checkpoint_discriminator.js
  L3  Contract §5.8  ↕  c1_capture.py（采集工具）
  L4  c1_capture.py  ↕  c1_gate_redproof.py（red-proof 工具）
  L5  Contract §5.8  ↕  c1_gate_redproof.py（W1/W2 期望）

★ 版本错配反向证明（owner §七）：
  `--reverse-proofs` ⇒ 分别用 **v5.0 基线字节**替换 capture / redproof ⇒ **ALIGNMENT 必须 FAIL**；
     仅当 V6 Contract + V6 capture + V6 redproof 三者齐备时 ALIGNMENT = PASS。
  ⇒ 证明三个绑定对象**具有约束力**，⛔ 不是「记录用字段」。

用法：
  python v6_contract_tool_alignment.py                 # 默认（真实文件）
  python v6_contract_tool_alignment.py --capture <p> --redproof <p>   # 替换（错配实验）
  python v6_contract_tool_alignment.py --reverse-proofs  # 自跑三条反向证明
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

CONTRACT = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md")
CANDIDATE = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md")
REG_JS = os.path.join(HERE, "trigger_registry.js")
REG_JSON = os.path.join(HERE, "fixtures", "trigger_registry.json")
DISCRIM = os.path.join(HERE, "checkpoint_discriminator.js")
CAPTURE = os.path.join(HERE, "c1_capture.py")
REDPROOF = os.path.join(HERE, "c1_gate_redproof.py")

V5_REV = "7d2f39bddd681cce9d714558d518b06631451d01"
V5_CAPTURE_SHA = "dd2ea8b0090853e36a28e8590fbf62519b2e7461ab7a5160c0e475a9841c8c42"

PASSL, FAILL = [], []


def ck(layer, name, cond, detail=""):
    (PASSL if cond else FAILL).append((layer, name))
    print("   [%s][%s] %s %s" % ("PASS" if cond else "FAIL", layer, name, detail))
    return cond


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def read(p):
    return open(p, encoding="utf-8").read()


def git_show(relpath):
    out = subprocess.run(["git", "-C", CARRIER, "show", "%s:%s" % (V5_REV, relpath)],
                         capture_output=True)
    if out.returncode != 0:
        raise RuntimeError("git show failed: %s" % out.stderr.decode("utf-8", "replace")[:200])
    return out.stdout


def run(capture_path=None, redproof_path=None, header=True):
    global PASSL, FAILL
    PASSL, FAILL = [], []
    cap_p = capture_path or CAPTURE
    red_p = redproof_path or REDPROOF
    c = read(CONTRACT)
    reg = json.load(open(REG_JSON, encoding="utf-8"))
    regjs = read(REG_JS)
    disc = read(DISCRIM)
    cap = read(cap_p)
    red = read(red_p)

    if header:
        print("== V6.0 CONTRACT ↔ EVIDENCE TOOLCHAIN 对齐校验 ==")
        print("   Contract  = %s" % os.path.relpath(CONTRACT, CARRIER))
        print("             sha256 = %s" % sha(CONTRACT))
        print("   capture   = %s  sha256 = %s" % (os.path.basename(cap_p), sha(cap_p)))
        print("   redproof  = %s  sha256 = %s" % (os.path.basename(red_p), sha(red_p)))
        print("   registry  = trigger_registry.js  sha256 = %s" % sha(REG_JS))
        print("   discrim   = checkpoint_discriminator.js  sha256 = %s" % sha(DISCRIM))
        print()
        print("-- L1  Contract §5.6 ↔ trigger_registry.js / fixtures --")

    # ---------------- L1 ----------------
    i56 = c.find("#### 5.6.3 ★ **完整 Trigger Registry**")
    i57 = c.find("### 5.7 ")
    sec56 = c[i56:i57] if i56 >= 0 and i57 > i56 else ""
    ck("L1", "§5.6.3 Trigger Registry 章节存在", bool(sec56))
    miss = []
    for e in reg["entries"]:
        for tok in [e["trigger_id"], e["schedule_cron"], e["entry_point"]] + list(e["writes_collections"]):
            if tok not in sec56:
                miss.append("%s:%s" % (e["trigger_id"], tok))
    ck("L1", "§5.6.3 覆盖全部 %d 个 trigger（id/cron/entry/写入集合）" % len(reg["entries"]),
       not miss, "缺=%s" % miss[:6])
    ck("L1", "§5.6.4 绑定 registry 夹具与校验器（契约 ↔ 工具链 显式绑定）",
       "trigger_registry.json" in c and "trigger_registry.js" in c)
    ck("L1", "registry.js 以夹具为**唯一**数据源（`readFileSync`，⛔ 不内嵌副本 ⇒ 无漂移空间）",
       "readFileSync" in regjs and "trigger_registry.json" in regjs
       and "trigger_registry_cloud_observed.json" in regjs)
    ck("L1", "registry.js 实现 §5.6.4 校验（缺列 / 云有登记无 / 登记有云无 / 八源）",
       "missing" in regjs and "spurious" in regjs and "eight_sources" in regjs)
    ck("L1", "契约声明 3 个无调度留册函数 + 2 个云端不存在项",
       all(f in sec56 for f in ["runDecisionEngine", "adminGateway", "apiGateway"])
       and "runIntegratedShadowEod" in sec56 and "dailyFetch-1530" in sec56)

    if header:
        print("\n-- L2  Contract §5.8 ↔ checkpoint_discriminator.js --")
    i58 = c.find("### 5.8 `CANONICAL_CAPTURE_CHECKPOINT`")
    i59 = c.find("### 5.9 ★")
    sec58 = c[i58:i59]
    ck("L2", "§5.8 绑定 `checkpoint_discriminator.js`（契约 ↔ 判别器）",
       "checkpoint_discriminator.js" in sec58)
    ck("L2", "判别器含 W1/W2 双窗口与 first-window-wins 实现",
       "checkpoint_windows_cases.json" in disc and "firstWindowWins" in disc)
    w = {x["id"]: x for x in json.load(open(os.path.join(HERE, "fixtures",
                                                        "checkpoint_windows_cases.json"),
                                            encoding="utf-8"))["windows"]}
    ck("L2", "§5.8 窗口字面量 == 判别器夹具（W1 22:30–23:30 / W2 08:30–09:30）",
       ("W1 = [22:30:00, 23:30:00)" in sec58) and w["W1"]["start"] == "22:30"
       and w["W1"]["end"] == "23:30" and ("W2 = 次一工作日 [08:30:00, 09:30:00)" in sec58)
       and w["W2"]["start"] == "08:30" and w["W2"]["end"] == "09:30")
    ck("L2", "§5.8 绑定 checkpoint_python_js_parity.py（Python ↔ JS 奇偶）",
       "checkpoint_python_js_parity.py" in sec58)

    if header:
        print("\n-- L3  Contract §5.8 ↔ c1_capture.py（采集工具）--")
    # 冻结绑定常量
    fz = sha(CONTRACT)
    ck("L3", "采集工具绑定契约路径 = 冻结载体路径",
       'CONTRACT_PATH = "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md"' in cap)
    ck("L3", "采集工具绑定契约版本 = v6.0", 'CONTRACT_VERSION = "v6.0"' in cap)
    ck("L3", "★ 采集工具 `CONTRACT_CONTENT_SHA256` == 冻结载体实测 sha256", fz in cap, fz[:16])
    ck("L3", "采集工具无 `PENDING_AT_V6_FREEZE` 占位（冻结已填实）",
       "PENDING_AT_V6_FREEZE" not in cap)
    # 窗口/规则一致
    ck("L3", "采集工具 `CHECKPOINT_WINDOWS` = W1/W2 且与契约字面量一致",
       '{"id": "W1", "start": "22:30", "end": "23:30"}' in cap
       and '{"id": "W2", "start": "08:30", "end": "09:30"}' in cap
       and "W1 = [22:30:00, 23:30:00)" in sec58)
    ck("L3", "采集工具含 `evaluate_checkpoint_v6`（返回 window_id）与 first-window-wins",
       "def evaluate_checkpoint_v6(now):" in cap and '"window_id": w["id"]' in cap
       and "def first_window_wins_checkpoint(sessions):" in cap)
    ck("L3", "★ 采集工具**已消除**旧单窗口表达式（v5.0 语义不残留）",
       "(now.hour == 22 and now.minute >= 30) or (now.hour == 23 and now.minute < 30)" not in cap)
    ck("L3", "采集工具 bundle 记录 `checkpoint_window_id` 且 ⛔ 声明非独立判据",
       '"checkpoint_window_id": ck["window_id"]' in cap and "非独立判据" in cap)
    ck("L3", "采集工具 CHAIN WINDOWS = W1-2200 / W2-0800 双链",
       '"W1-2200"' in cap and '"W2-0800"' in cap and '"materializeIndicators"' in cap)
    ck("L3", "采集工具 ⛔ 不自行判定独立事件（引用 §3.4A，⛔ 无 independent_event）",
       "§3.4A" in cap and "independent_event" not in cap)

    if header:
        print("\n-- L4  c1_capture.py ↔ c1_gate_redproof.py --")
    ck("L4", "red-proof 调用采集工具的 `evaluate_checkpoint_v6`",
       "C.evaluate_checkpoint_v6(" in red)
    ck("L4", "red-proof 调用采集工具的 `first_window_wins_checkpoint`",
       "C.first_window_wins_checkpoint(" in red)
    ck("L4", "red-proof 含 W2 边界期望（08:30 / 09:30）",
       '"2026-10-02 08:30 周五"' in red and '"2026-10-02 09:30 周五"' in red)
    ck("L4", "★ red-proof 含「旧单窗口规则恢复 ⇒ 必 FAIL」反向证明",
       "_mutant_v5_single_window" in red and "[6d]" in red)
    ck("L4", "red-proof 含 same-bundle 非独立 + different-provenance 独立两段",
       "SAME-BUNDLE" in red and "DIFFERENT-PROVENANCE" in red)
    ck("L4", "★ red-proof **已消除**旧 09:00 单窗口期望",
       '("2026-10-01 09:00 周四", datetime.datetime(2026, 10, 1, 9, 0), False)' not in red)

    if header:
        print("\n-- L5  Contract §5.8 ↔ c1_gate_redproof.py（期望一致性）--")
    ck("L5", "red-proof 的 09:00 期望 = 契约 W2 语义（True/W2，⛔ 非 False）",
       '("2026-10-01 09:00 周四", datetime.datetime(2026, 10, 1, 9, 0), True, "W2")' in red)
    ck("L5", "red-proof 的 W1 边界期望 = 契约半开区间",
       '"2026-10-01 22:30 周四", datetime.datetime(2026, 10, 1, 22, 30), True, "W1"' in red
       and '"2026-10-01 23:30 周四", datetime.datetime(2026, 10, 1, 23, 30), False, None' in red)
    ck("L5", "red-proof 文件头声明 v6.0 迁移且引用 §11 规则 5",
       "v6.0 迁移" in red and "§11 规则 5" in red)

    verdict = (not FAILL)
    if header:
        print("\n======================================================")
        print("TOOL ALIGNMENT = %s（%d PASS / %d FAIL）"
              % ("✅ PASS" if verdict else "❌ FAIL", len(PASSL), len(FAILL)))
        for L, n in FAILL:
            print("   FAIL [%s] %s" % (L, n))
        print("======================================================")
    return verdict, len(PASSL), len(FAILL)


def reverse_proofs():
    """★ owner §七：三条版本错配反向证明。"""
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    base = os.path.join(outdir, "v5-baseline")
    os.makedirs(base, exist_ok=True)
    v5cap = os.path.join(base, "c1_capture.v5.py")
    v5red = os.path.join(base, "c1_gate_redproof.v5.py")
    open(v5cap, "wb").write(git_show("scripts/gen1/evidence-capture/c1_capture.py"))
    open(v5red, "wb").write(git_show("scripts/gen1/evidence-capture/c1_gate_redproof.py"))
    print("v5.0 基线（自 %s 抽出）" % V5_REV)
    print("  c1_capture.py       sha256 = %s" % sha(v5cap))
    print("  c1_gate_redproof.py sha256 = %s" % sha(v5red))
    assert sha(v5cap) == V5_CAPTURE_SHA, "v5 基线抽取与期望不符"

    results = []
    print("\n########## [RP-A] V6 Contract + **V5 capture** + V6 redproof ##########")
    v, p, f = run(capture_path=v5cap, redproof_path=None, header=True)
    results.append(("RP-A", "V6 Contract + V5 capture + V6 redproof", "FAIL", v))
    print("\n########## [RP-B] V6 Contract + V6 capture + **V5 redproof** ##########")
    v2, p2, f2 = run(capture_path=None, redproof_path=v5red, header=True)
    results.append(("RP-B", "V6 Contract + V6 capture + V5 redproof", "FAIL", v2))
    print("\n########## [RP-C] V6 Contract + V6 capture + V6 redproof ##########")
    v3, p3, f3 = run(header=True)
    results.append(("RP-C", "V6 Contract + V6 capture + V6 redproof", "PASS", v3))

    print("\n======================================================")
    print("★ 版本错配反向证明汇总")
    ok = True
    for tag, desc, expect, got in results:
        want = (expect == "PASS")
        good = (got == want)
        ok &= good
        print("   [%s] %s ⇒ ALIGNMENT = %s（期望 %s）"
              % ("OK" if good else "!!", tag + " " + desc, "PASS" if got else "FAIL", expect))
    print("   结论：%s" % ("✅ 三个绑定对象具约束力（记录字段无法蒙过）" if ok else "❌ 反向证明未成立"))
    print("======================================================")
    return ok


def main():
    if "--reverse-proofs" in sys.argv:
        return 0 if reverse_proofs() else 1
    cap = red = None
    if "--capture" in sys.argv:
        cap = sys.argv[sys.argv.index("--capture") + 1]
    if "--redproof" in sys.argv:
        red = sys.argv[sys.argv.index("--redproof") + 1]
    v, p, f = run(capture_path=cap, redproof_path=red)
    return 0 if v else 1


if __name__ == "__main__":
    sys.exit(main())
