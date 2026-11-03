#!/usr/bin/env node
'use strict';
/**
 * V3.6.4 —— B1.5 证据副本一致性检查器的**身份锚守卫**（R13 Phase B / B2）
 *
 * 【要解决的问题（B1.5 已登记的结构性缺口 ①）】
 *   `tests/v364-lock-anchor-registry-consistency.test.js`（下称"检查器"）把**权威载体**
 *   `scripts/verify-v364-immutable.js` 的身份钉成字面量（AUTH_SOURCE_SHA256_LF），
 *   但它钉不住**自己**：一个文件无法在自己的常量里钉住自己的字节（常量一改，文件字节也变
 *   ⇒ 期望值随改动一起失效）——这是自指悖论，不是实现疏忽。
 *   ⇒ 由**第二载体**承担：本文件用**字面量**记录检查器的身份，并在每次运行时与磁盘真实字节对齐。
 *
 * 【为什么是"读字节"而不是"读检查器的自述"】
 *   本守卫 ⛔ 不 require 检查器模块、⛔ 不调用它的函数、⛔ 不读它的导出。
 *   只做「磁盘字节 → CRLF→LF 归一化 → sha256」这一步。理由：
 *     ① require 会先执行检查器代码 ⇒ 语法/加载错误会以另一种根因出现，掩盖"字节被改"这一事实；
 *     ② 字节哈希对**任何**改动都必然变化（+1 字节 / 等长内容替换 / 仅改注释 / 仅改行尾）。
 *   ⇒ 字节层是比"语义自述"更强、也是唯一可行的自证外部化手段。
 *
 * 【期望值来源（⛔ 三条硬约束）】
 *   ① 期望值 = 本文件内的**字面量**；⛔ 绝不"当场重新计算当前检查器的 SHA"来生成期望值
 *      （那样两侧恒等 ⇒ 检测力为 0，退化成自我认证）。
 *   ② ⛔ 不使用 git HEAD / commit SHA / working tree 状态作为依据：
 *      本文件零 git 依赖、零子进程（只 require fs / crypto / path / assert）。
 *   ③ 锚采用**双载体声明**（GUARD_ANCHOR + GUARD_ANCHOR_MIRROR）：两处字面量必须相等，
 *      否则"单侧改动锚"会被静默吸收。手法与本仓既有先例一致
 *      （tests/gen1-ge03-regression-guard.test.js 复制三把锁锚并断言两处相等）。
 *
 * 【不变量：本守卫 ⛔ 不得成为 V364 lock 的 declaration authority】
 *   本文件 ⛔ 不读 V3.6.4 lock 载体、⛔ 不读证据副本、⛔ 不含任何 lock 身份声明。
 *   这条边界**不靠作者自觉**，而是被本文件第 3 组检查机器校验：自扫描自身源码字节，
 *   一旦出现 lock 载体名或副本载体名 ⇒ `V364_GUARD_DECLARATION_LEAK` fail-closed。
 *   ⇒ 语义边界三条同时成立：
 *      · lock 仍是**唯一** declaration authority（本守卫不声明、不消费、不读）
 *      · 证据副本仍只是 evidence copy（本守卫不读 ⇒ 它存在与否对本守卫判定**零影响**）
 *      · 副本缺失在 B3 之前 ⛔ 不得被解释成 core immutable FAIL（本守卫根本不涉及副本判定）
 *
 * 【身份链（本守卫只负责上半段）】
 *   guard 内字面量 ──(相等断言)──> 检查器磁盘字节
 *                                     └─ 检查器内字面量 ──(相等断言)──> 权威载体磁盘字节
 *   ⚠️ 本守卫**自身**的字节仍未被他物锚定（递归终点）——已登记为残余缺口，见 B2 汇报。
 *
 * 【判定（⛔ 无"静默通过"格）】
 *   锚自洽 ∧ 检查器字节 == 锚 ∧ 权威载体字节 == 锚 ⇒ PASS（exit 0）
 *   任一条不成立                                    ⇒ FAIL（exit 1）
 *   ⚠️ 锚自身不可信（形态非法 / 双载体不等）⇒ **前置 fail-closed 立即返回**：
 *      ⛔ 不再把该锚当作身份依据继续消费（与 B1 verifier「身份根不可信则停止消费」同一条纪律）。
 *
 * 用法：node tests/v364-checker-anchor-guard.test.js [--json]
 *      退出码 0 = PASS，1 = FAIL。⛔ 只读脚本：不写任何文件（合成 fixture 只落系统临时目录）。
 *      规范运行（Stage A / CI）**不带任何参数** ⇒ 不可被参数绕过。
 *
 * 稳定错误码（机器可读，判定通道 codes；每次运行恰 1 条首因码）：
 *   V364_GUARD_ANCHOR_SHAPE_INVALID   锚形态非法（path 非受锚路径 / sha 非 64-hex 小写 / 双载体 generation 不等）
 *   V364_GUARD_ANCHOR_DRIFT           双载体锚字面量不一致（单侧改动锚 ⇒ 锚已不可信）
 *   V364_GUARD_SELF_SCAN_FAILED       本守卫自身源码不可读（无法完成越界自扫描）
 *   V364_GUARD_DECLARATION_LEAK       本守卫源码出现 lock / 副本载体名（越界成 declaration surface）
 *   V364_CHECKER_MISSING              检查器文件不存在
 *   V364_CHECKER_IDENTITY_MISMATCH    检查器字节（或 size）≠ 锚（+1 字节 / 等长内容替换）
 *   V364_VERIFIER_MISSING             权威载体文件不存在
 *   V364_VERIFIER_IDENTITY_MISMATCH   权威载体字节（或 size）≠ 锚（对侧单改）
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..');

/* =====================================================================
 * 受锚对象（路径本身也是被锚内容的一部分）
 * ===================================================================== */
const CHECKER_REL = 'tests/v364-lock-anchor-registry-consistency.test.js';
const VERIFIER_REL = 'scripts/verify-v364-immutable.js';
const GUARD_REL = 'tests/v364-checker-anchor-guard.test.js';

/* =====================================================================
 * 锚 —— 主载体声明（⚠️ 全部为**字面量**；⛔ 不得改为运行时复算）
 * ===================================================================== */
const GUARD_ANCHOR = {
  generation: 'V3.6.4',
  carrier: 'CHECKER_IDENTITY_ANCHOR',
  checker: {
    path: CHECKER_REL,
    sha256_lf: '36506bfbe0d87ee2d9a52ac1a80dce8e16b1d44696675c9ef0ee973e1b8e172d',
    size_bytes: 31306,
  },
  verifier: {
    path: VERIFIER_REL,
    sha256_lf: '9a5ccdf8149ce39850d25327add914a9c65d5ded3fdf220f68c7b68e9c68f4ee',
    size_bytes: 30342,
  },
};

/**
 * 锚 —— 第二处声明（镜像；只含身份字段，⛔ 不含任何 lock / 副本身份）。
 * ⚠️ 与主载体必须逐字段相等 —— 这正是"单侧改动锚即红"的封堵点。
 */
const GUARD_ANCHOR_MIRROR = {
  generation: 'V3.6.4',
  checker_sha256_lf: '36506bfbe0d87ee2d9a52ac1a80dce8e16b1d44696675c9ef0ee973e1b8e172d',
  verifier_sha256_lf: '9a5ccdf8149ce39850d25327add914a9c65d5ded3fdf220f68c7b68e9c68f4ee',
};

/**
 * 越界自扫描 token（lock 载体名 / 副本载体名）。
 * ⚠️ 必须由**拼接**构造：若写成完整字面量，本文件会命中自己 ⇒ 恒假阳性。
 */
const LEAK_TOKENS = [
  'V364_IMMUTABLE' + '_LOCK',
  'V364_LOCK_ANCHOR' + '_REGISTRY',
];

const SHA64_RE = /^[0-9a-f]{64}$/;

/* =====================================================================
 * 工具
 * ===================================================================== */
function abs(rel) {
  return path.join(REPO, rel.split('/').join(path.sep));
}
/** 行尾口径与 V364 链一致：CRLF→LF 归一化后再 sha256 / 再计长（canonical LF）。 */
function lfNormalize(buf) {
  return buf.toString('utf8').replace(/\r\n/g, '\n');
}
function sha256LfBuffer(buf) {
  return crypto.createHash('sha256').update(lfNormalize(buf), 'utf8').digest('hex');
}
/**
 * 规范字节长度（canonical LF UTF-8）：先 CRLF→LF 归一化，再取 UTF-8 字节数。
 * ⚠️ 口径必须与 sha256LfBuffer 同源：两者描述**同一份** canonical LF 内容。
 * ⛔ 不得改用 buf.length（原始 checkout 字节数：Windows=CRLF / Linux=LF ⇒ 必然分裂）。
 */
function canonicalSizeLf(buf) {
  return Buffer.byteLength(lfNormalize(buf), 'utf8');
}
function isSha64(v) {
  return typeof v === 'string' && SHA64_RE.test(v);
}
function shortSha(v) {
  return String(v).slice(0, 16) + '\u2026';
}
function readBytes(p) {
  return fs.readFileSync(p);
}

/* =====================================================================
 * 检查主体（纯函数；⛔ 零写操作、零子进程、零 git）
 *
 * opts 仅供**证明 harness** 使用（默认 = 规范路径 / 规范锚）。
 * ⚠️ 规范运行（Stage A / CI）**不带任何 opts** ⇒ CI 上不可能被参数绕过。
 * ===================================================================== */
function checkAnchors(opts) {
  const o = opts || {};
  const checkerAbs = o.checkerAbs ? String(o.checkerAbs) : abs(CHECKER_REL);
  const verifierAbs = o.verifierAbs ? String(o.verifierAbs) : abs(VERIFIER_REL);
  const selfAbs = o.selfAbs ? String(o.selfAbs) : __filename;
  const primary = o.anchor ? o.anchor : GUARD_ANCHOR;
  const mirror = o.mirror ? o.mirror : GUARD_ANCHOR_MIRROR;

  const errors = [];
  const err = (code, detail) => { errors.push({ code: code, detail: detail }); };

  const result = {
    guard: GUARD_REL,
    generation: String(primary.generation),
    status: null,
    ok: false,
    codes: [],
    errors: errors,
    anchor: { primary: primary, mirror: mirror },
    observed: { checker: null, verifier: null },
    self_scan: null,
    boundary: {
      lock_declaration_authority: 'V3.6.4 lock（本守卫⛔不读 / ⛔不声明 / ⛔不消费）',
      evidence_copy: '证据副本 evidence copy（本守卫⛔不读 ⇒ 其存在与否对本守卫判定零影响）',
      registry_absent_is_not_core_fail: true,
      guard_is_lock_declaration_authority: false,
    },
    git_dependency: 'NONE',
    /* ⚠️ 精确口径：判定主体（checkAnchors）零写操作；本文件唯一写 API 只用于
       自检的合成 fixture，落点 = 系统临时目录（os.tmpdir()），⛔ 从不写载体树。 */
    writes_carrier_tree: false,
    temp_fixture_writes: 'self-test only（os.tmpdir()）',
  };

  const finish = (status) => {
    result.status = status;
    result.ok = errors.length === 0;
    result.codes = errors.map((e) => e.code);
    return result;
  };

  /* ---------- 组 1：锚形态（单一根因 → 单一码） ---------- */
  let shapeOk = false;
  let shapeDetail = '';
  try {
    shapeOk = isSha64(primary.checker.sha256_lf)
      && isSha64(primary.verifier.sha256_lf)
      && isSha64(mirror.checker_sha256_lf)
      && isSha64(mirror.verifier_sha256_lf)
      && String(primary.checker.path) === CHECKER_REL
      && String(primary.verifier.path) === VERIFIER_REL
      && String(primary.generation) === String(mirror.generation);
  } catch (e) {
    shapeOk = false;
    shapeDetail = '锚对象形态异常：' + e.message;
  }
  if (!shapeOk) {
    err('V364_GUARD_ANCHOR_SHAPE_INVALID',
      '锚形态非法（sha 须 64-hex 小写 / path 须与受锚路径逐字一致 / 双载体 generation 须相等）'
      + (shapeDetail ? '；' + shapeDetail : ''));
    return finish('ANCHOR_INVALID');
  }

  /* ---------- 组 2：双载体锚一致性（单侧改锚即红） ---------- */
  const driftChecker = String(primary.checker.sha256_lf) !== String(mirror.checker_sha256_lf);
  const driftVerifier = String(primary.verifier.sha256_lf) !== String(mirror.verifier_sha256_lf);
  if (driftChecker || driftVerifier) {
    err('V364_GUARD_ANCHOR_DRIFT',
      '双载体锚字面量不等（单侧改动锚）'
      + '：' + (driftChecker ? 'checker ' : '') + (driftVerifier ? 'verifier ' : '')
      + '⇒ 锚已不可信，fail-closed 终止');
    return finish('ANCHOR_DRIFT');
  }

  /* ---------- 组 3：越界自扫描（⛔ 不得成为 lock declaration surface） ---------- */
  try {
    const selfText = lfNormalize(readBytes(selfAbs));
    const hits = LEAK_TOKENS.filter((t) => selfText.indexOf(t) >= 0);
    result.self_scan = { path: selfAbs, hits: hits.length, leak: hits.length > 0, tokens: hits };
    if (hits.length) {
      err('V364_GUARD_DECLARATION_LEAK',
        '本守卫源码出现越界载体名 ' + hits.join(' / ')
        + ' ⇒ 语义边界被破坏（fail-closed，⛔ 不继续判定）');
      return finish('DECLARATION_LEAK');
    }
  } catch (e) {
    err('V364_GUARD_SELF_SCAN_FAILED', '自身源码不可读：' + e.message);
    return finish('SELF_SCAN_FAILED');
  }

  /* ---------- 组 4：受锚对象 —— 检查器（身份对齐） ---------- */
  if (!fs.existsSync(checkerAbs)) {
    err('V364_CHECKER_MISSING', checkerAbs + ' 不存在（第二载体无法完成身份对齐，fail-closed）');
    return finish('CHECKER_MISSING');
  }
  const checkerBuf = readBytes(checkerAbs);
  const checkerSha = sha256LfBuffer(checkerBuf);
  const checkerSize = canonicalSizeLf(checkerBuf);
  result.observed.checker = {
    path: checkerAbs, size_bytes: checkerSize, sha256_lf: checkerSha,
  };
  if (checkerSha !== primary.checker.sha256_lf || checkerSize !== Number(primary.checker.size_bytes)) {
    err('V364_CHECKER_IDENTITY_MISMATCH',
      '检查器字节 ≠ 锚：actual=' + shortSha(checkerSha) + '/size=' + checkerSize
      + ' anchor=' + shortSha(primary.checker.sha256_lf) + '/size=' + primary.checker.size_bytes);
    return finish('CHECKER_IDENTITY_MISMATCH');
  }

  /* ---------- 组 5：对侧载体 —— 权威载体（防"对侧单改"） ---------- */
  if (!fs.existsSync(verifierAbs)) {
    err('V364_VERIFIER_MISSING', verifierAbs + ' 不存在（对侧身份无法对齐，fail-closed）');
    return finish('VERIFIER_MISSING');
  }
  const verifierBuf = readBytes(verifierAbs);
  const verifierSha = sha256LfBuffer(verifierBuf);
  const verifierSize = canonicalSizeLf(verifierBuf);
  result.observed.verifier = {
    path: verifierAbs, size_bytes: verifierSize, sha256_lf: verifierSha,
  };
  if (verifierSha !== primary.verifier.sha256_lf || verifierSize !== Number(primary.verifier.size_bytes)) {
    err('V364_VERIFIER_IDENTITY_MISMATCH',
      '权威载体字节 ≠ 锚：actual=' + shortSha(verifierSha) + '/size=' + verifierSize
      + ' anchor=' + shortSha(primary.verifier.sha256_lf) + '/size=' + primary.verifier.size_bytes);
    return finish('VERIFIER_IDENTITY_MISMATCH');
  }

  return finish('PASS');
}

/* =====================================================================
 * 人类可读输出
 * ===================================================================== */
function printHuman(r) {
  const a = (r.anchor && r.anchor.primary) || {};
  const ac = a.checker || {};
  const av = a.verifier || {};
  console.log('== B2 checker identity anchor guard ==');
  console.log('  锚（双载体声明）: generation=' + r.generation);
  console.log('    checker   锚: ' + shortSha(ac.sha256_lf) + '  size=' + ac.size_bytes);
  console.log('    verifier  锚: ' + shortSha(av.sha256_lf) + '  size=' + av.size_bytes);
  if (r.observed && r.observed.checker) {
    console.log('    checker 实测: ' + shortSha(r.observed.checker.sha256_lf)
      + '  size=' + r.observed.checker.size_bytes);
  }
  if (r.observed && r.observed.verifier) {
    console.log('    verifier实测: ' + shortSha(r.observed.verifier.sha256_lf)
      + '  size=' + r.observed.verifier.size_bytes);
  }
  console.log('  语义边界: lock=' + r.boundary.lock_declaration_authority);
  console.log('            副本=本守卫⛔不读（缺失不影响本守卫判定）');
  console.log('            git 依赖=' + r.git_dependency
    + ' · 写载体树=' + r.writes_carrier_tree
    + ' · 临时 fixture 写=' + r.temp_fixture_writes);
  console.log('  判定: ' + (r.ok ? '\u2713 ' : '\u2717 ') + r.status
    + (r.ok ? '' : ' \u2014 codes=' + r.codes.join(',')));
}

/* =====================================================================
 * 自检（⛔ 只在作为主模块运行时执行；被 require 时不跑，供 harness 调用）
 * 合成 fixture 全部落在系统临时目录 ⇒ ⛔ 不污染载体树。
 * ===================================================================== */
function selfTest() {
  const cases = [];
  const failures = [];
  function ok(name, fn) {
    cases.push(name);
    try {
      fn();
      console.log('  \u2713 ' + name);
    } catch (e) {
      failures.push({ name: name, msg: e.message });
      console.log('  \u2717 ' + name + ' \u2014 ' + e.message);
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v364-b2-'));
  const put = (name, buf) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, buf);
    return p;
  };

  const realChecker = abs(CHECKER_REL);
  const realVerifier = abs(VERIFIER_REL);
  const realCheckerBytes = readBytes(realChecker);
  const realVerifierBytes = readBytes(realVerifier);
  const beforeChecker = sha256LfBuffer(realCheckerBytes);
  const beforeVerifier = sha256LfBuffer(realVerifierBytes);
  const after = (p) => sha256LfBuffer(readBytes(p));

  try {
    const canonical = checkAnchors();
    console.log('');
    printHuman(canonical);
    console.log('');
    console.log('-- 自检（合成 fixture 落系统临时目录；⛔ 不写载体树）--');
    console.log('-- 1) 正向：锚定身份对齐 --');

    ok('1. canonical（无 opts）⇒ PASS 且 codes 为空', () => {
      assert.strictEqual(canonical.status, 'PASS',
        'status=' + canonical.status + ' codes=' + canonical.codes.join(','));
      assert.strictEqual(canonical.ok, true);
      assert.deepStrictEqual(canonical.codes, []);
    });
    ok('2. 锚双载体逐字段相等（单侧改动锚的封堵点）', () => {
      assert.strictEqual(GUARD_ANCHOR.checker.sha256_lf, GUARD_ANCHOR_MIRROR.checker_sha256_lf,
        'checker 锚双载体不等');
      assert.strictEqual(GUARD_ANCHOR.verifier.sha256_lf, GUARD_ANCHOR_MIRROR.verifier_sha256_lf,
        'verifier 锚双载体不等');
      assert.strictEqual(GUARD_ANCHOR.generation, GUARD_ANCHOR_MIRROR.generation);
    });
    ok('3. 锚形态：四条 sha 均 64-hex 小写 · path 与受锚路径逐字一致', () => {
      [GUARD_ANCHOR.checker.sha256_lf, GUARD_ANCHOR.verifier.sha256_lf,
        GUARD_ANCHOR_MIRROR.checker_sha256_lf, GUARD_ANCHOR_MIRROR.verifier_sha256_lf]
        .forEach((s) => assert.ok(isSha64(s), '非法 sha：' + s));
      assert.strictEqual(GUARD_ANCHOR.checker.path, CHECKER_REL);
      assert.strictEqual(GUARD_ANCHOR.verifier.path, VERIFIER_REL);
    });
    ok('4. 检查器磁盘字节 == 锚（LF-sha256 + size 双钉）', () => {
      assert.strictEqual(beforeChecker, GUARD_ANCHOR.checker.sha256_lf);
      assert.strictEqual(canonicalSizeLf(realCheckerBytes), GUARD_ANCHOR.checker.size_bytes);
    });
    ok('5. 权威载体磁盘字节 == 锚（LF-sha256 + size 双钉）', () => {
      assert.strictEqual(beforeVerifier, GUARD_ANCHOR.verifier.sha256_lf);
      assert.strictEqual(canonicalSizeLf(realVerifierBytes), GUARD_ANCHOR.verifier.size_bytes);
    });
    ok('6. 越界自扫描：本守卫源码对 lock / 副本载体名零命中', () => {
      const selfText = lfNormalize(readBytes(__filename));
      LEAK_TOKENS.forEach((t) => {
        assert.strictEqual(selfText.indexOf(t), -1, '命中越界 token：' + t);
      });
    });

    console.log('-- 2) 负向：检查器字节类（均命中单一稳定码）--');
    ok('7. 检查器副本 +1 字节 ⇒ V364_CHECKER_IDENTITY_MISMATCH', () => {
      const p = put('checker_plus1.js', Buffer.concat([realCheckerBytes, Buffer.from(' ', 'utf8')]));
      const r = checkAnchors({ checkerAbs: p });
      assert.strictEqual(r.status, 'CHECKER_IDENTITY_MISMATCH');
      assert.strictEqual(r.codes.join(','), 'V364_CHECKER_IDENTITY_MISMATCH');
    });
    ok('8. 检查器副本等长内容替换 ⇒ V364_CHECKER_IDENTITY_MISMATCH', () => {
      const t = realCheckerBytes.toString('utf8');
      const needle = 'PLACEHOLDER_TOKENS';
      const i = t.indexOf(needle);
      assert.ok(i >= 0, '锚点 ' + needle + ' 缺失');
      const mutated = t.slice(0, i) + 'PLACEHOLDER_TOKENX' + t.slice(i + needle.length);
      assert.strictEqual(canonicalSizeLf(Buffer.from(mutated, 'utf8')), canonicalSizeLf(realCheckerBytes),
        '等长前提不成立（本用例要求 canonical size 不变，以证明拦截来自 hash 而非 size）');
      const r = checkAnchors({ checkerAbs: put('checker_mutated.js', Buffer.from(mutated, 'utf8')) });
      assert.strictEqual(r.codes.join(','), 'V364_CHECKER_IDENTITY_MISMATCH');
    });

    console.log('-- 3) 负向：锚漂移 / 锚形态 --');
    ok('9. 锚单侧漂移（仅镜像改值）⇒ V364_GUARD_ANCHOR_DRIFT', () => {
      const badMirror = Object.assign({}, GUARD_ANCHOR_MIRROR, { checker_sha256_lf: 'f'.repeat(64) });
      const r = checkAnchors({ mirror: badMirror });
      assert.strictEqual(r.status, 'ANCHOR_DRIFT');
      assert.strictEqual(r.codes.join(','), 'V364_GUARD_ANCHOR_DRIFT');
    });
    ok('10. 锚双载体一致改成错值 ⇒ V364_CHECKER_IDENTITY_MISMATCH', () => {
      const wrong = 'f'.repeat(64);
      const badAnchor = {
        generation: GUARD_ANCHOR.generation,
        carrier: GUARD_ANCHOR.carrier,
        checker: Object.assign({}, GUARD_ANCHOR.checker, { sha256_lf: wrong }),
        verifier: GUARD_ANCHOR.verifier,
      };
      const badMirror = Object.assign({}, GUARD_ANCHOR_MIRROR, { checker_sha256_lf: wrong });
      const r = checkAnchors({ anchor: badAnchor, mirror: badMirror });
      assert.strictEqual(r.status, 'CHECKER_IDENTITY_MISMATCH');
      assert.strictEqual(r.codes.join(','), 'V364_CHECKER_IDENTITY_MISMATCH');
    });
    ok('11. 锚形态非法（sha 截断）⇒ V364_GUARD_ANCHOR_SHAPE_INVALID', () => {
      const badAnchor = {
        generation: GUARD_ANCHOR.generation,
        carrier: GUARD_ANCHOR.carrier,
        checker: Object.assign({}, GUARD_ANCHOR.checker, { sha256_lf: 'abc' }),
        verifier: GUARD_ANCHOR.verifier,
      };
      const r = checkAnchors({ anchor: badAnchor });
      assert.strictEqual(r.status, 'ANCHOR_INVALID');
      assert.strictEqual(r.codes.join(','), 'V364_GUARD_ANCHOR_SHAPE_INVALID');
    });

    console.log('-- 4) 负向：缺失 / 越界注入 --');
    ok('12. 检查器缺失 ⇒ V364_CHECKER_MISSING', () => {
      const r = checkAnchors({ checkerAbs: path.join(tmp, 'no_such_checker.js') });
      assert.strictEqual(r.status, 'CHECKER_MISSING');
      assert.strictEqual(r.codes.join(','), 'V364_CHECKER_MISSING');
    });
    ok('13. 权威载体缺失 ⇒ V364_VERIFIER_MISSING', () => {
      const r = checkAnchors({ verifierAbs: path.join(tmp, 'no_such_verifier.js') });
      assert.strictEqual(r.status, 'VERIFIER_MISSING');
      assert.strictEqual(r.codes.join(','), 'V364_VERIFIER_MISSING');
    });
    ok('14. 越界 tripwire：自身源码出现 lock 载体名 ⇒ V364_GUARD_DECLARATION_LEAK', () => {
      const p = put('self_with_leak.js', Buffer.from('// probe: ' + LEAK_TOKENS[0] + '\n', 'utf8'));
      const r = checkAnchors({ selfAbs: p });
      assert.strictEqual(r.status, 'DECLARATION_LEAK');
      assert.strictEqual(r.codes.join(','), 'V364_GUARD_DECLARATION_LEAK');
    });

    console.log('-- 5) 语义边界 / 只读性 / 判定唯一性 --');
    ok('15. 语义边界：guard 非 lock authority · 副本零依赖 · git 零依赖 · 判定主体零写', () => {
      assert.strictEqual(canonical.boundary.guard_is_lock_declaration_authority, false);
      assert.strictEqual(canonical.boundary.registry_absent_is_not_core_fail, true);
      assert.strictEqual(canonical.git_dependency, 'NONE');
      assert.strictEqual(canonical.writes_carrier_tree, false);
      assert.deepStrictEqual(canonical.self_scan.tokens, []);
      assert.strictEqual(canonical.self_scan.leak, false);
    });
    ok('16. 只读性：全流程结束后受锚两文件字节与自检开始时逐字节一致', () => {
      assert.strictEqual(after(realChecker), beforeChecker, '检查器字节被改动');
      assert.strictEqual(after(realVerifier), beforeVerifier, '权威载体字节被改动');
    });
    ok('17. 判定唯一性：任一失败场景恰 1 条稳定码（无重复根因码）', () => {
      const probes = [
        [{ checkerAbs: path.join(tmp, 'x1.js') }, 'V364_CHECKER_MISSING'],
        [{ checkerAbs: put('plus1b.js', Buffer.concat([realCheckerBytes, Buffer.from('\n', 'utf8')])) },
          'V364_CHECKER_IDENTITY_MISMATCH'],
        [{ mirror: Object.assign({}, GUARD_ANCHOR_MIRROR, { verifier_sha256_lf: 'a'.repeat(64) }) },
          'V364_GUARD_ANCHOR_DRIFT'],
        [{ verifierAbs: path.join(tmp, 'x2.js') }, 'V364_VERIFIER_MISSING'],
      ];
      probes.forEach((pr) => {
        const r = checkAnchors(pr[0]);
        assert.strictEqual(r.codes.length, 1, 'codes=' + r.codes.join(','));
        assert.strictEqual(r.codes[0], pr[1]);
      });
    });
  } catch (e) {
    console.log('  \u2717 自检异常（未捕获）: ' + (e && e.message ? e.message : String(e)));
    failures.push({ name: '自检异常（未捕获）', msg: String(e && e.message ? e.message : e) });
  } finally {
    try {
      fs.readdirSync(tmp).forEach((f) => fs.unlinkSync(path.join(tmp, f)));
      fs.rmdirSync(tmp);
    } catch (e) {
      console.log('  \u26a0\ufe0f 临时目录清理: ' + e.message);
    }
  }

  console.log('\n自检：' + (cases.length - failures.length) + '/' + cases.length + ' 项通过');
  if (failures.length) {
    failures.forEach((f) => console.log('   \u2717 ' + f.name + ': ' + f.msg));
    process.exit(1);
  }
  console.log('v364-checker-anchor-guard: ' + cases.length + '/' + cases.length + ' passed');
}

/* =====================================================================
 * 入口
 * ===================================================================== */
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--json') >= 0) {
    const r = checkAnchors();
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (argv.length) {
    console.log('未知参数：' + argv.join(' ') + '（本脚本仅支持 --json）');
    process.exit(1);
  }
  selfTest();
}

module.exports = {
  checkAnchors: checkAnchors,
  GUARD_ANCHOR: GUARD_ANCHOR,
  GUARD_ANCHOR_MIRROR: GUARD_ANCHOR_MIRROR,
  LEAK_TOKENS: LEAK_TOKENS,
  CHECKER_REL: CHECKER_REL,
  VERIFIER_REL: VERIFIER_REL,
  GUARD_REL: GUARD_REL,
  sha256LfBuffer: sha256LfBuffer,
  canonicalSizeLf: canonicalSizeLf,
};
