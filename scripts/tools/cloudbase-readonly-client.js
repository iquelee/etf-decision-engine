#!/usr/bin/env node
/**
 * V3.6.5 CloudBase READ-ONLY client（最小权限 · 结构上无写能力）
 *
 * 目的：为 V3.6.5「GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED」解阻塞提供一个
 *       **只读**的生产数据访问面，用于导出 `trade_log` 与 `portfolio_snapshot`。
 *
 * ⛔ 设计原则（READ ONLY / FAIL CLOSED / LEAST PRIVILEGE）：
 *   - 本模块**只**暴露：listCollections / count / queryPage / sample
 *   - 本模块**不存在**任何 mutation 方法（无 add / update / set / remove /
 *     createCollection / dropCollection / deploy / invoke-mutation）
 *   - 写方法在工具层**根本不存在**，而非依赖调用方"记得不要调用"
 *   - 非 allowlist 集合 ⇒ 直接 fail-closed 抛错（不静默返回空）
 *   - 凭证只从环境/本地 gitignored 文件读取；**绝不出现在本文件或任何仓库文件**
 *
 * ⛔ 与生产代码零耦合：本模块**不 require** `src/common/utils/db.js`（后者含 mutation 能力），
 *   也不被任何 cloudfunction / 业务链 require。
 *
 * @module scripts/tools/cloudbase-readonly-client
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** 允许访问的集合（§7 Collection allowlist）—— 默认仅这两个 */
const DEFAULT_ALLOWLIST = Object.freeze(['trade_log', 'portfolio_snapshot']);

/** 生产环境 id（来源：仓库既有 scripts/ml/export-etf-daily-cloudbase.js） */
const DEFAULT_ENV_ID = 'tradingview-etf-d0fa42yy57cbc11b';

/** SDK 位置：优先仓库内已存在的 dist-functions 依赖（无需新装） */
const SDK_CANDIDATES = [
  process.env.TCB_SDK_PATH,
  ...['apiGateway', 'runDecisionEngine', 'adminGateway'].map((fn) =>
    path.join(ROOT, 'dist-functions', fn, 'node_modules', '@cloudbase', 'node-sdk')
  ),
  path.join(ROOT, 'node_modules', '@cloudbase', 'node-sdk'),
].filter(Boolean);

/* ------------------------------------------------------------------ *
 * 凭证加载（§4 Credentials 安全规则）
 * 只从：环境变量 或 本机 gitignored 凭证文件读取。
 * ⛔ 绝不写入仓库；⛔ 绝不打印 secret 值。
 * ------------------------------------------------------------------ */

/**
 * 凭证来源优先级：
 *   1. TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY（+ 可选 TENCENTCLOUD_TOKEN）
 *   2. TCB_AUTH_PATH 指向的 auth.json
 *   3. 约定路径 .tcb-home/.config/.cloudbase/auth.json（仓库内，gitignored）
 *   4. 用户家目录 ~/.config/.cloudbase/auth.json（cloudbase CLI 登录态）
 * @returns {{secretId:string, secretKey:string, token?:string, source:string}|null}
 */
function loadCredential() {
  // 1. 环境变量（最优先，官方字段名）
  const envId = process.env.TENCENTCLOUD_SECRET_ID;
  const envKey = process.env.TENCENTCLOUD_SECRET_KEY;
  if (envId && envKey) {
    return {
      secretId: envId,
      secretKey: envKey,
      token: process.env.TENCENTCLOUD_TOKEN || undefined,
      source: 'env:TENCENTCLOUD_SECRET_ID/TENCENTCLOUD_SECRET_KEY',
    };
  }

  // 2/3/4. auth.json 文件
  const authPath = process.env.TCB_AUTH_PATH
    || path.join(ROOT, '.tcb-home', '.config', '.cloudbase', 'auth.json');
  const candidates = [authPath];
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) candidates.push(path.join(home, '.config', '.cloudbase', 'auth.json'));

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      continue;
    }
    // 兼容 cloudbase CLI 的**两种**结构：
    //   (a) { credential: { tmpSecretId, tmpSecretKey, tmpToken, tmpExpired } }        ← CLI login 新版（扁平）
    //   (b) { credential: { domestic: { tmpSecretId, tmpSecretKey, tmpToken } } }      ← CLI 旧版（按地域嵌套）
    const credRoot = raw.credential || {};
    const flat = credRoot.tmpSecretId ? credRoot : (credRoot.domestic || null);
    if (flat && flat.tmpSecretId && flat.tmpSecretKey) {
      const viaDomestic = flat === credRoot.domestic;
      return {
        secretId: flat.tmpSecretId,
        secretKey: flat.tmpSecretKey,
        token: flat.tmpToken || undefined,
        tempExpired: flat.tmpExpired || null,
        source: `file:${p}#credential${viaDomestic ? '.domestic' : ''}`,
      };
    }
    const c = raw.credential || raw;
    if (c.secretId && c.secretKey) {
      return {
        secretId: c.secretId,
        secretKey: c.secretKey,
        token: c.token || undefined,
        source: `file:${p}`,
      };
    }
  }
  return null;
}

/**
 * 临时凭证过期预检（只读 · 不触网）。
 *
 * ⚠️ 背景：`@cloudbase/node-sdk` 对**已过期**的临时凭证不会返回 `TOKEN_EXPIRED`，
 *    而是回落成误导性的 `SIGN_PARAM_INVALID: secret id error`。
 *    本函数把"过期"这一根因提前识别出来，避免把**凭证陈旧**误判成**权限不足**。
 *
 * 设计约束：
 *   - ⛔ 仅在**凭证带着 tmpExpired 时间戳**时才判定（环境变量长期密钥无此字段 ⇒ 跳过）。
 *   - ⛔ 不触网、不打印任何 secret 值，只比对时间戳。
 *   - 判定结果只是**前置提示**；真正的权威结论仍来自后续真实读调用（FAIL CLOSED 不变）。
 *
 * @param {{tempExpired?:number|null, source?:string}} cred
 * @returns {{status:'OK'|'EXPIRED'|'UNKNOWN', expiredAtIso:string|null, ageHours:number|null}}
 */
function checkCredentialFreshness(cred) {
  const exp = cred && cred.tempExpired;
  if (!exp || typeof exp !== 'number') {
    return { status: 'UNKNOWN', expiredAtIso: null, ageHours: null };
  }
  const now = Date.now();
  const ageHours = Math.round(((now - exp) / 3600000) * 10) / 10;
  const iso = new Date(exp).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  return { status: now > exp ? 'EXPIRED' : 'OK', expiredAtIso: iso, ageHours };
}

/** 解析并加载 SDK 模块（绝对路径，无需 NODE_PATH） */
function loadSdk() {
  for (const base of SDK_CANDIDATES) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require(base);
    } catch (e) {
      /* try next */
    }
  }
  // 最后尝试裸 require（若 NODE_PATH / node_modules 已就绪）
  try {
    // eslint-disable-next-line global-require
    return require('@cloudbase/node-sdk');
  } catch (e) {
    throw new Error(
      'CloudBase SDK 不可用：未在 dist-functions/*/node_modules 或 node_modules 找到 @cloudbase/node-sdk'
    );
  }
}

/**
 * 创建一个**只读**数据库客户端。
 *
 * @param {object} [opts]
 * @param {string} [opts.envId]     生产环境 id（默认 DEFAULT_ENV_ID）
 * @param {string[]} [opts.allowlist] 允许访问的集合（默认 DEFAULT_ALLOWLIST）
 * @param {object} [opts.credential] 显式凭证（测试用；生产走 loadCredential）
 * @returns {{ listCollections:Function, count:Function, queryPage:Function, sample:Function,
 *            envId:string, allowlist:string[], credentialSource:string }}
 */
function createReadOnlyClient(opts = {}) {
  const envId = opts.envId || process.env.TCB_ENV_ID || DEFAULT_ENV_ID;
  const allowlist = Object.freeze((opts.allowlist || DEFAULT_ALLOWLIST).slice());
  const allowSet = new Set(allowlist);

  const cred = opts.credential || loadCredential();
  if (!cred) {
    const err = new Error('NO_CREDENTIAL: 未找到 CloudBase 凭证（环境变量或 auth.json）');
    err.code = 'NO_CREDENTIAL';
    throw err;
  }
  // 只读、不触网的凭证新鲜度预检（把"凭证过期"从"权限不足"里区分出来）
  if (!cred.freshness) cred.freshness = checkCredentialFreshness(cred);

  const cloudbase = loadSdk();
  // ⚠️ 关键：@cloudbase/node-sdk 的临时凭证字段名是 **sessionToken**，不是 `token`。
  //    传 `token` 会被 SDK **静默忽略** ⇒ 临时密钥缺少 STS token ⇒ 服务端返回误导性的
  //    `SIGN_PARAM_INVALID: secret id error`（看起来像"凭证错"，实为"token 没带上"）。
  const app = cloudbase.init({
    env: envId,
    secretId: cred.secretId,
    secretKey: cred.secretKey,
    ...(cred.token ? { sessionToken: cred.token } : {}),
  });
  const db = app.database();

  /** FAIL CLOSED：非 allowlist 集合直接抛错，绝不静默返回空 */
  function assertAllowed(name) {
    if (!allowSet.has(name)) {
      const err = new Error(
        `COLLECTION_NOT_ALLOWED: "${name}" 不在 allowlist ${JSON.stringify(allowlist)} 内（FAIL CLOSED）`
      );
      err.code = 'COLLECTION_NOT_ALLOWED';
      throw err;
    }
  }

  /**
   * 列出集合（仅返回 allowlist 内的存在性，不暴露全库结构）。
   * ⛔ 注意：CloudBase node-sdk 无公开 listCollections；此处以 count() 探活代替。
   * ⚠️ **fail-closed**：若 count 因**连接/凭证**错误失败 ⇒ 抛出（不得静默当作"不存在"）。
   *    仅"集合确实不存在"（ResourceNotFound）才记为 exists:false。
   * @returns {Promise<Array<{collection:string, exists:boolean, document_count:number|null}>>}
   */
  async function listCollections() {
    const out = [];
    for (const name of allowlist) {
      try {
        const n = await count(name);
        out.push({ collection: name, exists: true, document_count: n });
      } catch (e) {
        const msg = String((e && e.message) || e || '');
        const missing = /ResourceNotFound/i.test(msg) && /not exist|不存在|Table not exist/i.test(msg);
        if (missing) {
          out.push({ collection: name, exists: false, document_count: null });
        } else {
          // 连接 / 凭证 / 权限类错误 ⇒ fail-closed 抛出，不掩盖
          throw e;
        }
      }
    }
    return out;
  }

  /**
   * 计数（metadata probe，§8）。
   * CloudBase count() 受 1000 上限约束时回退为分页计数。
   * @param {string} name
   * @param {object} [where] 等值过滤
   * @returns {Promise<number>}
   */
  async function count(name, where = {}) {
    assertAllowed(name);
    let chain = db.collection(name);
    const keys = Object.keys(where);
    if (keys.length > 0) chain = chain.where(where);
    const res = await chain.count();
    return (res && (res.total !== undefined ? res.total : res.count)) || 0;
  }

  /**
   * 确定性分页查询（§10）。
   * ⛔ 不依赖 SDK 默认 limit；必须显式 orderBy；page 推进直到 exhausted。
   *
   * @param {string} name
   * @param {object} [opts]
   * @param {object} [opts.where]      等值过滤
   * @param {Array<{field:string,direction?:string}>} [opts.orderBy] 稳定排序（必填以保确定性）
   * @param {number} [opts.pageSize]   页大小（默认 100，CloudBase 单页上限 1000）
   * @param {number} [opts.maxRows]    安全上限（默认 0 = 不限）
   * @param {Function} [opts.onPage]   每页回调 (rows, pageIndex) => void
   * @returns {Promise<{rows:object[], pages:number, queried_count:number, order_by:Array, page_size:number}>}
   */
  async function queryPage(name, opts = {}) {
    assertAllowed(name);
    const pageSize = Math.min(opts.pageSize || 100, 1000);
    const maxRows = opts.maxRows || 0;
    const where = opts.where || {};
    const orderBy = opts.orderBy || [];
    if (!orderBy.length) {
      // 强制确定性：不显式排序 ⇒ fail-closed（避免依赖 DB 自然顺序）
      const err = new Error('ORDER_BY_REQUIRED: 分页导出必须显式 orderBy 以保证确定性');
      err.code = 'ORDER_BY_REQUIRED';
      throw err;
    }

    let chain = db.collection(name);
    const keys = Object.keys(where);
    if (keys.length > 0) chain = chain.where(where);
    orderBy.forEach((o) => {
      chain = chain.orderBy(o.field, o.direction || 'asc');
    });

    const rows = [];
    let pages = 0;
    let skip = 0;
    for (;;) {
      if (maxRows && rows.length >= maxRows) break;
      const take = maxRows ? Math.min(pageSize, maxRows - rows.length) : pageSize;
      if (take <= 0) break;
      const batch = await chain.skip(skip).limit(take).get();
      const data = (batch && batch.data) || [];
      rows.push(...data);
      pages += 1;
      if (opts.onPage) opts.onPage(data, pages);
      if (data.length < take) break; // exhausted
      skip += take;
    }
    return { rows, pages, queried_count: rows.length, order_by: orderBy, page_size: pageSize };
  }

  /** 取若干条样本（schema probe，§8） */
  async function sample(name, n = 3, orderBy) {
    assertAllowed(name);
    const r = await queryPage(name, {
      pageSize: Math.min(n, 1000),
      maxRows: n,
      orderBy: orderBy || [{ field: '_id', direction: 'asc' }],
    });
    return r.rows;
  }

  return {
    envId,
    allowlist,
    credentialSource: cred.source, // ⛔ 只含"来源描述"，不含 secret 值
    credentialFreshness: cred.freshness, // ⛔ 仅含 status/时间戳，不含 secret 值
    listCollections,
    count,
    queryPage,
    sample,
  };
}

module.exports = {
  createReadOnlyClient,
  loadCredential,
  checkCredentialFreshness,
  DEFAULT_ALLOWLIST,
  DEFAULT_ENV_ID,
};
