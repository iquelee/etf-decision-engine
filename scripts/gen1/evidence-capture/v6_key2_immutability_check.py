# -*- coding: utf-8 -*-
"""
**Key 2 不变性**自证（owner B2 §五 D）

目的：以** git 历史对拍**（而不是引用一个常量）证明 —— 在本原子批次全区间内，
既有 Key 2 三个治理对象**逐字节未变**（before == after），且语义身份未被污染：

  · `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json`（生产激活安全冻结制品）
  · `docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md`（§3.1 三钥匙 / Key 2 定义）
  · `docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md`（2026-09-22 上游裁定）

核查项 K-1 … K-12。
⛔ 若出现任何字节 / 语义差异 ⇒ 本脚本 FAIL ⇒ 依 owner 指令 **STOP 并报告 SCHEMA / GOVERNANCE GAP**。

用法：python v6_key2_immutability_check.py
"""
import hashlib
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

KEY2_REL = "ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json"
CHARTER_REL = "docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md"
PRECEDENT_REL = "docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md"

PRE_BATCH = "7d2f39bddd681cce9d714558d518b06631451d01"   # 批次前远端可见点（origin tip）
KEY2_ANCHOR = "b6da0a361d9733aa5cb966ffa28a4e6cae15ff08"  # Key 2 最后一次改动提交
CHARTER_ANCHOR = "fdb8977abbcd5aef53d39a1db7c40180a41e4253"
PRECEDENT_ANCHOR = "f0077e0f1dfb69ad2766d24a3667dd92aae913c1"

KEY2_SHA = "35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5"
KEY2_BLOB = "46142607937105215ca70c45dd5a3379cea62dfa"
KEY2_KEYS = {"contract_version", "source_sha256", "model_sha256", "threshold_version"}

PASS, FAIL = [], []


def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def git(*args):
    r = subprocess.run(["git"] + list(args), cwd=CARRIER,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return r.returncode, r.stdout.decode("utf-8", "replace").strip()


def unchanged(rev, rel):
    rc, _ = git("diff", "--quiet", "%s..HEAD" % rev, "--", rel)
    return rc == 0


def section(text, start_prefix):
    lines = text.split("\n")
    out, on = [], False
    for ln in lines:
        if not on and ln.startswith(start_prefix):
            on = True
            out.append(ln)
            continue
        if on:
            if ln.startswith("## ") or ln.startswith("### "):
                break
            out.append(ln)
    return "\n".join(out)


print("== Key 2 不变性自证 ==")
print("   批次区间锚点（pre-batch） = %s" % PRE_BATCH[:12])
print("   Key 2 最后改动提交        = %s" % KEY2_ANCHOR[:12])
print()

key2_path = os.path.join(CARRIER, KEY2_REL)
raw = open(key2_path, "rb").read()
d = json.loads(io.open(key2_path, encoding="utf-8").read())
text = io.open(key2_path, encoding="utf-8").read()

# ------------------------------------------------------------- K-1…K-5 语义身份
ck("K-1 ★ Key 2 制品工作区 sha256 == 35040e5e…09e5 且 bytes == 881",
   sha(key2_path) == KEY2_SHA and len(raw) == 881, "%s / %d B" % (sha(key2_path)[:16], len(raw)))

bind_keys = {k for k in d if k.endswith("_sha256") or k in ("contract_version", "threshold_version")}
ck("K-2 四项绑定键集合 == 宪章 §3.1 枚举（⛔ 不多不少）",
   bind_keys == KEY2_KEYS, "实测=%s" % sorted(bind_keys))

ck("K-3 contract_version == WP-G1-GE-CH-1.0（激活安全宪章版本位，⛔ 未改）",
   d.get("contract_version") == "WP-G1-GE-CH-1.0", d.get("contract_version"))

ck("K-4 ★ ⛔ 制品全文零 `v6` 命中（枚举域 = 该制品全部文本，忽略大小写）⇒ 未把 V6.0 写进 Key 2",
   "v6" not in text.lower(), "命中=%d" % text.lower().count("v6"))

ck("K-5 status == PENDING 且 bindings_status == INCOMPLETE（本批次 ⛔ 不得改状态）",
   d.get("status") == "PENDING" and d.get("bindings_status") == "INCOMPLETE",
   "%s / %s" % (d.get("status"), d.get("bindings_status")))

# ------------------------------------------------------------- K-6…K-8 字节不变
ck("K-6 ★ 批次区间逐字节未变：git diff %s..HEAD == 空（before == after）" % PRE_BATCH[:12],
   unchanged(PRE_BATCH, KEY2_REL))

ck("K-7 ★ 自最后改动提交以来逐字节未变：git diff %s..HEAD == 空" % KEY2_ANCHOR[:12],
   unchanged(KEY2_ANCHOR, KEY2_REL))

rc1, b1 = git("rev-parse", "%s:%s" % (KEY2_ANCHOR, KEY2_REL))
rc2, b2 = git("rev-parse", "%s:%s" % (PRE_BATCH, KEY2_REL))
rc3, b3 = git("rev-parse", "HEAD:%s" % KEY2_REL)
ck("K-8 ★ blob id 三方一致（锚点 / 批次前 / HEAD）== 46142607…2dfa ⇒ 内容不可分辨",
   rc1 == rc2 == rc3 == 0 and b1 == b2 == b3 == KEY2_BLOB,
   "%s / %s / %s" % (b1[:12], b2[:12], b3[:12]))

# ------------------------------------------------------------- K-9…K-11 上游治理层
charter = io.open(os.path.join(CARRIER, CHARTER_REL), encoding="utf-8").read()
sec31 = section(charter, "### 3.1")
ck("K-9a ★ Charter 全文逐字节未变（自 %s）" % CHARTER_ANCHOR[:12], unchanged(CHARTER_ANCHOR, CHARTER_REL))
ck("K-9b ★ Charter §3.1 body 仍含 Key 2 四字段枚举且零 `v6` 命中",
   all(t in sec31 for t in ("Key 2 — Freeze Seal", "APPROVED", "source SHA", "model SHA",
                            "threshold 版本", "contract version"))
   and "v6" not in sec31.lower(),
   "§3.1 %d 字 / v6 命中=%d" % (len(sec31), sec31.lower().count("v6")))

ck("K-10 ★ 上游裁定 GEN1_FREEZE_SEAL_BINDING_DECISION.md 逐字节未变（须走新裁定，⛔ 不得原地改）",
   unchanged(PRECEDENT_ANCHOR, PRECEDENT_REL))

ck("K-11 change_rule 仍在且含「只能通过 PR 显式修改本文件」（显式审批语义未被削弱）",
   "只能通过 PR 显式修改本文件" in str(d.get("change_rule", "")),
   str(d.get("change_rule"))[:40])

# ------------------------------------------------------------- K-12 前提
anc = [PRE_BATCH, KEY2_ANCHOR, CHARTER_ANCHOR, PRECEDENT_ANCHOR]
miss = [c[:12] for c in anc if git("merge-base", "--is-ancestor", c, "HEAD")[0] != 0]
ck("K-12 四个锚点提交均为 HEAD 祖先（⇒ K-6/7/9/10 的 diff 判定有效）",
   not miss, "非祖先=%s" % (miss or "无"))

print()
print("=" * 54)
print("Key 2 不变性：%s（%d PASS / %d FAIL）"
      % ("✅ ALL PASS（KEY_2_IMMUTABLE = PASS）" if not FAIL else "❌ 存在 FAIL ⇒ STOP / 报 GAP",
         len(PASS), len(FAIL)))
for f in FAIL:
    print("   FAIL: %s" % f)
print("=" * 54)
sys.exit(0 if not FAIL else 1)
