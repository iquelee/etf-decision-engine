#!/usr/bin/env node
/**
 * V3.6.4 Gate C —— Swing Parity 报告生成
 *
 * 复用 `scripts/lib/v364-swing-parity.js` 的扫描结果，产出
 * `docs/V364_SWING_PARITY_REPORT.md`（永久 parity gate 的机器可读留痕）。
 *
 * 用法：node scripts/v364-gate-c-swing-parity-report.js
 *
 * ⚠️ 只读：不修改 `trend-stage.js`（Gen-1 冻结件）、不改任何生产参数。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const P = require(path.join(REPO, 'scripts/lib/v364-swing-parity.js'));

const OUT_JSON = path.join(REPO, 'outputs/v364-qualification/swing_parity.json');
const DOC = path.join(REPO, 'docs/V364_SWING_PARITY_REPORT.md');

function main() {
  const scan = P.scanParity({ includeReal: true });
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(scan, null, 1), 'utf8');

  const L = [];
  L.push('# V3.6.4 Gate C —— Swing Parity Report');
  L.push('');
  L.push(`- 生成时间：${scan.generated_at}`);
  L.push('- 被比对的实现：');
  L.push('  - OLD：`src/common/utils/trend-stage.js::swingHighLow`（**Gen-1 冻结件，不得修改/删除**）');
  L.push('  - NEW：`src/common/utils/swing-structure.js::swingHighLow`（R1 的 SlowBreak 修复依赖）');
  L.push('- 扫描口径：对每条 K 线序列枚举**每一个长度 12 的 rolling window**（`bars.slice(i, i+12)`），逐窗口比对');
  L.push('');
  L.push(`## 判定：**${scan.mismatch_count === 0 ? 'PASS' : 'FAIL'}**`);
  L.push('');
  L.push('| 指标 | 值 |');
  L.push('|---|---|');
  L.push(`| **total_windows** | **${scan.total_windows}** |`);
  L.push(`| **mismatch_count** | **${scan.mismatch_count}** |`);
  L.push(`| 共享字段 | ${scan.shared_fields.map((f) => `\`${f}\``).join(' · ')} |`);
  L.push(`| 非共享字段（新实现专有，不参与 parity） | ${scan.non_shared_fields.map((f) => `\`${f}\``).join(' · ')} |`);
  L.push(`| 真实历史窗口 | ${scan.sources.real_history.windows}（5 只生产 ETF） |`);
  L.push(`| 合成语料窗口 | ${scan.sources.synthetic_corpus.windows}（${scan.sources.synthetic_corpus.series_count} 条序列） |`);
  L.push('');
  L.push('要求：**`mismatch_count = 0`**。');
  L.push('');
  L.push('## 数据源');
  L.push('');
  L.push('### 1) 真实历史 K 线（`deliverables/etf_daily_ml_pool/*.qfq.csv`）');
  L.push('');
  L.push('| code | windows | mismatches |');
  L.push('|---|---|---|');
  Object.keys(scan.sources.real_history.per_code).forEach((code) => {
    const s = scan.sources.real_history.per_code[code];
    L.push(`| ${code} | ${s.windows} | ${s.mismatches} |`);
  });
  L.push('');
  if (scan.sources.real_history.unavailable_codes.length) {
    L.push(`- ⚠️ 不可用：\`${scan.sources.real_history.unavailable_codes.join('`, `')}\``);
  }
  L.push('- ⚠️ **`deliverables/` 已 gitignore ⇒ CI 上该源必然 unavailable。**');
  L.push('  因此 CI 的 parity 保障来自下面的确定性合成语料（不伪造真实数据）。');
  L.push('');
  L.push('### 2) 确定性合成语料（CI 上始终可用，保证门禁真实有效）');
  L.push('');
  L.push('| 类别 | 用途 |');
  L.push('|---|---|');
  L.push('| `up_*` / `down_*` / `flat_*` | 单调上涨 / 下跌 / 水平 —— 语义锚定 |');
  L.push('| `tie_*` | 高点或低点严格相等 —— 压 tie 语义（应全 false） |');
  L.push('| `exactly_12` / `len_11` / `empty` | 边界与退化长度 |');
  L.push('| `null_highs` / `null_lows` | 残缺 high/low |');
  L.push('| `random_*` | 确定性 PRNG（不用 `Math.random`）多长度随机游走 |');
  L.push('| `discrete_*` | 离散价格（大量并列值） |');
  L.push('');
  L.push(`序列数：**${scan.sources.synthetic_corpus.series_count}**，窗口数：**${scan.sources.synthetic_corpus.windows}**`);
  L.push('');
  L.push('## 永久门禁');
  L.push('');
  L.push('```');
  L.push('node tests/v364-swing-parity.test.js     # CI Stage A 自动执行（tests/*.test.js）');
  L.push('```');
  L.push('');
  L.push('该测试在默认的 `node scripts/test-all.js` Stage A 里被自动发现并执行，');
  L.push('因此**任何对 `swing-structure.js` 的改动只要让 `higherLow` / `lowerHigh` 漂移，CI 立即失败**。');
  L.push('');
  L.push('## 退化输入');
  L.push('');
  L.push('| case | 两份实现均不抛异常 |');
  L.push('|---|---|');
  scan.sources.degenerate_inputs.forEach((d) => {
    L.push(`| #${d.case_index} | ${d.no_throw ? '✅' : `❌ ${d.error}`} |`);
  });
  L.push('');
  L.push('## 设计说明：为什么允许两份实现并存');
  L.push('');
  L.push('- `trend-stage.js::swingHighLow` 是 `GEN1_FEATURE_PIPELINE_LOCK.json` 钉死的 role 文件');
  L.push('  （`role = trend_stage_implementation`），删它 = 修改冻结工件 ⇒ 必须走重锁 + 审批。');
  L.push('- `swing-structure.js::swingHighLow` 是 R1 修复 SlowBreak 链所必需（提供 `lowerLow`）。');
  L.push('- 二者是**不同函数对象**（测试 `C.3` 断言），共享语义由本 Gate 逐窗口锁定。');
  L.push('- 代价：源码层面仍有两份算法；这是**已登记的残留冲突**（见 `V364_CANDIDATE_QUALIFICATION.md` §未解决风险）。');
  L.push('- 收敛路径（需单独授权，本轮不做）：① 授权重锁后把唯一实现移入 `trend-stage.js`；② 升版 V3.6.5+。');

  fs.mkdirSync(path.dirname(DOC), { recursive: true });
  fs.writeFileSync(DOC, `${L.join('\n')}\n`, 'utf8');

  console.log(`[Gate C] total_windows=${scan.total_windows} mismatch_count=${scan.mismatch_count} `
    + `→ ${scan.mismatch_count === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`[Gate C] 报告：${path.relative(REPO, DOC)}`);
  if (scan.mismatch_count !== 0) process.exit(1);
}

main();
