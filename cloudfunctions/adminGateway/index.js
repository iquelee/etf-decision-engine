/**
 * 云函数：adminGateway —— 后台读写路由
 * 基本面录入 / 风险事件 / 参数配置 / 操作记录 / 数据管理，写操作后联动重算。
 * 单用户登录鉴权：密码与 token 存 param_config（admin_password / admin_token）。
 */

'use strict';

const crypto = require('crypto');
const cloudbase = require('@cloudbase/node-sdk');
const db = require('./common/utils/db');
const { COLLECTIONS, RISK_EVENT_TYPES, FROZEN_PARAM_KEYS, pickTradeUpdate } = require('./common/constants');
const fund = require('./common/utils/fundamental');
const { validateDoc } = require('./common/schema');
const { replayAverageCost, unrealizedPnl } = require('./common/utils/pnl');
const {
  cashDeltaFromTrade, snapshotHoldingsMv, resolveCashYuan,
  holdingsMarketValue, liveTotalAsset, positionPct, roundMoney, bookFromPositions
} = require('./common/utils/live-asset');
const { hashPassword, verifyPassword } = require('./common/utils/admin-auth');
const { requestId, safeErrorResponse } = require('./common/utils/gateway-errors');
const { triggerIntelRefresh } = require('./common/utils/intel-refresh');
const { isDateStr, clampInt, isRiskEventTypeKey, normalizeRiskFlag, parseFiniteNumber } = require('./common/utils/request-validate');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

function ok(data) { return { code: 0, data, message: 'ok' }; }
function fail(message, code = 1) { return { code, data: null, message }; }

function beijingDateStr() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }

/** 后台模型健康摘要：只读，不影响 Gen-1 / V3.6.1 的任何开关和计算。 */
async function getGen1Health() {
  const [{ params }, etfs] = await Promise.all([
    db.getParamConfig().catch(() => ({ params: {} })),
    db.getEtfList().catch(() => [])
  ]);
  const p = params || {};
  const today = beijingDateStr();
  const rows = await Promise.all((etfs || []).map(async (etf) => {
    const [signals, dailyRows] = await Promise.all([
      db.query(COLLECTIONS.ML_SHADOW_SIGNAL, { code: etf.code }, {
        orderBy: [{ field: 'date', direction: 'desc' }], limit: 1
      }).catch(() => []),
      db.query(COLLECTIONS.ETF_DAILY, { code: etf.code }, {
        orderBy: [{ field: 'trade_date', direction: 'desc' }], limit: 10
      }).catch(() => [])
    ]);
    const signal = signals[0] || null;
    const signalDate = String((signal && (signal.date || signal.signal_date)) || '').slice(0, 10) || null;
    // 信号应与最新“正式 EOD”对齐，而不是强制等于自然日；盘中/早晨没有
    // 当日收盘数据时，上一交易日信号仍是有效的最新参考。
    const latestEod = (dailyRows || []).find((r) => r.source !== 'realtime' && r.trade_date && Number.isFinite(Number(r.close)));
    const latestEodDate = latestEod ? String(latestEod.trade_date).slice(0, 10) : null;
    const fresh = !!signalDate && (!latestEodDate || signalDate >= latestEodDate);
    return {
      code: etf.code,
      name: etf.name,
      signal_date: signalDate,
      latest_eod_date: latestEodDate,
      status: !signal ? '缺少信号' : (fresh ? '与最新收盘同步' : '等待最新收盘信号'),
      fresh,
      probability: signal && (signal.calibrated_probability != null ? signal.calibrated_probability : signal.ml_probability),
      permission: signal && (signal.rule_gate || signal.permission) || null,
      fast_path_candidate: !!(signal && (signal.fast_path_would_trigger || signal.would_trigger_fast_path))
    };
  }));
  return {
    model_id: p.ml_challenger_model_id || 'HVT-A-ET-20260830',
    frozen: p.ml_gen1_frozen !== false,
    advisory_enabled: p.ml_shadow_observe === true && p.ml_advisory_enabled === true,
    fast_path_enabled: p.ml_shadow_observe === true && p.ml_advisory_enabled === true && p.ml_fast_path_enabled === true,
    auto_trading: '关闭',
    today,
    rows
  };
}

/** Gen-2 Selection Shadow 只读观察（P1-2 消费闭环 + 工作包5）。
 *  消费者先选「同交易日最新 completed 运行」，再按其 run_id 读取 gen2_ranking，
 *  禁止按每只 ETF 最新日期拼接。Gen-2 仅有 selection_share / candidate_weight 观察权限，
 *  final_target_pct 由 V3.6.1 Safety Core 产出，本接口不读取、不合并。 */
async function getGen2SelectionShadow(query) {
  const tradeDate = query.date || query.trade_date || null;
  // 1) 选最新 completed 运行：优先指定日期，否则取最新 completed
  let runRows;
  if (tradeDate) {
    runRows = await db.query(COLLECTIONS.GEN2_SHADOW, { type: 'gen2_run', status: 'completed', run_date: tradeDate }, {
      orderBy: [{ field: 'created_at', direction: 'desc' }], limit: 1
    }).catch(() => []);
  } else {
    runRows = await db.query(COLLECTIONS.GEN2_SHADOW, { type: 'gen2_run', status: 'completed' }, {
      orderBy: [{ field: 'created_at', direction: 'desc' }], limit: 1
    }).catch(() => []);
  }
  const run = runRows[0] || null;
  if (!run) {
    return { run: null, rankings: [], selection: null };
  }
  // 2) 按 run_id 读该次完整横截面（不做按 code 最新拼接）
  const rankings = await db.query(COLLECTIONS.GEN2_SHADOW, { type: 'gen2_ranking', run_id: run.run_id }, {
    orderBy: [{ field: 'rank', direction: 'asc' }]
  }).catch(() => []);
  // 3) 观察字段分层：selection_share（池内相对份额）/ candidate_weight（影子权重 0-1）。
  //    final_target_pct 明确不在 Gen-2 权限内，此处不产出。
  const selection = {
    run_id: run.run_id,
    run_date: run.run_date,
    as_of_trade_date: run.as_of_trade_date,
    mode: run.mode || null,
    engine_id: run.engine_id || null,
    universe_version: run.universe_version || null,
    eligible_count: run.eligible_count ?? null,
    ranked_count: run.ranked_count ?? null,
    selection_confidence: run.selection_confidence || null,
    confidence_reason: run.confidence_reason || null,
    role_classification: run.role_classification || null,
    universe_coverage: run.universe_coverage || null,
    benchmark: run.benchmark || null,
    production_write: run.production_write === true,
    status: run.status,
  };
  const rows = (rankings || []).map((r) => ({
    code: r.code,
    name: r.name || '',
    correlation_cluster: r.correlation_cluster || '',
    rank: r.rank ?? null,
    alpha_score_v2: r.alpha_score_v2 ?? null,
    trend_gate: r.trend_gate === true,
    regime: r.regime || null,
    proposed_role: r.proposed_role || null,
    role: r.role || null,
    persistence_days: r.persistence_days ?? null,
    reason_codes: r.reason_codes || null,
    selection_share: r.target_weight ?? 0,   // 池内相对份额（观察字段）
    candidate_weight: r.target_weight ?? 0,  // 影子组合权重 0-1（观察字段）
    defense_state: r.defense_state || null,
  }));
  return { run, rankings: rows, selection };
}

/* ---------- 登录鉴权 ---------- */

const genToken = () => crypto.randomBytes(24).toString('hex');

function requestIp(event) {
  const rc = event && event.requestContext;
  const source = rc && ((rc.identity && rc.identity.sourceIp) || (rc.http && rc.http.sourceIp));
  if (source) return String(source).slice(0, 64);
  const headers = (event && event.headers) || {};
  const forwarded = Object.keys(headers).find((k) => k.toLowerCase() === 'x-forwarded-for');
  return forwarded ? String(headers[forwarded]).split(',')[0].trim().slice(0, 64) : 'unknown';
}

function ipGuardKey(ip) {
  return `admin_login_guard_ip_${crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 24)}`;
}

async function readLoginGuard(key = 'admin_login_guard') {
  const guard = await db.query(COLLECTIONS.PARAM_CONFIG, { key }, { limit: 1 });
  const row = guard.length ? guard[0] : null;
  const gv = row && row.value ? row.value.v : null;
  return { row, gv };
}

/** 登录失败累加（IP 独立退避；不再全局锁死管理员账号） */
async function bumpLoginFail(key, mode = 'ip') {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { row, gv: cur } = await readLoginGuard(key);
    const failCount = (cur && cur.fail_count) || 0;
    const newFail = failCount + 1;
    const lockMinutes = mode === 'ip'
      ? (newFail >= 20 ? 30 : (newFail >= 10 ? 5 : (newFail >= 5 ? 1 : 0)))
      : 0;
    const locked = lockMinutes > 0;
    const newGuard = {
      fail_count: newFail,
      locked_until: locked ? new Date(Date.now() + lockMinutes * 60000).toISOString() : null,
      last_fail_at: new Date().toISOString()
    };
    const prevVersion = row && row.version != null ? row.version : 0;
    const again = await readLoginGuard(key);
    if (again.row && again.row.version !== prevVersion) continue;
    await db.upsert(COLLECTIONS.PARAM_CONFIG,
      {
        key,
        value: { v: newGuard },
        version: prevVersion + 1,
        updated_at: new Date()
      },
      { key });
    return { locked, newFail, lockMinutes };
  }
  return { locked: mode === 'ip', newFail: 20, lockMinutes: mode === 'ip' ? 30 : 0 };
}

async function resetLoginGuard(key = 'admin_login_guard') {
  await db.upsert(COLLECTIONS.PARAM_CONFIG,
    { key, value: { v: { fail_count: 0, locked_until: null, last_fail_at: null } }, version: 1, updated_at: new Date() },
    { key });
}

async function savePasswordHash(password, prevVersion) {
  const hashed = hashPassword(password);
  await db.upsert(COLLECTIONS.PARAM_CONFIG,
    {
      key: 'admin_password',
      value: { v: hashed },
      version: (prevVersion || 0) + 1,
      updated_at: new Date()
    },
    { key: 'admin_password' });
}

/** 从请求头取 token（兼容 X-Admin-Token / Authorization Bearer） */
function getAdminToken(event) {
  const headers = event.headers || {};
  const raw = headers['x-admin-token'] || headers['authorization'] || '';
  return raw.replace(/^Bearer\s+/i, '');
}

/** 登录：IP 维度指数退避；账号只累加延迟状态，不再全局锁死。 */
async function login(payload, event) {
  const { password } = payload;
  if (!password) return fail('密码不能为空');

  const ipKey = ipGuardKey(requestIp(event));
  const { gv: ipGuard } = await readLoginGuard(ipKey);
  if (ipGuard && ipGuard.locked_until && new Date(ipGuard.locked_until).getTime() > Date.now()) {
    const remainMin = Math.ceil((new Date(ipGuard.locked_until).getTime() - Date.now()) / 60000);
    return fail(`当前来源尝试过多，请 ${remainMin} 分钟后再试`, 429);
  }

  const rows = await db.query(COLLECTIONS.PARAM_CONFIG, { key: 'admin_password' }, { limit: 1 });
  // 去掉 1234 兜底：密码未初始化时拒绝登录，提示先初始化（部署后必须手动设置密码）
  if (rows.length === 0 || !rows[0].value || !rows[0].value.v) {
    return fail('后台密码未初始化，请联系管理员先在 param_config 设置 admin_password', 403);
  }
  const saved = rows[0].value.v;
  const checked = verifyPassword(password, saved);
  if (!checked.ok) {
    const account = await bumpLoginFail('admin_login_guard', 'account');
    const ip = await bumpLoginFail(ipKey, 'ip');
    const retrySec = Math.min(60, Math.max(1, 2 ** Math.min(account.newFail - 1, 6)));
    if (ip.locked) return fail(`当前来源尝试过多，请 ${ip.lockMinutes} 分钟后再试`, 429);
    return fail(`密码错误，请 ${retrySec} 秒后重试`, 401);
  }

  if (checked.migrate) {
    await savePasswordHash(password, rows[0].version);
  }

  // 登录成功：重置失败计数，生成 24h 有效 token
  const token = genToken();
  const expAt = new Date(Date.now() + 24 * 3600 * 1000);
  await db.upsert(COLLECTIONS.PARAM_CONFIG,
    { key: 'admin_token', value: { v: token, exp: expAt }, version: 1, updated_at: new Date() },
    { key: 'admin_token' });
  await resetLoginGuard('admin_login_guard');
  await resetLoginGuard(ipKey);
  return ok({ token, expires_at: expAt.toISOString() });
}

/** 校验 token（返回布尔）：比对值 + 校验 24h 过期 */
async function verifyToken(token) {
  if (!token) return false;
  const rows = await db.query(COLLECTIONS.PARAM_CONFIG, { key: 'admin_token' }, { limit: 1 });
  const saved = rows.length && rows[0].value ? rows[0].value.v : '';
  if (!saved || saved !== token) return false;
  // TTL 校验：有 exp 字段且已过期 → 视为无效（提示重新登录）
  const exp = rows[0].value && rows[0].value.exp ? new Date(rows[0].value.exp).getTime() : null;
  if (exp && exp < Date.now()) return false;
  return true;
}

/** 修改密码（旧 token 失效，强制重登） */
async function changePassword(payload) {
  const { oldPassword, newPassword } = payload;
  if (!oldPassword || !newPassword) return fail('新旧密码必填');
  const rows = await db.query(COLLECTIONS.PARAM_CONFIG, { key: 'admin_password' }, { limit: 1 });
  if (rows.length === 0 || !rows[0].value || !rows[0].value.v) {
    return fail('后台密码未初始化，无法修改', 403);
  }
  const saved = rows[0].value.v;
  const checked = verifyPassword(oldPassword, saved);
  if (!checked.ok) return fail('原密码错误', 401);
  if (String(newPassword).length < 4) return fail('新密码至少 4 位');
  await savePasswordHash(newPassword, rows[0].version);
  await db.upsert(COLLECTIONS.PARAM_CONFIG,
    { key: 'admin_token', value: { v: '', exp: null }, updated_at: new Date() }, { key: 'admin_token' }); // 失效
  return ok({ changed: true });
}

/** 登出（失效 token） */
async function logout() {
  await db.upsert(COLLECTIONS.PARAM_CONFIG,
    { key: 'admin_token', value: { v: '', exp: null }, updated_at: new Date() }, { key: 'admin_token' });
  return ok({ loggedOut: true });
}

/* ---------- 基本面 ---------- */

async function getFundamentalConfig(code) {
  const rows = await db.query(COLLECTIONS.FUNDAMENTAL_CONFIG, { code }, {
    orderBy: [{ field: 'indicator', direction: 'asc' }]
  });
  return { code, configs: rows };
}

async function saveFundamentalConfig(payload) {
  const { code, configs } = payload;
  if (!code || !Array.isArray(configs)) return fail('参数错误：code/configs 必填');
  for (const cfg of configs) {
    if (!cfg.indicator) continue;
    await db.upsert(COLLECTIONS.FUNDAMENTAL_CONFIG, {
      code, indicator: cfg.indicator, name: cfg.name || '', weight: cfg.weight || 0,
      freq: cfg.freq || 'monthly', source: cfg.source || 'manual', unit: cfg.unit || '',
      metric_type: cfg.metric_type || 'quantitative',
      layer: cfg.layer || '',
      signal_invert: cfg.signal_invert === true
    }, { code, indicator: cfg.indicator });
  }
  return ok({ code, saved: configs.length });
}

async function addFundamentalData(payload) {
  const { code, indicator, value, source, confidence, data_date, unit, note } = payload;
  if (!code || !indicator || value == null || !source) return fail('参数错误：code/indicator/value/source 必填');
  let valueNum;
  let confidenceNum;
  try {
    valueNum = parseFiniteNumber(value, { name: 'value', min: -1e15, max: 1e15 });
    confidenceNum = parseFiniteNumber(confidence, { name: 'confidence', min: 0, max: 1 });
  } catch (e) { return fail(e.message, 400); }
  if (confidence == null) return fail('置信度 confidence 必填（0~1）', 400);
  if (data_date && !isDateStr(data_date)) return fail('data_date 须为 YYYY-MM-DD');

  // P2-1：schema 校验（类型 + 范围：confidence 0~1、value 数字）
  // 注：direction/prev 由后端自动计算，校验时跳过
  const doc = {
    code, indicator, data_date: data_date || beijingDateStr(), value: valueNum,
    source, confidence: confidenceNum, unit: unit || '', note: note || ''
  };
  const v = validateDoc(COLLECTIONS.FUNDAMENTAL_SERIES, doc, { skipRequired: true });
  if (!v.ok) return fail(`校验失败：${v.errors.join('；')}`);

  const prevRows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES, { code, indicator }, {
    orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 1
  });
  const prev = prevRows.length > 0 ? prevRows[0].value : null;
  let direction = 'na';
  if (prev != null && valueNum != null) {
    if (valueNum > prev) direction = 'up';
    else if (valueNum < prev) direction = 'down';
    else direction = 'flat';
  }

  doc.direction = direction;
  doc.prev = prev;
  const isVeto = source === 'manual_veto' || fund.isQualitative(code, indicator);
  if (isVeto && fund.isQualitative(code, indicator)) {
    const week = fund.weekDataDate();
    await db.upsert(COLLECTIONS.FUNDAMENTAL_EVIDENCE, {
      code, indicator, week_date: week, title: note || '人工否决',
      grade: valueNum, confidence: confidenceNum, source: 'manual_veto',
      reason: note || '人工否决', created_at: new Date()
    }, { code, indicator, week_date: week, title: note || '人工否决' });
    doc.data_date = week;
    doc.source = 'manual_veto';
    doc.unit = '级';
    doc.direction = 'na';
  }
  await db.upsert(COLLECTIONS.FUNDAMENTAL_SERIES, doc, { code, indicator, data_date: doc.data_date });

  return ok({ code, indicator, prev, direction: doc.direction, saved: true, veto: isVeto && fund.isQualitative(code, indicator) });
}

async function getFundamentalSeries(code, indicator) {
  const rows = await db.query(COLLECTIONS.FUNDAMENTAL_SERIES, { code, indicator }, {
    orderBy: [{ field: 'data_date', direction: 'desc' }], limit: 200
  });
  return { code, indicator, series: rows };
}

async function getEtfHoldings(code) {
  let rows = [];
  try {
    rows = await db.query(COLLECTIONS.ETF_HOLDINGS, { code }, { limit: 40 });
  } catch (e) { rows = []; }
  const latest = {};
  rows.forEach((r) => {
    if (!latest.report_date || r.report_date > latest.report_date) latest.report_date = r.report_date;
  });
  const holdings = rows.filter((r) => r.report_date === latest.report_date).sort((a, b) => a.rank - b.rank);
  return { code, report_date: latest.report_date || null, holdings };
}

/* ---------- 风险事件 ---------- */

async function postRisk(payload) {
  const { code, event_type, reason, risk_flag, risk_override, action } = payload;
  if (action === 'resolve') {
    // 解除：必须填解除理由
    if (!payload.resolve_reason && !reason) return fail('解除必须填写解除理由');
    const id = payload.event_id;
    if (!id) return fail('缺少 event_id');
    await db.updateById(COLLECTIONS.RISK_EVENTS, id, {
      status: 'resolved', resolve_time: new Date(), note: payload.resolve_reason || reason
    });
    // P2-2：联动重算失败落库（不静默吞错）
    try {
      await app.callFunction({ name: 'runDecisionEngine', data: { from: 'riskResolve' } });
    } catch (e) {
      await db.getCollection(COLLECTIONS.FETCH_LOG).add({
        source: 'admin_trigger', fetch_time: new Date(), status: 'fail',
        item_count: 0, error: String(e.message || e).slice(0, 200), task_name: 'runDecisionEngine(riskResolve)', duration_ms: 0
      }).catch(() => null);
    }
    return ok({ resolved: true });
  }

  // 触发
  if (!code || !event_type || !reason) return fail('参数错误：code/event_type/reason 必填');
  if (!isRiskEventTypeKey(event_type)) return fail('event_type 无效，须为 POLICY/TECH/DEMAND/STRUCTURE/FALSIFY/OTHER');
  const flag = normalizeRiskFlag(risk_flag, (String(event_type).toUpperCase() === 'FALSIFY' ? 'RED' : 'YELLOW'));
  const doc = {
    code,
    event_type: RISK_EVENT_TYPES[event_type] || event_type,
    risk_flag: flag,
    // 默认不强制减仓（override=false=提醒/暂停加仓）；仅证伪/政策熔断等强信号显式勾选强制减仓
    risk_override: risk_override === true,
    trigger_time: new Date(),
    resolve_time: null,
    status: 'active',
    reason,
    note: payload.note || ''
  };
  const res = await db.getCollection(COLLECTIONS.RISK_EVENTS).add(doc);

  // 联动重算
  let recomputed = null;
  try {
    recomputed = await app.callFunction({ name: 'runDecisionEngine', data: { from: 'riskTrigger' } });
  } catch (e) {
    recomputed = { error: String(e.message || e) };
  }

  return ok({ event_id: (res && res.id) || null, recomputed });
}

async function getRiskList() {
  const rows = await db.query(COLLECTIONS.RISK_EVENTS, {}, {
    orderBy: [{ field: 'trigger_time', direction: 'desc' }], limit: 200
  });
  return { list: rows };
}

/* ---------- 参数配置 ---------- */

async function getParams() {
  const rows = await db.query(COLLECTIONS.PARAM_CONFIG, {}, {
    orderBy: [{ field: 'key', direction: 'asc' }]
  });
  // 敏感凭据不下发：admin_password / admin_token 仅服务端内部使用
  return {
    list: rows
      .filter((r) => r.key !== 'admin_password' && r.key !== 'admin_token')
      .map((r) => ({ ...r, frozen: FROZEN_PARAM_KEYS.indexOf(r.key) >= 0 }))
  };
}

async function updateParam(payload) {
  const { key, value } = payload;
  if (!key || value == null) return fail('参数错误：key/value 必填');
  // 敏感凭据禁止直接改写（改密码走 changePassword，token 由登录/登出管理）
  if (key === 'admin_password' || key === 'admin_token') {
    return fail('敏感参数不允许直接修改，请使用修改密码功能', 403);
  }
  if (FROZEN_PARAM_KEYS.indexOf(key) >= 0) {
    return fail(`参数 ${key} 已冻结，禁止从后台改。解冻须改 constants.FROZEN_PARAM_KEYS`, 403);
  }

  // R3-6：关键阈值参数范围校验（百分比类 0~100、比率类 0~1、正整数类）
  // 命中规则的 key 才校验；未收录 key 不拦截（兼容自由参数）
  const rangeRules = {
    sideway_days: [0, 100], sideway_days_min: [0, 100], sideway_days_mature: [0, 100],
    sideway_range_base: [0, 100], sideway_range_max: [0, 100], sideway_range_hard_cap: [0, 100],
    ma20_slope_flat: [0, 100], trend_context_up: [-100, 100], trend_context_down: [-100, 100],
    tech_sector_max: [0, 100], single_etf_max: [0, 100],
    premium_qdii_light: [0, 100], premium_qdii_obvious: [0, 100], premium_qdii_extreme: [0, 100],
    premium_etf_light: [0, 100], premium_etf_obvious: [0, 100], premium_etf_extreme: [0, 100],
    bias_20d_hot: [0, 100], bias_20d_crowd: [0, 100],
    cooldown_days: [0, 365], add_breakout_max_pct: [0, 100],
    volume_ratio: [0, 1], volume_ratio_mild: [0, 1], volume_ratio_high: [0, 1], volume_ratio_extreme: [0, 1],
    stagnation_atr_ratio: [0, 1]
  };
  const rule = rangeRules[key];
  if (rule) {
    const num = Number(value);
    if (Number.isNaN(num)) return fail(`参数 ${key} 必须为数字`);
    if (num < rule[0] || num > rule[1]) {
      return fail(`参数 ${key} 超出范围（应为 ${rule[0]}~${rule[1]}）`);
    }
  }

  const rows = await db.query(COLLECTIONS.PARAM_CONFIG, { key }, { limit: 1 });
  let version;
  let prevValue = null;
  if (rows.length === 0) {
    version = 1;
    await db.getCollection(COLLECTIONS.PARAM_CONFIG).add({
      key, value: { v: value }, prev_value: null, version, updated_at: new Date()
    });
  } else {
    const old = rows[0];
    prevValue = old.value;
    version = (old.version || 0) + 1;
    await db.updateById(COLLECTIONS.PARAM_CONFIG, old._id, {
      value: { v: value }, prev_value: old.value, version, updated_at: new Date()
    });
  }

  // 联动重算
  let recomputed = null;
  try {
    recomputed = await app.callFunction({ name: 'runDecisionEngine', data: { from: 'paramChange' } });
  } catch (e) {
    recomputed = { error: String(e.message || e) };
  }

  return ok({ key, prev_value: prevValue, value: { v: value }, version, recomputed });
}

/* ---------- 操作记录 ---------- */

async function tradeCRUD(payload) {
  const action = payload._op || 'list';
  if (action === 'list') {
    const rows = await db.query(COLLECTIONS.TRADE_LOG, {}, {
      orderBy: [{ field: 'trade_date', direction: 'desc' }], limit: 200
    });
    return ok({ list: rows });
  }
  if (action === 'create') {
    const { trade_date, code, action: tradeAction, shares, price, amount, reason, decision_id, position_after, add_mode } = payload;
    if (!trade_date || !code || !tradeAction || shares == null || price == null) {
      return fail('参数错误：trade_date/code/action/shares/price 必填');
    }
    if (!isDateStr(trade_date)) return fail('trade_date 须为 YYYY-MM-DD', 400);
    if (!/^[0-9]{6}$/.test(String(code))) return fail('code 必须为 6 位 ETF 代码', 400);
    const etf = await db.getEtf(code);
    if (!etf || etf.status === 'disabled' || etf.enabled_for_api === false) return fail('ETF 不存在或未启用', 404);
    let sharesNum;
    let priceNum;
    let amountNum = null;
    let positionNum = null;
    try {
      sharesNum = parseFiniteNumber(shares, { name: 'shares', min: 0, max: 1e12 });
      priceNum = parseFiniteNumber(price, { name: 'price', min: Number.EPSILON, max: 1e9 });
      if (amount != null) amountNum = parseFiniteNumber(amount, { name: 'amount', min: 0, max: 1e15 });
      if (position_after != null) positionNum = parseFiniteNumber(position_after, { name: 'position_after', min: 0, max: 100 });
    } catch (e) { return fail(e.message, 400); }
    const fillAmt = amountNum != null ? amountNum : sharesNum * priceNum;
    const res = await db.getCollection(COLLECTIONS.TRADE_LOG).add({
      trade_date, code, action: tradeAction, shares: sharesNum, price: priceNum,
      amount: fillAmt,
      reason: reason || '', decision_id: decision_id || '', position_after: positionNum,
      add_mode: add_mode || ''
    });
    const cashDelta = cashDeltaFromTrade({ action: tradeAction, amount: fillAmt });
    // 仓位联动：手动 position_after 优先；分母一律用持股市值+现金
    let sync = null;
    if (position_after != null) {
      await syncPosition(code, position_after);
      sync = await autoSyncPosition(code, { cashDelta, skipPosition: true });
      sync = { ...(sync || {}), ok: true, manual: true, position: positionNum };
    } else {
      sync = await autoSyncPosition(code, { cashDelta });
    }
    if (sync && sync.ok && sync.position != null && position_after == null && res && res.id) {
      await db.updateById(COLLECTIONS.TRADE_LOG, res.id, { position_after: sync.position });
    }
    return ok({ id: (res && res.id) || null, created: true, sync });
  }
  if (action === 'update') {
    const id = payload._id;
    if (!id) return fail('缺少 _id');
    const old = await db.getById(COLLECTIONS.TRADE_LOG, id);
    if (!old) return fail('记录不存在', 404);
    const data = pickTradeUpdate(payload);
    if (!Object.keys(data).length) return fail('没有可更新的字段');
    try {
      if (data.trade_date != null && !isDateStr(data.trade_date)) throw new Error('trade_date 须为 YYYY-MM-DD');
      if (data.shares != null) data.shares = parseFiniteNumber(data.shares, { name: 'shares', min: 0, max: 1e12 });
      if (data.price != null) data.price = parseFiniteNumber(data.price, { name: 'price', min: Number.EPSILON, max: 1e9 });
      if (data.amount != null) data.amount = parseFiniteNumber(data.amount, { name: 'amount', min: 0, max: 1e15 });
      if (data.position_after != null) data.position_after = parseFiniteNumber(data.position_after, { name: 'position_after', min: 0, max: 100 });
      if (data.code != null) {
        if (!/^[0-9]{6}$/.test(String(data.code))) throw new Error('code 必须为 6 位 ETF 代码');
        const nextEtf = await db.getEtf(data.code);
        if (!nextEtf || nextEtf.status === 'disabled' || nextEtf.enabled_for_api === false) throw new Error('ETF 不存在或未启用');
      }
    } catch (e) { return fail(e.message, 400); }
    await db.updateById(COLLECTIONS.TRADE_LOG, id, data);
    const merged = Object.assign({}, old || {}, data);
    const cashDelta = cashDeltaFromTrade(merged) - cashDeltaFromTrade(old);
    let sync = null;
    const code = old.code;
    if (payload.position_after != null) {
      await syncPosition(code, payload.position_after);
      sync = await autoSyncPosition(code, { cashDelta, skipPosition: true });
      sync = { ...(sync || {}), ok: true, manual: true, position: Number(payload.position_after) };
    } else if (code) {
      sync = await autoSyncPosition(code, { cashDelta });
      if (sync && sync.ok && sync.position != null && payload.position_after == null) {
        await db.updateById(COLLECTIONS.TRADE_LOG, id, { position_after: sync.position });
      }
    }
    return ok({ updated: true, sync });
  }
  if (action === 'delete') {
    const id = payload._id;
    if (!id) return fail('缺少 _id');
    const old = await db.getById(COLLECTIONS.TRADE_LOG, id);
    await db.removeById(COLLECTIONS.TRADE_LOG, id);
    let sync = null;
    if (old && old.code) {
      sync = await autoSyncPosition(old.code, { cashDelta: -cashDeltaFromTrade(old) });
    }
    return ok({ deleted: true, sync });
  }
  return fail('未知 action');
}

/** 仓位联动：把 position_after 回写到 portfolio_position.current_position（upsert，仅更新该字段） */
async function syncPosition(code, positionAfter) {
  if (!code || positionAfter == null || Number.isNaN(Number(positionAfter))) return;
  await db.upsert(COLLECTIONS.PORTFOLIO_POSITION,
    { code, current_position: Number(positionAfter), updated_at: new Date() },
    { code });
}

async function latestClose(code) {
  const daily = await db.query(COLLECTIONS.ETF_DAILY, { code }, {
    orderBy: [{ field: 'trade_date', direction: 'desc' }], limit: 1
  });
  return daily.length > 0 ? Number(daily[0].close) : null;
}

async function loadLiveHoldings() {
  const raw = await db.query(COLLECTIONS.TRADE_LOG, {}, {
    orderBy: [{ field: 'trade_date', direction: 'asc' }]
  }).catch(() => []);
  const holdings = replayAverageCost(raw || []);
  const prices = {};
  const codes = Object.keys(holdings);
  await Promise.all(codes.map(async (c) => {
    if (!holdings[c] || holdings[c].shares <= 0) return;
    prices[c] = await latestClose(c);
  }));
  const mv = holdingsMarketValue(holdings, prices);
  return { holdings, prices, mv };
}

async function persistLiveSnapshot(book) {
  const snapshotDate = beijingDateStr();
  const existRows = await db.query(COLLECTIONS.PORTFOLIO_SNAPSHOT, { snapshot_date: snapshotDate }, { limit: 1 });
  const exist = existRows.length > 0 ? existRows[0] : null;
  let prev = exist;
  if (!prev) {
    const snaps = await db.query(COLLECTIONS.PORTFOLIO_SNAPSHOT, {}, {
      orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 1
    });
    prev = snaps.length ? snaps[0] : null;
  }
  const keep = (key) => (exist && exist[key] != null ? exist[key] : (prev && prev[key] != null ? prev[key] : null));
  const liveBook = book.liveRefresh && book.bookPct ? book.bookPct : null;
  let bookPct = liveBook;
  if (!bookPct) {
    try {
      const etfs = await db.getEtfList();
      const positions = await db.query(COLLECTIONS.PORTFOLIO_POSITION, {});
      bookPct = bookFromPositions(etfs, positions);
    } catch (e) {
      bookPct = null;
    }
  }
  const pickBook = (key, fallbackKey) => {
    if (liveBook && liveBook[key] != null) return liveBook[key];
    const kept = keep(fallbackKey || key);
    if (kept != null) return kept;
    return bookPct && bookPct[key] != null ? bookPct[key] : null;
  };
  await db.upsert(COLLECTIONS.PORTFOLIO_SNAPSHOT, {
    snapshot_date: snapshotDate,
    total_asset: book.totalAsset,
    cash_balance: book.cashYuan,
    holdings_mv: book.holdingsMv,
    asset_source: 'live',
    total_pnl: keep('total_pnl'),
    auto_pnl: keep('auto_pnl'),
    tech_position: pickBook('tech_position'),
    gold_position: pickBook('gold_position'),
    semi_position: keep('semi_position'),
    drug_position: pickBook('drug_position'),
    cash_ratio: pickBook('cash_ratio'),
    strategic_cash: keep('strategic_cash'),
    deployable_cash: keep('deployable_cash'),
    market_regime: keep('market_regime'),
    positions: (exist && exist.positions) || (prev && prev.positions) || [],
    updated_at: new Date()
  }, { snapshot_date: snapshotDate });
}

/** 按活分母重算全部持仓%；skipCode 为手动录入仓位%、不覆盖该票。 */
async function syncAllLivePositions(mv, totalAsset, skipCode) {
  const synced = [];
  for (const code of Object.keys(mv.per || {})) {
    if (skipCode && code === skipCode) continue;
    const row = mv.per[code];
    const pos = positionPct(row.value, totalAsset);
    if (pos == null) continue;
    await db.upsert(COLLECTIONS.PORTFOLIO_POSITION,
      { code, current_position: pos, shares: row.shares, updated_at: new Date() },
      { code });
    synced.push({ code, current_position: pos, shares: row.shares });
  }
  return synced;
}

/**
 * 自动算仓：持仓份数 × 最新价 ÷（全市场值 + 现金）。
 * 现金粘在元上，本笔成交用 cashDelta 计入。skipPosition 时保留该票手动%，其余票仍按活分母重算%。
 */
async function autoSyncPosition(code, opts) {
  const cashDelta = opts && opts.cashDelta != null ? Number(opts.cashDelta) : 0;
  const skipPosition = !!(opts && opts.skipPosition);
  if (!code) return { ok: false, error: '缺少代码' };

  const { holdings, prices, mv } = await loadLiveHoldings();
  const h = holdings[code];
  const shares = h ? Math.round(Math.max(0, h.shares) * 100) / 100 : 0;
  if (!skipPosition && shares <= 0 && !h && !cashDelta) {
    return { ok: false, error: '该 ETF 暂无操作记录，自动算仓未生效（保留原仓位）' };
  }

  let price = prices[code];
  if (price == null || !(price > 0)) price = await latestClose(code);
  if (!skipPosition && shares > 0 && (price == null || price <= 0)) {
    return { ok: false, error: '暂无该 ETF 最新价，无法自动算仓' };
  }

  const snaps = await db.query(COLLECTIONS.PORTFOLIO_SNAPSHOT, {}, {
    orderBy: [{ field: 'snapshot_date', direction: 'desc' }], limit: 30
  });
  const lastWithCash = snaps.find((s) => s.cash_balance != null && !Number.isNaN(Number(s.cash_balance)));
  const lastWithAsset = snaps.find((s) => s.total_asset != null && Number(s.total_asset) > 0);
  if (!lastWithCash && !lastWithAsset) {
    return { ok: false, error: '未录入总资金，无法自动算仓（请先在后台录总资金，或手动填操作后仓位%）' };
  }
  const seedSnap = lastWithCash || lastWithAsset;
  const cashYuan = resolveCashYuan({
    cashBalance: lastWithCash ? lastWithCash.cash_balance : seedSnap.cash_balance,
    seedTotalAsset: lastWithAsset ? lastWithAsset.total_asset : seedSnap.total_asset,
    lastHoldingsMv: snapshotHoldingsMv(seedSnap),
    currentHoldingsMv: mv.total,
    cashDelta
  });
  const totalAsset = liveTotalAsset(mv.total, cashYuan);
  if (totalAsset == null || totalAsset <= 0) {
    return { ok: false, error: '无法计算活分母（持股市值+现金）' };
  }

  const skipCode = skipPosition ? code : null;
  const synced = await syncAllLivePositions(mv, totalAsset, skipCode);

  let position;
  if (!skipPosition) {
    const row = mv.per[code] || { shares, price, value: shares * (price > 0 ? price : 0) };
    position = positionPct(row.value, totalAsset);
    if (position != null) {
      await db.upsert(COLLECTIONS.PORTFOLIO_POSITION,
        { code, current_position: position, shares: row.shares, updated_at: new Date() },
        { code });
    }
  } else {
    const rows = await db.query(COLLECTIONS.PORTFOLIO_POSITION, { code }, { limit: 1 });
    position = rows.length ? rows[0].current_position : undefined;
  }

  let bookPct = null;
  try {
    const etfs = await db.getEtfList();
    const positions = await db.query(COLLECTIONS.PORTFOLIO_POSITION, {});
    bookPct = bookFromPositions(etfs, positions);
  } catch (e) {
    bookPct = null;
  }
  await persistLiveSnapshot({
    totalAsset, cashYuan, holdingsMv: mv.total, bookPct, liveRefresh: !!bookPct
  });

  const row = mv.per[code] || { shares, price, value: shares * (price > 0 ? price : 0) };
  return {
    ok: true,
    shares: row.shares,
    price: row.price || price,
    market_value: Math.round(row.value),
    position: skipPosition ? position : position,
    synced_count: synced.length,
    total_asset: totalAsset,
    cash_balance: cashYuan,
    holdings_mv: mv.total
  };
}

/* ---------- 数据管理 ---------- */

async function triggerFetch(payload) {
  const task = payload.task || 'fetchDailyData';
  // 任务名 → 云函数映射（日线/实时/新闻财报搜集/LLM 提取）
  const nameMap = {
    realtime: 'fetchRealtimeData',
    daily: 'fetchDailyData',
    fetchDailyData: 'fetchDailyData',
    news: 'fetchFundamentalNews',
    extract: 'extractFundamental'
  };
  const name = nameMap[task] || 'fetchDailyData';
  app.callFunction({ name, data: { force: true, task_name: task } }).catch(async (e) => {
    console.error(`[triggerFetch] ${name} failed`, e);
    try {
      await db.getCollection(COLLECTIONS.FETCH_LOG).add({
        source: 'admin_trigger', fetch_time: new Date(), status: 'fail',
        item_count: 0, error: String(e.message || e).slice(0, 200),
        task_name: `triggerFetch:${name}`, duration_ms: 0
      });
    } catch (logErr) { console.error('[triggerFetch] fetch_log failed', logErr); }
  });
  return ok({ task: name, triggered: true, message: '已触发。新闻搜集约 5～8 分钟，不要连点；等日志里 fundamental_news 变成 success/partial、并出现 etf_holdings 再提取' });
}

async function getFetchLog(from, to) {
  const rows = await db.query(COLLECTIONS.FETCH_LOG, {}, {
    orderBy: [{ field: 'fetch_time', direction: 'desc' }], limit: 200
  });
  const filtered = rows.filter((r) => {
    const t = r.fetch_time instanceof Date ? r.fetch_time.toISOString().slice(0, 10) : String(r.fetch_time || '').slice(0, 10);
    if (from && t < from) return false;
    if (to && t > to) return false;
    return true;
  });
  return { list: filtered };
}

/* ---------- 组合快照（手动维护总资产/浮盈） ---------- */

async function savePortfolioSnapshot(payload) {
  const { total_asset, total_pnl } = payload;
  if (total_asset == null && total_pnl == null) return fail('参数错误：total_asset/total_pnl 至少传一个');
  let totalAssetNum = null;
  let totalPnlNum = null;
  try {
    if (total_asset != null) totalAssetNum = parseFiniteNumber(total_asset, { name: 'total_asset', min: Number.EPSILON, max: 1e15 });
    if (total_pnl != null) totalPnlNum = parseFiniteNumber(total_pnl, { name: 'total_pnl', min: -1e15, max: 1e15 });
  } catch (e) { return fail(e.message, 400); }
  const snapshotDate = beijingDateStr();
  const existRows = await db.query(COLLECTIONS.PORTFOLIO_SNAPSHOT, { snapshot_date: snapshotDate }, { limit: 1 });
  const exist = existRows.length > 0 ? existRows[0] : null;
  const positions = await db.query(COLLECTIONS.PORTFOLIO_POSITION, {});
  const etfs = await db.getEtfList().catch(() => []);
  const bookPct = bookFromPositions(etfs, positions);
  let cashBalance = exist && exist.cash_balance != null ? exist.cash_balance : null;
  let holdingsMv = exist && exist.holdings_mv != null ? exist.holdings_mv : null;
  let assetSource = exist && exist.asset_source ? exist.asset_source : 'manual';
  let resolvedAsset = totalAssetNum != null ? totalAssetNum : (exist && exist.total_asset != null ? exist.total_asset : null);
  let autoPnl = exist && exist.auto_pnl != null ? exist.auto_pnl : null;
  if (totalAssetNum != null) {
    try {
      const live = await loadLiveHoldings();
      holdingsMv = live.mv.total != null ? live.mv.total : 0;
      autoPnl = unrealizedPnl(live.holdings, live.prices);
    } catch (e) {
      holdingsMv = holdingsMv != null ? holdingsMv : 0;
    }
    cashBalance = roundMoney(totalAssetNum - Number(holdingsMv || 0));
    resolvedAsset = totalAssetNum;
    assetSource = 'manual';
  }
  const resolvedPnl = totalPnlNum != null ? totalPnlNum
    : (exist && exist.total_pnl != null ? exist.total_pnl : autoPnl);
  await db.upsert(COLLECTIONS.PORTFOLIO_SNAPSHOT, {
    snapshot_date: snapshotDate,
    total_asset: resolvedAsset,
    cash_balance: cashBalance,
    holdings_mv: holdingsMv,
    asset_source: assetSource,
    total_pnl: resolvedPnl,
    auto_pnl: autoPnl,
    tech_position: bookPct.tech_position,
    gold_position: bookPct.gold_position,
    drug_position: bookPct.drug_position,
    cash_ratio: bookPct.cash_ratio,
    positions: positions.map((p) => ({ code: p.code, position: p.current_position || 0 })),
    updated_at: new Date()
  }, { snapshot_date: snapshotDate });
  return ok({ snapshot_date: snapshotDate, saved: true, cash_balance: cashBalance, holdings_mv: holdingsMv });
}

/* ---------- 路由 ---------- */

exports.main = async (event = {}, context = {}) => {
  const method = (event.httpMethod || event.method || 'GET').toUpperCase();
  let path = event.path || event.url || '/';
  // 剥掉 HTTP 网关路径前缀（兼容 /apiGateway 或 /adminGateway 前缀透传）
  path = path.replace(/^\/(apiGateway|adminGateway)/, '') || '/';
  // S-003 修复（2026-08-22）：写接口仅允许 POST——防 GET 带 body 触发写操作/缓存污染（GLM 深审）。
  // 注意：仅列「纯写」路径；fundamental/config、param、trade 为同路径双方法（GET 读 + POST 写），
  // 不得列入（否则会挡住前端正常的 GET 读取——此前误伤后台多个页面）。
  // V3.1 A6：只列真实存在的纯写路径。禁止再写 fetch/trigger、portfolio/position、fundamental/state。
  const POST_ONLY = new Set([
    '/api/admin/changePassword', '/api/admin/logout',
    '/api/admin/fundamental/data', '/api/admin/risk',
    '/api/admin/portfolio/snapshot', '/api/admin/fetch', '/api/admin/intel/refresh'
  ]);
  if (POST_ONLY.has(path) && method !== 'POST') {
    return fail(`接口 ${path} 仅支持 POST`, 405);
  }
  const query = event.queryStringParameters || event.query || {};
  const body = (() => {
    if (!event.body) return {};
    if (typeof event.body === 'string') { try { return JSON.parse(event.body); } catch (e) { return {}; } }
    return event.body;
  })();
  // S-004 修复（2026-08-22）：body 必须是普通对象——防数组/原始类型伪装成查询条件触发 NoSQL 注入面（GLM 深审）
  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    return fail('请求体格式错误：需为 JSON 对象', 400);
  }

  try {
    // POST /api/admin/login —— 登录无需鉴权
    if (path === '/api/admin/login') return login(body, event);

    // 其余 /api/admin/* 统一校验 token（含 changePassword / logout 及所有读写接口）
    if (path.startsWith('/api/admin/')) {
      const okToken = await verifyToken(getAdminToken(event));
      if (!okToken) return fail('未登录或登录已过期', 401);
    }

    // POST /api/admin/changePassword
    if (path === '/api/admin/changePassword') return changePassword(body);
    // POST /api/admin/logout
    if (path === '/api/admin/logout') return logout();

    // GET/POST /api/admin/fundamental/config
    if (path === '/api/admin/fundamental/config') {
      return method === 'POST' ? saveFundamentalConfig(body) : ok(await getFundamentalConfig(query.code || body.code || ''));
    }
    // POST /api/admin/fundamental/data
    if (path === '/api/admin/fundamental/data') return addFundamentalData(body);
    // GET /api/admin/fundamental/series
    if (path === '/api/admin/fundamental/series') return ok(await getFundamentalSeries(query.code || body.code, query.indicator || body.indicator));
    if (path === '/api/admin/fundamental/holdings') return ok(await getEtfHoldings(query.code || body.code || ''));
    // POST /api/admin/risk
    if (path === '/api/admin/risk') return postRisk(body);
    // GET /api/admin/risk/list
    if (path === '/api/admin/risk/list') return ok(await getRiskList());
    // GET/POST /api/admin/param
    if (path === '/api/admin/param') {
      return method === 'POST' ? updateParam(body) : ok(await getParams());
    }
    // GET /api/admin/gen1/health
    if (path === '/api/admin/gen1/health') return ok(await getGen1Health());
    // GET /api/admin/gen2/shadow（只读 Selection Shadow 观察）
    if (path === '/api/admin/gen2/shadow') return ok(await getGen2SelectionShadow(query));
    // POST /api/admin/portfolio/snapshot
    if (path === '/api/admin/portfolio/snapshot') return savePortfolioSnapshot(body);
    // GET/POST /api/admin/trade
    if (path === '/api/admin/trade') {
      return method === 'POST' ? tradeCRUD(body) : ok((await tradeCRUD({ action: 'list' })).data);
    }
    // POST /api/admin/fetch
    if (path === '/api/admin/fetch') return triggerFetch(body);
    // POST /api/admin/intel/refresh（原前台匿名接口迁入后台）
    if (path === '/api/admin/intel/refresh') return ok(await triggerIntelRefresh());
    // GET /api/admin/fetchlog
    if (path === '/api/admin/fetchlog') {
      if (query.from && !isDateStr(query.from)) return fail('from 须为 YYYY-MM-DD');
      if (query.to && !isDateStr(query.to)) return fail('to 须为 YYYY-MM-DD');
      return ok(await getFetchLog(query.from, query.to));
    }

    return fail(`未匹配路由: ${method} ${path}`, 404);
  } catch (e) {
    return safeErrorResponse(e, requestId(event), 500);
  }
};
