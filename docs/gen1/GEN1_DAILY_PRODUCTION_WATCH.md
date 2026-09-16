# Gen-1 生产侧每日监控清单（Daily Production Watch）

**生效日**：2026-09-11（明日）起，每个交易日
**初始状态**：`gen1_authority = CANARY`，`counterfactual_canary_active = true`，`invocations = 0`
**监控性质**：**只读**。发现异常 → 记录 + 上报，**不自动处置、不改配置、不回退权限**。

---

## 1. 每日只查这 7 项（不再多查）

跑完 EOD 后，读一次 `runtime_status`（最新一条，`sort: updated_at desc, limit 1`），核对下表：

| # | 字段 | 期望值 | 异常含义 | 严重度 |
|---|---|---|---|---|
| **W1** | `gen1_health_gate_status` | `ACTIVE` | 健康闸未开 → Gen-1 通路不可信，**当日样本作废** | 🔴 高 |
| **W2** | `gen1_counterfactual_ledger_ok` | `true` | 反事实账本越界（科技仓 > max(seed,cap)）= 安全不变量被破坏 | 🔴 高 |
| **W3** | `gen1_production_write` | `false` | 生产写权限被打开 = **硬边界被击穿** | 🔴 最高 |
| **W4** | `gen1_auto_execution` | `false` | 自动执行被打开 = **硬边界被击穿** | 🔴 最高 |
| **W5** | Main5 最新 official 日 vs 510300 最新 official 日 | **两者相等** | 基准与主数据日期分裂 → 决策输入不一致 | 🟡 中 |
| **W6** | `gen1_counterfactual_canary_active` | `true` | Canary 通路掉线（authorized/health/ledger 任一为假） | 🟡 中 |
| **W7** | `gen1_counterfactual_canary_invocations` | 记录数值（见 §3） | `> 0` = **首次真实 Candidate**，触发里程碑协议 | 🟢 事件 |

### 1.1 W5 的查询口径

```jsonc
// 对 etf_daily，分别取 Main5 与 510300 的最新「official」行
// official 定义：source != 'realtime' AND volume > 0
// 分别得到 max(date)，两者必须相等
```

- Main5 日期 = 5 只 513310/515880/159582/518880/159570 的最新日（应全部相同）。
- 510300 日期 = 基准独立 Lane 的最新日。
- **不等 → 记 W5 异常**，只记录 + 上报，不自行补数（补数走独立流程）。

---

## 2. 异常处置原则（冻结）

1. **只读优先**：先确认「是显示问题还是真异常」——重读一次原始文档，不做任何写操作。
2. **W3/W4 例外**：若 `production_write` 或 `auto_execution` 变为 `true`，这是**安全不变量破裂**，
   属于最高优先级事件：**立即**保存完整 `runtime_status` 快照 + 上报，**不自行改回**（改动本身也是写操作）。
3. **不自动回退权限**：即便出现 W1/W2/W6，也**不要**把 `gen1_authority` 改回 `ADVISORY` ——
   回退是人工决策，不是监控脚本的职责。Canary 是反事实通路，本身不写生产，故障不会污染生产数据。
4. **当日样本作废规则**：W1/W2 触发的当日，该日样本**不纳入** Evidence Contract（见契约 §3 排除规则）。

---

## 3. 首次 Live Candidate 里程碑协议

**触发条件**：`gen1_counterfactual_canary_invocations` **首次 > 0**。

含义：到今天为止，Canary 的 Control Plane（授权/健康/账本）已被证明**活着**，
但 **Candidate Data Path 从未真实走过一次**（`invocations = 0` = 当日无 S2 Candidate）。
第一次 `> 0` 表示：第一条**真实** Gen-1 反事实建议产生了。这是一个里程碑。

### 3.1 触发后立即执行（只读验收，**不下线、不回退**）

| 步骤 | 动作 | 性质 |
|---|---|---|
| M1 | 保存完整 `decision_result` 快照（当日全字段，不裁剪）到 `outputs/wp-g1-evidence-*/first-live-candidate-<date>.json` | 只读 |
| M2 | 保存完整 `runtime_status` 快照（同上目录） | 只读 |
| M3 | 逐字核对：`counterfactual_canary_authorized/health_allowed/active` 全 `true`；`ledger_ok = true`；`production_write = false`；`auto_execution = false` | 只读 |
| M4 | 核对 **No-op 不变量**：`final_target`、`final_action`、`portfolio_position.*`、`portfolio_snapshot.total_asset/total_pnl` 与「未开 Canary 时」应完全一致（生产零变更） | 只读 |
| M5 | 记录该 Candidate 的 `code`、`stage`、`probability`、`delta_position`，作为 Evidence 表**第一条真实样本** | 只读 |
| M6 | 输出里程碑简报（含 M1~M5 结果），标注「首个 Live Candidate 已产生，生产零变更」 | 只读 |

### 3.2 明确不做的事

- ❌ 不把 `gen1_authority` 回退 `ADVISORY`
- ❌ 不重启 / 不重新部署云函数
- ❌ 不改任何 `param_config`
- ❌ 不因为「第一次出现」就人工干预 —— 这是一种**正常**的、被期待的首次触发

> 本协议的存在意义：把「第一次真实触发」从「需要临场反应的未知事件」变成「有清单可循的例行验收」。

---

## 4. 遗留项（★ 现在都不要碰）

| 遗留项 | 当前值 | 处置 |
|---|---|---|
| `InstallDependency`（runGen1ShadowEod） | `TRUE`（MCP updateFunctionCode 漂移所致） | **保持 P2，不归一化** |
| `config_version` | `2026-09-01-gen1-advisory-active` | **不改** —— 这是可观测性命名债，非权限真相；真实权限已由 `runtime_status.gen1_authority = CANARY` 表达 |

**一次性 Runtime Config Normalization**：待 Canary **稳定运行数日后**单独执行（单独工作包）。
现在改动 = 在系统刚上线时引入无谓变量，违反「一次只改一件事」。

---

*本清单为 WP-G1-EVIDENCE 的运行侧配套文件。异常处置原则见 §2，里程碑协议见 §3。*
