# Gen-2 资格判定报告 — 冻结规则 OOS 复核（§31 Case C 结论）

日期：2026-09-08。状态：WP9.0 数据规范化 + WP9.1 冻结规则 OOS 复核完成；按任务书 §31 判定 Gen-2 Rule V2 **保持 Shadow**，Production 相关 Gate 全部 BLOCKED。

## 一、本报告回答的问题

任务书 §20「规则被冻结后才评价」+ §31「OOS Selection Alpha 仍不稳定 → Gen-2 保持 Shadow」。2026-09-07 的 OOS 在 **parity 修复前** 跑（F09 替换门等尚未移植冻结），本报告在 **当前冻结规则**（monorepo `ml/`，含 P0-04/P0-05/Parity 全部修复 + GEN2_RULE_V2_BUNDLE）上重跑复核。

## 二、WP9.0 数据规范化（前置）

- 根因：研究日线数据 52 个 csv（31 代码 × 双编码乱码文件名）在 monorepo **外**（gen2-dev/deliverables），gen2.yaml `daily_dir` 指向仓库内不存在目录 → 仓库不可复现。
- 修复：逐代码比对确认双文件**字节级一致**（仅文件名乱码）→ 去重为 31 个规范文件 `deliverables/etf_daily_ml_pool/{code}_qfq.csv`（monorepo 内，gitignored 不入库）。universe_v1（30 eligible + 510300 benchmark）31 代码全覆盖，0 缺失。
- 代码零改动；`load_daily_bars` glob `{code}_*.csv` 命中规范名。

## 三、WP9.1 冻结规则 Walk-Forward OOS 复核（§20）

运行：`PYTHONPATH=ml python -m gen2.evaluation.walk_forward`（expanding train ≥3 年 + 单年 test，train 末尾 purge20 + embargo5，alpha_score_v2 vs market label，日历 = rankings 日期）。

| fold | test_year | n_days | rank_ic | ic_pos | top_bottom_spread |
|---|---|---|---|---|---|
| 1 | 2021 | 243 | +0.0397 | 0.564 | +0.0064 |
| 2 | 2022 | 242 | **−0.1344** | 0.335 | **−0.0160** |
| 3 | 2023 | 242 | +0.0706 | 0.583 | +0.0145 |
| 4 | 2024 | 242 | +0.0500 | 0.545 | −0.0029 |
| 5 | 2025 | 243 | +0.0732 | 0.613 | +0.0239 |
| 6 | 2026 | 164 | +0.0882 | 0.535 | +0.0138 |
| **汇总** | | | **+0.03121** | **0.529** | **+0.00662** |

与 2026-09-07（parity 前）数值逐位一致（0.0312 / 52.9% / 2022 −0.1344）→ **parity 修复未改变 alpha 信号链，结论在冻结规则上复核成立**。

## 四、Gate 判定

| Gate | 判据（任务书 §21/§30） | 结果 |
|---|---|---|
| Python/Node Parity | 360 行逐字段 0 mismatch | ✅ PASS |
| CI + Immutable + No-Future-Leakage | npm test 22/22 | ✅ PASS |
| OOS Rank IC > 0（#6） | mean +0.031 | ✅ 形式通过（但弱） |
| OOS Top-Bottom Spread > 0（#7） | mean +0.0066 | ✅ 形式通过（但弱） |
| 无灾难性单年 Selection 失效或已 regime 隔离（#8） | 2022 IC **−0.1344**、IC>0 仅 33.5% | ❌ **FAIL**（未 regime 隔离） |
| **OOS Selection Alpha 稳定（§31 Case C 判据）** | IC>0 52.9%≈抛硬币 + 1 个灾难年 | ❌ **FAIL / UNSTABLE** |
| Selection Alpha Gate / Economic Gate / Production Advisory Gate | 依赖上表 | ❌ **BLOCKED** |
| Production Effective Gate | — | ⛔ **BLOCKED** |

## 五、结论（§31 情况 C）

```
OOS Selection Alpha 仍不稳定（2022 灾难年 −0.134 + hit-rate 52.9%）
        ↓
Gen-2 Rule V2 保持 Shadow（不进入 Production Advisory）
        ↓
不投入 V3.6.1 + Gen-1 历史重放 harness 的 Economic Gate（前提不成立，ROI 为负）
        ↓
下一步研究路径 = Gen-2.1：Cluster Leadership / Fundamental Factors / Qlib / ML
```

**不能因为已经开发很多代码（P0-01~WP7 全部完成、21/21→22/22 门禁全绿）就强行进入生产。** 工程基建（common 单一真相源、统一测试、parity、冻结 bundle、Integrated Shadow 引擎）全部就绪且可复用，但策略层面的 Selection Alpha 资格不达标，Gen-2 维持观察。

## 六、已就绪资产（供 Gen-2.1 复用）

- 源码真相：`src/common` canonical + build parity；`GEN2_RULE_V2_BUNDLE` 冻结（sha256 在 runtime_status）。
- 测试门禁：`npm test` 22/22（Node/Python/Immutable/Parity/Secret）。
- Integrated Shadow 引擎 `runIntegratedShadowEod`：Gen2 选池 + Gen1 择时 + V3.6.1 安全的集成反事实框架（Selection/Timing/Safety 三层归因结构已就位，Gen-2.1 只需替换信号源）。
- 数据：规范化 31 代码日线池（monorepo `deliverables/etf_daily_ml_pool/`）。
- OOS 复核基线：上述 fold 表。

## 七、复现命令

```bash
# WP9.1 冻结规则 OOS 复核
PYTHONPATH=ml <gen2 venv python> -m gen2.evaluation.walk_forward
```
