/**
 * V3.0 v1.1 P5 — 生产环境 MarketScore / Regime 解析
 */
'use strict';

const { COLLECTIONS, TECH_SECTORS } = require('../constants.js');
const { resolveMarketEnvironment } = require('./market-regime.js');

function pickTechSnapshots(prepared) {
  return (prepared || [])
    .filter((p) => p.snapshot && p.etf && TECH_SECTORS.indexOf(p.etf.sector) >= 0)
    .map((p) => ({
      volume_ratio: p.snapshot.volume_ratio,
      change_5d: p.snapshot.change_5d,
      breakout_nd: p.snapshot.breakout_nd,
      v_state: p.snapshot.v_state,
      w_state: p.snapshot.w_state
    }));
}

async function deriveMarketEnvironmentForPortfolio(db, indicators, prepared, globalSignals, options) {
  const envRows = await db.query(COLLECTIONS.MARKET_ENV, {});
  const indexWStates = [];
  (envRows || []).forEach((row) => {
    const bars = row.weekly_bars || [];
    if (bars.length < 20) return;
    indexWStates.push(indicators.detectWState(bars, {}).state);
  });

  const etfWStates = (prepared || [])
    .filter((p) => p.snapshot && p.snapshot.w_state)
    .map((p) => p.snapshot.w_state);

  const techWStates = (prepared || [])
    .filter((p) => p.snapshot && p.etf && TECH_SECTORS.indexOf(p.etf.sector) >= 0)
    .map((p) => p.snapshot.w_state);

  const ndx = (globalSignals || []).find((s) => s.symbol === 'usNDX');
  const activeEvents = await db.query(COLLECTIONS.RISK_EVENTS, { status: 'active' });
  let hasRed = false;
  (activeEvents || []).forEach((ev) => {
    if (ev.risk_flag === 'RED') hasRed = true;
  });

  const breadthSource = (options && options.breadthSource) || 'index';
  const growthRow = (envRows || []).find((r) => r.index_code === '000688');
  const broadRow = (envRows || []).find((r) => r.index_code === '000300');

  return resolveMarketEnvironment({
    indexWStates,
    etfWStates,
    techWStates,
    ndxTrend: ndx ? ndx.trend_20d : null,
    risk: { risk_flag: hasRed ? 'RED' : 'NORMAL' },
    riskEventsActive: hasRed && (activeEvents || []).length > 0,
    breadthSource,
    techSnapshots: pickTechSnapshots(prepared),
    growthWeeklyBars: growthRow ? growthRow.weekly_bars : null,
    broadWeeklyBars: broadRow ? broadRow.weekly_bars : null
  });
}

module.exports = {
  deriveMarketEnvironmentForPortfolio,
  pickTechSnapshots
};
