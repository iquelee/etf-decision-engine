# Gen-1 Production Readiness Report V2（WP-G1.1 Canary Gate Remediation）

**日期**：2026-09-10（V1 当日修订）
**基线**：V1 = `feat/wp-g1-p4` @ `674b3552`；本版 = `feat/wp-g1-1`（stacked on p4）
**一句话结论**：**6 个 P0 全部修复；ADVISORY 正确性恢复 PASS；CANARY 基础设施就绪，但经济证据仍不足 → CANARY 保持 OFF、FULL_PRODUCTION 保持 BLOCKED。**

---

## 一、复审 6 个 P0 的处理结果

| # | 复审问题 | 结论 | 处理与证据 |
|---|---|---|---|
| P0-1 | `Safety PERMIT` 未与 `P≥0.65 Candidate` 做 AND；低概率 S2 也可能 advisory/canary；view-model 把低概率误报「已触发」 | **成立，已修** | 新增 **Model Candidate Gate**：`stage==S2(严格)` + `ml_fast==true` + `calibrated_probability>=signal_p` + `model_id 精确`。Safety 只表示「规则允许」。`effective_advisory/canary` 均 AND `model_candidate`。view-model 的 `FAST_PATH_ACTIVE` 必须 `model_candidate===true`，否则显示「观察中 · 模型未触发」。**G1-I + 5 组负向测试** |
| P0-2 | sector 词表与 frozen encoder 矛盾（"除 biotech 外均 -1"） | **部分成立，但结论需修正（见第二节）** | 建立 **Sector Contract Audit**（G1-J）：逐 fold 比对 encoder 与 capability。审计结果 = **CONSISTENT（drift=0）**；`observed_folds` 恰好等于命中 fold 数。capability 现**由 encoder 契约推导**（不再手写，杜绝漂移） |
| P0-3 | Circuit Breaker 用进程内 `_lastHealth`，CloudBase 冷启动失效 | **成立，已修** | 新增 **持久化 latch** `gen1_health_state`（集合 + 单文档 key）：`current/latched_health`、`manual_review_required`、`degraded_at/ml_off_at/reviewed_at/reviewed_by/recovery_allowed`。旧进程内函数标 **DEPRECATED**。runGen1ShadowEod 读→算→写；runDecisionEngine 只消费持久化状态。**G1-K（含「模拟冷启动仍保持 DEGRADED」用例）** |
| P0-4 | 运行时只传 `dataHealth`，经济指标无消费者 | **成立，已修** | 新增 **经济健康聚合器** `gen1-economic-health.js`（rolling alpha / false fast path / calibration drift / 独立事件数）+ 离线 CLI `scripts/gen1-health-aggregator.js`。**独立事件 < 20 → `PENDING`**（禁止 OK 冒充）。`computeHealthStatus` 新增 `economicHealth` 输入（PENDING 不参与判定）。健康状态区分 `runtime_data_health` 与 `economic_health`。**G1-L** |
| P0-5 | Canary 重跑未继承 `sectorRemainingLimit` 等 Safety context；多科技候选聚合无约束 | **成立，已修** | Canary rerun 现传完整 context（`sectorRemainingLimit` / risk / fundamental / bars / stage·shock state / trendStageState / cooldown）；新增 **`clampCanaryCandidate`** 顺序累计科技额度，保证同日多只 canary 聚合不破 tech cap（`gen1_canary_clamped` 标记）。**G1-M（含 cap=25 四只候选聚合用例）** |
| P0-6 | stacked PR #12~#14 未触发 GitHub CI | **成立，已修** | workflow `pull_request` 移除 base 分支过滤 → stacked PR（base=`feat/*`）同样触发。同时保留显式步骤 `Gate G1-A~M`。**注意：V1 报告中的「npm test 29/29」确为本地结果，V2 已改为 `32/32` 并明确区分本地/CI** |

---

## 二、重要修正：Sector Contract 结论（P0-2 需更正）

复审的判断基于 **fold0** 的 encoder 类别。实测三个 fold **类别集合互不相同**：

| fold | encoder `sector` 类别 |
|---|---|
| fold0 | `ai, biotech, comms, growth_broad, semi` |
| fold1 | `ai, ai_network, biotech, comms, growth_broad, semi, semi_equip, storage` |
| fold2 | `ai_network, biotech, growth_broad, semi, semi_equip, storage` |

运行时 sector 的逐 fold 编码结果：

| 运行时 sector | ETF | 逐 fold 命中 | 命中数 | 与 `SECTOR_COVERAGE` 声明 |
|---|---|---|---|---|
| biotech | 159570 | ✓ ✓ ✓ | **3/3** | 3 ✓ 一致 |
| storage | 513310 | ✗ ✓ ✓ | **2/3** | 2 ✓ 一致 |
| ai_network | 515880 | ✗ ✓ ✓ | **2/3** | 2 ✓ 一致 |
| semi_equip | 159582 | ✗ ✓ ✓ | **2/3** | 2 ✓ 一致 |
| gold | 518880 | ✗ ✗ ✗ | **0/3** | 0 ✓ 一致 |

**结论更正**：
1. `gen1-capability.js` 的 `observed_folds` **不是**「训练覆盖声明」，而恰是「认识该字符串的 fold 数」——它与 frozen encoder **完全一致**，**不存在 metadata 与 encoder 的矛盾**。
2. 真实情况是：**storage / ai_network / semi_equip 各有 1/3 fold 将该类编码为 -1**（PARTIAL_COVERAGE 标注准确）；gold 3/3 均 -1（OUT_OF_DOMAIN 标注准确）。
3. 因此 P0-2 从「CANARY 阻断项」降级为 **「已知 encoder 契约事实 + 需在报告中如实标注」**；已写入 `GEN1_SECTOR_CONTRACT_AUDIT.json` 与 capability 文案。
4. 为防止未来漂移，capability 的 coverage 现**从 `ENCODER_SECTOR_FOLDS` 推导**，并由 **G1-J** 在 CI 中逐 fold 断言（不一致 → FAIL）。
5. 未修改 frozen model / encoder（红线遵守）。若未来需要显式映射（如 `storage→semi`），必须从原始训练数据证明并新建 runtime contract version。

---

## 三、工程 Gate（`npm test` → 32/32；Gen-1 门禁 13/13）

| Gate | 内容 | 结果 |
|---|---|---|
| Immutable（Stage C） | Gen-1 frozen×3 + model_id + V3.6.1×2 + GEN2 bundle×2 | 11/11 PASS |
| **G1-B** Feature Pipeline Lock | 4 文件 + root-of-trust + schema + bundle 指向 + **部署侧阈值 == frozen 阈值** | **10/10 PASS** |
| G1-C Python↔Node Parity | 420 行；max_abs_diff 1.54e-14；阈值 0 mismatch | PASS |
| G1-D Safety Permission | 15 组（含 6 组验收） | PASS |
| G1-E Domain Gate | 3 档映射 + 518880 OOD | PASS |
| G1-F Circuit Breaker | 健康映射 + 门 + 禁 auto reopen | PASS |
| G1-G Execution Boundary | 恒 false + 审计 + 文案守卫 | PASS |
| G1-H Production No-op | final_target/final_action 逐字段不变 | PASS |
| **G1-I** Model Candidate Gate | S2+P=.20/.64→false；.65→true；S3→false；ml_fast 矛盾→BLOCK | **PASS** |
| **G1-J** Sector Contract Audit | 逐 fold encoder vs capability（drift=0） | **PASS** |
| **G1-K** Persistent Health Latch | 跨冷启动保持 + 人工确认才恢复 | **PASS** |
| **G1-L** Economic Health Aggregator | 样本不足 → PENDING（禁用 OK） | **PASS** |
| **G1-M** Canary Portfolio Parity | 多科技候选聚合不破 tech cap | **PASS** |

负向测试：改一行 `indicators.js` → G1-B FAIL；改阈值不一致 → G1-B FAIL；篡改 V2.1 bundle → Immutable FAIL；`ml_execution_enabled=true` → 仍 false + 审计。

---

## 四、最终裁决

| Gate | V1 | **V2** | 依据 |
|---|---|---|---|
| Frozen Model | PASS | **PASS** | Immutable 11/11 |
| Feature Pipeline Lock | PASS | **PASS** | 10/10（新增阈值一致性） |
| Python ↔ Node Parity | PASS | **PASS** | 420 行 1.54e-14 |
| Data Fail-Closed | PASS | **PASS** | BENCHMARK/PIPELINE → DATA_BLOCKED |
| Domain Gate | ⚠️ 框架 PASS / contract 有问题 | **PASS**（contract 经审计一致，含已知 1/3 fold -1 事实） | G1-J |
| Production No-op | PASS | **PASS** | G1-H |
| **ADVISORY_PRODUCTION** | ⚠️ CONDITIONAL | ✅ **PASS** | Model Candidate Gate 修复了低概率误报「已触发」 |
| **CANARY_INFRASTRUCTURE_READY** | ❌ FAIL | ✅ **PASS**（附带条件：GitHub CI 需在新 head 跑绿） | 6 P0 全修 + G1-I~M |
| **CANARY_ECONOMIC_GATE** | ❌ FAIL | ❌ **FAIL（证据不足）** | 独立事件 2（<20）；economic_health = PENDING |
| **FULL_PRODUCTION** | ⛔ BLOCKED | ⛔ **BLOCKED** | 同上 + authority 未升 CANARY |

**当前仍禁止**：`gen1_authority = CANARY`、自动执行、修改 0.65、修改 frozen model。

---

## 五、Canary Replay 复跑（口径已与运行时对齐）

修正 replay 脚本后（显式提供 `ml_fast` / `stage`，与 `runGen1ShadowEod` 写出的信号行一致）复跑，结果与 V1 相同 —— 证明「回放路径 = 运行时路径」在 Model Candidate 维度上已一致：

| 指标 | 值 |
|---|---|
| 基线 S2 日数 | 698 |
| 候选（P≥0.65 且 ml_fast） | **3** |
| 独立事件（间隔≥40D） | **2** |
| Safety PERMIT / BLOCK | 3 / 0 |
| Canary 生效 | 3（含组合层 clamp 逻辑生效） |
| Timing gain（阶段权重和） | 0.705（mean +0.235） |
| False Fast Path | 0 |
| 增量 20D 超额均值 | +16.4%（**n=3，不作结论**） |

Fidelity 仍为 **PARTIAL_FIDELITY**（risk/fundamental 用 NORMAL/F3 代理；canary 只报阶段权重；regime 为 510300 MA 代理）。
因此 +16.4% 只能表述为：**「当前 runtime contract 下观察到 3 个正面案例」**，**不得**表述为「0.65 已被证明有效」。

---

## 六、12 问复核（更新）

| # | 问题 | V2 回答 |
|---|---|---|
| 1 | frozen model 一字未改？ | 是（SHA `d5e667c6…`，Immutable PASS） |
| 2 | 0.65 threshold 一字未改？ | 是（且新增 G1-B 断言部署侧常量 == frozen 阈值） |
| 3 | Feature Pipeline 有 immutable hash？ | 是（10/10，含阈值一致性） |
| 4 | Safety Permission 真由 runDecisionEngine 产生？ | 是（source=SAFETY_CORE） |
| 5 | EOD 预检与 Safety 分开？ | 是（`eod_precheck_*` vs `ml_rule_permission*`） |
| 6 | 510300 或核心特征缺失 Fail Closed？ | 是（BENCHMARK_MISSING / PIPELINE_MISSING） |
| 7 | 518880 OOD 禁 Fast Path？ | 是（BLOCK_CANARY；单测覆盖） |
| 8 | DEGRADED/ML_OFF 立即回退 V3.6.1？ | 是，且**跨 CloudBase 冷启动保持**（持久化 latch） |
| 9 | Python 与 Node 大样本一致？ | 是（420 行，1.54e-14） |
| 10 | `ml_execution_enabled=true` 仍无法开自动交易？ | 是（恒 false + `CONFIG_IGNORED_SECURITY_BOUNDARY`） |
| 11 | ADVISORY 下 final_target/final_action 与改前一致？ | 是（G1-H + 运行期 `verifyProductionNoop`） |
| 12 | 有无路径让 Gen-1 绕过 V3.6.1 Safety Core？ | **没有**；且新增 `model_candidate` 后，**Safety PERMIT 不再等价于模型触发** |

---

## 七、Residual（V2 未闭合项，须在下一轮处理）

1. **CANARY_ECONOMIC_GATE**：独立事件仅 2，需 Live Shadow 持续积累或另立研究任务书扩容样本；**在此之前不得研究/修改 0.65**。
2. **GitHub CI**：workflow 已修（stacked PR 会触发），但需在新 head 上实际跑绿后方可视作 required check 通过。
3. **Replay Fidelity**：risk/fundamental/组合约束仍为代理，需在真实 Live 数据上复核。
4. **sector 1/3 fold -1**：已如实标注；若要显式映射，须另立任务书并证明映射关系。

---

## 八、当前正式状态

```text
Gen-1 Frozen Model          PASS
Gen-1 Engineering Base      PASS
Gen-1 Production No-op      PASS
ADVISORY correctness        PASS
CANARY infrastructure       PASS（待 GitHub CI 绿）
CANARY economic evidence    FAIL / INSUFFICIENT
FULL PRODUCTION             BLOCKED
Auto Trading                OFF
```
