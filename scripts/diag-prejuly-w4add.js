/**
 * 2026-05~08 · 7月前减仓路径 + W4 下 B+ 试探 ADD 可行性
 * 运行：node scripts/diag-prejuly-w4add.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const decision = require('../cloudfunctions/common/utils/decision.js');
const {
  loadCsv, decideDay, makeSlowResolver, makeCooldown,
  ETFS, START_DATE, TECH_SECTORS
} = require('./backtest-full-engine.js');

const OUT_DIR = path.join(__dirname, 'backtest-out');
const REPORT_DIR = path.join(__dirname, '../回测报告');
const TARGET_CODES = ['513310', '515880', '159582', '518880', '159570'];
const TRACE_FROM = '2026-05-01';
const TRACE_TO = '2026-08-21';
const AUG_START = '2026-08-01';

function replay() {
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
  const fills = [];      // 实际成交
  const decisions = [];  // 区间内决策快照

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
        if (today >= TRACE_FROM && today <= TRACE_TO) {
          fills.push({
            date: today, code, action: ord.action,
            from: Math.round(from * 10) / 10, to: pos.current_position,
            delta: Math.round(diff * 10) / 10
          });
        }
      }
      if (bar) delete pending[code];
    }

    const dayResults = decideDay(barsMap, idx, portfolio, slowResolver, cooldown, tradingDays, 'F3');
    const book = Math.round(ETFS.reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0) * 10) / 10;

    if (today >= TRACE_FROM && today <= TRACE_TO) {
      const row = { date: today, book, codes: {} };
      for (const { code, result } of dayResults) {
        if (!TARGET_CODES.includes(code)) continue;
        const pos = portfolio.positions[code];
        row.codes[code] = {
          action: result.final_action,
          current: pos.current_position,
          suggested: result.suggested_position,
          w: result.w_state,
          h: result.h_state,
          v: result.v_state,
          grade: result.opportunity_grade,
          score: result.opportunity_score,
          addEligibility: result.add_eligibility,
          explain: (result.explain_chain || []).slice(0, 4)
        };
      }
      decisions.push(row);
    }

    for (const { code, result } of dayResults) {
      const pos = portfolio.positions[code];
      pending[code] = {
        target: result.suggested_position != null ? result.suggested_position : pos.current_position,
        core: result.core_position,
        trade: result.trade_position,
        action: result.final_action,
        add_mode: result.add_mode || '无'
      };
    }

    portfolio.techPosition = ETFS.filter((e) => TECH_SECTORS.indexOf(e.sector) >= 0)
      .reduce((s, e) => s + (portfolio.positions[e.code].current_position || 0), 0);
    portfolio.goldPosition = portfolio.positions['518880'].current_position || 0;
    portfolio.drugPosition = portfolio.positions['159570'].current_position || 0;
  }

  return { fills, decisions };
}

function analyzeReducePath(fills, decisions) {
  const byCode = {};
  for (const code of TARGET_CODES) {
    byCode[code] = {
      sells: fills.filter((f) => f.code === code && f.delta < 0),
      buys: fills.filter((f) => f.code === code && f.delta > 0),
      preAugPos: null,
      aug1Pos: null
    };
    const preAug = decisions.filter((d) => d.date < AUG_START && d.date >= '2026-07-01');
    const aug1 = decisions.find((d) => d.date >= AUG_START);
    if (preAug.length) {
      const last = preAug[preAug.length - 1];
      byCode[code].preAugPos = last.codes[code] ? last.codes[code].current : null;
    }
    if (aug1 && aug1.codes[code]) byCode[code].aug1Pos = aug1.codes[code].current;
  }
  return byCode;
}

function analyzeW4BPlusAdd(decisions) {
  const samples = [];
  let w4BPlusTotal = 0;
  let w4BPlusZeroCanBuild = 0;
  let w4BPlusHasPosBlocked = 0;
  let w4BPlusHasPosWouldAdd = 0;

  for (const d of decisions) {
    for (const code of TARGET_CODES) {
      const c = d.codes[code];
      if (!c || c.w !== 'W4') continue;
      if (!['A', 'B'].includes(c.grade)) continue;
      w4BPlusTotal += 1;

      const etf = ETFS.find((e) => e.code === code);
      const w4First = decision.allowsW4AiNetworkFirstLot({
        snapshot: { w_state: c.w },
        positions: { current_position: c.current },
        etf,
        grade: c.grade,
        opportunityScore: c.score
      });

      const smWould = c.current > 0 ? 'STRATEGIC_REDUCE' : (w4First ? 'maybe BUILD/ADD' : 'WAIT');
      const elig = c.addEligibility || {};
      const blocked = Object.entries(elig).filter(([k, v]) => k !== 'overall' && (v === 'pause' || v === 'forbid')).map(([k]) => k);

      if (c.current <= 0) {
        if (w4First) w4BPlusZeroCanBuild += 1;
      } else {
        w4BPlusHasPosBlocked += 1;
        if (elig.overall === 'allow') w4BPlusHasPosWouldAdd += 1;
      }

      if (samples.length < 24 && (c.current <= 0 || c.grade === 'B' || c.grade === 'A')) {
        samples.push({
          date: d.date,
          code,
          sector: etf.sector,
          grade: c.grade,
          score: c.score,
          current: c.current,
          action: c.action,
          smWould,
          w4FirstLot: w4First,
          eligibility: elig.overall,
          blocks: blocked.join('+') || '—',
          h: c.h,
          v: c.v
        });
      }
    }
  }

  return { w4BPlusTotal, w4BPlusZeroCanBuild, w4BPlusHasPosBlocked, w4BPlusHasPosWouldAdd, samples };
}

function monthlyBook(decisions) {
  const months = {};
  for (const d of decisions) {
    const ym = d.date.slice(0, 7);
    if (!months[ym]) months[ym] = { books: [], codes: {} };
    months[ym].books.push(d.book);
    for (const code of TARGET_CODES) {
      if (!d.codes[code]) continue;
      if (!months[ym].codes[code]) months[ym].codes[code] = [];
      months[ym].codes[code].push(d.codes[code].current);
    }
  }
  const out = {};
  for (const [ym, m] of Object.entries(months)) {
    out[ym] = {
      avgBook: Math.round(m.books.reduce((a, b) => a + b, 0) / m.books.length * 10) / 10,
      codes: {}
    };
    for (const code of TARGET_CODES) {
      const arr = m.codes[code] || [];
      if (!arr.length) continue;
      out[ym].codes[code] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10;
    }
  }
  return out;
}

function renderMd(payload, stamp) {
  const L = [];
  L.push(`# V3.9 · 7月前减仓路径 & W4·B+ ADD 诊断（${stamp}）`);
  L.push('');
  L.push(`> 区间：**${TRACE_FROM} ~ ${TRACE_TO}** · 聚焦 8月 book~54% 从何而来`);
  L.push('');

  L.push('## 1. 组合 book 与分票均仓（月）');
  L.push('');
  L.push('| 月份 | 均 book | 513310 | 515880 | 159582 | 518880 | 159570 |');
  L.push('|------|---------|--------|--------|--------|--------|--------|');
  for (const [ym, m] of Object.entries(payload.monthly)) {
    const c = m.codes;
    L.push(`| ${ym} | **${m.avgBook}%** | ${c['513310'] ?? '—'}% | ${c['515880'] ?? '—'}% | ${c['159582'] ?? '—'}% | ${c['518880'] ?? '—'}% | ${c['159570'] ?? '—'}% |`);
  }
  L.push('');

  L.push('## 2. 7月前减仓路径（实际成交 · 卖单）');
  L.push('');
  L.push('按时间序；**delta<0** 为减仓。');
  L.push('');
  for (const code of TARGET_CODES) {
    const etf = ETFS.find((e) => e.code === code);
    const rp = payload.reducePath[code];
    L.push(`### ${code} ${etf.name}`);
    L.push('');
    L.push(`- 7月末仓 → 8月初仓：**${rp.preAugPos ?? '—'}% → ${rp.aug1Pos ?? '—'}%**`);
    L.push(`- 5~7月卖单 **${rp.sells.length}** 笔 · 买单 **${rp.buys.length}** 笔`);
    L.push('');
    if (rp.sells.length) {
      L.push('| 日期 | 动作 | 仓变化 | Δ |');
      L.push('|------|------|--------|---|');
      for (const s of rp.sells) {
        L.push(`| ${s.date} | ${s.action} | ${s.from}→${s.to} | ${s.delta} |`);
      }
    } else {
      L.push('（5~7月无卖单成交）');
    }
    L.push('');
  }

  L.push('## 3. W4 + 机会分 B+ · 能否试探 ADD？');
  L.push('');
  const w = payload.w4add;
  L.push('**当前规则（V3.9）**：');
  L.push('');
  L.push('- **已有仓 + W4** → 状态机 **强制 STRATEGIC_REDUCE**（`runStateMachine` L575-576），**无论 B+ 或闸门是否 allow**');
  L.push('- **零仓 + W4** → 仅 **515880（ai_network）+ A/B** 可走 E3 首仓（`allowsW4AiNetworkFirstLot`）；其余票 **WAIT**');
  L.push('- 闸门 `checkAddEligibility` 对 W4 几乎总是 pause（除 E3 零仓首仓）');
  L.push('');
  L.push('| 统计项 | 次数 |');
  L.push('|--------|------|');
  L.push(`| W4 且 B+ 决策日（五票合计） | **${w.w4BPlusTotal}** |`);
  L.push(`| 零仓 · E3 可 BUILD（仅 515880） | **${w.w4BPlusZeroCanBuild}** |`);
  L.push(`| **已有仓 · 必 STR（ADD 不可能）** | **${w.w4BPlusHasPosBlocked}** |`);
  L.push(`| 已有仓 · 闸门 hypothetically allow（仍被 SM 挡） | ${w.w4BPlusHasPosWouldAdd} |`);
  L.push('');
  L.push('**结论：W4 下「B+ 试探 ADD」对已有仓 = 当前架构下不可行**；仅 515880 零仓首仓例外。');
  L.push('');
  L.push('### W4·B+ 样本日');
  L.push('');
  L.push('| 日期 | 代码 | 分档 | 仓 | 实际动作 | SM 规则 | E3首仓 | 闸门 | 拦截项 |');
  L.push('|------|------|------|-----|----------|---------|--------|------|--------|');
  for (const s of w.samples) {
    L.push(`| ${s.date} | ${s.code} | ${s.grade}/${s.score} | ${s.current}% | ${s.action} | ${s.smWould} | ${s.w4FirstLot ? '✓' : '—'} | ${s.eligibility || '—'} | ${s.blocks} |`);
  }
  L.push('');

  L.push('## 4. 8月轻仓的直接原因（合成）');
  L.push('');
  for (const line of payload.synthesis) L.push(line);
  L.push('');

  L.push('## 5. V4.0 若要做「W4·B+ 试探 ADD」');
  L.push('');
  for (const line of payload.v40) L.push(line);
  L.push('');

  return L.join('\n');
}

function synthesize(fills, decisions, reducePath, monthly) {
  const synthesis = [];
  const jul = monthly['2026-07'];
  const aug = monthly['2026-08'];
  if (jul && aug) {
    synthesis.push(`- **7→8 月 book**：${jul.avgBook}% → ${aug.avgBook}%（${aug.avgBook < jul.avgBook ? '下降' : '上升'}）`);
  }

  const julSells = fills.filter((f) => f.date.startsWith('2026-07') && f.delta < 0);
  synthesis.push(`- **7 月卖单成交**：${julSells.length} 笔（全票合计）`);
  if (julSells.length) {
    const byCode = {};
    for (const s of julSells) {
      byCode[s.code] = (byCode[s.code] || 0) + 1;
    }
    synthesis.push(`- 7 月减仓票：${Object.entries(byCode).map(([k, v]) => `${k}×${v}`).join('、')}`);
  }

  const bigDrop = fills.filter((f) => f.delta <= -3 && f.date >= '2026-05-01' && f.date < AUG_START);
  if (bigDrop.length) {
    synthesis.push('- **5~7 月单笔 ≥3pp 减仓**：');
    for (const s of bigDrop.slice(0, 12)) {
      synthesis.push(`  - ${s.date} ${s.code} ${s.action} ${s.from}→${s.to}（Δ${s.delta}）`);
    }
  }

  for (const code of ['513310', '515880', '518880']) {
    const rp = reducePath[code];
    if (rp.preAugPos != null && rp.preAugPos < 15) {
      synthesis.push(`- **${code}** 进 8 月仅 ~${rp.aug1Pos ?? rp.preAugPos}%：主因是 **5~7 月已卖/未买回**，非 8 月新砍`);
    }
  }

  const v40 = [
    '1. **已有仓 W4·B+ ADD**：需改 `runStateMachine`——W4 不再一律 STR，改为「减至核心仓下限 / 允许 +1 步 ADD」；必须 OOS + S4 压力窗。',
    '2. **518880 黄金 W4**：8 月是空转 STR（9.5→9.5）；若要做 ADD，要么 W 修复回 W3，要么单独 gold 域规则（风险高于 E3）。',
    '3. **515880 已有仓 ~9%**：W4 STR 链 + 目标仓低；E3 只帮零仓，**有仓后仍 STR**——与 2025-06 踏空同类。',
    '4. **513310 remnantRebuild**（V3.6）：W3+≤8% 可重建；7 月 P3 砍到 ~5% 后若 W 仍 W4/W3+C，加不回去。',
    '5. 优先实验：**W4+current≤核心仓 且 B+ → HOLD 而非 STR**（只停减、不强制加），比全面放开 ADD 更安全。'
  ];

  return { synthesis, v40 };
}

function main() {
  const { fills, decisions } = replay();
  const reducePath = analyzeReducePath(fills, decisions);
  const w4add = analyzeW4BPlusAdd(decisions);
  const monthly = monthlyBook(decisions);
  const { synthesis, v40 } = synthesize(fills, decisions, reducePath, monthly);

  const stamp = new Date().toISOString().slice(0, 10);
  const payload = { reducePath, w4add, monthly, fills, synthesis, v40 };
  const outJson = path.join(OUT_DIR, `diag-prejuly-w4add-${stamp}.json`);
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const md = renderMd({ reducePath, w4add, monthly, synthesis, v40 }, stamp);
  const outMd = path.join(REPORT_DIR, `V3.9-7月前减仓与W4-ADD诊断-${stamp}.md`);
  fs.writeFileSync(outMd, md, 'utf8');

  console.log('7月卖单:', fills.filter((f) => f.date.startsWith('2026-07') && f.delta < 0).length);
  console.log('W4 B+ 日:', w4add.w4BPlusTotal, '| 已有仓必STR:', w4add.w4BPlusHasPosBlocked);
  console.log(`\n报告: ${outMd}`);
}

main();
