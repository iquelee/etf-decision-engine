'use strict';

/**
 * WP-G1.2 G1.2-03：Canary 组合平价（复审 P0 修正版）。
 *
 * 复审问题：上一版 `canaryTechUsed` 从 0 起算、把 `effectiveTechMax` 当成
 * 「可用**新增**额度」，**没有把真实科技持仓算进去**。
 *  现实：科技实际仓位 60% + cap 65% → 真实空间只有 5%（对单只而言是它的目标上限 15%）。
 *
 * 现口径 = 与生产**同一个**算法：
 *   sectorUsed 种子 = portfolio.tech_position（组合总仓位），逐只累加；
 *   sectorRemainingLimit = max(0, cap - (sectorUsed - currentPosition))；
 *   占用增量 = sectorOccupation(current, suggested, target) —— 生产/Canary 共用。
 */
const assert = require('assert');
const { clampCanaryCandidate, sectorOccupation } = require('../src/common/utils/gen1-canary');

const TECH_MAX = 65;

/* ---- 1) ★ 核心：真实持仓 60% 时代，canary 增量空间被正确压缩 ---- */
{
  // 组合科技总仓 60；本只当前 10；其余 50；cap 65 → 本只目标最多 15
  const r = clampCanaryCandidate({
    isTech: true, baselineTarget: 15, canaryTarget: 25, canaryEffective: true,
    sectorUsed: 60, currentPosition: 10, effectiveTechMax: TECH_MAX
  });
  assert.strictEqual(r.sectorRemainingLimit, 15, 'cap 65 - 其他占用 50 = 15');
  assert.strictEqual(r.clamped, true, '★ 上一版会认为 +10 没问题，现在必须 clamp');
  assert.strictEqual(r.canaryTarget, 15, '只能回到 baseline 15（无额外空间）');
  assert.strictEqual(r.canaryDelta, 0, '真实净增量 0');
}

/* ---- 2) 真实持仓很低时才放行（对照组）---- */
{
  const r = clampCanaryCandidate({
    isTech: true, baselineTarget: 15, canaryTarget: 25, canaryEffective: true,
    sectorUsed: 15, currentPosition: 5, effectiveTechMax: TECH_MAX
  });
  assert.strictEqual(r.sectorRemainingLimit, 55, 'cap 65 - 其他 10 = 55');
  assert.strictEqual(r.clamped, false);
  assert.strictEqual(r.canaryTarget, 25);
}

/* ---- 3) 四只科技同日 canary 顺序累计：组合总仓不破 cap ---- */
{
  // 组合科技总仓 40 = 4 只 × 当前 10；baseline 与当前持平，只有 canary 想加仓
  let sectorUsed = 40;
  const cur = 10;
  const out = [];
  for (const code of ['A', 'B', 'C', 'D']) {
    const cl = clampCanaryCandidate({
      isTech: true, baselineTarget: 10, canaryTarget: 25, canaryEffective: true,
      sectorUsed, currentPosition: cur, effectiveTechMax: TECH_MAX
    });
    out.push({ code, ...cl });
    // 与 runDecisionEngine 相同的累计方式：占用 = 建议仓 - 当前（无 suggested → 用 target）
    sectorUsed += sectorOccupation(cur, cl.canaryTarget, cl.canaryTarget);
  }
  assert.strictEqual(out[0].sectorRemainingLimit, 35, 'A: cap 65 - 其他 30');
  assert.strictEqual(out[1].sectorRemainingLimit, 20, 'B: cap 65 - 其他 45');
  assert.strictEqual(out[2].sectorRemainingLimit, 10, 'C: cap 65 - 其他 55');
  assert.strictEqual(out[0].clamped, false, 'A 放行 25');
  assert.strictEqual(out[0].canaryTarget, 25);
  assert.strictEqual(out[1].clamped, true, 'B 必须被 clamp 到 20');
  assert.strictEqual(out[1].canaryTarget, 20);
  assert.strictEqual(out[2].clamped, true, 'C 空间已尽 → 回落 baseline');
  assert.strictEqual(out[2].canaryTarget, 10, '不得被压到 baseline 之下');
  assert.strictEqual(out[3].canaryTarget, 10);
  assert.strictEqual(sectorUsed, TECH_MAX, '最终组合总仓恰好 65，不越界');
}

/* ---- 4) cap 已满 → 全部回落 baseline，组合不越界 ---- */
{
  let sectorUsed = TECH_MAX;                  // 组合已顶满
  const cur = 15;                             // 当前 = baseline，无新增需求
  const out = [];
  for (const code of ['A', 'B', 'C']) {
    const cl = clampCanaryCandidate({
      isTech: true, baselineTarget: 15, canaryTarget: 25, canaryEffective: true,
      sectorUsed, currentPosition: cur, effectiveTechMax: TECH_MAX
    });
    out.push(cl);
    sectorUsed += sectorOccupation(cur, cl.canaryTarget, cl.canaryTarget);
  }
  assert.ok(out.every((r) => r.canaryTarget === 15), 'cap 已满 → 全部回落 baseline');
  assert.ok(out.every((r) => r.clamped === true));
  assert.strictEqual(sectorUsed, TECH_MAX, '组合总仓保持 65，不越界');
}

/* ---- 5) 非科技标的：不参与科技额度 clamp ---- */
{
  const r = clampCanaryCandidate({
    isTech: false, baselineTarget: 10, canaryTarget: 30, canaryEffective: true,
    sectorUsed: 20, currentPosition: 5, effectiveTechMax: 30
  });
  assert.strictEqual(r.clamped, false);
  assert.strictEqual(r.canaryTarget, 30);
}

/* ---- 6) canary 未生效 → 不改动 ---- */
{
  const r = clampCanaryCandidate({
    isTech: true, baselineTarget: 15, canaryTarget: 25, canaryEffective: false,
    sectorUsed: 0, currentPosition: 0, effectiveTechMax: 30
  });
  assert.strictEqual(r.clamped, false);
  assert.strictEqual(r.canaryTarget, 25);
}

/* ---- 7) 无上限（null）→ 不 clamp（注意 Number(null)===0 的坑）---- */
{
  const r = clampCanaryCandidate({
    isTech: true, baselineTarget: 15, canaryTarget: 40, canaryEffective: true,
    sectorUsed: 0, currentPosition: 0, effectiveTechMax: null
  });
  assert.strictEqual(r.sectorRemainingLimit, null);
  assert.strictEqual(r.clamped, false);
  assert.strictEqual(r.canaryTarget, 40);
}

/* ---- 8) sectorOccupation 与生产公式逐位一致（生产/Canary 唯一算法）---- */
{
  const productionFormula = (current, suggested, finalTarget) => {
    const occupyTarget = suggested != null
      ? Math.min(suggested, finalTarget != null ? finalTarget : suggested)
      : (finalTarget || 0);
    return Math.max(0, occupyTarget - current);
  };
  const cases = [
    [0, 25, 25], [10, 25, 25], [10, 25, 15], [10, null, 15], [10, null, null],
    [10, 5, 25], [25, 25, 25], [10, 0, 0], [0, null, 0], [10, 30, null]
  ];
  for (const [cur, sug, fin] of cases) {
    assert.strictEqual(sectorOccupation(cur, sug, fin), productionFormula(cur, sug, fin),
      `occupation(${cur},${sug},${fin}) 必须与生产公式一致`);
  }
}

console.log('gen1 canary portfolio parity tests passed');
