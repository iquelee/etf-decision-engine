# Shadow / 对照决策模块

## 生产切流（2026-08-29）

| 角色 | 定义 |
|------|------|
| **Production** | **V3.6.1**（`trend_stage_enabled=true`）— 原线上 shadow 已升正式 |
| **对照** | V3.8 结果仍写入 `shadow_targets.v38_baseline`，不驱动成交建议 |

切流脚本：`scripts/promote-v361-cutover.js`  
线上 `param_config`：`config_version=2026-08-29-v361-cutover`

## 历史回测 shadow（只评不调）

- `v36/` ← 残仓重建 zip（**≠** 生产 V3.6.1 Stage 引擎）
- `v38/` ← 赛道硬顶 zip（现为生产对照基线的近亲）

回测：`node scripts/backtest-full-engine.js --decision=./lib/shadow/v{36,38}/decision.js`
