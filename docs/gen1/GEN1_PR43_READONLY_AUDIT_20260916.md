# PR #43 只读代码审计（WP-G1-GE-02 Dormant Implementation）

**文档编号**：`GEN1-PR43-AUDIT-1.0`
**性质**：**只读**审计报告 —— 不修改、不评论、不合并 #43
**as-of**：2026-09-16 14:02:37 +0800（实读时刻）
**审计对象**：`origin/feat/wp-g1-ge-02-dormant` = `b7247f9`
**基线**：`git merge-base` = `6793d7f`（相对 `origin/master`，本次实读）
**规模**：19 files changed, **+2226 / −26**，2 个 commit（`b6da0a3` feat + `b7247f9` fix）

---

## 0. 一句话结论

> **未发现技术性 merge blocker。** 19 个文件全部落在裁决书授权的 **P1/P2/P3** 面内，
> 六条硬护栏 A–F 逐条有实现与可执行守卫；**实测**门禁 25/25、Immutable 23/23、
> CANARY before/after 平价 38/38 全部通过，且与 base 树对照证实无新增失败。
>
> 发现 **4 项需证明/已自登记**（均非阻塞）+ **2 项跨文档口径张力**（其中 1 项属我们 v1.2 快照、1 项由本 PR 引入的文档漂移）。**超范围项：0**。
>
> **归档（2026-09-16，第四轮 ⑧）**：C1 裁定 = **(a) 登记为 E22**（`ERRATA DEFERRED`；不改冻结章程、不 amend `a8bf76d`、不改 #43）；
> N1 裁定 = **GE-04 prerequisite / 非阻塞**（不在 #43 源码内修）。
> ⇒ **⑦ = PASS**、**技术性 merge blocker = NONE FOUND**；`P2` 仍为 `P2_PENDING_PR_RELEASE`。裁定回填见 §9。

---

## 1. 审计方法与取证（只读）

**关键点：全程未写 `.git`** —— 用 `git archive` 展开而非 `git worktree add`（后者会写
`.git/worktrees/` 元数据）。

```bash
git archive origin/feat/wp-g1-ge-02-dormant | tar -x -C <TEMP>/g1-ge02-audit-tree
git archive 6793d7f                             | tar -x -C <TEMP>/g1-ge02-base-tree   # 对照组
git grep -n <pattern> origin/feat/wp-g1-ge-02-dormant -- <glob>   # 跨文件只读检索，不 checkout
```

| # | 取证动作 | 命令 | 结果 |
|---|---|---|---|
| E1 | Immutable 真 SHA 锁 | `node scripts/verify-immutable.js` | **[PASS] 23/23**（Gen-1 frozen×3 / V3.6.1×2 / GEN2 bundle / immutable_set / 3 lock） |
| E2 | Gen-1 生产门禁 G1-A~Y | `node scripts/gen1-production-gates.js` | **[PASS] 25/25** |
| E3 | CANARY before/after 逐字段平价 | `GE02_BASE_TREE=<base>/src/common/utils node scripts/gen1-guarded-parity-local.js` | **[PASS] 38/38 场景**；overlay 新增 16 字段全部 dormant 取值 |
| E4 | 完整链路（对照实验） | `node scripts/test-all.js` ×2（HEAD 树 / base 树） | HEAD **47/49**；base **43/45**；**失败项集合完全相同**（见 §1.1） |
| E5 | 冻结清单拦截真实存在 | 读 `cloudfunctions/adminGateway/index.js` | `FROZEN_PARAM_KEYS.indexOf(key) >= 0 → 403`，**base 即存在**（#43 未改该文件） |
| E6 | `gen1_authority` 全局引用面 | `git grep -ln gen1_authority` | 无一在 `web/`；**无前端枚举需同步** |

### 1.1 对照实验（排除环境噪声）

两个失败项**均在 Gen-2 Python 阶段**，且 base 树同样失败：

```text
Stage B  unittest discover ml/gen2/tests   → errors=19
Stage D  Cross-language Parity（Python↔Node）→ ModuleNotFoundError: pandas
```

⇒ 系**本机 Python 缺 pandas/numpy** 所致，**与 #43 无关**（#43 为纯 Node 改动）。
**净效应**：汇总项 45 → 49，**新增 4 项全 PASS，新增失败 0**。
Stage A（Node 单测，GE-02 新测试所在）**全绿**，含 3 个新测试文件逐项 PASS。

---

## 2. 分类一：符合边界（PASS）

逐条对齐《WP-G1-GE-RULING_20260916》裁决 9 项 + 章程 §8 六护栏 A–F。

| 项 | 章程/裁决要求 | 实现 | 守卫（可执行） |
|---|---|---|---|
| 状态机 | **插入**一格，不推翻重做 | `AUTHORITY_RANK`：前四档 0–3 **不变**，新增 `GUARDED_EFFECTIVE:4`，`PRODUCTION: 4→5` | `gen1-guarded-effective-authority.test.js` 逐档断言 + rank 严格单调 |
| 语义 | `GUARDED_EFFECTIVE` ≠ 生产写权限 | `guarded_effective_authorized` 仅 = rank ≥ 4；注释逐字声明「≠ 生产写权限」 | 全档 `production_write/auto_execution === false` 断言 |
| 护栏 C/D | Gen-1 永不写生产字段 | `gen1-overlay.js` **硬还原** `out.final_target = prodTarget` 原样保留；新增第 4 参**只附加审计字段** | overlay 静态守卫 + 运行期 `verifyProductionNoop` 抛错 + **投毒用例**（审计对象带 `final_target:99` 仍不改写） |
| 护栏 E | V3/Safety Core 唯一裁决者 | 无任何路径改写 `final_target` | 同上 |
| 护栏 F | selector 永远选 baseline | `selectGuardedResult()` **无条件** BASELINE，含 `effectiveGuarded=true` + 传入 guarded 结果；传引用相等断言 + 抛错兜底 | 4 类输入断言 + 主链 `authoritative_source !== 'BASELINE'` 即抛错 |
| 护栏 B | 单靠 `param_config` 不能激活 | 三钥匙 + 运行时叠加门；生产制品 `PENDING` | `gen1-guarded-effective-gates.test.js` D 段：`gen1_authority=GUARDED_EFFECTIVE` + 生产制品 ⇒ `effective_guarded=false` |
| §3.4 P0 | `gen1_authority` 入冻结清单 | `FROZEN_PARAM_KEYS` 6 → 7 项 | `gen1-authority-frozen-param.test.js`：成员 + 数量 + **后台拦截真实存在** + 部署链路 + **promotion 通道不得消失** |
| §6.3 | `ml_effective` 单向派生 | `ml_effective: guardedEffectiveActive`（runtime_status + 顶层两处） | 静态守卫：禁止硬编码字面量、禁止反向派生 |
| §9 | Gen-2 隔离 | 未触碰 `ml/gen2/**` | E1 实证 23/23 逐位不变 + 主链静态断言 `!/ml\/gen2/` |
| §5 | Evidence Gate 硬前置 | 证据制品 `PENDING` / `independent_events=0` / `evidence_positive=false` | 测试**硬断言**不得 APPROVED / PASS / positive |

**Fail-closed 加固（超出最低要求，方向正确）**：
- Health 门 `gate_status` **缺失/空串/null 一律不视为 ACTIVE**（复审 P0-1 修复），且**不复用**审计信封里
  `hg.gate_status || 'ACTIVE'` 的展示性默认值 —— 该默认值契约逐字节未动。
- Evidence 门除 `status=PASS` 外**必须** `evidence_positive === true`（复审 P0-2）；字符串 `'true'` / `1` 一律不通过。
- `authorityAllows` 新增防御性加固：`rankOf(authority) >= PRODUCTION ⇒ 一律 false`（绕过 `resolveAuthority` 直传也不授权）。
- 采纳计数器只在「selector=GUARDED **且** `gen1_adopted===true`」时 +1，**结构性恒 0**。
- 我实读确认 `authored` 语义正确：`authorityAllows('CANARY','CANARY_OVERRIDE')=true`、`GUARDED_EFFECTIVE` 兼容既有能力。

---

## 3. 分类二：需证明 / 已自登记（非阻塞）

| # | 项 | 事实 | 判断 |
|---|---|---|---|
| N1 | **冻结绑定观测源缺失** | `index.js` 只注入 `contract_version` / `threshold_version`；`source_sha256` / `model_sha256` **恒缺** ⇒ 绑定恒 `FREEZE_SEAL_BINDING_UNVERIFIABLE` ⇒ 即使制品改为 APPROVED 也**无法**通过 | 实现说明 §2/§6 已**自登记**为 GE-04 硬前置。⚠️ 但 `build-cloudfunctions.js` 注释称「使 GE-04 的晋升路径真实可用」**措辞过强** —— 实际只做到「制品可得」，绑定仍不可验。✅ **裁定（2026-09-16）：GE-04 prerequisite / 非阻塞** —— ⛔ 不在 #43 源码内修该注释、⛔ 不为一句注释重跑整套 acceptance；准确含义登记为「确保 Freeze/Evidence seal 制品进入构建产物，**为 GE-04 提供必要但不充分的基础设施**」（缺权威 `source SHA` / `model SHA` 运行期观测源 ⇒ GE-04 实际仍不可激活） |
| N2 | **`gen1_guarded_effective_invocations` 口径** | 章程 §6.2 写「**累计**真实采纳次数」；实现写的是**本轮**计数 | GE-02 下两者都是 0，且已自登记为 GE-03 锚点（须跨轮累计 + 落库成功后计数）。**登记即可，不必现在改** |
| N3 | **domain 门字面与章程不完全逐字一致** | 章程 §3.3 只写 `domain_ok`；实现为 `domainPermission==='ALLOW' && domainStatus==='IN_DOMAIN'` | 已核 `gen1-domain-permission.js:58-61`：`IN_DOMAIN ⇒ ALLOW` **一对一** ⇒ **语义等价、无实际偏差**。仅记录 |
| N4 | **schema 登记不完整（低）** | overlay 往 `decision_result` 写 **16** 个新审计字段，schema 的 `decision_result` 只登记 **14**；`gen1_guarded_freeze_seal_status` / `..._evidence_seal_status` 仅登记在 `runtime_status`（`schema.js:567,569`） | 已核 `validateDoc`（`schema.js:670+`）**只遍历已声明字段、不拒绝未知字段** ⇒ **不影响运行**。但削弱字段可发现性与契约完整性。建议随 GE-03 一并补齐 |

---

## 4. 分类三：冲突（跨文档口径；**裁定已回填，见 §9**）

### C1（张力在 **v1.2 快照**，非 #43 缺陷）

| 来源 | 表述 |
|---|---|
| 我们刚冻结的 `a8bf76d` §0.2 | `ml_effective` = 「Gen-1 是否**对正式生产决策生效**」 |
| GE-01 章程 §6.3（🔒 FROZEN，`WP-G1-GE-CH-1.0`） | `ml_effective = gen1_guarded_effective_active`（legacy/summary alias） |
| 裁决书 §2.5 | 「`ml_effective` 只保留为 legacy/summary alias，**不得**成为新的 Authority 真相源」 |

**分歧点**：`guarded_effective_active` 的语义是「**受控阶段输入资格成立**」。
在**中间态**（资格成立、但 selector 仍是 BASELINE、`final_target` 未变）下，
两处口径会给出**不同答案**：章程口径 `true`，快照口径仍应为 `false`。

- **#43 是忠实实现冻结章程**，因此这**不是** #43 的缺陷；问题出在我们 v1.2 快照的措辞
  （落笔早于 GE-01 冻结 alias 语义）。
- **当前张力是潜在而非现实**：线上封印 `PENDING` ⇒ `active=false` ⇒ 两处都是 `false`。
- 选项：
  - **(a) 登记为 E 系列 errata，下一 docs 批次处理**（推荐：不打断 ⑦/⑧ 节奏，且符合「勘误与状态快照两条通道」）；
  - **(b) 现在给 §0.2 补 scope 注记**（一行，需新 commit，会动 `a8bf76d` 之后的批次）；
  - **(c) 认定二者同义、不处理**（我不建议：中间态确会分叉，违你既定的「不同轴不得合成一句」）。
- ✅ **裁定（2026-09-16）：(a)** —— 已登记为 **E22**（`GEN1_DOC_ERRATA_20260916.md` §2，归入**批次 7**）。
  边界：⛔ 不改 **FROZEN** 章程（章程是**正确一侧**）、⛔ 不 amend `a8bf76d`、⛔ 不改 #43、⛔ 不当成 #43 的技术缺陷。
  收紧后的释义（待下一 docs 批次落地）：
  `ml_effective` = Gen-1 Guarded Effective **运行门是否 active 的 legacy / summary alias**；
  **是否真正进入正式决策结果**应看 `gen1_adopted` / `gen1_guarded_selector_source` / `decision_source`，**不能只看 `ml_effective`**。
  典型中间态（四者同时成立）：`gen1_guarded_effective_active=true` ∧ `ml_effective=true` ∧ `gen1_guarded_selector_source=BASELINE` ∧ `gen1_adopted=false`。

### C2（**由本 PR 引入**的文档漂移）

`docs/gen1/GEN1_CURRENT_STATE_20260910.md:83` 枚举：

```text
FROZEN_PARAM_KEYS（后台禁改）：volume_ratio_mild, tech_sector_max, ml_fast_path_enabled,
                              ml_challenger_model_id, ml_gen1_frozen, ml_shadow_bundle_id
```

**#43 未同步更新这一行** ⇒ 合入后该行**立即过期**（实为 7 项）。属 #43 引入的遗漏项，非阻塞。

> 附：`VERSION.txt:27` 写「仅 2 key」是**既存**过期（本 PR 之前就错），与 #43 无关，一并登记。

---

## 5. 分类四：超范围

**无。** 19 个文件全部落在 WP-G1-GE-02 授权面内：

```text
src/common/            5 个（authority / constants / schema / overlay / safety-permission + 2 新守卫件）
cloudfunctions/        1 个（runDecisionEngine）
scripts/               4 个（build / gates / test-all / 新平价工具）
tests/                 4 个（全部新增）
ml/manifests/          2 个（两份 PENDING 封印制品）
docs/gen1/             1 个（实现说明）
```

未出现：`ml/gen2/**`、`web/`、`.github/`、生产配置、`param_config` 写路径、Authority 线上写、
`FROZEN_PARAM_KEYS` 之外的冻结对象、`GEN1_EVIDENCE_CONTRACT` v1.0 正文。

---

## 6. 分类五：merge blocker

**未发现技术性 blocker。** 三道技术闸（E1/E2/E3）全过，CI 配置未被本 PR 改动，
对照实验证明无新增失败。

唯一阻断项为**治理级**：

1. **per-PR 放行本身** —— 按你既定规则，P1/P2/P3 有阶段级许可，但**每个实现 PR 需单独放行**；
2. ✅ **C1 已裁定为 (a)：延后到下一 docs 批次（登记 E22）** ⇒ **不构成放行前条件**；本节阻断项现仅剩第 1 条。

---

## 7. 本审计的动作边界（**只读**）

| 维度 | 边界 |
|---|---|
| 读取方式 | `git archive` 展开 + `git grep` 只读检索；**未 checkout**、**未写 `.git`** |
| 对 #43 的操作 | **无** —— 不改其代码、不评论、不 approve、不 merge |
| 仓库写入 | **无**（本报告为**未跟踪草稿**，不入库） |
| 生产侧 | 不写 `param_config`、不部署、不改 Authority、不碰 `FROZEN_PARAM_KEYS`、不动 Gen-2 |

## 8. 本轮实际写入范围（四块式）

```text
ETF 仓库：
- Git 跟踪文件：零修改
- Git 历史/分支/远端：零修改
- 未跟踪本地草稿：GEN1_PR43_READONLY_AUDIT_20260916.md 新增（仅本地，不入库）
                  GEN1_DOC_ERRATA_20260916.md 存在但本轮未编辑
其他本机文件：
- WorkBuddy 技能文档有新增/修改
- 本地记忆文件有修改
- %TEMP% 下两份 git archive 展开树（不含 .git，可随时删除）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
```

---

## 9. 裁定回填与归档（第四轮 ⑧，2026-09-16）

§8 是 **⑦ 轮**的写入记录；本节只记录**裁定回填**与**归档口径**。

| 项 | 裁定 | 落地 |
|---|---|---|
| **C1**（`ml_effective` 口径张力） | ✅ **(a) 登记为 E 系列 errata** | → **E22**（`GEN1_DOC_ERRATA_20260916.md` §2），归入**批次 7**；⛔ 不改 FROZEN 章程、⛔ 不 amend `a8bf76d`、⛔ 不改 #43 |
| **C2**（`GEN1_CURRENT_STATE_20260910.md:83` 冻结清单仍 6 项） | ✅ **非 blocker**；裁定 = **文档状态同步处理，不改历史快照** | 已登记为 **E23**（→ `GEN1_DOC_ERRATA_20260916.md` §2），归入**批次 7**；⛔ 不得改写该 2026-09-10 快照正文 |
| **N1**（冻结绑定观测源缺失 + 注释措辞过强） | ✅ **GE-04 prerequisite / 非阻塞** | ⛔ 不在 #43 源码内修；⛔ 不为一句注释重跑 acceptance |
| **N2 / N3 / N4** | ✅ 登记即可，非阻塞 | N4 建议随 GE-03 补齐 schema 登记 |

```text
⑦ PR #43 READ-ONLY AUDIT        PASS
Technical merge blocker         NONE FOUND
C1                              ERRATA DEFERRED（→ E22，批次 7）
N1                              GE-04 PREREQUISITE / NON-BLOCKING
P2 release                      STILL P2_PENDING_PR_RELEASE
```

**第四轮（⑧）实际写入范围（四块式）**：

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d；
    远端 master=2e8cb7d / #43=b7247f9 / clarify 分支=82debe8 逐位未变）
- 未跟踪本地草稿：GEN1_PR43_READONLY_AUDIT_20260916.md 有修改（回填 C1/C2/N1 裁定 + 本节）；
    GEN1_DOC_ERRATA_20260916.md 有修改（新增 E22 + 批次 7 + 归属行 + §6.4）；
    GEN1_P2_RELEASE_GATE_20260916.md 新增（仅本地，不入库）
其他本机文件：
- WorkBuddy 技能文档有修改（gen1-doc-errata-dedup、gen1-pr-readonly-audit）
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
- %TEMP% 展开树：g1-p2-gate-tree（候选树）、g1-ge02-audit-tree、g1-ge02-base-tree（不含 .git）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
```

---

## 10. ⑧ 最终裁定回填与归档（第五轮，2026-09-16）

§9 记录的是**第四轮**（C1/C2/N1 裁定回填）；本节记录用户对 **⑧ P2 Release Gate** 的裁定结果。

```text
⑧ P2 RELEASE GATE              PASS
CURRENT_MASTER_COMPATIBILITY   PASS
GE-02 ACCEPTANCE               PASS
TECHNICAL MERGE BLOCKER        NONE FOUND
P2 RELEASE STATUS              READY_FOR_OWNER_DECISION
MERGE AUTHORIZATION            NOT YET GRANTED        ← 待一次性 owner override
P2 release                     STILL P2_PENDING_PR_RELEASE
```

**为何仍停在 `NOT YET GRANTED`**：本 PR 含 `FROZEN_PARAM_KEYS` **6 → 7**（新增 `gen1_authority`），
与最初给本任务的硬边界（不得修改 `gen1_authority` / `FROZEN_PARAM_KEYS` / `lock` / `immutable_set`）正面相遇。
**不以「后续讨论似乎默认接受」反推边界失效** ⇒ 须由所有人显式作**一次性例外**。
详情与放行语句模板见 `GEN1_P2_RELEASE_GATE_20260916.md` §9。

**非阻塞项最终归属**（与上表 §9 的差异已就地更新，C2 一行见上）：

| 项 | 裁定 | 归属 |
|---|---|---|
| C1 / E22 | 非 P2 blocker | 下一 docs 勘误批次（批次 7） |
| C2 / E23 | 非 blocker | 文档状态同步处理，**不改历史快照** |
| N1 | 非 blocker | **GE-04 硬前置** |
| N2 | 非 blocker | **GE-03 前 / 期间**统一 |
| N3 | **接受** | 已证明语义等价 |
| N4 | 非 blocker | **GE-03 审计字段完善时**处理 |
| 两个 Python/`pandas` failure | 非 blocker | base 同样失败，与 #43 无关 |

**第五轮实际写入范围（四块式）**：

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d；
    远端 master=2e8cb7d / #43=b7247f9 / clarify 分支=82debe8 逐位未变）
- 未跟踪本地草稿：本文件有修改（§9 C2 裁定 + 本节）；
    GEN1_DOC_ERRATA_20260916.md 有修改（新增 E23 + 批次 7 + 归属表 + §6.5）；
    GEN1_P2_RELEASE_GATE_20260916.md 有修改（§0 裁定后状态 + §8–§12）
其他本机文件：
- WorkBuddy 技能文档有修改（gen1-pr-readonly-audit、gen1-doc-errata-dedup）
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
```

---

## 11. Owner release 回填（第六轮，2026-09-16）

用户在 ⑧ 归档后发布**一次性 owner release**，本 PR 的 `FROZEN_PARAM_KEYS` 变更获授权。
放行原话与五要点逐条比对见 `GEN1_P2_RELEASE_GATE_20260916.md` **§9.2**（本报告不重复抄录，避免两处漂移）。

```text
MERGE AUTHORIZATION            GRANTED               （一次性例外，仅限本 PR）
⑧ 轮时的 NOT YET GRANTED       保留为历史留痕（见 §10）
P2 release                     P2_PENDING_PR_RELEASE（截至放行记录 as-of；§11 Attestation 全 PASS 后改判）
```

**放行附带约束（须在合并动作层面遵守）**：

```text
⛔ 不得 rebase、⛔ 不得点 Update branch、⛔ 不得 squash
✅ 以 merge commit 合并，基线锁定为已审计对 master = 2e8cb7d + #43 head = b7247f9
✅ 合并完成后先跑 Post-Merge Attestation，PASS 后才可把 P2 改判为 P2_COMPLETE_DORMANT
```

**⚠️ 三处事实更正/实证（前两处方向相反、均已撤回；第三处为实证）**：上一轮本报告与门禁文档曾写「本机令牌为只读 ⇒ merge 必须由所有人在 Web UI 执行」。
该结论的**唯一依据**是「细粒度令牌无 `X-OAuth-Scopes` 头」——**该依据不成立**（细粒度令牌从不发送此头 ⇒ 其缺省不构成只读证据）。
⚠️ **「结论对 ≠ 推理对」**：该「只读」**结论后来确被证实为真**，但其**依据仍属错误**，不得据错误依据重写推导链。
本轮初稿又据 `permissions = {admin:true, maintain:true, push:true, triage:true, pull:true}`
反推「**具备仓库写权限**」——**同样超出证据**（该对象是**用户在该仓库的角色**，与令牌被授予的权限无关）；该断言**随后被 `403` 实证证否**。
⇒ **末次实证（2026-09-16T15:2x）：写已证否** —— 执行**用户授权的**合并动作返回
`403 Resource not accessible by personal access token`。**「写被证否」的唯一合法来源就是这种「已被授权的写动作」**，
⛔ **不得**用「故意发写请求探测」取得（详见门禁文档 §9.1）。

**执行者结论（用户 2026-09-16T15:21 授权变更）**：用户**废止「方案 A」**，改为**由 agent 代合**。
⇒ agent 已按授权**实际执行** `PUT /repos/iquelee/etf-decision-engine/pulls/43/merge`
（`merge_method=merge` + `sha=b7247f9…` 锁定已审计 head）⇒ **被 `403` 阻却，合并未发生**。
⇒ **当前唯一可执行路径 = 用户在 Web UI 点 *Create a merge commit***；若先补
`Pull requests: RW` + `Contents: RW`，agent 即可代合（详见门禁文档 §9.3）。
⚠️ 因 `mergeable_state=behind`，页面上会出现 `Update branch` 按钮 —— **不要点它**。

**放行前实时复核（2026-09-16T14:56:37+0800）**：`master` 与 `#43 head` 逐位未变；
PR `state=open`、`merged=false`、`head.sha=b7247f9…`、`mergeable=true`、`changed_files=19`。
**合并尝试后复核（2026-09-16T15:2x+0800）**：`merged=false`、`merged_at=null` ⇒ **确认 `403` 未产生任何远端变更**。

**第六轮实际写入范围（四块式）**：

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d clean；
    远端 master=2e8cb7d / #43=b7247f9 / clarify 分支=82debe8 逐位未变）
- 未跟踪本地草稿：本文件有修改（本节）；
    GEN1_P2_RELEASE_GATE_20260916.md 有修改（§0.b 放行后状态 + §8.2 + §9.1 更正 + §9.2/§9.3 + §10 + §13/§14）
- 本机只读 API 调用：3 次 GitHub GET（仓库元信息 1 次 + PR #43 2 次），未产生远端变更
其他本机文件：
- WorkBuddy 技能文档有修改（gen1-pr-readonly-audit「执行通道」更正；github-pr-ops-windows「只读判定」更正）
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
```

**第七轮（代合授权变更回填）实际写入范围（四块式）**：

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：零修改（gen1 worktree 仍 6793d7f；monstatus 仍 a8bf76d clean；
    远端 master=2e8cb7d / #43=b7247f9 / clarify 分支=82debe8 逐位未变）
- 未跟踪本地草稿：本文件有修改（§11 三处更正/实证 + 执行者结论 + 合并尝试后复核 + 本节）；
    GEN1_P2_RELEASE_GATE_20260916.md 有修改（头信息 + §0 + §9.1/§9.3 + §14）
- 本机 API 调用：1 次 GET（对照探针）+ 1 次**写**（`PUT …/pulls/43/merge`）⇒ **写被 `403` 拒绝，远端零变更**
其他本机文件：
- WorkBuddy 技能文档有修改（github-pr-ops-windows「策略」段；gen1-pr-readonly-audit「执行通道」段 + 坑表）
- 用户级 `~/.workbuddy/MEMORY.md` 有修改；本地记忆文件有修改
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
```

---

## 12. 合并落地与 D1 结案回填（第九轮，2026-09-16）

本报告 §11 的「第六 / 七轮」留痕记录的是**放行与代合尝试**阶段。此后事实已推进，回填如下
（详细取证见 `GEN1_P2_POST_MERGE_ATTESTATION_20260916.md` 与门禁文档 §0.d，本报告**不重复抄录**以免两处漂移）：

| 项 | 结果 | 载体 |
|---|---|---|
| PR #43 是否合并 | ✅ **已合并**：项目所有人于 `2026-09-16T16:06:26+08:00` 以 `Create a merge commit` 完成；`master = c9af16b1e56d299394ae9cdba457b8eef05da943` | Attestation §1 |
| 合并输入 head | ⚠️ **不是**已审计的 `b7247f9`，而是 `Update branch` 之后的 `6a771a1` ⇒ 偏差 **D1** | Attestation §2 |
| D1 内容等价 | ✅ 已证：19/19 文件逐 blob 相同 + patch-id 相同 + `tree(c9af16b1) == tree(6a771a1)`（全树差异 0）+ `merge-tree` 预测 9/9 命中 | Attestation §2.2 / §2.3 |
| **D1 归档口径** | ✅ **已裁定（第九轮）= 等价替换**：`PROCESS DEVIATION / CONTENT-PRESERVING / RE-ATTESTED / NON-SAFETY / **CLOSED**`；不重开 ⑧、不回滚 #43、不改变 `P2_COMPLETE_DORMANT` | Attestation §2.4 / §6 R1 |
| 本次偏差对本报告「分类三：冲突」的影响 | **无**：C1 / C2 的裁定（→ E22 / E23）不因合并方式而变 —— D1 是**流程**偏差，与 #43 的内容质量无关 | — |
| 前向规则 | ✅ 已确立：**head 变化 ⇒ 原审计对象失效，必须重新冻结新 head、并对新 head 重新验收后才能 merge**（取代「父 SHA 恒等」绝对式） | 门禁文档 §10；勘误 **E25** |
| 本报告与门禁文档的入库 | ✅ owner 已授权 **P2 Closure docs-only PR**（4 份文档，含本报告；**只授权建 PR**，⛔ merge 未授权） | 门禁文档 §9.4 |
| **入库落地** | ✅ 载体分支 `docs/gen1-p2-closure` @ `9b401c1923b4aac32058e84954590b2d01a03547`（base = `44b59b8`）已 push；**PR #46** 已建成（open、`merged=false`、4 文件 +1979 −0）；⛔ **本 PR 未合并** | 门禁文档 §19 |
| **§11「写已证否」的通道限定更正** | ⚠️ 该结论**未限定通道与动作** ⇒ 须改为「**merge 动作**在 fine-grained PAT 通道被证否」。第八轮实测：**git push（SSH）可用**、**建 PR（同一 PAT）`201` 可用**、**MCP App 写路径 `403`** | 勘误 **E26**；门禁文档 §9.1 ⑤ / §19 |

> ⛔ **本报告的分类一 / 二 / 五结论不受影响**：D1 发生在**合并动作**层面，不改动 #43 的代码内容，
> 故「符合边界」「需证明」「merge blocker = 无」三项判定全部**维持原值**。

**第九轮实际写入范围（四块式）**：

```text
ETF 仓库：
- Git 跟踪文件：零修改（git diff --stat HEAD 空）
- Git 历史/分支/远端：远端 master 被**外部**推进为 44b59b8（PR #45，纯 Gen-2；**非本轮**产生，
      本轮仅只读观测）；本轮另新建 P2 Closure 载体分支并提交 4 份文档、按门禁 §9.4 的放行建 PR（⛔ 不 merge）
- 未跟踪本地草稿：本文件有修改（本节）；GEN1_P2_RELEASE_GATE_20260916.md、
      GEN1_P2_POST_MERGE_ATTESTATION_20260916.md、GEN1_DOC_ERRATA_20260916.md 均有修改
其他本机文件：
- WorkBuddy 技能文档有修改（gen1-pr-readonly-audit、github-pr-ops-windows、gen1-doc-errata-dedup）
- 本地记忆文件有修改（.workbuddy/memory/2026-09-16.md、项目级 MEMORY.md）
生产侧：
- 代码 / 配置 / Authority / FROZEN_PARAM_KEYS / lock / immutable_set：零修改
- 线上 `runtime_status`：零写入
```

---

*本文件为审计留痕，不授权任何生产变更（PR #43 的放行由门禁文档 §9.2 记录，P2 Closure PR 的建 PR 放行由 §9.4 记录）。
PR #43 已于 2026-09-16T16:06:26+08:00 由项目所有人以 `Create a merge commit` 合并（`master = c9af16b1`，**as-of 值**）；
过程中的偏差 **D1** 已于第九轮裁定为**等价替换**并 **CLOSED**。
`gen1_authority` 保持 `CANARY`；`ml_effective` 保持 `false`。*
