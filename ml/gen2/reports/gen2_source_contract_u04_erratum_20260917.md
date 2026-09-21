# Gen-2 数据来源资格契约 · `U-04` 勘误（`ERRATUM`）

> **状态**：`STATUS: DOCUMENTARY_ERRATUM` ｜ **日期**：2026-09-17
> **授权（裁决依据）**：**用户于 2026-09-17 在本 Gen-2 对话中的明确指令** —— Owner 最终裁决：`U-04` = 覆盖率分母**不扣除**。
> **被勘误对象**：**本工作区当前** source contract —— `ml/gen2/reports/gen2_source_contract_draft_20260917.md`
> 的 `U-04` 口径（工作区分支 `docs/gen2-wp-g2-08-drafts-20260917`）。**被勘误的现行正文已改为**：覆盖率分母
> **不扣除**；冻结的 `≥ 6 of 8` 分母**不得因 `STRUCTURAL_NO_INSTRUMENT` 或任何结构性不可得方向而缩减**；
> `STRUCTURAL_NO_INSTRUMENT` **仅作事实记录**，**不得用于准入结论**。
> 作为**对照**：其**入库版本**提交 `3b8047e04d9534fe0b3c69d84bf5da2609c528f7` 仍保留旧表述（见 §1.2）。
> **协议**：`DOC_ERRATUM_NOT_FOR_CALIBRATION` —— 本文件**不产生任何参数、不做任何验证、不重算任何读数**。
> **原则**：被勘误对象的 `U-04` 现行文字**由本纠正包统一改写为单一有效口径**；本文件是该勘误的
> **登记与说明处**，并与 `README.md` 索引**互链**（见 §4）。
> **`EFFECTIVE_CONDITION`**：**仅当本文件与被勘误的 source contract 同时进入 `master` 后，
> 才作为仓库文档口径生效。**
> **`SCOPE`**：**仅纠正 `U-04` 文档表述，不改变 `freeze`、规则、参数或生产行为。**
> ⚠ 本文件**不声称**自身已进入 `master`；实际跟踪与合并状态一律以**实时** `git status` / `git log` 为准，
> 本文档不自行记录。
> ⚠ 本文件**不使用** `LOCAL_OWNER_RULING_ADOPTED` 作为效力标记；效力标记为 `STATUS: DOCUMENTARY_ERRATUM`。

---

## §1 勘误要点（三条）

### 1.1 现行唯一有效口径

**`U-04` = 覆盖率分母不扣除；冻结的 `≥ 6 of 8` 分母不得因 `STRUCTURAL_NO_INSTRUMENT` 或
任何结构性不可得方向而缩减；`STRUCTURAL_NO_INSTRUMENT` 仅作事实记录，不得用于准入结论。**

| # | 条款 |
|---|---|
| R-1 | 冻结的 **`≥ 6 of 8`**（8 个 cluster）分母**原样不变**；**不得因 `STRUCTURAL_NO_INSTRUMENT` 或任何结构性不可得方向而缩减**。 |
| R-2 | `STRUCTURAL_NO_INSTRUMENT`（某方向在目标上市截止日前**结构性不存在**可交易 ETF）**仅作事实记录**：可以登记、可以披露；**不得用于准入结论** —— 它**既不**是缩减分母的理由，**也不**构成覆盖率不达标的豁免或判据。 |
| R-3 | 覆盖不足时的处置 = 「**接受不达标并如实披露**」；**不得**通过缩小分母使其达标，**不得**静默删除该方向。 |

### 1.2 被勘误的旧表述（`3b8047e0` 中的 `U-04`）

以下表述**只作为被勘误的历史记录**留在 `3b8047e0` 中，**不再代表现行口径**，**不得用于准入结论**：

| # | 位置（`3b8047e0` 内） | 旧表述（原文摘录） | 定性 |
|---|---|---|---|
| E-1 | source contract §9 Human Ruling 表 `U-04` 行 | 「**从「可交易 ETF 覆盖率」的分母中扣除**，但必须单独披露结构性缺口。」`eligible_denominator = directions_with_existing_tradeable_ETF` | **被勘误**，不得用于准入结论 |
| E-2 | 同文件 §9.1 Scope Note | 「对 `STRUCTURAL_NO_INSTRUMENT` 使用 `eligible_denominator`」 | **被勘误**，不得用于准入结论 |
| E-3 | 同文件 §9.2「原冲突登记的闭合」 | 采正文口径：`eligible_denominator` **扣除** `STRUCTURAL_NO_INSTRUMENT` | **被勘误**，不得用于准入结论 |
| E-4 | 同文件 §11 | 以 `LOCAL_OWNER_RULING_ADOPTED` 名义登记的覆盖性反向裁决 | **效力标记废止**；该节已改写为中性的「并发文档冲突记录」 |

### 1.3 正文现状

- `gen2_source_contract_draft_20260917.md` 的 `U-04` 相关正文（文首 / `EC-06` / §9 表 / §9.1 / §9.2 / §10 / §11）
  **已由本纠正包统一改写**（2026-09-17 首版；2026-09-18 按 Owner 口径收紧措辞，裁决内容未变）；
  同一文件内**不再并存第二个 `U-04` 口径**。
- §11 已改为**中性的版本冲突记录**：只陈述版本事实、适用范围与「以本地 `U-04` 勘误为准」，
  **不含**任何裁决、归责或有效规则。
- 自本勘误起，`LOCAL_OWNER_RULING_ADOPTED` **不再作为效力标记使用**。

---

## §2 口径原因（为什么原表述被否决）

原表述把「市场上**不存在**对应主题的可交易标的」这一**市场事实**，当成了**缩小覆盖率分母**的理由。
这会使「覆盖率达标」变成**可以通过调整分母而自我实现**的结论 —— 门槛随之失去约束力。

⇒ 否决该做法，收口为：**分母不动**（`≥ 6 of 8` 保持不变），**缺口如实记录与披露**
（`STRUCTURAL_NO_INSTRUMENT` 仅作事实记录）。

⚠ 本节只作**口径原因**的说明，不对任何个人、会话、机器或流程作动机推断与责任判定。

---

## §3 本勘误**不**改变什么（边界）

* **不改 `freeze v1.1`**：`gen2_data_boundary_freeze_20260915.md` 的 `≥ 6 of 8` 分母、§2.4 / §2.6 数值 —— **原文零改动，阈值不改**。
* **不改代码 / 规则 / 生产行为**：不触碰 `ml/gen2/` 可执行逻辑、`scripts/`、`tests/`、规则 / bundle / lock / `immutable_set` / 参数 / OOS 分割 / 生产权限。
* **不改任何归档状态**：不动 `ACCEPTED_FAIL` / `NOT_PRODUCTION_ELIGIBLE` 等既有结论。
* **不改 `U-01` / `U-02` / `U-03` / `U-05` / `U-06`**：本文件**不讨论、不改变、也不推定**这五项的任何内容。
* **不构成来源准入批准**：本文件不含、也不隐含任何数据来源的资格结论。
* **不改变文档整体状态**：source contract 仍为 `NOT_APPROVED` / `NOT_IN_FORCE`。

---

## §4 索引互链（双向）

| 方向 | 文档 / 位置 |
|---|---|
| 本勘误 → 被勘误对象 | `gen2_source_contract_draft_20260917.md`（文首 / `EC-06` / §9 表 `U-04` 行 / §9.1 / §9.2 / §10 / §11；**现行口径＝覆盖率分母不扣除**） |
| 被勘误对象 → 本勘误 | 同文件**文首**、§9 表后说明、§9.2、§11 **四处**均指向本文件 |
| 本勘误 → 索引 | `ml/gen2/reports/README.md`「本地草案」区：草案集行尾「`U-04` 勘误（双向索引）」＋ `U-04` 勘误独立行（**双向链接**） |
| 索引 → 本勘误 | 同上（README 上述两处链接均指向本文件） |

---

## §5 只读复现（不联网）

```bash
# 0) 下列命令全部只读：不联网、不写任何文件

# 1) 被勘误对象的入库版本 —— 旧口径「分母扣除」存在于该版本
git show 3b8047e04d9534fe0b3c69d84bf5da2609c528f7:ml/gen2/reports/gen2_source_contract_draft_20260917.md

# 2) 现行工作区正文相对入库版本的差异（＝本纠正包的收口内容）
git diff -- ml/gen2/reports/gen2_source_contract_draft_20260917.md

# 3) 现行正文中旧口径关键字应为 0 命中（无输出即通过）
git grep -n "eligible_denominator" -- ml/gen2/reports/gen2_source_contract_draft_20260917.md
git grep -n "LOCAL_OWNER_RULING_ADOPTED" -- ml/gen2/reports/gen2_source_contract_draft_20260917.md

# 4) 本勘误文件的当前跟踪 / 合并状态（以实时 git status 输出为准，本文档不自行记录）
git status --short -- ml/gen2/reports/
```

---

## §6 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-17 | **首版**（本地简版勘误，随 `U-04` 本地裁决发布）。 |
| 2026-09-17 | **改版**：按仓库既有 erratum 格式（§1–§6）重写；与「`U-04` 文档纠正包」同批产出；效力标记 `LOCAL_OWNER_RULING_ADOPTED` **停止使用**。 |
| 2026-09-18 | **措辞收口**：按 Owner 口径收紧 source contract 的 `U-04` 现行正文（唯一口径＝**覆盖率分母不扣除**；冻结的 `≥ 6 of 8` 分母**不得因 `STRUCTURAL_NO_INSTRUMENT` 或任何结构性不可得方向而缩减**；`STRUCTURAL_NO_INSTRUMENT` **仅作事实记录**，**不得用于准入结论**）；source contract §11 改为**中性版本冲突记录**（只陈述版本事实 / 适用范围 / 以本勘误为准）；§4 双向索引与 `README.md` 对齐；明确被勘误对象为**本工作区当前** source contract。本次收口仅涉文档措辞，不改 `freeze` / 规则 / 参数 / 生产行为。 |
| 2026-09-21 | **状态措辞收口**：将效力标记由随提交状态失真的表述改为稳定口径 —— `STATUS: DOCUMENTARY_ERRATUM` + `EFFECTIVE_CONDITION`（须与被勘误契约**同时进入 `master`** 方作为仓库文档口径生效）+ `SCOPE`（仅纠正 `U-04` 文档表述）。本文件**不声称**已进入 `master`；跟踪与合并状态以**实时** `git status` / `git log` 为准。**不改** `U-04` 实质口径、`freeze`、规则、参数或生产行为。 |
