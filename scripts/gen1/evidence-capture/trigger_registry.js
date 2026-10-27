/**
 * R2 —— Trigger Registry 校验器（REVISION PROPOSAL 级构件）
 * ======================================================================
 * 目的：把「契约 §5.6 trigger 清单 / §5.8 静默窗口」从**文字断言**变成**可执行、可打红**的判据。
 *
 * 依据：
 *   [FROZEN]   Contract v5.0 §5.3（八源）/ §5.6（CHAIN PROOF）/ §5.8（CHECKPOINT）
 *   [PROPOSAL] GEN1_EVIDENCE_CONTRACT_REVISION_PROPOSAL_20261002.md §5.6 revised / §5.8 revised
 *
 * 五项检查：
 *   S1 SCHEMA         —— 每条登记项必须具备全部必备字段
 *   S2 COMPLETENESS   —— 「登记 vs 云实测」双向对拍（⛔ 缺失与多余**都**要抓）
 *   S3 EIGHT_SOURCE   —— `writes_eight_source_direct` 必须与 `writes_collections ∩ 八源` 一致
 *   S4 EXCLUSION      —— 任何 `evidence_candidate_capable != YES` 或 `participates_in_checkpoint == NO`
 *                        的项，必须写明 `exclusion_reason`（owner §4 硬要求）
 *   S5 CHAIN_COVERAGE —— 每条 PROMOTION-CAPABLE 链的入口 trigger 必须已登记且 role == ENTRY
 *   S6 CHECKPOINT_SILENCE —— 任一候选窗口内**不得**存在「写八源」的 trigger
 *
 * ★ 反向证明（owner §9）：故意制造错误 Registry / 错误窗口 ⇒ 检查**必须失败**。
 *
 * 用法：
 *   node trigger_registry.js --validate
 *   node trigger_registry.js --silence
 *   node trigger_registry.js --reverse-proof
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const REG_PATH = path.join(HERE, 'fixtures', 'trigger_registry.json');
const CLOUD_PATH = path.join(HERE, 'fixtures', 'trigger_registry_cloud_observed.json');

function load(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------- cron 匹配
/** 字段规格支持：`*` / `a` / `a-b` / `a,b` / `*​/n` / `a-b/n`；dow 采用 cron 惯例 0=周日。 */
function matchField(spec, value) {
  const s = String(spec).trim();
  if (s === '*' || s === '?') return true;
  return s.split(',').some((part) => {
    let step = 1;
    let body = part.trim();
    const slash = body.indexOf('/');
    if (slash >= 0) {
      step = parseInt(body.slice(slash + 1), 10);
      body = body.slice(0, slash);
      if (!(step > 0)) return false;
    }
    if (body === '*' || body === '') {
      return value % step === 0;
    }
    const dash = body.indexOf('-');
    if (dash > 0) {
      const lo = parseInt(body.slice(0, dash), 10);
      const hi = parseInt(body.slice(dash + 1), 10);
      return value >= lo && value <= hi && ((value - lo) % step === 0);
    }
    const v = parseInt(body, 10);
    return v === value;
  });
}

/** windows 是「绝对分钟」区间 [startMinute, endMinute)；weekday=2 代表周二（Mon=1..Sun=0 cron 惯例） */
function cronFiresInWindow(cron, startMinute, endMinute, weekday) {
  const f = String(cron).trim().split(/\s+/);
  if (f.length < 6) return { ok: false, error: 'cron 字段数 < 6: ' + cron };
  // [sec, min, hour, dom, mon, dow, (year)]
  const [, minS, hourS, , , dowS] = f;
  if (!matchField(dowS, weekday)) return { ok: true, fires: false, times: [] };
  const times = [];
  for (let m = startMinute; m < endMinute; m += 1) {
    const mm = m % 60, hh = Math.floor(m / 60);
    if (matchField(minS, mm) && matchField(hourS, hh)) {
      times.push(String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'));
    }
  }
  return { ok: true, fires: times.length > 0, times };
}

function hhmmToMin(t) {
  const [h, m] = String(t).split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

// ---------------------------------------------------------------- 检查
function s1_schema(reg) {
  const req = reg.schema_required_fields;
  const bad = [];
  reg.entries.forEach((e) => {
    const miss = req.filter((k) => !(k in e));
    if (miss.length) bad.push({ trigger_id: e.trigger_id, missing: miss });
  });
  return { ok: bad.length === 0, name: 'S1 SCHEMA', detail: bad };
}

function s2_completeness(reg, cloud) {
  const regIds = reg.entries.map((e) => e.trigger_id).sort();
  const obsIds = (cloud.observed_triggers || []).slice().sort();
  const missing = obsIds.filter((x) => regIds.indexOf(x) < 0);   // 云有、登记无 ⇒ 漏列
  const spurious = regIds.filter((x) => obsIds.indexOf(x) < 0);  // 登记有、云无 ⇒ 幽灵项
  return { ok: missing.length === 0 && spurious.length === 0, name: 'S2 COMPLETENESS',
    detail: { missing, spurious, reg_n: regIds.length, obs_n: obsIds.length, as_of: cloud.as_of } };
}

function s3_eight_source(reg) {
  const set = new Set(reg.eight_sources);
  const bad = [];
  reg.entries.forEach((e) => {
    const inSet = (e.writes_collections || []).filter((c) => set.has(c));
    const expected = inSet.length > 0;
    if (expected !== !!e.writes_eight_source_direct) {
      bad.push({ trigger_id: e.trigger_id, declared: !!e.writes_eight_source_direct,
        expected, eight_source_writes: inSet });
    }
  });
  return { ok: bad.length === 0, name: 'S3 EIGHT_SOURCE', detail: bad };
}

function s4_exclusion(reg) {
  const bad = [];
  reg.entries.forEach((e) => {
    const needs = (e.evidence_candidate_capable !== 'YES') || (e.participates_in_checkpoint === 'NO');
    if (needs && (!e.exclusion_reason || String(e.exclusion_reason).trim().length < 8)) {
      bad.push({ trigger_id: e.trigger_id,
        evidence_candidate_capable: e.evidence_candidate_capable,
        participates_in_checkpoint: e.participates_in_checkpoint,
        exclusion_reason: e.exclusion_reason || null });
    }
  });
  return { ok: bad.length === 0, name: 'S4 EXCLUSION_REASON', detail: bad };
}

function s5_chain_coverage(reg) {
  const byId = {};
  reg.entries.forEach((e) => { byId[e.trigger_id] = e; });
  const bad = [];
  (reg.promotion_capable_chains || []).forEach((c) => {
    const e = byId[c.entry_trigger];
    if (!e) bad.push({ chain: c.chain_id, entry_trigger: c.entry_trigger, why: 'ENTRY_TRIGGER_NOT_REGISTERED' });
    else if (e.role !== 'ENTRY') bad.push({ chain: c.chain_id, entry_trigger: c.entry_trigger, why: 'ROLE_NOT_ENTRY:' + e.role });
  });
  return { ok: bad.length === 0, name: 'S5 CHAIN_COVERAGE', detail: bad };
}

function s6_silence(reg, windows) {
  const results = [];
  let ok = true;
  windows.forEach((w) => {
    const startMin = hhmmToMin(w.start), endMin = hhmmToMin(w.end);
    const firing = [];
    reg.entries.forEach((e) => {
      const r = cronFiresInWindow(e.schedule_cron, startMin, endMin, 2);   // 周二
      if (r.ok && r.fires) {
        firing.push({ trigger_id: e.trigger_id, times: r.times,
          writes_collections: e.writes_collections,
          writes_eight_source_transitive: !!e.writes_eight_source_transitive });
      }
    });
    const violators = firing.filter((f) => f.writes_eight_source_transitive);
    if (violators.length) ok = false;
    results.push({ window: w.id, range: '[' + w.start + ', ' + w.end + ')',
      firing, violators });
  });
  return { ok, name: 'S6 CHECKPOINT_SILENCE', detail: results };
}

function proposedWindows() {
  return [{ id: 'W1', start: '22:30', end: '23:30' }, { id: 'W2', start: '08:30', end: '09:30' }];
}

// ---------------------------------------------------------------- 主流程
function runAll(reg, cloud, windows) {
  const checks = [
    s1_schema(reg),
    s2_completeness(reg, cloud),
    s3_eight_source(reg),
    s4_exclusion(reg),
    s5_chain_coverage(reg),
    s6_silence(reg, windows),
  ];
  return checks;
}

function report(checks) {
  let all = true;
  checks.forEach((c) => {
    if (!c.ok) all = false;
    console.log('  [%s] %s', c.ok ? 'PASS' : 'FAIL', c.name);
    const d = c.detail;
    if (c.name === 'S2 COMPLETENESS') {
      console.log('         registry=%d / cloud=%d / missing=%s / spurious=%s / as_of=%s',
        d.reg_n, d.obs_n, JSON.stringify(d.missing), JSON.stringify(d.spurious), d.as_of);
    } else if (c.name === 'S6 CHECKPOINT_SILENCE') {
      d.forEach((w) => {
        console.log('         %s %s ⇒ 窗口内触发者: %s', w.window, w.range,
          JSON.stringify(w.firing.map((f) => f.trigger_id + '@' + f.times.join('/'))));
        console.log('            写八源的违规者: %s', JSON.stringify(w.violators.map((v) => v.trigger_id)));
      });
    } else if (!c.ok) {
      console.log('         %s', JSON.stringify(d));
    }
  });
  return all;
}

function validate() {
  console.log('== R2 Trigger Registry 校验 ==');
  const reg = load(REG_PATH);
  const cloud = load(CLOUD_PATH);
  const ok = report(runAll(reg, cloud, proposedWindows()));
  console.log('  ---------- VALIDATE = %s ----------', ok ? 'PASS' : 'FAIL');
  return ok;
}

function silence() {
  console.log('== R2 §5.8 静默性质（候选窗口穷举）==');
  const reg = load(REG_PATH);
  // 逐窗口输出所有触发者（不仅违规者）
  const res = s6_silence(reg, proposedWindows());
  report([res]);
  console.log('  ---------- CHECKPOINT_SILENCE = %s ----------', res.ok ? 'PASS' : 'FAIL');
  return res.ok;
}

/** ★ 反向证明：错误 Registry / 错误窗口 ⇒ 检查**必须**失败 */
function reverseProof() {
  const reg0 = load(REG_PATH);
  const cloud = load(CLOUD_PATH);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const out = [];

  // RP-A 遗漏真实 trigger（重现 v5.0 §5.6 表的缺陷）
  {
    const reg = clone(reg0);
    reg.entries = reg.entries.filter((e) => e.trigger_id !== 'intelExtract-30min');
    const c = s2_completeness(reg, cloud);
    out.push({ id: 'RP-A', name: 'Registry 遗漏真实 trigger `intelExtract-30min`（= v5.0 §5.6 表的原始缺陷）',
      expect: 'FAIL', got: c.ok ? 'PASS' : 'FAIL', detected: c.ok === false, detail: c.detail.missing });
  }
  // RP-B 八源分类错误
  {
    const reg = clone(reg0);
    const e = reg.entries.find((x) => x.trigger_id === 'realtime-5min');
    e.writes_eight_source_direct = true;   // 谎报写八源
    const c = s3_eight_source(reg);
    out.push({ id: 'RP-B', name: '谎报 `realtime-5min` 写八源（实际只写 etf_daily / fetch_log）',
      expect: 'FAIL', got: c.ok ? 'PASS' : 'FAIL', detected: c.ok === false, detail: c.detail });
  }
  // RP-C 幽灵 trigger
  {
    const reg = clone(reg0);
    reg.entries.push(Object.assign({}, clone(reg0.entries[0]), { trigger_id: 'ghost-0000' }));
    const c = s2_completeness(reg, cloud);
    out.push({ id: 'RP-C', name: 'Registry 塞入云端不存在的幽灵 trigger `ghost-0000`',
      expect: 'FAIL', got: c.ok ? 'PASS' : 'FAIL', detected: c.ok === false, detail: c.detail.spurious });
  }
  // RP-D 把窗口挪回来（含八源写入者）⇒ 静默检查必须失败
  {
    const reg = clone(reg0);
    const bad = [{ id: 'BAD-A', start: '22:00', end: '22:30' }, { id: 'BAD-B', start: '08:00', end: '08:30' }];
    const c = s6_silence(reg, bad);
    out.push({ id: 'RP-D', name: '把捕获窗口挪回 [22:00,22:30) / [08:00,08:30) ⇒ 必含八源写入者',
      expect: 'FAIL', got: c.ok ? 'PASS' : 'FAIL', detected: c.ok === false,
      detail: c.detail.map((w) => ({ window: w.window, violators: w.violators.map((v) => v.trigger_id) })) });
  }
  // RP-E 排除理由缺失
  {
    const reg = clone(reg0);
    const e = reg.entries.find((x) => x.trigger_id === 'gen2-eod-weekdays-2230');
    e.exclusion_reason = '';
    const c = s4_exclusion(reg);
    out.push({ id: 'RP-E', name: '抹掉被排除 trigger 的 `exclusion_reason`',
      expect: 'FAIL', got: c.ok ? 'PASS' : 'FAIL', detected: c.ok === false, detail: c.detail });
  }
  // RP-F 链入口未登记
  {
    const reg = clone(reg0);
    reg.entries = reg.entries.filter((e) => e.trigger_id !== 'dailyPipeline-0800');
    const c = s5_chain_coverage(reg);
    out.push({ id: 'RP-F', name: '删掉 W2-0800 链的入口 trigger 登记',
      expect: 'FAIL', got: c.ok ? 'PASS' : 'FAIL', detected: c.ok === false, detail: c.detail });
  }
  // RP-G 还原自证
  {
    const reg = clone(reg0);
    const ok = report(runAll(reg, cloud, proposedWindows()));
    out.push({ id: 'RP-G', name: '逐字节还原原 Registry ⇒ 全部检查必须重新 PASS',
      expect: 'PASS', got: ok ? 'PASS' : 'FAIL', detected: ok === true, detail: null });
    console.log();
  }

  console.log('== R2 Trigger Registry 反向证明（错误 Registry / 错误窗口 ⇒ 必须被检出）==');
  let all = true;
  out.forEach((o) => {
    if (!o.detected) all = false;
    console.log('  [%s] %s · %s', o.detected ? 'PASS' : 'FAIL', o.id, o.name);
    console.log('         expect=%s got=%s  %s', o.expect, o.got,
      o.detail == null ? '' : JSON.stringify(o.detail).slice(0, 220));
  });
  console.log('  ---------- REGISTRY_REVERSE_PROOF = %s ----------', all ? 'PASS' : 'FAIL');
  return all;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let ok = true;
  if (args.length === 0 || args.indexOf('--validate') >= 0) ok = validate() && ok;
  if (args.indexOf('--silence') >= 0) ok = silence() && ok;
  if (args.indexOf('--reverse-proof') >= 0) ok = reverseProof() && ok;
  process.exit(ok ? 0 : 1);
}

module.exports = { matchField, cronFiresInWindow, s1_schema, s2_completeness, s3_eight_source,
  s4_exclusion, s5_chain_coverage, s6_silence };
