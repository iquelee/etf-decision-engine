# Gen-2 Phase 2 — Universe Expansion & Selection Validation

> 更新：2026-09-05
> 上一阶段（Phase 1）结论：Gen-2 已完成「线上 Shadow 基础设施闭环」，但仍是 **Infrastructure Shadow**，不是 **Selection Shadow**。

---

## 一、Gate 状态分级（2026-09-05 固化）

| Gate | 状态 | 说明 |
|---|---|---|
| Gen-2 Infrastructure Gate | ✅ PASS | 代码可跑、可部署 |
| Gen-2 Online Shadow Gate | ✅ PASS | 定时落库、不污染生产 |
| Gen-2 Selection Alpha Gate | ❌ FAIL / UNPROVEN | Rank IC≈0，未证明能选出更强 ETF |
| Gen-2 Economic Gate | ❌ FAIL / UNPROVEN | Rule Rotation 弱于 Main5 |
| Gen-2 Advisory | 🚫 BLOCKED | 生产决策链禁止接入 |

**核心认知：不要再把「部署进度」当成 Gen-2 的进度。** 真正的进度看：Universe Coverage / Rank IC / Top-K Excess Return / Missed Leader / False Promotion / Selection Alpha / Incremental MDD / Turnover。

---

## 二、当前最本质的瓶颈

Gen-2 的使命是「判断 Main5 之外有没有更适合做主仓的 ETF」。但线上只跑 5 只（= 原 Main5），所以现在回答的是「这 5 只里谁最强」，而不是「整个候选池里钱最该去哪」。

- 当前定位：**Infrastructure Shadow**（验证管道）
- 目标定位：**Selection Shadow**（真正跨 ETF 选池）

---

## 三、Phase 2 十步顺序

1. universe 5 → 15（对齐本地 dev_universe_v0，可 deterministic replay）
2. 补 benchmark 510300（沪深300）
3. Local / Cloud parity 一致性验收（Rank/Role/Defense/Target 100% 一致，Score 极小容差）
4. universe 15 → 25~35（正式 universe_v1）
5. correlation cluster（真实相关性，替换现在的占位值）
6. Rule Ranking 重新回测
7. Selection Alpha 验证（Top-K excess return / Missed Leader / False Promotion）
8. Promotion / Demotion 校准
9. Replacement Engine（P1，不急）
10. Economic Gate（最终闸门 = 跑赢线上 V3.6.1 真实生产表现，而非仅 Main5 等权代理）

---

## 四、关键原则（必须遵守）

1. **universe_version 必须独立版本号**：`dev_universe_v0_online5` → `dev_universe_v1_15` → `universe_v1_30`，禁止悄悄扩数量不变号。
2. **persistence 切换 universe 时重置**：5 只池子的 rank/promotion/challenger persistence 历史不继承到 15/30 只池子。
3. **研究/生产隔离**：扩 Universe 用 `research_enabled/tradable/production_enabled` 三态区分，新增标的不进生产仓位系统（etf_basic 生产列表不扩）。
4. **Selection Alpha 与 Defense Alpha 必须拆解**：Defense Gate 对最终 target 影响极大（RISK_OFF 时 core 0.35+hedge 0.15），不能把「防守太保守」误判为「选池不行」。后续做 Attribution（Selection +Xpp / Defense +Ypp / Rotation Cost -Zpp / Net）。
5. **多基准比较**：统一 Gen2 vs Main5 vs UniverseEW vs Market(510300)，不能只和一个自定义等权代理比。
6. **小样本不产出生产级结论**：universe < 15 时，Role 分类标记 `LIMITED_UNIVERSE`，selection_confidence=LIMITED。

---

## 五、代码层要求（本阶段落地）

- `selection_confidence`：FULL / LIMITED / DEGRADED（+ reason，如 SMALL_UNIVERSE）
- `universe_coverage`：n / N + coverage_pct
- `role_classification`：universe_count < 15 → `LIMITED_UNIVERSE`
- 输出字段：universe_version / universe_coverage / selection_confidence / benchmark 明确标注

---

## 六、前端策略

- 主用户页面（全局/看盘/执行）**不**展示 Gen-2。
- 最多在 Admin 加「Gen-2 Shadow」研究页，标注 LIMITED / NOT PASSED / 仅基础设施验证。
