# Gen-2 Feature Spec v1

**Feature Version**：`feature_v1`  
**适用范围**：Gen-2.0 Rule Leadership Baseline  
**核心原则**：因果、横截面可比、跨资产可泛化。

---

## 1. 数据输入

输入为统一后的 Daily Bar：

```text
trade_date, code, open, high, low, close, volume, amount, adj_close, source, source_trade_date
```

唯一键：`(code, trade_date)`。

当前本地 qfq 源中 `adj_close = close`，但 schema 保留 `adj_close`，未来切换数据源时不能破坏特征版本。

---

## 2. 特征分组

### 2.1 Trend

| 字段 | 定义 | 解释 |
|---|---|---|
| `px_ma20` | close / MA20 - 1 | 短期趋势位置 |
| `px_ma60` | close / MA60 - 1 | 中期趋势位置 |
| `ma20_slope_5d` | MA20(t) / MA20(t-5) - 1 | 短均线斜率 |
| `ma60_slope_10d` | MA60(t) / MA60(t-10) - 1 | 中均线斜率 |

### 2.2 Relative Strength

| 字段 | 定义 | 解释 |
|---|---|---|
| `rs20_vs_benchmark` | ETF 20D return - benchmark 20D return | 相对沪深300强弱 |
| `rs60_vs_benchmark` | ETF 60D return - benchmark 60D return | 中期相对强弱 |
| `rs20_percentile_universe` | 当日 eligible universe 内 `rs20_vs_benchmark` 分位 | 横截面领导力 |
| `rs_accel_5d` | RS20(t) - RS20(t-5) | 相对强度加速度 |

### 2.3 Momentum

| 字段 | 定义 |
|---|---|
| `ret_5d` | close / close(t-5) - 1 |
| `ret_20d` | close / close(t-20) - 1 |
| `ret_60d` | close / close(t-60) - 1 |
| `momentum_accel_5_20` | ret_5d - ret_20d |

### 2.4 Consolidation / Volume

| 字段 | 定义 |
|---|---|
| `sideway_days` | 最近连续满足 20D range <= 15% 的交易日数 |
| `sideway_range` | 最近 20D high/low 区间振幅 |
| `volume_ratio_5_20` | 5D 均量 / 20D 均量 |
| `volume_compression_slope` | volume_ratio_5_20(t) - volume_ratio_5_20(t-5) |

### 2.5 Breakout

| 字段 | 定义 |
|---|---|
| `breakout_distance` | close / 最近 60D 高点 - 1 |
| `recent_breakout_flag` | 最近 5 日内是否收盘突破此前 60D 高点 |

### 2.6 Volatility

| 字段 | 定义 |
|---|---|
| `atr20_pct` | ATR20 / close |
| `realized_vol20` | 20D 日收益标准差 × sqrt(252) |
| `volatility_compression` | realized_vol20(t) / realized_vol20(t-20) - 1 |
| `max_drawdown_20d` | 最近 20D 最大回撤 |

### 2.7 Liquidity

| 字段 | 定义 |
|---|---|
| `avg_amount_20d` | 20D 平均成交额 |
| `avg_amount_60d` | 60D 平均成交额 |
| `liquidity_percentile` | 当日 universe 内 avg_amount_20d 分位 |

### 2.8 Portfolio / Correlation

| 字段 | 定义 |
|---|---|
| `corr_to_portfolio_60d` | 与当日现有 incumbent Main5 等权收益序列的 60D 相关 |
| `corr_to_cluster_60d` | 与所属 cluster 其他成员等权收益序列的 60D 相关 |
| `diversification_score` | `1 - max(0, corr_to_portfolio_60d)`，同日横截面标准化 |

### 2.9 Regime

| 字段 | 定义 |
|---|---|
| `market_score` | benchmark `px_ma20` 与 `px_ma60` 的简单合成 |
| `breadth_proxy` | 当日 universe 内 close > MA20 的比例 |
| `risk_state` | `RISK_ON` / `NEUTRAL` / `RISK_OFF` |

---

## 3. 因果约束

1. Feature(t) 只允许使用 `<= t` 的数据；
2. 同日横截面分位只使用 t 日当时 eligible ETF；
3. 禁止用完整样本期 fit scaler；
4. 上市不足 `min_history_days=120` 的日期不输出可交易特征；
5. 末尾不足 20D 的日期不得伪造 label。

---

## 4. 输出

Feature Builder 输出统一 `FeatureRow`：

```json
{
  "trade_date": "2026-08-28",
  "code": "159582",
  "features": {"ret_20d": 0.12},
  "feature_version": "feature_v1",
  "data_version": "daily-qfq-v1"
}
```
