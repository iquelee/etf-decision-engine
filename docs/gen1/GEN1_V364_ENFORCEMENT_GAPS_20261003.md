# GEN1 · V3.6.4 Immutable Lock —— Enforcement 现状与缺口登记（2026-10-03）

> **范围（严格限域）**：仅 **V3.6.4 immutable lock 的 enforcement（强制）面**。
> ⛔ 本件不涵盖其他治理议题（CAS/事务交错、A+B 发布通道、健康门口径、C3-R2 取域分离等各有专件）。
>
> **语义（本件不是声明源）**：
> - 声明源 = `ml/manifests/V364_IMMUTABLE_LOCK.json`（代码/文件申报）
>   **+** `scripts/verify-v364-immutable.js` 内嵌 `ROOT_ANCHOR_V364`（lock 身份锚）。
> - 本件与 `ml/manifests/V364_LOCK_ANCHOR_REGISTRY.json` 同属**登记/证据面**：
>   删掉它们**不改变**权威载体对 lock / 代码的判定。

---

## 0. 处置口径（R7-IMPL-10 = OPTION-1）

**首次落地的处置对象 = 仅新增 machinery，不做冻结转换；lock 保持现有 stale 态。**

由此得到一个**有意保留**的状态（⛔ 不是缺陷）：

```text
code ↔ lock      = 断（stale）        ⇒ 权威载体恰报 1 条 V364_CODE_HASH_MISMATCH
lock ↔ L0 anchor = 通                ⇒ V364_LOCK_ANCHOR_MISMATCH 不触发
```

- 期望红（逐字）：`V364_CODE_HASH_MISMATCH: src/common/schema.js`，**恰 1 条**。
- `EXPECTED_LOCK_INVALIDATION = YES`（属 S-0 批次的暂态锁债，另有专件登记）。
- ⛔ **不得为让校验器变绿而改 lock**；消红路径 = 一次**显式授权的冻结转换**（`R7-IMPL-10` 的另一分支）。
- `GOV-V364-07`（漂移无持久标记）因此保持 **OPEN**。

**期望红是「身份已接通」的证据**，不是失败：能**精确**报出 `schema.js`，正说明校验器真的在逐项消费 lock 的声明。

---

## 1. 已实现（enforcement 面）

| # | 载体 | 作用 | 关键稳定码 |
|---|---|---|---|
| 1 | `scripts/verify-v364-immutable.js` | **权威载体**：消费 lock 的 17 条 `files`/`sha256` 声明；校验面闭合；自认证 L0 锚 | `V364_LOCK_ANCHOR_MISMATCH` · `V364_DECLARED_FILE_MISSING` · `V364_CODE_HASH_MISMATCH` · `V364_UNEXPECTED_SURFACE_FILE` · `V364_BASELINE_SELF_HASH_MISMATCH` |
| 2 | 同上 · `ROOT_ANCHOR_V364` | **L0 身份锚**（4 字段）：`lock_path` / `lock_sha256_lf` / `generation` / `freeze_commit`。锚不匹配 ⇒ **前置 fail-closed 立即返回**（⛔ 不再消费被污染的 lock 声明） | `V364_LOCK_ANCHOR_MISMATCH` |
| 3 | 面闭合（F-2） | `闭包 − baseline − declared − EXCL = ∅`。面**根**由 lock 自动推导（= `cloudfunctions/runDecisionEngine` · `scripts` · `src/common` · `src/common/utils`），⛔ 非人工挑选 | `V364_UNEXPECTED_SURFACE_FILE` |
| 4 | baseline 字面冻结 | `SURFACE_BASELINE_ENTRIES` = **246** 条；`surface_baseline_sha256` = `8f844330…e03c`（POSIX 相对路径 / 字典序 / `\n` 连接 / 含尾 LF / UTF-8 / SHA-256）。⛔ 运行时不重算（重算 ⇒ 差式恒 0 ⇒ 检测力归零） | `V364_BASELINE_SELF_HASH_MISMATCH` |
| 5 | `tests/v364-lock-anchor-registry-consistency.test.js` | **证据副本一致性检查器**；同时是权威载体身份的第二载体（`AUTH_SOURCE_SHA256_LF` 字面量） | `V364_REGISTRY_*` · `V364_AUTH_SOURCE_*` |
| 6 | `tests/v364-checker-anchor-guard.test.js` | **身份锚守卫**（双载体字面量 `GUARD_ANCHOR` + `GUARD_ANCHOR_MIRROR`），只读字节、零 git、零子进程 | `V364_GUARD_ANCHOR_DRIFT` · `V364_CHECKER_IDENTITY_MISMATCH` · `V364_GUARD_DECLARATION_LEAK` |
| 7 | `ml/manifests/V364_LOCK_ANCHOR_REGISTRY.json` | **证据副本 / landing record**（S5 授权记录面）：`identity` / `authorization` / `surface_baseline` / `changed_files` / `authority_boundary` / `recursion_terminus` | 缺失 ⇒ `V364_REGISTRY_MISSING`（检查器）· 存在但 baseline 不符 ⇒ `V364_BASELINE_REGISTRY_MISMATCH`（权威载体·硬红）· 权威载体侧缺失仅 `V364_BASELINE_REGISTRY_ABSENT`（INFO） |

> **证据副本的核对方向（⛔ 单向）**：`scripts/verify-v364-immutable.js` 在副本**存在**时逐项核对 `surface_baseline`（不一致 ⇒ 硬红 `V364_BASELINE_REGISTRY_MISMATCH`，防证据分叉）；副本**缺失**时仅记 `INFO V364_BASELINE_REGISTRY_ABSENT`。
> ⛔ 反方向不存在：权威载体**绝不**从副本取 baseline。

### 1.1 授权记录语义（R7-IMPL-5）

`authorization` 层字段语义 = **决策引用**，⛔ **不是** commit SHA：

- 必填：`authorization_ref` · `authorization_decision`
- 可选：`authorized_by` · `authorized_at` · `orchestration_scope` · `changed_files`（POSIX 去重路径数组）
- ⛔ 禁用：`PENDING` / `TBD` / `HEAD` / 占位符 / 40-hex 伪 SHA / 任何 `*_sha` 形态字段
  （含 registry 的 commit 无法在**无 git 依赖**下自证 ⇒ 该字段必然是伪值或指向前一个 commit）

### 1.2 两处「自指终点」的处理（⛔ 不假装已被树内锚定）

| 对象 | 树内锚 | 带外记录 |
|---|---|---|
| `tests/v364-checker-anchor-guard.test.js` | **无**（自指） | registry `changed_files[]`（path + sha256_lf + size_bytes）+ 含本批的提交历史 |
| `ml/manifests/V364_LOCK_ANCHOR_REGISTRY.json` | **无**（自指） | 含本批的提交历史 |

> 守卫 ⛔ 无法区分「合法 refreeze」与「会话外一致同步篡改」——
> 该历史真实性**只**能由带外记录（registry `changed_files` + 提交历史）承担。

---

## 2. 未实现 / NOT AUTHORIZED

| 项 | 内容 | 状态 |
|---|---|---|
| **B4** | 在 `.github/workflows/test.yml` 的 Gate G1-A~H **之后**追加 V364 校验步骤。⚠️ 必须追加在**末尾**：该 workflow 的 job 内 step 无 `if`/`continue-on-error`/`needs`，前置会让其后既有门被 skip | `NOT_AUTHORIZED` |
| `--force` 处置 | 当前仅在**锚**层隔离（`--force` 重冻结不再静默），名字与冻结器脚本未改 | `AUTHORIZED_SCOPE = ANCHOR_ISOLATION_ONLY` |
| 冻结转换 | 消 `schema.js` 漂移需一次显式授权的冻结转换（`R7-IMPL-10` 另一分支） | `NOT_AUTHORIZED` |
| 平台侧 required check | repo 无 ruleset / CODEOWNERS；平台检查名粒度 = **job**（`test (16, 3.11)` 等 4 个），step 无法成为独立 required check | 平台治理，⛔ 不在本件 |

---

## 3. 缺口台账 `GOV-V364-01..08`

| ID | 主题 | 状态 | 说明 |
|---|---|---|---|
| `GOV-V364-01` | 无校验方（R7-1 本体） | **OPEN（部分收敛）** | 校验器已建立（§1 #1）。⛔ 但**尚无自动执行通道**（B4）⇒ 不宣称关闭 |
| `GOV-V364-02` | 锁不能自证身份 | **结构已建（⛔ 不宣称 CLOSED）** | L0 锚 + `self_reference_policy` 的 attestation 边界已引入；实际强制力依赖执行通道（B4） |
| `GOV-V364-03` | 无审批字段（无 `approved_by`/`approved_at`） | **OPEN** | 已引入 `authorization_ref`/`authorization_decision`/`authorized_by`/`authorized_at`/`changed_files`/`orchestration_scope`；⛔ 但 `authorization_sha` 被 BL-2 明令禁用 ⇒ 无法等价闭合；且 `GOV-GAP-ACTOR`（单一口令无自然人身份）仍 OPEN |
| `GOV-V364-04` | 冻结器/校验器自身不受锁绑定 | **OPEN** | `v364-freeze-manifest.js` 与 `verify-v364-immutable.js` 均不在任何锁的绑定面内（后者由 #6 守卫 + registry 部分缓解，⛔ 不等于受绑） |
| `GOV-V364-05` | 无门静默重冻结路径 | **OPEN** | 仅做锚隔离；冻结器脚本未改（R7-IMPL-4 明示仅锚隔离） |
| `GOV-V364-06` | = 既有 `E-005`（gates.D 的 `evidence`/`run_url` 与 `run_number`/`run_id`/`head_sha` 字段级不自洽） | **OPEN** | 不属于 V364 enforcement 本体 |
| `GOV-V364-07` | 漂移无持久标记 | **OPEN** | OPTION-1 保留 stale 态（§0）；`CODE_DRIFT_LOCK_STALE` 目前仅为批次登记态 |
| `GOV-V364-08` | **强制点自身无保护**（改 `.github/workflows/test.yml` 即可关掉校验） | **OPEN（本件登记）** | 缓解 = 该文件改动属 PR diff，可由 review 兜底；⛔ 本设计**不主张**把 CI 文件锁进锁里（会形成「锁 CI 的锁」无限递归） |

**跨件缺口（同 OPEN，不并入本件）**：`GOV-GAP-ACTOR`（单一口令 ⇒ 无自然人身份）· `GOV-GAP-HEALTH-CAS`（OPEN / UNRESOLVED）。

---

## 4. Deployment Precheck（R7-IMPL-8）

**性质**：这是**治理要求**，由部署流程执行；其**自动化承载**见 §2 的 B4（⛔ 不得写成「已配置」）。

部署前必须执行以下**只读**门（三选零：任一条不符即**阻断部署**）：

| # | 命令 | 期望 |
|---|---|---|
| 1 | `node scripts/verify-v364-immutable.js --json` | 输出与 §0 登记的期望态**逐字**一致（OPTION-1 态下 = 恰 1 条 `V364_CODE_HASH_MISMATCH: src/common/schema.js`）。⚠️ 出现**任何额外**错误码 ⇒ 阻断 |
| 2 | `node tests/v364-lock-anchor-registry-consistency.test.js` | `exit 0` ∧ `status = CONSISTENT` |
| 3 | `node tests/v364-checker-anchor-guard.test.js` | `exit 0` ∧ `PASS` |

⛔ 三项均为**只读**（不写载体树、不读 git、不触生产）。
⚠️ 在 B4 之前，本门无法由平台强制 —— 它是**流程纪律**，不是**机器保证**。

---

## 5. 已登记的文档分叉

| ID | 位置 | 声称 | 实际 | 处置 |
|---|---|---|---|---|
| `DOCUMENTATION_PATH_DIVERGENCE` | `scripts/verify-v364-immutable.js:52` | 第二载体 = `tests/v364-immutable-anchor-guard.test.js` | 实际实现路径 = `tests/v364-checker-anchor-guard.test.js`（且其所承诺的「复制 4 个 L0 字段并断言相等」已由检查器的 `EXPECTED_L0` 实际承担） | **维持现状** + 本登记。⛔ 不改权威载体（改它 ⇒ 其 LF-sha 变 ⇒ 连带检查器/守卫锚失效，必与一次 refreeze 同批授权）；另开后续裁定 |

---

## 6. 明确否证（本件**不**主张什么）

1. ⛔ 不主张「V364 已受强制保护」：执行通道（B4）尚未建立，当前 enforcement 是**能力**而非**保证**。
2. ⛔ 不主张 registry / 守卫是**声明源**：方向**只能**是 verifier 核对 registry（存在即逐项比对 baseline，不符 ⇒ 硬红；缺失 ⇒ 仅 INFO）；⛔ 反向不成立 —— 权威载体**绝不**从 registry 取 baseline。删除 registry **不改变** immutable 判定（`ok` / `codes` / closure 全同，仅多一条 INFO）。
3. ⛔ 不主张 `GOV-V364-*` 任一已关闭（§3 逐条给出状态与理由）。
4. ⛔ 不主张 lock 的 stale 态是缺陷：它是 OPTION-1 的**有意保留态**（§0）。

---

*本件为 V3.6.4 enforcement 面的登记件；正文不含自身执行状态（分支/提交/PR），以便在任何提交位置均为真。*
