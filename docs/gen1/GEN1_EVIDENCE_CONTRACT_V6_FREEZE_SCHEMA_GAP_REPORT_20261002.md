# V6.0 FREEZE SEAL — SCHEMA GAP 报告（SEAL BINDING SCHEMA GAP REPORT）

**文档编号**：`WP-G1-EVIDENCE-CH-6.0-SEAL-GAP`
**状态**：🛑 **STOP-AND-REPORT（2026-10-02）** ｜ ⛔ **本报告不冻结任何对象、⛔ 不构成任何授权**
**as-of**：2026-10-02（北京时间）
**授权依据**：owner 2026-10-02 授权 **V6.0 FREEZE + B3 同批次工具迁移（原子治理批次）**
**触发 STOP 的 owner 条款（照录）**：

> 「如果现有 Freeze Seal binding schema 没有允许 capture_tool / redproof_tool fingerprint，
> 不要擅自改变治理 schema。**先报告：SCHEMA GAP 然后 STOP**。」
> 「如果迁移过程中发现任何真实 Contract / Tool / Seal Schema 不一致，不要为了通过测试而修改语义，
> 直接 **"STOP-AND-REPORT"**。」

---

## 一、结论

```text
SCHEMA GAP                    = CONFIRMED（确认存在，且为硬阻断）
V6.0 CONTRACT FREEZE          = ⛔ HALTED（未执行 —— 被 Seal 绑定 schema 阻断）
c1_capture.py migration       = ⛔ NOT APPLIED（原子批次无法成立 ⇒ §11 规则 5 禁止单独迁移）
c1_gate_redproof.py migration = ⛔ NOT APPLIED（同上）
V6.0_FROZEN                   = ⛔ NOT REACHED
EVIDENCE_TOOL_V6_ALIGNED      = ⛔ NOT REACHED
```

**一句话根因**：owner §五 要求 V6.0 Freeze Seal 绑定 **7 个对象**，其中 **3 个（`contract_sha256` /
`capture_tool_sha256` / `redproof_tool_sha256`）在现行 Freeze Seal binding schema 中**不存在**；
而该 schema 的 `change_rule` 明文要求「升级 / 回退只能通过 PR 显式修改本文件（**等同显式审批动作**）」
⇒ 属**须 owner 单独裁定的治理 schema 变更**，⛔ 不得由本批次自行扩表。

**为什么工具迁移也必须停**：owner 将本批次定义为**原子批次**（Freeze + 两个工具迁移 **必须同一批次**），
契约 §11 **规则 5** 亦明文：*「在 v6.0 冻结**之前**，⛔ 不得把工具改绑到 v6.0 语义 —— 否则会出现
「工具已按**未冻结**契约采样」的**预登记违规**」*。既然 Freeze 被阻断 ⇒ **原子性无法成立**
⇒ 单独迁移工具会**制造**规则 5 明令禁止的窗口 ⇒ ⛔ **不执行**。

---

## 二、Phase A · 冻结前 12 项验证（**已完成，12/12 PASS**）

> 结论：**契约侧完全就绪**。阻断点**不在**契约质量，而**只在** Seal 绑定 schema。

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | V5.0 frozen baseline fingerprint | ✅ | `4fb9463f…f55b` / 64580 B / 1072 行（未变） |
| 2 | V6.0 candidate fingerprint | ✅ | `e93420a3…bef4b1` / 92306 B / 1377 行（未变） |
| 3 | V5→V6 diff matrix | ✅ | 兼容性 C 组 13/13（改动面双向收敛） |
| 4 | V6.0 content assertions | ✅ | 39 PASS / 0 FAIL |
| 5 | V6.0 red-proof | ✅ | 20 PASS / 0 FAIL（15 变异 15/15 检出 + 逐字节还原） |
| 6 | V6.0 compatibility | ✅ | 46 PASS / 0 FAIL（A 16 / B 12 / C 13 / D 5） |
| 7 | R1 independence（v2） | ✅ | 自测 10/0 · RED_PROOF PASS · LEGACY_FALSIFIED PASS · 非干预 10/0 |
| 8 | R2 trigger registry | ✅ | VALIDATE PASS（registry=9 / cloud=9 / missing=[]）· SILENCE PASS · REVERSE_PROOF 7/7 |
| 9 | §5.8 W1/W2 checkpoint discriminator | ✅ | SELFTEST 19/0 · BINDING PASS · FIRST_WINDOW_WINS 3/3 · CROSS 3/3 · RED_PROOF 7/7 |
| 10 | R3 contract-consumption | ✅ | 12 PASS / 0 FAIL |
| 11 | Python ↔ JS parity | ✅ | 6 PASS / 0 FAIL |
| 12 | 完整 22/22 regression | ✅ | 22 步 ALL PASS（实时重跑，见证据日志） |

```text
回归总结：22 步，✅ ALL PASS
证据日志 = _g4-tools/out/v6_regression_20261002.log
```

---

## 三、SCHEMA GAP —— 精确对照

### 3.1 请求绑定集（owner §五，7 项） vs 现有 schema（4 项）

| # | owner 请求的绑定对象 | 现行 schema 是否允许 | 判定 |
|---|---|---|---|
| 1 | `contract_version = V6.0` | ⚠️ **存在同名键，但语义不同**（见 §四.3） | ⚠️ 语义碰撞 |
| 2 | `contract_sha256 = <最终冻结值>` | ❌ **无此键** | 🛑 **GAP** |
| 3 | `source_sha256 = <C1 source binding>` | ✅ 有（值 `4fadfe1a…9e82`，17 文件） | ✅ |
| 4 | `model_sha256 = <现有冻结模型绑定>` | ✅ 有（值 `d5e667c6…e712`，sealed 2026-09-10） | ✅ |
| 5 | `threshold_version = <现有冻结值>` | ✅ 有（observed `shadow-threshold-v1`） | ✅ |
| 6 | `capture_tool_sha256 = <迁移后 c1_capture.py>` | ❌ **无此键** | 🛑 **GAP** |
| 7 | `redproof_tool_sha256 = <迁移后 c1_gate_redproof.py>` | ❌ **无此键** | 🛑 **GAP** |

```text
请求 7 项 → 可绑定 3 项（source/model/threshold） + 1 项语义存疑（contract_version）
         → 缺失 3 项（contract_sha256 / capture_tool_sha256 / redproof_tool_sha256）
SCHEMA GAP = 3 个新增字段 + 1 处语义碰撞
```

### 3.2 全仓存在性证明（否定性断言，**显式声明枚举域**）

| 检索 token | 枚举域 | 命中 |
|---|---|---|
| `capture_tool` | 全仓 `*.md` / `*.json` / `*.js` / `*.py`（排除本批次契约树） | **0** |
| `redproof_tool` | 同上 | **0** |
| `tool_sha256` / `_tool` | `ml/manifests/**`（全部冻结制品） | **0** |

⇒ 该二字段**此前从未被任何治理 schema 定义**，⛔ 不能「按既有惯例」推定其存在。

---

## 四、schema 权威来源（三处互证）

### 4.1 `GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.1（**定义源**）

> `| **Key 2 — Freeze Seal** | `GUARDED_EFFECTIVE_FREEZE` 制品状态 == `APPROVED`，
> 且绑定 **source SHA + model SHA + threshold 版本 + contract version** **四项**
> 与运行期实读**逐项一致** | 新增冻结制品（WP-G1-GE-01/02） |`

⇒ **四项**，逐字枚举；⛔ 无 tool fingerprint 位。

### 4.2 `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json`（**制品实态**）

```json
{
  "seal_id": "GUARDED_EFFECTIVE_FREEZE",
  "contract_version": "WP-G1-GE-CH-1.0",
  "work_package": "WP-G1-GE",
  "charter": "docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md",
  "status": "PENDING",
  "approved_at": null,
  "approved_by": null,
  "source_sha256": null,
  "model_sha256": null,
  "threshold_version": null,
  "bindings_status": "INCOMPLETE",
  "as_of": "2026-09-16",
  "change_rule": "升级/回退只能通过 PR 显式修改本文件（等同显式审批动作），不得运行时改写。"
}
```

- 制品 sha256 = `35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5`
- **绑定字段恒为 4 个**：`contract_version` / `source_sha256` / `model_sha256` / `threshold_version`
- ⛔ **无** `contract_sha256`、⛔ **无** `capture_tool_sha256`、⛔ **无** `redproof_tool_sha256`
- ★ `change_rule` 明文：**扩表 = 显式审批动作**

### 4.3 `GEN1_FREEZE_SEAL_BINDING_DECISION.md`（**上游裁定**，2026-09-22）

> 「`GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.1 Key 2 要求 Freeze Seal 绑定**四项**
> （`source_sha256` / `model_sha256` / `threshold_version` / `contract_version`）与运行期实读**逐项一致**。」

- 该裁定**只**定义了 `source_sha256` 的对象（= **C1**，`src/common/utils/gen1-*.js`，17 文件），
  ⛔ **未**定义任何 tool fingerprint 键。
- 并在 §四 写入**重算时机规则**（仅 GE-04 晋升时重算；晋升后 C1 集合视为冻结、⛔ 不得修改）。
- 文末纪律：「修改须走**新裁定**，⛔ 不得原地改。」

### 4.4 ⚠️ 二阶不一致：`contract_version` **同名不同义**（附加发现）

| 出处 | `contract_version` 的实指 | 值 |
|---|---|---|
| Key 2 schema（Charter §3.1 / 制品） | **`GEN1_GUARDED_EFFECTIVE_CHARTER`** 的版本 | `WP-G1-GE-CH-1.0` |
| owner §五 | **`GEN1_EVIDENCE_CONTRACT`** 的版本 | `V6.0` |

⇒ 二者**不是同一个契约**。若把 `V6.0` 直接写入 Key 2 的 `contract_version`，
将把**证据契约**的版本覆盖到**激活安全宪章**的版本位上 ⇒ **破坏 Key 2 语义**。
⛔ 本批次**未**做此写入。

> 同理，`source_sha256`（= C1 Gen-1 逻辑本体）与 **Evidence Tool**（`c1_capture.py` 属采集工具、
> 不在 `src/common/utils/gen1-*.js` 内）**分属不同集合** ⇒ 工具指纹**无法**被 `source_sha256` 收纳。

---

## 五、⛔ 本批次**未执行**的动作（硬边界，逐项确认）

| # | 动作 | 状态 |
|---|---|---|
| 1 | V6.0 Contract Freeze Seal（写入 / 生效） | ⛔ **未执行**（被 §三 GAP 阻断） |
| 2 | 修改 `GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.1 | ⛔ **未执行**（owner 明令不得擅改治理 schema） |
| 3 | 修改 `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` | ⛔ **未执行**（`change_rule` 要求显式审批） |
| 4 | `c1_capture.py` 迁移（B3） | ⛔ **未执行**（§11 规则 5：须与冻结同批次） |
| 5 | `c1_gate_redproof.py` §[6] 迁移 | ⛔ **未执行**（同上） |
| 6 | 修改 Contract（任何字节） | ⛔ **未执行**（§四明令：Contract = source of truth） |
| 7 | git commit / tag / push | ⛔ **未执行** |
| 8 | V3.6.6 Freeze / Production Attestation / Evidence Seal / GE-04 | ⛔ **未执行 / 未授权** |
| 9 | merge / master integration / deploy / rollback / canary / auto_execution / production DB write | ⛔ **未执行** |

**基线零漂移复核**：

```text
V5.0 frozen baseline  4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b  ✅ 未变
V6.0 candidate        e93420a38a4b92c7c5eb577c4cf5af81e6d913dc22df361a1e981978efbef4b1  ✅ 未变
c1_capture.py         dd2ea8b0090853e36a28e8590fbf62519b2e7461ab7a5160c0e475a9841c8c42  ✅ 未变（未迁移）
c1_gate_redproof.py   0cca693ce6728b627190b04fcd78fb92ebc5153e8318dbc4f6ef39dcec06bc20  ✅ 未变（未迁移）
Seal artifact         35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5  ✅ 未变
```

---

## 六、给 owner 的裁定选项（⛔ 本批次不自行选边）

| 选项 | 内容 | 代价 / 影响 |
|---|---|---|
| **O-1（推荐）** | **授权一次独立裁定**，定义 **V6.0 Evidence Freeze Seal** 为**新治理对象**（与 Key 2 并列、⛔ **不**改 Key 2），其 binding schema = owner 所列 7 项（含 `contract_sha256` / `capture_tool_sha256` / `redproof_tool_sha256`）；落点可为 `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SEAL_*.md`（type-A 文档层，⛔ 不触碰生产 Seal 制品） | 需 owner 单独裁定 + 新 schema 定义；**不改** Key 2、**不动**生产制品 |
| **O-2** | **按现有 Key 2 四项 schema 绑定**（放弃 tool fingerprint），工具指纹改用**伴随证据**（Alignment Report + Evidence Bundle）承载，⛔ 不进 Seal | 立即可行；但 owner 要求的「Seal 绑定工具指纹」**不成立** |
| **O-3** | **正式扩表 Key 2 schema**（Charter §3.1 + 制品 `change_rule` 路径） | ⛔ 改动**生产激活安全**制品 ⇒ 高风险、须独立高闸门授权；⛔ 不建议与契约冻结同批 |

> ⚠️ **共同前提**：无论选哪项，`contract_version` 的**同名不同义**（§四.4）都须**先裁定**
> —— 明确 V6.0 Seal 里的 `contract_version` 指**证据契约版本**，与 Key 2 的
> `WP-G1-GE-CH-1.0`（激活宪章版本）**分列不同键或不同对象**。

---

## 七、四块式取证

```text
ETF 仓库（契约载体树 _g1-contract-v5-20261002 @ 7d2f39bd，local == origin）：
- Git 跟踪文件：零修改（git diff --stat HEAD 空；status --short 跟踪项 0 行）
- Git 历史 / 分支 / 远端：零修改（未 commit / 未建 tag / 未 push）
- 未跟踪本地产物（?? 级）：本报告 + 既有 6 件契约产物 + 判据/夹具（仅本地、不入库）
其他本机文件：
- .workbuddy/memory/：2026-10-02.md（追加本段）· MEMORY.md（如需，等量替换且预算内）
- 仓库外 _g4-tools/：新增 schema 侦察与报告生成脚本（⛔ 不入库）
生产侧：
- 代码 / 配置 / DB / Authority / FROZEN_PARAM_KEYS / lock / immutable_set / 生产 Seal 制品：零修改
- ⛔ 未部署 / 未 merge / 未建 tag / 未 canary / 未 GE-04 / 未 Evidence Seal / 未写生产 DB
```

---

## 八、复算方法（任何人可独立复现）

```bash
# ① 现有 Key 2 schema 只有四项（Charter §3.1）
grep -n "Key 2 — Freeze Seal" docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md
#   → 期望：绑定 source SHA + model SHA + threshold 版本 + contract version「四项」

# ② 制品绑定字段集（应为 4 个绑定键，无 tool 指纹）
python -c "import json;d=json.load(open('ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json',encoding='utf-8'));\
print([k for k in d if k.endswith('_sha256') or k in ('contract_version','threshold_version')])"
#   → 期望：['contract_version','source_sha256','model_sha256','threshold_version']

# ③ 工具指纹全仓不存在
grep -rn "capture_tool\|redproof_tool" --include='*.md' --include='*.json' --include='*.js' --include='*.py' .
#   → 期望：（无输出）
```

---

**页脚**
本报告为 **STOP-AND-REPORT** 产物，⛔ 不冻结任何对象、⛔ 不构成任何授权、⛔ 不改变任何生产行为。
⚠️ 本件自身指纹**不入正文**（自指 ⇒ 内嵌即变）—— 于**交付清单外**单列。
⛔ **本阶段到此 STOP**；解除阻断须 **owner 就 §六 三选项择一裁定**，然后方可重启 V6.0 FREEZE 批次。
