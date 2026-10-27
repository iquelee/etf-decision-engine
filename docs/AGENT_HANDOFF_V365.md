# AGENT HANDOFF — etf-decision-engine / V3.6.5 生产完整性

> 生成：2026-09-24（GMT+8）｜生成者：前任 agent（阿衡）
> 状态：**本地未跟踪草稿**（未 commit / 未 push）—— 若需随仓库传播，须 owner 单独授权。
> 交接锚点：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（分支 `feat/v365-production-integrity-impl`）
> ⚠️ 本文件含**时点观测**。凡标 🕒 者**必须自己探一次再用**，理由见 §4。

---

## §0 交接边界（这条优先于本文件其余全部内容）

- **只读是默认。** 任何写入（改文件 / commit / push / 建 PR / merge / freeze / deploy / 改线上数据 /
  改 `param_config`）**均需 owner 当轮显式授权**。
- **你继承零授权。** 前任取得的任何 `AGENT MERGE AUTHORIZED` 都**逐位绑定了当时的 40 位 SHA**，
  HEAD 一变即失效，**与你无关**。授权不随项目转移。
- **当前任务的显式禁止项 > 一切历史文档 / 默认策略 / 旧授权**（`GI-001`）。
- 被 `ml/manifests/*_LOCK.json` 钉死的文件**不得静默修改**；要改只有「显式重锁」或「升版」两条路，均需授权。
- 不确定就**停下问**，**不要自行选边**；口径冲突要「**登记 + 给 2–3 个选项**」。

---

## §1 30 秒定位

- **项目**：腾讯云开发 CloudBase 上的 ETF 智能仓位决策系统（envId `tradingview-etf-d0fa42yy57cbc11b`）。
  5 只标的：513310 storage / 515880 ai_network / 159582 semi_equip / 518880 gold / 159570 biotech。
- **生产版本**：**V3.6.4 = `FROZEN / MERGED / DEPLOYED / PRODUCTION`**
  （tag `v3.6.4-frozen^{}` = `aa634e264270f26207c59c19ef3e1c31dde01e64`）。
- **在途版本**：**V3.6.5「生产完整性」= 受控解冻 + 重新封版**。
  **定位 = 只修生产基础设施，不优化策略**；唯一硬目标 = 正常输入下与 V3.6.4 的
  `final_target` / `final_action` / `trend_stage` **逐位一致**（`UNEXPECTED_DECISION_DELTA = 0`）。
- 在途分支 **未 push / 未 PR / 未 merge / 未 deploy** ⇒ **生产当前仍是 V3.6.4 的行为**。
- **下一步入口：HD-10（已完成）→ 生产提升 / 数据侧就绪。**
  ⚠️ 2026-09-29 更新：**RH1~RH4 代码侧已完成**（契约登记 / RDE 写侧接线 / supersede 链 / CLASS C 读者）；
  ✅ **HD-10 生产建表已 COMPLETE**（owner `APPROVED`；5/5 集合 + 7/7 索引；`CREATE EMPTY STRUCTURE ONLY`）。
  ⛔ **但 `RUN_HISTORY_INDEX` 仍 = `PENDING`** —— 缺的是**数据侧**：生产提升未发生
  （5 集合全部 `n=0`）+ `V365_ENFORCE_SWITCH_DATE = null` ⇒ `run_axis_available = false`。
  ⇒ 下一步 = **生产提升 / 切换日登记**（owner），⛔ 非「再写代码」，⛔ 亦非「再建表」。
  ⛔ **HD-10 授权不含任何业务写入** ⇒ 不得据它做 pointer 初始化或 run 写入。

### 1.1 真仓库与假仓库

- **真仓库**：`<root>/etf-decision-engine/etf-decision-engine`（remote `iquelee/etf-decision-engine`）。
- ⚠️ `<root>/etf-decision-engine`（上一层）**也是 git 仓库但没有 commit**；
  🕒 `git worktree list` 显示 **17 个 worktree**（`_v365-*` / `_v3-contract-*` / `etf-decision-*` 等）。
  **⛔ 不要把它们的 `git status` 当成项目状态。**

---

## §2 可核验锚点（请把自己实测值填进「你测到」，逐格回填）

| # | 项 | 期望值 | 你测到 |
|---|---|---|---|
| 1 | `git rev-parse HEAD` | `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` | |
| 2 | `git rev-parse --abbrev-ref HEAD` | `feat/v365-production-integrity-impl` | |
| 3 | `git rev-parse "v3.6.4-frozen^{}"` | `aa634e264270f26207c59c19ef3e1c31dde01e64` | |
| 4 | `git ls-remote origin refs/heads/master` | `e93f396870b601d49d61d3a6e955596bc91b2ad5` | |
| 5 | `git rev-list --left-right --count origin/master...HEAD` | `0	14`（behind 0 / ahead 14） | |
| 6 | `git status --short` | **空**（工作区干净） | |
| 7 | 本分支 vs master 改动面 | `49 文件（42 A / 7 M）`，`+12963 / −47` | |
| 8 | 合格面文件数（manifest） | **20** | |
| 9 | P-12 parity anchor | `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723` | |
| 10 | 资格门 Q1 replay anchor | `cce9ccbfbf67a1268790da4e2865b7af0c5328eebe752a88d1266de0961fb554` | |

⚠️ #9 与 #10 是**两个不同度量**（`sha256(stableStringify(...))` vs `JSON.stringify(...)`）。
**数字不同 ≠ 行为变了**——先确认是不是同一度量再说话。

---

## §3 门禁清单（单条命令，你应能跑出同样数字）

```bash
cd <真仓库根>
node scripts/verify-immutable.js                # 期望 Immutable SHA 23/23
node scripts/verify-gen1-pipeline.js            # 期望 Gen-1 Feature Pipeline Lock 10/10
node scripts/verify-gen2-build-artifacts.js     # 期望 WP-G2-04 构建产物 7/7
node scripts/v365-qualification-gate.js         # 期望 PASS 38/38（Q7 = single-document CAS）
node scripts/v365-reader-migration-gate.js      # 期望 Reader Gate PASS 8/8
node scripts/verify-v365-candidate-manifest.js  # 期望 20 个合格文件逐字节一致
node tests/v365-reader-migration.test.js        # 期望 19 passed, 0 failed
node scripts/v365-p12-decision-parity.js        # 期望 UNEXPECTED_DECISION_DELTA = 0
```

🕒 `npm test`（= `scripts/test-all.js`）在前任这条通道上**会因沙箱禁止 Node 子进程而崩**
（`spawnSync` 返回 `EBUSY`）⇒ 前任改用 **bash 直调**每个脚本。
**你那条通道可能可以跑 —— 自己试一次再决定**（探测命令见 §4）。

---

## §4 环境自检（⚠️ 先探再假设）

> 交接文档最危险的失效模式 = 把**时点观测**写成**永久环境事实**。
> 前任的实测**只对「2026-09-24 · 前任这台机器 · 前任这条通道」成立**。
> 你若直接抄结论，可能**放弃一条本来可用的路**，或在某天工具真缺席时翻车。

| # | 前任观测 🕒 | 探测命令 | 为什么不能直接抄 |
|---|---|---|---|
| 1 | 沙箱**禁止 Node 子进程**（`spawnSync/execSync` 恒 `EBUSY`） | `node -e "console.log(require('child_process').spawnSync(process.execPath,['-e','0']).error)"` | 这是沙箱策略，随会话/配置变 |
| 2 | 本机**无 Node 16**（线上运行时是 `Nodejs16.13`） | `node -v` | 你可能装了多版本 |
| 3 | 仓库根**无 `node_modules`**（依赖在各 `cloudfunctions/*/package.json`） | `ls node_modules 2>&1` | 你可能已 `npm i` 过 ⇒ 结论反过来 |
| 4 | PATH 上的 `python` **无 numpy/pandas** | `python -c "import numpy"` | 你可能另有 conda/venv |
| 5 | 出网间歇 `ECONNRESET` | 跑一次 `git ls-remote origin` | 网络状况随时间变 |
| 6 | CloudBase 连接器会话**已过期** ⇒ 生产侧读数 `UNVERIFIED` | 调 `listFunctions`，若返回 `AUTH_REQUIRED` ⇒ 需 owner 完成设备码授权 | 凭据/会话有效期与你无关但决定你能看到什么 |

**规则**：`command -v <tool> && <tool> --version`，**先探一次**，再决定走哪条路。

---

## §5 权威文档地图（按此顺序读）

1. `docs/V365_PRODUCTION_INTEGRITY_READINESS.md` — §15–§23；P-1/P-1A/P-2/P-3/P-4 全 CLOSED。
2. `docs/V365_AUTHORITATIVE_CONSUMER_MAP.md` — 30 个读取点 + 5 端点硬约束。
3. `docs/V365_READER_MIGRATION.md` — Reader Migration 全貌。⚠️ **§7.5 有一处错，见 §6.3。**
4. `docs/V365_PLATFORM_CAS_EVIDENCE.md` — Q7 平台实证（`TRANSACTION_REQUIRED = NO`）。
5. `docs/production-deployment-ledger.md` — append-only 台账（D 6 / E 5）。
6. `docs/governance/GOVERNANCE_INCIDENTS.md` — `GI-001`（当轮禁止项优先）/ `GI-002`（占位符授权违规）。
7. `MEMORY.md`（跨会话索引）+ `MEMORY_ARCHIVE_2026-09.md`（各版逐字全文）+ `2026-09-2{2,3,4}.md`（日志）。
   ⚠️ `MEMORY.md` 体积**卡在预算线上**（见 §6.4）。
8. `docs/Test-And-CI-Gates.md` — 门禁总览。

---

## §6 未决事项（⛔ 不得自行选边，须 owner 裁定）

### 6.1 `NEW_FAILURES = 1`（最近一次复核发现，文档尚未反映）
`tests/gen1-ui-contract.test.js:374`
`assert.ok(/COLLECTIONS\.DECISION_RESULT/.test(admin), 'admin health 必须读 decision_result')` **FAIL**。
根因：Reader Migration 把 `adminGateway.getGen1Health` 改走 resolver ⇒ `cloudfunctions/adminGateway/index.js`
**零处** `DECISION_RESULT`（baseline 是 `index.js:73 db.query(COLLECTIONS.DECISION_RESULT, …)`）。
性质 = **静态契约守卫与新实现脱节**（功能上仍读同一集合），**不是数据正确性缺陷**。
证据：基线树 3 项失败 vs 候选树 4 项失败（同一 3 项 + 本项）。
三选项：① 更新守卫以接受 resolver 形态；② `adminGateway` 保留显式引用；③ 判为可接受并登记白名单。

### 6.2 资格门 banner 文案落后
`scripts/v365-qualification-gate.js:591` 仍打印「READER_MIGRATION / RUN_HISTORY_INDEX 仍 PENDING」，
与 `v365-reader-migration-gate.js` 的 `READER_MIGRATION = COMPLETE` **互相矛盾**（纯文案，非功能）。

### 6.3 文档需原位勘误
`docs/V365_READER_MIGRATION.md` §7.5 记的 candidate「**56 passed / 3 failed**」「**零新增失败**」
与实测（**55 通过 / 4 失败**）不符。勘误规则：**原位升版本 + 修订说明，不改判据/红线**。

### 6.4 `MEMORY.md` 已贴在预算线
实际 `6,239` 字符 / 预算 `6,240`（附 `bytes 9,018 / 9,806`）。
**这是故意的**：你要加内容就会先撞上 `verify-memory-budget.py` 的断言，被迫做一次**有意识**的
「压缩 or 下移进 archive」决策，而不是无声长回截断崖边。⛔ 不要放宽 `0.78` 系数。

---

## §7 已知坑（前任踩过，别再踩）

1. `git ls-remote` **失败时输出空且 exit 0** ⇒ 断言远端内容前，**先确认已刷到预期 SHA**。
2. **同一文件的多条 `Edit` 必须串行**：并行会基于同一旧快照互相覆盖，**只有最后一条落盘**，
   而工具**全部**回显 `success`。不同文件之间才可并行。
3. 写入后**必须内容断言**，⛔ **不以工具 success 为证据**。⚠️ 断言前**先剥离注释**
   （`codeOnly = src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1')`），
   否则解释性注释会误命中。⚠️ `wc -c` 是**字节**、`str.length` 是**字符**（中文差 3 倍）。
4. 「某文件返回哪些字段」**必须 `Object.keys(实跑结果)`**；正则只能**定位**，不能计数、不能判集合相等。
5. **anchor 有两个判据**（见 §2 #9/#10），别混。
6. 「行为等价」的最强证明 = **跨树同度量对照**：
   `git worktree add <tmp> origin/master --detach` —— ⚠️ **必须把 gitignored 的 `deliverables/`
   （行情 CSV）复制进 worktree**，否则 replay harness 报 `DATA_MISSING`；
   同一 anchor 函数在两棵树上算 → **逐位相同才算 Δ=0**。
7. 本机**既有失败**（环境相关）基线 = `{gen1-ge03-regression-guard, gen1-parity, gen2-scenario-parity}`。
   🕒 你那条通道**自己跑一遍确认**这个集合。
8. 判「今天跑没跑」：✅ `queryLogs searchLogs` 用独立字段
   `function_name:"X" AND log:"START RequestId"`（写成 `log:"X"` **恒 0 条**，会误判没跑）。
9. 部署纪律：候选包**必须** `git archive <frozen-sha> | tar -x` 再 build，
   ⛔ 不用审计分支/未提交工作区；部署后**只读核验云函数 `ModTime`**；⛔ 不为验幂人为触发生产。

---

## §8 你要交的复述（我会按四类逐条核，不整段读）

交一份**纯事实复述**，包含：
1. §2 锚点表**填满**（你的实测值，不是抄期望值）；
2. 你跑出的 §3 门禁数字；
3. §4 环境自检的**逐条结果**，并**显式列出与前任观测不一致的项**；
4. 你说的「下一步该做什么、为什么」；
5. 你识别出的**不确定点**（宁可写"不确定"，不要猜）。

我会把你的每条主张打成四类：
**A 事实错**（数字/路径/状态值/方向）· **B 口径混用**（结论对但把 A 概念的名字贴在 B 上）
· **C 数字口径**（条目数/字段数/版本号）· **D 自指精度**（自称"未做任何 X"但其实只读地做过）。

---

## §9 给接手 agent 的第一条指令模板（owner 可直接粘贴）

```text
项目：etf-decision-engine / V3.6.5 生产完整性
真仓库：<真仓库绝对路径>
先读：docs/AGENT_HANDOFF_V365.md（全文，含边界与未决事项）

本轮只做两件事，**默认只读**：
1) 按交接文件 §2/§3/§4 自己实测锚点、门禁、环境，**回填你测到的值**；
2) 按 §8 交一份纯事实复述（含你识别出的不确定点）。

⛔ 本轮禁止：任何写入（改文件/commit/push/建PR/merge/freeze/deploy）、改线上数据或 param_config、
修改任何 *_LOCK.json 钉死的文件、恢复 breakout_nd、启用 Portfolio Mode、
自行裁定 §6 的未决事项。
⛔ 授权不随项目转移：前任的任何授权对你无效。
⚠️ 交接文件里的 🕒 观测只对前任那条通道成立 —— **先探再假设**。
```

---

## §10 接手方 = 本机 WorkBuddy 国际版（2026-09-24 追加）

### 10.0 已探明的事实（实测，非推测）

| 项 | 国内版（前任） | 国际版（接手方） | 结论 |
|---|---|---|---|
| 安装目录 | `AppData/Local/Programs/WorkBuddy/` | `AppData/Local/Programs/WorkBuddyAI/` | 两套并存 |
| 用户级目录 | `~/.workbuddy/` | `~/.workbuddy-ai/` | **不共享** |
| 项目级目录 | `<工作区根>/.workbuddy/` | 同（bundle 内含 `.workbuddy/memory`、`MEMORY.md` 字面量） | **同源** |
| 用户级 `MEMORY.md` | 27,619 B（阿衡 + 李其 + 跨项目纪律） | 3,528 B（讲 `jev_decide`） | **内容不同** |
| `IDENTITY/SOUL/USER` | 阿衡人设已定稿 | 仍空模板，`BOOTSTRAP.md` **尚在** | **未继承** |

### 10.1 你会**自动**看到的（什么都不用做）

在 `<工作区根> = D:/AI-Projects/Codex/etf-decision-engine` 打开时，项目级记忆与你共享：
`MEMORY.md`（6,239 字符，卡在预算线）/ `MEMORY_ARCHIVE_2026-09.md`（各版逐字全文）/
`2026-09-22.md`·`2026-09-23.md`·`2026-09-24.md`。
⚠️ 但**不要当成「你已经读过了」**——按 §8 交复述时，凡引用记忆里的结论，**回文件核原文**。

### 10.2 你**不会**自动继承的（必须显式处理）

1. **人设 / 称呼 —— owner 已裁定：不沿用。**
   你保留**自己**的身份与语气（前任那套「阿衡 / 直给少客套」与你无关，不要模仿）。
   ⚠️ 但**项目纪律照旧适用**：§0 边界 / §7 已知坑 / 项目 `MEMORY.md` 里的报告四块式、口径冲突登记不选边、权限纪律 —— 那是**项目规范**，不是人设。
   ⛔ 前任**未写入、未删除** `~/.workbuddy-ai/` 下的任何文件（含 `BOOTSTRAP.md`）；你按自己的流程处置。
2. **跨项目纪律**（报告四块式 / 同文件 Edit 串行 / 未授权不联网不提 PR 等）：只存在于国内版用户记忆里
   ⇒ 已在 §3、§7 与项目 `MEMORY.md` 里**重复登记**，以本文件与项目记忆为准。
3. **连接器与凭据**：GitHub PAT（`~/.workbuddy/gh_token.txt`）、CloudBase 会话、venv、SSH key
   都是**前任那条通道**的状态 ⇒ 🕒 自己探（§4）。
   ⚠️ **不要照抄前任的 GitHub 写操作路径**（那个令牌文件在国内版目录下）；你要做任何写操作，先问 owner。

### 10.3 ★ 写入权已移交给你（owner 裁定，2026-09-24）

- **你是唯一写入者。** 前任（国内版）**自交接生效起即停写**——它的最后一次写入就是本次交接（交接书 + 项目记忆 + 日志）。
- **写入互斥仍成立**：同一份 `.git`、同一个工作区，**两个 agent 同时写会互相覆盖**；`.workbuddy/memory/` 日志是 **append-only**，并发写会丢行。⇒ 默认你就是那一个；但若 owner 之后又启用其他实例，**先确认它停手再写**，⛔ 不要假设。
- ★ **写入权 ≠ 任务授权：** 你仍需 owner 逐项授权才能动手（见 §0）。本轮任务仍为**只读**。

### 10.4 你的自检（先做这三条，再谈别的）

```bash
cd D:/AI-Projects/Codex/etf-decision-engine/etf-decision-engine
git rev-parse HEAD               # 期望 c6bd006fd76ffc5358cddd07347df8ed23d9e61d
git rev-parse --abbrev-ref HEAD  # 期望 feat/v365-production-integrity-impl
ls ../.workbuddy/memory/         # 期望见 MEMORY.md / MEMORY_ARCHIVE_2026-09.md / 2026-09-24.md
```

### 10.5 你的第一条指令（owner 可直接粘贴）

```text
你是本机 WorkBuddy 国际版。项目：etf-decision-engine / V3.6.5 生产完整性。
工作区根：D:/AI-Projects/Codex/etf-decision-engine（真仓库在其下的 etf-decision-engine/）

先完整读 docs/AGENT_HANDOFF_V365.md，重点 §0（边界）§6（未决事项）§10（你这一版的注意事项）。

本轮只做两件事，**默认只读**：
1) 跑 §2 锚点表 + §3 门禁 + §4 环境自检 + §10.4 自检，回填**你实测**的值；
2) 交 §8 的纯事实复述（含你识别出的不确定点）。

⛔ 本轮禁止：任何写入（改文件/commit/push/建PR/merge/freeze/deploy）、改线上数据或 param_config、
改任何 *_LOCK.json 钉死的文件、恢复 breakout_nd、启用 Portfolio Mode、自行裁定 §6 未决事项、
自行写入或删除 ~/.workbuddy-ai/ 下的身份文件（BOOTSTRAP.md 不要删）。
⛔ 授权不随项目转移；前任的任何授权对你无效。
⚠️ 🕒 标注的观测只对前任通道成立 —— 先探再假设。
⚠️ 写入权已移交给你（§10.3），但**写入权 ≠ 任务授权**：本轮仍为只读，除非 owner 在同一条指令里单独给出具体写入范围。
```

---

## Current Resolution Update 2026-09-24

> ★ **追加章节（append-only）。** 上文章节（含 §6 未决事项、§7 已知坑）的历史判断**一律保留、⛔ 不删除、不追溯改写**。
> **当前状态以本章节为准**；凡上文与本章节冲突处，以本章节为准。
> 本章节由接手方（本机 WorkBuddy 国际版）在 owner 逐项授权后写入。

### CRU-1 旧状态（本章节要取代的记录）

```
NEW_FAILURES = 1
READER_MIGRATION = PENDING
```

### CRU-2 对应解决

```
schema telemetry registration completed
gen1-ui-contract guard updated
Reader Migration COMPLETE
Stage A:
59/59
NEW_FAILURES:
0
```

| 旧 blocker | 解决动作 | 落点 |
|---|---|---|
| `NEW_FAILURES = 1`（§6.1：`gen1-ui-contract` 静态守卫与 resolver 形态脱节） | **gen1-ui-contract guard updated** —— 守卫改为判**读取形态**（必须经 run-pinned 权威解析器），不再判旧集合名；并加反向断言「⛔ 不得直读 `decision_result` 取最新（历史读取须带 `v365-reader-allow:` 标记）」 | `tests/gen1-ui-contract.test.js` |
| （复核时**新发现**）D12 前向 fail-closed：`runtime_status` 出现 4 个未登记写入字段 | **schema telemetry registration completed** —— 在 `runtime_status` 段补齐登记 `v365_mode`(string) / `v365_run_integrity`(object) / `v365_finality_status`(string) / `v365_authoritative_published`(boolean)，均 `required:false` | `src/common/schema.js` |
| `READER_MIGRATION = PENDING` | **Reader Migration COMPLETE** —— Reader Gate `PASS 8 / 8`；§7.5 数字勘误为 `59 / 0`；资格门 banner 同步 | `docs/V365_READER_MIGRATION.md`、`scripts/v365-qualification-gate.js` |

### CRU-3 当前状态

```
V365_IMPLEMENTATION = QUALIFIED_CANDIDATE
Writer:
QUALIFIED
Reader:
COMPLETE
RUN_HISTORY_INDEX:
PENDING
```

### CRU-4 说明

- **历史 blocker 保留**：§6.1–§6.4 的原判断**逐字保留在上文**，⛔ 不删除；处置状态见 CRU-2。
- **当前状态以本章节为准**：上文与 CRU-1 / CRU-3 冲突处，以本章节为准。
- ⛔ `V365_IMPLEMENTATION = QUALIFIED_CANDIDATE`（资格门 `PASS 38 / 38` 输出）**≠ `PRODUCTION AUTHORIZED`**；
  FREEZE / PR / MERGE / DEPLOY 均需**单独授权**。
- ⛔ `RUN_HISTORY_INDEX = PENDING` 仍为真 —— ⚠️ **2026-09-29 二次精化**：RH1~RH4 **代码侧已完成**
  （`tests/v365-rh1~rh4-*.test.js` 全 PASS）；**HD-10 结构侧已完成**（5 集合 + 7 索引已建）。
  PENDING 的**唯一原因**是**数据侧**：
  ① 5 个 v365 集合全部 `n=0`（`CREATE EMPTY STRUCTURE ONLY`，⛔ 无业务写入）；
  ② 无生产提升发生 ⇒ `active_run_pointer` 无行 ⇒ CLASS C 如实报 `run_axis_available = false`；
  ③ `V365_ENFORCE_SWITCH_DATE = null`（部署时登记）。
  ⇒ **下一步 = 生产提升 + 切换日登记**（owner）；⛔ 不得因「测试全绿」或「集合已建」改写此状态。
  ⛔ **HD-10 授权仅覆盖空结构创建** —— 不得据此做任何业务写入 / pointer 初始化。
- ⚠️ **对 §6.1 定性的一处修正**（我自标 **B 类：口径混用**，出在上文）：§6.1 称「功能上仍读**同一集合**」**不成立** ——
  resolver 读的是 `run_candidate_decision`（+ `run_manifest` + `active_run_pointer`），**不是** `decision_result`，是两个集合。
  结论（走「更新守卫」）不变，**理由改为**「权威来源已迁移，守卫须跟着迁移」。
- ⚠️ **§6.2 / §6.3 / §6.4 处置**：§6.2 banner **已改**；§6.3 §7.5 勘误 **已做**（`56/3` → `59/0`，原记录 append-only 保留）；
  §6.4 `MEMORY.md` 仍贴预算线（**未动** —— 记忆写入需单独授权）。
- ⚠️ **§4 与 §7 的通道相关观测经复核需修正**：§4 #1（沙箱禁 Node 子进程）在本机通道**不成立**；
  §7 #7 的「既有环境相关失败集 `{gen1-parity, gen1-ge03-regression-guard, gen2-scenario-parity}`」在本机通道**不复现**
  （基线树 51/51 全绿）—— 那 3 个是**全库仅有的**自身调用 `child_process` 的测试，在前任通道 `spawnSync` 恒 `EBUSY` ⇒ 必然全红。
  且 `gen1-ge03-regression-guard` 在候选树上另有**真实新增失败**（D12），在前任通道被 spawn 失败**掩盖**。
- ✅ **§7 #4 经复核为真，未改**：`v365-p12-decision-parity.js` 确会把 `cloudfunctions/runDecisionEngine/index.js`
  判为「决策核心被改动」⇒ **传 `--changed-file` 清单时 exit 1**（默认调用无清单 ⇒ PASS + WARN）。该判据冲突**未解决**。

### CRU-5 本轮变更面（截至 2026-09-24）

| 文件 | 变更 |
|---|---|
| `src/common/schema.js` | +7 / −0（4 个 telemetry 字段登记） |
| `tests/gen1-ui-contract.test.js` | +9 / −1（守卫改判新形态） |
| `scripts/v365-qualification-gate.js` | +2 / −1（banner 状态串） |
| `docs/V365_READER_MIGRATION.md` | +27 / −6（§7.5 勘误 + §9 状态） |
| `docs/V365_PRODUCTION_INTEGRITY_READINESS.md` | +9 / −3（§23.8 状态收口） |
| `docs/V365_PLATFORM_CAS_EVIDENCE.md` | +2 / −1（reader migration 状态） |
| `docs/V365_AUTHORITATIVE_CONSUMER_MAP.md` | +3 / −2（状态块） |

⛔ 未改：业务代码 / reader resolver / writer / 决策核心（`decision.js`·`decision-v3.js` 等）/ 任何 `*_LOCK.json` 钉死文件 /
`param_config` / 线上数据 / `~/.workbuddy-ai/`。
⛔ 未 deploy / 未 push / 未 PR / 未 merge / 未 freeze。
仓库 HEAD 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`（分支 `feat/v365-production-integrity-impl`，ahead 14 / behind 0）。

### CRU-6 复验（本章节写入时的实测值）

| 项 | 值 |
|---|---|
| Stage A | **59 / 59 通过，0 失败**（基线树 `origin/master`：**51 / 51，0 失败**） |
| `NEW_FAILURES` | **0** |
| `verify-immutable` / `verify-gen1-pipeline` / `verify-gen2-build-artifacts` | 23/23 · 10/10 · 7/7 |
| `v365-qualification-gate` | PASS 38 / 38 |
| `v365-reader-migration-gate` | PASS 8 / 8（`READER_MIGRATION = COMPLETE`） |
| `verify-v365-candidate-manifest` | PASS（20 个合格文件逐字节一致；`candidate_content_sha = 485c0977952983253d9ed1fac62e1bb44e2e8f0cf8cce414c3ab4333b5a62254`） |
| `v365-p12-decision-parity` | `UNEXPECTED_DECISION_DELTA = 0`；anchor `25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723` |
| 生产侧 | CloudBase `ModTime` 仍 **UNVERIFIED**（本会话无该连接器） |
