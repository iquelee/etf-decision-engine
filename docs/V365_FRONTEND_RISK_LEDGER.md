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
| `DS-006` | ★★ **「Gap」在同一 `decision` 块内**三个口径**并存**（`next_add_condition` 文案与结构化字段冲突）** | 513310 / 2026-09-29 实测：`position_gap = 0`（**已 clamp**：`max(0, final_target − suggested)`）· `final_target − suggested_position = 0.5 − 8.3 = −7.8` · `next_add_condition` 原文含「**Gap -8%**」⇒ **同概念三值（0 / −7.8 / −8%）**。与 M4-D3 处理的 `explain_chain`（「仓位缺口 -7.8pct」）是**同一性质的第二处载体** | **前端已按 owner D-M5-5 处置**（2026-10-01）：`domain/condition.js` **只移除**冲突片段，其余文字**逐字保留**；⛔ 不换算、⛔ 不重算、⛔ 不用 `position_gap` 生成新文案；被移除片段保留在 `nextAddConditionRaw` / `conditionQuantRemoved` 供审计。<br>⛔ **后端未改**（按 owner 指令）⇒ 待后端统一「Gap」口径后可删除该处置 |

---

## M5-P1 —— 单源展示治理（★ 已实施，非"风险"而是本轮改动登记）

> owner 裁定 M5-P1（2026-10-01）：«同一个 backend 事实，在页面中必须有唯一明确的主位；
> 其他区块如必须出现，只能作为引用位，不能再次解释成另一套判断。»
> 归属表落地在 **`web/src/rewrite/domain/ownership.js`**（24 个事实，机器可判）。

| 项 | 内容 |
|---|---|
| **起因** | M5-P0 IA Review §9 P0-1：约 15 个后端事实被**跨区块渲染 2–3 次**，且无「主位/引用位」标记（`risk_flag` ×3、`premium_*` ×3、`risk_events` ×3、`position_gap` ×2 等） |
| **处置** | ① 建立归属表（owner 唯一 + refs 白名单 + 每条规则 + 禁用语）；② `components/domain/Fact.vue` 渲染 `data-fact` / `data-role` / `data-ref-to`；③ 非主位降为**带可见「引用 · 见「X」」标记**的引用位；④ 删除页尾重复的 `fundamentalsSummary` 段 |
| **验证** | `tests/rewrite/single-source.test.js`（16 项）+ 浏览器 DOM 核验（24 个事实 owner 全为 1，problems 0） |
| **纪律** | ⛔ 未新增任何业务信息；⛔ 未改 adapter 业务语义；⛔ 未改后端；⛔ 未把辅助信号升格为正式决策 |

### 本轮修复的缺陷

| ID | 现象 | 根因 | 发现方式 | 状态 |
|---|---|---|---|---|
| `FE-DEF-005` | 渲染结果出现后端字段名（守卫命中 `position_gap`） | 我在**模板 HTML 注释**里写了字段名 —— Vue **dev 编译保留模板注释** ⇒ 注释进入 HTML | M4 既有守卫（`etf-detail-render` G 项） | ✅ 已修（注释改中文表述） |
| `FE-DEF-006` | `klineLastDate` 在 K 线不可用时出现**悬空引用**（`ref=1` 而 `owner=0`） | 主位标记只在「有 K 线」分支渲染，而页头引用位**总是**渲染 | ★ 浏览器核验的**更严规则**（`ref>0 && owner!=1` 即缺陷） | ✅ 已修（主位标记移到**始终渲染**的区块标题上） |

> `FE-DEF-006` 的价值：这条规则比"owner===1"更严 —— 它能抓出**引用位指向不存在的主位**，
> 即"看起来标了引用，其实没有出处"。建议后续页面沿用该规则。

---

## M5-P2 ~ M5-P11 —— 连续自主执行（2026-10-01 · ★ 已实施，`NO COMMIT`）

> 目的：把 M5-P1 立下的规则**扩到全场景**，并登记本轮由「更严守卫」与「真实浏览器」抓出的新缺陷。
> ⛔ 全程未改 backend / production；⛔ 未 commit / push / merge / deploy / production run。
>
> ★ **M6 GATE-1 = `RESOLVED`**（2026-10-01 最终人工裁定）：本节两条 GATE-1 观测
> （`IA-001` `UI-001`）**均已正式关闭**，见下表。

### 本轮新增观测（★ 登记，⛔ 不选边）

| ID | 观察 | 证据 | 处置 |
|---|---|---|---|
| `IA-001` | ★★ **指令 §六(1) 与 §六(2) 对 `finalTarget` 互相矛盾** —— §六(1) 把 `finalTarget` 列为「正式决策」可承载项；§六(2) 又把同一字段列进「仓位与风险」的**唯一主位**清单 | 两段原文；注册表 `ownership.js`：`FINAL_TARGET.owner = PRIMARY_DECISION`、`refs = [POSITION_RISK]` | ✅ **`RESOLVED`**（M6 最终人工裁定 2026-10-01）：«`finalTarget` 的唯一视觉主位归「正式决策」» ⇒ **保持现状、不改变 owner**。「正式决策」= owner/primary；「仓位与风险」= **reference only**（保留引用标记，⛔ 不得形成第二主位）；`actualPosition`/`suggestedPosition`/`targetBand`/`maxPosition`/`positionGap` 继续由「仓位与风险」承担主位。机器守卫见 `semantic-boundary.test.js` §六(2) 项 |
| `UI-001` | 同一页出现**两个「市场环境」值**：页头「组合环境」（组合级 = 防守）与决策链内的「市场环境」（引擎决策时点 = 系统性风险） | 1440px 实测同屏可见；二者 authority 与 as-of 不同；链上文案为后端 `explain_chain` **原文**（`"市场环境 系统性风险"`） | ✅ **`RESOLVED`**（M6 最终人工裁定 2026-10-01）：**两个数据点均保留**（⛔ 不删除 / 不合并 / 不重算 / 不互覆盖）；**只把链上那条**的前导标签改写为「**决策时点市场环境**」（如「决策时点市场环境 · 系统性风险」）。实现：`domain/chain.js#disambiguateEngineContext`（**纯展示层**，⛔ 未改 backend / 字段 / 数据源 / 计算逻辑；原文逐字保留在 `conditionRaw`）。机器守卫见 `state-semantics.test.js` UI-001 两项 |
| `BE-001` | 标的侧存在**自己的**市场状态字段（实测 `crisis`），与组合级（`defensive`）**不同** | 适配器已产出但组件层**零引用**（已加守卫断言） | ✅ 前端已正确：组合环境只取组合级；标的侧值仅留在技术审计层，⛔ 不进 UI |

### 本轮修复的缺陷（★ 全部由「更严守卫」或「真实浏览器」抓出）

| ID | 现象 | 根因 | 检出方式 | 状态 |
|---|---|---|---|---|
| `FE-DEF-007` | HTML 出现 `code="[object Object]"`（对象被字符串化泄漏进 DOM）；同时 hero「大号动作徽标」**静默失效** | 调用方向 `ActionBadge` 绑定 `:code`（Field **对象**）与 `large`，而组件**未声明这两个 prop** ⇒ 落进 `$attrs` 渲染成属性；且 `ToneBadge` 既无 `large` 也无 `.badge.lg` 样式 | 浏览器 QA「不得出现 `[object Object]`」 | ✅ 已修（删无效绑定；补 `large` prop + `.badge.lg`） |
| `FE-DEF-008` | `decision` 不可用时 `finalTarget` / `riskFlag` 出现**悬空引用**（`ref=1` 而 `owner=0`） | 「正式决策」的**主位标记在 `v-else` 分支内**，而「仓位与风险」的引用位**总是渲染** | ★ 把 `ref>0 ⇒ owner===1` 从单场景扩到 **19 场景**后立即暴露 | ✅ 已修（同 FE-DEF-006：主位锚点放进**不可用分支**） |
| `FE-DEF-009` | K 线**畸形载荷**与**合法空数组**共用标签「无时间戳」⇒ 两态塌陷 | `statusLabel` 只判 `ERROR`/`UNAVAILABLE`，其余落到 freshness 的 `MISSING` | M5-P7 状态矩阵（6 种载荷逐一对表） | ✅ 已修（新增 `字段缺失` / `无行情数据（0 根）`，七态互不相同） |
| `FE-DEF-010` | **可见文案里出现后端字段名/库表名**：Gen-1 空态 caveat 写 `system_runtime.gen1`；「不消费键」清单**逐条列出** `gen1_*` 键名；仓位卡标注 `配置标准（etf_basic）`；分层明细提示写 `fundamental.detail.layer_breakdown`；Dashboard 折叠区写 `ml_shadow` | 文案把**内部实现标识**当成了说明文字 | ★ 新守卫「可见文本零 `snake_case`」（SSR 多场景 + 浏览器） | ✅ 已修（改大白话并保留 ⛔ 说明；provenance 来源串 `/api/...`、`contract:...` 按设计保留） |
| `FE-DEF-011` | 一条**解释性模板注释**本身触发了「HTML 不得出现 `[object Object]`」守卫（自伤） | Vue **dev/SSR 编译保留模板 HTML 注释** ⇒ 注释文字进 HTML，而注释里写了该字面量 | `single-source` 的 SSR 断言 | ✅ 已修（注释改写）＋ **新增静态守卫**：模板注释 ⛔ 不得含 `[object Object]` / `NaN` / `undefined` / 后端字段名 |

**共同教训（M5-P8 新增）**
① **「守卫只在单场景跑」= 半条守卫**：`FE-DEF-008` 与 `FE-DEF-010` 都只出现在**不可用/降级分支**，
   而旧守卫只测「正常数据」⇒ 必须**逐场景遍历**。
② **「可见文案」也是契约面**：字段名泄露不只在属性里，也在**说明句中**；`snake_case` 扫描比「列名单」更耐用。
③ **`[object Object]` 有三种来源**：模板插值、未声明 prop 落进 `$attrs`、以及**注释自身** —— 三者都要防。

---

## E-006 —— 多入口构建带来部署期暴露面（★ 已裁定 A2 并实现 · 尚未部署）

| 项 | 内容 |
|---|---|
| **ID** | `E-006` |
| **现象** | 为让新前端可独立构建，`web/vite.config.js` 改为**多入口** ⇒ `web/dist/` 同时含 `index.html` 与 `rewrite.html`。 |
| **风险** | `scripts/deploy-hosting-web.js` **上传整个 `dist/`**，其前置断言（`dist/index.html` + `dist/assets/Dashboard-*.js`）**仍然成立** ⇒ 若现在部署，会把新前端以 `/rewrite.html` **静默**一并带上线，不报错。 |
| **缓解** | 本轮 `NO DEPLOY` 生效，**非阻断**。 |
| **待办** | **M9 之前必须处置**。三选项：(A) 环境变量开关（`VITE_ENABLE_REWRITE_ENTRY=1`）；(B) 部署脚本显式排除 `rewrite.html` 及其专属 chunk；(C) 接受（已加 `noindex`，但 URL 可猜中）。 |
| **★ 裁定（2026-10-01，owner）** | 选 **A2**：以环境变量开关决定**根入口**承载哪一套 UI —— `VITE_ENABLE_REWRITE_ENTRY=1` ⇒ 根 `/` = V3.6.5 Rewrite UI；未设置 / `=0`（默认）⇒ 根 `/` = Legacy UI（与收敛前一致）。`/legacy.html` 固定为 Legacy 入口；`/rewrite.html` 保持独立 + `noindex`。⛔ 本轮不采用 CloudBase `RoutingRules`、不建立秒级回退。 |
| **★ 实现（已入库）** | `web/vite-config/rewrite-root-entry.js` —— Vite 官方 `transformIndexHtml`（`order:'pre'`，fail-closed）＋ `web/vite.config.js`（三入口）＋ 新增源文件 `web/legacy.html`。⛔ 未改 `web/src/rewrite/**`、⛔ 未改 `web/src/main.js`、⛔ 未对 `dist` 做事后改写、⛔ 未引入第三方插件。 |
| **★ 机器守卫** | `web/tests/rewrite/entry-convergence.test.js`（Case A~G ＋ fail-closed ＋ `index.html ≡ legacy.html` 漂移守卫）；产物级校验器 `web/tests/tools/verify-entry-artifact.cjs`（真实构建后 / CI 使用）。 |
| **★ 回退程序（本轮目标）** | 以 `VITE_ENABLE_REWRITE_ENTRY=0` 重新构建 → 走**既有** `scripts/deploy.sh --frontend-only` / `tcb hosting deploy` ⇒ 根 `/` 回到 Legacy。⚠️ **尚未演练**（本轮无部署）。 |
| **状态** | **`A2 IMPLEMENTED`（代码＋测试在库）· ⛔ `NOT DEPLOYED` · ⛔ `NOT PRODUCTION ACTIVE`** —— 生产切换与回退演练仍需**独立部署授权**（见 SPEC §18-1 / §18-1.1）。 |
| **⛔ 仍未做** | 未部署 · 未激活 · 未写 CloudBase 托管配置 · 无秒级回退（`RoutingRules`）· 未演练回退。部署后 `/rewrite.html` 仍**可被猜中**（以 `noindex` 缓解）。 |

---

## 与其它文档的关系（⛔ 不重复登记）

| 事项 | 登记处 |
|---|---|
| `apiGateway` 部署授权 | `V365_PRODUCTION_READINESS_LEDGER.md`（生产治理） |
| D-8 后台版本身份口径 | SPEC 附录 C-3 |
| `most_worth` 恒 null | SPEC 附录 C-2 |
| M4-D1~D4 裁定 | `V365_M4_ETF_WORKBENCH_CONTRACT.md` §G |
