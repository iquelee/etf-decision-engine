/**
 * 14 集合 schema（字段定义 + 索引定义）——单点真相
 * 供 init-collections.js 与业务代码复用。
 *
 * @module schema
 */

'use strict';

const { COLLECTIONS } = require('./constants');

/**
 * 每个集合定义：
 * {
 *   name: 集合名,
 *   fields: { 字段名: { type, required, desc } },
 *   indexes: [ { name, keys: [{field, direction}], unique } ],
 *   permission: '仅创建者读写'
 * }
 */

const SCHEMAS = [
  {
    name: COLLECTIONS.ETF_BASIC,
    fields: {
      code: { type: 'string', required: true, desc: 'ETF 代码，如 513310' },
      name: { type: 'string', required: true, desc: '名称' },
      sector: { type: 'string', required: true, desc: '赛道：storage/ai_network/semi_equip/gold/biotech' },
      is_qdii: { type: 'boolean', required: true, desc: '是否 QDII（触发溢价硬规则）' },
      max_position: { type: 'number', required: true, desc: '最大仓位%' },
      target_position: { type: 'number', required: true, desc: '目标仓位%' },
      status: { type: 'string', required: false, desc: 'enable/disable' },
      sort_order: { type: 'number', required: false, desc: '展示排序' }
    },
    indexes: [
      { name: 'uk_code', keys: [{ field: 'code', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.ETF_DAILY,
    fields: {
      code: { type: 'string', required: true, desc: '' },
      trade_date: { type: 'string', required: true, desc: '交易日 YYYY-MM-DD' },
      open: { type: 'number', required: true, desc: '开盘价' },
      high: { type: 'number', required: true, desc: '最高价' },
      low: { type: 'number', required: true, desc: '最低价' },
      close: { type: 'number', required: true, desc: '收盘价' },
      volume: { type: 'number', required: true, desc: '成交量（份）' },
      amount: { type: 'number', required: true, desc: '成交额（元）' },
      premium_rate: { type: 'number', required: false, desc: '折溢价率%' },
      iopv: { type: 'number', required: false, desc: '参考净值' },
      source: { type: 'string', required: true, desc: 'akshare/eastmoney/tencent/sina' },
      realtime: { type: 'object', required: false, desc: '盘中快照 {price,time}' }
    },
    indexes: [
      { name: 'uk_code_trade', keys: [{ field: 'code', direction: 'asc' }, { field: 'trade_date', direction: 'asc' }], unique: true },
      { name: 'idx_trade_date', keys: [{ field: 'trade_date', direction: 'asc' }], unique: false }
    ]
  },
  {
    name: COLLECTIONS.ETF_WEEKLY,
    fields: {
      code: { type: 'string', required: true, desc: '' },
      week_end_date: { type: 'string', required: true, desc: '周结束日 YYYY-MM-DD' },
      open: { type: 'number', required: true, desc: '周开盘' },
      high: { type: 'number', required: true, desc: '周最高' },
      low: { type: 'number', required: true, desc: '周最低' },
      close: { type: 'number', required: true, desc: '周收盘' },
      volume: { type: 'number', required: false, desc: '周成交量' },
      ma20w: { type: 'number', required: true, desc: '周 MA20' },
      ma60w: { type: 'number', required: true, desc: '周 MA60' },
      ma20w_slope: { type: 'number', required: true, desc: '周 MA20 斜率' },
      ma60w_slope: { type: 'number', required: true, desc: '周 MA60 斜率' },
      w_state: { type: 'string', required: true, desc: 'W1~W5' }
    },
    indexes: [
      { name: 'uk_code_week', keys: [{ field: 'code', direction: 'asc' }, { field: 'week_end_date', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.INDICATOR_SNAPSHOT,
    fields: {
      code: { type: 'string', required: true, desc: '' },
      calc_date: { type: 'string', required: true, desc: '计算日 YYYY-MM-DD' },
      ma5: { type: 'number', required: true, desc: '' },
      ma10: { type: 'number', required: true, desc: '' },
      ma20: { type: 'number', required: true, desc: '' },
      ma60: { type: 'number', required: true, desc: '' },
      ma120: { type: 'number', required: true, desc: '' },
      ma250: { type: 'number', required: true, desc: '' },
      atr20: { type: 'number', required: true, desc: '20 日 ATR' },
      vol20: { type: 'number', required: true, desc: '20 日均量' },
      sideway_days: { type: 'number', required: true, desc: '横盘天数' },
      sideway_range: { type: 'number', required: false, desc: '横盘区间振幅%' },
      ma20_slope: { type: 'number', required: false, desc: 'MA20 5日斜率%（走平判定）' },
      trend_context: { type: 'string', required: false, desc: '横盘前趋势 UP/DOWN/RANGE_CONSOLIDATION' },
      consolidation_score: { type: 'number', required: false, desc: '横盘评分 0~100' },
      volume_ratio: { type: 'number', required: true, desc: '5日均量/20日均量' },
      volume_slope: { type: 'number', required: true, desc: '近5日量趋势' },
      v_state: { type: 'string', required: true, desc: 'V1~V5' },
      w_state: { type: 'string', required: true, desc: 'W1~W5' },
      d_state: { type: 'string', required: true, desc: 'D1~D5' },
      h_state: { type: 'string', required: true, desc: 'H1~H5' },
      high_volume_stagnation: { type: 'boolean', required: true, desc: '放量滞涨' },
      high_volume_decline: { type: 'boolean', required: true, desc: '放量下跌' },
      price_position: { type: 'number', required: true, desc: '收盘价在20日区间位置 0~1' },
      premium_rate: { type: 'number', required: false, desc: '最新折溢价率%（拥挤度用）' },
      change_5d: { type: 'number', required: false, desc: '近5日涨幅%（拥挤度用）' },
      bias_20d: { type: 'number', required: false, desc: '偏离20日均线%（拥挤度用）' },
      data_complete: { type: 'boolean', required: true, desc: '数据完整性标记' },
      version: { type: 'number', required: true, desc: '参数版本 param_config.version' }
    },
    indexes: [
      { name: 'uk_code_calc', keys: [{ field: 'code', direction: 'asc' }, { field: 'calc_date', direction: 'asc' }], unique: true },
      { name: 'idx_calc_date', keys: [{ field: 'calc_date', direction: 'asc' }], unique: false }
    ]
  },
  {
    name: COLLECTIONS.FUNDAMENTAL_CONFIG,
    fields: {
      code: { type: 'string', required: true, desc: '' },
      indicator: { type: 'string', required: true, desc: '指标 key，如 dram_price' },
      name: { type: 'string', required: false, desc: '显示名' },
      weight: { type: 'number', required: true, desc: '雷达权重' },
      freq: { type: 'string', required: true, desc: 'daily/monthly/quarterly' },
      source: { type: 'string', required: true, desc: 'manual 或自动源' },
      unit: { type: 'string', required: false, desc: '单位' },
      metric_type: { type: 'string', required: false, desc: 'quantitative=量化/qualitative=定性' },
      layer: { type: 'string', required: false, desc: 'hard_data/earnings/events（V2.1 三层基本面）' },
      signal_invert: { type: 'boolean', required: false, desc: 'true=数值升对 F 为利空（黄金利率/美元）' }
    },
    indexes: [
      { name: 'uk_code_ind', keys: [{ field: 'code', direction: 'asc' }, { field: 'indicator', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.FUNDAMENTAL_SERIES,
    fields: {
      code: { type: 'string', required: true, desc: '' },
      indicator: { type: 'string', required: true, desc: '' },
      data_date: { type: 'string', required: true, desc: '数据日期 YYYY-MM-DD' },
      value: { type: 'number', required: true, desc: '数值' },
      prev: { type: 'number', required: false, desc: '上期值（自动记录）' },
      direction: { type: 'string', required: true, desc: 'up/down/flat/na' },
      source: { type: 'string', required: true, desc: '来源' },
      confidence: { type: 'number', required: true, range: [0, 1], desc: '置信度 0~1' },
      unit: { type: 'string', required: false, desc: '单位' },
      note: { type: 'string', required: false, desc: '备注' },
      layer: { type: 'string', required: false, desc: '写入层（展示用；F 合成读 config.layer）' },
      citations: { type: 'array', required: false, desc: '定性引用 [{stock_code,stock_name,title,source}]' }
    },
    indexes: [
      { name: 'uk_code_ind_date', keys: [{ field: 'code', direction: 'asc' }, { field: 'indicator', direction: 'asc' }, { field: 'data_date', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.FUNDAMENTAL_STATE,
    fields: {
      code: { type: 'string', required: true, desc: '' },
      f_state: { type: 'string', required: true, desc: 'F1~F5' },
      f_score: { type: 'number', required: true, desc: '25/20/15/10/5' },
      detail: { type: 'object', required: false, desc: '各指标方向汇总' },
      updated_at: { type: 'date', required: true, desc: '' }
    },
    indexes: [
      { name: 'uk_code', keys: [{ field: 'code', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.RISK_EVENTS,
    fields: {
      code: { type: 'string', required: true, desc: 'ETF 代码或 ALL' },
      event_type: { type: 'string', required: true, desc: 'policy/tech/demand/structure/falsify/other' },
      risk_flag: { type: 'string', required: true, desc: 'NORMAL/YELLOW/RED' },
      risk_override: { type: 'boolean', required: true, desc: '是否 RISK_OVERRIDE' },
      trigger_time: { type: 'date', required: true, desc: '触发时间' },
      resolve_time: { type: 'date', required: false, desc: '解除时间' },
      status: { type: 'string', required: true, desc: 'active/resolved' },
      reason: { type: 'string', required: true, desc: '理由' },
      note: { type: 'string', required: false, desc: '备注' }
    },
    indexes: [
      { name: 'idx_code_status', keys: [{ field: 'code', direction: 'asc' }, { field: 'status', direction: 'asc' }], unique: false },
      { name: 'idx_trigger', keys: [{ field: 'trigger_time', direction: 'asc' }], unique: false }
    ]
  },
  {
    name: COLLECTIONS.PORTFOLIO_POSITION,
    fields: {
      code: { type: 'string', required: true, desc: '' },
      current_position: { type: 'number', required: true, desc: '当前仓位%' },
      target_position: { type: 'number', required: false, desc: '[deprecated] 旧单一目标仓位，等价 target_std' },
      max_position: { type: 'number', required: false, desc: '[deprecated] 旧最大仓位，等价 target_max' },
      target_min: { type: 'number', required: false, desc: '目标下限%' },
      target_std: { type: 'number', required: false, desc: '标准目标%（常态持有中枢）' },
      target_max: { type: 'number', required: false, desc: '目标上限%（超过即被动超配）' },
      max_strategic_position: { type: 'number', required: false, desc: '最大战略仓位%（硬上限）' },
      core_position: { type: 'number', required: false, desc: '实际核心仓%（成交回写，减仓地板）' },
      trade_position: { type: 'number', required: false, desc: '实际交易仓%（= current - core）' },
      suggested_core: { type: 'number', required: false, desc: '决策建议核心仓%（本次输出，仅展示）' },
      suggested_trade: { type: 'number', required: false, desc: '决策建议交易仓%（本次输出，仅展示）' },
      core_ratio_grade: { type: 'string', required: false, desc: '核心仓比例等级 S/A/B/C/D' },
      trade_ratio_grade: { type: 'string', required: false, desc: '交易仓比例等级（10 日确认，独立于核心仓）' },
      trade_pending_grade: { type: 'string', required: false, desc: '交易仓待确认等级（慢变量）' },
      trade_pending_since: { type: 'string', required: false, desc: '交易仓待确认起始日' },
      trade_changed_at: { type: 'date', required: false, desc: '交易仓等级最近调整日（慢变量）' },
      core_ratio_changed_at: { type: 'date', required: false, desc: '核心仓比例最近调整日（慢变量）' },
      pending_grade: { type: 'string', required: false, desc: '待确认的核心仓等级（慢变量）' },
      pending_since: { type: 'string', required: false, desc: '待确认起始日' },
      shares: { type: 'number', required: false, desc: '持仓份数（操作记录自动累计，供自动算仓）' },
      avg_cost: { type: 'number', required: false, desc: '成本' },
      updated_at: { type: 'date', required: true, desc: '' }
    },
    indexes: [
      { name: 'uk_code', keys: [{ field: 'code', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.PORTFOLIO_SNAPSHOT,
    fields: {
      snapshot_date: { type: 'string', required: true, desc: 'YYYY-MM-DD' },
      total_asset: { type: 'number', required: false, desc: '总资产（持股市值+现金）' },
      cash_balance: { type: 'number', required: false, desc: '现金余额（元，随买卖变、不随行情变）' },
      holdings_mv: { type: 'number', required: false, desc: '持股市值合计（元）' },
      asset_source: { type: 'string', required: false, desc: 'live=市值+现金；manual=后台录入' },
      tech_position: { type: 'number', required: false, desc: '科技仓位%（storage+ai_network+semi_equip）' },
      gold_position: { type: 'number', required: false, desc: '黄金仓位%' },
      cash_ratio: { type: 'number', required: false, desc: '现金比例%' },
      total_pnl: { type: 'number', required: false, desc: '浮盈' },
      strategic_cash: { type: 'number', required: false, desc: '战略防守现金%' },
      deployable_cash: { type: 'number', required: false, desc: '可部署现金%' },
      semi_position: { type: 'number', required: false, desc: '半导体仓位%（storage+semi_equip）' },
      drug_position: { type: 'number', required: false, desc: '创新药仓位%（biotech）' },
      market_regime: { type: 'string', required: false, desc: '组合环境 aggressive/structural/range/defensive/crisis' },
      positions: { type: 'array', required: true, desc: '[{code,position,value,core,trade}]' }
    },
    indexes: [
      { name: 'uk_date', keys: [{ field: 'snapshot_date', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.DECISION_RESULT,
    fields: {
      code: { type: 'string', required: true, desc: '' },
      decision_date: { type: 'string', required: true, desc: '决策日 YYYY-MM-DD' },
      w_state: { type: 'string', required: true, desc: '' },
      d_state: { type: 'string', required: true, desc: '' },
      h_state: { type: 'string', required: true, desc: '' },
      v_state: { type: 'string', required: true, desc: '' },
      f_state: { type: 'string', required: true, desc: '' },
      c_state: { type: 'string', required: true, desc: '' },
      risk_flag: { type: 'string', required: true, desc: '' },
      risk_override: { type: 'boolean', required: true, desc: '' },
      premium_flag: { type: 'string', required: false, desc: '正常/轻度溢价/明显溢价/极端溢价' },
      scores: { type: 'object', required: true, desc: '{trend,volume,fundamental,crowding,risk,total}' },
      opportunity_score: { type: 'number', required: true, desc: '机会分' },
      final_action: { type: 'string', required: true, desc: '观察/建仓/加仓/持有/减仓/清仓' },
      target_position: { type: 'number', required: false, desc: '[deprecated] 等价 final_target' },
      opportunity_grade: { type: 'string', required: false, desc: '机会等级 A~F' },
      opportunity_factor: { type: 'number', required: false, desc: '机会系数' },
      target_min: { type: 'number', required: false, desc: '三档目标下限' },
      target_std: { type: 'number', required: false, desc: '三档标准目标' },
      target_max: { type: 'number', required: false, desc: '三档目标上限' },
      final_target: { type: 'number', required: false, desc: '最终目标仓位%（经组合约束）' },
      position_gap: { type: 'number', required: false, desc: '仓位缺口 final_target - current' },
      core_position: { type: 'number', required: false, desc: '建议核心仓%' },
      trade_position: { type: 'number', required: false, desc: '建议交易仓%' },
      suggested_position: { type: 'number', required: false, desc: '本次建议调整到仓位%' },
      add_mode: { type: 'string', required: false, desc: '横盘加仓/突破加仓/无' },
      add_eligibility: { type: 'object', required: false, desc: '加仓资格 8 项 {trend,structure,volume,fund,chase,limit,sector,risk,overall}' },
      cooldown_days: { type: 'number', required: false, desc: '距下次可加仓剩余交易日' },
      over_alloc_status: { type: 'string', required: false, desc: '正常/轻度/中度/明显/极端' },
      next_add_condition: { type: 'string', required: false, desc: '下一加仓条件' },
      explain_chain: { type: 'array', required: true, desc: '[{step,condition,result}] 决策链' },
      rule_hits: { type: 'array', required: false, desc: '命中 P0~P7 规则' },
      version: { type: 'number', required: true, desc: '参数版本' }
    },
    indexes: [
      { name: 'uk_code_date', keys: [{ field: 'code', direction: 'asc' }, { field: 'decision_date', direction: 'asc' }], unique: true },
      { name: 'idx_date', keys: [{ field: 'decision_date', direction: 'asc' }], unique: false }
    ]
  },
  {
    name: COLLECTIONS.TRADE_LOG,
    fields: {
      trade_date: { type: 'string', required: true, desc: 'YYYY-MM-DD' },
      code: { type: 'string', required: true, desc: '' },
      action: { type: 'string', required: true, desc: 'buy/sell' },
      shares: { type: 'number', required: true, desc: '份额' },
      price: { type: 'number', required: true, desc: '价格' },
      amount: { type: 'number', required: false, desc: '金额' },
      reason: { type: 'string', required: false, desc: '原因' },
      decision_id: { type: 'string', required: false, desc: '关联决策 _id' },
      position_after: { type: 'number', required: false, desc: '操作后仓位%' },
      add_mode: { type: 'string', required: false, desc: '建仓时 add_mode（横盘加仓/突破加仓/无），供冷静期按上次买入模式计算' }
    },
    indexes: [
      { name: 'idx_trade_date', keys: [{ field: 'trade_date', direction: 'asc' }], unique: false },
      { name: 'idx_code', keys: [{ field: 'code', direction: 'asc' }], unique: false }
    ]
  },
  {
    name: COLLECTIONS.PARAM_CONFIG,
    fields: {
      key: { type: 'string', required: true, desc: 'sideway_days / volume_ratio / weight.opportunity 等' },
      value: { type: 'object', required: true, desc: '当前值（数字/对象）' },
      prev_value: { type: 'object', required: false, desc: '上一值（改参对比）' },
      description: { type: 'string', required: false, desc: '说明' },
      category: { type: 'string', required: false, desc: '阈值/权重/仓位' },
      version: { type: 'number', required: true, desc: '每次改动 +1' },
      updated_at: { type: 'date', required: true, desc: '' }
    },
    indexes: [
      { name: 'uk_key', keys: [{ field: 'key', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.FETCH_LOG,
    fields: {
      source: { type: 'string', required: true, desc: 'akshare/eastmoney/tencent/sina/fred' },
      fetch_time: { type: 'date', required: true, desc: '' },
      status: { type: 'string', required: true, desc: 'success/fail/partial' },
      item_count: { type: 'number', required: false, desc: '抓取条数' },
      error: { type: 'string', required: false, desc: '错误信息' },
      task_name: { type: 'string', required: false, desc: '触发任务' },
      duration_ms: { type: 'number', required: false, desc: '耗时' }
    },
    indexes: [
      { name: 'idx_source_status', keys: [{ field: 'source', direction: 'asc' }, { field: 'status', direction: 'asc' }], unique: false },
      { name: 'idx_fetch_time', keys: [{ field: 'fetch_time', direction: 'asc' }], unique: false }
    ]
  },
  {
    name: COLLECTIONS.NEWS_FEED,
    fields: {
      code: { type: 'string', required: true, desc: '关联 ETF 代码' },
      sector: { type: 'string', required: true, desc: '赛道' },
      title: { type: 'string', required: true, desc: '公告/新闻标题' },
      sec_name: { type: 'string', required: false, desc: '公司/机构名' },
      publish_time: { type: 'date', required: true, desc: '发布时间' },
      direction: { type: 'string', required: true, desc: 'positive/negative/neutral 关键词初筛' },
      confidence: { type: 'number', required: true, range: [0, 1], desc: '方向置信度 0~1' },
      source: { type: 'string', required: true, desc: 'cninfo 等' },
      url: { type: 'string', required: false, desc: '公告链接' },
      status: { type: 'string', required: true, desc: 'new/processed/extract_empty（无有效指标，可重试）' },
      created_at: { type: 'date', required: true, desc: '入库时间' },
      stock_code: { type: 'string', required: false, desc: '重仓股代码' },
      stock_name: { type: 'string', required: false, desc: '重仓股名称' },
      holding_weight: { type: 'number', required: false, desc: '占净值%' },
      summary: { type: 'string', required: false, desc: '快讯摘要' }
    },
    indexes: [
      { name: 'idx_code_time', keys: [{ field: 'code', direction: 'asc' }, { field: 'publish_time', direction: 'asc' }], unique: false },
      { name: 'idx_status', keys: [{ field: 'status', direction: 'asc' }], unique: false }
    ]
  },
  {
    name: COLLECTIONS.ETF_HOLDINGS,
    fields: {
      code: { type: 'string', required: true, desc: 'ETF 代码' },
      stock_code: { type: 'string', required: true, desc: '重仓股代码' },
      stock_name: { type: 'string', required: true, desc: '重仓股名称' },
      weight: { type: 'number', required: true, desc: '占净值%' },
      rank: { type: 'number', required: true, desc: '1~10' },
      market: { type: 'string', required: false, desc: 'cn/hk/kr/us' },
      report_date: { type: 'string', required: true, desc: '持仓截止日 YYYY-MM-DD' },
      updated_at: { type: 'date', required: true, desc: '' }
    },
    indexes: [
      { name: 'uk_etf_stock_date', keys: [{ field: 'code', direction: 'asc' }, { field: 'stock_code', direction: 'asc' }, { field: 'report_date', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.FUNDAMENTAL_EVIDENCE,
    fields: {
      code: { type: 'string', required: true, desc: 'ETF 代码' },
      indicator: { type: 'string', required: true, desc: '雷达指标 key' },
      week_date: { type: 'string', required: true, desc: '自然周周一 YYYY-MM-DD' },
      title: { type: 'string', required: true, desc: '标题' },
      stock_code: { type: 'string', required: false, desc: '重仓股代码' },
      stock_name: { type: 'string', required: false, desc: '重仓股名称' },
      holding_weight: { type: 'number', required: false, desc: '占净值%' },
      grade: { type: 'number', required: false, desc: '定性 1~5' },
      direction: { type: 'string', required: false, desc: '量化方向' },
      score: { type: 'number', required: false, desc: '量化强度分' },
      confidence: { type: 'number', required: true, range: [0, 1], desc: '置信度' },
      source: { type: 'string', required: true, desc: 'deepseek/sec/manual_veto' },
      reason: { type: 'string', required: false, desc: '判定理由' },
      news_id: { type: 'string', required: false, desc: 'news_feed._id' },
      created_at: { type: 'date', required: true, desc: '' }
    },
    indexes: [
      { name: 'idx_code_ind_week', keys: [{ field: 'code', direction: 'asc' }, { field: 'indicator', direction: 'asc' }, { field: 'week_date', direction: 'asc' }], unique: false }
    ]
  },
  {
    name: COLLECTIONS.MARKET_ENV,
    fields: {
      index_code: { type: 'string', required: true, desc: '指数代码，如 000300' },
      name: { type: 'string', required: false, desc: '指数名称' },
      trade_date: { type: 'string', required: false, desc: '最新周线日期 YYYY-MM-DD' },
      weekly_bars: { type: 'array', required: false, desc: '最近 60 根周线 [{date,open,high,low,close,volume}]' },
      updated_at: { type: 'date', required: false, desc: '' }
    },
    indexes: [
      { name: 'uk_index_code', keys: [{ field: 'index_code', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.GLOBAL_QUOTE,
    fields: {
      symbol: { type: 'string', required: true, desc: '行情 symbol，如 usMU/usNDX/KS11' },
      name: { type: 'string', required: false, desc: '标的名称' },
      code: { type: 'string', required: false, desc: '代码，如 MU/NDX/KS11' },
      market: { type: 'string', required: true, desc: 'us/us_index/em_index' },
      related: { type: 'string', required: false, desc: '关联 ETF 代码或 ALL' },
      factor: { type: 'string', required: false, desc: '传导因子说明' },
      trade_date: { type: 'string', required: true, desc: '交易日 YYYY-MM-DD' },
      open: { type: 'number', required: false, desc: '开盘' },
      high: { type: 'number', required: false, desc: '最高' },
      low: { type: 'number', required: false, desc: '最低' },
      close: { type: 'number', required: true, desc: '收盘' },
      volume: { type: 'number', required: false, desc: '成交量' },
      pct_change: { type: 'number', required: false, desc: '日涨跌幅%' }
    },
    indexes: [
      { name: 'uk_symbol_trade', keys: [{ field: 'symbol', direction: 'asc' }, { field: 'trade_date', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.GLOBAL_FINANCIAL,
    fields: {
      symbol: { type: 'string', required: true, desc: '行情 symbol，如 usMU' },
      name: { type: 'string', required: false, desc: '公司名' },
      code: { type: 'string', required: false, desc: '代码，如 MU' },
      cik: { type: 'string', required: false, desc: 'SEC CIK' },
      related: { type: 'array', required: false, desc: '关联 ETF 代码数组' },
      factor: { type: 'string', required: false, desc: '传导因子' },
      entity_name: { type: 'string', required: false, desc: 'SEC 实体名' },
      period_end: { type: 'string', required: true, desc: '财报期截止日 YYYY-MM-DD' },
      form: { type: 'string', required: false, desc: '10-Q/10-K' },
      fy: { type: 'number', required: false, desc: '财年' },
      fp: { type: 'string', required: false, desc: '季度 Q1/Q2/Q3/FY' },
      filed: { type: 'string', required: false, desc: '提交日' },
      revenue: { type: 'number', required: false, desc: '单季营收(美元)' },
      revenue_yoy: { type: 'number', required: false, desc: '营收同比%' },
      net_income: { type: 'number', required: false, desc: '单季净利(美元)' },
      net_income_yoy: { type: 'number', required: false, desc: '净利同比%' },
      gross_profit: { type: 'number', required: false, desc: '单季毛利(美元)' },
      gross_margin: { type: 'number', required: false, desc: '毛利率%' },
      operating_income: { type: 'number', required: false, desc: '营业利润(美元)' },
      rd_expense: { type: 'number', required: false, desc: '研发费用(美元)' },
      inventory: { type: 'number', required: false, desc: '库存(美元)' },
      inventory_qoq: { type: 'number', required: false, desc: '库存环比%' },
      capex_ytd: { type: 'number', required: false, desc: 'CapEx累计(美元)' },
      eps: { type: 'number', required: false, desc: '每股收益(美元)' },
      created_at: { type: 'date', required: false, desc: '创建时间' }
    },
    indexes: [
      { name: 'uk_symbol_period', keys: [{ field: 'symbol', direction: 'asc' }, { field: 'period_end', direction: 'asc' }], unique: true }
    ]
  },
  {
    name: COLLECTIONS.MACRO,
    fields: {
      indicator: { type: 'string', required: true, desc: '指标 key：cpi/pmi/ppi/gdp' },
      name: { type: 'string', required: false, desc: '指标名称' },
      report_date: { type: 'string', required: true, desc: '报告期 YYYY-MM' },
      period_label: { type: 'string', required: false, desc: '报告期标签，如 2026年07月份' },
      value: { type: 'number', required: true, desc: '核心指标值' },
      unit: { type: 'string', required: false, desc: '单位 % / 亿元 / 空' },
      note: { type: 'string', required: false, desc: '对决策的影响说明' },
      updated_at: { type: 'date', required: false, desc: '更新时间' }
    },
    indexes: [
      { name: 'uk_ind_date', keys: [{ field: 'indicator', direction: 'asc' }, { field: 'report_date', direction: 'asc' }], unique: true }
    ]
  }
];

/** 按名称取集合定义 */
function getSchema(name) {
  return SCHEMAS.find((s) => s.name === name) || null;
}

/** 全部集合名列表 */
function getCollectionNames() {
  return SCHEMAS.map((s) => s.name);
}

/**
 * 字段校验（P2-1：把 schema.js 接入写入路径，做类型/必填/范围检查）。
 * @param {string} collection 集合名
 * @param {object} doc 待校验文档
 * @param {object} opts { skipRequired } 跳过必填检查（部分更新场景）
 * @returns {{ok:boolean, errors:string[]}}
 */
function validateDoc(collection, doc, opts = {}) {
  const schema = getSchema(collection);
  const errors = [];
  if (!schema) return { ok: true, errors }; // 未定义 schema 的集合不拦截
  const fields = schema.fields || {};
  for (const [field, def] of Object.entries(fields)) {
    const val = doc[field];
    const isUndef = val === undefined || val === null || val === '';
    // 必填检查
    if (def.required && isUndef && !opts.skipRequired) {
      errors.push(`${field} 必填`);
      continue;
    }
    if (isUndef) continue;
    // 类型检查
    const type = def.type;
    if (type === 'number') {
      if (typeof val !== 'number' && !(typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val)))) {
        errors.push(`${field} 应为数字`);
        continue;
      }
      const num = Number(val);
      // 范围检查（0~100 的百分比类字段常见）
      if (def.range) {
        if (num < def.range[0] || num > def.range[1]) {
          errors.push(`${field} 应在 ${def.range[0]}~${def.range[1]} 范围`);
        }
      }
    } else if (type === 'string') {
      if (typeof val !== 'string') errors.push(`${field} 应为字符串`);
    } else if (type === 'boolean') {
      if (typeof val !== 'boolean' && val !== true && val !== false && val !== 0 && val !== 1) {
        errors.push(`${field} 应为布尔`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  SCHEMAS,
  getSchema,
  getCollectionNames,
  validateDoc
};
