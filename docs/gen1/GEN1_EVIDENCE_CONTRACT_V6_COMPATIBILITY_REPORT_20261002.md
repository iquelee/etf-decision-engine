# V6.0 契约兼容性报告（COMPATIBILITY REPORT）

**文档编号**：`WP-G1-EVIDENCE-CH-6.0-COMPAT`
**状态**：🧪 **FREEZE PREPARATION 报告（2026-10-02）** ｜ ⛔ **非冻结件、⛔ 不构成任何授权**
**as-of**：2026-10-02（北京时间）
**授权依据**：owner 2026-10-02 裁定 —— **B1 = APPROVED** ／ **B2 = APPROVED** ／ **V6.0 FREEZE PREPARATION 自主授权**
**被测对象**：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md`
　sha256 = `e93420a38a4b92c7c5eb577c4cf5af81e6d913dc22df361a1e981978efbef4b1`（92306 B / 1377 行 / 纯 LF）
**校验器（可执行）**：`scripts/gen1/evidence-capture/v6_contract_compatibility.py`
　sha256 = `95a93798aa2548fb402b197c656e73bfe543c3b0ec3b83b2cbe5f8974fc6ad0f`（16416 B / 369 行）
**生产实现参照树**：`_v366-cd04-20261002`（V3.6.6 / `4d4a67e`，`git status --short` = **0 行**）

---

## 一、结论

```text
契约兼容性：✅ ALL PASS（46 PASS / 0 FAIL）
```

| 组 | 主题 | 断言数 | 结果 |
|---|---|---|---|
| **A** | 契约**内部一致性**（全文 ↔ 机器可读夹具） | 16 | ✅ 16/16 |
| **B** | 与 **V3.6.6 生产实现**兼容（⛔ 不新增生产字段） | 12 | ✅ 12/12 |
| **C** | ★ **改动面收敛**（V5→V6 diff 只落在允许章节，**双向**断言） | 13 | ✅ 13/13 |
| **D** | 冻结基线**零漂移** + 候选件自约束 | 5 | ✅ 5/5 |
| | 合计 | **46** | **✅ 46/46** |

---

## 二、A 组 · 内部一致性（16 项）

设计要旨：**契约是「人读条款」，夹具是「机读形态」** —— 两者必须**逐条对齐**，否则冻结后必然漂移。

### A1 §5.6.3 ↔ `trigger_registry.json`（4 项）

| 断言 | 内容 | 结果 |
|---|---|---|
| `A1` | §5.6.3 覆盖全部 9 trigger 的 `id` / `cron` / `entry_point` / `writes_collections` | PASS（缺失 `[]`） |
| `A1` | §5.6.3 声明 3 个无调度留册函数 | PASS |
| `A1` | §5.6.3 声明 2 个云端不存在项 | PASS |
| `A1` | §5.6.4 绑定 `trigger_registry.json` 与 `trigger_registry.js` | PASS |

### A2 §5.8 ↔ `checkpoint_windows_cases.json`（4 项）

| 断言 | 内容 | 结果 |
|---|---|---|
| `A2` | §5.8 `W1 = [22:30, 23:30)` 与夹具 `start`/`end` 一致 | PASS |
| `A2` | §5.8 `W2 = 次一工作日 [08:30, 09:30)` 与夹具一致 | PASS |
| `A2` | §5.8 `rule = first-window-wins` == 夹具 `rule` | PASS |
| `A2` | §5.8 绑定 `checkpoint_discriminator.js` | PASS |

### A3 §3.4A ↔ `independence_discriminator_v2.js`（5 项）

| 断言 | 内容 | 结果 |
|---|---|---|
| `A3` | §3.4A 的 `CLUSTER_GAP_DAYS = 10` == 判据源码 `const CLUSTER_GAP_DAYS = 10;` | PASS |
| `A3` | §3.4A `I1`–`I7` 七条齐备 | PASS |
| `A3` | fail-closed 语义与判据一致（`NOT_EVALUABLE` / `NOT_INDEPENDENT`） | PASS |
| `A3` | §3.4A 明确排除 `trigger` 与 **capture 窗口身份** | PASS |
| `A3` | §3.4A 携带 `sufficiency_scope = NECESSARY_CONDITIONS_ONLY` | PASS |

### A4 / A5 八源与字段 schema（3 项）

| 断言 | 内容 | 结果 |
|---|---|---|
| `A4` | §5.3 **八源集合 == `registry.eight_sources`**（集合相等 + 逐项全文可查） | PASS（`set_diff=[]` / `missing=[]`） |
| `A5` | 17 列 Evidence 字段在 V6 齐备且**顺序未变** | PASS |
| `A5` | §3 字段表（17 行）**逐字未变** | PASS |

---

## 三、B 组 · 与 V3.6.6 生产实现兼容（12 项）

设计要旨：契约冻结后**不得要求生产侧新增字段 / 新增集合**；V6 所引用的每个集合与字段都必须**在现行生产树中真实存在**。

### B0 树可见性

| 断言 | 内容 | 结果 |
|---|---|---|
| `B0` | `_v366-cd04-20261002` 树可见 | PASS |

### B1 集合存在性（9 项）

| 断言 | 文件 | 结果 |
|---|---|---|
| `B1` | `V365_COLLECTIONS.RUN_MANIFEST` → 值含 `run_manifest` | PASS |
| `B1` | `V365_COLLECTIONS.CANDIDATE_DECISION` → 值含 `run_candidate_decision` | PASS |
| `B1` | `V365_COLLECTIONS.CANDIDATE_PORTFOLIO` → 值含 `run_candidate_portfolio` | PASS |
| `B1` | `V365_COLLECTIONS.ACTIVE_POINTER` → 值含 `active_run_pointer` | PASS |
| `B1` | `V365_COLLECTIONS.RUN_HISTORY` → 值含 `run_history` | PASS |
| `B1` | `COLLECTIONS.RUNTIME_STATUS` 存在 | PASS |
| `B1` | `COLLECTIONS.ML_SHADOW_SIGNAL` 存在 | PASS |
| `B1` | `COLLECTIONS.FETCH_LOG` 存在 | PASS |
| `B1` | `COLLECTIONS.ETF_DAILY` 存在 | PASS |

### B2 / B3 写点与「不新增字段」

| 断言 | 内容 | 结果 |
|---|---|---|
| `B2` | `runDecisionEngine/index.js` 实读：写 `run_candidate_*`（`putCandidate`）与 `runtime_status` | PASS |
| `B3` | ⛔ V6 **未新增**任何生产字段要求（仅登记既有字段：`gen1_candidate_hash` 为**真实生产字段**） | PASS |

**八源归属抽查（V3.6.6 树实读）**：
- 运行轴 5 源（`run_manifest` / `run_candidate_decision` / `run_candidate_portfolio` / `active_run_pointer` / `run_history`）落在 `src/common/utils/v365-contracts.js` 的 `V365_COLLECTIONS`；
- 其余 3 源（`runtime_status` / `ml_shadow_signal` / `invocation_log`，另含 `fetch_log` / `etf_daily`）落在 `src/common/constants.js` 的 `COLLECTIONS`。

---

## 四、C 组 · ★ 改动面收敛（13 项，本报告最有分量的一组）

设计要旨：**「改了哪些」与「没改哪些」必须同时被证明**。仅证明前者是敞口的。

### C1 严格零改动章节（1 项）

| 断言 | 内容 | 结果 |
|---|---|---|
| `C1` | **18 个章节逐字节未变**（§2 / §3.2 / §3.3 / §3.4 / §3.6 / §4 / §5.1 / §5.2 / §5.4 / §5.5 / §5.7 / §5.9 / §6 / §7 / §8 / §9.1 / §9.2 / §9.3） | PASS（不一致 `[]`） |

### C2 / C3 定点改动（3 项）

| 断言 | 内容 | 结果 |
|---|---|---|
| `C2` | §3.0 / §3.1 **仅「版本措辞」各一行**变更，其余逐字节未变（精确比对**变更行集合**） | PASS |
| `C3` | §5.3 为**纯插入**（`delete` / `replace` 均未出现，`tags=['equal','insert']`） | PASS（`changed_v5_lines=[]`） |
| `C3` | §5.3 新增内容 = `trigger provenance` + `checkpoint_window_id` | PASS |

### C4 §9.4 与 §9.5 的边界（2 项）

| 断言 | 内容 | 结果 |
|---|---|---|
| `C4` | §9.4 正文（ref 表 + 尾注 + 分隔符）**逐字节未变** | PASS |
| `C4b` | §9.5 为**追加**（位于 §9.4 与 §10 之间；V5 中不存在） | PASS |

### C5 章节归属：**逐行 + 双向**（2 项）

> ⚠️ **口径修正记录**：首轮 `C5` 用**标题字符串**匹配（拿 V6 标题去匹配 V5 标题）⇒ 规则本身有缺陷，误报 18 处「越界」。
> 正确做法是**按 V5 行号区间逐行判定**，且**双向**断言（无越界 **且** 无漏项）。这是**断言表达**的修正，⛔ 不是放宽判据。

| 断言 | 内容 | 结果 |
|---|---|---|
| `C5a` | 改动行**未**越出允许章节区间（逐行判定） | PASS（越界行 `[]`） |
| `C5b` | 被改动章节集合**恰好等于**预期集合（漏项 `[]` / 意外 `[]`） | PASS（实测 18 处） |

**预期被改动集合（18 处）**：`<FILE-HEAD>`、§0、§1、§1.1、§1.3、§1.4、§1.5、§3.0、§3.1、§3.5、§5.6、§5.8、§10、§11、§12、§13、§13.1、变更日志。
**白名单另含 3 处「纯插入挂靠」边界章节**（§3.4 / §5.3 / §9.4）—— 其**本体未改**，新内容挂在**其后**（§3.4A / §5.3 插入段 / §9.5）。

### C6 非意图残迹归零（5 项）

| 断言 | 口径 | 结果 |
|---|---|---|
| `C6a` | **块级**：任一并集块「去空白后两侧相等」= 0 | PASS（残留块 `[]`） |
| `C6b` | **行级**：等长替换块内「仅空白不同」的配对行 = 0 | PASS（残留行 `[]`） |
| `C6c` | **交叉口径**：归一化对拍下的改动行亦未越界 | PASS（越界 `[]`） |
| `C6d` | V6 标题无重复（`### X### X` 残迹 = 0） | PASS |
| `C6e` | 水平分隔符 `---` 计数 = V5 + 1 | PASS |

---

## 五、D 组 · 冻结基线零漂移 + 候选件自约束（5 项）

| 断言 | 内容 | 结果 |
|---|---|---|
| `D1` | V5 冻结载体 sha256 未变 = `4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b` | PASS |
| `D2` | V6 候选为**纯 LF** | PASS |
| `D3` | V6 含「**⛔ V5.0 载体 immutable 声明（owner B1）**」 | PASS |
| `D4` | V6 **未**自称 FROZEN（🧪 FREEZE CANDIDATE / ⛔ NOT FROZEN 齐备） | PASS |
| `D5` | V6 **未**携带「本文件已冻结」类**自指语句** | PASS |

---

## 六、伴随的跨语言一致性（Python ↔ JS 奇偶校验）

**问题**：B3 的迁移方案会把 `c1_capture.py` 改绑到 v6.0 语义。若 Python 侧裁决与 JS 侧判据不一致 ⇒ 冻结后两侧证据链**分叉**。

**校验器**：`scripts/gen1/evidence-capture/checkpoint_python_js_parity.py`
　sha256 = `afa810e515bd566c046690a174dd337e976b9154dd57bea55197b8f675ea3de9`（8567 B / 169 行）
**方法**：⛔ 不做字符串对拍 —— 由 `c1_capture.py`（v5.0 实文件，只读）经迁移变换生成 **v6.0 语义源码**，
抽出 `evaluate_checkpoint_v6` / `first_window_wins_checkpoint` **运行时执行**，与 JS 夹具 `expect` 逐字段比对。

| 断言 | 覆盖 | 结果 |
|---|---|---|
| 12 条 `capture_case` | `(ok, window_id, reason)` 三元组逐条一致 | ✅ 12/12 |
| 3 条 `first_window_wins_case` | `(winner, window_id, bundles)` 一致 | ✅ 3/3 |
| 边界矩阵 10 项 | 半开区间 `[start, end)` + 周末，Python 侧独立复算 | ✅ 10/10 |
| 反向证明 | v5.0 语义在 W2 必 `False`；v6.0 判 `ok/W2`；两侧在 W1 一致 | ✅ |
| | 汇总 | **✅ ALL PASS（6 PASS / 0 FAIL）** |

**⚠️ 已登记的 API 切分差异（非语义差异，⛔ 不掩盖）**：
JS `decideCapture()` 把「窗口命中」与「`pinned decision_date` 匹配」**合并在一个返回值**（reason = `IN_WINDOW_AND_DATE_MATCH`）；
Python `evaluate_checkpoint_v6()` **只判窗口**（reason = `IN_WINDOW`），日期匹配由 §5.8 规则 3 在**调用方**承担。
⇒ 本校验按契约语义把两侧**复合成同一三元组**再比对，差异被**显式吸收并在此登记**。

---

## 七、兼容性结论

```text
V6.0 契约兼容性 = ✅ ALL PASS（46 PASS / 0 FAIL）
  A 内部一致：全文 ↔ registry / checkpoint 夹具 / R1-v2 判据常量 / 八源 / 17 列
  B 生产兼容：V365_COLLECTIONS 5 源 + COLLECTIONS 4 集合实存；写点确认；⛔ 未新增生产字段
  C 改动面收敛：18 节逐字节未变 + 3 处定点改动 + §9.4 未变 + 章节归属双向断言 + 残迹归零
  D 零漂移：V5 sha256 未变 / V6 纯 LF / ⛔ 未自称 FROZEN / ⛔ 无自指语句
  ＋ 跨语言：Python ↔ JS 奇偶一致（12 + 3 + 10 项）
```

**结论**：V6.0 候选与**现行生产实现（V3.6.6）完全兼容** —— 契约**未**要求任何新的生产集合、字段或行为。
⛔ **不新增字段**这一点尤其关键：若冻结一份要求生产侧改动的契约，就等于**用治理文档倒逼生产变更**，违反本批次的授权边界。

⛔ 本报告**不**冻结任何东西；⛔ **未** commit、**未**建 tag、**未** push。
⛔ 本报告**不**主张任何生产行为改变；`gen1_authority` 保持 `CANARY`；`ml_effective = false`；`gen1_production_write = false`。
**下一闸门** = `V6.0 FREEZE`（须 owner **单独授权**）。
