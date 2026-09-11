# Gen-2 报告索引（角色语义与账本口径）

> 规则实现于 2026-09-11 修正（WP-G2-03）后，**角色语义已唯一化**；回测账本于 2026-09-11
> 统一（WP-G2-02 / B1）。因此此前的经济类报告只能作为**审计基线**，不能与新结果逐位比较。

## 当前有效（唯一权威口径）

| 报告 | 内容 |
|---|---|
| `gen2_b1_ledger_baseline_20260911.md` | **B1 回测账本基线**：唯一权威角色语义 + 唯一权威账本，四类策略同口径比较 + 资金守恒验收 |
| `gen2_b1_research_baselines_20260911.md` | **B1 研究基线**：角色基线 / 归因 / 敏感性 + 组合有效性守卫。**F1（Alpha 显式注入 `selection_scores`）与 F2（显式 `role_thresholds`）已修**，替代 Alpha 场景现已真正影响组合；F3 费用档白跑已修（数值不变）；**F4 新登记**（研究脚本组合构建丢弃权威权重上限、priority 用 legacy rank → 待立项）。生成器：`python -m gen2.baseline.rebuild_research_baselines`（检测到未登记/已过期的无效场景会直接报错） |
| `gen2_b1_research_rule_rotation_20260911.md` | 角色基线回测报告（新口径，Economic Gate = FAIL/UNPROVEN） |
| `gen2_rule_impl_correction_20260911.md` | 规则实现语义变更记录（D-001/D-002/D-004 收口、V2 角色权威唯一化、G2S-06 解锁） |
| `gen2_scenario_parity_20260911.md` | 双端场景比对报告（G2S-01..07 不变量与差异分类） |

## 旧角色语义审计基线（**不可逐位比较**）

| 报告 | 说明 |
|---|---|
| `gen2_rule_baseline_report.md` | 旧角色语义 / 旧账本口径，仅作审计基线 |
| `gen2_rule_baseline_universe_v1_30.md` | 旧角色语义 / 旧账本口径，仅作审计基线 |
| `gen2_qualification_2026-09-08.md` | 旧角色语义 / 旧账本口径，仅作审计基线 |
| `oos_walk_forward_2026-09-07.md` | 旧角色语义 / 旧账本口径，仅作审计基线 |
| `gen2_v21_m2_validation_2026-09-09.md` | 旧角色语义 / 旧账本口径，仅作审计基线 |
| `gen2_v21_m3_validation_2026-09-09.md` | 旧角色语义 / 旧账本口径，仅作审计基线 |
| `gen2_v2_archive_2026-09-09.md` | 旧角色语义 / 旧账本口径，仅作审计基线 |
| `gen2_p1_rule_v2_ab.md` | 旧角色语义 / 旧账本口径，仅作审计基线 |

## 非经济类（不受角色语义影响，保持有效）

| 报告 | 内容 |
|---|---|
| `gen2_p0_batchA_fixes.md` / `gen2_p0_batchB_fixes.md` / `gen2_p0_experiment_framework_fixes.md` | P0 修复记录 |
| `universe_data_quality_v0.md` | 数据质量报告 |
