#!/usr/bin/env node
/**
 * V3.6.5 Read-Only Safety Test（§6 R-01 ~ R-06）
 *
 * 在第一次读取真实业务数据前，先证明只读连接的安全性。
 * ⛔ 本脚本**只读**：不写生产、不改仓库、不打印任何 secret 值。
 *
 * 输出：R-01..R-06 逐项 PASS/FAIL + 机器可读 JSON（写本地 evidence）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT_SRC = path.join(__dirname, 'cloudbase-readonly-client.js');

const results = [];
function rec(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: detail || null });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  console.log('== V3.6.5 Read-Only Safety Test ==\n');

  const src = fs.readFileSync(CLIENT_SRC, 'utf8');

  // ---- R-03: 源码内不存在 mutation 调用（先做静态的，不需要凭证）----
  {
    // 去掉注释行后再检测，避免注释里"提到"mutation 被误判；
    // 但为严格起见，同时检查含注释版本：只要**代码行**（非注释）无 mutation 即可。
    const codeLines = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
    const codeOnly = codeLines.join('\n');
    const mutationRe = /\.(add|update|updateById|set|remove|removeById)\s*\(|createCollection|deleteCollection|dropCollection|\.deploy\s*\(/;
    const hit = codeOnly.match(mutationRe);
    rec('R-03', 'exporter/connector 源码内不存在生产 DB mutation 调用', !hit,
      hit ? `发现: ${hit[0]}` : '零 mutation 调用（代码行）');
  }

  // ---- R-04: 若采用 MCP，tool schema 不得暴露写型 action ----
  {
    // 本方案不走 MCP（走本地脚本 client），故不存在 tool schema。
    // 记录为"以本地只读模块替代 MCP，故无 tool schema"，并校验模块导出面只含读方法。
    let exported = [];
    try {
      const mod = require(CLIENT_SRC);
      exported = Object.keys(mod);
      // 检查 createReadOnlyClient 返回对象的方法名集合
      const src2 = fs.readFileSync(CLIENT_SRC, 'utf8');
      const retBlock = src2.slice(src2.indexOf('return {\n    envId'));
      const methods = (retBlock.match(/^\s{4}([a-zA-Z]+),?$/gm) || [])
        .map((s) => s.trim().replace(/,$/, ''))
        .filter((m) => !['envId', 'allowlist', 'credentialSource'].includes(m));
      const writeLike = methods.filter((m) => /add|update|set|remove|delete|create|drop|deploy|write|insert/i.test(m));
      rec('R-04', 'connector 导出面不含写型方法（本地模块替代 MCP，无 tool schema）',
        writeLike.length === 0, `导出方法=[${methods.join(', ')}]`);
    } catch (e) {
      rec('R-04', 'connector 导出面不含写型方法', false, `加载失败: ${e.message}`);
    }
  }

  // ---- R-05: credential 不出现在仓库文件 / 本脚本输出 ----
  {
    const leaked = /AKID[A-Za-z0-9]{10,}|["']?secretKey["']?\s*[:=]\s*["'][A-Za-z0-9]{16,}/.test(src);
    rec('R-05', 'credential 不出现在 exporter 源码（且输出不打印完整 secret）', !leaked,
      leaked ? '疑似字面量' : '源码零 secret');
  }

  // ---- R-01 / R-02 / R-06: 需要凭证的联网测试 ----
  let client = null;
  try {
    const { createReadOnlyClient } = require(CLIENT_SRC);
    client = createReadOnlyClient();
    rec('R-01', '可以 connect（凭证已加载 + SDK 可用）', true,
      `env=${client.envId} · credential_source=${client.credentialSource}`);
  } catch (e) {
    rec('R-01', '可以 connect', false, `${e.code || 'ERROR'}: ${e.message}`);
    if (e.code === 'NO_CREDENTIAL') {
      console.log('\n== 结论 ==');
      console.log('CLOUDBASE_READONLY_CONNECTOR = READY');
      console.log('CREDENTIAL = REQUIRED');
      console.log('FREEZE_REVIEW = BLOCKED');
      writeEvidence({ connector: 'READY', credential: 'REQUIRED', results });
      process.exit(2);
    }
  }

  if (client) {
    // R-02: 读取一个 collection 的 metadata / count 或 limit(1)
    // ⚠️ 必须**真实**调用一次 count；失败 ⇒ R-01 实际未通过（不能只看 client 能否构建）。
    let connectionLive = false;
    let probeError = null;
    try {
      const n = await client.count(client.allowlist[0]);
      connectionLive = true;
      rec('R-02', `可读取 ${client.allowlist[0]} 的 count`, true, `document_count=${n}`);
    } catch (e) {
      probeError = `${e.code || 'ERROR'}: ${String(e.message).slice(0, 160)}`;
      rec('R-02', `可读取 ${client.allowlist[0]} 的 count`, false, probeError);
    }

    // 诚实修正 R-01：client 可构建 ≠ 连接可用。以 R-02 的真实探测为准。
    if (!connectionLive) {
      // 回写 R-01 为 FAIL（凭证存在但已失效 / 无读取权限）
      const r01 = results.find((r) => r.id === 'R-01');
      if (r01) {
        r01.ok = false;
        r01.detail = `client 可构建但真实查询失败 ⇒ 连接未建立（${probeError}）`;
      }
      console.log(`  [FAIL] R-01 可以 connect（修正）— client 可构建但真实查询失败：${probeError}`);
    }

    // R-06: 故意请求未允许集合 ⇒ FAIL CLOSED（此检查不依赖真实连接，纯本地 allowlist 判定）
    try {
      await client.queryPage('etf_daily', { orderBy: [{ field: '_id' }], maxRows: 1 });
      rec('R-06', '非 allowlist 集合请求 ⇒ FAIL CLOSED', false, '竟然返回了数据（未 fail-closed）');
    } catch (e) {
      rec('R-06', '非 allowlist 集合请求 ⇒ FAIL CLOSED', e.code === 'COLLECTION_NOT_ALLOWED',
        `${e.code}: ${e.message.slice(0, 80)}`);
    }
  }

  const staticPass = results.filter((r) => ['R-03', 'R-04', 'R-05', 'R-06'].includes(r.id)).every((r) => r.ok);
  const livePass = results.filter((r) => ['R-01', 'R-02'].includes(r.id)).every((r) => r.ok);
  const allPass = staticPass && livePass;

  console.log('\n== 结论 ==');
  console.log(`STATIC_READONLY_GUARDS = ${staticPass ? 'PASS' : 'FAIL'}（R-03/R-04/R-05/R-06，不依赖凭证）`);
  console.log(`LIVE_CONNECTION_PROBE  = ${livePass ? 'PASS' : 'FAIL'}（R-01/R-02，需有效凭证 + 读权限）`);
  console.log(`CLOUDBASE_READONLY_CONNECTOR = READY`);
  console.log(`CLOUDBASE_READONLY_CONNECTION = ${livePass ? 'VERIFIED' : 'NOT_ESTABLISHED'}`);
  if (!livePass) {
    // 区分「无凭证」与「凭证失效 / 权限不足」
    const errCode = (results.find((r) => r.id === 'R-02') || {}).detail || '';
    const credentialRequired = /NO_CREDENTIAL/.test(errCode);
    console.log(`CREDENTIAL = ${credentialRequired ? 'REQUIRED' : 'PRESENT_BUT_UNUSABLE'}`);
    console.log(`READ_PERMISSION = ${credentialRequired ? 'N/A' : 'INSUFFICIENT_OR_EXPIRED'}`);
  }
  console.log('FREEZE_REVIEW = BLOCKED');
  writeEvidence({
    connector: 'READY',
    connection: livePass ? 'VERIFIED' : 'NOT_ESTABLISHED',
    static_readonly_guards: staticPass ? 'PASS' : 'FAIL',
    live_connection_probe: livePass ? 'PASS' : 'FAIL',
    results,
  });
  process.exit(allPass ? 0 : 1);
}

function writeEvidence(payload) {
  const dir = path.join(ROOT, 'deliverables', 'v365-production-history');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'readonly-safety-test.json');
    fs.writeFileSync(out, JSON.stringify({
      generated_at: new Date().toISOString(),
      ...payload,
    }, null, 2), 'utf8');
    console.log(`evidence -> ${path.relative(ROOT, out)}`);
  } catch (e) {
    console.error(`(evidence 写入失败: ${e.message})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
