#!/usr/bin/env node
'use strict';
// Local-only sealing. Never authenticates, creates resources, or invokes SCF.
const fs = require('fs'), path = require('path'), assert = require('assert');
const {execFileSync} = require('child_process');
const {verifyPackage, sha} = require('../scripts/lib/verified-writer-package');
const {fileMap} = require('./prepare-writer-workers');
const repo = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, {cwd: repo, maxBuffer: 16 * 1024 * 1024});
const args = process.argv.slice(2);
assert(args.length === 8 && args[0] === '--source' && args[2] === '--dependency-root' && args[4] === '--file-map' && args[6] === '--out');
const source = args[1];assert(/^[a-f0-9]{40}$/.test(source));
assert.strictEqual(git('rev-parse', 'HEAD').toString().trim(), source);
assert.strictEqual(git('status', '--porcelain').toString().trim(), '');
const input = verifyPackage(path.resolve(args[3]), path.resolve(args[5]));
const out = path.resolve(args[7]), parent = fs.realpathSync(path.dirname(out));
assert(parent !== repo && !parent.startsWith(repo + path.sep) && !fs.existsSync(out));
const sources = ['writer-admission.js', 'writer-admission-cloudbase.js', 'writer-admission-journal.js', 'writer-journal-cloudbase.js',
  'writer-entry.js', 'writer-local-root.js', 'entry-proof-schedule.js', 'runtime24-native-proof.js', 'runtime24-native-proof-plan.json'];
const plan = JSON.parse(git('show', source + ':release/runtime24-native-proof-plan.json'));
assert(plan.function_name === 'writerNativeIdentity24' && plan.collection === 'runtime24_journal_probe_native_20261103');
assert(plan.maximum_documents === 7 && plan.maximum_business_executions === 1 && plan.production_calls.length === 0);
const dependencies = Object.entries(input.files).filter(([file]) => file.startsWith('node_modules/'));assert.strictEqual(dependencies.length, 1703);
fs.mkdirSync(out);const candidate = path.join(out, 'candidate');fs.mkdirSync(candidate);
const hashes = {};
for (const name of sources) {const file = 'release/' + name, bytes = git('show', source + ':' + file);
  hashes[file] = sha(bytes);fs.writeFileSync(path.join(candidate, name), bytes);}
for (const [file] of dependencies) {const dest = path.join(candidate, file);fs.mkdirSync(path.dirname(dest), {recursive: true});fs.copyFileSync(path.join(input.root, file), dest);}
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
fs.writeFileSync(path.join(candidate, 'index.js'), "'use strict';\nexports.main = require('./runtime24-native-proof').main;\n");
json(path.join(candidate, 'package.json'), {name: 'isolated-native-identity-proof', private: true, version: '1.0.0', dependencies: {'@cloudbase/node-sdk': '2.11.0'}});
json(path.join(candidate, 'config.json'), {permissions: {openapi: []}, timeout: 60, envVariables: {}, triggers: []});
json(path.join(candidate, 'SOURCE_IDENTITY.json'), {source_commit: source, source_files_sha256: hashes,
  dependency_map_sha256: sha(fs.readFileSync(path.resolve(args[5]))), dependency_files: 1703,
  scope: 'New isolated native Timer/local root and header fixture only; no production imports or calls'});
assert.strictEqual(require(path.join(candidate, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
assert.strictEqual(require(path.join(candidate, 'node_modules/@cloudbase/database/package.json')).version, '1.4.1');
const map = fileMap(candidate);assert.strictEqual(Object.keys(map).length, 1716);
assert(Object.keys(map).every(file => file.startsWith('node_modules/') || [...sources, 'index.js', 'package.json', 'config.json', 'SOURCE_IDENTITY.json'].includes(file)));
for (const [file, hash] of dependencies) assert.strictEqual(map[file], hash);
const mapFile = path.join(out, 'candidate.files.json');json(mapFile, map);
const zip = path.join(out, plan.function_name + '.zip');
execFileSync('python', ['-c',
  'import sys,pathlib,json,zipfile,hashlib\nr=pathlib.Path(sys.argv[1]);m=json.loads(pathlib.Path(sys.argv[3]).read_text())\nwith zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for n in sorted(m):\n  i=zipfile.ZipInfo(n,(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,(r/n).read_bytes())\nwith zipfile.ZipFile(sys.argv[2]) as z:assert {i.filename:hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}==m', candidate, zip, mapFile]);
verifyPackage(input.root, path.resolve(args[5]));
assert.strictEqual(git('status', '--porcelain').toString().trim(), '');assert.strictEqual(git('rev-parse', 'HEAD').toString().trim(), source);
const receipt = {status: 'OFFLINE_ONLY_NOT_AUTHORIZED_NOT_DEPLOYED', source_commit: source, function_name: plan.function_name,
  candidate_files: 1716, unchanged_dependency_files: 1703, zip_sha256: sha(fs.readFileSync(zip)),
  map_sha256: sha(fs.readFileSync(mapFile)), source_files_sha256: hashes, cloud_mutations: 0, cloud_invocations: 0,
  fresh_resource_preflight: 'REQUIRED', exact_owner_approval: 'REQUIRED'};
json(path.join(out, 'build-receipt.json'), receipt);console.log(JSON.stringify(receipt, null, 2));
