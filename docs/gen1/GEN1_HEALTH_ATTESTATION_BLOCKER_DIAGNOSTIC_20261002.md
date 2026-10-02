# GEN1 — HEALTH / PRODUCTION ATTESTATION BLOCKER DIAGNOSTIC

> **本件性质**：只读调查 + 状态对账 + 健康诊断 + 治理文档。⛔ **不是** V3.6.6 Freeze，⛔ **不是** Production Attestation，⛔ **不是** Evidence Execution。
> **本件同时落档 owner 对本会话上一件（`GEN1_V366_FREEZE_ATTESTATION_GATE_PREP_20261002.md`）§5 交叉点 X-1…X-7 的正式裁定。**
>
> | 项 | 值 |
> |---|---|
> | 落笔时刻（本机 UTC） | `2026-10-02T12:01:49Z`（= 北京 `2026-10-02 20:01:49`） |
> | 数据源时间戳 ①（`runtime_status`） | `updated_at = 2026-10-01T00:00:22.690Z`（= 北京 `2026-10-01 08:00:22`） |
> | 数据源时间戳 ②（`gen1_health_state`） | `updated_at = 2026-10-01T14:20:21.418Z`（= 北京 `2026-10-01 22:20:21`） |
> | 数据源时间戳 ③（首次降级） | `degraded_at = 2026-09-21T14:20:27.241Z`（= 北京 `2026-09-21 22:20:27`） |
> | 只读通道 | CloudBase CLI（`_cb-connect-20260921/cb_query.py`，**构造期只读白名单** `QUERY/find` + `COMMAND/count`） |
> | 实时复核 | ✅ 本件落笔前**重新实读**（非引用旧快照）：`runtime_status` 71 键 · `gen1_health_state` 15 键 |

---

## 0. 边界声明（本轮允许 / 禁止）

**允许**（owner 明文）：`read-only investigation` · `state reconciliation` · `health diagnosis` · `documentation` · `executable checks`。

⛔ **本件不修改**：证据契约载体（v6.0）· `V6.0 Evidence Freeze Seal` · Key 2 · V3.6.5 冻结对象（commit / tag / vendored 夹具）· V3.6.6 实现分支 · `.gitattributes` · 任何生产件。

⛔ **本件未执行**：production write · deploy · rollback · canary · selector switch · `ml_effective` switch · auto_execution · push · merge · tag。

---

## 1. owner 裁定 X-1 … X-7（逐字落档）

### X-1 — Evidence Contract 归属 → **CLOSED**

- `CURRENT_EVIDENCE_CONTRACT = V6.0`；`V5.0 = SUPERSEDED`。
- V5.0 **可继续作为历史审计锚点与迁移前证据**，但**自本裁定起，任何新的 Gen-1 Evidence Execution / Evidence Qualification / Evidence Seal 必须以 V6.0 为唯一当前 Evidence Contract**。
- **禁止**：① 用 V5.0 作为新的 evidence gate contract；② V5/V6 混合解释同一 Gate；③ 因历史 §4 锚点而把 V5 重新解释为当前契约。
- 历史文档引用 V5.0 者，**仅标记** `HISTORICAL / SUPERSEDED`；⛔ **不得修改 V5 冻结载体**。

### X-2 — R1 / R2 → **CLOSED**（`CONTRACT_REEVALUATION = CLOSED`）

- `R1 = CLOSED` · `R2 = CLOSED`。依据：R1 v2 discriminator · same-bundle collision proof · different-provenance discriminator · RP3 · R2 actual trigger registry · reverse proof · §5.8 W1/W2 revision。
- ⛔ **不得重新打开 R1/R2**，除非后续**真实生产 Evidence Execution** 发现与当前 Contract 语义**直接冲突**。

### X-3 — W2 checkpoint → **CLOSED**

- `W1 = [22:30, 23:30)` · `W2 = next working day [08:30, 09:30)` · `selection = first-window-wins`。
- **术语必须分开**：`dailyPipeline-0800` 是 **Production pipeline trigger**；`W2 [08:30,09:30)` 是 **Evidence checkpoint window** ⇒ `08:00 production trigger ≠ W2 evidence checkpoint`。
- ⛔ **不得为匹配 08:00 pipeline 而把 W2 改回 `[08:00,09:00)`**。

### X-4 — Freeze 制品形态 → **DECIDED**

V3.6.6 Freeze **至少**须形成：① immutable freeze manifest；② binding decision / freeze record；③ executable freeze verification。
冻结对象**必须绑定**：V3.6.6 implementation commit · V6.0 Evidence Contract · V6.0 Evidence Freeze Seal · source/model/threshold identity · replay/parity identity · safety-wall 29/29 identity · regression identity · required production baseline identity。
**`FREEZE_SEAL ≠ GIT_TAG`** —— Git tag 是**后续独立**的不可逆 Git authorization gate。⛔ **本轮不创建 tag**。

### X-5 — Main branch reachability → **PENDING**

- `MAIN_REACHABILITY = PENDING`。原因**不是功能缺陷**，而是当前**明确禁止** `push` / `merge` / `master integration`。
- `branch-scoped freeze ≠ master-integrated production artifact`。只有在后续 owner **明确授权 Git integration** 后，才能处理 push / PR merge / master reachability。⛔ 本轮不得自行推进。

### X-6 — Production Health / DEGRADED → **BLOCKED / DIAGNOSIS REQUIRED**（★ 本轮唯一实质性阻塞项）

- 正式裁定：`HEALTH_READY = NOT READY` · `PRODUCTION_ATTESTATION = BLOCKED`。
- ⛔ **不得**通过「DEGRADED 可以接受」的文字解释把它判成 PASS。
- 要求：进一步**只读诊断** DEGRADED 的真实原因 / 来源 / 时间范围 / 恢复条件（七问见 §3.3）。
- ⛔ **禁止为了让 Gate 通过而修改 Health gate**；若发现恢复需要生产写入 / deploy / config change / selector change ⇒ **标记为 `AUTHORIZATION GATE`，不要执行**（见 §5）。

### X-7 — Safety-wall evidence → **CLOSED**

- `H1/H2_REQUIRED_EVIDENCE = FINAL 29/29 VERSION`。
- ⛔ **不得**使用 `0342abd` 内的 `28/28` 作为最终 Freeze / Attestation 证据。
- 最终绑定必须指向**已验证过**的 `4d4a67e` / **29/29 + dual red-proof**。

---

## 2. ★ 状态一致性对账：「V3.6.5 Production Attested」与 `production_engine = v3.6.1` 为何同时存在

owner 原文追问：

> «当前所谓 V3.6.5 Production Attested 与实际 `production_engine=v3.6.1` 为什么同时存在？»
> «如果历史 V3.6.5 Attestation 实际只是「candidate/package attestation」而不是「currently deployed production attestation」，必须明确纠正状态命名，避免后续 Freeze 错绑。»

### 2.1 结论先行（两根轴，⛔ 不得合成一句）

| 轴 | 载体 | 语义 | 当前值 |
|---|---|---|---|
| **A. 生产部署身份轴** | 生产就绪台账 `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY` + 线上自报 `v365_run_integrity.engine_version` + 逐字节 parity | 「CloudBase 上**实际部署/运行**的是哪一版代码」 | **`V3.6.5`** |
| **B. 引擎风味标签轴（legacy）** | `runtime_status.production_engine` | 「由**冻结参数**推导出的**决策引擎行为风味**标签」 | `v3.6.1` |

⇒ **两者不矛盾。** `production_engine` **不是**部署身份字段；把它读成「已部署版本」会得出「V3.6.5 未部署」的**错误结论**。

### 2.2 五条独立证据（互证）

| # | 证据 | 内容 |
|---|---|---|
| E-1 | 提交自述 `d669298` | `feat(v365): V3.6.5 production candidate`；`Deployed and identity-verified on CloudBase`；`deployment_bundle_sha = e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4`；`deployed_at = 2026-09-30T05:38:13Z`；`DEPLOYMENT_IDENTITY_VERIFIED = true` |
| E-2 | 生产就绪台账 `docs/V365_PRODUCTION_READINESS_LEDGER.md`（`_v365-frozen-baseline`） | L163 `CONTROLLED_DEPLOYMENT = COMPLETE`（`tcb fn deploy runDecisionEngine` 单次成功 `2026-09-30T05:37:19Z → 05:38:13Z`）· L166 `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5`（部署前 `V3.6.4`）· L168 `ONLINE_SOURCE_PARITY = EXACT_MATCH`（91 文件 · `MISSING 0 / UNEXPECTED 0 / CONTENT_DIFF 0`）· L169 `POST_DEPLOY_UNEXPECTED_PACKAGE_DIFF = 0` · L170 `DEPLOYMENT_IDENTITY_VERIFIED = true` |
| E-3 | **线上逐字节 parity 复核（2026-10-02 实时下载）** | `_cb-connect-20260921/parity_out_20261002.txt`：线上 zip（本次实时下载）解出源码 **91** 文件 vs V3.6.5 bundle **91** 文件 ⇒ `MISSING 0` / `EXTRA 0` / `CONTENT_DIFF(LF) 0` / `CONTENT_DIFF(raw) 0` ⇒ **`FINAL PARITY = PASS (EXACT_MATCH)`**；`index.js online raw == bundle raw == eb1868cb0f386bee4b89452833a1f9167a8c17723a0381c8f659aef1d55c5178` |
| E-4 | **线上自报（run 轴集合，V3.6.5 引入）** | `run_history`：`run_id = engine:2026-09-30:…` 与 `engine:2026-10-01:…`，两者 **`engine_version = v3.6.5`**；`run_manifest` 同。⇒ 该块**只可能由 V3.6.5 代码写出**，其在场本身即「线上正在跑 V3.6.5」的自证 |
| E-5 | **同一份 `runtime_status` 内自相印证** | `v365_run_integrity.engine_version = "v3.6.5"` 与 `production_engine = "v3.6.1"` **共存于同一文档**；且 `v3_6_1_enabled = true` 正是 `resolveShadowEngineVersion()` 返回 `'v3.6.1'` 的输入 |

**代码级依据（轴 B 的机制）**：

```text
src/common/utils/v3-shadow.js:74
  function resolveShadowEngineVersion(params) {
    if (params.v3_6_1_enabled === true || params.v3_6_1_s5_downside === true) return 'v3.6.1';
    if (params.v3_6_persistence === true) return 'v3.6';
    if (params.v3_5_enabled === true) return 'v3.5';
    return 'v3';
  }
cloudfunctions/runDecisionEngine/index.js:1209
  const productionEngine = trendStageEnabled ? shadowEngineVer : 'v3.8';
cloudfunctions/runDecisionEngine/index.js:1277 / 1358
  production_engine: productionEngine,
```

⇒ `production_engine` **完全由参数决定**，**与「部署了哪个版本的包」无关**；V3.6.4 / V3.6.5 均**未修改该字串及其输入参数** ⇒ 自 V3.6.1 起**恒定回报 `v3.6.1`**，属**预期、非漂移**（同事实已在 `docs/production-deployment-ledger.md` D-005 附-2 对 V3.6.4 记录过一次）。

### 2.3 判定

| 问题 | 判定 |
|---|---|
| 「V3.6.5 Production Attested」是否**只是** candidate/package attestation？ | ⛔ **否**。E-1/E-2/E-3/E-4 四证一致 ⇒ V3.6.5 **是当前实际部署、且正在运行的**生产代码身份（部署于 `2026-09-30T05:38:13Z`，2026-10-02 逐字节复核仍 `EXACT_MATCH`）。 |
| `production_engine = v3.6.1` 是否说明 V3.6.5 未部署？ | ⛔ **否**。该字段是**参数推导的引擎风味标签**（轴 B），⛔ 不具部署身份语义。 |
| 需要纠正的是什么？ | **不是**「V3.6.5 的命名」，**而是「把 `production_engine` 当部署身份读」这一读法**。⇒ 见 §2.4 ERRATA-1 与 §6 的防错绑条款。 |

### 2.4 ★ ERRATA-1（对上一轮准备件的纠错）

| 项 | 内容 |
|---|---|
| 对象 | `docs/gen1/GEN1_V366_FREEZE_ATTESTATION_GATE_PREP_20261002.md` §2 核对表第 9 行（「production safety state」） |
| 原文（erroneous） | 「`production_engine = ` **`v3.6.1`**（⚠️ **V3.6.5 / V3.6.6 候选均未部署**）」 |
| 错在哪 | 把**轴 B（参数推导标签）**误当作**轴 A（部署身份）**的证据 ⇒ 得出「V3.6.5 未部署」的**错误**结论 |
| 正确表述 | `production_engine = v3.6.1` 为**参数推导的引擎风味标签**（输入 `v3_6_1_enabled = true`），⛔ **不表征部署身份**；**部署身份以 `v365_run_integrity.engine_version = v3.6.5` 与台账 `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5` 为准**。当前真实状态 = **`V3.6.5` 已部署并在运行；`V3.6.6` 未部署** |
| 处置 | 已在准备件该行**就地追加 errata 标记**（保留原文字，⛔ 不删除）；本件 §2 为**权威更正载体** |
| 影响面 | ⛔ **不改** V3.6.5 冻结对象；⛔ **不改**证据契约 / Seal / Key 2；⛔ **不改**任何生产件。仅纠正**读法与命名**，防后续 Freeze **错绑**（owner X-6/X-4 明确的动机） |

---

## 3. ★ DEGRADED 根因诊断（X-6 七问）

### 3.1 因果链（代码级，逐跳可复算）

```text
[1] cloudfunctions/runGen1ShadowEod/index.js:170-178
      for each of MAIN5 (5 只 ETF)：
        dataHealth = evaluateDataHealth({ features: row, mainLatestDate: day,
                                          benchmarkLatestDate, historyBars, minHistoryBars: 60 })
[2] runGen1ShadowEod/index.js:179-184
      worstData = perRow.reduce(...)   // DATA_BLOCKED→'BLOCKED'；DATA_DEGRADED→'DEGRADED'；否则 'OK'
[3] runGen1ShadowEod/index.js:188-191
      incoming = computeHealthStatus({ dataHealth: worstData,
                                       economicHealth: prevState.economic_health || 'PENDING' })
[4] runGen1ShadowEod/index.js:192-193
      latched = computeLatchedState(prevState, incoming, { runtimeDataHealth: worstData })
      healthState = await writeHealthState(db, latched.state, COLLECTIONS)   // ← 唯一生产者
[5] 下游唯一权限入口 src/common/utils/gen1-health-state.js:191 healthStateToGate(state)
      → runtime_status.gen1_health_{status,gate_status,source,manual_review_required}
```

`src/common/utils/gen1-circuit-breaker.js:52-76` 的判据：

```text
if (x.dataHealth === 'DEGRADED') status = worst(status, HEALTH.DEGRADED);   // ← 本次命中的分支
economicHealth === 'PENDING' ⇒ 不参与判定（注释明令「PENDING = 样本不足，不参与」）
```

`src/common/utils/gen1-data-health.js:116-120` 的 `DATA_DEGRADED` 定义：

```text
// 6) 个别统计缺失 → DEGRADED（允许 advisory，禁止 canary）
if (nullish.length > 0)
  return result(STATUS.DATA_DEGRADED, REASON.STATISTICAL_MISSING,
                `个别统计特征缺失（${nullish.join(',')}），由模型 imputer 处理`)
```

### 3.2 实读证据（本件落笔前重新实读）

**① 闩锁文档 `gen1_health_state`（`key = 'gen1-health-state'`）**：

```text
key                      = gen1-health-state
current_health           = DEGRADED
latched_health           = DEGRADED
manual_review_required   = true
degraded_at              = 2026-09-21T14:20:27.241Z     ← 首次降级
ml_off_at                = null
reviewed_at              = null                          ← 从未人工复核
reviewed_by              = null
recovery_allowed         = false
runtime_data_health      = DEGRADED                      ← ★ 真因字段（驱动输入）
economic_health          = PENDING                       ← 不参与判定
economic                 = null
read_reason_code         = null                          ← ★ 非 READ_ERROR
updated_at               = 2026-10-01T14:20:21.418Z      ← 每日刷新仍为 DEGRADED
```

**② `runtime_status` 派生位（71 键）**：

```text
gen1_health_status                 = DEGRADED
gen1_health_gate_status            = ACTIVE       ← read_status = FOUND（非 PENDING / 非 READ_ERROR）
gen1_health_source                 = GEN1_HEALTH_STATE_LATCH   ← 来源在位
gen1_health_manual_review_required = true
gen1_health_read_reason_code       = null
gen1_health_label                  = 降级（禁止灰度）
gen1_health_economic_status        = PENDING
gen1_counterfactual_canary_health_allowed = false     ← 下游派生位一致（健康未放行）
gen1_guarded_effective_health_allowed     = false
```

**③ 根因定位到具体标的 —— `ml_shadow_signal` 逐标的 `data_health`**：

| 交易日 | 515880 | 513310 | 159582 | 518880 | 159570 |
|---|---|---|---|---|---|
| `2026-09-29` | **`DATA_DEGRADED`** | `DATA_OK` | `DATA_OK` | — | — |
| `2026-09-30` | **`DATA_DEGRADED`** | `DATA_OK` | `DATA_OK` | `DATA_OK` | `DATA_OK` |

⇒ **`worstData = 'DEGRADED'` 的唯一来源 = `515880`（AI 互联）**，原因码 = `STATISTICAL_MISSING`
（`REQUIRED_FEATURES` 15 项中「列存在但个别值为 `null`/`NaN`」，按设计交由模型 imputer 处理）。

### 3.3 七问逐项答复（owner X-6 要求）

| # | 问题 | 答复 | 依据 |
|---|---|---|---|
| 1 | DEGRADED 是由于当前生产仍为 `v3.6.1`？ | ⛔ **否**。`production_engine` 与 health **无因果**（§2 两根轴）；且线上**实际运行 v3.6.5**。health 只由**数据健康轴**（`evaluateDataHealth`）驱动 | §2；§3.1 步 [3]；`gen1-circuit-breaker.js:52-76` 无版本输入 |
| 2 | 是因为 Gen-1 尚未部署？ | ⛔ **否**。Gen-1 shadow 链 `runGen1ShadowEod` **正常运行并每日写闩锁**（`updated_at = 2026-10-01T14:20:21Z` 即 10-01 22:20 北京那轮）；V3.6.5 亦**已部署** | §3.2 ①；§2.2 E-1…E-4 |
| 3 | 是 Health source 缺失？ | ⛔ **否**。`gen1_health_source = GEN1_HEALTH_STATE_LATCH` 在位；`gate_status = ACTIVE` ⇒ `read_status = FOUND`；`read_reason_code = null` ⇒ ⛔ 非 `READ_ERROR`、⛔ 非 `NOT_INITIALIZED` | §3.2 ②；`gen1-health-state.js:42-52` |
| 4 | 是某个 Health gate 当前返回 DEGRADED？ | ✅ **是 —— `DATA` gate**。`515880` 的 `evaluateDataHealth` 返回 `DATA_DEGRADED`（`STATISTICAL_MISSING`），经 `worstData` 聚合进入 `computeHealthStatus({dataHealth:'DEGRADED'})` ⇒ `DEGRADED` | §3.2 ③；§3.1 步 [2][3] |
| 5 | 是历史残留状态？ | ⚠️ **是「闩锁保持」，⛔ 但不是「残留假象」**。`degraded_at = 2026-09-21T14:20:27Z` 为**首次**降级时刻；但 `runtime_data_health` **每轮刷新**、最近两个交易日（09-29 / 09-30）**仍为 `DEGRADED`** ⇒ **当前仍持续降级**；闩锁只因「从未人工复核」而不能自愈 | §3.2 ①③；`gen1-health-state.js:137-153` |
| 6 | 是否存在可通过正常 production attestation 前置步骤恢复的状态？ | ⛔ **只读前置步骤无法恢复**。恢复 = **① AND ②**：<br>**① 上游即时健康回升**：`515880` 必需特征补齐 ⇒ `worstData` 回到 `'OK'`（自然发生，非本 Gate 可控）；<br>**② 一次人工复核写入**：`computeLatchedState(..., { manualReviewConfirmed: true, reviewedBy })` 或直写 `gen1_health_state`（`latched_health` / `manual_review_required:false` / `reviewed_at` / `reviewed_by` / `recovery_allowed:true`）。<br>⚠️ **② 在生产闭环中不存在入口**（见下）⇒ 必然涉及**生产写入或部署** ⇒ **★ `AUTHORIZATION GATE`（§5），本轮 ⛔ 不执行** | 见下方「② 无入口」证据 |
| 7 | 恢复后 `HEALTH_READY` 的机器可验证条件？ | 见 §4 | §4 |

**「② 无入口」的证据（决定性）**：

```text
grep -rn "manualReviewConfirmed" <repo>
  src/common/utils/gen1-health-state.js:138   ← 消费点（纯函数 computeLatchedState）
  src/common/utils/gen1-circuit-breaker.js:119,124   ← DEPRECATED 进程内版本
  tests/gen1-persistent-health.test.js:51     ← ★ 唯一传入 true 的地方 = 测试
  ⇒ 生产调用方（runGen1ShadowEod / runDecisionEngine / adminGateway）**无一处传入**

cloudfunctions/adminGateway/index.js:1107-1108
  // GET /api/admin/gen1/health
  if (path === '/api/admin/gen1/health') return ok(await getGen1Health());
  ⇒ 只有 **GET（只读）**，⛔ 无恢复 / POST 端点
```

⛔ **纪律声明**：本件**未**、也**不得**为让 Gate 通过而修改 Health gate / 闩锁文档 / 任何生产件。

---

## 4. `HEALTH_READY` 的机器可验证条件（提议，待 owner 确认）

```text
HEALTH_READY(now) ==
  A) gen1_health_state.read_status === 'FOUND'                    # 非 READ_ERROR / 非 NOT_INITIALIZED
 AND B) gen1_health_state.latched_health === 'OK'                 # ★ F2 正控左支（'WARNING' 亦不满足 F2）
 AND C) runtime_status.gen1_health_gate_status === 'ACTIVE'       # ★ F2 正控右支
 AND D) gen1_health_state.manual_review_required === false
 AND E) gen1_health_state.recovery_allowed === true
        AND gen1_health_state.reviewed_at !== null
        AND gen1_health_state.reviewed_by !== null               # ★ ② 的写入产物（唯一不可只读得到的一项）
 AND F) runtime_status.gen1_health_status === gen1_health_state.latched_health   # 单真源一致（G1.2-01）
 AND G) runtime_status.gen1_health_source === 'GEN1_HEALTH_STATE_LATCH'
 AND H) runtime_status.gen1_counterfactual_canary_health_allowed === true         # 下游派生位一致
```

- **A–D / F–H 可由只读判定**；**E 只能由 ② 的人工复核写入产生**。
- 对**当前实读值**求值：`A ✅ · B ❌(DEGRADED) · C ✅ · D ❌(true) · E ❌ · F ✅(一致为 DEGRADED) · G ✅ · H ❌(false)` ⇒ **`HEALTH_READY = FALSE`**（至少 4 项不满足）。
- ⛔ 本式**由本件的 executable check 复算**（`v6_health_blocker_diagnostic_check.py` H-12），⛔ 不接受人工口头判定。

---

## 5. ★ AUTHORIZATION GATE 清单（⛔ 本轮全部不执行）

| # | 动作 | 为何需要授权 | 当前状态 |
|---|---|---|---|
| **AG-1** | 写生产集合 `gen1_health_state`（置 `manual_review_required:false` / `latched_health` / `reviewed_at` / `reviewed_by` / `recovery_allowed:true`） | 属 **production DB write** | ⛔ **未授权 / 未执行** |
| **AG-2** | 部署代码以暴露「health recovery」端点（当前 adminGateway 仅 `GET`） | 属 **deploy** | ⛔ **未授权 / 未执行** |
| **AG-3** | 修 `515880` 的必需特征缺失（上游特征行生成 / `materializeIndicators` 侧） | 可能涉 **production write / deploy**，且属**独立立项** | ⛔ **未授权 / 未执行**，且**根因定位未完成**（见 §7 OBS-3） |

⚠️ **前置依赖**：即使 AG-1 获授权，仍须**先满足 §3.3 第 6 问的 ①**（`worstData` 回到 `'OK'`）；否则 `computeLatchedState` 走 `wasDown && !nowUp` 分支 ⇒ 取更差者，**写入无效**。

---

## 6. ★ 新 Gate 定义：`HEALTH / PRODUCTION ATTESTATION BLOCKER DIAGNOSTIC`

| 项 | 内容 |
|---|---|
| **Gate 名称** | `HEALTH / PRODUCTION ATTESTATION BLOCKER DIAGNOSTIC` |
| **性质** | **只读**（`read-only investigation / state reconciliation / health diagnosis / executable checks`） |
| **准入** | owner 已授权（本轮） |
| **唯一出口** | 输出诊断结论 + `HEALTH_READY` 判定 + `AUTHORIZATION GATE` 清单；⛔ **不释放任何写权限** |
| **失败即停** | 任一实读值与本文档记载不符 ⇒ **STOP 并报告 `STATE DRIFT`** |

**只读调查清单（12 项，owner 明列）**：

| # | 调查对象 | 本件取值 |
|---|---|---|
| 1 | `production_engine` | `v3.6.1`（⚙ 参数推导标签，⛔ 非部署身份；见 §2） |
| 2 | production health | `DEGRADED`（`latched_health` / `current_health` 同值） |
| 3 | V3.6.5 attestation evidence | **已部署 attestation**（⛔ 非 candidate-only）：`d669298` · bundle `e996e88a…55a4` · `deployed_at 2026-09-30T05:38:13Z` · `EXACT_MATCH` · `DEPLOYMENT_IDENTITY_VERIFIED = true` |
| 4 | V3.6.6 candidate identity | `4d4a67e2aab95454dbcde30b782f1914bfafb2b2`（tree `d65ee3b8…`；parent `0342abd`）· ⛔ 未部署 / 未推送 / 无 tag |
| 5 | Gen-1 shadow health | 闩锁 `gen1_health_state`（§3.2 ①）；信号侧审计快照 `gen1_health_status = DEGRADED` |
| 6 | Health gate semantics | `healthStateToGate` 为**唯一权限入口**；`gate_status ∈ {ACTIVE, PENDING, READ_ERROR}`；`DEGRADED ⇒ allow_canary=false`；⛔ 「DEGRADED → 上行」须 `manualReviewConfirmed` |
| 7 | production deployment state | 线上包 == V3.6.5 bundle **逐字节一致**（91/91）；`run_history` 自报 `engine_version = v3.6.5` |
| 8 | selector | `gen1_guarded_selector_source = BASELINE` |
| 9 | `ml_effective` | `false` |
| 10 | `auto_execution` | `gen1_auto_execution = false` |
| 11 | canary | `gen1_authority = CANARY`（**层级名**）· `gen1_allow_canary = false` · `gen1_counterfactual_canary_active = false`（`_authorized = true` / `_health_allowed = false`）· `invocations = 0` |
| 12 | merge / deploy boundary | `v365_promotion_attempted = false` · `v365_authoritative_publish_status = NOT_PROMOTED` · `active_run_pointer::production` 仍指 `engine:2026-09-30:…` |

**★ 防错绑条款（owner X-6 动机）**：任何后续 Freeze / Attestation 的**部署身份绑定**，⛔ **不得**取 `runtime_status.production_engine`；**必须**取：

```text
① v365_run_integrity.engine_version        （线上自报，V3.6.5 引入）
② 台账 CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY
③ deployment_bundle_sha + ONLINE_SOURCE_PARITY 逐字节结论
④ 函数 ModTime / CodeSha256（部署台账口径）
```

---

## 7. 残留 / 待裁定

| # | 项 | 状态 |
|---|---|---|
| **OBS-2** | **2026-10-02 无引擎运行记录**：`runtime_status.updated_at` 与 `run_history` / `run_manifest` 最新一条均停在 `2026-10-01`（`engine:2026-10-01:…`）；`active_run_pointer::production` 停在 `engine:2026-09-30:…`。**根因未证**（候选解释：10-01/10-02 属国庆假期、`expected_trade_date` 仍为 `2026-09-30`）。⛔ **不据此下任何结论**，须单独立项以 CLS 日志定性 | **OPEN / UNRESOLVED** |
| **OBS-3** | `515880` 的 `STATISTICAL_MISSING` **具体缺哪个特征**未定位（`evaluateDataHealth` 只把**最差状态**写入 `runtime_data_health`，`missing_features` **未持久化**）⇒ 须单独立项（只读复算特征行） | **OPEN** |
| **OBS-4** | `economic_health = PENDING`（独立事件 < 20）⇒ 经济健康轴长期不参与判定；与 owner 已知的「独立事件 30 门槛」相关但**不同轴**，⛔ 勿混 | **登记** |
| **R-LOCAL-01** | `v365-prospective-qualification` 适用域互斥（准备件 §6 已登记）⇒ 属 V3.6.6 FREEZE Gate 主体，本件不处置 | **OPEN（归 X-4 Gate）** |
| **X-5** | `MAIN_REACHABILITY = PENDING`（三方共病：契约 v6.0 / Seal / V3.6.6 均未达主分支） | **PENDING（须 Git integration 授权）** |

---

## 8. 复算命令

```bash
# 0) 实时只读复核（构造期只读白名单；cwd 必须在仓库根以复用登录态）
cd D:/AI-Projects/Codex/etf-decision-engine
python _cb-connect-20260921/cb_query.py runtime_status    --limit 1
python _cb-connect-20260921/cb_query.py gen1_health_state --limit 1
python _cb-connect-20260921/cb_query.py ml_shadow_signal  --limit 20

# 1) 本件 executable check（纯本地，离线可跑）
python scripts/gen1/evidence-capture/v6_health_blocker_diagnostic_check.py

# 2) 线上逐字节 parity（V3.6.5 部署身份；2026-10-02 已跑）
cat _cb-connect-20260921/parity_out_20261002.txt          # FINAL PARITY = PASS (EXACT_MATCH)

# 3) 轴上自证：同一 runtime_status 内两个版本字段共存
#    production_engine = v3.6.1   AND   v365_run_integrity.engine_version = v3.6.5
```

### 8.1 打红自证（negative proof —— 证明 H 门非「空过假绿」）

⛔ 变异**只在系统临时目录的副本上**进行，**原件从未被写**（跑完 `rm -rf` 临时目录，原件 sha256 复核未变）。

```bash
# 控件与变异均通过 GEN1_PROBE_DIR 指向临时副本目录（⛔ 不改原件）
TMP=$(python -c "import tempfile;print(tempfile.mkdtemp())")
cp <探针目录>/probe_*.json "$TMP"/

GEN1_PROBE_DIR="$TMP" python scripts/gen1/evidence-capture/v6_health_blocker_diagnostic_check.py   # RP-0 对照
```

| 编号 | 变异 | 期望 | 实测 |
|---|---|---|---|
| **RP-0** | 无（未变异副本，对照组） | ALL PASS | ✅ `24 PASS / 0 FAIL` |
| **RP-1** | 闩锁 `latched_health: DEGRADED → OK`（并抹 `manual_review_required`） | H-13 + H-18 必 FAIL | ✅ `FAILED（22 PASS / 2 FAIL）` —— 命中 H-13、H-18 |
| **RP-2** | `v365_run_integrity.engine_version: v3.6.5 → v3.6.1`（抹掉部署身份自证） | H-11 必 FAIL | ✅ `FAILED（23 PASS / 1 FAIL）` —— 命中 H-11 |
| **RP-3** | `515880.data_health: DATA_DEGRADED → DATA_OK`（抹掉根因标的） | H-17 必 FAIL | ✅ `FAILED（23 PASS / 1 FAIL）` —— 命中 H-17 |
| 还原 | 删除临时目录后复跑原件 | ALL PASS | ✅ `24 PASS / 0 FAIL` |

**★ 自曝两处自指悖论（已修，本项目第 N 次实撞）**：H-24（本脚本零写操作）首版用**源码子串**判定 ⇒
① `open('w'/'a')` 的**检查名文案本身**命中；② 哨兵常量 `tcb` 的**字面量本身**命中。
**修法**：改为 **AST 结构化扫描**（只扫真实被调用的函数/属性名与 import 集合），哨兵**拆字构造**（`"t" + "cb"`）。
⇒ 纪律：**任何「检查代码自身」的哨兵都不得以字面量形式出现在被检查的文本中**。

```text
# 变异只在临时副本上进行；原件完整性复核（跑完后）
probe_runtime_status.json      sha256=a0ce2e754fe17e62…  B=5475
probe_gen1_health_state.json   sha256=7861a00ca944faf2…  B=780
probe_ml_shadow_signal.json    sha256=745fa726958ce13c…  B=46921
```

---

## 9. 不授权清单（本轮逐字未放行）

```text
V3.6.6 FREEZE              = NOT AUTHORIZED
PRODUCTION ATTESTATION     = NOT AUTHORIZED
EVIDENCE EXECUTION         = NOT AUTHORIZED
KEY 3 EVIDENCE SEAL        = NOT AUTHORIZED
GE-04                      = NOT AUTHORIZED
production write           = NO
deploy                     = NO
rollback                   = NO
canary                     = OFF
selector switch            = NO
ml_effective switch        = NO
auto_execution             = OFF
push                       = NO
merge                      = NO
tag                        = NO
HEALTH_READY               = NOT READY
PRODUCTION_ATTESTATION     = BLOCKED
```

---

## 10. 身份速查表（as-of `2026-10-02T12:01:49Z`）

```text
部署身份（轴 A）         V3.6.5   bundle e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4
                                  deployed_at 2026-09-30T05:38:13Z · ONLINE_SOURCE_PARITY = EXACT_MATCH
引擎风味标签（轴 B）     v3.6.1   ← 参数推导（v3_6_1_enabled = true），⛔ 非部署身份
V3.6.6 候选              4d4a67e2aab95454dbcde30b782f1914bfafb2b2（⛔ 未部署 / 未推送 / 无 tag）
证据契约                  V6.0（CURRENT）· V5.0 = SUPERSEDED（仅历史锚点）
V6.0 Evidence Freeze Seal SEALED · FINGERPRINT_CANONICALIZATION = sha256lf · KEY_2_IMMUTABLE = PASS
健康（闩锁）              latched_health = DEGRADED · runtime_data_health = DEGRADED · gate_status = ACTIVE
                          首降 2026-09-21T14:20:27.241Z · 未人工复核 · 根因标的 = 515880（STATISTICAL_MISSING）
canary                    gen1_authority = CANARY（层级名）· allow_canary = false · active = false · invocations = 0
production_write          false          auto_execution    false        broker_wired       false
ml_effective              false          selector_source   BASELINE     production_engine  v3.6.1（轴 B）
envId                     tradingview-etf-d0fa42yy57cbc11b
```
