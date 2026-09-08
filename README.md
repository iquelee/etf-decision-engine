# ETF 智能仓位决策引擎

线上生产系统（CloudBase）的唯一版本源。当前版本：**V3.6.1**（2026-08-29 切流，V3.8 为对照 shadow）。

## 架构

```
生产决策链：runDecisionEngine（V3.6.1 主决策，Safety Core）
  ├─ Gen-1：runGen1ShadowEod（ML 影子，frozen，仅 advisory）
  └─ Gen-2：runGen2ShadowEod（选池影子，只读观察，不写生产仓位）
```

- **cloudfunctions/** — 线上 10 个云函数（含 Gen-1/Gen-2 影子引擎）
- **web/** — 前端（Vue3 + Vite），V3.6.1 + Gen-1 状态页 + Gen-2 选池观察页
- **ml/** — Gen-2 Python 研究代码（选池/回测/OOS）
- **scripts/** — 部署/回测/诊断脚本
- **tests/** — Node + Python 测试
- **docs/** — 主链冻结契约、接口契约

## 版本真相源

- 唯一真相 = 后端 `runtime_status.production_engine`（当前 `v3.6.1`）
- `/api/constants` 下发版本给前端；前端 `web/src/utils/constants.js` 兜底值须同步为 V3.6.1
- **禁止用文件名日期代替版本**；所有变更走 git commit + SHA256 契约

## 安全红线

- `config.json` / `cloudbaserc.json` / `.env*` 含真实密钥与 envId，**严禁提交**（已 .gitignore）
- 只保留 `cloudbaserc.example.json` 与 `*.config.example.json` 模板
- 提交前须全文扫描 `sk-` / `FRED_API_KEY` / `DEEPSEEK_API_KEY` / `OPENDART_API_KEY` 等密钥模式，0 命中

## 部署

- 云函数：`tcb fn deploy <fn> --dir dist-functions/<fn> --force -e <envId>`
- 前端：`cd web && npm run build && tcb hosting deploy web/dist -e <envId>`
