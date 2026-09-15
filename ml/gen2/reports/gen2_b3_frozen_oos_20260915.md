# Gen-2 B3 Frozen OOS 报告（冻结规则 · 样本外验证 · 失败取证已接受）

- **Run ID**：`b3_frozen_oos_20260915_frozen_v201` ｜ **状态**：`ACCEPTED_FAIL`（失败取证已接受；本报告为 Rule V2.0.1 的**经济失败基线**）
- **判定**：**FAIL**（判据 Cost = 10 bps；协议 `ml/gen2/reports/gen2_b3_frozen_oos_plan_20260915.md`，判据在**结果前**定死）
- **冻结规则**：`gen2-rule-v2.0.1` / `lock_revision 3` / bundle `fabd31d9b1c2…` / lock `d3d40f99dd3d…`
- **OOS 窗口**：`2021-01-04` → `2026-09-04`，**1376 个交易日**（gen2.evaluation.walk_forward.WalkForwardConfig(train_years=3, purge_days=20, embargo_days=5)；与评价日历连续 = True）
- **边界**：离线只读；不部署、不提 authority、不写正式仓位；未改规则/参数/实现/样本边界/成本口径。
> **状态口径**：接受记录已写入 manifest（`acceptance_record.accepted_master_commit` /
> `accepted_master_tree_sha` / `execution_head_commit`）。本报告的措辞由接受记录 PR
> （分支 `chore/gen2-b3-accept-fail-v201`）改写；`run_status = ACCEPTED_FAIL` = **失败取证已接受归档**，
> ⚠️ **不等于通过**：`verdict = FAIL` 不变，仍**不部署、不提 authority、不写正式仓位**。

## 1. 一句话结论

冻结规则在本 OOS 窗口上**未通过协议判据** ⇒ **维持 Shadow / CANARY**，另立新假设研究；**禁止**根据本次结果回调参数后重跑。

## 2. 硬门（先决；任一失配即中止，不做 PASS/FAIL 判定）

| # | 硬门 | 判定 | 依据 |
|---|---|---|---|
| H1 | 锁 ↔ 磁盘逐位核验（8 项 + 构建产物声明 + ROOT_ANCHORS 自锚） | ✅ PASS | `{"lock_sha256": "d3d40f99dd3d766bd326bf11cc81dcc1168fde4d59693187f1154b2a9e7b2d9c", "lock_revision": 3}` |
| H2 | 运行配置 ↔ 冻结 bundle 零漂移（17 个规则键） | ✅ PASS | `{"rules_checked": 17}` |
| H3 | 跨实现常量交叉核对（regime 55/45、canonical Alpha） | ✅ PASS | `{"mismatches": []}` |
| H4 | 输入内容摘要 == 已接受 B1 manifest 的 input.content_digest | ✅ PASS | `{"now": "7b5018e48b417b11e1624593c146f277f6c23f372698c98652c97e1dd347f191", "accepted_b1": "7b5018e48b417b11e1624593c146f277f6c23f372698c98652c97e1dd3` |
| H5a | 锁定组件摘要 == 已接受 B1（lock SHA + 8 项折叠摘要） | ✅ PASS | `{"lock_component_digest": "86fc2902f817c147ecf8d452fadbc5ad661a4d534a525bff16991e39d026dc8c"}` |
| H5b | 与 B1 同文件的工具链条目哈希一致（复用同一条已取证工具链） | ✅ PASS | `{"shared_ids": ["baseline_builder", "ledger", "cost_impl"], "rows": [{"id": "baseline_builder", "file": "ml/gen2/baseline/rebuild_baselines.py", "b3_s` |
| H5c | 重算全窗口读数 == 已接受 B1 报告表（逐位，报告显示精度） | ✅ PASS | 比对 140 个单元格 / 失配 0 |
| H6 | OOS 段资金守恒 / 现金非负 / 零超配 | ✅ PASS | 守恒误差 0.000e+00 / 现金 min 0.000000 / 超配 0 天 |
| H7 | 执行窗口内源未被改动 | ✅ PASS | HEAD `30943b2fbbf2` |

## 3. 与已接受 B1 的关系（为什么本次重算是可信的）

- 已接受 B1：`b1_ledger_baseline_20260914_frozen_v201`，`run_status = ACCEPTED`，manifest `76212ecee3ce…`，报告 `b1249dd91e46…`（哈希已核验）
- 本机 `ml/gen2/outputs/`（B1 运行目录）已被清理且 `outputs/` 未入库 ⇒ **无法读回 B1 产物**，B3 只能**重算**；因此 H5 用「重算 == 已接受读数」证明 B3 用的就是被接受的那条规则/账本/数据。
- 锁定组件摘要与已接受 B1 一致：`86fc2902f817…`；输入内容摘要一致：`7b5018e48b41…`
- 与 B1 **同文件**的工具链条目哈希逐项一致（`baseline_builder`, `ledger`, `cost_impl`）⇒ 复用**同一条已取证工具链**（非另写一套口径）。
- **B1 取证未受影响**：B3 只新增文件与 B3 命名产物，未触碰锁定组件 / B1 工具链 / 输入 / 已承诺输出。

## 4. 冻结输入核验与数据摘要

| 项 | 值 |
|---|---|
| lock SHA | `d3d40f99dd3d766bd326bf11cc81dcc1168fde4d59693187f1154b2a9e7b2d9c` |
| lock 组件折叠摘要（8 项） | `86fc2902f817c147ecf8d452fadbc5ad661a4d534a525bff16991e39d026dc8c` |
| bundle SHA | `fabd31d9b1c2500e82f5f927fd24acdee63df2d01fce09053028c353426d6b37` |
| ROOT_ANCHORS 自锚 | True |
| ├ 组件 `bundle` | `fabd31d9b1c2500e…` (ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json) |
| ├ 组件 `js_implementation` | `cb9a91b79a8ad9ee…` (cloudfunctions/runGen2ShadowEod/index.js) |
| ├ 组件 `python_rule` | `89b4e6d867acacf8…` (ml/gen2/baseline/rule_v2_ab.py) |
| ├ 组件 `python_candidate` | `0831764c775fb4d3…` (ml/gen2/portfolio/portfolio_builder.py) |
| ├ 组件 `python_defense` | `e3f48f081936ab0d…` (ml/gen2/portfolio/defense_gate.py) |
| ├ 组件 `python_role_thresholds` | `62d542615e6b2be2…` (ml/gen2/portfolio/role_thresholds.py) |
| ├ 组件 `python_selection_scores` | `1d67f768a654ff36…` (ml/gen2/baseline/selection_scores.py) |
| ├ 组件 `python_regime` | `738f49c1bb2ed661…` (ml/gen2/portfolio/regime.py) |
| 输入内容摘要 | `7b5018e48b417b11e1624593c146f277f6c23f372698c98652c97e1dd347f191` |
| 输入行数 / 代码数 | 38083 / 31 |
| 输入日期范围 | 2011-12-09 → 2026-09-04 |
| 环境 | Python 3.13.14 / pandas 3.0.5 / numpy 2.5.3 |

## 5. OOS 窗口（沿用既有 walk-forward 口径，未自定边界）

- 来源：`gen2.evaluation.walk_forward.WalkForwardConfig(train_years=3, purge_days=20, embargo_days=5)`；定义：各 fold 的 test 段（单个自然年）并集
- fold 的 test 段：

| fold | test 年 | test 起 | test 止 | test 天数 | train 止 |
|---|---|---|---|---|---|
| 1 | 2021 | 2021-01-04 | 2021-12-31 | 243 | 2020-11-26 |
| 2 | 2022 | 2022-01-04 | 2022-12-30 | 242 | 2021-11-26 |
| 3 | 2023 | 2023-01-03 | 2023-12-29 | 242 | 2022-11-25 |
| 4 | 2024 | 2024-01-02 | 2024-12-31 | 242 | 2023-11-24 |
| 5 | 2025 | 2025-01-02 | 2025-12-31 | 243 | 2024-11-26 |
| 6 | 2026 | 2026-01-05 | 2026-09-04 | 164 | 2025-11-26 |

- **并集 = OOS**：`2021-01-04` → `2026-09-04`，**1376 日**，与评价日历连续 = **True**
- 账本公共日历：`2020-03-10` → `2026-09-04`（1577 日）；OOS 全部落在其中 = **True**
- 账本口径：与 B1 **同一入口**（`build_unified_baselines`）+ 同 calendar + 同 T+1 + 同期初全现金；
  OOS 指标 = OOS 段逐日净收益从 1.0 复利，换手/费用为段内求和 ⇒ 持仓与状态机在 OOS 起点**连续、不冷启动**。

## 6. OOS 经济读数（5 策略 × 4 成本档）

| 策略 | cost_bps | 交易日 | 期末净值 | 累计收益 | CAGR | Sharpe | MDD | 总换手 | 总费用 |
|---|---|---|---|---|---|---|---|---|---|
| gen2_v2_defended | 0 | 1376 | 1.5716 | +57.16% | +8.63% | 0.57 | -21.50% | 133.424 | 0.0000 |
| gen2_v2_undefended | 0 | 1376 | 1.3922 | +39.22% | +6.25% | 0.40 | -27.70% | 102.657 | 0.0000 |
| main5_equal_weight | 0 | 1376 | 3.5118 | +251.18% | +25.87% | 0.99 | -34.57% | 11.525 | 0.0000 |
| market_510300 | 0 | 1376 | 0.9625 | -3.75% | -0.70% | 0.06 | -44.75% | 0.000 | 0.0000 |
| universe_equal_weight | 0 | 1376 | 1.3060 | +30.60% | +5.01% | 0.32 | -49.72% | 15.942 | 0.0000 |
| gen2_v2_defended | 5 | 1376 | 1.4702 | +47.02% | +7.31% | 0.50 | -22.43% | 133.424 | 0.0667 |
| gen2_v2_undefended | 5 | 1376 | 1.3225 | +32.25% | +5.25% | 0.35 | -28.31% | 102.657 | 0.0513 |
| main5_equal_weight | 5 | 1376 | 3.4916 | +249.16% | +25.73% | 0.99 | -34.57% | 11.525 | 0.0058 |
| market_510300 | 5 | 1376 | 0.9625 | -3.75% | -0.70% | 0.06 | -44.75% | 0.000 | 0.0000 |
| universe_equal_weight | 5 | 1376 | 1.2956 | +29.56% | +4.86% | 0.32 | -49.86% | 15.942 | 0.0080 |
| gen2_v2_defended | 10 | 1376 | 1.3754 | +37.54% | +6.01% | 0.43 | -23.35% | 133.424 | 0.1334 |
| gen2_v2_undefended | 10 | 1376 | 1.2563 | +25.63% | +4.27% | 0.31 | -28.96% | 102.657 | 0.1027 |
| main5_equal_weight | 10 | 1376 | 3.4715 | +247.15% | +25.60% | 0.99 | -34.57% | 11.525 | 0.0115 |
| market_510300 | 10 | 1376 | 0.9625 | -3.75% | -0.70% | 0.06 | -44.75% | 0.000 | 0.0000 |
| universe_equal_weight | 10 | 1376 | 1.2854 | +28.54% | +4.71% | 0.31 | -50.00% | 15.942 | 0.0159 |
| gen2_v2_defended | 20 | 1376 | 1.2036 | +20.36% | +3.45% | 0.28 | -25.53% | 133.424 | 0.2668 |
| gen2_v2_undefended | 20 | 1376 | 1.1336 | +13.36% | +2.32% | 0.21 | -30.23% | 102.657 | 0.2053 |
| main5_equal_weight | 20 | 1376 | 3.4317 | +243.17% | +25.34% | 0.98 | -34.57% | 11.525 | 0.0231 |
| market_510300 | 20 | 1376 | 0.9625 | -3.75% | -0.70% | 0.06 | -44.75% | 0.000 | 0.0000 |
| universe_equal_weight | 20 | 1376 | 1.2651 | +26.51% | +4.40% | 0.30 | -50.27% | 15.942 | 0.0319 |

### 6.1 与 Main5 PIT 等权的对照（cost = 10 bps）

| 指标 | gen2_v2_defended | main5_equal_weight | Δ |
|---|---|---|---|
| 累计净收益 | +37.54% | +247.15% | -209.61% |
| Sharpe | 0.43 | 0.99 | -0.56 |
| MDD | -23.35% | -34.57% | +11.22% |
| CAGR | +6.01% | +25.60% | -19.59% |
| 总换手 | 133.424 | 11.525 | 121.899 |

## 7. OOS Rank IC（信号证据；**不是**资格判据）

- 口径：`alpha_score_v2` vs `y_rank_vs_market_20d`，逐日横截面 Rank IC 后按日等权平均（实现 = `walk_forward.evaluate_fold`，未新定义）

| 切片 | 交易日 | Rank IC 均值 | IC>0 占比 | Top-Bottom spread |
|---|---|---|---|---|
| OOS 全体 | 1376 | +0.0271 | 0.529 | +0.00611 |
| fold 2021 | 243 | +0.0397 | 0.564 | +0.00639 |
| fold 2022 | 242 | -0.1344 | 0.335 | -0.01597 |
| fold 2023 | 242 | +0.0706 | 0.583 | +0.01449 |
| fold 2024 | 242 | +0.0500 | 0.545 | -0.00286 |
| fold 2025 | 243 | +0.0732 | 0.613 | +0.02388 |
| fold 2026 | 164 | +0.0882 | 0.535 | +0.01379 |

> ⚠️ **否决规则生效**：OOS Rank IC = +0.0271（为正），但成本后仍输 Main5 ⇒ 按 `PLAN_GEN2_1.md` §10 **一律 FAIL**。IC 不能替代经济资格。

## 8. Selection Net Increment（日频 defended − Main5）

- 口径：`block_bootstrap_mean`（n_boot=1000, block=20, seed=42），`gen2_v2_defended − main5_equal_weight` @ 10 bps，n = 1376
- 均值 **-0.000758/日**，95% CI = [-0.001477, -0.000148]；判据阈值（C3）下界 ≥ -0.0001

## 9. 逐年净收益（cost = 10 bps）

| 年份 | gen2_v2_defended | main5_equal_weight | universe_equal_weight | market_510300 | defended − main5 |
|---|---|---|---|---|---|
| 2021 | +2.31% | +6.86% | +15.72% | -4.32% | -4.54% |
| 2022 | -2.30% | -26.74% | -29.19% | -21.68% | +24.43% |
| 2023 | -7.56% | +41.73% | -4.97% | -10.43% | -49.30% ⚠️ |
| 2024 | +2.17% | +30.48% | +10.58% | +18.39% | -28.31% ⚠️ |
| 2025 | +36.35% | +80.24% | +36.41% | +21.49% | -43.89% ⚠️ |
| 2026 | +6.86% | +33.03% | +9.43% | -0.30% | -26.18% ⚠️ |

## 10. 二元判定（协议 §7.2，判据结果前定死）

| # | 判据 | 阈值 | 实测 | 判定 |
|---|---|---|---|---|
| C1 | OOS 累计净收益（10bps）defended > 同窗口 Main5 PIT 等权 | > 0 | defended +37.54% vs main5 +247.15%（Δ -209.61%） | ❌ FAIL |
| C2 | OOS Sharpe（10bps）defended >= 同窗口 Main5 PIT 等权 | ≥ | defended 0.43 vs main5 0.99（Δ -0.56） | ❌ FAIL |
| C3 | Selection Net Increment（日频 defended − main5）bootstrap 95% CI 下界 >= −1e-4/日 | ≥ -0.0001 | CI 下界 -0.001477 | ❌ FAIL |
| C4 | 无灾难年份：每个 OOS 自然年 defended 年度净收益 >= 同年度 Main5 − 15pct | ≥ -0.15 | 最差年份差 -49.30% | ❌ FAIL |

**结论：`FAIL`** —— 未满足全部判据 ⇒ FAIL：维持 Shadow / CANARY，另立新假设研究；禁止根据本次结果回调参数后重跑

## 11. 处置

- 本报告**已随 B3 接受记录 PR 归档**为 Rule V2.0.1 的**经济失败基线**（`run_status = ACCEPTED_FAIL`）；归档的是**结论与证据**，**不是**「通过」。
- FAIL ⇒ 按用户 09-15 授权：**维持 Shadow / CANARY**，另立新假设并新开研究任务书（新 `bundle_version` + 新 lock + 新审批门）；**禁止**根据本次结果回调参数后重跑。
- PASS ⇒ 仅表示通过**本协议判据**；部署 / 提 authority 仍需**独立**裁决。
- 无论 PASS/FAIL：**不部署、不提 authority、不写正式仓位**。

## 12. 边界（本运行未做 / 刻意不做）

- 未改规则 / 参数 / 实现 / 样本边界 / 成本口径；未调 Alpha 权重、未改 regime 阈值。
- 未联网、未写 CloudBase、未写任何生产集合；未部署、未提 authority、未写正式仓位。
- 未重跑 B1（不需要：四类摘要均未变，B1 取证继续有效）。
- 未修改判据（§7.2 在结果前写入；事后改判据视同重开协议）。

## 13. 产物与自校验

- **自校验（报告写出前执行，不含报告自身哈希）**：✅ 全部通过（55/55 项哈希重算一致）
- **完整自校验（含本报告哈希）**：结果写入 manifest `self_check`；`all_pass=false` 时本入口抛 `FrozenAttestationError` 并**拒绝产出交付物** —— 因此本报告存在即等价于「完整自校验已通过」，此处不重复断言（与 B1 报告同一约定）。
- **本报告自身哈希**：见 manifest `outputs.committed_report`（报告不含自身哈希，避免自引用）。

| 产物 | sha256 | bytes |
|---|---|---|
| `ledger_daily.csv` | `c6ff697b36c84e6bd0324572261b20be9d5a6a7e5f6192463c4dfd5aa4772f51` | 4951772 |
| `ledger_summary.csv` | `1bb10a755cad512070f9a03fa41d678b0dba92057a97453a2d63d64e1fef3567` | 4105 |
| `calendar_meta.json` | `34bf1ec9252e1b4d96b7e9d35c6eb3d84de3f8f1006bd69e3038950c27e4358c` | 3342 |
| `gen2_b3_frozen_oos_20260915_frozen_v201.md` | `57052df7e7d3757132d00e635009f0ae9d6e9b87a3474ba62ccfe898374cfda2` | 5001 |

## 14. 复现

```bash
export PYTHONPATH=ml
python -m gen2.baseline.b3_frozen_oos --date 20260915
```

