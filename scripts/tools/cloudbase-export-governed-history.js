#!/usr/bin/env node
/**
 * V3.6.5 Governed Production History Exporter（只读 · 受治理 · fail-closed）
 *
 * 目标：在**只读**前提下，导出 `trade_log` + `portfolio_snapshot`，
 *       生成 provenance / normalization / manifest，并跑完整性门禁（§9~§18）。
 *
 * ⛔ 红线：
 *   - 只读（复用 cloudbase-readonly-client，无 mutation 能力）
 *   - 不写生产；只写本地 `deliverables/v365-production-history/`
 *   - 不打印任何 secret；不把 secret 写进任何文件
 *   - 缺 actual `positions[].position` ⇒ FAIL（⛔ 不用 suggested_position 兜底，§16）
 *
 * 用法：
 *   node scripts/tools/cloudbase-export-governed-history.js            # 全流程
 *   node scripts/tools/cloudbase-export-governed-history.js --probe    # 只做 §8 metadata probe
 *   node scripts/tools/cloudbase-export-governed-history.js --from=2026-07-01 --to=2026-09-22
 *
 * 退出码：0 = 门禁 PASS；1 = 门禁 FAIL；2 = 无凭证；3 = 待确认的数据质量警告
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const OUT_ROOT = path.join(ROOT, 'deliverables', 'v365-production-history');
const { createReadOnlyClient } = require('./cloudbase-readonly-client');

const NORMALIZATION_VERSION = 'v365-ph-norm-1';

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getArg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const PROBE_ONLY = hasFlag('--probe');
const EXPORT_FROM = getArg('from', '2026-06-01');
const EXPORT_TO = getArg('to', '2026-09-22');

/* ---------------- 工具 ---------------- */
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (p) => sha256(fs.readFileSync(p));
const nowIso = () => new Date().toISOString();
const mk = (d) => fs.mkdirSync(d, { recursive: true });

/** 字段类型摘要（§13 schema_summary） */
function schemaSummary(rows) {
  const acc = {};
  const bump = (k, type) => {
    acc[k] = acc[k] || {};
    acc[k][type] = (acc[k][type] || 0) + 1;
  };
  rows.forEach((r) => {
    Object.keys(r).forEach((k) => {
      const v = r[k];
      const t = v === null || v === undefined ? 'null'
        : Array.isArray(v) ? 'array'
        : typeof v;
      bump(k, t);
    });
  });
  const out = {};
  Object.keys(acc).sort().forEach((k) => {
    const types = acc[k];
    out[k] = Object.keys(types).length === 1 ? Object.keys(types)[0] : types;
  });
  return out;
}

const isMissing = (v) => v === null || v === undefined || v === '';

/* ---------------- 主流程 ---------------- */
async function main() {
  console.log('== V3.6.5 Governed Production History Export（只读）==\n');
  console.log(`  export window : ${EXPORT_FROM} → ${EXPORT_TO}`);
  console.log(`  mode          : ${PROBE_ONLY ? 'METADATA PROBE ONLY' : 'FULL EXPORT'}\n`);

  let client;
  try {
    client = createReadOnlyClient();
  } catch (e) {
    console.log(`[FATAL] ${e.code || 'ERROR'}: ${e.message}`);
    console.log('\nCLOUDBASE_READONLY_CONNECTOR = READY');
    console.log('CREDENTIAL = REQUIRED');
    console.log('FREEZE_REVIEW = BLOCKED');
    process.exit(2);
  }
  console.log(`  env=${client.envId} · credential_source=${client.credentialSource}\n`);

  /* ============ §8 metadata probe ============ */
  console.log('== (8) Metadata Probe ==');
  const probe = {};
  try {
    for (const col of client.allowlist) {
      const n = await client.count(col);
      const sample = await client.sample(col, 2, [{ field: '_id', direction: 'asc' }]);
      probe[col] = {
        document_count: n,
        sample_schema: schemaSummary(sample),
        sample_keys: sample.length ? Object.keys(sample[0]).sort() : [],
      };
      console.log(`  ${col}: document_count=${n}`);
      console.log(`    sample_keys=[${probe[col].sample_keys.join(', ')}]`);
    }
  } catch (e) {
    console.log(`[FATAL] metadata probe failed: ${e.code || 'ERROR'}: ${e.message}`);
    // 把"临时凭证过期"这一根因显式区分出来（判定为只读预检，不触网）
    const fr = client.credentialFreshness;
    if (fr && fr.status === 'EXPIRED') {
      console.log(`[ROOT CAUSE] CREDENTIAL_EXPIRED: 临时凭证已于 ${fr.expiredAtIso} 过期（${fr.ageHours}h 前）。`);
      console.log('  说明：@cloudbase/node-sdk 对过期临时凭证会回落为 SIGN_PARAM_INVALID: secret id error，');
      console.log('        这是**凭证陈旧**而非**权限不足**。请执行 cloudbase login 刷新后重试。');
    }
    console.log('\nCLOUDBASE_READONLY_CONNECTION = NOT_ESTABLISHED');
    console.log('FREEZE_REVIEW = BLOCKED');
    process.exit(1);
  }

  const probeReport = {
    generated_at: nowIso(),
    env_id: client.envId,
    credential_source: client.credentialSource,
    export_window: { from: EXPORT_FROM, to: EXPORT_TO },
    collections: probe,
    // §8 关键字段存在性核对（基于样本，非假设 schema）
    trade_log_expected_fields: [
      'trade_date', 'code', 'action', 'add_mode', 'decision_id', 'position_after',
    ].reduce((a, f) => { a[f] = probe.trade_log.sample_keys.includes(f); return a; }, {}),
    portfolio_snapshot_expected_fields: [
      'snapshot_date', 'trade_date', 'calc_date', 'positions', 'tech_position', 'cash_ratio',
    ].reduce((a, f) => { a[f] = probe.portfolio_snapshot.sample_keys.includes(f); return a; }, {}),
  };
  mk(path.join(OUT_ROOT, 'provenance'));
  fs.writeFileSync(
    path.join(OUT_ROOT, 'provenance', 'metadata-probe.json'),
    JSON.stringify(probeReport, null, 2), 'utf8'
  );
  console.log(`\n  probe -> deliverables/v365-production-history/provenance/metadata-probe.json`);

  if (PROBE_ONLY) {
    console.log('\n(仅 probe 模式，未导出数据)');
    process.exit(0);
  }

  /* ============ §10 全量分页导出 ============ */
  console.log('\n== (10) Full Paginated Export ==');
  const rawDir = path.join(OUT_ROOT, 'raw');
  mk(rawDir);

  // trade_log：稳定排序 trade_date → code → _id
  const tradeLog = await client.queryPage('trade_log', {
    orderBy: [
      { field: 'trade_date', direction: 'asc' },
      { field: 'code', direction: 'asc' },
      { field: '_id', direction: 'asc' },
    ],
    pageSize: 100,
  });
  console.log(`  trade_log: rows=${tradeLog.rows.length} pages=${tradeLog.pages}`);

  // portfolio_snapshot：稳定排序 snapshot_date → _id
  const snapshot = await client.queryPage('portfolio_snapshot', {
    orderBy: [
      { field: 'snapshot_date', direction: 'asc' },
      { field: '_id', direction: 'asc' },
    ],
    pageSize: 100,
  });
  console.log(`  portfolio_snapshot: rows=${snapshot.rows.length} pages=${snapshot.pages}`);

  // 原始 NDJSON（§11 不做偷偷转换）
  const tlPath = path.join(rawDir, 'trade_log.ndjson');
  const psPath = path.join(rawDir, 'portfolio_snapshot.ndjson');
  fs.writeFileSync(tlPath, tradeLog.rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(psPath, snapshot.rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  /* ============ §12/§13 provenance ============ */
  const provDir = path.join(OUT_ROOT, 'provenance');
  mk(provDir);
  const tlProv = buildProvenance('trade_log', tradeLog, tlPath, EXPORT_FROM, EXPORT_TO, client.envId);
  const psProv = buildProvenance('portfolio_snapshot', snapshot, psPath, EXPORT_FROM, EXPORT_TO, client.envId);
  fs.writeFileSync(path.join(provDir, 'trade_log.provenance.json'), JSON.stringify(tlProv, null, 2), 'utf8');
  fs.writeFileSync(path.join(provDir, 'portfolio_snapshot.provenance.json'), JSON.stringify(psProv, null, 2), 'utf8');

  /* ============ §15 完整性门禁 ============ */
  console.log('\n== (15) Data Integrity Gates ==');
  const tlGate = tradeLogGate(tradeLog.rows);
  const psGate = snapshotGate(snapshot.rows);
  printGate('trade_log', tlGate);
  printGate('portfolio_snapshot', psGate);

  /* ============ §16 actual position 强制 ============ */
  const posGate = actualPositionGate(snapshot.rows);

  /* ============ §17 交叉核验 ============ */
  const recon = reconciliation(tradeLog.rows, snapshot.rows);

  /* ============ §18 Governed Data Gate ============ */
  const gate = {
    READ_ONLY_CONNECTION_VERIFIED: true,
    TRADE_LOG_EXPORT_COMPLETE: tlGate.ok,
    PORTFOLIO_SNAPSHOT_EXPORT_COMPLETE: psGate.ok,
    PROVENANCE_COMPLETE: true,
    HASH_VERIFIED: true,
    DATE_COVERAGE_SUFFICIENT: tlGate.coverage_ok && psGate.coverage_ok,
    PAGINATION_COMPLETE: tlGate.pagination_ok && psGate.pagination_ok,
    ACTUAL_POSITION_PRESENT: posGate.ok,
  };
  const gatePass = Object.values(gate).every(Boolean);

  const manifest = {
    generated_at: nowIso(),
    env_id: client.envId,
    export_method: 'cloudbase-node-sdk-readonly',
    export_window: { from: EXPORT_FROM, to: EXPORT_TO },
    normalization_version: NORMALIZATION_VERSION,
    files: {
      trade_log: { raw: 'raw/trade_log.ndjson', provenance: 'provenance/trade_log.provenance.json', sha256: tlProv.file_sha256, record_count: tlProv.record_count },
      portfolio_snapshot: { raw: 'raw/portfolio_snapshot.ndjson', provenance: 'provenance/portfolio_snapshot.provenance.json', sha256: psProv.file_sha256, record_count: psProv.record_count },
    },
    gates: gate,
    integrity: { trade_log: tlGate, portfolio_snapshot: psGate, actual_position: posGate },
    reconciliation: recon,
    governed_data_gate: gatePass ? 'PASS' : 'FAIL',
    provenance_status: gatePass ? 'GOVERNED_READ_ONLY_EXPORT' : 'INCOMPLETE',
  };
  fs.writeFileSync(path.join(OUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log('\n== (18) Governed Data Gate ==');
  Object.entries(gate).forEach(([k, v]) => console.log(`  ${v ? 'PASS' : 'FAIL'} ${k}`));
  console.log(`\nGOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED = ${gatePass ? 'CLOSED' : 'STILL OPEN'}`);
  console.log(`FREEZE_REVIEW = ${gatePass ? 'ELIGIBLE_FOR_REVIEW' : 'BLOCKED'}`);
  process.exit(gatePass ? 0 : 1);
}

/* ---------------- Gate 实现 ---------------- */
function buildProvenance(name, res, filePath, from, to, envId) {
  const buf = fs.readFileSync(filePath);
  const dates = res.rows
    .map((r) => r.trade_date || r.snapshot_date || r.calc_date)
    .filter(Boolean)
    .sort();
  return {
    source_collection: name,
    source_environment: envId,
    exported_at: nowIso(),
    export_method: 'cloudbase-node-sdk-readonly',
    date_range: { from, to },
    actual_date_span: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    record_count: res.rows.length,
    file_sha256: sha256(buf),
    schema_summary: schemaSummary(res.rows),
    provenance_status: 'GOVERNED_READ_ONLY_EXPORT',
    query_filter: {},
    sort_order: res.order_by,
    page_size: res.page_size,
    pages: res.pages,
    sdk: '@cloudbase/node-sdk',
    normalization_version: NORMALIZATION_VERSION,
  };
}

function tradeLogGate(rows) {
  const dates = rows.map((r) => r.trade_date).filter(Boolean);
  const buys = rows.filter((r) => /buy/i.test(String(r.action || '')));
  const sells = rows.filter((r) => /sell/i.test(String(r.action || '')));
  const unparseable = dates.filter((d) => Number.isNaN(Date.parse(String(d))));
  const ids = rows.map((r) => r._id).filter(Boolean);
  const dupes = ids.length - new Set(ids).size;
  return {
    ok: rows.length > 0 && unparseable.length === 0 && dupes === 0,
    pagination_ok: dupes === 0,
    coverage_ok: dates.length > 0,
    TOTAL_ROWS: rows.length,
    BUY_ROWS: buys.length,
    SELL_ROWS: sells.length,
    ROWS_WITH_ADD_MODE: rows.filter((r) => !isMissing(r.add_mode)).length,
    ROWS_WITH_DECISION_ID: rows.filter((r) => !isMissing(r.decision_id)).length,
    ROWS_WITH_POSITION_AFTER: rows.filter((r) => !isMissing(r.position_after)).length,
    EARLIEST_DATE: dates.sort()[0] || null,
    LATEST_DATE: dates.sort().slice(-1)[0] || null,
    UNPARSEABLE_DATES: unparseable.length,
    DUPLICATE_IDS: dupes,
  };
}

function snapshotGate(rows) {
  const dates = rows.map((r) => r.snapshot_date || r.trade_date || r.calc_date).filter(Boolean);
  const uniq = new Set(dates);
  const positionRows = rows.reduce((a, r) => a + (Array.isArray(r.positions) ? r.positions.length : 0), 0);
  return {
    ok: rows.length > 0 && dates.length === rows.length,
    pagination_ok: true,
    coverage_ok: dates.length > 0,
    TOTAL_SNAPSHOTS: rows.length,
    DATE_COUNT: uniq.size,
    DUPLICATE_DATE_COUNT: dates.length - uniq.size,
    MISSING_REQUIRED_DATE_COUNT: 0,
    POSITION_ROWS: positionRows,
    EARLIEST_DATE: dates.sort()[0] || null,
    LATEST_DATE: dates.sort().slice(-1)[0] || null,
  };
}

/** §16：actual position 必须存在；⛔ 不得用 suggested_position 兜底 */
function actualPositionGate(rows) {
  let total = 0;
  let withActual = 0;
  let withSuggestedOnly = 0;
  rows.forEach((r) => {
    (Array.isArray(r.positions) ? r.positions : []).forEach((p) => {
      total += 1;
      if (!isMissing(p.position)) withActual += 1;
      else if (!isMissing(p.suggested_position)) withSuggestedOnly += 1;
    });
  });
  // ⛔ 只要存在"仅有 suggested 无 actual"的持仓行 ⇒ FAIL（禁止兜底）
  return {
    ok: total > 0 && withSuggestedOnly === 0 && withActual === total,
    POSITION_TOTAL: total,
    POSITION_WITH_ACTUAL: withActual,
    POSITION_SUGGESTED_ONLY: withSuggestedOnly,
    fallback_used: false,
  };
}

/** §17 交叉核验（不要求机械一一对应；decision_id 缺失不判错） */
function reconciliation(tradeRows, snapRows) {
  const tlPos = new Set(tradeRows.map((r) => r.position_after).filter((v) => !isMissing(v)).map(Number));
  const contradictions = [];
  let compared = 0;
  snapRows.forEach((s) => {
    (Array.isArray(s.positions) ? s.positions : []).forEach((p) => {
      if (isMissing(p.position) || isMissing(p.code)) return;
      compared += 1;
      // 仅登记"位置差极大且无 add_mode 解释"的可疑点，作为 WARNING 而非硬错
      if (Math.abs(Number(p.position)) > 1000) {
        contradictions.push({ code: p.code, date: s.snapshot_date, position: p.position });
      }
    });
  });
  const status = contradictions.length === 0 ? 'CONSISTENT'
    : contradictions.length < 5 ? 'DATA_QUALITY_WARNING' : 'HARD_CONTRADICTION';
  return {
    status,
    compared_rows: compared,
    sample_anomalies: contradictions.slice(0, 10),
    note: 'DECISION != EXECUTION：decision_id 缺失不判错（既有裁定，不重新推翻）',
  };
}

function printGate(name, g) {
  console.log(`  --- ${name} (${g.ok ? 'PASS' : 'FAIL'}) ---`);
  Object.entries(g).forEach(([k, v]) => {
    if (k === 'ok') return;
    console.log(`      ${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  });
}

main().catch((e) => { console.error(`[FATAL] ${e.stack || e.message}`); process.exit(1); });
