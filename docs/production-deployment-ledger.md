# 生产部署台账（append-only）

> **本文件是 append-only。** 线上基线一律以「追加一行」的方式记录，
> **不改动历史行**；如需更正，另起一行并标注 `supersedes` / `errata` 关系。
>
> 与 `docs/主链冻结契约.md` 的关系：契约里的 2026-09-05 记录是**当时的事实**，
> 本台账**不覆盖、不重写**它；只在其后追加，并用 `errata` 指针说明哪些字段已经过期。
>
> 建立日期：2026-09-22（V3.6.4 Safety Hardening 资格化）
> 环境：`tradingview-etf-d0fa42yy57cbc11b`（腾讯云开发 CloudBase，上海，个人版，NoSQL 后端）

---

## 0. 字段口径（重要，避免误比）

| 字段 | 含义 | 取法 |
|---|---|---|
| `deploy/mod_time` | 线上函数最后修改时间 | CloudBase `queryFunctions.getFunctionDetail` 的 `ModTime` |
| `source_repo_sha` | 该次部署对应的仓库提交（**推定**，非线上自证） | 该时间点之前最后一个 commit |
| `package_sha256` | 线上函数代码包 SHA256 | `getFunctionDownloadUrl` 的 `CodeSha256`；与本地下载 zip 重算逐位比对 |
| `index_sha256_raw` | `runDecisionEngine/index.js` 原始字节 SHA256（含 CRLF） | 下载包解压后 `sha256sum` |
| `index_sha256_lf` | 同上，但 **LF-normalized**（本仓锁文件的 `hash_basis`） | `content.replace(/\r\n/g,'\n')` 后 sha256 |
| `source_parity` | 线上包 vs 仓库源码的逐文件对账结论 | 解压线上包（排除 `node_modules` / `config.json` / 2 个 Gen-1 封印 JSON）后逐文件 SHA256 比对 |

⚠️ **`package_sha256` 与 `index_sha256` 是两种不同的东西**，不可互相比较：
前者含 `node_modules` / `config.json` 等，同一份源码重新打包也会得到不同的 zip 字节。

---

## 1. 部署 / 核验记录

### D-001 · 2026-09-05 · 首次记录部署（V3.6.1 切流后）

| 项 | 值 |
|---|---|
| `deploy/mod_time` | 2026-09-05 14:01（**来源：契约文档记载**，非本次实测） |
| `source_repo_sha` | N/A —— **早于本仓提交历史**（本仓首个 commit 为 2026-09-08 10:59:17 `8fc3ba66da6cb99b9da22b8933d59d582ddb8982`） |
| `package_sha256` | `7876610f…82e6315d`（**仅存于 `docs/主链冻结契约.md` §1，本次无法复算**：该包已被后续部署覆盖） |
| `index_sha256_raw` | 未留存 |
| `source_parity` | 未核验 |
| evidence | `docs/主链冻结契约.md` §1 表格 |
| 状态 | **既成历史记录，不作为当前基线** |

### D-002 · 2026-09-17 · GE-03 重部署

| 项 | 值 |
|---|---|
| `deploy/mod_time` | **2026-09-17 14:24:41**（2026-09-22 只读实测 `ModTime`） |
| `source_repo_sha`（推定） | `eefbedf28f547667c8557f055e6c4fc0891f8132`（2026-09-17 13:48:22，`Merge pull request #47 from iquelee/ge03-shadow-guarded-rerun`） |
| `package_sha256` | 未在当日留存；**2026-09-22 实测 = `a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608`** |
| `index_sha256_raw` | `da4910cae28476e6…`（2026-09-22 实测，与线上下载包内字节一致） |
| `index_sha256_lf` | `36be942f97d94fde…`（仓库侧同口径复算，`git show eefbedf:cloudfunctions/runDecisionEngine/index.js`） |
| `source_parity` | **MATCH 66 / 66**（2026-09-22 复核） |
| evidence | `_v361-r1-baseline-20260922/BASELINE_EVIDENCE.md`、`_v361-r1-baseline-20260922/parity.json`、`_v361-r1-baseline-20260922/runDecisionEngine.online.zip` |

### D-003 · 2026-09-22 · 只读核验（V3.6.4 资格化前置）

| 项 | 值 |
|---|---|
| `deploy/mod_time` | **2026-09-17 14:24:41（未变）** ⇒ 自 D-002 之后**未再部署** |
| 函数元数据（实测） | `Runtime=Nodejs16.13` · `FunctionVersion=$LATEST` · `CodeSize=3984731` · `Status=Active/Available` · `Timeout=120` |
| `package_sha256` | `a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608`（API `CodeSha256` 与本地下载 zip 重算**逐位一致**） |
| `index_sha256_raw` | `da4910cae28476e6…` |
| `source_parity` | **MATCH 66 / 66**（ONLY_ONLINE 0 / ONLY_REPO 0 / CONTENT_DIFF 0） |
| 当前仓库基线 | `origin/master = 650db58639f32232ac72a99920060dd92e743621` |
| evidence | 同 D-002 |

### D-004 · 2026-09-22 · V3.6.4 runDecisionEngine Production Promotion

> 授权范围：**仅** `runDecisionEngine`，一次。**不含** `materializeIndicators`、不含任何其他云函数。
> `PRODUCTION PROMOTION AUTHORIZATION = GRANTED — RUNDECISIONENGINE ONLY`

| 项 | 值 |
|---|---|
| `deploy/mod_time`（NEW） | **2026-09-22 16:29:48**（2026-09-22 只读实测 `ModTime`） |
| `deploy/mod_time`（PREVIOUS） | `2026-09-17 14:24:41`（= D-002 / D-003 基线） |
| 函数 | `runDecisionEngine`（`FunctionId = lam-eiye285p`） |
| Runtime / Handler | `Nodejs16.13` / `index.main`（**部署前后未变**） |
| `CodeSize` PREV → NEW | `3984731` → `4013498`（+28 767；= 8 个新增 + 6 个修改的 common 源文件） |
| `previous_package_sha256` | `a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608` |
| `new_package_sha256` | `aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea`（API `CodeSha256` 与本地下载 zip 重算**逐位一致**） |
| `previous_index_sha256_raw` | `da4910cae28476e6c1605b4043b29ee6afda558f43685c8d0f73da353fc26024` |
| `new_index_sha256`（LF） | `072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b` |
| `frozen_source_commit` | **`aa634e264270f26207c59c19ef3e1c31dde01e64`**（tag `v3.6.4-frozen^{}`；用 `git archive` 取干净归档后构建，**非审计分支、非工作区**） |
| `master_containing_commit` | `519c3559c9840fa954e3357d665635fd1f97648c` |
| `source_parity` | **MATCH 77 / 77**（ONLY_LIVE 0 / ONLY_CAND 0 / CONTENT_DIFF 0；线上源码 == frozen V3.6.4 预期部署源码） |
| 部署前预检 | `UNEXPECTED_PACKAGE_DIFF = 0`（新增 8 = 期望集、修改 6 = 期望集、删除 0、`node_modules` 1703 文件逐位一致） |
| `param_config` changed | **NO** |
| `materializeIndicators` changed | **NO**（`ModTime` 仍 `2026-09-08 11:35:24`、`CodeSize` 仍 `4073486`、`CodeSha256` 仍 `9642cae255536f5ed1ac040d2891c6152ffba7c7f02fc3a859703ab2d7d44302`、COS 对象 UUID 未变） |
| 其余 9 个云函数 | **未触碰**（本轮零调用） |
| `rollback artifact` | `_v364-deploy/rollback/runDecisionEngine.PREVIOUS.a694b7d3.zip`（3 984 731 bytes，本地重算 SHA == PREVIOUS_PACKAGE_SHA） |
| evidence | `_v364-deploy/preflight_diff.json`、`_v364-deploy/postcheck_parity.json`、`_v364-deploy/postcheck/runDecisionEngine.NEW.aa576c20.zip`、`_v364-deploy/rollback/` |
| 部署后状态 | ⚠️ **首笔自然生产运行尚未发生** ⇒ 当时只能记为 `FROZEN / MERGED / DEPLOYED`，**不得**记为 `/ PRODUCTION`（见 D-004 备注） |
| 备注 | 未为验证幂等性人为触发任何生产运行。后续另起一行（D-005 或勘误）登记首笔自然运行验收结果，**不得改写本行**。 |

---

### D-005 · 2026-09-23 · V3.6.4 首笔自然生产运行验收

> 本行**只读**记录；**未修改任何历史行**（D-001~D-004 逐字未动）。
> 触发路径（实测）：`dailyPipeline-0800`(timer, `0 0 8 * * 1-5 *`) → `materializeIndicators` → 链式 `runDecisionEngine`。
> ⚠️ **勘误前置**：部署后**首笔**自然运行实际发生在 **2026-09-22 22:01:32**（`fetchDailyData` 22:00 链），
>   **早于** D-004 事后记录的「下一笔预计 2026-09-23 08:00」预测 ⇒ 该预测不完整，见 E-004。

| 字段 | 值 |
|---|---|
| `acceptance_date` | 2026-09-23（只读验收时刻 09:12 +08:00） |
| `run_1`（**首笔自然运行**） | **2026-09-22 22:01:32** · `request_id = fdda3368-f622-454e-8474-3925c4db3e93` · `END` 22:01:41.186 · `duration 9099ms` |
| `run_2`（第二笔 · 同日重放） | **2026-09-23 08:00:29** · `request_id = 804f7202-971b-46de-a3df-bdf5112af24e` · `END` 08:00:38.573 · `duration 8593ms` |
| `run_1 source` | `request_source = TCB_API`（由 `fetchDailyData` 链式调用进入） |
| `run_2 source` | `request_source = TCB_API`；上游 `materializeIndicators` `request_id = 1fcaa62f-…` 于 `08:00:09` `request_source = TRIGGER_TIMER` |
| `calc_date`（输入快照） | **2026-09-22**（两笔运行相同；`shadow_log.snap_date = 2026-09-22`） |
| `decision_date` | run_1 = `2026-09-22`；run_2 = `2026-09-23` |
| `execution_status` | run_1 `status_code 200 / ret_code 0 / ok:true`；run_2 同 —— **无 runtime exception** |
| `five_etf_completeness` | **5 / 5 `ok:true`**（两笔运行均如此）· 无 partial failure |
| `final_target` / `final_action` | 518880 WAIT 25 · 159570 WAIT 7.5 · 515880 WAIT 5 · 159582 HOLD 5 · 513310 STRATEGIC_REDUCE 7.5 —— **两笔运行逐字段完全相同** |
| `trend_stage` | 518880 S0 · 159570 S0 · 515880 S1 · 159582 S7 · 513310 S0（与 `portfolio_position.trend_stage_state.displayStage` **逐票一致**） |
| `binding_constraint` | 5 / 5 = `none` |
| `runDecisionEngine.CodeSha256` | `aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea`（= D-004；本地下载重算**逐位一致**，COS 对象 UUID 仍 `619d53c8-…` ⇒ **未被重部署**） |
| `runDecisionEngine.ModTime` | **2026-09-22 16:29:48（未变）** |
| `index_sha256_raw` | `072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b` |
| `index_sha256_lf` | `77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529` |
| `source_parity`（复算） | **MATCH 77 / 77**（`ONLY_LIVE 0 / ONLY_CAND 0 / CONTENT_DIFF 0`） |
| `idempotence state persistence` | **PASS** —— 5 票 `trend_stage_state` 均含 `last_evaluated_trade_date = 2026-09-22`、`day_start_state`、`trade_date_anchored = true`、`idempotence_reason = same_trade_date_replay` |
| `idempotence 实证` | run_1 与 run_2 **输入快照同为 `calc_date 2026-09-22`** 且**输出逐字段一致**，但 `days_in_stage` 只推进 **1** 天（例：513310 `day_start_state.days_in_stage 7` → `8`）⇒ **修复在生产上被自然验证**（修复前该场景会重复计数） |
| `diagnostics health` | **PASS** —— `portfolio_snapshot` 新诊断全部落库：`decision_market_regime=defensive`、`market_regime_divergent=false`、`market_regime_sources=deriveMarketEnvironmentForPortfolio` + `deriveMarketRegime`、`index_state_count=3`、`w5_majority_gate_reachable=false`、`portfolio_detected_etf_count=5`、`portfolio_mode_expected=true` / `portfolio_mode_effective=false` / `portfolio_mode_suspected_mismatch=true` |
| `diagnostics 未反向影响决策` | 确认：`final_target` / `final_action` 两笔一致；诊断字段均不参与任何决策判据（纯只读） |
| `schema / write error` | **无**（CLS 全窗口检索 `ERROR / Error / error / exception` 命中的唯一一条为上游链式超时，见 OBS-001；无 schema 或写库报错） |
| `materializeIndicators` unchanged | **YES** —— `ModTime` 仍 `2026-09-08 11:35:24`、`CodeSize` 仍 `4073486` |
| `other cloud functions` | 10 个函数中**仅 `runDecisionEngine` 的 `ModTime` 为 `2026-09-22 16:29:48`**，其余 9 个全部停在 09-08 / 09-09 / 09-10 ⇒ 无 `deploy all` 类误操作 |
| `param_config` changed | **NO**（本次验收全程只读，未写入） |
| `rollback triggered` | **NO** |
| `rollback artifact（就绪）` | `_v364-deploy/rollback/runDecisionEngine.PREVIOUS.a694b7d3.zip` |
| `verdict（15 项验收）` | **ALL PASS** |

#### OBS-001（观察项，**未解释**，非阻断）—— 上游链式调用报 `ESOCKETTIMEDOUT`

| 项 | 内容 |
|---|---|
| 现象 | 2026-09-23 08:00 那笔中，**上游** `materializeIndicators` 返回体含 `chained: {error: "ESOCKETTIMEDOUT"}`（`request_id 1fcaa62f-…`；其自身业务 `ok:true`、5 票 `data_complete:true`） |
| 下游实际结果 | `runDecisionEngine` **确实被执行且成功**（08:00:29 → 08:00:38，5 票全 ok，数据按预期落库）⇒ **对决策结果零影响** |
| 出现范围（CLS 实测） | 本次出现于 `2026-09-23 08:00`；`2026-09-22 21:00~23:59`（含 22:01 首笔）**无**；`2026-09-21 21:00~2026-09-22 09:00`（部署前）**无**；`2026-09-19` 全天**无** |
| 归属 | **上游函数** `materializeIndicators`（部署件 `2026-09-08`，本次授权明令不得改动），非本次晋升对象 |
| 根因 | **未确定**（属 SDK 链式等待/超时上报行为；本轮不修改任何函数） |
| 判定 | **非阻断**：不满足任何一条 rollback 条件（无 runtime error / 无 schema-write error / trend state 正常持久化 / 无异常 target-action / source parity `CONTENT_DIFF=0` / 其他函数未被修改） |
| 建议 | 后续自然运行继续观察；若**再次出现**则单独立项（属 `materializeIndicators` 整改，与 V3.6.4 晋升解耦） |

#### 状态

| 项 | 值 |
|---|---|
| `state_after` | **`V3.6.4 = FROZEN / MERGED / DEPLOYED`** —— ⚠️ **`/ PRODUCTION` 后缀暂缓**，等用户对 OBS-001 的裁定 |
| 暂缓理由（登记，不选边） | 15 项生产验收**全部 PASS**，但 OBS-001 是**部署后新出现且根因未定**的现象。按本项目既有纪律「存在无法确定的关键事实时不得强行 PASS」，本行**不擅自**加注 `/ PRODUCTION`。 |
| 用户可选三种裁定 | ① 认定 OBS-001 属上游可观测性问题、对晋升无实质影响 ⇒ 补一行 `supersedes: D-005` 加注 `/ PRODUCTION`；② 要求先定位 OBS-001 根因（单独立项，不修改 `materializeIndicators` 生产件）⇒ 维持当前状态；③ 认定构成风险 ⇒ `ROLLBACK_REQUIRED`，用上表 rollback artifact 回滚 |
| `FINDING-1` | **OPEN**（未补 `ma60_slope` / `high_point_falling` / `lower_high`；未改 SlowBreak 阈值） |
| `FINDING-2` | **OPEN**（未补 `breakout_nd`；未覆盖线上 `materializeIndicators` 漂移件） |
| `materializeIndicators deployment drift` | **OPEN** |

#### 附：本次验收暴露的两个既有事实（登记，不处置）

1. **历史计数器可能含「同日重复计数」残留**：修复前（V3.6.1），同一 `calc_date` 会在「当日 22:00 链」与「次日 08:00 定时链」被**各计一次**（两链输入快照相同）。V3.6.4 起**不再重复计数**，但**不追溯修正历史 `days_in_stage`**（5 票现值已承继该残留）。
2. **`production_engine` 回报字串仍为 `v3.6.1`**：该字串来自冻结源码内变量（`resolveShadowEngineVersion` 路径），**V3.6.4 未修改任何版本字串** ⇒ 属预期、非漂移；若要在载荷中体现 V3.6.4，须走版本字串变更（未授权）。

---

### D-006 · 2026-09-23 · V3.6.4 状态定稿为 `/ PRODUCTION`（`supersedes: D-005` 的 `state_after` 字段）

> **本行为 docs-only**：**未部署、未改任何云函数、未改 `param_config`、未动冻结件**。
> 依 `## 3. 追加规范` 第 2 条（只读核验亦追加一行）登记。
> **`supersedes` 的范围严格限定为 D-005 的 `state_after` 一个字段**；
> D-001~D-005 的其余字段、以及 E-001~E-004 **逐字未动**。

#### 1. 状态升级

| 字段 | 值 |
|---|---|
| `record_date` | 2026-09-23 |
| `record_type` | 只读核验 + 状态定稿（**无部署**） |
| `deploy/mod_time` | **未变** —— `runDecisionEngine` 仍 `2026-09-22 16:29:48`；`materializeIndicators` 仍 `2026-09-08 11:35:24` |
| `supersedes` | **D-005 的 `state_after` 字段**（原值：`V3.6.4 = FROZEN / MERGED / DEPLOYED`，`/ PRODUCTION` 后缀暂缓） |
| `supersedes_scope` | **仅该字段**。D-005 的 15 项验收结论（ALL PASS）、`run_1`/`run_2` 事实、OBS-001 记录、两条「附」说明 **全部继续有效**，未被覆盖 |
| `state_after` | **`V3.6.4 = FROZEN / MERGED / DEPLOYED / PRODUCTION`** |
| `upgrade_basis` | ① D-005 的 15 项生产验收 **ALL PASS**；② 用户在 D-005 给出的三种裁定中选 **①**（认定 OBS-001 属上游可观测性问题、对本次晋升无实质影响）⇒ 补一行 `supersedes: D-005` 加注 `/ PRODUCTION`，即本行；③ `ROLLBACK_REQUIRED = NO` |

#### 2. D-005 入主链事实

| 字段 | 值 |
|---|---|
| D-005 分支 / 原 commit | `docs/v364-d005-natural-run-acceptance` · `a6e220f` |
| 同步 base 后 HEAD | `43ee063294f52f99fe21c659ffe34736ddf67649`（`update-branch` 产生的**双亲 merge commit**：`a6e220f` + `bb720ff3`，**是 merge 不是 rebase**，D-005 内容未被改写） |
| 合并 | **PR #55**，sha-pinned merge（body 带 `sha` 防 TOCTOU）· `merged_at 2026-09-23T09:53:09Z` |
| merge commit | `3d668211206bb253b90498b6c5104e042d0cdb29` |
| merge 净变更 | 仅 `docs/production-deployment-ledger.md` **`+68/-0`**（append-only 未被破坏） |
| master CI（该 merge 触发） | run **#154** `test` = **SUCCESS** · run **#133** = **SUCCESS**（新增 HEAD `3d668211`） |
| 落笔时点 `origin/master` | `3d668211206bb253b90498b6c5104e042d0cdb29`（**时点值**，非不变量） |
| `v3.6.4-frozen^{}` | 仍 `aa634e2`（**未移动**） |

#### 3. OBS-001 的最终定性

| 项 | 内容 |
|---|---|
| 定性 | **`NON_BLOCKING / OPEN`** —— 分类 `CHAINED_CALL_TIMEOUT / OBSERVABILITY`，`ROOT_CAUSE_NOT_PROVEN`，`NO_CURRENT_DECISION_IMPACT` |
| ⚠️ 措辞纪律 | ⛔ **不得描述为「已解决」**；⛔ **不得改 `materializeIndicators`**；⛔ 不得调 timeout / retry / `callFunction` 参数 |
| 处置 | 根因定位**另行立项**（属 `materializeIndicators` 观测性整改，与本次状态定稿**解耦**） |
| 复查要求 | 后续自然运行继续观察；**若再次出现**，在独立立项中处理，本行不因此变动 |
| `ROLLBACK_REQUIRED` | **NO** |

#### 4. 仍为 OPEN 的既有项（本行不处置）

| 项 | 状态 |
|---|---|
| `FINDING-1` | **OPEN** —— 未补 `ma60_slope` / `high_point_falling` / `lower_high`；未改 SlowBreak 阈值 |
| `FINDING-2` | **OPEN** —— 未补 `breakout_nd`；未覆盖线上 `materializeIndicators` 漂移件 |
| `materializeIndicators deployment drift` | **OPEN** —— 生产 `indicator_snapshot` 字段契约仍为 **31** |
| 冻结 manifest `gates.D.run_url` 与 `run_id` 不自洽 | **OPEN**（见 D-004 区块与本台账 §2；修改须重出 freeze commit + 重跑 CI） |

#### 5. 本次记录未做的事（边界声明）

未部署 · 未改任何云函数 · 未改 `param_config` · 未改任何冻结件或 tag · 未移动 `v3.6.4-frozen^{}`
· 未补 FINDING-1/2 字段 · 未处置 OBS-001 · 未回滚 · 未追溯修正历史 `days_in_stage`。

## 2. 勘误指针（不改历史行）

| # | 对象 | 已过期的字段 | 现状 | 处理 |
|---|---|---|---|---|
| E-001 | `docs/主链冻结契约.md` §1 `runDecisionEngine` 行 | `SHA256 = 7876610f…82e6315d`、`部署时间 = 2026-09-05 14:01` | 线上实为 `a694b7d3…` / `2026-09-17 14:24:41`（见 D-002/D-003） | **不修改契约文档**（历史事实）；以本台账 D-002/D-003 为当前基线 |
| E-002 | 同上 · 其余 9 个函数的 SHA 列 | 均为 2026-09-05 时点值 | **本次仅核验了 `runDecisionEngine`**；其余 9 个函数的线上包 SHA **未重新对账** | 待单独立项（逐函数下载重算） |
| E-003 | 本台账 `D-004` 行 `new_index_sha256（LF）` | 该值 `072b4008…` 实为 **raw（含 CRLF）**，标注的「（LF）」**有误** | 正确值：`raw = 072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b`；**`lf = 77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529`**（见 D-005） | **不修改 D-004 行**；以 D-005 的 `index_sha256_raw` / `index_sha256_lf` 为准 |
| E-004 | 本台账 `D-004` 行 `post_freeze_state` 括注 | 「下一笔自然生产运行**预计**为 2026-09-23 08:00」**预测不完整**：漏了 `fetchDailyData` 22:00 → `materializeIndicators` → `runDecisionEngine` 这条链 | 实测部署后首笔自然运行为 **2026-09-22 22:01:32**（见 D-005 `run_1`） | **不修改 D-004 行**；以 D-005 为准 |

---

## 3. 后续追加规范

1. 任何一次**线上部署**（无论谁执行）都必须在 `## 1.` 末尾**追加**一行 `D-xxx`，字段照抄上表。
2. 任何一次**只读核验**（未部署）也追加一行，`deploy/mod_time` 填「未变」。
3. 只允许追加；更正用新行 + `supersedes: D-xxx`。
4. `source_repo_sha` 若无法确证，必须显式写「推定」，不得默认属实。
5. 不得在此文件写入密钥、envId 之外的真实凭据、或任何个人资金数据。
