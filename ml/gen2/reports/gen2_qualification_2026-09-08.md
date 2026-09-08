# Gen-2 资格判定报告 — WP9.2 Permission-Conditioned OOS（v2，2026-09-08 晚）

**v2 修正**：初版（同日晚，§31 Case C 直接收口）把「raw OOS IC 不稳」当作全链不合格判据。WP9.2 审查指出关键口径缺口——**冻结后的 Gen-2 决策链是 Permission-conditioned 的**（RISK_OFF → Selection Permission = DISABLED，系统本就「不使用」该 alpha），raw OOS 把被禁用的 RISK_OFF 日混进总 IC。本版在冻结规则上重切片回答：**2022 的失败是「不该选的时候选错了（已被 Permission 隔离）」还是「该选的时候也选错了」？**

日期：2026-09-08。状态：WP9.0 数据规范化 + WP9.1 raw OOS 复核 + WP9.2 permission-conditioned 归因全部完成。

## 一、WP9.0 / WP9.1（同初版，复核成立）

- WP9.0：31 规范化日线 csv 收入 monorepo `deliverables/etf_daily_ml_pool/` + `DATASET_MANIFEST_V1.json` + `scripts/verify-gen2-dataset.py`（31/31 一致）。
- WP9.1：冻结规则 raw Walk-Forward OOS = 0.0312 / 52.9% / 2022 −0.1344（与 parity 前逐位一致 → parity 修复未改 alpha 信号链）。

## 二、WP9.2 Permission-Conditioned OOS（冻结规则，OOS 日切片）

运行：`PYTHONPATH=ml python -m gen2.evaluation.permission_oos`
口径：score=alpha_score_v2、label=y_rank_vs_market_20d、OOS 日=fold test 段（2021-2026）；regime/perm 用 `gen2.portfolio.regime` / `selection_permission` 单一契约（无新阈值）；market_score 由 benchmark MA20/MA60 当日合成，无未来泄漏。

| 切片 | n_days | Rank IC | IC>0 | TB spread | top_excess | bottom_excess |
|---|---|---|---|---|---|---|
| oos_raw（全 OOS） | 1376 | +0.0271 | 0.529 | +0.0061 | +0.0092 | +0.0031 |
| **oos_actionable（perm≠DISABLED）** | **740** | **+0.1001** | **0.622** | +0.0062 | +0.0158 | −0.0034 |
| oos_promotion_candidate_days | 1226 | +0.0491 | 0.556 | +0.0035 | +0.0083 | −0.0012 |
| oos_RISK_ON | 572 | +0.1026 | 0.637 | +0.0076 | +0.0182 | −0.0030 |
| oos_RANGE | 168 | +0.0911 | 0.570 | +0.0014 | +0.0075 | −0.0047 |
| oos_RISK_OFF | 636 | **−0.0595** | 0.418 | +0.0061 | +0.0014 | +0.0107 |
| oos_2021 | 243 | +0.0397 | 0.564 | +0.0149 | +0.0181 | +0.0117 |
| **oos_2022** | **242** | **−0.1344** | 0.335 | +0.0017 | −0.0063 | +0.0097 |
| oos_2023 | 242 | +0.0706 | 0.583 | +0.0039 | +0.0111 | −0.0033 |
| oos_2024 | 242 | +0.0500 | 0.545 | −0.0022 | −0.0036 | −0.0008 |
| oos_2025 | 243 | +0.0732 | 0.613 | +0.0115 | +0.0234 | −0.0005 |
| oos_2026 | 164 | +0.0882 | 0.535 | +0.0077 | +0.0146 | +0.0008 |

## 三、2022 失败归因（核心诊断）

| 2022 切片 | n_days（占年比重） | Rank IC | IC>0 |
|---|---|---|---|
| 2022 × RISK_ON | 58 / 242（24%） | **+0.0678** | 0.621 |
| 2022 × RANGE | 22 / 242（9%） | −0.0647 | 0.364 |
| 2022 × RISK_OFF | 162 / 242（67%） | **−0.2163** | 0.228 |

**判定 = 假设 A（regime 驱动，Permission 层设计正确）为主**：
1. 2022 的灾难 67% 天数在 RISK_OFF，其 IC −0.216 是全年 −0.134 的主要来源；
2. **2022 里「本该进攻」的 RISK_ON 日 IC = +0.068（62.1% 为正）** —— 该选的时候选对了；
3. RANGE 22 天 −0.065 为负但样本太小（9%），不足以单独坐实假设 B；
4. 跨年一致：RISK_ON/RANGE 各年基本为正（2023 RISK_ON +0.039、2024 +0.071、2025 +0.148、2026 +0.229）；RISK_OFF 各年多数为负（2024 −0.001、2025 −0.198、2026 −0.116；2021 +0.013 / 2023 +0.086 例外 → 「RISK_OFF 恒反选」不成立，DISABLED 是合理保守而非完美隔离）。

## 四、Gate 判定（v2 修正）

| Gate | 初版（v1） | v2（WP9.2 修正） |
|---|---|---|
| Python/Node Parity + CI + Immutable + No-Leakage | ✅ | ✅（另加 Stage C 真 SHA / Stage F build / Node16，见 Test-And-CI-Gates v2） |
| Raw OOS Selection Alpha（全日） | ❌ UNSTABLE | ❌ 仍不达标（0.027/52.9%）——**但该口径混入 DISABLED 态，非系统真实用法** |
| **Actionable Selection Alpha（perm≠DISABLED）** | 未评估 | ✅ **CONDITIONAL PASS：+0.100 / 62.2%**（740 日，无未来泄漏） |
| Permission 层有效性 | 未评估 | ✅ RISK_OFF 日 IC −0.059（系统禁用态）反向/无效 → 隔离设计被数据支持 |
| 灾难性单年（2022） | ❌ FAIL | ✅ **2022×RISK_ON +0.068 为正**；灾难集中于被 DISABLED 隔离的 RISK_OFF 日 |
| Production Advisory / Effective | ⛔ BLOCKED | ⛔ **仍 BLOCKED**（Actionable alpha 合格 ≠ 经济净增量合格，须 Economic Replay 证明） |

## 五、结论（修正初版 Case C 收口）

```
Actionable Selection Alpha = CONDITIONAL PASS（+0.10，仅系统实际会用的日子）
RISK_OFF 负 IC 集中在 DISABLED 态 → Permission 层正确隔离
        ↓
下一步 = Permission-conditioned Integrated Economic Replay
   （Gen-2 选池只在 ACTIVE/REDUCED 日生效 + Gen-1 择时 + V3.6.1 Safety + 成本，
    归因拆 Selection/Timing/Safety/Cost，回答「合格 alpha 是否转化为净经济增量」）
        ↓
若经济净增量达标 → 升级 Integrated Shadow 观察权重 / 提 Production Advisory 候选
若经济净增量不达标（§31 Case B）→ 再启动 Gen-2.1 Cluster Leadership + Consolidation Quality Gate
```

修正说明：初版直接进入 §31 Case C（保持 Shadow + 转 Gen-2.1 研究）**过早**——它把「raw IC 被 DISABLED 态稀释」误读为「alpha 本身失效」。WP9.2 证明真实系统的可用选池 alpha（+0.100/62%）与 2022 该选时（+0.068）均为正，资格判定从 UNSTABLE 修正为 **CONDITIONAL PASS，等待 Economic Replay 验证净价值**。**Production 红线不变：Gen-2 仍不进 Production Advisory / 不写 decision_result。**

## 六、工程加固（同批次交付，P0-A~D）

- P0-A：`scripts/verify-immutable.js` 真 SHA 锁（GEN1/V361/GEN2_RULE_V2 lock 8 项），替换 `git diff` 假锁；负向测试通过。
- P0-B：Build Common Parity（Stage F）进 `npm test`（11 函数 dist parity）。
- P0-C：CI matrix 补 Node 16（对齐 CloudBase Nodejs16.13）。
- P0-D：`DATASET_MANIFEST_V1.json` + `scripts/verify-gen2-dataset.py`（数据身份可核验）。

## 七、复现命令

```bash
npm test                                   # 18/18（Stage A-F）
PYTHONPATH=ml python -m gen2.evaluation.walk_forward      # WP9.1 raw OOS
PYTHONPATH=ml python -m gen2.evaluation.permission_oos    # WP9.2 regime 归因
python scripts/verify-gen2-dataset.py                     # 数据集身份核验（31/31）
```
