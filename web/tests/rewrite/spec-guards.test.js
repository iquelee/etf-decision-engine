/**
 * 规格口径守卫测试（SPEC §1.3 / §3.2 / §7.3 / §16）
 *
 * 守卫四件事：
 *  1. ⛔ 不得出现「把部署完成写成正式生产运行」这类**违规文案**；
 *  2. ⛔ 不得在前端**硬编码**生命周期状态值（无 API 时必须走 ABSENT 状态机）；
 *  3. ✅ Gen-2 必须显式标注 `Selection / Shadow / Research` 边界（§3.2）；
 *  4. ✅ 里程碑与交付顺序在 SPEC 中齐备（§16）。
 *
 * ⚠ 断言方法说明（工作纪律：静态断言必须剥离注释，且必须排除"禁止项说明"本身）：
 *    逐行扫描，**跳过含 ⛔ / 不得 / 禁止 的行** —— 那些行是在陈述禁令，不是违规。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const REWRITE = path.join(CWD, 'src', 'rewrite');
const DOCS = path.join(CWD, '..', 'docs');

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('[PASS] ' + name); }

function walk(dir, filter) {
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

function sources() {
  return walk(REWRITE, (n) => /\.(js|vue|css)$/.test(n));
}

/** 剥离注释（块注释 + 行注释），保留代码 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 该行是否为"禁令陈述行"（陈述 ⛔/不得/禁止 的说明文字，不算违规） */
function isProhibitionLine(line) {
  return /⛔|不得|禁止|反例|违规/.test(line);
}

/**
 * 判断某行是否位于**违规文案声明表**内部。
 * 缘由：`domain/lifecycle.js` 里 `FORBIDDEN_LIFECYCLE_PHRASES = Object.freeze([...])`
 * 把违规短语**作为数据声明**（供本守卫复用），那不是"使用违规文案"。
 * ⇒ 必须跳过整段声明，否则守卫会自命中。
 */
function phraseDeclarationRanges(lines) {
  const ranges = [];
  let start = -1;
  lines.forEach((line, i) => {
    if (start < 0 && /FORBIDDEN_LIFECYCLE_PHRASES\s*=|FORBIDDEN_PHRASES\s*=/.test(line) && /\[/.test(line)) {
      start = i;
      if (/\]\s*\)?\s*;?\s*$/.test(line)) { ranges.push([start, i]); start = -1; }
      return;
    }
    if (start >= 0 && /\]\s*\)?\s*;?\s*$/.test(line)) {
      ranges.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) ranges.push([start, lines.length - 1]);
  return ranges;
}

const FORBIDDEN_PHRASES = [
  '正式生产运行',
  '生产运行中',
  '已开始生产周期',
  '最近生产运行',
  '生产周期已开始'
];

ok('⛔ rewrite 源码不得出现违规生命周期文案（排除禁令说明行与声明表）', () => {
  const hits = [];
  for (const f of sources()) {
    const stripped = stripComments(fs.readFileSync(f, 'utf8'));
    const lines = stripped.split(/\r?\n/);
    const decl = phraseDeclarationRanges(lines);
    lines.forEach((line, i) => {
      if (isProhibitionLine(line)) return;                       // 说明禁令本身，跳过
      if (decl.some(([a, b]) => i >= a && i <= b)) return;       // 违规短语的**声明**，跳过
      for (const p of FORBIDDEN_PHRASES) {
        if (line.includes(p)) hits.push(path.relative(REWRITE, f) + ':' + (i + 1) + ' → ' + p);
      }
    });
  }
  assert.equal(hits.length, 0, hits.join('; '));
});

ok('自检：声明表跳过逻辑有效，且守卫确实能发现真实违规（防永真）', () => {
  // 1) lifecycle.js 的声明表必须被跳过
  const lc = stripComments(fs.readFileSync(path.join(REWRITE, 'domain', 'lifecycle.js'), 'utf8'));
  const lines = lc.split(/\r?\n/);
  const decl = phraseDeclarationRanges(lines);
  assert.ok(decl.length >= 1, '未识别到声明表区间');
  const declText = decl.map(([a, b]) => lines.slice(a, b + 1).join('\n')).join('\n');
  assert.ok(declText.includes('正式生产运行'), '声明表区间应覆盖违规短语');

  // 2) 构造一个真实违规行，守卫必须能命中
  const fake = 'const x = "V3.6.5 已进入正式生产运行";';
  const fakeHits = FORBIDDEN_PHRASES.filter((p) => fake.includes(p));
  assert.equal(fakeHits.length, 1, '守卫必须能发现真实违规文案');
});

ok('⛔ 前端不得硬编码生命周期状态值（SPEC §1.3 / §7.3）', () => {
  // 形如 `deployment_state: 'COMPLETE'` / `prospective_epoch = "NOT_STARTED"` 一律违规
  const LIFECYCLE_FIELDS = [
    'deployment_state', 'activation_authorization', 'first_controlled_run',
    'prospective_epoch', 'run_history_index', 'general_production',
    'production_run_executed', 'controlled_deployment'
  ];
  const hits = [];
  for (const f of sources()) {
    const stripped = stripComments(fs.readFileSync(f, 'utf8'));
    stripped.split(/\r?\n/).forEach((line, i) => {
      if (isProhibitionLine(line)) return;
      for (const fld of LIFECYCLE_FIELDS) {
        const re = new RegExp(fld + '\\s*[:=]\\s*[\'"][A-Z_]+[\'"]');
        if (re.test(line)) hits.push(path.relative(REWRITE, f) + ':' + (i + 1) + ' → ' + fld);
      }
    });
  }
  assert.equal(hits.length, 0, '硬编码生命周期: ' + hits.join('; '));
});

ok('✅ Gen-2 视图必须显式声明 Selection / Shadow / Research 边界（§3.2）', () => {
  const f = path.join(REWRITE, 'views', 'admin', 'Gen2Shadow.vue');
  assert.ok(fs.existsSync(f), '缺少 Gen2Shadow.vue');
  const s = fs.readFileSync(f, 'utf8');
  assert.ok(/Selection\s*\/\s*Shadow\s*\/\s*Research/.test(s), '缺 Selection / Shadow / Research 标注');
  assert.ok(/authority/.test(s), '缺 authority 边界说明');
});

ok('✅ 生产状态视图必须覆盖 §7.1 的 6 个生命周期维度', () => {
  const f = path.join(REWRITE, 'views', 'admin', 'ProductionState.vue');
  assert.ok(fs.existsSync(f), '缺少 ProductionState.vue');
  const s = fs.readFileSync(f, 'utf8');
  for (const d of ['deployment_state', 'activation_authorization', 'first_controlled_run',
    'prospective_epoch', 'run_history_index', 'general_production']) {
    assert.ok(s.includes(d), '缺维度: ' + d);
  }
});

ok('✅ SPEC 文档齐备且含交付顺序 A~H（§16）', () => {
  const spec = path.join(DOCS, 'V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md');
  assert.ok(fs.existsSync(spec), '缺少 SPEC 文件');
  const s = fs.readFileSync(spec, 'utf8');
  assert.ok(/^A\.\s*重建正式规格/m.test(s), '缺交付步骤 A');
  assert.ok(/^H\.\s*再进入 M2\+/m.test(s), '缺交付步骤 H');
  assert.ok(s.includes('Production Deployment Identity              = V3.6.5'), '缺 V3.6.5 部署身份口径');
  assert.ok(s.includes('Production Activation Authorization         = NOT_GRANTED'), '缺激活授权口径');
});

ok('✅ 审计 / 蓝图 / 规格 三份文档并存', () => {
  for (const n of [
    'V365_FRONTEND_CURRENT_STATE_AUDIT.md',
    'V365_FRONTEND_REWRITE_BLUEPRINT.md',
    'V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md'
  ]) {
    assert.ok(fs.existsSync(path.join(DOCS, n)), '缺少文档: ' + n);
  }
});

ok('⛔ M1 骨架不得声称已完成业务实现（无伪造数据）', () => {
  const hits = [];
  for (const f of sources()) {
    const s = fs.readFileSync(f, 'utf8');
    // 骨架文件应显式标注待实现里程碑
    if (f.includes(path.join('views', '')) && f.endsWith('.vue') && !s.includes('里程碑')) {
      hits.push(path.relative(REWRITE, f));
    }
  }
  assert.equal(hits.length, 0, '视图缺里程碑声明: ' + hits.join(', '));
});

console.log('\nspec-guards.test: ' + pass + ' 项全过');
