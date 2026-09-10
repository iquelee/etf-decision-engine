#!/usr/bin/env node
/**
 * Gen-1 Production Gates（WP-G1 / G1-11）。
 *
 * 命名门禁 G1-A ~ G1-H，供 CI 显式可见：
 *   G1-A Gen1 Frozen Artifact        冻结 artifact SHA + model_id
 *   G1-B Gen1 Feature Pipeline Lock  特征管线 SHA + root-of-trust
 *   G1-C Python ↔ Node Golden Parity 420 行大样本推理一致
 *   G1-D Safety Permission Tests     许可链（含任务包 6 组验收）
 *   G1-E Domain Gate Tests           域许可（含 518880 OOD 核心验收）
 *   G1-F Circuit Breaker Tests       熔断门 + 禁止 auto reopen
 *   G1-G Execution Boundary Tests    自动执行永久硬关 + 审计
 *   G1-H Production No-op Test       ADVISORY 下 final_target/final_action 逐字段不变
 *
 * 用法：node scripts/gen1-production-gates.js
 * 任何一门失败 → exit 1。
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const NODE = process.execPath;

const GATES = [
  { id: 'G1-A', name: 'Gen1 Frozen Artifact', script: 'scripts/verify-immutable.js' },
  { id: 'G1-B', name: 'Gen1 Feature Pipeline Lock', script: 'scripts/verify-gen1-pipeline.js' },
  { id: 'G1-C', name: 'Python <-> Node Golden Parity', script: 'tests/gen1-parity.test.js' },
  { id: 'G1-D', name: 'Safety Permission Tests', script: 'tests/gen1-safety-permission.test.js' },
  { id: 'G1-E', name: 'Domain Gate Tests', script: 'tests/gen1-domain-gate.test.js' },
  { id: 'G1-F', name: 'Circuit Breaker Tests', script: 'tests/gen1-circuit-breaker.test.js' },
  { id: 'G1-G', name: 'Execution Boundary Tests', script: 'tests/gen1-execution-boundary.test.js' },
  { id: 'G1-H', name: 'Production No-op Test', script: 'tests/gen1-overlay-noop.test.js' }
];

function main() {
  console.log('\n== Gen-1 Production Gates（G1-A ~ G1-H）==');
  let failed = 0;
  const rows = [];
  for (const gate of GATES) {
    const r = spawnSync(NODE, [path.join(REPO, gate.script)], { cwd: REPO, encoding: 'utf8' });
    const ok = r.status === 0;
    if (!ok) failed += 1;
    rows.push({ gate, ok, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() });
  }
  for (const row of rows) {
    const mark = row.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${row.gate.id} ${row.gate.name}`);
    if (!row.ok) {
      const detail = (row.err || row.out).split('\n').slice(-4).join(' | ').slice(0, 240);
      if (detail) console.log(`         ${detail}`);
    }
  }
  const passed = GATES.length - failed;
  console.log(`\n=== Gen-1 Production Gates：${passed}/${GATES.length} 通过 ===`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
