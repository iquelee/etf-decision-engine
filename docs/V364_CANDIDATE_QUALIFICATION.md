# V3.6.4 Safety Hardening —— Candidate Qualification

- 报告日期：2026-09-22
- 分支：`feat/v361-safety-hardening-r1`
- 候选版本：**V3.6.4 Safety Hardening**（父版本 **V3.6.1**）
- 状态：**CANDIDATE（未冻结、未部署、未 merge）**

---

## 0. 本轮做了什么 / 没做什么

**做**：把已完成的 R1 correctness 修复**资格化**为新的生产候选版本 V3.6.4 —— 四道 Gate 全部用真实数据、真实生产链状态跑出可复核结论，并建立版本治理与部署台账。

**没做**（本轮明确禁止，全部遵守）：

| 禁止项 | 状态 |
|---|---|
| 部署 CloudBase | ❌ 未部署 |
| 修改线上 `param_config` | ❌ 未修改 |
| 修改 `V361_IMMUTABLE_LOCK.json`（不覆盖、不重生成新 SHA） | ❌ 未修改（内容逐位不变，见 manifest 不变量检查） |
| 修改 `trend-stage.js` / `decision-v3.js` / `decision.js` | ❌ 未修改 |
| 修改 Gen-1 frozen pipeline lock | ❌ 未修改 |
| 开启 V3.6.2 / V3.6.3 Grace | ❌ 保持 OFF |
| 启用 Portfolio Mode（`v3_force_portfolio_track` / `v3_5_portfolio_enabled`） | ❌ 未启用 |
| 改 Market Regime 阈值 / W5 majority 规则 | ❌ 未改 |
| 接通 Run Finality 阻断 / V361RunContext 阻断 | ❌ 未接通 |
| 改 Tech Cap / correlation discount 阈值 / SlowBreak 阈值 / StageFactor / MarketFactor / 仓位步长 | ❌ 未改 |

---

## 1. R1 分支状态冻结

| 项 | 值 |
|---|---|
| 冻结时刻 HEAD | `a896aeb7f6c1e6d3fb4965b1a1962bc7f26fb2ce` |
| 冻结方式 | 本地 tag `v361-r1-freeze`（指向上述 commit） |
| 分支 | `feat/v361-safety-hardening-r1` |
| 基线 | `origin/master = 650db58639f32232ac72a99920060dd92e743621` |
| 工作树 | clean |

> R1 的交付内容与其自身报告见 `docs/V361_SAFETY_HARDENING_R1_REPORT.md`。
> 本轮**不修改 R1 的任何实现文件**（只新增 Gate 脚本、Gate 报告、治理文档与 1 个自动测试）。

---

## 2. 四道 Qualification Gate

| Gate | 内容 | 规模 | 判定 |
|---|---|---|---|
| **A** | SlowBreak Historical Replay（OLD vs NEW） | 582 个五票共同交易日 × 5 票 | **PASS** |
| **B** | Same-Day Idempotence Full-chain Replay（RUN_ONCE vs RUN_3X） | 120 天 × 5 票 × (1+3) 次 = 6000 次字段比对 | **PASS** |
| **C** | Swing Parity（旧/新实现共享语义） | 5483 个 rolling window | **PASS** |
| **D** | 正式 CI（GitHub Actions） | Node16/22 × Python3.11/3.12 + 全门禁 | 见 §2.4 |

### 2.1 Gate A —— SlowBreak Historical Replay

报告：`docs/V364_SLOWBREAK_REPLAY.md` · 原始数据：`outputs/v364-qualification/slowbreak_replay.json`

**判定 PASS（全部 6 项子门禁通过）**

| 子门禁 | 指标 | 实测 | 上限 |
|---|---|---|---|
| F1 | 触发日中「S3/S4/S5 且被压仓」占比 | 0 | ≤ 0.20 |
| F2 | action 变化占比 | 0 | ≤ 0.05 |
| F3 | `final_target` 最大绝对变化 | **0 pp** | ≤ 30 pp |
| F4 | 新增 EXIT | 0 | ≤ 1 |
| F5 | 新增 STRATEGIC_REDUCE | 0 | ≤ 5 |
| F6 | 新增 TACTICAL_REDUCE | 0 | ≤ 10 |

**逐票结果**：5 只 ETF 在 2024-04-16 ~ 2026-09-04 区间内 `slow_break_high` 触发次数 **NEW = OLD = 0**；
`Δtarget` 全为 0、action 变化 0 次、新增减仓动作全为 0。

#### ★ 关键发现 FINDING-1：`SB>=75` 在生产上**不可达**（R1 的 lowerLow 修复必要但**不充分**）

`defense.js::calcSlowBreakScore()` 需要 4 项输入，但在**线上 `indicator_snapshot` 文档**上只有 2 项可得：

| # | 条件 | 需要的字段 | 线上快照是否存在 |
|---|---|---|---|
| 1 | `high_point_falling \|\| lower_high` | `high_point_falling` / `lower_high` | ❌ **不存在** |
| 2 | `ma20_slope < 0` | `ma20_slope` | ✅ 存在 |
| 3 | `ma60_slope < 0` | `ma60_slope` | ❌ **不存在** |
| 4 | `d_state==='D5' \|\| h_state ∈ {H4,H5}` | `d_state` / `h_state` | ✅ 存在 |

⇒ 可得条件数 **2 / 4** ⇒ 分数上限 **50** ⇒ `isSlowBreakHigh()` 所需的 `SB>=75` **不可达**。

交叉证据：

- 2026-09-22 对线上 `indicator_snapshot`（code=513310, calc_date=2026-09-21, version=4）做**只读投影探测**，
  `{breakout_nd, ma60_slope, high_point_falling}` 三个字段**均未返回**（文档里根本不存在）。
- 全仓检索 `ma60_slope`：**只有 `defense.js` 一处读取，没有任何产生处**。
- `high_point_falling` / `lower_high` 在 `indicators.js` 中出现 **0 次**
  （内部变量叫 `highPointFalling`，从未暴露为快照字段）。
- Gate A 区间内 5 只 ETF 的 `SlowBreak` 分数实际只出现过 **0 / 20 / 50**，从未 ≥75。

**结论**：`isSlowBreakHigh()` 是**双重死逻辑** ——
① `lowerLow` 恒 false（缺陷 #2，R1 已修）；
② 即使 `lowerLow` 修好，`SB>=75` 这一前置门槛也永远达不到。
**⇒ Gate A 证明的是「R1 的 SlowBreak 改动在生产数据上零副作用」；
它不能证明「触发时机正确」—— 那一问在条件可达之前无法回答。**

### 2.2 Gate B —— Same-Day Idempotence Full-chain Replay

报告：`docs/V364_IDEMPOTENCE_REPLAY.md` · 原始数据：`outputs/v364-qualification/idempotence_replay.json`

**判定 PASS**

| 比较 | 规模 | 漂移数 |
|---|---|---|
| 逐日 × 逐票 × 10 个决策字段 | **6000 次字段比对** | **0** |
| 同日内部（第 1 次 vs 第 3 次） | 120 天 | **0** |
| 日末状态（非审计字段） | 5 票全量字段 | **0** |
| 日末账面（`suggested_position` 滚动） | 5 票 | **0** |

比较字段：`trend_stage_primary` · `trend_stage_overlay` · `pendingStage` · `pendingDays` ·
`days_in_stage` · `soft_down_days` · `s5_risk_days` · `breakout_level` · `final_target` · `final_action`

允许不同的**运行审计字段**（不参与生产决策）：`last_evaluated_trade_date` · `day_start_state` ·
`trade_date_anchored` · `idempotence_reason`。

> 审计字段实际差异 **5 条**（每票 1 条）：RUN_ONCE 末次为 `new_trade_date`，RUN_3X 末次为
> `same_trade_date_replay` —— 这条差异正是「第 2/3 次确实走了同日重放路径」的**正面证据**。

**过程记录（诚实留痕）**：首次跑 Gate B 时为 **FAIL**（120 天中 13 天出现日内漂移，字段为
`final_target` / `final_action` / `suggested_position` / `binding_constraint`，集中在科技票）。
**诊断为重放 harness 自身的缺陷**：赛道额度 `sectorUsed` 的累加被误放在「仅最后一次运行」分支内，
导致第 1 次运行时科技票之间额度未累加。修正后 PASS。**此缺陷在 harness 内，不在生产代码内。**

### 2.3 Gate C —— Swing Parity

报告：`docs/V364_SWING_PARITY_REPORT.md` · 自动测试：`tests/v364-swing-parity.test.js` · 原始数据：`outputs/v364-qualification/swing_parity.json`

**判定 PASS**

| 指标 | 值 |
|---|---|
| **total_windows** | **5483**（真实历史 4566 + 确定性合成语料 917） |
| **mismatch_count** | **0** |
| 共享字段 | `higherLow` · `lowerHigh` |
| 非共享字段（新实现专有） | `higherHigh` · `lowerLow` · `computable` · `priorHigh` · `priorLow` · `recentHigh` · `recentLow` · `sample` · `window` |

- 扫描口径：对每条 K 线序列枚举**每一个长度 12 的 rolling window**，逐窗口比对共享字段。
- **永久门禁**：`tests/v364-swing-parity.test.js` 属于 `tests/*.test.js`，会被
  `npm test`（`scripts/test-all.js` Stage A）自动执行 ⇒ 任何让共享语义漂移的改动立即让 CI 变红。
- ⚠️ **CI 上的真实历史源不可用**（`deliverables/` 已 gitignore）⇒ CI 的 parity 保障来自
  **确定性合成语料（30 条序列 / 917 窗口）**，本报告不伪造真实数据的存在性。
- 保留两份实现是**有意接受**的：`trend-stage.js` 是 Gen-1 冻结件（不得删），
  `swing-structure.js` 是 SlowBreak 修复依赖（不得退）。**未修改受锁文件。**

### 2.4 Gate D —— 正式 CI

- 分支已 push 到 `origin/feat/v361-safety-hardening-r1`。
- PR：见 §4（**已创建，未 merge**）。
- CI 触发项：`test.yml` 矩阵 **Node 16 / Node 22 × Python 3.11 / 3.12**，步骤含
  `npm test`（Stage A~G 全门禁）、`verify-immutable.js`、`gen1-production-gates.js`。
- **CI 结果**：见 §4 表格（本节由 CI 完成后回填）。

---

## 3. 版本治理

### 3.1 V3.6.1 永久保留（未触碰）

| 锁文件 | 状态 |
|---|---|
| `ml/manifests/V361_IMMUTABLE_LOCK.json` | **未修改、未覆盖、未重生成**（内容逐位不变） |
| `ml/manifests/GEN1_FEATURE_PIPELINE_LOCK.json` | **未修改** |
| `ml/gen2/manifests/GEN2_RULE_V2_LOCK.json` | **未修改** |

候选 manifest 已由脚本自动断言上述不变量（见 §3.2 `parent_unchanged_invariants`）。

### 3.2 V3.6.4 候选 manifest（草案，**未冻结**）

产物：`ml/manifests/V364_IMMUTABLE_LOCK.candidate.json`（文件名带 `.candidate` = 明确未冻结）

生成方式：`node scripts/v364-candidate-manifest.js [--candidate-sha <sha>]`

| 字段 | 值 / 说明 |
|---|---|
| `version` | `V3.6.4` |
| `status` | **`CANDIDATE_NOT_FROZEN`** |
| `parent_version` | `V3.6.1` |
| `parent_repo_sha` | `650db58639f32232ac72a99920060dd92e743621` |
| `candidate_repo_sha` | 见 manifest（资格化提交 SHA） |
| `hash_basis` | LF-normalized（与 V361 / GEN1 / GEN2 三把锁同口径） |
| `sha256` | 17 个实现文件（含 `decision.js` · `decision-v3.js` · `trend-stage.js` · `correlation.js` · `v3-6-stage-persistence.js` · `defense.js` · `swing-structure.js` · `runDecisionEngine/index.js` 等） |
| `qualification_reports` | 6 份报告的内容哈希（含本文件） |
| `parent_unchanged_invariants` | 3 项断言（V3.6.1 两文件 + Gen-1 trend-stage 逐位未变） |
| `explicitly_not_included` | 9 项禁止清单（防止后续被误读为「已包含」） |
| `freeze_condition` | **Gate A/B/C/D 全部 PASS + 人工 Review 授权**；D 未全绿前不得改写为 `FROZEN` |

**冻结流程（本轮不执行）**：D 全绿 → Review 通过 → 将 `.candidate.json` 改名为
`V364_IMMUTABLE_LOCK.json` 并把 `status` 置 `FROZEN`（另起一个 commit，单独可回溯）。

---

## 4. 部署台账

新增 append-only 文件：`docs/production-deployment-ledger.md`

- **不改** `docs/主链冻结契约.md` 的历史记录，只做追加 + 勘误指针。
- 已登记 3 条：**D-001** 2026-09-05 原部署 · **D-002** 2026-09-17 GE-03 重部署 ·
  **D-003** 2026-09-22 本次只读核验。
- 字段：`deploy/mod_time` · `source_repo_sha` · `package_sha256` · `index_sha256_raw` · `index_sha256_lf` ·
  `source_parity` · `evidence reference`。

关键事实（本次实测）：

| 项 | 值 |
|---|---|
| 线上 `ModTime` | **2026-09-17 14:24:41（自 D-002 后未再部署）** |
| 线上包 `CodeSha256` | `a694b7d3d6bad410ca5f0c25304ba13fcdf9801c79f86d7f99b1bb0bc3003608` |
| 本地下载重算 | 同上（逐位一致） |
| **source parity** | **MATCH 66 / 66**（`runDecisionEngine`） |
| 勘误 E-001 | 契约文档的 `7876610f…82e6315d` / `2026-09-05 14:01` 已过期，以台账 D-002/D-003 为当前基线 |
| 勘误 E-002 | 其余 **9 个云函数**的线上包 SHA **本次未重新对账** → 待单独立项 |

---

## 5. 未解决风险（登记，不自行处置）

| # | 风险 | 影响 | 建议 |
|---|---|---|---|
| R1 | **残留冲突：两份 Swing 实现并存**（`trend-stage.js` 冻结副本 + `swing-structure.js`）。共享语义已由 Gate C 永久锁定，但源码层面仍未收敛 | 认知成本 / 未来漂移风险（已被门禁覆盖） | 三选项：① 维持现状（Gate C 已锁）② 授权重锁 Gen-1 pipeline lock 后收敛 ③ 升版 V3.6.5+ 时收敛 |
| R2 | ★ **FINDING-1：`SB>=75` 生产不可达**（快照缺 `ma60_slope` / `high_point_falling`(或 `lower_high`)）⇒ SlowBreak +20 仍是死逻辑 | 防御语义缺一块；R1 修复当前**无实际效果** | **单独立项**：补齐快照字段属策略级变更（会扩大触发域），必须走回测 + 单独放行。立项前不得启用任何依赖 SlowBreak 的语义 |
| R3 | **FINDING-2：线上 `indicator_snapshot` 缺 `breakout_nd`**（仓库 `computeSnapshot` 会产出）⇒ 线上 `detectPrimaryStageRaw` 的 S4「breakout_nd」分支不可达 | S4 阶段识别少一条通路 | 单独立项核实「线上 `materializeIndicators` 部署件 vs 仓库 master 是否分叉」，再决定是否重部署 |
| R4 | 仅核验了 `runDecisionEngine` 一个函数的线上包；其余 9 个函数的 SHA 未对账（勘误 E-002） | 基线完整性 | 单独立项：逐函数下载重算 |
| R5 | `docs/主链冻结契约.md` 的过期记录仍在原处（按 append-only 原则未改） | 读者可能引用旧值 | 已有台账勘误指针 E-001；如需在契约文档内加指针，需单独授权 |
| R6 | **OOS/回测数字本轮未涉及**：Gate A/B/C 都是 correctness 资格化，**不构成收益或风险改善的证据** | 不得据此宣称任何业绩 | 若要把 V3.6.4 用于生产，仍需按既有「回测验证，效果不明不部署」流程单独走一遍 |
| R7 | Gate A/B 的保真度限制：快照由真实 OHLCV **重推导**、`fundamental` 常量化为 `F3/15`、账面从 0 自洽滚动、`premium_rate` 缺失 | 绝对数值不等同生产历史 | 已逐条写进 Gate 报告的「方法学边界」；两变体同输入，故 **OLD/NEW 差异**不受影响 |
| R8 | 本机沙箱禁止 Node 子进程（`spawnSync` → EBUSY），`npm test` / `gen1-production-gates.js` 本地无法执行 | 本地无法给出「一键全绿」 | 由 Gate D 的 **GitHub Actions** 提供真实 CI 结果；本地用 bash 直调等价门禁 |
| R9 | 本机无 Node 16（线上 runtime 为 `Nodejs16.13`） | Node16 特有行为本地未覆盖 | 由 Gate D 矩阵中的 Node 16 job 覆盖 |

---

## 6. 结论与建议

1. **Gate A / B / C 全部 PASS**，且均以真实历史数据 + 真实生产链状态跑出，可复核（脚本 + 原始 JSON + 报告齐备）。
2. **Gate D**（正式 CI）结果见 §4；**CI 未全绿前不得 merge**。
3. **V3.6.4 是 correctness hardening 候选，不是业绩改进版本**：
   - 在真实数据上，SlowBreak 修复的决策影响为 **0**（因为 `SB>=75` 不可达，见 FINDING-1）；
   - 相关性口径与 Market Regime / 现金诊断均为**只读新增或零差异**；
   - 交易日幂等修复只改变「同一天重复运行」的行为（Gate B 已证明严格幂等）。
4. **建议的下一步（按优先级）**：
   - P0：完成 Gate D，取得 Node16 / Node22 / Python / Immutable / Gen-1 / Build parity / Secret scan / parity 全绿；
   - P0：**裁定 R1**（两份 Swing 实现是否收敛）；
   - P1：立项 FINDING-1（补齐 SlowBreak 快照字段）与 FINDING-2（`breakout_nd` 缺失）；
   - P1：立项「其余 9 个云函数线上包对账」（勘误 E-002）；
   - P2：Market Regime authority 裁定 / Portfolio Mode 晋升（上一轮已给 3 选项）。
5. **V3.6.1 三把锁保持原样、永久保留历史基线**；V3.6.4 只在 Gate D 全绿 + Review 授权后才允许置 `FROZEN`。

---

## 附：本轮产物清单

| 类型 | 文件 |
|---|---|
| Gate 报告 | `docs/V364_SLOWBREAK_REPLAY.md` · `docs/V364_IDEMPOTENCE_REPLAY.md` · `docs/V364_SWING_PARITY_REPORT.md` |
| 资格化主报告 | `docs/V364_CANDIDATE_QUALIFICATION.md`（本文件） |
| 治理 | `ml/manifests/V364_IMMUTABLE_LOCK.candidate.json` · `docs/production-deployment-ledger.md` |
| 自动门禁 | `tests/v364-swing-parity.test.js` |
| 脚本 | `scripts/lib/v364-replay-harness.js` · `scripts/lib/v364-swing-parity.js` · `scripts/v364-gate-a-slowbreak-replay.js` · `scripts/v364-gate-b-idempotence-replay.js` · `scripts/v364-gate-c-swing-parity-report.js` · `scripts/v364-candidate-manifest.js` |
| 原始数据（gitignore） | `outputs/v364-qualification/*.json` |
