'use strict';

const assert = require('assert');
const { getCategoryCoverage, capabilityForApi } = require('../src/common/utils/gen1-capability');
const { buildEtfMlShadow } = require('../src/common/utils/ml-shadow');

const gold = getCategoryCoverage('gold');
assert.deepStrictEqual(
  { observed: gold.observed_folds, total: gold.total_folds, domain: gold.domain_status },
  { observed: 0, total: 3, domain: 'OUT_OF_DOMAIN' }
);

for (const sector of ['storage', 'ai_network', 'semi_equip']) {
  const coverage = getCategoryCoverage(sector);
  assert.strictEqual(coverage.observed_folds, 2, `${sector} must remain partial coverage`);
  assert.strictEqual(coverage.domain_status, 'PARTIAL_COVERAGE');
}

const biotech = getCategoryCoverage('biotech');
assert.strictEqual(biotech.domain_status, 'IN_DOMAIN');
assert.strictEqual(biotech.observed_folds, 3);

const capability = capabilityForApi();
assert.strictEqual(capability.ranking, 'PASS');
assert.strictEqual(capability.threshold, 'UNPROVEN');
assert.strictEqual(capability.live_oos, 'PENDING');

const historicalGold = buildEtfMlShadow(
  { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true },
  { final_target: 0, trend_stage_primary: 'S3' },
  { code: '518880', date: '2026-09-01', stage: 'S3', signal_status: 'NO_OPPORTUNITY' }
);
assert.strictEqual(historicalGold.category, 'gold');
assert.strictEqual(historicalGold.domain_status, 'OUT_OF_DOMAIN');
assert.strictEqual(historicalGold.model_capability.threshold, 'UNPROVEN');
console.log('gen1 capability metadata tests passed');
