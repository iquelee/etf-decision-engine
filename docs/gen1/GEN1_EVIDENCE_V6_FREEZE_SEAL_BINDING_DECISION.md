# `V6.0 Evidence Freeze Seal` 绑定对象裁定（BINDING DECISION）

**文档编号**：`WP-G1-EVIDENCE-CH-6.0-SEAL-BD`
**文档性质**：**裁定记录（Decision Record）** —— 定义**新立的独立治理对象** `V6.0 Evidence Freeze Seal`
的 **authority / scope / version namespace / freeze lifecycle / binding schema**。
**裁定日期**：2026-10-02（owner 裁定 **O-1 = APPROVED**）
**as-of**：2026-10-02（北京时间）
**依据**：
① `GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.1 **Key 2**；
② `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json`（`change_rule`）；
③ `docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md`（2026-09-22 上游裁定）；
④ `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SCHEMA_GAP_REPORT_20261002.md`（**触发本裁定的证据**）；
⑤ `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md` §11 / §12 / §13（**FROZEN** `7e3e5d87…272e`）。

```text
DECISION   O-1 = APPROVED —— 新立独立治理对象「V6.0 Evidence Freeze Seal」
           （与 Key 2 并列、互不覆盖；⛔ 不改 Key 2、⛔ 不动生产 Seal 制品）
SCOPE      仅「定对象 + 定 schema + 定 lifecycle + 定 namespace」；⛔ 不含任何生产代码 / 制品 / 部署改动
O-2        ⛔ REJECTED（不采用：放弃 tool fingerprint 使 owner §五 的绑定要求不成立）
O-3        ⛔ REJECTED（不采用：扩 Key 2 schema 会改动**生产激活安全**制品）
DOWNSTREAM 本裁定**不授权**执行：见 §8
```

---

## 0. ★ 同名辨析（**must-read，⛔ 不得混用**）

本仓现有**四组**名的「FROZEN / SEAL」。它们**对象不同、判据不同、授权不同、namespace 不同**，
⛔ **互不替代、互不覆盖、互不改写、不得互相推断**：

| # | 名称 | 对象 | 判据 | namespace / 版本位 | 本裁定的关系 |
|---|---|---|---|---|---|
| A | **本契约载体冻结** | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md`（**文档层**） | 状态翻 `FROZEN` + 锚定 carrier commit / blob / sha256 | `WP-G1-EVIDENCE-CH-6.0` | ✅ **本裁定的绑定对象之一**（#1 / #2 项） |
| B | **Key 2 — Freeze Seal**（`GEN1_GUARDED_EFFECTIVE_CHARTER` §3.1） | **生产制品** `GUARDED_EFFECTIVE_FREEZE` | 制品 `status == APPROVED` 且四项与**运行期实读**逐项一致 | `WP-G1-GE-CH-1.0`（**激活安全宪章**） | ⛔ **完全不同的对象**；本裁定⛔ **未触碰** |
| C | **Key 3 — Evidence Seal** | **统计证据资格** | == `EVIDENCE_POSITIVE`（契约 §4.2）⇒ 须 **≥30 独立事件** | 契约 §4.2 | ⛔ **完全不同**；本裁定日 `independent_events = 0` ⇒ ⛔ `NOT AUTHORIZED` |
| **D** | **`V6.0 Evidence Freeze Seal`（★ 本裁定新立）** | **证据契约 + 采集工具 + red-proof 工具**（**文档层 / 工具链层**） | 三对象 SHA 逐项绑定 + Tool Alignment `PASS` + lifecycle == `EVIDENCE_FREEZE_SEALED` | `gen1-evidence-contract`（**证据契约**） | ✅ **即本裁定的产出对象** |

```text
契约载体冻结（A）  ≠  Key 2（B）  ≠  Key 3（C）  ≠  V6.0 Evidence Freeze Seal（D）
D 绑 A + 工具        ⛔ 不覆盖 B    ⛔ 不替代 C      D 的 SEALED ⛔ ≠ B 的 APPROVED ⛔ ≠ C 的 EVIDENCE_POSITIVE
```

> ⛔ **D 的 `SEALED` 不构成任何生产授权**；`gen1_authority` 保持 `CANARY`，`ml_effective = false`，
> `gen1_production_write = false`，`gen1_auto_execution = false`。

---

## 1. 问题（为什么必须有这一裁定）

`SCHEMA GAP REPORT`（`9eebd2da…342dd5`）以**三方互证**确认：

| # | owner 请求的绑定对象 | 现行 Key 2 schema | 判定 |
|---|---|---|---|
| 1 | 证据契约版本 | ⚠️ **同名不同义**（Key 2 的 `contract_version` 指**激活宪章**版本 `WP-G1-GE-CH-1.0`） | ⚠️ 语义碰撞 |
| 2 | `evidence_contract_sha256` | ❌ 无此键 | 🛑 **GAP** |
| 3 | `source_sha256` | ✅ 有 | ✅ 但**归属权在 Key 2** |
| 4 | `model_sha256` | ✅ 有 | ✅ 但**归属权在 Key 2** |
| 5 | `threshold_version` | ✅ 有 | ✅ 但**归属权在 Key 2** |
| 6 | `capture_tool_sha256` | ❌ 无此键 | 🛑 **GAP** |
| 7 | `redproof_tool_sha256` | ❌ 无此键 | 🛑 **GAP** |

三条硬约束使「就地扩 Key 2」**不可行**：

1. `GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.1 明文 **四项**（逐字枚举），⛔ 无 tool fingerprint 位；
2. `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` 的 `change_rule`：
   *「升级/回退只能通过 PR 显式修改本文件（**等同显式审批动作**），不得运行时改写。」*
3. `GEN1_FREEZE_SEAL_BINDING_DECISION.md` 文末：*「本文件为治理裁定记录。修改须走**新裁定**，⛔ 不得原地改。」*

⇒ 工具指纹（`c1_capture.py` / `c1_gate_redproof.py`）**不在** `src/common/utils/gen1-*.js`（C1）集合内，
**无法**被 `source_sha256` 收纳；且该二字段**此前从未被任何治理 schema 定义**（全仓命中 = 0）。

**结论**：需要**新立**一个与 Key 2 **并列而独立**的治理对象 —— 这正是 `O-1`。

---

## 2. 裁定：`V6.0 Evidence Freeze Seal` 的归属映射（**无「谁覆盖谁」歧义**）

```text
Key 2 — Freeze Seal  ↓  GEN1_GUARDED_EFFECTIVE_CHARTER §3.1
                        （激活安全宪章；⛔ 本裁定对其零改动）

V6.0 Evidence Freeze Seal  ↓  GEN1_EVIDENCE_CONTRACT_V6.md（证据契约）
                          +  c1_capture.py（采集工具）
                          +  c1_gate_redproof.py（red-proof 工具）
```

**约束方向（⛔ 单向，不得反推）**：

| 关系 | 方向 | 含义 |
|---|---|---|
| Key 2 ↮ `V6.0 Evidence Freeze Seal` | **并列 / 正交** | 二者绑定**不同对象集**；⛔ 任一变更**不**导致另一方失效；⛔ **不存在覆盖关系** |
| `V6.0 Evidence Freeze Seal` → 证据契约 + 两工具 | **绑定（binding）** | 三对象任一字节变化 ⇒ Seal 立即 `MISMATCH`（fail-closed） |
| Key 2 → `source_sha256` / `model_sha256` / `threshold_version` | **归属权在 Key 2** | 本 Seal **只引用、不主张**（见 §6.2） |

> ⚠️ **必须显式否定**：`V6.0 Evidence Freeze Seal` 的 `SEALED` **⛔ 不蕴含** Key 2 的 `APPROVED`，
> ⛔ **不蕴含** Key 3 的 `EVIDENCE_POSITIVE`，⛔ **不蕴含** 任何生产授权。
> 反之，Key 2 的 `PENDING / INCOMPLETE` **⛔ 不阻断**本 Seal 成立（二者判据不同）。

---

## 3. ★ version namespace（⛔ 防同名污染）

| 对象 | namespace | 版本位字段名 | 值 |
|---|---|---|---|
| Key 2 | `gen1-guarded-effective-charter` | **`contract_version`** | `WP-G1-GE-CH-1.0` |
| `V6.0 Evidence Freeze Seal` | `gen1-evidence-contract` | **`evidence_contract_version`** | `v6.0` |

```text
⛔ 禁止把 "V6.0" 写进 Key 2 的 contract_version（会以证据契约版本覆盖激活宪章版本位）
⛔ 禁止在本 Seal 中使用键名 contract_version（避免同名污染）
✅ 本 Seal 一律使用 evidence_contract_version + evidence_contract_sha256（带 evidence_ 前缀）
```

**验收口径**：本 Seal 制品的键集**不含** `contract_version`；
`evidence_contract_version` 与 `evidence_contract_sha256` 二键**必须同时在场**（成对，缺一即 schema 违规）。

### 3.1 ★ owner 术语 ⇄ 本仓现行键名 ⇄ 本 Seal 规范键名（⛔ 防第三套命名）

| owner 术语 | 本仓**现行**键名 | 值 | 处理 |
|---|---|---|---|
| `charter_version` | **`contract_version`**（Key 2 制品内） | `WP-G1-GE-CH-1.0` | ⛔ 本仓**不存在**名为 `charter_version` 的键（全仓命中 = **0**）⇒ 二者**互指**；⛔ **不新建该键**（新建 = 改 Key 2，属 `O-3`，已 REJECTED） |
| `carrier_commit` | `carrier_commit`（字面别名）· `evidence_contract_carrier_commit`（规范名） | `ccb0f4b8…` | 同名同值，见 §6.4 |
| `carrier_blob_sha1` | `carrier_blob_sha1`（字面别名）· `evidence_contract_git_blob_sha1`（规范名） | `29425933…` | 同名同值，见 §6.4 |

⚠️ **三套命名必须显式互指**（owner 术语 / Key 2 现行键名 / 本 Seal 规范键名）——
否则会重演 §1 表中已发生过的 `contract_version` **同名不同义**事故。
⚠️ 第 3 项的**字面别名**是 owner §二 术语的落地形式；其同值性由
`v6_seal_binding_selfcheck.py` **S-17 逐字节断言**（⛔ 漂移即 FAIL ⇒ fail-closed）。

---

## 4. ★ Seal lifecycle（**先定义 lifecycle，再 Freeze**）

owner §五：`EVIDENCE_FREEZE_SEALED` **只能**绑定**已最终确定**的 Contract / capture tool / red-proof tool
⇒ ⛔ **不能先 Seal 契约再改工具**。故 lifecycle 先于任何 Freeze 动作定义如下：

```text
S0  V6.0_EVIDENCE_FREEZE_CANDIDATE    证据契约候选件已产出、内容断言全过（⛔ 未冻结）
      ↓  判据：候选件 sha256 冻结 + 内容断言 / 兼容性 / 打红自证 ALL PASS
S1  TOOL_ALIGNMENT_PASS               契约 ↕ 采集工具 ↕ red-proof 工具 语义一致（L1–L5 全过）
      ↓  判据：v6_contract_tool_alignment.py = 0 FAIL
S2  EVIDENCE_FREEZE_SEAL_READY        三对象 SHA **均已最终确定**（契约已 FROZEN、两工具已迁移）
      ↓  判据：契约 content sha256 可复算且 == 载体实测；两工具 sha256 已定稿；
             版本错配反向证明 RP-A / RP-B **必 FAIL**、RP-C **必 PASS**
S3  EVIDENCE_FREEZE_SEALED            ★ 制品落盘：三对象 SHA 逐项绑定 + lifecycle 记录 + change_rule
```

**状态单调**：`S0 → S1 → S2 → S3` **单向**；⛔ **不得跳级**，⛔ **不得回退**（回退须**新裁定**）。
**⛔ 硬约束（本原子批次的核心）**：

```text
在 S3 之后**任何**对 c1_capture.py / c1_gate_redproof.py 的字节改动
⇒ 工具的 SHA 变化 ⇒ 本 Seal 立即 MISMATCH ⇒ 必须**重新走 S1→S2→S3**（新 Seal 批次）
⇒ 因此本批次把「契约冻结 + 两工具迁移 + Alignment + Seal」压在**同一原子批次**内完成。
```

---

## 5. seal 制品落点与形态

| 项 | 值 |
|---|---|
| 机器可读制品 | `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json` |
| `seal_id` | `EVIDENCE_FREEZE_SEAL_V6`（⛔ **≠** Key 2 的 `GUARDED_EFFECTIVE_FREEZE`） |
| `seal_kind` | `EVIDENCE_FREEZE_SEAL` |
| `seal_layer` | `DOCUMENT_LAYER`（**文档层 / 工具链层**；⛔ 非生产制品层） |
| 落盘规则 | ⛔ **不写入自身 sha256**（自指悖论）；其指纹于**交付清单外**单列 |
| 变更规则 | `change_rule` 见 §7 |

---

## 6. 绑定 schema

### 6.1 七项绑定（owner §四，**逐项在场，⛔ 不得删除**）

| # | 键 | 绑定对象 | 取值来源 |
|---|---|---|---|
| 1 | `evidence_contract_version` | 证据契约版本 | `v6.0`（契约状态头） |
| 2 | `evidence_contract_sha256` | 证据契约**内容**哈希 | 冻结载体实测 |
| 3 | `source_sha256` | C1 Gen-1 逻辑本体 | **Key 2 归属** ⇒ 引用 |
| 4 | `model_sha256` | Gen-1 运行时模型 | **Key 2 归属** ⇒ 引用 |
| 5 | `threshold_version` | 阈值版本 | **Key 2 归属** ⇒ 引用 |
| 6 | `capture_tool_sha256` | `c1_capture.py`（v6.0） | 迁移后实测 |
| 7 | `redproof_tool_sha256` | `c1_gate_redproof.py`（v6.0） | 迁移后实测 |

### 6.2 ★ 判断结论：第 3–5 项采用 **`reference_to_key2_seal`**（⛔ 不是「为简化而自行选择」）

**判断依据（全部来自既有治理文档，逐条可复核）**：

| # | 治理证据 | 推论 |
|---|---|---|
| 1 | `GEN1_FREEZE_SEAL_BINDING_DECISION.md` §4 **R1–R4**：`source_sha256` **只在 GE-04 晋升时重算并重新冻结**；R4 要求记录「裁定值 + 集合清单 + 复算命令 + 复算时点」 | 该项的**重算权与时点**归 **GE-04 晋升 / Key 2 lifecycle**，⛔ 不在证据 Seal 的处置范围内 |
| 2 | `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` 的 `change_rule` = 「升级/回退只能通过 PR 显式修改本文件（**等同显式审批动作**）」 | 三项的值由**该制品独占承载与版本化**；另设副本 = 制造**第二权威** |
| 3 | `SCHEMA GAP REPORT` §4.4：`contract_version` 已发生**同名不同义**污染 | 同一治理层**已有**一次「同名双源」事故 ⇒ ⛔ 不得再为三项制造第二个承载位 |
| 4 | 三项在 Key 2 制品中当前实值 **均为 `null`**、`bindings_status = INCOMPLETE`、`status = PENDING` | 证据 Seal **无法**合法声称其「已绑定并已核验」⇒ 只能**引用 + 标注未闭合** |

**结论**：三项**属 Key 2 安全语义** ⇒ 本 Seal 以 **`reference_to_key2_seal`** 绑定：
**记录其解析值（供审计）但显式声明「⛔ 非本 Seal 的独立主张 / NOT AN INDEPENDENT CLAIM」**，
并同时登记 Key 2 制品的 `sha256` 与 `status = PENDING / bindings_status = INCOMPLETE`。

⛔ **不删除字段**：三项仍作为**独立键**存在于制品顶层（owner §四明令），
其「引用」属性由 `binding_routes` 逐键声明（见制品 `binding_routes`）。

**本裁定下三项的解析值（as-of 2026-10-02，仅作审计读数）**：

| 键 | 解析值 | 权威来源 | Key 2 制品内实值 | 独立主张 |
|---|---|---|---|---|
| `source_sha256` | `4fadfe1a6b93c0896c8f50984f0b13b2f14c8798ba0bc9a6fda7f9f026119e82`（C1 = 17 文件） | `GEN1_FREEZE_SEAL_BINDING_DECISION.md` §2 裁定值 | `null` | ⛔ **否** |
| `model_sha256` | `d5e667c66a5f888bb5489b8adcad9e6a141bfbcf0006a955d6ad40e269a7e712` | `ml/manifests/GEN1_RUNTIME_BUNDLE.json:4`（sealed 2026-09-10） | `null` | ⛔ **否** |
| `threshold_version` | `shadow-threshold-v1` | `ml/manifests/GEN1_RUNTIME_BUNDLE.json:11` + `src/common/utils/gen1-guarded-seal.js:57`（`GUARDED_THRESHOLD_VERSION`） | `null` | ⛔ **否** |

> ★ **本批次独立复核（只读，2026-10-02）**：按 §9 复算脚本重算 `source_sha256`，
> 结果 **`4fadfe1a…9e82`，与 2026-09-22 裁定值逐位相同**（C1 = 17 文件）⇒ C1 集合自裁定以来**未变**。
> ⚠️ 该复核**只证明「取值可复算」**，⛔ **不主张** Key 2 绑定已成立（制品仍 `PENDING / INCOMPLETE`）。

### 6.3 三项之外的必备声明键（⛔ 缺一即 schema 违规）

| 键 | 作用 |
|---|---|
| `seal_status` | 恒 `EVIDENCE_FREEZE_SEALED`（须 == `seal_lifecycle.achieved_state`） |
| `binding_routes` | 逐键声明 `route` / `owned_by` / `independent_claim` |
| `seal_lifecycle` | `S0–S3` 四态 + `achieved_state`（= `EVIDENCE_FREEZE_SEALED`）+ 每态判据证据 |
| `tool_alignment` | `PASS` + 计数 + **版本错配反向证明 RP-A/RP-B/RP-C** |
| `evidence_seal_key3` | 恒 `NOT_AUTHORIZED` + `independent_events`（本轮 = 0）+ 门槛（30） |
| `reference_to_key2_seal` | `reference_only = true` + `independent_claim = false` + 制品 sha256 + `key2_status` / `key2_bindings_status` + `key2_unchanged_by_this_batch` |
| `production_effects` | 生产侧零效应自证（见 §8） |
| `change_rule` | 变更规则（见 §7） |

### 6.4 ★ 载体身份字段（owner §二「按既有 Seal 先例补齐」，⛔ 不得删除）

| # | 键 | 取值来源（⛔ 一律脚本实读，禁止手填） | 实测值 |
|---|---|---|---|
| 1 | `evidence_contract_path` | 载体路径 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md` |
| 2 | `evidence_contract_carrier_commit` = 别名 `carrier_commit` | `git rev-parse` 实测 | `ccb0f4b8cf402a16b16d468cbff1c02109d72476` |
| 3 | `evidence_contract_parent_commit` | carrier 提交的 parent 实测 | `7d2f39bddd681cce9d714558d518b06631451d01` |
| 4 | `evidence_contract_git_blob_sha1` = 别名 `carrier_blob_sha1` | `git rev-parse <carrier>:<path>` | `294259338ba3fa60f689ed9139072a35b2368b0e` |
| 5 | `evidence_contract_sha256` | 载体**内容** sha256（工作区 + blob 双侧对拍） | `7e3e5d87…272e` |
| 6 | `evidence_contract_bytes` / `_lines` / `_eol` | 实测 | 97203 B / 1413 行 / LF |
| 7 | `capture_tool_bytes` / `_lines` / `_eol`；`redproof_tool_bytes` / `_lines` / `_eol` | 实测 | 31143 B / 629 行；14904 B / 311 行 |
| 8 | `capture_tool_prev_sha256_v5` / `redproof_tool_prev_sha256_v5`（+ `_bytes_v5` / `_lines_v5`） | v5.0 前值（迁移留痕） | 见制品 |

**字面对齐别名**：`carrier_commit` / `carrier_blob_sha1` = 上表 #2 / #4 的**同值别名**，
其一致性由 `v6_seal_binding_selfcheck.py` **S-17** 逐字节断言（⛔ 漂移即 FAIL）。
**规范键名**仍为带 `evidence_contract_` 前缀者（namespace 纪律，见 §3 / §3.1）。

### 6.5 ★ fingerprint canonicalization —— `sha256lf`（owner 2026-10-02 裁定 **A**）

```text
fingerprint_canonicalization = sha256lf
```

**定义（⛔ 逐字采用 owner 裁定文本）**：

> 对参与 V6 Evidence Freeze Seal binding 的文本制品，先规范化 CRLF/CR → LF，再计算 SHA-256；
> 该规范化**仅用于 Evidence Fingerprint**，⛔ **不修改 Git 工作区文件**，也⛔ **不改变 Git blob identity**。

**实现（⛔ 本 Seal 的唯一算法来源 = 本节；任何人可复现）**：

```python
import hashlib
def sha256lf(path):
    b = open(path, "rb").read()
    return hashlib.sha256(b.replace(b"\r\n", b"\n").replace(b"\r", b"\n")).hexdigest()
```

> ⚠️ 顺序**先 `CRLF → LF`、再 `裸 CR → LF`**，⛔ 不可颠倒。
> ⛔ 仓库级 Git 换行配置（`core.autocrlf` / `.gitattributes`）**一律不动** ——
> 归一**不**通过仓库配置实现，⛔ **不创建、不修改 `.gitattributes`**。

**适用范围（⛔ 边界必须显式）**：

| 域 | `sha256lf` | 说明 |
|---|---|---|
| V6 Evidence Freeze Seal **三绑定对象**（证据契约 + `c1_capture.py` + `c1_gate_redproof.py`） | ✅ **适用** | `evidence_contract_sha256` / `capture_tool_sha256` / `redproof_tool_sha256` **按 `sha256lf` 取值** |
| 本 Seal 批次内其它 evidence-layer 文本制品（自证脚本 / 证据文档） | ✅ 适用 | 同一口径，便于审计（⛔ 非绑定值） |
| **Key 2 制品** `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` | ⛔ **不适用 / ⛔ 不写入** | Key 2 保有其**自身**口径（工作区文件 sha256 = `35040e5e…09e5`，实测 **CRLF**）；⛔ 不得据此重算 Key 2 绑定值，⛔ 不得把 `sha256lf` 写入 Key 2 |
| 仓库级 Git 换行配置（`.gitattributes` / `core.autocrlf`） | ⛔ **一律不动** | 归一⛔ 不通过仓库配置实现 |

#### 6.5.1 ★ `git_blob_sha1` ≠ `evidence_sha256`（⛔ 二者不得互相替代）

| 指纹 | 算法 | 量纲 | 作用域 | 本 Seal 实例 |
|---|---|---|---|---|
| `git_blob_sha1` | Git 对象哈希（SHA-1，含 `blob <len>\0` 头） | 40 hex | **Git 对象身份**（寻址 / 可达性） | `294259338ba3fa60f689ed9139072a35b2368b0e` |
| `evidence_sha256` | `sha256lf`（CRLF/CR → LF 后 SHA-256） | 64 hex | **Evidence Fingerprint**（内容同一性论断） | `7e3e5d87…272e` |

```text
⛔ 二者**量纲不同 / 算法不同 / 用途不同** ⇒ **不得互相替代**（⛔ 不得用 blob sha1 充当 evidence sha256）
✅ 二者可**互证**：同一对象上 `sha256lf(工作区文件) == sha256lf(git cat-file -p <blob>) == 绑定值`
   ⇒ 由 `v6_fingerprint_canonicalization_check.py` F-6 / F-7 / F-7b 逐项断言
```

#### 6.5.2 ★ 本裁定的重新计算（owner §A.3；实测结果 = 「同值 ⇒ ⛔ 不重绑定」）

| 对象 | `sha256lf(当前文件)` | Seal 已绑定 fingerprint | 判定 |
|---|---|---|---|
| `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md` | `7e3e5d87…272e` | `7e3e5d87…272e` | ✅ **相同** |
| `scripts/gen1/evidence-capture/c1_capture.py` | `d0acc9e4…a4337` | `d0acc9e4…a4337` | ✅ **相同** |
| `scripts/gen1/evidence-capture/c1_gate_redproof.py` | `e795c934…aba0` | `e795c934…aba0` | ✅ **相同** |

> 三对象实测**纯 LF（CRLF = 0）** ⇒ 归一为**无操作** ⇒ `sha256lf == 原始 sha256` ⇒ 依 owner 明令
> **⛔ 不重写 Seal 制品**（其保持 `a585a33a…b62` / 10723 B，逐字节未变；由 F-14a 断言）。
> ⛔ 本裁定⛔ **不**向 Seal 制品新增 schema 键（owner 明令：⛔ 不得自行扩展 schema）——
> canonicalization 的**权威载体 = 本节**；Seal 制品经其 `binding_decision` 字段指向本文件。
> ✅ 因此**未出现**「须改绑定值 / 治理层冲突」⇒ ⛔ **不触发** owner §A 的 STOP 条件。

---

## 7. authority / scope / change rule

```text
AUTHORITY   owner 2026-10-02 裁定 O-1 = APPROVED（本裁定即为该项的授权载体）
            owner 2026-10-02 裁定 A —— fingerprint_canonicalization = sha256lf（见 §6.5；
            ⛔ 不动 .gitattributes / ⛔ 不改仓库级 Git 换行配置 / ⛔ 不重写 Seal 制品 / ⛔ 不扩 schema）
SCOPE       · 对象：GEN1_EVIDENCE_CONTRACT_V6.md + c1_capture.py + c1_gate_redproof.py（三对象）
            · 层：DOCUMENT_LAYER / TOOLCHAIN_LAYER（⛔ 非生产制品层）
            · ⛔ 不含：生产代码 / 生产配置 / 制品 / 部署 / DB / Authority / lock / immutable_set
CHANGE RULE · 三对象任一字节变化 ⇒ Seal 立即 MISMATCH（fail-closed）
            · 升版 / 回退 / 改 schema ⇒ 必须走**新裁定**（新 Binding Decision）+ 重新执行 S1→S2→S3
            · ⛔ 不得运行时改写；⛔ 不得由本 Seal 反向修改 Key 2 任何字节
VERSION NS  gen1-evidence-contract（⛔ 与 gen1-guarded-effective-charter 互不相交）
```

---

## 8. ⛔ 本裁定**不**授权的事（逐项显式）

| # | 动作 | 状态 |
|---|---|---|
| 1 | 修改 `GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.1 | ⛔ **未授权 / 未执行**（`O-3 = REJECTED`） |
| 2 | 修改 `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` | ⛔ **未授权 / 未执行**（`change_rule` 要求显式审批） |
| 3 | 修改 `docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md` | ⛔ **未授权 / 未执行**（须走新裁定） |
| 4 | 改 `FROZEN_PARAM_KEYS` / lock / `immutable_set` / 生产 Authority / 生产读链 | ⛔ **未授权** |
| 5 | Evidence Execution / 启动样本累计 / 创建 C-1 自动化 | ⛔ **未授权**（契约 §12 第 5 项未闭合） |
| 6 | **Key 3 `Evidence Seal`**（= `EVIDENCE_POSITIVE`） | ⛔ **NOT AUTHORIZED**（`independent_events = 0` < 30） |
| 7 | V3.6.6 Freeze / V3.6.6 Production Attestation | ⛔ **未授权** |
| 8 | GE-04 Ready / GE-04 Authorization / GEN1 Decision Chain | ⛔ **未授权** |
| 9 | merge / master integration / deploy / rollback / canary / `auto_execution` / 生产 DB 写入 | ⛔ **未授权** |
| 10 | 建 V3.6.6 tag（或任何 tag） | ⛔ **未授权** |
| 11 | 改 `.gitattributes` / 仓库级 Git 换行配置（`core.autocrlf`） | ⛔ **未授权 / 未执行**（归一由 §6.5 的 fingerprint 口径实现，⛔ 不通过仓库配置） |

**生产侧零效应自证**：

```text
Production code changed = NO
Production DB writes    = 0
Deploy                  = NO
Merge                   = NO
Canary                  = OFF
Auto-execution          = OFF
GE-04                   = NOT AUTHORIZED
Key 2 seal artifact     = UNCHANGED（sha256 35040e5e…09e5，881 B）
```

---

## 9. 复算方法（任何人可独立复现，⛔ 不依赖本裁定）

```bash
# ① Key 2 制品指纹（应恒为 35040e5e…09e5；绑定字段恒为 4 个）
sha256sum ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json
python -c "import json;d=json.load(open('ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json',encoding='utf-8'));\
print([k for k in d if k.endswith('_sha256') or k in ('contract_version','threshold_version')])"
#   → ['contract_version','model_sha256','source_sha256','threshold_version']

# ② source_sha256（C1）重算 —— 与 §6.2 的裁定值逐位比对
python - <<'PY'
import glob, hashlib, os
G="."; lf=lambda p: open(p,"rb").read().replace(b"\r\n",b"\n"); h=hashlib.sha256()
fs=sorted(glob.glob(os.path.join(G,"src/common/utils/gen1-*.js")))
for p in fs:
    h.update(os.path.relpath(p,G).replace("\\","/").encode()); h.update(b"\x00")
    h.update(hashlib.sha256(lf(p)).hexdigest().encode()); h.update(b"\n")
print(len(fs), h.hexdigest())
PY
#   → 17 4fadfe1a6b93c0896c8f50984f0b13b2f14c8798ba0bc9a6fda7f9f026119e82

# ③ 本 Seal 的 namespace 验收（⛔ 不得出现裸 contract_version）
python -c "import json;d=json.load(open('docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json',encoding='utf-8'));\
print('contract_version' in d, 'evidence_contract_version' in d, d['evidence_contract_version'])"
#   → False True v6.0

# ④ ★ evidence fingerprint canonicalization = sha256lf（§6.5）—— 三绑定对象逐项复算
python - <<'PY'
import hashlib
lf = lambda p: hashlib.sha256(
    open(p, "rb").read().replace(b"\r\n", b"\n").replace(b"\r", b"\n")).hexdigest()
for p in ("docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md",
          "scripts/gen1/evidence-capture/c1_capture.py",
          "scripts/gen1/evidence-capture/c1_gate_redproof.py"):
    print(lf(p), p)
PY
#   → 7e3e5d87…272e / d0acc9e4…a4337 / e795c934…aba0（须与 Seal 绑定值逐位相同）
python scripts/gen1/evidence-capture/v6_fingerprint_canonicalization_check.py
#   → 16 PASS / 0 FAIL
```

---

## 10. ★ owner §三 八项必备陈述 —— 逐条定位（⛔ 不得遗漏自证）

| # | owner §三 要求的陈述 | 本文档位置 |
|---|---|---|
| 1 | V6 Evidence Freeze Seal 是**新的独立 Evidence 层治理对象** | §0 行 D · §2 归属映射 · §5 制品形态 |
| 2 | **Key 2 保持 immutable** | §0 行 B · §2 约束方向 · §8 第 1–3 项 |
| 3 | `charter_version` 与 `evidence_contract_version` 属**两个不同 namespace** | §3 · **§3.1 三套命名互指** |
| 4 | 本 Seal 绑定 **V6.0 Evidence Contract**，而**不是** Charter | §2 下行映射 · §6.1 #1/#2 |
| 5 | Capture / Red-proof 两工具属本 V6 **evidence-generation toolchain** | §2 · §6.1 #6/#7 · §6.3 `tool_alignment` · §6.4 #7 |
| 6 | 后续 Evidence Seal（≥30 独立事件）与本 Freeze Seal 是**两个不同生命周期对象** | §0 行 C · §6.3 `evidence_seal_key3` · §4 lifecycle |
| 7 | 本 Seal **不赋予 GE-04 权限**，也**不等于** GE-04 | §8 第 8 项 · §6.3 `production_effects.ge_04` |
| 8 | **不代表**生产部署 / Canary / Decision Chain 生效 | §8 第 9 项 · §6.3 `production_effects` |

> ⛔ 上表为**定位索引**，⛔ 不改变任何条款的实质；⛔ 不得据本表外推任何授权。

---

**页脚**
本文件为**治理裁定记录**（`O-1 = APPROVED` 的授权载体）。
修改须走**新裁定**，⛔ 不得原地改；⛔ 不得据本文件修改 Key 2 / 生产 Seal 制品 / 任何生产侧对象。
⛔ 本文件**不记录自身执行状态**、⛔ **不写入自身 sha256**（自指悖论）——其指纹于**交付清单外**单列。
