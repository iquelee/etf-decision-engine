/**
 * Gen-1 Runtime Circuit Breaker（WP-G1 / G1-07）。
 *
 * 把「健康度」从 Markdown / 离线 summary 升级为**运行时门**：
 *
 *   OK       正常：允许 Advisory + Canary
 *   WARNING  允许 Advisory + Canary，显示警告
 *   DEGRADED 允许概率观察，**禁止 Canary**
 *   ML_OFF   禁用 Gen-1 Timing，立即回退纯 V3.6.1（无需部署代码，只改运行时健康状态）
 *
 * 关键约束：
 *   - 健康状态由**独立健康计算**产出（本模块），模型自身不得修改；
 *   - 从 DEGRADED / ML_OFF 恢复必须 **manual review**，禁止 auto reopen。
 *
 * @module gen1-circuit-breaker
 */
'use strict';

const HEALTH = Object.freeze({ OK: 'OK', WARNING: 'WARNING', DEGRADED: 'DEGRADED', ML_OFF: 'ML_OFF' });

const HEALTH_RANK = Object.freeze({ OK: 0, WARNING: 1, DEGRADED: 2, ML_OFF: 3 });

const HEALTH_LABEL = Object.freeze({
  OK: '正常',
  WARNING: '警告',
  DEGRADED: '降级（禁止灰度）',
  ML_OFF: 'Gen-1 已停用（纯 V3.6.1）'
});

/** 上一次健康状态（仅测试辅助；**不得用于生产 latch**）。
 * G1.1-03：生产 latch 必须是持久化的 —— 见 gen1-health-state.js（CloudBase 冷启动会清空进程内变量）。 */
let _lastHealth = null;

function worst(a, b) {
  return HEALTH_RANK[a] >= HEALTH_RANK[b] ? a : b;
}

/**
 * 由独立健康指标计算 gen1_health_status。
 *
 * @param {object} m
 * @param {number} [m.incrementalAlpha]   增量 alpha（可为负）
 * @param {number} [m.falseFastPathRate]  假启动率（0–1）
 * @param {number} [m.calibrationDrift]   校准漂移（0–1）
 * @param {string} [m.signalQuality]      'OK' | 'WEAK' | 'BROKEN'
 * @param {string} [m.dataHealth]         'OK' | 'DEGRADED' | 'BLOCKED'
 * @param {string} [m.economicHealth]     G1.1-04 经济健康：'PENDING' | 'OK' | 'WARNING' | 'DEGRADED' | 'ML_OFF'
 *                                        （PENDING = 样本不足，**不参与**判定，绝不视为 OK）
 * @param {boolean} [m.killSwitch]        人工总闸（ML_OFF）
 * @returns {string} HEALTH
 */
function computeHealthStatus(m) {
  const x = m || {};
  let status = HEALTH.OK;

  if (x.killSwitch === true) return HEALTH.ML_OFF;

  if (x.signalQuality === 'BROKEN') status = worst(status, HEALTH.ML_OFF);
  else if (x.signalQuality === 'WEAK') status = worst(status, HEALTH.WARNING);

  if (x.dataHealth === 'BLOCKED') status = worst(status, HEALTH.ML_OFF);
  else if (x.dataHealth === 'DEGRADED') status = worst(status, HEALTH.DEGRADED);

  // G1.1-04：经济健康（PENDING 不参与，避免「样本不足」被误当正常或异常）
  if (x.economicHealth === 'ML_OFF') status = worst(status, HEALTH.ML_OFF);
  else if (x.economicHealth === 'DEGRADED') status = worst(status, HEALTH.DEGRADED);
  else if (x.economicHealth === 'WARNING') status = worst(status, HEALTH.WARNING);

  if (typeof x.incrementalAlpha === 'number' && x.incrementalAlpha < 0) status = worst(status, HEALTH.DEGRADED);
  if (typeof x.falseFastPathRate === 'number' && x.falseFastPathRate > 0.5) status = worst(status, HEALTH.DEGRADED);
  else if (typeof x.falseFastPathRate === 'number' && x.falseFastPathRate > 0.35) status = worst(status, HEALTH.WARNING);
  if (typeof x.calibrationDrift === 'number' && x.calibrationDrift > 0.5) status = worst(status, HEALTH.DEGRADED);
  else if (typeof x.calibrationDrift === 'number' && x.calibrationDrift > 0.3) status = worst(status, HEALTH.WARNING);

  return status;
}

/**
 * 由健康状态推导运行时门。
 *
 * @param {string} health
 * @returns {{allow_advisory, allow_canary, allow_gen1_timing, immediate_fallback_v361, requires_manual_review_to_restore, label}}
 */
function circuitGate(health) {
  const h = HEALTH_RANK.hasOwnProperty(health) ? health : HEALTH.ML_OFF;
  let allowAdvisory = true;
  let allowCanary = true;
  let allowTiming = true;
  let fallback = false;

  if (h === HEALTH.WARNING) {
    // 允许 + 警告
  } else if (h === HEALTH.DEGRADED) {
    allowCanary = false;
  } else if (h === HEALTH.ML_OFF) {
    allowAdvisory = false;
    allowCanary = false;
    allowTiming = false;
    fallback = true;
  }

  return {
    health: h,
    label: HEALTH_LABEL[h],
    allow_advisory: allowAdvisory,
    allow_canary: allowCanary,
    allow_gen1_timing: allowTiming,
    immediate_fallback_v361: fallback,
    requires_manual_review_to_restore: (h === HEALTH.DEGRADED || h === HEALTH.ML_OFF)
  };
}

/**
 * ⚠️ DEPRECATED（G1.1-03）：进程内 latch 在 CloudBase Serverless 冷启动后失效，
 * **不得用于生产**。生产请使用 `gen1-health-state.js` 的 `computeLatchedState`（持久化）。
 * 保留此函数仅为历史单测与本地调试。
 * @returns {{accepted: boolean, status: string, reason: string}}
 */
function applyHealthWithRecovery(health, manualReviewConfirmed) {
  const h = HEALTH_RANK.hasOwnProperty(health) ? health : HEALTH.ML_OFF;
  const prev = _lastHealth;
  const wasDown = prev === HEALTH.DEGRADED || prev === HEALTH.ML_OFF;
  const nowUp = h === HEALTH.OK || h === HEALTH.WARNING;
  if (wasDown && nowUp && manualReviewConfirmed !== true) {
    return {
      accepted: false,
      status: prev,
      reason: `从 ${prev} 恢复到 ${h} 需要人工复核确认（禁止 auto reopen）`
    };
  }
  _lastHealth = h;
  return { accepted: true, status: h, reason: 'ok' };
}

/** 测试用：重置内部状态。 */
function _resetBreakerState() {
  _lastHealth = null;
}

module.exports = {
  HEALTH,
  HEALTH_LABEL,
  HEALTH_RANK,
  computeHealthStatus,
  circuitGate,
  applyHealthWithRecovery,
  _resetBreakerState
};
