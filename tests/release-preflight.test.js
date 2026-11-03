'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const R = require('../scripts/release-preflight');

assert.throws(() => R.parse([]), /Specify/);
assert.throws(() => R.parse(['--pull']), /Unknown option/);
assert.throws(() => R.parse(['--functions', 'apiGateway,apiGateway']), /Duplicate/);
assert.throws(() => R.parse(['--functions', '../apiGateway']), /Unknown function/);
assert.throws(() => R.parse(['--functions', 'apiGateway', '--frontend-only']), /separate batches/);
assert.strictEqual(R.parse(['--functions', 'apiGateway']).apply, false);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etf-release-'));
function git(args) {
  const r = spawnSync('git', ['-c','user.name=Release Test','-c','user.email=release-test@example.invalid',...args], { cwd: dir, encoding:'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}
git(['init']);
fs.writeFileSync(path.join(dir, 'source'), 'old');
git(['add','source']); git(['commit','-m','old']); const old = git(['rev-parse','HEAD']);
fs.writeFileSync(path.join(dir, 'source'), 'new');
git(['add','source']); git(['commit','-m','new']); const current = git(['rev-parse','HEAD']);
const baseline = { required_backend_ancestor:current, required_frontend_ancestor:old };
R.assertAncestry(dir,baseline);
git(['checkout','--detach',old]);
assert.throws(() => R.assertAncestry(dir,baseline), /git failed/);
// A source snapshot must bind every deployable input and exclude secrets/dependencies.
for (const rel of ['src/common','cloudfunctions/apiGateway','ml/manifests','ml/gen2/manifests']) fs.mkdirSync(path.join(dir,rel), {recursive:true});
fs.writeFileSync(path.join(dir,'src/common/a.js'),'a');
fs.writeFileSync(path.join(dir,'cloudfunctions/apiGateway/index.js'),'i');
fs.writeFileSync(path.join(dir,'cloudfunctions/apiGateway/config.json'),'{}');
let inventory = R.sourceInventory(dir,['apiGateway'],false);
assert.deepStrictEqual(Object.keys(inventory).sort(), ['cloudfunctions/apiGateway/index.js','src/common/a.js']);
const before = inventory['src/common/a.js'];
fs.writeFileSync(path.join(dir,'src/common/a.js'),'changed');
inventory = R.sourceInventory(dir,['apiGateway'],false);
assert.notStrictEqual(inventory['src/common/a.js'],before);
console.log('release-preflight: scope, read-only default, stale ancestry rejection and source binding PASS');
