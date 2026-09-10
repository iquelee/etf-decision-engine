# Gen-1 COUNTERFACTUAL_CANARY 上线清单（Runbook）

**适用范围**：把 `gen1_authority` 从 `ADVISORY` 升到 `CANARY`（= COUNTERFACTUAL_CANARY）。
**批准状态**：✅ 已获复审正式批准（**严格限定：真实线上计算反事实组合，不改 `final_target`、不取得生产仓位权、不自动交易**）。
**明确 NO-GO**：`LIMITED_PRODUCTION` / `PRODUCTION` / 自动交易。

**任何一个验收项不通过 → 立即停止并回退（第 6 步的反向操作即可）。**

---

## 0. 上线前提（全部满足才继续）

| 项 | 期望值 |
|---|---|
| 本地 `npm test` | **36/36** |
| Gen-1 Production Gates | **G1-A ~ G1-S 19/19** |
| Immutable SHA | 11/11 |
| Feature Pipeline Lock | 10/10（frozen 管线文件零改动） |
| frozen model SHA | `d5e667c66a5f888bb5489b8adcad9e6a141bfbcf0006a955d6ad40e269a7e712` |
| `threshold_signal_p` | `0.65`（未改） |
| 分支/P R 链 | #11→#12→#13→#14→#15→#16→#17→#18 全部 CI 绿 |

---

## 1. 按审计顺序合并 PR（每次 retarget + CI 绿后再 merge）

```text
#11 → master
#12 retarget master → 等 required CI 绿 → merge
#13 retarget master → 等 required CI 绿 → merge
#14 retarget master → 等 required CI 绿 → merge
#15 retarget master → 等 required CI 绿 → merge
#16 retarget master → 等 required CI 绿 → merge
#17 retarget master → 等 required CI 绿 → merge
#18 retarget master → 等 required CI 绿 → merge
```

要点：
- 历史 stacked base（`feat/wp-g1-p*`）**没有各自的 GitHub workflow run**（旧 base 未触发），
  进入 master 前必须补齐 required CI。
- **不要 squash** —— 这些 PR 记录了「Gen-1 如何一步步取得权限」，是未来审计资产。
- retarget 用 `PATCH /repos/{owner}/{repo}/pulls/{n}` 改 `base`；改完会重新触发 `pull_request` CI。

---

## 2. 构建 + 部署最新 `runDecisionEngine` 与 common

```bash
# 源构建（src/common → dist-functions，含 SHA256 parity 校验）
node scripts/build-cloudfunctions.js
python scripts/prepare-deploy.py
# 必须带 --force，否则交互式覆盖确认会卡死
tcb fn deploy runDecisionEngine --dir dist-functions/runDecisionEngine --force
# Gen-1 信号生产者也需同批部署（health latch 写侧）
tcb fn deploy runGen1ShadowEod --dir dist-functions/runGen1ShadowEod --force
```

> Windows 家用机三坑见 skill `cloudbase-deploy-windows`：重定向 `USERPROFILE`、unset 代理、
> CLI 位于 `~/.workbuddy/binaries/node/workspace/node_modules/@cloudbase/cli`。

---

## 3. 确认 / 创建 `gen1_health_state`（**上线阻断项**）

**为什么必须先做**：集合缺失 → `readHealthState` 抛错 → `READ_ERROR` → `ML_OFF` → `allow_canary=false`，
于是切 CANARY 后会出现 `authorized=true` 但 `health_allowed=false / active=false`，**极易被误判为接线 bug**。

```bash
# 建集合（tcb db createCollection 无效，必须用 nosql execute）
tcb db nosql execute --command '[{"TableName":"gen1_health_state","CommandType":"COMMAND","Command":"{\"create\":\"gen1_health_state\"}"}]' --envId tradingview-etf-d0fa42yy57cbc11b --json

# 唯一键索引（单文档 latch，key='gen1-health-state'）
tcb db nosql execute --command '[{"TableName":"gen1_health_state","CommandType":"COMMAND","Command":"{\"createIndexes\":\"gen1_health_state\",\"indexes\":[{\"key\":{\"key\":1},\"name\":\"uk_key\",\"unique\":true}]}"}]' --envId tradingview-etf-d0fa42yy57cbc11b --json
```

或直接跑初始化脚本（集合清单已由 SCHEMAS 驱动，含 `gen1_health_state`）：
```bash
TCB_ENV=tradingview-etf-d0fa42yy57cbc11b node scripts/init-collections.js
```

**验收**：集合存在即可；文档可为空（会由下一次 EOD 自动 bootstrap 创建 `key='gen1-health-state'`）。

---

## 4. 保持 `gen1_authority = ADVISORY`，先跑一次完整 EOD + runDecisionEngine

```bash
# 1) Gen-1 信号 + health latch 写侧
tcb fn invoke runGen1ShadowEod --envId <env>
# 2) 决策引擎（读 latch，产出 gen1_counterfactual_* 字段）
tcb fn invoke runDecisionEngine --envId <env>
```

---

## 5. 验收线上（ADVISORY 阶段）

`runtime_status`（key=`runtime-status`）必须满足：

```text
gen1_health_gate_status              = ACTIVE          ← 若为 PENDING/READ_ERROR 则 STOP
gen1_health_source                   = GEN1_HEALTH_STATE_LATCH
gen1_counterfactual_ledger_ok         = true            ← 若 false 则 STOP
counterfactual_canary_authorized      = false           ← ADVISORY 阶段应为 false
gen1_production_fast_path_enabled     = false
gen1_production_write                 = false
gen1_auto_execution                   = false
```

另确认 `gen1_health_manual_review_required = false`、`gen1_health_economic_status = PENDING`（样本不足，正常）。

---

## 6. 切开关（只改一个参数）

```text
param_config.gen1_authority:  ADVISORY  →  CANARY
```

单字段、可逆、**无代码变更**；`production_write` / `auto_execution` 恒 false；`final_target` 仍为 V3.6.1。

---

## 7. 再跑一次 `runDecisionEngine`，验收反事实通路

```text
counterfactual_canary_authorized      = true
counterfactual_canary_health_allowed  = true
counterfactual_canary_active          = true
counterfactual_canary_invocations     = 0 或 正整数
```

- `invocations = 0`（当日无 Model Candidate）**完全正常** —— 说明没有 S4 重算发生。
- 若 `active = false` 而 `authorized = true`：查 `health_allowed` 与
  `gen1_counterfactual_ledger_ok`，再看日志有无 `GEN1_COUNTERFACTUAL_LEDGER_OVERFLOW`。

---

## 8. ★ 最重要：No-op 验收

切换前后逐字段比较，**必须完全一致**：

```text
decision_result.final_target          ← V3.6.1 生产语义，一字不变
decision_result.final_action
decision_result.suggested_position
portfolio_position.*                  ← 实际持仓（引擎不写实际仓位）
portfolio_snapshot.total_asset / total_pnl
```

Gen-1 **只允许新增** `gen1_*` 字段（`gen1_counterfactual_*`、`gen1_canary_*`、`gen1_health_*`）。
运行期 `applyGen1Overlay` + `verifyProductionNoop` 已在代码层强制该不变量；
若有任何 diff → **立即回退第 6 步并排查**。

---

## 9. 回退预案

| 症状 | 动作 |
|---|---|
| 反事实字段异常 / 组合越界告警 | `gen1_authority: CANARY → ADVISORY`（单字段，立即生效于下次运行） |
| health 门异常（PENDING/READ_ERROR） | 同上；集合问题按第 3 步修复后重跑 EOD |
| 生产字段被改动（No-op 失败） | 立即回退，并视为 P0 事故排查（代码层本应由 `verifyProductionNoop` 抛错阻断） |
| 任何不确定 | 回退到 `ADVISORY` —— 反事实通路关闭后 Gen-1 对生产零影响 |

---

## 10. 上线后：进入证据积累阶段

上线后 Gen-1 每天生成真实 **Live Counterfactual Portfolio**。下一阶段（**WP-G1-EVIDENCE**）要回答的不再是「代码安全吗」，而是：

> 当 Gen-1 把 S2 提前当成 S4 时，**真实情况下能否持续创造优于 V3.6.1 的 Timing Gain，且不明显抬高 False Fast Path 与 MAE？**

评估应按 **Baseline Suggested vs Counterfactual Suggested** 比较（不是只比 target）。
在此之前 **禁止**修改 `0.65` 与 frozen model。

**经济 Gate 现状（未放松）**：3 个 event clusters / 2 个 independent events / BULL = 0 / IN_DOMAIN = 0
→ `LIMITED_PRODUCTION` / `FULL_PRODUCTION` 维持 **BLOCKED**。
