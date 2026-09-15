# Gen-2 B1 冻结运行报告（Frozen Run）· 待合并

**运行状态**：**待合并冻结运行**（PENDING-MERGE FROZEN RUN）
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
> **状态口径（本次复核结论）**：在 **① 冻结 PR 合并 → ② B1 PR 自动改基后合并 → ③ 独立的
> 接受记录 PR 合并** 这三步完成之前，本产出的正确表述是「**待合并冻结运行**」，**不是**项目
> 最终 Frozen B1；也因此**不得**据此启动 B3。接受条件、四项校验与流程见 **§12**。
>
> **与旧 B1 读数差异很大？先看 §9「差异归因」** —— 那里给出**可审计的数值对照表**
> （0/5/10/20bps × 逐策略 × 净值/CAGR/Sharpe/换手/成本/差异），并逐项标注
> D-001 / F1-F2 / F4 / 统一账本的归因。

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
| `b1_frozen_run` | `ml/gen2/baseline/b1_frozen_run.py` | B1 冻结运行入口：三门前置核验 / 配置派生 / manifest 装配 | `4aeb19dedadc…` |
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
| `calendar_meta.json` | 3347 | `baebaf18d010300c…` |
| `gen2_b1_ledger_baseline_20260914_frozen_v201.md` | 5011 | `c9e8d6e0f4e99fc1…` |

- **本报告自身哈希**：见 manifest `outputs.committed_report`（报告不含自身哈希，避免自引用）
- **manifest 自校验（报告写出前执行，不含报告自身哈希）**：✅ 全部通过（52/52 项哈希重算一致）
- **manifest 完整自校验（含本报告哈希）**：结果写入 manifest `self_check`；`all_pass=false` 时本入口抛 `FrozenAttestationError` 并**拒绝产出交付物** —— 因此本报告存在即等价于「完整自校验已通过」，此处不重复断言。

## 9. 差异归因：旧审计基线 vs 本次冻结运行（**必读页**）

> 本页不是经济结论。它回答**流程**问题：与旧 B1 的 Gen-2 读数差异很大，这些差异从哪来、
> 是否**可解释**。验收口径**不是「数值相同」**，而是「每一处变化都对应一个已登记的实现 /
> 口径变更，且数值差异可被数据解释」。
>
> **数据来源（可审计，非手工誊抄）**：本页表格由**两边的 `ledger_summary` 数据**生成 ——
> 旧基线读数取自**入库快照** `ml/gen2/manifests/GEN2_B1_AUDIT_BASELINE_20260911.json`
> （其转写来源 `ml/gen2/outputs/b1_ledger_baseline_20260911/ledger_summary.csv`，字节 sha256 `53327be86701460b…`；快照自身 sha256 `ff888278daf96b70…`）；
> 本次读数取自本运行隔离目录 `ml/gen2/outputs/b1_ledger_baseline_20260914_frozen_v201/ledger_summary.csv`。
>
> **口径限定（本页结论的适用范围）**：本页全部归因**只**在「**2026-09-11 审计基线** vs
> **本次运行**、**相同窗口 / 相同数据**」这一组对照内成立。它是**这一次对照**的结论，
> **不是**「F4 在一切历史结果上都是唯一原因」这类**普遍因果断言** —— 换一组基线 / 窗口 /
> 数据，必须重做本页。

### 9.0 可对照性判定（先看这里：不一致则 Δ 不可解释）

| 口径 | 旧审计基线快照 | 本次运行 | 一致？ |
|---|---|---|---|
| 窗口 | `2020-03-10` → `2026-09-04`（1577 日） | `2020-03-10` → `2026-09-04`（1577 日） | ✅ |
| 成本档（bps） | 0, 5, 10, 20 | 0, 5, 10, 20 | ✅ |

✅ **可对照**：两侧窗口一致 ⇒ 下表的 Δ = 本次 − 旧基线，逐格相减有意义；
§9.4 的基准控制项据此生效。

### 9.1 数值对照表（净值 / CAGR / Sharpe / 换手 / 成本，含差异）

口径：**Δ = 本次 − 旧审计基线**；净值 = 期末净值（累计收益 = 净值 − 1）。
公共窗口 `2020-03-10` → `2026-09-04`（1577 日）。

#### cost = 0 bps（**毛收益口径**：Δ 全部来自持仓 / 权重路径（无费用））

| 策略 | 净值 旧 | 净值 新 | Δ净值 | CAGR 旧 | CAGR 新 | ΔCAGR(pp) | Sharpe 旧 | Sharpe 新 | ΔSharpe | 换手 旧 | 换手 新 | Δ换手 | 成本 旧 | 成本 新 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gen2_v2_defended | 2.5778 | 1.8525 | -0.7253 | +16.34% | +10.35% | -5.98 | 0.79 | 0.68 | -0.11 | 233.117 | 140.330 | -92.787 | 0.0000 | 0.0000 |
| gen2_v2_undefended | 1.9715 | 1.6370 | -0.3345 | +11.46% | +8.19% | -3.26 | 0.52 | 0.50 | -0.03 | 200.495 | 108.996 | -91.499 | 0.0000 | 0.0000 |
| main5_equal_weight | 2.8452 | 2.8452 | +0.0000 | +18.19% | +18.19% | +0.00 | 0.75 | 0.75 | +0.00 | 12.525 | 12.525 | +0.000 | 0.0000 | 0.0000 |
| universe_equal_weight | 1.5935 | 1.5935 | +0.0000 | +7.73% | +7.73% | +0.00 | 0.42 | 0.42 | +0.00 | 20.120 | 20.120 | +0.000 | 0.0000 | 0.0000 |
| market_510300 | 1.3114 | 1.3114 | +0.0000 | +4.43% | +4.43% | +0.00 | 0.32 | 0.32 | +0.00 | 1.000 | 1.000 | +0.000 | 0.0000 | 0.0000 |

#### cost = 5 bps（含费用）

| 策略 | 净值 旧 | 净值 新 | Δ净值 | CAGR 旧 | CAGR 新 | ΔCAGR(pp) | Sharpe 旧 | Sharpe 新 | ΔSharpe | 换手 旧 | 换手 新 | Δ换手 | 成本 旧 | 成本 新 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gen2_v2_defended | 2.2943 | 1.7271 | -0.5672 | +14.19% | +9.12% | -5.07 | 0.71 | 0.62 | -0.09 | 233.117 | 140.330 | -92.787 | 0.1166 | 0.0702 |
| gen2_v2_undefended | 1.7834 | 1.5501 | -0.2332 | +9.69% | +7.26% | -2.43 | 0.47 | 0.45 | -0.02 | 200.495 | 108.996 | -91.499 | 0.1002 | 0.0545 |
| main5_equal_weight | 2.8274 | 2.8274 | +0.0000 | +18.07% | +18.07% | +0.00 | 0.74 | 0.74 | +0.00 | 12.525 | 12.525 | +0.000 | 0.0063 | 0.0063 |
| universe_equal_weight | 1.5776 | 1.5776 | +0.0000 | +7.56% | +7.56% | +0.00 | 0.42 | 0.42 | +0.00 | 20.120 | 20.120 | +0.000 | 0.0101 | 0.0101 |
| market_510300 | 1.3107 | 1.3107 | +0.0000 | +4.42% | +4.42% | +0.00 | 0.32 | 0.32 | +0.00 | 1.000 | 1.000 | +0.000 | 0.0005 | 0.0005 |

#### cost = 10 bps（含费用）

| 策略 | 净值 旧 | 净值 新 | Δ净值 | CAGR 旧 | CAGR 新 | ΔCAGR(pp) | Sharpe 旧 | Sharpe 新 | ΔSharpe | 换手 旧 | 换手 新 | Δ换手 | 成本 旧 | 成本 新 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gen2_v2_defended | 2.0419 | 1.6101 | -0.4318 | +12.08% | +7.91% | -4.18 | 0.62 | 0.55 | -0.08 | 233.117 | 140.330 | -92.787 | 0.2331 | 0.1403 |
| gen2_v2_undefended | 1.6131 | 1.4679 | -0.1453 | +7.94% | +6.33% | -1.62 | 0.41 | 0.41 | -0.00 | 200.495 | 108.996 | -91.499 | 0.2005 | 0.1090 |
| main5_equal_weight | 2.8097 | 2.8097 | +0.0000 | +17.95% | +17.95% | +0.00 | 0.74 | 0.74 | +0.00 | 12.525 | 12.525 | +0.000 | 0.0125 | 0.0125 |
| universe_equal_weight | 1.5618 | 1.5618 | +0.0000 | +7.38% | +7.38% | +0.00 | 0.41 | 0.41 | +0.00 | 20.120 | 20.120 | +0.000 | 0.0201 | 0.0201 |
| market_510300 | 1.3101 | 1.3101 | +0.0000 | +4.41% | +4.41% | +0.00 | 0.32 | 0.32 | +0.00 | 1.000 | 1.000 | +0.000 | 0.0010 | 0.0010 |

#### cost = 20 bps（含费用）

| 策略 | 净值 旧 | 净值 新 | Δ净值 | CAGR 旧 | CAGR 新 | ΔCAGR(pp) | Sharpe 旧 | Sharpe 新 | ΔSharpe | 换手 旧 | 换手 新 | Δ换手 | 成本 旧 | 成本 新 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gen2_v2_defended | 1.6171 | 1.3993 | -0.2178 | +7.98% | +5.52% | -2.47 | 0.46 | 0.41 | -0.05 | 233.117 | 140.330 | -92.787 | 0.4662 | 0.2807 |
| gen2_v2_undefended | 1.3197 | 1.3162 | -0.0036 | +4.53% | +4.49% | -0.05 | 0.30 | 0.32 | +0.02 | 200.495 | 108.996 | -91.499 | 0.4010 | 0.2180 |
| main5_equal_weight | 2.7747 | 2.7747 | +0.0000 | +17.71% | +17.71% | +0.00 | 0.73 | 0.73 | +0.00 | 12.525 | 12.525 | +0.000 | 0.0251 | 0.0251 |
| universe_equal_weight | 1.5307 | 1.5307 | +0.0000 | +7.04% | +7.04% | +0.00 | 0.40 | 0.40 | +0.00 | 20.120 | 20.120 | +0.000 | 0.0402 | 0.0402 |
| market_510300 | 1.3087 | 1.3087 | +0.0000 | +4.39% | +4.39% | +0.00 | 0.31 | 0.31 | +0.00 | 1.000 | 1.000 | +0.000 | 0.0020 | 0.0020 |

### 9.2 Δ 的两段分解：毛收益效应 vs 成本拖累变化

净值口径恒等式：累计收益 ≈ 毛收益 − 成本拖累。因此 `Δ(0bps)` **纯净地**反映持仓 / 权重路径差异，
`Δ(10bps) − Δ(0bps)` 反映**费用**差异。

| 策略 | 毛收益效应 Δ(0bps) | 成本拖累 旧@10bps | 成本拖累 新@10bps | 成本拖累缓解 | 净效应 Δ(10bps) |
|---|---|---|---|---|---|
| gen2_v2_defended | -72.53pp | 53.59pp | 24.24pp | +29.35pp | -43.18pp |
| gen2_v2_undefended | -33.45pp | 35.83pp | 16.91pp | +18.92pp | -14.53pp |
| main5_equal_weight | +0.00pp | 3.54pp | 3.54pp | +0.00pp | +0.00pp |
| market_510300 | +0.00pp | 0.13pp | 0.13pp | +0.00pp | +0.00pp |
| universe_equal_weight | +0.00pp | 3.17pp | 3.17pp | +0.00pp | +0.00pp |

> 读法：**毛收益效应是主动作，成本拖累变化是反向缓冲。**

### 9.3 逐项归因：四项已登记变更各自是否构成本次 Δ（**限本次同窗口对照**）

> **结论的适用范围**：本节（含 §9.5 的方向性说明）**只**回答「在 **2026-09-11 审计基线** 与
> **本次运行**、**相同窗口 / 相同数据**的对照中，**F4 是唯一实质来源**」。**不**推广为对
> 所有历史结果的普遍因果结论；也不表示 F4 在其它窗口 / 数据下必然仍是主导项。

**判定规则**（不是叙述）：把「旧基线产出时点」与各变更的落地时点比对 —— 落在旧基线**之内**的变更
**不可能**解释本次 Δ（它只能解释「旧基线与更早报告」的差异）；落在旧基线**之后**的才可能。
旧基线产出时点 = `2026-09-11 14:21`（其 `ledger_summary.csv` 文件 mtime）。

> 本节是**时点判定**（与运行窗口无关）⇒ 即使在 §9.0 的「不可对照」模式下**依然有效**：
> 它回答「哪些变更**有可能**解释差异」，但**不能**回答「差异有多大」（那需要可对照的数值表）。

| 变更 | 落地 commit | 落地时间 | 落在旧基线内？ | 能解释本次 Δ？ | 对本次 Δ 的数值贡献 |
|---|---|---|---|---|---|
| **D-001** 规则实现修正：出口无条件终局约束检查 | `2349353` | 2026-09-11T11:06:26+08:00 | ✅ 是 | ❌ 否 | 无（已在旧基线内生效） |
| **F1/F2** 信号质量修复：Alpha 显式注入 + 角色阈值显式化 | `363ad53` | 2026-09-11T17:04:59+08:00 | ❌ 否（落在旧基线之后） | ❌ 否 | 无（默认配置与旧行为逐值等价） |
| **F4** 统一候选组合（WP-G2-06） | `2b425b8`, `5ad7555` | 2026-09-14T11:52:13+08:00, 2026-09-14T13:15:08+08:00 | ❌ 否（落在旧基线之后） | ✅ 是 | **全部**（本次对照） |
| **统一账本** 唯一权威账本（WP-G2-02） | `03cf814` | 2026-09-11T14:58:45+08:00 | ✅ 是 | ❌ 否 | 无（已在旧基线内生效） |

**机制（这些变更到底改了什么）**

- **D-001**：角色生成路径出口统一走 `finalizeRoles` / `finalize_roles`，**无条件**执行终局约束检查（CORE 数量上限 / 每 cluster CORE 上限 / NO_CORE 不可恢复 / 单资产·cluster·科技·现金约束）；此前「无 cap 降级现任且无替换」的交易日会**跳过**该检查。 → 影响面：角色分布 / 降级日 → 换手、防守触发日、净值
- **F1/F2**：`build_v2_roles` 不再静默重算 Alpha（评分必须显式注入并带覆盖校验与内容哈希）；`top_quantile` 改为显式 `role_thresholds`。 → 影响面：修复前「声明了旋钮、组合指标却与 baseline 逐位相同」的假读数消失
- **F4**：`build_portfolio_candidates` 不再把 CORE 重置为等权 `1/n`、不再丢弃单只 / cluster / 广义科技上限；`priority` 改为显式注入的未四舍五入 selection score；候选新增现金腿与防守腿；`main()` 接入唯一候选链路。 → 影响面：候选权重语义（1/n 等权 → 权威 target_weight + 上限）→ 敞口、换手、费用、净值
- **统一账本**：换手 = **单边成交名义额** `Σ_证券|Δ|`（更早的实现在现金腿**重复计费**，最坏把换手与费用高估 2 倍）；公共日历强校验；T+1 执行 + 期初全现金。 → 影响面：换手与费用口径（费用偏高 ⇒ 净收益偏低）

### 9.4 控制项：基准策略逐位相同（可机检）

基准策略（`main5_equal_weight`, `market_510300`, `universe_equal_weight`）**不经过规则实现** ⇒ 它们的 Δ 必须**恰为 0**；为 0 同时独立证明
**账本契约与基准路径未变** —— 也就是「统一账本」不构成本次 Δ 的来源。

| 控制项 | 值 | 判定 |
|---|---|---|
| 基准策略累计收益最大绝对差（全成本档） | 0.000e+00 | ✅ 逐位相同 |
| 基准策略换手（旧 → 新，@0bps） | main5_equal_weight 12.52542→12.52542 / universe_equal_weight 20.12027→20.12027 / market_510300 1.00000→1.00000 | ✅ |

**旧基线的权重语义（实测证据，解释 Δ 的方向）**

| 观测 | 证据 |
|---|---|
| 旧基线的候选权重是 1/n 等权（丢弃 bundle 的单只/cluster/科技上限） | `ml/gen2/outputs/b1_ledger_baseline_20260911/research/rule_rotation/portfolio_candidates.csv`；`2020-05-27: CORE=1 → target_weight=1.0（= 1/1）`；`2023-06-30: CORE=3 → 每只 target_weight=0.333333（= 1/3），合计 1.0` |
| bundle 上限被旧实现丢弃 | `portfolio.max_single_weight = 0.25`；`portfolio.max_cluster_weight = 0.4`；`portfolio.max_tech_weight = 0.65`；`selection.max_core_count = 5` |
| 现金/敞口对照（defended @0bps） | 旧：非零现金 1107 日、均值 0.42874；新：非零现金 1423 日、均值 0.58967 |

### 9.5 旧基线的数字为什么变了（**方向性说明，已更正**）

- **统一账本的方向（更正）**：更早的实现把**现金腿重复计入换手** ⇒ 换手与**费用被高估** ⇒
  **净收益被低估、表现更悲观**。此前把这里写成「旧读数偏乐观」是**错误的**，本版已更正。
  但请同时注意：**本次 Δ 与统一账本无关** —— 统一账本早已在旧审计基线内生效（§9.3 判定 + §9.4 机检）。
- **本次 Δ 的方向由 F4 决定**（旧基线在权重语义上把 `1/n` 等权当作组合，并丢弃上限）：
  - 旧基线在 CORE 只有 1 只时把 **100%** 押在单只（例如 `2020-05-27` 的 `target_weight = 1.0`），
    远超 bundle 的 `max_single_weight = 0.25` ⇒ **敞口更高、换手更大**；
  - 在 2020–2026 这段行情里，这种集中敞口换来**更高的毛收益**：毛收益效应 **-72.53pp**；
  - 同时更高的换手带来更重的费用：成本拖累 **53.59pp → 24.24pp**（@10bps），
    缓解 **+29.35pp**；
  - 净效应 **-43.18pp**（@10bps）：**毛收益的下降（-72.53pp）大于费用的缓解（+29.35pp）**，
    所以旧基线看起来「更好」**不是因为旧账本更乐观**，而是因为旧的组合口径把上限约束**当成了不存在**。

### 9.6 与「候选冻结运行」的关系（扩锁未改语义）

> **口径澄清**：rev2 与 rev3 读数一致**只能**证明「扩锁未改变运行语义」，
> **不能**代替 §9.1–§9.5 对「旧基线为何变化」的量化解释。两者是不同的问题。

- 上一轮曾在 `lock_revision 2` 下跑过一次 B1（10bps 下 `gen2_v2_defended` **+61.01%** / Sharpe 0.55）：
  那是**候选运行证据**，不是最终 Frozen B1。
- 本次为 `lock_revision 3` 下的运行。两次扩围都**只改变锁定范围、不改变规则字节与参数**，
  所以两份读数的正确关系是「**应当一致**」—— 出现差异即说明扩围顺带改了运行语义（缺陷）。

| 策略 | 候选运行（rev 2，10bps） | 本次（rev 3，10bps） | 判定 |
|---|---|---|---|
| `gen2_v2_defended` | +61.01% / Sharpe 0.55 | +61.01% / Sharpe 0.55 | ✅ 逐位一致（扩锁未改语义） |
| `main5_equal_weight` | +180.97% / Sharpe 0.74 | +180.97% / Sharpe 0.74 | ✅ 逐位一致（扩锁未改语义） |
| `market_510300` | +31.01% / Sharpe 0.32 | +31.01% / Sharpe 0.32 | ✅ 逐位一致（扩锁未改语义） |

> 「逐位一致」是本页**针对扩锁**最强的单点证据：若扩围真的只锁范围，读数就必须一动不动。


## 10. 边界（本运行未做 / 刻意不做）

- **未部署**：不 `tcb deploy`、不动 CloudBase 函数；
- **未提升 authority**：继续 Shadow / CANARY；不写 `decision_result` / `portfolio_position` /
  `portfolio_snapshot`；不写 V3.6.1 `final_target`；
- **不构成经济结论**：B3 Frozen OOS 通过前，一切净值 / Sharpe / MDD 只是研发证据；
- **未改规则**：本次运行只**读**冻结 bundle 与冻结实现，未做任何参数或语义变更；
- **旧报告降级**：`b1_ledger_baseline_20260911` / `gen2_b1_research_baselines_20260911.md`
  自本次起**只作审计基线**，不再作为比较对象。
- **不据此启动 B3**：本产出是「待合并冻结运行」，在 §12 的接受记录写入之前不进入 B3 Frozen OOS；
  `+61.01% / Sharpe 0.55` **不是**经济资格。

## 11. 复现

```bash
PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --date 20260914
# 只读验锁（不改盘）
python scripts/ml/freeze-gen2-rule-bundle.py --check
node scripts/verify-immutable.js
# B1 PR 合并后：在独立分支建接受记录（四项校验全过才写入；内容哈希不变则无需重跑）
git switch -c chore/gen2-b1-accept-v201 origin/master
PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --accept-merge --master-commit <sha>
```

> 任一门禁失配（锁 SHA / ROOT_ANCHORS / 配置漂移 / 跨实现常量 / manifest 自校验）时本入口
> **直接拒绝运行**，因此不存在「在一份未冻结的规则上跑出 B1」这种形态。

## 12. 合并接受条件（写入接受记录前，本产出只是「待合并冻结运行」）

**顺序（不可跳）**：

1. 合并**冻结 PR**（`feat/gen2-wp-g2-04-freeze` → `master`）；
2. 合并 **B1 PR**（`feat/gen2-b1-frozen-run`，base 选冻结分支；冻结 PR 合并后 GitHub
   自动把 base 改为 `master`）；
3. 从**新的 master** 建 `chore/gen2-b1-accept-v201`，运行接受命令：
   `python -m gen2.baseline.b1_frozen_run --accept-merge --master-commit <B1 合并提交完整 SHA>`；
4. 该命令**校验**（任一不过即拒绝写入并要求重跑，`FrozenAttestationError`）：
   - ⓪ **工作树干净**（接受时 + 取证时两态）；
   - ① **执行提交** `source_state.git_head_commit` 是 `<B1 merge SHA>` 的**祖先**
     （证明「接受的就是这次执行所依据的源码」）；
   - ② **锁定组件 / B1 工具链 / 输入摘要 / 输出摘要**与 manifest **逐项**逐位一致
     （逐项才能指出**哪一条锁定路径**变了，不只比折叠摘要）；
   - ③ `<B1 merge SHA>` 的**树中包含**已承诺的**报告 / manifest / 审计快照**，且**哈希匹配**
     （取**提交里的 blob** 算哈希，不是取磁盘文件 —— 后者证明不了「合并进去的是这样」）。
   > ⚠️ **不再要求** `accepted_master_tree_sha == execution_source_tree_sha`：报告 / manifest /
   > 审计快照是**执行之后**才提交的 ⇒ 两个 tree **必然不同**。前者是「接受时仓库快照」、
   > 后者是「执行时语义源码快照」，两者的关联由 ② 的摘要族与 ③ 的已承诺证据哈希建立。
5. 开并合并**这一个很小的接受记录 PR**（`chore/gen2-b1-accept-v201` → `master`）。

> **为什么必须是独立 PR**：`--accept-merge` **会修改受版本控制**的 manifest / 报告；
> 在受保护的 `master` 下不存在「B1 合并后在本地跑一下就算完成」的路径 —— 这一步本身也要
> 留痕、可评审。**该 PR 合并之后**，本产出才可正式称为「Frozen B1 已接受」，也才允许启动
> **B3 Frozen OOS**。

当前状态：**待合并**（接受记录尚未写入 → 措辞不得写「已接受」）

| 项 | 值 |
|---|---|
| `run_status` | `PENDING_MERGE` |
| `execution_source_tree_sha`（**执行时**语义源码快照；**不要求** == `<SHA>^{tree}`） | `2d1d5ba90b533ee10b8c5d9cfda6e6dea368a3c7` |
| 待绑定的**组件摘要**（lock 8 项折叠） | `86fc2902f817c147ecf8d452fadbc5ad661a4d534a525bff16991e39d026dc8c` |
| 待绑定的**输入摘要** | `7b5018e48b417b11e1624593c146f277f6c23f372698c98652c97e1dd347f191` |
| 待绑定的**输出摘要** | 见 manifest `outputs.committed_report.sha256`（报告不含自身哈希） |

> **在接受记录写入之前**：不进入 B3 Frozen OOS、不提升 authority、不部署、不写正式仓位；
> 本报告全部净值 / Sharpe 只作**研发证据**。

> 接受记录命令（B1 PR 合并后，在**独立分支** `chore/gen2-b1-accept-v201` 上执行；会先做四项校验，
> 任一不过即**拒绝**并要求重跑；随后开并合并该接受记录 PR）：
>
> ```bash
> git switch -c chore/gen2-b1-accept-v201 origin/master
> PYTHONPATH=ml python -m gen2.baseline.b1_frozen_run --accept-merge --master-commit <sha>
> # → 开「接受记录 PR」并合并；该 PR 合并后才可正式称「Frozen B1 已接受」
> ```
