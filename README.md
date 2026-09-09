# ETF 智能仓位决策引擎

线上生产系统（CloudBase）的唯一版本源。当前版本：**V3.6.1**（2026-08-29 切流，V3.8 为对照 shadow）。

## 架构

```
生产决策链：runDecisionEngine（V3.6.1 主决策，Safety Core）
  ├─ Gen-1：runGen1ShadowEod（ML 影子，frozen，仅 advisory）
  ├─ Gen-2：runGen2ShadowEod（选池影子，只读观察，不写生产仓位）
  └─ Integrated：runIntegratedShadowEod（Gen-2 选池 + Gen-1 择时 + V3.6.1 安全 → 反事实建议，只写 integrated_shadow_*）
```

- **cloudfunctions/** — 线上 11 个云函数（含 Gen-1/Gen-2/Integrated 三个影子引擎）
- **web/** — 前端（Vue3 + Vite），V3.6.1 + Gen-1 状态页 + Gen-2 选池观察页
- **ml/** — Gen-2 Python 研究代码（选池/回测/OOS）
- **src/common/** — 单一源码真相源（49 文件 canonical，构建时注入各函数）
- **scripts/** — 部署/构建/回测/诊断脚本（build-cloudfunctions.js 源构建 + SHA256 parity）
- **tests/** — Node + Python 测试（统一入口 scripts/test-all.js，5 阶段门禁）
- **docs/** — 主链冻结契约、Selection/Integrated Shadow 接口契约、Engine Authority Matrix、Test & CI Gates

## 版本真相源

- 唯一真相 = 后端 `runtime_status.production_engine`（当前 `v3.6.1`）
- `/api/constants` 下发版本给前端；前端 `web/src/utils/constants.js` 兜底值须同步为 V3.6.1
- **禁止用文件名日期代替版本**；所有变更走 git commit + SHA256 契约

## 安全红线

- `config.json` / `cloudbaserc.json` / `.env*` 含真实密钥与 envId，**严禁提交**（已 .gitignore）
- 只保留 `cloudbaserc.example.json` 与 `*.config.example.json` 模板
- 提交前须全文扫描 `sk-` / `FRED_API_KEY` / `DEEPSEEK_API_KEY` / `OPENDART_API_KEY` 等密钥模式，0 命中

## 测试门禁

```bash
npm test   # 5 阶段：Node 单测 / Python 单测 / Immutable / Parity / Secret scan
```

任何阶段失败 → 整体退出非零。CI（`.github/workflows/test.yml`）在 push/PR 上跑同套门禁 + GEN2_RULE_V2_BUNDLE 冻结校验。详见 `docs/Test-And-CI-Gates.md`。

## 部署

**一键部署（推荐）**：

```bash
bash scripts/deploy.sh --pull        # git pull + 前端 + 后端全量部署
bash scripts/deploy.sh --backend-only # 只部署后端云函数
bash scripts/deploy.sh --frontend-only # 只部署前端
```

流程：`scripts/prepare-deploy.py` 从线上函数 zip 快照（`_gen2-online-baseline/`）恢复 node_modules + config.json，再用仓库最新源码覆盖，生成 `dist-functions/` + `cloudbaserc.json`；随后 `tcb fn deploy --force` 逐个部署 + `tcb hosting deploy`。

- 首次部署会解压 node_modules（约 6 分钟），之后 node_modules 已缓存，秒级。
- 仓库不存 node_modules / config.json / cloudbaserc.json（安全），由 prepare-deploy.py 动态生成。
 
**手动部署**：

- 云函数：`tcb fn deploy <fn> --dir dist-functions/<fn> --force -e <envId>`
- 前端：`cd web && npm run build && tcb hosting deploy web/dist -e <envId>`
