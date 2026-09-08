/**
 * ETF Profile（V3 融合版 seed · 回测实验层）
 * 生产接入前对应 etf_basic 字段：profile_type / trend_sensitivity / defense_speed / max_position
 */
'use strict';

const DEFAULT_PROFILE = {
  profile_type: 'trend_driven',
  max_position_pct: 30,
  stage_sensitivity: 1.0,
  defense_speed: 0.8,
  shock_threshold: 2.5
};

/** 五票 seed（融合版 §2.9 / v1.1 §A9 stage_sensitivity） */
const ETF_PROFILES = {
  '513310': { profile_type: 'trend_driven', max_position_pct: 30, stage_sensitivity: 1.0, defense_speed: 0.8 },
  '159582': { profile_type: 'trend_driven', max_position_pct: 25, stage_sensitivity: 1.0, defense_speed: 0.9 },
  '515880': { profile_type: 'trend_driven', max_position_pct: 30, stage_sensitivity: 1.1, defense_speed: 1.0 },
  '159570': { profile_type: 'trend_driven', max_position_pct: 25, stage_sensitivity: 0.9, defense_speed: 0.7 },
  '518880': {
    profile_type: 'macro_driven',
    max_position_pct: 20,
    stage_sensitivity: 0.8,
    defense_speed: 0.5,
    add_threshold_pct: 2
  }
};

function getEtfProfile(codeOrEtf) {
  const code = typeof codeOrEtf === 'string' ? codeOrEtf : (codeOrEtf && codeOrEtf.code);
  return { ...DEFAULT_PROFILE, ...(ETF_PROFILES[code] || {}) };
}

function isMacroDriven(profile) {
  return profile && profile.profile_type === 'macro_driven';
}

/** @deprecated v1.1 禁止乘 SF；保留兼容 macro 路径，trend_driven 不再调用 */
function adjustStageFactor(sf, profile) {
  if (!profile) return sf;
  if (profile.profile_type === 'macro_driven') {
    const ss = profile.stage_sensitivity != null ? profile.stage_sensitivity : 0.8;
    return Math.min(1, sf + (1 - sf) * (1 - ss) * 0.65);
  }
  return sf;
}

/** defense_speed 决定是否允许战术/战略减仓 */
function shouldTacticalReduce(profile) {
  const ds = profile && profile.defense_speed != null ? profile.defense_speed : 0.8;
  return ds >= 0.85;
}

function shouldStrategicReduce(profile) {
  const ds = profile && profile.defense_speed != null ? profile.defense_speed : 0.8;
  return ds >= 0.55;
}

function profileMaxPosition(defaultMax, profile) {
  if (!profile || profile.max_position_pct == null) return defaultMax;
  return Math.min(defaultMax, profile.max_position_pct);
}

function addThresholdPct(profile, defaultPct) {
  if (!profile || profile.add_threshold_pct == null) return defaultPct;
  return profile.add_threshold_pct;
}

module.exports = {
  DEFAULT_PROFILE,
  ETF_PROFILES,
  getEtfProfile,
  isMacroDriven,
  adjustStageFactor,
  shouldTacticalReduce,
  shouldStrategicReduce,
  profileMaxPosition,
  addThresholdPct
};
