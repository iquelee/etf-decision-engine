# V3.6.4 Gate B —— Same-Day Idempotence Full-chain Replay

- 生成时间：2026-09-22T05:21:19.292Z
- 区间：**2026-03-16 ~ 2026-09-04**（120 个五票共同交易日）
- universe：518880, 159570, 513310, 515880, 159582
- 变体 A（RUN_ONCE）：每个交易日运行 **1** 次
- 变体 B（RUN_3X）：每个交易日连续运行 **3** 次，三次使用**相同** `snapshot.calc_date`
- 完整生产链状态：`trend_stage_state` / `shock_state` / `slow_break_history` / 组合账面 / 科技赛道额度全部按生产调用序列滚动
- 幂等机制：`planRunInput` / `finalizeState`（与 `runDecisionEngine` 接线同构）

## 判定：**PASS**

| 比较 | 规模 | 漂移数 | 结论 |
|---|---|---|---|
| 逐日 × 逐票 × 10 个决策字段 | 6000 次字段比对 | **0** | PASS |
| 同日内部（第 1 次 vs 第 3 次）逐字段 | 120 天 | **0** | PASS |
| 日末状态（非审计字段） | 5 票全量字段 | **0** | PASS |
| 日末账面（suggested_position 滚动） | 5 票 | **0** | PASS |

比较字段：

```
trend_stage_primary, trend_stage_overlay, pendingStage, pendingDays, days_in_stage, soft_down_days, s5_risk_days, breakout_level, final_target, final_action
```

允许不同的运行审计字段（不参与生产决策）：

```
last_evaluated_trade_date, day_start_state, trade_date_anchored, idempotence_reason
```

> 审计字段实际差异条数：**5**。
>
> **这是预期且必需的**：RUN_ONCE 的最后一次运行是 `new_trade_date`，RUN_3X 的最后一次运行是 `same_trade_date_replay` ——
> 这条差异正是「第 2/3 次确实走了同日重放路径」的**正面证据**。
> 预期条数 = 5（每只 ETF 一条）。实测 5 条。
>
| code | field | RUN_ONCE | RUN_3X |
|---|---|---|---|
| 518880 | idempotence_reason | `new_trade_date` | `same_trade_date_replay` |
| 159570 | idempotence_reason | `new_trade_date` | `same_trade_date_replay` |
| 513310 | idempotence_reason | `new_trade_date` | `same_trade_date_replay` |
| 515880 | idempotence_reason | `new_trade_date` | `same_trade_date_replay` |
| 159582 | idempotence_reason | `new_trade_date` | `same_trade_date_replay` |

## 状态轨迹抽样（每 20 个交易日）

| trade_date | 513310 | 515880 | 159582 | 518880 | 159570 |
|---|---|---|---|---|---|
| 2026-03-16 | S2/normal p-:0 d0 sd0 r0 T30 BUILD | S2/normal p-:0 d0 sd0 r0 T35 BUILD | S2/broken p-:0 d0 sd0 r0 T8.5 WAIT | S2/normal p-:0 d0 sd0 r0 T30 BUILD | S0/broken p-:0 d0 sd0 r0 T8.5 WAIT |
| 2026-04-14 | S2/normal p-:0 d20 sd0 r0 T12 HOLD | S5/normal p-:0 d3 sd0 r0 T12 HOLD | S2/normal pS5:1 d3 sd0 r0 T12 HOLD | S2/broken p-:0 d4 sd0 r0 T30 HOLD | S3/normal p-:0 d6 sd0 r0 T24 HOLD |
| 2026-05-15 | S5/normal p-:0 d9 sd0 r0 T11.4 HOLD | S5/normal p-:0 d3 sd0 r0 T11.4 HOLD | S5/normal p-:0 d19 sd0 r0 T11.4 HOLD | S0/broken p-:0 d2 sd0 r0 T30 HOLD | S0/broken p-:0 d7 sd0 r0 T8.5 WAIT |
| 2026-06-12 | S2/normal p-:0 d0 sd0 r0 T16.6 HOLD | S2/normal p-:0 d2 sd0 r0 T16.6 HOLD | S2/normal pS5:1 d4 sd0 r0 T16.6 HOLD | S0/broken p-:0 d22 sd0 r0 T12.5 HOLD | S0/broken p-:0 d27 sd0 r0 T8.5 WAIT |
| 2026-07-13 | S2/normal p-:0 d6 sd0 r0 T22.9 TACTICAL_REDUCE | S2/broken p-:0 d5 sd0 r0 T12 HOLD | S5/normal p-:0 d19 sd0 r0 T22.9 HOLD | S0/broken p-:0 d42 sd0 r0 T30 HOLD | S0/normal pS1:1 d2 sd0 r0 T30 WAIT |
| 2026-08-10 | S0/broken p-:0 d8 sd0 r0 T8.5 HOLD | S0/broken p-:0 d12 sd0 r0 T8.5 HOLD | S2/normal p-:0 d14 sd0 r0 T30 ADD | S1/normal p-:0 d0 sd0 r0 T30 HOLD | S0/normal pS1:1 d8 sd0 r0 T30 WAIT |

## 方法学边界

- 重放的是**完整生产调用序列**（状态/账面/赛道额度滚动），不是纯函数单测。
- `indicator_snapshot` 由真实 OHLCV 经 `indicators.computeSnapshot` 重推导；A/B 两变体使用**完全相同**的输入序列。
- 本 Gate 只能证明「同一天重复运行不产生漂移」，不能证明「跨日语义正确」；跨日语义由 Gate A 与单测共同覆盖。
