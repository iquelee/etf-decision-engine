'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseFiniteNumber, isDateStr } = require('../cloudfunctions/common/utils/request-validate');

assert.strictEqual(parseFiniteNumber('12.5', { min: 0, max: 100 }), 12.5);
assert.throws(() => parseFiniteNumber('NaN', { name: 'price' }), /price 必须是有效数字/);
assert.throws(() => parseFiniteNumber(-1, { name: 'position_after', min: 0, max: 100 }), /超出范围/);
assert.strictEqual(isDateStr('2026-09-01'), true);
assert.strictEqual(isDateStr('2026-02-30'), false);

const api = fs.readFileSync(path.join(__dirname, '../cloudfunctions/apiGateway/index.js'), 'utf8');
assert.doesNotMatch(api, /path === '\/api\/portfolio'[\s\S]{0,180}requireAuth\(event\)/, 'personal read-only portfolio route is public');
assert.match(api, /filteredTrades\.map/, 'review output must use filtered trades');
assert.match(api, /接口已迁移至后台管理端/, 'anonymous intel refresh must be removed');
assert.match(api, /sanitizePublicDashboard/, 'dashboard must use public allowlist');
assert.match(api, /sanitizePublicExplainChain/, 'public explain chain must redact account fields');
assert.match(api, /position: pos \|\| null/, 'personal site exposes read-only position data');

console.log('security-hotfix tests passed');
