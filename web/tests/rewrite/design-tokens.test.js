/**
 * Design Token 契约测试（SPEC §12）
 *
 * 守卫两件事：
 *  1. 必需 token 全部存在（三套语义色域 + 排版 + 间距 + 半径 + 阴影 + z-index + 断点）；
 *  2. **禁止项零命中**：rewrite/ 源码内不得出现 linear-gradient / backdrop-filter（§12.3）。
 *  3. 三套语义色域色值**不得相同**（§12.1）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REWRITE = path.join(process.cwd(), 'src', 'rewrite');

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('[PASS] ' + name); }

function readTokens() {
  return fs.readFileSync(path.join(REWRITE, 'styles', 'tokens.css'), 'utf8');
}

/** 收集所有 rewrite 下的文本文件（.css/.js/.vue） */
function allSources() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(css|js|vue)$/.test(e.name)) out.push(p);
    }
  })(REWRITE);
  return out;
}

const REQUIRED_TOKENS = [
  // 域1 行情涨跌
  '--mkt-up', '--mkt-down', '--mkt-flat',
  // 域2 风险状态
  '--risk-normal', '--risk-yellow', '--risk-red',
  // 域3 动作语义（对齐 owner toneForAction()）
  '--tone-neutral', '--tone-good', '--tone-risk', '--tone-accent', '--tone-muted',
  // 中性结构
  '--c-bg', '--c-surface', '--c-border', '--c-text', '--c-text-2', '--c-text-3', '--c-accent',
  // 排版
  '--font-cn', '--font-en', '--font-mono',
  '--fs-11', '--fs-12', '--fs-13', '--fs-14', '--fs-16', '--fs-20', '--fs-28', '--fs-36',
  '--fw-regular', '--fw-medium', '--fw-semibold', '--fw-bold',
  // 间距
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-8',
  // 半径
  '--r-sm', '--r-md', '--r-lg',
  // 阴影
  '--sh-1', '--sh-2', '--sh-3',
  // z-index
  '--z-sticky', '--z-nav', '--z-drawer', '--z-modal', '--z-toast',
  // 断点
  '--bp-sm', '--bp-md', '--bp-lg', '--bp-xl', '--bp-2xl'
];

/** 剥离注释后再断言（工作纪律：静态断言必须剥离注释；否则"禁止 linear-gradient"这句注释本身会自命中） */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

ok('tokens.css 存在且声明全部必需 token', () => {
  const css = stripComments(readTokens());
  const missing = REQUIRED_TOKENS.filter((t) => !new RegExp(t + '\\s*:').test(css));
  assert.equal(missing.length, 0, '缺失 token: ' + missing.join(', '));
});

ok('tokens.css 自身不含禁止的装饰性属性', () => {
  const css = stripComments(readTokens());
  assert.ok(!/linear-gradient/.test(css), 'tokens.css 不得含 linear-gradient');
  assert.ok(!/backdrop-filter/.test(css), 'tokens.css 不得含 backdrop-filter');
});

/**
 * 跨域唯一性只约束**带方向语义**的色：
 *   --mkt-up / --mkt-down（涨跌）· --risk-*（风控）· --tone-{good,risk,accent}（动作）
 * 灰色族（--mkt-flat / --tone-neutral / --tone-muted）**不带方向语义**，
 * 允许同值（"无变化 / 中性 / 未定"本就是同一视觉含义）⇒ 显式豁免，不参与比对。
 */
ok('三套语义色域的方向色值互不相同（§12.1）', () => {
  const css = stripComments(readTokens());
  const grab = (name) => {
    const m = css.match(new RegExp(name.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);'));
    return m ? m[1].trim().toLowerCase() : null;
  };
  const mkt = [grab('--mkt-up'), grab('--mkt-down')];
  const risk = [grab('--risk-normal'), grab('--risk-yellow'), grab('--risk-red')];
  const tone = [grab('--tone-good'), grab('--tone-risk'), grab('--tone-accent')];

  for (const [label, arr] of [['行情', mkt], ['风险', risk], ['动作', tone]]) {
    for (const v of arr) assert.ok(v, label + '色缺失');
  }

  const overlap = (x, y) => x.filter((v) => y.includes(v));
  assert.equal(overlap(mkt, risk).length, 0, '行情色与风险色不得同值: ' + overlap(mkt, risk));
  assert.equal(overlap(mkt, tone).length, 0, '行情色与动作色不得同值: ' + overlap(mkt, tone));
  assert.equal(overlap(risk, tone).length, 0, '风险色与动作色不得同值: ' + overlap(risk, tone));

  // 动作 risk 色尤须与两个红（行情涨 / 风控熔断）区分
  const toneRisk = grab('--tone-risk');
  assert.notEqual(toneRisk, grab('--risk-red'), '--tone-risk 不得等于 --risk-red');
  assert.notEqual(toneRisk, grab('--mkt-up'), '--tone-risk 不得等于 --mkt-up');
});

ok('灰色族显式豁免且确有定义（--mkt-flat / --tone-neutral / --tone-muted）', () => {
  const css = stripComments(readTokens());
  for (const n of ['--mkt-flat', '--tone-neutral', '--tone-muted']) {
    assert.ok(new RegExp(n + '\\s*:').test(css), '缺灰色 token: ' + n);
  }
});

ok('全 rewrite 源码禁止 linear-gradient（§12.3 反装饰）', () => {
  const hits = allSources().filter((f) => /linear-gradient/.test(stripComments(fs.readFileSync(f, 'utf8'))));
  assert.equal(hits.length, 0, '命中文件: ' + hits.map((f) => path.relative(REWRITE, f)).join(', '));
});

ok('全 rewrite 源码禁止 backdrop-filter（§12.3 反装饰）', () => {
  const hits = allSources().filter((f) => /backdrop-filter/.test(stripComments(fs.readFileSync(f, 'utf8'))));
  assert.equal(hits.length, 0, '命中文件: ' + hits.map((f) => path.relative(REWRITE, f)).join(', '));
});

ok('tokens.css 不含硬编码生命周期状态（SPEC §1.3）', () => {
  const css = stripComments(readTokens());
  assert.ok(!/COMPLETE|NOT_STARTED|NOT_GRANTED/.test(css));
});

console.log('\ndesign-tokens.test: ' + pass + ' 项全过');
