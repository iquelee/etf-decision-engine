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
module.exports={EXTENSION,evaluate,verify};
if(require.main===module) {
  try {const r=verify();console.log(JSON.stringify(r,null,2));if(!r.ok)process.exitCode=1;}
  catch(e){console.error(e.message);process.exitCode=1;}
}
