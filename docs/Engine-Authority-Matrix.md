# Engine Authority Matrix（引擎权限矩阵）

日期：2026-09-08。本表固化 Integrated Shadow 阶段的四层权限边界（任务书 §25），是 Gen-2 / Gen-1 / V3.6.1 / Human 之间唯一的能力真相源。

## 权威矩阵

| 能力 | Gen-2 | Gen-1 | V3.6.1 | Human |
|---|---|---|---|---|
| Universe Selection（选池） | ✅ | ❌ | ❌ | 可覆核 |
| ETF Ranking（排序） | ✅ | ❌ | ❌ | 可覆核 |
| Core / Challenger（角色） | ✅ Shadow | ❌ | ❌ | 可覆核 |
| Replacement Proposal（替换提案） | ✅ Shadow | ❌ | ❌ | 可覆核 |
| Timing（择时） | 辅助 | ✅ | ✅ Rule | 可覆核 |
| Risk Gate（风险闸门） | ❌ | ❌ | ✅ | 可覆核 |
| Single ETF Cap（单只上限） | ❌ | ❌ | ✅ | 可覆核 |
| Tech Cap（科技上限） | ❌ | ❌ | ✅ | 可覆核 |
| Final Target（最终仓位） | ❌ | ❌ | ✅ | ✅ 执行 |
| Final Action（最终动作） | ❌ | ❌ | ✅ | ✅ 执行 |
| Auto Trading（自动交易） | ❌ | ❌ | ❌ | 手工 |

## 语义说明

- **Gen-2 = Selection Permission**：只决定「谁值得参与」（选池 / 排名 / 角色 / 替换提案），是影子观察，不直接给最终仓位。输出 CORE / CHALLENGER / SATELLITE / HEDGE / RESERVE。
- **Gen-1 = Timing Proposal**：只在已冻结模型域内给择时解锁信号（NO_SIGNAL / OBSERVE / ADVISORY），不改变选池，不覆盖 Safety Core。
- **V3.6.1 = Safety Core**：保留风险与仓位最终约束（baseline_target / risk_adjusted_target / single_etf_cap / tech_cap / defense gate）。生产 final_target / final_action 的唯一产出方。
- **Human**：唯一执行方，可覆核三者任何输出。Auto Trading 永关闭。

## Integrated Shadow 中的落地

`cloudfunctions/runIntegratedShadowEod/index.js` 的 `computeIntegrated()` 严格按上表编排：

1. Gen-2 只产出 `selection_effect`（方向性意图）；
2. Gen-1 只产出 `timing_effect`（择时否决，仅在 Selection 想上调但未解锁时生效）；
3. V3.6.1 只产出 `safety_effect`（单只 cap + 组合层 tech cap clamp）；
4. 三者合成 `safety_clamped_target`（反事实建议），**不写** decision_result.final_target / final_action。

## 硬性红线（任务书 §3 / §14）

禁止：修改 V3.6.1 参数、修改 Gen-1 frozen model、调 Gen-2 alpha 权重、写 Gen-2 → decision_result / portfolio_position、让 Gen-2 改 final_target / final_action、开启自动交易、进入 Qlib/ML 重训练。
