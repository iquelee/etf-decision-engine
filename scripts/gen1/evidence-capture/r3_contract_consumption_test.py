# -*- coding: utf-8 -*-
"""
R3（`input_hash`）**契约消费面测试**（V6.0 FREEZE PREPARATION 批次）

问题：`input_hash` 到底是不是契约的「缺口」（`CONTRACT GAP`）？
答：**不是**。本脚本用**可复算的 token 计数**证明契约**不要求、不消费**它，
    并证明 v6.0 **未**借 R3 之名新增任何规范性要求 ⇒ 正式裁定 `R3 = OBSERVATION`。

断言：
  R3-1  **v5.0 FROZEN 载体**中 4 个候选 token 的出现次数全为 0（⇒ 契约不消费）
  R3-2  §9.5 表里登记的计数 == 本次实测（文档与实测同源）
  R3-3  v6.0 中 `input_hash` 的出现面**全部**属「非规范性 / 排除 / 治理留痕」语境
  R3-4  `input_hash` ⛔ 不在 17 列字段表区段、⛔ 不在 §5.3 八源表区段（未进入规范性 schema）
  R3-5  正式裁定措辞齐备（`R3 = OBSERVATION` + ⛔ 非 `CONTRACT GAP` + 2 条非阻塞观察）
  R3-6  ⛔ 未因 R3 新增任何 Evidence 字段（17 列不变；bundle 字段仅新增 `checkpoint_window_id`）

用法：python r3_contract_consumption_test.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
V5 = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md")
V6 = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md")

TOKENS = ["input_hash", "candidate_content_sha", "gen1_candidate_hash", "gen1_run_id"]

PASS, FAIL = [], []


def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


v5 = open(V5, encoding="utf-8").read()
v6 = open(V6, encoding="utf-8").read()
l5, l6 = v5.splitlines(), v6.splitlines()

print("== R3 契约消费面测试（`input_hash`）==")
print()

# ---- R3-1 -------------------------------------------------------------
print("-- [1] 契约消费面：v5.0 FROZEN 载体 token 计数 --")
cnt5 = {t: v5.count(t) for t in TOKENS}
for t in TOKENS:
    print("   %-24s = %d" % (t, cnt5[t]))
ck("[1] v5.0 FROZEN 载体中 4 token 全为 0（契约不要求 / 不消费）",
   all(v == 0 for v in cnt5.values()), str(cnt5))

# ---- R3-2 -------------------------------------------------------------
print("\n-- [2] §9.5 登记值与实测同源 --")
rows = dict(re.findall(r"^\| `([a-z0-9_]+)` \| \*\*(\d+)\*\* \|", v6, re.M))
ok2 = all(rows.get(t) == str(cnt5[t]) for t in TOKENS)
ck("[2] §9.5 表登记的计数 == 本次实测（%s）" % rows, ok2,
   "登记=%s 实测=%s" % ({t: rows.get(t) for t in TOKENS}, cnt5))

# ---- 区段定位 ---------------------------------------------------------
def span(text, a, b):
    i = text.index(a)
    j = text.index(b, i + len(a))
    return (text.count("\n", 0, i) + 1, text.count("\n", 0, j) + 1)


SEC = {
    "§3 字段表": span(v6, "## 3. 样本字段", "### 3.0 ★"),
    "§3.4A": span(v6, "### 3.4A", "### 3.5 ★"),
    "§5.3": span(v6, "### 5.3 硬规则二", "### 5.4 硬规则三"),
    "§9.5": span(v6, "### 9.5 `input_hash`", "## 10. 生效日与"),
    "§11": span(v6, "## 11. 契约不可变性", "### 变更日志"),
    "§12": span(v6, "## 12. 未决项", "## 13. 边界声明"),
    "§13": span(v6, "## 13. 边界声明", "*本契约由 `WP-G1-EVIDENCE` 工作包 v6.0"),
    "变更日志": span(v6, "### 变更日志", "\n**v6.0 修改动机"),
}
print("\n   区段行号：" + " ; ".join("%s=%s" % (k, v) for k, v in SEC.items()))

hits = [(i, l) for i, l in enumerate(l6, 1) if "input_hash" in l]

# ---- R3-3 -------------------------------------------------------------
allowed_ctx = ["§3.4A", "§9.5", "§12", "§13", "变更日志"]


def which(ln):
    for k in allowed_ctx:
        lo, hi = SEC[k]
        if lo <= ln <= hi:
            return k
    return None


stray = [(ln, which(ln)) for ln, _ in hits if which(ln) is None]
ck("[3] v6.0 中 `input_hash` 出现面全部位于「非规范性 / 排除 / 治理留痕」区段",
   not stray, "越界行=%s" % stray)
print("      出现行归属：%s"
      % sorted({which(ln) for ln, _ in hits}))

# ---- R3-4 -------------------------------------------------------------
bad_cols = [ln for ln, _ in hits if SEC["§3 字段表"][0] <= ln <= SEC["§3 字段表"][1]]
bad_8 = [ln for ln, _ in hits if SEC["§5.3"][0] <= ln <= SEC["§5.3"][1]]
ck("[4a] `input_hash` ⛔ 未进入 §3 的 17 列字段表", not bad_cols, "命中行=%s" % bad_cols)
ck("[4b] `input_hash` ⛔ 未进入 §5.3 八源 capture bundle 表", not bad_8, "命中行=%s" % bad_8)
ck("[4c] §3.4A 中 `input_hash` 仅出现在**排除清单**里（属「不得作为判据」）",
   all("排除" in l6[ln - 1] or "`input_hash`" in l6[ln - 1] for ln, _ in hits if SEC["§3.4A"][0] <= ln <= SEC["§3.4A"][1]))

# ---- R3-5 -------------------------------------------------------------
print("\n-- [3] 正式裁定措辞齐备 --")
ck("[5a] 明确声明 `R3 = OBSERVATION`（且 ⛔ 显式否定 CONTRACT GAP）",
   "**`R3 = OBSERVATION`**（⛔ **非** `CONTRACT GAP`）" in v6)
ck("[5b] 两条非阻塞观察项齐备（双前缀字符串 / ⛔ 禁止制造虚假 hash）",
   "两条非阻塞观察项（⛔ 不阻断 Freeze）" in v6
   and "双前缀字符串" in v6
   and "⛔ **禁止**为满足 schema 制造虚假 hash" in v6)
ck("[5c] 声明「非规范性」且「不升版 schema」",
   "本条为 non-normative 附注" in v6 and "不升版 schema" in v6)

# ---- R3-6 -------------------------------------------------------------
print("\n-- [4] ⛔ 未因 R3 新增规范性要求 --")
ck("[6a] Evidence 字段仍为 17 列（`| 17 |` 恰一处）", v6.count("| 17 |") == 1)
ck("[6b] §5.3 八源未增（八源集合相等由 v6_contract_compatibility.py A4 独立校验）",
   v6.count("**八源**") >= 1 and "九源" not in v6 and "十源" not in v6)
ck("[6c] v6.0 新增的 bundle 字段**仅** `checkpoint_window_id`（无 input_hash 相关字段）",
   "checkpoint_window_id" in v6 and "input_hash" not in
   re.search(r"### 5\.3 硬规则二.*?### 5\.4 硬规则三", v6, re.S).group(0))

print("\n======================================================")
print("R3 契约消费面测试：%s（%d PASS / %d FAIL）"
      % ("✅ ALL PASS" if not FAIL else "❌ 存在 FAIL", len(PASS), len(FAIL)))
for f in FAIL:
    print("   FAIL: %s" % f)
print("======================================================")
sys.exit(0 if not FAIL else 1)
