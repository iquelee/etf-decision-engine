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

---

### D-007 · 2026-09-29 · C-021 只读核验 —— 线上仍为 V3.6.4（零漂移）+ 部署候选冻结登记

> **本行为只读核验 + 设计登记（docs-only）**：**未部署、未改任何云函数、未改 `param_config`、
> 未动冻结件、未移动 tag、未执行 production run、未初始化 pointer**。
> 依 `## 3. 追加规范` 第 2 条（只读核验亦追加一行）登记。
> **`supersedes`：无** —— D-001~D-006 全部字段**逐字未动**。

#### 1. 只读核验（§2 Production Deployment Baseline Audit）

| 字段 | 值 |
|---|---|
| `record_date` | 2026-09-29 |
| `record_type` | 只读核验 + 部署候选冻结设计登记（**无部署**） |
| `deploy/mod_time` | **未变** —— `runDecisionEngine` 仍 `2026-09-22 16:29:48` |
| `runDecisionEngine.FunctionId` | `lam-eiye285p` |
| `runDecisionEngine.Runtime` | `Nodejs16.13` |
| `runDecisionEngine.Handler` | `index.main` |
| `runDecisionEngine.ModTime` | **2026-09-22 16:29:48（未变，= D-005 / D-006）** |
| `runDecisionEngine.CodeSize` | **4013498（未变，= D-005 / D-006）** |
| `index_sha256_raw` | `072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b`（**本地下载复算，逐位一致**） |
| `index_sha256_lf` | `77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529`（同） |
| `source_parity`（复算） | **EXACT_MATCH 74 / 76**（`CONTENT_DIFF 0`；`ONLY_ONLINE 2` = `GEN1_GUARDED_EFFECTIVE_{FREEZE,EVIDENCE}.json`，build 注入属预期） |
| `CodeSha256`（CLI 字段） | **N/A —— `tcb fn detail` 不返回该字段** ⇒ 以 `index.js` 双 SHA + 逐文件 parity 替代，⛔ 不得因字段缺失判漂移 |
| `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY` | **V3.6.4**（冻结 `aa634e264270f26207c59c19ef3e1c31dde01e64`） |
| `PRODUCTION_DEPLOYMENT_DRIFT` | **NO**（三重独立一致：`ModTime`/`CodeSize` + `index.js` 双 SHA + 逐文件 parity `diff=0`） |
| `DEPLOYMENT_IDENTITY_VERIFIED` | **false** —— ⛔ 线上 = V3.6.4，**并非**本轮 V3.6.5 candidate ⇒ 部署身份**尚未**成立（正是 C-021 缺口） |
| `rollback artifact（独立验证）` | **PASS** —— 线上包下载 → 本地复算 `index.js` 双 SHA == D-006 记录值（独立双源一致）；⛔ 非仅存下载链接 |
| `production writes` | **NO**（全程只读） |
| `deploy triggered` | **NO** |
| `production run triggered` | **NO** |
| `pointer initialized` | **NO** |
| `switch date` | **null（未设置）** |

#### 2. 部署候选冻结登记（§3 / §4 · 设计层，尚未部署）

| 字段 | 值 |
|---|---|
| `candidate base_head_sha` | `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| `candidate_manifest_sha` | `8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1`（两次重算逐位一致 ⇒ deterministic） |
| `candidate_content_sha` = `dependency_closure_sha` | `e80ea8c20785f3c8c4da70e8316d84321cfe944cb7ba25f85df2dba04ff79016` |
| `V365_DEPLOYMENT_REQUIRED_FILES` | **91**（function own 2 + canonical common 87 + extra frozen 2） |
| `V365_DEPLOYMENT_EXCLUDED_FILES` | **69**（docs 24 / scripts 26 / tests 15 / 其它 4） |
| `changed_in_closure` | **7**（⛔ 非 76 全量部署） |
| `materializeIndicators_touched` | **false** |
| `expected runtime / handler` | `Nodejs16.13` / `index.main` |
| `build_method` | `scripts/build-cloudfunctions.js` |
| `build_tool_versions` | `node v22.22.2` · `tcb_cli CloudBase CLI 3.8.1` |
| `mutable_working_tree_deploy_forbidden` | **true**（⛔ 禁止直接从 mutable working tree 部署） |
| `gate_d_status` | **PENDING_OWNER_DEPLOYMENT_APPROVAL**（`may_deploy = false`；`owner_deployment_authorization = NOT_GRANTED`） |

#### 3. 本次记录未做的事（边界声明）

**未部署** · 未改任何云函数 · 未改 `param_config` · 未改任何冻结件或 tag · 未移动 `v3.6.4-frozen^{}`
· 未执行 production run · 未初始化 pointer · 未写任何业务数据 · 未设置 switch date · 未 commit / push / PR / merge / tag。

> 证据件：`deliverables/v365-production-history/c021/{deployment-identity-audit,deployment-scope,deployment-candidate-manifest,rollback-artifact}.json`
> 设计详情：`docs/V365_DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE.md`

---

### D-008 · 2026-09-30 · C-021.1 只读核验 —— 部署 bundle 已物化（**未部署**）

> **本行为只读核验 + 本地 bundle 物化登记（local-only）**：**未部署、未改任何云函数、未改 `param_config`、
> 未动冻结件、未移动 tag、未执行 production run、未初始化 pointer**。
> 依 `## 3. 追加规范` 第 2 条（只读核验亦追加一行）登记。
> **`supersedes`：无** —— D-001~D-007 全部字段**逐字未动**。

#### 1. 只读核验（线上身份复核 —— 与 D-007 逐位一致）

| 字段 | 值 |
|---|---|
| `record_date` | 2026-09-30 |
| `record_type` | 只读核验 + **本地** deployment bundle 物化登记（**无部署**） |
| `deploy/mod_time` | **未变** —— `runDecisionEngine` 仍 `2026-09-22 16:29:48` |
| `runDecisionEngine.FunctionId` | `lam-eiye285p`（未变） |
| `runDecisionEngine.Runtime / Handler` | `Nodejs16.13` / `index.main`（未变） |
| `runDecisionEngine.ModTime / CodeSize` | **2026-09-22 16:29:48 / 4013498（未变，= D-005 / D-006 / D-007）** |
| `index_sha256_raw / lf` | `072b4008…477b` / `77f7d500…1529`（本地下载复算，**逐位一致**） |
| `source_parity`（复算） | **EXACT_MATCH 74 / 76**（`CONTENT_DIFF 0`） |
| `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY` | **V3.6.4**（冻结 `aa634e264270f26207c59c19ef3e1c31dde01e64`） |
| `PRODUCTION_DEPLOYMENT_DRIFT` | **NO** |
| `DEPLOYMENT_IDENTITY_VERIFIED` | **false** —— ⛔ 线上仍为 V3.6.4，**并非**本轮 V3.6.5 candidate |
| `production writes` | **NO**（全程只读；本地 bundle 仅写入 `deliverables/`） |
| `deploy triggered` | **NO** |
| `production run triggered` | **NO** |
| `pointer initialized` | **NO** |
| `switch date` | **null（未设置）** |

#### 2. 本地 deployment bundle 物化登记（§1~§5 · 尚未部署）

| 字段 | 值 |
|---|---|
| `DEPLOYMENT_ARTIFACT_MATERIALIZED` | **true** |
| `DEPLOYMENT_BUNDLE_SHA` | **`e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4`** |
| `bundle_content_manifest_sha` | `0e544793534552c693807f6e1985cdebdb7c235f5244c28296a29512bf00e5d4` |
| `bundle_path / size / format` | `deliverables/v365-production-history/c021/bundle/runDecisionEngine.V365.e996e88ae808.tar` / `1161728` / `ustar-deterministic`（mtime=0 · uid=0 · gid=0 · mode=0644） |
| `required_file_count` | **91**（= D-007 登记值） |
| `BUNDLE_SOURCE_PARITY` | **EXACT_MATCH**（`MISSING_REQUIRED_FILE 0` · `UNEXPECTED_FILE 0` · `CONTENT_DIFF 0` · `ONLINE_IRRELEVANT_ARTIFACT_DIFF 0`） |
| `§1 source drift` | **0 / 91**（逐文件 `sha256(current) == manifest.expected`；⛔ 不一致 ⇒ `STOP = CANDIDATE_SOURCE_DRIFT`） |
| `§4 UNEXPECTED_PACKAGE_DIFF` | **0**（`added 15` · `modified 4` · `deleted 0` · `unchanged 72`） |
| `§4 计数对账` | `19 = 7 working-tree + 12 committed-since-aa634e2`；C-021 §3 的 `7` ⊂ 本 delta `19`（**包含**关系） |
| `§4 红线三项` | `materializeIndicators_changed = false` · `param_config_semantic_change = false` · `protected_CALC_unexpected_change = false` |
| `DEPLOYMENT_ROLLBACK_BINDING` | **BOUND** |
| `previous_package_sha`（回滚目标） | `aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea`（线上 V3.6.4 · 台账 D-006） |
| `rollback_bundle_sha256`（V3.6.4 源码级） | `4c7949f5dcf3da99b1cbbc20e159fee8a86f8279c2b5f89c9a57982563d0295e`（76 文件 · 独立复核 `EXACT_MATCH` · `index.js` 双 SHA 匹配 D-006） |
| `gate_d_status` | **PENDING_OWNER_DEPLOYMENT_APPROVAL**（D-01~D-09 PASS · **D-10 `owner_deployment_authorization` = NOT_GRANTED**；`may_deploy = false`） |
| `authorization_binding`（未来授权必需） | `base_head_sha` + `candidate_manifest_sha` + **`deployment_bundle_sha`** + `production_env` + `function_name`（⛔ 仅绑 HEAD SHA 一律 REJECTED） |

#### 3. 本次记录未做的事（边界声明）

**未部署** · 未改任何云函数 · 未改 `param_config` · 未改任何冻结件或 tag · 未移动 `v3.6.4-frozen^{}`
· 未执行 production run · 未初始化 pointer · 未写任何业务数据 · 未设置 switch date · 未 commit / push / PR / merge / tag。

> 证据件：`deliverables/v365-production-history/c021/{deployment-artifact,pre-deploy-package-diff,deployment-rollback-binding}.json` · `c021/bundle/` · `c021/rollback/`
> 设计详情：`docs/V365_DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE.md`（附 §A.1~§A.11）

## 2. 勘误指针（不改历史行）

| # | 对象 | 已过期的字段 | 现状 | 处理 |
|---|---|---|---|---|
| E-001 | `docs/主链冻结契约.md` §1 `runDecisionEngine` 行 | `SHA256 = 7876610f…82e6315d`、`部署时间 = 2026-09-05 14:01` | 线上实为 `a694b7d3…` / `2026-09-17 14:24:41`（见 D-002/D-003） | **不修改契约文档**（历史事实）；以本台账 D-002/D-003 为当前基线 |
| E-002 | 同上 · 其余 9 个函数的 SHA 列 | 均为 2026-09-05 时点值 | **本次仅核验了 `runDecisionEngine`**；其余 9 个函数的线上包 SHA **未重新对账** | 待单独立项（逐函数下载重算） |
| E-003 | 本台账 `D-004` 行 `new_index_sha256（LF）` | 该值 `072b4008…` 实为 **raw（含 CRLF）**，标注的「（LF）」**有误** | 正确值：`raw = 072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b`；**`lf = 77f7d50042cee0a9a7e5f84c7769dd95de92f8091b7547307b6f325f8fe01529`**（见 D-005） | **不修改 D-004 行**；以 D-005 的 `index_sha256_raw` / `index_sha256_lf` 为准 |
| E-004 | 本台账 `D-004` 行 `post_freeze_state` 括注 | 「下一笔自然生产运行**预计**为 2026-09-23 08:00」**预测不完整**：漏了 `fetchDailyData` 22:00 → `materializeIndicators` → `runDecisionEngine` 这条链 | 实测部署后首笔自然运行为 **2026-09-22 22:01:32**（见 D-005 `run_1`） | **不修改 D-004 行**；以 D-005 为准 |
| E-005 | `ml/manifests/V364_IMMUTABLE_LOCK.json` 的 `gates.D` 区块 | 该区块**内部混用了两次 CI run**：`evidence` 文案 + `run_url`（`…/runs/35693440911`）指向 run **#144 / head `52ee424e`**；而 `run_number`(145) / `run_id`(`35693711637`) / `head_sha`(`c37ec91b`) 指向 run **#145 / head `c37ec91`**（与 top-level `qualification_ci_*` 一致） | 两次 run 在 GitHub 上**均为 success**（同分支 `feat/v361-safety-hardening-r1`，06:07 与 06:11 各推一次）⇒ 资格化**结论正确性不受影响**，属**字段级不自洽**（`gates.D.status = PASS` 本身成立） | **不修改冻结件、不移动 tag**；判定**以机器字段为准**（`run_number` / `run_id` / `head_sha` = #145 / `c37ec91b`，与 top-level 一致），`evidence` 文案与 `run_url` 属陈旧残留。彻底消除须**重出 freeze commit + 重跑 CI**（且会移动 tag）⇒ **另行立项，不随本行处理** |

---

## 3. 后续追加规范

1. 任何一次**线上部署**（无论谁执行）都必须在 `## 1.` 末尾**追加**一行 `D-xxx`，字段照抄上表。
2. 任何一次**只读核验**（未部署）也追加一行，`deploy/mod_time` 填「未变」。
3. 只允许追加；更正用新行 + `supersedes: D-xxx`。
4. `source_repo_sha` 若无法确证，必须显式写「推定」，不得默认属实。
5. 不得在此文件写入密钥、envId 之外的真实凭据、或任何个人资金数据。

---

### D-009 · 2026-09-30 · **V3.6.5 CONTROLLED DEPLOYMENT 已执行**（owner 授权 §3 · 单次 · runDecisionEngine only）

> **本行为真实生产部署**（owner 于 C-021.2 §3 明确授权，五元组逐位绑定）。
> `supersedes`：无 —— D-001~D-008 全部字段**逐字未动**（append-only）。

#### 1. 授权与绑定

| 字段 | 值 |
|---|---|
| `authorization` | **`CONTROLLED DEPLOYMENT AUTHORIZATION = GRANTED`**（owner §3；⛔ 不含 FIRST CONTROLLED RUN） |
| `base_head_sha` | `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| `candidate_manifest_sha` | `8c53f93fa66bbc2768f23843530f3997e2c9d38030e58b65c2bc0d7497c501c1` |
| `deployment_bundle_sha`（授权值） | `e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4` |
| `production_env` | `tradingview-etf-d0fa42yy57cbc11b` |
| `function_name` | `runDecisionEngine`（**仅此一个**；⛔ 未部署 materializeIndicators 或任何其他函数） |
| `AUTHORIZATION_SCOPE_RATIFIED_BY_OWNER` | `true` · `changed_files_count = 85` |
| `APPROVAL_MANIFEST_SHA256` | `a972cb914b6df4aee5d03da5a718c0e3ebf0ee43afbfe0caa428baed68323594` |
| `CHANGED_FILES_LIST_SHA256` | `c124f178a635b0aeaaf58251efea5987576ce90bf1212a934f1ce4c4b58cb50e` |
| `CHANGED_REGIONS_LIST_SHA256` | `59cceefaccb008a8ded07912833bfb3f1e366d0481f590c9834919a05470e899` |

#### 2. 部署输入（⛔ 非 mutable working tree）

| 字段 | 值 |
|---|---|
| `deploy_input_method` | **解包已冻结 bundle**（⛔ 非 `build-cloudfunctions.js` / 非 mutable worktree） |
| `bundle_sha_recomputed`（部署前从磁盘复算） | `e996e88ae8084a38e186471b561867267fc4280c3ea5758ccb0eff75092455a4`（**逐位 == 授权值**） |
| `STAGED_SOURCE_PARITY` | **`EXACT_MATCH`**（91 文件 · MISSING 0 · EXTRA 0 · CONTENT_DIFF 0） |
| `staging_removed_stale` | `common/MANIFEST.json`（陈旧残留，⛔ 不在 bundle 内 ⇒ 已移除，避免多带文件） |
| `preserved_ignore_policy` | `node_modules/**` · `config.json`（由快照恢复，不在 bundle 闭包内） |

#### 3. 部署执行

| 字段 | 值 |
|---|---|
| `deployment_started_at` | `2026-09-30T05:37:19Z`（= 2026-09-30 13:37:19 +08） |
| `deployment_finished_at` | `2026-09-30T05:38:13Z`（= 2026-09-30 13:38:13 +08） |
| `deploy_command` | `tcb fn deploy runDecisionEngine --dir dist-functions/runDecisionEngine --force -e <env>` |
| `deploy_mode` | `COS 上传` |
| `deploy_result` | **`✔ [runDecisionEngine] Cloud function deployed successfully!`**（exit 0） |
| `deployment_count` | **1**（单次；⛔ 未重试） |

#### 4. 部署后线上身份（§8 POST_DEPLOY_IDENTITY_GATE · 只读）

| 字段 | 部署前（V3.6.4） | **部署后（V3.6.5）** |
|---|---|---|
| `FunctionId` | `lam-eiye285p` | `lam-eiye285p`（未变） |
| `Runtime` | `Nodejs16.13` | **`Nodejs16.13`** ✅ exact match |
| `Handler` | `index.main` | **`index.main`** ✅ exact match |
| `ModTime` | `2026-09-22 16:29:48` | **`2026-09-30 13:38:07`** |
| `CodeSize` | `4013498` | **`4465434`** |
| `Status` | `Active` | `Active` |
| `Timeout` | `120` | `120` |
| `CodeSha256`（CLI 字段） | `N/A` | `N/A`（`tfn detail` 不返回；以逐文件 parity + `index.js` 双 SHA 替代） |

#### 5. 部署后源码 parity（LF-normalized · vs **授权 bundle**）

```text
线上源码文件                 = 91（部署前 76）
bundle 文件                  = 91
MISSING_REQUIRED_FILE        = 0
UNEXPECTED_FILE              = 0
CONTENT_DIFF                 = 0
ONLINE_SOURCE_PARITY         = EXACT_MATCH
UNEXPECTED_PACKAGE_DIFF      = 0

index.js raw sha  online = eb1868cb0f386bee4b89452833a1f9167a8c17723a0381c8f659aef1d55c5178
                  bundle = eb1868cb0f386bee4b89452833a1f9167a8c17723a0381c8f659aef1d55c5178  ✅
index.js LF  sha  online = 7e339fb2a9eeb87d857d8a30205df5e1d4c67c65049f6a28c871066c7281d84c
                  bundle = 7e339fb2a9eeb87d857d8a30205df5e1d4c67c65049f6a28c871066c7281d84c  ✅
```

> ⚠️ 上表 LF 行以证据件 `post-deploy-identity-gate.json` 为准（逐位一致）。
> 修正记录（2026-09-30 · 同一轮内）：本行 `bundle` 侧曾误录为 `…d4c67e65049f…`（漏一个 `c`），
> 已按证据件更正为 `…d4c67c65049f…`。**部署事实与判定不受影响**（online/bundle 双侧实为逐位一致）。

#### 6. 部署后判定（§9）

```text
DEPLOYMENT_IDENTITY_VERIFIED            = true
CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY  = V3.6.5
READY_FOR_V365_FIRST_CONTROLLED_RUN     = PENDING_OWNER_RUN_APPROVAL
OWNER_RUN_AUTHORIZATION                 = false
PRODUCTION_ACTIVATION_AUTHORIZATION     = NOT_GRANTED
```

#### 7. 回滚参考（未使用）

| 字段 | 值 |
|---|---|
| `rollback_target` | V3.6.4 production package `aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea`（已独立验证） |
| `rollback_used` | **NO**（部署后身份核验全部 PASS） |

#### 8. 本次记录**未**做的事（边界声明）

⛔ 未执行 production run · ⛔ 未初始化 `active_run_pointer` · ⛔ 未写 `run_manifest` / `run_history` ·
⛔ 未设置 `V365_ENFORCE_SWITCH_DATE` · ⛔ 未建立 `PROSPECTIVE_EPOCH` · ⛔ 未改 `param_config` ·
⛔ 未改生产 schema · ⛔ 未创建/删除生产 collection · ⛔ 未 backfill · ⛔ 未改 CALC 文件 ·
⛔ 未改 immutable lock · ⛔ 未部署任何其他 Cloud Function · ⛔ 未 commit / push / PR / merge / tag。

> 证据件：`deliverables/v365-production-history/c021/{pre-deploy-gate,staged-deploy-input,post-deploy-identity-gate,authorization-ratification}.json`
> 部署日志：`_v365-deploy/deploy-output.log` · 时点：`_v365-deploy/deploy-{started,finished}-at.txt`
## 4. 补登区（backfill · 2026-10-05 · Owner `R1` 裁定）

> **本节性质**：**治理记录修复**，⛔ **不是**新的 deployment authorization，⛔ **不**改变任何历史行的判定。
>
> **为什么需要补登**：本台账末条长期为 `D-009`（2026-09-30 · `runDecisionEngine` V3.6.5）。
> 但 **2026-10-04 实际发生了两次生产部署**（`runGen1ShadowEod` / `adminGateway`），
> 二者**当时均已有 Owner 授权、均已在当日工作日志留痕、且线上实测可复现**，唯独**未登记进本台账**
> ⇒ 台账**滞后 2 次部署**。此滞后于 2026-10-05 只读复核线上身份时暴露（`ModTime` 与台账不符）。
>
> **补登依据（三条，全部为既存证据，本轮未新增任何生产动作）**：
> 1. `.workbuddy/memory/2026-10-04.md` **§38**（`C3-R2 DEPLOY AUTHORIZED` → 19:05 部署成功）与 **§42**（`C2 DEPLOY AUTHORIZED` → 20:19 部署成功）；
> 2. 2026-10-05 22:0x `tcb fn detail --json` **只读实测**（`ModTime` / `CodeSize` / `CodeInfo` 双 sha）；
> 3. `_g1-current-online-baseline-20261005/`（本批 R2 产出的**当前线上**基线快照）。
>
> **补登纪律**：`D-001`…`D-009` **逐字节未动**（本区仅在文件末尾追加；后端校验 = 历史 36 184 B 的 sha256 `45ceb0d7…3527` 保持不变）。
> `source_repo_sha` 一律标 **推定**，不得默认属实。

### D-010 · 2026-10-04 · **C3-R2 CONTROLLED DEPLOYMENT 已执行**（owner 授权 · 单次 · `runGen1ShadowEod` only）

> **本行为真实生产部署**（owner 于 2026-10-04 下发 `C3-R2 DEPLOY AUTHORIZED`）。**补登**：见 §4 抬头。
> `supersedes`：无。

#### 1. 授权与绑定

| 字段 | 值 |
|---|---|
| `authorization` | **`C3-R2 DEPLOY AUTHORIZED`**（owner，2026-10-04）· 授权范围 = **仅** `runGen1ShadowEod` production deployment + 部署后只读回读 |
| `authorization_evidence` | `.workbuddy/memory/2026-10-04.md` **§38**（19:05 条目） |
| `production_env` | `tradingview-etf-d0fa42yy57cbc11b` |
| `function_name` | `runGen1ShadowEod`（**仅此一个**；⛔ 未部署 `adminGateway`、⛔ 未 EOD、⛔ 未进 C-2 / recovery） |
| `deploy_input_method` | 解包 **`_g1-c2-impl-20261004/dist-functions/runGen1ShadowEod`**（⛔ 非 mutable working tree） |

#### 2. 部署执行

| 字段 | 值 |
|---|---|
| `deploy_command` | `tcb fn deploy runGen1ShadowEod --dir <…\_g1-c2-impl-20261004\dist-functions\runGen1ShadowEod> --config-file <…\cloudbaserc.json> --force -y -e tradingview-etf-d0fa42yy57cbc11b --install-dependency false` |
| `tcb_version` | `3.8.5`（`c3b67f4e…d76af5`）· cwd = 仓库根 |
| `deploy_mode` | `COS 上传` |
| `deploy_result` | **`[runGen1ShadowEod] Cloud function deployed successfully!`**（exit 0） |
| `deployment_count` | **1**（单次；⛔ 未重试） |
| `deployment_started/finished` | 2026-10-04 19:05（+08） |

#### 3. 部署前 → 部署后（线上元数据）

| 字段 | 部署前（2026-09-10 vintage） | **部署后（2026-10-04）** | 取法 |
|---|---|---|---|
| `FunctionId` | `lam-9mab98b1` | `lam-9mab98b1`（未变） | 2026-10-05 只读实测 |
| `Runtime` | `Nodejs16.13` | `Nodejs16.13`（未变） | 同上 |
| `Handler` | `index.main` | `index.main`（未变） | 同上 |
| `Timeout` / `MemorySize` | `300` / `512` | `300` / `512`（未变） | 同上 |
| `ModTime` | `2026-09-10 16:07:20` | **`2026-10-04 19:05:36`** | §38 + 2026-10-05 实测（一致） |
| `CodeSize` | `3737350` | **`4079238`**（+341 888） | 同上 |
| `Status` | `Active` | `Active` | 2026-10-05 实测 |

#### 4. 代码身份（`index.js`）

| 口径 | 值 |
|---|---|
| `index.js` RAW sha256 | `d74fe27392c9dd80a4a5f693d0306945b15f065e644556088c292dfc2c8871d0`（14756 B） |
| `index.js` **LF** sha256 | `485244e4f79931b5f07c5216d83e6ce36f5ebb9112194d63a0f910e90eec33d7` |
| 包内 CODE RAW（部署后回读） | `95275e02…85905`（部署前 `711ccd4f…ddf7`） |
| 包内 CODE LF（部署后回读） | `b903d157…75080` |
| `node_modules` 聚合 / `config.json` | `5efb85ae…a7eb` / `90deec0a…aae31` |
| 部署后回读判定 | **与冻结 artifact 逐位一致**（`1625` 文件 / `1547` nm / `77` code，五项全 MATCH） |
| `CodeSha256`（包级） | **`NOT EXPOSED BY CLI 3.8.5`**（`fn detail` 不返回；⇒ 以「CODE RAW + `index.js` 双 sha + `CodeSize`」为等价身份链） |

#### 5. 配置 / 触发器 / 副作用

| 字段 | 值 |
|---|---|
| `Trigger` | **未变**：1× timer `gen1-eod-weekdays-2220`（cron `0 20 22 * * 1-5 *`，`ModTime` 仍 `2026-09-17 13:38:04`） |
| `Config` | **仅 1 项**：`InstallDependency` `TRUE → FALSE`（授权既定） |
| `Environment` | 未变（`Variables = null`） |
| `Runtime` | 未变（`Nodejs16.13` 前后一致） |
| 其他 9 函数 | `ModTime` **全不变**（`adminGateway` 仍 `2026-09-08 11:32:23`） |

#### 6. 本行为生产带来的语义变化（C3-R2）

- 变更面 = `common/utils/gen1-data-health.js`（**唯一** require 消费者 = `runGen1ShadowEod`）。
- 效果（2026-10-04 19:23 只读确证，见 §39）：`515880` 于同一交易日 `2026-09-30` **原地 upsert**，
  `DATA_DEGRADED` / `STATISTICAL_MISSING` / `missing_features=["sideway_range"]` → **`DATA_OK` / `reason_code=null` / `missing_features=[]`**；
  全 5 只标的均 `DATA_OK`。
- 写入面 = 仅 `ml_shadow_signal`（原地 upsert，无新增行）+ `gen1_health_state`（1 条 update，`_id` 不变）；
  **未写** `decision_result` / `portfolio_snapshot` / `runtime_status` / `param_config` / `trade_log` / `etf_daily`。
- `current_health` / `runtime_data_health` `DEGRADED → OK`；但 **`latched_health` 保持 `DEGRADED`**（`wasDown ∧ nowUp ∧ manualReviewConfirmed≠true ⇒ recovery_rejected`，fail-closed 设计）
  ⇒ **`canary_allowed = false`**，提升须走 `/api/admin/gen1/health/review`（**本轮未授权、未调用**）。

#### 7. 回滚参考（未使用）

| 字段 | 值 |
|---|---|
| `rollback_target` | 部署前线上包（`2026-09-10` vintage，`CodeSize 3737350`，CODE RAW `711ccd4f…ddf7`）· 载荷源见 `%TEMP%/c3r2r7/pre_code/` |
| `rollback_used` | **NO**（部署后逐位回读全部 MATCH） |

> 证据件：`%TEMP%/c3r2r7/C3R2_DEPLOY_EXECUTION_20261004.md`（10097 B，断言 PASS）· `%TEMP%/c3r2r7/{pre_detail,post_detail}.json` · `{pre_code,post_code}/`
> ⚠️ 上述为 **Temp** 路径，**不持久** ⇒ 持久化属独立工作项（见 R3）。

---

### D-011 · 2026-10-04 · **C-2 CONTROLLED DEPLOYMENT 已执行**（owner 授权 · 单次 · `adminGateway` only）

> **本行为真实生产部署**（owner 于 2026-10-04 下发 `C2 DEPLOY AUTHORIZED`，基于已 PASS 的 `C2_FINAL_DEPLOY_PRE_CHECK`）。
> 授权范围 = **仅** `adminGateway` production deployment + 部署后只读验收；⛔ 不含 Recovery / Decision Chain。**补登**：见 §4 抬头。
> `supersedes`：无。

#### 1. 授权与绑定

| 字段 | 值 |
|---|---|
| `authorization` | **`C2 DEPLOY AUTHORIZED`**（owner，2026-10-04；⛔ 不得解释为 Recovery 或 Decision Chain 的授权） |
| `authorization_evidence` | `.workbuddy/memory/2026-10-04.md` **§42**（20:1x 条目）；前置预检 §41（12 项全 PASS） |
| `production_env` | `tradingview-etf-d0fa42yy57cbc11b` |
| `function_name` | `adminGateway`（**仅此一个**；⛔ 未 `--all`、⛔ 未 `--runtime`） |
| `deploy_input_method` | 解包 **`_g1-c2-impl-20261004/dist-functions/adminGateway`**（⛔ 非 mutable working tree） |
| `payload_restore_source` | 生产 zip `89e4c6d9…9fd5`（= 部署前 `CodeSha256`；`CodeSize 4263152`）⇒ 恢复 `node_modules/**`(1703 文件) + `config.json` |

#### 2. 部署执行

| 字段 | 值 |
|---|---|
| `deploy_command` | `tcb fn deploy adminGateway --dir <…\_g1-c2-impl-20261004\dist-functions\adminGateway> --config-file <…\cloudbaserc.json> --force -y -e tradingview-etf-d0fa42yy57cbc11b --install-dependency false` |
| `tcb_version` / cwd | `3.8.5` / 仓库根 |
| `deploy_mode` | `COS 上传` |
| `deploy_result` | **`✔ [adminGateway] Cloud function deployed successfully!`**（exit 0） |
| `deployment_count` | **1**（单次；⛔ 未执行第二次） |
| `deployment_started/finished` | `2026-10-04T12:19:23Z → 12:19:43Z`（= 20:19:23 → 20:19:43 +08；耗时 20 s） |

#### 3. 部署前 → 部署后（线上元数据）

| 字段 | 部署前（2026-09-08 vintage） | **部署后（2026-10-04）** |
|---|---|---|
| `FunctionId` | `lam-09ya1rgt` | `lam-09ya1rgt`（未变） |
| `Runtime` / `Handler` | `Nodejs16.13` / `index.main` | 同（未变） |
| `Timeout` / `MemorySize` | `60` / `256` | 同（未变） |
| `ModTime` | `2026-09-08 11:32:23` | **`2026-10-04 20:19:37`** |
| `CodeSize` | `4263152` | **`4366244`** |
| `CodeSha256`（包级） | `89e4c6d9…9fd5` | **`3d1e234a1c579da55162d0b495a3c127f3c4b8b42cab346090685d0d0aa59873`** |
| `Status` | `Active` | `Active` |

> ★ `CodeSha256` 的唯一可得通道 = `queryFunctions(action=getFunctionDownloadUrl).codeSha256`；
> `tcb fn detail` 与 MCP `getFunctionDetail` **均不返回**该字段。

#### 4. 代码身份与全域对拍

| 口径 | 值 |
|---|---|
| `index.js` RAW sha256 | `fb729d9d6f6a439547704128aeaa67d9f8208ee883b44eee8c4c813401d17dd4`（55845 B · 1205 CRLF · 0 lone-LF） |
| `index.js` **LF** sha256 | `3a7696e9ec1534be819107bcbc8d2eceedb0de150c8ecdf77107b86dff643f1c` |
| 部署后下载 `$LATEST` 包 | `size 4366244 == CodeSize` · `sha256 3d1e234a…9873 == CodeSha256` ⇒ 下载完整 |
| 全部 **1777 文件**复算 | `ALL_RAW 5690d11a…1829` · `ALL_LF 23fe024c…594b` · `CODE_RAW` · `CODE_LF` · `NM_AGG` · `INDEX_JS.raw` · `INDEX_JS.lf` · `CONFIG_JSON.raw` ⇒ **ARTIFACT == DEPLOYED（全域）**；`index.js` 另作 `cmp` = IDENTICAL |
| `CODE RAW` / `CODE LF`（artifact） | `9354fdab…bf040` / `83039485…ba2df` |
| `node_modules` 条目 / 聚合 | `1703` / `e6928b94…d5a39d`（`ARTIFACT_NM_AGG == PRODZIP_NM_AGG` ⇒ `NM_PARITY = PASS`） |
| `config.json` | `f6189fd9…3b20`（282 B · `timeout 60` · `envVariables={DECISION_ENV:"prod"}` · `triggers` 1× `http` `/adminGateway`） |

> ★ 口径提醒：`CodeInfo` **只能覆盖 `index.js`**，**覆盖不到 `node_modules`**；
> 要证明「整包」一致，唯一办法 = **下载 `$LATEST` 包 + 跑同一个 fingerprint 函数**（本行即如此做的）。

#### 5. 语义变化（C-2）

- **新增生产路由**：`POST /api/admin/gen1/health/review`（受控人工恢复）⇒ 线上 `index.js` 命中 **4** 处
  （`POST_ONLY` Set / 405 闸门 / 分派 `reviewGen1Health(body)` / impl）；部署前 **ABSENT**；**仅 POST**。
  ⛔ **未调用**（本轮未做 Recovery）。
- `GET /api/admin/gen1/health` 未变（两侧同存）。
- 环境变量 `DECISION_ENV=prod` **仍存在**（`config.json` 为**惰性载荷**：`cloudbaserc.json` 无 `envVariables` ⇒ CLI 不下发 `Environment`）。
- `Triggers` `[] ↔ []` **未变**（触发器只来自 `cloudbaserc.json`，该文件无 `triggers` 键）。
  ⚠️ **既存偏差（非本轮引入）**：`config.json` 声明 1× http trigger `/adminGateway` 而线上 `Triggers` 恒空。**保留原样**，属独立项。
- `Auto install dependencies` 部署前后一致 = `FALSE`。

#### 6. 其他 9 函数 = UNCHANGED

同时刻取 10 函数列表逐行 `diff`：**恰 1 行变化**（`adminGateway` 的 `ModTime`）。
`runDecisionEngine`(09-30 13:38:07) · `runGen1ShadowEod`(10-04 19:05:36) · `runGen2ShadowEod`(09-08 11:30:54) ·
`extractFundamental`(09-09 10:22:40) · `fetchFundamentalNews`(09-08 11:34:24) · `apiGateway`(09-08 11:32:53) ·
`materializeIndicators`(09-08 11:35:24) · `fetchRealtimeData`(09-08 11:34:52) · `fetchDailyData`(09-10 14:27:12) **全部未变**。
（线上共 **10** 个函数；**无** `runIntegratedShadowEod`。）

#### 7. 回滚参考（未使用）

| 字段 | 值 |
|---|---|
| `rollback_target` | 部署前线上包 `sha256 = 89e4c6d9…9fd5`（`CodeSize 4263152`）· 载荷源 `_v365-audit-20260930/online/adminGateway.zip`（`_cb-connect-20260921/readpath-20261002/adminGateway.zip` 第二份完全相同） |
| `rollback_used` | **NO**（部署后身份 / route / runtime / config / triggers 全部 PASS） |

#### 8. 本次记录**未**做的事（边界声明）

⛔ 未调用 `/api/admin/gen1/health/review` · ⛔ 未 Recovery · ⛔ 未 manual review · ⛔ 未 EOD ·
⛔ 未 decision-chain Canary / Effective · ⛔ 未改 latch / Authority / selector / `FROZEN_PARAM_KEYS` / V364 lock ·
⛔ 未 merge / tag / rebase / cherry-pick · 除单次 `adminGateway` 部署外**无任何额外 production write**。

> 证据件：`%TEMP%/c2deployrun/C2_PRODUCTION_DEPLOYMENT_20261004.md`（9569 B / 208 行，断言 PASS）·
> `%TEMP%/c2deployrun/{pre,post}_fn_list.txt` · `{pre,post}_detail_adminGateway.{txt,json}` · `deployed_adminGateway.zip` · `deployed/` · `sanity_fp.json` · `deployed_fp.json`
> 前置预检：`%TEMP%/c2restore/C2_FINAL_DEPLOY_PRE_CHECK_20261004.md`（14925 B / 261 行，12 项全 PASS）
> ⚠️ 上述均为 **Temp** 路径 ⇒ 持久化属独立工作项（见 R3）。

---

### D-012 · 2026-10-06 · **D-D CONTROLLED DEPLOYMENT 已执行**（owner 授权 · 单次 · `runDecisionEngine` + `adminGateway`）

> **本行为真实生产部署**（owner 于 2026-10-06 下发 `D-D = AUTHORIZED`）。
> 授权范围 = **`DEPLOY_SET = {runDecisionEngine, adminGateway}`**；`runGen1ShadowEod` = **NO DEPLOY**（线上已 `ALREADY_DEPLOYED_MATCHES_RC`）。
> `supersedes`：无。**性质**：**补登**（部署事实发生于 2026-10-06，本行为事后追加登记；本补登**不产生**任何新授权）。

#### 1. 授权与绑定

| 字段 | 值 |
|---|---|
| `authorization` | **`D-D = AUTHORIZED`**（owner，2026-10-06；⛔ 不得解释为任何后续 Gate 的授权） |
| `authorization_evidence` | `_g1-dd-deploy-20261006/DD_EXECUTION_RECORD.md`（执行证据件，落于载体树 / RC 树外） |
| `production_env` | `tradingview-etf-d0fa42yy57cbc11b` |
| `function_name` | `runDecisionEngine` + `adminGateway`（**仅此两个**；⛔ 未 `--all`、⛔ 未 `--runtime`；`runGen1ShadowEod` 明确排除） |
| `deploy_input_method` | RC 树外干净工作区 `_g1-dd-deploy-20261006/ws`（`inputs_verified = 131/131` tracked 文件 LF 归一后 ≡ RC HEAD blob；`node scripts/build-cloudfunctions.js` sanctioned） |
| `payload_restore_source` | `node_modules/**`(各 1703 文件) + `config.json` 从**当前线上包**恢复（rde: `_v365-audit-20260930/online/runDecisionEngine.zip`；ag: `_g1-rollback-artifacts-20261005/.../adminGateway.C2_0390a32.3d1e234a.zip`） |

#### 2. 部署执行

| 字段 | 值 |
|---|---|
| `deploy_command` | `tcb fn deploy <fn> --dir <…_g1-dd-deploy-20261006/ws/dist-functions/<fn>> --config-file <…ws/cloudbaserc.json> --force -y -e tradingview-etf-d0fa42yy57cbc11b --install-dependency false` |
| `tcb_version` / cwd | `3.8.5` / 仓库根 |
| `deploy_mode` | `COS 上传` |
| `deploy_result` | **`✔ … Cloud function deployed successfully!`**（两函数各 exit 0 · count=1） |
| `deployment_count` | **2**（`runDecisionEngine` 1 次 + `adminGateway` 1 次；⛔ 无第二次） |
| `deployment_started/finished` | rde `2026-10-06T01:01:02+08 → 01:03:23+08`；ag `2026-10-06T01:05:18+08 → 01:05:39+08` |

#### 3. 部署前 → 部署后（线上元数据）

| 字段 | `runDecisionEngine` | `adminGateway` |
|---|---|---|
| `FunctionId` | `lam-eiye285p`（未变） | `lam-09ya1rgt`（未变） |
| `Runtime` / `Handler` | `Nodejs16.13` / `index.main`（未变） | 同（未变） |
| `Timeout` / `MemorySize` | `120` / `256`（未变） | `60` / `256`（未变） |
| `ModTime`（前 → 后） | `2026-09-30 13:38:07` → **`2026-10-06 01:01:17`** | `2026-10-04 20:19:37` → **`2026-10-06 01:05:34`** |
| `CodeSize`（前 → 后） | `4465434` → **`4468203`** | `4366244` → **`4451179`** |
| `Status` | `Active` / `Available` | `Active` / `Available` |

#### 4. 代码身份与全域对拍

| 口径 | `runDecisionEngine` | `adminGateway` |
|---|---|---|
| `index.js` RAW sha256 | `9cebff3b…`（103258 B · 1781 CRLF · 0 lone-LF） | `692893fa…`（66218 B · 1372 CRLF · 0 lone-LF） |
| `index.js` **LF** sha256 | **`32168b2c1213157cfa756295725c6226c6f7fd11df5a3b87ec898c2e7043e95f`** | **`121e6f0de67913de168b1fbb3a12a9eba41629da1068322d9ac48b949c53999a`** |
| 部署包指纹 `ALL_RAW` | `fd68ca0f0aed7dc4…` | `b095394a85da390a…` |
| 包文件数（code / nm） | `1796`（93 / 1703） | `1793`（90 / 1703） |
| `source_parity`（部署制品 vs 线上 `$LATEST`） | **`EXACT_MATCH 1796/1796`**（ONLY_ARTIFACT 0 / ONLY_ONLINE 0 / REAL_DIFF 0） | **`EXACT_MATCH 1793/1793`**（同上全 0） |
| `source_repo_sha`（推定 = RC HEAD @ D-D） | `dd610cb5dd0a782459d3789b94de3e1a3170c539` | 同 |

#### 5. 语义变化（D-D 代码变化面）

- `runDecisionEngine`：`index.js` + `common/utils/gen1-guarded-seal.js`(`d51b406b`) + `common/utils/gen1-data-health.js`(`3f2ff5e4`) + **新增** `GEN1_MODEL_SHA.json`。
- `adminGateway`：`index.js` + `common/schema.js` + `common/utils/datasource.js` + `common/utils/gen1-guarded-seal.js` + `common/utils/v361-run-context.js` + **新增 16 个 common 文件**（`ONLY_RC = 16`）。
- `runGen1ShadowEod`：**零变化**。

#### 6. 其他 8 函数 = UNCHANGED

同时刻 10 函数列表逐行 `diff`：**恰 2 行变化** = `DEPLOY_SET`。
`runGen1ShadowEod`(10-04 19:05:36 · 线上 LF `485244e4…`) 仍 `ALREADY_DEPLOYED_MATCHES_RC` 未变。

#### 7. 回滚参考（未使用）

| 字段 | 值 |
|---|---|
| `rollback_target` | rde 部署前线上包 LF `7e339fb2…d84c`（V3.6.5 · 载荷 `runDecisionEngine.V365.e996e88ae808.tar`）；ag 部署前线上包 LF `3a7696e9…3f1c`（C-2 · 载荷 `adminGateway.C2_0390a32.3d1e234a.zip`） |
| `rollback_used` | **NO**（部署后身份 / 整包对拍 / runtime / config / triggers 全部 PASS） |

#### 8. 本次记录**未**做的事（边界声明）

⛔ 未开 production write / auto execution / broker wiring / guarded-effective ·
⛔ 未改 Authority · ⛔ 未改 `FROZEN_PARAM_KEYS` · ⛔ 未改 production configuration ·
⛔ 未执行任何 trading / broker 动作 · ⛔ 未修复/绕过 health gate（`gen1_health_status = DEGRADED` 保持原样） ·
⛔ 未 commit / push / tag / merge · 除 `DEPLOY_SET` 两函数部署外**无任何额外 production write**。

> **γ 口径（Owner 2026-10-07 裁定 = γ）**：`authority state` 与 `Gen-1 effective state`
> **不是本台账的一等字段** ⇒ 本行**不新增** `authority_state` / `gen1_effective_state` 字段；
> 二者继续作为 **deployment boundary / production reconciliation 的独立证据**
> （D-D 已载：`gen1_authority = CANARY` · 全 effective 旗标 `false` · `updated_at = 2026-10-01T00:00:22.690Z`
> 部署前后一致 ⇒ 无 Authority 写入）。`configuration state` 同样不扩展 schema，按既有字段（`config.json` / `Triggers` / `Environment`）填写。

> 证据件：`_g1-dd-deploy-20261006/DD_EXECUTION_RECORD.md` · `deploy_package_fingerprint.json` ·
> `postdeploy_parity_{runDecisionEngine,adminGateway}.json` · `logs/dd1_deploy_runDecisionEngine.log` · `logs/dd2_deploy_adminGateway.log`

---

### D-013 · 2026-10-08 · **DG-8 CONTROLLED DEPLOYMENT 已执行**（owner 授权 · 单次 · `runDecisionEngine` + `adminGateway`）

> **本行为真实生产部署**（owner 于 2026-10-08 下发 `DG-8 DEPLOYMENT = AUTHORIZED`）。
> 授权范围 = **`DEPLOYMENT_SCOPE = {runDecisionEngine, adminGateway}`**；`runGen1ShadowEod` = **NO DEPLOY**（线上仍 `485244e4…`）。
> `supersedes`：无。**性质**：**当期登记**（部署事实发生于 2026-10-08，同日登记）。

#### 1. 授权与绑定

| 字段 | 值 |
|---|---|
| `authorization` | **`DG-8 DEPLOYMENT = AUTHORIZED`**（owner，2026-10-08；⛔ 不得解释为任何后续 Gate 的授权） |
| `authorization_evidence` | `_g1-da-v367-dg8-final-deployment-preflight-readonly-20261008/DG8_FINAL_DEPLOYMENT_PREFLIGHT_REPORT.md`（预检 PASS）· `_g1-da-v367-dg8-deployment-20261008/DG8_DEPLOYMENT_REPORT.md`（执行 + C1–C7） |
| `production_env` | `tradingview-etf-d0fa42yy57cbc11b` |
| `function_name` | `runDecisionEngine` + `adminGateway`（**仅此两个**；⛔ 未 `--all`、⛔ 未 `--runtime`） |
| `deploy_input_method` | 载体树外 clean export `git archive 5aa1ad10`（927 文件）→ `node scripts/build-cloudfunctions.js`（sanctioned，11 包 parity PASS） |
| `payload_restore_source` | `node_modules/**`（各 1703 文件）+ `config.json` 从**当前线上包**恢复（`tcb fn code download` 只读 `$LATEST`） |

#### 2. 部署执行

| 字段 | 值 |
|---|---|
| `deploy_command` | `tcb fn deploy <fn> --dir <…_g1-da-v367-dg8-clean-build-20261008/source/dist-functions/<fn>> --config-file <…cloudbaserc.json> --force -y -e tradingview-etf-d0fa42yy57cbc11b --install-dependency false` |
| `tcb_version` / cwd | `3.8.5` / 仓库根（凭证按 cwd 分档；与 D-010 / D-011 / D-D 同口径） |
| `deploy_mode` | `COS 上传` |
| `deploy_result` | **`✔ … Cloud function deployed successfully!`**（两函数各 exit 0） |
| `deployment_count` | **2**（`runDecisionEngine` 1 次 + `adminGateway` 1 次；⛔ 无第二次） |
| `deployment_started/finished` | rde `2026-10-08T11:39:25+08 → 11:39:50+08`；ag `2026-10-08T11:40:29+08 → 11:40:52+08` |

#### 3. 部署前 → 部署后（线上元数据）

| 字段 | `runDecisionEngine` | `adminGateway` |
|---|---|---|
| `ModTime`（前 → 后） | `2026-10-06 01:01:17` → **`2026-10-08 11:39:46`** | `2026-10-06 01:05:34` → **`2026-10-08 11:40:48`** |
| `CodeSize`（前 → 后） | `4468203` → **`4470485`** | `4451179` → **`4453461`** |
| `Status` | `Active` | `Active` |

#### 4. 代码身份与全域对拍

| 口径 | `runDecisionEngine` | `adminGateway` |
|---|---|---|
| `index.js` RAW sha256 | `9cebff3b…`（103258 B）**未变** | `692893fa…`（66218 B）**未变** |
| `index.js` **LF** sha256 | `32168b2c1213157cfa756295725c6226c6f7fd11df5a3b87ec898c2e7043e95f` **未变** | `121e6f0de67913de168b1fbb3a12a9eba41629da1068322d9ac48b949c53999a` **未变** |
| 包文件数（code / nm） | `1796`（93 / 1703） | `1793`（90 / 1703） |
| `source_parity`（`fn code download` 全量 vs 构建包） | **`EXACT_MATCH 1796/1796`** | **`EXACT_MATCH 1793/1793`** |
| 部署包 `sha256`（zip） | `dc63c095…99fffd` | `b94f586a…11c509` |
| `source_repo_sha` | `5aa1ad100443f45ec2b690ff6bba73b85a19e04b`（**已确证**：`git ls-remote origin refs/heads/gen1-da-rc-impl-20261006` = 该 sha） | 同 |

> ★ **本轮为「common-only」变更**：两函数 `index.js` 与部署前**逐字节未变**（改动全在 `common/`）⇒ `CodeInfo` / `index sha` **不变属预期**；
> 部署事实由 `ModTime` / `CodeSize` 变化 **及** `fn code download` 全量对拍（§4 `EXACT_MATCH`）双重证明（⛔ 不可只比 index sha）。

#### 5. 语义变化（DG-8 代码变化面）

- 两包与**部署前线上包**逐文件对拍：**唯一差异 = 3 个 shared common 文件** = `common/utils/cn-trading-calendar.js` · `common/utils/datasource.js` · `common/utils/v365-contracts.js`（`ENGINE_VERSION` `v3.6.5` → **`v3.6.7`**）。
- ⚠️ 该 3 件属 **O-2 CALC / DA-Health 修复轴**的 change surface，**本轮不作为部署目标**；其中 `cn-trading-calendar.js` 经 rde 运行时 require 链（`index.js:116 → common/utils/v365-run-integrity.js:28 → cn-trading-calendar.js`）作为 **dependency** 进入目标包。
- `materializeIndicators` / `fetchRealtimeData` = **change surface 内，但 NOT DEPLOYED**。

#### 6. 其他 8 函数 = UNCHANGED

同时刻 10 函数列表逐行 `diff`：**恰 2 行变化** = `DEPLOYMENT_SCOPE`。
`runGen1ShadowEod`（`2026-10-04 19:05:36` · 线上 LF `485244e4…33d7`）未变。

#### 7. 回滚参考（未使用）

| 字段 | 值 |
|---|---|
| `rollback_target` | rde `25b8327b05be9523180b323755e40e71e2e97bbe355b99a1360491fc6c8fe690`（tar · ustar · 92 files）；ag `00ca008c828b5adaf0c5f96af9cba0469cafd8433997b89d09ca5228971c7f4a`（zip · 2128 entries） |
| `rollback_binding` | rde `8a08de7c…2c23` / ag `b347a237…1c4d`（`_g1-rollback-remediation-20261007/`） |
| `rollback_binding_target_state` | **PRE_DEPLOY 线上身份**（rde LF `32168b2c…43e95f` / ag LF `121e6f0d…c53999a`）—— ⚠️ **不含**本轮 DG-8 变更；绑定**不随部署前移** |
| `rollback_used` | **NO** |

#### 8. 本次记录**未**做的事（边界声明）

⛔ 未开 production write / auto execution / broker wiring / guarded-effective ·
⛔ 未改 Authority · ⛔ 未改 `active_run_pointer` · ⛔ 未改 `FROZEN_PARAM_KEYS` · ⛔ 未改 production configuration ·
⛔ 未执行任何 trading / broker 动作 · ⛔ 未 commit / push / tag / merge / refreeze ·
除 `DEPLOYMENT_SCOPE` 两函数部署外**无任何额外 production write**。

> **γ 口径（Owner 2026-10-07 裁定 = γ）**：`authority state` / `Gen-1 effective state` **不是本台账一等字段** ⇒ 本行**不新增**对应字段；
> 二者作为 **deployment boundary 证据**记录如下（部署前后**逐字一致** ⇒ 无 Authority 写入）：
> `gen1_authority = CANARY` · 全 effective 旗标 `false` · `independent_events = 0` · `updated_at = 2026-10-01T00:00:22.690Z`；
> `active_run_pointer`：`engine:2026-09-30:b1790776862980` / `revision 1` / `updated_at = 2026-09-30T14:01:11.797Z`（**未变**）。

> 证据件：`_g1-da-v367-dg8-deployment-20261008/{DG8_DEPLOYMENT_REPORT.md, evidence/DG8_DEPLOYMENT_EVIDENCE.json, evidence/postdeploy_verify.json}` ·
> 日志：`logs/dg8a1_deploy_runDecisionEngine.log` · `logs/dg8a2_deploy_adminGateway.log`

---

## 5. 补登后状态（as-of 2026-10-05）

| 项 | 值 |
|---|---|
| 台账末条 | **D-011** |
| 已登记部署总数 | **11**（D-001…D-011）；其中**真实生产部署** = D-001 / D-002 / D-004 / D-009 / **D-010** / **D-011** |
| **当前线上**三函数身份 | 以 `_g1-current-online-baseline-20261005/`（R2 产出）为**唯一**参照 |
| 本补登的性质 | **治理记录修复**；`DEPLOYMENT_AUTHORIZED = NO`（本次补登**不产生**任何新授权） |
