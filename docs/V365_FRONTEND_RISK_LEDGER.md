# V3.6.5 前端重写 —— 风险与问题台账（FRONTEND RISK LEDGER）

> **性质**：前端重写阶段（`refactor/v365-frontend-*` 分支）的**问题登记簿**。
> ⛔ 本文件**只登记**，不构成修复授权；⛔ 不记录生产治理事项（那属
> `V365_PRODUCTION_READINESS_LEDGER.md` / `production-deployment-ledger.md`）。
> **维护规则**：append-only；每条问题给 ID、现象、证据、影响面、状态、**归属阶段**。
> **编号约定**：`KLINE-DATA-001`（数据正确性）· `FE-DEF-00N`（前端缺陷，已修）· `E-00N`（工程决策点）。

---

## KLINE-DATA-001 —— K 线数据严重滞后（★ 数据正确性 Blocker）

| 项 | 内容 |
|---|---|
| **ID** | `KLINE-DATA-001` |
| **级别** | **Blocker（数据正确性）** —— 不是前端缺陷 |
| **登记于** | 2026-09-30（M4-P1 阶段，只读侦察时发现） |
| **归属阶段** | **后端数据正确性阶段**（V3 阶段-1「数据正确性」） |

### 现象

`GET /api/etf/:code/kline?period=daily` 返回的**最后一根 K 线**远早于当前决策日：

| 标的 | K 线末端日期 | 决策日 | 差 |
|---|---|---|---|
| `513310` | `2024-08-27` | `2026-09-29` | ≈ **2 年** |
| `518880` | `2024-08-26` | `2026-09-29` | ≈ **2 年** |

### 已证实的证据

1. **线上只读复核**（2026-09-30，两次独立 GET）：
   - `513310`：bars=320，首 `2024-06-04`，末 `2024-08-27`；
   - `518880`：末 `2024-08-26`。
   - 返回条数**恰等于 limit（320）** ⇒ 强烈提示是「被 limit 截到了最早一批」。
2. **源码可证**（`cloudfunctions/apiGateway/index.js`，`getKline`）：
   使用 `orderBy: [{ field: 'trade_date', direction: 'asc' }], limit: 320`
   —— **升序 + limit** ⇒ 取到的是**最旧**的 320 根，而不是最新 320 根。
   （`weekly` 同样为 `asc` + `limit: 260`。）
3. 同批 K 线的 `amount` / `premium_rate` 字段 **320/320 全为 `null`**（死字段，另见 M4-P0 §F.8）。

### 未知（⛔ 未验证，不得当作已知）

- 数据库集合内 **2024-08 之后是否真的有数据** —— 需要 DB 只读权限，本轮**未取**。
  若集合内也无新数据，则问题不止是排序 bug，而是**上游同步中断**。

### 可能根因（★ 两者都未排除，⛔ 不选边）

| 代号 | 可能根因 | 说明 |
|---|---|---|
| **A** | **query ordering bug** | 仅需把 `asc` 改为 `desc`（或反向 + 再排序）。属取数方向错误。 |
| **B** | **上游数据同步停止** | K 线同步任务在 2024-08 后未再写入，排序正确但无新数据可返。 |

> ⛔ **本轮不判定 A 或 B** —— 没有 DB 只读证据，任何选择都是猜测。
> 判据（供后端阶段使用）：若把 `asc`→`desc` 后末端仍是 2024-08 ⇒ 根因 B；否则根因 A。

### 影响面

- **前端**：K 线图无法反映近两年走势（本页已按 `M4-D2` 裁定**照实绘制 + 显著标注时点**，⛔ 不遮挡、⛔ 不插值）。
- **决策**：若上游确有数据但未被取到，则任何依赖 K 线的分析/回测都建立在**残缺数据**上
  —— 这属**阶段-1 数据正确性**问题，优先级高于任何前端工作。
- **决策本身是否受影响**：`[UNKNOWN]` —— 需后端确认 `snapshot` / `decision` 是否另有独立数据源
  （本页观察：`snapshot.calc_date = 2026-09-29`，与 K 线末端**不一致**，提示两者数据源可能不同）。

### 前端处置（已完成，属本页职责范围）

1. **detect**：判定 K 线自身新鲜度（独立 SLA 域 `kline`，72h）。
2. **classify stale**：`STALE` + 严重滞后阈值（≥ 30 自然日 ⇒ 严重）。
3. **display provenance**：置顶 banner + 区块内时点标注，**日期全部来自实际数据**。
4. **⛔ 不做**：不改后端、不猜最新价、不隐藏历史数据、不把 K 线 stale 扩散成 decision stale。

### 阻塞？

- ⛔ **不阻塞 M4-P1 / M5**（前端只负责 detect / classify / display）。
- ✅ **阻塞「阶段-1 数据正确性验收」**（属后端阶段门槛）。

---

## FE-DEF-001 ~ 004 —— M4-P1 期间发现并**已修**的前端缺陷

> 登记目的：**防复发**。这些缺陷全部由「真实浏览器渲染核验」或「既有测试套件」抓出，
> 而非代码审查 —— 记录之，以证该两类验证不可省。

| ID | 现象 | 根因 | 检出方式 | 状态 |
|---|---|---|---|---|
| `FE-DEF-001` | Gen-1 整区**只剩标签、值全空** | adapter 透传裸 `Field`，而 `FieldValue` 只认 display 对象（形态错配） | **浏览器实看**（SSR 断言只查了标题/caveat ⇒ 漏检） | ✅ 已修 + 已加渲染守卫 |
| `FE-DEF-002` | `risk_flag="NORMAL"` 的 tone 掉成 `muted`（与「未知」不可区分）；`premium_flag` 显示成英文原文 | `normalizeRisk` 只比原样与全大写，而别名表键是**小写英文 + 中文** ⇒ `NORMAL` 两个都落空 | 既有测试（M4 新增断言） | ✅ 已修（M3 遗留，被中文值掩盖） |
| `FE-DEF-003` | 重写 `adaptEtfDetail` 时丢失 M2 的键（`position.band` / `decision.explainChain`），`scores`/`factors` 被 display 覆盖 | 用「新建平行结构」替代「在原结构上追加」 | **既有回归套件**（`adapters-pages` / `edge-malformed`） | ✅ 已修（改为 `...d` 平铺 + 新名追加） |
| `FE-DEF-004` | `fundamentalsSummary` 不可用时缺 `fScoreText` ⇒ SSR 渲染抛 `TypeError` | 缺失分支未返回**同形状骨架** | **SSR 渲染测试** | ✅ 已修 |
| `FE-DEF-005` | `decision` 缺失时 `adaptDefense` 读 `decisionVm.riskFlag` 抛 `TypeError` ⇒ **整页崩** | `adaptDecision` 的不可用分支只返回 3 个键 | 新增的 `etf-radar` 单测 | ✅ 已修（该分支改为返回**同形状完整骨架**） |

**共同教训**：`[SRC]` **「适配器输出形态」（裸 Field vs display 对象）必须在该模块头部显式声明**，
并在**渲染层**加断言 —— 仅断言"字段存在"抓不到形态错配。
★ 追加（`FE-DEF-005`）：**「不可用分支」也必须返回与正常分支同形状的完整骨架**；
靠下游逐个加防御是打地鼠 —— 骨架缺口必须在**产生它的那一层**补上。

---

## 后端数据侧观察（⛔ 只登记，不改）

> 前端做契约侦察时顺带发现的后端疑点。⛔ **未修改任何后端逻辑**。

| ID | 观察 | 证据 | 性质 |
|---|---|---|---|
| `DS-001` | **`defenseLevelFromScore` 区间重叠** | `src/common/utils/defense.js`：`if (score>=35) return 1; if (score>=20) return 1;` ⇒ 20~49 **全为 level 1**，level 2 只可能在 50~64 | `[AS-IS]` 可能是有意的粗分档，也可能是笔误 ⇒ **需 owner 判定**；⛔ 前端不介入、⛔ 不补偿 |
| `DS-002` | **顶层 `defense_score` / `defense_penalty` 与 `defense_state` 内字段冗余同源** | 实测恒相等（`37` / `0.95`） | 前端已做**交叉核对**（不一致时出警示），⛔ 不静默选边 |
| `DS-003` | **`level === 0` 时后端不返回 `score` / `factor` 键** | 线上 2026-08-25 及更早记录 | 前端按 `MISSING` 处理（⛔ 不补 0 / 1.00）✅ 已适配 |
| `DS-004` | **`fundamental.detail.final_signal` / `layer.signal` 量纲未由 schema 证实** | `schema.js` 无该内嵌对象的 desc | 前端只展示**原始值**并显式标注「不解释量纲」；口径确认后再决定是否换算 |
| `DS-005` | **`getDecisions` 走 `v365-reader-allow:history-deferred`** | `apiGateway/index.js` 注释：`RUN_HISTORY_INDEX=PENDING` | `[AS-IS]`；历史读取属「延后」段，与本轮前端无关 |

---

## E-006 —— 多入口构建带来部署期暴露面（★ 未决，M9 前必办）

| 项 | 内容 |
|---|---|
| **ID** | `E-006` |
| **现象** | 为让新前端可独立构建，`web/vite.config.js` 改为**多入口** ⇒ `web/dist/` 同时含 `index.html` 与 `rewrite.html`。 |
| **风险** | `scripts/deploy-hosting-web.js` **上传整个 `dist/`**，其前置断言（`dist/index.html` + `dist/assets/Dashboard-*.js`）**仍然成立** ⇒ 若现在部署，会把新前端以 `/rewrite.html` **静默**一并带上线，不报错。 |
| **缓解** | 本轮 `NO DEPLOY` 生效，**非阻断**。 |
| **待办** | **M9 之前必须处置**。三选项：(A) 环境变量开关（`VITE_ENABLE_REWRITE_ENTRY=1`）；(B) 部署脚本显式排除 `rewrite.html` 及其专属 chunk；(C) 接受（已加 `noindex`，但 URL 可猜中）。 |
| **状态** | `[OPEN]` —— 需 owner 裁定（登记于 SPEC §18-1 与审计附录 C-5） |

---

## 与其它文档的关系（⛔ 不重复登记）

| 事项 | 登记处 |
|---|---|
| `apiGateway` 部署授权 | `V365_PRODUCTION_READINESS_LEDGER.md`（生产治理） |
| D-8 后台版本身份口径 | SPEC 附录 C-3 |
| `most_worth` 恒 null | SPEC 附录 C-2 |
| M4-D1~D4 裁定 | `V365_M4_ETF_WORKBENCH_CONTRACT.md` §G |
