'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function verifyPackage(root, mapFile) {
  root = fs.realpathSync(root);
  const raw = fs.readFileSync(mapFile), files = JSON.parse(raw);
  const baseline = require('../../release/runtime24-writer-inventory.json').functions.find(f => f.FunctionName === 'runDecisionEngine');
  assert.strictEqual(sha(raw), baseline.download.raw_file_map_sha256, 'unbound independent package map');
  const found = [];
  function walk(dir) { for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
    assert(!item.isSymbolicLink(), 'symlink rejected'); const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file); else found.push(path.relative(root, file).split(path.sep).join('/'));
  }}
  walk(root); assert.deepStrictEqual(found.sort(), Object.keys(files).sort());
  for (const file of found) assert.strictEqual(sha(fs.readFileSync(path.join(root, file))), files[file], 'package drift:' + file);
  return {root, files};
}
module.exports = {verifyPackage, sha};
