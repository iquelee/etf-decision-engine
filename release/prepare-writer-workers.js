#!/usr/bin/env node
'use strict';
// Offline archive builder. Never installs dependencies or calls a cloud API.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const {execFileSync} = require('child_process');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const repo = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, {cwd: repo, maxBuffer: 16 * 1024 * 1024});
const modules = ['writer-admission', 'writer-admission-cloudbase', 'writer-admission-journal', 'writer-journal-cloudbase',
  'writer-entry', 'writer-direct-caller', 'writer-invocation-worker', 'writer-worker-bootstrap', 'writer-local-root', 'writer-timer-identity',
  'writer-admin-http', 'writer-admin-maintenance'];
function fileMap(root) {
  const files = {};
  function walk(dir) {for (const item of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, item.name);assert(!item.isSymbolicLink(), 'symlink rejected');
    if (item.isDirectory()) walk(file);
    else {assert(item.isFile(), 'regular files required');files[path.relative(root, file).split(path.sep).join('/')] = sha(fs.readFileSync(file));}
  }}
  walk(root);return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
function verifyInput(root, mapFile, expected) {
  const raw = fs.readFileSync(mapFile);assert.strictEqual(sha(raw), expected, 'unbound package map');
  const files = JSON.parse(raw);assert.deepStrictEqual(fileMap(root), files, 'independent package drift');return files;
}
function build({source, inventoryRoot, out}) {
  assert(/^[a-f0-9]{40}$/.test(source));assert.strictEqual(git('rev-parse', 'HEAD').toString().trim(), source);
  assert.strictEqual(git('status', '--porcelain').toString().trim(), '', 'clean source required');
  out = path.resolve(out);inventoryRoot = fs.realpathSync(inventoryRoot);
  const parent = fs.realpathSync(path.dirname(out));
  assert(parent !== repo && !parent.startsWith(repo + path.sep), 'output must be outside Git workspace');
  assert(!fs.existsSync(out), 'new output directory required');
  const inventory = JSON.parse(git('show', source + ':release/runtime24-writer-inventory.json'));
  const sourceHashes = Object.fromEntries(modules.map(name => ['release/' + name + '.js', sha(git('show', source + ':release/' + name + '.js'))]));
  const inputs = ['runDecisionEngine', 'materializeIndicators', 'adminGateway'].map(producer => {
    const root = fs.realpathSync(path.join(inventoryRoot, producer + '-download'));
    const mapFile = path.join(inventoryRoot, producer + '.files.json');
    const mapHash = inventory.functions.find(f => f.FunctionName === producer).download.raw_file_map_sha256;
    const files = verifyInput(root, mapFile, mapHash);
    const imports = Object.keys(files).filter(file => !file.startsWith('node_modules/') && file.endsWith('.js') &&
      fs.readFileSync(path.join(root, file), 'utf8').includes('@cloudbase/node-sdk')).sort();
    assert.deepStrictEqual(imports, ['common/utils/db.js', 'common/utils/intel-refresh.js', 'index.js']);
    return {producer, root, mapFile, mapHash, files};
  });
  fs.mkdirSync(out);const receipts = [];
  const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  for (const input of inputs) {
    const {producer, root, files} = input, target = producer + 'Node24', candidate = path.join(out, target);
    fs.mkdirSync(candidate);
    for (const file of Object.keys(files)) {
      const dest = path.join(candidate, file);fs.mkdirSync(path.dirname(dest), {recursive: true});fs.copyFileSync(path.join(root, file), dest);
    }
    const alterations = [];
    for (const file of ['index.js', 'common/utils/db.js', 'common/utils/intel-refresh.js']) {
      const original = fs.readFileSync(path.join(root, file), 'utf8');
      const literal = "require('@cloudbase/node-sdk')";
      assert.strictEqual(original.split(literal).length, 2, 'single reviewed SDK import required');
      const destination = file === 'index.js' ? 'business.js' : file;
      assert(file !== 'index.js' || !Object.hasOwn(files, destination), 'business module collision');
      fs.writeFileSync(path.join(candidate, destination), original.replace(literal,
        "require('" + (file === 'index.js' ? './writer-sdk' : '../../writer-sdk') + "')"));
      alterations.push({input: file, output: destination, input_sha256: files[file], operation: 'single SDK require replacement'});
    }
    for (const name of modules) {
      assert(!Object.hasOwn(files, name + '.js'), 'bootstrap module collision');
      fs.writeFileSync(path.join(candidate, name + '.js'), git('show', source + ':release/' + name + '.js'));
    }
    for (const file of ['writer-sdk.js', 'SOURCE_IDENTITY.json']) assert(!Object.hasOwn(files, file), 'generated file collision');
    fs.writeFileSync(path.join(candidate, 'index.js'), "'use strict';\nconst sdk = require('@cloudbase/node-sdk');\n" +
      "const bootstrap = require('./writer-worker-bootstrap').createBootstrap({producer: '" + producer + "', sdk,\n" +
      "  sdkVersion: require('@cloudbase/node-sdk/package.json').version, databaseVersion: require('@cloudbase/database/package.json').version,\n" +
      "  loadMain: async () => require('./business').main});\nexports.main = bootstrap.main;\nexports.getBusinessSdk = bootstrap.getBusinessSdk;\n");
    fs.writeFileSync(path.join(candidate, 'writer-sdk.js'), "'use strict';\nmodule.exports = require('./index').getBusinessSdk();\n");
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json')));
    const timeout = producer === 'adminGateway' ? 60 : 120;
    assert.strictEqual(config.timeout, timeout);assert.deepStrictEqual(config.envVariables, {DECISION_ENV: 'prod'});
    config.triggers = [];json(path.join(candidate, 'config.json'), config);
    json(path.join(candidate, 'SOURCE_IDENTITY.json'), {status: 'OFFLINE_WORKER_CANDIDATE_NOT_QUALIFIED', source_commit: source,
      producer, target, runtime: 'Nodejs24.11', timeout_seconds: timeout, memory_mb: 256, source_files_sha256: sourceHashes,
      accepted_entries: ['signed-rpc', ...(producer === 'materializeIndicators' ? ['native-timer-local'] :
        producer === 'adminGateway' ? ['admin-http-local'] : [])],
      native_timer_source_and_retry_qualification: 'NOT_PROVEN',
      input_map_sha256: input.mapHash, input_entry_sha256: files['index.js'], alterations,
      configuration_delta: 'preserve timeout and DECISION_ENV; remove triggers; signing keys absent'});
    const output = fileMap(candidate), changed = Object.keys(files).filter(file => output[file] !== files[file]);
    assert.deepStrictEqual(changed.sort(), ['common/utils/db.js', 'common/utils/intel-refresh.js', 'config.json', 'index.js'].filter(file => output[file] !== files[file]).sort());
    const dependencies = Object.keys(files).filter(file => file.startsWith('node_modules/'));
    for (const file of dependencies) assert.strictEqual(output[file], files[file]);
    assert.strictEqual(require(path.join(candidate, 'node_modules/@cloudbase/node-sdk/package.json')).version, '2.11.0');
    assert.strictEqual(require(path.join(candidate, 'node_modules/@cloudbase/database/package.json')).version, '1.4.1');
    const map = path.join(out, target + '.files.json');json(map, output);
    const zip = path.join(out, target + '.zip');
    execFileSync('python', ['-c',
      'import sys,zipfile,pathlib,hashlib,json\nr=pathlib.Path(sys.argv[1]); expected=json.loads(pathlib.Path(sys.argv[3]).read_text())\nwith zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for name in sorted(expected):\n  i=zipfile.ZipInfo(name,(1980,1,1,0,0,0)); i.compress_type=zipfile.ZIP_DEFLATED; i.external_attr=0o100644<<16; z.writestr(i,(r/name).read_bytes())\nwith zipfile.ZipFile(sys.argv[2]) as z:\n assert {i.filename:hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}==expected',
      candidate, zip, map]);
    verifyInput(root, input.mapFile, input.mapHash);
    receipts.push({producer, target, input_files: Object.keys(files).length, output_files: Object.keys(output).length,
      unchanged_input_files: Object.keys(files).length - changed.length, changed_input_files: changed,
      dependency_files_unchanged: dependencies.length, zip_sha256: sha(fs.readFileSync(zip)), map_sha256: sha(fs.readFileSync(map))});
  }
  assert.strictEqual(git('rev-parse', 'HEAD').toString().trim(), source);
  assert.strictEqual(git('status', '--porcelain').toString().trim(), '', 'source changed during build');
  const receipt = {status: 'OFFLINE_ONLY_NOT_DEPLOYED_OR_QUALIFIED', source_commit: source, cloud_mutations: 0, cloud_invocations: 0, packages: receipts};
  json(path.join(out, 'build-receipt.json'), receipt);return receipt;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  assert(args.length === 6 && args[0] === '--source' && args[2] === '--inventory-root' && args[4] === '--out',
    'Usage: --source <40SHA> --inventory-root <independent downloads/maps> --out <new directory>');
  console.log(JSON.stringify(build({source: args[1], inventoryRoot: args[3], out: args[5]}), null, 2));
}
module.exports = {fileMap, verifyInput, build};
