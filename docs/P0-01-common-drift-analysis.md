# P0-01 Common 漂移分析报告

**日期**：2026-09-08
**基线**：`master@d9c2cd5`（8fc3ba6 基线 + 部署脚本）
**范围**：`cloudfunctions/*/common/` 10 个函数 × 49 个 common 文件

---

## 0. 结论摘要

1. **漂移比任务书描述的更严重**：任务书只点名 `decision-v3.js`、`v3-shadow.js` 分叉，实测 **18/49 个 common 文件已分叉**，且呈 4 个连贯「家族」而非随机拷贝。
2. **根因是「V3.8 实验线部分泄漏」**：数据抓取系（fetchDailyData / fetchRealtimeData / materializeIndicators）的 `constants.js` 是 **484 行 / ENGINE_VERSION='V3.8'**，而生产 `runDecisionEngine` 是 **632 行 / ENGINE_VERSION='V3.6.1'**。即「V3.8 替换」只落到部分函数、生产已回退 V3.6.1，但数据抓取函数未回退干净。
3. **很多漂移是「死拷贝」**：如 `decision.js` 只有 `runDecisionEngine`（经 decision-v3.js 传递）真正使用，但 extractFundamental / fetchDailyData 也各带了一份漂移版。
4. **存在真实「活漂移」风险点**：`indicators.js` 计算方（materializeIndicators）与消费方（runDecisionEngine / runGen1ShadowEod）版本不同（差 7 行 breakout_nd 字段）；`datasource.js` 全量版 vs 精简版相差 219 行。

---

## 1. 漂移全景（18 个漂移文件）

### 1.1 四个「家族」的 SHA 指纹

| 家族 | 函数 | 特征 |
|---|---|---|
| **gateway 生产系** | runDecisionEngine、apiGateway、runGen2ShadowEod | V3.6.1 冻结逻辑 |
| **admin+Gen1 系** | adminGateway、runGen1ShadowEod | 生产版 + Gen-1 advisory 超集 |
| **数据抓取系** | fetchDailyData、fetchRealtimeData、materializeIndicators | V3.8 精简版（constants 484 行） |
| **基本面系** | extractFundamental、fetchFundamentalNews | 带 E3 首仓系数等变体 |

### 1.2 漂移文件明细与性质

| 文件 | 漂移派数 | 性质 | 活依赖方 |
|---|---|---|---|
| `constants.js` | 5 | **版本错位**（V3.6.1 vs V3.8） | 全部 10 函数 |
| `schema.js` | 4 | 版本错位 + 声明式漂移 | adminGateway（活） |
| `utils/db.js` | 2 | gateway 版含 ensureCollection（超集） | 全部 |
| `utils/decision-v3.js` | 2 | admin/Gen1 = 生产 + advisory 门控超集 | runDecisionEngine + admin/Gen1 |
| `utils/v3-shadow.js` | 2 | admin/Gen1 = 生产 + v361_baseline 字段超集 | 经 decision-v3 传递 |
| `utils/decision.js` | 3 | 数据抓取/基本面带 V3.8/E3 特性 | runDecisionEngine（活） |
| `utils/indicators.js` | 3 | 生产版多 breakout_nd（计算vs消费差 7 行） | runDecisionEngine + materializeIndicators + Gen1 |
| `utils/datasource.js` | 2 | 全量版 vs 精简版（差 219 行） | extractFundamental + fetch*Data |
| `utils/ml-shadow.js` | 3 | 生产版 vs admin/Gen1 增字段 | apiGateway（活） |
| `utils/cooldown.js` | 2 | gateway vs fundamental | runDecisionEngine + apiGateway（活） |
| `utils/live-asset.js` | 2 | gateway vs data-fetch | gateway 系（活） |
| `utils/pnl.js` | 2 | gateway vs data-fetch | gateway 系（活） |
| `utils/gateway-errors.js` | 2 | admin vs 其他 | adminGateway（活） |
| `utils/request-validate.js` | 2 | admin vs 其他 | adminGateway（活） |
| `utils/review-position.js` | 2 | api vs Gen1 | review-stats 传递（活） |
| `utils/review-stats.js` | 2 | api vs Gen1 | apiGateway（活） |
| `utils/shadow-v3-log.js` | 3 | 生产 vs api vs admin/Gen1 | runDecisionEngine（活） |
| `utils/gen1-view-model.js` | 2 | admin vs Gen1（已专有命名） | adminGateway + runGen1ShadowEod |

> 「活依赖方」依据全量 require 图（含传递依赖）判定。**非活依赖方的漂移副本 = 死拷贝，可直接消除。**

### 1.3 一致文件（29 个，无需处理）

admin-auth、biotech-intel、correlation、defense、engine-invoke、etf-profile、fetch-guard、fundamental、holdings-parse、intel-refresh、market-env-v3、market-regime、market-score-components、overseas-filings、position-sizing、shock-filter、shock-recovery、stage-residency-diagnostics、trend-stage、v3-2-math-engine、v3-3-target-exposure、v3-4-stage-position-engine、v3-5-structural-engine、v3-6-stage-persistence、v3-bull-participation、v3-constants、v3-premium、v3-trend-first-position。

### 1.4 单函数文件（2 个，Gen-1 冻结）

`gen1-capability.js`、`gen1-rule-permission.js`（仅 runGen1ShadowEod）。

---

## 2. Canonical 决策规则（建议）

| 规则 | 内容 | 适用文件 |
|---|---|---|
| **R1 生产权威** | decision 逻辑以 `runDecisionEngine`（V3.6.1 冻结基线）为 canonical | decision.js、indicators.js、constants.js、schema.js |
| **R2 干净超集胜出** | 某变体是「纯加法超集」（只增字段/函数、不改既有输出）→ 超集为 canonical | db.js（gateway）、decision-v3.js / v3-shadow.js（advisory 门控超集）、datasource.js（全量版） |
| **R3 声明式并集** | 常量/表结构收敛到 V3.6.1 生产版，丢弃 V3.8 实验线 | constants.js、schema.js |
| **R4 死拷贝消除** | 构建脚本只拷贝「活 require」文件，非活拷贝自然消失 | decision.js 在数据抓取/基本面的副本等 |
| **R5 专有改名隔离** | Gen-1 专有逻辑保持独立命名，不进通用 common | gen1-capability、gen1-rule-permission、gen1-view-model |

---

## 3. 需用户拍板的关键点

1. **V3.6.1 收敛方向**（R1/R3）：确认以 V3.6.1 为 canonical、把数据抓取系的 V3.8 泄漏收敛回 V3.6.1。任务书第 1 节已明确 V3.6.1 FROZEN，本项视为已确认，仅在此留痕。

2. **decision-v3.js 的 advisory 处理**（R2 的取舍）：
   - **方案 A（超集合一，推荐）**：advisory 是 `extra.advisoryStageOverride` 门控的纯加法，生产函数从不传该 flag → 行为不变。把 admin/Gen1 的超集版设为 canonical，全部函数共用一份，**SHA 立即统一、零重构、行为不变**。
   - **方案 B（专有改名隔离）**：canonical 保留生产纯净版（无 advisory），advisory 逻辑拆成 `decision-v3-advisory.js`，仅 admin/Gen1 引用。**更干净但需改 index.js require + 拆分 14 行逻辑**。

3. **datasource.js 合并**：全量版（含港交所/持仓/基本面函数）+ 采纳数据抓取系更强的重试配置（30000ms / 3 次退避）。属 R2 超集合并，默认执行。

---

## 4. 后续 Work Package 衔接

本报告为 P0-01 的输入。P0-01 落地产出：
- `src/common/`（canonical 单一真相源）
- `scripts/build-cloudfunctions.js`（构建 + SHA256 manifest + parity 校验）
- `dist-functions/` 由 build 生成（不再手工维护）

P0-02 ~ P0-09 顺序见任务书第 32 节。
