'use strict';
/* 核实「NEW 树 1次/日 vs 3次/日 的 day-end state 差异」是否**仅**为审计字段。 */
const fs = require('fs');
const path = require('path');
const DIR = process.env.V364_PB_DIR || path.join(__dirname, '..', '..', '..', '.v364-audit-work');
const R = (n) => path.join(DIR, n);
const A = JSON.parse(fs.readFileSync(R('new-r1.json'), 'utf8')).final_state;
const B = JSON.parse(fs.readFileSync(R('new-r3.json'), 'utf8')).final_state;
const CODES = Object.keys(A);

const diffKeys = {};
CODES.forEach((c) => {
  const a = A[c] || {}; const b = B[c] || {};
  Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).forEach((k) => {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      diffKeys[k] = diffKeys[k] || [];
      diffKeys[k].push({ code: c, x1: a[k], x3: b[k] });
    }
  });
});
console.log('NEW: day-end state 差异键 =', JSON.stringify(Object.keys(diffKeys)));
Object.keys(diffKeys).forEach((k) => {
  const s = diffKeys[k][0];
  console.log(`   ${k}  (${diffKeys[k].length} 票)  x1=${JSON.stringify(s.x1)}  x3=${JSON.stringify(s.x3)}`);
});

const DECF = ['stage', 'overlay', 'pendingStage', 'pendingDays', 'days_in_stage',
  'soft_down_days', 's5_risk_days', 'breakout_level', 's4_origin'];
let bad = 0;
const badDetail = [];
CODES.forEach((c) => DECF.forEach((f) => {
  if (JSON.stringify((A[c] || {})[f]) !== JSON.stringify((B[c] || {})[f])) {
    bad += 1;
    badDetail.push({ code: c, field: f, x1: (A[c] || {})[f], x3: (B[c] || {})[f] });
  }
}));
console.log(`\nNEW: 决策相关状态字段（${DECF.length} 个 × ${CODES.length} 票 = ${DECF.length * CODES.length} 项）不一致数 =`, bad);
if (bad) console.log('  明细:', JSON.stringify(badDetail.slice(0, 10), null, 1));
else console.log('  ⇒ 决策相关状态字段**全部逐位一致**；day-end state 的全部差异只在审计字段上。');
