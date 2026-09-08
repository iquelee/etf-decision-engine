'use strict';
const assert = require('assert');
const path = require('path');
const {
  isPlaceholder, isSecretRel, looksLikeSecretAssignment
} = require('../scripts/scan-secrets.js');

assert.strictEqual(isPlaceholder('{{FRED_API_KEY}}'), true);
assert.strictEqual(isPlaceholder(''), true);
assert.strictEqual(isPlaceholder('not-a-placeholder-key'), false);

assert.strictEqual(isSecretRel('cloudbaserc.json'), true);
assert.strictEqual(isSecretRel('cloudfunctions/fetchDailyData/config.json'), true);
assert.strictEqual(isSecretRel('cloudfunctions/fetchDailyData/config.example.json'), false);
assert.strictEqual(isSecretRel('cloudbaserc.example.json'), false);
assert.strictEqual(isSecretRel('web/.env'), true);
assert.strictEqual(isSecretRel('web/.env.example'), false);
assert.strictEqual(isSecretRel('cloudfunctions/common/utils/decision.js'), false);

const clean = looksLikeSecretAssignment('{"FRED_API_KEY":"{{FRED_API_KEY}}","DEEPSEEK_API_KEY":"{{DEEPSEEK_API_KEY}}","OPENDART_API_KEY":"{{OPENDART_API_KEY}}"}');
assert.strictEqual(clean.length, 0, '占位符不应报警');

const dirtyFred = looksLikeSecretAssignment('{"' + 'FRED' + '_API_KEY":"' + 'a'.repeat(32) + '"}');
assert.ok(dirtyFred.length > 0, '非占位 FRED 应报警');

const dirtySk = looksLikeSecretAssignment('token ' + 'sk-' + 'a'.repeat(24));
assert.ok(dirtySk.length > 0, 'sk- 形态应报警');

const dirtyEnv = looksLikeSecretAssignment('FRED_API_KEY=' + 'a'.repeat(32));
assert.ok(dirtyEnv.length > 0, '.env 形态非占位 FRED 应报警');

const cleanEnv = looksLikeSecretAssignment('FRED_API_KEY={{FRED_API_KEY}}');
assert.strictEqual(cleanEnv.length, 0, '.env 占位符不应报警');

const examplePath = path.join(__dirname, '../cloudbaserc.example.json');
const exampleHits = looksLikeSecretAssignment(require('fs').readFileSync(examplePath, 'utf8'));
assert.strictEqual(exampleHits.length, 0, 'example 模板不得被判为泄露');

console.log('scan-secrets 8 项通过');
