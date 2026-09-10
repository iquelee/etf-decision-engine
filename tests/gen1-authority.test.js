'use strict';

/**
 * G1-01 Gen-1 Authority 状态机单测。
 * 覆盖：默认 ADVISORY / PRODUCTION 永久锁定 / 观察总闸 OFF / advisory 闸降级 /
 *       未知取值 fail-closed / production_write & auto_execution 恒 false / 能力查询。
 */
const assert = require('assert');
const {
  AUTHORITY,
  resolveAuthority,
  authorityAllows,
  authorityForApi,
  rankOf
} = require('../src/common/utils/gen1-authority');

// 1) 默认状态 = ADVISORY；production_write / auto_execution 恒 false
{
  const r = resolveAuthority({ ml_shadow_observe: true });
  assert.strictEqual(r.gen1_authority, AUTHORITY.ADVISORY, 'default authority must be ADVISORY');
  assert.strictEqual(r.production_write, false);
  assert.strictEqual(r.auto_execution, false);
  assert.strictEqual(r.production_blocked, true);
}

// 2) PRODUCTION 永久锁定 → 降级 ADVISORY
{
  const r = resolveAuthority({ ml_shadow_observe: true, gen1_authority: 'PRODUCTION' });
  assert.strictEqual(r.gen1_authority, AUTHORITY.ADVISORY, 'PRODUCTION must be downgraded');
  assert.strictEqual(r.downgraded, true);
  assert.strictEqual(r.production_write, false);
}

// 3) 观察闸关闭 → OFF
{
  const r = resolveAuthority({ ml_shadow_observe: false, gen1_authority: 'CANARY' });
  assert.strictEqual(r.gen1_authority, AUTHORITY.OFF);
}

// 4) advisory 闸关闭 → 最高只能 SHADOW
{
  const r = resolveAuthority({ ml_shadow_observe: true, ml_advisory_enabled: false, gen1_authority: 'CANARY' });
  assert.strictEqual(r.gen1_authority, AUTHORITY.SHADOW);
}

// 5) 未知取值 fail-closed → ADVISORY（绝不放行到更高权限）
{
  const r = resolveAuthority({ ml_shadow_observe: true, gen1_authority: 'ROOT' });
  assert.strictEqual(r.gen1_authority, AUTHORITY.ADVISORY);
  assert.strictEqual(r.requested, 'ROOT');
}

// 6) 显式合法值被尊重（CANARY 允许，但写入仍关闭）
{
  const r = resolveAuthority({ ml_shadow_observe: true, gen1_authority: 'CANARY' });
  assert.strictEqual(r.gen1_authority, AUTHORITY.CANARY);
  assert.strictEqual(r.production_write, false);
  assert.strictEqual(r.auto_execution, false);
}

// 7) 能力查询
{
  assert.strictEqual(authorityAllows('ADVISORY', 'SHADOW_OBSERVE'), true);
  assert.strictEqual(authorityAllows('SHADOW', 'ADVISORY'), false);
  assert.strictEqual(authorityAllows('ADVISORY', 'CANARY_OVERRIDE'), false);
  assert.strictEqual(authorityAllows('CANARY', 'CANARY_OVERRIDE'), true);
  assert.strictEqual(authorityAllows('OFF', 'SHADOW_OBSERVE'), false);
  // 无论何种状态，PRODUCTION_WRITE 永远 false
  for (const a of ['OFF', 'SHADOW', 'ADVISORY', 'CANARY', 'PRODUCTION', 'garbage']) {
    assert.strictEqual(authorityAllows(a, 'PRODUCTION_WRITE'), false, `${a} must never allow PRODUCTION_WRITE`);
  }
  assert.strictEqual(authorityAllows('ADVISORY', 'UNKNOWN_CAP'), false);
}

// 8) rank 单调 + 非法 rank = -1
{
  assert.ok(rankOf('PRODUCTION') > rankOf('CANARY'));
  assert.ok(rankOf('CANARY') > rankOf('ADVISORY'));
  assert.ok(rankOf('ADVISORY') > rankOf('SHADOW'));
  assert.ok(rankOf('SHADOW') > rankOf('OFF'));
  assert.strictEqual(rankOf('bogus'), -1);
}

// 9) API 片段恒不含生产写权限
{
  const api = authorityForApi({ ml_shadow_observe: true, ml_fast_path_enabled: true });
  assert.strictEqual(api.production_write, false);
  assert.strictEqual(api.auto_execution, false);
  assert.strictEqual(api.gen1_authority, AUTHORITY.ADVISORY);
  // config 层 fast_path = true 不得被解读为「已获生产权限」
  const r = resolveAuthority({ ml_shadow_observe: true, ml_fast_path_enabled: true });
  assert.strictEqual(r.config_fast_path_enabled, true);
  assert.strictEqual(r.production_write, false);
}

console.log('gen1 authority tests passed');
