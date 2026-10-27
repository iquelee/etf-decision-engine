# -*- coding: utf-8 -*-
"""
**V6.0 Evidence Freeze Seal 批次 — 最终 Negative Scan**（owner B2 §六）

锚点：`PRE_BATCH = 7d2f39bd…`（批次前远端可见点）。全部判定基于
`git diff --name-status PRE_BATCH..HEAD` 的**真实改动面**，⛔ 不采信任何自述。

核查项 N-1 … N-11：改动面白名单 · 生产路径零命中 · `ml/manifests/**` 零改动 ·
上游治理层零改动 · lock / FROZEN 类对象零命中 · 工作区干净 · 无 tag ·
治理声明在场（auto_execution OFF / GE-04 NOT AUTHORIZED）· 工具链无可执行写/部署命令 ·
无越界肯定式声明。

⛔ 说明：本脚本**按定义**会枚举「禁止出现的 token」，故 N-2 / N-9 扫描时**排除自身**。

用法：python v6_negative_scan.py     （提交前 / 提交后均可运行；N-6 判「脏改动不越界」）
"""
import io
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SELF = os.path.basename(os.path.abspath(__file__))

PRE_BATCH = "7d2f39bddd681cce9d714558d518b06631451d01"
BATCH_COMMITS = ["ccb0f4b8cf402a16b16d468cbff1c02109d72476",
                 "23f4c61451c3fab16515a357e2cc396ba413cfce"]

# 本批次**允许**改动的路径前缀（证据层 / 工具链层）
ALLOW = ("docs/gen1/", "scripts/gen1/evidence-capture/")
# ⛔ 绝不允许出现的路径前缀（生产侧）
FORBIDDEN = ("src/", "cloudfunctions/", "dist-functions/", "frontend/", "web/", "public/",
             "ml/", ".github/", "infra/", "deploy/")
# ⛔ 上游治理层三对象（含 Key 2）
UPSTREAM = ("ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json",
            "docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md",
            "docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md")
# ⛔ lock / immutable / FROZEN 类对象特征
LOCK_PAT = re.compile(r"immutable_lock|frozen_param|_lock\.json|GUARDED_EFFECTIVE_FREEZE", re.I)
# ⛔ 部署 / 写命令特征（工具链层不得出现）
DEPLOY_TOKENS = ("tcb fn deploy", "tcb deploy", "functions:deploy", "firebase deploy",
                 "gcloud functions deploy", "npm run deploy", "cloudbase functions:deploy")
# ⛔ 变更类 tcb 子命令（只读通道只允许 logs / list / detail / get 类）
MUTATING_TOKENS = ('"deploy"', '"rollback"', '"fn update"', "functions:delete", "db:import",
                   '"--force"')
WRITE_OPEN_PAT = re.compile(
    r"open\([^)]*[\"'](cloudfunctions|dist-functions|src)/[^)]*[\"']\s*,\s*[\"'][wa]")
# ⛔ 越界肯定式声明
OVERCLAIM = re.compile(r"Deploy\s*=\s*YES|Canary\s*=\s*ON|auto_execution\s*=\s*true"
                       r"|GE-04\s*=\s*AUTHORIZED|Produces?\s+production\s+authorization", re.I)

PASS, FAIL = [], []


def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


def git(*args):
    r = subprocess.run(["git"] + list(args), cwd=CARRIER,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return r.returncode, r.stdout.decode("utf-8", "replace")


rc, out = git("diff", "--name-status", "%s..HEAD" % PRE_BATCH)
assert rc == 0, "git diff 失败：%s" % out[:120]
rows = [l.split("\t") for l in out.strip().split("\n") if l.strip()]
added = [r[-1] for r in rows if r[0] == "A"]
modified = [r[-1] for r in rows if r[0] == "M"]
changed = [r[-1] for r in rows]

print("== V6.0 Evidence Freeze Seal 批次 · Negative Scan ==")
print("   锚点   PRE_BATCH = %s" % PRE_BATCH[:12])
print("   改动面 %d 项（A=%d / M=%d）" % (len(changed), len(added), len(modified)))
print()

# --------------------------------------------------------------- N-1/N-2 改动面
oob = [p for p in changed if not p.startswith(ALLOW)]
ck("N-1 改动面 %d 项**全部**落在证据层白名单（docs/gen1/ · scripts/gen1/evidence-capture/）"
   % len(changed),
   len(changed) > 0 and not oob, "越界=%s" % (oob[:5] or "无"))

hit = [p for p in changed if p.startswith(FORBIDDEN)]
ck("N-2 ★ ⛔ 零命中生产路径前缀（枚举域 = %d 项改动 × %d 个禁止前缀）"
   % (len(changed), len(FORBIDDEN)),
   not hit, "命中=%s" % (hit[:5] or "无"))

ck("N-3 ⛔ `ml/manifests/**`（含 Key 2 / RUNTIME_BUNDLE / 生产 Seal 制品）零改动",
   not [p for p in changed if p.startswith("ml/")])

# --------------------------------------------------------------- N-4/N-5 治理层
ck("N-4 ★ ⛔ 上游治理层三对象零改动（Key 2 制品 / Charter / 2026-09-22 先例裁定）",
   not [p for p in changed if p in UPSTREAM],
   "改动=%s" % ([p for p in changed if p in UPSTREAM] or "无"))

lock_hit = [p for p in changed if LOCK_PAT.search(p)]
ck("N-5 ⛔ lock / immutable / FROZEN_PARAM / GUARDED_EFFECTIVE_FREEZE 类对象零命中",
   not lock_hit, "命中=%s" % (lock_hit or "无"))

# --------------------------------------------------------------- N-6 工作区
rc6, out6 = git("status", "--porcelain")
# ⚠️ porcelain v1 行格式 = `XY PATH`（XY 恰 2 列）⇒ 用 split(None,1) 取路径，⛔ 不用固定切片
dirty = [l.split(None, 1)[1].strip() for l in out6.strip().split("\n")
         if l.strip() and not l.startswith("??") and len(l.split(None, 1)) == 2]
dirty_oob = [p for p in dirty if not p.startswith(ALLOW)]
ck("N-6 工作区**被跟踪**改动 %d 项全部落在证据层白名单（⛔ 无生产 / ml / 上游治理层脏改动）"
   % len(dirty),
   not dirty_oob, "越界脏改动=%s" % (dirty_oob[:3] or "无（提交后应为 0 项）"))

# --------------------------------------------------------------- N-7 tag
rc7, out7 = git("tag", "--points-at", "HEAD")
alltags = []
for c in BATCH_COMMITS:
    rct, outt = git("tag", "--points-at", c)
    alltags += [t for t in outt.strip().split("\n") if t.strip()]
ck("N-7 ⛔ 无 git tag 指向本批次提交（HEAD / 提交 4 / 提交 5）",
   not [t for t in out7.strip().split("\n") if t.strip()] and not alltags,
   "tag=%s" % (alltags or "无"))

# --------------------------------------------------------------- N-8 声明在场
seal = json.loads(io.open(os.path.join(
    CARRIER, "docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json"), encoding="utf-8").read())
bd = io.open(os.path.join(
    CARRIER, "docs/gen1/GEN1_EVIDENCE_V6_FREEZE_SEAL_BINDING_DECISION.md"),
    encoding="utf-8").read()
rec = io.open(os.path.join(
    CARRIER, "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SEAL_RECORD_20261002.md"),
    encoding="utf-8").read()
pe = seal.get("production_effects", {})
ok8 = (pe.get("auto_execution") == "OFF" and pe.get("ge_04") == "NOT AUTHORIZED")
for txt in (bd, rec):
    ok8 = ok8 and ("auto_execution" in txt or "Auto-execution" in txt) \
        and "GE-04" in txt and "NOT AUTHORIZED" in txt
ck("N-8 ★ 治理声明三处齐备（Seal 制品 + Binding Decision + Seal Record）："
   "auto_execution = OFF · GE-04 = NOT AUTHORIZED",
   ok8)

# --------------------------------------------------------------- N-9 可执行写/部署
scan_py = [p for p in added + modified
           if os.path.basename(p) != SELF and p.endswith((".py", ".js"))]
deploy_hits = {}
for p in scan_py:
    fp = os.path.join(CARRIER, p)
    if not os.path.exists(fp):
        continue
    t = io.open(fp, encoding="utf-8", errors="replace").read()
    h = [tok for tok in DEPLOY_TOKENS if tok in t]
    if h:
        deploy_hits[p] = h
ck("N-9a ⛔ 批次内 %d 个可执行产物零部署命令特征（枚举域 = %s；⛔ 排除本脚本自身）"
   % (len(scan_py), list(DEPLOY_TOKENS)),
   not deploy_hits, "命中=%s" % (deploy_hits or "无"))

cap = io.open(os.path.join(HERE, "c1_capture.py"), encoding="utf-8").read()
mut = [tok for tok in MUTATING_TOKENS if tok in cap]
ck("N-9b ⛔ 采集工具 tcb 通道无变更类子命令（枚举域 = %s）" % list(MUTATING_TOKENS),
   not mut, "命中=%s" % (mut or "无"))

wo = {}
for p in scan_py:
    fp = os.path.join(CARRIER, p)
    if os.path.exists(fp) and WRITE_OPEN_PAT.search(
            io.open(fp, encoding="utf-8", errors="replace").read()):
        wo[p] = True
ck("N-9c ⛔ 无可执行产物以**写模式**打开生产目录文件（cloudfunctions / dist-functions / src）",
   not wo, "命中=%s" % (list(wo) or "无"))

# --------------------------------------------------------------- N-10 越界声明
over = {}
for p in changed:
    fp = os.path.join(CARRIER, p)
    if fp.endswith((".md", ".json")) and os.path.exists(fp):
        t = io.open(fp, encoding="utf-8", errors="replace").read()
        m = OVERCLAIM.findall(t)
        if m:
            over[p] = m[:3]
ck("N-10 ⛔ 批次内 md / json 无越界肯定式声明（Deploy=YES / Canary=ON / "
    "auto_execution=true / GE-04=AUTHORIZED）",
   not over, "命中=%s" % (over or "无"))

# --------------------------------------------------------------- N-11 未推送
rc11, out11 = git("ls-remote", "origin", "refs/heads/docs/gen1-evidence-contract-v5-20261002")
remote = out11.split("\t")[0].strip() if rc11 == 0 and out11.strip() else ""
ck("N-11 ⛔ 批次提交未推送：origin 载体分支尖端仍 == PRE_BATCH（remote-visible 状态未变）",
   remote == PRE_BATCH, "origin=%s" % (remote[:12] or "（读取失败/离线）"))
if rc11 != 0 or not remote:
    print("        ⚠️ 网络/凭据不可用 ⇒ N-11 记 FAIL（须以在线复核为准）")

print()
print("=" * 54)
print("Negative Scan：%s（%d PASS / %d FAIL）"
      % ("✅ ALL PASS" if not FAIL else "❌ 存在 FAIL ⇒ STOP / 报 GAP", len(PASS), len(FAIL)))
for f in FAIL:
    print("   FAIL: %s" % f)
print("=" * 54)
sys.exit(0 if not FAIL else 1)
