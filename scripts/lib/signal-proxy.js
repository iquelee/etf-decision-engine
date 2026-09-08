/**
 * 回测 F / Regime / 溢价代理（对照，默认关闭）。
 * 本地 CSV 没有宽基周线、基本面序列、IOPV，不能冒充生产口径。
 * F ← 该票 W；regime ← 科技三票 W（阈值与生产 deriveMarketRegime 相同，无纳指）；
 * 溢价 ← bias_20d（拥挤度会和偏离重复计算，必须标成代理）。
 */
'use strict';

const F_FROM_W = { W1: 'F1', W2: 'F2', W3: 'F3', W4: 'F4', W5: 'F5' };
const F_SCORE = { F1: 25, F2: 20, F3: 15, F4: 10, F5: 5 };

function fFromW(w) {
  return F_FROM_W[w] || 'F3';
}

function fScore(f) {
  return F_SCORE[f] != null ? F_SCORE[f] : 15;
}

/** 与生产 deriveMarketRegime 同一套分数阈值；入参是周线 W，不是仓位。 */
function regimeFromWStates(states) {
  let score = 0;
  let scored = 0;
  (states || []).forEach((w) => {
    if (!w) return;
    scored += 1;
    if (w === 'W1' || w === 'W2') score += 2;
    else if (w === 'W3') score += 1;
  });
  if (scored === 0) return 'range';
  if (score >= 6) return 'aggressive';
  if (score >= 4) return 'structural';
  if (score >= 2) return 'range';
  if (score >= 1) return 'defensive';
  return 'crisis';
}

module.exports = { fFromW, fScore, regimeFromWStates, F_FROM_W };
