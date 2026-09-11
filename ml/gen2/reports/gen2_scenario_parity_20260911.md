# WP-G2-01 Gen-2 场景双端比对报告

- 夹具：`golden_scenarios_v1.json`
- 双端：JS `cloudfunctions/runGen2ShadowEod/index.js` / Python `ml/gen2/baseline/rule_v2_ab.py + ml/gen2/portfolio/{regime,selection_permission}.py`
- **门禁**：0 个未记录、未定位的差异 → ✅ PASS

## 汇总

| 指标 | 值 |
|---|---|
| scenarios_total | 7 |
| scenarios_run | 6 |
| invariants_checked | 118 |
| invariants_failed | 0 |
| differences_total | 162 |
| differences_unlocated | 0 |
| differences_pending_ruling | 4 |
| differences_explained | 158 |

## 场景状态

| 场景 | 状态 |
|---|---|
| G2S-01 | ALIGNED |
| G2S-02 | ALIGNED |
| G2S-03 | ALIGNED |
| G2S-04 | ALIGNED |
| G2S-05 | ALIGNED |
| G2S-06 | PENDING_SEAM(未运行) |
| G2S-07 | EXPLAINED|PENDING_RULING |

## 差异汇总（按登记项聚合；全量逐条见 diff-report.json）

| 登记项 | 分类 | 场景 | case | 字段数 | 示例 |
|---|---|---|---|---|---|
| D-003 | EXPLAINED | G2S-07 | no_core | 60 | `no_core.reasons.1.159570` js='LEADERSHIP_BELOW_SATELLITE|DEMOTION_HYSTERESIS_KEEP' / py='DEMOTION_HYSTERESIS' |
| D-003 | EXPLAINED | G2S-07 | risk_off | 40 | `risk_off.reasons.1.159570` js='LEADERSHIP_BELOW_SATELLITE|DEMOTION_HYSTERESIS_KEEP' / py='DEMOTION_HYSTERESIS' |
| D-003 | EXPLAINED | G2S-07 | risk_on | 58 | `risk_on.reasons.1.159570` js='LEADERSHIP_BELOW_SATELLITE|DEMOTION_HYSTERESIS_KEEP|NO_CORE_TREND_GATE' / py='DEMOTION_HYSTERESIS|NO_CORE_TREND_GATE' |
| D-004 | PENDING_RULING | G2S-07 | risk_on | 4 | `risk_on.reasons.5.159852` js='LEADERSHIP_TOP_QUINTILE|PROMOTION_CONFIRMED|CLUSTER_CAP_DEMOTED' / py='PROMOTION_CONFIRMED' |

## 待解决 seam（本包不运行，已登记归属）

- `G2S-06` → `WP-G2-03`：两端 seam 不对称（Python 为函数级质量检查、JS 为 run 级 main() 闸门），无法在同一输入下直接比对；且状态模型将由四态（running / blocked / failed / completed）替换当前 running/failed/completed，需先定状态契约再写场景。

## 备查：已登记差异（known_differences）

- **D-004** [PENDING_RULING] `G2S-07/risk_on` 字段 `reasons.5.159852, reasons.6.159852, reasons_norm.5.159852, reasons_norm.6.159852`：被 cluster cap 降级的行：JS 记录 `...|CLUSTER_CAP_DEMOTED`，Python V2 规则只留 `PROMOTION_CONFIRMED`（角色=SATELLITE 但原因串仍说晋升成功）→ 审计串与角色不一致。角色结果一致，属**审计码缺失**，需裁决是否在 rule_v2_ab 补齐（一行式、与 role_engine 现有写法一致）。
  - 定位：`ml/gen2/baseline/rule_v2_ab.py build_v2_roles 调用 _cap_core_roles 后未追加 CLUSTER_CAP_DEMOTED（对比 ml/gen2/portfolio/role_engine.py:135 已追加）`
- **D-003** [EXPLAINED] `G2S-07/None` 字段 `reasons.*`：reason_codes 的标签前缀/后缀措辞差异，**决策与角色结果一致**。归一化口径见 seam_contracts.reason_normalization；归一化后的语义串两端一致。
  - 定位：`cloudfunctions/runGen2ShadowEod/index.js buildDailyRoles（写入 LEADERSHIP_* 区间码与 _WAIT/_KEEP 后缀）vs ml/gen2/baseline/rule_v2_ab.py build_v2_roles（只写机状态码）`
