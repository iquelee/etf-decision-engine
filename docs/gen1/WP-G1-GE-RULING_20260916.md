# WP-G1-GE 立项裁决记录

**裁决编号**：`RULING-WP-G1-GE`
**日期**：2026-09-16
**裁决方**：项目所有人（唯一执行方）
**性质**：治理裁决 —— **批准 P1/P2/P3，禁止 P4**
**证据基线**：`origin/master = d66cd86`（只读取证报告 `outputs/gen1-authority-audit-20260916/`）

---

## 1. 裁决事项（9 项，逐条）

| # | 事项 | 裁决 |
|---|---|---|
| 1 | 线上 `gen1_authority` 是否仍为 `CANARY` | **先做一次只读双字段核对**；两者任一不为 `CANARY` ⇒ **STOP，不继续部署** |
| 2 | `GUARDED_EFFECTIVE` 是否单独立项 | ✅ **APPROVE** —— 独立工作包 `WP-G1-GE` + 新契约 + 重新冻结 |
| 3 | Evidence Gate 是否为 P4 硬前置 | ✅ **HARD GATE** —— 不允许静默降级 |
| 4 | P1 + P2 + P3 | ✅ **APPROVE WITH GUARDS**（六条硬护栏，见章程 §8） |
| 5 | 四份治理文档 | ✅ **先做 docs-only PR 入库**，再开始代码改造 |
| 6 | 状态机形态 | **扩展**既有 `OFF→SHADOW→ADVISORY→CANARY→PRODUCTION`，**不推翻重做** |
| 7 | `GUARDED_EFFECTIVE` 语义 | **不等于**生产写权限；仅等于「向 V3 提供受控阶段输入的资格」 |
| 8 | 执行拓扑 | 保留 `baseline V3 + guarded V3` 两次运行 + 显式 Guarded Selector |
| 9 | 激活安全 | `gen1_authority` 单独**绝不能**激活；须三钥匙 + 运行时叠加门 |

---

## 2. 裁决的架构收紧（原话要点）

1. **不要推翻重做另一套 `DISABLED/CANARY/ADVISORY/...`**，而应扩展为
   `OFF → SHADOW → ADVISORY → CANARY → GUARDED_EFFECTIVE → PRODUCTION_LOCKED`，
   最后一档继续不可达。**即使进入 `GUARDED_EFFECTIVE`，`production_write` 仍应为 `false`。**
2. **不建议把 override「前移」给第一次 V3 调用**；保留 `baseline V3 + guarded V3` 两个结果更好 ——
   天然得到 `baseline_result` / `guarded_result` / `delta`，便于 Evidence、回退与可审计性。
3. **解除的是「V3 可以接受 Gen-1 的受控阶段输入」，不是解除「overlay 不得修改 `final_target`」的不变量。**
   下一步是 `guarded V3 result → authoritative selector → 正式 result → overlay 只负责附加审计字段`。
4. **Safety Gate 与 Evidence Gate 是两件事**：前者证明「不突破风险约束」，后者证明「影响生产可能有经济价值」；
   前者 PASS 不能代替后者。
5. `ml_effective` 只保留为 legacy/summary alias，**不得**成为新的 Authority 真相源。

---

## 3. 本裁决附带的执行结果（2026-09-16）

### 3.1 线上只读双字段核对（裁决第 1 项）—— ✅ 通过

实读时间：2026-09-16 09:41（北京时间），只读，未写库。

| 读取目标 | 实读值 | 期望 | 判定 |
|---|---|---|---|
| `param_config`，`key='gen1_authority'` | `value.v = 'CANARY'`（`_id=6aa267a84af9d2f69b8dfc55`, `version=2`, `updated_at=2026-09-10T08:18:00.000Z`） | `CANARY` | ✅ |
| `runtime_status`，`key='runtime-status'` | `gen1_authority = 'CANARY'`（`decision_date=2026-09-16`, `updated_at=2026-09-16T00:00:26.690Z`） | `CANARY` | ✅ |

**⇒ STOP 条件未触发，允许继续 P1/P2/P3。**

同一快照的旁证字段：

| 字段 | 值 | 含义 |
|---|---|---|
| `gen1_production_write` | `false` | 生产写权限关闭 |
| `gen1_auto_execution` | `false` | 自动交易关闭 |
| `ml_effective` | `false` | 生产 ML effective 关闭 |
| `gen1_safety_source` | `SAFETY_CORE` | 安全裁决来源 |
| `gen1_counterfactual_canary_active` | `true` | 反事实通路活着 |
| `gen1_counterfactual_canary_invocations` | **`0`** | **Candidate Data Path 从未真实调用** |
| `gen1_health_status` / `gen1_health_gate_status` | `OK` / `ACTIVE` | 健康闸正常 |

### 3.2 WP-G1-GE-00（裁决第 5 项）—— ✅ 完成

- PR **#41** `docs(gen1): 补齐 4 份 Gen-1 证据治理文档入库`：**docs-only**，4 文件 / +460 / −0，CI 8/8 全绿。
- 合并方式：`merge commit`（**非** squash / rebase）。
- `merge_commit_sha` = **`d254a7a67841aa84b1138c6404b31f273ed1f3fc`**；`master` 已推进至同点。
- 入库文件：`GEN1_EVIDENCE_CONTRACT.md`、`GEN1_DAILY_PRODUCTION_WATCH.md`、`GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md`、`WP-G1-EVIDENCE_CHARTER.md`（**原样入库，未改一字**）。

---

## 4. 明确未做（本次）

- ❌ 未改任何源码（`src/` / `cloudfunctions/` / `web/` / `scripts/` 全部零改动）
- ❌ 未改 `param_config`（`gen1_authority` 保持 `CANARY`）
- ❌ 未部署、未提 authority、未写正式仓位、未开自动交易
- ❌ 未开始 P2/P3（代码实现与影子验证）
- ❌ 未触碰 `ml/gen2/**` 与其 `ACCEPTED_FAIL` 冻结证据

---

*本记录为治理留痕。裁定条款的规范性表述见 `docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md`。*
