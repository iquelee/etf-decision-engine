# Gen-1 COUNTERFACTUAL_CANARY 上线清单（Runbook）

**适用范围**：把 `gen1_authority` 从 `ADVISORY` 升到 `CANARY`（= COUNTERFACTUAL_CANARY）。
**批准状态**：✅ 已获复审正式批准（**严格限定：真实线上计算反事实组合，不改 `final_target`、不取得生产仓位权、不自动交易**）。
**明确 NO-GO**：`LIMITED_PRODUCTION` / `PRODUCTION` / 自动交易。

**任何一个验收项不通过 → 立即停止并回退（第 6 步的反向操作即可）。**

---

# ✅ 上线阻塞项已修复（2026-09-10 / WP-G1-DATA-01，方案 B+）

## 现象（修复前实测）

第 2 步之前的 30 秒数据检查结果：

| 标的 | 最新 official EOD | 备注 |
|---|---|---|
| 513310 / 515880 / 159582 / 159570 / 518880 | **2026-09-09** | 一致 ✓（513310 另有 2026-09-10 行，但 `source='realtime'`，被 `officialBars()` 过滤） |
| **510300（基准）** | **2026-09-04** | `source='research_import'`，**落后 3 个交易日**（缺 09-07/08/09） ✗ |

后果链（代码级，无容差）：

```text
benchmarkLatestDate(2026-09-04) !== mainDate(2026-09-09)
  → gen1-data-health 规则2 → DATA_BLOCKED / BENCHMARK_MISSING
  → runGen1ShadowEod: worstData='BLOCKED'
  → computeHealthStatus({ dataHealth: 'BLOCKED' }) → ML_OFF
  → 首次 bootstrap 就把 latch 写成 ML_OFF（manual_review_required=true、allow_advisory=false）
  → 第 5 步验收表中 latched_health=OK 不可能成立；且命中 STOP 清单
```

## 根因（结构性）

- `fetchDailyData` 抓取范围 = `db.getEtfList()` = `etf_basic` 的 **5 只 ETF**；**510300 不在其中** → 生产每日任务**永不更新 510300**。
- 510300 的 `etf_daily` 行全部来自 `source='research_import'`（本地 ML 流水线），最后更新 2026-09-04。
- G1-05（data health）把这个静默问题（`rs_20d` 走模型 imputer）升级为**显式 BLOCKED** —— 收紧方向正确，缺的是数据生产责任。

## 采纳方案：B+（独立 Benchmark Lane，不新建云函数、不污染 Universe）

```text
fetchDailyData
├── production lane   Main5  ← etf_basic / getEtfList  → 决策 Universe（抓日线 + 折溢价）
└── benchmark lane    510300 ← GEN1_BENCHMARK_CODES     → 只写 etf_daily（不抓折溢价、不进 Universe）
```

关键实现点（`tests/gen1-benchmark-pipeline.test.js` / Gate **G1-T** 逐条守卫）：

| # | 要求 | 实现 |
|---|---|---|
| 1 | 基准单一事实源 | `src/common/constants.js` 的 `GEN1_BENCHMARK_CODE(S)`；抓取/健康/测试统一读它 |
| 2 | 510300 绝不进 `etf_basic` | 基准清单来自常量，不来自 `getEtfList()`；测试断言任何情况下不写 `etf_basic` |
| 3 | 不新建云函数，扩展现有任务 | `fetchDailyData` 内两条 Lane，同一交易日 / datasource / 调度窗口 |
| 4 | 公共抓取函数，禁止复制 | `fetchAndPersistDaily(code,{role,fetchPremium,limit})`，Main5 与基准共用 |
| 5 | **幂等必须含 510300** | `planDailyFetch()` 两条 Lane **分别**判定；任一缺失即不得 `already_fetched` |
| 6 | 不混淆来源与角色 | `source` 仍是 `tencent/sina/eastmoney`；角色由 `code` 表达（**不新增 DB 字段**） |
| 7 | 首次补齐完整窗口 | 基准 Lane 固定抓 **320 根**（覆盖 ≥ 260 根滚动窗口），upsert 覆盖旧的 `research_import` 近期窗口，不删更老历史 |
| 8 | 复权口径一致 | 同一 `datasource.fetchDaily` → 腾讯 qfq 主源，与 Main5 同口径（backfill 后抽查 ret20） |
| 9 | 新增 Benchmark 测试 | T1~T6，重点 T2「Main5 今日完整 + 基准今日缺失」幂等反例 |
| 10 | 返回值显式报告 | `production_daily` / `benchmark_daily` / `overall = OK\|PARTIAL\|FAIL` |
| 11 | 调度顺序 | 基准必须在同一 EOD 数据任务内先于 `materializeIndicators` → `runGen1ShadowEod` 完成 |
| 12 | 首次补数后再恢复上线 | 见下方「1.5 部署数据管线 + backfill」 |

**失败语义（关键）**：基准抓取失败 → 数据任务 `overall = PARTIAL`，**V3.6.1 生产数据更新不受影响**，Gen-1 后续 Data Health fail-closed（`BENCHMARK_MISSING` → `ML_OFF`）。即 Gen-1 作为增强层，**不能**因为自己的基准失败把基线拖死。

**冻结管线文件未改**：`runGen1ShadowEod/index.js` 是 Pipeline Lock 覆盖的冻结文件，其中基准字面量**未替换**（替换会破坏冻结链、需重签 root anchor），改由 G1-T 守卫「字面量 === `GEN1_BENCHMARK_CODE`」——任何漂移 CI 立即 FAIL，运行时亦 fail-closed。

---

## 1.5 部署数据管线 + Benchmark backfill（**新增：必须在上线第 2 步之前完成**）

> **WP-G1-DATA-02 补充（2026-09-10）**：补数前必须已部署含定稿闸门的版本，规则如下。
>
> **① 当日 bar 定稿闸门**：`DAILY_BAR_FINALIZATION_CUTOFF = '15:30'`（北京时间）。
> 落库前对每根 bar 判 `isBarWritable`：历史 bar（`trade_date < today`）**盘中也可安全回补**；
> 当日 bar 只有过了 15:30 才允许写入，并打 `is_final: true`。
> 因此**盘中跑 `force` 是安全的** —— 它会补齐历史、丢掉当天那根未定稿 bar。
>
> **② 「就绪」= 已定稿，不是「有成交量」**：`isStructurallyValidDailyBar()`（volume>0 && close>0）
> 只说明字段完整；判定就绪用 `isFinalizedDailyBar()`（当日 bar 必须带 `is_final`）。
> 盘中误写入的当日 bar 因此**永远不会**被当成正式 EOD，会在收盘后被抓取覆盖。
>
> **③ Lane 执行**：只抓 `plan.<lane>.to_fetch`；已就绪的标的**一次都不抓**
> （避免生产数据已完整时，一次瞬时失败把 `overall` 打成 FAIL）。
> 结果按 `READY_EXISTING / FETCHED_OK / FETCH_FAILED` 三态上报。

```bash
# ① 只部署数据管线（先不碰 Gen-1 决策链）
node scripts/build-cloudfunctions.js
python scripts/prepare-deploy.py
tcb fn deploy fetchDailyData --dir dist-functions/fetchDailyData --force

# ② 强制跑一次（基准 Lane 抓 320 根 → 覆盖 09-07/08/09 及近期完整滚动窗口）
#    HTTP 触发：{"force": true}
```

**验收（不通过则 STOP，不得进入第 2 步）**：

```text
benchmarkLatestOfficialDate(510300) == Main5LatestOfficialDate     # 当前应为 2026-09-09 或当日收盘价
fetchDailyData 返回 overall == 'OK'
production_daily.ok == true  &&  benchmark_daily.ok == true
510300 的 etf_daily.source ∈ { tencent, sina, eastmoney }（不再是 research_import 的近期窗口）
510300 不出现在 getEtfList() / etf_basic / 前台标的列表
当日行（若有）带 is_final === true；`lane_execution.production_to_fetch` 只含未就绪标的
```

补齐后**重新执行第 2 步之前的「30 秒数据检查」**，通过才继续。

---

# ⚠️ 已知偏差登记（2026-09-10 复审裁决）

以下两项**均不阻塞 Gen-1 首次上线**，登记在案，上线链结束前不得顺带整改（减少变量原则）。

## D-1：`fetchDailyData.InstallDependency = TRUE`（配置漂移，P2）

```text
fetchDailyData.InstallDependency = TRUE
status              = KNOWN_CONFIG_DRIFT
severity            = P2
production_blocker  = false
```

- **判定依据**：属**配置一致性问题，不是功能/数据安全问题**。新代码已在线、部署包 SHA 对齐、模块加载与出网冒烟成功，且部署包**自带 `node_modules`**（不依赖运行时安装）。
- **处置**：**不**为恢复 `FALSE` 去做设备码授权 + 二次部署 —— 那会为一个非阻塞配置引入新的变化源（CLI 登录态 + 重部署），违背「临近首次上线尽量减少变量」。
- **恢复时机**：待 CloudBase CLI 登录态恢复稳定后，统一做一次 **Runtime Config Normalization**，届时一并复位为 `FALSE`。**不得夹在 Gen-1 Canary 上线链里执行。**

## D-2：`fetchDailyData` 链式调用语义未按 Lane 区分（P2）

现状：无论 Lane 结果为 `OK / PARTIAL / FAIL`，末尾都无条件链式调用 `materializeIndicators`。

- **为何不阻塞**：① benchmark 失败时 Gen-1 下游 Data Health 本就 fail-closed；② V3.6.1 的 Main5 生产链**不应被 benchmark 拖死**（这是 B+ 的既定语义）；③ 首次执行安排在 15:45 finalized 之后。
- **后续方向**（**不要现在扩 DATA-02 范围**）：

```text
Production Lane OK   → materializeIndicators 可运行
Production Lane FAIL → 不链式物化 / 或显式标 degraded
```

## D-3：`DAILY_BAR_FINALIZATION_CUTOFF = '15:30'` 维持不变（观察期）

- `15:45` 仅作为**首次人工 backfill 的保守执行时间**；日常生产逻辑固定用 `15:30` cutoff，两者不是一回事。
- 现行规则：历史 bar 随时可写；today bar `< 15:30` 不写；`>= 15:30` 写并打 `is_final: true`。
- **先观察实际生产几天**。若发现腾讯在 15:30 附近仍会修订 EOD OHLCV，再评估改 15:35/15:45；**当前无证据，不扩大安全余量**。

---

# 冻结管线处置确认（2026-09-10）

- ✅ 未为「单一事实源更漂亮」去改冻结的 `runGen1ShadowEod`（Pipeline Lock 覆盖文件）。
- 维持 **Frozen Contract Alias + CI 守卫**（G1-T 断言「字面量 === `GEN1_BENCHMARK_CODE`」）方案 —— 比重签 immutable root anchor 更稳（重签会破坏冻结链）。
- `frozen model SHA` / `threshold_signal_p = 0.65` / Safety / authority / V3.6.1 / Gen-2 **全部零改动**。

---

## 0. 上线前提（全部满足才继续）

| 项 | 期望值 |
|---|---|
| 本地 `npm test` | **39/39** |
| Gen-1 Production Gates | **G1-A ~ G1-U 21/21**（含 G1-T Benchmark Pipeline、G1-U Daily Finality） |
| Immutable SHA | 11/11 |
| Feature Pipeline Lock | 10/10（frozen 管线文件零改动） |
| frozen model SHA | `d5e667c66a5f888bb5489b8adcad9e6a141bfbcf0006a955d6ad40e269a7e712` |
| `threshold_signal_p` | `0.65`（未改） |
| 分支/PR 链 | #11→…→#18+#19+#20 **全部已合并入 master**（merge commit，未 squash）；当前 master = `ad7330f8`（PR #20 merge） |

---

## 1. ✅ 按审计顺序合并 PR（**2026-09-10 已完成**）

```text
792f5b28 #18 → 42df9b6c #17 → cc7500e5 #16 → b019170a #15
645646fd #14 → 9ca937b9 #13 → 563f4b79 #12 → fc4c0fd2 #11
```
master push CI（792f5b28）= success。

要点（踩坑记录）：
- **`pull_request` 默认 trigger 不含 `edited`**：retarget base 不会触发 CI，会一直等到超时。
  正确做法 = `PATCH {state:'closed'}` → `PATCH {state:'open'}`（触发 `reopened`），无需推空 commit。
- **不要 squash** —— 这些 PR 记录了「Gen-1 如何一步步取得权限」，是未来审计资产。

---

## 2. 构建 + 部署最新 `runDecisionEngine` 与 common

```bash
# 源构建（src/common → dist-functions，含 SHA256 parity 校验）
node scripts/build-cloudfunctions.js
python scripts/prepare-deploy.py
# 必须带 --force，否则交互式覆盖确认会卡死
tcb fn deploy runDecisionEngine --dir dist-functions/runDecisionEngine --force
# Gen-1 信号生产者也需同批部署（health latch 写侧）
tcb fn deploy runGen1ShadowEod --dir dist-functions/runGen1ShadowEod --force
```

> Windows 家用机三坑见 skill `cloudbase-deploy-windows`：重定向 `USERPROFILE`、unset 代理、
> CLI 位于 `~/.workbuddy/binaries/node/workspace/node_modules/@cloudbase/cli`。

---

## 3. ✅ 确认 / 创建 `gen1_health_state`（**2026-09-10 已完成**）

**为什么必须先做**：集合缺失 → `readHealthState` 抛错 → `READ_ERROR` → `ML_OFF` → `allow_canary=false`，
于是切 CANARY 后会出现 `authorized=true` 但 `health_allowed=false / active=false`，**极易被误判为接线 bug**。

**线上状态**：已用 CloudBase MCP 创建（`createCollection` + `uk_key` 唯一索引）。

```bash
# 建集合（tcb db createCollection 无效，必须用 nosql execute）
tcb db nosql execute --command '[{"TableName":"gen1_health_state","CommandType":"COMMAND","Command":"{\"create\":\"gen1_health_state\"}"}]' --envId tradingview-etf-d0fa42yy57cbc11b --json

# 唯一键索引（单文档 latch，key='gen1-health-state'）
tcb db nosql execute --command '[{"TableName":"gen1_health_state","CommandType":"COMMAND","Command":"{\"createIndexes\":\"gen1_health_state\",\"indexes\":[{\"key\":{\"key\":1},\"name\":\"uk_key\",\"unique\":true}]}"}]' --envId tradingview-etf-d0fa42yy57cbc11b --json
```

或直接跑初始化脚本（集合清单已由 SCHEMAS 驱动，含 `gen1_health_state`）：
```bash
TCB_ENV=tradingview-etf-d0fa42yy57cbc11b node scripts/init-collections.js
```

**验收**：集合存在即可；文档可为空（会由下一次 EOD 自动 bootstrap 创建 `key='gen1-health-state'`）。

---

## 4. 保持 `gen1_authority = ADVISORY`，先跑一次完整 EOD + runDecisionEngine

```bash
# 1) Gen-1 信号 + health latch 写侧
tcb fn invoke runGen1ShadowEod --envId <env>
# 2) 决策引擎（读 latch，产出 gen1_counterfactual_* 字段）
tcb fn invoke runDecisionEngine --envId <env>
```

---

## 5. 验收线上（ADVISORY 阶段）

`runtime_status`（key=`runtime-status`）必须满足：

```text
gen1_health_gate_status              = ACTIVE          ← 若为 PENDING/READ_ERROR 则 STOP
gen1_health_source                   = GEN1_HEALTH_STATE_LATCH
gen1_counterfactual_ledger_ok         = true            ← 若 false 则 STOP
counterfactual_canary_authorized      = false           ← ADVISORY 阶段应为 false
gen1_production_fast_path_enabled     = false
gen1_production_write                 = false
gen1_auto_execution                   = false
```

另确认 `gen1_health_manual_review_required = false`、`gen1_health_economic_status = PENDING`（样本不足，正常）。

---

## 6. 切开关（只改一个参数）

```text
param_config.gen1_authority:  ADVISORY  →  CANARY
```

单字段、可逆、**无代码变更**；`production_write` / `auto_execution` 恒 false；`final_target` 仍为 V3.6.1。

---

## 7. 再跑一次 `runDecisionEngine`，验收反事实通路

```text
counterfactual_canary_authorized      = true
counterfactual_canary_health_allowed  = true
counterfactual_canary_active          = true
counterfactual_canary_invocations     = 0 或 正整数
```

- `invocations = 0`（当日无 Model Candidate）**完全正常** —— 说明没有 S4 重算发生。
- 若 `active = false` 而 `authorized = true`：查 `health_allowed` 与
  `gen1_counterfactual_ledger_ok`，再看日志有无 `GEN1_COUNTERFACTUAL_LEDGER_OVERFLOW`。

---

## 8. ★ 最重要：No-op 验收

切换前后逐字段比较，**必须完全一致**：

```text
decision_result.final_target          ← V3.6.1 生产语义，一字不变
decision_result.final_action
decision_result.suggested_position
portfolio_position.*                  ← 实际持仓（引擎不写实际仓位）
portfolio_snapshot.total_asset / total_pnl
```

Gen-1 **只允许新增** `gen1_*` 字段（`gen1_counterfactual_*`、`gen1_canary_*`、`gen1_health_*`）。
运行期 `applyGen1Overlay` + `verifyProductionNoop` 已在代码层强制该不变量；
若有任何 diff → **立即回退第 6 步并排查**。

---

## 9. 回退预案

| 症状 | 动作 |
|---|---|
| 反事实字段异常 / 组合越界告警 | `gen1_authority: CANARY → ADVISORY`（单字段，立即生效于下次运行） |
| health 门异常（PENDING/READ_ERROR） | 同上；集合问题按第 3 步修复后重跑 EOD |
| 生产字段被改动（No-op 失败） | 立即回退，并视为 P0 事故排查（代码层本应由 `verifyProductionNoop` 抛错阻断） |
| 任何不确定 | 回退到 `ADVISORY` —— 反事实通路关闭后 Gen-1 对生产零影响 |

---

## 10. 上线后：进入证据积累阶段

上线后 Gen-1 每天生成真实 **Live Counterfactual Portfolio**。下一阶段（**WP-G1-EVIDENCE**）要回答的不再是「代码安全吗」，而是：

> 当 Gen-1 把 S2 提前当成 S4 时，**真实情况下能否持续创造优于 V3.6.1 的 Timing Gain，且不明显抬高 False Fast Path 与 MAE？**

评估应按 **Baseline Suggested vs Counterfactual Suggested** 比较（不是只比 target）。
在此之前 **禁止**修改 `0.65` 与 frozen model。

**经济 Gate 现状（未放松）**：3 个 event clusters / 2 个 independent events / BULL = 0 / IN_DOMAIN = 0
→ `LIMITED_PRODUCTION` / `FULL_PRODUCTION` 维持 **BLOCKED**。
