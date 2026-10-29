# -*- coding: utf-8 -*-
"""
Evidence Fingerprint **canonicalization** = `sha256lf` —— 自证（owner 2026-10-02 裁定 **A**）

裁定原文（Binding Decision §6.5）：
  «对参与 V6 Evidence Freeze Seal binding 的文本制品，先规范化 CRLF/CR → LF，再计算 SHA-256；
    该规范化仅用于 Evidence Fingerprint，不修改 Git 工作区文件，也不改变 Git blob identity。»

本脚本**只读** —— ⛔ 不写仓库内任何文件（对照副本仅落在系统临时目录，构造后即在进程内比对）。
逐项验证 F-1 … F-14：

  F-1 … F-4   canonicalization 定义性自证（LF 下无操作 · CRLF 等价 · 裸 CR 等价 · ⛔ 非 no-op 假象）
  F-5         内容变异 ⇒ 指纹变化（⛔ 归一不得掩盖语义改动）
  F-6         三绑定对象：sha256lf(工作区文件) == Seal **绑定值**（⛔ 逐项；制品为唯一期望来源）
  F-7         三绑定对象：sha256lf(git blob 内容) == 同一绑定值（工作区 ⇄ blob 互证）
  F-8         git_blob_sha1 ≠ evidence_sha256（量纲 / 算法 / 用途不同；⛔ 不得互相替代）
  F-9         记录的 bytes / lines / EOL 与**规范化后**内容一致（LF 口径）
  F-10        ⛔ 归一仅用于 Fingerprint：运行前后三对象工作区字节不变 · ⛔ 无 .gitattributes · core.autocrlf 未改
  F-11        ⛔ sha256lf **不适用于 Key 2**（Key 2 为 CRLF 口径；其自身 sha256 未变；⛔ 全文无该字样）
  F-12/F-13   文档自证：Binding Decision 已写明 canonicalization 与 `git_blob_sha1 ≠ evidence_sha256`
  F-14        Seal 制品**未因本裁定改写**（sha256 == 记录值；⛔ 未以 schema 键形式声明 canonicalization）

用法：python v6_fingerprint_canonicalization_check.py
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

SEAL = os.path.join(CARRIER, "docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json")
BD = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_V6_FREEZE_SEAL_BINDING_DECISION.md")
REC = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SEAL_RECORD_20261002.md")
CONTRACT = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md")
CAPTURE = os.path.join(HERE, "c1_capture.py")
REDPROOF = os.path.join(HERE, "c1_gate_redproof.py")
KEY2 = os.path.join(CARRIER, "ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json")

PASS, FAIL = [], []


def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


# --------------------------------------------------------- canonicalization 唯一实现
def sha256lf_bytes(b):
    """`sha256lf`：CRLF / 裸 CR → LF 后取 SHA-256（⛔ 仅用于 Evidence Fingerprint）。"""
    return hashlib.sha256(b.replace(b"\r\n", b"\n").replace(b"\r", b"\n")).hexdigest()


def sha256lf(path):
    return sha256lf_bytes(open(path, "rb").read())


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def git(*args):
    r = subprocess.run(["git"] + list(args), cwd=CARRIER,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return r.returncode, r.stdout.decode("utf-8", "replace").strip()


def git_bytes(*args):
    r = subprocess.run(["git"] + list(args), cwd=CARRIER, stdout=subprocess.PIPE)
    return r.returncode, r.stdout


d = json.loads(io.open(SEAL, encoding="utf-8").read())
bd_txt = io.open(BD, encoding="utf-8").read()
rec_txt = io.open(REC, encoding="utf-8").read()
seal_txt = io.open(SEAL, encoding="utf-8").read()

print("== Evidence Fingerprint canonicalization = sha256lf —— 自证 ==")
print("   裁定   owner 2026-10-02 裁定 A（Binding Decision §6.5）")
print("   口径   fingerprint_canonicalization = sha256lf")
print()

# --------------------------------------------------------------- F-1 … F-4 定义性
sample = open(CONTRACT, "rb").read()
print("   [样本] 证据契约 %d B / CRLF=%d" % (len(sample), sample.count(b"\r\n")))
print()

ck("F-1 LF 输入下 `sha256lf` 归一为**无操作**：sha256lf(b) == sha256(b)",
   sha256lf_bytes(sample) == hashlib.sha256(sample).hexdigest(),
   sha256lf_bytes(sample)[:16])

sample_crlf = sample.replace(b"\n", b"\r\n")
ck("F-2 ★ CRLF 等价副本 ⇒ **同一** evidence fingerprint（行尾改写 ⛔ 非内容变更）",
   sha256lf_bytes(sample_crlf) == sha256lf_bytes(sample),
   "%d B(CRLF) ⇒ %s" % (len(sample_crlf), sha256lf_bytes(sample_crlf)[:16]))

sample_cr = sample.replace(b"\n", b"\r")
ck("F-3 ★ 裸 CR（classic Mac）等价副本 ⇒ **同一** evidence fingerprint",
   sha256lf_bytes(sample_cr) == sha256lf_bytes(sample),
   "%d B(CR) ⇒ %s" % (len(sample_cr), sha256lf_bytes(sample_cr)[:16]))

ck("F-4 ⛔ 归一**确实生效**（非 no-op 假象）：原始 sha256(CRLF 副本) ≠ sha256lf",
   hashlib.sha256(sample_crlf).hexdigest() != sha256lf_bytes(sample_crlf),
   "raw=%s vs lf=%s" % (hashlib.sha256(sample_crlf).hexdigest()[:16],
                        sha256lf_bytes(sample_crlf)[:16]))

# --------------------------------------------------------------- F-5 内容变异
mid = len(sample) // 2
while sample[mid:mid + 1] in (b"\r", b"\n"):
    mid += 1
mutated = sample[:mid] + bytes([sample[mid] ^ 0x20]) + sample[mid + 1:]
ck("F-5 ★ 内容变异（翻 1 字节非行尾）⇒ evidence fingerprint **必变**（归一 ⛔ 不得掩盖语义改动）",
   sha256lf_bytes(mutated) != sha256lf_bytes(sample),
   "%s ≠ %s" % (sha256lf_bytes(sample)[:16], sha256lf_bytes(mutated)[:16]))

# --------------------------------------------------------------- F-6/F-7 三绑定对象
BOUND = [("evidence_contract_sha256", "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md",
          CONTRACT, d.get("evidence_contract_path")),
         ("capture_tool_sha256", "scripts/gen1/evidence-capture/c1_capture.py",
          CAPTURE, d.get("capture_tool_path")),
         ("redproof_tool_sha256", "scripts/gen1/evidence-capture/c1_gate_redproof.py",
          REDPROOF, d.get("redproof_tool_path"))]

carrier = d.get("evidence_contract_carrier_commit")
ok6, det6 = True, []
ok7, det7 = True, []
ok7b, det7b = True, []
for key, rel, apath, declared in BOUND:
    bound = d.get(key)
    lf = sha256lf(apath)
    # blob 侧：以 HEAD 的真实 git 对象内容计算（Git 存储 = LF 规范形态）
    rc_h, blob_head = git_bytes("cat-file", "-p", "HEAD:%s" % rel)
    lfb = sha256lf_bytes(blob_head) if rc_h == 0 else None
    # 自「最后改动该路径的提交」起 blob 是否逐字节未变（⛔ 提交由 git 派生，不硬编码）
    _, intro = git("log", "-1", "--format=%H", "--", rel)
    intro = intro.strip()
    rc_p, blob_intro = git("rev-parse", "%s:%s" % (intro, rel)) if intro else (1, "")
    _, blob_headid = git("rev-parse", "HEAD:%s" % rel)
    ok6 = ok6 and (lf == bound)
    ok7 = ok7 and (rc_h == 0 and lfb == bound)
    ok7b = ok7b and (rc_p == 0 and blob_intro == blob_headid)
    det6.append("%s %s" % (key, "OK" if lf == bound else "MISMATCH"))
    det7.append("%s %s" % (key, "OK" if (rc_h == 0 and lfb == bound) else "MISMATCH"))
    det7b.append("%s@%s %s" % (os.path.basename(rel), intro[:8],
                               "OK" if blob_intro == blob_headid else "CHANGED"))

ck("F-6 ★ 三绑定对象：`sha256lf(工作区文件)` == Seal 绑定值（⛔ 逐项；制品为唯一期望来源，零手填）",
   ok6, " | ".join(det6))

ck("F-7 ★ 三绑定对象：`sha256lf(git cat-file -p HEAD:<path>)` == 同一绑定值（工作区 ⇄ git blob 互证）",
   ok7, " | ".join(det7))

ck("F-7b ★ 三绑定对象自其**最后改动提交**起 blob 逐字节未变（⇒ 绑定值对 git 对象同样成立；⛔ 提交由 git 派生）",
   ok7b, " | ".join(det7b))

# --------------------------------------------------------------- F-8 量纲区别
blob_id = d.get("evidence_contract_git_blob_sha1")
rc_b, blob_at = git("rev-parse", "%s:%s" % (carrier, d.get("evidence_contract_path")))
ck("F-8 ★ `git_blob_sha1`(40 hex / Git 对象身份 / SHA-1) ≠ `evidence_sha256`(64 hex / sha256lf) "
   "—— 量纲 / 算法 / 用途均不同，⛔ 不得互相替代",
   rc_b == 0 and blob_at == blob_id
   and len(blob_id) == 40 and len(d.get("evidence_contract_sha256")) == 64
   and blob_id != d.get("evidence_contract_sha256")
   and "git_blob_sha1" in bd_txt and "evidence_sha256" in bd_txt,
   "sha1=%s… / sha256=%s…" % (blob_id[:12], d.get("evidence_contract_sha256")[:12]))

# --------------------------------------------------------------- F-9 记录量纲
ok9, det9 = True, []
for key, rel, apath, declared in BOUND:
    raw = open(apath, "rb").read()
    norm = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    pre = key.replace("_sha256", "")
    b_rec = d.get(pre + "_bytes")
    l_rec = d.get(pre + "_lines")
    e_rec = d.get(pre + "_eol")
    good = (b_rec == len(norm) and l_rec == norm.count(b"\n") and e_rec == "LF")
    ok9 = ok9 and good
    det9.append("%s=%s/%s/%s%s" % (pre, b_rec, l_rec, e_rec, "" if good else " MISS"))
ck("F-9 记录的 bytes / lines / EOL 与**规范化后**内容一致（LF 口径，⛔ 非工作区裸计数）",
   ok9, " | ".join(det9))

# --------------------------------------------------------------- F-10 只用于 Fingerprint
before = {p: sha256(p) for p in (CONTRACT, CAPTURE, REDPROOF)}
tmpdir = tempfile.mkdtemp(prefix="v6_fp_canon_")
copy_lf = os.path.join(tmpdir, "contract_lf_probe.txt")
copy_crlf = os.path.join(tmpdir, "contract_crlf_probe.txt")
with open(copy_lf, "wb") as f:
    f.write(sample)
with open(copy_crlf, "wb") as f:
    f.write(sample_crlf)
lf_probe_ok = (sha256lf(copy_lf) == sha256lf(copy_crlf) == sha256lf(CONTRACT))
after = {p: sha256(p) for p in (CONTRACT, CAPTURE, REDPROOF)}
rc_cfg, cfg = git("config", "--get", "core.autocrlf")
no_attrs = not os.path.exists(os.path.join(CARRIER, ".gitattributes"))
ck("F-10 ★ ⛔ 归一**仅用于 Evidence Fingerprint**：LF/CRLF 副本文件级同值 · 运行前后三对象工作区字节不变 · "
   "⛔ 无 `.gitattributes` · `core.autocrlf` 未改（仍 = true）",
   lf_probe_ok and before == after and no_attrs and rc_cfg == 0 and cfg == "true",
   "副本同值=%s / 工作区不变=%s / .gitattributes=%s / autocrlf=%s"
   % (lf_probe_ok, before == after, "无" if no_attrs else "存在", cfg))

# --------------------------------------------------------------- F-11 Key 2 不适用
k2_raw = open(KEY2, "rb").read()
k2_txt = io.open(KEY2, encoding="utf-8").read()
k2_lf = sha256lf_bytes(k2_raw)
k2_raw_sha = hashlib.sha256(k2_raw).hexdigest()
k2_recorded = d.get("reference_to_key2_seal", {}).get("key2_artifact_sha256")
ck("F-11 ★ ⛔ `sha256lf` **不适用于 Key 2**：制品实测 CRLF ⇒ sha256lf ≠ 自身记录 sha256（口径不同、⛔ 不得混用）；"
   "Key 2 未变且 ⛔ 全文无 `sha256lf` 字样",
   k2_raw.count(b"\r\n") > 0 and k2_lf != k2_raw_sha and k2_raw_sha == k2_recorded
   and "sha256lf" not in k2_txt.lower(),
   "CRLF=%d · 自身=%s · sha256lf=%s" % (k2_raw.count(b"\r\n"), k2_raw_sha[:16], k2_lf[:16]))

# --------------------------------------------------------------- F-12/F-13 文档自证
ck("F-12 ★ Binding Decision 已正式写明 `fingerprint_canonicalization = sha256lf` 且定义含三要点"
   "（CRLF/CR → LF · ⛔ 不修改 Git 工作区文件 · ⛔ 不改变 Git blob identity）",
   "fingerprint_canonicalization = sha256lf" in bd_txt
   and "CRLF/CR → LF" in bd_txt
   and "不修改 Git 工作区文件" in bd_txt
   and "不改变 Git blob identity" in bd_txt,
   "§6.5 在场")

ck("F-13 ★ Binding Decision 明示 `git_blob_sha1` ≠ `evidence_sha256` 且「不得互相替代」",
   "git_blob_sha1` ≠ `evidence_sha256" in bd_txt and "不得互相替代" in bd_txt,
   "§6.5.1 在场")

# --------------------------------------------------------------- F-14 Seal 未被重写
own_seal = hashlib.sha256(open(SEAL, "rb").read()).hexdigest()
m = re.search(r"GEN1_EVIDENCE_FREEZE_SEAL_V6\.json\s*\n\s*([0-9a-f]{64})\s*（\s*(\d+)\s*B）", rec_txt)
rec_seal = m.group(1) if m else None
ck("F-14a ★ Seal 制品**未因本裁定改写**：sha256 == Seal Record §12 记录值（owner：⛔ 不得无意义重写 Seal）",
   rec_seal is not None and own_seal == rec_seal,
   "%s / 记录=%s" % (own_seal[:16], (rec_seal or "未记录")[:16]))

ck("F-14b ⛔ canonicalization **未**以 schema 键形式写入 Seal 制品（owner 明令：⛔ 不得自行扩展 schema）",
   "fingerprint_canonicalization" not in seal_txt and "sha256lf" not in seal_txt.lower(),
   "制品 %d B" % len(open(SEAL, "rb").read()))

print()
print("=" * 54)
print("canonicalization = sha256lf 自证：%s（%d PASS / %d FAIL）"
      % ("✅ ALL PASS" if not FAIL else "❌ 存在 FAIL", len(PASS), len(FAIL)))
for f in FAIL:
    print("   FAIL: %s" % f)
print("=" * 54)
sys.exit(0 if not FAIL else 1)
