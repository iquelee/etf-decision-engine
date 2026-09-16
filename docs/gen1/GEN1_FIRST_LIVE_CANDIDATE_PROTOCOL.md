# Gen-1 首次 Live Candidate 里程碑协议

**归属**：WP-G1-EVIDENCE 运行侧配套
**触发**：`gen1_counterfactual_canary_invocations` **首次 > 0**
**性质**：只读验收 —— **不下线、不回退、不重启、不改配置**

---

## 0. 为什么需要这页

Canary 上线时 `invocations = 0`，这是**正常**的：
`invocations` 计的是「本轮真正执行了几次 Gen-1 反事实重算（S4 rerun）」
（`runDecisionEngine/index.js:777`：`if (canary.gen1_canary_effective === true) canaryInvocationCount += 1;`）。

`invocations = 0` 意味着：

> **Control Plane 已被证明活着**（授权/健康/账本三闸全绿，`active = true`），
> 但 **Candidate Data Path 从未有过一次真实调用** —— 当日没有任何一只 ETF 是 S2 Candidate。

第一个 `> 0` 是一次**真实触发**，不是故障。但它标志着系统第一次真正用真实数据走完了
「V3.6.1 baseline → Gen-1 Candidate → Safety PERMIT → S4 rerun → canary 建议」这条链路。
因此值得一次**结构化只读验收**。

---

## 1. 什么算 Candidate（触发条件，源码依据）

一个 code 当日成为 **Gen-1 Candidate** 必须**同时**满足
（`gen1-safety-permission.js`，`modelChecks` 四项全真）：

| 条件 | 源码 | 说明 |
|---|---|---|
| `stage == 'S2'` | `MODEL_STAGES = ['S2']` | v1 严格 S2-only（信号 stage，非基线 stage） |
| `ml_fast == true` | `signal.ml_fast === true` | 模型快速通路触发 |
| `calibrated_probability >= 0.65` | `thresholdSignalP` 默认 0.65 | frozen signal_p |
| `model_id` 精确匹配 | `HVT-A-ET-20260830` | 与冻结配置一致 |

**Safety PERMIT 不等于 Candidate**：Safety 只管「规则允许」，Candidate 还需模型自己触发。
所以「安全闸全开 + invocations = 0」是完全自洽的正常态（今天就是）。

**Candidate 之后仍需合成四门**才能 `effective_canary = true`
（`gen1-safety-permission.js:230`）：

```
effective_canary = candidate ∧ safetyPass ∧ dataOk ∧ domainOk ∧ healthAllowsCanary ∧ authorityCanary
```

---

## 2. 触发后立即执行（M1..M6，全部只读）

### M1 — 保存完整 decision_result 快照
```
outputs/wp-g1-evidence-20260910/first-live-candidate-<YYYY-MM-DD>.json
```
**全字段**保存，不裁剪、不筛选 —— 这是不可复现的一手证据。

### M2 — 保存完整 runtime_status 快照
```
outputs/wp-g1-evidence-20260910/first-live-candidate-runtime-status-<YYYY-MM-DD>.json
```

### M3 — 通路状态逐字核对
| 字段 | 期望 |
|---|---|
| `gen1_counterfactual_canary_authorized` | `true` |
| `gen1_counterfactual_canary_health_allowed` | `true` |
| `gen1_counterfactual_canary_active` | `true` |
| `gen1_counterfactual_ledger_ok` | `true` |
| `gen1_production_write` | `false` |
| `gen1_auto_execution` | `false` |

### M4 — No-op 不变量核对（生产零变更铁证）
比对触发前后的以下字段，必须**逐字节一致**：
`final_target`、`final_action`、`portfolio_position.*`、
`portfolio_snapshot.total_asset`、`portfolio_snapshot.total_pnl`。

### M5 — 记录第一条真实样本
从该 decision_result 中提取 Evidence Contract §2 的 17 字段，写入证据表第一行。
（`forward_5d/10d/20d/MFE/MAE` 暂为 `null`，待样本成熟回填。）

### M6 — 输出里程碑简报
内容：M1~M5 结果 + 明确结论「首个 Live Candidate 已产生，生产零变更」。

---

## 3. 明确不做（防止过度反应）

- ❌ **不**把 `gen1_authority` 回退 `ADVISORY`
- ❌ **不**重启 / **不**重新部署云函数
- ❌ **不**改 `param_config`
- ❌ **不**因为「第一次出现」就人工干预

> Canary 是**反事实**通路，`production_write` 恒 `false`。它的正常运转**不会**污染生产数据。
> 因此第一次触发的正确反应是「记录 + 核对」，而非「止损」。

---

## 4. 与 Evidence Contract 的关系

- 本协议负责**捕获首次触发**（样本质量保障）。
- `GEN1_EVIDENCE_CONTRACT.md` 负责**长期累计与判定**（经济价值结论）。
- 两者共同构成 WP-G1-EVIDENCE 的完整性：**先冻结口径，再收干净样本，最后判定**。

---

*触发即执行，无需等待额外指令；执行完毕后输出里程碑简报并归档快照。*
