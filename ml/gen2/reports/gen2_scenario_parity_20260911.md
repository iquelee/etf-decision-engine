# WP-G2-01 Gen-2 场景双端比对报告

- 夹具：`golden_scenarios_v1.json`
- 双端：JS `cloudfunctions/runGen2ShadowEod/index.js` / Python `ml/gen2/baseline/rule_v2_ab.py + ml/gen2/portfolio/{regime,selection_permission}.py`
- **门禁**：0 个未记录、未定位的差异 → ✅ PASS

## 汇总

| 指标 | 值 |
|---|---|
| scenarios_total | 7 |
| scenarios_run | 5 |
| invariants_checked | 78 |
| invariants_failed | 0 |
| differences_total | 4 |
| differences_unlocated | 0 |
| differences_pending_ruling | 4 |
| differences_explained | 0 |

## 场景状态

| 场景 | 状态 |
|---|---|
| G2S-01 | ALIGNED |
| G2S-02 | ALIGNED |
| G2S-03 | PENDING_RULING |
| G2S-04 | ALIGNED |
| G2S-05 | ALIGNED |
| G2S-06 | PENDING_SEAM(未运行) |
| G2S-07 | PENDING_SEAM(未运行) |

## 差异明细（必须全部已登记并定位）

| 场景 | case | 字段 | JS | Python | 分类 | 位置 |
|---|---|---|---|---|---|---|
| G2S-03 | gate_call | gate_call.core_count | `3` | `2` | PENDING_RULING (D-001) | cloudfunctions/runGen2ShadowEod/index.js:715 (`if (!capDemoted.length) return;` 早退，跳过终局断言) vs ml/gen2/baseline/rule_v2_ab.py:134-136（`if cap_demoted.empty:` 仍先执行 `_assert_final_constraints(...)` 再返回） |
| G2S-03 | gate_call | gate_call.per_cluster_core.software_ai | `3` | `2` | PENDING_RULING (D-001) | cloudfunctions/runGen2ShadowEod/index.js:715 (`if (!capDemoted.length) return;` 早退，跳过终局断言) vs ml/gen2/baseline/rule_v2_ab.py:134-136（`if cap_demoted.empty:` 仍先执行 `_assert_final_constraints(...)` 再返回） |
| G2S-03 | gate_call | gate_call.reason_codes.159852 | `` | `|FINAL_CLUSTER_CAP` | PENDING_RULING (D-001) | cloudfunctions/runGen2ShadowEod/index.js:715 (`if (!capDemoted.length) return;` 早退，跳过终局断言) vs ml/gen2/baseline/rule_v2_ab.py:134-136（`if cap_demoted.empty:` 仍先执行 `_assert_final_constraints(...)` 再返回） |
| G2S-03 | gate_call | gate_call.roles.159852 | `CORE` | `CHALLENGER` | PENDING_RULING (D-001) | cloudfunctions/runGen2ShadowEod/index.js:715 (`if (!capDemoted.length) return;` 早退，跳过终局断言) vs ml/gen2/baseline/rule_v2_ab.py:134-136（`if cap_demoted.empty:` 仍先执行 `_assert_final_constraints(...)` 再返回） |

## 待解决 seam（本包不运行，已登记归属）

- `G2S-06` → `WP-G2-03`：两端 seam 不对称（Python 为函数级质量检查、JS 为 run 级 main() 闸门），无法在同一输入下直接比对；且状态模型将由四态（running / blocked / failed / completed）替换当前 running/failed/completed，需先定状态契约再写场景。
- `G2S-07` → `WP-G2-03`：输入契约不同：JS buildDailyRoles(features) 单参数，Python build_v2_roles(features, rankings, config) 需 rankings + 配置 + universe records。需先统一 roles seam 的输入契约（含 config 来源），否则无法构造「同一输入」。

## 备查：已登记差异（known_differences）

- **D-001** [PENDING_RULING] `G2S-03/gate_call` 字段 `roles.*, reason_codes.*, core_count, per_cluster_core.*`：同一 day（software_ai 有 3 个 CORE、无 cap 降级现任）下：替换门路径 JS 保留 3 CORE、Python 收敛到 2。同场景 assert_call 路径两端完全一致（roles/reason_codes/core_count 全 ALIGNED），说明约束逻辑本身一致，差异只在「无 cap 降级时是否仍执行终局断言」。需裁决：终局约束是否必须在 gate 路径上无条件执行（若是，需在某端补一次断言；不得两端口径并存）。
  - 定位：`cloudfunctions/runGen2ShadowEod/index.js:715 (`if (!capDemoted.length) return;` 早退，跳过终局断言) vs ml/gen2/baseline/rule_v2_ab.py:134-136（`if cap_demoted.empty:` 仍先执行 `_assert_final_constraints(...)` 再返回）`
