# Integrated Shadow 接口契约（WP7 交付）

日期：2026-09-08。状态：引擎已实现并通过回归测试；消费端只读接口已就绪；前端观察页待接入（需动生产前端 web/，暂缓）。

## 一句话目标

Integrated Shadow 是「只读反事实」引擎：把 **Gen-2 选池 + Gen-1 择时 + V3.6.1 安全** 三层组合成一个 counterfactual 建议，**不写任何生产集合**（decision_result / portfolio_position / portfolio_snapshot），只写 `integrated_shadow_run` / `integrated_shadow_result`。

## 权限模型（Engine Authority Matrix）

| 能力 | Gen-2 | Gen-1 | V3.6.1 | Human |
|---|---|---|---|---|
| Universe Selection | ✅ | ❌ | ❌ | 可覆核 |
| ETF Ranking | ✅ | ❌ | ❌ | 可覆核 |
| Core/Challenger | ✅ Shadow | ❌ | ❌ | 可覆核 |
| Timing | 辅助 | ✅ | ✅ Rule | 可覆核 |
| Risk Gate | ❌ | ❌ | ✅ | 可覆核 |
| Single ETF Cap | ❌ | ❌ | ✅ | 可覆核 |
| Tech Cap | ❌ | ❌ | ✅ | 可覆核 |
| Final Target | ❌ | ❌ | ✅ | ✅执行 |
| Final Action | ❌ | ❌ | ✅ | ✅执行 |
| Auto Trading | ❌ | ❌ | ❌ | 手工 |

详见 `docs/Engine-Authority-Matrix.md`。

## 输入（三个，锚定同一交易日）

1. **Gen-2 Selection**：读最新 `gen2_run.status = completed`，固定 `run_id`，按 `run_id` 读完整 `gen2_ranking`（禁止按 ETF 单独取 latest）。
2. **Gen-1 Timing**：读 `ml_shadow_signal`，要求 `source_trade_date == Gen-2 as_of_trade_date`；否则 `timing_status = STALE`（不得静默使用旧信号）。
3. **V3.6.1 Baseline**：读 `decision_result`（`decision_date == anchor`），作为**生产历史基线**（source 明确为 production historical，非 recomputed baseline）。

## 依赖门（dependency gate）

锚定日 = 最新 completed `gen2_run.as_of_trade_date`。任一未就绪则写 `failed` run（不产出 completed 快照）：

| gate | 触发条件 |
|---|---|
| `GEN2_NOT_READY` | 无 `status=completed` 的 gen2_run |
| `V361_NOT_READY` | decision_result 无锚定日记录 |
| `GEN1_NOT_READY` | ml_shadow_signal 无锚定日记录 |
| `TRADE_DATE_MISMATCH` | V3.6.1 / Gen-1 数据存在但停在更早日期 |

## 四层决策过程

```
第一层 Gen-2：谁值得参与？→ CORE / CHALLENGER / SATELLITE / HEDGE / RESERVE
第二层 Gen-1：当前有没有 Timing Unlock？→ advisory_effective (PERMIT/BLOCK)
第三层 V3.6.1：风险环境允许多少？→ baseline_target / single_etf_cap / tech_cap
第四层 Integrated Proposal → 反事实建议（不注入生产）
```

## 集成反事实公式（counterfactual，仅影子）

对每只 Main5（513310/515880/159582/518880/159570，Gen-1 + V3.6.1 仅覆盖这 5 只）：

```text
baseline = v361_baseline_target（decision_result.final_target）

selection_effect（Gen-2 方向性意图，相对 baseline）：
  CORE      → +5 pct（ADVISORY_INCREMENT_PCT，影子结构参数）
  HEDGE     → 0（防守，维持 baseline）
  CHALLENGER/SATELLITE → 0（观察，不动作）
  RESERVE   → −baseline（未选中 → 反事实清仓）

timing_effect（Gen-1 择时否决）：selection 想上调但 advisory_effective=false → 否决该上调

proposed = baseline + selection_effect + timing_effect（≥0）

safety_effect（V3.6.1 安全 clamp）：
  clamped = min(proposed, single_etf_cap)
  组合层 tech_cap：Main5 tech 三只（storage/ai_network/semi_equip）clamped 之和 > tech_sector_max 时按比例缩
```

- `ADVISORY_INCREMENT_PCT = 5` 是**反事实结构参数**（非生产参数、非 Gen-2 alpha 权重），数值为占位，最终增量由 WP9 回测 Economic Gate 评估，不据此进入生产。
- 非 Main5 的 Gen-2 universe 标的：`integration_scope = SELECTION_ONLY`，只有 Gen-2 选池字段，gen1/v361/integrated 字段为 null。

## 输出 Schema

两个新集合：

### integrated_shadow_run（run_id 唯一）

```text
run_id, run_date, as_of_trade_date, mode(LIVE/REPLAY), status(running/completed/failed),
gen2_run_id, gen2_engine_id, gen2_bundle_version, gen2_bundle_sha256,
gen1_model_id, v361_engine_version,
dependency_gates[{gate,status,detail}], counts{total,full_integration,selection_only},
tech_cap_applied, single_etf_cap, tech_sector_cap,
production_write=false, auto_execution=false, created_at, completed_at
```

### integrated_shadow_result（run_id + code 唯一）

```text
run_id, trade_date, code,
gen2_run_id, gen2_engine_id, gen2_bundle_sha256,
gen2_rank, gen2_alpha_score, gen2_role, gen2_selection_share, gen2_candidate_weight,
gen1_model_id, gen1_signal, gen1_probability, gen1_rule_gate, gen1_advisory_effective,
v361_engine_version, v361_stage, v361_action, v361_baseline_target,
integrated_proposed_action, integrated_proposed_target,
safety_clamped_target, safety_clamped_action,
binding_constraints[], selection_effect, timing_effect, safety_effect, difference_vs_production,
explain_chain[], integration_scope(FULL/SELECTION_ONLY),
production_write=false, auto_execution=false, created_at
```

## Explain Chain（每只 Main5）

```json
[
  {"layer":"Gen-2 Selection","rank":2,"role":"CORE","selection_share":0.25},
  {"layer":"Gen-1 Timing","signal":"CANDIDATE","advisory":"PERMIT"},
  {"layer":"V3.6.1 Baseline","target":15,"action":"HOLD","stage":"S3"},
  {"layer":"Integrated Proposal","target":20},
  {"layer":"Safety Clamp","single_cap":30,"tech_cap":65},
  {"layer":"Final Shadow","target":20,"difference_vs_production":5}
]
```

## 消费接口

`GET /api/admin/integrated-shadow`（adminGateway，需登录 token）

可选 query：`date` / `trade_date` 指定读取某交易日 completed 快照；不传取最新 completed。

返回：`{ code:0, data:{ run:{...}, results:[...] } }`，按 `gen2_rank` 升序。`final_target` 明确不产出（反事实建议用 `safety_clamped_target` 表达）。

## 边界

- 生产写：`production_write=false`、`auto_execution=false` 恒真。
- 本引擎不调用 runDecisionEngine、不写生产集合，只写 integrated_shadow_*。
- Gen-2 只给 Selection Permission，不给最终仓位；Gen-1 只给 Timing Proposal；V3.6.1 保留风险与仓位最终约束。

## 回归测试

`tests/integrated-shadow.test.js`（23 项）：同日锚定、需 completed Gen-2、拒 stale Gen-1 / V3.6.1、四层权限模型、单只/科技 cap、production_write 恒 false、explain_chain。
