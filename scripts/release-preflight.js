#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const BASELINE = require('../release/production-baseline.json');

function run(command, args, options = {}) {
  const r = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', ...options });
  if (r.error || r.status !== 0) throw new Error(`${path.basename(command)} failed (${r.status}): ${r.error ? r.error.message : (r.stderr || '').trim()}`);
  return (r.stdout || '').trim();
}
function git(args, root = ROOT) { return run('git', args, { cwd: root }); }
function assertAncestry(root = ROOT, baseline = BASELINE) {
  for (const key of ['required_backend_ancestor', 'required_frontend_ancestor']) {
    git(['merge-base', '--is-ancestor', baseline[key], 'HEAD'], root);
  }
}
function sourceInventory(root, functions, frontend) {
  const files = {};
  function walk(rel) {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(entry.name)) continue;
      if (rel.startsWith('cloudfunctions/') && entry.name === 'common') continue;
      if ((entry.name.startsWith('.env') && !rel.startsWith('web')) || entry.name === 'config.json' || entry.name === 'MANIFEST.json') continue;
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else files[next] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, next))).digest('hex');
    }
  }
  if (functions.length) {
    walk('src/common');
    functions.forEach(fn => walk(`cloudfunctions/${fn}`));
    walk('ml/manifests');
    walk('ml/gen2/manifests');
  }
  if (frontend) walk('web');
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
function parse(args) {
  const options = { apply: false, frontend: false, functions: [] };
  const values = { '--functions': 'functions', '--baseline': 'baseline', '--env': 'env', '--cli': 'cli', '--out': 'out' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--frontend-only') options.frontend = true;
    else if (arg === '--plan') { /* read-only default */ }
    else if (values[arg]) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
      options[values[arg]] = arg === '--functions' ? value.split(',') : value;
    } else throw new Error(`Unknown option: ${arg}. --pull and implicit full deployment are no longer supported.`);
  }
  if (options.frontend && options.functions.length) throw new Error('Deploy frontend and backend as separate batches.');
  if (!options.frontend && !options.functions.length) throw new Error('Specify --frontend-only or --functions <comma-separated names>.');
  if (new Set(options.functions).size !== options.functions.length) throw new Error('Duplicate function scope.');
  for (const fn of options.functions) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(fn) || !fs.existsSync(path.join(ROOT, 'cloudfunctions', fn, 'index.js'))) throw new Error(`Unknown function: ${fn}`);
  }
  return options;
}
function main(args) {
  const options = parse(args);
  assertAncestry();
  const dirty = git(['status', '--porcelain', '--untracked-files=all']).length > 0;
  if (options.apply && dirty) throw new Error('Deployment requires a clean, committed source tree.');
  if (options.apply && (!options.env || !options.cli)) throw new Error('--apply requires explicit --env and --cli <CloudBase CLI JavaScript entry>.');
  if (options.apply && options.functions.length && !options.baseline) throw new Error('--apply backend requires --baseline <reviewed function ZIP directory>.');
  const files = sourceInventory(ROOT, options.functions, options.frontend);
  const dependencyBaselines={};
  if(options.baseline) for(const fn of options.functions) {
    dependencyBaselines[fn]=crypto.createHash('sha256').update(fs.readFileSync(path.join(path.resolve(options.baseline),fn+'.zip'))).digest('hex');
  }
  const plan = {
    mode: options.apply ? 'APPLY' : 'PLAN', source_commit: git(['rev-parse', 'HEAD']), dirty,
    baseline_observed_at: BASELINE.observed_at, strategy_version: BASELINE.strategy_version,
    baseline_release_version: BASELINE.release_version, frontend: options.frontend, functions: options.functions,
    source_sha256: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), files,
    dependency_baselines_sha256: dependencyBaselines,
    uploads_performed: 0
  };
  if (options.out) fs.writeFileSync(path.resolve(options.out), JSON.stringify(plan, null, 2) + '\n');
  console.log(JSON.stringify({ ...plan, files: `${Object.keys(files).length} files (use --out for full inventory)` }, null, 2));
  if (!options.apply) return plan;

  if (!fs.existsSync(path.resolve(options.cli))) throw new Error('CLI entry does not exist.');
  if (options.frontend && !fs.existsSync(path.join(ROOT, 'web/node_modules/vite/bin/vite.js'))) throw new Error('Install frontend dependencies before deployment.');
  for (const fn of options.functions) {
    if (!fs.existsSync(path.join(path.resolve(options.baseline), fn + '.zip'))) throw new Error(`Missing reviewed dependency baseline: ${fn}.zip`);
  }
  run(process.execPath, ['scripts/test-all.js'], { stdio: 'inherit' });
  run(process.execPath, ['scripts/verify-v365-candidate-manifest.js'], { stdio:'inherit' });
  run(process.execPath, ['scripts/v365-reader-migration-gate.js'], { stdio:'inherit' });
  run(process.execPath, ['release/verify-legacy-divergence.js'], { stdio:'inherit' });
  if (options.frontend) {
    run(process.execPath, ['tests/run-rewrite-tests.js'], { cwd: path.join(ROOT, 'web'), stdio: 'inherit' });
    run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: path.join(ROOT, 'web'), stdio: 'inherit' });
  } else {
    run(process.execPath, ['scripts/build-cloudfunctions.js'], { stdio: 'inherit' });
    run(process.env.TCB_PYTHON || 'python', ['scripts/prepare-deploy.py', '--baseline', path.resolve(options.baseline), '--functions', options.functions.join(','), '--env',options.env], { stdio: 'inherit' });
  }
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Tests/build changed source tree; deployment stopped.');
  if (git(['rev-parse','HEAD']) !== plan.source_commit) throw new Error('HEAD changed during preparation.');
  const after = sourceInventory(ROOT, options.functions, options.frontend);
  if (JSON.stringify(after) !== JSON.stringify(files)) throw new Error('Source inventory changed during preparation.');
  for(const [fn,expected] of Object.entries(dependencyBaselines)) {
    const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(path.resolve(options.baseline),fn+'.zip'))).digest('hex');
    if(actual!==expected)throw new Error(`Dependency baseline changed during preparation: ${fn}`);
  }
  if (options.frontend) run(process.execPath, [path.resolve(options.cli), 'hosting', 'deploy', 'web/dist', '-e', options.env], { stdio: 'inherit' });
  else for (const fn of options.functions) {
    run(process.execPath, [path.resolve(options.cli), 'fn', 'deploy', fn, '--dir', `dist-functions/${fn}`, '--config-file', 'cloudbaserc.json', '--force', '--install-dependency', 'false', '-e', options.env], { stdio: 'inherit' });
  }
  console.log(JSON.stringify({source_commit:plan.source_commit,uploads_performed:options.frontend ? 1 : options.functions.length,post_deployment_verification:'REQUIRED'}));
  return plan;
}
module.exports = { parse, assertAncestry, sourceInventory, main };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`[RELEASE BLOCKED] ${e.message}`); process.exitCode = 1; }
}
