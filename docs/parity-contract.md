# Gen-2 跨语言 Parity 契约（Python ↔ Node）

> 目标：让 Python 回测（`ml/gen2`）与 Node 生产（`runGen2ShadowEod`）在**决策层**逐字段一致，
> 确保「回测结论」可信地代表「线上行为」。本契约是 CI Gate 4（`scripts/parity/compare.py`）的比对标准。

## 覆盖边界

Parity 只覆盖 **特征层之后的决策链**（评分 → 排名 → 角色 → 组合 → 防守）：

```
raw bars ──(数据正确性，另测)──▶ feature 矩阵 ──▶ 本契约 ──▶ role / rank / weight / defense
```

特征计算（`build_features.py` vs `computeTimeSeriesFeatures`）属于 stage -1 数据正确性，
有独立测试（`test_gen2_foundation.py`），不在本契约内。

## 比对字段与容差

| 字段 | 类型 | 容差 | 说明 |
|---|---|---|---|
| `role` / `proposed_role` / `defense_state` / `regime` | 字符串 | 精确 | 决策核心 |
| `trend_gate` | 布尔 | 精确 | NO_CORE 硬门槛 |
| `rank` | 整数 | 精确 | alpha 排名（tie 按 code asc） |
| `rank_percentile` | 浮点 | 1e-9 | 两端均未四舍五入 |
| `leadership_score` / `alpha_score_v2` / `trend_score` / `rs_score` | 浮点 | 1e-2 | Node 输出四舍五入 2dp |
| `target_weight` | 浮点 | 1e-4 | Node 输出四舍五入 4dp |

> 「1e-8」是底层浮点运算精度；实际比对用 Node 输出的四舍五入容差（2dp / 4dp）。
> role / rank 100% 精确，正是任务书要求的硬性一致。

## fixture（`fixtures/gen2/parity_fixture.json`）

- 由 `scripts/parity/gen_fixture.py` 确定性生成：30 只 universe（与 Node `UNIVERSE` 严格一致）× 12 个交易日。
- 三段 regime：`RISK_ON(70)` → `RANGE(50, vol 0.25)` → `RISK_OFF(30)`，覆盖：
  - **promotion**（挑战者 5 日晋升 CORE）
  - **demotion**（现任跌破 satellite 后退位）
  - **cluster cap**（tech_hardware 4 只 CORE → 2）
  - **replacement gate**（现任被 cap 降级，同 cluster 挑战者边际达标 → ACCEPT）
  - **NO_CORE**（`588000` 跌破 MA60，高 alpha 仍被拦下）
  - **tech cap**（广义科技权重 0.65 截断）
  - **vol target**（RANGE 阶段 0.17/0.25=0.68 缩放）
  - **RISK_OFF 防守**（核心 0.35 缩放 + 黄金 0.15 hedge）

## 运行

```bash
# 单独跑 parity
PYTHONPATH=ml python scripts/parity/compare.py \
  --node <node> --python <python>

# 全量门禁（含 parity = Stage D）
node scripts/test-all.js
```

## 本次为对齐所修的漂移（P0-Parity）

| 漂移 | Python（旧） | 对齐后（= Node 生产） |
|---|---|---|
| liquidity_score | `liquidity_percentile * 100`（依赖 feature 层预计算） | `pct(avg_amount_20d)` |
| diversification_score_v1 | `diversification_score.fillna(50)` | `pct(1 - corr_to_portfolio_60d).fillna(50)` |
| alpha 排名 tie-break | 无显式 tie-break（隐式按旧排序） | `[trade_date, alpha desc, code asc]` |
| above_core 累计 | `alpha_pct >= core_pct`（不含趋势闸门） | `(alpha_pct >= core_pct) & trend_gate` |
| F09 替换门 | **缺失**（仅 cluster cap，无 replacement revoke） | 移植 `applyReplacementGate` + `assertFinalRoleConstraints` |

## 已知缺口（不在本契约内）

1. **reason_codes 字符串**：两端诊断文案有差异（如 Node `DEMOTION_HYSTERESIS_KEEP` vs 语义等价的历史文案、
   hedge 是否附加 `DEFENSIVE_HEDGE_BASELINE`）。**不影响决策**，未纳入比对，作为后续文案统一项。
2. **null liquidity 传播**：`avg_amount_20d` 为 null 时，Node 用 `mean()`（忽略 null，贡献 0），
   Python `rank(pct)` 产生 NaN 会传播到 leadership_score。实际有效 ETF 无 null，fixture 也不含 null；作为边界项记录。
3. **Python 缺失 `build_v2_roles` 的 reason_codes 细节**：`CLUSTER_CAP_DEMOTED` 等 cap 诊断在 Python 侧未附加（Node 有）。同上，属文案项。

## CI Gate 4 / Gate 6

- `.github/workflows/test.yml`：Node 22 + Python 3.11/3.12 矩阵，跑 `node scripts/test-all.js`（Gate 1–5），
  另加 Gate 6 校验 `GEN2_RULE_V2_BUNDLE.json` 无随提交漂移。
