'use strict';

/**
 * WP-G1.2 G1.2-03 + WP-G1.3 G1.3-01/04/05/06：反事实组合账本（G1-M，重写）。
 *
 * 复审 P0（最终轮）：上一版只有 `gen1_canary_effective === true` 的科技 ETF 才推进
 * canary 账本 → 「baseline 自身加仓但无 Gen-1」的科技 ETF 被漏记，后续 Candidate 拿到
 * 虚假剩余额度，组合可越过 tech cap。G1-M 原先只测「多个 Candidate 之间」，没有测
 * **混合 Candidate / Baseline-only** —— 而后者才是生产中最常见的情况。
 *
 * 本测试覆盖：
 *   1) 复审给出的 60%/65% 反例（真实持仓必须计入）
 *   2) ★ Baseline-only A + Canary B（复审场景，逐位复现）
 *   3) Baseline-only A/B + Canary C
 *   4) Canary A + Baseline-only B + Canary C
 *   5) 组合级不变量：canary 账本 / Σ 反事实目标 均 ≤ tech cap
 *   6) 旧行为反例：漏记 baseline 占用会越界（证明本测试确有鉴别力）
 *   7) sectorOccupation 与生产公式逐位一致
 */
const assert = require('assert');
const {
  sectorOccupation, counterfactualSectorRemaining, stepCounterfactualLedger
} = require('../src/common/utils/gen1-canary');

const TECH_MAX = 65;
const EPS = 1e-9;

/**
 * 模拟 runDecisionEngine 的科技 ETF 顺序处理（与运行时同构）。
 *
 * 账本种子 = 本批 ETF 的当前仓位之和 + 本批之外的科技持仓（`otherTechHoldings`）。
 * 注意：只有当 `otherTechHoldings === 0` 时才有 `Σ target === 账本终值`，
 * 因此「Σ 反事实目标 ≤ cap」只在该一致种子下断言；账本终值 ≤ cap 则恒成立。
 */
function runPortfolio(etfs, opts) {
  const o = opts || {};
  const currentSum = etfs.reduce((s, e) => s + (e.current || 0), 0);
  const other = o.otherTechHoldings || 0;
  const seed = currentSum + other;
  let used = seed;
  const rows = [];
  for (const e of etfs) {
    const step = stepCounterfactualLedger({
      isTech: e.isTech !== false,
      sectorUsed: used,
      currentPosition: e.current,
      effectiveTechMax: TECH_MAX,
      baselineTarget: e.baselineTarget,
      baselineSuggested: e.baselineSuggested != null ? e.baselineSuggested : e.baselineTarget,
      canaryEffective: e.canary === true,
      canaryTarget: e.canaryTarget,
      canarySuggested: e.canarySuggested != null ? e.canarySuggested : e.canaryTarget
    });
    rows.push(Object.assign({ code: e.code }, step));
    used = step.nextSectorUsed;
  }
  const targetSum = rows.reduce((s, r) => s + r.counterfactualTarget, 0);
  return {
    rows, seed, finalTechPosition: Math.round(used * 1e6) / 1e6,
    targetSum, consistentSeed: other === 0
  };
}

/**
 * 账本不变量（精确表述）：
 *   ① **恒成立**：账本终值 ≤ max(起始仓位, cap) —— 账本只会在 cap 之内「加」，绝不制造新的超额。
 *      （起始仓位本身已超 cap 时，账本既不会更低也不会更高，这是既有持仓的事实，不是本账本能修的。）
 *   ② 起始仓位 ≤ cap（正常情况）→ 账本终值 ≤ cap。
 *   ③ 一致种子（起始仓位 = Σ 本批当前仓位）→ Σ 反事实目标 ≤ cap。
 */
function assertLedgerBounded(out, label) {
  const bound = Math.max(out.seed, TECH_MAX);
  assert.ok(out.finalTechPosition <= bound + EPS,
    `${label}: 账本 ${out.finalTechPosition} 超过 max(seed ${out.seed}, cap ${TECH_MAX})`);
  if (out.seed <= TECH_MAX) {
    assert.ok(out.finalTechPosition <= TECH_MAX + EPS,
      `${label}: 起始仓位 ${out.seed} 未超 cap，账本 ${out.finalTechPosition} 不得越过 cap`);
  }
  if (out.consistentSeed && out.seed <= TECH_MAX) {
    assert.ok(out.targetSum <= TECH_MAX + EPS,
      `${label}: Σ 反事实目标 ${out.targetSum} 越过 cap ${TECH_MAX}`);
  }
}

/* ---- 1) 复审反例：真实持仓 60% / cap 65% ---- */
{
  const r = runPortfolio([{ code: 'A', current: 10, baselineTarget: 25, canary: false }], { otherTechHoldings: 50 });
  const a = r.rows[0];
  assert.strictEqual(a.sectorRemainingLimit, 15, 'cap 65 - 其他占用 50 = 15');
  assert.strictEqual(a.counterfactualTarget, 15, '★ baseline 目标 25 也必须被共享 cap 压到 15');
  assert.strictEqual(a.baselineFloorBreached, true, '共享 cap 优先 → 允许低于 baseline');
  assert.ok(r.finalTechPosition <= TECH_MAX + EPS, '账本不得越界');
}

/* ---- 2) ★ 复审场景：Baseline-only A + Canary B（逐位复现） ---- */
{
  // A：无 Gen-1，baseline 建议加仓 10→25；B：Gen-1 Candidate，想加 10→25
  const r = runPortfolio([
    { code: 'A', current: 10, baselineTarget: 25, canary: false },
    { code: 'B', current: 10, baselineTarget: 15, canary: true, canaryTarget: 25 }
  ], { otherTechHoldings: 20 });   // 40 = A/B 当前 20 + 其它科技 20

  const [a, b] = r.rows;
  // A：正常推进 → 40 → 55
  assert.strictEqual(a.sectorRemainingLimit, 35, 'A: cap 65 - 其他 30');
  assert.strictEqual(a.clamped, false);
  assert.strictEqual(a.nextSectorUsed, 55, '★ A 虽是 Baseline-only，也必须推进 canary 账本 40 → 55');
  // B：上限必须被 A 的占用压缩到 20（而不是旧实现的 35）
  assert.strictEqual(b.sectorRemainingLimit, 20, '★ B 上限 = 65 - (55 - 10) = 20（旧实现会算成 35）');
  assert.strictEqual(b.counterfactualTarget, 20, '★ B 被压到 20，而非完整放行 25');
  assert.strictEqual(b.clamped, true);
  assert.strictEqual(r.finalTechPosition, TECH_MAX, '最终恰好 65，不越界');
  assert.ok(r.targetSum <= TECH_MAX + EPS, `Σ 反事实目标 ${r.targetSum} 必须 <= cap 65`);
}

/* ---- 3) Baseline-only A/B + Canary C ---- */
{
  const r = runPortfolio([
    { code: 'A', current: 10, baselineTarget: 25, canary: false },
    { code: 'B', current: 10, baselineTarget: 25, canary: false },
    { code: 'C', current: 10, baselineTarget: 15, canary: true, canaryTarget: 25 }
  ], { otherTechHoldings: 10 });   // 40 = 3x10 当前 + 其它 10
  assert.strictEqual(r.rows[1].nextSectorUsed, 65, 'A、B 各推进 15 → 40 → 55 → 65');
  assert.strictEqual(r.rows[2].sectorRemainingLimit, 10, '★ C 上限 = 65 - (65 - 10) = 10');
  assert.strictEqual(r.rows[2].counterfactualTarget, 10, '★ C 被压到 10（低于 baseline 15）');
  assert.strictEqual(r.rows[2].baselineFloorBreached, true);
  assertLedgerBounded(r, 'case3');
}

/* ---- 4) Canary A + Baseline-only B + Canary C ---- */
{
  const r = runPortfolio([
    { code: 'A', current: 10, baselineTarget: 15, canary: true, canaryTarget: 25 },
    { code: 'B', current: 10, baselineTarget: 25, canary: false },
    { code: 'C', current: 10, baselineTarget: 15, canary: true, canaryTarget: 25 }
  ], { otherTechHoldings: 10 });   // 40 = 3x10 当前 + 其它 10
  const [a, b, c] = r.rows;
  assert.strictEqual(a.sectorRemainingLimit, 35, 'A: 65 - 30');
  assert.strictEqual(a.nextSectorUsed, 55, 'A 加 15');
  assert.strictEqual(b.sectorRemainingLimit, 20, 'B: 65 - (55 - 10)');
  assert.strictEqual(b.counterfactualTarget, 20, '★ Baseline-only 的 B 同样被 cap 压缩');
  assert.strictEqual(b.nextSectorUsed, 65);
  assert.strictEqual(c.sectorRemainingLimit, 10, 'C: 65 - (65 - 10)');
  assert.strictEqual(c.counterfactualTarget, 10, '★ Canary C 被压到 10');
  assert.strictEqual(c.canaryEffective, true, 'C 仍是 Gen-1 Candidate（stage 变更），只是目标受组合约束');
  assert.strictEqual(r.finalTechPosition, TECH_MAX);
  assert.ok(r.targetSum <= TECH_MAX + EPS, `Σ=${r.targetSum}`);
}

/* ---- 5) 随机压力：任意混合序列都不得越界（cap 优先不变量） ---- */
{
  let seed = 20260910;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let iter = 0; iter < 400; iter += 1) {
    const n = 3 + Math.floor(rnd() * 4);
    const etfs = [];
    for (let i = 0; i < n; i += 1) {
      const current = Math.floor(rnd() * 11);
      const baselineTarget = current + Math.floor(rnd() * 25);
      etfs.push({
        code: 'E' + i, current, baselineTarget,
        canary: rnd() > 0.5,
        canaryTarget: baselineTarget + Math.floor(rnd() * 25)
      });
    }
    const other = rnd() > 0.5 ? Math.floor(rnd() * 6) : 0;
    const out = runPortfolio(etfs, { otherTechHoldings: other });
    assert.ok(out.seed <= TECH_MAX, `stress#${iter} 生成器应保证起始仓位合规（seed=${out.seed}）`);
    assertLedgerBounded(out, `stress#${iter}`);
  }
}

/* ---- 5b) 起始仓位本身已超 cap：账本不得再增，也不得伪造下降 ---- */
{
  const out = runPortfolio([{ code: 'A', current: 30, baselineTarget: 40, canary: false }], { otherTechHoldings: 40 });
  assert.ok(out.seed > TECH_MAX, '构造：起始仓位 70 > cap 65');
  assert.ok(out.finalTechPosition <= out.seed + EPS, '起始已超 cap 时账本不得再增');
  assert.strictEqual(out.rows[0].counterfactualTarget, 25, '目标被压到本只上限 25');
  assert.strictEqual(out.rows[0].counterfactualOccupation, 0, '已超 cap → 无新增占用');
}

/* ---- 6) 旧行为反例（鉴别力证明）：漏记非 Candidate → 越界 ---- */
{
  const etfs = [
    { code: 'A', current: 10, baselineTarget: 25, canary: false },
    { code: 'B', current: 10, baselineTarget: 15, canary: true, canaryTarget: 25 },
    { code: 'C', current: 20, baselineTarget: 25, canary: false }
  ];
  // 模拟旧实现：只有 canaryEffective 的 ETF 才推进账本（且 clamp 保留 baseline 地板）
  let legacyUsed = 40;
  const legacyTargets = [];
  for (const e of etfs) {
    const limit = Math.max(0, TECH_MAX - (legacyUsed - e.current));
    const intended = e.canary ? e.canaryTarget : e.baselineTarget;
    const target = Math.min(intended, Math.max(e.baselineTarget, limit));
    legacyTargets.push(target);
    if (e.canary) legacyUsed += sectorOccupation(e.current, e.canaryTarget, target);
  }
  const legacySum = legacyTargets.reduce((s, v) => s + v, 0);
  assert.ok(legacySum > TECH_MAX, `旧实现 Σ=${legacySum} 应越界（这正是被修的 P0）`);

  const fixed = runPortfolio(etfs, { otherTechHoldings: 0 });
  assert.ok(fixed.targetSum <= TECH_MAX + EPS, `修复后 Σ=${fixed.targetSum} 不得越界`);
  assertLedgerBounded(fixed, 'legacy-compare');
}

/* ---- 7) 非科技标的：不参与科技额度 ---- */
{
  const s = stepCounterfactualLedger({
    isTech: false, sectorUsed: 20, currentPosition: 5, effectiveTechMax: 30,
    baselineTarget: 10, canaryEffective: true, canaryTarget: 30
  });
  assert.strictEqual(s.sectorRemainingLimit, null, '非科技不受 tech cap 约束');
  assert.strictEqual(s.counterfactualTarget, 30);
  assert.strictEqual(s.nextSectorUsed, 20, '非科技不推进科技账本');
}

/* ---- 8) 无上限（null）→ 不 clamp（Number(null)===0 的坑） ---- */
{
  const s = stepCounterfactualLedger({
    isTech: true, sectorUsed: 0, currentPosition: 0, effectiveTechMax: null,
    baselineTarget: 15, canaryEffective: true, canaryTarget: 40
  });
  assert.strictEqual(s.sectorRemainingLimit, null);
  assert.strictEqual(s.clamped, false);
  assert.strictEqual(s.counterfactualTarget, 40);
}

/* ---- 9) counterfactualSectorRemaining 与生产公式同式 ---- */
{
  assert.strictEqual(counterfactualSectorRemaining({ isTech: true, sectorUsed: 60, currentPosition: 10, effectiveTechMax: 65 }), 15);
  assert.strictEqual(counterfactualSectorRemaining({ isTech: true, sectorUsed: 40, currentPosition: 10, effectiveTechMax: 65 }), 35);
  assert.strictEqual(counterfactualSectorRemaining({ isTech: true, sectorUsed: 65, currentPosition: 10, effectiveTechMax: 65 }), 10);
  assert.strictEqual(counterfactualSectorRemaining({ isTech: true, sectorUsed: 80, currentPosition: 10, effectiveTechMax: 65 }), 0, '不得为负');
  assert.strictEqual(counterfactualSectorRemaining({ isTech: false, sectorUsed: 0, currentPosition: 0, effectiveTechMax: 65 }), null);
}

/* ---- 10) sectorOccupation 与生产公式逐位一致（唯一占用算法） ---- */
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

console.log('gen1 counterfactual portfolio ledger tests passed');
