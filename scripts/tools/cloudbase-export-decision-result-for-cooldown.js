#!/usr/bin/env node
/**
 * V3.6.5 RPG-F2-B —— `decision_result` READ-ONLY allowlist extension probe & export
 *
 * 为什么需要（RPG-F2-B §5 硬要求）：
 *   生产 `resolveLastBuyAddMode()`（`src/common/utils/cooldown.js:21-29`）有**三步**：
 *     ① `trade_log.add_mode`             —— 若存在则直接采用
 *     ② `decision_result(code, decision_date = buyDate).add_mode`  —— 单点回查
 *     ③ `fallbackAddMode`                —— 兜底
 *   受治理 `trade_log` 的 `add_mode` **全空**（ROWS_WITH_ADD_MODE=0）⇒
 *   第 ② 步是**生产真实路径的一部分**，必须在 replay 的 stub DB 中复现。
 *   ⛔ **不得**用当前 replay 决策猜历史 buy 的 add_mode（那是把 counterfactual 混进 fidelity）。
 *
 * ⛔ 约束（owner 授权允许扩展 allowlist，但必须满足）：
 *   - **只读**：复用 `cloudbase-readonly-client`（结构上无 mutation 方法）
 *   - **记录为什么需要**：本文件头 + provenance 的 `reason` 字段
 *   - **重新跑 R-03~R-06**：由 `cloudbase-readonly-safety-test.js` 覆盖
 *   - **更新 provenance**：写出 `decision_result.provenance.json`
 *   - **绝不增加 mutation 方法**：⛔ 本脚本不 require 任何写能力
 *
 * ⚠️ 读取范围最小化：**仅**回查受治理 `trade_log` 中已出现的 (code, buy_date) 组合，
 *    而非整表导出。理由：add_mode 只有"买入日当日决策"这一处语义相关。
 *
 * 用法：node scripts/tools/cloudbase-export-decision-result-for-cooldown.js
 * 退出码：0 = 成功；1 = 失败；2 = 无凭证
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const OUT_ROOT = path.join(ROOT, 'deliverables', 'v365-production-history');
const RAW_DIR = path.join(OUT_ROOT, 'raw');
const PROV_DIR = path.join(OUT_ROOT, 'provenance');

const { createReadOnlyClient } = require('./cloudbase-readonly-client');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const nowIso = () => new Date().toISOString();
const mk = (d) => fs.mkdirSync(d, { recursive: true });

/**
 * 从受治理 `trade_log` 计算**需要回查**的 (code, buy_date) 对。
 * ⛔ 只取 buy 行；⛔ 不使用任何决策推断。
 */
function requiredLookups(tradeLogPath) {
  const rows = fs.readFileSync(tradeLogPath, 'utf8').split('\n')
    .map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  const pairs = [];
  const seen = new Set();
  rows.filter((r) => /buy/i.test(String(r.action || ''))).forEach((r) => {
    const k = `${r.code}|${r.trade_date}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ code: r.code, decision_date: r.trade_date });
  });
  return { pairs, source: tradeLogPath };
}

async function main() {
  console.log('== V3.6.5 RPG-F2-B decision_result allowlist extension（只读）==\n');

  const tradeLogPath = path.join(RAW_DIR, 'trade_log.ndjson');
  if (!fs.existsSync(tradeLogPath)) {
    console.log(`[FATAL] 缺少受治理 trade_log：${tradeLogPath}`);
    process.exit(1);
  }
  const { pairs } = requiredLookups(tradeLogPath);
  console.log(`  受治理 trade_log 中的 buy (code, buy_date) 回查点 = ${pairs.length}`);
  pairs.forEach((p) => console.log(`    · ${p.code} @ ${p.decision_date}`));

  let client;
  try {
    // ⚠️ allowlist 显式扩展**仅此一个集合**；mutation 能力在 client 层**结构上不存在**
    client = createReadOnlyClient({ allowlist: ['trade_log', 'portfolio_snapshot', 'decision_result'] });
  } catch (e) {
    console.log(`[FATAL] ${e.code || 'ERROR'}: ${e.message}`);
    process.exit(2);
  }
  console.log(`\n  env=${client.envId}`);
  console.log(`  credential_source=${client.credentialSource}`);
  console.log(`  credential_freshness=${JSON.stringify(client.credentialFreshness)}`);
  console.log(`  allowlist=${JSON.stringify(client.allowlist)}\n`);

  /* ---- R-03~R-06：只读安全性由独立测试覆盖；此处做**结构性**复核 ---- */
  const structural = {
    mutation_methods_absent: ['add', 'update', 'set', 'remove', 'createCollection', 'dropCollection']
      .filter((m) => typeof client[m] === 'function'),
  };
  if (structural.mutation_methods_absent.length) {
    console.log(`[FATAL] client 暴露了 mutation 方法：${structural.mutation_methods_absent.join(', ')}`);
    process.exit(1);
  }
  console.log('  [SAFETY] client 结构性无 mutation 方法 ✅');

  /* ---- 最小化单点回查（⛔ 不整表导出）---- */
  const records = [];
  for (const p of pairs) {
    const r = await client.queryPage('decision_result', {
      where: { code: p.code, decision_date: p.decision_date },
      orderBy: [{ field: '_id', direction: 'asc' }],
      pageSize: 5,
      maxRows: 5,
    });
    records.push({
      code: p.code,
      decision_date: p.decision_date,
      rows_found: r.rows.length,
      // 只保留 cooldown 语义相关的字段（⛔ 不做整文档落盘）
      add_mode: r.rows.length ? (r.rows[0].add_mode == null ? null : r.rows[0].add_mode) : null,
      cooldown_days: r.rows.length ? (r.rows[0].cooldown_days == null ? null : r.rows[0].cooldown_days) : null,
      final_action: r.rows.length ? (r.rows[0].final_action == null ? null : r.rows[0].final_action) : null,
      suggested_position: r.rows.length ? (r.rows[0].suggested_position == null ? null : r.rows[0].suggested_position) : null,
    });
    console.log(`    ${p.code} @ ${p.decision_date} → rows=${r.rows.length} add_mode=${JSON.stringify(records[records.length - 1].add_mode)} cooldown_days=${JSON.stringify(records[records.length - 1].cooldown_days)}`);
  }

  /* ---- 落盘（NDJSON + provenance）---- */
  mk(RAW_DIR); mk(PROV_DIR);
  const outPath = path.join(RAW_DIR, 'decision_result_cooldown.ndjson');
  fs.writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const fileSha = sha256(fs.readFileSync(outPath));

  const provenance = {
    source_collection: 'decision_result',
    source_environment: client.envId,
    exported_at: nowIso(),
    export_method: 'cloudbase-node-sdk-readonly',
    /**
     * ⛔ 扩展 allowlist 的**理由**（必须记录，owner 要求）
     */
    reason: 'RPG-F2-B：生产 resolveLastBuyAddMode() 三步链的第 ② 步按 (code, decision_date=buyDate) 回查 '
      + 'decision_result.add_mode。受治理 trade_log 的 add_mode 全空（ROWS_WITH_ADD_MODE=0）⇒ '
      + '该步是生产真实路径的一部分，必须在 replay stub DB 中复现；'
      + '⛔ 不得用当前 replay 决策猜历史 buy 的 add_mode。',
    necessity: 'REQUIRED_FOR_PRODUCTION_FIDELITY_COOLDOWN',
    read_scope: {
      mode: 'MINIMAL_POINT_LOOKUP',
      not_a_full_table_export: true,
      lookup_points: pairs.length,
      note: '仅回查受治理 trade_log 中已出现的 (code, buy_date) 组合；add_mode 仅在「买入日当日决策」处有语义',
    },
    query_filter: { code: '<from trade_log buy rows>', decision_date: '<buy_date>' },
    sort_order: [{ field: '_id', direction: 'asc' }],
    page_size: 5,
    records_written: records.length,
    rows_found_total: records.reduce((a, r) => a + r.rows_found, 0),
    rows_found_zero: records.filter((r) => r.rows_found === 0).length,
    file_sha256: fileSha,
    provenance_status: 'GOVERNED_READ_ONLY_EXPORT',
    credential_source: client.credentialSource,
    credential_freshness: client.credentialFreshness,
    safety: {
      read_only_only: true,
      mutation_methods_absent: true,
      r03_r06_rerun_required: true,
      r03_r06_rerun_by: 'scripts/tools/cloudbase-readonly-safety-test.js',
    },
    sdk: '@cloudbase/node-sdk',
    normalization_version: 'v365-ph-cooldown-dr-1',
  };
  const provPath = path.join(PROV_DIR, 'decision_result_cooldown.provenance.json');
  fs.writeFileSync(provPath, JSON.stringify(provenance, null, 2), 'utf8');

  console.log(`\n  [written] ${outPath}`);
  console.log(`  [written] ${provPath}`);
  console.log(`  file_sha256 = ${fileSha}`);
  console.log('\nDECISION_RESULT_ALLOWLIST_EXTENSION = COMPLETE（READ ONLY · NO MUTATION）');

  /* ---- 触发 R-03~R-06 重跑（独立性：由安全测试自行断言）---- */
  console.log('\n⚠️ 请运行 `node scripts/tools/cloudbase-readonly-safety-test.js` 重跑 R-03~R-06。');
}

main().catch((e) => { console.error(`[FATAL] ${e.stack || e.message}`); process.exit(1); });
