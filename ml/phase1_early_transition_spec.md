# Phase 1 — Early Transition 规格（未训练）

> 依赖：`scripts/ml/audit-stage-regime-causal.js` **PASS**。  
> 本文件只定规格，**不包含训练代码、不上线。**

## 问题

V3.6.1 在趋势刚形成时偏慢（S2 residency 过高）。  
ML 只解决：**提前获得进入 S4 的资格**，不决定买多少。

## 标签

```text
Y(t) = 1{ Stage_causal(t+N) ∈ {S4,S5} }   当 Stage_causal(t)=S2
```

- `N` 初值：5 或 10（双轨报告，Challenger 择一）  
- `Stage_causal` = 线上同源 `resolveTrendStage` + `computeSnapshot(bars≤t)`  
- `X(t)` 仅用 `≤t` 特征

## 训练池（抗小样本）

优先同类机制：

```text
科技 / 半导体 / 通信 / 创新药 / 成长宽基
```

**不要**把黄金、债券与科技突破混成同一 S2→S4 池（可作负对照单独报告）。

Main5 不足时扩展 ETF 宇宙，再考虑股票；股票入池须单独 Challenger。

## 特征（五类，第一版克制）

1. Trend：MA slope、MA 相对位置、HH/HL、persistence  
2. Volume：ratio、收缩、突破量、persistence  
3. Consolidation：range、ATR compression、波动、base duration  
4. Relative Strength：vs benchmark / sector / rank  
5. Regime Context：Bull/Range/Bear、MR、breadth、benchmark trend

## Fast Path（资格，非仓位）

```text
FastPath =
  NotBear
  AND TrendIntegrity
  AND BreakoutQuality
  AND VolumeQuality
  AND RelativeStrength
  AND ConsolidationQuality
  AND Calibrated_P(S2→S4) ≥ X   # 校准后阈值，禁止裸 P
  AND RiskGate PASS
→ 允许 Stage 资格升为 S4
→ Target 仍由 V3.6.1 Target Engine 决定
```

## Qlib / Vibe

- **Qlib**：生产训练与 Walk-Forward 底座  
- **Vibe-Trading**：只产假设与候选因子 → 必须进 Qlib OOS → Challenger → Shadow

## 当前数据闸门（2026-08-29）

`export-early-transition-dataset.js` → **PASS**

- S2 事件 **1901**
- Y5+ **190** / Y10+ **356**（均 ≥80）
- 文件：`ml/datasets/early_transition_s2_2026-08-29.csv`

下一步才是 Qlib Walk-Forward + Probability Calibration（仍禁止 Random Split、禁止直上线）。
