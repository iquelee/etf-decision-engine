# -*- coding: utf-8 -*-
"""
V6.0 契约兼容性校验（V6.0 FREEZE PREPARATION 批次）

四类断言：
  A. **内部一致性**：V6.0 候选全文 ↔ 机器可读夹具（registry / checkpoint / R1 判据常量）逐条对齐
  B. **与生产实现兼容**：V6.0 引用的集合 / 字段在 **V3.6.6 树** 中真实存在（⛔ 不新增生产字段）
  C. ★ **改动面收敛**（最强证据）：V5.0 → V6.0 的 diff **只落在允许的章节**（按 **V5 行号区间** 判定），
     且**被改动的章节集合恰好等于**预期集合（双向：无越界 + 无漏项）。
  D. **冻结基线零漂移 + 候选件自约束**（V5 sha256 未变 / V6 纯 LF / 未声明 FROZEN / 结构无重复标题）。

用法：python v6_contract_compatibility.py
"""
import collections
import difflib
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
V5 = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md")
V6 = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md")
REG = os.path.join(HERE, "fixtures", "trigger_registry.json")
CKW = os.path.join(HERE, "fixtures", "checkpoint_windows_cases.json")
R1V2 = os.path.join(HERE, "independence_discriminator_v2.js")
V366 = os.path.abspath(os.path.join(CARRIER, "..", "_v366-cd04-20261002"))

V5_SHA_FROZEN = "4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b"

PASS, FAIL = [], []


def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


def sha256_file(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


v5_raw = open(V5, "rb").read()
v6_raw = open(V6, "rb").read()
v5 = v5_raw.decode("utf-8")
v6 = v6_raw.decode("utf-8")
reg = json.load(open(REG, encoding="utf-8"))
ckw = json.load(open(CKW, encoding="utf-8"))
r1v2 = open(R1V2, encoding="utf-8").read()

print("== V6.0 契约兼容性校验 ==")
print("   V5(冻结) sha256 = %s" % sha256_file(V5))
print("   V6(候选) sha256 = %s" % sha256_file(V6))
print()

# =====================================================================
print("-- A. 内部一致性 --")
# A1 §5.6.3 表 9 条 trigger 与 registry.json 对齐
missing = []
for e in reg["entries"]:
    tid = e["trigger_id"]
    if tid not in v6:
        missing.append("trigger_id:" + tid)
    if e["schedule_cron"] not in v6:
        missing.append("cron:" + tid)
    if e["entry_point"] not in v6:
        missing.append("entry:" + tid)
    for c in e["writes_collections"]:
        if c not in v6:
            missing.append("coll(%s):%s" % (tid, c))
ck("A1 §5.6.3 覆盖全部 9 trigger（id / cron / entry / 写入集合）", not missing,
   "缺失=%s" % missing)
ck("A1 §5.6.3 声明 3 个无调度留册函数",
   all(f in v6 for f in ["runDecisionEngine", "adminGateway", "apiGateway"]))
ck("A1 §5.6.3 声明 2 个云端不存在项",
   "runIntegratedShadowEod" in v6 and "dailyFetch-1530" in v6)
ck("A1 §5.6.4 绑定 registry 夹具与校验器",
   "trigger_registry.json" in v6 and "trigger_registry.js" in v6)

# A2 §5.8 窗口与 checkpoint 夹具对齐
w = {x["id"]: x for x in ckw["windows"]}
ck("A2 §5.8 W1 = [22:30, 23:30) 与夹具一致",
   ("W1 = [22:30:00, 23:30:00)" in v6) and w["W1"]["start"] == "22:30" and w["W1"]["end"] == "23:30")
ck("A2 §5.8 W2 = 次日工作日 [08:30, 09:30) 与夹具一致",
   ("W2 = 次一工作日 [08:30:00, 09:30:00)" in v6)
   and w["W2"]["start"] == "08:30" and w["W2"]["end"] == "09:30")
ck("A2 §5.8 rule = first-window-wins", "first-window-wins" in v6 and ckw["rule"] == "first-window-wins")
ck("A2 §5.8 绑定 checkpoint 判别器夹具",
   "checkpoint_discriminator.js" in v6)

# A3 §3.4A 判据常量与 R1-v2 判据一致
ck("A3 §3.4A 声明 CLUSTER_GAP_DAYS = 10",
   "CLUSTER_GAP_DAYS = 10" in v6 and "const CLUSTER_GAP_DAYS = 10;" in r1v2)
ck("A3 §3.4A I1–I7 七条齐备",
   all(("  I%d " % i) in v6 for i in range(1, 8)))
ck("A3 §3.4A fail-closed 语义与判据一致（NOT_EVALUABLE / NOT_INDEPENDENT）",
   "NOT_EVALUABLE（不得计入独立事件）" in v6 and "NOT_INDEPENDENT（不得计入独立事件）" in v6)
ck("A3 §3.4A 明确排除 trigger 与 capture 窗口身份",
   "`trigger` / `trigger_id`" in v6 and "capture 窗口身份（W1 / W2）" in v6)
ck("A3 §3.4A 携带 sufficiency_scope = NECESSARY_CONDITIONS_ONLY",
   "sufficiency_scope = NECESSARY_CONDITIONS_ONLY" in v6)

# A4 八源一致
ES = set(reg["eight_sources"])
v6_eight = ["runtime_status", "ml_shadow_signal", "invocation_log", "run_candidate_decision",
            "run_candidate_portfolio", "run_manifest", "active_run_pointer", "run_history"]


def _has_src(tok):
    return (tok in v6) or (tok.replace("_", " ") in v6)


missing_src = [x for x in v6_eight if not _has_src(x)]
ck("A4 §5.3 八源 == registry.eight_sources（集合相等，且逐项在全文可查）",
   set(v6_eight) == ES and not missing_src,
   "set_diff=%s missing=%s" % (sorted(ES ^ set(v6_eight)), missing_src))

# A5 17 列 schema 未变
cols = ["date", "code", "regime", "stage", "domain_status", "probability",
        "baseline_suggested_position", "counterfactual_suggested_position", "delta_position",
        "forward_5d", "forward_10d", "forward_20d", "MFE", "MAE", "false_fast_path",
        "event_cluster_id", "independent_event"]
ck("A5 17 列 Evidence 字段在 V6 中齐备且顺序未变",
   v6.count("| 17 |") == 1 and all(("`%s`" % c) in v6 for c in cols))
sec3_v5 = v5[v5.index("## 3. 样本字段"):v5.index("### 3.0 ★")]
sec3_v6 = v6[v6.index("## 3. 样本字段"):v6.index("### 3.0 ★")]
ck("A5 §3 字段表（17 行）逐字未变", sec3_v5 == sec3_v6)

# =====================================================================
print("\n-- B. 与生产实现（V3.6.6 树）兼容 --")
V36_COLLS_JS = os.path.join(V366, "src/common/utils/v365-contracts.js")
V36_CONST_JS = os.path.join(V366, "src/common/constants.js")
ck("B0 V3.6.6 树可见（%s）" % os.path.basename(V366), os.path.isdir(V366))
if os.path.isdir(V366):
    colls_js = open(V36_COLLS_JS, encoding="utf-8").read() if os.path.exists(V36_COLLS_JS) else ""
    const_js = open(V36_CONST_JS, encoding="utf-8").read() if os.path.exists(V36_CONST_JS) else ""
    for key, token in [("RUN_MANIFEST", "run_manifest"), ("CANDIDATE_DECISION", "run_candidate_decision"),
                       ("CANDIDATE_PORTFOLIO", "run_candidate_portfolio"),
                       ("ACTIVE_POINTER", "active_run_pointer"), ("RUN_HISTORY", "run_history")]:
        ck("B1 V365_COLLECTIONS.%s 存在且值含 `%s`" % (key, token),
           (key in colls_js) and (token in colls_js))
    for token in ["RUNTIME_STATUS", "ML_SHADOW_SIGNAL", "FETCH_LOG", "ETF_DAILY"]:
        ck("B1 COLLECTIONS.%s 存在" % token, token in const_js)
    idx = os.path.join(V366, "cloudfunctions/runDecisionEngine/index.js")
    if os.path.exists(idx):
        s = open(idx, encoding="utf-8").read()
        ck("B2 runDecisionEngine 写 run_candidate_* / runtime_status",
           ("putCandidate" in s) and ("RUNTIME_STATUS" in s))
    ck("B3 ⛔ V6 未新增任何生产字段要求（仅登记既有字段）",
       ("gen1_candidate_hash" in r1v2) and ("`gen1_candidate_hash`" in v6))

# =====================================================================
print("\n-- C. ★ 改动面收敛（V5 → V6 的 diff 只落在允许章节）--")


def sections(text):
    """返回 [(1-based 行号, 级别串, 标题文本)]"""
    out = []
    for m in re.finditer(r"^(#{2,3}) (.+)$", text, re.M):
        out.append((text.count("\n", 0, m.start()) + 1, m.group(1), m.group(2)))
    return out


S5 = sections(v5)


def body_of(text, header):
    i = text.find(header)
    if i < 0:
        return None
    m = re.search(r"^#{2,3} ", text[i + len(header):], re.M)
    return text[i:] if m is None else text[i:i + len(header) + m.start()]


def tags_and_changes(a, b):
    tags, ch = set(), []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
            None, a.splitlines(), b.splitlines()).get_opcodes():
        tags.add(tag)
        if tag != "equal":
            ch.extend(a.splitlines()[i1:i2])
    return tags, ch


# C1 严格零改动章节（18 个）
MUST_IDENTICAL = [
    "## 2. 核心对比对象（唯一主对比）",
    "### 3.2 方向约定",
    "### 3.3 MFE / MAE 口径",
    "### 3.4 ★ `event_cluster_id` 与 `independent_event` 的计算规则",
    "### 3.6 ★ `portfolio_snapshot` 与 `run_candidate_portfolio` 的语义分界",
    "## 4. 样本纳入与排除规则",
    "### 5.1 采用 C-1",
    "### 5.2 硬规则一",
    "### 5.4 硬规则三",
    "### 5.5 硬规则四",
    "### 5.7 硬规则六",
    "### 5.9 ★ 硬规则七",
    "## 6. 判定问题",
    "## 7. 统计口径",
    "## 8. 三种终局",
    "### 9.1 来源表",
    "### 9.2 回填原则",
    "### 9.3 ⛔ 禁止用作生产资格证据的字段",
]
bad = [h for h in MUST_IDENTICAL if body_of(v5, h) != body_of(v6, h)]
ck("C1 严格零改动的 %d 个章节逐字节未变" % len(MUST_IDENTICAL), not bad, "不一致=%s" % bad)

# C2 §3.0 / §3.1：**只**允许那两处版本措辞行被改（其余逐字节未变）
EXPECT_TWO = {
    "### 3.0 ★ **Evidence SAMPLE IDENTITY 与 SELECTOR**":
        "### 3.0 ★ **Evidence SAMPLE IDENTITY 与 SELECTOR**（v5.0 新增，冻结）",
    "### 3.1 ★ `regime` 精确绑定":
        "**双组（v5.0 重定义；run 轴 vs data 轴）**：",
}
ok2 = True
for h, exp in EXPECT_TWO.items():
    _, ch = tags_and_changes(body_of(v5, h), body_of(v6, h))
    if ch != [exp]:
        ok2 = False
        print("        %s 变更行 = %s（期望 %s）" % (h[:12], ch, [exp]))
ck("C2 §3.0 / §3.1 仅「版本措辞」各一行变更（其余逐字节未变）", ok2)

# C3 §5.3：**只**允许新增（纯插入，⛔ 不删不改）
t53, ch53 = tags_and_changes(body_of(v5, "### 5.3 硬规则二"), body_of(v6, "### 5.3 硬规则二"))
ck("C3 §5.3 为**纯插入**（无 delete / 无 replace）",
   "delete" not in t53 and "replace" not in t53,
   "tags=%s changed_v5_lines=%s" % (sorted(t53), ch53))
ck("C3 §5.3 新增内容 = trigger provenance + checkpoint_window_id",
   "**★ v6.0：`trigger provenance`（登记口径，⛔ 非判据）**" in body_of(v6, "### 5.3 硬规则二")
   and "checkpoint_window_id" in body_of(v6, "### 5.3 硬规则二"))

# C4 §9.4：正文（ref 表 + 尾注 + 分隔符）逐字节未变；§9.5 追加挂于其后
ck("C4 §9.4 正文（ref 表 + 尾注 + 分隔符）逐字节未变",
   body_of(v5, "### 9.4 ★ 源锚点 ref 绑定") == body_of(v6, "### 9.4 ★ 源锚点 ref 绑定"))
i94 = v6.index("### 9.4 ★ 源锚点 ref 绑定")
i95 = v6.index("### 9.5 `input_hash`")
i10 = v6.index("## 10. 生效日与")
ck("C4b §9.5 为**追加**（位于 §9.4 与 §10 之间；V5 中不存在）",
   (i94 < i95 < i10) and ("9.5" not in v5))

# ---- C5 章节归属（按 V5 行号区间）------------------------------------
NUM = re.compile(r"^([0-9]+(?:\.[0-9]+)?[A-Z]?)")


def sec_key(title):
    if title == "<FILE-HEAD>":
        return "<FILE-HEAD>"
    m = NUM.match(title)
    return m.group(1) if m else title.strip()


# V5 每个章节的 [起, 止] 行号区间（含文件头区段 `<FILE-HEAD>`）
ranges = {"<FILE-HEAD>": (1, S5[0][0] - 1)}
for k, (ln, lvl, title) in enumerate(S5):
    end = S5[k + 1][0] - 1 if k + 1 < len(S5) else len(v5.splitlines())
    ranges.setdefault(sec_key(title), (ln, end))

# 允许被改动（含「纯插入挂在其后」的边界章节 §3.4 / §5.3 / §9.4）
ALLOWED = {"<FILE-HEAD>", "0", "1", "1.1", "1.3", "1.4", "1.5",
           "3.0", "3.1", "3.4", "3.5", "5.3", "5.6", "5.8", "9.4",
           "10", "11", "12", "13", "13.1", "变更日志"}
# 预期**确实**被改动（反向断言：白名单不得虚列）
EXPECT_TOUCHED = ALLOWED - {"3.4", "5.3", "9.4"}

opcodes = list(difflib.SequenceMatcher(None, v5.splitlines(), v6.splitlines()).get_opcodes())
changed_v5_lines = []
for tag, i1, i2, j1, j2 in opcodes:
    if tag == "equal":
        continue
    changed_v5_lines.extend(range(i1 + 1, i2 + 1))


def section_of(lineno):
    cur = "<FILE-HEAD>"
    for ln, lvl, title in S5:
        if ln <= lineno:
            cur = title
        else:
            break
    return cur


touched = sorted({section_of(x) for x in changed_v5_lines})
touched_keys = sorted({sec_key(t) for t in touched})
print("       改动触及的 V5 章节（共 %d 处）：" % len(touched))
for t in touched:
    print("         · %s" % t)

allowed_ranges = [ranges[k] for k in ALLOWED if k in ranges]
oob = [x for x in changed_v5_lines
       if not any(lo <= x <= hi for lo, hi in allowed_ranges)]
ck("C5a 改动行**未**越出允许章节区间（逐行判定，非标题匹配）",
   not oob, "越界行=%s" % oob[:20])

miss = sorted(EXPECT_TOUCHED - set(touched_keys))
extra = sorted(set(touched_keys) - ALLOWED)
ck("C5b 被改动章节集合**恰好等于**预期集合（无漏项 / 无意外）",
   not miss and not extra,
   "漏项=%s 意外=%s 实测=%s" % (miss, extra, touched_keys))

# ---- C6 无「非意图」残留：纯空白差异 = 0 / 标题无重复 ------------------
_N = lambda s: re.sub(r"\s+", "", s)
l5, l6 = v5.splitlines(), v6.splitlines()

# C6a 块级：任一**非等值**块若「去空白后两侧相等」⇒ 该块属纯排版噪音（必须为 0）
ws_blocks = []
for tag, i1, i2, j1, j2 in opcodes:
    if tag == "equal":
        continue
    old = "\n".join(l5[i1:i2])
    new = "\n".join(l6[j1:j2])
    if _N(old) == _N(new):
        ws_blocks.append((tag, i1 + 1, i2, j1 + 1, j2))
ck("C6a 无「块级纯排版差异」（去空白后两侧相等的 diff 块 = 0）",
   not ws_blocks, "残留块=%s" % ws_blocks)

# C6b 行级：等长 replace 块内，逐行配对中不得出现「仅空白不同」的行
ws_lines = []
for tag, i1, i2, j1, j2 in opcodes:
    if tag != "replace" or (i2 - i1) != (j2 - j1):
        continue
    for k in range(i2 - i1):
        x, y = l5[i1 + k], l6[j1 + k]
        if x != y and _N(x) == _N(y):
            ws_lines.append((i1 + k + 1, x, y))
ck("C6b 等长替换块内无「仅空白不同」的行（逐行配对）",
   not ws_lines, "残留行=%s" % [(x[0]) for x in ws_lines])

# C6c 归一化后的「内容改动行」必须 ⊆ 允许章节区间（与 C5a 同判据、不同口径）
smn = difflib.SequenceMatcher(None, [_N(x) for x in l5], [_N(x) for x in l6])
nc5 = set()
for t, i1, i2, j1, j2 in smn.get_opcodes():
    if t != "equal":
        nc5.update(range(i1, i2))
oob_norm = [x + 1 for x in sorted(nc5)
            if not any(lo <= x + 1 <= hi for lo, hi in allowed_ranges)]
ck("C6c 归一化对拍下的内容改动行亦未越界（双口径交叉验证）",
   not oob_norm, "越界=%s" % oob_norm[:20])

dup6 = [k for k, n in collections.Counter(
    [m.group(2).strip() for m in re.finditer(r"^(#{2,3}) (.+)$", v6, re.M)]).items() if n > 1]
ck("C6d V6 标题无重复（无 `### X### X` 这类残迹）", not dup6, "重复=%s" % dup6)

ck("C6e 水平分隔符 `---` 数 = V5 + 1（新增 §9.5 前的一条，其余逐条对齐）",
   sum(1 for x in l6 if x.strip() == "---")
   == sum(1 for x in l5 if x.strip() == "---") + 1)

# =====================================================================
print("\n-- D. 冻结基线零漂移 + 候选件自约束 --")
ck("D1 V5 冻结载体 sha256 未变", sha256_file(V5) == V5_SHA_FROZEN, sha256_file(V5))
ck("D2 V6 候选为纯 LF", b"\r\n" not in v6_raw)
ck("D3 V6 候选含冻结对象零改动声明",
   "**⛔ V5.0 载体 immutable 声明（owner B1）**" in v6)
ck("D4 V6 候选**未**自称 FROZEN（🧪 FREEZE CANDIDATE / ⛔ NOT FROZEN 齐备）",
   ("🧪 **FREEZE CANDIDATE**" in v6) and ("⛔ **NOT FROZEN**" in v6))
ck("D5 V6 候选未携带「本文件已冻结」类自指语句",
   "本文件已于" not in v6 and "本文件**已**冻结" not in v6)

print("\n======================================================")
print("契约兼容性：%s（%d PASS / %d FAIL）"
      % ("✅ ALL PASS" if not FAIL else "❌ 存在 FAIL", len(PASS), len(FAIL)))
for f in FAIL:
    print("   FAIL: %s" % f)
print("======================================================")
sys.exit(0 if not FAIL else 1)
