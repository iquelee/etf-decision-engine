# -*- coding: utf-8 -*-
"""
V6.0 **冻结载体**断言套件（V6.0 FREEZE 批次）

目的：独立证明冻结轮**只**动了声明的非规范性区段，且 §0–§10 规范性正文与除 §1.1 / §13.2 外的
**全部子节**逐字节未变 —— ⛔ 不依赖生成器自述。

两类断言：
  (N) 规范性不变性（冻结载体 vs 候选基线）
  (F) 冻结态元数据（必须自称 FROZEN / 必须绑定 Seal / ⛔ 禁语零命中 / ⛔ 无自指 SHA）

用法：python v6_frozen_carrier_assertions.py
"""
import difflib
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
V5 = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md")
CAND = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md")
FROZ = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md")

V5_SHA = "4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b"
CAND_SHA = "e93420a38a4b92c7c5eb577c4cf5af81e6d913dc22df361a1e981978efbef4b1"

PASS, FAIL = [], []


def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


cand = open(CAND, encoding="utf-8").read()
froz = open(FROZ, encoding="utf-8").read()
v5 = open(V5, encoding="utf-8").read()
froz_raw = open(FROZ, "rb").read()

print("== V6.0 冻结载体断言套件 ==")
print("   候选基线 sha256 = %s" % sha(CAND))
print("   冻结载体 sha256 = %s" % sha(FROZ))
print("   冻结载体尺寸   = %d B / %d 行" % (len(froz_raw), froz.count("\n")))
print()


def body_of(text, header):
    i = text.find(header)
    if i < 0:
        return None
    m = re.search(r"^#{2,3} ", text[i + len(header):], re.M)
    return text[i:] if m is None else text[i:i + len(header) + m.start()]


# =====================================================================
print("-- N. 规范性不变性（冻结载体 vs 候选基线）--")

# N-1 §0–§10 顶层章节 body 逐字节未变
top = [m.group(0) for m in re.finditer(r"^## \d+\. .*$", cand, re.M)]
INV_TOP = [h for h in top if int(re.match(r"^## (\d+)\.", h).group(1)) <= 10]
bad1 = [h for h in INV_TOP if body_of(cand, h) != body_of(froz, h)]
ck("N-1 §0–§10 共 %d 个顶层章节 body 逐字节未变" % len(INV_TOP), not bad1, "不一致=%s" % bad1)

# N-2 除 §1.1 / §13.2 外的全部子节 body 逐字节未变
subs = [m.group(0) for m in re.finditer(r"^### \d+\.\d+[A-Z]? .*$", cand, re.M)]
EXEMPT_SUB = ("### 1.1 ", "### 13.2 ")
INV_SUB = [h for h in subs if not h.startswith(EXEMPT_SUB)]
bad2 = [h for h in INV_SUB if body_of(cand, h) != body_of(froz, h)]
ck("N-2 除 §1.1 / §13.2 外全部 %d 个子节 body 逐字节未变" % len(INV_SUB), not bad2,
   "不一致=%s" % bad2)

# N-3 §11 规则 1–4 + 规则 5 规范首句 逐字节未变
i11, i12 = froz.index("## 11. 契约不可变性"), froz.index("## 12. 未决项")
sec11f = froz[i11:i12]
c11, c12 = cand.index("## 11. 契约不可变性"), cand.index("## 12. 未决项")
sec11c = cand[i11 - i11 + c11:c12]
RULES14 = [
    "1. 本文件**冻结后**，字段名、字段定义、纳入/排除规则、判定阈值、selector、checkpoint**不得修改**。",
    "2. 发现错误 → 发布 **v7.0**，并**显式作废 v6.0 全部样本**，从新版本生效日起重新累计。",
    "3. 每次修改必须在变更日志留痕，写明**修改动机**与**是否作废既有样本**。",
    "4. 采样进程与契约修改**不得由同一次决策同时触发**。",
    "5. ⛔ **工具（`c1_capture.py`）的语义迁移与契约冻结同批次**：",
    "   在 **v6.0 冻结之前**，⛔ **不得**把工具改绑到 v6.0 语义（保持 v5.0 语义运行）",
]
ck("N-3 §11 规则 1–4 与规则 5 规范首句逐字节未变（两侧均有）",
   all(x in sec11f for x in RULES14) and all(x in sec11c for x in RULES14),
   "缺=%s" % [x[:20] for x in RULES14 if x not in sec11f])

# N-4 §12 表格：仅第 1·2·8·9·12 项变；其余项逐字未变
def rows11_12(text):
    i = text.index("| # | 事项 | 状态 |")
    j = text.index("\n\n", i)
    return [l for l in text[i:j].splitlines() if re.match(r"^\| \d+ \|", l)]


rc, rf = rows11_12(cand), rows11_12(froz)
ck("N-4a §12 行数守恒（候选 %d → 冻结 %d）" % (len(rc), len(rf)), len(rc) == len(rf) == 15)
ALLOW12 = {1, 2, 8, 9, 12}
same12 = [k + 1 for k, (a, b) in enumerate(zip(rc, rf)) if a == b]
ck("N-4b §12 未变项恰为 %s" % sorted(set(range(1, 16)) - ALLOW12),
   set(same12) == set(range(1, 16)) - ALLOW12,
   "实测未变=%s" % same12)

# N-5 §13.1 随行治理证据表逐字节未变 + §13 生成轮边界区块保留
ck("N-5a §13.1 表格逐字节未变",
   body_of(cand, "### 13.1 随行治理证据（同批入库）") == body_of(froz, "### 13.1 随行治理证据（同批入库）"))
ck("N-5b §13 生成轮边界区块保留（含「未改」声明）",
   "**v6.0 生成轮（2026-10-02，V6.0 FREEZE PREPARATION / 自主）仅做**" in froz
   and "⛔ **未改**：17 列字段定义 / 八源清单 / selector / 判定阈值（Q1/Q2/Q3）/ 纳入与排除规则 / `CLUSTER_GAP_DAYS`。" in froz)

# N-6 与 V5 对照：17 列 / §3 字段表 / 常量 未变（冻结载体仍与 V5 一致）
sec3 = lambda t: t[t.index("## 3. 样本字段"):t.index("### 3.0 ★")]
ck("N-6a §3 字段表（17 列）与 V5 逐字节一致", sec3(v5) == sec3(froz))
ck("N-6b `CLUSTER_GAP_DAYS = 10` 本体仍在 §3.4", "CLUSTER_GAP_DAYS = 10" in
   froz[froz.index("### 3.4 ★"):froz.index("### 3.4A ")])
ck("N-6c selector = S-PROMOTED 未变", froz.count("SELECTOR = S-PROMOTED") >= 1)
ck("N-6d §5.8 W1/W2 字面量未变",
   "W1 = [22:30:00, 23:30:00)" in froz and "W2 = 次一工作日 [08:30:00, 09:30:00)" in froz)

# N-7 ★ 改动面收敛：候选→冻结 的改动行必须落在**声明的**区段内
ALLOWED_TOP = [h for h in top if int(re.match(r"^## (\d+)\.", h).group(1)) >= 11]  # §11 §12 §13
ALLOWED_SUB = [h for h in subs if h.startswith(EXEMPT_SUB)]                          # §1.1 §13.2
ALLOWED_SUB = ALLOWED_SUB + ["### 变更日志"]   # 无数字前缀的子节；与 §11 同级（body_of 在它处截断）
cand_lines = cand.splitlines()
allowed_ranges = []
for h in ALLOWED_TOP + ALLOWED_SUB:
    lo = cand[:cand.index(h)].count("\n") + 1
    body = body_of(cand, h) or ""
    hi = lo + body.count("\n")
    allowed_ranges.append((lo, hi))
# 文件头 + 页脚
allowed_ranges.append((1, cand[:cand.index(INV_TOP[0])].count("\n")))
allowed_ranges.append((cand.rindex("\n---\n") + 1 or 0, len(cand_lines)))
changed = []
for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
        None, cand_lines, froz.splitlines()).get_opcodes():
    if tag != "equal":
        changed.extend(range(i1 + 1, i2 + 1))
oob = [x for x in changed if not any(lo <= x <= hi for lo, hi in allowed_ranges)]
ck("N-7a 候选→冻结 的改动行**未**越出声明区段（逐行判定）", not oob, "越界=%s" % oob[:20])
ck("N-7b 声明区段**确实**被改动（反向断言：白名单不得虚列）", len(changed) > 0,
   "改动行数=%d" % len(changed))

# N-8 归一化对拍（去空白）下的内容改动行亦未越界
N = lambda s: re.sub(r"\s+", "", s)
nc = set()
for t, i1, i2, j1, j2 in difflib.SequenceMatcher(
        None, [N(x) for x in cand_lines], [N(x) for x in froz.splitlines()]).get_opcodes():
    if t != "equal":
        nc.update(range(i1 + 1, i2 + 1))
oob_n = [x for x in sorted(nc) if not any(lo <= x <= hi for lo, hi in allowed_ranges)]
ck("N-8 归一化对拍下的内容改动行亦未越界（双口径交叉验证）", not oob_n, "越界=%s" % oob_n[:20])

# =====================================================================
print("\n-- F. 冻结态元数据 --")
REQ = [
    "🔒 **FROZEN（2026-10-02）**",
    "本文件是 **v6.0 FROZEN 正式载体**",
    "V6.0 CONTRACT FREEZE          🔒 FROZEN（2026-10-02，owner 单独授权）",
    "V6.0 Evidence Freeze Seal     🔒 SEALED",
    "EVIDENCE TOOLCHAIN MIGRATION  ✅ MIGRATED",
    "EVIDENCE TOOL ALIGNMENT       ✅ PASS",
    "✅ **本批次状态：`B3 = MIGRATED`**",
    "| **v6.0 FROZEN** | 2026-10-02 |",
    "**v6.0 冻结轮（2026-10-02",
    "O-1 = APPROVED",
    "`V6.0 CONTRACT = FROZEN`",
    "本文件已于 2026-10-02 冻结",
    "EVIDENCE SEAL (Key 3)         ⛔ NOT AUTHORIZED",
    "V3.6.6 FREEZE                 ⛔ NOT AUTHORIZED",
]
missing = [x for x in REQ if x not in froz]
ck("F-1 冻结态必须出现的 %d 条标记齐备" % len(REQ), not missing,
   "缺=%s" % [x[:36] for x in missing])

FORBID = [
    "🧪 **FREEZE CANDIDATE（2026-10-02）**",
    "⛔ **NOT FROZEN**",
    "V6.0_FREEZE_CANDIDATE_READY",
    "拟定冻结载体路径",
    "本候选版（V6.0 FREEZE CANDIDATE）",
    "候选版 ≠ 可采样",
    "### 13.2 v6.0 Freeze Preparation 的随行构件（⛔ 未 commit）",
]
fb = {s: froz.count(s) for s in FORBID}
ck("F-2 %d 条**候选态专属**禁语零命中（全文）" % len(FORBID), all(c == 0 for c in fb.values()),
   str({k: c for k, c in fb.items() if c}))

# ⚠️ 生成轮边界区块（§13）**按 V5 先例逐字保留**（V5 冻结载体第 1039 行同为「⛔ 生成轮未冻结」）
i_gen = froz.index("**v6.0 生成轮（2026-10-02")
i_frz = froz.index("**v6.0 冻结轮（2026-10-02")
GEN_BLOCK = froz[i_gen:i_frz]
REST = froz[:i_gen] + froz[i_frz:]
GEN_TOK = ["V6.0 FREEZE = NOT AUTHORIZED", "B3 = NOT YET AUTHORIZED"]
ck("F-2a 生成轮边界区块**保留**且显式自标「生成轮」（as-of 历史陈述，与 V5 同例）",
   all(t in GEN_BLOCK for t in GEN_TOK)
   and "**v6.0 生成轮（2026-10-02" in GEN_BLOCK
   and "**v6.0 冻结轮（2026-10-02" in froz[i_frz:i_frz + 200])
ck("F-2b 生成轮专属 token **只**出现在生成轮区块内（⛔ 不得外溢到状态区/§12/页脚）",
   all(REST.count(t) == 0 for t in GEN_TOK),
   str({t: REST.count(t) for t in GEN_TOK if REST.count(t)}))

# F-3 状态权威区（状态头 + 状态块 + blockquote + §1.1 + §12）零候选态措辞
i_s12 = froz.index("## 12. 未决项")
i_s13 = froz.index("## 13. 边界声明与不授权声明")
STATUS_REGION = (froz[:froz.index("## 0. ")] + body_of(froz, "## 1. 与 v5.0 / v1.0 的关系")
                 + froz[i_s12:i_s13])
SR_TOK = ["NOT YET AUTHORIZED", "V6.0 FREEZE = NOT AUTHORIZED", "= candidate",
          "无冻结指纹", "NOT AUTHORIZED（= 下一次单独授权闸门）"]
sr = {t: STATUS_REGION.count(t) for t in SR_TOK}
ck("F-3 状态权威区（状态头 / §1.1 / §12）零候选态与「未授权」措辞", all(c == 0 for c in sr.values()),
   str({k: c for k, c in sr.items() if c}))

# F-4 自指/执行态禁令
own = hashlib.sha256(froz_raw).hexdigest()
ck("F-4a 冻结载体**不写入自身 sha256**（自指悖论）", own not in froz, own[:16])
ck("F-4b 冻结载体**不记录自身执行状态**（无「尚未 commit / 尚未 push / 尚无 PR」）",
   all(x not in froz for x in ["尚未 commit", "尚未 push", "尚无 PR", "未 commit", "未 push"]))

# F-5 冻结对象零漂移
ck("F-5a V5 冻结载体 sha256 未变", sha(V5) == V5_SHA, sha(V5))
ck("F-5b 候选基线 sha256 未变（冻结轮对候选件零字节改动）", sha(CAND) == CAND_SHA, sha(CAND))
ck("F-5c 冻结载体为纯 LF", b"\r\n" not in froz_raw and froz_raw.count(b"\r") == 0)

# F-6 四名辨析齐备（⛔ 不得混用）
ck("F-6 四名辨析齐备（本契约载体 / Key 2 / Key 3 / V6.0 Evidence Freeze Seal）",
   all(x in froz for x in ["Key 2 Freeze Seal", "Key 3 Evidence Seal",
                           "**`V6.0 Evidence Freeze Seal`**", "**四者互不替代**"]))

print("\n======================================================")
print("冻结载体断言：%s（%d PASS / %d FAIL）"
      % ("✅ ALL PASS" if not FAIL else "❌ 存在 FAIL", len(PASS), len(FAIL)))
for f in FAIL:
    print("   FAIL: %s" % f)
print("======================================================")
sys.exit(0 if not FAIL else 1)
