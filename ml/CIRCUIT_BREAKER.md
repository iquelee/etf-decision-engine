# ML Circuit Breaker — Tiered (Shadow monitoring edition)

模型失效时系统必须能**不用它**。Gen-1 Shadow 启用监控版；**未**接生产下单。

## 三级（正式生产前目标形态）

| 级别 | 条件（初值） | 动作 |
|------|--------------|------|
| **WARNING** | 滚动 30D Incremental Alpha < 0 | 告警；Shadow FastPath Permission **仍开** |
| **DEGRADED** | 30D Alpha < 0 **且**（校准恶化 **或** False Fast Path 率高） | `ML_DEGRADED`；Shadow FastPath Permission=OFF |
| **ML_OFF** | 滚动 60D Alpha < 0 **且** False Positive 高 | 完全关闭 ML 叙事；回退纯 V3.6.1 |

单看「30 日 Alpha < 0」不够 — Range 月可能误杀。

## 五个看板 KPI（优先于 AUC）

1. Incremental Alpha  
2. Timing Gain  
3. Fast Path Precision  
4. False Fast Path Cost（MAE）  
5. Calibration  

附加：`ShadowCaptureEfficiency = ShadowIncr / OracleBench`；Raw vs Independent Event Count。

## 恢复

- 人工复核 + 新 Challenger OOS  
- **禁止**自动重新打开 Fast Path

## Shadow 接线状态（2026-08-30）

- 模型：`HVT-A-ET-20260830`（FROZEN）  
- 日终：`scripts/ml/shadow-daily-log.py`  
- 结果回填：`scripts/ml/shadow-reconcile-outcomes.py`  
- 汇总：`scripts/ml/shadow-summary.py`  
- 生产 `param_config`：**未改**
