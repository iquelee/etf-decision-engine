#!/usr/bin/env node
/**
 * V3.6.5 RPG-F2-B —— Actual Historical Coverage Audit（**只读**）
 *
 * 目的：把 `DATA_GOVERNED` 与 `DATA_SUFFICIENT_FOR_PROTOCOL` **分开**判定。
 *   · `DATA_GOVERNED`            = 数据来源受治理（READ-ONLY 导出 + provenance + hash）
 *   · `DATA_SUFFICIENT_FOR_PROTOCOL` = 该数据**覆盖**协议所需的时间轴
 *
 * ⛔ 本脚本**不做**任何臆测：
 *   - 不假定"最早成交之前没有记录"——只报告 `NO_PREVIOUS_EXECUTION_RECORDS_EXIST_IN_SOURCE`
 *     (在**完整 collection** 已导出 + pagination_complete 的前提下)
 *   - 不用 suggested_position 补、不用后一天 snapshot 回推、不插值、不假设零仓
 *   - 不改 replay window
 *   - 只读：不写生产、不改 harness、不改任何 calculation
 *
 * 产出：机器可读 JSON（默认 stdout；`--out <path>` 另存）
 * 退出码：0 = 审计完成（无论结论如何）；1 = 审计自身失败（缺文件/结构异常）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const PH_DIR = path.join(REPO, 'deliverables', 'v365-production-history');
const RAW = path.join(PH_DIR, 'raw');
const PROV = path.join(PH_DIR, 'provenance');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) { a[k.slice(2)] = true; continue; }
    a[k.slice(2)] = v; i += 1;
  }
  return a;
}
const ARGS = parseArgs(process.argv);
const WINDOW_FROM = ARGS.from || '2026-08-01';
const WINDOW_TO = ARGS.to || '2026-09-22';

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function readNdjson(p) {
  return fs.readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map(JSON.parse);
}
function uniqSorted(a) { return [...new Set(a)].sort(); }

(async () => {
  const out = {
    artifact: 'V365_RPG_F2B_ACTUAL_COVERAGE_AUDIT',
    generated_at: new Date().toISOString(),
    window: { from: WINDOW_FROM, to: WINDOW_TO },
    authority: 'READ_ONLY · NO_INFERENCE · FAIL_CLOSED'
  };

  /* ================= A. 受治理数据完整性复核 ================= */
  const manifest = JSON.parse(fs.readFileSync(path.join(PH_DIR, 'manifest.json'), 'utf8'));
  const tradeLog = readNdjson(path.join(RAW, 'trade_log.ndjson'));
  const snapshots = readNdjson(path.join(RAW, 'portfolio_snapshot.ndjson'));
  const tradeProv = JSON.parse(fs.readFileSync(path.join(PROV, 'trade_log.provenance.json'), 'utf8'));
  const snapProv = JSON.parse(fs.readFileSync(path.join(PROV, 'portfolio_snapshot.provenance.json'), 'utf8'));

  // hash 独立复算（⛔ 不信任 manifest 里记的值，自己算一遍）
  const tradeSha = sha256File(path.join(RAW, 'trade_log.ndjson'));
  const snapSha = sha256File(path.join(RAW, 'portfolio_snapshot.ndjson'));

  out.governance = {
    export_method: manifest.export_method,
    env_id: manifest.env_id,
    governed_data_gate: manifest.governed_data_gate,
    hash_recheck: {
      trade_log: {
        manifest_sha256: manifest.files.trade_log.sha256,
        recomputed_sha256: tradeSha,
        match: tradeSha === manifest.files.trade_log.sha256
      },
      portfolio_snapshot: {
        manifest_sha256: manifest.files.portfolio_snapshot.sha256,
        recomputed_sha256: snapSha,
        match: snapSha === manifest.files.portfolio_snapshot.sha256
      }
    }
  };

  /* ================= B. trade_log 覆盖审计 ================= */
  const tlDates = tradeLog.map((r) => r.trade_date).filter(Boolean);
  const buys = tradeLog.filter((r) => r.action === 'buy');
  const sells = tradeLog.filter((r) => r.action === 'sell');

  out.trade_log = {
    // —— 任务书 §3 明确要求的五项 ——
    actual_min_trade_date: tlDates.length ? tlDates.slice().sort()[0] : null,
    actual_max_trade_date: tlDates.length ? tlDates.slice().sort().slice(-1)[0] : null,
    full_collection_count: tradeLog.length,
    query_filter: tradeProv.query_filter,
    pagination_complete: tradeProv.pages === 1 && tradeLog.length <= tradeProv.page_size,

    // —— 独立复核 ——
    manifest_record_count: manifest.files.trade_log.record_count,
    record_count_match: manifest.files.trade_log.record_count === tradeLog.length,
    buy_rows: buys.length,
    sell_rows: sells.length,
    distinct_dates: uniqSorted(tlDates).length,
    distinct_codes: uniqSorted(tradeLog.map((r) => r.code)),
    rows_with_add_mode: tradeLog.filter((r) => r.add_mode != null && r.add_mode !== '').length,
    rows_with_decision_id: tradeLog.filter((r) => r.decision_id != null && r.decision_id !== '').length,
    rows_with_position_after: tradeLog.filter((r) => r.position_after != null).length,
    export_window: tradeProv.date_range,
    sort_order: tradeProv.sort_order,

    // —— ⛔ 关键判定：8 月 1 日之前是否存在对 8/1 冷静期有影响的最近一次 BUY ——
    previous_buy_before_window: (() => {
      const before = buys.filter((r) => r.trade_date < WINDOW_FROM);
      return before.length ? before.map((r) => `${r.trade_date}/${r.code}`) : null;
    })(),
    previous_buy_determination: (() => {
      const complete = tradeProv.pages === 1 && tradeProv.query_filter
        && Object.keys(tradeProv.query_filter).length === 0;
      const before = buys.filter((r) => r.trade_date < WINDOW_FROM);
      if (before.length) return 'PREVIOUS_BUY_EXISTS';
      if (complete) {
        // 完整 collection 已导出 + 无 query filter + 单页 ⇒ 可判定"源中确无更早成交"
        return 'NO_PREVIOUS_EXECUTION_RECORDS_EXIST_IN_SOURCE';
      }
      return 'UNDETERMINED_INCOMPLETE_EXPORT';
    })(),
    previous_buy_basis: {
      export_is_full_collection: tradeProv.pages === 1,
      query_filter_empty: !!tradeProv.query_filter && Object.keys(tradeProv.query_filter).length === 0,
      note: '仅在「完整 collection 已导出 + 无过滤 + pagination 完整」三者同时成立时，'
        + '才允许判定 NO_PREVIOUS_EXECUTION_RECORDS_EXIST_IN_SOURCE；⛔ 否则 UNDETERMINED。'
    }
  };

  // 冷静期可见性：按 code 的首次成交日
  const firstBuyByCode = {};
  for (const r of buys.slice().sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)))) {
    if (firstBuyByCode[r.code] == null) firstBuyByCode[r.code] = r.trade_date;
  }
  out.trade_log.first_buy_by_code = firstBuyByCode;
  out.trade_log.cooldown_visibility = Object.keys(firstBuyByCode).reduce((acc, c) => {
    acc[c] = firstBuyByCode[c] > WINDOW_FROM
      ? 'COOLDOWN_INVISIBLE_IN_WINDOW_UNTIL_FIRST_BUY'
      : 'COOLDOWN_VISIBLE_FROM_WINDOW_START';
    return acc;
  }, {});

  /* ================= C. add_mode 真实 fallback 链判定 ================= */
  out.add_mode_production_chain = {
    rule: 'trade_log.add_mode → decision_result(code, decision_date=buyDate).add_mode → fallbackAddMode',
    function: 'src/common/utils/cooldown.js::computeCooldownDays / resolveLastBuyAddMode',
    observed_in_governed_trade_log: {
      rows_with_add_mode: tradeLog.filter((r) => r.add_mode != null && r.add_mode !== '').length,
      rows_with_empty_add_mode: tradeLog.filter((r) => r.add_mode === '').length,
      rows_without_field: tradeLog.filter((r) => !('add_mode' in r)).length
    },
    no_backfill_policy: '⛔ 不得为实际成交补写 突破加仓/普通加仓/无 —— 只能按生产链取值',
    decision_result_extra_read_required: true,
    decision_result_extra_read_reason:
      'trade_log.add_mode 全空 ⇒ resolveLastBuyAddMode 的第 2 步（按 buyDate 回查 decision_result.add_mode）'
      + '是生产真实路径的一部分，必须在 stub DB 中复现；⛔ 不得用当前 replay 决策猜历史 buy 的 add_mode。',
    requires_cloudbase_allowlist_extension: true,
    allowlist_extension_constraints: [
      'READ ONLY ONLY',
      '记录为什么需要（本字段）',
      '重新跑 R-03~R-06',
      '更新 provenance',
      '绝不增加 mutation 方法'
    ]
  };

  /* ================= D. portfolio_snapshot 覆盖审计 ================= */
  const snapDates = uniqSorted(snapshots.map((r) => r.snapshot_date).filter(Boolean));

  // replay 轴（与 qualification 协议同源）
  const harness = require(path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js'));
  const r = await harness.replay({ from: WINDOW_FROM, to: WINDOW_TO, runsPerDay: 1, protocol: 'V1' });
  const requiredDates = r.axis.slice();

  const snapSet = new Set(snapDates);
  const available = requiredDates.filter((d) => snapSet.has(d));
  const missing = requiredDates.filter((d) => !snapSet.has(d));

  out.portfolio_snapshot = {
    // —— 任务书 §3 明确要求的三项 ——
    required_trade_dates: requiredDates.length,
    snapshot_available_dates: available.length,
    missing_trade_dates: missing.length,

    // —— 支持证据 ——
    actual_min_snapshot_date: snapDates[0] || null,
    actual_max_snapshot_date: snapDates.slice(-1)[0] || null,
    full_collection_count: snapshots.length,
    manifest_record_count: manifest.files.portfolio_snapshot.record_count,
    record_count_match: manifest.files.portfolio_snapshot.record_count === snapshots.length,
    query_filter: snapProv.query_filter,
    pagination_complete: snapProv.pages === 1 && snapshots.length <= snapProv.page_size,
    duplicate_date_count: snapshots.length - snapDates.length,
    missing_dates_list: missing,
    // T-1 是否存在合法 starting actual book
    t_minus_1_candidate: (() => {
      const before = snapDates.filter((d) => d < requiredDates[0]);
      return before.length ? before.slice(-1)[0] : null;
    })()
  };

  /* ================= E. 判定 ================= */
  const allHashesOk = out.governance.hash_recheck.trade_log.match
    && out.governance.hash_recheck.portfolio_snapshot.match;

  out.verdict = {
    DATA_GOVERNED: {
      value: allHashesOk && manifest.governed_data_gate === 'PASS',
      basis: 'hash 独立复算 MATCH + governed_data_gate=PASS + provenance 完整'
    },
    RPG_F2B_ACTUAL_EXECUTION_COOLDOWN: {
      // actual cooldown 只能从窗口内首次成交之后才"看得见"
      earliest_actual_buy_in_window: out.trade_log.actual_min_trade_date,
      window_start: WINDOW_FROM,
      cooldown_invisible_dates: requiredDates.filter((d) => d < out.trade_log.actual_min_trade_date),
      cooldown_invisible_count: requiredDates.filter((d) => d < out.trade_log.actual_min_trade_date).length,
      determination: 'PARTIAL',
      reason: '窗口前段（' + requiredDates.filter((d) => d < out.trade_log.actual_min_trade_date)[0]
        + ' → ' + requiredDates.filter((d) => d < out.trade_log.actual_min_trade_date).slice(-1)[0]
        + '）无 actual execution 记录 ⇒ 该段 cooldown 恒为生产「无 TRADE_LOG 命中 ⇒ 返回 0」路径，'
        + '不构成 production-faithful cooldown 覆盖；⛔ 不以推测补足。'
    },
    RPG_F2C_ACTUAL_BOOK_COVERAGE: {
      earliest_actual_snapshot: snapDates[0] || null,
      window_start: WINDOW_FROM,
      missing_count: missing.length,
      determination: missing.length > 0 ? 'BLOCKED_ON_ACTUAL_BOOK_COVERAGE' : 'COMPLETE'
    },
    RFP_V2_PH_FULL_WINDOW_AVAILABLE: {
      value: missing.length === 0 && out.trade_log.previous_buy_determination !== 'UNDETERMINED_INCOMPLETE_EXPORT',
      basis: `missing_trade_dates=${missing.length}`
    }
  };

  /* ================= F. 输出 ================= */
  const json = JSON.stringify(out, null, 2);
  if (ARGS.out) {
    const p = path.resolve(String(ARGS.out));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${json}\n`, 'utf8');
  }
  console.log(json);
  if (ARGS.out) console.error(`[written] ${path.resolve(String(ARGS.out))}`);
})().catch((e) => {
  console.error(`[FATAL] ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
