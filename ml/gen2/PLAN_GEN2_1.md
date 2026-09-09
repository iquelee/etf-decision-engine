# Gen-2.1 立项方案 v0.4 — Hierarchical Cluster Leadership + Consolidation Quality Gate

日期：2026-09-09。状态：**PR #5 第三轮审批 = 剩 1 阻断项（Forward-label purge/embargo），本版补齐，待第四轮审批。审批通过前不写任何策略代码。**
版本历史：v0.1（首发）→ v0.2（三层协议 / M0-DRAFT / Replacement 硬门 / Gate 量化）→ v0.3（时间非重叠边界 + PIT/版本纪律）→ v0.4（**Forward-label Purge/Embargo 硬规则 + 报告口径字段**）。

## 0. 为什么是 Gen-2.1（立项依据，不变）

V2 已判定（资格报告 v3 / WP9.3A）：
- **Promotion-Actionable Alpha = CONDITIONAL PASS**（+0.10 / 62%，WP9.2）——信号有预测力；
- **Economic Gate = FAIL（§31 Case B）**——预测力经状态机后未转化为成本后净增量（vs Main5 PIT bootstrap CI 均值 −0.00034/日；换手 147 vs 12.5）。

V2 结构性病灶（事件归因证据）：跨资产大池直接横排（黄金/银行/半导体/创新药/纳指大乱斗）；Consolidation 字段已算未用（sideway_days/range、volume_ratio_5_20、volume_compression_slope、volatility_compression）；PROMOTION_HYSTERESIS 后 20D +1.85%（纯天数滞后踏空）、RISK_OFF_CORE_HOLD −0.51%、rotation cost 主导。

> **目标（不变）**：不追 raw IC，让「选对」变成「少换、换得值、持得住」，把 Selection Alpha 转化为成本后正增量。

## 1. 范围（第一版只做两件事，不变）

```text
Hierarchical Cluster Leadership   （先判赛道强，再判赛道内谁强）
        +
Consolidation Quality Gate       （横盘缩量=晋升质量门，不进排名）
```

**不做**（红线不变）：Qlib / LightGBM / 神经网络 / Fundamental / 宏观变量堆叠 / 大规模参数 grid search / 修改 V3.6.1 / 重训 Gen-1 / Production Advisory。

## 2. 研究协议（硬修改 #1：三层，杜绝「Validation 当 OOS」）

本方案全程遵守**三层数据协议**，每个里程碑归属明确：

```text
Development（结构/参数设计）
    M1 cluster 结构、M2 consolidation 评分形式、M3 replacement 硬门设计
    ↕ 只能动 DRAFT 配置，绝不评价「最终结论」

Validation（敏感度 / 阈值 / 结构选择）
    M2 阈值敏感度矩阵、M3 硬门门槛校验、top_cluster_count / probation 窗口
    结果只用于「选择」并写回 DRAFT，允许在本层内迭代

Frozen Historical Walk-Forward Evaluation（参数冻结后只评价，不再改）
    M4 Event 评价、M5 Economic Replay
    配置 = 已 freeze 的 GEN2_RULE_V21_BUNDLE（SHA immutable）
```

**诚实声明（写进所有 V2.1 数值报告）**：
- 2021–2026 历史已被 V2 / WP9 / 资格判定**多次观察**，**不得宣称**为「完全未触碰的最终 OOS」；
- 历史阶段结论一律命名为 **Frozen Historical Walk-Forward / Post-freeze Evaluation（Pseudo-OOS）**；
- **真正最终 OOS 由未来 Live Integrated Shadow 积累提供**（与 V2 相同纪律：线上 Shadow 独立事件积累后才谈生产资格）。

### 2.1 时间非重叠边界（硬性，以 signal/trade_date 归属为准）

三层必须落在**互不重叠的时间段**（信号日口径；数据池 last_date=2026-09-04）：

```text
Development（结构/参数设计）      signal 日 ≤ 2023-12-31
Validation（阈值/结构选择）       2024-01-01 ≤ signal 日 ≤ 2024-12-31
Freeze Point                       M3 结束（生成 v2.1.0 BUNDLE+LOCK）
Frozen Historical Evaluation      2025-01-01 ≤ signal 日 ≤ 2026-09-04
```

- **选择与评价永不共享同一批 signal 日，且任何用于调参的 realized return 都不得来自后一层**：阈值、top_cluster_count、硬门常数、probation/min-hold 等一切选择只消费 Validation 段（2024）或其之前；Frozen 段（2025 起）只用于对冻结 v2.1.0 的评价，禁止任何「看到 Frozen 结果再回头改 DRAFT」。

#### 2.1.1 Forward-label Purge / Embargo（硬规则，第三轮审批补充）

**常量：`MAX_FORWARD_HORIZON = 40 trading days`**（label 最长前瞻；后续任何修改须在报告中说明并全链重算 purge）。

- **任何前一层的 signal，只要其 forward label（未来 20/40D realized return）触及后一层的交易日历，即从前一层剔除（purge）**。关键不变量：**前一层用于调参的任何 realized return，都不能来自后一层。**
- 因此各层有效窗口（effective_signal_start/end）由 purge 决定，而非仅自然日：

```text
Development   signal ≤ 2023-12-31；其 label 跨入 2024 的 signal → purge（天然 end ≈ 2023-10 中，由数据定）
Validation    2024 全年；其 label 跨入 2025 的 signal → purge（天然 end ≈ 2024-10 中，由数据定）
Freeze Point  M3 末（生成 v2.1.0 BUNDLE+LOCK）
Frozen Eval   signal ≥ 2025-01-01；label 尾部超出数据池末（2026-09-04）的 signal 不进入需 label 的指标
```

- **所有 M2/M3（Validation 层）与 M4/M5（Frozen 层）报告必须额外记录以下 4 个口径字段**，防边界漂移：

```text
max_forward_horizon      = 40（trading days）
purge_count              = 本层被剔除的 signal 数（label 触及下一层/池末）
effective_signal_start   = purge 后实际首日
effective_signal_end     = purge 后实际末日
```

- 事件/经济指标中因窗口尾部缺 label（如 2026-07 后事件缺 40D 前瞻）的 sample 一律 dropna 并计入 purge_count，不得外推补数。

### 2.2 PIT 与版本纪律（防倒灌）

1. **PIT / min-history 自然进入**：2024 年后上市的 ETF（如 159582 等）按 listing_date + min_history_days(120) 规则自然进入样本；**不得为覆盖率倒灌未来数据或人为补齐上市前行情**。
2. **版本迭代不重复消费 Frozen 段**：若 v2.1.0 在 M4/M5 FAIL 后开发 v2.1.1，**2025-01-01 起的 Frozen 段已被 v2.1.0 观察过，不得再作为 v2.1.1 的独立 Frozen Evaluation**。v2.1.1 的最终资格转向：后续 Live Shadow 独立积累，或事先保留且从未用于调参的时间段（如有，须在 v2.1.1 立项时明示并重新审批协议）。

## 3. M0 — V2 冻结归档 + V2.1 DRAFT 建立（硬修改 #2：锁时序）

- **V2 正式冻结归档**（不变）：`GEN2_RULE_V2_BUNDLE/LOCK`、WP9 资格报告、V2 经济基线（outputs/gen2_wp93a_*.csv）从此不可改动（verify-immutable.js / CI Stage C 已锁）。V2 = Champion Baseline（Production Gate FAIL）。
- **M0 不创建 immutable V2.1 LOCK**。只创建：
  - `ml/gen2/manifests/GEN2_RULE_V21_DRAFT.json`：state=`RESEARCH_DRAFT`；结构 = V2 全字段 + `cluster_leadership` / `consolidation_gate` / `turnover_aware_replacement` 三段；**不进入 immutable lock，CI 不校验其 SHA**。
- **Freeze Point（位于 M3 末）**：结构与参数全部冻结后，才一次性生成
  `GEN2_RULE_V21_BUNDLE.json`（engine_id=gen2-rule-v2.1、bundle_version=gen2-rule-v2.1.0、state=FROZEN）+ `GEN2_RULE_V21_LOCK.json`；verify-immutable.js 增加该组校验（此后 SHA immutable，CI 每 push 锁死）。
- **M4/M5 只评价已冻结 v2.1.0**；若 M4 或 M5 FAIL：**不改已冻结 v2.1.0**，另开 `v2.1.1`（新 DRAFT→新 freeze 版本链）或 experiment branch，证据可追踪。

## 4. 决策结构（不变，已认可）

```text
Market Regime（55/45 契约）
  → Cluster Leadership（哪个簇值得参与）
  → ETF Leadership within Cluster（簇内谁最强）
  → Consolidation Quality（晋升质量 Gate）
  → Persistence / Replacement（硬门 + 最少换手）
  → Portfolio Cap / Defense（25/40/65 + risk_off）
```

## 5. M1 — Cluster Leadership（Development 层）

勘察已确认：`etf_master.correlation_cluster`（10 业务簇）、`universe/clusters_v1.json`（codes/max_core_count）、features 含 `corr_to_cluster_60d`；ranking/roles 已带 cluster 列与 cap。

设计（透明规则）：cluster_score = 簇内 alpha 前 50% 等权 mean（trend+rs+breakout）+ 簇 px_ma60 广度条件；cluster_rank 跨簇排序 + 沿用 market_score regime 契约；cluster_leader 每簇 top1（核心簇可 top2）进入 ETF 层；弱簇整簇降 SATELLITE/RESERVE。参数（top_cluster_count、cluster_min_members）进 DRAFT，**Validation 层校验后于 Freeze Point 冻结**。

## 6. M2 — Consolidation Quality Gate（Gate 而非权重因子，不变的精神 + 协议归属明确）

- `consolidation_quality`（0-100 透明评分）：横盘时间分档 + 区间收敛 + 缩量（volume_ratio_5_20）+ 波动压缩 + 趋势未破坏（px_ma60>0 前置）。
- **只作 promotion / replacement permission Gate**；不达标记 `PROMOTION_GATED_BY_CONSOLIDATION`，不改强弱排名。
- 阈值属 **Validation 层**：跑敏感度矩阵（分位扫描）→ 选定写回 DRAFT → Freeze Point 冻结。**敏感度只发生在 Validation，绝不与 Frozen Evaluation 数据重叠使用**（§2）。

## 7. M3 — Turnover-aware Replacement（硬修改 #3：硬门 + 少参数，弃 6-component 权重 score）

V2 现状：`_replacement_edge = alpha 差 − (2+2+1)`，min_edge=8（拍脑袋常数）。**V2.1 不做参数搜索，也不设计「万能 Replacement Score」**。

Replacement 候选 = **以下 5 个硬条件同时满足**：

```text
① challenger 所在 cluster 合格（cluster_leadership 通过）
② challenger consolidation_quality PASS（M2 门）
③ challenger leadership > incumbent（簇内 alpha 净优势 > 0）
④ expected economic edge > transaction-cost hurdle
⑤ incumbent 无 persistence protection（min-hold 未满 / 非 demotion 滞后保护期）
```

其中：
- **Expected Turnover Cost = weight_delta × cost_bps（计算值，非可调权重）**；`transaction-cost hurdle` = 该计算出的换手成本 + 常数缓冲（常数于 Validation 层选定、Freeze Point 冻结）。
- **Incumbent Persistence Value 不设权重**：以 **minimum-hold / hysteresis 条件**（如新任 CORE 须在位满 N 交易日才可被替换，N 初值 = demotion_persistence_days，Validation 校验）表达。
- 新增 **replacement probation**：替换后 20D 观察窗，challenger 相对 incumbent 无超额 → 记 `REPLACEMENT_UNDERPERFORM`（供 M4 诊断，不参与权重）。

本层可调参数总量受控：{⑤ min-hold 天数, ④ cost 常数缓冲} + M1/M2 各自少量参数；全部于 Validation 层收敛后一次性冻结。

## 8. M4 — Event 评价（Frozen Historical Walk-Forward 层，参数冻结后）

PROMOTION_CONFIRMED / REPLACEMENT_ACCEPTED / DEMOTION_CONFIRMED 事件后 **5D / 10D / 20D / 40D**，相对：旧 incumbent（如适用）｜510300｜cluster 等权基准。
产出（V2/V2.1 同一函数可比）：False Promotion Rate、Replacement Payoff（20/40D 净超额）、事件正收益率、Rotation Efficiency。
**关卡**：冻结 v2.1.0 的事件 20D 相对 incumbent/cluster 无正超额 → 本版 FAIL；**不改 v2.1.0**，走 v2.1.1 / 实验分支回 M1-M3（§2 纪律）。本层只评价。

## 9. M5 — Economic Replay（Frozen Historical Walk-Forward 层）

同账本同口径（相同数据 / T+1 / cost 10 / PIT universe / ledger）：Main5 PIT | Gen-2 V2（frozen） | **Gen-2.1 v2.1.0** | Universe EW | 510300。
主表 = V2 vs V2.1：Net Return/CAGR、Sharpe/MDD/Calmar、Turnover/Cost、Promotions/Replacements、Avg Hold Days、False Promotion Rate、Replacement Payoff、Selection Net Increment（vs Main5 PIT bootstrap CI）。
附逐年 + 分 regime 表；新诊断落点 `ml/gen2/evaluation/diagnostics.py`（纯函数复用，V2 也回填以可比）。

## 10. Economic Gate — 提前冻结（硬修改 #4：全部量化，数值在结果前定死）

以下判定值在 **V2.1 最终结果产生前**写入；除明确「Validation 校准项」外，写入后不因结果调整。若需改判定标准，视同重开研究协议、须重新审批。

```text
G1  Selection Net Increment mean（vs Main5 PIT，cost 10）> 0
G2  其 bootstrap 95% CI 下界 ≥ −0.0001/日（容忍值 Validation 校准，结果前定死）
G3  Turnover ≤ V2 × 0.60（下降 ≥ 40%）
G4  净 Rotation Cost < V2 的净 rotation cost
G5  Sharpe ≥ V2（frozen 基线 0.482）
G6  MDD ≥ V2 MDD − 3pct（即不劣于 −26.4%）
G7  无灾难年份：任何年度收益相对同年度 Main5 PIT 不低于 −15pct（结果前定死）
G8  Replacement Payoff：20D > 0 且 40D > 0（Frozen 层事件审计）
否决规则：仅 raw IC 提升而成本后仍输 Main5 → 无论 IC 一律 FAIL
```

V2 frozen 参照值（2026-09-09 锁定，供 G3-G6 对表）：Turnover 147.2、Sharpe 0.482、MDD −23.4%、净 Rotation Cost = 累计(净 0bps − 净 10bps)。

## 11. 新增诊断指标（不变，M4 起输出）

```text
False Promotion Rate  = 晋升后 20D 跑输 incumbent / 510300 / cluster 基准的比例
Replacement Payoff    = challenger 替换 incumbent 后 20/40D 净超额
Rotation Efficiency   = gross selection alpha / turnover cost
Avg Hold Days         = CORE 平均连续在位交易日
```

## 12. 工程门禁（小修改 #2：不写死 18/18）

- 不改 V2：V2 bundle/lock 真 SHA 已锁（verify-immutable.js + CI）；Gen-2.1 仅于 Freeze Point 后新增 v2.1.0 lock 组校验（总计 ≥11 项）。
- `npm test` = **全 Gate PASS**（Stage A-F + Immutable 真 SHA + secret；测试数量随开发变化，不以固定数字作验收）。
- 数据身份：`verify-gen2-dataset.py` 31/31；所有 V2.1 数值报告声明数据与 manifest 一致 + 标注 Frozen Historical 层（§2 诚实声明）。
- 开发流：feat/gen21-* → PR → CI 全绿 → 审批 merge（master protection 已开）。

## 13. 里程碑与审批门（小修改 #1：本方案审批 ≠ 批准 M0 实施）

| M | 层 | 交付物 | 审批门 |
|---|---|---|---|
| M0 | Development | V2 归档确认 + V21 DRAFT 建立（无 lock） | **独立二元审批** |
| M1 | Development | cluster_leadership 模块 + 单测 + 审计 | 独立二元审批 |
| M2 | Dev + Validation | consolidation_quality + 敏感度矩阵 | 独立二元审批 |
| M3 | Dev → Freeze | 硬门 replacement + **Freeze Point（生成 BUNDLE+LOCK）** | 独立二元审批（含冻结动作本身） |
| M4 | **Frozen Evaluation** | 事件 5/10/20/40D 报告 | 独立二元审批（Event 关卡） |
| M5 | **Frozen Evaluation** | Economic Replay + 主表 vs §10 Gate | 独立二元审批（最终 Gate） |

**本次审批仅 = 批准 Gen-2.1 研究协议（§1–§12），可开始 M0。** 每个 M 完成后独立提交「结论 + Gate 判定」再审批下一步；禁止跨里程碑捆绑放行。

## 14. 风险与开放问题（保留 + 更新）

1. 簇聚合脆弱 → alpha 前 50% 等权 + px_ma60 广度双保险（M1 诊断校验）。
2. Consolidation 阈值敏感 → Validation 层敏感度矩阵先定协议（§6）；门过宽=失效、过严=重现 hysteresis 踏空。
3. cluster cap 与 leadership 双闸交互 → 簇级配额（leader 优先）规则在 M1 明确。
4. V2.1 只解决 construction、不解决 universe 天花板：Main5 可能即最强（9.3A 证据），V2.1 增量主要来自「少换」→ 属预期且合格（目标即成本效率）；若 G3 达而 G1 不达 → 走 v2.1.1，不改判 Gate。

## 15. 复现与数据

数据：`deliverables/etf_daily_ml_pool/`（31 csv，DATASET_MANIFEST_V1 锁定）；V2 基线：`outputs/gen2_wp93a_*.csv`；V2.1 新产物统一前缀 `gen2_v21_*`（DRAFT 阶段 `_draft_*`），与 V2 并列不覆盖。
