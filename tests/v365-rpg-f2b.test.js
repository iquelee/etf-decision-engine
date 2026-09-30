#!/usr/bin/env node
/**
 * RPG-F2-B —— actual-execution cooldown 专项测试（B-01 ~ B-12）
 *
 * 授权依据（owner，2026-09-29）：
 *   `OWNER_REPLAY_INFRA_AUTHORIZED = true`
 *   `OWNER_AUTHORIZATION_SHA = c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
 *   `replay_infra_review = REPLAY_INFRA_CHANGE_REVIEW_REQUIRED`
 *
 * ⛔ 只读（不改任何生产文件）；一次性跑全部协议，断言复用该结果。
 * ⛔ 归因 taxonomy **未扩大**（owner §4）：只允许 `effective_tech_cap_fidelity` / `cooldown_gate_exercised`。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const HARNESS = path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js');
const harness = require(HARNESS);
const cooldown = require(path.join(REPO, 'src', 'common', 'utils', 'cooldown.js'));
const constants = require(path.join(REPO, 'src', 'common', 'constants.js'));

const V1_ANCHOR_EXPECTED = '25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723';
const V2CF_ANCHOR_EXPECTED = 'b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832';
const FROM = '2026-08-01';
const TO = '2026-09-22';
const PH = path.join(REPO, 'deliverables', 'v365-production-history');

/** owner §5 声明的授权 SHA（逐位绑定） */
const OWNER_AUTHORIZATION_SHA = 'c6bd006fd76ffc5358cddd07347df8ed23d9e61d';

const ok = (n, d) => console.log(`[PASS] ${n}${d ? ' — ' + d : ''}`);

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}
function summarize(r) {
  return {
    meta: {
      slowBreakMode: r.meta.slowBreakMode, runsPerDay: r.meta.runsPerDay,
      from: r.meta.from, to: r.meta.to, days: r.meta.days, universe: r.meta.universe
    },
    axis: r.axis,
    days: r.days.map((d) => ({
      trade_date: d.trade_date, market_regime: d.market_regime,
      index_w_states: d.index_w_states, byCode: d.byCode
    })),
    runDiffs: r.runDiffs,
    finalBook: r.finalBook
  };
}
const stripComments = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

(async () => {
  /* ---------- 一次性运行全部协议 ---------- */
  const v1 = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V1' });
  const v2cf = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V2-CF' });
  const v2cfc = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V2-CF-COOLDOWN' });
  const v2ae = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V2-AE' });
  const v1Sha = sha256(stableStringify(summarize(v1)));
  const v2cfSha = sha256(stableStringify(summarize(v2cf)));
  const harnessSrc = stripComments(fs.readFileSync(HARNESS, 'utf8'));

  /* ================= B-01 RFP-V1 anchor 逐位不变 ================= */
  {
    assert.strictEqual(v1Sha, V1_ANCHOR_EXPECTED, `RFP-V1 anchor 必须逐位不变：实际 ${v1Sha}`);
    assert.strictEqual(v1.protocol, 'V1', 'V1 调用的 protocol 标识必须为 V1');
    ok('B-01 RFP-V1 anchor unchanged', `${v1Sha.slice(0, 16)}…`);
  }

  /* ================= B-02 RFP-V2-CF anchor 逐位不变 ================= */
  {
    assert.strictEqual(v2cfSha, V2CF_ANCHOR_EXPECTED,
      `RFP-V2-CF anchor 必须逐位不变（CF 分支不得被 F2-B 改动影响）：实际 ${v2cfSha}`);
    assert.strictEqual(v2cf.protocol, 'V2-CF');
    ok('B-02 RFP-V2-CF anchor unchanged', `${v2cfSha.slice(0, 16)}…`);
  }

  /* ================= B-03 V2-CF-COOLDOWN ledger_source = synthetic ================= */
  {
    assert.strictEqual(v2cfc.protocol, 'V2-CF-COOLDOWN', 'protocol 标识必须为 V2-CF-COOLDOWN');
    assert.strictEqual(v2cfc.ledger_source, 'SYNTHETIC_COUNTERFACTUAL_DECISION_IMPLIED',
      'V2-CF-COOLDOWN 的账本来源必须是 synthetic/counterfactual');
    assert.strictEqual(v2cfc.execution_ledger, null,
      'V2-CF-COOLDOWN 不得挂载 governed execution ledger');
    // synthetic 账本必须确有内容（否则"可被行使"未被证明）
    const syntheticFills = Object.keys(v2cfc.ledgerByCode).reduce((a, c) => a + v2cfc.ledgerByCode[c].length, 0);
    assert.ok(syntheticFills > 0, `synthetic 分支必须有成交记录（实际 ${syntheticFills}）`);
    ok('B-03 V2-CF-COOLDOWN ledger_source', `SYNTHETIC_COUNTERFACTUAL_DECISION_IMPLIED · fills=${syntheticFills}`);
  }

  /* ================= B-04 V2-AE ledger_source = governed actual ================= */
  {
    assert.strictEqual(v2ae.protocol, 'V2-AE', 'protocol 标识必须为 V2-AE');
    assert.strictEqual(v2ae.ledger_source, 'GOVERNED_ACTUAL_EXECUTION',
      'V2-AE 的账本来源必须是 governed actual execution');
    assert.ok(v2ae.execution_ledger && typeof v2ae.execution_ledger === 'object',
      'V2-AE 必须挂载 execution ledger 元数据（provenance 绑定）');
    ok('B-04 V2-AE ledger_source', 'GOVERNED_ACTUAL_EXECUTION');
  }

  /* ================= B-05 V2-AE 不得从当前 decision 自动生成成交 ================= */
  {
    // 源码层：V2-AE 的成交必须**只**来自 loadActualExecutionLedger；
    // 模拟成交块必须显式排除 V2-AE。
    const simBlock = harnessSrc.match(/if \(\(protocol === 'V2-CF-COOLDOWN' \|\| protocol === 'V2'\)[\s\S]{0,400}?\.push\(\{/);
    assert.ok(simBlock, '模拟成交块必须显式限定协议集合（V2-CF-COOLDOWN / V2），不得包含 V2-AE');
    const simText = simBlock[0];
    assert.ok(!/V2-AE/.test(simText), '模拟成交块内不得出现 V2-AE');

    // 行为层：V2-AE 的账本必须**逐位等于** governed NDJSON（任意实际成交逐条核对）
    const rawRows = fs.readFileSync(path.join(PH, 'raw', 'trade_log.ndjson'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
    const expectedCodes = {};
    rawRows.forEach((r) => { expectedCodes[r.code] = (expectedCodes[r.code] || 0) + 1; });
    const actualCodes = Object.keys(v2ae.ledgerByCode).reduce((a, c) => {
      a[c] = v2ae.ledgerByCode[c].length; return a;
    }, {});
    // 只比较有记录的标的（replay 宇宙 5 只；515880 在 actual 中无记录 ⇒ 不应出现在账本）
    Object.keys(expectedCodes).forEach((c) => {
      assert.strictEqual(actualCodes[c], expectedCodes[c],
        `${c}: V2-AE 账本必须逐位等于 governed trade_log（期望 ${expectedCodes[c]}，实际 ${actualCodes[c]}）`);
    });
    assert.ok(!actualCodes['515880'], '515880 在生产 trade_log 中无记录 ⇒ V2-AE 账本中不得出现（证明非决策推断）');

    // 逐条核对 (trade_date, code, action) 三元组
    const expectSet = new Set(rawRows.map((r) => `${r.trade_date}|${r.code}|${r.action}`));
    const actualSet = new Set(Object.keys(v2ae.ledgerByCode).flatMap((c) =>
      v2ae.ledgerByCode[c].map((r) => `${r.trade_date}|${r.code}|${r.action}`)));
    assert.deepStrictEqual([...actualSet].sort(), [...expectSet].sort(),
      'V2-AE 账本的三元组集合必须与 governed trade_log 完全一致');
    ok('B-05 V2-AE not decision-implied',
      `账本 == governed trade_log（${actualSet.size} 条三元组逐一致）· 515880 缺席 ✅`);
  }

  /* ================= B-06 cooldown 必须复用生产 computeCooldownDays() ================= */
  {
    assert.ok(/cooldown\.computeCooldownDays\s*\(/.test(harnessSrc),
      'harness 必须调用生产纯函数 cooldown.computeCooldownDays()');
    assert.ok(/const cooldown = U\('cooldown\.js'\)/.test(harnessSrc),
      'harness 必须 require src/common/utils/cooldown.js');
    // 不得内联实现天数分档
    assert.ok(!/addMode\s*===\s*'突破加仓'\s*\?\s*5/.test(harnessSrc),
      'harness 不得内联实现「突破加仓 → 5 日」分档');
    ok('B-06 reuses production computeCooldownDays()');
  }

  /* ================= B-07 不硬编码 cooldown 天数 ================= */
  {
    assert.ok(!/cooldownDays\s*=\s*[1-9]/.test(harnessSrc),
      'harness 不得把 cooldownDays 赋为字面常量（禁止 cooldownDays: 1 之类）');
    assert.ok(!/cooldown_days\s*:\s*[1-9]/.test(harnessSrc),
      'harness 不得输出硬编码 cooldown_days 字面值');
    ok('B-07 no hardcoded cooldown days');
  }

  /* ================= B-08 actual trade_log SHA / provenance 必须绑定 ================= */
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(PH, 'manifest.json'), 'utf8'));
    const prov = JSON.parse(fs.readFileSync(path.join(PH, 'provenance', 'trade_log.provenance.json'), 'utf8'));
    // 独立复算（⛔ 不信任 manifest 记的值）
    const recomputed = sha256(fs.readFileSync(path.join(PH, 'raw', 'trade_log.ndjson')));
    assert.strictEqual(recomputed, manifest.files.trade_log.sha256, 'trade_log 独立复算 SHA 必须等于 manifest');
    assert.strictEqual(recomputed, prov.file_sha256, 'trade_log 独立复算 SHA 必须等于 provenance');

    assert.ok(v2ae.execution_ledger.trade_log_sha256, 'replay 输出必须绑定 trade_log SHA');
    assert.strictEqual(v2ae.execution_ledger.trade_log_sha256, recomputed,
      'replay 绑定的 trade_log SHA 必须等于独立复算值（防止账本被换）');
    assert.strictEqual(v2ae.execution_ledger.provenance_status, 'GOVERNED_READ_ONLY_EXPORT');
    assert.strictEqual(v2ae.execution_ledger.governed_data_gate, 'PASS');
    assert.strictEqual(v2ae.execution_ledger.pagination_complete, true, 'pagination 必须完整');
    ok('B-08 trade_log SHA/provenance bound', `${recomputed.slice(0, 16)}… · gate=PASS`);
  }

  /* ================= B-09 decision_result lookup 只读且最小化 ================= */
  {
    // ① connector 结构性无 mutation
    const client = require(path.join(REPO, 'scripts', 'tools', 'cloudbase-readonly-client.js'));
    // ★ C-021 §12：删除 vacuous `|| true`。改为**真实可失败**断言：
    //    只读 client 模块源码内**不得**出现 mutation 方法定义/调用。
    const clientSrc = stripComments(
      fs.readFileSync(path.join(REPO, 'scripts', 'tools', 'cloudbase-readonly-client.js'), 'utf8'));
    for (const m of ['add', 'update', 'set', 'remove', 'createCollection', 'dropCollection']) {
      assert.ok(!new RegExp(`\\b${m}\\b\\s*\\(`).test(clientSrc),
        `B-09：⛔ 只读 client 源码不得含 mutation 方法 "${m}(" —— 结构性只读保证`);
    }
    const exported = Object.keys(client);
    assert.deepStrictEqual(exported.sort(),
      ['DEFAULT_ALLOWLIST', 'DEFAULT_ENV_ID', 'checkCredentialFreshness', 'createReadOnlyClient', 'loadCredential'].sort(),
      'client 模块导出面不得新增写能力');
    const selfSrc = stripComments(fs.readFileSync(path.join(REPO, 'scripts', 'tools', 'cloudbase-readonly-client.js'), 'utf8'));
    assert.ok(!/\.add\(|\.update\(|\.remove\(|\.set\(/.test(selfSrc),
      'readonly client 源码内不得存在 mutation 调用');

    // ② 导出器为最小化单点读取（非整表）
    const exporterPath = path.join(REPO, 'scripts', 'tools', 'cloudbase-export-decision-result-for-cooldown.js');
    assert.ok(fs.existsSync(exporterPath), '决策回查必须有独立的最小化导出器');
    const expSrc = stripComments(fs.readFileSync(exporterPath, 'utf8'));
    assert.ok(/MINIMAL_POINT_LOOKUP/.test(fs.readFileSync(exporterPath, 'utf8')),
      '导出器必须声明 MINIMAL_POINT_LOOKUP（非整表导出）');
    assert.ok(/decision_date:\s*p\.decision_date/.test(expSrc),
      '导出器必须按 (code, decision_date) 单点回查');
    assert.ok(!/queryPage\('decision_result',\s*\{\s*orderBy/.test(expSrc),
      '导出器不得对 decision_result 做无过滤的整表分页导出');

    // ③ provenance 必须记录"为什么需要"
    const drProv = JSON.parse(fs.readFileSync(path.join(PH, 'provenance', 'decision_result_cooldown.provenance.json'), 'utf8'));
    assert.ok(drProv.reason && drProv.reason.length > 40, 'provenance 必须记录扩展 allowlist 的理由');
    assert.strictEqual(drProv.necessity, 'REQUIRED_FOR_PRODUCTION_FIDELITY_COOLDOWN');
    assert.strictEqual(drProv.read_scope.not_a_full_table_export, true);
    assert.strictEqual(drProv.safety.mutation_methods_absent, true);
    ok('B-09 decision_result read-only & minimal',
      `MINIMAL_POINT_LOOKUP(${drProv.read_scope.lookup_points} 点) · mutation 结构上不存在`);
  }

  /* ================= B-10 已验 4 个生产点：actual replay cooldown == production cooldown ================= */
  {
    const drRows = fs.readFileSync(path.join(PH, 'raw', 'decision_result_cooldown.ndjson'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
    // 取"生产有记录且 cooldown_days 非空"的点作为可比对样本
    const comparable = drRows.filter((r) => r.rows_found > 0 && r.cooldown_days != null);
    assert.ok(comparable.length >= 4,
      `必须至少有 4 个生产可验证点（实际 ${comparable.length}）`);

    // 用 governed actual ledger + 实际 decision_result add_mode 索引复算
    const ae = harness.loadActualExecutionLedger(REPO);
    const { barsByCode } = harness.loadBars();
    const drIndex = {};
    drRows.filter((r) => r.rows_found > 0 && r.add_mode != null)
      .forEach((r) => { drIndex[`${r.code}|${r.decision_date}`] = r.add_mode; });

    let matched = 0;
    const details = [];
    for (const r of comparable) {
      const replayCd = await harness.computeReplayCooldown(
        ae.ledgerByCode, barsByCode, r.code, r.decision_date, '无', drIndex);
      details.push(`${r.code}@${r.decision_date}=${replayCd}/${r.cooldown_days}`);
      if (replayCd === r.cooldown_days) matched += 1;
    }
    assert.strictEqual(matched, comparable.length,
      `全部可比对点必须逐值相等：${details.join(' ')}`);
    ok('B-10 actual replay cooldown == production cooldown',
      `${matched}/${comparable.length} MATCH（PRODUCTION_PATH_PARITY_VERIFIED_ON_OBSERVED_POINTS）`);
  }

  /* ================= B-11 无 actual add_mode 时不得人工回填 ================= */
  {
    // ① governed trade_log 的 add_mode 不得被改写
    const rawRows = fs.readFileSync(path.join(PH, 'raw', 'trade_log.ndjson'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
    // governed 原始态：#1-9 无该字段；#10-13 为 ""
    const withField = rawRows.filter((r) => 'add_mode' in r);
    assert.strictEqual(withField.length, 4, '受治理 trade_log 中带 add_mode 字段的行数必须保持 4（未被回填）');
    withField.forEach((r) => assert.strictEqual(r.add_mode, '', '受治理 trade_log 的 add_mode 必须保持空串（不得回填）'));
    const nonEmpty = rawRows.filter((r) => r.add_mode != null && r.add_mode !== '');
    assert.strictEqual(nonEmpty.length, 0, '不得存在任何被回填 add_mode 的实际成交行');

    // ② harness 不得回填 add_mode
    assert.ok(!/add_mode\s*:\s*'横盘加仓'/.test(harnessSrc.replace(/fallbackAddMode/g, '')),
      'harness 不得把 add_mode 回填为具体档位常量');
    // actual 账本条目必须保留原始 add_mode（不得新增语义值）
    Object.keys(v2ae.ledgerByCode).forEach((c) => {
      v2ae.ledgerByCode[c].forEach((r) => {
        assert.ok(r.add_mode === undefined || r.add_mode === '',
          `${c}@${r.trade_date}: actual 账本条目不得携带被推断的 add_mode（实际 ${JSON.stringify(r.add_mode)}）`);
      });
    });
    ok('B-11 no add_mode backfill', '受治理 trade_log add_mode 保持全空 · actual 账本零推断');
  }

  /* ================= B-12 attribution taxonomy 未扩大 ================= */
  {
    const attrPath = path.join(REPO, 'scripts', 'v365-replay-delta-attribution.js');
    const attrSrc = stripComments(fs.readFileSync(attrPath, 'utf8'));
    // 只允许两条 reason
    const reasonLits = [...attrSrc.matchAll(/reason\s*=\s*'([a-z_]+)'/g)].map((m) => m[1]);
    const allowed = new Set(['cooldown_gate_exercised', 'effective_tech_cap_fidelity', 'unattributed']);
    [...new Set(reasonLits)].forEach((r) => {
      assert.ok(allowed.has(r), `不得新增归因 reason："${r}"（taxonomy 已冻结）`);
    });
    // 禁止新增被点名的三类
    ['cooldown_book_divergence', 'downstream_cooldown_effect', 'historical_cooldown_lineage']
      .forEach((banned) => assert.ok(!new RegExp(banned).test(attrSrc),
        `⛔ 不得引入被 owner 明确禁止的 reason："${banned}"`));
    // 必须声明冻结
    assert.ok(/attribution_taxonomy[\s\S]{0,200}frozen:\s*true/.test(attrSrc),
      '归因产物必须声明 taxonomy frozen');

    // 行为层：UNEXPECTED 未被消除（fail-closed 保留）
    const outPath = path.join(PH, 'replay-delta-attribution.json');
    if (fs.existsSync(outPath)) {
      const at = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.strictEqual(at.attribution_taxonomy.frozen, true);
      assert.ok(at.counterfactual_branch.unexpected.length >= 1,
        'counterfactual 分支的 UNEXPECTED 必须保留（⛔ 不得为凑 0 而放宽判据）');
      const reasonsUsed = new Set([...at.counterfactual_branch.deltas, ...at.actual_execution_branch.deltas]
        .map((d) => d.reason));
      reasonsUsed.forEach((r) => assert.ok(allowed.has(r), `产物中出现越界 reason：${r}`));
    }
    ok('B-12 attribution taxonomy not expanded',
      '仅 §6.3 两条 · 禁用三类均未出现 · UNEXPECTED 保留 fail-closed');
  }

  /* ================= 授权绑定自检 ================= */
  {
    const chg = path.join(REPO, 'docs', 'V365_RPG_F2B_REPLAY_INFRA_CHANGE_RECORD.md');
    if (fs.existsSync(chg)) {
      const t = fs.readFileSync(chg, 'utf8');
      assert.ok(t.includes(OWNER_AUTHORIZATION_SHA),
        `变更记录必须逐位绑定 owner 授权 SHA：${OWNER_AUTHORIZATION_SHA}`);
      assert.ok(/REPLAY_INFRA_CHANGE_REVIEW_REQUIRED/.test(t),
        '变更记录必须声明 REPLAY_INFRA_CHANGE_REVIEW_REQUIRED');
      ok('B-13 REPLAY_INFRA authorization bound', `${OWNER_AUTHORIZATION_SHA.slice(0, 16)}…`);
    } else {
      console.log('[SKIP] B-13 变更记录尚未生成（本轮稍后生成）');
    }
  }

  console.log('\nRPG-F2-B 专项测试：B-01 ~ B-12 全部 PASS');
})().catch((e) => {
  console.error(`\n[FATAL] RPG-F2-B 测试异常：${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
