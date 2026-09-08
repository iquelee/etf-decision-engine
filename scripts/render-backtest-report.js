/**
 * 从全链路回测 JSON 生成 HTML。V3.1 B1：标题写 V3.1，页首标明跑输等权。
 * 运行：node scripts/render-backtest-report.js [jsonPath]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const prevArg = process.argv.find((a) => a.startsWith('--prev='));
const src = argv[0]
  ? path.resolve(argv[0])
  : path.join(OUT_DIR, `full-engine-${new Date().toISOString().slice(0, 10)}.json`);

if (!fs.existsSync(src)) {
  console.error('找不到回测 JSON:', src);
  process.exit(1);
}

const s = JSON.parse(fs.readFileSync(src, 'utf8'));
const gap = Math.round((s.engine.totalRet - s.equalWeight.totalRet) * 100) / 100;
const names = {
  '513310': '中韩半导体', '515880': '通信ETF', '159582': '半导体设备',
  '518880': '黄金ETF', '159570': '创新药ETF'
};
const perRows = Object.keys(s.perEtf || {}).map((code) => {
  const p = s.perEtf[code];
  return `<tr><td>${names[code] || code}</td><td>${p.buys}</td><td>${p.sells}</td></tr>`;
}).join('');
const nav = s.navSeries || [];
const months = Object.keys(s.monthly || {}).sort();
const book = s.book || {};
const mtm = s.mtm || {};
const levNote = book.leverage_contrib_pp != null
  ? `日均合计仓 ${book.avg}% · 去杠杆累计 ${book.unlev_totalRet}% · 隐杠杆 ${book.leverage_contrib_pp > 0 ? '+' : ''}${book.leverage_contrib_pp}pp · 最低现金未夹 ${book.min_cash_raw}%。`
  : '';
const mtmNote = mtm.totalRet != null
  ? `市值重标对照 ${mtm.totalRet}%（相对粘性 ${mtm.vs_engine_pp > 0 ? '+' : ''}${mtm.vs_engine_pp}pp），期末合计 ${mtm.end_book}% / 最大 ${mtm.max_book}%。`
  : '';
const bookNote = book.max != null
  ? `期末合计仓 ${book.end}% · 最大合计仓 ${book.max}% · 合计>100% ${book.days_over_100 || 0} 天 · 现金未夹 ${book.cash_raw}%（报表现金仍夹成 ≥0）。${levNote}${mtmNote}口径：F3+range+无溢价+粘性仓位%。`
  : '';
const f5Note = (s.f5_zero_days && s.f5_zero_days.length)
  ? `合成 F5 路径已触发清仓：${s.f5_zero_days.slice(0, 3).map((x) => x.date + ' ' + x.code).join('，')}`
  : '';

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>全链路回测 · V3.8</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
body { font-family: -apple-system, "PingFang SC", sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { color: #94a3b8; font-size: 13px; margin-bottom: 12px; }
.banner { background: #7f1d1d; border: 1px solid #b91c1c; border-radius: 10px; padding: 12px 16px; margin-bottom: 20px; font-size: 14px; }
.grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
.kpi { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px; }
.kpi .v { font-size: 22px; font-weight: 700; margin-top: 4px; }
.kpi .l { color: #94a3b8; font-size: 12px; }
.kpi .up { color: #f87171; } .kpi .down { color: #34d399; }
.card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.card h3 { margin: 0 0 10px; font-size: 14px; color: #cbd5e1; }
.chart { width: 100%; height: 340px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #334155; }
th { color: #94a3b8; font-weight: 500; }
</style></head><body>
<h1>ETF 全链路仓位回测 · V3.8（赛道硬顶）</h1>
<div class="sub">${s.window.start} → ${s.window.end} · ${s.window.days} 交易日 · T+1 日度复利 · mild 冻结 0.95 · 快照按日期对齐</div>
<div class="banner">引擎 ${s.engine.totalRet}% vs 等权 ${s.equalWeight.totalRet}%（${gap > 0 ? '+' : ''}${gap}pp）。${s.prev_label || (prevArg && prevArg.slice(7)) || 'V3.7 基线 124.40%'}。期末现金(夹0) ${s.cashRatio}%。${bookNote} ${f5Note}</div>
<div class="grid">
  <div class="kpi"><div class="l">引擎累计收益</div><div class="v up">${s.engine.totalRet}%</div></div>
  <div class="kpi"><div class="l">最大回撤</div><div class="v down">-${s.engine.maxDD}%</div></div>
  <div class="kpi"><div class="l">Sharpe（年化）</div><div class="v">${s.engine.sharpe}</div></div>
  <div class="kpi"><div class="l">期末合计仓</div><div class="v">${book.end != null ? book.end + '%' : '—'}</div></div>
  <div class="kpi"><div class="l">最大合计仓 / 超100%天数</div><div class="v">${book.max != null ? book.max + '% / ' + (book.days_over_100 || 0) : '—'}</div></div>
</div>
<div class="grid">
  <div class="kpi"><div class="l">日均合计仓</div><div class="v">${book.avg != null ? book.avg + '%' : '—'}</div></div>
  <div class="kpi"><div class="l">去杠杆累计</div><div class="v">${book.unlev_totalRet != null ? book.unlev_totalRet + '%' : '—'}</div></div>
  <div class="kpi"><div class="l">隐杠杆贡献</div><div class="v">${book.leverage_contrib_pp != null ? (book.leverage_contrib_pp > 0 ? '+' : '') + book.leverage_contrib_pp + 'pp' : '—'}</div></div>
  <div class="kpi"><div class="l">最低现金未夹</div><div class="v">${book.min_cash_raw != null ? book.min_cash_raw + '%' : '—'}</div></div>
  <div class="kpi"><div class="l">期末现金未夹</div><div class="v">${book.cash_raw != null ? book.cash_raw + '%' : '—'}</div></div>
</div>
<div class="grid">
  <div class="kpi"><div class="l">市值重标累计</div><div class="v">${mtm.totalRet != null ? mtm.totalRet + '%' : '—'}</div></div>
  <div class="kpi"><div class="l">相对粘性</div><div class="v">${mtm.vs_engine_pp != null ? (mtm.vs_engine_pp > 0 ? '+' : '') + mtm.vs_engine_pp + 'pp' : '—'}</div></div>
  <div class="kpi"><div class="l">市值重标期末合计</div><div class="v">${mtm.end_book != null ? mtm.end_book + '%' : '—'}</div></div>
  <div class="kpi"><div class="l">市值重标最大合计</div><div class="v">${mtm.max_book != null ? mtm.max_book + '%' : '—'}</div></div>
  <div class="kpi"><div class="l">口径</div><div class="v" style="font-size:14px">粘性%主曲线</div></div>
</div>
<div class="card"><h3>累计收益曲线（引擎粘性% vs 市值重标 vs 去杠杆 vs 等权）</h3><div id="nav" class="chart"></div></div>
<div class="card"><h3>分月收益</h3><div id="monthly" class="chart"></div></div>
<div class="grid" style="grid-template-columns: 1fr 1fr;">
  <div class="card"><h3>期末仓位</h3>
    <table><tr><th>标的</th><th>仓位%</th></tr>
    ${Object.keys(s.finalPositions || {}).map((c) => `<tr><td>${names[c] || c}</td><td>${s.finalPositions[c]}${mtm.weights && mtm.weights[c] != null ? ' · 市值 ' + mtm.weights[c] : ''}</td></tr>`).join('')}
    </table>
  </div>
  <div class="card"><h3>单票建仓/减仓次数</h3>
    <table><tr><th>标的</th><th>建/加</th><th>减仓</th></tr>${perRows}</table>
    <div style="margin-top:10px;color:#94a3b8;font-size:12px">动作 ${JSON.stringify(s.actions)} · 实际调仓 ${s.trades} 笔</div>
  </div>
</div>
<script>
const nav = ${JSON.stringify(nav.map((n) => [n.date, n.engine, n.equalWeight, n.unlev, n.mtm]))};
const months = ${JSON.stringify(months.map((m) => [m, s.monthly[m].engine, s.monthly[m].equal]))};
echarts.init(document.getElementById('nav')).setOption({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis' },
  legend: { data: ['引擎', '市值重标', '去杠杆', '等权'], textStyle: { color: '#94a3b8' } },
  xAxis: { type: 'category', data: nav.map(r => r[0]), axisLabel: { color: '#94a3b8' } },
  yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
  series: [
    { name: '引擎', type: 'line', showSymbol: false, data: nav.map(r => r[1]) },
    { name: '市值重标', type: 'line', showSymbol: false, data: nav.map(r => r[4]) },
    { name: '去杠杆', type: 'line', showSymbol: false, data: nav.map(r => r[3]), lineStyle: { type: 'dashed' } },
    { name: '等权', type: 'line', showSymbol: false, data: nav.map(r => r[2]) }
  ]
});
echarts.init(document.getElementById('monthly')).setOption({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis' },
  legend: { data: ['引擎', '等权'], textStyle: { color: '#94a3b8' } },
  xAxis: { type: 'category', data: months.map(r => r[0]), axisLabel: { color: '#94a3b8' } },
  yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
  series: [
    { name: '引擎', type: 'bar', data: months.map(r => r[1]) },
    { name: '等权', type: 'bar', data: months.map(r => r[2]) }
  ]
});
</script>
</body></html>
`;

const base = path.basename(src, '.json').replace(/^full-engine-/, 'report-');
const out = path.join(OUT_DIR, `${base}.html`);
fs.writeFileSync(out, html);
console.log('报告:', out);
