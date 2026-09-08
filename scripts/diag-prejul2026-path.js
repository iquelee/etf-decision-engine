/**
 * 2026-05~08 减仓路径 + W4 下 B+ 试探 ADD 可行性
 * 运行：node scripts/diag-prejul2026-path.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const indicators = require('../cloudfunctions/common/utils/indicators.js');
const decision = require('../cloudfunctions/common/utils/decision.js');
const { barsThrough } = require('./lib/bars-through.js');
const {
  loadCsv, decideDay, makeSlowResolver, makeCooldown,
  ETFS, START_DATE, TECH_SECTORS
} = require('./backtest-full-engine.js');
const { fScore } = require('./lib/signal-proxy.js');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(__dirname, '../回测报告');
const FROM = '2026-05-01';
const TO = '2026-08-24';

const PARAMS = {
  sideway_days: 15, sideway_days_min: 8, sideway_days_mature: 20,
  sideway_range_base: 12, sideway_atr_multiplier: 4, sideway_range_max: 12, sideway_range_hard_cap: 15,
  ma20_slope_flat: 1.5, trend_context_up: 5, trend_context_down: -5,
  volume_ratio: 0.70, volume_ratio_mild: 0.95, volume_ratio_high: 1.15, volume_ratio_extreme: 1.5,
  tech_sector_max: 65, single_etf_max: 30
};

function replayWindow() {
  const barsMap = {};
  for (const etf of ETFS) barsMap[etf.code] = loadCsv(etf.code);
  const dateSet = new Set();
  for (const etf of ETFS) barsMap[etf.code].forEach((b) => dateSet.add(b.trade_date));
  const allDates = [...dateSet].sort();
  const startIdx = allDates.findIndex((d) => d >= START_DATE);
  const tradingDays = allDates.slice(Math.max(0, startIdx - 60));

  const portfolio = {
    positions: {},
    techPosition: 0, goldPosition: 0, drugPosition: 0,
    market_regime: 'range', cashRatio: 100,
    tech_position: 0, gold_position: 0, cash_ratio: 100
  };
  for (const etf of ETFS) {
    portfolio.positions[etf.code] = {
      code: etf.code, current_position: 0, target_max: 30,
      max_position: 30, max_strategic_position: 30,
      core_position: 0, trade_position: 0
    };
  }

  const slowResolver = makeSlowResolver();
  const cooldown = makeCooldown(tradingDays);
  const pending = {};
  const daily = [];
  const fills = [];

  for (let idx = 60; idx < tradingDays.length; idx++) {
    const today = tradingDays[idx];
    for (const code of Object.keys(pending)) {
      const ord = pending[code];
      const pos = portfolio.positions[code];
      const bar = barsMap[code].find((b) => b.trade_date === today);
      const from = pos.current_position;
      const diff = ord.target - from;
      if (bar && Math.abs(diff) > 0.05) {
        pos.current_position = Math.round(ord.target * 10) / 10;
        if (diff > 0) cooldown.setBuy(code, idx, ord.add_mode);
        pos.core_position = ord.core != null ? ord.core : pos.core_position;
        pos.trade_position = ord.trade != null ? ord.trade : pos.trade_position;
        fills.push({
          date: today, code, action: ord.action,
          from: Math.round(from * 10) / 10,
          to: pos.current_position,
          pct: Math.round(diff * 10) / 10
        });
      }
      if (bar) delete pending[code];
    }

    const dayResults = decideDay(barsMap, idx, portfolio, slowResolver, cooldown, tradingDays, 'F3');
    const row = { date: today, book: 0, codes: {} };
    for (const { code, result } of dayResults) {
      const pos = portfolio.positions[code];
      pending[code] = {
        target: result.suggested_position != null ? result.suggested_position : pos.current_position,
        core: result.core_position,
        trade: result.trade_position,
        action: result.final_action,
        add_mode: result.add_mode || '无'
      };
      row.codes[code] = {
        action: result.final_action,
        current: pos.current_position,
        suggested: result.suggested_position,
        w: result.w_state,
        h: result.h_state,
        v: result.v_state,
        score: result.opportunity_score,
        grade: result.opportunity_grade,
        target: result.target_position,
        explain: (result.explain_chain || []).slice(0, 4)
      };
    }
    portfolio.techPosition = ETFS.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.goldPosition = portfolio.positions['518880'].current_position || 0;
    portfolio.drugPosition = portfolio.positions['159570'].current_position || 0;
    portfolio.tech_position = portfolio.techPosition;
    row.book = Math.round(ETFS.reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0) * 10) / 10;
    daily.push(row);
  }
  return { daily, fills, barsMap, tradingDays };
}

function probeW4BPlus(barsMap, tradingDays, dailySlice) {
  const slowResolver = makeSlowResolver();
  const samples = [];
  let w4BPlusDays = 0;
  let w4BPlusZeroCouldBuild = 0;
  let w4BPlusHasPosBlocked = 0;
  const gateBlocks = {};

  for (const d of dailySlice) {
    const idx = tradingDays.indexOf(d.date);
    if (idx < 60) continue;
    for (const etf of ETFS) {
      const c = d.codes[etf.code];
      if (!c || c.w !== 'W4') continue;
      if (!['A', 'B'].includes(c.grade)) continue;
      w4BPlusDays += 1;

      const bars = barsMap[etf.code];
      const today = d.date;
      const snap = indicators.computeSnapshot(barsThrough(bars, today), PARAMS, { code: etf.code, calc_date: today });
      if (!snap) continue;

      const current = c.current;
      const slow = slowResolver.resolve(etf.code, 'F3', today, tradingDays);
      const pos = {
        code: etf.code, current_position: current, target_max: 30,
        core_ratio_grade: slow.core_grade, trade_ratio_grade: slow.trade_grade
      };
      const probe = decision.runDecision(etf, snap, pos, PARAMS, {
        fundamental: { f_state: 'F3', f_score: fScore('F3') },
        risk: { risk_flag: 'NORMAL', risk_override: false },
        portfolio: { tech_position: 40, market_regime: 'range', positions: {} },
        cooldownDays: 0
      });

      const ctx = {
        snapshot: snap,
        fundamental: { f_state: 'F3' },
        risk: { risk_flag: 'NORMAL' },
        positions: pos,
        portfolio: { tech_position: 40, market_regime: 'range' },
        etf,
        params: PARAMS,
        opportunityScore: probe.opportunity_score,
        grade: probe.opportunity_grade,
        addMode: probe.add_mode || '无',
        cooldownDays: 0
      };
      ctx.consolidationGrade = decision.gradeConsolidation(snap);
      const gates = decision.checkAddEligibility(ctx);
      const w4First = decision.allowsW4AiNetworkFirstLot({
        snapshot: snap, positions: pos, etf,
        grade: probe.opportunity_grade,
        opportunityScore: probe.opportunity_score
      });

      if (current <= 0) {
        if (w4First && gates.overall === 'allow' && probe.action === 'BUILD') w4BPlusZeroCouldBuild += 1;
        else if (w4First && gates.overall !== 'allow') {
          for (const [k, v] of Object.entries(gates)) {
            if (k === 'overall') continue;
            if (v === 'pause' || v === 'forbid') gateBlocks[k] = (gateBlocks[k] || 0) + 1;
          }
        }
      } else {
        w4BPlusHasPosBlocked += 1;
      }

      if (samples.length < 20 && (current > 0 || w4First)) {
        samples.push({
          date: today,
          code: etf.code,
          name: etf.name,
          sector: etf.sector,
          current,
          grade: probe.opportunity_grade,
          score: probe.opportunity_score,
          action: probe.action,
          w4FirstLot: w4First,
          gates: gates.overall,
          gateDetail: Object.fromEntries(Object.entries(gates).filter(([k, v]) => k !== 'overall' && (v === 'pause' || v === 'forbid'))),
          suggested: probe.suggested_position
        });
      }
    }
  }

  return { w4BPlusDays, w4BPlusZeroCouldBuild, w4BPlusHasPosBlocked, gateBlocks, samples };
}

function renderMd(payload, stamp) {
  const lines = [];
  lines.push(`# V3.9 · 7月前减仓路径 & W4 B+ ADD 可行性（${stamp}）`);
  lines.push('');
  lines.push(`> 窗口 **${FROM} ~ ${TO}** · 解释 2026-08 book ~54% 从何而来`);
  lines.push('');

  lines.push('## 1. 组合 book 路径（月末快照）');
  lines.push('');
  lines.push('| 日期 | book% | 515880 | 518880 | 513310 | 159582 | 159570 |');
  lines.push('|------|-------|--------|--------|--------|--------|--------|');
  const snapDates = payload.daily.filter((d) => d.date.endsWith('-01') || d.date.endsWith('-15') || d.date.startsWith('2026-07') || d.date.startsWith('2026-08-01'));
  const seen = new Set();
  for (const d of payload.daily) {
    if (d.date < FROM) continue;
    const key = d.date.slice(0, 7) + (d.date.endsWith('-01') || d.date.endsWith('-15') || d.date === '2026-07-31' || d.date === '2026-08-01' ? d.date : '');
    if (!d.date.match(/-01$|-15$|^2026-07-|^2026-08-01/) && d.date !== '2026-07-31') continue;
    if (seen.has(d.date)) continue;
    seen.add(d.date);
    const p = (code) => d.codes[code] ? d.codes[code].current : '—';
    lines.push(`| ${d.date} | ${d.book} | ${p('515880')} | ${p('518880')} | ${p('513310')} | ${p('159582')} | ${p('159570')} |`);
  }
  lines.push('');

  lines.push('## 2. 实际成交减仓（fills，仅减仓）');
  lines.push('');
  const reduces = payload.fills.filter((f) => f.date >= FROM && f.date <= TO && f.pct < -0.05);
  lines.push('| 日期 | 代码 | 动作 | 变化 |');
  lines.push('|------|------|------|------|');
  for (const f of reduces) {
    lines.push(`| ${f.date} | ${f.code} | ${f.action} | ${f.from}% → ${f.to}% (${f.pct}pp) |`);
  }
  if (!reduces.length) lines.push('| — | — | — | 窗内无实际减仓成交 |');
  lines.push('');

  lines.push('## 3. 关键减仓决策日（STR/TAC/EXIT，含空转）');
  lines.push('');
  const keyDays = payload.daily.filter((d) => d.date >= FROM && d.date <= TO).flatMap((d) =>
    ETFS.map((e) => ({ date: d.date, code: e.code, ...d.codes[e.code], book: d.book }))
      .filter((x) => x.action && ['STRATEGIC_REDUCE', 'TACTICAL_REDUCE', 'EXIT'].includes(x.action))
  );
  lines.push('| 日期 | 代码 | 动作 | 仓→建议 | W | book |');
  lines.push('|------|------|------|---------|---|------|');
  for (const r of keyDays.slice(0, 40)) {
    lines.push(`| ${r.date} | ${r.code} | ${r.action} | ${r.current}→${r.suggested} | ${r.w} | ${r.book} |`);
  }
  lines.push('');

  lines.push('## 4. W4 + B+ 试探 ADD：规则 vs 实际');
  lines.push('');
  const w = payload.w4;
  lines.push('| 指标 | 数值 |');
  lines.push('|------|------|');
  lines.push(`| W4 且机会分 B+ 的「票×日」 | **${w.w4BPlusDays}** |`);
  lines.push(`| 零仓 + E3 可 BUILD（515880 ai_network） | **${w.w4BPlusZeroCouldBuild}** |`);
  lines.push(`| 已有仓 + W4 + B+（状态机强制 STR，ADD 不可能） | **${w.w4BPlusHasPosBlocked}** |`);
  lines.push('');
  lines.push('**源码硬规则**（`runStateMachine`）：');
  lines.push('- `W4 && current > 0` → **永远 STRATEGIC_REDUCE**，与机会分、闸门无关');
  lines.push('- `W4 && current === 0` → 仅 **515880（ai_network）零仓 B+** 可走 BUILD（E3）；其余 WAIT');
  lines.push('- 518880 / 513310 / 159582：**W4 下有仓不能 ADD，零仓也不能 BUILD**（非 ai_network）');
  lines.push('');
  if (Object.keys(w.gateBlocks).length) {
    lines.push('515880 零仓 W4 B+ 但被闸门拦（Top）：');
    for (const [k, v] of Object.entries(w.gateBlocks).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      lines.push(`- ${k}: ${v} 次`);
    }
    lines.push('');
  }
  lines.push('### 样本日');
  lines.push('');
  lines.push('| 日期 | 代码 | 仓 | 分档 | 动作 | E3首仓 | 闸门 |');
  lines.push('|------|------|-----|------|------|--------|------|');
  for (const s of w.samples.slice(0, 15)) {
    lines.push(`| ${s.date} | ${s.code} | ${s.current}% | ${s.grade}/${s.score} | ${s.action} | ${s.w4FirstLot ? '✓' : '—'} | ${s.gates} |`);
  }
  lines.push('');

  lines.push('## 5. 结论（V4.0 方向）');
  lines.push('');
  lines.push('### 7 月前 book 怎么掉到 ~54%');
  lines.push('- 查 **实际 fills**：若 5~7 月减仓成交少，则轻仓来自 **更早期（2026-03/04 或 2025 末）** 的战略减仓链');
  lines.push('- 2026-08 的 518880 STR×13 均为 **9.5→9.5 空转**，不是 8 月新砍');
  lines.push('- 515880 8 月全 HOLD → 9% 均仓是 **7 月前已到位**');
  lines.push('');
  lines.push('### W4 下 B+ 试探 ADD');
  lines.push('- **已有仓**：现行规则 **不允许 ADD**（W4 直接 STR）；要「试探」只能改状态机（V4.0 实验，风险：2026-03 下行月多亏）');
  lines.push('- **零仓**：仅 **515880** 有 E3；518880/513310/159582 在 W4 仍 WAIT');
  lines.push('- 若 V4.0 要做「涨段参与度」：优先考虑 **W4+有仓+ B+ 减到核心仓而非清零** 或 **W4 下零仓 B+ 扩 sector**（须 OOS+S4）');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const { daily, fills, barsMap, tradingDays } = replayWindow();
  const slice = daily.filter((d) => d.date >= FROM && d.date <= TO);
  const w4 = probeW4BPlus(barsMap, tradingDays, slice);

  const stamp = new Date().toISOString().slice(0, 10);
  const payload = { daily: slice, fills, w4, from: FROM, to: TO };
  const outJson = path.join(OUT_DIR, `diag-prejul2026-${stamp}.json`);
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const md = renderMd({ daily: slice, fills: fills.filter((f) => f.date >= FROM), w4 }, stamp);
  const outMd = path.join(REPORT_DIR, `V3.9-7月前减仓与W4-ADD-${stamp}.md`);
  fs.writeFileSync(outMd, md, 'utf8');

  console.log('book 路径（采样）:');
  for (const d of slice.filter((x) => x.date.match(/-01$|-15$|2026-07-31/))) {
    console.log(`  ${d.date} book=${d.book}%`);
  }
  console.log(`\n实际减仓 fills: ${fills.filter((f) => f.date >= FROM && f.pct < 0).length} 笔`);
  console.log(`W4 B+ 票×日: ${w4.w4BPlusDays} | 零仓可BUILD: ${w4.w4BPlusZeroCouldBuild} | 有仓被STR挡: ${w4.w4BPlusHasPosBlocked}`);
  console.log(`\n报告: ${outMd}`);
}

main();
