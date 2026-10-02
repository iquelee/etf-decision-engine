# Gen-1 Evidence Contract v6.0 — 冻结**证据包**（FREEZE EVIDENCE BUNDLE）

**文档编号**：`WP-G1-EVIDENCE-CH-6.0-FEB`
**性质**：**证据包（Evidence Bundle）** —— 把 v6.0 冻结 / 封存批次的**四级指纹链**与**全部承重指纹**
集中于一处，供**独立复核**与**跨会话交接**。
**闸门**：**V6.0 FREEZE + B3 同批次工具迁移（原子治理批次）** —— owner 2026-10-02 单独授权（含 `O-1 = APPROVED`）
**as-of**：2026-10-02（北京时间）
**输出模式**：**READ-ONLY / NO PRODUCTION EFFECT**

---

## 0. ★ 四级指纹链（**本证据包的骨架**）

```text
① INPUT      V5.0 FROZEN 载体            docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md
                                         4fb9463f…f55b / 64580 B / 1072 行
                                         carrier 05da0efa…3e9b / blob 7f86d12a…
                     ↓  （v6.0 生成轮：R1 / R2 / R3 修订；⛔ 不改 v5.0 任何字节）
② CANDIDATE  V6.0 FREEZE CANDIDATE       docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md
                                         e93420a3…bef4b1 / 92306 B / 1377 行
                     ↓  （冻结轮：**status-head-only**；⛔ 零字节语义改动）
③ FROZEN     V6.0 FROZEN 载体            docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md
                                         7e3e5d87…272e / 97203 B / 1413 行
                                         carrier ccb0f4b8… / blob 29425933…
                     ↓  （B3 同批次迁移 + 封存）
④ SEALED     V6.0 Evidence Freeze Seal   docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json
                                         status = EVIDENCE_FREEZE_SEALED
                                         bound: ③ + c1_capture.py(d0acc9e4…) + c1_gate_redproof.py(e795c934…)
```

> ⚠️ **三种指纹不可混用**：`content sha256`（文件内容哈希）/ `git blob id`（sha1，git 对象哈希）/ `carrier commit`（提交哈希）。

---

## 1. ① INPUT 级 —— V5.0 FROZEN 载体（**本批次零改动**）

| 项 | 值 |
|---|---|
| 路径 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md` |
| 状态 | `🔒 FROZEN（2026-10-02）`（v5.0 冻结） |
| content sha256 | `4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b` |
| 字节 / 行 | **64580** / **1072**（纯 LF） |
| carrier commit | `05da0efa73e948921bc7b9b60c0d500cc98e3e9b` |
| git blob id | `7f86d12aaed99a877c170c25c5a481f21a661256` |
| 封存记录提交 | `7d2f39bddd681cce9d714558d518b06631451d01`（= v6.0 冻结提交的 parent） |
| 本批次判定 | ✅ **未变**（`v6_frozen_carrier_assertions.py` `F-5a` 独立断言） |

---

## 2. ② CANDIDATE 级 —— V6.0 FREEZE CANDIDATE（**本批次零改动**）

| 项 | 值 |
|---|---|
| 路径 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md` |
| 状态 | `🧪 FREEZE CANDIDATE / ⛔ NOT FROZEN`（as-of 生成轮） |
| content sha256 | `e93420a38a4b92c7c5eb577c4cf5af81e6d913dc22df361a1e981978efbef4b1` |
| 字节 / 行 | **92306** / **1377**（纯 LF） |
| 本批次判定 | ✅ **未变**（`F-5b` 独立断言 ⇒ 冻结轮为**纯派生**，候选件保留为生成轮证据） |

**候选级已通过的验收（生成轮自证，本轮回归复跑）**：

| 通道 | 脚本 | 结果 |
|---|---|---|
| 内容断言 | `v6_content_assertions.py` | ✅ 39 PASS / 0 FAIL |
| 兼容性（A 内部一致 / B 生产兼容 / C 改动面收敛 / D 零漂移） | `v6_contract_compatibility.py` | ✅ 46 PASS / 0 FAIL |
| 契约级打红自证 | `v6_redproof.py` | ✅ 20 PASS / 0 FAIL（15 变异 15/15 检出 + 15/15 逐字节还原） |
| R3 消费面 | `r3_contract_consumption_test.py` | ✅ 12 PASS / 0 FAIL |

---

## 3. ③ FROZEN 级 —— V6.0 FROZEN 载体

| 项 | 值 |
|---|---|
| 路径 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md` |
| 文档编号 | `WP-G1-EVIDENCE-CH-6.0` |
| 状态 | `🔒 FROZEN（2026-10-02）` ｜ ⛔ `NOT AUTHORIZED FOR EXECUTION` |
| content sha256 | `7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e` |
| 字节 / 行 | **97203** / **1413**（纯 LF，`CRLF = 0`） |
| carrier commit | `ccb0f4b8cf402a16b16d468cbff1c02109d72476` |
| parent commit | `7d2f39bddd681cce9d714558d518b06631451d01`（**线性**） |
| git blob id | `294259338ba3fa60f689ed9139072a35b2368b0e` |
| 载体分支 | `docs/gen1-evidence-contract-v5-20261002` |
| 提交形态 | 1 file changed / **1413 insertions** / `create mode 100644` |

**冻结轮规范性不变性证据（25 PASS / 0 FAIL）**：见 `GEN1_EVIDENCE_CONTRACT_V6_FREEZE_SEAL_RECORD_20261002.md` §4。
**改动面（38 行）逐项登记**：同上 §3。

### 3.1 同批次（`B3`）迁移的两工具

| 角色 | 路径 | v5.0 sha256 | **v6.0 sha256** | 字节 | 行 |
|---|---|---|---|---|---|
| 采集工具 | `scripts/gen1/evidence-capture/c1_capture.py` | `dd2ea8b0…c8c42` | **`d0acc9e427f6ce52de903abd40ef41c76e87f7e5ba3441dea92f6a3d013a4337`** | 26369 → **31143** | 546 → **629** |
| red-proof 工具 | `scripts/gen1/evidence-capture/c1_gate_redproof.py` | `0cca693c…bc20` | **`e795c93445802249e8c33a29e9b01120833079fd7b38d9a660ea22ed590caba0`** | 9362 → **14904** | 204 → **311** |

**语义一致性（对齐级）**：`v6_contract_tool_alignment.py` = **29 PASS / 0 FAIL**（L1–L5）
**约束力证明（版本错配反向证明）**：**RP-A FAIL（期望）/ RP-B FAIL（期望）/ RP-C PASS**
**门级打红**：`c1_gate_redproof.py` = **57 项 ALL PASS**（v5.0 为 31 项）

---

## 4. ④ SEALED 级 —— `V6.0 Evidence Freeze Seal`

| 项 | 值 |
|---|---|
| 裁定载体 | `docs/gen1/GEN1_EVIDENCE_V6_FREEZE_SEAL_BINDING_DECISION.md`（`O-1 = APPROVED`） |
| 机器可读制品 | `docs/gen1/artifacts/GEN1_EVIDENCE_FREEZE_SEAL_V6.json` |
| `seal_id` / `seal_kind` / `seal_layer` | `EVIDENCE_FREEZE_SEAL_V6` / `EVIDENCE_FREEZE_SEAL` / `DOCUMENT_LAYER` |
| `version_namespace` | `gen1-evidence-contract`（⛔ 与 `gen1-guarded-effective-charter` 互不相交） |
| `seal_status` | **`EVIDENCE_FREEZE_SEALED`** |
| lifecycle | `V6.0_EVIDENCE_FREEZE_CANDIDATE → TOOL_ALIGNMENT_PASS → EVIDENCE_FREEZE_SEAL_READY → EVIDENCE_FREEZE_SEALED`（单调、⛔ 不跳级；全部达成） |

### 4.1 七项绑定

| # | 键 | 值 | 路由 |
|---|---|---|---|
| 1 | `evidence_contract_version` | `v6.0` | `DIRECT` |
| 2 | `evidence_contract_sha256` | `7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e` | `DIRECT` |
| 3 | `source_sha256` | `4fadfe1a6b93c0896c8f50984f0b13b2f14c8798ba0bc9a6fda7f9f026119e82`（C1 / 17 文件） | **`REFERENCE_TO_KEY2_SEAL`**（⛔ 非独立主张） |
| 4 | `model_sha256` | `d5e667c66a5f888bb5489b8adcad9e6a141bfbcf0006a955d6ad40e269a7e712` | **`REFERENCE_TO_KEY2_SEAL`**（⛔ 非独立主张） |
| 5 | `threshold_version` | `shadow-threshold-v1` | **`REFERENCE_TO_KEY2_SEAL`**（⛔ 非独立主张） |
| 6 | `capture_tool_sha256` | `d0acc9e427f6ce52de903abd40ef41c76e87f7e5ba3441dea92f6a3d013a4337` | `DIRECT` |
| 7 | `redproof_tool_sha256` | `e795c93445802249e8c33a29e9b01120833079fd7b38d9a660ea22ed590caba0` | `DIRECT` |

---

## 5. Key 2 侧指纹（**本批次零改动**，`unchanged = YES`）

| 项 | 值 | 判定 |
|---|---|---|
| 制品 | `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` | — |
| 制品 sha256 | `35040e5e9e809d6c278453a3bc130ec2ac6e49421ea26953fc5e17704d8809e5`（881 B） | ✅ **未变** |
| `seal_id` / `contract_version` | `GUARDED_EFFECTIVE_FREEZE` / `WP-G1-GE-CH-1.0` | ✅ **未变**（⛔ 未被写入 `V6.0`） |
| `status` / `bindings_status` | `PENDING` / `INCOMPLETE` | ✅ **未变** |
| 绑定字段集 | `contract_version` / `source_sha256` / `model_sha256` / `threshold_version`（**4 个**） | ✅ **未扩表**（`O-3 = REJECTED`） |
| 宪章 §3.1 | `docs/gen1/GEN1_GUARDED_EFFECTIVE_CHARTER.md`（四项逐字枚举） | ✅ **未改** |
| 上游裁定 | `docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md`（`2980a08f6f49a19ff8022f7bfeb2b6a7637a066a53b33260f28c43dfb0d2e07d` / 5751 B） | ✅ **未改** |

**`source_sha256` 只读重算（本批次）**：

```text
C1 = src/common/utils/gen1-*.js（17 文件）
重算（2026-10-02）= 4fadfe1a6b93c0896c8f50984f0b13b2f14c8798ba0bc9a6fda7f9f026119e82
2026-09-22 裁定值  = 4fadfe1a6b93c0896c8f50984f0b13b2f14c8798ba0bc9a6fda7f9f026119e82
⇒ 逐位相同
⚠️ 只证明「取值可复算」，⛔ 不主张 Key 2 绑定已成立。
```

---

## 6. 承重来源指纹（三个 `resolved` 值的权威出处）

| 键 | 权威文件 | 文件 sha256 | 字段行 | 文件内实值 |
|---|---|---|---|---|
| `source_sha256` | `docs/gen1/GEN1_FREEZE_SEAL_BINDING_DECISION.md` §2 | `2980a08f…e07d` | §2 裁定块 | `4fadfe1a…9e82`（裁定值） |
| `model_sha256` | `ml/manifests/GEN1_RUNTIME_BUNDLE.json` | `f4a3a2b6576cc282fc6c352a570225032c1c108a92e520110098c283ed571c36`（1071 B） | `:4` | `d5e667c6…e712` |
| `threshold_version` | 同上 + `src/common/utils/gen1-guarded-seal.js` | `f4a3a2b6…1c36` + 源码 | `:11` + `:57`（`GUARDED_THRESHOLD_VERSION`） | `shadow-threshold-v1` |

`GEN1_RUNTIME_BUNDLE.json` 关键字段（as-of）：`bundle_id = gen1-runtime-hvta-20260830` /
`model_id = HVT-A-ET-20260830` / `sealed_at = 2026-09-10` / `threshold_signal_p = 0.65`。

---

## 7. 全量回归汇总（本批次实测）

| # | 脚本 | 结果 |
|---|---|---|
| 1 | `v6_frozen_carrier_assertions.py` | ✅ 25 PASS / 0 FAIL |
| 2 | `v6_content_assertions.py` | ✅ 39 PASS / 0 FAIL |
| 3 | `v6_contract_compatibility.py` | ✅ 46 PASS / 0 FAIL |
| 4 | `v6_redproof.py` | ✅ 20 PASS / 0 FAIL |
| 5 | `r3_contract_consumption_test.py` | ✅ 12 PASS / 0 FAIL |
| 6 | `checkpoint_python_js_parity.py` | ✅ 6 PASS / 0 FAIL |
| 7 | `c1_gate_redproof.py` | ✅ **57 项 ALL PASS** |
| 8 | `c1_capture_v6_migration_test.py` | ✅ 33 PASS / 0 FAIL（默认只读）/ 34（`--emit-diff`）|
| 9 | `v6_contract_tool_alignment.py` | ✅ 29 PASS / 0 FAIL |
| 10 | `v6_contract_tool_alignment.py --reverse-proofs` | ✅ RP-A / RP-B / RP-C 3/3 |

**五通道分工（⛔ 不得据其一推断其余）**：门级打红（⑦）· 契约级打红（④）· 对齐级反向证明（⑩）· 冻结不变性（①）· Python↔JS 奇偶（⑥）。

> ⚠️ **计数口径勘误（第 8 行，2026-10-02 复核）**：初记 `34 PASS` 对应 **`--emit-diff`** 调用（比默认多 1 项「diff 文件已落盘」，且会重写 tracked 的 `c1_capture.py.v6.diff`）；**默认只读调用 = 33 PASS / 0 FAIL**。两者均 0 FAIL，结论不变。复跑另证：`--emit-diff` 重写后的 `c1_capture.py.v6.diff` 与 tracked 版本逐字节一致（sha256 `4ed1bd3e5ac055b1476138cf3b392f4b4d37777e39c92f9a45ab4cde3d64a1e7`）。

---

## 8. 复算脚本（一键，⛔ 只读）

```bash
R="D:/AI-Projects/Codex/etf-decision-engine/_g1-contract-v5-20261002"
cd "$R/scripts/gen1/evidence-capture"

# 四级指纹链
sha256sum ../../../docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md \
          ../../../docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md \
          ../../../docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md \
          c1_capture.py c1_gate_redproof.py \
          ../../../ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json
#   → 4fb9463f…f55b / e93420a3…bef4b1 / 7e3e5d87…272e / d0acc9e4…a4337 /
#     e795c934…aba0 / 35040e5e…09e5

# carrier 侧（blob + commit）
git -C "$R" rev-parse ccb0f4b8:docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md   # 29425933…
git -C "$R" cat-file -p ccb0f4b8                                        # parent = 7d2f39bd…

# 全部自证
python v6_frozen_carrier_assertions.py          # 25 PASS
python v6_contract_tool_alignment.py            # 29 PASS
python v6_contract_tool_alignment.py --reverse-proofs   # RP-A/B FAIL(期望) / RP-C PASS
python c1_capture_v6_migration_test.py          # 33 PASS（默认只读）
# 变体（会重写 tracked diff）：python c1_capture_v6_migration_test.py --emit-diff   # 34 PASS
python c1_gate_redproof.py                      # 57 项 ALL PASS
python checkpoint_python_js_parity.py           # 6 PASS
python v6_content_assertions.py                 # 39 PASS
python v6_contract_compatibility.py             # 46 PASS
python v6_redproof.py                           # 20 PASS
python r3_contract_consumption_test.py          # 12 PASS
```

---

## 9. ⛔ 边界（与同批记录一致，⛔ 不得据本证据包外推）

```text
Production code changed = NO          Deploy  = NO            Merge = NO
Production DB writes    = 0           Canary  = OFF           Auto-execution = OFF
GE-04                   = NOT AUTHORIZED
V3.6.6 Freeze           = NOT AUTHORIZED     V3.6.6 Production Attestation = NOT AUTHORIZED
Evidence Execution      = NOT AUTHORIZED     Evidence Seal (Key 3) = NOT AUTHORIZED
Key 2 seal artifact     = UNCHANGED（35040e5e…09e5）
主分支可达性             = PENDING（仅载体分支；提交 4 / 5 未推送、未入 master）
```

> ⛔ 本证据包**不构成**任何生产授权；⛔ **不表示**生产已消费 Gen-1 决策；
> ⛔ **不主张**主分支可达性已达成。

*本证据包⛔ 不写入自身 sha256（自指悖论）；其指纹于交付清单外单列。*
*落点：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_EVIDENCE_BUNDLE_20261002.md`*
