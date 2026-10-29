#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 —— 平台级 CAS 并发实测探针（**默认拒绝运行**）。
 *
 * ⚠️⚠️ **SUPERSEDED（2026-09-24，请勿据本脚本下结论）** ⚠️⚠️
 *   本脚本按「多文档事务」假设设计（走 SDK `db.runTransaction`）。真实平台实测已推翻该假设：
 *     • 可及通道（`tcb.RunCommands`）**没有**事务命令（`{"startTransaction":1}` → `CommandNotFound`）；
 *     • 且本协议的 atomicity 定义**只要求单文档指针原子切换**，不需要多文档提交。
 *   ⇒ Q7 已重裁：`TRANSACTION_REQUIRED = NO` / `PLATFORM_SINGLE_DOCUMENT_CAS_REQUIRED = YES`；
 *     证据与实际采用机制见 **`docs/V365_PLATFORM_CAS_EVIDENCE.md`**。
 *   ⇒ 本脚本**不再是** Q7 的证据来源；保留仅为历史留痕。⛔ 不得用它证明或否定 CAS 行为。
 *   （另注：本脚本需要 SDK 凭据或部署后执行，二者在本机/本轮均不可用，故从未运行。）
 *
 * 为什么曾需要它（任务书 §10）：
 *   P-3/P-4 的原子性只在**内存适配器**上被证明（协议层）。要断言
 *   「两个并发 promotion 中，较旧 run 绝不可能覆盖较新 run」必须在**真实平台**上实测。
 *   ②③④ 都要求**向真实环境写入** —— 按 §15「任何 production write：需要另行授权」，
 *   本脚本**默认直接退出**，不做任何写操作。
 *
 * 使用（需用户显式授权后）：
 *   node scripts/v365-cas-platform-probe.js --i-have-authorization \
 *        --env <envId> --collection _v365_cas_probe
 *
 * 安全设计：
 *   - 集合名默认 `_v365_cas_probe`，且**必须**以 `_v365_` 前缀开头（本脚本强制校验）
 *     ⇒ 不与任何生产集合、任何 reader 交集。
 *   - 全部写入只针对该探针集合；结束时打印清理指令（⛔ 不自动删除，便于人工复核）。
 *   - 只探测 CAS 语义，不写任何候选/指针业务数据。
 */

const path = require('path');

const REQUIRED_FLAG = '--i-have-authorization';
const PREFIX = '_v365_';

function refuse(reason) {
  console.error('[REFUSE] ' + reason);
  console.error('');
  console.error('本探针会向**真实环境**写入测试文档（仅限 _v365_ 前缀的独立探针集合）。');
  console.error('按 V3.6.5 任务书 §15：任何 production write 需要**另行授权**。');
  console.error('⇒ 未授权时不得运行。');
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const getArg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

  if (!argv.includes(REQUIRED_FLAG)) {
    refuse('缺少显式授权开关 ' + REQUIRED_FLAG);
  }
  const envId = getArg('--env');
  const coll = getArg('--collection') || '_v365_cas_probe';
  if (!envId) refuse('缺少 --env');
  if (!coll.startsWith(PREFIX)) refuse('探针集合名必须以 ' + PREFIX + ' 开头（防止误写生产集合），实得 ' + coll);

  // 只有走到这里才加载 SDK（未授权时连 require 都不做）
  process.env.TCB_ENV = envId;
  const cloudbase = require('@cloudbase/node-sdk');
  const app = cloudbase.init({ env: envId });
  const db = app.database();

  const SCOPE = '__probe_scope__';

  async function cas(scope, expected, next) {
    return db.runTransaction(async (tx) => {
      const col = tx.collection(coll);
      const got = await col.where({ scope }).limit(1).get();
      const cur = got && got.data && got.data[0] ? got.data[0] : null;
      const idOf = (p) => (p == null ? null : `${p.run_id}@${p.revision}`);
      if (idOf(cur) !== idOf(expected)) return { ok: false, code: 'CAS_REJECTED', current: cur };
      const doc = Object.assign({}, next, { scope, updated_at: new Date().toISOString() });
      if (cur) await col.doc(cur._id).update(doc);
      else await col.add(doc);
      return { ok: true, code: 'OK', current: doc };
    });
  }

  (async () => {
    const log = (k, v) => console.log(k.padEnd(34) + ' = ' + JSON.stringify(v));

    // 0) 能力探测（只读）
    log('runTransaction 类型', typeof db.runTransaction);
    log('startTransaction 类型', typeof db.startTransaction);

    // 1) 初始化指针为 run-A@1（期望：ok）
    const r1 = await cas(SCOPE, null, { run_id: 'run-A', revision: 1 });
    log('① 初始 CAS（期望 ok）', r1);

    // 2) 两个并发 promotion，都持同一 expected(run-A@1)，分别想写 run-B@2 / run-C@9
    const [b, c] = await Promise.all([
      cas(SCOPE, { run_id: 'run-A', revision: 1 }, { run_id: 'run-B', revision: 2 }),
      cas(SCOPE, { run_id: 'run-A', revision: 1 }, { run_id: 'run-C', revision: 9 })
    ]);
    log('② 并发 A→B@2', b);
    log('② 并发 A→C@9', c);
    const exactlyOne = [b, c].filter((x) => x.ok === true).length === 1;
    log('② 恰好一个成功（CAS 语义）', exactlyOne);

    // 3) 持过期快照（run-A@1）再写 ⇒ 必须被拒
    const stale = await cas(SCOPE, { run_id: 'run-A', revision: 1 }, { run_id: 'run-STALE', revision: 99 });
    log('③ 过期 expected 必须被拒', stale.ok === false);
    const finalPtr = await db.collection(coll).where({ scope: SCOPE }).limit(1).get();
    log('③ 最终指针未被 stale 覆盖', finalPtr && finalPtr.data && finalPtr.data[0]
      ? finalPtr.data[0].run_id : null);

    console.log('');
    console.log('清理（需另行执行，本脚本不自动删）：');
    console.log('  db.collection("' + coll + '").where({ scope: "' + SCOPE + '" }).remove()');
    console.log('');
    console.log('判定：若 ② 恰好一个成功 且 ③ 过期被拒 ⇒ 可把 CAS_EVIDENCE.platform_concurrency_tested 置 true。');
  })().catch((e) => { console.error('[ERROR] ' + (e && e.message || e)); process.exit(1); });
}

if (require.main === module) main();

module.exports = { REQUIRED_FLAG, PREFIX };
