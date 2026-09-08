'use strict';

const fs = require('fs');
const path = require('path');
const { ALL_ETFS, intersectTradeDates } = require('./universe.js');

const DEFAULT_CSV_DIR = path.join(__dirname, '../../deliverables/etf_daily_qfq');

function loadCsv(code, csvDir) {
  const files = fs.readdirSync(csvDir).filter((f) => f.startsWith(code));
  if (!files.length) throw new Error(`无 CSV: ${code}`);
  const lines = fs.readFileSync(path.join(csvDir, files[0]), 'utf8').split('\n');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const p = line.split(',');
    bars.push({
      trade_date: p[0], open: Number(p[1]), close: Number(p[2]),
      high: Number(p[3]), low: Number(p[4]), volume: Number(p[5])
    });
  }
  return bars;
}

/**
 * @param {string} [csvDir]
 * @param {Array<{code:string}>} [universe]
 */
function getCsvCoverage(csvDir = DEFAULT_CSV_DIR, universe = ALL_ETFS) {
  const barsMap = {};
  const per = [];
  for (const etf of universe) {
    const bars = loadCsv(etf.code, csvDir);
    barsMap[etf.code] = bars;
    per.push({
      code: etf.code,
      name: etf.name,
      rows: bars.length,
      start: bars[0] && bars[0].trade_date,
      end: bars[bars.length - 1] && bars[bars.length - 1].trade_date
    });
  }
  const intersection = intersectTradeDates(barsMap, universe);
  const intersectionStart = intersection[0] || null;
  const intersectionEnd = intersection[intersection.length - 1] || null;
  const warmupStartIdx = intersection.findIndex((d) => d >= intersectionStart);
  const evalStart = intersection[Math.max(60, warmupStartIdx + 60)] || intersectionStart;
  return {
    csvDir,
    per,
    intersection: {
      days: intersection.length,
      start: intersectionStart,
      end: intersectionEnd,
      evalStartAfterWarmup: evalStart
    }
  };
}

module.exports = { DEFAULT_CSV_DIR, loadCsv, getCsvCoverage };
