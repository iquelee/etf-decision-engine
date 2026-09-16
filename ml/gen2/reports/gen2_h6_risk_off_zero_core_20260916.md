# `H6_RISK_OFF_ZERO_CORE_ABSORPTION` —— 机制假设立档

> **状态**：`HYPOTHESIS_REGISTERED`（**未验证**）｜**登记日**：2026-09-16｜**授权**：用户裁决 2026-09-16 **第 3 项（N3）**
> **证据层级**：**M — POSTMORTEM**（已被观察段）⇒ **证据力 0，只允许用来形成机制假设**
> **来源**：`gen2_m2b_targeted_attribution_20260916.md` §4（H2 纯描述性诊断）与 §4.5（机制链条）
> **协议**：`POSTMORTEM_NOT_FOR_CALIBRATION`
> **性质**：**仅立假设，不设计任何替代规则**

---

## §1 假设陈述（用户裁决逐字）

> **`H6_RISK_OFF_ZERO_CORE_ABSORPTION`**：RISK_OFF 的晋升禁令与既有 CORE 耗尽共同作用，可能造成持续零 CORE / 高现金暴露；其影响**只能**在 O2 未观察段或 O1 前瞻段验证。

**精确化（不改语义，只把「谁跟谁共同作用」写清）**：
* 抑制项 = RISK_OFF 期间的**新晋升禁令**（`selection_mode = DISABLED`）；
* 存量项 = 既有 CORE 因**其他状态转换**（趋势硬门槛 / demotion 滞后）**已归零**；
* 吸收效应 = 二者叠加后**没有回补路径** ⇒ 出现**持续多个交易日的 `CORE==0`（整仓现金）**。

---

## §2 机制链条（**读源码 + 读数得到，非推断**）

1. `market_score ≤ 45` ⇒ regime = **`RISK_OFF`** ⇒ `selection_permission.selection_mode = **DISABLED**` ⇒ **禁止新晋升 / 新替换**，但**不**强制清除既有 CORE（`max_core_count` 返回 `None`；`rule_v2_ab` §6.1：现任 CORE 去留由 demotion 滞后决定，不受 `DISABLED` 清仓）。
2. 既有 CORE 仍会**因另外两条门归零**：① **`NO_CORE` 绝对趋势硬门槛** —— `trend_gate = (px_ma60 > 0)` 不成立即降为非 CORE（`reason = NO_CORE_TREND_GATE`；F04 修复后**入选与保留统一校验**）；② **demotion 滞后** —— `below_satellite_days ≥ demotion_persistence_days(= 5)`。
3. 一旦在 RISK_OFF 期间 `|CORE| = 0`：**晋升被 `PROMOTION_BLOCKED_BY_PERMISSION` 制度性拦住** ⇒ **该期间内没有回补路径**。
4. `rule_v2_ab` 先全体 `target_weight = 0.0`，**只有 `role == "CORE"` 拿非零权重**（`target_weight = min(1/|CORE|, 0.25)`；`CHALLENGER`/`SATELLITE` 恒 0）⇒ `|CORE| = 0` = **整仓现金**，一直持续到 `market_score ≥ 55`（RISK_ON）解冻。

---

## §3 支撑读数（**全部 M 层，已观察段，证据力 0**）

| 读数 | 值 |
|---|---|
| `CORE==0` 交易日（OOS `2021-01-04 → 2026-09-04`，1,376 日） | **396 = 28.78%** |
| 最长连续 `CORE==0` 段 | **91 个交易日** |
| RISK_OFF 日中 `CORE==0` | **375 / 636 = 58.96%**（非 RISK_OFF 仅 **2.84%**） |
| `CORE==0` 日中 `selection_mode = DISABLED` | **375 / 396 = 94.7%** |
| `reason_codes` 绝对主因计数 | `PROMOTION_BLOCKED_BY_PERMISSION` **1,498** |
| 漏斗（396 日） | alpha 够格（`alpha_pct ≥ core_pct = 0.80`）**日均 4.27 只**；`days_with_zero_alpha_qualified = 0` |
| OOS 平均现金权重（`gen2_v2_defended` @10 bps） | **0.5671** |

⚠ 以上是**该段历史的描述**。它们**不能**证明「换一种行为会更好」—— 那属于**替代规则测试**，已被裁决明确**禁止**在已观察段进行。

---

## §4 验证路径（**唯一**）

* **O2 未观察段**：数据窗口须**全落在 `≤ 2018-04-02`**，Dev / Val / Frozen OOS **三段均不得与已观察段重叠**；且**仅在 M1-B 逐只流动性审计完成、P1 分割冻结之后**才可读取。
* 或 **O1 前瞻段**：当前 31 只池的未来新增数据 —— **唯一**能支持生产资格的证据。
* **观测对象（判据形式）**：① `CORE==0` 交易日占比；② RISK_OFF → `CORE==0` 的**条件概率**；③ **最长连续零 CORE 段长度**；④ 这些区段的**前瞻收益方向**（是否系统性错失上涨）。
* **数值阈值在本文件不预设** —— 按本项目纪律（**不自创阈值**），阈值须在 **P1 pre-registration** 时随分割一并冻结，并与 H2 的判据统一登记。
* 前置条件未满足前：**H6 保持未验证**，**不得**被引用为任何经济结论或部署依据。

---

## §5 与本假设绑定的禁令

* **不**设计任何替代规则（例如「RISK_OFF 期间保留 / 回补 CORE」「空仓日改持有前仓」「买入 challenger」）。
* **不**在已观察 B3 OOS（`2021-01-04 → 2026-09-04`）测试任何替代行为 —— 留给 O2 未观察段。
* **不**产生参数、阈值、新 bundle / 新 lock；**不**把 `cluster_taxonomy_v1` 纳入 `immutable_set`。
* **不**改写 Rule V2.0.1 的归档状态：仍 **`ACCEPTED_FAIL` / `NOT_PRODUCTION_ELIGIBLE`**；仍 Shadow / CANARY；不部署、不提 authority、不写正式仓位。
* **不**据此进入新规则实现，**不**开始 Dev / Val / OOS 回测。

---

## §6 与 H2 的关系

| | H2 | **H6** |
|---|---|---|
| 问题 | 「`CORE==0` 是否造成错失收益」（**描述性**） | 「**为什么**会出现持续 `CORE==0`」（**机制**） |
| 状态 | 判据被裁决撤销，改为描述性判据 | 新登记（N3 选项 (a)） |

⇒ H6 是 H2 的**机制细化**，**并存**、**不替代** H2；两者验证段相同（O2 未观察段 / O1 前瞻段），判据须一并 pre-register。

---

## §7 索引与互链

| 方向 | 文档 |
|---|---|
| 本档 → 证据来源 | `gen2_m2b_targeted_attribution_20260916.md` §4 / §4.5（+ `.json`） |
| 本档 → 相关勘误 | `gen2_m2_h3_erratum_20260916.md`（H3 机制解释更正，数值不变） |
| 本档 → 上一层归因 | `gen2_m2_failure_attribution_20260915.md`（M2，`POSTMORTEM_NOT_FOR_CALIBRATION`） |
| 索引 | `ml/gen2/reports/README.md`（「Gen-2 机制假设登记」节） |

---

## §8 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-16 | 首版立档。按用户裁决 **N3**：`H6_RISK_OFF_ZERO_CORE_ABSORPTION` **仅作为机制假设**，不设计替代规则；验证路径限定 O2 未观察段 / O1 前瞻段；数值阈值留待 P1 pre-registration 冻结。 |
