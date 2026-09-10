#!/usr/bin/env node
/**
 * Gen-1 经济健康聚合（WP-G1.1 / G1.1-04，离线任务）。
 *
 * 复审 P0-4：线上 `gen1_health_status` 之前只由 dataHealth 决定，没有消费
 * Incremental Alpha / False Fast Path / Calibration Drift / 独立事件数。
 * 本脚本从 Shadow 事件序列计算经济健康，产出可写入 `gen1_health_state` 的片段。
 *
 * 输入：事件 JSON（数组），每项建议含
 *   { code, date, event_cluster_id?, fwd_excess_20d }   —— canary 事件相对基准的 20D 超额
 * 可由 shadow reconcile 产物（scripts/ml/shadow-reconcile-outcomes.py 等）转换而来。
 *
 * WP-G1.2 G1.2-04：独立事件口径 = `event_cluster_id` 去重 + **真实交易日历** 40D 间隔。
 * 强烈建议用 `--calendar` 提供交易日历；缺失时退化为 1.5× 自然日保守口径并显式标注。
 *
 * 输出：JSON（默认 stdout，可用 --out 落盘）
 *   { economic_health: 'PENDING|OK|WARNING|DEGRADED|ML_OFF', independent_event_gap_basis, ...detail }
 *
 * 纪律：独立事件 < minEvents（默认 20）→ **PENDING**，绝不以 OK 冒充。
 *
 * 用法：
 *   node scripts/gen1-health-aggregator.js --events <events.json> [--calendar <days.json>] [--out <out.json>] [--min-events 20]
 *   node scripts/gen1-health-aggregator.js            # 无事件 → PENDING（诚实默认）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { aggregateEconomicHealth } = require(path.join(REPO, 'src/common/utils/gen1-economic-health.js'));

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=')[1];
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1];
  return dflt;
}

/** 交易日历：支持 JSON 数组、{dates:[...]}、或每行一个日期的文本。 */
function loadCalendar(file) {
  if (!file || !fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return null;
  if (raw[0] === '[' || raw[0] === '{') {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.dates || []);
    return list.map((d) => String(d).slice(0, 10)).sort();
  }
  return raw.split(/\r?\n/).map((l) => l.trim().slice(0, 10)).filter(Boolean).sort();
}

function main() {
  const eventsPath = arg('events', null);
  const calendarPath = arg('calendar', null);
  const outPath = arg('out', null);
  const minEvents = Number(arg('min-events', 20));

  let events = [];
  let source = 'no_events_default_pending';
  if (eventsPath && fs.existsSync(eventsPath)) {
    const raw = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    events = Array.isArray(raw) ? raw : (raw.events || []);
    source = eventsPath;
  }
  const tradingCalendar = loadCalendar(calendarPath);

  const result = aggregateEconomicHealth(events, { minEvents, tradingCalendar });
  const payload = Object.assign({ source, generated_at: new Date().toISOString() }, result,
    {
      economic_health: result.status,
      calendar_source: tradingCalendar ? calendarPath : null,
      calendar_days: tradingCalendar ? tradingCalendar.length : 0
    });

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }
  console.log(JSON.stringify(payload, null, 2));

  // 纪律守卫：样本不足必须是 PENDING
  if (payload.economic_health === 'OK' && result.independent_event_count < minEvents) {
    console.error('FATAL: 样本不足却返回 OK（违反 G1.1-04 纪律）');
    process.exitCode = 1;
  }
  // 纪律守卫：无交易日历不得被当作「可信口径」
  if (result.independent_event_gap_basis !== 'TRADING_DAYS') {
    console.error('WARN: 未提供交易日历（gap_basis=' + result.independent_event_gap_basis
      + '），独立事件为保守下界；Economic Gate 不应引用该数字作为充分证据。');
  }
}

main();
