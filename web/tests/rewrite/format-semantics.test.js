/**
 * 数值语义测试（SPEC §10 / 附录 A）
 *
 * ★ 本套件**不只测「格式长什么样」，而是测「单位语义是否正确」**（owner 明确要求）：
 *   每一条断言都对应 SPEC 附录 A.2 字段语义表的一行，
 *   并在断言里写明「若按错误单位处理会得到什么」。
 */
import {
  formatPercent, formatProbability, formatRatio, formatRatioAsPercent,
  formatAmount, formatPrice, formatCount, formatScore, formatNumber
} from '../../src/rewrite/domain/format.js';
import { suite, assert } from './_fixtures.js';

const t = suite('format-semantics.test');

/* ---------------- 1) 仓位百分比：final_target 类 ---------------- */

t.ok('final_target=0.5 ⇒ "0.5%"（若误当比例×100 会得 "50.0%" —— 那是旧 bug）', () => {
  assert.equal(formatPercent(0.5), '0.5%');
  assert.notEqual(formatPercent(0.5), '50.0%');
  assert.notEqual(formatPercent(0.5), '50%');
});

t.ok('仓位百分比量级全覆盖：0 / 0.5 / 1 / 8.3 / 21 / 28.5 / 100 全部原值', () => {
  assert.equal(formatPercent(0), '0.0%');
  assert.equal(formatPercent(0.5), '0.5%');
  assert.equal(formatPercent(1), '1.0%');       // ⛔ 不得变成 100%
  assert.equal(formatPercent(8.3), '8.3%');
  assert.equal(formatPercent(21), '21.0%');
  assert.equal(formatPercent(28.5), '28.5%');
  assert.equal(formatPercent(100), '100.0%');
});

t.ok('position_gap / target_delta 用带符号百分比（百分点差值）', () => {
  assert.equal(formatPercent(11.9, 1, true), '+11.9%');
  assert.equal(formatPercent(-7.8, 1, true), '-7.8%');
  assert.equal(formatPercent(0, 1, true), '0.0%');
});

/* ---------------- 2) 概率：唯一允许 0~1 → % 的字段 ---------------- */

t.ok('概率 0~1 ⇒ %（这是**唯一**允许 0~1 换算的语义）', () => {
  assert.equal(formatProbability(0.72), '72.0%');
  assert.equal(formatProbability(0.65), '65.0%');
  assert.equal(formatProbability(0), '0.0%');
  assert.equal(formatProbability(1), '100.0%');
});

t.ok('概率字段误传百分数 ⇒ **显式报错**，⛔ 不静默猜断', () => {
  assert.throws(() => formatProbability(72), /formatProbability/);
  assert.throws(() => formatProbability(2.5), /formatProbability/);
});

/* ---------------- 3) 比例与系数：⛔ 绝不当百分比 ---------------- */

t.ok('★ 系数 stage_factor / market_factor 用 formatRatio（0.25 显示 "0.25"，不是 "25%"）', () => {
  assert.equal(formatRatio(0.25), '0.25');
  assert.notEqual(formatRatio(0.25), '25%');
  assert.equal(formatRatio(0), '0.00');
  assert.equal(formatRatio(1), '1.00');
});

t.ok('price_position 若需以 % 呈现，必须由调用方**显式**选择 formatRatioAsPercent', () => {
  assert.equal(formatRatio(0.72), '0.72');                 // 默认：比例原值
  assert.equal(formatRatioAsPercent(0.72), '72.0%');       // 显式声明才转 %
  assert.notEqual(formatRatio(0.72), formatRatioAsPercent(0.72));
});

/* ---------------- 4) 评分：点数，⛔ 不加 % ---------------- */

t.ok('机会分 / 横盘分 / 五维分用 formatScore（整数点数，⛔ 无 % 后缀）', () => {
  assert.equal(formatScore(67), '67');
  assert.equal(formatScore(0), '0');
  assert.equal(formatScore(75), '75');
  assert.equal(formatScore(28.5, 1), '28.5');
  assert.ok(!formatScore(67).includes('%'), '⛔ 评分不得带 %');
});

t.ok('五维分上限语义：25/25/25/15/10 均为点数', () => {
  for (const v of [5, 25, 20, 15, 10]) {
    const s = formatScore(v);
    assert.ok(!s.includes('%'), v + ' 不应带 %');
  }
});

/* ---------------- 5) 金额 / 价格 / 数量 ---------------- */

t.ok('金额：元 → 万/亿（total_asset 等）', () => {
  assert.equal(formatAmount(99172.1), '9.92 万');
  assert.equal(formatAmount(83994.6), '8.40 万');
  assert.equal(formatAmount(-823.8), '-823.80');
  assert.equal(formatAmount(15177.5), '1.52 万');
});

t.ok('价格：元，3 位小数', () => {
  assert.equal(formatPrice(1.2345), '1.234');
  assert.equal(formatPrice(null), '—');
});

t.ok('数量：份（shares / volume），千分位整数', () => {
  assert.equal(formatCount(1700), '1,700');
  assert.equal(formatCount(0), '0');
});

/* ---------------- 6) 空值语义：0 是合法值 ---------------- */

t.ok('0 与空字符串：0 必须正常显示（⛔ 不得当缺失）', () => {
  assert.equal(formatPercent(0), '0.0%');
  assert.equal(formatScore(0), '0');
  assert.equal(formatRatio(0), '0.00');
  assert.equal(formatCount(0), '0');
});

t.ok('null/undefined/非数字 ⇒ 占位 —（显式空值，非静默）', () => {
  for (const f of [formatPercent, formatRatio, formatProbability, formatAmount, formatPrice, formatCount, formatScore, formatNumber]) {
    assert.equal(f(null), '—');
    assert.equal(f(undefined), '—');
  }
  assert.equal(formatPercent('abc'), '—');
});

/* ---------------- 7) 反向：⛔ 不得存在「按大小推断」的行为 ---------------- */

t.ok('★ 阈值两侧行为一致（proves 无 ≤1.5 之类的启发式分支）', () => {
  // 若存在「|v|<=1.5 → ×100」的启发式，则 1.4→140%、1.6→1.6%（突变）
  assert.equal(formatPercent(1.4), '1.4%');
  assert.equal(formatPercent(1.5), '1.5%');
  assert.equal(formatPercent(1.6), '1.6%');
  assert.equal(formatPercent(0.9), '0.9%');
  assert.equal(formatPercent(2.0), '2.0%');
  // 单调且连续：不存在 1.5 处的跳变
  assert.equal(formatPercent(1.5), '1.5%', '阈值处不得跳变');
  assert.equal(formatPercent(1.49), '1.5%', '1.49 四舍五入到 1.5%');
});

t.ok('★ 大数与小数的处理路径完全相同（同一函数、无分支）', () => {
  const a = formatPercent(0.5).replace('%', '');
  const b = formatPercent(50).replace('%', '');
  assert.equal(Number(a), 0.5);
  assert.equal(Number(b), 50);
  assert.equal(Number(b) / 100, 0.5, '50 与 0.5 相差恰好 100 倍且**不被函数弥合**');
});

t.done();
