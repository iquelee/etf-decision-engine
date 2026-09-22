# 生产部署台账（append-only）

> **本文件是 append-only。** 线上基线一律以「追加一行」的方式记录，
> **不改动历史行**；如需更正，另起一行并标注 `supersedes` / `errata` 关系。
>
> 与 `docs/主链冻结契约.md` 的关系：契约里的 2026-09-05 记录是**当时的事实**，
> 本台账**不覆盖、不重写**它；只在其后追加，并用 `errata` 指针说明哪些字段已经过期。
>
> 建立日期：2026-09-22（V3.6.4 Safety Hardening 资格化）
> 环境：`tradingview-etf-d0fa42yy57cbc11b`（腾讯云开发 CloudBase，上海，个人版，NoSQL 后端）

---

## 0. 字段口径（重要，避免误比）

| 字段 | 含义 | 取法 |
|---|---|---|
| `deploy/mod_time` | 线上函数最后修改时间 | CloudBase `queryFunctions.getFunctionDetail` 的 `ModTime` |
| `source_repo_sha` | 该次部署对应的仓库提交（**推定**，非线上自证） | 该时间点之前最后一个 commit |
| `package_sha256` | 线上函数代码包 SHA256 | `getFunctionDownloadUrl` 的 `CodeSha256`；与本地下载 zip 重算逐位比对 |
| `index_sha256_raw` | `runDecisionEngine/index.js` 原始字节 SHA256（含 CRLF） | 下载包解压后 `sha256sum` |
| `index_sha256_lf` | 同上，但 **LF-normalized**（本仓锁文件的 `hash_basis`） | `content.replace(/\r\n/g,'\n')` 后 sha256 |
| `source_parity` | 线上包 vs 仓库源码的逐文件对账结论 | 解压线上包（排除 `node_modules` / `config.json` / 2 个 Gen-1 封印 JSON）后逐文件 SHA256 比对 |

⚠️ **`package_sha256` 与 `index_sha256` 是两种不同的东西**，不可互相比较：
前者含 `node_modules` / `config.json` 等，同一份源码重新打包也会得到不同的 zip 字节。

---

## 1. 部署 / 核验记录

### D-001 · 2026-09-05 · 首次记录部署（V3.6.1 切流后）

| 项 | 值 |
|---|---|
| `deploy/mod_time` | 2026-09-05 14:01（**来源：契约文档记载**，非本次实测） |
| `source_repo_sha` | N/A —— **早于本仓提交历史**（本仓首个 commit 为 2026-09-08 10:59:17 `8fc3ba66da6cb99b9da22b8933d59d582ddb8982`） |
| `package_sha256` | `7876610f…82e6315d`（**仅存于 `docs/主链冻结契约.md` §1，本次无法复算**：该包已被后续部署覆盖） |
| `index_sha256_raw` | 未留存 |
| `source_parity` | 未核验 |
| evidence | `docs/主链冻结契约.md` §1 表格 |
| 状态 | **既成历史记录，不作为当前基线** |

### D-002 · 2026-09-17 · GE-03 重部署

| 项 | 值 |
|---|---|
| `deploy/mod_time` | **2026-09-17 14:24:41**（2026-09-22 只读实测 `ModTime`） |
| `source_repo_sha`（推定） | `eefbedf28f547667c8557f055e6c4fc0891f8132`（2026-09-17 13:48:22，`Merge pull request #47 from iquelee/ge03-shadow-guarded-rerun`） |
| `package_sha256` | 未在当日留存；**2026-09-22 实测 = `a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608`** |
| `index_sha256_raw` | `da4910cae28476e6…`（2026-09-22 实测，与线上下载包内字节一致） |
| `index_sha256_lf` | `36be942f97d94fde…`（仓库侧同口径复算，`git show eefbedf:cloudfunctions/runDecisionEngine/index.js`） |
| `source_parity` | **MATCH 66 / 66**（2026-09-22 复核） |
| evidence | `_v361-r1-baseline-20260922/BASELINE_EVIDENCE.md`、`_v361-r1-baseline-20260922/parity.json`、`_v361-r1-baseline-20260922/runDecisionEngine.online.zip` |

### D-003 · 2026-09-22 · 只读核验（V3.6.4 资格化前置）

| 项 | 值 |
|---|---|
| `deploy/mod_time` | **2026-09-17 14:24:41（未变）** ⇒ 自 D-002 之后**未再部署** |
| 函数元数据（实测） | `Runtime=Nodejs16.13` · `FunctionVersion=$LATEST` · `CodeSize=3984731` · `Status=Active/Available` · `Timeout=120` |
| `package_sha256` | `a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608`（API `CodeSha256` 与本地下载 zip 重算**逐位一致**） |
| `index_sha256_raw` | `da4910cae28476e6…` |
| `source_parity` | **MATCH 66 / 66**（ONLY_ONLINE 0 / ONLY_REPO 0 / CONTENT_DIFF 0） |
| 当前仓库基线 | `origin/master = 650db58639f32232ac72a99920060dd92e743621` |
| evidence | 同 D-002 |

### D-004 · 2026-09-22 · V3.6.4 runDecisionEngine Production Promotion

> 授权范围：**仅** `runDecisionEngine`，一次。**不含** `materializeIndicators`、不含任何其他云函数。
> `PRODUCTION PROMOTION AUTHORIZATION = GRANTED — RUNDECISIONENGINE ONLY`

| 项 | 值 |
|---|---|
| `deploy/mod_time`（NEW） | **2026-09-22 16:29:48**（2026-09-22 只读实测 `ModTime`） |
| `deploy/mod_time`（PREVIOUS） | `2026-09-17 14:24:41`（= D-002 / D-003 基线） |
| 函数 | `runDecisionEngine`（`FunctionId = lam-eiye285p`） |
| Runtime / Handler | `Nodejs16.13` / `index.main`（**部署前后未变**） |
| `CodeSize` PREV → NEW | `3984731` → `4013498`（+28 767；= 8 个新增 + 6 个修改的 common 源文件） |
| `previous_package_sha256` | `a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608` |
| `new_package_sha256` | `aa576c20599528a66737f154b31b8cca87f25c1cf50068093bc243ed7084caea`（API `CodeSha256` 与本地下载 zip 重算**逐位一致**） |
| `previous_index_sha256_raw` | `da4910cae28476e6c1605b4043b29ee6afda558f43685c8d0f73da353fc26024` |
| `new_index_sha256`（LF） | `072b40089c7bc260a888bda913e68b1afb546b49a3d19ef88d4eec7fe9ae477b` |
| `frozen_source_commit` | **`aa634e264270f26207c59c19ef3e1c31dde01e64`**（tag `v3.6.4-frozen^{}`；用 `git archive` 取干净归档后构建，**非审计分支、非工作区**） |
| `master_containing_commit` | `519c3559c9840fa954e3357d665635fd1f97648c` |
| `source_parity` | **MATCH 77 / 77**（ONLY_LIVE 0 / ONLY_CAND 0 / CONTENT_DIFF 0；线上源码 == frozen V3.6.4 预期部署源码） |
| 部署前预检 | `UNEXPECTED_PACKAGE_DIFF = 0`（新增 8 = 期望集、修改 6 = 期望集、删除 0、`node_modules` 1703 文件逐位一致） |
| `param_config` changed | **NO** |
| `materializeIndicators` changed | **NO**（`ModTime` 仍 `2026-09-08 11:35:24`、`CodeSize` 仍 `4073486`、`CodeSha256` 仍 `9642cae255536f5ed1ac040d2891c6152ffba7c7f02fc3a859703ab2d7d44302`、COS 对象 UUID 未变） |
| 其余 9 个云函数 | **未触碰**（本轮零调用） |
| `rollback artifact` | `_v364-deploy/rollback/runDecisionEngine.PREVIOUS.a694b7d3.zip`（3 984 731 bytes，本地重算 SHA == PREVIOUS_PACKAGE_SHA） |
| evidence | `_v364-deploy/preflight_diff.json`、`_v364-deploy/postcheck_parity.json`、`_v364-deploy/postcheck/runDecisionEngine.NEW.aa576c20.zip`、`_v364-deploy/rollback/` |
| 部署后状态 | ⚠️ **首笔自然生产运行尚未发生** ⇒ 当时只能记为 `FROZEN / MERGED / DEPLOYED`，**不得**记为 `/ PRODUCTION`（见 D-004 备注） |
| 备注 | 未为验证幂等性人为触发任何生产运行。后续另起一行（D-005 或勘误）登记首笔自然运行验收结果，**不得改写本行**。 |

---

## 2. 勘误指针（不改历史行）

| # | 对象 | 已过期的字段 | 现状 | 处理 |
|---|---|---|---|---|
| E-001 | `docs/主链冻结契约.md` §1 `runDecisionEngine` 行 | `SHA256 = 7876610f…82e6315d`、`部署时间 = 2026-09-05 14:01` | 线上实为 `a694b7d3…` / `2026-09-17 14:24:41`（见 D-002/D-003） | **不修改契约文档**（历史事实）；以本台账 D-002/D-003 为当前基线 |
| E-002 | 同上 · 其余 9 个函数的 SHA 列 | 均为 2026-09-05 时点值 | **本次仅核验了 `runDecisionEngine`**；其余 9 个函数的线上包 SHA **未重新对账** | 待单独立项（逐函数下载重算） |

---

## 3. 后续追加规范

1. 任何一次**线上部署**（无论谁执行）都必须在 `## 1.` 末尾**追加**一行 `D-xxx`，字段照抄上表。
2. 任何一次**只读核验**（未部署）也追加一行，`deploy/mod_time` 填「未变」。
3. 只允许追加；更正用新行 + `supersedes: D-xxx`。
4. `source_repo_sha` 若无法确证，必须显式写「推定」，不得默认属实。
5. 不得在此文件写入密钥、envId 之外的真实凭据、或任何个人资金数据。
