# V365 Replay Fidelity Repair Design

> **性质**：只读分析 + 设计（design-only）。⛔ **未改 replay harness / 任何 production calculation / RDE / 两个 gate / schema / collection**。
> **生成**：2026-09-28（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **前置**：`HD12-0`（依赖分类审计）· `HD12-1`（单一来源）· `HD12-1.1`（受保护域收口）
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
>
> **证据规则**：`[AS-IS]` = 实测；`[PROBE]` = 只读探针实测（不改文件）；`[DESIGN]` = 提议；`[HUMAN]` = 须人工确认。

---

## 0. 摘要

| # | 发现 | 性质 |
|---|---|---|
| **E1** | ★ **`effective_tech_cap` 保真缺口是实质性的**：replay 窗口 **25/25 个交易日** discount 均为 **0.97** ⇒ 生产路径应得 `effective_cap = 63.1`，而 V1 用 fallback **65** | `[PROBE]` |
| **E2** | ★ 该 1.9pp 差异**落在绑定路径上**：replay 中 `binding_constraint = sector_cap` 出现 **7 次**（全部在 `159582` 科技票）⇒ 缺口**不是无害的** | `[PROBE]` |
| **E3** | ★ **`cooldown` 缺口可被真实行使**：replay 窗口产生 **9 次加仓类动作**（BUILD 5 / ADD 4）⇒ 无需人造常量即可触发 cooldown > 0 | `[PROBE]` |
| **E4** | `cooldown.js` 的 IO **完全可注入**（3 个 `db.query` 点）⇒ V2 可**复用同一函数**，只需桩化 db | `[AS-IS]` |
| **E5** | `cash_ratio` / `portfolio mode` / `Gen-1 authority` **三项已覆盖或等价**（逐项证据见 §7） | `[AS-IS]` + `[PROBE]` |
| **E6** | ⇒ **未发现 RPG-003**（唯一候选"Gen-1 overlay 未入 replay"经证为**按构造 no-op**） | `[AS-IS]` |

⇒ **结论：RPG-001 / RPG-002 是真实的、可量化的、可修的保真缺口；V2 必须独立建立 anchor。**

---

## 1. 目标

设计 **Replay Fidelity Protocol（RFP）**：让 replay 对生产决策路径具有更高保真度，
同时**不把"修改证据生成器"误判成"生产决策回归"**。

**核心机制 = 协议版本化**：
```
同一协议 + 同一输入 + 生产代码变了 + 输出变了   ⇒  UNEXPECTED_DECISION_DELTA（回归）
不同协议（V1→V2）+ 同一生产代码 + 输出变了       ⇒  需要逐项归因，⛔ 不得直接判回归
```

---

## 2. RPG-001 — `effective_tech_cap`

### 2.1 完整数据流 `[AS-IS]`

```
① 输入
   baseCap  ← RDE:670  merged.tech_sector_max ?? DEFAULT_PARAMS.tech_sector_max   （配置）
   barsMap  ← RDE:684  loadBarsCache(etfs)（RDE:277-291）
                = 每只 ETF 的 ETF_DAILY 最近 80 条，按 trade_date **升序**
   ↓
② 纯函数（correlation.js:338-346）
   effectiveTechCap(baseCap, barsMap):
     base = baseCap ?? 65
     corr = computeTechCorrelation(barsMap)          // :232-316
     return { ...corr, base_cap: base,
              effective_cap: Math.round(base * corr.discount * 10) / 10 }
   ↓
   computeTechCorrelation(barsMap, pairs = TECH_CORR_PAIRS)   // :29-33
     pairs = [(513310,159582), (513310,515880), (159582,515880)]
     窗口 = DEFAULT_WINDOW 60 · MIN_OBSERVATIONS 10（:35-37）
     每对：alignReturnSeries(barsMap[a], barsMap[b], 60)  → 按 trade_date **INNER JOIN**
           （额外要求 prev_trade_date 一致，否则丢弃并计入 dropped_misaligned）
           → 观测 < 10 ⇒ 该对 insufficient（rho = null，⛔ 不硬算）
     全部对都不足 ⇒ 直接返回 discount = 1.0（:284-297）
   ↓
   correlationDiscount(rhoAvg, rhoMax)               // :209-224
     rhoAvg >= 0.85 ⇒ discount = min(d, 0.77)
     rhoAvg >= 0.75 ⇒ discount = min(d, 0.92)
     rhoAvg >= 0.65 ⇒ discount = min(d, 0.97)
     rhoMax >  0.90 ⇒ discount = min(d, 0.92)
     默认 1.0
   ↓
③ RDE 接线（RDE:685-688）
   techCapInfo = effectiveTechCap(techMax, barsCache)
   portfolio.effective_tech_cap  = techCapInfo.effective_cap
   portfolio.correlation_discount = techCapInfo.discount
   portfolio.tech_correlation     = techCapInfo
   ↓
④ 消费（两处）
   RDE:707  effectiveTechMax = portfolio.effective_tech_cap ?? techMax
   RDE:791-794  sectorRemainingLimit = max(0, effectiveTechMax - (sectorUsed - current))
   RDE:822  → runDecision(..., { portfolio, sectorRemainingLimit, ... })
   decision-v3.js:539-543
     techMax = portfolio.effective_tech_cap != null
               ? portfolio.effective_tech_cap
               : (params.tech_sector_max ?? DEFAULT_PARAMS.tech_sector_max)   ← ★ fallback
     sectorCap = ctx.sectorRemainingLimit != null
               ? max(0, ctx.sectorRemainingLimit)
               : max(0, techMax - (techPos - current))
   ↓
⑤ target / action
   decision-v3.js:574/676  sectorCap → computePositionTargets / applyPositionConstraints
   → final_target；:640/:716 binding_constraint（'sector_cap' 即此约束）
```

### 2.2 七问逐答

**Q1 · `effective_tech_cap` 的生产计算输入来自哪里**
- `baseCap` ← `merged.tech_sector_max`（`param_config`）⇒ 缺省 `DEFAULT_PARAMS.tech_sector_max`（`constants.js:175` 区）
- `barsMap` ← `ETF_DAILY` 每标的最近 **80** 条（RDE:277-291），实际参与计算的只有 `TECH_CORR_PAIRS` 的 **3 只**（513310 / 159582 / 515880）

**Q2 · 由哪个函数产生**
`src/common/utils/correlation.js::effectiveTechCap()`（`:338-346`）；
内部 `computeTechCorrelation()`（`:232-316`）+ `correlationDiscount()`（`:209-224`）。

**Q3 · 哪些配置 / 市场条件会改变它**
| 类别 | 条件 | 影响 |
|---|---|---|
| 配置 | `tech_sector_max` 变化 | 线性缩放 `effective_cap` |
| 市场 | 三对科技票 **60 日共同交易日**日收益的 Pearson ρ | 触发分档 ⇒ discount < 1 |
| 数据完整性 | 某对 `aligned_observations < 10` | 该对不参与 ⇒ 可能降低 rhoAvg（或全不足 ⇒ discount=1.0） |
| 数据错位 | `prev_trade_date` 不一致的观测被丢弃 | 影响 ρ（V3.6.1 R1 缺陷 #4 的修复点） |

**Q4 · 默认 / 正常情况下是否经常等于原始 tech cap**
**是。** `discount = 1.0` ⟺ `rhoAvg < 0.65` **且** `rhoMax <= 0.90`。
⇒ 只有科技票**中高相关**时才偏离。⚠️ 但见 E1：**replay 窗口恰好全程偏离**。

**Q5 · 什么条件下 correlation discount 真正生效**
`rhoAvg >= 0.65`（→0.97）· `>= 0.75`（→0.92）· `>= 0.85`（→0.77）· 或 `rhoMax > 0.90`（→≤0.92）。
`[PROBE]` 实测：replay 窗口 25/25 天落在 **0.97 档**（`rhoAvg` 0.663–0.735）。

**Q6 · replay 当前为什么必然走 fallback** `[AS-IS]`
`v364-replay-harness.js::buildPortfolio()`（`:199-228`）返回对象**不含** `effective_tech_cap`
⇒ `decision-v3.js:539` 的 `!= null` 为 **false** ⇒ 走 `params.tech_sector_max` 分支（= `PROD_PARAMS.tech_sector_max`）。
且 `harness` 全文件对 `correlation` / `effective_tech_cap` / `discount` **零命中**
⇒ 它**从不调用** `correlation.js`。

**Q7 · 如何在 replay 中复现生产路径（⛔ 不塞常量）** `[DESIGN]`
harness **已导出 `loadBars`**（`:458-470`），且 `barsByCode` 含全部 3 只科技票 ⇒ V2 可直接：

```js
// [DESIGN] 伪代码 —— 复用生产**同一纯函数**，零常量
const corr = require('../../src/common/utils/correlation.js');
// 在每日 d 的 runDecision 之前：
const barsAsOfD = {};
for (const c of ['513310','159582','515880']) {
  barsAsOfD[c] = barsByCode[c].filter((b) => b.trade_date <= d);   // ⛔ 无前视
}
const techCapInfo = corr.effectiveTechCap(PROD_PARAMS.tech_sector_max, barsAsOfD);
portfolio.effective_tech_cap  = techCapInfo.effective_cap;
portfolio.correlation_discount = techCapInfo.discount;
// 并让 sectorRemainingLimit 使用 effectiveTechMax（与 RDE:707 同式）
```
⚠️ **as-of-date 切片是正确选择**：生产在时刻 `d` 用的就是"当时可见的 bars"；
用"今天的 bars" 会引入**前视偏差**（lookahead），反而不保真。

---

## 3. RPG-002 — `cooldown`

### 3.1 完整数据流 `[AS-IS]`

```
① 生产输入（3 个 IO 点，全部可注入）
   db.query(TRADE_LOG,   { code, action:'buy' }, orderBy trade_date desc, limit 1)   // cooldown.js:42
   db.query(DECISION_RESULT, { code, decision_date: buyDate }, limit 1)             // :25（取 add_mode）
   db.query(ETF_DAILY,   { code }, orderBy trade_date asc)                          // :53（数交易日）
   + params.cooldown_days / DEFAULT_PARAMS.cooldown_days / COOLDOWN_DAYS             // :49-50
   ↓
② 纯函数（cooldown.js:41-66）
   computeCooldownDays(db, code, today, params = {}, fallbackAddMode = '无') → number ≥ 0
     rows = TRADE_LOG 最近一次 buy；无 ⇒ 返回 0
     addMode = resolveLastBuyAddMode(...)      // trade_log.add_mode ?? 当日决策 add_mode ?? fallback
     cooldownDays = addMode === '突破加仓' ? 5
                  : addMode !== '无'      ? 2
                  : params.cooldown_days ?? DEFAULT_PARAMS.cooldown_days ?? COOLDOWN_DAYS
     交易日计数 = ETF_DAILY 中 lastBuy < trade_date <= today 的**去重日数**
     返回 max(0, cooldownDays - 交易日数)
   ↓
③ 闸门（decision.js:467-468）
   cooldownDays = ctx.cooldownDays ?? 0
   cooldownCheck = cooldownDays > 0 ? 'pause' : 'ok'          ← 注释自述「硬规则：cooldown>0 禁止新增」
   ↓
④ 汇入（decision.js:473）
   items = { trend, structure, volume, fund, chase, limit, sector, risk, cooldown: cooldownCheck, regime }
   overall = 'forbid' 优先，否则 'pause'
   ↓
⑤ 生效（decision-v3.js:908-913 → :1234 → :1008）
   ctx.eligibilityOverall = eligibility.overall
   if (eligibilityOverall === 'allow') return current <= 0 ? 'BUILD' : 'ADD'
   ⇒ pause ⇒ **不返回 BUILD/ADD** ⇒ final_action 被降级
```

### 3.2 六问逐答

**Q1 · cooldown 的生产输入来自哪些历史数据**
`TRADE_LOG`（该标的最近一次 `action='buy'` 的 `trade_date` 与 `add_mode`）
+ `ETF_DAILY`（用于把"自然日差"换算成"交易日差"）
+ 参数 `cooldown_days`。

**Q2 · `computeCooldownDays()` 的输入 / 输出契约** `[AS-IS]`
```
输入：db（含 query）· code · today（YYYY-MM-DD）· params（含 cooldown_days）· fallbackAddMode
输出：number ≥ 0（剩余冷静**交易**日数）
副作用：无（只读 db）
纯度：**依赖注入式 IO** —— db 由调用方传入 ⇒ **可被桩化复用**（这是 V2 可行的关键）
```
`addMode` 决定基数：`突破加仓` → 5 日；其它非 `无` → 2 日；`无` → 参数值。

**Q3 · cooldown 什么条件下 > 0**
存在 `TRADE_LOG` 的 buy 记录，且 `today` 距该买入日的**交易日数 < 基数**。

**Q4 · 当前 replay 为什么始终 = 0** `[AS-IS]`
两重原因：
1. `v364-replay-harness.js:284` **硬编码 `cooldownDays: 0`** ⇒ 闸门恒 `ok`；
2. `cooldown.js` **不在 replay 依赖集** ⇒ 该模块在 Δ=0 中**从未被加载**。

**Q5 · 哪些历史样本可以真实触发 cooldown** `[PROBE]`
replay 窗口（2026-08-03 → 2026-09-04）内 `final_action` 分布：
```
WAIT 44 · HOLD 69 · BUILD 5 · ADD 4 · TACTICAL_REDUCE 2 · STRATEGIC_REDUCE 1
```
⇒ **9 次加仓类动作**（BUILD 5 + ADD 4）：
```
2026-08-03 515880 BUILD  ｜ 2026-08-05 159582 BUILD ｜ 2026-08-05 513310 BUILD
2026-08-07 159582 ADD    ｜ 2026-08-10 159582 ADD   ｜ 2026-08-18 513310 ADD
2026-08-21 159582 BUILD  ｜ 2026-08-21 518880 BUILD ｜ 2026-08-28 159582 ADD
```
⇒ 这些正是**会产生买入、从而触发冷静期**的样本 ⇒ **cooldown > 0 可被真实行使**。

**Q6 · 如何让 replay 同时包含 cooldown = 0 与 > 0 两条真实路径** `[DESIGN]`
```
[DESIGN] 伪代码 —— 复用生产**同一函数** + 桩化 db
const { computeCooldownDays } = require('../../src/common/utils/cooldown.js');
// V2 harness 维护自己的「模拟成交账本」：每次 final_action ∈ {BUILD, ADD} 且仓位真变化 ⇒ 追加一条
//   { code, action:'buy', trade_date: d, add_mode: <由决策的 addMode 推导> }
const stubDb = {
  query: async (coll, filter, opts) => {
    if (coll === COLLECTIONS.TRADE_LOG)     return lastBuyRow(ledger, filter.code);   // 按 trade_date desc
    if (coll === COLLECTIONS.ETF_DAILY)     return barsByCode[filter.code].filter(b => b.trade_date <= d);
    if (coll === COLLECTIONS.DECISION_RESULT) return [];                              // add_mode 走 fallback
    return [];
  }
};
const cd = await computeCooldownDays(stubDb, code, d, PROD_PARAMS, addMode);
// ⇒ 传入 runDecision 的 cooldownDays = cd（真实值，非常量）
```
⛔ **禁止** `cooldownDays = 1` 之类的写死值。
⚠️ 若仅需验证"闸门本身可被行使"（而非生产保真），才可另立 **synthetic branch test**，
且必须与 production-fidelity replay **分开标注**（本设计建议在 coverage manifest 中用 `synthetic: true` 区分）。

---

## 4. Replay Protocol Versioning

### 4.1 现状 `[AS-IS]`

```
REPLAY_PROTOCOL = V1
anchor = 25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723
coverage = TrendStage ✓ · MarketRegime ✓ · effective_tech_cap ✗(fallback) · cooldown ✗(forced 0)
```

### 4.2 硬规则 `[DESIGN]`

⛔ **不得修改 V1 后继续声称 `anchor unchanged`。**

```
REPLAY_PROTOCOL = V1   —— 保留，**只作为历史资格证据**；⛔ 不重写旧 anchor
REPLAY_PROTOCOL = V2   —— 新增 production-faithful 路径；**建立新 anchor**

V1 anchor ≠ V2 anchor    ⇒  ⛔ **不自动意味着 production decision regression**
```

**判据（只有这一种组合可判回归）**：
```
same protocol  ∧  same input  ∧  production code changed  ∧  output changed   ⇒ UNEXPECTED_DECISION_DELTA
```

### 4.3 协议版本化清单 `[DESIGN]`

| 项 | V1 | V2 |
|---|---|---|
| `effective_tech_cap` | fallback（`tech_sector_max`） | **生产纯函数**（`correlation.js::effectiveTechCap`，as-of-date bars） |
| `cooldownDays` | 硬编码 `0` | **生产纯函数**（`cooldown.js::computeCooldownDays` + 桩 db + 模拟成交账本） |
| `cash_ratio` | 同式内联 | 建议改为**调用** `portfolio-cash.js::computeCashDiagnostics`（同式复用） |
| 其他路径 | 不变 | 不变 |
| anchor | `25ccbfc7…1723`（保留） | **待建立**（见 §8） |

---

## 5. Dual Replay Transition

### 5.1 是否采用双跑 `[REC]` **建议采用（过渡期）**

| 协议 | 回答的问题 |
|---|---|
| **V1** | 旧资格证据是否**仍可复现**（`V1_REPRODUCIBLE`） |
| **V2** | 新的高保真 production behavior 是什么（`V2_BASELINE_ESTABLISHED`） |

### 5.2 三个状态量 `[DESIGN]`

```
V1_REPRODUCIBLE          = V1 在当前代码下重跑，anchor == 25ccbfc7…1723
V2_BASELINE_ESTABLISHED  = V2 anchor 首次确立并冻结
V1_V2_DELTA_EXPLAINED    = 每一处 V1→V2 差异都已归因（见 §6），无 UNEXPECTED
```

⛔ **不得要求** `V1_OUTPUT == V2_OUTPUT`。
✅ **必须解释**每一个 V1→V2 差异来自：
`effective_tech_cap fidelity` / `cooldown fidelity` / **`unexpected source`**。

### 5.3 过渡期的资格语义 `[DESIGN]`

| 阶段 | qualification authoritative replay |
|---|---|
| 过渡期（V1 与 V2 并存） | **V1**（保持现状；V2 只作对照） |
| V2 通过 `V1_V2_DELTA_EXPLAINED` 且获 owner 批准后 | **V2**（见 RPG-D4） |

---

## 6. Delta Attribution

### 6.1 二分 `[DESIGN]`

```
EXPECTED_FIDELITY_DELTA      —— **能证明**由 RPG-001 / RPG-002 新覆盖路径造成
UNEXPECTED_DECISION_DELTA    —— 其余**全部**（默认 fail-closed）
```

⛔ **默认 fail-closed**：无法归因 ⇒ 归 `UNEXPECTED`。

### 6.2 机器可读输出 `[DESIGN]`

```json
{
  "protocol": { "from": "V1", "to": "V2" },
  "v1_anchor": "25ccbfc7…1723",
  "v2_anchor": "<pending>",
  "generated_at": "…",
  "summary": { "total_days": 25, "changed": 0, "expected": 0, "unexpected": 0 },
  "deltas": [
    {
      "date": "2026-08-11",
      "code": "159582",
      "field": "final_target",
      "v1_value": 24,
      "v2_value": 22.1,
      "binding_constraint": "sector_cap",
      "reason": "effective_tech_cap_fidelity",
      "evidence": {
        "v1_effective_tech_cap": 65,
        "v2_effective_tech_cap": 63.1,
        "v2_discount": 0.97,
        "rpg": "RPG-001"
      },
      "classification": "EXPECTED_FIDELITY_DELTA"
    },
    {
      "date": "2026-08-07",
      "code": "159582",
      "field": "final_action",
      "v1_value": "ADD",
      "v2_value": "HOLD",
      "reason": "cooldown_gate_exercised",
      "evidence": { "v1_cooldown_days": 0, "v2_cooldown_days": 2, "last_buy": "2026-08-05", "rpg": "RPG-002" },
      "classification": "EXPECTED_FIDELITY_DELTA"
    }
  ],
  "unexpected": [
    {
      "date": "…", "code": "…", "field": "final_action",
      "v1_value": "…", "v2_value": "…",
      "reason": "unattributed",
      "classification": "UNEXPECTED_DECISION_DELTA"
    }
  ]
}
```

### 6.3 归因判据（可机器判定） `[DESIGN]`

| `reason` | 允许的 `classification` | 机器判据 |
|---|---|---|
| `effective_tech_cap_fidelity` | EXPECTED | 该 (date, code) 的 V2 `effective_tech_cap` ≠ V1 的 fallback 值 **且** `binding_constraint == 'sector_cap'` |
| `cooldown_gate_exercised` | EXPECTED | V2 `cooldown_days > 0` **且** V1 `cooldown_days == 0` |
| 其它 | **UNEXPECTED** | — |

⚠️ 归因必须**逐条附证据**；⛔ 不得用"大概是因为 RPG-00x"批量放行。

---

## 7. Fidelity Coverage Matrix

| Production input/path | V1 | V2 target | 证据 |
|---|---|---|---|
| **TrendStage** | covered | covered | 在 replay 依赖集内；harness 直载 `trend-stage` |
| **MarketRegime** | covered | covered | harness 直载 `market-regime.js:31` |
| **effective_tech_cap** | ⛔ **missing / fallback** | **production-faithful** | §2；`[PROBE]` 25/25 天 discount 0.97 |
| **cooldown gate** | ⛔ **forced 0** | **exercised** | §3；`[PROBE]` 9 次加仓动作 |
| **cash_ratio** | ✅ **covered（同式）** | 建议改为**同函数复用** | `computeCashDiagnostics`（`portfolio-cash.js`）与 harness `:213-222` **公式逐项等价**（`raw = 100−tp`；`clamped = max(0,raw)`；`excess`；`overbooked`）⇒ 数值一致，但**是重复实现**（非复用） |
| **portfolio mode** | ✅ **covered（等价）** | 保持不变 | `shouldUseV35`（`decision-v3.js:420-428`）在 replay 与生产**都**因 `portfolio` 缺 `multi_etf`/`etf_count` ⇒ `isV3PortfolioMode` 恒 `false`（`:75-82`）⇒ 两边同分支。⚠️ **但"等价"的根因是生产自身的已知缺陷 #3**（RDE 注释自述"summary 上**没有** multi_etf / etf_count —— 这正是缺陷 #3 的事实本身"）⇒ **replay 忠实地复现了一个退化行为**。⛔ 这不是保真缺口，但**应登记为观察项** |
| **Gen-1 authority** | ✅ **covered（按构造 no-op）** | 保持不变 | `gen1-overlay.js::applyGen1Overlay` **先冻结再强制还原** `final_target`/`final_action`（`PRODUCTION_FIELDS`，`:18`），并有 `verifyProductionNoop`（`:141-148`）⇒ 对**所有**档位（含 GUARDED_EFFECTIVE）生产字段 no-op ⇒ replay 不注入它**不构成** final_target/action 缺口 |

### 7.1 RPG-003+ 搜索结论 `[AS-IS]`

| 候选 | 判定 |
|---|---|
| Gen-1 overlay 未入 replay | ❌ **不是**（按构造 no-op，见上） |
| `portfolio-cash` 未复用（同式重复） | ❌ **不是**（数值等价；但建议 V2 改为复用，属**清理**非**修复**） |
| `portfolio mode` 退化 | ❌ **不是**（replay == 生产）；⚠️ 登记为**观察项 OBS-A** |
| `gen1-canary` / `portfolio-mode` 未入 replay | ❌ **不是**（二者已分类为 ORCH；不参与 target/action） |

⇒ **未发现 RPG-003**。**RPG-001 / RPG-002 是当前已知的全部保真缺口。**

---

## 8. Anchor Governance

### 8.1 现状缺陷 `[AS-IS]`

当前 anchor = **裸 `result_sequence_sha`**（`parity:179` 的 `s1`）⇒ 无法回答
"这个 SHA 是用哪个协议、哪份输入、哪版代码、哪个 harness 算出来的"。

### 8.2 新规则 `[DESIGN]`

一个 replay anchor **必须至少绑定六项**：

```
{
  "protocol_version":        "RFP-V2",
  "input_dataset_hash":      "<deliverables/etf_daily_ml_pool 的清单哈希>",
  "production_code_sha":     "<参与决策的 src/common/** 内容哈希（按分类源过滤）>",
  "replay_harness_sha":      "<scripts/lib/v364-replay-harness.js 的 sha256>",
  "result_sequence_sha":     "<决策序列 sha256（现有 s1）>",
  "coverage_manifest_sha":   "<覆盖声明 + 已知缺口清单的哈希>"
}
```

**要点**：
- `coverage_manifest_sha` 绑定 **§7 矩阵 + §REPLAY_COVERAGE_GAPS** ⇒ **缺口随 anchor 一起被冻结**
- ⛔ 不得再只记一个裸 SHA
- `production_code_sha` 建议按 **分类源**（`v365-decision-classification.js`）过滤后计算 ⇒ 只覆盖真正影响决策的文件
- 新增/修改 anchor **必须走 §9 的 REPLAY_INFRA 流程**

---

## 9. Replay Infrastructure Protection

### 9.1 定性 `[AS-IS]`

`scripts/lib/v364-replay-harness.js` 已登记为 **`REPLAY_INFRASTRUCTURE`**（HD12-D6 第三桶）
⇒ 改动它**不得**走普通 ORCH authorization。

### 9.2 流程 `[DESIGN]`

```
REPLAY_INFRA_CHANGE
  ↓
① explicit human approval      （owner 逐位绑定 40 位 SHA 的显式授权）
  ↓
② old protocol reproducibility check   —— V1 在**旧 harness** 下仍复现旧 anchor
  ↓
③ new protocol validation              —— V2 跑通 + coverage manifest 完整 + Δ 归因完成
  ↓
④ new anchor establishment             —— 按 §8 六项绑定建立
  ↓
⑤ qualification documents update       —— 更新资格文档；⛔ 不重写历史 evidence
```

**标记常量**：`REPLAY_INFRA_REVIEW_MARKER = 'REPLAY_INFRA_CHANGE_REVIEW_REQUIRED'`（已在分类源中）

⛔ 任何跳过 ① 的 harness 改动 ⇒ 视为**未授权编排改动**（见 HD12 §R-2）。

---

## 10. Implementation Plan（只设计，不执行）

| WP | 范围 | 修改文件 | 改变 evidence semantics？ | 需重新 qualification？ | 生成新 anchor？ | Rollback |
|---|---|---|---|---|---|---|
| **RPG-F1** | **Production-path parity probes** | 新增只读探针脚本（`scripts/`，⛔ 不改 harness） | ❌ 否 | ❌ 否 | ❌ 否 | 删除脚本 |
| **RPG-F2** | **Replay Protocol V2 实现** | `scripts/lib/v364-replay-harness.js`（**REPLAY_INFRA** ⇒ 走 §9 流程） | ✅ **是**（新增两条生产路径） | ⚠️ 视实现方式：若只新增 V2 入口而不改 V1 默认 ⇒ 否；若替换 ⇒ 是 | ✅ **是**（V2 anchor） | 保留 V1 入口 ⇒ 回滚 = 切回 V1 |
| **RPG-F3** | **Dual replay + delta attribution** | 新增 `scripts/v365-replay-delta-attribution.js` + 归因 schema | ✅ 是（新增归因产物） | ❌ 否 | ❌ 否 | 删除脚本 |
| **RPG-F4** | **V2 baseline establishment** | 新增 anchor 文件（六项绑定） | ✅ 是（新 baseline） | ✅ **是** | ✅ **是** | 弃用 V2 anchor，回到 V1 |
| **RPG-F5** | **Qualification integration** | `scripts/v365-p12-decision-parity.js`（读协议版本 + 六项 anchor） | ✅ 是 | ✅ **是** | ⚠️ 若 parity 的判据从"裸 SHA"改为"六项" ⇒ 会改变门禁输出 | 还原 parity |

**依赖顺序**：`RPG-F1 → RPG-F2 → RPG-F3 → RPG-F4 → RPG-F5`
**关键约束**：RPG-F2 **必须**保留 V1 入口（否则 §5 的双跑不可能）。

---

## 11. Human Decisions

| # | 问题 | 本设计建议 | 影响 |
|---|---|---|---|
| **RPG-D1** | 是否采用 **Replay Protocol V2**，而不是原地修改 V1？ | ✅ 采用 V2（原地改会让旧 anchor 与旧资格证据**同时失效且不可追溯**） | 决定 §4 的全部机制 |
| **RPG-D2** | 是否保留 **V1 双跑过渡期**？ | ✅ 保留（V1 回答"旧证据是否仍可复现"，是回归判据的**唯一基准**） | 决定 §5；不保留 ⇒ 失去"same protocol"对照 |
| **RPG-D3** | `EXPECTED_FIDELITY_DELTA` 的**允许判据**？ | ✅ 仅接受 §6.3 两条（`effective_tech_cap_fidelity` / `cooldown_gate_exercised`），且**逐条附证据**；其余一律 `UNEXPECTED` | 决定归因的可信度 |
| **RPG-D4** | 何时允许 **V2 替代 V1** 成为 qualification authoritative replay？ | ⚠️ 建议条件：① V2 anchor 冻结 ② `V1_V2_DELTA_EXPLAINED` 全部完成 ③ 无 `UNEXPECTED` ④ owner 显式批准 | 决定资格基准的切换时点 |
| **RPG-D5** | 是否发现 **RPG-003+**？ | ❌ **未发现**（§7.1 逐项排除）。⚠️ 但登记两个**非缺口观察项**：<br>· **OBS-A** `portfolio mode` 在 replay 与生产**同走退化分支**（根因 = 生产缺陷 #3，缺 `multi_etf`/`etf_count`）<br>· **OBS-B** `cash_ratio` 为**同式重复实现**而非同函数复用（数值等价，建议 V2 顺手改为复用） | 决定是否另立工作包 |

---

## 12. 边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| replay harness | **零修改** |
| production calculation（`decision.js` / `decision-v3.js` / `correlation.js` / `cooldown.js` …） | **零修改** |
| RDE | **零修改** |
| parity gate / qualification gate | **零修改** |
| schema / collection | **零修改** |
| 现有 anchor | **未改**（`25ccbfc7…1723` 仍为 V1 唯一 anchor） |
| 历史 qualification evidence | **未重写** |
| HD12-2 / HD12-3 / RH1 | **未进入** |
| deploy / commit / push / PR / merge | **均未发生** |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
| 生产侧 | CloudBase `ModTime` 仍 **UNVERIFIED**（本会话无该连接器） |

---

## 附：本设计的实测探针索引（可复现）

| 事实 | 复现方式 |
|---|---|
| replay 窗口 25 天 discount 全 0.97 | `loadBars()` → 逐日 as-of bars → `correlation.effectiveTechCap(PROD_PARAMS.tech_sector_max, m)` |
| `sector_cap` 绑定 7 次（全在 159582） | `replay(...).days` → 统计 `binding_constraint` |
| 9 次加仓类动作 | `replay(...).days` → 统计 `final_action ∈ {BUILD, ADD}` |
| harness 硬编码 `cooldownDays: 0` | `grep -n "cooldownDays" scripts/lib/v364-replay-harness.js` → `:284` |
| harness 零处提及 correlation | `grep -c "correlation\|effective_tech_cap\|discount" scripts/lib/v364-replay-harness.js` → `0` |
| `cash_ratio` 公式等价 | 对比 `portfolio-cash.js::computeCashDiagnostics` 与 harness `:213-222` |
| portfolio mode 同分支 | `decision-v3.js:75-82` + `:420-428`；harness 无 `multi_etf`/`etf_count` |
| Gen-1 overlay no-op | `gen1-overlay.js:18/141-148` |
