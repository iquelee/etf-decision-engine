# Gen-1 Production Readiness Report（WP-G1）

**日期**：2026-09-10
**范围**：WP-G1 — Gen-1 Production Readiness（G1-00 ~ G1-13）
**结论一句话**：**Gen-1 工程已生产就绪、可进入 Canary 观察；但经济资格未通过，FULL_PRODUCTION 保持 BLOCKED。**

---

## A. 当前版本

| 项 | 值 |
|---|---|
| Git SHA（WP-G1 起点 master） | `ede351fb5bb3c1a2888fb5d29cf7b74f603e3e73` |
| WP-G1 分支 | `feat/wp-g1-p1` / `-p2` / `-p3`（stacked，对应 PR #11 / #12 / #13） |
| Model ID | `HVT-A-ET-20260830` |
| Bundle ID | `gen1-runtime-hvta-20260830`（`ml/manifests/GEN1_RUNTIME_BUNDLE.json`） |
| Feature Pipeline Hash | `f21c4632009fe7c6…`（`GEN1_FEATURE_PIPELINE_LOCK.json`，ROOT anchor 同值） |
| Feature Schema Hash | `bbf0e0493a3ee28f…` |
| Threshold `signal_p` | **0.65（未改动）** |
| Calibration | `CalibratedClassifierCV(method=isotonic, cv=3)`；capability = `UNPROVEN` |

---

## B. Authority

| 维度 | 值 |
|---|---|
| Gen-1 authority | **ADVISORY**（`gen1-authority` 状态机；OFF/SHADOW/ADVISORY/CANARY/PRODUCTION） |
| V3.6.1 authority | **FINAL TARGET AUTHORITY（生产）** |
| Human authority | 人工执行（无券商接线） |
| Execution state | `execution_enabled = false`（**硬边界**，config 置 true 亦无效 + 审计） |
| production_write | **false（恒真约束）** |
| auto_execution | **false（恒真约束）** |
| CANARY 通路 | **READY / OFF**（默认 authority=ADVISORY，不产生 canary target） |

---

## C. 工程 Gate（`npm test` → 29/29 全绿）

| Gate | 内容 | 结果 |
|---|---|---|
| Immutable（Stage C） | Gen-1 frozen×3 + model_id + V3.6.1×2 + GEN2 bundle×2 | **11/11 PASS** |
| **G1-B Feature Pipeline Lock** | 指标/阶段/PARAMS/特征构建/schema + root-of-trust | **9/9 PASS** |
| **G1-C Python ↔ Node Golden Parity** | 420 行；Node 漂移 0；**max_abs_diff 1.54e-14**；阈值分类 **0 mismatch**；边界样本 16 | **PASS** |
| **G1-D Safety Permission** | 许可链 15 组（含任务包 6 组验收） | **PASS** |
| **G1-E Domain Gate** | IN/PARTIAL/OOD + 518880 核心验收 | **PASS** |
| **G1-F Circuit Breaker** | OK/WARNING/DEGRADED/ML_OFF + 禁 auto reopen | **PASS** |
| **G1-G Execution Boundary** | 恒 false + `CONFIG_IGNORED_SECURITY_BOUNDARY` | **PASS** |
| **G1-H Production No-op** | ADVISORY / CANARY / 污染输入下 final_target·final_action 逐字段不变 | **PASS** |
| Gen-2 parity（Stage D） | 360 行 role/rank 精确 | **PASS** |
| Secret scan / Build parity | — | **PASS** |

**负向测试已验证**：给 `src/common/utils/indicators.js` 加一行注释 → G1-B 立即 FAIL；篡改 V2.1 bundle → Immutable FAIL；`ml_execution_enabled=true` → 仍输出 false + 审计。

**Data Fail-Closed**：基准 510300 缺失或与 Main5 EOD 日期不一致 → `DATA_BLOCKED`（原实现静默 `rs_20d=null` 继续推理，已修）。

---

## D. 模型能力（诚实标签，未因「进入生产」而改动）

| 维度 | 评级 |
|---|---|
| Ranking（机会排序） | **PASS** |
| Threshold（0.65 阈值语义） | **UNPROVEN** |
| Calibration（概率校准） | **UNPROVEN** |
| Live Economic（实时经济价值） | **PENDING** |
| Live OOS（实时样本外） | **PENDING** |

**本次新增的重要观察（未修，仅记录）**：
1. **阈值 0.65 在历史数据上接近失效**：G1-12 回放 2023-01-01 ~ 2026-09-04，Main5 共 **698 个 S2 日**，概率 ≥0.65 仅 **3 次**（占 0.43%）。参数阈值若要可用，需要独立研究（不在本工作包，且禁止在 WP-G1 内调整）。
2. **sector 词表不一致（数据契约问题）**：冻结模型训练类别为 `{ai, biotech, comms, growth_broad, semi}`，而运行时 `runGen1ShadowEod` 传入 `{storage, ai_network, semi_equip, gold, biotech}` → **除 biotech 外全部编码为 -1（unknown）**。属既有冻结行为，**未修改**；已写入 fixture notes 供后续研究。

---

## E. 最终裁决

| 裁决 | 结果 |
|---|---|
| **ADVISORY_PRODUCTION** | ✅ **PASS** |
| **CANARY_INFRASTRUCTURE_READY** | ✅ **PASS** |
| **CANARY_ECONOMIC_GATE** | ❌ **FAIL（样本量不足，无法证明经济价值）** |
| **FULL_PRODUCTION** | ⛔ **BLOCKED** |

### E.1 ADVISORY_PRODUCTION = PASS 的依据
- Authority 状态机单一真相；`production_write` / `auto_execution` 恒 false。
- Safety Core Permission 真正由 `runDecisionEngine` 产生（source=`SAFETY_CORE`），与 EOD 预检分离。
- Data / Domain / Circuit Breaker / Execution 全部 Fail-Closed。
- **Production No-op 成立**：ADVISORY 下 `final_target` / `final_action` 与整改前逐字段一致（Gate G1-H）。
- Immutable + Feature Pipeline Lock 双重锚定，改一行指标实现即 CI FAIL。

### E.2 CANARY_ECONOMIC_GATE = FAIL 的依据（G1-12 回放）
口径: `PARTIAL_FIDELITY`（risk/fundamental 无历史 → 固定 NORMAL/F3；canary 只报阶段权重，不重放完整 V3.6.1 caps；regime 为 510300 MA20/MA60 代理）

| 指标 | 值 |
|---|---|
| 基线 S2 日数 | 698 |
| 候选（P≥0.65） | **3** |
| 独立事件（间隔≥40D） | 2 |
| Safety PERMIT / BLOCK | 3 / 0 |
| OOD BLOCK（518880） | 0（期间无 S2 候选） |
| Data BLOCK | 0 |
| Canary 生效次数 | 3 |
| Timing gain（阶段权重和） | 0.705（mean +0.235/事件） |
| False Fast Path | 0 |
| 增量 20D 超额（均值） | +16.4% |
| 增量 MDD 代理 | 0 |

**判定理由**：独立事件仅 **2** 个，统计上**无任何功效**；且阈值 0.65 在 3.5 年内只触发 3 次 → **不能据此批准经济资格**。样本为正只说明「未观察到立即失败」，不构成 PASS。

---

## F. 12 个必答问题

| # | 问题 | 回答 |
|---|---|---|
| 1 | Gen-1 frozen model 是否一字未改？ | **是。** `frozen-model.json` SHA `d5e667c6…` 与 GEN1_IMMUTABLE_LOCK 一致；Immutable 11/11 PASS。 |
| 2 | 0.65 threshold 是否一字未改？ | **是。** `frozen-manifest.json` SHA `30f5fe1c…` 未变；fixture 记录 `threshold_signal_p=0.65`。 |
| 3 | Gen-1 Feature Pipeline 是否已有 immutable hash？ | **是。** `GEN1_FEATURE_PIPELINE_LOCK.json`（4 文件）+ root anchor + derived schema hash；`GEN1_RUNTIME_BUNDLE.json` 记 `feature_pipeline_hash=f21c4632…`。 |
| 4 | Safety Permission 是否真正由 `runDecisionEngine` 产生？ | **是。** 读当日 `ml_shadow_signal` → `evaluateGen1Permission` → 经 `applyGen1Overlay` 写入 `decision_result.ml_rule_permission*`（source=`SAFETY_CORE`）。 |
| 5 | EOD Stage Precheck 与 Safety Permission 是否已分开？ | **是。** `eod_precheck_permission`（EOD_STAGE_PRECHECK）与 `ml_rule_permission`（SAFETY_CORE）为两个独立字段；UI 只用后者。 |
| 6 | 510300 或核心特征缺失时是否 Fail Closed？ | **是。** `BENCHMARK_MISSING` / `PIPELINE_MISSING` → `DATA_BLOCKED` → advisory & canary 均关闭（概率保留诊断）。 |
| 7 | 518880 OOD 时是否禁止 Fast Path？ | **是。** `domain_permission=BLOCK_CANARY`；单测验证 P=0.95+S2+Safety PERMIT 仍 `effective_canary=false`。 |
| 8 | `DEGRADED / ML_OFF` 是否能立即退回纯 V3.6.1？ | **是。** `circuitGate(ML_OFF).immediate_fallback_v361=true`；`runDecisionEngine` 将 params 降为 `ml_shadow_observe=false` → Safety 一律 BLOCK，无需部署。恢复须人工复核（禁 auto reopen）。 |
| 9 | Python 与 Node 的大样本推理是否全部一致？ | **是。** 420 行；max_abs_diff **1.54e-14**（<1e-10）；阈值分类 0 mismatch。 |
| 10 | `ml_execution_enabled=true` 是否仍无法开启自动交易？ | **是。** `resolveExecution` 恒返回 false，并产生 `CONFIG_IGNORED_SECURITY_BOUNDARY` 审计。 |
| 11 | ADVISORY 状态下 `final_target/final_action` 是否与修改前完全一致？ | **是。** Gate G1-H 单测（ADVISORY/CANARY/污染输入三情形）+ 运行期 `verifyProductionNoop` 自检。 |
| 12 | 当前是否有任何代码路径能让 Gen-1 绕过 V3.6.1 Safety Core？ | **没有。** authority 最高允许 CANARY 且 `PRODUCTION` 永久锁定；`applyGen1Overlay` 硬还原 `final_target`/`final_action`；canary 仅写 `gen1_canary_*`；production_write / auto_execution 恒 false。 |

---

## G. 架构（落地后）

```
Gen-1 Frozen Model (HVT-A-ET-20260830)
        │  ← Feature Pipeline Lock (G1-04) + Data Health Gate (G1-05)
        ▼
   Probability
        │
   Domain Gate (G1-06)          OUT_OF_DOMAIN → BLOCK_CANARY
        │
   Safety Core Permission (G1-02)   source = SAFETY_CORE
        │
   Circuit Breaker (G1-07)      DEGRADED→禁 Canary / ML_OFF→回退 V3.6.1
        │
        ▼
   Gen-1 Timing Permission  ── authority ≥ CANARY ──▶ S2→S4 Override
        │                                                │
        │                                     V3.6.1 Safety Core（risk/fundamental/cap）
        │                                                │
        │                                          Canary Target（gen1_canary_*）
        ▼
   Production = V3.6.1（final_target / final_action 不变）→ Human Execution
```

## H. 当前正式状态

```text
Gen-1 Model               FROZEN
Gen-1 Engineering         PRODUCTION READY
Gen-1 Authority           ADVISORY
Gen-1 Canary Path         READY / OFF
V3.6.1 Final Authority    ON
Auto Trading              OFF
Economic Canary Approval  PENDING
```

## I. 后续建议（不在本工作包范围）

1. **Economic Canary Gate 需要更多独立事件** —— 当前 3.5 年仅 3 个候选，无法评估。建议：先在 Live Shadow 持续积累，或在**单独研究任务书**中重新审视阈值语义（WP-G1 内禁止调整）。
2. **sector 词表不一致** 需独立立项（属冻结模型/特征契约问题）。
3. 本文档与 `docs/gen1/GEN1_CURRENT_STATE_20260910.md`、`gen1_canary_replay_20260910.json` 为 WP-G1 的完整交付证据链。
