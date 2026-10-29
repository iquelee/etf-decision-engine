#!/usr/bin/env node
'use strict';
// Explicit local package only; never downloads, deploys, calls SDK or reads credentials.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const {replay} = require('../tests/writer-rde-replay.test');
async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 4 && args[0] === '--package' && args[2] === '--file-map',
    'Usage: node scripts/writer-package-replay.js --package <independent-download> --file-map <raw-sha256-map>');
  const root = fs.realpathSync(path.resolve(args[1]));
  const mapFile = path.resolve(args[3]);
  const raw = fs.readFileSync(mapFile), files = JSON.parse(raw);
  const inventory = require('../release/runtime24-writer-inventory.json').functions.find(f => f.FunctionName === 'runDecisionEngine');
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  assert.strictEqual(sha(raw), inventory.download.raw_file_map_sha256, 'map must bind independently captured inventory');
  const actual = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
      assert(!item.isSymbolicLink(), 'package symlinks rejected');
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file); else actual.push(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  walk(root);
  assert.deepStrictEqual(actual.sort(), Object.keys(files).sort(), 'no missing/extra package files');
  for (const rel of actual) assert.strictEqual(sha(fs.readFileSync(path.join(root, rel))), files[rel], 'raw file drift:' + rel);
  const before = Object.fromEntries(actual.map(rel => [rel, files[rel]]));
  const result = await replay(root, path.join(root, 'common'));
  for (const rel of actual) assert.strictEqual(sha(fs.readFileSync(path.join(root, rel))), before[rel], 'replay changed input');
  console.log(JSON.stringify({runtime: process.version, package_files: actual.length,
    source_commit: JSON.parse(fs.readFileSync(path.join(root, 'RELEASE_SOURCE.json'), 'utf8')).source_commit,
    package_input_unchanged: true, ...result}, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
