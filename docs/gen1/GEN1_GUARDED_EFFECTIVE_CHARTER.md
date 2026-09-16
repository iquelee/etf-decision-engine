# Gen-1 Guarded Effective 章程（WP-G1-GE）

**文档编号**：`WP-G1-GE-CH-1.0`
**工作包**：`WP-G1-GE` — Gen-1 Guarded Effective Integration
**as-of**：2026-09-16
**状态**：🔒 **CONTRACT FROZEN** — 契约已冻结；**实现未激活**（`gen1_authority` 仍为 `CANARY`，生产结果逐字节不变）
**上位约束**：`gen1-authority.js` 的 `PRODUCTION_LOCKED` 硬边界；本仓库「效果不明不部署」总则
**取证依据**：`outputs/gen1-authority-audit-20260916/GEN1_AUTHORITY_FORENSIC_REPORT.md`（只读审查，基线 `origin/master = d66cd86`）

---

## 0. 本文件的作用，以及它**不**做什么

本文件是「Gen-1 获得**向 V3.6.1 提供受控阶段输入**的资格」这一动作的**独立契约**。

它**不是** `WP-G1-EVIDENCE` 的延伸，也**不是**对既有章程的修改稿。按 `CANARY_SWITCH_REPORT.md` §5.1 的既有裁定，解除 Gen-1 的生产层护栏必须：**新工作包 + 新契约 + 重新冻结**。本文件即该「新契约」。

**它不做的事**：

- ❌ 不修改 `WP-G1-EVIDENCE_CHARTER` / `GEN1_EVIDENCE_CONTRACT` / `GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL` / `GEN1_DAILY_PRODUCTION_WATCH` 的任何条款（历史事实保留，**不重写历史**）。
- ❌ 不授权 `PRODUCTION` 档位（该档位继续永久不可达）。
- ❌ 不改变「人工执行」与「自动交易关闭」。
- ❌ 不触碰 `ml/gen2/**` 与其 `ACCEPTED_FAIL` 冻结证据。

---

## 1. Authority 语义（★ 本章是全文的锚）

### 1.1 状态机阶梯（在既有状态机上**插入一格**，不推翻重做）

```text
OFF
 ↓
SHADOW
 ↓
ADVISORY
 ↓
CANARY
 ↓
GUARDED_EFFECTIVE      ← ★ 本次新增（WP-G1-GE-02 落地）
 ↓
PRODUCTION_LOCKED      ← 继续永久不可达（PRODUCTION_LOCKED = true）
```

> ⚠️ **不引入** `DISABLED` / `PRODUCTION` 之外的第二套词汇。既有状态机
> （`src/common/utils/gen1-authority.js:24-51`：`OFF|SHADOW|ADVISORY|CANARY|PRODUCTION`）
> 是唯一真相源，本次只做**插入**与**重排 rank**。

### 1.2 `GUARDED_EFFECTIVE` 的准确语义（逐字，勿写错）

```text
GUARDED_EFFECTIVE
  = Gen-1 获得「向 V3.6.1 提议一个受控阶段输入（S2/S3 → S4）」的资格

GUARDED_EFFECTIVE ≠ Gen-1 获得生产写权限
```

- `final_target` / `final_action` / `suggested_position` 的**唯一产出方仍然是 V3.6.1 Safety Core**。
- 即使进入 `GUARDED_EFFECTIVE`：**`production_write` 仍然恒为 `false`**，**`auto_execution` 仍然恒为 `false`**。
- Gen-1 **永远不得**直接写：`final_target`、`final_action`、`suggested_position`、正式持仓/执行集合、自动交易指令。

**职责分层（本条为长期边界，不得越级）**：

```text
Gen-2  → Selection：选谁
Gen-1  → Timing：什么时候可以提前进入（仅提议阶段输入）
V3.x   → Position & Risk：最终买多少（唯一 final_target 产出方）
Safety → 最终硬约束
Human  → Execution
```

### 1.3 永久不变量（**绝不被本工作包覆盖**）

| # | 不变量 | 锚点 |
|---|---|---|
| I1 | Gen-1 不得产出 `final_target` / `final_action` / `suggested_position` | `gen1-authority.js:115-116`、`gen1-overlay.js:93-94` |
| I2 | `production_write === false` 恒真 | `gen1-authority.js:115`、`:140-141` |
| I3 | `auto_execution === false` 恒真 | `gen1-execution-boundary.js:14,25-44` |
| I4 | `PRODUCTION` 档位不可达（请求即降级） | `gen1-authority.js:42,89-95` |
| I5 | V3 / Safety Core 是唯一最终裁决者 | `decision-v3.js:1140-1193` |
| I6 | `applyGen1Overlay` 对 production 字段的 **no-op 语义** | `gen1-overlay.js:93-94` + `index.js:785-788` 运行期断言 |

> ⚠️ **I6 的准确读法（本轮更正，勿再写错）**：
> 本工作包解除的是「**V3 可以接受 Gen-1 的受控阶段输入**」，
> **不是**解除「**overlay 不得修改 `final_target`**」。
> 两者是**不同的**不变量，不得混为一谈。⚠️ 「禁止 X」≠「清除 Y」。

---

## 2. 与既有治理文档的关系

### 2.1 现行有效文档登记（as-of 2026-09-16）

| 文档 | as-of | 状态 | 与本章程的关系 |
|---|---|---|---|
| `docs/gen1/WP-G1-EVIDENCE_CHARTER.md` | 2026-09-10 | 生效（观察型工作包） | §3 执行顺序 ⑤ **继续有效**（见 §5）；§5 硬边界「不改 `gen1_authority`」**继续有效** |
| `docs/gen1/GEN1_EVIDENCE_CONTRACT.md` | 2026-09-10 | 🔒 FROZEN v1.0 | **整份继续有效**，字段/阈值/纳入规则**一个字都不改**（本工作包不得改 v1.0；如需改须 v2.0 重冻结 + 样本作废） |
| `docs/gen1/GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md` | 2026-09-10 | 待触发 | **整份继续有效**；其 §3「❌ 不把 `gen1_authority` 回退 ADVISORY」继续有效 |
| `docs/gen1/GEN1_DAILY_PRODUCTION_WATCH.md` | 2026-09-10 | 生效 | **整份继续有效**，7 项每日监控不因本工作包而减少 |
| `docs/gen1/GEN1_CANARY_GO_LIVE_RUNBOOK.md` | 2026-09-11 | 生效 | 继续有效；`GUARDED_EFFECTIVE` 的上线动作**另行**编写 runbook（WP-G1-GE-04） |

### 2.2 三类关系（逐条判定）

**(A) 继续有效（不得被本工作包削弱）**

1. `GEN1_EVIDENCE_CONTRACT` v1.0 的全部 17 字段、方向约定、MFE/MAE 口径、Q1/Q2/Q3 阈值。
2. `WP-G1-EVIDENCE_CHARTER` §3 的 ⑤「独立事件 ≥ 30 后才判定」。
3. `GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL` 的 M1..M6（含 M4 的 No-op 逐字节核对）。
4. `GEN1_DAILY_PRODUCTION_WATCH` 的每日 7 项只读监控。
5. 五重 fail-closed 门（权限总闸 / 配置闸 / model_id / 信号新鲜度 / EOD 预检）。

**(B) 被扩展（本工作包新增，不修改原条款）**

1. Authority 阶梯新增 `GUARDED_EFFECTIVE`（§1.1）。
2. 新增「三钥匙 + 运行时叠加门」激活模型（§3）。
3. 新增 `baseline V3 + guarded V3 → Guarded Selector` 执行拓扑（§4）。
4. 新增 `decision_result` / `runtime_status` 审计字段（§6）。
5. 新增 7 类反例测试（WP-G1-GE-03）。

**(C) 绝不被覆盖（红线）**

1. `final_target` / `final_action` / `suggested_position` 的 Gen-1 写入禁令。
2. `production_write` / `auto_execution` 恒 `false`。
3. `PRODUCTION` 档位不可达。
4. `GEN1_EVIDENCE_CONTRACT` v1.0 的字段与阈值。
5. Evidence Gate（`≥ 30 独立事件`）作为 P4 的**硬前置**。

---

## 3. 激活安全（★ 单靠改配置**绝不能**激活）

### 3.1 三钥匙（缺一不可）

| Key | 内容 | 判定方 |
|---|---|---|
| **Key 1 — Authority** | `param_config.gen1_authority == 'GUARDED_EFFECTIVE'` | `resolveAuthority(merged)`（`index.js:553`） |
| **Key 2 — Freeze Seal** | `GUARDED_EFFECTIVE_FREEZE` 制品状态 == `APPROVED`，且绑定 **source SHA + model SHA + threshold 版本 + contract version** 四项与运行期实读**逐项一致** | 新增冻结制品（WP-G1-GE-01/02） |
| **Key 3 — Evidence Seal** | Evidence Seal == `PASS`（即 `GEN1_EVIDENCE_CONTRACT` §4.2 的 `EVIDENCE_POSITIVE`） | 按 §5 由独立工作包产出 |

> ★ **只有 Key 1 是永远不够的**。这是本工作包的核心安全性质：
> 即使有人手工把数据库改成 `gen1_authority = 'GUARDED_EFFECTIVE'`，
> 也**无法**单独开启生产影响。

### 3.2 运行时叠加门（在三钥匙之上，逐只每次重判）

```text
Health PASS     （gen1_health_status == OK 且 gate ACTIVE）
Data   PASS     （data_health_status 非 BLOCKED / DEGRADED）
Domain PASS     （domainStatus == IN_DOMAIN）
Safety PASS     （硬风险 / F5 / 结构破坏 / 慢破位 全过）
Candidate PASS  （stage == S2 ∧ ml_fast ∧ calibrated_probability ≥ 0.65 ∧ model_id 精确匹配）
```

### 3.3 单一准入表达式（唯一准入点）

```text
effective_guarded =
      authority_guarded        # Key 1
   ∧ freeze_seal_approved      # Key 2
   ∧ evidence_seal_pass        # Key 3
   ∧ health_allows_guarded
   ∧ data_ok
   ∧ domain_ok
   ∧ safety_pass
   ∧ candidate
```

- 该表达式**必须**是 `gen1-safety-permission.js` 内合成项的**唯一**准入判据（与既有 `effective_canary` **并列**，不是替换）。
- 任一为 false ⇒ `effective_guarded = false` ⇒ **回退纯 V3.6.1 baseline**（fail-closed）。
- ⚠️ 两条路径权限推导**必须同源**：生产链读 `param_config`（`index.js:553`）；
  `runGen1ShadowEod`（`:166`）的硬编码 flags **不得**用于判定 `effective_guarded`，
  否则会出现「信号行声称有效、生产链否决」的分裂（审计报告 R3）。

### 3.4 `gen1_authority` 必须入冻结清单（P0）

**现状**：`gen1_authority` **不在** `FROZEN_PARAM_KEYS`（`src/common/constants.js:61-69`）。

**裁定**：在 `CANARY` 阶段此缺口风险有限（最高档也影响不了 `final_target`）。一旦引入 `GUARDED_EFFECTIVE`，该缺口**立即升为 P0**（改一条配置即可取得生产影响资格）。

⇒ **WP-G1-GE-02 必须同时**：
1. 将 `gen1_authority` 纳入 `FROZEN_PARAM_KEYS`（冻结/受限）；
2. 保证 `GUARDED_EFFECTIVE` **不得由 `gen1_authority` 单独决定**（§3.1 三钥匙）。

---

## 4. 执行拓扑（保留 baseline 与 guarded 两次 V3 运行）

### 4.1 生产链

```text
① V3 baseline run               (index.js:655，不传 advisoryStageOverride)
        ↓
② Gen-1 Candidate + Safety + Domain + Health   (index.js:695-707)
        ↓
③ effective_guarded ?（§3.3 单一表达式）
        ↓ 是
④ 同一个 V3 再跑一次，advisoryStageOverride = 'S4'
        ↓
⑤ V3 自己重新计算 final_target / final_action / suggested_position
        ↓
⑥ Guarded Selector：baseline_result 或 guarded_result
        ↓
⑦ 唯一正式 decision_result 落库 (index.js:790)
```

### 4.2 为什么保留两次运行（而非把 override「前移」给第一次调用）

| 收益 | 说明 |
|---|---|
| 天然产出 `baseline_result` / `guarded_result` / `delta` | 便于 Evidence 与归因 |
| 回退极简 | Selector 恒选 baseline = 逐字节复原 |
| 可审计 | 可证明「Gen-1 没有自己算仓位，只是触发 V3 在另一阶段假设下重新裁决」 |

### 4.3 overlay 不变量（★ 不得削弱）

```text
普通档位（OFF/SHADOW/ADVISORY/CANARY）：
    applyGen1Overlay → production 字段**必须完全 no-op**（维持现状）
    gen1-overlay.js:93-94 的硬还原**保留不动**

GUARDED_EFFECTIVE：
    ❌ 不是让 overlay 去改 production 字段
    ✅ 而是：guarded V3 result → 权威 selector → 正式 result
       overlay 只负责**附加审计字段**
```

> ⇒ 本工作包**不教 overlay 直接修改 `final_target`**。overlay 的 production no-op 语义对**所有档位**继续成立；进入生产路径的是 `guarded V3 result`，不是 `overlay output`。

---

## 5. Evidence Gate（P4 的 HARD GATE，不允许静默降级）

### 5.1 硬前置（逐字沿用既有口径）

```text
P4（真切换）前置 = GEN1_EVIDENCE_CONTRACT §4.2 的 EVIDENCE_POSITIVE
                 = Q1 ∧ Q2 成立，且 Q3 不成立
                 = 且 独立事件数（independent_event = true）≥ 30
```

| 阶段 | 允许 |
|---|---|
| P1 契约冻结 | ✅ |
| P2 代码实现（dormant） | ✅ |
| P3 Shadow / Replay / 反例门 | ✅ |
| **P4 `GUARDED_EFFECTIVE` 真切换** | ❌ **Evidence PASS 前禁止** |

**为什么不许「代码已经安全，先开一点看看」**：

```text
Safety Gate  证明：它不会突破风险约束
Evidence Gate 证明：让它影响生产可能有经济价值
```

二者是**两件不同的事**，前者 PASS **不能**代替后者。

### 5.2 现状（2026-09-16 实读）

| 项 | 值 | 来源 |
|---|---|---|
| `param_config.gen1_authority` | `CANARY` | CloudBase 只读实读（`_id=6aa267a84af9d2f69b8dfc55`, `version=2`） |
| `runtime_status.gen1_authority` | `CANARY` | CloudBase 只读实读（`decision_date=2026-09-16`） |
| `gen1_counterfactual_canary_invocations` | **`0`** | 同上 ⇒ **Candidate Data Path 从未有过一次真实调用** |
| Evidence 样本行数 | **`0`** | `WP-G1-EVIDENCE_CHARTER` §4 + 今日实读一致 |
| `gen1_production_write` / `gen1_auto_execution` | `false` / `false` | 同上 |

⇒ **Evidence Gate 当前明确未满足。**

### 5.3 偏离程序（若将来决定不等 30 个独立事件）

必须形成一份**显式的 `GOVERNANCE DEVIATION`** 记录，且至少写明：

1. 为什么偏离（理由，不得是「看起来没问题」）；
2. 允许的**最大影响面**（哪个字段、哪个上限、可影响的最大仓位幅度）；
3. **期限**（判定窗口）与**退出条件**；
4. **责任边界**（谁批准、谁复核、如何回滚）；
5. 与此前承诺（pre-registration）的关系说明。

> **当前裁定：不偏离。** 本工作包在任何情况下不得把 Evidence Gate 降格为一个可选健康检查。

---

## 6. 数据契约（新增审计字段）

### 6.1 `decision_result` 新增字段

| 字段 | 类型 | 语义 |
|---|---|---|
| `decision_source` | string | `'V361_SAFETY_CORE'` \| `'V361_SAFETY_CORE_WITH_GEN1'` |
| `gen1_run_id` | string | 当日 Gen-1 EOD 运行标识（由 `runGen1ShadowEod` 产出并写入 `ml_shadow_signal`） |
| `gen1_candidate_hash` | string | 候选输入的稳定哈希（既有配方：`~` 分隔 + 字典序 + `\|` + sha256） |
| `gen1_adopted` | boolean | 是否被采纳进生产计算 |
| `gen1_reject_reason_code` | string\|null | 未采纳原因（复用既有 reason_code 词表） |
| `gen1_safety_core_adjust_reason` | string\|null | V3 采纳后又被裁剪的原因（如触科技 cap） |
| `gen1_authority` | string | **已存在**（`gen1-overlay.js:48`），不新增 |
| `gen1_guarded_baseline_stage` | string | baseline 阶段（S1..S5） |
| `gen1_guarded_effective_stage` | string | guarded 重跑使用的阶段（S4） |
| `gen1_guarded_baseline_target` | number | baseline 的 target |
| `gen1_guarded_result_target` | number | guarded V3 重算出的 target |
| `gen1_guarded_delta` | number | `guarded − baseline` |
| `gen1_guarded_selector_source` | string | `'BASELINE'` \| `'GUARDED'` |

### 6.2 `runtime_status` 新增字段

| 字段 | 类型 | 语义 |
|---|---|---|
| `gen1_guarded_effective_authorized` | boolean | Key 1 成立 |
| `gen1_guarded_effective_evidence_allowed` | boolean | Key 3 成立 |
| `gen1_guarded_effective_health_allowed` | boolean | 运行时 Health 门成立 |
| `gen1_guarded_effective_active` | boolean | `effective_guarded` 合成结果 |
| `gen1_guarded_effective_invocations` | number | 累计真实采纳次数 |

### 6.3 `ml_effective` 的定位（★ 不得成为新真相源）

```text
ml_effective        = legacy / summary alias
                    = gen1_guarded_effective_active
```

- 现状：`ml_effective` 在 `runDecisionEngine/index.js:1048`（runtime_status）与 `:1108`（顶层）是**硬编码 `false` 字面量**。
- 裁定：改为**派生**，且**方向只能是** `ml_effective ← gen1_guarded_effective_active`；
  **严禁**反向派生。
- ⚠️ 字段名保持 `ml_effective`（**不是** `m1_effective` —— 全仓 0 命中，且 `M1` 是 Gen-2 的数据边界里程碑，混用会造成歧义）。

### 6.4 向后兼容

`ml_rule_permission*`、`gen1_canary_*`、`gen1_counterfactual_*`、`v361_baseline_*` **全部保持不变**。

---

## 7. 回退方案

| 级别 | 动作 | 生效时点 |
|---|---|---|
| **L1 一键** | `param_config.gen1_authority` 改回 `CANARY`（或删除该文档 ⇒ 回落 `DEFAULT_AUTHORITY='ADVISORY'`） | 下次 `runDecisionEngine` 立即，无缓存 |
| **L2 双重保险** | Freeze Seal 置为 `REVOKED` ⇒ Key 2 失效 ⇒ `effective_guarded` 恒 false（**即使 authority 误配也不采纳**） | 同上 |
| **L3 代码级** | revert WP-G1-GE-02 的 PR | 需重新部署（本阶段不部署） |
| **L4 Selector 级** | `gen1_guarded_selector_source` 强制 `BASELINE` | 同上 |

> 回退方式与 `CANARY_SWITCH_REPORT.md` 记载的既有做法保持一致。

---

## 8. 工作包拆分与执行顺序（★ 不可颠倒）

```text
WP-G1-GE-00  Docs Governance Baseline            ← ✅ 已完成（PR #41，merge d254a7a6）
      ↓
WP-G1-GE-01  Guarded Effective Contract          ← 本文件 + 冻结制品规格
      ↓
WP-G1-GE-02  Dormant Implementation              ← 代码落地，但 authoritative selector 恒选 baseline
      ↓
WP-G1-GE-03  Shadow / Replay / Negative Gates    ← 影子守卫重跑 + 7 类反例测试
      ↓
（等待 Evidence Gate：独立事件 ≥ 30 + EVIDENCE_POSITIVE）
      ↓
WP-G1-GE-04  Explicit Promotion                  ← 需用户显式裁决 + 新 runbook
```

**P1 / P2 / P3 的共同约束（六条硬护栏）**：

| # | 护栏 |
|---|---|
| A | 当前 `CANARY` 行为**逐字节保持不变** |
| B | 新增 `GUARDED_EFFECTIVE` **不能靠 `param_config` 一个字段激活** |
| C | Gen-1 永远不得直接写 `final_target` / `final_action` / `suggested_position` |
| D | `production_write` 继续 `false`；`auto_execution` 继续 `false` |
| E | V3 / Safety Core 永远是最终裁决者 |
| F | P3 可以计算 guarded result，但 **authoritative selector 永远选 baseline** |

---

## 9. Gen-2 隔离（不得影响冻结证据）

- `ml/gen2/**` 在本工作包内**全程只读**。
- Rule V2.0.1 的 **`ACCEPTED_FAIL` / `NOT_PRODUCTION_ELIGIBLE`** 状态**不得改变**。
- 8 项 `immutable_set` 摘要、LOCK 链（rev3 `d3d40f99`）、`verify-immutable.js` 的 23 项**必须逐位不变**。
- WP-G1-GE-03 须新增交叉断言：Gen-1 全档位运行后 Gen-2 冻结证据摘要不变。

---

## 10. 变更日志

| 版本 | 日期 | 修改内容 | 是否作废既有样本 |
|---|---|---|---|
| v1.0 | 2026-09-16 | 首次冻结（WP-G1-GE 立项，用户裁决 RULING-WP-G1-GE） | — |

---

*本契约由 WP-G1-GE 工作包冻结。任何修改须以 v2.0 发布并留痕。*
*本文件不授权任何生产变更；`gen1_authority` 保持 `CANARY`。*
