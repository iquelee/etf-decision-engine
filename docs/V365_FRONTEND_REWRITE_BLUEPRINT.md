# V365 前端重写蓝图（FRONTEND_REWRITE_BLUEPRINT）

> **性质**：**设计蓝图**。**先设计，后编码**（任务书 §十）。本文件是编码阶段的唯一设计输入。
> **审计依据**：`docs/V365_FRONTEND_CURRENT_STATE_AUDIT.md`（同轮产出，2026-09-30）。
> **⛔ 边界**：本蓝图**不授权**修改任何生产决策算法 / 冻结件 / 线上数据；**NO MERGE / NO DEPLOY**。
> **标记**：`[DESIGN]` 设计决定 · `[OPEN]` 待 owner 裁定 · `[DERIVED]` 由审计事实推出。
>
> ★ **状态：FROZEN（2026-09-30，owner 确认）** — `BLUEPRINT_FROZEN = YES` · 版本 `BLUEPRINT-v1`
> ★ **权威顺序**：`SPEC`（`docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md`）**优先于本蓝图**；
> 二者冲突时以 SPEC 为准，本蓝图第 0.5 节记录已被 owner 裁定取代的旧 `[OPEN]` 默认值。

---

## §0.5 ★ owner 裁定回填（2026-09-30，**取代**下文对应的 `[OPEN]` 默认值）

| 决策点 | 本蓝图原默认 | **owner 裁定（以此为准）** | 实现落点 |
|---|---|---|---|
| **D-1** Gen-1 主建议 | 默认 A（不合成，显式 `UNAVAILABLE`） | **确认**：以 `gen1-ui-view-model.js` 为 canonical；⛔ 不合成、不推断；契约缺位显示「数据未提供」 | SPEC §6 |
| **D-2** 生命周期数据源 | 默认 A（只展示可得部分） | **建前端生命周期 Domain Model + UI 状态机**；无 API 的部分 ⛔ 不得硬编码，必须显示「数据未提供 / 待后端契约」 | SPEC §1.2 / §7 |
| **D-3** 空壳路由 | 保留 `/portfolio` redirect；`/intel` 升为正式页 | **确认并扩展**：**彻底清理空壳页面**；主 IA = 全局 · 标的 · 看盘 · 情报 · 复盘；旧 URL 保留 redirect 兼容 | SPEC §4.1 / §11.5 |
| **D-4** 复盘页权限 | 默认 A（保持鉴权 + 登录引导） | **确认**：`Review` 保持鉴权；account snapshot / holdings / trade_log / actual execution / deviation **不得变成公开页面** | SPEC §8.1 |
| **D-5** `api.macro` | 默认 A（接入情报页） | ⛔ **推翻**：按 **dead code 处理，删除** `api.macro()` client method；⛔ 不为「以后可能用」保留；将来需要宏观模块时**再建正式 contract** | SPEC §11.4 / §15 |
| **D-6** 既有契约测试 | 已核验并关闭 | **确认** | SPEC §14.2 |
| **D-7** `pct()` 启发式 | 默认 A（保留函数、限定调用点） | ⛔ **推翻**：**删除**基于数值范围的启发式格式化；改为**语义化**（weight / ratio / amount / price / count / date）；`final_target=0.5` 显示 `0.5%` **由字段语义决定，不由数值大小决定** | SPEC §10 |
| **§5.5 分支基点** | 选 A/B/C 待裁 | **新建 integration 分支**：base = `d669298` + cherry-pick 现有前端 commit | 审计 附录 C-3 |
| **部署** | — | **NO MERGE / NO DEPLOY**；`apiGateway` 与 `runDecisionEngine` ⛔ 不部署；⛔ 不执行 production run | SPEC §17 |

> ⚠️ 下文 §7 的 **D-3 / D-4 / D-5 / D-7** 段落保留为**历史设计记录**（说明当时的权衡），
> 其「默认值」**已被本节取代**，实现时以上表为准。

---

## §0 指导原则（来自任务书，落为可检验约束）

| # | 原则 | 可检验形式 |
|---|---|---|
| G1 | **页面不再理解 CloudBase 原始字段** | `views/**` 内不得出现 `snapshot.` / `decision.` / `ml_shadow.` 等原始响应键名；ESLint `no-restricted-syntax` 或自定义规则禁止 |
| G2 | **分层单向** | `views` → `domain` → `adapters` → `api`；⛔ 反向 import 一律违规（CI 检查 import 图） |
| G3 | **不改决策语义** | `final_target` / `final_action` / `trend_stage` 仅**透传展示**；前端**不得**重算、不得合成、不得覆盖 |
| G4 | **不产生新的 decision authority** | UI 文案与徽标必须来自数据字段，不得由前端"推断"出权威结论（见 §7 决策点 D-1） |
| G5 | **缺失 / 过期必须显式** | 每个数据域携带 `Freshness`；缺失渲染为**明确的缺失态**，⛔ 不用 `—` 静默吞掉 |
| G6 | **provenance 不丢** | 每个展示块可追 `source` + `asOf` + `authority` |
| G7 | **行情色与风险色严格分离** | 见 §4 Design Tokens：`--mkt-*`（涨红跌绿）≠ `--risk-*` ≠ `--act-*` |
| G8 | **无重装饰** | ⛔ 禁止大面积渐变、`backdrop-filter`、玻璃拟态、入场动画（仅允许 1 处极淡品牌色底纹，见 §4.6） |
| G9 | **手机真可用** | 所有表格必须有 ≤768px 的非横滑替代形态；每个页面在 375×667 下可完成主任务 |
| G10 | **信息优先级明显** | 每页首屏只承载「结论 + 一个关键数字 + 风险」；技术字段默认折叠 |

---

## §1 新架构（`[DESIGN]`）

### 1.1 数据流

```
CloudBase / HTTP
      │
   [api/]          只负责：请求 · 鉴权头 · 错误归一 · envelope 解包
      │            ⛔ 不解释业务字段；⛔ 不做 UI 决策
      ▼
 [adapters/]      只负责：原始字段 → 领域对象 · legacy 兼容 · null/missing/stale 判定
      │            ⛔ 不含业务规则（阈值/等级判断）
      ▼
 [domain/]        统一定义领域枚举与纯函数：Action · Risk · MarketRegime · WDHVFC ·
      │           Gen1 · Gen2Role · Position · Provenance · Freshness
      │           阈值/等级判定**只此一处**
      ▼
 [views/ + components/]   只负责：展示 · 交互 · layout · visualization
                  ⛔ 不得内联任何后端字段名、不得重算等级
```

### 1.2 目录（★ 已按 owner 既有落点修正为 `web/src/rewrite/`）

> ★★ **修正说明**：任务书 §四 建议的是 `web/src/{app,api,adapters,domain,components,views,styles,utils,assets}`。
> 但审计 §0.1b 查明：**owner 已在 `refactor/v365-frontend-rewrite` 分支上把新前端落在 `web/src/rewrite/`**（已提交 `api.js` / `domain.js` / 3 个组件）。
> ⇒ **本蓝图的目录一律置于 `web/src/rewrite/` 之下**，与旧 `web/src/**` **并存**；
> 待全部功能迁移完成、验收通过后，再由 owner 决定切换与清理旧目录（⛔ 不在本轮做）。
> **理由**：并行目录可**逐个页面灰度切换**，且旧前端随时可回退——与「NO DEPLOY / 可回退」的纪律一致。

```
web/src/rewrite/                 # ★ 新前端根（owner 已建立）
├── api.js                       # ✅ owner 已建（75 行）：api{} + admin{}；本蓝图在此基础上扩展
├── domain/
│   ├── index.js                 # ✅ 由 owner 的 domain.js 拆分而来（枚举/标签/格式化）
│   ├── enums.js                 # Action / RiskFlag / MarketRegime / WDHVFC / Costate / Gen2Role
│   ├── labels.js                # 全部中文文案（唯一来源；含 legacy 别名）
│   ├── format.js                # pct / rawPct / num / dateText …（唯一格式化层）
│   ├── thresholds.js            # 机会/防守/超配等级阈值（唯一实现）
│   ├── freshness.js             # asOf → FRESH/STALE/MISSING/UNAVAILABLE
│   └── provenance.js            # source + authority + derived
├── adapters/                    # ★ 唯一知道后端字段名的地方
│   ├── readEnvelope.js
│   ├── dashboard.js  etf.js  kline.js  fundamentals.js  intel.js  review.js
│   ├── constants.js  systemRuntime.js  productionLifecycle.js
│   └── admin/{gen1,gen2,fetchLog,param,fundamental,risk,trade}.js
├── session/                     # token 存取 + 401 语义集中处理（app 层职责）
│   └── index.js
├── components/                  # ✅ owner 已建 3 个，按 §8 扩充
│   ├── MetricTile.vue           # ✅ owner 已建
│   ├── SectionHeader.vue        # ✅ owner 已建
│   ├── StatusPill.vue           # ✅ owner 已建
│   ├── primitives/              # Button Chip Field Sheet Modal Tabs Empty Skeleton …
│   ├── data/                    # DataTable KeyValueGrid Timeline DeltaPill MiniSpark ProvenanceLine
│   ├── domain/                  # ActionBadge RiskBadge RegimeBadge StageCode FreshnessDot MissingState LifecycleStrip ScoreBars DecisionChainView
│   └── charts/                  # KlineChart RadarChart（ECharts 按需）
├── compose/                     # 组合式数据 hook（唯一允许触碰 adapters 的地方）
│   └── use{Dashboard,EtfDetail,Structure,Intel,Review,Admin*}Data.js
├── layouts/                     # FrontLayout AdminLayout
├── views/
│   ├── front/                   # Dashboard Workbench Structure Intel Review
│   └── admin/                   # 12 页
├── styles/                      # tokens.css base.css utilities.css
├── app.js                       # 应用装配（createApp + 错误边界 + 引导序列）
└── assets/
```
> ⚠️ 任务书 §四 的 `utils/` 在本蓝图**并入 `domain/`**（与领域无关的极少数工具直接内联在 `components/`）。
> 理由：旧代码的病根正是"`utils/format.js` 名义统一、实际各视图内联"（审计 §4.6）——**不再设一个会被绕过的中间层**。

#### 1.2b 与 owner 既有骨架的差异对照（★ 不得重复造）

| owner 已提交 | 本蓝图的处置 |
|---|---|
| `rewrite/api.js`（75 行，`api{}` + `admin{}`） | **保留并沿用**；仅补：超时/AbortController、`ApiError.kind` 归一、envelope 解包独立成函数、`endpoints` 常量化 |
| `rewrite/domain.js`（66 行，标签 + 格式化） | **拆分**为 `domain/{enums,labels,format,thresholds}.js`；**补齐** `H_STATE_LABELS` / `C_STATE_LABELS`（现缺）；`toneForAction` 移入 `labels.js` |
| `components/MetricTile.vue` · `SectionHeader.vue` · `StatusPill.vue` | **保留为基元**，纳入 §8.1 `primitives/`；不重写 |
| `domain.js: pct()` 的 `<=1.5 ? ×100` 启发式 | ⚠️ **保留行为**（不擅自改语义），但**登记 D-7**（见 §7）待裁 |

> ★ 三个已有组件的 `tone` 取值是 `neutral / good / risk / accent / muted`（见 `toneForAction`）——
> 本蓝图的 Design Tokens **必须提供这 5 个 tone 名**（§4.1 已按此修正），以免推翻 owner 既定接口。

### 1.3 分层职责的硬约束（可 CI 校验）

| 层 | 允许 import | 禁止 |
|---|---|---|
| `api/` | 无（仅 `http`/`envelope`） | `adapters` / `domain` / `views` |
| `adapters/` | `api/`（类型）、`domain/`、`utils/` | `views` / `components` |
| `domain/` | 无 | `api` / `adapters` / `views` |
| `views/` `components/` | `domain/`、`components/`、**经 props 注入的 VM** | **直接 import `api/` 或 `adapters/`** |

> ★ 最后一条是 G1 的机械保障：**视图层拿不到 `api`/`adapters`**，就不可能再"自己解释后端字段"。
> 数据获取统一由 `compose/useXxxData()` 完成；`compose/` 是**唯一**允许触碰 `adapters/` 的地方（见 §1.2 目录）。

---

## §2 新信息架构（`[DESIGN]`）

> 任务书 §五/§六 明确要求「不要机械复制旧菜单」。以下为**重新设计**结果，并在 §11 给出**旧→新逐项映射**确保不丢功能。

### 2.1 前台（5 个页面 · 导航命名采纳 owner 既定偏好）

| # | 路由 | 名称 | 回答什么问题 | 主要数据域 |
|---|---|---|---|---|
| A | `/dashboard` | **全局** | ① 现在什么市场环境 ② 哪些 ETF 要看 ③ 系统建议是什么 ④ 仓位与目标 ⑤ 为什么 ⑥ 什么证据 ⑦ 最近变了什么 | SC + ACCT + OPS + G1(若可得) |
| B | `/etf/:code` | **标的** | 单只 ETF 全链路：动作 → 仓位 → 解释 → 环境 → WDHVF → K线/量价 → 加仓雷达 → 防守雷达 → Gen-1 timing → 基本面 → 相关情报 → 历史决策变化 | SC + ACCT + FUND + G1 |
| C | `/intel` | **情报** | 当前结论 / 硬数据 / 景气财报 / 事件 / AI 研究证据 / 来源与时间 / 数据完整性 | FUND |
| D | `/review` | **复盘** | 决策事件 → 系统建议 → 实际操作 → 偏差 → 响应时间 → 历史趋势 | HIST |
| E | `/structure/:code` | **看盘** | 以**结构识别**为中心（阶段 / 横盘 / 量价结构 / 破位与防守） | SC |

> ⚠️ **导航命名变更**（旧 → 新）：`全局→全局` · `基本面→情报` · `看盘→看盘` · `执行→标的` · `历史→复盘`。
> ⚠️ **导航顺序（已按 owner 裁定 §六 落地）**：旧 `全局·基本面·看盘·执行·历史` → 新 **`全局·标的·看盘·情报·复盘`**（左→右，取 owner §六 的页面列举顺序）。
> 实现单一来源：`web/src/rewrite/routes.js` 的 `FRONT_NAV`（⛔ 模板里不硬编码菜单）。
> ⚠️ 路由**路径不变**（`/dashboard` `/etf/:code` `/structure/:code` `/fundamentals` `/review`）以免破坏已有书签；仅**显示名与顺序**变化。**`/fundamentals` 保留为 `/intel` 的别名重定向**（旧书签兼容）。
> `[OPEN]` **D-3**：`/portfolio` `/intel` 两个旧空壳 redirect 是否保留，见 §7。

### 2.2 前台 A · 全局（Dashboard）—— 首屏只放结论

```
┌─ 结论带（Hero，无渐变，纯色 + 左侧 4px 语义条）────────────────────┐
│  市场环境 [防守]   风险 [熔断/暂停加仓/正常]   数据截至 2026-09-30 │
│  生产身份 V3.6.5 · 部署 COMPLETE · 未执行首次受控运行 · 非一般生产 │  ← LifecycleStrip
└──────────────────────────────────────────────────────────────────┘
┌─ 系统建议（若可得）───────────────────────────────────────────────┐
│  Gen-1 主建议：UNAVAILABLE（后端未下发 gen1）  · 来源与时间明示     │  ← 见 §7 D-1
│  Safety Core 建议：以 5 张标的卡为权威口径                          │
└──────────────────────────────────────────────────────────────────┘
┌─ 5 张标的卡（紧凑：动作 / 仓位→目标 / 风险 / 阶段码）──────────────┐
┌─ 组合状态（ACCT，金额默认遮罩 + 显隐）────────────────────────────┐
┌─ 重要风险（RiskAlertBar 常驻）───────────────────────────────────┐
┌─ 数据新鲜度 + 系统运行状态（折叠）────────────────────────────────┐
```
**明确不做**：⛔ 首屏堆全部原始指标；⛔ 大数字墙；⛔ 24 格技术字段。

### 2.3 前台 B · 标的（ETF Workbench）—— 前台最重要页

**区块顺序**（任务书 §五.B 逐项落实）：
`基础信息` → `当前动作` → `当前仓位/目标仓位` → `决策解释（为什么）` → `市场环境` → `W/D/H/V/F` → `K线/量价` → `加仓雷达` → `防守雷达` → `Gen-1 timing` → `基本面` → `相关情报` → `历史决策变化`

**层级规则**：
- **L1 常显**：动作、仓位→目标、为什么（前 3 步决策链）、风险条。
- **L2 常显但紧凑**：WDHVF 六个状态码（含中文全称）、K线。
- **L3 默认折叠**：Safety Core 技术详情（目标区间/缺口/核心·交易/超配/加仓资格 10 项）、Gen-1 模型审计、决策链 4~13 步。
- **L4 按需展开**：原始字段表（`decision` 全字段 k-v，仅调试/审计用）。

### 2.4 前台 C · 情报（原「基本面」）

任务书 §五.C 要求的 7 分块：
`当前结论` → `硬数据` → `景气 / 财报` → `事件` → `AI 研究证据` → `来源和时间` → `数据完整性`
（复用现 `card.detail.layer_breakdown` 的 `hard_data / earnings / events` 三分层；**保留**手动刷新与 5 分钟轮询。）

### 2.5 前台 D · 复盘

任务书 §五.D：**不是大表格**，而是
`决策事件 → 系统建议 → 实际操作 → 偏差 → 响应时间 → 历史趋势`
⇒ 新形态：**事件流（可展开的决策-执行配对）+ 顶部 8 项统计 + 趋势迷你图**；表格降级为可选视图。

### 2.6 前台 E · 看盘

以**结构识别**为中心：`结构总览（阶段码 + 横盘四重确认）` → `K线/量价（含结构标注）` → `加仓结构雷达` → `防守结构雷达`。
⇒ 与「标的」页的分工：**标的页回答"做什么"，看盘页回答"结构长什么样"**。

### 2.7 后台（5 组 · 任务书 §六）

| 组 | 页 | 路由 | 说明 |
|---|---|---|---|
| **系统运行** | Gen-1 Health | `/admin/gen1` | 保留 |
| | Gen-2 Shadow | `/admin/gen2` | **显式标注 `Selection / Shadow`**，并加一行「⛔ 非当前正式交易引擎」 |
| | V3.6.5 Production State | `/admin/production` | **★ 新增页**（任务书 §七） |
| **数据** | 数据源状态 + 抓取任务 + 抓取日志 | `/admin/data` | 现 DataManage 拆分/整理 |
| | 基本面录入 | `/admin/fundamental` | 保留 |
| | 情报刷新 | （并入 `/admin/data`） | 现逻辑在 Fundamentals 页，**移到后台** |
| **策略配置** | 参数 | `/admin/param` | 保留（含冻结态） |
| | 风险事件 | `/admin/risk` | 保留 |
| **执行** | 操作记录 | `/admin/trade` | 保留 |
| | 账户快照 | （并入 `/admin/trade`） | 现同页，保持 |
| **账户/安全** | 登录 / 修改密码 / 登出 | `/login` `/admin/password` | 保留 |

> ★ **新增 `/admin/production`**：承载任务书 §七 的 V3.6.5 生产生命周期（数据来源见 §7 D-2）。

---

## §3 页面级功能清单（`[DESIGN]`）

### 3.1 前台

| 页 | 功能点 | 数据 | 交互 |
|---|---|---|---|
| 全局 | 市场环境结论 | `overview.market_regime` | — |
| 全局 | 风险状态结论 | `overview.overall_risk` | — |
| 全局 | 生产生命周期条 | `runtime_status` + 常量（§7 D-2） | 点击 → `/admin/production` |
| 全局 | Gen-1 主建议（诚实态） | 无 ⇒ `UNAVAILABLE` | 说明因由 |
| 全局 | 5 标的卡（动作/仓位/目标/风险） | `cards[]` | 点击 → `/etf/:code` |
| 全局 | 账户总览（比例 + 浮盈遮罩） | `overview.*` | 显隐切换 |
| 全局 | 风险红条 | `cards[].risk_override/risk_flag` | — |
| 全局 | 数据新鲜度 | `overview.snapshot_date` + `cards[].data_time` | — |
| 全局 | 系统运行状态（折叠） | `ml_shadow` | — |
| 标的 | ETF 切换 | `etfList` | 页签 |
| 标的 | 动作 / 仓位 → 目标 / 缺口 | `decision.final_action/final_target/position_gap` | — |
| 标的 | 决策解释链 | `decision.explain_chain[]` | 逐级展开 |
| 标的 | 市场环境 / WDHVF | `decision.effective_market_regime` / `snapshot.*_state` | — |
| 标的 | K线/量价 | `kline` | 缩放/滑动 |
| 标的 | 加仓雷达 / 防守雷达 | `snapshot` + `decision.scores` | — |
| 标的 | Gen-1 timing | `decision.gen1_*`（**只读展示，不合成权威**） | 折叠 |
| 标的 | 基本面摘要 | `fundamental`（**启用死载荷**） | 跳 `/intel` |
| 标的 | 相关情报 | `intel?limit` 过滤 `related` | 跳 `/intel` |
| 标的 | 历史决策变化 | `etf/:code/decisions`（**启用死接口**） | 迷你时间轴 |
| 标的 | 加仓资格 10 项（含 cooldown/regime） | `decision.add_eligibility.*` | 折叠 |
| 情报 | 结论 / 三分层 / 指标表 / AI 证据 / 情报流 | `fundamentals` + `intel` | 页签、筛选、刷新、轮询 |
| 复盘 | 8 项统计 / 事件流 / 偏差 / 实操 | `review` | 筛选、展开 |
| 看盘 | 结构总览 / K线 / 双雷达 | `etfDetail` + `kline` | — |

### 3.2 后台

| 页 | 功能点（**功能不得丢**，逐项对应审计 §2.6） |
|---|---|
| Gen-1 Health | 模型健康 6 项 + 最新 EOD 信号表（刷新按钮） |
| Gen-2 Shadow | 运行概览 8 项 + CORE / CHALLENGER / 全池排名 + **Shadow 边界声明** |
| Production State（新） | §七 8 项 + §5.3 补充 5 项（§7 D-2 决定数据来源） |
| 数据管理 | 10 数据源状态 + 4 手动触发 + 抓取日志表 + **情报刷新**（迁移自前台） |
| 基本面录入 | ETF 切换 + 前十大重仓 + 雷达模板（量化录入 / 定性只读 /**权重编辑** / **定性否决**） |
| 参数配置 | 参数表（现值/前值/版本/**冻结态**）+ 编辑 + 影响面确认 |
| 风险事件 | 触发表单（范围/类型/等级/处置/理由必填）+ 事件列表 + **解除（理由必填）** |
| 操作记录 | 账户快照录入 + 操作 CRUD + 筛选 + 仓位自动算仓结果提示 |
| 登录 / 改密 / 登出 | 保留（改密后强制重登） |

---

## §4 Design Tokens（`[DESIGN]`）

### 4.1 颜色：三套语义域**必须物理隔离**

> 依据：任务书 §九「颜色必须有明确语义 / 行情涨跌与风险状态颜色不要混用」；审计 §4.10 已指出旧代码把 `ADD` 设为红、`HOLD` 设为绿，与行情同值。

```css
:root{
  /* ---- 域1：行情涨跌（中国习惯：涨红跌绿）---- */
  --mkt-up:#c0392b;      --mkt-up-bg:#fdeceb;
  --mkt-down:#1e8e5a;    --mkt-down-bg:#e9f7f0;
  --mkt-flat:#6b7280;

  /* ---- 域2：风险状态（语义 = 系统风控，非行情）---- */
  --risk-normal:#2f855a; --risk-normal-bg:#e8f6ee;
  --risk-yellow:#b7791f; --risk-yellow-bg:#fdf6e3;
  --risk-red:#b02a37;    --risk-red-bg:#fdeaea;

  /* ---- 域3：动作语义（★ 已对齐 owner 既有 `toneForAction()` 的 5 类 tone）----
     owner 已在 rewrite/domain.js 定义：ADD|BUILD→accent · HOLD→good · REDUCE|EXIT→risk · 其余→muted
     ⇒ 本蓝图提供同名 tone 变量，⛔ 不推翻既有接口。 */
  --tone-neutral:#6b7280;  --tone-neutral-bg:#f3f4f6;
  --tone-good:#2f7d5c;     --tone-good-bg:#e9f5ef;
  --tone-risk:#b02a37;     --tone-risk-bg:#fdeaea;
  --tone-accent:#2b5fa8;   --tone-accent-bg:#eaf1fb;
  --tone-muted:#8b95a3;    --tone-muted-bg:#f6f7f9;

  /* ---- 中性 / 结构 ---- */
  --c-bg:#f6f7f9; --c-surface:#ffffff; --c-surface-2:#f9fafb;
  --c-border:#e3e7ec; --c-border-strong:#cfd6de;
  --c-text:#0f172a; --c-text-2:#556070; --c-text-3:#8b95a3;
  --c-accent:#2158a8;                 /* 品牌点缀，唯一强调色 */
  --c-focus:#2158a8;                  /* 焦点环 */
}
```

**硬规则**：
1. `--tone-*`（动作语义）与 `--mkt-*`（行情涨跌）**色值不得相同**，且**动作胶囊必须带文字标签**（⛔ 不得仅靠颜色区分动作）。
2. 风险色**只用于** `--risk-*` 命名的组件；行情色**只用于** `--mkt-*`。
3. 所有颜色对比度 ≥ 4.5:1（正文）/ 3:1（大字）。

### 4.2 排版

```css
--font-cn:"Noto Sans SC", system-ui, -apple-system, "Microsoft YaHei", sans-serif;
--font-en:"Inter", ui-sans-serif, system-ui, sans-serif;
--font-mono:ui-monospace, SFMono-Regular, Menlo, monospace;
--fs-11:11px; --fs-12:12px; --fs-13:13px; --fs-14:14px;
--fs-16:16px; --fs-20:20px; --fs-28:28px; --fs-36:36px;
--lh-tight:1.25; --lh-base:1.55;
--fw-regular:400; --fw-medium:500; --fw-semibold:600; --fw-bold:700;
--num-feat:"tnum" 1, "lnum" 1;   /* 所有数字启用等宽数位 */
```
- 中文正文基准 **14px**；**关键数字**用 `--fs-28/--fs-36` + `--fw-bold` + 等宽数位。
- 英文/数字一律 `Inter`（owner 既定字体偏好）；中文 `Noto Sans SC`。
- 技术字段（hash/版本）用 `--font-mono` + `--fs-11`。

### 4.3 间距 / 半径 / 阴影 / 层级

```css
--sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px; --sp-6:24px; --sp-8:32px;
--r-sm:4px; --r-md:6px; --r-lg:8px;      /* 收敛：旧代码 6/10/14 偏大 */
--sh-0:none; --sh-1:0 1px 2px rgba(15,23,42,.06);
--z-base:0; --z-sticky:20; --z-nav:30; --z-drawer:50; --z-modal:60; --z-toast:70;
```

### 4.4 断点（写死数值，变量仅文档用）

`--bp-sm:768px`（手机）· `--bp-md:900px`（平板竖）· `--bp-lg:1100px`（小笔电）· `--bp-xl:1440px` · `--bp-2xl:1800px`
**移动优先**：默认样式即手机，`@media (min-width:…)` 向上增强。

### 4.5 交互态

触屏热区 ≥ **44×44px**；`hover` 装饰一律包在 `@media (hover:hover)`；`prefers-reduced-motion` 下关闭全部过渡。

### 4.6 反装饰清单（G8 落地）

| ⛔ 禁止 | 替代 |
|---|---|
| 大面积 `linear-gradient` Hero | 纯色 surface + 左侧 4px 语义色条 |
| `backdrop-filter: blur()` 玻璃导航 | 纯色 `--c-surface` + 1px 下边框 |
| 卡片 `translateY(-2px)` 悬停位移 | 仅 `box-shadow` 变化 |
| 入场/计数动画 | 仅数据更新时的数值过渡（≤180ms） |
| 白色卡片浮在蓝灰底上 | `--c-surface` 直接铺在 `--c-bg` 上，靠 1px 边框分区 |

---

## §5 数据 View Model（`[DESIGN]`，`domain/models.js`）

### 5.1 领域枚举

```js
// domain/enums.js
Action        = WAIT|BUILD|ADD|HOLD|TACTICAL_REDUCE|STRATEGIC_REDUCE|EXIT
RiskFlag      = NORMAL|YELLOW|RED
MarketRegime  = aggressive|structural|range|defensive|crisis|recovery
WState DState HState VState FState CState            // 各自 1..5
Freshness     = FRESH|STALE|MISSING|UNAVAILABLE
Authority     = SAFETY_CORE|GEN1|GEN2_SHADOW|OPERATOR|UNKNOWN
Gen2Role      = CORE|CHALLENGER|SATELLITE|RESERVE|HEDGE
```

### 5.2 统一包装：`Field<T>`（G5/G6 的机制）

```js
/**
 * @typedef {Object} Field
 * @property {T|null} value         // 实际值；null 表示缺失
 * @property {Freshness} freshness
 * @property {string|null} missingReason  // 缺失原因码，如 'BACKEND_FIELD_ABSENT'
 * @property {Provenance} provenance      // { source, authority, derived, asOf }
 */
```

`Provenance`：
```js
{ source:'api:/api/dashboard', authority:'SAFETY_CORE', derived:false, asOf:'2026-09-30T08:22:04.921Z' }
```

> ★ `derived:true` 是**强制标记**：凡前端由其它字段拼出来的值，必须显式标 `derived`，
> 并在 UI 上以虚线框 / 「推导」小字标注。**这是 G4「不产生新的 decision authority」的机械保障。**

### 5.3 主要 VM（每个字段都是 `Field<T>`）

```js
DashboardVM {
  marketRegime, overallRisk, asOf,
  lifecycle: ProductionLifecycle,        // §5.5
  gen1Advisory: Gen1Advisory|null,       // null ⇒ 诚实降级（§7 D-1）
  cards: EtfCardVM[],                    // 5 张
  account: { cashRatio, techPosition, goldPosition, innovationPosition, totalPnl },
  risks: RiskEventVM[],
  freshness: Freshness,
}

EtfCardVM {
  code, name, sector,
  action, actionLabel,                  // SC
  currentPosition, targetPosition, suggestedPosition, positionGap, overAlloc,  // SC/ACCT
  riskFlag, riskOverride,
  opportunityScore, opportunityGrade,
  stage: { w,d,h,v }, stageText,
  dataAsOf,
}

EtfDetailVM {
  basic, action, position:{current,target,min,max,std}, gap,
  explainChain: ChainStep[],
  state: { w,d,h,v,f,c },
  marketRegime, riskFlag, premiumFlag,
  scores: { trend,volume,fundamental,crowding,risk },  // ⛔ 不暴露 total
  addEligibility: { trend,structure,volume,fund,chase,limit,sector,risk,cooldown,regime,overall }, // 10 项
  cooldownDays, nextAddCondition,
  gen1Timing: Gen1TimingVM|null,        // 由 decision.gen1_* 只读映射（§7 D-1）
  fundamentalBrief, intelRelated, decisionHistory,
  audit: { engineVersion, configVersion, decisionDate, provenance },
}

Gen1Advisory {          // 独立于 Gen1Timing；当前后端未下发 ⇒ null
  status:{code,label,message,tone}|null,
  advisory:{actionCode,actionLabel,message,currentPct,targetLabel,deltaPct}|null,
  signal:{fastPath,showProbability,probability}|null,
  applicability:{domainStatus,label,message,observedFolds,totalFolds}|null,
  risk:{riskFlag,permission,permissionLabel,bindingConstraint,bindingLabel},
}

Gen1Timing {            // 只读观察视图，provenance.authority='GEN1', derived=true
  modelId, engineVersion, signalStatus, probability, calibratedProbability,
  fastPathEnabled, wouldTriggerFastPath, permission, rulePermissionReason,
  effectiveStage, baselineStage, domainStatus, categoryCoverage,
  isStale, dataAgeDays, signalDate, sourceTradeDate,
}

ProductionLifecycle {   // §5.5
  identity, deployment, sourceParity, unexpectedPackageDiff,
  firstControlledRun, prospectiveEpoch, runHistoryIndex, generalProduction,
  activationAuthorization, ownerRunAuthorization, enforceSwitchDate,
  source: Provenance,   // ★ 必填：来源是 runtime_status 还是静态清单
}

MarketRegimeVM { code, label, tone }        // tone: good|neutral|bad
PositionVM { current, target, min, max, std, core, trade, gap, overAlloc, maxPosition }
Provenance { source, authority, derived, asOf }
```

### 5.4 `Freshness` 判定（唯一实现，`domain/freshness.js`）

```js
/**
 * @param {string|Date|null} asOf   数据自身时点（如 snapshot_date / decision_date / updated_at）
 * @param {string|Date}      now    参照时点（默认 now；测试可注入）
 * @param {number}           slaHours 该域 SLA（交易日感知）
 */
FRESH       : asOf 有效 且 在 SLA 内
STALE       : asOf 有效 但 超出 SLA   → UI 黄标 + 「数据已过期 N 天」
MISSING     : asOf 为空 或 字段不存在 → UI 灰化 + 明确缺失原因（⛔ 不用 '—' 静默）
UNAVAILABLE : 该域在当前环境/授权下不可用 → UI 显示能力边界说明
```

> ★ 特别要求（审计 §3.6 教训）：**`UNAVAILABLE` 与 `MISSING` 必须区分展示**。
> 例：Gen-1 主建议属 `UNAVAILABLE`（后端契约未提供），不是 `MISSING`（数据管道断了）。

### 5.5 `ProductionLifecycle` 数据来源（★ 关键约束）

> ★ **修正**：除 `/api/constants.runtime_status` 外，契约还提供 **`data.system_runtime`**（`buildSystemRuntime(runtime)` 产出，dashboard / detail 各下发一份）。两者同源于 `runtime_status` 集合，但**形状与语义不同**：
> - `system_runtime.production` = `{ status:'ACTIVE'|'UNKNOWN', engine, engine_source:'RUNTIME_STATUS'|'UNKNOWN' }` ⇒ **「当前生产引擎」的唯一合法表达**
> - `system_runtime.gen1` = `{ authority, authority_label, health_status, health_gate_status, safety_source, counterfactual_*, production_write, production_fast_path_enabled, auto_execution, safety_invariant_ok }` ⇒ **Gen-1 治理与三条硬边界的唯一合法来源（三态）**
> - `system_runtime.gen2` = `{ mode:'SHADOW', source, production_write_source }` ⇒ **Gen-2 边界声明的唯一来源**
> ⇒ 新 UI 的 `ProductionLifecycle.gen1Governance` / `gen2Boundary` **必须读 `system_runtime`**，⛔ **不得**再从 `ml_shadow.*` 推导（那正是契约明令废弃的 legacy 路径）。

| 字段 | 可从线上获知？ | 来源 |
|---|---|---|
| `production_engine` / `config_version` / `updated_at` | ✅ | `GET /api/constants` → `runtime_status` |
| `system_runtime.production.{status,engine,engine_source}` | ⚠️ 契约存在，**线上未部署** | `data.system_runtime`（待部署） |
| `system_runtime.gen1.*`（权威 + 三硬边界 + 不变量） | ⚠️ 同上 | `data.system_runtime`（待部署）；**降级源** = `runtime_status.*` 直读 |
| `system_runtime.gen2.{mode,source}` | ⚠️ 同上 | `data.system_runtime`（待部署） |
| `ml_effective` / `ml_advisory_enabled` / `ml_execution_enabled` / `gen1_production_write` / `gen1_auto_execution` / `gen1_broker_wired` / `gen1_production_fast_path_enabled` | ✅ | `runtime_status`（**边界字段组，必须整体展示且写反例**） |
| `identity = V3.6.5` | ⚠️ **与线上 `production_engine='v3.6.1'` 冲突** | 登记为**冲突 A**（审计 §5.1） |
| `deployment=COMPLETE` · `sourceParity=EXACT_MATCH` · `unexpectedPackageDiff=0` · `deploymentIdentityVerified=true` | ❌ 无 API | 仅存在于台账（C-021.2 §9） |
| `firstControlledRun` · `prospectiveEpoch` · `runHistoryIndex` · `generalProduction` · `activationAuthorization` · `ownerRunAuthorization` · `enforceSwitchDate` | ❌ 无 API | 仅存在于台账（C-021.2 / C-021.5） |

⇒ **§七 的 8 项里，~3 项可从现有 API 得知，另 ~2 项待 `apiGateway` 部署后可得，剩 5 项无任何接口。**
**决策点 → §7 D-2。**
⚠️ **另注**：契约 `system_runtime.gen2.source` 的取值含 `STATIC_CURRENT_CONTRACT` —— 即「Gen-2 = SHADOW」在无 runtime 字段时是**静态契约声明**而非线上事实。
新 UI 必须**把该 `source` 如实标出**（⛔ 不得伪装成 runtime 真值），此点由 `tests/gen1-ui-contract.test.js` UI-G1-15 守卫。

---

## §6 API Adapter 设计（`[DESIGN]`）

### 6.1 原则

1. **adapter 是唯一知道后端字段名的地方**。
2. **只做形状映射与缺失判定，不做等级/阈值判断**（后者在 `domain/thresholds.js`）。
3. **每个 adapter 必须产出 `Field<T>`**，不得直接返回裸值。
4. **缺失原因必须编码**，不用空字符串/`—` 兜底。
5. **不改写语义**：`Action` 只做大小写归一与别名收敛，⛔ 不做业务改写。

### 6.2 关键映射（修复审计 §3.6 的 10 处断裂）

> ★★ **重大修正（见审计 §3.7）**：后端**已存在** PR-UI-01 契约（`src/common/utils/gen1-ui-view-model.js`），
> 形状为 `data.production` + `data.gen1` + `data.system_runtime` + `data.legacy`。
> **旧前端读的 `gen1.advisory.*` 是一个从未存在过的形状（命中率 0/8）**。
> ⇒ adapter 的正确做法是**照契约形状映射**，⛔ 不是"从 `decision.gen1_*` 合成"。
> ⚠️ **但契约字段在线上尚无**（`apiGateway` 未部署）⇒ adapter 必须把"字段缺失"映射为 `UNAVAILABLE`，
> 待 `apiGateway` 部署后**自动恢复**，无需改前端。

| # | 旧前端读取（错） | adapter 应读取（对，取契约真形状） | 处理 |
|---|---|---|---|
| 1 | `three_questions.market_regime` | `overview.market_regime`（枚举）· `three_questions.market_status`（display 兜底） | ✅ 双源，主用 `overview` |
| 2 | `three_questions.gen1_advice` | `system_runtime.gen1.*`（契约） | 契约缺 ⇒ `UNAVAILABLE` |
| 3 | `three_questions.risk_status` | `overview.overall_risk` | ✅ 直接改读 |
| 4 | `overview.leverage_alert/total_book_pct/cash_ratio_raw` | 无（前后端均无） | 整块移除（见 §11.4-①） |
| 5 | `c.gen1.*`（6 处） | `c.production.*` + `c.gen1.{status, signal, stages, safety}` | ✅ **照契约**；契约缺 ⇒ 显式态 |
| 6 | `detail.gen1.advisory.*` | `detail.production.{action_code, suggested_pct, final_target_pct, current_pct}` + `detail.gen1.{status,signal,stages,safety,applicability,counterfactual,authority}` | ✅ **照契约** |
| 7 | `d.gen1.*`（Review） | `d.gen1` 由 `buildReviewGen1` 产出（含 `authority,status,counterfactual,stages,baseline_suggested_pct`） | ✅ **照契约** |
| 8 | `decision.over_all_status` | **`decision.over_alloc_status`** | ✅ 纯拼写修复 |
| 9 | `ml_shadow.capability.*` | 无 ⇒ `MISSING` | 不静默 |
| 10 | `add_eligibility` 只取 8 项 | 取**全部 10 项**（含 `cooldown` `regime`） | ✅ 补全 |

**契约字段缺位时的降级语义（★ 关键）**：adapter 对每一个契约字段做**三态**判定：

```js
契约字段存在        → Field{ value, freshness:'FRESH', provenance:{ authority:'GEN1' } }
契约字段为 null     → Field{ value:null, freshness:'MISSING',   missingReason:'NULL_IN_CONTRACT' }
契约字段整体不存在  → Field{ value:null, freshness:'UNAVAILABLE', missingReason:'CONTRACT_NOT_DEPLOYED' }
```
⇒ 第三条即当前线上情形。UI 文案：「Gen-1 主建议：**后端契约未上线**（`apiGateway` 未部署）」——
**这是可自愈的**：`apiGateway` 一旦部署，同一份前端代码**无需修改**即恢复显示。
⛔ **绝不**用 `decision.gen1_*` 自行拼装来"填坑"（那是制造新权威）。

### 6.2b `legacy` 块的消费（契约已提供）

`data.legacy = { deprecated:true, do_not_use_for_authority:true, fields:[...] }`
⇒ 新 UI **必须消费**：凡命中 `legacy.fields` 的字段（`ml_shadow`、`ml_shadow.ui_phase`、`ml_shadow.production_permission`、`ml_shadow.fast_path_enabled`、`advisory_enabled`、`fast_path_enabled`），
**只允许展示与排错，⛔ 不得用于权限/阶段/写权限判定**，并在 UI 上以 **「legacy · 不可用于权威判断」** 角标显式标注。
> 旧前端**完全没有消费** `legacy` 块（审计 §3.7.3）。这是新 UI 必须补上的一条硬约束。

### 6.3 legacy 兼容的收敛（不是删除，是**集中**）

- `ACTION_LABELS` 的小写别名、`OVER_ALLOC_LABELS` 的中英双 key、`prettyExplain` 的 12 条正则 —— **全部从视图移除**，收敛进 `domain/labels.js` + `adapters/*`，**保持行为不变**（已有线上脏数据仍需能显示）。
- `prettyExplain` 仅保留给 `explain_chain` 的历史快照洗数据，**封装成单一函数**并加测试用例（覆盖 `W3 周线` / `RISK_OVERRIDE` / `PASS` / `BUILD` 等既有样例）。

### 6.4 请求与错误

```js
// api/http.js 契约
request({ base, path, method, body, auth, timeoutMs=15000, signal })
  → 成功: data（已解 envelope）
  → 失败: throw ApiError{ kind, httpStatus, code, message, retryable }
    kind ∈ NETWORK | TIMEOUT | HTTP | ENVELOPE_401 | ENVELOPE_OTHER | PARSE
```
- 401 语义**上移到 app 层**（`app/session.js`），⛔ 不在 `http.js` 里直接改 `location.hash`（旧实现的副作用，见审计 §4.8-3）。
- **前台不调用后台写接口**：`intelRefresh` 由后台「数据管理」页承担；前台情报页只读 + 提示「去后台刷新」。**这直接修掉审计 §4.8-2。**
- **「历史/复盘」与「后台」的边界**：`/review` 依赖后台 token。**决策点 → §7 D-4。**

### 6.5 死接口 / 死载荷的处置

| 项 | 处置 |
|---|---|
| `api.decisions()` | **启用**（标的页「历史决策变化」+ 复盘趋势） |
| `api.macro()` | **决策点 D-5**：接入「情报」页宏观分块，或保持不接并在 API 层删除注释说明 |
| `/api/etf/:code` 的 `fundamental/fundamental_config/fundamental_series/holdings` | **启用**（标的页基本面摘要用 `fundamental`；`holdings` 用于后台录入页已有） |
| `SignalStrip.vue` | **删除**（功能由新 `DecisionTimeline` 组件替代） |
| `Dashboard.positionText()` | **删除**（死函数） |
| `App.vue` 的 `window.__CONSTANTS__` | **删除**（单通道） |

---

## §7 待 owner 裁定的决策点（`[OPEN]`）

> 任务书要求「所有无法验证的事实必须明确标记 UNKNOWN / NOT VERIFIED」「不要自行推断」。
> 以下 5 项**无法由现有事实唯一确定**，且**会影响语义或超出授权**，故**登记待裁**。
> **未获裁定前，蓝图采用「保守默认值」（列于每项末）**，以免阻塞编码。

### D-1 ~~Gen-1 主建议在前台如何呈现？~~ → **已由事实收敛，降级为"部署依赖"登记**

**原设想的三个选项（合成 / 不合成 / 后端补字段）已被审计 §3.7 推翻**：
契约**早已存在**（`gen1-ui-view-model.js`，09-11），前端只是**没跟进**。因此：

| 结论 | 内容 |
|---|---|
| **前端做什么（本任务内）** | adapter **照契约形状读取** `data.production` + `data.gen1` + `data.system_runtime` + `data.legacy`；契约字段缺位时映射为 `UNAVAILABLE`（`missingReason:'CONTRACT_NOT_DEPLOYED'`）。⛔ **不合成、不推断、不用 `decision.gen1_*` 顶替。** |
| **⛔ 硬依赖（超出本任务）** | 线上 `apiGateway` 未部署契约 ⇒ **重写后生产上仍看不到 Gen-1 主口径**，只会显示诚实态。**要让功能真正生效，需要一次 `apiGateway` 部署**。 |
| **须 owner 知情** | 本任务 **NO DEPLOY** ⇒ 交付的是「**已对准契约、待部署即生效**」的前端。这是一个**已知的、不可由前端单独解除的**验收缺口。 |

> ⇒ **D-1 不再是"设计选择"，而是"部署依赖"**，登记如下：
> `FRONTEND_CONTRACT_ALIGNED = YES` · `CONTRACT_DEPLOYED_ONLINE = NO` · `GEN1_FRONTEND_EFFECTIVE_ON_PROD = BLOCKED_ON_APIGATEWAY_DEPLOY`。
> `[OPEN]` **请求 owner 裁定**：是否在后续单独授权 `apiGateway` 部署（**本轮不部署**）。

### D-2 ★ V3.6.5 生产生命周期数据从哪来？（§七 硬需求）

§七 要求 UI 展示 8 项状态。经 §5.5 逐项比对：
- **~3 项**（引擎/配置版本 + Gen-1 治理 + Gen-2 边界）**现有 API 可得**（`runtime_status`；契约部署后另有 `system_runtime`）；
- **5 项**（`deployment` / `sourceParity` / `unexpectedPackageDiff` / `firstControlledRun` / `prospectiveEpoch` / `runHistoryIndex` / `generalProduction`）**无任何接口**，只存在于台账。

| 选项 | 做法 | 代价 |
|---|---|---|
| **A（保守默认）** | 新页面 `/admin/production` 只展示**可得部分**（`runtime_status` 全字段 + `engine_version` + `config_version` + `updated_at`），其余 5 项显示 `UNAVAILABLE（无接口）` | 落地快，但**不满足 §七 的完整表达** |
| **B** | 仓库内放**版本化静态清单** `web/src/domain/productionLifecycle.json`（人工随台账更新，含 `asOf` 与台账 C-021.2 锚点），UI 明确标注「静态登记 · 最后同步 <日期>」 | 满足 §七，但引入**人工同步点**（易过期） |
| **C** | **后端**给 `/api/constants` 或新端点补 `v365_lifecycle` 字段 | 后端改动，**超授权** |

⇒ **默认执行 A**，页面结构按 §七 的 8 项**预留槽位**，切到 B 只需填 JSON。

### D-3 旧空壳路由是否保留？

`/portfolio` → `/dashboard`、`/intel` → `/fundamentals`（旧）/ 新 IA 中 `/intel` 是**真实页面**。
⇒ **默认**：`/portfolio` 保留 redirect（兼容书签）；`/intel` **升级为情报页正式路由**，`/fundamentals` 反向 redirect 到 `/intel`。

### D-4 「复盘」页与后台的权限边界

现状：`/review` 需要后台 token（审计 §4.8-1），导致访客点「复盘」被弹登录。

| 选项 | 做法 |
|---|---|
| **A（保守默认）** | 保持 `requiresAuth`，但**导航项在未登录时显示为「复盘 🔒」并给明确说明**，点击给**登录引导页**而非直接跳转 |
| **B** | 让 `/api/review` 允许匿名只读（**后端权限变更，超授权**） |
| **C** | 在前台内嵌一个**公开子集**（仅决策时间轴，不含偏差/实操），另立前端接口（**需后端新端点，超授权**） |

### D-5 `api.macro` 是否接入？

现线上 `/api/macro` 有真实数据（PMI 等 10 期）但**无任何 UI**（审计 §4.11）。
⇒ **默认**：接入「情报」页的「宏观」分块（只读展示 `indicators[].{name,note,series[]}`），因为**不涉及决策语义**、纯信息展示。
> ★ 佐证：owner 已提交的 `rewrite/api.js` **已包含 `macro()`** ⇒ 该默认与 owner 意图一致。

### D-6 ~~既有契约测试是否影响重写~~ → ✅ **已核验并关闭（见 §10.5）**

### D-7 ★ 百分比启发式 `pct()` 是否保留？（owner 既有代码遗留）

owner 已提交的 `rewrite/domain.js` 沿用旧代码的启发式：

```js
export function pct(v, digits=1){
  const n = Number(v);
  return (Math.abs(n) <= 1.5 ? n*100 : n).toFixed(digits) + '%';
}
```
即「绝对值 ≤ 1.5 就当成小数比例 ×100」。

**为什么是问题**（`[AS-IS]` 证据）：线上 513310 的 `decision.final_target = 0.5`、`cards[].final_target = 0.5`（`suggested_position = 8.3`）。
`0.5` 会被该函数渲染成 **`50.0%`**（而语义是 **0.5%**）——**恰好落在 1.5 阈值内**。
反之，合法的 `1%` 会被渲染成 `100%`；而 `target_min = 20` 显示 `20%`（正确）。

| 选项 | 做法 | 风险 |
|---|---|---|
| **A（保守默认）** | **保留函数本身**，但**限定调用点**：「概率类」字段（契约内为 0~1，如 `signal.probability` / `calibrated_probability`）用 `pct()`；**仓位/目标类字段**（`*_pct` 命名，契约内已是百分数）改用 `rawPct()` | 需逐字段标注用哪个 —— **但明确优于隐式猜测** |
| **B** | 全局沿用启发式 | 沿袭已知错误（0.5% → 50%） |
| **C** | 删除启发式，全部按契约单位 | **最正确**，但需确认所有消费点都改对 |

> ⇒ **默认 A**。理由：契约字段名**已区分单位**（`suggested_pct` / `final_target_pct` / `current_pct` 是百分数；`probability` 是 0~1）
> ⇒ **可按字段名机械区分，本不需要启发式**。C 是终态、A 是本轮安全落地路径。
> ⛔ **不擅自改动 owner 已提交的函数签名**（`pct(v,digits)` 保持原样，只约束**调用点**）。

---

## §8 组件清单（`[DESIGN]`）

### 8.1 primitives（13）

`AppButton` · `AppChip` · `AppBadge` · `AppField`（label+value+provenance）· `AppSheet`（移动端底部弹层）· `AppModal` · `AppTabs` · `AppSegmented` · `AppEmpty` · `AppSkeleton` · `AppToast` · `AppErrorBoundary` · `AppDisclosure`（替代原生 `<details>` 以统一视觉）

### 8.2 data（7）

`StatTile`（关键数字 + 等宽数位 + 可选遮罩）· `KeyValueGrid`（吸收旧 `.pos-dash` / `.shadow-grid` / `.health-grid`）· `DataTable`（**内含桌面表格 / 移动卡片双形态**，替代旧 `tableScrollHint` 全局 hack）· `Timeline`（复盘事件流）· `DeltaPill`（+/- 数值）· `MiniSpark`（趋势迷你图）· `ProvenanceLine`（来源·时间·是否推导）

### 8.3 domain（9）

`ActionBadge`（动作，独立色相 + 必带文字）· `RiskBadge` · `RegimeBadge` · `StageCode`（W/D/H/V/F/C 六码，附中文全称）· `FreshnessDot` · `MissingState`（区分 MISSING / UNAVAILABLE 两种文案）· `LifecycleStrip`（生产身份条）· `ScoreBars`（五维条，⛔ 不显总分）· `DecisionChainView`（替代 `DecisionChain.vue`）

### 8.4 charts（2，按需加载）

`KlineChart`（ECharts **按需 import**：`echarts/core` + `CandlestickChart` + `BarChart` + `LineChart` + `GridComponent` + `TooltipComponent` + `DataZoomComponent`）· `RadarChart`（`RadarChart`）
⇒ **目标：把 `structure` chunk 从 1.0 MB 降到 < 350 KB**（审计 §3.2）。

---

## §9 重写顺序（任务书 §十二，逐项落为里程碑）

| M | 内容 | 完成判据 |
|---|---|---|
| M0 | **脚手架**：`vite` 配置、`tokens.css`、`base.css`、`app/` 装配、错误边界 | `npm run build` PASS；空壳可启动 |
| M1 | **Router + App Shell**：新导航（命名/顺序）、Front/Admin 两个 layout、移动 drawer | 全路由可达（占位页） |
| M2 | **API 层**：`http`/`envelope`/`auth`/`endpoints` + `ApiError` | 单测：401/超时/网络/解析 4 类错误 |
| M3 | **Domain + Adapter**：枚举/标签/阈值/freshness/provenance + 全部 adapter | **adapter 单测对线上真实响应夹具**（用 `_v365-fe-audit-20260930/live/*.json`） |
| M4 | Dashboard | 用真夹具渲染；Gen-1 显式 `UNAVAILABLE`；零原始字段名 |
| M5 | ETF Workbench | 13 区块齐；10 项加仓资格齐；拼写修复 |
| M6 | 看盘 | K线 + 双雷达；chunk 体积达标 |
| M7 | 情报 | 7 分块 + 轮询 + 手动刷新**移至后台** |
| M8 | 复盘 | 事件流 + 8 项统计 + 趋势 |
| M9 | Admin Shell + Login/改密/登出 | 鉴权正常；401 集中处理 |
| M10 | Gen-1 Health | 6 项 + EOD 表 |
| M11 | Gen-2 Shadow + **边界声明** | 显式「Selection / Shadow · 非交易引擎」 |
| M12 | 数据管理（含情报刷新迁移） | 10 源 + 4 触发 + 日志 |
| M13 | 基本面录入（含权重/否决） | 量化录入 / 定性只读 / 权重 / 否决 四能力齐 |
| M14 | 风险事件 | 触发 + 解除（理由必填） |
| M15 | 操作记录 + 账户快照 | CRUD + 算仓结果提示 + 快照 |
| M16 | 参数配置 | 现值/前值/版本/冻结态 + 编辑 |
| M17 | **V3.6.5 Production State** | 8 项槽位（按 D-2 填充） |

---

## §10 验收标准（任务书 §十四，落为可执行检查）

### 10.1 功能
- [ ] 全路由可访问（前台 5 + 后台 12 + login）
- [ ] 全 API 可调用（前台 10 + 后台 21 端点）—— 含审计 §4.11 的 2 个死接口**启用或显式废弃**
- [ ] 前台功能覆盖 ≥ 旧版（§11 映射矩阵逐项勾选，**删除项单独列出并说明理由**）
- [ ] 后台功能覆盖 ≥ 旧版（同上）
- [ ] 鉴权正常（未登录 → 后台不可读；401 集中处理；改密后强制重登）
- [ ] 移动端正常（375×667 下每页主任务可完成，无横向溢出）

### 10.2 数据
- [ ] 新 UI 与当前 API **语义一致**（adapter 单测锁死）
- [ ] 缺失数据**正确显示**（`MISSING` 与 `UNAVAILABLE` 分开）
- [ ] stale 数据**正确提示**（超 SLA 显式黄标）
- [ ] `source / timestamp / provenance` **不丢**（每个数据块有 `ProvenanceLine`）

### 10.3 决策
- [ ] 不改 `final_target` / `final_action` / `trend_stage`（**逐位相等**：新旧 UI 对同一夹具渲染出的动作/目标一致）
- [ ] 不产生新的 decision authority（**全仓库 `derived:true` 清单**可枚举且均为展示性）
- [ ] 不改 production write 行为（前端**无任何写决策字段的调用**；`pnpm grep` 证明）

### 10.4 工程
- [ ] `build` PASS
- [ ] **existing tests 不回归**（`tests/**` 全绿；尤其 `gen1-ui-contract.test.js`、`gen1-view-model.test.js`）
- [ ] 新增前端回归测试：`adapters/*.test.js`（对真实响应夹具）、`domain/*.test.js`（阈值/标签/freshness）
- [ ] route tests（全路由渲染 smoke）
- [ ] responsive smoke（375 / 768 / 1100 / 1440 四档截图或断言）
- [ ] **分层守卫测试**：断言 `views/**` 不 import `api/**`

### 10.5 现有测试的既有约束（`[AS-IS]` **已核验**）

`[AS-IS]` **已读** `tests/gen1-ui-contract.test.js`（629 行）。结论：

| 项 | 事实 |
|---|---|
| 守卫对象 | **后端契约模块** `src/common/utils/gen1-ui-view-model.js` + **两个 gateway 的接线** |
| 是否守卫前端渲染 | ❌ **完全没有**（全文零处引用 `web/`） |
| UI-G1-01..16 断言内容 | `buildEtfUiViewModel` 输出的 `production.*` 来源、`gen1.counterfactual` 不得覆盖 `production`、`authority` 只认 `runtime_status.gen1_authority`、安全三字段**三态**（true/false/null 不得压扁）、`stages` 三拆不串位、legacy 字段禁止出现在 `production`/`gen1` 块、Review 行 `engine` 取历史而非当前引擎 |
| 对前端重写的影响 | ✅ **不会因前端重写而失败**（它不读 `web/`） |
| 反向价值 | ★★ **它是新前端 adapter 的现成规格书** —— 新 `domain/` + `adapters/` 的 `production`/`gen1` 契约**必须与它逐条一致**（尤其：`authority` 只认 `runtime_status`；安全三字段三态；`stages` 三拆；`gen1` 块禁带 `final`/`action_code`/legacy 键） |

⇒ **D-6 收敛**：`tests/gen1-ui-contract.test.js` 判定为**「后端契约守卫」**，
- ⛔ **不需**修改它（重写前端不会使其失败）；
- ✅ **应将其断言集镜像为前端 adapter 测试**（同一夹具体系，保证前端消费的形状 = 后端产出的形状）。

> 附带确认：`tests/gen1-view-model.test.js` 同为后端契约侧测试，结论同上（`[AS-IS]` 存在；本轮未逐行读，`[NOT VERIFIED]` 其具体断言）。

---

## §11 新旧功能映射矩阵（任务书 §十三：旧页面功能 → 新页面功能）

> **规则**：每一条旧功能都必须有归宿；**任何删除必须单独列出并说明理由**（列于 §11.4）。

### 11.1 前台

| # | 旧页面 | 旧功能（含实现位置） | 新页面 | 新组件 | 状态 |
|---|---|---|---|---|---|
| 1 | Dashboard | 市场环境结论 | 全局 | `RegimeBadge` | 保留（**改读 `overview.market_regime`**） |
| 2 | Dashboard | Gen-1 建议（`three_questions.gen1_advice`） | 全局 | `MissingState` | **改显式 `UNAVAILABLE`**（D-1） |
| 3 | Dashboard | 风险状态 | 全局 | `RiskBadge` | 保留（改读 `overview.overall_risk`） |
| 4 | Dashboard | 隐杠杆黄条 | — | — | **删除**，见 §11.4-① |
| 5 | Dashboard | 策略状态 3 卡片 | 全局 | `StatTile` | 保留 |
| 6 | Dashboard | 账户总览 5 项 + 浮盈显隐 | 全局 | `StatTile` | 保留 |
| 7 | Dashboard | 5 标的卡（动作/仓位/目标/风险/阶段） | 全局 | `EtfCard` | 保留（**Gen-1 位改显式态**） |
| 8 | Dashboard | 运行状态条（`ml_shadow`） | 全局 | `LifecycleStrip` | 保留（**`capability` 缺失显式**） |
| 9 | Dashboard | 卡片点击进详情 | 全局→标的 | — | 保留 |
| 10 | EtfDetail | ETF 页签切换 | 标的 | `AppTabs` | 保留 |
| 11 | EtfDetail | 基础信息 + 近5日涨幅 + 当前仓位 | 标的 | `EtfHeader` | 保留 |
| 12 | EtfDetail | **Gen-1 主建议卡** | 标的 | `Gen1TimingView` | **改形态**（D-1） |
| 13 | EtfDetail | 技术详情：目标区间/建议目标/缺口/核心·交易/超配 | 标的（L3） | `KeyValueGrid` | 保留（**修 `over_alloc_status` 拼写**） |
| 14 | EtfDetail | 加仓冷静期 | 标的 | `RiskBadge` | 保留 |
| 15 | EtfDetail | 加仓资格（8 项） | 标的 | `EligibilityGrid` | **补全为 10 项** |
| 16 | EtfDetail | 机会等级 | 标的 | `AppBadge` | 保留 |
| 17 | EtfDetail | 评分卡五维（不显总分） | 标的 | `ScoreBars` | 保留 |
| 18 | EtfDetail | 决策链「为什么」 | 标的 | `DecisionChainView` | 保留 |
| 19 | EtfDetail | 下一加仓条件 | 标的 | `AppField` | 保留 |
| 20 | EtfDetail | 模型审计/基线对照（24 格） | 标的（L3） | `KeyValueGrid` | 保留（折叠） |
| 21 | EtfDetail | 风险红条 | 标的 | `RiskAlertBar` | 保留 |
| 22 | EtfDetail | — | 标的（新） | `IntelRelatedList` | **新增**（启用 `decisions` + `fundamental` 死载荷） |
| 23 | Structure | K线 + 量价（MA20/MA60） | 看盘 | `KlineChart` | 保留（**按需加载**） |
| 24 | Structure | 阶段识别 W/D/H/V | 看盘 | `StageCode` | 保留 |
| 25 | Structure | 横盘详情（5 项） | 看盘 | `KeyValueGrid` | 保留 |
| 26 | Structure | 加仓雷达 / 防守雷达 | 看盘 | `RadarChart` | 保留（**轴换算移入 domain**） |
| 27 | Fundamentals | ETF 页签 + F 状态 | 情报 | `AppTabs` | 保留 |
| 28 | Fundamentals | 合成判断行 + 信号/覆盖 | 情报 | `StatTile` | 保留 |
| 29 | Fundamentals | 三分层指标表（表/卡双形态） | 情报 | `DataTable` | 保留（**双形态内置**） |
| 30 | Fundamentals | AI 研究证据 | 情报 | `EvidenceList` | 保留 |
| 31 | Fundamentals | 财报与公告流 + 类型筛选 | 情报 | `IntelStream` | 保留 |
| 32 | Fundamentals | **手动刷新（调后台写接口）** | **后台·数据管理** | `TriggerButton` | **迁移**（修 §4.8-2） |
| 33 | Fundamentals | 5 分钟轮询 + 可见性暂停 | 情报 | `usePolling()` | 保留 |
| 34 | Review | 8 项统计 | 复盘 | `StatTile`×8 | 保留 |
| 35 | Review | 决策快照时间轴 | 复盘 | `Timeline` | 保留（**Gen-1 列改显式态**） |
| 36 | Review | 偏差表 | 复盘 | `DataTable` | 保留 |
| 37 | Review | 实际操作记录 | 复盘 | `DataTable` | 保留 |
| 38 | Review | 筛选（代码/日期/动作） | 复盘 | `AppSegmented` | 保留 |
| 39 | 全局 | 表格右侧渐隐提示（`tableScrollHint`） | — | — | **删除**，见 §11.4-② |
| 40 | 全局 | `window.__CONSTANTS__` 双通道 | — | — | **删除**，见 §11.4-③ |
| 41 | 全局 | `SignalStrip` 色块带 | — | — | **删除**（本就是死组件），见 §11.4-④ |

### 11.2 后台

| # | 旧页面 | 旧功能 | 新页面 | 状态 |
|---|---|---|---|---|
| 1 | Gen1Health | 模型健康 6 项 + 刷新 | 系统运行·Gen-1 | 保留 |
| 2 | Gen1Health | 最新 EOD 信号表 | 同上 | 保留 |
| 3 | Gen2Shadow | 运行概览 8 项 | 系统运行·Gen-2 | 保留 |
| 4 | Gen2Shadow | CORE / CHALLENGER / 全池排名 | 同上 | 保留 |
| 5 | Gen2Shadow | — | 同上 | **新增**：`Selection / Shadow` 显式边界声明（§八） |
| 6 | — | — | 系统运行·**Production State** | **新增页**（§七，D-2） |
| 7 | DataManage | 10 数据源状态卡 | 数据·数据管理 | 保留 |
| 8 | DataManage | 4 手动触发按钮 | 同上 | 保留 |
| 9 | DataManage | 抓取日志表 | 同上 | 保留 |
| 10 | DataManage | — | 同上 | **新增**：情报刷新（迁移自前台） |
| 11 | FundamentalEntry | ETF 切换 | 数据·基本面录入 | 保留 |
| 12 | FundamentalEntry | 前十大重仓 | 同上 | 保留 |
| 13 | FundamentalEntry | 量化指标录入（值/来源/日期/置信度） | 同上 | 保留 |
| 14 | FundamentalEntry | 定性指标只读 | 同上 | 保留 |
| 15 | FundamentalEntry | **基本面权重编辑** | 同上 | 保留 |
| 16 | FundamentalEntry | **定性否决**（等级+理由必填） | 同上 | 保留 |
| 17 | ParamConfig | 参数表（现值/前值/版本） | 策略·参数 | 保留 |
| 18 | ParamConfig | **参数冻结状态** | 同上 | 保留 |
| 19 | ParamConfig | 编辑 + 影响面确认 | 同上 | 保留 |
| 20 | RiskEvents | 触发表单（范围/类型/等级/处置/理由） | 策略·风险事件 | 保留 |
| 21 | RiskEvents | 事件列表 | 同上 | 保留 |
| 22 | RiskEvents | **解除（理由必填）** | 同上 | 保留 |
| 23 | TradeLog | 账户快照录表（总资产/浮盈） | 执行·操作记录 | 保留 |
| 24 | TradeLog | 操作 CRUD + 筛选 | 同上 | 保留 |
| 25 | TradeLog | 仓位自动算仓结果提示 | 同上 | 保留 |
| 26 | Login | 密码登录 + 安全重定向 | 账户·登录 | 保留 |
| 27 | ChangePassword | 改密 + 强制重登 | 账户·改密 | 保留 |
| 28 | AdminLayout | 登出 | 账户·登出 | 保留 |
| 29 | AdminLayout | 返回前台 | 全局 | 保留 |

### 11.3 覆盖度核对（任务书 §十三 列出的必保功能）

| 任务书要求 | 归宿 | ✓ |
|---|---|---|
| 数据刷新 | 情报页（API 重载）+ 后台触发 | ✅ |
| 数据源状态 | 后台·数据管理 | ✅ |
| 手动抓取 | 后台·数据管理（4 触发） | ✅ |
| 基本面录入 | 后台·基本面录入 | ✅ |
| 基本面权重 | 后台·基本面录入 | ✅ |
| 定性否决 | 后台·基本面录入 | ✅ |
| 风险事件新增/解除 | 后台·风险事件 | ✅ |
| 参数修改 | 后台·参数 | ✅ |
| 参数冻结状态 | 后台·参数 | ✅ |
| Gen-1 Health | 后台·Gen-1 | ✅ |
| Gen-2 Shadow | 后台·Gen-2 | ✅ |
| 操作记录 | 后台·操作记录 | ✅ |
| 账户快照 | 后台·操作记录 | ✅ |
| 历史复盘 | 前台·复盘 | ✅ |
| 登录/改密/登出 | 后台·账户 | ✅ |
| 移动端能力 | 全站（G9） | ✅ |

### 11.4 删除项（**逐项说明理由**，任务书 §十三 要求）

| # | 删除项 | 理由 |
|---|---|---|
| ① | **隐杠杆黄条**（`overview.leverage_alert` / `total_book_pct` / `cash_ratio_raw`） | `[AS-IS]` 线上这三个字段**均不存在** ⇒ 该 UI **在当前生产上恒不渲染**，删除不影响任何可见行为。若需恢复该提示，需**后端补字段**（超授权）。 |
| ② | **`tableScrollHint.js` 全局表格横滑提示** | 替换为 `DataTable` 的**移动卡片形态**（G9）。全局 `MutationObserver` 监听整棵 DOM 是性能与可预测性负债；且它对 `<div>` 类时间轴**本就失效**（审计 §4.9-3）。**功能不丢**：表格能力由组件内置承担。 |
| ③ | **`App.vue` 的 `window.__CONSTANTS__` 通道** | `[AS-IS]` 全仓库**零读取方**（死通道）；且与 `main.js` 通道**重复请求同一接口**。收敛为单一引导序列。 |
| ④ | **`SignalStrip.vue`** | `[AS-IS]` 全仓库**零 import**（死组件）。其能力由新 `Timeline` / `MiniSpark` 覆盖。 |
| ⑤ | **`Dashboard.positionText()`** | `[AS-IS]` 死函数（模板零引用，构建产物已被 tree-shake）。其展示语义由 `EtfCard` 的仓位行承担。 |
| ⑥ | **`Fundamentals.vue:inputs[indicator].source` 三元两支同值** | 明显笔误，重写时按正确的 source 下拉实现。 |

> ⛔ **本节的删除项全部为「当前生产上无可见行为」或「零引用」的死代码**，**不含**任何有用户可见效果的功能。

---

## §12 风险与前置条件

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 新 adapter 误把"猜测"当"契约"，重蹈旧覆辙 | adapter **单测必须用线上真实响应夹具**（`_v365-fe-audit-20260930/live/*.json`），夹具入库到 `web/tests/fixtures/` |
| R2 | ~~重写触发既有契约测试失败~~ **已排除** | `[AS-IS]` 已读 `tests/gen1-ui-contract.test.js`：它**只守卫后端契约与 gateway 接线，不读 `web/`** ⇒ 前端重写**不会**使其失败（见 §10.5）。反将其断言集**镜像**为前端 adapter 测试 |
| R3 | 分层守卫遗漏，视图重新耦合 | CI 加 import 图检查 + `views/**` 禁 `api/**` |
| R4 | 单文件 chunk 过大（ECharts） | `echarts/core` 按需注册，验收 `structure` chunk < 350 KB |
| R5 | 版本口径（V2/V3.6.1/V4.0/V3.6.5）在重写后依然混乱 | 见 D-4/冲突 D；建议版本号**只从 `/api/constants` 读**，⛔ 前端零硬编码；但该值与 §七 冲突（冲突 A）⇒ **需先裁** |
| R6 | 本轮越权 | ⛔ NO MERGE / NO DEPLOY / NO PUSH / NO REBASE；**只新增 `web/src/rewrite/**` + `web/tests/**`**，⛔ 不改旧 `web/src/**` 与任何后端/冻结件 |
| R7 | **分支基点分叉**：rewrite 分支基点 = `master`，不含 V3.6.5 的 15 commit | 见 §15-2；⛔ 本轮**不做** merge/rebase，等 owner 裁定 A/B/C |
| R8 | **规格正文缺失**导致后续实现与 owner 预期偏离 | 见 §15-1；本轮以任务书正文为准，**遇歧义即登记决策点**（不臆断） |

---

## §13 本轮（审计+蓝图）状态

```text
AUDIT                     = COMPLETE / FROZEN  → docs/V365_FRONTEND_CURRENT_STATE_AUDIT.md（AUDIT-v1，附录 C 为追加区）
BLUEPRINT                 = COMPLETE / FROZEN  → docs/V365_FRONTEND_REWRITE_BLUEPRINT.md（BLUEPRINT-v1，§0.5 为裁定回填）
SPEC                      = COMPLETE           → docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md（SPEC-v1，权威）
FUNCTION_MATRIX           = COMPLETE           → 本文件 §11（前台 41 项 + 后台 29 项，逐项有归宿）
CONTRACT_DISCOVERED       = PR-UI-01           （后端契约已存在；旧前端命中率 0/8）
DECISION_POINTS           = ALL CLOSED         （D-1~D-7 全部由 owner 裁定，见 §0.5）
CODE_CHANGED              = YES（M0+M1）        → web/src/rewrite/{styles,domain/format.js,routes.js,router.js,compose,layouts,views}
BRANCH                    = refactor/v365-frontend-integration（base d669298 + 5 cherry-pick）
MERGE / DEPLOY / PUSH     = NOT AUTHORIZED / NOT PERFORMED
```

## §15 ★ 三项必须让 owner 裁定的既成事实（不可由本轮自行处置）

| # | 事实 | 为何必须 owner 裁 |
|---|---|---|
| 1 | **规格文件正文缺失**：`docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md` 路径已建、**正文是工具报错占位串** | 补正文属**越权**；本轮以任务书正文为规格源 |
| 2 | **分支基点分叉**：rewrite 分支基点 = `master`(`e93f396`)，**不含 V3.6.5 的 15 commit**；而 V3.6.5 生产部署的代码在另一支 | 选 A/B/C 需 owner 决定（审计 §5.5） |
| 3 | **`apiGateway` 契约未部署**：线上仍是 2026-09-01 版 | 前端重写完成前**无法**在生产验证 Gen-1 主口径；部署须单独授权 |


## §14 ★ 一条必须让 owner 知情的既成约束（不可由前端单独解除）

```text
FRONTEND_CONTRACT_ALIGNED        = YES（重写后将照 PR-UI-01 契约形状消费）
CONTRACT_DEPLOYED_ONLINE         = NO （线上 apiGateway = 2026-09-01 版，契约标记 grep=0）
GEN1_FRONTEND_EFFECTIVE_ON_PROD  = BLOCKED_ON_APIGATEWAY_DEPLOY
```

**含义**：本次前端重写**完成并合并后**，在**未部署 `apiGateway`** 的前提下，
线上 Gen-1 主口径仍**不可见**（只会显示显式的 `UNAVAILABLE`）。
**这是"对齐契约、待部署即生效"的交付，不是"未完成"。**
⇒ `[OPEN]` 请求 owner 在后续**单独**授权 `apiGateway` 部署（**本轮明确不部署**，且不纳入本次授权范围）。

