# Gen-2 规则实现修正记录（WP-G2-06 / F4 · 裁决 2026-09-14）

日期：2026-09-14 · 执行者：WorkBuddy Agent
关联：PR #29（`feat/gen2-wp-g2-06-tree`）· `fixtures/gen2/golden_scenarios_v1.json`（G2S-10）
· `ml/gen2/reports/gen2_wp_g2_06_impl_20260914.md`（实现说明）· `ml/gen2/reports/gen2_rule_impl_correction_20260911.md`（前一次修正）

---

## 1. 裁决（用户 2026-09-14）

> **PR #29 暂不合并。** F4 还没有真正进入线上 Gen-2 决策链。

核心证据：`runGen2ShadowEod.main()` 仍调用旧链路

```js
buildDailyRoles(features)
→ buildPortfolioCandidates(roles)   // 仍是 1/n 等权
→ applyDefense(...)
```

而 PR #29 新增的 `buildCandidatePortfolio()` 只被 `_internal` / G2S-10 调用，**没有被 `main()` 消费**。
→ **300/300 parity 证明的是新 seam，不是线上 Shadow 实际发布的候选组合**。这正是此前要避免的「修复未进入决策链」。

裁决同时点名三处实现缺口（缺口 ①②③），并要求补完后再审、验收标准逐条给出（见 §3）。

## 2. 根因

`build_portfolio_candidates` / `buildCandidatePortfolio` 作为**新 seam** 被建好并通过跨端对表，
但**消费方（`main()`）没有改接**；同时「研究路径」与「权威路径」在 seam 之外仍各算一套权重。
**seam 级 parity 无法发现「消费方没接线」** —— 这是本次修正的根本教训，也是新增端到端回归的原因（§5）。

## 3. 改动（规则实现，非阈值）

**阈值、bundle 参数、universe、角色阈值均未改动。**

### 3.1 `main()` 改接唯一链路（进入决策链）

| 文件 | 改动 |
|---|---|
| `cloudfunctions/runGen2ShadowEod/index.js` | 新增 **`buildCandidatePanel(features, latestDate, benchmarkFeatures)`** —— *唯一*候选面板构建：`buildDailyRoles → 当日横截面 → priorityFromUnroundedScore → attachAuthoritativeWeights → buildCandidatePortfolio`。`main()` **只调它**；`main()` 中旧 `buildPortfolioCandidates()` / `applyDefense()` **已无消费者** |
| 同上 | 新增 **`computeFeatureFrame(barsByCode, codes)`** —— 特征帧构建（`main()` 与端到端回归**共用同一实现**，回归可从原始 bars 完整重放） |
| 同上 | 新增 **`toBenchmarkRows(benchmarkFeatures)`** —— benchmark 帧字段名适配（缺口 ⑤，见 §4.5） |
| 同上 | `exports._internal` 增 `buildCandidatePanel / computeFeatureFrame / toBenchmarkRows` |

抽取动机：把整条链路收敛到**具名函数**，使「线上决策链」与「端到端回归断言」走**同一段代码**；
一旦 `main()` 退回旧链路，`buildCandidatePanel` 即被绕过 → 回归立刻变红。

### 3.2 三类记录发布契约（现金腿不进排名校验）

| 记录 | 内容 | 校验 |
|---|---|---|
| `gen2_ranking` | **只承载 30 条 ETF 排名** | `validatePublishResults()`：唯一 code + alpha 有限 |
| `gen2_candidate_leg`（**新增**） | **30 ETF + 现金腿 = 31 条**；带 `priority / priority_score / priority_source / priority_hash / config_hash / defense_state / sleeve`；**绝不写 `final_target`** | `validateCandidateLegPublish()`：逐日守恒 / 单只·cluster·科技上限 / 防守腿权重 / priority 稠密 1..n 且现金 n+1 / hash 存在 / sleeve 归属 / 无 `final_target` |

* 现金腿**不塞进** `gen2_ranking`：现金没有 alpha，`validatePublishResults()`（要求 alpha 有限）会把它判失败；
* **两类记录都通过校验**才把 run 标 `completed`（run 文档带 `written` + `leg_written`）；任一失败 → `blocked`（`PUBLISH_VALIDATION_FAILED` / `CANDIDATE_LEG_PUBLISH_FAILED`）。

### 3.3 priority 严格集合校验（缺口 ③）

`assertPriorityExactCoverage()`（JS）/ `_validate_priority_exact_coverage()`（Python）
**先于** `priority_hash()` 执行 —— 缺、多、重复、非有限**一律失败**：

```text
EXTRA_DATE → MISSING_DATE → ROLES_DUPLICATE → PRIORITY_MISSING → EXTRA_CODE → MISSING_CODE
→ PRIORITY_NOT_FINITE → WEIGHT_NOT_FINITE → CAP_*（NON_FINITE → SINGLE → CLUSTER → TECH → DAY_SUM）
→ PRE_DEFENSE 复核 → 防守 → POST_DEFENSE 复核
```

**两端检查顺序逐条对齐**（否则同一非法输入得到不同错误码 → 产生未定位差异）；
跨端只比对**稳定错误码**（`CANDIDATE_*`），不比对自由文本。

## 4. 五处缺口修复

| # | 缺口 | 修复 |
|---|---|---|
| ① | Python `_assert_caps()` 定义了 `max_tech_weight` / `tech_clusters`，但**没有实际检查**广义科技合计 | `_assert_caps()` 补实际检查：`core[cluster ∈ tech_clusters]` 按日求和，越界抛 `CANDIDATE_CAP_TECH_BREACHED` |
| ② | 防守处理后**两端都没有**重新验证单只 / cluster / 科技上限；`hedge_weight` 配置过大时可越界 | `_assert_caps(out, pcfg, phase)` / `assertCandidateCaps(items, pcfg, phase)` 增 `phase`；`PRE_DEFENSE` + **`POST_DEFENSE`** 双阶段复核（两端都有） |
| ③ | priority 只校验「缺少」，不拒绝**多余** date/code → 多余且未消费的分数进入 `priority_hash`，造成不可见输入影响 provenance | §3.3 严格集合校验（先于 hash） |
| ④ | **Python `build_portfolio_candidates` 没有 `defense_config` 参数** → runner 注入的防守配置被**静默忽略**，退化成读 `gen2.yaml`（0.15）；现有正例恰因配置一致而「蒙对」 | 新增 `defense_config` 参数（deepcopy config 后写入 `config["portfolio"]["defense"]` 再传 `apply_regime_defense`）；runner 同步传参 |
| ⑤ | **JS `main()` 把原始 benchmark 帧（内部名 `px_ma20` / `px_ma60`）传给 seam**，而防守 regime 读**公开名** `benchmark_px_ma20` / `benchmark_px_ma60` → `hasMa` 恒 `false` → **regime 恒 NORMAL → 防守腿线上永不触发**（静默失效） | 新增 `toBenchmarkRows()` 显式适配（JS）；Python `_benchmark_series()` 同步适配。两条链路共用，不可能再各喂一套 |

> 缺口 ④/⑤ 是**本轮回合自证发现**（④ 由 `hedge_oversize_post_defense` 双端错误码不一致暴露；⑤ 由端到端回归发现 —— 详见 §5）。
> 缺口 ⑤ 的性质与本次裁决同源：**fixture seam 自带公开名，所以跨端 parity 全绿也发现不了线上路径喂的是内部名。**

## 5. 端到端回归（新增门禁）

`tests/gen2-candidate-leg-e2e.test.js` —— 用**内存 DB 驱动真实 `main()`**，特意构造：

* **非等权**角色权重（期望 CORE = 2×`tech_hardware` + 2×`software_ai` + 1×`healthcare`；
  科技合计 0.80 > 上限 0.65 → 收紧到 0.1625×4，`healthcare` 保持 0.20 → 非等权）；
* **分数排序 ≠ 权重排序**（`priority = 1` 的 CORE 权重 0.1625 < 另一只 CORE 的 0.20）。

**三级一致性（任一级断裂即红）**：

```text
① main() 实际写库的 gen2_candidate_leg
== ② 从原始 bars 独立重放 computeFeatureFrame → buildCandidatePanel
== ③ G2S-10 seam buildCandidatePortfolio(...)   ← handler 调用的那个函数
```

另含：`gen2_ranking = 30` 条且不含现金；`gen2_candidate_leg = 31` 条；
`priority_source ∈ {INJECTED_SELECTION_SCORE, RESIDUAL_CASH_LEG}`；`sleeve = GEN2_CANDIDATE`；
**无 `final_target`**；逐日守恒；priority 稠密 1..31；单只/cluster/科技上限；`priority_hash` / `config_hash` 一致。

**场景 B（RISK_OFF）**：benchmark 急跌 → 同一构造下防守腿必须经 `main()` 落库
（`defense_state = RISK_OFF`、防守腿权重 = 0.15、非防守腿按 `exposure_scale − hedge_weight = 0.35` 缩仓）。

**源码级断言**：`main()` 函数体内不得再出现 `buildPortfolioCandidates(` / `applyDefense(`（注释已剔除后检查），
且必须出现 `buildCandidatePanel(`。

## 6. 回归证据

| 证据 | 结果 |
|---|---|
| 端到端（真实 `main()` 注入 DB） | `tests/gen2-candidate-leg-e2e.test.js` **57 通过 / 0 失败**（NORMAL + RISK_OFF 双场景） |
| 跨端逐日对表 | G2S-10 **13 case 双端错误码 13/13 一致**；全场景不变量 **326/326**；**未定位差异 0** → 门禁 **PASS** |
| JS 单测 | `tests/gen2-selection-scores.test.js` **55/0** · `tests/gen2-gate.test.js` **34/0** |
| Python 单测 | `ml/gen2/tests/test_wp_g2_06_portfolio.py` **35/35** · `unittest discover ml/gen2/tests` **190/190** |
| 全量（JS） | `node scripts/test-all.js`：**Stage A 36/36 文件** · **汇总 43/43 项通过 / 0 失败**（含 Stage D 跨语言 parity 360 行 PASS） |

G2S-10 新增 **11 条负例**（2 正例 + 11 负例），逐条对应稳定错误码：

```text
priority_extra_code              → CANDIDATE_PRIORITY_EXTRA_CODE
priority_missing_code            → CANDIDATE_PRIORITY_MISSING_CODE
priority_extra_date              → CANDIDATE_PRIORITY_EXTRA_DATE
priority_missing_date            → CANDIDATE_PRIORITY_MISSING_DATE
priority_not_finite              → CANDIDATE_PRIORITY_NOT_FINITE
priority_absent                  → CANDIDATE_PRIORITY_MISSING
roles_duplicate_key              → CANDIDATE_ROLES_DUPLICATE
cap_single_breach                → CANDIDATE_CAP_SINGLE_BREACHED
cap_cluster_breach               → CANDIDATE_CAP_CLUSTER_BREACHED
cap_tech_breach                  → CANDIDATE_CAP_TECH_BREACHED          ← 缺口 ① 的直接证据
hedge_oversize_post_defense      → CANDIDATE_CAP_SINGLE_BREACHED       ← 缺口 ② 的直接证据
```

`notes` 说明（固化在夹具）：
* `cap_tech_breach`：`tech_hardware` 0.40 + `software_ai` 0.40 = 0.80 > 0.65，**各 cluster 均不越界** → 只能靠广义科技合计检查抓到；
* `hedge_oversize_post_defense`：防守**前**权重全部合规，只有防守腿注入 **0.90**（> 单只上限 0.25）后才越界 → 只有 **POST_DEFENSE** 复核能抓到。

## 7. 这是语义变更，不是重构

线上 Shadow 实际发布的候选权重语义发生变化：

* 候选权重由 **1/n 等权** → **角色层权威 `target_weight` + 上限复核**（越界抛错，绝不静默缩、更不重置为等权）；
* `priority` 由 **legacy leadership rank** → **显式注入的未四舍五入 selection score**（`features.alpha_score_v2`，
  刻意绕过 `buildDailyRoles` 输出的 2 位四舍五入）；
* 候选记录**新增现金腿与防守腿**（`gen2_candidate_leg`）；
* **防守腿从「线上静默失效」恢复为按 regime 生效**（缺口 ⑤）。

因此：

* `GEN2_RULE_V2_BUNDLE` / `GEN2_RULE_V2_LOCK` 需在 **WP-G2-04 重新生成**（新 `bundle_version` + 新 lock，旧锁保留作审计基线）；
* **B1 账本重算与 B3 Frozen OOS 必须使用修正后的规则**；修正前的 OOS / 经济指标只作**研发证据**，不作为当前实现的资格证据。

## 8. 状态与后续

* 继续保持 **Shadow / CANARY**、**`blocked / RULE_BUNDLE_INCOMPLETE`**；**不部署、不提升 authority、不写正式仓位**；
* **B3 通过前所有经济指标只作研发证据**；
* 顺序：**PR #29 补完并过审 → WP-G2-04 重新冻结 bundle/lock → B1 重算 → B3 Frozen OOS**。

## 9. 回滚口径

改动集中在：`cloudfunctions/runGen2ShadowEod/index.js`、`ml/gen2/portfolio/portfolio_builder.py`、
`ml/gen2/portfolio/defense_gate.py`、`fixtures/gen2/golden_scenarios_v1.json`、
`scripts/parity/run_gen2_scenarios{,_node}.py|js`、`ml/gen2/tests/*`、`tests/gen2-candidate-leg-e2e.test.js`。

* **无部署、无线上写入、无正式仓位**；回滚 = 回到 PR #29 之前的 commit（Shadow 仍为 `blocked`，前台只展示 V3.6.1）；
* 回滚后**必须同时撤回**本记录的资格表述：修正前的候选权重语义与纪律不再适用。
