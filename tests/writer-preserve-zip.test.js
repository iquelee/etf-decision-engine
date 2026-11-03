'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const {spawnSync} = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-zip-types-'));
const helper = path.resolve(__dirname, '../release/writer-preserve-zip.py');
const program = String.raw`
import hashlib,json,pathlib,stat,subprocess,sys,zipfile
r=pathlib.Path(sys.argv[1]); helper=sys.argv[2]; tree=r/'tree';tree.mkdir()
files={'index.js':b'original','node_modules/tool.js':b'tool','node_modules/.bin/tool':b'../tool.js'}
for name,data in files.items():
 p=tree/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
original=r/'original.zip'
with zipfile.ZipFile(original,'x') as z:
 for name,data in files.items():
  i=zipfile.ZipInfo(name);i.create_system=3;i.external_attr=(0o120777 if '/.bin/' in name else 0o100755)<<16;z.writestr(i,data)
(tree/'business.js').write_bytes(files['index.js']);(tree/'index.js').write_bytes(b'wrapper')
expected={p.relative_to(tree).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in tree.rglob('*') if p.is_file()}
mapping=r/'map.json';mapping.write_text(json.dumps(expected));out=r/'out.zip'
result=subprocess.run([sys.executable,helper,str(original),hashlib.sha256(original.read_bytes()).hexdigest(),str(tree),str(mapping),str(out)],capture_output=True,text=True)
assert result.returncode==0,result.stderr
assert json.loads(result.stdout)['preserved_symlinks']==['node_modules/.bin/tool']
with zipfile.ZipFile(out) as z:
 assert stat.S_ISLNK(z.getinfo('node_modules/.bin/tool').external_attr>>16)
 assert z.read('node_modules/.bin/tool')==b'../tool.js'
 assert z.getinfo('business.js').external_attr==0o100755<<16
 assert z.read('business.js')==b'original' and z.read('index.js')==b'wrapper'
for kind,name,target in [('traversal','../escape',b'bad'),('link','node_modules/.bin/tool',b'../../../escape')]:
 bad=r/(kind+'.zip')
 with zipfile.ZipFile(bad,'x') as z:
  i=zipfile.ZipInfo(name);i.create_system=3;i.external_attr=(0o120777 if kind=='link' else 0o100644)<<16;z.writestr(i,target)
 dest=r/(kind+'-out.zip')
 failed=subprocess.run([sys.executable,helper,str(bad),hashlib.sha256(bad.read_bytes()).hexdigest(),str(tree),str(mapping),str(dest)],capture_output=True,text=True)
 assert failed.returncode!=0 and not dest.exists()
print('offline ZIP: executable modes, npm link types, renamed business bytes and unsafe path/link rejection PASS')
`;
const result = spawnSync(process.env.TCB_PYTHON || 'python', ['-c', program, root, helper], {encoding: 'utf8'});
assert.strictEqual(result.status, 0, String(result.stderr));console.log(result.stdout.trim());
