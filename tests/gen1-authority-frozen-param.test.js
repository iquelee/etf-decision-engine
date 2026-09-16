'use strict';

/**
 * WP-G1-GE-02：`gen1_authority` 入冻结清单（P0）静态守卫。
 *
 * 背景：引入 `GUARDED_EFFECTIVE` 后，若仍能从普通 ParamConfig 后台改 `gen1_authority`，
 * 则「改一条配置即可取得向 V3 提议受控输入的资格」——不可接受的旁路。
 *
 * 本测试把「冻结 + 唯一写入路径」变成「改回去就红」的回归门。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { FROZEN_PARAM_KEYS } = require(path.join(REPO, 'src/common/constants.js'));
const ADMIN = fs.readFileSync(path.join(REPO, 'cloudfunctions/adminGateway/index.js'), 'utf8');

/* ---- 1) gen1_authority 必须在冻结清单内 ---- */
{
  assert.ok(FROZEN_PARAM_KEYS.indexOf('gen1_authority') >= 0,
    '★ gen1_authority 必须纳入 FROZEN_PARAM_KEYS（否则新档位下即为 P0 旁路）');
}

/* ---- 2) 既有冻结项不得被顺手移除 ---- */
{
  const mustStillFrozen = [
    'volume_ratio_mild', 'tech_sector_max', 'ml_fast_path_enabled',
    'ml_challenger_model_id', 'ml_gen1_frozen', 'ml_shadow_bundle_id'
  ];
  for (const k of mustStillFrozen) {
    assert.ok(FROZEN_PARAM_KEYS.indexOf(k) >= 0, `既有冻结项 ${k} 不得被移除`);
  }
  assert.strictEqual(FROZEN_PARAM_KEYS.length, 7, '冻结清单条目数应为 7（6 项既有 + gen1_authority）');
}

/* ---- 3) 后台写路径必须真的按 FROZEN_PARAM_KEYS 拦截（不是只声明） ---- */
{
  assert.ok(/FROZEN_PARAM_KEYS/.test(ADMIN), 'adminGateway 必须引用 FROZEN_PARAM_KEYS');
  assert.ok(/FROZEN_PARAM_KEYS\.indexOf\(key\) >= 0/.test(ADMIN),
    '★ 后台 updateParam 必须有 FROZEN_PARAM_KEYS.indexOf(key) >= 0 的拦截');
  assert.ok(/已冻结，禁止从后台改/.test(ADMIN), '★ 被冻结的 key 必须拒绝写入（403）');
  // 冻结清单只能来自 constants（不得在 adminGateway 内再维护一份副本）
  assert.ok(/require\('\.\/common\/constants'\)/.test(ADMIN) || /require\("\.\/common\/constants"\)/.test(ADMIN),
    'adminGateway 必须从 common/constants 取冻结清单（单一真相）');
}

/* ---- 4) 部署侧构建会把 constants.js 覆盖进每个函数（冻结清单真的生效） ---- */
{
  const build = fs.readFileSync(path.join(REPO, 'scripts/build-cloudfunctions.js'), 'utf8');
  assert.ok(/copyDir\(SRC_COMMON, path\.join\(out, 'common'\)\)/.test(build),
    '★ src/common（含 constants.js）必须被构建脚本复制进每个云函数');
}

/* ---- 5) 冻结不得成为死路：必须保留可审计的脚本化 promotion 通道 ---- */
{
  const candidates = ['scripts/promote-gen1-advisory.js', 'scripts/promote-ml-shadow-observe.js']
    .filter((f) => fs.existsSync(path.join(REPO, f)));
  assert.ok(candidates.length > 0, '必须保留脚本化 promotion 通道（冻结 ≠ 无法回退）');
  for (const f of candidates) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    assert.ok(/param_config/.test(src), `${f} 必须直接写 param_config（绕过被冻结的后台，属显式审批动作）`);
  }
}

console.log('gen1 authority frozen-param guards passed');
