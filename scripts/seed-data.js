/**
 * 种子数据初始化脚本：etf_basic / param_config / fundamental_config / portfolio_position
 *
 * 用法：
 *   TCB_ENV=<你的环境ID> node seed-data.js
 *   （或） node seed-data.js <你的环境ID>
 *
 * 说明（业务参数已确认/待确认）：
 * - 科技赛道上限 = 65%（用户已确认，覆盖线框图的 60%）
 * - 5 只 ETF 仓位初值（target/max）：用户选「自定义」但暂未提供，
 *   先用默认值占位：513310=25/30、515880=20/30、159582=20/30、518880=30/30、159570=10/20。
 *   ★ 仓位初值待用户最终确认，可在后台「参数配置」/「组合仓位」修改。
 * - is_qdii：513310「华泰柏瑞中证韩交所中韩半导体ETF(QDII)」为跨境 QDII 基金，设 true；
 *   其余 4 只 false（515880/159582 纯 A 股、518880 境内黄金、159570 港股通非 QDII 通道）。
 */

'use strict';

const path = require('path');
const cloudbase = require('@cloudbase/node-sdk');

const { COLLECTIONS } = require(path.join(__dirname, '..', 'cloudfunctions', 'common', 'constants.js'));
const dbUtil = require(path.join(__dirname, '..', 'cloudfunctions', 'common', 'utils', 'db.js'));
const { FUNDAMENTAL_TEMPLATES, RETIRED_INDICATORS } = require(path.join(__dirname, '..', 'cloudfunctions', 'common', 'utils', 'fundamental.js'));

const envId = process.env.TCB_ENV || process.argv[2] || null;
if (!envId) {
  console.error('❌ 缺少环境 ID。用法：TCB_ENV=<envId> node seed-data.js 或 node seed-data.js <envId>');
  process.exit(1);
}

const now = new Date();

/** 5 只 ETF 基础信息 + 仓位初值 */
const ETF_SEED = [
  {
    code: '513310', name: '中韩半导体ETF(QDII)', sector: 'storage', is_qdii: true,
    max_position: 30, target_position: 25, status: 'enable', sort_order: 1
  },
  {
    code: '515880', name: '通信ETF', sector: 'ai_network', is_qdii: false,
    max_position: 30, target_position: 20, status: 'enable', sort_order: 2
  },
  {
    code: '159582', name: '半导体设备ETF', sector: 'semi_equip', is_qdii: false,
    max_position: 30, target_position: 20, status: 'enable', sort_order: 3
  },
  {
    code: '518880', name: '黄金ETF', sector: 'gold', is_qdii: false,
    max_position: 30, target_position: 30, status: 'enable', sort_order: 4
  },
  {
    code: '159570', name: '港股通创新药ETF', sector: 'biotech', is_qdii: false,
    max_position: 20, target_position: 10, status: 'enable', sort_order: 5
  }
];

/** 仓位初值（current 暂设 0，待用户确认实际持仓）
 *  V2.0.1 三档目标：target_min / target_std / target_max / max_strategic_position
 *  迁移规则：旧 target_position→target_std、旧 max_position→target_max 且 max_strategic_position=旧 max_position、target_min=target_std−5 */
const POSITION_SEED = [
  { code: '513310', current_position: 0, target_position: 25, max_position: 30, target_min: 20, target_std: 25, target_max: 30, max_strategic_position: 30, core_position: 0, trade_position: 0, core_ratio_grade: 'B', avg_cost: null, updated_at: now },
  { code: '515880', current_position: 0, target_position: 20, max_position: 30, target_min: 15, target_std: 20, target_max: 30, max_strategic_position: 30, core_position: 0, trade_position: 0, core_ratio_grade: 'B', avg_cost: null, updated_at: now },
  { code: '159582', current_position: 0, target_position: 20, max_position: 30, target_min: 15, target_std: 20, target_max: 30, max_strategic_position: 30, core_position: 0, trade_position: 0, core_ratio_grade: 'B', avg_cost: null, updated_at: now },
  { code: '518880', current_position: 0, target_position: 30, max_position: 30, target_min: 25, target_std: 30, target_max: 30, max_strategic_position: 30, core_position: 0, trade_position: 0, core_ratio_grade: 'B', avg_cost: null, updated_at: now },
  { code: '159570', current_position: 0, target_position: 10, max_position: 20, target_min: 5, target_std: 10, target_max: 20, max_strategic_position: 20, core_position: 0, trade_position: 0, core_ratio_grade: 'B', avg_cost: null, updated_at: now }
];

/** 阈值初值（param_config，value 统一 { v: 值 }） */
const PARAM_SEED = [
  { key: 'sideway_days', value: { v: 15 }, description: '标准横盘天数', category: '阈值', version: 1, updated_at: now },
  { key: 'sideway_days_min', value: { v: 8 }, description: '横盘有效最小天数（8 日=初步整理，V2.1.1）', category: '阈值', version: 1, updated_at: now },
  { key: 'volume_ratio', value: { v: 0.70 }, description: '缩量阈值（5日均量/20日均量）', category: '阈值', version: 1, updated_at: now },
  { key: 'volume_ratio_mild', value: { v: 0.95 }, description: '温和缩量上限（V2上限，2026-08-22敏感性矩阵0.90→0.95单调递增+7.9pct，用户采纳）', category: '阈值', version: 1, updated_at: now },
  { key: 'volume_ratio_high', value: { v: 1.15 }, description: '放量阈值', category: '阈值', version: 1, updated_at: now },
  { key: 'volume_ratio_extreme', value: { v: 1.50 }, description: '异常放量阈值', category: '阈值', version: 1, updated_at: now },
  { key: 'ma20_slope', value: { v: 0 }, description: 'ma20 斜率>0 视为向上', category: '阈值', version: 1, updated_at: now },
  { key: 'tech_sector_max', value: { v: 65 }, description: '科技赛道上限%（用户确认值）', category: '仓位', version: 1, updated_at: now },
  { key: 'single_etf_max', value: { v: 30 }, description: '单 ETF 最大仓位%', category: '仓位', version: 1, updated_at: now },
  { key: 'premium_qdii_light', value: { v: 1 }, description: 'QDII 轻度溢价阈值%', category: '阈值', version: 1, updated_at: now },
  { key: 'premium_qdii_obvious', value: { v: 3 }, description: 'QDII 明显溢价阈值%', category: '阈值', version: 1, updated_at: now },
  { key: 'premium_qdii_extreme', value: { v: 5 }, description: 'QDII 极端溢价阈值%', category: '阈值', version: 1, updated_at: now },
  { key: 'premium_etf_light', value: { v: 0.3 }, description: '普通ETF 轻度溢价阈值%', category: '阈值', version: 1, updated_at: now },
  { key: 'premium_etf_obvious', value: { v: 1 }, description: '普通ETF 明显溢价阈值%', category: '阈值', version: 1, updated_at: now },
  { key: 'premium_etf_extreme', value: { v: 2 }, description: '普通ETF 极端溢价阈值%', category: '阈值', version: 1, updated_at: now },
  { key: 'bias_20d_hot', value: { v: 15 }, description: '偏离20日均线偏热阈值%', category: '阈值', version: 1, updated_at: now },
  { key: 'bias_20d_crowd', value: { v: 25 }, description: '偏离20日均线拥挤阈值%', category: '阈值', version: 1, updated_at: now },
  { key: 'opportunity_weights', value: { v: { trend: 35, volume: 30, fundamental: 25, crowding: 10 } }, description: '机会分权重 Trend/Vol/Fund/Crowd（%）', category: '权重', version: 1, updated_at: now },
  // 仓位引擎 V2.0.1 参数（统一 snake_case，与代码 DEFAULT_PARAMS 完全同名；mergeParams 的点号映射仅作旧数据兼容）
  { key: 'factor_opportunity', value: { v: { A: [0.9, 1.0], B: [0.6, 0.8], C: [0.4, 0.6], D: [0.2, 0.4], E: [0.05, 0.2], F: [0, 0] } }, description: '机会等级→机会系数区间', category: '仓位', version: 1, updated_at: now },
  { key: 'risk_factor', value: { v: { NORMAL: 1.0, YELLOW: 0.85, RED: 0.6 } }, description: '风险等级→修正系数（override=0）', category: '仓位', version: 1, updated_at: now },
  { key: 'cooldown_days', value: { v: 3 }, description: '加仓冷静期（交易日）', category: '仓位', version: 1, updated_at: now },
  { key: 'add_breakout_max_pct', value: { v: 5 }, description: '突破加仓单次上限 pct', category: '仓位', version: 1, updated_at: now },
  { key: 'over_alloc_thresholds', value: { v: { normal: 3, mild: 5, moderate: 8, severe: 15 } }, description: '被动超配分级阈值 pct', category: '仓位', version: 1, updated_at: now },
  { key: 'cash_regime', value: { v: { aggressive: [5, 10], structural: [10, 20], range: [20, 35], defensive: [35, 50], crisis: [50, 100] } }, description: '组合环境→现金目标区间%', category: '仓位', version: 1, updated_at: now },
  { key: 'core_ratio', value: { v: { A: 0.7, B: 0.6, C: 0.5, D: 0.3 } }, description: '核心仓比例（核心仓等级→占目标比例）', category: '仓位', version: 1, updated_at: now }
];

/** 基本面雷达模板（与 common/utils/fundamental.js 单一真相同步） */
const FUNDAMENTAL_CONFIG_SEED = FUNDAMENTAL_TEMPLATES.concat(
  RETIRED_INDICATORS.map((r) => ({
    code: r.code, indicator: r.indicator, name: r.name, weight: 0,
    freq: 'quarterly', source: 'retired', unit: '', metric_type: 'qualitative', layer: 'events'
  }))
);

async function seedCollection(name, docs, uniqueKey, label) {
  const col = dbUtil.getCollection(name, envId);
  let ok = 0;
  let skip = 0;
  for (const doc of docs) {
    const where = {};
    Object.keys(uniqueKey).forEach((k) => { where[k] = doc[k]; });
    const found = await col.where(where).limit(1).get();
    if (found.data && found.data.length > 0) {
      // 已存在则更新（保留 _id）
      const id = found.data[0]._id;
      const data = { ...doc };
      delete data._id;
      await col.doc(id).update(data);
      skip += 1;
    } else {
      await col.add({ ...doc });
      ok += 1;
    }
  }
  console.log(`  ✅ ${label}：新增 ${ok}，更新 ${skip}`);
}

async function main() {
  console.log(`\n=== ETF 决策系统：初始化种子数据（envId=${envId}）===\n`);
  cloudbase.init({ env: envId });

  await seedCollection(COLLECTIONS.ETF_BASIC, ETF_SEED, { code: 'code' }, 'etf_basic（5 只 ETF）');
  await seedCollection(COLLECTIONS.PORTFOLIO_POSITION, POSITION_SEED, { code: 'code' }, 'portfolio_position（仓位初值）');
  await seedCollection(COLLECTIONS.PARAM_CONFIG, PARAM_SEED, { key: 'key' }, 'param_config（阈值初值）');
  await seedCollection(COLLECTIONS.FUNDAMENTAL_CONFIG, FUNDAMENTAL_CONFIG_SEED, { code: 'code', indicator: 'indicator' }, 'fundamental_config（雷达模板）');

  console.log('\n⚠️  注意：');
  console.log('  1. 5 只 ETF 仓位初值（target/max）为默认占位值，待用户最终确认，可在后台修改；');
  console.log('  2. is_qdii：513310 中韩半导体ETF(QDII)=true，其余 4 只=false；');
  console.log('  3. 科技赛道上限 tech_sector_max=65（用户已确认）。');
  console.log('\n✅ 种子数据初始化完成。');
}

main().catch((e) => {
  console.error('❌ 初始化失败：', e);
  process.exit(1);
});
