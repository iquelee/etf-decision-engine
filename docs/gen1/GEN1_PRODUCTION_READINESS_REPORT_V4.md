# Gen-1 Production Readiness Report V4（WP-G1.3 Counterfactual Portfolio Ledger Finalization）

**日期**：2026-09-10
**基线**：V3 = `feat/wp-g1-2` @ `cda255b4`（PR #16）；本版 = `feat/wp-g1-3`（PR #17，stacked on #16）
**范围声明**：本 PR **只做 Counterfactual Canary 的组合账本**，不加任何其它功能；不改模型、不改 0.65 阈值、不改 Safety 语义、不改经济逻辑、不改 `gen1_authority`（仍 ADVISORY）。
**一句话结论**：**最终复审的 1 个 P0（账本漏记非 Candidate 的 baseline 占用）+ P1（含混 canary 元数据）+ P2（文档表述）全部处理；本地 `npm test` 36/36、Gen-1 Gates G1-A~R 18/18，等 GitHub CI 绿后提交最终 Review。**

---

## 一、P0：反事实账本漏记「非 Candidate 的 Baseline 加仓」

### 复审给出的反例（已逐位复现）

科技总仓 40%、cap 65%；A 无 Gen-1 但 baseline 自身建议 10→25；B 是 Candidate，想要 10→25。

| | 修复前（WP-G1.2） | **修复后（WP-G1.3）** |
|---|---|---|
| A 是否推进 canary 账本 | ❌ 不推进（`gen1_canary_effective=false`） | ✅ 推进 → `canarySectorUsed 40 → 55` |
| B 的 `sectorRemainingLimit` | `65 − (40 − 10) = 35` ❌ 虚假额度 | `65 − (55 − 10) = 20` ✅ |
| B 的反事实目标 | 25（完整放行） | **20**（被组合约束压缩） |
| B 的 `clamped` | false | true |
| 组合终局 | A25 + B25 + 其它20 = **70 > 65** ❌ | 账本恰好 **65**，不越界 ✅ |

根因：账本推进被 `canary.gen1_canary_effective === true` 门控 → **只有 Gen-1 生效的科技 ETF 才入账**，而「baseline 自身上涨但 Gen-1 没触发」在生产中恰恰是最常见的情况。

`canary.gen1_canary_effective` 现在**只允许用于 invocation 计数与上报**，不得再决定是否入账。

### 同一处的第二层问题：baseline 地板与硬 cap 冲突

WP-G1.2 的 `clampCanaryCandidate` 写了 `Math.max(base, sectorRemainingLimit)`（Canary 不得低于 baseline）。在单只视角看似合理，但在**组合反事实**里会出现：

> 前面的 Gen-1 占用了更多额度 → 后面的 ETF 必须**比自身 baseline 更少**，否则硬 cap 无法满足。

**裁决已采纳（复审建议）**：**共享 cap 优先**，允许后续 ETF 因前面 Gen-1 占用产生**间接组合变化**。地板已移除；被压到 baseline 之下时会显式上报 `gen1_counterfactual_baseline_floor_breached = true`，并在 `console.warn` 中标注「组合约束所致，非模型降级」，避免被误读为 Safety/模型降级。

---

## 二、语义定死：Counterfactual Canary = 完整组合 A/B

不再产出「五只各自独立、可能互相冲突的更高目标」，而是：

```text
真实 V3.6.1 Baseline Portfolio（productionSectorUsed 账本）
        │
        ├── 复制一份完整组合状态（canarySectorUsed 账本，同一种子）
        │
        ├── 所有 ETF 按**相同顺序**重新运行
        │     Candidate    → advisoryStageOverride = S4
        │     非 Candidate → 保持 baseline stage
        │
        └── 共同消费同一个 sectorRemainingLimit / cap / 组合约束
                    ↓
            Counterfactual Canary Portfolio
```

实现为**两条并行账本**，每只科技 ETF 都推进两个账本：

```js
sectorUsed        // 生产账本（不变）
canarySectorUsed  // 反事实账本（种子同 = portfolio.tech_position）
```

唯一差别是「该只是否走 S4 Override」；占用推进复用**同一个** `sectorOccupation()`。

**新增字段（overlay / decision_result）**
- `gen1_canary_target` = Gen-1 的**单只意图**（S4 rerun 结果，保持不变）
- `gen1_counterfactual_target` = **组合一致后**账本实际采用的目标
- `gen1_counterfactual_delta` / `gen1_counterfactual_clamped` / `gen1_counterfactual_sector_remaining`
- `gen1_counterfactual_stage_changed`（是否走 S4）
- `gen1_counterfactual_baseline_floor_breached`（被共享 cap 压到 baseline 之下）
- 视图层：`targets.canary_target_pct` 展示**组合一致**值，`targets.canary_intent_pct` 单独展示单只意图（两者不再混为一谈）

---

## 三、终局断言（G1.3-06；★ G1.3-11 修正表述）

**先厘清账本性质**：本账本是 **execution / intended ledger** —— 占用按**建议执行仓**计
（`occupation = max(0, min(suggested, target) − current)`，与生产**完全一致**）。
因此被 Tech Cap 约束的是「**本轮建议实际执行到的仓位**」，**不是** `Σ final_target`。

**精确不变量**：

```text
① 恒成立：        counterfactual_intended_tech_position <= max(起始科技仓位, cap)
② 起始仓位≤cap：  counterfactual_intended_tech_position <= cap      ← 复审要求的断言
③ 条件成立：      仅当「全部 ETF suggested === target」且种子一致时，Σ counterfactualTarget <= cap
```

> ①为何要带 `max(seed, cap)`：若**起始**仓位本身已超 cap（用户实际持仓高于策略 cap），任何账本都不可能把它降到 cap 以下——账本只能保证**不制造新的超额**。该情形由 ② 的守卫条件单独区分，不会被用来掩盖越界。

> ⚠️ **G1.3-11 修正**：V4 初稿把「一致种子 → Σ 反事实目标 ≤ cap」写成普遍不变量，**这是错的**。当 `suggested < target`（生产常态）时账本按 suggested 推进，而 Σ final_target 可远超 cap：
> ```text
> 4 只科技，各 current 10（种子 40），final_target 30，suggested 15
>   账本（intended）：40 → 45 → 50 → 55 → 60   ≤ 65 ✓
>   Σ final_target  ：30 + 30 + 25 + 20 = 105  > 65  ← 正确行为，不是越界
> ```
> 原测试之所以通过，是因为其生成器恰好令 `suggested === target`（过强假设）。现已把 ③ 改为**条件不变量**，并新增 case 5c 固定该反例。

**运行时实现**：`counterfactualLedgerOk`；违反 → `console.error('[SECURITY] GEN1_COUNTERFACTUAL_LEDGER_OVERFLOW: ...')` 并且 **`counterfactual_canary_active = false`**（fail-closed：不把越界的反事实标为 active，但**不影响 V3.6.1 生产结果**）。

**runtime_status / mlMeta 新增**
```
gen1_production_tech_position              生产账本终值（按建议执行仓）
gen1_counterfactual_intended_tech_position 反事实账本终值（★ 精确名称）
gen1_counterfactual_tech_position          等价别名（向后兼容）
gen1_counterfactual_tech_seed / _tech_cap  起始科技仓位 / cap
gen1_counterfactual_ledger_ok              断言结果
gen1_counterfactual_target_sum             信息性：Σ 战略目标（**不受 cap 约束**，不得作为 cap 合规证据）
```
每只 ETF 另新增 `gen1_counterfactual_suggested_position`（组合约束后的建议执行仓）—— 未来 Economic Health 聚合评估 Timing Gain / Incremental Position / False Fast Path Cost 时应比较 **Baseline Suggested vs Counterfactual Suggested**，而不是只看 target。

---

## 四、P1：canary 元数据不再硬编码

原 `mlMeta` 硬编码 `canary_path_ready: true / canary_enabled: false` —— 未来切到 CANARY 后，实际已在算反事实，状态却仍报 `canary_enabled=false`，形成新的小型双重真相。

已拆除含混 boolean，改为四个显式字段（`mlMeta` 与 `runtime_status` 同源）：

| 字段 | 含义 |
|---|---|
| `counterfactual_canary_authorized` | authority 允许 `CANARY_OVERRIDE`（当前 ADVISORY → **false**） |
| `counterfactual_canary_health_allowed` | 持久化 latch 门允许 canary |
| `counterfactual_canary_active` | `authorized && health_allowed && ledger_ok` |
| `counterfactual_canary_invocations` | 本轮真正执行了几次 S4 反事实重算 |
| `production_fast_path_enabled` | 恒 **false**（生产快通道永久关闭） |

`canary_path_ready` 保留，但明确其语义 = **代码层能力就绪**（与权限状态解耦）。
已确认 `canary_enabled` / `canary_path_ready` 无任何外部消费者（仅本文件写入），移除/重命名安全。

---

## 五、P2：文档关于 `NOT_INITIALIZED` 的表述已修正

**代码是对的，文档表述不准**，已把 V3 报告与当前状态基线的描述改为：

```text
runDecisionEngine 读到 NOT_INITIALIZED
  → PENDING / Canary OFF
  → persist_allowed = false 仅表示「本次读取产生的状态对象不得写回」

下一次成功的 runGen1ShadowEod health evaluation
  → 允许 bootstrap：NOT_INITIALIZED → computeLatchedState() → FOUND → writeHealthState()
```

即：**「不落库」只约束读异常，不禁用正常 bootstrap**（G1-O 用例 5 已明确验证）。**代码未改动。**

---

## 六、测试与门禁

**新增/重写测试**
- `tests/gen1-canary-portfolio.test.js`（G1-M 重写）：复审 60%/65% 反例、**Baseline-only A + Canary B**、Baseline-only A/B + Canary C、Canary A + Baseline-only B + Canary C、400 组随机混合序列（seed 合规）、起始超 cap 边界、**旧行为反例（证明测试有鉴别力：漏记时 Σ=70 > 65）**、非科技不入账、null cap、`sectorOccupation` 与生产公式逐位一致。
- `tests/gen1-counterfactual-ledger-static.test.js`（**新 Gate G1-R**）：源码级断言账本**无条件推进**、非 Candidate 按 baseline 推进、baseline 地板已移除、终局断言存在、`canary_enabled` 硬编码已移除。

**门禁结果（本地）**
- `npm test` → **36/36**
- Stage A Node 单测 **29/29** 文件；Stage C Immutable **11/11** + Pipeline Lock **10/10**（**frozen 管线文件零改动**）；Stage D parity；Stage E secret scan；Stage F build parity
- Stage G **Gen-1 Production Gates G1-A ~ G1-R 18/18**（新增 **G1-R**）

**未受影响的证据**：本 PR 不改 Safety / 经济逻辑，**Canary Replay 与 Economy 结论不变**（`gap_basis=TRADING_DAYS`、日历 1696 日、3 簇 / 2 独立事件、BULL=0、无 `IN_DOMAIN` 事件）。+16.4% 仍只能表述为「当前 frozen contract 下观察到的 3 个正面案例」。

---

## 七、裁决

| Gate | V3 | **V4** |
|---|---|---|
| Gen-1 Frozen Model | PASS | **PASS** |
| Model Candidate Contract | PASS | **PASS** |
| Sector Contract | PASS | **PASS** |
| Health Single Truth | PASS | **PASS** |
| Health DB Fail-Closed | PASS | **PASS** |
| Context Parity | PASS | **PASS** |
| Python ↔ Node Parity | PASS | **PASS** |
| Production No-op | PASS | **PASS** |
| GitHub CI | PASS（#36） | 待 #17 跑绿 |
| **Counterfactual Portfolio Ledger** | ❌（漏记 baseline 占用） | ✅ **PASS**（G1-M 重写 + G1-R） |
| **Counterfactual Canary Metadata** | ⚠️（硬编码 false） | ✅ **PASS**（4 个显式字段） |
| **Ledger Naming / Invariant 表述** | ⚠️（Σ target 被误当不变量） | ✅ **PASS**（G1.3-11 修正 + case 5c 反例） |
| **Schema / Collections 一致性** | ❌（gen1_health_state 未登记） | ✅ **PASS**（G1.3-10 + G1-S 守卫） |
| ADVISORY_PRODUCTION | PASS | ✅ **PASS** |
| **COUNTERFACTUAL_CANARY** | ⚠️ 剩 1 个 P0 | ✅ **APPROVED**（复审正式批准，待按上线清单开启） |
| CANARY Economic Gate | FAIL / insufficient | ❌ **FAIL / insufficient**（证据未扩容） |
| LIMITED / FULL PRODUCTION | BLOCKED | ⛔ **BLOCKED** |
| AUTO TRADING | OFF | **OFF** |

**未改动**：frozen model（SHA `d5e667c6…`）/ `threshold_signal_p = 0.65` / `gen1_authority = ADVISORY` / `production_write = false` / `auto_execution = false` / `final_target = V3.6.1`。
**本 PR 仍不切 CANARY**：等最终 Review 通过后，仅需在 `param_config` 把 `gen1_authority` 置为 `CANARY`（单字段、可逆、无代码变更）。

---

## 八、合并顺序（不 squash）

```text
#11 → master
#12 retarget master → CI → merge
#13 retarget master → CI → merge
#14 retarget master → CI → merge
#15 retarget master → CI → merge
#16 retarget master → CI → merge
#17 retarget master → CI → merge
#18 retarget master → CI → merge（上线前置补齐：Schema/Collections + 账本命名）
```

---

## 十、上线前置补齐（G1.3-10 / G1.3-11，PR #18）

### G1.3-10：`gen1_health_state` 未纳入 SCHEMAS（上线风险）

复审发现：`GEN1_HEALTH_STATE` 只在 `constants.js` 声明，**未进入 `schema.js` 的 SCHEMAS** →
`scripts/init-collections.js` 不会创建它，「线上是否存在」完全靠人工保证。

风险链路（fail-closed 正确，但会被误判为接线 bug）：
```text
collection 缺失 → readHealthState 抛错 → READ_ERROR → ML_OFF → allow_canary=false
→ 切 CANARY 后 authorized=true 但 health_allowed=false、active=false
```

排查同类问题时还发现 **7 个集合**都缺失（`shadow_v3_log`、`runtime_status`、`gen1_health_state`、
`gen2_shadow`、`gen2_daily`、`integrated_shadow_run`、`integrated_shadow_result`），
且 `init-collections.js` 仍 require **已不存在的** `cloudfunctions/common/schema.js`（P0-01 收敛后遗留）→ 脚本直接报错。

**处理**
- 7 个集合全部补入 SCHEMAS（字段 + 唯一键索引；`gen1_health_state` / `runtime_status` 用 `uk_key`）；
- `init-collections.js` require 改为 `src/common/schema.js`，集合清单由 SCHEMAS 驱动；
- **新增 Gate G1-S**（`tests/schema-collections-parity.test.js`）：constants ↔ SCHEMAS 必须一一对应（双向，无缺失无孤儿），并断言上线关键集合存在唯一键索引与 latch 字段。**这类「代码知道集合、初始化脚本不知道」的缺口从此不可能静默复发。**

> 代码知道某个集合 ≠ 线上一定已创建。G1-S 保证的是「初始化脚本会自动创建」，
> **线上是否真的存在仍需按上线清单验收**（见 `GEN1_CANARY_GO_LIVE_RUNBOOK.md` 第 3 步）。

### G1.3-11：账本命名与不变量表述修正（复审 P1，不阻断 Canary）

见第三节。要点：账本是 **execution/intended ledger**，`Σ final_target` **不受 cap 约束**。
字段命名精确化（`gen1_counterfactual_intended_tech_position` 为准确名称，旧名保留为别名）、
新增每只 `gen1_counterfactual_suggested_position`、新增信息性 `gen1_counterfactual_target_sum`，
测试补 case 5c 固定反例。**算法未改**。

**建议排期**：此项应在 **Economic Health 自动闭环**（Residual R1）之前完成 — 已在本 PR 完成，
以便后续 Timing Gain / Incremental Position / False Fast Path Cost 直接比较
**Baseline Suggested vs Counterfactual Suggested**。

---

## 九、未闭合（LIMITED_PRODUCTION 前置，未变）

1. **Economic Health 自动闭环**：仍是离线计算器（Shadow Ledger → 自动 Aggregate → 写 `gen1_health_state` → `runDecisionEngine` 消费）。
2. **经济样本扩容**：建议另立 `WP-G1-EVIDENCE`（只扩样本，**不动 0.65、不改 frozen model**）。
3. **Replay Fidelity**：仍为 `PARTIAL_FIDELITY`（risk/fundamental/组合约束为代理）。
