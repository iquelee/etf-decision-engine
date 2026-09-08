# V4.0 Shadow — Sealed Status

**Sealed**: 2026-08-30

```text
V3.6.1
= Production Baseline
= FROZEN

HVT-A-ET-20260830
= ML Challenger Gen-1
= FROZEN

Shadow
= ACTIVE

Fast Path
= NOT CONNECTED

Production
= BLOCKED
```

## Immutable version bundle

See `ml/manifests/SHADOW_BUNDLE_v1.json` and `ml/manifests/ENGINE_V361_v1.json`.

Every Shadow row must carry:

- `engine_version`
- `ml_model_id`
- `feature_version`
- `label_version`
- `calibration_version`
- `threshold_version`

## What this phase is

**Model acceptance** — not model research.

Market tests the frozen Gen-1. Do not retrain / retune / relax Rule.

## Parallel tracks

| Track | Scope |
|-------|--------|
| A Shadow | Observe Gen-1 only |
| B Research | `ml/gen2/` + Qlib / Vibe feature discovery |

A and B must not contaminate each other.

# 五、未来回填字段（reconcile，不得污染当日决策）

`future_*` / `mae` / `mfe` / `outcome_*` 仅由 `shadow-reconcile-outcomes.py` 事后写入。

必含：`model_id`、`decision_hash`、`ml_effective=false`。

## 停止改码纪律

部署与 noop 验收通过后：

- 不改 Gen-1
- 不改阈值
- 不改 Rule Gate
- 不开 Fast Path

连续错误信号也不改模型——全部进 `ml/gen2/`。

```text
SHADOW → CANARY → LIMITED PRODUCTION → FULL PRODUCTION
```

Current stop: **SHADOW**. Fast Path = OFF.

## Dashboard KPI order (fixed)

1. Incremental Alpha  
2. Timing Gain  
3. Fast Path Precision  
4. False Fast Path Cost (MAE)  
5. Calibration  

Then: **CER_live**, Signal Half-Life, Raw/Independent events, regime splits.

## CER_live

`Realized ML Alpha / Historical Oracle Opportunity(+3.81pp)`  
Healthy band: **60%–80%** (research 77.4%).
