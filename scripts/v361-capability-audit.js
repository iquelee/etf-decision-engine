#!/usr/bin/env node
/**
 * V3.6.1 能力审计（只读）
 *
 * 不回测调参、不调用 CloudBase、不修改线上决策。报告仅汇总已经冻结的
 * walk-forward / OOS / 归因验证，并核验 V3.6.1 冻结清单与实现边界。
 *
 * 运行：node scripts/v361-capability-audit.js
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'ml', 'diagnostics');
const STAMP = new Date().toISOString().slice(0, 10);

const sources = {
  manifest: 'ml/manifests/ENGINE_V361_v1.json',
  walkForward: '回测报告/V4.3-walk-forward-2026-08-25.md',
  attribution: '回测报告/V4.3-WF仓位vs选择归因-2026-08-25.md',
  oosAttribution: '回测报告/V4.3-OOS跑输归因-隐杠杆假设-2026-08-25.md',
  regimeSuite: '回测报告/V4.3-regime-suite-2026-08-25.md',
  productionMerge: 'cloudfunctions/common/utils/v3-shadow.js',
  decisionTest: 'tests/decision.test.js',
  extendedTest: 'tests/phase1.test.js'
};

function read(rel) {
  const absolute = path.join(ROOT, rel);
  if (!fs.existsSync(absolute)) throw new Error(`审计证据缺失：${rel}`);
  return fs.readFileSync(absolute, 'utf8');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function required(text, fragment, rel) {
  if (!text.includes(fragment)) throw new Error(`证据 ${rel} 不包含预期片段：${fragment}`);
}

function stat(status, conclusion, evidence, limitation) {
  return { status, conclusion, evidence, limitation: limitation || null };
}

function main() {
  const raw = Object.fromEntries(Object.entries(sources).map(([k, p]) => [k, read(p)]));
  const manifest = JSON.parse(raw.manifest);

  if (manifest.engine_version !== 'v3.6.1' || manifest.immutable !== true || manifest.state !== 'FROZEN') {
    throw new Error('ENGINE_V361_v1 不满足 v3.6.1 / immutable / FROZEN 审计前提');
  }
  required(raw.productionMerge, "engine_version: trendStageEnabled === true ? shadowEngine : 'v3.8'", sources.productionMerge);
  required(raw.productionMerge, "return 'v3.6.1'", sources.productionMerge);
  required(raw.walkForward, '平均 gap **−5.33pp** · 跑赢等权 **1/4 折**', sources.walkForward);
  required(raw.attribution, '仓位效应 **-29.15pp** + 选择效应 **7.82pp**', sources.attribution);
  required(raw.oosAttribution, 'OOS 去杠杆后仍跑输：**6/7**', sources.oosAttribution);
  required(raw.oosAttribution, 'OOS 上涨日超额Σ为负：**7/7**', sources.oosAttribution);
  required(raw.oosAttribution, 'OOS 下跌日超额Σ为正：**7/7**', sources.oosAttribution);
  required(raw.regimeSuite, '| 三票 2024→主窗前 | 2024-01-02 ~ 2025-02-24 | 274 | 19.71 | 42.98 | -23.27 |', sources.regimeSuite);
  required(raw.regimeSuite, '| 三票 2022–2024 | 2023-03-24 ~ 2024-12-31 | 431 | 13.14 | 35.12 | -21.98 |', sources.regimeSuite);

  const evidenceFiles = Object.fromEntries(Object.entries(sources).map(([key, rel]) => [key, {
    path: rel,
    sha256: sha256(raw[key])
  }]));

  const audit = {
    audit_id: `V361_CAPABILITY_AUDIT_${STAMP}`,
    audited_at: new Date().toISOString(),
    scope: 'V3.6.1 frozen rule/position engine; read-only evidence audit. No parameter, strategy, model, CloudBase, or deployment change.',
    engine: {
      manifest_id: manifest.manifest_id,
      engine_version: manifest.engine_version,
      sealed_at: manifest.sealed_at,
      immutable: manifest.immutable,
      state: manifest.state,
      production_role: manifest.role,
      boundaries: manifest.scope
    },
    scorecard: {
      reproducibility: stat(
        'WARN',
        '冻结清单与线上 V3.6.1 路由存在；但清单未固定代码/配置内容哈希，无法仅凭 manifest 证明历史回测二进制与当前线上代码逐字相同。',
        ['ENGINE_V361_v1.json: immutable=true, state=FROZEN', 'v3-shadow.js: production route resolves engine_version=v3.6.1 when V3.6.1 bundle is enabled'],
        '应新增版本钉住的参数快照、代码 SHA-256、数据快照 SHA-256 与 anchor replay 测试；本审计不修改它们。'
      ),
      core_logic: stat(
        'PASS_WITH_SCOPE',
        '核心决策单测已验证 8/8 通过：机会分归一化、风险暂停、赛道上限、超配、冷静期、F5 证伪、突破前置、数据不完整 WAIT。',
        ['tests/decision.test.js run on 2026-09-04: 8 passed / 0 failed'],
        '全量 phase1.test.js 当次为 28 passed / 5 failed；失败项包含 V3.9、V4.2/V4.2b 预期，与冻结 V3.6.1 基线混在同一文件，不能作为 V3.6.1 的干净回归门。'
      ),
      economic_value_vs_equal_weight: stat(
        'FAIL_FOR_BROAD_OUTPERFORMANCE_CLAIM',
        '没有足够证据支持“稳定跑赢等权”的能力主张。四折 walk-forward 平均 gap -5.33pp，仅 1/4 折跑赢；去杠杆后 6/7 OOS 窗仍跑输。',
        ['WF1 -8.26pp, WF2 -8.58pp, WF3 -11.20pp, WF4 +6.71pp', '长 OOS 147 日 -8.79pp（去杠杆 -9.34pp）', '三票 2024 -23.27pp；三票 2022–2024 -21.98pp'],
        '五票主窗 +3.80pp 含约 +4.93pp 隐杠杆贡献；去杠杆主窗 -1.13pp，不能作为独立泛化证据。'
      ),
      downside_control: stat(
        'PARTIAL_PASS',
        '防守方向有一致证据：7/7 OOS 窗下跌日超额加总为正；四个 WF 中 3 个引擎最大回撤低于等权。',
        ['OOS down-day excess sum positive: 7/7', 'WF max drawdown: 1 -8.91% vs -10.34%, 2 -9.06% vs -13.82%, 3 -9.58% vs -9.01%, 4 -14.35% vs -20.64%'],
        '并非每个窗口都降低回撤（WF3 较等权高 0.57pp）；该能力应表述为“有防守倾向、尚未证明稳定”。'
      ),
      selection_and_timing: stat(
        'PARTIAL_PASS',
        '四折归因显示选择效应合计 +7.82pp，但仓位效应 -29.15pp，说明选股/结构判断有正向迹象，整体却被牛市欠暴露压过。',
        ['WF aggregate gap -21.33pp = exposure -29.15pp + selection +7.82pp', 'WF4 selection +10.06pp, total gap +6.71pp'],
        '归因是回测分解而非因果证明；尚没有独立多 universe 的正 alpha 复现。'
      ),
      trend_capture: stat(
        'FAIL_FOR_PERSISTENT_RALLY_CAPTURE',
        '7/7 OOS 窗上涨日超额加总为负，涨日 beta proxy 约 0.55–0.86；系统性问题是资格闸门与目标仓上限造成的上涨欠暴露。',
        ['2024-09-24 to 2024-10-08: equal weight +27.48%, engine +12.06%, average book 66.3%', 'OOS attribution rejects hidden leverage as primary cause and identifies under_exposure_on_up_days'],
        '这符合冻结策略“防守 + 选股”定位，不应把它用于承诺持续牛市跟随。'
      ),
      live_validation: stat(
        'PENDING',
        'V3.6.1 于 2026-08-29 切为正式基线，当前真实线上观察期不足以判断长期能力。',
        ['promote-v361-cutover.js sets config_version=2026-08-29-v361-cutover', 'audit date 2026-09-04'],
        '需要在不改规则前提下持续记录日级目标、实际参考组合、等权基准、回撤、市场 Regime 及人工执行差异。'
      )
    },
    verified_metrics: {
      tuning_window_not_oos: {
        window: '2025-02-25 ~ 2026-08-21',
        engine_return_pct: 126.46,
        equal_weight_return_pct: 122.66,
        sticky_gap_pp: 3.8,
        unlevered_return_pct: 121.53,
        unlevered_gap_pp: -1.13,
        max_drawdown_pct: 14.73,
        sharpe: 2.25,
        days_book_over_100: 101,
        leverage_contribution_pp: 4.93
      },
      walk_forward: [
        { fold: 'WF1', window: '2024-07-15 ~ 2025-01-20', engine_pct: 9.93, equal_weight_pct: 18.19, gap_pp: -8.26, engine_mdd_pct: -8.91, equal_weight_mdd_pct: -10.34 },
        { fold: 'WF2', window: '2025-01-21 ~ 2025-08-01', engine_pct: 20.42, equal_weight_pct: 29.0, gap_pp: -8.58, engine_mdd_pct: -9.06, equal_weight_mdd_pct: -13.82 },
        { fold: 'WF3', window: '2025-08-04 ~ 2026-02-09', engine_pct: 44.69, equal_weight_pct: 55.89, gap_pp: -11.20, engine_mdd_pct: -9.58, equal_weight_mdd_pct: -9.01 },
        { fold: 'WF4', window: '2026-02-10 ~ 2026-08-24', engine_pct: 24.19, equal_weight_pct: 17.48, gap_pp: 6.71, engine_mdd_pct: -14.35, equal_weight_mdd_pct: -20.64 }
      ],
      oos_long_and_independent_series: [
        { series: 'long OOS', days: 147, sticky_gap_pp: -8.79, unlevered_gap_pp: -9.34 },
        { series: 'three ETF 2024 to main window', days: 274, engine_pct: 19.71, equal_weight_pct: 42.98, gap_pp: -23.27 },
        { series: 'three ETF 2022-2024', days: 431, engine_pct: 13.14, equal_weight_pct: 35.12, gap_pp: -21.98 },
        { series: 'two ETF 2022-2024', days: 726, engine_pct: 12.45, equal_weight_pct: 47.28, gap_pp: -34.83 }
      ]
    },
    overall_verdict: {
      rating: 'CONDITIONALLY_USEFUL_AS_DEFENSIVE_REFERENCE; NOT_VALIDATED_AS_BROAD_RETURN_OUTPERFORMER',
      suitable_for: ['风险/仓位纪律参考', '震荡或风险期的防守性候选', '与 Gen-1 advisory 并列留痕比较'],
      unsuitable_for: ['宣称稳定跑赢等权', '持续牛市的满参与捕获', '仅凭 126.46% 调参主窗证明泛化', '自动化交易授权'],
      decision: '维持冻结；不因审计结果修改 V3.6.1 规则。后续以真实 OOS、版本化回放和独立 universe 验证决定是否产生下一代候选。'
    },
    evidence_files: evidenceFiles
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, `v361_capability_audit_${STAMP}.json`);
  const mdPath = path.join(REPORT_DIR, `v361_capability_audit_${STAMP}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(audit, null, 2) + '\n');

  const L = [
    `# V3.6.1 能力审计（${STAMP}）`,
    '',
    '> 范围：冻结 V3.6.1 规则/仓位引擎；只读审计，不调参、不改策略、不调用 CloudBase、不部署。',
    '',
    '## 结论',
    '',
    `**${audit.overall_verdict.rating}**`,
    '',
    'V3.6.1 可以继续作为“风险/仓位纪律参考”的冻结基线；但现有证据不支持把它表述为“稳定跑赢等权”或“持续牛市捕获器”。其明确、可复现的长处是下跌日的相对防守倾向；明确短板是上涨阶段的系统性欠暴露。',
    '',
    '## 一页计分卡',
    '',
    '| 项目 | 结论 | 说明 |',
    '|---|---|---|',
    '| 冻结/可追溯 | WARN | 有冻结 manifest 和线上版本路由，但没有代码、参数、数据内容哈希。 |',
    '| 核心逻辑 | PASS_WITH_SCOPE | 8 个 V3 核心决策测试通过；全量 phase1 测试混有后续版本断言，5 项失败，不能充当 V3.6.1 纯回归门。 |',
    '| 相对等权经济价值 | FAIL | WF 平均 -5.33pp、仅 1/4 折胜；去杠杆后 6/7 OOS 仍跑输。 |',
    '| 下行控制 | PARTIAL_PASS | 7/7 OOS 下跌日超额为正；四折中 3 折 MDD 更低。 |',
    '| 选择/择时 | PARTIAL_PASS | 四折选择效应 +7.82pp，仓位效应 -29.15pp。 |',
    '| 持续上涨捕获 | FAIL | 7/7 OOS 上涨日超额为负；924 窗等权 +27.48%、引擎 +12.06%。 |',
    '| 真实线上 OOS | PENDING | 2026-08-29 切为正式基线，观察期尚短。 |',
    '',
    '## 调参窗与 OOS 必须分开',
    '',
    '| 证据 | 引擎 | 等权 | gap | 解释 |',
    '|---|---:|---:|---:|---|',
    '| 五票主窗（调参窗） | 126.46% | 122.66% | +3.80pp | 含约 +4.93pp 隐杠杆；去杠杆后为 -1.13pp，不是独立泛化证据。 |',
    '| WF1 | 9.93% | 18.19% | -8.26pp | MDD 较等权低。 |',
    '| WF2 | 20.42% | 29.00% | -8.58pp | MDD 较等权低。 |',
    '| WF3 | 44.69% | 55.89% | -11.20pp | MDD 略高于等权。 |',
    '| WF4 | 24.19% | 17.48% | +6.71pp | 唯一正 gap，且 MDD 较等权低。 |',
    '',
    '## 可落地的后续验收（仍不改 V3.6.1）',
    '',
    '1. 每日冻结并记录：`engine_version`、`config_version`、参数 hash、代码 hash、输入行情 hash、每票 Stage/Target/Action、等权净值。',
    '2. 每 20 个交易日输出滚动报告：相对等权 alpha、MaxDD、下跌日/上涨日超额、平均仓位、Gen-1 与 V3.6.1 分歧。',
    '3. 补一套 **V3.6.1 专属** anchor replay：固定输入快照必须得到固定 Stage/Target/Action；不要再用混有 V3.9/V4.2 断言的总测试替代。',
    '4. 真正要提升上涨捕获，只能新开候选版本并全轮 OOS；不能回写或微调冻结 V3.6.1。',
    '',
    '## 证据边界',
    '',
    '本报告引用现存的冻结回测报告与代码。回测输出 JSON 已不在当前源码包中，因此本次对性能数字做的是**证据一致性审计**，不是从原始逐日 NAV 重新计算。若要把“可追溯”提升到 PASS，需要保存原始 NAV/交易日志与数据快照。',
    '',
    `结构化数据：[${path.basename(jsonPath)}](${jsonPath.replace(/\\/g, '/')})`
  ];
  fs.writeFileSync(mdPath, L.join('\n') + '\n');
  console.log(JSON.stringify({ verdict: audit.overall_verdict.rating, jsonPath, mdPath }, null, 2));
}

main();
