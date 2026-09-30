# V365 M4-P0 —— ETF Workbench / ETF Detail 数据契约侦察（只读）

> **性质**：**只读侦察报告**。⛔ 未改 backend、⛔ 未写任何组件、⛔ 未改 Safety Core / Gen-1 / Gen-2 业务语义。
> **基线**：仓库 `etf-decision-engine`，分支 `refactor/v365-frontend-integration`，HEAD `2bd8df2`（M3 不动）。
> **证据**：线上只读抓取（2026-09-30）+ 仓库源码（只读）+ M2 既有 adapter/fixture。
> 证据目录：`_v365-fe-audit-20260930/live/*.json`、`web/tests/fixtures/{live-legacy,canonical,m4}/`。
> **标记**：`[AS-IS]` 实测事实 · `[SRC]` 源码可证 · `[INFERRED]` 推断（未直证）· `[UNKNOWN]` 未验证。

---

## §0 结论摘要（先看这 8 条）

| # | 结论 | 性质 |
|---|---|---|
| 1 | 线上 `/api/etf/:code` **没有** `production` / `gen1` / `system_runtime` / `legacy` 四块，也没有 V3.6.5 的 `authority` / `mutable_axis`。Gen-1 在本页**只能走 legacy 通道**（`decision.gen1_*` 56 个字段 + `ml_shadow`） | `[AS-IS]` |
| 2 | ★★ **`/api/etf/:code/kline?period=daily` 的最后一根 K 线是 `2024-08-27`**（518880 为 `2024-08-26`），比决策日 `2026-09-29` **晚约两年**；根因可证：`getKline` 用 `orderBy trade_date **asc** + limit 320` ⇒ 取的是**最旧** 320 根 | `[AS-IS]`+`[SRC]` |
| 3 | `amount` / `premium_rate` 在 **320/320** 根 K 线上全为 `null` ⇒ 死字段 | `[AS-IS]` |
| 4 | `target_std` 在 **5 处**出现，实为**两种语义**（决策带 / 配置带）——已逐源钉死，见 §3 | `[AS-IS]` |
| 5 | **`trend_stage` 同名不同义（endpoint 级）**：`/api/dashboard` card = `S0`（主状态），`/api/etf/:code` = `S7`（`displayStage`，含 overlay）；同文档另有 `trend_stage_primary = S0` | `[AS-IS]` |
| 6 | **`core_position` / `trade_position` 同名不同义（块级）**：`decision.core_position=0.2`（**建议**）vs `position.core_position=12.6`（**实际当前**）；`trade` 同理（0.3 vs 8.4） | `[AS-IS]` |
| 7 | ★ `explain_chain`（"为什么"）的**文案数字与同文档字段矛盾**：链里「仓位缺口 -7.8pct」而 `position_gap=0`；链里「核心 12.6% · 交易 0%」而 `decision.core_position=0.2 / trade_position=0.3` | `[AS-IS]` |
| 8 | payload：`/api/etf/:code` 共 **16,620 B**，其中本页**不消费**的块约 **5.4 KB（≈33%）**（`fundamental_config` 1,053 + `fundamental_series` 1,797 + `holdings` 2,129 + `holdings_date` 12 + `fundamental` 部分） | `[AS-IS]` |

> ⚠️ **勘误**：M2 阶段我在记忆与报告里写过「`/api/etf/:code` 携带约 30KB 死载荷」——**该数字不准确**。
> 实测为 16,620 B（紧凑 JSON），未消费部分 ≈5.4 KB。30KB 来自当时对**缩进格式化的 fixture 文件**体积的误读。

---

## §A API Field Matrix

> 约定：**actual example** 全部取自 2026-09-30 线上实测（513310）；**是否仍需要** = 新前端是否消费。

### A.1 `GET /api/etf/:code` → `data`（11 顶层块 / 16,620 B）

#### A.1.1 `basic`（9 键 / 190 B，源：mongo `etf_basic`）

| field | actual example | semantic meaning | adapter mapping | UI 用途 | 仍需? |
|---|---|---|---|---|---|
| `code` | `"513310"` | 标的代码 | `basic.code` | 标题 / 路由 | ✅ |
| `name` | `"中韩半导体ETF(QDII)"` | 名称 | `basic.name` | 标题 | ✅ |
| `sector` | `"storage"` | 赛道（**英文内部枚举**） | `basic.sector` + `sectorLabel()` | 赛道徽标 | ✅ |
| `is_qdii` | `true` | 是否 QDII | `basic.isQdii` | 溢价/汇率提示 | ✅ |
| `max_position` | `30` | **配置仓位上限（%）** | `basic.maxPosition` | 上限参考 | ✅ |
| `target_position` | `25` | **配置标准目标（%）** | `basic.targetPosition` | ⚠️ 与决策带区分 | ✅ |
| `status` | `"enable"` | 启用状态 | `basic.status` | 运维提示 | ✅ |
| `sort_order` | `1` | 排序权重 | ⛔ 未适配 | 后端已排序 | ❌ 不消费 |
| `_id` | `"6a7fe01f…"` | mongo 内部 ID | ⛔ 未适配 | — | ❌ 不消费 |

#### A.1.2 `snapshot`（32 键 / 867 B，源：`indicator_snapshot`）—— **结构识别数据源**

| field | actual example | semantic meaning | adapter mapping | UI 用途 | 仍需? |
|---|---|---|---|---|---|
| `calc_date` | `"2026-09-29"` | 行情计算日 | `snapshot.calcDate` | 数据新鲜度 | ✅ |
| `w_state` / `d_state` / `h_state` / `v_state` | `W4` / `D5` / `H4` / `V1` | 四组状态码 | `snapshot.states.*` | 阶段识别 | ✅ |
| `stage_summary` | `"中期趋势转弱，短期走弱，已横盘 29 个交易日（较充分），成交明显萎缩"` | **后端已本地化的长句** | ⛔ **未适配**（M4 新增） | 首选一行结论 | ✅ 新增 |
| `trend_context` | `"DOWN_CONSOLIDATION"` | 横盘背景（**英文枚举**） | `snapshot.consolidation.trendContext` | 横盘详情（需中文映射） | ✅ |
| `sideway_days` | `29` | 横盘交易日数 | `consolidation.sidewayDays` | 横盘详情 | ✅ |
| `sideway_range` | `10.59` | 横盘区间振幅（**%**） | `consolidation.sidewayRange` | 横盘详情 | ✅ |
| `ma20_slope` | `0.08` | MA20 斜率（**%**） | `consolidation.ma20Slope` | 横盘详情 | ✅ |
| `consolidation_score` | `70` | 横盘评分（**点数**） | `consolidation.score` | 横盘详情 | ✅ |
| `volume_ratio` | `0.6879…` | 量比（**0~1 比例**） | `volume.ratio` | 量价 | ✅ ⚠️ 单位 |
| `volume_slope` | `8.424…` | 量能斜率（**%**） | `volume.slope` | 量价 | ✅ |
| `high_volume_stagnation` | `false` | 放量滞涨 | `volume.highVolumeStagnation` | 防守 | ✅ |
| `high_volume_decline` | `false` | 放量下跌 | `volume.highVolumeDecline` | 防守 | ✅ |
| `price_position` | `0.3032…` | 价格位置（**0~1 比例**） | `snapshot.pricePosition` | 雷达 | ✅ ⚠️ 单位 |
| `premium_rate` | **`null`** | 溢价率（%） | `snapshot.premiumRate` | 溢价提示 | ⚠️ 线上恒 null |
| `change_5d` | `-4.0916…` | 近 5 日涨幅（**%**） | `snapshot.change5d` | 首屏 | ✅ |
| `bias_20d` | `-1.0180…` | 20 日乖离（**%**） | `snapshot.bias20d` | 技术详情 | ✅ |
| `atr20` | `0.12965` | **20 日 ATR（价格单位）** —— schema `desc:'20 日 ATR'`；producer `calcATR()` 返回价格，仅在使用处 `atr20/lastClose*100` 转 % | ⛔ 未适配 | 波动参考（M5） | ✅ 新增 |
| `vol20` | `18529788.7` | 20 日均量（**份**） | ⛔ 未适配 | 量能参考 | ✅ 新增 |
| `ma5/10/20/60/120/250` | `1.197…` | 均线（**价格单位**） | `snapshot.ma.*` | K 线叠加（M5） | ✅ |
| `data_complete` | `true` | 数据完整标志 | `snapshot.dataComplete` | 缺失提示 | ✅ |
| `breakout` | `false` | 突破标志 | ⛔ 未适配 | 结构信号（M5） | ✅ 新增 |
| `_id` / `code` / `version` | — | 内部字段 | ⛔ | — | ❌ |

#### A.1.3 `decision`（**146 键 / 7,571 B**，源：`decision_result`）—— 最大块

**A.1.3a 被消费（V3 Safety Core 正式口径）**

| field | actual example | semantic meaning | adapter mapping | UI 用途 |
|---|---|---|---|---|
| `decision_date` | `"2026-09-29"` | 决策日 | `decision.decisionDate` | 首屏 |
| `final_action` | `"STRATEGIC_REDUCE"` | **唯一权威动作** | `decision.action`（归一） | 动作徽标 |
| `action_label` | `"战略减仓"` | 后端中文动作 | `decision.actionLabel` | 动作文案兜底 |
| `final_target` | `0.5` | **最终目标仓位（%）** | `decision.finalTarget` | 目标 |
| `target_min/std/max` | `0.4 / 0.5 / 0.5` | **本次决策最终目标带（%）** | `decision.targetBand.*` | 目标带 |
| `position_gap` | `0` | **服务端已算**（`max(0, final_target − suggested_position)`） | `decision.positionGap` | 缺口（⛔ 不重算） |
| `suggested_position` | `8.3` | 建议执行仓（%） | `decision.suggestedPosition` | 缺口来源 |
| `core_position` / `trade_position` | `0.2` / `0.3` | **建议**核心仓/交易仓（%） | `decision.corePosition/tradePosition` | ⚠️ 与 `position.*` 同名不同义 |
| `max_position` | `30` | 本决策上限（%） | `decision.maxPosition` | 上限 |
| `risk_flag` | `"NORMAL"` | 风险旗标（**英文枚举**） | `decision.riskFlag` | 风险徽标 |
| `risk_override` | `false` | 人工覆盖标记 | `decision.riskOverride` | 覆盖提示 |
| `premium_flag` | `"正常"` | 溢价旗标（**中文**） | ⛔ 未适配（M4 新增） | 溢价提示 |
| `c_state` / `f_state` | `"C1"` / `"F2"` | 拥挤度 / 基本面状态码 | `decision.states.c/f` | 状态 |
| `scores` | `{trend:5,volume:25,fundamental:20,crowding:15,risk:10,total:75}` | 五维评分（**点数**） | `decision.scores`（⛔ 不含 total 展示） | 评分卡 |
| `opportunity_score` / `_grade` | `67` / `"B"` | 机会分（点数）/ 等级 | `decision.opportunity.*` | 首屏 |
| `over_alloc_status` | `"中度"` | 超配状态（**中文**） | `decision.overAllocStatus` | 超配 |
| `add_eligibility` | `{trend:pause,…,cooldown:ok,regime:pause,overall:pause}`（**10 项**） | 加仓资格 | `decision.addEligibility.items`（10 项） | 资格清单 |
| `cooldown_days` | `0` | 冷静期剩余交易日 | `decision.cooldownDays` | 提示 |
| `next_add_condition` | `"仓位缺口不足（Gap -8%，需 ≥ 3% 触发加仓）…"` | 下一加仓条件（**后端文案**） | `decision.nextAddCondition` | 提示 |
| `explain_chain` | 13 步 `[{step,condition,result}]` | **"为什么"链** | `decision.explainChain` | 决策链（⚠️ 见 §7.7） |
| `binding_constraint` | `"none"` | 绑定约束 | `decision.bindingConstraint` | 约束 |
| `stage_factor` / `market_factor` | `0` / `0.25` | **乘性系数 0~1**（⛔ 非百分比） | `decision.factors.*` | 技术详情 |
| `engine_version` | `"v3.6.1"` | **该条决策自己的**引擎版本 | `decision.audit.engineVersion` | 审计 |
| `effective_market_regime` | `"crisis"` | 生效市场环境（英文） | `decision.audit.effectiveMarketRegime` | 审计 |
| `trend_stage` / `_primary` / `_overlay` / `_label` | `S7` / `S0` / `"broken"` / `"破坏"` | 见 §3.3 | ⛔ 未适配（M4 新增） | 结构 |
| `stage_summary` | 同上长句 | 后端中文长句 | ⛔ 未适配 | 一行结论 |

**A.1.3b Gen-1 legacy 内嵌（56 键，⛔ 线上唯一 Gen-1 来源）**

| 组 | 键数 | 例（实测） | 语义 |
|---|---|---|---|
| `gen1_canary_*` | 11 | `gen1_canary_target=0.5`、`gen1_canary_action="STRATEGIC_REDUCE"`、`gen1_canary_effective=false`、`gen1_canary_reason_code="EOD_STAGE_NOT_ELIGIBLE"` | 灰度反事实候选（⛔ 非正式建议） |
| `gen1_counterfactual_*` | 7 | `gen1_counterfactual_target=0.5`、`_suggested_position=8.3`、`_delta=0`、`_stage_changed=false` | 反事实影子（⛔ 不覆盖 production） |
| `gen1_health_*` | 6 | `gen1_health_status="DEGRADED"`、`gen1_health_gate_status="ACTIVE"`、`gen1_health_source="GEN1_HEALTH_STATE_LATCH"` | 模型健康 |
| `gen1_guarded_*` | 12 | `gen1_guarded_freeze_seal_status="PENDING"`、`gen1_guarded_selector_source="BASELINE"` | 守卫通道 |
| `gen1_model_*` | 4 | `gen1_model_probability=null`、`gen1_model_threshold_p=0.65`、`gen1_model_candidate=false` | 模型信号 |
| `ml_rule_permission*` | 4 | `="BLOCK"` / `"EOD_STAGE_NOT_ELIGIBLE"` / `"EOD 阶段预检：…"` / `"SAFETY_CORE"` | **Safety Core 闸门** |
| `eod_precheck_*` | 3 | 同上（与 ml_rule 重复） | EOD 预检 |
| `v361_baseline_*` | 3 | `stage=S0`、`target=0.5`、`action="STRATEGIC_REDUCE"` | V3.6.1 基线 |
| 其它 | 6 | `gen1_authority="CANARY"`、`gen1_effective_stage="S0"`、`gen1_adopted=false`、`gen1_reject_reason_code="STAGE_NOT_S2"`、`gen1_run_id`、`gen1_candidate_hash` | 审计 |

**A.1.3c 本页不消费，但**确有其值**的字段（★ 逐个实测，非猜测）**

| field | actual example | 语义（据字段构成/命名） |
|---|---|---|
| `defense_state` | `{level, reason, score, factor}` | **后端已算好的防守状态**（含 reason 文案） |
| `defense_score` / `defense_penalty` | `37` / `0.95` | 防守分 / 惩罚系数 |
| `slow_break_score` / `slow_break_high` | `20` / `false` | 慢速破位分 / 高点破位 |
| `trend_quality_score` | `5` | 趋势质量分 |
| `consolidation_grade` | `"C"` | 横盘等级 |
| `add_mode` | `"无"` | 加仓模式（**中文**） |
| `raw_target_position` / `risk_adjusted_target` | `0.5` / `0.5` | 未约束 / 风险调整后目标（**%）** |
| `target_delta` | `-7.8` | 目标变动（服务端已算） |
| `shock_context` / `shock_state` | `{shock_active, recovery_label, recovery_ratio, structural_break, recommended_action}` / `null` | 冲击上下文 |
| `rule_hits` | `array[7]` | 命中的规则（"为什么"的另一来源） |
| `factor_breakdown` / `v35_breakdown` | 各 10+ 键对象（`mode/cap/effective_cap/regime_cap/stage_*/setup_*`） | 组合约束分解 |
| `bull_activation_score` / `breakout_score` | `null` / `4` | 牛市激活 / 突破分 |
| `engine_path` / `config_version` | `"v3"` / `"2026-09-01-gen1-advisory-active"` | 引擎路径 / 配置版本 |
| `_shadow_secondary_action` | `"STRATEGIC_REDUCE"` | 影子次级动作 |
| `aggressive_divergence` / `momentum_acceleration` / `main_rally_utilization` / `profile_type` | `false` / `false` / `null` / `null` | 分歧/动量/主升利用率/画像 |

**A.1.3d 完全空/占位、可视为 dead payload（前端不消费）**

`shadow_targets`（16 键影子）· `v38_*` / `v38_final_*` / `v3_final_*` / `v361_*`（历史引擎影子）· `bull_mode_action` / `bull_pullback_hold` · `advisory_stage_override` / `advisory_base_stage` · `decision_source` · `gen1_run_id` / `gen1_candidate_hash` · `_id` / `code` · `config_version` 之外的 `decision_timestamp`。

> ★ **M4 可复用点**：`defense_state.{level,reason,score}` 是**后端已算好的防守口径**，
> 而旧前端「防守雷达」是**前端自己从 `high_volume_*` 与 `scores.volume` 派生的**（见 F.5）。
> ⇒ 处置建议：优先消费 `defense_state`；前端派生仅作 fallback 且必须标 `derived:true`。
> ⚠️ 但该字段与「防守雷达」四维的**逐维对应关系** `[UNKNOWN]`（producer 未逐行核对，属 M5 范围）。

#### A.1.4 `position`（27 键 / 1,726 B，源：`etf_position`）

| field | actual example | semantic meaning | adapter mapping | UI 用途 |
|---|---|---|---|---|
| `current_position` | `8.3` | 当前仓位（%） | `position.currentPosition` | 首屏 |
| `target_position` | `25` | **配置标准目标（%）** | ⛔ 未适配 | 与 `decision.finalTarget` 对照 |
| `target_min/std/max` | `20 / 25 / 30` | **配置标准目标带（%）** | `position.band.*` | ★ 与 `decision.targetBand` 区分 |
| `max_position` | `30` | 配置上限 | `position.maxPosition` | 上限 |
| `max_strategic_position` | `30` | 战略上限 | `position.maxStrategicPosition` | 上限 |
| `core_position` / `trade_position` | **`12.6` / `8.4`** | **实际当前**核心/交易仓（%） | `position.corePosition/tradePosition` | ⚠️ 与 `decision.*` 同名不同义 |
| `suggested_core` / `suggested_trade` | `0.2` / `0.3` | **建议**核心/交易仓（%）—— 与 `decision.core_position/trade_position` **同值** | ⛔ 未适配 | 与 decision 去重 |
| `core_ratio_grade` / `trade_ratio_grade` | `"B"` / `"B"` | 比例等级 | `position.grade.*` | 等级 |
| `shares` | `1700` | 持有份额（**份**） | `position.shares` | 持仓 |
| `avg_cost` | **`null`** | 平均成本 | `position.avgCost` | 线上无值 |
| `updated_at` | `"2026-09-30T00:00:57.892Z"` | 文档更新时间 | `position.updatedAt` | 新鲜度 |
| `slow_break_history` | 5 项 `[{score,lowerHigh,lowerLow}]` | 慢速破位历史（`score=20`、`lowerHigh=true`） | ⛔ 未适配 | M5/M6；★ 注意这是 `lowerHigh` 的**一个真实产生处** |
| `trend_stage_state` | `{stage:"S0",overlay:"broken",displayStage:"S7",days_in_stage:3,day_start_state:{…},idempotence_reason:"same_trade_date_replay"}` | **趋势阶段权威状态** | ⛔ 未适配 | 结构（M5） |
| 其余 | `core_ratio_changed_at` / `pending_*` / `trade_changed_at` / `trade_pending_*` / `shock_state` | 全 `null` | ⛔ | — |

#### A.1.5 `ml_shadow`（27 键 / 702 B）—— 线上 **Gen-1 legacy 唯一载体之一**

| field | actual example | 语义 |
|---|---|---|
| `enabled` / `effective` / `observe` | `true` / `false` / `true` | 影子开关（⛔ 不是 authority） |
| `fast_path_enabled` / `would_trigger_fast_path` | `false` / `false` | 快速通道 |
| `model_id` / `bundle_id` | `"HVT-A-ET-20260830"` / `"shadow-bundle-v1"` | 模型/包 |
| `gen1_frozen` / `engine_version` | `true` / `"v3.6.1"` | 冻结/版本 |
| `ui_phase` / `production_permission` | `"OBSERVE"` / `"BLOCKED"` | 阶段/生产许可 |
| `stage` | `"S1"` | 模型评估时 stage |
| `probability` / `calibrated_probability` | **`null` / `null`** | 概率（线上无值） |
| `permission` / `permission_hit` | `"BLOCK"` / `false` | 规则许可 |
| `signal_status` | `"NO_OPPORTUNITY"` | 信号状态 |
| `production_target_pct` / `counterfactual_target_pct` / `delta_target_pct` | `0.5` / `0.5` / `0` | 百分比（与 `final_target` 同单位） |
| `signal_date` / `data_age_days` / `is_stale` / `has_signal_row` | `"2026-09-29"` / `1` / **`true`** / `true` | ★ `age=1` 但 `is_stale=true`（口径见 §7.7） |
| `decision_hash` | `"6c6df70d076b26d3"` | 审计哈希 |

**⛔ 旧前端读取但线上不存在（16 个）**：`effective_stage` · `baseline_stage` · `category` · `domain_status` · `domain_status_label` · `domain_status_message` · `category_coverage` · `model_capability` · `market_regime` · `advisory_effective` · `advisory_target_pct` · `baseline_target_pct` · `source_trade_date` · `feature_schema_hash` · `rule_permission_reason` · `rule_permission_source`
⇒ 旧「模型审计 / 基线对照」折叠区**24 行里约 16 行恒为 `—`**（`[AS-IS]`，审计 §3.6 #9 的同一模式）。

#### A.1.6 其余块

| 块 | 体积 | actual | 本页是否消费 | 处置 |
|---|---|---|---|---|
| `fundamental` | 409 B | `{f_state:"F2", f_score:20, detail:{…layer_breakdown…}, updated_at}` | 仅取 3 个字段 | **保留摘要**；`detail` 归「基本面」页（M6） |
| `fundamental_config` | 1,053 B / 5 项 | `{indicator,name,weight,freq,source,unit,metric_type,layer}` | ❌ | **本页不消费**（后台录入 / M6） |
| `fundamental_series` | 1,797 B / 5 键 | `{value,direction,data_date,unit,note,citations[{stock_code,stock_name,title,source}]}` | ❌ | **本页不消费**（M6 情报证据） |
| `holdings` + `holdings_date` | 2,129 + 12 B | 10 项 `{rank,stock_code,stock_name,weight,market}`，`report_date=2026-06-30` | ❌ | **本页不消费**（后台录入页用） |
| `risk_events` | 2 B | **`[]`（线上空）** | ✅（用于风险原因） | 保留；空数组是合法值 |

### A.2 `GET /api/etf/list` → `{code,data:{list[]},message}`（5 项 / 2,124 B）

| field | actual example | semantic meaning | adapter mapping | UI 用途 |
|---|---|---|---|---|
| `code` / `name` | `"513310"` / `"中韩半导体ETF(QDII)"` | 标识 | 列表卡 | 切换器 |
| `sector` | `"storage"` | 赛道 | `sectorLabel()` | 徽标 |
| `stage` | 同 `stage_summary` 长句 | 后端中文结论 | `stageSummary` | 一行 |
| `action` / `action_label` | `"STRATEGIC_REDUCE"` / `"战略减仓"` | 正式动作 | 同 decision | 徽标 |
| `opportunity_score` / `_grade` | `67` / `"B"` | 机会 | 同 decision | 徽标 |
| `defense` | `"中"` | **后端算好的防守级（中文 高/中/低）**，依据 `high_volume_decline‖W5 ⇒ 高；high_volume_stagnation‖W4 ⇒ 中；否则低` | ⛔ 未适配 | ★ **应直接消费，⛔ 前端不得重算** |
| `current_position` | `8.3` | 当前仓（%） | 同 | |
| `target_position` / `target_min` / `target_std` / `target_max` | `25 / 20 / **25** / 30` | **配置标准带（%）**（来自 `etf_position`，带 fallback） | ⛔ 未适配 | ⚠️ 与 `final_target` 混在**同一对象**里 |
| `final_target` / `suggested_position` | `0.5` / `8.3` | **决策值（%）** | 同 decision | |
| `data_time` | `"2026-09-29"` | 数据时点 | | 新鲜度 |

### A.3 `GET /api/etf/:code/kline?period=daily` → `{code,data:[bar],message}`

`bar = {date, open, high, low, close, volume, amount, premium_rate}` · 320 根 · 39,569 B

| 事实 | 实测 |
|---|---|
| 条数 | 恒 **320**（= `limit`；`[SRC]` weekly 为 260） |
| 日期范围 | 513310 `2023-05-09 → 2024-08-27`；518880 `2023-05-08 → 2024-08-26` |
| 与决策日之差 | **约 2 年**（决策日 2026-09-29） |
| `amount` / `premium_rate` | **320/320 全 `null`** |
| 取数实现（可证） | `db.query(COLLECTIONS.ETF_DAILY, {code}, {orderBy:[{field:'trade_date',direction:'asc'}], limit:320})` ⇒ **升序 + limit 取最旧** |
| 是否存在更新的库内数据 | **`[UNKNOWN]`** —— 需 DB 只读权限才能确证（本轮未取） |

---

## §B ETF Detail ViewModel（建议形状，M4-P1 落地）

```
EtfDetailVm = {
  identity: { code, name, sector, sectorLabel, isQdii, status, maxPositionPct, configTargetPct, asOf }
  decision: {                      // ★ V3 Safety Core 正式权威
    identity: 'V3 Safety Core',
    available, date, action, actionLabel, actionTone,
    finalTargetPct, targetBand{min,std,max}, gapPct, suggestedPct,
    corePositionPct, tradePositionPct,          // ⛔ 建议（decision 块）
    maxPositionPct, risk{flag,label,tone,override}, premiumFlag,
    overAllocPct(label), bindingConstraint, cooldownDays, nextAddCondition,
    opportunity{grade,score,level}, scores{trend,volume,fundamental,crowding,risk},  // ⛔ 不含 total
    eligibility{items[10],overall}, chain[steps], factors{stage,market},  // 系数 0~1
    trendStage{primary, display, overlay, label, source},                 // ★ §3.3
    engineVersion, effectiveMarketRegime
  }
  position: {                      // ★ 实际持仓（≠ decision 建议）
    available, currentPct, configBand{min,std,max}, configTargetPct,
    maxPositionPct, maxStrategicPct, realCorePct, realTradePct,         // ⛔ 实际（position 块）
    suggestedCorePct, suggestedTradePct,                                 // 与 decision 建议同值（去重）
    shares, shareText, avgCost, grade{core,trade}, updatedAt
  }
  risk: { flag, label, tone, override, premiumFlag, events[], premiumRate }
  gen1: {                          // ★ TIMING / ADVISORY（⛔ 不是正式决策）
    sourceChannel: 'CANONICAL' | 'DECISION_LEGACY' | 'NONE',
    channelCaveat, authority, authorityLabel, status, statusLabel, statusTone,
    signal{stage, probability, threshold, modelCandidate, signalStatus},
    stages{signal, baseline, effective},          // ⛔ 三段不得串位
    safetyGate{permission, reasonCode, reason, source, bindingStage, bindingStageSource},
    applicability{domainStatus, domainPermission, label, message},
    counterfactual{targetPct, suggestedPct, deltaPct, stageChanged, clamped},
    dataHealth{status, sourceTradeDate},
    perCardAvailable: boolean
  }
  price: { change5dPct, bias20dPct, pricePositionRatio, premiumRate, atr20Price, vol20Shares }
  kline: { state, bars, lastBarDate, freshness, overlays{ma5..ma250} }   // ★ 必须带新鲜度
  structure: {                     // 看盘（Structure 页复用）
    states{w,d,h,v}, stageSummary, consolidation{trendContext,…}, volume{ratio,slope,highVolume*},
    ma{ma5..ma250}, trendStageState{stage,overlay,displayStage,daysInStage}
  }
  fundamentalsSummary: { fState, fScore, updatedAt, layerBreakdown?, topHoldingsCount? }
  freshness: { snapshot, decision, quote, kline, position, fundamental, overall }
  provenance: { source, blocks[], gen1Channel, fallbackFrom, retrievedAt }
  boundaries: { safetyCoreIdentity, gen1Identity, gen1Note, gen2Identity, gen2Note }
}
```

**语义边界三条硬约束（M4 必须遵守）**

1. `V3 Safety Core → Formal Decision / Authority`；`Gen-1 → Timing / Advisory`；`Gen-2 → Selection / Research / Shadow`。
2. **Gen-1 不得视觉上伪装成正式决策**：Gen-1 区必须有独立身份标题与更弱视觉权重；Gen-1 的 `counterfactual.*` ⛔ 不得覆盖 `decision.finalTargetPct`。
3. **Gen-2 不进入正式 Decision 区**（本页当前也不呈现 Gen-2 数据）。

---

## §C Old → New migration map

| 旧页面位置 | 旧字段路径 | 新 Adapter | 新 Domain | 新 ViewModel | 新 UI | 备注 |
|---|---|---|---|---|---|---|
| **EtfDetail** 标的标签页 | `api.etfList().list[]` | `adaptEtfList`（M4 新增） | `actionLabel/toneForAction` | `identity` | 切换器 | 保留 |
| 标题 | `detail.basic.name/code/sector` | `adaptEtfDetail.basic` | `sectorLabel` | `identity` | 页头 | 保留 |
| ★ Gen-1 首屏卡 | `detail.gen1.advisory.*` | ⛔ **不存在** | — | — | — | **契约从未下发** |
| ★ Gen-1 首屏卡（新） | `detail.gen1`(canonical) 或 `decision.gen1_*`+`ml_shadow`(legacy) | `adaptGen1ForDetail`（M4 新增） | `gen1*Label` | `gen1` | Gen-1 区 | **显式标通道** |
| 近 5 日涨幅 | `snapshot.change_5d` | `snapshot.change5d` | `formatPercent(v,2,true)` | `price.change5dPct` | 首屏 | 保留 |
| 当前仓位 | `position.current_position` | `position.currentPosition` | `formatPercent` | `position.currentPct` | 首屏 | 保留 |
| 风险/溢价/拥挤/基本面行 | `decision.risk_flag / premium_flag / c_state / f_state` | `decision.riskFlag` 等 | `riskLabel/stateLabel` | `decision.risk`/`price.premiumRate` | 首屏 | 保留（溢价新增适配） |
| 技术详情·当前仓位 | `position.current_position` | 同 | `formatPercent` | `position.currentPct` | 折叠区 | `privateValue()` 的「后台查看」→ 改为显式缺失态 |
| 技术详情·目标区间 | `decision.target_min/max` | `decision.targetBand` | `formatPercent` | `decision.targetBand` | 折叠区 | ★ 决策带 |
| 技术详情·建议目标 | `decision.final_target` | `decision.finalTarget` | `formatPercent` | `decision.finalTargetPct` | 折叠区 | 0.5 → `0.5%` |
| 技术详情·建议缺口 | `decision.position_gap` | `decision.positionGap` | `formatPercent(v,1,true)` | `decision.gapPct` | 折叠区 | ⛔ 不重算 |
| 技术详情·建议核心/交易 | `decision.core_position/trade_position` | `decision.corePosition/tradePosition` | `formatPercent` | `decision.*PositionPct` | 折叠区 | ⚠️ **建议**值 |
| 技术详情·超配 | `decision.over_alloc_status` | `decision.overAllocStatus` | `overAllocLabel` | `decision.overAllocPct` | 折叠区 | 中文值 |
| 加仓冷静期 | `decision.cooldown_days` | `decision.cooldownDays` | — | `decision.cooldownDays` | 折叠区 | 保留 |
| 加仓资格 | `decision.add_eligibility`（旧只列 **8 项**） | `decision.addEligibility.items`（**10 项**） | `ELIGIBILITY_ITEMS/eligibilityTone` | `decision.eligibility` | 折叠区 | ★ 补 `cooldown/regime` |
| **模型审计/基线对照**（旧） | `detail.ml_shadow.*` 24 行 | `ml_shadow`(27 键) | — | `gen1.signal/dataHealth`（**只保留真实存在的**） | Gen-1 区 | **16 行恒 `—` ⇒ 删除** |
| 配置标准带（旧未展示） | `position.target_*` | `position.band` | `formatPercent` | `position.configBand` | 新增对照 | ★ 与决策带并列展示 |
| 评分卡 | `decision.scores` | `decision.scores` | `SCORE_DIMENSIONS` + `formatScore` | `decision.scores` | 评分卡 | ⛔ 不显总分 |
| 决策链「为什么」 | `decision.explain_chain` | `decision.explainChain` | `CHAIN_COLLAPSE_AFTER` | `decision.chain` | 折叠 | ⚠️ 见 §7.7 矛盾 |
| 下一加仓条件 | `decision.next_add_condition` | `decision.nextAddCondition` | — | `decision.nextAddCondition` | 折叠 | 保留 |
| 风险条 | `risk_events[0].reason` | `riskEvents` | `toneForRisk` | `risk.events` | 风险条 | 线上为空 ⇒ 不显示 |
| **Structure** K 线 | `api.kline()` | `adaptKline` | — | `kline` | 看盘 | ★ 必须标新鲜度（§7.2） |
| Structure 阶段识别 | `snapshot.{w,d,h,v}_state` | `snapshot.states` | `stateLabel` | `structure.states` | 看盘 | 保留 |
| Structure 横盘详情 | `snapshot.trend_context/sideway_*/ma20_slope/consolidation_score` | `snapshot.consolidation` | `trendContextLabel`（新增） | `structure.consolidation` | 看盘 | 保留 |
| Structure 加仓雷达（旧**前端算**） | `volDrop=(1-volume_ratio)*100`、`price_position*100` | ⛔ 前端派生 | 显式 `formatRatioAsPercent` + `derived:true` | `structure.radar` | 看盘 | ⚠️ 前端派生必须标注 |
| Structure 防守雷达（同上） | `high_volume_*` 布尔 → 100/0 | ⛔ 前端派生 | 同上 | 同上 | 看盘 | ⚠️ 同上 |
| Structure 数据完整提示 | `snapshot.data_complete` | `snapshot.dataComplete` | — | `structure.dataComplete` | 看盘 | 保留 |

---

## §D Payload cleanup matrix（**仅前端消费边界，⛔ 不改 backend**）

| 块 / 字段 | 体积 | 分类 | 前端处置 |
|---|---|---|---|
| `basic`（9 键） | 190 B | **required** | 保留（`_id`/`sort_order` 不消费） |
| `snapshot`（32 键） | 867 B | **required**（`premium_rate` 恒 null ⇒ optional） | 保留 |
| `decision` 被消费部分（≈30 键） | ≈1.5 KB | **required** | 保留 |
| `decision` Gen-1 legacy（56 键） | ≈2.5 KB | **legacy**（契约未部署期间的显式通道） | M4 消费，**显式标注通道** |
| `decision` 影子/审计（≈60 键） | ≈3.5 KB | **unused / dead payload** | ⛔ 不消费；**建议后端后续清理（非本轮）** |
| `position`（27 键） | 1,726 B | **required**（`avg_cost` 恒 null、`pending_*` 恒 null 为 optional） | 保留 |
| `ml_shadow`（27 键） | 702 B | **legacy** | 消费但标通道 |
| `fundamental`（6 键） | 409 B | **required**（摘要）；`detail.layer_breakdown` 属 M6 | 保留 |
| `risk_events` | 2 B | **required**（线上空） | 保留 |
| `fundamental_config`（5 项） | 1,053 B | **unused（本页）** | ⛔ 本页不消费（M6/后台用） |
| `fundamental_series`（5 键） | 1,797 B | **unused（本页）** | ⛔ 本页不消费（M6 用） |
| `holdings` + `holdings_date` | 2,141 B | **unused（本页）** | ⛔ 本页不消费（后台录入用） |
| kline `amount` / `premium_rate` | — | **dead payload**（320/320 null） | ⛔ 不消费；建议后端清理（非本轮） |
| kline 全量 320 根 | 39 KB | **required 但陈旧** | 消费 + ★ 显式新鲜度（§7.2） |

**合计**：本页不消费 ≈ **5.4 KB / 16.6 KB ≈ 33%**（不含 kline）。

---

## §E Fixture matrix（已产出，`web/tests/fixtures/m4/`，17 个 + `_meta.json`）

生成器：`_v365-fe-audit-20260930/tools/gen-m4-fixtures.cjs`（工作区根，⛔ 不入库）。
所有 fixture 均为**响应 `data`**（不含 `{code,data,message}` 信封），与 M2 约定一致。

| 文件 | 场景 | 来源 | 期望行为 |
|---|---|---|---|
| `etf-normal.json` | normal | 线上实测逐字节复制 | 全块可读；Gen-1 走 legacy 通道 |
| `etf-canonical.json` | canonical | 契约模块实跑产出 | 四块在场 ⇒ Gen-1 走 canonical |
| `etf-canonical-null.json` | canonical 字段为 null | 定点突变 5 处 | 一律 MISSING/NULL，⛔ 不当 0、⛔ 不 fallback |
| `etf-decision-missing.json` | decision 缺失 | 删除 `decision` | 动作/仓位/评分/链 全显式未提供 |
| `etf-gen1-missing.json` | Gen-1 三级全空 | 删 `decision.gen1_*` + `ml_shadow` | 「数据未提供」，⛔ 不显示「正常/无信号/关闭」 |
| `etf-stale.json` | stale | 日期突变至 2020 | STALE 且文案 ≠ MISSING |
| `etf-malformed.json` | malformed optional | 手写最小文档 | 不抛异常；无 `undefined/NaN/[object Object]` |
| `etf-target-0.json` | target=0 | 最小文档 | `0.0%` 且 `missing=false` |
| `etf-target-0p5.json` | target=0.5 | 最小文档 | `0.5%`（⛔ 非 50%）；`market_factor=0.25` 是系数 |
| `etf-target-28p5.json` | target=28.5 | 最小文档 | `28.5%`（同 formatter） |
| `etf-risk-normal.json` | risk=normal | 最小文档 | 绿；无风险条 |
| `etf-risk-yellow.json` | risk=yellow + 事件 | 最小文档 + 1 ACTIVE 事件 | 黄；显示原因 |
| `etf-risk-red.json` | risk=red + override | 同上 | 红；覆盖标记可见 |
| `etf-risk-cn.json` | risk=**中文**「正常」 | 最小文档 | 归一后仍为绿（M3 同类缺陷回归守卫） |
| `kline-live60.json` | kline 正常 | 线上实测尾部 60 根 | 可渲染 + 必须标新鲜度 |
| `kline-empty.json` | kline 空 | `[]` | 合法值（0 根）⇒「无行情数据」 |
| `kline-error.json` | kline 错误 | 对象 | 显式 MISSING，不抛异常 |

**已用 M2 适配器冒烟全部 17 个**：`decision-missing` → `decision.available=false`；`target-0/0.5/28.5` → `PROVIDED:0 / 0.5 / 28.5`；`risk-cn` → `PROVIDED:"正常"`；`kline-empty` → `PROVIDED bars=0`；`kline-error` → `MISSING`。✅ 无适配异常。

---

## §F M4 风险清单

### F.1 中英文 enum（★ 6 例实测）
| 字段 | 实测值 | 语言 | 消费侧要求 |
|---|---|---|---|
| `decision.risk_flag` | `"NORMAL"` | 英 | 归一（M3 已加中文别名） |
| `decision.premium_flag` | `"正常"` | **中** | 新增归一（M4）；⛔ 不得假设英文 |
| `decision.over_alloc_status` | `"中度"` | **中** | `overAllocLabel`（已含中英） |
| `etf/list[].defense` | `"中"` | **中** | 直接显示 |
| `basic.sector` / `snapshot.trend_context` / `decision.effective_market_regime` | `storage` / `DOWN_CONSOLIDATION` / `crisis` | 英 | 映射中文 |
| `decision.action_label` / `stage_summary` / `ml_*_reason` | 已中文 | 中 | 直接用 |

⇒ **规则**：任何 enum 的归一**必须先看线上实测值**，⛔ 不得按字段名假设语言（M2/M3 已连续踩两次）。

### F.2 null / missing 混淆
`premium_rate`（snapshot 与 kline 均 null）· `avg_cost` · `ml_shadow.probability/calibrated_probability` · `gen1_model_probability` · `position.pending_*` · `decision.effective_stage`（**不存在**，旧前端读它）· `most_worth`（dashboard）。
⇒ 一律走 `FIELD_STATE.MISSING + NULL_IN_CONTRACT`，⛔ 不显示 0、⛔ 不显示 `—` 冒充「值为空」。

### F.3 endpoint / 块级同名字段不同语义（★ 7 例）
| 字段名 | 来源 A | 来源 B | 差异 |
|---|---|---|---|
| `target_std` | dashboard/decision = **0.5**（决策带） | list/position/basic = **25**（配置带） | 量级 50× |
| `target_min` / `target_max` | decision = `0.4/0.5` | position = `20/30`；list = `20/30` | 同上 |
| `target_position` | decision = `0.5`（决策） | position/basic/list = `25`（配置） | 同上 |
| `trend_stage` | dashboard card = `S0` | etf detail = `S7`（displayStage） | 语义不同 |
| `core_position` | decision = `0.2`（**建议**） | position = `12.6`（**实际**） | 63× |
| `trade_position` | decision = `0.3`（建议） | position = `8.4`（实际） | 28× |
| `stage` | dashboard/list = **长句** | snapshot 无此字段 | — |
⇒ adapter **必须按「来源端点 + 来源块」建字段**，⛔ 不得按字段名统一处理，⛔ 不得建全局 heuristic。

### F.4 百分比 / 系数 / 比例混淆
| 字段 | 单位 | 证据 |
|---|---|---|
| `final_target` / `target_*` / `*_position` / `change_5d` / `bias_20d` / `ma20_slope` / `sideway_range` | **百分数**（数值即 %） | schema desc + 历史分布 + 减法自洽（M2 附录 A） |
| `stage_factor` / `market_factor` | **系数 0~1** | `V3_STAGE_FACTORS` S0..S5 |
| `price_position` | **比例 0~1** | 实测 0.3032 |
| `snapshot.volume_ratio` | **比例 0~1** | 实测 0.6879；旧前端 `(1-ratio)*100` 系**前端派生** |
| `atr20` | **价格**（非 %） | schema `desc:'20 日 ATR'`；`calcATR()` 返回价格；使用处才 `/lastClose*100` |
| `vol20` / `shares` / kline `volume` | **份** | schema `desc:'20 日均量'` |
| `scores.*` / `consolidation_score` / `opportunity_score` | **点数**（⛔ 不加 %） | — |

### F.5 前端自行计算 backend 已计算字段（★ 4 处现存风险）
| 旧实现 | 风险 | M4 处置 |
|---|---|---|
| `defenseLevel()`（前端按 `high_volume_*`/`w_state` 重算） | ⛔ 后端已算好**两处**：`etf/list[].defense`（中文 高/中/低）与 `decision.defense_state.{level,reason,score}` | **改为消费后端值**；本地函数仅作显式 fallback 并标 `derived` |
| `position_gap = final_target − current` | ⛔ 服务端语义是 `max(0, final_target − suggested)`；两法结果不同（0 vs −7.8） | 只展示服务端值 |
| 雷达 `(1-volume_ratio)*100` / `price_position*100` | 前端派生新数字 | 允许，但必须 `derived:true` + UI 标注「派生」 |
| 组合目标合计（M3 已确立） | 无组合级契约 | ⛔ 不出数字 |

### F.6 legacy 字段冒充 canonical
- `ml_shadow.*` 是 **legacy**（`legacy.deprecated` 声明仅存在于契约在场时；线上根本没有 `legacy` 块）。
- `decision.gen1_*` 是 **pre-contract** 平铺字段。
- ⇒ M4 必须新增 `sourceChannel ∈ {CANONICAL, DECISION_LEGACY, NONE}` 并在 UI 显著标注；⛔ 不得让 legacy 值看起来像契约值。

### F.7 Gen-1 / Safety Core 混淆（★ 含两处新发现）
1. **`is_stale=true` 但 `data_age_days=1`、`signal_date=2026-09-29`** —— 两个"新鲜度"口径不一致，`[UNKNOWN]` 何者为准（producer 未逐行核对）。
2. ★ **`explain_chain` 文案与同文档字段矛盾**（`[AS-IS]`）：
   - 链 step 10「仓位缺口 **-7.8pct**」 vs `decision.position_gap = **0**`
   - 链 step 9「核心 **12.6%** · 交易 **0%**」 vs `decision.core_position=**0.2** / trade_position=**0.3**`（12.6 反而等于 `position.core_position`）
   - 链 step 8「目标区间 **[18~24]%** 标准目标 **21%**」 vs `position.target_min/max=**20/30**`（std 25）
   ⇒ 该链是**另一条计算路径**的产物，与决策字段不同源。M4 展示「为什么」时**必须**：或只用链的定性部分（condition 文案），或对数字加「口径待核验」标注。⛔ **不得把链里数字与字段数字并列展示而不解释**。
3. `gen1_counterfactual_target = 0.5` 与 `decision.final_target = 0.5` 数值相同 ⇒ 极易被误读为「Gen-1 决定了目标」。M4 必须在 Gen-1 区显式声明「反事实不改变正式目标」。

### F.8 其余
- **K 线严重陈旧**（§0-2）：M4/M5 必须显式展示 K 线自己的时点，⛔ 不得与 snapshot 日期混用为同一个「数据日期」。
- `risk_events` 线上恒空 ⇒ 风险条无原因可显示，需有「无事件」态。
- 旧 `privateValue()` 把 `null` 显示为**「后台查看」**——把「缺失」说成「权限」是错误归因，M4 改为显式缺失态。
- `etf/list` 单对象内**混装配置带与决策值**（`target_*` 是配置、`final_target` 是决策），跨页对比时极易串味。

---

## §G 待 owner 裁定 / 新登记（M4-P0 新增，⛔ 本轮不处理）

| # | 事项 | 说明 |
|---|---|---|
| M4-D1 | **Gen-1 在 ETF Detail 的通道策略** | canonical 未部署期间：(A) 用 `decision.gen1_*`+`ml_shadow` 平铺字段**显式标「legacy 通道」**渲染（信息量大、但属非契约源）；(B) 只显示「数据未提供」等契约部署（与 M3 Dashboard 同口径，最保守）。**我倾向 A + 显著标注**，但需你拍板 |
| M4-D2 | **K 线陈旧（§0-2）如何呈现** | (A) 照实画出并大字标「行情数据截至 2024-08-27」；(B) 只显示时点提示、不出图；(C) 在置顶 banner 提示「K 线数据源异常」。⛔ 均不改 backend |
| M4-D3 | **`explain_chain` 矛盾（F.7.2）** | (A) 只展示 condition 定性文案、隐藏数字；(B) 全展示但加「口径待核验」标注；(C) 隐藏整条链。属**数据一致性问题**，需你裁定后再决定 UI |
| M4-D4 | `_meta.json` 生成的 fixture 是否算「交付物」 | 我已按 M2 惯例把 generator 放在工作区根（不入库）、fixture 入库。若你要求 generator 也入库以便复现，我下轮搬进 `web/tests/` |

**本轮明确未处理**（按你的指令）：D-8 · `most_worth` · `apiGateway` 部署 · E-006。

---

## §H 本轮边界

```text
代码：⛔ 未写任何组件；⛔ 未改 backend（src/ · cloudfunctions/ 零改动）
      ✅ 仅新增 web/tests/fixtures/m4/（17 fixture + _meta.json）
安全：⛔ 未改 Safety Core / Gen-1 / Gen-2 业务逻辑；⛔ 未改 lock / 冻结件
运维：NO PUSH · NO MERGE · NO DEPLOY · 无 production run
```
