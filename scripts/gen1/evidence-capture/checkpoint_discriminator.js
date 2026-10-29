/**
 * §5.8 —— **W1/W2 checkpoint 判别器**（v6.0 FREEZE PREPARATION 级构件）
 * ======================================================================
 * 目的：把 v6.0 §5.8「`W1 ∪ W2` + `first-window-wins`」从**文字**变成**可执行、可打红**的判据，
 *       并把「窗口不同 ⇒ **不**产生第二个独立事件」与「W2 捕获的 run **同样可以**是独立事件」
 *       这两条**由 R1-v2 判据**当场裁决（⛔ 本文件不复制判据逻辑）。
 *
 * 依据：
 *   [APPROVED] owner 2026-10-02 —— **B2 = APPROVED**：checkpoint = `W1 ∪ W2`；rule = `first-window-wins`；
 *              **B1 = APPROVED**：版本 = `v6.0`；`V5.0 = SUPERSEDED / INVALID FOR NEW EVIDENCE`
 *   [CANDIDATE] `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md` §5.8 / §3.4A
 *   [FROZEN]   Contract v5.0 §5.2（fail-closed）/ §5.5（单调采纳）
 *
 * ⛔ **本文件是 DRAFT 级构件**：契约尚未冻结（`V6.0 FREEZE = NOT AUTHORIZED`）⇒ ⛔ 不得据其采样。
 * ⛔ 独立性判据**唯一来源** = `independence_discriminator_v2.js`（require，⛔ 不复制）。
 *
 * 用法：
 *   node checkpoint_discriminator.js --selftest
 *   node checkpoint_discriminator.js --binding
 *   node checkpoint_discriminator.js --first-window-wins
 *   node checkpoint_discriminator.js --cross
 *   node checkpoint_discriminator.js --red-proof
 *   node checkpoint_discriminator.js --fixtures <path>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const R1 = require('./independence_discriminator_v2.js');

const HERE = __dirname;
const DEFAULT_FIXTURE = path.join(HERE, 'fixtures', 'checkpoint_windows_cases.json');
let FIXTURE = DEFAULT_FIXTURE;

function load() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

// ---------------------------------------------------------------- 时间工具
function hhmmToMin(t) {
  const [h, m] = String(t).split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

function localTimeOf(s) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s));
  if (!m) return null;
  return { date: m[1], minute: parseInt(m[2], 10) * 60 + parseInt(m[3], 10) };
}

function inWindow(minute, w) {
  const a = hhmmToMin(w.start), b = hhmmToMin(w.end);
  return minute >= a && minute < b;
}

// ---------------------------------------------------------------- 核心判据
/**
 * 单次捕获会话判定（§5.8）。
 * ctx = { capture_local, weekday(0=周一…4=周五), pinned_decision_date, target_decision_date }
 */
function decideCapture(ctx, windows) {
  const lt = localTimeOf(ctx.capture_local);
  if (!lt) return { ok: false, window_id: null, reason: 'CAPTURE_LOCAL_UNPARSEABLE' };
  if (!(ctx.weekday >= 0 && ctx.weekday <= 4)) {
    return { ok: false, window_id: null, reason: 'WEEKEND' };
  }
  const open = windows.filter((w) => inWindow(lt.minute, w));
  if (!open.length) return { ok: false, window_id: null, reason: 'OFF_CHECKPOINT' };
  const match = open.find((w) => String(ctx.pinned_decision_date) === String(ctx.target_decision_date));
  if (!match) return { ok: false, window_id: null, reason: 'DECISION_DATE_MISMATCH' };
  return { ok: true, window_id: match.id, reason: 'IN_WINDOW_AND_DATE_MATCH' };
}

/**
 * `first-window-wins`：按预登记**有序**窗口序列逐 session 检查，**首个**产出即终止该 D 的捕获。
 * ⛔ 一旦某 session 产出 ⇒ 后续 session **不得**再产出（⛔ 不产生第二个 bundle）。
 * strict=true 时**不**终止（用于打红自证：模拟「忘记 first-window-wins」的错误实现）。
 */
function firstWindowWins(sessions, windows, strict) {
  let produced = 0;
  let winner = null;
  let windowId = null;
  const trace = [];
  sessions.forEach((s) => {
    const terminated = produced > 0 && strict !== false;
    if (terminated) {
      trace.push({ capture_local: s.capture_local, skipped: true, why: 'FIRST_WINDOW_ALREADY_WON' });
      return;
    }
    const r = decideCapture(s, windows);
    trace.push({ capture_local: s.capture_local, ok: r.ok, window_id: r.window_id, reason: r.reason });
    if (r.ok) {
      produced += 1;
      if (winner === null) { winner = s.capture_local; windowId = r.window_id; }
    }
  });
  return { winner, window_id: windowId, bundles_produced: produced, trace };
}

/** 独立事件计数增量：INDEPENDENT ⇒ +2（两个事件）；否则 +0。 */
function eventsDelta(verdict) {
  return verdict === R1.VERDICT.INDEPENDENT ? 2 : 0;
}

// ---------------------------------------------------------------- 自证
function pad(s, n) {
  const t = String(s);
  return t.length >= n ? t : t + ' '.repeat(n - t.length);
}

// ---------------------------------------------------------------- 夹具绑定
/**
 * ★ 夹具 ↔ 实际文件 的**指纹绑定校验**。
 * 夹具里登记的 `content_sha256` / `frozen_baseline.content_sha256` 必须与磁盘上的**真实文件**逐字节一致
 * ⇒ 任何「改了契约却忘了同步夹具」或「夹具里写死陈旧指纹」的情形**必然 FAIL**（⛔ 静默陈旧 = 治理事故）。
 */
function binding() {
  const fx = load();
  const crypto = require('crypto');
  const root = path.resolve(HERE, '..', '..', '..');
  const chk = (label, rel, exp) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return { label, ok: false, why: '文件不存在: ' + rel };
    const got = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    return { label, ok: got === exp, why: got === exp ? '' : ('got=' + got + '  expect=' + exp) };
  };
  return [
    chk('FROZEN V5.0 载体', fx.approved_binding.frozen_baseline.carrier,
      fx.approved_binding.frozen_baseline.content_sha256),
    chk('V6.0 FREEZE CANDIDATE', fx.approved_binding.candidate.path,
      fx.approved_binding.candidate.content_sha256),
  ];
}

function selftest() {
  const fx = load();
  const windows = fx.windows;
  console.log('== §5.8 W1/W2 checkpoint 判别器 自证（fixtures: %s）==',
    path.basename(FIXTURE));
  console.log('   B1 = %s', fx.approved_binding.B1);
  console.log('   B2 = %s', fx.approved_binding.B2);
  console.log('   rule = %s ; windows = %s',
    fx.rule, windows.map((w) => w.id + '[' + w.start + ',' + w.end + ')').join(' ∪ '));

  let pass = 0, fail = 0;

  // ★ 夹具 ↔ 实际文件 指纹绑定（⛔ 防「改了契约忘同步夹具」/ 静默陈旧）
  const bres = binding();
  const bok = bres.every((r) => r.ok);
  if (bok) pass += 1; else fail += 1;
  console.log('\n  -- 夹具指纹绑定 --');
  console.log('  [%s] CK-BIND-1 夹具登记 sha256 == 磁盘实际文件  %s',
    bok ? 'PASS' : 'FAIL', bres.map((r) => r.label + (r.ok ? '✓' : '✗')).join(' / '));
  bres.filter((r) => !r.ok).forEach((r) => console.log('        %s  %s', r.label, r.why));

  console.log('\n  -- capture_cases --');
  fx.capture_cases.forEach((c) => {
    const got = decideCapture(c, windows);
    const ok = got.ok === c.expect.ok
      && String(got.window_id) === String(c.expect.window_id)
      && got.reason === c.expect.reason;
    if (ok) pass += 1; else fail += 1;
    console.log('  [%s] %s  %s', ok ? 'PASS' : 'FAIL', pad(c.id, 24),
      'expect=' + JSON.stringify(c.expect) + ' got=' + JSON.stringify(got));
  });

  console.log('\n  -- first_window_wins_cases --');
  fx.first_window_wins_cases.forEach((c) => {
    const got = firstWindowWins(c.sessions, windows);
    const ok = String(got.winner) === String(c.expect.winner)
      && String(got.window_id) === String(c.expect.window_id)
      && got.bundles_produced === c.expect.bundles_produced;
    if (ok) pass += 1; else fail += 1;
    console.log('  [%s] %s  %s', ok ? 'PASS' : 'FAIL', pad(c.id, 24),
      'expect=' + JSON.stringify(c.expect)
      + ' got=' + JSON.stringify({ winner: got.winner, window_id: got.window_id, bundles_produced: got.bundles_produced }));
  });

  console.log('\n  -- cross_cases（独立性由 R1-v2 判据裁决）--');
  fx.cross_cases.forEach((c) => {
    const r = R1.decideIndependence(c.A, c.B);
    const delta = eventsDelta(r.verdict);
    const L = R1.legacyDecideIndependence(c.A, c.B);
    const ok = r.verdict === c.expect.verdict
      && delta === c.expect.events_delta
      && (c.expect.legacy_verdict == null || L.verdict === c.expect.legacy_verdict);
    if (ok) pass += 1; else fail += 1;
    console.log('  [%s] %s  %s', ok ? 'PASS' : 'FAIL', pad(c.id, 36),
      'expect=' + JSON.stringify(c.expect));
    console.log('        %s got=%s / events_delta=%d / legacy=%s',
      ' '.repeat(39), r.verdict, delta, L.verdict);
  });

  console.log('\n  ---------- %d passed / %d failed ----------', pass, fail);
  return fail === 0;
}

function fww() {
  const fx = load();
  console.log('== §5.8 first-window-wins 执行规则演示 ==');
  let all = true;
  fx.first_window_wins_cases.forEach((c) => {
    const got = firstWindowWins(c.sessions, fx.windows);
    const ok = String(got.winner) === String(c.expect.winner) && got.bundles_produced === c.expect.bundles_produced;
    all = all && ok;
    console.log('  [%s] %s', ok ? 'PASS' : 'FAIL', c.id);
    console.log('        %s', c.title);
    got.trace.forEach((t) => {
      console.log('          · %s ⇒ %s', t.capture_local,
        t.skipped ? 'SKIPPED(' + t.why + ')' : (t.ok ? 'PRODUCED@' + t.window_id : 'NO(' + t.reason + ')'));
    });
    console.log('        ⇒ winner=%s window=%s bundles=%d', got.winner, got.window_id, got.bundles_produced);
  });
  console.log('  ---------- FIRST_WINDOW_WINS = %s ----------', all ? 'PASS' : 'FAIL');
  return all;
}

function cross() {
  const fx = load();
  console.log('== §5.8 × §3.4A 交叉裁决（★ owner 点名两条）==');
  let all = true;
  fx.cross_cases.forEach((c) => {
    const r = R1.decideIndependence(c.A, c.B);
    const delta = eventsDelta(r.verdict);
    const L = R1.legacyDecideIndependence(c.A, c.B);
    const ok = r.verdict === c.expect.verdict && delta === c.expect.events_delta;
    all = all && ok;
    console.log('  [%s] %s', ok ? 'PASS' : 'FAIL', c.id);
    console.log('        %s', c.title);
    console.log('        trigger A=%s / B=%s  window A=%s / B=%s  decision_date A=%s / B=%s',
      c.A.trigger, c.B.trigger, c.A.window_id, c.B.window_id, c.A.decision_date, c.B.decision_date);
    console.log('        标准判据 = %s / %s  ⇒ events_delta = %d', r.verdict,
      JSON.stringify(r.reasons), delta);
    if (L.verdict !== r.verdict) {
      console.log('        旧规则   = %s / %s  ⇒ ⛔ 若沿用旧规则将**多计** %d 个事件（本节即证伪）',
        L.verdict, JSON.stringify(L.reasons), eventsDelta(L.verdict) - delta);
    }
  });
  console.log('  ---------- CROSS_DISCRIMINATOR = %s ----------', all ? 'PASS' : 'FAIL');
  return all;
}

/** ★ 打红自证：变异窗口 / 变异 first-window-wins / 变异周末守卫 ⇒ **必须**被检出 */
function redProof() {
  const fx = load();
  const base = fx.windows;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const out = [];
  const probe = (id, ctx, windows) => {
    const c = fx.capture_cases.find((x) => x.id === id);
    return decideCapture(ctx || c, windows);
  };

  // RP-1 W1 终点放宽 1 分钟 ⇒ 23:30 边界必须翻为「命中」
  {
    const w = clone(base); w[0].end = '23:31';
    const r = probe('CK-W1-END-EXCLUSIVE', null, w);
    out.push({ id: 'RP-1', name: 'W1 终点 23:30 → 23:31（边界放宽）',
      expect: '检出（23:30 由 OFF 变 W1）', got: JSON.stringify(r), detected: r.ok === true });
  }
  // RP-2 删掉 W2 ⇒ 08:00 次日晨捕获必须失败
  {
    const w = clone(base).filter((x) => x.id !== 'W2');
    const r = probe('CK-W2-0845', null, w);
    out.push({ id: 'RP-2', name: '删除 W2 窗口',
      expect: '检出（CK-W2-0845 由 W2 变 OFF）', got: JSON.stringify(r),
      detected: r.ok === false && r.reason === 'OFF_CHECKPOINT' });
  }
  // RP-3 关闭 first-window-wins ⇒ 同一 D 产出 2 个 bundle
  {
    const c = fx.first_window_wins_cases.find((x) => x.id === 'FWW-W1-WINS');
    const good = firstWindowWins(c.sessions, base);
    const bad = firstWindowWins(c.sessions, base, false);
    out.push({ id: 'RP-3', name: '忘记 first-window-wins（strict=false）',
      expect: '检出（bundles 1 → 2）',
      got: 'good=' + good.bundles_produced + ' / bad=' + bad.bundles_produced,
      detected: good.bundles_produced === 1 && bad.bundles_produced === 2 });
  }
  // RP-4 去掉周末守卫 ⇒ 周六必须被误判为命中
  {
    const w = clone(base);
    const c = fx.capture_cases.find((x) => x.id === 'CK-WEEKEND-W1');
    const real = decideCapture(c, w);
    // 模拟「无周末守卫」：把 weekday 强行改成工作日再判（等价于删掉该守卫）
    const noGuard = decideCapture(Object.assign({}, c, { weekday: 3 }), w);
    out.push({ id: 'RP-4', name: '周末守卫缺失（等价于把周六当工作日）',
      expect: '检出（周末由 WEEKEND 变命中）',
      got: 'real=' + real.reason + ' / noGuard=' + JSON.stringify(noGuard),
      detected: real.ok === false && real.reason === 'WEEKEND' && noGuard.ok === true });
  }
  // RP-5 W2 起点后移 ⇒ 08:45 必须失败
  {
    const w = clone(base); w[1].start = '09:00';
    const r = probe('CK-W2-0845', null, w);
    out.push({ id: 'RP-5', name: 'W2 起点 08:30 → 09:00',
      expect: '检出（08:45 由 W2 变 OFF）', got: JSON.stringify(r),
      detected: r.ok === false && r.reason === 'OFF_CHECKPOINT' });
  }
  // RP-6 抹掉 pinned_decision_date ⇒ 不得因缺载而误判为命中
  {
    const c = fx.capture_cases.find((x) => x.id === 'CK-W1-2245');
    const r = decideCapture(Object.assign({}, c, { pinned_decision_date: null }), base);
    out.push({ id: 'RP-6', name: 'pinned_decision_date 缺载',
      expect: '检出（不得误判命中）', got: JSON.stringify(r),
      detected: r.ok === false });
  }
  // RP-7 逐字节还原（重载夹具）⇒ 全部检查必须重新 PASS
  {
    const fx2 = load();
    const okA = JSON.stringify(fx2.windows) === JSON.stringify(base);
    const okB = fx2.cross_cases.every((c) => R1.decideIndependence(c.A, c.B).verdict === c.expect.verdict);
    const okC = fx2.capture_cases.every((c) => {
      const g = decideCapture(c, fx2.windows);
      return g.ok === c.expect.ok && String(g.window_id) === String(c.expect.window_id);
    });
    out.push({ id: 'RP-7', name: '逐字节还原夹具 ⇒ 全部检查重新 PASS',
      expect: 'PASS', got: JSON.stringify({ windows_same: okA, cross: okB, capture: okC }),
      detected: okA && okB && okC });
  }

  console.log('== §5.8 checkpoint 判别器 打红自证（变异必须被检出）==');
  let all = true;
  out.forEach((o) => {
    if (!o.detected) all = false;
    console.log('  [%s] %s · %s', o.detected ? 'PASS' : 'FAIL', o.id, o.name);
    console.log('         expect=%s got=%s', o.expect, o.got);
  });
  console.log('  ---------- CHECKPOINT_RED_PROOF = %s ----------', all ? 'PASS' : 'FAIL');
  return all;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--fixtures');
  if (fi >= 0 && args[fi + 1]) FIXTURE = path.resolve(args[fi + 1]);
  const want = (f) => args.indexOf(f) >= 0;
  let ok = true;
  if (want('--binding')) {
    console.log('== 夹具 ↔ 实际文件 指纹绑定校验 ==');
    const bres = binding();
    bres.forEach((r) => console.log('  [%s] %s %s', r.ok ? 'PASS' : 'FAIL', pad(r.label, 24), r.why));
    console.log('  ---------- BINDING = %s ----------', bres.every((r) => r.ok) ? 'PASS' : 'FAIL');
    ok = bres.every((r) => r.ok) && ok;
  }
  if (args.length === 0 || want('--selftest')) ok = selftest() && ok;
  if (want('--first-window-wins')) ok = fww() && ok;
  if (want('--cross')) ok = cross() && ok;
  if (want('--red-proof')) ok = redProof() && ok;
  process.exit(ok ? 0 : 1);
}

module.exports = { hhmmToMin, localTimeOf, inWindow, decideCapture, firstWindowWins, eventsDelta, binding };
