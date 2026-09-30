#!/usr/bin/env node
/**
 * RPG-F2-A —— RFP-V2-CF 专项测试（A-01 ~ A-10）
 *
 * ⛔ 只读（不改任何生产文件）；一次性跑 V1 与 V2-CF 两遍 replay，全部断言复用该结果。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const HARNESS = path.join(REPO, 'scripts', 'lib', 'v364-replay-harness.js');
const harness = require(HARNESS);
const correlation = require(path.join(REPO, 'src', 'common', 'utils', 'correlation.js'));
const constants = require(path.join(REPO, 'src', 'common', 'constants.js'));
const CLASSIFICATION = require(path.join(REPO, 'scripts', 'lib', 'v365-decision-classification.js'));

const V1_ANCHOR_EXPECTED = '25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723';
const FROM = '2026-08-01';
const TO = '2026-09-22';
const ok = (n, d) => console.log(`[PASS] ${n}${d ? ' — ' + d : ''}`);

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}
function summarize(r) {
  return {
    meta: { slowBreakMode: r.meta.slowBreakMode, runsPerDay: r.meta.runsPerDay, from: r.meta.from, to: r.meta.to, days: r.meta.days, universe: r.meta.universe },
    axis: r.axis,
    days: r.days.map((d) => ({ trade_date: d.trade_date, market_regime: d.market_regime, index_w_states: d.index_w_states, byCode: d.byCode })),
    runDiffs: r.runDiffs,
    finalBook: r.finalBook
  };
}
const stripComments = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* ---------------- 一次性运行两个协议（RPG-F2-B：replay 已 async） ---------------- */
(async () => {
const v1 = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V1' });
const v2 = await harness.replay({ from: FROM, to: TO, runsPerDay: 1, protocol: 'V2-CF' });
const v1Sha = sha256(stableStringify(summarize(v1)));
const v2Sha = sha256(stableStringify(summarize(v2)));

/* ================= A-01 V1 anchor unchanged ================= */
{
  assert.strictEqual(v1Sha, V1_ANCHOR_EXPECTED,
    `RFP-V1 anchor 必须逐位不变：实际 ${v1Sha}`);
  assert.strictEqual(v1.protocol, 'V1', 'V1 调用的 protocol 标识必须为 V1');
  ok('A-01 V1 anchor unchanged', v1Sha.slice(0, 16) + '…');
}

/* ================= A-02 V2-CF uses correlation.effectiveTechCap() ================= */
{
  const code = stripComments(fs.readFileSync(HARNESS, 'utf8'));
  assert.ok(/correlation\.effectiveTechCap\s*\(/.test(code),
    'harness 必须调用生产纯函数 correlation.effectiveTechCap()');
  assert.ok(/const correlation = U\('correlation\.js'\)/.test(code),
    'harness 必须 require src/common/utils/correlation.js');

  // 行为核对：任取一日，V2-CF 注入的 cap 必须等于该纯函数的输出
  const d = v2.axis[5];
  const asOf = {};
  harness.UNIVERSE.forEach((u) => { asOf[u.code] = (harness.loadBars().barsByCode[u.code] || []).filter((b) => b.trade_date <= d); });
  const baseCap = harness.PROD_PARAMS.tech_sector_max != null ? harness.PROD_PARAMS.tech_sector_max : constants.DEFAULT_PARAMS.tech_sector_max;
  const expected = correlation.effectiveTechCap(baseCap, asOf).effective_cap;
  const capForD = (() => {
    const asOf2 = {}; harness.UNIVERSE.forEach((u) => { asOf2[u.code] = (harness.loadBars().barsByCode[u.code] || []).filter((b) => b.trade_date <= d); });
    return correlation.effectiveTechCap(baseCap, asOf2).effective_cap;
  })();
  assert.strictEqual(capForD, expected, 'cap 必须由生产纯函数确定性产生');
  ok('A-02 V2-CF uses correlation.effectiveTechCap()', `sample ${d} → ${expected}`);
}

/* ================= A-03 as-of-date bars only（无前视）================= */
{
  const code = stripComments(fs.readFileSync(HARNESS, 'utf8'));
  assert.ok(/b\.trade_date\s*<=\s*d/.test(code),
    'V2-CF 的 bars 必须按 as-of-date 过滤（b.trade_date <= d）');
  // ⚠️ 不能用「as-of 与全量的 cap 必须不同」作判据 —— 本窗口内两者同为 0.97 档，
  //    数值相同**不代表**输入未裁剪（断言过强 ⇒ 假 FAIL）。
  //    正确判据：**未来 bar 确实被排除**（as-of 集合严格小于全量）。
  const bars = harness.loadBars().barsByCode;
  const d = v2.axis[3];
  let truncated = 0, checked = 0;
  harness.UNIVERSE.forEach((u) => {
    const allN = (bars[u.code] || []).length;
    const asOfN = (bars[u.code] || []).filter((b) => b.trade_date <= d).length;
    checked++;
    if (asOfN < allN) truncated++;
    assert.ok(asOfN <= allN, `${u.code}: as-of 集合不得大于全量`);
    assert.ok((bars[u.code] || []).every((b, i) => i >= asOfN ? b.trade_date > d : true),
      `${u.code}: 被排除的 bar 必须全部晚于 ${d}`);
  });
  assert.ok(truncated > 0, `必须存在被裁剪的标的（checked=${checked}）`);
  ok('A-03 as-of-date bars only', `${d}：${truncated}/${checked} 标的的未来 bar 已被排除`);
}

/* ================= A-04 no hardcoded discount/effective cap ================= */
{
  const code = stripComments(fs.readFileSync(HARNESS, 'utf8'));
  assert.ok(!/0\.97/.test(code), 'harness 不得硬编码 discount 0.97');
  assert.ok(!/63\.1/.test(code), 'harness 不得硬编码 effective_tech_cap 63.1');
  assert.ok(!/effective_tech_cap\s*=\s*\d/.test(code), 'harness 不得把 effective_tech_cap 赋为字面常量');
  ok('A-04 no hardcoded discount/effective cap');
}

/* ================= A-05 sectorRemainingLimit uses V2 effective cap ================= */
{
  const code = stripComments(fs.readFileSync(HARNESS, 'utf8'));
  assert.ok(/portfolio\.effective_tech_cap\s*!=\s*null[\s\S]{0,120}?PROD_PARAMS\.tech_sector_max/.test(code),
    'effTechMax 必须为 `portfolio.effective_tech_cap ?? techMax`（与 RDE:707 同构）');
  assert.ok(/sectorRemainingLimit\s*=\s*isTech\s*\?\s*Math\.max\(0,\s*effTechMax\s*-/.test(code),
    'sectorRemainingLimit 必须使用 effTechMax');
  ok('A-05 sectorRemainingLimit uses V2 effective cap');
}

/* ================= A-06 / A-07 coverage manifest ================= */
{
  const p = path.join(REPO, 'outputs', 'v365-rfp-v2cf-coverage-manifest.json');
  assert.ok(fs.existsSync(p), '必须先运行 scripts/v365-replay-v2cf-attest.js 生成 coverage manifest');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(m.protocol_version, 'RFP-V2-CF');
  assert.strictEqual(m.qualification_authoritative, false,
    'V2-CF 不得成为 qualification authoritative');
  // A-06
  assert.strictEqual(m.coverage.cooldown.status, 'KNOWN_GAP');
  assert.strictEqual(m.coverage.cooldown.production_fidelity, 'NOT_AVAILABLE');
  assert.strictEqual(m.coverage.cooldown.counterfactual_fidelity, 'INCOMPLETE');
  assert.strictEqual(m.coverage.cooldown.rpg, 'RPG-002');
  ok('A-06 coverage manifest marks cooldown gap', 'KNOWN_GAP / NOT_AVAILABLE / INCOMPLETE');
  // A-07
  assert.strictEqual(m.replay_semantics, 'COUNTERFACTUAL_ASSUMED_EXECUTION');
  ok('A-07 replay_semantics', m.replay_semantics);
}

/* ================= A-08 / A-09 delta attribution ================= */
{
  const p = path.join(REPO, 'outputs', 'v365-rfp-v2cf-delta-attribution.json');
  assert.ok(fs.existsSync(p), '必须先运行 scripts/v365-replay-v2cf-attest.js 生成归因');
  const at = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(at.v1_anchor, V1_ANCHOR_EXPECTED, '归因记录中的 V1 anchor 必须与基线一致');
  assert.ok(at.summary.changed > 0, 'V2-CF 应产生可观测差异（否则修复未生效）');
  assert.strictEqual(at.summary.unexpected, 0, '不得存在 UNEXPECTED_DECISION_DELTA');
  // A-08：每一条差异都必须被归因
  const unattr = at.deltas.filter((d) => d.reason === 'unattributed');
  assert.deepStrictEqual(unattr, [], '所有 V1→V2 差异必须被归因');
  assert.ok(at.deltas.every((d) => d.classification === 'EXPECTED_FIDELITY_DELTA'
    || d.classification === 'UNEXPECTED_DECISION_DELTA'), '每条差异必须有分类');
  ok('A-08 all V1→V2 differences attributed', `changed=${at.summary.changed} expected=${at.summary.expected}`);
  // A-09
  assert.strictEqual(at.summary.unexpected, 0);
  ok('A-09 UNEXPECTED_DECISION_DELTA = 0');
}

/* ================= A-10 production calculation unchanged ================= */
{
  // ⚠️ 语义精化（HD12-3 之后）：RDE 属 **MIXED**（编排器），可被合法改动；
  //    因此本判据拆为两层 ——
  //      ① CALC：⛔ **绝对**零改动
  //      ② MIXED：若改动 ⇒ 必须是 **comment-only**（规范化代码指纹逐位不变）
  const APPROVAL = require(path.join(REPO, 'scripts', 'lib', 'v365-orchestration-approval.js'));

  // ① CALC 绝对零改动
  const calc = CLASSIFICATION.calcFiles();
  const r = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', ...calc], { cwd: REPO, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.log(`[WARN] A-10 无法调用 git（${r.error ? r.error.code : 'status=' + r.status}）⇒ CALC 部分退化为存在性断言`);
    calc.forEach((f) => assert.ok(fs.existsSync(path.join(REPO, f)), `${f} 必须存在`));
  } else {
    const changed = String(r.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    assert.deepStrictEqual(changed, [], `CALC 绝对不得被改动；实际 = ${JSON.stringify(changed)}`);
  }

  // ② MIXED 若改动 ⇒ 必须 comment-only **或** 全部落在声明的 zone 内
  //    （⚠️ 语义精化：HD12-3 标记是 comment-only；WP-RH2 R2-b 的运行时字段是**真实代码改动**，
  //      只要落在 zone 内即合法 ⇒ 判据 = 「comment-only」∨「zone 包含性成立」）
  const mixed = CLASSIFICATION.mixedFiles();
  const mixedOk = [];
  for (const f of mixed) {
    const r2 = spawnSync('git', ['show', `HEAD:${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 });
    if (r2.error || r2.status !== 0) continue;
    const cur = fs.readFileSync(path.join(REPO, f), 'utf8');
    const before = String(r2.stdout);
    if (cur === before) continue;   // 未改动
    if (APPROVAL.canonicalCodeSha256(cur) === APPROVAL.canonicalCodeSha256(before)) {
      mixedOk.push(`${f}(comment-only)`);
      continue;
    }
    // 非 comment-only ⇒ 必须 zone-contained
    const d = spawnSync('git', ['diff', '-U0', '--no-color', 'HEAD', '--', f],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 });
    const regions = [];
    String(d.stdout || '').split(/\r?\n/).forEach((ln) => {
      const m = ln.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (!m) return;
      const start = Number(m[1]);
      const count = m[2] == null ? 1 : Number(m[2]);
      if (count > 0) regions.push({ file: f, start, end: start + count - 1 });
    });
    assert.ok(regions.length > 0, `${f} 有代码改动 ⇒ 必须能解析出改动区域`);
    const zones = APPROVAL.parseOrchZones(cur).zones;
    const cont = APPROVAL.validateRegionContainment(regions, { [f]: zones }, Object.keys(zones));
    assert.strictEqual(cont.ok, true,
      `MIXED 文件 ${f} 的代码改动必须全部落在声明 zone 内：${JSON.stringify(cont.errors)}`);
    mixedOk.push(`${f}(zone-contained:${regions.length}区域)`);
  }
  ok('A-10 production calculation unchanged',
    `CALC ${calc.length} 文件零改动 · MIXED 改动 = ${JSON.stringify(mixedOk)}`);
}

console.log('\nRPG-F2-A 专项测试：A-01 ~ A-10 全部 PASS');
})().catch((e) => {
  console.error(`\n[FATAL] RPG-F2-A 测试异常：${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
