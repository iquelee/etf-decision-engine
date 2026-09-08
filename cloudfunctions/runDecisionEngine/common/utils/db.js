/**
 * 数据库封装（CloudBase 文档数据库）
 * 被 6 个云函数复用；scripts/ 本地脚本传入 envId 也可复用。
 *
 * 设计要点：
 * - 懒初始化 app/db 实例；
 * - 云函数内用 SYMBOL_CURRENT_ENV，本地脚本用 process.env.TCB_ENV 或显式传 env；
 * - 提供 upsert/query/batchInsert 等通用方法 + param_config/etf_basic 快捷读取；
 * - 处理 CloudBase 单次查询 limit 限制（分页拉取）。
 *
 * @module db
 */

'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const { COLLECTIONS } = require('../constants');

let _app = null;
let _db = null;
let _command = null;

/** 解析初始化 env（云函数内 SYMBOL_CURRENT_ENV，本地用 envId） */
function resolveEnv(env) {
  if (env) return env;
  if (process.env.TCB_ENV) return process.env.TCB_ENV;
  return cloudbase.SYMBOL_CURRENT_ENV;
}

/** 获取（懒初始化）app 实例 */
function getApp(env) {
  if (!_app) {
    _app = cloudbase.init({ env: resolveEnv(env) });
    _db = _app.database();
    _command = _db.command;
  }
  return _app;
}

/** 获取 db 实例 */
function getDb(env) {
  getApp(env);
  return _db;
}

/** 获取 command 操作符 */
function getCommand(env) {
  getApp(env);
  return _command;
}

/** 获取集合句柄 */
function getCollection(name, env) {
  return getDb(env).collection(name);
}

/** CloudBase 文档库未建集合时的典型报错 */
function isMissingCollection(e) {
  const msg = String((e && e.message) || e || '');
  return /ResourceNotFound/i.test(msg) && /not exist|不存在|Table not exist/i.test(msg);
}

/**
 * 集合不存在则创建（已存在则跳过）。
 * 新集合必须先 createCollection，否则 add/query 会 ResourceNotFound。
 */
async function ensureCollection(name, env) {
  const database = getDb(env);
  try {
    await database.createCollection(name);
    return { created: true };
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    if (/ResourceExist|ALREADY_EXIST|已存在|already exists/i.test(msg) && !/not exist|不存在|Table not exist/i.test(msg)) {
      return { created: false, existed: true };
    }
    throw e;
  }
}

/**
 * upsert：按 uniqueKey 查询，存在则 update，不存在则 add。
 * @param {string} name 集合名
 * @param {object} doc 文档
 * @param {object} uniqueKey 唯一键，如 { code, trade_date }
 * @param {string} env 可选环境 id
 * @returns {Promise<{created:boolean, id:string}>}
 */
async function upsert(name, doc, uniqueKey = {}, env, _retried) {
  try {
    const col = getCollection(name, env);
    const where = {};
    Object.keys(uniqueKey).forEach((k) => { where[k] = uniqueKey[k]; });

    const found = await col.where(where).limit(1).get();
    if (found.data && found.data.length > 0) {
      const id = found.data[0]._id;
      const updateData = { ...doc };
      delete updateData._id;
      await col.doc(id).update(updateData);
      return { created: false, id };
    }
    const res = await col.add({ ...doc });
    return { created: true, id: (res && res.id) || null };
  } catch (e) {
    if (!_retried && isMissingCollection(e)) {
      await ensureCollection(name, env);
      return upsert(name, doc, uniqueKey, env, true);
    }
    throw e;
  }
}

/**
 * 批量插入（逐条 add，CloudBase 无原生批量，条数少可接受）。
 * 支持唯一键去重：uniqueKey 存在时先查重跳过。
 * @param {string} name 集合名
 * @param {Array<object>} docs
 * @param {object|null} uniqueKey 如 { code, trade_date }
 * @param {string} env
 * @returns {Promise<{inserted:number, skipped:number}>}
 */
async function batchInsert(name, docs, uniqueKey = null, env) {
  const col = getCollection(name, env);
  let inserted = 0;
  let skipped = 0;
  for (const doc of docs) {
    if (uniqueKey) {
      const where = {};
      Object.keys(uniqueKey).forEach((k) => { where[k] = doc[k]; });
      const found = await col.where(where).limit(1).get();
      if (found.data && found.data.length > 0) { skipped += 1; continue; }
    }
    await col.add({ ...doc });
    inserted += 1;
  }
  return { inserted, skipped };
}

/**
 * 通用查询（自动分页，默认拉全量，limit 可限制）。
 * @param {string} name 集合名
 * @param {object} where 过滤条件 { field: value }（等值；范围用 opts）
 * @param {object} opts { orderBy:[{field,direction}], limit, offset, whereRaw(command) }
 * @param {string} env
 * @returns {Promise<Array<object>>}
 */
async function query(name, where = {}, opts = {}, env) {
  const col = getCollection(name, env);
  const pageSize = 100;
  const maxLimit = opts.limit || 0;
  const orderBy = opts.orderBy || [];
  const offset = opts.offset || 0;

  let chain = col;
  if (opts.whereRaw) {
    chain = opts.whereRaw(chain);
  } else {
    // CloudBase SDK 的 .where() 是替换而非 AND：多 key 时必须合并为单个 where 对象传入，
    // 否则只保留最后一个 key 的过滤（曾致 cooldown 查询丢 code 过滤，所有 ETF 共享同一最近 buy）
    const keys = Object.keys(where);
    if (keys.length > 0) {
      const merged = {};
      keys.forEach((k) => { merged[k] = where[k]; });
      chain = chain.where(merged);
    }
  }
  orderBy.forEach((o) => {
    chain = chain.orderBy(o.field, o.direction || 'asc');
  });

  try {
    const results = [];
    let skip = 0;
    while (true) {
      const take = maxLimit ? Math.min(pageSize, maxLimit - results.length) : pageSize;
      if (take <= 0) break;
      const batch = await chain.skip(offset + skip).limit(take).get();
      const data = (batch && batch.data) || [];
      results.push(...data);
      if (data.length < take) break;
      skip += take;
    }
    return results;
  } catch (e) {
    if (isMissingCollection(e)) return [];
    throw e;
  }
}

/** 按 _id 获取单文档 */
async function getById(name, id, env) {
  const col = getCollection(name, env);
  const res = await col.doc(id).get();
  if (res && res.data && res.data.length > 0) return res.data[0];
  return null;
}

/** 按 _id 更新（返回更新条数） */
async function updateById(name, id, updateData, env) {
  const col = getCollection(name, env);
  const data = { ...updateData };
  delete data._id;
  const res = await col.doc(id).update(data);
  return res ? res.updated || 0 : 0;
}

/** 按 _id 删除 */
async function removeById(name, id, env) {
  const col = getCollection(name, env);
  const res = await col.doc(id).remove();
  return res ? res.deleted || 0 : 0;
}

/**
 * 读取 param_config → 合并为 { key: value } + version。
 * 默认值兜底来自 constants.DEFAULT_PARAMS（调用方 merge）。
 * @returns {Promise<{params:object, version:number}>}
 */
async function getParamConfig(env) {
  const rows = await query(COLLECTIONS.PARAM_CONFIG, {}, {}, env);
  const params = {};
  let version = 0;
  rows.forEach((r) => {
    const v = r.value;
    params[r.key] = (v && typeof v === 'object' && v.v !== undefined) ? v.v : v;
    if (typeof r.version === 'number' && r.version > version) version = r.version;
  });
  return { params, version };
}

/** 读取启用的 ETF 列表（按 sort_order） */
async function getEtfList(env) {
  return query(COLLECTIONS.ETF_BASIC, { status: 'enable' }, {
    orderBy: [{ field: 'sort_order', direction: 'asc' }]
  }, env).catch(async () => {
    // status 可能缺失，回退全量
    return query(COLLECTIONS.ETF_BASIC, {}, {
      orderBy: [{ field: 'sort_order', direction: 'asc' }]
    }, env);
  });
}

/** 读取单只 ETF 基础信息 */
async function getEtf(code, env) {
  const rows = await query(COLLECTIONS.ETF_BASIC, { code }, { limit: 1 }, env);
  return rows[0] || null;
}

/** 读取某 ETF 最新指标快照 */
async function getLatestSnapshot(code, env) {
  const rows = await query(COLLECTIONS.INDICATOR_SNAPSHOT, { code }, {
    orderBy: [{ field: 'calc_date', direction: 'desc' }], limit: 1
  }, env);
  return rows[0] || null;
}

/** 读取某 ETF 最新决策结果 */
async function getLatestDecision(code, env) {
  const rows = await query(COLLECTIONS.DECISION_RESULT, { code }, {
    orderBy: [{ field: 'decision_date', direction: 'desc' }], limit: 1
  }, env);
  return rows[0] || null;
}

/** 读取某 ETF 最新基本面状态 */
async function getLatestFundamentalState(code, env) {
  const rows = await query(COLLECTIONS.FUNDAMENTAL_STATE, { code }, {
    orderBy: [{ field: 'updated_at', direction: 'desc' }], limit: 1
  }, env);
  return rows[0] || null;
}

/** 读取某 ETF（或 ALL）激活中的风险事件 */
async function getActiveRiskEvents(code, env) {
  return query(COLLECTIONS.RISK_EVENTS, { status: 'active' }, {
    orderBy: [{ field: 'trigger_time', direction: 'desc' }]
  }, env).then((rows) => rows.filter((r) => r.code === code || r.code === 'ALL'));
}

/** 读取某 ETF 持仓 */
async function getPosition(code, env) {
  const rows = await query(COLLECTIONS.PORTFOLIO_POSITION, { code }, { limit: 1 }, env);
  return rows[0] || null;
}

module.exports = {
  getApp,
  getDb,
  getCommand,
  getCollection,
  isMissingCollection,
  ensureCollection,
  upsert,
  batchInsert,
  query,
  getById,
  updateById,
  removeById,
  getParamConfig,
  getEtfList,
  getEtf,
  getLatestSnapshot,
  getLatestDecision,
  getLatestFundamentalState,
  getActiveRiskEvents,
  getPosition
};
