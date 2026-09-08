/**
 * E3 解释链审计：515880 在 W4+零仓+A/B 窗口（全链路回测上下文）
 * 运行：node scripts/diag-e3-explain-audit.js
 *       node scripts/diag-e3-explain-audit.js --tag=3t-2024 --from=2024-01-01 --to=2025-02-24 --csv-dir=deliverables/etf_daily_3ticket --codes=518880,515880,513310
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  loadCsv, decideDay, makeSlowResolver, makeCooldown,
  ETFS, TECH_SECTORS
} = require('./backtest-full-engine.js');
const { parseCodes, selectUniverse, intersectTradeDates } = require('./lib/universe.js');

const TARGET = '515880';
const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(__dirname, '../回测报告');

function argVal(name) {
  const hit = process.argv.find((a) => a.indexOf(name + '=') === 0);
  return hit ? hit.slice(name.length + 1) : null;
}

function gradeFromScore(score) {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function pickExplain(chain, keywords) {
  if (!chain || !chain.length) return [];
  return chain.filter((e) => {
    const t = `${e.condition || ''} ${e.result || ''}`;
    return keywords.some((k) => t.indexOf(k) >= 0);
  });
}

function main() {
  const codesArg = argVal('--codes');
  const csvRel = argVal('--csv-dir');
  const startDate = argVal('--from') || '2025-02-25';
  const endDate = argVal('--to') || '2026-08-21';
  const tag = argVal('--tag') || 'main';

  const universe = codesArg ? selectUniverse(parseCodes(codesArg)) : ETFS;
  const etf515 = universe.find((e) => e.code === TARGET);
  if (!etf515) throw new Error(`票池无 ${TARGET}`);

  // backtest-full-engine loadCsv reads CSV_DIR from module — override via env hack: reassign in decide path
  // loadCsv is bound to backtest module CSV_DIR; we patch by temporarily setting argv for child pattern
  // Instead duplicate csv dir resolution: backtest loadCsv uses global CSV_DIR set in main only.
  // Use local loader mirroring backtest when custom csv-dir.
  const csvDir = csvRel
    ? (path.isAbsolute(csvRel) ? csvRel : path.join(__dirname, '..', csvRel))
    : path.join(__dirname, '../deliverables/etf_daily_qfq');

  function loadLocal(code) {
    const files = fs.readdirSync(csvDir).filter((f) => f.startsWith(code));
    if (!files.length) throw new Error(`无数据: ${code}`);
    const lines = fs.readFileSync(path.join(csvDir, files[0]), 'utf8').split('\n');
    const bars = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const p = line.split(',');
      bars.push({
        trade_date: p[0],
        open: Number(p[1]),
        close: Number(p[2]),
        high: Number(p[3]),
        low: Number(p[4]),
        volume: Number(p[5]),
        amount: Number(p[6] || 0)
      });
    }
    return bars;
  }

  const barsMap = {};
  for (const etf of universe) barsMap[etf.code] = loadLocal(etf.code);
  const allDates = intersectTradeDates(barsMap, universe);
  const startIdx = allDates.findIndex((d) => d >= startDate);
  const tradingDays = allDates.slice(Math.max(0, startIdx - 60));
  const loopStart = tradingDays.findIndex((d) => d >= startDate);
  const firstIdx = Math.max(60, loopStart);

  const portfolio = {
    positions: {},
    techPosition: 0, goldPosition: 0, drugPosition: 0,
    market_regime: 'range', cashRatio: 100,
    tech_position: 0, gold_position: 0, cash_ratio: 100
  };
  for (const etf of universe) {
    portfolio.positions[etf.code] = {
      code: etf.code, current_position: 0, target_max: 30,
      max_position: 30, max_strategic_position: 30,
      core_position: 0, trade_position: 0
    };
  }

  const slowResolver = makeSlowResolver();
  const cooldown = makeCooldown(tradingDays);
  const pending = {};

  const samples = [];
  let w4ZeroAb = 0;
  let e3Build = 0;
  let e3Blocked = 0;
  let e3FootnoteDays = 0;
  const buildEvents = [];

  for (let idx = firstIdx; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];
    if (endDate && today > endDate) break;

    for (const code of Object.keys(pending)) {
      const ord = pending[code];
      const pos = portfolio.positions[code];
      const bar = barsMap[code].find((b) => b.trade_date === today);
      const diff = ord.target - pos.current_position;
      if (bar && Math.abs(diff) > 0.05) {
        pos.current_position = Math.round(ord.target * 10) / 10;
        if (diff > 0) cooldown.setBuy(code, idx, ord.add_mode);
        pos.core_position = ord.core != null ? ord.core : pos.core_position;
        pos.trade_position = ord.trade != null ? ord.trade : pos.trade_position;
      }
      if (bar) delete pending[code];
    }

    const dayResults = decideDay(barsMap, idx, portfolio, slowResolver, cooldown, tradingDays, 'F3', false, universe);
    for (const { code, result } of dayResults) {
      const pos = portfolio.positions[code];
      pending[code] = {
        target: result.suggested_position != null ? result.suggested_position : pos.current_position,
        core: result.core_position,
        trade: result.trade_position,
        action: result.final_action,
        add_mode: result.add_mode || '无'
      };
      if (code !== TARGET) continue;

      const w = result.w_state;
      const cur = pos.current_position || 0;
      const opp = result.opportunity_score;
      const grade = result.opportunity_grade || gradeFromScore(opp);
      const isW4ZeroAb = w === 'W4' && cur <= 0.05 && (grade === 'A' || grade === 'B');
      if (!isW4ZeroAb) continue;

      w4ZeroAb += 1;
      const action = result.final_action;
      const e3Hits = pickExplain(result.explain_chain || [], ['E3', '零仓', '首仓试探']);
      const p1W4 = (result.rule_hits || []).filter((h) => h.name === 'W4');
      if (e3Hits.length || (p1W4[0] && String(p1W4[0].result).indexOf('E3') >= 0)) e3FootnoteDays += 1;

      const blocked = action !== 'BUILD' && action !== 'ADD';
      if (action === 'BUILD' || action === 'ADD') {
        e3Build += 1;
        buildEvents.push({ date: today, action, suggested: result.suggested_position, grade, opp });
      } else if (blocked) e3Blocked += 1;

      if (samples.length < 50 || action === 'BUILD' || action === 'ADD' || e3Hits.length) {
        samples.push({
          date: today,
          w, grade, opp,
          action,
          suggested: result.suggested_position,
          final_target: result.final_target,
          h: result.h_state,
          d: result.d_state,
          add_eligibility: result.add_eligibility,
          explain_e3: e3Hits.slice(0, 3),
          p1_w4: p1W4[0],
          tail: (result.explain_chain || []).slice(-3)
        });
      }
    }

    portfolio.techPosition = universe.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.tech_position = portfolio.techPosition;
    portfolio.goldPosition = portfolio.positions['518880'] ? portfolio.positions['518880'].current_position || 0 : 0;
    portfolio.gold_position = portfolio.goldPosition;
  }

  const date = new Date().toISOString().slice(0, 10);
  const summary = {
    tag,
    target: TARGET,
    window: `${startDate} ~ ${endDate}`,
    codes: universe.map((e) => e.code),
    csvDir: csvRel || 'deliverables/etf_daily_qfq',
    w4_zero_ab_days: w4ZeroAb,
    e3_footnote_days: e3FootnoteDays,
    build_or_add_days: e3Build,
    blocked_days: e3Blocked,
    build_rate: w4ZeroAb ? Math.round(e3Build / w4ZeroAb * 1000) / 10 : 0,
    build_events: buildEvents,
    samples: samples.slice(0, 40)
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `e3-explain-audit-${tag}-${date}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const lines = [
    `# E3 解释链审计 · ${tag}（${date}）`,
    '',
    `- 标的 **515880** · 窗口 ${summary.window}`,
    `- W4+零仓+A/B：**${w4ZeroAb}** 日 · P1 W4 E3 脚注：**${e3FootnoteDays}** · BUILD/ADD：**${e3Build}** · 拦截：**${e3Blocked}**`,
    `- JSON：` + `scripts/backtest-out/e3-explain-audit-${tag}-${date}.json`,
    '',
    '## BUILD/ADD 事件',
    '',
    buildEvents.length
      ? buildEvents.map((b) => `- ${b.date} ${b.action} suggested ${b.suggested}% grade ${b.grade} opp ${b.opp}`).join('\n')
      : '（本窗 W4 零仓 A/B 未触发 BUILD/ADD）',
    '',
    '## 样本日',
    ''
  ];
  for (const s of summary.samples.slice(0, 20)) {
    lines.push(`### ${s.date} · ${s.action} · W4 grade ${s.grade}`);
    lines.push(`- suggested ${s.suggested} · H ${s.h} · eligibility ${JSON.stringify(s.add_eligibility || {})}`);
    if (s.p1_w4) lines.push(`- P1 W4: ${s.p1_w4.result}`);
    for (const e of s.explain_e3) lines.push(`- explain: ${e.condition} → ${e.result}`);
    if (s.tail && s.tail.length) {
      lines.push(`- gate: ${s.tail.map((e) => `${e.step}:${e.result || e.condition}`).join(' | ')}`);
    }
    lines.push('');
  }

  const mdPath = path.join(REPORT_DIR, `V4.3-e3-explain-audit-${tag}-${date}.md`);
  fs.writeFileSync(mdPath, lines.join('\n'));
  console.log(`tag=${tag} W4零仓AB=${w4ZeroAb} E3脚注=${e3FootnoteDays} BUILD/ADD=${e3Build}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`MD: ${mdPath}`);
}

main();
