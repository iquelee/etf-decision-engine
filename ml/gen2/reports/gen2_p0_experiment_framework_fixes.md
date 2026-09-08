# Gen-2 P0 实验框架修复报告（先修「实验真相」）

**日期**：2026-09-05
**范围**：源码审查后的第一阶段修复（不调权重、不调防守参数）
**结论**：五个实验框架问题已修复，**修正了两个此前错误的归因结论**，为 Rule V2 重构打好了地基。

---

## 一、修复清单

| # | 问题 | 修复 | 文件 |
|---|---|---|---|
| 1 | attribution 用 undefended 结果做归因（-94.6% 实为无防守版） | 区分 undefended / defended，新增真实 `defense_state` 归因 | `evaluation/attribution.py` |
| 2 | 三套 Risk-off 定义混用（60/40、55/45、MA60<-2%） | 新增 `regime.py` 单一契约，三处统一到 market_score 55/45 | `portfolio/regime.py` + 三处 |
| 3 | T+1 执行含隔夜 lookahead | 改 T+1 收盘执行（ret_1d 滞后一天），弃用 qfq 失真的 open | `backtest/rotation_backtest.py` 等 |
| 4 | Main5 benchmark 幸存者偏差（未上市填 0=现金） | 改 PIT 等权（只对当日已上市有历史的 Main5 重归一化） | `backtest/benchmark.py` |
| 5 | （线上）Node 版缺 PIT eligibility + 配置各说一套 | 见「五、遗留项」，本轮未动线上 | — |

---

## 二、Component-level Rank IC（复现报告核心论断）

对 30 只 universe，逐因子算 20D Rank IC：

| 因子 | Rank IC | 性质 |
|---|---:|---|
| **rs_score** | **+0.032** | Alpha（正向） |
| **breakout_approach_score** | **+0.031** | Alpha（正向） |
| **trend_score** | **+0.027** | Alpha（正向） |
| leadership_score（合成） | +0.0023 | **正负抵消** |
| liquidity_score | -0.005 | ≈0 |
| momentum_accel_score | -0.022 | 负向 |
| volatility_quality_score | -0.031 | 风险（负向） |
| diversification_score_v1 | -0.031 | 组合（负向） |
| stage_quality | -0.045 | 负向 |
| consolidation_score_v1 | -0.056 | 负向 |

**铁证：RS/Breakout/Trend 三个 Alpha 因子有正 IC，但被 Volatility/Diversification/Stage/Consolidation 四个风险/组合因子负向抵消，合成后 ≈0。** 这正是「把找赢家(Alpha)和控风险(Utility)混成一个分」的后果。

## 三、分 regime 的 Rank IC（统一契约后）

| regime | n_days | Rank IC mean | IC>0 占比 |
|---|---:|---:|---:|
| RISK_ON | 754 | **+0.075** | 58.1% |
| RANGE | 190 | +0.016 | 51.6% |
| RISK_OFF | 675 | **-0.083** | 42.5% |

**铁证：Gen-2 不是不会选，而是「RISK_ON 会选、RISK_OFF 反着选」。** 这直接支撑引入 `Selection Permission`（RISK_OFF 关闭进攻性 Ranking）。

## 四、修正后的归因结论

### 4.1 Defense Gate 有效（修正「-94.6% 证明防守失效」的误判）

按**真实 defense_state**（统一契约）拆分，T+1 收盘执行口径：

| defense_state | 天数 | undefended | defended | main5(PIT) |
|---|---:|---:|---:|---:|
| NORMAL（未触发） | 1151 | +36.2% | +45.9% | +106.2% |
| **RISK_OFF（触发）** | 894 | -15.3% | **-0.5%** | +37.5% |

**Defense Gate 一旦触发，把 RISK_OFF 段 undefended 的 -15.3% 收到 defended 的 -0.5%（几乎打平）。** 之前的 -94.6% 是「undefended + close-to-close 含隔夜 + 幸存者偏差 benchmark」三重误导叠加的结果，并非防守失效。真实问题是 **defense 触发时机/regime 定义**，而非降仓力度。

### 4.2 Main5 benchmark 修正（幸存者偏差）

| 口径 | Sharpe | MDD |
|---|---:|---:|
| 固定等权（旧，有偏差） | 1.00 | -20.6% |
| **PIT 等权（修正）** | **0.75** | **-45.8%** |

旧 benchmark 从 2018 起给未上市的 Main5 各 20%（缺失收益填 0=现金），把早期回撤稀释了。PIT 等权后 Main5 真实表现显著下调（早期只有 515880 通信一只，100% 集中，MDD 深）。

### 4.3 修正后的经济对照（T+1 收盘执行，10bps）

| 策略 | 累计 | Sharpe | MDD | 总换手 |
|---|---:|---:|---:|---:|
| Main5 PIT 等权 | +183.5% | 0.75 | -45.8% | 3.6 |
| Expanded Universe EW | +84.2% | 0.42 | -49.8% | 8.0 |
| Rule Rotation（无防守） | +15.4% | 0.20 | -57.2% | 168.5 |
| Rule + 防守 | +45.1% | 0.36 | -33.3% | 228.2 |

**结论不变：Economic Gate 仍 FAIL**，Rule+防守（0.36）仍弱于 Main5 PIT（0.75），但差距从「0.37 vs 1.00」收窄到「0.36 vs 0.75」（因为 Main5 真实表现也被下调）。

---

## 五、遗留项（下一步）

1. **P0-5 线上 Node 侧**：`runGen2ShadowEod/index.js` 仍硬编码 UNIVERSE/weights/config，且缺 PIT eligibility。需生成冻结 `GEN2_RULE_V2_BUNDLE.json`（Python/Node 单一事实源）+ Node 补 listing_date/min_history 过滤。本轮未动线上（避免在 Rule V2 定型前反复部署）。
2. **P1 重构 Selection Engine**：把 `Market Permission → Alpha Leadership → Cluster Ranking → Portfolio Utility → Role → Safety Core` 拆开，禁止 volatility/diversification/liquidity 混入 Alpha Ranking。
3. **P2 数据治理**：补 10 只老 ETF 长历史 + 真实 listing_date + 真实成交额（liquidity 现 68% 是 close×volume 估算）。
4. **P3 Rule V2**：AlphaScore-v2 = Trend+RS+Breakout（第一轮），walk-forward 验证。
5. **P4 Economic Gate 重评**：Gen2 Rule V2 vs Main5 PIT vs Universe EW vs V3.6.1 Replay。

---

## 输出文件

- `outputs/component_rank_ic.csv`
- `outputs/attribution_by_regime.csv`、`attribution_by_defense_state.csv`、`attribution_by_tech.csv`
- `outputs/backtest_metrics_summary.csv`、`benchmark_nav.csv`
- 新增模块 `gen2/portfolio/regime.py`、`gen2/evaluation/component_ic.py`
