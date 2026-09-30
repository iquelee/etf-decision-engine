# V365 RPG-F2-B Actual Historical Coverage Audit

> **性质**：只读审计 + 状态裁定（`RPG-F2-B` §3 / §7）。
> **生成**：2026-09-29（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
> **授权**：`OWNER_REPLAY_INFRA_AUTHORIZED = true` · `authorization_sha = c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
>
> **标记**：`[AS-IS]` 实测 · `[PROBE]` 只读探针 · `[HUMAN]` 待裁定
> **机器可读产物**：`deliverables/v365-production-history/rpg-f2b-actual-coverage-audit.json`

---

## 0. 核心结论（一句话）

```
DATA_GOVERNED                    = true
DATA_SUFFICIENT_FOR_PROTOCOL     = false      ← ★ 两者必须分开

RPG-F2-B = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-F2-C = BLOCKED_ON_ACTUAL_BOOK_COVERAGE
RFP-V2-PH_FULL_WINDOW_AVAILABLE  = false
RPG-002  = NOT YET CLOSED
```

> **关键区分**：数据**受治理**（来源可信、provenance 完整、hash 可复算）**不等于**数据**足以支撑协议**
> （覆盖协议所需的时间轴）。本轮审计的全部价值即在于把这两件事**分开**判定。

---

## 1. 数据受治理性复核 `[AS-IS]`

| 项 | 值 |
|---|---|
| `export_method` | `cloudbase-node-sdk-readonly` |
| `env_id` | `tradingview-etf-d0fa42yy57cbc11b` |
| `governed_data_gate` | **PASS** |
| `provenance_status` | `GOVERNED_READ_ONLY_EXPORT` |

### 1.1 Hash 独立复算（⛔ 不信任 manifest 记录值）

| 文件 | manifest 记录 | 独立复算 | 结果 |
|---|---|---|---|
| `raw/trade_log.ndjson` | `f7a9de03ea10954c0932801ce0075917d13e02d7eb8388bf91c4409b9bb86e9e` | 同 | ✅ **MATCH** |
| `raw/portfolio_snapshot.ndjson` | `38291bc46be46cf90f615d92891a9f6283fa93d522b7ad35def48eb87217281e` | 同 | ✅ **MATCH** |

⇒ `DATA_GOVERNED = true`

---

## 2. `trade_log` 覆盖审计 `[PROBE]`

### 2.1 owner 要求的五项

| 项 | 值 |
|---|---|
| `actual_min_trade_date` | **2026-08-14** |
| `actual_max_trade_date` | **2026-09-11** |
| `full_collection_count` | **13** |
| `query_filter` | `{}`（无过滤） |
| `pagination_complete` | **true** |

### 2.2 独立复核

| 项 | 值 |
|---|---|
| `manifest_record_count` 一致 | ✅ true |
| BUY / SELL | **7 / 6** |
| `distinct_dates` / `distinct_codes` | 9 / 4（`513310` · `159570` · `159582` · `518880`） |
| `rows_with_add_mode` | **0** |
| `rows_with_decision_id` | **0** |
| `rows_with_position_after` | **8** |
| 排序 | `trade_date asc, code asc, _id asc` |

### 2.3 ⛔ 关键判定：8/1 之前是否存在影响冷静期的最近一次 BUY

```
previous_buy_before_window = null
previous_buy_determination = NO_PREVIOUS_EXECUTION_RECORDS_EXIST_IN_SOURCE
```

**判定前提（三者同时成立才允许如此判定）**：

| 前提 | 值 |
|---|---|
| `export_is_full_collection` | true（`pages = 1`） |
| `query_filter_empty` | true |
| `pagination_complete` | true |

⇒ 结论是「**源中确无更早成交**」，而**不是**「我假定没有」。
（若上述任一前提不成立 ⇒ 只能记 `UNDETERMINED_INCOMPLETE_EXPORT`。）

### 2.4 冷静期可见性

| code | 首次成交 | 判定 |
|---|---|---|
| `513310` | 2026-08-14 | `COOLDOWN_INVISIBLE_IN_WINDOW_UNTIL_FIRST_BUY` |
| `159570` | 2026-08-15 | 同上 |
| `159582` | 2026-08-15 | 同上 |
| `518880` | 2026-08-15 | 同上 |

⇒ 窗口前段（`2026-08-03 → 2026-08-13`）**没有任何 actual 成交**可供冷静期行使。

---

## 3. `add_mode` 生产真实链 `[AS-IS]`

```
① trade_log.add_mode
② decision_result(code, decision_date = buyDate).add_mode
③ fallbackAddMode
```

**受治理实测**：

| 状态 | 行数 |
|---|---|
| `rows_with_add_mode`（非空） | **0** |
| `rows_with_empty_add_mode`（`""`） | 4 |
| `rows_without_field`（无该键） | 9 |

⇒ 第 ② 步是生产真实路径的**必经环节**（不回读 `decision_result` 即无法复现生产语义）。

⛔ **不得**为实际成交补写 `突破加仓` / `普通加仓` / `无`。
⛔ **不得**依据当前 replay 决策猜历史 buy 的 add_mode。

---

## 4. `portfolio_snapshot` 覆盖审计 `[PROBE]`

### 4.1 owner 要求的三项（机器计算）

| 项 | 值 |
|---|---|
| `required_trade_dates` | **25**（replay 轴：`2026-08-03 … 2026-09-22`） |
| `snapshot_available_dates` | **16** |
| `missing_trade_dates` | **9** |

**缺失清单**：

```
2026-08-03  2026-08-04  2026-08-05  2026-08-06  2026-08-07
2026-08-10  2026-08-11  2026-08-12  2026-08-13
```

### 4.2 支持证据

| 项 | 值 |
|---|---|
| `actual_min_snapshot_date` | **2026-08-14** |
| `actual_max_snapshot_date` | 2026-09-29 |
| `full_collection_count` | 40（与 manifest 一致 ✅） |
| `duplicate_date_count` | 0 |
| `query_filter` | `{}` |
| `pagination_complete` | true |
| `t_minus_1_candidate` | **null** ← ⛔ **不存在合法 T-1 starting actual book** |

### 4.3 ⛔ 硬规则（本审计**未**触犯其中任何一条）

| 禁止项 | 履行 |
|---|---|
| 用 `suggested_position` 补 | ✅ 未使用 |
| 用 08-14 snapshot 回推 | ✅ 未使用 |
| 假设之前仓位为 0 | ✅ 未使用 |
| 插值 | ✅ 未使用 |
| 偷偷把 replay window 改成 08-14 起 | ✅ 未改（仍 `2026-08-01 → 2026-09-22`） |

---

## 5. 状态裁定 `[HUMAN]`

### 5.1 RPG-F2-B

```
RPG-F2-B = PARTIAL / BLOCKED_ON_EXECUTION_COVERAGE
RPG-002  = NOT YET CLOSED
```

| 维度 | 结论 |
|---|---|
| **正向**（保真度已证） | `PRODUCTION_PATH_PARITY_VERIFIED_ON_OBSERVED_POINTS`：4/4 可验证点逐值相等 |
| **反向**（覆盖不足） | 窗口前 9 个交易日无 actual execution ⇒ 该段未构成 fidelity 覆盖 |
| 裁定 | ⛔ **不得**记为 `COMPLETE`；⛔ **不得**把 4/4 自动提升为 `FULL_WINDOW_PRODUCTION_FIDELITY` |

**解除条件**（须 owner 裁定，见 §7-A/B/C）：证明 actual-execution cooldown 对**要求窗口**具有充分覆盖。

### 5.2 RPG-F2-C

```
RPG-F2-C = BLOCKED_ON_ACTUAL_BOOK_COVERAGE
```

理由：`missing_trade_dates = 9` 且 `t_minus_1_candidate = null`
⇒ 既无逐日 actual book，也无可判为合法 seed 的 `T-1` starting book。

### 5.3 RFP-V2-PH

```
RFP-V2-PH_FULL_WINDOW_AVAILABLE = false
PH_COVERAGE = PARTIAL
```

允许另建 `RFP-V2-PH-AVAILABLE-WINDOW`（自 `2026-08-14` 起）作为**诊断协议**，
但：

```
qualification_authoritative = false
```

⛔ **不得**替代原 `2026-08-01 → 2026-09-22` qualification protocol。

---

## 6. 本次审计**做了**与**未做** `[AS-IS]`

| ✅ 做了 | ⛔ 未做 |
|---|---|
| hash 独立复算（crypto） | 生产写 / 建表 / deploy |
| 完整 collection / 分页完整性判定 | push / PR / merge / tag |
| `NO_PREVIOUS_EXECUTION_RECORDS_EXIST_IN_SOURCE` 的**有条件**判定 | 任何 data backfill |
| 逐日 required/available/missing 三集合机器计算 | 任何插值 / 回推 / 零仓假设 |
| 生产 `computeCooldownDays` 三步链追溯 | 修改 `constants.js` / `cooldown.js` |
| 4 点生产 parity 对照 | 扩大归因 taxonomy |
| `decision_result` 最小化只读回查（allowlist 扩展 + R-03~R-06 重跑） | 整表导出 `decision_result` |

---

## 7. 需要 owner 的解除条件

只有以下情形再停：

| # | 条件 | 当前是否触发 |
|---|---|---|
| **A** | 需要修改 `2026-08-01 → 2026-09-22` qualification window | ⚠️ **相关**（若要 FULL_WINDOW 可用，须裁定 window 或接受 PARTIAL） |
| **B** | 需要扩大冻结 attribution taxonomy | ❌ 未触发（已按 owner 要求保持冻结） |
| **C** | 必须使用 synthetic / backfill / inferred position 才能建立 PH full-window | ⛔ **会触发**（当前正是此情形 ⇒ 故裁定 `PARTIAL` 而非强行 full-window） |
| **D** | 需要生产写入 / 建表 / deploy / push / PR / merge / tag | ❌ 未触发 |

⇒ **本轮依 C 停止推进 full-window 主张，改以 `PARTIAL` 如实记录。**

---

## 8. 复现指令

```bash
# 完整审计（机器可读）
node scripts/v365-rpg-f2b-actual-coverage-audit.js \
  --out deliverables/v365-production-history/rpg-f2b-actual-coverage-audit.json

# 受治理实际执行 cooldown replay（V2-AE）
node -e "require('./scripts/lib/v364-replay-harness.js').replay({from:'2026-08-01',to:'2026-09-22',runsPerDay:1,protocol:'V2-AE'}).then(r=>console.log(r.ledger_source, JSON.stringify(r.execution_ledger.actual_date_span)))"

# decision_result 最小化只读回查（需有效凭证）
node scripts/tools/cloudbase-export-decision-result-for-cooldown.js

# R-03~R-06 只读安全性
node scripts/tools/cloudbase-readonly-safety-test.js
```

---

## 9. 边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| replay harness | 已按 **owner 显式授权**（SHA 逐位绑定）变更 —— 见 `V365_RPG_F2B_REPLAY_INFRA_CHANGE_RECORD.md` |
| production calculation（CALC ∪ MIXED） | **零改动** |
| `cooldown.js` / `constants.js` | **零改动** |
| schema / collection | **零改动** |
| 现有 anchor（V1 / V2-CF） | **未改**（逐位复现） |
| 历史 qualification evidence | **未重写** |
| deploy / commit / push / PR / merge / tag | **均未发生** |
| 仓库 HEAD | 仍 `c6bd006fd76ffc5358cddd07347df8ed23d9e61d` |
