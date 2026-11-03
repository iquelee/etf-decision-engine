#!/usr/bin/env node
'use strict';
// Sidecar inspection only: never edits a frozen capture entry, historical bundle,
// seal, or production database. Bind the result to an explicit downloaded source.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
function sourceFingerprint(root) {
  const map={};
  function walk(dir,rel='') {
    for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
      if(['node_modules','config.json','RELEASE_SOURCE.json'].includes(e.name)||e.name.startsWith('.env'))continue;
      const r=rel ? rel+'/'+e.name : e.name;
      if(e.isDirectory())walk(path.join(dir,e.name),r);
      else map[r]=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,e.name),'utf8').replace(/\r\n/g,'\n')).digest('hex');
    }
  }
  walk(root);
  const sorted=Object.fromEntries(Object.entries(map).sort(([a],[b])=>a.localeCompare(b)));
  return {sha256:crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex'),files:sorted};
}
function inspect(root,expected,observedAt) {
  if(!/^[a-f0-9]{64}$/.test(expected||''))throw new Error('An independently recorded source fingerprint is required.');
  if(!observedAt || !Number.isFinite(Date.parse(observedAt)))throw new Error('An explicit snapshot observation time is required.');
  const fp=sourceFingerprint(root);
  if(fp.sha256!==expected)throw new Error('SOURCE_SNAPSHOT_MISMATCH');
  const source=fs.readFileSync(path.join(root,'index.js'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  const helper=path.join(root,'common/utils/v365-active-read.js');
  const helperPresent=fs.existsSync(helper)&&/function readAuthoritativeDataset/.test(fs.readFileSync(helper,'utf8'));
  const targets={getDashboard:'resolveAuthoritative',getEtfList:'resolveAuthoritative',getEtfDetail:'resolveAuthoritativeDecision',getPortfolio:'resolveAuthoritative',getConstants:'resolvePointerProvenance'};
  const readers=Object.entries(targets).map(([name,call])=>{
    const start=source.indexOf('async function '+name+'(');
    const next=source.indexOf('\nasync function ',start+1);
    const body=start<0?'':source.slice(start,next<0?undefined:next);
    return {name,migrated:helperPresent&&new RegExp('\\b'+call+'\\s*\\(').test(body)};
  });
  return {source_kind:'EXPLICIT_DOWNLOADED_SOURCE_SNAPSHOT',source_root:path.resolve(root),source_observed_at:observedAt,
    source_sha256:fp.sha256,source_file_count:Object.keys(fp.files).length,
    current_reader_status:readers.every(r=>r.migrated)?'MIGRATED':'PENDING',readers,
    historical_reader_status:/readProductionHistory\s*\(db/.test(source)?'RUN_RESOLVER_PRESENT':'LEGACY_OR_UNVERIFIED',
    scope:'Static source evidence only; not live response validation, formal evidence, or a qualification decision.'};
}
module.exports={sourceFingerprint,inspect};
if(require.main===module) {
  try {
    const args=process.argv.slice(2), options={};
    for(let i=0;i<args.length;i+=2) {
      if(!['--source','--expected-source-sha256','--observed-at'].includes(args[i])||!args[i+1])throw new Error('Usage: --source <downloaded function directory> --expected-source-sha256 <receipt fingerprint> --observed-at <ISO time>');
      options[args[i]]=args[i+1];
    }
    console.log(JSON.stringify(inspect(options['--source'],options['--expected-source-sha256'],options['--observed-at']),null,2));
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
