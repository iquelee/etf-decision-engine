// 模拟 computeCooldownDays：用线上真实数据验证为什么所有 ETF cooldown_days=1
const fs = require('fs');
const dir = 'C:/c/tmp/cd-dump';
const readNDJSON = (f) => fs.readFileSync(dir + '/' + f, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const tradeFile = fs.readdirSync(dir).find(x => x.includes('trade_log'));
const dailyFile = fs.readdirSync(dir).find(x => x.includes('etf_daily'));
const trades = readNDJSON(tradeFile);
const dailies = readNDJSON(dailyFile);

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(a), db = new Date(b);
  if (isNaN(da) || isNaN(db)) return null;
  return Math.round((db - da) / (24 * 3600 * 1000));
}

// 复刻 runDecisionEngine computeCooldownDays（add_mode='无' → 基数 3）
function computeCooldownDays(code, today, cooldownBase = 3) {
  const buys = trades.filter(t => t.code === code && t.action === 'buy')
    .sort((a, b) => String(b.trade_date).localeCompare(String(a.trade_date)));
  if (!buys.length) return 0;
  const lastBuy = buys[0].trade_date;
  const dailyRows = dailies.filter(r => r.code === code)
    .sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
  const tradingDays = new Set();
  for (const r of dailyRows) {
    if (r.trade_date > lastBuy && r.trade_date <= today) tradingDays.add(r.trade_date);
  }
  return Math.max(0, cooldownBase - tradingDays.size);
}

const codes = ['513310', '515880', '159582', '518880', '159570'];
console.log('=== today=08-21（数据日） ===');
codes.forEach(c => console.log(c, 'lastBuy=', (trades.filter(t=>t.code===c&&t.action==='buy').map(t=>t.trade_date).sort().slice(-1)[0]||'无'), 'cooldown=', computeCooldownDays(c, '2026-08-21')));
console.log('=== today=08-24（快照日） ===');
codes.forEach(c => console.log(c, 'cooldown=', computeCooldownDays(c, '2026-08-24')));
console.log('=== 各ETF日线条数 ===');
codes.forEach(c => console.log(c, dailies.filter(r=>r.code===c).length, '最新=', dailies.filter(r=>r.code===c).map(r=>r.trade_date).sort().slice(-1)[0]));
console.log('=== trade_log 总数 ===', trades.length);
