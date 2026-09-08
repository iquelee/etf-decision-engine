# V4.0 Phase 3 — Alpha / Label / Feature Optimization

日期锚定：2026-08-29 Phase2 反事实之后。

## 战略状态（冻结表述）

```text
V3.6.1              = Production Baseline（冻结，禁止为 ML 调参）
ML Early Transition = Research Candidate
Status              = RESEARCH_CONTINUE
Economic Value      = PASS   （Oracle +3.35pp；ML +1.60pp；Capture 47.7%）
Risk Impact         = PASS   （Incremental MaxDD ≈ 0）
Prediction Stability= CONDITIONAL
Production          = BLOCKED（Fast Path 不上线）
```

## ML Alpha Qualification Ladder

| Level | 含义 | Early Transition 现状 |
|------:|------|----------------------|
| 0 | 统计上有预测能力 | ✅ |
| 1 | OOS 有排序能力 | ✅（CONDITIONAL） |
| 2 | 反事实有经济价值 | ✅ **Phase2 PASS** |
| 3 | 跨 Bull / Range / Bear 稳定 | 未证明 |
| 4 | Walk-Forward 稳定（含 WorstFold） | 未证明 |
| 5 | Shadow 实时稳定 | 未开始 |
| 6 | Canary 生产 | **BLOCKED** |

软目标：Capture Efficiency **60%+**（非硬门槛；若复杂模型只到 51% 且不稳，放弃硬推）。

## Phase 3 只做三件事

| ID | 内容 | 不做 |
|----|------|------|
| **3A** | High-Value Transition 经济标签 | 不改 Stage/Target/Risk |
| **3B** | 特征扩展 + Permutation Importance | 不无限堆特征 |
| **3C** | 多模型对比 + ≥3 WF Fold + Abstain | 不上线；Vibe 不进生产 |

## Economic Label（3A）

```text
Y_Fast5          = 5d 内进入 S4/S5          （状态）
Y_Persist10      = 进入后 10d 内 S4/S5 占比   （持续性）
Y_Return10       = t→t+10 收益               （经济）
Y_HVT            = Fast5 ∧ Ret10>θ ∧ Persist≥π
                   （High-Value Transition = 值得提前下注）
```

`FastPathValue ≈ P(HVT)`（研究代理；非生产仓位公式）。

## Abstain（研究协议）

```text
若 calibration 分位不稳 或 P 落在模糊带 → ABSTAIN / No Signal
仅高置信候选进入 Fast Path 研究触发
宁可少做，不把噪音变成交易
```

## 工具分工

```text
Vibe-Trading → Hypothesis only
Qlib / 本仓库脚本 → Dataset / WF / OOS / Challenger
禁止：Vibe 回测漂亮 → 直接进 V3
```

## 运行

```bash
node scripts/ml/export-high-value-transition-dataset.js
python3 scripts/ml/phase3-alpha-experiments.py
```
