#!/usr/bin/env node
'use strict';
// Offline pair sealing. No credentials, deployment, invocation or timer APIs.
const fs = require('fs'), path = require('path'), assert = require('assert');
const {execFileSync} = require('child_process');
const {verifyPackage, sha} = require('../scripts/lib/verified-writer-package');
const repo = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, {cwd: repo});
const args = process.argv.slice(2);
assert(args.length === 8 && args[0] === '--source' && args[2] === '--dependency-root' && args[4] === '--file-map' && args[6] === '--out');
const source = args[1]; assert(/^[a-f0-9]{40}$/.test(source));
assert.strictEqual(git('rev-parse', 'HEAD').toString().trim(), source);
assert.strictEqual(git('status', '--porcelain').toString().trim(), '', 'clean committed source required');
const baseline = verifyPackage(path.resolve(args[3]), path.resolve(args[5]));
let out = path.resolve(args[7]); assert(!fs.existsSync(out));
out = path.join(fs.realpathSync(path.dirname(out)), path.basename(out)); assert(out !== repo && !out.startsWith(repo + path.sep));
const plan = JSON.parse(git('show', source + ':release/runtime24-entry-proof-plan.json'));
assert(plan.root_name === 'writerEntryFacade24' && plan.worker_name === 'writerEntryWorker24');
assert(plan.collection === 'runtime24_journal_probe_entry_20261102' && plan.maximum_expected_total_calls === 6 && plan.maximum_documents === 7);
const wanted = ['writer-admission.js', 'writer-admission-cloudbase.js', 'writer-admission-journal.js', 'writer-journal-cloudbase.js',
  'writer-entry.js', 'runtime24-entry-proof.js', 'runtime24-entry-proof-plan.json'].map(file => 'release/' + file);
assert.deepStrictEqual([...plan.source_files].sort(), wanted.sort());
const dependencies = Object.entries(baseline.files).filter(([name]) => name.startsWith('node_modules/')); assert.strictEqual(dependencies.length, 1703);
fs.mkdirSync(out);
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const packages = {};
for (const role of ['root', 'worker']) {
  const dir = path.join(out, role); fs.mkdirSync(dir);
  const candidate = path.join(dir, 'candidate'); fs.mkdirSync(candidate);
  const hashes = {};
  for (const file of wanted) { const bytes = git('show', source + ':' + file); fs.writeFileSync(path.join(candidate, path.basename(file)), bytes); hashes[file] = sha(bytes); }
  for (const [file] of dependencies) {
    const dest = path.join(candidate, file); fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.copyFileSync(path.join(baseline.root, file), dest);
  }
  const timeout = role === 'root' ? plan.root_timeout_seconds : plan.worker_timeout_seconds;
  const name = role === 'root' ? plan.root_name : plan.worker_name;
  write(path.join(candidate, 'package.json'), {name: 'isolated-writer-entry-proof', version: '1.0.0', private: true, dependencies: {'@cloudbase/node-sdk': plan.sdk_version}});
  assert.strictEqual(require(path.join(candidate, 'node_modules/@cloudbase/node-sdk/package.json')).version, plan.sdk_version);
  assert.strictEqual(require(path.join(candidate, 'node_modules/@cloudbase/database/package.json')).version, plan.database_version);
  fs.writeFileSync(path.join(candidate, 'index.js'), "'use strict';\nexports.main = (event, context) => require('./runtime24-entry-proof').main('" + role + "', event, context);\n");
  write(path.join(candidate, 'config.json'), {permissions: {openapi: []}, timeout, envVariables: {}, triggers: []});
  write(path.join(candidate, 'SOURCE_IDENTITY.json'), {source_commit: source, role, function_name: name, source_files_sha256: hashes,
    independent_dependency_map_sha256: sha(fs.readFileSync(path.resolve(args[5]))), dependency_files: 1703,
    scope: 'Isolated bounded timer/retry and signed transport fixture; no production business imports'});
  const files = {};
  function walk(d) { for (const item of fs.readdirSync(d).sort()) {
    const file = path.join(d, item); assert(!fs.lstatSync(file).isSymbolicLink());
    if (fs.statSync(file).isDirectory()) walk(file); else files[path.relative(candidate, file).split(path.sep).join('/')] = sha(fs.readFileSync(file));
  } }
  walk(candidate); assert.strictEqual(Object.keys(files).length, 1714);
  assert(Object.keys(files).every(file => file.startsWith('node_modules/') ||
    [...wanted.map(file => path.basename(file)), 'package.json', 'index.js', 'config.json', 'SOURCE_IDENTITY.json'].includes(file)));
  for (const [file, hash] of dependencies) assert.strictEqual(files[file], hash);
  const map = path.join(dir, 'candidate.files.json'); write(map, files);
  const zip = path.join(dir, name + '-candidate.zip');
  execFileSync('python', ['-c',
    'import sys,pathlib,json,zipfile,hashlib\nr=pathlib.Path(sys.argv[1]);m=json.loads(pathlib.Path(sys.argv[3]).read_text())\nwith zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for n in sorted(m):\n  i=zipfile.ZipInfo(n,(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,(r/n).read_bytes())\nwith zipfile.ZipFile(sys.argv[2]) as z:assert {i.filename:hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}==m', candidate, zip, map]);
  packages[role] = {function_name: name, timeout_seconds: timeout, candidate_files: 1714, unchanged_dependency_files: 1703,
    zip_sha256: sha(fs.readFileSync(zip)), file_map_sha256: sha(fs.readFileSync(map)), source_files_sha256: hashes};
}
verifyPackage(baseline.root, path.resolve(args[5]));
const receipt = {status: 'LOCAL_CANDIDATE_NOT_DEPLOYED', source_commit: source, environment: plan.environment, collection: plan.collection,
  packages, maximum_expected_total_calls: 6, maximum_documents: 7, cloud_mutations: 0, cloud_invocations: 0};
write(path.join(out, 'build-receipt.json'), receipt); console.log(JSON.stringify(receipt, null, 2));
