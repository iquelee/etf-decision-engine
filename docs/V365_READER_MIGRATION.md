# V3.6.5 — Authoritative Reader Migration（WP-V365-RM）

> **性质**：把「当前 authoritative 决策结果」的生产 reader 从
> `orderBy(...desc).limit(1)`（猜最新）迁到 **`active_run_pointer` → 单请求 pin 住 run_id → 只读该 run**。
> 前置：`docs/V365_AUTHORITATIVE_CONSUMER_MAP.md`（B0 只读审计）为权威起点。
> ⛔ 本轮不 deploy / 不 push / 不 PR / 不 merge / 不 freeze；⛔ 未实现 Run History Index。

---

## 1. READER_MIGRATION_TARGETS（精确 5 个端点）

consumer map §E.3 硬约束 #1 要求「active pointer 生效之前，5 个端点必须先迁移」。**重新核实后的真实名称**：

| # | 端点 | 文件 | function | 迁移前的权威读法 |
|---|---|---|---|---|
| 1 | `GET /api/dashboard` | `cloudfunctions/apiGateway/index.js` | `getDashboard` | `db.getLatestDecision(code)`（逐票 `decision_date desc limit 1`）+ `portfolio_snapshot` latest |
| 2 | `GET /api/etf/list` | `cloudfunctions/apiGateway/index.js` | `getEtfList` | 同上 |
| 3 | `GET /api/etf/:code` | `cloudfunctions/apiGateway/index.js` | `getEtfDetail` | 同上 + `portfolio_position` |
| 4 | `GET /api/portfolio` | `cloudfunctions/apiGateway/index.js` | `getPortfolio` | `portfolio_snapshot` latest |
| 5 | `GET /api/constants` | `cloudfunctions/apiGateway/index.js` | `getConstants` | `runtime_status`（**按 key 取单文档，不泄漏**） |

**额外迁移的 CLASS A 消费者**（超出被点名的 5 个，理由见 §3）：

| 端点 | 文件 | function | 说明 |
|---|---|---|---|
| 后台 Control Center 的 Gen-1 健康表 | `cloudfunctions/adminGateway/index.js` | `getGen1Health` | 对 `decision_result` 取最新 ⇒ 同一 run-bound 集合，会看到混 run 决策 |

---

## 2. 迁移协议（Authoritative Read Resolver）

```
endpoint
  ↓  resolveAuthoritative(codes)  ← 一次请求只调一次
Authoritative Read Resolver  (src/common/utils/v365-active-read.js)
  ↓  读**一次** active_run_pointer（pin）
pinned run_id
  ↓  listCandidates(run_candidate_decision, run_id)
  ↓  getCandidate(run_candidate_portfolio, run_id, 'portfolio')
  ↓  getManifest(run_id)
coherence guard → 完整性 → 返回
```

**公开 API**（`v365-active-read.js`）：

| API | 职责 |
|---|---|
| `readAuthoritativeDataset(store, {scope, expected_codes, require_portfolio})` | **唯一入口**：pin + 三类读取 + coherence + 完整性 + fail-closed |
| `readActiveDecision(store, {code})` | 单票薄封装（仍走同一 pinning 协议） |
| `checkRunCoherence({active_run_id, decisions, portfolio, manifest})` | Reader Consistency Guard（§11） |
| `buildAuthoritativeProvenance(ds)` | decision 轴 provenance（additive） |
| `buildMutableStateProvenance({rows})` | mutable 轴 provenance（additive） |
| `AUTH_READ_STATUS` / `AUTH_READ_REASON` | fail-closed 状态与细因枚举 |
| `READER_CLASS` / `ALLOWED_LATEST_READS` / `scanForbiddenReads` | 分类与**机器可判定**的迁移扫描器 |

### 2.1 active pointer read protocol（§5/§6）

- **唯一 authoritative selector = `active_run_pointer.run_id`**。
- ⛔ 禁止用 `orderBy(updated_at|decision_date|snapshot_date desc).limit(1)` 决定「当前正式结果」。
- 所有 run-bound 读取显式绑定 `run_id = active_run_id`（同一次读取内**同一个** run_id）。

### 2.2 single-request run pinning（§15）

`readAuthoritativeDataset` **只读一次 pointer**，之后全程用同一个 `pinned run_id`。
⇒ 一次 response 要么**完整 A**、要么**完整 B**；⛔ 绝不出现 `decision=A + snapshot=B`。
（测试以「计数 store」断言 `getPointer` 调用数**恰为 1**。）

### 2.3 fail-closed（§10）

| 情况 | 状态 | 细因 |
|---|---|---|
| pointer 缺失 | `AUTHORITATIVE_READ_UNAVAILABLE` | `NO_ACTIVE_POINTER` |
| pointer 指向不存在的 run | 同上 | `POINTER_TARGET_RUN_NOT_FOUND` |
| run 数据不完整（缺票/缺 portfolio） | 同上 | `RUN_DATA_INCOMPLETE` |
| 读异常 | 同上 | `READ_ERROR` |
| run-bound 记录 run_id 不一致 | `READ_COHERENCE_FAILURE` | `RUN_ID_MISMATCH` |

⛔ **一律不 fallback 到 latest document**；结果对象固定带 `latest_fallback_used: false` + `fail_closed: true`。
⚠️ 「显示上一笔 active」只在 **pointer 自身仍指向那笔**时成立 —— reader **不推断**上一笔是谁。

### 2.4 Reader Consistency Guard（§11）

一次 response 内所有 run-bound 记录（5 票 decision + portfolio + manifest）必须共享
`run_id == active_run_id`；任一 mismatch ⇒ `READ_COHERENCE_FAILURE`，**不得拼装返回**（`decisions=[]`, `portfolio=null`）。

---

## 3. 30 个读取点的最新分类

### CLASS A — CURRENT_AUTHORITATIVE（**必须迁移**）

| # | 消费者 | 集合 | 状态 |
|---|---|---|---|
| 1 | `apiGateway.getDashboard` | runtime_status（按 key 单文档） | ✅ 已接 resolver + provenance |
| 3 | `apiGateway.getDashboard` | portfolio_snapshot(**run 产物部分**) | ✅ 已迁（run 轴） |
| 4 | `apiGateway.getDashboard` | decision_result | ✅ 已迁 |
| 5 | `apiGateway.getEtfList` | decision_result | ✅ 已迁 |
| 7 | `apiGateway.getEtfDetail` | decision_result | ✅ 已迁 |
| 10 | `apiGateway.getPortfolio` | portfolio_snapshot(**run 产物部分**) | ✅ 已迁（run 轴） |
| 11 | `apiGateway.getConstants` | runtime_status（不泄漏） | ✅ 已接（pointer provenance） |
| 16 | `adminGateway.getGen1Health` | decision_result | ✅ 已迁（仅换来源；**Gen-1 Authority 不变**） |
| 20–22 | `runDecisionEngine`（**写路径**） | portfolio_position / snapshot 现金种子 | ⛔ 不适用 —— 见 CLASS B |

### CLASS B — CURRENT_MUTABLE_STATE（**保留独立轴，不得强塞 run_id**）

| # | 消费者 | 集合 | 处置 |
|---|---|---|---|
| 2, 6, 8, 9, 15, 17, 18, 19, 20, 22 | 各处 | `portfolio_position` | 保留原语义（`v365-reader-allow:mutable-axis` 显式登记） |
| 3, 10, 21 | dashboard / portfolio / 引擎现金种子 | `portfolio_snapshot` 的**用户维护资产字段** | 保留原语义（另一条轴） |

**字段级审计结论**（决定上面这条切分的关键证据）：

`portfolio_snapshot` 是一个**混合体**，两类写入者语义不同：

| 字段 | 引擎（run 产物） | `adminGateway.savePortfolioSnapshot`（用户维护） | 归类 |
|---|---|---|---|
| `snapshot_date` | 运行日 | 北京「今天」 | run 轴（引擎值优先） |
| `market_regime` / `strategic_cash` / `deployable_cash` / `semi_position` / 诊断字段 | ✅ 计算产出 | 不写 | **run 轴** |
| `total_asset` / `cash_balance` / `total_pnl` / `asset_source` / `auto_pnl` / `holdings_mv` | 由 live/manual 资产推导 | ✅ 手工维护 | **可变轴** |
| `tech_position` / `gold_position` / `drug_position` / `cash_ratio` | 由 run 的 intended 持仓推导 | 由**实际**持仓推导 | 双写；现有代码**已优先后者**（`getPortfolio:570-574`） |

⇒ 兼容投影 `projectCompatSnapshot(runPortfolio, mutableLatest)`：**run 轴供决策字段、可变轴供资产字段**；
⛔ 这不是「大一统 snapshot」，两条轴的时间语义不同（provenance 分别标注）。

### CLASS C — HISTORICAL / RANGE（**本轮只标记，不实现**）

见 §4。

### 不属于以上三类的机制/离线消费者

| # | 消费者 | 处置 |
|---|---|---|
| 27 | `db.js::getLatestDecision` / `getPosition` | 保留为**机制函数**；authoritative 端点不再调用（`getLatestDecision` 现仅被非权威消费者使用） |
| 29, 30 | `scripts/migrate-position-engine.js` / `gen1-ui-samples.js` | 离线运维 / fixture，N/A |

---

## 4. Historical readers deferred 清单（§13）

| consumer | query purpose | required time range | lookup key | 现用集合/索引 | 需要的 run-history 能力 |
|---|---|---|---|---|---|
| `apiGateway.getDecisions`（`:667`） | 逐票历史决策序列展示 | 用户选中区间（默认 60 条 / 最长 500） | `code` + `decision_date` 范围 | `decision_result`（`decision_date` 排序） | **按 run 分组的历史索引**；每条须带 `run_id`；支持「按 code + 日期区间 枚举 run」 |
| `apiGateway.getReview`（`:776`/`:784`） | 复盘：历史决策 + 历史快照 + 成交 | 区间，limit 500 / 200 | `decision_date` / `snapshot_date` 范围 | `decision_result` / `portfolio_snapshot` | 同上；且需 `portfolio_snapshot` **按 run_id 取**（而非按日期） |
| `runIntegratedShadowEod.loadInputs`（`:220`/`:222`） | 以 Gen-2 `as_of_trade_date` 为锚做反事实 | 指定单一 as_of 日 | `decision_date == anchor`（精确）+ 全表最新 | `decision_result` | **「覆盖某 as_of 日的 run」查询**：`(expected_trade_date) → run_id` 反向索引 |
| `cooldown.resolveLastBuyAddMode`（`cooldown.js:25`） | 冷静期：查上次买入日决策 | 单个历史日期 | `{code, decision_date}` 复合 key | `decision_result`（精确 key） | 需能解析「该历史日属于哪个 run」（否则历史日与 run 的对应关系丢失） |
| `runGen1ShadowEod.latestMarketRegime`（`:81-83`） | shadow 信号行标注当日 regime（诊断） | 最新一条 | `snapshot_date desc limit 1` | `portfolio_snapshot` | 低优先：run 轴读出或标注来源 run |

### 4.1 RUN_HISTORY_INDEX_REQUIREMENTS

```
目的：单指针只能回答「当前 authoritative run 是谁」；
      上面 5 类消费者问的是「某个历史日 / 某个区间 属于哪个 run」⇒ 单指针**结构上不够**。

最小能力集：
  RH-1  run 目录索引：{ expected_trade_date, run_id, revision, status, supersedes_run_id, supersedes_by }
        —— 支持「按日期区间枚举 run」与「同日多 revision 的 supersede 链」
  RH-2  run → 数据集反向索引：{ run_id → 该 run 的 decision codes / portfolio 是否存在 }
        —— 支持「只返回**该 run 完整**的历史条目」（避免历史读者拼出半 run）
  RH-3  历史读取仍须 fail-closed：索引缺失某日 ⇒ 显式 UNKNOWN，⛔ 不得回退「当天任意最新文档」

⛔ 本轮禁止用 `active_run_pointer` 临时替代历史索引（§三）。
```

---

## 5. Dashboard 双轴模型（§7）

```
Authoritative axis（不可变 run 产物）        Mutable axis（持续变化的现实状态）
  selector = active_run_pointer.run_id         selector = 自身 updated_at
  ├─ decision（逐票，来自 run）                 ├─ portfolio_position（实际持仓/分级/慢变量）
  ├─ portfolio（run 产出的组合字段）             └─ portfolio_snapshot 的用户维护资产字段
  └─ run status（manifest：COMPLETE/校验状态）
```

`getDashboard` / `getPortfolio` / `getEtfList` / `getEtfDetail` 的 response 新增两个 **additive** 键：

```jsonc
"authority": {                       // decision 轴
  "status": "OK | AUTHORITATIVE_READ_UNAVAILABLE | READ_COHERENCE_FAILURE",
  "available": true,
  "reason": null,
  "active_run_id": "...", "active_revision": 2, "expected_trade_date": "2026-09-23",
  "engine_version": "v3.6.5", "input_hash": "...", "finality_status": "COMPLETE",
  "decision_as_of_run_id": "...",    // ★ 明确：决策是什么时候的
  "decision_axis_selector": "active_run_pointer.run_id",
  "latest_fallback_used": false
},
"mutable_axis": {                    // 现实持仓轴
  "position_as_of_current_state": true,
  "position_updated_at": "2026-09-24T09:30:00Z",
  "position_source": "portfolio_position(current mutable state, admin/trade-maintained)",
  "mutable_axis_note": "本轴由用户/成交回写维护，与 decision run 不是同一时间轴；⛔ 不得表述为「单 run 快照」"
}
```

⛔ 两轴**不得合成一句**；⛔ `mutable_axis` **不带 `run_id`**（否则会被误读为 run 产物）——
测试对此有显式断言。

⚠️ `adminGateway.getGen1Health` 的 provenance 刻意命名为 **`authoritative_read`**：
该 response **已有** `authority` 键（= **Gen-1 Authority 真相**），两者**同名不同义**，不得合并或互相推断。

---

## 6. Legacy 兼容策略（§9）

- **外部 API 尽量保持 shape 兼容**：5 个端点的全部 legacy 字段逐字保留（门禁按端点校验字段清单）。
- reader **内部**换成 pointer-based source；外部只**新增** provenance。
- `web/` 不直连集合（全部经 `apiGateway`/`adminGateway`）⇒ **前端无需发版**。
- ⚠️ **无法做到兼容的一点必须显式说明**：生产当前**尚无 `active_run_pointer`**
  ⇒ 迁移后这些端点的 decision 轴返回 `AUTHORITATIVE_READ_UNAVAILABLE`（shape 不变，内容为 fail-closed）。
  这是**有意的**（§10 要求 fail-closed）；⚠️ **在 V3.6.5 完成部署前，前端会看到 decision 轴不可用**。

---

## 7. 验证结果

### 7.1 RM 矩阵（`tests/v365-reader-migration.test.js`，19/19 PASS）

| 用例 | 要求 | 结果 |
|---|---|---|
| RM-01 | pointer=B，库中 A/B/C ⇒ 只返回 B | ✅ |
| RM-02 | 最新写入是 candidate C，pointer 仍 B ⇒ 返回 B | ✅ |
| RM-03 | B 完整、C partial ⇒ 仍返回 B | ✅ |
| RM-04 | decision/portfolio/manifest 同 run ⇒ coherence PASS（检查 7 条） | ✅ |
| RM-05a | coherence guard 单元：混 run ⇒ `READ_COHERENCE_FAILURE` | ✅ |
| RM-05b | 端到端：store 返回跨 run 记录 ⇒ fail-closed、不拼装 | ✅ |
| RM-05c | ★ 保真：内存与 cloudbase 适配器 `putCandidate` 盖章字段一致 | ✅ |
| RM-06 | pointer 缺失 ⇒ fail-closed，⛔ 无 latest fallback | ✅ |
| RM-07 | pointer 指向不存在 run ⇒ fail-closed | ✅ |
| 补充 | run 数据不完整 ⇒ `RUN_DATA_INCOMPLETE` | ✅ |
| RM-08 | 双轴：decision 轴=B run、position 轴=current mutable state | ✅ |
| RM-09 | 5 端点 legacy 响应字段未丢失 | ✅ |
| RM-09b | API-level parity：pointer 路径业务字段与 legacy 逐位一致；新增键**只有** provenance | ✅ |
| RM-10 | candidate 写入发生在请求过程中 ⇒ pointer 未切则始终看到旧 active | ✅ |
| §15 | 单请求 pinning：`getPointer` 调用数 = 1；⛔ 无 `decision=A + snapshot=B` | ✅ |
| §15b | 读 error 也 fail-closed | ✅ |
| G.1–G.3 | 源级断言（5 端点均接 resolver、扫描器可判定、轴白名单齐备） | ✅ |

### 7.2 Reader Gate（`scripts/v365-reader-migration-gate.js`，**8/8 PASS**）

`AUTHORITATIVE_ENDPOINTS_MIGRATED` · `NO_LATEST_QUERY_AS_AUTHORITY` · `SINGLE_REQUEST_RUN_PINNING` ·
`CROSS_COLLECTION_RUN_COHERENCE` · `CANDIDATE_INVISIBLE_BEFORE_PROMOTION` · `MISSING_POINTER_FAIL_CLOSED` ·
`MUTABLE_STATE_AXIS_PRESERVED` · `LEGACY_RESPONSE_COMPATIBILITY`

⇒ `READER_MIGRATION = COMPLETE`（⛔ ≠ PRODUCTION AUTHORIZED）。

### 7.3 本轮发现的真实缺陷（已修）

1. ★ **双适配器语义偏离**：内存适配器 `putCandidate` **不盖章** `run_id`/`candidate_key`/`written_at`，
   而 cloudbase 适配器盖章。coherence guard 恰好依赖 `run_id` ⇒ **该偏离会把「candidate 缺 run_id」隐藏成假绿**。
   已把内存适配器改为**与真实适配器同构**，并加保真断言（RM-05c）。
2. **跨 run 记录在保真适配器下无法经正常 API 注入**（`where({run_id})` 天然过滤）
   ⇒ coherence guard 是**纵深防御**；测试改用「损坏的 store」+「守卫单元测试」两条路径覆盖（RM-05a/b）。
3. **`projectCompatSnapshot` 的两轴切分依据是字段级审计**，不是"看起来像"：
   `portfolio_snapshot` 的 6 个资产字段由**用户维护**写入（`adminGateway:1027-1041`），
   其余为引擎按 run 计算 —— 二者语义不同，故必须分轴。

### 7.4 Parity

- **跨树同度量 anchor**：baseline tree == candidate tree ==
  `cce9ccbfbf67a1268790da4e2865b7af0c5328eebe752a88d1266de0961fb554` ⇒ **`UNEXPECTED_DECISION_DELTA = 0`**
- P-12 判据 anchor：`25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723`（**与前三轮逐字相同**）
- ⚠️ 一处**已知判据冲突**（沿用 §21.10 的披露，非新增）：`scripts/v365-p12-decision-parity.js` 把
  `cloudfunctions/runDecisionEngine/index.js` 列为「决策核心必须零改动」，而 B1 按授权修改了它 ⇒ 该脚本必然 FAIL。
- 本轮新增改动文件与回放依赖集**交集 = []**。

### 7.5 回归

> ★ **2026-09-24 勘误（append-only：原记录保留在下方删除线中，⛔ 不删除历史）**
>
> 原表写于**前任通道**（沙箱禁止 Node 子进程，`spawnSync` 恒 `EBUSY`）。复核发现两点：
> 1. 原记的 3 项「既有环境相关失败」**不是基线属性，而是通道差异** ——
>    `gen1-parity` / `gen1-ge03-regression-guard` / `gen2-scenario-parity` 是**全库仅有的 3 个
>    自身调用 `child_process` 的测试**（`grep -l "spawnSync\|execSync\|child_process" tests/*.test.js`
>    恰好且仅有这 3 个）。前任通道跑不了子进程 ⇒ 这 3 个必然全红，与树无关；本机通道可跑 ⇒ 全部转绿。
> 2. `gen1-ge03-regression-guard` 在**候选树**上另有**真实新增失败**（D12 前向 fail-closed：
>    `runtime_status` 出现 4 个未登记写入字段 `v365_mode` / `v365_run_integrity` /
>    `v365_finality_status` / `v365_authoritative_published`），该失败在前任通道被 spawn 失败**掩盖**。
>    已在 `src/common/schema.js` 的 `runtime_status` 段补齐登记 ⇒ 转绿。
>
> ⇒ 复核后的判据：**CANDIDATE 59 passed / 0 failed · BASELINE 51 passed / 0 failed · `NEW_FAILURES = 0`**。

| 项 | 结果 |
|---|---|
| ~~CANDIDATE 全量单测（原记录）~~ | ~~**56 passed / 3 failed**~~ |
| ~~BASELINE（`origin/master` worktree，原记录）~~ | ~~**48 passed / 3 failed**~~ |
| ~~失败集合（原记录）~~ | ~~**完全相同** ⇒ **零新增失败**（`gen1-parity` / `gen1-ge03-regression-guard` / `gen2-scenario-parity`，既有环境相关）~~ |
| **CANDIDATE 全量单测（2026-09-24 复核）** | **59 passed / 0 failed** |
| **BASELINE（`origin/master` worktree，2026-09-24 复核）** | **51 passed / 0 failed** |
| **失败集合（2026-09-24 复核）** | **空集** ⇒ **`NEW_FAILURES = 0`** |
| `verify-immutable` / `verify-gen1-pipeline` / `verify-gen2-build-artifacts` | 23/23 · 10/10 · 7/7 PASS |
| V365 manifest verifier | PASS（**20 个合格文件逐字节一致**）+ `--check` BYTE-EQUIVALENT |

**合格面新增 2 个文件**（20 = 18 + 2）：
`cloudfunctions/apiGateway/index.js`、`cloudfunctions/adminGateway/index.js`
—— reader 迁移改变了「前台看到什么」，若不受完整性覆盖，「writer 原子 + reader 混读」会重新出现而 manifest 不自知。

---

## 8. 边界履行

⛔ 未 deploy / 未 push / 未 PR / 未 merge / 未 freeze · 未改任何 production data / `param_config` ·
⛔ **未实现 Run History Index**（只登记要求）· 未提升 Gen-1 / Gen-2 Authority ·
未恢复 `breakout_nd` / 未补 SlowBreak / 未启用 Portfolio Mode / 未改 Market Regime ·
⛔ 未因 reader migration 麻烦而退回 `latest document fallback`。
✅ 只改 **reader 路径 + provenance + 门禁 + 测试 + 文档**；⛔ 未改任何决策计算。

## 9. 状态

```
V365_WRITER_PATH      = QUALIFIED
V365_IMPLEMENTATION   = QUALIFIED_CANDIDATE
READER_MIGRATION      = COMPLETE

RUN_HISTORY_INDEX     = PENDING
  · 契约侧（WP-RH1）：✅ 完成 —— 5 集合登记于 v365-contracts.js + schema.js（tests/v365-rh1-contract-registry.test.js E-01~12）
  · 写侧（WP-RH2/RH3）：✅ 完成 —— RDE 接线 publishCandidateFirst() + run_history 单次写入（F-01~12 / G-01~11）
  · 读者侧（WP-RH4）：✅ 完成 —— CLASS C 5 读点登记 + buildClassCProvenance（H-01~12）· Reader Gate 8/8
  · 结构侧（HD-10）：✅ 完成 —— 5 集合 + 7 索引已在生产创建（CREATE EMPTY STRUCTURE ONLY；documents_written=0）
  · 数据侧：⛔ PENDING —— 生产尚无 active_run_pointer 提升 ⇒ run_axis_available=false · coverage='legacy_only'
  · 切换日：⛔ 未登记 —— V365_ENFORCE_SWITCH_DATE = null（部署时登记）

V365_FULL_QUALIFICATION  = NOT_YET_COMPLETE
READY_FOR_FREEZE_REVIEW  = NO
```

> ⚠️ **代码就绪 / 结构就绪 ≠ 数据就绪**：RH1~RH4 测试全绿 + HD-10 建表完成**只**证明
> 「契约 + 写侧 + 读者 + 结构」就绪；`RUN_HISTORY_INDEX = PENDING` 仍为真，
> 因为**生产侧无 `run_history` 数据**（5 集合全部 `n=0` + 无提升发生）
> ⇒ CLASS C 仍如实报 `run_axis_available = false`。
> ⛔ 不得因「测试全绿」或「集合已建」就改写此状态。

> ⚠️ `V365_IMPLEMENTATION = QUALIFIED_CANDIDATE` 是**资格门输出**（`PASS 38 / 38`），
> ⛔ **不等于** `PRODUCTION AUTHORIZED`；FREEZE / PR / MERGE / DEPLOY 均需单独授权。
