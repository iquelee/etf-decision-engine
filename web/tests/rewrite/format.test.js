/**
 * D-7 语义化 formatter 单测（SPEC §10）
 *
 * 核心不变式：⛔ 任何 formatter 都不得「按数值大小推断单位」。
 * 尤其：final_target = 0.5（语义 0.5%）必须渲染为 '0.5%'，**不是** '50.0%'。
 */
import assert from 'node:assert/strict';
import {
  formatPercent,
  formatProbability,
  formatRatio,
  formatAmount,
  formatPrice,
  formatCount,
  formatDate,
  formatDateTime,
  dash
} from '../../src/rewrite/domain/format.js';

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('[PASS] ' + name); }

/* ---------- 仓位/权重百分比：输入已是百分数 ---------- */
ok('formatPercent: final_target=0.5 → 0.5%（⛔ 不是 50%）', () => {
  assert.equal(formatPercent(0.5, 1), '0.5%');
  assert.notEqual(formatPercent(0.5, 1), '50.0%');
});
ok('formatPercent: 常见值', () => {
  assert.equal(formatPercent(25), '25.0%');
  assert.equal(formatPercent(8.3), '8.3%');
  assert.equal(formatPercent(0), '0.0%');
  assert.equal(formatPercent(1), '1.0%');          // 1% 不得变成 100%
  assert.equal(formatPercent(100), '100.0%');
});
ok('formatPercent: 带符号', () => {
  assert.equal(formatPercent(12.34, 1, true), '+12.3%');
  assert.equal(formatPercent(-3.2, 1, true), '-3.2%');
  assert.equal(formatPercent(0, 1, true), '0.0%');
});
ok('formatPercent: 空值占位', () => {
  assert.equal(formatPercent(null), '—');
  assert.equal(formatPercent(undefined), '—');
  assert.equal(formatPercent(''), '—');
  assert.equal(formatPercent('abc'), '—');
});

/* ---------- 概率：唯一允许 0~1 → % 的场景 ---------- */
ok('formatProbability: 0.72 → 72.0%', () => {
  assert.equal(formatProbability(0.72), '72.0%');
  assert.equal(formatProbability(0), '0.0%');
  assert.equal(formatProbability(1), '100.0%');
});
ok('formatProbability: 误传百分数时**显式报错**，⛔ 不静默猜测', () => {
  assert.throws(() => formatProbability(72), /formatProbability/);
  assert.throws(() => formatProbability(2), /formatProbability/);
});

/* ---------- 比例：原样输出 ---------- */
ok('formatRatio: 不做任何换算', () => {
  assert.equal(formatRatio(0.72), '0.72');
  assert.equal(formatRatio(1), '1.00');
});

/* ---------- 金额 / 价格 / 数量 ---------- */
ok('formatAmount', () => {
  assert.equal(formatAmount(99172.1), '9.92 万');
  assert.equal(formatAmount(123456789), '1.23 亿');
  assert.equal(formatAmount(523.5), '523.50');
});
ok('formatPrice', () => {
  assert.equal(formatPrice(1.2345), '1.234');
});
ok('formatCount', () => {
  assert.equal(formatCount(1200), '1,200');
});

/* ---------- 日期 ---------- */
ok('formatDate 保留 YYYY-MM-DD', () => {
  assert.equal(formatDate('2026-09-30'), '2026-09-30');
  assert.equal(formatDate('2026-09-30T08:22:04.921Z'), '2026-09-30');
});
ok('formatDateTime', () => {
  assert.equal(formatDateTime('2026-09-30T13:38:07+08:00').slice(0, 10), '2026-09-30');
  assert.equal(formatDateTime(null), '—');
});

/* ---------- 空值占位只服务「确认为空」，不掩盖缺失 ---------- */
ok('dash 仅处理真空值', () => {
  assert.equal(dash(null), '—');
  assert.equal(dash(''), '—');
  assert.equal(dash(0), 0);        // 0 是合法值，不得变 '—'
  assert.equal(dash('0%'), '0%');
});

console.log('\nformat.test: ' + pass + ' 项全过');
