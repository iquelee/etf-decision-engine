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

## 8. 本包新发现的差异与实现并存问题（需裁决/后续）

| 编号 | 内容 | 状态 |
|---|---|---|
| **D-003** | `reason_codes` 措辞差异：JS 写 `LEADERSHIP_*` 区间码与 `_WAIT`/`_KEEP` 后缀，Python V2 规则不写。**决策与角色结果一致**；归一化口径已写入夹具 `seam_contracts.reason_normalization` | EXPLAINED（158 处字段级差异，全部为标签） |
| **D-004** | 被 cluster cap 降级的行：JS 记录 `\|CLUSTER_CAP_DEMOTED`，Python V2 规则未记录（角色同为 SATELLITE，但原因串仍显示 `PROMOTION_CONFIRMED`）→ **审计码缺失、审计串与角色不一致** | **PENDING_RULING**（建议：在 `rule_v2_ab` 补齐一行，与 `role_engine.py:135` 现有写法一致；本包未擅自改） |
| **实现并存** | Python 有**两套 roles 实现**：`baseline/rule_v2_ab.build_v2_roles`（本包 seam，含 NO_CORE 与权限门，缺区间码/审计码）与 `portfolio/role_engine.build_daily_roles`（reason 词表与 JS 一致，但**缺 NO_CORE 硬门槛与权限门**）。实测：no_core 情形 `role_engine` 让 513310 保持 CORE；risk_off 情形它不发 `PROMOTION_BLOCKED_BY_PERMISSION`；现任降级语义也不同 | 已登记 `seam_contracts.python_roles_implementations` → **WP-G2-02 必须先确定唯一权威实现** |

## 9. 本包未完成部分（剩余切片）

`G2S-06`（逐日 eligibility → run 状态的**场景化**验证）仍为 `PENDING_SEAM`：

* 四态契约本身已实现（第 5 节）并由 `tests/gen2-gate.test.js` / `gen2-consumer.test.js` 覆盖；
* 但「陈旧批次 / 重复日期 / 缺 benchmark / 历史不足 / NaN / 非 30 资产 → 各自进入 blocked」的**run-level 场景适配器**
  （在场景夹具里驱动 `main()` + 注入 DB）尚未实现 → 属 WP-G2-03 收尾切片；
* 完成并取得 D-004 裁决后，PR #24 才具备转出 Draft 的条件。
