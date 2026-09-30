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
  assert.ok(!/Math\.abs\(\s*\w+\s*\)\s*<=\s*1\.5/.test(stripped), '不得出现 <=1.5 的 ×100 启发式');
  assert.ok(!/\*\s*100/.test(stripped.replace(/n\s*\*\s*100/g, 'X')),
    '只允许 formatProbability 内按语义做 ×100，不得出现其它 ×100 推断');
});

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
