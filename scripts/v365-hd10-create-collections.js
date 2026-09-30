#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 —— HD-10 CREATE-ONLY 生产建表（5 个 v365 集合）。
 *
 * 授权范围（owner 裁定，2026-09-29）：
 *   HD-10_PRODUCTION_COLLECTION_CREATION = APPROVED
 *   严格限定 5 个集合 + 其冻结 schema 已声明的 indexes：
 *     run_manifest / run_candidate_decision / run_candidate_portfolio
 *     / active_run_pointer / run_history
 *
 * 执行原则：
 *   - 先只读 preflight：EXISTS / ABSENT / SCHEMA_DRIFT
 *   - ABSENT            ⇒ createCollection + createIndexes + read-after-create 验证
 *   - EXISTS + 契约一致  ⇒ NO-OP（⛔ 不重复创建）
 *   - EXISTS + 契约不一致 ⇒ STOP = PRODUCTION_SCHEMA_DRIFT（⛔ 不改/不删/不迁移）
 *
 * ⛔ 本授权 = CREATE EMPTY STRUCTURE ONLY。
 *   documents_written 恒为 0；不写任何业务 document；不 backfill；
 *   不 init/切换 active_run_pointer；不 deploy；不 drop；不改既有 index。
 *
 * 用法：
 *   node scripts/v365-hd10-create-collections.js --i-have-authorization \
 *        --env tradingview-etf-d0fa42yy57cbc11b [--out <path>]
 *
 *   ★ --preflight-only（owner §4）：只做 read-only preflight 并确认生产仍 exact-match，
 *     ⛔ 绝不发出 create / createIndexes（零 mutation）。
 */

const IS_PREFLIGHT_ONLY = process.argv.slice(2).includes('--preflight-only');

const path = require('path');
const fs = require('fs');

const REQUIRED_FLAG = '--i-have-authorization';

// —— 冻结契约（来自 src/common/schema.js；本脚本只读引用，不复制为第二源）——
const SCHEMA_PATH = path.join(__dirname, '..', 'src', 'common', 'schema.js');
const TARGETS = [
  'run_manifest',
  'run_candidate_decision',
  'run_candidate_portfolio',
  'active_run_pointer',
  'run_history'
];

function refuse(reason) {
  console.error('[REFUSE] ' + reason);
  console.error('按 V3.6.5 §10：生产建表需 owner 显式授权（--i-have-authorization）。');
  process.exit(2);
}

function loadFrozenContract() {
  const { SCHEMAS } = require(SCHEMA_PATH);
  const out = {};
  for (const name of TARGETS) {
    const s = SCHEMAS.find((x) => x.name === name);
    if (!s) {
      console.error(`[FATAL] 冻结 schema 中缺少集合声明：${name}`);
      process.exit(3);
    }
    out[name] = { indexes: s.indexes || [] };
  }
  return out;
}

/**
 * 把「冻结契约」中的 schema index 规范化为可比对签名。
 * 签名 = name|field:dir[,field:dir]|unique|plain
 *   ⛔ 必须包含 key fields + direction + unique —— 只比 name 不构成契约校验。
 */
function idxSig(index) {
  const keys = (index.keys || [])
    .map((k) => `${k.field}:${k.direction === 'desc' ? -1 : 1}`)
    .join(',');
  return `${index.name}|${keys}|${index.unique ? 'unique' : 'plain'}`;
}

// —— 平台原始索引项的 key 归一化 ——
// listIndexes 返回的 key 形如 { field: { $numberInt: '1' } } 或 { field: 1 } / { field: -1 }。
// ⛔ 不同环境（shell / SDK / CLI JSON）可能给出三种形态，必须全部归一。
function normDir(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v === -1 ? -1 : 1;
  if (typeof v === 'string') {
    if (v === '-1') return -1;
    if (v === '1') return 1;
    return null;
  }
  if (typeof v === 'object') {
    if (v.$numberInt !== undefined) return normDir(v.$numberInt);
    if (v.$numberLong !== undefined) return normDir(v.$numberLong);
    if (v.$numberDouble !== undefined) return normDir(v.$numberDouble);
    return null;
  }
  return null;
}

/**
 * 把平台 listIndexes 返回的**原始**索引项规范化为签名。
 * 输入形态：{ name, key: { field: { $numberInt: '1' } | 1 | -1, ... }, unique }
 * 输出：`name|field:1,field:-1|unique|plain`
 * `_id_` 索引由平台隐式维护，⛔ 不参与契约比对（返回 null）。
 */
function normalizeObservedIndex(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = raw.name;
  if (!name || name === '_id_') return null;
  const kobj = (raw.key && typeof raw.key === 'object') ? raw.key : {};
  const parts = Object.keys(kobj).map((f) => {
    const d = normDir(kobj[f]);
    return `${f}:${d === null ? '?' : d}`;
  });
  return `${name}|${parts.join(',')}|${raw.unique ? 'unique' : 'plain'}`;
}

/**
 * ★ 完整契约比对（owner §1）：比较完整 frozen index signature
 *   （name + key fields + direction + unique），⛔ 不得只做 missing.length === 0。
 *
 * @param {Array} observedRaw 平台 listIndexes 的原始返回项（含 _id_，内部忽略）
 * @param {Array} requiredFrozen 冻结契约 indexes（{name, keys:[{field,direction}], unique}）
 * @returns {{
 *   match: boolean,
 *   missing_required: string[],   // 冻结契约要求但生产缺失（含同签名缺失）
 *   unexpected_extra: string[],   // 生产多出、冻结契约未声明的非 _id_ 索引
 *   key_drift: Array<{name, required, observed}>,        // 同名不同 key fields
 *   direction_drift: Array<{name, required, observed}>,  // 同名不同 direction
 *   unique_drift: Array<{name, required, observed}>,     // 同名不同 unique
 *   observed_signatures: string[],
 *   required_signatures: string[]
 * }}
 */
function compareIndexContract(observedRaw, requiredFrozen) {
  const reqSig = (requiredFrozen || []).map(idxSig);
  const reqByName = {};
  (requiredFrozen || []).forEach((ix) => { reqByName[ix.name] = ix; });

  const obsSig = [];
  const obsByName = {};
  for (const raw of (observedRaw || [])) {
    const sig = normalizeObservedIndex(raw);
    if (sig === null) continue; // 忽略 _id_ / 非法项
    obsSig.push(sig);
    if (raw && raw.name) obsByName[raw.name] = raw;
  }

  const missing_required = reqSig.filter((s) => !obsSig.includes(s));
  const unexpected_extra = obsSig.filter((s) => !reqSig.includes(s));

  // 逐类漂移归因（同名但签名的**某一维度**不同）
  const key_drift = [];
  const direction_drift = [];
  const unique_drift = [];
  for (const name of Object.keys(reqByName)) {
    const raw = obsByName[name];
    if (!raw) continue; // 缺失已计入 missing_required
    const req = reqByName[name];
    const reqKeys = (req.keys || []).map((k) => `${k.field}:${k.direction === 'desc' ? -1 : 1}`).join(',');
    const reqUnique = !!req.unique;
    const kobj = (raw.key && typeof raw.key === 'object') ? raw.key : {};
    const obsFields = Object.keys(kobj);
    const obsKeys = obsFields.map((f) => `${f}:${normDir(kobj[f]) === null ? '?' : normDir(kobj[f])}`).join(',');
    const obsUnique = !!raw.unique;
    const reqFields = (req.keys || []).map((k) => k.field);
    if (reqFields.join(',') !== obsFields.join(',')) {
      key_drift.push({ name, required: reqFields.join(','), observed: obsFields.join(',') });
    } else if (reqKeys !== obsKeys) {
      direction_drift.push({ name, required: reqKeys, observed: obsKeys });
    }
    if (reqUnique !== obsUnique) {
      unique_drift.push({ name, required: reqUnique, observed: obsUnique });
    }
  }

  const match = missing_required.length === 0 && unexpected_extra.length === 0
    && key_drift.length === 0 && direction_drift.length === 0 && unique_drift.length === 0;

  return {
    match,
    missing_required,
    unexpected_extra,
    key_drift,
    direction_drift,
    unique_drift,
    observed_signatures: obsSig,
    required_signatures: reqSig
  };
}

function main() {
  const argv = process.argv.slice(2);
  const getArg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

  if (!argv.includes(REQUIRED_FLAG)) refuse('缺少显式授权开关 ' + REQUIRED_FLAG);
  const envId = getArg('--env') || process.env.TCB_ENV || null;
  if (!envId) refuse('缺少 --env <envId>');
  const outPath = getArg('--out') || path.join(
    __dirname, '..', 'deliverables', 'v365-production-history', 'hd10', 'hd10-create-result.json'
  );

  const contract = loadFrozenContract();
  const { execFileSync } = require('child_process');

  // 通过「node + tcb CLI 的 JS 入口」执行 MgoCommands。
  // ⛔ 不走 .cmd / shell ⇒ 避免 Windows 下 JSON 参数被 shell 剥引号。
  function resolveTcbEntry() {
    const candidates = [
      process.env.TCB_JS_ENTRY,
      path.join(process.env.HOME || process.env.USERPROFILE || '',
        '.npm-global', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
      path.join(process.env.APPDATA || '',
        'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb')
    ].filter(Boolean);
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    return null;
  }
  const TCB_ENTRY = resolveTcbEntry();
  if (!TCB_ENTRY) {
    console.error('[FATAL] 找不到 tcb CLI 的 JS 入口（可设 TCB_JS_ENTRY 环境变量）');
    process.exit(4);
  }

  // 通过 tcb CLI 的 MgoCommands 通道执行（本机无 @cloudbase/node-sdk）
  function mgo(commandType, commandObj) {
    const payload = [{
      TableName: '_hd10_',
      CommandType: commandType,
      Command: JSON.stringify(commandObj)
    }];
    const raw = execFileSync(process.execPath, [
      TCB_ENTRY, 'db', 'nosql', 'execute',
      '--command', JSON.stringify(payload), '--json'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const i = raw.indexOf('{');
    if (i < 0) return null;
    try { return JSON.parse(raw.slice(i)); } catch (e) { return null; }
  }

  const result = {
    artifact: 'v365-hd10-create-result',
    generated_at: new Date().toISOString(),
    authorization: 'HD-10_PRODUCTION_COLLECTION_CREATION = APPROVED',
    authorization_sha: 'c6bd006fd76ffc5358cddd07347df8ed23d9e61d',
    env_id: envId,
    scope: 'CREATE_EMPTY_STRUCTURE_ONLY',
    documents_written: 0,
    production_run_triggered: false,
    pointer_initialized: false,
    preflight: {},
    actions: [],
    verification: {},
    verdict: {}
  };

  // ---------- 1) 只读 preflight ----------
  const lc = mgo('COMMAND', { listCollections: 1, nameOnly: true });
  const existing = ((lc && lc.data && lc.data.results && lc.data.results[0]) || []).map((x) => x.name);
  result.preflight.all_collection_count = existing.length;
  result.preflight.targets = TARGETS.map((t) => {
    const rec = { name: t, state: existing.includes(t) ? 'EXISTS' : 'ABSENT' };
    // ★ owner §1：EXISTS ⇒ 必须用**完整 frozen index signature** 校验（name+key+direction+unique）
    if (rec.state === 'EXISTS') {
      try {
        const li = mgo('COMMAND', { listIndexes: t });
        const observedRaw = ((li && li.data && li.data.results && li.data.results[0]) || []);
        const required = (contract[t] && contract[t].indexes) || [];
        const cmp = compareIndexContract(observedRaw, required);
        rec.observed_signatures = cmp.observed_signatures;
        rec.required_signatures = cmp.required_signatures;
        rec.missing_required = cmp.missing_required;
        rec.unexpected_extra = cmp.unexpected_extra;
        rec.key_drift = cmp.key_drift;
        rec.direction_drift = cmp.direction_drift;
        rec.unique_drift = cmp.unique_drift;
        rec.contract_match = cmp.match;
        rec.state = cmp.match ? 'EXISTS' : 'SCHEMA_DRIFT';
      } catch (e) {
        rec.index_check_error = String(e && e.message || e);
        rec.contract_match = false;
        rec.state = 'SCHEMA_DRIFT';
      }
    }
    return rec;
  });
  console.log('--- preflight ---');
  result.preflight.targets.forEach((t) => {
    const drift = t.state === 'SCHEMA_DRIFT'
      ? ` missing=${JSON.stringify(t.missing_required || [])}`
        + ` extra=${JSON.stringify(t.unexpected_extra || [])}`
        + ` key=${(t.key_drift || []).length} dir=${(t.direction_drift || []).length} uniq=${(t.unique_drift || []).length}`
      : '';
    console.log(`  ${String(t.state).padEnd(13)} ${t.name}${drift}`);
  });

  // ★ STOP = PRODUCTION_SCHEMA_DRIFT：已存在但契约不一致 ⇒ 立即停止，⛔ 不做任何创建/修改
  const preflightDrift = result.preflight.targets.filter((t) => t.state === 'SCHEMA_DRIFT');
  const allDrift = preflightDrift.length > 0;

  // ★ owner §4：--preflight-only ⇒ 只读核验，零 mutation，然后立即结束
  if (IS_PREFLIGHT_ONLY) {
    const preflightMatch = result.preflight.targets.every((t) => t.state === 'EXISTS' && t.contract_match);
    result.mode = 'READ_ONLY_PREFLIGHT';
    result.verdict = {
      mode: 'READ_ONLY_PREFLIGHT',
      preflight_all_exact_match: preflightMatch,
      PRODUCTION_SCHEMA_DRIFT: allDrift,
      STOP: allDrift ? 'PRODUCTION_SCHEMA_DRIFT' : null,
      drift_targets: preflightDrift.map((t) => t.name),
      no_op_collections: result.preflight.targets.map((t) => t.name),
      documents_written: 0,
      production_run_triggered: false,
      pointer_initialized: false,
      zero_mutation_command: true,
      HD_10: preflightMatch ? 'COMPLETE_PREFLIGHT_ONLY' : (allDrift ? 'STOP_PRODUCTION_SCHEMA_DRIFT' : 'INCOMPLETE')
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log('');
    console.log('mode = READ_ONLY_PREFLIGHT（零 mutation）');
    console.log('preflight_all_exact_match = ' + preflightMatch);
    console.log('HD_10 = ' + result.verdict.HD_10);
    console.log('written => ' + outPath);
    process.exit(allDrift ? 5 : 0);
  }

  if (allDrift) {
    result.verdict = {
      PRODUCTION_SCHEMA_DRIFT: true,
      STOP: 'PRODUCTION_SCHEMA_DRIFT',
      drift_targets: preflightDrift.map((t) => t.name),
      documents_written: 0,
      production_run_triggered: false,
      pointer_initialized: false,
      HD_10: 'STOP_PRODUCTION_SCHEMA_DRIFT'
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log('');
    console.log('⛔ STOP = PRODUCTION_SCHEMA_DRIFT（' + preflightDrift.map((t) => t.name).join(', ') + '）');
    console.log('   ⛔ 不得自动修改 / 删除 / 重建 / 迁移生产 collection');
    console.log('written => ' + outPath);
    process.exit(5);
  }

  // ---------- 2) create-only（仅 ABSENT） ----------
  // ★ owner §2：preflight = EXISTS 的集合必须**零 mutation command**。
  //   ABSENT ⇒ CREATE_COLLECTION；EXISTS ⇒ 显式 NO_OP_COLLECTION。
  console.log('--- create ---');
  const noOpCollections = [];
  const createdCollections = [];
  for (const t of result.preflight.targets) {
    const name = t.name;
    if (t.state === 'EXISTS') {
      noOpCollections.push(name);
      result.actions.push({
        name, action: 'NO_OP_COLLECTION',
        reason: 'EXISTS_CONTRACT_MATCH',
        mutation_command_sent: false
      });
      console.log(`  ⏭️  NO_OP_COLLECTION  ${name}  (EXISTS + exact contract match ⇒ 零 mutation)`);
      continue;
    }
    // 建集合
    let created = false;
    let err = null;
    try {
      const r = mgo('COMMAND', { create: name });
      created = !!(r && !r.code && !r.error);
      if (!created) err = JSON.stringify(r && (r.message || r.error || r.code));
    } catch (e) {
      err = String(e && e.message || e);
    }
    if (created) createdCollections.push(name);
    result.actions.push({ name, action: 'CREATE_COLLECTION', ok: created, error: err, mutation_command_sent: true });
    console.log(`  ${created ? '✅' : '⚠️ '} create ${name}${err ? ' — ' + err : ''}`);
  }
  result.no_op_collections = noOpCollections;
  result.created_collections = createdCollections;

  // ---------- 3) create indexes（★ 只对**本次刚创建的 ABSENT** 集合） ----------
  // ★ owner §2：⛔ 不得对 preflight = EXISTS + contract_match 的集合再发 createIndexes。
  console.log('--- indexes ---');
  for (const t of result.preflight.targets) {
    const name = t.name;
    const indexes = (contract[name] && contract[name].indexes) || [];
    if (t.state === 'EXISTS') {
      // 已存在且契约一致 ⇒ 索引已存在 ⇒ 显式 NO_OP_INDEXES（零 mutation）
      result.actions.push({
        name, action: 'NO_OP_INDEXES', index: null,
        indexes: indexes.map((x) => x.name),
        reason: 'EXISTS_CONTRACT_MATCH',
        mutation_command_sent: false
      });
      console.log(`  ⏭️  NO_OP_INDEXES     ${name}  (${indexes.map((x) => x.name).join(', ')})`);
      continue;
    }
    for (const idx of indexes) {
      const keys = (idx.keys || []).map((k) => [k.field, k.direction === 'desc' ? -1 : 1]);
      const cmd = {
        createIndexes: name,
        indexes: [{ key: Object.fromEntries(keys), name: idx.name, unique: !!idx.unique }]
      };
      let ok = false; let e2 = null;
      try {
        const r = mgo('COMMAND', cmd);
        ok = !!(r && !r.code && !r.error);
        if (!ok) e2 = JSON.stringify(r && (r.message || r.error || r.code));
      } catch (e) { e2 = String(e && e.message || e); }
      result.actions.push({
        name, action: 'CREATE_INDEX', index: idx.name, unique: !!idx.unique, ok, error: e2,
        mutation_command_sent: true
      });
      console.log(`  ${ok ? '✅' : '⚠️ '} ${name}.${idx.name}${e2 ? ' — ' + e2 : ''}`);
    }
  }

  // ---------- 4) read-after-create 验证（★ 完整签名比对） ----------
  console.log('--- verify ---');
  const lc2 = mgo('COMMAND', { listCollections: 1, nameOnly: true });
  const after = ((lc2 && lc2.data && lc2.data.results && lc2.data.results[0]) || []).map((x) => x.name);
  const verify = {};
  for (const name of TARGETS) {
    const exists = after.includes(name);
    let cmp = null;
    try {
      const li = mgo('COMMAND', { listIndexes: name });
      const observedRaw = ((li && li.data && li.data.results && li.data.results[0]) || []);
      cmp = compareIndexContract(observedRaw, (contract[name] && contract[name].indexes) || []);
    } catch (e) { cmp = null; }
    const required = ((contract[name] && contract[name].indexes) || []).map((x) => x.name);
    verify[name] = {
      exists,
      required_indexes: required,
      observed_signatures: cmp ? cmp.observed_signatures : null,
      required_signatures: cmp ? cmp.required_signatures : null,
      missing_required: cmp ? cmp.missing_required : required,
      unexpected_extra: cmp ? cmp.unexpected_extra : [],
      key_drift: cmp ? cmp.key_drift : [],
      direction_drift: cmp ? cmp.direction_drift : [],
      unique_drift: cmp ? cmp.unique_drift : [],
      contract_match: !!(exists && cmp && cmp.match)
    };
    console.log(`  ${name}: exists=${exists} contract_match=${verify[name].contract_match}`
      + ` missing=${JSON.stringify(verify[name].missing_required)}`);
  }
  result.verification = verify;

  const allExist = TARGETS.every((t) => verify[t].exists);
  const allMatch = TARGETS.every((t) => verify[t].contract_match);
  // ★ owner 裁定 §HD-10：若集合已存在但索引与冻结契约不一致 ⇒ STOP = PRODUCTION_SCHEMA_DRIFT
  //   （⛔ 不得自动修改 / 删除 / 重建 / 迁移生产 collection）
  const driftTargets = TARGETS.filter((t) => verify[t].exists && !verify[t].contract_match);
  const productionSchemaDrift = driftTargets.length > 0;

  // ★ owner §2：证明 existing exact-match collection ⇒ zero mutation command
  const existingExactMatch = result.preflight.targets
    .filter((t) => t.state === 'EXISTS' && t.contract_match)
    .map((t) => t.name);
  const mutationCommandsOnExisting = (result.actions || []).filter(
    (a) => existingExactMatch.includes(a.name)
      && a.mutation_command_sent === true
  );
  const zeroMutationOnExisting = mutationCommandsOnExisting.length === 0;

  result.verdict = {
    collections_exist: `${TARGETS.filter((t) => verify[t].exists).length}/${TARGETS.length}`,
    all_required_indexes_verified: allMatch,
    schema_contract_match: allMatch,
    documents_written: 0,
    production_run_triggered: false,
    pointer_initialized: false,
    drift_detected: productionSchemaDrift,
    drift_targets: driftTargets,
    PRODUCTION_SCHEMA_DRIFT: productionSchemaDrift,
    STOP: productionSchemaDrift ? 'PRODUCTION_SCHEMA_DRIFT' : null,
    no_op_collections: result.no_op_collections || [],
    created_collections: result.created_collections || [],
    zero_mutation_on_existing_exact_match: zeroMutationOnExisting,
    mutation_commands_on_existing_exact_match: mutationCommandsOnExisting.map((a) => ({ name: a.name, action: a.action })),
    HD_10: (allExist && allMatch) ? 'COMPLETE' : (productionSchemaDrift ? 'STOP_PRODUCTION_SCHEMA_DRIFT' : 'INCOMPLETE')
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log('');
  console.log('HD_10 = ' + result.verdict.HD_10);
  if (productionSchemaDrift) {
    console.log('⛔ STOP = PRODUCTION_SCHEMA_DRIFT（集合已存在但与冻结契约不符）—— 不自动修复');
  }
  console.log('written => ' + outPath);
  if (productionSchemaDrift) process.exit(5);
}

if (require.main === module) main();

module.exports = {
  TARGETS,
  idxSig,
  REQUIRED_FLAG,
  // ★ owner §1/§3：纯函数导出 ⇒ 测试可直接 unit test（⛔ 不只扫字符串）
  normalizeObservedIndex,
  compareIndexContract,
  normDir
};
