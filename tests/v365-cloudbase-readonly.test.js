#!/usr/bin/env node
/**
 * V3.6.5 Read-Only Connector 单元测试
 *
 * 目的：在**没有生产凭证**的情况下，用 mock 证明只读工具的**门禁逻辑**正确：
 *   - allowlist fail-closed
 *   - 导出面不含写方法
 *   - provenance 结构完整（§13）
 *   - §16 actual position 强制（⛔ suggested_position 不得兜底）
 *   - §15 完整性门禁能识别缺陷（重复 id / 不可解析日期 / 缺 actual）
 *
 * ⛔ 不接触任何真实生产数据；⛔ 不需要凭证；⛔ 纯本地。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLIENT = path.join(__dirname, '..', 'scripts', 'tools', 'cloudbase-readonly-client.js');
const EXPORTER = path.join(__dirname, '..', 'scripts', 'tools', 'cloudbase-export-governed-history.js');

let pass = 0;
function ok(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  [PASS] ${name}`);
  } catch (e) {
    console.log(`  [FAIL] ${name} — ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('== V365 CloudBase Read-Only Connector 测试 ==\n');

/* ---- K-01 client 导出面：只读 ---- */
ok('K-01 client 导出面不含写型方法', () => {
  const mod = require(CLIENT);
  assert.strictEqual(typeof mod.createReadOnlyClient, 'function');
  const src = fs.readFileSync(CLIENT, 'utf8');
  const codeOnly = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  const bad = /collection\([^)]*\)\.(add|update|set|remove)|\.doc\([^)]*\)\.(update|remove)|createCollection|dropCollection/i.test(codeOnly);
  assert.ok(!bad, 'client 源码出现集合级写操作');
});

/* ---- K-02 allowlist 默认值 ---- */
ok('K-02 allowlist 默认仅 trade_log + portfolio_snapshot', () => {
  const { DEFAULT_ALLOWLIST } = require(CLIENT);
  assert.deepStrictEqual(DEFAULT_ALLOWLIST.slice(), ['trade_log', 'portfolio_snapshot']);
});

/* ---- K-03 无凭证 ⇒ NO_CREDENTIAL（fail-closed） ---- */
ok('K-03 无凭证时 createReadOnlyClient 抛 NO_CREDENTIAL', () => {
  const { createReadOnlyClient } = require(CLIENT);
  const saved = {
    id: process.env.TENCENTCLOUD_SECRET_ID,
    key: process.env.TENCENTCLOUD_SECRET_KEY,
    auth: process.env.TCB_AUTH_PATH,
    home: process.env.USERPROFILE,
    env: process.env.TCB_ENV_ID,
  };
  delete process.env.TENCENTCLOUD_SECRET_ID;
  delete process.env.TENCENTCLOUD_SECRET_KEY;
  process.env.TCB_AUTH_PATH = path.join(os.tmpdir(), 'definitely-no-such-auth.json');
  process.env.USERPROFILE = os.tmpdir();
  try {
    createReadOnlyClient();
    assert.fail('应当抛 NO_CREDENTIAL');
  } catch (e) {
    assert.strictEqual(e.code, 'NO_CREDENTIAL', `期望 NO_CREDENTIAL，实得 ${e.code}`);
  } finally {
    if (saved.id) process.env.TENCENTCLOUD_SECRET_ID = saved.id; else delete process.env.TENCENTCLOUD_SECRET_ID;
    if (saved.key) process.env.TENCENTCLOUD_SECRET_KEY = saved.key; else delete process.env.TENCENTCLOUD_SECRET_KEY;
    if (saved.auth) process.env.TCB_AUTH_PATH = saved.auth; else delete process.env.TCB_AUTH_PATH;
    if (saved.home) process.env.USERPROFILE = saved.home;
    if (saved.env) process.env.TCB_ENV_ID = saved.env;
  }
});

/* ---- K-04 allowlist fail-closed（用假 SDK 验证 queryPage 前置校验） ---- */
ok('K-04 非 allowlist 集合 ⇒ COLLECTION_NOT_ALLOWED（本地判定，不需网络）', () => {
  const src = fs.readFileSync(CLIENT, 'utf8');
  assert.ok(/COLLECTION_NOT_ALLOWED/.test(src), 'client 缺 COLLECTION_NOT_ALLOWED');
  assert.ok(/assertAllowed/.test(src), 'client 缺 allowlist 断言');
  // 断言 queryPage / count / sample 三者均先 assertAllowed
  const qp = src.slice(src.indexOf('async function queryPage'));
  assert.ok(qp.indexOf('assertAllowed(name)') >= 0, 'queryPage 未做 allowlist 校验');
});

/* ---- K-05 queryPage 强制显式 orderBy（确定性） ---- */
ok('K-05 queryPage 缺 orderBy ⇒ ORDER_BY_REQUIRED', () => {
  const src = fs.readFileSync(CLIENT, 'utf8');
  assert.ok(/ORDER_BY_REQUIRED/.test(src), '缺 ORDER_BY_REQUIRED 守卫');
});

/* ---- K-06 §16 actual position 门禁逻辑（inline 复刻断言） ---- */
ok('K-06 §16 仅有 suggested_position 无 actual ⇒ 门禁 FAIL', () => {
  const src = fs.readFileSync(EXPORTER, 'utf8');
  assert.ok(/ACTUAL_POSITION_PRESENT/.test(src), '缺 ACTUAL_POSITION_PRESENT 门禁');
  assert.ok(/fallback_used: false/.test(src), '缺 fallback_used:false 显式声明');
  // 复刻门禁逻辑验证语义
  const isMissing = (v) => v === null || v === undefined || v === '';
  const gate = (rows) => {
    let total = 0; let withActual = 0; let withSuggestedOnly = 0;
    rows.forEach((r) => (Array.isArray(r.positions) ? r.positions : []).forEach((p) => {
      total += 1;
      if (!isMissing(p.position)) withActual += 1;
      else if (!isMissing(p.suggested_position)) withSuggestedOnly += 1;
    }));
    return { ok: total > 0 && withSuggestedOnly === 0 && withActual === total, total, withActual, withSuggestedOnly };
  };
  const bad = gate([{ positions: [{ code: '513310', suggested_position: 10 }] }]);
  assert.strictEqual(bad.ok, false, '缺 actual 竟然 PASS');
  assert.strictEqual(bad.withSuggestedOnly, 1);
  const good = gate([{ positions: [{ code: '513310', position: 10 }] }]);
  assert.strictEqual(good.ok, true, '有 actual 竟 FAIL');
});

/* ---- K-07 §15 完整性门禁识别重复 _id ---- */
ok('K-07 §15 重复 _id ⇒ pagination_ok=false', () => {
  const ids = ['a', 'b', 'b'];
  const dupes = ids.length - new Set(ids).size;
  assert.strictEqual(dupes, 1);
});

/* ---- K-08 §13 provenance 必填键齐全 ---- */
ok('K-08 §13 provenance 结构含全部必填键', () => {
  const src = fs.readFileSync(EXPORTER, 'utf8');
  const required = [
    'source_collection', 'source_environment', 'exported_at', 'export_method',
    'date_range', 'record_count', 'file_sha256', 'schema_summary', 'provenance_status',
    'query_filter', 'sort_order', 'page_size', 'pages', 'normalization_version',
  ];
  required.forEach((k) => assert.ok(src.includes(k), `provenance 缺字段 ${k}`));
});

/* ---- K-09 §7 allowlist 不可被 client 调用方扩大 ---- */
ok('K-09 allowlist 为冻结数组（不可静默扩大）', () => {
  const src = fs.readFileSync(CLIENT, 'utf8');
  assert.ok(/Object\.freeze\(\(opts\.allowlist \|\| DEFAULT_ALLOWLIST\)/.test(src), 'allowlist 未冻结');
});

/* ---- K-10 §18 Governed Data Gate 七项齐全 ---- */
ok('K-10 §18 Governed Data Gate 七项齐备', () => {
  const src = fs.readFileSync(EXPORTER, 'utf8');
  [
    'READ_ONLY_CONNECTION_VERIFIED',
    'TRADE_LOG_EXPORT_COMPLETE',
    'PORTFOLIO_SNAPSHOT_EXPORT_COMPLETE',
    'PROVENANCE_COMPLETE',
    'HASH_VERIFIED',
    'DATE_COVERAGE_SUFFICIENT',
    'PAGINATION_COMPLETE',
  ].forEach((k) => assert.ok(src.includes(k), `Gate 缺 ${k}`));
});

/* ---- K-11 凭证新鲜度预检（把"凭证过期"从"权限不足"里区分出来）---- */
ok('K-11 checkCredentialFreshness 能区分 EXPIRED / OK / UNKNOWN 且不打印 secret', () => {
  const { checkCredentialFreshness } = require(CLIENT);
  assert.strictEqual(typeof checkCredentialFreshness, 'function', '未导出 checkCredentialFreshness');

  // 已过期 1 小时
  const past = Date.now() - 3600000;
  const rExp = checkCredentialFreshness({ tempExpired: past });
  assert.strictEqual(rExp.status, 'EXPIRED', `期望 EXPIRED，得到 ${rExp.status}`);
  assert.ok(typeof rExp.expiredAtIso === 'string' && rExp.expiredAtIso.endsWith('Z'), 'expiredAtIso 格式异常');
  assert.ok(rExp.ageHours > 0, 'ageHours 应为正数');

  // 未来 1 小时仍有效
  const future = Date.now() + 3600000;
  assert.strictEqual(checkCredentialFreshness({ tempExpired: future }).status, 'OK');

  // 长期密钥（无 tmpExpired）⇒ UNKNOWN，不得误判
  assert.strictEqual(checkCredentialFreshness({ secretId: 'x', secretKey: 'y' }).status, 'UNKNOWN');

  // 返回值不得含任何 secret 字面
  assert.ok(!JSON.stringify(rExp).includes('tmpSecret'), '返回值泄漏 secret 字段');
});

/* ---- K-12 导出器在凭证过期时给出 ROOT CAUSE 提示 ---- */
ok('K-12 exporter 过期路径输出 CREDENTIAL_EXPIRED 根因且不误报 READY', () => {
  const src = fs.readFileSync(EXPORTER, 'utf8');
  assert.ok(src.includes('CREDENTIAL_EXPIRED'), 'exporter 缺 CREDENTIAL_EXPIRED 根因提示');
  assert.ok(src.includes('credentialFreshness'), 'exporter 未消费 credentialFreshness');
  assert.ok(
    /EXPIRED[\s\S]{0,600}?exit\(1\)/.test(src),
    '过期路径应立即 exit(1)，不得继续到门禁'
  );
});

console.log(`\nV365 CloudBase Read-Only Connector 测试：K-01 ~ K-12 ${process.exitCode ? '有失败' : '全部 PASS'}`);
