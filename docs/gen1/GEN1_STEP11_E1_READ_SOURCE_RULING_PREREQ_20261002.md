# GEN-1 · PHASE 1 / Step 1.1-E1 — Evidence Contract v4 **读源正解**：Owner 裁定前置分析（只读）

- **任务来源**：Owner 授权「E-1：Evidence Contract v4 读源正解的 Owner 裁定前置分析」
- **性质**：**只读分析**。⛔ 不冻结 v4；⛔ 不改契约；⛔ 不改生产链；⛔ 不选定 ①a / ①b / ①c
- **as-of**：2026-10-02 09:51–10:0x（+08）（本机时钟；云端实读时点见 §9）
- **客体外参照**：`_v4-contract-20260923/docs/gen1/GEN1_EVIDENCE_CONTRACT_V4.md` @ `8d1f1cd`（709 行 / 38137 B / CRLF / sha256 `80da4d99…`）
- **本报告的作用**：为 Owner 就 **E-1a / E-1b / E-1c** 裁定提供**足够信息**；⛔ **本报告不给出选择结论**。

---

## 0. 本次做了什么 / 没做什么

**做**：

1. 只读重建 **四个集合**（`decision_result` / `run_candidate_*` / `active_run_pointer` / `portfolio_snapshot`）＋ **四个支撑集合**（`runtime_status` / `ml_shadow_signal` / `run_manifest` / `run_history`）的**实际写入方 / 读取方矩阵**；
2. 只读比对 **v4 §3 的五个绑定字段** 与生产**实际产出位置**；
3. 只读复算 **v4 §5.4 九条 coherence gate** 在「①a / ①b」两种绑定的可满足性；
4. 只读定位线上包 `_cb-connect-20260921/bundle-src/index.js`（100944 B / sha256 `eb1868cb…`）的全部写路由与读路由（含行号）；
5. 只读核对 **ENFORCE 首次自然运行时点** 与 **最后一次 LEGACY 写入时点**；
6. 只读核对 `c1_capture.py` 的读点与只读白名单能力边界。

**没有做**：

- ⛔ 未修改 Evidence Contract **任何字节**（v1.0 / v3.0 / v4.0）；
- ⛔ 未修改任何仓库跟踪文件；未 commit / push / PR / merge / deploy / freeze；
- ⛔ 未修改生产代码 / 配置 / DB / Authority / Seal / lock / immutable_set；
- ⛔ 未修改 `decision_result` / `portfolio_snapshot` / candidate / pointer；
- ⛔ 未修改 health / canary / permission / overlay / CALC / ORCH；
- ⛔ 未改 PR #60 body；⛔ 未处理 E-2 / E-3 / E-4 / E-5；⛔ 未进入 Step 1.2 或 PHASE 2/3；
- ⛔ 未选边 ①a / ①b / ①c。

---

## 1. 实际读写矩阵（本步核心成果）

> 全部为 **只读实读**。代码行号一律指**线上 V3.6.5 包** `_cb-connect-20260921/bundle-src/index.js`（100944 B / sha256 `eb1868cb0f386bee4b89452833a1f9167a8c17723a0381c8f659aef1d55c5178`）与同目录模块。

### 1.1 写入方矩阵

| 集合 | ENFORCE 下写入方 | LEGACY 下写入方 | 其他写入方 | 实读行数 / 最新键 |
|---|---|---|---|---|
| `decision_result` | ⛔ **不写** —— 改写入 `run_candidate_decision`（`index.js:544-551`：`if (v365Mode !== 'ENFORCE')` 才 `db.upsert`） | ✅ `db.upsert`（`index.js:546`） | — | **161** 行 / max `decision_date` = **2026-09-29** |
| `portfolio_snapshot` | ⛔ **不写** —— 改写入 `run_candidate_portfolio`（`index.js:554-563`） | ✅ `db.upsert`（`index.js:558`） | ⚠️ `adminGateway.persistLiveSnapshot`（`adminGateway/index.js:829`）—— 写**用户资产字段**，字段表中**不含** `decision_market_regime` | **41** 行 / max `snapshot_date` = **2026-09-30** |
| `run_candidate_decision` | ✅ `v365Store.putCandidate(...)`（`index.js:549-550`） | — | — | **10** 行（2 run × 5 票） |
| `run_candidate_portfolio` | ✅ `putCandidate(...)`（`index.js:560-561`） | — | — | **2** 行（2 run） |
| `run_manifest` | ✅ `publishCandidateFirst`（`index.js:1359-1366` → `v365-run-integrity.js:131`） | — | — | **2** 行 |
| `active_run_pointer` | ✅ 单指针 CAS 提升（`v365-publish-store.js:252+`） | — | — | **1** 行（`active_run_pointer::production`） |
| `run_history` | ✅ append-only（`index.js:1391-1415`） | — | — | **2** 行 |
| `runtime_status` | ✅ **无条件写**（`index.js:1653`，ENFORCE/LEGACY 均写） | ✅ | — | **1** 行（单例） / `decision_date` = **2026-10-01** |
| `ml_shadow_signal` | `runGen1ShadowEod`（22:20，独立链） | 同 | — | **133** 行 / max `date` = **2026-09-30** |

**`active_run_pointer` 实读全文**：

```text
_id                 = active_run_pointer::production
scope               = production
run_id              = engine:2026-09-30:b1790776862980
expected_trade_date = 2026-09-30
revision            = 1
promoted_from_run_id= null
updated_at          = 2026-09-30T14:01:11.797Z   (= 2026-09-30 22:01:11 +08)
total               = 1
```

**`run_history` 实读（2 行）**：

| run_id | revision | status | promoted | cas_reason | promoted_at | read_after_write_consistent |
|---|---|---|---|---|---|---|
| `engine:2026-09-30:b1790776862980` | 1 | COMPLETE | **true** | `PROMOTED` | 2026-09-30T14:01:11.865Z | **true** |
| `engine:2026-10-01:b1790812813101` | 2 | COMPLETE | false | null | null | null |

**`run_manifest` 实读（2 行）**：

| run_id | revision | expected_trade_date | status | validation_passed | validation_reason |
|---|---|---|---|---|---|
| `engine:2026-10-01:b1790812813101` | 2 | **2026-10-01** | COMPLETE | **false** | `mixed_date_detected` |
| `engine:2026-09-30:b1790776862980` | 1 | 2026-09-30 | COMPLETE | **true** | `ok` |

### 1.2 读取方矩阵（含 Evidence 自身读点）

| 集合 | 生产读者（**仓内实测**，排除 node_modules） | Evidence 读者（C-1 工具） | 与 `v365-active-read.js` 的关系 |
|---|---|---|---|
| `decision_result` | ✅ `apiGateway/index.js:507`（`orderBy decision_date desc`）、`:609`；✅ `adminGateway/index.js:73-74`（`orderBy decision_date desc, limit 1`） | ✅ `c1_capture.py:158-159` | ⚠️ 两处**命中** `FORBIDDEN_READ_PATTERNS.LATEST_DECISION_BY_DATE`（`v365-active-read.js:43-50`） |
| `portfolio_snapshot` | ✅ `apiGateway/index.js:161` / `:518` / `:617`；✅ `adminGateway/index.js:802` / `:806` / `:888` / `:1003` | ✅ `c1_capture.py:162-163` | ⚠️ **命中** `LATEST_SNAPSHOT_BY_DATE`；`ALLOWED_LATEST_READS` 仅豁免其**用户资产字段**（可变状态轴），**不含** `decision_market_regime` |
| `run_candidate_decision` | ⛔ **零读者** | ⛔ 零 | 若读则须带 `run_id`（`CANDIDATE_WITHOUT_RUN_BINDING`） |
| `run_candidate_portfolio` | ⛔ **零读者** | ⛔ 零 | 同上 |
| `active_run_pointer` | ⛔ **零读者**（`index.js:1346` 的 `getPointer` 是**写入侧**回读，非消费） | ⛔ 零 | `resolveActivePointer` / `readAuthoritativeDataset` **存在但零 import** |
| `run_manifest` / `run_history` | ⛔ 零读者 | ⛔ 零 | — |
| `runtime_status` | （无生产消费者；供前端状态字段） | ✅ `c1_capture.py:156-157` | Evidence eligibility **唯一**来源 |
| `ml_shadow_signal` | — | ✅ `c1_capture.py:160-161` | — |
| CLS 调用日志 | — | ✅ `c1_capture.py:174-176`（`materializeIndicators` 上游 / `runDecisionEngine` 下游） | `§5.6 NATURAL_RUN_PROVENANCE` |

> **判读（中性，不作优劣判断）**：`decision_result` / `portfolio_snapshot` 是**当前唯一的被消费链**（生产前台 + Evidence 都读它）；`run_candidate_*` / `active_run_pointer` / `run_manifest` / `run_history` 是**已在写入、尚无消费者**的链。

### 1.3 与本步直接相关的三条代码事实

```js
// ① 写路由分流（线上包 index.js:544-563）
async function v365WriteDecision(doc, code) {
  if (v365Mode !== 'ENFORCE') { return db.upsert(COLLECTIONS.DECISION_RESULT, doc, { code, decision_date: doc.decision_date }); }
  v365CandidateDocs.push(doc);
  await v365Store.putCandidate(V365_COLLECTIONS.CANDIDATE_DECISION, v365EngineRunIdBase, String(code), doc);
  return { created: true, deferred: true };
}
async function v365WritePortfolio(doc, snapDate) {
  if (v365Mode !== 'ENFORCE') { return db.upsert(COLLECTIONS.PORTFOLIO_SNAPSHOT, doc, { snapshot_date: snapDate }); }
  await v365Store.putCandidate(V365_COLLECTIONS.CANDIDATE_PORTFOLIO, v365EngineRunIdBase, 'portfolio', doc);
  return { created: true, deferred: true };
}

// ② regime 诊断字段是**同一条快照文档**的一部分（index.js:1241-1260 → :1265-...）
const regimeDiagnostics = { decision_market_regime: diff.decision_regime, market_regime_divergent: diff.divergent, ... };
const v365SnapshotDoc = { snapshot_date: snapshotDate, ..., market_regime: freshPortfolio.market_regime, ...regimeDiagnostics, ... };
// ③ 该文档的去向（index.js:1329-1331）
const v365PortfolioPublish = (v365Finality.status === COMPLETE) ? await v365WritePortfolio(v365SnapshotDoc, snapshotDate) : {...};
```

⇒ **`decision_market_regime` 并未「停止产生」**；它被写进 **`run_candidate_portfolio`**（ENFORCE）而非 `portfolio_snapshot`（LEGACY）。

### 1.4 本步实测：候选集合**已含** v4 §3 所需的全部字段

`run_candidate_decision`（10 行，2 run × 5 票）实测字段：

| 字段 | 实测 | v4 用途 |
|---|---|---|
| `run_id` | `engine:2026-09-30:b1790776862980` / `engine:2026-10-01:b1790812813101` | run 绑定键 |
| `code` | 5 票齐（518880 / 159570 / 159582 / 515880 / 513310） | 字段 2 |
| `decision_date` | `2026-09-30`（两 run 同值） | **字段 1** |
| `suggested_position` | 0 / 0 / 7.1 / 0 / 8.3 | **字段 7** |
| `gen1_counterfactual_suggested_position` | 0 / 0 / 7.1 / 0 / 8.3 | **字段 8** |
| `v361_baseline_stage` | S0 / S0 / S1 / S0 / S0 | **字段 4** |
| `effective_market_regime` | ⚠️ **仅 3 票有**（513310 / 515880 / 159582 = `crisis`；518880 / 159570 **缺键**） | 诊断（非 v4 主来源） |
| `calc_date` | `2026-09-30`（5 票齐） | 宿主对齐量 |

`run_candidate_portfolio`（2 行）实测：**`decision_market_regime = "crisis"`**（两 run 均有）、`snapshot_date = 2026-10-01 / 2026-09-30`、`market_regime = "defensive"`、`market_regime_divergent = true`、`run_id`、`written_at`。

---

## 2. v4 绑定字段 ↔ 生产实际产出位置：逐项对应

### 2.1 §3 样本中绑定生产的字段

| v4 项 | v4 原文绑定 | **ENFORCE 实际产出位置** | 本步实测 |
|---|---|---|---|
| 字段 1 `date` | `decision_result.decision_date` | `run_candidate_decision.decision_date` | ✅ 存在 |
| 字段 3 `regime` | `portfolio_snapshot.decision_market_regime` | **`run_candidate_portfolio.decision_market_regime`** | ✅ 存在（`crisis`） |
| 字段 4 `stage` | `decision_result.v361_baseline_stage` | `run_candidate_decision.v361_baseline_stage` | ✅ 存在 |
| 字段 7 `baseline_suggested_position` | `decision_result.suggested_position` | `run_candidate_decision.suggested_position` | ✅ 存在 |
| 字段 8 `counterfactual_suggested_position` | `decision_result.gen1_counterfactual_suggested_position` | `run_candidate_decision.gen1_counterfactual_suggested_position` | ✅ 存在 |
| 字段 5/6 | `ml_shadow_signal.*` | 同（独立链，**不受 ENFORCE 影响**） | ✅ 存在 |
| 字段 10–14（forward / MFE / MAE） | 行情价格 | 同（与读源无关） | — |

### 2.2 §5.3 五源的推进状态

| 源 | 实读最新 | 当前是否推进 |
|---|---|---|
| `runtime_status` | `decision_date 2026-10-01` / `updated_at 2026-10-01T00:00:22.690Z` | ✅ 推进（`index.js:1653` 无条件写） |
| `decision_result` | `decision_date 2026-09-29` | ❌ 停滞（ENFORCE 不写） |
| `ml_shadow_signal` | `date 2026-09-30` | ✅ 推进（22:20 独立链） |
| `portfolio_snapshot` | `snapshot_date 2026-09-30` | ❌ 停滞（ENFORCE 不写） |
| invocation log | 有（CLS） | ✅ |

### 2.3 §5.4 九条 gate：现状 vs ①b 改绑后

| 规则 | 绑定 | ENFORCE 现状（v4 原文） | ①b 改绑后（示例口径） |
|---|---|---|---|
| 1 | runtime_status = 本 checkpoint 前最新自然运行 | ✅（10-01 08:00 为最近一次写入） | 须重定义为「pointer 指向的 run 为本 checkpoint 前最新**已提升** run」 |
| 2 | updated_at 前进 | ✅（首个 bundle 例外） | 改为 pointer `revision` / `run_history` 前进 |
| 3 | `decision_result` 恰 5 码 | ✅（旧行仍 5 码） | 改绑 `run_candidate_decision`（按 `run_id` filter） |
| 4 | 五行 `decision_date` 相同（组 B） | ✅（旧行均为 09-29） | 改绑 candidate |
| 5 | `ml_shadow_signal.date` == `decision_date`（组 B） | ❌ **FAIL**（09-30 ≠ 09-29） | 仍须重新定义（22:20 EOD 与 run 的日期语义） |
| 6 | `ml_shadow_signal` 覆盖同 code set | ✅ | 不变 |
| 7 | `portfolio_snapshot.snapshot_date` == `runtime_status.decision_date`（组 A） | ❌ **FAIL**（09-30 ≠ 10-01） | 改绑 `run_candidate_portfolio.snapshot_date` / pinned run 日期 |
| 8 | 任一不一致 ⇒ `BUNDLE_INVALID` | **触发** | 触发 |
| 9 | 同 `decision_date` 至多一个 bundle | 无可判定对象 | 不变（但新增「同 run 至多一个 bundle」问题） |

### 2.4 单点结论

> **v4 当前所绑定的两个集合（`decision_result` / `portfolio_snapshot`），恰是 ENFORCE 下「已停写」的两个集合；而 v4 所需字段在 ENFORCE 下确实仍在产生，只是落在另外两个集合（`run_candidate_decision` / `run_candidate_portfolio`）。**
> ⇒ 这不是「字段不存在」问题，而是 **source binding（绑定位置）** 问题。

---

## 3. E-1a / E-1b / E-1c 三方案逐项影响分析

> ⛔ 本节**不作价值排序、不作推荐、不选边**。三节结构完全对齐，便于 Owner 并列比较。

### 3.1 ①a —— 继续绑定 `decision_result`，并把其更新/前置条件登记为 activation precondition

| 维度 | 内容 |
|---|---|
| **需要修改什么** | **契约**：文本可零改动；须在 §12 #9 判据 / 冻结 attestation 中登记 activation precondition。<br>**生产侧（若要使 ①a 真正可执行，此处是必要条件）**：让 `decision_result`（及 `portfolio_snapshot`）恢复逐日写入。可行机制仅两种：**(i)** `v365_integrity_mode` 回退 `LEGACY`；**(ii)** 在 ENFORCE 下启用**兼容投影**（线上包 `v365-active-read.js:620-643` `planCompatibilityProjection` 已定义该计划，`reader_migration_status = 'PENDING'`，其自述「投影**不能**替代 reader migration」「多文档投影**非原子**，存在投影窗口」）。<br>⇒ **两者都是生产写路径变更**，须单独授权。 |
| **不需要修改什么** | v4 §3 / §5.4 任何判据；既有 161 / 41 行历史数据；`ml_shadow_signal` 链；`c1_capture.py` 读点（仅契约指纹联动作业）。 |
| **对 B-1 的影响** | **事实未解**。只要 ENFORCE 持续，`portfolio_snapshot.decision_market_regime` 不新增新值；现存 7 行（09-22 起）是 LEGACY 遗留。 |
| **对 B-2 的影响** | **事实未解**。§5.4 规则 5 / 7 在 ENFORCE 持续期间**恒 FAIL** ⇒ 正式样本恒 0。 |
| **对 v4 §3 / §5 / §12 的影响** | §3 / §5 **零改动**；§12 第 9 项（activation-ready）判据**须细化**（Step 1.1 已登记该点）。 |
| **对后续 Step 1.2 / PHASE 2 / V3.6.6 的依赖** | Step 1.2（若为「冻结执行」）的**前置**变成「生产写路径裁定」（回退 or 投影）；PHASE 2/3 的开工条件 = 该前置兑现；与 **V3.6.6** 的关系：**须裁定** V3.6.6 是否承载「读源恢复 / 兼容投影」，否则 ①a 无兑现路径。 |
| **与 V3.6.5 authority / read / write 是否冲突** | **部分冲突**。<br>· **write path**：与线上包注释所引述的「OD-4 §4.4 决策 = 方案 B『只读冻结』（`decision_result` / `portfolio_snapshot` 在 V3.6.5 切换日之后不再新增）」**相冲突**（需回退或新增投影）—— ⚠️ 该治理源文档**未能在本工作区定位**（见 §7 F-7）。<br>· **authority**：`gen1_authority=CANARY` / `gen1_production_write=false` 不因 Evidence 而变；但投影属**生产写**。<br>· **read path**：不冲突。 |

### 3.2 ①b —— 改绑 candidate / pointer（明确需要 Evidence Contract 改版）

| 维度 | 内容 |
|---|---|
| **需要修改什么** | **契约（改版）**：§3 字段 1 / 3 / 4 / 7 / 8 的来源；§3.1 的 `regime` 精确绑定；§5.1 / §5.3（五源 → run 轴三件套 `run_manifest` + `run_candidate_decision` + `run_candidate_portfolio`，加 `active_run_pointer`）；§5.4 九条改绑 run 轴；§9.1 来源表；§11 变更日志。<br>**冻结指纹**：rev 变更 ⇒ 双口径 sha256 重算。<br>**工具**：`c1_capture.py` 读点（`:155-204`）＋契约绑定点（`:251-256`）＋ checkpoint 口径（若一并裁定）。<br>**须先裁定的两个设计点**：**(i)** Evidence 只消费 **promoted** run（fail-closed `readAuthoritativeDataset` 语义）还是任意「最新 candidate run」（后者会复活被明令禁止的 latest 查询）；**(ii)** Evidence 的 `date` 取 `run_manifest.expected_trade_date`（= 北京运行日 `snapshotDate`，`index.js:1352`）还是 `runtime_status.v365_run_integrity.expected_trade_date`（= 日历交易日）—— 二者在 10-01 实测为 `2026-10-01` vs `2026-09-30`（见 §7 F-4）。 |
| **不需要修改什么** | 生产代码 / 配置 / 触发器 / Authority / Seal（读源改绑是**读侧**变更）；候选与指针**既有数据**；`runtime_status` / `ml_shadow_signal` 链；前台读链（不在本方案范围）。 |
| **对 B-1 的影响** | **实质可解** —— 实测 `run_candidate_portfolio.decision_market_regime = crisis` 已产生；改绑后 CD-02 remedy 的绑定目标**当场存在**。以**改版**为条件。 |
| **对 B-2 的影响** | **实质可解** —— §3 的四个字段在 `run_candidate_decision` **实测全齐**（§1.4）；§5.4 规则 3 / 4 可判、规则 5 / 7 需在 run 轴内重新定义。以**改版**为条件。 |
| **对 v4 §3 / §5 / §12 的影响** | **实质改动**，属 **source binding 变更**（Step 1.1 已判定「不是措辞收紧」）。§11 元规则：v4 **尚未冻结** ⇒ 可在 v4.0 草案内改版（作废样本数 = 0）；但**属新一轮「生成」动作，须单独授权**。 |
| **对后续 Step 1.2 / PHASE 2 / V3.6.6 的依赖** | Step 1.2 起点变为「改版 + 重算指纹 + 脚本改造」；PHASE 2/3 依赖该改版；**V3.6.6 不再是 ①b 的前置**。 |
| **与 V3.6.5 authority / read / write 是否冲突** | **不冲突**（纯读；候选/指针已在写；CAS 提升**已发生过 1 次**）。<br>⚠️ **但须同时登记**:`active_run_pointer` 目前 `revision = 1` @ `engine:2026-09-30:b1790776862980`，**自 2026-09-30 22:01 起未再前进**（10-01 因 `mixed_date_detected` 未提升、10-02 被 `CASE_B_PARTIAL_STALE` 阻断）⇒ **①b 也不能立刻产出新样本**，但其性质是**事件驱动**（下一次成功提升即可产出），而非 ①a 的**结构性永久 FAIL**。<br>⚠️ 另：`V365_ENFORCE_SWITCH_DATE = null`（线上包内未登记）⇒ CLASS C 双源分段不可判定（见 §7 F-6）。 |

### 3.3 ①c —— 契约**保持现状冻结**，把「当前读源尚不可执行」作为 activation precondition，与契约冻结**解耦**

| 维度 | 内容 |
|---|---|
| **需要修改什么** | **契约**：**可零改动**（若 Owner 接受把 §12 #9 细化放到 attestation）；或**仅细化 §12 #9 判据**（属措辞层，不改字段/阈值/纳入规则）。<br>**冻结轮新增（attestation 必写）**：**(i)** §5.4 规则 5 / 7 在 ENFORCE 下为**预期 FAIL**；**(ii)** 在 precondition 满足前，产出正式样本数**恒 0**；**(iii)** **重审触发条件**（ENFORCE 切换日登记 / 读源恢复 / 改版 / V3.6.6 落地 —— 四者皆可，须选定）。<br>**工具**：`c1_capture.py` 契约绑定点须同步（v4 冻结的联动作业）。 |
| **不需要修改什么** | §3 / §5.4 任何判据；生产链；既有历史行；`ml_shadow_signal` 链。 |
| **对 B-1 的影响** | **事实不变**（仍不可产生于 `portfolio_snapshot`），但**性质改变** —— 从「冻结阻塞项」变为「已声明的 activation precondition」。 |
| **对 B-2 的影响** | **事实不变**（规则 5 / 7 仍 FAIL），同样**重分类**为已声明 precondition。 |
| **对 v4 §3 / §5 / §12 的影响** | §3 / §5 零改动；§12 第 9 项判据**须细化**（Step 1.1 已登记）。 |
| **对后续 Step 1.2 / PHASE 2 / V3.6.6 的依赖** | Step 1.2 = 「冻结执行」**可行**，但**不产生任何样本**；PHASE 2/3 的语义须相应改写（否则会出现「契约已冻结但永远 0 样本」的误读）；与 **V3.6.6** 的关系：V3.6.6 若含读源修复，则成为 precondition 的**兑现路径**。 |
| **与 V3.6.5 authority / read / write 是否冲突** | **不冲突**（不改任何生产件）。<br>⚠️ **关键诚实点**：①c **不消除**「冻结后必然无法满足」的硬条件，它只是**把该事实写进 attestation 并接受长期 0 产出**。若 Owner 不接受「冻结即承诺长期 0 样本」，①c 不成立。 |

---

## 4. B-1 / B-2 在三方案下的状态

| | **B-1**（CD-02 remedy 字段不可产生） | **B-2**（§3 主读源停滞 ⇒ §5.4 规则 5/7 恒 FAIL） |
|---|---|---|
| **①a** | **事实未解** —— 只要 ENFORCE 持续即不新增；须改**生产写路径**（回退 or 兼容投影）才可能解 | **事实未解** —— 规则 5 / 7 在 ENFORCE 持续期间**恒 FAIL**；须同上 |
| **①b** | **实质可解** —— 字段已实测产生于 `run_candidate_portfolio`；以**契约改版**为条件 | **实质可解** —— §3 字段 1/4/7/8 已实测全齐于 `run_candidate_decision`；以**契约改版**为条件 |
| **①c** | **事实未解**，但**重分类**为 activation precondition（须在 attestation 显式声明） | **事实未解**，同样**重分类**；须在 attestation 声明规则 5 / 7 为**预期 FAIL** |

> **三方案共同事实（须写明）**：**三者今天都不能产出任何正式 Evidence 样本。** 差异只在「**为何不能**」与「**何时能**」：
> - ①a / ①c 不能，是因为**读源集合已停写**（若要解，须动生产）；
> - ①b 不能，是因为**指针未前进**（不须动生产，等下一次成功提升）。
> 另有一个**与三方案均无关**的独立原因：`gen1_counterfactual_canary_active = false`（`gen1_health_status = DEGRADED`）⇒ §4.2-1 排除 ⇒ **即使读源全部就绪，当前也无合格交易日**。

---

## 5. 三轴分离（⛔ 不得混为一谈）

### 5.1 轴 1 —— **契约是否可冻结**（治理行为）

| 方案 | 可冻结性 | 说明 |
|---|---|---|
| ①a | **可**（文本自洽） | 冻结即承认「在 precondition 兑现前产出恒 0」；是否可接受属**治理裁定**，非技术问题 |
| ①b | **不可**（须先改版） | 改版属新一轮「生成」动作，须单独授权；改版前冻结将绑错源 |
| ①c | **可**（且明确解耦） | 须在 attestation 写明「预期 FAIL + 恒 0 产出 + 重审触发条件」 |

### 5.2 轴 2 —— **Evidence 是否已可执行**（产出可评分样本）

- **三方案下当前均为「不可产出」**，且原因分两层：
  1. **读源层**：①a/①c ⇒ §5.4 规则 5/7 FAIL；①b ⇒ 指针未前进；
  2. **资格层**：§4.2-1 `canary_active = false`（**与读源无关**，E-1 不解决此层）。
- ⇒ **E-1 只解决「读源」层**；「可执行」还需要资格层同时成立。

### 5.3 轴 3 —— **生产读写链是否需要修复**

- **写链**：ENFORCE 不写 legacy 集合，是线上包注释所引述的 **OD-4「只读冻结」方案的既定后果**，**不是 bug**。是否「需要修复」完全取决于 Owner 对 ①a/①b/①c 的选定（①a 要动写链；①b/①c 不动）。
- **读链**：`apiGateway` / `adminGateway` 仍以 `orderBy(decision_date|snapshot_date desc).limit(1)` 读取，**命中** `v365-active-read.js` 的 `FORBIDDEN_READ_PATTERNS`；且 `readAuthoritativeDataset` 等 reader-migration API **零 import**、`V365_ENFORCE_SWITCH_DATE = null`。⇒ 存在**尚未完成的 reader migration 义务**（RH4 / CLASS C），**与 Evidence 正交**，本步**不授权、不实施**。

### 5.4 归属表（哪些属哪一轴）

| 事项 | 轴1 契约冻结 | 轴2 Evidence 可执行 | 轴3 生产链 |
|---|:--:|:--:|:--:|
| v4 文本内部自洽性 | ✔ | — | — |
| §12 第 1 项（冻结授权） | ✔ | — | — |
| §12 第 9 项（activation-ready 判据） | ✔ | ✔ | — |
| B-1（`decision_market_regime` 落点） | — | ✔ | ✔（**仅①a**须动写链） |
| B-2（§3 主读源停滞 / 规则 5·7） | — | ✔ | ✔（**仅①a**须动写链） |
| §4.2-1 `canary_active=false` | — | ✔ | —（属 Gen-1 authority/health，非 E-1 范围） |
| reader migration 未接线（`v365-active-read.js` 零引用） | — | — | ✔ |
| `V365_ENFORCE_SWITCH_DATE` 未登记 | — | ✔ | ✔ |
| §3.5 复核条件 / checkpoint 口径 / 脚本契约绑定 | 关联（属 E-4 / E-5） | 关联 | — |

---

## 6. 特别检查（Owner 指定第 5 点）

### 6.1 若选 **①a**：当前 v4 是否仍存在「冻结后必然无法满足」的硬条件？

**是。至少两条，且均为结构性（非偶发）**：

| 硬条件 | v4 位置 | 为何「必然无法满足」 |
|---|---|---|
| `ml_shadow_signal.date` == `decision_result.decision_date` | §5.4 规则 5（组 B） | `ml_shadow_signal` 由 22:20 独立链**持续推进**（实测最新 09-30）；`decision_result` 在 ENFORCE 下**停写**（最新 09-29）⇒ 两日期**单调发散**，除非写链变更 |
| `portfolio_snapshot.snapshot_date` == `runtime_status.decision_date` | §5.4 规则 7（组 A） | `runtime_status` **无条件写**（实测 10-01）；`portfolio_snapshot` 停写（实测 09-30）⇒ 同上 |
| （附加）`Evidence.regime` 的绑定目标新值 | §3 字段 3 / §3.1 | `portfolio_snapshot.decision_market_regime` 仅在 LEGACY 产生；ENFORCE 下新值进 `run_candidate_portfolio` |

⇒ **①a 若不加生产写路径变更，冻结的是一份「结构上永不通过 §5.4」的契约。**

### 6.2 若选 **①c**：是否仍存在同样的硬条件？

**是 —— 与 ①a 完全相同的三条**（①c 不改 §3/§5 任何字节）。
①c 的作用是**把「不可执行」与「不可冻结」解耦**，而**不是**消除该硬条件。因此选 ①c 时，**attestation 必须显式声明**：

```text
预期态声明（必写）：
1. §5.4 规则 5 / 7 在 ENFORCE 持续期间为「预期 FAIL」，⛔ 不得判为脚本缺陷或 gate 误杀；
2. 在 activation precondition 兑现前，正式 Evidence 样本数恒为 0；
3. 重审触发条件 = <Owner 选定：ENFORCE 切换日登记 / 读源恢复 / 契约改版 / V3.6.6 落地>;
4. ⛔ 不得把「§12 全绿」解读为「Evidence 已可执行」。
```

若无上述声明，①c 与「冻结一份不可执行契约且不告知」在治理上等价 —— 这是 ①c 成立与否的**唯一判据**。

### 6.3 若选 **①b**：需要什么版本 / 变更授权才能实施？

| 需要 | 具体内容 |
|---|---|
| **版本层** | v4.0 **尚未冻结** ⇒ 可在 **v4.0 草案内改版**（§11 元规则第 1、2 项仅约束**已冻结**文件；第 3 项要求变更日志留痕并写明「是否作废既有样本」⇒ 实测既有样本 = **0 行**，登记为「否（实质为零）」或「是（作废 0 行）」须 Owner 择一表述）。 |
| **授权层** | ①改版 = 新一轮 **CONTRACT GENERATION** 动作（Step 1.1 已查明：v4 的 GENERATION 授权仅覆盖 PR #60 那一次）⇒ **须一条新的生成授权**；②载体写入 = 对 `_v4-contract-20260923` 分支的 commit/PR ⇒ **须一条仓库写授权**；③冻结 = 仍须 E-3（指纹重算 + PR #60 body 更正）先闭合。 |
| **设计层（改版前须先裁定）** | (i) 只消费 **promoted** run（pin `active_run_pointer`）还是任意最新 candidate run；(ii) Evidence `date` 取 **manifest 语义**（北京运行日）还是 **calendar 语义**（日历交易日）—— 见 §7 F-4；(iii) 规则 5 的 22:20 EOD 与 run 的日期语义如何共处。 |
| **工具层** | `c1_capture.py` 读点改造 + 契约绑定点同步。⚠️ **只读白名单无须扩**：`cb_connect.assert_readonly` 按**命令类型**限定（`ALLOWED_FIRST_KEYS = {"QUERY": {"find"}, "COMMAND": {"count"}}`），**不按集合**限定 ⇒ 读 candidate / pointer 已在其许可内（见 §7 F-10）。 |
| **不需要的授权** | 生产代码 / 配置 / DB / 触发器 / Authority / Seal 的写授权（①b 是**读侧**变更）。 |

---

## 7. 本步新登记的观察项（非阻塞；⛔ 本步不处置）

| 编号 | 观察 | 依据 |
|---|---|---|
| **F-4** | **`expected_trade_date` 双语义并存**：`run_manifest.expected_trade_date` = **北京运行日**（`snapshotDate`，`index.js:1352`）；`runtime_status.v365_run_integrity.expected_trade_date` = **日历权威交易日**（`buildRunTelemetry`）。实测 10-01 run：`2026-10-01` vs `2026-09-30`（**不等**） | `run_manifest` / `runtime_status` 实读 |
| **F-5** | `run_history` 证 09-30 run **`promoted=true` / `cas_reason=PROMOTED` / `read_after_write_consistent=true`**；而 `runtime_status.v365_authoritative_publish_status=NOT_PROMOTED` / `v365_promotion_attempted=false` **仅反映最后写入者（10-01 run）**。二者**不矛盾**（同一个单例，UNV-22 语义），但 ⛔ **不得据后者推断「提升从未发生过」** | `run_history` vs `runtime_status` 实读 |
| **F-6** | `v365-active-read.js` 的 reader-migration API（`resolveActivePointer` / `readAuthoritativeDataset` / `readActiveDecision` / `planCompatibilityProjection`）在线上包内**零 import / 零引用**；且 `V365_ENFORCE_SWITCH_DATE = null`（未登记）⇒ CLASS C 双源分段**不可判定**，`run_axis_available = false` | 全包 grep + `v365-active-read.js:88-100` |
| **F-7** | 线上包注释引述「**OD-4 §4.4 决策 = 方案 B『只读冻结』**：`decision_result` / `portfolio_snapshot` 在 V3.6.5 切换日之后**不再新增**」。⚠️ **该治理源文档未能在本工作区定位**（`_v365-charter/V365_CHARTER_DRAFT.md` 无 OD-* 提及）⇒ 登记为**待核**，⛔ 不当作已确认事实 | `v365-active-read.js:88-96` 注释块 |
| **F-8** | **ENFORCE 切换区间**：部署 `ModTime 2026-09-30 13:38:07 (+08)`；**首次 ENFORCE 自然运行 = 2026-09-30 22:01:11**（`active_run_pointer` / `run_history` 首行）；**最后一次 LEGACY 写入 = 2026-09-30 08:00**（`decision_result` 09-29 行 `decision_timestamp 2026-09-30T00:00:57.754Z`）⇒ 切换日 ∈ `(2026-09-30 08:00, 2026-09-30 22:01]`，**未正式登记** | deploy attestation + 两集合实读 |
| **F-9** | `run_candidate_decision` 中 **518880 / 159570 缺 `effective_market_regime` 键**（其余 3 票有）⇒ 与 **UNV-27** 同型的键集不齐。①b 改版时须处理（v4 主来源不用该字段，故**不阻塞**，但须登记） | 集合实读 |
| **F-10** | `c1_capture.py` 的只读白名单**按命令类型而非集合**限定 ⇒ 读 `run_candidate_*` / `active_run_pointer` / `run_manifest` / `run_history` **无须扩白名单**；①b 的改动面仅限脚本读点与契约绑定点 | `cb_connect.py:57-75` |

---

## 8. 需 Owner 裁定点清单（⛔ 本报告不给结论）

| # | 裁定点 | 关联 |
|---|---|---|
| 1 | **读源正解**：①a / ①b / ①c | E-1 本体 |
| 2 | 若 ①b：Evidence 是否**只**消费 promoted run（pin `active_run_pointer`），还是允许消费任意最新 candidate run？ | 决定是否与 `FORBIDDEN_READ_PATTERNS` 冲突 |
| 3 | 若 ①b：Evidence 的 `date` 取 **manifest 语义**（北京运行日）还是 **calendar 语义**（日历交易日）？ | F-4 |
| 4 | 若 ①a / ①c：是否接受「冻结即在 precondition 兑现前长期 0 样本」？**重审触发条件**如何写？ | §6.1 / §6.2 |
| 5 | §12 第 9 项（activation-ready）判据的细化，**写进契约正文** 还是 **仅写 attestation**？ | ①a / ①c 共同 |
| 6 | 是否为 ①b 开一条新的 **CONTRACT GENERATION 授权**（v4.0 草案内改版）？ | §6.3 |
| 7 | ①a 若成立，其兑现路径落在 **V3.6.6** 还是**独立生产变更授权**？ | §3.1 |
| 8 | 「OD-4 方案 B 只读冻结」这一治理前提**是否属实**（F-7 待核），以及它对 ①a 的约束力 | §3.1 / F-7 |

---

## 9. 本次只读分析的实时读数存档（as-of 2026-10-02 10:0x +08）

> 全部经 **CloudBase MCP 只读通道**（`auth` / `readNoSqlDatabaseContent`）与**本地只读文件**取得。
> **构造期只读白名单**：DB 侧仅 `QUERY`/`find`（MCP `readNoSqlDatabaseContent`）；文件侧仅 Read/Grep。
> **本步 DB 写命令数 = 0**。

### 9.1 集合实读汇总

| 集合 | total | 最新键 / 关键值 |
|---|---|---|
| `decision_result` | **161** | max `decision_date = 2026-09-29`；5 票齐；`decision_timestamp 2026-09-30T00:00:55.392Z–57.754Z`；`effective_market_regime=crisis` |
| `portfolio_snapshot` | **41** | max `snapshot_date = 2026-09-30`；`decision_market_regime` 仅 7 行有（09-22 起） |
| `ml_shadow_signal` | **133** | max `date = 2026-09-30` |
| `runtime_status` | **1** | `decision_date = 2026-10-01`；`updated_at = 2026-10-01T00:00:22.690Z`；`v365_mode=ENFORCE`；`v365_finality_status=COMPLETE`；`v365_authoritative_publish_status=NOT_PROMOTED`；`v365_promotion_attempted=false`；`v365_run_integrity.expected_trade_date=2026-09-30` / `observed_latest_date=2026-09-30` / `input_health=DEGRADED` / `engine_run_id=engine:2026-10-01:b1790812813101`；`gen1_authority=CANARY`；`ml_effective=false`；`gen1_production_write=false`；`gen1_auto_execution=false`；`gen1_counterfactual_canary_active=false`；`gen1_health_status=DEGRADED`；`gen1_health_gate_status=ACTIVE`；`gen1_counterfactual_ledger_ok=true` |
| `run_candidate_decision` | **10** | 2 run × 5 票；字段见 §1.4 |
| `run_candidate_portfolio` | **2** | `decision_market_regime = crisis`（两 run 均有） |
| `run_manifest` | **2** | 09-30 run `validation_passed=true`；10-01 run `false / mixed_date_detected` |
| `active_run_pointer` | **1** | `revision 1` / `run_id engine:2026-09-30:b1790776862980` / `updated_at 2026-09-30T14:01:11.797Z` |
| `run_history` | **2** | 09-30 run `promoted=true` / `read_after_write_consistent=true`；10-01 run `promoted=false` |

### 9.2 引用的仓内 / 仓外文件（只读）

| 文件 | 关键值 |
|---|---|
| `_v4-contract-20260923/docs/gen1/GEN1_EVIDENCE_CONTRACT_V4.md` | 709 行 / 38137 B（CRLF）/ sha256 `80da4d99…`；HEAD `8d1f1cd`；tracked status 空 |
| `_cb-connect-20260921/bundle-src/index.js`（线上 V3.6.5 包副本） | 100944 B / sha256 `eb1868cb…`；`:544-563` 写路由、`:1241-1260` ／ `:1265-` 快照文档、`:1329-1331` 发布、`:1343-1370` manifest、`:1653` runtime_status 写 |
| `_cb-connect-20260921/bundle-src/common/utils/v365-run-integrity.js` | `:131` `publishCandidateFirst`；`:317` `buildRunTelemetry` |
| `_cb-connect-20260921/bundle-src/common/utils/v365-active-read.js` | read 协议 / `FORBIDDEN_READ_PATTERNS` / `ALLOWED_LATEST_READS` / `planCompatibilityProjection` / `V365_ENFORCE_SWITCH_DATE = null` |
| `_cb-connect-20260921/bundle-src/common/utils/v365-publish-store.js` | `:252` `getPointer` 等 |
| `etf-decision-engine-gen1/cloudfunctions/apiGateway/index.js` | `:161` / `:507` / `:518` / `:609` / `:617` 读点 |
| `etf-decision-engine-gen1/cloudfunctions/adminGateway/index.js` | `:73` 读点；`:829` `persistLiveSnapshot` 写点（**不含** `decision_market_regime`） |
| `_evidence-capture-tool/c1_capture.py` | `:155-204` 读点；`:251-256` 契约绑定；`:47` 容差 30 |
| `_cb-connect-20260921/cb_connect.py` | `:57-75` `assert_readonly`；`:34` `ALLOWED_FIRST_KEYS` |
| `outputs/evidence-watch-20260921/GEN1_V365_POST_DEPLOY_ATTESTATION.md` | 部署 `ModTime 2026-09-30 13:38:07` |

---

## 10. Git / Production / DB 零修改断言（四块式）

```text
ETF 仓库（工作区 D:/AI-Projects/Codex/etf-decision-engine/etf-decision-engine-gen1，HEAD 2e24ecd @ gen1-worktree-20260916）：
- Git 跟踪文件：零修改（本步未编辑任何跟踪文件）
    ⚠️ 披露既有状态（非本步所为，mtime 2026-09-21 16:16:59）：
       ` M docs/gen1/GEN1_DOC_ERRATA_20260916.md`（diff --stat HEAD = 1 file changed, 35 insertions(+)）
    ⚠️ 披露既有未跟踪（非本步所为）：
       `?? docs/gen1/GEN1_EVIDENCE_CONTRACT_V2.md`（mtime 2026-09-21 11:42:38）
       `?? .workbuddy-ai/`（mtime 2026-09-22 09:16:17）
- Git 历史 / 分支 / 远端：零修改（本步未 commit / push / 建 PR / merge / deploy / freeze）
- 未跟踪本地草稿：outputs/evidence-watch-20260921/ 新增本报告 1 份
    （该目录命中 .gitignore:8 `outputs/` ⇒ 不入库）
其他本机文件：
- 本次仅追加 `.workbuddy/memory/`（当日日志与 automation memory）；未修改任何 WorkBuddy 技能文档
- ⛔ 未新增 / 修改 `_v4-contract-20260923` worktree 内任何文件（tracked status 仍为空）
生产侧：
- 代码 / 配置 / Authority / Seal / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- Evidence Contract v1.0 / v3.0 / v4.0 DRAFT：零字节修改
- DB 集合（decision_result / portfolio_snapshot / ml_shadow_signal / runtime_status /
  run_candidate_decision / run_candidate_portfolio / run_manifest / run_history / active_run_pointer）：
  零写入（写命令数 = 0）
- 云函数：未调用、未部署、未改触发器；未触发任何 automation
- health / canary / permission / overlay / CALC / ORCH：零修改
- PR #60 body：零修改
```

**`_v4-contract-20260923` 独立核验**：`git rev-parse HEAD` = `8d1f1cde5effa8bf6eb3d88b780f84e3873337ef`；`git status --short` = 空。

---

## 11. 交付元数据

```text
报告路径 : outputs/evidence-watch-20260921/GEN1_STEP11_E1_READ_SOURCE_RULING_PREREQ_20261002.md
文件大小 : 见写后复算（填入交付说明，不入文件内以免自指）
行数     : 见写后复算
SHA256   : 见写后复算
```

> ⚠️ 本报告**不在文件内写入自身 sha256**（自指悖论）。sha256 由写后复算记录于交付说明与 automation memory，与既有各步做法一致。

---

## 12. STOP-AND-REPORT

**本 Step（PHASE 1 / Step 1.1-E1）已完成，立即 STOP。**

**本步结论（中性描述，不含选择）**：

```text
1. v4 当前绑定的两个集合（decision_result / portfolio_snapshot）
   恰是 ENFORCE 下「已停写」的两个集合；
2. v4 所需字段在 ENFORCE 下仍在产生，只是落在 run_candidate_decision / run_candidate_portfolio；
   ⇒ 问题性质 = SOURCE BINDING（绑定位置），不是「字段消失」；
3. B-1 / B-2 在三个方案下的状态：①a 事实未解 / ①b 实质可解（以改版为条件）/ ①c 事实未解但重分类；
4. 三轴分离：契约可冻结性 ⊥ Evidence 可执行性 ⊥ 生产读写链修复；
   ①a=可冻结但须动生产链；①b=不可冻结（须改版）但不动生产链；①c=可冻结且不动任何生产件；
5. 「冻结后必然无法满足」的硬条件在 ①a / ①c 下均存在（§5.4 规则 5 / 7），①c 不消除，只重分类；
   ①b 若要实施，须一条新的 CONTRACT GENERATION 授权 + 一条仓库写授权（E-3 仍须先闭合）。
```

⛔ **本步不做（等待 Owner 明确授权）**：

- ⛔ 不冻结 Evidence Contract v4；⛔ 不修改 v1.0 / v3.0 / v4.0 任何字节；
- ⛔ 不修改生产代码 / 配置 / DB / Authority / Seal / lock / immutable_set；
- ⛔ 不修改 health / canary / permission / overlay / CALC / ORCH；
- ⛔ 不改 `c1_capture.py`、不改 PR #60 body、不动 `_v4-contract-20260923` worktree；
- ⛔ 不处理 E-2 / E-3 / E-4 / E-5；⛔ 不裁定 UNV-22/23/27/28/29/30~33；
- ⛔ 不进入 Step 1.2；⛔ 不进入 PHASE 2 / PHASE 3；
- ⛔ 不选 ①a / ①b / ①c。

**WAIT FOR OWNER RULING** —— 下一项应为：

```text
(A) 裁定 E-1 读源正解：①a / ①b / ①c
(B) 就 §8 的细化裁定点（2/3/4/5/6/7/8）给出决定
(C) 授权 G-1：①b 所需的 CONTRACT GENERATION 授权（仅当选 ①b）
(D) 其它 Owner 指定动作
```

*本报告为只读分析产物，不构成任何契约冻结或生产变更授权。*
