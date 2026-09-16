# Gen-1 证据监控 — 当前运行状态勘误 / 补充（as-of 2026-09-16）

**性质**：**追加型勘误（ADD-ONLY）**。本文件**不修改任何既有文档的正文**，只登记「运行状态」的当前事实与对既有表述的必要收紧。
**触发**：2026-09-16 运行状态复核，发现「文档声明的执行频率」与「实际运行频率」不一致。
**影响面**：**文档可读性与归档准确性**。**不涉及**任何线上行为变更、权限变更、代码变更或数据变更。

---

## 1. 为什么需要这份文件

`GEN1_DAILY_PRODUCTION_WATCH.md` 的**监控内容**（7 项字段与判定规则）是正确的、仍然有效的；
但它的**执行频率描述**（「生效日起每个交易日」）已与事实不符 —— 对应的每日自动化任务**已停止**。

如果不做勘误，后来者会把「按日自动执行」当成仍在运行的事实，从而：

- 误以为存在**连续性**监控（实际存在**采样缺口**）；
- 误以为 `invocations = 0` 等读数是**每日刷新**的（实际是**某一天**的读数）；
- 并据此对 Evidence 样本的完整性作出错误判断。

⇒ 结论：**内容继续有效，频率描述作废。**

---

## 2. 四项勘误（逐条）

### 2.1 每日巡检的自动化执行**已于 2026-09-14 停止**

| 项 | 事实 |
|---|---|
| 自动化任务 | `Gen-1 COUNTERFACTUAL_CANARY 每日只读巡检` |
| 状态 | **已停止 / 已取消**（2026-09-14 由用户决定取消） |
| 实时核对 | 2026-09-16 只读查询自动化列表结果为**空** ⇒ 当前**不存在**任何在跑的巡检任务 |

### 2.2 原 7 项仍是**有效协议**，但其性质是「**手工 / 按需**」

- 7 项字段（W1–W7）、期望值、异常含义、严重度、§2 异常处置原则、§3 里程碑协议 M1–M6：
  **内容继续有效，一个字不改**。
- **但其执行方式 = 人工按需触发**，**不是**正在运行的自动任务。
- ⇒ 文档中「生效」二字应读作「**条款生效**」，**不得**读作「**任务在跑**」。

### 2.3 文档内的读数均为**带日期的历史快照**

下列数值是**当时读数**，不是常态定义，**不得**当作今天的状态引用：

| 值 | as-of | 出现位置 |
|---|---|---|
| `gen1_authority = CANARY` | 2026-09-10 / 2026-09-16 | `GEN1_DAILY_PRODUCTION_WATCH.md` 头部、`WP-G1-EVIDENCE_CHARTER.md` §4、`GEN1_GUARDED_EFFECTIVE_CHARTER.md` §5.2 |
| `counterfactual_canary_active = true` | 2026-09-10 | `GEN1_DAILY_PRODUCTION_WATCH.md` 头部、`WP-G1-EVIDENCE_CHARTER.md` §4 |
| `gen1_counterfactual_canary_invocations = 0` | 2026-09-10 / 2026-09-16 | `GEN1_DAILY_PRODUCTION_WATCH.md` §1/§3、`WP-G1-EVIDENCE_CHARTER.md` §4、`GEN1_GUARDED_EFFECTIVE_CHARTER.md` §5.2 |
| `config_version = 2026-09-01-gen1-advisory-active` | 2026-09-10 | `GEN1_DAILY_PRODUCTION_WATCH.md` §4、`WP-G1-EVIDENCE_CHARTER.md` §6 |
| Evidence 样本行数 `= 0` | 2026-09-10 / 2026-09-16 | `WP-G1-EVIDENCE_CHARTER.md` §4、`GEN1_GUARDED_EFFECTIVE_CHARTER.md` §5.2 |
| `gen1_production_write / gen1_auto_execution = false / false` | 2026-09-10 | `GEN1_DAILY_PRODUCTION_WATCH.md` §1、`WP-G1-EVIDENCE_CHARTER.md` §4、`GEN1_GUARDED_EFFECTIVE_CHARTER.md` §5.2 |
| `InstallDependency` 漂移 / `config_version` 命名债 | 2026-09-10 | `GEN1_DAILY_PRODUCTION_WATCH.md` §4、`WP-G1-EVIDENCE_CHARTER.md` §6 |

⇒ 要判断「**今天**」的状态，**必须重新只读实读**，**不得**引用上表。

### 2.4 对 `GEN1_GUARDED_EFFECTIVE_CHARTER.md` §2.1 / §2.2 的收紧

原表述（§2.1 登记表 + §2.2(A) 第 4 条）：

> `docs/gen1/GEN1_DAILY_PRODUCTION_WATCH.md` … **整份继续有效**，7 项每日监控不因本工作包而减少
>
> 4. `GEN1_DAILY_PRODUCTION_WATCH` 的每日 7 项只读监控。

**收紧为：**

> **监控字段与判定规则继续有效；自动执行频率不继续有效。**
>
> 即：W1–W7 字段口径、异常含义、严重度、§2 处置原则、§3 的 M1–M6 —— **继续有效**；
> 「每日 / 每交易日自动执行」—— **不继续有效**（自动化已于 2026-09-14 停止，现为手工 / 按需）。

同理，§2.1 登记表中把该文档「状态」记为 `生效` 时，应读作 **条款生效（内容维度）**，**不含执行频率维度**。

---

## 3. `GEN1_GUARDED_EFFECTIVE_CHARTER.md` 中 P1/P2/P3 状态标记的效力边界

该章程 §5.1 的表格把 `P1 契约冻结` / `P2 代码实现（dormant）` / `P3 Shadow / Replay / 反例门` 标为 ✅（允许）。

> **该表是「阶段准入条件」的自述，不构成编码授权、验证授权或部署授权。**

在用户明确批准之前，以下事项**一律不做**：

- 不创建 Gen-1 代码实现分支
- 不改 `FROZEN_PARAM_KEYS`
- 不改 `gen1_authority`
- 不写 `GUARDED_EFFECTIVE` 运行逻辑
- 不部署、不改变 `ml_effective = false`

**`P4 GUARDED_EFFECTIVE 真切换 ❌ 禁止` 一项：不变，且仍然有效。**

> 字段名提示：真实字段是 **`ml_effective`**，**不是** `m1_effective`。

---

## 4. 本勘误**没有**改动的东西（明确边界）

- 不改任何既有文档正文：
  `GEN1_EVIDENCE_CONTRACT.md` / `GEN1_DAILY_PRODUCTION_WATCH.md` / `GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md` /
  `WP-G1-EVIDENCE_CHARTER.md` / `GEN1_GUARDED_EFFECTIVE_CHARTER.md` / `WP-G1-GE-RULING_20260916.md`
- 不改 `GEN1_EVIDENCE_CONTRACT` v1.0 的任何字段 / 阈值 / 纳入规则
- 不改任何权限、`param_config`、云函数代码、`ml_effective`
- 不改任何 Gen-2 冻结范围 / `lock_revision` / `immutable_set`
- 不改变 Guarded Effective 契约（P4 仍禁止）
- 不改变 WP-G1-EVIDENCE 的工作包目标、执行顺序（§3）与硬边界（§5）

---

## 5. 复现方法（任何设备可核，只读）

1. **确认无在跑的巡检自动化**：查询自动化列表 —— 应为**空**。
2. **确认 master 未含 Gen-1 实现**：
   - `git ls-tree --name-only origin/master docs/gen1/` —— 不应出现 `WP-G1-GE-02_IMPLEMENTATION_NOTE.md`；
   - `src/common/constants.js` 的 `FROZEN_PARAM_KEYS` —— 应**不含** `gen1_authority`。
3. **取当日状态**：只读实读 `runtime_status` 最新一条与 `param_config` 中的 `gen1_authority`，
   **不要**引用本文档或任何文档中的历史读数。

---

## 6. 互链

- 监控内容（**继续有效**）：`docs/gen1/GEN1_DAILY_PRODUCTION_WATCH.md`
- 证据契约（**FROZEN v1.0，未改动**）：`docs/gen1/GEN1_EVIDENCE_CONTRACT.md`
- 里程碑协议（**待触发，未改动**）：`docs/gen1/GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md`
- 工作包章程（**观察型，未改动**）：`docs/gen1/WP-G1-EVIDENCE_CHARTER.md`
- **被收紧对象**：`docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md` §2.1 / §2.2(A) / §5.1
- Gen-1 文档总索引：`docs/gen1/README.md`

---

*勘误 v1.0 — 2026-09-16。追加型：不改历史正文，只登记当前事实与必要收紧。*
