/**
 * Gen-2 边界测试（SPEC §3.2）
 *
 * ★ 硬约束：Gen-2 = **Selection / Shadow / Research**，无仓位 authority。
 *   ⛔ 不得在 adapter/domain 层被包装成 final target authority。
 *
 * 本套件以「结构性断言」验证：Gen-2 适配器的输出里**不存在**任何
 * 表达「最终目标 / 正式建议 / 最终仓位」的字段名。
 */
import { adaptGen2Shadow } from '../../src/rewrite/adapters/adminRuntime.js';
import { GEN2_ROLE_LABELS, SELECTION_MODE_LABEL } from '../../src/rewrite/domain/labels.js';
import { FIELD_STATE } from '../../src/rewrite/domain/enums.js';
import { suite, assert } from './_fixtures.js';

const t = suite('gen2-boundary.test');
const val = (f) => (f && f.state === FIELD_STATE.PROVIDED ? f.value : null);

/**
 * 这些键名一旦出现在 Gen-2 输出里，就说明 Gen-2 被当成了正式仓位口径。
 * ⛔ 出现即失败。
 */
const FORBIDDEN_KEYS = Object.freeze([
  'finalTarget', 'final_target', 'final_target_pct', 'finalAction', 'final_action',
  'targetPct', 'target_pct', 'positionPct', 'position_pct', 'suggestedPosition',
  'suggested_position', 'positionGap', 'position_gap'
]);

function collectKeys(obj) {
  const keys = new Set();
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      keys.add(k);
      walk(v);
    }
  })(obj);
  return keys;
}

const SAMPLE = {
  selection: {
    run_date: '2026-09-30', as_of_trade_date: '2026-09-30', mode: 'SHADOW',
    selection_confidence: 'FULL', confidence_reason: '全类别覆盖',
    eligible_count: 3, ranked_count: 5, universe_coverage: '5/5',
    role_classification: 'CORE_CHALLENGER', status: 'COMPLETE'
  },
  rankings: [
    { rank: 1, code: '513310', name: '中韩半导体ETF(QDII)', correlation_cluster: 'tech',
      alpha_score_v2: 1.23, trend_gate: true, regime: 'defensive', persistence_days: 12,
      candidate_weight: 0.18, defense_state: 'NORMAL', role: 'CORE', reason_codes: 'ALPHA_TOP' },
    { rank: 2, code: '518880', name: '黄金ETF', correlation_cluster: 'gold',
      alpha_score_v2: 0.91, trend_gate: true, persistence_days: 4,
      candidate_weight: 0.09, role: 'CHALLENGER', reason_codes: 'ALPHA_OK' }
  ]
};

t.ok('Gen-2 输出显式声明边界：SHADOW / Selection / 无仓位 authority', () => {
  const vm = adaptGen2Shadow(SAMPLE);
  assert.equal(vm.boundary.mode, 'SHADOW');
  assert.equal(vm.boundary.label, 'Selection / Shadow / Research');
  assert.equal(vm.boundary.hasPositionAuthority, false, '★ 必须显式声明无仓位 authority');
  assert.match(vm.boundary.note, /不是当前正式交易引擎/);
});

t.ok('★ Gen-2 输出中**不存在**任何 final/target/suggested 语义键（结构性断言）', () => {
  const vm = adaptGen2Shadow(SAMPLE);
  const keys = collectKeys(vm);
  const hits = [...keys].filter((k) => FORBIDDEN_KEYS.includes(k));
  assert.deepEqual(hits, [], 'Gen-2 输出出现正式仓位语义键：' + hits.join(', '));
});

t.ok('Gen-2 的权重字段名是 candidateWeight（候选口径），⛔ 不叫 target', () => {
  const keys = collectKeys(adaptGen2Shadow(SAMPLE));
  assert.ok(keys.has('candidateWeight'), '应存在 candidateWeight');
  assert.ok(!keys.has('targetWeight') && !keys.has('target_weight'), '⛔ 不得出现 targetWeight');
  const r0 = val(adaptGen2Shadow(SAMPLE).rankings)[0];
  assert.equal(val(r0.candidateWeight), 0.18);
  assert.equal(r0.candidateWeight.provenance.authority, 'OPERATOR', 'provenance 应标 OPERATOR（后台数据）');
});

t.ok('selection 字段齐备且可读（8 项）', () => {
  const vm = adaptGen2Shadow(SAMPLE);
  for (const k of ['runDate', 'asOfTradeDate', 'mode', 'selectionConfidence', 'eligibleCount',
    'rankedCount', 'universeCoverage', 'roleClassification', 'status']) {
    assert.equal(vm.selection[k].state, FIELD_STATE.PROVIDED, 'selection.' + k + ' 应可读');
  }
});

t.ok('rankings 字段齐备（含 trend_gate / role / reason_codes）', () => {
  const r0 = val(adaptGen2Shadow(SAMPLE).rankings)[0];
  assert.equal(val(r0.role), 'CORE');
  assert.equal(val(r0.trendGate), true);
  assert.equal(val(r0.alphaScoreV2), 1.23);
  assert.equal(val(r0.reasonCodes), 'ALPHA_TOP');
});

t.ok('Gen-2 角色文案齐备（5 类，供 UI 标注 Selection 角色）', () => {
  for (const k of ['CORE', 'CHALLENGER', 'SATELLITE', 'RESERVE', 'HEDGE']) {
    assert.ok(GEN2_ROLE_LABELS[k], '缺角色 ' + k);
  }
});

t.ok('SHADOW 模式有明确中文表述（供后台页显式标注）', () => {
  assert.match(SELECTION_MODE_LABEL.SHADOW, /Selection \/ Shadow \/ Research/);
});

t.ok('selection 缺失 ⇒ available=false 且 boundary 仍存在（边界不可因数据缺失而消失）', () => {
  const vm = adaptGen2Shadow(null);
  assert.equal(vm.available, false);
  assert.equal(vm.boundary.hasPositionAuthority, false, '无数据时边界声明仍必须存在');
});

t.ok('反向自检：若人为塞入 final_target，结构性断言必须能抓到（防永真）', () => {
  const vm = adaptGen2Shadow(SAMPLE);
  const tampered = Object.assign({}, vm, { fake: { final_target_pct: 12 } });
  const keys = collectKeys(tampered);
  const hits = [...keys].filter((k) => FORBIDDEN_KEYS.includes(k));
  assert.equal(hits.length, 1, '自检失败：结构性断言无法发现被塞入的 final_target_pct');
});

t.done();
