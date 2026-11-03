#!/usr/bin/env node
'use strict';
// Offline only. Captured business/dependencies stay per-function; no installer,
// cloud API, invocation, credentials, timers or deployable authorization.
const assert = require('assert'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const {execFileSync} = require('child_process');
const {fileMap, verifyInput} = require('./prepare-writer-workers');
const repo = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, {cwd: repo, maxBuffer: 16 * 1024 * 1024});
const modules = ['writer-admission', 'writer-admission-cloudbase', 'writer-admission-journal', 'writer-journal-cloudbase',
  'writer-entry', 'writer-direct-caller', 'writer-invocation-worker', 'writer-worker-bootstrap', 'writer-local-root',
  'writer-timer-identity', 'writer-admin-http', 'writer-admin-maintenance'];
const names = ['fetchDailyData', 'fetchRealtimeData', 'fetchFundamentalNews', 'extractFundamental', 'runGen1ShadowEod', 'runGen2ShadowEod'];
function build({source, inventoryRoot, out}) {
  assert(/^[a-f0-9]{40}$/.test(source));assert.strictEqual(git('rev-parse', 'HEAD').toString().trim(), source);
  assert.strictEqual(git('status', '--porcelain').toString().trim(), '', 'clean source required');
  inventoryRoot = fs.realpathSync(inventoryRoot);out = path.resolve(out);
  const parent = fs.realpathSync(path.dirname(out));
  assert(parent !== repo && !parent.startsWith(repo + path.sep), 'output outside source workspace required');
  assert(!fs.existsSync(out), 'fresh output required');
  const inventory = JSON.parse(git('show', source + ':release/runtime24-writer-six-inventory.json'));
  assert.deepStrictEqual(inventory.functions.map(f => f.FunctionName), names);
  const sourceModules = Object.fromEntries(modules.map(name => [name + '.js', git('show', source + ':release/' + name + '.js')]));
  const helper = git('show', source + ':release/writer-preserve-zip.py').toString('utf8');
  const inputs = inventory.functions.map(f => {
    const name = f.FunctionName, root = fs.realpathSync(path.join(inventoryRoot, name + '-download'));
    const map = path.join(inventoryRoot, name + '.files.json'), archive = path.join(inventoryRoot, name + '.zip');
    const files = verifyInput(root, map, f.download.raw_file_map_sha256);
    assert.strictEqual(sha(fs.readFileSync(archive)), f.download.archive_sha256);
    assert.strictEqual(files['index.js'], f.download.entry_sha256);
    const sdkImports = Object.keys(files).filter(file => !file.startsWith('node_modules/') && file.endsWith('.js') &&
      fs.readFileSync(path.join(root, file), 'utf8').includes('@cloudbase/node-sdk')).sort();
    assert.deepStrictEqual(sdkImports, f.download.sdk_imports);
    assert.deepStrictEqual(sdkImports, ['common/utils/db.js', 'common/utils/intel-refresh.js',
      ...(['runGen1ShadowEod', 'runGen2ShadowEod'].includes(name) ? [] : ['index.js'])]);
    for (const [lib, version] of [['node-sdk', '2.11.0'], ['database', '1.4.1']])
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@cloudbase/' + lib + '/package.json'))).version, version);
    const config = Object.hasOwn(files, 'config.json') ? JSON.parse(fs.readFileSync(path.join(root, 'config.json'))) : {};
    if (config.timeout !== undefined) assert.strictEqual(config.timeout, f.Timeout);
    assert([256, 512].includes(f.MemorySize), 'observed memory budget required');
    for (const key of Object.keys(config.envVariables || {})) assert(/^[A-Z][A-Z0-9_]*$/.test(key));
    return {f, name, root, map, archive, files, config, sdkImports};
  });
  fs.mkdirSync(out);const receipts = [];
  const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  for (const input of inputs) {
    const {f, name, root, files, config, sdkImports} = input, target = name + 'Node24', candidate = path.join(out, target);
    fs.mkdirSync(candidate);
    for (const file of Object.keys(files)) {
      const dest = path.join(candidate, file);fs.mkdirSync(path.dirname(dest), {recursive: true});fs.copyFileSync(path.join(root, file), dest);
    }
    const reserved = [...Object.keys(sourceModules), 'writer-sdk.js', 'business.js', 'SOURCE_IDENTITY.json'];
    assert(reserved.every(file => !Object.hasOwn(files, file)), 'generated module collision');
    fs.copyFileSync(path.join(root, 'index.js'), path.join(candidate, 'business.js'));
    for (const file of sdkImports) {
      const original = fs.readFileSync(path.join(root, file), 'utf8'), literal = "require('@cloudbase/node-sdk')";
      assert.strictEqual(original.split(literal).length, 2, 'single reviewed SDK import required');
      fs.writeFileSync(path.join(candidate, file === 'index.js' ? 'business.js' : file), original.replace(literal,
        "require('" + (file === 'index.js' ? './writer-sdk' : '../../writer-sdk') + "')"));
    }
    for (const [file, bytes] of Object.entries(sourceModules)) fs.writeFileSync(path.join(candidate, file), bytes);
    fs.writeFileSync(path.join(candidate, 'index.js'), "'use strict';\nconst sdk = require('@cloudbase/node-sdk');\n" +
      "const bootstrap = require('./writer-worker-bootstrap').createBootstrap({producer: '" + name + "', sdk,\n" +
      "  sdkVersion: require('@cloudbase/node-sdk/package.json').version, databaseVersion: require('@cloudbase/database/package.json').version,\n" +
      "  loadMain: async () => require('./business').main});\nexports.main = bootstrap.main;\nexports.getBusinessSdk = bootstrap.getBusinessSdk;\n");
    fs.writeFileSync(path.join(candidate, 'writer-sdk.js'), "'use strict';\nmodule.exports = require('./index').getBusinessSdk();\n");
    // Input config can contain provider credentials. Never copy their values
    // to a distributable candidate; future environment supply is a separate gate.
    const publicEnvironment = f.public_environment;
    assert(publicEnvironment && Object.keys(publicEnvironment).every(key => key === 'DECISION_ENV'));
    assert(Object.values(publicEnvironment).every(value => value === 'prod'));
    fs.writeFileSync(path.join(candidate, 'config.json'), JSON.stringify({...config, timeout: f.Timeout,
      envVariables: publicEnvironment, triggers: []}, null, 2) + '\n');
    json(path.join(candidate, 'SOURCE_IDENTITY.json'), {status: 'OFFLINE_WORKER_CANDIDATE_NOT_QUALIFIED', source_commit: source,
      producer: name, target, runtime: 'Nodejs24.11', timeout_seconds: f.Timeout, memory_mb: f.MemorySize,
      input_archive_sha256: f.download.archive_sha256, input_map_sha256: f.download.raw_file_map_sha256,
      original_entry_sha256: files['index.js'], sdk_import_replacements: sdkImports,
      wrapper_source_sha256: Object.fromEntries(Object.entries(sourceModules).map(([file, bytes]) => [file, sha(bytes)])),
      existing_environment_names_requiring_separate_supply: f.live_environment_names.filter(key => !Object.hasOwn(publicEnvironment, key)),
      archive_environment_names: Object.keys(config.envVariables || {}).sort(),
      live_environment_names: f.live_environment_names,
      signing_keys: 'ABSENT_REQUIRES_SEPARATE_SUPPLY', accepted_entries: ['signed-rpc', 'native-timer-local'],
      timer_message: name === 'runGen2ShadowEod' ? '{"mode":"REPLAY"}' : 'writer-root-timer-v1',
      triggers: 'NONE', cloud_source_retry_and_whole_business_qualification: 'NOT_PROVEN',
      archive_symlinks: f.download.archive_symlinks,
      evidence_directory: 'LINK_TARGET_BYTES_ARE_REGULAR_EVIDENCE_FILES_USE_ZIP_TO_PRESERVE_TYPES'});
    const output = fileMap(candidate);
    const changed = Object.keys(files).filter(file => output[file] !== files[file]).sort();
    assert.deepStrictEqual(changed, ['config.json', 'index.js', ...sdkImports.filter(file => file !== 'index.js')]
      .filter(file => Object.hasOwn(files, file)).sort());
    for (const file of Object.keys(files).filter(file => file.startsWith('node_modules/'))) assert.strictEqual(output[file], files[file]);
    if (!sdkImports.includes('index.js')) assert.strictEqual(output['business.js'], files['index.js']);
    const map = path.join(out, target + '.files.json');json(map, output);
    const zip = path.join(out, target + '.zip');
    const zipped = JSON.parse(execFileSync('python', ['-c', helper, input.archive, f.download.archive_sha256, candidate, map, zip], {encoding: 'utf8'}));
    assert.deepStrictEqual(zipped.preserved_symlinks, f.download.archive_symlinks.map(link => link.path).sort());
    verifyInput(root, input.map, f.download.raw_file_map_sha256);
    receipts.push({producer: name, target, input_files: Object.keys(files).length, output_files: Object.keys(output).length,
      changed_input_files: changed, dependency_files_unchanged: Object.keys(files).filter(file => file.startsWith('node_modules/')).length,
      timeout_seconds: f.Timeout, memory_mb: f.MemorySize, zip_sha256: zipped.zip_sha256, map_sha256: sha(fs.readFileSync(map)),
      preserved_symlinks: zipped.preserved_symlinks});
  }
  assert.strictEqual(git('rev-parse', 'HEAD').toString().trim(), source);
  assert.strictEqual(git('status', '--porcelain').toString().trim(), '', 'source changed during build');
  const receipt = {status: 'OFFLINE_ONLY_NOT_DEPLOYED_OR_QUALIFIED', source_commit: source,
    archive_helper_sha256: sha(Buffer.from(helper)), cloud_mutations: 0, cloud_invocations: 0, packages: receipts};
  json(path.join(out, 'build-receipt.json'), receipt);return receipt;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  assert(args.length === 6 && args[0] === '--source' && args[2] === '--inventory-root' && args[4] === '--out');
  console.log(JSON.stringify(build({source: args[1], inventoryRoot: args[3], out: args[5]}), null, 2));
}
module.exports = {build};
