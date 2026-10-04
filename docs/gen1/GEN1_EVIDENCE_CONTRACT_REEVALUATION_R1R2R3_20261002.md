# GEN1 EVIDENCE CONTRACT —— R1 / R2 / R3 复评报告（RE-EVALUATION REPORT）

> ⚠️ 本文件是**复评报告（RE-EVALUATION REPORT）**，⛔ **不是**契约本体，⛔ **不改变**冻结契约。
> 冻结契约本体 = `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md`（**FROZEN**，carrier commit `05da0ef`，PR #66）—— 本轮**零改动**（§1 实时复核）。
> 本文件内一切「新契约 / 修订建议」表述一律为 **DRAFT / PROPOSAL**，⛔ 未冻结、⛔ 不生效、⛔ 不得据此采样。

| 项 | 值 |
|---|---|
| 报告日期 | 2026-10-02 |
| 取证时刻（UTC） | `2026-10-02T07:36:26Z` |
| 取证时刻（+08） | `2026-10-02 15:36:26 +0800` |
| env | `tradingview-etf-d0fa42yy57cbc11b` |
| 证据 digest（仓库外归档） | `_g4-tools/out/R1R2R3_EVIDENCE_DIGEST.json` · sha256 `fd5f5b98…6fdf20` · 13822 B |
| 覆盖范围 | **R1** Event Independence / **R2** §5.6·§5.8 / **R3** `input_hash` |
| ⛔ 本轮未做 | merge / master integration / deploy / rollback / 生产 DB 写入 / canary / auto_execution / GE-04 / V3.6.6 Freeze / tag creation / 生产代码修改 |

**方法学约束（全程遵守）**：
1. 所有结论必须由**当前仓库、生产代码路径、真实运行记录、可复现测试**证明；⛔ 不以文字声明代替可执行判据。
2. 取证一律**实时只读**（CloudBase `fx detail` / `logs search` / `db nosql execute`），带数据源时间戳；⛔ 不用旧快照冒充 today。
3. ⛔ **不得**为满足 Evidence 数量 / Freeze 条件 / GE-04 前置条件而调整判据；本报告若发现契约与生产现实不一致，**只出提案，不改生产、不改冻结契约**。

---

## 1. Frozen Contract Baseline

### 1.1 冻结对象指纹（**as-of `2026-10-02T07:36:26Z` 实时复核**）

| 维度 | 值 | 复现命令 |
|---|---|---|
| 载体路径 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md` | — |
| carrier commit | `05da0efa73e948921bc7b9b60c0d500cc98e3e9b`（`docs(gen1): 冻结 Evidence Contract v5.0（FROZEN 2026-10-02）`，`Fri Oct 2 13:30:52 2026 +0800`） | `git show -s --format=%H 05da0ef` |
| 封存记录 commit（= 分支 HEAD） | `7d2f39bddd681cce9d714558d518b06631451d01` | `git rev-parse HEAD` |
| 载体分支 | `docs/gen1-evidence-contract-v5-20261002` | `git rev-parse --abbrev-ref HEAD` |
| 分支 HEAD（本地） | `7d2f39bd…` | `git rev-parse HEAD` |
| 分支 HEAD（origin） | `7d2f39bd…`（**本地 == origin**） | `git ls-remote origin refs/heads/docs/gen1-evidence-contract-v5-20261002` |
| **git blob id（sha1）** | `7f86d12aaed99a877c170c25c5a481f21a661256` | `git hash-object docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md` |
| **content sha256（LF 归一）** | `4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b` | `git show HEAD:docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md \| sha256sum` |
| 字节 / 行数 / 行尾 | `64580 B` / `1072` / `LF` | `git show … \| wc -c` / `wc -l` |
| PR | **#66** | — |
| 封存记录文件 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5_FREEZE_SEAL_RECORD_20261002.md`（23068 B，随封存批次入库） | — |

⚠️ **三种指纹不可混用**：`git blob id`（sha1，Git 对象）≠ `content sha256`（LF 归一内容）≠ 分支/提交 SHA。

⚠️ **`05da0ef` 是 `7d2f39b` 的祖先**（`git merge-base --is-ancestor` = true）：`05da0ef` 冻结契约本体；`7d2f39b` 追加「封存记录 + `c1_capture` v5.0 语义迁移（§11 规则 5 同批次）」。

### 1.2 冻结不变量（本轮**未触碰**，逐条声明）

- 字段名 / 字段定义 / 纳入排除规则 / 判定阈值 / selector / checkpoint —— **未修改**（契约 §11 规则 ①）。
- 契约载体树 `_g1-contract-v5-20261002` 工作区：`GEN1_EVIDENCE_CONTRACT_V5.md` **tracked 状态 0 行修改**（`git status --short` 对该文件无输出）。
- 契约 §11「契约不可变性（元规则）」全文有效；本报告**不构成** v6.0 发布，**不**作废任何样本（v5.0 现存样本 = **0 行**）。

### 1.3 与 R2 直接相关的两条冻结条款（原文摘录）

- **§5.6 CHAIN PROOF（v5.0 重锚）**：上游入口函数须存在 `request_source == TRIGGER_TIMER` 的调用；22:00 管线入口 = `fetchDailyData`，08:00 管线入口 = `materializeIndicators`；⛔ 不要求 `runDecisionEngine` 自身为 `TRIGGER_TIMER`（其 `Triggers = 0`）；⛔ 排除 `adminGateway` 管理侧重入。
- **§5.8 `CANONICAL_CAPTURE_CHECKPOINT`（v5.0 重锚）**：工作日 `[22:30:00, 23:30:00)（北京）`。**其自述含重评触发条件**：
  > 「本时点是**迁就现存生产事实**（只有 22:00 管线能提升）的裁定。**若 `CD-04` 被修复**（`validateCandidateSet` 改用正确的日期对），则 08:00 管线亦可能产出 promoted run ⇒ **届时 checkpoint 须按 §11 元规则重新评估**（本时点不作为永久假设）。」

**⇒ §1 结论：`FROZEN CONTRACT BASELINE = VERIFIED / ZERO DRIFT`。**

---

## 2. Production Reality（云只读实读，as-of §0 表列时刻）

### 2.1 集合计数（实读）

| 集合 | 行数 |
|---|---|
| `run_manifest` | 2 |
| `run_history` | 2 |
| `active_run_pointer` | 1 |
| `run_candidate_decision` | 10 |
| `run_candidate_portfolio` | 2 |
| `runtime_status` | 1（单例） |
| `ml_shadow_signal` | 133 |

### 2.2 ★ 两次自然运行（两条 run 的身份，实读）

**`run_manifest`（2 行）**：

| `run_id` | `revision` | `expected_trade_date` (III) | `validation_passed` | `validation_reason` | `created_at` | `input_hash` |
|---|---|---|---|---|---|---|
| `engine:2026-09-30:b1790776862980` | 1 | `2026-09-30` | `true` | `ok` | `2026-09-30T14:01:11.018Z` | `engine:engine:2026-09-30:b1790776862980` |
| `engine:2026-10-01:b1790812813101` | 2 | `2026-10-01` | `false` | `mixed_date_detected` | `2026-10-01T00:00:21.701Z` | `engine:engine:2026-10-01:b1790812813101` |

**`run_history`（2 行）**：

| `run_id` | `promoted` | `read_after_write_consistent` | `cas_reason` | `promoted_at` | `engine_version` | `same_trade_date_supersede` |
|---|---|---|---|---|---|---|
| `engine:2026-09-30:b1790776862980` | **`true`** | `true` | `PROMOTED` | `2026-09-30T14:01:11.865Z` | `v3.6.5` | `false` |
| `engine:2026-10-01:b1790812813101` | `false` | `null` | `null` | `null` | `v3.6.5` | `false` |

**`active_run_pointer`（单例）**：`_id = active_run_pointer::production` / `run_id = engine:2026-09-30:b1790776862980` / `revision = 1` / `updated_at = 2026-09-30T14:01:11.797Z`。

⇒ **★ 两条 run 分属两条真实管线**：`14:01:11Z` = **北京 22:01:11**（22:00 链）；`00:00:21Z` = **北京 08:00:21**（08:00 链）。

### 2.3 ★ 17 列 Evidence payload 的实读对比（R1 的决定性证据）

契约 §3 定义 17 列（逐日一行一码），v5.0 行键 = `(run_id, code)`。下表为**两条 run 的逐列实读**：

| # | 列 | A = 22:00 run | B = 08:00 run | 相同？ |
|---|---|---|---|---|
| 1 | `date` = `run_candidate_decision.decision_date` | `2026-09-30` | `2026-09-30` | ✅ |
| 2 | `code` | `513310/515880/159582/518880/159570` | 同 | ✅ |
| 3 | `regime` = `run_candidate_portfolio.decision_market_regime` | `crisis` | `crisis` | ✅ |
| 4 | `stage` = `v361_baseline_stage` | `S0/S0/S1/S0/S0` | `S0/S0/S1/S0/S0` | ✅ |
| 5 | `domain_status`（`ml_shadow_signal@date=09-30`） | 同 date 取值 | 同 date 取值 | ✅（同一来源行） |
| 6 | `probability`（`calibrated_probability@date=09-30`） | 同 date 取值 | 同 date 取值 | ✅（同一来源行） |
| 7 | `baseline_suggested_position` = `suggested_position` | `8.3 / 0 / 7.1 / 0 / 0` | `8.3 / 0 / 7.1 / 0 / 0` | ✅ |
| 8 | `counterfactual_suggested_position` = `gen1_counterfactual_suggested_position` | `8.3 / 0 / 7.1 / 0 / 0` | `8.3 / 0 / 7.1 / 0 / 0` | ✅ |
| 9 | `delta_position`（列8 − 列7） | `0 / 0 / 0 / 0 / 0` | `0 / 0 / 0 / 0 / 0` | ✅ |
| 10–15 | `forward_5d/10d/20d` · `MFE` · `MAE` · `false_fast_path` | 由 `date` 起算的行情派生 | 同 | ✅（`date` 相同 ⇒ 必然相同） |
| 16 | `event_cluster_id` | 全表同 `date` 聚类 | 同 | ✅（`date` 相同 ⇒ 必然相同） |
| 17 | `independent_event` | 同簇内首个 `delta != 0` 行 | 同 | ✅（`date` 相同 ⇒ 必然相同） |

**列 1–9**：全 5 码**逐列相同**（实读断言 `columns_1_9_identical_all_codes = true`）。
**列 10–17**：均为 `date`（= (II) DATA DATE）的函数 ⇒ A、B 同 `date` ⇒ **必然相同**。
⇒ **★ 两条 run 的 17 列 Evidence payload 逐列相同。**

**差异只出现在「非 Evidence 列」**（实读，`code=513310` 取样；其余 4 码同向）：

| 非 Evidence 列 | A = 22:00 run | B = 08:00 run |
|---|---|---|
| `gen1_candidate_hash` | `null` | `eeadc0ed28d98615b8c23c0cca8445188a8cbcd8dbd48ade282598ea3b135e8a` |
| `ml_rule_permission` | `null` | `BLOCK` |
| `ml_rule_permission_reason_code` | `SIGNAL_OR_BASELINE_MISSING` | `EOD_STAGE_NOT_ELIGIBLE` |
| `gen1_canary_reason_code` | `SIGNAL_OR_BASELINE_MISSING` | `EOD_STAGE_NOT_ELIGIBLE` |
| `gen1_run_id` | `null` | `gen1-eod-20260930142005894-b10c55` |
| `written_at` | `2026-09-30T14:01:11.415Z` | `2026-10-01T00:00:22.083Z` |

★ **`gen1_run_id` 解码** = `2026-09-30 14:20:05.894 UTC` = **北京 2026-09-30 22:20:05.894** ⇒ 正是 `gen1-eod-weekdays-2220`（22:20）在**当晚**的 Gen-1 shadow 产出。
⇒ A（22:01 完成）**早于** 22:20 ⇒ A 拿不到当晚 Gen-1 信号（`gen1_run_id = null`）；B（次日 08:00）**吸收**了它。

### 2.4 `ml_shadow_signal`（组 B 前提，实读）

- `date = 2026-09-30`：**5 行**（`513310` / `515880` / `159582` / `518880` / `159570`）。
  - `domain_status` = `PARTIAL_COVERAGE` / `PARTIAL_COVERAGE` / `PARTIAL_COVERAGE` / `OUT_OF_DOMAIN` / `IN_DOMAIN`。
  - `calibrated_probability` = `null / 0 / null / null / null`。
  - `gen1_authority` = `ADVISORY`（lane-local）。
- `date = 2026-10-01`：**0 行**。
⇒ **组 B 前提成立**（09-30 有非空 `domain_status` / `probability` 行）。
⇒ ⚠️ **`ml_shadow_signal` 无 `gen2_*` 字段**（54 字段仅含 `gen1_*` 与通用 ML 字段）⇒ 该集合是 **Gen-1 lane 专属**。

### 2.5 `runtime_status` 单例（实读关键字段）

| 字段 | 值 |
|---|---|
| `decision_date` | `2026-10-01` |
| `updated_at` | `2026-10-01T00:00:22.690Z` |
| `gen1_authority` | `CANARY` |
| `gen1_counterfactual_canary_active` | **`false`** |
| `gen1_health_gate_status` | `ACTIVE` |
| `gen1_health_status` | `DEGRADED` |
| `gen1_production_write` | `false` |
| `gen1_auto_execution` | `false` |
| `gen1_counterfactual_ledger_ok` | `true` |
| `gen1_guarded_evidence_independent_events` | **0** |
| `v365_mode` | `ENFORCE` |
| `v365_promotion_attempted` | `false` |
| `v365_history_status` | `ok` |
| `production_engine` | `v3.6.1` |
| `ml_effective` | `false` |

`v365_run_integrity`（子对象）关键值：`expected_trade_date = 2026-09-30`(IV) / `observed_latest_date = 2026-09-30` / `date_alignment_case = CASE_A_ALL_EXPECTED` / `engine_run_id = engine:2026-10-01:b1790812813101` / `engine_version = v3.6.5` / `publish_protocol_version = v365-two-stage-v1` / `run_context_version = v361-run-context-v2` / `input_health = DEGRADED` / **`input_hash = a1e067cb9f9f4d2e6b04cf58c96393c5e2e56e3763cc1e7d48647e47dcfae8e5`（真 sha256）**。

### 2.6 ★ 调用链实证（`tcb logs search` 实读，与契约 §5.6 锚点表逐字一致）

**22:00 链（W1）**：

| 跳 | 函数 | `request_id` | `request_source` | START（+08） |
|---|---|---|---|---|
| 1 | `fetchDailyData` | `3bc435d3-380b-4328-a39a-f07096231b75` | `TRIGGER_TIMER` | `2026-09-30 22:00:06.923` |
| 2 | `materializeIndicators` | `1c88d7ae-e117-4256-8549-62a9e48b13ea` | `TCB_API`（链式） | `2026-09-30 22:00:56.923` |
| 3 | `runDecisionEngine` | `c6ca469a-cc0c-4b24-af4f-dd00b0477134` | `TCB_API`（链式） | `2026-09-30 22:01:02.976` |

**08:00 链（W2）**：

| 跳 | 函数 | `request_id` | `request_source` | START（+08） |
|---|---|---|---|---|
| 1 | `materializeIndicators` | `1314d422-ae2e-4957-8e9a-15a6d5cd29c3` | `TRIGGER_TIMER` | `2026-10-01 08:00:05.706` |
| 2 | `runDecisionEngine` | `e42f2558-687d-48dc-8c5a-cb02482a6579` | `TCB_API`（链式） | `2026-10-01 08:00:13.093` |

⇒ **★ 08:00 链在 `CD-04` 修复前即已跑通并产出候选**（`engine:2026-10-01:b1790812813101` 已落库）。

### 2.7 代码锚点逐行核实（`_g1-contract-v5-20261002` 树实读）

| 锚点 | 实读内容 | 与契约 §5.6 一致？ |
|---|---|---|
| `fetchDailyData/index.js:424` | `chained = await app.callFunction({ name: 'materializeIndicators', data: { from: 'fetchDailyData' } });` | ✅ |
| `materializeIndicators/index.js:127` | `chained = await app.callFunction({ name: 'runDecisionEngine', data: { from: 'materializeIndicators' } });` | ✅ |
| `adminGateway/index.js:547` | `await app.callFunction({ name: 'runDecisionEngine', data: { from: 'riskResolve' } });` | ✅ |
| `adminGateway/index.js:578` | `recomputed = await app.callFunction({ name: 'runDecisionEngine', data: { from: 'riskTrigger' } });` | ✅ |
| `adminGateway/index.js:661` | `recomputed = await app.callFunction({ name: 'runDecisionEngine', data: { from: 'paramChange' } });` | ✅ |

**⇒ §2 结论：`PRODUCTION REALITY = READ / as-of 2026-10-02T07:36:26Z`。** 关键事实：**两条真实管线各产出一条 run，但两条 run 的 (II) DATA DATE 相同（均 `2026-09-30`），17 列 Evidence payload 逐列相同。**

---

## 3. R1 —— Evidence Event Independence（可执行判据）

### 3.1 判据载体（**不是文字声明**）

| 构件 | 路径 | sha256 |
|---|---|---|
| 判据实现 | `scripts/gen1/evidence-capture/independence_discriminator.js` | `ce340561…3bdadd` |
| 夹具（8 cases） | `scripts/gen1/evidence-capture/fixtures/r1_independence_cases.json` | `18ddc6c2…71b792` |

判据**只引用冻结值**并注明条款号（⛔ 不复制契约参数）：
`CLUSTER_GAP_DAYS = 10`（§3.4）· `EVIDENCE_COLUMNS = 17 列`（§3）· `PROMOTION_PROOF_KEYS = 5 条`（§3.0.3）· `VERDICT ∈ { INDEPENDENT, NOT_INDEPENDENT, NOT_EVALUABLE }`。

### 3.2 判据链（顺序本身是语义的一部分，**不可交换**）

| 序 | 判据 | 条款依据 | 否决 ⇒ 判决 / 理由 |
|---|---|---|---|
| **C0** | 两 run 的 `PROMOTION_PROOF` 五条 AND 全真 | §3.0.3 | `NOT_EVALUABLE` / `PROMOTION_PROOF_FAILED` |
| **C1** | (I) `run_id` 互异 | §3.0.1 | `NOT_EVALUABLE` / `SAME_RUN` |
| **C2** | 两 run 的 `decision_date` 互异（bundle_key 唯一） | §5.5 ①③④ | `NOT_INDEPENDENT` / `SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` |
| **C4a** | 输入侧逐源 raw SHA256 **可得** | §5.3 八源 | `NOT_EVALUABLE` / `INPUT_PROVENANCE_UNAVAILABLE` |
| **C4b** | 输入侧 `source_raw_sha256` + `expected_codes` 互异（⛔ 不含 `data_date`） | §5.3 | `NOT_INDEPENDENT` / `SAME_INPUT_PROVENANCE` |
| **C5** | 跨数据日的 decision payload 是否逐字相同（**诊断，非否决**） | — | 记录性 |
| **C6** | 跨事件簇（同 code 间隔 > `CLUSTER_GAP_DAYS`） | §3.4 | `NOT_INDEPENDENT` / `SAME_EVENT_CLUSTER` |
| **C7** | 两 run **各自**至少一码 `delta_position != 0`（**必要条件**） | §3.4 / §7.3 | `NOT_INDEPENDENT` / `NO_INFORMATIVE_ROW` |

结论固定携带 `sufficiency_scope: 'NECESSARY_CONDITIONS_ONLY'`：**充分性**还要求两者分别是其所在簇内**首个** `delta != 0` 行 —— 需全表簇上下文，⛔ 不可由一对 run 判定。

### 3.3 ★ owner 五问的实读回答

| # | 问题 | 回答 | 依据 |
|---|---|---|---|
| ① | 22:00 与 08:00 是否产生**独立 candidate**？ | **NO** | 17 列 payload 逐列相同（§2.3）；且同 `decision_date` |
| ② | 是否使用**独立 input provenance**？ | **NO** | `ml_shadow_signal.date` 同为 `09-30`；`run_candidate_*` 数据相同；两 run 的 18 契约输入同源 |
| ③ | 是否只是**同一输入状态的重复执行**？ | **就 Evidence 而言 YES**（17 列同 payload）；**但 B 的 Gen-1 信号供给比 A 新**（`gen1_run_id` 22:20 vs `null`）⇒ 不是「完全同态重放」，而是「同 `decision_date` 的第二次执行，Evidence payload 恰好相同」 |
| ④ | 不同 trigger 但**相同 input state** 时，是否应算 independent？ | **不应** | C2（§5.5 bundle_key 唯一）+ C4b（provenance 同一性）+ C6（§3.4 同簇）+ C7（无 informative row）四重拦截 |
| ⑤ | 不同 input provenance 且**各自 promotion proof 成立**时，是否应算 independent？ | **应** | 夹具 `POS-1` ⇒ `INDEPENDENT` |

### 3.4 夹具与自证（可复现）

**夹具 8 cases**（`_g4-tools/gen_r1_fixtures.py` 由**云只读实读**派生，⛔ 不手编可实读数字）：

| case | 构造 | 期望判决 |
|---|---|---|
| `NEG-PROOF-1` | **LIVE**：真实 22:00 promoted vs 08:00 未 promoted | `NOT_EVALUABLE` / `PROMOTION_PROOF_FAILED` |
| `NEG-FWD-1` | **owner 指定反例**：同 `decision_date` 09-30 / 同 provenance / 不同 trigger | `NOT_INDEPENDENT` / `SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` |
| `NEG-CLUSTER-1` | 间隔恰 10 天（= `CLUSTER_GAP_DAYS`） | `NOT_INDEPENDENT` / `SAME_EVENT_CLUSTER` |
| `POS-1` | 跨簇（11 天）+ 各自 proof 成立 + 各自 delta≠0 | `INDEPENDENT` |
| `POS-1-DELTA0` | 跨簇但两侧 delta 全 0 | `NOT_INDEPENDENT` / `NO_INFORMATIVE_ROW` |
| `NEG-PROV-1` | 日期不同但 provenance 全等 | `NOT_INDEPENDENT` / `SAME_INPUT_PROVENANCE` |
| `NEG-SAMERUN-1` | 同一 run | `NOT_EVALUABLE` / `SAME_RUN` |
| `NEG-NOPROV-1` | provenance 缺载 | `NOT_EVALUABLE` / `INPUT_PROVENANCE_UNAVAILABLE` |

**自证结果（三项全绿，复现命令见 §11 附录）**：

```text
== SELFTEST ==          8 passed / 0 failed   （8 夹具逐条 expect==got）
== NON-INTERFERENCE ==  8 passed / 0 failed   （注入 trigger/candidate_content_sha/pointer_revision/
                                                input_hash/event_id/promotion_attempt/engine_version
                                                ⇒ 8 案结论逐字不变）
== RED-PROOF ==         PASS                  （6 变异 + 1 还原）
```

### 3.5 ★ 判据的可判别性证明（owner 要求「不能只靠文字声明」）

**非干预自证**（`--non-interference`）证明：`trigger` / `candidate_content_sha` / `pointer_revision` / `input_hash` / `event_id` / `promotion_attempt` / `engine_version` **均非判据** —— 注入后 8 案结论逐字不变。
⇒ owner 点名的 12 项据此分为两类：

| 类别 | 项 |
|---|---|
| **承重**（进判据） | `run_id` · `data_date`（`decision_date`） · `promotion proof`（5 条） · `input provenance`（`source_raw_sha256` + `expected_codes`） · `candidate identity`（`code` + `delta_position`） |
| **引用但非判据** | `trigger` · `candidate_content_sha` · `pointer_revision` · `run_date` · `calc_date`（= `date`，与 `data_date` 同轴） · `expected_trade_date`（仅组 A 护栏） · `event_id` |

**红证 7 条**（`--red-proof`，逐条翻转 + 还原）见 §6。

**⇒ §3 结论：`R1 = RESOLVED`。** 判据可执行、非干预稳定、可打红；实读结论：**22:00 与 08:00 两条 run 不构成独立 Evidence 事件**。

---

## 4. R2 —— §5.6 / §5.8 复评与 Trigger Registry

### 4.1 Trigger Registry（云 `fx detail` 实读 + 代码追踪）

| trigger_id | schedule (cron) | entry function | candidate producer | validation gate | promotion gate | evidence eligibility | independence class |
|---|---|---|---|---|---|---|---|
| `dailyFetch-2200` | `0 0 22 * * 1-5 *` | `fetchDailyData` | `runDecisionEngine`（经 `materializeIndicators` 链式） | `validateCandidateSet` → `putCandidate`（`runDecisionEngine/index.js:548/:560`） | `v365-publish-store.classifyPointerPromotion` → CAS | §5.6 CHAIN PROOF **已锚定**（22:00 入口） | **PROMOTION-CAPABLE**（当前**唯一曾 promoted** 的链） |
| `dailyPipeline-0800` | `0 0 8 * * 1-5 *` | `materializeIndicators` | `runDecisionEngine`（链式） | 同上 | 同上 | §5.6 **已列**（08:00 入口）；§5.8 checkpoint 使其**当前不产 promoted** | **PROMOTION-CAPABLE（结构上）**，受 `CD-04` 阻断；**V3.6.6 修复后变为实际** |
| `gen1-eod-weekdays-2220` | `0 20 22 * * 1-5 *` | `runGen1ShadowEod` | 写 `ml_shadow_signal`（组 B 右端） | N/A（非 run 轴） | N/A | 不产 Evidence Candidate；**提供组 B 输入** | **INPUT-SIDE ONLY** |
| `gen2-eod-weekdays-2230` | `0 30 22 * * 1-5 *` | `runGen2ShadowEod` | 写 `gen2_shadow`（`gen2_ranking` / `gen2_candidate_leg`） | N/A | N/A | **不产 Gen-1 Evidence Candidate**（函数头自述「与 Gen-1 / V3.6.1 完全隔离」） | **OUT OF SCOPE（Gen-2）** |
| `newsFetch-1630` | `0 30 16 * * 1-5 *` | `fetchFundamentalNews` | 写新闻 / 情报集合 | N/A | N/A | 不产 Evidence Candidate | **OUT OF SCOPE（基本面管线）** |
| `intelFetch-30min` | `0 0,30 8-22 * * * *` | `fetchFundamentalNews` | 同上 | N/A | N/A | 同上 | **OUT OF SCOPE** |
| `newsExtract-1640` | `0 40 16 * * 1-5 *` | `extractFundamental` | 写 `fundamental_series` | N/A | N/A | 同上 | **OUT OF SCOPE（§5.6 表⛔未列）** |
| `intelExtract-30min` | `0 5,35 8-22 * * * *` | `extractFundamental` | 写 `fundamental_series`（**22:35 触发，落在 §5.8 窗口内**） | N/A | N/A | 同上 | **OUT OF SCOPE（§5.6 表⛔未列）** |
| `realtime-5min` | `0 */5 9-15 * * 1-5 *` | `fetchRealtimeData` | 写 `etf_daily.realtime` + `FETCH_LOG` | N/A | N/A | 同上 | **OUT OF SCOPE（§5.6 表⛔未列）** |
| — | — | `runDecisionEngine` | — | — | — | `Triggers = 0` ⇒ 自然调用必为 `TCB_API` | **NOT TIMER-DRIVEN** |
| — | — | `runIntegratedShadowEod` | — | — | — | `fx detail` 返回空 ⇒ **云端不存在** | **ABSENT** |
| **管理侧重入**（无 cron） | — | `adminGateway:547/578/661` | `runDecisionEngine`（直接调用） | 同上 | 同上 | ⛔ §5.6 明确**排除** | **EXCLUDED** |

### 4.2 §5.6 / §5.8 覆盖性检查

**(a) §5.6 CHAIN PROOF 的 trigger 表 —— 覆盖「能产 promoted run 的链」是完备的**：22:00 链与 08:00 链**均已登记**，且两者 CHAIN PROOF **均可证明**（§2.6 实读）；⛔ 排除项（`adminGateway`）**已登记**。
⇒ 就 CHAIN PROOF **判据目的**而言，`§5.6 = COMPLETE`。

**(b) §5.6 的 `trigger 实读` 表 —— 作为「生产 trigger 清单」不完整**（遗漏以下云端**真实存在**的触发器）：

| 遗漏项 | 云端实读 | 是否影响 CHAIN PROOF 判据？ |
|---|---|---|
| `extractFundamental` / `newsExtract-1640` / `intelExtract-30min` | 存在（2 triggers） | 否（不产 candidate） |
| `fetchRealtimeData` / `realtime-5min` | 存在（1 trigger） | 否 |
| `runGen2ShadowEod` / `gen2-eod-weekdays-2230` | 存在（1 trigger） | 否（写 `gen2_shadow`，非八源） |
| `runIntegratedShadowEod` | **云端不存在** | 否 |
| ⚠️ 仓库 `cloudbaserc.example.json` 列出的 `dailyFetch-1530` | **云端不存在**（`fetchDailyData` 实读仅 1 个 trigger） | 否（仓库配置 ≠ 云端实读） |

**(c) §5.8 的「静默窗口」论证 —— 结论成立，但枚举域声明不完整**：
§5.8 断言「`[22:30, 次日 08:00)` 内**无四源写入者**」。本轮**穷举**全部真实 trigger 后：

| 落在窗口内的触发者 | 写入集合 | 属八源？ |
|---|---|---|
| `intelFetch-30min`（22:30） | 新闻 / 情报集合 | ❌ |
| `intelExtract-30min`（**22:35**） | `fundamental_series` | ❌ |
| `gen2-eod-weekdays-2230`（22:30） | `gen2_shadow` | ❌ |
⇒ **结论不变**（无八源写入者），但 §5.8 正文只提到 `intelFetch-30min`，**未列** `intelExtract-30min`（22:35，**确在窗口内**）与 `runGen2ShadowEod`（22:30）。**这是枚举域不完整，不是结论错误**。

### 4.3 ★ R2 的核心发现：§5.8 自述的重评触发条件**已成立**

- §5.8 自述：「**若 `CD-04` 被修复** … 则 08:00 管线亦可能产出 promoted run ⇒ 届时 checkpoint 须按 §11 元规则重新评估」。
- **`CD-04` 已在 V3.6.6 修复**（`_v366-cd04-20261002` @ `4d4a67e`，生产修复 commit `0342abd`：门 2 由 (III) RUN DATE 改绑 (IV) CALENDAR TRADE DATE）。
- ⇒ **触发条件成立** ⇒ §5.8 的 22:30 checkpoint 之**前提**（「只有 22:00 管线能提升」）**即将失效**。

**若 V3.6.6 被部署后的实证推演**（基于 §2.2 实读）：10-01 08:00 run 将满足 §3.0.3 五条（pointer 前进至 `revision 2`、`run_manifest.revision 2`、`validation_passed true`）⇒ `promoted = true` ⇒ 但其 `decision_date` **仍为 `2026-09-30`** ⇒ 与已采纳的 09-30 bundle **同日冲突** ⇒ §5.5 ③ `NON_SCORING` ⇒ **不产生第二个独立 Evidence 事件**。
⇒ 即：**§5.8 的 checkpoint 假设失效，但 Evidence 的独立性判据（R1）在同一场景下仍正确否决**（红证 `RP3` 已验证）。

### 4.4 §5.3 八源清单（复评基线，⛔ 未改）

`runtime_status` · `ml_shadow_signal` · `invocation log` · `run_candidate_decision` · `run_candidate_portfolio` · `run_manifest` · `active_run_pointer` · `run_history`（= 8 源）。
⇒ 本报告「OUT OF SCOPE」判定 = 该 trigger 的写入集合**不属**上述八源。

**⇒ §4 结论：`R2 = RESOLVED_WITH_CONTRACT_REVISION_REQUIRED`。**
Trigger Registry 已完整；`§5.6` 判据完备但**清单不全**；`§5.8` **重评触发条件已成立** ⇒ 须出 Contract Change Proposal（§7）。

---

## 5. R3 —— `input_hash` 真实状态调查

### 5.1 生产是否实际产生？—— **YES，三处，且同名不同义**

| # | 落点 | 值（实读） | 性质 |
|---|---|---|---|
| 1 | `run_manifest.input_hash` | `engine:engine:2026-09-30:b1790776862980` | **字符串拼接**（`'engine:' + v365EngineRunIdBase`，`:1358`；`v365EngineRunIdBase` 已含 `engine:` ⇒ **双重前缀**） |
| 2 | `run_history.input_hash` | `engine:engine:2026-09-30:b1790776862980` | 同（`:1401-1403` 从 manifest 复制） |
| 3 | `runtime_status.v365_run_integrity.input_hash` | `a1e067cb9f9f4d2e6b04cf58c96393c5e2e56e3763cc1e7d48647e47dcfae8e5` | **真 sha256**（`v361-run-context.js:393-407` 的 `hashInput(...)`，`:358` 取 envelope 值） |

⚠️ **同名不同义**：`run_manifest` / `run_history` 的 `input_hash` **不是** digest，而是 **run identity 的字符串**；`runtime_status` 的才是 digest。二者**不同源**（`v365-run-integrity.js:358` 注释实读确认）。

### 5.2 契约是否要求？—— **NO（未要求，未消费）**

`grep` 全契约：`input_hash` **未出现**于 §5.3 八源清单 / §5.4 gate / §3 的 17 列 / §3.0 身份量 / §5.5 / §5.6 / §5.8。⇒ 契约**既不要求产生、也不消费该字段**。

### 5.3 5 问逐条回答

| # | 问题 | 回答 |
|---|---|---|
| ① | 生产是否实际产生？ | **YES**（3 处，见 §5.1） |
| ② | 契约是否要求？ | **NO** |
| ③ | 若要求但生产不产生，是否构成 Contract Gap？ | **N/A**（契约不要求） |
| ④ | 它实际想证明的是 input identity、data provenance 还是 candidate identity？ | **语义歧义**：`run_manifest.input_hash` 名义为 input identity，实际是 **run identity 的拼接**；`runtime_status.v365_run_integrity.input_hash` 才是 **input provenance digest** |
| ⑤ | 是否已有其他字段能完整承担该语义？ | **YES**：run identity ⇒ `run_id` / `revision` / `pointer_revision`；input provenance ⇒ `runtime_status.v365_run_integrity.input_hash`（真 digest）+ `run_manifest.expected_codes` / `expected_trade_date` + §5.3 八源 raw SHA256；candidate identity ⇒ `gen1_candidate_hash`（`run_candidate_decision`，**非 Evidence 列**） |

### 5.4 裁定

> **`R3 = OBSERVATION`（⛔ 非 `CONTRACT GAP`）。**
> 理由：① 契约不要求也不消费；② 语义已由其他字段完整承担；③ 无任何契约判据依赖它。
> ⚠️ 附带登记一条**非阻塞观察项**：`run_manifest` / `run_history.input_hash` 是**双前缀字符串**（`engine:engine:…`），**名义语义**与 `runtime_status` 的同名 digest **冲突**；下游 `v365-active-read.js:588` 会读到该值。**建议**在未来版本**改名澄清**（如 `run_identity_key`），⛔ **本阶段不改生产代码**。
> ⛔ **禁止为满足 schema 而制造虚假 hash**；⛔ 不因该字段缺失/歧义而阻断 Freeze。

---

## 6. Counterexamples / Falsification（打红自证）

### 6.1 R1 判据红证（`--red-proof`，7 条，全部 PASS）

| # | 变异 | 期望 | 实得 |
|---|---|---|---|
| **RP1a** | 只屏蔽 C2（bundle_key 同一性） | 结论仍不独立，理由**换手**到 C6 | `NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` → `NOT_INDEPENDENT / ["SAME_EVENT_CLUSTER"]` ✅ |
| **RP1b** | 同时屏蔽 C2 + C6 | 残差**换手**到 C7（第三条独立护栏） | → `NOT_INDEPENDENT / ["NO_INFORMATIVE_ROW"]` ✅ |
| **RP1c** | 屏蔽 C2 + C6 **且**两侧 delta 非零 | 同数据日一对 run **翻为** `INDEPENDENT` | → `INDEPENDENT / ["CROSS_CLUSTER_AND_BOTH_INFORMATIVE"]` ✅ |
| **RP2** | `CLUSTER_GAP_DAYS := 0` | `NEG-CLUSTER-1` 翻为 `INDEPENDENT` | `NOT_INDEPENDENT` → `INDEPENDENT` ✅ |
| **RP3** | **解除真实 08:00 run 的 promotion 失败**（= 模拟 V3.6.6 部署后） | 立即暴露为同日冲突 | `NEG-PROOF-1` `NOT_EVALUABLE` → `NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` ✅ |
| **RP5** | 输入侧 provenance 清空 | 必 `NOT_EVALUABLE`（验 C4a） | `POS-1` `INDEPENDENT` → `NOT_EVALUABLE / ["INPUT_PROVENANCE_UNAVAILABLE"]` ✅ |
| **RP4** | 逐字节还原 | 判据复原 | `NEG-FWD-1` `NOT_INDEPENDENT` → `NOT_INDEPENDENT` ✅ |

**★ RP1a/RP1b/RP1c 的复合价值**：证明 **C2 / C6 / C7 三条护栏互相冗余承重** —— 屏蔽任意一条，结论由下一条接管；三条全屏蔽且两侧 delta≠0 才翻转。⇒ 判据**不是单点依赖**。

**★ RP3 的分量**：把「**V3.6.6 部署后**」这一**未来态**直接注入真实实读对（`NEG-PROOF-1`），得到 `NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` ⇒ **在 §5.8 假设失效的最坏场景下，R1 判据仍正确否决**（见 §4.3 推演，二者独立互证）。

### 6.2 反向断言（防「换了说法但旧措辞残留」）

- 非干预自证含**反向断言**：注入全部非判据字段后，8 案判决**逐字不变**（⛔ 不得出现「字段变化导致判决漂移」）。
- 红证含**逐字节还原断言**（RP4）：还原后判决必须与原基线**完全相同**（⛔ 防「变异未真正撤销」）。

### 6.3 本轮**未**证伪的攻击面（诚实登记）

- R1 判据的**充分性**（「簇内首个 delta≠0」）**未**可执行 —— 需**全表簇上下文**，⛔ 不可由一对 run 判定；已在结论中显式标注 `NECESSARY_CONDITIONS_ONLY`。
- §5.8 静默窗口的**穷举**基于 **as-of 时刻的 trigger 快照**；⛔ 不主张为永久完备（若新增 timer，须重跑 Registry）。

---

## 7. Contract Change Impact（Contract Change Proposals，全部为 DRAFT）

> ⛔ 以下**全部**是**提案（PROPOSAL / DRAFT）**，⛔ 未冻结、⛔ 不生效。
> 分类口径：`文档/契约修订` vs `生产实现修复`。

| CCP | 内容 | 类型 | 是否需生产代码修改 | 是否需版本升版 |
|---|---|---|---|---|
| **CCP-R2-1** | **§5.8 checkpoint 重评**：因 `CD-04` 已修复（V3.6.6），须按 §11 元规则重评 22:30 窗口；建议引入「双 checkpoint」或改为「按 promoted run 的**完成时刻**」而非固定窗口 | 契约修订 | **NO** | **YES**（`checkpoint` 属 §11 规则 ① 保护对象） |
| **CCP-R2-2** | **§5.6 `trigger 实读` 表补全**：补 `extractFundamental` / `fetchRealtimeData` / `runGen2ShadowEod`；标注仓库 `dailyFetch-1530` **云端不存在** | 契约修订（文档完整性） | **NO** | 建议随 CCP-R2-1 同批（避免二次升版） |
| **CCP-R2-3** | **§5.8 静默窗口举证方式**：由「断言无四源写入者」改为「**穷举 trigger Registry + 逐条排除 + 声明枚举域与 as-of**」 | 契约修订（举证方式） | **NO** | 随 CCP-R2-1 同批 |
| **CCP-R1-1** | **§3.4 附加非规范性附注**：登记 `independence_discriminator.js` 为**参考实现**（⛔ 不改变任何阈值/语义） | 契约附注（non-normative） | **NO** | **NO**（无语义变更） |
| **CCP-R3-1** | **`input_hash` 登记为 OBSERVATION** + 命名澄清建议（`run_manifest`/`run_history` 双前缀 ≠ digest） | 契约附注（观察项登记） | **NO**（⛔ 本阶段不改生产） | **NO** |

**★ 关键裁定：`PRODUCTION CODE CHANGE REQUIRED = NO`（R1/R2/R3 范围内）。**
⇒ 本轮**不触发** owner §七 的「若发现需要生产代码修改 ⇒ STOP-AND-REPORT」中「生产修改」分支。
⇒ 但**仍**按 owner §八 要求 **STOP-AND-REPORT**（本轮终点即报告）。

### 7.1 版本标签归属（owner 裁定项，⛔ 不自行选边）

§11 元规则 ① 规定 `checkpoint` 冻结后不得修改；② 规定「发现错误 ⇒ 发布 **v6.0** 并显式作废 v5.0 全部样本」。
本轮 CCP-R2-1 触及 checkpoint ⇒ **必须升版**。但「升为 `v5.1` 还是 `v6.0`」存在两种口径：

| 选项 | 依据 | 影响 |
|---|---|---|
| **A. `v5.1`** | 本变更 = §5.8 **自身预留**的「按 §11 重新评估」机制（非「发现错误」）⇒ 属**计划内重锚** | 沿用 v5.0 的「作废样本」前置（实测 v5.0 样本 = **0 行**，作废无损失） |
| **B. `v6.0`** | §11 ② 字面「发现错误 ⇒ v6.0」；且 checkpoint 是 §11 ① 的保护对象，任何改动即「升级」事件 | 需显式作废 v5.0 全部样本（= 0 行） |

⇒ **登记为 owner 裁定项**（⛔ 本报告不自行选边）。**两种选项在「Evidence 判据」上无差异**（R1 判据不依赖 checkpoint 具体时点）。

---

## 8. Exact Rulings（逐条裁定）

| # | 裁定对象 | 裁定 | 类型 |
|---|---|---|---|
| 8.1 | **冻结契约本体** | **VERIFIED / ZERO DRIFT**（blob `7f86d12a…`、sha256 `4fb9463f…f55b`、64580 B / 1072 行 / LF、分支本地==origin） | 事实 |
| 8.2 | **R1 判据可判别性** | **PASS** —— 判据可执行、8 夹具、非干预 8/0、红证 7 条全 PASS | PASS |
| 8.3 | **R1 对 22:00 vs 08:00 的实读判决** | **`NOT_INDEPENDENT`**（严格说：08:00 run 当前 `NOT_EVALUABLE / PROMOTION_PROOF_FAILED`；即使 V3.6.6 部署后被 promoted，仍 `NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION`） | 判定 |
| 8.4 | **owner R1 五问** | ①NO ②NO ③就 Evidence 而言 YES ④不应 ⑤应 | 判定 |
| 8.5 | **R2 Trigger Registry** | **COMPLETE**（13 行，覆盖全部真实 trigger + 排除项 + 缺失项） | PASS |
| 8.6 | **§5.6 CHAIN PROOF 判据覆盖** | **COMPLETE**（22:00 / 08:00 链均已登记且可证） | PASS |
| 8.7 | **§5.6 `trigger 实读` 表完整性** | **INCOMPLETE**（漏 3 个真实 trigger 族；仓库 `dailyFetch-1530` 云端不存在） ⇒ **CCP-R2-2** | REVISION-REQUIRED |
| 8.8 | **§5.8 静默窗口结论** | **成立**（穷举后无八源写入者） | PASS |
| 8.9 | **§5.8 枚举域声明** | **INCOMPLETE**（漏 `intelExtract-30min` 22:35、`runGen2ShadowEod` 22:30） ⇒ **CCP-R2-3** | REVISION-REQUIRED |
| 8.10 | **§5.8 重评触发条件** | **已成立**（`CD-04` 已修复） ⇒ **CCP-R2-1** | REVISION-REQUIRED |
| 8.11 | **R3 `input_hash`** | **OBSERVATION**（⛔ 非 CONTRACT GAP） + 命名澄清观察项 ⇒ **CCP-R3-1** | OBSERVATION |
| 8.12 | **生产代码修改需求** | **NO**（R1/R2/R3 范围内无需改生产代码） | 事实 |
| 8.13 | **24 小时/独立性门** | ⛔ 本轮**未**调整任何阈值 / 门槛 / 判据；⛔ 不得据本报告放宽任何条件 | 红线 |

---

## 9. Freeze Readiness

### 9.1 三态判定（owner §八 口径，⛔ 不使用模糊措辞）

| 项 | 判定 |
|---|---|
| `V3.6.6_IMPLEMENTED` | **PASS**（前序 G-4 已定；本轮未触碰） |
| `REPLAY_PARITY_PASS` | **PASS**（前序 G-4 已定） |
| **`CONTRACT_REEVALUATION`** | **`PASS_WITH_CONTRACT_REVISION_REQUIRED`** |
| **`FREEZE`** | **`NOT READY`** |

### 9.2 为什么是 `PASS_WITH_CONTRACT_REVISION_REQUIRED`（而非 `PASS`）

R1 / R2 / R3 **三者均已解决**（R1 判据闭环；R2 Registry 完整、差异已定性；R3 已裁定为 OBSERVATION）。
**但**：§5.6 清单不全（8.7）+ §5.8 枚举不全（8.9）+ **§5.8 重评触发条件已成立（8.10）** ⇒ **契约必须先修订**，才具备进入 Freeze 的前提。

### 9.3 为什么是 `NOT READY`（而非 `BLOCKED`）

- ⛔ **无**任何条件指向「不可修复」；⛔ **无**生产代码缺陷需要拦截；⛔ **无**证据矛盾。
- 阻塞项**全部**是**契约修订事项**，且 ℹ️ 现 v5.0 样本 = **0 行** ⇒ 修订的样本作废成本为 **0**。
- ⇒ 属「**待修订后可 Freeze**」，非「阻断」。

### 9.4 §11 元规则 4 的时序约束（★ 部署前必守）

§11 规则 4：「**采样进程与契约修改不得由同一次决策同时触发**」。
⇒ **若**决定部署 V3.6.6（使 08:00 链变 PROMOTION-CAPABLE），**则契约修订必须先于**采样进程重启完成；否则 08:00 与 22:00 的样本将以**未修订的 checkpoint 豁免**混入 ⇒ 违规。
⇒ ⛔ 本对话**不**部署、**不**重启采样；该约束**登记为下一门的前置条件**。

---

## 10. Required Next Gate

> **下一门 = 「CONTRACT REVISION GATE」（暂命名 G-5 前置），⛔ 需 owner 单独授权，⛔ 不得由本对话自行进入。**

**入口条件（全部满足方可开）：**
1. owner 就 **§7.1 版本标签**（`v5.1` vs `v6.0`）作出裁定；
2. owner 确认 **CCP-R2-1**（§5.8 checkpoint 重评方向）与 **CCP-R2-2/R2-3**（§5.6 清单 + §5.8 举证方式）的**范围**；
3. 确认 **CCP-R1-1** 作为 non-normative 附注（无升版）。

**该门须产出：**
- 修订版契约（DRAFT → FROZEN，含显式样本作废声明）；
- 修订后的 **Trigger Registry 快照**（重跑 `fx detail`，声明 as-of）；
- 若 checkpoint 变更 ⇒ 同步更新 `c1_capture.py` checkpoint 判据（§11 规则 5：工具语义迁移与契约冻结同批次）。

**该门的放行语句（带判据的条件式，⛔ 不得写成单步缺口断言）：**
> 「当且仅当 ① 版本标签已裁定、② 三条 CCP 已按裁定完成入库、③ 修订版契约的 FROZEN 指纹已复核、④ `c1_capture.py` 与 checkpoint 判据同批次对齐 —— **四项同时为真时**，方可进入 V3.6.6 Freeze 评审；否则不得进入。」

**⛔ 不在本门范围**：V3.6.6 部署 / canary / GE-04 / 生产 DB 写入 / 生产代码修改。

---

## 11. 附录 —— 复现命令（实时只读）

```bash
# §1 冻结契约指纹
cd D:/AI-Projects/Codex/etf-decision-engine/_g1-contract-v5-20261002
git rev-parse HEAD
git hash-object docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md
git show HEAD:docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md | wc -c && \
git show HEAD:docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md | wc -l && \
git show HEAD:docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md | sha256sum
git ls-remote origin refs/heads/docs/gen1-evidence-contract-v5-20261002

# §3.4 R1 判据三项自证
NODE="C:/Users/iquel/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
"$NODE" scripts/gen1/evidence-capture/independence_discriminator.js --selftest
"$NODE" scripts/gen1/evidence-capture/independence_discriminator.js --non-interference
"$NODE" scripts/gen1/evidence-capture/independence_discriminator.js --red-proof

# §2 云只读实读（Python 查询器；⛔ find 用 filter；⛔ filter 内不得放 sort）
cd D:/AI-Projects/Codex/etf-decision-engine/_g4-tools
python -c "import sys;sys.path.insert(0,'.');import r1r2r3_query as q;print(q.find('ml_shadow_signal',{'date':'2026-09-30'},limit=10)['count'])"

# §2.6 调用链（tcb logs search；⚠️ --limit ∈ [1,100]；字段在 content 内）
NODE2="C:/Users/iquel/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
CLI="C:/Users/iquel/.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/dist/standalone/cli.js"
"$NODE2" "$CLI" logs search -e tradingview-etf-d0fa42yy57cbc11b -q '<CLS>' -t '2026-09-30 21:59:00;2026-09-30 22:03:00' -l 100 --json
"$NODE2" "$CLI" logs search -e tradingview-etf-d0fa42yy57cbc11b -q '<CLS>' -t '2026-10-01 07:59:00;2026-10-01 08:03:00' -l 100 --json

# §4 trigger metadata
"$NODE2" "$CLI" fn detail fetchDailyData -e tradingview-etf-d0fa42yy57cbc11b --json
"$NODE2" "$CLI" fn detail materializeIndicators -e tradingview-etf-d0fa42yy57cbc11b --json

# §2/§3 证据 digest 重建
cd D:/AI-Projects/Codex/etf-decision-engine/_g4-tools
python build_r1r2r3_digest.py

# §2.7 代码锚点
cd D:/AI-Projects/Codex/etf-decision-engine/_g1-contract-v5-20261002
sed -n '420,428p' cloudfunctions/fetchDailyData/index.js
sed -n '122,130p' cloudfunctions/materializeIndicators/index.js
grep -n "runDecisionEngine" cloudfunctions/adminGateway/index.js
```

**证据文件清单（仓库外，⛔ 不入库）**：

| 文件 | sha256 / 备注 |
|---|---|
| `_g4-tools/out/R1R2R3_EVIDENCE_DIGEST.json` | `fd5f5b98…6fdf20` · 13822 B |
| `_g4-tools/out/R1R2R3_CLOUD_COLLECTIONS.json` | `d7468459…acb4` · 179438 B |
| `_g4-tools/out/R1R2R3_INVOCATION_LOGS.json` | 36164 B |
| `_g4-tools/out/R1R2R3_COUNTS.json` | 4878 B |
| `_g4-tools/out/CV5_frozen.md` | 冻结契约只读导出副本 · 64580 B |

---

## 12. FINAL STATUS（owner §八 三态口径）

```text
V3.6.6_IMPLEMENTED       = PASS
REPLAY_PARITY_PASS       = PASS
CONTRACT_REEVALUATION    = PASS_WITH_CONTRACT_REVISION_REQUIRED
FREEZE                   = NOT READY

R1 EVENT INDEPENDENCE    = RESOLVED        （判据可执行 + 8 夹具 + 非干预 8/0 + 红证 7 条全 PASS）
R2 TRIGGER REGISTRY      = RESOLVED_WITH_CONTRACT_REVISION_REQUIRED
                                           （Registry 完整；§5.6 清单不全 + §5.8 枚举不全 + §5.8 重评触发已成立）
R3 input_hash            = RESOLVED        （裁定 = OBSERVATION，⛔ 非 CONTRACT GAP）

PRODUCTION CODE CHANGE REQUIRED = NO       （R1/R2/R3 范围内）
BLOCKING DEFECT                 = NONE
```

**⛔ 本轮终点 = STOP-AND-REPORT。**
⛔ 不得据此报告进入 V3.6.6 Freeze / merge / deploy / canary / GE-04 / tag creation / 生产 DB 写入 / 生产代码修改。
⛔ 契约本体（`GEN1_EVIDENCE_CONTRACT_V5.md`）本轮**零改动**；所有修订均为 **DRAFT / PROPOSAL**，待 owner 授权后方可进入 §10 的 Contract Revision Gate。
