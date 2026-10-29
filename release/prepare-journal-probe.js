#!/usr/bin/env node
'use strict';
// Offline sealing only. No deployment API, credentials, or network.
const fs = require('fs'), path = require('path'), assert = require('assert');
const {execFileSync} = require('child_process');
const {verifyPackage, sha} = require('../scripts/lib/verified-writer-package');
const repo = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, {cwd: repo});
const args = process.argv.slice(2);
assert(args.length === 8 && args[0] === '--source' && args[2] === '--dependency-root'
  && args[4] === '--file-map' && args[6] === '--out',
  'Usage: --source <40SHA> --dependency-root <independent-package> --file-map <map> --out <new-directory>');
const source = args[1]; assert(/^[a-f0-9]{40}$/.test(source));
assert.strictEqual(git('rev-parse', 'HEAD').toString().trim(), source);
assert.strictEqual(git('status', '--porcelain').toString().trim(), '', 'clean committed source required');
const baseline = verifyPackage(path.resolve(args[3]), path.resolve(args[5]));
let out = path.resolve(args[7]);
assert(!fs.existsSync(out));
out = path.join(fs.realpathSync(path.dirname(out)), path.basename(out));
assert(out !== repo && !out.startsWith(repo + path.sep));
const plan = JSON.parse(git('show', source + ':release/runtime24-journal-probe-plan.json'));
assert.strictEqual(plan.function_name, 'writerJournalRuntime24');
assert.strictEqual(plan.collection, 'runtime24_journal_probe_20261029');
const mappings = {
  'release/writer-admission.js': 'writer-admission.js',
  'release/writer-admission-cloudbase.js': 'writer-admission-cloudbase.js',
  'release/writer-admission-journal.js': 'writer-admission-journal.js',
  'release/writer-journal-cloudbase.js': 'writer-journal-cloudbase.js',
  'release/runtime24-journal-probe.js': 'probe.js',
  'release/runtime24-journal-probe-plan.json': 'runtime24-journal-probe-plan.json'
};
assert.deepStrictEqual(Object.keys(mappings).sort(), [...plan.source_files].sort());
fs.mkdirSync(out);
const candidate = path.join(out, 'candidate'); fs.mkdirSync(candidate);
const archive = path.join(out, 'source.zip');
fs.writeFileSync(archive, git('-c', 'core.autocrlf=false', '-c', 'core.eol=lf',
  'archive', '--format=zip', source, '--', ...Object.keys(mappings)));
execFileSync('python', ['-c',
  'import sys,json,zipfile,pathlib\nm=json.loads(sys.argv[3]); root=pathlib.Path(sys.argv[2])\nwith zipfile.ZipFile(sys.argv[1]) as z:\n names={i.filename for i in z.infolist() if not i.is_dir()}; assert names==set(m)\n for name,target in m.items(): (root/target).write_bytes(z.read(name))', archive, candidate, JSON.stringify(mappings)]);
const sourceHashes = {};
for (const [file, target] of Object.entries(mappings)) {
  const bytes = fs.readFileSync(path.join(candidate, target));
  assert.strictEqual(sha(bytes), sha(git('show', source + ':' + file))); sourceHashes[file] = sha(bytes);
}
const dependencyFiles = Object.entries(baseline.files).filter(([file]) => file.startsWith('node_modules/'));
assert.strictEqual(dependencyFiles.length, 1703);
for (const [file] of dependencyFiles) {
  const dest = path.join(candidate, file); fs.mkdirSync(path.dirname(dest), {recursive: true});
  fs.copyFileSync(path.join(baseline.root, file), dest);
}
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
writeJson(path.join(candidate, 'package.json'), {name: 'isolated-writer-journal-probe', version: '1.0.0', private: true,
  dependencies: {'@cloudbase/node-sdk': plan.sdk_version}});
assert.strictEqual(require(path.join(candidate, 'node_modules/@cloudbase/node-sdk/package.json')).version, plan.sdk_version);
assert.strictEqual(require(path.join(candidate, 'node_modules/@cloudbase/database/package.json')).version, plan.database_version);
fs.writeFileSync(path.join(candidate, 'index.js'), "'use strict';\nexports.main = require('./probe').main;\n");
writeJson(path.join(candidate, 'config.json'), {permissions: {openapi: []}, timeout: plan.timeout_seconds, envVariables: {}, triggers: []});
writeJson(path.join(candidate, 'SOURCE_IDENTITY.json'), {source_commit: source, source_files_sha256: sourceHashes,
  independent_dependency_map_sha256: sha(fs.readFileSync(path.resolve(args[5]))),
  dependency_files: dependencyFiles.length, scope: 'Isolated transaction journal fixture only; no production writer imports'});
const files = {};
function walk(dir) { for (const name of fs.readdirSync(dir).sort()) {
  const file = path.join(dir, name);
  assert(!fs.lstatSync(file).isSymbolicLink());
  if (fs.statSync(file).isDirectory()) walk(file); else files[path.relative(candidate, file).split(path.sep).join('/')] = sha(fs.readFileSync(file));
} }
walk(candidate);
for (const [file, hash] of dependencyFiles) assert.strictEqual(files[file], hash);
assert(Object.keys(files).every(file => file.startsWith('node_modules/') ||
  [...Object.values(mappings), 'package.json', 'index.js', 'config.json', 'SOURCE_IDENTITY.json'].includes(file)));
assert.strictEqual(Object.keys(files).length, 1713);
writeJson(path.join(out, 'candidate.files.json'), files);
const zip = path.join(out, 'writerJournalRuntime24-candidate.zip');
execFileSync('python', ['-c',
  'import sys,zipfile,pathlib,hashlib,json\nr=pathlib.Path(sys.argv[1]); z=pathlib.Path(sys.argv[2]); expected=json.loads(pathlib.Path(sys.argv[3]).read_text())\nwith zipfile.ZipFile(z,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as f:\n for name in sorted(expected):\n  i=zipfile.ZipInfo(name,(1980,1,1,0,0,0)); i.compress_type=zipfile.ZIP_DEFLATED; i.external_attr=0o100644<<16; f.writestr(i,(r/name).read_bytes())\nwith zipfile.ZipFile(z) as f:\n assert {i.filename:hashlib.sha256(f.read(i)).hexdigest() for i in f.infolist()}==expected',
  candidate, zip, path.join(out, 'candidate.files.json')]);
const receipt = {status: 'LOCAL_CANDIDATE_NOT_DEPLOYED', source_commit: source,
  function_name: plan.function_name, runtime: plan.runtime, collection: plan.collection,
  invocation_limit: plan.invocation_limit, max_documents: plan.max_documents,
  candidate_files: Object.keys(files).length, dependency_files: dependencyFiles.length, candidate_zip_sha256: sha(fs.readFileSync(zip)),
  file_map_sha256: sha(fs.readFileSync(path.join(out, 'candidate.files.json'))), source_files_sha256: sourceHashes,
  cloud_mutations: 0, cloud_invocations: 0};
writeJson(path.join(out, 'build-receipt.json'), receipt); console.log(JSON.stringify(receipt, null, 2));
