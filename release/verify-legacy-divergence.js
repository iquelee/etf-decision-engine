#!/usr/bin/env node
'use strict';
// Preserve V364's lock, verifier, 61-entry acknowledgement and permanent seven
// forbidden errors. This candidate has a separate, hash-bound five-file delta.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const base=require('../scripts/v364-legacy-ack-gate');
const verifier=require('../scripts/verify-v364-immutable');
const candidate=require('../scripts/verify-v365-candidate-manifest');
const ROOT=path.resolve(__dirname,'..');
const EXTENSION=Object.freeze({
  'scripts/test-all.js':'V364_CODE_HASH_MISMATCH',
  'scripts/release-preflight.js':'V364_UNEXPECTED_SURFACE_FILE',
  'scripts/tools/reader-source-audit.js':'V364_UNEXPECTED_SURFACE_FILE',
  'src/common/utils/production-history.js':'V364_UNEXPECTED_SURFACE_FILE',
  'src/common/utils/release-identity.js':'V364_UNEXPECTED_SURFACE_FILE'
});
function evaluate(errors,hashes,readFile = p=>fs.readFileSync(path.join(ROOT,p))) {
  const first=base.classify(errors,base.ACKNOWLEDGED_DIVERGENCE_V364,base.NEVER_ALLOWLISTABLE_7);
  const acknowledged=[],violations=[];
  for(const e of first.violations) {
    if(base.NEVER_ALLOWLISTABLE_7.includes(e.code)||EXTENSION[e.path]!==e.code||!hashes[e.path]) {violations.push(e);continue;}
    const sha=crypto.createHash('sha256').update(readFile(e.path).toString('utf8').replace(/\r\n/g,'\n')).digest('hex');
    if(sha!==hashes[e.path])violations.push({...e,reason:'CANDIDATE_HASH_MISMATCH'});
    else acknowledged.push({path:e.path,code:e.code,sha256:sha});
  }
  return {acknowledged_base:first.acknowledged.length,acknowledged_v368:acknowledged,violations};
}
function verify() {
  const manifest=JSON.parse(fs.readFileSync(candidate.MANIFEST,'utf8'));
  if(manifest.engine_version!=='v3.6.8')throw new Error('This extension is bound to the v3.6.8 candidate only.');
  const current=candidate.verify();
  const classified=evaluate(verifier.verify().errors,manifest.file_sha256);
  return {...classified,ok:base.staticChecks().ok&&current.ok&&classified.violations.length===0,
    candidate_errors:current.errors,meaning:'Explicit legacy divergence acknowledgement; not a V364 invariant PASS or a deployment approval.'};
}
function selftest() {
  const assert=require('assert');
  const manifest=JSON.parse(fs.readFileSync(candidate.MANIFEST,'utf8'));
  const errors=verifier.verify().errors;
  assert.strictEqual(verify().ok,true,'candidate baseline must pass before negative proofs');
  assert.strictEqual(evaluate(errors,manifest.file_sha256).acknowledged_v368.length,5);
  const removed=base.classify(errors,{},base.NEVER_ALLOWLISTABLE_7);
  assert.strictEqual(removed.acknowledged.length,0);
  assert.strictEqual(removed.violations.length,errors.length,'empty base allowlist must reject every emitted error');
  for(const code of ['V364_CODE_HASH_MISMATCH','V364_UNEXPECTED_SURFACE_FILE',...base.NEVER_ALLOWLISTABLE_7]) {
    const result=evaluate(errors.concat([{code,detail:'scripts/zzz-synthetic-probe.js'}]),manifest.file_sha256);
    assert.strictEqual(result.violations.length,1,`${code} injected error must fail independently`);
  }
  const tampered=evaluate(errors,manifest.file_sha256,p=>p==='scripts/test-all.js'?Buffer.from('tampered'):fs.readFileSync(path.join(ROOT,p)));
  assert.strictEqual(tampered.violations.length,1);
  assert.strictEqual(tampered.violations[0].reason,'CANDIDATE_HASH_MISMATCH');
  assert.strictEqual(verify().ok,true,'restored real candidate must pass');
  return {ok:true,proofs:'empty allowlist; unknown hash/surface; all seven forbidden errors; candidate tamper; restored candidate',frozen_base_modified:false};
}
module.exports={EXTENSION,evaluate,verify,selftest};
if(require.main===module) {
  try {const r=process.argv.includes('--selftest')?selftest():verify();console.log(JSON.stringify(r,null,2));if(!r.ok)process.exitCode=1;}
  catch(e){console.error(e.message);process.exitCode=1;}
}
