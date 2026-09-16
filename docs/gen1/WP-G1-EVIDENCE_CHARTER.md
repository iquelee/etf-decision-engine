# WP-G1-EVIDENCE — 工作包章程

**启动日**：2026-09-10
**前置状态**：`Gen-1 COUNTERFACTUAL_CANARY = LIVE / ACTIVE`
**性质**：**观察型**工作包 —— 不部署、不改码、不改权限。只读 + 累计 + 判定。

---

## 1. 目标转向（本工作包的定义性变化）

| | WP-G1（前任工作包） | **WP-G1-EVIDENCE（本工作包）** |
|---|---|---|
| 核心问句 | Canary **安不安全**？ | Canary **有没有经济价值**？ |
| 交付物 | 上线链 + 安全不变量 | Evidence Contract + 样本表 + 判定 |
| 成功标准 | 六闸全绿、生产零变更 | 在冻结口径下，用真实样本回答 Q1/Q2/Q3 |
| 失败定义 | 硬边界破裂 | `EVIDENCE_NEGATIVE`（真实结论，非失败） |

> 「安不安全」已经回答完了。「有没有用」现在才开始。

---

## 2. 三份配套文件（本工作包的全部内容）

| 文件 | 作用 | 状态 |
|---|---|---|
| `docs/gen1/GEN1_EVIDENCE_CONTRACT.md` | 证据契约：17 字段定义 + 纳入规则 + 判定阈值 | 🔒 FROZEN v1.0 |
| `docs/gen1/GEN1_DAILY_PRODUCTION_WATCH.md` | 每日监控清单（7 项）+ 异常处置原则 | 生效 |
| `docs/gen1/GEN1_FIRST_LIVE_CANDIDATE_PROTOCOL.md` | 首次真实 Candidate 触发协议（M1..M6） | 待触发 |
| `outputs/wp-g1-evidence-20260910/gen1_evidence_samples.csv` | 样本表（表头已冻结，当前 0 行） | 累计中 |

---

## 3. 执行顺序（★ 不可颠倒）

```
① 冻结 Evidence Contract        ← 已完成（2026-09-10）
        ↓
② 每日监控 7 项（只读）          ← 明日起
        ↓
③ 首个 Live Candidate → 里程碑协议  ← 等待触发
        ↓
④ 累计样本（forward 收益成熟后回填）
        ↓
⑤ 独立事件数 ≥ 30 后才判定       ← 硬门槛
        ↓
⑥ 输出 EVIDENCE_POSITIVE / NEGATIVE / INCONCLUSIVE
```

**为什么必须先冻结再采样**：如果先看结果再定口径，指标就变成了对结果的拟合。
先冻结 = 让样本成为对假设的独立检验。这是本工作包的全部方法论基础。

---

## 4. 现状（2026-09-10）

| 项 | 值 |
|---|---|
| `gen1_authority` | `CANARY` |
| `counterfactual_canary_active` | `true` |
| `counterfactual_canary_invocations` | `0`（尚无 S2 Candidate，**正常**） |
| `gen1_counterfactual_ledger_ok` | `true` |
| `gen1_production_write` | `false` |
| `gen1_auto_execution` | `false` |
| Evidence 样本行数 | **0** |

---

## 5. 硬边界（本工作包同样受约束）

- ❌ 不部署、不改云函数代码
- ❌ 不改 `gen1_authority`（除非人工决策回退）
- ❌ 不改 Evidence Contract 的字段/阈值（除非 v2.0 重冻结 + 样本作废）
- ❌ 不碰 `InstallDependency` / `config_version`（遗留项，另行处理）
- ✅ 只读查询、快照归档、样本回填、定期简报

---

## 6. 遗留项（本工作包内明确不处理）

| 项 | 值 | 计划 |
|---|---|---|
| `InstallDependency`（runGen1ShadowEod） | `TRUE`（MCP 漂移） | 保持 P2 |
| `config_version` | `2026-09-01-gen1-advisory-active` | 命名债，待 Canary 稳定数日后一次性归一化 |

---

*WP-G1-EVIDENCE 章程 v1.0 — 2026-09-10*
