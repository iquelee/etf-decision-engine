# V3.6.5 — 平台 CAS / 事务语义实证（Q7 证据）

> **性质**：真实 CloudBase 环境上的**一次性隔离探针**结果记录。
> **授权**：用户在当轮明确授权「执行 V3.6.5 Q7 Platform CAS Probe」，范围严格限定为
> 名称以 `_v365_` 开头的**隔离测试集合**；⛔ 不得触碰任何生产 collection / 参数 / 云函数。
> **本轮（Q7 重裁轮）未再次运行任何真实环境写探针** —— 本文档只做**证据入库**。

---

## 1. 环境与探针对象

| 项 | 值 |
|---|---|
| CloudBase env | `tradingview-etf-d0fa42yy57cbc11b` |
| 探针集合 | `_v365_cas_probe` |
| 指针文档 `_id` | `_v365_cas_pointer` |
| 命名空间（平台返回） | `tnt-8pyvyyfv6._v365_cas_probe` |
| 执行日期 | 2026-09-24 |
| 通道 | `tcb.RunCommands`（`service=tcb` / `version=2018-06-08` / `region=ap-shanghai`） |
| 响应特征 | 含 MongoDB `opTime` / `clusterTime` / `electionId` ⇒ 直连真实 flexdb，非本地模拟 |

> ⛔ 本文档**不记录**任何 secret / JWT / access token / credential 内容。
> envId 与集合名可记录（非凭据）。

### 1.1 通道说明（必须披露的一处偏差）

当轮授权给出的命令形态是 `node scripts/v365-cas-platform-probe.js --env <envId>`。该通道在本机**不可用**：
`cloudbaserc.json` 不含 `secretId/SecretKey`；`~/.tcb`、`~/.config/cloudbase` 不存在；
`cloudbase env:list` 报 `No valid identity information`（未登录）；`cb-cred.txt` 只是环境级 JWT，喂不了 `cloudbase.init`。

⇒ 改用实际可用的合规通道 `tcb.RunCommands`（经已授权的 MCP `callCloudApi`）。
**它直连真实 flexdb ⇒ 对「平台数据库语义」是强于 SDK 封装的直证**；
但它**不经过** `@cloudbase/node-sdk` ⇒ **不能**用来证明 SDK 层封装行为。

### 1.2 命名约束的一处实测发现

管控面 `CreateTable` **拒绝**以下划线开头的集合名（`cannot start with an underscore (_)`）。
若就此收手会误报「授权范围不可满足」。
实测：`RunCommands` 的 `insert` **可以**建出 `_v365_cas_probe`
⇒ **授权要求的 `_v365_` 前缀成立，零命名偏离**。

---

## 2. CAS 语义实测（CAS-0 ~ CAS-7）

写法 = **单文档条件更新**（`findAndModify`）：
`query` 携带 **expected-current 过滤**（`_id` + `run_id` + `revision`），`update` 写入候选指针。

| 用例 | 平台原始语义 | 判定 |
|---|---|---|
| **CAS-0** 初始化 | upsert → 指针 = `run-A@1`；批量多命令**按序**执行 | PASS（夹具） |
| **CAS-1** 正常提升 | `findAndModify{query:{_id, run_id:'run-A', revision:1}}` → `lastErrorObject.n:1, updatedExisting:true` ⇒ `run-B@2` | **PASS** |
| **CAS-2** 过期 expected | 再提交 `expected=run-A@1`（实际已是 `run-B@2`）→ `n:0, value:null`；指针**保持** `run-B@2` | **PASS**（过期被真实拒绝） |
| **CAS-3** 并发同 expected | 两个请求持**同一** `expected=run-B@2` 并行发出 → 一个 `n:1`（→`run-D@4`）、另一个 `n:0, value:null` ⇒ **恰好一个成功** | **PASS**（无 lost update） |
| **CAS-4** 旧 run 后到 | 守卫 `revision:{$lt:3}`，当前 revision=4 → `n:0`；指针保持 `run-D@4` | **PASS** |
| **CAS-5** retry 重放 | 重放 `expected=run-A@1` → `n:0`，**revision 未增** | **PASS**（幂等） |
| **CAS-6a** 失败不改指针 | 非法命令 → `CommandNotFound`；指针保持 `run-D@4` | **PASS** |
| **CAS-6b** 批量中途失败 | `[有效写, 非法命令]` 批量 → 整调用**报错**，但**前半已生效**（指针已变 `run-E@5`） | ⚠️ **负向发现**（见 §4） |
| **CAS-7** 写后独立读 | 恰一条、值与写入一致 | **PASS** |

### 2.1 证据强度限定（不得过度解读）

- CAS-3 是**两个重叠请求**的实证，**不是** N 路高并发压力测试。它足以证明
  «同一 expected 不可能双写»，但**不**证明极端并发下的吞吐/重试退避行为。
- CAS-6b 是**单次观测**的批量非原子性。语义方向明确（前半持久化），但未做多样化组合枚举。
- 上述限定**不削弱** Q7 的结论需求：Q7 关心的是「同一 expected 不能双写 / 旧 run 不能覆盖新 run /
  失败不改指针 / retry 幂等」—— 这四项均已被直接观测。

---

## 3. 事务命令的实测结论

| 探测 | 结果 |
|---|---|
| `{"startTransaction":1}`（CommandType=COMMAND） | **`CommandNotFound: no such command`** |
| `db.runTransaction` / `db.startTransaction`（SDK 签名） | `@cloudbase/node-sdk@2.11.0` `types/index.d.ts:467-468` **存在签名**；但**该通道无对应命令** ⇒ **不可执行、不可验证** |

⇒ 平台事实：

```
TRANSACTION_COMMAND_AVAILABLE = FALSE     （在可及通道上）
```

**这不构成本协议的阻断** —— 见 §5 的重裁理由。

---

## 4. 批量命令非原子（平台事实）

| 批次 | 观测 |
|---|---|
| `[findAndModify(有效写 run-D@4 → run-E@5), {$noSuchCommandForProbe}]` | 整调用返回错误，**但前半写入已生效**（指针变为 `run-E@5`） |

⇒ 平台事实：

```
MULTI_COMMAND_BATCH_ATOMIC = FALSE
```

**推论（写入实现约束）**：⛔ **不得**用「多命令批量」伪装成事务来获得原子性。
authoritative 切换必须压到**单一文档**的条件更新上 —— 这与协议的 atomicity 定义一致。

---

## 5. Q7 重裁（implementation selection correction）

### 5.1 旧判据的问题

旧 Q7 把 `REAL_TRANSACTION_API = PASS` 当作**必要实现机制**。但：

本协议的 atomicity 定义（`src/common/utils/v365-atomic-publish.js` 头部 §11）是：

> «消费者可见的 authoritative dataset，只能通过**单一 active pointer** 从旧完整 run 切换到新完整 run。»
> candidate **可以逐条写**；partial candidate **永远不能成为 authoritative**。

⇒ 该定义**只要求单文档指针切换的原子性**，**不要求**多文档提交。
把「是否使用了多文档事务」当成门槛，是**把实现机制当成了需求本身**。

### 5.2 正式裁定

```
TRANSACTION_REQUIRED                = NO
PLATFORM_SINGLE_DOCUMENT_CAS_REQUIRED = YES

Q7 的真实判据（语义层）：
  ATOMIC_POINTER_PROMOTION
  STALE_EXPECTED_POINTER_REJECTED
  CONCURRENT_LOST_UPDATE_PREVENTED
  OLDER_RUN_CANNOT_OVERWRITE_NEWER
  RETRY_IDEMPOTENT
  FAILURE_PRESERVES_OLD_ACTIVE
  READ_AFTER_WRITE_CONSISTENT
```

**底层实现机制不作为 Gate 本身。**

⚠️ 这是 **implementation selection correction**，**不是**放宽安全标准 —— 判据从
「用了什么机制」改为「是否真的原子」，并且**放行同时要求**「平台级实证」**与**「实现对齐」两者成立
（`v365-contracts.js::publishPromotionAllowed()` 的双重门）。

### 5.3 状态迁移

| 阶段 | 状态 |
|---|---|
| 探针轮结束（本文档所述证据取得时） | `PLATFORM_CAS_EVIDENCE = PASS` · `V365_IMPLEMENTATION_ALIGNMENT = PENDING` |
| 本轮（实现改为单文档条件 CAS + 资格全过） | `Q7_PLATFORM_CAS = PASS` · `ATOMIC_PROMOTION_BLOCKED = CLOSED` · `V365_WRITER_PATH = QUALIFIED` |

---

## 6. 清理证据（无残留）

| 步骤 | 平台返回 |
|---|---|
| `delete` 全部文档 | `n: 2` |
| `find` 复核 | `[]` |
| `drop` 集合 | `ok: 1.0`，`ns: tnt-8pyvyyfv6._v365_cas_probe`，`nIndexesWas: 1` |
| `find` 复核（drop 后） | `[]` |
| `listCollections` 复核 | **27 个，与探针前基线一致**；`_v365_cas_probe` 不存在 |

⇒ `TEST_DATA_CLEANUP = PASS`（未触发"无法删除即停止"分支）。

---

## 7. 生产集合不变量（零触碰证明）

探针前后逐集合比对（Count / Size / IndexCount 三项）：

| 集合 | 探针前 | 探针后 |
|---|---|---|
| 集合总数 | 27 | **27** |
| `decision_result` | 145 / 706584 | **145 / 706584** |
| `portfolio_snapshot` | 37 / 48377 | **37 / 48377** |
| `portfolio_position` | 5 / 7763 | **5 / 7763** |
| `runtime_status` | 1 / 2190 | **1 / 2190** |
| `param_config` | 57 / 12013 | **57 / 12013** |

其余 22 个集合的 Count / Size / IndexCount 亦**逐字相同**。

⇒ `PRODUCTION_COLLECTIONS_UNCHANGED = PASS`（未修改 `decision_result` / `portfolio_snapshot` /
`portfolio_position` / `runtime_status` / `param_config` 中的任何一条）。

---

## 8. 零部署证据

10 个云函数的 `ModTime` 探针前后**全部未变**；`runDecisionEngine` 仍为 `2026-09-22 16:29:48`。

⇒ `ZERO_DEPLOYMENT = PASS`（未 deploy、未改云函数、未改环境变量）。

---

## 9. 归口（这份证据支撑什么 / 不支撑什么）

**支撑**：Q7 的七项语义判据 + 写入实现选型（单文档条件 CAS）+ 「不得用批量伪造原子性」这条实现约束。

**不支撑**：

- ❌ 不支撑 SDK 层 `db.runTransaction` 的行为（该通道无对应命令，无法执行）。
- ❌ 不支撑极端并发压力下的行为（见 §2.1 证据强度限定）。
- ❌ 不支撑 reader 侧迁移 —— 那是 **READER_MIGRATION** 的独立工作包
  （2026-09-24 状态收口：**已 COMPLETE**，见 `docs/V365_READER_MIGRATION.md`；本证据文档不覆盖其判据）。
- ❌ 不构成部署授权；V3.6.5 仍未 freeze / 未 PR / 未 merge / 未 deploy。

**关联实现**：`src/common/utils/v365-publish-store.js::compareAndSetPointer`
（确定性 `_id` + `where({_id, scope, run_id: expected, revision: expected}).update()`）。
