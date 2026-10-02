# GEN1_PRE_LAUNCH_INVENTORY / FUNCTIONAL COMPLETENESS INVENTORY（★ 初稿 · 只读）

- **闸门来源**：owner 2026-10-02「九、下一步不要自行进入 Freeze」指定的**下一 Gate**
- **本件性质（⛔ 首要）**：**只读分析初稿**。⛔ 不执行任何功能集成；⛔ 不 deploy / 不写生产 / 不改代码 /
  ⛔ 不 merge / 不 push / 不 tag / ⛔ 不进入 Freeze；⛔ 零放行。
- **as-of**：2026-10-02（北京时间）
- **上游件**：`docs/gen1/GEN1_HEALTH_ATTESTATION_BLOCKER_DIAGNOSTIC_20261002.md`（§11–§13）
- **落点**：`docs/gen1/GEN1_PRE_LAUNCH_INVENTORY_20261002.md`

---

## 0. 方法与证据来源分级（⛔ 先声明口径，再下结论）

| 级别 | 含义 | 本件用途 |
|---|---|---|
| `repo@c4c5e5d` | 载体树 `_g1-contract-v5-20261002` 工作区源码，**本件实测** | 读点 / 开关 / 不变量 |
| `repo@main-f30d918` | 主仓 `dist-functions/**`（构建产物）**本件实测** | reader-migration 模块内容 |
| `online-parity-20261002` | `_cb-connect-20260921/parity_out_20261002.txt`：**仅 `runDecisionEngine`** 单函数，91 源文件 `EXACT_MATCH` | 线上部署身份 |
| `ledger` | `docs/V365_PRODUCTION_READINESS_LEDGER.md`（L157–L170） | 部署台账裁断 |
| `NOT RE-READ` | 本件**未**对该对象做线上逐字节复读 | 须显式标注，⛔ 不得冒充实时 |
| ⛔ `STALE-DO-NOT-USE` | `_cb-connect-20260921/../online-apiGateway`、`online-adminGateway`、`online-runDecisionEngine` 快照 mtime = **2026-09-01**（早于 V3.6.1） | ⛔ 一律不得用于「当前线上」结论（E27 `STALE CAPABILITY`） |

⚠️ **枚举域声明**：本件「零消费者 / 零引用」类否定断言，枚举域 = **载体树工作区 `.js`（排除 `node_modules`）
+ 线上 `runDecisionEngine` 包（`online-parity-20261002`）**。⛔ 不覆盖 `apiGateway` / `adminGateway` 的线上包内容。

---

## 1. ★ Gen-1 signal productionization 链：逐环节现状（owner 指定重点）

```text
signal → candidate → candidate validation → promotion proof → active pointer
       → production read path → Decision Chain（生产决策输入）
```

| # | 环节 | 现状 | 证据（一级来源） | 判定 |
|---|---|---|---|---|
| 1 | **Gen-1 signal** | `ml_shadow_signal` 持续推进（22:20 独立链）；133 行 / max `date` = `2026-09-30` | `probe_ml_shadow_signal.json`（2026-10-02 实读） | ✅ IMPLEMENTED / RUNNING（**shadow only**） |
| 2 | **candidate** | ENFORCE 下写入 `run_candidate_decision`（10 行 = 2 run × 5 票）/ `run_candidate_portfolio`（2 行）；字段集**已含** V6.0 §3 主比较列所需全部字段 | `GEN1_STEP11_E1_READ_SOURCE_RULING_PREREQ_20261002.md` §1.1/§1.4 + 实读 | ✅ IMPLEMENTED / WRITING |
| 3 | **candidate validation** | `run_manifest.validation_passed` / `validation_reason`：09-30 = `true` / `ok`；10-01 = `false` / `mixed_date_detected` | 同上 §1.1 | ✅ IMPLEMENTED（**会判不合格**） |
| 4 | **promotion proof** | V6.0 §3.0.3 `PROMOTION_PROOF(R)` 五条 AND（含 CAS `classifyPointerPromotion`）；09-30 run `promoted=true` / `cas_reason=PROMOTED` / `read_after_write_consistent=true`；10-01 run `promoted=false` | `GEN1_EVIDENCE_CONTRACT_V6.md` §3.0.2–§3.0.3 | ✅ IMPLEMENTED |
| 5 | **active pointer** | `active_run_pointer::production` 存在（1 行）；`run_id = engine:2026-09-30:b1790776862980`；`revision = 1`；`updated_at = 2026-09-30T14:01:11.797Z` ⇒ **自 09-30 22:01（+08）未再前进** | 同上 §1.1 | ⚠️ IMPLEMENTED / **STALLED**（事件驱动，非结构性永久 FAIL） |
| 6 | **production read path** | ❌ **未迁移**（见 §3 B-1） | `repo@c4c5e5d` 实测 | ❌ **GAP** |
| 7 | **Decision Chain** | ❌ Gen-1 promoted result **未成为** production decision input（见 §3 B-2/B-3） | `repo@c4c5e5d` 实测 | ❌ **GAP** |

### 1.1 第 6 环（production read path）的逐条实测

| 项 | 实测值 | 来源 |
|---|---|---|
| `apiGateway` 读点 | `cloudfunctions/apiGateway/index.js:508`（`orderBy decision_date desc`）· `:610`（同上，`limit 500`）· `:162` / `:519`（`orderBy snapshot_date desc, limit 1`） | `repo@c4c5e5d` |
| `adminGateway` 读点 | `cloudfunctions/adminGateway/index.js:74`（`orderBy decision_date desc, limit 1`） | `repo@c4c5e5d` |
| 是否违规形态 | ✅ **命中** `v365-active-read.js` → `FORBIDDEN_READ_PATTERNS.LATEST_DECISION_BY_DATE` / `LATEST_SNAPSHOT_BY_DATE` | `repo@main-f30d918` |
| reader-migration 模块是否被引用 | ⛔ **零引用** —— 线上 `runDecisionEngine` 包内 `v365-active-read` 字面量 **0 命中**（`GREP` 实测） | `online-parity-20261002` |
| ⚠️ 主仓构建产物差异 | 主仓 `dist-functions/apiGateway/index.js`、`dist-functions/adminGateway/index.js` **确实 require** `v365-active-read` ⇒ 仓内**有**接线版本，但**线上未复读**其身份 | `repo@main-f30d918`；⚠️ `NOT RE-READ` |
| 切换日登记 | `V365_ENFORCE_SWITCH_DATE = null`（未登记）⇒ CLASS C 双源**不可判定** | `repo@main-f30d918` |
| run 轴索引 | `RUN_HISTORY_INDEX = PENDING` ⇒ `run_axis_available = false` / `coverage = legacy_only` | 同上 |
| 迁移状态字段 | `planCompatibilityProjection().reader_migration_status` 默认 = `PENDING` | 同上 |
| ⚠️ **易错点** | `CLASS_C_READ_POINTS[].migrated = true`，但其 `reason` 由 `auditClassCReadPoints()` 映射为 **`REGISTERED`**（非 `MIGRATED`） ⇒ ⛔ **`migrated=true` ≠ 「已完成迁移」** | 同上（`reason: p.migrated === true ? 'REGISTERED' : 'UNREGISTERED'`） |

### 1.2 第 7 环（Decision Chain）的逐条实测

| 集合 | 写入状态 | 生产消费者 | 判定 |
|---|---|---|---|
| `decision_result` | ENFORCE 下 ⛔ **不写**（改写 `run_candidate_decision`）；max `decision_date` = `2026-09-29` | ✅ `apiGateway:508/:610`、`adminGateway:74` | ⚠️ **被消费，但已停写** |
| `portfolio_snapshot` | ENFORCE 下 ⛔ **不写**（改写 `run_candidate_portfolio`）；max `snapshot_date` = `2026-09-30` | ✅ `apiGateway:162/:519` 等 | ⚠️ 同上 |
| `run_candidate_decision` | ✅ 写（10 行） | ⛔ **零读者** | ❌ 未进入消费 |
| `run_candidate_portfolio` | ✅ 写（2 行） | ⛔ **零读者** | ❌ 未进入消费 |
| `active_run_pointer` | ✅ 写（1 行） | ⛔ **零读者**（写侧回读不计） | ❌ 未进入消费 |
| `run_manifest` / `run_history` | ✅ 写（各 2 行） | ⛔ **零读者** | ❌ 未进入消费 |

⇒ **结论（中性）**：**Gen-1 侧「算得出、也提得升」，但生产读路径仍在读「已停写的 legacy 集合」** ——
这不是「字段不存在」问题，而是 **reader migration（生产集成）未完成** 问题。

---

## 2. A 类 —— 功能缺口

| 编号 | 缺口 | 实测证据 | 阻塞级别 |
|---|---|---|---|
| **A-1** | **selector cutover 无代码通路** | `selectGuardedResult()` **无条件**返回 baseline；`GE_02_BASELINE_AUTHORITATIVE = true`；`authoritativeSource === SELECTOR_SOURCE.GUARDED` 直接 **`throw`**；`gen1_guarded_selector_source` 恒 `BASELINE`（`repo@c4c5e5d` `gen1-guarded-selector.js:31,80,95-101`） | 🔴 高（cutover 前置 = **代码变更**，⛔ 非配置开关） |
| **A-2** | `ml_effective` 无独立通路 | 为 **单向 alias**，派生自 `gen1_guarded_effective_active`（`schema.js:618`）；当前 `false` | 🟡 中 |
| **A-3** | 执行层开关为**代码级常量** | `schema.js:640-641` 自述 `gen1_production_write` = 「恒 false」· `gen1_auto_execution` = 「恒 false」；实读亦为 `false`；`gen1_broker_wired = false` | 🟢 低（**设计如此**） |
| **A-4** | `Key 2` 四绑定字段未激活 | `gen1_guarded_freeze_seal_status = PENDING` · `gen1_guarded_evidence_seal_status = PENDING` · `contract_version = WP-G1-GE-CH-1.0`（⛔ 零改动对象） | 🟡 中 |

---

## 3. B 类 —— 生产集成缺口（**当前最大一类**）

| 编号 | 缺口 | 证据 | 阻塞级别 |
|---|---|---|---|
| **B-1** | **reader migration 未接线**：生产读者仍 `orderBy(date desc)` 猜权威结果 | §1.1 全表 | 🔴 高 |
| **B-2** | **candidate / pointer 零消费者**：写了但线上无任何读者 | §1.2 全表 | 🔴 高 |
| **B-3** | **被消费集合已停写**：前台/后台读到的是 ENFORCE 前的 legacy 数据（`decision_result` 止于 09-29；`portfolio_snapshot` 止于 09-30） | §1.2 | 🔴 高 |
| **B-4** | `V365_ENFORCE_SWITCH_DATE` 未登记 ⇒ CLASS C 双源不可判定、`run_axis_available = false` | §1.1 | 🟡 中 |
| **B-5** | `RUN_HISTORY_INDEX = PENDING`（依赖受治理的生产历史数据） | §1.1 | 🟡 中 |
| **B-6** | 线上 `apiGateway` / `adminGateway` 的**逐字节身份本批次未复读** ⇒ 其「当前线上」状态为 `NOT RE-READ` | §0 | ⚪ 登记项（⛔ 不得据此下线上结论） |

---

## 4. C 类 —— Health / 安全状态缺口

| 编号 | 缺口 | 证据 | 阻塞级别 |
|---|---|---|---|
| **C-1** | 健康闩锁 `latched_health = DEGRADED`；根因标的 `515880` / `STATISTICAL_MISSING`；`reviewed_at = null`；`recovery_allowed = false` | 上游诊断件 §11.3 | 🔴 高 |
| **C-2** | **无生产恢复端点**：`manualReviewConfirmed` 生产闭环 **CALLER COUNT = 0**；`adminGateway` 仅 `GET /api/admin/gen1/health` | 上游诊断件 §11.4 | 🔴 高 |
| **C-3** | 三项 `AUTHORIZATION GATE` 全未授权：**AG-1** 写 `gen1_health_state` · **AG-2** 部署恢复端点 · **AG-3** 修 `515880` 特征缺失 | 上游诊断件 §5 | 🔴 高 |
| **C-4** | 健康正控不成立 ⇒ 灰度被硬阻断（`allow_canary = false` / `active = false` / `invocations = 0`） | 上游诊断件 §4 | 🔴 高 |

---

## 5. D 类 —— Evidence 缺口

| 编号 | 缺口 / 已完成项 | 证据 | 判定 |
|---|---|---|---|
| **D-1** | ✅ **V6.0 Evidence Contract = FROZEN + SEALED**（`O-1`）；V5.0 = `SUPERSEDED` | `GEN1_EVIDENCE_FREEZE_SEAL_V6.json` | ✅ 已完成 |
| **D-2** | **Evidence execution 未开始**；且**资格层**未成立（`canary_active = false`）—— 该层**与读源正交** | 上游诊断件 §4；`GEN1_STEP11_E1_*` §5.2 | 🔴 高 |
| **D-3** | `independent_events = 0`（门槛 30）⚠️ 上轮实读值，**本件未复读** | 上游 authority 字段 | 🔴 高 |
| **D-4** | **selector = `S-PROMOTED`**（V6.0 §3.0.2）：Evidence 对象须为**已提升** run ⇒ 受 `active_run_pointer` 未前进约束（§1 第 5 环） | `GEN1_EVIDENCE_CONTRACT_V6.md` §3.0.2 | 🟡 中 |
| **D-5** | ★ **读源绑定问题在契约侧已解**：V6.0 已把主比较列改绑 `run_candidate_decision` / `run_candidate_portfolio`（= E-1 的 **①b** 实质落地），`decision_result` / `portfolio_snapshot` 已标 ~~删除线~~ | `GEN1_EVIDENCE_CONTRACT_V6.md` §3 字段表 L274–L281 | ✅ 契约侧已解；⚠️ **生产侧未解（属 B-1）** |

⚠️ **必须分离的两件事**（⛔ 不得合并）：
**契约能否冻结**（D-1，已完成） ≠ **Evidence 能否执行**（D-2，未开始） ≠ **生产读链是否需要修**（B-1，需修）。

---

## 6. E 类 —— Authorization 缺口

| 编号 | 待授权项 | 当前值 |
|---|---|---|
| **E-1** | V3.6.6 FREEZE | `NOT AUTHORIZED` |
| **E-2** | PRODUCTION ATTESTATION（含任何写入） | `NOT AUTHORIZED`（且 `= BLOCKED`） |
| **E-3** | EVIDENCE EXECUTION | `NOT AUTHORIZED` |
| **E-4** | KEY 3 EVIDENCE SEAL | `NOT AUTHORIZED` |
| **E-5** | GE-04 | `NOT AUTHORIZED` |
| **E-6** | AG-1 / AG-2 / AG-3（生产写 / 部署 / 修特征） | `NOT GRANTED` |
| **E-7** | Git integration（push / PR merge / master reachability，X-5） | `PENDING`（须 owner 显式授权） |
| **E-8** | `v3_6_1_enabled` 切换 | `EFFECTIVE_ENGINE_SWITCH_REQUIRES_SEPARATE_AUTHORIZATION` |
| **E-9** | reader migration 上线（B-1 的兑现路径） | ⛔ 未授权（属生产变更） |

---

## 7. ★ owner 指定六问：逐项直接答复

| # | 问题 | 答复 | 结论 |
|---|---|---|---|
| 1 | **production read path 是否仍读取 `decision_result`？** | **是**。`apiGateway:508` / `:610`（`orderBy decision_date desc`）、`adminGateway:74`（同，`limit 1`）；且均**命中** `FORBIDDEN_READ_PATTERNS`。⚠️ 线上身份 `NOT RE-READ`（§0） | ✅ 是（`repo@c4c5e5d` 自证） |
| 2 | **candidate / pointer 是否真正进入线上消费者？** | **否**。`run_candidate_decision` / `run_candidate_portfolio` / `active_run_pointer` / `run_manifest` / `run_history` 在枚举域内**零读者** | ❌ 未进入 |
| 3 | **Gen-1 promoted result 是否真正成为 production decision input？** | **否**。09-30 run 虽 `promoted=true`，但无读者消费 pointer/candidate ⇒ 生产决策输入仍来自 legacy `decision_result` | ❌ 否 |
| 4 | **selector cutover 条件是什么？** | **当前代码级不存在通路**：`selectGuardedResult()` 硬编码 BASELINE 且 GUARDED 分支 `throw`。⇒ cutover 的**前置**是「**修改 selector 代码**（解除 GE-02 硬不变量）」**而非**翻配置开关；⛔ 须独立授权 | ❌ 通路不存在 |
| 5 | **`ml_effective` 条件是什么？** | ① 为 `gen1_guarded_effective_active` 的**单向 alias**（`schema.js:618`）；② 其上游 `effective_guarded` 须成立（须 selector 侧成立 + 守门全过）；③ 健康正控须成立（当前 `DEGRADED` ⇒ 阻断） | ⛔ 当前为 `false`（三重未满足） |
| 6 | **`auto_execution` 与 GE-04 的边界是什么？** | **不同轴**：`gen1_auto_execution` = **执行层开关**，schema 自述「恒 false」，属**代码级不变量**（⛔ 非授权可开）；GE-04 = **独立治理 Promotion Gate**（授权轴，当前 `NOT AUTHORIZED`）。⚠️ 二者不得互换，也不得由一个的通过推出另一个的通过 | ✅ 不同轴 |

---

## 8. 汇总表（A–E × 阻塞级别 × 能否只读推进）

| 类 | 条目数 | 🔴 高 | 🟡 中 | 🟢 低 | 能否**只读**推进 |
|---|:--:|:--:|:--:|:--:|:--:|
| **A 功能缺口** | 4 | 1（A-1） | 2 | 1 | ⛔ 否（A-1/A-2 需代码变更 + 授权） |
| **B 生产集成缺口** | 6 | 3 | 2 | 1 | ⛔ 否（B-1~B-3 需生产变更 + 授权） |
| **C Health / 安全** | 4 | 4 | 0 | 0 | ⛔ 否（全部落在 AG-1/2/3） |
| **D Evidence** | 5 | 3 | 1 | 0 | ⚠️ 部分（D-1 已完成；D-2/D-4 须先解 C 与 E） |
| **E Authorization** | 9 | — | — | — | ⛔ 否（**全部**须 owner 授权） |

⇒ **结论**：**当前不存在可只读推进的放行路径**；A / B / C / E 四类均须「生产变更 + 独立授权」，
D 类中的 Evidence 执行又**被 C（健康）与 E（授权）双重前置**。

---

## 9. 未决 / 待裁定（⛔ 本件不处置）

| # | 事项 | 关联 |
|---|---|---|
| 1 | **OBS-2** 2026-10-02 无引擎运行记录（须以 CLS 日志定性） | §1 第 5 环 |
| 2 | **OBS-3** `515880` 具体缺哪个必需特征未定位（`missing_features` 未持久化） | §4 C-1 |
| 3 | **F-7** 线上包注释引述的「**OD-4 §4.4 方案 B 只读冻结**」治理源文档**未定位** ⇒ ⛔ 不得当作已确认事实 | §3 B-3 |
| 4 | **B-6** `apiGateway` / `adminGateway` 线上身份未复读 ⇒ 是否单独立项做一次线上逐字节复核？ | §0 |
| 5 | **A-1** selector cutover 的兑现路径：落 **V3.6.6** 还是**独立生产变更授权**？ | §2 A-1 |
| 6 | **B-1** reader migration 的兑现路径与优先级（是否先于 Evidence execution？） | §3 B-1 |

---

## 10. 四块式零修改断言 + 复算命令

```text
ETF 仓库（载体树 _g1-contract-v5-20261002）：
- Git 跟踪文件：本件新增 1 个未跟踪文档（本件），⛔ 其余跟踪文件零修改
- Git 历史 / 分支 / 远端：零修改（⛔ 未 commit / push / tag）
- 未跟踪本地草稿：_diff_v5_v6.txt · scripts/gen1/evidence-capture/out/（既有，非本件产生）
其他本机文件：
- WorkBuddy 记忆文件：见本轮 memory 落档
- ⛔ _cb-connect-20260921/online-*（2026-09-01 快照）：零修改，仅读取
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- DB（decision_result / portfolio_snapshot / run_candidate_* / active_run_pointer /
      run_manifest / run_history / runtime_status / gen1_health_state）：零写入
- ⛔ 未调用 manualReviewConfirmed · 未写 gen1_health_state · 未加恢复端点 · 未改 circuit breaker
```

复算命令（全部只读）：

```bash
C="D:/AI-Projects/Codex/etf-decision-engine/_g1-contract-v5-20261002"

# 1) 生产读点（B-1 证据）
grep -n "orderBy" "$C/cloudfunctions/apiGateway/index.js" | grep -E "decision_date|snapshot_date"
grep -n "orderBy" "$C/cloudfunctions/adminGateway/index.js" | grep "decision_date"

# 2) selector 硬不变量（A-1 证据）
sed -n '73,101p' "$C/src/common/utils/gen1-guarded-selector.js"

# 3) reader-migration 状态字段（B-4/B-5 证据）
R="D:/AI-Projects/Codex/etf-decision-engine/etf-decision-engine/dist-functions/runDecisionEngine/common/utils/v365-active-read.js"
grep -n "V365_ENFORCE_SWITCH_DATE\|RUN_HISTORY_INDEX\|reader_migration_status\|REGISTERED" "$R"

# 4) 线上包零引用（B-1 证据；线上身份来源）
grep -rn "v365-active-read" "D:/AI-Projects/Codex/etf-decision-engine/_cb-connect-20260921/bundle-src" || echo "0 命中"

# 5) 线上 parity（部署身份）
tail -20 "D:/AI-Projects/Codex/etf-decision-engine/_cb-connect-20260921/parity_out_20261002.txt"

# 6) 本件 executable check
python scripts/gen1/evidence-capture/v6_health_blocker_diagnostic_check.py
```

⛔ **STOP**：本件为**只读初稿**，⛔ 不含任何授权、不含任何放行、⛔ 不进入 Freeze。
