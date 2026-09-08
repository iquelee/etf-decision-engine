# Challenger Protocol（V4.0 ML 准入）

任何 ML 模块进入生产前，必须走本协议。**禁止另建一套更松的准入。**

## 流水线

```text
Research (含 Vibe-Trading 假设)
  → Qlib Dataset / Feature / Label（因果审计已通过）
  → Train（Walk-Forward only；禁止 Random Split / Random K-Fold）
  → Validation
  → OOS（≥2 个不重叠窗口；至少一个 Bull；至少一个 Bear 或 Range）
  → Shadow（线上并行，不驱动仓位）
  → Production（三级权限内；带熔断）
```

## 硬门槛

| 项 | 要求 |
|----|------|
| 因果 | Phase 0 报告为 PASS 或仅 WARN（无 FAIL） |
| 校准 | Reliability Diagram + Brier；分箱实际频率接近声称概率 |
| 增量价值 | Incremental Return / MaxDD / Sharpe vs 纯 V3.6.1 |
| Bull Capture | Missed Bull Days、S2→S4 Lead Time、Opportunity Capture Ratio |
| 错误率 | False Fast Path / False Positive / False Downgrade 有阈值 |
| 权限 | 不突破 Level 1；Modifier 在 [0.85,1.15]；Ranking 不破 Cap |
| 熔断 | 已接线 `ml/CIRCUIT_BREAKER.md` 监控项 |

## 禁止宣称成功的信号

- 仅看「准确率 85%」
- 仅看单窗 Sharpe
- 仅 588000 / 单票小样本漂亮曲线
- Vibe-Trading 因子未经 Qlib OOS 直接上线

## 模块清单（逐个 Challenger）

| ID | 模型 | Phase | 状态 |
|----|------|-------|------|
| ML-A | Early Transition / HVT-A | 1→3.5→Shadow | **SHADOW ACTIVE**（`HVT-A-ET-20260830` FROZEN）；Capture 77.4% 里程碑；Fast Path NOT CONNECTED；Production BLOCKED |
| ML-B | S4 Survival | （原 Phase2，延后） | 未开始（等 Shadow 稳定） |
| ML-C | S5 Downside | — | 未开始 |
| ML-D | Main5 Ranking | — | 未开始 |

### Early Transition 正式状态（2026-08-30 Phase3.5）

```text
Economic Value      = PASS   (Oracle +3.81pp / ML +2.95pp / Capture 77.4%)
Risk Impact         = PASS   (Incremental MaxDD ≈ 0)
Prediction Stability= CONDITIONAL→改善 (ET WorstFold 0.84 on y_hvta)
Feature Discovery   = PROMISING (RS / BreakoutApproach / SlopeAccel)
Production          = BLOCKED
State               = SHADOW（模型已冻结；只评估不训练）
Next                = 跨 Bull/Range/Risk-off 观察；Canary 前不改 Rule / 不重训
```
