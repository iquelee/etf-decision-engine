# Gen-2 Evaluation Protocol

**版本**：v1  
**适用**：Gen-2.0 Rule Baseline 与后续 Gen-2.1 Qlib Challenger。

---

## 1. 禁止事项

- 禁止 Random Split；
- 禁止全样本 fit scaler / encoder / feature selection；
- 禁止用最终幸存 ETF 回填历史 Universe；
- 禁止只报收益、不报回撤/换手/排名指标；
- 禁止 ML 只赢 Equal Weight 就宣称成功。

---

## 2. Walk-Forward

推荐 Expanding Walk-Forward：

```text
Fold 1: Train 2021-2023 -> Test 2024
Fold 2: Train 2021-2024 -> Test 2025
Fold 3: Train 2021-2025 -> Test 2026
```

实际日期按数据覆盖调整。

主 label horizon = 20D：

```text
purge_days >= 20 trading days
embargo_days = 5 trading days
```

训练窗口末端样本的 label 不得跨入测试窗口。

---

## 3. Benchmarks

至少同时保留四条：

1. **Fixed Main5 System**：当前 5 只 incumbent；
2. **Main5 Equal Weight**：识别仓位管理 Alpha vs Universe Selection Alpha；
3. **Expanded Universe Equal Weight**：识别扩展池本身收益分布；
4. **Rule Leadership Rotation**：Gen-2 ML 必须挑战的强基线。

---

## 4. 指标

### 4.1 排名指标

```text
Rank IC
Rank IC stability
Top-K forward return
Top 20% hit rate
Top-Bottom spread
Quantile monotonicity
```

### 4.2 经济指标

```text
Cumulative Return
Annualized Return
Excess Return
Sharpe
Sortino
MaxDD
Calmar
Exposure
ENA (Exposure-Normalized Alpha)
```

### 4.3 轮动指标

```text
Turnover
Core Residence Days
Promotion Count
Demotion Count
Replacement Success Rate
False Promotion Rate
Missed Leader Rate
Average Replacement Edge
```

### 4.4 组合结构指标

```text
Cluster Concentration
Tech Exposure
Average Pairwise Correlation
Max Pairwise Correlation
Diversification Contribution
Single Theme Concentration
```

---

## 5. 成本敏感性

每次完整回测至少输出：

```text
0 bps / 5 bps / 10 bps / 20 bps
```

---

## 6. Gen-2.0 通过标准

### Hard Gate

1. 无未来函数；
2. Point-in-time Universe 正确；
3. 数据完整性 PASS；
4. 结果可复现；
5. Gen-1 / V3.6.1 未修改；
6. Expanded Universe 每日稳定排名；
7. Role / Rotation 状态机无跳变 bug；
8. Cluster Constraint 正常；
9. 成本模型正常；
10. Fixed Main5 对照可重复。

### Economic Gate

至少出现多数证据：

- OOS Top Quantile 明显优于 Bottom Quantile；
- Rank IC 多数时间窗为正；
- Rule Rotation 相对 Fixed Main5 有正的风险调整增量；
- MDD 不因追热点显著恶化；
- Turnover 合理；
- 能减少 Missed Leader；
- Cluster concentration 不比 Fixed Main5 更差。

如果动态选池本身没有稳定价值，暂停 ML，优先检查 Universe / Label / Rotation 设计。
