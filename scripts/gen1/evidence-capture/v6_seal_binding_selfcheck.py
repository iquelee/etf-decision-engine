# -*- coding: utf-8 -*-
"""
`V6.0 Evidence Freeze Seal` **绑定自证**（Seal binding self-check）

目的：把 Seal 制品里**每一个绑定值**都从**真实文件 / 真实 git 对象**重新推导一遍，
⛔ 不采信制品自述、⛔ 不手填任何 SHA。

覆盖（S-1 … S-20，20 项）：
  · 身份 / 层 / namespace（含 ⛔ 裸 `contract_version` 负向断言）
  · 证据契约：content **`sha256lf`** · bytes / lines / EOL（LF 规范口径） · carrier commit · parent commit · git blob sha1
  · 两工具：**`sha256lf`** · bytes / lines / EOL（LF 规范口径）
  · lifecycle 单调 + `seal_status == achieved_state`
  · binding_routes 7 键路由（4 DIRECT / 3 REFERENCE_TO_KEY2_SEAL）
  · Key 2 引用读数（sha256 / unchanged / 并列正交）
  · Key 3 恒 NOT_AUTHORIZED（0 < 30）
  · production_effects 全 false / OFF
  · ★ 别名一致性（`carrier_commit` ⇄ `evidence_contract_carrier_commit`）
  · ⛔ 制品不写入自身 sha256（自指悖论）
  · ★ 绑定口径 = `sha256lf`（owner 2026-10-02 裁定 A）：三绑定值 == `sha256lf`；
    canonicalization 的权威载体 = Binding Decision §6.5，⛔ 制品**不**自行声明（schema 未扩张）

═ evidence fingerprint canonicalization（owner 2026-10-02 裁定 A）═
本脚本一律以 **`sha256lf`**（CRLF/CR → LF 后 SHA-256）取值，⛔ 不用裸字节 sha256：
  · 对当前三绑定对象（实测**纯 LF**）两者**同值** ⇒ 本脚本对既有 PASS / FAIL 结论**无任何改变**
    （⛔ 非放宽、⛔ 非收紧，仅口径对齐）
  · 作用：使绑定判定在工作区被重新 checkout 成 CRLF 时**仍然成立**（口径耐久性）
  · 与 `git blob sha1`（Git 对象身份，40 hex）**量纲 / 算法 / 用途均不同**，⛔ 不得互相替代（S-20 断言）

用法：python v6_seal_binding_selfcheck.py
"""
import hashlib
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

SEAL_PATH = os.path.join(CARRIER, "docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json")
BD = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_V6_FREEZE_SEAL_BINDING_DECISION.md")
CONTRACT = os.path.join(CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md")
CAPTURE = os.path.join(HERE, "c1_capture.py")
REDPROOF = os.path.join(HERE, "c1_gate_redproof.py")
KEY2 = os.path.join(CARRIER, "ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json")

KEY2_SHA = "35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5"

PASS, FAIL = [], []


def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


def sha(p):
    """⛔ 裸字节 sha256（本 Seal 的**绑定判定不用**此口径；仅保留作诊断/对照）。"""
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def raw(p):
    return open(p, "rb").read()


def norm(b):
    """`sha256lf` 归一步骤：CRLF → LF，再 裸 CR → LF（owner 2026-10-02 裁定 A / Binding Decision §6.5）。"""
    return b.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def sha256lf(p):
    """★ 本 Seal 的 **evidence fingerprint** 口径（owner 2026-10-02 裁定 A）。

    ⛔ 与 `git blob sha1` 量纲 / 算法 / 用途均不同，不得互相替代。
    """
    return hashlib.sha256(norm(raw(p))).hexdigest()


def git(*args):
    r = subprocess.run(["git"] + list(args), cwd=CARRIER,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return r.returncode, r.stdout.decode("utf-8", "replace").strip()


# ---------------------------------------------------------------- 载入
assert os.path.exists(SEAL_PATH), "Seal 制品不存在：%s" % SEAL_PATH
seal_raw = raw(SEAL_PATH)
seal_txt = io.open(SEAL_PATH, encoding="utf-8").read()
d = json.loads(seal_txt)

print("== V6.0 Evidence Freeze Seal 绑定自证 ==")
print("   制品   %s" % os.path.relpath(SEAL_PATH, CARRIER))
print("   sha256 %s" % hashlib.sha256(seal_raw).hexdigest())
print("   bytes  %d" % len(seal_raw))
print("   as_of  %s / namespace %s" % (d.get("as_of"), d.get("version_namespace")))
print()

# ------------------------------------------------------- S-1 身份唯一性
ck("S-1 seal_id == EVIDENCE_FREEZE_SEAL_V6 且 ⛔ ≠ Key 2 的 GUARDED_EFFECTIVE_FREEZE",
   d.get("seal_id") == "EVIDENCE_FREEZE_SEAL_V6"
   and d.get("seal_id") != "GUARDED_EFFECTIVE_FREEZE",
   d.get("seal_id"))

ck("S-2 seal_kind == EVIDENCE_FREEZE_SEAL 且 seal_layer == DOCUMENT_LAYER（⛔ 非生产制品层）",
   d.get("seal_kind") == "EVIDENCE_FREEZE_SEAL" and d.get("seal_layer") == "DOCUMENT_LAYER",
   "%s / %s" % (d.get("seal_kind"), d.get("seal_layer")))

ck("S-3 ★ ⛔ 顶层键集不含裸 `contract_version`（namespace 隔离，负向断言；枚举域 = 顶层键集 %d 键）"
   % len(d),
   "contract_version" not in d.keys() and "evidence_contract_version" in d.keys())

# --------------------------------------------------- S-4…S-8 证据契约
ct_sha = sha256lf(CONTRACT)          # ★ sha256lf 口径（owner 2026-10-02 裁定 A）
ct_raw = raw(CONTRACT)
ct_norm = norm(ct_raw)
ck("S-4 ★ evidence_contract_version == v6.0 且 evidence_contract_sha256 == 契约 `sha256lf`（裁定 A 口径）",
   d.get("evidence_contract_version") == "v6.0" and d.get("evidence_contract_sha256") == ct_sha,
   d.get("evidence_contract_sha256", "")[:16])

ck("S-5 evidence_contract_bytes / lines / eol 与**规范化后**内容一致（LF 规范口径）",
   d.get("evidence_contract_bytes") == len(ct_norm)
   and d.get("evidence_contract_lines") == ct_norm.count(b"\n")
   and d.get("evidence_contract_eol") == "LF",
   "%d B / %d 行 / 工作区 CRLF=%d" % (len(ct_norm), ct_norm.count(b"\n"), ct_raw.count(b"\r\n")))

cc = d.get("evidence_contract_carrier_commit", "")
rc, resolved = git("rev-parse", "--verify", cc + "^{commit}")
ck("S-6 carrier commit 可解析且 == evidence_contract_carrier_commit 实测",
   rc == 0 and resolved == cc,
   resolved[:12] if rc == 0 else resolved[:60])

blob_at = ""
blob_sha = ""
if rc == 0:
    rc2, blob_at = git("rev-parse", "%s:%s" % (cc, d.get("evidence_contract_path")))
    if rc2 == 0:
        p = subprocess.run(["git", "cat-file", "-p", blob_at], cwd=CARRIER,
                           stdout=subprocess.PIPE)
        blob_sha = hashlib.sha256(norm(p.stdout)).hexdigest()
ck("S-7 ★ evidence_contract_git_blob_sha1 == git blob id 实测，且该 blob 的 `sha256lf` == 内容哈希",
   blob_at == d.get("evidence_contract_git_blob_sha1") and blob_sha == ct_sha,
   "%s / %s" % (blob_at[:12], blob_sha[:16]))

rc3, parent = git("rev-parse", cc + "^")
ck("S-8 evidence_contract_parent_commit == carrier 提交的 parent 实测",
   rc3 == 0 and parent == d.get("evidence_contract_parent_commit"),
   parent[:12] if rc3 == 0 else parent[:60])

# ------------------------------------------------------- S-9/S-10 工具
cap_sha, cap_raw = sha256lf(CAPTURE), raw(CAPTURE)      # ★ sha256lf 口径（裁定 A）
rdp_sha, rdp_raw = sha256lf(REDPROOF), raw(REDPROOF)
ck("S-9 ★ capture_tool_sha256 / bytes / lines / eol 与 c1_capture.py `sha256lf` + 规范化内容一致",
   d.get("capture_tool_sha256") == cap_sha
   and d.get("capture_tool_bytes") == len(norm(cap_raw))
   and d.get("capture_tool_lines") == norm(cap_raw).count(b"\n")
   and d.get("capture_tool_eol") == "LF",
   "%s / %d B / CRLF=%d" % (cap_sha[:16], len(norm(cap_raw)), cap_raw.count(b"\r\n")))

ck("S-10 ★ redproof_tool_sha256 / bytes / lines / eol 与 c1_gate_redproof.py `sha256lf` + 规范化内容一致",
   d.get("redproof_tool_sha256") == rdp_sha
   and d.get("redproof_tool_bytes") == len(norm(rdp_raw))
   and d.get("redproof_tool_lines") == norm(rdp_raw).count(b"\n")
   and d.get("redproof_tool_eol") == "LF",
   "%s / %d B / CRLF=%d" % (rdp_sha[:16], len(norm(rdp_raw)), rdp_raw.count(b"\r\n")))

# ------------------------------------------------------- S-11/S-12 状态
lc = d.get("seal_lifecycle", {})
ck("S-11 ★ seal_status == seal_lifecycle.achieved_state == EVIDENCE_FREEZE_SEALED",
   d.get("seal_status") == "EVIDENCE_FREEZE_SEALED"
   and lc.get("achieved_state") == d.get("seal_status"),
   "%s / %s" % (d.get("seal_status"), lc.get("achieved_state")))

ck("S-12 lifecycle 四态有序（monotonic + no_skip）且四步 done 全 True",
   lc.get("order") == ["V6.0_EVIDENCE_FREEZE_CANDIDATE", "TOOL_ALIGNMENT_PASS",
                       "EVIDENCE_FREEZE_SEAL_READY", "EVIDENCE_FREEZE_SEALED"]
   and lc.get("monotonic") is True and lc.get("no_skip") is True
   and all(lc.get("steps", {}).get(s, {}).get("done") is True for s in lc.get("order", [])),
   "→".join(x[:12] for x in lc.get("order", [])))

# ------------------------------------------------------- S-13 路由
routes = d.get("binding_routes", {})
REQ7 = ["evidence_contract_version", "evidence_contract_sha256", "source_sha256",
        "model_sha256", "threshold_version", "capture_tool_sha256", "redproof_tool_sha256"]
direct = [k for k in REQ7 if routes.get(k, {}).get("route") == "DIRECT"
          and routes.get(k, {}).get("independent_claim") is True]
ref = [k for k in REQ7 if routes.get(k, {}).get("route") == "REFERENCE_TO_KEY2_SEAL"
       and routes.get(k, {}).get("independent_claim") is False]
ck("S-13 binding_routes 覆盖全部 7 项绑定，且 4×DIRECT + 3×REFERENCE_TO_KEY2_SEAL",
   set(REQ7) <= set(routes.keys()) and len(direct) == 4 and len(ref) == 3
   and all(routes.get(k, {}).get("owned_by") == "KEY2_GUARDED_EFFECTIVE_FREEZE" for k in ref),
   "DIRECT=%d / REF=%d" % (len(direct), len(ref)))

# ------------------------------------------------------- S-14 Key 2 引用
r2 = d.get("reference_to_key2_seal", {})
k2_sha = sha(KEY2)
ck("S-14 ★ Key 2 引用读数：制品 sha256 == Key 2 实测，unchanged == True，关系 = 并列正交",
   r2.get("key2_artifact_sha256") == k2_sha == KEY2_SHA
   and r2.get("key2_unchanged_by_this_batch") is True
   and r2.get("relation") == "PARALLEL_AND_DISJOINT"
   and r2.get("reference_only") is True and r2.get("independent_claim") is False,
   "%s / %s" % (k2_sha[:16], r2.get("relation")))

# ------------------------------------------------------- S-15 Key 3
ck("S-15 Key 3 Evidence Seal 恒 NOT_AUTHORIZED，且 independent_events(0) < 门槛(30)",
   d.get("evidence_seal_key3") == "NOT_AUTHORIZED"
   and d.get("independent_events") == 0
   and d.get("independent_events_threshold") == 30
   and d.get("independent_events") < d.get("independent_events_threshold"),
   "%s / %s<%s" % (d.get("evidence_seal_key3"), d.get("independent_events"),
                   d.get("independent_events_threshold")))

# ------------------------------------------------------- S-16 生产侧零效应
EXPECT = {"production_code_changed": False, "production_db_writes": 0, "deploy": False,
          "merge": False, "master_integration": False, "canary": "OFF", "auto_execution": "OFF",
          "ge_04": "NOT AUTHORIZED", "v366_freeze": "NOT AUTHORIZED",
          "v366_production_attestation": "NOT AUTHORIZED", "evidence_execution": "NOT AUTHORIZED",
          "authority_touched": False, "prod_seal_artifacts_touched": False,
          "frozen_param_keys_touched": False, "lock_touched": False,
          "immutable_set_touched": False, "prod_read_chain_touched": False,
          "git_tag_created": False}
pe = d.get("production_effects", {})
bad = {k: pe.get(k) for k, v in EXPECT.items() if pe.get(k) != v or k not in pe}
ck("S-16 production_effects 全 %d 键 == 期望（全 false / OFF / NOT AUTHORIZED）" % len(EXPECT),
   not bad, "偏差=%s" % (bad or "无"))

# ------------------------------------------------------- S-17 ★ 别名一致性
ck("S-17 ★ 别名一致性：carrier_commit == evidence_contract_carrier_commit 且 "
   "carrier_blob_sha1 == evidence_contract_git_blob_sha1（⛔ 漂移即 FAIL）",
   d.get("carrier_commit") == d.get("evidence_contract_carrier_commit")
   and d.get("carrier_blob_sha1") == d.get("evidence_contract_git_blob_sha1")
   and d.get("carrier_blob_sha1") == blob_at,
   "%s / %s" % (str(d.get("carrier_commit"))[:12], str(d.get("carrier_blob_sha1"))[:12]))

# ------------------------------------------------------- S-18 自指禁令
own = hashlib.sha256(seal_raw).hexdigest()
ck("S-18 ⛔ 制品不写入自身 sha256（自指悖论）；且 self_hash_policy 明示",
   own not in seal_txt and own[:16] not in seal_txt
   and isinstance(d.get("self_hash_policy"), str) and len(d.get("self_hash_policy")) > 0,
   own[:16])

# ------------------------------------------------------- S-19 change_rule
cr = d.get("change_rule", "")
ck("S-19 change_rule 含 fail-closed + 新裁定 + ⛔ 运行时改写禁令",
   "MISMATCH" in cr and "fail-closed" in cr
   and "新裁定" in cr and "不得运行时改写" in cr,
   "%d 字" % len(cr))

# --------------------------------------------- S-20 ★ canonicalization 权威载体
bd_txt = io.open(BD, encoding="utf-8").read()
ck("S-20 ★ evidence fingerprint canonicalization = `sha256lf`（裁定 A）："
   "Binding Decision §6.5 为**权威载体**；⛔ 制品不自行声明（schema 未扩张）",
   "fingerprint_canonicalization = sha256lf" in bd_txt
   and "git_blob_sha1` ≠ `evidence_sha256" in bd_txt
   and "fingerprint_canonicalization" not in seal_txt
   and "sha256lf" not in seal_txt.lower(),
   "BD §6.5 在场 / 制品 %d B ⛔ 未扩 schema" % len(seal_raw))

print()
print("=" * 54)
print("Seal 绑定自证：%s（%d PASS / %d FAIL）"
      % ("✅ ALL PASS" if not FAIL else "❌ 存在 FAIL", len(PASS), len(FAIL)))
for f in FAIL:
    print("   FAIL: %s" % f)
print("=" * 54)
sys.exit(0 if not FAIL else 1)
