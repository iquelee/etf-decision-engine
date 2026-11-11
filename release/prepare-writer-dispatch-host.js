#!/usr/bin/env node
'use strict';
// Offline only; vendor the sealed SDK tree without installer or cloud calls.
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const {fileMap,verifyInput}=require('./prepare-writer-workers');
const {assertCoreWriters}=require('./runtime24-v3-core-scope');
const repo=path.resolve(__dirname,'..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:16*1024*1024});
const modules=['writer-dispatch-host','writer-dispatch-queue','writer-dispatch-executor','writer-dispatch-cloudbase','writer-dispatch-plan',
  'writer-journal-cloudbase','writer-admission','writer-admission-cloudbase','writer-admission-journal','writer-entry','runtime24-v3-core-scope'];
function build({source,inventoryRoot,out}) {
  assertCoreWriters(['adminGateway']);assert(/^[a-f0-9]{40}$/.test(source));assert.strictEqual(git('rev-parse','HEAD').toString().trim(),source);
  assert.strictEqual(git('status','--porcelain').toString().trim(),'','clean source required');
  out=path.resolve(out);const parent=fs.realpathSync(path.dirname(out));assert(parent!==repo && !parent.startsWith(repo+path.sep));assert(!fs.existsSync(out));
  inventoryRoot=fs.realpathSync(inventoryRoot);
  const inventory=JSON.parse(git('show',source+':release/runtime24-writer-inventory.json'));
  const record=inventory.functions.find(f=>f.FunctionName==='adminGateway'),input=path.join(inventoryRoot,'adminGateway-download'),rawMap=path.join(inventoryRoot,'adminGateway.files.json');
  const original=verifyInput(input,rawMap,record.download.raw_file_map_sha256);
  const deps=Object.keys(original).filter(file=>file.startsWith('node_modules/'));assert(deps.length===1703);
  const target='writerDispatchNode24';fs.mkdirSync(out);const root=path.join(out,target);fs.mkdirSync(root);
  for(const file of deps){const dest=path.join(root,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(input,file),dest);}
  const sources={};for(const file of [...modules.map(m=>m+'.js'),'runtime24-v3-core-scope.json']) {
    const blob=git('show',source+':release/'+file);fs.writeFileSync(path.join(root,file),blob);sources['release/'+file]=sha(blob);
  }
  const json=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
  const index="'use strict';\nconst sdk = require('@cloudbase/node-sdk');\nconst host = require('./writer-dispatch-host').createHost({sdk,\n  sdkVersion: require('@cloudbase/node-sdk/package.json').version, databaseVersion: require('@cloudbase/database/package.json').version,\n  batchSize: 2, transportTimeoutMs: 15000});\nexports.main = host.main;\n";
  fs.writeFileSync(path.join(root,'index.js'),index);
  json('package.json',{name:'writer-dispatch-node24-candidate',version:'0.0.0',private:true,main:'index.js',dependencies:{'@cloudbase/node-sdk':'2.11.0'}});
  json('config.json',{timeout:120,permissions:{openapi:[]},envVariables:{},triggers:[]});
  json('SOURCE_IDENTITY.json',{status:'OFFLINE_DISPATCH_HOST_NOT_QUALIFIED',release_scope:'V3_CORE_ONLY',source_commit:source,target,runtime:'Nodejs24.11',
    source_files_sha256:sources,sdk_library_input:'adminGateway',input_map_sha256:record.download.raw_file_map_sha256,
    batch_size:2,transport_timeout_ms:15000,function_timeout_seconds:120,memory_mb:256,
    resource_creation:'NONE',triggers:'NONE',signing_keys:'ABSENT',long_task_and_platform_qualification:'NOT_PROVEN',dependency_install:'FORBIDDEN_PRESERVE_VENDORED_BYTES'});
  assert.strictEqual(require(path.join(root,'node_modules/@cloudbase/node-sdk/package.json')).version,'2.11.0');
  assert.strictEqual(require(path.join(root,'node_modules/@cloudbase/database/package.json')).version,'1.4.1');
  const files=fileMap(root);for(const file of deps)assert.strictEqual(files[file],original[file]);
  const map=path.join(out,target+'.files.json'),zip=path.join(out,target+'.zip');fs.writeFileSync(map,JSON.stringify(files,null,2)+'\n');
  execFileSync('python',['-c','import pathlib,zipfile,json,hashlib,sys\nr=pathlib.Path(sys.argv[1]);m=json.loads(pathlib.Path(sys.argv[2]).read_text())\nwith zipfile.ZipFile(sys.argv[3],"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for n in sorted(m):\n  i=zipfile.ZipInfo(n,(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,(r/n).read_bytes())\nwith zipfile.ZipFile(sys.argv[3]) as z: assert {i.filename:hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}==m',root,map,zip]);
  verifyInput(input,rawMap,record.download.raw_file_map_sha256);assert.strictEqual(git('status','--porcelain').toString().trim(),'');
  const receipt={status:'OFFLINE_ONLY_NOT_DEPLOYED_OR_QUALIFIED',release_scope:'V3_CORE_ONLY',source_commit:source,target,
    output_files:Object.keys(files).length,unchanged_dependencies:deps.length,zip_sha256:sha(fs.readFileSync(zip)),map_sha256:sha(fs.readFileSync(map)),
    sdk_input_map_sha256:record.download.raw_file_map_sha256,cloud_calls:0,cloud_mutations:0};
  fs.writeFileSync(path.join(out,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
if(require.main===module){const args=process.argv.slice(2);assert(args.length===6 && args[0]==='--source' && args[2]==='--inventory-root' && args[4]==='--out');console.log(JSON.stringify(build({source:args[1],inventoryRoot:args[3],out:args[5]}),null,2));}
module.exports={build};
