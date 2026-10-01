/**
 * 测试共用：fixture 加载与断言小工具
 * ⚠️ 本文件不是测试套件（文件名不以 .test.js 结尾），不被 runner 直接执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const FIX = path.join(process.cwd(), 'tests', 'fixtures');

export function fixture(rel) {
  return JSON.parse(fs.readFileSync(path.join(FIX, rel), 'utf8'));
}

export const FIXTURES = Object.freeze({
  liveDashboard: () => fixture('live-legacy/dashboard.json'),
  liveEtf: () => fixture('live-legacy/etf-513310.json'),
  liveConstants: () => fixture('live-legacy/constants.json'),
  liveFundamentals: () => fixture('live-legacy/fundamentals.json'),
  liveIntel: () => fixture('live-legacy/intel.json'),
  liveEtfList: () => fixture('live-legacy/etf-list.json'),
  liveDecisions: () => fixture('live-legacy/decisions-513310.json'),
  liveKline: () => fixture('live-legacy/kline-513310.json'),
  canonicalEtf: () => fixture('canonical/etf-513310.json'),
  canonicalDashboard: () => fixture('canonical/dashboard.json'),
  canonicalReview: () => fixture('canonical/review.json'),
  fieldsNull: () => fixture('edge/canonical-fields-null.json'),
  legacyOnly: () => fixture('edge/legacy-only.json'),
  canonicalPlusLegacy: () => fixture('edge/canonical-plus-legacy.json'),
  emptyArrays: () => fixture('edge/empty-arrays.json'),
  malformed: () => fixture('edge/malformed.json'),
  /** M4-P1：ETF 工作台 fixture 族（生成器 = web/tests/tools/gen-m4-fixtures.cjs，✅ 入库） */
  m4: (name) => fixture('m4/' + name),
  m4Meta: () => fixture('m4/_meta.json')
});

/** 简易断言计数（各套件自报 PASS 数） */
export function suite(name) {
  let n = 0;
  return {
    ok(label, fn) {
      fn();
      n++;
      console.log('[PASS] ' + label);
    },
    done() {
      console.log('\n' + name + ': ' + n + ' 项全过');
    }
  };
}

/** 断言某 Field 处于某个状态 */
export function assertState(field, state, label) {
  assert.ok(field, label + ' 字段缺失（undefined）');
  assert.equal(field.state, state, label + ' 期望 state=' + state + '，实际=' + (field && field.state));
}

export { assert };
