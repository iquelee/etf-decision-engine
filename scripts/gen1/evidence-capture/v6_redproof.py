# -*- coding: utf-8 -*-
"""
V6.0 FREEZE CANDIDATE **打红自证**（V6.0 FREEZE PREPARATION 批次）

原理：把**候选件本体**当作被测对象 —— 对**内存副本**施加定向变异，跑
      `v6_content_assertions.run_assertions()`：每一个变异都必须被**检出**（FAIL 非空）。
      每条变异自带**逆变换** ⇒ 逐字节往返还原必须复原（`inverse(mutate(BASE)) == BASE`）。
      全程 ⛔ **不写盘**：磁盘上的交付件 sha256 前后一致。

⛔ 断言逻辑（`v6_content_assertions.py`）与变异清单（本文件）**分离**：
   若把变异写进断言，等于自己给自己出题；两者分离后本自证才有意义。

用法：python v6_redproof.py
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
V5 = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md")
V6 = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md")
REG = os.path.join(HERE, "fixtures", "trigger_registry.json")

sys.path.insert(0, HERE)
import v6_content_assertions as CA  # noqa: E402

PASS, FAIL = [], []


def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


v5 = open(V5, encoding="utf-8").read()
raw = open(V6, "rb").read()
BASE_SHA = hashlib.sha256(raw).hexdigest()
BASE = raw.decode("utf-8")
reg = json.load(open(REG, encoding="utf-8"))


def mk_rep(old, new):
    """字面量替换变异（可逆）。old 必须在 BASE 中恰出现 1 次。"""
    assert BASE.count(old) == 1, "锚点不唯一: %r" % old[:60]

    def fwd(t):
        return t.replace(old, new, 1)

    def inv(t):
        assert t.count(new) >= 1
        return t.replace(new, old, 1)

    return fwd, inv


def mk_del(start, end):
    """整段删除变异（可逆）。"""
    i = BASE.find(start)
    j = BASE.find(end, i + len(start))
    assert i >= 0 and j > i, "区段锚点无效: %r / %r" % (start[:40], end[:40])
    removed = BASE[i:j]

    def fwd(t):
        return t[:i] + t[j:]

    def inv(t):
        assert t.count(end) >= 1
        return t.replace(end, removed + end, 1)

    return fwd, inv


def mk_replace_all(old, new):
    """全局替换变异（可逆）。old 至少出现 1 次。"""
    assert BASE.count(old) >= 1, "锚点不存在: %r" % old[:60]

    def fwd(t):
        return t.replace(old, new)

    def inv(t):
        return t.replace(new, old)

    return fwd, inv


def mk_ins_after_line(marker, insertion):
    """在**包含 marker 的那一行之后**插入一行（可逆）。marker 必须唯一。"""
    assert BASE.count(marker) == 1, "行锚点不唯一: %r (%d)" % (marker[:50], BASE.count(marker))
    e = BASE.find("\n", BASE.find(marker))
    assert e > 0

    def fwd(t):
        j = t.find(marker)
        j = t.find("\n", j)
        return t[:j + 1] + insertion + "\n" + t[j + 1:]

    def inv(t):
        assert t.count(insertion + "\n") == 1
        return t.replace(insertion + "\n", "", 1)

    return fwd, inv


# (id, 描述, 正向, 逆向, 期望被检出的断言名关键字)
MUTATIONS = [
    ("RP-01", "① 删除 §3.4A 整节（独立性判据整体缺失）",
     *mk_del("### 3.4A ★", "### 3.5 ★"), "B-1"),
    ("RP-02", "② W1 终点放宽 23:30 → 23:59",
     *mk_rep("W1 = [22:30:00, 23:30:00)", "W1 = [22:30:00, 23:59:00)"), "D-1"),
    ("RP-03", "③ 把 first-window-wins 改成 last-window-wins",
     *mk_replace_all("first-window-wins", "last-window-wins"), "D-3"),
    ("RP-04", "④ §11 规则 2 版本位回退（制造「v6.0 作废 v5.0」自指矛盾）",
     *mk_rep("发布 **v7.0**，并**显式作废 v6.0 全部样本**",
             "发布 **v6.0**，并**显式作废 v5.0 全部样本**"), "E-4"),
    ("RP-05", "⑤ R3 裁定从 OBSERVATION 篡改为 CONTRACT GAP",
     *mk_rep("**`R3 = OBSERVATION`**（⛔ **非** `CONTRACT GAP`）",
             "**`R3 = CONTRACT GAP`**（⛔ **非** `OBSERVATION`）"), "E-5"),
    ("RP-06", "⑥ 从 Trigger Registry 抹掉一个真实 trigger（realtime-5min）",
     *mk_replace_all("realtime-5min", "realtime-7min"), "C-2"),
    ("RP-07", "⑦ 把 sufficiency_scope 从 NECESSARY_CONDITIONS_ONLY 偷换为 SUFFICIENT",
     *mk_rep("sufficiency_scope = NECESSARY_CONDITIONS_ONLY",
             "sufficiency_scope = SUFFICIENT"), "B-6"),
    ("RP-08", "⑧ 把独立性计数规则从「+2，非 +1」改成「+1」",
     *mk_rep("（+2，非 +1）", "（+1）"), "B-8"),
    ("RP-09", "⑨ 把冻结常量 `CLUSTER_GAP_DAYS` 从 10 改为 0",
     *mk_rep("CLUSTER_GAP_DAYS = 10", "CLUSTER_GAP_DAYS = 0"), "B-4a"),
    ("RP-10", "⑩ 把标记回退为 v5.0 历史语 `PRE-V5 DIAGNOSTIC`（禁语）",
     *mk_rep("PRE-V6 DIAGNOSTIC", "PRE-V5 DIAGNOSTIC"), "E-7"),
    ("RP-11", "⑪ 制造重复标题 `### 变更日志### 变更日志`",
     *mk_rep("### 变更日志", "### 变更日志### 变更日志"), "A-3"),
    ("RP-12", "⑫ 去掉 §5.8「可执行校验」对判别器的绑定",
     *mk_replace_all("checkpoint_discriminator.js", "checkpoint_missing.js"), "D-6"),
    ("RP-13", "⑬ 文档编号回退为 `WP-G1-EVIDENCE-CH-5.0`（禁语）",
     *mk_rep("`WP-G1-EVIDENCE-CH-6.0`", "`WP-G1-EVIDENCE-CH-5.0`"), "E-1"),
    ("RP-14", "⑭ 删除 §5.6.3 Trigger Registry 小节",
     *mk_del("#### 5.6.3 ★ **完整 Trigger Registry**", "#### 5.6.4"), "C-1"),
    ("RP-15", "⑮ 给 §3.4A 越权加一条 I8（把 7 条判据扩成 8 条）",
     *mk_ins_after_line("  I7 ", "  I8  run_date(III) 互异                          [⛔ 越权新增，本应为非判据]"),
     "B-3"),
]

print("== V6.0 FREEZE CANDIDATE 打红自证 ==")
print("   被测对象   = %s" % os.path.basename(V6))
print("   基线 sha256 = %s" % BASE_SHA)
print("   断言套件   = v6_content_assertions.py（独立文件，⛔ 不含任何变异逻辑）")
print()

# ---- 0. 基线必须 ALL PASS ------------------------------------------------
baseP, baseF, _ = CA.run_assertions(BASE, reg, v5)
ck("RP-00 基线（未变异）ALL PASS", not baseF, "PASS=%d FAIL=%d" % (len(baseP), len(baseF)))
for f in baseF:
    print("         基线 FAIL: %s" % f)

# ---- 1. 逐条变异必须被检出 + 逆变换必须逐字节还原 ----------------------
print("\n   -- 定向变异（每条都必须被检出，且逆变换必须逐字节还原）--")
caught, restored = 0, 0
for mid, desc, fwd, inv, expect in MUTATIONS:
    m = fwd(BASE)
    if m == BASE:
        FAIL.append("%s 变异未生效" % mid)
        print("   [FAIL] %s 变异未生效" % mid)
        continue
    mp, mf, _ = CA.run_assertions(m, reg, v5)
    hit = any(expect in x for x in mf)
    caught += 1 if hit else 0
    back = inv(m)
    rev_ok = (back == BASE)
    restored += 1 if rev_ok else 0
    ck("%s %s" % (mid, desc), hit and rev_ok,
       "检出 %d 项；命中 %s=%s；还原=%s" % (len(mf), expect, hit, rev_ok))
    if not hit:
        print("        实际检出：%s" % mf)

ck("RP-16 全部 %d 条变异均被检出" % len(MUTATIONS), caught == len(MUTATIONS),
   "%d/%d" % (caught, len(MUTATIONS)))
ck("RP-17 全部 %d 条变异的逆变换均**逐字节还原**" % len(MUTATIONS),
   restored == len(MUTATIONS), "%d/%d" % (restored, len(MUTATIONS)))

# ---- 2. 全程不写盘：磁盘交付件 sha256 未变 -----------------------------
print("\n   -- 交付件未被触碰 --")
disk_sha = hashlib.sha256(open(V6, "rb").read()).hexdigest()
ck("RP-18 全程**未写盘**：磁盘文件 sha256 == 基线", disk_sha == BASE_SHA, disk_sha)
rp, rf, _ = CA.run_assertions(open(V6, encoding="utf-8").read(), reg, v5)
ck("RP-19 读回磁盘文件重新 ALL PASS", not rf, "PASS=%d FAIL=%d" % (len(rp), len(rf)))

print("\n======================================================")
print("V6.0 打红自证：%s（%d PASS / %d FAIL）"
      % ("✅ ALL PASS" if not FAIL else "❌ 存在 FAIL", len(PASS), len(FAIL)))
for f in FAIL:
    print("   FAIL: %s" % f)
print("======================================================")
sys.exit(0 if not FAIL else 1)
