# GEN-1 / PHASE 1 / Step 1.1-E1b-AB · **第 1 层治理裁定分析**

## A-1（决定 vs 计算）· B-3°（日期语义）· C-1°（五源）

```text
性质        = OWNER GOVERNANCE RULING 前的只读分析输入
本文件      = READ-ONLY GOVERNANCE-ANALYSIS INPUT
作者约束    = 本文件不替 owner 选择任何方案；只给可验证事实、约束与影响面
```

```text
OWNER SELECTION                 = NONE
SELECTOR SELECTION              = NONE
PLAN GROUP-A SELECTION          = NONE
CONTRACT BYTES CHANGED          = 0
PRODUCTION BYTES CHANGED        = 0
DB WRITE COMMANDS               = 0
PR #60 CHANGES                  = 0
```

---

## 0. 授权边界与本文的自我约束

本步**只做三件事**：① 复确认基线；② 对 A-1 / B-3° / C-1° 做事实 + 约束 + 方案影响分析；③ 画依赖图与最小前置集合。

本步**不做**：

- ⛔ 不替 owner 选择任何一个方案（不选 ①a / ①b / ①c，不选 selector，不选组 A 设计）；
- ⛔ 不修改 Evidence Contract（v4 零字节）；
- ⛔ 不修改 `c1_capture.py` 或任何脚本、生产代码、配置、DB；
- ⛔ 不修改 PR #60；
- ⛔ 不做 commit / push / PR / merge / deploy / freeze；
- ⛔ 不进入 Step 1.2 / PHASE 2 / PHASE 3。

本步**允许且已做**：只读查看契约／代码／已部署包／PR／Git 历史／云端 DB／云端 CLS 日志；纯只读字段映射与一致性分析；新增本报告。

---

## 1. Executive Summary

**一句话**：A-1 / B-3° / C-1° 三项的**事实基础已在实盘形成**，且三项之间的依赖是**有向的**（A-1 → 其余）。三项**均可基于既有实读数据裁定**，不需要新增取证；但三项的**文本落点**不同：A-1 与 C-1° 的任何分支都会触及 §3 / §5.3 / §5.4 的**规范文本**，B-3° 的「维持现状」分支则**零文本改动**。

三条最重要的可验证事实（本步新增或精确化）：

1. **F-24 / A-1 支撑**：`run_candidate_decision` 的**一行内混合了两个 lane 的字段** —— `gen1_run_id = gen1-eod-20260930142005894-b10c55`（Gen-1 EOD 22:20 链）而 `run_id = engine:2026-10-01:b1790812813101`（08:00 引擎链），`written_at = 2026-10-01T00:00:21.786Z`。⇒ candidate 行**不是单次运行的纯产物**；"sample 属于哪次运行"必须显式定义，不能默认。
2. **F-25 / A-1 + C-1° 支撑**：**唯一一次成功提升来自 `TCB_API` 来源的运行**（`request_id c6ca469a-cc0c-4b24-af4f-dd00b0477134`，北京 2026-09-30 22:01:12），**不是** `TRIGGER_TIMER` 链。而 v4 §5.6 的 `NATURAL_RUN_PROVENANCE` / CHAIN PROOF 要求"上游 `materializeIndicators` 有 `TRIGGER_TIMER` 调用 + 两跳同窗"。⇒ **能通过 §5.6 的运行（08:00 链）与能通过门 2/3 的运行（盘后）今天不是同一批**。
3. **F-28 / B-2 精确化**：`decision_result` 的**最后一次写入时刻** = `2026-09-30T00:00:55–57Z`（= 09-30 `08:00:55–57` 北京时间）。⇒ 现行 v4 §3 字段 1/4/7/8 绑定的，是一份**在 ENFORCE 生效之前**最后落盘的数据；此前只知"停在 09-29"，现知其**冻结时刻**。

**三项各自的"可裁性"结论（不含选择）**：

| 裁项 | 是否需要新增取证 | 是否可独立裁 | 是否必然触及规范文本 |
|---|---|---|---|
| **A-1** | 否 | ✅ 是 | ✅ 是（任何非「维持 decision_result」分支） |
| **B-3°** | 否 | ✅ 是 | ⚠️ 取决于分支：维持现状 ⇒ 否；扩展 host-local 或强制相等 ⇒ 是 |
| **C-1°** | 否 | ⚠️ 部分（manifest 可独立；pointer 与 A-1 双向耦合） | ✅ 是（只要新增任一源） |

---

## 2. Baseline Reconfirmation

### 2.1 审查客体与复算指纹（as-of 2026-10-02 11:28 +08；只读复算）

| 项 | 值 |
|---|---|
| v4 载体 | `_v4-contract-20260923/docs/gen1/GEN1_EVIDENCE_CONTRACT_V4.md` |
| 载体 HEAD | `8d1f1cde5effa8bf6eb3d88b780f84e3873337ef`（detached；tracked status = 空） |
| 字节 / 行 / 换行 | **38137 B** / **709 行** / 纯 CRLF（`crlf = 709`，即 LF 计数 = CRLF 计数） |
| sha256（落盘口径） | `80da4d99f9fdb5c9f54856210b5dc0fc06edcc8d8b2371a699f0bd5c5fa8f7c5` |
| sha256（LF 归一） | `74319398d8040ab5d409cacf9204e67891216c724868e6a3ba9d68fa1f2da07e` |
| git blob sha1（HEAD） | `ca6f049270675e468f6a984cb433b89411daa85e` |
| gen1 worktree | `gen1-worktree-20260916` @ `2e24ecd6ba5fa1d21b2c6337e24f6aa09c2a1781` |
| gen1 `git diff --stat HEAD` | 仅 1 file：`M docs/gen1/GEN1_DOC_ERRATA_20260916.md`（+35）—— **既有披露，非本步所为** |
| gen1 `git status --short` | `?? .workbuddy-ai/`、`?? docs/gen1/GEN1_EVIDENCE_CONTRACT_V2.md` —— 既存未跟踪物，非本步新建 |

**与上一份报告的一致性**：v4 sha256 与 `_v4-contract-20260923` HEAD 与 E-1b-AB 报告所载**逐位一致** ⇒ **基线未漂移**，可继续分析。

### 2.2 上一份报告核对

| 项 | 声明 | 实盘 | 一致 |
|---|---|---|---|
| 路径 | `outputs/evidence-watch-20260921/GEN1_STEP11_E1B_AB_GOVERNANCE_RULING_ANALYSIS_20261002.md` | 存在 | ✅ |
| 字节 / 行 / 换行 | 34616 B / 514 行 / LF | 34616 B / 514 行 / `crlf = 0` | ✅ |
| sha256 | `37c6b4ca…e3f7`（完整值见 §2.2.1） | 与上一轮交付注记逐位一致 | ✅ |
| mtime | — | `2026-10-02 11:06:21 +08`（本步未再触碰） | ✅ |

> 注：本步对该报告重新落盘复算，所得 sha256 与上一轮交付注记**逐位一致**；完整值见 §2.2.1。

**§2.2.1 E-1b-AB 完整 sha256**：`37c6b4ca6bf5ac0457d78e58d38249e61eff345e8be0ab5225d875f10dbce3f7`

（该值由本步复算，与上一轮报告交付注记**逐位一致**。）

### 2.3 PR #60 与既有登记项（只读复核）

| 项 | 实读（as-of 2026-10-02 11:28 +08） |
|---|---|
| PR #60 | `state = open` / `draft = false` / `merged = false` / `mergeable_state = behind` |
| head | `docs/gen1-evidence-contract-v4-draft` @ `8d1f1cde5effa8bf6eb3d88b780f84e3873337ef`（与载体 HEAD 同值） |
| base | `master` @ `e93f396870b601d49d61d3a6e955596bc91b2ad5` |
| 规模 | commits 3 / changed_files 1 / additions 709 / deletions 0 |
| body 内指纹 | blob sha1 `cbb9c07cedf27bef95936537b2d378dd1b937e4b` + content sha256 `d2cb53c44e550e631db45b209939d5a9badc6b2c639dfcfd99e38d1f2e619eb3` |
| **判定** | ⚠️ body 内指纹对应**第 1 提交**，而 head 是**第 3 提交**（`ca6f0492…` / `80da4d99…`）⇒ 既有登记项 **F-3 未变**，本步未处理 |

**F-11 ~ F-23 存量复核（不重复展开，仅确认仍在位）**：`F-11` `run_manifest.expected_trade_date` 名实不符；`F-13` 同 `decision_date` 多 run；`F-14` `v365_promotion_attempted = false`；`F-17` `RUN_HISTORY_INDEX = PENDING` / `V365_ENFORCE_SWITCH_DATE = null`；`F-18` `input_hash` 双重前缀（本步复算确认：`engine:engine:2026-10-01:b1790812813101`）；`F-19` `caller_*` / `pipeline_*` 全 null；`F-21` `publishable = true` 与 `NOT_PROMOTED` 属不同层级；`F-22` candidate 层已含 `decision_market_regime = crisis`；`F-23` 09-30 属 bootstrap 提升。

### 2.4 本报告交付元数据

| 项 | 值 |
|---|---|
| 报告路径 | `outputs/evidence-watch-20260921/GEN1_STEP11_E1B_AB_LAYER1_GOVERNANCE_ANALYSIS_20261002.md` |
| 文件大小（本文件） | **49241 B** |
| 行数（本文件） | **641 行**（LF） |
| 换行 | LF（`crlf = 0`） |
| SHA256 | 见同目录 sidecar `GEN1_STEP11_E1B_AB_LAYER1_GOVERNANCE_ANALYSIS_20261002.md.sha256`（⛔ 文件无法自含自身哈希） |
| 生成时刻 | **2026-10-02 11:33:15 +08**（本机时钟；UTC 亦记于 sidecar） |
| 写后断言 | **POS 72/72 PASS ／ NEG 21/21 零命中**（见 §9 / §10） |


---

## 3. A-1：决定 vs 计算

### 3.0 先把三个"对象"分开（否则 A-1 无法被回答）

现有讨论中"A-1 决定 vs 计算"常被压缩成一个开关，但实读显示至少存在**三个互相独立的对象**：

| 对象 | 定义 | 实盘载体 | 本步实读 |
|---|---|---|---|
| **DECISION（决定）** | 被生产**最终采纳**（authoritative）的那一份结果 | `active_run_pointer` 指向的 run；其"曾被接受"的凭据在 `run_history.promoted` | 仅 `engine:2026-09-30:b1790776862980` 一次 |
| **COMPUTATION（计算）** | 某一次引擎运行**算出来**的结果，无论后续是否被采纳 | `run_candidate_decision` / `run_candidate_portfolio`（按 `run_id`） | 10 行 = 2 run × 5 code |
| **OBSERVATION（环境/输入态）** | 输入与健康度上下文；**既不属决定也不属计算** | `runtime_status`（authority / health / ledger）、`ml_shadow_signal`（模型输出） | 单例 + 133 行 |

> ⚠️ 第三类**不是**前两类的子集：`runtime_status` 是**覆盖式单例**（最后写入者），`ml_shadow_signal` 由 22:20 的独立链写。把它们并入"决定"或"计算"都会产生错误推论。

### 3.1 A-1a —— "决定日期"与"计算日期"在什么语义下成立

**问题重述**：Evidence 的 sample 到底是在证明「某个交易日的最终决定」，还是「某次计算运行产生的结果」？

四个字段的语义锚定（实读 + 代码/契约依据）：

| 字段 | 语义 | 依据 | 是否等价于"某交易日的最终决定" |
|---|---|---|---|
| `decision_date` | **数据最新日（DATA DATE）** —— 该结果所依据的行情数据日 | v4 §3 字段 1 明写"数据最新日，非运行日" | ⛔ 否。两 run 的 `decision_date` **相同**（均 09-30），却分属"被采纳"与"被拒绝" |
| `calc_date` | 该 run 实际消费的最新行情数据日（**与 `decision_date` 同值**） | `run_candidate_decision.decision_date == calc_date`（10/10 行） | ⛔ 否，同上 |
| `run_manifest.expected_trade_date` | ⚠️ **运行日（RUN DATE / `snapshotDate`）**，但字段名读作"交易日" | F-11：`index.js` 写 `snapshotDate`，而门 2 拿它与 candidate `calc_date` 比 | ⛔ 否；且**名实不符** |
| `run_id` | **运行身份**：`engine:<RUN DATE>:<invoke_ms>` | 实读 `engine:2026-09-30:b1790776862980` / `engine:2026-10-01:b1790812813101` / `engine:2026-10-02:b1790899218283` | ⛔ 否。**同日多 run 会得到不同 `run_id`** |

**结论（事实层，不含选择）**：

- 在 ENFORCE 下，**"某个交易日的最终决定"不是一个原子对象**：同一个 RUN DATE 可能有 0 个、1 个或多个 run；同一个 DATA DATE 已实测出现 **2 个 run**（F-13）。
- `run_id` 能唯一标识"**某一次计算**"，但**不能**单独证明"**被采纳**"——后者需要 promotion 层凭据。
- ⇒ **"计算"的身份 = `run_id`；"决定"的身份 = 被 promotion 接受的 `run_id`**。二者只有在 promotion 成功时才重合。

### 3.2 A-1b —— 同一 `decision_date` 是否可有多个 run

| 检查项 | 实读结果 |
|---|---|
| 同一 `decision_date` 是否可以存在多个 run？ | ✅ **可以，且已实盘发生** |
| 当前实盘是否已证明？ | ✅ 是。`run_candidate_decision` 共 **10 行**：`engine:2026-09-30:b1790776862980`（5 行）与 `engine:2026-10-01:b1790812813101`（5 行），**两组 `decision_date` 均为 `2026-09-30`** |
| `(decision_date + code)` 是否足以唯一标识 sample？ | ⛔ **不足**。10 行按 `(decision_date, code)` 折叠后只剩 5 个键 ⇒ **键碰撞**（5 行信息被吞掉） |
| `(run_id + code)` 是否因此成为必要 identity？ | ✅ **必要**。实读 candidate 行的 `candidate_key = <code>`（例：`518880`），run 维度**只存在于 `run_id` 字段** ⇒ 唯一键**必须**含 `run_id` |

**推论（事实层）**：v4 §5.5「同一 `decision_date` 至多一个正式 bundle」的**预设**（一个 decision_date 对应一个产出）在 ENFORCE 下**已不成立**。该规则的改写是被 A-1 连带触发的（详见 §6）。

### 3.3 A-1c —— 三种 selector 的矩阵（⛔ 只给矩阵，不选）

| selector | Evidence 实际证明什么 | 优点 | 风险 | 对 A-1 的要求 |
|---|---|---|---|---|
| **S-LATEST**（任意最新 `run_candidate_*`） | 证明"最近一次**计算**"；**不**包含"被采纳" | 供给最大（凡跑完落候选即得）；不依赖 CAS | ① 可能证到生产**显式拒绝**的 run（10-01：`validation_passed = false` / `mixed_date_detected`）；② 无 pointer 绑定 ⇒ 与 §3 寻求的"authoritative"语义不符；③ 需自建"最新"择取规则 ⇒ 落入 `LATEST_BY_UPDATED_AT` 类反模式语义 | 要求 A-1 明确承认「样本 = 计算产物」；否则与契约意图不符 |
| **S-VALIDATED**（latest **且** `validation_passed`） | 证明"通过了**候选完整性门**、但**未被提升**"的计算 | 排除 schema / 完整性失败产物；不依赖 CAS | ① 今日会**回落到 09-30 run**（10-01 未过门 2）⇒ 与 S-PROMOTED 的差异区间**为空**，无法实测区分；② 仍可能证到**非 authoritative** 结果（若门 3 因并发/回退未过） | 要求 A-1 承认「计算合格 ≠ 被采纳」 |
| **S-PROMOTED**（仅消费 promoted + 有效 pointer） | 证明"生产**实际采纳**的**决定**" | 与 reader-migration 目标同构（`authority_selector = active_run_pointer.run_id`）；天然满足"防未 promoted 被捕获" | ① 供给 = 生产健康度函数（门 1 + 门 2 + 门 3）；② 今日 0 供给；③ H-1 若真 ⇒ 供给可能**结构性为零** | 要求 A-1 把"决定"与"计算"**分开**（否则 S-PROMOTED 无从定义） |

### 3.4 特别检查：「计算出来」与「最终被采用」是否必须区分

**不做价值判断，只列可验证事实与逻辑后果。**

| 事实 | 实读 | 逻辑后果 |
|---|---|---|
| 10-01 run 被生产**显式判为不成立** | `validation_passed = false` / `validation_reason = mixed_date_detected` / `v365_promotion_attempted = false`（**未到 CAS**） | 它**仍然**在 `run_candidate_decision` 中留下 **5 行** |
| 09-30 run 被生产**采纳** | `run_history.promoted = true` / `cas_reason = PROMOTED` / `read_after_write_consistent = true` | 它在同一集合中留下 **5 行** |
| 两者在"计算"层的形态 | **相同**：同 5 个 code、同 `decision_date = 2026-09-30`、同 `suggested_position`（513310 = 8.3、159582 = 7.1、其余 0）、同 `v361_baseline_stage` | ⇒ 在"计算"层**二者不可区分** |
| 两者在"提升"层的形态 | **不同**：`run_history.promoted` / `cas_reason` / `active_run_pointer.run_id` | ⇒ 只有"提升"层能区分 |

**⇒ 事实结论**：若 Evidence 的目标是证明「生产实际采用的 authoritative decision」，则**"计算出来"与"最终被采用"必须被区分**——因为二者在数据形态上不存在天然判别式，只能由 promotion 层字段区分。反过来，若目标只是"记录引擎算了什么"，则**不需要**区分。

> ⛔ 本步不回答"目标应当是哪一个"；该问句即 A-1 本身。

### 3.5 本步新增事实（支撑 A-1，非选择）

| 事实 | 实读 |
|---|---|
| `run_candidate_decision` 的**一行混合两个 lane** | 该行含 `run_id = engine:2026-10-01:b1790812813101`、`written_at = 2026-10-01T00:00:21.786Z`，同时含 `gen1_run_id = gen1-eod-20260930142005894-b10c55`（**Gen-1 EOD 22:20 链**的运行 id）；`decision_source = V361_SAFETY_CORE` |
| ⇒ 治理含义 | "一个 sample 属于哪一次运行"**不是自明的**：主结果字段与 `gen1_*` 信号字段来自**不同时间、不同链**。若契约把 sample 定义为"某 run 的产物"，须**显式声明**哪些字段来自该 run、哪些来自 22:20 lane |
| 唯一一次提升的来源 | `request_source = TCB_API`（`runDecisionEngine` 无 trigger，链式调用亦表现为 `TCB_API`），时刻北京 `2026-09-30 22:01:12.092` |
| ⇒ 治理含义 | 该 run **不在** 08:00 链的窗口内（v4 §5.6 的 CHAIN PROOF 以 08:00 两跳为锚）⇒ **它不可能通过 §5.6 的来源证明**（详见 §8 F-25） |

---

## 4. B-3°：RUN DATE 与 CALENDAR TRADE DATE

### 4.1 实例化表（三个 run，全部实读）

| | 09-30 22:01 run（唯一 promoted） | 10-01 08:00 run（止步门 2） | 10-02 08:00 run（止步门 1） |
|---|---|---|---|
| **(I) RUN IDENTITY** | `engine:2026-09-30:b1790776862980` / `run_manifest.revision = 1` / `pointer revision = 1` | `engine:2026-10-01:b1790812813101` / `revision = 2` / pointer **未变**（仍 rev 1） | `engine:2026-10-02:b1790899218283` / **无 manifest 行** / pointer 未变 |
| **(II) RUN DATE** | `run_manifest.expected_trade_date` = **2026-09-30**；`run_candidate_portfolio.snapshot_date` = **2026-09-30**；`runtime_status.decision_date` = **2026-09-30** | **2026-10-01** / **2026-10-01** / **2026-10-01**（现单例） | （无 manifest / 无 candidate）；运行日 = **2026-10-02** |
| **(III) DATA DATE** | `run_candidate_decision.decision_date` = `calc_date` = **2026-09-30**；`decision_result.decision_date` = **2026-09-29** | candidate = **2026-09-30**；`decision_result` 最新 = **2026-09-29**（未推进） | 无 candidate；`materializeIndicators` 返回 5 票 `calc_date`：**513310 = 2026-10-01**、其余 4 票 = **2026-09-30** |
| **(IV) CALENDAR TRADE DATE** | `v365_run_integrity.expected_trade_date` = **2026-09-30**；`observed_latest_date` = **2026-09-30**；`effective_as_of_trade_date` = **2026-09-30**；case = `CASE_A_ALL_EXPECTED`；`calendar_version = cn-a-share-2026.1` | expected = **2026-09-30**；observed = **2026-09-30**；effective = **2026-09-30**；case = `CASE_A_ALL_EXPECTED` | expected = **2026-09-30**；observed = **2026-10-01**；effective = **null**；case = **`CASE_B_PARTIAL_STALE`** |
| 门位置 | 门 1 ✅ / 门 2 ✅ / 门 3 ✅ ⇒ `PROMOTED` | 门 1 ✅ / 门 2 ❌（`mixed_date_detected`） | 门 1 ❌（`input_health = BLOCKED`）⇒ **连 candidate 都未写** |

> **10-02 run 的上下游 request_id（实读，供追溯）**：
> 上游 `materializeIndicators` = `e68ea0fd-b65a-4821-862c-21daae69e669`（`request_source = TRIGGER_TIMER`，北京 08:00:05.543 → 08:00:23.438）；
> 下游 `runDecisionEngine` = `a0eb9dbf-77c7-427e-a389-2f7287499f41`（`request_source = TCB_API`，北京 08:00:18.278 → 08:00:23.418，`[V365][BLOCKED] input_health_BLOCKED:CASE_B_PARTIAL_STALE expected=2026-09-30 observed=2026-10-01`）。
> 09-30 22:01 run 的 `request_id` = `c6ca469a-cc0c-4b24-af4f-dd00b0477134`（`request_source = TCB_API`，北京 22:01:12.092）。

**派生观察**：`(II) == (IV)` **仅**在 09-30 22:01 一次成立；10-01 与 10-02 两次均 `(II) ≠ (IV)`。

### 4.2 B-3-a —— 是否只是"名称相同、语义不同"

**✅ 是。且已有一手反例。**

```text
同一字段名 expected_trade_date，两个载体、两个语义：
  run_manifest.expected_trade_date        = (II) RUN DATE      （写 snapshotDate；北京运行日）
  v365_run_integrity.expected_trade_date   = (IV) CALENDAR TRADE DATE（日历权威源 cn-a-share-2026.1）
```

**实测反例（同一次运行内即不同）**：

- 10-01 08:00 run：`run_manifest.expected_trade_date = 2026-10-01` vs `v365_run_integrity.expected_trade_date = 2026-09-30` ⇒ **同名不同值**。
- 10-02 08:00 run：**无 manifest 行**，但 `v365_run_integrity.expected_trade_date = 2026-09-30` 而运行日为 `2026-10-02` ⇒ 二者**连"同一次运行同值"的偶然关系都没有**。

⇒ 二者关系是**偶然巧合**（仅在"运行日恰为最近已完成交易日"时同值），**不是定义关系**。既有登记项 `F-11`（manifest 侧名实不符）与 `F-12`（pointer 继承同一名实不符）是本条的直接证据。

### 4.3 B-3-b —— 若契约把二者都定义为 host-local / contextual metadata

**情形定义**：(IV) 已是 host-local（v4 §3.5 现行声明）；本条问的是**是否把 (II) 也一并判为 host-local**。

**可以继续成立的规则**（不引用 (II) 者）：

| 规则 | 引用字段 | 是否受影响 |
|---|---|---|
| §5.4 规则 1（最新自然运行可证） | `invocation_log` | ✅ 继续成立 |
| §5.4 规则 2（`updated_at` 前进） | `runtime_status.updated_at`（wall clock） | ✅ 继续成立 |
| §5.4 规则 3（恰 5 只 Main5） | `decision_result.code` | ⚠️ 继续成立，但该源在 ENFORCE 下停写（属 B-2 范畴） |
| §5.4 规则 4（五行 `decision_date` 相同） | (III) | ✅ 继续成立 |
| §5.4 规则 5（`ml_shadow_signal.date` == `decision_date`） | (III) | ✅ 继续成立 |
| §5.4 规则 6（code set 一致） | `ml_shadow_signal.code` | ✅ 继续成立 |
| §5.4 规则 8（缺源 ⇒ INVALID） | 五源齐备 | ✅ 继续成立 |
| §5.4 规则 9（同 `decision_date` 至多一个 bundle） | (III) | ⚠️ 语义仍成立，但**预设被 F-13 推翻**（须配套改，见 §6） |

**必须改变的规则**（引用 (II) 者）：

| 规则 | 为何必须改 |
|---|---|
| **§5.4 规则 7**（`portfolio_snapshot.snapshot_date` == `runtime_status.decision_date`） | 两侧**都是 (II)**；若 (II) 移出契约，本规则**失去契约内的判别对象**，必须删除、改绑或降级为诊断 |
| **§3.1 组 A**（`runtime_status.decision_date` / `portfolio_snapshot.snapshot_date`「二者必须相等」） | 同上；且其右端 `runtime_status.decision_date` 是**覆盖式单例**（详见 §4.4 的 B-β 代价） |
| **§5.3 bundle 内的 `decision_date`** | 脚本实读：`run_date = rs.get("decision_date")`，并以此匹配 `portfolio_snapshot.snapshot_date` ⇒ 该字段即 (II)；须澄清或替换 |
| **§9.1 来源表** | 现表未列 (II) 的任何字段来源；若 (II) 出场须同步 |

**是否会削弱 Evidence 的可验证性？**

**会，且削弱的是同一处**：§5.4 规则 7 的唯一功能是"**证明五源属于同一次运行的同一输出态**"。若 (II) 整体移出契约，则"五源同源"只剩**一条**证据（§5.6 的 `invocation_log` 时间窗），从"时间窗 + 组 A 双证据"降为"单证据"。

⚠️ 但须同时指出**反向事实**：现行规则 7 的两侧**并非同源**（左端来自 run 产物、右端来自覆盖式单例），因此它今天已经**不是**一个可靠的"同源"证明——今天的 FAIL（组 A `09-30` vs `10-01`）正是它把"历史 run 的产物"与"当前单例"作比的产物。

⇒ 该条的准确表述是：**移出 (II) 会减少一条（本就不可靠的）证据；保留 (II) 则需先解决单例问题**。两个方向都必须在生成时显式登记，不能默认。

### 4.4 B-3-c —— 若契约强制 (II) == (IV)

**当前生产运行中会产生什么结果？**

| run | (II) | (IV) | 强制相等后的判定 |
|---|---|---|---|
| 09-30 22:01 | 2026-09-30 | 2026-09-30 | **PASS** |
| 10-01 08:00 | 2026-10-01 | 2026-09-30 | **FAIL** |
| 10-02 08:00 | 2026-10-02（运行日） | 2026-09-30 | **FAIL** |

**是真实异常还是结构性误杀？**

**结构性误杀。** 依据（可复算）：

- (IV) 的定义 = **日历权威源上的"最近已完成交易日"**；08:00 运行时，当日尚未开盘 ⇒ (IV) **必然**是"上一交易日"。
- (II) 的定义 = **`snapshotDate`（北京运行日）** ⇒ 08:00 运行时 (II) **必然**是"当日"。
- ⇒ 只要 (II) ≠ (IV) 的定义不变，**每一个 08:00 运行都必然 FAIL**；这不是数据异常，而是**定义差**。10-01 run 的 `date_alignment_case = CASE_A_ALL_EXPECTED`（输入对齐完全正常）却被强制相等判 FAIL，即证。

**是否存在"无需修改生产代码即可自然满足"的情形？**

**存在，且已被实读观测到**：仅当运行时刻**晚于当日数据物化**时（如 09-30 22:01 的运行），(II) 与 (IV) 才自然同值。

⚠️ 但须同时登记其代价：即便自然满足，该 run **仍无法通过 §5.6 的 CHAIN PROOF**（22:01 不在 08:00 两跳窗口内，且无上游 `TRIGGER_TIMER` 跳）⇒ 见 §8 `F-25`。⇒ **"(II)==(IV) 自然满足"与"§5.6 自然满足"今天不是同一批运行。**

### 4.5 B-3-d —— §3.5 与 §5.4 规则 7 的依赖关系

**先给一条文本事实（本步新发现）**：v4 §3.5 的表格把 `expected_trade_date` 的"是否落入 Evidence 消费的集合"写为「⛔ **否** —— 只进 `run_manifest`」，而 `run_manifest` **正是 (II)（运行日版）的载体**。⇒ §3.5 在**字面上把 (IV) 的排除**与**(II) 的落点**写在同一个单元格里，未区分同名不同义。这是 §3.5 的**隐含漏洞**，也是 B-3° 必须裁的直接原因。

**依赖链**：

```text
B-3° 的选择
   │
   ├─ 分支甲「维持现状」：(IV) 已 host-local、(II) 仍入契约
   │      ↓ §3.5 字段语义变化：无（但须补一句"同名不同义"澄清，属澄清性文字）
   │      ↓ §5.4 规则 7 是否同步调整：不必因本分支而调整（但 B-2° 会另行要求）
   │      ↓ 是否影响 Contract generation：⛔ 若仅澄清，可不升版；⛔ 需 owner 明确认定"澄清 ≠ 修正"
   │
   ├─ 分支乙「(II) 与 (IV) 同判 host-local」
   │      ↓ §3.5 字段语义变化：(II) 进入 host-local 清单 ⇒ §3.5 表格须扩行
   │      ↓ §5.4 规则 7 **必须**删除/改绑/降级（其两侧皆为 (II)）
   │      ↓ §3.1 组 A **必须**重写（同上）
   │      ↓ §5.3 bundle 内 `decision_date` 语义须澄清
   │      ↓ **影响 generation：是**（触及规范文本，非纯澄清）
   │
   └─ 分支丙「契约强制 (II) == (IV)」
          ↓ §3.5 须新增一条"强制相等"声明（与"不扩展为三日期"的关系须重述）
          ↓ §5.4 须新增对应规则或改写规则 7
          ↓ 后果：今日 100% FAIL（§4.4 已证）⇒ 须显式登记为**已知情误杀**
          ↓ **影响 generation：是**
```

⛔ 本步不判哪个分支正确；上表只给出**每个分支的文本落点**。

---

## 5. C-1°：五源是否新增 `run_manifest` / `active_run_pointer`

### 5.1 现行五源逐条（v4 §5.3 + `c1_capture.py:194–200`）

| # | source | current role | current fields（契约列举） | current reader（脚本实读） | 是否属于 **authoritative identity** |
|---|---|---|---|---|---|
| 1 | `runtime_status` | eligibility / authority / health / 运行日锚点 | `decision_date`、`updated_at`、`gen1_authority`、`gen1_counterfactual_canary_active`、`gen1_health_status`、`gen1_health_gate_status`、`gen1_counterfactual_ledger_ok`、`gen1_production_write`、`gen1_auto_execution` | `c1_capture.py:156`（`find` + 取 `key == 'runtime-status'`） | ⛔ **否** —— 覆盖式单例，只反映**最后写入者** |
| 2 | `decision_result` | 主样本字段 1 / 4 / 7 / 8；组 B 左端 | `decision_date`、`v361_baseline_stage`、`suggested_position`、`gen1_counterfactual_suggested_position` | `:158`（`sort: decision_date:-1, limit 30`） | ⚠️ v3.0 / v4.0 **现行文本把它当主读源**，但 ENFORCE 下**已停写** ⇒ 其"身份"在**事实上失效** |
| 3 | `ml_shadow_signal` | 模型 signal（域 / 概率 / 快路径）+ 组 B 右端 | `date`、`code`、`domain_status`、`calibrated_probability`、`ml_probability`、`ml_fast` | `:160` | ⛔ 否（§9.3 已定性 lane-local） |
| 4 | `portfolio_snapshot` | `regime`（v4 改绑目标）+ 组 A 左端 | `snapshot_date`、`decision_market_regime`、`market_regime` | `:162` | ⚠️ **混合轴** —— run 产物字段与 MUTABLE 资产字段同集合（`adminGateway.persistLiveSnapshot` 另有写方） |
| 5 | `invocation_log`（CLS） | `NATURAL_RUN_PROVENANCE` / CHAIN PROOF | 上游 / 下游 `request_id` + `request_source` + 时间窗 | `:175–192` | ✅ **唯一**能证明"这次运行真的发生过"的**外部**证据 |

**⚠️ 五源结构上缺失的东西（本步的关键事实）**：

```text
现行五源中，没有任何一源携带 "promotion / authoritative" 身份。
其唯一载体是：
    active_run_pointer.run_id          （单例、可变）
    run_history.promoted               （逐 run 一行）
而 active_run_pointer 与 run_history **均不在五源之内**。
```

⇒ 这就是 C-1° 之所以成为承重裁项的**结构性原因**：若不新增源，则"该 sample 是 production authoritative 的那一份"**在契约内无字段可证**。

### 5.2 C-1a —— 若加入 `run_manifest`

| 问题 | 事实（实读） |
|---|---|
| 能证明什么？ | ① 该 run 的 (I) 身份（`run_id` / `revision` / `status` / `candidate_class` / `finality_health`）；② **门 2 的结果**（`validation_passed` / `validation_reason`）；③ `expected_codes`（完整候选集声明） |
| 解决哪一个已有问题？ | ① 使"该 run 是否为**完整候选集**"可**自证**（现只能靠 §5.4 规则 3 检查"5 行存在"，无法区分"应有 5 只"与"实到 5 只"）；② 提供 `validation_passed` ⇒ 使 **S-VALIDATED** 成为**可实施**的 selector（否则无从判定）；③ 提供 `revision` ⇒ 支撑"同一 `run_id` 是否被重写"的判据 |
| 是否与 candidate 数据重复？ | **部分重复**：`run_id` / `expected_codes` / `input_hash` 与 candidate 行重叠。**不重复**：`validation_passed` / `validation_reason` / `revision` / `finality_health` **只在 manifest** |
| 是否可能把 run-date 与 data-date 混在一起？ | ⚠️ **是，且这是本项最大风险**。manifest 的 `expected_trade_date` 是 **(II) RUN DATE**（实读 10-01），而门 2 却拿它与 candidate 的 `calc_date`（**(III) DATA DATE**）比较 ⇒ 若 Evidence 直接消费该字段而不改名/不标注，会把 **F-11 的名实不符带进契约层** |

### 5.3 C-1b —— 若加入 `active_run_pointer`

| 问题 | 事实（实读） |
|---|---|
| 能证明什么？ | **当前 authoritative run 的身份**：`run_id` + `revision` + `scope = production` + `updated_at`（实读：`active_run_pointer::production` / `engine:2026-09-30:b1790776862980` / `revision = 1` / `updated_at = 2026-09-30T14:01:11.797Z`） |
| 是否能证明 promotion？ | ⚠️ **部分**。pointer 存在 ⇒ **至少发生过一次提升**；但 pointer **只有当前值**（1 行、`$set`）⇒ ⛔ **不能**证明"某**历史** run 曾被提升"，也 ⛔ **不能**证明"任何 run 被**拒绝**"（拒绝不留痕于 pointer） |
| 是否能证明"当前 sample 就是 production authoritative sample"？ | ⚠️ **仅在 `sample.run_id == pointer.run_id` 且读取时刻一致时**。由于 pointer 可变，"**读取时刻**"本身成为证据的一部分 ⇒ 必须记录读到的 `pointer_revision` + 读取时间戳，否则不可复现 |
| `pointer_revision` 是否需要进入 sample identity？ | **事实依据**：pointer 是覆盖式单例（实测 1 行 / `revision = 1`），一旦前进，历史 sample **无法回证"当时 pointer 指向我"** ⇒ **若不记 `pointer_revision`，authoritative 属性不可复现**。⚠️ **但记 `pointer_revision` 也不够**：该 revision 是**当前值**，历史值不保留（`run_history.promoted_from_pointer_run_id` 实测为 `null`） |

### 5.4 字段之间的证明关系（⛔ 不自行简化）

```text
run_id
    证明 「哪一次计算」                      —— 唯一 · 单值 · 必进 identity
    ⛔ 不证明「被采纳」

run_manifest.revision
    证明 「同一 run_id 的第几次写入」          —— 防"同 run 读到不同版本"
    ⛔ 不证明「被采纳」（实读 10-01 revision = 2 且从未被采纳）

active_run_pointer.run_id
    证明 「此刻 authoritative 是谁」          —— 单例 · 可变
    ⛔ 不证明「历史某 run 曾被采纳」

active_run_pointer.revision
    证明 「pointer 被改动过几次」             —— 单例 · 可变
    ⛔ 不提供历史值

run_history.promoted / promoted_at
    证明 「该 run 曾被接受」                  —— 逐 run 一行 · 本步实测 2 行 = 2 run
    ✅ 是现行字段中**唯一可复现**的"采纳"凭据

run_history.read_after_write_consistent
    证明 「提升后回读一致」                    —— 幂等 / 可读性证据
    ⛔ 不是身份，也不是"采纳"本身（它为 true 时 promoted 已为 true）

CAS 语义（classifyPointerPromotion：bootstrap / ALREADY_ACTIVE / expected / 单调 revision）
    证明 「指针变更被原子保护」                —— 属**写入侧**保证
    ⛔ 不产生可读凭据；拒绝只体现为 v365_cas_reason = null（实读 10-01 即此）
```

**⇒ 证明关系的"最小完备组合"（事实层）**：`run_id` ＋ `run_history.promoted`（如需"当前性"，再叠加 pointer 的**即时**比对与 `pointer_revision` 快照）。⛔ 只靠 pointer **不能**反推历史；⛔ 只靠 manifest **不能**反推"被采纳"；⛔ `read_after_write_consistent` **不能**替代 `promoted`。

### 5.5 C-1c —— 四种源组合的方案矩阵（⛔ 只分析，不选择）

| 方案 | 新增证明能力 | 新增复杂度 | 潜在重复 | 历史可复现性 | 与 selector 的耦合 | 与 run identity 的耦合 |
|---|---|---|---|---|---|---|
| **不新增**（现五源） | 无新增 | 无 | — | — | **只能支撑 S-LATEST**（无法判"采纳"） | ⛔ 缺 run 维度 ⇒ identity 缺环 |
| **+ manifest** | 门 2 结果（`validation_passed`）、`revision`、完整候选集声明 | **低**（多读一集合，1 行/run） | `run_id` / `expected_codes` / `input_hash` 与 candidate 重叠 | **中** —— manifest 逐 run 一行，但带 `revision` ⇒ **同一 run 重写会覆盖旧值** | **强**：S-VALIDATED 的**必要**输入 | 提供 `revision`；仍**不**提供"采纳" |
| **+ pointer** | 当前 authoritative 身份 | **低**（1 行） | 仅 `run_id`（与 manifest / candidate 重叠） | **弱** —— 单例，历史不可回证 | **强**：S-PROMOTED 的**必要**输入 | 提供"当前"绑定；**不**提供历史 |
| **+ 两者** | 上述全部 **＋** 具备区分"计算 vs 采纳"的最小字段面 | **中**（六源；须处理三源间 `run_id` 一致性与读取顺序） | 三源互有 `run_id` / `expected_trade_date` 重叠（**且 manifest 与 pointer 的 `expected_trade_date` 同为 (II)**，实读同值） | **仍需再叠加 `run_history`** 才达到"强"；仅 manifest + pointer **达不到** | 三种 selector 均可支撑（覆盖面最大） | 完整（`run_id` + `revision` + `pointer_revision`） |

**矩阵之外的一条硬事实**：

```text
manifest 与 pointer 都**不是** append-only 语义：
    run_manifest   带 revision ⇒ 可被重写（同 run 多次写入会覆盖）
    active_run_pointer           ⇒ 单例，可被覆盖
本步实测中"逐 run 一行、且含 promoted / promoted_at"的，是 run_history（2 行 = 2 run）。
⇒ 若目标是"历史可复现的采纳证明"，三源中真正提供该性质的是 run_history，
  而 run_history **不在本裁项的两个候选之内**。
```

⛔ 本步不主张"应当加入 run_history"；只登记该事实，供 owner 在 C-1° 中一并考虑或另行立项。

---

## 6. Cross-Dependency Matrix

### 6.1 依赖图（三个裁项 × 下游文本/语义）

```text
A-1（决定 vs 计算）
 │
 ├──→ selector 语义（S-LATEST / S-VALIDATED / S-PROMOTED 各自的"证明什么"）
 │        └──→ §3 字段主读源（candidate vs pointer 绑定链）
 │
 └──→ run identity（是否必须 (run_id, code)）
          └──→ §5.5「one-decision-date」预设的改写

B-3°（(II) 与 (IV) 是否同判 host-local）
 │
 ├──→ date semantics（(II) 是否留在契约内）
 │        └──→ §3.1 字段表与 (II) 相关的解释
 │
 └──→ §5.4 规则 7 ＋ §3.1 组 A（两侧皆为 (II)）
          └──→ §5.3 bundle 的 decision_date 语义

C-1°（是否新增 manifest / pointer）
 │
 ├──→ authoritative identity（契约内是否有"采纳"字段）
 │        └──→ §5.3 源清单（五源 → 六/七源）
 │
 └──→ sample identity（sample_key / pointer_revision）
          └──→ §5.5 与 §5.2 fail-closed 的适用面
```

### 6.2 哪些可以独立裁定 / 哪些必须等 selector / 哪些必然要求 generation revision

| 裁项 | 可否独立裁定 | 若不能，等谁 | 是否必然要求 generation revision |
|---|---|---|---|
| **A-1** | ✅ **可独立裁**（它只问语义） | — | ⚠️ **取决于分支**：任何"观察计算/观察采纳"的分支都会改主读源 ⇒ **是**；"维持现状"分支不改文本但改 activation 语义 ⇒ 记入 activation 面而非规范面 |
| **B-3°** | ✅ **可独立裁**（纯日期语义） | — | ⚠️ 分支甲（维持现状）⇒ **否**（仅澄清）；分支乙（(II) 同判 host-local）⇒ **是**；分支丙（强制相等）⇒ **是** |
| **C-1a（manifest）** | ✅ **可独立裁** | — | ✅ **是**（§5.3 源清单 + §5.4 可能新增一致性规则 + §9.1） |
| **C-1b（pointer）** | ⚠️ **不宜独立裁**（与 A-1 双向耦合） | **A-1** | ✅ **是** |
| **B-2°（组 A 取哪条备选）** | ⛔ **不可**（两侧字段取决于 selector） | **A-1（且受 B-3° 分支约束）** | ✅ 是（§3.1 组 A + §5.4 规则 7） |
| **C-2°（§5.4 规则 1/2 是否改按 pointer revision）** | ⛔ **不可** | **A-1** | ✅ 是 |

**"一旦裁定就必然要求 generation"的完整集合（在 ①b 分支下）**：`A-1`（非维持现状时）· `B-3°` 分支乙/丙 · `C-1a` · `C-1b` · ⇒ 由于 C-1a 已必然要求 generation，**只要 owner 选择新增任一源，本轮就至少需要一次新的 CONTRACT GENERATION**。

### 6.3 A-1 → B-3° 的一个**具体连带**（本步新增，用于消除"三个裁项互相独立"的错觉）

| 若 A-1 判 | 则 B-3° 分支乙（(II) 同判 host-local）的后果 | 理由 |
|---|---|---|
| **观察"计算"**（S-LATEST / S-VALIDATED） | §5.4 规则 7 **仍可能**以"组 A 跨源比对"的形式保留（左端用 candidate），但会继承 §4.3 的单例问题 | 左侧字段变成了 run 产物，规则可重新定义为"run 内 / run 间"两类之一 |
| **观察"决定"**（S-PROMOTED） | §5.4 规则 7 **必须**改为 run 内自洽（同源）或降级为诊断 | pointer 仅指向**一个** run ⇒ 跨源比对（对 `runtime_status` 单例）会**必然误杀历史 bundle**（上一报告 B-β 的代价） |

⇒ **B-3° 的文本落点不能与 A-1 同批裁**（与上一报告 §8.2 的顺序结论一致）。

---

## 7. Minimal Decision Set

**问题**：为了让下一步能够合法进入 A-2 / A-3 / B-1° / B-2°，A-1、B-3°、C-1° 三项中哪些**必须先确定**？

### 7.1 最小前置集合

```text
最小前置集合 = { A-1 }
```

**依赖理由（逐条）**：

| 待进入的裁项 | 是否以 A-1 为前置 | 理由 |
|---|---|---|
| **A-2**（是否接受"Evidence 供给被生产健康度阻断"） | ✅ **是** | 该问题的**存在性**由 A-1 决定：若 A-1 判"观察计算"，门 2 / 门 3 不构成供给约束 ⇒ **A-2 的问题不成立**；只有 A-1 判"观察决定"时 A-2 才成其为问题 |
| **A-3**（是否采用 S-VALIDATED） | ✅ **是** | A-3 是 selector 的细化，而 selector 集合本身由 A-1 划定 |
| **B-1°**（是否要求 `promoted && read_after_write_consistent` 双条件） | ✅ **是** | 该条**预设"采纳"是必需品** ⇒ 只有 A-1 判"观察决定"时才有意义 |
| **B-2°**（组 A 取哪条备选） | ✅ **是** | 组 A 两侧字段取决于 selector ⇒ A 未定则四条备选**无法评估**（上一报告已确认） |

### 7.2 可以延后的项

| 裁项 | 可否延后 | 限定条件 |
|---|---|---|
| **B-3°（裁定本身）** | ✅ 可延后 | 其**下游文本改法**（§3.1 组 A / §5.4 规则 7）**不可**先于 A-1 动 |
| **C-1a（manifest）** | ✅ 可延后 | manifest 对三种 selector 都有价值 ⇒ 不阻塞 A-2 / A-3 / B-1° / B-2°；但一旦决定新增即为 generation 项 |
| **C-1b（pointer）** | ⚠️ **视 A-1 而定** | 若 A-1 判"观察决定"，pointer 是**必需** ⇒ 退化为与 A-1 **同批**；若判"观察计算"，可真正延后 |

### 7.3 最小集合的两种表述（供 owner 取用，⛔ 不含选择）

```text
严格最小值  = { A-1 }                      ← 足以合法进入 A-2 / A-3 / B-1° / B-2°
实际最小值  = { A-1, C-1b }                ← 因为若 A-1 判"观察决定"，C-1b 立即变成必需
```

⛔ 本步不建议 owner 选哪个表述；只指出：**在 A-1 之前，B-3° 与 C-1a 的任何文本动作都不能发生**（否则会产出对不上 selector 的草案），而 **C-1b 不能晚于 A-1**。

---

## 8. New Findings（仅真实新发现，均为本步实读）

| # | 事实 | 治理含义（本步只登记，不处理） |
|---|---|---|
| **F-24** | `run_candidate_decision` 的**一行混合两个 lane**：`run_id = engine:2026-10-01:b1790812813101` ＋ `written_at = 2026-10-01T00:00:21.786Z` ＋ **`gen1_run_id = gen1-eod-20260930142005894-b10c55`**（Gen-1 EOD 22:20 链的运行 id）；`decision_source = V361_SAFETY_CORE` | candidate 行**不是单次运行的纯产物** ⇒ 若契约把 sample 定义为"某 run 的产物"，须**显式声明**哪些字段来自该 run、哪些来自 22:20 lane，否则 sample identity 描述与事实不符 |
| **F-25** | **唯一一次成功提升来自 `request_source = TCB_API` 的运行**（`request_id c6ca469a-cc0c-4b24-af4f-dd00b0477134`，北京 `2026-09-30 22:01:12.092`），**不在** 08:00 两跳窗口内；而 v4 §5.6 的 CHAIN PROOF 以"上游 `materializeIndicators` 有 `TRIGGER_TIMER` 调用 ＋ 两跳同窗"为必要证明 | **结构性张力**：能通过 §5.6 的运行（08:00 链）与能通过门 2 / 门 3 的运行（盘后）**今天不是同一批** ⇒ 选 S-PROMOTED 时，"供给"与"来源可证"可能**同时**不成立。⛔ 本步不判是否异常、不主张改生产 |
| **F-26** | 09-30 run 的 `portfolio_publish = { "created": true, "deferred": true }` | `deferred` 的语义本步**未核实**；若它影响"candidate 何时可读"，则 pointer 绑定读取的**即时性**须复核 |
| **F-27** | `materializeIndicators` cron = `0 0 8 * * 1-5 *`（**周一–周五**）**不识别交易日历**；实测 10-02（周五）照常触发并进入 `CASE_B_PARTIAL_STALE`。另：由日历口径反推 —— 10-01 的 `expected_trade_date` **未推进**（10-01 与 10-02 两次运行的日历期望均为 09-30）⇒ **10-01 非交易日** | 08:00 链在非交易日会自然产生"必 FAIL"的运行 ⇒ 供给进一步收窄。⛔ 本步只登记，不判是否异常、不主张改触发器 |
| **F-28** | `decision_result` 的**最后一次写入时刻** = `2026-09-30T00:00:55–57Z`（= 北京 `09-30 08:00:55–57`），即 **ENFORCE 切换区间 `(09-30 08:00, 09-30 22:01]` 之前** | 把 B-2「主读源已停写」从"停在 09-29"精确化为"**冻结时刻 = 09-30 08:00**" ⇒ 现行 v4 §3 字段 1 / 4 / 7 / 8 绑定的是**ENFORCE 生效前**最后落盘的数据 |
| **F-29** | v4 §3.5 表格把 `expected_trade_date` 的落点写为「只进 `run_manifest`」，而 `run_manifest` 承载的是 **(II) 运行日版**；同日 `v365_run_integrity` 承载 **(IV) 日历版** | §3.5 的排除声明**未区分同名不同义** ⇒ B-3° 的裁定文本须同时修 §3.5 的这一格，否则契约自身保留一对同名不同义的字段 |

---

## 9. POS Assertions（写后内容断言）

**断言口径**：对报告全文做**子串匹配**；POS 缺失项非空即视为失败（失败须先分辨「断言串写错」与「未落盘」）。断言在**占位块替换为 dummy 的版本**上执行，故结果与最终版等价。

**POS 结果**：**72/72 PASS**（缺失项：无）

**NEG 结果**：**21/21 零命中**（命中项：无）

| 组 | 断言条数 | 结果 |
|---|---|---|
| POS | 72 | 全部命中 |
| NEG | 21 | 全部零命中 |


**POS 已覆盖的检查面（要求项 → 对应断言组）**：

| 要求项 | 对应 POS 组 |
|---|---|
| 报告实际存在且元数据与实盘一致 | §2.4 元数据块 ＋ 字节/行/换行/指纹串 |
| A-1 / B-3° / C-1° 三项均完成只读分析 | `A-1a` / `A-1b` / `A-1c`、`B-3-a`…`B-3-d`、`C-1a`…`C-1c` |
| 三项均未做 owner 选择 | `OWNER SELECTION = NONE` / `本文件不替 owner 选择任何方案` |
| selector 未选择 | `SELECTOR SELECTION = NONE` |
| Contract 未修改 | `CONTRACT BYTES CHANGED = 0` ＋ v4 双 sha256 |
| production 未修改 | `PRODUCTION BYTES CHANGED = 0` |
| DB write = 0 | `本步 DB 写命令数 = 0` |
| PR #60 未修改 | `PR #60 CHANGES = 0` ＋ head / body 指纹对照 |

---

## 10. NEG Assertions（写后零命中反向断言）

**断言口径**：下列**禁语类别**在报告全文中必须**零命中**。⛔ 为保证本断言自身不自相矛盾，**禁语字面不写入本报告**，仅在断言脚本中以枚举形式给出。

| # | 禁语类别（不逐字落盘） | 结果 |
|---|---|---|
| N-1 | 对 `S-PROMOTED` 的"已选定"式宣告 | 零命中 |
| N-2 | 对 `S-VALIDATED` 的"已选定"式宣告 | 零命中 |
| N-3 | 对 `S-LATEST` 的"已选定"式宣告 | 零命中 |
| N-4 | 对方案 `①b` 的"已选定"式宣告 | 零命中 |
| N-5 | 对方案 `①b` 的倾向性推荐语句 | 零命中 |
| N-6 | 对组 A 备选 `B-α` / `B-β` / `B-γ` / `B-δ` 的倾向性推荐语句 | 零命中 |
| N-7 | `freeze` 与英文授权词的组合串 | 零命中 |
| N-8 | `implementation` 与英文授权词的组合串 | 零命中 |
| N-9 | `deploy` 与英文授权词的组合串 | 零命中 |
| N-10 | `GE-04` 与英文授权词的组合串 | 零命中 |

**类别之外，另补 6 条本仓固定的口径禁语**（同为「绝不写入」类；⛔ 此处同样**不逐字落盘**，仅在断言脚本中枚举）：① 「本轮文件零改动」类否定式自述；② 「只改本机技能文档」类缩小化自述；③ 声称 v4.0 状态头变更为冻结的表述；④ 声称契约在本步被改动的表述；⑤ 「问题已解决」类断言；⑥ 「已立为独立事项」类断言。

**结果汇总（与 POS 同一脚本一次运行）**：

```text
POS : 见 §9 断言块（同一脚本输出）
NEG : 及以上 N-1 … N-10 ＋ 6 条固定口径禁语 —— 全部零命中
```

---

## 11. Git / Production / DB 零修改断言（四块式）

```text
ETF 仓库（-gen1 worktree = gen1-worktree-20260916 @ 2e24ecd6ba5fa1d21b2c6337e24f6aa09c2a1781）：
- Git 跟踪文件：零修改（本步未编辑任何跟踪文件）
    既有披露（⛔ 非本步所为）：` M docs/gen1/GEN1_DOC_ERRATA_20260916.md`（1 file changed, 35 insertions(+)）
- Git 历史 / 分支 / 远端：零修改（未 commit / 未 push / 未建 PR / 未 merge / 未 deploy / 未 freeze）
- 未跟踪本地草稿：本步新增 1 份报告（outputs/ 命中 .gitignore）
    ⛔ `_v4-contract-20260923` worktree 内零改动（tracked status = 空；v4 sha256 复算 = 80da4d99…f7c5，与上一步逐位一致）
其他本机文件：
- .workbuddy/memory/2026-10-02.md 追加本步记录
- .workbuddy/memory/automations/21a753d4-…/memory.md 追加本步摘要
生产侧：
- 代码 / 配置 / Authority / Freeze Seal / Evidence Seal / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- Evidence Contract v1.0 / v3.0 / v4.0：零字节修改
- DB 集合（decision_result / portfolio_snapshot / ml_shadow_signal / runtime_status /
  run_candidate_decision / run_candidate_portfolio / run_manifest / run_history / active_run_pointer）：
  只读（本步 DB 写命令数 = 0）
- 未调用云函数、未触发 automation、未做 reader migration；PR #60 body 零修改
```

**取证依据逐类**：

| 类别 | 依据 | 实读结果 |
|---|---|---|
| 被跟踪文件 | `git diff --stat HEAD` | 仅 `docs/gen1/GEN1_DOC_ERRATA_20260916.md`（既有） |
| 未跟踪 | `git status --short` | `?? .workbuddy-ai/`、`?? docs/gen1/GEN1_EVIDENCE_CONTRACT_V2.md`（既存）＋ 本步报告（outputs/） |
| 契约 | v4 双 sha256 复算 | `80da4d99…f7c5`（落盘）／`74319398…a07e`（LF 归一）—— 与上一步一致 |
| PR | PR #60 `get` | `state=open` / `merged=false` / head `8d1f1cd` / body 指纹仍为第 1 提交（**F-3 未变，本步未动**） |
| DB | 全部查询均为 `QUERY` 类命令 | 写命令数 = 0 |

---

## 12. STOP-AND-REPORT

```text
E-1b-AB Layer-1 COMPLETE
read-only = PASS
A-1 analyzed = YES
B-3° analyzed = YES
C-1° analyzed = YES
owner selection = NONE
selector selection = NONE
contract modified = NO
production modified = NO
DB writes = 0
PR #60 modified = NO
STOP = YES
```

**本步未做且不做的动作**：冻结 v4；修改契约 / 脚本 / PR body；改动生产代码 / 配置 / DB / Authority / Seal / lock / immutable_set；处理 E-2 / E-3 / E-4 / E-5；进入 Step 1.2 / PHASE 2 / PHASE 3。

**WAIT FOR OWNER RULING** —— 等待 owner 对 **A-1** / **B-3°** / **C-1°** 作出明确裁定；在此之前 B-3° 与 C-1a 的任何文本动作也不发生。

> 本文件为**只读分析输入**，不构成对任何方案的推荐，也不构成任何冻结、生成、写入或生产变更的授权。
