# Gen-1 Evidence Contract v6.0 — 冻结与封存记录（FREEZE & SEAL RECORD）

**文档编号**：`WP-G1-EVIDENCE-CH-6.0-FSR`
**性质**：**冻结 / 封存记录（Freeze & Seal Record）** —— 对 `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md`
的**冻结行为**、`c1_capture.py` / `c1_gate_redproof.py` 的**V6 语义迁移**、以及**独立治理对象**
`V6.0 Evidence Freeze Seal` 的**封存行为**做**可复核、可独立重算**的留痕。
**闸门**：**V6.0 FREEZE + B3 同批次工具迁移（原子治理批次）** —— owner 2026-10-02 单独授权，含 **`O-1 = APPROVED`**
**as-of**：2026-10-02（北京时间）
**输出模式**：**OUTPUT-ONLY / NO PRODUCTION EFFECT** —— 本记录不改变任何生产行为。

---

## 0. ★ 同名辨析（**must-read，⛔ 不得混用**）

| # | 名称 | 对象 | 判据 | 本记录的关系 |
|---|---|---|---|---|
| A | **本记录所称「冻结」** | **本契约的载体文件** `GEN1_EVIDENCE_CONTRACT_V6.md`（文档层） | 状态翻 `FROZEN` + 锚定 carrier commit / blob / sha256 | ✅ **即本记录 §1** |
| B | **Key 2 Freeze Seal**（Charter §3.1） | **生产制品** `GUARDED_EFFECTIVE_FREEZE` | 制品 `status == APPROVED` 且四绑定项与运行期实读逐项一致 | ⛔ **完全不同的对象**；本记录⛔ **未触碰**（§8） |
| C | **Key 3 Evidence Seal** | **统计证据资格** | == `EVIDENCE_POSITIVE`（契约 §4.2）⇒ 须 ≥30 独立事件 | ⛔ **完全不同**；今日 `independent_events = 0` |
| **D** | **`V6.0 Evidence Freeze Seal`** | **契约 + 采集工具 + red-proof 工具** | 三对象 SHA 逐项绑定 + Tool Alignment `PASS` + lifecycle == `SEALED` | ✅ **即本记录 §7**（owner `O-1 = APPROVED` 新立的独立治理对象） |

```text
CONTRACT FROZEN（A） ≠ Key 2（B） ≠ Evidence Seal（C） ≠ V6.0 Evidence Freeze Seal（D）
本记录            ≠ 生产授权    ≠ 部署许可
```

> ⛔ **本记录⛔ 不主张任何生产侧状态变更**；`gen1_authority` 保持 `CANARY`，
> `ml_effective = false`，`gen1_production_write = false`，`gen1_auto_execution = false`。

---

## 1. 冻结对象（精确定义）

| 项 | 值 |
|---|---|
| **冻结对象** | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md`（Gen-1 Evidence Contract **v6.0**） |
| 文档编号 | `WP-G1-EVIDENCE-CH-6.0` |
| 冻结态 | `🔒 FROZEN（2026-10-02）` |
| 冻结字节数 | **97203 B**（LF，`CRLF = 0`） |
| 冻结行数 | **1413** |
| **carrier commit（冻结提交）** | `ccb0f4b8cf402a16b16d468cbff1c02109d72476` |
| **parent commit** | `7d2f39bddd681cce9d714558d518b06631451d01`（= v5.0 封存记录提交，**线性**） |
| **git blob id（sha1）** | `294259338ba3fa60f689ed9139072a35b2368b0e` |
| **content sha256（LF）** | `7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e` |
| 载体分支 | `docs/gen1-evidence-contract-v5-20261002`（local == origin） |
| 载体 PR | **#66**（open；base `master @ e015aaaf2860c808180e5bd1fbfc24d4fdef3303`） |
| 冻结日期 | 2026-10-02（北京时间） |
| 冻结轮**唯一来源** | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md`（`e93420a3…bef4b1` / 92306 B / 1377 行） |

⚠️ **三种指纹不可混用**：`git blob id` 是 **sha1**（git 对象哈希）；`content sha256` 是**文件内容**哈希；
`carrier commit` 是**提交**哈希。⛔ 不得互相替代、⛔ 不得把其中任一称作另一项。

⚠️ **本记录⛔ 不写入自身 sha256**（自指悖论）；其指纹于载体 PR body / 交付清单外单列。

---

## 2. carrier 提交链（可逐条复核）

| # | commit | 角色 | 变更 |
|---|---|---|---|
| 0 | `42ebc11486ca108d10964b12761ac616c89d0bd3` | **G-1 载体入库** | 6 文件纯新增：v5.0 载体 + 5 份治理证据 |
| 1 | `21171edaf8eaf9650a88adb81b88f854fa54a219` | **v5.0-draft rev.1** | 冻结前置一致性收紧（§3.0.3 键数标注） |
| 2 | `05da0efa73e948921bc7b9b60c0d500cc98e3e9b` | **v5.0 冻结提交** | 状态翻为 FROZEN |
| 3 | `7d2f39bddd681cce9d714558d518b06631451d01` | **v5.0 封存提交 + 工具 v5.0 迁移** | v5.0 封存记录 + `scripts/gen1/evidence-capture/`（§11 规则 5 同批次） |
| 4 | **`ccb0f4b8cf402a16b16d468cbff1c02109d72476`** | **★ v6.0 冻结提交（本批次第 1 提交）** | 1 file changed / **1413 insertions** / `create mode 100644 docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md` |
| 5 | *（本记录所在提交，本批次第 2 提交）* | **V6.0 封存 + B3 工具迁移** | 两工具 v6.0 迁移 + 本记录 + Binding Decision + Seal 制品 + Alignment Report + Evidence Bundle + 自证构件（同批次） |

- 全部提交的 parent 链**线性**，均自 `origin/master`（`e015aaaf…`）开出。
- ⛔ `origin/master` 的 blob 未因本批次改变（**纯新增分支**，⛔ 不含 `M`/`D` 于 master 侧）。
- ⛔ **本批次未** push（载体分支 local == origin 维持于提交 3 的状态；提交 4 / 5 的推送为**独立闸门**）。

---

## 3. 冻结内容范围（冻结轮**只**改了什么）

对照 **v2.0 / v5.0 冻结惯例**（「冻结轮**只**改状态头 / §1.1 / §12 相关项 / §13 / 变更日志 / 页脚」），
本冻结轮改动如下（**逐项可复核**）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | 状态头（H-1…H-6） | `版本` 行翻 `🔒 FROZEN（2026-10-02）`；`状态` 行翻 FROZEN + 四名辨析；新增 `V6.0 Evidence Freeze Seal 已落盘`；`冻结授权` 段写明 owner 单独授权 + `O-1 = APPROVED`；`B3 状态` 段翻 `MIGRATED` |
| 2 | 状态块（S） | `V6.0 CONTRACT FREEZE = 🔒 FROZEN`；`V6.0 CARRIER SEAL RECORD = 📌 SEALED`；`EVIDENCE TOOLCHAIN MIGRATION = ✅ MIGRATED`；`EVIDENCE TOOL ALIGNMENT = ✅ PASS`；`V6.0 Evidence Freeze Seal = 🔒 SEALED`；`V3.6.6 FREEZE = ⛔ NOT AUTHORIZED` |
| 3 | 引用块（Q） | 冻结生效段落 |
| 4 | §1.1 末行 | 表行标注已冻结 |
| 5 | §11 规则 5 状态行 | `⛔ 不得迁移` → `✅ 本批次状态：B3 = MIGRATED` |
| 6 | §11 变更日志 | 新增 **`v6.0 FROZEN`** 行（冻结轮改动范围 + 同批次工具迁移 + 新立独立 Seal） |
| 7 | §12 第 **1·2·8·9·12** 项 | 第 1 项 → ✅ 已执行（FROZEN）；第 2 项 → ✅ 已执行（载体路径）；第 8 项 → ✅ 已裁定（是）；第 9 项 → `CONTRACT READY`；第 12 项 → ✅ 已执行（两工具迁移 + 反向证明） |
| 8 | §13 | 生成轮边界区块**逐字保留**；新增「v6.0 冻结轮」边界区块（含 §0–§11 规范性正文逐字节未变声明） |
| 9 | §13.2 | 标题去「⛔ 未 commit」；构件表补入 Seal 三件 + 两份报告 + 冻结载体断言套件 |
| 10 | 页脚 | 落点行翻 FROZEN；补冻结轮授权与随行构件指引 |

**⛔ 冻结轮未改**：字段名 / 字段定义（17 列）/ 纳入与排除规则 / 判定阈值（Q1/Q2/Q3）/ selector /
checkpoint **语义** / 八源清单 / `CLUSTER_GAP_DAYS`（§3.4）。

> ⚠️ **冻结轮**改动的 §13.2 标题一项，原为 `### 13.2 v6.0 Freeze Preparation 的随行构件（⛔ 未 commit）`。
> 该标题**记录了自身执行状态**（「未 commit」在冻结批次实际 commit 后即成**事实错误**）
> ⇒ 改为 `### 13.2 v6.0 Freeze / Seal 批次的随行构件`。此属**修文档**，⛔ 不属放宽断言。

> ⚠️ **措辞作用域声明**：本记录 §3 / §4 中出现的「未 commit」「尚未 commit / push / PR」等字样，
> **皆为**① **被修正的载体 §13.2 旧标题的原文引录**，或 ② **断言脚本 `F-4b` 的禁语集名称**；
> ⛔ **不是**本记录对**自身**执行状态的陈述 ——
> 本记录⛔ **不记录自身 commit / push / PR 状态**（该信息于记录落笔时即会过期，属自指矛盾）。

---

## 4. ★ 冻结轮**规范性不变性**证明（25 PASS / 0 FAIL）

脚本：`scripts/gen1/evidence-capture/v6_frozen_carrier_assertions.py`

```text
N-1 §0–§10 共 11 个顶层章节 body 逐字节未变                       ✅
N-2 除 `### 1.1 ` / `### 13.2 ` 外，全部 37 个子节 body 逐字节未变   ✅
N-3 §11 规则 1–4 + 规则 5 规范首句未变                            ✅
N-4 §12 行数守恒 15 → 15；未变项恰为 [3,4,5,6,7,10,11,13,14,15]    ✅
N-5 §13.1 表未变 + 生成轮边界区块逐字保留                          ✅
N-6 §3 字段表 == V5 / CLUSTER_GAP_DAYS / selector / §5.8 字面量齐备 ✅
N-7 改动行未越界（38 行；逐行 + 归一化双口径）+ 反向断言            ✅
N-8 归一化对拍（CRLF 归一）一致                                   ✅
F-1 14 条冻结态标记齐备                                          ✅
F-2 候选态专属禁语 7 条零命中（全文）                              ✅
F-2a 生成轮边界区块保留且显式自标「生成轮」                          ✅
F-2b 生成轮专属 token **只**出现在生成轮区块内（⛔ 不外溢）           ✅
F-3 状态权威区（状态头 / §1.1 / §12）零候选态与「未授权」措辞         ✅
F-4a 冻结载体**不写入自身 sha256**（自指悖论）                       ✅
F-4b 冻结载体**不记录自身执行状态**（无「尚未 commit / push / PR」）   ✅
F-5a V5 冻结载体 sha256 未变（4fb9463f…f55b）                      ✅
F-5b 候选基线 sha256 未变（e93420a3…bef4b1，冻结轮零字节改动）        ✅
F-5c 冻结载体为纯 LF                                             ✅
F-6 四名辨析齐备（本契约载体 / Key 2 / Key 3 / V6.0 Evidence Freeze Seal） ✅
────────────────────────────────────────────
合计 25 项 ⇒ ✅ ALL PASS
```

**★ 与 V5 冻结先例的逐条对齐**：

| 先例（v5.0 冻结） | 本批次（v6.0 冻结） | 一致 |
|---|---|---|
| 冻结提交 + 工具/封存提交 = **两提交同批** | 提交 4（冻结）+ 提交 5（工具/封存/Seal） | ✅ |
| 生成轮边界区块**逐字保留**（V5 载体第 1032–1040 行仍含「⛔ 生成轮未冻结」） | §13 生成轮区块**逐字保留**（`N-5`） | ✅ |
| 状态头翻 FROZEN；⛔ 不写自指 sha256 / commit / push / PR | 状态头翻 FROZEN；`F-4a` / `F-4b` 双断言 | ✅ |
| 冻结轮改动面收敛于**声明区段** | 38 行全落声明区段（`N-7` 双口径） | ✅ |

---

## 5. `B3` —— 两工具的 V6 语义迁移（**与冻结同批次**）

**依据**：契约 **§11 元规则 规则 5**（*「工具语义迁移与契约冻结**同批次**」*）+ §12 第 12 项。

```text
⛔ 规则 5 的禁止对象 = 「把工具迁到**未冻结**契约」（会制造「已按未冻结契约采样」的预登记违规）。
✅ 本批次：契约冻结（提交 4）与两工具迁移（提交 5）在**同一原子批次**内完成
   ⇒ ⛔ 不存在预登记违规窗口。
⚠️ 前序批次曾因 SCHEMA GAP 将**整批** HALT（见 SCHEMA GAP REPORT）；O-1 解除后**重启整批**，
   ⛔ 未出现「冻结已生效而工具未迁移」的中间态。
```

| 文件 | v5.0 sha256 | v6.0 sha256 | 字节 | 行 | 关键变更 |
|---|---|---|---|---|---|
| `c1_capture.py` | `dd2ea8b0…c8c42` | **`d0acc9e4…a4337`** | 26369 → **31143** | 546 → **629** | `CHECKPOINT_WINDOWS`（W1 ∪ W2）+ `evaluate_checkpoint_v6`（返回 `window_id`）+ `first_window_wins_checkpoint` + `CHAIN_WINDOWS`（W1-2200 / W2-0800 逐链尝试）+ bundle `checkpoint_window_id` + 冻结绑定常量（路径 / v6.0 / carrier commit / blob / sha256） |
| `c1_gate_redproof.py` | `0cca693c…bc20` | **`e795c934…aba0`** | 9362 → **14904** | 204 → **311** | §[6] 期望由「09:00 ⇒ `False`（单窗口）」改为「09:00 ⇒ `True/W2`」；新增 §[6b] first-window-wins / §[6c] same-bundle 非独立 / §[6d] **反向证明**（恢复旧单窗口规则 ⇒ 必 FAIL） |

**打红自证（迁移后实测）**：

```text
python scripts/gen1/evidence-capture/c1_gate_redproof.py
→ 打红自证结果：✅ ALL PASS（57 项变异/边界/结构自证全部符合预期）
   （v5.0 为 31 项；v6.0 新增 §[6b] 3 项 / §[6c] 3 项 / §[6d] 2 项等）
   §[8] 契约绑定常量自证实读：contract_version=v6.0 / carrier_commit=ccb0f4b8… /
        git_blob_sha1=29425933… / content_sha256=7e3e5d87… / SRC_ALL 八源
```

**迁移设计留痕 + 施加后校验**（`c1_capture_v6_migration_test.py`）：

```text
33 PASS / 0 FAIL（默认只读调用；--emit-diff 变体 = 34 PASS，多 1 项「diff 文件已落盘」）
[1] 设计结构（6 项）· [2] 设计产出 ast.parse · [3] ★ 反向证明 v5.0 在 W2（08:45）判 False
[4] 施加后校验（磁盘已是 v6.0；旧单窗口表达式**零命中**）
[5a] 6 函数 + 关键字面量 设计 ⇄ 实文件**逐字节相同**（9 项）
[5b] 反向重建：4 条对齐登记全部命中
[5c] 文本差异恰为 3 删 / 4 增，全部落在 docstring / 注释（含 docstring 置空后文本逐字节相同 + 打红自证）
[5d] ★ 对齐前 ⇄ 实文件 AST（剥离 docstring）逐字节相同 ⇒ 零规范语义改动（含变异打红自证）
[6] APPLIED diff = 13 hunks / 14732 B
```

> ⚠️ **如实声明（设计要求 ⇄ 正式版文本差异）**：`transform_v5_to_v6()` 写于**迁移方案期**（`B3` 未授权），
> 正式施加后 v6.0 正式版 docstring **多写了 §3.4A 排除注记**、并收紧了 §5.8 子规则引用
> ⇒ 二者相差 **3 删 / 4 增，全部落在 docstring / 注释**。处置 = **对齐设计模板到正式版**并**逐行登记**（`RECONCILE`），
> 以 `[5c]` / `[5d]` 证明**零规范语义改动**。⛔ **未**通过放宽断言使测试通过。

**`c1_capture.py.v6.diff`（15312 B）**：由测试 `--emit-diff` 重写为 **APPLIED** 形态，
header 记明「施加批次」+「契约 §11 规则 5：同批次 ⇒ ⛔ 不存在预登记违规窗口」+ 双端 sha256 / 字节 / 行数。

---

## 6. Tool Alignment —— 契约 ↕ 采集工具 ↕ red-proof 工具

脚本：`scripts/gen1/evidence-capture/v6_contract_tool_alignment.py` → **29 PASS / 0 FAIL**

| 层 | 断言对象 | 项数 |
|---|---|---|
| L1 | `Contract §5.6` ↔ `trigger_registry.js` / fixtures（registry 以夹具为**唯一**数据源，⛔ 不内嵌副本） | 6 |
| L2 | `Contract §5.8` ↔ `checkpoint_discriminator.js`（W1/W2 + first-window-wins + 夹具字面量一致） | 4 |
| L3 | `Contract §5.8` ↔ `c1_capture.py`（契约路径/版本/**content sha256 对拍**/无 PENDING/双窗口/旧表达式零命中/非独立判据声明/双链窗口） | 10 |
| L4 | `c1_capture.py` ↔ `c1_gate_redproof.py`（调用两函数/边界期望/**旧单窗口恢复必 FAIL** 反向证明） | 6 |
| L5 | `Contract §5.8` ↔ `c1_gate_redproof.py` 期望一致性（09:00 ⇒ `True/W2`，⛔ 非 `False`） | 3 |

### 6.1 ★★ 版本错配**反向证明**（owner §七 强制要求）

```text
RP-A  V6 Contract + V5 capture  + V6 redproof   ⇒ ALIGNMENT = FAIL   ✅（实测 FAIL，符合期望）
RP-B  V6 Contract + V6 capture  + V5 redproof   ⇒ ALIGNMENT = FAIL   ✅（实测 FAIL，符合期望）
RP-C  V6 Contract + V6 capture  + V6 redproof   ⇒ ALIGNMENT = PASS   ✅（实测 PASS，符合期望）
```

**构造方式（可复算）**：`git show 7d2f39bd…:<path>` 抽取 v5.0 **冻结字节**落于
`scripts/gen1/evidence-capture/out/v5-baseline/`（`c1_capture.v5.py` = 26369 B / `c1_gate_redproof.v5.py` = 9362 B），
断言 `sha256(v5cap) == dd2ea8b0…`，再以 `run(capture_path, redproof_path)` 逐组合跑对齐校验。

**结论**：`evidence_contract_sha256` / `capture_tool_sha256` / `redproof_tool_sha256`
三者**具约束力** —— 任一版本错配即被判 `FAIL`。⛔ 它们**不是**「记录用字段」。

---

## 7. `V6.0 Evidence Freeze Seal`（★ 本批次新立的**独立**治理对象）

| 项 | 值 |
|---|---|
| 裁定载体 | `docs/gen1/GEN1_EVIDENCE_V6_FREEZE_SEAL_BINDING_DECISION.md`（`O-1 = APPROVED`） |
| 机器可读制品 | `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json` |
| `seal_id` / `seal_kind` | `EVIDENCE_FREEZE_SEAL_V6` / `EVIDENCE_FREEZE_SEAL` |
| `seal_layer` | `DOCUMENT_LAYER`（文档层 / 工具链层；⛔ 非生产制品层） |
| `version_namespace` | `gen1-evidence-contract`（⛔ 与 Key 2 的 `gen1-guarded-effective-charter` **互不相交**） |
| `seal_status` | **`EVIDENCE_FREEZE_SEALED`** |
| lifecycle | `V6.0_EVIDENCE_FREEZE_CANDIDATE → TOOL_ALIGNMENT_PASS → EVIDENCE_FREEZE_SEAL_READY → EVIDENCE_FREEZE_SEALED`（单调、⛔ 不跳级；**已全部达成**） |

### 7.1 七项绑定（owner §四，**逐项在场**）

| # | 键 | 值 / 路由 |
|---|---|---|
| 1 | `evidence_contract_version` | `v6.0`（`DIRECT`） |
| 2 | `evidence_contract_sha256` | `7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e`（`DIRECT`） |
| 3 | `source_sha256` | `4fadfe1a…9e82`（**`REFERENCE_TO_KEY2_SEAL`**；⛔ 非独立主张） |
| 4 | `model_sha256` | `d5e667c6…e712`（**`REFERENCE_TO_KEY2_SEAL`**；⛔ 非独立主张） |
| 5 | `threshold_version` | `shadow-threshold-v1`（**`REFERENCE_TO_KEY2_SEAL`**；⛔ 非独立主张） |
| 6 | `capture_tool_sha256` | `d0acc9e427f6ce52de903abd40ef41c76e87f7e5ba3441dea92f6a3d013a4337`（`DIRECT`） |
| 7 | `redproof_tool_sha256` | `e795c93445802249e8c33a29e9b01120833079fd7b38d9a660ea22ed590caba0`（`DIRECT`） |

### 7.2 第 3–5 项为何用 `reference_to_key2_seal`（**依据既有治理文档，⛔ 非「为简化」**）

1. `GEN1_FREEZE_SEAL_BINDING_DECISION.md` §4 **R1–R4**：`source_sha256` **只在 GE-04 晋升时重算并重新冻结**
   ⇒ 重算权与时点归 **GE-04 / Key 2 lifecycle**；
2. `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` 的 `change_rule` 要求「升级/回退只能通过 PR 显式修改本文件」
   ⇒ 三项的值由该制品**独占承载与版本化**；另设副本 = **第二权威**；
3. `SCHEMA GAP REPORT` §4.4 已记录一次 **`contract_version` 同名不同义**事故
   ⇒ 同一治理层⛔ 不得再为三项制造第二个承载位；
4. 三项在 Key 2 制品中当前实值**均为 `null`**、`bindings_status = INCOMPLETE`、`status = PENDING`
   ⇒ 本 Seal **无法**合法声称其「已绑定并已核验」⇒ 只能**引用 + 标注未闭合**。

⛔ **未删除任何字段**：三项仍作为**独立键**存在，其引用属性由制品 `binding_routes` 逐键声明。

### 7.3 ★ 本批次只读复核（`source_sha256` 重算）

```text
C1 = src/common/utils/gen1-*.js，共 17 文件
重算（2026-10-02）= 4fadfe1a6b93c0896c8f50984f0b13b2f14c8798ba0bc9a6fda7f9f026119e82
2026-09-22 裁定值  = 4fadfe1a6b93c0896c8f50984f0b13b2f14c8798ba0bc9a6fda7f9f026119e82
⇒ 逐位相同（C1 集合自裁定以来未变）
```

⚠️ 该复核**只证明「取值可复算」**，⛔ **不主张** Key 2 绑定已成立（制品仍 `PENDING / INCOMPLETE`）。

### 7.4 `V6.0 Evidence Freeze Seal` **≠** `Evidence Seal`（Key 3）

```text
V6.0 Evidence Freeze Seal = EVIDENCE_FREEZE_SEALED      ← 对象 = 契约 + 两工具
Evidence Seal (Key 3)     = NOT AUTHORIZED              ← 对象 = 统计证据资格
independent_events        = 0（门槛 30）
```

⛔ 二者**无蕴含关系**；⛔ **不得**因本 Seal 成立而推断 Evidence Seal 成立；
⛔ **不得**提前创建或伪造 `EVIDENCE_POSITIVE` 制品。

---

## 8. Key 2 **未被触碰**（`unchanged = YES`，实测）

| 项 | as-of 2026-10-02 实测 | 前值（SCHEMA GAP REPORT） | 判定 |
|---|---|---|---|
| `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` sha256 | `35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5`（881 B） | `35040e5e…09e5` | ✅ **未变** |
| 绑定字段集 | `contract_version` / `source_sha256` / `model_sha256` / `threshold_version`（**4 个**） | 同 | ✅ **未变** |
| `contract_version` | `WP-G1-GE-CH-1.0` | 同 | ✅ **未变**（⛔ 未被写入 `V6.0`） |
| `status` / `bindings_status` | `PENDING` / `INCOMPLETE` | 同 | ✅ **未变** |
| `docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.1 | 四项逐字枚举（⛔ 无 tool fingerprint 位） | 同 | ✅ **未变** |
| `docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md` | `2980a08f6f49a19ff8022f7bfeb2b6a7637a066a53b33260f28c43dfb0d2e07d`（5751 B） | — | ✅ **未变 / 未改** |

```text
O-1 = APPROVED  ⇒  Key 2 schema 未扩表、Key 2 制品未改、生产 Authority / FROZEN_PARAM_KEYS / lock / immutable_set 未改
O-3 = REJECTED  ⇒  ⛔ 未扩 Key 2 schema
```

---

## 9. 全量回归（本批次实测，逐脚本）

| # | 脚本 | 结果 |
|---|---|---|
| 1 | `v6_frozen_carrier_assertions.py` | ✅ 25 PASS / 0 FAIL |
| 2 | `v6_content_assertions.py`（**候选件**本体） | ✅ 39 PASS / 0 FAIL |
| 3 | `v6_contract_compatibility.py`（**候选件**：A 16 / B 12 / C 13 / D 5） | ✅ 46 PASS / 0 FAIL |
| 4 | `v6_redproof.py`（**候选件**：15 变异 15/15 检出 + 15/15 逐字节还原） | ✅ 20 PASS / 0 FAIL |
| 5 | `r3_contract_consumption_test.py` | ✅ 12 PASS / 0 FAIL |
| 6 | `checkpoint_python_js_parity.py` | ✅ 6 PASS / 0 FAIL |
| 7 | `c1_gate_redproof.py`（**迁移后**门打红） | ✅ **57 项 ALL PASS** |
| 8 | `c1_capture_v6_migration_test.py`（设计留痕 + 施加后校验） | ✅ 33 PASS / 0 FAIL（默认只读）/ 34（`--emit-diff`）|
| 9 | `v6_contract_tool_alignment.py`（L1–L5） | ✅ 29 PASS / 0 FAIL |
| 10 | `v6_contract_tool_alignment.py --reverse-proofs`（RP-A/B/C） | ✅ 3/3 符合期望 |

> ⚠️ **计数口径勘误（第 8 行，2026-10-02 复核）**：初记 `34 PASS` 对应 **`--emit-diff`** 调用（比默认多 1 项「diff 文件已落盘」，且会重写 tracked 的 `c1_capture.py.v6.diff`）；**默认只读调用 = 33 PASS / 0 FAIL**。两者均 0 FAIL，结论不变。

**基线零漂移复核**：

```text
docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md          4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b  ✅ 未变
docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md
                                                e93420a38a4b92c7c5eb577c4cf5af81e6d913dc22df361a1e981978efbef4b1  ✅ 未变
ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json 35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5  ✅ 未变
docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md  2980a08f6f49a19ff8022f7bfeb2b6a7637a066a53b33260f28c43dfb0d2e07d  ✅ 未变
```

### 9.1 ★ B2 Seal Gate（owner §七 十项判定，逐项实测）

| # | Gate 项 | 判定 | 判据载体（⛔ 全部脚本实读） |
|---|---|---|---|
| 1 | V6 Contract integrity | ✅ PASS | `v6_seal_binding_selfcheck.py` S-4 / S-5 / S-7（content **`sha256lf`** · bytes · lines · EOL · blob 侧对拍） |
| 2 | Freeze carrier integrity | ✅ PASS | 同上 S-6 / S-7 / S-8（carrier commit · blob id · parent commit 均 `git` 实读） |
| 3 | Tool alignment | ✅ PASS | `v6_contract_tool_alignment.py` 29 PASS / 0 FAIL（L1–L5） |
| 4 | Migration tests | ✅ PASS | `c1_capture_v6_migration_test.py` **33/0（默认只读）· 34/0（`--emit-diff`）**——owner 记法 `34/0` 对应后者（口径见 §9 勘误） |
| 5 | Version mismatch red-proof | ✅ PASS | RP-A FAIL（期望）· RP-B FAIL（期望）· RP-C PASS |
| 6 | Key 2 immutability | ✅ PASS | `v6_key2_immutability_check.py` **13 PASS / 0 FAIL**（git 历史 before == after + blob 三方一致 + Charter §3.1 ⛔ `v6` 零命中） |
| 7 | Binding decision | ✅ PASS | `GEN1_EVIDENCE_V6_FREEZE_SEAL_BINDING_DECISION.md`（§3.1 三套命名互指 · §6.4 载体身份字段 · **§6.5 canonicalization = `sha256lf` + §6.5.1 `git_blob_sha1` ≠ `evidence_sha256`** · §10 owner §三 八条款对照） |
| 8 | Fingerprint recomputation | ✅ PASS | 见 §9.2 与 §10（⛔ 零手填，全部由脚本读真实文件 / git 对象推导）；**口径 = `sha256lf`**（owner 裁定 A / §6.5），三对象逐项复算 == Seal 绑定值 |
| 9 | Negative scan | ✅ PASS | `v6_negative_scan.py` **13 PASS / 0 FAIL**（改动面白名单 · 生产路径零命中 · 上游治理层零改动 · 无 tag · 治理声明在场） |
| 10 | Production safety | ✅ PASS | 改动面 ⛔ 零生产路径；Seal `production_effects` 18 键全 false / OFF / NOT AUTHORIZED（自证 S-16）；⛔ 未执行任何 deploy / rollback / DB 写 |

### 9.2 ★ B2 新增的 executable self-check（4 件，独立于既有回归套件）

> 口径提示（owner 2026-10-02 裁定 A）：第 11 / 14 两件一律以 **`sha256lf`** 取值（⛔ 不用裸字节 sha256）。
> 对当前三绑定对象（实测**纯 LF**）两者同值 ⇒ 对既有判定**无任何改变**（⛔ 非放宽 / ⛔ 非收紧），
> 但使判定在工作区被重新 checkout 成 CRLF 时**仍然成立**（口径耐久性）。

| # | 脚本 | 结果 | 覆盖 |
|---|---|---|---|
| 11 | `v6_seal_binding_selfcheck.py` | ✅ **20 PASS / 0 FAIL** | 把 Seal 制品的**每一个绑定值**从真实文件 / git 对象重算（口径 = **`sha256lf`**）：身份与层 · ⛔ 裸 `contract_version` 负向断言 · 契约 content/blobs/bytes/lines/EOL（LF 规范口径） · carrier/parent/blob · 两工具 sha/bytes/lines · lifecycle 单调 · routes 4 DIRECT + 3 REFERENCE · Key 2 引用读数 · Key 3 `NOT_AUTHORIZED` · `production_effects` 18 键 · **S-17 别名一致性** · S-18 自指禁令 · **S-20 canonicalization 权威载体在场且 ⛔ 制品未扩 schema** |
| 12 | `v6_key2_immutability_check.py` | ✅ **13 PASS / 0 FAIL** | `KEY_2_IMMUTABLE = PASS`：批次区间 `git diff` 逐字节空 · 自最后改动提交 `b6da0a3` 起亦空 · blob id 三方一致 `46142607…2dfa` · 四绑定键恰等 · `contract_version = WP-G1-GE-CH-1.0` 且 ⛔ 全文 `v6` 零命中 · Charter §3.1 / 上游裁定零改动 |
| 13 | `v6_negative_scan.py` | ✅ **13 PASS / 0 FAIL** | owner §六 全项（改动面白名单 · 生产前缀零命中 · `ml/**` 零改动 · lock/FROZEN 类零命中 · 脏改动不越界 · 无 tag · 治理声明三处齐备 · 工具链无部署 / 变更类子命令 · ⛔ 无越界肯定式声明 · 未推送） |
| 14 | `v6_fingerprint_canonicalization_check.py` | ✅ **16 PASS / 0 FAIL** | ★ owner 裁定 A：**`sha256lf` canonicalization** —— F-1…F-4 定义性自证（LF 无操作 · CRLF / 裸 CR 等价 · ⛔ 非 no-op 假象）· F-5 内容变异 ⇒ 指纹必变 · F-6 / F-7 / F-7b 三绑定对象（工作区 ⇄ git blob ⇄ 绑定值 **三向互证**）· F-8 `git_blob_sha1` ≠ `evidence_sha256` · F-9 量纲与规范化后内容一致 · F-10 ⛔ 归一仅用于 Fingerprint（工作区字节不变 · ⛔ 无 `.gitattributes` · `core.autocrlf` 未改）· F-11 ⛔ 不适用于 Key 2 · F-12 / F-13 文档宣告在场 · F-14a / F-14b 制品 ⛔ 未被重写 / ⛔ 未扩 schema |

> ⚠️ **自曝一处脚本缺陷（已修）**：`v6_negative_scan.py` 的 N-6 首版用固定切片 `l[3:]` 解析
> `git status --porcelain` 行，导致路径首字符被吃掉、**误报越界**；改为 `split(None, 1)` 后 N-6 PASS。
> ⇒ **记录在案**：该 FAIL 是**解析偏移**（断言器缺陷），⛔ 不是工作区越界。

---

## 10. 复算方法（任何人可独立复现，⛔ 不依赖本记录）

```bash
# ① 冻结载体指纹（双口径）
git -C <repo> rev-parse ccb0f4b8cf402a16b16d468cbff1c02109d72476:docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md
#   → 期望 294259338ba3fa60f689ed9139072a35b2368b0e
git -C <repo> show ccb0f4b8:docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md | sha256sum
#   → 期望 7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e
git -C <repo> show ccb0f4b8:docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md | wc -c
#   → 期望 97203（bytes）            wc -l → 1413

# ② 两工具 v6.0 指纹
sha256sum scripts/gen1/evidence-capture/c1_capture.py c1_gate_redproof.py
#   → 期望 d0acc9e427f6ce52de903abd40ef41c76e87f7e5ba3441dea92f6a3d013a4337
#           e795c93445802249e8c33a29e9b01120833079fd7b38d9a660ea22ed590caba0

# ③ 冻结轮规范性不变性 + 对齐 + 反向证明（⛔ 只读）
python scripts/gen1/evidence-capture/v6_frozen_carrier_assertions.py     # → 25 PASS / 0 FAIL
python scripts/gen1/evidence-capture/v6_contract_tool_alignment.py       # → 29 PASS / 0 FAIL
python scripts/gen1/evidence-capture/v6_contract_tool_alignment.py --reverse-proofs
#   → RP-A FAIL(期望) / RP-B FAIL(期望) / RP-C PASS
python scripts/gen1/evidence-capture/c1_capture_v6_migration_test.py     # → 33 PASS / 0 FAIL（默认只读）
python scripts/gen1/evidence-capture/c1_gate_redproof.py                 # → 57 项 ALL PASS

# ④ Seal 制品 namespace 验收（⛔ 不得出现裸 contract_version）
python -c "import json;d=json.load(open('docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json',encoding='utf-8'));\
print('contract_version' in d, d['evidence_contract_version'], d['seal_status'])"
#   → False v6.0 EVIDENCE_FREEZE_SEALED

# ⑤ ★ B2 新增四件 self-check（⛔ 只读；13 须在提交后运行 N-6 方为 0 项脏改动）
python scripts/gen1/evidence-capture/v6_seal_binding_selfcheck.py              # → 20 PASS / 0 FAIL
python scripts/gen1/evidence-capture/v6_key2_immutability_check.py             # → 13 PASS / 0 FAIL
python scripts/gen1/evidence-capture/v6_negative_scan.py                       # → 13 PASS / 0 FAIL（提交后运行）
python scripts/gen1/evidence-capture/v6_fingerprint_canonicalization_check.py  # → 16 PASS / 0 FAIL

# ⑥ ★ evidence fingerprint canonicalization = sha256lf（owner 裁定 A）—— 三绑定对象逐项复算
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
```

**★ 指纹口径（owner 2026-10-02 裁定 A：`fingerprint_canonicalization = sha256lf`）**：

| 对象 | 口径 | 实测换行 | 说明 |
|---|---|---|---|
| 证据契约 + 两工具（**本 Seal 三绑定对象**） | **`sha256lf`**（CRLF/CR → LF 后 SHA-256） | **纯 LF（CRLF = 0）** | 归一为**无操作** ⇒ `sha256lf == 原始 sha256`；并以 git blob 侧互证 |
| Key 2 制品 `GEN1_GUARDED_EFFECTIVE_FREEZE.json` | **Key 2 自身口径**（工作区文件 sha256 = `35040e5e…09e5`） | **CRLF（16 对 / 881 B）** | ⛔ `sha256lf` **不适用 / 不写入** Key 2；⛔ 不得据此重算 Key 2 绑定值 |

> ✅ **耐久性已由裁定 A 收口**：原「⚠️ 耐久性提示（⛔ 未执行，须 owner 裁定）」中的**方案 ②**
> （*把绑定口径正式定为 `sha256lf`*）**已被 adopt** —— 见 Binding Decision **§6.5**。
> ⛔ 方案 ① 未采用：⛔ 未创建 / 未修改 `.gitattributes`，⛔ 未改仓库级 Git 换行配置
> （`core.autocrlf` 仍 = `true`）—— 由 `v6_fingerprint_canonicalization_check.py` **F-10** 断言。
> 因三对象本为纯 LF，`sha256lf` 与既有绑定值**逐位相同** ⇒ 依 owner 明令 **⛔ 未重写 Seal 制品**
> （`a585a33a…b62` / 10723 B，逐字节未变；由 **F-14a** 断言），⛔ 亦未向制品新增任何 schema 键（**F-14b**）。

**★ `git_blob_sha1` ≠ `evidence_sha256`（⛔ 不得互相替代；Binding Decision §6.5.1）**：

| 指纹 | 算法 | 量纲 | 作用域 |
|---|---|---|---|
| `git_blob_sha1` | Git 对象哈希（SHA-1，`blob <len>\0` 头） | 40 hex | **Git 对象身份**（寻址 / 可达性） |
| `evidence_sha256` | **`sha256lf`** | 64 hex | **Evidence Fingerprint**（内容同一性论断） |

---

## 11. ⛔ 本记录**不**授权的事（逐项显式）

| # | 动作 | 状态 |
|---|---|---|
| 1 | 合并入 `master`（或任何 master 集成） | ⛔ **未授权** —— 属**独立闸门**，须 owner 单独授权 |
| 2 | push 载体分支的提交 4 / 5 | ⛔ **未授权**（推送为独立闸门） |
| 3 | 生产代码 / 生产配置修改 | ⛔ 未授权 |
| 4 | DB 写入 | ⛔ 未授权（本批次写命令数 = 0） |
| 5 | 改 Key 2 schema / 改 Key 2 制品 / 改生产 Seal | ⛔ 未授权（`O-3 = REJECTED`） |
| 6 | 改 Authority / `FROZEN_PARAM_KEYS` / lock / `immutable_set` / 生产读链 | ⛔ 未授权 |
| 7 | deploy / rollback / `auto_execution` / canary | ⛔ 未授权 |
| 8 | V3.6.6 Freeze / V3.6.6 Production Attestation | ⛔ 未授权 |
| 9 | **Evidence Execution**（启动样本累计 / 创建 C-1 自动化任务） | ⛔ 未授权（§12 第 5 项：先手工 / 半自动跑通 ≥3 个交易日） |
| 10 | **Evidence Seal（Key 3）** | ⛔ **NOT AUTHORIZED**（`independent_events = 0` < 30） |
| 11 | GE-04 Ready / Authorization / GEN1 Decision Chain | ⛔ 未授权 |
| 12 | 建 git tag（含 V3.6.6 tag） | ⛔ 未授权 |
| 13 | 历史回填（`HISTORICAL BACKFILL`） | ⛔ **永久禁止** |

### 11.1 主分支可达性 = **PENDING**（⚠️ 必须显式陈述）

```text
冻结锚定的**对象**（git blob + content sha256）自提交 4 起**已不可变**；
两工具 v6.0 字节自提交 5 起**已不可变**。
但本契约与 Seal **当前只存在于载体分支** `docs/gen1-evidence-contract-v5-20261002`，
⛔ **尚未进入 `master`**（提交 4 / 5 亦**未推送**至 origin）。
⇒ 本冻结为 **BRANCH-SCOPED FREEZE**：
   · ✅ 冻结 / 封存事实成立（状态已翻、字节已锚定、可重算）
   · ⚠️ **主分支可达性未达成**；契约与 Seal 在主线上的**可发现性 / 传统性**待合并后方成立
   · ⛔ 合并**不在本批次授权内** ⇒ 本记录**不得**被读成「契约已完成 master 集成」
```

---

## 12. 交付清单（⛔ 不记录自身执行状态）

**本批次第 1 提交（v6.0 冻结）**：

| 文件 | 角色 |
|---|---|
| `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md` | ★ 冻结载体（`7e3e5d87…272e` / carrier `ccb0f4b8…`） |

**本批次第 2 提交（V6.0 封存 + B3 工具迁移）**：

| 文件 | 角色 |
|---|---|
| `scripts/gen1/evidence-capture/c1_capture.py` | ★ 采集工具 v6.0（`d0acc9e4…`） |
| `scripts/gen1/evidence-capture/c1_gate_redproof.py` | ★ red-proof 工具 v6.0（`e795c934…`） |
| `docs/gen1/GEN1_EVIDENCE_V6_FREEZE_SEAL_BINDING_DECISION.md` | `O-1` 裁定载体（schema / namespace / lifecycle） |
| `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json` | ★ 机器可读 Seal（7 项绑定 + `binding_routes`） |
| `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SEAL_RECORD_20261002.md` | 本记录 |
| `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_TOOL_ALIGNMENT_REPORT_20261002.md` | L1–L5 + RP-A/B/C |
| `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_EVIDENCE_BUNDLE_20261002.md` | 四级指纹链 |
| `scripts/gen1/evidence-capture/c1_capture.py.v6.diff` | APPLIED 迁移 diff（15312 B） |
| `scripts/gen1/evidence-capture/c1_capture_v6_migration_test.py` | 迁移设计留痕 + 施加后校验（33 PASS 默认只读 / 34 `--emit-diff`） |
| `scripts/gen1/evidence-capture/v6_frozen_carrier_assertions.py` | 冻结轮规范性不变性证明（25 PASS） |
| `scripts/gen1/evidence-capture/v6_contract_tool_alignment.py` | 契约 ↔ 工具对齐校验器（29 PASS + RP-A/B/C） |
| `scripts/gen1/evidence-capture/checkpoint_python_js_parity.py` | Python ↔ JS 奇偶（6 PASS） |
| `scripts/gen1/evidence-capture/v6_seal_binding_selfcheck.py` | ★ B2 新增：Seal **绑定自证**（19 PASS；逐值重算 + 别名一致性 S-17 + 自指禁令 S-18） |
| `scripts/gen1/evidence-capture/v6_key2_immutability_check.py` | ★ B2 新增：**Key 2 不变性**自证（13 PASS；git 历史 before == after） |
| `scripts/gen1/evidence-capture/v6_negative_scan.py` | ★ B2 新增：owner §六 **Negative Scan**（13 PASS） |
| `scripts/gen1/evidence-capture/v6_fingerprint_canonicalization_check.py` | ★ 裁定 A 新增：**`sha256lf` canonicalization** 自证（16 PASS；定义性 + 工作区⇄blob⇄绑定值三向互证 + ⛔ 边界 / 文档 / 制品未被重写） |
| `scripts/gen1/evidence-capture/checkpoint_discriminator.js` / `trigger_registry.js` / `independence_discriminator*.js` / `fixtures/**` / `v6_*` / `r3_contract_consumption_test.py` | 生成轮可执行判据与自证构件 |
| `docs/gen1/GEN1_EVIDENCE_CONTRACT_*V6*_20261002.md`（生成轮 6 件 + Schema Gap 报告 + 提案 / 复评） | 生成轮证据 |

> ⚠️ `scripts/gen1/evidence-capture/out/v5-baseline/`（`c1_*.v5.py`，由 `git show 7d2f39bd…` 抽取）
> 为**对齐校验的运行时产物**，⛔ **不入库**（可随时由 git 重算）。

**清单外指纹**（⛔ 各该对象自身不写入自身 sha256 ⇒ 在此**清单外**单列；as-of 本记录落笔）：

```text
docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json
  a585a33a25cd1fe4b508fc6ce0d1e69f324000cc49f96584865c4811f46a7b62  （10723 B）
docs/gen1/GEN1_EVIDENCE_V6_FREEZE_SEAL_BINDING_DECISION.md
  ff7c8b00adf216462fa1bdc1c1492cfbec3feac4fb1b7f8b28469f9c223f3f5e  （26766 B）
```

⚠️ 本记录**自身**的 sha256 ⛔ **不写入本记录**（自指悖论，与 §0 / 第 53 行同例）；
其余交付物的最终指纹见 §9（实测）与 §10（复算命令）。
❌ 上列值 ⛔ 不得与 §3 的**候选阶段**值（`e93420a3…bef4b1`）混用。

---

## 13. 术语与缩写

| 缩写 | 全称 | 含义 |
|---|---|---|
| `B3` | Toolchain Migration | `c1_capture.py` / `c1_gate_redproof.py` 的 V6 语义迁移（与契约冻结**同批次**） |
| `CD-06` | — | v5.0 §5.6 的 trigger 清单**不完整**（漏 4 项 trigger 族） |
| `CD-07` | — | `CD-04` 修复后的 checkpoint 陈旧（须重评 §5.8） |
| `O-1` | — | owner 裁定：新立**独立**治理对象 `V6.0 Evidence Freeze Seal`（⛔ 不改 Key 2） |
| `O-3` | — | owner 裁定：扩 Key 2 schema ⇒ **REJECTED** |
| `RP-A/B/C` | Reverse Proof A/B/C | 版本错配反向证明（两错配必 FAIL + 全对齐必 PASS） |
| `Key 2` | Freeze Seal | 生产激活安全四绑定制品（`GUARDED_EFFECTIVE_FREEZE`） |
| `Key 3` | Evidence Seal | 统计证据资格 == `EVIDENCE_POSITIVE`（≥30 独立事件） |

---

*本记录由 `WP-G1-EVIDENCE` 工作包 v6.0 的 **V6.0 FREEZE + B3 原子治理批次**产出（OWNER-AUTHORIZED AUTONOMOUS GOVERNANCE）。*
*落点：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SEAL_RECORD_20261002.md`*
*⛔ 本记录不授权任何生产变更；⛔ 不构成 `GE-04`；⛔ 不表示生产已消费 Gen-1 决策。*
