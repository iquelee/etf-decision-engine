# Gen-1 Evidence Contract v6.0（证据契约 · 正式载体）

**文档编号**：`WP-G1-EVIDENCE-CH-6.0`
**版本**：v6.0（🔒 **FROZEN**，2026-10-02）
**状态**：🔒 **FROZEN（2026-10-02）** ｜ 📌 **`V6.0 Evidence Freeze Seal` 已落盘**（契约 + 采集工具 + red-proof 工具三对象绑定） ｜ ⛔ **NOT AUTHORIZED FOR EXECUTION**
**本文件性质（⛔ 首要辨析）**：本文件是 **v6.0 FROZEN 正式载体** —— 自 **2026-10-02** 起为本契约的**正式执行语义**；
⛔ 但「**执行**」本身仍未授权（§12 第 5 项未闭合）⇒ **冻结 ≠ 开始采样**。
**冻结授权**：owner 2026-10-02 **单独授权**（V6.0 FREEZE + B3 同批次工具迁移，**原子治理批次**；含 `O-1 = APPROVED`）。
**落点**：本冻结载体 = `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md`（冻结轮**唯一来源** = V6.0 FREEZE CANDIDATE）。
**⛔ 同名辨析（必须遵守）**：本文件出现的「FROZEN / SEAL」**只针对本契约载体与 Evidence 工具链**（文档层）；⛔ **不是** `GEN1_GUARDED_EFFECTIVE_CHARTER` §3.1 的 **Key 2 Freeze Seal**（`GUARDED_EFFECTIVE_FREEZE` 制品），⛔ **也不是** **Key 3 Evidence Seal**（= `GEN1_EVIDENCE_CONTRACT` §4.2 的 `EVIDENCE_POSITIVE`，须 ≥30 独立事件），⛔ 更**不是** **`V6.0 Evidence Freeze Seal`**（= 本批次新立的**独立**治理对象，见 `GEN1_EVIDENCE_FREEZE_SEAL_BINDING_DECISION.md`）。**四者互不替代**，⛔ 不得互相推断。
**取代关系**：**v6.0 取代 v5.0**；v5.0 / v4.0 / v3.0 / v2.0 / v1.0 既有样本**显式作废**
（实测既有样本 = **0 行** ⇒ 作废成本为零，但**声明必须保留**）。
**★ V5.0 状态声明（owner 2026-10-02 裁定 B1 = APPROVED）**：
`V5.0 CONTRACT = SUPERSEDED / INVALID FOR NEW EVIDENCE` ——
即：v5.0 契约**不再是新 Evidence 的有效依据**；其**载体文件保持 immutable**（⛔ 不覆盖、不改写、不重写任何字节）；
其历史样本语义按 §11 元规则②处理 = **显式作废 v5.0 全部样本**（实测 = **0 行** ⇒ 无需迁移历史 Evidence sample）。
✅ 取代自 **v6.0 冻结（2026-10-02）**起生效；⛔ 且**执行**仍受 §12 约束（未授权）。
**as-of**：2026-10-02（北京时间）· 本版 = **v6.0 FROZEN**
**授权依据**：owner 2026-10-02 裁定 ——
① **G-2**（v5.0 FREEZE + SEAL）—— 见同批次封存记录；
② **Contract Revision Gate**（自主完成修订）—— 见 `GEN1_EVIDENCE_CONTRACT_REVISION_PROPOSAL_20261002.md`；
③ **B1 / B2 = APPROVED**（版本标签 = `v6.0` + 「显式作废 v5.0 全部样本」；§5.8 checkpoint 重锚 `W1 ∪ W2` + first-window-wins）；
④ **V6.0 FREEZE PREPARATION 授权**（生成轮 —— 见 `GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md`）；
⑤ **V6.0 FREEZE 授权（本批次）** —— 含 **`O-1 = APPROVED`**（新立**独立**治理对象 `V6.0 Evidence Freeze Seal`，⛔ **不改 Key 2**）
   与 **B3 同批次工具迁移授权**。
**🔒 冻结授权状态**：`V6.0 CONTRACT = FROZEN`（2026-10-02）；冻结指纹记于**同批次封存记录**与 `V6.0 Evidence Freeze Seal` 制品。
**B3 状态**：`c1_capture.py` / `c1_gate_redproof.py` v5.0 → v6.0 语义迁移 = ✅ **MIGRATED（与本冻结同批次；§11 规则 5）**。
⛔ 「生成」「冻结」「并入 master」「正式执行」是**四个分开**的授权步骤，**不得合并推断**。
**生成自**：**v5.0 FROZEN 载体**（`docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md`）—— ⛔ **不再自 v4.0 派生**（v4.0 从未冻结）
**V6.0 候选基线（冻结轮的唯一来源；⛔ 冻结轮对其零字节改动）**：
- 路径 = `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md`
- content sha256（LF）= `e93420a38a4b92c7c5eb577c4cf5af81e6d913dc22df361a1e981978efbef4b1`（92306 B / 1377 行）
⚠️ 冻结轮**只**改：状态头 / §1.1 末行 / §11 规则 5 状态行 / §11 变更日志 / §12 第 1·2·8·9·12 项 / §13 / §13.2 / 页脚；
⛔ **§0–§11 规范性正文逐字节未变**（由 `v6_frozen_carrier_assertions.py` 独立证明）。
**V5.0 冻结输入（⛔ 本批次对其零字节改动）**：
- carrier commit = `05da0efa73e948921bc7b9b60c0d500cc98e3e9b`
- git blob id（sha1）= `7f86d12aaed99a877c170c25c5a481f21a661256`
- content sha256（LF）= `4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b`（64580 B / 1072 行）
- 封存记录 commit = 分支 HEAD = `7d2f39bddd681cce9d714558d518b06631451d01`
- 载体分支 = `docs/gen1-evidence-contract-v5-20261002`（local == origin）
- PR = **#66**
⚠️ 三种指纹（git blob id / content sha256 / commit SHA）**不可混用**。
**修订提案来源**：`docs/gen1/GEN1_EVIDENCE_CONTRACT_REVISION_PROPOSAL_20261002.md`（`c458d48858a35e71bc70fce89390192274aca1a3dc8335edfbf8851909372736` / 48346 B / 707 行）
**上游复评来源**：`docs/gen1/GEN1_EVIDENCE_CONTRACT_REEVALUATION_R1R2R3_20261002.md`（`727da1f3…cfaf` / 42731 B / 581 行）
**载体基线**：`e015aaaf2860c808180e5bd1fbfc24d4fdef3303`（`origin/master`，as-of 载体入库时刻；⛔ 本批次未推进 master）
**前置冻结源（保留历史链）**：v2.0 = `24677422`；v3.0 = `650db586`（blob `574112f433b9a9691aa8d728e45a3f2aeb931699`）；v4.0 = `8d1f1cd`（⛔ 从未冻结）

```text
V6.0 CONTRACT GENERATION      ✅ DONE（2026-10-02，V6.0 FREEZE PREPARATION 授权）
V6.0 FREEZE CANDIDATE         ✅ ACCEPTED（`e93420a3…bef4b1` / 92306 B / 1377 行 = 冻结轮唯一来源）
V6.0 CONTRACT FREEZE          🔒 FROZEN（2026-10-02，owner 单独授权）
V6.0 CARRIER SEAL RECORD      📌 SEALED（同批次独立工件；⛔ 非生产 Seal）
EVIDENCE TOOLCHAIN MIGRATION  ✅ MIGRATED（`c1_capture.py` / `c1_gate_redproof.py` 同批次迁至 v6.0）
EVIDENCE TOOL ALIGNMENT       ✅ PASS（契约 ↔ 采集工具 ↔ red-proof 工具 四层语义一致）
V6.0 Evidence Freeze Seal     🔒 SEALED（**独立**治理对象；⛔ 与 Key 2 / Key 3 互不替代）
V5.0 CONTRACT                 📛 SUPERSEDED / INVALID FOR NEW EVIDENCE（owner B1；⛔ 载体 immutable）
V5.0 SAMPLE INVALIDATION      📛 EXPLICIT（v1–v5 既有样本全部作废；实测 = 0 行）
EVIDENCE EXECUTION            ⛔ NOT AUTHORIZED（§12 第 5 项未闭合）
EVIDENCE SEAL (Key 3)         ⛔ NOT AUTHORIZED（independent_events = 0 < 30）
HISTORICAL BACKFILL           ⛔ PROHIBITED
V3.6.6 FREEZE                 ⛔ NOT AUTHORIZED
GE-04                         ⛔ NOT AUTHORIZED
```

> 🔒 **本文件已于 2026-10-02 冻结（owner 单独授权）；自本日起为本契约的正式执行语义（但执行本身仍未授权）。**
> ⛔ 不得据此改 Authority / 改生产 Seal / 改 `FROZEN_PARAM_KEYS` / 改生产读链。
> ⛔ 样本累计须待 §12 第 5 项闭合（手工 / 半自动跑通 ≥3 个交易日）—— **冻结 ≠ 开始采样**。
> 冻结指纹（content sha256 + carrier commit + git blob id）记于**同批次封存记录**与 `V6.0 Evidence Freeze Seal` 制品；
> ⛔ **不写入本文件**（避免自指矛盾）。
> ⚠️ **落点声明**：本文件为**仓库载体**，落于 `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md`；
> 载体分支 = `docs/gen1-evidence-contract-v5-20261002`（自 `origin/master` 开出）。⛔ 本批次**不** push / **不** merge master / **不**建 tag；主分支可达性 = PENDING。
> ⛔ **生成 ≠ 冻结 ≠ 合并 ≠ 执行**：四者是分开的授权步骤。

---

## 0. 本文件做什么，以及**不**做什么

**做**：定义「Gen-1 反事实建议是否具有经济价值」这一问句的**可复核、可证伪、不可事后修改**的度量口径 v6.0。

**不做**：

- ❌ 不修改 `GEN1_EVIDENCE_CONTRACT.md`（v1.0）**任何一个字节**；⛔ 也**不修改** `GEN1_EVIDENCE_CONTRACT_V5.md`（v5.0 FROZEN）**任何一个字节**（owner B1：v5.0 载体 immutable）。
- ❌ 不授权 `PRODUCTION` 档位（该档位继续永久不可达）。
- ❌ 不授权 `GUARDED_EFFECTIVE`（三钥匙与运行时叠加门另行约束）。
- ❌ 不改变「人工执行」与「自动交易关闭」。
- ❌ 不触碰 `ml/gen2/**` 与其冻结证据。
- ❌ **不解除** `Gen-1 → final_target` 的禁令：Gen-1 只提 Timing 提案，最终仓位**始终**由 V3.6.1 Safety Core 计算。

---

## 1. 与 v5.0 / v1.0 的关系

### 1.1 版本状态变更

| 项 | 处置 |
|---|---|
| `GEN1_EVIDENCE_CONTRACT.md`（v1.0） | **暂停作为正式采样执行契约**；⛔ **不删除、不修改、不否定其历史价值** |
| v1.0 / v2.0 / v3.0 / v4.0 / **v5.0** 既有样本 | **显式作废**。实测样本数 = **0** ⇒ 作废成本为零，但**声明必须保留** |
| **v5.0 契约**（`GEN1_EVIDENCE_CONTRACT_V5.md`，🔒 FROZEN） | 📛 **`SUPERSEDED / INVALID FOR NEW EVIDENCE`**（owner 2026-10-02 裁定 B1）；⚠️ 其**载体文件保持 immutable**（⛔ 零字节改动） |
| **本文件 v6.0** | 🔒 已于 2026-10-02 冻结；自**冻结后首个被采纳（promoted）的自然 run**起取代 v5.0 作为正式执行契约（⛔ 执行仍未授权） |

### 1.2 `CD-01` —— v1.0 的实质性缺陷（**已 CLOSED，历史事实**）

**缺陷**：v1.0 §1 把主比较列绑定到 `decision_result.gen1_canary_suggested_position`，
但 v1.0 §3 又强制要求「非 Candidate 也入样，`delta_position = 0`，作为对照组」，
而该字段在非 Candidate 日**构造性为 `null`** ⇒ 主列在对照组行上无定义。

**remedy = v2.0 起**（主列改绑 `gen1_counterfactual_suggested_position`），v5.0 **沿用**。
✅ **`CD-01` 已 CLOSED** —— 关闭条件 =「v2.0 真正冻结」，已于 **2026-09-21** 满足。
⛔ 不得因 v5.0 尚为 DRAFT 而把 `CD-01` 回退为 `OPEN`。

### 1.3 `CD-02` —— `regime` 源绑定缺陷（v4.0 已改绑；v5.0 **再次改绑落点**）

**缺陷**：v3.0 §3 字段 3 把 `regime` 绑到 `portfolio_snapshot.market_regime`，
而该字段是 **legacy 推导**（`deriveMarketRegime()`，V2.1 指数周线打分），
**不是生产决策实际消费的 regime**。

**v4.0 的 remedy（改绑 `decision_market_regime`）方向正确**，但 v5.0 实测发现其**落点已失效**：

```text
ENFORCE 下 v365WritePortfolio 短路 ⇒ 引擎不再写 portfolio_snapshot
⇒ portfolio_snapshot.decision_market_regime 在 2026-09-30 08:00 后不再新增
⇒ 该字段仍在产生，但落在 run_candidate_portfolio（ENFORCE 分支的 putCandidate）
实读：run_candidate_portfolio.decision_market_regime = "crisis"（2 run 均有）
      run_candidate_portfolio.market_regime          = "defensive"
      run_candidate_portfolio.market_regime_divergent = true
```

**登记**：`CD-02`（`CONTRACT SOURCE BINDING DEFECT`），
**remedy = v5.0**（落点由 `portfolio_snapshot` 再改绑为 `run_candidate_portfolio`），
**状态：`CLOSED`**（v5.0 已于 2026-10-02 冻结 ⇒ 关闭条件满足；v6.0 **不改**该 binding）。
⛔ 不得因 v4.0 已写出 remedy 而提前判 `CD-02` CLOSED（v4.0 从未冻结、从未采样）。

### 1.4 `CD-03` —— **同名不同义**（v5.0 新增；F-29 的契约层修正）

**缺陷（v4.0 §3.5 文本级）**：v4.0 §3.5 的排除表把 `expected_trade_date` 一行写为

```text
| `expected_trade_date` | 日历权威源（cn-trading-calendar v1） | ⛔ 否 —— 只进 run_manifest | HOST-LOCAL DIAGNOSTIC |
```

**同一格内混了两个不同轴的量**：

```text
(A) 日历权威源的 expected_trade_date
    载体 = runtime_status.v365_run_integrity.expected_trade_date   ← ⛔ 不进 run_manifest
(B) run_manifest.expected_trade_date
    载体 = run_manifest / run_history / active_run_pointer
    写入值 = index.js:1352 `expected_trade_date: snapshotDate`      ← RUN DATE，非日历口径
```

⇒ v4.0 §3.5 的「来源」列写的是 (A)、「落点」列写的是 (B)，**二者不是同一个量**。

**代码依据（线上 V3.6.5 包 `_cb-connect-20260921/bundle-src/index.js`）**：

```text
:626  expected_trade_date: v365ExpectedAuthority.expected_trade_date   ← (A) 日历权威（cn-trading-calendar）
:1352 expected_trade_date: snapshotDate                              ← (B) RUN DATE（manifest）
:1383 expected_trade_date: v365Manifest.expected_trade_date           ← (B) 透传（history）
:1000 const snapshotDate = new Date(Date.now()+8*3600*1000).toISOString().slice(0,10)
```

**实读印证（as-of 2026-10-02 11:51 +08）**：

```text
run_manifest["engine:2026-10-01:b1790812813101"].expected_trade_date        = "2026-10-01"   ← (B) RUN DATE
runtime_status.v365_run_integrity.expected_trade_date                       = "2026-09-30"   ← (A) 日历
active_run_pointer.expected_trade_date                                      = "2026-09-30"   ← (B) 被提升 run 的 RUN DATE
run_candidate_portfolio[run_id=engine:2026-10-01:…].snapshot_date           = "2026-10-01"
```

⇒ **(A) ≠ (B)**，相差 1 天（同一时刻）。

**登记**：`CD-03`（`CONTRACT AMBIGUOUS NAMING DEFECT`），**remedy = 本文件 §3.5 重写**，
**状态：`CLOSED`**（v5.0 已于 2026-10-02 冻结）。

### 1.5 `CD-04` —— **`run_manifest.expected_trade_date` 的字段误用**（v5.0 登记；**⛔ 属生产链，本契约不修**）

**缺陷（生产侧，非契约侧）**：`validateCandidateSet` 用 (B) RUN DATE 去比对 `candidate.calc_date`（DATA DATE）：

```text
门 2：decision.calc_date === manifest.expected_trade_date
      ← 左端 = DATA DATE（数据最新日）
      ← 右端 = RUN DATE（北京运行日，snapshotDate）
⇒ 在「运行日 ≠ 数据日」的每一步必然判 mixed_date_detected
```

**后果（结构性，非偶发）**：

```text
08:00 管线（dailyPipeline-0800）：
  运行日 D 的 08:00，当日收盘尚未抓取 ⇒ calc_date = D-1（上一交易日）
  而 snapshotDate = D
  ⇒ D-1 ≠ D ⇒ 必 FAIL      ★ 08:00 run 在结构上永远无法通过 validation
22:00 管线（dailyFetch-2200）：
  运行日 D 的 22:00，fetchDailyData 已抓当日收盘 ⇒ calc_date = D
  ⇒ D == D ⇒ PASS            ★ 唯一可产生 promoted run 的管线
```

**实读印证**：

```text
09-30 22:01 run：snapshotDate 09-30 / calc_date 09-30 / validation_passed=true  / promoted=true
10-01 08:00 run：snapshotDate 10-01 / calc_date 09-30 / validation_passed=false / mixed_date_detected
10-02 08:00 run：门 1 即 BLOCKED（CASE_B_PARTIAL_STALE expected=2026-09-30 observed=2026-10-01）⇒ 未写 manifest
```

**登记**：`CD-04`（`PRODUCTION VALIDATION FIELD MISUSE`），
**状态**：✅ **CLOSED** —— 已由 **V3.6.6 / commit `0342abd`** 修复（门 2 由 (III) RUN DATE 改绑 (IV) CALENDAR TRADE DATE）；
承载树 = `_v366-cd04-20261002` @ `4d4a67e`；⛔ **本契约仍不修生产代码**（修复已在前序 **G-4** 批次完成）。
**★ 该修复即本 v6.0 修订的触发依据**：v5.0 §5.8 明文预留的复核条件（「若 `CD-04` 被修复 ⇒ checkpoint 须按 §11 元规则重新评估」）
已成立 ⇒ 重评已执行（见 §5.8）；⛔ 不得再把「等 `CD-04` 修复后再重评」当作未决项。

### 1.6 `CD-06` / `CD-07` —— **登记缺陷**（v6.0 新增；均由本批次证据固定）

> ⚠️ 编号承接 v5.0 §1 的 `CD` 序列（`CD-05` 见 §5.6）。若 owner 的文档勘误表（`GEN1_DOC_ERRATA_*.md`）另有编号，
> 以勘误表为准；本表编号仅用于**本契约内部引用**。

**`CD-06`（`CONTRACT TRIGGER-ENUMERATION INCOMPLETENESS`）**：v5.0 §5.6 的 `trigger 实读` 表**只列 5 个函数**，
遗漏真实存在的 `extractFundamental`（`newsExtract-1640` / `intelExtract-30min`）、
`fetchRealtimeData`（`realtime-5min`）、`runGen2ShadowEod`（`gen2-eod-weekdays-2230`），
且未声明 `runIntegratedShadowEod`（云端 `RESOURCE_NOT_FOUND`）与仓库示例 `dailyFetch-1530`（云端不存在）。
**代码/云端依据**：`tcb fn detail` 现场只读 9 triggers（§5.6.3）+ 词频取证（`intelExtract` / `fetchRealtimeData` / `runGen2ShadowEod` 于冻结契约内出现 **0** 次）。
⇒ **remedy = v6.0 §5.6 补全为完整枚举域（Trigger Registry）**。**状态：`CLOSED-UPON-V6.0-FREEZE`**。

**`CD-07`（`CONTRACT CHECKPOINT-STALENESS AFTER CD-04 FIX`）**：v5.0 §5.8 的 `CANONICAL_CAPTURE_CHECKPOINT`
= 工作日 `[22:30, 23:30)` **单窗口**，其定值前提为「**只有 22:00 管线能提升**」。该前提随 `CD-04` 修复而失效
（§1.5）⇒ 继续沿用单窗口会**结构性**丢弃「仅 08:00 链成功」的那类交易日，且该丢弃与 22:00 链失败**相关** ⇒ 样本偏倚。
⇒ **remedy = v6.0 §5.8 重锚为预登记序列 `W1 ∪ W2`（first-window-wins）**。**状态：`CLOSED-UPON-V6.0-FREEZE`**。

---

## 2. 核心对比对象（唯一主对比）

| 列 | 来源 | 含义 |
|---|---|---|
| `baseline_suggested_position` | **`run_candidate_decision.suggested_position`** | **V3.6.1 生产建议执行仓** |
| **`counterfactual_suggested_position`** | **`run_candidate_decision.gen1_counterfactual_suggested_position`** | **完整组合账本（组合 cap 后）的反事实建议执行仓** |

**理由（代码级）**：

1. `gen1-canary.js:274` `counterfactualSuggestedPosition: suggested`，注释 L273 明示「本轮组合约束后的**建议执行仓**（账本按它占用；与生产同口径）」。
2. 非 Candidate 日回落 baseline（L256）⇒ **天然产出对照组**，与 §4 自洽。
3. 若绑 `gen1_canary_suggested_position`，对照组行全部为 `null` ⇒ §4 不可执行。

### 2.1 `candidate_only_aux`（正式定名）

```text
gen1_canary_suggested_position  →  candidate_only_aux
```

- 语义：**仅**回答「当 Candidate 真正触发时，单只 Gen-1 S4 rerun 给出了什么建议」。
- ⛔ **不参与 Evidence 主评分**（不进 Q1/Q2/Q3、不计入 ≥30）。

### 2.2 辅助列（不用于主判定，仅供归因）

`gen1_counterfactual_target`、`gen1_counterfactual_delta`、`gen1_counterfactual_baseline_floor_breached`、`gen1_counterfactual_clamped`。

### 2.3 ⛔ 三条禁止

1. ⛔ 禁止「主列取 `candidate_only_aux`、`null` 时回退账本字段」的**隐式 fallback**（两套口径混算）。
2. ⛔ 禁止继续把 `gen1_canary_suggested_position` 标为**主列来源**。
3. ⛔ 禁止把两条列**混入 Q1/Q2/Q3**。

---

## 3. 样本字段（17 列，逐日一行一码）

每个 **(run_id, code)** 组合产生一行 —— ★ v5.0 起行键改为 **`run_id + code`**（见 §3.0）。
字段定义沿用 v1.0 §2（**逐字不变**），并给出 **ENFORCE 下的实际来源绑定**：

| # | 字段 | 类型 | **v5.0 来源（run 轴）** | v4.0 旧绑定（legacy 轴，已废） | 冻结口径 |
|---|---|---|---|---|---|
| 1 | `date` | date | **`run_candidate_decision.decision_date`**（**数据最新日**） | ~~`decision_result.decision_date`~~ | ⛔ 不用 `updated_at` |
| 2 | `code` | string | Main5：513310 / 515880 / 159582 / 518880 / 159570 | 同 | 仅 Main5；510300 不入表 |
| 3 | `regime` | string | **`run_candidate_portfolio.decision_market_regime`**（同 `run_id`） | ~~`portfolio_snapshot.decision_market_regime`~~ | ⛔ 不得由 Gen-1 signal lane 推导 |
| 4 | `stage` | string | **`run_candidate_decision.v361_baseline_stage`**（同 `run_id`） | ~~`decision_result.v361_baseline_stage`~~ | ⛔ **不是** Gen-1 signal stage |
| 5 | `domain_status` | string | 同 `(date, code)` 的 `ml_shadow_signal.domain_status` | 同 | **仅作模型适用域描述** |
| 6 | `probability` | number | 同 `(date, code)` 的 `ml_shadow_signal.calibrated_probability`；缺失按冻结规则取 `ml_probability` | 同 | 4 位小数；缺失记 `null` |
| 7 | `baseline_suggested_position` | number | **`run_candidate_decision.suggested_position`**（%） | ~~`decision_result.suggested_position`~~ | 1 位小数 |
| 8 | `counterfactual_suggested_position` | number | **`run_candidate_decision.gen1_counterfactual_suggested_position`**（%） | ~~`decision_result.gen1_counterfactual_suggested_position`~~ | 1 位小数 |
| 9 | `delta_position` | number | `counterfactual − baseline`（百分点） | 同（派生） | 1 位小数；**可为负** |
| 10 | `forward_5d` | number | 自 `date` 起第 5 个交易日**收盘价**收益率（%） | 同 | T+5 收盘 / T 收盘 − 1 |
| 11 | `forward_10d` | number | 同口径 T+10 | 同 | 同上 |
| 12 | `forward_20d` | number | 同口径 T+20 | 同 | 同上 |
| 13 | `MFE` | number | 窗口 T+1..T+20 最大有利变动（%），**用收盘价** | 同 | 正数；方向按 delta 方向取有利侧 |
| 14 | `MAE` | number | 同窗口最大不利变动（%） | 同 | 负数；方向同上 |
| 15 | `false_fast_path` | boolean | `ml_fast = true` 但事后 T+5 收益为负 | 同 | 依据 `forward_5d < 0` |
| 16 | `event_cluster_id` | string | 同一事件簇共享 ID（**计算规则见 §3.4**） | 同 | 无事件记 `NONE` |
| 17 | `independent_event` | boolean | **同簇内首个 Candidate 行**为 `true`（**计算规则见 §3.4**） | 同 | 对照行**恒 false** |

### 3.0 ★ **Evidence SAMPLE IDENTITY 与 SELECTOR**（v5.0 新增，v6.0 沿用，冻结）

#### 3.0.1 三个身份量（互不替代）

```text
(I)   RUN IDENTITY      = { run_id, revision, pointer_revision }
(II)  DATA DATE         = run_candidate_decision.decision_date   （= calc_date）
(III) RUN DATE          = run_manifest.expected_trade_date       （= candidate_portfolio.snapshot_date）
```

⛔ 三者**不得互换、不得合并为一个 "date"**。
⛔ **(IV) CALENDAR TRADE DATE**（`runtime_status.v365_run_integrity.expected_trade_date`）**不进 Evidence**（见 §3.5）。

#### 3.0.2 **SELECTOR = S-PROMOTED**（唯一合法 selector）

```text
SELECTOR: S-PROMOTED
  R := active_run_pointer[scope="production"].run_id
       读取一次即 pin 住（pinned_once），⛔ 全程不重读

⛔ 不采用 S-LATEST          （任意最新 COMPLETE run）
⛔ 不采用 S-VALIDATED       （最新 validation_passed = true 的 run）
```

**理由（DECISION / RATIONALE）**：

| # | 理由 | 证据 |
|---|---|---|
| 1 | Evidence 的对象是「**生产已采纳的** authoritative decision」，不是「生产算出来的」 | `run_history.promoted` 是**唯一**显式给出「是否被采纳」的布尔；09-30 = `true`，10-01 = `false` |
| 2 | 承重墙 **R7**：不得因 candidate 有数据就声称 production 已消费 | 10-01 run 的 candidate 10 行**完整存在**，但生产**显式判其不合格**（`validation_passed=false` / `v365_promotion_attempted=false`） |
| 3 | `S-LATEST` 会读到 `mixed_date_detected` 的 run ⇒ 违反 §4「通路正常态」 | 10-01 run 实测即 `mixed_date_detected` |
| 4 | `S-VALIDATED` 只证明「未被拒绝」，**不证明被采纳**；仅在「validation 通过但 CAS 未获」的情形与 `S-PROMOTED` 分叉，而那时它**会选中未被采纳的 run** ⇒ 同属 R7 违反 | 门 3 的 CAS 语义（`classifyPointerPromotion`） |
| 5 | `S-PROMOTED` 与 reader-migration **目标读源同构**（`authority_selector = active_run_pointer.run_id`） | `v365-active-read.js` 的 `readAuthoritativeDataset` 语义 |
| 6 | `S-PROMOTED` 是**事件驱动**（下一次成功提升即产出），非结构性永久 FAIL | 指针当前 `revision=1`，自 09-30 22:01 未再前进 |

#### 3.0.3 **promotion 证明（五条 AND，缺一即 fail-closed）**

```text
PROMOTION_PROOF(R) :=
    active_run_pointer[production].run_id == R
AND run_history[R].promoted == true
AND run_history[R].read_after_write_consistent == true
AND run_manifest[R].validation_passed == true
AND run_manifest[R].revision == active_run_pointer[production].revision

任一条不成立
  → EVIDENCE_OBJECT_UNAUTHORITATIVE
  → BUNDLE_INVALID → NON-SCORING → NO RETROACTIVE RECONSTRUCTION
```

#### 3.0.4 **sample_key / bundle_key**

```text
sample_key  = <run_id> + '::' + <code>        ← 行唯一键
bundle_key  = <decision_date>                 ← bundle 唯一键（§5.5）

⛔ `pointer_revision` **不进 sample_key**：
   实测 pointer.revision ≡ 被提升 run 的 run_manifest.revision（09-30 run 二者俱为 1）
   ⇒ 对 `run_id` **函数依赖**，对行身份**无区分力**；
   但它**必须**进 bundle 的 provenance（用于 §5.4 规则 A2 的一致性校验）。

⛔ `run_id` **必须**进 sample_key：
   实测两个 run（engine:2026-09-30:… / engine:2026-10-01:…）的 decision_date **均为 2026-09-30**
   ⇒ 若仍用 (date, code) 作行键将发生 **键碰撞**（10 行折叠为 5 键）
```

### 3.1 ★ `regime` 精确绑定 + **双日期双组**（v5.0 重定义）

```text
Evidence.date
= run_candidate_decision.decision_date          （数据最新正式交易日）
  where run_id == R

Evidence.regime
= run_candidate_portfolio.decision_market_regime
  where run_id == R
  from the same accepted C-1 capture bundle
```

**来源层级（v5.0 定，⛔ 不得替代）**：

| 字段 | 定位 |
|---|---|
| `run_candidate_portfolio.decision_market_regime` | ✅ **AUTHORITATIVE EVIDENCE REGIME（唯一主来源）** |
| `run_candidate_portfolio.market_regime` | ⚠️ **legacy_snapshot_regime / DIAGNOSTIC ONLY** —— ⛔ 不得用于分层、分域、判定 |
| `run_candidate_decision.effective_market_regime` | ⚠️ **downstream sizing diagnostic** —— ⛔ 不作来源（⚠️ 实测 518880 缺键，见 F-15） |
| `portfolio_snapshot.decision_market_regime` | ⛔ 不作来源（ENFORCE 后停写；且该集合为混合轴，见 §3.6） |
| `ml_shadow_signal.market_regime` | ⛔ 不作来源（lane-local，见 §9.3） |

**⛔ 不要求 `effective_market_regime` 与 `decision_market_regime` 相等**（沿用 v4.0，理由不变）：

```text
v3-bull-participation.js:115-128  resolveEffectiveRegime(baseRegime, bullScore, portfolio)
  if (base === 'crisis' || base === 'defensive') {
    if (bullScore >= BULL_TIER.recovery) return 'recovery';   ← 合法分歧
    return base;
  }
```

⚠️ **故 ⛔ 不得把「二者相等」写成硬 Gate** —— 那会**误杀**正常 bundle。

**双组（v5.0 重定义，v6.0 沿用；run 轴 vs data 轴）**：

```text
组 A —— RUN 轴自洽（同一 run 内，⚠️ 廉价一致性护栏，近似恒真，但保留）
  A1: run_candidate_portfolio[R].snapshot_date == run_manifest[R].expected_trade_date
  A2: run_manifest[R].revision == active_run_pointer[production].revision
  A3: run_manifest[R].run_id == run_history[R].run_id == active_run_pointer[production].run_id

组 B —— DATA 轴（跨源，**有信息量**）
  B1: run_candidate_decision（R）的 5 行 decision_date 必须完全相同
  B2: 该 decision_date == ml_shadow_signal.date（Main5 五行全等）
  B3: run_candidate_decision（R）的 5 行 calc_date 全等，且 == decision_date
  B4: decision_date <= run_manifest[R].expected_trade_date   （数据不得"来自未来"）

⛔ 组 A ≠ 组 B 是正常态，不得断言四者全等。
⛔ ⛔ (IV) CALENDAR TRADE DATE **不得**写入 A / B 任一组（host-local，§3.5）。
```

**为何组 A 改为 run 内自洽**：

```text
v4.0 组 A 右端 = runtime_status.decision_date（**单例、最后写入者**）
⇒ 该字段被**不可提升的 08:00 run** 覆盖（index.js:1653 无条件写）
⇒ 与被 pin 的 promoted run（run 日 09-30）在 10-01 起**永久不等**
⇒ 恒定 FAIL = 工具性误杀，且**不可复现**（依赖读取时点，违反 R8）
实读：runtime_status.decision_date = 2026-10-01（最后写入者 = 08:00 run）
      active_run_pointer.expected_trade_date = 2026-09-30
```

**实测印证（as-of 2026-10-02 11:51 +08）**：

```text
组 A（run = engine:2026-09-30:b1790776862980）
  A1: snapshot_date 2026-09-30 == manifest.expected_trade_date 2026-09-30   ✅
  A2: manifest.revision 1 == pointer.revision 1                            ✅
  A3: 三者 run_id 全等                                                      ✅
组 B（decision_date = 2026-09-30）
  B1: 5 行 decision_date 全为 2026-09-30                                     ✅
  B2: ml_shadow_signal.date = 2026-09-30（5 票齐）                          ✅
  B3: 5 行 calc_date 全为 2026-09-30 == decision_date                       ✅
  B4: 2026-09-30 <= 2026-09-30                                             ✅
```

### 3.2 方向约定（沿用 v1.0，冻结）

- `delta_position > 0` → Gen-1 建议**加仓**；`< 0` → **减仓**。
- 收益方向与 **delta 方向**对齐判断「对不对」：
  - 加仓且 `forward_Nd > 0` → ✅ 对；加仓且 `< 0` → ❌ 错
  - 减仓且 `forward_Nd < 0` → ✅ 对（躲跌）；减仓且 `> 0` → ❌ 错（踏空）

### 3.3 MFE / MAE 口径（沿用 v1.0，冻结）

- 窗口固定 **T+1 .. T+20**（20 个交易日），不因 beta 结果缩短。
- 基准价 = T 日收盘价。
- `MFE = max(路径内最高收盘 / T 收盘 − 1)`；`MAE = min(路径内最低收盘 / T 收盘 − 1)`。
- 未满 20 个交易日记 `null`，⛔ **不得**用现有天数凑近似值。

### 3.4 ★ `event_cluster_id` 与 `independent_event` 的计算规则（v3.0 新增并冻结；**v4.0 / v5.0 沿用，⛔ 未改**）

**规则 = C-B（时间维去相关）+ 混合标记**：

```text
CLUSTER_GAP_DAYS = 10

① event_cluster_id —— 对**全表**（Candidate 行 + 对照行）计算：
   同一 code 按 date 升序；与同 code 上一条样本的间隔 ≤ CLUSTER_GAP_DAYS 天
   ⇒ 归入同一簇；否则开新簇。
   ⛔ 不对「同一交易日的不同 code」做合并（见下方「已知局限」）。

② independent_event —— 只有 **Candidate 行**可能为 true：
   每一簇内，**首个 `delta_position != 0` 的行**标记 `independent_event = true`；
   该簇内其余行一律 false。
   若某簇内**无** Candidate 行 ⇒ 全簇 `independent_event = false`。

③ 对照行取值：
   event_cluster_id  —— 正常参与聚类（用于界定簇边界）
   independent_event —— **恒 false**
```

**为何这样定（决策依据）**：

1. §7.1 规定 `independent_event` 是 Q1 p 值的**计数单位** ⇒ 计数单位必须是**有信息量的观测**；只有 `delta_position != 0` 的行才可能「对 / 错」。
2. §4.1 的对照组是为**比较**（Q2 / Q3）而存在，**不是**为「证明 Gen-1 有价值」提供独立证据。
3. ⛔ 若允许对照行为 `true` ⇒ `independent_events >= 30` 可在**零真实 Candidate**时达成 ⇒ 该成熟度门槛将**不度量任何东西**。
4. ⛔ 若只用 Candidate 行聚类 ⇒ 当前 Candidate = 0 时**无法界定任何簇边界**。

**已知局限（必须随每次报告显式声明）**：本规则**未建模同一交易日跨 code 的相关性**。
同一交易日 5 只 code 受**同一市场环境**驱动，可能被计为多个独立事件 ⇒ 报告的独立性**偏乐观**。
⛔ 不得把结论表述为「已充分独立」。

**⚠️ 由此得出的重要性质（必须与结论同读）**：
本规则下 `independent_events` 的增长**完全取决于真实 Candidate 的出现频率** ——
对照行不贡献、无 Candidate 的簇不贡献。
⇒ 在真实 Candidate 出现之前，`independent_events` **恒为 0**，⛔ 不得据此推断「接近门槛」。

### 3.4A ★ `INDEPENDENCE REQUIREMENTS`（v6.0 新增；规范性澄清，⛔ 不改变 §3.4）

> **为什么需要本条**：§3.4 只定义**逐行**的 `independent_event`（簇内首个 `delta≠0` 行为 `true`），
> **没有**一条把「两个被采纳 run」显式判为独立 / 不独立的条款 ⇒ 存在被误读为
> 「`run_id` 不同即独立」的空间。**该误读已被反向证明当场证伪**（旧规则在三条真实反例上给出错误的 `INDEPENDENT`）。

```text
§3.4A  INDEPENDENCE REQUIREMENTS（两 run 是否构成两个独立 Evidence 事件）

INDEPENDENT(A, B)  ⟺  下列 I1–I7 **全部**成立：

  I1  PROMOTION_PROOF(A) ∧ PROMOTION_PROOF(B)          [§3.0.3 五条 AND，缺一 fail-closed]
  I2  run_id(A) ≠ run_id(B)                            [§3.0.1 (I)] —— ★ **必要，非充分**
  I3  decision_date(A) ≠ decision_date(B)              [§5.5 ①③④：同一 decision_date 至多一个 bundle]
  I4  输入侧 provenance 互异（逐源 raw SHA256 + expected_codes）  [§5.3 八源]
  I5  跨事件簇：同 code 间隔 > CLUSTER_GAP_DAYS        [§3.4 ①]
  I6  A、B **各自**至少一个 code 的 delta_position ≠ 0  [§3.4 ② + §7.3] —— **必要条件**
  I7  candidate identity 互异                          [§3.0.1 / §3.0.4 / §5.3]
      口径：两 run **各自携带**可用 `gen1_candidate_hash` 映射时，其逐 code 映射**不得深等**；
      一侧缺载 ⇒ CANDIDATE_IDENTITY_INCOMPARABLE（**仅记录，⛔ 不得据此判否**）。

⛔ 明确排除（**均不得**作为独立性判据）：
    · `trigger` / `trigger_id`
      （两条链对 Evidence 同等有效 —— 见 §5.6；★ trigger **不是**独立性判据）
    · `candidate_content_sha`、`pointer_revision`、`run_date`(III)、`calc_date`、
      `expected_trade_date`、`event_id`、`input_hash`
    · **capture 窗口身份（W1 / W2）** —— ⛔ 窗口不同**不**构成独立事件（见 §5.8）

⛔ 判据顺序是语义的一部分（不可交换）：
    可评估性 → 运行身份 → bundle_key → provenance → candidate identity → payload 诊断 → 簇 → 有信息量行。

失败语义（fail-closed）：
    任一 I1/I2 不成立                      → NOT_EVALUABLE（不得计入独立事件）
    任一 I3/I4/I5/I6/I7 不成立              → NOT_INDEPENDENT（不得计入独立事件）
    充分性（「分别是其所在簇内**首个** delta≠0 行」）需全表簇上下文 ⇒ 结论须携带
    sufficiency_scope = NECESSARY_CONDITIONS_ONLY
```

**单向性质（⛔ 可机械检验，必须每轮复核）**：I1–I6 逐条沿用既有语义
（§3.0.3 / §3.0.1 / §5.5 / §5.3 / §3.4 / §7.3），**I7 为新增** ⇒ **只增不减**。
⇒ **任何在本条生效前的判据下 `NOT_INDEPENDENT` 的一对 run，在本条下不得变为 `INDEPENDENT`**；
⇒ `independent_events` 计数**不会**因本条而上漂（已由 自证 + 非干预 + 打红 + 反向证明 四项验证）。

**★ `independent_events` 计数规则（新增计数判据，⛔ 不得混淆）**：

```text
若 INDEPENDENT(A, B) 成立 ⇒ 该对构成 **两个** 独立 Evidence 事件（+2，非 +1）。
若 NOT_INDEPENDENT(A, B)  ⇒ 该对**不**增加独立事件计数（后到者为 NON_SCORING，见 §5.5 ③）。
checkpoint 窗口身份（W1 / W2）与 trigger 身份**均不**参与本计数。
```

### 3.5 ★ **日期概念排除声明**（v5.0 重写，v6.0 沿用；修 `CD-03`；⛔ v6.0 **未**扩展日期轴）

**四个日期概念，两个入契约、两个不入**：

| # | 概念 | 载体（实读值，as-of 2026-10-02 11:51 +08） | 是否入 Evidence 消费集合 | 定位 |
|---|---|---|---|---|
| **(I)** | **RUN IDENTITY** | `run_id` / `run_manifest.revision` / `active_run_pointer.revision` | ✅ **入**（作 **provenance / 行键分量**，⛔ 非统计量） | EVIDENCE PROVENANCE |
| **(II)** | **DATA DATE** | `run_candidate_decision.decision_date` = `calc_date` = `2026-09-30` | ✅ **入**（= `Evidence.date`；forward 收益的 T0） | **EVIDENCE PRIMARY DATE** |
| **(III)** | **RUN DATE** | `run_manifest.expected_trade_date` = `run_candidate_portfolio.snapshot_date` = `2026-10-01`（10-01 run） | ✅ **入**（**仅**用于 §3.1 组 A 的 run 轴自洽校验，⛔ **不得**作 `Evidence.date`） | EVIDENCE RUN-AXIS GUARD |
| **(IV)** | **CALENDAR TRADE DATE** | `runtime_status.v365_run_integrity.expected_trade_date` = `2026-09-30`（源 `cn-trading-calendar`，`calendar_version = cn-a-share-2026.1`） | ⛔ **不入** —— 仅作 bundle 的**对齐诊断**留存 | **HOST-LOCAL DIAGNOSTIC** |
| — | `observed_latest_date` | `runtime_status.v365_run_integrity.observed_latest_date` = `2026-09-30` | ⛔ **不入** | **HOST-LOCAL DIAGNOSTIC** |

**理由**：

1. `Evidence.date` 必须是**价格可得的日期**（forward 收益的 T0 需有收盘价）⇒ 只能是 **(II) DATA DATE**；**(IV)** 是「数据可用性期望」，不是价格日期。
2. 在 **S-PROMOTED** 下，被采纳的 run 已经过 `validation_passed=true`（即 `calc_date == snapshotDate` 一致性确认）⇒ **(IV) 对 Evidence 已无增量判别力**。
3. 把 (IV) 写进契约会让契约**耦合到 `cn-trading-calendar` 的版本与实现**，违背 §11 不可变性意图。
4. **(III) 必须入组 A**（否则组 A 无从校验），但 ⛔ **不得**充当 `Evidence.date` —— 这正是 `CD-03` 要防的混淆。

**⛔ 本契约的日期口径为「Data 轴 + Run 轴」两组，⛔ 不扩展为「三个 Evidence 日期」。**

⛔ **不得**因 (III) / (IV) 的存在而：

- 新增 Evidence 统计字段或 eligibility 判据；
- 把「宿主 run 日期对齐失败」当作 Evidence 的**额外**排除条件
  —— 该失败已由 §3.0.3 `PROMOTION_PROOF` 的 fail-closed 覆盖（未通过 validation 的 run 永不可能被 pin）。

> ⚠️ **本条的复核条件已触发并已就地闭合**：
> v4.0 §3.5 的复核条件为「若 V3.6.5 首次自然运行后 `expected_trade_date` **确实落入了** Evidence 消费的集合，本条须重审」。
> 实测（V3.6.5 首两次自然运行）：`run_manifest` 已被本契约 §5.3 纳为**源** ⇒ 复核条件**成立**
> ⇒ v5.0 **就地完成重审**：拆分同名两义（`CD-03`）、把 (III) 限定为「组 A 护栏、⛔ 不作 `Evidence.date`」、(IV) 继续 host-local。
> ⛔ 该闭合**不构成**「把 (IV) 引入 Evidence」。

### 3.6 ★ `portfolio_snapshot` 与 `run_candidate_portfolio` 的语义分界（v5.0 新增）

| 维度 | `portfolio_snapshot`（legacy，**混合轴**） | `run_candidate_portfolio`（**纯 run 产物**） |
|---|---|---|
| 写入方 | ⚠️ ① 引擎（**仅 LEGACY 模式**，`index.js:558`）；② **`adminGateway.persistLiveSnapshot`**（`adminGateway/index.js:829`）；③ 资产编辑（`:1027`） | ✅ 仅引擎（ENFORCE 模式，`putCandidate`，`index.js:560`） |
| ENFORCE 后是否仍写 | ⚠️ **仅资产字段**被 `adminGateway` 写（**不含** `decision_market_regime`） | ✅ 每次 ENFORCE run 写一次 |
| 语义轴 | **混合**：run 产物 + **MUTABLE_STATE**（用户维护资产字段） | **纯 run 产物**（immutable per run） |
| `decision_market_regime` | 有（legacy 遗留，实测 09-30 = crisis） | 有（run 产物，实测 crisis） |
| 行数 / 最新（实读） | **41** / `2026-09-30` | **2** / 两个 run |

**E-2 闭合（UNV-23）**：`COLLECTIONS.PORTFOLIO_SNAPSHOT` 的 upsert 在 `origin/master` 上**只有两处**，
均在 `adminGateway`（`:829` / `:1027`），写入字段**全为资产轴**；
引擎侧 upsert（`runDecisionEngine/index.js:1124`）在 ENFORCE 下被 `v365WritePortfolio` 短路。
⇒ **ENFORCE 之后 `portfolio_snapshot` 没有引擎写入方**。

⇒ **结论**：`portfolio_snapshot` **不可**作为 run 产物源；`Evidence.regime` ⛔ 不得取该集合。
⚠️ `run_candidate_portfolio` 里**同时**含资产字段（`total_asset` 等），Evidence **只应取 `decision_market_regime`**（+ `snapshot_date` 作组 A），
⛔ 不得把 candidate 组合快照整体当作「资产现状」（那是 MUTABLE 轴的事）。

---

## 4. 样本纳入与排除规则（**E1 — DAILY FULL-SAMPLE**）

### 4.1 纳入

```text
Canary 处于 counterfactual_canary_active = true 的每个合格交易日，
对该日被采纳（PROMOTION_PROOF 通过）的 run 的 Main5 每个 code 产生一行。

Candidate 与 non-Candidate 都入样；
non-Candidate 为 control（delta_position = 0）。
```

**合格交易日** = 满足本节纳入规则 ∧ 未触发 §4.2 排除规则 ∧ **通过 §5 的 Bundle Coherence Gate**。

**Candidate 与否的判定**：⛔ **单独由冻结 Candidate 条件决定**；⛔ **不得**用 `probability` 是否 `null` 反推。

### 4.2 排除（显式列出，防事后挑样本）

1. `runtime_status.gen1_counterfactual_canary_active = false` 的交易日。
2. `runtime_status.gen1_health_gate_status != 'ACTIVE'` 的交易日。
3. `runtime_status.gen1_counterfactual_ledger_ok != true` 的交易日。
4. `date` 缺失或 `baseline_suggested_position` 缺失的行。
5. **§5.2 `PROVENANCE_MISSING`** 或 **§5.4 `BUNDLE_INVALID`** 的交易日。
6. **§3.0.3 未通过 `PROMOTION_PROOF`** 的 run（其全部行）。
7. **§5.9 `EVIDENCE OBJECT BOUNDARY` 不成立** 的 bundle。

> 排除规则的唯一目的是「样本必须是**通路正常态**下的观测」，**不是**为了事后剔除不利样本。
> 任何对本节的修改 = 契约版本升级 + 样本重算。

### 4.3 与里程碑协议的关系（澄清 v1.0 的四处表述冲突）

`GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md` §2 M5 与 `GEN1_DAILY_PRODUCTION_WATCH.md` §3.1 M5 所称
「证据表**第一条真实样本**」，**正解为**：

> **第一条 `delta != 0` 的真实 Candidate 样本 / 首个 Candidate 里程碑样本**

⛔ **不是**「Evidence 表从零开始的第一行」。里程碑协议只负责**捕获首次触发**，**不得**反写样本总体规则。

---

## 5. 每日 eligibility provenance 与 capture bundle

### 5.1 采用 C-1：EXTERNAL READ-ONLY DAILY SNAPSHOT

**性质**：Evidence 工作包**本地/归档**写入，⛔ **不是生产 DB 写入**；⛔ **不改生产语义**。

| 方案 | 处置 |
|---|---|
| **C-1 外部只读日快照** | ✅ **采用** |
| C-2 生产侧新增逐日行 | ⛔ `NOT AUTHORIZED` |
| C-3 代理判据 | ⛔ **REJECTED** —— 代理字段**不能**证明 `active` / `ledger_ok` |

**缺口依据（实测）**：`gen1_counterfactual_canary_active` 与 `gen1_counterfactual_ledger_ok`
**仅存于 `runtime_status` 覆盖式单例**，`decision_result` / `run_candidate_decision` **逐日不留存** ⇒ 无法回溯。

### 5.2 硬规则一：缺当日快照 ⇒ 当日不可作为正式样本（fail-closed）

```text
PROVENANCE_MISSING
→ FAIL-CLOSED
→ NON-SCORING
→ NO RETROACTIVE RECONSTRUCTION
```

⛔ **不得**第二天用 `runtime_status` singleton 倒填。⛔ **不得**用今日状态倒推过去。

### 5.3 硬规则二：每日 capture bundle（append-only，**八源**）

★ v5.0 源集合：**保留 3 + 改绑 2 + 新增 3 = 8 源**。

```text
decision_date            （= Evidence.date，(II) DATA DATE）
run_id                   （= (I) RUN IDENTITY，被 pin 的 promoted run）
bundle_revision          （本 bundle 格式版本）
capture_timestamp
checkpoint_ok            （§5.8 判定结果）
checkpoint_window_id     （v6.0 新增：∈ {W1, W2, null} —— ⛔ 仅记录捕获窗口身份，⛔ 不进 §3.4A 判据）

# --- eligibility（唯一来源 = runtime_status 单例；仅主字段） ---
runtime_status.updated_at
gen1_authority
gen1_counterfactual_canary_active
gen1_health_status
gen1_health_gate_status
gen1_counterfactual_ledger_ok
gen1_production_write
gen1_auto_execution

# --- run identity / selector provenance ---
pointer_revision                 （active_run_pointer.revision，读取时 pin 住）
run_manifest.revision
run_manifest.expected_trade_date （(III) RUN DATE —— ⛔ 仅作组 A 护栏）
run_manifest.validation_passed
run_history.promoted
run_history.read_after_write_consistent
run_history.cas_reason
run_history.promoted_at

# --- 对齐诊断（⛔ 不参与 eligibility） ---
calendar_version
calendar_expected_trade_date     （(IV) —— HOST-LOCAL DIAGNOSTIC）
observed_latest_date
date_alignment_case

# --- 八源 raw SHA256（append-only） ---
raw runtime_status          SHA256
raw run_manifest            SHA256
raw run_history             SHA256
raw active_run_pointer      SHA256
raw run_candidate_decision  SHA256
raw run_candidate_portfolio SHA256
raw ml_shadow_signal        SHA256
raw invocation log record   SHA256
```

**八源清单（★ v5.0）**：

| # | 源 | v5.0 角色 | v4.0 状态 |
|---|---|---|---|
| 1 | `runtime_status` | eligibility **唯一**来源（**降为 eligibility-only**） | 保留（原兼任组 A 右端 ⇒ 已撤销） |
| 2 | `ml_shadow_signal` | 字段 5/6 + 组 B 右端 | 保留 |
| 3 | `invocation log`（`tcb logs search`） | §5.6 `NATURAL_RUN_PROVENANCE` | 保留 |
| 4 | `run_candidate_decision` | 字段 1/4/7/8 + 组 B | 🔁 **改绑**（原 `decision_result`） |
| 5 | `run_candidate_portfolio` | 字段 3 + 组 A | 🔁 **改绑**（原 `portfolio_snapshot`） |
| 6 | `run_manifest` | (I)/(III) + validation | ➕ **新增** |
| 7 | `active_run_pointer` | selector pin + revision | ➕ **新增** |
| 8 | `run_history` | promotion proof | ➕ **新增** |

> ⛔ v5.0 **不再**把 `decision_result` / `portfolio_snapshot` 列入评分源。
> ⚠️ 二者仍是**生产前台现行读链**（迁移债 RH4 / CLASS C，见 §5.9）—— ⛔ 不得因此把两者混为一谈。

**★ v6.0：`trigger provenance`（登记口径，⛔ 非判据）** —— 八源之外，bundle 必须能回答「该 run 由**哪条自然管线**产生」：

```text
trigger provenance :=
    trigger_id            （完整枚举域见 §5.6.3 Trigger Registry）
  + schedule（cron 真值） （云端 tcb fn detail 实读）
  + entry_point           （该链的 TRIGGER_TIMER 入口函数）
  + producer              （产生 run 的函数，恒为 runDecisionEngine）
  + writes_collections    （该 trigger 的写入集合）
  + chain_id              （W1-2200 / W2-0800；⛔ 仅作来源标注，⛔ 非独立性判据）
```

⛔ `trigger provenance` **不是** §3.4A 的独立性判据：它只回答「来源可证明」，**不**回答「是否独立」。
⛔ `chain_proof` **不是**独立性判据：两条链**同等有效**（§5.6.2），⛔ 不得因链身份判否或判是。

### 5.4 硬规则三：`BUNDLE COHERENCE GATE`（v5.0 重写）

```text
1.  本 checkpoint 前最近一次被 promoted 的 run == 本次 pin 的 R
    （判定：active_run_pointer 于 capture 时刻的 run_id == R；⛔ 不查 runtime_status）
2.  pointer.revision 必须严格大于上一有效 bundle 的 pointer_revision
    （首个 bundle 见 §5.7）
3.  PROMOTION_PROOF(R) 五条 AND 全真（§3.0.3）
4.  run_candidate_decision(R) 恰有 Main5 五个 code
5.  该 run 五行 decision_date 完全相同                              （组 B1）
6.  ml_shadow_signal.date == 该 decision_date                        （组 B2）
7.  该 run 五行 calc_date 全等且 == decision_date                     （组 B3）
8.  decision_date <= run_manifest[R].expected_trade_date              （组 B4）
9.  run_candidate_portfolio(R).snapshot_date == run_manifest[R].expected_trade_date  （组 A1）
10. ml_shadow_signal 覆盖同一 Main5 code set
11. §3.0.3 的 run/revision 三者一致（组 A2/A3）
12. §5.6 NATURAL_RUN_PROVENANCE（含 CHAIN PROOF）
13. 任一 source 缺失 / 日期不一致 / code set 不完整 / 来源不可证明
    → BUNDLE_INVALID → NON-SCORING → NO RETROACTIVE RECONSTRUCTION
14. ⛔ (IV) CALENDAR TRADE DATE 不得出现在以上任一条的判据中
```

⚠️ **实施注意**：规则 5/6/7/8 属**组 B**（data 轴），规则 9/11 属**组 A**（run 轴）；
⛔ **不得**写成「四个日期全等」—— 那会**误杀每一个 bundle**（§3.1 实测：`09-21` vs `09-18`）；
⛔ 也**不得**写成「promoted run 的 run 日期 == 日历交易日」—— 见规则 14。

**⛔ 规则 1 / 2 的 v4.0 形态已废除**：v4.0 以 `runtime_status`（**单例、最后写入者**）为排序装置，
而该单例被**不可提升的 08:00 run** 无条件覆盖（`index.js:1653`）⇒ 排序信息被污染且**不可复现**（违反 R8）。
v5.0 改用 **`active_run_pointer`（单指针、单调 `revision`、promotion-bound）**。

### 5.5 硬规则四：one-bundle-per-decision_date + **单调采纳**

```text
① 同一 decision_date  →  至多一个正式 Evidence bundle
② bundle_key = decision_date
③ 后到者（同 decision_date）→ BUNDLE_INVALID / NON-SCORING，⛔ 不得覆盖已接受 bundle
④ 新 bundle 的 decision_date 必须**严格大于**上一已接受 bundle 的 decision_date
   （否则 = 同一数据日的重述 ⇒ NON_SCORING）
⑤ ⛔ 不得事后挑选更好看的结果；⛔ 不得人工补跑
```

**理由**：

1. 同一数据日可能有**不止一个 run**（实测两个 run 的 `decision_date` 均为 `2026-09-30`）；
2. 必须有**机器可判定**的唯一采纳对象 —— 由 §3.0.3 `PROMOTION_PROOF` + 本节 ①–⑤ 共同给出；
3. ③④ 使「先到先得 + 单调」成为**可机械检验**的规则，消除 W1/W2 归属不可判定的历史问题；
4. ⛔ 不引入「事后择优」窗口。

### 5.6 硬规则五：`NATURAL_RUN_PROVENANCE` + **完整 `TRIGGER REGISTRY`**（v6.0 **补全**；修 `CD-06`）

#### 5.6.1 `NATURAL_RUN_PROVENANCE`（判据本身，⛔ 沿用 v5.0，**未改**）

```text
NATURAL_RUN_PROVENANCE

必须来自外部只读取证
通道 = tcb logs search（调用日志）+ tcb fn detail（trigger metadata）
不得从 runtime_status / run_integrity 自行推断

至少证明：
- runDecisionEngine invocation timestamp 与 request_id
- 该 invocation 的 engine_run_id == 被 pin 的 R
- request_source（本跳与上游跳分别记录）
- **该 run 属于预先冻结的自然管线**（见下方 CHAIN PROOF）
- capture checkpoint 在该 invocation 完成之后
```

#### 5.6.2 CHAIN PROOF —— **两条 PROMOTION-CAPABLE 链同等适用**（★ v6.0 核心修订）

```text
CHAIN PROOF（v6.0）：必须锚到产生该 run 的**入口**，且对两条链**逐字同等**适用。

(a) 生产存在**两条** PROMOTION-CAPABLE 链：
      W1-2200  fetchDailyData → materializeIndicators → runDecisionEngine
      W2-0800  materializeIndicators → runDecisionEngine
    ⛔ 二者对 Evidence **同等有效**；⛔ 不得因「历史上只有 22:00 能提升」而结构性排除 08:00 链。

(b) CHAIN PROOF 对两条链**逐字同等**适用（入口 = 各自 cron 触发的 TRIGGER_TIMER 调用）：
     · W1-2200 入口 = fetchDailyData       （cron 0 0 22 * * 1-5 *）
     · W2-0800 入口 = materializeIndicators（cron 0 0 8 * * 1-5 *）
    ⛔ 入口**不必**是产生 run 的函数；⛔ 不得要求 runDecisionEngine 自身带调度。

(c) ★ trigger **不是**独立性判据：两 run 是否构成两个独立 Evidence 事件，
    一律由 §3.4A 判据裁决（⛔ 不由 trigger / run_id / chain 身份 / capture 窗口裁决）。

(d) ⛔ 任何「不产 candidate」的 trigger **仍须**登记，并写明其写入集合与排除理由。
    口径：「**不写 Evidence 八源**」≠「**可以从 Trigger Registry 消失**」；**有调度**同样不等于可以消失。

(e) ⛔ 不对两跳做严格先后序约束（SCF 日志 timestamp = 刷写时刻，非完成时刻）。
(f) ⛔ 该 run 的 invocation **不必**落在 capture checkpoint 窗口内。
(g) ⛔ 必须排除**管理侧重入**：adminGateway/index.js 的 :547 `riskResolve` / :578 `riskTrigger`
    / :661 `paramChange` 会直接 callFunction runDecisionEngine ⇒ 该类调用**不是**自然运行。
```

**链式传播可从代码证明（⛔ 必须与 ref 同时引用，见 §9.4）**：

```text
fetchDailyData/index.js:424        → app.callFunction({ name: 'materializeIndicators', … })   [origin/master]
materializeIndicators/index.js:127 → app.callFunction({ name: 'runDecisionEngine', … })      [origin/master]
adminGateway/index.js:547/:578/:661→ 管理侧重入 runDecisionEngine（⛔ 排除）                  [origin/master]
```

**实测锚点（W1-2200，可复算，as-of 2026-10-02）**：

| 跳 | 函数 | `request_id` | 时刻（+08） | `request_source` |
|---|---|---|---|---|
| 1 | `fetchDailyData` | `3bc435d3-380b-4328-a39a-f07096231b75` | 2026-09-30 22:00:06 | `TRIGGER_TIMER` |
| 2 | `materializeIndicators` | `1c88d7ae-e117-4256-8549-62a9e48b13ea` | 2026-09-30 22:00:56 | `TCB_API`（链式） |
| 3 | `runDecisionEngine` | `c6ca469a-cc0c-4b24-af4f-dd00b0477134` | 2026-09-30 22:01:02 | `TCB_API`（链式） |

⇒ 第 3 跳的 `run_id` = `engine:2026-09-30:b1790776862980` = **被 pin 的 R**（实测 `active_run_pointer.run_id`）。

**⛔ 关键禁令（不变）**：⛔ **不得**要求 `runDecisionEngine` 自身 `request_source == TRIGGER_TIMER`
—— 其 `Triggers = 0`，自然调用**必然**表现为 `TCB_API`；该规则会 **100% 误杀每一次自然运行**。

**为什么禁止严格序**：SCF 日志 `timestamp` 是**日志刷写时刻**，不是**执行完成时刻**。
实测：下游 START `08:00:28.102` **早于**上游 END `08:00:30.339` 约 **2.24s**（刷写延迟）。

**`request_source` 观测取值域**（7d，10,797 条；⛔ 不主张为全域）：
`TRIGGER_TIMER` 7,325 / `TCB_GW` 1,520 / `""` 877 / `TCB_API` 75。

**失败路径**：

```text
无法证明来源
  → RUN_PROVENANCE_UNVERIFIED
  → BUNDLE_INVALID
  → NON_SCORING
```

#### 5.6.3 ★ **完整 Trigger Registry**（v6.0 补全；= **生产 trigger 的完整枚举域**）

⛔ 本表**取代** v5.0 §5.6 的「trigger 实读」5 行表（**修 `CD-06`**）。
⛔ 本表**不等于**「能产 promoted run 的链」清单 —— 它必须列出**全部**真实 trigger，无论其是否产 Evidence。

| # | `trigger_id` | `schedule`（cron 真值） | `entry point` | `producer` | `written collections` | 写八源（直接/传递） | 产 Evidence candidate | 参与 §5.8 checkpoint | 若排除，为什么排除 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `dailyFetch-2200` | `0 0 22 * * 1-5 *` | `fetchDailyData` → `materializeIndicators` → `runDecisionEngine` | `runDecisionEngine` | `etf_daily` / `fetch_log` / `fundamental_series` | ❌ / **✅** | **YES** | **YES**（W1 主来源） | —（PROMOTION-CAPABLE 链 `W1-2200`） |
| 2 | `dailyPipeline-0800` | `0 0 8 * * 1-5 *` | `materializeIndicators` → `runDecisionEngine` | `runDecisionEngine` | `etf_weekly` / `indicator_snapshot` | ❌ / **✅** | **YES** | **YES**（W2 主来源） | —（PROMOTION-CAPABLE 链 `W2-0800`；`CD-04` 修复后由「结构」转为「实际」） |
| 3 | `gen1-eod-weekdays-2220` | `0 20 22 * * 1-5 *` | `runGen1ShadowEod` | `runGen1ShadowEod` | **`ml_shadow_signal`** | **✅ / ✅** | NO | YES | INPUT-SIDE ONLY —— 不产 candidate，但**是**八源（`ml_shadow_signal`）**直接**写入者 ⇒ 必须留册（§5.8 的 W1 起点须晚于 22:20） |
| 4 | `gen2-eod-weekdays-2230` | `0 30 22 * * 1-5 *` | `runGen2ShadowEod` | `runGen2ShadowEod` | `gen2_shadow` | ❌ / ❌ | NO | NO | OUT OF SCOPE（Gen-2 lane 隔离，§0 不触碰 `ml/gen2/**`）；**22:30 落在 W1 内但写非八源** ⇒ 不破坏静默性 |
| 5 | `newsFetch-1630` | `0 30 16 * * 1-5 *` | `fetchFundamentalNews` | `fetchFundamentalNews` | `fundamental_news` / `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE（基本面管线）；写非八源 |
| 6 | `intelFetch-30min` | `0 0,30 8-22 * * * *` | `fetchFundamentalNews` | `fetchFundamentalNews` | `fundamental_news` / `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE；落在 W1(22:30) 与 W2(08:30/09:00) 内但写非八源 |
| 7 | `newsExtract-1640` | `0 40 16 * * 1-5 *` | `extractFundamental` | `extractFundamental` | `fundamental_series` / `fundamental_evidence` / `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE —— ⛔ v5.0 §5.6 表**未列**，本版补录（`CD-06`）；写非八源 |
| 8 | `intelExtract-30min` | `0 5,35 8-22 * * * *` | `extractFundamental` | `extractFundamental` | `fundamental_series` / `fundamental_evidence` / `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE —— ⛔ v5.0 §5.6**未列**、§5.8 枚举域亦未列；**22:35 落在 W1 内**（写非八源） |
| 9 | `realtime-5min` | `0 */5 9-15 * * 1-5 *` | `fetchRealtimeData` | `fetchRealtimeData` | `etf_daily`（`source='realtime'` 行）/ `fetch_log` | ❌ / ❌ | NO | NO | OUT OF SCOPE —— ⛔ v5.0 §5.6**未列**；**09:00–09:25 落在 W2 内**；写 `etf_daily` realtime 行（**非八源**；§9.1 已排除 `source='realtime'`） |

**无调度但必须留册者**（⛔「不写八源」≠「可以从 Registry 消失」；**有调度**同样不等于可以消失）：

| 函数 | `role` | 写八源（直接） | 说明 / 排除理由 |
|---|---|---|---|
| `runDecisionEngine` | `CHAINED_ONLY` | **✅**（`run_manifest` / `run_candidate_decision` / `run_candidate_portfolio` / `active_run_pointer` / `run_history` / `runtime_status`） | `Triggers = 0` ⇒ 不进 trigger 清单，但**是**八源**直接**写入者；自然调用必为 `TCB_API` 链式 |
| `adminGateway` | `MANUAL_REENTRY` | ❌ | §5.6.2(g) 明确排除：`:547` / `:578` / `:661` 直接 `callFunction runDecisionEngine` ⇒ 非自然运行 |
| `apiGateway` | `READ_ONLY` | ❌ | 只读读链（`orderBy(…).limit(1)`），不产生 run |

**云端不存在项（⛔ 必须显式声明，防「仓库配置冒充云端事实」）**：

```text
runIntegratedShadowEod   ： tcb fn detail ⇒ RESOURCE_NOT_FOUND（云端不存在）
dailyFetch-1530          ： 仓库 cloudbaserc.example.json 列了，但云端 fetchDailyData 实读仅 1 个 trigger
                           ⇒ ⚠️ 仓库配置证据 ≠ 云端实读证据
```

#### 5.6.4 Registry 的可执行校验（与契约**同批次冻结**）

| 构件 | 路径 | 角色 |
|---|---|---|
| 登记表 | `scripts/gen1/evidence-capture/fixtures/trigger_registry.json` | 本节的**机器可读**形态（= §5.6.3 表） |
| 云实测快照 | `scripts/gen1/evidence-capture/fixtures/trigger_registry_cloud_observed.json` | `tcb fn detail` 现场只读（as-of `2026-10-02T15:53:39+0800`） |
| 校验器 | `scripts/gen1/evidence-capture/trigger_registry.js` | S1–S6 检查 + 反向证明 |

**S1–S6 定义**：

| 检查 | 内容 |
|---|---|
| `S1 SCHEMA` | 每条登记项须含全部必备字段 |
| `S2 COMPLETENESS` | 「登记 vs 云实测」**双向**对拍（⛔ 缺失与多余**都**要抓） |
| `S3 EIGHT_SOURCE` | `writes_eight_source_direct` 必须与 `writes_collections ∩ 八源` 一致 |
| `S4 EXCLUSION_REASON` | 凡「不产 candidate」或「不参与 checkpoint」者必须写明排除理由 |
| `S5 CHAIN_COVERAGE` | 每条 PROMOTION-CAPABLE 链的入口 trigger 必须已登记且 `role == ENTRY` |
| `S6 CHECKPOINT_SILENCE` | 任一 checkpoint 候选窗口内**不得**存在「写八源」的 trigger（含 cron 真值匹配） |

⛔ **枚举域是 as-of 快照，不是永久完备性主张**：若生产新增 / 删除 timer，须重跑 Registry 校验器；
⛔ **不得**因「本表已列全」而免除重跑义务。

### 5.7 硬规则六：FIRST BUNDLE 例外

```text
FIRST OFFICIAL BUNDLE:
previous_valid_bundle = NONE
→ pointer.revision 前进性比较 = NOT_APPLICABLE
→ 其余 coherence gates 仍须全部 PASS

SECOND AND LATER:
active_run_pointer.revision  >  previous_valid_bundle.pointer_revision
```

### 5.8 `CANONICAL_CAPTURE_CHECKPOINT`（v6.0 **重锚**；`W1 ∪ W2` + first-window-wins；修 `CD-07`）

```text
CANONICAL_CAPTURE_CHECKPOINT（v6.0）

预登记的**有序窗口序列**（工作日，北京时间；⛔ 一经冻结不得事后新增 / 移动 / 放宽）：

  W1 = [22:30:00, 23:30:00)              —— 目标 decision_date D 的**当日夜间**
  W2 = 次一工作日 [08:30:00, 09:30:00)    —— 目标 decision_date D 的**次日晨间**

checkpoint_ok = weekday(capture_local) < 5  AND  capture_local ∈ (W1 ∪ W2)

pinned R 定义 ≡ §3.0.2 S-PROMOTED（capture 时刻 active_run_pointer[production].run_id，读取一次即 pin）
⛔ pinned R 与 trigger **无关**；⛔ 不得按 chain 身份挑 run。
```

**`first-window-wins` 执行规则（★ owner B2 点名要求；必须逐字实现）**：

```text
capture(D):
  1. 按序 W1 → W2 检查（同一捕获会话内）。
  2. 取序列中**首个**满足「pinned R 的 decision_date == D」的窗口 ⇒ 产出，window_id = 该窗口，
     该 D 的捕获**终止**（⛔ 不再在后续窗口重复捕获 = first-window-wins）。
  3. 若某窗口内 pinned R 的 decision_date ≠ D ⇒ 本窗口**不产出**，继续下一窗口。
  4. 若全部窗口均不满足 ⇒ PROVENANCE_MISSING → FAIL-CLOSED → NON-SCORING（§5.2）。
  5. ⛔ 不得倒填（NO RETROACTIVE RECONSTRUCTION）：W1 未产出时，⛔ 不得事后用 W2 之结果回填到 W1 的时点。
```

**★ 与 §3.4A 的关系（⛔ 二重论证，必须同读）**：
同一 `decision_date` D 若在 W1 与 W2 **各**出现一个 promoted run（不同 `run_id`）：
① §5.5 ③ ⇒ W2 的 run 为 `NON_SCORING`（同一 `decision_date` 的第二个 bundle）；
② §3.4A I3 ⇒ 亦判 `NOT_INDEPENDENT`（`SAME_DECISION_DATE_BUNDLE_KEY_COLLISION`）。
⇒ **两条论证互证**：⛔ **窗口不同 / trigger 不同 / run_id 不同** 均**不**产生第二个独立 Evidence 事件。

**★ 两个 pipeline 在修订契约中的角色（★ owner 点名要求；⛔ 两种误读均被明确否定）**：

| | **W1 = 22:00 链**（`dailyFetch-2200`） | **W2 = 08:00 链**（`dailyPipeline-0800`） |
|---|---|---|
| 是否 PROMOTION-CAPABLE | **是**（实测：2026-09-30 run 已 `promoted=true`） | **是**（结构上恒真；`CD-04` 修复后由「结构」转为「实际」） |
| 是否产 Evidence candidate | **是** | **是** |
| 在修订契约中的角色 | **捕获窗口 W1 的首选链** | **捕获窗口 W2 的兜底链**（当 W1 未产出该 `decision_date` 的 promoted run 时） |
| 其 run 是否自动成为独立事件 | ⛔ **否** | ⛔ **否** |
| 独立性由何裁决 | **§3.4A 判据** | **§3.4A 判据** |

⇒ 明确否定两种误读：
- ⛔ 不因「历史上主要依赖 22:00」而继续假设「08:00 不产生有效 Evidence」；
- ⛔ 不因「V3.6.6 让 08:00 可以 promotion」而直接规定「08:00 = independent event」。

**定值依据（2026-10-02 云端只读实测）**：

| 事实 | 实读 |
|---|---|
| PROMOTION-CAPABLE 链 | **两条** —— W1-2200（`fetchDailyData`，cron `0 0 22 * * 1-5 *`）与 W2-0800（`materializeIndicators`，cron `0 0 8 * * 1-5 *`） |
| 08:00 链是否可用 | **可用** —— `CD-04` 已由 V3.6.6 `0342abd` 修复 ⇒ 08:00 链亦可产出 promoted run |
| 22:00 链观测完成时刻 | `2026-09-30 22:01:11`（`run_history.promoted_at` = `2026-09-30T14:01:11.865Z`） |
| 组 B 右端（`ml_shadow_signal`）写入时刻 | `runGen1ShadowEod` 22:20 ⇒ **W1 起点必须晚于 22:20** |

**静默性质（穷举，⛔ 不再使用断言式举证；修 v5.0 的举证方式缺陷）**：

`S6 CHECKPOINT_SILENCE`（含 cron 真值匹配）穷举**全部 9 个真实 trigger**（§5.6.3）：

| 窗口 | 窗口内**全部**触发者（实算时刻） | 写八源者 |
|---|---|---|
| **W1** `[22:30, 23:30)` | `gen2-eod-weekdays-2230@22:30`、`intelFetch-30min@22:30`、`intelExtract-30min@22:35` | **无** |
| **W2** `[08:30, 09:30)` | `intelFetch-30min@08:30/09:00`、`intelExtract-30min@08:35/09:05`、`realtime-5min@09:00/09:05/09:10/09:15/09:20/09:25` | **无** |

⇒ 两窗口均满足「无八源写入者」；举证方式 = **穷举 Registry + 逐条排除理由 + cron 真值匹配**。
⚠️ W2 内含 `realtime-5min` 对 `etf_daily` 的 `source='realtime'` 行写入 —— 该集合**不属于**八源，
且 §9.1 已规定 forward 收益只用 `source != 'realtime'` 且 `volume > 0` 的行 ⇒ **不构成污染**（此处显式登记，便于复核）。

**可执行校验（与契约**同批次冻结**）**：

| 构件 | 路径 | 角色 |
|---|---|---|
| 窗口 / 用例夹具 | `scripts/gen1/evidence-capture/fixtures/checkpoint_windows_cases.json` | 本节 `W1` / `W2` / `first-window-wins` 的**机器可读**形态（12 `CK-*` 捕获用例 + 3 `FWW-*` 会话序用例 + 3 交叉用例） |
| 判别器（JS） | `scripts/gen1/evidence-capture/checkpoint_discriminator.js` | `decideCapture()` / `firstWindowWins()` / `eventsDelta()` + 打红自证（`--selftest` / `--first-window-wins` / `--cross` / `--red-proof`） |
| 奇偶校验（Python ↔ JS） | `scripts/gen1/evidence-capture/checkpoint_python_js_parity.py` | 「`c1_capture.py` 迁移后（§11 规则 5，⛔ 未施加）的 Python 侧裁决」== 「JS 侧判别器裁决」 |

⛔ **`CK-*` / `FWW-*` 用例属预登记判据**：冻结后 ⛔ **不得**通过放宽窗口边界或增删用例来「让判别器变绿」；
若发现判据本身有误，须按 §11 ② 升版并**显式作废**既有样本。
⛔ 窗口边界**只认夹具中的 `start` / `end`**（半开区间 `[start, end)`）；⛔ 不得由任何 `trigger` 时刻**反推**边界。
⛔ 判别器**只判**「单次会话落在哪个窗口 / 是否落在窗口内」与「会话序下首个胜出者」；
「两 run 是否构成两个独立事件」**一律**由 §3.4A 裁决（见上「与 §3.4A 的关系」）。

**重锚理由（3 条，全部为可复现事实）**：

1. v5.0 定值前提「只有 22:00 管线能提升」已随 `CD-04` 修复失效（见 §1.5）。
2. 只要 22:00 链**未**产出 promoted run，v5.0 的单窗口会在该窗口内一无所获 ⇒ 依 §5.2 禁止倒填
   ⇒ 该 `decision_date` **结构性丢失**；而「丢失」与「22:00 链失败」**相关** ⇒ 潜在**样本偏倚**。
3. W2 窗口的存在使 §5.6.2(a)「两条链同等有效」在**捕获层**亦成立。

**⛔ 明确不采用的替代（防止事后择优）**：

- ⛔「保持 22:30 单窗口」：结构性丢失仅由 08:00 链成功的那类交易日，且丢失与失败相关 ⇒ 不采用。
- ⛔「按 promoted run 完成时刻 + 固定滞后（事件驱动）」：不可预登记为**固定**边界，且会把
  「事后才知道的完成时刻」引入窗口定义 ⇒ 违反 pre-registration ⇒ 不采用。
- ⛔「把 selector 从 S-PROMOTED 改为『`decision_date == D` 的首个 promoted run』」：`selector` ∈ §11 ① 保护对象；
  且会引入「按 data 轴取首个」的第二选择器，与 §3.0.2 冲突 ⇒ 不采用。

- ⛔ 窗口序列**一经冻结即成为永久统计口径**，⛔ 不得事后放宽（**预登记**的窗口边界不是「事后放宽」）。
- ⚠️ 与 `CD-04` 的关系已**闭合**：其修复已由本版吸收（§1.5），v5.0 §5.8 的「重评触发条件」**已执行完毕**
  ⇒ ⛔ 不得再把「等 `CD-04` 修复后再重评」当作未决项。

### 5.9 ★ 硬规则七：`EVIDENCE OBJECT BOUNDARY`（v5.0 新增）

```text
EVIDENCE OBJECT := 生产**已采纳**的 authoritative decision
                 = the promotion-accepted run 的 run-axis dataset
                 （active_run_pointer[production] 所指向的 run）

⛔ EVIDENCE 不主张：
   · 前台现行读链已迁移到 run 轴
   · 用户界面 / apiGateway / adminGateway 已经消费该 run
   · 候选集合的存在 == 生产已消费
```

**边界字段组（必须同列陈述，⛔ 不得合并成一句）**：

| 字段 | 语义 | 实读（as-of 2026-10-02 11:51 +08） |
|---|---|---|
| `authoritative_run_promoted` | 权威 run 是否已被 promotion 采纳 | ✅ `true`（`run_history.promoted`，09-30 run） |
| `authoritative_read_path_migrated` | **前台**读链是否已迁移到 run 轴 | ⛔ **false** —— `apiGateway` / `adminGateway` 仍 `orderBy(decision_date\|snapshot_date desc).limit(1)` |
| `reader_migration_status` | reader migration 工程状态 | `PENDING`（`RUN_HISTORY_INDEX = PENDING` / `V365_ENFORCE_SWITCH_DATE = null`） |
| `legacy_engine_write_stopped` | 引擎是否已停写 legacy 集合 | ✅ `true`（ENFORCE 起） |

> ⛔ **反例必须写明**：`authoritative_run_promoted = true` **时**，`authoritative_read_path_migrated` **仍可为 false**
> —— 今天就正是这一组合。⛔ 不得据前者推断后者。

**为什么必须显式化**：承重墙 **R7** 要求「生产 authoritative read path 与 candidate/promotion path 必须明确区分」。
Evidence 观察的是 promotion 结果（= 迁移**目标**语义），而前台**当前**仍读 legacy ——
若不显式声明，读者会把「Evidence 有了样本」误读为「生产前端已在消费 Gen-1 决策」。

---

## 6. 判定问题（Q1 / Q2 / Q3，沿用 v1.0，冻结）

| 编号 | 问题 | 判定指标 | 冻结阈值 |
|---|---|---|---|
| **Q1** | Gen-1 建议是否**方向正确**？ | `hit_rate = 方向正确样本数 / (delta ≠ 0 的样本数)` | ≥ **55%** 且二项检验 p < 0.10 |
| **Q2** | 是否**提升风险调整收益**？ | 按 delta 方向构造组合，其 T+5/T+10/T+20 平均收益 vs baseline 的**增量** | 至少 T+10 或 T+20 显著 > 0 |
| **Q3** | 是否**引入更多假信号**？ | `false_fast_path` 比例：Gen-1 侧 vs baseline 侧 | Gen-1 侧不得显著高于 baseline 侧 |

---

## 7. 统计口径（冻结）

### 7.1 样本独立性与最小样本量

- Q1 的 p 值用 **独立事件**计数（`independent_event = true`），⛔ 不用原始行数。（规则见 **§3.4**。）
- 在 `independent_event = true` 的行数达到 **≥ 30** 之前，**不下任何结论**。
- 分域报告：`domain_status` 分层（`IN_DOMAIN` / `PARTIAL_COVERAGE` / `OUT_OF_DOMAIN`）**不得混算**。

### 7.2 ★ 三层分母（⛔ 不混线）

| 层级 | 说明 |
|---|---|
| 原始 observation 行 | 每个合格交易日 × 5 |
| `independent_event = true` 行 | 须经 `event_cluster_id` 去相关；**必然 ≤ 原始行数** |
| **Q1 有信息量的样本** | `delta_position != 0` 的样本 |

### 7.3 ★ 防误读条款

```text
≥30 independent events
= Evidence Gate 的必要成熟条件
≠ Q1 自动可判定

Q1 denominator
= independent_event = true AND delta_position != 0
```

---

## 8. 三种终局（沿用 v1.0，冻结）

| 终局 | 条件 | 动作 |
|---|---|---|
| **EVIDENCE_POSITIVE** | Q1 ∧ Q2 成立，Q3 不成立 | 可提案进入下一权限档评估（**仍需独立工作包**，本契约不授权直接上生产） |
| **EVIDENCE_NEGATIVE** | Q2 在 ≥ 30 独立事件后仍不成立 | Gen-1 归因为「无经济价值」，Canary 保持观察或回退 ADVISORY |
| **EVIDENCE_INCONCLUSIVE** | 样本不足 / 分域冲突 / 测量噪声过大 | 延长观察，⛔ **不得**以「还不够差」为由推进 |

> ★ **特别声明**：`EVIDENCE_POSITIVE` **不等于**可以直接上 `PRODUCTION`。
> 上生产需**另一份独立契约** + owner 授权，且受 `gen1-authority.js` 的 `PRODUCTION_LOCKED` 硬边界约束。

---

## 9. 数据来源与采集路径

### 9.1 来源表（v5.0 重绑）

| 数据 | 来源（v5.0） | 采集方式 |
|---|---|---|
| 建议仓 / stage / 反事实建议仓 | **`run_candidate_decision`（按 `run_id == R` 过滤）** | 每日 checkpoint 后读取 |
| `regime` | **`run_candidate_portfolio.decision_market_regime`（`run_id == R`）** | 同上 |
| run identity / validation | **`run_manifest`** | 同上 |
| selector / pointer revision | **`active_run_pointer`** | 同上 |
| promotion proof | **`run_history`** | 同上 |
| domain / probability | `ml_shadow_signal` | 同上 |
| Canary 健康态 / eligibility | `runtime_status`（**当日**快照，见 §5） | 同上 |
| 调用来源 | `tcb logs search`（调用日志）+ `tcb fn detail` | 同上 |
| forward 收益 | `etf_daily`（official bars，`source != 'realtime'` 且 `volume > 0`） | 样本成熟后回填 |

### 9.2 回填原则

`forward_5d/10d/20d/MFE/MAE` 在样本**成熟后**才回填；未成熟行保持 `null`，
⛔ **不得**用实时价或估算值填充。

### 9.3 ⛔ 禁止用作生产资格证据的字段

```text
ml_shadow_signal.gen1_authority      ⛔ 不得用于证明生产资格
ml_shadow_signal.canary_allowed      ⛔ 不得用于证明生产资格
```

**定性（已代码核实）**：`ml_shadow_signal.gen1_authority = ADVISORY` 而生产链 = `CANARY`，
原因是 shadow lane 调用 `resolveAuthority({ml_shadow_observe, ml_advisory_enabled, ml_fast_path_enabled})`
**不传** `gen1_authority`（`runGen1ShadowEod/index.js:166`），源码默认值即 `ADVISORY`
（`gen1-authority.js:69` / `:110`；`tests/gen1-authority.test.js:19-20` 断言默认必须为 `ADVISORY`）；
生产链则 `resolveAuthority(merged)`（`runDecisionEngine/index.js:560`）⇒ `CANARY`。

```text
CLASSIFICATION: LANE-LOCAL DEFAULT METADATA / BY CURRENT DESIGN
                NOT PRODUCTION AUTHORITY / NOT PRODUCTION DRIFT
STATUS:         PRE-EXISTING SEMANTIC DEBT
                NON-BLOCKING IF EXCLUDED FROM ELIGIBILITY
```


### 9.4 ★ 源锚点 ref 绑定（v5.0 新增；G-1 载体轮）

⛔ **本契约引用代码锚点时必须与 ref 同时引用**；⛔ 不得只写「模块名 + 行号」。

**原因**：V3.6.5 的 run / decision 完整性模块 **不在 `origin/master` 上** ——
本载体分支（自 `origin/master` 开出）**不含**这些文件。缺 ref 会形成
「引用了一个在本分支不存在的文件」的**不可审计状态**。

| 锚点 | 权威 ref | 行 |
|---|---|---|
| `src/common/utils/v361-run-context.js` → `CASE_A_ALL_EXPECTED` / `CASE_B_PARTIAL_STALE` | `feat/v365-production-integrity-impl` @ `d6692983a27a283c61774d6a3bd14fba4ef47e49` | `:108` / `:162` / `:447` |
| `src/common/utils/v365-run-integrity.js` → `expected_trade_date`（日历权威源；⛔ 不得用 `max(calc_date)` 代替） | 同上 | `:48-49` / `:337` |
| `src/common/utils/v365-atomic-publish.js` → `validateCandidateSet` | 同上 | `:120`（`mixed_date_detected` @ `:145`） |
| `src/common/utils/v365-publish-store.js` → `classifyPointerPromotion` | 同上 | `:89`（注释块 `:75-88`） |
| `cloudfunctions/fetchDailyData/index.js` → 链式 `materializeIndicators` | `origin/master` | `:424` |
| `cloudfunctions/materializeIndicators/index.js` → 链式 `runDecisionEngine` | `origin/master` | `:127` |
| `cloudfunctions/adminGateway/index.js` → 管理侧重入 `runDecisionEngine` | `origin/master` | `:547` / `:578` / `:661` |
| `cloudfunctions/adminGateway/index.js` → `PORTFOLIO_SNAPSHOT` upsert（仅资产轴） | `origin/master` | `:829` / `:1027` |

**发现标签对照（保留上游 F 编号，⛔ 不因本契约改名而丢失）**：

```text
F-30  ↔  CD-05   dailyFetch-2200 管线此前完全未被登记（触发器清单漏列 22:00 管线）
F-31  ↔  CD-04   08:00 管线在 validateCandidateSet 上结构性永不可通过（RUN DATE vs DATA DATE）
F-37            上游治理报告的门 1/2/3 锚点落笔时未标 ref —— 本表为其契约层修正
```

**关系**：`feat/v365-production-integrity-impl` 与 PR #60 分支**同基线** `e93f396`；
两者**均非** `origin/master` 的祖先（`origin/master` 已前进）。⛔ 本载体不基于它们。
⛔ 上游治理报告作为 as-of 历史记录**不被回改**（其指纹保持有效）。

---
> 同行的 `domain_status` / `calibrated_probability` / `ml_fast` / `stage` **仍可**作为**模型 signal 数据**使用。
> ⛔ 不要把「模型输入快照」与「生产 Authority 真相」混成一层。

---

### 9.5 `input_hash` —— 非规范性登记（v6.0 新增；`R3 = OBSERVATION`）

⛔ **本条为 non-normative 附注，⛔ 不构成任何判据、⛔ 不要求任何字段、⛔ 不升版 schema**。

**契约消费面测试（可复现）**：对 **v5.0 FROZEN 载体本体**逐 token 计数：

| token | 次数 | 结论 |
|---|---|---|
| `input_hash` | **0** | ⛔ 契约**不要求、不消费** |
| `candidate_content_sha` | **0** | 同上（属部署候选清单 / CI 门构件，非生产字段） |
| `gen1_candidate_hash` | **0** | 契约未提；但其为**真实生产字段**（`run_candidate_decision`），本版仅在 §3.4A I7 引用 |
| `gen1_run_id` | **0** | 契约未提 |

**生产真实状态（三处同名不同义）**：

| # | 落点 | 值（实读） | 性质 |
|---|---|---|---|
| 1 | `run_manifest.input_hash` | `engine:engine:2026-09-30:b1790776862980` | **字符串拼接**（`'engine:' + v365EngineRunIdBase`，后者已含 `engine:` ⇒ **双前缀**） |
| 2 | `run_history.input_hash` | 同上 | 从 manifest 复制 |
| 3 | `runtime_status.v365_run_integrity.input_hash` | `a1e067cb9f9f4d2e6b04cf58c96393c5e2e56e3763cc1e7d48647e47dcfae8e5` | **真 sha256** |

**正式裁定**：

> **`R3 = OBSERVATION`**（⛔ **非** `CONTRACT GAP`）。
> 理由：① 契约不要求也不消费；② 语义已由其他字段完整承担（run identity ⇒ `run_id` / `revision` / `pointer_revision`；
> input provenance ⇒ `runtime_status.v365_run_integrity.input_hash`（真 digest）+ §5.3 八源 raw SHA256
> + `expected_codes` / `expected_trade_date`；candidate identity ⇒ `gen1_candidate_hash`）；③ 无任何契约判据依赖它。

**两条非阻塞观察项（⛔ 不阻断 Freeze）**：

- (a) `run_manifest` / `run_history.input_hash` 为**双前缀字符串**，与 `runtime_status` 的同名 digest **语义冲突**，
  且下游 `v365-active-read.js:588` 会读到它 ⇒ 建议**未来版本**改名澄清（如 `run_identity_key`）；
- (b) ⛔ **禁止**为满足 schema 制造虚假 hash；⛔ 不得因本字段缺失 / 歧义而阻断 Freeze。

---

## 10. 生效日与 **V6.0 新 Evidence 起始边界**

```text
v6.0 FREEZE（⛔ 尚未发生 —— 需 owner 单独授权）
    ↓
冻结后**首个被 PROMOTION_PROOF 采纳的自然 run**
    ↓
正式 scoring sample 起算（= V6.0 新 Evidence 的**起始边界**）
```

**V5.0 样本作废声明（owner B1 正式裁定）**：

```text
V5.0 CONTRACT            = SUPERSEDED / INVALID FOR NEW EVIDENCE
V5.0 SAMPLE INVALIDATION = EXPLICIT（v1.0 / v2.0 / v3.0 / v4.0 / v5.0 既有样本**全部作废**）
V5.0 SAMPLE COUNT        = 0 行 ⇒ 无需迁移历史 Evidence sample
```

`2026-09-10 … 2026-10-02` 的全部既有行（含 v1–v5 时代的 0 行）只能标记为：

```text
PRE-V6 DIAGNOSTIC / NON-SCORING / NON-GATE
```

⛔ 不得进入 Q1/Q2/Q3；⛔ 不得贡献 ≥30；⛔ **HISTORICAL BACKFILL = PROHIBITED**。

**理由**：截至 2026-10-02，部分历史 forward outcome **已开始可见**；在看到结果后重定义数据源再回填历史，
**会破坏「冻结在先、采样在后」的 pre-registration 原则**。
⚠️ **两版样本不可混用**：v6.0 的捕获口径（§5.8 `W1 ∪ W2`）与 v5.0（单窗口 22:30）**不同**
⇒ 这正是必须升版并**显式作废**的原因（§11 ②）。

---

## 11. 契约不可变性（元规则）

1. 本文件**冻结后**，字段名、字段定义、纳入/排除规则、判定阈值、selector、checkpoint**不得修改**。
2. 发现错误 → 发布 **v7.0**，并**显式作废 v6.0 全部样本**，从新版本生效日起重新累计。
   （★ 本条已按 v6.0 版本位更新：**v6.0 本身就是 §11 ② 的一次执行** —— 见变更日志。）
3. 每次修改必须在变更日志留痕，写明**修改动机**与**是否作废既有样本**。
4. 采样进程与契约修改**不得由同一次决策同时触发**。
5. ⛔ **工具（`c1_capture.py`）的语义迁移与契约冻结同批次**：
   在 **v6.0 冻结之前**，⛔ **不得**把工具改绑到 v6.0 语义（保持 v5.0 语义运行）
   —— 否则会出现「工具已按未冻结契约采样」的**预登记违规**。
   ✅ **本批次状态：`B3 = MIGRATED`** —— `c1_capture.py` 与 `c1_gate_redproof.py` 已**与本冻结同批次**
   迁至 v6.0 语义（`W1 ∪ W2` + first-window-wins + 双链 CHAIN PROOF 窗口 + bundle `checkpoint_window_id`），
   并由 `v6_contract_tool_alignment.py` 证明**四层语义一致**（见 §12 第 12 项 / §13.2）。

### 变更日志

| 版本 | 日期 | 修改内容 | 是否作废既有样本 |
|---|---|---|---|
| v1.0 | 2026-09-10 | 首次冻结（WP-G1-EVIDENCE 启动） | — |
| **v2.0** | 2026-09-21 | ① 主列改绑 `gen1_counterfactual_suggested_position`（修 `CD-01`）；② 引入 E1 daily full-sample；③ 引入 C-1 provenance + 五源 bundle + coherence gate；④ `regime` 精确绑定 + 双日期双组；⑤ 引入 `NATURAL_RUN_PROVENANCE`（CHAIN PROOF）；⑥ 新增 `≥30 ≠ Q1 可判定` 防误读条款 | **是** —— 作废 v1.0 全部样本（实测 = **0 行**） |
| v2.0-draft rev.1 | 2026-09-21 | 闭合冻结前置：① `CANONICAL_CAPTURE_CHECKPOINT` 定为 09:00；② C-1 归档落点/命名与 append-only 规则定稿；③ 多 capture 冲突定为「先到先得 + 后到 NON-SCORING」；④ 补记 coherence gate 只读 dry-run 验证 | **否**（草案修订） |
| **v2.0 FROZEN** | 2026-09-21 | 冻结（**仅**状态头 / §12 / 变更日志） | **否** |
| **v3.0** | 2026-09-21 | 补 §3.4：钉死 `event_cluster_id` / `independent_event` 计算规则（C-B） | **是** —— 作废 v2.0 全部样本（实测 = **0 行**） |
| v4.0（DRAFT，**从未冻结**） | 2026-09-23 | ① `regime` 改绑 `decision_market_regime`（修 `CD-02`）；② 定来源层级；③ 明确不要求 `effective` == 主来源；④ 新增 §3.5 宿主内部量排除声明 | **否**（从未冻结、从未采样） |
| v5.0-draft rev.1 | 2026-10-02 | **闭合冻结前置**（与 G-2 同批次）：修正 §3.0.3 标题的键数标注「四键」→「五条」，使其与 §5.4 规则 3「`PROMOTION_PROOF(R)` 五条 AND 全真」及该节实际列出的五条件（`active_run_pointer.run_id == R` / `run_history.promoted` / `run_history.read_after_write_consistent` / `run_manifest.validation_passed` / `run_manifest.revision == active_run_pointer.revision`）一致；⛔ 不改变任何规则语义，⛔ 不改变字段名 / 字段定义 / 纳入排除规则 / 判定阈值 / selector / checkpoint | **否**（草案修订） |
| **v5.0**（生成轮） | 2026-10-02 | ① **读源整体改绑 run 轴**（`decision_result`→`run_candidate_decision`；`portfolio_snapshot`→`run_candidate_portfolio`）；② **新增 `run_manifest` / `active_run_pointer` / `run_history` 三源**（§5.3 五源 → **八源**）；③ **新增 §3.0 `SAMPLE IDENTITY` 与 `SELECTOR = S-PROMOTED`**；④ 行键由 `(date, code)` 改为 **`(run_id, code)`**（修 `CD-02` 落点 + 键碰撞）；⑤ **§3.1 双组重定义**：组 A 改 run 内自洽、组 B 左端改 candidate，新增 B3/B4；⑥ **§3.5 重写**（拆同名两义，修 `CD-03`）；⑦ **§5.4 gate 重写**（规则 1/2 改按 pointer revision）；⑧ **§5.5 加单调采纳**；⑨ **§5.6 CHAIN PROOF 重锚到 22:00 入口管线**（修 `CD-05` 与 100% 误杀）；⑩ **§5.8 checkpoint 由 09:00 改为 22:30 窗口**；⑪ **新增 §5.9 `EVIDENCE OBJECT BOUNDARY`**；⑫ 新增 §3.6 `portfolio_snapshot` 分界（E-2/UNV-23 闭合）；⑬ 登记 `CD-03` / `CD-04` / `CD-05` | **是** —— 作废 v1–v4 全部样本（实测 = **0 行**） |
| **v5.0 FROZEN** | 2026-10-02 | 冻结（**仅**状态头 / §1.1 / §12 第 1·9·12 项 / §13 / 变更日志）；同批次迁移 `c1_capture.py` 至 v5.0 语义（§11 规则 5） | **是** —— 作废 v1–v4 全部样本（实测 = **0 行**） |
| v6.0-draft rev.1 | 2026-10-02 | **Contract Revision Gate 提案**（⛔ 未冻结）：R1 `§3.4A` / R2 §5.6 补全 + §5.8 重评 / R3 `input_hash` 裁定 —— 见 `GEN1_EVIDENCE_CONTRACT_REVISION_PROPOSAL_20261002.md` | **否**（提案；未生效） |
| **v6.0**（生成轮） | 2026-10-02 | ① 新增 **§3.4A `INDEPENDENCE REQUIREMENTS`**（I1–I7 + 排除项 + 判据顺序 + fail-closed + 计数规则）；② **§5.6 补全为完整 Trigger Registry**（9 trigger + 3 无调度留册 + 2 云端不存在声明；修 `CD-06`）；③ **§5.8 重锚为 `W1 ∪ W2` + first-window-wins**（修 `CD-07`）；④ 新增 §5.3 `trigger provenance` 口径 + bundle `checkpoint_window_id`；⑤ 新增 §9.5 `input_hash` 非规范性登记（`R3 = OBSERVATION`）；⑥ §10 生效日改锚 v6.0 + **V5.0 样本显式作废声明**；⑦ 登记 `CD-06` / `CD-07`；⑧ §1.3 / §1.4 / §1.5 的 `CD-02` / `CD-03` / `CD-04` 状态翻为 **CLOSED**；⑨ §11 规则 2/5 版本位更新；⑩ §12 / §13 / 页脚更新；⑪ **§5.8 新增「可执行校验」绑定**（判别器 + 用例夹具 + Python ↔ JS 奇偶校验） | **是** —— **显式作废 v1–v5 全部样本**（实测 = **0 行** ⇒ 无需迁移历史 Evidence sample） |
| **v6.0 FROZEN** | 2026-10-02 | 冻结（**仅**状态头 / §1.1 末行 / §11 规则 5 状态行 / §11 变更日志 / §12 第 1·2·8·9·12 项 / §13 / §13.2 / 页脚）；同批次迁移 `c1_capture.py` + `c1_gate_redproof.py` 至 v6.0 语义并证明 Tool Alignment（§11 规则 5）；新立**独立**治理对象 `V6.0 Evidence Freeze Seal`（⛔ 不改 Key 2） | **是** —— 显式作废 v1–v5 全部样本（实测 = **0 行**） |

**v6.0 修改动机（合并陈述）**：
① `CD-04` 已由 V3.6.6 `0342abd` 修复 ⇒ v5.0 §5.8 明文预留的「重评条件」成立 ⇒ `checkpoint`（§11 ① 保护对象）必须重评；
② v5.0 §5.6 的 trigger 清单经词频与云实测证明**不完整**（漏 4 项 trigger 族）⇒ 属**文档缺陷**（§11 ② 的「发现错误」要件成立）；
③ v5.0 §3.4 缺少「两 run 是否独立」的显式判据 ⇒ 存在「`run_id` 不同即独立」的误读空间（已由反向证明当场证伪）；
④ 捕获口径变更 ⇒ 新旧样本不可混用 ⇒ 必须显式作废（v5.0 = 0 行，成本为零）。
`CD-02` 的 remedy 落点在 ENFORCE 下**已失效**（引擎不再写 `portfolio_snapshot`）；
promotion 链（`run_candidate_*` / `run_manifest` / `active_run_pointer` / `run_history`）**已在写但无消费者**；
且实测证明 v4.0 的组 A / gate 规则 1·2 / CHAIN PROOF / checkpoint **四者均与生产事实冲突**。

---

## 12. 未决项（★ 冻结前必须闭合）

| # | 事项 | 状态 |
|---|---|---|
| 1 | **本文件（v6.0）冻结授权** | ✅ **已执行 = 🔒 FROZEN（2026-10-02）** —— owner **单独授权**（V6.0 FREEZE + B3 同批次工具迁移，原子批次；含 `O-1 = APPROVED`） |
| 2 | **v6.0 冻结载体路径的仓库写入授权** | ✅ **已执行** —— 冻结载体 = `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md`（= 候选基线 `e93420a3…bef4b1` + **status-head-only** 冻结更新；候选件本体**保留**为生成轮证据） |
| 3 | `CANONICAL_CAPTURE_CHECKPOINT` 具体时点 | ✅ **已裁定 = 工作日 `W1 [22:30, 23:30) ∪ W2 次日工作日 [08:30, 09:30)`，first-window-wins**（owner 2026-10-02 裁定 **B2 APPROVED**）—— 依据见 §5.8 |
| 4 | C-1 归档的**具体落点与命名** | ✅ **沿用 v5.0 裁定**：仓库外 `_evidence-capture-YYYYMMDD/`；`<decision_date>__bundle.json` + `<decision_date>__bundle.sha256`；同名已存在 ⇒ **拒绝写入**（append-only）。⚠️ bundle 须含 `run_id` / `pointer_revision` / **`checkpoint_window_id`**（v6.0 新增） |
| 5 | C-1 自动化 | ⛔ **当前不授权创建任务**；顺序 = 先手工 / 半自动跑通 **≥3 个交易日** ⇒ 验证 gate 不误杀 ⇒ 再议 automation |
| 6 | `CD-01` 关闭条件 | ✅ **已 CLOSED**（条件「v2.0 真正冻结」已于 2026-09-21 满足） |
| 7 | 同一 `decision_date` 出现多个 capture 的冲突处置 | ✅ **已裁定**：**first-window-wins**（§5.8）+ **先到先得 + 单调**（§5.5 ③④） |
| 8 | 冻结是否伴随 git commit | ✅ **已裁定：是** —— 冻结提交落于载体分支 `docs/gen1-evidence-contract-v5-20261002`（自 `origin/master` 开出）；⛔ **不建 tag、不 push、不 merge master** |
| 9 | 本文件 activation-ready 状态 | 🔒 **CONTRACT READY（FROZEN，2026-10-02）**；⚠️ **EVIDENCE EXECUTION 仍为 NOT AUTHORIZED**（§12 第 5 项） |
| 10 | `CD-04`（生产 `validateCandidateSet` 字段误用）修复归属 | ✅ **已 CLOSED** —— 由 **V3.6.6 / `0342abd`** 修复（前序 **G-4** 批次）；⛔ 本契约不修生产代码 |
| 11 | `gen1_counterfactual_canary_active = false` / `gen1_health_status = DEGRADED` | ⛔ **PHASE 2 健康语义**（闸门 **G-5**）；⛔ 与读源正交 |
| 12 | `c1_capture.py` / `c1_gate_redproof.py` 语义迁移（v5.0 → v6.0） | ✅ **已执行（与 v6.0 冻结同批次，§11 规则 5）** —— `c1_capture.py` 迁至 v6.0（`W1 ∪ W2` + first-window-wins + 双链 CHAIN PROOF + `checkpoint_window_id`）；`c1_gate_redproof.py` §[6] 同步迁移，并新增「**故意恢复旧 09:00 单窗口规则 ⇒ red-proof 必 FAIL**」反向证明 |
| 13 | 版本标签与样本作废声明 | ✅ **已裁定 = `v6.0`**（owner 2026-10-02 裁定 **B1 APPROVED**）+ 「显式作废 v5.0 全部样本（= 0 行）」 |
| 14 | `R3`（`input_hash`）裁定 | ✅ **已裁定 = `OBSERVATION`**（⛔ 非 `CONTRACT GAP`）；非规范性登记见 §9.5 |
| 15 | `CD-06` / `CD-07` 关闭条件 | ✅ **条件 = v6.0 冻结**（remedy 已在本版写出） |

---

## 13. 边界声明与不授权声明

**v6.0 生成轮（2026-10-02，V6.0 FREEZE PREPARATION / 自主）仅做**：
① 以 **v5.0 FROZEN 载体**为基座派生本候选版全文；② 新增 §3.4A `INDEPENDENCE REQUIREMENTS`（R1）；
③ §5.6 补全为完整 Trigger Registry（R2/`CD-06`）；④ §5.8 重锚为 `W1 ∪ W2` + first-window-wins（R2/B2/`CD-07`）；
⑤ 新增 §5.3 `trigger provenance` 与 §9.5 `input_hash` 登记（R3）；⑥ §10 生效日与 V5.0 样本作废声明（B1）；
⑦ §1.3–§1.5 的 `CD-02`/`CD-03`/`CD-04` 状态翻为 **CLOSED**；⑧ 登记 `CD-06`/`CD-07`；⑨ §11/§12/§13/变更日志更新。

⛔ **未改**：17 列字段定义 / 八源清单 / selector / 判定阈值（Q1/Q2/Q3）/ 纳入与排除规则 / `CLUSTER_GAP_DAYS`。
⛔ **未启动**样本累计；⛔ **未**冻结（`V6.0 FREEZE = NOT AUTHORIZED`）；⛔ **未**建 git tag；⛔ **未** commit / push；
⛔ **未**合并 master；⛔ **未**实施 `c1_capture.py` 迁移（`B3 = NOT YET AUTHORIZED`）；
⛔ **未**部署 / rollback；⛔ **未**写生产 DB；⛔ **未**改 Authority / 生产 Seal / `FROZEN_PARAM_KEYS` / lock / `immutable_set` / 生产读链；
⛔ **未**进入 GE-04；⛔ **未**执行 Evidence Seal。

**⛔ 冻结对象（v5.0 载体）本批次零改动**：
`docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md` @ `05da0ef` / blob `7f86d12a…` / sha256 `4fb9463f…f55b`（64580 B / 1072 行）。
**⛔ V5.0 载体 immutable 声明（owner B1）**：⛔ 不覆盖、不改写、不重写其任何字节。

**v6.0 冻结轮（2026-10-02，owner 单独授权：V6.0 FREEZE + B3 同批次工具迁移 / `O-1 = APPROVED`）仅做**：
① 以 **V6.0 FREEZE CANDIDATE**（`e93420a3…bef4b1`）为**唯一来源**派生本冻结载体（**status-head-only**）；
② 状态头 / §1.1 末行 / §11 规则 5 状态行 / §11 变更日志 / §12 第 1·2·8·9·12 项 / §13 / §13.2 / 页脚 更新；
③ 同批次迁移 `c1_capture.py` 与 `c1_gate_redproof.py` 至 v6.0 语义（§11 规则 5），并证明 **Tool Alignment**；
④ 新立**独立**治理对象 **`V6.0 Evidence Freeze Seal`**（⛔ **不改 Key 2** / ⛔ 不动生产 Seal 制品）。

⛔ **冻结轮未改**：字段名 / 字段定义（17 列）/ 纳入与排除规则 / 判定阈值（Q1/Q2/Q3）/ selector /
checkpoint **语义** / 八源清单 / `CLUSTER_GAP_DAYS`。⛔ **§0–§11 规范性正文逐字节未变**
（由 `v6_frozen_carrier_assertions.py` 独立证明 —— 冻结轮改动行**全部落在**声明的非规范性区段内）。
⛔ **冻结轮未**：合并 master / 建 tag / push / 部署 / rollback / 写生产 DB / 改 Authority / 改生产 Seal /
改 `FROZEN_PARAM_KEYS` / lock / `immutable_set` / 生产读链；
⛔ **未**执行 Evidence Seal（Key 3）；⛔ **未** V3.6.6 Freeze；⛔ **未** Production Attestation；⛔ **未**进入 GE-04；
⛔ **未**开启 auto_execution。

### 13.1 随行治理证据（同批入库）

| 文档 | 路径 | 角色 |
|---|---|---|
| E-1 读源正解前置分析 | `docs/gen1/GEN1_STEP11_E1_READ_SOURCE_RULING_PREREQ_20261002.md` | 定义 ①a / ①b / ①c |
| E-1b 样本身份前置设计 | `docs/gen1/GEN1_STEP11_E1B_SAMPLE_IDENTITY_DESIGN_20261002.md` | 定义 A / B / C / D 备选 |
| E-1b-AB 治理裁定分析 | `docs/gen1/GEN1_STEP11_E1B_AB_GOVERNANCE_RULING_ANALYSIS_20261002.md` | 三层门 / 四日期 / H-1 |
| E-1b-AB 第 1 层裁定 | `docs/gen1/GEN1_STEP11_E1B_AB_LAYER1_GOVERNANCE_ANALYSIS_20261002.md` | A-1 / B-3° / C-1° |
| ★ 自主治理裁定（本契约的裁定依据） | `docs/gen1/GEN1_STEP11_E1B_AB_AUTONOMOUS_GOVERNANCE_RULING_20261002.md` | 全部裁定 + F-30 / F-31 + CD-03 / 04 / 05 |

⛔ 以上均为 **as-of 历史记录**，⛔ 不得据其修改本契约本体。
⚠️ `GEN1_STEP11_EVIDENCE_CONTRACT_V4_FREEZE_READINESS_20261002.md`（E-2 ~ E-5 的**定义**来源）
**不在本批入库范围**（G-1 授权枚举未含）⇒ 需要时另批处理，⛔ 本契约不假定其在本仓可读。
**⛔ 本文件不授权任何生产变更**；`gen1_authority` 保持 `CANARY`。
**⛔ 本文件不解除** `Gen-1 → final_target` 的禁令。

### 13.2 v6.0 Freeze / Seal 批次的随行构件

| 构件 | 路径 | 角色 |
|---|---|---|
| 修订提案 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_REVISION_PROPOSAL_20261002.md` | R1 / R2 / R3 修订依据 |
| R1 判据（v2） | `scripts/gen1/evidence-capture/independence_discriminator_v2.js` | §3.4A 可执行判据 |
| R1 夹具（v2） | `scripts/gen1/evidence-capture/fixtures/r1_independence_cases_v2.json` | 10 cases |
| R2 校验器 | `scripts/gen1/evidence-capture/trigger_registry.js` | §5.6.4 S1–S6 |
| R2 登记表 / 云快照 | `scripts/gen1/evidence-capture/fixtures/trigger_registry{,_cloud_observed}.json` | §5.6.3 机器可读形态 |
| §5.8 判别器（v6.0 新增） | `scripts/gen1/evidence-capture/checkpoint_discriminator.js` | W1 / W2 + first-window-wins |
| 迁移方案（**已施加**） | `scripts/gen1/evidence-capture/c1_capture.py.v6.diff` | `B3` 迁移 diff（v5.0 → v6.0） |
| §5.8 奇偶校验（v6.0 新增） | `scripts/gen1/evidence-capture/checkpoint_python_js_parity.py` | Python 侧裁决 == JS 侧裁决 |
| 内容断言套件（v6.0 新增） | `scripts/gen1/evidence-capture/v6_content_assertions.py` | 本候选版的**可执行验收单** |
| 打红自证（候选件本体） | `scripts/gen1/evidence-capture/v6_redproof.py` | 变异 ⇒ 必 FAIL ⇒ 逐字节还原 |
| 契约兼容性校验（v6.0 新增） | `scripts/gen1/evidence-capture/v6_contract_compatibility.py` | A 内部一致 / B 生产兼容 / C 改动面收敛 / D 零漂移 |
| R3 消费面测试（v6.0 新增） | `scripts/gen1/evidence-capture/r3_contract_consumption_test.py` | `input_hash` token 计数 + 非规范性裁定 |
| 配套报告 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_{DIFF_MATRIX,CONTENT_ASSERTIONS,REDPROOF_REPORT,COMPATIBILITY_REPORT,FREEZE_READINESS_REPORT}_20261002.md` | 生成轮候选版的自证 |
| Seal binding schema 缺口报告 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SCHEMA_GAP_REPORT_20261002.md` | 触发 `O-1` 裁定的证据 |
| ★ `V6.0 Evidence Freeze Seal` 绑定裁定 | `docs/gen1/GEN1_EVIDENCE_V6_FREEZE_SEAL_BINDING_DECISION.md` | **独立**治理对象的 schema / lifecycle / namespace |
| ★ `V6.0 Evidence Freeze Seal` 制品 | `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json` | 机器可读 Seal（7 项绑定 + `reference_to_key2_seal`） |
| ★ 冻结与封存记录 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SEAL_RECORD_20261002.md` | 冻结行为留痕 |
| ★ 契约 ↔ 工具对齐报告 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_TOOL_ALIGNMENT_REPORT_20261002.md` | 四层语义一致 + 版本错配反向证明 |
| ★ 冻结证据包 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_EVIDENCE_BUNDLE_20261002.md` | 四级指纹链 |
| 契约↔工具对齐校验器（v6.0 新增） | `scripts/gen1/evidence-capture/v6_contract_tool_alignment.py` | 可执行对齐判据 |
| 冻结载体断言套件（v6.0 新增） | `scripts/gen1/evidence-capture/v6_frozen_carrier_assertions.py` | 冻结轮改动面 + 规范性不变性证明 |

---

*本契约由 `WP-G1-EVIDENCE` 工作包 v6.0 生成（V6.0 FREEZE PREPARATION — OWNER-AUTHORIZED AUTONOMOUS GOVERNANCE）。任何修改须遵循 §11 元规则。*
*落点：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md`（**🔒 FROZEN 2026-10-02 — ⛔ NOT AUTHORIZED FOR EXECUTION**）*
*冻结轮由 owner 2026-10-02 单独授权（V6.0 FREEZE + B3 同批次工具迁移 / `O-1 = APPROVED`）。*
*随行治理证据与自证构件：见 §13.1 / §13.2；冻结与封存留痕：见 `GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SEAL_RECORD_20261002.md`。*
