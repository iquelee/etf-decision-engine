'use strict';
const assert=require('assert'),path=require('path');
const {spawnSync}=require('child_process');
const program=String.raw`
import importlib.util,json,pathlib,sys,tempfile,zipfile
spec=importlib.util.spec_from_file_location('prepare',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root=pathlib.Path(tempfile.mkdtemp(prefix='etf-prepare-'));m.REPO=str(root)
baseline=root/'baseline';baseline.mkdir()
out=root/'dist-functions'/'apiGateway'
(out/'node_modules').mkdir(parents=True)
(out/'node_modules'/'stale.js').write_text('stale')
other=root/'dist-functions'/'runDecisionEngine';other.mkdir()
(other/'sentinel').write_text('preserve')
archive=baseline/'apiGateway.zip'
with zipfile.ZipFile(archive,'w') as z:
 z.writestr('node_modules/@cloudbase/node-sdk/package.json','{}')
 z.writestr('config.json',json.dumps({'timeout':45}))
sys.argv=['prepare','--functions','apiGateway','--baseline',str(baseline),'--env','explicit-test-environment']
m.main()
assert not (out/'node_modules'/'stale.js').exists()
assert (out/'node_modules'/'@cloudbase'/'node-sdk'/'package.json').exists()
assert (other/'sentinel').read_text()=='preserve'
config=json.loads((root/'cloudbaserc.json').read_text())
assert config['envId']=='explicit-test-environment'
assert [f['name'] for f in config['functions']]==['apiGateway']
with zipfile.ZipFile(archive,'w') as z:
 z.writestr('node_modules/@cloudbase/node-sdk/package.json','{}')
 z.writestr('node_modules/../../escaped.txt','bad')
try:m.main()
except ValueError:pass
else:raise AssertionError('zip traversal was accepted')
assert not (root/'dist-functions'/'escaped.txt').exists()
print('dependency restoration: selected scope, explicit environment, stale cache removal, ZIP traversal rejection PASS')
`;
const result=spawnSync(process.env.TCB_PYTHON || (process.platform==='win32'?'python':'python3'),['-c',program,path.resolve(__dirname,'../scripts/prepare-deploy.py')],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});
assert.strictEqual(result.status,0,(result.stderr||'')+(result.stdout||''));
console.log(result.stdout.trim().split('\n').slice(-1)[0]);
