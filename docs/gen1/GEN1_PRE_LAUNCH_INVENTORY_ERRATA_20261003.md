# GEN1 PRE-LAUNCH INVENTORY —— 勘误件 ERRATA-1（★ 只读登记，⛔ 不回改已 ACCEPT 的主件）

> 上游：`GEN1_PRE_LAUNCH_INVENTORY_20261002.md`（owner 2026-10-03 正式 **ACCEPT**）
> 触发：只读 Gate `GEN1_GAP_DEPENDENCY_AND_IMPLEMENTATION_PLAN`（2026-10-03）逐行取证时发现
> 性质：**登记性勘误**。⛔ 不修改已 ACCEPT 主件的任何字节；⛔ 不改变其任一最终判定。
> 证据级别：`online-db-20261002`（`probe_run_candidate_decision.json`，10 行逐值）

---

## ERRATA-1 —— `gen1_candidate_hash` 的实际分布

| 项 | 内容 |
|---|---|
| **被勘误句** | `GEN1_PRE_LAUNCH_INVENTORY_20261002.md` §1 表 第 4 行：「线上 `run_candidate_decision` **全部 10 行**：`gen1_adopted=False` · **`gen1_candidate_hash=None`** · `gen1_effective_guarded=False` · `gen1_guarded_result_target=None`」 |
| **问题** | 「**10 行**」这一量词使「`gen1_candidate_hash=None`」被读成**普遍成立**；实测**仅 5 行**为 `None` |
| **实测** | `engine:2026-09-30:b1790776862980` 的 5 行 ⇒ `None`；`engine:2026-10-01:b1790812813101` 的 5 行 ⇒ **非空 64-hex**，逐标的各异：`518880 dac28d13…` · `159570 0310688d…` · `159582 3da0157e…` · `515880 dc8572f9…` · `513310 eeadc0ed…` |
| **同件内部矛盾** | 主件 §1.2 表已列出 `engine:2026-10-01` 那次 run 的 `gen1_run_id='gen1-eod-20260930142005894-b10c55'`。而 `buildGuardedAudit()`（`gen1-guarded-selector.js:149-160`）中 `gen1_candidate_hash = signal ? candidateHash({…}) : null` —— `signal != null` ⇒ `candidateHash()` **必然返回哈希**。⇒ 两处**不可能同时为真** |
| **根因（推定）** | §1 行 4 的四个字段来自**同一行**的取值，但四者分布并不同构（`gen1_adopted` 10/10 False；`gen1_candidate_hash` 5/5 分裂）⇒ 疑似按首个 run 的取值外推 |
| **更正** | `gen1_candidate_hash`：**5/10 = `None`**（09-30 run，signal 未命中）· **5/10 = 非空**（10-01 run） |

## 更正后须同步精确化的推论（★ 重要）

| 原表述 | 更正后表述 |
|---|---|
| 「**没有 Gen-1 candidate 这一实体**」 | **缺失的是 `guardedShadowResult` 对象**（`gen1_guarded_shadow_source=None` 10/10 · `gen1_guarded_result_target=None` 10/10），**不是** candidate 溯源哈希。溯源哈希（`gen1_candidate_hash`）**已真实产出过 5 次** |

```text
Gen-1 溯源哈希 gen1_candidate_hash            = 已产出（10-01 run 5/5）
Gen-1 guarded candidate 对象 guardedShadowResult = 恒 null（shadow eligibility 不成立）
Gen-1 被采纳 candidate  gen1_adopted=true     = 恒不存在（10/10 false）
```

## 影响评估

| 项 | 是否改变 |
|---|---|
| `GEN1_IN_DECISION_CHAIN = NOT READY` | ⛔ **不变** |
| `A-1` 为 PRIMARY FUNCTIONAL BLOCKER | ⛔ **不变**（但**性质**由「未接线」更正为「接线产物被上游门链挡在 `null`」） |
| 37 项缺口数量与分类 | ⛔ **不变** |
| `GEN1_PRODUCTION_READ_PATH_INTEGRATION = MISSING` | ⛔ **不变** |
| 新增 Gate 的 CRITICAL_PATH 首段 | ✅ **受此更正影响** —— 首因确认为 `BASELINE_STAGE_NOT_ELIGIBLE`（阶段门），⛔ 非 selector |

## ⛔ 处置约束

```
1. ⛔ 不修改 GEN1_PRE_LAUNCH_INVENTORY_20261002.md 的任何字节（已 ACCEPT，属被检对象）
2. ⛔ 不因本勘误回改任何已封存件（V6 Evidence Freeze Seal / Key 2 / FNR v1.1）
3. ✅ 本勘误随 Gate GEN1_GAP_DEPENDENCY_AND_IMPLEMENTATION_PLAN 同批入库（新增文件，非覆盖）
4. ✅ 后续凡引用「Gen-1 candidate 不存在」之处，一律改引本勘误的精确定义
```
