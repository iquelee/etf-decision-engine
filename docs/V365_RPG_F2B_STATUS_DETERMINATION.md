# V3.6.5 RPG-F2-B —— 正式状态裁定

> **文档性质**：状态裁定（determination），⛔ 不改变任何协议 anchor，⛔ 不扩大归因 taxonomy。
> **裁定日期**：2026-09-29
> **HEAD SHA**：`c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
> **owner 授权**：`OWNER_REPLAY_INFRA_AUTHORIZED = true` · `authorization_sha = c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
> **关联文档**：`docs/V365_RPG_F2B_REPLAY_INFRA_CHANGE_RECORD.md` · `docs/V365_RPG_F2B_ACTUAL_COVERAGE_AUDIT.md`

---

## 0. 核心裁定（一句话）

```
RPG-F2-B = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-002  = NOT YET CLOSED
PRODUCTION_PATH_PARITY = PRODUCTION_PATH_PARITY_VERIFIED_ON_OBSERVED_POINTS
FULL_WINDOW_PRODUCTION_FIDELITY = NOT CLAIMED
```

⛔ **不得**把本裁定表述为 `COMPLETE`；⛔ **不得**把 4/4 parity 自动外推为 full-window fidelity。

---

## 1. 为什么是 PARTIAL 而不是 COMPLETE

owner 裁定的判据链是**窗口覆盖**，不是**语义正确性**：

| 判据 | 要求 | 实测 | 结论 |
|---|---|---|---|
| **语义正确性** | actual execution ledger 必须来自受治理 `trade_log`（⛔ 非 decision-implied） | ✅ 账本 == governed trade_log，12 条三元组逐一致 | **PASS** |
| **生产路径保真** | replay cooldown 必须复用生产 `computeCooldownDays()` 且数值一致 | ✅ 4/4 观测点精确一致 | **PASS** |
| **窗口覆盖** | replay window `2026-08-01 → 2026-09-22` 全程须有 actual execution 可依赖 | ❌ 窗口前段 9 个交易日**无任何 actual execution 记录** | **FAIL** |

⇒ **前两项 PASS，第三项 FAIL** ⇒ 综合裁定 = `PARTIAL`。

**为什么覆盖不足不能被语义正确性"抵消"**：

`2026-08-03 → 2026-08-13` 这 9 个交易日内，生产 `computeCooldownDays()` 走的是
「`TRADE_LOG` 无 `buy` 命中 ⇒ `return 0`」这条**分支**。该分支虽是**真实生产分支**，
但它**不是 cooldown 闸门的"被行使"分支** —— 闸门恒 `ok`，`finalAction` 不受 cooldown 约束。

⇒ 这 9 天对「**cooldown 闸门在 production-faithful 输入下如何影响决策**」这一命题
**零证明力**。它们是**结构性盲区**，不是"碰巧没触发"。

---

## 2. `PRODUCTION_PATH_PARITY_VERIFIED_ON_OBSERVED_POINTS` 的精确含义

**允许的说法**（有证据）：

> 在 4 个**观测点**上，用 governed actual execution ledger + governed historical
> `decision_result.add_mode` 复算的 cooldown 与生产 `decision_result.cooldown_days`
> **精确一致（4/4）** ⇒ 生产 cooldown 计算路径在**这 4 个点**上是可复现的。

| 观测点 | 标的 | 复算 cooldown | 生产 cooldown | 一致 |
|---|---|---|---|---|
| 2026-08-14 | 513310 | 3 | 3 | ✅ |
| 2026-08-19 | 513310 | 3 | 3 | ✅ |
| 2026-08-24 | 159582 | 3 | 3 | ✅ |
| 2026-08-28 | 159582 | 3 | 3 | ✅ |

**⛔ 不允许的说法**（无证据）：

- ❌ "replay cooldown 已与生产完全保真"
- ❌ "full-window production fidelity verified"
- ❌ "RPG-F2-B 已 COMPLETE"
- ❌ "RPG-002 已 CLOSED"

**理由**：4 个点**全部**落在 `2026-08-14` 之后，且**全部**是 `cooldown_days = 3`
（即 `add_mode = '无'` ⇒ 取 `params.cooldown_days`）**同一分支**。
⇒ 观测面**既不覆盖窗口前段，也不覆盖 `突破加仓`(5) / 其它非`无`(2) 两个分支**。
以 4 个同分支样本外推全窗口 = **过度声明**。

---

## 3. 当前双分支协议矩阵（冻结）

| 协议 | `production_fidelity` | `qualification_authoritative` | `ledger_source` | anchor |
|---|---|---|---|---|
| `RFP-V1` | — （legacy） | — | — | `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723` |
| `RFP-V2-CF` | false | false | — | `b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832` |
| `RFP-V2-CF-COOLDOWN` | **false** | **false** | `SYNTHETIC_COUNTERFACTUAL_DECISION_IMPLIED` | `0db3193b297d2900aa1b32e359bbe80b80bfbf7a5b10ce0bba17a32f41dbe4f5` |
| `RFP-V2-AE` | **false（尚不成立）** | **false（尚不成立）** | `GOVERNED_ACTUAL_EXECUTION` | `5c8fb4ae7223abdc4edb9ba8267c2043d4dd22d6688e000415e1a4f1339b661d` |
| `RFP-V2-PH` | — （未建） | — | — | — |

> ⚠️ `RFP-V2-AE` 的 `ledger_source` **正确**（受治理实际执行），
> 但因其覆盖窗口不完整 ⇒ `production_fidelity` / `qualification_authoritative`
> **当前一律保持 `false`**，⛔ 不得因"语义正确"而提前置 `true`。

**V1 / V2-CF anchor 逐位不变** —— 已由 `tests/v365-rpg-f2b.test.js` B-01 / B-02 锁定。
**Counterfactual 分支与 Production Historical 分支严格分离** —— 已由 B-03 / B-04 / B-05 锁定。

---

## 4. add_mode 三步链的生产真相（未见补充）

```
① trade_log.add_mode            ⇒ 受治理 13 行**全部缺失该字段**（ROWS_WITH_ADD_MODE = 0）
② decision_result(code, buyDate).add_mode
                                 ⇒ 受治理单点回查：买入日 = '无'（合法区分）
                                    3 个回查点（159570/159582/518880 @ 2026-08-15）⇒ 0 行
③ fallbackAddMode                ⇒ '' ⇒ '无' ⇒ 基数 = params.cooldown_days = 3
```

⛔ **不得**：根据当前 replay decision 猜历史 buy 的 add_mode；⛔ **不得**人工回填 `trade_log.add_mode`。

**allowlist 扩展合规**：`decision_result` 加入只读 allowlist，理由 = `REQUIRED_FOR_PRODUCTION_FIDELITY_COOLDOWN`；
`MINIMAL_POINT_LOOKUP`（7 点，⛔ 非整表导出）；client **结构性无 mutation 方法**；R-03~R-06 已重跑全 PASS。

---

## 5. RPG-F2-C / RFP-V2-PH 覆盖裁定

| 项 | 值 |
|---|---|
| `required_trade_dates` | **25**（来源：`harness.replay().axis` —— 生产交易日历真值） |
| `snapshot_available_dates` | **16** |
| `missing_trade_dates` | **9**（`2026-08-03` → `2026-08-13`） |
| `t_minus_1_candidate` | **null**（`2026-08-13` 无 snapshot） |
| `RPG-F2-C` | **`BLOCKED_ON_ACTUAL_BOOK_COVERAGE`** |
| `RFP-V2-PH_FULL_WINDOW_AVAILABLE` | **`false`** |

⛔ 硬规则（owner 裁定，全部已履行）：不得用 `suggested_position` 补 / 不得用后一天 snapshot 回推 /
不得插值 / 不得假设零仓 / 不得把 replay window 偷改成 `2026-08-14`。

### 5.1 诊断件 `RFP-V2-PH-AVAILABLE-WINDOW`（⛔ 非资格权威）

owner 授权可另建诊断件，但必须显式标注 `qualification_authoritative = false`，
且 ⛔ **绝不替代**原 qualification window。

| 字段 | 值 |
|---|---|
| `available_window_verdict` | `DIAGNOSTIC_ONLY` |
| `qualification_authoritative` | **`false`** |
| `supersedes_qualification_window` | **`false`** |
| `QUALIFICATION_WINDOW` | `2026-08-01 → 2026-09-22`（`frozen = true` · `changed_by_this_artifact = false`） |
| `RFP_V2_PH_AVAILABLE_WINDOW` | `2026-08-14 → 2026-09-22`（真子集） |

产物：`deliverables/v365-production-history/rfp-v2-ph-available-window.json`
生成器：`scripts/v365-rfp-ph-available-window.js`（只读）
测试：`tests/v365-rfp-ph-available-window.test.js`（**PH-01 ~ PH-08**）

### 5.2 ★ 方法学修正（自查发现，重要教训）

诊断件**首版**用「受治理数据自身日期」推导 `required_trade_dates` ⇒ **自我指涉**：
缺失段被自动排除在"应有"之外，`missing` 被假算成 **0**，并据此**误判**
`FULL_WINDOW_AVAILABLE = true`。

**已修**：`required` 改为取自 `harness.replay().axis`（与 `rpg-f2b-actual-coverage-audit.js` **同源**）
⇒ 恢复 `25 / 16 / 9`，与审计件**逐项一致**。

> ⚠️ **一般化教训**：**required 集合必须来自独立真值源，⛔ 绝不能从被检验数据自身推导。**
> 否则「缺失」会被自己的采样框悄悄抹掉 —— 这类错误会**静默通过**，且方向恒为「偏乐观」。

---

## 6. 门禁复跑结果（本裁定所依据）

| 门禁 | 结果 |
|---|---|
| **Stage A**（`scripts/test-all.js`，原误记为不存在的 `v365-stage-a-*`） | ✅ **70/70** |
| **Stage A~G 汇总** | ✅ **78/78，0 失败** |
| **RPG-F2-A 专项** | ✅ A-01 ~ A-10 全 PASS |
| **RPG-F2-B 专项** | ✅ B-01 ~ B-13 全 PASS |
| **RFP-V2-PH-AVAILABLE-WINDOW 专项** | ✅ PH-01 ~ PH-08 全 PASS |
| **HD12-1 分类专项** | ✅ C-01 ~ C-17 全 PASS |
| **HD12-2 授权专项** | ✅ B-01 ~ B-17 全 PASS |
| **HD12-3 zone 专项** | ✅ D-01 ~ D-10 全 PASS |
| **qualification gate** | ✅ **38/38** |
| **reader migration gate** | ✅ **8/8** |
| **immutable** | ✅ **23/23** |
| **Gen-1 pipeline lock** | ✅ **10/10** |
| **Gen-1 production gates** | ✅ **32/32** |
| **Gen-2 build artifacts** | ✅ **7/7** |
| **p12 decision parity** | ✅ `UNEXPECTED_DECISION_DELTA = 0` · anchor `25ccbfc7…1723` 逐位不变 |
| **v365 candidate manifest** | ✅ 20 文件逐字节一致 |
| **replay delta attribution** | ⚠️ exit 非零（**符合 owner 要求，fail-closed 保留**）：V2-CF-COOLDOWN UNEXPECTED=1 · V2-AE UNEXPECTED=5 |
| **final state consistency** | ⚠️ `FINAL_STATE_DOCS_CONSISTENT = false`（8 处矛盾）⇒ 需收口文档同步 |

---

## 7. 本裁定所依赖的代码变更（REPLAY_INFRA，已授权）

| 文件 | 分类 | 变更 |
|---|---|---|
| `scripts/lib/v364-replay-harness.js` | **REPLAY_INFRA** | 新增 `loadActualExecutionLedger()` / `createCooldownStubDb()`（含 DECISION_RESULT 单点回查）/ `computeReplayCooldown()`；协议集 `COOLDOWN_PROTOCOLS` / `CAP_PROTOCOLS`；`ledger_source` 输出 |
| `scripts/v365-p12-decision-parity.js` | 门禁（域外） | ① REPLAY_INFRA 文件不再被「交集」结构性判据重复拦截（改由 ④ 授权判据接管，**判据未放宽**） |
| `tests/v365-decision-classification.test.js` | 测试 | C-16 ④ 从「harness **必须**硬编码 `cooldownDays: 0`」（缺口存在时成立的**反向锁死**断言）改为「默认路径保持 0 **且** 已具备 cooldown 注入协议」 |

授权凭据：`deliverables/v365-production-history/evidence/approval-manifest-f2b.json`
（`replay_infra_review = REPLAY_INFRA_CHANGE_REVIEW_REQUIRED` · `zone_declaration = ["lifecycle_writer","telemetry"]` ·
`authorization_sha = c6bd006f…61d` 与 HEAD 逐位一致）。

**`AUTHORIZED_TO_IMPLEMENT = true` / `QUALIFICATION_AUTHORITY = false`** ——
授权代码变更 ≠ replay 已获得 qualification authority。

---

## 8. 解除 blocker 的条件（需 owner 决策）

以下任一路径可推进 `PARTIAL → COMPLETE`：

| # | 路径 | 需要的 owner 动作 |
|---|---|---|
| **A** | 生产库中确有 `2026-08-03 → 2026-08-13` 的 `buy` 记录，只是**未被导出覆盖** | 授权扩大导出窗口 / 复核分页 |
| **B** | 生产库中**确实没有**该段买记录 ⇒ 须以**冻结设计认可的起始态种子**（`T-1 starting actual book`）补足 | 冻结设计裁定"合法种子" |
| **C** | 缩小 qualification window 至 `2026-08-14 → 2026-09-22` | **owner 改变 qualification window**（硬停止条件 §10(A)） |

⛔ 三条路径**均需 owner 拍板** —— 本 agent **不得**自行选择。

---

## 9. 复现指令

```bash
cd <repo-root>

# —— 1) RPG-F2-B 专项（13 项）——
node tests/v365-rpg-f2b.test.js

# —— 2) RPG-F2-A 专项（10 项）——
node tests/v365-rpg-f2a.test.js

# —— 3) 分类 + 授权 + zone 三套专项 ——
node tests/v365-decision-classification.test.js
node tests/v365-orchestration-approval.test.js
node tests/v365-orch-zone.test.js

# —— 4) Stage A~G 全量（77 项）——
node scripts/test-all.js

# —— 5) 授权下的 parity 门禁 ——
node scripts/v365-p12-decision-parity.js \
  --changed-file deliverables/v365-production-history/evidence/changed-files-f2b.txt \
  --changed-region deliverables/v365-production-history/evidence/changed-regions-f2b.txt \
  --approval-manifest deliverables/v365-production-history/evidence/approval-manifest-f2b.json \
  --head-sha c6bd006fd76ffc5358cddd07347df8ed23d9e61d

# —— 6) 双分支归因（预期 exit 非零，fail-closed）——
node scripts/v365-replay-delta-attribution.js

# —— 7) 覆盖审计 ——
node scripts/v365-rpg-f2b-actual-coverage-audit.js

# —— 8) RFP-V2-PH-AVAILABLE-WINDOW 诊断件（⛔ 非权威）——
node scripts/v365-rfp-ph-available-window.js
node tests/v365-rfp-ph-available-window.test.js
```

---

## 10. 完成状态

| 项 | 状态 |
|---|---|
| `REPLAY_INFRA` 代码变更 | ✅ `IMPLEMENTED_LOCALLY` · `VALIDATED_EXPERIMENTALLY` · `OWNER_AUTHORIZATION = APPROVED` |
| `RFP-V1` anchor | ✅ 逐位不变 |
| `RFP-V2-CF` anchor | ✅ 逐位不变 |
| `RFP-V2-CF-COOLDOWN`（counterfactual） | ✅ 已建 · 与 actual 分支严格分离 |
| `RFP-V2-AE`（actual execution） | ✅ 语义正确（governed ledger）· ⚠️ 覆盖不完整 |
| `PRODUCTION_PATH_PARITY` | ✅ `VERIFIED_ON_OBSERVED_POINTS`（4/4） |
| `FULL_WINDOW_PRODUCTION_FIDELITY` | ⛔ **NOT CLAIMED** |
| `RPG-F2-B` | ⚠️ **PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE** |
| `RPG-F2-C` | ⛔ **BLOCKED_ON_ACTUAL_BOOK_COVERAGE** |
| `RFP-V2-PH_FULL_WINDOW_AVAILABLE` | ⛔ **false** |
| `RFP-V2-PH-AVAILABLE-WINDOW`（诊断件） | ✅ `DIAGNOSTIC_ONLY` · `qualification_authoritative = false` |
| `RPG-002` | ⚠️ **NOT YET CLOSED** |
| `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED` | ✅ `CLOSED` |
| `FREEZE_REVIEW` | `ELIGIBLE_FOR_REVIEW`（⛔ 非 READY） |
| `READY_FOR_PRODUCTION_PROMOTION` | ⛔ **不得输出** |
