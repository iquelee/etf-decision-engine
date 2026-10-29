# V6.0 打红自证报告（RED-PROOF REPORT）

**文档编号**：`WP-G1-EVIDENCE-CH-6.0-REDPROOF`
**状态**：🧪 **FREEZE PREPARATION 报告（2026-10-02）** ｜ ⛔ **非冻结件、⛔ 不构成任何授权**
**as-of**：2026-10-02（北京时间）
**授权依据**：owner 2026-10-02 裁定 —— **B1 = APPROVED** ／ **B2 = APPROVED** ／ **V6.0 FREEZE PREPARATION 自主授权**

**打红纪律（本报告全程遵守）**：
> 任何一个新门，都必须能**被定向变异打红**（变异 ⇒ 必翻转 ⇒ **逐字节还原** ⇒ 必复原）。
> ⛔ 只报「通过」不报「打红」的检查，视同**未验证**。

**被测对象**：`docs/gen1/GEN1_EVIDENCE_CONTRACT_V6_FREEZE_CANDIDATE_20261002.md`
　sha256 = `e93420a38a4b92c7c5eb577c4cf5af81e6d913dc22df361a1e981978efbef4b1`

---

## 一、六层打红总览

| 层 | 打红对象 | 变异数 | 命令 | 结果 |
|---|---|---|---|---|
| **L1 ★** | **V6.0 候选件本体**（内容断言套件） | **15** | `python v6_redproof.py` | ✅ **ALL PASS（20 PASS / 0 FAIL）** |
| L2 | R1-v2 独立性判据 | 9 | `node independence_discriminator_v2.js --red-proof` | ✅ `RED_PROOF = PASS` |
| L3 | §5.8 W1/W2 判别器 | 7 | `node checkpoint_discriminator.js --red-proof` | ✅ `CHECKPOINT_RED_PROOF = PASS` |
| L4 | R2 Trigger Registry | 7 | `node trigger_registry.js --reverse-proof` | ✅ `REGISTRY_REVERSE_PROOF = PASS` |
| L5 | 生成器补丁（2 个） | 4 + 3 | `python patch_gen_v6_contract{,_p2}.py` | ✅ `REVERSE_REBUILD = PASS` ×2 |
| L6 | B3 迁移方案（v5 语义必失败） | 4 | `python c1_capture_v6_migration_test.py` | ✅ **ALL PASS（24 PASS / 0 FAIL）** |

---

## 二、L1 ★ V6.0 候选件本体打红（最有分量的一层）

**方法（关键设计）**：断言逻辑（`v6_content_assertions.py`）与变异清单（`v6_redproof.py`）**分文件存放** ——
若把变异写进断言，等于**自己给自己出题**；分文件后本自证才有认识论意义。

**每条变异都必须同时满足两个条件**：① 被断言套件**检出**；② 其**逆变换逐字节还原**。

| # | 变异 | 检出的 FAIL 数 | 命中断言 | 逐字节还原 |
|---|---|---|---|---|
| `RP-01` | 删除 §3.4A 整节（独立性判据整体缺失） | 9 | `B-1` | ✅ |
| `RP-02` | W1 终点放宽 `23:30 → 23:59` | 1 | `D-1` | ✅ |
| `RP-03` | `first-window-wins` 改成 `last-window-wins` | 1 | `D-3` | ✅ |
| `RP-04` | §11 规则 2 版本位回退（造「v6.0 作废 v5.0」自指矛盾） | 2 | `E-4` | ✅ |
| `RP-05` | `R3` 裁定从 `OBSERVATION` 篡改为 `CONTRACT GAP` | 1 | `E-5` | ✅ |
| `RP-06` | 从 Trigger Registry 抹掉真实 trigger `realtime-5min` | 1 | `C-2` | ✅ |
| `RP-07` | `sufficiency_scope` 偷换为 `SUFFICIENT` | 1 | `B-6` | ✅ |
| `RP-08` | 计数规则「（+2，非 +1）」改成「（+1）」 | 1 | `B-8` | ✅ |
| `RP-09` | 冻结常量 `CLUSTER_GAP_DAYS` `10 → 0` | 1 | `B-4a` | ✅ |
| `RP-10` | 标记回退为 v5.0 历史语 `PRE-V5 DIAGNOSTIC`（禁语） | 2 | `E-7` | ✅ |
| `RP-11` | 制造重复标题 `### 变更日志### 变更日志` | 2 | `A-3` | ✅ |
| `RP-12` | 去掉 §5.8「可执行校验」对判别器的绑定 | 1 | `D-6` | ✅ |
| `RP-13` | 文档编号回退为 `WP-G1-EVIDENCE-CH-5.0`（禁语） | 2 | `E-1` | ✅ |
| `RP-14` | 删除 §5.6.3 Trigger Registry 小节 | 2 | `C-1` | ✅ |
| `RP-15` | 给 §3.4A 越权加一条 `I8`（7 条判据扩成 8 条） | 1 | `B-3` | ✅ |

**汇总**：`RP-16 全部 15 条变异均被检出 = 15/15` ✅ ／ `RP-17 逆变换逐字节还原 = 15/15` ✅

**基线与非干预**：
- `RP-00` 基线（未变异）**ALL PASS**（39 PASS / 0 FAIL）✅
- `RP-18` 全程**未写盘**：磁盘文件 sha256 == 基线 `e93420a3…f4b1` ✅
- `RP-19` 读回磁盘文件重新 **ALL PASS** ✅

**★ 打红反哺断言（记录一次真实修正）**：`RP-11` 首轮**未被** `A-3` 检出（只被禁语 `F-1` 兜住）——
因为 `### X### X` 在**行级**仍只是「一个标题」，标题文本去重抓不到。
⇒ 正确处置是**补强 `A-3`**（新增「行内未嵌入第二个标题标记」检测），
⛔ **不是**把期望改成 `F-1` 让它变绿。修正后 `RP-11` 由 `A-3` 检出。

---

## 三、L2 · R1-v2 独立性判据打红（9 变异）

`node independence_discriminator_v2.js --red-proof` ⇒ **`RED_PROOF = PASS`**

| 变异 | 期望翻转 | 结果 |
|---|---|---|
| `RP1a` 只屏蔽 C2（bundle_key 同一性） | 结论仍不独立，理由**换手**到 C6 | ✅ `SAME_DECISION_DATE_BUNDLE_KEY_COLLISION → SAME_EVENT_CLUSTER` |
| `RP1b` 同时屏蔽 C2 + C6 | 残差**换手**到 C7（第三条独立护栏） | ✅ `→ NO_INFORMATIVE_ROW` |
| `RP1c` 屏蔽 C2 + C6 且两侧 delta 非零 | 同数据日一对 run **翻为** `INDEPENDENT` | ✅ |
| `RP2` `CLUSTER_GAP_DAYS := 0` | `NEG-CLUSTER-1` `NOT_INDEPENDENT → INDEPENDENT` | ✅ |
| `RP3` 解除真实 08:00 run 的 promotion 失败 | `NEG-PROOF-1` `NOT_EVALUABLE → NOT_INDEPENDENT` | ✅ |
| `RP4` 逐字节还原后判据复原 | `NEG-FWD-1` `NOT_INDEPENDENT → NOT_INDEPENDENT` | ✅ |
| `RP5` 输入侧 provenance 缺载 | `POS-1.A` `INDEPENDENT → NOT_EVALUABLE`（C4a 可得性必须否决） | ✅ |
| `RP6` 屏蔽 C3（candidate identity） | `NEG-CANDSHA-1` `NOT_INDEPENDENT → INDEPENDENT` | ✅ |
| `RP7` trigger 改成未登记值 / 置空 | 结论**逐字不变**（证明 C8 非判据） | ✅ |

### 3.1 旧规则证伪（legacy-rule falsification）

`node independence_discriminator_v2.js --reverse-proof` ⇒ **`LEGACY_RULE_FALSIFIED = PASS`**

**旧规则**：`run_id 不同 ⇒ independent`。**必须被反例当场证伪**：

| case | 标准判据 | 旧规则 | 判决 |
|---|---|---|---|
| `NEG-FWD-1` | `NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` | `INDEPENDENT / LEGACY_RUN_ID_DIFFERS` | ⇒ **FALSIFIED** |
| `NEG-CANDSHA-1` | `NOT_INDEPENDENT / SAME_CANDIDATE_IDENTITY` | `INDEPENDENT / LEGACY_RUN_ID_DIFFERS` | ⇒ **FALSIFIED** |
| `NEG-PROOF-1`（解除 B 的 promotion 失败） | `NOT_INDEPENDENT / SAME_DECISION_DATE_BUNDLE_KEY_COLLISION` | `INDEPENDENT / LEGACY_RUN_ID_DIFFERS` | ⇒ **FALSIFIED** |

### 3.2 非干预自证（non-interference）

`node independence_discriminator_v2.js --non-interference` ⇒ **10 passed / 0 failed**

注入字段（7 个）：`trigger`、`candidate_content_sha`、`pointer_revision`、`input_hash`、`event_id`、`promotion_attempt`、`engine_version`
⇒ **全部 10 个 case 的裁决逐字不变** ⇒ 证明这些字段**不参与**独立性判据（与 §3.4A 排除清单一致）。

---

## 四、L3 · §5.8 W1/W2 判别器打红（7 变异）

`node checkpoint_discriminator.js --red-proof` ⇒ **`CHECKPOINT_RED_PROOF = PASS`**

| 变异 | 期望被检出 | 结果 |
|---|---|---|
| `RP-1` W1 终点 `23:30 → 23:31`（边界放宽） | `23:30` 由 OFF 变 W1 | ✅ |
| `RP-2` 删除 W2 窗口 | `CK-W2-0845` 由 W2 变 OFF | ✅ |
| `RP-3` 忘记 `first-window-wins`（`strict=false`） | bundles `1 → 2` | ✅ `good=1 / bad=2` |
| `RP-4` 周末守卫缺失 | 周末由 `WEEKEND` 变命中 | ✅ |
| `RP-5` W2 起点 `08:30 → 09:00` | `08:45` 由 W2 变 OFF | ✅ |
| `RP-6` `pinned_decision_date` 缺载 | 不得误判命中 | ✅ `DECISION_DATE_MISMATCH` |
| `RP-7` 逐字节还原夹具 | 全部检查重新 PASS | ✅ `windows_same=true / cross=true / capture=true` |

### 4.1 ★ 夹具指纹绑定（本轮新增 CK-BIND-1）

`node checkpoint_discriminator.js --binding` ⇒ **`BINDING = PASS`**

| 被校验对象 | 夹具登记的 sha256 | 磁盘实际 | 结果 |
|---|---|---|---|
| FROZEN V5.0 载体 | `4fb9463f…f55b` | 一致 | ✅ |
| V6.0 FREEZE CANDIDATE | `e93420a3…f4b1` | 一致 | ✅ |

**动机**：原判别器只 `console.log` 打印 B1/B2，**不校验**候选件指纹 ⇒ 夹具写成陈旧值**不会被发现**（= 静默陈旧，治理事故）。
补上绑定后，「改了契约忘同步夹具」**必然 FAIL**。本机制在补入过程中**当场拦下**了两次指纹漂移（`14fae758…` → `3118b6c0…` → `e93420a3…`）。

---

## 五、L4 · R2 Trigger Registry 反向证明（7 变异）

`node trigger_registry.js --reverse-proof` ⇒ **`REGISTRY_REVERSE_PROOF = PASS`**

| 变异 | 期望 | 结果 |
|---|---|---|
| `RP-A` Registry 遗漏真实 trigger `intelExtract-30min`（= **v5.0 §5.6 表的原始缺陷**） | FAIL | ✅ `["intelExtract-30min"]` |
| `RP-B` 谎报 `realtime-5min` 写八源（实际只写 `etf_daily` / `fetch_log`） | FAIL | ✅ 已检出 |
| `RP-C` 塞入云端不存在的幽灵 trigger `ghost-0000` | FAIL | ✅ `["ghost-0000"]` |
| `RP-D` 把窗口挪回 `[22:00,22:30)` / `[08:00,08:30)` | FAIL（必含八源写入者） | ✅ `dailyFetch-2200` / `gen1-eod-weekdays-2220` / `dailyPipeline-0800` |
| `RP-E` 抹掉被排除 trigger 的 `exclusion_reason` | FAIL | ✅ 已检出 |
| `RP-F` 删掉 W2-0800 链的入口 trigger 登记 | FAIL | ✅ `ENTRY_TRIGGER_NOT_REGISTERED` |
| `RP-G` 逐字节还原原 Registry | 全部检查重新 PASS | ✅ |

**`RP-A` 与 `RP-D` 的战略意义**：它们**复现的正是 v5.0 的原始缺陷**（遗漏 trigger 族）——
⇒ 证明本 Registry 校验器**有能力**在当初拦下 `CD-06` / `CD-07`，而不是事后补一张「看起来完整」的表。

---

## 六、L5 · 生成器补丁反向重建（7 处）

两个补丁脚本各自内置**反向重建**：由「新→旧」反推替换对，必须与打补丁前**逐字节相等**。

| 补丁 | 修改项 | 反向重建 |
|---|---|---|
| `patch_gen_v6_contract.py` | N1 §9.4 尾注空行 / N2 §11 前 `---` / N3 §11 规则 1 空白 / N4 `### 变更日志` 重复 | ✅ `REVERSE_REBUILD = PASS` |
| `patch_gen_v6_contract_p2.py` | P1 §5.8 补「可执行校验」/ P2 变更日志 ⑪ / P3 §13.2 补 5 行 | ✅ `REVERSE_REBUILD = PASS` |

**生成器自身的两道门**：① 输出纯 LF 断言；② `V5 unchanged` 断言（实测 `True` ⇒ 冻结载体零改动）。

---

## 七、L6 · B3 迁移方案：v5.0 语义「必然失败」的反向证明

`python c1_capture_v6_migration_test.py` ⇒ **ALL PASS（24 PASS / 0 FAIL）**

| 断言 | 内容 | 结果 |
|---|---|---|
| 反向证明核心 | **v5.0 单窗口语义在 W2（2026-10-02 `08:45`）判 `False`** ⇒ 必然**丢样** | ✅ `v5=False` |
| 对照 | v6.0 同一时刻判 `ok / W2` | ✅ |
| 对照 | 两侧在 W1（`22:45`）一致判命中 | ✅ |
| 边界矩阵 | 11 项（含 `[start, end)` 半开、周末、跨日）全部符合预期 | ✅ |
| `first-window-wins` | 3 例（W1 胜出 ⇒ 仅 1 bundle ／ W1 不满足 ⇒ W2 兜底仅 1 bundle ／ 全不满足 ⇒ FAIL-CLOSED 0 bundle） | ✅ |
| ⛔ **未施加** | `c1_capture.py` sha256 前后一致 `dd2ea8b0…`；磁盘仍无 v6 常量 | ✅ |

⇒ B3「迁移方案**已设计并测试**，但**未写入**正式采集工具」由**可执行证据**支撑（⛔ 非口头承诺）。

---

## 八、打红汇总

```text
层  打红对象                          变异   结果
────────────────────────────────────────────────────────────────
L1  V6.0 候选件本体（内容断言）          15    ✅ 15/15 检出 · 15/15 逐字节还原
L2  R1-v2 独立性判据                     9    ✅ RED_PROOF = PASS
    R1-v2 旧规则证伪                     3    ✅ LEGACY_RULE_FALSIFIED = PASS
    R1-v2 非干预（7 字段注入 × 10 case）  70    ✅ 10/0
L3  §5.8 W1/W2 判别器                    7    ✅ CHECKPOINT_RED_PROOF = PASS
    §5.8 夹具指纹绑定 CK-BIND-1           1    ✅ BINDING = PASS（当场拦下 2 次指纹漂移）
L4  R2 Trigger Registry                  7    ✅ REGISTRY_REVERSE_PROOF = PASS（含 2 条复现 v5.0 原始缺陷）
L5  生成器补丁反向重建                    7    ✅ REVERSE_REBUILD = PASS ×2
L6  B3 迁移方案（v5 语义必失败）           4    ✅ 24/0
────────────────────────────────────────────────────────────────
合计                                    123    ✅ 全部 PASS
```

**本报告不含任何「只报通过、未打红」的门。**
⛔ 本报告**不**冻结任何东西；⛔ **未** commit、**未**建 tag、**未** push。
**下一闸门** = `V6.0 FREEZE`（须 owner **单独授权**）。
