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
assert.strictEqual(isSecretRel('src/common/utils/decision.js'), false);

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

// ---- GitHub 令牌形态（2026-09-15 PAT 审计补齐：此前完全不在覆盖内）----
// 注意：令牌体一律用**字符串拼接**构造，避免本文件自身含字面量令牌而把门禁打成假红。
const ghClassicBody = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
assert.ok(looksLikeSecretAssignment('authorization: ' + 'ghp_' + ghClassicBody).length > 0,
  'ghp_ 经典 PAT 必须报警');
assert.ok(looksLikeSecretAssignment('token=' + 'gho_' + ghClassicBody).length > 0,
  'gho_ OAuth 令牌必须报警');
assert.ok(looksLikeSecretAssignment('pat ' + 'github_pat_' + '11ABCDEFG0abcdefghijklmnopqrstuvwxyz').length > 0,
  'github_pat_ 细粒度令牌必须报警');

// 占位符体不得误报（否则文档示例会把 Stage E 打成假红）
assert.strictEqual(looksLikeSecretAssignment('example: ' + 'ghp_' + 'x'.repeat(36)).length, 0,
  'x 填充的文档示例不应报警');
assert.strictEqual(looksLikeSecretAssignment('redacted: ' + 'ghp_' + 'A'.repeat(36)).length, 0,
  '全同字符填充不应报警');
assert.strictEqual(looksLikeSecretAssignment('short ' + 'ghp_' + 'a'.repeat(10)).length, 0,
  '长度不足的串不应报警');

console.log('scan-secrets 12 项通过');
