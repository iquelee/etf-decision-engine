/**
 * 云函数：runIntegratedShadowEod —— Integrated Shadow 集成反事实引擎（WP7）
 *
 * 职责（只读反事实，绝不写生产）：
 *   1. 读 Gen-2 Selection（最新 completed gen2_run + 其完整 ranking，按 run_id 读，禁止按 code 拼接）；
 *   2. 读 Gen-1 Timing（ml_shadow_signal，source_trade_date 必须与 Gen-2 as_of 一致，否则 STALE）；
 *   3. 读 V3.6.1 Safety Core（decision_result 生产历史基线 + param_config 单只/科技 cap）；
 *   4. 四层权限模型产出 Integrated Proposal（仍只用于 Counterfactual）；
 *   5. 写 integrated_shadow_run / integrated_shadow_result，production_write=false，auto_execution=false。
 *
 * 权限边界（Engine Authority Matrix，任务书 §25）：
 *   - Gen-2 = Selection Permission（选池/角色/替换提案，仅观察）
 *   - Gen-1 = Timing Proposal（择时解锁，NO_SIGNAL / OBSERVE / ADVISORY）
 *   - V3.6.1 = Safety Core（baseline_target / single_etf_cap / tech_cap / defense gate）
 *   - Integrated Proposal 只是三层组合的反事实，不注入 final_target / final_action。
 *
 * 与 runDecisionEngine 完全隔离：本函数不调用 runDecisionEngine、不写 decision_result、
 * 不写 portfolio_position / portfolio_snapshot，仅产生 integrated_shadow_* 观测数据。
 */

'use strict';

const crypto = require('crypto');
const db = require('./common/utils/db');
const { COLLECTIONS, DEFAULT_PARAMS, TECH_SECTORS } = require('./common/constants');

// 生产追踪的主 5 只（Gen-1 择时 + V3.6.1 基线只覆盖这 5 只；Gen-2 选池覆盖 30 只）
const MAIN5 = ['513310', '515880', '159582', '518880', '159570'];
const MAIN5_SECTORS = {
  513310: 'storage', 515880: 'ai_network', 159582: 'semi_equip', 518880: 'gold', 159570: 'biotech'
};

// Gen-1 择时解锁时，Gen-2 选中 CORE 的上调步长（pct）。
// 这是 Integrated Shadow 的「反事实结构参数」，不是生产参数，也不调 Gen-2 alpha 权重；
// 数值仅为反事实组合结构的占位，最终由 WP9 回测 Economic Gate 评估其增量，不据此进入生产。
const ADVISORY_INCREMENT_PCT = 5.0;

/** 数字归一化（pct，0-100），非有限/缺失返回 null */
function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** 取日期 YYYY-MM-DD 前缀 */
function dateKey(d) { return String(d == null ? '' : d).slice(0, 10); }
/** 四舍五入到 dp 位 */
function rnd(v, dp = 1) { return v == null ? null : Math.round(v * (10 ** dp)) / (10 ** dp); }

/* ============================================================
 * 四层权限模型（纯函数，供测试 _internal 调用）
 * ============================================================ */

/**
 * 逐只 ETF 计算集成反事实建议。
 *
 * @param {Array} ranking   gen2_ranking 行（按 run_id 读的完整横截面）
 * @param {Object} gen1ByCode  ml_shadow_signal 映射 code → signal
 * @param {Object} decisionByCode  decision_result 映射 code → 生产决策（V3.6.1 历史基线）
 * @param {Object} caps   { single_etf_max, tech_sector_max }
 * @returns {Array} 每只 result 行（含 explain_chain）
 */
function computeIntegrated(ranking, gen1ByCode, decisionByCode, caps) {
  const singleCap = num(caps.single_etf_max) != null ? num(caps.single_etf_max) : 30;
  const techCap = num(caps.tech_sector_max) != null ? num(caps.tech_sector_max) : 65;

  // 先算「未过单只 cap 的 proposed」，再在组合层对 Main5 tech 三只做聚合 cap
  const pre = ranking.map((r) => {
    const code = r.code;
    const isMain5 = MAIN5.indexOf(code) >= 0;
    const gen1 = gen1ByCode[code] || null;
    const dec = decisionByCode[code] || null;

    const gen2_role = r.role || 'RESERVE';
    const gen2_rank = num(r.rank);
    const gen2_alpha = num(r.alpha_score_v2);
    const gen2_selection_share = num(r.target_weight);   // 池内影子组合权重（0-1）
    const gen2_candidate_weight = num(r.target_weight);

    const baseline = isMain5 && dec ? num(dec.final_target) : (isMain5 ? 0 : null);
    const v361_action = dec ? (dec.final_action || null) : null;
    const v361_stage = dec ? (dec.stage || dec.trend_stage || dec.stage_summary || null) : null;

    const timing_unlock = isMain5 && gen1 ? (gen1.advisory_effective === true) : null;
    const gen1_signal = gen1 ? (gen1.signal_status || null) : null;
    const gen1_rule_gate = gen1 ? (gen1.rule_gate || null) : null;
    const gen1_probability = gen1 ? num(gen1.ml_probability) : null;

    // —— Layer 1 Gen-2 Selection：方向性意图（raw，未含择时否决）——
    let selection_effect = null;   // pct，相对 baseline
    if (isMain5) {
      if (gen2_role === 'CORE') selection_effect = +ADVISORY_INCREMENT_PCT;
      else if (gen2_role === 'RESERVE') selection_effect = -baseline;   // 未选中 → 清出（反事实）
      else selection_effect = 0;   // CHALLENGER / SATELLITE / HEDGE → 维持 baseline
    }

    // —— Layer 2 Gen-1 Timing：择时未解锁 → 否决 Selection 的正向上调 ——
    let timing_effect = 0;
    let timing_blocked = false;
    if (isMain5 && selection_effect != null && selection_effect > 0 && timing_unlock === false) {
      timing_effect = -selection_effect;
      timing_blocked = true;
    }

    const proposed = (isMain5 && baseline != null)
      ? Math.max(0, baseline + selection_effect + timing_effect)
      : null;

    // —— Layer 3 V3.6.1 Safety：单只 cap（组合层 tech cap 在主流程聚合）——
    let clamped = proposed;
    let safety_effect = 0;
    let single_cap_bound = false;
    if (isMain5 && clamped != null) {
      const c = Math.min(clamped, singleCap);
      safety_effect = rnd(c - clamped);
      single_cap_bound = c !== clamped;
      clamped = c;
    }

    const difference_vs_production = (isMain5 && clamped != null && baseline != null)
      ? rnd(clamped - baseline) : null;

    return {
      code,
      integration_scope: isMain5 ? 'FULL' : 'SELECTION_ONLY',
      sector: MAIN5_SECTORS[code] || null,
      is_tech: MAIN5_SECTORS[code] ? TECH_SECTORS.indexOf(MAIN5_SECTORS[code]) >= 0 : false,
      gen2_role, gen2_rank, gen2_alpha, gen2_selection_share, gen2_candidate_weight,
      gen1_signal, gen1_rule_gate, gen1_probability, timing_unlock, timing_blocked,
      v361_action, v361_stage, baseline,
      selection_effect: rnd(selection_effect), timing_effect: rnd(timing_effect),
      proposed: rnd(proposed), clamped: rnd(clamped), safety_effect,
      single_cap_bound, difference_vs_production
    };
  });

  // 组合层 tech cap：Main5 tech 三只 clamped 之和超过 techCap 时，按比例缩到 cap（只缩科技，不动非科技）
  let techScaled = false;
  const techRows = pre.filter((r) => r.integration_scope === 'FULL' && r.is_tech && r.clamped != null);
  const techTotal = techRows.reduce((s, r) => s + (r.clamped || 0), 0);
  if (techTotal > techCap && techRows.length) {
    const k = techCap / techTotal;
    for (const r of techRows) {
      r.clamped = rnd(r.clamped * k);
      r.difference_vs_production = r.baseline != null ? rnd(r.clamped - r.baseline) : null;
      r.tech_cap_bound = true;
    }
    techScaled = true;
  }

  // 派生动作（clamped vs baseline 的 gap，反事实建议；safety_clamped_action 为最终）
  for (const r of pre) {
    if (r.integration_scope !== 'FULL' || r.clamped == null || r.baseline == null) {
      r.integrated_proposed_action = null;
      r.safety_clamped_action = null;
      r.explain_chain = [{ layer: 'Gen-2 Selection', rank: r.gen2_rank, role: r.gen2_role, selection_share: r.gen2_selection_share }];
      continue;
    }
    const delta = r.clamped - r.baseline;
    let proposedAction;
    if (r.clamped <= 0 && r.baseline > 0) proposedAction = 'EXIT';          // 反事实清仓
    else if (delta > 0) proposedAction = 'ADD';                             // 反事实加仓
    else if (delta < 0) proposedAction = 'TACTICAL_REDUCE';                 // 反事实减仓
    else proposedAction = 'HOLD';                                           // 维持

    r.integrated_proposed_action = proposedAction;
    r.safety_clamped_action = proposedAction;  // 单只 cap / tech cap 后的最终反事实动作

    r.binding_constraints = [];
    if (r.timing_blocked) r.binding_constraints.push({ name: 'timing_unlock', bound: false, note: 'Gen-1 未解锁，否决 Selection 上调' });
    if (r.single_cap_bound) r.binding_constraints.push({ name: 'single_etf_cap', value: singleCap });
    if (r.tech_cap_bound) r.binding_constraints.push({ name: 'tech_sector_cap', value: techCap });

    r.explain_chain = [
      { layer: 'Gen-2 Selection', rank: r.gen2_rank, role: r.gen2_role, selection_share: r.gen2_selection_share },
      { layer: 'Gen-1 Timing', signal: r.gen1_signal, advisory: r.timing_unlock === true ? 'PERMIT' : (r.timing_unlock === false ? 'BLOCK' : 'N/A') },
      { layer: 'V3.6.1 Baseline', target: r.baseline, action: r.v361_action, stage: r.v361_stage },
      { layer: 'Integrated Proposal', target: r.proposed },
      { layer: 'Safety Clamp', single_cap: singleCap, tech_cap: techCap },
      { layer: 'Final Shadow', target: r.clamped, difference_vs_production: r.difference_vs_production }
    ];
  }

  return { rows: pre, tech_scaled: techScaled };
}

/* ============================================================
 * 依赖门（dependency gate，任务书 §15）
 * ============================================================ */

/**
 * 读取锚定交易日 + 三个输入源，返回 gate 判定结果。
 * 锚定 = 最新 completed gen2_run 的 as_of_trade_date（或 event.gen2_run_id 指定）。
 */
async function loadInputs(event) {
  const anchors = [];

  // 1) Gen-2：选最新 completed run（或指定 run_id）
  let gen2Run = null;
  if (event.gen2_run_id) {
    const rows = await db.query(COLLECTIONS.GEN2_SHADOW, { type: 'gen2_run', run_id: event.gen2_run_id }, { limit: 1 });
    gen2Run = rows[0] || null;
    if (gen2Run && gen2Run.status !== 'completed') gen2Run = null; // 非 completed 不可消费
  } else {
    const rows = await db.query(COLLECTIONS.GEN2_SHADOW, { type: 'gen2_run', status: 'completed' }, {
      orderBy: [{ field: 'created_at', direction: 'desc' }], limit: 1
    });
    gen2Run = rows[0] || null;
  }
  if (!gen2Run) {
    return { gate: 'GEN2_NOT_READY', detail: '无 status=completed 的 Gen-2 运行，阻断 Integrated Shadow' };
  }
  const anchor = dateKey(gen2Run.as_of_trade_date || gen2Run.run_date);
  const gen2Ranking = await db.query(COLLECTIONS.GEN2_SHADOW, { type: 'gen2_ranking', run_id: gen2Run.run_id }, {
    orderBy: [{ field: 'rank', direction: 'asc' }]
  });
  anchors.push({ source: 'gen2', trade_date: anchor, count: gen2Ranking.length });

  // 2) V3.6.1：decision_result 对齐 anchor（生产历史基线）
  const decisionByCode = {};
  const decRows = await db.query(COLLECTIONS.DECISION_RESULT, { decision_date: anchor });
  if (!decRows.length) {
    const latestDec = await db.query(COLLECTIONS.DECISION_RESULT, {}, {
      orderBy: [{ field: 'decision_date', direction: 'desc' }], limit: 1
    });
    if (latestDec.length) {
      return { gate: 'TRADE_DATE_MISMATCH', detail: `V3.6.1 基线停在 ${dateKey(latestDec[0].decision_date)}，落后于 Gen-2 锚定日 ${anchor}` };
    }
    return { gate: 'V361_NOT_READY', detail: `decision_result 无 ${anchor} 记录（V3.6.1 基线未就绪）` };
  }
  decRows.forEach((r) => { decisionByCode[r.code] = r; });
  anchors.push({ source: 'v361', trade_date: anchor, count: decRows.length });

  // 3) Gen-1：ml_shadow_signal 对齐 anchor（择时信号；Gen-1 只覆盖 Main5）
  const gen1ByCode = {};
  const gen1Rows = await db.query(COLLECTIONS.ML_SHADOW_SIGNAL, { source_trade_date: anchor });
  if (!gen1Rows.length) {
    const latestGen1 = await db.query(COLLECTIONS.ML_SHADOW_SIGNAL, {}, {
      orderBy: [{ field: 'source_trade_date', direction: 'desc' }], limit: 1
    });
    if (latestGen1.length) {
      return { gate: 'TRADE_DATE_MISMATCH', detail: `Gen-1 择时停在 ${dateKey(latestGen1[0].source_trade_date)}，落后于锚定日 ${anchor}` };
    }
    return { gate: 'GEN1_NOT_READY', detail: `ml_shadow_signal 无 ${anchor} 记录（Gen-1 择时未就绪）` };
  }
  gen1Rows.forEach((r) => { gen1ByCode[r.code] = r; });
  anchors.push({ source: 'gen1', trade_date: anchor, count: gen1Rows.length });

  return { gate: 'READY', anchor, gen2Run, gen2Ranking, gen1ByCode, decisionByCode, anchors };
}

/* ============================================================
 * 主流程
 * ============================================================ */

// 跨语言/单元测试入口：暴露纯函数，不改生产行为
exports._internal = {
  MAIN5,
  MAIN5_SECTORS,
  ADVISORY_INCREMENT_PCT,
  computeIntegrated,
  loadInputs
};

exports.main = async (event = {}, context = {}) => {
  const startedAt = Date.now();
  const runId = `integrated-${Date.now()}`;
  try {
    const inputs = await loadInputs(event || {});

    // 依赖门失败：写 failed run（不产出 completed 结果快照）
    if (inputs.gate !== 'READY') {
      await db.upsert(COLLECTIONS.INTEGRATED_SHADOW_RUN, {
        run_id: runId,
        status: 'failed',
        dependency_gate: inputs.gate,
        detail: inputs.detail,
        production_write: false,
        auto_execution: false,
        created_at: new Date().toISOString()
      }, { run_id: runId });
      return { ok: false, error: inputs.detail, dependency_gate: inputs.gate, run_id: runId };
    }

    const { anchor, gen2Run, gen2Ranking, gen1ByCode, decisionByCode } = inputs;

    // 安全 cap 单一真相源：param_config 合并 DEFAULT_PARAMS（与 runDecisionEngine 同源）
    let caps = { single_etf_max: DEFAULT_PARAMS.single_etf_max, tech_sector_max: DEFAULT_PARAMS.tech_sector_max };
    try {
      const { params } = await db.getParamConfig();
      const merged = { ...DEFAULT_PARAMS, ...(params || {}) };
      caps = { single_etf_max: merged.single_etf_max, tech_sector_max: merged.tech_sector_max };
    } catch (e) { /* param_config 读取失败用默认 */ }

    // 运行时引擎版本标签（V3.6.1 权威源 runtime_status，兜底硬编码）
    let v361EngineVersion = 'v3.6.1';
    try {
      const rs = await db.query(COLLECTIONS.RUNTIME_STATUS, { key: 'runtime-status' }, { limit: 1 });
      if (rs.length && rs[0].production_engine) v361EngineVersion = String(rs[0].production_engine);
    } catch (e) { /* 忽略 */ }

    const { rows, tech_scaled } = computeIntegrated(gen2Ranking, gen1ByCode, decisionByCode, caps);

    const fullCount = rows.filter((r) => r.integration_scope === 'FULL').length;
    const selectionOnlyCount = rows.filter((r) => r.integration_scope === 'SELECTION_ONLY').length;

    // 写 run 元数据（先 running，全部 result 写完后置 completed）
    const runDoc = {
      run_id: runId,
      run_date: anchor,
      as_of_trade_date: anchor,
      mode: event.mode === 'REPLAY' ? 'REPLAY' : 'LIVE',
      status: 'running',
      gen2_run_id: gen2Run.run_id,
      gen2_engine_id: gen2Run.engine_id || null,
      gen2_bundle_version: gen2Run.bundle_version || null,
      gen2_bundle_sha256: gen2Run.bundle_sha256 || null,
      gen1_model_id: gen1RowsModelId(gen1ByCode),
      v361_engine_version: v361EngineVersion,
      dependency_gates: [{ gate: 'READY' }],
      counts: { total: rows.length, full_integration: fullCount, selection_only: selectionOnlyCount },
      tech_cap_applied: tech_scaled,
      single_etf_cap: num(caps.single_etf_max),
      tech_sector_cap: num(caps.tech_sector_max),
      production_write: false,
      auto_execution: false,
      created_at: new Date().toISOString()
    };
    await db.upsert(COLLECTIONS.INTEGRATED_SHADOW_RUN, runDoc, { run_id: runId });

    // 写 result（每只一行；run_id + code 唯一）
    let written = 0;
    for (const r of rows) {
      const doc = {
        run_id: runId,
        trade_date: anchor,
        code: r.code,
        gen2_run_id: gen2Run.run_id,
        gen2_engine_id: gen2Run.engine_id || null,
        gen2_bundle_sha256: gen2Run.bundle_sha256 || null,
        gen2_rank: r.gen2_rank,
        gen2_alpha_score: r.gen2_alpha,
        gen2_role: r.gen2_role,
        gen2_selection_share: r.gen2_selection_share,
        gen2_candidate_weight: r.gen2_candidate_weight,
        gen1_model_id: gen1ByCode[r.code] ? (gen1ByCode[r.code].model_id || null) : null,
        gen1_signal: r.gen1_signal,
        gen1_probability: r.gen1_probability,
        gen1_rule_gate: r.gen1_rule_gate,
        gen1_advisory_effective: r.timing_unlock,
        v361_engine_version: v361EngineVersion,
        v361_stage: r.v361_stage,
        v361_action: r.v361_action,
        v361_baseline_target: r.baseline,
        integrated_proposed_action: r.integrated_proposed_action,
        integrated_proposed_target: r.proposed,
        safety_clamped_target: r.clamped,
        safety_clamped_action: r.safety_clamped_action,
        binding_constraints: r.binding_constraints || null,
        selection_effect: r.selection_effect,
        timing_effect: r.timing_effect,
        safety_effect: r.safety_effect,
        difference_vs_production: r.difference_vs_production,
        explain_chain: r.explain_chain,
        integration_scope: r.integration_scope,
        production_write: false,
        auto_execution: false,
        created_at: new Date().toISOString()
      };
      await db.upsert(COLLECTIONS.INTEGRATED_SHADOW_RESULT, doc, { run_id: runId, code: r.code });
      written += 1;
    }

    // 发布 completed
    await db.upsert(COLLECTIONS.INTEGRATED_SHADOW_RUN, {
      ...runDoc, status: 'completed', written, completed_at: new Date().toISOString()
    }, { run_id: runId });

    return {
      ok: true,
      run_id: runId,
      run_date: anchor,
      as_of_trade_date: anchor,
      mode: runDoc.mode,
      status: 'completed',
      gen2_run_id: gen2Run.run_id,
      gen2_engine_id: gen2Run.engine_id || null,
      gen2_bundle_sha256: gen2Run.bundle_sha256 || null,
      v361_engine_version: v361EngineVersion,
      counts: runDoc.counts,
      written,
      production_write: false,
      auto_execution: false,
      duration_ms: Date.now() - startedAt
    };
  } catch (e) {
    const errMsg = String(e && e.message ? e.message : e);
    try {
      await db.upsert(COLLECTIONS.INTEGRATED_SHADOW_RUN, {
        run_id: runId, status: 'failed', error: errMsg.slice(0, 300),
        production_write: false, auto_execution: false, created_at: new Date().toISOString()
      }, { run_id: runId });
    } catch (e2) { /* 忽略错误落库失败 */ }
    return { ok: false, error: errMsg, run_id: runId };
  }
};

/** 从 gen1 信号映射取 model_id（Gen-1 全 5 只同模型） */
function gen1RowsModelId(gen1ByCode) {
  for (const code of Object.keys(gen1ByCode || {})) {
    if (gen1ByCode[code].model_id) return gen1ByCode[code].model_id;
  }
  return null;
}
