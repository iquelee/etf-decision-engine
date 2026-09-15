# Gen-2 B3 Frozen OOS 协议（**结果前冻结**）

> **版本**：b3-protocol-v1 ｜ **拟稿**：2026-09-15 ｜ **状态**：待用户确认判据后执行
> **授权来源**：用户 2026-09-15 裁决 —— 批准启动 B3 Frozen OOS，范围限定**离线、只读验证**。
> **本协议的纪律**：判定值（§7）在看到任何 OOS 结果**之前**写入。若需改判定标准，视同重开研究协议
> 并重新审批（延续 `PLAN_GEN2_1.md` §10 的「硬修改 #4」纪律）；**禁止**根据 OOS 结果回调策略参数后重跑。

---

## 1. 目标与「不做」

**目标**：用**已接受的冻结规则**在**样本外**区间上给出一次性的经济与信号读数，并据此作出**二元**判定：
Rule V2（`gen2-rule-v2.0.1`）是否取得经济资格。

**明确不做**（用户授权范围 + 既有一贯边界）：

| 项 | 状态 |
|---|---|
| 改规则 / 参数 / 实现 / 样本边界 / 成本口径 | ❌ 一律不改 |
| 部署（`tcb deploy`）/ 提 authority / 写正式仓位 | ❌ 不做 |
| 网络调用 / 写 CloudBase / 写 `decision_result`·`portfolio_position`·`portfolio_snapshot` | ❌ 不做 |
| 看结果后回调参数再跑（p-hacking） | ❌ 禁止；失败即另立新假设并**新开**研究任务书 |
| 重跑 B1 | ❌ 不需要，也**不触发**（见 §2.3） |

---

## 2. 冻结对象（不可变清单）

### 2.1 规则冻结

| 项 | 值 |
|---|---|
| 规则封印 | `gen2-rule-v2.0.1`，bundle `ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json` |
| bundle SHA | `fabd31d9b1c2500e82f5f927fd24acdee63df2d01fce09053028c353426d6b37` |
| lock | `ml/gen2/manifests/GEN2_RULE_V2_LOCK.json`，`lock_revision = 3`，`immutable_set` = **8 项** |
| lock SHA | `d3d40f99dd3d766bd326bf11cc81dcc1168fde4d59693187f1154b2a9e7b2d9c` |
| 显式角色阈值 | `selection.role_thresholds` = 0.20 / 0.30 / 0.40 |
| SHA 口径 | 一律 **CRLF→LF 归一化**后计算（与 `verify-immutable.js` / `freeze-gen2-rule-bundle.py` 同口径） |

### 2.2 已接受 B1 基线（B3 的**唯一**对照锚）

| 项 | 值 |
|---|---|
| manifest | `ml/gen2/manifests/GEN2_B1_FROZEN_RUN_MANIFEST_20260914.json`，`run_status = ACCEPTED` |
| 入库报告 | `ml/gen2/reports/gen2_b1_frozen_run_20260914.md`，sha256（CRLF→LF）= `b1249dd9…`（= manifest `outputs.committed_report.sha256`，已核验一致） |
| 接受记录 | `accepted_master_commit = be372bcb…`；`no_rerun_required = true` |
| 全窗口读数 | 公共日历 2020-03-10 → 2026-09-04（**1577 日**），0/5/10/20 bps，5 策略（报告 §6 表，20 行） |

### 2.3 B3 **不**使已取证 B1 失效 —— 边界声明

已取证 B1 的失效条件是**四类摘要任一项变化**（锁定组件 / B1 工具链 / 输入 / 已承诺输出）。
B3 只**新增**文件 `ml/gen2/baseline/b3_frozen_oos.py` 与 B3 命名产物，**不修改**：

- 8 项 `immutable_set`（含 `bundle`、JS/Python 规则实现、`role_thresholds`、`selection_scores`、`regime`）；
- B1 工具链 4 项（`b1_frozen_run.py` / `rebuild_baselines.py` / `ledger.py` / `costs.py`）；
- 输入行情池与元数据（只读）；
- 已承诺输出（B1 manifest / B1 报告 / 审计快照 / 运行目录产物清单）。

⇒ **B1 取证继续有效**，B3 无需重跑 B1。（B3 的运行实现摘要**单列**，不与 B1 混用。）

---

## 3. OOS 样本边界（**沿用仓库既有口径，不自定**）

**来源**：`ml/gen2/evaluation/walk_forward.py`，`WalkForwardConfig(train_years=3, purge_days=20, embargo_days=5)`。
评价日历 = `rankings` 交易日历；每个 fold 的 **test 段 = 单个自然年**（train 为 expanding，末端剔除 purge+embargo）。
该模块自身声明：「规则已冻结（不重新选参）… 任何人不得一边看 test 结果一边改规则后再宣称通过」。

**实测（只读侦察，本机数据池，2026-09-15）**：

- 评价日历：`2018-04-03` → `2026-09-04`，**2046** 个交易日；年份 2018…2026
- folds（test 段）：2021 / 2022 / 2023 / 2024 / 2025 / 2026 六个自然年
- **OOS = folds 的 test 段并集 = `2021-01-04` → `2026-09-04`，1376 个交易日**
- 与公共日历**连续**（无缺口、无空洞）：`contiguous = True`
- OOS ⊂ B1 公共日历，且是其**后段**（B1 前 201 日为 OOS 之外）

**为什么这是「不改样本边界」**：这些日期**完全由仓库既有的 `WalkForwardConfig` 默认值与既有数据池决定**，
本协议只是把它读出来并记录；B3 不存在任何新引入的切分口径、阈值或人工挑选。

### 3.1 账本口径：连续运行，只切片不冷启动

B3 以**与 B1 完全相同的调用**跑全窗口账本（同一 `calendar`、同期初全现金、同 T+1、同费用模型、
同 `build_unified_baselines` 入口），再**把逐日账本切到 OOS 段**计算指标：

- 状态机与持仓在 OOS 起点**连续**（不重置、不空仓冷启动 ⇒ 不产生首日建仓的换手/费用假象）；
- OOS 指标 = OOS 段的逐日 `net_return` 从 1.0 复利；换手/费用 = OOS 段求和；
- 非 OOS 段（2020-03-10 → 2020-12-31）**不参与任何指标**，仅用于状态连续性与 B1 读数核对。

> 这是唯一不需要新增口径的做法：既不新建切分、也不改动账本契约。

---

## 4. 成本口径

`0 / 5 / 10 / 20 bps`（四档全出）；**主判据档 = 10 bps**（与 B1 `default_cost_bps` 一致）。
换手 = 单边成交名义额 `Σ_证券|Δ|`，现金腿不计费（`LEDGER_CONTRACT`）。

---

## 5. 输出项（用户指定，全部必出）

1. **数据摘要**：输入行情池 31 码的内容摘要 `content_digest`、日期范围、总行数、环境版本；
2. **锁 SHA**：lock SHA + 8 项组件哈希 + 折叠摘要（`lock_component_digest`）；
3. **OOS 窗口**：首末日、天数、fold 来源；
4. **经济读数**（OOS 段，5 策略 × 4 成本档）：净收益（期末净值/CAGR）、Sharpe、MDD、换手、费用；
5. **IC**（OOS 段）：`alpha_score_v2` vs `y_rank_vs_market_20d` 的日频 Rank IC 均值、IC>0 占比、
   Top-Bottom spread；并给**逐 fold（年）**分解；
6. **Main5 对照**：同窗口 `main5_equal_weight`（Main5 PIT 等权）的同类读数，与 Δ；
7. **统计证据**：Selection Net Increment（日频 `defended − main5`）的 block bootstrap 95% CI；
8. **二元判定**：按 §7 给出 `PASS` 或 `FAIL`（附逐条依据）。

---

## 6. 指标口径（**复用既有实现，不新定义**）

| 指标 | 实现来源 |
|---|---|
| 净值 / CAGR / Sharpe / MDD | `gen2.baseline.rebuild_baselines.perf_metrics`（与 B1 同函数） |
| 换手 / 费用 / 期末净值 / 守恒 | `gen2.backtest.ledger.run_ledger` + `ledger_summary`（唯一权威账本） |
| Rank IC / IC>0 / Top-Bottom | `gen2.evaluation.walk_forward.evaluate_fold`（`_spearman_ic` 同口径） |
| Canonical Alpha 评分 | `gen2.baseline.selection_scores.canonical_selection_scores`（WP-G2-05 唯一入口） |
| 增量置信区间 | `gen2.evaluation.bootstrap.block_bootstrap_mean`（`n_boot=1000, block=20, seed=42`） |

> **不新写任何指标实现**：全部调用上表既有函数，避免出现「第二套定义」。

---

## 7. 二元判据（**结果前定死**）

### 7.1 硬门（先决条件；任一项失配 ⇒ **不判 PASS/FAIL**，运行作废）

| # | 硬门 | 失配后果 |
|---|---|---|
| H1 | 锁 ↔ 磁盘逐位核验通过（8 项 + 2 项构建产物声明 + ROOT_ANCHORS 自锚） | 拒绝运行 |
| H2 | 运行配置 ↔ 冻结 bundle 零漂移（17 个规则键） | 拒绝运行 |
| H3 | 跨实现常量交叉核对（regime 55/45、canonical Alpha） | 拒绝运行 |
| H4 | 输入内容摘要与已接受 B1 manifest 的 `input_data.content_digest` **一致** | 拒绝运行（数据已变 ⇒ OOS 不可归因） |
| H5 | 重算的全窗口读数与已接受 B1 报告 §6 表**逐位一致**（报告显示精度） | **中止**（`ABORTED_B1_MISMATCH`），B3 不予采信 |
| H6 | OOS 段资金守恒误差 = 0、现金 min ≥ 0、超配日 = 0 | **中止**（`ABORTED_LEDGER`） |
| H7 | 执行窗口内源未被改动（`source_mutation_check.mutated = false`） | **中止**（`ABORTED_SOURCE_MUTATED`） |

> H5 的意义：本机 `ml/gen2/outputs/` 已被清理，无法读回 B1 产物 ⇒ B3 **必须重算**。
> H5 用「重算结果 == 已接受读数」证明**B3 用的是被接受的那条规则、那个账本、那份数据**。

### 7.2 判据（全部满足 = `PASS`；任一不满足 = `FAIL`）

| # | 判据 | 阈值 | 来源 |
|---|---|---|---|
| **C1** | OOS 累计净收益（10bps）`gen2_v2_defended` **>** 同窗口 `main5_equal_weight` | 严格大于 | B3 明确（用户要求「净收益…与 Main5 对照」） |
| **C2** | OOS Sharpe（10bps）`defended` **≥** 同窗口 `main5_equal_weight` | ≥ | B3 明确（用户要求「Sharpe…与 Main5 对照」） |
| **C3** | Selection Net Increment（日频 `defended − main5`，10bps）bootstrap 95% CI **下界 ≥ −0.0001/日** | −1e-4 | **复用** `PLAN_GEN2_1.md` §10 G2 的容忍值（结果前已定死） |
| **C4** | 「无灾难年份」：每个 OOS 自然年，`defended` 年度净收益相对**同年度** `main5` 不低于 **−15pct** | −15pct | **复用** `PLAN_GEN2_1.md` §10 G7 |
| **否决规则** | 若仅 raw IC 为正、而**成本后仍输 Main5**（C1 或 C2 不达）⇒ **无论 IC 一律 FAIL** | — | **复用** `PLAN_GEN2_1.md` §10 否决规则 |

**判定顺序**：H1–H7 全过 → 计算 C1–C4 → `PASS = C1 ∧ C2 ∧ C3 ∧ C4`；否则 `FAIL`。

> ⚠️ **IC 不是资格**：C1–C4 才是资格判据。IC 只用于解释「为什么通过 / 为什么失败」，
> 不得单独用来宣称经济价值（延续 `evaluation/EVALUATION_PROTOCOL.md` §6 与 §10 否决规则）。

### 7.3 判据的限定（防过度解读）

- C1/C2 的比较对象是**同窗口、同成本口径**下的 `main5_equal_weight`（Main5 PIT 等权，只对当日
  可得成员归一化）——**不是**线上 V3.6.1 的真实生产表现；本判定**不**构成对 V3.6.1 的任何评价。
- OOS = 1376 日、6 个自然年，**样本量有限**；`PASS` 也**不**自动等于可部署（见 §9）。
- 本判据**只**适用于「gen2-rule-v2.0.1 + lock_revision 3 + 本数据池」这一组对象，不外推。

---

## 8. 失败处置（用户指定）

`FAIL` 的后果（**唯一**合法路径）：

1. **维持 Shadow / CANARY**：不部署、不提 authority、不写正式仓位；
2. **另立新假设**并**新开**研究任务书（新 `bundle_version` + 新 lock + 新 M 里程碑审批），
   在 OOS 上重做「先写协议 → 再跑」；
3. **禁止**：根据本次 OOS 结果回调参数后重跑（p-hacking），也禁止改写本协议判据后重判。

`PASS` 的后果：仅表示「该冻结规则在本 OOS 上通过本协议判据」，**不**自动升级 authority；
部署 / 提权仍需**独立**裁决。

---

## 9. 产物清单

| 产物 | 路径 | 入库 |
|---|---|---|
| B3 入口 | `ml/gen2/baseline/b3_frozen_oos.py` | ✅ |
| B3 manifest | `ml/gen2/manifests/GEN2_B3_FROZEN_OOS_MANIFEST_<date>.json` | ✅ |
| B3 报告 | `ml/gen2/reports/gen2_b3_frozen_oos_<date>.md` | ✅ |
| 运行目录（账本逐日 / 指标 / 日历元数据 / 运行侧 manifest） | `ml/gen2/outputs/<b3_run_id>/` | ❌（`outputs/` 已 gitignore，与 B1 同） |
| 回归测试 | `ml/gen2/tests/test_b3_frozen_oos.py` | ✅ |

**run_id**：`b3_frozen_oos_<date>_frozen_v201`（与 B1 的 `b1_ledger_baseline_…` 隔离，不覆盖）。

**manifest 结构与自校验**：沿用 B1 的四类哈希 + `self_check`（fail-closed）范式，
复用 `b1_frozen_run.verify_manifest`（同一套自校验实现，不 fork）：
① 锁 SHA + 8 项组件 + 折叠摘要；② B3 运行实现哈希；③ 输入内容哈希 + 日期范围 + 环境版本；
④ 输出产物与报告哈希。报告**不含自身哈希** ⇒ 无自引用；`self_check_pre_report` 于报告写出前执行。

**run_status 四态**：`PENDING_REVIEW`（本地产出，待裁决）/ `PASSED` / `FAILED` / `ABORTED_*`。
**本地产出不得自称「已通过经济资格」**：在用户裁决之前，措辞一律为「待裁决」。

---

## 10. 复现

```bash
cd <repo>
export PYTHONPATH=ml
PY=<venv gen2 python>            # pandas 3.0.5 / numpy 2.5.3 / CPython 3.13.14（与 B1 取证环境一致）
$PY -m gen2.baseline.b3_frozen_oos            # 全量：全窗口账本 → OOS 切片 → 指标 → 判据 → manifest/报告
$PY -m unittest discover -s ml/gen2/tests -t .   # 回归
node scripts/test-all.js                      # 全量门禁（Stage A–G）
```

---

## 11. 协议变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-15 | b3-protocol-v1 | 首次拟定（判据 §7 在**任何 OOS 结果之前**写入） |

> **待用户确认项**：§3 的 OOS 边界（沿用 `WalkForwardConfig` 默认）、§7.2 的 C1/C2 表述与阈值档位。
> 确认后方可执行；执行后判据**冻结**，不得因结果调整。
