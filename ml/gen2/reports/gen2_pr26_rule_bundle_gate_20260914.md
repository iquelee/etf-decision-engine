# Gen-2 PR #26 修订：撤除 JS 运行时 fallback，规则 bundle 闸门（WP-G2-05R）

日期：2026-09-14 · 执行者：WorkBuddy Agent
关联：`PR #25`（已合并，master `0fce4ad`）· `PR #26`（本修订）· `fixtures/gen2/golden_scenarios_v1.json`（G2S-09）

> **编号说明**：用户 2026-09-14 裁决的顺序表第 2 项＝「修订 PR #26（去除 JS legacy fallback + 补双端 blocked 回归）」，
> 本轮登记为 **WP-G2-05R**（不是 WP-G2-06）。**WP-G2-06 是 F4**（研究候选组合统一），排在顺序表第 3 项，尚未开工。

---

## 1. 裁决（用户 2026-09-14，两项必须先收口之一）

> **撤掉 JS 运行时 fallback。** Python 缺 `role_thresholds` 会失败，JS 却回退读 `top_quantile`，
> 违背「显式配置、禁止静默 fallback」并造成双端生产语义不一致。JS 应改为：缺失 `role_thresholds`
> → 本次运行 `blocked`，原因 `RULE_BUNDLE_INCOMPLETE`；旧字段只允许离线迁移 bundle 时读取，
> 不能进入运行路径。

额外约束：**继续保持 Shadow / CANARY，不提升 authority，不部署，不写正式仓位。**

---

## 2. 变更（文件级）

| 文件 | 改动 |
|---|---|
| `cloudfunctions/runGen2ShadowEod/index.js` | `resolveRoleThresholds()` 删除 `LEGACY_TOP_QUANTILE_AUDIT` 回退分支 → 缺失/非法一律返回 `{ok:false, gate, detail}`（**本函数不再抛错**）；新增 `RULE_BUNDLE_GATE`（非 null ⇒ 本次必须 blocked）；`main()` 在**读任何数据之前**早退 `blocked/RULE_BUNDLE_INCOMPLETE`；`failGate()` 支持显式 `status_reason`；`buildDailyRoles()` 增加 fail-closed 兜底；`PORTFOLIO_CFG.top_quantile` 移除；旧字段入口收敛到**离线迁移助手** `deriveRoleThresholdsFromLegacy()` |
| `ml/gen2/data/run_gate.py` | 新增 `evaluate_rule_bundle_gate(config)`（`RULE_BUNDLE_ROLE_THRESHOLDS_MISSING` / `_INVALID`）；`evaluate_run_gate(..., rule_bundle_config=...)` 最先执行规则闸门；模块 docstring 闸门顺序补 `-1. RULE_BUNDLE_INCOMPLETE` |
| `fixtures/gen2/golden_scenarios_v1.json` | `run_status_gate.gate_order` 前置 `RULE_BUNDLE_INCOMPLETE` 并补 rules；新增 **G2S-09**（`rule_bundle_gate`，4 case / 16 不变量，双端）；G2S-08 panel 增加 `role_thresholds_running_config`（运行配置显式声明，去掉对 JS 隐式回退的依赖） |
| `scripts/parity/run_gen2_scenarios_node.js` / `.py` | 均支持**显式注入运行 bundle**；新增 `rule_bundle_gate` handler；G2S-08 运行配置改由夹具声明并注入（Python 侧校验 gen2.yaml 与夹具一致，防漂移） |
| `scripts/parity/run_node.js` | 同上注入运行 bundle（否则跨语言 parity 链会因缺显式阈值而抛错） |
| `tests/gen2-selection-scores.test.js` | 装载器支持 bundle 注入；F2 断言改为「INCOMPLETE 标记」语义；新增 **blocked 回归 9 条**（缺失 / 仅旧字段 / bundle 文件缺失 / 非法） |
| `tests/gen2-gate.test.js` | 装载器注入运行 bundle（保持数据闸门 / 角色用例语义） |
| `ml/gen2/tests/test_selection_scores.py` | 新增 `RuleBundleGateTest`（6 条：缺失 / 仅旧字段 / 非法 / 合法 / 顺序证据 / 夹具↔yaml 漂移） |
| `ml/gen2/tests/test_scenario_parity.py` | 闸门顺序断言补第 0 位；新增 `test_rule_bundle_scenario_declared` |
| `ml/gen2/baseline/rebuild_research_baselines.py`、`ml/gen2/reports/gen2_b1_research_baselines_20260911.md` | 修正 F2 描述（不再存在 `role_thresholds_source=LEGACY_TOP_QUANTILE_AUDIT` 运行态） |

**阈值取值、`alpha` 权重、universe、规则实现均未改动；bundle / lock 未重新生成。**

---

## 3. 契约

```text
闸门顺序（优先级 = 顺序，双端逐条一致）
  -1  RULE_BUNDLE_INCOMPLETE             规则 bundle 缺显式必需配置   ← 本轮新增，最先
   0  NAN_OR_MISSING_FIELD
   1  DUPLICATE_TRADE_DATE
   2  BENCHMARK_MISSING
   3  BENCHMARK_INSUFFICIENT_HISTORY
   4  STALE_BATCH
   5  NO_ELIGIBLE_TODAY
   6  UNIVERSE_INCOMPLETE
   7  PUBLISH_VALIDATION_FAILED
```

| 情形 | run 状态 | `status_reason` | `data_gate` |
|---|---|---|---|
| 缺 `selection.role_thresholds` | `blocked` | `RULE_BUNDLE_INCOMPLETE` | `RULE_BUNDLE_ROLE_THRESHOLDS_MISSING` |
| 只有旧 `top_quantile` / `challenger_pct` / `satellite_pct` | `blocked` | `RULE_BUNDLE_INCOMPLETE` | `RULE_BUNDLE_ROLE_THRESHOLDS_MISSING`（**旧字段不被读取**） |
| `role_thresholds` 提供但非法（键缺失 / 非数值 / 顺序违例） | `blocked` | `RULE_BUNDLE_INCOMPLETE` | `RULE_BUNDLE_ROLE_THRESHOLDS_INVALID` |
| `role_thresholds` 合法 | 继续走数据闸门 | — | — |

* 规则闸门**先于任何数据读取**（`main()` 里 `failGate` 早退，零 `gen2_ranking` 写入）——不产出「未经显式声明」的角色分层；
* `blocked` 仍是**可预期业务结果**，与 `failed`（`SYSTEM_ERROR`）严格区分；
* 旧字段唯一出口 = 离线迁移助手 `deriveRoleThresholdsFromLegacy()`（供 WP-G2-04 重建 bundle 一次性烘焙），
  产物仍过同一套校验，保证新 bundle 一定合法。

---

## 4. 回归证据

| 证据 | 内容 |
|---|---|
| 跨端场景 | `G2S-09` 4 个 case 双端**逐字段一致**；`[compare] invariants 224/224 passed`，`unlocated=0`，**门禁 PASS** |
| 优先级证据 | `missing_role_thresholds` 用**空数据**驱动真实 `main()`，拿到 `RULE_BUNDLE_ROLE_THRESHOLDS_MISSING` 而非 `BENCHMARK_MISSING`（`I-09-07 / I-09-14 / I-09-15`）；正对照 `complete_role_thresholds` 空数据下得到 `BENCHMARK_MISSING`（`I-09-16`，证明闸门放行后由数据闸门接手） |
| 正对照 | `complete_role_thresholds` 完整横截面 → `completed`，`role_thresholds_effective.core_pct = 0.8`（`I-09-12`）：**只补这一项即恢复**，阻断项单一可定向修复 |
| JS 单测 | `tests/gen2-selection-scores.test.js` 47/47（含 blocked 回归 9 条）· `tests/gen2-gate.test.js` 34/34 |
| Python 单测 | `RuleBundleGateTest` 6/6 · `test_selection_scores + test_scenario_parity` 38/38 |
| 全量套件 | `node scripts/test-all.js` → **42/42 通过，0 项失败**（A：35/35 文件；B：`unittest discover ml/gen2/tests`；C：Immutable SHA 11/11 —— 含 `GEN2_RULE_V2_BUNDLE.json` SHA 未变；D：跨语言 parity；E/F/G 全通过） |

### G2S-09 双端观测（节选）

| case | status | status_reason | data_gate | rule_bundle_status |
|---|---|---|---|---|
| `missing_role_thresholds` | blocked | RULE_BUNDLE_INCOMPLETE | RULE_BUNDLE_ROLE_THRESHOLDS_MISSING | INCOMPLETE |
| `legacy_only_no_role_thresholds` | blocked | RULE_BUNDLE_INCOMPLETE | RULE_BUNDLE_ROLE_THRESHOLDS_MISSING | INCOMPLETE |
| `invalid_role_thresholds` | blocked | RULE_BUNDLE_INCOMPLETE | RULE_BUNDLE_ROLE_THRESHOLDS_INVALID | INCOMPLETE |
| `complete_role_thresholds` | completed | null | null | COMPLETE |

---

## 5. 合并后的**预期**中间态（必须知晓）

冻结 bundle `gen2-rule-v2.0`（`selection` 段仍是旧字段 `core_pct/challenger_pct/satellite_pct/top_quantile`，
**没有** `role_thresholds`）在本轮**刻意未改动**（属顺序表第 5 项 WP-G2-04）。因此：

> **合并 PR #26 后，Gen-2 Shadow 每日运行将持续 `blocked / RULE_BUNDLE_INCOMPLETE`，
> 直到 WP-G2-04 重建 bundle/lock 补入 `selection.role_thresholds`。**

这是**刻意的 fail-closed 中间态**：规则不完整时宁可不出结果（前台只展示 V3.6.1），
也不产出一套「未经显式声明」的角色分层。**未提升 authority、未部署、未写正式仓位。**

---

## 6. 本包未做的事（边界）

* 未修改 `ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json` / `GEN2_RULE_V2_LOCK.json`（→ WP-G2-04）；
* 未修改任何阈值取值、`alpha` 权重、universe、规则实现语义；
* 未开工 F4（`build_portfolio_candidates` 等权重重置 / legacy rank / 缺防守腿 → **WP-G2-06**）；
* 未重跑 B1 / B3（→ 顺序表第 6 项）；
* 未提升 authority、未部署、未写 `portfolio_position` / `portfolio_snapshot`。
