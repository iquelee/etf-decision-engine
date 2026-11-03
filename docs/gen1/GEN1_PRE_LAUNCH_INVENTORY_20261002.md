# GEN1_PRE_LAUNCH_INVENTORY / FUNCTIONAL COMPLETENESS INVENTORY —— Gen-1 进入 Decision Chain 的完整缺口盘点（★ 只读 Gate）

- **闸门来源**：owner 2026-10-02「开启下一只读 Gate：GEN1_PRE_LAUNCH_INVENTORY」
- **闸门目标（owner 原文）**：«不修改生产、不修改 selector、不恢复 Health、不进入 Freeze，而是完整盘点
  Gen-1 从当前状态到真正进入 Decision Chain 还缺什么。»
- **核心提醒（owner 原文）**：**Evidence Freeze Seal ≠ Gen-1 Feature Complete ≠ Production Decision Chain Live**
- **本件性质（⛔ 首要）**：**只读盘点**。⛔ 不修复任何缺口；⛔ 不 deploy / 不写生产 / 不改代码 / ⛔ 不 merge /
  ⛔ 不 push / 不 tag / ⛔ 不进入 Freeze；⛔ 零放行。
- **as-of**：2026-10-02（北京时间）
- **上游件**：`GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md` · `GEN1_ENGINE_IDENTITY_RECONCILIATION_20261002.md`
- **前身（同路径初稿）**：本件为 `GEN1_PRE_LAUNCH_INVENTORY_20261002.md` 的**正式版**；⛔ 不另造第二份。

---

## 0. 方法与证据来源分级（⛔ 先声明口径，再下结论）

| 级别 | 含义 | 本件用途 |
|---|---|---|
| ★ `online-codeinfo-20261002` | **线上部署源码实读**：`tcb fn detail <fn> -e <env> --json` 的 `CodeInfo` 字段（= 该函数 `index.js` 全文），本件**新增** | **读路径 / 写路径的部署事实** |
| ★ `online-http-20261002` | **线上只读 HTTP 实读**：`GET /apiGateway/api/{dashboard,etf/list,etf/513310/decisions,constants}`，本件新增 | 响应形状 = 消费者实际拿到什么 |
| ★ `online-db-20261002` | 线上只读集合实读（`cb_query.py`，只读门仅放行 `QUERY/find` + `COMMAND/count`） | 八源现状 |
| `online-fnlist-20261002` | `tcb fn list` / `fn detail` 函数台账（Status / ModTime / CodeSize） | 部署时点 |
| `repo@carrier` | 载体树 `_g1-contract-v5-20261002` 工作区源码 | 契约/章节/不变量的来源 |
| `repo@dist` | 主仓 `dist-functions/**` 构建产物 | 与线上逐字节对拍 |
| ⚠️ `NOT RE-READ` | 本件**未**对该对象做线上逐字节复读（须显式标注，⛔ 不得冒充实时） | 例：`fetchDailyData` / `fetchRealtimeData` / `fetchFundamentalNews` / `extractFundamental` / `runGen2ShadowEod` 的**包内非 `index.js` 文件** |
| ⛔ `STALE-DO-NOT-USE` | `_cb-connect-20260921/../online-*` 快照（mtime **2026-09-01**，早于 V3.6.1） | ⛔ 一律不得用于「当前线上」结论（E27 `STALE CAPABILITY`） |

**⚠️ 口径纪律（本件最重要的一条）**：**「仓库里有这个模块」≠「线上跑了这个模块」。**
本件所有「线上」结论**必须**由 `online-codeinfo-20261002` 或 `online-http-20261002` 支撑；
凡只有仓库证据者，一律标 `repo-only（线上未复读）`。

**⚠️ 枚举域声明**：本件「零消费者 / 零引用」类否定断言，枚举域 =
**① 线上 5 个函数的 `CodeInfo`（apiGateway / adminGateway / runDecisionEngine / runGen1ShadowEod / materializeIndicators）**
+ **② 线上 HTTP 响应形状** + **③ 载体树工作区 `.js`（排除 `node_modules`）**。
⛔ 不覆盖其余 5 个已部署函数（fetchDailyData / fetchRealtimeData / fetchFundamentalNews / extractFundamental / runGen2ShadowEod）的包内非 `index.js` 文件。

---

## 1. ★ 完整重建 Gen-1 实际生产链（owner §1）

```text
Production Data
      ↓
materializeIndicators
      ↓
Gen-1 EOD Signal
      ↓
Gen-1 Candidate
      ↓
Candidate Validation
      ↓
Promotion Proof
      ↓
Active Pointer
      ↓
Production Decision Read Path
      ↓
Decision Chain
```

| # | 环节 | SOURCE | CONSUMER | PERSISTED ARTIFACT | PRODUCTION STATUS | EVIDENCE | CURRENT GAP |
|---|---|---|---|---|---|---|---|
| 1 | **Production Data** | `fetchDailyData`（trigger `dailyFetch-2200`） | `materializeIndicators` | `etf_daily` | ✅ ACTIVE | `online-fnlist-20261002` + trigger registry 云观测 | — |
| 2 | **materializeIndicators** | `etf_daily` + `param_config` | `runDecisionEngine` / `runGen1ShadowEod` | `etf_weekly` / `indicator_snapshot` | ✅ ACTIVE（trigger `dailyPipeline-0800`） | ★ 线上 `index.js` sha256lf `3f9b3e69c38e4676…` **== 载体树**；`repo@dist` ≠ | — |
| 3 | **Gen-1 EOD Signal** | `etf_daily` 官方 EOD（≥60 根/标的）+ 冻结模型 | ⛔ **无生产读者**（见 §1.1） | `ml_shadow_signal`（**133 行**） | ⚠️ **SCHEDULED + DEPLOYED，但链断** | ★ 线上 sha256lf `485244e4f79931b5…` == 载体树 == `repo@dist`；trigger `gen1-eod-weekdays-2220` 在册；**最后自然运行 = 北京 2026-10-01 22:20**（由 `ml_shadow_signal.signal_run_id='gen1-eod-20261001142003272-c49a78'` 反推） | ⛔ **S-1**：signal 无**生产**消费者（唯一消费者是 rde 的**反事实/审计**层，非决策输入） |
| 4 | **Gen-1 Candidate** | — | — | **⛔ 不存在** Gen-1 专属 candidate 集合 | ❌ **MISSING** | 线上 `run_candidate_decision` 全部 **10 行**：`gen1_adopted=False` · `gen1_candidate_hash=None` · `gen1_effective_guarded=False` · `gen1_guarded_result_target=None` | ⛔ **B-2 / A-1**：**没有 Gen-1 candidate 这一实体** |
| 5 | **Candidate Validation** | `runDecisionEngine`（`v365-run-integrity.js::validateCandidateSet`） | `run_manifest.validation_passed` | `run_manifest`（2 行） | ✅ ACTIVE（**会判不合格**） | ★ 实读：`engine:2026-09-30` → `true`/`ok`；`engine:2026-10-01` → `false`/`mixed_date_detected` | — |
| 6 | **Promotion Proof** | `publishCandidateFirst`（`v365-run-integrity.js`，线上 rde **已接线**） | `active_run_pointer` 写入 | `run_history`（2 行）+ `run_manifest.status` | ✅ ACTIVE | ★ 实读 `run_history`：09-30 run `promoted=true` / `cas_reason=PROMOTED` / `read_after_write_consistent=true`；10-01 run `promoted=false` | — |
| 7 | **Active Pointer** | promotion 的 CAS 写 | ⛔ **零读者** | `active_run_pointer::production`（1 行） | ⚠️ **WROTE-THEN-STALLED** | ★ 实读：`run_id='engine:2026-09-30:b1790776862980'` · `revision=1` · `updated_at=2026-09-30T14:01:11.797Z` | ⛔ **B-2**：pointer 零消费者 |
| 8 | **Production Decision Read Path** | **线上 `decision_result`**（`orderBy decision_date desc`） | apiGateway / adminGateway / 前端 | ⛔ 无（读 `decision_result` + `portfolio_snapshot`） | ❌ **LEGACY（未迁移）** | ★★ 三重证：**①线上 `apiGateway` ModTime = 2026-09-08，`index.js` 无 `v365-*` require**；**②线上 `/api/dashboard` 响应无 `authority` / `mutable_axis`**；**③线上 `apiGateway.index.js:449` = `orderBy decision_date desc`** | ⛔ **B-1**（**本 Gate 主缺口**） |
| 9 | **Decision Chain** | `decision_result`（**已停写**） | 前台 `/dashboard`·`/etf`·`/review`；后台 `/admin/*` | — | ⚠️ **运行中，但输入不是 Gen-1** | ★ 线上 `/api/dashboard`：`data.cards[*].data_time = "2026-09-29"`（`decision_result` max `decision_date`） | ⛔ **B-1 / A-1 的后果** |

### 1.1 第 3 环的精确语义（⛔ 易错，必须分开写）

`runGen1ShadowEod` **确实**在跑，但它的输出**不是**决策输入：

| 事实 | 值 | 来源 |
|---|---|---|
| 函数在册且已部署 | `runGen1ShadowEod` Status=`Active` / Available=`Available` / CodeSize=3737350 | `online-fnlist-20261002` |
| 调度在册 | trigger `gen1-eod-weekdays-2220`（工作日 22:20） | trigger registry 云观测 |
| 线上源码与源一致 | 线上 == 载体树 == `repo@dist`（`485244e4f79931b5…`） | ★ online-codeinfo |
| 最近自然运行 | 北京 **2026-10-01 22:20**（`signal_run_id` 时间戳） | ★ online-db |
| 写入集合 | `ml_shadow_signal`（**133 行**）；文件头自述 *"writes observation rows only. It does not call runDecisionEngine, change portfolio data, or enable execution."* | ★ online-codeinfo + 实读 |
| 是否产生 candidate | ⛔ **否** —— 只写 `signal_status ∈ {CANDIDATE, OBSERVED, NO_OPPORTUNITY}` 这类**观察状态**，⛔ 不是 candidate 实体 | ★ online-codeinfo L254 |
| `ml_effective` | 硬编码 `false`（源码 L261） | ★ online-codeinfo |

⚠️ **签名最易误读处**：`ml_shadow_signal.signal_status` 可取值 `'CANDIDATE'`，但那是 **EOD 快速通道观察标记**
（`signal_status: candidate ? 'CANDIDATE' : ...`，`candidate = canaryAllowed && ruleGate === 'PERMIT'`），
**⛔ 与 Gen-1 candidate / promotion 链无任何关系**。⛔ 不得把该字符串当作 #4 环存在的证据。

### 1.2 唯一存在的 signal → engine 联动（⛔ 是审计字段，不是决策输入）

`run_candidate_decision` 中**只有未提升的**那次 run 带 Gen-1 provenance：

| run_id | 提升 | `gen1_run_id` | `gen1_adopted` |
|---|---|---|---|
| `engine:2026-09-30:b1790776862980`（**当前 active**） | `promoted=true` | **`None`** | `False` |
| `engine:2026-10-01:b1790812813101` | `promoted=false` | `'gen1-eod-20260930142005894-b10c55'` | `False` |

⇒ 联动**机制存在**（`gen1_run_id` / `gen1_candidate_hash` / `gen1_guarded_*` 由 `buildGuardedAudit()`
（`gen1-guarded-selector.js:122-181`）产出），但**结论恒为「未采纳」**：
`adopted = (selection.authoritative_source === GUARDED)`，而选择器**恒返回 BASELINE**（同文件 L31/L80/L95-100）。

---

## 2. Signal Productionization（owner §2）

**signal productionization 链**逐项核查：

| 核查项 | 结论 | 标记 | 证据 |
|---|---|---|---|
| `runGen1ShadowEod` | 函数存在、已部署、源码与源一致 | ✅ `IMPLEMENTED` | ★ online-codeinfo sha `485244e4…` |
| `schedule` | trigger `gen1-eod-weekdays-2220` 在册（工作日 22:20） | ✅ `IMPLEMENTED` | trigger registry 云观测 |
| `natural run` | **有**：最后一次 = 北京 2026-10-01 22:20 | ✅ `OBSERVED_NATURAL_RUN` | ★ `signal_run_id='gen1-eod-20261001142003272-c49a78'` |
| `signal artifact` | `ml_shadow_signal`（133 行 / 5 标的 × 多日） | ✅ `PRODUCTION_ACTIVE` | ★ online-db `count=133` |
| `signal hash` | 有：`decision_hash`（16 hex）+ `feature_schema_hash`（sha256，写入时算） | ✅ `IMPLEMENTED` | ★ online-codeinfo L45-55 / L260 |
| `signal provenance` | 有：`signal_run_id` · `decision_hash` · `feature_schema_hash` · `model_id` · `source_trade_date` · `benchmark_latest_date` · `market_regime` · `missing_features` | ✅ `IMPLEMENTED` | ★ online-codeinfo L216-264 |
| `signal → candidate` | ⛔ **不成立**：无 Gen-1 candidate 实体；rde 侧仅产出**审计字段**且恒 `gen1_adopted=false` | ❌ `NOT_CONNECTED` | ★ online-db（10 行全 `False`） |
| 是否已被 Evidence 采信 | ⛔ 否（evidence execution 未开始） | ❌ `EVIDENCE_BACKED = NO` | 见 §7 |

### 2.1 汇总标记

```text
runGen1ShadowEod        = IMPLEMENTED
schedule                = IMPLEMENTED
natural_run             = OBSERVED_NATURAL_RUN   （最后：北京 2026-10-01 22:20）
signal_artifact         = PRODUCTION_ACTIVE       （ml_shadow_signal = 133 行）
signal_hash             = IMPLEMENTED
signal_provenance       = IMPLEMENTED
signal_to_candidate     = NOT_CONNECTED           ← ★ 关键
EVIDENCE_BACKED         = NO
```

⚠️ **OBS-2 澄清（本件新增推定，须以 CLS 日志最终定性）**：本 Gate 取证时刻 = **北京 21:3x**，
**早于** trigger `gen1-eod-weekdays-2220`（22:20）⇒「2026-10-02 无引擎运行记录」**在期望之内**，
⛔ 不得当作异常。⚠️ 但 `dailyPipeline-0800`（08:00）在 10-02 为何未留痕，仍须 CLS 定性（登记 `OBS-2`）。

---

## 3. Candidate → Promotion 逐环确认（owner §3）

| 核查项 | 结论 | 证据 |
|---|---|---|
| **candidate 是否真由 Gen-1 signal 产生** | ⛔ **否** | ★ 10 行 `run_candidate_decision` 全 `gen1_adopted=False`；`decision_source` 全 = `'V361_SAFETY_CORE'`（⛔ 非 `'V361_SAFETY_CORE_WITH_GEN1'`） |
| **candidate provenance 是否完整** | ⚠️ **V3.6.5 run 侧完整；Gen-1 侧不完整** | run 侧：`run_id` / `calc_date` / `candidate_key` / `written_at` / `input_hash`（manifest）齐备；Gen-1 侧：`gen1_candidate_hash=None` · `gen1_guarded_result_target=None` · `gen1_run_id` 时有时无 |
| **promotion proof 是否真正存在** | ✅ **存在且为真** | ★ `run_history`: `promoted=true` · `cas_reason='PROMOTED'` · `read_after_write_consistent=true`；`active_run_pointer` 与之同源同 revision |
| **active pointer 是否真的指向 Gen-1** | ⛔ **否** | pointer → `engine:2026-09-30:b1790776862980`，其 `gen1_run_id=None`、`gen1_adopted=False` |
| **pointer revision 是否可追溯** | ✅ **可追溯** | `run_history` 含 `revision` · `supersedes_run_id` · `same_trade_date_supersede` · `promoted_from_run_id` · `promoted_from_pointer_run_id`（线上 rde L1393-1400 显式写入，且注释声明「与 `supersedes_run_id` 同源 ⇒ 不可互相矛盾」） |
| **fail-closed 是否有效** | ✅ **有效（已被真实触发）** | 10-01 run：`finality_status=COMPLETE` 但 `validation_reason='mixed_date_detected'` ⇒ `promoted=false` ⇒ pointer **未前进** ⇒ `v365_authoritative_publish_status='NOT_PROMOTED'` |

### 3.1 链式判定

```text
Gen-1 signal  ──（无 candidate 实体）──✗──  Gen-1 candidate
                                              （不存在）
V3 决策结果（非 Gen-1） ──✓── candidate ──✓── validation ──✓── promotion ──✓── active pointer
                                                                              │
                                                                        （零消费者）✗
```

⇒ **「signal → candidate → promotion」这条 Gen-1 链在第 2 环即断**；
现存可跑通的 promotion 链是 **V3 决策结果的 run-integrity 链**，与 Gen-1 无关。

---

## 4. ★ Production Read Path 重点复核（owner §4）

### 4.1 三方源码身份对拍（★ 本 Gate 新增的决定性证据）

| 函数 | 线上 `CodeInfo`（sha256lf） | 线上 ModTime | 载体树 | `repo@dist` | 判定 |
|---|---|---|---|---|---|
| `runDecisionEngine` | `7e339fb2a9eeb87d…` | **2026-09-30 13:38:07** | `77f7d50042cee0a9…` ≠ | **`7e339fb2a9eeb87d…` ==** | 部署源 = `repo@dist` |
| `runGen1ShadowEod` | `485244e4f79931b5…` | 2026-09-10 16:07:20 | **==** | **==** | 三源一致 |
| `materializeIndicators` | `3f9b3e69c38e4676…` | 2026-09-08 11:35:24 | **==** | ≠ | 部署源 = 载体树 |
| `apiGateway` | `8b2103455d0d83c8…` | **2026-09-08 11:32:53** | `5342e92d7f569180…` ≠ | `a86fd452dde19914…` ≠ | ⛔ **三源皆异** |
| `adminGateway` | `ea8cac727b0bc43b…` | **2026-09-08 11:32:23** | `44c111e918a77f09…` ≠ | `858bb639d3ffff5e…` ≠ | ⛔ **三源皆异** |

**⇒ 结论 1**：V3.6.5 的 2026-09-30 那次部署**只覆盖了 `runDecisionEngine`（写侧）**。
`apiGateway` / `adminGateway`（**读侧**）自 **2026-09-08** 起未再部署。

### 4.2 线上 apiGateway 读路径实读（968 行）

| 项 | 实测 |
|---|---|
| `require` 块 | 行 **10–19**；末条 = `require('./common/utils/ml-shadow')`。行 20 空行，行 21 = `const app = ...` |
| `v365-publish-store` | ⛔ **0 命中** |
| `v365-active-read` | ⛔ **0 命中** |
| `gen1-ui-view-model`（PR-UI-01 三层契约） | ⛔ **0 命中** |
| 决策读点 | 行 **449** `orderBy: [{ field: 'decision_date', direction: 'desc' }]`（dashboard）· 行 **551** 同 + `limit: 500`（decisions）· 行 **460** `orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 1` |
| 命中 `FORBIDDEN_READ_PATTERNS` | ✅ **命中** —— 正是 `LATEST_DECISION_BY_DATE` / `LATEST_SNAPSHOT_BY_DATE` 形态 |

### 4.3 线上 HTTP 响应形状实读（★ 独立的第二重确认）

| 端点 | HTTP | 顶层键 | `authority` | `mutable_axis` |
|---|---|---|---|---|
| `/api/dashboard` | 200（13749 B） | `['engine_mode','v3_mode','ml_shadow','three_questions','overview','cards']` | ⛔ **无** | ⛔ **无** |
| `/api/etf/list` | 200（2157 B） | `['list']` | ⛔ **无** | ⛔ **无** |
| `/api/etf/513310/decisions` | 200（172484 B） | `list[33]`（来自 `decision_result`） | — | — |
| `/api/constants` | 200（4751 B） | `[… , 'engine_version','runtime_status']` | — | — |

对比 `repo@dist` 的**已迁移**版本会额外返回 `authority`（`buildAuthoritativeProvenance(auth)`）
与 `mutable_axis`（`dist-functions/apiGateway/index.js:478-479` / `:537-538`）——
**线上两者皆缺** ⇒ **部署侧确为迁移前版本**。

⚠️ 另注：线上 `/api/dashboard.overview.snapshot_date = '2026-09-30'`、`cards[*].data_time = '2026-09-29'`
—— 与「`decision_result` max `decision_date` = 2026-09-29、`portfolio_snapshot` max = 2026-09-30」**逐值吻合**
⇒ 线上消费的就是那两个 **ENFORCE 下已停写**的 legacy 集合。

### 4.4 线上 adminGateway（998 行）

| 项 | 实测 |
|---|---|
| ModTime | 2026-09-08 11:32:23 |
| `v365-*` / `run_candidate` / `active_run_pointer` | ⛔ **0 命中** |
| `getGen1Health()`（L33）读点 | L43 `orderBy date desc, limit 1`（`ml_shadow_signal`）；L46 `orderBy trade_date desc, limit 10`；仅暴露 `GET /api/admin/gen1/health`（L973） |
| 决策读点 | L672 / L754 `orderBy snapshot_date desc`（legacy `portfolio_snapshot`） |

### 4.5 ★ 结论

```text
PRODUCTION_READ_SOURCE = decision_result（LEGACY，ENFORCE 下已停写）
                       + portfolio_snapshot（LEGACY，同）

Gen-1 promoted result → 是否进入 production read source？  ⛔ 否

GEN1_PRODUCTION_READ_PATH_INTEGRATION = MISSING
```

**性质定性（owner §4 原文「这属于真正的功能 / 生产集成缺口，不是 Evidence 缺口」）**：✅ **确认**
—— 缺的不是字段、不是契约、不是 Evidence，而是**读侧函数从未部署迁移版本**。

---

## 5. Selector / Effective / ml_effective（owner §5）

⛔ 本轮**不修改** N-1～N-3；⛔ **不再把 `production_engine` 当作 Engine Identity 权威来源**（已由
`GEN1_ENGINE_IDENTITY_RECONCILIATION_20261002.md` 裁定 `LABEL_DERIVATION_ONLY` / `CASE A`）。

| 问题（owner 逐条） | 答复 | 证据 |
|---|---|---|
| **谁决定 V3 / V3.8？** | `trend_stage_enabled`（默认 `true`）。公式：`primary = trendStageEnabled === true ? v3Result : v38Result`；`engine_path = trendStageEnabled === true ? 'v3' : 'v38'` | 线上 rde `trendStageEnabled` 15 处条件位；★ 实读 `decision_result.engine_path='v3'` ⇒ 走 V3 |
| **谁决定 Gen-1 是否「有效」？** | `gen1_guarded_effective_active`（= `effective_guarded` ∧ 三钥匙 ∧ health 正控 ∧ seal）。当前 **`false`** | ★ 线上 `runtime_status.gen1_guarded_effective_active = False` |
| **谁决定 Gen-1 是否成为 production decision source？** | `selectGuardedResult()`（`gen1-guarded-selector.js:73-102`）—— **硬编码 BASELINE**：`const authoritativeSource = SELECTOR_SOURCE.BASELINE; const selected = baseline;`；且 `if (authoritativeSource === GUARDED) throw`（L95-97）、`if (selected !== baseline) throw`（L98-100）；`GE_02_BASELINE_AUTHORITATIVE = true`（L31） | ★ 线上 rde **`gen1_guarded_selector_source: 'BASELINE'` 为字面量硬编码（L1606）**；★ 实读 `run_candidate_decision[*].gen1_guarded_selector_source='BASELINE'` |
| **`ml_effective` 在哪里真正被消费？** | ⛔ **在读取侧零消费**。① 写入侧：`runtime_status.ml_effective`（单向 alias ← `guardedEffectiveActive`，线上 rde L1552）与 `shadow_v3_log`（L1724）；② 读取侧 `apiGateway` / `adminGateway` **`ml_effective` 0 命中**；③ 线上 `/api/dashboard.ml_shadow` 由 `ml-shadow.js` **视图模型**产出（线上 apiGateway L19 require），**不受** `runtime_status.ml_effective` 驱动 | ★ online-codeinfo（三函数 grep）+ ★ online-http |
| **`production_engine`** | 仅**标签写入**（`runtime_status` / `decision_result` / `shadow_v3_log`），⛔ 不作身份权威 | 前轮 CASE A 裁定 |

### 5.1 三项分权表（⛔ 三条轴，不得合并）

| 决策问题 | 权威开关 | 载体 | 当前值 | 是否可在**不部署**的前提下翻转 |
|---|---|---|---|---|
| V3 还是 V3.8 | `trend_stage_enabled` | `param_config` | `true` | ✅ 可（但属生产写，未授权） |
| Gen-1 是否 effective | `gen1_guarded_effective_active` | 派生（三钥匙 ∧ health ∧ seal） | `false` | ⛔ 否（依赖 health 恢复 + 三钥匙） |
| Gen-1 是否成为 decision source | `selectGuardedResult()` 的**代码常量** | 源码 | `BASELINE`（硬编码） | ⛔ **否** —— **须改代码 + 部署**（⛔ 非开关） |

---

## 6. Health Gate（owner §6 · ⛔ 只记录，不恢复）

| 项 | 值 | 来源 |
|---|---|---|
| `runtime_data_health` | `DEGRADED` | ★ online-db `runtime_status` |
| 根因标的 | `515880` / `STATISTICAL_MISSING` | 上游诊断件 §11.3 |
| `gen1_health_status`（latch） | `DEGRADED` | ★ online-db |
| `gen1_health_gate_status` | `ACTIVE` | ★ online-db |
| `gen1_health_manual_review_required` | `true` | ★ online-db（rde L1571） |
| `gen1_health_economic_status` | `PENDING` | ★ online-db |
| 恢复端点 | ⛔ **不存在**（`manualReviewConfirmed` 生产 CALLER COUNT = 0；`adminGateway` 仅 `GET /api/admin/gen1/health`） | ★ online-codeinfo adminGateway（0 命中写端点） |
| 授权 | `AG-1` / `AG-2` / `AG-3` 均 `NOT GRANTED` | 上游诊断件 §5 |

```text
HEALTH_READY = NOT READY
```

**本 Gate 的处置**：⛔ 未调用任何恢复函数；⛔ 未写 `gen1_health_state`；⛔ 未改 `manualReviewConfirmed`；
仅将 Health 登记为 **`GEN1_IN_DECISION_CHAIN` 的前置条件**（见 §11 `G8`）。

---

## 7. Evidence Chain（owner §7 · ⛔ 逐项标记，不得因 Seal 已 SEALED 而顺延）

| # | 项 | 标记 | 证据 |
|---|---|---|---|
| 1 | `CONTRACT_FROZEN` | ✅ **DONE** | `GEN1_EVIDENCE_CONTRACT_V6.md` = `7e3e5d87…272e`（`O-1`，V5.0 = `SUPERSEDED`） |
| 2 | `TOOL_ALIGNED` | ✅ **DONE** | `c1_capture.py` `d0acc9e4…a4337` · `c1_gate_redproof.py` `e795c934…aba0` 同批迁 V6 |
| 3 | `FREEZE_SEALED` | ✅ **DONE** | `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json`（7 绑定；`sha256lf` 口径） |
| 4 | `EVIDENCE_EXECUTION_STARTED` | ⛔ **NOT STARTED** | `V3.6.6_FREEZE = NOT AUTHORIZED` · `EVIDENCE_EXECUTION = NOT AUTHORIZED` |
| 5 | `INDEPENDENT_EVENTS_QUALIFIED` | ⛔ **NOT QUALIFIED** | `gen1_guarded_evidence_independent_events = 0`（门槛 30）· ★ online-db |
| 6 | `EVIDENCE_SEALED` | ⛔ **NOT SEALED** | `gen1_guarded_evidence_seal_status = 'PENDING'` · ★ online-db |
| 7 | `GE04_READY` | ⛔ **NOT READY** | `GE_02_BASELINE_AUTHORITATIVE = true`（selector dormant）· 前 6 项未成立 |
| 8 | `GE04_AUTHORIZED` | ⛔ **NOT AUTHORIZED** | owner 明文 |

⚠️ **必须分离的四件事**（⛔ 不得互相推导）：
**契约能否冻结**（①②③，已完成）≠ **Evidence 能否执行**（④，未开始）≠
**生产读链是否需要修**（§4 B-1，**需修**，且**与 Evidence 正交**）≠ **授权是否允许上线**（⑧，未授权）。

⚠️ 补充：`gen1_guarded_freeze_seal_status = 'PENDING'` / `gen1_guarded_evidence_seal_status = 'PENDING'`
—— 这是 **Key 2 的四绑定字段**（⛔ 零改动对象），与 §7③ 的 **V6 Evidence Freeze Seal** 是**两个不同的封印对象**，
⛔ 不得因为 V6 Seal 已 SEALED 就把 Key 2 的 `PENDING` 读成已完成。

⚠️ 契约侧读源选择器 = **`S-PROMOTED`**（V6.0 §3.0.2）：Evidence 对象必须是**已提升** run
（`active_run_pointer[scope="production"].run_id`）⇒ 受 §1 第 7 环「pointer 自 09-30 未前进」约束。

⚠️ 读侧审计字段 `reader_migration_status` 的 `reason` 映射语义为 **`REGISTERED`**（登记态），
⛔ **`REGISTERED` ≠ `MIGRATED`** —— 不得把「已登记」读成「已迁移」（这正是 §4 的 B-1 缺口）。

---

## 8. Safety / Fail-closed（owner §8）

要求：**failure → no promotion → no production decision mutation**。

| # | 机制 | 实现位置（线上） | 状态 | 证据 |
|---|---|---|---|---|
| 1 | **health fail-closed** | `gen1-health-state.js` latch → `healthStateToGate()`；`canary_allowed` 要求 `healthGate.allow_canary === true` | ✅ IMPLEMENTED | ★ online-codeinfo `runGen1ShadowEod` L197 / L211-215；`runtime_status.gen1_health_gate_status='ACTIVE'` |
| 2 | **candidate validation fail-closed** | `validateCandidateSet()` → `mixed_date_detected` 同日性门 | ✅ **已真实触发** | ★ online-db `run_manifest` 10-01 `validation_passed=false` |
| 3 | **promotion fail-closed** | `planPointerPromotion()`（R1 finality COMPLETE ∧ R2 validation ∧ R3 monotonic revision ∧ R4 supersede 留痕 ∧ R5 CAS） | ✅ IMPLEMENTED | `v365-atomic-publish.js:22-27`（语义）；线上 rde `publishCandidateFirst`（L1359） |
| 4 | **pointer CAS** | 单文档条件 CAS；`expected_pointer` 必须与当前逐位一致，否则 HOLD；`CAS_REASON` 单一来源 `v365-publish-store.js` | ✅ IMPLEMENTED | ★ online-db `run_history.cas_reason='PROMOTED'`；`read_after_write_consistent=true`（写后独立回读一致性） |
| 5 | **read-path fail-closed** | 迁移版有：`activeRead.readAuthoritativeDataset()`，pointer 缺失 ⇒ fail-closed（⛔ 不回退 latest） | ⛔ **NOT DEPLOYED** | ★ online-codeinfo apiGateway **0 命中 `v365-active-read`**；★ online-http 无 `authority` 键 |
| 6 | **selector failure** | `selectGuardedResult()` 两条硬断言 `throw` | ✅ IMPLEMENTED（**dormant**） | `gen1-guarded-selector.js:95-100` |
| 7 | **missing input** | `runGen1ShadowEod`：官方 EOD 日期不齐 ⇒ `throw`；bar < 60 ⇒ `throw`；概率非法 ⇒ `throw` | ✅ IMPLEMENTED | ★ online-codeinfo L91 / L151-153 / L161-163 |
| 8 | **stale data** | `computeFinality` + `name_date_alignment`（`CASE_A_ALL_EXPECTED`） | ✅ IMPLEMENTED | ★ online-db `v365_run_integrity.date_alignment_case='CASE_A_ALL_EXPECTED'` |
| 9 | **partial data** | `classifyCandidateSet` 要求 `expected_codes` 全覆盖 | ✅ IMPLEMENTED | `v365-atomic-publish.js:116-145` |

**判定**：写侧 fail-closed **齐备**（且已被真实触发）；**读侧 fail-closed 缺失** —— 线上读侧仍以
`orderBy(...desc).limit(1)` **猜**权威结果，⛔ 无任何 fail-closed 语义 ⇒ 归入 `B-1` / `G-1`。

---

## 9. Rollback（owner §9 · ⛔ 不执行）

| # | 回滚对象 | IMPLEMENTED | TESTED | PRODUCTION_READY | AUTHORIZED |
|---|---|---|---|---|---|
| 1 | Gen-1 candidate rollback | ⛔ 否（无 Gen-1 candidate 实体） | ⛔ 否 | ⛔ 否 | ⛔ 否 |
| 2 | promotion rollback | ⛔ 否（CAS promotion **无逆操作**；`run_history` 为 append-only，⛔ 设计上不可回退） | ⛔ 否 | ⛔ 否 | ⛔ 否 |
| 3 | selector rollback | ⛔ 否（selector 恒 BASELINE，无「切回」语义） | ⛔ 否 | ⛔ 否 | ⛔ 否 |
| 4 | effective routing rollback | ⚠️ **仅配置级**：`trend_stage_enabled` 可改回 `false` ⇒ 回落 V3.8；但⛔ 属生产写，未授权 | ⛔ 否 | ⚠️ 部分（配置可逆） | ⛔ 否 |
| 5 | production read rollback | ⛔ 否（读侧从未部署迁移版 ⇒ 无「回滚」对象；一旦部署则回滚 = 重新部署旧包，⛔ 无 runbook） | ⛔ 否 | ⛔ 否 | ⛔ 否 |

**证据**：全仓（含线上 5 函数 `CodeInfo`）检索 `rollback` / `undo*` **零命中函数定义**；
`GEN1_CANARY_GO_LIVE_RUNBOOK.md` **零 `ROLLBACK` 章节**。

⇒ 统一标记：`ROLLBACK = NOT_IMPLEMENTED / NOT_TESTED / NOT_AUTHORIZED`。

---

## 10. Observability / Audit（owner §10）

目标问题：**某一个 production decision → 由哪个 engine → 哪一次 Gen-1 signal → 哪一个 candidate
→ 哪一次 validation → 哪一次 promotion → 哪个 pointer revision → 最终被哪个 read path 消费。**

| 追溯段 | 可用字段 | 状态 |
|---|---|---|
| decision → engine | `decision_result.engine_path` · `engine_version` · `engine_mode` · `config_version` | ✅ 可追溯 |
| decision → run | `run_id`（`run_candidate_decision.run_id`） | ✅ 可追溯（**仅 candidate 集合**；`decision_result` 无 `run_id`） |
| run → Gen-1 signal | `gen1_run_id` · `gen1_candidate_hash` | ⚠️ **部分**（当前 active run 为 `None`；仅未提升 run 有值） |
| signal → candidate | — | ⛔ **断**（无 Gen-1 candidate 实体） |
| run → validation | `run_manifest.validation_passed` / `validation_reason` | ✅ 可追溯 |
| run → promotion | `run_history.promoted` · `cas_reason` · `promoted_at` · `read_after_write_consistent` | ✅ 可追溯 |
| run → pointer revision | `active_run_pointer.revision` · `run_history.revision` · `supersedes_run_id` · `same_trade_date_supersede` · `promoted_from_run_id` | ✅ 可追溯 |
| **decision → 最终 read path** | ⛔ **线上读侧无 provenance 输出**（无 `authority` / `authority_selector` / `read_axis`） | ⛔ **不可追溯** |

```text
AUDIT_CHAIN_INCOMPLETE = YES
```

**断点定位（两处，⛔ 不自行补字段）**：
1. `signal → candidate` 段**不存在**（结构性缺失，非字段缺失）；
2. `decision → read path` 段**线上无 provenance 输出**（迁移版本会输出 `authority`，但**未部署**）。

⛔ 本件**不新增任何字段**、不改 schema。

---

## 11. ★ `GEN1_IN_DECISION_CHAIN` AND 条件表（owner §11）

### 11.1 主表（owner 所列 G1–G15）

| ID | 条件 | 判定 | 依据 |
|---|---|---|---|
| **G1** | `G1_FUNCTIONAL_COMPLETE` | ⚠️ **PARTIAL** | signal/validation/promotion 已实现；**candidate 实体缺失** |
| **G2** | `G2_SIGNAL_PRODUCTIONIZED` | ✅ **PASS**（链到 candidate 除外） | §2 全项 ✅，唯 `signal→candidate` ❌ |
| **G3** | `G3_CANDIDATE_CHAIN_COMPLETE` | ⛔ **FAIL** | Gen-1 candidate **不存在**（§3） |
| **G4** | `G4_PROMOTION_COMPLETE` | ⚠️ **PASS（非 Gen-1）** | ✅ 机制存在且真实触发；但提升的是 **V3 结果**，⛔ 非 Gen-1 |
| **G5** | `G5_ACTIVE_POINTER_COMPLETE` | ⚠️ **PASS（非 Gen-1）** | pointer 存在、revision=1、可追溯；⛔ 不指向 Gen-1、**零消费者** |
| **G6** | `G6_PRODUCTION_READ_PATH_CONNECTED` | ⛔ **FAIL** | §4 `GEN1_PRODUCTION_READ_PATH_INTEGRATION = MISSING` |
| **G7** | `G7_EFFECTIVE_ROUTING_VERIFIED` | ✅ **PASS** | `trend_stage_enabled=true` ⇒ `engine_path='v3'`（CASE A 已裁定） |
| **G8** | `G8_HEALTH_READY` | ⛔ **FAIL** | `HEALTH_READY = NOT READY`（§6） |
| **G9** | `G9_FAIL_CLOSED_VERIFIED` | ⚠️ **PARTIAL** | 写侧齐备（已真实触发）；**读侧缺失** |
| **G10** | `G10_ROLLBACK_READY` | ⛔ **FAIL** | §9 五项全 `NOT_IMPLEMENTED` |
| **G11** | `G11_OBSERVABILITY_COMPLETE` | ⛔ **FAIL** | `AUDIT_CHAIN_INCOMPLETE = YES`（§10） |
| **G12** | `G12_EVIDENCE_EXECUTION_COMPLETE` | ⛔ **FAIL** | 未开始（§7④） |
| **G13** | `G13_INDEPENDENT_EVENTS_QUALIFIED` | ⛔ **FAIL** | `independent_events = 0` / 门槛 30 |
| **G14** | `G14_EVIDENCE_SEALED` | ⛔ **FAIL** | `gen1_guarded_evidence_seal_status = 'PENDING'` |
| **G15** | `G15_GE04_AUTHORIZED` | ⛔ **FAIL** | `NOT AUTHORIZED` |

### 11.2 ★ 差异登记（owner 明文：「如果源码 / Charter 证明实际条件不同，以证据为准，并记录差异」）

| # | 差异 | 证据 | 处置 |
|---|---|---|---|
| **D-1** | **须**新增条件 **`G16_SELECTOR_CUTOVER_PATH_EXISTS`** | `selectGuardedResult()` 恒返回 BASELINE 且 `GUARDED` 分支 `throw`（`gen1-guarded-selector.js:31/80/95-100`）；`GEN1_GUARDED_EFFECTIVE_CHARTER.md` §4.3 自述翻选择器属 **WP-G1-GE-04**（须 Evidence Gate PASS + 显式裁决 + 新 runbook） | **增列 G16**（⛔ 非 G6/G7 的子集：G6 是「部署读侧」，G16 是「存在可执行的 cutover 代码路径」） |
| **D-2** | **须**新增条件 **`G17_GEN1_HAS_EFFECT_ON_DECISION`** | `gen1_adopted = false`（10/10 行）；`decision_source = 'V361_SAFETY_CORE'`（⛔ 非 `..._WITH_GEN1`） | **增列 G17** —— 否则会得出「读侧接通即上线」的错误结论 |
| **D-3** | **须**把「读侧 fail-closed」从 G9 中**拆出**为独立判据 | §8 第 5 行：迁移版有、线上无 | 记入 **G9-b**（G9 拆为写侧 G9-a / 读侧 G9-b） |
| **D-4** | G4 / G5 的「PASS」**不等于** Gen-1 条件成立 | pointer 指向的 run `gen1_run_id=None` | ⛔ 表内已显式标注「（非 Gen-1）」，⛔ 不得当 Gen-1 条件计分 |
| **D-5** | `HEALTH_READY` 与 `GEN1_IN_DECISION_CHAIN` **不同轴** | 健康是 Gen-1 的**前置**；读链是**集成**问题 | 已分列 G6 / G8 |

### 11.3 最终 AND 判定

```text
GEN1_IN_DECISION_CHAIN = NOT READY
```

最短路径（供 owner 决策，⛔ 本 Gate 不实施、不排序、不建议版本号）：
`G3`（建 Gen-1 candidate 实体）→ `G16`（建 cutover 代码通路）→ `G6`（部署读侧迁移）
→ `G17`（Gen-1 真正影响决策）→ `G8/G10/G11`（Health / Rollback / Audit）→ `G12/G13/G14/G15`（Evidence / 授权）

---

## 12. ★ 未完成项七分类（owner §12）

> 分类：`A`=FUNCTIONAL GAP · `B`=PRODUCTION INTEGRATION GAP · `C`=HEALTH/SAFETY GAP ·
> `D`=EVIDENCE GAP · `E`=AUTHORIZATION GAP · `F`=OBSERVABILITY/AUDIT GAP · `G`=ROLLBACK/FAIL-CLOSED GAP

### A 类 —— 功能缺口

| ID | DESCRIPTION | SOURCE | CURRENT STATE | REQUIRED STATE | BLOCKS? | PROD WRITE? | OWNER AUTH? |
|---|---|---|---|---|---|---|---|
| **A-1** | **Gen-1 candidate 实体不存在** —— 无「由 Gen-1 signal 产出的 candidate」这一持久化对象 | ★ online-db `run_candidate_decision` 10/10 行 `gen1_adopted=false` · `gen1_candidate_hash=None` | 不存在 | 存在带 `gen1_run_id` / `gen1_candidate_hash` 的 Gen-1 candidate | **YES**（G3/G17） | YES（新增写入路径） | **YES** |
| **A-2** | **selector cutover 无代码通路** —— `selectGuardedResult()` 硬编码 BASELINE，GUARDED 分支 `throw` | `gen1-guarded-selector.js:31/80/95-100`；线上 rde L1606 字面量 `'BASELINE'` | 无通路 | 存在显式、可审计的 cutover 代码路径 | **YES**（G16/G17） | YES（代码变更 + 部署） | **YES** |
| **A-3** | `ml_effective` 无独立通路（单向 alias） | 线上 rde L1549-1552；★ `runtime_status.ml_effective=False` | `false`（派生） | 若需独立语义则须另建 | NO（当前 READ 侧不消费） | NO | **YES** |

### B 类 —— 生产集成缺口

| ID | DESCRIPTION | SOURCE | CURRENT STATE | REQUIRED STATE | BLOCKS? | PROD WRITE? | OWNER AUTH? |
|---|---|---|---|---|---|---|---|
| **B-1** ★ | **读侧迁移从未部署** —— 线上 `apiGateway`(ModTime 2026-09-08) / `adminGateway`(同) 无 `v365-active-read`，仍 `orderBy(decision_date desc)` | ★ online-codeinfo + ★ online-http（无 `authority` 键） | `PRODUCTION_READ_SOURCE = decision_result`（legacy） | 读侧按 `active_run_pointer` pin run 读取 | **YES**（G6） | YES（部署） | **YES** |
| **B-2** | **Gen-1 产物零消费者** —— `run_candidate_*` / `active_run_pointer` / `run_manifest` / `run_history` 线上无读者 | ★ online-codeinfo 三函数 0 命中；★ online-http 无相关键 | 零消费者 | 至少一个生产读者（= B-1 的兑现） | **YES** | YES | **YES** |
| **B-3** | **被消费集合已停写** —— `decision_result` 止于 2026-09-29；`portfolio_snapshot` 止于 2026-09-30（ENFORCE 下改写 candidate） | ★ online-http `data_time='2026-09-29'`；线上 rde L544-563 | 前台/后台读 ENFORCE 前旧数据 | 读链与写链同代 | **YES** | YES | **YES** |
| **B-4** | `apiGateway` / `adminGateway` 线上源码与**仓库任一版本皆不同**（三源皆异） ⇒ 部署来源不可回溯 | §4.1 指纹表 | `8b210345…` / `ea8cac72…` 无本地对应 | 部署来源可审计（remote-visible + audited） | **YES**（部署门禁） | NO（只读重建） | **YES** |
| **B-5** | `V365_ENFORCE_SWITCH_DATE` 未登记 ⇒ CLASS C 双源不可判定 | `repo@dist` `v365-active-read.js` | `null` | 已登记 | NO | YES（配置） | **YES** |
| **B-6** | `RUN_HISTORY_INDEX = PENDING` ⇒ `run_axis_available=false` / `coverage=legacy_only` | 同上 | `PENDING` | 已建索引 | NO | YES | **YES** |

### C 类 —— Health / 安全状态缺口

| ID | DESCRIPTION | SOURCE | CURRENT STATE | REQUIRED STATE | BLOCKS? | PROD WRITE? | OWNER AUTH? |
|---|---|---|---|---|---|---|---|
| **C-1** | 健康闩锁 `DEGRADED`；根因 `515880` / `STATISTICAL_MISSING`；`recovery_allowed=false` | ★ `runtime_status.gen1_health_status='DEGRADED'` | DEGRADED | `OK` + `gate_status=ACTIVE` | **YES**（G8） | NO（先修数据） | **YES** |
| **C-2** | **无生产恢复端点** —— `manualReviewConfirmed` CALLER COUNT = 0 | ★ online-codeinfo adminGateway（仅 `GET /api/admin/gen1/health`） | 无端点 | 有受控恢复端点 | **YES**（G8） | YES（部署） | **YES** |
| **C-3** | `515880` 具体缺失特征未定位（`missing_features` 未持久化） | `evaluateDataHealth()` 产出但未落库 | 未定位 | 已定位 | **YES**（C-1 前置） | NO | **YES** |
| **C-4** | 健康正控不成立 ⇒ 灰度硬阻断（`gen1_allow_canary=false` / `canary_active=false` / `invocations=0`） | ★ `runtime_status` | 阻断 | 正控成立 | **YES**（G8） | NO | **YES** |

### D 类 —— Evidence 缺口

| ID | DESCRIPTION | SOURCE | CURRENT STATE | REQUIRED STATE | BLOCKS? | PROD WRITE? | OWNER AUTH? |
|---|---|---|---|---|---|---|---|
| **D-1** | Evidence execution 未开始 | `V3.6.6_FREEZE = NOT AUTHORIZED` | NOT STARTED | STARTED + COMPLETE | **YES**（G12） | YES | **YES** |
| **D-2** | 独立事件 `0` / 门槛 `30` | ★ `gen1_guarded_evidence_independent_events=0` | 0 | ≥30 且合格 | **YES**（G13） | YES | **YES** |
| **D-3** | Evidence seal 未落 | ★ `gen1_guarded_evidence_seal_status='PENDING'` | PENDING | SEALED | **YES**（G14） | YES | **YES** |
| **D-4** | 资格层未成立（`canary_active=false`）—— **与读源正交** | §4 / §6 | 不成立 | 成立 | **YES** | NO | **YES** |
| **D-5** | ✅ 已完成项（登记以免被误判为缺口）：contract FROZEN / tool ALIGNED / freeze SEALED | §7①②③ | DONE | — | NO | NO | NO |

### E 类 —— Authorization 缺口

| ID | 待授权项 | CURRENT STATE | BLOCKS? | OWNER AUTH? |
|---|---|---|---|---|
| **E-1** | `V3.6.6_FREEZE` | `NOT AUTHORIZED` | YES（G12） | **YES** |
| **E-2** | `PRODUCTION_ATTESTATION` | `BLOCKED` / `NOT AUTHORIZED` | YES | **YES** |
| **E-3** | `EVIDENCE_EXECUTION` | `NOT AUTHORIZED` | YES（G12） | **YES** |
| **E-4** | `KEY 3 EVIDENCE SEAL` | `NOT AUTHORIZED` | YES（G14） | **YES** |
| **E-5** | `GE-04` | `NOT AUTHORIZED` | YES（G15） | **YES** |
| **E-6** | `AG-1` / `AG-2` / `AG-3`（生产写 / 部署恢复端点 / 修 `515880`） | `NOT GRANTED` | YES（G8） | **YES** |
| **E-7** | Git integration（push / PR merge / master reachability，X-5） | `PENDING` | NO | **YES** |
| **E-8** | `v3_6_1_enabled` 切换 | `EFFECTIVE_ENGINE_SWITCH_REQUIRES_SEPARATE_AUTHORIZATION` | NO | **YES** |
| **E-9** | **读侧迁移上线（B-1 的兑现路径）** | ⛔ 未授权（属生产变更） | **YES**（G6） | **YES** |
| **E-10** | **selector cutover（A-2 的兑现路径）** | ⛔ 未授权（属代码变更 + 部署） | **YES**（G16） | **YES** |

### F 类 —— Observability / Audit 缺口

| ID | DESCRIPTION | SOURCE | CURRENT STATE | REQUIRED STATE | BLOCKS? | PROD WRITE? | OWNER AUTH? |
|---|---|---|---|---|---|---|---|
| **F-1** | `signal → candidate` 追溯段不存在 | §10 | 断 | 连续 | **YES**（G11） | YES | **YES** |
| **F-2** | `decision → read path` 无 provenance 输出（线上读侧未部署迁移版） | ★ online-http 无 `authority` 键 | 不可追溯 | 可追溯 | **YES**（G11） | YES（随 B-1） | **YES** |
| **F-3** | `ml_shadow.effective` 由 `ml-shadow.js` **视图模型**产出（含硬编码 `engine_version:'v3.6.1'`，= 既有 N-3） ⇒ 读取侧不反映 `runtime_status.ml_effective` | ★ online-codeinfo apiGateway 0 命中 `ml_effective` | 脱钩 | 同源 | NO | YES | **YES** |
| **F-4** | `gen1_run_id` 在 **当前 active run** 上为 `None` ⇒ 「哪一次 Gen-1 signal」不可答 | ★ online-db | 缺失 | 有值 | **YES**（G11） | YES | **YES** |
| **F-5** ★ | **既有扫描门 `N-10` 断言域缺陷（KNOWN FALSE POSITIVE）** —— `v6_negative_scan.py` 的 N-10 为**文本扫描**，对「在 `⛔`-标记行内**枚举**被禁 token」误判为「越界肯定式声明」。命中源 = `docs/gen1/GEN1_ENGINE_IDENTITY_RECONCILIATION_20261002.md:377`（内容为 `R-21 ⛔ 三件同扫零放行式（…）` —— **检查项描述**，非肯定式声明） | 本 Gate 回归实跑：`v6_negative_scan.py` = 12 PASS / 1 FAIL（唯一 FAIL = N-10） | 1 项误报 | 断言域收敛（AST/结构化，或排除 `⛔`-标记行） | NO（不影响结论） | NO | **YES**（属 harness 变更；owner 已就 `N-9a AST 化` 示意，但**本 Gate 不动**） |

### G 类 —— Rollback / Fail-closed 缺口

| ID | DESCRIPTION | SOURCE | CURRENT STATE | REQUIRED STATE | BLOCKS? | PROD WRITE? | OWNER AUTH? |
|---|---|---|---|---|---|---|---|
| **G-1** | **读侧 fail-closed 缺失**（线上 `orderBy desc` 即「猜」权威结果，无 pointer-pin、无 fail-closed） | ★ online-codeinfo apiGateway L449 | 缺失 | 迁移版语义 | **YES**（G9-b） | YES（随 B-1） | **YES** |
| **G-2** | promotion / pointer **无回滚路径**（CAS 不可逆；`run_history` append-only 为设计不变量） | §9 | 无 | 有定义明确的前滚路径（roll-forward）或显式声明不可回滚 | **YES**（G10） | YES | **YES** |
| **G-3** | 读侧部署回滚 runbook 缺失 | `GEN1_CANARY_GO_LIVE_RUNBOOK.md` 零 `ROLLBACK` 章节 | 缺失 | 有 | **YES**（G10） | NO（文档） | **YES** |
| **G-4** | selector / effective routing 回滚未测 | §9 | 未测 | 已测 | **YES**（G10） | NO | **YES** |

### 12.1 汇总

| 类 | 条目数 | 🔴 阻塞 `GEN1_IN_DECISION_CHAIN` | 需生产写 | 需 owner 授权 |
|---|:--:|:--:|:--:|:--:|
| **A** FUNCTIONAL | 3 | 2 | 2 | 3 |
| **B** PRODUCTION INTEGRATION | 6 | 4 | 5 | 6 |
| **C** HEALTH / SAFETY | 4 | 4 | 2 | 4 |
| **D** EVIDENCE | 5 | 4 | 4 | 4 |
| **E** AUTHORIZATION | 10 | 6 | — | 10 |
| **F** OBSERVABILITY / AUDIT | 5 | 2 | 3 | 5 |
| **G** ROLLBACK / FAIL-CLOSED | 4 | 4 | 3 | 4 |
| **合计** | **37** | **26** | **19** | **36** |

### 12.9 前身（初稿）5 类结构映射（⛔ 仅为连续性登记，**结构以 §12 七类为准**）

> 前身初稿使用 5 类；owner §12 改判为 7 类。为免引用歧义，此处保留前身 5 类的**标题与编号**，
> 并给出→七类的映射。⛔ **本件不保留前身正文**，⛔ 不得据旧编号反推结论。

| 前身标题 | 前身内容 | → 本件七类映射 |
|---|---|---|
| **A 类 —— 功能缺口** | A-1 selector cutover 无代码通路 · A-2 `ml_effective` 无独立通路 · A-3 执行层开关为代码级常量 · A-4 Key 2 四绑定字段未激活 | → **A-2**（同编号保留）· → **A-3**（同编号保留）· → A-3 的「设计如此」项撤销为**非缺口**（登记于 §2 / §12 A 类说明）· → A-4 并入 **D-3**（封印状态属 Evidence 轴） |
| **B 类 —— 生产集成缺口** | B-1 reader migration 未接线 · B-2 candidate/pointer 零消费者 · B-3 被消费集合已停写 · B-4 SWITCH_DATE 未登记 · B-5 RUN_HISTORY_INDEX PENDING · B-6 线上网关身份未复读 | → **B-1**（同编号，且**本 Gate 已升格为「从未部署」**）· → **B-2** · → **B-3** · → **B-5**（前身 B-4）· → **B-6**（前身 B-5）· → **B-4**（前身 B-6，**本 Gate 已由 `CodeInfo` 复读闭环**） |
| **C 类 —— Health / 安全状态缺口** | C-1 健康闩锁 DEGRADED · C-2 无生产恢复端点 · C-3 三项 AUTHORIZATION GATE 未授权 · C-4 健康正控不成立 | → **C-1** · → **C-2** · → C-3 拆入 **E-6**（授权轴）· → **C-4**；新增 **C-3**（`515880` 缺失特征未定位） |
| **D 类 —— Evidence 缺口** | D-1 V6.0 = FROZEN+SEALED ✅ · D-2 evidence execution 未开始 · D-3 independent_events=0 · D-4 selector = S-PROMOTED · D-5 读源绑定问题契约侧已解 | → **D-5**（已完成项，同义）· → **D-1** · → **D-2** · → D-4 并入 **§7 注**（S-PROMOTED 约束）· → D-5 的「生产侧未解」并入 **B-1** |
| **E 类 —— Authorization 缺口** | E-1…E-9（FREEZE / ATTESTATION / EXECUTION / KEY3 / GE-04 / AG-1·2·3 / Git / `v3_6_1_enabled` / reader migration 上线） | → **E-1…E-9**（同编号同义保留）；新增 **E-10**（selector cutover） |

---

## 13. 事故与红线登记（owner §13）

### 13.1 事件一：RED-PROOF 注入真实部署命令（前轮，⛔ 已如实落档）

上一 Gate（`GEN1_ENGINE_IDENTITY_RECONCILIATION`）打红自证 RP-C 首版曾把 `tcb fn deploy --force`
注入到脚本**模块级**，导致该命令**真的被执行**。零后果（三条独立证据：① `tcb` 是 413 B `#!/bin/sh`
wrapper，Windows Python `subprocess.run(['tcb',…])` 抛 `FileNotFoundError [WinError 2]`，进程未创建；
② 父目录 `cloudbaserc.json` 为 `"functions": []` 且 `functionRoot` 不存在、`envId` 为未解析模板 ⇒ 无函数可部署；
③ 线上 `tcb fn list` 实测 10 函数全 `Deployment completed`，10-02 修改 = **NONE**）。

```text
DEPLOY = 0  次
PRODUCTION MODIFICATION = 0
```

### 13.2 ★ 永久硬规则（owner 原文，本件正式登记为治理红线）

```text
RED_PROOF MUST NEVER EXECUTE REAL PRODUCTION COMMANDS
```

**允许的红证手段（仅此四类）**：`AST mutation` · `mock executable` · `synthetic command` · `isolated fake binary`

**永久禁止**：`subprocess → real tcb` · `subprocess → real git push` · `subprocess → real deploy` ·
`subprocess → real DB write`

**本 Gate 的执行纪律（已自证）**：
- 本 Gate 的 executable check 红证 **仅使用 `AST mutation`（合成源码字符串，永不落盘、永不执行）+
  内存内容变异**；红证 RP-A…RP-F 全部通过，**零子进程、零产物落盘**；
- ⛔ 注入内容不落在模块级 / `main()`；
- 顺带实读归档：既有 `c1_gate_redproof.py` 危险调用扫描 = **零命中**（`subprocess` / `os.system` /
  `os.popen` / `Popen` / `tcb` / `deploy` 全部 0）⇒ 既有红证工具**符合本红线**。

### 13.3 N-9a（AST 化）授权边界

owner 原文：«N-9a AST 化可作为只读工具安全修复继续推进，但只能修改 test/check harness，
不得修改 production code。»
⇒ 登记为**已授权范围**：`scripts/gen1/evidence-capture/**`（test/check harness）可 AST 化；
⛔ `cloudfunctions/**` / `src/**` / `ml/**` 一律**不得**触碰。
⚠️ 但**本 Gate 不动手**（owner §14：「不要在本 Gate 中修复任何…」）⇒ 相关项见 `F-5` / `N-9a` 待 owner 指令。

### 13.4 ★ 事件二：回归循环被动触发一次 C-1 Evidence Capture（本 Gate，⛔ 零后果）

| 项 | 事实 |
|---|---|
| 触发方式 | 本 Gate 回归使用 `ls *.py` 遍历全部 check 脚本，**未预期地包含**采集工具 `c1_capture.py`（前轮 14 套件清单**不含**它） |
| 执行次数 | **1 次** |
| 落盘产物 | `_evidence-capture-20261002/2026-09-30__attempt_20261002_214506.json`（6520 B）+ `.sha256`；⚠️ 目录**在仓库外**，符合该工具「只写仓库外归档目录」约束 |
| 门结果 | `gate_status = PASS`（`gate_checks` **14/14**） |
| **样本资格** | `checkpoint_ok = False` ⇒ `eligibility_pass = False` ⇒ `scoring = NON_SCORING`；`non_scoring_reason = "EXCLUDED_BY_§4.2：… ⇒ OFF_CHECKPOINT（§5.8）⇒ 不作为该日正式样本，⛔ 不倒填"` |
| 读源 | 8 源全部**只读**（`runtime_status` / `ml_shadow_signal` / `run_candidate_decision` / `run_candidate_portfolio` / `run_manifest` / `active_run_pointer` / `run_history` / `invocation_log`） |
| 危险调用 | 代码实读：该工具 `subprocess` **仅**用于 `logs search`（L315）；⛔ **零 deploy / 零 INSERT·UPDATE·DELETE** |

**零后果三条独立证据**：
1. **样本侧**：`scoring = NON_SCORING` + `non_scoring_reason` 显式排除 ⇒ ⛔ **未产生任何正式样本、
   未产生任何独立事件**（`independent_events` 仍 `0`）；
2. **通道侧**：工具硬约束 + 代码实读 ⇒ 云端仅 `logs search` + `db nosql execute(QUERY)`；
   写盘仅仓库外归档目录；
3. **生产侧零漂移**：★ 实读 `runtime_status.updated_at` 仍 = `2026-10-01T00:00:22.690Z`；
   `run_history` 仍 **2 行**、`run_candidate_decision` 仍 **10 行**、`active_run_pointer` 仍 **1 行 / revision 1**；
   线上 10 函数 `Modification time` 落在 2026-10-02 的 = **NONE**。

**登记定性**：`OPERATION SCOPE DRIFT — ZERO CONSEQUENCE`（回归命令面过宽）。
**后续硬规则（本 Gate 新增）**：⛔ 回归套件必须使用**显式白名单清单**，⛔ 禁止 `ls *.py` 式通配；
采集 / 部署 / 迁移类工具⛔ **不得**进入常规回归面。

---

## 14. 最终 STOP 输出（owner §14）

```text
GEN1_PRE_LAUNCH_INVENTORY = COMPLETE

FUNCTIONAL_GAPS = [
  A-1 Gen-1 candidate 实体不存在,
  A-2 selector cutover 无代码通路,
  A-3 ml_effective 无独立通路
]

PRODUCTION_INTEGRATION_GAPS = [
  B-1 读侧迁移从未部署（apiGateway/adminGateway ModTime=2026-09-08）,
  B-2 Gen-1 产物零消费者,
  B-3 被消费集合已停写（decision_result 止于 2026-09-29）,
  B-4 线上网关源码与仓库任一版本皆不同（部署来源不可回溯）,
  B-5 V365_ENFORCE_SWITCH_DATE 未登记,
  B-6 RUN_HISTORY_INDEX = PENDING
]

HEALTH_SAFETY_GAPS = [
  C-1 health latch DEGRADED / 根因 515880 STATISTICAL_MISSING,
  C-2 无生产恢复端点（manualReviewConfirmed CALLER=0）,
  C-3 515880 缺失特征未定位,
  C-4 健康正控不成立 ⇒ 灰度硬阻断
]

EVIDENCE_GAPS = [
  D-1 Evidence execution 未开始,
  D-2 independent_events=0 / 门槛 30,
  D-3 evidence_seal_status=PENDING,
  D-4 资格层未成立（canary_active=false）,
  D-5 [已完成] contract FROZEN / tool ALIGNED / freeze SEALED
]

AUTHORIZATION_GAPS = [
  E-1 V3.6.6_FREEZE, E-2 PRODUCTION_ATTESTATION, E-3 EVIDENCE_EXECUTION,
  E-4 KEY 3 EVIDENCE SEAL, E-5 GE-04, E-6 AG-1/AG-2/AG-3,
  E-7 Git integration, E-8 v3_6_1_enabled 切换, E-9 读侧迁移上线, E-10 selector cutover
]

OBSERVABILITY_GAPS = [
  F-1 signal→candidate 追溯段不存在,
  F-2 decision→read path 无 provenance 输出,
  F-3 ml_shadow.effective 与 runtime_status.ml_effective 脱钩,
  F-4 当前 active run 的 gen1_run_id = None,
  F-5 [工具误报] v6_negative_scan N-10 断言域缺陷（1 项，不影响结论）
]

ROLLBACK_GAPS = [
  G-1 读侧 fail-closed 缺失,
  G-2 promotion/pointer 无回滚路径,
  G-3 读侧部署回滚 runbook 缺失,
  G-4 selector / effective routing 回滚未测
]

GEN1_IN_DECISION_CHAIN = NOT READY

HEALTH_READY = NOT READY

V3.6.6_FREEZE = NOT AUTHORIZED
PRODUCTION_ATTESTATION = BLOCKED
EVIDENCE_EXECUTION = NOT STARTED
GE04 = NOT AUTHORIZED

PRODUCTION_WRITE = 0
DEPLOY = NO
ROLLBACK = NO
CANARY = OFF
MERGE = NO
TAG = NO

STOP = YES
```

### 14.1 附：`PRODUCTION_READ_SOURCE` 明确值（owner §4 必答项）

```text
PRODUCTION_READ_SOURCE = decision_result（legacy，ENFORCE 下已停写；max decision_date = 2026-09-29）
                       + portfolio_snapshot（legacy，同；max snapshot_date = 2026-09-30）

GEN1_PRODUCTION_READ_PATH_INTEGRATION = MISSING
```

---

## 15. 本 Gate 回归结果（★ 如实登记，含两项非全绿）

| 套件 | 结果 | 备注 |
|---|---|---|
| `v6_pre_launch_inventory_check.py`（★ 本件新建） | ✅ **76 PASS / 0 FAIL** | 只读；红证 RP-A…RP-F 全部通过（见 §13.2） |
| `v6_engine_identity_reconciliation_check.py` | ✅ 25 / 0 | |
| `v6_frozen_carrier_assertions.py` | ✅ 25 / 0 | |
| `v6_content_assertions.py` | ✅ 39 / 0 | |
| `v6_contract_compatibility.py` | ✅ 46 / 0 | |
| `v6_contract_tool_alignment.py` | ✅ 29 / 0 | |
| `v6_fingerprint_canonicalization_check.py` | ✅ 16 / 0 | |
| `v6_redproof.py` | ✅ 20 / 0 | |
| `v6_seal_binding_selfcheck.py` | ✅ 20 / 0 | |
| `v6_key2_immutability_check.py` | ✅ 13 / 0 | `KEY_2_IMMUTABLE = PASS` |
| `c1_capture_v6_migration_test.py` | ✅ 33 / 0 | |
| `r3_contract_consumption_test.py` | ✅ 12 / 0 | |
| `checkpoint_python_js_parity.py` | ✅ 6 / 0 | |
| `v6_health_blocker_diagnostic_check.py` | ⚠️ **28 PASS / 1 FAIL** | `H-28` 要求 INVENTORY 件保留 A–E 五类标题 + owner 六问原文；本件已按 owner §12 改判 **7 类** ⇒ **本件补入 §12.9（五类映射）+ §16（owner 六问逐项）后应回绿**（⛔ 未改闸门，仅补本件内容） |
| `v6_negative_scan.py` | ⚠️ **12 PASS / 1 FAIL** | `N-10` **KNOWN FALSE POSITIVE**（见 `F-5`）：文本扫描把「`⛔`-标记行内的枚举」误判为肯定式声明。⛔ **本 Gate 不改闸门、不改历史交付物**（避免「改被检对象以过检」），登记并路由 owner |

**处置原则**：两项非全绿**均为工具/文档面**，⛔ 与生产、⛔ 与结论、⛔ 与放行无关；
⛔ 本 Gate 不做修复（owner §14）。

---

## 16. owner 六问逐项答复（★ 承前件，⛔ 结论未变，仅重述可核）

| # | 问题 | 答复 | 本 Gate 新增证据 |
|---|---|---|---|
| 1 | **production read path 是否仍读取 `decision_result`？** | **是**。线上 `apiGateway.index.js:449 / :551`（`orderBy decision_date desc`）、`adminGateway` L672 / L754；且均**命中** `FORBIDDEN_READ_PATTERNS` | ★ 本 Gate 由**线上 `CodeInfo` 实读 + 线上 HTTP 响应形状**双重闭环（§4.2 / §4.3）；前身标 `NOT RE-READ` 的 `apiGateway` / `adminGateway` 身份**已闭环** |
| 2 | **candidate / pointer 是否真正进入线上消费者？** | **否**。线上三函数对 `run_candidate_*` / `active_run_pointer` **0 命中** | ★ §4.2 / §4.4 |
| 3 | **Gen-1 promoted result 是否真正成为 production decision input？** | **否**。当前 active run `gen1_run_id=None`、`gen1_adopted=False` | ★ §1.2 |
| 4 | **selector cutover 条件是什么？** | **代码级不存在通路**：`selectGuardedResult()` 硬编码 BASELINE，GUARDED 分支 `throw` ⇒ 前置 = **修改 selector 代码**（解除 GE-02 硬不变量）**而非**翻开关 | ★ 线上 rde L1606 字面量 `'BASELINE'` |
| 5 | **`ml_effective` 条件是什么？** | ① 为 `gen1_guarded_effective_active` 的**单向 alias**；② 上游 `effective_guarded` 须成立（selector 侧成立 + 守门全过）；③ 健康正控须成立（当前 `DEGRADED` ⇒ 阻断） | ★ 线上读侧 `ml_effective` **0 消费**（§5） |
| 6 | **`auto_execution` 与 GE-04 的边界是什么？** | **不同轴**：`gen1_auto_execution` = 执行层开关，schema 自述「恒 false」，属**代码级不变量**（⛔ 非授权可开）；GE-04 = **独立治理 Promotion Gate**（授权轴，当前 `NOT AUTHORIZED`） | ★ 线上 rde L1563 字面量 `gen1_auto_execution: false` |

---

## 17. 四块式零修改断言 + 复算命令

```text
ETF 仓库（载体树 _g1-contract-v5-20261002）：
- Git 跟踪文件：GEN1_PRE_LAUNCH_INVENTORY_20261002.md 为正式版重写（含 §12.9 / §16 补入）
- Git 历史 / 分支 / 远端：零修改（⛔ 未 push / 未 merge / 未 tag）
- 未跟踪本地草稿：新增 scripts/gen1/evidence-capture/v6_pre_launch_inventory_check.py（本件新建，未跟踪）
  既有：_diff_v5_v6.txt · scripts/gen1/evidence-capture/out/
其他本机文件：
- WorkBuddy 记忆文件：有修改（见本轮 memory 落档）
- ★ 新增只读取证归档：_cb-connect-20260921/codeinfo_20261002/*.index.js ·
  fndetail_*_20261002.json · probe_api_*_20261002.json（⛔ 均为只读取回，非生产物）
- ⚠️ _evidence-capture-20261002/2026-09-30__attempt_20261002_214506.json（+.sha256）：
  回归循环被动触发 1 次采集（scoring=NON_SCORING），详见 §13.4
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- DB（decision_result / portfolio_snapshot / run_candidate_* / active_run_pointer / run_manifest /
      run_history / runtime_status / ml_shadow_signal / gen1_health_state）：零写入
- ⛔ 未调用 manualReviewConfirmed · 未写 gen1_health_state · 未加恢复端点 · 未改 selector
- ⛔ 未 deploy / 未回滚 / 未切 canary / 未调任何函数执行入口
      （仅 `fn list` / `fn detail` 与只读 HTTP GET、只读 QUERY/find 与 COMMAND/count）
```

复算命令（全部只读）：

```bash
A="D:/AI-Projects/Codex/etf-decision-engine/_cb-connect-20260921"
NODE="C:/Users/iquel/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
CLI="C:/Users/iquel/.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/dist/standalone/cli.js"
PY="C:/Users/iquel/.workbuddy/binaries/python/versions/3.13.12/python.exe"

# 1) 线上源码身份（★ 本 Gate 核心证据）
"$NODE" "$CLI" fn detail apiGateway   -e tradingview-etf-d0fa42yy57cbc11b --json > "$A/fndetail_apiGateway_20261002.json"
"$NODE" "$CLI" fn detail adminGateway -e tradingview-etf-d0fa42yy57cbc11b --json > "$A/fndetail_adminGateway_20261002.json"

# 2) 部署时点
"$NODE" "$CLI" fn list -e tradingview-etf-d0fa42yy57cbc11b --json | grep -E "FunctionName|ModTime"

# 3) 线上 HTTP 响应形状（B-1 第二重确认）
curl -sS "https://tradingview-etf-d0fa42yy57cbc11b-1253568636.tcloudbaseapp.com/apiGateway/api/dashboard" \
  | grep -o '"authority"\|"mutable_axis"' || echo "0 命中 ⇒ 迁移版未部署"

# 4) 八源只读复核
cd "$A" && "$PY" cb_query.py run_candidate_decision --limit 12
"$PY" cb_query.py run_history --limit 12
"$PY" cb_query.py active_run_pointer --limit 5

# 5) 本件 executable check（只读；含 §13 红线自证）
cd "D:/AI-Projects/Codex/etf-decision-engine/_g1-contract-v5-20261002"
"$PY" scripts/gen1/evidence-capture/v6_pre_launch_inventory_check.py
"$PY" scripts/gen1/evidence-capture/v6_pre_launch_inventory_check.py --redproof RP-A   # 亦 RP-B…RP-F
```

⛔ **STOP**：本件为**只读盘点**，⛔ 不含任何授权、不含任何放行、⛔ 不修复任何缺口、⛔ 不设计下一版本。
⛔ 不得因本文发现缺口而自行进入实施 Gate；由 owner 决定哪些缺口进入下一实施 Gate。
