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

## 6. 本包未完成部分（下一片）

`G2S-06`（逐日 eligibility → run 状态的场景化验证）与 `G2S-07`（晋升连续性 / NO_CORE）仍为 `PENDING_SEAM`：

* roles seam 的共同输入契约已在夹具 `seam_contracts.roles_panel` 中定义（canonical panel + 两侧 adapter + gap 清单）；
* **可执行适配器**（从 canonical panel 派生 Python 所需的 `rankings` / `config`）尚未实现 → 属 WP-G2-03 剩余切片；
* 完成后再进入 WP-G2-02 账本重算。
