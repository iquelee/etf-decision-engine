#!/usr/bin/env node
/**
 * Gen-1 Production Gates（WP-G1 / G1-11）。
 *
 * 命名门禁 G1-A ~ G1-H，供 CI 显式可见：
 *   G1-A Gen1 Frozen Artifact        冻结 artifact SHA + model_id
 *   G1-B Gen1 Feature Pipeline Lock  特征管线 SHA + root-of-trust + 部署侧阈值一致
 *   G1-C Python ↔ Node Golden Parity 420 行大样本推理一致
 *   G1-D Safety Permission Tests     许可链（含任务包 6 组验收）
 *   G1-E Domain Gate Tests           域许可（含 518880 OOD 核心验收）
 *   G1-F Circuit Breaker Tests       熔断门 + 禁止 auto reopen
 *   G1-G Execution Boundary Tests    自动执行永久硬关 + 审计
 *   G1-H Production No-op Test       ADVISORY 下 final_target/final_action 逐字段不变
 *   —— WP-G1.1 Canary Gate Remediation ——
 *   G1-I Model Candidate Gate        Safety PERMIT ≠ 模型触发（P<0.65 不得 advisory/canary）
 *   G1-J Sector Contract Audit       capability 声明 vs frozen encoder 逐 fold 事实
 *   G1-K Persistent Health Latch     跨冷启动保持 + 禁 auto reopen
 *   G1-L Economic Health Aggregator  样本不足必须 PENDING（不得 OK 冒充）
 *   G1-M Canary Portfolio Parity     sectorRemainingLimit 继承 + 科技合计不破 cap
 *   —— WP-G1.2 Runtime Single-Truth Remediation ——
 *   G1-N Health Single Truth         权限只认持久化 latch；signal 快照无权限
 *   G1-O Health Read Fail-Closed     三态读取；异常绝不回落 OK，且不落库
 *   G1-P Canary Context Parity       canary 继承生产全部输入（唯一变量 = stage override）
 *   G1-Q Economic Event Contract     event_cluster_id 去重 + 真实交易日历 40D
 *   —— WP-G1.3 Counterfactual Portfolio Ledger ——
 *   G1-R Counterfactual Ledger Guard 账本无条件推进（非 Candidate 按 baseline）+ 终局 cap 断言
 *   —— 上线前置 ——
 *   G1-S Schema/Collections Parity  constants ↔ SCHEMAS 一一对应（含 gen1_health_state）
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
  { id: 'G1-H', name: 'Production No-op Test', script: 'tests/gen1-overlay-noop.test.js' },
  { id: 'G1-I', name: 'Model Candidate Gate', script: 'tests/gen1-safety-permission.test.js' },
  { id: 'G1-J', name: 'Sector Contract Audit', script: 'scripts/audit-gen1-sector-contract.js' },
  { id: 'G1-K', name: 'Persistent Health Latch', script: 'tests/gen1-persistent-health.test.js' },
  { id: 'G1-L', name: 'Economic Health Aggregator', script: 'tests/gen1-economic-health.test.js' },
  { id: 'G1-M', name: 'Canary Portfolio Parity', script: 'tests/gen1-canary-portfolio.test.js' },
  { id: 'G1-N', name: 'Health Single Truth', script: 'tests/gen1-health-single-truth.test.js' },
  { id: 'G1-O', name: 'Health Read Fail-Closed', script: 'tests/gen1-health-failclosed.test.js' },
  { id: 'G1-P', name: 'Canary Context Parity', script: 'tests/gen1-runtime-single-truth.test.js' },
  { id: 'G1-Q', name: 'Economic Event Contract', script: 'tests/gen1-economic-health.test.js' },
  { id: 'G1-R', name: 'Counterfactual Ledger Guard', script: 'tests/gen1-counterfactual-ledger-static.test.js' },
  { id: 'G1-S', name: 'Schema/Collections Parity', script: 'tests/schema-collections-parity.test.js' }
];

function main() {
  console.log('\n== Gen-1 Production Gates（G1-A ~ G1-S）==');
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
