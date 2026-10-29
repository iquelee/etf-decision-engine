# Gen-1 Evidence Contract v6.0 — 契约 ↔ 工具 **对齐报告**（TOOL ALIGNMENT REPORT）

**文档编号**：`WP-G1-EVIDENCE-CH-6.0-TAR`
**性质**：**可执行对齐报告** —— 证明 `GEN1_EVIDENCE_CONTRACT_V6.md` ↕ `c1_capture.py` ↕ `c1_gate_redproof.py`
**三对象语义一致**，并以**版本错配反向证明**证明三对象的 SHA 绑定**具约束力**。
**闸门**：**V6.0 FREEZE + B3 同批次工具迁移（原子治理批次）** —— owner 2026-10-02 单独授权（含 `O-1 = APPROVED`）
**as-of**：2026-10-02（北京时间）
**依据**：契约 **§11 元规则 规则 5**（同批次）+ **§12 第 12 项** + `V6.0 Evidence Freeze Seal` lifecycle `S1 TOOL_ALIGNMENT_PASS`
**输出模式**：**READ-ONLY / NO PRODUCTION EFFECT**

---

## 1. 三对象指纹（对齐的锚点）

| # | 对象 | 路径 | sha256 | 字节 | 行 |
|---|---|---|---|---|---|
| C | 证据契约（**FROZEN 载体**） | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md` | `7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e` | 97203 | 1413 |
| T1 | 采集工具 | `scripts/gen1/evidence-capture/c1_capture.py` | `d0acc9e427f6ce52de903abd40ef41c76e87f7e5ba3441dea92f6a3d013a4337` | 31143 | 629 |
| T2 | red-proof 工具 | `scripts/gen1/evidence-capture/c1_gate_redproof.py` | `e795c93445802249e8c33a29e9b01120833079fd7b38d9a660ea22ed590caba0` | 14904 | 311 |

**被对齐的判据构件**：

| 构件 | 路径 | sha256（as-of 本报告） |
|---|---|---|
| Trigger Registry 校验器 | `scripts/gen1/evidence-capture/trigger_registry.js` | `b9e747853785addcf8da066f759948bd8953b794e4b57169bf877f1e952c6615` |
| §5.8 判别器 | `scripts/gen1/evidence-capture/checkpoint_discriminator.js` | `51a0ae40790379a031b677dad7706cebd545dff3f6a123347106116a4a07aa35` |
| 校验器 | `scripts/gen1/evidence-capture/v6_contract_tool_alignment.py` | 见 §5 复算（本报告主体） |

---

## 2. 五层对齐结果（**29 PASS / 0 FAIL**）

```text
python scripts/gen1/evidence-capture/v6_contract_tool_alignment.py
→ TOOL ALIGNMENT = ✅ PASS（29 PASS / 0 FAIL）
```

### L1 — `Contract §5.6` ↔ `trigger_registry.js` / fixtures（6 项）

| # | 断言 | 结果 |
|---|---|---|
| L1-1 | §5.6.3 Trigger Registry 章节存在 | ✅ |
| L1-2 | §5.6.3 覆盖全部 **9 个 trigger**（id / cron / entry / 写入集合），缺 = `[]` | ✅ |
| L1-3 | §5.6.4 绑定 registry 夹具与校验器（契约 ↔ 工具链**显式绑定**） | ✅ |
| L1-4 | `registry.js` 以夹具为**唯一**数据源（`readFileSync`，⛔ **不内嵌副本** ⇒ 无漂移空间） | ✅ |
| L1-5 | `registry.js` 实现 §5.6.4 校验（缺列 / 云有登记无 / 登记有云无 / 八源） | ✅ |
| L1-6 | 契约声明 **3 个无调度留册**函数 + **2 个云端不存在**项 | ✅ |

> ★ **L1-4 的绑定形态说明**：`trigger_registry.js` **不内嵌** registry 常量，而是 `readFileSync`
> 加载 `fixtures/trigger_registry.json` 与 `fixtures/trigger_registry_cloud_observed.json`
> ⇒ 契约 §5.6.4 与实际登记表之间**只有一条数据通路**，⛔ 不存在「代码副本与夹具漂移」的空间。
> （首轮该断言曾按「内嵌常量」写错并 FAIL ⇒ 已按**实际绑定形态**修正，⛔ 未放宽断言。）

### L2 — `Contract §5.8` ↔ `checkpoint_discriminator.js`（4 项）

| # | 断言 | 结果 |
|---|---|---|
| L2-1 | §5.8 绑定 `checkpoint_discriminator.js`（契约 ↔ 判别器） | ✅ |
| L2-2 | 判别器含 **W1 / W2 双窗口 + first-window-wins** 实现 | ✅ |
| L2-3 | §5.8 窗口字面量 == 判别器夹具（`W1 22:30–23:30` / `W2 08:30–09:30`） | ✅ |
| L2-4 | §5.8 绑定 `checkpoint_python_js_parity.py`（Python ↔ JS 奇偶） | ✅ |

### L3 — `Contract §5.8` ↔ `c1_capture.py`（采集工具，10 项）

| # | 断言 | 结果 |
|---|---|---|
| L3-1 | 采集工具绑定契约路径 == **冻结载体路径**（`docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md`） | ✅ |
| L3-2 | 采集工具绑定契约版本 == `v6.0` | ✅ |
| L3-3 | ★ 采集工具 `CONTRACT_CONTENT_SHA256` == **冻结载体实测 sha256**（`7e3e5d87…272e`） | ✅ |
| L3-4 | 采集工具**无** `PENDING_AT_V6_FREEZE` 占位（冻结已填实） | ✅ |
| L3-5 | 采集工具 `CHECKPOINT_WINDOWS` = W1/W2 且与契约字面量一致 | ✅ |
| L3-6 | 采集工具含 `evaluate_checkpoint_v6`（返回 `window_id`）与 `first_window_wins_checkpoint` | ✅ |
| L3-7 | ★ 采集工具**已消除**旧单窗口表达式（v5.0 语义不残留） | ✅ |
| L3-8 | 采集工具 bundle 记录 `checkpoint_window_id` 且 ⛔ 声明**非独立判据** | ✅ |
| L3-9 | 采集工具 `CHAIN_WINDOWS` = `W1-2200` / `W2-0800` 双链 | ✅ |
| L3-10 | 采集工具 ⛔ **不自行判定独立事件**（引用 §3.4A，⛔ 无 `independent_event` 判定） | ✅ |

> ★ **L3-3 是最强绑定**：工具内**硬编码**契约内容哈希 ⇒ 契约任一字节变化，工具立即与契约**不同源**。

### L4 — `c1_capture.py` ↔ `c1_gate_redproof.py`（6 项）

| # | 断言 | 结果 |
|---|---|---|
| L4-1 | red-proof 调用采集工具的 `evaluate_checkpoint_v6` | ✅ |
| L4-2 | red-proof 调用采集工具的 `first_window_wins_checkpoint` | ✅ |
| L4-3 | red-proof 含 **W2 边界期望**（08:30 / 09:30） | ✅ |
| L4-4 | ★ red-proof 含「**旧单窗口规则恢复 ⇒ 必 FAIL**」反向证明 | ✅ |
| L4-5 | red-proof 含 **same-bundle 非独立** + **different-provenance 独立**两段 | ✅ |
| L4-6 | ★ red-proof **已消除**旧 09:00 单窗口期望 | ✅ |

### L5 — `Contract §5.8` ↔ `c1_gate_redproof.py` 期望一致性（3 项）

| # | 断言 | 结果 |
|---|---|---|
| L5-1 | red-proof 的 **09:00 期望 == 契约 W2 语义**（`True` / `W2`，⛔ 非 `False`） | ✅ |
| L5-2 | red-proof 的 W1 边界期望 == 契约**半开区间** | ✅ |
| L5-3 | red-proof 文件头声明 v6.0 迁移且引用 §11 规则 5 | ✅ |

---

## 3. ★★ 版本错配**反向证明**（owner §七 强制要求）

```text
python scripts/gen1/evidence-capture/v6_contract_tool_alignment.py --reverse-proofs
```

| 组合 | 构造 | 期望 | 实测 | 判定 |
|---|---|---|---|---|
| **RP-A** | V6 Contract + **V5 capture** + V6 redproof | `ALIGNMENT = FAIL` | **FAIL** | ✅ 符合 |
| **RP-B** | V6 Contract + V6 capture + **V5 redproof** | `ALIGNMENT = FAIL` | **FAIL** | ✅ 符合 |
| **RP-C** | V6 Contract + V6 capture + V6 redproof | `ALIGNMENT = PASS` | **PASS** | ✅ 符合 |

**构造方式（可复算、不依赖本报告）**：以 `git -C <repo> show 7d2f39bddd681cce9d714558d518b06631451d01:<path>`
抽取 **v5.0 冻结字节**，落于 `scripts/gen1/evidence-capture/out/v5-baseline/`：

| 基线 | 抽取路径 | sha256 | 断言 |
|---|---|---|---|
| `c1_capture.v5.py` | `scripts/gen1/evidence-capture/out/v5-baseline/c1_capture.v5.py` | `dd2ea8b0090853e36a28e8590fbf62519b2e7461ab7a5160c0e475a9841c8c42`（26369 B） | ✅ == v5.0 冻结值 |
| `c1_gate_redproof.v5.py` | `scripts/gen1/evidence-capture/out/v5-baseline/c1_gate_redproof.v5.py` | `0cca693ce6728b627190b04fcd78fb92ebc5153e8318dbc4f6ef39dcec06bc20`（9362 B） | ✅ == v5.0 冻结值 |

再以 `run(capture_path=<组合>, redproof_path=<组合>)` 逐组合跑**同一套**对齐校验。

**结论**：

```text
✅ evidence_contract_sha256 / capture_tool_sha256 / redproof_tool_sha256
   三者**具约束力** —— 任一版本错配即被判 ALIGNMENT = FAIL。
⛔ 它们**不是**「记录用字段」；⛔ 不能被「只要字段在场」蒙过。
```

---

## 4. 与「打红自证」的分工（⛔ 不可互相替代）

| 通道 | 脚本 | 回答的问题 | 本轮结果 |
|---|---|---|---|
| **门级打红**（契约 §5.4 / §5.8 判据） | `c1_gate_redproof.py` | 「14 条 gate / checkpoint / first-window-wins **实现**是否按契约判」 | ✅ **57 项 ALL PASS** |
| **契约级打红**（候选件本体） | `v6_redproof.py` | 「契约**文字**被变异后，验收套件是否必 FAIL」 | ✅ 20 PASS（15 变异 15/15 检出 + 15/15 逐字节还原） |
| **对齐级反向证明**（本报告） | `v6_contract_tool_alignment.py --reverse-proofs` | 「**版本错配**是否必被检出」（三对象的**约束力**） | ✅ RP-A / RP-B / RP-C 3/3 |
| **冻结不变性** | `v6_frozen_carrier_assertions.py` | 「冻结轮是否只改了声明区段、规范性正文是否逐字节未变」 | ✅ 25 PASS |
| **Python ↔ JS 奇偶** | `checkpoint_python_js_parity.py` | 「两语言对同一 `(时刻)` 是否给同一 `(ok, window_id)`」 | ✅ 6 PASS |

> ⚠️ 四个通道**判据互不相同**，⛔ 不得据其一推断其余。

---

## 5. 复算方法

```bash
# ① 五层对齐
python scripts/gen1/evidence-capture/v6_contract_tool_alignment.py
#   → TOOL ALIGNMENT = ✅ PASS（29 PASS / 0 FAIL）

# ② 版本错配反向证明（会写入 out/v5-baseline/，⛔ 不入库）
python scripts/gen1/evidence-capture/v6_contract_tool_alignment.py --reverse-proofs
#   → RP-A FAIL(期望) / RP-B FAIL(期望) / RP-C PASS

# ③ 三对象指纹核对
sha256sum docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md \
          scripts/gen1/evidence-capture/c1_capture.py \
          scripts/gen1/evidence-capture/c1_gate_redproof.py
#   → 7e3e5d87…272e / d0acc9e4…a4337 / e795c934…aba0
```

---

## 6. ⛔ 边界

| # | 事项 | 状态 |
|---|---|---|
| 1 | 本报告是否改变生产行为 | ⛔ **否**（READ-ONLY；生产代码 / 配置 / DB / Authority / Seal 零改动） |
| 2 | 是否解除 Evidence Execution | ⛔ **否**（契约 §12 第 5 项未闭合） |
| 3 | 是否构成 Evidence Seal（Key 3） | ⛔ **否**（`independent_events = 0`） |
| 4 | 是否授权 merge / push / deploy / canary / GE-04 | ⛔ **否** |
| 5 | 是否授权 V3.6.6 Freeze / Production Attestation | ⛔ **否** |

*本报告⛔ 不写入自身 sha256（自指悖论）；其指纹于交付清单外单列。*
*落点：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_TOOL_ALIGNMENT_REPORT_20261002.md`*
