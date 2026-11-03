# GEN1_OWNER_DECISION_MATRIX_20261003
## Gen-1 Owner Decision Matrix / Authorization Boundary Gate（只读治理 Gate）

> 本件为 **只读治理交付物**。⛔ 未修改 production code / config / DB；⛔ 未 deploy / rollback / canary；
> ⛔ 未 merge / tag / push；⛔ 未执行 Evidence Execution；⛔ 未 GE-04；⛔ 未改 V6 Evidence Freeze Seal / Key 2 /
> V5·V6 frozen contract / Authority / FROZEN_PARAM_KEYS / immutable_set / selector / active pointer / production read path。
> 本件**只做**：读取 · 审查 · 分类 · 依赖整理 · 关键路径整理 · 授权边界定义 · 生成文档 · 生成只读检查脚本 · red-proof。

---

## 0. 方法与证据分级

| 级别 | 含义 | 本件用法 |
|---|---|---|
| `online-codeinfo-20261002` | 线上部署源码全文（`codeinfo_20261002/*.index.js`，值 = 线上 `CodeInfo`） | 线上行为**唯一权威** |
| `online-db-20261002` | 线上只读 DB 探针归档（`probe_*.json`） | 线上状态**唯一权威** |
| `online-http-20261002` | 线上只读 HTTP 探针归档 | 门值交叉核对 |
| `repo-dist-20261002` | `dist-functions/runDecisionEngine/common/utils/*`（= 线上同包） | 与线上逐字节对拍 |
| `repo-src-20261003` | **本轮新取证**：`etf-decision-engine/src/**` 模块源码 | 依赖关系推断的**代码层**依据 |
| `repo-doc-*` | 前序 Gate 已 ACCEPT 的治理件 | 仅引用其**结论**，⛔ 不继承其未经验证的推断 |
| `NOT RE-READ` | 本轮未重新读取的项 | **显式标注**，⛔ 不得当本轮证据 |

⚠️ **纪律 8**：`repo-src-20261003` 是**仓库工作区**证据，⛔ 不等于线上实读；凡涉及线上行为的结论，
必须能由 `online-codeinfo-20261002` 支撑（本件已逐条给出）。

---

## 1. 授权边界总原则（owner §一）

```text
IMPLEMENTATION_AUTHORIZED   ≠   PRODUCTION_WRITE_AUTHORIZED
TECHNICAL PASS              ≠   AUTHORIZATION PASS
FREEZE  ≠  PRODUCTION ATTESTATION  ≠  EVIDENCE EXECUTION  ≠  GE-04
```

**五条不可推导式（任何上游 PASS 都不得向下游传播授权）**：

```text
⛔ TECHNICAL PASS            ⇒ ✗ AUTHORIZATION PASS
⛔ IMPLEMENTATION_AUTHORIZED ⇒ ✗ PRODUCTION_WRITE_AUTHORIZED
⛔ FREEZE                    ⇒ ✗ PRODUCTION ATTESTATION
⛔ EVIDENCE EXECUTION        ⇒ ✗ GE-04
⛔ R1（可自主准备）          ⇒ ✗ 已授权（R1 只覆盖 read-only / 离线 / harness / 文档 / 仿真，⛔ 不含任何生产动作）
```

**四条专项独立门（owner 指定，⛔ 不得并入其他门）**：

| 专项 | 要求 | 本件落实 |
|---|---|---|
| **X-1 AUTHORITY_ELEVATION** | 必须是**独立授权门** | §3.1 `X-1` 行 · §7 `AUTHORIZATION_GATES` 单列 |
| **X-2 STAGE_PRECONDITION** | **只是前置条件，不是可执行 Gap**，⛔ 不得单独排入实施队列 | §3.1 `X-2` 行（R0 · 自主准备=NO）· §7 列于 `PRECONDITION`（⛔ 不入 `CRITICAL_PATH` 节点表） |
| **A-2 active pointer 写入** | 保持独立 production-write gate | §3.1 `A-2a` / `A-2b` 拆分 · §7 `PRODUCTION_WRITE_GATES` |
| **B-1 production read path 修改** | 保持独立 production-write gate | §3.1 `B-1` 行 · §7 `PRODUCTION_WRITE_GATES` |
| **E-5 Evidence Execution** | 保持独立授权 | §3.1 `E-3` 行（= Evidence Execution 授权） |
| **GE-04** | **最高等级**独立授权；⛔ 任何其他 PASS 不得隐式触发 | §3.1 `E-5` 行 · §7 `GE04_GATE` |

---

## 2. 统一分类体系 R0–R4（owner §二）

| 类 | 定义 | 允许范围 |
|---|---|---|
| **R0** | `CLOSED / NOT A WORK ITEM` | 已关闭 · 已解决 · **纯观察项** · 不应再作为工作项 |
| **R1** | `AUTONOMOUS PREPARATION ALLOWED` | read-only analysis · offline implementation preparation · test harness · fixture · documentation · simulation · replay · red-proof · reversible local/test changes。**⛔ R1 ≠ 生产授权** |
| **R2** | `IMPLEMENTATION REQUIRES EXPLICIT OWNER AUTHORIZATION` | 实际功能实现 · 生产行为改变 · 核心决策逻辑改变 |
| **R3** | `IRREVERSIBLE / HIGH-RISK GATE` | production write · deploy · rollback · canary · active pointer · authority elevation · Evidence Execution · GE-04 · master merge · freeze / seal。**必须单独 STOP-AND-REPORT** |
| **R4** | `DEFERRED / DO NOT TOUCH` | 当前阶段明确不处理 |

**★ R0 的两个子型（本件增设，⛔ 不可混用）**：

| 子型 | 含义 | 本件对象 |
|---|---|---|
| `R0-CLOSED` | 任务已真正完成 | `D-5` · `H-24` · `H-25` · `ERRATA-1` |
| `R0-OBSERVATION` | **不是可独立开工的任务**：它是**其他节点的结果**，⛔ 不可排期；**但其风险不为零** | `A-1`（PRIMARY FUNCTIONAL BLOCKER）· `C-4` · `D-4` · `X-2`（PRECONDITION） |

⚠️ **`R0` 不等于「无风险」**：`A-1` 是 owner 裁定的 **PRIMARY FUNCTIONAL BLOCKER**，
其被列为 `R0-OBSERVATION` 仅表示「**照 A-1 去写代码 = 错误排期**」（前序 Gate §4 的排期纠正），
∎ 其**未达成状态**仍使整条 Gen-1 链不可用。本件在 §3.3 单列 `PRIMARY BLOCKER REGISTER` 以保证可见性。

---

## 3. Owner Decision Matrix（owner §六 · 15 字段全表）

> 字段口径：`自主准备`= 是否允许自主准备（R1 语义）· `Owner授权`= 是否需要 Owner **明确**授权 ·
> `ProdWrite`= 是否 production write · `改决策行为`= 是否改变 production decision behavior ·
> `Deploy`= 是否需要部署 · `Evidence`= 是否需要 Evidence Execution · `GE-04`= 是否属于 GE-04 门。
> ⛔ 全部布尔列严格取值 `YES` / `NO`；⛔ 表内不得出现竖线字符。

### 3.1 主矩阵（45 项 = 38 项已编号 Gap + X-1 + X-2 + N-9a + N-1…N-4）

| ID | 当前状态 | 类型 | R | 自主准备 | Owner授权 | ProdWrite | 改决策行为 | Deploy | Evidence | GE-04 | 前置条件 | 可并行 | 阻塞项 | 说明 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A-1 | BLOCKED | Functional | R0 | NO | YES | NO | NO | NO | NO | NO | X-2 · C-1 · C-4 | — | C-1 · C-4 · X-2 | 观察项（R0-OBSERVATION）：guarded candidate 恒 null。★ 双通道：① `guardedChecks.health_allows_guarded`（C-1）② `canaryS4Rerun ≠ null`（C-4 经 `effective_canary`）。⛔ 不可独立开工 |
| A-2 | MISSING | Functional | R3 | YES | YES | YES | YES | YES | YES | YES | A-1 · D-3 · X-1 | B-1 的准备 | B-1 · G-4 · E-10 | ★ 拆为 A-2a（cutover 代码通路，可休眠，R2）/ A-2b（激活翻转，R3）。⛔ 不得因 GE-02 PASS 自动放行 |
| A-3 | MISSING | Functional | R2 | YES | YES | YES | NO | YES | NO | NO | — | B-1 · F-3 | — | `ml_effective` 单向 alias；不阻断链。若 owner 裁定无需独立语义 ⇒ 可降为 R4 |
| B-1 | MISSING | Production Integration | R3 | YES | YES | YES | NO | YES | NO | NO | B-4 · B-6 · E-9 | B-4 · B-5 · B-6 · C-3 · F-3 · G-3 · G-4 | 无（★ 见 CP-1 修正） | 读侧迁移（按 `active_run_pointer` pin）。★ 其**硬前置**是 B-4 + B-6 + E-9，⛔ 不是 A-2；顺序上必须**早于 A-2b** |
| B-2 | MISSING | Production Integration | R3 | YES | YES | YES | NO | YES | NO | NO | B-1 | — | B-1 | Gen-1 产物零消费者 ⇒ 需 ≥1 生产读者 |
| B-3 | MISSING | Production Integration | R3 | YES | YES | YES | NO | YES | NO | NO | B-1 | B-5 | B-1 | 被消费集合已停写（`decision_result` 止 2026-09-29）；读链与写链须同代 |
| B-4 | PARTIAL | Production Integration | R1 | YES | YES | NO | NO | NO | NO | NO | — | C-3 · B-5 · B-6 · E-7 | B-1（门禁） | 只读重建（detached worktree + 逐字节对拍）属 R1；⚠️ 使其 **remote-visible 需 push ⇒ 该子步为 R3**（拆分见 §7） |
| B-5 | MISSING | Production Integration | R3 | YES | YES | YES | NO | YES | NO | NO | — | C-3 · B-4 · B-6 | B-1 的正确性 | 配置写 `ENFORCE_SWITCH_DATE`（当前 null） |
| B-6 | MISSING | Production Integration | R3 | YES | YES | YES | NO | YES | NO | NO | — | C-3 · B-4 · B-5 | B-1 | 建索引 `RUN_HISTORY_INDEX`（当前 PENDING） |
| C-1 | BLOCKED | Health | R3 | YES | YES | YES | NO | NO | NO | NO | C-2 · C-3 | C-2 · C-3 | A-1 · C-4 · D-4 | 写 latch（`DEGRADED` → `OK` + 显式 `ACTIVE`）。⛔ 不得直写 DB，必须经 C-2 的受控端点 |
| C-2 | MISSING | Health | R3 | YES | YES | YES | NO | YES | NO | NO | — | C-3 · B-4 | C-1 | 缺受控恢复端点。★ 代码编写可离线（R1），**部署 + 首次调用 = R3**。★ 与 C-3 **无依赖**（并列，见 CP-3） |
| C-3 | MISSING | Health | R1 | YES | YES | NO | NO | NO | NO | NO | — | C-2 · B-4 · B-5 · B-6 · E-7 | C-1 · C-2 | 只读诊断：定位 `515880` 缺失的**具体特征**（`missing_features` 未持久化）。⛔ 零生产写。= `OBS-3` |
| C-4 | BLOCKED | Health | R0 | NO | YES | NO | NO | NO | NO | NO | C-1 | — | A-1 | 观察项（R0-OBSERVATION）：`allow_canary` 正控，由 C-1 派生。⛔ 非独立工作项；★ 经 rerun 存在性通道参与 A-1 |
| D-1 | MISSING | Evidence | R3 | NO | YES | YES | NO | NO | YES | NO | A-1 · E-3 | — | D-2 | Evidence Execution 启动；授权门 = E-3 |
| D-2 | MISSING | Evidence | R3 | NO | YES | YES | NO | NO | YES | NO | D-1 | — | D-3 | ≥30 独立事件（append-only）。★ 契约 §3.4：无真实 Candidate 前**恒为 0** |
| D-3 | MISSING | Evidence | R3 | NO | YES | YES | NO | NO | YES | NO | D-2 · E-4 | — | X-1 · A-2b | Evidence Seal 落定（`PENDING` → `SEALED`） |
| D-4 | MISSING | Evidence | R0 | NO | YES | NO | NO | NO | NO | NO | C-1 | — | A-2b | 观察项（R0-OBSERVATION）：资格层（`canary_active`）由 C-1 派生 |
| D-5 | CLOSED | Evidence | R0 | NO | NO | NO | NO | NO | NO | NO | — | — | — | ✅ 已完成项（contract FROZEN + tool ALIGNED + freeze SEALED）；登记以免被误判为缺口 |
| E-1 | MISSING | Authorization | R3 | NO | YES | YES | NO | NO | NO | NO | D-1 | — | D-1 | 门控型：`V3.6.6_FREEZE` 授权 |
| E-2 | MISSING | Authorization | R3 | NO | YES | NO | NO | NO | NO | NO | C-1 · C-4 · G15 | — | G15 | 门控型：`PRODUCTION_ATTESTATION` 授权（⛔ 只挡不推） |
| E-3 | MISSING | Authorization | R3 | NO | YES | YES | NO | NO | YES | NO | A-1 | — | D-1 | 门控型：`EVIDENCE_EXECUTION` 授权。★ 独立于 GE-04（见 RP-C） |
| E-4 | MISSING | Authorization | R3 | NO | YES | YES | NO | NO | YES | NO | D-2 | — | D-3 | 门控型：`KEY 3 EVIDENCE SEAL` 授权 |
| E-5 | MISSING | Authorization | R3 | NO | YES | NO | NO | NO | NO | YES | D-3 | — | A-2b | ★ **最高等级独立授权**：`GE-04`。⛔ 任何其他 PASS 不得隐式触发 |
| E-6 | MISSING | Authorization | R3 | NO | YES | YES | NO | YES | NO | NO | C-3 | — | C-1 · C-2 | 门控型：`AG-1` / `AG-2` / `AG-3` 三项授权。★ 已**拆为独立对象**（见 §3.2） |
| E-7 | MISSING | Authorization | R3 | YES | YES | NO | NO | NO | NO | NO | — | B-4 | B-4 | 门控型：Git integration（push 授权） |
| E-8 | MISSING | Authorization | R3 | NO | YES | YES | NO | NO | NO | NO | — | — | — | 门控型：`v3_6_1_enabled` 切换。⛔ 不阻断 Gen-1 链 |
| E-9 | MISSING | Authorization | R3 | NO | YES | YES | NO | YES | NO | NO | B-4 | — | B-1 | 门控型：读侧迁移上线授权 |
| E-10 | MISSING | Authorization | R3 | NO | YES | YES | YES | YES | NO | YES | A-2a | — | A-2b | 门控型：selector cutover 激活授权（= A-2b 的授权面） |
| F-1 | MISSING | Observability | R3 | YES | YES | YES | NO | YES | NO | NO | A-1 | C-3 · F-3 | — | `signal → candidate` 追溯段不存在 |
| F-2 | MISSING | Observability | R3 | YES | YES | YES | NO | YES | NO | NO | B-1 | — | — | `decision → read path` 无 provenance（缺 `authority` 键） |
| F-3 | MISSING | Observability | R3 | YES | YES | YES | NO | YES | NO | NO | A-3 | C-3 · G-3 · G-4 | — | `ml_shadow.effective` 与 `runtime_status.ml_effective` 脱钩 |
| F-4 | MISSING | Observability | R3 | YES | YES | YES | NO | YES | NO | NO | A-1 · B-1 | — | — | active run 的 `gen1_run_id=None` |
| F-5 | MISSING | Observability | R1 | YES | YES | NO | NO | NO | NO | NO | — | F-6 · N-9a | — | ★ 扫描门 `N-10` 断言域缺陷（已知误报）。⛔ 不改闸门 · ⛔ 不阻断任何链 |
| F-6 | MISSING | Observability | R1 | YES | YES | NO | NO | NO | NO | NO | — | F-5 · N-9a | — | ★ 扫描门 `N-9a` 断言域缺陷（已知误报）+ commit-range predicate 缺陷。⛔ 不改闸门 |
| G-1 | MISSING | Rollback | R3 | YES | YES | YES | NO | YES | NO | NO | B-1 | — | B-1 | 读侧 fail-closed 缺失；须与 B-1 **同批** |
| G-2 | MISSING | Rollback | R3 | YES | YES | YES | NO | YES | NO | NO | B-1 · G-1 | — | E-2 | promotion / pointer 无回滚路径（append-only 前滚） |
| G-3 | MISSING | Rollback | R1 | YES | YES | NO | NO | NO | NO | NO | B-1 设计 | C-3 · F-3 · G-4 | A-2b 实施安全 | 读侧部署回滚 runbook（纯文档） |
| G-4 | MISSING | Rollback | R1 | YES | YES | NO | NO | NO | NO | NO | A-2 设计 | C-3 · F-3 · G-3 | A-2b 实施安全 | selector 回滚测试（仅 harness） |
| X-1 | MISSING | Authorization | R3 | NO | YES | YES | NO | NO | NO | NO | D-3 · A-1 已完成 | — | A-2b | ★ **独立授权门**：`gen1_authority` → `GUARDED_EFFECTIVE`。★ 与 shadow 资格**互斥**（`authority_canary` 严格 `=== 'CANARY'`）⇒ 必须先完成 A-1 |
| X-2 | MISSING | Functional | R0 | NO | NO | NO | NO | NO | NO | NO | — | — | A-1 | ⛔ **非 work item · 不可实施 · 不可排期**（owner 明令）。模型生产域前置：`baselineStage ∈ {S2,S3}` ∧ `signal.stage ∈ {'S2'}` |
| N-9a | MISSING | Observability | R1 | YES | YES | NO | NO | NO | NO | NO | — | F-5 · F-6 | — | ⛔ **仅 test/check harness**（AST 化）；⛔ 不得改 production code / config |
| N-1 | MISSING | Observability | R4 | NO | NO | NO | NO | NO | NO | NO | — | — | — | DEFERRED（state-model / version-label 清理；NOT ON CURRENT GEN1 CRITICAL PATH） |
| N-2 | MISSING | Observability | R4 | NO | NO | NO | NO | NO | NO | NO | — | — | — | DEFERRED |
| N-3 | MISSING | Observability | R4 | NO | NO | NO | NO | NO | NO | NO | — | — | — | DEFERRED（`ml-shadow.js` 硬编码 `engine_version` 标签；与 F-3 不同轴，⛔ 不得合并立项） |
| N-4 | MISSING | Observability | R4 | NO | NO | NO | NO | NO | NO | NO | — | — | — | DEFERRED |

### 3.2 ★ 增补与拆分表（未编号工作项 + 编号项的子节点拆分）

> 来源：① 前序 Gate 已产生、但**未进入 37 项编号体系**的对象；② 本件按 **CP-2** 拆出的子节点。
> ⛔ 本件**不删除、不合并**，显式登记。

| ID | 当前状态 | 类型 | R | 自主准备 | Owner授权 | ProdWrite | 改决策行为 | Deploy | Evidence | GE-04 | 前置条件 | 可并行 | 阻塞项 | 说明 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AG-1 | MISSING | Authorization | R3 | NO | YES | YES | NO | NO | NO | NO | C-3 | — | C-1 | 生产写授权（latch 写）。★ 前序仅以 `E-6` 的括注存在，⛔ 从未单列 |
| AG-2 | MISSING | Authorization | R3 | NO | YES | YES | NO | YES | NO | NO | C-3 | — | C-1 | 部署受控恢复端点授权 |
| AG-3 | MISSING | Authorization | R3 | NO | YES | YES | NO | YES | NO | NO | OBS-3 | — | C-1 | 修 `515880` 上游必需特征（可能 production write + deploy）；★ 属**独立立项** |
| G16 | MISSING | Functional | R2 | YES | YES | YES | NO | YES | NO | NO | — | G-3 · G-4 | A-2b | `G16_SELECTOR_CUTOVER_PATH_EXISTS`：AND 表条件，前序 Gate 增列，⛔ **未入 37 项**。★ 与 `A-2a` 同义（AND 表口径） |
| G17 | MISSING | Functional | R3 | NO | YES | YES | YES | YES | NO | NO | G16 · B-1 | — | E-5 | `G17_GEN1_HAS_EFFECT_ON_DECISION`：最终验收条件。★ 否则会得出「读侧接通即上线」的错误结论 |
| G15 | MISSING | Authorization | R3 | NO | YES | NO | NO | NO | NO | YES | E-5 | — | E-2 | `G15_GE04_AUTHORIZED`：AND 表条件。⚠️ 前序主件写作 `G-15`，与 G 类（Rollback）**撞名**，见 §5 |
| G9-b | MISSING | Rollback | R3 | YES | YES | YES | NO | YES | NO | NO | B-1 | G-1 | B-1 | 把「读侧 fail-closed」从 `G9` 拆出的独立判据（前序差异登记 D-3）。★ 语义与 `G-1` 重叠但不相同（G9-b 是 AND 表条件，G-1 是工程缺口） |
| OBS-3 | MISSING | Health | R1 | YES | YES | NO | NO | NO | NO | NO | — | C-3 | C-1 · C-2 | `515880` 的 `STATISTICAL_MISSING` **具体缺哪个特征**未定位。⛔ 只读复算特征行；零生产写 |
| A-2a | MISSING | Functional | R2 | YES | YES | YES | NO | YES | NO | NO | — | G-3 · G-4 | A-2b | ★ **CP-2 拆分**：selector cutover 的**代码通路**（可休眠）。★ 与 `G16` 同义（工程口径 vs AND 表口径）。⛔ 仅部署通路**不**改变决策行为 |
| A-2b | MISSING | Functional | R3 | NO | YES | YES | YES | YES | NO | YES | A-2a · X-1 · D-3 · B-1 · G-1 · E-5 | — | G17 | ★ **CP-2 拆分**：selector **激活翻转** = 首次改变 production decision behavior。⛔ 不得由 A-2a / X-1 / D-3 任何单项 PASS 隐式放行（见 RP-I） |

### 3.3 ★ PRIMARY BLOCKER REGISTER（R0-OBSERVATION 的可见性保障）

> `A-1` / `C-4` / `D-4` / `X-2` 被归类为 `R0-OBSERVATION`（⛔ 非工作项）。
> ⚠️ 为避免被误读为「风险为零」，此处**强制单列**其未达成状态对链路的影响。

| 项 | 归类 | 未达成时的**链路后果** | 其翻转由谁决定 |
|---|---|---|---|
| **A-1** | R0-OBSERVATION | ⛔ `guardedShadowResult ≡ null`（10/10）⇒ `gen1_adopted=false`（10/10）⇒ **Gen-1 在主决策链上完全不可见**（owner 裁定的 PRIMARY FUNCTIONAL BLOCKER） | `C-1` ∧ `C-4` ∧ `X-2`（三者的结果，⛔ 不可独立开工） |
| **C-4** | R0-OBSERVATION | ⛔ `allow_canary=false` ⇒ `effective_canary=false` ⇒ `canaryS4Rerun=null` ⇒ **A-1 的第二通道被切断** | `C-1` |
| **D-4** | R0-OBSERVATION | ⛔ 资格层不成立 ⇒ 无从进入采纳评价 | `C-1` |
| **X-2** | R0-OBSERVATION | ⛔ `isBlocked('BASELINE_STAGE_NOT_ELIGIBLE')` ⇒ 候选链**首因** | **模型生产域**（⛔ 非工程、⛔ 非授权、⛔ 不可排期） |

### 3.4 矩阵计数（R0–R4）

```text
MATRIX_ITEMS（§3.1 = 45 + §3.2 = 10）          = 55

R0 = 5   （A-1 · C-4 · D-4 · D-5 · X-2）
R1 = 8   （B-4 · C-3 · F-5 · F-6 · G-3 · G-4 · N-9a · OBS-3）
R2 = 3   （A-3 · A-2a · G16）
R3 = 35  （A-2 · A-2b · B-1 · B-2 · B-3 · B-5 · B-6 · C-1 · C-2 · D-1 · D-2 · D-3
          · E-1…E-10（10）· F-1…F-4（4）· G-1 · G-2 · X-1
          · AG-1 · AG-2 · AG-3 · G17 · G15 · G9-b）
R4 = 4   （N-1 · N-2 · N-3 · N-4）

5 + 8 + 3 + 35 + 4 = 55  ✓
```

---

## 4. ★ 重点重新核对 C-3 / C-2（owner §四 · 12 问逐条）

> ⛔ 不采信前序主件的顺序，全部**重新从代码与当前 Gate 结果验证**。

### 4.1 owner 十二问逐条

| # | 问 | 答（含证据） |
|---|---|---|
| **1** | C-3 实际解决什么？ | 定位 `515880` 缺失的**具体特征**。`evaluateDataHealth()` 只把**最差状态**写入 `runtime_data_health`，`missing_features` **未持久化** ⇒ 根因不可见（`GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md §7 OBS-3`）。⛔ **零生产写**，纯只读复算。 |
| **2** | C-2 实际解决什么？ | ★ **本轮新取证**：线上**唯一** latch 写入点 = `runGen1ShadowEod.index.js:192` `computeLatchedState(prevState, incoming, { runtimeDataHealth: worstData })` —— **未传 `manualReviewConfirmed`**；而 `gen1-health-state.js:137-153` 规定 `wasDown && nowUp` 且 `manualReviewConfirmed !== true` ⇒ `recovery_rejected`、latch 保持原值。线上 `adminGateway`（实读 `online-codeinfo-20261002`）**仅有** `GET /api/admin/gen1/health`（只读），**无任何写 / 恢复路由**。⇒ latch 一旦 `DEGRADED`，**现有生产路径无任何方式释放**。C-2 = 建**唯一合法释放通道**。 |
| **3** | X-2 是什么前置条件？ | `baselineStage ∈ {S2,S3}` ∧ `signal.stage ∈ {'S2'}`。证据：`gen1-safety-permission.js:43` `MODEL_STAGES = Object.freeze(['S2'])`；`L162` `if (baseStage !== 'S2' && baseStage !== 'S3') return isBlocked('BASELINE_STAGE_NOT_ELIGIBLE')`。⇒ 它是**模型生产域的设计约束**（Gen-1 v1 严格 S2-only），⛔ 非工程 · 非授权 · 不可排期。 |
| **4** | C-3 / C-2 是否可先离线 / 测试实现？ | C-3 = ✅ **纯只读诊断（R1）**，可完全自主准备，零生产写。C-2 = ⚠️ **代码编写可离线（R1 准备）**，但**端点部署 + 首次调用 = R3**。⛔ 结论：**C-2 不能被整体归类为 R1**。 |
| **5** | 哪一步**真正首次**产生 production write？ | 分两个量纲（⛔ 不可混为一谈）：<br>· 首次 **production deploy** = **C-2**（R3）<br>· 首次 **production 数据写** = **C-1**（写 latch，R3）<br>· C-3 = **0 写**（只读）<br>⇒ **CP 上第一个 R3 = C-2**。 |
| **6** | 哪一步**首次改变** production decision behavior？ | **A-2b（selector 激活翻转）**。证据：`gen1-guarded-selector.js:31/80-81` 常量锁死 `BASELINE` + `L95-100` 双 `throw`；rde `L1046-1048` / `L1049-1051` 双 `throw` 断言。⚠️ **口径边界**：B-1 只改**寻址**（读同一权威内容，`run_candidate_*[pointer.run_id]` == baseline 内容），⛔ 不改计算；但 B-1 若先上线会改变**读取来源**（非决策本身）⇒ 本件**显式声明该口径**，不改变结论。 |
| **7** | X-1 是否必须在 C-3 / C-2 之后？ | ✅ **结论成立，但原因须改写** —— ⛔ **无任何直接结构依赖**（X-1 只改 `gen1_authority` 一个字段）。真实约束是**两条传递依赖 + 一条互斥禁令**：<br>· 传递①：X-1 应在 **D-3（Evidence Seal）** 之后（无证据不得升档）<br>· 传递②：X-1 必须在 **A-1 完成之后**<br>· ★ **互斥禁令**：`authority_canary` 的判定是**严格字符串相等** `String(authority.gen1_authority).toUpperCase() === 'CANARY'`（`gen1-shadow-eligibility.js:103-104`），而 X-1 把该字段改为 `GUARDED_EFFECTIVE` ⇒ `authority_canary=false` ⇒ **shadow 资格永久清零、`guardedShadowEligibleCount` 停止增长、`guardedShadowInvocations` 归零**。⇒ **先升档 = 自毁候选通道。**<br>· 而 A-1 在 C-1 · C-4 之后 ⇒ X-1 **传递地**晚于 C-3 / C-2。 |
| **8** | C-4 是否独立于 X-1？ | ✅ **独立**（不同轴：Health vs Authority）。`allow_canary` 由 `gen1-circuit-breaker.js:93-94`（`DEGRADED ⇒ allowCanary=false`）决定；X-1 由 `gen1-authority.js:34-57` 的档位决定。二者在 `guardedChecks`（`gen1-safety-permission.js:275-284`）中是**两个不同合取项**。 |
| **9** | A-1 是否**真正**依赖 C-4？ | ✅ **是**，但**经由第二个通道**（★ 本轮新发现）：<br>· **通道①（合取项）**：`guardedChecks.health_allows_guarded` ← 需 `hg.health==='OK'` ∧ `hg.gate_status==='ACTIVE'`（`L265-272`）⇒ 由 **C-1** 决定；⛔ **C-4 的 `allow_canary` 不参与此式**。<br>· **通道②（对象存在性）**：`claimGuardedShadowResult(eligibility, canaryS4Rerun)` 要求 `canaryS4Rerun ≠ null`（`gen1-shadow-eligibility.js:153-157`）；而 `gen1-canary.js:73-75` `canaryAllowed = permission.effective_canary === true && authorityAllows(...,'CANARY_OVERRIDE')`，`effective_canary` 含 `healthAllowsCanary`（= `hg.allow_canary !== false`，`gen1-safety-permission.js:224/247`）⇒ **`allow_canary=false` ⇒ `recomputeCanaryTarget` 不执行 ⇒ `canaryS4Rerun=null` ⇒ guarded candidate 恒 null**。<br>⇒ **原判定（C-4 在 A-1 前置上）正确**，但原件只写了通道① ⇒ 本件作**证据补强**（非纠错）。 |
| **10** | A-2 与 B-1 是否可以并行准备？ | 准备：✅ 可并行（A-2a 与 B-1 的实现互无数据依赖）。**上线顺序**：⛔ **须修正** —— 原 §7/§12/§13 把 A-2（P4）排在 B-1（P5）之前；而**同一交付件 §6.2 明写** `READ_PATH_READY` 早于 `SELECTOR_READY`（理由：否则「采纳了但看不到」）。⇒ 二者**自相矛盾**；按 §6.2 的设计意图修正为 **B-1 + G-1 先于 A-2b**（见 **CP-1**）。 |
| **11** | 哪些步骤可以**完全并行**？ | `C-3 ∥ C-2 ∥ B-4 ∥ B-5 ∥ B-6 ∥ F-3 ∥ G-3 ∥ G-4 ∥ F-5 ∥ F-6 ∥ N-9a ∥ OBS-3`（两两之间**无数据依赖**）。★ 另：**B-1 的设计与实现** 与 **C-1 / C-2 的健康修复** 完全并行（不同轴）。 |
| **12** | 哪些步骤必须**严格串行**？ | `C-1 → A-1 → D-1 → D-2 → D-3 → X-1 → (B-1 → G-1) → G-2 → A-2a → A-2b → G17`。两条**硬约束**：① `C-2 → C-1`（须经受控端点，⛔ 不得直写 DB）；② `A-1 完成 → X-1`（互斥禁令，见 #7）。 |

### 4.2 ★ 原 Critical Path 的修正登记（owner §四「如果发现原 Critical Path 有错误，必须修正，并解释原因」）

| # | 修正 | 原表述 | 修正后 | 原因 / 证据 |
|---|---|---|---|---|
| **CP-1** | **B-1 与 A-2 的**顺序反转**** | 原 §13：`… → X-1 → A-2 → B-1 → G-1 → …`（A-2 先） | 修正：`… → X-1 → B-1 → G-1 → G-2 → A-2a → A-2b → …`（B-1 先） | 同一交付件 §6.2 明写 `READ_PATH_READY` 早于 `SELECTOR_READY`；若 selector 先翻转而读侧仍是 legacy，会出现「**采纳了但看不到**」。⇒ 原 §13 与 §6.2 **内部矛盾**，按设计意图修正 |
| **CP-2** | **A-2 拆分为 A-2a / A-2b** | 原 §13 视 A-2 为单一节点 | 拆为 `A-2a`（cutover **代码通路**，可休眠，R2）+ `A-2b`（**激活翻转**，R3，需 E-5/E-10） | 否则「A-2 阻塞 B-1」与「B-1 早于 selector 激活」两条表述互相抵消；拆分后二者各自自洽 |
| **CP-3** | **C-3 与 C-2 由「串行」改为「并列」** | 原 §13：`C-3 → C-2 → C-1` | 修正：`C-3 ∥ C-2 → C-1`（二者是 C-1 的**两个独立前置**） | 修特征（C-3/AG-3）与建释放通道（C-2）**互不依赖**：C-2 的代码不需要知道缺哪个特征。⇒ 原串行表述**多排了一个不必要的串行步** |
| **CP-4** | **`C-4` 的通道归属** | 原 §13.1 只标 `C-4` = 「派生」 | 补：C-4 经 **rerun 存在性通道②** 参与 A-1 | 见 §4.1 #9；原件未写明通道 |
| **CP-5** | **`X-1 → A-1` 的互斥禁令** | 原 §13 顺序正确但**未给理由** | 补：互斥禁令（`CANARY` vs `GUARDED_EFFECTIVE` 同字段互斥） | `gen1-shadow-eligibility.js:103-104` 严格相等 ⇒ 顺序**不可交换**，⛔ 不是治理偏好而是**结构约束** |
| **CP-6** | **`G-15` → `G15`** | 原 §13 / §7 / §12 写作 `G-15` | 修正写作 **`G15`**（AND 表条件） | ⛔ 原写法与 G 类（Rollback，`G-1…G-4`）**撞名**；见 §5 |

---

## 5. ★ ID 命名空间冲突与漏项登记（owner §三）

> ⚠️ 本项目已多次出现「同名多义 namespace」事故。本节**穷举**当前全部冲突，⛔ 不自行删除、⛔ 不自行改名。

### 5.1 命名空间冲突（同名多义）

| # | 冲突 ID | 语义 A | 语义 B（及更多） | 处置 |
|---|---|---|---|---|
| **NS-1** | `N-1 … N-4` | **DEFERRED 清理项**（State-model / version-label / ml-shadow 标签） | `v6_negative_scan.py` 的**扫描门** `N-1 … N-11`（改动面白名单 / 生产路径零命中 / …） | ⛔ 不改闸门；本件统一写作 `N-1…N-4（DEFERRED）` 与 `N-k（扫描门）` |
| **NS-2** | `N-9a` / `N-10` | **扫描门**（`N-9a` 零部署特征 / `N-10` 无越界肯定式） | `N-9a` 又被当作**独立工作项**（AST 化） | 保留双写：`N-9a（扫描门）` / `N-9a（工作项）`；本件 §3.1 的 `N-9a` 指**工作项** |
| **NS-3** | `G-1 … G-4` | **Rollback / Fail-closed 缺口** | `G1 … G15` / `G16` / `G17` = **PRE_LAUNCH_INVENTORY §11 的 AND 表条件**；`G0 … G10` = **最小功能链节点** | ⛔ 原主件的 `G-15` 属**误写**；已按 CP-6 修正为 `G15` |
| **NS-4** | `D-1 … D-5` | **Evidence 缺口**（D-5 = 已完成项） | PRE_LAUNCH_INVENTORY **§11.2 差异登记** `D-1 … D-5`（如 `D-5` = 「两轴不同」） | 本件把差异登记重记为 `D-INV-1 … D-INV-5` |
| **NS-5** | `C-3` | **现状**：`515880` 缺失特征未定位 | **旧义**（PRE_LAUNCH_INVENTORY §12）：三项 AUTHORIZATION GATE 未授权 | 已按 inventory 的正式重编号收敛（`C-3` → 拆入 `E-6`/`AG-1·2·3`）；本件 §3.1 用**新义** |
| **NS-6** | `W1` | **`GEN1_DAILY_PRODUCTION_WATCH.md` 的巡检项 W1**（`gen1_health_gate_status` 须 `ACTIVE`） | 前序主件 §15.2 的 **capture 窗口身份 `W1`**（`UNRESOLVED / NON-BLOCKING`） | 本件分别写作 `W1（巡检项）` / `W1（capture 窗口身份）` |
| **NS-7** | `P-1` | 本件阶段划分的 **PRECONDITION**（= `X-2`） | 前序 check 的 **AST 变异正样本 `P-1`** | ⛔ 仅在本件范围内使用；⛔ 不跨件引用 |

### 5.2 前序 Gate 已发现、但尚未正式编号的对象（**完整列举，⛔ 不删除**）

| 对象 | 来源 | 本件处置 |
|---|---|---|
| `AG-1` / `AG-2` / `AG-3` | 健康诊断件 §5（仅以 `E-6` 括注存在） | ✅ 提升为 §3.2 **独立矩阵行** |
| `G16_SELECTOR_CUTOVER_PATH_EXISTS` | PRE_LAUNCH_INVENTORY §11.2 `D-1` | ✅ 提升为 §3.2 独立行 |
| `G17_GEN1_HAS_EFFECT_ON_DECISION` | PRE_LAUNCH_INVENTORY §11.2 `D-2` | ✅ 提升为 §3.2 独立行 |
| `G15_GE04_AUTHORIZED` | PRE_LAUNCH_INVENTORY §11.1 | ✅ 提升为 §3.2 独立行（并修 NS-3 撞名） |
| `G9-b`（读侧 fail-closed） | PRE_LAUNCH_INVENTORY §11.2 `D-3` | ✅ 提升为 §3.2 独立行（与 `G-1` 关系已注明） |
| `OBS-3` | 健康诊断件 §7 | ✅ 提升为 §3.2 独立行（= `C-3` 的观察面） |
| `W1（capture 窗口身份）` | 前序主件 §15.2 | ✅ §5.1 NS-6 登记；`UNRESOLVED / NON-BLOCKING` ⇒ `R0` |
| `D-INV-1 … D-INV-5` | PRE_LAUNCH_INVENTORY §11.2 | ✅ §5.1 NS-4 重记；均为**登记类**（`R0`） |
| `H-24` / `H-25` | 健康诊断件 §11.6 / §6 | ✅ `R0-CLOSED`（已在上一批修复，⛔ 本件不再动） |
| `ERRATA-1` | `GEN1_PRE_LAUNCH_INVENTORY_ERRATA_20261003.md` | ✅ `R0-CLOSED`（已登记；⛔ 不回改已 ACCEPT 主件字节） |
| `PD-1 … PD-6` | 前序主件 §7.1（阶段差异登记） | ✅ 登记类（`R0`） |
| `RP-1 … RP-n` / `RP-A … RP-I` | 各 Gate 的打红自证编号 | ✅ 非工作项（`R0`）；⛔ 不排期 |

⚠️ **本件声明**：除上表外，**未发现**其他「已发现但未编号」的对象。
⛔ 但本件**不声称穷尽** —— 前序各件的**正文**未逐字重读（标注 `NOT RE-READ`）。

---

## 6. Critical Path 重算（owner §七 · 三个独立状态）

### 6.1 当前 Root Blockers

```text
ROOT_BLOCKERS = [C-3, C-2]                 （入度 = 0；二者并列，共同解阻 C-1）
PRECONDITION_NON_ENGINEERING = [X-2]       （⛔ 非节点 · 非工程 · 不可排期）
并列无前置但不阻断主链 = [B-4, B-5, B-6, E-7, OBS-3, F-5, F-6, N-9a]
```

### 6.2 修正后的唯一关键路径（含 CP-1 … CP-6）

```text
CRITICAL_PATH =
    C-3  ∥  C-2                      （★ CP-3：并列，非串行）
     → C-1                           （写 latch；须经 C-2 受控端点）
     → C-4                           （派生正控；经通道②参与 A-1 · ★ CP-4）
     → [ X-2  PRECONDITION ]         （⛔ 非节点 · 不可排期）
     → A-1                           （guarded candidate 由恒 null → 非 null）
     → D-1 → D-2 → D-3               （Evidence Execution / ≥30 事件 / Seal）
     → X-1                           （authority 升档；★ 互斥禁令 · CP-5）
     → B-1 → G-1                     （★ CP-1：读侧迁移 + fail-closed，早于 selector 激活）
     → G-2                           （前滚 / 回滚路径）
     → A-2a                          （★ CP-2：cutover 代码通路）
     → A-2b                          （★ CP-2：激活翻转 = decision behavior 首变点）
     → G17                           （Gen-1 真正影响决策）
     → E-5                           （GE-04 授权闸）
     → GEN1_IN_DECISION_CHAIN
```

⛔ **`X-2` 只出现在 PRECONDITION 位**，⛔ 不得作为可实施节点进入任何实施队列（owner 明令）。

### 6.3 三个**独立**状态（owner §七「必须同时给出」）

> ⛔ **不得**由 `TECHNICAL READINESS = PASS` 推出另外两项。

| 节点 | TECHNICAL READINESS | IMPLEMENTATION AUTHORIZATION | PRODUCTION AUTHORIZATION |
|---|---|---|---|
| `C-3` | MISSING（诊断未做） | **ALLOWED（R1）** | **N/A（零生产写）** |
| `C-2` | MISSING（端点不存在） | REQUIRES OWNER AUTH（R3） | **NOT AUTHORIZED** |
| `C-1` | BLOCKED（latch `DEGRADED`） | REQUIRES OWNER AUTH（R3） | **NOT AUTHORIZED** |
| `C-4` | BLOCKED（派生） | N/A（非工作项） | N/A |
| `X-2` | NOT SATISFIED（`baselineStage ∈ {S0,S1}`） | N/A（⛔ 非工作项） | N/A |
| `A-1` | BLOCKED（derived） | N/A（⛔ 非工作项） | N/A |
| `D-1` | MISSING | REQUIRES OWNER AUTH（R3 · E-3） | **NOT AUTHORIZED** |
| `D-2` | MISSING（0 / 30） | REQUIRES OWNER AUTH（R3） | **NOT AUTHORIZED** |
| `D-3` | MISSING（`PENDING`） | REQUIRES OWNER AUTH（R3 · E-4） | **NOT AUTHORIZED** |
| `X-1` | MISSING（`CANARY`） | REQUIRES OWNER AUTH（R3 · **独立门**） | **NOT AUTHORIZED** |
| `B-1` | MISSING | REQUIRES OWNER AUTH（R3 · E-9） | **NOT AUTHORIZED** |
| `G-1` / `G-2` | MISSING | REQUIRES OWNER AUTH（R3） | **NOT AUTHORIZED** |
| `A-2a` | MISSING | REQUIRES OWNER AUTH（R2） | **NOT AUTHORIZED** |
| `A-2b` | MISSING | REQUIRES OWNER AUTH（R3 · E-10） | **NOT AUTHORIZED** |
| `G17` | MISSING | REQUIRES OWNER AUTH（R3） | **NOT AUTHORIZED** |
| `E-5`（GE-04） | NOT AUTHORIZED | REQUIRES OWNER AUTH（R3 · **最高等级**） | **NOT AUTHORIZED** |

```text
TECHNICAL READINESS              : ⛔ 全链 NOT READY（最高 = C-3 的「可自主准备」）
IMPLEMENTATION AUTHORIZATION     : ⛔ NO（`IMPLEMENTATION_AUTHORIZED = NO`）
PRODUCTION AUTHORIZATION         : ⛔ NO（`PRODUCTION_WRITE_AUTHORIZED = NO`）
```

### 6.4 可并行工作 / 门清单

```text
PARALLEL_WORK = [ C-3, C-2（的离线代码准备）, B-4, B-5, B-6, E-7,
                  F-3, G-3, G-4, F-5, F-6, N-9a, OBS-3 ]
                （⛔ 全部仍须各自授权；⛔ R1 不等于已授权）

PRODUCTION_WRITE_GATES = [ A-2, A-2a, A-2b, A-3, B-1, B-2, B-3, B-5, B-6, C-1, C-2,
                           D-1, D-2, D-3, F-1, F-2, F-3, F-4, G-1, G-2, G9-b, G16, G17,
                           X-1, AG-1, AG-2, AG-3 ]                        （27 项）
⛔ 不在生产写门内 = [ A-1, B-4, C-3, C-4, D-4, D-5, E-1…E-10, F-5, F-6,
                      G-3, G-4, G15, X-2, N-1…N-4, N-9a, OBS-3 ]      （28 项）

AUTHORIZATION_GATES = [ E-1, E-2, E-3, E-4, E-5, E-6, E-7, E-8, E-9, E-10,
                        AG-1, AG-2, AG-3, X-1, C-1, C-2 ]     （16 项 · ⛔ 各自独立）

EVIDENCE_GATE = E-3（Execution 授权）→ D-1 → D-2（≥30）→ E-4（Key 3 Seal）→ D-3
                ⛔ 不构成 GE-04 的自动前置（见 RP-C）

GE04_GATE = E-5（⛔ 最高等级 · 独立 · 不可隐式触发）
```

---

## 7. 并行 / 串行 / 暂缓泳道（owner §八）

| 泳道 | 项 | 依据 |
|---|---|---|
| **SEQUENTIAL（强串行，⛔ 不可并行）** | `C-1 → A-1 → D-1 → D-2 → D-3 → X-1 → (B-1 → G-1) → G-2 → A-2a → A-2b → G17` | §6.2 |
| **PARALLEL（无数据依赖）** | `C-3` · `C-2 离线准备` · `B-4` · `B-5` · `B-6` · `E-7` · `F-3` · `G-3` · `G-4` · `F-5` · `F-6` · `N-9a` · `OBS-3` | §6.4 |
| **OWNER-GATED** | `E-1…E-10`（10）· `AG-1·2·3` · `X-1` · `C-1` · `C-2` | §6.4 |
| **PRODUCTION-WRITE-GATED** | §6.4 的 26 项 | §6.4 |
| **EVIDENCE-GATED** | `D-1 · D-2 · D-3 · X-1 · A-2b · E-4 · E-5` | `gen1-guarded-seal.js` |
| **GE-04-GATED** | `A-2b` · `E-10` · `E-5` · `G15` · `G17` | owner §一 |
| **DEFERRED（⛔ 不触碰）** | `N-1 · N-2 · N-3 · N-4`（R4） | owner §九 |

⚠️ **State-model cleanup / Observability cleanup / Harness cleanup 均不阻断核心链** ⇒ 全部置于
**PARALLEL / DEFERRED lane**（`F-5` · `F-6` · `N-9a` · `N-1…N-4`）。

---

## 8. red-proof 设计（owner §五）

> ⛔ **§13 红线（永久）**：`RED_PROOF MUST NEVER EXECUTE REAL PRODUCTION COMMANDS`。
> 本件全部 red-proof = **纯内存 gate 引擎仿真 + 内存内容变异 + AST mutation**（⛔ 零 subprocess · 零落盘 · 零生产命令）。

### 8.1 owner 指定 6 项

| RP | 注入 | 期望 | 证明 |
|---|---|---|---|
| **RP-A** | `UPSTREAM_TECHNICAL_PASS = true` ∧ `DOWNSTREAM_AUTHORIZATION = false` | `DOWNSTREAM_ACTION = BLOCKED` | 技术 PASS **不会**自动产生生产授权 |
| **RP-B** | `DOWNSTREAM_AUTHORIZATION = true` ∧ `UPSTREAM_TECHNICAL_PASS = false` | `DOWNSTREAM_ACTION = BLOCKED` | Owner 授权**也不能**绕过技术前置 |
| **RP-C** | `EVIDENCE_PASS = true` | `GE04 = NOT AUTHORIZED` | Evidence PASS **不触发** GE-04 |
| **RP-D** | `IMPLEMENTATION_AUTHORIZED = true` | `PRODUCTION_WRITE = BLOCKED` | 实施授权 **≠** 生产写授权 |
| **RP-E** | `C-3 = PASS` | `X-1 = NOT AUTHORIZED` | 上游 PASS **不外溢**至 X-1 独立门 |
| **RP-F** | `X-1 = AUTHORIZED` | `A-2 = NOT AUTHORIZED` | X-1 授权**不外溢**至 A-2 |

### 8.2 本件增设（其他易发隐式传播路径）

| RP | 注入 | 期望 |
|---|---|---|
| **RP-G** | `FREEZE = PASS` | `PRODUCTION_ATTESTATION = NOT AUTHORIZED` |
| **RP-H** | `DEPLOY_AUTHORIZED = true` | `GE04 = NOT AUTHORIZED` |
| **RP-I** | `A-2a（代码通路）已合并/授权` | `A-2b（激活） = NOT AUTHORIZED` |
| **RP-J** | `D-2（≥30 事件）= PASS` | `D-3（Seal） = NOT AUTHORIZED`（须 E-4） |
| **RP-K** | `C-1（Health = OK）= PASS` | `A-1 = 不自动达成`（须 `X-2` 阶段域 ∧ 通道②的 rerun） |
| **RP-L** | 本检查脚本自身 | AST 自扫零违规 · 零部署 token · 零写模式 open |

---

## 9. 只读检查器与回归（owner §八 / §九）

### 9.1 检查器

`scripts/gen1/evidence-capture/v6_owner_decision_boundary_check.py`

- 性质：**纯只读**。⛔ 不联网 · ⛔ 不开子进程 · ⛔ 不写任何文件 · ⛔ 不调用任何生产 CLI / API。
- 设计：**直接解析本件的矩阵表格**（按 `|` 切分、严格 15 列），对**结构不变量**做机器断言；
  ⛔ 不用「关键字是否出现」冒充判定。
- 断言组：`B-01` 自证 · `B-02…B-05` 矩阵结构与计数 · `B-06…B-08` 授权边界分离 ·
  `B-09…B-11` 独立门与前置条件 · `B-12…B-14` 关键路径自洽 · `B-15…B-18` 否定式与零写声明 ·
  `B-19…B-21` harness 自身洁净。
- 打红自证：`RP-A … RP-L`（§8）+ 内容变异红证（矩阵结构破坏 ⇒ 对应断言必须 FAIL）。

### 9.2 回归（显式白名单，⛔ 禁通配）

回归面 = **显式文件名白名单**（纪律 13）。⛔ 排除采集 / 迁移 / 红证驱动类工具。
⛔ 结果**提交后复跑**（`v6_negative_scan.py` 的 `N-9a` 枚举域为 commit-range 相关）。

### 9.3 ⚠️ 既有 harness 缺陷的处置裁定（owner §九 的口径登记，⛔ 待 owner 复核）

owner §九 要求：「如果发现现有 harness 自身存在 self-reference、token 漏检、replace 过弱、扫描域不足等问题，
**先修复 harness，再重新执行**。」

**本件的执行口径（如实登记，⛔ 请 owner 复核）**：

| 对象 | 发现 | 本件处置 | 理由 |
|---|---|---|---|
| **本 Gate 新建 harness**（`v6_owner_decision_boundary_check.py`） | — | ✅ **自始零缺陷**：token 表运行时拼装（避自指）· 无 subprocess · 无写模式 open · 内容变异 `replace` **不加 count** | owner §九 的直接适用对象 |
| **`v6_negative_scan.py`** | `N-9a`（子串扫描 vs 红证语料，**结构性冲突**）· `N-10`（文本扫描 vs 检查项描述）· `N-9a` 枚举域 commit-range 相关 | ⛔ **本件不修改**；登记为 `F-5` / `F-6`（R1 · harness-only） | ⚠️ **冲突裁定**：该脚本是本批次的**最终闸门**，且其锚点 `PRE_BATCH` 被 owner 锁定；⛔ 由被检方（本轮批次）自行放宽**判定闸门**= 结构性的利益冲突。⇒ 按「改被检对象以过检」禁令，**先 STOP-AND-REPORT** |
| **`F-5` / `F-6` 的修法提案** | — | ✅ **给出设计（⛔ 未应用）**：把 `N-9a`/`N-10` 由**子串/正则扫描**改为 **AST 结构化扫描**（只判 `ast.Call` 目标，不判字符串常量与注释） | `N-9a` 工作项 = **R1 · 仅 harness · `OWNER_AUTH_REQUIRED = YES`** |

⇒ **Δ 待 owner 裁定**：owner §九 是否覆盖 `v6_negative_scan.py`？
（选项 A：仅覆盖本 Gate 新建 harness —— 本件已按此执行 · 选项 B：覆盖并授权 `N-9a` AST 化 —— 需 owner 明确放行 ·
选项 C：维持前序禁令，`F-5`/`F-6` 仅登记）

---

## 10. 功能 / 证据边界（owner §十一 口径延续）

```text
FUNCTIONAL_COMPLETE      = NO      IMPLEMENTATION_AUTHORIZED     = NO
PRODUCTION_INTEGRATED    = NO      PRODUCTION_WRITE_AUTHORIZED   = NO
HEALTH_READY             = NO      EVIDENCE_EXECUTION_AUTHORIZED = NO
EVIDENCE_READY           = NO      GE04_AUTHORIZED               = NO
EVIDENCE_EXECUTED        = NO
EVIDENCE_SEALED          = NO
```

```text
⛔ Evidence PASS           ⇒ ✗ Gen-1 Functional Complete
⛔ Functional Complete     ⇒ ✗ Production Live
⛔ Production Live         ⇒ ✗ GE04 Authorized
⛔ TECHNICAL PASS          ⇒ ✗ AUTHORIZATION PASS
⛔ R1（可自主准备）        ⇒ ✗ 已授权
```

---

## 11. 零写声明（本件执行期）

```text
PRODUCTION_WRITE = 0 · DEPLOY = NO · ROLLBACK = NO · CANARY = OFF
AUTO_EXECUTION = OFF · MERGE = NO · TAG = NO · PUSH = NO
```

⛔ 未修改 production code / config / DB；⛔ 未改 V6 Evidence Freeze Seal / Key 2 / V5·V6 frozen contract /
Authority / FROZEN_PARAM_KEYS / immutable_set / selector / active pointer / production read path；
⛔ 未修任何 Gap；⛔ 未生成下一版本生产代码；⛔ 未提升 authority；⛔ 未 release selection；
⛔ 未执行 Evidence；⛔ 未 GE-04；⛔ 未 deploy / merge。

---

## 12. STOP 输出（owner §十一 指定格式）

```text
GEN1_OWNER_DECISION_MATRIX = COMPLETE

MATRIX_ITEMS = 55

R0 = 5
R1 = 8
R2 = 3
R3 = 35
R4 = 4

ROOT_BLOCKERS = [C-3, C-2]

CRITICAL_PATH = [C-3 ∥ C-2, C-1, C-4, (X-2 PRECONDITION), A-1, D-1, D-2, D-3, X-1,
                 B-1, G-1, G-2, A-2a, A-2b, G17, E-5]

PARALLEL_WORK = [C-3, C-2（离线准备）, B-4, B-5, B-6, E-7, F-3, G-3, G-4, F-5, F-6, N-9a, OBS-3]

PRODUCTION_WRITE_GATES = [A-2, A-2a, A-2b, A-3, B-1, B-2, B-3, B-5, B-6, C-1, C-2,
                          D-1, D-2, D-3, F-1, F-2, F-3, F-4, G-1, G-2, G9-b, G16, G17,
                          X-1, AG-1, AG-2, AG-3]

AUTHORIZATION_GATES = [E-1, E-2, E-3, E-4, E-5, E-6, E-7, E-8, E-9, E-10,
                       AG-1, AG-2, AG-3, X-1, C-1, C-2]

EVIDENCE_GATE = E-3 → D-1 → D-2（≥30）→ E-4 → D-3        （⛔ 不构成 GE-04 自动前置）

GE04 = NOT AUTHORIZED

RED_PROOF = PASS
REGRESSION = PASS

PRODUCTION_WRITE = 0
DEPLOY = NO
ROLLBACK = NO
CANARY = OFF
AUTO_EXECUTION = OFF
MERGE = NO
TAG = NO
PUSH = NO

IMPLEMENTATION_AUTHORIZED = NO
PRODUCTION_WRITE_AUTHORIZED = NO
EVIDENCE_EXECUTION_AUTHORIZED = NO
GE04_AUTHORIZED = NO

STOP = YES
```

---

## 13. 复算命令（供独立复现）

```bash
# 0) 前置：本件在载体树 _g1-contract-v5-20261002（分支 docs/gen1-evidence-contract-v5-20261002）
cd _g1-contract-v5-20261002

# 1) 只读检查器（本 Gate 交付）
python scripts/gen1/evidence-capture/v6_owner_decision_boundary_check.py

# 2) 打红自证（RP-A … RP-L）
for c in RP-A RP-B RP-C RP-D RP-E RP-F RP-G RP-H RP-I RP-J RP-K RP-L; do
  python scripts/gen1/evidence-capture/v6_owner_decision_boundary_check.py --redproof $c
done

# 3) 矩阵结构复算（行数 / R 类计数）
grep -c "^| [A-Z]" docs/gen1/GEN1_OWNER_DECISION_MATRIX_20261003.md
```

⚠️ **纪律 14**：⛔ 不得在管道后取 `$?`（会取到管道末端 `tail` 的退出码）；
退出码必须来自**未被管道包装**的调用。
