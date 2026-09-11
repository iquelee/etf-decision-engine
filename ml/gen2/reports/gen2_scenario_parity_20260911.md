# WP-G2-03 Gen-2 场景双端比对报告

- 夹具：`golden_scenarios_v1.json`
- 双端：JS `cloudfunctions/runGen2ShadowEod/index.js` / Python `ml/gen2/baseline/rule_v2_ab.py + ml/gen2/portfolio/{regime,selection_permission}.py`
- **门禁**：0 个未记录、未定位的差异 → ✅ PASS

## 汇总

| 指标 | 值 |
|---|---|
| scenarios_total | 7 |
| scenarios_run | 7 |
| invariants_checked | 170 |
| invariants_failed | 0 |
| differences_total | 160 |
| differences_unlocated | 0 |
| differences_pending_ruling | 0 |
| differences_explained | 160 |

## 场景状态

| 场景 | 状态 |
|---|---|
| G2S-01 | ALIGNED |
| G2S-02 | ALIGNED |
| G2S-03 | ALIGNED |
| G2S-04 | ALIGNED |
| G2S-05 | ALIGNED |
| G2S-06 | ALIGNED |
| G2S-07 | EXPLAINED |

## 差异汇总（按登记项聚合；全量逐条见 diff-report.json）

| 登记项 | 分类 | 场景 | case | 字段数 | 示例 |
|---|---|---|---|---|---|
| D-003 | EXPLAINED | G2S-07 | no_core | 60 | `no_core.reasons.1.159570` js='LEADERSHIP_BELOW_SATELLITE|DEMOTION_HYSTERESIS_KEEP' / py='DEMOTION_HYSTERESIS' |
| D-003 | EXPLAINED | G2S-07 | risk_off | 40 | `risk_off.reasons.1.159570` js='LEADERSHIP_BELOW_SATELLITE|DEMOTION_HYSTERESIS_KEEP' / py='DEMOTION_HYSTERESIS' |
| D-003 | EXPLAINED | G2S-07 | risk_on | 60 | `risk_on.reasons.1.159570` js='LEADERSHIP_BELOW_SATELLITE|DEMOTION_HYSTERESIS_KEEP|NO_CORE_TREND_GATE' / py='DEMOTION_HYSTERESIS|NO_CORE_TREND_GATE' |

## 备查：已登记差异（known_differences）

- **D-003** [EXPLAINED] `G2S-07/None` 字段 `reasons.*`：reason_codes 的**标签词表**差异：JS 额外写 LEADERSHIP_* 区间码与 _WAIT/_KEEP 后缀，Python V2 规则只写机状态码。决策、角色、审计码（CLUSTER_CAP_DEMOTED / FINAL_*）完全一致；归一化口径见 seam_contracts.reason_normalization（reasons_norm 两端 0 差异）。词表统一（可选）登记为后续工作项，不在本包内改动 Python 审计串。
  - 定位：`cloudfunctions/runGen2ShadowEod/index.js buildDailyRoles（写入 LEADERSHIP_* 区间码与 _WAIT/_KEEP 后缀）vs ml/gen2/baseline/rule_v2_ab.py build_v2_roles（只写机状态码）`
