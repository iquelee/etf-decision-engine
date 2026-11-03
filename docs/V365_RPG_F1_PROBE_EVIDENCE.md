# V365 RPG-F1 Probe Evidence

> **性质**：只读探针 + 证据（read-only probe）。⛔ **未改 `v364-replay-harness.js` / 任何 production calculation / RDE / parity gate / qualification gate / schema / collection**。
> **生成**：2026-09-28（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **前置**：`docs/V365_REPLAY_FIDELITY_REPAIR_DESIGN.md`（RPG-001/002 设计）· 本轮 owner 裁定 RPG-D1/D2/D3/D5
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
>
> **结论标记**：`[AS-IS]` 代码/数据实测 · `[PROBE]` 本探针实测 · `[INFER]` 由实测推出 · `[HUMAN]` 须人工裁定

---

## 0. 本轮裁定接收 `[AS-IS]`

| 裁定 | 内容 | 本轮的落实 |
|---|---|---|
| **RPG-D1** | APPROVED —— 采用独立 Replay Protocol V2，不原地改 V1 | 探针输出标注 `protocol.v1 = RFP-V1` / `target = RFP-V2`；⛔ 未触碰 V1 anchor |
| **RPG-D2** | APPROVED —— 保留 V1/V2 双跑过渡 | 探针**同时**计算 V1 与 production-faithful 两路（对照基础） |
| **RPG-D3** | APPROVED —— `EXPECTED_FIDELITY_DELTA` 仅允许两条 reason + 逐条机器证据 | 探针输出 `potentially_decision_relevant` 逐条含 `date/code/cap_delta_pp`（可作归因证据） |
| **RPG-D5** | ACCEPTED —— 未发现 RPG-003；OBS-A/OBS-B 保留 | ⚠️ **本轮发现一个 RPG-003 候选**（见 §6.3），须 owner 复核 |
| **RPG-D4** | PENDING —— V2 尚不得替代 V1 | 本文件 §8 更新其条件 |

---

## 1. RPG-001 Production-Path Parity Probe

**脚本**：`scripts/v365-rpg001-tech-cap-probe.js`（只读，`--out` 仅写证据 JSON）
**证据**：`outputs/v365-rpg001-probe.json`（74 KB）

### 1.1 探针方法 `[PROBE]`

| 侧 | 计算方式 |
|---|---|
| **V1** | `effective_tech_cap = fallback`（= `PROD_PARAMS.tech_sector_max` = **65**）—— 因为 harness 的 `buildPortfolio()` 不设该字段 |
| **PRODUCTION_FAITHFUL** | 逐日取 **as-of-date** bars（⛔ 无前视）→ 调用**生产同一纯函数** `correlation.effectiveTechCap(base, barsMap)` |

⛔ **未使用任何假常量**（如 `effective_tech_cap = 65`）作为生产侧取值。

### 1.2 固化结果 `[PROBE]`

| 统计量 | 值 |
|---|---|
| `TOTAL_DAYS` | **25** |
| `DISCOUNT_NE_1_DAYS` | **25**（即 25/25 天 `discount = 0.97`） |
| `CAP_CHANGED_DAYS` | **25** |
| `SECTOR_CAP_BINDING_COUNT` | **7** |
| `POTENTIALLY_DECISION_RELEVANT_COUNT` | **7** |

- `base_cap = 65`（来源 `PROD_PARAMS.tech_sector_max`）
- `tech_codes = ["513310","515880","159582"]`
- 7 条潜在决策相关记录**全部**落在 `159582`（`semi_equip`），V1 的 `binding_constraint = 'sector_cap'`，`cap_delta_pp = -1.9`

⇒ **E1 / E2 已由可复跑脚本固化**（不再依赖一次性手工探针）。`[PROBE]`

### 1.3 ⚠️ 一处**能力边界**（如实披露）`[AS-IS]`

`sectorRemainingLimit = max(0, effectiveTechMax − sectorUsed)`，其中 `sectorUsed` 由 harness **在当日 run 循环内**逐票累加
（`harness:335 sectorOccupation`），**不通过公开 API 暴露**。
⇒ 探针**不重实现 replay**，因此：
- 提供 `sector_remaining_upper_bound_v1/_prod`（用 `byCode[].suggested_position` 重建的前一日账面）⇒ ⚠️ 因 `sectorUsed ≥ tech_position`，该值是**上界**（非精确值）；
- 另提供 `sector_cap_shift_pp = cap_delta_pp`（cap 位移对 `remaining` 的**精确**位移，模 `max(0)` 截断）。

---

## 2. RPG-002 Execution-Semantics Probe

**脚本**：`scripts/v365-rpg002-execution-semantics-probe.js`（只读）
**证据**：`outputs/v365-rpg002-probe.json`（9.7 KB）

### Q1 · 生产中 `TRADE_LOG.action='buy'` 到底代表什么 `[AS-IS]`

**答：`(a) 实际成交`（人工录入台账）。**

**证据链（三条，均代码/数据实测）**：

| # | 证据 | 出处 |
|---|---|---|
| 1 | **唯一写入方 = 管理端 CRUD 端点** `tradeCRUD(payload)`，`_op='create'`；`trade_date / code / action / shares / price` **全部由 payload 提供** | `cloudfunctions/adminGateway/index.js:701`（函数）、`:729`（`.add({...})`） |
| 2 | 该集合在架构中**显式登记为人工台账**：`{ collection: 'trade_log', axis: 'MANUAL_LEDGER', note: '人工操作记录' }` | `src/common/utils/v365-active-read.js:84` |
| 3 | **决策引擎从不写它** —— RDE 对 `TRADE_LOG` 只有**读**（`:463`，加权平均成本法还原持仓） | `grep TRADE_LOG cloudfunctions/runDecisionEngine/index.js` ⇒ 仅 `:454` 注释 + `:463` 查询 |

探针实测写入方**共 5 处，全部在 `adminGateway/index.js`**：
```
:729  db.getCollection(COLLECTIONS.TRADE_LOG).add({...})            ← create
:746  db.updateById(COLLECTIONS.TRADE_LOG, res.id, {position_after}) ← 成交后联动
:769  db.updateById(COLLECTIONS.TRADE_LOG, id, data)                 ← 编辑
:781  db.updateById(COLLECTIONS.TRADE_LOG, id, {position_after})     ← 编辑后联动
:790  db.removeById(COLLECTIONS.TRADE_LOG, id)                       ← 删除
```

### Q2 · `final_action = BUILD/ADD` 是否会自动产生 `TRADE_LOG buy` `[AS-IS]`

**答：不会。`DECISION ≠ EXECUTION`（`Q2_decision_implies_execution = false`）。**

**证据**：决策路径内 `TRADE_LOG` 写入方数量 = **0**（探针静态审计）。

### Q3 · 是否存在双向合法场景 `[AS-IS]`

**答：两个方向都合法，且都有真实数据佐证。**

| 方向 | 合法性 | 证据 |
|---|---|---|
| `BUILD/ADD` 但**无** buy | ✅ 合法（**常态**）—— 决策是**建议**，执行由人决定 | 探针实测 `DECISION_EXECUTION_MATCH_COUNT = 0`（真实 10 条成交**全部** `decision_id` 为空） |
| buy 但**无** `BUILD/ADD` | ✅ 合法 —— 人工可自行下单 | 真实数据示例：`2026-08-19 513310 buy shares=700 reason="抄底"`；另 `review-stats.js` 明确把无同向建议的成交标为「**自主调整**」 |

### Q4 · position 变化与 TRADE_LOG 的关系 `[AS-IS]`

**答：两条独立轴。`position changed ≠ trade executed`。**

- `portfolio_position` 是**独立集合**（管理端维护）；
- `tradeCRUD` 在成交后**可选**联动 `position_after`（`adminGateway:746/781`）；
- 但 `portfolio_position` 亦可由其它管理端点变更 ⇒ **不得**由 position 反推成交。

### 2.1 ★ Q4 延伸：**replay harness 自身**违反了该原则 `[AS-IS]`

```
scripts/lib/v364-replay-harness.js:338-340
  // 账面推进：只在**最后一次运行**后生效（同日重跑不改仓位 —— 当天没有成交）
  if (run === runsPerDay - 1) {
    nextBook[u.code] = res.suggested_position != null ? res.suggested_position : (nextBook[u.code] || 0);
```

⇒ V1 replay 的**持仓轨迹由 `suggested_position`（决策建议）驱动** ⇒ **隐含「建议必被执行」（Model A）**，
而 §Q1–Q4 已证生产为 **Model B**。

**后果** `[INFER]`：replay 的 `portfolio.tech_position` / `cash_ratio` / `sectorUsed` 与生产**可能系统性偏离** ⇒
影响 `sectorRemainingLimit` 与**全部** portfolio 输入 ⇒ **覆盖面大于 RPG-002**。

⇒ 登记为 **`RPG-003_CANDIDATE`**（见 §6.3），⛔ 本探针只登记、不裁定。

---

## 3. Cooldown Replay Model Decision

### 3.1 裁定 `[INFER]`（基于 §2 的代码证据）

| 模型 | 判据 | 裁定 |
|---|---|---|
| **A — Decision-implies-execution** | 只有代码证明 `BUILD/ADD → 自动成交/自动记 TRADE_LOG` 才允许采用 | ⛔ **REJECTED** —— §Q2 已证决策路径内**零**写入方；且真实数据 `decision_id` **全空** |
| **B — Explicit execution ledger** | 若 decision 与 execution 分离，则 V2 必须显式拥有 `decision timeline` + `execution timeline`；**cooldown 只能读 execution timeline** | ✅ **ADOPTED** |
| **C — Synthetic branch coverage** | 若历史数据集无真实 execution history，可另建 synthetic branch test，但必须 `synthetic = true`，且**不得计入 production-fidelity anchor** | ✅ **ADOPTED（作为 B 的补充，见 §4/§6）** |

⇒ **V2 cooldown ledger 必须模拟 `execution`，不得模拟 `decision`。**
⇒ 且：**V1 harness 的账面（`nextBook`）恰好违反这一裁定**（§2.1）⇒ 与 RPG-003 候选同源。

---

## 4. Audit Actual Historical Availability

| 项 | 状态 | 证据 |
|---|---|---|
| **`TRADE_LOG` historical data（规范输入包内）** | **`ABSENT`** | `deliverables/` 下**仅** `etf_daily_ml_pool/*.csv`（日线）；无任何 trade_log 文件 |
| `portfolio_position` history | **`ABSENT`** | replay 输入包内不存在 |
| execution confirmation | **`ABSENT`** | 无成交确认字段/文件 |
| buy timestamps | **`ABSENT`**（在输入包内） | `trade_log.trade_date` 存在，但该表**不在输入包内** |
| `add_mode` | **`ABSENT`** | `trade_log.add_mode` 为可选字段；**真实数据 10 条中仅 1 条含该字段且为空串 `""`** |
| **`TRADE_LOG` 真实导出（仓外临时 dump）** | ⚠️ **`PARTIAL`** | `C:/c/tmp/cd-dump/database_export-…-trade_log-1787540234526.json`（**10 条**，`2026-08-14 → 2026-08-24`）—— ⛔ **仓外、非规范、无 provenance/校验**，且**不覆盖** replay 窗口后段（`→ 2026-09-22`） |

**⇒ 结论** `[INFER]`：**真实 execution history 在规范输入包内缺失**；
存在一份**仓外临时导出**证明数据**可得**，但它**不是**受治理的制品 ⇒ ⛔ **不得**据此声称 production-faithful。

---

## 5. RPG-002 Probe Output（§5 字段实测）`[PROBE]`

```
REPLAY_BUILD_ADD_COUNT               = 9
REAL_EXECUTION_RECORD_COUNT          = 10
REAL_BUY_RECORD_COUNT                = 6
DECISION_EXECUTION_MATCH_COUNT       = 0
DECISION_WITHOUT_EXECUTION_COUNT     = 9
EXECUTION_WITHOUT_DECISION_COUNT     = 10
COOLDOWN_REAL_PATH_EXERCISABLE       = false
COOLDOWN_SYNTHETIC_ONLY              = true
```

**读法**：
- replay 产生 **9** 次加仓类动作；真实执行账本有 **10** 条（6 buy + 4 sell）
- 二者**匹配数 = 0** ⇒ `DECISION_WITHOUT_EXECUTION_COUNT = 9`、`EXECUTION_WITHOUT_DECISION_COUNT = 10`
- ⇒ **cooldown 的真实路径在当前规范输入包内不可行使** ⇒ `COOLDOWN_SYNTHETIC_ONLY = true`

---

## 6. Replay Fidelity Classification

### 6.1 RPG-002 定级 `[INFER]`

```
RPG002-B
PRODUCTION_FAITHFUL_REPLAY_REQUIRES_EXECUTION_DATA
```

**理由**：
1. **语义已 RESOLVED** —— `DECISION ≠ EXECUTION` 由代码 + 真实数据**双证**（§2）；
2. **保真不可得（当前）** —— 规范输入包内无执行账本（§4）；
3. **但数据可得** —— 生产库中存在 `trade_log`，且已有一份仓外导出证明其可被导出
   ⇒ 一旦提供**受治理的执行数据导出**，production-faithful cooldown 即可实现
   ⇒ 属 **B**（requires execution data），⛔ 不是 **C**（only synthetic）。

### 6.2 三个候选定级的对照

| 定级 | 判据 | 是否命中 |
|---|---|---|
| **RPG002-A** `PRODUCTION_FAITHFUL_REPLAY_AVAILABLE` | 现有输入即可复现 | ❌ 不命中（输入包无执行账本） |
| **RPG002-B** `…REQUIRES_EXECUTION_DATA` | 需补执行数据，但数据可得 | ✅ **命中** |
| **RPG002-C** `ONLY_SYNTHETIC_BRANCH_COVERAGE_AVAILABLE` | 无论如何只能合成 | ❌ 不命中（数据可得） |

### 6.3 ★ `RPG-003_CANDIDATE`（本轮新发现，须 owner 复核）`[AS-IS]` + `[INFER]`

| 项 | 内容 |
|---|---|
| **名称** | `replay_position_book = DECISION_IMPLIES_EXECUTION` |
| **证据** | `v364-replay-harness.js:338-340`（账面推进用 `res.suggested_position`） |
| **性质** | V1 的持仓轨迹假设「建议必被执行」；生产为 Model B ⇒ **系统性偏离** |
| **覆盖面** | ⚠️ **大于 RPG-002** —— 它影响 `tech_position` / `cash_ratio` / `sectorUsed` ⇒ **全部** portfolio 输入与 `sectorRemainingLimit`，**每一天** |
| **与 §3 裁定的关系** | §3 已裁定「cooldown 只能读 execution timeline」⇒ 同一原则**应当**也适用于账面 ⇒ **V1 账面与该裁定冲突** |
| **建议** | 立为 **RPG-003**，与 RPG-002 **同批**处理（二者同源于 Model A/B 混淆） |
| ⛔ | 本探针**只登记**，不裁定；且 **RPG-D5 的"未发现 RPG-003"结论需据此复核** |

---

## 7. Anchor Consequence

因 **RPG-002 = B**（§6.1），RFP-V2 的 `coverage_manifest` **必须**明确：

```json
{
  "cooldown": {
    "production_fidelity": "NOT_AVAILABLE",
    "synthetic_branch_coverage": true,
    "reason": "RPG002-B：规范 replay 输入包内无执行账本（trade_log）；执行数据存在于生产库、需受治理导出",
    "blocking": "RPG-F2（V2 cooldown 仅可作 synthetic branch）"
  },
  "effective_tech_cap": {
    "production_fidelity": "VERIFIED",
    "evidence": "outputs/v365-rpg001-probe.json（25/25 天 discount=0.97；7 处 sector_cap 绑定）"
  },
  "replay_position_book": {
    "production_fidelity": "NOT_AVAILABLE",
    "reason": "RPG-003_CANDIDATE（harness 账面使用 Model A）"
  }
}
```

⛔ **不得写** `cooldown = production-faithful`。
⛔ **不得**把 synthetic branch coverage 计入 production-fidelity anchor。

---

## 8. RPG-D4 更新条件（本轮扩充）

V2 替代 V1 成为 qualification authoritative replay，**至少**须同时满足：

```
1. V2 anchor frozen
2. V1_V2_DELTA_EXPLAINED = true
3. UNEXPECTED_DECISION_DELTA = 0
4. RPG-001 production fidelity = VERIFIED          ← 本轮已可满足（§1.2）
5. RPG-002 execution semantics = RESOLVED          ← 语义已 RESOLVED（§2），
                                                     但**保真**为 NOT_AVAILABLE（§6.1）
                                                      ⚠️ 二者须区分，见下
6. owner explicit approval
```

⚠️ **本轮对条件 5 的精确化建议** `[HUMAN]`：
条件 5 应拆为两条 ——
```
5a. RPG-002 execution semantics = RESOLVED（✅ 已满足：DECISION ≠ EXECUTION 已证实）
5b. RPG-002 production fidelity = AVAILABLE 或 显式接受 NOT_AVAILABLE + synthetic 标注
```
否则会出现"语义已查清"被误读成"保真已具备"。

---

## 9. 本轮交付 `[AS-IS]`

| 类型 | 路径 |
|---|---|
| 探针脚本 | `scripts/v365-rpg001-tech-cap-probe.js` |
| 探针脚本 | `scripts/v365-rpg002-execution-semantics-probe.js` |
| 证据文档 | `docs/V365_RPG_F1_PROBE_EVIDENCE.md`（本文件） |
| 证据 JSON | `outputs/v365-rpg001-probe.json`（gitignored） |
| 证据 JSON | `outputs/v365-rpg002-probe.json`（gitignored） |

---

## 10. 停止条件核查 `[AS-IS]`

§10 要求进入 RPG-F2 前必须回答清楚两问：

| 问题 | 答案 | 依据 |
|---|---|---|
| **`BUILD/ADD` 是否等于实际执行？** | ❌ **不等于**（`DECISION ≠ EXECUTION`） | §2 Q2（决策路径零写入方）+ 真实数据 `decision_id` 全空 |
| **V2 cooldown ledger 应模拟 decision 还是 execution？** | **execution**（Model B） | §3 裁定 |

⇒ **两问均已回答** ⇒ 形式上满足进入 RPG-F2 的前置条件。
⚠️ **但**：RPG-002 的**保真**不可得（§6.1 = B），且新发现 **RPG-003 候选**（§6.3）
⇒ **[HUMAN] 建议**：在 RPG-003 候选获裁定**之前**，⛔ 不进入 RPG-F2 —— 否则 V2 会**同时**固化了两个 Model A/B 混淆。

**本轮已停止，未进入 RPG-F2。**

---

## 11. 边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| `v364-replay-harness.js` | **零修改** |
| production calculation（`correlation.js` / `cooldown.js` / `decision*.js` …） | **零修改** |
| RDE | **零修改** |
| parity gate / qualification gate | **零修改** |
| 现有 V1 anchor | **未改**（`25ccbfc7…1723`） |
| schema / collection | **零修改** |
| HD12-2 / HD12-3 / RH1 | **未进入** |
| deploy / commit / push / PR / merge | **均未发生** |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| 生产侧 | CloudBase `ModTime` 仍 **UNVERIFIED**（本会话无该连接器） |

---

## 附：探针可复现命令

```bash
node scripts/v365-rpg001-tech-cap-probe.js --out outputs/v365-rpg001-probe.json
node scripts/v365-rpg002-execution-semantics-probe.js --out outputs/v365-rpg002-probe.json
# 指定其他执行账本导出：
node scripts/v365-rpg002-execution-semantics-probe.js --dump <trade_log.ndjson> --out <path>
```
