# GEN-1 / PHASE 1 / Step 1.1-E1b-AB —— 读源改绑（①b）**A / B 两承重点治理裁定分析**

```text
文档定位 : GOVERNANCE RULING INPUT（给 Owner 的裁定输入件）
状态头   : ⛔ READ-ONLY ANALYSIS — ⛔ NOT A RULING — ⛔ NOT AUTHORIZED TO MODIFY / GENERATE / FREEZE
授权范围 : 「E-1b A+B 治理裁定分析，仅只读」
本步所做 : 只读复读契约 + 只读复读线上代码 + 只读实读 DB + 只读实读 CLS 日志 ⇒ 产出一份分析报告
本步未做 : ⛔ 未选 ①a / ①b / ①c；⛔ 未选 selector；⛔ 未改契约 / 脚本 / PR #60 / 生产链；
           ⛔ 未做 reader migration；⛔ 未 commit / push / PR / merge / deploy / freeze
生成时间 : 2026-10-02 11:03–11:20 (+08) / 2026-10-02T03:03–03:20Z
```

> 本文件**不回答**「应该选哪个」。它回答的是「**每个待裁项各自的事实是什么、选它会连带约束什么、代价在哪一侧**」，
> 使 Owner 的一句话裁定具备**可判定的后果描述**。凡涉及"选哪个更好"的句子，本文件**一律不写**。

---

## 0. 授权边界与本文的自我约束

| 项 | 本步状态 |
|---|---|
| 契约修改 | ⛔ **未做**（v4 字节未变，见 §2.1 指纹复算） |
| CONTRACT GENERATION | ⛔ **未授权、未做** |
| 仓库写入 | ⛔ **未做**（仅新增本报告，`outputs/` 命中 `.gitignore:8`） |
| PR #60 | ⛔ **未读改、未改 body** |
| 生产代码 / 配置 / Authorities / Seal / lock / immutable_set | ⛔ **未改** |
| candidate / pointer / decision_result / portfolio_snapshot | ⛔ **未写**（本步 DB 写命令数 = 0） |
| reader migration | ⛔ **未做** |
| 冻结 | ⛔ **未做** |

**自我约束三则**（沿用本工作包既有纪律）：

1. 凡"某字段等于/不等于某值"，均标 **as-of 时间戳**，⛔ 不以旧快照冒充今日；
2. 凡"代码里如何"均给 **文件:行** 或 **函数名**，⛔ 不写无出处的断言；
3. 凡"可能/倾向"一律降级为**假设 + 证伪条件**，⛔ 不把一次观测升格为规律。

---

## 1. A 与 B 的关系（为什么必须一起裁）

```text
A（消费哪个 run）  ──决定──▶  Evidence 的「对象是谁」
B（date 语义）     ──决定──▶  Evidence 的「同一性怎么键、日期怎么比」

⇒ B 的「组 A 双日期」当前两侧是：
     左 = portfolio_snapshot.snapshot_date
     右 = runtime_status.decision_date
  这两个字段在 ①b 下**都不再是 Evidence 的主读源** ⇒ 若不先定 A，B 的组 A 无对象可比；
   若不先定 B，A 选中的 run 无法被唯一键标识（实测存在同数据日多 run，见 §3.7）。
```

**⇒ 二者不是并列的两个问题，而是"对象 → 同一性"的一条链。** 本文件按 A（§3）→ B（§4）→ 交叉约束（§5）排列。

---
---

# 第一部分 · A 组：Evidence 应消费哪一个 run

## 2. 证据基线（as-of 2026-10-02 11:03–11:20 +08）

### 2.1 审查客体（复算）

| 项 | 实读 |
|---|---|
| 契约文件 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V4.md`（worktree `_v4-contract-20260923`） |
| 载体 HEAD | `8d1f1cde5effa8bf6eb3d88b780f84e3873337ef` |
| 载体 tracked status | **空（clean）** |
| 工作区大小 / 行数 | **38137 B**（CRLF 口径）/ 709 行 |
| 工作区 sha256 | `80da4d99f9fdb5c9f54856210b5dc0fc06edcc8d8b2371a699f0bd5c5fa8f7c5` |
| 与上一步（E-1b）比对 | **逐位一致 ⇒ 未被动过** |

### 2.2 线上包（只读副本）

| 文件 | 用途 |
|---|---|
| `_cb-connect-20260921/bundle-src/index.js` | `v365WriteDecision` / `v365WritePortfolio` / publish + manifest 构造 |
| `.../common/utils/v365-publish-store.js` | `classifyPointerPromotion` / `promotionAllowed` / CAS 更新 |
| `.../common/utils/v365-atomic-publish.js` | `validateCandidateSet` / `classifyCandidateSet` / pointer 切换决策 |
| `.../common/utils/v365-active-read.js` | `readAuthoritativeDataset`（pin-once）/ `FORBIDDEN_READ_PATTERNS` / `CLASS_C_READ_POINTS` |
| `.../common/utils/v361-run-context.js` | `DATE_ALIGNMENT_CASE` / `expected_trade_date` / `observed_latest_date` |
| `.../common/utils/cn-trading-calendar.js` | 日历权威源 |

### 2.3 云端实读快照（本步新抓）

| 集合 | 行数 | 最新键 | 关键值 |
|---|---|---|---|
| `run_manifest` | **2** | `engine:2026-10-01:b1790812813101` | 10-01 run：`expected_trade_date 2026-10-01` / **`validation_passed=false`** / `validation_reason mixed_date_detected` / `revision 2` / `finality_health HEALTHY` |
| `run_history` | **2** | 同上 | 10-01 run：`promoted=false` / `cas_reason=null` / `read_after_write_consistent=null`；09-30 run：`promoted=true` / `cas_reason=PROMOTED` / `read_after_write_consistent=true` |
| `active_run_pointer` | **1** | `active_run_pointer::production` | `run_id engine:2026-09-30:b1790776862980` / **`revision 1`** / `expected_trade_date 2026-09-30` / `promoted_from_run_id null` / `updated_at 2026-09-30T14:01:11.797Z` |
| `run_candidate_decision` | **10**（2 run × 5） | `engine:2026-10-01:…` | 全 10 行 `decision_date = 2026-09-30`；`calc_date = 2026-09-30`；`v361_baseline_stage` S0/S1；`suggested_position` 8.3 / 7.1 / 0；`gen1_counterfactual_suggested_position` 同值 |
| `run_candidate_portfolio` | **2** | `engine:2026-10-01:…` | 10-01 run `snapshot_date 2026-10-01`；09-30 run `snapshot_date 2026-09-30`；**均含 `decision_market_regime = crisis`** 且 `market_regime = defensive` / `market_regime_divergent = true` |
| `decision_result` | **161** | `decision_date 2026-09-29` | 仍未推进 |
| `portfolio_snapshot` | **41** | `snapshot_date 2026-09-30` | `decision_market_regime` **仅 7/41 行有**（09-22 `defensive`；09-23…09-30 `crisis`），其余 34 行**缺键** |
| `ml_shadow_signal` | **133** | `date 2026-09-30` | 数据日 09-30 |
| `runtime_status`（单例） | **1** | `updated_at 2026-10-01T00:00:22.690Z` | `decision_date 2026-10-01` / `v365_mode ENFORCE` / `v365_authoritative_publish_status NOT_PROMOTED` / **`v365_promotion_attempted=false`** / `v365_finality_status COMPLETE` |

> ⚠️ 组 A（本步实时复算）：`runtime_status.decision_date = 2026-10-01` vs `portfolio_snapshot` 最大 `snapshot_date = 2026-09-30` ⇒ **规则 7 仍 FAIL**；组 B：`decision_result.decision_date = 2026-09-29` vs `ml_shadow_signal.date = 2026-09-30` ⇒ **规则 5 仍 FAIL**。
> ⇒ 现文本（绑 `decision_result` / `portfolio_snapshot`）下当前态为 `BUNDLE_INVALID`。**本步只复算，不修**。

---

## 3. A 组裁定分析

### 3.1 A 的语义分解：把「latest vs promoted」还原成**三层门**

"promoted" 不是布尔开关，而是**三层门串联**的结果。实读代码：

```text
门 1 · 输入对齐层（v361-run-context.js + v365-run-integrity.js）
     expected_trade_date ← 日历权威源（cn-a-share-2026.1）
     observed_latest_date ← 5 票 snapshot.calc_date 的实际最大值
     CASE_A_ALL_EXPECTED → 放行
     CASE_B_PARTIAL_STALE / CASE_C_ALL_STALE / CASE_NO_REQUIRED_SNAPSHOT → BLOCKED
     ⇒ BLOCKED 时 index.js 早返回，**不写任何 authoritative 数据**（含 candidate）

门 2 · 候选完整性层（v365-atomic-publish.js:120 validateCandidateSet）
     (1) decision 候选齐备（Main5 不多不少）
     (2) portfolio 候选存在
     (3) 同日性 gate：`decision.calc_date === manifest.expected_trade_date`
         ⚠️ 此处 manifest.expected_trade_date 的来源是 snapshotDate（见 §4.2）
     (4) 无 ok === false 的候选
     任一失败 → validation_passed = false ⇒ **不进入提升**

门 3 · 提升原子性层（v365-publish-store.js:75-146 classifyPointerPromotion）
     bootstrap（无指针 → PROMOTED）/ 完全同态 → ALREADY_ACTIVE（幂等）
     CAS：expected.{run_id, revision} 必须等于当前值 → 否则 STALE_EXPECTED_POINTER
     单调 revision：next.revision <= current.revision → NON_MONOTONIC_REVISION
     ⇒ 通过 ⇒ pointer 条件更新 + run_history.promoted = true
```

**⇒ 三个候选 selector 的差别，本质是「要求走到第几层」：**

| selector | 要求的层级 |
|---|---|
| **S-LATEST**（任意最新 `run_candidate_*`） | 仅要求"被写过"（门 1 放行） |
| **S-VALIDATED**（latest **且** `validation_passed = true`） | 门 1 + 门 2 |
| **S-PROMOTED**（仅消费 promoted + 有效 pointer） | 门 1 + 门 2 + **门 3** |

### 3.2 三 selector 的事实差异（实读，不排序）

| 维度 | S-LATEST | S-VALIDATED | S-PROMOTED |
|---|---|---|---|
| 今日实读会命中 | `engine:2026-10-01:…`（rev 2） | 无（10-01 未过门 2）⇒ 回落到 `engine:2026-09-30:…` | `engine:2026-09-30:…`（pointer 指向） |
| 该 run 的生产资格 | 生产**未接受**（`validation_passed=false`） | 需另行检验 | **已接受**（`promoted=true`） |
| 与 reader-migration 目标 | ✗ 无对应（迁移目标是 `active_run_pointer.run_id`） | ⚠️ 部分（`CLASS_C_READ_POINTS.run_axis_target = run_history → run_candidate_*`） | ✓ 同构（`authority_selector = active_run_pointer.run_id`） |
| 反模式对照（`v365-active-read.js:44-69`） | ⚠️ 语义近 `LATEST_BY_UPDATED_AT`（以时刻代替 run 身份） | ⚠️ 仍需自建"哪条最新"的择取规则 | ✓ 与 `CANDIDATE_WITHOUT_RUN_BINDING` 反向（**必须绑 `active_run_id`**） |
| 唯一键是否天然可得 | ✗ 需自建（见 §3.7） | ✗ 需自建 | ✓ pointer 即入口 ⇒ `run_id` + `revision` 免费 |
| 供给是否受生产健康度约束 | 否 | **是（门 2）** | **是（门 1 + 门 2 + 门 3）** |
| 供给是否受"历史索引"约束 | 否 | 否 | ⚠️ 对**当日**否；对**历史回看**是（`RUN_HISTORY_INDEX = PENDING`） |

### 3.3 ★ 关键新事实：最近两次 ENFORCE 自然运行**各自在不同门失败**

| 运行 | `run_id` | 门 1 | 门 2 | 门 3 | 结果 |
|---|---|---|---|---|---|
| 2026-09-30 22:01 (+08) | `engine:2026-09-30:b1790776862980` | ✅（candidate `calc_date` = `snapshot_date` = 09-30） | ✅ `validation_passed=true` / `ok` | ✅ `PROMOTED` / `read_after_write_consistent=true` | **指针 rev 1** |
| 2026-10-01 08:00 (+08) | `engine:2026-10-01:b1790812813101` | ✅ `CASE_A_ALL_EXPECTED` | ❌ **`mixed_date_detected`**（5/5 wrongDate） | — **未尝试**（`v365_promotion_attempted=false`） | 无提升 |
| 2026-10-02 08:00 (+08) | （`engine:2026-10-02:b1790899218283`） | ❌ **`CASE_B_PARTIAL_STALE`** | — 未到达 | — 未到达 | **连 candidate 都未写**（`run_manifest` 仍 2 行） |

**⇒ 治理含义（本步核心结论之一）：**

```text
「今天 Evidence 产不出样本」**不是单一原因**，至少是**两个独立原因叠加**：
   R-a  门 2 的「同日性 gate」失败（10-01 run）
   R-b  门 1 的「输入日期对齐 gate」失败（10-02 run）
二者分属**不同治理归属**：R-a 与「契约期望的日期语义」耦合（属 B 组问题域），
                            R-b 属**纯生产输入链健康度**（与契约无关）。
⛔ 不得把 R-a 与 R-b 并成一句「生产不健康」——它们的修复路径、授权主体、可观测手段均不同。
```

### 3.4 ★ 假设 H-1（登记；含证伪条件；⛔ 本步不判其成立）

```text
H-1：S-PROMOTED / S-VALIDATED 的供给可能**结构性为零**，而不仅是"今日断供"。

观察（1 个数据点）：
  10-01 08:00 run：manifest.expected_trade_date = snapshotDate = 2026-10-01
                   而 5 票 candidate.calc_date 全部 = 2026-09-30
  ⇒ validateCandidateSet 第 (3) 条 5/5 wrongDate ⇒ mixed_date_detected

机制解释（待证）：08:00 自然运行时，当日收盘数据尚未产生 ⇒ calc_date ≤ 运行日 − 1
                 ⇒ 「calc_date === snapshotDate」对 08:00 run 恒不可满足。
                 09-30 那次之所以 PASS，是因为它以 22:01 运行（当日数据已到）。

证伪条件：在**未改任何生产代码**的前提下，出现任一 `validation_passed = true` 的
          **08:00** 自然运行 ⇒ H-1 假（供给非结构性为零）。

⛔ 本步不给 H-1 结论；⛔ 本步不据此建议任何生产改动。
```

> **为什么 H-1 必须登记进 A 组**：若 Owner 选 S-PROMOTED，则 Evidence 的**供给函数**等于生产提升链的健康度函数；
> H-1 若真，则该选择会把「Evidence 永远 0 样本」**写进契约层**——这是一个**冻结时就应知情的代价**，而不是事后发现。

### 3.5 门 3 的边界情形（决定 S-VALIDATED 与 S-PROMOTED 是否等价）

| 情形 | 门 2 | 门 3 | S-VALIDATED | S-PROMOTED |
|---|---|---|---|---|
| 同日 rerun 产生相同内容 | PASS | ALREADY_ACTIVE（幂等） | 采信 | 采信（指针未变） |
| 同日 rerun 产生**较旧 revision** | PASS | NON_MONOTONIC_REVISION | 可能采信（若被判"最新"） | 不采信 |
| 同日 rerun 内容**不同**（`same_trade_date_supersede`） | PASS | 需 CAS 通过 | 可能采信 | 受 CAS 守卫 |
| pointer 被并发改（STALE_EXPECTED_POINTER） | PASS | 不写 pointer，但 run_history 仍记录该 run | 会采信 | 不采信 |

**⇒ S-VALIDATED 与 S-PROMOTED 的差异**集中在「门 2 通过但门 3 不通过」这一区间：
**二者不是同一方案的强弱版本，而是对"并发/回退写入"是否设防**。今日该区间为空（10-01 止步门 2），
⇒ **今日无法用实读区分**；区分能力需等首个"过门 2 未过门 3"的运行出现。

### 3.6 A 组待裁项（判据清单，⛔ 不排序、不推荐）

| 编号 | 待裁问题 | 判据信息（实读） | 该选择的直接后果 | 可逆性 |
|---|---|---|---|---|
| **A-1** | Evidence 观察的是**生产的"决定"**还是**生产的"计算"**？ | 门 3 通过的 run 才对应生产真值读源（`authority_selector = active_run_pointer.run_id`）；未通过的 run 在生产侧**无读源** | 决定 S-PROMOTED 与 S-LATEST 的分野 | 契约层可逆（未采样）；一旦采样则须走 §11 |
| **A-2** | 是否接受「Evidence 供给被生产健康度阻断」？ | 门 1+2+3 三层；今日两层均出现过失败（§3.3） | 决定 Evidence 的**产出下界**是否等于生产链健康度 | ⚠️ 若选"接受"，则在 H-1 为真时**永久 0 样本** |
| **A-3** | 是否采用 **S-VALIDATED**（latest ∧ `validation_passed`）？ | 与 S-PROMOTED 的差异区间今日为空（§3.5） | 去掉门 3 守卫，换取"少受一次并发约束" | 同 A-1 |

### 3.7 与 A 组绑定的既有登记项

| 登记项 | 与 A 的关系 |
|---|---|
| `F-13` 同 `decision_date` 多 run | 实测两 run candidate `decision_date` 均为 `2026-09-30` ⇒ **S-LATEST 无法用 decision_date 唯一择取** |
| `F-14` `v365_promotion_attempted = false` | 说明 10-01 **止步门 2**，不是 CAS 拒绝 ⇒ 不能据此断言"提升机制失灵" |
| `F-17` `RUN_HISTORY_INDEX = PENDING` / `V365_ENFORCE_SWITCH_DATE = null` | 影响 **历史区间**消费（`CLASS_C_READ_POINTS` 仍 `legacy_only`），对"当日取一条 run"无影响 |
| `F-22` candidate 层已含 `decision_market_regime` | 支撑 ①b 的可行性（CD-02 remedy 字段**已在产生**） |

---
---

# 第二部分 · B 组：date 语义

## 4. B 组裁定分析

### 4.1 概念清单：**四个**，不是三个

| 编号 | 概念 | 语义 | 谁生成 | 实测值（10-01 run） |
|---|---|---|---|---|
| **(I)** | **RUN IDENTITY** | 这是哪一次运行（不可与其它 run 混淆） | 宿主 | `run_id = engine:2026-10-01:b1790812813101` / `revision 2` / `pointer_revision 1` |
| **(II)** | **RUN DATE**（运行日） | 宿主 wall-clock 的北京日期 | 宿主 `snapshotDate` | `run_manifest.expected_trade_date = 2026-10-01`；`run_candidate_portfolio.snapshot_date = 2026-10-01`；`runtime_status.decision_date = 2026-10-01` |
| **(III)** | **DATA DATE**（数据日） | 数据所代表的**最新正式交易日** | 数据管线 | `run_candidate_decision.decision_date = run_candidate_decision.calc_date = 2026-09-30`；`ml_shadow_signal.date = 2026-09-30`；`decision_result.decision_date = 2026-09-29` |
| **(IV)** | **CALENDAR TRADE DATE**（日历应到交易日） | 日历权威源判定的**应到**交易日 | `cn-trading-calendar.js`（`cn-a-share-2026.1`） | `v365_run_integrity.expected_trade_date = 2026-09-30` |

**实测关系**：`(II) = 2026-10-01 ≠ (III) = 2026-09-30 = (IV) = 2026-09-30`。
⇒ **四个概念在实例上互相独立**，不存在"某两个必然同值"。

### 4.2 ★ 名实不符（F-11 / F-12）的治理含义

```text
run_manifest.expected_trade_date     名字 = trade date（交易日）
                                     实际写入 = snapshotDate（北京运行日，index.js:1000 / :1189 / :1350）
active_run_pointer.expected_trade_date  继承同一值（index.js:1358 附近，manifest 构造）

⇒ 同一名字在**两个不同机制**里指两件事：
   ① validateCandidateSet（门 2）把它当 **trade date** 用 → 与 candidate.calc_date（数据日）比较
   ② run_integrity 的 expected_trade_date 才是**真**日历交易日

★ 后果（不是措辞问题，是判据错误）：
  门 2 的比较对象天然错配（运行日 vs 数据日）⇒ 在 (II) ≠ (III) 的每一天都 FAIL。
  实测 10-01 即 (II) ≠ (III)，5/5 wrongDate ⇒ mixed_date_detected。
```

**⚠️ 治理敏感性**：该名实不符既是 H-1 的成因，也**不是 Evidence 契约能修的东西**（属生产链）。
⛔ 本步只登记；⛔ 任何修复须独立立项、独立授权（见 §6、§8）。

### 4.3 Evidence 应否建立三个（或四个）独立概念？

**分析性结论（不涉及选边）：**

```text
✔ 概念层：应承认 4 个相互独立的概念（I / II / III / IV）—— 因为实例上确实互相不等。

✔ 契约层：**只应显式绑定 2 个**：
     (I)  RUN IDENTITY      → 用于 sample identity（§4.5，必需）
     (III) DATA DATE        → 用于 Evidence.date（= 现有 §3 字段 1 的语义，不变）

   (II) 与 (IV) 的归属：
     (IV) —— v4 §3.5 已明确「HOST-LOCAL DIAGNOSTIC，⛔ 不进 Evidence 消费集合」；
             §3.5 的三条理由（不落入四集合 / eligibility 已完整定义 / 避免耦合宿主实现细节）
             对 (II) **同样成立** ⇒ 二者应**同待遇**。
     (II) —— ⚠️ 但当前 §5.4 规则 7 的「组 A」**依赖 (II)**（`runtime_status.decision_date` 即 (II)）
             ⇒ 若 (II) 判为 host-local，则 §5.4 规则 7 **无来源可比** ⇒ 必须同步处置（§4.4）。
```

### 4.4 ★ §3.1「双日期双组」在改绑后的四条备选（⛔ 不选边，逐条给代价）

现行 §5.4 规则 7（组 A）：`portfolio_snapshot.snapshot_date == runtime_status.decision_date`。
在 ①b 下 `portfolio_snapshot` **不再是主读源** ⇒ 组 A 需要重定义。四条路径：

| 备选 | 定义 | 实读判定 | ✅ 好处 | ⛔ 代价 |
|---|---|---|---|---|
| **B-α** run 内自洽 | `candidate_portfolio.snapshot_date == manifest.expected_trade_date` | **PASS**（两者同源 = snapshotDate） | 不会误杀 | ⚠️ **近似恒真的门** —— 两侧同源，**不提供独立信息**，治理上等于**放弃组 A 的校验能力** |
| **B-β** 跨源（保留旧形） | `candidate_portfolio.snapshot_date == runtime_status.decision_date` | **今日 PASS**（10-01 = 10-01） | 保留跨源校验 | ⚠️ `runtime_status` 是**单例（最后写入者）** ⇒ 一旦被更新的 run 覆盖，**历史 run 的组 A 立即翻 FAIL** ⇒ **校验结果随时间变化、不可复现** |
| **B-γ** 对日历 | `candidate_portfolio.snapshot_date == run_integrity.expected_trade_date`（日历） | **FAIL**（10-01 vs 09-30） | 语义最"正确" | ⛔ **结构性误杀每一条**（运行日 ≠ 交易日是正常态）—— 与 §5.4 ⚠️「四日期全等」同类错误的新变体 |
| **B-δ** 代理化 | 不判日期相等，改判 `manifest.validation_passed === true` 作为「run 内日期自洽」的代理 | 10-01 = **FAIL**；09-30 = PASS | 不引入误杀、不引入时间依赖 | ⚠️ 把判据**委派给生产代码**（与 §3.5「避免耦合宿主实现细节」的意图**反向**）；且门 2 本身受 H-1 影响 |

```text
★ 本步的**分析性**观察（非推荐）：四条路径的代价分别落在不同侧面 ——
   B-α 放弃信息、B-β 引入时间依赖、B-γ 结构性误杀、B-δ 反向耦合。
   若 Owner 倾向 ①b，**组 A 的设计本身就是一个独立待裁项**（B-2°），
   而它**不能**沿用现文本的形态（现形态的两侧在 ①b 下都不是主读源）。
```

### 4.5 (I) RUN IDENTITY 的必要性（实测必要性，不是设计偏好）

```text
实测：两个 run 的 candidate decision_date **均为 2026-09-30**
      run_candidate_decision total = 10 行 = 2 run × 5 code
⇒ 若 sample identity 仅用 (date, code)：
     engine:2026-09-30:…(513310) 与 engine:2026-10-01:…(513310) **键碰撞**
⇒ 必须显式引入 run 维度。

连带影响：§5.5「同一 decision_date 至多一个正式 bundle」**预设 decision_date 是唯一键**；
          该预设**在本例已不成立** ⇒ §5.5 须配套修订（属 C-2°）。
```

### 4.6 B 组待裁项

| 编号 | 待裁问题 | 判据信息 | 备注 |
|---|---|---|---|
| **B-1°** | S-PROMOTED 是否要求 `promoted && read_after_write_consistent` **双条件**？ | 09-30 run 两项均 true；10-01 run `read_after_write_consistent = null`（未走到该步） | 这是一条**可加固**的判据，代价是更严 ⇒ 供给更少 |
| **B-2°** | 组 A 采用 B-α / B-β / B-γ / B-δ 中的哪一种？ | §4.4 四行代价 | **依赖 A 组裁定**（A 未定则无从定组 A 的两侧） |
| **B-3°** | (II) 与 (IV) 是否**同判 host-local**（不进契约）？ | §4.3；§3.5 已对 (IV) 有此结论 | 若 (II) 也 host-local，则 §5.4 规则 7 **必须**同时处置 |

---
---

# 第三部分 · 交叉约束与治理定位

## 5. A × B 交叉约束矩阵（选择的连带性）

| 若选 | 则 B 组被约束为 | 原因 |
|---|---|---|
| **S-PROMOTED** | 组 A **不能**用 B-β（单例时间依赖），**不能**用 B-γ（结构性误杀）⇒ 实际只剩 B-α / B-δ | `candidate_portfolio` 与 `manifest` 同源；(II) ≠ (IV) |
| **S-VALIDATED** | 组 A 与 S-PROMOTED 同（两侧均取自同一 run） | 同上 |
| **S-LATEST** | 组 A 可用 B-β（`runtime_status` 与"最新 run"通常同期），但**需自建 run 择取规则** | `F-13` 键碰撞 + `LATEST_BY_UPDATED_AT` 反模式 |
| **B-3° 判 (II) host-local** | ⇒ 组 A **失去**现有形态；**必须**先落 B-2° | 规则 7 两侧之一消失 |
| **B-2° 选 B-δ** | ⇒ 组 A 与门 2 同源 ⇒ **H-1 直接影响组 A**（风险传导） | 代理判据共享同一失效模式 |

**⇒ 裁定不是 10 个独立开关，而是有依赖顺序的树**（见 §8.2）。

## 6. 三轴定位（⛔ 不得混为一谈）

| 轴 | 内容 | 当前状态（as-of 2026-10-02） | A/B 裁定能否改变这一轴？ |
|---|---|---|---|
| **轴 1** | **契约可冻结性** | v4 现文本：§12 第 2–8 项已闭合；第 1 项（冻结授权）与第 9 项（activation-ready）属**冻结行为自身**的循环式未闭合。**文本层不存在自相矛盾** | ⛔ **不能**。除非裁定"改版"（那属于 CONTRACT GENERATION，不是冻结） |
| **轴 2** | **Evidence 可执行性** | ① 现文本下：规则 5 + 规则 7 **双 FAIL** ⇒ `BUNDLE_INVALID`；② 三 selector 今日**均 0 样本**；③ **另有独立排除原因**：§4.2-1 `gen1_counterfactual_canary_active = false` | ⚠️ **部分**：A/B 选择能改变 ①；**不能**改变 ③（属生产 health/canary 轴） |
| **轴 3** | **生产读写链健康** | R-a：门 2 `mixed_date_detected`（10-01）；R-b：门 1 `CASE_B_PARTIAL_STALE`（10-02）；reader migration 未接线（`RUN_HISTORY_INDEX = PENDING`、`V365_ENFORCE_SWITCH_DATE = null`，`v365-active-read.js` 的 reader API 生产侧**零 import**） | ⛔ **完全不能** |

```text
★ 必须分开陈述的三句（⛔ 合成一句即为治理错误）：
   ① 「v4 契约可以冻结」              —— 轴 1 命题（今日为真）
   ② 「Evidence 尚不能产出样本」      —— 轴 2 命题（今日为真，且至少 3 个独立原因）
   ③ 「生产读写链尚未就绪」          —— 轴 3 命题（今日为真，与契约无关）
```

## 7. 「冻结后必然无法满足」复核（按选项组合）

| 选项组合 | §3 字段 1（`decision_result.decision_date`） | §3 字段 3（regime） | §3 字段 4/7/8 | §5.4 规则 5 | §5.4 规则 7 | 判定 |
|---|---|---|---|---|---|---|
| **①a**（保持绑 legacy） | ✅ 字段存在但**不更新** | ⚠️ 字段**已停写**（41 行，7/41 有键） | ⚠️ **已停写** | ❌ **FAIL**（09-29 vs 09-30） | ❌ **FAIL**（09-30 vs 10-01） | **冻结后必然无法满足** |
| **①c**（现状冻结 + 解耦） | 同 ①a | 同 ①a | 同 ①a | ❌ 同 | ❌ 同 | **同一组硬条件，仅重分类为 activation precondition** |
| **①b + S-PROMOTED + B-α** | ✅（candidate，已在位） | ✅（candidate `crisis`，已在位） | ✅（已在位） | ✅ **PASS**（candidate 09-30 == ml_shadow 09-30） | ⚠️ B-α ⇒ 近似恒真（**PASS 但信息量低**） | **文本可满足**；但供给受门 1/2/3 约束（H-1） |
| **①b + S-PROMOTED + B-β** | 同上 | 同上 | 同上 | ✅ | ⚠️ **时间依赖**（今日 PASS，可能随下次 run 翻 FAIL） | 可满足但**判据不稳定** |
| **①b + S-VALIDATED + B-α** | 同上 | 同上 | 同上 | ✅ | ⚠️ 同 B-α | **文本可满足**；门 3 未设防 |

**⇒ 精确表述（建议 Owner 采纳的措辞骨架）：**

```text
①a / ①c：存在「冻结后必然无法满足」的硬条件（3 条），且**不因时间推移自愈**（两集合已停写）。
①b     ：**不**存在"必然无法满足"的硬条件（字段均已产生、实读在位）；
         但存在**供给条件**（门 1/2/3 + H-1）—— 属**可执行性**问题，**非**契约文本缺陷。
         其中组 A 的设计（B-2°）若选 B-β，会把"可满足性"变为"**时间依赖的可满足性**"。
```

## 8. 交付给 Owner 的裁定入口

### 8.1 最小契约改动面（**仅在 ①b 分支下**，⛔ 本步不实施）

```text
必须改（docs-only）：
  §3        字段表 1（date 来源）/ 3（regime 来源）/ 4 / 7 / 8
  §3.1      改绑 + 「双日期双组」重定义 + 新增 (I) run identity
  §3.5      澄清两个 expected_trade_date 的名实不符（或按 §4.3 处置 (II)）
  §5.3      五源清单（2 源改绑；是否新增 manifest / pointer 见 C-1°）
  §5.4      规则 3 / 4 / 5 / 7 重定义；规则 1 / 2 是否改按 pointer revision（C-2°）
  §5.5      叠加 run identity（防同 decision_date 多 run）
  §9.1      来源表
  §11       变更日志（写明"是否作废既有样本" = 实测 **0 行**）
必须同步（仓库外脚本）：
  _evidence-capture-tool/c1_capture.py（现硬编码 contract_version="v3.0" /
                                        contract_path="…_V2.md" / v3.0 双指纹）

⛔ 不改：§2（主对比对象）/ §3.2 / §3.3 / §3.4 / §4 / §6 / §7 / §8 / §10 / §13
⛔ 不触及：生产代码 / 配置 / DB / Authority / Seal / lock / immutable_set
⚠️ 性质：属 §11 元规则下的**实质性修正** ⇒ 取代 v4.0 DRAFT 对象 ⇒ 须**新 CONTRACT GENERATION 授权**（本步不授权）
```

### 8.2 裁定依赖图（建议顺序，⛔ 不预设结论）

```text
第 1 层（今日即可裁定，无前置）
  B-3°  (II)/(IV) 是否同判 host-local
  C-1°  五源是否新增 manifest / pointer
  A-1   观察对象 = 生产「决定」还是「计算」

第 2 层（依赖第 1 层）
  A-2 / A-3   是否接受供给被生产健康度阻断 / 是否采用 S-VALIDATED
  B-1°        是否要求 promoted && read_after_write_consistent 双条件

第 3 层（依赖 A 层）
  B-2°        组 A 采用 B-α / B-β / B-γ / B-δ
  C-2°        §5.4 规则 1/2 是否改按 pointer revision

第 4 层（依赖 1–3 层全部）
  D-1°        是否为 ①b 开新一轮 CONTRACT GENERATION 授权 + 仓库写授权
  D-2°        F-11（manifest.expected_trade_date 名实不符）是否单独立项
```

> ⚠️ **B-2° 不能与 A 层同时裁定**：A 未定 ⇒ 组 A 的两侧字段未定 ⇒ 四条备选无法评估。
> ⚠️ **D-1° 不宜早裁**：若在 A/B 未定前开生成授权，会产生一份**对不上 selector 的草案**。

---
---

# 第四部分 · 登记、元数据与断言

## 9. 本步新登记观察项（非阻塞；⛔ 本步均未处理）

| 编号 | 内容 | 为何值得登记 |
|---|---|---|
| **F-18** | `run_manifest.input_hash` 实读为 `engine:engine:2026-10-01:b1790812813101` —— 即 `'engine:' + run_id` 而 `run_id` 自身已含 `engine:` 前缀 ⇒ **双重前缀** | 若契约/工具以 `input_hash == run_id` 取值会静默不命中；Evidence 若用它做去重键需先归一 |
| **F-19** | `runtime_status.v365_run_integrity` 的 `caller_function` / `caller_request_id` / `pipeline_origin` / `pipeline_run_id` **全为 `null`** | ⇒ **不能**用 run_integrity 充当 §5.6 的 CHAIN PROOF；来源证明仍须**外部 CLS 取证**（与 §5.6 现文本一致，但需显式登记"结构性为 null"） |
| **F-20** | `run_integrity` 同时含 `obs_001_correlated = false` / `obs_001_shape = false` / **`obs_001_manual_reconstruction_required = 1`** | 含义本步未核实；若它与 Evidence eligibility 有关，须单独立项 |
| **F-21** | `run_integrity.publishable = true` 而 `runtime_status.v365_authoritative_publish_status = NOT_PROMOTED` 并存 | 二者属**不同层级**（前者 = 输入/上下文层可发布；后者 = 提升层结果）⇒ ⛔ 不得合并成"不可发布" |
| **F-22** | `run_candidate_portfolio` 同时含 `decision_market_regime = crisis` 与 `market_regime = defensive`，且 `market_regime_divergent = true` | CD-02 remedy 字段**已在 candidate 层产生** ⇒ 支撑 ①b 可行性 |
| **F-23** | `active_run_pointer.promoted_from_run_id = null` / `run_history.promoted_from_pointer_run_id = null` / `supersedes_run_id = null` / `same_trade_date_supersede = false` | 09-30 属 **bootstrap 提升**（非替换）⇒ 后续"替换"路径**从未演练** |

## 10. 与前序登记项的关系（不重复展开）

- **`F-11` / `F-12`**（名实不符）—— 本步 §4.2 给出其**治理含义**（门 2 判据错配）。
- **`F-13`**（同 decision_date 多 run）—— 本步 §3.7 / §4.5 证明其**必然触发**。
- **`F-14` / `F-17`** —— 本步 §3.5 / §3.7 给出其在 A 组裁定中的定位。
- ⛔ 本步**未**处理 `E-2` / `E-3` / `E-4` / `E-5`（Owner 未授权）。

## 11. 交付元数据与写后断言

### 11.1 交付元数据

| 报告路径 | `outputs/evidence-watch-20260921/GEN1_STEP11_E1B_AB_GOVERNANCE_RULING_ANALYSIS_20261002.md` |
| 文件大小（本文件） | **34616 B** |
| 行数（本文件） | **514 行**（LF） |
| 换行 | LF（`crlf = 0`） |
| SHA256 | **见本步交付注记**（⛔ 文件无法自含自身哈希） |
| 写后断言 | **POS 67/67 PASS ／ NEG 16/16 零命中**（见 §11.2） |

### 11.2 写后内容断言（POS）与零命中反向断言（NEG）

**POS**（67 条关键串必须命中）：**67/67 PASS**
**NEG**（16 条禁语必须零命中）：**16/16 零命中**

> 断言口径：对报告全文做子串匹配；POS 缺失项 / NEG 命中项任一非空即视为失败
> （失败须先分辨「断言写错」与「未落盘」）。

---

## 12. Git / Production / DB 零修改断言（四块式）

```text
ETF 仓库（-gen1 worktree @ 2e24ecd）：
- Git 跟踪文件：零修改（本步未编辑任何跟踪文件；git diff --stat HEAD 仅保留既有披露项）
- Git 历史 / 分支 / 远端：零修改（未 commit / push / PR / merge / deploy / freeze）
- 未跟踪本地草稿：本报告 1 份新增
    outputs/evidence-watch-20260921/GEN1_STEP11_E1B_AB_GOVERNANCE_RULING_ANALYSIS_20261002.md
    （outputs/ 命中 .gitignore:8 ⇒ 不入库）
- ⛔ `_v4-contract-20260923` worktree 内零改动（tracked status 仍为空）
- 既有状态披露（非本步所为）：` M docs/gen1/GEN1_DOC_ERRATA_20260916.md`（mtime 2026-09-21）
  及未跟踪 `?? .workbuddy-ai/` / `?? docs/gen1/GEN1_EVIDENCE_CONTRACT_V2.md`

其他本机文件：
- .workbuddy/memory/2026-10-02.md 追加本 Step 记录（append-only）
- .workbuddy/memory/automations/21a753d4-8ebb-4a6f-9353-cf59e51a90c6/memory.md 追加摘要

生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- Evidence Contract v1.0 / v3.0 / v4.0：零字节修改（v4 工作区 sha256 与上一步逐位一致）
- DB 集合（decision_result / portfolio_snapshot / ml_shadow_signal / runtime_status /
  run_candidate_decision / run_candidate_portfolio / run_manifest / run_history /
  active_run_pointer）：**只读，写命令数 = 0**
- 未调用云函数 / 未触发 automation / 未做 reader migration / PR #60 body 零修改
```

---

## 13. STOP-AND-REPORT

```text
本步状态：STEP 1.1-E1b-AB = PASS（只读；本步 DB 写命令数 = 0）

⛔ 未选 ①a / ①b / ①c
⛔ 未选 selector（S-LATEST / S-VALIDATED / S-PROMOTED 三者均未选）
⛔ 未选组 A 设计（B-α / B-β / B-γ / B-δ 四条均未选）
⛔ 未改契约 / 未生成新契约 / 未改脚本 / 未改 PR #60
⛔ 未改生产链 / 未做 reader migration / 未冻结
⛔ 未处理 E-2 / E-3 / E-4 / E-5
⛔ 未进入 Step 1.2 / PHASE 2 / PHASE 3

WAIT FOR OWNER RULING
  (A) A-1 / A-2 / A-3
  (B) B-1° / B-2° / B-3°
  (C) C-1° / C-2°
  (D) D-1° / D-2°
```

**本步唯一的"新事实"对裁定的影响（三句）**：

1. **门 1 与门 2 在最近两次 ENFORCE 自然运行上各自失败** ⇒ 「今日 0 样本」不是一个原因，修复路径分属两层；
2. **H-1（08:00 运行下门 2 可能结构性不可满足）已登记假设 + 证伪条件** ⇒ 选 S-PROMOTED / S-VALIDATED 时，它是一个**冻结时就应知情的供给代价**；
3. **组 A 的四条备选各有一侧代价，且没有一条能沿用现文本形态** ⇒ B-2° 是 ①b 分支下**不可省**的独立待裁项。
