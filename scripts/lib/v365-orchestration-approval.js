#!/usr/bin/env node
/**
 * HD12-2 —— 编排层变更授权机制（**纯函数**，无 IO、无副作用）
 *
 * 设计依据：`docs/V365_PARITY_GATE_REFACTOR_DESIGN.md` §3/§4 + `docs/V365_RUN_LIFECYCLE_IMPLEMENTATION_ROADMAP.md` HD12-2。
 *
 * 判据分层（与 `v365-decision-classification.js` 的分类一一对应）：
 *   CALC          ⇒ ⛔ **绝对 FAIL**（无授权路径；改它只能走升版）
 *   ORCH          ⇒ ⚠️ 需授权清单（SHA 绑定 + changed_files 精确一致 + scope 非空）
 *   MIXED         ⇒ ⚠️ 需授权清单 **且**（zone 声明 **或** comment-only 机械证明）
 *   REPLAY_INFRA  ⇒ ⚠️ 需授权清单 **且** 显式 `REPLAY_INFRA_CHANGE_REVIEW_REQUIRED`
 *   EXCEPTION     ⇒ ✅ 允许（沿用既有白名单 + 证明义务）
 *   UNCLASSIFIED  ⇒ ⛔ 若在受保护域内 ⇒ FAIL（默认拒绝）
 *
 * ⛔ 本模块**不做**任何 IO：清单由调用方读取后传入。
 */

'use strict';

const APPROVAL_SCHEMA_VERSION = 'v365-orchestration-approval-v1';
const REQUIRED_FIELDS = Object.freeze([
  'authorized_by', 'authorization_sha', 'authorized_at', 'changed_files', 'orchestration_scope'
]);
const SHA40 = /^[0-9a-f]{40}$/;
/** ⚠️ 与 SHA40 区分：`comment_stripped_sha_*` 是 **sha256（64 位）**，不是 git SHA（40 位）。 */
const SHA256 = /^[0-9a-f]{64}$/;

function _norm(p) { return String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\.\//, '').trim(); }
function _sorted(a) { return [...new Set(a.map(_norm).filter(Boolean))].sort(); }

/**
 * ★ 规范化「代码指纹」—— 用于 comment-only 证明。
 *
 * ⚠️ 为什么不能只做「去注释」：
 *   朴素的 `stripComments()` 会把纯注释行留下**空白**（`   // foo` → `   `），
 *   因此**新增一行注释仍会改变** stripped 文本 ⇒ 无法作为「纯注释改动」的证明。
 *   （本模块首版即因此缺陷而在自测中暴露 —— 见 README/证据文档。）
 *
 * 规范化步骤（顺序固定，可复现）：
 *   ① 去块注释 `/* … *​/`
 *   ② 去行注释 `// …`（⛔ 用 `[^:]` 前瞻避免吃掉 `https://`）
 *   ③ 统一换行 CRLF/CR → LF
 *   ④ 去掉每行**行尾空白**
 *   ⑤ **丢弃空白行**
 *   ⇒ 结果只反映**可执行代码**；纯注释/空白改动 ⇒ 指纹**不变**。
 *
 * ⛔ 调用方（生成证明者）与本定义必须**同源** ⇒ 一律从本模块取用，不得自行实现。
 */
function canonicalCodeFingerprint(source) {
  return String(source == null ? '' : source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .filter((l) => l.trim().length > 0)
    .join('\n');
}

/** 便捷：规范化指纹的 sha256（⛔ 只在需要哈希时使用；判定逻辑不依赖它） */
function canonicalCodeSha256(source, cryptoImpl) {
  const c = cryptoImpl || require('crypto');
  return c.createHash('sha256').update(canonicalCodeFingerprint(source)).digest('hex');
}

/* ------------------------------------------------------------------ *
 * HD12-3 —— orchestration zone 解析（纯函数，⛔ 无 IO）
 *
 * 标记格式（行注释，⛔ 必须是**注释** ⇒ 不改变代码指纹）：
 *   // >>> v365-orch-zone: <name>
 *   // <<< v365-orch-zone: <name>
 *
 * ⚠️ 用**标记**而非硬编码行号 ⇒ 抗行号漂移（插删行后区间自动跟随）。
 * ------------------------------------------------------------------ */
const ZONE_OPEN_RE = /^\s*\/\/\s*>>>\s*v365-orch-zone:\s*([A-Za-z0-9_-]+)\s*$/;
const ZONE_CLOSE_RE = /^\s*\/\/\s*<<<\s*v365-orch-zone:\s*([A-Za-z0-9_-]+)\s*$/;

/**
 * 解析源码中的 orchestration zone 区间。
 * @param {string} source
 * @returns {{zones:Object<string,Array<{start:number,end:number}>>, malformed:string[], names:string[]}}
 *   `start`/`end` 为 **1-based 闭区间**（含标记行本身）。
 */
function parseOrchZones(source) {
  const lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
  const zones = {};
  const malformed = [];
  const openStack = [];
  lines.forEach((ln, i) => {
    const n = i + 1;
    const mo = ln.match(ZONE_OPEN_RE);
    const mc = ln.match(ZONE_CLOSE_RE);
    if (mo) {
      openStack.push({ name: mo[1], line: n });
    } else if (mc) {
      const idx = openStack.map((o) => o.name).lastIndexOf(mc[1]);
      if (idx < 0) {
        malformed.push(`第 ${n} 行：闭合标记 "${mc[1]}" 无对应开启标记`);
      } else {
        const o = openStack[idx];
        openStack.splice(idx, 1);
        (zones[o.name] = zones[o.name] || []).push({ start: o.line, end: n });
      }
    }
  });
  openStack.forEach((o) => malformed.push(`第 ${o.line} 行：开启标记 "${o.name}" 未闭合`));
  Object.keys(zones).forEach((k) => zones[k].sort((a, b) => a.start - b.start));
  return { zones, malformed, names: Object.keys(zones).sort() };
}

/**
 * 校验改动**区域**是否全部落在**声明的 zone** 内。
 *
 * @param {Array<{file:string,start:number,end:number}>} regions 改动区域（1-based 闭区间）
 * @param {Object<string,Array<{start:number,end:number}>>} zonesByFile 每文件的 zone 区间
 * @param {string[]} declaredZones manifest 声明的 zone 名
 * @returns {{ok:boolean, code:string, errors:string[], notes:string[], coverage:object}}
 */
function validateRegionContainment(regions, zonesByFile, declaredZones) {
  const errors = [];
  const notes = [];
  const declared = (declaredZones || []).map(String);
  const coverage = {};

  if (!regions || !regions.length) {
    return { ok: true, code: 'NO_REGIONS_DECLARED', errors, notes, coverage };
  }

  for (const r of regions) {
    const f = _norm(r.file);
    const all = (zonesByFile && zonesByFile[f]) || {};
    const available = Object.keys(all);
    coverage[f] = available;

    // ① 声明的 zone 必须在该文件中真实存在
    for (const z of declared) {
      if (!available.includes(z)) {
        errors.push(`${f}：声明了 zone "${z}"，但该文件中不存在该 zone（实际 zone = ${JSON.stringify(available)}）`);
      }
    }
    // ② 改动区域必须落在**声明的** zone 内
    const inside = declared
      .filter((z) => available.includes(z))
      .flatMap((z) => all[z])
      .some((seg) => Number(r.start) >= seg.start && Number(r.end) <= seg.end);
    if (!inside) {
      errors.push(`${f}:${r.start}-${r.end} 不在任何声明的 zone 内（声明 = ${JSON.stringify(declared)}；`
        + `实际 zone 区间 = ${JSON.stringify(declared.filter((z) => available.includes(z)).map((z) => [z, all[z]]))}）`);
    }
  }

  if (errors.length) return { ok: false, code: 'REGION_OUTSIDE_DECLARED_ZONE', errors, notes, coverage };
  notes.push(`全部 ${regions.length} 个改动区域均落在声明的 zone 内：${JSON.stringify(declared)}`);
  return { ok: true, code: 'REGIONS_CONTAINED', errors, notes, coverage };
}

/**
 * 校验授权清单。
 *
 * @param {object|null} manifest  解析后的清单（null = 未提供）
 * @param {object} ctx
 *   - changed        {string[]}  本次改动文件（仓库相对路径）
 *   - headSha        {string|null}  调用方传入的 40 位 HEAD SHA（缺省则不校验时效）
 *   - classification {object}  v365-decision-classification 模块
 * @returns {{ok:boolean, code:string, errors:string[], notes:string[]}}
 */
function validate(manifest, ctx) {
  const c = ctx || {};
  const changed = _sorted(c.changed || []);
  const C = c.classification;
  const errors = [];
  const notes = [];

  if (!C) return { ok: false, code: 'NO_CLASSIFICATION', errors: ['缺少 classification 模块'], notes };

  // ---- 逐文件分类（先算，CALC 与 UNCLASSIFIED 与授权清单无关）----
  const byClass = {};
  changed.forEach((f) => {
    const k = C.classify(f);
    (byClass[k] = byClass[k] || []).push(f);
  });

  // ---- ① CALC：绝对 FAIL（⛔ 无授权路径）----
  if (byClass.CALC && byClass.CALC.length) {
    return {
      ok: false, code: 'CALC_TOUCHED',
      errors: [`决策计算核心被改动（⛔ 无授权路径）：${byClass.CALC.join(', ')}`], notes
    };
  }

  // ---- ② 受保护域内未登记：默认拒绝 ----
  const domainViolations = C.protectedDomainViolations(changed);
  if (domainViolations.length) {
    return {
      ok: false, code: 'UNCLASSIFIED_IN_PROTECTED_DOMAIN',
      errors: [`受保护域内存在未登记文件：${domainViolations.join(', ')}`], notes
    };
  }

  // ---- ③ 需要授权的类别 ----
  const needApproval = [].concat(byClass.ORCH || [], byClass.MIXED || [], byClass.REPLAY_INFRA || []);
  if (!needApproval.length) {
    return { ok: true, code: 'NO_APPROVAL_NEEDED', errors, notes };
  }

  if (manifest == null) {
    return {
      ok: false, code: 'APPROVAL_MISSING',
      errors: [`以下受保护文件被改动但未提供授权清单：${needApproval.join(', ')}`], notes
    };
  }

  // ---- ④ 结构 ----
  const missing = REQUIRED_FIELDS.filter((k) => manifest[k] == null);
  if (missing.length) {
    return { ok: false, code: 'APPROVAL_MALFORMED', errors: [`授权清单缺少字段：${missing.join(', ')}`], notes };
  }
  if (manifest.approval_schema_version != null && manifest.approval_schema_version !== APPROVAL_SCHEMA_VERSION) {
    notes.push(`授权清单 schema 版本 = ${manifest.approval_schema_version}（当前 ${APPROVAL_SCHEMA_VERSION}）`);
  }

  // ---- ⑤ 授权必须逐位绑定 40 位 SHA（R-GI-002）----
  if (!SHA40.test(String(manifest.authorization_sha))) {
    return {
      ok: false, code: 'AUTHORIZATION_SHA_INVALID',
      errors: ['authorization_sha 必须是 40 位十六进制字面值（⛔ 占位符/变量/描述性指代无效）'], notes
    };
  }
  if (c.headSha != null && _norm(c.headSha) !== _norm(manifest.authorization_sha)) {
    return {
      ok: false, code: 'AUTHORIZATION_SHA_MISMATCH',
      errors: [`授权 SHA 与当前 HEAD 不匹配（授权已失效）：manifest=${manifest.authorization_sha} head=${c.headSha}`],
      notes
    };
  }
  // fail-closed：提供授权清单却**未**提供 HEAD SHA ⇒ 无法验证时效 ⇒ FAIL
  // （⛔ 不得因"调用方图省事"而跳过 SHA 绑定校验）
  if (c.headSha == null) {
    return {
      ok: false, code: 'HEAD_SHA_REQUIRED',
      errors: ['提供授权清单时必须同时提供 --head-sha（否则无法验证授权的 40 位 SHA 绑定）'], notes
    };
  }

  // ---- ⑥ changed_files 必须与改动清单**完全一致**（不得多、不得少）----
  const declared = _sorted(Array.isArray(manifest.changed_files) ? manifest.changed_files : []);
  if (declared.length !== changed.length || declared.some((f, i) => f !== changed[i])) {
    const extra = declared.filter((f) => !changed.includes(f));
    const miss = changed.filter((f) => !declared.includes(f));
    return {
      ok: false, code: 'APPROVAL_CHANGED_FILES_MISMATCH',
      errors: [
        '授权清单的 changed_files 必须与改动清单完全一致'
          + (extra.length ? `；多报 = ${JSON.stringify(extra)}` : '')
          + (miss.length ? `；少报 = ${JSON.stringify(miss)}` : '')
      ], notes
    };
  }

  // ---- ⑦ scope 非空 ----
  const scope = Array.isArray(manifest.orchestration_scope) ? manifest.orchestration_scope.filter(Boolean) : [];
  if (!scope.length) {
    return { ok: false, code: 'APPROVAL_SCOPE_EMPTY', errors: ['orchestration_scope 必须非空'], notes };
  }

  // ---- ⑧ REPLAY_INFRA：必须显式走专门评审标记 ----
  if ((byClass.REPLAY_INFRA || []).length) {
    const marker = C.REPLAY_INFRA_REVIEW_MARKER;
    if (_norm(manifest.replay_infra_review) !== marker) {
      return {
        ok: false, code: 'REPLAY_INFRA_REVIEW_REQUIRED',
        errors: [`REPLAY_INFRASTRUCTURE 改动必须声明 replay_infra_review = "${marker}"（⛔ 不得走普通 ORCH 授权）`],
        notes
      };
    }
    notes.push(`REPLAY_INFRASTRUCTURE 变更已声明专门评审：${(byClass.REPLAY_INFRA || []).join(', ')}`);
  }

  // ---- ⑨ MIXED：需 zone 声明（**含区域包含性验证**）**或** comment-only 机械证明 ----
  if ((byClass.MIXED || []).length) {
    const zones = Array.isArray(manifest.zone_declaration) ? manifest.zone_declaration.filter(Boolean) : [];
    const proof = manifest.comment_only_proof;
    const proofOk = proof && typeof proof === 'object'
      && SHA256.test(String(proof.comment_stripped_sha_before || ''))
      && SHA256.test(String(proof.comment_stripped_sha_after || ''))
      && String(proof.comment_stripped_sha_before) === String(proof.comment_stripped_sha_after);
    if (!zones.length && !proofOk) {
      return {
        ok: false, code: 'MIXED_REQUIRES_ZONE_OR_COMMENT_ONLY_PROOF',
        errors: [
          `MIXED 文件被改动但既未声明 zone_declaration，也未提供 comment-only 机械证明：`
            + `${(byClass.MIXED || []).join(', ')}`
        ], notes
      };
    }
    // ★ HD12-3：zone 声明**必须**经区域包含性验证（⛔ 不得只是"声明"）
    if (zones.length) {
      const regions = (c.changedRegions || []).filter((r) => (byClass.MIXED || []).includes(_norm(r.file)));
      if (!regions.length) {
        return {
          ok: false, code: 'ZONE_DECLARATION_WITHOUT_REGIONS',
          errors: [
            '声明了 zone_declaration，但未提供 --changed-region ⇒ 无法验证改动确实落在声明区域内。'
              + '（⛔ 声明而非验证 = 弱授权；HD12-3 要求区域包含性）'
          ], notes
        };
      }
      const cont = validateRegionContainment(regions, c.zonesByFile || {}, zones);
      if (!cont.ok) return { ok: false, code: cont.code, errors: cont.errors, notes };
      cont.notes.forEach((n) => notes.push(n));
    }
    if (!zones.length && proofOk) {
      notes.push(`MIXED 以 comment-only 证明放行（规范化代码指纹逐位相同）：${proof.file || '(未标 file)'}`);
    }
    if (zones.length) notes.push(`MIXED 以 zone 声明 + 区域包含性放行：${JSON.stringify(zones)}`);
  }

  // ---- ⑩ CALC 不得出现在授权清单里（显式重申，防"夹带"）----
  const smuggled = declared.filter((f) => C.classify(f) === 'CALC');
  if (smuggled.length) {
    return {
      ok: false, code: 'APPROVAL_CANNOT_COVER_CALC',
      errors: [`授权清单不得覆盖决策计算核心：${smuggled.join(', ')}`], notes
    };
  }

  return { ok: true, code: 'APPROVED', errors, notes };
}

module.exports = {
  APPROVAL_SCHEMA_VERSION, REQUIRED_FIELDS,
  canonicalCodeFingerprint, canonicalCodeSha256,
  parseOrchZones, validateRegionContainment,
  validate
};
