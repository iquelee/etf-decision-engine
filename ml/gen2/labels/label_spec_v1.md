# Gen-2 Label Spec v1

**Label Version**：`label_v1_excess_rank_20d`  
**主任务**：未来 20 个交易日横截面 Leadership Ranking。

---

## 1. 主 Label

对任意日期 t 和 eligible ETF i：

```text
future_ret_20d_i = adj_close_i(t+20) / adj_close_i(t) - 1
universe_future_ret_20d = mean(future_ret_20d of all active eligible ETFs at t)
y_excess_20d_i = future_ret_20d_i - universe_future_ret_20d
y_rank_20d_i = percentile_rank(y_excess_20d_i) within date t
```

说明：

- `t+20` 指未来第 20 个交易日，不是自然日；
- 只使用当日 active eligible universe 计算 equal-weight 对照；
- 末尾不足 20D 的样本 label 为缺失，不进入训练/评估。

---

## 2. Secondary Label

```text
y_leader_20d = 1 if y_rank_20d >= 0.80 else 0
```

用途：Precision@TopK、Top quantile hit rate、事件级 Leader 捕获。

---

## 3. 风险调整探索 Label（暂不启用）

```text
y_ra_20d = future_excess_return - lambda * adverse_risk
```

候选 adverse_risk：future 20D MaxDD / MAE / realized volatility。  
任何启用都必须升为 `label_v2`，不能覆盖 `label_v1` 定义。

---

## 4. 防泄漏规则

1. Feature(t) 只允许使用 `<= t`；
2. Label 可以使用 `t+1 ... t+20`，但不得进入 feature；
3. 训练/测试必须 purge 20D label overlap；
4. 建议额外 embargo 5D；
5. 测试窗口起点前不得保留 label 跨入测试期的训练样本；
6. 不允许 Random Split。

---

## 5. Walk-Forward 约定

```text
purge_days = 20 trading days
embargo_days = 5 trading days
```

每个 fold 都必须记录：

```text
train_start, train_end, test_start, test_end, purge_days, embargo_days
```
