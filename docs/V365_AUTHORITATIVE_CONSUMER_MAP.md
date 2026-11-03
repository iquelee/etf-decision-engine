# AUTHORITATIVE_CONSUMER_MAP — V3.6.5 B0 审计

> 目的（任务书 §3）：在实施 active pointer 之前，先找出**全部**读取
> `decision_result` / `portfolio_snapshot` / `portfolio_position` / `runtime_status`
> 的生产消费者，并回答：
>
> **«如果 writer 使用 `active_run_id`，而 reader 仍直接读旧 collection 最新文档，
> 会不会破坏 P-3 的 atomicity？»**
>
> 本轮性质：**只读审计 + 设计**。⛔ 未修改任何 consumer（reader migration 未落地）。

审计方式：`grep` 常量名与真实集合字符串 + 逐文件通读；字段数由 `Object.keys(schema.fields)` **实跑**取得。
引用格式 `file:line`。`dist-functions/**` 是 `cloudfunctions/**` 的构建镜像，逐字节同逻辑，不重复列出。

---

## A. 集合与常量

| 集合常量 | 真实字符串 | schema 字段数 | 定义位置 |
|---|---|---|---|
| `COLLECTIONS.DECISION_RESULT` | `decision_result` | **94** | `src/common/constants.js:26`；schema `src/common/schema.js:261-374` |
| `COLLECTIONS.PORTFOLIO_SNAPSHOT` | `portfolio_snapshot` | **32** | `src/common/constants.js:25`；schema `src/common/schema.js:220-259` |
| `COLLECTIONS.PORTFOLIO_POSITION` | `portfolio_position` | **23** | `src/common/constants.js:24`；schema `src/common/schema.js:189-218` |
| `COLLECTIONS.RUNTIME_STATUS` | `runtime_status` | **27** | `src/common/constants.js:29`；schema `src/common/schema.js:613-645` |

**日期语义（决定混合暴露面）**
- `decision_result.decision_date` = **数据最新日**（`cloudfunctions/runDecisionEngine/index.js:521`、写入 `:951`）
- `portfolio_snapshot.snapshot_date` = **北京时间「今天」**（`runDecisionEngine/index.js:1048`）
- `portfolio_position` **无日期键**，只有 `updated_at`（每 code 单文档，**可变当前状态**）

---

## B. 读取点全清单

| # | 消费者 | 位置 | 集合 | 读取方式（原样） | 跨集合组合 | authoritative? |
|---|---|---|---|---|---|---|
| 1 | `apiGateway.getDashboard` | `cloudfunctions/apiGateway/index.js:131-137` | runtime_status | `db.query(RUNTIME_STATUS, { key: 'runtime-status' }, { limit: 1 })` | 是 | **是** |
| 2 | `apiGateway.getDashboard` | `apiGateway/index.js:142` | portfolio_position | `db.query(PORTFOLIO_POSITION, {})` | 是 | **是** |
| 3 | `apiGateway.getDashboard` | `apiGateway/index.js:161-163` | portfolio_snapshot | `db.query(..., {}, { orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 1 })` | 是 | **是** |
| 4 | `apiGateway.getDashboard` | `apiGateway/index.js:171` → `db.getLatestDecision` (`db.js:259-264`) | decision_result | `{ code }` + `decision_date desc` + `limit: 1`（**逐票最新**） | 是 | **是** |
| 5 | `apiGateway.getEtfList` | `apiGateway/index.js:345` → `db.getLatestDecision` | decision_result | 同上 | 是 | **是** |
| 6 | `apiGateway.getEtfList` | `apiGateway/index.js:342` | portfolio_position | `db.query(PORTFOLIO_POSITION, {})` | 是 | **是** |
| 7 | `apiGateway.getEtfDetail` | `apiGateway/index.js:399` → `db.getLatestDecision` | decision_result | 同上 | 是 | **是** |
| 8 | `apiGateway.getEtfDetail` | `apiGateway/index.js:402` → `db.getPosition` (`db.js:282-285`) | portfolio_position | `{ code }` + `limit: 1` | 是 | **是** |
| 9 | `apiGateway.getPortfolio` | `apiGateway/index.js:517` | portfolio_position | `db.query(PORTFOLIO_POSITION, {})` | 是 | **是** |
| 10 | `apiGateway.getPortfolio` | `apiGateway/index.js:518-520` | portfolio_snapshot | `orderBy snapshot_date desc, limit 1` | 是 | **是** |
| 11 | `apiGateway.getConstants` | `apiGateway/index.js:950` | runtime_status | `{ key: 'runtime-status' }` | 否 | **是**（引擎版本单一真相） |
| 12 | `apiGateway.getDecisions` | `apiGateway/index.js:507-510` | decision_result | 日期范围 + `decision_date desc`，limit 60/500 | 否 | 历史展示 |
| 13 | `apiGateway.getReview` | `apiGateway/index.js:609-611` | decision_result | 日期范围 + `decision_date desc`，limit 500 | 是 | 审计/复盘 |
| 14 | `apiGateway.getReview` | `apiGateway/index.js:617-619` | portfolio_snapshot | `orderBy snapshot_date desc`，limit 200 | 是 | 审计/复盘 |
| 15 | `adminGateway.getGen1Health` | `adminGateway/index.js:57` | runtime_status | `{ key: 'runtime-status' }`（`.catch(()=>[])`） | 是 | 诊断 |
| 16 | `adminGateway.getGen1Health` | `adminGateway/index.js:73-75` | decision_result | 逐票最新 | 是 | 诊断 |
| 17 | `adminGateway.persistLiveSnapshot` | `adminGateway/index.js:802/806-808/817` | snapshot/position | 按当日 key + 最新快照 + 全量 position | 是 | 诊断/写路径 |
| 18 | `adminGateway.autoSyncPosition` | `adminGateway/index.js:888-890/922/929` | snapshot/position | 快照 30 条 + position | 是 | 诊断/写路径 |
| 19 | `adminGateway.savePortfolioSnapshot` | `adminGateway/index.js:1003/1005` | snapshot/position | 当日 key + 全量 position | 是 | 诊断/写路径 |
| 20 | `runDecisionEngine`（引擎自身读输入） | `runDecisionEngine/index.js:499` | portfolio_position | `db.query(PORTFOLIO_POSITION, {})` | 是 | **是（决策输入）** |
| 21 | `runDecisionEngine` | `runDecisionEngine/index.js:1049-1051` | portfolio_snapshot | `orderBy snapshot_date desc`，limit 30 | 是 | **是（现金种子）** |
| 22 | `runDecisionEngine` | `runDecisionEngine/index.js:1094` | portfolio_position | 写快照前重读 | 是 | **是** |
| 23 | `runIntegratedShadowEod.loadInputs` | `runIntegratedShadowEod/index.js:220` | decision_result | `{ decision_date: anchor }` **精确取** | 是 | 诊断（反事实） |
| 24 | `runIntegratedShadowEod.loadInputs` | `runIntegratedShadowEod/index.js:222-224` | decision_result | **全表最新一条**（limit 1） | 是 | 诊断 |
| 25 | `runIntegratedShadowEod` | `runIntegratedShadowEod/index.js:297` | runtime_status | `{ key: 'runtime-status' }` | 是 | 诊断 |
| 26 | `runGen1ShadowEod.latestMarketRegime` | `runGen1ShadowEod/index.js:81-83` | portfolio_snapshot | `orderBy snapshot_date desc, limit 1`（只取 `market_regime`） | 是 | 诊断 |
| 27 | `db.js` `getLatestDecision` / `getPosition` | `db.js:259-264` / `282-285` | decision/position | 机制函数 | — | 机制 |
| 28 | `cooldown.js` `resolveLastBuyAddMode` | `src/common/utils/cooldown.js:25` | decision_result | `{ code, decision_date: buyDate }` **精确复合 key** | 否 | **是**（冷静期） |
| 29 | `scripts/migrate-position-engine.js` | `:46` | portfolio_position | 离线全量 | 否 | 离线运维 |
| 30 | `scripts/gen1-ui-samples.js` | `:85-86/91` | decision/position | stub 数据集 | 否 | 离线 fixture |

**未读取这 4 个集合的云函数**（逐个确认）：`extractFundamental`、`fetchDailyData`、`fetchFundamentalNews`、`fetchRealtimeData`、`materializeIndicators`、`runGen2ShadowEod`。

**前端**：`web/` 下**无任何直接读集合**的代码，全部经 HTTP 调 `apiGateway` / `adminGateway`
（`web/src/api/request.js:76-168`）⇒ **reader migration 可全部在服务端完成，前端无需发版**。

---

## C. 跨集合组合点（partial publication 暴露面）

1. **`apiGateway.getDashboard`（`index.js:140-337`）— 最大暴露面**。独立读 `portfolio_position`(#2)
   + `portfolio_snapshot` 最新(#3) + 逐票 `decision_result` 最新(#4) + `runtime_status`(#1)，
   然后把 `decision.final_target/action` 与 `portSnapshot.total_asset/cash_ratio` 拼进**同一张标的卡**
   （`:220-255`、`:314-334`）。**无 run 绑定** ⇒ 写入侧部分失败时，前端显示「N 新 + 其余旧」的混合组合。
2. `apiGateway.getEtfList`（`:340-391`）：`portfolio_position` + 逐票 `decision_result` 组合。
3. `apiGateway.getEtfDetail`（`:394-473`）：`position` + `decision` + `runtime_status`，另叠加
   `indicator_snapshot`（`calc_date` 语义）⇒ 同页并存两套日期语义。
4. `apiGateway.getPortfolio`（`:515-591`）：`:569-574` **显式**以实时 position 覆盖快照字段。
5. `apiGateway.getReview`（`:594-684`）：历史 decision 500 条 + snapshot 200 条 + `trade_log`。
6. `adminGateway.getGen1Health`（`:53-188`）：`runtime_status` + 逐票 decision + `gen1_health_state` + `ml_shadow_signal`。
7. `runIntegratedShadowEod.loadInputs`（`:194-249`）：以 Gen-2 `as_of_trade_date` 为锚强制同日（`TRADE_DATE_MISMATCH` 网关）。
8. `runDecisionEngine`（`:491-`）自身：读 position + snapshot 30 条 + indicator_snapshot；写快照前再读 position。
9. `runGen1ShadowEod.latestMarketRegime`（`:79-88`）：把 snapshot 的 `market_regime` 并入信号行（诊断级）。

---

## D. 对 `active_run_pointer` 的逐消费者影响

**前提事实**：`db.upsert` 是「先 `where` 查、再 `doc.update`/`collection.add`」**两步**（`src/common/utils/db.js:89-105`），
全仓**无 `runTransaction` 调用** ⇒ 四个集合之间**不存在跨集合事务**。
（平台**有** `Db.runTransaction` 能力：`@cloudbase/node-sdk@2.11.0 types/index.d.ts:467-468` —— 但当前代码未用。）

| 消费者 | 会读到 candidate / 混合数据？ | 最小迁移改法 | 能否安全迁移 |
|---|---|---|---|
| #1#2#3#4（getDashboard） | **YES**（跨 run 混合） | 顶部读 pointer → 按 `run_id` 取该 run 的 decision/portfolio | 能（服务端） |
| #5#6（getEtfList） | **YES** | 同上 | 能 |
| #7#8（getEtfDetail） | **YES** | 同上 | 能 |
| #9#10（getPortfolio） | **YES** | 同上；position 走 current-state 语义 | 能 |
| #11（getConstants） | **NO**（单文档 `key` 取，不会读到 candidate） | 可选：回显 `active_run_id` | 能（低优先） |
| #12#13#14（getDecisions / getReview） | **YES**（跨 run/跨日期） | 单指针不覆盖历史 range ⇒ 保留 append-only 历史 + 每条打 `run_id` | **需 `run_id` 索引，单指针不足** |
| #15#16（getGen1Health） | **YES** | 读 pointer → 按 `run_id` 取 decision | 能 |
| #17#18#19（adminGateway 写路径） | **YES（弱）** | 属**可变当前状态**，不应用 run 指针 | **不适用（另一条轴）** |
| #20#21#22（runDecisionEngine 读输入） | **YES（弱）** | 同上：position / cash 是 current-state | **不适用（另一条轴）** |
| #23#24#25（runIntegratedShadowEod） | **YES** | 需「覆盖 anchor 的 run」⇒ 单指针不够 | **需 run 历史索引** |
| #26（runGen1ShadowEod） | **YES（弱）** | 随 run 读取或标注来源 run | 能（低优先） |
| #27（db.js helper） | 按构造 YES | 新增 `getActiveDecision(code, runId)`；旧函数标 deprecated | 能（内部） |
| #28（cooldown） | **NO**（精确复合 key） | 保留（读的是已提交历史） | 能 |
| #29#30（离线脚本） | N/A | 无需迁移 | 不适用 |

---

## E. 结论（必须回答 §3 的那个问题）

### E.1 会不会破坏 P-3 的 atomicity？→ **YES**（在当前 reader 不变的前提下）

`portfolio_position` / `portfolio_snapshot` / `decision_result` 三者**独立「取最新」**、
**无 run 绑定、无跨集合事务** ⇒ 切换窗口内前台可拼出「新 decision + 旧 snapshot」的混合组合。
**因此本轮不得声称 P-3 已生产落地。**

### E.2 是否有**无法安全迁移**的消费者？→ **有，分两类**

1. **需要 run 历史索引、单指针不足**（非阻塞，但需额外设计）：
   - `apiGateway.getDecisions`（`:507`）/ `getReview`（`:609`、`:617`）— 历史 range 读取
   - `runIntegratedShadowEod.loadInputs`（`:220`、`:222`）— 需「覆盖某 as_of 日的 run」
   - `cooldown.resolveLastBuyAddMode`（`cooldown.js:25`）— 按历史买入日精确取
2. **属于「当前可变状态」轴，不是 run 产物**（**必须显式声明**，不得用 run 指针描述）：
   - `portfolio_position` 全体读取（#2#6#8#9#15#17#18#19#20#22）
   - 现金种子 / `portfolio_snapshot` 的资产字段（#10#21）

> ⚠️ 按「同轴」纪律：`portfolio_position`（可变状态）与 run 输出（不可变产物）是**两条轴**。
> 把它们合成「单 run 快照」是设计错误，不是实现疏漏。

### E.3 判定：`STOP_B1_ATOMIC_WIRING`？→ **不触发（有条件放行）**

理由：
- **authoritative 读取点全部在服务端**（`web/` 不直连集合）⇒ 迁移**技术可行**；
- 不存在「技术上无解」的消费者 —— E.2 第 1 类是**设计缺口**（需 run 历史索引），第 2 类是**不同轴**（不属 run atomicity 范畴）。

**但附三条硬约束**（任一不满足即必须回退为 STOP）：
1. **active pointer 生效之前，5 个 authoritative 端点必须先迁移**（`getDashboard`/`getEtfList`/`getEtfDetail`/`getPortfolio`/`getConstants`）；
2. `portfolio_position` 的语义必须在文档与字段名上与 run 产物**显式区隔**（不得声称「单 run 快照」）；
3. 历史 range / Gen-2 anchor / cooldown 的「run 历史索引」作为**独立工作包**立项，⛔ 不得用单指针糊过去。

---

## F. 最小 reader migration 方案

```
read active_run_pointer(scope='production')
  → run_id
  → read run_candidate_decision / run_candidate_portfolio where run_id = ?
```
⛔ 不得 `orderBy(updated_at|decision_date|snapshot_date desc).limit(1)` 猜当前权威结果。

参考实现（**本轮已提供，未接线**）：`src/common/utils/v365-active-read.js`
- `resolveActivePointer(store, scope)`
- `readActiveRunDataset(store, { scope, expected_codes })`
- `planCompatibilityProjection(...)` —— 并**诚实声明**：多文档投影本身不是原子的，
  **不能替代 reader migration**（`projection_window_risk: true`）。
- `scanForbiddenReads(sourceText, label)` —— 把上述禁止形态机器化，使迁移进度可被测试/CI 持续跟踪。

---

## 附：本文件的性质

- 本文是 **B0 只读审计产物**（`docs/` 下，随 V365 candidate 分支提交）。
- **未修改任何 consumer**；reader migration 仍是 **PENDING**。
- 因此 **`ATOMIC_PUBLISH` 尚未在生产成立** —— 与 §10 的 `ATOMIC_PROMOTION_BLOCKED` 一致。

---

## G. 后续状态更新（WP-V365-RM 落地后，2026-09-24 追加）

> ⚠️ **本节为追加，不改动上文 A–F 的任何历史结论**（上文仍是当时的只读审计快照）。

| 上文结论 | 现状 |
|---|---|
| §E.1「会不会破坏 P-3 atomicity？→ **YES**（reader 不变的前提下）」 | 前提已消除：5 个 authoritative 端点 + `getGen1Health` 已迁到 pointer 路径 |
| §E.3 硬约束 #1「pointer 生效前 5 个端点必须先迁移」 | ✅ **已完成**（`getDashboard`/`getEtfList`/`getEtfDetail`/`getPortfolio`/`getConstants`） |
| §E.3 硬约束 #2「`portfolio_position` 必须与 run 产物显式区隔」 | ✅ 已落为**两条轴 + 各自 provenance**，并加测试断言（`mutable_axis` 不带 `run_id`） |
| §E.3 硬约束 #3「历史 range / Gen-2 anchor / cooldown 另立工作包」 | ✅ 已登记为 **`RUN_HISTORY_INDEX_REQUIREMENTS`**；**WP-RH1~RH4 代码侧已完成**（契约 / 写侧 / 读者）+ **HD-10 结构侧已完成**（5 集合 + 7 索引），⚠️ **数据侧仍 PENDING**（5 集合 `n=0` + 无生产提升） |
| §F「参考实现（**本轮已提供，未接线**）」 | ✅ 已接线；正式 API 见 `docs/V365_READER_MIGRATION.md` §2 |

**详细迁移文档**：`docs/V365_READER_MIGRATION.md`
（READER_MIGRATION_TARGETS / 30 个读取点分类 / resolver 协议 / 双轴模型 / RM-01~RM-10 结果 /
deferred 清单 / RUN_HISTORY_INDEX_REQUIREMENTS / Reader Gate 8 项）

```
V365_IMPLEMENTATION = QUALIFIED_CANDIDATE   （资格门 PASS 38 / 38；⛔ ≠ PRODUCTION AUTHORIZED）
READER_MIGRATION    = COMPLETE
RUN_HISTORY_INDEX   = PENDING
  · 契约（RH1）✅ · 写侧（RH2/RH3）✅ · 读者（RH4）✅ · 结构（HD-10 建表）✅ · 数据侧 ⛔（无生产提升 ⇒ run_axis_available=false）
  · HD-10 ✅ COMPLETE（5/5 集合 + 7/7 索引；CREATE EMPTY STRUCTURE ONLY；documents_written=0）
ATOMIC_PUBLISH 在生产成立？→ 仍未成立（writer 已 QUALIFIED，但 V3.6.5 尚未部署）
```
