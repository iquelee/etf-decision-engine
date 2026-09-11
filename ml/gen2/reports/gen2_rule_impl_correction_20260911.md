# Gen-2 规则实现修正记录（WP-G2-03 / D-001 裁决）

日期：2026-09-11 · 执行者：WorkBuddy Agent
关联：`fixtures/gen2/golden_scenarios_v1.json`（D-001 结案登记）· `ml/gen2/reports/gen2_scenario_parity_20260911.md`

---

## 1. 裁决（用户 2026-09-11）

> **任何角色生成路径结束前，都必须无条件执行一次终局约束检查。**

* 不是「替换门要不要额外做 cap」的策略选择，而是**结果有效性要求**；
* 无论当天有没有 `capDemoted`、有没有替换、是否早退，最终输出都必须满足：
  CORE 数量上限 / 每 cluster 的 CORE 上限 / NO_CORE 不可恢复 / 候选权重的单资产·cluster·科技·现金约束；
* `applyReplacementGate()` **只负责替换事务**；`buildDailyRoles()` 在所有角色变化完成后**统一且无条件**调用
  `assertFinalRoleConstraints()`；
* **不得把终局检查藏在 replacement gate 内部**（否则下一次新增早退分支又会绕过约束）。

## 2. 改动（规则实现，非阈值）

| 文件 | 改动 |
|---|---|
| `cloudfunctions/runGen2ShadowEod/index.js` | 新增 `finalizeRoles(day, prevRoles)` = `applyReplacementGate()` → `assertFinalRoleConstraints()`；`applyReplacementGate()` 移除内部断言与「无 cap 降级即早退」后的隐式跳过；`buildDailyRoles()` 出口改为 `finalizeRoles()`；`exports._internal` 增加 `finalizeRoles / applyReplacementGate / assertFinalRoleConstraints` |
| `ml/gen2/baseline/rule_v2_ab.py` | 新增对称出口 `finalize_roles(day, prev_roles, base_max_core, max_core_per_cluster)`（替换门 + 终局断言）；`build_v2_roles()` 改用 `finalize_roles()`（行为等价：原替换门内部已断言，现断言位置不变、幂等） |

**阈值、bundle 参数、universe 均未改动。**

## 3. 这是语义变更，不是重构

终局约束检查现在作用于**此前被跳过的路径**（无 cap 降级现任且无替换的日），因此：

* JS 的实际角色结果会变化 → **Rule V2 不再沿用「已封版 / 已验证」的资格表述**；
* `GEN2_RULE_V2_BUNDLE` / `GEN2_RULE_V2_LOCK` 需在 WP-G2-04 **重新生成**（新 `bundle_version` + 新 lock，旧锁保留作审计基线）；
* **B1 账本重算与 B3 OOS 必须使用修正后的规则**；修正前的 OOS 结论（IC>0 = 52.9%、2022 fold −0.1344、Economic Gate FAIL）作为审计基线保留，不再作为当前实现的资格证据。

## 4. 回归证据

| 证据 | 内容 |
|---|---|
| 场景不变量 | `G2S-03/exit_call`：`I-03-08` core_count=2、`I-03-09` 159852=CHALLENGER、`I-03-10` 现任保持 CORE、`I-03-11` 降级原因含 `FINAL_CLUSTER_CAP`（**双端均通过**） |
| JS 单测 | `tests/gen2-gate.test.js`：统一出口无条件收敛 3→2、降级者为非现任、现任不被降级、替换门不再内含断言（职责单一） |
| 双端比对 | 86/86 不变量通过；差异 4 处全部登记并定位（`D-002`：裸替换门职责差异，EXPLAINED，契约出口以 `exit_call` 为准）→ **0 个未记录、未定位差异** |

## 5. Run 状态四态契约（WP-G2-03 同步落地）

```text
running    → completed | blocked | failed
completed   唯一可消费状态（唯一 code / universe_count / 输出哈希校验通过）
blocked     数据、资格、约束不通过 → 今日没有可信 Gen-2 结果（可预期业务结果；前台只展示 V3.6.1）
failed      代码、网络、数据库等运行异常 → 系统未正常完成
```

* 闸门类失败（`BENCHMARK_MISSING` / `BENCHMARK_INSUFFICIENT_HISTORY` / `STALE_BATCH` / `NO_ELIGIBLE_TODAY`）
  与发布前完整性校验失败 → **`blocked`**（带 `status_reason`）；
* 未捕获异常 → **`failed`**（`status_reason=SYSTEM_ERROR`，同时保留 `gen2_error` 诊断文档）；
* **`blocked` 与 `failed` 不合并**：前者「今日没有可信结果」，后者「系统未正常完成」，处理、告警与文案必须区分；
* 消费端（`getGen2SelectionShadow`）只读 `completed`，`blocked / failed / running` 一律不可消费。

## 6. D-002 收口（职责边界对称）

| 端 | 裸 gate | 统一出口 |
|---|---|---|
| JS | `applyReplacementGate()` = 仅替换事务 | `finalizeRoles()` = gate → `assertFinalRoleConstraints()` |
| Python | `_apply_replacement_gate()` = 仅替换事务（**已移除内部终局断言**） | `finalize_roles()` = gate → `_assert_final_constraints()` |

行为等价（Python 出口仍会断言，位置从 gate 内移到 `finalize_roles`），因此 **D-002 从 EXPLAINED 结案为 RESOLVED**；
回归不变量 `I-03-12/13`（裸 gate 两端都只做事务：`core_count=3`、`159852=CORE`）在两侧测试中强制执行。

## 7. G2S-07 解锁（roles canonical panel，双端可执行）

* canonical panel（10 只 × 3 case × 最多 6 天）由夹具 V1 规则展开，两端各自实现同一展开规则，并用
  **`panel_sha256` 跨端校验**证明「两端吃的是同一份输入」（三个 case 全部 MATCH）；
* 覆盖并双端通过：晋升连续性（第 4 天未晋升 / 第 5 天晋升）、NO_CORE 不可恢复（第 3 天跌破 MA60 → 第 4/5 天仍非 CORE）、
  RISK_OFF 禁新晋升（`PROMOTION_BLOCKED_BY_PERMISSION`）、cluster 终局约束（`software_ai` 3→2）；
* **角色结果双端 0 差异**（三个 case 全部 ALIGNED）。

## 8. D-004 收口（cap 降级审计码，用户裁决 2026-09-11 批准）

`rule_v2_ab.build_v2_roles` 在 `_cap_core_roles` 之后追加 `CLUSTER_CAP_DEMOTED`（条件与 JS 同判：
`role_before_cap == CORE & role != CORE`；追加而非覆盖，顺序 `状态机原因 → CLUSTER_CAP_DEMOTED → FINAL_*`）。

* **D-004：EXPLAINED → RESOLVED**；回归不变量 `I-07-15/16`（159852 第 5/6 天 `reasons_norm` 必须含该码）
  + `I-07-17`（同两天 role=SATELLITE）在两侧测试强制；
* 仅 `reason_codes` 审计串变化，**角色结果不变**；因触及 reason 词表，随 D-001 计入规则实现修正。

## 9. V2 角色实现唯一化（用户裁决 2026-09-11）

| 项 | 结论 |
|---|---|
| **V2 唯一权威实现** | `ml/gen2/baseline/rule_v2_ab.py::build_v2_roles`（B1 账本 / B3 OOS / 360 行 parity 的实际使用者，唯一含 NO_CORE 硬门槛与 Selection Permission） |
| legacy 实现 | `ml/gen2/portfolio/role_engine.py::build_daily_roles` → 标为 `LEGACY_V1_ONLY`（docstring 标注 + `DeprecationWarning`） |
| 本包动作 | ①阻断 V2 路径误用（`V2_PATH_FORBIDDEN_ROLE_IMPL` 静态守卫）；②移除 parity runner 中未使用引用；③新增调用源测试 `ml/gen2/tests/test_role_impl_authority.py`（非白名单消费者即失败 + 白名单腐烂即失败） |
| 迁移工作项 | **WP-G2-05**：研究脚本（rule_rotation / sensitivity_matrix / attribution）改为兼容包装层或改调权威实现 —— 不在本包重构 |

## 10. G2S-06 解锁（run 状态四态，双端可执行）

**新增/补齐的 A2 数据闸门**（`runGen2ShadowEod/main()` 与 `ml/gen2/data/run_gate.py` 逐条对齐）：

| 序 | 闸门 | 触发条件 | 状态 |
|---|---|---|---|
| 0 | `NAN_OR_MISSING_FIELD` | `trade_date` 缺失 / OHLCV 非有限值 | blocked |
| 1 | `DUPLICATE_TRADE_DATE` | 同一 code 重复交易日（此前静默 dedup，现为阻断） | blocked |
| 2 | `BENCHMARK_MISSING` | benchmark 无数据 | blocked |
| 3 | `BENCHMARK_INSUFFICIENT_HISTORY` | benchmark 唯一交易日 < 60 | blocked |
| 4 | `STALE_BATCH` | LIVE：benchmark 落后于应到交易日 | blocked |
| 5 | `NO_ELIGIBLE_TODAY` | 全部候选不合格 | blocked |
| 6 | `UNIVERSE_INCOMPLETE` | 0 < 合格数 < 30（规划 §A2「非 30 资产 → blocked」） | blocked |
| 7 | `PUBLISH_VALIDATION_FAILED` | 唯一 code / 非有限 alpha / 写入 0 行 | blocked |
| — | `SYSTEM_ERROR` | 未捕获异常（代码/网络/DB） | failed |

* JS 侧 seam 为**注入式 db 驱动真实 `main()`**（不旁路、不预置结果）；Python 侧为等价数据质量入口
  `gen2.data.run_gate`；发布完整性校验抽为纯函数（`validatePublishResults` / `validate_publish_results`）供两端直调；
* 两端共用同一 canonical run panel（`RUN_V1` 展开规则逐字一致，`panel_sha256` 跨端校验）：**12 个用例逐字段一致**；
* `G2S-06`：PENDING_SEAM → **RUNNABLE / ALIGNED**。

### ⚠️ 生产行为变更（需周知，非规则参数）
`UNIVERSE_INCOMPLETE` 使「合格横截面 ≠ 30」的 run 一律 `blocked`。随之 `coverage_pct` /
`selection_confidence` / `role_classification` 在 completed 路径上恒为 `100% / FULL / FULL`，
这些字段退化为「证据字段」而非「分级字段」；若后续要保留部分覆盖发布，需另立工作项（不在本包）。

## 11. 剩余已登记差异（本包结束后）

| 编号 | 内容 | 状态 |
|---|---|---|
| **D-003** | `reason_codes` **标签词表**差异：JS 额外写 `LEADERSHIP_*` 区间码与 `_WAIT`/`_KEEP` 后缀；决策、角色、审计码完全一致，归一化口径见 `seam_contracts.reason_normalization`（`reasons_norm` 两端 0 差异） | EXPLAINED（160 处字段级，全部为标签；词表统一登记为可选后续） |

## 12. PR #24 转出 Draft 前置条件核对

| 条件 | 结果 |
|---|---|
| D-004、D-002 均为 RESOLVED | ✅ |
| G2S-06、G2S-07 都不再是 PENDING_SEAM | ✅（均 RUNNABLE / ALIGNED） |
| 不存在 PENDING_RULING | ✅（0） |
| `rule_v2_ab.build_v2_roles` 标明为 V2 唯一权威角色语义 | ✅（常量 + 守卫测试 + 夹具 `seam_contracts.role_engine_migration`） |
| 门禁全绿（0 个未记录、未定位差异） | ✅（170/170 不变量；160 差异全部 EXPLAINED） |
| 未提升 authority / 未部署 / 未写正式仓位 | ✅ |

**下一步**：WP-G2-02（用统一后的角色状态机重建 B1 回测账本）→ WP-G2-04（重建 bundle/lock，含实现哈希）→ B3 重跑 Frozen OOS。
