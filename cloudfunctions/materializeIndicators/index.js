/**
 * 云函数：materializeIndicators —— 物化周线 + 指标快照
 * 触发：链式（fetchDailyData 完成后）+ 定时 dailyPipeline-0800 兜底
 * 流程：读 etf_daily + param_config → indicators.computeSnapshot → 写 etf_weekly + indicator_snapshot
 *       → 链式 runDecisionEngine
 */

'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const db = require('./common/utils/db');
const indicators = require('./common/utils/indicators');
const { COLLECTIONS, DEFAULT_PARAMS } = require('./common/constants');
// V3.6.5 (B1 / P-4)：pipeline correlation 契约（**纯函数**；不改控制流、不加 retry、不改 timeout）
const pipelineCorrelation = require('./common/utils/pipeline-correlation.js');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

/** 合并运行时参数（param_config 覆盖默认值） */
function mergeParams(params) {
  const merged = { ...DEFAULT_PARAMS };
  Object.keys(params || {}).forEach((k) => { merged[k] = params[k]; });
  if (params && params.opportunity_weights) merged.opportunity_weights = params.opportunity_weights;
  return merged;
}

/** 读取某 ETF 的日线（升序，过滤无 close 的记录） */
async function getDailyBars(code) {
  const rows = await db.query(COLLECTIONS.ETF_DAILY, { code }, {
    orderBy: [{ field: 'trade_date', direction: 'asc' }]
  });
  return rows.filter((r) => r.close != null && !Number.isNaN(r.close));
}

/** 物化单只 ETF 的周线（P2-3：增量写入——最近 4 周全量刷新，历史周线仅补缺失，避免每次全量重写） */
async function materializeWeekly(code, dailyBars, params) {
  const weeklyBars = indicators.buildWeekly(dailyBars);
  const withInd = indicators.calcWeeklyIndicators(weeklyBars);

  // 查询已有周线（增量依据：历史周线数据固定，只有最近几周可能变化）
  // P1-3 修复（2026-08-22）：按 week_end_date 升序排序，确保 lastConfirmedState 是真正最新一根
  // （原查询无 orderBy，db 返回顺序不保证，防抖可能读到旧周状态）
  const existingRows = await db.query(COLLECTIONS.ETF_WEEKLY, { code }, {
    projection: { week_end_date: 1, w_state: 1 }, limit: 500,
    orderBy: [{ field: 'week_end_date', direction: 'asc' }]
  }).catch(() => []);
  const existingDates = new Set(existingRows.map((r) => r.week_end_date));
  // 上一根已确认的周线状态（用于最新周防抖）
  const lastConfirmedState = existingRows.length ? existingRows[existingRows.length - 1].w_state : null;

  let written = 0;
  for (let i = 0; i < withInd.length; i++) {
    const w = withInd[i];
    // 最近 4 周始终刷新（buildWeekly 短周合并可能改变最近周线）；更早的仅补缺失
    const isRecent = i >= withInd.length - 4;
    if (!isRecent && existingDates.has(w.week_end_date)) continue;
    // 每根周线用截至当周的数据独立计算 w_state（避免用当前 wState 覆盖全部历史）
    let weekWState = indicators.detectWState(withInd.slice(0, i + 1), params).state;
    // P2 W 状态确认期（防边界抖动）：最新一根周线需连续 2 根同状态才确认切换，
    // 否则沿用上一根已确认状态——避免「差一周数据结论就翻」（claude/grok 回测诊断）
    if (i === withInd.length - 1 && lastConfirmedState && lastConfirmedState !== weekWState) {
      const prevRaw = withInd.length >= 2
        ? indicators.detectWState(withInd.slice(0, withInd.length - 1), params).state
        : null;
      if (prevRaw !== weekWState) {
        weekWState = lastConfirmedState; // 未连续确认 → 保持原状态
      }
    }
    await db.upsert(COLLECTIONS.ETF_WEEKLY, {
      code,
      week_end_date: w.week_end_date,
      open: w.open, high: w.high, low: w.low, close: w.close, volume: w.volume,
      ma20w: w.ma20w, ma60w: w.ma60w,
      ma20w_slope: w.ma20w_slope, ma60w_slope: w.ma60w_slope,
      w_state: weekWState
    }, { code, week_end_date: w.week_end_date });
    written += 1;
  }
  return written;
}

exports.main = async (event = {}, context = {}) => {
  const startedAt = Date.now();
  try {
    // 1. 参数（含版本号）
    const { params, version } = await db.getParamConfig();
    const merged = mergeParams(params);

    // 2. ETF 列表
    const etfs = await db.getEtfList();
    const results = [];

    for (const etf of etfs) {
      try {
        const dailyBars = await getDailyBars(etf.code);
        if (dailyBars.length < 20) {
          results.push({ code: etf.code, ok: false, reason: '日线不足 20 根' });
          continue;
        }

        const latest = dailyBars[dailyBars.length - 1];
        const snapshot = indicators.computeSnapshot(dailyBars, merged, {
          code: etf.code,
          calc_date: latest.trade_date,
          premium_rate: latest.premium_rate != null ? latest.premium_rate : null,
          version
        });

        await db.upsert(COLLECTIONS.INDICATOR_SNAPSHOT, snapshot, { code: etf.code, calc_date: snapshot.calc_date });

        const weeklyWritten = await materializeWeekly(etf.code, dailyBars, merged);

        results.push({
          code: etf.code,
          ok: true,
          calc_date: snapshot.calc_date,
          data_complete: snapshot.data_complete,
          w_state: snapshot.w_state,
          weekly_written: weeklyWritten
        });
      } catch (e) {
        results.push({ code: etf.code, ok: false, error: String(e.message || e) });
      }
    }

    // 3. 链式调用 runDecisionEngine
    // ---- V3.6.5 (B1 / P-4)：pipeline correlation 生成 + 透传（**纯 additive**）----
    // 边界（任务书 §4/§8/§16）：
    //   ✅ 只新增 pipeline_run_id 的生成 / 透传 / transport 状态记录
    //   ✅ `chained.error` 语义逐字保留（caller timeout 时仍保留原错误串）
    //   ⛔ 未新增 retry；⛔ 未修改 timeout；⛔ 未改变 callFunction 顺序；
    //   ⛔ 未改动 indicator contract；⛔ 未恢复 breakout_nd。
    const okCodes = results.filter((r) => r.ok === true).map((r) => String(r.code));
    const observedDates = results
      .filter((r) => r.ok === true && r.calc_date)
      .map((r) => String(r.calc_date)).sort();
    const identityDate = observedDates.length ? observedDates[observedDates.length - 1] : 'UNKNOWN_DATE';
    const pipelineIdentity = pipelineCorrelation.buildPipelineIdentity({
      expected_trade_date: identityDate,
      origin: pipelineCorrelation.ORIGIN.TIMER,
      entry_function: 'materializeIndicators',
      source_detail: 'materialize',
      attempt: 1
    });
    const pendingCall = pipelineCorrelation.buildCallRecord({
      identity: pipelineIdentity,
      origin: pipelineCorrelation.ORIGIN.TIMER,
      entry_function: 'materializeIndicators',
      caller_function: 'materializeIndicators',
      callee_function: 'runDecisionEngine',
      expected_trade_date: identityDate,
      started_at: new Date(startedAt).toISOString()
    });

    let chained = null;
    let transportStatus;
    try {
      chained = await app.callFunction({
        name: 'runDecisionEngine',
        // ⚠️ `from` 字段语义**逐字保留**（既有下游/日志依赖）；pipeline_* 为新增透传字段。
        data: pipelineCorrelation.buildForwardPayload({
          identity: pipelineIdentity,
          caller_function: 'materializeIndicators',
          origin: pipelineCorrelation.ORIGIN.TIMER,
          entry_function: 'materializeIndicators',
          expected_trade_date: identityDate
        })
      });
      transportStatus = pipelineCorrelation.TRANSPORT_STATUS.CALL_RETURNED;
    } catch (e) {
      // ⚠️ 保留原 `error` 字段（既有语义）；transport 状态**另行**结构化记录。
      chained = { error: String(e.message || e) };
      transportStatus = pipelineCorrelation.classifyTransportFailure
        ? pipelineCorrelation.classifyTransportFailure(String(e.message || e))
        : pipelineCorrelation.TRANSPORT_STATUS.CALL_ERROR;
    }

    // transport 与 business **分开**记录（⛔ 不得由 transport 反推 business）
    const settled = pipelineCorrelation.settleTransport(pendingCall, {
      transport_status: transportStatus,
      completed_at: new Date().toISOString(),
      error_code: chained && chained.error ? 'CHAINED_CALL_FAILED' : null,
      error_message: chained && chained.error ? String(chained.error) : null
    });
    // 下游自证（best-effort）：只在**已成功返回**且下游确实回传了同一 pipeline_run_id 时建立关联。
    // timeout 场景下 caller 拿不到它 ⇒ business_status 保持 NOT_OBSERVED，后续按 pipeline_run_id 回查。
    const calleePipelineRunId = (chained && chained.pipeline && chained.pipeline.pipeline_run_id)
      ? String(chained.pipeline.pipeline_run_id) : null;

    return {
      ok: true, version, duration_ms: Date.now() - startedAt, results, chained,
      pipeline: {
        pipeline_run_id: pipelineIdentity.pipeline_run_id,
        pipeline_attempt: pipelineIdentity.attempt,
        identity_date_basis: 'observed_calc_date（⚠️ 仅作**身份成分**；⛔ 不作 expected_trade_date 权威）',
        identity_date_observed: identityDate,
        ok_codes: okCodes,
        transport_status: settled.transport_status,
        business_status: calleePipelineRunId
          ? ((chained && chained.ok === true) ? pipelineCorrelation.BUSINESS_STATUS.COMPLETE
            : pipelineCorrelation.BUSINESS_STATUS.RUNNING)
          : pipelineCorrelation.BUSINESS_STATUS.NOT_OBSERVED,
        callee_pipeline_run_id: calleePipelineRunId,
        obs_001_shape: calleePipelineRunId
          ? pipelineCorrelation.isObs001Shape(pipelineCorrelation.reconcile({
            callRecord: settled,
            businessObservation: {
              pipeline_run_id: calleePipelineRunId,
              business_status: (chained && chained.ok === true)
                ? pipelineCorrelation.BUSINESS_STATUS.COMPLETE
                : pipelineCorrelation.BUSINESS_STATUS.RUNNING
            }
          })) === true
          : false
      }
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
};
