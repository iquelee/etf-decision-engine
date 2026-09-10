'use strict';

/** G1-06 Domain Gate（G1-11 Gate G1-E）单测。 */
const assert = require('assert');
const { PERMISSION, evaluateDomainPermission } = require('../src/common/utils/gen1-domain-permission');
const { evaluateGen1Permission } = require('../src/common/utils/gen1-safety-permission');

// IN_DOMAIN（biotech 3/3）→ ALLOW
{
  const r = evaluateDomainPermission('biotech', '159570');
  assert.strictEqual(r.status, 'IN_DOMAIN');
  assert.strictEqual(r.permission, PERMISSION.ALLOW);
  assert.strictEqual(r.warning, false);
}

// PARTIAL（storage / ai_network / semi_equip 2/3）→ CANARY_LIMITED + warning
for (const [cat, code] of [['storage', '513310'], ['ai_network', '515880'], ['semi_equip', '159582']]) {
  const r = evaluateDomainPermission(cat, code);
  assert.strictEqual(r.status, 'PARTIAL_COVERAGE', `${cat} must be partial`);
  assert.strictEqual(r.permission, PERMISSION.CANARY_LIMITED);
  assert.strictEqual(r.warning, true);
}

// OUT_OF_DOMAIN（gold 0/3）→ BLOCK_CANARY
{
  const r = evaluateDomainPermission('gold', '518880');
  assert.strictEqual(r.status, 'OUT_OF_DOMAIN');
  assert.strictEqual(r.permission, PERMISSION.BLOCK_CANARY);
}

// 核心验收：518880 P=0.95 + S2 + Safety PASS → 仍 CANARY BLOCK
{
  const gold = evaluateDomainPermission('gold', '518880');
  const p = evaluateGen1Permission({
    params: { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true, gen1_authority: 'CANARY' },
    signal: { date: '2026-09-10', model_id: 'HVT-A-ET-20260830', calibrated_probability: 0.95, rule_gate: 'PERMIT' },
    baseline: { trend_stage_primary: 'S2', v361_baseline_target: 15 },
    risk: { risk_override: false, risk_flag: 'NORMAL' }, fundamental: { f_state: 'F3' },
    snapshot: { structural_break: false, hard_break: false },
    today: '2026-09-10',
    dataHealth: { status: 'OK' }, domainPermission: gold
  });
  assert.strictEqual(p.safety.permission, 'PERMIT', 'Safety 本身通过');
  assert.strictEqual(p.effective_advisory, true, '域外仍可人工参考');
  assert.strictEqual(p.effective_canary, false, '518880 OOD 必须禁止 Fast Path 改 Stage');
  assert.strictEqual(p.domain.reason_code, 'DOMAIN_OUT_OF_DOMAIN');
}

// 未知类别（无覆盖记录）→ 视为域外，canary 关闭
{
  const r = evaluateDomainPermission('quantum_unknown', null);
  assert.strictEqual(r.permission, PERMISSION.BLOCK_CANARY);
}

console.log('gen1 domain gate tests passed');
