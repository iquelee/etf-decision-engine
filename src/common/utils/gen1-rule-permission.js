/**
 * Gen-1 Fast Path rule permission（兼容薄适配层）。
 *
 * 自 WP-G1（G1-02）起，权限的**唯一实现**在 `gen1-safety-permission.js`：
 * 它把 EOD 预检（EOD_STAGE_PRECHECK）与 Safety Core（SAFETY_CORE）明确拆开。
 *
 * 本文件保留旧函数签名（历史调用方/测试兼容），但内部委托给统一实现，
 * 避免出现第二套权限判断逻辑（双重真相）。
 *
 * 返回结构保持向后兼容：
 *   { permission, reason_code, reason_label, source }
 * 另外附加：
 *   eod_precheck_permission / safety_permission / effective_advisory / effective_canary
 *
 * @module gen1-rule-permission
 */
'use strict';

const { evaluateGen1Permission } = require('./gen1-safety-permission');

function gen1RulePermission(params, signal, baseline, risk, fundamental, snapshot, today) {
  const r = evaluateGen1Permission({
    params: params || {},
    signal: signal || null,
    baseline: baseline || null,
    risk: risk || null,
    fundamental: fundamental || null,
    snapshot: snapshot || null,
    today: today || null
  });
  return {
    permission: r.safety.permission,
    reason_code: r.safety.reason_code,
    reason_label: r.safety.reason,
    source: r.safety.source,
    // 扩展字段（向后兼容新增，不破坏旧调用方）
    eod_precheck_permission: r.eod_precheck.permission,
    eod_precheck_reason_code: r.eod_precheck.reason_code,
    safety_permission: r.safety.permission,
    safety_permission_reason_code: r.safety.reason_code,
    effective_advisory: r.effective_advisory,
    effective_canary: r.effective_canary,
    gen1_authority: r.authority.gen1_authority
  };
}

module.exports = { gen1RulePermission };
