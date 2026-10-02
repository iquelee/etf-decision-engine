# Gen-1 Evidence Contract v5.0（证据契约 · 正式载体）

**文档编号**：`WP-G1-EVIDENCE-CH-5.0`
**版本**：v5.0（**GENERATED / PR REVIEW**）
**状态**：✅ **REVIEWABLE** ｜ ⛔ **NOT FROZEN** ｜ ⛔ **NOT SEALED** ｜ ⛔ **NOT AUTHORIZED FOR EXECUTION**
**取代关系（拟）**：**v5.0 拟取代 v4.0**；v4.0 / v3.0 / v2.0 / v1.0 既有样本**显式作废**
（实测既有样本 = **0 行** ⇒ 作废成本为零，但**声明必须保留**）。
⛔ 取代仅在 **FREEZE 授权后**生效。
**as-of**：2026-10-02（北京时间）
**授权依据**：owner 2026-10-02 裁定 —— **OWNER-AUTHORIZED AUTONOMOUS GOVERNANCE**
（治理裁定与 **CONTRACT GENERATION** 授权下放；**FREEZE / SEAL 仍为独立高风险闸门**）。
⛔ 「生成」与「冻结」是两个分开的授权步骤，**不得合并**。
**生成自**：v4.0 DRAFT（工作树 `_v4-contract-20260923` @ `8d1f1cd`）
- 工作副本 sha256（CRLF 落盘）= `80da4d99f9fdb5c9f54856210b5dc0fc06edcc8d8b2371a699f0bd5c5fa8f7c5`（38137 B / 709 行）
- git 内 blob（LF）= sha1 `ca6f049270675e468f6a984cb433b89411daa85e` / sha256 `74319398d8040ab5d409cacf9204e67891216c724868e6a3ba9d68fa1f2da07e`（37428 B）
- ⛔ 两者**不同源**（CRLF 工作副本 vs LF blob）⇒ ⛔ 不得混用为同一指纹
**生成源**：`2e24ecd6ba5fa1d21b2c6337e24f6aa09c2a1781`（`-gen1` worktree / `gen1-worktree-20260916`，as-of 草案生成时刻）
**载体基线**：`e015aaaf2860c808180e5bd1fbfc24d4fdef3303`（`origin/master`，as-of 载体入库时刻）
**前置冻结源**：v2.0 = `24677422`；v3.0 = `650db586`（blob `574112f433b9a9691aa8d728e45a3f2aeb931699`）

```text
V5.0 CONTRACT GENERATION      ✅ DONE（2026-10-02，自主裁定）
V5.0 REPOSITORY CARRIER       ✅ GENERATED / PR REVIEW（本文件；⛔ 未合并 master）
V5.0 CONTRACT FREEZE          ⛔ NOT FROZEN（独立高风险闸门 G-2）
V5.0 EVIDENCE SEAL            ⛔ NOT SEALED（独立高风险闸门 G-2）
EVIDENCE EXECUTION            ⛔ NOT AUTHORIZED
HISTORICAL BACKFILL           ⛔ PROHIBITED
GE-04                         ⛔ NOT AUTHORIZED
```

> ⛔ **本文件为 GENERATED / PR REVIEW；⛔ 尚未冻结，不得被当作执行契约使用。**
> ⛔ 不得据此启动样本累计、不得据此改 Seal、不得据此改 Authority、不得据此改 `c1_capture.py`。
> 冻结指纹将记于**载体 PR body 与独立 attestation 工件**，⛔ **不写入本文件**（避免自指矛盾）。
> ⚠️ **落点声明**：本文件为**仓库载体**，落于 `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md`；
> 载体分支自 `origin/master` 开出（**G-1**，2026-10-02 授权）。⛔ 未合并 master、⛔ 未冻结。
> ⛔ **G-1 ≠ G-2**：「生成并入库」与「冻结」是两个分开的授权步骤。

---

## 0. 本文件做什么，以及**不**做什么

**做**：定义「Gen-1 反事实建议是否具有经济价值」这一问句的**可复核、可证伪、不可事后修改**的度量口径 v5.0。

**不做**：

- ❌ 不修改 `GEN1_EVIDENCE_CONTRACT.md`（v1.0）**任何一个字节**。
- ❌ 不授权 `PRODUCTION` 档位（该档位继续永久不可达）。
- ❌ 不授权 `GUARDED_EFFECTIVE`（三钥匙与运行时叠加门另行约束）。
- ❌ 不改变「人工执行」与「自动交易关闭」。
- ❌ 不触碰 `ml/gen2/**` 与其冻结证据。
- ❌ **不解除** `Gen-1 → final_target` 的禁令：Gen-1 只提 Timing 提案，最终仓位**始终**由 V3.6.1 Safety Core 计算。

---

## 1. 与 v1.0 / v4.0 的关系

### 1.1 版本状态变更

| 项 | 处置 |
|---|---|
| `GEN1_EVIDENCE_CONTRACT.md`（v1.0） | **暂停作为正式采样执行契约**；⛔ **不删除、不修改、不否定其历史价值** |
| v1.0 / v2.0 / v3.0 / v4.0 既有样本 | **显式作废**。实测样本数 = **0** ⇒ 作废成本为零，但**声明必须保留** |
| **本文件 v5.0（拟）** | 自**冻结后首个被采纳（promoted）的自然 run**起取代 v4.0 作为正式执行契约 |

### 1.2 `CD-01` —— v1.0 的实质性缺陷（**已 CLOSED，历史事实**）

**缺陷**：v1.0 §1 把主比较列绑定到 `decision_result.gen1_canary_suggested_position`，
但 v1.0 §3 又强制要求「非 Candidate 也入样，`delta_position = 0`，作为对照组」，
而该字段在非 Candidate 日**构造性为 `null`** ⇒ 主列在对照组行上无定义。

**remedy = v2.0 起**（主列改绑 `gen1_counterfactual_suggested_position`），v5.0 **沿用**。
✅ **`CD-01` 已 CLOSED** —— 关闭条件 =「v2.0 真正冻结」，已于 **2026-09-21** 满足。
⛔ 不得因 v5.0 尚为 DRAFT 而把 `CD-01` 回退为 `OPEN`。

### 1.3 `CD-02` —— `regime` 源绑定缺陷（v4.0 已改绑；v5.0 **再次改绑落点**）

**缺陷**：v3.0 §3 字段 3 把 `regime` 绑到 `portfolio_snapshot.market_regime`，
而该字段是 **legacy 推导**（`deriveMarketRegime()`，V2.1 指数周线打分），
**不是生产决策实际消费的 regime**。

**v4.0 的 remedy（改绑 `decision_market_regime`）方向正确**，但 v5.0 实测发现其**落点已失效**：

```text
ENFORCE 下 v365WritePortfolio 短路 ⇒ 引擎不再写 portfolio_snapshot
⇒ portfolio_snapshot.decision_market_regime 在 2026-09-30 08:00 后不再新增
⇒ 该字段仍在产生，但落在 run_candidate_portfolio（ENFORCE 分支的 putCandidate）
实读：run_candidate_portfolio.decision_market_regime = "crisis"（2 run 均有）
      run_candidate_portfolio.market_regime          = "defensive"
      run_candidate_portfolio.market_regime_divergent = true
```

**登记**：`CD-02`（`CONTRACT SOURCE BINDING DEFECT`），
**remedy = v5.0**（落点由 `portfolio_snapshot` 再改绑为 `run_candidate_portfolio`），
**状态：`OPEN UNTIL V5.0 FREEZE`**。⛔ 在 v5.0 真正冻结前保持 **OPEN**。
⛔ 不得因 v4.0 已写出 remedy 而提前判 `CD-02` CLOSED（v4.0 从未冻结、从未采样）。

### 1.4 `CD-03` —— **同名不同义**（v5.0 新增；F-29 的契约层修正）

**缺陷（v4.0 §3.5 文本级）**：v4.0 §3.5 的排除表把 `expected_trade_date` 一行写为

```text
| `expected_trade_date` | 日历权威源（cn-trading-calendar v1） | ⛔ 否 —— 只进 run_manifest | HOST-LOCAL DIAGNOSTIC |
```

**同一格内混了两个不同轴的量**：

```text
(A) 日历权威源的 expected_trade_date
    载体 = runtime_status.v365_run_integrity.expected_trade_date   ← ⛔ 不进 run_manifest
(B) run_manifest.expected_trade_date
    载体 = run_manifest / run_history / active_run_pointer
    写入值 = index.js:1352 `expected_trade_date: snapshotDate`      ← RUN DATE，非日历口径
```

⇒ v4.0 §3.5 的「来源」列写的是 (A)、「落点」列写的是 (B)，**二者不是同一个量**。

**代码依据（线上 V3.6.5 包 `_cb-connect-20260921/bundle-src/index.js`）**：

```text
:626  expected_trade_date: v365ExpectedAuthority.expected_trade_date   ← (A) 日历权威（cn-trading-calendar）
:1352 expected_trade_date: snapshotDate                              ← (B) RUN DATE（manifest）
:1383 expected_trade_date: v365Manifest.expected_trade_date           ← (B) 透传（history）
:1000 const snapshotDate = new Date(Date.now()+8*3600*1000).toISOString().slice(0,10)
```

**实读印证（as-of 2026-10-02 11:51 +08）**：

```text
run_manifest["engine:2026-10-01:b1790812813101"].expected_trade_date        = "2026-10-01"   ← (B) RUN DATE
runtime_status.v365_run_integrity.expected_trade_date                       = "2026-09-30"   ← (A) 日历
active_run_pointer.expected_trade_date                                      = "2026-09-30"   ← (B) 被提升 run 的 RUN DATE
run_candidate_portfolio[run_id=engine:2026-10-01:…].snapshot_date           = "2026-10-01"
```

⇒ **(A) ≠ (B)**，相差 1 天（同一时刻）。

**登记**：`CD-03`（`CONTRACT AMBIGUOUS NAMING DEFECT`），**remedy = 本文件 §3.5 重写**，
**状态：`CLOSED-UPON-V5.0-FREEZE`**。

### 1.5 `CD-04` —— **`run_manifest.expected_trade_date` 的字段误用**（v5.0 登记；**⛔ 属生产链，本契约不修**）

**缺陷（生产侧，非契约侧）**：`validateCandidateSet` 用 (B) RUN DATE 去比对 `candidate.calc_date`（DATA DATE）：

```text
门 2：decision.calc_date === manifest.expected_trade_date
      ← 左端 = DATA DATE（数据最新日）
      ← 右端 = RUN DATE（北京运行日，snapshotDate）
⇒ 在「运行日 ≠ 数据日」的每一步必然判 mixed_date_detected
```

**后果（结构性，非偶发）**：

```text
08:00 管线（dailyPipeline-0800）：
  运行日 D 的 08:00，当日收盘尚未抓取 ⇒ calc_date = D-1（上一交易日）
  而 snapshotDate = D
  ⇒ D-1 ≠ D ⇒ 必 FAIL      ★ 08:00 run 在结构上永远无法通过 validation
22:00 管线（dailyFetch-2200）：
  运行日 D 的 22:00，fetchDailyData 已抓当日收盘 ⇒ calc_date = D
  ⇒ D == D ⇒ PASS            ★ 唯一可产生 promoted run 的管线
```

**实读印证**：

```text
09-30 22:01 run：snapshotDate 09-30 / calc_date 09-30 / validation_passed=true  / promoted=true
10-01 08:00 run：snapshotDate 10-01 / calc_date 09-30 / validation_passed=false / mixed_date_detected
10-02 08:00 run：门 1 即 BLOCKED（CASE_B_PARTIAL_STALE expected=2026-09-30 observed=2026-10-01）⇒ 未写 manifest
```

**登记**：`CD-04`（`PRODUCTION VALIDATION FIELD MISUSE`），
**状态**：`OPEN` —— ⛔ **本契约不修**（属生产代码）；**归属 = V3.6.6 需求项**；闸门 = **G-4**。

---

## 2. 核心对比对象（唯一主对比）

| 列 | 来源 | 含义 |
|---|---|---|
| `baseline_suggested_position` | **`run_candidate_decision.suggested_position`** | **V3.6.1 生产建议执行仓** |
| **`counterfactual_suggested_position`** | **`run_candidate_decision.gen1_counterfactual_suggested_position`** | **完整组合账本（组合 cap 后）的反事实建议执行仓** |

**理由（代码级）**：

1. `gen1-canary.js:274` `counterfactualSuggestedPosition: suggested`，注释 L273 明示「本轮组合约束后的**建议执行仓**（账本按它占用；与生产同口径）」。
2. 非 Candidate 日回落 baseline（L256）⇒ **天然产出对照组**，与 §4 自洽。
3. 若绑 `gen1_canary_suggested_position`，对照组行全部为 `null` ⇒ §4 不可执行。

### 2.1 `candidate_only_aux`（正式定名）

```text
gen1_canary_suggested_position  →  candidate_only_aux
```

- 语义：**仅**回答「当 Candidate 真正触发时，单只 Gen-1 S4 rerun 给出了什么建议」。
- ⛔ **不参与 Evidence 主评分**（不进 Q1/Q2/Q3、不计入 ≥30）。

### 2.2 辅助列（不用于主判定，仅供归因）

`gen1_counterfactual_target`、`gen1_counterfactual_delta`、`gen1_counterfactual_baseline_floor_breached`、`gen1_counterfactual_clamped`。

### 2.3 ⛔ 三条禁止

1. ⛔ 禁止「主列取 `candidate_only_aux`、`null` 时回退账本字段」的**隐式 fallback**（两套口径混算）。
2. ⛔ 禁止继续把 `gen1_canary_suggested_position` 标为**主列来源**。
3. ⛔ 禁止把两条列**混入 Q1/Q2/Q3**。

---

## 3. 样本字段（17 列，逐日一行一码）

每个 **(run_id, code)** 组合产生一行 —— ★ v5.0 起行键改为 **`run_id + code`**（见 §3.0）。
字段定义沿用 v1.0 §2（**逐字不变**），并给出 **ENFORCE 下的实际来源绑定**：

| # | 字段 | 类型 | **v5.0 来源（run 轴）** | v4.0 旧绑定（legacy 轴，已废） | 冻结口径 |
|---|---|---|---|---|---|
| 1 | `date` | date | **`run_candidate_decision.decision_date`**（**数据最新日**） | ~~`decision_result.decision_date`~~ | ⛔ 不用 `updated_at` |
| 2 | `code` | string | Main5：513310 / 515880 / 159582 / 518880 / 159570 | 同 | 仅 Main5；510300 不入表 |
| 3 | `regime` | string | **`run_candidate_portfolio.decision_market_regime`**（同 `run_id`） | ~~`portfolio_snapshot.decision_market_regime`~~ | ⛔ 不得由 Gen-1 signal lane 推导 |
| 4 | `stage` | string | **`run_candidate_decision.v361_baseline_stage`**（同 `run_id`） | ~~`decision_result.v361_baseline_stage`~~ | ⛔ **不是** Gen-1 signal stage |
| 5 | `domain_status` | string | 同 `(date, code)` 的 `ml_shadow_signal.domain_status` | 同 | **仅作模型适用域描述** |
| 6 | `probability` | number | 同 `(date, code)` 的 `ml_shadow_signal.calibrated_probability`；缺失按冻结规则取 `ml_probability` | 同 | 4 位小数；缺失记 `null` |
| 7 | `baseline_suggested_position` | number | **`run_candidate_decision.suggested_position`**（%） | ~~`decision_result.suggested_position`~~ | 1 位小数 |
| 8 | `counterfactual_suggested_position` | number | **`run_candidate_decision.gen1_counterfactual_suggested_position`**（%） | ~~`decision_result.gen1_counterfactual_suggested_position`~~ | 1 位小数 |
| 9 | `delta_position` | number | `counterfactual − baseline`（百分点） | 同（派生） | 1 位小数；**可为负** |
| 10 | `forward_5d` | number | 自 `date` 起第 5 个交易日**收盘价**收益率（%） | 同 | T+5 收盘 / T 收盘 − 1 |
| 11 | `forward_10d` | number | 同口径 T+10 | 同 | 同上 |
| 12 | `forward_20d` | number | 同口径 T+20 | 同 | 同上 |
| 13 | `MFE` | number | 窗口 T+1..T+20 最大有利变动（%），**用收盘价** | 同 | 正数；方向按 delta 方向取有利侧 |
| 14 | `MAE` | number | 同窗口最大不利变动（%） | 同 | 负数；方向同上 |
| 15 | `false_fast_path` | boolean | `ml_fast = true` 但事后 T+5 收益为负 | 同 | 依据 `forward_5d < 0` |
| 16 | `event_cluster_id` | string | 同一事件簇共享 ID（**计算规则见 §3.4**） | 同 | 无事件记 `NONE` |
| 17 | `independent_event` | boolean | **同簇内首个 Candidate 行**为 `true`（**计算规则见 §3.4**） | 同 | 对照行**恒 false** |

### 3.0 ★ **Evidence SAMPLE IDENTITY 与 SELECTOR**（v5.0 新增，冻结）

#### 3.0.1 三个身份量（互不替代）

```text
(I)   RUN IDENTITY      = { run_id, revision, pointer_revision }
(II)  DATA DATE         = run_candidate_decision.decision_date   （= calc_date）
(III) RUN DATE          = run_manifest.expected_trade_date       （= candidate_portfolio.snapshot_date）
```

⛔ 三者**不得互换、不得合并为一个 "date"**。
⛔ **(IV) CALENDAR TRADE DATE**（`runtime_status.v365_run_integrity.expected_trade_date`）**不进 Evidence**（见 §3.5）。

#### 3.0.2 **SELECTOR = S-PROMOTED**（唯一合法 selector）

```text
SELECTOR: S-PROMOTED
  R := active_run_pointer[scope="production"].run_id
       读取一次即 pin 住（pinned_once），⛔ 全程不重读

⛔ 不采用 S-LATEST          （任意最新 COMPLETE run）
⛔ 不采用 S-VALIDATED       （最新 validation_passed = true 的 run）
```

**理由（DECISION / RATIONALE）**：

| # | 理由 | 证据 |
|---|---|---|
| 1 | Evidence 的对象是「**生产已采纳的** authoritative decision」，不是「生产算出来的」 | `run_history.promoted` 是**唯一**显式给出「是否被采纳」的布尔；09-30 = `true`，10-01 = `false` |
| 2 | 承重墙 **R7**：不得因 candidate 有数据就声称 production 已消费 | 10-01 run 的 candidate 10 行**完整存在**，但生产**显式判其不合格**（`validation_passed=false` / `v365_promotion_attempted=false`） |
| 3 | `S-LATEST` 会读到 `mixed_date_detected` 的 run ⇒ 违反 §4「通路正常态」 | 10-01 run 实测即 `mixed_date_detected` |
| 4 | `S-VALIDATED` 只证明「未被拒绝」，**不证明被采纳**；仅在「validation 通过但 CAS 未获」的情形与 `S-PROMOTED` 分叉，而那时它**会选中未被采纳的 run** ⇒ 同属 R7 违反 | 门 3 的 CAS 语义（`classifyPointerPromotion`） |
| 5 | `S-PROMOTED` 与 reader-migration **目标读源同构**（`authority_selector = active_run_pointer.run_id`） | `v365-active-read.js` 的 `readAuthoritativeDataset` 语义 |
| 6 | `S-PROMOTED` 是**事件驱动**（下一次成功提升即产出），非结构性永久 FAIL | 指针当前 `revision=1`，自 09-30 22:01 未再前进 |

#### 3.0.3 **promotion 证明（五条 AND，缺一即 fail-closed）**

```text
PROMOTION_PROOF(R) :=
    active_run_pointer[production].run_id == R
AND run_history[R].promoted == true
AND run_history[R].read_after_write_consistent == true
AND run_manifest[R].validation_passed == true
AND run_manifest[R].revision == active_run_pointer[production].revision

任一条不成立
  → EVIDENCE_OBJECT_UNAUTHORITATIVE
  → BUNDLE_INVALID → NON-SCORING → NO RETROACTIVE RECONSTRUCTION
```

#### 3.0.4 **sample_key / bundle_key**

```text
sample_key  = <run_id> + '::' + <code>        ← 行唯一键
bundle_key  = <decision_date>                 ← bundle 唯一键（§5.5）

⛔ `pointer_revision` **不进 sample_key**：
   实测 pointer.revision ≡ 被提升 run 的 run_manifest.revision（09-30 run 二者俱为 1）
   ⇒ 对 `run_id` **函数依赖**，对行身份**无区分力**；
   但它**必须**进 bundle 的 provenance（用于 §5.4 规则 A2 的一致性校验）。

⛔ `run_id` **必须**进 sample_key：
   实测两个 run（engine:2026-09-30:… / engine:2026-10-01:…）的 decision_date **均为 2026-09-30**
   ⇒ 若仍用 (date, code) 作行键将发生 **键碰撞**（10 行折叠为 5 键）
```

### 3.1 ★ `regime` 精确绑定 + **双日期双组**（v5.0 重定义）

```text
Evidence.date
= run_candidate_decision.decision_date          （数据最新正式交易日）
  where run_id == R

Evidence.regime
= run_candidate_portfolio.decision_market_regime
  where run_id == R
  from the same accepted C-1 capture bundle
```

**来源层级（v5.0 定，⛔ 不得替代）**：

| 字段 | 定位 |
|---|---|
| `run_candidate_portfolio.decision_market_regime` | ✅ **AUTHORITATIVE EVIDENCE REGIME（唯一主来源）** |
| `run_candidate_portfolio.market_regime` | ⚠️ **legacy_snapshot_regime / DIAGNOSTIC ONLY** —— ⛔ 不得用于分层、分域、判定 |
| `run_candidate_decision.effective_market_regime` | ⚠️ **downstream sizing diagnostic** —— ⛔ 不作来源（⚠️ 实测 518880 缺键，见 F-15） |
| `portfolio_snapshot.decision_market_regime` | ⛔ 不作来源（ENFORCE 后停写；且该集合为混合轴，见 §3.6） |
| `ml_shadow_signal.market_regime` | ⛔ 不作来源（lane-local，见 §9.3） |

**⛔ 不要求 `effective_market_regime` 与 `decision_market_regime` 相等**（沿用 v4.0，理由不变）：

```text
v3-bull-participation.js:115-128  resolveEffectiveRegime(baseRegime, bullScore, portfolio)
  if (base === 'crisis' || base === 'defensive') {
    if (bullScore >= BULL_TIER.recovery) return 'recovery';   ← 合法分歧
    return base;
  }
```

⚠️ **故 ⛔ 不得把「二者相等」写成硬 Gate** —— 那会**误杀**正常 bundle。

**双组（v5.0 重定义；run 轴 vs data 轴）**：

```text
组 A —— RUN 轴自洽（同一 run 内，⚠️ 廉价一致性护栏，近似恒真，但保留）
  A1: run_candidate_portfolio[R].snapshot_date == run_manifest[R].expected_trade_date
  A2: run_manifest[R].revision == active_run_pointer[production].revision
  A3: run_manifest[R].run_id == run_history[R].run_id == active_run_pointer[production].run_id

组 B —— DATA 轴（跨源，**有信息量**）
  B1: run_candidate_decision（R）的 5 行 decision_date 必须完全相同
  B2: 该 decision_date == ml_shadow_signal.date（Main5 五行全等）
  B3: run_candidate_decision（R）的 5 行 calc_date 全等，且 == decision_date
  B4: decision_date <= run_manifest[R].expected_trade_date   （数据不得"来自未来"）

⛔ 组 A ≠ 组 B 是正常态，不得断言四者全等。
⛔ ⛔ (IV) CALENDAR TRADE DATE **不得**写入 A / B 任一组（host-local，§3.5）。
```

**为何组 A 改为 run 内自洽**：

```text
v4.0 组 A 右端 = runtime_status.decision_date（**单例、最后写入者**）
⇒ 该字段被**不可提升的 08:00 run** 覆盖（index.js:1653 无条件写）
⇒ 与被 pin 的 promoted run（run 日 09-30）在 10-01 起**永久不等**
⇒ 恒定 FAIL = 工具性误杀，且**不可复现**（依赖读取时点，违反 R8）
实读：runtime_status.decision_date = 2026-10-01（最后写入者 = 08:00 run）
      active_run_pointer.expected_trade_date = 2026-09-30
```

**实测印证（as-of 2026-10-02 11:51 +08）**：

```text
组 A（run = engine:2026-09-30:b1790776862980）
  A1: snapshot_date 2026-09-30 == manifest.expected_trade_date 2026-09-30   ✅
  A2: manifest.revision 1 == pointer.revision 1                            ✅
  A3: 三者 run_id 全等                                                      ✅
组 B（decision_date = 2026-09-30）
  B1: 5 行 decision_date 全为 2026-09-30                                     ✅
  B2: ml_shadow_signal.date = 2026-09-30（5 票齐）                          ✅
  B3: 5 行 calc_date 全为 2026-09-30 == decision_date                       ✅
  B4: 2026-09-30 <= 2026-09-30                                             ✅
```

### 3.2 方向约定（沿用 v1.0，冻结）

- `delta_position > 0` → Gen-1 建议**加仓**；`< 0` → **减仓**。
- 收益方向与 **delta 方向**对齐判断「对不对」：
  - 加仓且 `forward_Nd > 0` → ✅ 对；加仓且 `< 0` → ❌ 错
  - 减仓且 `forward_Nd < 0` → ✅ 对（躲跌）；减仓且 `> 0` → ❌ 错（踏空）

### 3.3 MFE / MAE 口径（沿用 v1.0，冻结）

- 窗口固定 **T+1 .. T+20**（20 个交易日），不因 beta 结果缩短。
- 基准价 = T 日收盘价。
- `MFE = max(路径内最高收盘 / T 收盘 − 1)`；`MAE = min(路径内最低收盘 / T 收盘 − 1)`。
- 未满 20 个交易日记 `null`，⛔ **不得**用现有天数凑近似值。

### 3.4 ★ `event_cluster_id` 与 `independent_event` 的计算规则（v3.0 新增并冻结；**v4.0 / v5.0 沿用，⛔ 未改**）

**规则 = C-B（时间维去相关）+ 混合标记**：

```text
CLUSTER_GAP_DAYS = 10

① event_cluster_id —— 对**全表**（Candidate 行 + 对照行）计算：
   同一 code 按 date 升序；与同 code 上一条样本的间隔 ≤ CLUSTER_GAP_DAYS 天
   ⇒ 归入同一簇；否则开新簇。
   ⛔ 不对「同一交易日的不同 code」做合并（见下方「已知局限」）。

② independent_event —— 只有 **Candidate 行**可能为 true：
   每一簇内，**首个 `delta_position != 0` 的行**标记 `independent_event = true`；
   该簇内其余行一律 false。
   若某簇内**无** Candidate 行 ⇒ 全簇 `independent_event = false`。

③ 对照行取值：
   event_cluster_id  —— 正常参与聚类（用于界定簇边界）
   independent_event —— **恒 false**
```

**为何这样定（决策依据）**：

1. §7.1 规定 `independent_event` 是 Q1 p 值的**计数单位** ⇒ 计数单位必须是**有信息量的观测**；只有 `delta_position != 0` 的行才可能「对 / 错」。
2. §4.1 的对照组是为**比较**（Q2 / Q3）而存在，**不是**为「证明 Gen-1 有价值」提供独立证据。
3. ⛔ 若允许对照行为 `true` ⇒ `independent_events >= 30` 可在**零真实 Candidate**时达成 ⇒ 该成熟度门槛将**不度量任何东西**。
4. ⛔ 若只用 Candidate 行聚类 ⇒ 当前 Candidate = 0 时**无法界定任何簇边界**。

**已知局限（必须随每次报告显式声明）**：本规则**未建模同一交易日跨 code 的相关性**。
同一交易日 5 只 code 受**同一市场环境**驱动，可能被计为多个独立事件 ⇒ 报告的独立性**偏乐观**。
⛔ 不得把结论表述为「已充分独立」。

**⚠️ 由此得出的重要性质（必须与结论同读）**：
本规则下 `independent_events` 的增长**完全取决于真实 Candidate 的出现频率** ——
对照行不贡献、无 Candidate 的簇不贡献。
⇒ 在真实 Candidate 出现之前，`independent_events` **恒为 0**，⛔ 不得据此推断「接近门槛」。

### 3.5 ★ **日期概念排除声明**（v5.0 重写；取代 v4.0 §3.5，修 `CD-03`）

**四个日期概念，两个入契约、两个不入**：

| # | 概念 | 载体（实读值，as-of 2026-10-02 11:51 +08） | 是否入 Evidence 消费集合 | 定位 |
|---|---|---|---|---|
| **(I)** | **RUN IDENTITY** | `run_id` / `run_manifest.revision` / `active_run_pointer.revision` | ✅ **入**（作 **provenance / 行键分量**，⛔ 非统计量） | EVIDENCE PROVENANCE |
| **(II)** | **DATA DATE** | `run_candidate_decision.decision_date` = `calc_date` = `2026-09-30` | ✅ **入**（= `Evidence.date`；forward 收益的 T0） | **EVIDENCE PRIMARY DATE** |
| **(III)** | **RUN DATE** | `run_manifest.expected_trade_date` = `run_candidate_portfolio.snapshot_date` = `2026-10-01`（10-01 run） | ✅ **入**（**仅**用于 §3.1 组 A 的 run 轴自洽校验，⛔ **不得**作 `Evidence.date`） | EVIDENCE RUN-AXIS GUARD |
| **(IV)** | **CALENDAR TRADE DATE** | `runtime_status.v365_run_integrity.expected_trade_date` = `2026-09-30`（源 `cn-trading-calendar`，`calendar_version = cn-a-share-2026.1`） | ⛔ **不入** —— 仅作 bundle 的**对齐诊断**留存 | **HOST-LOCAL DIAGNOSTIC** |
| — | `observed_latest_date` | `runtime_status.v365_run_integrity.observed_latest_date` = `2026-09-30` | ⛔ **不入** | **HOST-LOCAL DIAGNOSTIC** |

**理由**：

1. `Evidence.date` 必须是**价格可得的日期**（forward 收益的 T0 需有收盘价）⇒ 只能是 **(II) DATA DATE**；**(IV)** 是「数据可用性期望」，不是价格日期。
2. 在 **S-PROMOTED** 下，被采纳的 run 已经过 `validation_passed=true`（即 `calc_date == snapshotDate` 一致性确认）⇒ **(IV) 对 Evidence 已无增量判别力**。
3. 把 (IV) 写进契约会让契约**耦合到 `cn-trading-calendar` 的版本与实现**，违背 §11 不可变性意图。
4. **(III) 必须入组 A**（否则组 A 无从校验），但 ⛔ **不得**充当 `Evidence.date` —— 这正是 `CD-03` 要防的混淆。

**⛔ 本契约的日期口径为「Data 轴 + Run 轴」两组，⛔ 不扩展为「三个 Evidence 日期」。**

⛔ **不得**因 (III) / (IV) 的存在而：

- 新增 Evidence 统计字段或 eligibility 判据；
- 把「宿主 run 日期对齐失败」当作 Evidence 的**额外**排除条件
  —— 该失败已由 §3.0.3 `PROMOTION_PROOF` 的 fail-closed 覆盖（未通过 validation 的 run 永不可能被 pin）。

> ⚠️ **本条的复核条件已触发并已就地闭合**：
> v4.0 §3.5 的复核条件为「若 V3.6.5 首次自然运行后 `expected_trade_date` **确实落入了** Evidence 消费的集合，本条须重审」。
> 实测（V3.6.5 首两次自然运行）：`run_manifest` 已被本契约 §5.3 纳为**源** ⇒ 复核条件**成立**
> ⇒ v5.0 **就地完成重审**：拆分同名两义（`CD-03`）、把 (III) 限定为「组 A 护栏、⛔ 不作 `Evidence.date`」、(IV) 继续 host-local。
> ⛔ 该闭合**不构成**「把 (IV) 引入 Evidence」。

### 3.6 ★ `portfolio_snapshot` 与 `run_candidate_portfolio` 的语义分界（v5.0 新增）

| 维度 | `portfolio_snapshot`（legacy，**混合轴**） | `run_candidate_portfolio`（**纯 run 产物**） |
|---|---|---|
| 写入方 | ⚠️ ① 引擎（**仅 LEGACY 模式**，`index.js:558`）；② **`adminGateway.persistLiveSnapshot`**（`adminGateway/index.js:829`）；③ 资产编辑（`:1027`） | ✅ 仅引擎（ENFORCE 模式，`putCandidate`，`index.js:560`） |
| ENFORCE 后是否仍写 | ⚠️ **仅资产字段**被 `adminGateway` 写（**不含** `decision_market_regime`） | ✅ 每次 ENFORCE run 写一次 |
| 语义轴 | **混合**：run 产物 + **MUTABLE_STATE**（用户维护资产字段） | **纯 run 产物**（immutable per run） |
| `decision_market_regime` | 有（legacy 遗留，实测 09-30 = crisis） | 有（run 产物，实测 crisis） |
| 行数 / 最新（实读） | **41** / `2026-09-30` | **2** / 两个 run |

**E-2 闭合（UNV-23）**：`COLLECTIONS.PORTFOLIO_SNAPSHOT` 的 upsert 在 `origin/master` 上**只有两处**，
均在 `adminGateway`（`:829` / `:1027`），写入字段**全为资产轴**；
引擎侧 upsert（`runDecisionEngine/index.js:1124`）在 ENFORCE 下被 `v365WritePortfolio` 短路。
⇒ **ENFORCE 之后 `portfolio_snapshot` 没有引擎写入方**。

⇒ **结论**：`portfolio_snapshot` **不可**作为 run 产物源；`Evidence.regime` ⛔ 不得取该集合。
⚠️ `run_candidate_portfolio` 里**同时**含资产字段（`total_asset` 等），Evidence **只应取 `decision_market_regime`**（+ `snapshot_date` 作组 A），
⛔ 不得把 candidate 组合快照整体当作「资产现状」（那是 MUTABLE 轴的事）。

---

## 4. 样本纳入与排除规则（**E1 — DAILY FULL-SAMPLE**）

### 4.1 纳入

```text
Canary 处于 counterfactual_canary_active = true 的每个合格交易日，
对该日被采纳（PROMOTION_PROOF 通过）的 run 的 Main5 每个 code 产生一行。

Candidate 与 non-Candidate 都入样；
non-Candidate 为 control（delta_position = 0）。
```

**合格交易日** = 满足本节纳入规则 ∧ 未触发 §4.2 排除规则 ∧ **通过 §5 的 Bundle Coherence Gate**。

**Candidate 与否的判定**：⛔ **单独由冻结 Candidate 条件决定**；⛔ **不得**用 `probability` 是否 `null` 反推。

### 4.2 排除（显式列出，防事后挑样本）

1. `runtime_status.gen1_counterfactual_canary_active = false` 的交易日。
2. `runtime_status.gen1_health_gate_status != 'ACTIVE'` 的交易日。
3. `runtime_status.gen1_counterfactual_ledger_ok != true` 的交易日。
4. `date` 缺失或 `baseline_suggested_position` 缺失的行。
5. **§5.2 `PROVENANCE_MISSING`** 或 **§5.4 `BUNDLE_INVALID`** 的交易日。
6. **§3.0.3 未通过 `PROMOTION_PROOF`** 的 run（其全部行）。
7. **§5.9 `EVIDENCE OBJECT BOUNDARY` 不成立** 的 bundle。

> 排除规则的唯一目的是「样本必须是**通路正常态**下的观测」，**不是**为了事后剔除不利样本。
> 任何对本节的修改 = 契约版本升级 + 样本重算。

### 4.3 与里程碑协议的关系（澄清 v1.0 的四处表述冲突）

`GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md` §2 M5 与 `GEN1_DAILY_PRODUCTION_WATCH.md` §3.1 M5 所称
「证据表**第一条真实样本**」，**正解为**：

> **第一条 `delta != 0` 的真实 Candidate 样本 / 首个 Candidate 里程碑样本**

⛔ **不是**「Evidence 表从零开始的第一行」。里程碑协议只负责**捕获首次触发**，**不得**反写样本总体规则。

---

## 5. 每日 eligibility provenance 与 capture bundle

### 5.1 采用 C-1：EXTERNAL READ-ONLY DAILY SNAPSHOT

**性质**：Evidence 工作包**本地/归档**写入，⛔ **不是生产 DB 写入**；⛔ **不改生产语义**。

| 方案 | 处置 |
|---|---|
| **C-1 外部只读日快照** | ✅ **采用** |
| C-2 生产侧新增逐日行 | ⛔ `NOT AUTHORIZED` |
| C-3 代理判据 | ⛔ **REJECTED** —— 代理字段**不能**证明 `active` / `ledger_ok` |

**缺口依据（实测）**：`gen1_counterfactual_canary_active` 与 `gen1_counterfactual_ledger_ok`
**仅存于 `runtime_status` 覆盖式单例**，`decision_result` / `run_candidate_decision` **逐日不留存** ⇒ 无法回溯。

### 5.2 硬规则一：缺当日快照 ⇒ 当日不可作为正式样本（fail-closed）

```text
PROVENANCE_MISSING
→ FAIL-CLOSED
→ NON-SCORING
→ NO RETROACTIVE RECONSTRUCTION
```

⛔ **不得**第二天用 `runtime_status` singleton 倒填。⛔ **不得**用今日状态倒推过去。

### 5.3 硬规则二：每日 capture bundle（append-only，**八源**）

★ v5.0 源集合：**保留 3 + 改绑 2 + 新增 3 = 8 源**。

```text
decision_date            （= Evidence.date，(II) DATA DATE）
run_id                   （= (I) RUN IDENTITY，被 pin 的 promoted run）
bundle_revision          （本 bundle 格式版本）
capture_timestamp
checkpoint_ok            （§5.8 判定结果）

# --- eligibility（唯一来源 = runtime_status 单例；仅主字段） ---
runtime_status.updated_at
gen1_authority
gen1_counterfactual_canary_active
gen1_health_status
gen1_health_gate_status
gen1_counterfactual_ledger_ok
gen1_production_write
gen1_auto_execution

# --- run identity / selector provenance ---
pointer_revision                 （active_run_pointer.revision，读取时 pin 住）
run_manifest.revision
run_manifest.expected_trade_date （(III) RUN DATE —— ⛔ 仅作组 A 护栏）
run_manifest.validation_passed
run_history.promoted
run_history.read_after_write_consistent
run_history.cas_reason
run_history.promoted_at

# --- 对齐诊断（⛔ 不参与 eligibility） ---
calendar_version
calendar_expected_trade_date     （(IV) —— HOST-LOCAL DIAGNOSTIC）
observed_latest_date
date_alignment_case

# --- 八源 raw SHA256（append-only） ---
raw runtime_status          SHA256
raw run_manifest            SHA256
raw run_history             SHA256
raw active_run_pointer      SHA256
raw run_candidate_decision  SHA256
raw run_candidate_portfolio SHA256
raw ml_shadow_signal        SHA256
raw invocation log record   SHA256
```

**八源清单（★ v5.0）**：

| # | 源 | v5.0 角色 | v4.0 状态 |
|---|---|---|---|
| 1 | `runtime_status` | eligibility **唯一**来源（**降为 eligibility-only**） | 保留（原兼任组 A 右端 ⇒ 已撤销） |
| 2 | `ml_shadow_signal` | 字段 5/6 + 组 B 右端 | 保留 |
| 3 | `invocation log`（`tcb logs search`） | §5.6 `NATURAL_RUN_PROVENANCE` | 保留 |
| 4 | `run_candidate_decision` | 字段 1/4/7/8 + 组 B | 🔁 **改绑**（原 `decision_result`） |
| 5 | `run_candidate_portfolio` | 字段 3 + 组 A | 🔁 **改绑**（原 `portfolio_snapshot`） |
| 6 | `run_manifest` | (I)/(III) + validation | ➕ **新增** |
| 7 | `active_run_pointer` | selector pin + revision | ➕ **新增** |
| 8 | `run_history` | promotion proof | ➕ **新增** |

> ⛔ v5.0 **不再**把 `decision_result` / `portfolio_snapshot` 列入评分源。
> ⚠️ 二者仍是**生产前台现行读链**（迁移债 RH4 / CLASS C，见 §5.9）—— ⛔ 不得因此把两者混为一谈。

### 5.4 硬规则三：`BUNDLE COHERENCE GATE`（v5.0 重写）

```text
1.  本 checkpoint 前最近一次被 promoted 的 run == 本次 pin 的 R
    （判定：active_run_pointer 于 capture 时刻的 run_id == R；⛔ 不查 runtime_status）
2.  pointer.revision 必须严格大于上一有效 bundle 的 pointer_revision
    （首个 bundle 见 §5.7）
3.  PROMOTION_PROOF(R) 五条 AND 全真（§3.0.3）
4.  run_candidate_decision(R) 恰有 Main5 五个 code
5.  该 run 五行 decision_date 完全相同                              （组 B1）
6.  ml_shadow_signal.date == 该 decision_date                        （组 B2）
7.  该 run 五行 calc_date 全等且 == decision_date                     （组 B3）
8.  decision_date <= run_manifest[R].expected_trade_date              （组 B4）
9.  run_candidate_portfolio(R).snapshot_date == run_manifest[R].expected_trade_date  （组 A1）
10. ml_shadow_signal 覆盖同一 Main5 code set
11. §3.0.3 的 run/revision 三者一致（组 A2/A3）
12. §5.6 NATURAL_RUN_PROVENANCE（含 CHAIN PROOF）
13. 任一 source 缺失 / 日期不一致 / code set 不完整 / 来源不可证明
    → BUNDLE_INVALID → NON-SCORING → NO RETROACTIVE RECONSTRUCTION
14. ⛔ (IV) CALENDAR TRADE DATE 不得出现在以上任一条的判据中
```

⚠️ **实施注意**：规则 5/6/7/8 属**组 B**（data 轴），规则 9/11 属**组 A**（run 轴）；
⛔ **不得**写成「四个日期全等」—— 那会**误杀每一个 bundle**（§3.1 实测：`09-21` vs `09-18`）；
⛔ 也**不得**写成「promoted run 的 run 日期 == 日历交易日」—— 见规则 14。

**⛔ 规则 1 / 2 的 v4.0 形态已废除**：v4.0 以 `runtime_status`（**单例、最后写入者**）为排序装置，
而该单例被**不可提升的 08:00 run** 无条件覆盖（`index.js:1653`）⇒ 排序信息被污染且**不可复现**（违反 R8）。
v5.0 改用 **`active_run_pointer`（单指针、单调 `revision`、promotion-bound）**。

### 5.5 硬规则四：one-bundle-per-decision_date + **单调采纳**

```text
① 同一 decision_date  →  至多一个正式 Evidence bundle
② bundle_key = decision_date
③ 后到者（同 decision_date）→ BUNDLE_INVALID / NON-SCORING，⛔ 不得覆盖已接受 bundle
④ 新 bundle 的 decision_date 必须**严格大于**上一已接受 bundle 的 decision_date
   （否则 = 同一数据日的重述 ⇒ NON_SCORING）
⑤ ⛔ 不得事后挑选更好看的结果；⛔ 不得人工补跑
```

**理由**：

1. 同一数据日可能有**不止一个 run**（实测两个 run 的 `decision_date` 均为 `2026-09-30`）；
2. 必须有**机器可判定**的唯一采纳对象 —— 由 §3.0.3 `PROMOTION_PROOF` + 本节 ①–⑤ 共同给出；
3. ③④ 使「先到先得 + 单调」成为**可机械检验**的规则，消除 W1/W2 归属不可判定的历史问题；
4. ⛔ 不引入「事后择优」窗口。

### 5.6 硬规则五：`NATURAL_RUN_PROVENANCE`（含 CHAIN PROOF）（v5.0 **重锚**）

```text
NATURAL_RUN_PROVENANCE

必须来自外部只读取证
通道 = tcb logs search（调用日志）+ tcb fn detail（trigger metadata）
不得从 runtime_status / run_integrity 自行推断

至少证明：
- runDecisionEngine invocation timestamp 与 request_id
- 该 invocation 的 engine_run_id == 被 pin 的 R
- request_source（本跳与上游跳分别记录）
- **该 run 属于预先冻结的自然管线**（见下方 CHAIN PROOF）
- capture checkpoint 在该 invocation 完成之后
```

**CHAIN PROOF（v5.0 重锚）：必须锚到** ***产生该 run 的*** **入口，而非 capture 窗口**

```text
1. 上游入口函数存在 request_source == TRIGGER_TIMER 的调用：
     · 22:00 管线入口 = fetchDailyData（cron 0 0 22 * * 1-5）
     · 08:00 管线入口 = materializeIndicators（cron 0 0 8 * * 1-5）
2. 链式传播可从代码证明（origin/master）：
     fetchDailyData/index.js:424      → app.callFunction({ name: 'materializeIndicators', … })
     materializeIndicators/index.js:127 → app.callFunction({ name: 'runDecisionEngine', … })
3. 下游 runDecisionEngine 的 completion 与 run_history[R].created_at / promoted_at 匹配
4. ⛔ 不对两跳做严格先后序约束
5. ⛔ 该 run 的 invocation **不必**落在 capture checkpoint 窗口内
     （promoted run 的 invocation 时刻与 capture 时刻天然不同日/不同时段）
6. ⛔ 必须排除**管理侧重入**：adminGateway/index.js 的
     :547 `riskResolve` / :578 `riskTrigger` / :661 `paramChange`
   会直接 callFunction runDecisionEngine ⇒ 该类调用**不是**自然运行
   （判定：若该 invocation 不能归入上述两条管线的 entry 链 ⇒ RUN_PROVENANCE_UNVERIFIED）
```

**为什么禁止严格序**：SCF 日志 `timestamp` 是**日志刷写时刻**，不是**执行完成时刻**。
实测：下游 START `08:00:28.102` **早于**上游 END `08:00:30.339` 约 **2.24s**（刷写延迟）。

**为什么必须重锚（v4.0 形态在本契约下会 100% 误杀）**：
v4.0 要求「上游 START 与下游 START 均落在同一个 `CANONICAL_CAPTURE_CHECKPOINT` 窗口内」。
但 §5.8 的 checkpoint 与**可被采纳的管线**今天**不是同一条**（`CD-04`）：

```text
可被采纳（promotion 可能发生）的唯一管线 = 22:00 dailyFetch-2200
可被 capture 的窗口（v4.0）= 08:00–09:00
⇒ 二者无交集 ⇒ 任一 promoted run 都无法通过 v4.0 的 CHAIN PROOF
```

**实测锚点（可复算，as-of 2026-10-02）**：

| 跳 | 函数 | `request_id` | 时刻（+08） | `request_source` |
|---|---|---|---|---|
| 1 | `fetchDailyData` | `3bc435d3-380b-4328-a39a-f07096231b75` | 2026-09-30 22:00:06 | `TRIGGER_TIMER` |
| 2 | `materializeIndicators` | `1c88d7ae-e117-4256-8549-62a9e48b13ea` | 2026-09-30 22:00:56 | `TCB_API`（链式） |
| 3 | `runDecisionEngine` | `c6ca469a-cc0c-4b24-af4f-dd00b0477134` | 2026-09-30 22:01:02 | `TCB_API`（链式） |

⇒ 第 3 跳的 `run_id` = `engine:2026-09-30:b1790776862980` = **被 pin 的 R**（实测 `active_run_pointer.run_id`）。

**⛔ 关键禁令**：⛔ **不得**要求 `runDecisionEngine` 自身 `request_source == TRIGGER_TIMER`
—— 其 `Triggers = 0`，自然调用**必然**表现为 `TCB_API`；该规则会 **100% 误杀每一次自然运行**。

**trigger 实读（`tcb fn detail`，as-of 2026-10-02）**：

| 函数 | TriggerName | cron | 含义 |
|---|---|---|---|
| `materializeIndicators` | `dailyPipeline-0800` | `0 0 8 * * 1-5 *` | **08:00**，周一–周五 |
| `fetchDailyData` | `dailyFetch-2200` | `0 0 22 * * 1-5 *` | **22:00**，周一–周五 |
| `runGen1ShadowEod` | `gen1-eod-weekdays-2220` | `0 20 22 * * 1-5 *` | 22:20，周一–周五 |
| `fetchFundamentalNews` | `newsFetch-1630` / `intelFetch-30min` | `0 30 16 * * 1-5 *` / `0 0,30 8-22 * * * *` | 16:30 / 每 30 分钟 |
| `runDecisionEngine` | — | **Triggers = 0** | 只能被链式调用 |

⚠️ **`CD-05`（v5.0 登记）**：v4.0 §5.8 的 `CANONICAL_CAPTURE_CHECKPOINT` 定值依据表**漏列 `dailyFetch-2200`**
（只列了 `materializeIndicators` 08:00 与 `runGen1ShadowEod` 22:20）⇒ 09:00 checkpoint 建立在**不完整的触发器清单**上。
**remedy = §5.8 重锚**。

**`request_source` 观测取值域**（7d，10,797 条；⛔ 不主张为全域）：
`TRIGGER_TIMER` 7,325 / `TCB_GW` 1,520 / `""` 877 / `TCB_API` 75。

**失败路径**：

```text
无法证明来源
  → RUN_PROVENANCE_UNVERIFIED
  → BUNDLE_INVALID
  → NON-SCORING
```

### 5.7 硬规则六：FIRST BUNDLE 例外

```text
FIRST OFFICIAL BUNDLE:
previous_valid_bundle = NONE
→ pointer.revision 前进性比较 = NOT_APPLICABLE
→ 其余 coherence gates 仍须全部 PASS

SECOND AND LATER:
active_run_pointer.revision  >  previous_valid_bundle.pointer_revision
```

### 5.8 `CANONICAL_CAPTURE_CHECKPOINT`（v5.0 **重锚**；取代 v4.0 的 09:00）

```text
CANONICAL_CAPTURE_CHECKPOINT
= 工作日 **[22:30:00, 23:30:00)（北京时间）** 的预登记有界窗口
= 权威管线（22:00 dailyFetch-2200）完成后、下一自然运行开始前的静默窗口内的固定时点

checkpoint_ok = (weekday(capture_local) < 5)
                AND 22:30:00 <= capture_local_time < 23:30:00
```

**定值依据（2026-10-02 云端只读实测）**：

| 事实 | 实读 |
|---|---|
| 唯一可产生 **promoted** run 的管线 | `dailyFetch-2200`（22:00）→ `materializeIndicators` → `runDecisionEngine` |
| 08:00 管线为何不可用 | `CD-04`：08:00 时 `calc_date = D-1 ≠ snapshotDate = D` ⇒ `mixed_date_detected` **必然**（实测 10-01 run） |
| promoted run 完成时刻观测 | `2026-09-30 22:01:11`（`run_history.promoted_at` = `2026-09-30T14:01:11.865Z`） |
| 组 B 右端（`ml_shadow_signal`）写入时刻 | `runGen1ShadowEod` 22:20 ⇒ **必须晚于 22:20** |
| 静默窗口 | `[22:30, 次日 08:00)` 内**无**四源（`runtime_status` / `run_candidate_*` / `ml_shadow_signal` / `run_manifest`）写入者 |

- ⛔ 该窗口**一经冻结即成为永久统计口径**，⛔ 不得事后放宽（**预登记**的窗口边界不是「事后放宽」）。
- ⚠️ 第 22:30–23:30 段内 `intelFetch-30min`（`0 0,30 8-22 * * * *`）可能触发，但其写入**不属于**本契约的四源 ⇒ 不影响。

> ⚠️ **与 `CD-04` 的关系**：本时点是**迁就现存生产事实**（只有 22:00 管线能提升）的裁定。
> 若 `CD-04` 被修复（`validateCandidateSet` 改用正确的日期对），则 08:00 管线亦可能产出 promoted run
> ⇒ 届时 checkpoint 须按 §11 元规则**重新评估**（本时点不作为永久假设）。

### 5.9 ★ 硬规则七：`EVIDENCE OBJECT BOUNDARY`（v5.0 新增）

```text
EVIDENCE OBJECT := 生产**已采纳**的 authoritative decision
                 = the promotion-accepted run 的 run-axis dataset
                 （active_run_pointer[production] 所指向的 run）

⛔ EVIDENCE 不主张：
   · 前台现行读链已迁移到 run 轴
   · 用户界面 / apiGateway / adminGateway 已经消费该 run
   · 候选集合的存在 == 生产已消费
```

**边界字段组（必须同列陈述，⛔ 不得合并成一句）**：

| 字段 | 语义 | 实读（as-of 2026-10-02 11:51 +08） |
|---|---|---|
| `authoritative_run_promoted` | 权威 run 是否已被 promotion 采纳 | ✅ `true`（`run_history.promoted`，09-30 run） |
| `authoritative_read_path_migrated` | **前台**读链是否已迁移到 run 轴 | ⛔ **false** —— `apiGateway` / `adminGateway` 仍 `orderBy(decision_date\|snapshot_date desc).limit(1)` |
| `reader_migration_status` | reader migration 工程状态 | `PENDING`（`RUN_HISTORY_INDEX = PENDING` / `V365_ENFORCE_SWITCH_DATE = null`） |
| `legacy_engine_write_stopped` | 引擎是否已停写 legacy 集合 | ✅ `true`（ENFORCE 起） |

> ⛔ **反例必须写明**：`authoritative_run_promoted = true` **时**，`authoritative_read_path_migrated` **仍可为 false**
> —— 今天就正是这一组合。⛔ 不得据前者推断后者。

**为什么必须显式化**：承重墙 **R7** 要求「生产 authoritative read path 与 candidate/promotion path 必须明确区分」。
Evidence 观察的是 promotion 结果（= 迁移**目标**语义），而前台**当前**仍读 legacy ——
若不显式声明，读者会把「Evidence 有了样本」误读为「生产前端已在消费 Gen-1 决策」。

---

## 6. 判定问题（Q1 / Q2 / Q3，沿用 v1.0，冻结）

| 编号 | 问题 | 判定指标 | 冻结阈值 |
|---|---|---|---|
| **Q1** | Gen-1 建议是否**方向正确**？ | `hit_rate = 方向正确样本数 / (delta ≠ 0 的样本数)` | ≥ **55%** 且二项检验 p < 0.10 |
| **Q2** | 是否**提升风险调整收益**？ | 按 delta 方向构造组合，其 T+5/T+10/T+20 平均收益 vs baseline 的**增量** | 至少 T+10 或 T+20 显著 > 0 |
| **Q3** | 是否**引入更多假信号**？ | `false_fast_path` 比例：Gen-1 侧 vs baseline 侧 | Gen-1 侧不得显著高于 baseline 侧 |

---

## 7. 统计口径（冻结）

### 7.1 样本独立性与最小样本量

- Q1 的 p 值用 **独立事件**计数（`independent_event = true`），⛔ 不用原始行数。（规则见 **§3.4**。）
- 在 `independent_event = true` 的行数达到 **≥ 30** 之前，**不下任何结论**。
- 分域报告：`domain_status` 分层（`IN_DOMAIN` / `PARTIAL_COVERAGE` / `OUT_OF_DOMAIN`）**不得混算**。

### 7.2 ★ 三层分母（⛔ 不混线）

| 层级 | 说明 |
|---|---|
| 原始 observation 行 | 每个合格交易日 × 5 |
| `independent_event = true` 行 | 须经 `event_cluster_id` 去相关；**必然 ≤ 原始行数** |
| **Q1 有信息量的样本** | `delta_position != 0` 的样本 |

### 7.3 ★ 防误读条款

```text
≥30 independent events
= Evidence Gate 的必要成熟条件
≠ Q1 自动可判定

Q1 denominator
= independent_event = true AND delta_position != 0
```

---

## 8. 三种终局（沿用 v1.0，冻结）

| 终局 | 条件 | 动作 |
|---|---|---|
| **EVIDENCE_POSITIVE** | Q1 ∧ Q2 成立，Q3 不成立 | 可提案进入下一权限档评估（**仍需独立工作包**，本契约不授权直接上生产） |
| **EVIDENCE_NEGATIVE** | Q2 在 ≥ 30 独立事件后仍不成立 | Gen-1 归因为「无经济价值」，Canary 保持观察或回退 ADVISORY |
| **EVIDENCE_INCONCLUSIVE** | 样本不足 / 分域冲突 / 测量噪声过大 | 延长观察，⛔ **不得**以「还不够差」为由推进 |

> ★ **特别声明**：`EVIDENCE_POSITIVE` **不等于**可以直接上 `PRODUCTION`。
> 上生产需**另一份独立契约** + owner 授权，且受 `gen1-authority.js` 的 `PRODUCTION_LOCKED` 硬边界约束。

---

## 9. 数据来源与采集路径

### 9.1 来源表（v5.0 重绑）

| 数据 | 来源（v5.0） | 采集方式 |
|---|---|---|
| 建议仓 / stage / 反事实建议仓 | **`run_candidate_decision`（按 `run_id == R` 过滤）** | 每日 checkpoint 后读取 |
| `regime` | **`run_candidate_portfolio.decision_market_regime`（`run_id == R`）** | 同上 |
| run identity / validation | **`run_manifest`** | 同上 |
| selector / pointer revision | **`active_run_pointer`** | 同上 |
| promotion proof | **`run_history`** | 同上 |
| domain / probability | `ml_shadow_signal` | 同上 |
| Canary 健康态 / eligibility | `runtime_status`（**当日**快照，见 §5） | 同上 |
| 调用来源 | `tcb logs search`（调用日志）+ `tcb fn detail` | 同上 |
| forward 收益 | `etf_daily`（official bars，`source != 'realtime'` 且 `volume > 0`） | 样本成熟后回填 |

### 9.2 回填原则

`forward_5d/10d/20d/MFE/MAE` 在样本**成熟后**才回填；未成熟行保持 `null`，
⛔ **不得**用实时价或估算值填充。

### 9.3 ⛔ 禁止用作生产资格证据的字段

```text
ml_shadow_signal.gen1_authority      ⛔ 不得用于证明生产资格
ml_shadow_signal.canary_allowed      ⛔ 不得用于证明生产资格
```

**定性（已代码核实）**：`ml_shadow_signal.gen1_authority = ADVISORY` 而生产链 = `CANARY`，
原因是 shadow lane 调用 `resolveAuthority({ml_shadow_observe, ml_advisory_enabled, ml_fast_path_enabled})`
**不传** `gen1_authority`（`runGen1ShadowEod/index.js:166`），源码默认值即 `ADVISORY`
（`gen1-authority.js:69` / `:110`；`tests/gen1-authority.test.js:19-20` 断言默认必须为 `ADVISORY`）；
生产链则 `resolveAuthority(merged)`（`runDecisionEngine/index.js:560`）⇒ `CANARY`。

```text
CLASSIFICATION: LANE-LOCAL DEFAULT METADATA / BY CURRENT DESIGN
                NOT PRODUCTION AUTHORITY / NOT PRODUCTION DRIFT
STATUS:         PRE-EXISTING SEMANTIC DEBT
                NON-BLOCKING IF EXCLUDED FROM ELIGIBILITY
```


### 9.4 ★ 源锚点 ref 绑定（v5.0 新增；G-1 载体轮）

⛔ **本契约引用代码锚点时必须与 ref 同时引用**；⛔ 不得只写「模块名 + 行号」。

**原因**：V3.6.5 的 run / decision 完整性模块 **不在 `origin/master` 上** ——
本载体分支（自 `origin/master` 开出）**不含**这些文件。缺 ref 会形成
「引用了一个在本分支不存在的文件」的**不可审计状态**。

| 锚点 | 权威 ref | 行 |
|---|---|---|
| `src/common/utils/v361-run-context.js` → `CASE_A_ALL_EXPECTED` / `CASE_B_PARTIAL_STALE` | `feat/v365-production-integrity-impl` @ `d6692983a27a283c61774d6a3bd14fba4ef47e49` | `:108` / `:162` / `:447` |
| `src/common/utils/v365-run-integrity.js` → `expected_trade_date`（日历权威源；⛔ 不得用 `max(calc_date)` 代替） | 同上 | `:48-49` / `:337` |
| `src/common/utils/v365-atomic-publish.js` → `validateCandidateSet` | 同上 | `:120`（`mixed_date_detected` @ `:145`） |
| `src/common/utils/v365-publish-store.js` → `classifyPointerPromotion` | 同上 | `:89`（注释块 `:75-88`） |
| `cloudfunctions/fetchDailyData/index.js` → 链式 `materializeIndicators` | `origin/master` | `:424` |
| `cloudfunctions/materializeIndicators/index.js` → 链式 `runDecisionEngine` | `origin/master` | `:127` |
| `cloudfunctions/adminGateway/index.js` → 管理侧重入 `runDecisionEngine` | `origin/master` | `:547` / `:578` / `:661` |
| `cloudfunctions/adminGateway/index.js` → `PORTFOLIO_SNAPSHOT` upsert（仅资产轴） | `origin/master` | `:829` / `:1027` |

**发现标签对照（保留上游 F 编号，⛔ 不因本契约改名而丢失）**：

```text
F-30  ↔  CD-05   dailyFetch-2200 管线此前完全未被登记（触发器清单漏列 22:00 管线）
F-31  ↔  CD-04   08:00 管线在 validateCandidateSet 上结构性永不可通过（RUN DATE vs DATA DATE）
F-37            上游治理报告的门 1/2/3 锚点落笔时未标 ref —— 本表为其契约层修正
```

**关系**：`feat/v365-production-integrity-impl` 与 PR #60 分支**同基线** `e93f396`；
两者**均非** `origin/master` 的祖先（`origin/master` 已前进）。⛔ 本载体不基于它们。
⛔ 上游治理报告作为 as-of 历史记录**不被回改**（其指纹保持有效）。

---
> 同行的 `domain_status` / `calibrated_probability` / `ml_fast` / `stage` **仍可**作为**模型 signal 数据**使用。
> ⛔ 不要把「模型输入快照」与「生产 Authority 真相」混成一层。

---

## 10. 生效日

```text
v5.0 FREEZE
    ↓
冻结后**首个被 PROMOTION_PROOF 采纳的自然 run**
    ↓
正式 scoring sample 起算
```

`2026-09-10 … 2026-10-02` 的全部既有行（含 v1–v4 时代的 0 行）只能标记为：

```text
PRE-V5 DIAGNOSTIC / NON-SCORING / NON-GATE
```

⛔ 不得进入 Q1/Q2/Q3；⛔ 不得贡献 ≥30；⛔ **HISTORICAL BACKFILL = PROHIBITED**。

**理由**：截至 2026-10-02，部分历史 forward outcome **已开始可见**；在看到结果后重定义数据源再回填历史，
**会破坏「冻结在先、采样在后」的 pre-registration 原则**。

---

## 11. 契约不可变性（元规则）

1. 本文件**冻结后**，字段名、字段定义、纳入/排除规则、判定阈值、selector、checkpoint**不得修改**。
2. 发现错误 → 发布 **v6.0**，并**显式作废 v5.0 全部样本**，从新版本生效日起重新累计。
3. 每次修改必须在变更日志留痕，写明**修改动机**与**是否作废既有样本**。
4. 采样进程与契约修改**不得由同一次决策同时触发**。
5. ⛔ **工具（`c1_capture.py`）的语义迁移与契约冻结同批次**：
   在 v5.0 冻结之前，⛔ **不得**把工具改绑到 v5.0 语义（保持 v3.0 语义运行）
   —— 否则会出现「工具已按未冻结契约采样」的**预登记违规**。

### 变更日志

| 版本 | 日期 | 修改内容 | 是否作废既有样本 |
|---|---|---|---|
| v1.0 | 2026-09-10 | 首次冻结（WP-G1-EVIDENCE 启动） | — |
| **v2.0** | 2026-09-21 | ① 主列改绑 `gen1_counterfactual_suggested_position`（修 `CD-01`）；② 引入 E1 daily full-sample；③ 引入 C-1 provenance + 五源 bundle + coherence gate；④ `regime` 精确绑定 + 双日期双组；⑤ 引入 `NATURAL_RUN_PROVENANCE`（CHAIN PROOF）；⑥ 新增 `≥30 ≠ Q1 可判定` 防误读条款 | **是** —— 作废 v1.0 全部样本（实测 = **0 行**） |
| v2.0-draft rev.1 | 2026-09-21 | 闭合冻结前置：① `CANONICAL_CAPTURE_CHECKPOINT` 定为 09:00；② C-1 归档落点/命名与 append-only 规则定稿；③ 多 capture 冲突定为「先到先得 + 后到 NON-SCORING」；④ 补记 coherence gate 只读 dry-run 验证 | **否**（草案修订） |
| **v2.0 FROZEN** | 2026-09-21 | 冻结（**仅**状态头 / §12 / 变更日志） | **否** |
| **v3.0** | 2026-09-21 | 补 §3.4：钉死 `event_cluster_id` / `independent_event` 计算规则（C-B） | **是** —— 作废 v2.0 全部样本（实测 = **0 行**） |
| v4.0（DRAFT，**从未冻结**） | 2026-09-23 | ① `regime` 改绑 `decision_market_regime`（修 `CD-02`）；② 定来源层级；③ 明确不要求 `effective` == 主来源；④ 新增 §3.5 宿主内部量排除声明 | **否**（从未冻结、从未采样） |
| v5.0-draft rev.1 | 2026-10-02 | **闭合冻结前置**（与 G-2 同批次）：修正 §3.0.3 标题的键数标注「四键」→「五条」，使其与 §5.4 规则 3「`PROMOTION_PROOF(R)` 五条 AND 全真」及该节实际列出的五条件（`active_run_pointer.run_id == R` / `run_history.promoted` / `run_history.read_after_write_consistent` / `run_manifest.validation_passed` / `run_manifest.revision == active_run_pointer.revision`）一致；⛔ 不改变任何规则语义，⛔ 不改变字段名 / 字段定义 / 纳入排除规则 / 判定阈值 / selector / checkpoint | **否**（草案修订） |
| **v5.0**（**GENERATED / PR REVIEW**，⛔ NOT FROZEN） | 2026-10-02 | ① **读源整体改绑 run 轴**（`decision_result`→`run_candidate_decision`；`portfolio_snapshot`→`run_candidate_portfolio`）；② **新增 `run_manifest` / `active_run_pointer` / `run_history` 三源**（§5.3 五源 → **八源**）；③ **新增 §3.0 `SAMPLE IDENTITY` 与 `SELECTOR = S-PROMOTED`**；④ 行键由 `(date, code)` 改为 **`(run_id, code)`**（修 `CD-02` 落点 + 键碰撞）；⑤ **§3.1 双组重定义**：组 A 改 run 内自洽、组 B 左端改 candidate，新增 B3/B4；⑥ **§3.5 重写**（拆同名两义，修 `CD-03`）；⑦ **§5.4 gate 重写**（规则 1/2 改按 pointer revision）；⑧ **§5.5 加单调采纳**；⑨ **§5.6 CHAIN PROOF 重锚到 22:00 入口管线**（修 `CD-05` 与 100% 误杀）；⑩ **§5.8 checkpoint 由 09:00 改为 22:30 窗口**；⑪ **新增 §5.9 `EVIDENCE OBJECT BOUNDARY`**；⑫ 新增 §3.6 `portfolio_snapshot` 分界（E-2/UNV-23 闭合）；⑬ 登记 `CD-03` / `CD-04` / `CD-05` | **是（拟）** —— 作废 v1–v4 全部样本（实测 = **0 行**） |

**v5.0 修改动机（合并陈述）**：
`CD-02` 的 remedy 落点在 ENFORCE 下**已失效**（引擎不再写 `portfolio_snapshot`）；
promotion 链（`run_candidate_*` / `run_manifest` / `active_run_pointer` / `run_history`）**已在写但无消费者**；
且实测证明 v4.0 的组 A / gate 规则 1·2 / CHAIN PROOF / checkpoint **四者均与生产事实冲突**。

---

## 12. 未决项（★ 冻结前必须闭合）

| # | 事项 | 状态 |
|---|---|---|
| 1 | **本文件（v5.0）冻结授权** | ⛔ **NOT YET** —— 独立高风险闸门 **G-2** |
| 2 | **契约载体（新分支 / 新 PR）的仓库写入授权** | ✅ **已执行**（**G-1**，2026-10-02）：载体 = 本文件 @ `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md`，分支自 `origin/master` 开出；⛔ 未合并 master |
| 3 | `CANONICAL_CAPTURE_CHECKPOINT` 具体时点 | ✅ **已裁定 = 工作日 [22:30, 23:30)（北京）** —— 依据见 §5.8 |
| 4 | C-1 归档的**具体落点与命名** | ✅ **已裁定**：仓库外 `_evidence-capture-YYYYMMDD/`；`<decision_date>__bundle.json` + `<decision_date>__bundle.sha256`；同名已存在 ⇒ **拒绝写入**（append-only）。⚠️ **bundle 现须含 `run_id` / `pointer_revision`**（v5.0 新增） |
| 5 | C-1 自动化 | ⛔ **当前不授权创建任务**；顺序 = 先手工/半自动跑通 **≥3 个交易日** ⇒ 验证 gate 不误杀 ⇒ 再议 automation。⚠️ **checkpoint 改为 22:30 ⇒ 需人工/半自动在夜间执行**（或改为「次日任意时刻抓取 + 用 `capture_timestamp` 证明落在窗口内」——⛔ 后者与 §5.8 的预登记窗口冲突，**不采用**） |
| 6 | `CD-01` 关闭条件 | ✅ **已 CLOSED** —— 条件「v2.0 真正冻结」已于 2026-09-21 满足 |
| 7 | 同一 `decision_date` 出现多个 capture 的冲突处置 | ✅ **已裁定**：**先到先得** + **单调**（§5.5 ③④） |
| 8 | 冻结是否伴随 git commit | ✅ **已裁定：是** —— 载体自 `origin/master` 开出（⚠️ 第 2 项已由 G-1 执行；冻结仍属 G-2） |
| 9 | 本文件 activation-ready 状态 | ❌ **NOT YET** —— 第 1/2 项未闭合 |
| 10 | `CD-04`（生产 `validateCandidateSet` 字段误用）修复归属 | ⛔ **V3.6.6 需求项**（闸门 **G-4**）；⛔ 本契约不修 |
| 11 | `gen1_counterfactual_canary_active = false` / `gen1_health_status = DEGRADED` | ⛔ **PHASE 2 健康语义**（闸门 **G-5**）；⛔ 与读源正交，**E-1b 不解决此层** |
| 12 | `c1_capture.py` 语义迁移 | ⛔ **与冻结同批次**（§11 规则 5）；⛔ 冻结前不得改绑 |

---

## 13. 边界声明与不授权声明

**生成轮（2026-10-02，v5.0 / 自主）仅做**：
从 v4.0 DRAFT 派生 → 读源整体改绑 run 轴 → 新增 selector/sample identity → 双组重定义 →
§3.5 重写 → §5.3 扩为八源 → §5.4 gate 重写 → §5.5 单调采纳 → §5.6 CHAIN PROOF 重锚 →
§5.8 checkpoint 重锚 → 新增 §5.9 对象边界 → 登记 `CD-02`(重绑) / `CD-03` / `CD-04` / `CD-05`。

⛔ 未改任何**其他**字段/阈值/纳入规则；⛔ 未启动样本累计；⛔ 未改 Seal / Authority；
✅ 已入库（`docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md`，**GENERATED / PR REVIEW**）；
⛔ 未冻结、⛔ 未合并 master、⛔ 未部署；⛔ 未修改 PR #60 的代码 / commit / review / merge 状态；
⛔ 未修改 `c1_capture.py`；⛔ 未触碰生产代码 / 配置 / DB。


### 13.1 随行治理证据（同批入库）

| 文档 | 路径 | 角色 |
|---|---|---|
| E-1 读源正解前置分析 | `docs/gen1/GEN1_STEP11_E1_READ_SOURCE_RULING_PREREQ_20261002.md` | 定义 ①a / ①b / ①c |
| E-1b 样本身份前置设计 | `docs/gen1/GEN1_STEP11_E1B_SAMPLE_IDENTITY_DESIGN_20261002.md` | 定义 A / B / C / D 备选 |
| E-1b-AB 治理裁定分析 | `docs/gen1/GEN1_STEP11_E1B_AB_GOVERNANCE_RULING_ANALYSIS_20261002.md` | 三层门 / 四日期 / H-1 |
| E-1b-AB 第 1 层裁定 | `docs/gen1/GEN1_STEP11_E1B_AB_LAYER1_GOVERNANCE_ANALYSIS_20261002.md` | A-1 / B-3° / C-1° |
| ★ 自主治理裁定（本契约的裁定依据） | `docs/gen1/GEN1_STEP11_E1B_AB_AUTONOMOUS_GOVERNANCE_RULING_20261002.md` | 全部裁定 + F-30 / F-31 + CD-03 / 04 / 05 |

⛔ 以上均为 **as-of 历史记录**，⛔ 不得据其修改本契约本体。
⚠️ `GEN1_STEP11_EVIDENCE_CONTRACT_V4_FREEZE_READINESS_20261002.md`（E-2 ~ E-5 的**定义**来源）
**不在本批入库范围**（G-1 授权枚举未含）⇒ 需要时另批处理，⛔ 本契约不假定其在本仓可读。
**⛔ 本文件不授权任何生产变更**；`gen1_authority` 保持 `CANARY`。
**⛔ 本文件不解除** `Gen-1 → final_target` 的禁令。

---

*本契约由 `WP-G1-EVIDENCE` 工作包 v5.0 生成（OWNER-AUTHORIZED AUTONOMOUS GOVERNANCE）。任何修改须遵循 §11 元规则。*
*落点：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md`（**GENERATED / PR REVIEW — ⛔ NOT FROZEN — ⛔ NOT SEALED**）*
*随行治理证据（同批入库）：见 §13.1。*
