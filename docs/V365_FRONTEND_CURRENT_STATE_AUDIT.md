# V365 前端现状审计（FRONTEND_CURRENT_STATE_AUDIT）

> **性质**：**只读审计报告**。本文件**不**修改任何生产决策算法 / 冻结件 / 线上数据。
>
> ★ **状态：FROZEN（2026-09-30，owner 确认）**
> `AUDIT_FROZEN = YES` · 版本 `AUDIT-v1`
> 冻结含义：本文件描述的**现状事实**作为重写基线，⛔ 不再随实现推进而回改；
> 后续新增事实一律以「附记」追加，⛔ 不改写既有结论。
> 已被 owner 裁定接受的要点：§0.1（规格件三态）· §0.1b（rewrite 骨架为起点）· §3.7（Gen-1 失配根因）
> · §4（13 类技术债）· §5（5 项冲突登记，其中 §5.5 分支基点分叉由 owner 以「新建 integration 分支」处置）。
> 附记见文末 **§附录 C**。
>
> **审计对象**：`web/`（38 文件 · 5,005 行）+ 线上静态托管 + 线上 API 网关。
> **标记约定**：`[AS-IS]` 实测证据 · `[INFER]` 由证据推理 · `[UNKNOWN]` / `[NOT VERIFIED]` 未验证。
> **审计时间**：2026-09-30（本地时区 +08）。
> **基线**：仓库 `etf-decision-engine/etf-decision-engine`。
> **审计时的分支**：`feat/v365-production-integrity-impl`，HEAD `d669298`；远端 `origin/master` = `e93f396870b601d49d61d3a6e955596bc91b2ad5`。
> **★ 收尾时的分支**：已接续 owner 既有分支 **`refactor/v365-frontend-rewrite`**（= `db007dfa70136558e9295b07b7d6d3f4346e1061`，基点 `e93f396`）——见 §0.1b。

---

## §0 审计前置：任务书指定的事实源存在性核验

任务书 §一 声明「项目内已经存在 `docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md`」。

### 0.1 核验结论：**路径存在，但内容是一个占位报错串**（★★ 修正，三态）

> ⚠️ **本节经过一次修正**。初版结论为「该文件不存在」——**该结论只对 master / 当前工作分支成立**。
> 后续查 `git ls-remote` 发现：**`refactor/v365-frontend-rewrite` 分支在远端早已存在**，
> 且**规格文件正在其中**。以下为完整事实。

#### (a) 在当前工作分支（`feat/v365-production-integrity-impl`，含 V3.6.5）上：**不存在**

| 检索方式 | 命令 | 结果 |
|---|---|---|
| 真仓库 `docs/` | `ls docs/` | **无该文件**（37 个顶层文件，无任何含 `FRONTEND` / `REWRITE` 者） |
| 工作区全盘（排除 `node_modules` / `.git`） | `find . -iname "*FRONTEND*REWRITE*"` | **空输出** |
| 全工作区 md/json/txt 内容检索 | `grep -rl "FRONTEND_REWRITE\|前端彻底重构\|前端重写规格"` | **空输出** |

#### (b) 在远端分支 `origin/refactor/v365-frontend-rewrite` 上：**存在**

| 项 | 值 |
|---|---|
| 路径 | `docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md` ✅ |
| 引入 commit | `aee352c` — `docs(v365): add complete project function and frontend rewrite specification` |
| 作者 / 时间 | **`iquelee`（owner 本人）** · **2026-09-30 16:09:33 +0800** |
| 相对时点 | ★ **比本次审计开工（16:15）早约 6 分钟** |
| 分支基点 | `e93f396`（= `origin/master`）· 该分支领先 master **6 commit** |
| 改动量 | `1 file changed, 1 insertion(+)` |

#### (c) 该文件的**实际内容** = 一个工具报错占位串（`[AS-IS]`）

```text
The requested file reference is not currently visible. Use files.search or files.list
to rediscover the file, then retry with a returned ref_id or file_id.
```
（全文 **155 字节**，仅此一行。）

⇒ ★★ **结论（三态，必须分开表述）**：

| 命题 | 判定 |
|---|---|
| 「该规格文件不存在」 | ⛔ **错**（该路径在 `refactor/v365-frontend-rewrite` 分支上存在） |
| 「该规格文件可用作设计输入」 | ⛔ **错**（其正文是占位报错串，**不含任何规格内容**） |
| 「任务书 §一 所称"项目内已存在一份规格"」 | ⚠️ **部分成立**：文件**已建、正文未落**；owner 提交的是**工具报错文本**，推测原意为「先占位，正文稍后补」 |

**处置**：
1. 本次审计与蓝图**继续以任务书正文（§一~§十五）作为规格内容源**。
2. **不**引用该占位文件的内容（其为报错串）。
3. `⛔ 不得**替 owner 撰写该规格**（越权）；**登记**为待办：**owner 需补该文件正文**。
4. 若 owner 在其他位置已有该规格正文（另一台机器 / 未同步目录），请提供后重新比对。

### 0.1b ★★ 该分支已含前端重写**骨架**（`[AS-IS]`，必须作为重写起点）

`origin/refactor/v365-frontend-rewrite` 除规格占位件外，已含 **5 个 commit**（全部署名 `iquelee`，2026-09-30）：
`refactor(frontend): add new v365 UI foundation components`

其实质内容（`git diff --stat e93f396..db007df`）：

| 文件 | 行数 | 内容摘要 |
|---|---|---|
| `web/src/rewrite/api.js` | 75 | 新 API client：`api{}`（constants/dashboard/etfList/etfDetail/kline/**decisions**/review/fundamentals/intel/**macro**）+ `admin{}`（22 个端点）；`call()` 统一 envelope/401 处理 |
| `web/src/rewrite/domain.js` | 66 | `ETF_NAMES` · `ACTION_LABELS`（含小写别名）· `REGIME_LABELS` · `STATE_LABELS`（W/D/V/F）· `RISK_LABELS` · `roleLabel` + `actionLabel/regimeLabel/etfName/pct/rawPct/num/dateText/toneForAction/first/safeArray` |
| `web/src/rewrite/components/MetricTile.vue` | 16 | 指标块（label/value/note/tone/compact） |
| `web/src/rewrite/components/SectionHeader.vue` | 17 | 区块标题（title/eyebrow/subtitle + actions 插槽） |
| `web/src/rewrite/components/StatusPill.vue` | 12 | 状态胶囊（text/tone/dot） |

**关键含义（改变蓝图前提）**：
1. ★ **新前端的落点是 `web/src/rewrite/`，与旧 `web/src/**` 并存**，不是原地替换目录结构。
   ⇒ 蓝图 §1.2 的目录设计**必须改为落在 `web/src/rewrite/` 之下**（原稿与之冲突，已修正）。
2. ★ 骨架的 `api.js` **已包含旧前端从未使用的 `decisions` 与 `macro`** ⇒ owner 的意图与新蓝图 §6.5「启用死接口」**一致**。
3. ★ `domain.js: toneForAction()` 把动作归为 `accent / good / risk / muted` 四类（ADD/BUILD→accent，HOLD→good，REDUCE/EXIT→risk）——
   **与蓝图 G7「动作语义独立于行情色与风险色」方向一致**，但采用**归类**而非「每动作一色」⇒ 蓝图 §4.1 的 `--act-*` 应**收敛为四类 token**（已修正）。
4. ⚠️ `domain.js` 缺 `H_STATE_LABELS` / `C_STATE_LABELS`（只有 W/D/V/F）—— 重写时需补齐。
5. ⚠️ `domain.js: pct()` 沿用 `Math.abs(n)<=1.5 ? n*100 : n` 的**启发式**（与旧 `fmtProb` 同源）——
   该启发式对「0.5% 这类合法小百分比」会**误乘 100**（审计 §3.9 已记 513310 线上 `final_target=0.5`）。
   ⇒ 蓝图新增 **D-7** 决策点。
6. ⚠️ 该分支基点 = `e93f396`（master），**不含 V3.6.5 的 15 个 commit**；
   而 V3.6.5 侧（`feat/v365-production-integrity-impl`）也不含这些前端 commit ⇒ **两侧各自独立**。
   ⇒ **登记冲突 E**（见 §5.5）。

**基础事实核验（`[AS-IS]`）**：

| 项 | 值 |
|---|---|
| 远端分支 | `refs/heads/refactor/v365-frontend-rewrite` = `db007dfa70136558e9295b07b7d6d3f4346e1061` |
| 与 master 关系 | ahead **6** / behind **0**（merge-base = `e93f396`） |
| 与 V3.6.5 分支关系 | remote-br vs `d669298`：ahead 6 / **behind 15** |
| 是否含 V3.6.5 逻辑 | ❌ 不含（基点早于 V3.6.5 分支） |
| 旧 `web/src/**`（非 rewrite/）是否被改 | ❌ **零改动**（该分支只新增 `web/src/rewrite/**` 与规格占位件） |
| 本地接手方式 | 已 `git checkout -B refactor/v365-frontend-rewrite origin/...` 并设 upstream ⇒ **接续 owner 分支**，⛔ 未 push、未 merge |

### 0.2 环境事实核验（`[AS-IS]`）

| 项 | 值 | 来源 |
|---|---|---|
| CloudBase envId | `tradingview-etf-d0fa42yy57cbc11b` | `cloudbaserc.json`（唯一权威）· 与任务书 URL 一致 |
| 线上前台入口 | `https://tradingview-etf-d0fa42yy57cbc11b-1253568636.tcloudbaseapp.com/#/dashboard` | 任务书 §一.3 |
| 线上后台入口 | 同域 `/#/admin/data` | 任务书 §一.4 |
| 线上 `index.html` sha256 | `e2330cebb11f95a35ed9de68f0a21c7f4d697608427cfd43c6512b6a91ba462f` | 实测下载 |
| 仓库 `web/index.html` sha256 | `28c5f562564d76c9873155965056ee96d593f25176e5dddceb17709e8adfdb0b` | 本地 |

> ⚠️ 两者 sha256 不同，**但差异是预期的**：线上是 Vite 构建产物（`<script src="./assets/index-D4p_s9et.js">` + `<link rel=stylesheet>`），仓库是开发源（`<script src="/src/main.js">`）。`<head>` 的 `charset` / `viewport` / `description` / `title` **逐字完全一致**。⇒ `[AS-IS]` **线上前端由仓库 `web/` 构建而来，非第三方产物**。

**未使用管理员密码**：本次审计**未登录后台**。后台侧仅做**无凭据探测**（见 §3.3），未提交任何密码，未写入任何文件。

---

## §1 当前信息架构（`[AS-IS]`，全部来自源码）

### 1.1 前台路由（`web/src/router/index.js`）

| # | 路径 | 组件 | `meta.title` | 鉴权 | 备注 |
|---|---|---|---|---|---|
| 1 | `/` | `FrontLayout` | — | — | 前台外壳 |
| 2 | `''` | — | — | — | `redirect: /dashboard` |
| 3 | `/dashboard` | `Dashboard.vue` | 全局 | — | 首页 |
| 4 | `/etf` | — | — | — | `redirect: /etf/513310` |
| 5 | `/etf/:code` | `EtfDetail.vue` | 执行 | — | 单 ETF 工作台 |
| 6 | `/structure` | — | — | — | `redirect: /structure/513310` |
| 7 | `/structure/:code` | `Structure.vue` | 看盘 | — | K线 + 雷达 |
| 8 | `/portfolio` | — | — | — | `redirect: /dashboard`（**空壳别名**） |
| 9 | `/review` | `Review.vue` | 历史 | **`requiresAuth: true`** | ⚠️ 见 §4.9 |
| 10 | `/fundamentals` | `Fundamentals.vue` | 基本面 | — | |
| 11 | `/intel` | — | — | — | `redirect: /fundamentals`（**空壳别名**） |
| 12 | `/login` | `admin/Login.vue` | 后台登录 | — | 独立页，不在 layout 内 |

**前台顶部导航**（`FrontLayout.vue` 硬编码，与路由平行维护）：
`全局(/dashboard)` → `基本面(/fundamentals)` → `看盘(/structure)` → `执行(/etf)` → `历史(/review)`

> ⚠️ 导航**顺序与路由无关**（路由里 `etf` 在 `structure` 前，导航里 `看盘` 在 `执行` 前）。
> ⚠️ 导航命名与 owner 既定偏好「全局·情报·标的·复盘」**不一致**（现为 全局·基本面·看盘·执行·历史）。见 §4.10。

### 1.2 后台路由（同文件）

| # | 路径 | 组件 | `meta.title` | 后台菜单（`AdminLayout`） |
|---|---|---|---|---|
| 1 | `/admin` | `AdminLayout` | — | — |
| 2 | `''` | — | — | `redirect: /admin/data` |
| 3 | `/admin/gen1` | `Gen1Health.vue` | Gen-1 运行状态 | ① Gen-1 运行状态 |
| 4 | `/admin/gen2` | `Gen2Shadow.vue` | 选池观察 | ② 选池观察 |
| 5 | `/admin/data` | `DataManage.vue` | 数据管理 | ③ 数据管理 |
| 6 | `/admin/param` | `ParamConfig.vue` | 参数配置 | ④ 参数配置 |
| 7 | `/admin/fundamental` | `FundamentalEntry.vue` | 基本面录入 | ⑤ 基本面录入 |
| 8 | `/admin/risk` | `RiskEvents.vue` | 风险事件 | ⑥ 风险事件 |
| 9 | `/admin/trade` | `TradeLog.vue` | 操作记录 | ⑦ 操作记录 |
| 10 | `/admin/password` | `ChangePassword.vue` | 修改密码 | 侧栏底部（**不在主菜单**） |

### 1.3 鉴权逻辑（`router/index.js` + `api/request.js`）

```
token 存储：localStorage['admin_token']（明文，无过期时间字段，无 refresh）
router.beforeEach:
  if (to.matched.some(r => r.meta.requiresAuth) && !getToken()) → /login?redirect=<fullPath>
  if (to.path === '/login' && getToken())                    → /admin/data
401 处理：
  request(..., {auth:true})  → 若 json.code===401 ⇒ setToken(null) + window.location.hash='#/login'
  adminRequest(...)          → 若 json.code===401 ⇒ setToken(null) + window.location.hash='#/login' + throw
登录重定向白名单：raw.startsWith('/') && !raw.startsWith('//') && raw.indexOf('://')<0（防开放跳转，实现正确）
```

`[AS-IS]` 实测：后台网关**全部**接口无 token 时返回 `{"code":401,"data":null,"message":"未登录或登录已过期"}`，**HTTP 状态码为 200**（见 §3.3）。⇒ 前端必须靠 `json.code` 判断，不能靠 `res.ok`——现有实现**正确**。

### 1.4 公共组件 / 图表组件 / 工具 / 常量

| 类别 | 文件 | 行数 | 被谁使用 | 状态 |
|---|---|---|---|---|
| 布局 | `layouts/FrontLayout.vue` | 142 | 前台全部 | 活 |
| 布局 | `layouts/AdminLayout.vue` | 193 | 后台全部 | 活 |
| 公共 | `components/common/DataBadge.vue` | 31 | Dashboard / EtfDetail / Structure | 活 |
| 公共 | `components/common/RiskAlertBar.vue` | 28 | Dashboard / EtfDetail | 活 |
| 公共 | `components/common/DecisionChain.vue` | 76 | EtfDetail | 活 |
| 公共 | `components/common/ScoreBar.vue` | 83 | EtfDetail | 活 |
| 图表 | `components/charts/KlineChart.vue` | 129 | Structure | 活（ECharts） |
| 图表 | `components/charts/RadarChart.vue` | 71 | Structure | 活（ECharts） |
| 图表 | `components/charts/SignalStrip.vue` | 49 | **无人引用** | **死组件** |
| 工具 | `utils/constants.js` | 169 | 全局 | 活（**双通道注入**，见 §4.5） |
| 工具 | `utils/state.js` | 65 | DecisionChain | 活 |
| 工具 | `utils/format.js` | 66 | 多处 | 活（**与各视图内联格式化重复**，见 §4.6） |
| 工具 | `utils/etf.js` | 16 | Review / RiskEvents / TradeLog | 活 |
| 工具 | `utils/tableScrollHint.js` | 55 | `main.js` 全局挂载 | 活（MutationObserver 全树监听） |
| 样式 | `styles/main.css` | 307 | 全局 | 活（单例设计系统） |

`[AS-IS]` `SignalStrip.vue` 全仓库 `grep -rn "SignalStrip" web/src/` 无输出 ⇒ 从未被 import。

### 1.5 常量与格式化（职责现状）

- **常量**：`W/D/H/V/F/C` 六组状态标签 + `ML_SIGNAL_STATUSES` + `ACTION_LIST/ACTION_LABELS/ACTION_COLORS` + `RISK_FLAG_LABELS/COLORS` + `MARKET_REGIME_LABELS` + `OVER_ALLOC_LABELS` + `PREMIUM_FLAGS` + `SECTORS` + `ETF_NAMES` + `ENGINE_VERSION` + `SCORE_DIMENSIONS` + `OPPORTUNITY_GRADE_*`。
- **格式化**：`formatNumber / formatPercent / formatAmount / formatPrice / formatShares / formatDate / formatDateTime / formatDirection / dash`。
- **样式**：`main.css` 定义 `--c-*` 色板、`.card / .badge / .table / .btn / .input / .stat-card` 等原子类，断点 `768 / 900 / 1100 / ≥1800`。

---

## §2 页面 → API → 数据结构映射（`[AS-IS]`）

> **方法**：逐页读源码提取字段引用 → 以**线上真实响应**（2026-09-30 抓取，见 `_v365-fe-audit-20260930/live/`）逐字段核对。
> **归属图例**：`SC`=V3 Safety Core · `G1`=Gen-1 · `G2`=Gen-2 Shadow · `ACCT`=账户/执行 · `FUND`=基本面 · `HIST`=历史复盘 · `OPS`=运维/元数据

### 2.1 前台 Dashboard `/dashboard`

**API**：`GET {apiGateway}/api/dashboard`

**线上真实顶层结构** `[AS-IS]`：
```
data: { engine_mode, v3_mode, ml_shadow, three_questions, overview, cards[5] }
  engine_mode      = "defense"
  v3_mode          = "cutover"
  three_questions  = { market_status:"防守", most_worth:null, most_defend:{code,name} }
  overview         = { total_asset, cash_balance, holdings_mv, asset_source, tech_position,
                       gold_position, cash_ratio, total_pnl, auto_pnl, snapshot_date,
                       market_regime, etf_total, innovation_position, overall_risk }
  cards[i]         = { code, name, sector, stage, wait_reason, action, action_label,
                       opportunity_score, opportunity_grade, risk_flag, risk_override,
                       current_position, target_position, target_min, target_std, target_max,
                       max_position, final_target, position_gap, over_alloc_status,
                       core_position, trade_position, suggest_position, data_time,
                       explain_chain, shadow_targets, trend_stage, trend_stage_overlay,
                       binding_constraint, engine_version, shadow_engine_version, target_delta,
                       aggressive_divergence, w_state, main_rally_utilization, v3_allowed_max,
                       momentum_acceleration, v3_shadow_gap, ml_shadow }
```

**页面字段 → 结构映射**：

| 页面展示 | 读取字段 | 归属 | 线上是否存在 |
|---|---|---|---|
| Hero「市场环境」 | `three_questions.market_regime` | SC | ❌ **不存在**（线上是 `market_status`） |
| Hero「Gen-1」 | `three_questions.gen1_advice` | G1 | ❌ **不存在** |
| Hero「风险」 | `three_questions.risk_status` \|\| `overview.overall_risk` | SC | ⚠️ 前者不存在；后者存在（**兜底命中**） |
| 隐杠杆黄条 | `overview.leverage_alert` / `total_book_pct` / `cash_ratio_raw` | ACCT | ❌ **三个字段线上均不存在**（恒不渲染） |
| 策略状态·市场环境 | `overview.market_regime` | SC | ✅ |
| 策略状态·策略风险 | `overview.overall_risk` | SC | ✅ |
| 策略状态·信号覆盖 | `overview.etf_total` | OPS | ✅ |
| 账户总览·现金比例 | `overview.cash_ratio` | ACCT | ✅（实测 84.6） |
| 账户总览·科技/黄金/创新药 | `overview.tech_position` / `gold_position` / `innovation_position` | ACCT | ✅ |
| 账户总览·浮盈 | `overview.total_pnl` | ACCT | ✅（实测 -823.8） |
| 运行状态条 | `ml_shadow.enabled` / `capability.*` | G1 | ⚠️ `enabled` ✅；**`capability` 线上不存在**（恒走兜底文案） |
| 状态卡·Gen-1 状态 | `c.gen1.status.label` / `.message` | G1 | ❌ **`c.gen1` 线上不存在** ⇒ 恒「状态待更新」 |
| 状态卡·建议 | `c.gen1.advisory.action_label` → 兜底 `c.action`+`c.action_label` | G1→SC | ⚠️ 永远走**兜底** |
| 状态卡·仓位 | `c.gen1.advisory.current_pct/delta_pct` → 兜底 `c.current_position` | G1→ACCT | ⚠️ 永远走**兜底** |
| 状态卡·建议目标 | `c.gen1.advisory.target_label` → 兜底 `c.final_target` | G1→SC | ⚠️ 永远走**兜底** |
| 状态卡·Fast Path | `c.gen1.signal.fast_path` | G1 | ❌ 恒 `—` |
| 状态卡·模型适用性 | `c.gen1.applicability.label` | G1 | ❌ 恒「待核验」 |
| 状态卡·风险 | `c.risk_flag` | SC | ✅ |
| 状态卡左边框色 | `ACTION_COLORS[c.action]` | SC | ✅ |

> **★ 核心结论**：Dashboard 的「Gen-1 主口径」在**生产上完全失效**——`c.gen1` 从来不存在，六个 Gen-1 关联展示位**全部**降级为兜底文案或 `—`。而 Gen-1 的真实数据（约 60 个 `gen1_*` 字段）实际埋在 `decision.*` 里（见 2.2），**前端从未读取**。

### 2.2 前台 ETF 工作台 `/etf/:code`

**API**：`GET {apiGateway}/api/etf/:code` + `GET /api/etf/list`

**线上真实顶层结构** `[AS-IS]`：
```
data: { basic, snapshot, decision, ml_shadow, fundamental, risk_events, position,
        fundamental_config, fundamental_series, holdings, holdings_date }
  basic   = { _id, code, name, sector, is_qdii, max_position, target_position, status, sort_order }
  snapshot= { _id, code, calc_date, ma5,ma10,ma20,ma60,ma120,ma250, atr20, vol20,
              sideway_days, sideway_range, ma20_slope, trend_context, consolidation_score,
              breakout, volume_ratio, volume_slope, v_state, w_state, d_state, h_state,
              stage_summary, high_volume_stagnation, high_volume_decline, price_position,
              premium_rate, change_5d, bias_20d, data_complete, version }
  decision= { …约 150 字段，含约 60 个 gen1_* 字段与 v38_/v361_/v3_ 遗留… }
  ml_shadow={ enabled, effective, observe, fast_path_enabled, model_id, bundle_id,
              gen1_frozen, engine_version, ui_phase, production_permission, note,
              generated_at, stage, probability, calibrated_probability, permission,
              permission_hit, would_trigger_fast_path, signal_status, production_target_pct,
              counterfactual_target_pct, delta_target_pct, decision_hash, signal_date,
              data_age_days, is_stale, has_signal_row }
  position= { _id, code, current_position, target_position, max_position, avg_cost, updated_at,
              core_position, core_ratio_grade, max_strategic_position, target_max/min/std,
              trade_position, core_ratio_changed_at, pending_grade, pending_since, shares,
              suggested_core, suggested_trade, trade_changed_at, trade_pending_grade,
              trade_pending_since, trade_ratio_grade, shock_state, slow_break_history,
              trend_stage_state }
  risk_events = [ 0 条（实测） ]
  ★ gen1：不存在（hasOwnProperty('gen1') === false）
```

**页面字段 → 结构映射**：

| 页面展示 | 读取字段 | 归属 | 线上 |
|---|---|---|---|
| ETF 名/代码/赛道 | `basic.name/code/sector` | OPS | ✅ |
| **Gen-1 主建议卡（整块）** | `detail.gen1.*` | G1 | ❌ **`v-if="gen1"` ⇒ 整卡不渲染** |
| 徽标·Gen-1 动作 | `gen1.advisory.action_code/action_label` | G1 | ❌ |
| 近5日涨幅 | `snapshot.change_5d` | SC | ✅ |
| 当前仓位 | `position.current_position` | ACCT | ✅ |
| 风险/溢价/拥挤度/基本面 | `decision.risk_flag/premium_flag/c_state/f_state` | SC | ✅ |
| 技术详情·目标区间 | `decision.target_min/target_max` | SC | ✅ |
| 技术详情·建议目标 | `decision.final_target` | SC | ✅ |
| 技术详情·建议缺口 | `decision.position_gap` | SC | ✅ |
| 技术详情·核心/交易 | `decision.core_position/trade_position` | SC | ✅ |
| 技术详情·超配状态 | `decision.over_all_status`（**笔误**，线上为 `over_alloc_status`） | SC | ❌ **拼写错误 ⇒ 恒「后台查看」** |
| 加仓冷静期 | `decision.cooldown_days` | SC | ✅ |
| 加仓资格 8 项 | `decision.add_eligibility.{trend,structure,volume,fund,chase,limit,sector,risk}` | SC | ⚠️ 线上有 10 项，**`cooldown`/`regime` 两项未展示** |
| 机会等级 | `decision.opportunity_grade` | SC | ✅（实测 `B`） |
| 评分卡五维 | `decision.scores.{trend,volume,fundamental,crowding,risk}` | SC | ✅（实测 `5/25/20/15/10`；`scores.total=75` 被有意忽略） |
| 决策链「为什么」 | `decision.explain_chain[]` | SC | ✅（实测 13 步，`{step,condition,result}` 结构匹配） |
| 下一加仓条件 | `decision.next_add_condition` | SC | ✅ |
| 模型审计·Gen-1/P(S2→S4)/校准概率/反事实 | `ml_shadow.*` | G1 Shadow | ✅（`enabled` 判定） |
| 风险红条 | `decision.risk_flag/risk_override` + `risk_events[0].reason` | SC | ✅ |
| **未被消费的死载荷** | `fundamental` / `fundamental_config` / `fundamental_series` / `holdings` / `holdings_date` | FUND | 线上返回 30KB+，前台**一字未用** |

### 2.3 前台 看盘 `/structure/:code`

**API**：`api.etfDetail` + `api.kline`

| 页面展示 | 读取字段 | 归属 | 线上 |
|---|---|---|---|
| K线 + 量价（MA20/MA60/成交量） | `kline[].{date,open,close,low,high,volume}` | SC | ✅（实测 320 根） |
| 阶段识别 W/D/H/V | `snapshot.{w,d,h,v}_state` | SC | ✅ |
| 横盘详情 | `snapshot.{trend_context,sideway_days,sideway_range,ma20_slope,consolidation_score}` | SC | ✅ |
| 加仓雷达（4 维） | `snapshot.{sideway_days,volume_ratio,price_position}` + `decision.scores.trend` | SC | ✅（**雷达轴在视图内自行换算**，见 §4.2） |
| 防守雷达（4 维） | `snapshot.{high_volume_stagnation,high_volume_decline}` + `decision.scores.{volume,trend}` | SC | ✅（同上） |
| 顶栏 Gen-1 摘要 | `detail.gen1.status.label` / `.signal.fast_path` | G1 | ❌ **恒不渲染** |

> ⚠️ `structure` 与 `etf` **各自独立请求同一个 `/api/etf/:code`**（无缓存、无共享 store），页面切换即重复请求。`[AS-IS]`

### 2.4 前台 基本面 `/fundamentals`

**API**：`api.fundamentals` + `api.intel(80)` + `adminApi.intelRefresh`（刷新按钮）

| 页面展示 | 读取字段 | 归属 | 线上 |
|---|---|---|---|
| ETF 页签 + F 状态 | `list[].{code,name,f_state}` | FUND | ✅（实测 F2/F1/F1/F3/F3） |
| 合成判断行 | `card.detail.layer_breakdown.{hard_data,earnings,events}.{count,signal}` | FUND | ✅ |
| 信号/覆盖 | `card.detail.final_signal` / `total_layer_weight` | FUND | ✅ |
| 分层指标表 | `card.indicators[].{indicator,name,weight,layer,metric_type,value,unit,direction,data_date,source_label,note,citations}` | FUND | ✅ |
| AI 研究证据 | `card.ai_judgments[].{indicator,title,stock_name,grade,source_label,reason,week_date}` | FUND | ✅（**有二级兜底**：从 `indicators` 里筛 `qualitative` 反推） |
| 财报与公告流 | `intel.items[].{type,type_label,title,time,detail,impact,tone,related}` | FUND | ✅（实测 `total=180`） |
| 手动刷新 | `POST /api/admin/intel/refresh` | OPS | ⚠️ **前台页面调用后台写接口**（见 §4.8） |
| 轮询 | `setInterval(5min)` + `visibilitychange` 暂停/恢复 | — | ✅ 实现正确 |

> `[AS-IS]` 该页**同时调用前台只读接口与后台写接口**：`api.fundamentals`（无鉴权）与 `adminApi.intelRefresh`（需 token）。未登录时刷新按钮会 401 → 前端会 `setToken(null)` 并跳 `#/login`——即**点一下「刷新」就把访客踢到登录页**。

### 2.5 前台 历史复盘 `/review`

**API**：`GET {apiGateway}/api/review?from&to&code&action`（**带 `X-Admin-Token`**）

> ⚠️ 线上未登录，**未取得该接口真实响应** ⇒ 数据结构 `[NOT VERIFIED]`。以下为源码字段引用，仅作重写输入。

| 页面展示 | 读取字段 | 归属 |
|---|---|---|
| 复盘统计 8 项 | `stats.{decision_snapshot_count,actionable_count,execution_rate,reverse_operation_count,unexecuted_count,build_execution_rate,defense_execution_rate,avg_response_days}` | HIST |
| 决策快照时间轴 | `decisions[].{decision_date,code,current_position,position_source,position_is_exact,position_as_of_date,final_action,action_label,gen1.*}` | HIST + G1 |
| 时间轴·EOD 信号状态 | `d.gen1.status.label/message` | G1 | ❌ **`decisions[]` 线上无 `gen1`**（实测 `/api/etf/513310/decisions` 33 行逐行确认） |
| 偏差表 | `deviations[].{date,operation_date,code,system_action,actual_action,deviation,matched_by,decision_id}` | HIST |
| 实际操作记录 | `trades[].{trade_date,code,action,position_after,system_action,system_decision_date,system_match_type}` | HIST/ACCT |

### 2.6 后台各页映射

| 页面 | API | 关键字段 | 归属 |
|---|---|---|---|
| `Gen1Health` | `GET /api/admin/gen1/health` | `model_id, frozen, advisory_enabled, fast_path_enabled, auto_trading, today, rows[].{code,name,signal_date,status,fresh,probability,permission,fast_path_candidate}` | G1 |
| `Gen2Shadow` | `GET /api/admin/gen2/shadow` | `selection.{run_date,as_of_trade_date,mode,selection_confidence,eligible_count,ranked_count,universe_coverage,role_classification,status,confidence_reason}` · `rankings[].{rank,code,name,correlation_cluster,alpha_score_v2,trend_gate,regime,persistence_days,candidate_weight,defense_state,role,reason_codes}` | G2 |
| `DataManage` | `GET /api/admin/fetchlog` · `POST /api/admin/fetch` | `list[].{fetch_time,source,status,item_count,task_name,duration_ms,error}` + **10 个数据源硬编码元数据** | OPS |
| `ParamConfig` | `GET/POST /api/admin/param` | `list[].{key,description,category,value.v,prev_value.v,version,frozen}` | OPS/SC |
| `FundamentalEntry` | `GET/POST /api/admin/fundamental/{config,data,series,holdings}` | `configs[].{indicator,name,weight,freq,source,unit,metric_type}` · `series[0].{value,direction,data_date,note}` · `holdings[].{rank,stock_code,stock_name,weight,market}` | FUND |
| `RiskEvents` | `GET /api/admin/risk/list` · `POST /api/admin/risk` | `list[].{_id,code,event_type,risk_flag,risk_override,status,reason,note,trigger_time}` | SC |
| `TradeLog` | `GET/POST /api/admin/trade` · `POST /api/admin/portfolio/snapshot` · `GET /api/dashboard` | `list[].{_id,trade_date,code,action,shares,price,position_after,reason}` · `res.sync.{ok,manual,position,shares,price,total_asset,error}` · `res.{snapshot_date,cash_balance}` | ACCT |
| `Login` | `POST /api/admin/login` | `token` | OPS |
| `ChangePassword` | `POST /api/admin/changePassword` | — | OPS |

### 2.7 归属统计（`[AS-IS]`）

| 归属 | 前台主要落点 | 后台主要落点 | 现状评估 |
|---|---|---|---|
| **SC** V3 Safety Core | Dashboard 状态卡、EtfDetail 技术详情/评分卡/决策链 | ParamConfig、RiskEvents | 数据**齐全**，但被折叠在 `<details>` 里 |
| **G1** Gen-1 | Dashboard 状态卡、EtfDetail 主建议卡、Review 时间轴、Structure 摘要 | Gen1Health | ❌ **前台四个落点全部拿不到数据**（`gen1` 对象不存在） |
| **G2** Gen-2 Shadow | **无** | Gen2Shadow | ⚠️ 前台无任何 Gen-2 展示（符合「Shadow 不进前台」的意图，但无显式声明） |
| **ACCT** 账户/执行 | Dashboard 账户总览、EtfDetail 仓位 | TradeLog | ✅ 有前台隐私遮罩 |
| **FUND** 基本面 | Fundamentals、EtfDetail（**死载荷**） | FundamentalEntry | ⚠️ EtfDetail 拉取 30KB 基本面数据却不用 |
| **HIST** 历史复盘 | Review | TradeLog | ⚠️ Review 依赖 admin token |
| **OPS** 运维 | — | DataManage、Gen1Health、Login | ✅ 均在后台 |

---

## §3 线上与代码差异（`[AS-IS]`）

### 3.1 线上静态托管可达性

| 请求 | 结果 |
|---|---|
| `WebFetch GET /`（无浏览器 UA） | ❌ 返回 CloudBase **「风险提醒」测试域名插页**（「仅供开发测试使用…请勿泄露个人信息」），**非应用本体** |
| `curl -A "<Chrome UA>" GET /index.html` | ✅ **HTTP 200 · text/html · 620 B · 真实应用 HTML** |
| `curl -A "<Chrome UA>" GET /definitely-not-exist-xyz.html` | HTTP 404 · «404 Not Found» |
| `curl -A "<Chrome UA>" GET /favicon.ico` | HTTP 404（**未部署 favicon**） |

**结论**：`[AS-IS]` 线上静态站**已部署且可访问**；「风险提醒」是 CloudBase 测试域名对**非浏览器 UA** 的风控插页，**不是**未部署、也不是应用故障。
⇒ 任务书 §二.4 要求「线上无法访问的页面记录原因」：**本项可访问**，但**自动化工具需带浏览器 UA** 才能绕过插页。

### 3.2 线上前端资产清单（版本指纹）

线上 `index.html` 引用：

| 类型 | 文件 | 大小 |
|---|---|---|
| entry JS | `/assets/index-D4p_s9et.js` | 107,272 B |
| CSS | `/assets/index-DM1STc5W.css` | 8,079 B |

entry chunk 内声明的 **21 个懒加载 chunk**（全部实测 HTTP 200 可下载）：

```
FrontLayout-BMfiSelB   _plugin-vue_export-helper-DlAUqK2U   Dashboard-CnhAEnd-
format-OPXGuoyw        DataBadge-JXtgYPX9                   RiskAlertBar-I5uUHVIs
EtfDetail-EgGzL7t1     Structure-Xyt7RnT_                   Review-BKC0TyS3
etf-CDmkE-qq           Fundamentals-CWyQB1Jt                AdminLayout-dJrhDJnb
Gen1Health-DrDKx-7e    Gen2Shadow-DxAmJGTZ                 DataManage-CkF3V-fX
ParamConfig-BwMcHF7p   ChangePassword-CLxcqkZ1              FundamentalEntry-8RP7pBHk
RiskEvents-DwttJihy    TradeLog-1ZtxGXTh                    Login-rN5WLlKd
```

> ★ `Structure-Xyt7RnT_.js` = **1,045,588 B**（1.0 MB）——因 ECharts 被整个打进该 chunk。**首屏不加载，但进入「看盘」会下载 1MB**。`[AS-IS]`

### 3.3 线上 API 实测（只读）

**前台网关** `{host}/apiGateway` —— 全部 **HTTP 200 · `code:0`**：

| 端点 | 大小 | `data` 顶层 |
|---|---|---|
| `/api/dashboard` | 13,785 B | `engine_mode, v3_mode, ml_shadow, three_questions, overview, cards` |
| `/api/etf/list` | 2,157 B | `list`（5 只） |
| `/api/etf/513310` | 16,653 B | `basic, snapshot, decision, ml_shadow, fundamental, risk_events, position, fundamental_config, fundamental_series, holdings, holdings_date` |
| `/api/etf/518880` | 13,291 B | 同上 |
| `/api/etf/513310/kline?period=daily` | 39,602 B | 数组 **320** 根 |
| `/api/etf/513310/decisions` | 172,484 B | 数组 **33** 行（2026-08-14 → 2026-09-29） |
| `/api/fundamentals` | 36,213 B | `list`（5 只） |
| `/api/intel?limit=5` | 2,567 B | `items` + `total=180` |
| `/api/macro` | 3,324 B | `indicators`（含 `pmi` 等 10 期序列） |
| `/api/constants` | 3,595 B | `w/d/h/v/f/c_state_labels, action_labels, risk_flag_labels, sectors, etf_names, engine_version, runtime_status` |

**后台网关** `{host}/adminGateway` —— 无 token 探测，**全部 `code:401` · HTTP 200**：

`/api/admin/gen1/health` · `/api/admin/gen2/shadow` · `/api/admin/param` · `/api/admin/trade` · `/api/admin/risk/list` · `/api/admin/fetchlog` ⇒ 均 `{"code":401,"data":null,"message":"未登录或登录已过期"}`

⇒ `[AS-IS]` **鉴权边界在服务器侧生效**，未登录拿不到任何后台数据。

### 3.4 线上前端 ↔ 仓库源码：**一致**

核验方式：下载线上 chunk，反查源码特征串。

| 核验项 | 结果 |
|---|---|
| 线上路由表（entry chunk 内 `import("./Dashboard-….js")` 序列） | ✅ **与 `router/index.js` 逐条一致**（path / name / component / 顺序） |
| Dashboard chunk 含 `three_questions.market_regime` / `gen1_advice` / `risk_status` | ✅ **与仓库 `Dashboard.vue` 一致**，且**不含** `market_status` / `most_defend`（线上 API 的真实字段） |
| Dashboard chunk 含 `数据待更新` / `市场环境` / `风险：` / `Fast Path` / `模型适用性` / `状态待更新` | ✅ 全部命中源码字面量 |
| EtfDetail chunk 含 `Gen-1 趋势启动增强` / `技术详情 / Safety Core 对照` / `P(S2→S4)` / `校准概率` / `反事实` | ✅ 全部命中 |
| entry chunk 含 `优秀整理` / `半导体设备` / `中韩半导体` / `战术减仓` / `战略减仓` / `拥挤度` / `周线` / `V3.6.1` / `__CONSTANTS__` | ✅ 全部命中 `constants.js` / `state.js` / `main.js` |
| Dashboard chunk **不含** `已无可减空间` / `减到` / `加到` | ✅ **预期**——`positionText()` 是**仓库内的死函数**（定义于 `Dashboard.vue:36`，模板从未引用），被 tree-shaking 移除 |

> **★ 结论**：`[AS-IS]` **线上前端 = 仓库 `web/` 的构建产物，无版本漂移**。
> 因此，**线上所有可见缺陷都可以在仓库源码里定位并复现**，不存在"只线上存在"的前端状态。
> **唯一的线上独有状态在数据库侧**，见 §3.5。

### 3.5 线上独有的状态（非前端所致）

| 状态 | 值 | 时间戳 | 说明 |
|---|---|---|---|
| `ml_shadow.engine_version` | `"v3.6.1"` | — | 「Gen-1 模型」的引擎版本，**与生产身份是两条轴** |
| `constants.engine_version` | `"v3.6.1"` | — | 同上 |
| `constants.runtime_status.production_engine` | `"v3.6.1"` | `updated_at: 2026-09-30T00:00:58.305Z` | ⚠️ **见 §5.1 冲突登记** |
| `constants.runtime_status.config_version` | `"2026-09-01-gen1-advisory-active"` | 同上 | 线上真实配置版本标识 |
| `constants.runtime_status.*` 边界字段组 | `ml_effective=false` · `ml_advisory_enabled=true` · `ml_execution_enabled=false` · `gen1_production_write=false` · `gen1_auto_execution=false` · `gen1_broker_wired=false` · `gen1_production_fast_path_enabled=false` | 同上 | ⚠️ **前端从未读取 `runtime_status`**（`applyServerConstants` 只吃标签类键） —— 这是 §七 要求的 V3.6.5 生产生命周期数据的**现成载体**，但当前 UI 完全未用 |

### 3.6 线上 API 与前端契约断裂清单（已复现）

| # | 前端读取 | 线上实际 | 后果（线上可见） |
|---|---|---|---|
| 1 | `three_questions.market_regime` | `three_questions.market_status` | Hero「市场环境」恒显示 **`—`** |
| 2 | `three_questions.gen1_advice` | 无 | Hero「Gen-1」恒显示 **「数据待更新」** |
| 3 | `three_questions.risk_status` | 无 | Hero「风险」走兜底 `overview.overall_risk`，**尚可显示** |
| 4 | `overview.leverage_alert` / `total_book_pct` / `cash_ratio_raw` | 无 | 隐杠杆黄条 **恒不渲染** |
| 5 | `c.gen1.*`（6 处） | 无 `gen1` | 状态卡 Gen-1 状态/Fast Path/模型适用性 **恒兜底** |
| 6 | `detail.gen1.*` | 无 `gen1` | EtfDetail **整块「Gen-1 趋势启动增强」主建议卡不渲染** |
| 7 | `d.gen1.*`（Review） | 无 `gen1` | 时间轴「EOD 信号状态」**恒 `—`** |
| 8 | `decision.over_all_status` | `decision.over_alloc_status` | 超配状态 **恒「后台查看」**（纯拼写错误） |
| 9 | `ml_shadow.capability.*` | 无 | 运行状态条副标题恒兜底文案 |
| 10 | `add_eligibility.{cooldown,regime}` | **存在** | 10 项判据只展示 8 项 |

> ⚠️ 特别说明 #8：`over_all_status` vs `over_alloc_status` 是**前端笔误**（非后端变更）。因 `decision.over_alloc_status` 实测存在（`"normal"` 之类），该字段本可正常显示。
>
> ★★ **上表不是"后端不下发 Gen-1"** —— 根因是**三层叠加**，见 §3.7。初版本文档曾把 #5/#6/#7 归因为「后端无此数据」，
> 经查证后**该归因不成立，已修正**：契约**存在**，但 (a) 前端读的是**自我设想的形状**、(b) 承载契约的 `apiGateway` **未部署**。

---

### 3.7 ★★ 根因：PR-UI-01 契约存在，但前端从未跟进 + apiGateway 未部署

> 本节修正 §3.6 的初步归因。**这不是"后端没有 Gen-1 数据"，而是"前端读错了形状"叠加"契约未上线"。**

#### 3.7.1 后端**已存在**正式的 UI 契约模块

`[AS-IS]` 仓库存在 `src/common/utils/gen1-ui-view-model.js`（22,908 B，`f8c146b`，2026-09-11「PR-UI-01 final-fix」），
导出 `buildSystemRuntime / buildEtfUiViewModel / buildReviewGen1 / buildLegacyNotice / engineFromDecision`。

`[AS-IS]` 仓库 `cloudfunctions/apiGateway/index.js`（1,194 行）**已在以下位置接入该契约**：

| 行 | 下发内容 |
|---|---|
| 334-349 | `buildEtfUiViewModel(...)` → `production: uiVm.production` + `gen1: uiVm.gen1`（**detail 端点**） |
| 445-448 | `system_runtime: buildSystemRuntime(runtime)` + `legacy: buildLegacyNotice()`（**dashboard 端点**） |
| 593-616 | `production` + `gen1` + `system_runtime` + `legacy`（**dashboard 的卡片级**） |
| 798, 828 | `review` 行附 `gen1: buildReviewGen1(d)`；当前生产引擎只在 `system_runtime.production.engine` 表达 |

#### 3.7.2 契约的**真实形状**（与前端假设完全不同）

```
data.production = { action_code, suggested_pct, final_target_pct, current_pct }
data.gen1       = { authority, authority_label,
                    status,                       // ← 字符串枚举 NO_OPPORTUNITY|OBSERVED|CANDIDATE|BLOCKED|DEGRADED
                    signal: { signal_status, probability, stage, model_candidate,
                              health_status, domain_status, ... },
                    stages: { signal, baseline, effective },      // ★ 三拆，禁止串位
                    safety: { eod_stage, baseline_stage, binding_stage, binding_stage_source, ... },
                    applicability: { domain_status, domain_permission, ... },
                    counterfactual: { target_pct, suggested_pct, delta_pct, ... } }
data.system_runtime = { production: { status, engine, engine_source },
                        gen1: { authority, authority_label, health_status, health_gate_status,
                                safety_source, counterfactual_authorized / _health_allowed / _active,
                                production_write, production_fast_path_enabled, auto_execution,
                                safety_invariant_ok },        // ← 三态：true / false / null(UNKNOWN)
                        gen2: { mode, source, production_write_source } }
data.legacy     = { deprecated: true, do_not_use_for_authority: true, fields: [...] }
```

#### 3.7.3 前端假设的形状（`[AS-IS]`，与契约**零交集**）

| 前端读取 | 契约实际提供 | 交集 |
|---|---|---|
| `detail.gen1.advisory.action_label` | `production.action_code`（无 `action_label`） | ❌ |
| `detail.gen1.advisory.current_pct` | `production.current_pct` | ❌ |
| `detail.gen1.advisory.target_label` | `production.final_target_pct`（数字，无 label） | ❌ |
| `detail.gen1.advisory.delta_pct` | 契约中 delta 在 `gen1.counterfactual.delta_pct` | ❌ |
| `detail.gen1.status.label` / `.message` / `.tone` / `.code` | `gen1.status` 是**字符串**（无 `.label`） | ❌ |
| `detail.gen1.signal.fast_path` | `gen1` 无 `signal.fast_path`（fast path 在 `system_runtime.gen1.production_fast_path_enabled`） | ❌ |
| `detail.gen1.applicability.label` / `.domain_status` / `.observed_folds` / `.total_folds` | `applicability.domain_status` ✅；`label`/`observed_folds`/`total_folds` ❌ | 🔶 部分 |
| `detail.gen1.risk.permission_label` / `.binding_label` | `gen1.safety.*` + `gen1.signal.*` | ❌ |

⇒ `[AS-IS]` 前端读取的 `gen1.*` 是一个**从未存在过**的形状。逐字段命中率：**0 / 8**。

#### 3.7.4 时间线（`[AS-IS]`，决定性证据）

| 时间 | 事件 | 证据 |
|---|---|---|
| 2026-09-08 | 前端 `Dashboard.vue` / `EtfDetail.vue` **建立**，按作者当时设想的 `gen1.advisory.*` 形状渲染 | `git log -1 -- web/src/views/Dashboard.vue` → `8fc3ba6` |
| 2026-09-11 | 后端才建立契约，形状为 `production` + `gen1`（**与前端设想完全不同**） | `git log -1 -- src/common/utils/gen1-ui-view-model.js` → `f8c146b` |
| 2026-09-11 → 09-30 | **前端 `web/src/views/**` 再无任何 commit**（停留 09-08） | 逐文件 `git log -1` |
| 2026-09-30 | 仓库 `apiGateway/index.js` 接入契约 | `git log -1` → `d669298` |
| 2026-09-30 | **部署只发生一次，且只部署了 `runDecisionEngine`** —— ⛔ 未部署 `apiGateway` | 台账 C-021.2 §7/§9：「未部署任何其他 Cloud Function」；`_v365-deploy/` 仅含 `dist-backup-runDecisionEngine` |
| 现今 | 线上 `apiGateway` 仍是 **2026-09-01** 的旧版（41,987 B，契约标记 grep = **0**） | 本地快照 `online-apiGateway/index.js`（mtime 2026-09-01 15:13） |

#### 3.7.5 结论

```
线上「Gen-1 主口径失效」= 缺陷A ∧ 缺陷B

缺陷 A（前端，本任务范围内）
  web/src/views/** 自 2026-09-08 起未跟进 PR-UI-01 契约；
  按自我设想的 gen1.advisory.* 形状读取，命中率 0/8。

缺陷 B（后端部署，⛔ 超出本任务授权）
  线上 apiGateway = 2026-09-01 版，不包含 production / gen1 / system_runtime / legacy；
  即使前端改成读契约，线上仍无字段可得。
  ⇒ 修好前端后，**仍需一次 apiGateway 部署**才能在生产上看到效果。
```

> ★★ **对任务的直接影响**：
> 1. **契约已存在，不需要前端"合成"权威**（撤销蓝图 D-1 的选项 B）。前端应**照契约形状读取**。
> 2. **但存在硬依赖：`apiGateway` 必须（重新）部署**。本任务明确 **NO DEPLOY** ⇒
>    ⇒ 重写后的前端**在未部署 apiGateway 前，生产上仍无法显示 Gen-1 主口径**，只能显示**显式的 `UNAVAILABLE`**。
>    **这是必须让 owner 知情的既成约束，不是前端能单独解决的。**
> 3. `tests/gen1-ui-contract.test.js`（09-30 建立）**只守卫后端契约与 gateway 接线**，**不守卫前端渲染** ——
>    ⇒ 它**不会**因前端重写而失败；**前端渲染目前完全没有契约测试**（审计 §10.5 的 D-6 据此收窄）。

> `[UNKNOWN]` **契约模块的 `advisory` 字段（源码中 `advisory` 出现 4 次）具体出现在哪个 builder、供谁消费** ——
> **未逐处展开核验**，故**不作断言**。若前端原先设想的形状来源于契约早期草稿，需另查历史版本；**本轮未验证**。

---

## §4 旧前端技术债清单（`[AS-IS]`，逐条带证据）

### 4.1 页面自行解释后端字段（最严重）

- `Dashboard.vue` / `EtfDetail.vue` / `Review.vue` **各自内联**读取 `gen1` 对象并拼装文案；`Structure.vue` 也不例外。
- `EtfDetail.vue` 内联 `stageLabel(kind,key)`（第 74-77 行）与 `Structure.vue` 内联 `stateLabel(kind,key)`（第 88-91 行）**是同一函数的两份拷贝**。
- `Dashboard.vue:32` `sectorLabel` / `EtfDetail.vue:73` `sectorLabel` / `Structure.vue:87` `sectorLabel` —— **三份相同实现**。
- 无任何 adapter / view-model 层；**模板直接消费 CloudBase 原始字段**。

### 4.2 重复的 action / risk / regime / state 映射

| 映射 | 重复位置 |
|---|---|
| `ACTION_LABELS` 兜底 | `constants.js:actionLabel` + `state.js:prettyExplain`（正则替换 7 个 action 英文）+ `EtfDetail.vue:GRADE_LABELS`（另一份机会等级表，**与 `constants.OPPORTUNITY_GRADE_LABELS` 重复**） |
| 机会等级阈值 | `constants.js:opportunityLevel`（A≥80…）**与** `ScoreBar.vue:opportunityLevel`（内联同一组阈值）**两份** |
| 风险等级中文 | `constants.RISK_FLAG_LABELS` + `state.js:riskFlagName` + `Review.vue` 直接用 `RISK_FLAG_LABELS` + `RiskEvents.vue:riskFlagLabel` —— 4 处 |
| 市场环境中文 | `constants.marketRegimeLabel` + `Dashboard.vue` 直接调用 + `Dashboard.vue:pnlClass`（另一套涨跌色） |
| `permission` 文案 | `EtfDetail.vue:permissionLabel`（PERMIT/ALLOW→允许）+ `EtfDetail.vue:eligibilityOverallLabel`（allow→通过）+ `state.js:prettyExplain`（PASS/BLOCKED/ALLOW/FORBID）—— **三套并存的同义映射，且文案不一致**（「允许」vs「通过」） |
| 涨跌方向文案 | `format.js:formatDirection`（`↑ 升`）**与** `Fundamentals.vue:dirLabel`（同一份 map 抄了一遍） |
| ML 状态文案 | `constants.ML_SIGNAL_STATUS_LABELS` + `EtfDetail.vue:shadowStatusLabel` + `shadowSignalVal` + `shadowProbabilityVal` 三个包装函数 |

### 4.3 fallback / legacy 兼容代码

- `constants.js:ACTION_LABELS` 显式维护**小写别名**（`wait/build/add/hold/exit/tactical_reduce/strategic_reduce`），注释写「防接口/历史脏数据」。
- `constants.js:OVER_ALLOC_LABELS` 同时维护**英文 key 与中文 key**（`normal/mild/…` + `正常/轻度/…`），注释「库里 normal 是英文，其余级已是中文」。
- `state.js:prettyExplain` 用 **12 条正则**把历史快照里的 `W3 周线` / `RISK_OVERRIDE` / `PASS` / `BUILD` 等改写成中文——即「后端历史上吐过英文，前端负责洗」。
- `Dashboard.vue:primaryAction/primaryTarget/primaryPosition` 三分支「优先 Gen-1，否则回退旧字段」——**Gen-1 分支在生产上永不命中**，实际是纯 legacy 路径。
- `EtfDetail.vue:ml_shadow.engine_version || 'v3.6.1'`、`EtfDetail.vue:mlShadow.stage || '—'` 等大量 `||` 兜底。

### 4.4 API 与 UI 强耦合

- `api/request.js` 直接暴露后端 path 拼装（`/api/etf/${code}/kline?period=`），页面自行决定 period 默认值 `'daily'`。
- `adminApi.tradeCreate/Update/Delete` 用 `_op: 'create'|'update'|'delete'` **在 body 里编码动作**，而非 HTTP 方法语义。
- `ParamConfig.vue:parseValue` 自行猜测后端值类型（`{}`/`[]`/数字/字符串），说明后端 `value` 是**无 schema 的任意 JSON**。
- `FundamentalEntry.vue` 的 `inputs[indicator] = { …, source: cfg.source === 'manual' ? 'manual' : 'manual' }` —— **三元两支同值**，明显是残留/笔误。

### 4.5 常量双通道注入（同一件事两条路）

| 通道 | 位置 | 行为 |
|---|---|---|
| A | `main.js:10` `api.constants().then(applyServerConstants)` | **原地合并进** `constants.js` 的模块级对象（含 `engine_version`） |
| B | `App.vue:8-9` `api.constants()` → `window.__CONSTANTS__ = res.data` | 写到全局，注释称「供渐进迁移」 |

⇒ 启动时**同一接口被请求两次**；两条通道写的目标不同；`ENGINE_VERSION` 是 `export let`（非响应式），B 通道**无人消费**。`[AS-IS]`

### 4.6 重复格式化逻辑

- `Dashboard.vue:fmtPct`（整数不带小数、非整数带 1 位）**与** `format.js:formatPercent`（固定位数）**语义不同**，同名不同行为。
- `EtfDetail.vue` 自带 `fmtProb / fmtPct2 / gen1Pct / gen1Delta` 四个格式化函数。
- `Fundamentals.vue` 自带 `formatTime / dirLabel / dirClass / gradeLabel / gradeClass`。
- ⇒ `utils/format.js` 名义上是统一层，实际**约 40% 的格式化工作散落在各视图内联**。

### 4.7 同一事实在不同页面出现不同文案

| 事实 | Dashboard | EtfDetail | Structure | Review |
|---|---|---|---|---|
| 「Gen-1 主建议」 | 「建议」+ `c.gen1` 兜底 | 整块主建议卡（可达） | 顶栏一行 | 时间轴列 |
| `permission` 通过 | — | 「允许」(`permissionLabel`) / 「通过」(`eligibilityOverallLabel`) | — | — |
| 风险等级 | `RISK_FLAG_LABELS[c.risk_flag]` + `RiskAlertBar` | `RISK_FLAG_LABELS[decision.risk_flag]` | — | — |
| 版本号 | 无 | `ml_shadow.engine_version` | 无 | — |

### 4.8 前台与后台权限边界问题

| # | 问题 | 证据 |
|---|---|---|
| 1 | **前台「历史」页需要后台登录** | `router` `review` 标 `requiresAuth:true`；`api.review` 带 `X-Admin-Token`。访客点导航「历史」→ 被弹到 `/login` |
| 2 | **前台「基本面」页调用后台写接口** | `Fundamentals.vue:208` `adminApi.intelRefresh()`。未登录点「刷新」→ 401 → 前端 `setToken(null)` + 跳 `#/login` |
| 3 | **前台未登录时会强制跳转登录页** | `request.js:41-44`：任何 `auth:true` 请求 401 即改 `window.location.hash`，**无提示、无回跳来源保留** |
| 4 | **后台「返回前台」与前台「后台管理」互相直链，无角色概念** | 单一管理员密码，无多用户/审计主体区分 |
| 5 | **token 无过期字段、无刷新、登出仅清本地** | `TOKEN_KEY='admin_token'`，仅 `setToken(null)` |

### 4.9 移动端体验问题

已有较好基础（`tableScrollHint`、触屏热区 ≥40px、`hover:hover` 隔离、`safe-area-inset`、底部 sheet 式 modal）。仍存问题：

| # | 问题 | 证据 |
|---|---|---|
| 1 | `Structure` 页 ECharts chunk **1MB**，移动网络首开「看盘」代价大 | 实测 `Structure-Xyt7RnT_.js = 1,045,588 B` |
| 2 | 顶部导航在手机上换行占 **96px**（`--topnav-height:96px`）且 5 项横滑 | `FrontLayout.vue:109` |
| 3 | 表格在手机上靠**横向滚动**兜底（`width:max-content`），无列级折叠/卡片化策略（仅 Fundamentals 做了表/卡双实现） | `main.css:255-277`；`Review.vue` 的 `.timeline` 用 5 列 grid（`minmax(180px,1.35fr)` 等）在 375px 下**必然溢出**，且**未挂 `.table-wrap`**（它是 div，不是 `<table>`，`tableScrollHint` 抓不到） |
| 4 | `Review.vue` 时间轴 `.timeline{max-height:520px;overflow:auto}` 是**桌面内滚动**，手机上双重滚动 | `Review.vue:229` |
| 5 | 后台 Gen2Shadow 三张表各 **10-11 列**，窄屏全靠横滑 | `Gen2Shadow.vue` |

### 4.10 信息密度 / 层级问题

- `EtfDetail.vue` 单页 **469 行**，模板内并列 6 个 card + 2 个 `<details>`，第一屏塞入 K 线以外几乎全部信息。
- `Fundamentals.vue` **565 行**，同时渲染「指标表 + 指标卡」两套 DOM（`.indicator-table` 与 `.indicator-cards`，靠 media query 二选一）——**DOM 体积翻倍**。
- `EtfDetail` 的「模型审计 / 基线对照」含 **24 个 `sg` 字段**（含 `feature_schema_hash` / `decision_hash` 类技术字段），虽在 `<details>` 内，但仍是一屏 24 格。
- 首页 Hero 是**蓝色渐变**（`linear-gradient(135deg, #1e40af…)`，`box-shadow` 24px）——与任务书 §九「不要为了现代感加入大量渐变/玻璃拟态」直接冲突；`FrontLayout` 亦用 `backdrop-filter: blur(14px)` 玻璃拟态。
- `ActionColors` 中 `ADD: '#dc2626'`（红）与 `HOLD: '#059669'`（绿）**与「涨红跌绿」行情色同值**，但语义无关 ⇒ 任务书 §九「行情涨跌与风险状态颜色不要混用」的隐患点。

### 4.11 死代码 / 死接口 / 死载荷（`[AS-IS]` 实测）

| 类别 | 项 | 证据 |
|---|---|---|
| 死组件 | `components/charts/SignalStrip.vue`（49 行） | `grep -rn SignalStrip web/src/` 无输出 |
| 死函数 | `Dashboard.vue:positionText()` | 定义于第 36 行，模板 0 引用（构建产物已 tree-shake 掉其字符串） |
| 死接口 | `api.decisions()` | 引用计数 **0** |
| 死接口 | `api.macro()` | 引用计数 **0**（但线上 `/api/macro` 返回 3,324 B 真实数据 → **有数据无 UI**） |
| 死载荷 | `/api/etf/:code` 的 `fundamental` / `fundamental_config` / `fundamental_series` / `holdings` / `holdings_date` | EtfDetail **未读取**；该响应 16,653 B 中约 30KB 级旁路数据被整体丢弃 |
| 死通道 | `App.vue` 写 `window.__CONSTANTS__` | 全仓无读取方 |
| 死字段 | `snapshot.version` / `decision.scores.total` / `decision.v38_*` / `decision.v361_*` / `decision.v3_final_*` / `decision._shadow_secondary_action` | 前端零引用（部分属历史版本残留） |
| 空壳路由 | `/portfolio` → redirect（与 `/dashboard` 同页）；`/intel` → redirect（与 `/fundamentals` 同页） | `router/index.js` |

### 4.12 版本语义残留（`[AS-IS]`）

| 位置 | 当前值 | 问题 |
|---|---|---|
| `utils/constants.js:108` | `export let ENGINE_VERSION = 'V3.6.1'` | **硬编码 V3.6.1**，而生产身份已是 V3.6.5（见 §5） |
| `web/index.html:6-7` | `description`/`title` 含 **「V4.0 Gen-1 Advisory —— V3.6.1 风险骨架」** | 同一文件里出现 **V4.0 与 V3.6.1 两个互斥版本号** |
| `web/package.json` | `"version": "2.0.0"`，description 写「V2.0 前端」 | 第三个版本号 |
| `FrontLayout.vue:32` | 品牌副标题「ETF 决策 · Gen-1 趋势启动增强」 | 暗示 Gen-1 已是主口径（实际前台拿不到 Gen-1 数据） |
| `Dashboard.vue:127` | 「0.65 阈值仍在独立验证」 | 硬编码业务叙事文案 |
| `EtfDetail.vue:310,313,339` | 「V3.6.1 基线与人工建议闸门」「V3.6.1 风险/组合约束仍生效」 | 硬编码 V3.6.1 |
| `Review.vue:51` | `'来源：V3.6.1 / Safety Core'` | 同上 |

> ⇒ 全仓库前端至少存在 **V2.0 / V3.6.1 / V4.0** 三个版本口径，且**没有一处**表达 V3.6.5。

### 4.13 Gen-1 / Gen-2 概念混杂（`[AS-IS]`）

| # | 现象 |
|---|---|
| 1 | 「Gen-1」在 UI 里同时指**两件不同的东西**：(a) 前台主建议口径（`detail.gen1.advisory`，不存在）；(b) 影子模型 HVT-A（`ml_shadow`，存在于 `decision.gen1_*` 与顶层 `ml_shadow`）。两者**共用同一个词**。 |
| 2 | `EtfDetail.vue` 的「模型审计 / 基线对照」把 `ml_shadow` 同时标注为「观察」与「主建议」（`mlShadow.effective ? '主建议' : '观察'`），而线上 `ml_shadow.effective=false` ⇒ 显示「观察」。但**同一页第一屏又宣称「Gen-1 给结论」**（代码注释第 215 行）⇒ 自相矛盾。 |
| 3 | `constants.ML_SIGNAL_STATUS_LABELS.CANDIDATE = '快速通道候选'` 而 `BLOCKED = 'ML 机会 · 被规则拦截'` —— 文案把「ML」与「快速通道」混用。 |
| 4 | `Dashboard.vue:124` 用「Gen-1 趋势启动增强」命名 `data.ml_shadow`；`Gen1Health.vue` 又称其为「Gen-1 运行健康」；`Gen2Shadow.vue` 称「Gen-2 Selection Shadow」。**Gen-1 的两种叫法 + Gen-2 的独立体系，无统一定义页**。 |
| 5 | **前台无任何 Gen-2 展示**，后台 `Gen2Shadow` 明确「只读观察 · 不影响正式仓位」——**正确**，但缺一条显式的「Gen-2 ≠ 交易引擎」声明（任务书 §八 要求）。 |

---

## §5 口径冲突登记（⛔ 只登记，不选边、不修正）

> 依既有治理纪律：口径冲突**登记 + 给选项 + 由 owner 裁定**，不自行选边。
> 下列各项**均未**在本轮修改任何文档或线上数据。

### 5.1 冲突 A：生产身份 `V3.6.5`（台账）vs `v3.6.1`（线上字段）

| 源 | 值 | 时间 |
|---|---|---|
| 台账 `V365_PRODUCTION_READINESS_LEDGER.md` C-021.2（续）§9/§11/§12 | `CONTROLLED_DEPLOYMENT = COMPLETE` · `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5` · `DEPLOYMENT_IDENTITY_VERIFIED = true` · `ONLINE_SOURCE_PARITY = EXACT_MATCH` · `UNEXPECTED_PACKAGE_DIFF = 0` | 2026-09-30 13:38 |
| 线上 `constants.runtime_status` | `production_engine: "v3.6.1"` · `decision_engine: "v3.6.1"` · `stage_engine: "v3.6"` · `config_version: "2026-09-01-gen1-advisory-active"` | `updated_at: 2026-09-30T00:00:58.305Z` |

**`[INFER]` 可能解释**：`runtime_status.updated_at`（00:00:58）**早于**部署完成时间（13:38），该记录由**日常调度管线**在部署前写入，尚未刷新。
**⛔ 不据此结论**。本项属**线上字段**，其修正载体是**线上写操作**，**不属任何 docs 批次**，须单独立项、单独放行。**当前标记为 UNKNOWN，等待 owner 裁定。**

### 5.2 冲突 B：台账顶部「A. 当前状态快照」已过期

| 位置 | 内容 |
|---|---|
| 台账第 50 行自述 | 「⚠️ **本快照为唯一真值来源**（2026-09-29 C-015 收口轮）」 |
| 台账第 109 行（在 A 快照内） | `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = **V3.6.4**`（`aa634e2…`） |
| 台账第 114 行（在 A 快照内） | `DEPLOYMENT_IDENTITY_VERIFIED（G-25） = **false**`，理由「线上 = V3.6.4，**并非**本轮 V3.6.5 candidate」 |
| 台账 C-021.2（续）§9（**更晚**，第 1845 行） | `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = **V3.6.5**` · `DEPLOYMENT_IDENTITY_VERIFIED = true` |

⇒ 台账**内部自相矛盾**：A 快照（自述为「唯一真值来源」）与 C-021.2 结论互斥。

**登记**：本轮**不修改台账**（append-only 治理件，且未获授权）。**建议 owner 裁定是否补一条勘误指向**。

### 5.3 冲突 C：任务书 §七 与「当前实际可达状态」

任务书 §七 要求的 8 项状态，**逐项与台账 C-021.2/C-021.5 比对**：

| §七 要求 | 台账权威值 | 一致？ |
|---|---|---|
| Production Identity = V3.6.5 | `CURRENT_PRODUCTION_DEPLOYMENT_IDENTITY = V3.6.5` | ✅ |
| Deployment = COMPLETE | `CONTROLLED_DEPLOYMENT = COMPLETE` | ✅ |
| Online Source Parity = EXACT_MATCH | `ONLINE_SOURCE_PARITY = EXACT_MATCH` | ✅ |
| Unexpected Package Diff = 0 | `UNEXPECTED_PACKAGE_DIFF = 0` | ✅ |
| First Controlled Run = 尚未执行 | `production_run_executed = false` · `FIRST_CONTROLLED_RUN_WINDOW = AUTHORIZED` | ✅ |
| Prospective Epoch = NOT_STARTED | `PROSPECTIVE_EPOCH = NOT_STARTED` | ✅ |
| Run History = PENDING | `RUN_HISTORY_INDEX = PENDING`（数据侧） | ✅ |
| General Production = false | `READY_FOR_GENERAL_PRODUCTION = false` | ✅ |

⇒ **§七 的 8 项口径全部有台账支撑，无冲突**（此前对 A 快照的怀疑已由 C-021.2 澄清）。
**补充**（任务书 §七 未列但同轴、必须在 UI 中体现）：
`PRODUCTION_ACTIVATION_AUTHORIZATION = NOT_GRANTED` · `READY_FOR_V365_FIRST_CONTROLLED_RUN = PENDING_OWNER_RUN_APPROVAL` · `OWNER_RUN_AUTHORIZATION = false` · `V365_ENFORCE_SWITCH_DATE = null` · `deployment_authorization_consumed = true`。

### 5.4 冲突 D：前端版本口径（3 个互斥值）

见 §4.12：`V2.0`(package.json) / `V3.6.1`(constants.js, 多处文案) / `V4.0`(index.html) —— **无一处为 V3.6.5**。
⇒ 需 owner 裁定重写后的**唯一版本口径**（建议：`ENGINE_VERSION` 由 `/api/constants` 下发，**前端不硬编码**；但下发的当前值是 `v3.6.1`，与 §七 的 V3.6.5 又冲突 ⇒ **连带 5.1**）。

### 5.5 冲突 E：改写分支的**基点**与 V3.6.5 分支分叉

| 分支 | HEAD | 基点 | 含 V3.6.5？ | 含前端 rewrite 骨架？ |
|---|---|---|---|---|
| `origin/master` | `e93f396` | — | ❌ | ❌ |
| `feat/v365-production-integrity-impl` | `d669298` | `c6bd006`（在 master 之上） | ✅（15 commit） | ❌ |
| `refactor/v365-frontend-rewrite` | `db007df` | **`e93f396` = master** | ❌ | ✅（6 commit） |

⇒ 两支**各自独立、互不包含**：V3.6.5 的 15 个 commit **不在** rewrite 分支上；rewrite 的 6 个 commit **也不在** V3.6.5 分支上。

**为什么这构成冲突**：任务书 §二 要求「不改生产决策语义」，而**唯一一次 V3.6.5 生产部署（09-30 13:38）的代码在 `feat/v365-production-integrity-impl` 上**。
⇒ 若 rewrite 分支最终要上生产，它**需要**包含 V3.6.5 的代码；但当前它是从 master 切的。

**登记（⛔ 不代 owner 决定）**，可选路径：
| 选项 | 做法 | 代价 |
|---|---|---|
| **A** | 保持独立，最终以 **merge 策略**把 V3.6.5 分支并入 rewrite 分支（或反之） | 需一次 merge，需 owner 授权 |
| **B** | 把 rewrite 分支 **rebase 到** `feat/v365-production-integrity-impl` | 重写历史，且推过远端 ⇒ 需 force-push（**高风险**） |
| **C** | 保持两分支长期独立，前端产物**单独部署**、后端代码**另走 V3.6.5 链**（前端静态托管与云函数本就分离部署） | 最省事，但需确认线上前端**不需要**依赖 V3.6.5 后端新字段 |

> ★ `[INFER]` 选项 **C 在技术上是自洽的**：前端是**静态托管**、云函数是**独立部署**（台账 C-021.2 §7 只部署了 `runDecisionEngine`）。
> 但 **D-1 的部署依赖**（`apiGateway` 契约）与之耦合 ⇒ **两项须一并裁定**。
> ⛔ 本轮**不选边、不 merge、不 rebase、不 push**。

---

## §6 审计结论摘要

1. `[AS-IS]` **任务书指定的规格文件**：在 master / 当前工作分支上**不存在**；但在远端分支 **`refactor/v365-frontend-rewrite` 上存在**（`aee352c`，owner 本人于开工前 6 分钟提交），**且其正文是一个 155 字节的工具报错占位串**（**无规格内容**）。⇒ 实际规格内容源 = **任务书正文**。详见 §0.1（三态）。
1b. `[AS-IS]` **owner 的前端重写已开工**：`refactor/v365-frontend-rewrite` 已含 `web/src/rewrite/{api.js, domain.js, components/{MetricTile,SectionHeader,StatusPill}.vue}` 骨架（6 commit）。**新前端落点是 `web/src/rewrite/`**，与旧 `web/src/**` 并存。详见 §0.1b。
2. `[AS-IS]` **线上前端 = 仓库 `web/` 构建产物，零版本漂移**；21 chunk + 路由表 + 文案全部对得上。
3. `[AS-IS]` **线上前端与线上 API 存在 10 处契约断裂**，其中最严重的是：**前台「Gen-1 主口径」在生产上完全失效**（4 个页面、10 处展示位全部降级）。
   ⇒ ★ 根因**不是**「后端没有 Gen-1」，而是**三层叠加**（§3.7）：
   **(a) 前端自 2026-09-08 起未跟进 PR-UI-01 契约**，按自我设想的 `gen1.advisory.*` 读取，对真实契约命中率 **0/8**；
   **(b) 承载契约的 `apiGateway` 从未部署**（线上仍为 2026-09-01 版，契约标记 grep=0）；
   **(c) 09-30 的唯一一次部署只含 `runDecisionEngine`**。
   ⇒ **修法 = 前端改读契约形状（本任务范围内）+ 一次 `apiGateway` 部署（⛔ 超出本任务授权，须 owner 单独放行）**。
4. `[AS-IS]` **技术债 13 类**，根因高度集中：**无 adapter/domain 层 ⇒ 每个页面自行猜测后端字段**。
5. `[AS-IS]` 存在**死代码 2 项 / 死接口 2 项 / 死载荷 1 组 / 空壳路由 2 个 / 死字段 6 类**，重写时应清理而非迁移。
6. `[AS-IS]` **鉴权边界在服务器侧有效**（未登录拿不到任何后台数据）；但**前台有 2 个页面跨界依赖后台 token**（「历史」整页、「基本面」的刷新按钮），是 IA 层面的边界错误。
7. `[登记]` **5 项口径冲突**（5.1 生产身份 / 5.2 台账内部矛盾 / 5.3 §七 无冲突已澄清 / 5.4 前端版本号 / **5.5 rewrite 分支基点分叉**），**均未修正**，等 owner 裁定。
8. `[UNKNOWN]` 以下项**未取得证据**，标 `NOT VERIFIED`：
   - `/api/review` 的真实响应结构（需登录，本次未登录）
   - 后台 9 个页面的**运行时表现**（未登录，仅验了鉴权边界）
   - 管理员密码可用性（**有意未验证**）
   - 线上 JS 与仓库源码的**字节级**一致性（仅做了语义级特征串核验，未本地重建比对 sha256）
   - `SignalStrip.vue` 是否为「预留待接线」而非废弃（无 commit message 佐证）

---

## 附：本轮证据文件（本地，未入库）

| 路径 | 内容 |
|---|---|
| `_v365-fe-audit-20260930/live/*.json` | 10 个线上只读接口原始响应 |
| `_v365-fe-audit-20260930/idx.html` | 线上 `index.html` 原文 |
| `_v365-fe-audit-20260930/asset_assets_index-D4p_s9et.js` | 线上 entry chunk |
| `_v365-fe-audit-20260930/asset_assets_index-DM1STc5W.css` | 线上 CSS |
| `_v365-fe-audit-20260930/livechunks/*.js` | 线上 21 个懒加载 chunk |
| `_v365-fe-audit-20260930/chunklist.txt` | chunk 名单 |

> 上述目录位于**工作区根**（非真仓库），**未入库、未提交**。

---

## 附录 C · 冻结后附记（append-only，2026-09-30）

> 冻结规则：不改写既有结论，只追加。以下为本轮执行阶段新增的**事实与裁定落地**。

### C-1 owner 对 §5 冲突的裁定（2026-09-30）
| 冲突 | owner 裁定 |
|---|---|
| §5.4 前端版本号（V2.0 / V3.6.1 / V4.0） | 版本号**只从 `/api/constants` 读**，前端零硬编码 |
| §5.5 分支基点分叉 | **新建本地 integration 分支**：base = `d669298` + cherry-pick 现有 rewrite 前端 commit；⛔ 不改远端 `refactor/v365-frontend-rewrite` |
| §5.1 生产身份 vs 线上字段 | **前端同时展示两源**，⛔ 不选边（落为 SPEC §7.4） |
| §5.2 台账 A 快照过期 | 已登记，⛔ 本轮不改台账 |

### C-2 规格文件处置（对应 §0.1）
owner 裁定：**立即重建完整规格，不等待人工补写**。
⇒ 已重建 `docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md`（20,848 字符 / 524 行，`SPEC-v1`）。
占位报错串已被真实正文替换。**注意**：重建发生在**新的 integration 分支**上，
远端 `refactor/v365-frontend-rewrite` 上的 155B 占位件**保持原样未被修改**。

### C-3 分支集成结果（对应 §5.5）
```text
新分支   refactor/v365-frontend-integration
base     d669298（V3.6.5 工作基线）
cherry-pick  696189d 02aea7e f2c52ce eda1a51 db007df（5 个前端 rewrite commit，各 1 文件）
  → 2c97b4f / 2a237a4 / 1ebb5e2 / bf64ae3 / 8272449  ／ 无冲突
⛔ 未 cherry-pick aee352c（155B 占位件；规格由本轮重建）
⛔ 未 push / 未 merge / 未 rebase / 未动远端分支
```

### C-4 新增事实：`apiGateway` 契约未部署 = 唯一阻塞项（对应 §3.7）
owner 裁定：**暂不用部署解决**，属独立 backend deployment gate。
⇒ 前端仅实现「契约缺位时显式 `UNAVAILABLE`」的可自愈形态（SPEC §6.3 / §7.3）。

### C-5 新增事实：多入口构建带来的**部署期注意点**（本轮新发现）
为让新前端可独立构建/预览，`web/vite.config.js` 已改为**多入口**（`index.html` + `rewrite.html`）。
⇒ `web/dist/` 现同时含两个入口页面。`scripts/deploy-hosting-web.js` 只断言
`dist/index.html` 与 `dist/assets/Dashboard-*.js` 存在（**两者本轮仍成立**，故其前置条件未破），
但它**上传整个 `dist/`** ⇒ 若现在部署，新前端会以 `/rewrite.html` 形式**一并上线**。
`[登记]` 本项**不是**本轮阻断（NO DEPLOY 生效中），但 **M9 之前必须处置**：
建议在部署前把 rewrite 入口改为**按环境变量开关**（如 `VITE_ENABLE_REWRITE_ENTRY=1`），
或在部署脚本中显式排除 `rewrite.html` 及其 chunk。已同步登记至 SPEC §18。

---

## 附录 C（续）：M3 阶段新发现（append-only）

### C-6 ★ 严重：`app.js` 用运行时字符串模板 ⇒ 生产构建**静默白屏**（M1 遗留，M3 发现并已修复）

`web/src/rewrite/app.js`（M1 骨架）用
`createApp({ template: '<router-view />' })` 装配根组件。
Vite 生产构建使用 **runtime-only** 的 Vue（不含模板编译器）⇒

| 环境 | 表现 |
|---|---|
| `vite dev` | 控制台一条告警（`Component provided template option but runtime compilation is not supported`） |
| `vite build` 产物 | **静默渲染为空** —— `#rewrite-app` 只剩一个空注释节点，页面全白 |

⚠️ **该缺陷同时躲过 `vite build`（PASS）与全部单元测试**：`build` 不执行渲染，
单测只断言适配器/守卫，都不挂载真实 DOM。**只有真实浏览器渲染才暴露**（M3 视觉核验第一轮即为白屏）。

**取证**：`grep -o 'template:"<router-view />"' dist/assets/rewrite-*.js` → 命中（修复前）；
修复后同命令 **0 命中**。
**修复**：改为 `createApp({ render: () => h(RouterView) })`。
**防回归**：新增 `web/tests/rewrite/app-shell.test.js`（5 项）——静态守卫「⛔ 全 rewrite 源码不得出现
`template: '...'` 字符串选项」，并断言根组件必须提供 `render`。

### C-7 ★ `overall_risk` 线上下发**中文**，旧 `toneForRisk()` 只认英文枚举 ⇒ 风险色域丢失

线上 `/api/dashboard` 的 `overview.overall_risk` 实测值为 **`"正常"`**（中文），
而 `domain/labels.js` 的 `toneForRisk()` 原先只识别 `NORMAL/YELLOW/RED`（英文枚举）
⇒ `"正常"` 落到 `muted`，**「风险正常」会显示为灰色而非风控绿色**，语义丢失且与「未知」不可区分。

**修复**：`labels.js` 增补 `normalizeRisk()`（中文→枚举的**唯一**归一处，`riskLabel()` 与 `toneForRisk()` 共用）。
**登记**：`over_alloc_status`（中文「中度」，M2 已处理）与 `overall_risk`（中文「正常」，M3 发现）
属**同类问题**，说明该 API 的枚举字段**中英混合**是系统性特征。
⇒ 后续所有枚举字段的归一**必须先实测线上值再实现**，⛔ 不得按字段名假设语言。

### C-8 `most_worth` 线上恒为 `null` ⇒ 首页「值得关注」显示『字段缺失』

`three_questions.most_worth` 线上实测 `null`（`NULL_IN_CONTRACT`）。按 SPEC §9「缺失必须显式」，
首页该格显示『字段缺失』+ 悬停原因。**诚实但增噪**。
`[登记]` 是否改为隐藏该格、或由 `most_defend` 邻域推导 → **待 owner 裁定（SPEC 附录 C-6）**；
⛔ 本轮不擅自推导（推导即产生新的业务口径）。

### C-9 生命周期「部署版本身份」在前台的口径收紧

M3 首轮实现曾在 Dashboard 标题写『V3.6.5 生产状态』—— 该**版本号不由本页任何 API 支撑**
（API 给的 `production_engine = 'v3.6.1'`），属 SPEC §五 明令禁止的「凭台账写死」。
**已修正**为『生产生命周期状态』+ 明示『本页不声明部署版本身份（不写具体版本号）』，
并把该口径写成渲染测试断言（⛔ Dashboard HTML 不得出现 `V3.6.5`）。
**遗留**：后台 `routes.js` / `ProductionState.vue`（M1 骨架）标题仍含版本号 →
已登记 SPEC 附录 C-5（D-8），**M10 前待裁**。

---

## 附录 C（续 2）：M4-P0 侦察新发现（append-only）

> 完整侦察见 `docs/V365_M4_ETF_WORKBENCH_CONTRACT.md`。此处只登记**新缺陷/新事实**。

### C-10 ★★ 严重：`/api/etf/:code/kline` 返回的不是最新 320 根，而是**最旧 320 根**

**实测**（2026-09-30 线上只读 GET）：
| 标的 | 条数 | 日期范围 | 决策日 |
|---|---|---|---|
| 513310 | 320 | `2023-05-09 → 2024-08-27` | 2026-09-29 |
| 518880 | 320 | `2023-05-08 → 2024-08-26` | 2026-09-29 |

⇒ **K 线末端比决策日晚约两年**；同一页面若同时展示 `snapshot.calc_date=2026-09-29` 与 K 线（2024-08），
用户会看到自相矛盾的时间线。

**根因（源码可证 `[SRC]`）**：`cloudfunctions/apiGateway/index.js#getKline`
```js
const rows = await db.query(COLLECTIONS.ETF_DAILY, { code },
  { orderBy: [{ field: 'trade_date', direction: 'asc' }], limit: 320 });
```
**升序 + limit** ⇒ 命中前 320 行 = **最旧** 320 行（weekly 分支同样为 `asc` + limit 260）。
返回条数恰好等于 limit（320），说明集合中行数 ≥ 320。

`[UNKNOWN]`：集合内是否存在 > 2024-08 的数据 —— 需 DB 只读权限，本轮未取。
⇒ **两种可能**（未选边）：① 单纯取数方向 bug，库里有新数据被截掉；② 数据同步本身就停在 2024-08（**阶段-1 数据正确性**问题）。
**⛔ 本轮不改 backend**；前端侧唯一正确做法是**把 K 线自身时点显著标出**（M4-D2 待裁）。

### C-11 ★ `/api/etf/:code` 的 `decision` 块有 **146 个键 / 7,571 B**，其中约一半与前端无关

其中 Gen-1 legacy 内嵌 **56 键**（`gen1_*` / `ml_rule_*` / `eod_precheck_*` / `v361_baseline_*` / `gen1_guarded_*`），
是**契约未部署期间线上唯一的 Gen-1 来源**。
⇒ 前端要么显式声明「legacy 通道」，要么显示「数据未提供」（M4-D1 待裁）。

### C-12 ★ `explain_chain`（"为什么"）文案与同文档字段**互相矛盾**

同一份 `decision` 文档内（513310，2026-09-29）：

| 链中文字 | 同文档字段 |
|---|---|
| step 10「仓位缺口 **-7.8pct**」 | `position_gap = **0**` |
| step 9「核心 **12.6%** · 交易 **0%**」 | `decision.core_position=**0.2**` / `trade_position=**0.3**`（12.6 等于 `position.core_position`） |
| step 8「目标区间 **[18~24]%** 标准目标 **21%**」 | `position.target_min/max=**20/30**`（std 25） |

⇒ 该链由**另一条计算路径**产生，与决策字段不同源。前端展示「为什么」时不得把两组数字并列而不解释（M4-D3 待裁）。

### C-13 ★ 块级同名字段不同义再增 2 例：`core_position` / `trade_position`

| 字段 | `decision`（**建议**） | `position`（**实际当前**） |
|---|---|---|
| `core_position` | `0.2` | `12.6` |
| `trade_position` | `0.3` | `8.4` |

（`position.suggested_core/suggested_trade` = `0.2/0.3` 与 `decision` 同值 ⇒ 说明前者是建议、后者是实仓。）
连同 `target_std`（决策带 0.5 / 配置带 25）与 `trend_stage`（dashboard `S0` / detail `S7`），
**"同名字段跨块/跨端点不同义" 至少 7 例** —— adapter 必须按「端点 + 块」建字段，⛔ 不得建全局 heuristic。

### C-14 `amount` / `premium_rate` 在 K 线上 320/320 全为 `null`（死字段）

⇒ 前端不消费；建议后端后续清理（⛔ 非本轮）。

### C-15 旧 EtfDetail「模型审计 / 基线对照」折叠区在生产上约 **16/24 行恒为 `—`**

旧页面读取的 `ml_shadow` 字段中，线上**不存在**的有 16 个：
`effective_stage` · `baseline_stage` · `category` · `domain_status` · `domain_status_label` ·
`domain_status_message` · `category_coverage` · `model_capability` · `market_regime` ·
`advisory_effective` · `advisory_target_pct` · `baseline_target_pct` · `source_trade_date` ·
`feature_schema_hash` · `rule_permission_reason` · `rule_permission_source`。
（审计 §3.6 #9 的同一模式：**前端契约假设与后端实际不符**。）

---

### C-16 ★★ 前端缺陷（已修）：adapter 透传裸 `Field`，而组件只认 display 对象 ⇒ **Gen-1 整区值全空**

| 项 | 内容 |
|---|---|
| **ID** | `FE-DEF-001`（风险台账） |
| **现象** | M4-P1 完成后，浏览器实看发现 Gen-1 区**只剩标签与角标，所有值渲染为空** |
| **根因** | 新写的 `adapters/gen1Detail.js` 输出**裸 `Field`**（`{state,value,provenance}`），而 `components/domain/FieldValue.vue` 只渲染 display 对象（`{text,missing,reasonText}`）⇒ `{{ d.text }}` 取到 `undefined` |
| **检出方式** | ★ **真实浏览器渲染核验**（SSR 断言当时只检查了标题与 caveat ⇒ **漏检**） |
| **修复** | `gen1Detail` 输出改为 display 形态（新增 `toDisplay()` 深度转换，并用 `isDisplay()` 短路避免二次包装） |
| **防复发** | 新增 SSR 守卫：断言 Gen-1 区**必须出现具体值**（`CANARY` / `DEGRADED` / `0.65` / `BLOCK` / `S1` / 运行 ID），并断言 ⛔ 不得出现 `[object Object]` |

**教训**：`[SRC]` 适配器的**输出形态契约**（裸 `Field` vs display 对象）必须在模块头部显式声明；
断言"字段存在"**抓不到形态错配**，必须在**渲染层**断言"值真的出现"。

### C-17 ★★ 前端缺陷（已修）：`normalizeRisk` 对**大写英文枚举**落空 ⇒ 风险色域丢失

| 项 | 内容 |
|---|---|
| **ID** | `FE-DEF-002`（风险台账） |
| **现象** | `risk_flag="NORMAL"` 的 tone 掉成 `muted`（与「未知」**视觉不可区分**）；`premium_flag` 直接显示英文原文 |
| **根因** | `RISK_ALIASES` 的键是**小写英文 + 中文**，而实现只比较 `s` 与 `s.toUpperCase()` ⇒ 对 `'NORMAL'` **两个分支都落空**、返回 `null` |
| **为何 M3 未暴露** | M3 Dashboard 的 `overall_risk` 线上是**中文**「正常」⇒ 命中中文键，掩盖了该 bug |
| **检出方式** | 既有测试套件（M4 新增断言） |
| **修复** | 改为 `RISK_ALIASES[s] \|\| RISK_ALIASES[s.toLowerCase()]`；并建了中/英 × 大/小写全矩阵回归断言 |
| **范围** | 属 **M3 遗留 bug**，修复同时改善了 Dashboard 的风险显示 |

**教训**：`[AS-IS]` 该 API 的枚举字段**中英混用是系统性特征**（`risk_flag` 英 / `premium_flag` 中 /
`over_alloc_status` 中 / `defense` 中 / `sector` 英）⇒ 归一的**归一化键设计**必须同时覆盖
「大小写」与「语言」，⛔ 不得只测一条样本路径。

### C-18 ★ 前端缺陷（已修）：重写 `adaptEtfDetail` 时**丢失 M2 的键**（回归）

| 项 | 内容 |
|---|---|
| **ID** | `FE-DEF-003` / `FE-DEF-004`（风险台账） |
| **现象** | ① `vm.position.band.std`、`vm.decision.explainChain` 变成 `undefined` ⇒ 既有测试抛 `TypeError`；② `fundamentalsSummary` 不可用分支缺 `fScoreText` ⇒ SSR 渲染抛 `TypeError` |
| **根因** | ① 用「**新建平行结构**」替代「在 M2 结构上**追加**」；② 缺失分支未返回**同形状骨架** |
| **检出方式** | ★ **既有回归套件**（`adapters-pages` / `edge-malformed`）+ **SSR 渲染测试** |
| **修复** | ① 改为 `...d` / `...p` **平铺 M2 原字段**，M4 展示字段一律用**新名**（`scoresView` / `factorsView` / `configBand`）；② 补全骨架 |

**教训**：`[SRC]` 重写一个已有 adapter 时，**必须先跑既有套件确认基线通过**，
且**只能用「追加 + 新名」**，⛔ 不得复用旧名承载新语义。

---

### C-19 ★★ 前端缺陷（已修）：`adaptDecision` 不可用分支**骨架不全** ⇒ 下游整页崩

| 项 | 内容 |
|---|---|
| **ID** | `FE-DEF-005`（风险台账） |
| **现象** | `decision` 块缺失时，页面在防守雷达处抛 `TypeError: Cannot read properties of undefined (reading 'state')`，**整页白屏** |
| **根因** | `adaptDecision` 的「不可用分支」只返回 `{available, reason, action}` 三个键，而下游 `adaptDecisionView` / `adaptDefense` 会读 `riskFlag` / `targetBand` / `defense` 等 |
| **检出方式** | ★ 新增的 `etf-radar` 单测（`decision-missing` 场景） |
| **修复** | 该分支改为返回**与正常分支同形状的完整骨架**（全 `unavailable`），⛔ 不再靠下游逐个加防御 |
| **防复发** | `emptyDecisionView`（展示层）与 `adaptDecision`（原始层）**两层骨架齐全**；`decision-missing` 场景在单测 + 渲染测试 + 浏览器核验三处覆盖 |

**教训**：`[SRC]` **「不可用分支」必须与正常分支同形状**。下游看到的对象形状应恒稳定；
缺一个键就会在距离事发点很远的地方崩，且**只有真正跑到那条分支才暴露**。

### C-20 ★ `defense_state` 家族的实测形状与量纲（★ M4-P0 记录不完整，本轮补齐）

| 项 | 实测 / 源码证据 |
|---|---|
| **形状** | `defense_state = { level, reason, score, factor }`（**实测**：`{level:1, reason:'趋势破坏', score:37, factor:0.95}`） |
| **`level` 取值** | **数字 0~4**（`defenseLevelFromScore`：≥80→4 / ≥65→3 / ≥50→2 / ≥35→1 / ≥20→1 / else 0） |
| ★ **区间重叠** | `>=35 → 1` 与 `>=20 → 1` **同时返回 1** ⇒ 20~49 全为 level 1，**level 2 只能在 50~64** ⇒ 已登记 `DS-001`，⛔ 前端不补偿 |
| **`score` 量纲** | **0~100 分**（`computeDefenseScore` 加权求和 `DEFENSE_WEIGHTS{trendBreak:.35, downVolume:.25, stagnation:.15, fundamental:.15, eventRisk:.10}` + `Math.min(100, …)`） |
| **`factor` 量纲** | **乘性系数**（`DEFENSE_PENALTY_BANDS`：0-20→1.00 / 21-40→0.95 / 41-60→0.85 / 61-80→0.70 / 81-100→0.50）⇒ 实测 `0.95` ⇔ `score∈[21,40]`，与 37 **自洽** |
| ★ **`level=0` 时** | 后端**不返回** `score` / `factor` 键（且顶层 `defense_score` / `defense_penalty` 亦缺）⇒ 必须走 `MISSING`，⛔ 不得补 0 / 1.00 |
| ★ **顶层冗余** | `decision.defense_score` / `.defense_penalty` 与 `defense_state.score` / `.factor` **同源恒相等** ⇒ 前端只展示 state 内的值 + **交叉核对**（登记 `DS-002`） |

**勘误**：`fundamental.detail`（含 `layer_breakdown`）**就在 `fundamental` 块内**（409 B）——
M4-P0 §D 曾误记为「属 M6 范围」⇒ 第二阶段已纳入情报区展示；
⛔ `fundamental_config` / `fundamental_series` 仍**不消费**（那才是 M6 范围）。


