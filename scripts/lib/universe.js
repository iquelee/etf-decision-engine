/**
 * 回测票池：五票默认；`--codes=` 切子集。三票/两票是独立系列，不得与 126.46% 混比。
 */
'use strict';

const ALL_ETFS = [
  { code: '513310', name: '中韩半导体', sector: 'storage', is_qdii: true },
  { code: '515880', name: '通信ETF', sector: 'ai_network' },
  { code: '159582', name: '半导体设备', sector: 'semi_equip' },
  { code: '518880', name: '黄金ETF', sector: 'gold' },
  { code: '159570', name: '创新药ETF', sector: 'biotech' }
];

function parseCodes(str) {
  if (str == null || String(str).trim() === '') return null;
  return String(str).split(',').map((s) => s.trim()).filter(Boolean);
}

function selectUniverse(codes, catalog) {
  const all = catalog || ALL_ETFS;
  if (!codes || !codes.length) return all.slice();
  const picked = [];
  const seen = {};
  for (const c of codes) {
    if (seen[c]) throw new Error(`重复代码 ${c}`);
    seen[c] = true;
    const hit = all.find((e) => e.code === c);
    if (!hit) throw new Error(`未知代码 ${c}`);
    picked.push(hit);
  }
  return picked;
}

function equalWeight(n) {
  const k = Number(n);
  if (!(k > 0)) throw new Error(`等权需要 n>0，收到 ${n}`);
  return 1 / k;
}

function positionOf(positions, code) {
  return (positions && positions[code] && positions[code].current_position) || 0;
}

function sectorPosition(positions, universe, sector) {
  const etf = (universe || []).find((e) => e.sector === sector);
  return etf ? positionOf(positions, etf.code) : 0;
}

function intersectTradeDates(barsMap, universe) {
  let acc = null;
  for (const etf of universe) {
    const rows = (barsMap && barsMap[etf.code]) || [];
    const set = new Set(rows.map((b) => b.trade_date));
    if (acc == null) acc = [...set];
    else acc = acc.filter((d) => set.has(d));
  }
  return (acc || []).sort();
}

function seriesLabel(universe) {
  const n = (universe || []).length;
  if (n === 5) return '5ticket';
  if (n === 3) return '3ticket';
  if (n === 2) return '2ticket';
  return `${n}ticket`;
}

function listingBlockReason(codes) {
  const set = new Set(codes || []);
  if (set.has('159582') && set.has('159570') && set.size === 5) {
    return '159582 2024-04-16 上市，五票做不了 2022–2024';
  }
  if (set.has('513310') && set.size === 3 && !set.has('159582')) {
    return '513310 2022-12 上市，日历 2022 熊市最多两票（黄金+通信）';
  }
  if (set.size === 2 && set.has('518880') && set.has('515880')) {
    return '2022 熊市三票做不了（513310 未上市）；本窗是黄金+通信两票';
  }
  return null;
}

module.exports = {
  ALL_ETFS,
  parseCodes,
  selectUniverse,
  equalWeight,
  positionOf,
  sectorPosition,
  intersectTradeDates,
  seriesLabel,
  listingBlockReason
};
