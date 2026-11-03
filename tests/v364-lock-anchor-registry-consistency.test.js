#!/usr/bin/env node
'use strict';
/**
 * V3.6.4 证据副本（evidence copy）一致性检查器 —— R13 Phase B / B1.5
 *
 * 【要解决的问题】
 *   B3 将落地 ml/manifests/V364_LOCK_ANCHOR_REGISTRY.json（证据副本）。副本里会**复制**
 *   一份身份证据：L0 四字段（lock path / lock LF-sha256 / generation / freeze_commit）
 *   与 surface baseline 身份（条数 + 规范 sha256）。
 *   一旦副本与权威载体「静默分叉」（有人只改一边、两边各自都自洽），治理依据就出现两个版本，
 *   而且是**没人会收到报错**的那种分叉。本检查器把这条边变成可执行断言：
 *   副本 ⇄ 权威载体 必须逐字段一致；不一致即 FAIL。
 *
 * 【方向：单向，⛔ 不可反转】
 *   权威载体（authoritative source）= scripts/verify-v364-immutable.js（B1 产物）
 *   被检对象（evidence copy）      = ml/manifests/V364_LOCK_ANCHOR_REGISTRY.json
 *   ⛔ 本检查器**绝不**从 registry 取任何"真值"；⛔ 绝不写 registry；⛔ 绝不改 lock。
 *   registry 只是 governance/evidence record —— 主载体仍是 verifier 内嵌常量。
 *
 * 【为什么本文件落在 tests/ 而不是 scripts/】
 *   `scripts/` 落在 V3.6.4 governed surface 内（面根由 lock 自身推导，含 scripts/）。
 *   往受管面新增文件必须扩 `SURFACE_EXCLUSIONS`；而 B1 的负向证明 NEG-3.c / NEG-3.f 恰好把
 *   「EXCL 恰 1 项 == verifier 自身」与「去掉 EXCL ⇒ residual 恰为 [verifier]」钉死
 *   ⇒ 扩 EXCL 会**直接打破 B1 的 33/0**。
 *   `tests/` 在 governed surface 之外 ⇒ 本文件对 B1 产物零侵入，且被 test-all.js Stage A
 *   自动发现（`.test.js` 通配）⇒ 无需改 CI 即获得执行通道。
 *
 * 【行为矩阵（2×2，⛔ 不存在"静默通过"格里）】
 *   registry 缺失 + REGISTRY_LANDING_REQUIRED=false → status=NOT_LANDED（⚠️ 这不是"一致性通过"）
 *   registry 缺失 + REGISTRY_LANDING_REQUIRED=true  → status=MISSING   → FAIL
 *   registry 存在 + 逐字段一致                      → status=CONSISTENT → PASS
 *   registry 存在 + 任一字段不一致                  → status=MISMATCH   → FAIL
 *   REGISTRY_LANDING_REQUIRED 由 B3 落地时置 true（单行、可 review）——
 *   ⛔ 否则「把 registry 删掉」就永远静默变绿，检查器形同虚设。
 *
 * 【与 B1 verifier 的分工（⛔ 不是重复劳动）】
 *   verifier 校验的是「registry.surface_baseline 与主载体一致」这一**条**边；
 *   本检查器校验**整个证据副本的全部被复制字段**（4 L0 × 值、baseline 条数 + 规范 sha、
 *   authorization 层的 BL-2 语义），并额外把**权威载体自身的身份**钉成字面量
 *   （AUTH_SOURCE_SHA256_LF）——verifier 无法自我钉身份（自指），只能由第二载体承担。
 *
 * ⛔ 授权边界（本轮）：不改 lock、不改 registry、不改 CI、不改 verifier、不 commit。
 *
 * 用法：node tests/v364-lock-anchor-registry-consistency.test.js
 *      退出码 0 = 通过（含 NOT_LANDED 披露态），1 = 失败。
 *
 * 稳定错误码（机器可读）：
 *   两条通道：result.codes = **判定**错误码（非空即 FAIL）；result.info_codes = **披露**码。
 *   ⚠️ 披露码不得被当作「通过」依据（尤其 NOT_LANDED ≠ CONSISTENT）。
 *   V364_AUTH_SOURCE_MISSING               权威载体缺失/不可加载
 *   V364_AUTH_SOURCE_HASH_MISMATCH          权威载体 LF-sha256 ≠ 本检查器钉死值（载体被改）
 *   V364_AUTH_SOURCE_FIELD_MISMATCH         权威导出 ≠ 本检查器独立字面量（交叉载体分叉）
 *   V364_REGISTRY_NOT_LANDED                副本未落地（INFO；⚠️ 非"一致性通过"）
 *   V364_REGISTRY_MISSING                   副本应当存在但缺失（landingRequired=true 时）
 *   V364_REGISTRY_UNPARSABLE                副本不是合法 JSON 对象
 *   V364_REGISTRY_FORBIDDEN_TOPLEVEL_KEY    顶层出现 files/sha256（第二份 declaration authority）
 *   V364_REGISTRY_IDENTITY_MISSING          identity 层/字段缺失
 *   V364_REGISTRY_IDENTITY_MISMATCH         身份字段 ≠ 权威值
 *   V364_REGISTRY_LOCK_SHA_NOT_ON_DISK      副本声称的 lock sha ≠ 磁盘真实 lock 字节
 *   V364_REGISTRY_BASELINE_MISSING          surface_baseline 缺失/形态不符
 *   V364_REGISTRY_BASELINE_MISMATCH         baseline 条数或规范 sha256 ≠ 主载体
 *   V364_REGISTRY_AUTHORIZATION_MISSING     authorization 层缺失
 *   V364_REGISTRY_AUTHORIZATION_PLACEHOLDER authorization 字段为占位符/空值（BL-2）
 *   V364_REGISTRY_AUTHORIZATION_FAKE_SHA    authorization 携带 SHA 形态字段/伪 SHA（BL-2）
 *   V364_REGISTRY_AUTHORIZATION_SHAPE_INVALID authorization 可选字段形态不合法
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..');

/* =====================================================================
 * 权威载体（authoritative source）
 *
 * ⚠️ 自指约束：权威载体**无法**在自己的常量里钉住自己的字节（改一行即自失效）。
 *    ⇒ 它的身份只能由**第二载体**钉住，本文件即承担此责。
 *    这也是「只改 verifier 就悄悄改变判定基准」这条路的封堵点。
 * ===================================================================== */
const AUTH_SOURCE_REL = 'scripts/verify-v364-immutable.js';
const AUTH_SOURCE_SHA256_LF = '9a5ccdf8149ce39850d25327add914a9c65d5ded3fdf220f68c7b68e9c68f4ee';

/* =====================================================================
 * 证据副本（evidence copy，B3 落地）
 * ===================================================================== */
const REGISTRY_REL = 'ml/manifests/V364_LOCK_ANCHOR_REGISTRY.json';
/** ⛔ B3 落地 registry 时**必须**同步置 true；否则删除副本会静默变绿。 */
const REGISTRY_LANDING_REQUIRED = true;

/* =====================================================================
 * 交叉载体字面量（与 verifier 内嵌值独立抄写；任一侧单改即红）
 *
 * 语义声明：freeze_commit 是**声明式 attestation**（R7-IMPL-7 禁 git/tag 运行时依赖）
 * ⇒ 本检查器只断言「副本抄写值 == 权威声明值」，⛔ 不声称它被独立校验过。
 * ===================================================================== */
const EXPECTED_L0 = {
  lock_path: 'ml/manifests/V364_IMMUTABLE_LOCK.json',
  lock_sha256_lf: '0b4a95bee3470cebc7adc230291946bc598b5187d9abe1cdb5bf3f44eb91ff72',
  generation: 'V3.6.4',
  freeze_commit: 'aa634e264270f26207c59c19ef3e1c31dde01e64',
};
const L0_FIELDS = ['lock_path', 'lock_sha256_lf', 'generation', 'freeze_commit'];
const ATTESTATION_ONLY_FIELDS = ['freeze_commit'];

const EXPECTED_BASELINE_N = 246;
const EXPECTED_BASELINE_SHA256 = '8f8443306b8e944a5a9de29c9625c1af1e0b5ed62ddd0c366d1644e21ff2e03c';

/** 顶层禁键：出现即意味着副本成了第二份 declaration authority（BL-2 / R7-IMPL-5 口径）。 */
const FORBIDDEN_TOPLEVEL_KEYS = ['files', 'sha256'];

/** authorization 层必填（BL-2 逐字：字段语义是**决策引用**，不是 commit SHA）。 */
const AUTHORIZATION_REQUIRED_FIELDS = ['authorization_ref', 'authorization_decision'];

/**
 * 占位符黑名单（BL-2 逐字点名 PENDING / TBD / HEAD / 占位符）。
 * ⛔ 一条 authorization 字段若命中此处即 FAIL —— 治理记录**不许**先占位后补。
 */
const PLACEHOLDER_TOKENS = [
  'pending', 'tbd', 'tba', 'todo', 'fixme', 'placeholder', 'unknown', 'n/a', 'na',
  'head', 'null', 'undefined', 'none', 'xxx', 'yyy', 'zzz',
];

/* =====================================================================
 * 工具
 * ===================================================================== */
function abs(rel) {
  return path.join(REPO, rel.split('/').join(path.sep));
}
function lfNormalize(buf) {
  return buf.toString('utf8').replace(/\r\n/g, '\n');
}
function sha256LfBuffer(buf) {
  return require('crypto').createHash('sha256').update(lfNormalize(buf), 'utf8').digest('hex');
}
function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function isPlaceholder(v) {
  const t = String(v).trim().toLowerCase();
  if (!t) return true;
  if (/[<>]/.test(t)) return true;
  return PLACEHOLDER_TOKENS.indexOf(t) >= 0;
}
function isSha40(v) {
  return /^[0-9a-f]{40}$/.test(String(v).trim().toLowerCase());
}

/* =====================================================================
 * 检查主体（纯函数；⛔ 零写操作）
 *
 * opts 仅供**证明 harness** 使用（默认 = 规范路径 / 规范要求态）。
 * ⚠️ 规范运行（test-all.js Stage A）**不带任何 opts** ⇒ CI 上不可能被参数绕过。
 * ===================================================================== */
function checkConsistency(opts) {
  const o = opts || {};
  const registryAbs = o.registryAbs ? String(o.registryAbs) : abs(REGISTRY_REL);
  const authAbs = o.authSourceAbs ? String(o.authSourceAbs) : abs(AUTH_SOURCE_REL);
  const authShaExpected = o.authSourceSha ? String(o.authSourceSha) : AUTH_SOURCE_SHA256_LF;
  const landingRequired = o.landingRequired === undefined
    ? REGISTRY_LANDING_REQUIRED : !!o.landingRequired;

  const errors = [];
  const infos = [];
  const err = (code, detail) => errors.push({ code: code, detail: detail });
  const info = (code, detail) => infos.push({ code: code, detail: detail });

  const result = {
    status: null,
    ok: false,
    consistent: false,
    errors: errors,
    infos: infos,
    codes: [],
    info_codes: [],
    registry_path: registryAbs,
    registry_landing_required: landingRequired,
    auth_source_path: authAbs,
    auth_source_sha256_lf_actual: null,
    auth_source_sha256_lf_expected: authShaExpected,
    auth_source_fields_checked: 0,
    registry_identity_present: false,
    registry_baseline_sha256_actual: null,
    registry_authorization_fields_checked: 0,
    attestation_only: ATTESTATION_ONLY_FIELDS.slice(),
    lock_sha256_lf_on_disk: null,
  };
  const finish = (status) => {
    result.status = status;
    result.codes = errors.map((e) => e.code);
    result.info_codes = infos.map((i) => i.code);
    result.ok = errors.length === 0;
    result.consistent = status === 'CONSISTENT';
    return result;
  };

  /* ---- ① 权威载体：存在 + 身份（LF-sha256）---- */
  if (!fs.existsSync(authAbs)) {
    err('V364_AUTH_SOURCE_MISSING', authAbs + ' 不存在（B1 产物未落地/被删）');
    return finish('AUTH_SOURCE_INVALID');
  }
  result.auth_source_sha256_lf_actual = sha256LfBuffer(fs.readFileSync(authAbs));
  if (result.auth_source_sha256_lf_actual !== authShaExpected) {
    err('V364_AUTH_SOURCE_HASH_MISMATCH',
      AUTH_SOURCE_REL + ' LF-sha256=' + result.auth_source_sha256_lf_actual.slice(0, 16)
      + '… ≠ 本检查器钉死值 ' + authShaExpected.slice(0, 16) + '…（权威载体被改动 ⇒ 判定基准不可信）');
    return finish('AUTH_SOURCE_INVALID');
  }
  let auth;
  try {
    auth = require(authAbs);
  } catch (e) {
    err('V364_AUTH_SOURCE_MISSING', 'require 失败: ' + e.message);
    return finish('AUTH_SOURCE_INVALID');
  }

  /* ---- ② 交叉载体：权威**导出** == 本文件**独立字面量** ----
   * 这一条把「只改 verifier 常量」与「只改本文件常量」都变成红：
   * 两侧必须同时改才可能一致 ⇒ 单侧静默漂移不可能。 */
  const ra = auth.ROOT_ANCHOR_V364 || {};
  for (let i = 0; i < L0_FIELDS.length; i++) {
    const f = L0_FIELDS[i];
    result.auth_source_fields_checked += 1;
    if (String(ra[f]) !== EXPECTED_L0[f]) {
      err('V364_AUTH_SOURCE_FIELD_MISMATCH',
        'authoritative.ROOT_ANCHOR_V364.' + f + '=' + String(ra[f])
        + ' ≠ 检查器字面量 ' + EXPECTED_L0[f]);
    }
  }
  if (auth.SURFACE_BASELINE_N !== EXPECTED_BASELINE_N) {
    err('V364_AUTH_SOURCE_FIELD_MISMATCH',
      'authoritative.SURFACE_BASELINE_N=' + String(auth.SURFACE_BASELINE_N) + ' ≠ ' + EXPECTED_BASELINE_N);
  }
  if (String(auth.SURFACE_BASELINE_SHA256) !== EXPECTED_BASELINE_SHA256) {
    err('V364_AUTH_SOURCE_FIELD_MISMATCH',
      'authoritative.SURFACE_BASELINE_SHA256=' + String(auth.SURFACE_BASELINE_SHA256)
      + ' ≠ 检查器字面量 ' + EXPECTED_BASELINE_SHA256);
  }
  if (!Array.isArray(auth.SURFACE_BASELINE_PATHS)
    || auth.SURFACE_BASELINE_PATHS.length !== EXPECTED_BASELINE_N) {
    err('V364_AUTH_SOURCE_FIELD_MISMATCH',
      'authoritative.SURFACE_BASELINE_PATHS 非数组或条数 ≠ ' + EXPECTED_BASELINE_N);
  }
  if (String(auth.BASELINE_REGISTRY_REL) !== REGISTRY_REL) {
    err('V364_AUTH_SOURCE_FIELD_MISMATCH',
      'authoritative.BASELINE_REGISTRY_REL=' + String(auth.BASELINE_REGISTRY_REL) + ' ≠ ' + REGISTRY_REL
      + '（两侧指向的副本不是同一个文件 ⇒ 检查器在检别人）');
  }
  if (errors.length) return finish('AUTH_SOURCE_INVALID');

  /* ---- ③ 副本存在性（2×2 矩阵）---- */
  if (!fs.existsSync(registryAbs)) {
    if (landingRequired) {
      err('V364_REGISTRY_MISSING', REGISTRY_REL + ' 缺失，但已声明 landingRequired=true');
      return finish('MISSING');
    }
    info('V364_REGISTRY_NOT_LANDED',
      REGISTRY_REL + ' 尚未落地（B3 未执行）⇒ 证据副本一致性**未被检验**。'
      + '⚠️ 这是披露态，不是「一致性通过」；B3 落地时须把 REGISTRY_LANDING_REQUIRED 置 true。');
    return finish('NOT_LANDED');
  }

  /* ---- ④ 解析 ---- */
  let reg;
  try {
    reg = JSON.parse(lfNormalize(fs.readFileSync(registryAbs)));
  } catch (e) {
    err('V364_REGISTRY_UNPARSABLE', path.basename(registryAbs) + ' 不可解析: ' + e.message);
    return finish('MISMATCH');
  }
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) {
    err('V364_REGISTRY_UNPARSABLE', '副本顶层必须是 JSON 对象');
    return finish('MISMATCH');
  }

  /* ---- ⑤ 顶层禁键：副本不得成为第二份 declaration authority ---- */
  for (let i = 0; i < FORBIDDEN_TOPLEVEL_KEYS.length; i++) {
    const k = FORBIDDEN_TOPLEVEL_KEYS[i];
    if (has(reg, k)) {
      err('V364_REGISTRY_FORBIDDEN_TOPLEVEL_KEY',
        '顶层出现 "' + k + '" ⇒ 副本在宣告自己是声明源；声明源只能是 lock + verifier 内嵌常量');
    }
  }

  /* ---- ⑥ 身份字段：副本 ⇄ 权威（接受 identity.<f> 优先、顶层 <f> 兼容）---- */
  const idn = (reg.identity && typeof reg.identity === 'object' && !Array.isArray(reg.identity))
    ? reg.identity : null;
  result.registry_identity_present = !!idn;
  const getId = (f) => {
    if (idn && idn[f] !== undefined) return idn[f];
    if (reg[f] !== undefined) return reg[f];
    return undefined;
  };
  const missing = [];
  for (let i = 0; i < L0_FIELDS.length; i++) {
    if (getId(L0_FIELDS[i]) === undefined) missing.push(L0_FIELDS[i]);
  }
  if (missing.length) {
    err('V364_REGISTRY_IDENTITY_MISSING', '副本缺身份字段: ' + missing.join(', '));
  } else {
    for (let i = 0; i < L0_FIELDS.length; i++) {
      const f = L0_FIELDS[i];
      const got = String(getId(f));
      if (got !== EXPECTED_L0[f]) {
        err('V364_REGISTRY_IDENTITY_MISMATCH',
          f + ': registry=' + got + ' ≠ authoritative=' + EXPECTED_L0[f]);
      }
    }
  }

  /* ---- ⑦ 副本 ⇄ **磁盘真实字节**（不只是互相抄对）---- */
  const lockAbs = abs(EXPECTED_L0.lock_path);
  if (!fs.existsSync(lockAbs)) {
    info('V364_LOCK_NOT_PRESENT', EXPECTED_L0.lock_path + ' 不在盘上 ⇒ 跳过磁盘字节交叉核对');
  } else {
    result.lock_sha256_lf_on_disk = sha256LfBuffer(fs.readFileSync(lockAbs));
    const claimed = getId('lock_sha256_lf');
    if (claimed !== undefined && String(claimed) !== result.lock_sha256_lf_on_disk) {
      err('V364_REGISTRY_LOCK_SHA_NOT_ON_DISK',
        '副本声称 lock LF-sha256=' + String(claimed).slice(0, 16) + '… 但磁盘实读='
        + result.lock_sha256_lf_on_disk.slice(0, 16) + '…（该断言独立于 L0 锚，直读字节）');
    }
  }

  /* ---- ⑧ surface baseline 身份（条数 + 规范 sha256 + 逐项）----
   * ⚠️ 规范函数**复用权威载体导出**（canonBaseline / sha256TextUtf8）：
   *    两个消费者若各写一份规范化实现，就会出现"哈希口径分叉"，正是本检查器要防的病。 */
  const bl = reg.surface_baseline;
  let list = null;
  if (Array.isArray(bl)) list = bl;
  else if (bl && typeof bl === 'object' && Array.isArray(bl.paths)) list = bl.paths;
  if (!list) {
    err('V364_REGISTRY_BASELINE_MISSING',
      'surface_baseline 形态不符（应为字符串数组或 { paths: [...] }）');
  } else {
    const strs = list.map((x) => String(x));
    /* ⛔ 逐级 else-if：一个根因只产出一条稳定码（条数漂移 ⇒ 不再叠报内容漂移）。 */
    result.registry_baseline_sha256_actual = auth.sha256TextUtf8(auth.canonBaseline(strs));
    if (strs.length !== EXPECTED_BASELINE_N) {
      err('V364_REGISTRY_BASELINE_MISMATCH',
        'baseline 条数=' + strs.length + ' ≠ 主载体 ' + EXPECTED_BASELINE_N);
    } else if (result.registry_baseline_sha256_actual !== EXPECTED_BASELINE_SHA256) {
      err('V364_REGISTRY_BASELINE_MISMATCH',
        'baseline 规范 sha256=' + result.registry_baseline_sha256_actual.slice(0, 16) + '… ≠ 主载体 '
        + EXPECTED_BASELINE_SHA256.slice(0, 16) + '…');
    } else if (strs.slice().sort().join('\n') !== auth.SURFACE_BASELINE_PATHS.slice().sort().join('\n')) {
      err('V364_REGISTRY_BASELINE_MISMATCH', 'baseline 与主载体逐项不等');
    }
  }
  if (reg.surface_baseline_sha256 !== undefined
    && String(reg.surface_baseline_sha256) !== EXPECTED_BASELINE_SHA256) {
    err('V364_REGISTRY_BASELINE_MISMATCH',
      'surface_baseline_sha256 字段=' + String(reg.surface_baseline_sha256).slice(0, 16)
      + '… ≠ 主载体常量');
  }

  /* ---- ⑨ authorization 层：BL-2 语义（引用，不是 SHA；不许占位）---- */
  const au = (reg.authorization && typeof reg.authorization === 'object' && !Array.isArray(reg.authorization))
    ? reg.authorization : null;
  if (!au) {
    err('V364_REGISTRY_AUTHORIZATION_MISSING', 'authorization 层缺失或其形态不是对象');
  } else {
    for (let i = 0; i < AUTHORIZATION_REQUIRED_FIELDS.length; i++) {
      const f = AUTHORIZATION_REQUIRED_FIELDS[i];
      const v = au[f];
      result.registry_authorization_fields_checked += 1;
      if (typeof v !== 'string' || !v.trim()) {
        err('V364_REGISTRY_AUTHORIZATION_SHAPE_INVALID', f + ' 必须是非空字符串');
        continue;
      }
      if (isPlaceholder(v)) {
        err('V364_REGISTRY_AUTHORIZATION_PLACEHOLDER',
          f + '="' + v + '" 是占位符/空值（BL-2：禁用 PENDING/TBD/HEAD/占位符）');
      }
      if (isSha40(v)) {
        err('V364_REGISTRY_AUTHORIZATION_FAKE_SHA',
          f + '="' + v + '" 呈 40-hex commit 形态（BL-2：本字段是**决策引用**，不是 SHA）');
      }
    }
    const akeys = Object.keys(au);
    for (let i = 0; i < akeys.length; i++) {
      const k = akeys[i];
      if (/_sha$/.test(k) || k === 'sha') {
        err('V364_REGISTRY_AUTHORIZATION_FAKE_SHA',
          'authorization 层出现 SHA 形态字段 "' + k + '"：'
          + '含 registry 的 commit 无法在无 git 依赖下自证（自指）⇒ 该字段必然是伪值或指向前一个 commit');
      }
    }
    const optStrings = ['authorized_by', 'authorized_at', 'orchestration_scope'];
    for (let i = 0; i < optStrings.length; i++) {
      const k = optStrings[i];
      if (au[k] === undefined) continue;
      const v = au[k];
      const good = (typeof v === 'string' && !!v.trim())
        || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && !!x.trim()));
      if (!good) err('V364_REGISTRY_AUTHORIZATION_SHAPE_INVALID', k + ' 形态不合法（非空字符串或非空字符串数组）');
    }
    if (au.changed_files !== undefined) {
      const cf = au.changed_files;
      const isArr = Array.isArray(cf) && cf.length > 0
        && cf.every((x) => typeof x === 'string' && !!x.trim());
      const noBackslash = isArr && cf.every((x) => x.indexOf('\\') < 0);
      const uniq = isArr && new Set(cf).size === cf.length;
      if (!isArr || !noBackslash || !uniq) {
        err('V364_REGISTRY_AUTHORIZATION_SHAPE_INVALID',
          'changed_files 必须是非空、去重、POSIX 相对路径的字符串数组');
      }
    }
  }

  return finish(errors.length ? 'MISMATCH' : 'CONSISTENT');
}

/* =====================================================================
 * 自检（⛔ 只在作为主模块运行时执行；被 require 时不跑，供 harness 调用）
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
  /** 错误码与披露码是两条通道：codes=判定，info_codes=披露（⛔ 不可混作通过依据）。 */
  const hasCode = (r, code) => r.codes.indexOf(code) >= 0 || r.info_codes.indexOf(code) >= 0;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v364-b15-'));
  const mk = (name, obj) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2), 'utf8');
    return p;
  };
  let auth = null;
  const consistent = () => ({
    identity: {
      lock_path: EXPECTED_L0.lock_path,
      lock_sha256_lf: EXPECTED_L0.lock_sha256_lf,
      generation: EXPECTED_L0.generation,
      freeze_commit: EXPECTED_L0.freeze_commit,
    },
    authorization: {
      authorization_ref: 'R7-IMPL-5',
      authorization_decision: 'R7-IMPL-5',
      authorized_by: 'OWNER',
      authorized_at: '2026-10-03',
      changed_files: [REGISTRY_REL],
      orchestration_scope: 'R13 Phase B',
    },
    surface_baseline: auth.SURFACE_BASELINE_PATHS.slice(),
    surface_baseline_sha256: EXPECTED_BASELINE_SHA256,
  });

  try {
    console.log('\n== B1.5 evidence-copy consistency checker — 自检 ==');
    console.log('-- 权威载体身份 / 交叉载体 --');
    ok('1. 权威载体存在且 LF-sha256 == 本文件钉死值', () => {
      const p = abs(AUTH_SOURCE_REL);
      assert.ok(fs.existsSync(p), 'authoritative source 缺失');
      assert.strictEqual(sha256LfBuffer(fs.readFileSync(p)), AUTH_SOURCE_SHA256_LF);
    });
    auth = require(abs(AUTH_SOURCE_REL));
    assert.ok(auth && auth.SURFACE_BASELINE_PATHS && auth.ROOT_ANCHOR_V364,
      '权威载体导出形态不符（缺 SURFACE_BASELINE_PATHS / ROOT_ANCHOR_V364）');
    ok('2. 权威导出 == 本文件独立字面量（4 L0 + baseline n/sha + registry 路径）', () => {
      const ra = auth.ROOT_ANCHOR_V364 || {};
      L0_FIELDS.forEach((f) => assert.strictEqual(String(ra[f]), EXPECTED_L0[f], f));
      assert.strictEqual(auth.SURFACE_BASELINE_N, EXPECTED_BASELINE_N);
      assert.strictEqual(auth.SURFACE_BASELINE_SHA256, EXPECTED_BASELINE_SHA256);
      assert.strictEqual(auth.BASELINE_REGISTRY_REL, REGISTRY_REL);
    });

    console.log('-- canonical（规范路径，CI 实际运行的那条）--');
    ok('3. 规范路径实跑：status ∈ {CONSISTENT, NOT_LANDED}，且 NOT_LANDED 明示为非「一致性通过」', () => {
      const r = checkConsistency();
      assert.ok(['CONSISTENT', 'NOT_LANDED'].indexOf(r.status) >= 0, 'status=' + r.status);
      assert.strictEqual(r.ok, true, 'codes=' + r.codes.join(','));
      assert.strictEqual(r.codes.length, 0, '披露态不得产生判定错误码: ' + r.codes.join(','));
      if (r.status === 'NOT_LANDED') {
        assert.strictEqual(r.consistent, false, 'NOT_LANDED 不得被当成 CONSISTENT');
        assert.strictEqual(hasCode(r, 'V364_REGISTRY_NOT_LANDED'), true);
        assert.strictEqual(fs.existsSync(abs(REGISTRY_REL)), false, 'NOT_LANDED 但副本其实存在');
        console.log('     ↳ ' + REGISTRY_REL + ' 未落地（B3 未执行）；一致性**未被检验**，非通过。');
      } else {
        console.log('     ↳ 副本已落地且逐字段一致。');
      }
    });

    console.log('-- G1 正向 --');
    ok('4. 逐字段一致 ⇒ status=CONSISTENT / ok=true / consistent=true', () => {
      const r = checkConsistency({ registryAbs: mk('ok.json', consistent()), landingRequired: true });
      assert.strictEqual(r.status, 'CONSISTENT', 'codes=' + r.codes.join(','));
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.consistent, true);
      assert.strictEqual(r.codes.length, 0);
    });

    console.log('-- G2 registry 缺失（两态）--');
    ok('5. 缺失 + landingRequired=false ⇒ NOT_LANDED（披露态，非通过）', () => {
      const r = checkConsistency({ registryAbs: path.join(tmp, 'nope-a.json'), landingRequired: false });
      assert.strictEqual(r.status, 'NOT_LANDED');
      assert.strictEqual(r.consistent, false);
      assert.strictEqual(hasCode(r, 'V364_REGISTRY_NOT_LANDED'), true);
    });
    ok('6. 缺失 + landingRequired=true ⇒ MISSING / ok=false', () => {
      const r = checkConsistency({ registryAbs: path.join(tmp, 'nope-b.json'), landingRequired: true });
      assert.strictEqual(r.status, 'MISSING');
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.codes.join(','), 'V364_REGISTRY_MISSING');
    });

    console.log('-- G3 registry 篡改 --');
    const tamper = (name, mut, code, exact) => ok(name, () => {
      const obj = consistent();
      mut(obj);
      const r = checkConsistency({ registryAbs: mk(name.replace(/[^a-z0-9]+/gi, '_') + '.json', obj),
        landingRequired: true });
      assert.strictEqual(r.ok, false, '应当 FAIL 却通过了');
      assert.strictEqual(r.status, 'MISMATCH', 'status=' + r.status);
      assert.strictEqual(hasCode(r, code), true, '期望码 ' + code + '，实得 ' + r.codes.join(','));
      if (exact !== undefined) {
        assert.strictEqual(r.codes.join(','), exact, '一个根因应恰 1 条码，实得 ' + r.codes.join(','));
      }
    });
    tamper('7. 篡改 lock_sha256_lf ⇒ IDENTITY_MISMATCH', (o) => {
      o.identity.lock_sha256_lf = '0f8443306b8e944a5a9de29c9625c1af1e0b5ed62ddd0c366d1644e21ff2e03c';
    }, 'V364_REGISTRY_IDENTITY_MISMATCH');
    tamper('8. 篡改 generation ⇒ IDENTITY_MISMATCH', (o) => { o.identity.generation = 'V3.6.5'; },
      'V364_REGISTRY_IDENTITY_MISMATCH');
    tamper('9. 篡改 freeze_commit ⇒ IDENTITY_MISMATCH', (o) => {
      o.identity.freeze_commit = 'bb634e264270f26207c59c19ef3e1c31dde01e64';
    }, 'V364_REGISTRY_IDENTITY_MISMATCH');
    tamper('10. identity 整层缺失 ⇒ IDENTITY_MISSING', (o) => { delete o.identity; },
      'V364_REGISTRY_IDENTITY_MISSING');
    tamper('11. baseline 少 1 条 ⇒ BASELINE_MISMATCH（恰 1 条码）', (o) => { o.surface_baseline.pop(); },
      'V364_REGISTRY_BASELINE_MISMATCH', 'V364_REGISTRY_BASELINE_MISMATCH');
    tamper('12. baseline 条数对但换 1 条 ⇒ BASELINE_MISMATCH', (o) => {
      o.surface_baseline[0] = 'scripts/zz-not-in-baseline.js';
    }, 'V364_REGISTRY_BASELINE_MISMATCH');
    tamper('13. surface_baseline_sha256 字段被改 ⇒ BASELINE_MISMATCH', (o) => {
      o.surface_baseline_sha256 = '0f8443306b8e944a5a9de29c9625c1af1e0b5ed62ddd0c366d1644e21ff2e03c';
    }, 'V364_REGISTRY_BASELINE_MISMATCH');
    tamper('14. 顶层出现 sha256 ⇒ FORBIDDEN_TOPLEVEL_KEY', (o) => { o.sha256 = {}; },
      'V364_REGISTRY_FORBIDDEN_TOPLEVEL_KEY');
    tamper('15. authorization_ref = TBD ⇒ PLACEHOLDER', (o) => { o.authorization.authorization_ref = 'TBD'; },
      'V364_REGISTRY_AUTHORIZATION_PLACEHOLDER');
    tamper('16. authorization_decision = 40hex ⇒ FAKE_SHA', (o) => {
      o.authorization.authorization_decision = 'aa634e264270f26207c59c19ef3e1c31dde01e64';
    }, 'V364_REGISTRY_AUTHORIZATION_FAKE_SHA');
    tamper('17. authorization 带 *_sha 字段 ⇒ FAKE_SHA', (o) => {
      o.authorization.authorization_sha = 'aa634e264270f26207c59c19ef3e1c31dde01e64';
    }, 'V364_REGISTRY_AUTHORIZATION_FAKE_SHA');
    tamper('18. authorized_by 空串 ⇒ SHAPE_INVALID', (o) => { o.authorization.authorized_by = '   '; },
      'V364_REGISTRY_AUTHORIZATION_SHAPE_INVALID');
    ok('19. 副本 lock sha 与磁盘字节独立交叉核对（LOCK_SHA_NOT_ON_DISK）', () => {
      const o = consistent();
      o.identity.lock_sha256_lf = '1'.repeat(64);
      const r = checkConsistency({ registryAbs: mk('off-disk.json', o), landingRequired: true });
      assert.strictEqual(hasCode(r, 'V364_REGISTRY_LOCK_SHA_NOT_ON_DISK'), true, r.codes.join(','));
      assert.strictEqual(hasCode(r, 'V364_REGISTRY_IDENTITY_MISMATCH'), true, r.codes.join(','));
    });
    ok('20. 不可解析 ⇒ UNPARSABLE', () => {
      const r = checkConsistency({ registryAbs: mk('broken.json', '{ not json '), landingRequired: true });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(hasCode(r, 'V364_REGISTRY_UNPARSABLE'), true, r.codes.join(','));
    });
    ok('21. 权威载体身份漂移（合成副本路径）⇒ AUTH_SOURCE_HASH_MISMATCH', () => {
      const fake = path.join(tmp, 'fake-auth.js');
      fs.writeFileSync(fake, '\'use strict\';\nmodule.exports = {};\n', 'utf8');
      const r = checkConsistency({ authSourceAbs: fake, registryAbs: path.join(tmp, 'nope-c.json') });
      assert.strictEqual(r.status, 'AUTH_SOURCE_INVALID');
      assert.strictEqual(r.codes.join(','), 'V364_AUTH_SOURCE_HASH_MISMATCH');
    });
  } catch (e) {
    console.log('  \u2717 自检异常（未捕获）: ' + (e && e.message ? e.message : String(e)));
    failures.push({ name: '自检异常（未捕获）', msg: String(e && e.message ? e.message : e) });
  } finally {
    try {
      const leftovers = fs.readdirSync(tmp);
      leftovers.forEach((f) => fs.unlinkSync(path.join(tmp, f)));
      fs.rmdirSync(tmp);
    } catch (e) { /* 清理失败不影响判定，但会打印 */ console.log('  ⚠️ 临时目录清理: ' + e.message); }
  }

  console.log('\n自检：' + (cases.length - failures.length) + '/' + cases.length + ' 项通过');
  if (failures.length) {
    failures.forEach((f) => console.log('   \u2717 ' + f.name + ': ' + f.msg));
    process.exit(1);
  }
  console.log('v364-lock-anchor-registry-consistency: ' + cases.length + '/' + cases.length + ' passed');
}

if (require.main === module) selfTest();

module.exports = {
  checkConsistency: checkConsistency,
  EXPECTED_L0: EXPECTED_L0,
  L0_FIELDS: L0_FIELDS,
  ATTESTATION_ONLY_FIELDS: ATTESTATION_ONLY_FIELDS,
  EXPECTED_BASELINE_N: EXPECTED_BASELINE_N,
  EXPECTED_BASELINE_SHA256: EXPECTED_BASELINE_SHA256,
  AUTH_SOURCE_REL: AUTH_SOURCE_REL,
  AUTH_SOURCE_SHA256_LF: AUTH_SOURCE_SHA256_LF,
  REGISTRY_REL: REGISTRY_REL,
  REGISTRY_LANDING_REQUIRED: REGISTRY_LANDING_REQUIRED,
  sha256LfBuffer: sha256LfBuffer,
};
