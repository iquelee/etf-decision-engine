# V3.6.5 CloudBase READ-ONLY Connector

> **用途**：为解除 `GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED` 建立**只读**生产数据访问能力。
> **状态**：✅ `CLOUDBASE_READONLY_CONNECTOR = READY` · ✅ `CLOUDBASE_READONLY_CONNECTION = **VERIFIED**`
> （R-01~R-06 **全 PASS**；受治理导出已完成 · 阻塞已 CLOSED —— 见 §5/§6）
> **生成时刻**：2026-09-29（C-013 更新：owner 授权登录后连通）

---

## 1. 设计原则

```text
READ ONLY       — 导出器在结构上不存在任何 mutation 方法
FAIL CLOSED     — 非 allowlist 集合 / 连接错误 ⇒ 抛错，绝不静默返回空
LEAST PRIVILEGE — 只需「读环境 + 读库 + 查集合 + 分页读文档」
NO SECRET IN REPO — 凭证只从环境变量或本机 gitignored 文件读取
NO PRODUCTION CODE COUPLING — 不 require 生产 db.js，不被任何云函数 require
```

---

## 2. 现有能力审计（`§2` 回答）

| 问 | 答 |
|---|---|
| **A. 项目使用哪个 CloudBase SDK？** | `@cloudbase/node-sdk`（各云函数声明 `^2.9.0`；本机 `dist-functions/*/node_modules` 实装 **v2.11.0**） |
| **B. production env_id 从哪取得？** | `tradingview-etf-d0fa42yy57cbc11b`（来源：仓库既有 `scripts/ml/export-etf-daily-cloudbase.js`；亦可用 `TCB_ENV_ID` 覆盖） |
| **C. 本地能否用现有 SDK 建立 DB read？** | **能力在（SDK 已就绪），但凭证不可用** ⇒ 当前**不能**。报错 `SIGN_PARAM_INVALID: secret id error` |
| **D. 缺的是 SDK / credential / 网络 / connector？** | **缺有效 credential**（SDK 有、网络需连通性未知、connector 已建） |
| **E. 是否已有可复用 query adapter？** | 有：`src/common/utils/db.js::query()`（自动分页）。**但它含 mutation 方法**，故**不采用**，另建只读 client |

**复用策略（Option A — Existing official SDK）**：复用已装 SDK，**不新装任何依赖**。

---

## 3. 产物

| 文件 | 作用 |
|---|---|
| `scripts/tools/cloudbase-readonly-client.js` | 只读 client（`listCollections` / `count` / `queryPage` / `sample`） |
| `scripts/tools/cloudbase-readonly-safety-test.js` | 只读安全测试 R-01~R-06 |
| `scripts/tools/cloudbase-export-governed-history.js` | 受治理导出器（metadata probe → 分页导出 → provenance → 完整性门禁） |

---

## 4. 只读保证（机器可验证）

### 4.1 导出面（§6 R-04）

```
导出方法 = [listCollections, count, queryPage, sample]
```

⛔ 无 `add` / `update` / `set` / `remove` / `createCollection` / `dropCollection` / `deploy`。

### 4.2 allowlist（§7）

```js
ALLOWLIST = ['trade_log', 'portfolio_snapshot']
```

非 allowlist 集合 ⇒ `COLLECTION_NOT_ALLOWED`（**FAIL CLOSED**，不静默返回空）。
**不存在** `query(any_collection)` 这类宽开放接口。

### 4.3 凭证来源（§4）

优先级：`TENCENTCLOUD_SECRET_ID/KEY`（环境） → `TCB_AUTH_PATH` → `.tcb-home/...auth.json`（仓库内，**已 gitignore**） → `~/.config/.cloudbase/auth.json`。
⛔ 凭证**绝不**写入仓库；输出**绝不**打印 secret 值（只打印 `source` 描述）。

---

## 5. 连接测试结果（§6 / §25）

### 5.0 ✅ 最终结果（C-013 · owner 授权后）

| ID | 检查 | 结果 |
|---|---|---|
| **R-01** | 可以 connect | ✅ **PASS** — 真实查询成功 · `count(trade_log) = 13` |
| **R-02** | 可读取 collection 的 count/metadata | ✅ **PASS** — `trade_log` 13 · `portfolio_snapshot` 40 |
| **R-03** | 源码内无 mutation 调用 | ✅ **PASS** — 代码行零 mutation |
| **R-04** | 导出面不含写型方法 | ✅ **PASS** — `[listCollections, count, queryPage, sample]` |
| **R-05** | credential 不出现在源码/输出 | ✅ **PASS** — 源码零 secret |
| **R-06** | 非 allowlist 请求 ⇒ FAIL CLOSED | ✅ **PASS** — `COLLECTION_NOT_ALLOWED` |

```
STATIC_READONLY_GUARDS = PASS（R-03/R-04/R-05/R-06）
LIVE_CONNECTION_PROBE  = PASS（R-01/R-02）
CLOUDBASE_READONLY_CONNECTION = VERIFIED
```

**受治理导出结果**（`scripts/tools/cloudbase-export-governed-history.js`）：
`trade_log` 13 行 · `portfolio_snapshot` 40 行（200 position 行，**全部** actual `.position`）
· Gov. Data Gate **8/8 PASS** · SHA-256 **独立 `crypto` 复算 MATCH** · `reconciliation = CONSISTENT`
⇒ **`GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED = CLOSED`**

### 5.1 ★ 曾经失败的两个根因（均已修复 · 高复发风险，务必保留）

#### 根因 A：JSON 结构随 CLI 版本变化（静默丢凭证）

owner 授权后，CLI 3.8.1 重写了 `auth.json`，结构**由嵌套变扁平**：

```
旧：credential.domestic.{tmpSecretId, tmpSecretKey, tmpToken, tmpExpired}   ← 嵌套
新：credential.{tmpSecretId, tmpSecretKey, tmpToken, tmpExpired, expired,
               authTime, refreshToken, uin}                                ← 扁平
```

⛔ 旧 loader 只认 `.domestic` ⇒ **静默返回 null 或丢凭证**。
✅ **已修**：`loadCredential()` 同时兼容两种形态。

#### 根因 B：★★ SDK 字段名是 `sessionToken`，不是 `token`（误导性错误）

`@cloudbase/node-sdk` v2.11.0 的 `cloudbase.init()` 只接受 **`sessionToken`**；
传 `token` 会被 **静默忽略** ⇒ 临时密钥缺 STS token ⇒ 服务端返回
**`SIGN_PARAM_INVALID: secret id error`** —— 看起来像"凭证无效/权限不足"，
**实为"token 没带上"**。

**实测对照（决定性证据）**：

| 传参 | 结果 |
|---|---|
| `{ sessionToken: tmpToken }` | ✅ `count(trade_log).total = 13` |
| `{ token: tmpToken }` | ⛔ `SIGN_PARAM_INVALID: secret id error` |

✅ **已修**：`createReadOnlyClient()` 改用 `sessionToken`。

#### 根因 C：凭证过期（历史，已由 owner `cloudbase login` 解决）

`tmpExpired = 2026-09-24T03:57:14Z` ⇒ 已过期 ~120h；`cloudbase env:list` 报
`No valid identity`。已由 owner 授权登录解决。

> ⚠️ **诊断陷阱（重要）**：SDK 对**过期**临时凭证**不返回 `TOKEN_EXPIRED`**，而是回落成
> 同一个误导性的 `SIGN_PARAM_INVALID`。故「凭证过期」与「字段名写错」会表现为**相同错误**。
> 为此新增 `checkCredentialFreshness()`（只读·不触网·零 secret）与 exporter 的
> `[ROOT CAUSE] CREDENTIAL_EXPIRED` 提示，把二者区分开。测试 **K-11 / K-12** 守护此行为。

### 5.2 ⛔ 未做的事（红线，全程遵守）

- ⛔ **未**尝试任何写操作来"验证连接"（§5 明确禁止）
- ⛔ **未**记录或打印 SecretId / SecretKey / token 值
- ⛔ **未**把凭证写入仓库（`deliverables/` 与 `.tcb-home/` 均已 gitignored，见 OBS-J）

---

## 6. 当前状态输出（§25）

```text
CLOUDBASE_READONLY_CONNECTOR = READY
CLOUDBASE_READONLY_CONNECTION = VERIFIED
CREDENTIAL = VALID
READ_PERMISSION = SUFFICIENT
GOVERNED_PRODUCTION_HISTORY_DATA_REQUIRED = CLOSED
FREEZE_REVIEW = ELIGIBLE_FOR_REVIEW
READY_FOR_PRODUCTION_PROMOTION = NOT_ISSUED
REMAINING = RPG-F2-B → RPG-F2-C → RFP-V2-PH → RUN_HISTORY_INDEX → Requal → Freeze
```

---

## 7. 解除阻塞所需（owner 侧动作）—— ✅ 已完成（C-013）

> ✅ **2026-09-29：owner 已执行 `cloudbase login`，阻塞已解除**。以下为**历史操作指引**，保留备查
> （若凭证再次过期 —— 临时凭证约 **2 小时**有效 —— 按同样方式刷新即可）。

⛔ 以下**任一**即可（**不要把 secret 发到聊天里或写进仓库**）：

1. **在本机执行一次 `cloudbase login`**（刷新 CLI 临时凭证到 `~/.config/.cloudbase/auth.json`），**或**
2. **在 WorkBuddy secret store / 本机环境变量配置只读子账号密钥**：

```text
TENCENTCLOUD_SECRET_ID   = <只读子账号 SecretId>
TENCENTCLOUD_SECRET_KEY  = <只读子账号 SecretKey>
TCB_ENV_ID               = tradingview-etf-d0fa42yy57cbc11b   （可选，默认已是它）
```

所需最小权限（§5）：读目标环境 + 读数据库 + 查集合 + 分页读文档。
⛔ **不需要**：数据库写、函数部署、环境管理、资源删除、CAM 管理。

⚠️ **凭证有效期提示**：`cloudbase login` 签发的临时凭证仅约 **2 小时**有效。
若导出中途报 `SIGN_PARAM_INVALID`，**先看** exporter 的 `[ROOT CAUSE] CREDENTIAL_EXPIRED` 行
—— 是过期就重登，**不要**误判为权限问题。

配置完成后，agent 可自主执行：

```bash
node scripts/tools/cloudbase-readonly-safety-test.js       # 复验 R-01..R-06
node scripts/tools/cloudbase-export-governed-history.js    # 受治理导出 + 完整性门禁
```

---

## 8. 安全 observation 登记

| ID | 内容 | 处置 |
|---|---|---|
| **OBS-I** | cloudbase CLI 临时凭证**已过期**（`tmpExpired` 2026-09-24），但外层 `expired` 字段为 2026-10-24 ⇒ 结构易误导 | 已在安全测试中以**真实查询**判定可用性，而非只读过期时间戳 |
| **OBS-J** | `.tcb-home/` **原先未被 `.gitignore` 覆盖**（若有人把凭证放仓库内将泄漏） | ✅ **已修**：`.gitignore` 新增 `.tcb-home/` / `.tcb-keys/` / `**/.cloudbase/` / `**/auth.json` / `**/*.tcbkey` |
| **OBS-K** | 若 owner 提供的是**权限过宽**凭证 | 本任务只调用**只读** API；若发现过宽 ⇒ 登记 `CREDENTIAL_SCOPE_TOO_BROAD`（当前未发生，因凭证不可用） |
