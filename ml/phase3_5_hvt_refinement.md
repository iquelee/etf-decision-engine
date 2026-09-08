# V4.0 Phase 3.5 — HVT Label Refinement

日期锚定：Phase3 Alpha 之后（2026-08-30）。

## 战略状态（冻结）

```text
V3.6.1                 = Production Baseline (FROZEN)
ML Early Transition    = Research Candidate
Status                 = RESEARCH_CONTINUE
Economic Alpha         = PASS
Risk                   = PASS
Prediction Stability   = CONDITIONAL
Feature Discovery      = PROMISING   （RS20 / BreakoutDistance / SlopeAccel）
Production             = BLOCKED
```

## 本相只做的事

1. **重定义 HVT**：风险调整收益 + 持续性 → 三级 `A/B/C`，主预测 `P(HVT-A)`
2. **Early Leadership Features**：冻结四元结构 + 仅新增 RSAccel、BreakoutApproach
3. **模型冻结**：Logistic（可解释 baseline）+ ExtraTrees（challenger）— 不堆复杂模型
4. **Group-Aware Walk-Forward**：同趋势簇不得同时出现在 Train 与 OOS
5. **重跑 Counterfactual**：Control / Oracle-HVT / ML-HVT；Capture 55–60% 为软目标

## 明确不做

- 不改 V3.6.1 Stage / Target / Risk
- 不上线 Fast Path / Shadow
- 不堆交叉特征、不引入 DL
- 不以 Capture≥60% 为硬门槛

## HVT 三级标签

```text
HVT-A  Strong Fast Path   = Fast(W) ∧ Ret10/ATR ≥ α ∧ Persist10 ≥ π_A
HVT-B  Useful Fast Path   = Fast(W) ∧ 未达 A ∧ Ret10/ATR ≥ β ∧ Persist10 ≥ π_B
HVT-C  No Economic Edge   = 其余（含仅进状态、无经济价值）
```

窗口比较（非网格扫参）：`W ∈ {3,5,8,10}`，看经济信号 vs WorstFold 稳定性后冻结。

风险调整：`ret10_atr = fwd_ret10 / (atr20/close)`，跨品种可比。

## Early Leadership Features

```text
① rs_20d              当前是否相对强
② rs_accel_5          是否正在变强     （新增）
③ breakout_distance   离突破多远
④ breakout_approach_5 正在多快靠近突破 （新增）
+ ma20_slope / slope_accel_5 / vol_compression / atr20
```

## 模型矩阵

| ID | Model | Features |
|----|-------|----------|
| A | Logistic | core |
| B | ExtraTrees | core |
| C | Logistic | core + leadership4 |
| D | ExtraTrees | core + leadership4 |

## 生产评分（研究用）

```text
ProductionScore ≈ EconomicValue + Stability + Calibration − Complexity
```

稳定性优先于单纯 Capture。

## Phase 3.5 结果（2026-08-30）

| 项 | 结果 |
|----|------|
| 数据集 | S2=1376；独立簇=101；Y5+=189；HVT-A=120（占 Y5 的 63.5%） |
| 窗口 | **Y5 冻结**（HVT-A\|Y5 密度最高且经济意义清晰） |
| WF Best | ExtraTrees × y_hvta × core（MeanAUC 0.89 / Worst 0.84） |
| 反事实 | Oracle +3.81pp；ML +2.95pp；**Capture 77.4%**；ΔMDD≈0 |
| 负对照 | 黄金 meanP=0.19；P≥0.65 仅 3.9% |
| 裁决 | **SHADOW_CANDIDATE** → 已提升为 **SHADOW**（仍 **Production BLOCKED**） |

软目标 Capture 60% 已越过。**Gen-1 已冻结为 `HVT-A-ET-20260830`**（见 `ml/shadow/SHADOW_PROTOCOL.md`）。
下一步是真实 Shadow 观察稳定性，不是上线，也不是加复杂模型。
