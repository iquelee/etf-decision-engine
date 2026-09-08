# V4.0 Formal State — SHADOW ACTIVE (Sealed)

**Sealed after deploy + noop acceptance**: 2026-08-30

```text
V3.6.1              Production Core   FROZEN
HVT-A-ET-20260830   Gen-1 Challenger  FROZEN
Shadow Observe      ON
Fast Path           OFF
Production ML       BLOCKED
Gen-2               Research Only
```

## Online verification (PASS)

File: `ml/shadow/HVT-A-ET-20260830/acceptance_noop.json`

```text
production_engine_v361     = true
ml_shadow.enabled          = true
ml_shadow.effective        = false
ml_shadow.fast_path_enabled= false
Target/Action before=after = PASS
```

Returned `ml_shadow`:

```json
{
  "enabled": true,
  "effective": false,
  "observe": true,
  "fast_path_enabled": false,
  "model_id": "HVT-A-ET-20260830",
  "engine_version": "v3.6.1",
  "note": "ML observing only — no authority to change production decisions"
}
```

## What to do now

1. **Stop changing Gen-1 / V3.6.1 / thresholds / Fast Path.**
2. Daily: `bash scripts/ops/run-shadow-eod.sh [YYYY-MM-DD]`
3. Gen-2 only under `ml/gen2/` — never touch Gen-1.
4. First review only after real OOS across Bull / Range / Risk-off.

## Canary is NOT next

Canary waits for live OOS evidence, not historical counterfactual (+2.95pp).

## Redeploy / accept commands (ops only)

```bash
node scripts/prepare-functions.js
node scripts/deploy-runDecisionEngine-ml-shadow.js
node scripts/accept-ml-shadow-noop.js
```

## UI Shadow Observe (2026-08-30)

Frontend consume-only layer (no strategy change):

- Dashboard: Shadow status card (`ml_shadow`)
- EtfDetail: ML Shadow observe card (production vs counterfactual)
- DecisionChain: `OBSERVE ONLY` marker

API: `GET /api/dashboard` and `GET /api/etf/:code` return unified `ml_shadow`.
`effective=false` · `fast_path_enabled=false` always in Observe phase.

Deploy: `node scripts/deploy-apiGateway-ml-shadow-ui.js` (RequestId logged on success).
