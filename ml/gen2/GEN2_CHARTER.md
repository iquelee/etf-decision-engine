# Gen-2 Charter — Cross-ETF Leadership / Dynamic Rotation

**版本**：v1.0  
**生效日期**：2026-09-05  
**状态**：Research Only / Production Write OFF / Auto Trading OFF  
**上游规格书**：`ETF决策系统_Gen2开发交接与技术规格书_2026-09-05.md`

---

## 1. Mission

> **Gen-2 = Cross-ETF Leadership / Dynamic Rotation Engine。**

Gen-2 负责回答：

1. 当前阶段最值得配置的是哪些 ETF？
2. 当前 Main5 incumbent 中，哪些应继续作为 Core？
3. 是否有 Challenger 已强到足以替代现有 Core？
4. 是否应降低同一相关性 Cluster 内的重复暴露？
5. 下一单位风险预算应该优先给谁？

一句话：

```text
Gen-2 负责 selection；Gen-1 负责 timing；V3.6.1 Safety Core 负责 risk/cap/target；Human 负责执行。
```

---

## 2. 非目标

Gen-2 第一阶段明确不做：

- 重训或修改 Gen-1 `HVT-A-ET-20260830`；
- 修改 Gen-1 阈值、校准、特征或冻结 manifest；
- 修改 V3.6.1 Stage / Target / Risk / Cap；
- 自动下单或接入 Fast Path；
- 将 Gen-2 输出直接写入生产 `decision_result` / `portfolio_position`；
- 用 LLM 直接决定 ETF 排名；
- 为了回测好看而随意修改 Universe；
- 将研究 ETF 立即写入生产 CloudBase。

---

## 3. 第一版架构

```text
Research Universe
 -> Eligibility / Data Quality
 -> Feature Builder
 -> Rule Leadership Score
 -> Cross-Section Rank
 -> Role Engine
 -> Replacement Engine
 -> Cluster Constraint
 -> Shadow Portfolio
 -> Backtest / OOS
```

Gen-2.0 不接 Qlib、不训练 ML，先验证动态选池是否相对 Fixed Main5 有稳定增量。

---

## 4. 硬约束

1. **Universe 唯一真相源**：所有模块统一从 `universe/etf_master.csv` + `universe/universe_v1.json` 读取，不允许脚本内散落 ETF 列表。
2. **Point-in-time**：回测任意日期 t 只能使用 t 日及以前可知数据。
3. **No Random Split**：未来 ML/OOS 必须 Purged Walk-Forward。
4. **Label overlap**：20D forward label 必须 purge 20D，建议 embargo 5D。
5. **Gen-1 immutable**：`test_gen1_immutable` 必须通过。
6. **V3.6.1 untouched**：不得改 Safety Core 源码与参数。
7. **生产写入关闭**：`write_decision_result=false`、`write_portfolio_position=false`、`auto_execution=false`。
8. **安全边界**：研究默认离线，不新增匿名写接口，不扩大公网暴露面。

---

## 5. 角色定义

```text
CORE         当前主要风险预算承载者
SATELLITE    有价值但不是第一优先级
CHALLENGER   有替代 Core 潜力，正在观察
HEDGE        主要承担防御/低相关功能
RESERVE      当前不值得占用主要风险预算
```

角色不是 ETF 的永久属性，而是每天由排名、持续性、替代边际和 cluster 约束共同决定。

---

## 6. 初始研究边界

当前 `dev_universe_v0` 只用于工程联调：

- 来源：`ml/universe-train-pool.json` + `deliverables/etf_daily_ml_pool/`；
- 覆盖：15 只本地前复权 ETF 日线；
- 不代表正式 25-35 只 `universe_v1`；
- 不用于最终经济结论。

正式 `universe_v1` 的 ETF 列表、Core 数量、cluster cap、Replacement Edge、成本参数均需用户确认。

---

## 7. 通过标准

Gen-2.0 不是追求第一版收益最高，而是先满足：

1. 无未来函数；
2. Point-in-time Universe 正确；
3. 数据完整性 PASS；
4. 结果可复现；
5. Gen-1 / V3.6.1 未被修改；
6. Expanded Universe 每日稳定排名；
7. Role / Rotation 是状态机而非每日 Top-N 硬切；
8. Cluster cap 生效；
9. 成本模型生效；
10. Fixed Main5 对照可复现。

只有在 Rule Leadership Baseline 显示明确 Universe Selection Alpha 后，才进入 Gen-2.1 / Qlib。

---

## 8. 不可变声明

```text
PRODUCTION WRITE = OFF
AUTO TRADING     = OFF
GEN1 MODIFIED    = NO
V361 MODIFIED    = NO
```

Gen-2 may challenge Gen-1; Gen-2 may never modify Gen-1.
