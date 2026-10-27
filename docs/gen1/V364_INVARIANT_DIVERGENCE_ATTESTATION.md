# V364 不变量分歧承认书（人读版）

> 机器可读同源件：`ml/manifests/V364_INVARIANT_DIVERGENCE_ATTESTATION.json`
> 授权依据：**I-5-D**（承认机制必须落在 lock 之外）+ **V365-Q = INTEGRATION_BATCH_REGENERATION**
> 行尾/哈希口径：`hash_basis = LF-normalized sha256 (CRLF->LF before sha256) so Windows worktree == Linux CI`
> 本文件落在 `ml/` 与 `docs/gen1/`，**不属于** V364 受管根（`src/common` · `src/common/utils` · `cloudfunctions/runDecisionEngine` · `scripts`），
> 也不命中 V365 `SURFACE_GLOBS`，因此**不进入任何残差计数**（V364 的 61 项计数保持 61）。

---

## 承认项 ① `V364_INVARIANT_DIVERGENCE`

| 字段 | 值 |
|---|---|
| subject | `ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json` |
| metric | `sha256lf` |
| **OLD** | `8efdda6fadb7da409c4d6215851495cf63dec4904a371d3bf5fff82008a2b7ad` |
| **CURRENT** | `291ec03cd1d33af9ecd470a44911d68d1b9455af5368166d22007547a5b0867f` |
| ACKNOWLEDGED | **true**（已登记、已承认，非静默） |

### WHY（为什么会分歧）
`C3-R2`（commit `b2af60e`，2026-10-03）**合法加入** `data_health` role
（实现文件 `src/common/utils/gen1-data-health.js`）。管道锁的 `files` 段因此由 4 role 变为 **5 role**：

```text
indicator_implementation / trend_stage_implementation /
feature_builder_and_params / feature_schema_and_thresholds / data_health
```

锁内容变 ⇒ 锁文件哈希**必然**变。这是**登记的显式变更，不是漂移**。

### 治理语义（四条）
1. 本分歧 **ACKNOWLEDGED** —— 承认而非掩盖。
2. 本分歧 **NOT regenerated** —— 未通过"重跑生成器"把差异抹平；
   `ml/manifests/V364_IMMUTABLE_LOCK.json` **零字节改动**，未回写旧哈希以求绿。
3. 本分歧 **NOT silently repaired** —— 未改回 4 roles、未把 `ROOT_ANCHOR_PIPELINE_LOCK` 重锚到旧值。
4. 承认的**落点**在 lock 之外（本文件 + JSON 同源件）——
   ⛔ 改写 lock 等于用写操作掩盖分歧，被明确禁止。

> 下游影响：`scripts/v364-legacy-ack-gate.js` 计数保持 **61**（3 hash + 58 surface），本文件**不进入**该计数。

---

## 承认项 ② `V365_CANDIDATE_IDENTITY_SUPERSEDED`

| 字段 | 值 |
|---|---|
| subject | `ml/manifests/V365_CANDIDATE_MANIFEST.json` |
| metric | `candidate_content_sha` |
| **OLD** | `2f4b05193ff09d27bc990254e91e545dcad0d2926cf26835119b846c7cd2cade` |
| **NEW** | `2027e5ccab37290f76d1feadd1710bca145a77255524ac01d03c5a4991e5e6fa` |
| ACKNOWLEDGED | **true** |

### WHY（为什么会更新）
集成批次强制连锁：`F-05`（`runDecisionEngine/index.js` 注入观测绑定）与
`F-06`（`adminGateway/index.js` 消解冲突）改变了两个合格面文件的哈希
⇒ `candidate_content_sha` 必须重算，否则 Gate V365 直接 `HASH_MISMATCH` FAIL。

变化项恰为 **2** 个：

```text
cloudfunctions/adminGateway/index.js
cloudfunctions/runDecisionEngine/index.js
```

`qualified_file_count = 20` 与 `qualification_status = CANDIDATE` **均不变**；
`frozen_predecessor_locks = [V361, V364]` 与 `frozen_predecessor_locks_rewritten_by_v365 = false` **均不动**。

### 治理语义
- 身份**载体**不变：git 对象 `d669298` + tag `v3.6.5-frozen`（B 谱系载体，生产已部署）。
  本次仅"候选内容身份"被**显式、可复算地**取代，⛔ 不等于生产身份变更。
- 本项 **NOT silently repaired** —— 取代由 `S-16 / scripts/gen-v365-candidate-manifest.js` 显式执行，
  并可用 `--check` 做确定性复核（BYTE-EQUIVALENT，忽略 `source_commit`）。

---

## 附：本承认书**不是**什么

- ⛔ 不是"生产不变量"声明 —— V364 是 legacy 身份链，已由 V365 canonical 取代。
- ⛔ 不是解锁动作 —— GE-04 状态不受影响；本文件 `runtime = NONE`、无部署单元。
- ⛔ 不是 rollback 替代品 —— 回滚单位仍是 git revert / 单函数包，见 V2 §14。
