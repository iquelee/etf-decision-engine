/**
 * 数据迁移脚本：仓位引擎 V2.0.1 —— portfolio_position 三档目标 + 核心/交易仓
 *
 * 用法：
 *   TCB_ENV=<你的环境ID> node migrate-position-engine.js
 *   （或） node migrate-position-engine.js <你的环境ID>
 *
 * 迁移规则（幂等，可重复执行）：
 *   - 旧 target_position → target_std（已存在 target_std 则保留）
 *   - 旧 max_position → target_max + max_strategic_position
 *   - target_min = target_std - 5（若该 ETF 未显式提供三档初值）
 *   - core_position = current_position × 0.7；trade_position = current − core
 *   - core_ratio_grade 默认 'B'
 *   - 保留旧 target_position / max_position 字段（兼容），仅新增新字段，不删除
 */

'use strict';

const path = require('path');
const cloudbase = require('@cloudbase/node-sdk');

const { COLLECTIONS } = require(path.join(__dirname, '..', 'cloudfunctions', 'common', 'constants.js'));
const dbUtil = require(path.join(__dirname, '..', 'cloudfunctions', 'common', 'utils', 'db.js'));

const envId = process.env.TCB_ENV || process.argv[2] || null;
if (!envId) {
  console.error('❌ 缺少环境 ID。用法：TCB_ENV=<envId> node migrate-position-engine.js 或 node migrate-position-engine.js <envId>');
  process.exit(1);
}

/** 5 只 ETF 三档目标初值（用户已确认，兜底用） */
const DEFAULTS = {
  '513310': { target_min: 20, target_std: 25, target_max: 30, max_strategic_position: 30 },
  '515880': { target_min: 15, target_std: 20, target_max: 30, max_strategic_position: 30 },
  '159582': { target_min: 15, target_std: 20, target_max: 30, max_strategic_position: 30 },
  '518880': { target_min: 25, target_std: 30, target_max: 30, max_strategic_position: 30 },
  '159570': { target_min: 5, target_std: 10, target_max: 20, max_strategic_position: 20 }
};

const round1 = (n) => Math.round((n || 0) * 10) / 10;

async function main() {
  console.log(`\n=== ETF 决策系统：仓位引擎 V2.0.1 数据迁移（envId=${envId}）===\n`);
  cloudbase.init({ env: envId });

  const rows = await dbUtil.query(COLLECTIONS.PORTFOLIO_POSITION, {}, {}, envId);
  console.log(`  读到 portfolio_position ${rows.length} 条\n`);

  for (const doc of rows) {
    const def = DEFAULTS[doc.code] || {};
    const targetStd = doc.target_std != null ? doc.target_std
      : (doc.target_position != null ? doc.target_position : (def.target_std || 20));
    const targetMax = doc.target_max != null ? doc.target_max
      : (doc.max_position != null ? doc.max_position : (def.target_max || 30));
    const maxStrategic = doc.max_strategic_position != null ? doc.max_strategic_position
      : (doc.max_position != null ? doc.max_position : (def.max_strategic_position || 30));
    const targetMin = doc.target_min != null ? doc.target_min
      : (def.target_min != null ? def.target_min : round1(targetStd - 5));

    const current = doc.current_position || 0;
    const core = doc.core_position != null ? doc.core_position : round1(current * 0.7);
    const trade = doc.trade_position != null ? doc.trade_position : round1(current - core);
    const grade = doc.core_ratio_grade || 'B';

    const updateData = {
      target_min: targetMin,
      target_std: targetStd,
      target_max: targetMax,
      max_strategic_position: maxStrategic,
      core_position: core,
      trade_position: trade,
      core_ratio_grade: grade,
      updated_at: new Date()
    };

    await dbUtil.updateById(COLLECTIONS.PORTFOLIO_POSITION, doc._id, updateData, envId);
    console.log(`  ✅ ${doc.code}：min ${targetMin} / std ${targetStd} / max ${targetMax} / 战略 ${maxStrategic}｜核心 ${core} / 交易 ${trade}（${grade}）`);
  }

  console.log('\n⚠️  说明：');
  console.log('  1. 旧 target_position / max_position 字段保留未删除（兼容）；');
  console.log('  2. core_position 按 current×0.7 初值，后续由 runDecisionEngine 慢变量重算回写；');
  console.log('  3. 本脚本幂等，可重复执行。');
  console.log('\n✅ 迁移完成。');
}

main().catch((e) => {
  console.error('❌ 迁移失败：', e);
  process.exit(1);
});
