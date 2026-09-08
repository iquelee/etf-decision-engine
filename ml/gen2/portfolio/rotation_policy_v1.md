# Gen-2 Rotation Policy v1（Research Baseline）

**版本**：`rotation_v1_research_baseline`  
**状态**：研究参数，未验证，不是生产阈值。

---

## 1. 角色状态机

```text
CORE / SATELLITE / CHALLENGER / HEDGE / RESERVE
```

初始状态：

- Main5 incumbent 默认 `CORE`；
- 非 incumbent 默认 `RESERVE`；
- 黄金等防御资产可有 `HEDGE` 角色，但是否可成为正式 CORE 待用户确认。

---

## 2. 角色推导

输入：每日 `RankResult`。

研究基线：

| 角色 | 基线规则 |
|---|---|
| CORE | rank percentile >= 0.80，且通过 cluster cap |
| SATELLITE | 0.60 <= rank percentile < 0.80 |
| CHALLENGER | rank percentile >= 0.70，且具备替代 incumbent 潜力 |
| HEDGE | 防御资产且 leadership_score >= 45 |
| RESERVE | 其他 |

最终角色必须经过：

```text
Eligibility -> Cluster Constraint -> Replacement Edge -> Persistence -> Portfolio Candidate Set
```

---

## 3. Replacement Edge

```text
ReplacementEdge
= Challenger Leadership
- Incumbent Leadership
- Correlation Penalty
- Turnover Penalty
- Crowding Penalty
```

基线参数：

```text
min_replacement_edge = 8 score points
correlation_penalty = 2.0
turnover_penalty = 2.0
crowding_penalty = 1.0
promotion_persistence_days = 5
demotion_persistence_days = 5
```

---

## 4. Cluster 约束

基线：

```text
max_core_count = 5
max_core_per_cluster = 2
```

静态 cluster 由 `universe/clusters_v1.json` 定义。  
后续报告必须展示 cluster concentration，不允许 Top-N 直接成为组合。

---

## 5. 成本

```text
net_return = gross_return - turnover * cost_rate
```

敏感性至少输出：0 / 5 / 10 / 20 bps。

---

## 6. 生产隔离

```text
write_decision_result = false
write_portfolio_position = false
auto_execution = false
```

Gen-2.0 只输出研究文件，不写 CloudBase，不影响线上 Target / Action。
