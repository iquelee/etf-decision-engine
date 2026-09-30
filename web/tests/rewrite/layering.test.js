/**
 * 分层守卫测试（SPEC §2.2）
 *
 * 核心不变式（G1 的机械保障）：
 *   视图层 / 组件层 ⛔ 不得 import `api` 或 `adapters`
 *   —— 拿不到 api，就不可能"自己解释后端字段"。
 *
 * 同时守卫：
 *   · domain/ ⛔ 不得 import api / adapters / views
 *   · adapters/（存在时）⛔ 不得 import views / components
 *   · domain/format.js ⛔ 不得含数值启发式（SPEC §10.1 / D-7）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REWRITE = path.join(process.cwd(), 'src', 'rewrite');

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('[PASS] ' + name); }

function walk(dir, filter) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  (function rec(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (filter(e.name)) out.push(p);
    }
  })(dir);
  return out;
}

/** 抽出源文件里所有 import/require 的模块说明符 */
function importsOf(file) {
  const s = fs.readFileSync(file, 'utf8');
  const specs = [];
  const reImp = /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const reReq = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const reDyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = reImp.exec(s))) specs.push(m[1]);
  while ((m = reReq.exec(s))) specs.push(m[1]);
  while ((m = reDyn.exec(s))) specs.push(m[1]);
  return specs;
}

const VIEWS = walk(path.join(REWRITE, 'views'), (n) => n.endsWith('.vue'));
const COMPS = walk(path.join(REWRITE, 'components'), (n) => /\.(vue|js)$/.test(n));
const LAYOUTS = walk(path.join(REWRITE, 'layouts'), (n) => n.endsWith('.vue'));
const COMPOSE = walk(path.join(REWRITE, 'compose'), (n) => n.endsWith('.js'));

ok('views/ components/ layouts/ compose/ 均有文件（守卫自身有效）', () => {
  assert.ok(VIEWS.length >= 15, 'views 数量异常: ' + VIEWS.length);
  assert.ok(COMPS.length >= 3, 'components 数量异常: ' + COMPS.length);
  assert.ok(LAYOUTS.length >= 2, 'layouts 数量异常: ' + LAYOUTS.length);
  assert.ok(COMPOSE.length >= 1, 'compose 数量异常: ' + COMPOSE.length);
});

/** 判定某说明符是否指向 api / adapters 层 */
function isApiOrAdapter(spec) {
  return /(^|\/)api(\.js|\/|$)/.test(spec) || /adapters?\//.test(spec);
}

function offenders(files) {
  const bad = [];
  for (const f of files) {
    for (const s of importsOf(f)) {
      if (isApiOrAdapter(s)) bad.push(path.relative(REWRITE, f) + ' → ' + s);
    }
  }
  return bad;
}

const RENDER_LAYERS = [
  ['views/**', VIEWS],
  ['components/**', COMPS],
  ['layouts/**', LAYOUTS]
];

for (const [label, files] of RENDER_LAYERS) {
  ok(label + ' ⛔ 不得 import api / adapters', () => {
    const bad = offenders(files);
    assert.equal(bad.length, 0, bad.join('; '));
  });
}

ok('compose/ **必须** 经 api 取数（它是唯一允许触 api 的业务层）', () => {
  const hits = COMPOSE.filter((f) => importsOf(f).some(isApiOrAdapter));
  assert.ok(hits.length >= 1, 'compose/ 应至少有一个模块 import api.js');
});

ok('domain/** ⛔ 不得 import api / adapters / views / components', () => {
  const files = walk(path.join(REWRITE, 'domain'), (n) => n.endsWith('.js'));
  assert.ok(files.length >= 1, 'domain/ 应至少有一个模块');
  const bad = [];
  for (const f of files) {
    for (const s of importsOf(f)) {
      if (isApiOrAdapter(s) || /views?\//.test(s) || /components?\//.test(s) || /layouts?\//.test(s)) {
        bad.push(path.relative(REWRITE, f) + ' → ' + s);
      }
    }
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

ok('domain/format.js ⛔ 不得含「按数值大小推断单位」的启发式（D-7）', () => {
  const src = fs.readFileSync(path.join(REWRITE, 'domain', 'format.js'), 'utf8');
  // 剥离注释后再断言（工作纪律：静态断言必须剥离注释）
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  // (a) 全局：不得出现「乘 100 之后静默返回」这类启发式 —— 由 (c) 精确覆盖。
  //     此处只保证「量级阈值必然出现在显式拒绝守卫或声明里」（见 (b)）。

  // (b) ★ 核心：**单位敏感**函数体内不得出现任何数值量级分支 ——
  //     唯一豁免是「显式拒绝守卫」（形如 `if (n > 1.5) throw ...`）：
  //     那是**拒绝**误传值，而不是**猜测**单位，与 D-7 精神一致。
  const UNIT_SENSITIVE = ['formatPercent', 'formatProbability', 'formatRatio', 'formatRatioAsPercent', 'formatScore'];
  const bodies = extractFunctionBodies(stripped);
  const NIL_GUARD = /isNil|===?\s*null|undefined|==\s*''/;
  for (const fn of UNIT_SENSITIVE) {
    const body = bodies[fn];
    assert.ok(body, '未找到函数 ' + fn);

    // 摘掉两类**合法守卫**：(1) 块状拒绝守卫（内含 throw）(2) 空值提前返回守卫
    // ⚠️ 用惰性 `.*?` 而非 `[^)]*`：条件里含嵌套括号（如 `isNil(v)`）
    const guards = [];
    let rest = body.replace(/if\s*\(.*?\)\s*\{[\s\S]*?\}\s*/g, (m) => { guards.push(m); return '/*guard*/'; });
    const nilGuards = [];
    rest = rest.replace(/if\s*\(.*?\)\s*return[^;]*;/g, (m) => { nilGuards.push(m); return '/*nil*/'; });
    assert.ok(nilGuards.length >= 1, fn + ' 应至少有一个空值守卫（防御 null/undefined）');

    // 剩余部分：⛔ 不得再有 Math.abs / 分支 / 非 0 阈值比较
    assert.ok(!/Math\.abs/.test(rest), fn + ' 不得使用 Math.abs（量级分支特征）');
    const cmp = [...rest.matchAll(/[<>]=?\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
    const bad = cmp.filter((x) => x !== 0);
    assert.equal(bad.length, 0, fn + ' 不得与 0 以外的阈值比较（违规阈值：' + bad.join(', ') + '）');
    assert.ok(!/\bif\s*\(/.test(rest), fn + ' 除空值守卫/拒绝守卫外不应有分支');

    // 守卫本身必须合法：拒绝守卫只能是 throw；空值守卫只能判 nil
    for (const g of guards) {
      assert.ok(/throw/.test(g), fn + ' 的块状分支必须只用于 throw（拒绝），违规片段：' + g.trim());
    }
    for (const g of nilGuards) {
      const cond = (g.match(/if\s*\(([^)]*)\)/) || [])[1] || '';
      assert.ok(NIL_GUARD.test(cond), fn + ' 的提前返回守卫只允许判空值，违规条件：' + cond);
    }
  }

  // (c) `×100` 只允许出现在**两个显式语义函数**里：概率(0~1→%) 与 比例(0~1→%)
  const allowed = new Set(['formatProbability', 'formatRatioAsPercent']);
  const offenders = [];
  for (const [name, body] of Object.entries(bodies)) {
    if (/\*\s*100/.test(body) && !allowed.has(name)) offenders.push(name);
  }
  assert.equal(offenders.length, 0, '×100 只允许在 ' + [...allowed].join(' / ') + ' 内；违规：' + offenders.join(', '));

  // 且这两个函数必须真的存在且真的做了 ×100（防「都删掉就通过」）
  for (const fn of allowed) {
    assert.ok(/\*\s*100/.test(bodies[fn]), fn + ' 应显式做 ×100');
  }

  // (d) formatAmount 允许按量级选「万/亿」显示单位 —— 但输入单位固定为元，
  //     不得因此推断**输入**单位。显式豁免并断言其确实只做显示换算。
  assert.ok(/1e8|1e4/.test(bodies.formatAmount), 'formatAmount 应显式声明万/亿阈值');

  // (e) 自检：构造一个真正违反 D-7 的函数体，断言必须能被检出（防永真）
  const badSnippet = 'export function bad(v){ const n = Number(v); return (Math.abs(n) <= 1.5 ? n * 100 : n).toFixed(1) + "%"; }';
  const badBodies = extractFunctionBodies(badSnippet);
  assert.ok(/Math\.abs/.test(badBodies.bad), '自检失败：无法识别 Math.abs');
  assert.ok(/\*\s*100/.test(badBodies.bad), '自检失败：无法识别 ×100');
});


/** 抽取 `export function <name>(...)` 的函数体文本（到下一个 export 或文件末尾） */
function extractFunctionBodies(src) {
  const out = {};
  const re = /export\s+function\s+(\w+)\s*\(/g;
  const marks = [];
  let m;
  while ((m = re.exec(src))) marks.push({ name: m[1], start: m.index });
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : src.length;
    out[mk.name] = src.slice(mk.start, end);
  });
  return out;
}

ok('rewrite 根 domain.js ⛔ 已移除启发式 pct()（D-7）', () => {
  const src = fs.readFileSync(path.join(REWRITE, 'domain.js'), 'utf8');
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/Math\.abs\(\s*\w+\s*\)\s*<=\s*1\.5/.test(stripped), 'domain.js 仍残留数值启发式');
  assert.ok(!/export\s+function\s+pct\s*\(/.test(stripped), 'domain.js 不应再定义启发式 pct()');
});

ok('⚠ 已知豁免：rewrite 根 api.js 的 401 副作用待 M2 迁移（SPEC §8.3）', () => {
  // 本项**不是**通过条件，而是显式登记待办，避免它被永久遗忘。
  const src = fs.readFileSync(path.join(REWRITE, 'api.js'), 'utf8');
  const stillThere = /window\.location\.hash\s*=/.test(src);
  assert.ok(true, stillThere ? '仍存在（M2 迁移）' : '已迁移');
  console.log('       → 401 location 副作用：' + (stillThere ? '仍在 api.js（M2 迁移，SPEC §8.3）' : '已迁移到 app 层'));
});

console.log('\nlayering.test: ' + pass + ' 项全过');
