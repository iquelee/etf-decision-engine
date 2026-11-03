# GEN1_D1_D2_DECISION_20261003 — Owner Decision D-1 / D-2 / D-3 / D-4 / D-5 收口件

> 生成时间：**2026-10-03**（GMT+8）· 轮次：`Owner Decision`（**只读设计轮**）
> 前件：`GEN1_C3_C2_PREFLIGHT_20261003.md`（carrier commit `16f90c2`）· 姊妹件：`ONLINE_DEPLOYMENT_PROVENANCE_20261003.md`
> 性质：⛔ **本件不构成实施授权**、⛔ 不代表已修改任何 production 对象、⛔ 未进入 coding。
> ★ 「能实现」 ≠ 「已授权实现」。

---

## §0 方法与证据分级

| 等级 | 含义 |
|---|---|
| `online-db` | 2026-10-03 实时只读（`probe_q.py` → 归档 `probe_<collection>_20261003_<purpose>.json`；⛔ 不覆盖共享 fixture） |
| `online-codeinfo` | 2026-10-03 实时只读 `tcb fn detail --json` 的 `CodeInfo` |
| `repo-src` | 工作区源码（`src/common/utils/**`、`cloudfunctions/**`、`scripts/**`） |
| `git-object` | `git log --all --find-object` + 逐 commit `show` 对拍 |
| `governance-artifact` | `docs/production-deployment-ledger.md` · `deliverables/v365-production-history/c021/**` · `refs/tags/**` |
| `NOT RE-READ` | 明确未在本轮重读 |

**本周新增取证归档（仓库外，⛔ 不入库）**：`_cb-connect-20260921/codeinfo_20261003/`（10 函数线上 `index.js` + `fndetail_*.json`）· `probe_param_config_20261003_auditcarrier.json`。

---

## §1 D-1 裁定：C-3 方案 A（R2 口径修正）

### §1.1 `C3_R2_DEFINED`

> **C3_R2_DEFINED** —— C-3 的**权威表述**，自本件起生效：

> **数据健康诊断已经产生并落库，但细粒度缺失原因没有进入权威 runtime health/latch 载体，因此需要重新裁定 health contract 是否需要暴露该信息。**

拆解为可判定子句：

| # | 子句 | 判据 | 实测 |
|---|---|---|---|
| C3-a | 「诊断已产生」 | `evaluateDataHealth()` 产出 `DATA_DEGRADED/STATISTICAL_MISSING` | ✅ `gen1-data-health.js:57` |
| C3-b | 「已落库」 | `missing_features` 存在于 `ml_shadow_signal` | ✅ 线上只读实读：`515880` 09-30 S2 = `["sideway_range"]`；`159582` 09-28/24/23/22/21 S2 同 |
| C3-c | 「未进入权威 health/latch 载体」 | `gen1_health_state` 与 `runtime_status` **均无** 明细字段 | ✅ 线上实读：`gen1_health_state` 无 `missing_features`；`runtime_status` 无 `missing_features`、**无 data_health 分项** |
| C3-d | 「需重新裁定 health contract 是否暴露」 | 这是**契约议题**，不是代码缺陷议题 | ★ 本轮结论（见 §1.4 Q3–Q7） |
| C3-e | ★ **交付形态 = R2 规格/口径修正** | 修改面落在 `gen1-data-health.js`（∉ `GEN1_FEATURE_PIPELINE_LOCK` 的 4 个绑定文件） | ✅ `GEN1_FEATURE_PIPELINE_LOCK.json` 实读 |

### §1.2 `C3_OLD_CLAIM_RETRACTED`

> **C3_OLD_CLAIM_RETRACTED** —— 以下旧表述**正式撤回**，⛔ 不得再作为工作依据：

| 旧表述 | 状态 | 撤回依据（实测） |
|---|---|---|
| 「C-3 = `515880` 的 `missing_features` **产出但未落库**」 | ⛔ **RETRACTED（部分证伪）** | `ml_shadow_signal.missing_features` **线上确实落库**（§1.1 C3-b）。**「落库修复」不存在** |
| 「C-3 的修复 = 让缺失特征写进数据库」 | ⛔ **RETRACTED** | 同上；该项**已是既成事实** |
| 「C-3 的根因是数据管线/统计口径故障」 | ⛔ **RETRACTED** | 根因 = **语义性空值**：`calcSidewayDays` 返 `0`（`bars<20` 或 横盘天数 `< sideway_days_min=8`）⇒ `calcSidewayRange` 的 `if (!sidewayDays \|\| sidewayDays < 1) return null;` ⇒ `sideway_range = null`。**非故障，是语义** |

> ⛔ **明文禁令**：**不得为了满足旧 Gap 描述而制造一个不存在的「落库修复」**。任何以「补落库」为名的改动都属于**伪修复**，应予拒绝。

### §1.3 R2 的边界（★ 必读）

```text
R2 = 规格 / 口径修正（spec-level）
R2 ≠ 功能已修复（NOT FIXED）
R2 ≠ 已授权（NOT AUTHORIZED）
```

- 本件**只定义**口径修正的目标语义与变更面；**⛔ 未修改任何代码、⛔ 未授权实施**。
- `IMPLEMENTATION_AUTHORIZED = NO`（见 §5）。

### §1.4 owner 7 问逐项回答

> 每题先给**结论**，再给**判据**，最后给**反例边界**（避免被读成过强断言）。

---

#### Q1 · C-3 是否仍然是 production blocker？

**结论：分轴回答，两轴答案相反。**

| 轴 | 是否 blocker | 判据 |
|---|---|---|
| **生产决策运行**（V3.6.5 / `runDecisionEngine`） | ⛔ **不是** | Gen-1 全链 `gen1_adopted=false`、`selector_source=BASELINE`、`gen1_production_write=false`、`gen1_auto_execution=false` ⇒ Gen-1 健康状态**不参与** `final_target` |
| **Gen-1 升级路径**（`GEN1_IN_DECISION_CHAIN`） | ✅ **是**（**阻塞**） | C-3 未决 ⇒ `C-1`（health 正控 `OK`∧`ACTIVE`）不可达 ⇒ `A-1` 双通道（`health_allows_guarded` / `canaryS4Rerun`）**全关** |

**反例边界**：⛔ 不得表述为「系统坏了」。线上生产链**正常**；被阻塞的是 **Gen-1 的准入**。

---

#### Q2 · 如果仍是 blocker，阻塞的真正对象是什么？

**结论：阻塞对象 = 「health 契约的语义完整性」，不是数据、不是计算、不是落库、不是权限。**

| 候选对象 | 是否阻塞 | 判据 |
|---|---|---|
| 数据获取失败 | ⛔ 否 | `515880` 当日 K 线可用；`missing_features` 唯一项 = `sideway_range` |
| 特征计算失败 | ⛔ 否 | `calcSidewayRange` 是**按设计**返回 `null`（`sidewayDays < 1`） |
| 落库失败 | ⛔ 否 | 明细**已落库**（C3-b） |
| 权限/凭据 | ⛔ 否 | 与 authority 轴无关 |
| ★ **health 契约语义** | ✅ **是** | `REQUIRED_FEATURES`（恰 15 项，`gen1-data-health.js:35-39`）**把语义可空字段与必填统计量混为一类**；`nullish.length > 0 ⇒ DATA_DEGRADED/STATISTICAL_MISSING` ⇒ **假阳性** |

**精确机制**：`evaluateDataHealth()` 的第 ⑥ 步用 `missing = absent ∪ nullish` 的**基数**判定降级，未区分「缺数据」与「该字段在本语义下无意义」。

---

#### Q3 · `gen1_health_state` 是否应该携带 `missing_features`？

**结论：不应（携带明细）；但应携带「引用」。**

| 判据 | 说明 |
|---|---|
| ① 单一职责 | `gen1_health_state` 的语义是**门**（是否允许 guarded），不是**诊断面板** |
| ② 基数不匹配 | 它是**单文档状态**（`key='gen1-health-state'`）；`missing_features` 是**逐标的 × 逐日**维度 ⇒ 装入即产生**写放大 + 覆盖语义混淆** |
| ③ ★ 治理风险 | latch 携带明细会**诱使 gate 判定读明细** ⇒ 把「诊断」变成「判定输入」⇒ 削弱 fail-closed 的可审计性（= OD-3，见 Q7） |
| ④ 已有替代 | `ml_shadow_signal.missing_features` 已承担该职责（Q6） |

**反例边界**：⛔ 本结论**不**意味着「health 层不该知道原因」—— 它应该持有**可跳转的引用**（见 Q4/Q5）。

---

#### Q4 · 是否应该让 `runtime_status` 携带细粒度原因？

**结论：应携带「摘要级原因码 + 引用」，**不应**携带逐标的明细。**

| 设计要点 | 内容 |
|---|---|
| 应有 | ① 一个**枚举式**原因码；② 一个**稳定引用**（指向诊断载体的键，如 `{date, code}` 集合或 run 轴 id） |
| 不应有 | ⛔ 逐标的数组（会把 `runtime_status` 变成明细表副本） |
| ★ **关键实测** | `runtime_status` **已有** `gen1_health_read_reason_code`（本轮实测值 = `null`）与 `gen1_health_source = GEN1_HEALTH_STATE_LATCH` ⇒ **载体字段已存在，缺的是「填充语义」，不是「新字段」** |

**反例边界**：⚠️ `runtime_status` 是**覆盖式单例**（末次写入者胜）⇒ 其上的原因码**只能表示末态**，⛔ 不可外推「每次运行都是这个原因」。

---

#### Q5 · 哪个载体才应该成为权威状态源？

**结论：分层，不是单一。**

| 层 | 权威载体 | 职责 | 本轮实测 |
|---|---|---|---|
| **门（gate）权威** | `gen1_health_state`（单文档 latch） | 是否允许 guarded；`latched_health` / `manual_review_required` / `recovery_allowed` | ✅ `DEGRADED` · `manual_review_required=true` · `recovery_allowed=false` · `degraded_at=2026-09-21T14:20:27.241Z` |
| **诊断（why）权威** | `ml_shadow_signal.missing_features` | 逐标的逐日缺失明细 | ✅ 已落库 |
| **对外投影** | `runtime_status.gen1_health_*`（字段组） | 摘要 + 引用；供前端/其它消费者 | ⚠️ **是投影，⛔ 不是权威源** |

> ★ **判定**：⛔ **不得**让 `runtime_status` 成为任何 gate 判定的唯一依据；gate 判定必须以 `gen1_health_state` 为准。

---

#### Q6 · 现有 `ML_SHADOW_SIGNAL` 是否已足够承担诊断 evidence，而不应该复制到 health state？

**结论：是，已足够。**

| 判据 | 实测 |
|---|---|
| 明细可只读获得 | ✅ `515880` 09-30 S2 = `DATA_DEGRADED` / `STATISTICAL_MISSING` / `missing_features ["sideway_range"]` |
| 覆盖到受影响标的 | ✅ `515880`（09-30、09-29）· `159582`（09-28/24/23/22/21） |
| 健康态可交叉核对 | ✅ 同期 `513310` / `518880` / `159570` = `DATA_OK` / `missing_features []` |
| 是否需要复制 | ⛔ **不需要**。需要的是 **(a) 口径修正（消假阳性）**+ **(b) 一条从 health 层指向诊断载体的引用链** |

---

#### Q7 · 是否存在「为了展示诊断信息而污染健康状态」的过度设计风险？

**结论：存在。这是本轮最重要的排除项。**

| # | 过度设计形态 | 为何排除 |
|---|---|---|
| **OD-1** | 把 `missing_features[]` 写进 `gen1_health_state` | 状态载体被明细污染 ⇒ 单文档覆盖语义与逐标的数组冲突（同 Q3 ②） |
| **OD-2** | 为「看诊断」新增独立 health 诊断集合 | 与 `ml_shadow_signal` 重复；制造第二个真相源 |
| **OD-3** | 让 gate 判定**读明细**（如「仅当缺失项在白名单内才 DEGRADED」） | ★ 把判定逻辑搬进数据 ⇒ **口径修正退化为运行时动态放宽** ≙ owner 本轮明令禁止的「被检方自行放宽判定闸门」同型 |
| **OD-4** | 把 `runtime_status` 扩成「每标的一行」 | 破坏单例语义；前端契约连带变更 |

---

### §1.5 D-1 交付边界

| 项 | 值 |
|---|---|
| 采用方案 | **A**（R2 口径修正） |
| 变更文件（**设计意图，⛔ 未实施**） | `src/common/utils/gen1-data-health.js`（`REQUIRED_FEATURES` 拆分为「硬必填」+「语义可空」两集合；第 ⑥ 步判定改为对**硬必填**取 `nullish` 基数） |
| 是否触碰 FROZEN | ⛔ **不触碰**（该文件 ∉ `GEN1_FEATURE_PIPELINE_LOCK` 的 4 个绑定文件） |
| 是否触碰 `ml/manifests/**` | ⛔ **否**（⇒ 无需重签任何 manifest） |
| 授权等级 | **R2** |
| ★ 状态 | `C3_R2_DEFINED = YES` · `C3_OLD_CLAIM_RETRACTED = YES` · **`C3_R2_AUTHORIZED = NO`（未授权实施）** |

---

## §2 D-2 设计：C-2 最小合法 release contract（**仅设计 · 未实施**）

> ⛔ 本节为**方案文本**；⛔ 不构成授权；⛔ 未修改 `adminGateway` / 未新增路由 / 未写 DB。

### §2.1 先确认现有状态机的**合法语义**（⛔ 不预设最终状态名）

**值域（`gen1-circuit-breaker.js:19-21` 实读）**：

```text
HEALTH      = { OK: 'OK', WARNING: 'WARNING', DEGRADED: 'DEGRADED', ML_OFF: 'ML_OFF' }
HEALTH_RANK = { OK: 0,    WARNING: 1,       DEGRADED: 2,        ML_OFF: 3 }   // 越大越差
DOWN_STATES = [DEGRADED, ML_OFF]      // gen1-health-state.js:39
```

> ★★ **本枚举中不存在 `HEALTHY`。** owner 给的状态机草案末态写作 `HEALTHY / recovery-allowed state` —— 按现有代码语义，**release 不产生新状态名**：release = 「`latched_health` **采纳** `incoming`」，目标态名 = **`incoming` 本身**（`OK` 或 `WARNING`）。⛔ 不得在契约中引入 `HEALTHY` 这个词（会造成第二个真相源）。

**四分支实测语义**（`gen1-health-state.js:137-163`，逐字依据）：

| 分支 | 条件 | `latched_health` | 其它字段 | 标志 |
|---|---|---|---|---|
| ① **release** | `wasDown && nowUp && manualReviewConfirmed === true` | := `incoming` | `manual_review_required=false` · `recovery_allowed=true` · `reviewed_at=now` · `reviewed_by=o.reviewedBy \|\| 'manual'` · `degraded_at=null` · `ml_off_at=null` | `recovery_applied=true` |
| ② **hold（拒绝）** | `wasDown && nowUp && manualReviewConfirmed !== true` | := `prevLatched`（**保持**） | `manual_review_required=true` · `recovery_allowed=false` | `recovery_rejected=true` |
| ③ **仍下行** | `wasDown && !nowUp` | := `worse(prev, incoming)`（取更差） | `manual_review_required=true` · `recovery_allowed=false` | — |
| ④ 上行态 | `!wasDown` | := `incoming` | `manual_review_required = isDown(incoming)` · **`recovery_allowed=false`（恒定）** | — |

★★ **由分支④得出的关键结论（易被误读，必须写明）**：
**`recovery_allowed` 不是持久状态**。它在分支④恒为 `false` ⇒ `recovery_allowed=true` 只存在于**执行 release 的那一次写入**；下一次任何 health 写入都会把它抹回 `false`。
⇒ **契约设计不得把 `recovery_allowed=true` 当作「已恢复」的持久判据**；「已恢复」的判据只能是 **`latched_health ∈ {OK, WARNING}`**（= `!isDown(latched_health)`）。

**owner 草案 → 实测语义的映射**：

```text
DEGRADED
  ↓                                    ← latched_health = DEGRADED (isDown=true)
manual review required                 ← manual_review_required = true
  ↓
review evidence                        ← ⛔ 现有代码【无此环节】（本契约需新增）
  ↓
authorized release decision            ← ⛔ 现有代码【无此环节】（本契约需新增）
  ↓
release recorded                       ← ⚠️ 部分存在：reviewed_at / reviewed_by（尚无 reason/ref/authority/correlation）
  ↓
target = incoming ∈ {OK, WARNING}      ← ★ 实测语义（⛔ 非 "HEALTHY"）
+ recovery_allowed = true（仅该次写入） ← ★ 瞬时，非持久
```

### §2.2 九要素设计

| 要素 | 设计（**仅文本**） |
|---|---|
| **WHO** | 仅**已认证管理员会话**（复用 `adminGateway` 既有登录态 `admin_password`/`admin_token` + `admin-auth.js`）。⛔ 不接受 API Key 直调；⛔ 不接受无会话调用；⛔ 不接受定时器自触发 |
| **WHEN** | 四条件全部成立才允许：① `latched_health ∈ {DEGRADED, ML_OFF}`；② **服务端重算**得 `incoming ∉ {DEGRADED, ML_OFF}`；③ `manual_review_required === true`；④ 距 `degraded_at` / `ml_off_at` ≥ 冷却期（建议复用 `cooldown.js`） |
| **WHAT evidence** | 请求需携带：`reason_code`（**枚举**）、`root_cause_confirmed`（须指向具体 `missing_features` / 数据缺口）、`evidence_ref`（指向 `ml_shadow_signal` 的 `{code, date}` 或诊断工件 id）、`operator`（会话身份）。缺任一 ⇒ **拒绝**（fail-closed） |
| **AUTHORITY CHECK** | 复用 `authorityAllows()` 与 `healthStateToGate()`；⛔ 不得绕过 `gen1-authority.js` 的 `PRODUCTION_LOCKED`；★ **恢复 ≠ 升档**：release **不改变** `gen1_authority`（保持 `CANARY`），⛔ 不得借 release 顺带提权 |
| **STATE TRANSITION** | 唯一允许的迁移 = 分支①（§2.1）。⛔ 禁止：从 `OK` 态「预置」release；⛔ 禁止批量/多级释放；⛔ 禁止把 `manualReviewConfirmed` 从请求体**透传**（必须由**服务端**在通过全部门后置位） |
| **AUDIT RECORD** | 见 §3（8 字段）。⛔ 禁止「无审计的静默恢复」 |
| **REPLAY** | 以只读方式重算 `computeLatchedState`：断言「若当时 `manualReviewConfirmed !== true`，则 `latched_health` 应仍为 `DEGRADED`」（**反事实可复算 ⇒ 不可伪造**）；审计行以 `request_id` ↔ `gen1_health_state.updated_at` 双向对齐 |
| **ROLLBACK** | release 是**状态写**。rollback = 回写**释放前快照**（`latched_health` / `degraded_at` / `ml_off_at` / `manual_review_required` / `recovery_allowed`）。★ **前置硬约束：无 snapshot 不得释放**（先取快照并留证） |
| **ANTI-BYPASS** | ① 走既有鉴权中间件；② 服务端**强制重算** `wasDown/nowUp`（⛔ 不信客户端）；③ `manualReviewConfirmed` 服务端置位；④ 冷却期防抖；⑤ 审计不可关闭；⑥ ⛔ 不得新增 env/config 覆写 health；⑦ ⛔ 不得引入自动恢复定时器（违背 `manualReviewConfirmed` 语义） |

### §2.3 三方案差异对比（A / B / C —— ⛔ 不排名、⛔ 不自行选）

> owner 明确要求：**不能因为现在没有 release route，就默认「加 API」**。故先列差异。

| 维度 | **A：复用现有状态机制** | **B：新增最小 admin release route** | **C：其他现有治理通道**（`scripts/promote-*.js` 模式） |
|---|---|---|---|
| 核心思路 | 让**唯一写点** `runGen1ShadowEod` 的 `computeLatchedState` 收到 `manualReviewConfirmed` | 在 `adminGateway` 新增 `POST /api/admin/gen1/health/release`，服务端组装并调用同一 `computeLatchedState` | 由**本地运维脚本**（直连 DB SDK）执行释放 + 留痕 |
| 是否需新增 route | ⛔ 否 | ✅ 是（1 条） | ⛔ 否 |
| 是否需**部署** | ⛔ 否（但见下「致命前提」） | ✅ **是**（改 `adminGateway` ⇒ 须部署） | ⛔ 否（脚本本地执行） |
| ★ **致命前提/缺口** | ⚠️ `runGen1ShadowEod` 由 **`TRIGGER_TIMER` 定时器**触发（cron `0 20 22 * * 1-5`），**无交互输入面** ⇒ 必须有**另一处**写通道来置位 `manualReviewConfirmed` ⇒ **A 不能单独成立** | ⚠️ 部署起点须先裁定：线上 `adminGateway` 基线 = `8fc3ba66`，**≠ master HEAD**（master 已前进 155 行）⇒ 必须先裁定「从哪个提交分叉」（`GAP-P5`） | ⚠️ 直连 DB 用 `secretId/secretKey`（**面最大**）；且 `gen1_authority` 已在 `FROZEN_PARAM_KEYS` 内 —— 释放**不应**走参数编辑器，但**脚本路径自身仍需授权 + 审计补齐** |
| 鉴权强度 | 取决于「另一处写通道」的选择（若为 DB 直写 ⇒ **无鉴权**） | ★ 最强（复用会话登录 + 中间件） | 弱（依赖密钥保管） |
| 审计强度 | 取决于写法 | 高（服务端可强制写审计行） | ★ **实测弱**：`param_config` 仅 `version` / `updated_at`（见 §3） |
| 误触风险 | 中 | 低（可做二次确认/冷却） | 高（一条命令即生效） |
| 零部署能力 | ✅ | ⛔ | ✅ |
| ★ 与既有排除项的边界 | — | — | ★ **C 与 `AL-4`（DB 直写）的唯一差别 = 是否有审计 + authority 校验**。若无审计 ⇒ C **退化为 AL-4 ⇒ 必须排除** |
| 治理先例 | — | 无（`adminGateway` 现无 gen1 health 写路由） | ✅ 有：`promote-v361-cutover.js` / `promote-gen1-advisory.js` / `promote-ml-shadow-observe.js`（均含 `--dry-run`、`version++`、`updated_at`、**一键回退说明**） |

### §2.4 ★ 「是否真的需要新增 `adminGateway` write route？」

**结论：不是默认答案；但在「零部署 + 强审计」不能同时满足时，B 是唯一同时满足二者的形态。**

判定树（**⛔ 具体选型留给 owner**）：

| 若 owner 的约束是… | 则 | 理由 |
|---|---|---|
| 「必须零部署」**且**「接受审计落在 repo artifact（`deliverables/**`）」 | **C** 可行 | `promote-*.js` 有先例；审计以 append-only JSON artifact 落库外 |
| 「必须有会话身份 + 防误触 + 服务端强制重算」 | **B** 必要 | 只有服务端路由能同时提供 |
| 「不接受任何新集合/新路由」 | **A 单独不足** | `TRIGGER_TIMER` 无交互输入面（§2.3 致命前提） |
| 「审计不可弱于 release 本身」 | 三方案**都需补约束** | 现有 `param_config` 留痕不足（§3） |

**关键澄清**：`A` 与 `B` **不是互斥替代**，而是**分工**——`A` 定义「状态机如何被驱动」，`B`/`C` 定义「谁在什么约束下驱动它」。⇒ 交付形态至少是 **`A + (B 或 C)`**。

### §2.5 ⛔ 明确不做

- ⛔ 不在本 Gate 新增路由 / 修改 `adminGateway` / 部署任何函数；
- ⛔ 不引入自动恢复 / 定时释放；
- ⛔ 不通过 DB 直写「绕过」实现释放；
- ⛔ 不在契约中引入 `HEALTHY` 等**代码中不存在**的状态名；
- ⛔ 不把 `recovery_allowed=true` 当持久判据。

```text
C2_RELEASE_CONTRACT_DESIGNED = YES
C2_RELEASE_CONTRACT_IMPLEMENTED = NO
```

---

## §3 D-3 审计载体

### §3.1 审计行必须包含的 8 个字段

| # | 字段 | 语义 | 可来源 |
|---|---|---|---|
| 1 | `reviewer identity` | 谁做了人工复核 | 会话身份（`adminGateway` 登录态） |
| 2 | `review timestamp` | 何时 | 服务端时钟 |
| 3 | `reason` | 为何释放（**枚举**，非自由文本） | 请求体 `reason_code` |
| 4 | `evidence reference` | 依据什么证据 | `evidence_ref` → `ml_shadow_signal{code,date}` / 诊断工件 id |
| 5 | `previous state` | 释放前 latch 快照 | release 前**先取快照** |
| 6 | `new state` | 释放后 latch | 写入结果 |
| 7 | `authority decision` | 当时 authority 判定结果 | `authorityAllows()` 的返回，**须落审计**（⛔ 不能只算不记） |
| 8 | `request/correlation id` | 关联 id | 服务端生成（与调用日志 `request_id` 对齐） |

**★ 反例纪律**：⛔ **不得**让审计行成为「自由文本备注」——`reason` 必须枚举化，否则无法做机器校验与重放。

### §3.2 现有载体盘点（`AUDIT_CARRIER_IDENTIFIED`）

| # | 候选载体 | 存在? | 证据（本轮实测） | 可承载字段 | 结论 |
|---|---|---|---|---|---|
| 1 | `param_config` | ✅ 存在 | 只读实读 4 行（`probe_param_config_20261003_auditcarrier.json`）：字段集 = `key` / `value{v}` / `description` / `category` / `version` / `updated_at` | 2（timestamp）+ 弱 1（description 静态文本） | ⚠️ **状态存储，不是审计日志**。⛔ **缺** reviewer / reason / evidence / prev / new / authority / correlation |
| 2 | `trade_log` | ✅ 存在 | `TRADE_LOG_UPDATE_FIELDS` = `trade_date, code, action, shares, price, amount, reason, decision_id, position_after, add_mode` | 有 `reason` / `decision_id` **可借鉴** | ⛔ **不可复用**：语义为**交易账**，写入即**污染交易记录**；且需手工登记（本仓惯例） |
| 3 | `fetch_log` | ✅ 存在 | `COLLECTIONS.FETCH_LOG`；由 `adminGateway` 在 `risk` 写路径 `add()` | 抓取语义 | ⛔ 语义不符 |
| 4 | `shadow_v3_log` | ✅ 存在 | `COLLECTIONS.SHADOW_V3_LOG` | 引擎影子日志 | ⛔ 语义不符，且**不得**作 Evidence 源（GE-03 已禁 shadow/replay 作 Evidence） |
| 5 | CloudBase **CLS 日志** | ✅ 存在 | `tcb logs search` 通道（字段 `request_id` / `request_source` / `status_code` / `log`）—— 见 `TOOLING.md` §6.3 | correlation id（1）+ 时间（2） | ⚠️ **只能作旁证**：保留期有限、非结构化业务字段、不可承载 3/4/5/6/7 |
| 6 | `deliverables/v365-production-history/c021/**` | ✅ 存在 | 18 件 JSON + sha256 绑定（`APPROVAL_MANIFEST_SHA256` / `CHANGED_FILES_LIST_SHA256` / `P12_PARITY_LOG_SHA256`），入 git | 全 8 字段**可表达** | ★ **最接近既有「immutable evidence」模式**：append-only + 可复算 + 零 DB 依赖 |
| 7 | `ml/manifests/*IMMUTABLE*.json` / `immutable_set` | ✅ 存在 | 冻结清单含 `lock_revision` | 不适用（承载冻结参数，非运行事件） | ⛔ 语义不符 |
| 8 | `run_history` / `run_manifest` / `active_run_pointer` | ⚠️ **存在但空** | C-021 post-deploy 实测：五集合**全 0** ⇒ `V365_COLLECTIONS_ALL_EMPTY = true` | — | ⛔ 当前**不可用** |
| 9 | ★ `gen1_health_state` **自身** | ✅ 存在 | 含 `reviewed_at` / `reviewed_by` 字段（已实测存在于文档结构） | 1（reviewer）+ 2（timestamp） | ★ **「谁在何时复核」已内建**；缺 3/4/5/6/7/8 |
| 10 | 专门的「admin 操作日志」集合 / DB audit collection | ⛔ **不存在** | 全仓 grep 无 `operation_log` / `admin_log` / `audit_log` 集合；`adminGateway` 写面仅 = `PARAM_CONFIG` / `FUNDAMENTAL_*` / `RISK_EVENTS` / `FETCH_LOG` / `TRADE_LOG` | — | ⛔ 需**新增集合**才能有此载体 |

### §3.3 结论：`AUDIT_CARRIER_IDENTIFIED` 的落点（⛔ 不自行选定）

**① 结论**：**现有载体无法完整承载 8 字段**；但**不需要新建「审计系统」**（⛔ 禁止为审计新增一整套机制）。

**② 最小补足** = 「`gen1_health_state` 内建字段（`reviewed_at`/`reviewed_by`）」+「**一个 8 字段审计行的落点**」。

**③ 落点三选一（留给 owner 裁定，本件不选）**：

| 选项 | 形态 | 优点 | 缺点 |
|---|---|---|---|
| **(i)** 复用 `trade_log` 模式（写既有集合） | 在既有集合内新增 `action='GEN1_HEALTH_RELEASE'` 类行 | 零新增集合 | ⛔ **语义污染**；`trade_log` 是交易账 ⇒ 不建议 |
| **(ii)** ★ 扩展既有「证据包」模式 | 审计行以 **append-only JSON artifact** 落 `deliverables/**`（含 8 字段 + sha256 绑定） | 可复算、入 git、零 DB 依赖、与 `c021` 先例一致 | 需约定目录/命名规范；非实时联查 |
| **(iii)** 最小新集合（如 `gen1_health_release_audit`） | 需 owner **明确批准「新增集合」** | 可查询、可索引 | 新增 DB 对象 ⇒ 属**面扩张**，须单独授权 |

**④ ⛔ 明确不做**：不新增审计系统、不改任何现有集合 schema、不写任何审计行。

---

## §4 D-4 `adminGateway` 基线 → 三概念分离

### §4.1 三概念（⛔ 不可混淆）

```text
ONLINE SOURCE     = 实测线上内容 + 其唯一可定位 Git 载体
EXPECTED SOURCE   = 由已生效治理声明推导出的「应在线上」；无声明 = UNSPECIFIED
AUTHORIZED SOURCE = 只能由 owner 给出的授权载体
```

### §4.2 ★ 对前件 `§17 D-4` 建议的**更正**

| 前件写法 | 本件更正 |
|---|---|
| 「`D-4` `adminGateway` 基线确认 ｜ 采用线上对齐源 `_v365-audit-20260930/ref-0908`（✅ 推荐）」 | ⛔ **更正**：`ref-0908` 是**仓库外的快照拷贝目录**，**不是来源**。其内容权威来源 = commit **`8fc3ba66da6cb99b9da22b8933d59d582ddb8982`**（master 祖先）。把快照当基线 = **用拷贝冒充来源** |
| 「不要把 `ref-0908` 自动当成『应该部署的目标版本』」（owner 本轮补充） | ✅ **采纳**：`ref-0908` / `8fc3ba66` **均不构成部署目标**；`expected source` 保持 `UNSPECIFIED` |

**冻结事实（owner 指定）**：

```text
ONLINE_DEPLOYMENT         = MIXED
ADMIN_GATEWAY_BASELINE    = 8fc3ba66 (commit)      # ref-0908 是快照，⛔ 非来源
```

### §4.3 provenance 表

→ **完整 `component × online/repository/expected source × authorization` 表见姊妹件**
`ONLINE_DEPLOYMENT_PROVENANCE_20261003.md` §6（**10/10 函数**，含完整 sha256 / commit / 期望源 / 授权）。

**本件仅摘录与本决策相关的 5 行**：

| component | online source | repository source (`origin/master`) | expected source | authorization |
|---|---|---|---|---|
| `runDecisionEngine` | `v3.6.5-frozen` → `d6692983` | differs（`77f7d500`，1377 行） | **`v3.6.5-frozen`** | ✅ C-021.2 §3 CONTROLLED DEPLOYMENT（owner-granted） |
| `runGen1ShadowEod` | `aaeb5cb0` | **EXACT** | `UNSPECIFIED` | ⚠️ 无专项记录 |
| `adminGateway` | `8fc3ba66` | differs（`44c111e9`，1134 行） | `UNSPECIFIED` | ⚠️ 无（`GAP-P2`） |
| `apiGateway` | `8fc3ba66` | differs（`5342e92d`，1024 行） | `UNSPECIFIED` | ⚠️ 无（`GAP-P2`） |
| `materializeIndicators` | `8fc3ba66` | **EXACT** | `UNSPECIFIED` | ⚠️ 无（`GAP-P2`） |

### §4.4 ⛔ 不修改部署

⛔ 未 deploy · ⛔ 未 rollback · ⛔ 未改任何云函数 · ⛔ 未改台账历史行 · ⛔ 未建分支/PR。

---

## §5 D-5 Implementation Authorization

> owner 本轮裁定：**不授权**。

```text
IMPLEMENTATION_AUTHORIZED   = NO
PRODUCTION_WRITE_AUTHORIZED = NO
EVIDENCE_EXECUTION_AUTHORIZED = NO
GE04_AUTHORIZED             = NO
AGENT_IMPLEMENTATION_AUTHORIZED = NO      # 未出现此明示 ⇒ ⛔ 不得进入 coding
```

**⛔ 明确声明**：
- 本件所有「最小方案 / 设计 / 落点选项」均为**文本**，⛔ **不构成实施授权**、⛔ **不代表已获授权**；
- 「能实现」 ≠ 「已授权实现」；**设计文本 ≠ 授权文本**，**「能实现」 ≠ 「获准实施」**；
- **放行口令（owner 逐字形态）**：`AGENT IMPLEMENTATION AUTHORIZED` —— ⛔ 截至本件落笔，该口令**未出现**，故 `AGENT_IMPLEMENTATION_AUTHORIZED = NO` 继续成立；
- **收尾条件（owner 逐字）**：除非 Owner 后续明确给出 `AGENT IMPLEMENTATION AUTHORIZED`，否则**不得修改 production 或进入实现**；
- ⛔ 未修改任何 production code / config / DB / manifest / authority / selector / active pointer / read path；
- ⛔ 未改既有闸门（含 `v6_negative_scan.py`）。

---

## §6 关键路径保持声明

本件**不调整**冻结关键路径，逐字保持：

```text
C-3 ∥ C-2
 → C-1
 → C-4
 → X-2 PRECONDITION
 → A-1
 → D-1
 → D-2
 → D-3
 → X-1
 → B-1
 → G-1
 → G-2
 → A-2a
 → A-2b
 → G17
 → E-5
```

两条已裁定事项**原样保留**：

1. `X-1` **必须在 `A-1` 之后** —— `authority_canary` 用严格相等 `==='CANARY'`（`gen1-shadow-eligibility.js:103`）⇒ 升档即 shadow qualification 清零。
2. `B-1` **必须先于 `A-2b`** —— ⛔ 不得恢复原主件 §13 与 §6.2 的矛盾顺序。

★ `B-1` 本轮的**性质升级**（不改位置、不改顺序）：
`B-1` 由「普通 Gap」升级为 **`Deployment Provenance / Source-of-Truth clarification`** ⇒ 其**交付形态** = `ONLINE_DEPLOYMENT_PROVENANCE_20261003.md`（已完成）；其**残留** = `GAP-P1…P5`（见姊妹件 §5）。

---

## §7 边界与 STOP

**本 Gate 实测零动作**：`PRODUCTION_WRITE = 0` · `DB_WRITE = 0` · `DEPLOY = NO` · `AUTHORITY_CHANGE = NO` · `CANARY = OFF` · `EVIDENCE_EXECUTION = NO` · `GE04 = NO`

**⛔ 边界声明**：
- 本件及姊妹件均为**只读审计/设计件**；
- ⛔ 未改 production / config / DB / manifest / lock / authority；
- ⛔ 未 deploy / rollback / tag / push / merge；
- ⛔ 未新增云函数路由；⛔ 未新增 DB 集合。

```text
C3_R2_DEFINED                   = YES
C3_OLD_CLAIM_RETRACTED          = YES
C3_R2_AUTHORIZED                = NO
C2_RELEASE_CONTRACT_DESIGNED    = YES
C2_RELEASE_CONTRACT_IMPLEMENTED = NO
AUDIT_CARRIER_IDENTIFIED        = YES
AUDIT_CARRIER_LOCUS_CHOSEN      = NO
ONLINE_PROVENANCE_MAPPED        = YES
ONLINE_DEPLOYMENT               = MIXED
ADMIN_GATEWAY_BASELINE          = 8fc3ba66
REF_0908_IS_SNAPSHOT_NOT_SOURCE = YES
IMPLEMENTATION_AUTHORIZED       = NO
PRODUCTION_WRITE_AUTHORIZED     = NO
EVIDENCE_EXECUTION_AUTHORIZED   = NO
GE04_AUTHORIZED                 = NO
PRODUCTION_WRITE                = 0
DB_WRITE                        = 0
DEPLOY                          = NO
AUTHORITY_CHANGE                = NO
CANARY                          = OFF
EVIDENCE_EXECUTION              = NO
GE04                            = NO
STOP                            = YES
```

**说明（在代码块之外，⛔ 不并入 STOP 字段域）**：
- `ADMIN_GATEWAY_BASELINE = 8fc3ba66` = **commit**；`ref-0908` 是**快照目录**，⛔ 非来源（见 §4.2）。
- `AUDIT_CARRIER_LOCUS_CHOSEN = NO` = 落点三选一**尚未选定**（见 §3.3）。
- `PACKAGE_LEVEL_PARITY` 未复核一事见姊妹件 §3 / §5 `GAP-P3`。
- `ONLINE_PROVENANCE_MAPPED = YES` 的**内容**在姊妹件 `ONLINE_DEPLOYMENT_PROVENANCE_20261003.md`。
