# Gen-1 文档索引（`docs/gen1/`）

**本索引 as-of**：2026-09-16
**用途**：给出本目录全部文档的「是什么 / 什么时候的 / 现在还成不成立」，避免把**历史快照**当成**当前状态**读。

> ⚠️ **读本目录任何文档前，先读这一条**：
> 本目录文档里出现的 `gen1_authority = CANARY`、`invocations = 0`、`config_version`、
> 样本行数等数值，**都是带日期的历史快照**，不是常态定义。
> **要判断「今天」的状态，必须重新只读实读**（`runtime_status` 最新一条 + `param_config.gen1_authority`），
> **不得**引用本目录任何文档中的历史读数。

> ⚠️ **运行状态勘误（2026-09-16）**：
> Gen-1 每日只读巡检的**自动化任务已于 2026-09-14 停止**；
> `GEN1_DAILY_PRODUCTION_WATCH.md` 的 7 项现为 **手工 / 按需协议**，不再是自动任务。
> 详见 **[`GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md`](./GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md)**（追加型勘误，不改历史正文；当前 **v1.1**）。

> ⚠️ **放行规则（2026-09-16 澄清，v1.1 新增 §7）**：
> 项目级**阶段许可**来自 `WP-G1-GE-RULING_20260916.md` §1.4（`RULING-WP-G1-GE`，批准方 = 项目所有人）；
> 但 **「阶段许可」≠「单个 PR 自动合并许可」** ——
> **P2** 每个 PR 须各自持有 P2 放行记录；**P3** 须待 P2 合并 + 休眠态反例测试通过后再单独放行；
> **P4** 仍**严格禁止**。`#43` 当前状态 = **`P2_PENDING_PR_RELEASE`**（挂起）。
> 详见 **[勘误 §7 附录](./GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md#7-附录--阶段许可与逐-pr-放行澄清记录v112026-09-16)**。

---

## 1. 文档清单

| # | 文件 | 是什么 | as-of | 现在是否仍有效 |
|---|---|---|---|---|
| 1 | [`GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md`](./GEN1_EVIDENCE_MONITOR_STATUS_ERRATUM_20260916.md) | **运行状态勘误 / 补充**（追加型） | 2026-09-16 | ✅ **有效**（最新事实，优先读） |
| 2 | [`GEN1_GUARDED_EFFECTIVE_CHARTER.md`](./GEN1_GUARDED_EFFECTIVE_CHARTER.md) | Guarded Effective 章程 / **设计契约**（`WP-G1-GE-CH-1.0`） | 2026-09-16 | ⚠️ **有效但须按勘误收紧**：§2.1/§2.2「整份继续有效」读作「监控字段与判定规则继续有效，自动执行频率不继续有效」；§5.1 的 P1/P2/P3 ✅ 是**阶段计划**（阶段许可来自 RULING §1.4），**每个实施 PR 仍须单独放行**（见勘误 §7） |
| 3 | [`WP-G1-GE-RULING_20260916.md`](./WP-G1-GE-RULING_20260916.md) | WP-G1-GE 立项裁决记录（`RULING-WP-G1-GE`） | 2026-09-16 | ✅ 有效（立项事实） |
| 4 | [`GEN1_EVIDENCE_CONTRACT.md`](./GEN1_EVIDENCE_CONTRACT.md) | 证据契约：17 字段口径 + 纳入规则 + Q1/Q2/Q3 阈值 | 2026-09-10 | 🔒 **FROZEN v1.0**，一字不改 |
| 5 | [`GEN1_DAILY_PRODUCTION_WATCH.md`](./GEN1_DAILY_PRODUCTION_WATCH.md) | 监控清单：W1–W7 + 异常处置原则 + 首触发里程碑 M1–M6 | 2026-09-10 | ✅ **内容有效**；⚠️ **执行方式为手工 / 按需**（自动化已于 2026-09-14 停止） |
| 6 | [`GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md`](./GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md) | 首次真实 Candidate 触发协议（`invocations` 首次 > 0） | 2026-09-10 | ✅ 有效（**待触发**） |
| 7 | [`WP-G1-EVIDENCE_CHARTER.md`](./WP-G1-EVIDENCE_CHARTER.md) | WP-G1-EVIDENCE 工作包章程（**观察型**：只读 + 累计 + 判定） | 2026-09-10 | ✅ 有效（目标 / §3 执行顺序 / §5 硬边界） |
| 8 | [`GEN1_CANARY_GO_LIVE_RUNBOOK.md`](./GEN1_CANARY_GO_LIVE_RUNBOOK.md) | 上线清单：`ADVISORY → CANARY` 的升级步骤 | 2026-09-11 | 历史执行记录（该升级已发生） |
| 9 | [`GEN1_CURRENT_STATE_20260910.md`](./GEN1_CURRENT_STATE_20260910.md) | 状态基线快照（G1-00），生产就绪起点 | 2026-09-10 | 历史快照 |
| 10 | [`GEN1_PRODUCTION_READINESS_REPORT_20260910.md`](./GEN1_PRODUCTION_READINESS_REPORT_20260910.md) | 生产就绪报告 V1 | 2026-09-10 | 历史快照 |
| 11 | [`GEN1_PRODUCTION_READINESS_REPORT_V2.md`](./GEN1_PRODUCTION_READINESS_REPORT_V2.md) | 就绪报告 V2（WP-G1.1 Canary Gate 整改） | 2026-09-10 | 历史快照 |
| 12 | [`GEN1_PRODUCTION_READINESS_REPORT_V3.md`](./GEN1_PRODUCTION_READINESS_REPORT_V3.md) | 就绪报告 V3（WP-G1.2 Runtime Single-Truth 整改） | 2026-09-10 | 历史快照 |
| 13 | [`GEN1_PRODUCTION_READINESS_REPORT_V4.md`](./GEN1_PRODUCTION_READINESS_REPORT_V4.md) | 就绪报告 V4（WP-G1.3 反事实组合账本定稿） | 2026-09-10 | 历史快照 |
| 14 | [`gen1_canary_replay_20260910.json`](./gen1_canary_replay_20260910.json) | Canary 回放数据 | 2026-09-10 | 数据快照 |

---

## 2. 三句话现状（as-of 2026-09-16）

1. **权限真相**：唯一正式决策引擎仍是 **V3.6.1 Safety Core**。`gen1_authority = CANARY`（只读实读、非本文档快照）；
   `production_write` / `auto_execution` 恒 `false`；**`ml_effective = false`**（注意：**不是** `m1_effective`）。
2. **证据真相**：Evidence 样本行数 = `0`，`invocations = 0` ⇒ **Candidate Data Path 从未真实走过一次**，
   **Evidence Gate 明确未满足，P4 真切换禁止**。
3. **监控真相**：每日巡检**没有自动化在跑**（2026-09-14 起停止），7 项仅按需人工执行。

---

## 3. 边界（本目录不承载的东西）

- 本目录文档**不授予任何写入权限**：`final_target` / `final_action` / `suggested_position` 的产出方始终是 V3.6.1 Safety Core。
- 本目录的「✅ 允许」类标记（如 Guarded Effective 章程 §5.1 的 P1/P2/P3）是**阶段准入条件自述**，
  **不是**编码授权 / 验证授权 / 部署授权。
- **项目级阶段许可 ≠ 单个 PR 的合并许可**：P1/P2/P3 的阶段许可由 `RULING-WP-G1-GE` §1.4 授予，
  但**每个实施 PR 必须单独放行**；`P4` 真切换仍严格禁止。见勘误 §7。
- Gen-2 相关内容不在此目录（见 `ml/gen2/reports/`）。

---

*索引 as-of 2026-09-16。新增文档请同步更新本表。*
