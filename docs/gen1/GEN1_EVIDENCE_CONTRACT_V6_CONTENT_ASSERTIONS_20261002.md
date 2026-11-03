# V6.0 内容断言报告（CONTENT ASSERTIONS）

**文档编号**：`WP-G1-EVIDENCE-CH-6.0-ASSERT`
**状态**：🧪 **FREEZE PREPARATION 报告（2026-10-02）** ｜ ⛔ **非冻结件、⛔ 不构成任何授权**
**as-of**：2026-10-02（北京时间）
**授权依据**：owner 2026-10-02 裁定 —— **B1 = APPROVED** ／ **B2 = APPROVED** ／ **V6.0 FREEZE PREPARATION 自主授权**
**被测对象**：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md`
　sha256 = `e93420a38a4b92c7c5eb577c4cf5af81e6d913dc22df361a1e981978efbef4b1`（92306 B / 1377 行 / 纯 LF）
**断言载体（可执行）**：`scripts/gen1/evidence-capture/v6_content_assertions.py`
　sha256 = `55a441f629aea99f1f6d67237dd70f5ae4b6651e11ddb3bd411f5d5c164a2eb4`（10005 B / 192 行）
**运行方式**：`python scripts/gen1/evidence-capture/v6_content_assertions.py`（退出码 0 = ALL PASS）

---

## 一、结论

```text
内容断言：✅ ALL PASS（39 PASS / 0 FAIL）
```

| 组 | 覆盖对象 | 断言数 | 结果 |
|---|---|---|---|
| **A** | 结构完整性（章节序 / 新增节 / 标题 / EOL / 字段表） | 5 | ✅ 5/5 |
| **B** | §3.4A 独立性判据（I1–I7 / fail-closed / 排除项 / 计数规则 / 互证句） | 10 | ✅ 10/10 |
| **C** | §5.6 Trigger Registry（枚举域 / 留册 / 不存在项 / 校验器绑定） | 5 | ✅ 5/5 |
| **D** | §5.8 checkpoint（W1 / W2 / fww / 静默 / 两条链 / 判别器绑定） | 6 | ✅ 6/6 |
| **E** | 治理与版本（编号 / 状态 / 取代 / §11 / R3 / CD / 边界） | 10 | ✅ 10/10 |
| **F** | 禁语零命中（8 条历史残留 / 自指语句） | 1 | ✅ 1/1 |
| **G** | 与 V5.0 的关系 | 2 | ✅ 2/2 |
| 合计 | | **39** | **✅ 39/39** |

---

## 二、A 组 · 结构完整性

| 断言 | 内容 | 结果 |
|---|---|---|
| `A-1` | `## 0` … `## 13` 全部存在且**顺序正确** | PASS |
| `A-2` | v6.0 四个新增章节齐备：`## 1.6` / `### 3.4A` / `### 9.5` / `### 13.2` | PASS（缺失 `[]`） |
| `A-3` | 标题无重复（**54 个标题**）**且标题行内未嵌入第二个标题标记** | PASS（重复 `[]` / 行内嵌入 `[]`） |
| `A-4` | 纯 LF（无 CRLF） | PASS |
| `A-5` | 17 列 Evidence 字段表齐备（`\| 17 \|` 恰一处） | PASS |

⚠️ `A-3` 含**行内嵌入型**检测：`### X### X` 这类残迹**单行仍是一个标题**，仅靠「标题文本去重」抓不到 ⇒ 必须单独检测行内的第二个 `###` 标记。

---

## 三、B 组 · §3.4A `INDEPENDENCE REQUIREMENTS`（★ R1 v2 条款化）

| 断言 | 内容 | 结果 |
|---|---|---|
| `B-1` | §3.4A 存在且标题含 `INDEPENDENCE REQUIREMENTS` | PASS |
| `B-2` | `I1`–`I7` **七条齐备**（逐条 `  I<n> ` 命中） | PASS（缺失 `[]`） |
| `B-3` | I 条数**恰为 7**，⛔ 无 `I8`（防越权扩判据） | PASS |
| `B-4a` | `CLUSTER_GAP_DAYS = 10` **本体位于 §3.4**（冻结段，v6.0 ⛔ 未改） | PASS |
| `B-4b` | §3.4A **引用** `CLUSTER_GAP_DAYS` 且 ⛔ **未重定义**（§3.4A 内不出现赋值） | PASS |
| `B-5` | fail-closed 双分支齐备：`NOT_EVALUABLE（不得计入独立事件）` / `NOT_INDEPENDENT（不得计入独立事件）` | PASS |
| `B-6` | `sufficiency_scope = NECESSARY_CONDITIONS_ONLY` | PASS |
| `B-7` | 排除清单含 `` `trigger` / `trigger_id` `` 与 **`capture 窗口身份（W1 / W2）`** | PASS |
| `B-8` | 计数规则 = 「**（+2，非 +1）**」且 `NOT_INDEPENDENT` **不增加计数** | PASS |
| `B-9` | §5.8 侧互证句：⛔ **窗口不同 / trigger 不同 / run_id 不同** 均**不**产生第二个独立 Evidence 事件 | PASS |

**⚠️ 作用域纪律（`B-4a/B-4b` 的由来）**：常量**本体**住在冻结的 §3.4（v6.0 ⛔ 不改 §3.4），
§3.4A 只**引用**它。把断言写成「常量须出现在 §3.4A」是**作用域错误** ——
正确做法是**分别断言**「本体在原处」与「引用处不重定义」，⛔ 不是放宽断言。

---

## 四、C 组 · §5.6 完整 Trigger Registry（★ R2 条款化；修 `CD-06`）

| 断言 | 内容 | 结果 |
|---|---|---|
| `C-1` | §5.6.3 标题含 `Trigger Registry` | PASS |
| `C-2` | **全部 9 个 `trigger_id`** 出现（`dailyFetch-2200` / `dailyPipeline-0800` / `gen1-eod-weekdays-2220` / `gen2-eod-weekdays-2230` / `newsFetch-1630` / `intelFetch-30min` / `newsExtract-1640` / `intelExtract-30min` / `realtime-5min`） | PASS（缺失 `[]`） |
| `C-3` | 3 个**无调度留册**函数齐备（`runDecisionEngine` / `adminGateway` / `apiGateway`） | PASS |
| `C-4` | 2 个**云端不存在**项齐备（`runIntegratedShadowEod` / `dailyFetch-1530`） | PASS |
| `C-5` | §5.6.4 绑定 `trigger_registry.json` 与 `trigger_registry.js` | PASS |

---

## 五、D 组 · §5.8 `CANONICAL_CAPTURE_CHECKPOINT`（★ B2 重锚）

| 断言 | 内容 | 结果 |
|---|---|---|
| `D-1` | §5.8 内 `W1 = [22:30:00, 23:30:00)` | PASS |
| `D-2` | §5.8 内 `W2 = 次一工作日 [08:30:00, 09:30:00)` | PASS |
| `D-3` | §5.8 内 `first-window-wins` ≥3 次（实测 §5.8 内 **5** 次 / 全文 **12** 次） | PASS |
| `D-4` | 静默性质**穷举表** + `CHECKPOINT_SILENCE` 绑定 | PASS |
| `D-5` | 两条 PROMOTION-CAPABLE 链（`W1-2200` / `W2-0800`）+ 「其 run 是否自动成为独立事件 = ⛔ **否**」 | PASS |
| `D-6` | §5.8 **绑定** `checkpoint_discriminator.js`（补前为 ❌ —— 见 diff matrix §五） | PASS |

---

## 六、E 组 · 治理与版本

| 断言 | 内容 | 结果 |
|---|---|---|
| `E-1` | 文档编号 = `WP-G1-EVIDENCE-CH-6.0` | PASS |
| `E-2` | 状态 = 🧪 **FREEZE CANDIDATE** 且显式 ⛔ **NOT FROZEN** | PASS |
| `E-3` | V5.0 = `SUPERSEDED / INVALID FOR NEW EVIDENCE`（全文 4 处） | PASS |
| `E-4` | §11 规则 2 版本位 = **`v7.0`**（⛔ 非自指 `v6.0`，⛔ 全文仅 1 处 `v7.0`） | PASS |
| `E-5` | ``R3 = OBSERVATION`` 且**显式否定** `CONTRACT GAP`（3 处） | PASS |
| `E-6` | `CD-06` / `CD-07` 已登记（分别 10 / 8 处） | PASS |
| `E-7` | `PRE-V6 DIAGNOSTIC` 标记确立（恰 1 处，⛔ 旧语 `PRE-V5 DIAGNOSTIC` 零命中） | PASS |
| `E-8` | §12 未决项 ≥ **15** 项 | PASS |
| `E-9` | 「**⛔ V5.0 载体 immutable 声明（owner B1）**」齐备 | PASS |
| `E-10` | `B3 = NOT YET AUTHORIZED` 已在 §11 规则 5 记录 | PASS |

---

## 七、F 组 · 禁语零命中（8 条）

| # | 禁语（字面量） | 出现次数 | 判据 |
|---|---|---|---|
| F-1 | `PRE-V5 DIAGNOSTIC` | **0** | ✅ |
| F-2 | `WP-G1-EVIDENCE-CH-5.0` | **0** | ✅ |
| F-3 | `### 变更日志### 变更日志` | **0** | ✅ |
| F-4 | `本文件已于` | **0** | ✅ |
| F-5 | `发布 **v6.0**，并**显式作废 v5.0 全部样本**` | **0** | ✅ |
| F-6 | `🔒 **FROZEN（2026-10-02）** ｜ 📌 **载体封存记录` | **0** | ✅ |
| F-7 | `v5.0（🔒 **FROZEN**，2026-10-02）` | **0** | ✅ |
| F-8 | `v5.0 CONTRACT GENERATION      ✅ DONE` | **0** | ✅ |

**F 组的三重意义**：① 防「换了说法但旧措辞残留」；② 防**自指矛盾**（候选件 ⛔ 不得自称已冻结 / 已封存）；
③ 防 §11 规则 2 的**版本位回退**（规则 2 若仍写「发布 v6.0 并作废 v5.0」，则 v6.0 冻结那一刻即自我否定）。

---

## 八、G 组 · 与 V5.0 的关系

| 断言 | 内容 | 结果 |
|---|---|---|
| `G-1` | V5 载体未被触碰（其 sha256 由 `v6_contract_compatibility.py` D1 独立对拍冻结值） | PASS |
| `G-2` | V6 首部声明取代关系「**v6.0 取代 v5.0**」 | PASS |

---

## 九、关键条款命中计数（全文，供复核）

| 条款 / 字面量 | 命中次数 |
|---|---|
| `§3.4A` | 15 |
| `INDEPENDENCE REQUIREMENTS` | 4 |
| `CLUSTER_GAP_DAYS` | 4 |
| `sufficiency_scope = NECESSARY_CONDITIONS_ONLY` | 1 |
| `W1 = [22:30:00, 23:30:00)` | 1 |
| `W2 = 次一工作日 [08:30:00, 09:30:00)` | 1 |
| `first-window-wins` | 12 |
| `Trigger Registry` | 6 |
| `PROMOTION-CAPABLE` | 7 |
| `CD-06` | 10 |
| `CD-07` | 8 |
| `SUPERSEDED / INVALID FOR NEW EVIDENCE` | 4 |
| `R3 = OBSERVATION` | 3 |
| `checkpoint_window_id` | 3 |
| `trigger provenance` | 5 |
| `checkpoint_discriminator.js` | 2 |
| `checkpoint_python_js_parity.py` | 2 |
| `checkpoint_windows_cases.json` | 1 |
| `PRE-V6 DIAGNOSTIC` | 1 |
| `v7.0` | 1 |

---

## 十、结论与边界

```text
V6.0 内容断言 = ✅ ALL PASS（39 PASS / 0 FAIL）
  ├─ 结构：章节序 / 4 个新增节 / 54 标题无重复且无行内嵌入 / 纯 LF / 17 列表
  ├─ 判据：I1–I7 恰 7 条 / fail-closed 双分支 / 排除项含 trigger 与 capture 窗口身份 / 计数「+2，非 +1」
  ├─ 登记：9 trigger + 3 留册 + 2 不存在 / W1∪W2 / fww / 两条链「不自动成为独立事件」
  └─ 禁语：8 条全部零命中（含 2 条自指 / 1 条版本位回退）
```

⛔ 本报告**不**冻结任何东西；⛔ **未** commit、**未**建 tag、**未** push。
⛔ 本报告**不**主张任何生产行为改变；`gen1_authority` 保持 `CANARY`。
**下一闸门** = `V6.0 FREEZE`（须 owner **单独授权**）。
