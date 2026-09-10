/**
 * Gen-1 Authority 状态机（WP-G1 / G1-01）。
 *
 * 设计目标：把 Gen-1 的权限从「一堆 boolean」收敛为单一、显式、fail-closed 的状态机，
 * 并且把「配置层可调开关」（ml_fast_path_enabled）与「生产写权限」彻底解耦。
 *
 *   OFF        不生成有效 Gen-1 建议，纯 V3.6.1
 *   SHADOW     生成概率，不显示主建议，不影响任何 Target
 *   ADVISORY   生成 Timing 建议，人工可见，不影响 final_target  ← 第一版默认
 *   CANARY     允许生成 Safety-Clamped Canary Target，但仍不覆盖生产 final_target
 *   PRODUCTION 枚举存在，但永久 BLOCKED（本工作包不得启用）
 *
 * 不变量（hard boundary，任何调用方都不能绕过）：
 *   - production_write === false 恒真（Gen-1 永不写 final_target）
 *   - auto_execution  === false 恒真（不接券商/自动下单）
 *   - authority === PRODUCTION 时自动降级为 ADVISORY 并标记 production_blocked
 *
 * 纯函数、无副作用、无 DB / 无 require 循环：便于 Node 单测与 CI。
 *
 * @module gen1-authority
 */
'use strict';

const AUTHORITY = Object.freeze({
  OFF: 'OFF',
  SHADOW: 'SHADOW',
  ADVISORY: 'ADVISORY',
  CANARY: 'CANARY',
  PRODUCTION: 'PRODUCTION'
});

/** 权限强弱排序；数值越大权限越高。PRODUCTION 保留枚举但不允许被授予。 */
const AUTHORITY_RANK = Object.freeze({
  OFF: 0,
  SHADOW: 1,
  ADVISORY: 2,
  CANARY: 3,
  PRODUCTION: 4
});

const DEFAULT_AUTHORITY = AUTHORITY.ADVISORY;
const PRODUCTION_LOCKED = true;

/** 状态中文文案（后端 / 前端显示统一从这里取，避免各说一套）。 */
const AUTHORITY_LABEL = Object.freeze({
  OFF: '已关闭',
  SHADOW: '影子观察',
  ADVISORY: '人工建议',
  CANARY: '灰度反事实',
  PRODUCTION: '生产（永久锁定）'
});

function isKnownAuthority(value) {
  const v = String(value || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(AUTHORITY_RANK, v);
}

function rankOf(authority) {
  const v = String(authority || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(AUTHORITY_RANK, v) ? AUTHORITY_RANK[v] : -1;
}

/**
 * 解析 Gen-1 权限状态（fail-closed）。
 *
 * @param {object} params 运行时参数（param_config 合并结果）
 * @returns {{
 *   gen1_authority: string, requested: string|null, downgraded: boolean,
 *   production_blocked: boolean, production_write: boolean, auto_execution: boolean,
 *   observe_enabled: boolean, config_fast_path_enabled: boolean,
 *   label: string, reason: string
 * }}
 */
function resolveAuthority(params) {
  const p = params || {};
  const requestedRaw = p.gen1_authority;
  const requested = requestedRaw == null ? null : String(requestedRaw).toUpperCase();
  const observeEnabled = p.ml_shadow_observe === true;

  let authority = isKnownAuthority(requested) ? requested : DEFAULT_AUTHORITY;
  const reasons = [];

  // 1) 观察总闸关闭 → 无条件 OFF
  if (!observeEnabled) {
    authority = AUTHORITY.OFF;
    reasons.push('ml_shadow_observe=false → OFF');
  }

  // 2) PRODUCTION 永久锁定：请求 PRODUCTION 一律降级为 ADVISORY
  let downgraded = false;
  if (authority === AUTHORITY.PRODUCTION) {
    authority = AUTHORITY.ADVISORY;
    downgraded = true;
    reasons.push('PRODUCTION 永久锁定 → 降级 ADVISORY');
  }

  // 3) 未知取值 → 默认 ADVISORY（绝不因非法输入获得更高权限）
  if (requested && !isKnownAuthority(requested)) {
    reasons.push(`未知 gen1_authority='${requested}' → 默认 ${DEFAULT_AUTHORITY}`);
  }

  // 4) 人工建议总闸关闭：ADVISORY 及以上不可用 → 降级 SHADOW（若观察仍开）
  const advisoryGateOff = p.ml_advisory_enabled === false;
  if (advisoryGateOff && rankOf(authority) >= AUTHORITY_RANK.ADVISORY) {
    authority = observeEnabled ? AUTHORITY.SHADOW : AUTHORITY.OFF;
    reasons.push('ml_advisory_enabled=false → 降级 SHADOW');
  }

  return {
    gen1_authority: authority,
    requested: requested || null,
    downgraded,
    production_blocked: PRODUCTION_LOCKED,
    // 两个恒真硬边界：不随任何入参 / 数据库状态变化
    production_write: false,
    auto_execution: false,
    observe_enabled: observeEnabled,
    // 配置层开关仅作展示/审计，不代表获授生产权限
    config_fast_path_enabled: p.ml_fast_path_enabled === true,
    label: AUTHORITY_LABEL[authority] || authority,
    reason: reasons.length ? reasons.join('; ') : '按请求状态授予'
  };
}

/**
 * 能力查询：当前 authority 是否允许某项能力。
 *   'SHADOW_OBSERVE'     生成概率（SHADOW 及以上）
 *   'ADVISORY'           生成人工可见建议（ADVISORY 及以上）
 *   'CANARY_OVERRIDE'    生成 canary 反事实 target（CANARY 及以上）
 *   'PRODUCTION_WRITE'   永远 false（非 PRODUCTION 或 PRODUCTION 锁定）
 */
function authorityAllows(authority, capability) {
  const need = {
    SHADOW_OBSERVE: AUTHORITY_RANK.SHADOW,
    ADVISORY: AUTHORITY_RANK.ADVISORY,
    CANARY_OVERRIDE: AUTHORITY_RANK.CANARY,
    PRODUCTION_WRITE: AUTHORITY_RANK.PRODUCTION
  }[String(capability || '').toUpperCase()];
  if (need == null) return false;
  if (String(capability || '').toUpperCase() === 'PRODUCTION_WRITE') return false; // 永久关闭
  if (need === AUTHORITY_RANK.PRODUCTION) return false;
  return rankOf(authority) >= need;
}

/** 对外 API / runtime_status 用的稳定片段。 */
function authorityForApi(params) {
  const r = resolveAuthority(params);
  return {
    gen1_authority: r.gen1_authority,
    gen1_authority_label: r.label,
    production_write: false,
    auto_execution: false
  };
}

module.exports = {
  AUTHORITY,
  AUTHORITY_RANK,
  AUTHORITY_LABEL,
  DEFAULT_AUTHORITY,
  PRODUCTION_LOCKED,
  isKnownAuthority,
  rankOf,
  resolveAuthority,
  authorityAllows,
  authorityForApi
};
