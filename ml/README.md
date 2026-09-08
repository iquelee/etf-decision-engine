# V4.0 — Rule Core + ML Alpha Layer

## 战略定位（冻结）

**不要**把目标定义成「用 Qlib/Vibe-Trading 找一个更高收益的量化模型」。

**要**定义成：

> **让 ML 专门修复 V3.6.1 已被回测证明存在的机会捕获缺陷。**

母系统：**线上 V3.6.1 Core**（Regime → Stage → Target → Risk → Cap → Execution）。  
ML **不得**直接控制最终仓位，**不得**绕过 Risk / Cap / Hard Break。

```text
V3.6.1 Core
   ├── + ML Early Transition     (Phase 1)
   ├── + ML S4 Survival          (Phase 2)
   ├── + ML S5 Downside          (Phase 3)
   └── + ML Main5 Ranking        (Phase 4)
          │
          ▼
       V4.x（逐模块 Challenger 通过才并入）
```

任一模块失败可单独拔掉，系统回退纯 V3.6.1。

---

## 职责分工

| 层 | 负责 | 禁止 |
|----|------|------|
| V3.6.1 Core | Regime / Stage / Target / Risk / Cap / Execution | — |
| Qlib | Dataset → Train → Walk-Forward → Prediction → Ranking | 直接上线未校准概率 |
| Vibe-Trading | 假设 / 因子发现（实验室） | 发现后直接生产 |
| ML Permission | Level1 Rule Gate / Level2 Modifier / Level3 Ranking | 否决 Hard Break |

---

## 三层权限

1. **Level 1 Rule Gate**（不可突破）：Bear 硬限制、MA60 结构破位、Breakout Failure、Risk、ETF/Sector Cap、流动性  
2. **Level 2 ML Modifier**：`Target = Base × Modifier`，Modifier ∈ **[0.85, 1.15]**  
3. **Level 3 Ranking**：Main5 内强者优先，**不突破 Cap**

---

## 开发顺序（禁止并行跳相）

| Phase | 内容 | 闸门 |
|-------|------|------|
| **0** | Stage/Regime/Label/Feature **因果审计** | 未通过 → **全部停止** |
| **1** | Early Transition：预测能力 + Challenger | 校准；禁 Random Split |
| **1.5 / CF** | Counterfactual：Control / Oracle / ML | **Economic PASS**（已完成） |
| **3** | Alpha：HVT 标签 / 特征 / 多模型 / Abstain | Capture 软目标 60%+；**Production BLOCKED** |
| **（延后）** | S4 Survival → S5 → Ranking | 见 `ml/phase3_alpha_optimization.md` |

---

## 五个必须吸收的工程约束

1. **小样本**：禁止单票几十次事件训树；建「同类事件训练池」（成长/科技优先）  
2. **Stage 标签无未来函数**：`feature(t)` 仅用 `≤t`；`label` 可用 `Stage(t+N)` 但由因果 Stage 引擎生成  
3. **Challenger Protocol**：Research → Backtest → OOS（≥2 不重叠窗，含 Bull+Bear/Range）→ Shadow → Production  
4. **上线熔断**：校准恶化 / Fast Path 经济价值连续为负 / FP 超阈 → Modifier→0、Fast Path OFF → 回纯 V3.6.1  
5. **概率校准**：Reliability / Brier / Precision@TopK；**禁止裸阈值 `P>0.75`**

---

## 验收（相对 V3.6.1 Baseline）

```text
Return ↑
Bull Capture ↑↑
MaxDD ≤ Baseline + 2~3pp
Sharpe 不明显下降
Fast Path: 提前进入带来的收益 > 新增风险
```

---

## 目录

| 路径 | 用途 |
|------|------|
| `ml/README.md` | 本宪章 |
| `ml/CHALLENGER_PROTOCOL.md` | 准入协议 |
| `ml/CIRCUIT_BREAKER.md` | 上线熔断 |
| `ml/phase1_early_transition_spec.md` | Phase 1 规格（未训练前） |
| `scripts/ml/audit-stage-regime-causal.js` | **Phase 0 闸门脚本** |
| `回测报告/V4.0-Phase0-因果审计-*.md` | 审计报告 |

---

## 当前状态（2026-08-29）

| 项 | 状态 |
|----|------|
| Phase 0 因果审计 | WARN（Main5 小样本）；动态因果 PASS |
| 训练池 CSV | `deliverables/etf_daily_ml_pool/`（15 只，含 588000） |
| Early Transition 数据集 | **GATE PASS**：S2=1901，Y5+=190，Y10+=356 |
| Phase 1.5 样本质量 | **WARN**（Y10 独立簇 55&lt;60）；可继续 |
| Challenger Baseline | **CONDITIONAL_SHADOW**（HistGBM WF；WF1 阈值不触发） |
| 线上 V3.6.1 | **未改**；Fast Path **未上线** |
| 下一步 | 反事实 Bull Capture 回测；禁止仅凭 AUC 上线 |

脚本：
- `scripts/ml/audit-sample-quality.py`
- `scripts/ml/train-early-transition-challenger.py`
