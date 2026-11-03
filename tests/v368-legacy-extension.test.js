'use strict';
const assert=require('assert'),crypto=require('crypto');
const {evaluate,EXTENSION}=require('../release/verify-legacy-divergence');
const bytes=Buffer.from('reviewed bytes\n');
const sha=crypto.createHash('sha256').update(bytes).digest('hex');
assert.strictEqual(Object.keys(EXTENSION).length,5);
const error={code:'V364_CODE_HASH_MISMATCH',detail:'scripts/test-all.js'};
let r=evaluate([error],{'scripts/test-all.js':sha},()=>bytes);
assert.strictEqual(r.violations.length,0);assert.strictEqual(r.acknowledged_v368.length,1);
r=evaluate([error],{'scripts/test-all.js':sha},()=>Buffer.from('tampered'));
assert.strictEqual(r.violations.length,1);
r=evaluate([{code:'V364_LOCK_ANCHOR_MISMATCH',detail:'scripts/test-all.js'}],{'scripts/test-all.js':sha},()=>bytes);
assert.strictEqual(r.violations.length,1);
for (const code of require('../scripts/v364-legacy-ack-gate').NEVER_ALLOWLISTABLE_7) {
  r=evaluate([{code,detail:'scripts/test-all.js'}],{'scripts/test-all.js':sha},()=>bytes);
  assert.strictEqual(r.violations.length,1,code+' must remain forbidden');
}
r=evaluate([{code:'V364_UNEXPECTED_SURFACE_FILE',detail:'src/common/utils/unknown.js'}],{},()=>bytes);
assert.strictEqual(r.violations.length,1);
const gen2File='scripts/writer-gen2-timer-compatibility.js';
r=evaluate([{code:'V364_UNEXPECTED_SURFACE_FILE',detail:gen2File}],{});
assert.strictEqual(r.violations.length,0);assert.strictEqual(r.acknowledged_writer_validation.length,1);
r=evaluate([{code:'V364_UNEXPECTED_SURFACE_FILE',detail:gen2File}],{},()=>Buffer.from('tampered'));
assert.strictEqual(r.violations.length,1);assert.strictEqual(r.violations[0].reason,'CANDIDATE_HASH_MISMATCH');
for (const code of require('../scripts/v364-legacy-ack-gate').NEVER_ALLOWLISTABLE_7)
  assert.strictEqual(evaluate([{code,detail:gen2File}],{}).violations.length,1);
assert.strictEqual(evaluate([{code:'V364_UNEXPECTED_SURFACE_FILE',detail:'scripts/writer-gen2-timer-unknown.js'}],{}).violations.length,1);
console.log('v368 legacy extension: exact scope, candidate hash, permanent forbidden errors and unknown-file rejection PASS');
