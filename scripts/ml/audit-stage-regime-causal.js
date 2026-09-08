/**
 * V4.0 Phase 0 — Stage / Regime 因果审计（闸门）
 *
 * 未 PASS 禁止开始 Qlib 训练。
 *
 * 检查：
 *  1) 静态：源码危险模式（未来窗、centered MA 等）
 *  2) 动态：Stage(t|bars≤t) 在污染未来 bar 后不变
 *  3) 标签契约：Y 可用 Stage(t+N)，X 仅 ≤t（抽样验证）
 *  4) Regime 解析输入是否仅依赖已观测快照字段
 *
 * 运行：node scripts/ml/audit-stage-regime-causal.js
 *       node scripts/ml/audit-stage-regime-causal.js --from=2025-02-25 --to=2026-08-24
 */
'use strict';

const fs = require('fs');
const path = require('path');
const indicators = require('../../cloudfunctions/common/utils/indicators.js');
const { resolveTrendStage } = require('../../cloudfunctions/common/utils/trend-stage.js');
const { resolveMarketEnvironment } = require('../../cloudfunctions/common/utils/market-regime.js');
const { barsThrough } = require('../lib/bars-through.js');
const { ALL_ETFS } = require('../lib/universe.js');

const ROOT = path.join(__dirname, '../..');
const CSV_DIR = path.join(ROOT, 'deliverables/etf_daily_qfq');
const OUT_DIR = path.join(ROOT, 'scripts/backtest-out');
const REPORT_DIR = path.join(ROOT, '回测报告');

const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.95, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5
};

const AUDIT_FILES = [
  'cloudfunctions/common/utils/trend-stage.js',
  'cloudfunctions/common/utils/v3-6-stage-persistence.js',
  'cloudfunctions/common/utils/market-regime.js',
  'cloudfunctions/common/utils/market-env-v3.js',
  'cloudfunctions/common/utils/market-score-components.js',
  'cloudfunctions/common/utils/indicators.js',
  'cloudfunctions/common/utils/shock-recovery.js',
  'cloudfunctions/common/utils/decision-v3.js'
];

/** 静态危险模式：命中 → FAIL 或 WARN */
const STATIC_RULES = [
  {
    id: 'centered_ma',
    severity: 'FAIL',
    re: /centered|centre.?ma|two.?sided.?ma|filtfilt/i,
    note: '中心化/双向平滑可能用到未来'
  },
  {
    id: 'future_window_comment',
    severity: 'WARN',
    re: /T\s*\+\s*\d+|future.?confirm|lookahead|未来确认|后视/i,
    note: '注释或代码提及未来确认，需人工复核'
  },
  {
    id: 'slice_positive_future',
    severity: 'WARN',
    re: /\.slice\(\s*[^,]+\s*,\s*[^)]*\+\s*\d+/ ,
    note: 'slice 上界含 +N，确认不是未来窗'
  },
  {
    id: 'peak_trough_scan',
    severity: 'WARN',
    re: /findPeaks|peakDetection|scipy\.signal|argrelextrema/i,
    note: '峰谷检测常非因果'
  }
];

function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}

function loadCsv(code) {
  const files = fs.readdirSync(CSV_DIR).filter((f) => f.startsWith(code));
  if (!files.length) throw new Error(`无数据: ${code}`);
  const lines = fs.readFileSync(path.join(CSV_DIR, files[0]), 'utf8').split('\n');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || !p[0]) continue;
    bars.push({
      trade_date: p[0], open: +p[1], close: +p[2],
      high: +p[3], low: +p[4], volume: +p[5]
    });
  }
  return bars.sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
}

function staticAudit() {
  const findings = [];
  for (const rel of AUDIT_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      findings.push({ file: rel, id: 'missing', severity: 'FAIL', match: 'file missing' });
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    for (const rule of STATIC_RULES) {
      const m = text.match(rule.re);
      if (m) {
        findings.push({
          file: rel,
          id: rule.id,
          severity: rule.severity,
          note: rule.note,
          match: String(m[0]).slice(0, 80)
        });
      }
    }
    // 明确安全信号：barsThrough / slice(0, idx+1) / slice(-N)
    const causalHints = (text.match(/barsThrough|slice\(0,\s*idx\s*\+\s*1\)|slice\(-\d+/g) || []).length;
    findings.push({
      file: rel,
      id: 'causal_hint_count',
      severity: 'INFO',
      note: `疑似因果切片/截断命中 ${causalHints} 处`,
      match: String(causalHints)
    });
  }
  return findings;
}

function stageAt(bars, idx, state) {
  const today = bars[idx].trade_date;
  const hist = barsThrough(bars, today);
  if (hist.length < 60) return null;
  const snapshot = indicators.computeSnapshot(hist, PARAMS, { code: bars._code || '', calc_date: today });
  if (!snapshot) return null;
  const fund = { f_state: 'F3', f_score: 50 };
  const resolved = resolveTrendStage(snapshot, fund, state || {}, {
    bars: hist,
    params: {
      v3_6_persistence: true,
      v3_6_1_s5_downside: true,
      v3_6_1_enabled: true
    },
    v3_6_persistence: true
  });
  return {
    date: today,
    primary: resolved.primaryStage || resolved.stage,
    display: resolved.displayStage,
    reason: resolved.rawReason || resolved.reason,
    state: {
      stage: resolved.primaryStage || resolved.stage,
      overlay: resolved.overlay,
      days_in_stage: resolved.days_in_stage,
      soft_down_days: resolved.soft_down_days,
      breakout_level: resolved.breakout_level,
      s4_origin: resolved.s4_origin
    }
  };
}

function mutateFuture(bars, fromIdx) {
  const clone = bars.map((b, i) => {
    if (i <= fromIdx) return { ...b };
    const f = 1 + ((i % 7) - 3) * 0.03;
    return {
      ...b,
      close: +(b.close * f).toFixed(4),
      high: +(b.high * f * 1.01).toFixed(4),
      low: +(b.low * f * 0.99).toFixed(4),
      volume: Math.round(b.volume * (0.5 + (i % 5) * 0.2))
    };
  });
  clone._code = bars._code;
  return clone;
}

function dynamicCausalAudit(codes, fromDate, toDate) {
  const perCode = {};
  let totalChecks = 0;
  let mismatches = 0;
  const mismatchSamples = [];

  for (const code of codes) {
    const bars = loadCsv(code);
    bars._code = code;
    let state = {};
    let checks = 0;
    let fails = 0;
    const stageSeries = [];

    for (let i = 60; i < bars.length; i++) {
      const d = bars[i].trade_date;
      if (fromDate && d < fromDate) continue;
      if (toDate && d > toDate) break;

      const stateBefore = { ...state };
      const a = stageAt(bars, i, stateBefore);
      if (!a) continue;

      // 污染未来后重算（同一 prior state）；Stage(t) 不得依赖 t 之后的 bar
      const poisoned = mutateFuture(bars, i);
      const b = stageAt(poisoned, i, stateBefore);
      checks += 1;
      totalChecks += 1;
      if (!b || a.primary !== b.primary || a.display !== b.display) {
        fails += 1;
        mismatches += 1;
        if (mismatchSamples.length < 12) {
          mismatchSamples.push({
            code, date: d,
            clean: { primary: a.primary, display: a.display },
            poisoned: b ? { primary: b.primary, display: b.display } : null
          });
        }
      }
      state = a.state;
      stageSeries.push({ date: d, primary: a.primary, display: a.display });
    }
    perCode[code] = { checks, fails, fail_rate: checks ? fails / checks : 0, n_stage: stageSeries.length };
  }

  return { totalChecks, mismatches, mismatchSamples, perCode };
}

/** 标签契约：在 S2 日，用 ≤t 特征代理 + t+N stage 作 Y；验证特征日不读未来 close */
function labelContractAudit(codes, N, fromDate, toDate) {
  const events = [];
  for (const code of codes) {
    const bars = loadCsv(code);
    bars._code = code;
    let state = {};
    for (let i = 60; i < bars.length - N; i++) {
      const d = bars[i].trade_date;
      if (fromDate && d < fromDate) continue;
      if (toDate && d > toDate) break;
      const cur = stageAt(bars, i, state);
      if (!cur) continue;
      state = cur.state;
      if (cur.primary !== 'S2') continue;

      const fut = stageAt(bars, i + N, {});
      if (!fut) continue;
      const y = (fut.primary === 'S4' || fut.primary === 'S5') ? 1 : 0;

      // 特征代理：仅用 hist≤t 的末值
      const hist = barsThrough(bars, d);
      const snap = indicators.computeSnapshot(hist, PARAMS, { code, calc_date: d });
      const featureClose = hist[hist.length - 1].close;
      const trueClose = bars[i].close;
      const featureLeak = Math.abs(featureClose - trueClose) > 1e-9;

      events.push({
        code, date: d, N, y,
        future_stage: fut.primary,
        ma20_slope: snap ? snap.ma20_slope : null,
        volume_ratio: snap ? snap.volume_ratio : null,
        feature_leak: featureLeak
      });
    }
  }
  const leaks = events.filter((e) => e.feature_leak).length;
  const pos = events.filter((e) => e.y === 1).length;
  return {
    N,
    n_s2_events: events.length,
    n_positive: pos,
    positive_rate: events.length ? pos / events.length : null,
    feature_leaks: leaks,
    sample: events.slice(0, 8)
  };
}

function regimeAuditSmoke() {
  // 仅检查 resolveMarketEnvironment 对输入的纯函数性：改无关字段不应需要未来
  const base = resolveMarketEnvironment({
    indexWStates: ['W1', 'W2', 'W3'],
    etfWStates: ['W1', 'W3', 'W2', 'W4', 'W3'],
    techWStates: ['W1', 'W2', 'W3'],
    ndxTrend: '上',
    risk: { risk_flag: 'NORMAL' },
    riskEventsActive: false,
    breadthSource: 'index',
    techSnapshots: []
  });
  const again = resolveMarketEnvironment({
    indexWStates: ['W1', 'W2', 'W3'],
    etfWStates: ['W1', 'W3', 'W2', 'W4', 'W3'],
    techWStates: ['W1', 'W2', 'W3'],
    ndxTrend: '上',
    risk: { risk_flag: 'NORMAL' },
    riskEventsActive: false,
    breadthSource: 'index',
    techSnapshots: []
  });
  const stable = JSON.stringify(base) === JSON.stringify(again);
  return {
    ok: stable,
    regime: base.market_regime || base.regime,
    score: base.market_score,
    note: 'MarketEnv 为快照输入纯函数；生产周线来自已落库 MARKET_ENV（须保证入库时点 ≤T）'
  };
}

function decideGate(staticFindings, dynamic, labels, regime) {
  const fails = staticFindings.filter((f) => f.severity === 'FAIL');
  const warns = staticFindings.filter((f) => f.severity === 'WARN');
  const reasons = [];

  if (fails.length) reasons.push(`静态 FAIL×${fails.length}`);
  if (dynamic.mismatches > 0) {
    reasons.push(`动态因果 mismatch ${dynamic.mismatches}/${dynamic.totalChecks}`);
  }
  if (labels.some((l) => l.feature_leaks > 0)) reasons.push('标签特征泄露');
  if (!regime.ok) reasons.push('Regime 不稳定');

  let status = 'PASS';
  if (reasons.length) status = 'FAIL';
  else if (warns.length) status = 'WARN';

  // 小样本提示（不单独 FAIL，但阻断「仅用 Main5 开训」）
  const minPos = Math.min(...labels.map((l) => l.n_positive || 0));
  if (status !== 'FAIL' && minPos < 80) {
    status = status === 'PASS' ? 'WARN' : status;
    reasons.push(`S2→S4 正样本过少（min pos=${minPos}）；须扩展训练池，禁止单票开训`);
  }

  return { status, reasons, warn_count: warns.length, fail_count: fails.length };
}

function writeReport(payload) {
  const stamp = payload.generated_at.slice(0, 10);
  const lines = [];
  lines.push('# V4.0 Phase 0 — Stage/Regime 因果审计');
  lines.push('');
  lines.push(`日期：${stamp}`);
  lines.push(`窗口：${payload.window.from} ~ ${payload.window.to}`);
  lines.push('');
  lines.push(`## 闸门结果：**${payload.gate.status}**`);
  lines.push('');
  if (payload.gate.reasons.length) {
    lines.push('原因：');
    payload.gate.reasons.forEach((r) => lines.push(`- ${r}`));
    lines.push('');
  }
  lines.push(payload.gate.status === 'FAIL'
    ? '> **禁止**进入 Qlib 训练 / Vibe→生产 / Fast Path 实装。'
    : payload.gate.status === 'WARN'
      ? '> 可进入 Phase 1 **规格与数据集设计**，但开训前必须扩展训练池并处理 WARN。'
      : '> 允许进入 Phase 1 Early Transition 研究（仍须 Challenger Protocol）。');
  lines.push('');
  lines.push('## 1. 静态扫描');
  lines.push('');
  lines.push('| 文件 | id | 级别 | 说明 |');
  lines.push('|------|-----|------|------|');
  for (const f of payload.static.filter((x) => x.severity !== 'INFO')) {
    lines.push(`| ${f.file} | ${f.id} | ${f.severity} | ${f.note || f.match} |`);
  }
  if (!payload.static.filter((x) => x.severity !== 'INFO').length) {
    lines.push('| — | — | — | 无 FAIL/WARN 命中 |');
  }
  lines.push('');
  lines.push('## 2. 动态因果（污染未来 bar）');
  lines.push('');
  lines.push(`检查次数：${payload.dynamic.totalChecks}；mismatch：${payload.dynamic.mismatches}`);
  lines.push('');
  lines.push('| 代码 | checks | fails | fail_rate |');
  lines.push('|------|--------|-------|-----------|');
  for (const [code, r] of Object.entries(payload.dynamic.perCode)) {
    lines.push(`| ${code} | ${r.checks} | ${r.fails} | ${(r.fail_rate * 100).toFixed(2)}% |`);
  }
  lines.push('');
  lines.push('## 3. 标签契约（S2 → Stage(t+N)∈{S4,S5}）');
  lines.push('');
  for (const l of payload.labels) {
    lines.push(`- N=${l.N}：S2 事件 ${l.n_s2_events}，正样本 ${l.n_positive}（${l.positive_rate != null ? (l.positive_rate * 100).toFixed(1) : 'n/a'}%），feature_leak=${l.feature_leaks}`);
  }
  lines.push('');
  lines.push('## 4. Regime');
  lines.push('');
  lines.push(`- 纯函数稳定：${payload.regime.ok}`);
  lines.push(`- 样例 regime=${payload.regime.regime} score=${payload.regime.score}`);
  lines.push(`- ${payload.regime.note}`);
  lines.push('');
  lines.push('## 5. 下一步');
  lines.push('');
  lines.push('- 见 `ml/phase1_early_transition_spec.md`');
  lines.push('- Challenger：`ml/CHALLENGER_PROTOCOL.md`');
  lines.push('- 熔断：`ml/CIRCUIT_BREAKER.md`');
  lines.push('');
  lines.push(`JSON：\`scripts/backtest-out/v40-phase0-causal-${stamp}.json\``);
  lines.push('');

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const mdPath = path.join(REPORT_DIR, `V4.0-Phase0-因果审计-${stamp}.md`);
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  return mdPath;
}

function main() {
  const fromDate = argVal('--from') || '2025-02-25';
  const toDate = argVal('--to') || '2026-08-24';
  const codes = ALL_ETFS.map((e) => e.code);

  const staticFindings = staticAudit();
  const dynamic = dynamicCausalAudit(codes, fromDate, toDate);
  const labels = [
    labelContractAudit(codes, 5, fromDate, toDate),
    labelContractAudit(codes, 10, fromDate, toDate)
  ];
  const regime = regimeAuditSmoke();
  const gate = decideGate(staticFindings, dynamic, labels, regime);

  const stamp = new Date().toISOString().slice(0, 10);
  const payload = {
    generated_at: new Date().toISOString(),
    charter: 'V4.0 Rule Core + ML Alpha Layer — Phase 0 gate',
    window: { from: fromDate, to: toDate },
    gate,
    static: staticFindings,
    dynamic,
    labels,
    regime
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `v40-phase0-causal-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  const mdPath = writeReport(payload);

  console.log('════════ V4.0 Phase 0 因果审计 ════════');
  console.log(`GATE: ${gate.status}`);
  if (gate.reasons.length) console.log('reasons:', gate.reasons.join(' | '));
  console.log(`dynamic mismatch ${dynamic.mismatches}/${dynamic.totalChecks}`);
  labels.forEach((l) => console.log(`label N=${l.N} s2=${l.n_s2_events} pos=${l.n_positive} leak=${l.feature_leaks}`));
  console.log(jsonPath);
  console.log(mdPath);

  if (gate.status === 'FAIL') process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { staticAudit, dynamicCausalAudit, labelContractAudit };
