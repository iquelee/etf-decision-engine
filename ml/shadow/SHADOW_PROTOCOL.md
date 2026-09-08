# V4.0 Shadow Protocol — HVT-A Early Transition (Sealed)

**生效**：2026-08-30  
**Model**：`HVT-A-ET-20260830`  
**Bundle**：`ml/manifests/SHADOW_BUNDLE_v1.json`（不可变）

```text
V3.6.1              = Production Baseline = FROZEN
HVT-A-ET-20260830   = ML Challenger Gen-1 = FROZEN
Shadow              = ACTIVE
Fast Path           = NOT CONNECTED
Production          = BLOCKED
```

本阶段是 **模型验收**，不是继续研发 Gen-1。

---

## 冻结纪律

1. V3.6.1 Stage / Target / Risk / Cap — 冻结  
2. Gen-1 特征 / 标签 / 校准 / 阈值 — 冻结  
3. Shadow 数据只评估，禁止回流训练  
4. 线上仓位仍只跑 V3.6.1  
5. Gen-2 / Vibe 只进 `ml/gen2/`，不得污染 Shadow  

---

## Signal Ledger v2（每条信号）

必填：`date, code, stage, ml_probability, calibrated_probability, rule_gate, permission_class, fast_path_would_trigger, v361_target, ml_counterfactual_target, delta_target`  

延迟填：`future_5d_stage, future_10d_stage, future_10d_return, mae, mfe, outcome_class`  

版本戳：`engine_version, ml_model_id, feature_version, label_version, calibration_version, threshold_version`

### Permission / Outcome

| 类 | 含义 | 本阶段动作 |
|----|------|------------|
| A | ML Fast + Rule Permit（Effective） | 观察 |
| B | ML Fast + Rule Block（Blocked Opportunity） | 只记；不改 Rule |
| C | ML 未 Fast，后来进 S4（Missed） | 只记 |
| D | ML Fast 且 Permit，未形成 S4（False Fast） | 计入 False Cost |

---

## 五个生产 KPI

1. Incremental Alpha  
2. Timing Gain  
3. Fast Path Precision  
4. False Fast Path Cost（MAE）  
5. Calibration  

附加：`ShadowCaptureEfficiency`；Raw vs Independent Event Count；Bull/Range/Bear 分拆。

---

## 分层熔断

见 `ml/CIRCUIT_BREAKER.md`：WARNING → DEGRADED → ML_OFF。

---

## 运行

```bash
python3 scripts/ml/shadow-daily-log.py --date=YYYY-MM-DD
python3 scripts/ml/shadow-reconcile-outcomes.py
python3 scripts/ml/shadow-summary.py
```

官方 OOS：`train_end=2026-08-24` 之后。历史回放用 `--rehearsal`，不计入官方 degrade。

---

## Canary 门（非日历）

需同时经历 Bull + Range + Risk-off；Incremental Alpha>0；Precision / Calibration / False Cost / MaxDD 可接受。
