# V365 项目功能与前端重写规格（PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC）

> **性质**：本项目**前端重构的产品 / 工程主规格**（canonical spec）。不是 UI 说明，不是设计稿注释。
> **版本**：`SPEC-v1`（2026-09-30 **重建**）
> **重建原因**：本文件在 `refactor/v365-frontend-rewrite` 上曾以一个 **155 字节的工具报错占位串**提交（`aee352c`），**不含任何规格正文**。本版由 owner 裁定后**完整重建**。
> **权威性**：与 `docs/V365_FRONTEND_CURRENT_STATE_AUDIT.md`（现状事实）、`docs/V365_FRONTEND_REWRITE_BLUEPRINT.md`（设计蓝图）配合使用。**三者冲突时以本规格为准**（本规格 = 目标态 · 审计 = 现状态 · 蓝图 = 实现路径）。
> **标记约定**：`[SPEC]` 硬性要求 · `[AS-IS]` 已核验事实 · `[OPEN]` 待 owner 裁定 · `[OUT]` 本轮明确不做

---

## §0 事实源与优先级

### 0.1 事实源优先级（裁决顺序）

| 优先级 | 事实源 | 用途 |
|---|---|---|
| 1 | **V3.6.5 权威台账** `docs/V365_PRODUCTION_READINESS_LEDGER.md`（尤其中 C-021.2 / C-021.5）+ `deliverables/v365-production-history/**` | 生命周期口径、部署身份、门禁状态 |
| 2 | **当前工作基线** `d669298`（`feat/v365-production-integrity-impl`） | 代码真值 |
| 3 | **现有 `web/` 全量源码**（38 文件 / 5,005 行） | 功能与数据契约参考 |
| 4 | `cloudfunctions/apiGateway/index.js` + `src/common/utils/gen1-ui-view-model.js` | **canonical UI contract** |
| 5 | **线上实际 API / 前端产物**（envId `tradingview-etf-d0fa42yy57cbc11b`） | 现状验证 |
| 6 | 现有 `web/src/rewrite/` 骨架 | 起点（不推翻，见 §1.4） |

### 0.2 硬性约束（全规格适用）

```text
[SPEC] 不得把不存在的功能或字段写进本规格。
[SPEC] 不得修改生产决策语义、冻结件、CALC domain、immutable lock、trend-stage 语义。
[SPEC] 前端不得产生新的 decision authority。
[SPEC] 所有数据展示必须可追 source / asOf / authority / derived。
[SPEC] 缺失数据必须显式；区分「未提供」与「管道断了」。
[SPEC] 本轮 NO MERGE / NO DEPLOY / NO PRODUCTION RUN / 不改后端生产逻辑。
```

---

## §1 系统定位与当前 V3.6.5 生命周期

### 1.1 系统定位

ETF 智能仓位决策系统：每日输出六态建议（观察 / 建仓 / 加仓 / 持有 / 减仓 / 清仓），追踪 5 只 ETF（`513310` 中韩半导体 QDII · `515880` 通信 · `159582` 半导体设备 · `518880` 黄金 · `159570` 港股通创新药）。**人工决策参考，非自动交易工具**。前端是**唯一人机界面**，职责是**如实呈现**决策与证据，⛔ 不是产生决策。

### 1.2 ★★ 当前生命周期口径（**必须写死，不得混淆**）

以下为 owner 裁定口径，来源 = 台账 C-021.2（续）§9/§11/§12 与 C-021.5：

```text
Controlled Deployment                       = COMPLETE
Production Deployment Identity              = V3.6.5
Online Source Parity                        = EXACT_MATCH
Unexpected Package Diff                     = 0
Deployment Identity Verified                = true
Production Activation Authorization         = NOT_GRANTED
First Controlled Run                        = NOT_EXECUTED（Window = AUTHORIZED）
Prospective Epoch                          = NOT_STARTED
Run History Index                           = PENDING
production_run_executed                     = false
General Production                          = false
V365_ENFORCE_SWITCH_DATE                    = null
Owner Run Authorization                     = false
```

### 1.3 `[SPEC]` 生命周期表达的**禁止项**（必须由 UI 机械保证）

| ⛔ 禁止 | 正确表达 |
|---|---|
| 把「部署完成」写成「**正式生产运行**」 | 「已部署」与「已开始生产运行」是两个**不同轴**，必须分开显示 |
| 把「代码在线」写成「**生产周期已开始**」 | `Prospective Epoch = NOT_STARTED` 必须可见 |
| 没有 run evidence 时显示「**最近生产运行**」 | 显示「**首次受控运行：尚未执行**」，⛔ 不显示任何 run 时间线 |
| 没有 API 数据时**前端硬编码**生命周期状态 | 必须显示「**数据未提供 / 待后端契约**」（见 §7） |
| 用「V3.6.5 已完成生产资格」作总结 | `READY_FOR_GENERAL_PRODUCTION = false` 必须可见 |

> ★ **反例（必须被测试抓住）**：UI 上出现「V3.6.5 · 生产运行中」这类字样即**违规**。`[SPEC]` 该断言须进 contract test（§14）。

### 1.4 `[AS-IS]` 起点：owner 已有 rewrite 骨架（不推翻）

`web/src/rewrite/` 已存在（5 commit）：`api.js` · `domain.js` · `components/{MetricTile,SectionHeader,StatusPill}.vue`。
`[SPEC]` **在其基础上扩展**，⛔ 不推翻既有接口（尤其 `api{}` / `admin{}` 方法名与 `tone` 取值体系）。

---

## §2 分层架构：API → Adapter → Domain/ViewModel → UI

### 2.1 单向数据流（`[SPEC]` 强制）

```
CloudBase / HTTP
   │
   ▼  api/            请求 · 鉴权头 · envelope 解包 · 错误归一            ⛔ 不解释业务字段
   ▼  adapters/       后端字段 → Field<T> · legacy 兼容 · 缺失/过期判定   ⛔ 不做阈值判断
   ▼  domain/         枚举 · 标签 · 阈值 · 格式化 · Freshness · Provenance  ← 唯一判定处
   ▼  compose/        组合式数据 hook（唯一可 import adapters 的地方）
   ▼  views/ + components/   仅呈现 · 交互 · layout · visualization
```

### 2.2 `[SPEC]` 分层 import 规则（CI 可校验）

| 层 | 允许 import | ⛔ 禁止 |
|---|---|---|
| `api/` | 仅自身 | adapters / domain / views / components |
| `adapters/` | `api/` `domain/` `utils/` | views / components |
| `domain/` | 仅自身 | api / adapters / views |
| `compose/` | `api/` `adapters/` `domain/` | views |
| `views/` `components/` | `domain/` `components/` `compose/`（props 注入） | **`api/` `adapters/`** |

### 2.3 `[SPEC]` 目录（`web/src/rewrite/` 之下）

```
web/src/rewrite/
├── api/            client.js · envelope.js · endpoints.js · session.js
├── adapters/       readField.js · dashboard.js · etf.js · kline.js · fundamentals.js
│                   intel.js · review.js · constants.js · systemRuntime.js
│                   productionLifecycle.js · admin/*.js
├── domain/         enums.js · labels.js · thresholds.js · format.js
│                   freshness.js · provenance.js · lifecycle.js · models.js
├── compose/        use{Dashboard,EtfDetail,Structure,Intel,Review,Admin*}.js
├── components/     primitives/ · data/ · domain/ · charts/
├── views/          front/ · admin/
├── layouts/        FrontLayout.vue · AdminLayout.vue
├── styles/         tokens.css · base.css · utilities.css
└── app.js · router.js
```

> `[SPEC]` 完成迁移后，旧路径 `web/src/**` 由 owner 单独决定清理（⛔ 本轮不动）。

---

## §3 职责边界：V3.6.5 / Gen-1 / Gen-2

### 3.1 三层语义与 authority

| 域 | 语义 | authority | 前端允许做什么 | ⛔ 禁止 |
|---|---|---|---|---|
| **V3.6.5 Safety Core** | 生产决策引擎 | **唯一生产权威** | 如实展示 `final_action` / `final_target` / `trend_stage` / `risk_flag` | 重算、覆盖、推断 |
| **Gen-1** | 趋势启动增强（当前 authority = `CANARY` / 灰度反事实） | 受 Safety Core 约束 | 展示契约 `gen1.*` + `production.*` 分层 | 把 `counterfactual` 当正式建议 |
| **Gen-2** | **Selection / Shadow / Research** | **无仓位 authority** | 后台只读观察 | 前台展示为「正式目标 / 交易建议 / 最终仓位」 |

### 3.2 `[SPEC]` production / shadow / research 的视觉与数据边界

| 维度 | production | shadow | research |
|---|---|---|---|
| 数据来源 | `production` 块 + `system_runtime.production` | `gen1.counterfactual` / `gen1.signal` | 后台 Gen-2 端点 |
| 视觉 | 实底、正常字重 | **虚线边框 + 「观察」角标** | 独立后台区，**不进前台** |
| 可否出现在前台首屏 | ✅ | ⛔ 默认折叠且带标注 | ⛔ 不出现 |
| 可与 production 并列同权重 | ✅ | ⛔ 不得 | ⛔ |
| 命名 | 「建议 / 目标」 | 「反事实 / 观察」 | 「观察 / Research」 |

> `[SPEC]` Gen-2 在后台必须显式标注 **`Selection / Shadow / Research`**，并附一行「⛔ Gen-2 不是当前正式交易引擎，不拥有仓位 authority」。

### 3.3 `[SPEC]` `legacy` 块消费规则

`legacy.fields`（含 `ml_shadow` / `ml_shadow.ui_phase` / `ml_shadow.production_permission` / `ml_shadow.fast_path_enabled` / `advisory_enabled` / `fast_path_enabled`）：**只允许展示与排错，⛔ 不得用于权限 / 阶段 / 写权限判定**，并须在 UI 上标注「legacy · 不可用于权威判断」。

---

## §4 前台信息架构

### 4.1 页面总表（`[SPEC]`，前台 **4 页** + 1 条归并兼容路由，⛔ 无空壳页）

> ★ **M5-P1-OBS-1（2026-10-01）**：前台导航由 **5 项收敛为 4 项** ——
> `全局 · 标的 · 情报 · 复盘`（⛔ 已移除「看盘」导航项；⛔ 「情报 / 标的」顺序**未调整**）。
> `/structure` 与 `/structure/:code` 作为**兼容 redirect 保留**（删除导航 ≠ 删除兼容入口）。

| 路由 | 名称 | 业务职责（一句话） | 主要数据来源 |
|---|---|---|---|
| `/dashboard` | **全局** | 用最短路径回答：市场环境 / 需关注的 ETF / 系统建议 / 仓位与目标 / 为什么 / 什么证据 / 最近变化 | `GET /api/dashboard` · `GET /api/constants` |
| `/etf/:code` | **标的** | 单只 ETF 全链路：动作 → 仓位 → 解释 → 环境 → WDHVF → K线 → 加仓/防守雷达 → Gen-1 timing → 基本面 → 情报 → 最近变化 | `/api/etf/:code` · `/api/etf/:code/kline` · `/api/etf/:code/decisions` · `/api/constants` · `/api/dashboard`（仅组合环境，只读引用）<br>⛔ **不使用 `/api/etf/list`**（禁止 2「跨 endpoint 偷补」） |
| `/structure/:code` | **看盘（已归并）** | ★ **M5-P1 / owner D-M5-1（合并 + redirect）**：看盘**不再单独建设第二套 Workbench**；`/structure` 与 `/structure/:code` 均为**兼容 redirect** → `/etf/:code`（带参数透传）。⛔ 不得复制建设 | （无独立数据源；使用 `/etf/:code` 的全部来源） |
| `/intel` | **基本面/情报** | 当前结论 / 硬数据 / 景气财报 / 事件 / AI 证据 / 来源与时间 / 数据完整性 | `/api/fundamentals` · `/api/intel?limit=` |
| `/review` | **历史复盘** | 决策事件 → 系统建议 → 实际操作 → 偏差 → 响应时间 → 历史趋势（**需鉴权**，见 §8） | `GET /api/review`（带 token） |

### 4.2 各页区块（`[SPEC]`）

- **全局**：结论带（市场环境 · 风险 · 数据截至）→ **生命周期条** → Gen-1 主建议（契约缺则显式态）→ 5 张标的卡（动作 / 仓位→目标 / 风险 / 阶段码）→ 组合状态（金额默认遮罩 + 显隐）→ 重要风险条 → 数据新鲜度 → 系统运行状态（折叠）。⛔ 首屏不得堆原始指标。
- **标的**（前台最重要页）：基础信息 → 当前动作 → 当前/目标仓位 → 决策解释 → 市场环境 → `W/D/H/V/F` → K线/量价 → 加仓雷达 → 防守雷达 → Gen-1 timing → 基本面摘要 → 相关情报 → 历史决策变化。
  层级：**L1 常显**（动作/仓位/为什么前 3 步/风险）· **L2 紧凑**（WDHVF + K线）· **L3 折叠**（Safety Core 技术详情 / Gen-1 审计 / 决策链全量）· **L4 按需**（原始字段 k-v）。
- **看盘**：★ **M5-P1 / D-M5-1 已归并** —— 看盘不再单独成页；`/structure/:code` 为兼容 redirect → `/etf/:code`。原规划的「结构总览 → K线/量价 → 加仓结构雷达 → 防守结构雷达」**并入「标的」页**（见上条与附录 F.1）。
- **基本面/情报**：当前结论 → 硬数据 → 景气/财报 → 事件 → AI 研究证据 → 来源和时间 → 数据完整性。保留 5 分钟轮询 + 可见性暂停。**手动刷新不在此页**（见 §5、§8）。
- **历史复盘**：统计 8 项 → 事件流（决策-执行配对，可展开）→ 偏差 → 历史趋势。表格降级为可选视图。

---

## §5 后台信息架构（`[SPEC]`，5 组）

| 组 | 页 | 路由 | 职责 |
|---|---|---|---|
| **系统运行** | Gen-1 Health | `/admin/gen1` | 模型健康 6 项 + 最新 EOD 信号表 |
| | Gen-2 Shadow | `/admin/gen2` | 运行概览 + CORE/CHALLENGER/全池排名 + **Selection/Shadow/Research 边界声明** |
| | **Production State** | `/admin/production` | §1.2 的生命周期矩阵（数据来源见 §7） |
| **数据管理** | 数据源状态 + 抓取任务 + 抓取日志 + **情报刷新** | `/admin/data` | 10 数据源状态 + 4 手动触发 + 日志；**情报刷新迁移至此** |
| | 基本面录入 | `/admin/fundamental` | 量化录入 / 定性只读 / **权重编辑** / **定性否决** |
| **策略配置** | 参数配置 | `/admin/param` | 现值/前值/版本/**冻结态** + 编辑 + 影响面确认 |
| | 风险事件 | `/admin/risk` | 触发（类型/等级/处置/理由必填）+ 列表 + **解除（理由必填）** |
| **执行** | 操作记录 + 账户快照 | `/admin/trade` | 操作 CRUD + 筛选 + 自动算仓结果提示 + 快照录入 |
| **账户与安全** | 登录 / 修改密码 / 登出 | `/login` `/admin/password` | 改密后强制重登 |

---

## §6 Gen-1 canonical UI contract（`[SPEC]`）

### 6.1 canonical source

**唯一权威**：`src/common/utils/gen1-ui-view-model.js`（PR-UI-01），由 `apiGateway` 下发。前端以 `production` / `gen1` / `system_runtime` / `legacy` 四块为 canonical。

### 6.2 canonical 结构（`[SPEC]`，**以契约实跑结果为准**）

> ★★ **本节已按真实契约输出更正（2026-09-30）**。
> 初版是按源码片段**推断**的，与实跑结果不符 —— 例如曾误记 `gen1.signal.calibrated_probability`
> 与 `gen1.authority_label`，**实跑证明二者都不存在**（真实为 `signal.threshold`；
> `authority_label` 只在 `system_runtime.gen1`）。
> **结论：契约形状必须由实跑产出，不得由源码片段推断。**
> 实跑证据：`web/tests/fixtures/canonical/*.json`（由 `_v365-fe-audit-20260930/tools/gen-m2-fixtures.cjs`
> 直接调用 `src/common/utils/gen1-ui-view-model.js` 生成）。

```
data.production = {
  engine, engine_source,               // 该决策自身的引擎版本（⛔ 不是当前生产引擎）
  action_code, action_label,
  current_pct, final_target_pct, suggested_pct,   // 仓位百分比
  risk_flag, binding_constraint
}

data.gen1 = {
  authority,                            // CANARY / ADVISORY / PRODUCTION / OFF
  status,                               // ★ 字符串枚举 NO_OPPORTUNITY|OBSERVED|CANDIDATE|BLOCKED|DEGRADED
  stages:        { signal, baseline, effective },   // ★ 三拆，⛔ 不得串位
  signal:        { stage, probability, threshold, model_candidate, signal_status },
  data:          { health_status, source_trade_date, benchmark_latest_date },
  applicability: { domain_status, domain_permission, label, message },
  safety:        { permission, reason_code, reason, source,
                   eod_stage, baseline_stage, binding_stage, binding_stage_source },
  counterfactual:{ target_pct, suggested_pct, delta_pct,
                   stage_changed, clamped, baseline_floor_breached }
  // ⚠️ 无 authority_label；无 calibrated_probability；无 health_status/domain_status（在 signal / data 内）
}

data.system_runtime = {
  runtime_status_available,             // 三态判定的前提
  production: { engine, engine_source, status },
  gen1: { authority, authority_label, health_status, health_gate_status, health_source,
          safety_source,
          counterfactual_authorized, counterfactual_health_allowed, counterfactual_active,
          counterfactual_inactive_reason, counterfactual_invocations, ledger_ok,
          production_write, production_fast_path_enabled, auto_execution,   // ★ 三态 true/false/null
          safety_invariant_ok },
  gen2: { mode, source, production_write, production_write_source }          // ★ gen2.production_write 可为 null
}

data.legacy = { deprecated, do_not_use_for_authority, note, fields[] }
```

**复盘行**（`/api/review` 的 `decisions[]`）附：

```
decisions[i].production = { engine, engine_source, action, action_label, target, suggested, current_position }
decisions[i].gen1       = { authority, status, signal_status, probability, stages,
                            baseline_suggested_pct, counterfactual{…},
                            counterfactual_suggested_pct, delta_pct, domain_status, safety_permission }
                          // ⛔ 不得携带 final* / action_code（UI-G1-13）
```

### 6.3 `[SPEC]` canonical 优先 + legacy fallback 规则

1. **canonical 优先**：凡 canonical 存在，⛔ 不得读 legacy。
2. **fallback 必须显式命名**：adapter 中每个 fallback 写成 `fallbackFromLegacy.<field>`，并在 UI 上标注「legacy fallback」。
3. **fallback 不得掩盖契约错误**：若 canonical **存在但字段缺失**，报 `MISSING`；⛔ 不得静默改用 legacy 顶替。
4. **无数据 ⇒ 「未提供」**：canonical 整块不存在 ⇒ `UNAVAILABLE` + `missingReason='CONTRACT_NOT_PROVIDED'`。
5. ⛔ **不得静默伪造字段**，不得由前端合成 `advisory` 之类的形状。

### 6.4 `[AS-IS]` 当前线上状况与处置

- 线上 `apiGateway` 仍是 2026-09-01 版，**未下发** canonical 四块 ⇒ canonical 全部走 `UNAVAILABLE`。
- `[SPEC]` **不通过部署解决**——属独立的 **backend deployment gate**；⛔ 本轮不部署。
- `[SPEC]` 旧 `gen1.advisory.*` **不再作为新前端 canonical contract**（旧前端按此形状读，对真实契约命中率 **0/8**）。Adapter 可为旧形状保留**显式命名的兼容读取**，但仅用于「历史前端行为对照」，⛔ 不进入新 UI。

---

## §7 生命周期 Domain Model 与 UI 状态机（D-2）

### 7.1 `[SPEC]` 6 个维度**必须分开建模**，⛔ 不得合成一个「状态」

| 维度 | 语义 | 数据来源 | 无数据时 UI |
|---|---|---|---|
| `deployment_state` | 受控部署是否完成 | 台账（无 API） | 「数据未提供 · 待后端契约」 |
| `activation_authorization` | 生产激活授权 | 台账（无 API） | 同上 |
| `first_controlled_run` | 首次受控运行是否发生 | 台账 + `production_run_executed` | 同上（⛔ 不得显示 run 时间线） |
| `prospective_epoch` | 前瞻周期是否开始 | 台账（无 API） | 同上 |
| `run_history_index` | run 历史索引 | 台账（无 API） | 同上 |
| `general_production` | 是否一般生产资格 | 台账（无 API） | 同上 |

### 7.2 `[SPEC]` 有 API 支撑的部分（`/api/constants` → `runtime_status`）

```
production_engine · config_version · updated_at
ml_effective · ml_advisory_enabled · ml_execution_enabled
gen1_authority · gen1_authority_label · gen1_production_write · gen1_auto_execution
gen1_broker_wired · gen1_production_fast_path_enabled
gen1_health_status · gen1_health_gate_status · gen1_health_source · gen1_safety_source
gen1_guarded_* · gen1_counterfactual_*
```
> ⚠️ 这些是**边界字段组**：相关但语义独立，必须**整体展示**并写明反例（例：`ml_advisory_enabled=true` 时 `ml_execution_enabled` 仍可为 `false`）。

### 7.3 `[SPEC]` UI 状态机

```
LifecycleField<T> ∈
  { state:'PROVIDED', value }                               ← 有真实数据
  { state:'ABSENT',   reason:'NO_BACKEND_CONTRACT' }        ← 无接口（本轮 6 维度多数如此）
  { state:'ABSENT',   reason:'FIELD_MISSING' }              ← 有对象但字段缺
  { state:'UNKNOWN',  reason:'RUNTIME_STATUS_UNAVAILABLE' } ← 读不到 runtime_status
```
`[SPEC]` `state='ABSENT'` 时必须渲染**明确文案**，⛔ 不得渲染 `—`、⛔ 不得渲染默认值、⛔ 不得渲染猜测量。

### 7.4 `[SPEC]` 口径冲突的处理

`runtime_status.production_engine = "v3.6.1"` 与台账 `Production Deployment Identity = V3.6.5` **冲突**，`[AS-IS]` 已登记（审计 §5.1）。`[SPEC]` 前端**必须同时展示两个来源与各自 asOf**，⛔ 不得自行选边、⛔ 不得把二者合并成一个「引擎版本」。

---

## §8 权限边界（`[SPEC]`）

| 数据 | 可见范围 | 载体 |
|---|---|---|
| 账户快照 / 持仓 / `trade_log` / 实际操作 / 偏差 | **仅鉴权后** | `/api/review`（带 `X-Admin-Token`）、`/api/admin/*` |
| 组合比例（`cash_ratio` 等） | 前台可见 | `/api/dashboard` |
| 金额（`total_asset` / `total_pnl`） | 前台可见但**默认遮罩** + 显隐切换 | 前端本地状态 |
| 情报刷新（写操作） | **仅后台** | `/api/admin/intel/refresh` |

`[SPEC]`：
1. **`/review` 保持鉴权**；涉及 account snapshot / holdings / trade_log / actual execution / deviation 的数据**不得**变成公开页面。
2. **前台不得调用后台写接口**（旧 `Fundamentals.vue` 调 `intelRefresh` 属越界，已修正）。
3. **401 语义集中在 app 层**，⛔ 不在 HTTP 客户端里直接改 `location.hash`。
4. 未登录访问受限页 ⇒ 显示**登录引导**，⛔ 不静默跳转。

---

## §9 空数据 / 旧数据 / 契约未同步时的 UI 行为（`[SPEC]` 统一状态机）

| 情形 | 判定 | UI 行为 |
|---|---|---|
| 请求失败（网络/5xx） | `ERROR` | 明确错误文案 + 重试；⛔ 不复用上一次数据冒充本次 |
| 响应成功但字段不存在 | `MISSING` | 灰化 + 「字段缺失」 |
| 契约整块未下发 | `UNAVAILABLE` | 「数据未提供 · 待后端契约」 |
| 数据超过 SLA | `STALE` | 黄标 + 「数据已过期 N 天」 |
| 值为 0 / 空字符串（合法值） | `PROVIDED` | 正常显示 `0`；⛔ **不得**当成缺失 |
| 历史快照含旧文案 | `PROVIDED`（legacy） | 经 `domain/labels.js` 统一洗数后展示 |

`[SPEC]` **`STALE` / `MISSING` / `UNAVAILABLE` 三者文案必须不同**，且都不得是 `—`。

---

## §10 数值与日期格式化契约（D-7）

### 10.1 `[SPEC]` 禁止启发式

```text
⛔ 禁止： 「值小于 1 所以自动乘 100」
⛔ 禁止： 任何基于数值大小推断单位的逻辑
```
`[AS-IS]` 旧 `pct()` / `fmtProb()` 属此类，会把线上真实的 `final_target = 0.5`（语义 0.5%）渲染为 `50%`。

### 10.2 `[SPEC]` 必须按字段语义选择 formatter

| 语义 | formatter | 输入约定 | 示例 |
|---|---|---|---|
| 权重 / 仓位百分比 | `formatPercent(v)` | **已是百分数**（`final_target` / `*_pct` / `current_position`） | `0.5` → `0.5%` |
| 比例 | `formatRatio(v)` | `0~1` | `0.72` → `0.72` |
| 概率 | `formatProbability(v)` | 契约内 `0~1` | `0.72` → `72.0%` |
| 金额 | `formatAmount(v)` | 元 | `99172.1` → `9.92 万` |
| 价格 | `formatPrice(v)` | 元 | `1.234` → `1.234` |
| 数量 | `formatCount(v)` | 份 | `1200` → `1,200` |
| 日期 | `formatDate(v)` | `YYYY-MM-DD` | 原样前 10 位 |
| 日期时间 | `formatDateTime(v)` | ISO / 时间戳 | `2026-09-30 13:38` |

> `[SPEC]` `final_target=0.5` 显示 `0.5%` —— **由字段语义（仓位百分比）决定，⛔ 不由数值大小决定**。
> 概率类字段是**唯一**允许出现「0~1 → %」换算的场景，因其契约语义明确为比例。

---

## §11 旧 → 新迁移映射（保留 / 删除 / 新增）

### 11.1 迁移总表

以蓝图 §11 为准（前台 41 项 + 后台 29 项 + 覆盖度核对）。本节只列**裁决要点**。

### 11.2 `[SPEC]` 保留项（功能不得丢）

数据刷新 · 数据源状态 · 手动抓取 · 基本面录入 · 基本面权重 · 定性否决 · 风险事件新增/解除 · 参数修改 · 参数冻结状态 · Gen-1 Health · Gen-2 Shadow · 操作记录 · 账户快照 · 历史复盘 · 登录/改密/登出 · 移动端能力 · 5 分钟轮询 · 表格移动端可读形态。

### 11.3 `[SPEC]` 新增项

| 新增 | 理由 |
|---|---|
| `/admin/production`（Production State） | §1.2 生命周期无处安放 |
| 生命周期条（前台） | 让「已部署 ≠ 已生产运行」在首屏可见 |
| `MissingState` / `FreshnessDot` / `ProvenanceLine` | §9 状态机与可追溯要求 |
| `/etf/:code` 页的「历史决策变化」 | 启用既有 `decisions` 端点（旧前端为死接口） |
| 标的页基本面摘要 | 启用既有 `fundamental` 载荷（旧前端为死载荷） |
| Gen-2 边界声明 | §3.2 |

### 11.4 `[SPEC]` 删除项（**逐项理由；均属"生产上无可见行为"或"零引用"**）

| 删除 | 理由 |
|---|---|
| 隐杠杆黄条（`overview.leverage_alert` / `total_book_pct` / `cash_ratio_raw`） | 字段线上不存在 ⇒ 恒不渲染 |
| `components/charts/SignalStrip.vue` | 全仓零 import（死组件） |
| `Dashboard.positionText()` | 死函数（模板零引用） |
| `App.vue` 的 `window.__CONSTANTS__` 通道 | 零读取方 + 与 `main.js` 重复请求同一接口 |
| `tableScrollHint.js` 全局表格横滑提示 | 由 `DataTable` 移动形态替代；其整树 `MutationObserver` 是性能负债 |
| **`api.macro()` client method** | `[SPEC]` 本轮按 **dead code** 处理：**删除**，⛔ 不为「以后可能用」保留；需要宏观模块时**再建正式 contract** |
| 空壳路由 `/portfolio`（→`/dashboard`） | 无业务内容 |
| 空壳路由 `/intel`（→`/fundamentals`）旧语义 | **升级为正式情报页路由**；`/fundamentals` 反向 redirect 到 `/intel` |
| 旧 `gen1.advisory.*` 的 canonical 地位 | §6.4 |
| `pct()` 数值启发式 | §10.1 |

### 11.5 `[SPEC]` 路由兼容

旧 URL **保留 redirect**，但⛔ **不继续维护没有业务内容的空页面**。

```text
/               → /dashboard        （redirect）
/portfolio      → /dashboard        （redirect，兼容旧书签）
/fundamentals   → /intel            （redirect，兼容旧书签）
/etf            → /etf/513310       （redirect）
/structure      → /structure/513310 （redirect）
```

---

## §12 UI Design System（`[SPEC]`）

### 12.1 三套语义色域**物理隔离**

| 域 | 用途 | token 前缀 | 规则 |
|---|---|---|---|
| 行情涨跌 | 涨红跌绿（中国习惯） | `--mkt-*` | 仅用于价格 / 涨跌幅 |
| 风险状态 | NORMAL / YELLOW / RED | `--risk-*` | 仅用于风控语义 |
| 动作语义 | 动作胶囊 | `--tone-*`（`neutral/good/risk/accent/muted`） | **对齐 owner 既有 `toneForAction()`** |

`[SPEC]` 三域色值**不得相同**；动作胶囊**必须带文字标签**（⛔ 不得仅靠颜色区分动作）；行情涨跌与风险状态**不得混用**。

### 12.2 排版

中文基准 **14px**（`Noto Sans SC`）· 数字/英文 `Inter` · 技术字段 `mono 11px`；所有数字启用等宽数位（`tabular-nums`）；关键数字 28/36px + bold。

### 12.3 反装饰清单（`[SPEC]`）

| ⛔ 禁止 | 替代 |
|---|---|
| 大面积渐变 Hero | 纯色 surface + 左侧 4px 语义色条 |
| `backdrop-filter` 玻璃拟态 | 纯色 surface + 1px 下边框 |
| 卡片悬停位移动画 | 仅 `box-shadow` 变化 |
| 入场 / 计数动画 | 仅数据更新的数值过渡（≤180ms） |

### 12.4 间距 / 半径 / 阴影 / 层级

间距 `4/8/12/16/20/24/32` · 半径 `4/6/8`（收敛旧 6/10/14）· 阴影 3 档 · `z-index` 语义化（sticky 20 / nav 30 / drawer 50 / modal 60 / toast 70）。

---

## §13 响应式策略（`[SPEC]`）

- **移动优先**：默认样式即手机，`@media (min-width: …)` 向上增强。
- 断点：`768`（手机）· `900`（平板竖）· `1100`（小笔电）· `1440` · `1800`。
- **触屏热区 ≥ 44×44px**；`:hover` 装饰一律包在 `@media (hover:hover)`；`prefers-reduced-motion` 下关闭全部过渡。
- `[SPEC]` **每个表格都必须有 ≤768px 的非横滑替代形态**（卡片或分组列表）。⛔ 不得把「横向滚动 + 右侧渐隐」当作最终方案。
- `[SPEC]` 375×667 下每页主任务必须可完成，**无横向溢出**。

---

## §14 可测试性与 contract test 要求（`[SPEC]`）

### 14.1 测试层次

| 层 | 内容 | 方式 |
|---|---|---|
| domain 单测 | 枚举 / 标签 / 阈值 / formatter / freshness / lifecycle 状态机 | 纯函数 · `node:test` + `node:assert`（**零新增依赖**） |
| adapter 单测 | 对**线上真实响应夹具**逐字段断言 | 夹具存 `web/tests/fixtures/`（来源 `_v365-fe-audit-20260930/live/`） |
| route 契约 | 路由表完整性 + 无空壳页 + `meta` 齐备 | 静态断言 |
| design token 契约 | 必需 token 存在 + **禁止项零命中**（无 `linear-gradient` / `backdrop-filter`） | 静态断言 |
| **分层守卫** | `views/**` 不 import `api/**` `adapters/**` | 静态断言 |
| **生命周期口径守卫** | ⛔ 不得出现「生产运行中」类违规文案；⛔ 生命周期字段不得硬编码 | 静态断言 |
| responsive smoke | 断点下无横向溢出 | 后续（可选 Playwright） |
| build | `vite build` PASS | CI |

### 14.2 `[SPEC]` 必须镜像后端契约测试

`tests/gen1-ui-contract.test.js`（UI-G1-01..16）是**后端契约守卫**；前端 adapter **必须与其断言一致**：

- `authority` 只认 `runtime_status.gen1_authority`（⛔ 不得由 `ml_*` 反推）
- 安全三字段（`production_write` / `production_fast_path_enabled` / `auto_execution`）**三态**（true / false / **null**），⛔ 不得压扁
- `stages` 三拆（signal / baseline / effective）**不得串位**
- `gen1` 块 ⛔ 不得携带 `final` / `action_code` / legacy 语义键
- `counterfactual` ⛔ 不得覆盖 `production`

> `[SPEC]` 前端 adapter 单测须覆盖以上 5 条不变式。

---

## §15 扩展点（本轮**不实现**）

| 扩展点 | 预留形式 | 本轮 |
|---|---|---|
| **Gen-2.1** | `domain/enums.js` 的 `Gen2Role` + `system_runtime.gen2.source` 消费位；后台 Gen-2 页区块化 | ⛔ 不实现 |
| **jEV** | `views/` 下预留独立路由位与 `domain/` 评估域枚举 | ⛔ 不建页面、不建 API |
| 宏观模块 | §11.4：**删除** `api.macro()`；将来以**正式 contract** 重建 | ⛔ 不实现 |
| 生命周期 API | §7：`productionLifecycle` adapter 的 `ABSENT` 分支即接入点 | ⛔ 不实现 |

---

## §16 交付顺序与门禁（`[SPEC]`）

```text
A. 重建正式规格（本文件）
B. 输出并冻结 frontend audit
C. 输出 frontend blueprint
D. 完成 branch integration（base=d669298 + cherry-pick 前端 commit）
E. M0 Design System
F. M1 App Shell + Router
G. build / unit / contract checks
H. 再进入 M2+（Adapter/Domain contract migration → Dashboard → Workbench → 看盘 → 情报 → 复盘
       → Admin → Compatibility/regression → Production-like validation）
```
每个大阶段必须报告：**改了什么 / 没改什么 / 测试结果 / 已知缺口 / 是否出现需要 owner 裁定的新决策**。

---

## §17 `[OUT]` 本轮明确不做

```text
[OUT] merge / deploy / push 到生产分支 / rebase 生产分支
[OUT] 部署 apiGateway（属独立 backend deployment gate）
[OUT] 重新部署 runDecisionEngine
[OUT] 执行任何 production run / 写任何线上数据
[OUT] 修改 V3 Safety Core decision logic / V3.6.5 CALC domain
[OUT] 修改 immutable lock / frozen parameter semantics
[OUT] 修改 Gen-1 frozen implementation / trend-stage semantics
[OUT] 修改 production data meaning / trade authority semantics / Gen-2 research semantics
[OUT] 修改旧 web/src/**（除 §2.3 新增的 rewrite/ 目录外）
[OUT] 实现 jEV / Gen-2.1
```

---

## §18 `[SPEC]` 部署前必须处理（M9 之前）

> ★ 进度（2026-10-01）：**§18-1 已处置**（owner 裁定 **A2**，实现已入库，见 §18.1）；**§18-2 / §18-3 / §18-4 仍未处理**。
> ⛔ 本节任何条目都**不构成部署授权**：生产部署与激活仍需独立授权。

| # | 事项 | 原因 | 处置 |
|---|---|---|---|
| 1 | **新前端入口会随 dist 上线** | `web/vite.config.js` 为多入口（`index.html` + `legacy.html` + `rewrite.html`），而 `scripts/deploy-hosting-web.js` 上传整个 `dist/` ⇒ 新前端会以 `/rewrite.html` 可达 | ✅ **已处置（A2，2026-10-01）**：**根入口**由 `VITE_ENABLE_REWRITE_ENTRY` 决定承载哪一套 UI；`/legacy.html` 固定为 Legacy 入口；`/rewrite.html` 保持独立 + `noindex`。实现见 **§18.1** |
| 2 | **`apiGateway` 契约未部署** | 线上仍为 2026-09-01 版，未下发 `production` / `gen1` / `system_runtime` / `legacy` | 单独授权部署（属独立 backend deployment gate）——在此之前 Gen-1 主口径只能显示 `UNAVAILABLE` |
| 3 | **旧路径清理** | 迁移完成后 `web/src/**`（旧前端）与新前端并存 | 由 owner 单独决定收敛与清理时机，⛔ 不在本轮 |
| 4 | **`api.js` 的 401 location 副作用** | SPEC §8.3 要求 401 语义集中在 app 层 | M2 迁移（现已在守卫中登记为待办） |

### §18.1（2026-10-01）入口收敛裁定与实现（A2）

| 项 | 内容 |
|---|---|
| **裁定** | owner 选 **A2**。开关**只有** `VITE_ENABLE_REWRITE_ENTRY`（仅精确 `"1"` 视为开启，未设置 / 其它值一律为关闭）。 |
| **入口语义** | **未设置 / `=0`**（默认）⇒ `/` = **Legacy**（与收敛前一致）· `/legacy.html` = Legacy · `/rewrite.html` = Rewrite（`noindex`）<br>**`=1`** ⇒ `/` = **V3.6.5 Rewrite UI** · `/legacy.html` = Legacy · `/rewrite.html` = Rewrite |
| **源文件** | `web/index.html`（根入口源；默认即 Legacy 引导）· `web/legacy.html`（**新增**，与 `index.html` **逐字节一致**）· `web/rewrite.html`（不变） |
| **实现** | `web/vite-config/rewrite-root-entry.js` —— Vite 官方 `transformIndexHtml`，**`order:'pre'`**。依据本仓 Vite 5.4.21 源码取证：`buildHtmlPlugin` 先 `applyHtmlTransforms(html, preHooks, …)`，**之后**才扫 `scriptUrls` 发现入口 ⇒ `pre` 钩子注入/替换出的 `<script type="module" src="/src/rewrite/app.js">` 会被正常登记为入口。**fail-closed**：开关开启且根入口锚点缺失 ⇒ 抛错，拒绝产出错误产物。⛔ 无第三方插件 · ⛔ 不对 `dist` 做事后改写 · ⛔ 不改 `web/src/**`。 |
| **构建** | 默认（根 = Legacy）：`npm --prefix web run build`；生产候选（根 = Rewrite）：bash 下 `VITE_ENABLE_REWRITE_ENTRY=1 npm --prefix web run build`（Windows cmd 需先 `set VITE_ENABLE_REWRITE_ENTRY=1`）。★ **`scripts/deploy.sh` 无需改动** —— 环境变量由 shell 透传给其中的 `vite build`。 |
| **★ 部署/激活 SOP（2026-10-01）** | `scripts/deploy.sh` **内部会重新执行 `vite build`** ⇒ **激活 Rewrite 必须显式带上开关**：<br>`VITE_ENABLE_REWRITE_ENTRY=1 bash scripts/deploy.sh --frontend-only`（Windows cmd：先 `set VITE_ENABLE_REWRITE_ENTRY=1` 再执行）。<br>⚠️ **静默陷阱**：未设置该变量 ⇒ 重新 build 产出 `index.html` = **Legacy** ⇒ **即使 CloudBase deploy 成功，生产根页面仍然是 Legacy**，且**不报任何错**。回退同理：不带该变量重新构建+部署即回到 Legacy。<br>⛔ 本条**只是部署 SOP 约束**，**不改变 `scripts/deploy.sh` 的行为**。 |
| **回退** | `VITE_ENABLE_REWRITE_ENTRY=0` 重新构建 → 走**既有** `scripts/deploy.sh --frontend-only`（`tcb hosting deploy web/dist`）⇒ 根 `/` 回到 Legacy。⛔ 本轮**不建**秒级回退（⛔ 不写 CloudBase `RoutingRules`）。⚠️ **该回退路径尚未演练**。 |
| **守卫** | `web/tests/rewrite/entry-convergence.test.js`（Case A~G ＋ fail-closed ＋ `index.html ≡ legacy.html` 漂移守卫）；产物级校验器 `web/tests/tools/verify-entry-artifact.cjs`（真实构建后 / CI 使用）。 |
| **⛔ 边界** | 本轮**未部署 / 未激活**。生产切换、`production-deployment-ledger` 的 `D-007` 记录、回退演练，均待**独立授权**。 |

---

## 附录 A：★ 字段单位语义表（M2-P0 结论，2026-09-30）

> **性质**：**canonical 字段单位契约**。所有 formatter 选择**必须**依本表，⛔ 不得依数值大小推断。
> **证据源**（只读）：① `src/common/schema.js` 的 `desc` 字段；② producer 代码
> （`src/common/utils/decision-v3.js` / `trend-stage.js` / `v3-constants.js`）；
> ③ 线上真实响应 `_v365-fe-audit-20260930/live/*.json`；④ 历史 33 条决策分布。

### A.1 ★ `final_target` 单位裁定（M2-P0 核心结论）

```text
final_target 单位 = **仓位百分比（数值即百分数）**
证据 1（schema）：src/common/schema.js:288
   final_target: { type:'number', desc: '最终目标仓位%（经组合约束）' }
证据 2（producer）：decision-v3.js 中 final_target 直接取自 sizing/target 的百分数量级
证据 3（历史分布，513310 共 33 条）：
   final_target ∈ {0, 0.5, 1, 1.5, 4.5, 7.5, 21, 28.5}    min=0  max=28.5
   含 21 / 27 / 28.5 / 30（与 max_position=30、target_max=30 同量级）
证据 4（减法自洽）：position_gap 与 target_delta 均为百分点差值，量级与 final_target 一致
   · 2026-08-20 target_delta? position_gap=11.9 = 21 − 9.1 ✓
   · 2026-08-18 position_gap=23.04 = 28.5 − 5.46 ✓
   · 2026-08-14 position_gap=15.54 = 21 − 5.46 ✓
   · 2026-09-29 target_delta=−7.8 = 0.5 − 8.3 ✓
⇒ **`final_target = 0.5` 表示 0.5%**（不是 50%，也不是 0.5 个点）。
⇒ 旧前端 `pct()` 启发式（`|v| ≤ 1.5 → ×100`）会把它渲染成 **50%**，属**真实缺陷**；M0 已删除。
```

### A.2 字段语义表

| 字段 | 原始单位 | 业务含义 | UI formatter |
|---|---|---|---|
| `final_target` | **仓位百分比** | 最终目标仓位（经组合约束） | `formatPercent` |
| `target_position`（decision） | 仓位百分比 | 等价 `final_target`（**deprecated 别名**） | `formatPercent` |
| `target_min` / `target_std` / `target_max`（**decision**） | 仓位百分比 | **本次决策的最终目标带**（经阶段/市场/组合约束后） | `formatPercent` |
| `target_min` / `target_std` / `target_max`（**position**） | 仓位百分比 | **配置的标准目标带**（来自 `etf_basic`，≠ decision 同名项） | `formatPercent` |
| `current_position` / `suggested_position` / `core_position` / `trade_position` / `position_after` | 仓位百分比 | 各口径仓位 | `formatPercent` |
| `max_position` / `max_strategic_position` | 仓位百分比 | 仓位硬上限 | `formatPercent` |
| `position_gap` | 百分点差值（**≥0，服务端已算**） | 加仓缺口 | `formatPercentSigned`（⛔ 前端**不得重算**） |
| `target_delta` | 百分点差值（**可负**） | 目标变动 | `formatPercentSigned` |
| `weight` / `holding_weight` | 占净值百分比 | 权重 | `formatPercent` |
| `premium_rate` / `change_5d` / `bias_20d` / `sideway_range` / `ma20_slope` | 百分比 | 行情类 | `formatPercent` |
| `cash_ratio` / `cash_ratio_raw` / `tech_position` / `gold_position` / `innovation_position` / `semi_position` / `drug_position` | 百分比 | 组合类 | `formatPercent` |
| `target_position`（etf_basic） | 仓位百分比 | 标的标准目标 | `formatPercent` |
| `total_asset` / `cash_balance` / `holdings_mv` / `total_pnl` / `amount` | **元** | 金额 | `formatAmount` |
| `price` | 元 | 价格 | `formatPrice` |
| `shares` / `volume` | **份** | 数量 | `formatCount` |
| `probability` / `calibrated_probability` / `ml_probability` / `gen1_model_probability` | **比例 0~1** | 概率 | `formatProbability` |
| `confidence` | **比例 0~1**（schema `range:[0,1]`） | 置信度 | `formatProbability` |
| `price_position` | **比例 0~1** | 收盘价在 20 日区间的位置 | `formatRatio` 或 `formatRatioAsPercent`（调用方显式选择） |
| **`stage_factor` / `market_factor` / `factor_breakdown.{mf,sf,of,ff,dp,rf}`** | ★ **乘性系数 0~1** | 阶段/市场/机会/基本面等调节系数 | `formatRatio`（⛔ **绝不可当百分比**；`0.25` 是 0.25，不是 25%） |
| `gen1_model_threshold_p` | 比例（0.65） | 模型阈值 | `formatRatio` |
| `opportunity_score` / `consolidation_score` | **点数 0~100**（无单位） | 评分 | `formatScore`（⛔ 不加 `%`） |
| `scores.{trend,volume,fundamental,crowding,risk}` | **点数**（各维上限 25/25/25/15/10） | 五维评分 | `formatScore` |
| `opportunity_factor` | 系数 | 机会系数 | `formatRatio` |
| `cooldown_days` / `sideway_days` / `persistence_days` / `data_age_days` | 天 | 计数 | `formatCount` |
| `premium_flag` / `over_alloc_status` / `risk_flag` / `add_mode` | 枚举字符串 | 状态 | `domain/labels.js` |

`stage_factor` 取值域证据：`src/common/utils/v3-constants.js`
```js
const V3_STAGE_FACTORS = Object.freeze({ S0:0.00, S1:0.25, S2:0.40, S3:0.70, S4:0.85, S5:1.00 });
⇒ 系数，非百分比。
```

### A.3 ⛔ 禁止事项（与 §10.1 一致）

```text
⛔ 0.5 自动理解成 0.5%
⛔ 0.5 自动理解成 50%
⛔ <1 就乘 100
⛔ >1 就认为已经是百分比
⛔ 同名不同义字段（decision.target_std vs position.target_std）共用一个 formatter 判定
```

### A.4 登记：同名字段不同义（★ 易错点）

| 字段名 | 出现处 A | 出现处 B | 差异 |
|---|---|---|---|
| `target_min` / `target_std` / `target_max` | `decision.*`（本次最终目标带） | `position.*`（配置标准目标带） | 线上实测 A=0.4/0.5/0.5、B=20/25/30 —— **同名不同义** |
| `target_position` | `decision.*`（= `final_target`，deprecated） | `etf_basic` / `position.*`（标的标准目标） | 实测 0.5 vs 25 |

`[SPEC]` adapter **必须**按**来源路径**区分，⛔ 不得按字段名统一处理。

### A.5 `position_gap` 的精确语义（修正 schema 注释）

`schema.js:297` 注释写「仓位缺口 final_target − current」。实测**不成立**：
2026-09-29 `final_target=0.5` / `current=8.3` ⇒ 差 −7.8，但线上 `position_gap = 0`。
逐条验证后，实际语义 = **`max(0, final_target − suggested_position)`**（只报正向加仓缺口）：
```
2026-08-20: 21 − 9.1  = 11.9  ✓（= gap）
2026-08-18: 28.5−5.46 = 23.04 ✓
2026-08-14: 21 − 5.46 = 15.54 ✓
2026-09-29: 0.5− 8.3  = −7.8 → max(0,·) = 0 ✓
2026-08-28: 4.5− 8.8  = −4.3 → 0 ✓
```
⇒ `[SPEC]` 前端**只展示服务端下发的 `position_gap`**，⛔ **不得自行重算**（重算必错）。
`[登记]` 本项属**文档注释与实现不符**，非本次修改范围；已记录待 owner 决定是否更正 schema 注释。

---

## 附录 B：本规格引用的既有权威件

| 件 | 路径 |
|---|---|
| 现状审计 | `docs/V365_FRONTEND_CURRENT_STATE_AUDIT.md` |
| 设计蓝图 | `docs/V365_FRONTEND_REWRITE_BLUEPRINT.md` |
| 生产台账 | `docs/V365_PRODUCTION_READINESS_LEDGER.md`（C-021.2 / C-021.5） |
| 部署身份设计 | `docs/V365_DEPLOYMENT_IDENTITY_AND_CANDIDATE_FREEZE.md` |
| Gen-1 UI 契约 | `src/common/utils/gen1-ui-view-model.js` + `tests/gen1-ui-contract.test.js` |
| 线上证据 | `_v365-fe-audit-20260930/{live/*.json, livechunks/*.js, idx.html}` |

## 附录 C：`[OPEN]` 待 owner 裁定的剩余事项

| # | 事项 | 本规格的当前处置 |
|---|---|---|
| 1 | `runtime_status.production_engine='v3.6.1'` vs 台账 `V3.6.5` | ✅ M3 已按最保守方式落地：Dashboard **只展示 API 可读的引擎版本**（维度显示名＝「线上引擎版本」+ 显式 caveat「与台账 Production Deployment Identity 不是同一概念」），并写明『本页不声明部署版本身份』。台账身份是否要在前台重复声明 → 待裁 |
| 2 | 台账顶部 A 快照（`= V3.6.4` / `G-25=false`）与 C-021.2 互斥 | 已登记；⛔ 本规格不改台账 |
| 3 | 前端版本号口径（V2.0 / V3.6.1 / V4.0） | 本规格取「**版本号只从 `/api/constants` 读，前端零硬编码**」；该值本身待裁（连带 1） |
| 4 | `apiGateway` 部署授权 | 唯一阻塞 `GEN1_FRONTEND_EFFECTIVE_ON_PROD` 的项 |
| 5 | **D-8**：后台页标题写死「V3.6.5 生产状态」 | `routes.js` / `ProductionState.vue`（M1 骨架）标题含版本号。Dashboard 已按 §五 移除版本声明；后台是否保留该标题 → **M10 前待裁**（保留＝明示页面主题；移除＝与 Dashboard 同口径） |
| 6 | `most_worth` 线上恒 `null` | 首页「值得关注」会显示『字段缺失』。诚实但增噪；是否改由 `most_defend` 推导或隐藏该格 → 待裁（⛔ 本规格不擅自推导） |

---

## 附录 D：M3 Dashboard 实现记录（2026-09-30 · 参考实现）

> 本附录是 Dashboard 的**实现级记录**（IA / VM / 映射 / 差异 / 验证）。
> 它是 M4~M10 各页面的**结构样板**：其余页面按同一分层与同一「缺失显式化」口径落地。

### D.1 已实现的 IA（自上而下，视觉权重递减）

| 序 | 区块 | 回答的问题 | 主要数据来源 |
|---|---|---|---|
| 0 | 页面头：标题 + 数据快照日 + 决策日 + **新鲜度** + 刷新 | 数据够不够新 | `overview.snapshot_date` · `runtime_status.decision_date` |
| 1 | **市场环境** | 现在是什么市场环境 | `overview.market_regime`（枚举，优先）· `overview.overall_risk` · `three_questions.*` |
| 2 | **正式决策 / 风险**（视觉权重最高） | 当前系统建议与风险是什么 | `cards[].{action,final_target,position_gap,risk_flag,over_alloc_status}` |
| 3 | **Gen-1 时机建议** | Gen-1 建议与适用性如何 | `system_runtime.gen1` → `runtime_status.gen1_*` → 未提供 |
| 4 | **全部标的** | 哪些 ETF 需要关注 | `cards[]`（含决策链折叠、标的级 Gen-1） |
| 5 | **数据质量**：时点 / 新鲜度 / 来源 / 生命周期 / 边界字段组 / 系统状态（折叠） | 证据够不够支撑上面结论 | 多源（逐项标 provenance） |

**⛔ 首页不出现**：Gen-2 任何数据、账户交易明细、原始后端字段堆叠、基本面长文本。
正式决策区显式标注归属 `V3 Safety Core`；Gen-1 区显式标注 `GEN-1 · TIMING / ADVISORY`。

### D.2 ViewModel 结构（`adaptDashboard(data, runtimeStatus, {retrievedAt})`）

| 键 | 内容 |
|---|---|
| `available` | 响应是否可用 |
| `market` | `regime/regimeLabel/regimeTone/regimeIsFallback/regimeSourceNote` · `statusText` · `risk/riskLabel/riskTone` · `mostDefendLabel` · `mostWorthText` |
| `decision` | `identity`(Safety Core) · `riskLabel/riskTone` · `counts`(动作分类计数) · `attention[]`(需动作标的) · `bindingConstraintText` · `targetTotal`(⛔ 不出数字) · `gap` · `gen1Available` |
| `portfolio` | `etfTotal/cashRatio/techPosition/goldPosition/innovationPosition`（% ）+ `money.{totalAsset,holdingsMv,cashBalance,totalPnl}`（元，默认遮罩） |
| `cards` | `Field<卡数组>`，每卡含 M2 全字段 + `production`(契约) + `display{}`（展示文案 + 决策链 + Gen-1 摘要） |
| `gen1` | `sourceChannel`(CANONICAL/RUNTIME_STATUS/NONE) · `channelCaveat` · `authorityLabel`(后端标签优先) · `healthLabel/healthTone` · `healthGateLabel` · `safetySource` · `counterfactual{}` · `safety{productionWrite,productionFastPathEnabled,autoExecution,safetyInvariantOk}`(三态) · `perCard{total,available,unavailable}` |
| `lifecycle` | `items[8]`（`provided/valueText/reasonText/sourceText/caveat`）· `axesView[3]` · `unavailableCount/totalCount` |
| `boundaryFields` | 7 项边界字段 + 反例 + 三态展示值 |
| `systemStatus` | `ml_shadow` 折叠区（历史兼容字段，明示不参与判定） |
| `asOf` / `freshness` | 时点四项 · `{snapshot,decision,overall}`（level/ageHours/slaHours/text） |
| `provenance` / `boundaries` | 来源与回退 · 三方身份文案（Safety Core / Gen-1 / Gen-2） |

### D.3 raw → adapter → domain → UI 映射（关键行）

| 页面位置 | raw 字段 | adapter 输出 | domain formatter | 说明 |
|---|---|---|---|---|
| 市场环境·主值 | `overview.market_regime` | `market.regimeLabel` | `regimeLabel()` | 枚举优先；枚举缺失才用 `three_questions.market_status` 且标 `derived` |
| 市场环境·风险 | `overview.overall_risk` | `market.riskLabel` | `riskLabel()` + `toneForRisk()` | ★ 线上为**中文**「正常」⇒ M3 增补中文别名归一（见审计 C-7） |
| 正式决策·动作 | `cards[].action` | `card.display.action` | `actionLabel()` + `toneForAction()` | 动作域色；动作**必带文字** |
| 正式决策·目标 | `cards[].final_target` | `card.display.target` | `formatPercent()` | 百分数原样：`0.5` → `0.5%` |
| 正式决策·缺口 | `cards[].position_gap` | `card.display.gap` | `formatPercent(v,1,true)` | 服务端值透传，⛔ 不重算 |
| 标的目标带 | `cards[].target_min/max` | `card.display.band` | `formatPercent()` ×2 | 渲染为「0.4% ~ 0.5%」 |
| 机会等级 | `opportunity_grade/score` | `card.display.opportunity` | `opportunityLevel()`（后端 grade 优先） | 点数，⛔ 不加 `%` |
| Gen-1 档位 | `system_runtime.gen1.authority` / `runtime_status.gen1_authority` | `gen1.authorityLabel` | `gen1AuthorityLabel(code, backendLabel)` | **后端中文标签优先** |
| Gen-1 健康 | `…gen1_health_status` (+`…gen1_health_label`) | `gen1.healthLabel` / `healthTone` | `gen1HealthLabel()` + `toneForGen1Health()` | 风控色域 |
| Gen-1 概率 | `cards[].gen1.signal.probability` | `display.gen1.probabilityText` | `formatProbability()` | 唯一允许 0~1→% 的语义 |
| Gen-1 阈值 | `cards[].gen1.signal.threshold` | `display.gen1.thresholdText` | `formatRatio()` | **系数**，⛔ 不加 `%` |
| 生命周期 | `runtime_status.*` / `system_runtime.*` | `lifecycle.items[]` | `readLifecycle()` + `lifecycleValueText()` | 无数据 ⇒ 「数据未提供」+ 原因码文案 |
| 边界字段组 | `runtime_status.ml_*` / `gen1_*` | `boundaryFields[].value` | `dispTri()` | 三态 `true/false/null` ⛔ 不压扁 |
| 组合金额 | `overview.{total_asset,cash_balance,holdings_mv,total_pnl}` | `portfolio.money.*` | `formatAmount()` | 元 → 万/亿；前台默认遮罩 |
| 新鲜度 | `snapshot_date` / `decision_date` | `freshness.{snapshot,decision,overall}` | `assess()` + `describe()` | FRESH / STALE / MISSING 三态文案互不相同 |

**缺失态统一文案**（`domain/labels.js`，唯一来源）：
`数据未提供`（契约未下发）· `字段缺失`（字段不存在）· `未提供（null）`（契约内 null）· `数据已过期` · `读取失败`。

### D.4 与旧 Dashboard 的差异

**删除**（理由）
| 项 | 理由 |
|---|---|
| `three_questions.market_regime` / `gen1_advice` / `risk_status` | 线上**不存在**（审计 #1/#2/#3）；改读正确字段 |
| 隐杠杆区块（`leverage_alert` / `total_book_pct`） | 线上不存在，⛔ 不再虚构（审计 #4，SPEC §11.4①） |
| 旧「五维雷达 + 全量指标」首屏堆叠 | 密度过高、无优先级（SPEC §4.2）；雷达移至「看盘」 |
| 前端硬编码 `ENGINE_VERSION = 'V3.6.1'` | 版本只从 `/api/constants` 读（SPEC §12.5） |
| 数值范围启发式 `pct()` | D-7；改为语义化 formatter |
| `cards[].gen1` 伪装（用 `ml_shadow` 顶替） | 审计 #5；契约未下发即显示「数据未提供」 |

**保留**（能力不丢）
标的动作 / 当前→目标仓位 / 风险旗标 / 机会等级 / 趋势阶段描述 / 组合仓位与现金比例 / 金额显隐切换 / 刷新 / 系统运行状态（折叠）/ 数据新鲜度。

**新增**
① 数据质量区（时点 + 三态新鲜度 + provenance + 通道警示）；② 生命周期三轴 8 维（全部来自状态机，无写死）；③ 边界字段组（含反例）；④ 关注标的的**决策链折叠**；⑤ 标的级 Gen-1 摘要 + 可适用性说明；⑥ 桌面表 / 移动卡双形态；⑦ 页面四态（loading/error/empty/ready-degraded）。

### D.5 测试与验证（M3 实测结果）

```
rewrite 套件     15/15 PASS（M2 为 12）
用例总数         207 项（M2 为 157）
vite build       PASS（双入口；旧前端产物不变，Structure 仍 1,044.68 kB；新 Dashboard chunk 7.3 kB）
浏览器视觉核验    7 场景 × 6 断点 = 42 张截图；横向溢出 0；≥1024 出表格、≤768 出移动卡、状态页出现状态块
文本口径核验      0 problems（必需文案全命中、禁止项零命中）
非回归           src/ · cloudfunctions/ · tests/ · scripts/ · 旧 web/src/** 的 git diff 全为空
```

**验证方法**（可复现，工具在工作区根、⛔ 不入库）：
`_v365-fe-audit-20260930/tools/{m3-static-server.cjs, m3-visual-check.py, m3-text-check.py}`；
证据：`_v365-fe-audit-20260930/m3-visual/{*.png, report.json, text__*.txt}`。

### D.6 M3 新发现

见审计附录 **C-6 ~ C-9**（运行时模板白屏、中文风险值色域丢失、生命周期版本身份口径、`most_worth` 噪音）。

---

## 附录 E：M4-P1 第一阶段实现记录（2026-09-30 · ETF 工作台）

> 依据 owner 对 **M4-D1 / D2 / D3 / D4** 的裁定实施（裁定原文见
> `V365_M4_ETF_WORKBENCH_CONTRACT.md` §G）。本轮只做**第一阶段**：
> ViewModel + Desktop IA + Mobile IA + Primary Decision + Gen-1 Legacy Advisory + K-line stale handling。

### E.1 IA（自上而下，视觉权重递减）

| # | 区块 | 回答的问题 | 组件 |
|---|---|---|---|
| ① | Header | 这是哪只 ETF？现在什么价位？数据什么时点？ | `WorkbenchHeader.vue` |
| ② | K 线滞后提示 | K 线是否可信？（**仅严重滞后时出现**） | `StaleBanner.vue` |
| ③ | **正式决策** ★最高权威 | 系统怎么建议？目标与缺口多少？ | `PrimaryDecision.vue` |
| ④ | 仓位与风险（三轴分区） | 实际 vs 建议 vs 目标 vs 配置标准 | `PositionRiskSection.vue` |
| ⑤ | **Gen-1 Advisory** ★降权 | 时机建议是什么（且它只是建议） | `Gen1AdvisorySection.vue` |
| ⑥ | K 线 | 走势长什么样（图**始终保留**） | `KlineSection.vue` + `MiniKline.vue` |
| ⑦ | 结构与量价 | W/D/H/V + 横盘 + 均线 | `StructureSection.vue` |
| ⑧ | 基本面摘要 | 只给摘要（深层属 M6） | `DetailView.vue` 内联 |
| ⑨ | 数据质量 | 新鲜度 / 来源 / 缺什么 | `WorkbenchDataQuality.vue` |

**响应式**：`≥1100px` 四列 hero · `≤900px` 二列 · `≤768px` **单列**（决策信息优先保留）· `≤420px` 压缩字号。
实测断点：1920 / 1440 / 1280 / 1024 / 768 / 390（见 E.5）。

### E.2 ViewModel 结构

```js
adaptEtfDetail(data, runtimeStatus, { klineRaw, klineError, retrievedAt })
// → 12 组：
//   identity · decision · position · risk · gen1Detail · price · kline
//   · structure · fundamentalsSummary · freshness · provenance · boundaries · missingItems
```

★ **零回归设计**：`decision` / `position` 用 `...d` / `...p` **平铺 M2 原字段**，
M4 的展示字段一律用**新名**追加（`*Text` / `*View` / `chain` / `configBand`）——
⛔ 绝不覆盖 M2 的键（`finalTarget` / `targetBand` / `positionGap` / `overAllocStatus` /
`addEligibility` / `explainChain` / `scores` / `factors` / `band` 全部保持原形态）。
（教训：`FE-DEF-003`。）

### E.3 raw → adapter → domain → UI 映射（关键行）

| raw 字段 | adapter 归一 | domain | UI |
|---|---|---|---|
| `basic.name/sector` | `identity.nameText/sectorText` | `etfName` / `sectorLabel` | 页头 |
| `decision.final_target` | `decision.finalTargetText` | `pctText`（`0.5` → **`0.5%`**） | 决策 hero |
| `decision.position_gap` | `decision.gapText` + `gapNote` | `pctText(±)` | 决策 hero（⛔ 不重算） |
| `decision.core_position`（**建议**） | `decision.suggestedCoreText` | `pctText` | 仓位卡片② |
| `position.core_position`（**实际**） | `position.realCoreText` | `pctText` | 仓位卡片① |
| `position.target_min/std/max`（配置带） | `position.configBand.*` | `pctText` | 仓位卡片③ |
| `decision.stage_factor/market_factor` | `decision.factorsView.*` | `factorText`（⛔ **不加 %**） | 评分区 |
| `decision.explain_chain` | `decision.chain.steps[]` | `maskQuant` / `qualitativeStep` | 「为什么（定性条件）」 |
| `decision.gen1_*` + `ml_shadow.*` | `gen1Detail.*`（display 形态） | `disp` / `pctText` | Gen-1 区（★ Legacy Channel） |
| `kline[].{date,o,c,l,h}` | `kline.bars` + `lastBarDate` | `assess(lastBarDate,'kline')` | SVG K 线 + banner |
| `snapshot.{w,d,h,v}_state` | `structure.stateRows[]` | `stateLabel` | 结构区（全称显示） |

### E.4 与旧 `EtfDetail.vue` 的差异

**删除**：`gen1.advisory.*` 契约假设（从未下发）· `ml_shadow` 的 24 行「模型审计/基线对照」（生产上 16 行恒
`—`）· `privateValue()` 把 `null` 说成**「后台查看」**的错误归因 · 前端重算防守等级 · 跨 endpoint 读 `etf/list`。

**保留**：标的身份 / 动作 / 当前仓位 / 目标带 / 建议缺口 / 风险与超配 / 加仓资格（**10 项**，含
`cooldown`/`regime`）/ 评分五维 / 下一加仓条件 / 决策链 / 风险事件 / K 线图 / W/D/H/V / 横盘四重确认 /
量价 / 均线 / 基本面摘要。

**新增**：K 线独立新鲜度 + 滞后 banner · Gen-1 三通道 + Legacy 角标 + 逐字段标注 · 决策链定性化 ·
仓位三轴显式分区（实际/建议/目标/配置）· 缺失清单（`missingItems`）· 未消费载荷登记 ·
结构维度全称 + 单位标注 · 移动端单列布局。

### E.5 测试与验证（M4-P1 实测）

```text
rewrite 套件   17/17 PASS（M3 为 15）    用例 **276** 项（M3 为 207），零新增依赖
新增 2 套件    etf-detail-adapter（40 项）· etf-detail-render（29 项，真 SSR）
vite build     PASS（双入口；旧前端不变，Structure 仍 1,044.68 kB；EtfWorkbench 70.44 kB / gzip 20.27 kB）
浏览器核验     15 场景 × 6 断点 = **38 张截图，problems = 0**（横向溢出 0、JS 异常 0）
非回归         src/ · cloudfunctions/ · tests/ · scripts/ · 旧 web/src/** 的 git diff 全为空
```

**验证工具**（工作区根，⛔ 不入库）：`_v365-fe-audit-20260930/tools/m4-preview-server.cjs`（场景化 API 桩）、
`m4-visual-check.py`；证据：`_v365-fe-audit-20260930/m4-visual/{*.png, report.json}`。

### E.6 M4-P1 新发现

见审计附录 **C-16 ~ C-18** 与风险台账 **`FE-DEF-001 ~ FE-DEF-004`**
（display/Field 形态错配导致整区空值 · `normalizeRisk` 大写英文落空 · 重写导致 M2 键回归 ·
缺失分支未返回同形状骨架）。

★ **本轮最重要的方法论结论**：
`[SRC]` **「build PASS + 单测全过」不能证明页面能渲染** —— 上述 4 个缺陷中有 2 个
（`FE-DEF-001` / `FE-DEF-004`）**只被真实浏览器渲染核验 / SSR 渲染测试抓到**，
代码审查与字段级单测均漏检。⇒ **每个页面里程碑必须做一次真实渲染核验**（已固化为技能）。

---

## 附录 F：M4-P1 第二阶段实现记录（2026-09-30 · ETF 工作台「可审阅」）

> 目标升级：从「看懂一只 ETF」→「**能够审阅这只 ETF 当前决策及其变化、风险和辅助证据**」。
> 本轮 **只读侦察 → 确认契约 → 实现**，⛔ 未改 backend；`NO PUSH / NO MERGE / NO DEPLOY`。

### F.1 IA（12 段 · **语义优先级**）

> ★ **M5-P1 变更（owner D-M5-4）**：取消「数字档位」命名（易与 DOM 顺序冲突），
> 改用**语义优先级**；DOM 顺序**保持真实认知顺序**，⛔ 不为编号调整。

| # | 区块 | 语义优先级 | 类名 | 组件 |
|---|---|---|---|---|
| ① | Header（身份 · **组合环境** · 价格 · 三个日期 · 新鲜度） | Identity | `.wb-head` | `WorkbenchHeader` |
| ② | K 线滞后提示 | — | `.stale-banner` | `StaleBanner` |
| ③ | **正式决策** | **Formal Decision** | `.primary-decision` | `PrimaryDecision` |
| ④ | 仓位（实际/建议/目标/配置）＋ 仓位缺口**主位** | **Risk & Position** | `.prio-position` | `PositionRiskSection` |
| ⑤ | **机会 / 辅助信号** | **Advisory & Opportunity** | `.prio-advisory` | `OpportunityRadar` |
| ⑥ | **防守雷达** | **Risk & Defense** | `.prio-risk` | `DefenseRadar` |
| ⑦ | Gen-1 Legacy Advisory | Advisory（降权） | `.gen1-advisory` | `Gen1AdvisorySection` |
| ⑧ | K 线 | Evidence | `.prio-evidence` | `KlineSection` |
| ⑨ | 结构 | Evidence | `.prio-evidence` | `StructureSection` |
| ⑩ | 情报 / 基本面摘要 · **风险事件主位** | Evidence | `.prio-evidence` | `IntelligenceSection` |
| ⑪ | **最近决策变化**（只 5 条） | History（最弱） | `.prio-history` | `DecisionHistorySection` |
| ⑫ | 数据质量 / 来源 | Provenance | `.prio-evidence` | `WorkbenchDataQuality` |

**权重靠三件事共同表达**（⛔ 不靠单一颜色）：
① 左侧强调边线（`.primary-decision` 强调色 / `.prio-risk` 风险色 / `.prio-position` 强调色 / `.prio-advisory` 弱边线 / 无 / 无）
② 数字字号（hero `28px` > 次级 `20px` > 常规 `14px`）
③ 区块自身声明（副标题里写明"这是辅助信号，不是加仓建议"）。

### F.1b ★ M5-P1 —— 单源展示（Single-Source Display）

> owner 裁定（2026-10-01）：«同一个 backend 事实，在页面中必须有唯一明确的主位；
> 其他区块如必须出现，只能作为引用位，不能再次解释成另一套判断。»

| 项 | 内容 |
|---|---|
| **归属表** | `web/src/rewrite/domain/ownership.js` —— 24 个事实：`owner`（唯一）+ `refs`（白名单）+ `rule` + `forbid` |
| **标记组件** | `components/domain/Fact.vue` → `data-fact` / `data-role`（owner·ref）/ `data-ref-to`；引用位附可见「引用 · 见「X」」 |
| **主位分配（要点）** | 正式决策族 → ③；仓位缺口 / 建议仓位 / 目标带 / 配置标准 → ④；防守 / 溢价 / 超配 → ⑥；机会 / 资格 / 条件 / 冷静期 → ⑤；风险事件 / 基本面摘要 → ⑩；组合环境 → ①；K 线时点 → ⑧；历史 → ⑪ |
| **引用位（保留）** | `finalTarget`（④引用③）、`targetBand`（③引用④）、`positionGap`（③与⑤引用④）、`riskFlag`（④与⑥引用③）、`riskEvents`（⑥引用⑩，只给条数）、`klineLastDate`（①引用⑧） |
| **删除** | 页尾重复的 `fundamentalsSummary` 段（主位已在⑩） |
| **验证** | `tests/rewrite/single-source.test.js`（16 项）+ 浏览器 DOM 核验（24 事实 owner 全 1） |
| **不变式** | ⛔ 无新增业务信息；⛔ 未改 adapter 业务语义；⛔ 未改后端；⛔ 未把辅助信号升格为正式决策 |

### F.1c ★ M5-P1 —— 组合环境（只读引用）与条件去冲突定量

| 项 | 内容 |
|---|---|
| **组合环境** | 契约已证实：`schema.js:240`（枚举 `aggressive/structural/range/defensive/crisis`）+ `apiGateway:465`（组合快照）⇒ 允许**只读引用** `/api/dashboard#overview.market_regime`；带 `provenance` + `freshness`；取不到 ⇒ **NOT_PROVIDED**（⛔ 不由标的字段推导） |
| **条件去冲突定量** | `next_add_condition` 原文含「Gap -8%」与结构化字段 `position_gap = 0` 冲突（**DS-006**）⇒ `domain/condition.js` **只移除**该片段，其余**逐字保留**（⛔ 不换算 / ⛔ 不重算 / ⛔ 不用 gap 生成新文案）；原文保留在 `nextAddConditionRaw` |
| **历史边界** | 工作台只渲染**最近 5 条**（`history.recent`）+ 变化点；完整审阅属「复盘」页（⛔ 不复制完整历史能力）；最后一条 `items` 全量仍保留在 VM |

### F.1d ★ M5-P2 ~ M5-P11 —— 前端连续自主执行记录（2026-10-01 · `NO COMMIT`）

> 执行方式：owner 授权**连续自主执行**（只在 GATE-1~5 停下询问）。
> 全程 `NO COMMIT / NO PUSH / NO MERGE / NO DEPLOY / NO PRODUCTION RUN`；⛔ 未改 backend 与 production。

| 阶段 | 已实现的事实（★ 只登记**已落地**者） |
|---|---|
| **M5-P2** 语义边界 | 十段区块的**语义优先级 class** 与 DOM 顺序被 `tests/rewrite/semantic-boundary.test.js` **精确锁定**；每段只承载注册表允许的事实（`isAllowedAt` 逐条判定） |
| **M5-P3** 单源固化 | 归属表 **24 → 25** 个事实（补 `actualPosition` = §六(2) 点名的「实际持仓」主位）；守卫扩为 **15 个点名事实表驱动** + **19 场景**多变体不变式（`owner=1` / `refs ≤ 白名单` / `refs>0 ⇒ owner=1`）+ HTML 与**可见文本**零 `snake_case` |
| **M5-P4** 数据语义 | `canonical > 显式 legacy > unavailable` 三通道判定；`NULL_IN_CONTRACT`（`null` 保持缺失态，⛔ 不 fallback、⛔ 不当 0）；**不跨 endpoint 偷补**（以 `missingItems` 集合相等为证） |
| **M5-P5** 组合环境 | 三态（正常 / 字段缺失 / 请求失败）说明文案**两两不同**；★ 实测**标的侧另有 `effective_market_regime = crisis`**，与组合级 `defensive` **不同** ⇒ 守卫证明前端只取组合级、组件层**零引用**标的侧字段 |
| **M5-P6** DS-006 | 处置不变（手术式移除冲突片段 + 原文可审计）；新增 VM 层与渲染层双向断言 |
| **M5-P7** K 线 | **七态分离**（读取失败 / 未提供 / 字段缺失 / 合法空 0 根 / 无时间戳 / 滞后 / 新鲜）—— 修掉「畸形载荷」与「合法空」共用「无时间戳」的**两态塌陷**；陈旧时保留历史 + 真实 cutoff + 与决策新鲜度**独立** |
| **M5-P8/P9** 视觉 QA | 本地预览 + 无头浏览器：**13 场景 × 5 断点（1920/1440/1024/768/390）+ 13 个补充场景 = 91 次运行**，problems = **0**（横向溢出 0 / 语义损失型截断 0 / 主位重复 0 / 悬空引用 0 / 字段名泄露 0 / 禁用语义 0；390px 首屏正式决策 top=591 < 视口高） |
| **M5-P10** 结构清理 | 删除 **10 处 dead import**（8 个文件）+ 3 处过期 IA 文案（`routes.js` 文件头页数 · `adapters/kline.js` · `MiniKline.vue`）；⛔ 未动 legacy `web/src/**` |
| **M5-P11** 文档闭环 | 本附录 ＋ 风险台账 M5-P2~P11 段（含 `FE-DEF-007~011`）；⛔ 未写 `production activated` / `deployment complete` |

**测试规模**：**22 套件 / 362 用例全过**（新增 `semantic-boundary`（11 项）· `state-semantics`（12 项）；`single-source` 16 → 19 项）。

### F.2 新增 ViewModel 四组

```js
opportunity  = { available, score/scoreText/scoreNote, grade/gradeText, level/levelText/levelTone,
                 factor/factorText/factorNote, addMode/addModeText, cooldownDays/cooldownText,
                 nextAddCondition/nextAddConditionText, eligibility{items[10],overall,blockedCount},
                 gap/gapText/gapNote, sectionNote, noDeriveNote }
defense      = { available, active, level/levelNumber/levelLabel/levelTone, reason/reasonText,
                 score/scoreText/scoreNote, factor/factorText/factorNote,
                 crossCheck{topScore,topPenalty,scoreConsistent,factorConsistent,inconsistent,note},
                 riskFlag/riskLabel/riskTone, riskOverrideText, overAlloc/overAllocText,
                 premiumFlag/premiumText, premiumRate/premiumRateText,
                 events{state,items[],count,isEmpty,emptyText,emptyNote}, readonlyNote }
intelligence = { available, fundamental{...}, layers{available,items[],totalLayerWeight,note},
                 detail{available,finalSignal/finalSignalText,signalNote,counts},
                 riskEvents（★ 与 defense.events 同一对象引用）, notConsumed[] }
decisionHistory = { state, available, reason, source/sourceNote/changeNote/changeKinds,
                    count, items[{date,action/actionText/actionTone,finalTarget/finalTargetText,
                                  gap/gapText,riskFlag/riskText/riskTone,
                                  defenseLevel/defenseLevelText/defenseLevelTone,defenseScore/…}],
                    changes[{kind,label,date,fromDate,toDate,from,to}], changedCount,
                    freshness, oldestDate, newestDate, text, note }
```

### F.3 raw → adapter → domain → UI（新增行）

| raw | adapter | domain | UI |
|---|---|---|---|
| `decision.defense_state.level`（**数字 0~4**） | `defense.levelNumber` | `defenseLevelLabel` / `toneForDefenseLevel` | 防守雷达（`level = N` 与中文并列） |
| `decision.defense_state.score`（**0~100 分**） | `defense.scoreText` | `formatScore` | 防守雷达（带「分数 0~100」说明） |
| `decision.defense_state.factor`（**系数 0.50~1.00**） | `defense.factorText` | `formatRatio` | 防守雷达（带「乘性系数」说明） |
| `decision.defense_score` / `.defense_penalty`（顶层**冗余**） | `defense.crossCheck` | — | 仅在不一致时出警示 |
| `decision.opportunity_factor`（**系数**） | `opportunity.factorText` | `formatRatio` | 机会雷达 |
| `decision.add_mode`（字符串枚举） | `opportunity.addModeText` | `addModeLabel` | 机会雷达 |
| `decision.add_eligibility`（10 判据 + overall） | `eligibility.items[]` | `ELIGIBILITY_ITEMS` / `eligibilityTone` | 资格网格 |
| `fundamental.detail.layer_breakdown` | `intelligence.layers.items[]` | `fundLayerLabel` | 情报区（信号/权重**原值**，⛔ 不加 %） |
| `risk_events`（`[]` / 有值 / 缺失） | `defense.events`（情报区**共用同一对象**） | `RISK_EVENTS_EMPTY_TEXT` | 防守雷达 + 情报区 |
| `GET /api/etf/:code/decisions` → `data[]` | `decisionHistory.items[]` | `pctText` / `riskLabel` / `defenseLevelLabel` | 历史表（桌面）/ 卡片（移动） |

### F.4 与第一阶段的差异

**新增**：机会/辅助信号区（含 10 项加仓资格 + 显式「不推导加仓」声明）·
防守雷达（等级/分数/系数**三重量纲**各自带说明 + 顶层冗余字段交叉核对）·
情报/基本面摘要（分层证据 + 事件 + 未消费块登记）·
历史决策变化（真实 API + 变化点 + 桌面表/移动卡双形态）。

**修正（勘误）**：`fundamental.detail.layer_breakdown` 就在 `fundamental` 块内（409 B），
M4-P0 曾误记为「属 M6」⇒ 本轮纳入情报区；⛔ `fundamental_config` / `fundamental_series` 仍不消费。

**未变**：Gen-1 策略（仍 `TIMING / ADVISORY` + `Legacy Channel` + 降权）；
K 线处理（banner + 保留图表）；决策链定性化；仓位四轴分区。

### F.5 测试与验证（M4-P1b 实测）

```text
rewrite 套件   19/19 PASS（M4-P1a 为 17）    用例 **319** 项（M4-P1a 为 276），零新增依赖
新增 2 套件    etf-radar（17 项）· etf-history-intel（17 项）
渲染套件扩充   38 项（原 29）：新增第二阶段 9 条，含「空数据总检」与「视觉层级」
vite build     PASS（双入口；旧前端不变，Structure 仍 1,044.68 kB；EtfWorkbench 99.44 kB/gzip 27.46 kB）
浏览器核验     24 场景 × 5 断点（1920/1440/1024/768/390）= **54 张截图，problems 0**
非回归         src/ · cloudfunctions/ · scripts/ · tests/ · 旧 web/src/** 的 git status 全为空
```

### F.6 M4-P1b 新发现

| # | 内容 | 处置 |
|---|---|---|
| 1 | ★ **`adaptDecision` 不可用分支只返 3 键** ⇒ 下游 `adaptDefense` 读 `riskFlag` 直接 `TypeError`（整页崩） | ✅ 已修：该分支改为返回**同形状完整骨架**（教训见 `FE-DEF-005`） |
| 2 | ★ **`defenseLevelFromScore` 区间重叠**：`score>=35 → 1` 与 `score>=20 → 1` **都返回 1** ⇒ 20~49 全为 level 1，level 2 只可能在 50~64 | `[AS-IS]` **只登记**（后端逻辑可疑点，⛔ 不属前端范围、⛔ 不修改） |
| 3 | ★ **顶层 `defense_score` / `defense_penalty` 与 `defense_state` 内字段冗余同源** | 前端只展示 state 内的值 + **交叉核对**（不一致时警示，⛔ 不静默选边） |
| 4 | ★ **`level === 0` 时后端不返回 `score` / `factor` 键** | 走 `MISSING/FIELD_ABSENT`（「字段缺失」），⛔ 不得补 0 / 1.00 |
| 5 | **`getDecisions` 走 `v365-reader-allow:history-deferred`**（`RUN_HISTORY_INDEX = PENDING`） | `[AS-IS]` 登记；历史读取属「延后」段，与本轮前端无关 |
| 6 | **`fundamental.detail` 量纲未由 schema 证实**（`final_signal=0.73`、`layer.signal`） | 只展示**后端原始值** + 显式标注「本页不解释量纲」，⛔ 不加 %、⛔ 不换算 |
| 7 | **`getDecisions` 默认 limit 60、支持 `?from=&to=`** | 前端当前不带参数（取默认 60 条）；区间筛选属后续能力（⛔ 本轮不加 UI） |

登记位置：审计附录 **C-19 ~ C-20**、风险台账 **`FE-DEF-005`**。

### F.7 M4 最终验收对照（owner 的 12 问）

| # | 问题 | 本页回答方式 | 有后端数据？ |
|---|---|---|---|
| ① | 这是什么 ETF？ | 页头：代码/名称/赛道/配置上限/配置标准 | ✅ |
| ② | 当前正式决策是什么？ | `PrimaryDecision`（动作 + 目标 + 缺口） | ✅ |
| ③ | 当前目标/仓位/风险是什么？ | `PositionRiskSection` 四轴 + 防守雷达 | ✅ |
| ④ | 为什么当前有这个正式决策？ | 决策链**定性条件**（M4-D3 裁定） | ✅ |
| ⑤ | 防守风险是什么？ | `DefenseRadar`（等级/分数/系数 + 事件） | ✅ |
| ⑥ | 有没有辅助 Timing / Advisory？ | `Gen1AdvisorySection`（Legacy 通道显式降级） | ✅（legacy 通道） |
| ⑦ | 有没有机会/加仓相关辅助信号？ | `OpportunityRadar`（★ 明确「辅助信号，不是加仓建议」） | ✅ |
| ⑧ | 有没有风险事件/基本面证据？ | `DefenseRadar.events` + `IntelligenceSection` | ✅（事件当前为 `[]`） |
| ⑨ | K 线数据截至什么时候？ | 页头 + banner + K 线区（**实际日期**） | ✅（末端 2024-08-27，见 `KLINE-DATA-001`） |
| ⑩ | 历史决策变化是否有真实数据？ | `DecisionHistorySection`（真实 6 条 + 变化点） | ✅ |
| ⑪ | 哪些信息是 backend 真正提供的？ | 每个区块的 provenance / 来源说明 / 逐字段量纲标注 | — |
| ⑫ | 哪些信息目前没有提供？ | `missingItems` 清单 + 各区块显式「数据未提供」+ `notConsumed` 登记 | — |

★ **最后三条原则的执行证据**：
「有数据就展示」⇒ 12 区全部由真实字段驱动；
「没有数据就明确说没有」⇒ `[]` / 缺失 / 未请求 / 读取失败**四态文案两两不同**（测试断言强制）；
「永远不要为了视觉完整而推导或虚构」⇒ 三类禁止项均有**测试断言**守卫
（⛔ 不重算 `position_gap`/`defense_*`/`final_target`、⛔ 不跨 endpoint 偷补、⛔ 不伪造历史、⛔ 不由 gap 推导加仓）。

