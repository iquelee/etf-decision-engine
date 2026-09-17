# GEN1 GE-03 S4 Invocation Census

> **文档性质**：GE-03 实施 PR 的**强制交付物**（设计 Gate §2.1「机器可审计的实施约束」）。
> **稳定标识**：base SHA `5c517bcc45736e868921de89d4ee007142eb0602`（授权 base）。
> **不记录**：本分支自身 HEAD / 提交数 / 行数 / 「尚未合并」类自述（自指即过期）。
> **行号口径**：本文行号为**定位辅助**（as-of 本分支 GE-03 施工态）；**权威定位** =
> `tests/gen1-ge03-s4-census.test.js`（Gate G1-AF）中的结构锚点与切片断言。
> 行号漂移不影响判据成立性，锚点漂移即打红。

---

## 0. 为什么需要这份 census

设计 Gate §2.1 的**同形关系**约束：

```text
若 ②（既有 Canary rerun，V361_RERUN_S4）与 ③（Guarded Shadow rerun）的 V3 输入「逐项相同」
  ⇒ ⛔ 不得重复计算两次，应「共享同一 rerun result」。
若输入确有差异 ⇒ 必须列出 input delta，但仍「只能调用同一个 immutable V3」，
  ⛔ 不得复制或改写 V3 逻辑。
```

census 的作用是把「到底调用了几次 immutable V3、每次的触发条件与输入是什么、
②③ 是否共用同一次调用」从**注释里的声明**升级成**可机器审计的事实**。
否则「共享」只能靠人读代码相信，正是 §8 反模式清单里的「第二套 V3」与「装饰性 dormant」的温床。

---

## 1. Census 主体：三个候选调用点

**枚举域（显式声明）**：`cloudfunctions/runDecisionEngine/index.js` 内**全部**
`runDecision(` 调用点（不限引擎）。⛔ 不声称为「全仓」——`src/` 下无调用点；
`dist-functions/` 是构建产物（由 `scripts/build-cloudfunctions.js` 递归复制），非独立权威源。

| # | 调用点 | 引擎 | 触发条件 | 调用次数 |
|---|---|---|---|---|
| ① | `const v3Result = decisionV3.runDecision(…)` `~L691` | **immutable V3**（`decision-v3.js`） | `runV3Path === true`，且该 ETF 未被 `data_complete === false` 提前 `continue` | 每 ETF ≤ **1** 次/轮 |
| ② | `const c = decisionV3.runDecision(…)` `~L792` | **immutable V3**（同上，同一函数） | `canaryAllowed === true`（= `permission.effective_canary` ∧ authority ≥ CANARY_OVERRIDE）**且** `canaryCtx != null` | 每 ETF ≤ **1** 次/轮 |
| ③ | `claimGuardedShadowResult(shadowEligibility, canaryS4Rerun)` `~L854` | **⛔ 无独立调用** | `shadowEligibility.eligible === true` **且** `canaryS4Rerun != null` | **0** 次（认领 ② 的结果） |

同文件另有两处 `runDecision(`，**不属** immutable V3，故不在 ①/②/③ 之列：

| 调用点 | 引擎 | 定位 |
|---|---|---|
| `const probe = decision.runDecision(…)` `~L502` | legacy / V3.8（`decision.js`） | 阶段一预计算机会分，**不落库** |
| `const v38Result = decision.runDecision(…)` `~L663` | legacy / V3.8（`decision.js`） | V3.6.1 基线结果（`decisionV3` 存在时被 `mergeShadowOutputs` 合并） |

⇒ **immutable V3 的调用点总数恒为 2**（① 与 ②）。GE-03 **未**新增第 3 处。
这一条是「⛔ 不得复制或改写 V3 逻辑」在结构层面的**唯一**可证形式。

---

## 2. 触发条件（三方各有判据，⛔ 不得互推）

### ① baseline V3

```text
runV3Path = trendStageEnabled || shadowEnabled            (index.js ~L473)
  trendStageEnabled = merged.trend_stage_enabled === true
  shadowEnabled     = (merged.v3_6_1_enabled === true && merged.v3_6_1_shadow === true)
                        ? true : (merged.v3_shadow_enabled !== false)

前置短路：if (p.snapshot.data_complete === false) { …buildWaitResult…; continue; }   (~L649)
         ⇒ 该 ETF 本轮「不产生任何 V3 调用」，① 亦不发生。
```

### ② 既有 Canary S4 rerun

```text
canaryAllowed = permission.effective_canary === true
              && !!authority
              && authorityAllows(authority.gen1_authority, 'CANARY_OVERRIDE')   (gen1-canary.js ~L73-75)

回调调用点（gen1-canary.js ~L84-87）：
  if (canaryAllowed) {
    effectiveStage = 'S4';
    if (typeof src.recomputeCanaryTarget === 'function') {
      const out = src.recomputeCanaryTarget('S4') || {};      ← 实参恒为字面量 'S4'

RDE 侧回调首行守卫：if (!canaryCtx) return { target: baselineTarget, action: baselineAction };  (~L791)
```

⇒ ② 的触发条件 = `canaryAllowed` ∧ `canaryCtx != null`；
且**传入 stage 恒为 `'S4'`**（由 `gen1-canary.js` 决定，非 RDE 决定）⇒ 不存在「shadow 跑在别的 stage」的路径。

### ③ Guarded Shadow rerun

```text
eligible = authority.gen1_authority === 'CANARY'
         ∧ guarded.checks.health_allows_guarded ∧ data_ok
         ∧ domain_strict_in_domain ∧ safety_pass ∧ model_candidate      (gen1-shadow-eligibility.js §0.3)

认领语义（双向 fail-closed）：
  claimGuardedShadowResult(eligibility, rerun)
    → if (!eligible || rerun == null) return null;
    → else return { target: rerun.target, action: rerun.action, stage: rerun.stage };
```

⇒ ③ **不产生任何 V3 调用**：它只把 ② 已经算出的结果对象**复制三个字段**出来。
✅ 依据 §0.2.1：`eligible === true` 而 `canaryS4Rerun == null` 是**合法态**
（资格成立但重跑未执行）⇒ 此时 ③ 结果为 `null`，**不计数**。
这是**有用的审计信号**（`eligible_count` 增而 `shadow_invocations` 不增），不是缺陷。

---

## 3. Input delta 表（① vs ②，逐项）

定义：① 的实参记为 `A`，② 的实参记为 `B`。

| 选项键 | `A`（① baseline） | `B`（② Canary S4 rerun） | 关系 |
|---|---|---|---|
| `fundamental` | `p.fundamental` | `p.fundamental` | **同值**（同一表达式） |
| `risk` | `p.risk` | `p.risk` | **同值** |
| `cooldownDays` | `cooldownDays`（简写） | `cooldownDays`（简写） | **同值** |
| `riskEvents` | `p.risk.events \|\| []` | `p.risk.events \|\| []` | **同值** |
| `portfolio` | `v3Portfolio` | `canaryCtx.portfolio` ← 绑定 `v3Portfolio` | **同值**（同源） |
| `trendStageState` | `v3TrendStageState` | `canaryCtx.trendStageState` ← 绑定 `v3TrendStageState` | **同值**（同源） |
| `shockState` | `v3ShockState` | `canaryCtx.shockState` ← 绑定 `v3ShockState` | **同值**（同源） |
| `recentSlowBreakScores` | `v3SlowBreakHistory` | `canaryCtx.slowBreakScores` ← 绑定 `v3SlowBreakHistory` | **同值**（同源） |
| `bars` | `etfBars` | `canaryCtx.bars` ← 绑定 `etfBars` | **同值**（同源） |
| `sectorRemainingLimit` | `sectorRemainingLimit`（**简写传参**，**生产账本**） | `canarySectorRemaining`（**canary 账本**） | **Δ1：账本 + 键形态** |
| `advisoryStageOverride` | ⛔ **未传**（`undefined`） | `stage`（恒 `'S4'`） | **Δ2：唯一语义变量** |

### Δ1 的精确性质：**账本差**，不是 clamp 差

两处 sector 剩余额度的**构造式同形**（`Math.max(0, <CAP> − (<USED> − <CURRENT>))`）：

```text
生产（index.js ~L638-642）：
  let sectorRemainingLimit = null;
  if (TECH_SECTORS.indexOf(etf.sector) >= 0) {
    const current = p.position.current_position || 0;
    sectorRemainingLimit = Math.max(0, effectiveTechMax - (sectorUsed - current));
  }

Canary（gen1-canary.js ~L186-193 counterfactualSectorRemaining）：
  const cap = numOr(x.effectiveTechMax, null);
  if (x.isTech !== true || cap == null) return null;
  const used = numOr(x.sectorUsed, 0);
  const current = numOr(x.currentPosition, 0);
  return Math.max(0, cap - (used - current));
```

⇒ 两者**都** clamp、**都**在非科技 ETF 上取 `null`；差异**只**在于 `<USED>` 取自哪个账本：

```text
生产账本   let sectorUsed      = portfolio.tech_position != null ? portfolio.tech_position : 0;   (~L555)
Canary 账本 let canarySectorUsed = portfolio.tech_position != null ? portfolio.tech_position : 0;   (~L601)
```

两条初始化式**除变量名外逐字符相同**（同一 `portfolio` 对象、同一 `tech_position`、同一兜底 `0`）
⇒ 起点恒等；此后两本账在**同一轮内各自单步推进**（生产 `sectorOccupation` / canary
`stepCounterfactualLedger`），这是 G1.3-01「完整组合反事实」的**既定设计**，不是 GE-03 引入的偏差。

### Δ2 的精确性质：唯一有意变量

`advisoryStageOverride` 是 G1.2-03 定义的**唯一**分叉点（「输入完全相同，只有 stage override 不同」）。
① 不传 ⇒ 引擎自算阶段；② 恒传 `'S4'` ⇒ 反事实复现「S4 加仓」情景。

---

## 4. ②③ 共享声明（本 census 的核心结论）

```text
② 与 ③ 的 V3 输入「逐项相同」——且是**平凡地**相同：
③ 根本不发起调用，它的三个字段直接取自 ② 同一次调用的返回值对象。
```

证据链（三环，缺一即证不成）：

```text
环 1  ② 的回调内，同一次调用后立即把结果留给 shadow：
      canaryS4Rerun = { target: c.final_target, action: c.final_action, stage: stage };   (~L806)
      ⚠️ stage 取回调实参（恒 'S4'），⛔ 不写死字面量 ⇒ shadow 与 canary 永远指向同一次重跑。

环 2  canaryS4Rerun 全文件**恰 1 次赋值**、声明处初值恒 null（⛔ 无第二次覆写）。

环 3  shadow 侧**只认领**：
      const guardedShadowResult = claimGuardedShadowResult(shadowEligibility, canaryS4Rerun);   (~L854)
      ⛔ 无任何 `guardedShadowResult = <expr 含 runDecision>` 形态。
```

⇒ **②③ 的 V3 输入不存在 delta**（③ 无输入），③ 的调用次数 **= 0**。
⇒ immutable V3 每 ETF 每轮最多被调用 **2 次**（①②），⛔ 永不因 GE-03 变成 3 次。

### 调用次数汇总

| 通道 | 每轮（全部 ETF）调用次数 | 上界 |
|---|---|---|
| ① baseline V3 | `Σ_etf [runV3Path ∧ ¬data_incomplete]` | ≤ N（ETF 数） |
| ② 既有 Canary S4 rerun | `Σ_etf [canaryAllowed ∧ canaryCtx ≠ null]` | ≤ N |
| ③ Guarded Shadow rerun | **0**（认领 ②） | = 0 |
| **immutable V3 合计** | **①② 之和** | **≤ 2N**，且结构上恒为「≤2 处调用点」 |

### 计数器求值次序（源码顺序 = 调用拓扑的投影）

```text
③ 资格派生   deriveGuardedShadowEligibility(gen1Permission)          ← 只依赖 permission 信封
      ↓
② 重跑生效   if (canary.gen1_canary_effective === true) canaryInvocationCount += 1;
      ↓
③ 认领成功   if (guardedShadowResult != null) guardedShadowInvocations += 1;
```

⚠️ 资格派生**早于** ② 重跑 —— 它**不依赖任何 V3 调用**。这正是 §0.2.1
「`eligible_count` 可增而 `shadow_invocations` 不增」得以成立的**结构原因**
（两件事在源码顺序上就是解耦的，不是靠运行期约定）。

### 计数器对齐（与 census 一致，⛔ 互不推导）

| 计数器 | 增量条件 | 落库位置 | 与 census 的关系 |
|---|---|---|---|
| `canaryInvocationCount` | `canary.gen1_canary_effective === true` | （`runtime_status` 侧，既有） | ② 实际执行 + 生效 |
| `gen1_guarded_shadow_eligible_count` | `shadowEligibility.eligible === true` | `runtime_status` | ③ 的**资格**成立次数（**不**等于调用次数）；求值早于 ② |
| `gen1_guarded_shadow_invocations` | `guardedShadowResult != null`（= ③ 认领成功） | `runtime_status` | ③ 的**实际认领**次数（恒 ≤ eligible_count）；求值晚于 ② |
| `gen1_guarded_effective_invocations` | 真实采纳 ∧ 落库成功（GE-02 硬断言 ⇒ 不可达） | `runtime_status` | ⛔ 与 shadow 通道**无关**，GE-03 恒 **0** |

✅ 不变量：`eligible_count ≥ shadow_invocations ≥ 0`；⛔ 三者不得互相推导。

---

## 5. 机器审计映射（本 census 由哪条门禁守卫）

| census 结论 | 守卫门 | 断言形态 |
|---|---|---|
| 全部 `runDecision(` 调用点分类 = 2×`decisionV3.` + 2×`decision.` | **G1-AF** | 计数 + 逐调用点归属变量名 |
| ① 在 `runV3Path` 块内、⛔ 不传 `advisoryStageOverride` | **G1-AF** | 切片 + 键集差 |
| ② 传 `sectorRemainingLimit: canarySectorRemaining` + `advisoryStageOverride: stage` | **G1-AF** | 切片 + 键集差 |
| Δ1 = 账本差（两处 clamp 同形、两处种子逐字符相同） | **G1-AF** | 正则同形 + 种子表达式逐字符比对 |
| ① 与 ② 的 9 个共有键**逐项同源**（`canaryCtx` 绑定链） | **G1-AF** | 绑定表逐项断言 |
| ③ 无独立调用（认领，恰 1 次赋值、⛔ 无重算） | **G1-AF** | 切分 + 赋值计数 |
| 触发条件三方各有判据 | **G1-AF** | 三条判据表达式逐条断言 |
| 三计数器互不推导、增量条件与 census 对齐 | **G1-AB**（既有）+ **G1-AF** | 增量点计数 + 条件表达式 |
| 计数器求值次序 = ③资格 → ②生效 → ③认领 | **G1-AF** | 三处 `indexOf` 先后序 + 派生早于计数 |
| `decisionV3.runDecision(` 恰 2 处 | **G1-AA**（既有，E1）+ **G1-AF**（独立复核） | 正则计数 |

---

## 6. 边界与否定性声明的枚举域

为避免「无限域否定」，以下结论均**显式声明枚举域**：

```text
⛔ 「无第三处 immutable V3 调用」的枚举域 = cloudfunctions/runDecisionEngine/index.js
   且以 `decisionV3.runDecision(` 为该引擎的唯一调用形态作判据。
   —— 不声称其他文件、其他形态（如动态 `require` 后调用）不存在；
      该风险由 R6 的 SHA lock（V361_IMMUTABLE_LOCK 覆盖 decision-v3.js）另行封堵。

⛔ 「②③ 输入无 delta」的枚举域 = ② 回调内那一次 runDecision 的实参对象。
   —— ③ 无实参对象，故该命题是「无语义」而非「比较后相等」，这是更强的形式。

⛔ 「V3 引擎只有一个」的判据 = `decisionV3` / `decision` 两个标识符的 require 来源
   （`./common/utils/decision-v3.js` 与 `./common/utils/decision.js`）
   且 GE-03 未新增任何 `decision|shadow` 相关 require（G1-AA §E6 集合逐项比对）。
```

---

## 7. 反模式自检（§8 对应项）

| 反模式 | 本 census 的对应封堵 |
|---|---|
| 第二套 V3 | ③ 无调用；immutable V3 调用点恒 2 处 |
| 证据被 replay 刷量 | shadow 通道不写 `independent_events`（G1-AC/G1-AD 断言） |
| shadow 资格被当采纳资格 | `guardedShadowEligible` ⛔ 不入 Selector（§0.3 禁令 ③，G1-AA E4） |
| 装饰性 dormant | ③ 的「共享」有环 1–3 三环证据，非注释声明 |
| 口径混用 | 三计数器增量条件逐条独立、⛔ 不得互推 |

---

*本文档为 GE-03 实施 PR 的交付物之一；其结论的可执行形式见 Gate G1-AF。*
