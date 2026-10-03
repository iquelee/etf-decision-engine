# GEN1_C3_C2_ARCHITECTURE_DECISION_20261003 —— C-3 / C-2 架构裁定 + 审计载体终裁

> 生成时间：**2026-10-03**（GMT+8）· 轮次：`Architecture Decision`（**只读设计轮**）
> 前件：`GEN1_D1_D2_DECISION_20261003.md`（carrier commit `59a7cb1`）· 姊妹件：`GEN1_DEPLOYMENT_GOVERNANCE_DECISION_20261003.md`
> 性质：⛔ **本件不构成实施授权**、⛔ **不代表已获授权**、⛔ 未修改任何 production 对象、⛔ 未进入 coding。
> ★ 「能实现」 ≠ 「已授权实现」。

---

## §0 方法与证据分级

| 等级 | 含义 |
|---|---|
| `repo-src` | 工作区源码（`src/common/utils/**`、`cloudfunctions/**`、`scripts/**`、`src/common/schema.js`） |
| `git-tracked-check` | `git ls-tree -r --name-only <ref>` + `git check-ignore` + `git log --all` ⇒ 判定「是否真的在版本控制内」 |
| `git-object` | `git show <ref>:<path>` / `merge-base --is-ancestor` / `ls-remote` |
| `online-meta` | 2026-10-03 实时只读 `tcb fn detail --json` 的元数据（`Triggers` 等） |
| `governance-artifact` | `docs/production-deployment-ledger.md` · `docs/gen1/artifacts/**` · `refs/tags/**` · `src/common/constants.js` 的治理注释 |
| `NOT RE-READ` | 明确未在本轮重读 |

**★ 本轮新增的关键实测（全部为本件结论的直接依据）**：

| # | 实测 | 证据等级 | 影响 |
|---|---|---|---|
| N-1 | `missing_features` 在**生产侧无任何消费者**（唯一写入点 `runGen1ShadowEod:234`；唯一读者为单测） | `repo-src` | C-3 §1.4 |
| N-2 | 本仓**已存在**并已被单测锁定的「信号侧健康快照」审计分列先例（`gen1_signal_health_snapshot`） | `repo-src` | C-3 §1.5 ★ 决定性 |
| N-3 | `deliverables/**` 被 `.gitignore:23` 忽略，**从未进入任何 commit** | `git-tracked-check` | §3.3 ★ 更正前件 |
| N-4 | `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json` **确在 git 内**（`git ls-tree` 命中、`git check-ignore` rc=1） | `git-tracked-check` | §3.4 ★ 裁定依据 |
| N-5 | `promote-*.js` 三个脚本中 **2 个硬编码 `version: 1`**，且**均不写 `prev_value`** | `repo-src` | C-2 §2.2 |
| N-6 | `adminGateway.updateParam` **有** `prev_value` + 单调 `version`（与 promote 脚本相反） | `repo-src` | C-2 §2.2 |
| N-7 | `FROZEN_PARAM_KEYS` 注释**指名** `scripts/promote-*.js` 为「专门、可审计」通道 | `governance-artifact` | C-2 §2.2 ★ |
| N-8 | `runGen1ShadowEod` 线上触发器 = `Type: timer` · `cron 0 20 22 * * 1-5 *` · `TriggerName gen1-eod-weekdays-2220` | `online-meta` | C-2 §2.1 |

---

## §1 D-1 · C-3：CLOSE / RECLASSIFY 决策分析

### §1.1 冻结事实（owner 给定 → 本轮逐项复核）

| 冻结项 | owner 给定 | 本轮复核 | 证据 |
|---|---|---|---|
| `515880` 状态 | `STATISTICAL_MISSING` | ✅ 一致 | 前件 §1.1 C3-b |
| 缺失明细 | `missing_features = ["sideway_range"]` | ✅ 一致 | 前件 §1.1 C3-b |
| 明细落点 | 已进入 `ML_SHADOW_SIGNAL` | ✅ 一致（`runGen1ShadowEod:234` 写入） | `repo-src` |
| 线上可读 | 是 | ✅ 一致（`ml_shadow_signal` 只读实读） | 前件 §1.1 |
| 语义根因 | `sideway_days = 0` ⇒ `calcSidewayRange() = null` | ✅ 一致（`if (!sidewayDays \|\| sidewayDays < 1) return null;`） | `repo-src` |
| 旧 Gap 定性 | **RETRACTED / 已证伪** | ✅ 采纳（本件不重复论证，仅引用） | 前件 §1.2 |

> ⛔ 本轮**不继续寻找「落库修复」**（owner 明令）。旧 Gap 的撤回已在前件 `C3_OLD_CLAIM_RETRACTED` 完成。

### §1.2 唯一的架构问题

> **«Gen-1 的 authoritative health contract，是否必须携带 `missing_features` 这类细粒度诊断信息？»**

两个候补契约：

| 契约 | 定义（本件逐字） |
|---|---|
| **C3-A** —— 「coarse 权威状态」 | `gen1_health_state` / `runtime_status` 继续**只承担 coarse health state**（`OK` / `WARNING` / `DEGRADED` / `ML_OFF`）；详细原因继续由 **`ML_SHADOW_SIGNAL`** 承担。 |
| **C3-B** —— 「明细入权威状态」 | 将 **`missing_features` / data_health detail** 纳入 authoritative health state。 |

### §1.3 逐维分析（owner 指定 8 维 · ⛔ 不以「信息更完整」作为自动选择理由）

| # | 维度 | C3-A | C3-B | 判据（实测） |
|---|---|---|---|---|
| 1 | **状态源重复** | ✅ 无重复：诊断唯一源 = `ml_shadow_signal.missing_features` | ⛔ 制造**第二个真相源**：同一 `missing_features` 同时存在于明细集合与健康状态 | `N-1`：明细仅 `ml_shadow_signal` 一处 |
| 2 | **schema coupling** | ✅ 零耦合：健康状态 schema 不随特征集合演进 | ⚠️ 强耦合：`REQUIRED_FEATURES`（15 项）一变，健康状态 schema 的明细字段即变 | `src/common/schema.js:325-330` 现有 6 个 `gen1_health_*` 字段均为**标量** |
| 3 | **health state 膨胀** | ✅ 恒定大小（单文档标量集合） | ⛔ **基数不匹配**：`gen1_health_state` 是**单文档**（`key='gen1-health-state'`）；明细是**逐标的 × 逐日** ⇒ 写放大 + 覆盖语义混淆 | `gen1-health-state.js:38` `HEALTH_STATE_KEY` |
| 4 | **runtime vs diagnostic evidence 职责边界** | ✅ **边界清晰**：runtime = 门（是否允许 guarded）；diagnostic = 证据（为什么） | ⛔ **侵蚀边界**：把证据塞进门载体 ⇒ 诱发「gate 判定读明细」 | ★ 本仓**已有成文边界**（见 §1.5） |
| 5 | **replay** | ✅ 可复算：诊断可从 `ml_shadow_signal` 逐行重算 | ⚠️ 需额外的 latch 快照才能复算，且明细混入后无法区分「哪一条是判定依据」 | `ml_shadow_signal` 为逐日 append 行 |
| 6 | **backward compatibility** | ✅ 兼容：`runtime_status` **已有** `gen1_health_read_reason_code` 槽位（现为 `null`）⇒ 补填充语义即可，**无需新字段** | ⛔ 需 schema 扩张 + 未知消费者风险 | `src/common/schema.js:329` |
| 7 | **consumer impact** | ✅ 零影响：无消费者读明细 | ⚠️ 前端 `gen1-ui-view-model` / `gen1-view-model` 的 health 段均只读标量；新增明细会引入契约漂移 | `repo-src` |
| 8 | **是否真的有 downstream consumer 需要它** | ✅ **没有** | ⛔ 依旧没有（C3-B 不会创造消费者，只会创造**未被消费的冗余字段**） | `N-1` |

### §1.4 downstream consumer 实测（★ owner 指定必答）

全仓扫描 `missing_features`：

| 角色 | 命中 | 结论 |
|---|---|---|
| **写入点（生产）** | `cloudfunctions/runGen1ShadowEod/index.js:234` `missing_features: dataHealth.missing_features,` | 唯一 |
| **读取点（生产）** | ⛔ **无** | — |
| **读取点（测试）** | `tests/gen1-data-health.test.js:17` / `:49` | 单测断言，非生产消费者 |
| **读取点（文档）** | `docs/gen1/**` 若干 | 治理文本，非运行消费者 |

对照组（**粗粒度**健康字段确实有消费者，且**都只读粗粒度**）：

| 字段 | 消费者 | 读什么 |
|---|---|---|
| `data_health_status` / `data_health_reason_code` | `runDecisionEngine/index.js:781-782` | 仅 `status` + `reason_code`（**不含明细**） |
| `data_health_status` | `adminGateway/index.js:107`（`getGen1Health`） | 仅 status |
| `data_health_status` / `data_health_reason_code` | `src/common/utils/gen1-view-model.js:183-184` | 仅 status + reason_code |

> ★ **判定**：**不存在任何 downstream consumer 需要 `missing_features` 进入权威 health state。** C3-B 的收益无法由任何消费者兑现 —— 这正是 owner 警告的「以信息更完整为理由」的典型形态。

### §1.5 ★ 既有架构先例（本件最具决定性的证据）

本仓**已经确立**并**已被单测锁定**一条原则：**权威 latch 是「门」；信号侧/细粒度健康只能作为分列的审计快照，不得参与有效判定。**

| 证据 | 内容 |
|---|---|
| `src/common/schema.js:330` | `gen1_signal_health_snapshot` —— 注释逐字「当日信号侧健康快照（**与 latch 分列**）」 |
| `src/common/utils/gen1-overlay.js:70` | `out.gen1_signal_health_snapshot = p.signal_health_snapshot != null ? p.signal_health_snapshot : null;`（**单列落库**） |
| `tests/gen1-health-single-truth.test.js:11` | 注释逐字：「signal 侧 health 仅作为 `signal_health_snapshot` **审计字段**，不得影响 `effective_*`」 |
| `tests/gen1-health-single-truth.test.js:61` / `:113` | 断言快照「被如实保留（**审计用**）」且「快照**单列**落库」 |

> ★★ **推论**：**C3-B 会违反本仓已确立且已测的「健康单一真相 + 审计分列」原则** —— 它等价于把审计字段重新塞回门载体。⇒ **C3-A 不是「更简」，而是「与本仓既有架构一致」**。

### §1.6 裁定

```text
C3_STATUS            = RECLASSIFY
C3_CONTRACT_DECISION = C3-A
```

**RATIONALE**（逐条）：

1. **契约问题本身已有确定答案**：**C3-A**。理由链 = 「无消费者（§1.4）」+「既有架构已把审计分列（§1.5）」+「状态源重复/schema 耦合/基数不匹配（§1.3 #1/#2/#3）」+「向后兼容无需新字段（§1.3 #6）」。⛔ 不以「信息更完整」为选择理由。
2. **为什么是 `RECLASSIFY` 而不是 `CLOSE`**：C-3 在冻结关键路径中位于 `C-3 ∥ C-2 → C-1` 的**首段**，其**下游依赖关系仍然成立**（健康门 `OK`∧`ACTIVE` 仍不可达）。若判 `CLOSE`，则「口径修正」这项工作会**失去关键路径上的挂点**（成为孤儿项）。因此 C-3 应**保留原位置**，仅**更正其性质**。
3. **为什么不是 `REMAIN_BLOCKER`**：C-3 阻塞的**内容已经变了**。它不再阻塞于「未定位/未落库」（已证伪），而是阻塞于**分类口径**（见 §1.8）。性质变更 ⇒ 不是同一件事继续阻塞。

**RECLASSIFY 的去向（逐项）**：

| 代号 | 重新归类为 | 性质 | 是否阻塞 | 状态 |
|---|---|---|---|---|
| **C3-α** | 旧「`missing_features` 未持久化 / 产出但未落库」 | ⛔ **RETRACTED**（非工作项） | ⛔ 否 | 已在前件撤回，本件仅登记去向 |
| **C3-β** | 「权威 health contract 是否携带明细」 | ✅ **已裁定 = C3-A**（非工作项） | ⛔ 否 | 本件裁定 |
| **C3-γ** | → **`R2` · Data Health 分类口径修正** | ⚠️ 真工作项（设计已定、⛔ 未授权） | ✅ **是**（前置 `C-1`，**保留原位置**） | 见 §1.8 |
| **C3-δ** | → **`OBS` · 健康原因码观测性改进** | ⚠️ 非阻塞 backlog | ⛔ 否 | 见 §1.7 第 4 条 |

### §1.7 CLOSE 式的四项附随交付（owner 指定 · 与上面裁定同时适用）

**① Gap closure evidence（旧 Gap 为何可以结账）**

| 旧 Gap 语句 | 结账依据 |
|---|---|
| 「`515880` 具体缺失特征**未定位**」 | ✅ **已定位**：`sideway_range`（线上 `ml_shadow_signal` 只读可读） |
| 「`evaluateDataHealth()` **产出但未落库**」 | ⛔ **证伪**：`runGen1ShadowEod:234` 写入 + 线上实读命中 |
| 「（诊断）**根因不可见**」 | ⛔ **证伪**：`data_health_reason_code` + `missing_features` 均落库 |

**② 为什么不需要 production implementation（就**契约**而言）**

- 契约答案 = **C3-A** ⇒ **维持现状即符合契约**，⛔ **不需要**任何 production 改动来实现「明细入健康状态」。
- `runtime_status` 需要的**只是填充语义**（既有字段 `gen1_health_read_reason_code` 现为 `null`），而不是新字段 —— 且该填充属 `OBS`（非阻塞）。
- ⇒ **「C-3 契约」不需要 production implementation**；⛔ **但**这**不等于**「C-3 全部工作量为零」（见 §1.8）。

**③ 哪些旧文档必须标记 RETRACTED**

> ★ 处置纪律：⛔ **不回改**任何已 ACCEPT 主件的字节；一律**追加勘误指针**（沿用 `GEN1_PRE_LAUNCH_INVENTORY_ERRATA_20261003.md` 的 `ERRATA-1` 先例）。

| # | 文档 | 行 | 需撤回的旧表述 | 建议处置 |
|---|---|---|---|---|
| 1 | `GEN1_PRE_LAUNCH_INVENTORY_20261002.md` | L448 | 「`515880` 具体缺失特征未定位（`missing_features` 未持久化）」/「`evaluateDataHealth()` 产出但未落库」 | 追加 `ERRATA-2`（⛔ 不回改主件） |
| 2 | `GEN1_OWNER_DECISION_MATRIX_20261003.md` | L104 | 同上（C-3 行「能力轴」列） | 追加勘误指针 |
| 3 | `GEN1_OWNER_DECISION_MATRIX_20261003.md` | L195 | 同上（第 1 问解答） | 追加勘误指针 |
| 4 | `GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md` | L328 | `OBS-3`：「`missing_features` **未持久化**」 | 追加勘误；`OBS-3` 由 `OPEN` 改为 `RETRACTED（部分）` |
| — | `GEN1_C3_C2_PREFLIGHT_20261003.md` | L37/L55/L63 | 前件**已自行登记**「旧描述被证伪」 | ⛔ 无需改动（已登记） |

> ⛔ **本件不执行任何回改**（属文档写操作，须单独授权）。

**④ 后续是否只保留 observability improvement backlog**

**答：不完全是 —— 保留两条独立轨，但都非本轮授权范围内的实施。**

| 轨 | 内容 | 阻塞性 |
|---|---|---|
| `OBS`（observability improvement backlog） | ① 填充既有 `runtime_status.gen1_health_read_reason_code`（现 `null`）；② 建立「健康层 → 诊断载体」的**引用链**（稳定键，非明细复制） | ⛔ 非阻塞 |
| **`R2`（分类口径）** | 见 §1.8 | ✅ **阻塞**（前置 `C-1`） |

### §1.8 ★ 独立残留项：`R2`（明确**不属于**本轮契约决定）

> ★ 本节的存在意义：防止「C-3 契约已裁定 ⇒ C-3 已全部关闭」这一**过强推论**。

| 项 | 内容 |
|---|---|
| 真工作项 | `evaluateDataHealth()` 的**分类口径**：`REQUIRED_FEATURES`（15 项）把**语义可空**字段（`sideway_range`）与**硬必填**统计量混为一类 ⇒ `nullish.length > 0 ⇒ DATA_DEGRADED / STATISTICAL_MISSING` ⇒ **假阳性降级** |
| 机制（实测） | `gen1-data-health.js:35-39`（15 项单一集合）+ `:66-68`（`nullish` 基数判定）+ `:117-120`（第 ⑥ 步） |
| 传导 | `DATA_DEGRADED` → `computeHealthStatus`（`gen1-circuit-breaker.js:62`）= `HEALTH.DEGRADED` → `circuitGate` 关闭 `allow_canary` ⇒ 健康门 `OK`∧`ACTIVE` 不可达 ⇒ **`C-1` 不可达** |
| 变更面（**设计意图 · ⛔ 未实施**） | `src/common/utils/gen1-data-health.js`（拆分「硬必填」+「语义可空」两集合；第 ⑥ 步改为对硬必填取 `nullish` 基数） |
| 是否触碰 FROZEN | ⛔ **不触碰**（该文件 ∉ `GEN1_FEATURE_PIPELINE_LOCK.json` 的 4 个绑定文件） |
| 边界（★ 逐字沿用） | `R2 = 规格 / 口径修正` · `R2 ≠ 功能已修复` · `R2 ≠ 已授权` |
| 授权状态 | ⛔ **未授权实施**（`C3_R2_AUTHORIZED = NO`） |

⚠️ **不得过度归因**：C-2 latch 自 `09-21` 起为 `DEGRADED`，其**历史成因**本轮**未证明**（窗口归属不可判定）；本节只主张「`sideway_range` 语义空值是**当前**降级的一个**已实测**贡献项」，⛔ 不主张它是唯一成因。

---

## §2 D-2 · C-2：Release Architecture Decision（**仅设计 · 未实施**）

> ⛔ 本节为**方案文本**；⛔ 不构成授权；⛔ 未修改 `adminGateway` / 未新增路由 / 未写 DB。

### §2.1 冻结事实复核

| 事实（owner 给定） | 本轮复核 | 证据 |
|---|---|---|
| `runGen1ShadowEod` = `TRIGGER_TIMER` | ✅ `Type: timer` · `cron 0 20 22 * * 1-5 *` · `TriggerName gen1-eod-weekdays-2220` | `online-meta`（`N-8`） |
| 无交互输入面 | ✅ `index.js` 无 HTTP/事件入参处理；唯一调用形态为定时触发 | `repo-src` |
| `manualReviewConfirmed` production callers = 0 | ✅ 全仓 6 处命中：定义/参数/**单测**，**生产调用方 0** | `repo-src` |
| `applyHealthWithRecovery` callers = 0 | ✅ 命中：定义（`gen1-circuit-breaker.js:119`）、导出（`:146`）、**单测** ⇒ 生产调用方 0；且函数头标注 `⚠️ DEPRECATED` | `repo-src` |
| `adminGateway` 无合法 release write route | ✅ 路由面实读：`/api/admin/gen1/health` **仅 GET**（`getGen1Health`）；无任何 health 写路由 | `repo-src` |
| `scripts` 无现成 manual release authority | ✅ 三个 `promote-*.js` 均写 `param_config`，**无一具备 release 语义**（见 §2.2） | `repo-src` |

### §2.2 ★ owner 指定必答：「`C` 到底是一个真实的 governance channel，还是仅仅是一个 production mutation utility？」

> **裁定：`C` 现在是 `production mutation utility`。它持有一个「治理指定（designation）」，但不具备「治理能力（capability）」。**
> ⛔ **不得因为它能写 DB，就认为它具备 release authority。**

**逐字段证据（6 项，全部实测）**：

| # | 审计要素 | `scripts/promote-*.js` 实测 | 判定 |
|---|---|---|---|
| 1 | **actor / reviewer identity** | 凭据来自 `~/.config/.cloudbase/auth.json` 的 `secretId` / `secretKey`（脚本内 `loadCred()`）—— **机器凭据**，且脚本**无任何 operator 字段** | ⛔ **无自然人身份** |
| 2 | **reason** | 仅静态 `description` 文案（如 `DESCS[k]` 的固定中文串），**无枚举 `reason_code`** | ⛔ **无** |
| 3 | **evidence reference** | 全脚本无证据引用参数 | ⛔ **无** |
| 4 | **previous / new state** | 三个脚本**均不写 `prev_value`**；且 `promote-v361-cutover.js:54` 与 `promote-ml-shadow-observe.js:61` **硬编码 `version: 1`** ⇒ `version` **不是单调序列**，不能充当审计序号 | ⛔ **无（且字段语义不可靠）** |
| 5 | **authority decision** | 脚本**不 require** `gen1-authority.js`，**不查** `FROZEN_PARAM_KEYS` ⇒ 经 SDK **绕过** `adminGateway.updateParam` 的冻结拒写 | ⛔ **无（且具绕过性）** |
| 6 | **correlation / request id** | 无 | ⛔ **无** |
| ★ | **反向对照** | 同一个 `param_config` 若走 `adminGateway.updateParam`（`index.js:607+`），**有** `prev_value: old.value` + `version = (old.version \|\| 0) + 1` | ★ **管理后台路径的留痕强于 promote 脚本路径**（反直觉但实测成立） |

**★ 「治理指定」的来源与落差**：

`src/common/constants.js:61-74`（`FROZEN_PARAM_KEYS`）注释逐字：

> 「提权 / 回退一律走**专门、可审计**的 promotion 脚本（`scripts/promote-*.js` 一类，直连写库且留痕），不得从普通参数编辑器切换。」

| 项 | 内容 |
|---|---|
| 该注释**要求**什么 | ① 专门通道；② **可审计**；③ 直连写库且**留痕** |
| 实现**提供**什么 | ① 专门通道 ✅；② 可审计 ⛔（0/6 审计要素）；③ 留痕 ⚠️（仅 `updated_at`；且 2/3 的 `version` 非单调） |
| 结论 | ★ **「可审计」是一项已被治理文档声明、但未被实现兑现的承诺** ⇒ 这是 `C2_REQUIRED_AUDIT` 缺口的**根因**，也是一条**独立可登记的治理落差**（`GOV-GAP-C`） |

**⇒ 直接回答**：`C` **不是**真实的 governance channel。它是一个**被治理文档指定为治理通道、但实际只具备变异能力**的 utility。要使其成为真实通道，必须补齐 §2.5 的 R1–R8 与 §3 的 8 字段 —— ⛔ **本轮不做**。

### §2.3 既有可复用机制盘点（owner 指定：authority / approval / review / audit / promotion）

| 机制 | 是否存在 | 证据（实测） | 可复用性 |
|---|---|---|---|
| **authority** | ✅ 存在 | `src/common/utils/gen1-authority.js`：`AUTHORITY` 六档枚举 + `AUTHORITY_RANK` + `PRODUCTION_LOCKED = true` + `authorityAllows()` | ✅ **必须复用**（⛔ 不得绕） |
| **approval** | ⚠️ 仅**制品级**，无通用机制 | `deliverables/v365-production-history/c021/authorization-ratification.json` 的 `APPROVAL_MANIFEST_SHA256` / `AUTHORIZATION_SCOPE_RATIFIED_BY_OWNER` —— ⛔ **且该目录不在 git**（§3.3） | ⚠️ **模式可借鉴**（sha256 绑定 + owner_message），**机制不可复用** |
| **review** | ✅ **部分内建** | `gen1_health_state` 文档含 `reviewed_at` / `reviewed_by`（`gen1-health-state.js:62-63`，且 `:142-143` 在分支①写入） | ✅ 可复用「谁/何时」 |
| **audit** | ⛔ **不存在** | 全仓 grep `audit_log` / `operation_log` / `admin_log`：唯一命中 `admin_login_guard`（**登录失败计数守卫**，非审计日志）；无 admin 操作日志集合 | ⛔ 需补（见 §3） |
| **promotion** | ✅ 形态存在（3 个） | `promote-v361-cutover.js` / `promote-gen1-advisory.js` / `promote-ml-shadow-observe.js` | ⚠️ 有**形态先例**、无**治理能力**（§2.2） |
| **immutable evidence（git-tracked）** | ✅ 存在 | `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json` —— `git ls-tree` **命中** ⇒ **确在 git 内** | ✅ ★ **审计落点最佳先例**（§3.4） |

### §2.4 feasibility matrix（owner 指定 12 维 × `A+B` / `A+C`）

**方案定义（逐字）**：

```text
A = 现有 timer 保持自动检测 / 状态写入（runGen1ShadowEod → computeLatchedState）
B = 新增最小 admin release route
C = 复用或扩展已有 promotion / governance channel
```

**★ 组合定义（本件 checker 断言的锚点）**：

```text
**A+B** = A（timer 保持自动检测/状态写入） + B（新增最小 admin release route）
**A+C** = A（timer 保持自动检测/状态写入） + C（复用或扩展既有 promotion / governance channel）
```

**矩阵**：

| Dimension | **A+B** | **A+C** |
|---|---|---|
| 人工输入面 | ✅ 会话内 HTTP 请求（有交互面，可二次确认） | ✅ CLI（本地终端；有交互面但**无服务端兜底**） |
| authority enforcement | ✅ 服务端强制（可复用 `authorityAllows()` / `healthStateToGate()`） | ⚠️ 须在脚本内**新增**引用（当前 **0 处**引用）；⛔ 无服务端兜底 |
| auditability | ✅ 服务端可**强制**写审计（不可被调用方跳过） | ⚠️ 依赖脚本自律；当前 **0/6** 要素 |
| reviewer identity | ✅ 会话身份（复用 `admin_password` / `admin_token` 登录态 + `admin-auth.js`） | ⛔ 仅机器凭据（`secretId` / `secretKey`）⇒ **无自然人身份** |
| reason / evidence | ✅ 请求体枚举 `reason_code` + `evidence_ref`，服务端校验 | ⚠️ 须脚本参数化（当前仅静态 `description`） |
| replay | ✅ 服务端重算 `computeLatchedState` + 反事实断言（若未确认则应仍为 `DEGRADED`） | ⚠️ 可本地重算，但**无服务端留证强制** ⇒ 复算依赖自律 |
| rollback | ✅ 服务端可回写释放前快照 | ⚠️ 同（须脚本显式实现） |
| anti-bypass | ★ **最强**：鉴权中间件 + 服务端强制重算 + 服务端置位 + 冷却期 + 审计不可关闭 | ★ **最弱**：SDK 直写 ⇒ **可绕过** `FROZEN_PARAM_KEYS` 与路由鉴权（§2.2 #5） |
| DB write | 1 次状态写（+ 审计落点） | 1 次状态写（+ 审计落点） |
| API surface | ⚠️ **+1 路由**（面扩张） | ✅ **零新增路由** |
| 与现有 governance 一致性 | ⚠️ 无先例（`adminGateway` 从无 gen1 health 写路由） | ✅ **有治理指定**（`FROZEN_PARAM_KEYS` 注释指名 `promote-*.js`） |
| 新增复杂度 | ⚠️ 中（路由 + 鉴权 + 审计 + 部署） | ✅ 低（单脚本） |
| 现有代码复用 | ✅ 高（复用 `adminGateway` 鉴权/DB 层 + `computeLatchedState`） | ⚠️ 中（复用 `promote-*.js` 骨架 + `computeLatchedState`；**鉴权面须从零建**） |
| ★ **零部署能力** | ⛔ **需部署 `adminGateway`**（且须先裁定分叉起点 —— 见姊妹件 `P5`） | ✅ **零部署** |
| ★ **权威审计落点可达性** | ⚠️ **运行时无法写 git** ⇒ 须追加**只读导出步骤**（DB 记录 → git artifact），否则审计只剩 DB 记录（不可 git 复算） | ✅ **脚本本地运行 ⇒ 可原生产出 git artifact**（§3.4 的落点） |

> ★ **关键洞察（写入 `C2_REQUIRED_AUDIT`）**：**审计落点的选择与执行面强耦合。** §3.4 选定的权威审计落点是 **git-tracked append-only artifact**；`A+C` 可**原生**产出它，`A+B` 则**必须**追加一条只读导出，否则审计没有可 git 复算的落点。

### §2.5 最小契约（不变量 —— `A+B` 与 `A+C` **都必须满足**）

```text
C2_MINIMAL_CONTRACT
  R1  发起面：仅「服务端（B）」或「受控脚本（C）」可发起；⛔ 不接受请求体透传 manualReviewConfirmed
  R2  前置四条件：① latched_health ∈ {DEGRADED, ML_OFF}；② 服务端/脚本侧重算得 incoming ∉ {DEGRADED, ML_OFF}；
      ③ manual_review_required === true；④ 距 degraded_at / ml_off_at ≥ 冷却期（复用 cooldown.js）
  R3  唯一允许迁移 = 分支①（release）；目标态 = incoming ∈ {OK, WARNING}；⛔ 不引入代码中不存在的 HEALTHY
  R4  「已恢复」判据 = !isDown(latched_health)；⛔ 不得用 recovery_allowed=true（实测为瞬时值）
  R5  authority 必须显式校验；★ 恢复 ≠ 升档（gen1_authority 保持不变，仍 CANARY）
  R6  审计 8 字段（§3.1）必须落 §3.4 的权威落点；⛔ updated_at 不算审计
  R7  释放前必须先取快照；★ 无 snapshot 不得释放
  R8  ⛔ 禁自动恢复 / 定时释放 / env-config 覆写 / DB 直写绕过
```

### §2.6 输出（owner 指定 6 项）

```text
C2_ARCHITECTURE_OPTIONS_COMPLETE = YES
C2_MINIMAL_CONTRACT   = R1..R8（见 §2.5）：发起面受控 + 四条件 + 唯一迁移 + 瞬时值不判据
                        + authority 显式 + 审计 8 字段 + 快照前置 + 反绕过
C2_REQUIRED_AUTHORITY = 复用 gen1-authority.js（authorityAllows / PRODUCTION_LOCKED）
                        + healthStateToGate()；★ 且必须有「可指认的自然人身份」落入审计
C2_REQUIRED_AUDIT     = §3.1 的 8 字段 + §3.4 的权威落点；★ 落点与执行面耦合（§2.4 末行）
C2_REQUIRED_STATE_TRANSITION = 仅分支①：latched_health := incoming；
                        manual_review_required := false；degraded_at := null；ml_off_at := null；
                        recovery_applied = true；reviewed_at := now；reviewed_by := <会话身份>
C2_IMPLEMENTATION_SURFACE
  A+B → cloudfunctions/adminGateway/index.js（+1 route + handler + 审计写） + 部署 + 审计导出步骤
  A+C → scripts/promote-gen1-health-release.js（新脚本，复用 promote-*.js 骨架） + 审计 artifact 写出
```

**⛔ 明确不做**：
- ⛔ **不排名、不自行选型**（`A+B` 与 `A+C` 均为**可行形态**，选型留 owner）；
- ⛔ 不在本轮新增路由 / 修改 `adminGateway` / 新增脚本 / 部署任何函数；
- ⛔ 不引入自动恢复 / 定时释放；
- ⛔ 不通过 DB 直写「绕过」实现释放；
- ⛔ **不为了验证 release contract 而真的执行 release**（只做静态验证）。

---

## §3 D-3 · `AUDIT_CARRIER_LOCUS` 最终裁定

### §3.1 审计职责的 8 字段（owner 指定）

| # | 字段 | 语义 |
|---|---|---|
| 1 | `actor` | **谁**执行了 release decision（必须是**可指认的自然人/会话身份**） |
| 2 | `timestamp` | **何时** |
| 3 | `previous_state` | 释放前 latch 快照 |
| 4 | `new_state` | 释放后 latch |
| 5 | `reason` | **为何**（**枚举**，⛔ 非自由文本） |
| 6 | `evidence_reference` | **基于什么 evidence** |
| 7 | `authority_decision` | 以**什么 authority**（判定结果**必须落记录**，⛔ 不能只算不记） |
| 8 | `correlation/request id` | 关联 id（可与调用日志对齐） |

> ★ **反例纪律（owner 明令）**：⛔ **不得把 `updated_at` 当审计。** 它只回答「何时被写过」，**不回答**「谁、以什么 authority、基于什么 evidence、改了什么」。

### §3.2 载体盘点（owner 指定 6 类 · 存在/不存在均给证据）

| # | 载体 | 存在? | 实测证据 | 可承载字段 | 是否承担审计职责 |
|---|---|---|---|---|---|
| 1 | **promotion script fields** | ✅ 形态存在 | 写入 `param_config`；字段集 = `key` / `value{v}` / `description` / `category` / `version` / `updated_at`；**promote 脚本不写 `prev_value`**，且 2/3 **硬编码 `version: 1`** | 1（弱 timestamp） | ⛔ **否**（§2.2） |
| 2 | **CloudBase logs（CLS）** | ✅ 存在 | `tcb logs search` 通道：`request_id` / `request_source` / `status_code` / `log` | 2（timestamp + correlation 部分） | ⚠️ **仅旁证**（保留期有限、无业务结构化字段） |
| 3 | **admin operation logs** | ⛔ **不存在** | 全仓 grep：`audit_log` / `operation_log` / `admin_log` **零命中**；最接近者 `admin_login_guard` 是**登录失败计数守卫**（`adminGateway/index.js:291-394`） | — | ⛔ **否** |
| 4 | **DB audit collection** | ⛔ **不存在** | `src/common/constants.js` 集合清单无任何 audit 集合；`adminGateway` 写面 = `PARAM_CONFIG` / `FUNDAMENTAL_*` / `RISK_EVENTS` / `FETCH_LOG` / `TRADE_LOG` | — | ⛔ **否**（新增集合 = **面扩张**，须单独授权） |
| 5 | **immutable evidence** | ⚠️ **两处，必须分开** | (a) `deliverables/**` ⇒ **`.gitignore:23` ⇒ 不在 git**；(b) `docs/gen1/artifacts/**` ⇒ `git ls-tree` **命中 ⇒ 在 git ✅** | 全 8 字段**可表达** | ✅ **承担**（取 (b) 形态） |
| 6 | **Git / deployment records** | ✅ 存在 | tag 注解 `v3.6.5-frozen`（含 `authorization` / `base_head_sha` / bundle sha）；`docs/production-deployment-ledger.md`（append-only，**入 git**） | ★ `authority_decision` + sha 绑定 | ✅ **承担「authority_decision」字段的范式来源** |

### §3.3 ★ 对本轮前件的**更正**（`deliverables/**` 并不在 git 内）

| 前件写法 | 本轮更正 | 证据（实测） |
|---|---|---|
| 「`deliverables/v365-production-history/c021/**` … 18 件 JSON + sha256 绑定，**入 git**」 | ⛔ **更正**：`.gitignore:23` = `deliverables/`；`git log --all --diff-filter=A -- '**/c021/**'` = **0**；`git check-ignore` **rc=0（命中忽略规则）** ⇒ **从未进入任何 commit** | `git-tracked-check` |
| 推论 | 该目录是**单机本地、gitignored、非 remote-visible、不可跨机验证**的制品面 ⇒ ⛔ **不可作权威审计落点** | — |
| 反向对照（哪个才在 git 内） | `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json`：`git ls-tree -r --name-only HEAD docs/gen1/artifacts/` **命中**；`git check-ignore` **rc=1（未被忽略）** | ✅ |

★ **副产物更正**（移交姊妹件）：`GAP-P1` 中「09-30 部署仅存于 tag 注解 + `c021/**`」应更正为「**仅存于 tag 注解**」—— 因为 `c021/**` **不在仓库内**，不构成仓库级事实源。

### §3.4 裁定：`AUDIT_CARRIER_LOCUS`

```text
AUDIT_CARRIER_LOCUS = docs/gen1/artifacts/**（git-tracked，append-only JSON + sha256 绑定）
                    + gen1_health_state.reviewed_at / reviewed_by（状态内建「谁 / 何时」的就地记录）
```

**为何是它（逐条）**：

| # | 理由 | 证据 |
|---|---|---|
| 1 | ✅ **唯一确证在版本控制内的 append-only 证据面** | `git ls-tree` 命中；`deliverables/**` 反之（§3.3） |
| 2 | ✅ **有既有范式**：`GEN1_EVIDENCE_FREEZE_SEAL_V6.json` 已示范「sha256 绑定 + `authority` 字段 + `as_of` + 单一来源声明」 | `governance-artifact` |
| 3 | ✅ **可承载全 8 字段**（JSON 自由 schema） | — |
| 4 | ✅ **零 DB schema 变更 / 零新集合**（⛔ 不触面扩张） | `constants.js` 集合清单无需改 |
| 5 | ✅ **可复算 / 可 remote-visible**（推送后） | `git-tracked-check` |
| 6 | ⛔ **排除**：`deliverables/**`（不在 git）；新 DB 集合（面扩张 + 须单独授权）；CLS 日志（仅旁证） | §3.2 |

**明确缺口（现有载体缺什么 —— ⛔ 不为补字段而立即改生产）**：

| 字段 | 现状 | 缺口 |
|---|---|---|
| `actor` | `gen1_health_state.reviewed_by` ✅（就地） | 审计 artifact 需**复记一份**（单一落点原则） |
| `timestamp` | `reviewed_at` ✅ / `updated_at` ⚠️（⛔ 不算审计） | 审计行需**独立** timestamp |
| `previous_state` | ⛔ **无** | 释放前快照 ⇒ 写入 artifact |
| `new_state` | ⛔ **无**（`latched_health` 是「当前值」，非「变更记录」） | 同上 |
| `reason` | ⛔ **无枚举** | 需新增枚举 `reason_code` |
| `evidence_reference` | ⛔ **无** | 需新增引用（`ml_shadow_signal{code,date}` 或诊断工件 id） |
| `authority_decision` | ⛔ **无**（`authorityAllows()` 结果**不被记录**） | 需记录判定结果 |
| `correlation id` | ⛔ **无** | 需新增 |

⇒ `AUDIT_CARRIER_IDENTIFIED = YES` · `AUDIT_CARRIER_LOCUS_CHOSEN = YES`（★ 本轮**已选定**，与前件的 `NO` 不同）

### §3.5 ★ 与 C-2 选项的耦合（必须写明）

| 选项 | 审计可否原生闭环 |
|---|---|
| **A+C** | ✅ 可**原生**闭环（脚本本地执行 ⇒ 可直接产出并提交 git artifact） |
| **A+B** | ⚠️ **不可原生**闭环（运行时不能写 git）⇒ **必须**追加一条**只读导出**（DB 记录 → git artifact），否则审计没有可 git 复算的落点 |

> ★ 结论：**`AUDIT_CARRIER_LOCUS` 的可行性构成对 `A+B` 的一项额外约束**。⛔ 但本件**不因此排名或选型**（⛔ 选型仍留 owner）。

### §3.6 ⛔ 不实施

⛔ 本件不新增审计集合 · ⛔ 不写任何审计行 · ⛔ 不改 `gen1_health_state` schema · ⛔ 不新增路由 · ⛔ 不新增脚本。

---

## §4 边界与 STOP

**本 Gate 实测零动作**：`PRODUCTION_WRITE = 0` · `DB_WRITE = 0` · `DEPLOY = NO` · `AUTHORITY_CHANGE = NO` · `CANARY = OFF` · `EVIDENCE_EXECUTION = NO` · `GE04 = NO`

**⛔ 边界声明**：
- 本件与姊妹件均为**只读审计/设计件**；
- ⛔ 未改 production code / config / DB / manifest / lock / authority / selector / active pointer / read path；
- ⛔ 未部署 / 未回滚 / ⛔ 未打 tag / ⛔ 未推送到远端 / ⛔ 未合并；
- ⛔ 未新增云函数路由；⛔ 未新增 DB 集合；⛔ 未改既有闸门（含 `v6_negative_scan.py`）；
- ⛔ **未为了验证 release contract 而真的执行 release**（仅静态验证）。

**⛔ 实施授权声明**：
- 本件所有「最小契约 / 可行性矩阵 / 落点选项 / 实现面」均为**文本**，⛔ **不构成实施授权**、⛔ **不代表已获授权**；**设计文本 ≠ 授权文本**；
- **放行口令（owner 逐字形态）**：`AGENT IMPLEMENTATION AUTHORIZED` —— ⛔ 截至本件落笔该口令**未出现**，故 `IMPLEMENTATION_AUTHORIZED = NO` 继续成立；
- ⛔ 收尾条件：除非 Owner 后续明确给出 `AGENT IMPLEMENTATION AUTHORIZED`，否则**不得修改 production 或进入实现**。

```text
C3_STATUS                        = RECLASSIFY
C3_OLD_CLAIM                     = RETRACTED
C3_CONTRACT_DECISION             = C3-A
C3_R2_AUTHORIZED                 = NO
C2_ARCHITECTURE_OPTIONS_COMPLETE = YES
C2_A_PLUS_B                      = ANALYZED
C2_A_PLUS_C                      = ANALYZED
C2_AUTHORITY                     = EXPLICIT
C2_AUDIT                         = EXPLICIT
C2_STATE_TRANSITION              = EXPLICIT
C2_RELEASE_CONTRACT_IMPLEMENTED  = NO
AUDIT_CARRIER                    = EXPLICIT
AUDIT_CARRIER_LOCUS              = DOCS_GEN1_ARTIFACTS
AUDIT_CARRIER_LOCUS_CHOSEN       = YES
IMPLEMENTATION_AUTHORIZED        = NO
PRODUCTION_WRITE                 = 0
DB_WRITE                         = 0
DEPLOY                           = NO
AUTHORITY_CHANGE                 = NO
CANARY                           = OFF
EVIDENCE_EXECUTION               = NO
GE04                             = NO
STOP                             = YES
```

**说明（在代码块之外，⛔ 不并入 STOP 字段域）**：
- `C3_STATUS = RECLASSIFY` 的去向见 §1.6（`C3-γ → R2`、`C3-δ → OBS`）；⛔ 不得读作「C-3 已全部关闭」。
- `AUDIT_CARRIER_LOCUS = DOCS_GEN1_ARTIFACTS` 的**完整路径** = `docs/gen1/artifacts/**`（见 §3.4）；此处用单 token 以保持机器可断言。
- `C2_A_PLUS_B` / `C2_A_PLUS_C` 均为 `ANALYZED`，**⛔ 不表示已选定**；选型留 owner。
- `C2_RELEASE_CONTRACT_IMPLEMENTED = NO` 与 `IMPLEMENTATION_AUTHORIZED = NO` 同时成立：**设计完成 ≠ 实施授权**。
