# WP-G1-GE-02 实现说明（Dormant Implementation）

**文档编号**：`WP-G1-GE-02-NOTE-1.0`
**工作包**：`WP-G1-GE` — Gen-1 Guarded Effective Integration
**as-of**：2026-09-16
**基线**：`origin/master = 6793d7f`（WP-G1-GE-01 契约冻结点）
**契约**：`docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md`（`WP-G1-GE-CH-1.0`，🔒 FROZEN）
**裁决**：`docs/gen1/WP-G1-GE-RULING_20260916.md` + 2026-09-16 GE-02 放行裁决
**状态**：✅ **CODE ONLY / DORMANT / BASELINE-AUTHORITATIVE** — 代码已落地，**生产结果逐字节不变**

---

## 0. 一句话结论

`GUARDED_EFFECTIVE` 档位、三钥匙、权限合成、审计字段、baseline-only 选择器**全部落地**；
但 `authoritative_source` **恒为 `BASELINE`**，`gen1_adopted` **恒为 `false`**，
`final_target` / `final_action` 仍由 V3.6.1 Safety Core 唯一产出。

---

## 1. 交付范围（做了什么）

### 1.1 Authority：**插入**一格，不推翻重做

```text
OFF(0) → SHADOW(1) → ADVISORY(2) → CANARY(3) → GUARDED_EFFECTIVE(4) → PRODUCTION(5, 不可达)
```

`src/common/utils/gen1-authority.js`：

| 项 | 变更 |
|---|---|
| `AUTHORITY` | 新增 `GUARDED_EFFECTIVE` |
| `AUTHORITY_RANK` | 前四档 rank **不变**；新增 `GUARDED_EFFECTIVE: 4`；`PRODUCTION` 顺延 `4 → 5` |
| `AUTHORITY_LABEL` | 新增 `受控阶段输入（守卫）` |
| `AUTHORITY_LADDER` | 新增导出（阶梯顺序单一真相） |
| `authorityAllows` | 新增能力 `GUARDED_EFFECTIVE_OVERRIDE`（need = 4）；**新增** `rankOf(authority) >= PRODUCTION ⇒ 一律 false` 的防御性加固 |
| `resolveAuthority` | 新增输出 `guarded_effective_authorized`（= Key 1，**仅**「有权提议」） |

**三条硬边界原样保持**：`PRODUCTION_LOCKED === true`、`production_write === false`、`auto_execution === false`。

### 1.2 P0：`gen1_authority` 入冻结清单

`src/common/constants.js` → `FROZEN_PARAM_KEYS` 新增 `'gen1_authority'`（清单 6 → 7 项）。

后果（**有意为之**）：普通 ParamConfig 后台**不能再**切 Authority。提权 / 回退一律走
`scripts/promote-*.js` 一类**专门、可审计**的直接写库脚本，等同显式审批动作。

### 1.3 封印（Key 2 / Key 3）

新增 `src/common/utils/gen1-guarded-seal.js`：

| 函数 | 性质 | 职责 |
|---|---|---|
| `evaluateGuardedSeal({freeze, evidence, runtime})` | 纯函数 | 评估两把封印，**不读文件**，便于注入 synthetic 覆盖真值逻辑 |
| `readProductionSeals(bindings, {baseDir})` | 有副作用（只读） | 按候选路径读制品；任何异常降级为 `MISSING` ⇒ false |

**Freeze Seal 判定顺序**（任一不成立即 false）：

```text
① 制品缺失                        → FREEZE_SEAL_MISSING
② status !== APPROVED             → FREEZE_SEAL_NOT_APPROVED:<status>
③ 运行期无法观测某项绑定          → FREEZE_SEAL_BINDING_UNVERIFIABLE
④ 绑定与运行期实读不一致          → FREEZE_SEAL_BINDING_MISMATCH
```

四项绑定 = `source_sha256` / `model_sha256` / `threshold_version` / `contract_version`。

**Evidence Seal 判定**（三项须**同时**成立，任一不成立即 false）：

```text
① status !== PASS                 → EVIDENCE_SEAL_NOT_PASS:<status>
② evidence_positive !== true      → EVIDENCE_SEAL_NOT_POSITIVE
③ independent_events < 30         → EVIDENCE_SEAL_INSUFFICIENT_EVENTS
```

> ② 是**复审 P0-2 补入**的：`status = PASS` 只说明「有人盖章」，**不足以**证明方向为正
> （冻结契约的证据门 = `EVIDENCE_POSITIVE`（Q1 ∧ Q2 ∧ 非 Q3）**且**独立事件 ≥ 30）。
> 本模块**不**重新解释 `q1/q2/q3` 的语义，只要求 `evidence_positive === true` 这一**确定性**事实；
> 缺字段（`undefined`）与字符串 `'true'` 一律**不**视为 true（绝不「缺省即真」）。

新增两份制品（**状态恒不可通过**）：

| 制品 | 状态 | 关键内容 |
|---|---|---|
| `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` | `PENDING` | 四项绑定全 null，`bindings_status = INCOMPLETE` |
| `ml/manifests/GEN1_GUARDED_EFFECTIVE_EVIDENCE.json` | `PENDING` | `independent_events = 0`，`evidence_positive = false` |

`scripts/build-cloudfunctions.js` 的 `EXTRA_FILES.runDecisionEngine` 把两份制品随函数部署
（复用 Gen-2 bundle 的既有机制），使 GE-04 的晋升路径真实可用。

### 1.4 `effective_guarded`：唯一准入点

`src/common/utils/gen1-safety-permission.js` 的 `finish()` 内新增（与 `effective_canary` **并列**）：

```text
effective_guarded =
      authority_guarded          # Key 1（authorityAllows GUARDED_EFFECTIVE_OVERRIDE）
   ∧ freeze_seal_approved        # Key 2
   ∧ evidence_seal_pass          # Key 3
   ∧ health_allows_guarded       # 必须**显式** health=OK 且 gate_status=ACTIVE
                                 #   （缺 gate_status / 空串 / null 一律不视为 ACTIVE —— 复审 P0-1）
   ∧ data_ok                     # 必须 OK（DEGRADED/BLOCKED/UNKNOWN 全拒）
   ∧ domain_strict_in_domain     # 必须 IN_DOMAIN（PARTIAL_COVERAGE 亦拒）
   ∧ safety_pass
   ∧ model_candidate
```

> ⚠️ `health_allows_guarded` **不得**沿用 `health` 审计信封里 `hg.gate_status || 'ACTIVE'`
> 的**展示性**默认值。那是既有信封契约（保持逐字节不变），**不是**授权判据 ——
> Health 是八重 Guard 中的硬门，缺字段必须 fail-closed。

- **未修改** `effective_advisory` / `effective_canary` 的任何语义（含 canary 对
  `PARTIAL_COVERAGE` / `DEGRADED` 的既有宽松口径）。
- 原因码只作**可解释性**细化（`GUARDED_*`），不新增合取项：`safety.permission == null`
  （不可用）与 Safety 明确 `BLOCK` 分开报。

### 1.5 选择器：恒 BASELINE（休眠）

新增 `src/common/utils/gen1-guarded-selector.js`：

| 导出 | 说明 |
|---|---|
| `selectGuardedResult()` | **无条件**返回 baseline；传引用相等断言 + 运行期抛错兜底 |
| `GE_02_BASELINE_AUTHORITATIVE = true` | 本阶段不得翻转的硬标记 |
| `buildGuardedAudit()` | 生成 §6.1 审计字段（纯审计） |
| `candidateHash()` | 稳定哈希（`k~v` 行 + 字典序 + `|` + sha256，与仓库既有配方一致） |

### 1.6 overlay：只附加审计字段

`src/common/utils/gen1-overlay.js` 新增**可选**第 4 参 `guardedAudit`。

```js
out.final_target = prodTarget;   // ← 硬还原，一字未动
out.final_action = prodAction;   // ← 一字未动
```

⇒ 本工作包**没有**教 overlay 修改 production 字段；进入生产路径的设计是
「guarded V3 result → 权威 selector」，不是 overlay output（章程 §4.3）。

### 1.7 主链与运行状态

`cloudfunctions/runDecisionEngine/index.js`：

1. 启动时读取封印（fail-closed），逐只 ETF 注入 `evaluateGen1Permission`。
2. 逐只计算 `guardedSelection` + `guardedAudit`，并施加两条运行期断言：
   `authoritative_source === 'BASELINE'`、`gen1_adopted !== true`。
3. `applyGen1Overlay(result, permission, canary, guardedAudit)` → 落库（`decision_result`）。
4. `runtime_status` 新增 §6.2 五字段 + 封印可观测字段（`gen1_guarded_*`）。
5. `ml_effective` 由字面量 `false` 改为**单向派生** `gen1_guarded_effective_active`
   （`runtime_status` 与返回体顶层两处）；**严禁反向派生**。

`src/common/schema.js` 登记 `decision_result` / `runtime_status` 的新字段。

---

## 2. Dormant 的三层保证

| # | 保证 | 锚点 |
|---|---|---|
| 1 | 生产制品状态为 `PENDING`/`0 事件` ⇒ Key 2/3 恒不通过 | 两份 `ml/manifests/GEN1_GUARDED_EFFECTIVE_*.json` |
| 2 | 选择器恒 `BASELINE`；`gen1_adopted` 恒 `false` | `gen1-guarded-selector.js` + 主链两条断言 |
| 3 | `final_target`/`final_action` 硬还原 + `verifyProductionNoop` 运行期断言 | `gen1-overlay.js` + `index.js` |

**⇒ 单靠改 `param_config` 一条记录绝不可能激活**：即使把 `gen1_authority` 改成
`GUARDED_EFFECTIVE`，`effective_guarded` 仍为 `false`（`GUARDED_FREEZE_SEAL_NOT_APPROVED`）。

> ⚠️ 附加事实：当前 `runDecisionEngine` **没有**随函数部署 Gen-1 的 source/model SHA，
> 因此 `freeze_seal_approved` 在本阶段恒为 `FREEZE_SEAL_NOT_APPROVED:PENDING`；
> GE-04 晋升前必须先解决绑定观测源问题（见 §5）。

---

## 3. 回退方案

| 级别 | 动作 | 生效时点 |
|---|---|---|
| L1 | `param_config.gen1_authority` 改回 `CANARY`（走 promotion 脚本，后台已冻结） | 下次 `runDecisionEngine` 立即 |
| L2 | Freeze 制品置 `REVOKED` ⇒ Key 2 失效 | 同上 |
| L3 | revert 本 PR | 需重新部署（本阶段未部署） |
| L4 | Selector 恒 `BASELINE`（**本阶段即是默认**） | — |

---

## 4. 测试与门禁

| 新增测试文件 | 覆盖 |
|---|---|
| `tests/gen1-guarded-effective-authority.test.js` | 阶梯插入 / 全档恒无生产写权限 / PRODUCTION 不可达 / 能力边界 |
| `tests/gen1-guarded-effective-gates.test.js` | 封印 fail-closed 矩阵（缺 / PENDING / REVOKED / 不匹配 / 不可验证 / 事件不足）+ 生产制品不得 APPROVED·PASS + 逐门负例 + CANARY 语义不变 |
| `tests/gen1-guarded-selector-noop.test.js` | 选择器恒 BASELINE（含全门成立时）/ production no-op / 审计字段 dormant / `ml_effective` 单向派生静态守卫 |
| `tests/gen1-authority-frozen-param.test.js` | `gen1_authority` ∈ `FROZEN_PARAM_KEYS` + 后台拦截真实存在 |

`scripts/gen1-production-gates.js` 新增命名门禁：**G1-V**（Authority）/ **G1-W**（Gates）/
**G1-X**（Selector No-op）/ **G1-Y**（Frozen Param）。

### 4.1 CANARY before/after 逐字段平价（本工作包最关键的证据）

方法：`git worktree` 检出 GE-02 之前的树（`6793d7f`），与 GE-02 之后的树**同输入**各跑一遍
纯函数层，逐字段比对。脚本：`outputs/wp-g1-ge-02-20260916/canary-parity.js`。

结果：**38/38 场景 PASS**

| 维度 | 结论 |
|---|---|
| `resolveAuthority` | 全部旧字段逐字段相同；新增 `guarded_effective_authorized` 一项且在白名单内 |
| `evaluateGen1Permission` | 全部旧字段逐字段相同；新增 `effective_guarded` + `guarded` 两项且在白名单内 |
| `buildCanaryCounterfactual` | 输出**逐字段完全相同**（零新增字段） |
| `applyGen1Overlay` | 旧字段逐字段相同；新增 16 个审计字段且全部为 dormant 取值 |
| `final_target` / `final_action` | 38/38 场景与输入逐字段相同 |

⇒ `PASS` 意味着：**GE-02 之前任何一天的生产结果，在 GE-02 之后都会逐字节复现**。

---

## 5. 明确未做（不得误读为已完成）

| 项 | 状态 |
|---|---|
| 改线上 `gen1_authority` | ❌ 未做（仍 `CANARY`） |
| 部署 CloudBase | ❌ 未做 |
| 写 `param_config` | ❌ 未做 |
| 创建 Evidence `PASS` | ❌ 未做 |
| 创建可激活的 `APPROVED` 生产 seal | ❌ 未做（两份制品均 `PENDING`） |
| 让 selector 选择 `GUARDED` | ❌ 未做（恒 BASELINE） |
| 改 `final_target` / `final_action` | ❌ 未做 |
| 开自动执行 | ❌ 未做 |
| 触碰 `ml/gen2/` 全目录 | ❌ 未动（`ACCEPTED_FAIL` 冻结证据逐位不变） |
| guarded 影子重跑 / 7 类反例门 | ❌ 属 **WP-G1-GE-03** |
| P4 真切换 | ❌ 属 **WP-G1-GE-04**，**Evidence Gate 硬前置** |

---

## 6. 移交 GE-03 / GE-04 的显式锚点

以下位置在后续工作包中**必须显式改写**（等同审批动作），不得静默删除：

| 锚点 | 文件 | GE-03 / GE-04 动作 |
|---|---|---|
| 生产制品不得 APPROVED/PASS 的断言 | `tests/gen1-guarded-effective-gates.test.js` §B | GE-04 晋升时改写 |
| `GE_02_BASELINE_AUTHORITATIVE = true` | `src/common/utils/gen1-guarded-selector.js` | GE-04 翻转（须 Evidence PASS + 章程 v2.0） |
| `guarded: null`（不重跑） | `cloudfunctions/runDecisionEngine/index.js` | GE-03 接入影子重跑 |
| `gen1_guarded_effective_invocations` 口径 | `cloudfunctions/runDecisionEngine/index.js` | GE-03 落实「真实采纳 + 落库成功后计数」与跨轮累计；若需 eligibility / shadow 计数，**另开字段**，不得复用本计数器 |
| `source_sha256` / `model_sha256` 观测源 | `cloudfunctions/runDecisionEngine/index.js` + 封印读取 | GE-04 晋升**前**必须先提供，否则绑定恒 `UNVERIFIABLE` |

---

## 7. 复审修复记录（REQUEST CHANGES → FIX）

首轮复审结论为 **REQUEST CHANGES**（架构方向认可，3 项代码级缺陷）。本轮修复如下。

| # | 等级 | 缺陷 | 修复 |
|---|---|---|---|
| 1 | **P0** | Health 门 fail-**open**：`gate_status` 缺失被默认成 `ACTIVE`（`gen1-safety-permission` 与 `runDecisionEngine` 运行期聚合各一处） | 改为 `String(hg.gate_status \|\| '').toUpperCase() === 'ACTIVE'`；缺失 / 空串 / `null` 一律 false |
| 2 | **P0** | Evidence Seal 只校验 `status===PASS ∧ events>=30`，**未证明 `EVIDENCE_POSITIVE`** ⇒ `{PASS, positive:false, 30}` 会被放行 | 增加 `evidence_positive === true` 校验 + 原因码 `EVIDENCE_SEAL_NOT_POSITIVE`；synthetic fixture 显式写 `evidence_positive: true` |
| 3 | **P1** | `gen1_guarded_effective_invocations` 计的是 **eligibility**（`effective_guarded===true`）却命名为「真实采纳次数」⇒ 将来会出现 `adopted=false` 但 `invocations=1` 的审计矛盾 | 只在「selector 选择 `GUARDED` **且** `gen1_adopted===true`」时 +1；GE-02 因 dormant 断言而**结构性恒 0** |

**未改动**（按复审要求）：V3.6.1、overlay production no-op、model / threshold、CANARY 行为、
线上 authority、Gen-2、以及两份生产封印（保持 `PENDING`）。

### 7.1 旧 / 新并排直读（把 fail-open 钉死）

同一输入分别喂给 **GE-02 head（修复前）** 与本轮修复后的实现：

```text
health=OK + latched_health=OK + gate_status 缺失 + 完整 PASS 封印
  旧(GE-02 head)  health_allows_guarded=true   effective_guarded=true   reason=null          ← fail-open
  新(本修复)      health_allows_guarded=false  effective_guarded=false  reason=GUARDED_HEALTH_NOT_ALLOWED

Evidence status=PASS + evidence_positive=false + events=30
  旧(GE-02 head)  evidence_seal_pass=true      effective_guarded=true   reason=null          ← 误放行
  新(本修复)      evidence_seal_pass=false     effective_guarded=false  reason=GUARDED_EVIDENCE_SEAL_NOT_PASS

对照组：gate_status 显式 ACTIVE + 完整 PASS 封印
  旧(GE-02 head)  effective_guarded=true
  新(本修复)      effective_guarded=true      ← 证明修复不是「恒 false 桩」
```

`gate_status` 取值表（新实现）：

| 取值 | `health_allows_guarded` |
|---|---|
| 缺失 | `false` |
| `""` | `false` |
| `"ACTIVE"` | `true` |
| `"PENDING"` | `false` |

### 7.2 新增 / 变更的测试

| 测试 | 覆盖 |
|---|---|
| `gen1-guarded-effective-gates.test.js` **A2**（新） | Evidence 三态真值表：`PASS/false/30 ⇒ false`、`PASS/true/29 ⇒ false`、`PASS/true/30 ⇒ true`；缺字段 / `'true'` / `1` 一律不通过；判定顺序（非 PASS 优先于非 POSITIVE） |
| 同上 **F**（增） | Health ★ `gate_status` 缺失 / 空串 / `null` ⇒ `health_allows_guarded=false` 且 `effective_guarded=false`；显式 `ACTIVE` / `active` ⇒ 该门成立（对照，排除「Health 恒 false」） |
| 同上 **B**（增） | 生产 Evidence 制品 `evidence_positive !== true`（dormant 硬守卫） |
| `gen1-guarded-selector-noop.test.js` **6.7**（新） | 采纳计数必须由「`SELECTOR_SOURCE.GUARDED` ∧ `gen1_adopted===true`」把关；严禁在 `effective_guarded===true` 分支内计数；字段名与落库位置不得改动 |
| 两个既有测试的 synthetic fixture | 显式补 `evidence_positive: true`（不得省略） |

**反例非空转已实证**：把新版测试跑在 GE-02 head 的旧实现上，`gen1-guarded-effective-gates`
在 `★ status=PASS 但 evidence_positive=false 必须 fail-closed` 处变红；
`gen1-guarded-selector-noop` 在 `★ 主链必须导入 SELECTOR_SOURCE` 处变红。

---

## 8. 变更日志

| 版本 | 日期 | 内容 |
|---|---|---|
| 1.0 | 2026-09-16 | GE-02 首次落地（dormant，生产结果逐字节不变） |
| 1.1 | 2026-09-16 | 响应复审 REQUEST CHANGES：P0-1 Health 显式 fail-closed、P0-2 Evidence 必须 POSITIVE、P1 采纳计数语义修正 |

---

*本文件不授权任何生产变更。`gen1_authority` 保持 `CANARY`；`ml_effective` 保持 `false`。*
