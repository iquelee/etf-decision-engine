'use strict';
/**
 * Gen-2 跨语言 Parity —— Node 端 runner。
 * 通过 vm 加载 runGen2ShadowEod/index.js，调用其纯决策函数（exports._internal），
 * 对 fixtures/gen2/parity_fixture.json 跑「评分→排名→角色→组合→防守」全链，输出 canonical JSON。
 *
 * 运行：node scripts/parity/run_node.js [fixture.json]
 * 输出：stdout 打印 canonical JSON（供 compare.py 比对）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..', 'cloudfunctions', 'runGen2ShadowEod');
const SRC_COMMON = path.resolve(__dirname, '..', '..', 'src', 'common');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

const fixturePath = process.argv[2] || path.resolve(__dirname, '..', '..', 'fixtures', 'gen2', 'parity_fixture.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function loadInternal() {
  const db = { query: async () => [], upsert: async () => {} };
  const box = {
    exports: {},
    require: (p) => {
      if (p === 'fs') return require('fs');
      if (p === 'path') return require('path');
      if (p === 'crypto') return require('crypto');
      if (p === './common/utils/db') return db;
      if (p.startsWith('./common/')) return require(path.join(SRC_COMMON, p.replace(/^\.\/common\//, '')));
      return require(path.join(ROOT, p));
    },
    Date,
    console,
  };
  vm.runInNewContext(SOURCE, box);
  return box.exports._internal;
}

const I = loadInternal();

// 深拷贝 features（内部函数会原地 mutate）
const features = fixture.features.map((r) => ({ ...r }));

// 评分（加入 trend/rs/alpha/trend_gate/market_score/regime）→ 排名 → 角色 → 组合 → 防守
I.computeLeadershipScore(features);
I.rankFeatures(features);
const roles = I.buildDailyRoles(features);
const candidates = I.buildPortfolioCandidates(roles);
const benchmarkFeatures = fixture.benchmark;
const defended = I.applyDefense(candidates, features, benchmarkFeatures);

// canonical 输出（与 Python runner 的 canonical schema 对齐）
const out = defended.map((r) => ({
  code: r.code,
  trade_date: r.trade_date,
  rank: r.rank,
  rank_percentile: r.rank_percentile,
  leadership_score: r.leadership_score,
  alpha_score_v2: r.alpha_score_v2,
  trend_score: r.trend_score,
  rs_score: r.rs_score,
  trend_gate: !!r.trend_gate,
  regime: r.regime || 'RANGE',
  proposed_role: r.proposed_role,
  role: r.role,
  target_weight: r.target_weight,
  defense_state: r.defense_state,
}));

// 按 (trade_date, code) 稳定排序，便于逐行 diff
out.sort((a, b) => (a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : a.code < b.code ? -1 : 1));

process.stdout.write(JSON.stringify(out, null, 2));
