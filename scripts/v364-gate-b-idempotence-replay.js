#!/usr/bin/env node
/**
 * V3.6.4 Safety Hardening —— Gate B：Same-Day Idempotence Full-chain Replay
 *
 * 不是纯函数测试：用**真实生产链状态**模拟「同一天被重复触发」。
 *
 * 变体 A（RUN_ONCE）：每个交易日只运行 1 次。
 * 变体 B（RUN_3X）  ：每个交易日连续运行 3 次，三次使用**相同** `snapshot.calc_date`。
 *
 * 逐日比较（覆盖最近 120 个五票共同交易日 × 5 只 ETF）：
 *   trend_stage_primary / trend_stage_overlay / pendingStage / pendingDays /
 *   days_in_stage / soft_down_days / s5_risk_days / breakout_level /
 *   final_target / final_action
 * 以及每只 ETF 的**日末状态**（除运行审计字段外必须完全一致）。
 *
 * 用法：node scripts/v364-gate-b-idempotence-replay.js [--days 120] [--runs 3]
 * 产物：docs/V364_IDEMPOTENCE_REPLAY.md  +  outputs/v364-qualification/idempotence_replay.json
 *
 * ⚠️ 只读：不联网、不写库、不部署、不改任何生产参数。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const H = require('./lib/v364-replay-harness.js');

const REPO = H.REPO;
const OUT_DIR = path.join(REPO, 'outputs/v364-qualification');
const DOC = path.join(REPO, 'docs/V364_IDEMPOTENCE_REPLAY.md');

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : dflt;
}
const DAYS = Number(argOf('--days', 120));
const RUNS = Number(argOf('--runs', 3));

/** Gate B 判定比较的决策字段（任务书指定） */
const DECISION_FIELDS = [
  'trend_stage_primary', 'trend_stage_overlay', 'pendingStage', 'pendingDays',
  'days_in_stage', 'soft_down_days', 's5_risk_days', 'breakout_level',
  'final_target', 'final_action'
];

/** 允许不同的「运行审计字段」（不参与生产决策） */
const AUDIT_FIELDS = ['last_evaluated_trade_date', 'day_start_state', 'trade_date_anchored', 'idempotence_reason'];

function stable(v) {
  return JSON.stringify(v, Object.keys(v || {}).sort());
}

function main() {
  console.log(`[Gate B] 载入真实数据 & 重放 RUN_ONCE vs RUN_${RUNS}X（最近 ${DAYS} 个共同交易日）…`);
  const t0 = Date.now();
  const probe = H.replay({ runsPerDay: 1 });
  const axis = probe.axis.slice(-DAYS);
  const from = axis[0];
  const to = axis[axis.length - 1];

  const once = H.replay({ from, to, runsPerDay: 1 });
  const thrice = H.replay({ from, to, runsPerDay: RUNS, collectRuns: true });
  console.log(`[Gate B] 重放完成：${once.axis.length} 天 × 5 票 × (1+${RUNS}) 次，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  /* ---- 1) 逐日决策字段比对 ---- */
  const dayDrifts = [];
  once.axis.forEach((d, i) => {
    H.UNIVERSE.forEach((u) => {
      const a = once.days[i].byCode[u.code];
      const b = thrice.days[i].byCode[u.code];
      DECISION_FIELDS.forEach((f) => {
        if (stable(a[f]) !== stable(b[f])) {
          dayDrifts.push({ trade_date: d, code: u.code, field: f, run_once: a[f], run_nx: b[f] });
        }
      });
    });
  });

  /* ---- 2) 同日内部漂移（第 1 次 vs 第 N 次） ---- */
  const intraDayDrifts = thrice.runDiffs.filter((r) => r.drift_count > 0);

  /* ---- 3) 日末状态比对 ---- */
  const stateDrifts = [];
  const auditDiff = [];
  H.UNIVERSE.forEach((u) => {
    const a = once.finalState[u.code] || {};
    const b = thrice.finalState[u.code] || {};
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    keys.forEach((k) => {
      if (stable(a[k]) !== stable(b[k])) {
        if (AUDIT_FIELDS.indexOf(k) >= 0) {
          auditDiff.push({ code: u.code, field: k, run_once: a[k], run_nx: b[k] });
        } else {
          stateDrifts.push({ code: u.code, field: k, run_once: a[k], run_nx: b[k] });
        }
      }
    });
  });

  const bookDrifts = H.UNIVERSE
    .filter((u) => stable(once.finalBook[u.code]) !== stable(thrice.finalBook[u.code]))
    .map((u) => ({ code: u.code, run_once: once.finalBook[u.code], run_nx: thrice.finalBook[u.code] }));

  const verdict = (dayDrifts.length === 0 && intraDayDrifts.length === 0
    && stateDrifts.length === 0 && bookDrifts.length === 0) ? 'PASS' : 'FAIL';

  const result = {
    generated_at: new Date().toISOString(),
    from, to, days: once.axis.length, runs_per_day_variant_b: RUNS,
    universe: H.UNIVERSE.map((u) => u.code),
    compared_fields: DECISION_FIELDS,
    audit_fields_allowed_to_differ: AUDIT_FIELDS,
    verdict,
    counts: {
      compared_day_code_pairs: once.axis.length * H.UNIVERSE.length,
      compared_field_checks: once.axis.length * H.UNIVERSE.length * DECISION_FIELDS.length,
      day_drift_count: dayDrifts.length,
      intra_day_drift_dates: intraDayDrifts.length,
      state_drift_count: stateDrifts.length,
      book_drift_count: bookDrifts.length,
      audit_field_diffs: auditDiff.length
    },
    day_drifts: dayDrifts.slice(0, 50),
    intra_day_drift_samples: intraDayDrifts.slice(0, 10),
    state_drifts: stateDrifts.slice(0, 50),
    book_drifts: bookDrifts,
    audit_field_diff_samples: auditDiff.slice(0, 20),
    // 便于人工抽样的逐日状态轨迹（每 20 天一个采样）
    state_trajectory_sample: once.axis.filter((_, i) => i % 20 === 0).map((d, k) => {
      const idx = once.axis.indexOf(d);
      return {
        trade_date: d,
        per_code: H.UNIVERSE.reduce((acc, u) => {
          const a = once.days[idx].byCode[u.code];
          acc[u.code] = {
            stage: `${a.trend_stage_primary}/${a.trend_stage_overlay}`,
            pending: `${a.pendingStage || '-'}:${a.pendingDays}`,
            days_in_stage: a.days_in_stage,
            soft_down_days: a.soft_down_days,
            s5_risk_days: a.s5_risk_days,
            target: a.final_target,
            action: a.final_action
          };
          return acc;
        }, {})
      };
    })
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'idempotence_replay.json'), JSON.stringify(result, null, 1), 'utf8');

  /* ---- 报告 ---- */
  const L = [];
  L.push('# V3.6.4 Gate B —— Same-Day Idempotence Full-chain Replay');
  L.push('');
  L.push(`- 生成时间：${result.generated_at}`);
  L.push(`- 区间：**${from} ~ ${to}**（${once.axis.length} 个五票共同交易日）`);
  L.push(`- universe：${result.universe.join(', ')}`);
  L.push(`- 变体 A（RUN_ONCE）：每个交易日运行 **1** 次`);
  L.push(`- 变体 B（RUN_${RUNS}X）：每个交易日连续运行 **${RUNS}** 次，三次使用**相同** \`snapshot.calc_date\``);
  L.push('- 完整生产链状态：`trend_stage_state` / `shock_state` / `slow_break_history` / 组合账面 / 科技赛道额度全部按生产调用序列滚动');
  L.push('- 幂等机制：`planRunInput` / `finalizeState`（与 `runDecisionEngine` 接线同构）');
  L.push('');
  L.push(`## 判定：**${verdict}**`);
  L.push('');
  L.push('| 比较 | 规模 | 漂移数 | 结论 |');
  L.push('|---|---|---|---|');
  L.push(`| 逐日 × 逐票 × ${DECISION_FIELDS.length} 个决策字段 | ${result.counts.compared_field_checks} 次字段比对 | **${dayDrifts.length}** | ${dayDrifts.length === 0 ? 'PASS' : 'FAIL'} |`);
  L.push(`| 同日内部（第 1 次 vs 第 ${RUNS} 次）逐字段 | ${once.axis.length} 天 | **${intraDayDrifts.length}** | ${intraDayDrifts.length === 0 ? 'PASS' : 'FAIL'} |`);
  L.push(`| 日末状态（非审计字段） | 5 票全量字段 | **${stateDrifts.length}** | ${stateDrifts.length === 0 ? 'PASS' : 'FAIL'} |`);
  L.push(`| 日末账面（suggested_position 滚动） | 5 票 | **${bookDrifts.length}** | ${bookDrifts.length === 0 ? 'PASS' : 'FAIL'} |`);
  L.push('');
  L.push('比较字段：');
  L.push('');
  L.push('```');
  L.push(DECISION_FIELDS.join(', '));
  L.push('```');
  L.push('');
  L.push('允许不同的运行审计字段（不参与生产决策）：');
  L.push('');
  L.push('```');
  L.push(AUDIT_FIELDS.join(', '));
  L.push('```');
  L.push('');
  L.push(`> 审计字段实际差异条数：**${auditDiff.length}**。`);
  L.push('>');
  L.push(`> **这是预期且必需的**：RUN_ONCE 的最后一次运行是 \`new_trade_date\`，RUN_${RUNS}X 的最后一次运行是 \`same_trade_date_replay\` ——`);
  L.push('> 这条差异正是「第 2/3 次确实走了同日重放路径」的**正面证据**。');
  L.push(`> 预期条数 = 5（每只 ETF 一条）。实测 ${auditDiff.length} 条。`);
  if (auditDiff.length) {
    L.push('>');
    L.push('| code | field | RUN_ONCE | RUN_' + RUNS + 'X |');
    L.push('|---|---|---|---|');
    auditDiff.forEach((d) => {
      L.push(`| ${d.code} | ${d.field} | \`${d.run_once}\` | \`${d.run_nx}\` |`);
    });
  }
  L.push('');
  if (dayDrifts.length) {
    L.push('## 漂移明细（前 50 条）');
    L.push('');
    L.push('| trade_date | code | field | RUN_ONCE | RUN_' + RUNS + 'X |');
    L.push('|---|---|---|---|---|');
    dayDrifts.slice(0, 50).forEach((d) => {
      L.push(`| ${d.trade_date} | ${d.code} | ${d.field} | ${JSON.stringify(d.run_once)} | ${JSON.stringify(d.run_nx)} |`);
    });
    L.push('');
  }
  L.push('## 状态轨迹抽样（每 20 个交易日）');
  L.push('');
  L.push('| trade_date | 513310 | 515880 | 159582 | 518880 | 159570 |');
  L.push('|---|---|---|---|---|---|');
  result.state_trajectory_sample.forEach((s) => {
    const cell = (c) => `${s.per_code[c].stage} p${s.per_code[c].pending} d${s.per_code[c].days_in_stage} sd${s.per_code[c].soft_down_days} r${s.per_code[c].s5_risk_days} T${s.per_code[c].target} ${s.per_code[c].action}`;
    L.push(`| ${s.trade_date} | ${cell('513310')} | ${cell('515880')} | ${cell('159582')} | ${cell('518880')} | ${cell('159570')} |`);
  });
  L.push('');
  L.push('## 方法学边界');
  L.push('');
  L.push('- 重放的是**完整生产调用序列**（状态/账面/赛道额度滚动），不是纯函数单测。');
  L.push('- `indicator_snapshot` 由真实 OHLCV 经 `indicators.computeSnapshot` 重推导；A/B 两变体使用**完全相同**的输入序列。');
  L.push('- 本 Gate 只能证明「同一天重复运行不产生漂移」，不能证明「跨日语义正确」；跨日语义由 Gate A 与单测共同覆盖。');

  fs.mkdirSync(path.dirname(DOC), { recursive: true });
  fs.writeFileSync(DOC, `${L.join('\n')}\n`, 'utf8');

  console.log(`[Gate B] verdict=${verdict}`);
  console.log(JSON.stringify(result.counts, null, 1));
  console.log(`[Gate B] 报告：${path.relative(REPO, DOC)}`);
}

main();
