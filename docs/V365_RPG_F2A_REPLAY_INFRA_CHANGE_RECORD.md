# V365 RPG-F2-A Replay-Infra Change Record

> **性质**：REPLAY_INFRASTRUCTURE 变更记录（RPG-F1 §9 流程第 ⑤ 步）。
> **生成**：2026-09-28（GMT+8）｜接手方 = 本机 WorkBuddy 国际版
> **基线**：HEAD `c6bd006fd76ffc5358cddd07347df8ed23d9e61d`
>
> **结论标记**：`[AS-IS]` 实测 · `[PROBE]` 探针 · `[INFER]` 推理 · `[HUMAN]` 待裁定

---

## 1. 变更对象 `[AS-IS]`

| 项 | 值 |
|---|---|
| 文件 | `scripts/lib/v364-replay-harness.js` |
| 分类 | **`REPLAY_INFRASTRUCTURE`**（HD12-D6 第三桶） |
| 变更前 sha256 | `f48e33a299749cf5210ca1437582a32a205b87f61f5350afe889f74f5e095818` |
| 变更性质 | **新增协议分支**（非替换）：`replay({ protocol: 'V1' \| 'V2-CF' })`，默认 `'V1'` |

**改动内容（三处，均最小化）**：

| # | 位置 | 改动 |
|---|---|---|
| 1 | `:35-36` | 新增 `const correlation = U('correlation.js');`（复用生产纯函数） |
| 2 | `runOneDay` | 新增 `protocol` 入参；**仅当 `'V2-CF'`** 时按 as-of-date bars 调 `correlation.effectiveTechCap()` 并注入 `portfolio.effective_tech_cap` / `correlation_discount` / `tech_correlation`；`effTechMax` 改为 `portfolio.effective_tech_cap ?? techMax`（与 RDE:707 同构） |
| 3 | `replay()` | 新增 `protocol` 选项（默认 `'V1'`）并透传；返回值新增顶层 `protocol` 字段 |

⛔ **未改**：`nextBook` 语义（仍 `= suggested_position`）· `cooldownDays`（仍硬编码 0）· 任何 production calculation · RDE · 两个门禁 · schema · collection。

---

## 2. RFP-V1 Immutability `[PROBE]`

```
V1 result_sequence_sha = 25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723
expected               = 25ccbfc7e1b73a9a173ec36c17512c6228a2fe42685dcd291bc055ea4ed11723
RFP-V1_REPRODUCIBLE    = true          ← 逐位不变
```

**三重独立佐证**：
1. `v365-p12-decision-parity.js` 实测 `parity_anchor_sha256 = 25ccbfc7…1723` ✓
2. `v365-replay-v2cf-attest.js` 用**同一度量**复现，得同一 sha ✓
3. `tests/v365-rpg-f2a.test.js` **A-01** 断言通过 ✓

⇒ 未以"V2 新协议"为由改动 V1 行为。

---

## 3. RFP-V2-CF Baseline `[PROBE]`

```
RFP-V2-CF result_sequence_sha = b87654ab81935731a4173b5f566231f6db62c3d2e2b43f74cd6c8fb93ea78832
V1 != V2-CF                   = true（协议不同 ⇒ 数值不同**不构成** regression）
```

**Interim anchor（7 项绑定，⛔ 非裸 SHA）**：

| 字段 | 值 |
|---|---|
| `protocol_version` | `RFP-V2-CF` |
| `replay_semantics` | `COUNTERFACTUAL_ASSUMED_EXECUTION` |
| `input_dataset_hash` | `090ce9a6c646cbd3782e291d8b4d32f248731cff6a0d9bda2dd13c06b923d7c8` |
| `production_code_sha` | `084441e075cc4ee6720e4e8f342a32862bf7b472b885d0de17622d6e4a1dd4fc` |
| `replay_harness_sha` | `f48e33a299749cf5210ca1437582a32a205b87f61f5350afe889f74f5e095818` |
| `result_sequence_sha` | `b87654ab…8832` |
| `coverage_manifest_sha` | `be73550a002f2cabecc6f822d15d49c870d8a3d9cd241fbd4d267be92f1190e5` |
| **`qualification_authoritative`** | **`false`** ⛔ |

---

## 4. V1 → V2-CF Delta Attribution `[PROBE]`

```
summary = { total_days: 25, total_day_code: 125, changed: 9, expected: 9, unexpected: 0 }
```

**9 处差异（全部 `EXPECTED_FIDELITY_DELTA`，全部 reason = `effective_tech_cap_fidelity`）**：

| # | date | code | field | V1 → V2-CF | cap |
|---|---|---|---|---|---|
| 1 | 2026-08-10 | 159582 | `final_target` | 30 → **28.1** | 65 → 63.1 |
| 2 | 2026-08-10 | 159582 | `binding_constraint` | **`none` → `sector_cap`** | 65 → 63.1 |
| 3 | 2026-08-11 | 159582 | `final_target` | 24 → **22.1** | 65 → 63.1 |
| 4 | 2026-08-12 | 159582 | `final_target` | 24 → **22.1** | 65 → 63.1 |
| 5 | 2026-08-13 | 159582 | `final_target` | 24 → **22.1** | 65 → 63.1 |
| 6 | 2026-08-14 | 159582 | `final_target` | 24 → **22.1** | 65 → 63.1 |
| 7 | 2026-08-17 | 159582 | `final_target` | 24 → **22.1** | 65 → 63.1 |
| 8 | 2026-08-18 | 159582 | `final_target` | 21 → **19.1** | 65 → 63.1 |
| 9 | 2026-08-19 | 159582 | `final_target` | 21 → **19.1** | 65 → 63.1 |

**读法**：
- 差异**全部**落在 `159582`（`semi_equip`，属 `TECH_SECTORS`）⇒ 与 §2 判定的 **DIRECT** 路径一致
- 位移量恒为 **−1.9pp** = `65 − 63.1` ⇒ 与 `cap_delta_pp` **逐位吻合** ⇒ 归因可机器验证
- ⚠️ **#2 是唯一一处 `binding_constraint` 翻转**：`none → sector_cap`
  ⇒ V2-CF 的更紧 cap **使 sector 约束从"不绑定"变为"绑定"** ⇒ 这是修复**真实生效**的直接证据
- ⛔ `UNEXPECTED_DECISION_DELTA = 0` ⇒ 无未归因差异

---

## 5. Coverage Manifest `[AS-IS]`

```json
{
  "protocol_version": "RFP-V2-CF",
  "replay_semantics": "COUNTERFACTUAL_ASSUMED_EXECUTION",
  "qualification_authoritative": false,
  "coverage": {
    "effective_tech_cap": { "status": "PRODUCTION_FUNCTION_REUSED", "as_of_date": true, "lookahead": false, "rpg": "RPG-001" },
    "cooldown":          { "status": "KNOWN_GAP", "production_fidelity": "NOT_AVAILABLE",
                           "counterfactual_fidelity": "INCOMPLETE", "rpg": "RPG-002" },
    "position_book":     { "status": "COUNTERFACTUAL_ASSUMED_EXECUTION",
                           "production_historical_fidelity": "NOT_APPLICABLE", "rpg": "RPG-003" }
  }
}
```
⛔ 未暗示 cooldown 已修复。

---

## 6. 变更流程合规（RPG-F1 §9 五步）`[AS-IS]`

| 步 | 要求 | 本轮 |
|---|---|---|
| ① | explicit human approval | ✅ owner 本轮明示授权实施 F2-A |
| ② | old protocol reproducibility check | ✅ §2（V1 anchor 逐位复现） |
| ③ | new protocol validation | ✅ §3 + §4 + §7（A-01~A-10 全 PASS） |
| ④ | new anchor establishment | ✅ §3（7 项绑定，`qualification_authoritative = false`） |
| ⑤ | qualification documents update | ✅ 本文件 + 三个机器可读产物 |

---

## 7. Regression `[AS-IS]`

| 项 | 结果 |
|---|---|
| `tests/v365-rpg-f2a.test.js`（A-01~A-10） | **全 PASS** |
| `tests/v365-decision-classification.test.js`（C-01~C-17） | **全 PASS** |
| Stage A | **61/61**（60 + 本轮新增 1） |
| `v365-qualification-gate` | **PASS 38 / 38** |
| `v365-reader-migration-gate` | **PASS 8 / 8** |
| `v365-p12-decision-parity` | **Δ = 0**；anchor `25ccbfc7…1723` **未变** |
| `verify-immutable` / `verify-gen1-pipeline` / `verify-gen2-build-artifacts` | **全 PASS** |

⚠️ **一处可观测的副作用（非 verdict 变化）**：`回放依赖集大小` **29 → 30**
—— 因 harness 新增 `require('correlation.js')`。已由 C-11 的独立复算验证**两侧一致**（门禁 = 独立复算 = 30），且该计数**不进入** anchor 度量。

---

## 8. 边界履行 `[AS-IS]`

| 项 | 实况 |
|---|---|
| 本轮改动 | **1 个 tracked 文件**：`scripts/lib/v364-replay-harness.js`（**已授权的 REPLAY_INFRA 变更**）<br>+ 新增：`scripts/v365-replay-v2cf-attest.js` · `tests/v365-rpg-f2a.test.js` · 本文件 · 3 个 `outputs/*.json` |
| Git 跟踪文件 | tracked 改动数 **9**（8 前有 + 1 本轮）；HEAD **未变** |
| 生产计算文件（CALC ∪ MIXED，47 文件） | **零改动**（A-10 断言 + `git diff` 复核） |
| RDE / parity gate / qualification gate / schema / collection | **零改动** |
| V1 anchor | **未改** |
| cooldown / nextBook / trade_log / portfolio_snapshot | **均未引入或改动** |
| HD12-2 / HD12-3 / RH1 / RPG-F2-B / RPG-F2-C | **未进入** |
| deploy / commit / push / PR / merge | **均未发生** |

---

## 9. 完成状态 `[AS-IS]`

```
RPG-F2-A = COMPLETE

RFP-V1_REPRODUCIBLE          = true
RFP-V2-CF_BASELINE_ESTABLISHED = true
RPG-001 = CLOSED

RPG-002 = OPEN
RPG-003-PH = PENDING_DATA_EXPORT

HD12-2 = PENDING
HD12-3 = BLOCKED
```

**已停止，未进入 F2-B / F2-C。**
