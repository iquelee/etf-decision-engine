const cloudbase = require('@cloudbase/node-sdk');
const fs = require('fs');
const path = require('path');

const credPath = path.join(process.env.USERPROFILE, '.config', '.cloudbase', 'auth.json');
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const app = cloudbase.init({
  env: 'tradingview-etf-d0fa42yy57cbc11b',
  secretId: cred.credential.secretId,
  secretKey: cred.credential.secretKey
});
const db = app.database();

async function main() {
  // 1. Get recent 50 fetch_log entries
  const res = await db.collection('fetch_log').orderBy('fetch_time', 'desc').limit(50).get();
  const logs = res.data || [];
  console.log(`=== RECENT ${logs.length} FETCH_LOG ENTRIES ===\n`);

  // 2. Show each log entry
  for (const log of logs) {
    const time = log.fetch_time ? new Date(log.fetch_time).toISOString().slice(0, 19) : '?';
    const status = log.status || '?';
    const src = log.source || '?';
    const cnt = log.item_count || 0;
    const dur = log.duration_ms || 0;
    const err = (log.error || '').slice(0, 80);
    const task = log.task_name || '';
    console.log(`[${time}] ${status.toUpperCase().padEnd(8)} ${src.padEnd(22)} items=${cnt} dur=${dur}ms task=${task}`);
    if (err) console.log(`           error: ${err}`);
  }

  // 3. Summary by status
  console.log('\n=== STATUS SUMMARY ===');
  const byStatus = {};
  for (const log of logs) {
    const s = log.status || 'unknown';
    if (!byStatus[s]) byStatus[s] = { count: 0, sources: {} };
    byStatus[s].count++;
    const src = log.source || 'unknown';
    if (!byStatus[s].sources[src]) byStatus[s].sources[src] = 0;
    byStatus[s].sources[src]++;
  }
  for (const [status, info] of Object.entries(byStatus)) {
    console.log(`\n  ${status}: ${info.count} entries`);
    for (const [src, cnt] of Object.entries(info.sources)) {
      console.log(`    ${src}: ${cnt}`);
    }
  }

  // 4. Specifically show running (stuck) entries
  const running = logs.filter(l => l.status === 'running');
  if (running.length > 0) {
    console.log(`\n=== STUCK 'running' ENTRIES (${running.length}) ===`);
    for (const r of running) {
      const time = r.fetch_time ? new Date(r.fetch_time).toISOString().slice(0, 19) : '?';
      console.log(`  [${time}] source=${r.source} task=${r.task_name} items=${r.item_count} error=${(r.error || '').slice(0, 80)}`);
    }
  }

  // 5. Show fail entries with errors
  const fails = logs.filter(l => l.status === 'fail');
  if (fails.length > 0) {
    console.log(`\n=== FAILED ENTRIES (${fails.length}) ===`);
    for (const f of fails) {
      const time = f.fetch_time ? new Date(f.fetch_time).toISOString().slice(0, 19) : '?';
      console.log(`  [${time}] source=${f.source} error=${(f.error || '').slice(0, 100)}`);
    }
  }

  // 6. Show partial entries
  const partials = logs.filter(l => l.status === 'partial');
  if (partials.length > 0) {
    console.log(`\n=== PARTIAL ENTRIES (${partials.length}) ===`);
    for (const p of partials) {
      const time = p.fetch_time ? new Date(p.fetch_time).toISOString().slice(0, 19) : '?';
      console.log(`  [${time}] source=${p.source} items=${p.item_count} error=${(p.error || '').slice(0, 80)}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
