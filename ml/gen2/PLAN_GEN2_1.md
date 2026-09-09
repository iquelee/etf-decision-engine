# Gen-2.1 立项方案 — Hierarchical Cluster Leadership + Consolidation Quality Gate

日期：2026-09-09。状态：**待审批（M0 之前不写任何策略代码）**。版本 v0.1。

## 0. 为什么是 Gen-2.1（立项依据）

V2 已判定（资格报告 v3 / WP9.3A）：
- **Promotion-Actionable Alpha = CONDITIONAL PASS**（+0.10 / 62%，WP9.2）——信号有预测力；
- **Economic Gate = FAIL（§31 Case B）**——预测力经状态机后**未转化为成本后净增量**：vs Main5 PIT bootstrap CI 均值 −0.00034/日；换手 147 vs Main5 12.5；rotation cost 主导。

V2 的结构性病灶（事件归因证据）：
1. **30 只跨资产大池直接横向排名** → 黄金/银行/半导体/创新药/纳指同一横截面"大乱斗"，跨簇无意义轮动；
2. **Consolidation 字段已算、未用**：sideway_days/range、volume_ratio_5_20、volume_compression_slope、volatility_compression 全部已进 feature_v1，但 alpha 只用 Trend/RS/Breakout；
3. **PROMOTION_HYSTERESIS 后 20D +1.85%**（5 日纯天数滞后踏空）、RISK_OFF_CORE_HOLD −0.51%、换手成本吞噬贡献 → **该换的没换对时机、不该换的换了**。

> **Gen-2.1 目标收窄：不追更高 IC，而是让「选对」变成「少换、换得值、持得住」——把 Selection Alpha 转化为成本后正的经济增量。**

## 1. 范围（第一版只做两件事）

```text
Hierarchical Cluster Leadership   （先判赛道强，再判赛道内谁强）
        +
Consolidation Quality Gate       （横盘缩量=晋升质量门，不进排名）
```

明确**不做**（第一版红线）：Qlib / LightGBM / 神经网络 / Fundamental / 宏观变量堆叠 / 大规模参数 grid search / 修改 V3.6.1 / 重训 Gen-1 / Production Advisory。

## 2. 新决策结构

```text
Market Regime（沿用 55/45 契约）
     ↓
Cluster Leadership —— 哪个 cluster 值得参与？（先于 ETF）
     ↓
ETF Leadership within Cluster —— 簇内谁最强？（排名只在簇内+被选簇间有意义）
     ↓
Consolidation Quality —— 这个强者现在是不是高质量晋升窗口？（Gate）
     ↓
Persistence / Replacement —— 是否真值得替换现任？（turnover-aware）
     ↓
Portfolio Cap / Defense（沿用 25/40/65 + risk_off）
```

## 3. M0 — V2 正式冻结归档（先行）

- V2 成为 **Champion Baseline（Production Gate FAIL）**，任何后续不得改动：
  `GEN2_RULE_V2_BUNDLE.json` / `GEN2_RULE_V2_LOCK.json` / WP9 资格报告 / economic_replay 基线（lock 真 SHA 已由 verify-immutable.js 锁死，CI 每 push 校验）。
- **新建**（V2.1 独立身份，绝不覆盖 V2）：
  - `ml/gen2/manifests/GEN2_RULE_V21_BUNDLE.json`：engine_id=`gen2-rule-v2.1`、bundle_version=`gen2-rule-v2.1.0`；**结构 = V2 全部字段 + 新增 `cluster_leadership` / `consolidation_gate` / `turnover_aware_replacement` 三段**（参数见 M1-M3，M0 先立空壳 + 校验器）。
  - `ml/gen2/manifests/GEN2_RULE_V21_LOCK.json`（真 SHA lock，verify-immutable.js 增加第 4 组检查）。
- 对照体系：V2 事件输出 `outputs/gen2_wp93a_*.csv` 为 baseline 证据，不得重跑覆盖（新结果存 `gen2_v21_*`）。

## 4. M1 — Cluster Leadership

**勘察现状（已确认）**：`etf_master.correlation_cluster` 11 值（10 业务簇 + broad_beta 对照）；`universe/clusters_v1.json` 含各簇 codes/max_core_count/描述；ranking/roles 已带 correlation_cluster 列与 cluster cap（max_core_per_cluster=2）；features 已有 `corr_to_cluster_60d`。

设计（透明规则优先，不拟合权重）：
- **cluster_score**(t, cluster) = 簇内 ETF 的聚合领导力（第一版：簇内 alpha 前 50% 标的的等权 mean（trend+rs+breakout），加簇 px_ma60 广度条件）。
- **cluster_rank / cluster_regime**：跨簇横截面排序 + 用 market_score 判簇层可用性（沿用 regime 契约，不发明阈值）。
- **cluster_leader**：每簇只放行 top 1（核心簇可 top 2）进入 ETF 层候选。
- 排产流：**先 cluster_rank 决定「允许活跃的簇」，再在这些簇内做 ETF 排名**；弱簇（cluster 层不达标）整簇降为 SATELLITE/RESERVE，从源头消灭跨簇无意义轮动。
- 参数：`top_cluster_count`（默认 4~5 活跃簇）、`cluster_min_members` 等，入 V21 bundle `cluster_leadership` 段，**数值 M4 event-OOS 验证后冻结，不拍脑袋**。

## 5. M2 — Consolidation Quality Gate（Promotion 质量门）

**勘察现状（已确认）**：feature_v1 已有 `sideway_days / sideway_range / volume_ratio_5_20 / volume_compression_slope / volatility_compression / px_ma20 / px_ma60 / corr_to_cluster_60d`（build_features.py:47-73）。alpha_score 完全未用。

设计（**Gate 而非权重因子**——反对 `consolidation 25%` 进 alpha）：
```text
Leadership 决定「谁强」
Consolidation 决定「现在值不值得晋升」
```
- `consolidation_quality` = 透明评分（0-100，规则式）：横盘时间分档 + 区间收敛 + 缩量 + 波动压缩 + 趋势未破坏（px_ma60>0 前置）。
- 用法：**只作用于 promotion / replacement permission**：
  - promotion 候选需 `consolidation_quality >= 阈值` 才放行 PROMOTION_CONFIRMED；
  - 不达标者继续观察（记 `PROMOTION_GATED_BY_CONSOLIDATION`），**不改变强弱排名**；
  - 阈值入 V21 bundle `consolidation_gate` 段，先跑敏感度再冻结（沿用「先回测验证再定数值」纪律）。

## 6. M3 — Turnover-aware Replacement（V2.1 成败关键）

V2 现状：`_replacement_edge = (alpha 差) − 2 − 2 − 1`，min_edge=8.0（拍脑袋常数）。
V2.1 改**结构化 benefit**（不做 8→10/12/15 参数搜索）：
```text
Replacement Benefit =
    Leadership Advantage            （challenger − incumbent 簇内 alpha）
  + Cluster Leadership Advantage    （若 challenger 所在簇更强）
  + Consolidation Quality           （challenger 晋升质量分 vs incumbent 当前质量）
  − Correlation Redundancy          （corr_to_cluster_60d 惩罚冗余换仓）
  − Expected Turnover Cost          （预计换手成本，入 benefit 而非事后扣）
  − Incumbent Persistence Value     （现任在位时间/已确认贡献，反对频繁替换）
```
- 目标不是「更难换」，而是「**只有明显值得换才换**」。
- 新增 **replacement probation**：替换后设观察窗（如 20D），窗口内若 challenger 相对 incumbent 无超额 → 记 REPLACEMENT_UNDERPERFORM（诊断），供 M4 校准 benefit 权重。
- 全部项权重重入 V21 bundle `turnover_aware_replacement` 段，初值透明、event-OOS 后冻结。

## 7. M4 — Event OOS（先于大回测的关卡）

对三种事件做多窗口相对收益审计：
```text
PROMOTION_CONFIRMED / REPLACEMENT_ACCEPTED / DEMOTION_CONFIRMED
    ↓ 事件后 5D / 10D / 20D / 40D
    相对：旧 incumbent（如适用）｜510300｜cluster benchmark（簇等权）
```
指标：False Promotion Rate、Replacement Payoff（20/40D 净超额）、事件正收益率。
**关卡：若 PROMOTION/REPLACEMENT 事件后 20D 相对 incumbent/cluster 无正超额 → 本方案 FAIL，停止 M5，回 M1-M3 设计。**
（V2 已有此机制雏形：`outputs/gen2_wp93a_events.csv` 单窗口；M4 扩展为多窗口 + 对照簇基准。）

## 8. M5 — Gen-2.1 Economic Replay + 冻结 Gate

同账本同口径（相同数据/T+1/cost 10/PIT universe/ledger）五组对照：
```text
Main5 PIT | Gen-2 V2（frozen baseline） | Gen-2.1 | Universe EW | 510300
```
主表（V2 vs V2.1 逐列）：

| 指标 | V2 | V2.1 |
|---|---|---|
| Net Return / CAGR | | |
| Sharpe / MDD / Calmar | | |
| Turnover / Cost | | |
| Promotions / Replacements 次数 | | |
| Avg Hold Days | | |
| False Promotion Rate | | |
| Replacement Payoff | | |
| **Selection Net Increment**（vs Main5 PIT bootstrap CI） | | |

**Gate 提前冻结（结果出来前定死）**：
```text
① Selection Net Increment > 0（bootstrap CI 下界不显著为负，均值正）
② Turnover 显著低于 V2（目标 -40%+）
③ Rotation Cost 明显下降
④ Sharpe >= V2；⑤ MDD 不明显恶化
⑥ 不存在新的灾难年份（相对 V2/Main5）
⑦ Replacement Payoff > 0
仅 IC 0.10→0.14 而成本后仍输 Main5 → FAIL
```

## 9. 新增诊断指标定义（V2/V2.1 通用，M4 起输出）

```text
False Promotion Rate  = 晋升后 20D 跑输 incumbent / 510300 / cluster 基准的比例
Replacement Payoff    = challenger 替换 incumbent 后 20/40D 净超额（vs 被替换者）
Rotation Efficiency   = gross selection alpha / turnover cost（每单位换手成本换来的选择 alpha）
Avg Hold Days         = CORE 平均连续在位交易日
```
落点：`ml/gen2/evaluation/` 新增 `diagnostics.py`（纯函数，输入 roles/labels/ledger → 上述指标表），`economic_replay.py` 的 V2 输出不动，V2.1 复用同一函数保证可比。

## 10. 工程门禁（全程强制）

- **不改 V2**：V2 bundle/lock 真 SHA 已锁（CI Stage C 8 项 + Gate 7），Gen-2.1 只新增 V2.1 bundle/lock（verify-immutable.js 增第 4 组，共 ≥11 项）。
- `npm test`（18/18）每里程碑绿；Python 单测新增 cluster/consolidation/gate 单元用例（沿用 unittest）。
- 数据身份：`verify-gen2-dataset.py`（31/31）——所有 V2.1 数值必须声明数据与 manifest 一致。
- 开发流：feat/gen21-* 分支 → PR → CI 全绿 → 合并（master protection 已开）。
- 里程碑二元审批：M0/M1/M2/M3/M4/M5 各出「结论+证据+Gate 判定」再进下一步，禁止一把梭。

## 11. 里程碑提交物

| M | 交付物 | 审批门 |
|---|---|---|
| M0 | V21 bundle/lock 空壳 + verify 增项 + V2 归档标注 | 本方案审批即含 M0 |
| M1 | cluster_leadership 模块 + 单测 + M4 前置审计 | 弱簇剔除是否消灭无效轮动（event 证据） |
| M2 | consolidation_quality 评分 + gate + 阈值敏感度 | 敏感度矩阵后定阈值 |
| M3 | turnover-aware replacement + probation | Replacement Payoff/次数 |
| M4 | Event OOS 多窗口报告 | 事件正超额关卡 |
| M5 | V2.1 Economic Replay + 主表 | **冻结 Gate 8 条** |

## 12. 风险与开放问题

1. **簇层聚合的定义脆弱**：第一版用簇内等权 mean，可能被单只超大 ETF 主导 → 用 alpha 前 50% 等权 + px_ma60 广度双保险（M1 设计时用诊断校验）。
2. **Consolidation 阈值敏感**：范围过大=门失效、过严=回到 hysteresis 踏空 → M2 强制跑敏感度矩阵（10%~90% 分位）再冻结。
3. **cluster cap 与 cluster leadership 双闸交互**：避免同簇多只同时晋升导致 cluster cap 频繁触发 → M1 排产规则里明确簇级配额（leader 优先）。
4. **V2.1 只解决 construction 不解决 universe 天花板**：若 Main5 本身即最强（9.3A 证据），V2.1 的增量主要来自「少换」而非「换对更多」——M5 若 Net Increment 转正但来源是少换，属预期且合格（目标即成本效率）。

## 13. 复现与数据

- 数据：`deliverables/etf_daily_ml_pool/`（31 csv，manifest 已锁）；V2 基线：`outputs/gen2_wp93a_*.csv`。
- V2.1 新产物统一前缀 `gen2_v21_*`，与 V2 基线并列不覆盖。
