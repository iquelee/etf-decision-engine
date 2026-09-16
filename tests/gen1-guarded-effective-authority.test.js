'use strict';

/**
 * WP-G1-GE-02：Authority 新档位 `GUARDED_EFFECTIVE` 单测。
 *
 * 覆盖：
 *   1. 阶梯 = 在既有状态机上**插入**（不推翻重做）：OFF<SHADOW<ADVISORY<CANARY<GUARDED_EFFECTIVE
 *   2. `GUARDED_EFFECTIVE` ≠ 生产写权限（production_write / auto_execution 全档恒 false）
 *   3. `PRODUCTION` 继续不可达（请求即降级，且不授予任何能力）
 *   4. `GUARDED_EFFECTIVE` 只等于「有权提议」——不等于「会被采纳」
 */
const assert = require('assert');
const {
  AUTHORITY, AUTHORITY_RANK, AUTHORITY_LADDER, AUTHORITY_LABEL,
  PRODUCTION_LOCKED, DEFAULT_AUTHORITY,
  resolveAuthority, authorityAllows, rankOf
} = require('../src/common/utils/gen1-authority');

const ALL_TIERS = Object.values(AUTHORITY);
const BASE = { ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true };

/* ---- 1) 阶梯为「插入」，不是「推翻重做」 ---- */
{
  assert.deepStrictEqual(AUTHORITY_LADDER, [
    'OFF', 'SHADOW', 'ADVISORY', 'CANARY', 'GUARDED_EFFECTIVE', 'PRODUCTION'
  ], '★ 阶梯必须在 CANARY 与 PRODUCTION 之间插入 GUARDED_EFFECTIVE');
  // 前四档 rank 不得漂移（既有语义不变）
  assert.strictEqual(AUTHORITY_RANK.OFF, 0);
  assert.strictEqual(AUTHORITY_RANK.SHADOW, 1);
  assert.strictEqual(AUTHORITY_RANK.ADVISORY, 2);
  assert.strictEqual(AUTHORITY_RANK.CANARY, 3);
  assert.strictEqual(AUTHORITY_RANK.GUARDED_EFFECTIVE, 4);
  assert.strictEqual(AUTHORITY_RANK.PRODUCTION, 5, 'PRODUCTION 顺延为最高档但仍不可达');
  // rank 严格单调
  for (let i = 1; i < AUTHORITY_LADDER.length; i += 1) {
    assert.ok(rankOf(AUTHORITY_LADDER[i]) > rankOf(AUTHORITY_LADDER[i - 1]),
      `rank 必须严格单调：${AUTHORITY_LADDER[i - 1]} < ${AUTHORITY_LADDER[i]}`);
  }
  assert.strictEqual(typeof AUTHORITY_LABEL.GUARDED_EFFECTIVE, 'string');
  assert.strictEqual(PRODUCTION_LOCKED, true);
  assert.strictEqual(DEFAULT_AUTHORITY, AUTHORITY.ADVISORY, '默认档位不得因新增档位而改变');
}

/* ---- 2) 硬边界：全档 production_write / auto_execution 恒 false ---- */
{
  for (const tier of ALL_TIERS) {
    const r = resolveAuthority(Object.assign({}, BASE, { gen1_authority: tier }));
    assert.strictEqual(r.production_write, false, `${tier} 下 production_write 必须恒 false`);
    assert.strictEqual(r.auto_execution, false, `${tier} 下 auto_execution 必须恒 false`);
    assert.strictEqual(r.production_blocked, true);
    assert.strictEqual(authorityAllows(tier, 'PRODUCTION_WRITE'), false,
      `★ ${tier} 不得授予 PRODUCTION_WRITE`);
  }
}

/* ---- 3) PRODUCTION 继续不可达 ---- */
{
  const r = resolveAuthority(Object.assign({}, BASE, { gen1_authority: 'PRODUCTION' }));
  assert.strictEqual(r.gen1_authority, AUTHORITY.ADVISORY, 'PRODUCTION 请求必须降级 ADVISORY');
  assert.strictEqual(r.downgraded, true);
  assert.strictEqual(r.guarded_effective_authorized, false,
    '★ 降级后不得残留任何 GUARDED_EFFECTIVE 资格');
  // 即使绕过 resolveAuthority 直接查询，PRODUCTION 也不得授予任何能力（防御性加固）
  for (const cap of ['SHADOW_OBSERVE', 'ADVISORY', 'CANARY_OVERRIDE',
    'GUARDED_EFFECTIVE_OVERRIDE', 'PRODUCTION_WRITE']) {
    assert.strictEqual(authorityAllows('PRODUCTION', cap), false,
      `★ PRODUCTION 不得授予 ${cap}`);
  }
}

/* ---- 4) GUARDED_EFFECTIVE 能力边界 ---- */
{
  // 只有 GUARDED_EFFECTIVE 及以上可提议受控阶段输入
  assert.strictEqual(authorityAllows('OFF', 'GUARDED_EFFECTIVE_OVERRIDE'), false);
  assert.strictEqual(authorityAllows('SHADOW', 'GUARDED_EFFECTIVE_OVERRIDE'), false);
  assert.strictEqual(authorityAllows('ADVISORY', 'GUARDED_EFFECTIVE_OVERRIDE'), false);
  assert.strictEqual(authorityAllows('CANARY', 'GUARDED_EFFECTIVE_OVERRIDE'), false,
    '★ CANARY **不**等于 GUARDED_EFFECTIVE（两者是不同档位）');
  assert.strictEqual(authorityAllows('GUARDED_EFFECTIVE', 'GUARDED_EFFECTIVE_OVERRIDE'), true);
  // 新增档位不得破坏既有能力
  assert.strictEqual(authorityAllows('GUARDED_EFFECTIVE', 'CANARY_OVERRIDE'), true);
  assert.strictEqual(authorityAllows('CANARY', 'CANARY_OVERRIDE'), true);
  assert.strictEqual(authorityAllows('ADVISORY', 'CANARY_OVERRIDE'), false);
  assert.strictEqual(authorityAllows('GUARDED_EFFECTIVE', 'UNKNOWN_CAP'), false);
}

/* ---- 5) 显式授予 GUARDED_EFFECTIVE：只拿到「资格」，不拿到生产权限 ---- */
{
  const r = resolveAuthority(Object.assign({}, BASE, { gen1_authority: 'GUARDED_EFFECTIVE' }));
  assert.strictEqual(r.gen1_authority, AUTHORITY.GUARDED_EFFECTIVE);
  assert.strictEqual(r.guarded_effective_authorized, true, 'Key 1 成立');
  assert.strictEqual(r.production_write, false, '★ 仍无生产写权限');
  assert.strictEqual(r.auto_execution, false, '★ 仍无自动执行权限');
  assert.strictEqual(r.downgraded, false);
}

/* ---- 6) 低档位不得获得 GUARDED_EFFECTIVE 资格 ---- */
{
  for (const tier of ['OFF', 'SHADOW', 'ADVISORY', 'CANARY']) {
    const r = resolveAuthority(Object.assign({}, BASE, { gen1_authority: tier }));
    assert.strictEqual(r.guarded_effective_authorized, false, `${tier} 不得取得 GUARDED_EFFECTIVE 资格`);
  }
}

/* ---- 7) 既有降级规则对新档位同样生效（插入不破坏上游总闸） ---- */
{
  const off = resolveAuthority(Object.assign({}, BASE, {
    ml_shadow_observe: false, gen1_authority: 'GUARDED_EFFECTIVE'
  }));
  assert.strictEqual(off.gen1_authority, AUTHORITY.OFF, '观察总闸关闭 → OFF');
  assert.strictEqual(off.guarded_effective_authorized, false);

  const shadow = resolveAuthority(Object.assign({}, BASE, {
    ml_advisory_enabled: false, gen1_authority: 'GUARDED_EFFECTIVE'
  }));
  assert.strictEqual(shadow.gen1_authority, AUTHORITY.SHADOW, 'advisory 总闸关闭 → 最高 SHADOW');
  assert.strictEqual(shadow.guarded_effective_authorized, false);

  const rogue = resolveAuthority(Object.assign({}, BASE, { gen1_authority: 'ROOT' }));
  assert.strictEqual(rogue.gen1_authority, AUTHORITY.ADVISORY, '未知取值 fail-closed');
  assert.strictEqual(rogue.guarded_effective_authorized, false);
}

console.log('gen1 guarded effective authority tests passed');
