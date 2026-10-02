# V3.6.6 FREEZE / PRODUCTION ATTESTATION —— 前置准备与 Gate 清单（★ 只读准备）

**闸门**：`NEXT GATE = V3.6.6 FREEZE / PRODUCTION ATTESTATION PREPARATION`
**as-of**：2026-10-02（北京时间）
**本文件性质（⛔ 首要辨析）**：本文件是**准备件**（read-only preparation），
⛔ **不是** Freeze 记录、⛔ **不是** Production Attestation、⛔ **不构成**任何放行。
**授权依据**：owner 2026-10-02 裁定 **C** —— 「允许 WorkBuddy 自动完成所有**只读准备、审计、证据收集**和
Freeze/Attestation **前置检查**」；同时明文「**不要执行 Freeze、Tag、Merge 或 Production Attestation 写入动作**」。
**落点**：`docs/gen1/GEN1_V366_FREEZE_ATTESTATION_GATE_PREP_20261002.md`

---

## 0. ★ 边界声明（⛔ 必读）

```text
证据通道（三处，全部只读）
  ① 本机 git 对象：worktree `_v365-frozen-baseline`（V3.6.5）、`_v366-cd04-20261002`（V3.6.6）、
     `_g1-contract-v5-20261002`（V6.0 证据契约 + Seal）
  ② 远端：`git ls-remote origin`（分支 / tag 可见性）
  ③ 生产：CloudBase **只读**通道（`_cb-connect-20260921/cb_connect.py` 登录 + 只读白名单探测，
     原始返回归档 `probe_runtime_status.json`）

⛔ 本文件**不**修改：V3.6.6 实现分支 / V3.6.5 冻结对象 / 证据契约载体 / `V6.0 Evidence Freeze Seal` / Key 2
⛔ 本文件**不**做：Freeze / Tag / Merge / Push / Deploy / Rollback / Canary / Auto-execution / 生产 DB 写入
⛔ 本文件**不**授权：`V3.6.6 FREEZE` / `PRODUCTION ATTESTATION` / `EVIDENCE EXECUTION` /
   `KEY 3 EVIDENCE SEAL` / `GE-04`
⛔ 本文件**不**记录自身执行状态（自身 HEAD / 是否 commit / 是否 push）；⛔ 不写入自身 sha256（自指悖论）
```

---

## 1. ★ 三方绑定关系（V3.6.5 冻结 ↔ V3.6.6 实现 ↔ `V6.0 Evidence Freeze Seal`）

### 1.1 三方身份

| 层 | 对象 | 身份（⛔ 实测，非引用旧快照） | 远端可见性 |
|---|---|---|---|
| **① 生产基线** `V3.6.5` | worktree `_v365-frozen-baseline` | commit **`d6692983a27a283c61774d6a3bd14fba4ef47e49`** · tree `113deaafb0c33adf20bb92949d48c41b4580c582` · parent `c6bd006` · 2026-09-30 16:14:26 +0800 · `engine_version = v3.6.5` · `candidate_content_sha = 2f4b0519…cade` | ✅ 分支 `origin/feat/v365-production-integrity-impl` = `d669298`；✅ annotated tag **`v3.6.5-frozen`**（tag object `43c0d7f9…7c76` → commit `d669298`）已推送 |
| **② V3.6.6 实现** | worktree `_v366-cd04-20261002` @ 分支 `feat/v366-cd04-date-axis-20261002` | `0342abd`（CD-04 生产修复）→ **`4d4a67e`**（harness 扫描域修正）· tree `d65ee3b8…` · `engine_version = v3.6.6` · `candidate_content_sha = 10cc3928…3bec` | ⛔ **不在 origin**（无 `feat/v366-*` 远端分支）· ⛔ **无 `v3.6.6` tag** |
| **③ Evidence Freeze Seal** | `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json` | status **`EVIDENCE_FREEZE_SEALED`** · 制品 `a585a33a…b62`（10723 B）· 契约 v6.0 `7e3e5d87…272e` · carrier `ccb0f4b8…` · 7 项绑定（4 DIRECT + 3 `reference_to_key2_seal`） | ⛔ 仅在载体分支 `docs/gen1-evidence-contract-v5-20261002`；实测 **origin 尖端仍 `7d2f39bd`** ⇒ 契约与 Seal **均未推送** |

### 1.2 ★ 三方关系（逐条可复核）

```text
R-A  V3.6.5 → V3.6.6 为**线性构建**：`d669298` 是 `0342abd` 的**唯一 parent**（⛔ 非重写、⛔ 非重启）
R-B  V3.6.6 ↔ V6.0 契约：★ **CD-04 的修复即 v6.0 修订的**触发依据****（v5.0 §5.8 明文预留的复核条件已成立
     ⇒ 重评已执行）；v6.0 明文把 `CD-06`/`CD-07` 标为 **`CLOSED-UPON-V6.0-FREEZE`**
R-C  V3.6.6 ↔ V6.0 捕获窗口：v6.0 §5.8 已重锚 `W1 = [22:30,23:30)` ∪ `W2 = 次一工作日 [08:30,09:30)` +
     `first-window-wins` ⇒ **08:00 可提升性已被 v6.0 纳入预登记窗口序列**，与 CD-04 修复**方向一致**
     （⚠️ 注意 `W2` 起于 `08:30`，而 V3.6.6 的 08:00 管线为 `08:00` —— 见 §5 X-3）
R-D  V6.0 契约 ↔ Key 2：`gen1_guarded_contract_version = WP-G1-GE-CH-1.0`（线上实读）= Key 2 namespace；
     与本 Seal 的 `evidence_contract_version = v6.0` **并列、互不覆盖**（namespace 隔离）
R-E  ⛔ **三者均不可从 `master` 发现**：契约 / Seal 与 V3.6.6 实现**均未推送、未入 master**（BRANCH-SCOPED）
```

---

## 2. 十项核对（owner §C 1–10，逐项实测）

| # | 核对项 | 实测结论 | 证据（通道） |
|---|---|---|---|
| 1 | **V3.6.6 implementation commit identity** | 生产修复 commit = **`0342abd`**（`2cad2c12…` tree，parent `d669298`）；harness 修正 commit = **`4d4a67e`**（tree `d65ee3b8…`，parent `0342abd`）；分支 HEAD = `4d4a67e`。改动面 = 27 files / **+6390 −16**，其中**生产代码 4 文件 / +150 −14**。⛔ 未推送 / ⛔ 无 tag | git（本地 worktree） |
| 2 | **Replay / Python-JS parity** | replay = **5 cases / 32 checks / 0 failed · PASS**；parity = **missing 0 / extra 0 / content_diff 0 · PASS**（23 字段 × 5 case；打红 `content_diff = 18`，命中恰为 2 个预期 case）；独立参考实现 `tools/v366-cd04-reference.py`（⛔ 不 import 任何 production 模块） | `REPLAY_EVIDENCE.json` / `PARITY_EVIDENCE.json` |
| 3 | **safety-wall** | `scripts/v366-cd04-safety-audit.js` = **29 / 29 PASS** + **双子证打红 PASS**（子证 A 探针注入 → S2 必 FAIL → 还原；子证 B 锚定门三输入判别）；审计基线锚 **`d669298`**。⚠️ 见 §5/§6 的 **H-1/H-2** | `SAFETY_WALL_AUDIT.json` |
| 4 | **regression** | Stage A–G 全门禁链同轮对照：V3.6.5 = 75/80 pass（5 fail）· V3.6.6 = 76/81 pass（5 fail）⇒ **文件级零新增失败**（level_1 `no_new_item_failure = true`）；`item_count_delta = +1`（仅新增 `v366-cd04-date-axis.test.js`）；5 项残留**全部** `introduced_by_g4 = false`（3 项 `WINDOWS_LINE_ENDING_FALSE_NEGATIVE`）。⚠️ **level_2** 显示 `v365-prospective-qualification` 的首个失配条目**成因改变**（见 §6 R-LOCAL-01） | `FULL_GATE_CHAIN_COMPARISON.json` / `STAGE_A_COMPARISON.json` |
| 5 | **CD-04 / F-31** | 缺陷 = 生产 `validateCandidateSet` **门 2 日期轴字段误用**（用 **(III) RUN DATE** 比对 **(II) DATA DATE**）；修复 = 改绑 **(IV) CALENDAR TRADE DATE**（`DATA_DATE_AUTHORITY_FIELD = 'data_expected_trade_date'`，唯一来源 `v365-contracts.js`）；新增 fail-closed 分支 `date_authority_invalid`；`mixed_date_detected` 字符串**保持不变**。日期轴矩阵 **27 / 27 PASS**；反证矩阵 M1–M7 全 PASS；B0 manifest **12 / 12 PASS** | `GEN1_V366_CD04_IMPLEMENTATION_SPEC_20261002.md` / `TEST_EVIDENCE_20261002.md` |
| 6 | **V6 Evidence Contract identity** | **v6.0 FROZEN**：content sha256 **`7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e`**（97203 B / 1413 行 / 纯 LF）· git blob sha1 `294259338ba3fa60f689ed9139072a35b2368b0e` · carrier commit `ccb0f4b8cf402a16b16d468cbff1c02109d72476` · parent `7d2f39bd…`。★ **`V5.0 = SUPERSEDED / INVALID FOR NEW EVIDENCE`**（owner 裁定 B1） | 本机 git + 契约状态头 |
| 7 | **V6 Evidence Freeze Seal identity** | status **`EVIDENCE_FREEZE_SEALED`**；制品 `a585a33a25cd1fe4b508fc6ce0d1e69f324000cc49f96584865c4811f46a7b62`（10723 B）；7 项绑定 + `binding_routes`（4 DIRECT / 3 REFERENCE）；`fingerprint_canonicalization = sha256lf`；两工具 `c1_capture.py = d0acc9e4…a4337` / `c1_gate_redproof.py = e795c934…aba0`。⚠️ `evidence_seal_key3 = NOT_AUTHORIZED`（`independent_events = 0` < 30） | 制品 + 自证套件 |
| 8 | **production V3.6.5 baseline identity** | commit **`d669298`**（= tag `v3.6.5-frozen` 指向）；V3.6.5 身份件 `candidate_content_sha = 2f4b0519…cade` / `engine_version = v3.6.5` / `qualified_files = 20`；留存副本 `tests/fixtures/v366-cd04/v365-baseline/V365_CANDIDATE_MANIFEST.v365.json`（`lf_sha256 = 96c11326…5ba8` / 5196 B），与 4 个 vendored 模块**三方互证**（`BASELINE_PROVENANCE.json`）。✅ 基线**远端可见** | git + 夹具 provenance |
| 9 | **production safety state** | **只读实读**（CloudBase，`runtime_status` 单例，`updated_at = 2026-10-01T00:00:22.690Z`）：`production_engine = ` **`v3.6.1`**（⚠️ **V3.6.5 / V3.6.6 候选均未部署**）· `gen1_authority = CANARY`（`灰度反事实`）· `gen1_allow_canary = false` · `gen1_counterfactual_canary_active = false`（`_authorized = true` / `_health_allowed = false`）· `gen1_production_write = false` · `gen1_auto_execution = false` · `gen1_broker_wired = false` · `gen1_production_fast_path_enabled = false` · `ml_effective = false` · `ml_gen1_frozen = true` · `gen1_guarded_contract_version = WP-G1-GE-CH-1.0` · `gen1_guarded_freeze_seal_status = PENDING` · `gen1_guarded_evidence_seal_status = PENDING` · `gen1_guarded_selector_source = BASELINE` · `v365_mode = ENFORCE` · `v365_authoritative_published = false` / `NOT_PROMOTED` · `v365_finality_status = COMPLETE`。⚠️★ **`gen1_health_status = DEGRADED`** + `gen1_health_gate_status = ACTIVE` + `gen1_health_manual_review_required = true`（标签 `降级（禁止灰度）`）⇒ **健康正控不成立 ⇒ 当前禁止灰度** | CloudBase 只读（`probe_runtime_status.json`，71 键含 `_id`） |
| 10 | **merge / deploy boundary** | `origin/master = ` **`e015aaaf2860c808180e5bd1fbfc24d4fdef3303`**（与 G-2 记录一致，未变）；本地 `master = 8a276579…`（落后 origin 23 提交）。⛔ V3.6.6 分支**未推送**；⛔ 证据契约载体分支 origin 尖端仍 `7d2f39bd`（提交 4–9 **未推送**）；⛔ 远端 tag 仅 `v361-r1-freeze` / `v3.6.4-frozen` / `v3.6.5-frozen`，**无 `v3.6.6` tag**；⛔ 本轮零 deploy / 零 rollback / 零生产 DB 写 | `git ls-remote` + git tag |

---

## 3. ★ Gate 清单 A —— **V3.6.6 FREEZE**（判定项 / 现状 / 尚缺什么）

| # | 判定项 | 现状 | Freeze 前**尚缺** |
|---|---|---|---|
| A-0 | **授权** | ⛔ 无 V3.6.6 FREEZE 授权（G-4 报告 §8 明示 `NEXT GATE` 须 owner 单独授权） | **owner 显式授权** |
| A-1 | 实现提交身份**远程可见** | ⛔ `4d4a67e` / `0342abd` 均不在 origin | **推送授权**（推送本身=独立闸门） |
| A-2 | 实现提交**单一权威入口** | ✅ 线性：`d669298 → 0342abd → 4d4a67e`，无分支/无 squash | 无（若推送后仍须复核 `ls-remote`） |
| A-3 | 候选身份件**重出**且非自升格 | ✅ `engine_version = v3.6.6`；`qualification_status = CANDIDATE`（⛔ 未自升格）；20 qualified files 未增删；`parent_production_version = v3.6.4` | 无（须复核 `--check` 语义） |
| A-4 | **V3.6.5 身份不丢失** | ✅ vendored `V365_CANDIDATE_MANIFEST.v365.json` + 4 模块 + provenance，三方互证 | 无 |
| A-5 | 契约层：**Evidence 面归属** | ⚠️ V3.6.6 分支内 §4 审计锚 **Contract v5.0**，而 v5.0 = **SUPERSEDED** | ★ **owner 裁定**（见 §5 X-1） |
| A-6 | 契约兼容性**逐章节映射** | ✅ 13 章节逐条登记（§4.2），零漂移 | 须按 **v6.0** 复核（v6.0 新增 §3.4A / §5.6 全枚举 / §5.8 重锚） |
| A-7 | 门 2 语义**非为变绿** | ✅ 判据由「宿主自产运行日」换成「版本化日历 artifact 推出的已完成交易日」；反证矩阵 M1–M7 全 PASS | 无 |
| A-8 | `PUBLISH_PROTOCOL_VERSION` 变更登记 | ✅ `v365-two-stage-v1 → v2` | 须确认下游消费方（reader / store）已随附 |
| A-9 | 泄漏面：回滚策略 | ✅ 单 commit `revert` 即回 V3.6.5 逐字行为；新字段 additive / 无需迁移 | 无 |
| A-10 | 残留项闭合 | ⚠️ R1 / R2 **已由 v6.0 契约层消费**；R3 = `OBSERVATION`；R-LOCAL-01 = **本 Gate 主体**（见 §6） | ★ owner 裁定是否以 v6.0 关闭 R1/R2 |
| A-11 | Freeze 制品形态（tag / manifest / Seal） | ⛔ **尚不存在** V3.6.6 Freeze 制品 | ★ **须先裁定制品形态与载体**（见 §5 X-4） |
| A-12 | 生产侧零漂移基线 | ✅ 实读 `production_engine = v3.6.1`（未部署候选）；`gen1_production_write = false` | 无（Freeze 本身⛔ 不改生产） |

---

## 4. ★ Gate 清单 B —— **PRODUCTION ATTESTATION**（判定项 / 现状 / 尚缺什么）

| # | 判定项 | 现状 | Attestation 前**尚缺** |
|---|---|---|---|
| B-0 | **授权** | ⛔ 无 | **owner 显式授权** |
| B-1 | **部署源 SHA 远程可见 + 经当轮审计 + 明确授权** | ⛔ 三项均不成立（未推送 / 未审计当轮 / 未授权） | 全部 |
| B-2 | 部署源**包内 `index.js` 与源逐字节一致** + blob 同值 | 未执行 | 部署六条审计 |
| B-3 | 部署后**函数配置 + `runtime_status` 双零漂移** | 未执行 | 部署后复核 |
| B-4 | **健康正控**（`health == 'OK' && gate_status == 'ACTIVE'`，AND） | ⛔ **当前 `health = DEGRADED`** ⇒ 正控**不成立** | ★ 见 §5 X-6（Attestation 是否须以健康 OK 为先决） |
| B-5 | Key 2（生产激活安全）绑定闭合 | ⚠️ 制品 `status = PENDING` / `bindings_status = INCOMPLETE`（⛔ 本链不得改写） | ★ owner 裁定 Key 2 与 Attestation 的先后 |
| B-6 | Key 3 Evidence Seal（≥30 独立事件） | ⛔ `NOT_AUTHORIZED`（`independent_events = 0`） | 与 Attestation 的**互斥/前置**关系须裁定 |
| B-7 | 平台 CAS / publish 通道 | ✅ 平台单文档 CAS 已验（`_v365_cas_probe` / 2026-09-24）；`v365_mode = ENFORCE` / `finality_status = COMPLETE` | 无（须复核时点） |
| B-8 | 回滚包抓取 + `codeSha256` 对拍 | 未执行 | 部署六条 ③ |
| B-9 | `master_merge` / `canary` / `auto_execution` | ⛔ 全部维持 NO / OFF | ★ 各自独立闸门 |
| B-10 | 生产 DB 写入 | ✅ 本轮 = **0** | Attestation 若含写入须单独授权 |

---

## 5. ★ 跨批次治理交叉点（**必须 owner 裁定**，⛔ 本文件不自行选边）

| # | 交叉点 | 事实 | 为何必须裁定 |
|---|---|---|---|
| **X-1** | **V3.6.6 Evidence 面归 v5.0 还是 v6.0？** | V3.6.6 §4 的兼容性审计**锚定 Contract v5.0**（`4fb9463f…f55b`）；但 owner **B1** 已裁定 `V5.0 = SUPERSEDED / INVALID FOR NEW EVIDENCE`，且 **CD-06 / CD-07 已在 v6.0 内 CLOSED-UPON-V6.0-FREEZE** | 两个契约版本对「08:00 可提升性 / checkpoint / trigger 枚举」给出**不同**规范；若 V3.6.6 Freeze 仍以 v5.0 为审计依据，则与 v6.0 冻结**并存两个规范源** |
| **X-2** | **R1 / R2 是否可宣告闭合** | R1（08:00 可提升 ⇒ Evidence 可能非独立）由 **v6.0 §3.4A `INDEPENDENCE REQUIREMENTS`**（I1–I7 + **明文排除 capture 窗口身份 W1/W2**）覆盖；R2（§5.6/§5.8 锚定前提被移除）由 **v6.0 §5.6 全枚举 + §5.8 重锚 `W1 ∪ W2`** 覆盖 | G-4 自述「**无权**修改 FROZEN 的 Contract v5.0」⇒ 其残留项须由**契约层**闭合；现契约层已改 v6.0 ⇒ 需 owner **确认闭合口径**（⛔ 不得由本文件自行宣告） |
| **X-3** | **`W2` 起点 `08:30` vs 08:00 管线** | v6.0 §5.8 `W2 = 次一工作日 [08:30, 09:30)`；V3.6.6 涉及的 08:00 管线（`W2-0800` / `materializeIndicators`）在 **08:00** 触发 | ⚠️ 若 08:00 触发被 CD-04 修复后**可提升**，其捕获窗口归属须澄清（⛔ 窗口身份**不是**独立性判据，但**是** `checkpoint_ok` 的记录面） |
| **X-4** | **V3.6.6 Freeze 制品形态与载体** | 现有先例有三类：① tag（`v3.6.5-frozen` 已推送）；② manifest（`V365_CANDIDATE_MANIFEST.json`）；③ 独立 Seal（`V6.0 Evidence Freeze Seal`）。⛔ 三者语义不同 | 须裁定 V3.6.6 Freeze 采用何者、命名空间与变更规则（⚠️ 沿用 `V365_CANDIDATE_MANIFEST.json` 会被 V3.6.6 自身**再写一次** ⇒ 与「身份件须重出」耦合） |
| **X-5** | **主分支可达性 = PENDING（三方共病）** | 契约 v6.0、`V6.0 Evidence Freeze Seal`、V3.6.6 实现 **均未入 master / 未推送** | 部署源**必须** remote-visible ⇒ 三个对象都缺可发现性；⛔ 但本轮**无** push 授权 |
| **X-6** | **健康门 `DEGRADED` 与 Attestation 的关系** | 实读 `gen1_health_status = DEGRADED` / `gate_status = ACTIVE` / `manual_review_required = true`（标签「降级（禁止灰度）」）。按 F2 正控 = `health==='OK' && gate_status==='ACTIVE'`（**AND**，缺则 fail-closed）⇒ **正控不成立** | 须裁定 Attestation 是否以「健康正控成立」为**先决**；若否，须写明 DEGRADED 下的 attestation 语义（⛔ 不得默认放宽） |
| **X-7** | **H-1 / H-2（harness 自证可复现性）** | H-1：安全墙 v1 扫描域用 `git ls-files --others` ⇒ **同一份代码「提交后」由 28/28 掉到 26/28**；已修（改锚 `git diff BASE` + S1 非空门）⇒ 28 → **29** 项。H-2：`0342abd` 内提交的 `SAFETY_WALL_AUDIT.json`（28/28）**无法由已提交树复现**，已重出为 29/29（`REPLAY_/PARITY_EVIDENCE.json` 未受影响） | 须确认 Freeze 采集的**审计制品版本**为 29/29 版；⛔ 不得以 `0342abd` 内的 28/28 制品作 Freeze 证据 |

---

## 6. 残留项（G-4 §7）现状复评

| # | 残留项 | G-4 处置 | **本准备轮复评** |
|---|---|---|---|
| R1 | 08:00 可提升 ⇒ Evidence 样本可能非独立 | 登记，⛔ 无权处置（涉 FROZEN v5.0 的 selector / 行键 / 门槛） | ✅ **已由 v6.0 §3.4A 覆盖**（I1–I7 + 明文排除 capture 窗口身份）⇒ 建议 **`CONSUMED-BY-V6.0`**，待 owner 确认（§5 X-2） |
| R2 | Contract §5.6 / §5.8 锚定前提被移除 | 登记，⛔ 只读不改 | ✅ **已由 v6.0 §5.6（全枚举 Trigger Registry）+ §5.8（重锚 `W1 ∪ W2` + first-window-wins）覆盖**，且 v6.0 明文 `CD-07` = **`CLOSED-UPON-V6.0-FREEZE`** ⇒ 建议 **`CONSUMED-BY-V6.0`**，待 owner 确认 |
| R3 | `input_hash` 在 harness 中为 `undefined` | 登记为**观察项**（两列同空 ⇒ parity 对称，非本修复缺陷） | ✅ 维持 **`OBSERVATION`**（未升硬门）；消费面 `r3_contract_consumption_test.py` = 12/0 PASS |
| R-LOCAL-01 | `v365-prospective-qualification` 的适用域（断言「工作区逐字节 == 冻结的 V3.6.5 部署候选 c021」，而本次 4 个改动文件**全在 c021 内** ⇒ 与「在 V3.6.5 之上建 V3.6.6」**逻辑互斥**） | ⛔ 三条路（改测试 / 重生成 c021 / 生成 V3.6.6 自己的部署候选）**均越 G-4 授权** | ★ **正是本 Gate（V3.6.6 FREEZE）的主体** —— 该不变式**只能**通过「生成 V3.6.6 自己的部署候选」在**本 Gate**内合法解开 |

---

## 7. 复算命令（⛔ 只读）

```bash
# ① 三方身份
git -C <repo> merge-base --is-ancestor d6692983a27a283c61774d6a3bd14fba4ef47e49 \
    _v366-cd04-20261002^{commit}          # V3.6.5 → V3.6.6 线性构建
git -C _v365-frozen-baseline  log -1 --format='%H %T %P %ci %s'
git -C _v366-cd04-20261002   log --format='%h %H %T %P %ci %s' d669298..HEAD
git -C _v366-cd04-20261002   rev-parse 'v3.6.5-frozen^{commit}'      # → d669298…
git -C _v366-cd04-20261002   rev-parse 'v3.6.5-frozen'               # → 43c0d7f9…（annotated tag object）

# ② V3.6.6 证据（⛔ 只读）
cd _v366-cd04-20261002
node scripts/v366-cd04-replay.js                 # 5 cases / 32 checks / 0 failed
node scripts/v366-cd04-parity.js --red-proof     # missing 0 / extra 0 / content_diff 0（打红 18）
node scripts/v366-cd04-safety-audit.js --red-proof   # 29/29 + 双子证
node tests/v366-cd04-date-axis.test.js           # 27/27
node tests/v365-b0-manifest.test.js              # 12/12
python3 tools/v366-cd04-reference.py             # 独立参考实现（⛔ 不 import production）

# ③ V6.0 契约 + Seal（⛔ 只读）
cd _g1-contract-v5-20261002
sha256sum docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md          # → 7e3e5d87…272e
sha256sum docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json   # → a585a33a…b62
python scripts/gen1/evidence-capture/v6_seal_binding_selfcheck.py            # 20/0
python scripts/gen1/evidence-capture/v6_fingerprint_canonicalization_check.py # 16/0

# ④ 远端 / 生产边界（⛔ 只读）
git ls-remote origin refs/heads/master refs/heads/feat/v365-production-integrity-impl \
                    refs/heads/docs/gen1-evidence-contract-v5-20261002 'refs/tags/*'
cd _cb-connect-20260921 && python cb_connect.py    # 只读白名单探测（⛔ 密钥只进内存；输出 redact）
```

---

## 8. ⛔ 本文件**不**授权的事（逐项显式）

| # | 动作 | 状态 |
|---|---|---|
| 1 | `V3.6.6 FREEZE`（含创建任何 V3.6.6 制品 / tag） | ⛔ **未授权** |
| 2 | `V3.6.6 PRODUCTION ATTESTATION`（含写入动作） | ⛔ **未授权** |
| 3 | push（V3.6.6 分支 / 证据契约载体分支 / 任何分支） | ⛔ **未授权** |
| 4 | 建 git tag（含 `v3.6.6*`） | ⛔ **未授权** |
| 5 | merge / master integration | ⛔ **未授权** |
| 6 | deploy / rollback | ⛔ **未授权** |
| 7 | canary activation / `auto_execution` / 生产 DB 写入 | ⛔ **未授权** |
| 8 | `EVIDENCE EXECUTION` / 启动样本累计 | ⛔ **未授权** |
| 9 | `KEY 3 EVIDENCE SEAL`（= `EVIDENCE_POSITIVE`，须 ≥30 独立事件） | ⛔ **NOT AUTHORIZED**（`independent_events = 0`） |
| 10 | `GE-04` Ready / Authorization / GEN1 Decision Chain | ⛔ **未授权** |
| 11 | 改 Key 2（制品 / Charter §3.1 / 上游裁定）/ 改 `.gitattributes` / 生产 Authority / `FROZEN_PARAM_KEYS` / lock / `immutable_set` / 生产读链 | ⛔ **未授权** |
| 12 | 改 V3.6.5 冻结对象（commit / tag / vendored 夹具） | ⛔ **未授权** |

```text
PRODUCTION WRITE = false        AUTO_EXECUTION = false       CANARY = OFF
DEPLOY = NO                     ROLLBACK = NO                DB WRITES = 0
MERGE = NO                      TAG = NO                     PUSH = NO
EVIDENCE EXECUTION = NOT AUTHORIZED      KEY 3 EVIDENCE SEAL = NOT AUTHORIZED
GE-04 = NOT AUTHORIZED                   V3.6.6 FREEZE = NOT AUTHORIZED
PRODUCTION ATTESTATION = NOT AUTHORIZED
```

---

## 9. 身份速查表（as-of 2026-10-02，⛔ 一律实测）

```text
V3.6.5 基线 commit            d6692983a27a283c61774d6a3bd14fba4ef47e49（tree 113deaaf…）
V3.6.5 tag（annotated）       v3.6.5-frozen = 43c0d7f96a660bc4b3c9833d976f39f9b9307c76 → d669298…
V3.6.5 候选内容 sha           2f4b05193ff09d27bc990254e91e545dcad0d2926cf26835119b846c7cd2cade
V3.6.5 身份件留存副本         V365_CANDIDATE_MANIFEST.v365.json  lf_sha256 = 96c11326…5ba8（5196 B）

V3.6.6 生产修复 commit        0342abdda337535422d2bcc0d0abbcabc0e1250a（parent d669298…）
V3.6.6 harness 修正 commit    4d4a67e2aab95454dbcde30b782f1914bfafb2b2（tree d65ee3b8…）= 分支 HEAD
V3.6.6 候选内容 sha           10cc3928f5d2c6131a1f2f316188310d4ad42ac8c3bd36dfc61b3df561e63bec
V3.6.6 engine_version         v3.6.6   ／ publish_protocol v365-two-stage-v2
V3.6.6 改动面                 27 files / +6390 −16（其中生产代码 4 文件 / +150 −14）

契约 v6.0 content sha256      7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e（97203 B / 纯 LF）
契约 carrier / blob           ccb0f4b8cf402a16b16d468cbff1c02109d72476 / 294259338ba3fa60f689ed9139072a35b2368b0e
V6.0 Evidence Freeze Seal     a585a33a25cd1fe4b508fc6ce0d1e69f324000cc49f96584865c4811f46a7b62（10723 B）· SEALED
capture / redproof tool       d0acc9e427f6ce52de903abd40ef41c76e87f7e5ba3441dea92f6a3d013a4337 / e795c93445802249e8c33a29e9b01120833079fd7b38d9a660ea22ed590caba0
Key 2 制品（⛔ 未变）          35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5（881 B · PENDING / INCOMPLETE）

origin/master                 e015aaaf2860c808180e5bd1fbfc24d4fdef3303
origin（V3.6.5 实现分支）        feat/v365-production-integrity-impl = d669298…
origin（证据契约载体）           docs/gen1-evidence-contract-v5-20261002 = 7d2f39bddd681cce9d714558d518b06631451d01（提交 4–9 未推送）
origin（V3.6.6 分支）           ⛔ 不存在        ｜ origin tag：仅 v361-r1-freeze / v3.6.4-frozen / v3.6.5-frozen

生产（CloudBase 只读实读）      runtime_status.updated_at = 2026-10-01T00:00:22.690Z
  production_engine = v3.6.1   gen1_authority = CANARY   gen1_allow_canary = false
  gen1_production_write = false   gen1_auto_execution = false   gen1_broker_wired = false
  ml_effective = false   ml_gen1_frozen = true   gen1_guarded_selector_source = BASELINE
  gen1_guarded_contract_version = WP-G1-GE-CH-1.0
  gen1_guarded_freeze_seal_status = PENDING    gen1_guarded_evidence_seal_status = PENDING
  ★ gen1_health_status = DEGRADED   gen1_health_gate_status = ACTIVE   （降级 ⇒ 禁止灰度）
  v365_mode = ENFORCE   v365_authoritative_published = false   v365_finality_status = COMPLETE
```

---

**页脚**
本文件为 **V3.6.6 FREEZE / PRODUCTION ATTESTATION 的前置准备件**（owner 2026-10-02 裁定 C 授权范围内的只读产物）。
⛔ **不构成**任何 Freeze / Attestation / 部署 / 推送授权；⛔ 不得据本文件外推任何放行；
⛔ 本文件不记录自身执行状态，⛔ 不写入自身 sha256（自指悖论）。
