'use strict';
/**
 * WP-G1-GE-02 取证：CANARY before/after 逐字段平价（**手动取证工具，不进 CI**）。
 *
 * 为什么不进 CI：它需要一个「GE-02 之前的树」的 git worktree，而 CI 是浅检出，
 * 无法伪造历史存在性 —— 按仓库纪律，这类断言不得写成恒红或静默通过的测试。
 *
 * 方法：把「GE-02 之前的树」与「GE-02 之后的树」的纯函数层
 *      （resolveAuthority / evaluateGen1Permission / buildCanaryCounterfactual /
 *        applyGen1Overlay）用**完全相同**的输入各跑一遍，逐字段比对：
 *        ① 旧树产出的**每一个字段**在新树中必须逐字段相同（含 final_target / final_action）
 *        ② 新树新增字段必须严格落在申报白名单内（且为 dormant 取值）
 *
 * 用法（Windows 家用机）：
 *   git worktree add --detach <BASE_DIR> 6793d7f
 *   GE02_BASE_TREE=<BASE_DIR>/src/common/utils node scripts/gen1-guarded-parity-local.js
 *
 * 退出码：0 = 全部一致；1 = 存在不一致；2 = 基线树缺失（工具未就绪）
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const BASE = process.env.GE02_BASE_TREE
  || process.argv[2]
  || path.join(path.dirname(REPO), '_ge02-base-tree', 'src', 'common', 'utils');
const NEW = process.env.GE02_NEW_TREE || path.join(REPO, 'src', 'common', 'utils');

if (!fs.existsSync(path.join(BASE, 'gen1-overlay.js'))) {
  console.error(`[SKIP] 基线树不存在：${BASE}`);
  console.error('       先执行：git worktree add --detach <BASE_DIR> 6793d7f');
  console.error('       再执行：GE02_BASE_TREE=<BASE_DIR>/src/common/utils node scripts/gen1-guarded-parity-local.js');
  process.exit(2);
}

function load(root) {
  return {
    root,
    resolveAuthority: require(path.join(root, 'gen1-authority')).resolveAuthority,
    permission: require(path.join(root, 'gen1-safety-permission')).evaluateGen1Permission,
    canary: require(path.join(root, 'gen1-canary')).buildCanaryCounterfactual,
    overlay: require(path.join(root, 'gen1-overlay')).applyGen1Overlay,
    selector: fs.existsSync(path.join(root, 'gen1-guarded-selector.js'))
      ? require(path.join(root, 'gen1-guarded-selector.js')) : null
  };
}

const OLD = load(BASE);
const NOW = load(NEW);

/** 递归稳定序列化（键排序），用于逐字段比对。 */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

const PERM_NEW_KEYS = ['effective_guarded', 'guarded'];
const AUTH_NEW_KEYS = ['guarded_effective_authorized'];
const OVERLAY_NEW_KEYS = [
  'decision_source', 'gen1_run_id', 'gen1_candidate_hash', 'gen1_adopted',
  'gen1_reject_reason_code', 'gen1_safety_core_adjust_reason',
  'gen1_guarded_baseline_stage', 'gen1_guarded_effective_stage',
  'gen1_guarded_baseline_target', 'gen1_guarded_result_target', 'gen1_guarded_delta',
  'gen1_guarded_selector_source', 'gen1_effective_guarded', 'gen1_guarded_reason_code',
  'gen1_guarded_freeze_seal_status', 'gen1_guarded_evidence_seal_status'
];

const TO = '2026-09-10';
const P = (over) => Object.assign({
  ml_shadow_observe: true, ml_advisory_enabled: true, ml_fast_path_enabled: true,
  ml_challenger_model_id: 'HVT-A-ET-20260830', gen1_authority: 'CANARY'
}, over || {});
const SIG = (over) => Object.assign({
  date: TO, model_id: 'HVT-A-ET-20260830', ml_model_id: 'HVT-A-ET-20260830', ml_fast: true,
  calibrated_probability: 0.82, rule_gate: 'PERMIT', stage: 'S2', signal_run_id: 'gen1-eod-PARITY'
}, over || {});
const GATE_OK = {
  health: 'OK', latched_health: 'OK', gate_status: 'ACTIVE',
  allow_advisory: true, allow_canary: true, allow_gen1_timing: true,
  source: 'GEN1_HEALTH_STATE_LATCH', economic_health: 'PENDING'
};
const DECISION = {
  code: '513310', decision_date: TO, final_target: 15, final_action: 'WAIT',
  suggested_position: 15, opportunity_score: 72, opportunity_grade: 'B',
  core_position: 10, trade_position: 5, position_gap: 0, explain_chain: [], version: 3
};

const SCENARIOS = [
  { label: '生产现状 CANARY + 全绿', params: P(), signal: SIG(), },
  { label: 'CANARY + 召回 recompute（canary 生效）', params: P(), signal: SIG(), recompute: { target: 25, action: 'BUILD' } },
  { label: 'ADVISORY（低一档）', params: P({ gen1_authority: 'ADVISORY' }), signal: SIG(), recompute: { target: 25, action: 'BUILD' } },
  { label: 'SHADOW（更低一档）', params: P({ gen1_authority: 'SHADOW' }), signal: SIG() },
  { label: 'OFF（观察总闸关闭）', params: P({ ml_shadow_observe: false }), signal: SIG() },
  { label: 'advisory 总闸关闭', params: P({ ml_advisory_enabled: false }), signal: SIG() },
  { label: 'PRODUCTION 请求（必须降级）', params: P({ gen1_authority: 'PRODUCTION' }), signal: SIG() },
  { label: '未知 authority 取值', params: P({ gen1_authority: 'ROOT' }), signal: SIG() },
  { label: '信号过期', params: P(), signal: SIG({ date: '2026-09-09' }) },
  { label: 'model_id 不符', params: P(), signal: SIG({ ml_model_id: 'HVT-A-ET-99999999' }) },
  { label: '概率低于阈值', params: P(), signal: SIG({ ml_fast: false, calibrated_probability: 0.64 }) },
  { label: '概率恰好等于阈值', params: P(), signal: SIG({ calibrated_probability: 0.65 }) },
  { label: '信号自相矛盾', params: P(), signal: SIG({ ml_fast: false, calibrated_probability: 0.90 }) },
  { label: '无信号行', params: P(), signal: null },
  { label: '基线阶段 S3', params: P(), signal: SIG({ stage: 'S3' }), baseline: { trend_stage_primary: 'S3', v361_baseline_target: 20 } },
  { label: '基线阶段 S5（不可用）', params: P(), signal: SIG(), baseline: { trend_stage_primary: 'S5', v361_baseline_target: 75 } },
  { label: '硬风险 RED', params: P(), signal: SIG(), risk: { risk_override: false, risk_flag: 'RED' } },
  { label: 'risk_override', params: P(), signal: SIG(), risk: { risk_override: true, risk_flag: 'NORMAL' } },
  { label: '基本面 F5', params: P(), signal: SIG(), fundamental: { f_state: 'F5' } },
  { label: '结构破坏', params: P(), signal: SIG(), snapshot: { structural_break: true, hard_break: false } },
  { label: 'Hard Break', params: P(), signal: SIG(), snapshot: { structural_break: false, hard_break: true } },
  { label: '数据 DEGRADED', params: P(), signal: SIG(), dataHealth: { status: 'DEGRADED' } },
  { label: '数据 BLOCKED', params: P(), signal: SIG(), dataHealth: { status: 'BLOCKED' } },
  { label: '数据词表 DATA_OK', params: P(), signal: SIG(), dataHealth: { status: 'DATA_OK' } },
  { label: '数据缺失（null）', params: P(), signal: SIG(), dataHealth: null },
  { label: '域 PARTIAL_COVERAGE', params: P(), signal: SIG(), domainPermission: { status: 'PARTIAL_COVERAGE', permission: 'CANARY_LIMITED' } },
  { label: '域 OUT_OF_DOMAIN', params: P(), signal: SIG(), domainPermission: { status: 'OUT_OF_DOMAIN', permission: 'BLOCK_CANARY' } },
  { label: '域缺失（null）', params: P(), signal: SIG(), domainPermission: null },
  { label: '健康 LED（非 OK）', params: P(), signal: SIG(), healthGate: Object.assign({}, GATE_OK, { health: 'DEGRADED', latched_health: 'DEGRADED' }) },
  { label: '健康 gate PENDING', params: P(), signal: SIG(), healthGate: Object.assign({}, GATE_OK, { gate_status: 'PENDING' }) },
  { label: '健康 latch 缺失', params: P(), signal: SIG(), healthGate: null },
  { label: '健康 allow_canary=false', params: P(), signal: SIG(), healthGate: Object.assign({}, GATE_OK, { allow_canary: false }) },
  { label: 'EOD 预检 BLOCK', params: P(), signal: SIG({ rule_gate: 'BLOCK', rule_permission_reason_code: 'EOD_STAGE_NOT_ELIGIBLE' }) },
  { label: '无基线', params: P(), signal: SIG(), baseline: null },
  { label: '无 today', params: P(), signal: SIG(), today: null },
  { label: '自定义阈值 0.90', params: P(), signal: SIG({ calibrated_probability: 0.85 }), thresholdSignalP: 0.90 },
  { label: 'final_target=0 边界', params: P(), signal: SIG(), decision: Object.assign({}, DECISION, { final_target: 0, suggested_position: 0, final_action: 'EXIT' }) },
  { label: 'final_target=null 边界', params: P(), signal: SIG(), decision: Object.assign({}, DECISION, { final_target: null, final_action: null }) }
];

function buildInput(sc) {
  return {
    params: sc.params,
    signal: sc.signal,
    baseline: sc.baseline === undefined
      ? { trend_stage_primary: 'S2', v361_baseline_target: 15 }
      : sc.baseline,
    today: sc.today === undefined ? TO : sc.today,
    thresholdSignalP: sc.thresholdSignalP === undefined ? 0.65 : sc.thresholdSignalP,
    risk: sc.risk || { risk_override: false, risk_flag: 'NORMAL' },
    fundamental: sc.fundamental || { f_state: 'F3' },
    snapshot: sc.snapshot || { structural_break: false, hard_break: false },
    dataHealth: sc.dataHealth === undefined ? { status: 'OK' } : sc.dataHealth,
    domainPermission: sc.domainPermission === undefined
      ? { status: 'IN_DOMAIN', permission: 'ALLOW' } : sc.domainPermission,
    healthGate: sc.healthGate === undefined ? GATE_OK : sc.healthGate
  };
}

let fails = 0;
const rows = [];
for (const sc of SCENARIOS) {
  const inp = buildInput(sc);

  /* ---- 1) resolveAuthority ---- */
  const oldAuth = OLD.resolveAuthority(inp.params);
  const newAuth = NOW.resolveAuthority(inp.params);
  for (const k of Object.keys(oldAuth)) {
    if (stable(oldAuth[k]) !== stable(newAuth[k])) {
      fails += 1; rows.push(`FAIL[${sc.label}] authority.${k}: ${stable(oldAuth[k])} → ${stable(newAuth[k])}`);
    }
  }
  const authExtra = Object.keys(newAuth).filter((k) => !(k in oldAuth));
  const authUnexpected = authExtra.filter((k) => PERM_NEW_KEYS.concat(AUTH_NEW_KEYS).indexOf(k) < 0);
  if (authUnexpected.length) {
    fails += 1; rows.push(`FAIL[${sc.label}] authority 出现未申报新字段: ${authUnexpected.join(',')}`);
  }

  /* ---- 2) evaluateGen1Permission ---- */
  const oldPerm = OLD.permission(inp);
  const newPerm = NOW.permission(inp);   // 不注入封印 ⇒ 与生产「读不到封印」等价
  for (const k of Object.keys(oldPerm)) {
    if (k === 'authority') {
      // 嵌套对象：旧字段须逐字段相同；新增字段须落在申报白名单内
      for (const ak of Object.keys(oldPerm.authority)) {
        if (stable(oldPerm.authority[ak]) !== stable(newPerm.authority[ak])) {
          fails += 1; rows.push(`FAIL[${sc.label}] permission.authority.${ak} 不一致`);
        }
      }
      const authNestedExtra = Object.keys(newPerm.authority)
        .filter((ak) => !(ak in oldPerm.authority));
      const authNestedBad = authNestedExtra.filter((ak) => AUTH_NEW_KEYS.indexOf(ak) < 0);
      if (authNestedBad.length) {
        fails += 1; rows.push(`FAIL[${sc.label}] permission.authority 未申报新字段: ${authNestedBad.join(',')}`);
      }
      if (authNestedExtra.length !== AUTH_NEW_KEYS.length) {
        fails += 1; rows.push(`FAIL[${sc.label}] permission.authority 新增字段数 ${authNestedExtra.length} != ${AUTH_NEW_KEYS.length}`);
      }
      continue;
    }
    if (stable(oldPerm[k]) !== stable(newPerm[k])) {
      fails += 1; rows.push(`FAIL[${sc.label}] permission.${k} 不一致`);
    }
  }
  const permExtra = Object.keys(newPerm).filter((k) => !(k in oldPerm)).sort();
  const permUnexpected = permExtra.filter((k) => PERM_NEW_KEYS.indexOf(k) < 0);
  if (permUnexpected.length) {
    fails += 1; rows.push(`FAIL[${sc.label}] permission 出现未申报新字段: ${permUnexpected.join(',')}`);
  }
  if (newPerm.effective_guarded !== false) {
    fails += 1; rows.push(`FAIL[${sc.label}] 未注入封印时 effective_guarded 必须为 false`);
  }

  /* ---- 3) buildCanaryCounterfactual ---- */
  const baseline = { stage: 'S2', target: 15, action: 'WAIT' };
  const rFn = sc.recompute
    ? () => ({ target: sc.recompute.target, action: sc.recompute.action })
    : undefined;
  const oldCanary = OLD.canary({ permission: oldPerm, baseline, recomputeCanaryTarget: rFn });
  const newCanary = NOW.canary({ permission: newPerm, baseline, recomputeCanaryTarget: rFn });
  for (const k of Object.keys(oldCanary)) {
    if (stable(oldCanary[k]) !== stable(newCanary[k])) {
      fails += 1; rows.push(`FAIL[${sc.label}] canary.${k}: ${stable(oldCanary[k])} → ${stable(newCanary[k])}`);
    }
  }
  const canaryExtra = Object.keys(newCanary).filter((k) => !(k in oldCanary));
  if (canaryExtra.length) {
    fails += 1; rows.push(`FAIL[${sc.label}] canary 出现新字段: ${canaryExtra.join(',')}`);
  }

  /* ---- 4) applyGen1Overlay（含新增第 4 参审计） ---- */
  const decision = sc.decision || DECISION;
  const oldOut = OLD.overlay(decision, oldPerm, oldCanary);
  const sel = NOW.selector.selectGuardedResult({
    baseline: { target: 15, action: 'WAIT', stage: 'S2' },
    guarded: null,
    effectiveGuarded: newPerm.effective_guarded === true
  });
  const audit = NOW.selector.buildGuardedAudit({
    permission: newPerm, signal: inp.signal, code: decision.code,
    baseline: { target: 15, action: 'WAIT', stage: 'S2' }, selection: sel
  });
  const newOut = NOW.overlay(decision, newPerm, newCanary, audit);

  for (const k of Object.keys(oldOut)) {
    if (stable(oldOut[k]) !== stable(newOut[k])) {
      fails += 1; rows.push(`FAIL[${sc.label}] overlay.${k}: ${stable(oldOut[k])} → ${stable(newOut[k])}`);
    }
  }
  const outExtra = Object.keys(newOut).filter((k) => !(k in oldOut)).sort();
  const outUnexpected = outExtra.filter((k) => OVERLAY_NEW_KEYS.indexOf(k) < 0);
  if (outUnexpected.length) {
    fails += 1; rows.push(`FAIL[${sc.label}] overlay 出现未申报新字段: ${outUnexpected.join(',')}`);
  }
  if (outExtra.length !== OVERLAY_NEW_KEYS.length) {
    fails += 1;
    rows.push(`FAIL[${sc.label}] overlay 新增字段数 ${outExtra.length} != 预期 ${OVERLAY_NEW_KEYS.length}`);
  }
  // production 字段硬断言
  if (stable(newOut.final_target) !== stable(decision.final_target)) {
    fails += 1; rows.push(`FAIL[${sc.label}] final_target 被改写`);
  }
  if (stable(newOut.final_action) !== stable(decision.final_action)) {
    fails += 1; rows.push(`FAIL[${sc.label}] final_action 被改写`);
  }
  // 审计字段必须 dormant
  if (newOut.gen1_adopted !== false || newOut.gen1_guarded_selector_source !== 'BASELINE'
    || newOut.decision_source !== 'V361_SAFETY_CORE') {
    fails += 1; rows.push(`FAIL[${sc.label}] 审计字段不是 dormant 取值`);
  }
}

console.log('=== WP-G1-GE-02 CANARY before/after 逐字段平价 ===');
console.log(`场景数：${SCENARIOS.length}`);
console.log(`比对维度：authority / permission / canary / overlay（含 production 字段与新增字段白名单）`);
if (rows.length) {
  rows.forEach((r) => console.log('  ' + r));
  console.log(`\n[FAIL] ${fails} 处不一致`);
  process.exit(1);
}
console.log(`[PASS] 全部 ${SCENARIOS.length} 个场景：旧树字段逐字段相同；新增字段严格落在白名单内且为 dormant 取值`);
console.log(`       permission 新增：${PERM_NEW_KEYS.join(', ')}`);
console.log(`       authority  新增：${AUTH_NEW_KEYS.join(', ')}`);
console.log(`       overlay    新增：${OVERLAY_NEW_KEYS.length} 个审计字段`);
