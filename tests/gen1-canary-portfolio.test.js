'use strict';

/** G1.1-05 Canary 组合平价单测：同日多科技候选聚合后不得突破 tech cap。 */
const assert = require('assert');
const { clampCanaryCandidate } = require('../src/common/utils/gen1-canary');

const TECH_MAX = 65;

// 1) 单只科技 canary：额度充足 → 不 clamp
{
  const r = clampCanaryCandidate({ isTech: true, baselineTarget: 15, canaryTarget: 25, canaryEffective: true, techUsed: 0, effectiveTechMax: TECH_MAX });
  assert.strictEqual(r.clamped, false);
  assert.strictEqual(r.canaryTarget, 25);
  assert.strictEqual(r.techUsed, 10);
  assert.strictEqual(r.room, 65);
}

// 2) 四只科技同日 canary（各 +10，合计 40）→ 聚合增量被 clamp 到 tech cap 25 之内
{
  let used = 0;
  const results = [];
  for (const code of ['513310', '515880', '159582', '513310']) {
    const r = clampCanaryCandidate({ isTech: true, baselineTarget: 15, canaryTarget: 25, canaryEffective: true, techUsed: used, effectiveTechMax: 25 });
    results.push({ code, ...r });
    used = r.techUsed;
  }
  const totalDelta = results.reduce((s, r) => s + (r.canaryTarget - 15), 0);
  assert.ok(totalDelta <= 25 + 1e-9, `聚合科技增量 ${totalDelta} 必须 <= tech cap 25`);
  assert.strictEqual(results[0].clamped, false, '第一只占 10 额度');
  assert.strictEqual(results[1].clamped, false, '第二只占满剩余 15');
  assert.strictEqual(results[2].clamped, true, '第三只额度不足必须 clamp');
  assert.strictEqual(results[3].clamped, true, '第四只无额度必须 clamp 回 baseline');
  assert.strictEqual(results[0].canaryTarget, 25);
  assert.strictEqual(results[1].canaryTarget, 25);
  assert.strictEqual(results[2].canaryTarget, 20, '只剩 5 额度 → 15+5');
  assert.strictEqual(results[3].canaryTarget, 15, '无剩余额度 → 回落 baseline');
  assert.strictEqual(used, 25, '最终科技增量恰好用满 cap，不越界');
}

// 2b) 极端：cap 为 0 → 全部回落 baseline
{
  let used = 0;
  const out = [];
  for (let i = 0; i < 3; i += 1) {
    const r = clampCanaryCandidate({ isTech: true, baselineTarget: 15, canaryTarget: 25, canaryEffective: true, techUsed: used, effectiveTechMax: 0 });
    out.push(r); used = r.techUsed;
  }
  assert.ok(out.every((r) => r.canaryTarget === 15), 'cap=0 时全部回落 baseline');
  assert.strictEqual(used, 0);
}

// 3) 非科技标的：不参与科技额度累计
{
  const r = clampCanaryCandidate({ isTech: false, baselineTarget: 10, canaryTarget: 30, canaryEffective: true, techUsed: 20, effectiveTechMax: 30 });
  assert.strictEqual(r.clamped, false, '非科技不受 tech cap clamp');
  assert.strictEqual(r.canaryTarget, 30);
  assert.strictEqual(r.techUsed, 20, '非科技不增加科技占用');
}

// 4) canary 未生效 → 不改动、不占额度
{
  const r = clampCanaryCandidate({ isTech: true, baselineTarget: 15, canaryTarget: 25, canaryEffective: false, techUsed: 0, effectiveTechMax: 30 });
  assert.strictEqual(r.clamped, false);
  assert.strictEqual(r.techUsed, 0);
}

// 5) 降级 canary（target < baseline）不占额度
{
  const r = clampCanaryCandidate({ isTech: true, baselineTarget: 20, canaryTarget: 15, canaryEffective: true, techUsed: 5, effectiveTechMax: 30 });
  assert.strictEqual(r.techUsed, 5, '下行的 canary 不占用科技上行额度');
  assert.strictEqual(r.canaryTarget, 15);
}

// 6) 无上限（null）→ 不 clamp
{
  const r = clampCanaryCandidate({ isTech: true, baselineTarget: 15, canaryTarget: 40, canaryEffective: true, techUsed: 0, effectiveTechMax: null });
  assert.strictEqual(r.clamped, false);
  assert.strictEqual(r.canaryTarget, 40);
}

console.log('gen1 canary portfolio parity tests passed');
