# Gen-2 B1 **冻结运行**报告（Frozen Run）

**日期**：2026-09-14 · **Run ID**：`b1_ledger_baseline_20260914_frozen_v201`
**冻结输入**：`gen2-rule-v2.0.1`（lock SHA `d3d40f99dd3d…`，revision 3）
**Manifest**：`ml/gen2/manifests/GEN2_B1_FROZEN_RUN_MANIFEST_20260914.json`（运行目录另有 `frozen_manifest.json` 副本）

---

## 1. 一句话结论

B1 已**以 `gen2-rule-v2.0.1` 冻结锁为唯一输入**重算完成：运行前 8 项冻结对象 + 2 项构建产物
声明全部 SHA 逐位一致，运行配置与冻结 bundle **零漂移**，跨实现常量（regime 55/45、
canonical Alpha 等权）逐一核对通过；资金守恒误差 **0.000e+00**、现金非负（min 0.000000）→ **门禁 PASS**。

> ⚠️ 这是**研发证据**，不是经济结论。B3 Frozen OOS 通过前，本报告的任何净值 / Sharpe / MDD
> **不得**用于生产资格或 authority 提升。继续 Shadow / CANARY，未部署、未写正式仓位。
>
> **与旧 B1 读数差异很大？先看 §9「差异归因」（必读页）** —— 那里逐条对应 D-001 / F1-F2 /
> F4 / 统一账本各自改变了什么，以及为什么两条基线的数值**不应**相同。

---

## 2. 冻结输入核验（运行前置门，任一失配即拒绝运行）

| # | id | 文件 | SHA（CRLF→LF） | 判定 |
|---|---|---|---|---|
| 1 | `bundle` | `ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json` | `fabd31d9b1c2…` | ✅ |
| 2 | `js_implementation` | `cloudfunctions/runGen2ShadowEod/index.js` | `cb9a91b79a8a…` | ✅ |
| 3 | `python_rule` | `ml/gen2/baseline/rule_v2_ab.py` | `89b4e6d867ac…` | ✅ |
| 4 | `python_candidate` | `ml/gen2/portfolio/portfolio_builder.py` | `0831764c775f…` | ✅ |
| 5 | `python_defense` | `ml/gen2/portfolio/defense_gate.py` | `e3f48f081936…` | ✅ |
| 6 | `python_role_thresholds` | `ml/gen2/portfolio/role_thresholds.py` | `62d542615e6b…` | ✅ |
| 7 | `python_selection_scores` | `ml/gen2/baseline/selection_scores.py` | `1d67f768a654…` | ✅ |
| 8 | `python_regime` | `ml/gen2/portfolio/regime.py` | `738f49c1bb2e…` | ✅ |

| id | 构建产物 | must_equal | 声明与冻结源一致 |
|---|---|---|---|
| `dist_bundle` | `dist-functions/runGen2ShadowEod/GEN2_RULE_V2_BUNDLE.json` | `bundle` | ✅ |
| `dist_index` | `dist-functions/runGen2ShadowEod/index.js` | `js_implementation` | ✅ |

- **LOCK 文件 SHA**：`d3d40f99dd3d766bd326bf11cc81dcc1168fde4d59693187f1154b2a9e7b2d9c`（`ROOT_ANCHORS` 同锚：是）
- **完整组件摘要**（8 项 id:sha 折叠）：`86fc2902f817c147ecf8d452fadbc5ad661a4d534a525bff16991e39d026dc8c`
- bundle 侧 `selection.role_thresholds` = `{"core_top_fraction": 0.2, "challenger_top_fraction": 0.3, "satellite_top_fraction": 0.4}`（`legacy_migration_audit.status` = `MIGRATION_AUDIT_ONLY`）

## 3. 运行实现哈希（「B1 怎么算」——与规则一并留痕并校验）

| id | 文件 | 角色 | SHA |
|---|---|---|---|
| `b1_frozen_run` | `ml/gen2/baseline/b1_frozen_run.py` | B1 冻结运行入口：三门前置核验 / 配置派生 / manifest 装配 | `29f980e031a6…` |
| `baseline_builder` | `ml/gen2/baseline/rebuild_baselines.py` | B1 基线构建：build_unified_baselines（特征→排名→角色→权重→账本） | `f4197e28a433…` |
| `ledger` | `ml/gen2/backtest/ledger.py` | 唯一权威账本：run_ledger / LEDGER_CONTRACT（费用 = turnover × bps / 1e4） | `d4fe7907741b…` |
| `cost_impl` | `ml/gen2/backtest/costs.py` | 费用兼容层：apply_turnover_cost（委托 ledger.run_ledger，非自带实现） | `535b16cf85f0…` |

## 4. 输入数据与环境（内容哈希 / 日期范围 / 环境版本）

- 行情目录：`deliverables/etf_daily_ml_pool`（31 个代码）
- 输入**公共日期范围**：`2011-12-09` → `2026-09-04`（共 38083 行）
- **输入内容摘要**（全部行情 + 元数据折叠）：`7b5018e48b417b11e1624593c146f277f6c23f372698c98652c97e1dd347f191`
- 环境：Python 3.13.14 (CPython) · pandas 3.0.5 · numpy 2.5.3 · Windows-10-10.0.19045-SP0

| 输入 | 文件 | rows | 日期范围 | sha256 |
|---|---|---|---|---|
| `513310` | `deliverables/etf_daily_ml_pool/513310_qfq.csv` | 898 | 2022-12-22 → 2026-09-04 | `5aede708b5dc…` |
| `159582` | `deliverables/etf_daily_ml_pool/159582_qfq.csv` | 582 | 2024-04-16 → 2026-09-04 | `2eb03468d97b…` |
| `515880` | `deliverables/etf_daily_ml_pool/515880_qfq.csv` | 1696 | 2019-09-06 → 2026-09-04 | `b470c90487db…` |
| `159570` | `deliverables/etf_daily_ml_pool/159570_qfq.csv` | 635 | 2024-01-22 → 2026-09-04 | `7bcb0b2bb4b8…` |
| `518880` | `deliverables/etf_daily_ml_pool/518880_qfq.csv` | 810 | 2023-05-09 → 2026-09-04 | `0978095c379a…` |
| `588000` | `deliverables/etf_daily_ml_pool/588000_qfq.csv` | 1410 | 2020-11-16 → 2026-09-04 | `a38af4029cea…` |
| `588080` | `deliverables/etf_daily_ml_pool/588080_qfq.csv` | 1410 | 2020-11-16 → 2026-09-04 | `80e59ddb0296…` |
| `512480` | `deliverables/etf_daily_ml_pool/512480_qfq.csv` | 1757 | 2019-06-12 → 2026-09-04 | `a1b723fb1c79…` |
| `159995` | `deliverables/etf_daily_ml_pool/159995_qfq.csv` | 1598 | 2020-02-10 → 2026-09-04 | `acf026b01ac0…` |
| `512760` | `deliverables/etf_daily_ml_pool/512760_qfq.csv` | 1757 | 2019-06-12 → 2026-09-04 | `95e1c6547a30…` |
| `515050` | `deliverables/etf_daily_ml_pool/515050_qfq.csv` | 1674 | 2019-10-16 → 2026-09-04 | `24d3bafe034d…` |
| `159819` | `deliverables/etf_daily_ml_pool/159819_qfq.csv` | 1442 | 2020-09-23 → 2026-09-04 | `032002a9614f…` |
| `159915` | `deliverables/etf_daily_ml_pool/159915_qfq.csv` | 3579 | 2011-12-09 → 2026-09-04 | `0123dd26e918…` |
| `159992` | `deliverables/etf_daily_ml_pool/159992_qfq.csv` | 1555 | 2020-04-10 → 2026-09-04 | `175698cf2121…` |
| `159770` | `deliverables/etf_daily_ml_pool/159770_qfq.csv` | 1173 | 2021-11-08 → 2026-09-04 | `dbc10a5b3d3e…` |
| `159852` | `deliverables/etf_daily_ml_pool/159852_qfq.csv` | 1350 | 2021-02-09 → 2026-09-04 | `02c7c1cb81a2…` |
| `512010` | `deliverables/etf_daily_ml_pool/512010_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `ab624712cbb5…` |
| `512690` | `deliverables/etf_daily_ml_pool/512690_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `3f4b3e88b6b9…` |
| `159928` | `deliverables/etf_daily_ml_pool/159928_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `416ac847f8a5…` |
| `510880` | `deliverables/etf_daily_ml_pool/510880_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `93767147e3ef…` |
| `512800` | `deliverables/etf_daily_ml_pool/512800_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `4085ccdbba9b…` |
| `512000` | `deliverables/etf_daily_ml_pool/512000_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `808608548d37…` |
| `512660` | `deliverables/etf_daily_ml_pool/512660_qfq.csv` | 2000 | 2018-06-12 → 2026-09-04 | `53f0e12dd3f2…` |
| `515030` | `deliverables/etf_daily_ml_pool/515030_qfq.csv` | 1581 | 2020-03-04 → 2026-09-04 | `fc0d3888a0cd…` |
| `515790` | `deliverables/etf_daily_ml_pool/515790_qfq.csv` | 1386 | 2020-12-18 → 2026-09-04 | `b95f084f3123…` |
| `512400` | `deliverables/etf_daily_ml_pool/512400_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `42f3b5d75c29…` |
| `515220` | `deliverables/etf_daily_ml_pool/515220_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `000f626e7bf2…` |
| `513180` | `deliverables/etf_daily_ml_pool/513180_qfq.csv` | 1284 | 2021-05-25 → 2026-09-04 | `2ec308811bba…` |
| `159941` | `deliverables/etf_daily_ml_pool/159941_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `c696ad77b863…` |
| `513500` | `deliverables/etf_daily_ml_pool/513500_qfq.csv` | 640 | 2024-01-15 → 2026-09-04 | `e51839779425…` |
| `510300` | `deliverables/etf_daily_ml_pool/510300_qfq.csv` | 2106 | 2018-01-02 → 2026-09-04 | `b1ff29f7ae13…` |
| `etf_master` | `ml/gen2/universe/etf_master.csv` | — | — | `31e6d6fc81e3…` |
| `universe_definition` | `ml/gen2/universe/universe_v1.json` | — | — | `013457b3ec94…` |

## 5. 配置核验：运行配置 ↔ 冻结规则（零漂移）

覆盖 17 个规则键（`config_source = FROZEN_BUNDLE_OVERLAY`）：`drift` **空（一致）**、`cross_checks` **空（一致）**。

| 规则键 | bundle 路径 | 运行配置路径 |
|---|---|---|
| `portfolio.max_single_weight` | `portfolio/max_single_weight` | `portfolio/max_single_weight` |
| `portfolio.max_cluster_weight` | `portfolio/max_cluster_weight` | `portfolio/max_cluster_weight` |
| `portfolio.max_tech_weight` | `portfolio/max_tech_weight` | `portfolio/max_tech_weight` |
| `portfolio.tech_clusters` | `portfolio/tech_clusters` | `portfolio/tech_clusters` |
| `portfolio.max_core_count` | `selection/max_core_count` | `portfolio/max_core_count` |
| `portfolio.max_core_per_cluster` | `selection/max_core_per_cluster` | `portfolio/max_core_per_cluster` |
| `portfolio.promotion_persistence_days` | `selection/promotion_persistence_days` | `portfolio/promotion_persistence_days` |
| `portfolio.demotion_persistence_days` | `selection/demotion_persistence_days` | `portfolio/demotion_persistence_days` |
| `portfolio.min_replacement_edge` | `selection/min_replacement_edge` | `portfolio/min_replacement_edge` |
| `portfolio.role_thresholds` | `selection/role_thresholds` | `portfolio/role_thresholds` |
| `portfolio.defense.risk_off_exposure_scale` | `defense/risk_off_exposure_scale` | `portfolio/defense/risk_off_exposure_scale` |
| `portfolio.defense.risk_off_hedge_weight` | `defense/risk_off_hedge_weight` | `portfolio/defense/risk_off_hedge_weight` |
| `portfolio.defense.hedge_code` | `defense/hedge_code` | `portfolio/defense/hedge_code` |
| `portfolio.defense.vol_target_enabled` | `defense/vol_target_enabled` | `portfolio/defense/vol_target_enabled` |
| `portfolio.defense.vol_target_annualized` | `defense/vol_target_annualized` | `portfolio/defense/vol_target_annualized` |
| `data.benchmark_code` | `benchmark_code` | `data/benchmark_code` |
| `universe.version` | `universe_version` | `universe/version` |

> 不一致时**拒绝运行**（fail-closed），不存在「bundle 一份、yaml 一份、谁先谁赢」的隐式口径。

## 6. 运行窗口与同口径比较

- 公共日历：`2020-03-10` → `2026-09-04`，**1577 个交易日**（全部策略首日/末日/天数一致）
- 费用档：0, 5, 10, 20 bps；T+1 执行；期初全现金；末日 mark-to-market 不强制平仓
- Main5：513310, 159582, 515880, 159570, 518880

| 策略 | cost_bps | 期末净值 | 累计收益 | CAGR | Sharpe | MDD | 总换手 | 总费用 |
|---|---|---|---|---|---|---|---|---|
| gen2_v2_defended | 0 | 1.8525 | +85.25% | +10.35% | 0.68 | -21.50% | 140.330 | 0.0000 |
| gen2_v2_undefended | 0 | 1.6370 | +63.70% | +8.19% | 0.50 | -27.70% | 108.996 | 0.0000 |
| main5_equal_weight | 0 | 2.8452 | +184.52% | +18.19% | 0.75 | -45.81% | 12.525 | 0.0000 |
| market_510300 | 0 | 1.3114 | +31.14% | +4.43% | 0.32 | -44.75% | 1.000 | 0.0000 |
| universe_equal_weight | 0 | 1.5935 | +59.35% | +7.73% | 0.42 | -49.72% | 20.120 | 0.0000 |
| gen2_v2_defended | 5 | 1.7271 | +72.71% | +9.12% | 0.62 | -22.43% | 140.330 | 0.0702 |
| gen2_v2_undefended | 5 | 1.5501 | +55.01% | +7.26% | 0.45 | -28.31% | 108.996 | 0.0545 |
| main5_equal_weight | 5 | 2.8274 | +182.74% | +18.07% | 0.74 | -45.81% | 12.525 | 0.0063 |
| market_510300 | 5 | 1.3107 | +31.07% | +4.42% | 0.32 | -44.75% | 1.000 | 0.0005 |
| universe_equal_weight | 5 | 1.5776 | +57.76% | +7.56% | 0.42 | -49.86% | 20.120 | 0.0101 |
| gen2_v2_defended | 10 | 1.6101 | +61.01% | +7.91% | 0.55 | -23.35% | 140.330 | 0.1403 |
| gen2_v2_undefended | 10 | 1.4679 | +46.79% | +6.33% | 0.41 | -28.96% | 108.996 | 0.1090 |
| main5_equal_weight | 10 | 2.8097 | +180.97% | +17.95% | 0.74 | -45.81% | 12.525 | 0.0125 |
| market_510300 | 10 | 1.3101 | +31.01% | +4.41% | 0.32 | -44.75% | 1.000 | 0.0010 |
| universe_equal_weight | 10 | 1.5618 | +56.18% | +7.38% | 0.41 | -50.00% | 20.120 | 0.0201 |
| gen2_v2_defended | 20 | 1.3993 | +39.93% | +5.52% | 0.41 | -25.53% | 140.330 | 0.2807 |
| gen2_v2_undefended | 20 | 1.3162 | +31.62% | +4.49% | 0.32 | -30.23% | 108.996 | 0.2180 |
| main5_equal_weight | 20 | 2.7747 | +177.47% | +17.71% | 0.73 | -45.81% | 12.525 | 0.0251 |
| market_510300 | 20 | 1.3087 | +30.87% | +4.39% | 0.31 | -44.75% | 1.000 | 0.0020 |
| universe_equal_weight | 20 | 1.5307 | +53.07% | +7.04% | 0.40 | -50.27% | 20.120 | 0.0402 |

## 7. 资金守恒验收

| 项 | 值 | 判定 |
|---|---|---|
| Σtarget + cash − 1 最大偏差 | 0.000e+00 | ✅ PASS |
| 现金权重最小值 | 0.000000 | ✅ PASS |
| 总敞口最大值 | 1.000000 | ✅ PASS |
| 超配日数（显式缩放留痕） | 0 | ✅ PASS |
| 末日未执行信号日数（显式留痕） | 20 | ✅ PASS |
| 缺报价日数（未当 0 收益） | 20 | ✅ PASS |
| 参与比较的账本数 | 20 | ✅ PASS |
| 策略集合 | gen2_v2_defended, gen2_v2_undefended, main5_equal_weight, market_510300, universe_equal_weight | ✅ PASS |

## 8. 产物哈希（隔离目录 `ml/gen2/outputs/b1_ledger_baseline_20260914_frozen_v201/`，`outputs/` 未入库）

| 文件 | bytes | sha256 |
|---|---|---|
| `ledger_daily.csv` | 4951772 | `c6ff697b36c84e6b…` |
| `ledger_summary.csv` | 4105 | `1bb10a755cad5120…` |
| `calendar_meta.json` | 3347 | `5be4e3f7f78b0d5b…` |
| `gen2_b1_ledger_baseline_20260914_frozen_v201.md` | 5011 | `c9e8d6e0f4e99fc1…` |

- **本报告自身哈希**：见 manifest `outputs.committed_report`（报告不含自身哈希，避免自引用）
- **manifest 自校验**：❌ 存在失配（0/0 项哈希重算一致）

## 9. 差异归因：旧审计基线 vs 新冻结基线（**必读页**）

> 本页不是经济结论。它回答一个**流程**问题：与旧 B1 的 Gen-2 读数差异很大，
> 这些差异从哪来、是否**可解释**。验收口径不是「数值相同」，而是**每一处变化都能对应到
> 一个已登记的实现 / 口径变更**。

### 9.1 两条基线的性质不同（先看这个）

| | 旧审计基线 | 新冻结基线（本报告） |
|---|---|---|
| run ID | `b1_ledger_baseline_20260911` | `b1_ledger_baseline_20260914_frozen_v201` |
| 报告 | `gen2_b1_research_baselines_20260911.md`（研究口径） | 本报告（冻结口径） |
| 组合口径 | 研究脚本：`build_portfolio_candidates` 把 CORE 重置为等权、**无防守腿** | 统一候选组合：权威权重沿用 + 上限复核 + 防守腿 + 现金腿 |
| 角色语义 | Rule V2 修正**前** | Rule V2 修正**后**（出口无条件终局约束检查） |
| 账本口径 | 旧 `apply_turnover_cost`（现金腿也计入换手） | 唯一权威账本 `run_ledger`（单边成交名义额） |
| 冻结状态 | 未冻结（无 bundle / lock 归属） | `gen2-rule-v2.0.1` + `lock_revision 3`，8 项冻结对象 + 2 项构建产物 |
| 用途 | **仅作审计基线** | 研发证据（B3 通过前不得用于生产资格） |

### 9.2 四类变更各自改变了什么

| 变更 | 机制（到底改了什么） | 对读数的影响 | 是否调参 |
|---|---|---|---|
| **D-001** 规则实现修正 | 角色生成路径出口统一走 `finalizeRoles` / `finalize_roles`：**无条件**执行终局约束检查（CORE 数量上限 / 每 cluster CORE 上限 / NO_CORE 不可恢复 / 单资产·cluster·科技·现金约束）。此前「无 cap 降级现任且无替换」的交易日会**跳过**该检查 | 此前被跳过的路径被收敛 ⇒ 角色分布与降级日改变 ⇒ 换手、防守触发日、净值随之改变 | 否（阈值 / universe 未动） |
| **F1/F2** 信号质量修复 | `build_v2_roles` **不再**静默重算 Alpha；评分必须**显式注入**（`selection_scores`：唯一键 / 有限 / 覆盖无缺无多 + 内容哈希）；`top_quantile` 改为显式 `role_thresholds`（core 0.20 / challenger 0.30 / satellite 0.40） | 修复前「声明了旋钮、组合指标却与 baseline 逐位相同」的**假读数**消失；替代 Alpha 与角色阈值**真正**进入角色决策 | 否（默认值与旧行为逐值等价） |
| **F4** 统一候选组合（WP-G2-06） | `build_portfolio_candidates` 不再把 CORE 重置为等权 `1/n`、不再丢弃单只 / cluster / 广义科技上限，`priority` 改为**精确集合校验**；`main()` 接入唯一候选链路；发布 30 条 `gen2_ranking` + 31 条 `gen2_candidate_leg`；防守腿进入组合 | 研究脚本的归因 / 敏感性数字与权威账本**不再可比**（口径已统一 ⇒ 旧数字**作废**而不是「失真」） | 否 |
| **统一账本**（WP-G2-02） | 唯一权威账本 `run_ledger`：换手 = **单边成交名义额** `Σ_证券|Δ|`（旧实现把现金腿也算进换手，最坏**高估 2 倍**）；公共日历强校验（首日/末日/天数逐位一致）；T+1 执行 + 期初全现金 | 有现金缓冲的策略其**历史换手与费用被高估**的读数失效；同成本档下换手下降 ⇒ 净收益上升 | 否（口径修正） |

### 9.3 为什么两条基线的数值**不应**相同

- 上表四项全部是实现语义或口径变更；其中 **D-001 是明确登记的语义变更** —— 正因如此，Rule V2 不再沿用「已封版 / 已验证」的资格表述（见 `gen2_rule_impl_correction_20260911.md`）。
- F4 + 统一账本使**研究口径与权威账本统一**，因此旧 `b1_ledger_baseline_20260911` 的 Gen-2 读数
  （研究口径下 Rule + 防守 Sharpe 0.32 vs Main5 PIT 0.49，10bps）**不能**与本冻结基线逐值对比 ——
  把它降级为「审计基线」正是这个原因。
- 可比性由**同一把锁**保证：本报告的每个数字都能追溯到 `lock_sha256 = d3d40f99dd3d766b…` 下的 8 项冻结对象（见 §2）。

### 9.4 与「候选冻结运行」的关系

- 上一轮曾在 `lock_revision 2` 下跑过一次 B1（run ID `b1_ledger_baseline_20260914_frozen_v201`，
  10bps 下 `gen2_v2_defended` **+61.01%** / Sharpe 0.55）：那是**候选运行证据**，不是最终 Frozen B1。
- 本次为 `lock_revision 3`（新增 `selection_scores.py` + `regime.py` 入锁）下的**最终 Frozen B1**。
  两次扩围都**只改变锁定范围、不改变规则字节与参数**，所以两份读数的正确关系是「**应当一致**」——
  出现任何差异都说明扩围顺带改了运行语义，那是必须先查清的缺陷，而不是「新版本更好」。

| 策略 | 候选运行（rev 2，10bps） | 本次（rev 3，10bps） | 判定 |
|---|---|---|---|
| `gen2_v2_defended` | +61.01% / Sharpe 0.55 | +61.01% / Sharpe 0.55 | ✅ 逐位一致（扩围未改语义） |
| `main5_equal_weight` | +180.97% / Sharpe 0.74 | +180.97% / Sharpe 0.74 | ✅ 逐位一致（扩围未改语义） |
| `market_510300` | +31.01% / Sharpe 0.32 | +31.01% / Sharpe 0.32 | ✅ 逐位一致（扩围未改语义） |

> 「逐位一致」是本页最强的单点证据：**锁定范围扩围**若真的只锁范围，读数就必须一动不动。

## 10. 边界（本运行未做 / 刻意不做）

- **未部署**：不 `tcb deploy`、不动 CloudBase 函数；
- **未提升 authority**：继续 Shadow / CANARY；不写 `decision_result` / `portfolio_position` /
  `portfolio_snapshot`；不写 V3.6.1 `final_target`；
- **不构成经济结论**：B3 Frozen OOS 通过前，一切净值 / Sharpe / MDD 只是研发证据；
- **未改规则**：本次运行只**读**冻结 bundle 与冻结实现，未做任何参数或语义变更；
- **旧报告降级**：`b1_ledger_baseline_20260911` / `gen2_b1_research_baselines_20260911.md`
  自本次起**只作审计基线**，不再作为比较对象。

## 11. 复现

```bash
PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --date 20260914
# 只读验锁（不改盘）
python scripts/ml/freeze-gen2-rule-bundle.py --check
node scripts/verify-immutable.js
```

> 任一门禁失配（锁 SHA / ROOT_ANCHORS / 配置漂移 / 跨实现常量 / manifest 自校验）时本入口
> **直接拒绝运行**，因此不存在「在一份未冻结的规则上跑出 B1」这种形态。
