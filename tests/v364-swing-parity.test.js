'use strict';
/**
 * V3.6.4 Gate C —— Swing Parity 永久门禁
 *
 * 允许两份实现并存（`trend-stage.swingHighLow` 是 Gen-1 冻结件，不得删；
 * `swing-structure.swingHighLow` 是 R1 的 SlowBreak 修复依赖，不得退）。
 * 但**共享字段必须 100% 一致**：`higherLow` / `lowerHigh`。
 *
 * 本测试是永久 CI 门禁：任何对 `swing-structure.js` 的改动只要让共享语义漂移，CI 立刻红。
 *
 * 运行：node tests/v364-swing-parity.test.js
 */
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const P = require(path.join(REPO, 'scripts/lib/v364-swing-parity.js'));
const OLD = require(path.join(REPO, 'src/common/utils/trend-stage.js'));
const NEW = require(path.join(REPO, 'src/common/utils/swing-structure.js'));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed += 1;
    failures.push({ name, err: e });
    console.log(`  \u2717 ${name}`);
    console.log(`      ${e && e.message}`);
  }
}

console.log('\n== V3.6.4 Gate C: Swing Parity ==');

const scan = P.scanParity({ includeReal: true });

console.log(`  total_windows   = ${scan.total_windows}`);
console.log(`  mismatch_count  = ${scan.mismatch_count}`);
console.log(`  shared_fields   = ${JSON.stringify(scan.shared_fields)}`);
console.log(`  real_history    = ${scan.sources.real_history.windows} windows `
  + `(available=${scan.sources.real_history.available}`
  + (scan.sources.real_history.unavailable_codes.length
    ? `, unavailable=${scan.sources.real_history.unavailable_codes.join('/')}` : '')
  + ')');
console.log(`  synthetic       = ${scan.sources.synthetic_corpus.windows} windows `
  + `from ${scan.sources.synthetic_corpus.series_count} series`);
if (scan.mismatch_examples.length) {
  console.log('  mismatch_examples (first 3):');
  scan.mismatch_examples.slice(0, 3).forEach((m) => {
    console.log(`    - ${m.source} #${m.window_index}: ${JSON.stringify(m.diffs)}`);
  });
}

test('C.1 共享字段 higherLow / lowerHigh 在全语料上 mismatch_count = 0', () => {
  assert.strictEqual(scan.mismatch_count, 0,
    `共享字段漂移 ${scan.mismatch_count} 例：${JSON.stringify(scan.mismatch_examples.slice(0, 3))}`);
});

test('C.2 扫描规模足够（真实历史 + 确定性合成语料都覆盖）', () => {
  assert.ok(scan.total_windows > 3000, `total_windows 过少：${scan.total_windows}`);
  assert.ok(scan.sources.synthetic_corpus.windows > 500,
    'CI 上必须始终有合成语料窗口（deliverables/ 不入库）');
  assert.ok(scan.sources.synthetic_corpus.series_count >= 20,
    '合成语料序列数不足，边界覆盖太弱');
});

test('C.3 两份实现确实是不同函数（冻结副本仍在，允许并存）', () => {
  assert.notStrictEqual(OLD.swingHighLow, NEW.swingHighLow,
    'trend-stage 的冻结副本不得被删除或替换（Gen-1 pipeline lock）');
});

test('C.4 非共享字段属于新实现专有（不得被误当作共享语义）', () => {
  ['higherHigh', 'lowerLow'].forEach((f) => {
    assert.ok(scan.non_shared_fields.indexOf(f) >= 0, `${f} 应被识别为非共享字段`);
  });
  const w = Array.from({ length: 12 }, (_, i) => ({ high: 200 - i * 2, low: 190 - i * 2 }));
  assert.strictEqual(OLD.swingHighLow(w).lowerLow, undefined,
    '旧实现本就没有 lowerLow（这正是缺陷 #2 的成因）');
  assert.strictEqual(NEW.swingHighLow(w).lowerLow, true, '新实现必须给出真实 lowerLow');
});

test('C.5 语义锚定：单调上涨 → HL 且非 LH', () => {
  const win = Array.from({ length: 12 }, (_, i) => ({ high: 100 + i * 2, low: 90 + i * 2 }));
  ['higherLow', 'lowerHigh'].forEach((f) => {
    assert.strictEqual(OLD.swingHighLow(win)[f], NEW.swingHighLow(win)[f], `${f} 必须一致`);
  });
  assert.strictEqual(OLD.swingHighLow(win).higherLow, true);
  assert.strictEqual(OLD.swingHighLow(win).lowerHigh, false);
});

test('C.6 语义锚定：单调下跌 → LH 且 LL 且非 HL', () => {
  const win = Array.from({ length: 12 }, (_, i) => ({ high: 200 - i * 2, low: 190 - i * 2 }));
  const o = OLD.swingHighLow(win);
  const n = NEW.swingHighLow(win);
  assert.strictEqual(o.lowerHigh, true);
  assert.strictEqual(n.lowerHigh, true);
  assert.strictEqual(o.higherLow, false);
  assert.strictEqual(n.higherLow, false);
  assert.strictEqual(n.lowerLow, true);
});

test('C.7 语义锚定：近 5 根与前 5 根完全相同（tie）→ 两项皆 false', () => {
  const win = Array.from({ length: 12 }, () => ({ high: 100, low: 90 }));
  const o = OLD.swingHighLow(win);
  const n = NEW.swingHighLow(win);
  assert.strictEqual(o.higherLow, false);
  assert.strictEqual(o.lowerHigh, false);
  assert.strictEqual(n.higherLow, false);
  assert.strictEqual(n.lowerHigh, false);
});

test('C.8 退化输入两份实现都不抛异常', () => {
  scan.sources.degenerate_inputs.forEach((d) => {
    assert.strictEqual(d.no_throw, true, `case #${d.case_index} 抛异常：${d.error}`);
  });
});

test('C.9 窗口枚举本身正确（长度 < 12 不产出窗口；长度 12 恰好 1 个）', () => {
  assert.strictEqual(P.windowsOf(Array.from({ length: 11 }, () => ({}))).length, 0);
  assert.strictEqual(P.windowsOf(Array.from({ length: 12 }, () => ({}))).length, 1);
  assert.strictEqual(P.windowsOf(Array.from({ length: 20 }, () => ({}))).length, 9);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach((f) => console.log(`  \u2717 ${f.name}: ${f.err && f.err.message}`));
  process.exit(1);
}
