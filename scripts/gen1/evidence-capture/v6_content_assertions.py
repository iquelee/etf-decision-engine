# -*- coding: utf-8 -*-
"""
V6.0 FREEZE CANDIDATE **内容断言套件**（V6.0 FREEZE PREPARATION 批次）

两类断言：
  (P) **正向**：必须出现的关键条款 / 字面量 / 计数（缺一即 FAIL）
  (N) **禁语**：必须**零命中**的历史残留 / 自指语句（出现即 FAIL）

设计目标：本套件是 `GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md` 的
**可执行验收单** —— 同时被 `v6_redproof.py` 复用做「变异 ⇒ 必 FAIL」的打红自证。

用法：
  python v6_content_assertions.py                 # 对真实候选件跑一遍
  python v6_content_assertions.py --quiet         # 仅打印汇总
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
V5 = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md")
V6 = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md")
REG = os.path.join(HERE, "fixtures", "trigger_registry.json")

# ⛔ 禁语清单（V6.0 中必须 0 命中）
FORBIDDEN = [
    "PRE-V5 DIAGNOSTIC",
    "WP-G1-EVIDENCE-CH-5.0",
    "### 变更日志### 变更日志",
    "本文件已于",
    "发布 **v6.0**，并**显式作废 v5.0 全部样本**",
    "🔒 **FROZEN（2026-10-02）** ｜ 📌 **载体封存记录",
    "v5.0（🔒 **FROZEN**，2026-10-02）",
    "v5.0 CONTRACT GENERATION      ✅ DONE",
]


def run_assertions(v6, reg=None, v5=None):
    """返回 (passes, fails, notes)。notes = 关键计数明细（便于报告引用）。"""
    P, F, N = [], [], {}
    reg = reg or json.load(open(REG, encoding="utf-8"))

    def pos(name, cond, detail=""):
        (P if cond else F).append(name if not detail else "%s %s" % (name, detail))
        return cond

    # ---------------- (a) 结构完整性 ----------------
    order = ["## 0. ", "## 1. ", "## 2. ", "## 3. ", "## 4. ", "## 5. ",
             "## 6. ", "## 7. ", "## 8. ", "## 9. ", "## 10. ", "## 11. ",
             "## 12. ", "## 13. "]
    idx = [v6.find(x) for x in order]
    pos("A-1 §0–§13 全部存在且顺序正确",
        all(i >= 0 for i in idx) and idx == sorted(idx))
    newsec = ["## 1.6 ", "### 3.4A ", "### 9.5 ", "### 13.2 "]
    pos("A-2 v6.0 四个新增章节齐备（§1.6 / §3.4A / §9.5 / §13.2）",
        all(x in v6 for x in newsec), str([x for x in newsec if x not in v6]))
    heads = [m.group(2).strip() for m in re.finditer(r"^(#{2,3}) (.+)$", v6, re.M)]
    dup = sorted({h for h in heads if heads.count(h) > 1})
    # ★ 行内嵌入型残迹（`### X### X`）：单行仍是「一个标题」，故必须单独检测
    embedded = [m.group(0)[:60] for m in re.finditer(r"^#{2,3} .*#{2,3} .*$", v6, re.M)]
    pos("A-3 标题无重复（%d 个标题）且标题行内未嵌入第二个标题标记" % len(heads),
        (not dup) and (not embedded), "重复=%s 行内嵌入=%s" % (dup, embedded[:2]))
    pos("A-4 纯 LF（无 CRLF）", "\r\n" not in v6)
    pos("A-5 17 列 Evidence 字段表齐备（`| 17 |` 恰一处）", v6.count("| 17 |") == 1)

    # ---------------- (b) §3.4A 独立性判据 ----------------
    pos("B-1 §3.4A 存在且标题含 INDEPENDENCE REQUIREMENTS",
        "### 3.4A ★ `INDEPENDENCE REQUIREMENTS`" in v6)
    i34a = v6.find("### 3.4A")
    i35 = v6.find("### 3.5 ★")
    sec34a = v6[i34a:i35]
    pos("B-2 I1–I7 七条齐备（逐条 `  I<n> `）",
        all(("  I%d " % n) in sec34a for n in range(1, 8)),
        str([n for n in range(1, 8) if ("  I%d " % n) not in sec34a]))
    pos("B-3 I1–I7 条数与契约一致（恰 7 条，无 I8）",
        len(re.findall(r"^  I\d ", sec34a, re.M)) == 7
        and ("  I8 " not in sec34a))
    # ⚠️ 常量**本体**住在冻结的 §3.4（v6.0 ⛔ 不改 §3.4）；§3.4A 只**引用**它，⛔ 不重定义。
    i34 = v6.find("### 3.4 ★")
    sec34 = v6[i34:i34a]
    pos("B-4a `CLUSTER_GAP_DAYS = 10` 本体位于 §3.4（冻结段，v6.0 ⛔ 未改）",
        "CLUSTER_GAP_DAYS = 10" in sec34)
    pos("B-4b §3.4A 引用 `CLUSTER_GAP_DAYS` 且 ⛔ 未重定义（不出现赋值）",
        "CLUSTER_GAP_DAYS" in sec34a and "CLUSTER_GAP_DAYS =" not in sec34a)
    pos("B-5 fail-closed 双分支齐备（NOT_EVALUABLE / NOT_INDEPENDENT）",
        "NOT_EVALUABLE（不得计入独立事件）" in sec34a
        and "NOT_INDEPENDENT（不得计入独立事件）" in sec34a)
    pos("B-6 `sufficiency_scope = NECESSARY_CONDITIONS_ONLY`",
        "sufficiency_scope = NECESSARY_CONDITIONS_ONLY" in sec34a)
    pos("B-7 排除清单含 `trigger` / `trigger_id` 与 **capture 窗口身份（W1 / W2）**",
        "`trigger` / `trigger_id`" in sec34a and "capture 窗口身份（W1 / W2）" in sec34a)
    pos("B-8 计数规则 = 「+2，非 +1」且 NOT_INDEPENDENT 不计数",
        "（+2，非 +1）" in sec34a and "不**增加独立事件计数" in sec34a)
    pos("B-9 §5.8 侧互证句：窗口不同 / trigger 不同 / run_id 不同 均不产生第二个独立事件",
        "⛔ **窗口不同 / trigger 不同 / run_id 不同** 均**不**产生第二个独立 Evidence 事件" in v6)
    N["I1-I7 条数"] = len(re.findall(r"^  I\d ", sec34a, re.M))

    # ---------------- (c) §5.6 Trigger Registry ----------------
    pos("C-1 §5.6.3 标题含 `Trigger Registry`", "#### 5.6.3 ★ **完整 Trigger Registry**" in v6)
    tids = [e["trigger_id"] for e in reg["entries"]]
    miss = [t for t in tids if t not in v6]
    pos("C-2 全部 %d 个 trigger_id 出现" % len(tids), not miss, str(miss))
    pos("C-3 3 个无调度留册函数齐备",
        all(f in v6 for f in ["runDecisionEngine", "adminGateway", "apiGateway"]))
    pos("C-4 2 个云端不存在项齐备",
        "runIntegratedShadowEod" in v6 and "dailyFetch-1530" in v6)
    pos("C-5 §5.6.4 绑定 registry 夹具与校验器",
        "trigger_registry.json" in v6 and "trigger_registry.js" in v6)
    N["trigger_id 数"] = len(tids)

    # ---------------- (d) §5.8 checkpoint 重锚 ----------------
    i58 = v6.find("### 5.8 `CANONICAL_CAPTURE_CHECKPOINT`")
    i59 = v6.find("### 5.9 ★")
    sec58 = v6[i58:i59]
    pos("D-1 W1 窗口字面量 `W1 = [22:30:00, 23:30:00)` 在 §5.8",
        "W1 = [22:30:00, 23:30:00)" in sec58)
    pos("D-2 W2 窗口字面量 `W2 = 次一工作日 [08:30:00, 09:30:00)` 在 §5.8",
        "W2 = 次一工作日 [08:30:00, 09:30:00)" in sec58)
    pos("D-3 `first-window-wins` 在 §5.8 出现 ≥3 次",
        sec58.count("first-window-wins") >= 3, "n=%d" % sec58.count("first-window-wins"))
    pos("D-4 静默性质穷举表 + `CHECKPOINT_SILENCE` 绑定在 §5.8",
        "CHECKPOINT_SILENCE" in sec58)
    pos("D-5 两条 PROMOTION-CAPABLE 链 + 「其 run 是否自动成为独立事件 = ⛔ 否」",
        "W1-2200" in sec58 and "W2-0800" in sec58
        and "其 run 是否自动成为独立事件" in sec58
        and "⛔ **否**" in sec58)
    pos("D-6 `checkpoint_discriminator.js` 绑定在 §5.8",
        "checkpoint_discriminator.js" in sec58)
    N["§5.8 first-window-wins 次数"] = sec58.count("first-window-wins")

    # ---------------- (e) 治理 / 版本 ----------------
    pos("E-1 文档编号 = `WP-G1-EVIDENCE-CH-6.0`", "`WP-G1-EVIDENCE-CH-6.0`" in v6)
    pos("E-2 状态 = 🧪 FREEZE CANDIDATE 且显式 ⛔ NOT FROZEN",
        "🧪 **FREEZE CANDIDATE**" in v6 and "⛔ **NOT FROZEN**" in v6)
    pos("E-3 V5.0 = SUPERSEDED / INVALID FOR NEW EVIDENCE",
        "SUPERSEDED / INVALID FOR NEW EVIDENCE" in v6)
    pos("E-4 §11 规则 2 版本位 = v7.0（⛔ 非自指 v6.0）",
        "发布 **v7.0**，并**显式作废 v6.0 全部样本**" in v6)
    pos("E-5 `R3 = OBSERVATION` 且显式否定 CONTRACT GAP",
        "**`R3 = OBSERVATION`**（⛔ **非** `CONTRACT GAP`）" in v6)
    pos("E-6 `CD-06` / `CD-07` 已登记", "`CD-06`" in v6 and "`CD-07`" in v6)
    pos("E-7 `PRE-V6 DIAGNOSTIC` 标记确立", "PRE-V6 DIAGNOSTIC" in v6)
    pos("E-8 §12 未决项 ≥15 项", len(re.findall(r"^\| \d+ \| ", v6[v6.find("## 12. 未决项"):v6.find("## 13. ")], re.M)) >= 15)
    pos("E-9 「V5.0 载体 immutable 声明（owner B1）」齐备",
        "**⛔ V5.0 载体 immutable 声明（owner B1）**" in v6)
    pos("E-10 B3 = NOT YET AUTHORIZED 已在 §11 规则 5 记录",
        "`B3 = NOT YET AUTHORIZED`" in v6)

    # ---------------- (f) 禁语零命中 ----------------
    fb = {s: v6.count(s) for s in FORBIDDEN}
    pos("F-1 %d 条禁语全部零命中" % len(FORBIDDEN),
        all(c == 0 for c in fb.values()),
        str({k: c for k, c in fb.items() if c}))

    # ---------------- (g) 与 V5 的关系（若提供） ----------------
    if v5 is not None:
        pos("G-1 V5 载体未被触碰（sha256 与冻结值一致由独立脚本校验）",
            "## 3. 样本字段（17 列，逐日一行一码）" in v5)
        pos("G-2 V6 首部声明取代关系 v6.0 取代 v5.0", "**v6.0 取代 v5.0**" in v6)

    N["禁语数"] = len(FORBIDDEN)
    N["标题数"] = len(heads)
    return P, F, N


def main():
    quiet = "--quiet" in sys.argv
    v5 = open(V5, encoding="utf-8").read()
    v6 = open(V6, encoding="utf-8").read()
    P, F, N = run_assertions(v6, json.load(open(REG, encoding="utf-8")), v5)
    if not quiet:
        print("== V6.0 内容断言套件 ==")
        for i, name in enumerate(P, 1):
            print("   [PASS] %s" % name)
        for name in F:
            print("   [FAIL] %s" % name)
        print()
        for k, v in N.items():
            print("   计数 %-34s = %s" % (k, v))
    print("======================================================")
    print("内容断言：%s（%d PASS / %d FAIL）"
          % ("✅ ALL PASS" if not F else "❌ 存在 FAIL", len(P), len(F)))
    for name in F:
        print("   FAIL: %s" % name)
    print("======================================================")
    return 0 if not F else 1


if __name__ == "__main__":
    sys.exit(main())
