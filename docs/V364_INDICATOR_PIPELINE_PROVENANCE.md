# V3.6.4 Gate P-A —— Indicator Pipeline Provenance Audit

> 只读审计。未部署、未改线上参数、未改任何生产数据、未改任何策略阈值、未补任何字段。
> 采集时间：2026-09-22 15:47–15:56 (GMT+8)
> 审计基线：master `519c3559c9840fa954e3357d665635fd1f97648c`；审计分支 `audit/v364-production-promotion`

---

## 0. 结论摘要（先给答案）

| 问题 | 结论 |
|---|---|
| 线上 `breakout_nd` 为什么 missing？ | **`DEPLOYMENT_DRIFT`** —— 唯一根因，**非「可能」** |
| `ma60_slope` 根因 | **`NOT_COMPUTED`**（仓库与线上均无产生处，只有 `defense.js` 读取） |
| `high_point_falling` 根因 | **`NOT_COMPUTED`** |
| `lower_high` 根因 | **`NOT_COMPUTED`** |
| 是否 `PERSISTED_BUT_QUERY_MISSED`？ | ❌ **已排除**（完整文档读取，字段确实不在库里） |
| 是否 `RETURNED_NOT_PERSISTED`？ | ❌ **已排除**（物化函数整对象 upsert，无字段白名单） |
| 线上包与仓库是否 source parity？ | ❌ **否** —— `materializeIndicators` 的 `common/**` **9/11 文件与仓库不同**；入口 `index.js` 与 `package.json` 相同 |

### 0.1 字段集合四路闭合（**实测**，非正则推断）

| 集合 | 来源 | 字段数 |
|---|---|---|
| `S_old` | 线上 `runDecisionEngine` 包（2026-09-17）`computeSnapshot()` 实跑返回键 | **32** |
| `S_new` | 冻结 `aa634e2` `computeSnapshot()` 实跑返回键 | **32** |
| `S_mi` | 线上 `materializeIndicators` 包（2026-09-08）`computeSnapshot()` 实跑返回键 | **31** |
| `S_db` | `indicator_snapshot` 完整文档实测键集合 | **31** |
| `S_harness` | 重放 harness 的生产契约白名单 `LIVE_SNAPSHOT_FIELDS` | **31** |

```text
S_old == S_new            : True
S_old - S_mi              : ['breakout_nd']      ← 唯一差异
S_mi  - S_old             : []
S_db  == S_mi             : True                 ← 库里字段集 == mI 产出集
S_harness == S_mi         : True                 ← 重放所用契约已正确钉死
S_harness == S_db         : True
```

**这是 `breakout_nd` 根因的最终形式**：全链路上的字段集差恰为**单一元素**。

> ⚠️ **本报告方法学勘误（见 §9）**：初稿中「返回体 27 / 28 字段」「文档恰为 27 字段」三处数字
> 系**正则推断**所得，**是错的**（把「27」误当字段数，实际 27 是**该票的文档条数**）。
> 现已全部替换为上表**实跑**得到的 31 / 32，并以集合相等作断言。结论方向未变，但数字与依据已更正。

---

## 1. 线上 `materializeIndicators` 包核验

### 1.1 FunctionDetail（CloudBase 只读）

| 字段 | 值 |
|---|---|
| FunctionName | `materializeIndicators` |
| FunctionId | `lam-g2m7cvwv` |
| Namespace | `tradingview-etf-d0fa42yy57cbc11b` |
| Runtime | **`Nodejs16.13`** |
| Handler | `index.main` |
| FunctionVersion | `$LATEST` |
| AddTime | `2026-08-15 11:35:29` |
| **ModTime** | **`2026-09-08 11:35:24`** |
| CodeSize | `4073486` |
| Status / AvailableStatus | `Active` / `Available` |
| Trigger | `dailyPipeline-0800`（cron `0 0 8 * * 1-5`，trigger ModTime `2026-09-17 13:38:04`） |

### 1.2 包 SHA 与入口 SHA

```text
ONLINE_PACKAGE_SHA   = 9642cae255536f5ed1ac040d2891c6152ffba7c7f02fc3a859703ab2d7d44302
                       （API CodeSha256 与本地 curl 下载后 sha256sum 逐位一致）
ONLINE_ENTRY_SHA     = 3f9b3e69c38e4676627f8be760cfafa9887fd9d601330ed334a88e1185aafa89   (index.js, raw bytes)
ONLINE_MODTIME       = 2026-09-08 11:35:24
REPO_REFERENCE_SHA   = 519c3559c9840fa954e3357d665635fd1f97648c（审计基线 commit）
                       └ REPO index.js LF-normalized = 与 ONLINE 相同 ⇒ 入口文件 parity OK
```

### 1.3 逐文件 parity（LF-normalized sha256；排除部署期生成的 `config.json`）

```text
MATCH_COUNT  = 2      ['index.js', 'package.json']
ONLY_ONLINE  = 0      []
ONLY_REPO    = 63     （函数不打包的仓库文件，非 drift；函数只打包其依赖）
CONTENT_DIFF = 9      ['common/constants.js', 'common/schema.js', 'common/utils/datasource.js',
                       'common/utils/db.js', 'common/utils/decision.js', 'common/utils/fetch-guard.js',
                       'common/utils/indicators.js', 'common/utils/live-asset.js', 'common/utils/pnl.js']
```

**判读**：`materializeIndicators` 的**入口 `index.js` 与仓库一致**，但它内嵌的**整个 `common/**`（9 个文件）全部与仓库不同**。
不是换行差异（本表已是 LF-normalized；例如线上 `indicators.js` 本身是 LF，仓库工作区是 CRLF，归一后仍不同）。
⇒ **该函数部署件的 `common` 构建源 ≠ 仓库 `src/common`。**

原始证据：`_v364-pa-baseline/parity_final.json`（含两侧全部文件哈希）。

---

## 2. 交叉对照：同一仓库文件在两个云函数里被部署成两个修订

这是本 Gate 最强的结构性证据 —— **不是猜测，是同名文件的三份哈希对账**：

| 来源 | `indicators.js`（LF-normalized sha256） | 是否含 `breakout_nd` | 部署时间 |
|---|---|---|---|
| `runDecisionEngine` 线上包 | `5ff862d15e115ff19f670bcb1e7400fa68b69ad005f7f8fbc75f72edd3d2aa03` | ✅ 含（1 处） | 2026-09-17 14:24:41 |
| `materializeIndicators` 线上包 | `8c541af1cd42c70ff1b4adeb9d6b2bf66b85b77d0c0c9bfbb7baf0cec3299b67` | ❌ **不含（0 处）** | **2026-09-08 11:35:24** |
| 仓库 `src/common/utils/indicators.js` @519c355 | `5ff862d15e115ff19f670bcb1e7400fa68b69ad005f7f8fbc75f72edd3d2aa03` | ✅ 含 | — |

- `runDecisionEngine` 包 == 仓库 ⇒ 2026-09-17 那次部署带的是**当前修订**。
- `materializeIndicators` 包 ≠ 仓库，且**在本仓历史任何修订中都不存在**
  （`git log --all -- src/common/utils/indicators.js` 只有 **1** 个修订 = 首提交 `8fc3ba6`，2026-09-08 10:59:17）。
- 而 `materializeIndicators` 是**唯一往 `indicator_snapshot` 写快照的函数**。

### 2.1 `computeSnapshot` 返回体字段对比（**实跑**，非正则推断）

| 版本 | `Object.keys(computeSnapshot(...)).length` | 差异 |
|---|---|---|
| 线上 `materializeIndicators`（2026-09-08） | **31** | — |
| 线上 `runDecisionEngine`（2026-09-17） | **32** | — |
| 仓库 / 冻结 `aa634e2` | **32** | — |

```text
S_old(线上rDE) − S_mi(线上mI) = ['breakout_nd']     ← 唯一差异
S_mi − S_old                 = []                   ← 无反向差异
S_db(库内文档) == S_mi(线上mI 产出) = True
```

> 方法：分别在三个源码根下 `require` 该根自己的 `src/common/utils/indicators.js`，
> 用同一份真实 K 线（513310，898 根）与同一组参数调用 `computeSnapshot`，取返回对象的键集合。
> 证据：`_v364-pa-baseline/field_sets.json`、`_v364-pb/keys-{old,new,mi}.json`。
> ⛔ **不使用**「在源码里数 key」的正则做法 —— 初稿即因此得出错误的 27/28（见 §9）。

仓库侧的 `breakout_nd` 产生处（唯一）：

```js
// src/common/utils/indicators.js
:738   const breakoutNd = priorClose20 != null && lastClose > priorClose20;
:774   breakout_nd: breakoutNd === true,
```

---

## 3. Provenance Matrix（10 字段 × 11 问）

> `RUN_DECISION_ENGINE_CONSUMER` 一列给出在**线上生产契约**下的实际读取行为。
> 线上生产契约 = `indicator_snapshot` 的真实字段集（见 §6）。

### 3.1 `breakout_nd`

| 问 | 答 |
|---|---|
| PRODUCER | `computeSnapshot`（`src/common/utils/indicators.js:774`，源 `breakoutNd` 于 :738） |
| PRODUCER_FILE | `src/common/utils/indicators.js` |
| COMPUTED | 仓库 **是**；线上 `materializeIndicators` 部署件 **否** |
| RETURNED_BY_COMPUTE_SNAPSHOT | 仓库/冻结 **是**（32 字段之一）；线上 rDE 包 **是**（32）；线上 mI 包 **否**（31 字段，无此键） |
| MATERIALIZER_RECEIVES | 线上 mI 调 `indicators.computeSnapshot(...)` 后**整对象** `db.upsert(INDICATOR_SNAPSHOT, snapshot, …)` —— **无字段白名单**（证据：`index.js` 源码，CodeInfo 全量可见） |
| PERSISTENCE_MAPPING | 无映射层；`snapshot` 原文落库 |
| SCHEMA_ACCEPTED | `schema.js` **未登记该字段**（0 次出现）⇒ schema 既不接受也不拒绝 ⇒ **非 schema 导致** |
| DB_DOCUMENT_PRESENT | **否** —— 全量 135 条文档中 **0 条**含该键（含 13 字段投影读取；完整文档读取亦无） |
| RUN_DECISION_ENGINE_CONSUMER | `snapshot.breakout_nd === true` 在 `decision-v3.js`（×8）、`decision.js`、`trend-stage.js`（×3）、`v3-2-math-engine.js`（×3）、`market-env-v3.js`、`market-score-components.js` 共 17+ 处读取 |
| MISSING_FALLBACK | JS 语义下 `undefined === true` ⇒ **全部读取恒为 false**。`trend-stage.js:168` 的 S4 分支 `reason:'breakout_nd'` **在生产上不可达** |
| **ROOT_CAUSE_CLASS** | **`DEPLOYMENT_DRIFT`** |

### 3.2 `ma60_slope`

| 问 | 答 |
|---|---|
| PRODUCER | **无** |
| PRODUCER_FILE | —（`indicators.js:701` 为注释；`runGen2ShadowEod` 的 `ma60_slope_10d` 是**另一个字段**） |
| COMPUTED | **否**（仓库与线上 mI 均无） |
| RETURNED_BY_COMPUTE_SNAPSHOT | **否**（两版返回体都没有该键） |
| MATERIALIZER_RECEIVES | 不适用（上游未产出） |
| PERSISTENCE_MAPPING | 不适用 |
| SCHEMA_ACCEPTED | `schema.js` **未登记** |
| DB_DOCUMENT_PRESENT | **否**（135/135 缺失） |
| RUN_DECISION_ENGINE_CONSUMER | `defense.js:36`：`if (snapshot.ma60_slope != null && snapshot.ma60_slope < 0) n += 1;` —— **全仓唯一读取点** |
| MISSING_FALLBACK | `!= null` 判空为假 ⇒ 该计数项**恒不计入** |
| **ROOT_CAUSE_CLASS** | **`NOT_COMPUTED`** |

### 3.3 `high_point_falling`

| 问 | 答 |
|---|---|
| PRODUCER | **无**（`indicators.js` 出现 0 次；线上包同样 0 次） |
| COMPUTED / RETURNED | **否 / 否** |
| SCHEMA_ACCEPTED | **未登记** |
| DB_DOCUMENT_PRESENT | **否**（135/135 缺失） |
| CONSUMER | `defense.js:34`：`if (snapshot.high_point_falling === true \|\| snapshot.lower_high === true) n += 1;` |
| MISSING_FALLBACK | `undefined === true` 为假 ⇒ 恒不计入 |
| **ROOT_CAUSE_CLASS** | **`NOT_COMPUTED`** |

### 3.4 `lower_high`

| 问 | 答 |
|---|---|
| PRODUCER | **无**（snake_case `lower_high` 在仓库 0 个产生处；仅有 camelCase `lowerHigh`，由 `trend-stage.js::swingHighLow` / `swing-structure.js` 产生，属 **swing 返回值**，不是快照字段） |
| COMPUTED / RETURNED | **否 / 否** |
| SCHEMA_ACCEPTED | **未登记** |
| DB_DOCUMENT_PRESENT | **否**（135/135 缺失） |
| CONSUMER | 同 `defense.js:34` |
| MISSING_FALLBACK | 恒不计入 |
| **ROOT_CAUSE_CLASS** | **`NOT_COMPUTED`** |

### 3.5 `higher_low`

| 问 | 答 |
|---|---|
| PRODUCER | **无**（作为快照字段）。`v3-6-stage-persistence.js` 内有 `higher_low: hlOk`，但那是 **S5 完整性对象 `integ` 的内部派生字段**，不写入快照 |
| COMPUTED / RETURNED | **否 / 否** |
| SCHEMA_ACCEPTED | **未登记** |
| DB_DOCUMENT_PRESENT | **否**（135/135 缺失） |
| CONSUMER | `v3-6-stage-persistence.js:481`（读自己的内部对象，非快照） |
| **ROOT_CAUSE_CLASS** | **`NOT_COMPUTED`** |

### 3.6 `ma20_slope`

| 问 | 答 |
|---|---|
| PRODUCER | `src/common/utils/indicators.js`（`computeSnapshot`） |
| COMPUTED / RETURNED | **是 / 是** |
| MATERIALIZER_RECEIVES | 是（整对象 upsert） |
| PERSISTENCE_MAPPING | 无映射层 |
| SCHEMA_ACCEPTED | ✅ 登记（`schema.js`：`ma20_slope: {type:'number', required:false}`） |
| DB_DOCUMENT_PRESENT | **是（135/135）** |
| CONSUMER | `defense.js:35`、`defense.js:71`、`gen1-data-health.js` 等 |
| MISSING_FALLBACK | 不适用 |
| **ROOT_CAUSE_CLASS** | **`PRESENT`** |

### 3.7 `d_state` / `h_state` / `w_state` / `volume_ratio`

| 问 | `d_state` | `h_state` | `w_state` | `volume_ratio` |
|---|---|---|---|---|
| PRODUCER | `indicators.js` | `indicators.js` | `indicators.js` | `indicators.js` |
| COMPUTED | 是 | 是 | 是 | 是 |
| RETURNED | 是 | 是 | 是 | 是 |
| MATERIALIZER_RECEIVES | 是 | 是 | 是 | 是 |
| PERSISTENCE_MAPPING | 无 | 无 | 无 | 无 |
| SCHEMA_ACCEPTED | ✅ required | ✅ required | ✅ required | ✅ required |
| DB_DOCUMENT_PRESENT | **是 135/135** | **是 135/135** | **是 135/135** | **是 135/135** |
| CONSUMER | `defense.js:37`、`decision.js`×3、`decision-v3.js`×3 | `defense.js:37`、`decision-v3.js`×2 | `decision-v3.js`×多处、`trend-stage.js` | `decision-v3.js:345`、`decision.js` |
| **ROOT_CAUSE_CLASS** | **`PRESENT`** | **`PRESENT`** | **`PRESENT`** | **`PRESENT`** |

### 3.8 分类汇总

| 字段 | ROOT_CAUSE_CLASS |
|---|---|
| `breakout_nd` | **`DEPLOYMENT_DRIFT`** |
| `ma60_slope` | **`NOT_COMPUTED`** |
| `high_point_falling` | **`NOT_COMPUTED`** |
| `lower_high` | **`NOT_COMPUTED`** |
| `higher_low` | **`NOT_COMPUTED`** |
| `ma20_slope` | `PRESENT` |
| `d_state` | `PRESENT` |
| `h_state` | `PRESENT` |
| `w_state` | `PRESENT` |
| `volume_ratio` | `PRESENT` |

`COMPUTED_NOT_RETURNED` / `RETURNED_NOT_PERSISTED` / `PERSISTED_BUT_QUERY_MISSED` **均未出现**。

---

## 4. `breakout_nd` 缺失的唯一根因（三条独立证据闭环）

**`DEPLOYMENT_DRIFT`** —— 产快照的那个云函数（`materializeIndicators`，部署于 2026-09-08 11:35:24）
内嵌的 `common/utils/indicators.js` 是一个**不含 `breakout_nd` 的修订**；仓库（及 2026-09-17 部署的
`runDecisionEngine` 包）中的新修订**会**返回 `breakout_nd`，但从未部署到 `materializeIndicators`。

**闭环证据链**：

1. **产出侧**：线上 mI 包 `computeSnapshot()` **实跑**返回 **31** 字段、无 `breakout_nd`；
   线上 rDE 包与仓库/冻结均 **32** 字段、有。差集**恰为** `['breakout_nd']`，无反向差异。
2. **落库侧**：线上 mI 的 `index.js`（CodeInfo 全量可见）是
   `await db.upsert(COLLECTIONS.INDICATOR_SNAPSHOT, snapshot, {code, calc_date})` —— **整对象落库、无字段白名单**
   ⇒ `RETURNED_NOT_PERSISTED` 与 `PERSISTENCE_MAPPING` 丢失**不可能**。
3. **读取侧**：对 `indicator_snapshot` 做**完整文档读取**（无投影），513310@2026-09-21 文档为 **31 个字段**，
   与线上 mI 包 `computeSnapshot()` **实跑**得到的 31 字段集合**完全相等**（`S_db == S_mi`），且不含 `breakout_nd`
   ⇒ `PERSISTED_BUT_QUERY_MISSED` **被排除**。

**反证（同仓同文件另一处部署）**：`runDecisionEngine` 包（2026-09-17）的 `indicators.js` 与仓库**逐位相同**、
**含** `breakout_nd` ⇒ 新修订确实存在且可部署，缺口只在 `materializeIndicators`。

**关于成因机制（诚实边界）**：可从制品确定的是「部署件与其构建源不一致」；
至于是哪一份本地工作区状态被用于 09-08 那次构建，**制品中不可观测**，本审计不推测。
旁证：`materializeIndicators` 的 `ModTime 2026-09-08 11:35:24` **晚于**仓库首提交 `8fc3ba6`（2026-09-08 10:59:17），
却带着**更旧**的 `common` 修订。

---

## 5. 5 只生产 ETF × 最近 27 条 `indicator_snapshot` 统计

数据源：CloudBase `indicator_snapshot` 全集合 **135** 条（= 5 只 ETF × **27** 个交易日，
`2026-08-14` ~ `2026-09-21`；每票 27 条，逐日一条）。

统计方法：13 字段投影读取全部 135 条；**键在文档中不出现 = `missing`**；键出现且值为 `false` = `false`。
（`false` 与 `missing` 严格区分。）

| 字段 | present | true | false | null | **missing** |
|---|---|---|---|---|---|
| `breakout_nd` | 0 | 0 | 0 | 0 | **135** |
| `ma60_slope` | 0 | 0 | 0 | 0 | **135** |
| `high_point_falling` | 0 | 0 | 0 | 0 | **135** |
| `lower_high` | 0 | 0 | 0 | 0 | **135** |
| `higher_low` | 0 | 0 | 0 | 0 | **135** |
| `ma20_slope` | 135 | — | — | 0 | 0 |
| `d_state` | 135 | — | — | 0 | 0 |
| `h_state` | 135 | — | — | 0 | 0 |
| `w_state` | 135 | — | — | 0 | 0 |
| `volume_ratio` | 135 | — | — | 0 | 0 |

> 重命名注意：文档里确实存在的是 **`breakout`**（布尔，与 `breakout_nd` **不是同一个字段**）。
> 它 **present 135 / true 4 / false 131 / null 0 / missing 0** ——
> `true` 的 4 条为：`518880@2026-08-24`、`518880@2026-08-21`、`518880@2026-08-20`、`515880@2026-08-17`。
> ⇒ **库里 boolean 字段能正常落 `false`**，所以 `breakout_nd` 的 `0/0/0/0/135` 是**真 missing**，不是被存成 `false`。

---

## 6. 对 FINDING-1 / FINDING-2 的影响

### FINDING-1（SlowBreak `SB>=75` 不可达）—— **确认成立，且比此前更强**

`defense.js::calcSlowBreakScore` 的 4 项输入在生产契约下的实况：

| # | 输入 | 生产实况 | 可否计入 |
|---|---|---|---|
| 1 | `high_point_falling === true \|\| lower_high === true` | 两者 **`NOT_COMPUTED`、135/135 missing** | ❌ 恒 false |
| 2 | `ma20_slope != null && < 0` | `PRESENT`（135/135） | ✅ |
| 3 | `ma60_slope != null && < 0` | **`NOT_COMPUTED`、135/135 missing** | ❌ 恒 false |
| 4 | `d_state === 'D5' \|\| h_state ∈ {H4,H5}` | 两者 `PRESENT` | ✅ |

⇒ 最多 **2/4** ⇒ 分数映射 `{0:0,1:20,2:50,3:75,4:100}` 上限 **50** ⇒ **`SB>=75` 不可达**
⇒ `isSlowBreakHigh()`（要求「过去 5 日中 ≥3 日 `SB>=75` 且 `LH` 且 `LL`」）**在生产上恒 false**
⇒ DefenseScore 的 **+20 SlowBreak bonus 是死逻辑**。

**并且**：这与 R1 的 `lowerLow` 修复**不是同一层问题**。R1 修的是 swing 返回体（camellCase `lowerLow`），
而输入 1 需要的字段名是 snake_case **快照字段** `high_point_falling` / `lower_high`，**从未实现**。
⇒ **「修好 `lowerLow` 就能让 SlowBreak 生效」是错的（必要但不充分）**，且即使补齐这两个字段，
输入 3 的 `ma60_slope` **仍不存在** ⇒ 仍不可达。**至少要同时补 3 个字段**才能改变可触达性。

→ 与 Gate A 的 `PASS_SAFETY_ONLY` 语义一致：本版本在真实生产数据上**零决策副作用**，
但**不构成 SlowBreak 触发正确性的验证**。

### FINDING-2（`breakout_nd` 缺失）—— **根因已从「疑似分叉」升级为「已证实的部署漂移」**

- 原表述「线上 `materializeIndicators` 部署件**可能**与仓库 master 分叉」→ 现为
  **已证实：该函数 `common/**` 9/11 文件与仓库不同，且其 `indicators.js` 不见于本仓任何修订。**
- 影响面比 `breakout_nd` 单点更大：`common/utils/db.js`、`decision.js`、`constants.js`、`schema.js`、
  `datasource.js`、`fetch-guard.js`、`live-asset.js`、`pnl.js` **全部**与仓库不同。
  本 Gate 只对 `indicator_snapshot` 写入链路做了因果证明；**其余 8 个文件的差异影响未评估**（登记为后续项）。
- 严重度仍需 counterfactual 量化（见 Promotion 主报告的 `BREAKOUT_ND_RESTORED_COUNTERFACTUAL`）。

---

## 7. 本 Gate 的诚实边界（不能主张的事）

1. **只核验了 2 个云函数**（`runDecisionEngine`、`materializeIndicators`）。其余 9 个函数的线上包**未对账**。
2. 线上 mI 的 `common/**` 与仓库不同，**其成因（用哪份构建源）不可从制品观测**；本报告只主张「制品不一致 + 缺字段」。
3. `indicator_snapshot` 只有 **135 条 / 每票 27 天**，因此**只能**验证「最近 27 天 100% 缺失」，
   不能证明更早历史；更早历史已由「产出侧代码修订不含该字段」这一**结构性证据**覆盖。
4. 未使用 `metrics` / `weekly` 等衍生集合；未评估 `etf_weekly` 链路。
5. 未做任何写入；未修改任何字段、参数、阈值；未补 `ma60_slope` / `high_point_falling` / `lower_high`。

---

## 8. 原始证据索引

| 文件 | 内容 |
|---|---|
| `_v364-pa-baseline/materializeIndicators.online.zip` | 线上包（本地重算 SHA == API CodeSha256） |
| `_v364-pa-baseline/online/` | 解压后的线上源码（12 文件，+ node_modules） |
| `_v364-pa-baseline/parity_final.json` | parity 全量结果 + 两侧所有文件哈希 |
| `_v361-r1-baseline-20260922/online/common/utils/indicators.js` | `runDecisionEngine` 包内 `indicators.js`（对比用） |
| `_v364-pb/keys-{old,new,mi}.json` | 三个源码根下 `computeSnapshot()` 的**实跑**键集合 |
| `_v364-pa-baseline/field_sets.json` | 四路集合相等的机器可判定记录 |
| `_v364-pb/probe-keys.js` | 键集合探针（可复跑） |

---

## 9. 本报告的方法学勘误（self-correction）

**勘误对象：本报告自身初稿。**

| # | 初稿写法（**错**） | 实测（**对**） | 错因 |
|---|---|---|---|
| 1 | 线上 mI 包 `computeSnapshot` 返回体 **27** 字段 | **31** | 用正则从源码 `return { … }` 块里数 key，块边界/缩进假设不成立导致少计 |
| 2 | 仓库 `computeSnapshot` 返回体 **28** 字段 | **32** | 同上 |
| 3 | 完整文档「恰为 **27** 个字段」 | **31** | **把 `total: 27`（该票 27 条文档）误当成字段数** —— 两个不同量纲被混为一谈 |

**已采取的措施**：
- 三处全部替换为**实跑**所得数字（31 / 32），并以**集合相等**（`S_db == S_mi == S_harness`、`S_old − S_mi = ['breakout_nd']`）作为断言，
  不再依赖「数源码里的 key」。
- 探针 `_v364-pb/probe-keys.js` 已入库路径，可复跑复核（换任一源码根即得该根的真实键集合）。

**结论是否受影响**：**否**。`breakout_nd` 的根因仍为 `DEPLOYMENT_DRIFT`，且证据更强 ——
从「正则数出 27 vs 28」升级为「**三份源码 + 库内文档四路集合闭合，差集恰为单一元素**」。
但**数字与依据必须更正**，否则本报告会把一个未执行的推断当成实测结论传递给 Promotion 决策。

**教训（写入长期约定）**：凡「某文件返回哪些字段」这类问题，**必须执行代码取键集合**；
正则扫源码只能用于**定位**（如「该字符串是否出现」），**不能用于计数或集合相等性判断**。
