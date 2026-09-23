# Freeze Seal 绑定对象裁定（`source_sha256`）

**文档性质**：**裁定记录（Decision Record）** —— 定义 Key 2 四项绑定中 `source_sha256` 的**对象与算法**。
**裁定日期**：2026-09-22（owner 裁定）
**as-of 值复算日**：2026-09-22
**依据**：`GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.1 **Key 2**；`docs/gen1/GEN1_PR43_READONLY_AUDIT_20260916.md` **N1**；`docs/gen1/WP-G1-GE-02_IMPLEMENTATION_NOTE.md:244`

```text
DECISION                          source_sha256 的对象 = C1
SCOPE                             仅「定值 + 定算法」；⛔ 不含任何代码/制品/部署改动
DOWNSTREAM                        GE-04 晋升包（②–④ 留待彼时一并执行）
```

---

## 1. 问题

`GEN1_GUARDED_EFFECTIVE_CHARTER.md` §3.1 Key 2 要求 Freeze Seal 绑定四项
（`source_sha256` / `model_sha256` / `threshold_version` / `contract_version`）与运行期实读**逐项一致**。

但**全仓不存在 `source_sha256` 的语义定义** —— 只有测试用 `'s'.repeat(64)` 占位。
⇒ 必须先回答「**hash 什么**」，否则无法填制品、也无法在运行期注入。

---

## 2. 裁定

```text
source_sha256 的对象 = C1
  集合   src/common/utils/gen1-*.js
  算法   sha256lf（CRLF→LF 后取 sha256；与 scripts/gen-gen1-pipeline-lock.js:20-23 同约定）
  聚合   对按路径升序的每个文件：update(relpath) + 0x00 + update(hex(sha256lf(file))) + '\n'
        再对整体取 sha256
```

**as-of 2026-09-22 的裁定值**：

```text
source_sha256 = 4fadfe1a6b93c0896c8f50984f0b13b2f14c8798ba0bc9a6fda7f9f026119e82
（集合：src/common/utils/gen1-*.js，共 17 个文件）
```

---

## 3. 为何选 C1（被否候选与理由）

| 候选 | 对象 | as-of 值 | 文件数 | 判定 |
|---|---|---|---|---|
| **C1** ✅ | `src/common/utils/gen1-*.js` | `4fadfe1a…9e82` | 17 | **采纳** |
| C2 | `src/common/**`（全） | `078187e2…d5548` | 64 | ⛔ 否 —— 含大量**非 Gen-1** 模块，任何无关改动都会误触 Key 2 失效 |
| C3 | `cloudfunctions/runDecisionEngine/**` | `bf731be3…e7331` | 1 | ⛔ 否 —— 只覆盖**单一入口文件**，而 Gen-1 逻辑主体在 `src/common/utils/` ⇒ 覆盖不足 |
| C4 | `dist-functions/runDecisionEngine/**` | `724cc980…fd8f` | 62 | ⛔ 否 —— 是**构建产物**，随构建变动 ⇒ 与「冻结」语义**直接冲突** |

**C1 的理由**：粒度与 Key 2 的意图最匹配 ——
「**Gen-1 的逻辑本体**」（权限状态机、安全许可、反事实、overlay、封印读取、域许可、健康态、执行边界等）
全部落在 `src/common/utils/gen1-*.js` 内，且**不包含**与 Gen-1 无关的模块。

> ⚠️ 已核：`model_sha256` 无需裁定 —— 已有权威冻结值
> `d5e667c66a5f888bb5489b8adcad9e6a141bfbcf0006a955d6ad40e269a7e712`
> （`ml/manifests/GEN1_RUNTIME_BUNDLE.json`，sealed 2026-09-10）。

---

## 4. ★ 重算时机规则（**必须与裁定同时生效**，否则绑定会漂移）

```text
R1  仅在 **GE-04 晋升时**重算 source_sha256 并重新冻结。
R2  晋升后，C1 集合内的文件**视为冻结**：⛔ 不得修改（含注释/格式）。
     任何修改 ⇒ 哈希变化 ⇒ Key 2 立即 MISMATCH ⇒ effective_guarded 恒 false。
R3  需要变更 Gen-1 逻辑时，走**新契约/新版本**路径（与 `GEN1_IMMUTABLE_LOCK.json`
     的「Challenge via new model_id only」同精神），⛔ 不得原地改。
R4  重算必须记录：裁定值 + 集合清单（17 文件）+ 复算命令 + 复算时点。
```

---

## 5. 复算方法（任何人可独立复现）

```python
import glob, hashlib, os
G = "<repo>"
def lf(p): return open(p, "rb").read().replace(b"\r\n", b"\n")
h = hashlib.sha256()
for p in sorted(glob.glob(os.path.join(G, "src/common/utils/gen1-*.js"))):
    rel = os.path.relpath(p, G).replace("\\", "/")
    h.update(rel.encode()); h.update(b"\x00")
    h.update(hashlib.sha256(lf(p)).hexdigest().encode()); h.update(b"\n")
print(h.hexdigest())
```

脚本留档：`_evidence-capture-tool/source_sha_candidates.py`（同时输出 C1–C4 四个候选）

---

## 6. ⛔ 本裁定**不**授权的事

| # | 动作 | 状态 |
|---|---|---|
| ② | 改 `cloudfunctions/runDecisionEngine/index.js` 注入 `source_sha256` / `model_sha256` | ⛔ **未授权** |
| ③ | 部署该改动 | ⛔ **未授权** |
| ④ | 填 `ml/manifests/GEN1_GUARDED_EFFECTIVE_FREEZE.json` 四项 + 置 `status = APPROVED` | ⛔ **未授权** |
| ⑤ | 部署后复核 `freeze_binding_*` | 待 ②–④ 完成后 |

⇒ **②–④ 属 GE-04 晋升包内容**，按 2026-09-16 裁定（`GEN1_PR43_READONLY_AUDIT` N1：**GE-04 prerequisite / 非阻塞**）
在晋升时一并执行。⛔ 现在执行不会解锁任何东西 ——
Key 3（Evidence Seal）同样未通过，`effective_guarded` 无论如何都是 false。

---

## 7. 当前绑定状态（as-of 2026-09-22，未变）

| 项 | claimed（制品） | observed（运行期） | 结果 |
|---|---|---|---|
| `contract_version` | `null` → 待填 | `WP-G1-GE-CH-1.0` | 待 ④ |
| `threshold_version` | `null` → 待填 | `shadow-threshold-v1` | 待 ④ |
| `model_sha256` | `null` → 待填 | **缺**（运行期不读） | ⛔ UNVERIFIABLE |
| `source_sha256` | `null` → 待填 | **缺**（运行期不注入） | ⛔ UNVERIFIABLE |

⇒ `bindings_status = INCOMPLETE`、`status = PENDING` —— **与本裁定前一致**（本裁定只定义对象，不改变运行期行为）。

---

*本文件为**治理裁定记录**。修改须走新裁定，⛔ 不得原地改（与 R2/R3 精神一致）。*
