# Legacy 测试失败 Triage 报告

**日期**：2026-09-08
**基线**：P0-01（canonical common）+ P0-02（测试路径修复）后
**范围**：`node scripts/test-all.js` 中 6 个非 P0-01 引入的失败

> 原则（任务书第 23 节）：不得通过 skip()/注释/删除测试「修绿」。逐项分类 KEEP / UPDATE_EXPECTATION / FIX_CODE / DEPRECATE。

---

## 摘要

| # | 测试 | 失败断言 | 根因 | 分类 |
|---|---|---|---|---|
| 1 | phase1 ㉑ | `'V3.6.1' !== 'V3.9'` | 生产已回退 V3.6.1，测试期望 V3.9 | UPDATE_EXPECTATION |
| 2 | phase1 ㉚ | E3 首仓 B+ BUILD 不触发 | V3.9 E3 实验层，生产 V3.6.1 无 E3 | DEPRECATE |
| 3 | phase1 ㉛ | NaN/pause 闸门 | V3.9.1 实验层 | DEPRECATE |
| 4 | phase1 ㉜ | `'D5' !== 'D3'`（detectDState） | V4.2 实验改进（数据不足默认 D3） | DEPRECATE |
| 5 | phase1 ㉝ | `undefined !== 'pause'`（add_eligibility.position） | V4.2b 实验层闸门 | DEPRECATE |
| 6 | security-hotfix | `/filteredTrades\.map/` 未匹配 | 变量改名 filteredTrades→heldTrades（安全语义仍在） | UPDATE_EXPECTATION |

---

## 逐项分析

### 1. phase1 ㉑：ENGINE_VERSION 期望过时

```text
断言：assert.strictEqual(ENGINE_VERSION, 'V3.9')
实际：'V3.6.1'
```

- **根因**：生产 2026-08-29 切流 V3.6.1（`runtime_status.production_engine=v3.6.1`），测试写于 V3.9 实验期，期望未更新。
- **分类**：A（测试期望已过时）。
- **动作**：UPDATE_EXPECTATION → 改为 `'V3.6.1'`。

### 2~5. phase1 ㉚㉛㉜㉝：V3.9 / V4.2 实验层功能

```text
㉚ V3.9 E3：首仓（E3_FIRST_LOT_SECTORS）B+ BUILD / pause 闸门
㉛ V3.9.1：NaN 输入防护 + explain 闸门 PAUSED 文案
㉜ V4.2：detectDState 数据不足返回 D3（生产 V3.6.1 返回 D5）
㉝ V4.2b：add_eligibility.position 未知仓位 → pause
```

- **根因**：这些是 V3.9/V4.2 实验层（E3 首仓、detectDState D3、add_eligibility 闸门）功能，生产回退 V3.6.1 后不在生产路径。任务书第 1.1 节明确 V3.6.1 FROZEN，第 3 节「本阶段不调策略」。
- **分类**：C（与 Gen-2 无关，实验层遗留）。
- **动作**：DEPRECATE。**暂不删除测试**（遵守第 23 节），等待 V3.9/V4.2 实验层决定是否回归后再处理。当前在 test-all 汇总中记为「已知失败」。

### 6. security-hotfix：filteredTrades → heldTrades 改名

```text
断言：assert.match(api, /filteredTrades\.map/)
实际：apiGateway/index.js 中变量已改名 heldTrades
```

- **根因**：安全修复语义仍在（第 570 行注释「复盘为公网无鉴权接口，不返回成交明细」+ 第 583 行 `heldTrades.map` 去敏），但变量从 `filteredTrades` 改名 `heldTrades`。
- **分类**：A（测试期望过时，仅变量名）。
- **动作**：UPDATE_EXPECTATION → 改为 `/heldTrades[\s\S]{0,30}\.map/`（已修）。

### 7. security-hotfix：anonymous intel refresh 回归

```text
断言：assert.match(api, /接口已迁移至后台管理端/)
实际：apiGateway/index.js 仍有 POST /api/intel/refresh → refreshIntelFeed（第 624 行注释「不走后台登录」）
```

- **根因**：`src/common/utils/intel-refresh.js` 注释明确「前台 apiGateway 已下线」（触发搜集只供 adminGateway），但 apiGateway/index.js 又自行实现了 `refreshIntelFeed`（带 3 分钟冷却），前台匿名刷新接口重新出现，与 security-hotfix 要求「移除匿名 intel refresh」矛盾。
- **分类**：B（安全回归，pre-existing，非 P0-01/P0-02 引入）。
- **动作**：**待用户决策**——若「前台匿名 refresh + 3 分钟冷却」可接受则 UPDATE_EXPECTATION；若需收紧为仅后台触发则 FIX_CODE（移除 `/api/intel/refresh` 路由或加鉴权）。

---

## 处置状态

- [x] 1 ㉑ ENGINE_VERSION → UPDATE_EXPECTATION（已改 V3.6.1）
- [ ] 2~5 ㉚㉛㉜㉝ V3.9/V4.2 → DEPRECATE（待用户确认实验层是否废弃）
- [x] 6 security-hotfix filteredTrades → UPDATE_EXPECTATION（已改 heldTrades.map）
- [ ] 7 security-hotfix anonymous intel refresh → 安全回归，待用户决策（UPDATE_EXPECTATION 或 FIX_CODE）
- [ ] 8 Python test_gen1_immutable → 训练侧模型未入库（见下）

### 8. Python test_gen1_immutable：训练侧模型未入库

```text
assert-gen1-immutable.py 检查 ml/models/HVT-A-ET-20260830/model.joblib + freeze_manifest.json
实际：全仓库无 model.joblib / freeze_manifest.json
```

- **根因**：Gen-1 训练侧（Python）的 `model.joblib` 未入库（训练产物留在训练环境），仓库只存了 Node 推理侧 `cloudfunctions/runGen1ShadowEod/frozen-model.json`。assert-gen1-immutable.py 检查的是训练侧产物路径。
- **分类**：测试基础设施与仓库内容脱节（pre-existing，非本次引入）。
- **动作**：Node 侧 Gen-1 immutable 已由 test-all.js Stage C（frozen-model.json / frozen-manifest.json / frozen-node-inference.js SHA + model_id）覆盖。Python 侧要么入库 model.joblib（大文件），要么把 assert-gen1-immutable.py 的检查目标改为 Node 侧 frozen-model.json。待用户决策。
