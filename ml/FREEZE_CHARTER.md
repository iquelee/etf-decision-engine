# V4.0 Freeze Charter — 冻结·观察·证据积累

**生效**：2026-08-30  
**阶段**：SHADOW 验收（非生产接线）

```text
V3.6.1
Production Core
  Regime / Stage / Target / Risk / Portfolio
        → 实际生产决策

HVT-A-ET-20260830
ML Challenger Gen-1
  Early Transition P / Permission / Counterfactual Target
        → Shadow only
```

---

## 四条硬纪律（不可破）

### 1. Gen-1 绝对不改

即使新特征、新阈值、Logistic 某窗更漂亮 → 只能进 `ml/gen2/`。  
禁止修改 `HVT-A-ET-20260830` 的模型、特征、标签、校准、阈值。

### 2. Shadow 只记录「当时可知」

MAE / MFE / Outcome C·D / 未来 Stage 一律 **事后 reconcile**，不得污染当日决策字段。

### 3. 正式账本 ⊥ rehearsal

`_rehearsal_*` 不得作为 Canary / Production 依据。

### 4. Gen-2 ⊥ Gen-1（物理隔离）

Gen-2 可挑战 Gen-1，**没有资格修改 Gen-1 manifest / 工件**。  
校验：`python3 scripts/ml/assert-gen1-immutable.py`

---

## Shadow Dashboard 核心顺序（固定）

1. **Incremental Alpha** — ShadowReturn − V3.6.1Return  
2. **Timing Gain** — 相对 V3.6.1 提前进入 S4 的天数  
3. **Fast Path Precision** — 提前信号中实际成功占比  
4. **False Fast Path Cost** — 错误提前的 MAE  
5. **Calibration** — 声称概率 vs 实现频率  

然后：Capture Efficiency（含 **CER_live**）、Raw/Independent Event、Bull/Range/Risk-off、Tech/Non-Tech。

观察项（不改 Gen-1）：**Signal Half-Life**。

---

## CER_live

\[
CER_{live}=\frac{Realized\ ML\ Alpha}{Historical\ Oracle\ Opportunity}
\]

历史研究期 Oracle ≈ **+3.81pp**；研究 Capture ≈ **77.4%**。  
Live 目标带：**60%～80%**；若仅 20%～30% → regime dependency 警告。

---

## 四道门（禁止 Shadow→全量）

```text
SHADOW
  → 真实 OOS 有经济价值
CANARY
  → 实际产生增量收益
LIMITED PRODUCTION
  → 稳定
FULL PRODUCTION
```

当前停在 **SHADOW**；Fast Path = **OFF**。

---

## 第一次正式复盘只问三件事

1. 真实 Shadow Alpha 是否为正？  
2. Timing Gain 是否真实存在？  
3. False Fast Path 代价是否仍接近历史研究？  

三者成立，才有 Canary 依据。
