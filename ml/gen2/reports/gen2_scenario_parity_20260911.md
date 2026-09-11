# WP-G2-01 Gen-2 场景双端比对报告

- 夹具：`golden_scenarios_v1.json`
- 双端：JS `cloudfunctions/runGen2ShadowEod/index.js` / Python `ml/gen2/baseline/rule_v2_ab.py + ml/gen2/portfolio/{regime,selection_permission}.py`
- **门禁**：0 个未记录、未定位的差异 → ✅ PASS

## 汇总

| 指标 | 值 |
|---|---|
| scenarios_total | 7 |
| scenarios_run | 5 |
| invariants_checked | 86 |
| invariants_failed | 0 |
| differences_total | 4 |
| differences_unlocated | 0 |
| differences_pending_ruling | 0 |
| differences_explained | 4 |

## 场景状态

| 场景 | 状态 |
|---|---|
| G2S-01 | ALIGNED |
| G2S-02 | ALIGNED |
| G2S-03 | EXPLAINED |
| G2S-04 | ALIGNED |
| G2S-05 | ALIGNED |
| G2S-06 | PENDING_SEAM(未运行) |
| G2S-07 | PENDING_SEAM(未运行) |

## 差异明细（必须全部已登记并定位）

| 场景 | case | 字段 | JS | Python | 分类 | 位置 |
|---|---|---|---|---|---|---|
| G2S-03 | gate_call | gate_call.core_count | `3` | `2` | EXPLAINED (D-002) | cloudfunctions/runGen2ShadowEod/index.js applyReplacementGate（仅替换事务，不再断言）vs ml/gen2/baseline/rule_v2_ab.py _apply_replacement_gate（内部仍执行 _assert_final_constraints） |
| G2S-03 | gate_call | gate_call.per_cluster_core.software_ai | `3` | `2` | EXPLAINED (D-002) | cloudfunctions/runGen2ShadowEod/index.js applyReplacementGate（仅替换事务，不再断言）vs ml/gen2/baseline/rule_v2_ab.py _apply_replacement_gate（内部仍执行 _assert_final_constraints） |
| G2S-03 | gate_call | gate_call.reason_codes.159852 | `` | `|FINAL_CLUSTER_CAP` | EXPLAINED (D-002) | cloudfunctions/runGen2ShadowEod/index.js applyReplacementGate（仅替换事务，不再断言）vs ml/gen2/baseline/rule_v2_ab.py _apply_replacement_gate（内部仍执行 _assert_final_constraints） |
| G2S-03 | gate_call | gate_call.roles.159852 | `CORE` | `CHALLENGER` | EXPLAINED (D-002) | cloudfunctions/runGen2ShadowEod/index.js applyReplacementGate（仅替换事务，不再断言）vs ml/gen2/baseline/rule_v2_ab.py _apply_replacement_gate（内部仍执行 _assert_final_constraints） |

## 待解决 seam（本包不运行，已登记归属）

- `G2S-06` → `WP-G2-03`：两端 seam 不对称（Python 为函数级质量检查、JS 为 run 级 main() 闸门），无法在同一输入下直接比对；且状态模型将由四态（running / blocked / failed / completed）替换当前 running/failed/completed，需先定状态契约再写场景。
- `G2S-07` → `WP-G2-03`：输入契约不同：JS buildDailyRoles(features) 单参数，Python build_v2_roles(features, rankings, config) 需 rankings + 配置 + universe records。需先统一 roles seam 的输入契约（含 config 来源），否则无法构造「同一输入」。

## 备查：已登记差异（known_differences）

- **D-002** [EXPLAINED] `G2S-03/gate_call` 字段 `roles.*, reason_codes.*, core_count, per_cluster_core.*`：WP-G2-03 裁决后，裸替换门的职责在两端不同：JS 只做替换事务、终局检查统一由 finalizeRoles 出口执行；Python 的替换门内部仍保留断言（其 finalize_roles 再断言一次，幂等）。契约出口以 exit_call 为准，此处保留登记以便未来收口。
  - 定位：`cloudfunctions/runGen2ShadowEod/index.js applyReplacementGate（仅替换事务，不再断言）vs ml/gen2/baseline/rule_v2_ab.py _apply_replacement_gate（内部仍执行 _assert_final_constraints）`
