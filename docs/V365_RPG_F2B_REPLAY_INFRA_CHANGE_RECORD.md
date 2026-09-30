# V365 RPG-F2-B Replay-Infra Change Record

> **性质**：`REPLAY_INFRASTRUCTURE` 变更记录（RPG-F1 §9 流程第 ⑤ 步）。
> **生成**：2026-09-29（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（分支 `feat/v365-production-integrity-impl`）
>
> **结论标记**：`[AS-IS]` 实测 · `[PROBE]` 探针 · `[INFER]` 推理 · `[HUMAN]` 待裁定

---

## 0. 授权状态 `[AS-IS]`

```
authorization_sha            = c6bd006fd76ffc5358cddd07347df8ed23d9e61d
replay_infra_review          = REPLAY_INFRA_CHANGE_REVIEW_REQUIRED
OWNER_REPLAY_INFRA_AUTHORIZED = true
OWNER_AUTHORIZATION          = APPROVED
```

**授权来源**：owner 于 2026-09-29 通过本会话**显式**给出 `REPLAY_INFRASTRUCTURE` 授权，逐位绑定上述 40 位 SHA。

| 项 | 值 |
|---|---|
| 授权范围（仅限） | `scripts/lib/v364-replay-harness.js` |
| 附带授权（为实现所必需） | `REPLAY_INFRASTRUCTURE` · tests · read-only probes · delta attribution · coverage manifests · local anchors · evidence · docs |
| 授权目的 | `RPG-F2-B actual-execution cooldown fidelity` + `RPG-F2-C production historical book` + `RFP-V2-PH` |
| 有效期 | **仅对该 SHA 有效**；HEAD 改变后**自动失效** |
| 可复用性 | ⛔ **不可跨任务复用** |

⛔ **明确未授权（本授权不包括）**：

```
生产数据库写入 · 生产 collection 创建 · Cloud Function deploy
push · PR · merge · tag/release
策略计算语义修改 · constants.js 修改 · cooldown.js 修改
immutable lock 修改 · Gen-1 locked file 修改
```

### 0.1 ⚠️ 严格区分两件事 `[HUMAN]`

```
AUTHORIZED_TO_IMPLEMENT  = true      ← 授权**代码变更**
QUALIFICATION_AUTHORITY  = false     ← ⛔ **不等于** replay 已获资格权威
```

**授权代码变更 ≠ replay 已获得 qualification authority。**
本记录只证明 ①；② 仍须满足 owner §10 的最终条件（见 §9）。

---

## 1. 变更对象 `[AS-IS]`

| 项 | 值 |
|---|---|
| 文件 | `scripts/lib/v364-replay-harness.js` |
| 分类 | **`REPLAY_INFRASTRUCTURE`**（HD12-D6 第三桶） |
| F2-A 后 sha256 | `fba52862bea731b28ff3b132d64a9950183dcbcc4a690814f5e93345e10e17e4` |
| 本轮（F2-B）后 sha256 | `24f8f096fc357bfbae8e6582ce26b97f33910848a1607b6d6128fe93807e6dd8` |
| 变更性质 | **新增协议分支 + 新增受治理账本装载**（非替换；V1/V2-CF 入口保留） |

### 1.1 变更清单（六处，均最小化）

| # | 位置 | 改动 |
|---|---|---|
| 1 | 头部 require | 新增 `const crypto = require('crypto');`（账本 SHA 计算） |
| 2 | 新增 `loadActualExecutionLedger()` | 从 `deliverables/v365-production-history/` 装载**受治理**实际执行账本（只读；缺文件抛 `ACTUAL_LEDGER_MISSING`） |
| 3 | `createCooldownStubDb()` | 由 2 参扩为 3 参，新增 `DECISION_RESULT` 单点回查（`${code}\|${decision_date}` 索引）；⛔ 无受治理数据 ⇒ 返回 `[]`（回落 fallback，**不臆测**） |
| 4 | `computeReplayCooldown()` | 新增 `drIndex` 透传 |
| 5 | `runOneDay()` | 引入 `useCap` / `useCooldown` 协议集；cap 注入与 cooldown 注入改用标志位；**模拟成交块显式限定** `V2-CF-COOLDOWN` / `V2`（⛔ 排除 `V2-AE`） |
| 6 | `replay()` | 新增 `rawProtocol`/`protocol` 别名（`'V2'` → `'V2-CF-COOLDOWN'`）；**账本来源分离**；返回值新增 `protocol_requested` / `ledger_source` / `execution_ledger` |

### 1.2 协议矩阵（本变更后）

| protocol | effective_tech_cap | cooldown | 成交账本 | `ledger_source` | production_fidelity |
|---|---|---|---|---|---|
| `V1` | ⛔ fallback | ⛔ 硬编码 0 | — | — | 历史基线 |
| `V2-CF` | ✅ 生产纯函数 | ⛔ 硬编码 0 | — | — | 部分 |
| `V2-CF-COOLDOWN`（= 别名 `V2`） | ✅ 生产纯函数 | ✅ 生产纯函数 | **决策模拟** | `SYNTHETIC_COUNTERFACTUAL_DECISION_IMPLIED` | ⛔ **false** |
| `V2-AE` | ✅ 生产纯函数 | ✅ 生产纯函数 | **受治理实际执行** | `GOVERNED_ACTUAL_EXECUTION` | 待定（见 §6） |

```
RFP-V2-CF-COOLDOWN  replay_semantics = COUNTERFACTUAL_ASSUMED_EXECUTION_WITH_COOLDOWN
RFP-V2-AE           replay_semantics = ACTUAL_EXECUTION_COOLDOWN__COUNTERFACTUAL_BOOK
```

⛔ **未改**：`nextBook` 语义（仍 `= suggested_position`，属 `RPG-003-PH`）· 任何 production calculation · RDE · 两个门禁 · schema · collection · `constants.js` · `cooldown.js`。

---

## 2. RFP-V1 / RFP-V2-CF Immutability `[PROBE]`

```
RFP-V1    result_sequence_sha = 25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723
expected                      = 25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723   ← 逐位不变 ✅

RFP-V2-CF result_sequence_sha = b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832
expected                      = b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832   ← 逐位不变 ✅
```

**佐证**：`tests/v365-rpg-f2b.test.js` **B-01 / B-02** 断言通过。

⇒ 新增协议分支**未**扰动既有两条协议的任何一位输出。

---

## 3. RFP-V2-CF-COOLDOWN Baseline（synthetic 分支）`[PROBE]`

```
result_sequence_sha = 0db3193b297d2900aa1b32e359bbe80b80bfbf7a5b10ce0bba17a32f41dbe4f5
ledger_source       = SYNTHETIC_COUNTERFACTUAL_DECISION_IMPLIED
synthetic fills     = 9（159582:5 · 513310:2 · 515880:1 · 518880:1）
cooldown > 0 日次    = 18
production_fidelity = false
qualification_authoritative = false
```

**用途（唯一）**：
1. 证明生产 `cooldown` 函数的分支**可被真实行使**（无需人造常量）；
2. 验证 `recommendation → assumed-fill` 情景。

⛔ **不得**进入 production-fidelity anchor。

### 3.1 Interim anchor（§8 六项绑定）

| 字段 | 值 |
|---|---|
| `protocol_version` | `RFP-V2-CF-COOLDOWN` |
| `replay_semantics` | `COUNTERFACTUAL_ASSUMED_EXECUTION_WITH_COOLDOWN` |
| `input_dataset_hash` | `<见 replay-delta-attribution.json>` |
| `production_code_sha` | `<见 replay-delta-attribution.json>` |
| `replay_harness_sha` | `<本文件 sha256>` |
| `result_sequence_sha` | `0db3193b…e4f5` |
| `coverage_manifest_sha` | `<见产物>` |
| `qualification_authoritative` | **false** |
| `production_fidelity` | **false** |

---

## 4. RFP-V2-AE Baseline（actual execution 分支）`[PROBE]`

```
result_sequence_sha = 5c8fb4ae7223abdc4edb9ba8267c2043d4dd22d6688e000415e1a4f1339b661d
ledger_source       = GOVERNED_ACTUAL_EXECUTION
actual fills        = 159570:1 · 159582:3 · 513310:2 · 518880:1（共 7，= 受治理 trade_log 的 BUY 行数）
execution trade_log sha256 = f7a9de03ea10954c0932801ce0075917d13e02d7eb8388bf91c4409b9bb86e9e
governed_data_gate  = PASS
pagination_complete = true
cooldown > 0 日次    = 61
```

### 4.1 受治理实际执行账本 `[AS-IS]`

| 项 | 值 |
|---|---|
| 来源 | `deliverables/v365-production-history/raw/trade_log.ndjson` |
| `actual_date_span` | `2026-08-14` → `2026-09-11` |
| `full_collection_count` | **13**（BUY 7 · SELL 6） |
| `query_filter` | `{}`（无过滤 ⇒ 完整 collection） |
| `pagination_complete` | **true** |
| `actual_min_trade_date` | `2026-08-14` |
| `actual_max_trade_date` | `2026-09-11` |
| `previous_buy_determination` | **`NO_PREVIOUS_EXECUTION_RECORDS_EXIST_IN_SOURCE`** |

> ⚠️ 上项判定的**前提**（三者同时成立才允许）：`export_is_full_collection=true` + `query_filter_empty=true` + `pagination_complete=true`。
> ⛔ 该判定是"**源中确无更早成交**"，**不是**"我假定没有"。

### 4.2 add_mode：生产三步链复现（⛔ 零回填）`[AS-IS]`

生产 `resolveLastBuyAddMode()`（`src/common/utils/cooldown.js:21-29`）：

```
① trade_log.add_mode
      ↓ 受治理实测：ROWS_WITH_ADD_MODE = 0（#1-9 无字段；#10-13 = ""）
② decision_result(code, decision_date = buyDate).add_mode
      ↓ 受治理单点回查（allowlist 扩展，见 §5）
③ fallbackAddMode
```

**受治理单点回查结果**（7 个 buy 点）：

| code | buy_date | rows_found | add_mode | cooldown_days |
|---|---|---|---|---|
| 513310 | 2026-08-14 | 1 | `无` | 3 |
| 159570 | 2026-08-15 | **0** | — | — |
| 159582 | 2026-08-15 | **0** | — | — |
| 518880 | 2026-08-15 | **0** | — | — |
| 513310 | 2026-08-19 | 1 | `无` | 3 |
| 159582 | 2026-08-24 | 1 | `无` | 3 |
| 159582 | 2026-08-28 | 1 | `无` | 3 |

⛔ **不得**为实际成交补写 `突破加仓` / `普通加仓` / `无`。
⛔ **不得**根据当前 replay 决策猜历史 buy 的 add_mode。

**语义观察（`[INFER]`，登记不改）**：`2026-08-15` 三笔买入在 `decision_result` 中**无当日决策行** ⇒ 生产视为**非决策驱动**（`fallbackAddMode`）。这与 `computeCooldownDays` "无 buy 记录 ⇒ 返回 0" 不同：该票在更早日期**确无** BUY（§4.1 已判定），但 `decision_result` 亦无当日记录 ⇒ `add_mode` 走 fallback `'无'` ⇒ 基数 = `cooldown_days = 3`。此为该分支的**真实生产语义**，非缺陷。

### 4.3 Interim anchor（§8 六项绑定）

| 字段 | 值 |
|---|---|
| `protocol_version` | `RFP-V2-AE` |
| `replay_semantics` | `ACTUAL_EXECUTION_COOLDOWN__COUNTERFACTUAL_BOOK` |
| `input_dataset_hash` | `<见 replay-delta-attribution.json>` |
| `production_code_sha` | `<见 replay-delta-attribution.json>` |
| `replay_harness_sha` | `<本文件 sha256>` |
| `result_sequence_sha` | `5c8fb4ae…661d` |
| `coverage_manifest_sha` | `<见产物>` |
| `qualification_authoritative` | **false** |
| 理由 | `RPG-003-PH` 未完成；V2-AE 尚待 owner 批准替代 V1 |

---

## 5. `decision_result` allowlist 扩展（受治理、只读、最小化）`[AS-IS]`

**为什么需要**：§4.2 第 ② 步是生产真实路径的一环；受治理 `trade_log.add_mode` 全空 ⇒ 不回读该集合就**无法**复现生产 cooldown 语义。

| 约束（owner §5） | 履行 |
|---|---|
| **只读** | ✅ 复用 `cloudbase-readonly-client`；结构性**无** mutation 方法（导出面仅 `createReadOnlyClient/loadCredential/checkCredentialFreshness/DEFAULT_ALLOWLIST/DEFAULT_ENV_ID`） |
| **记录为什么需要** | ✅ `provenance/decision_result_cooldown.provenance.json` 的 `reason` + `necessity = REQUIRED_FOR_PRODUCTION_FIDELITY_COOLDOWN` |
| **重新跑 R-03~R-06** | ✅ 已重跑，**全 PASS** |
| **更新 provenance** | ✅ 已生成并含 `file_sha256 = 6e70dcd57b4dedce6af0108d041a1272e017e0f0728cffe16fb03a758cb92ff7` |
| **绝不增加 mutation 方法** | ✅ 导出器源码零 mutation 调用（R-03 实测） |

**读取范围最小化**：

```
mode               = MINIMAL_POINT_LOOKUP
not_a_full_table_export = true
lookup_points      = 7（仅受治理 trade_log 中已出现的 (code, buy_date) 组合）
```

⛔ **未**整表导出 `decision_result`。

---

## 6. RPG-F2-B 生产保真度裁定 `[PROBE]`

### 6.1 已验生产点（正向证据）

用**受治理实际执行账本** + **受治理 `decision_result` add_mode** 复算，与生产 `decision_result.cooldown_days` 逐值对照：

| code | date | actual replay cooldown | 生产 cooldown_days | 结果 |
|---|---|---|---|---|
| 513310 | 2026-08-14 | 3 | 3 | ✅ MATCH |
| 513310 | 2026-08-19 | 3 | 3 | ✅ MATCH |
| 159582 | 2026-08-24 | 3 | 3 | ✅ MATCH |
| 159582 | 2026-08-28 | 3 | 3 | ✅ MATCH |

```
PRODUCTION_PATH_PARITY_VERIFIED_ON_OBSERVED_POINTS = true  （4/4）
```

⛔ **不得**据此自动提升为 `FULL_WINDOW_PRODUCTION_FIDELITY`。

### 6.2 覆盖缺口（反向证据，决定裁定）

```
original replay window      = 2026-08-01 → 2026-09-22   （required_trade_dates = 25）
actual execution 可见起点    = 2026-08-14
```

⇒ **窗口前段 9 个交易日**（`2026-08-03 … 2026-08-13`）**无 actual execution 记录**。
该段 cooldown 恒为生产「无 BUY 命中 ⇒ 返回 0」路径 —— 这**不是保真缺口**（它忠实复现了生产行为），但**亦非 fidelity 覆盖**（没有 actual 成交可供行使）。

### 6.3 裁定 `[HUMAN]`

```
RPG-F2-B = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-002  = NOT YET CLOSED
```

⛔ **不得伪装成 COMPLETE**。
⛔ **不得**以下列任一方式"补足"覆盖：用 `suggested_position` 补 · 用 08-14 snapshot 回推 · 假设之前仓位为 0 · 插值 · 偷改 window。

---

## 7. RPG-F2-C / RFP-V2-PH 状态 `[PROBE]`

```
required_trade_dates        = 25
snapshot_available_dates    = 16
missing_trade_dates         = 9   （2026-08-03 … 2026-08-13）
actual_min_snapshot_date    = 2026-08-14
t_minus_1_candidate         = null    ← ⛔ 不存在合法 T-1 starting actual book
```

⇒ 裁定：

```
RPG-F2-C                      = BLOCKED_ON_ACTUAL_BOOK_COVERAGE
RFP-V2-PH_FULL_WINDOW_AVAILABLE = false
PH_COVERAGE                   = PARTIAL
```

⛔ `RFP-V2-PH-AVAILABLE-WINDOW` 可另建用于**诊断**，但 `qualification_authoritative = false`，
**不得替代**原 `2026-08-01 → 2026-09-22` 的 qualification protocol（除非 owner 另行裁定）。

---

## 8. Delta Attribution（taxonomy 冻结）`[PROBE]`

```
V1 → V2-CF-COOLDOWN : changed = 13（EXPECTED 12 / UNEXPECTED 1）
V1 → V2-AE          : changed = 99（EXPECTED 94 / UNEXPECTED 5）

V1_V2_DELTA_EXPLAINED = false
```

**允许的 reason（冻结）**：`effective_tech_cap_fidelity` · `cooldown_gate_exercised`
⛔ **不得**新增 `cooldown_book_divergence` / `downstream_cooldown_effect` / `historical_cooldown_lineage` 或任何第三类。

**保留的 UNEXPECTED（fail-closed）**：

| 协议 | date | code | field | 变化 |
|---|---|---|---|---|
| V2-CF-COOLDOWN | 2026-08-13 | 159582 | final_action | `HOLD` → `ADD` |
| V2-AE | 2026-08-24 | 513310 | final_action | `HOLD` → `BUILD` |
| V2-AE | 2026-09-02 | 159582 | final_action | `HOLD` → `WAIT` |
| V2-AE | 2026-09-02 | 513310 | final_action | `TACTICAL_REDUCE` → `HOLD` |
| V2-AE | 2026-09-03 | 159582 | final_action | `HOLD` → `WAIT` |
| V2-AE | 2026-09-04 | 159582 | final_action | `HOLD` → `WAIT` |

⛔ **不得**为了得到 `UNEXPECTED_DECISION_DELTA = 0` 而放宽判据。
只有在正确的 actual-execution replay 建立并**重新双跑**后，若某条 delta **自然消失**，方可移除；
仍存在者依实际证据进入**单独的 attribution adjudication**（需 owner 参与）。

---

## 9. 变更流程合规（RPG-F1 §9 五步）`[AS-IS]`

| 步 | 要求 | 本轮 |
|---|---|---|
| ① | explicit human approval（逐位绑定 40 位 SHA） | ✅ `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（owner 2026-09-29 显式授权） |
| ② | old protocol reproducibility check | ✅ §2（V1 **与** V2-CF anchor 均逐位复现） |
| ③ | new protocol validation | ✅ §3 + §4 + §8（B-01~B-12 全 PASS） |
| ④ | new anchor establishment | ✅ §3.1 / §4.3（六项绑定，`qualification_authoritative = false`） |
| ⑤ | qualification documents update | ✅ 本文件 + 机器可读产物 |

---

## 10. Regression `[AS-IS]`

| 项 | 结果 |
|---|---|
| `tests/v365-rpg-f2b.test.js`（B-01~B-12） | **全 PASS**（B-13 待本文件生成后生效） |
| `tests/v365-rpg-f2a.test.js`（A-01~A-10） | **全 PASS** |
| RFP-V1 anchor | **逐位不变**（`25ccbfc7…1723`） |
| RFP-V2-CF anchor | **逐位不变**（`b87654ab…8832`） |
| CALC ∪ MIXED（47 文件） | **零改动** |
| `cooldown.js` / `constants.js` | **零改动**（owner §11 明确未授权项） |
| immutable lock / Gen-1 locked file | **零改动** |

**复现指令**：

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('scripts/lib/v364-replay-harness.js')).digest('hex'))"
node tests/v365-rpg-f2b.test.js
node scripts/v365-rpg-f2b-actual-coverage-audit.js --out deliverables/v365-production-history/rpg-f2b-actual-coverage-audit.json
node scripts/v365-replay-delta-attribution.js
node scripts/tools/cloudbase-readonly-safety-test.js
```

---

## 11. 边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| 生产数据库写入 | **均未发生** |
| 生产 collection 创建 | **未发生** |
| Cloud Function deploy | **未发生** |
| push / PR / merge / tag | **均未发生** |
| 策略计算语义修改 | **未发生** |
| `constants.js` / `cooldown.js` 修改 | **未发生** |
| immutable lock / Gen-1 locked file 修改 | **未发生** |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| 生产侧 `ModTime` | 仍 **UNVERIFIED**（未触网写） |

---

## 12. 完成状态 `[AS-IS]`

```
REPLAY_INFRA_CHANGE_REVIEW_REQUIRED = REPLAY_INFRA_CHANGE_REVIEW_REQUIRED（已声明）
OWNER_REPLAY_INFRA_AUTHORIZED       = true
OWNER_AUTHORIZATION_SHA             = c6bd006fd76ffc5358cddd07347df8ed23d9e61d

AUTHORIZED_TO_IMPLEMENT             = true
QUALIFICATION_AUTHORITY             = false      ← ⛔ 授权 ≠ 资格权威

RFP-V1_REPRODUCIBLE                 = true
RFP-V2-CF_BASELINE_ESTABLISHED      = true
RFP-V2-CF-COOLDOWN                  = SYNTHETIC / COUNTERFACTUAL（production_fidelity = false）
RFP-V2-AE_BASELINE_ESTABLISHED      = true
PRODUCTION_PATH_PARITY_VERIFIED_ON_OBSERVED_POINTS = true（4/4）

RPG-001 = CLOSED
RPG-002 = NOT YET CLOSED
RPG-F2-B = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-F2-C = BLOCKED_ON_ACTUAL_BOOK_COVERAGE
RFP-V2-PH_FULL_WINDOW_AVAILABLE = false

READY_FOR_PRODUCTION_PROMOTION = NOT_ISSUED
```

⛔ 最终仍须满足下列**全部**条件，方可考虑 `READY_FOR_PRODUCTION_PROMOTION`：

```
UNEXPECTED_DECISION_DELTA = 0
RFP-V2-PH full required window available
Full Requalification PASS
Freeze Review PASS
```

**当前不得输出 READY。**
