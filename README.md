# ETF 智能仓位决策引擎

CloudBase 生产系统源码。2026-10-27 线上核验：**工程发布 V3.6.7，策略族 V3.6.1**（V3.8 为 shadow 对照）。各云函数按独立批次部署。

当前集成分支另有 **V3.6.8 工程候选**，覆盖发布基线、历史读取和溯源；尚未部署。候选清单为 `ml/manifests/V368_CANDIDATE_MANIFEST.json`，历史 V365 manifest 保留。阶段状态见 `docs/V368_UPDATE_STATUS.md`。

生产源码基线及逐函数观察记录见 `release/production-baseline.json`。集成分支同时包含生产后端 `20487fe` 与前端 `f30d918`；发布前必须通过祖先关系检查，不能仅凭当前目录名或版本字符串判断可部署。

## 架构

```
生产决策链：runDecisionEngine（V3.6.1 主决策，Safety Core）
  ├─ Gen-1：runGen1ShadowEod（ML 影子，frozen，仅 advisory）
  ├─ Gen-2：runGen2ShadowEod（选池影子，只读观察，不写生产仓位）
  └─ Integrated：runIntegratedShadowEod（Gen-2 选池 + Gen-1 择时 + V3.6.1 安全 → 反事实建议，只写 integrated_shadow_*）
```

- **cloudfunctions/** — 云函数源码（含 Gen-1/Gen-2/Integrated 三个影子引擎）
- **web/** — 前端（Vue3 + Vite），V3.6.1 + Gen-1 状态页 + Gen-2 选池观察页
- **ml/** — Gen-2 Python 研究代码（选池/回测/OOS）
- **src/common/** — 单一公共源码源，构建时注入各函数
- **scripts/** — 部署/构建/回测/诊断脚本（build-cloudfunctions.js 源构建 + SHA256 parity）
- **tests/** — Node + Python 测试（统一入口 scripts/test-all.js，A–G 七阶段门禁）
- **docs/** — 主链冻结契约、Selection/Integrated Shadow 接口契约、Engine Authority Matrix、Test & CI Gates

## 版本真相源

- 策略族 = 后端 `runtime_status.production_engine`（当前 `v3.6.1`）；它不等于工程发布版本。
- 工程发布 = `v365_run_integrity.engine_version` / `run_history.engine_version`（当前 `v3.6.7`）。
- 正式决策 selector = `active_run_pointer[production].run_id`，不能用最近一次 runtime 更新代替正式发布。
- `/api/constants` 下发版本给前端；前端 `web/src/utils/constants.js` 兜底值须同步为 V3.6.1
- **禁止用文件名日期代替版本**；所有变更走 git commit + SHA256 契约

## 安全红线

- `config.json` / `cloudbaserc.json` / `.env*` 含真实密钥与 envId，**严禁提交**（已 .gitignore）
- 只保留 `cloudbaserc.example.json` 与 `*.config.example.json` 模板
- 提交前须全文扫描 `sk-` / `FRED_API_KEY` / `DEEPSEEK_API_KEY` / `OPENDART_API_KEY` 等密钥模式，0 命中

## 测试门禁

```bash
npm test   # A–G：Node / Python / Immutable / 跨语言 parity / Secret scan / 构建 parity / Gen-1 门禁
```

任何阶段失败 → 整体退出非零。CI（`.github/workflows/test.yml`）在 push/PR 上跑同套门禁 + GEN2_RULE_V2_BUNDLE 冻结校验。详见 `docs/Test-And-CI-Gates.md`。

## 部署

**先生成本地发布计划（默认不上传）**：

```bash
node scripts/release-preflight.js --functions apiGateway --out ../api-release-plan.json
node scripts/release-preflight.js --frontend-only --out ../web-release-plan.json
```

`scripts/deploy.sh` 只是同一入口的 Bash 包装。已移除固定开发机路径、隐式全量函数集、自动 pull master、凭证目录和代理覆盖。`--pull` 不再支持。

实际上传需在计划命令后显式加 `--apply --env <envId> --cli <CloudBase CLI JS入口>`；后端还需 `--baseline <已核验的函数ZIP目录>`。入口要求源码基线齐全、Git 干净、全量门禁通过；前端另外运行 rewrite 测试。后端只准备和上传 `--functions` 声明的函数，构建或测试改变源码则停止。

`prepare-deploy.py --baseline <目录> --functions apiGateway --env <envId>` 只恢复所选函数依赖与本地配置；从所选 ZIP 重建依赖，避免旧缓存混包。计划与 hash 不构成新的线上一致性证明，上传后的逐函数身份、全包对拍和自然运行验收仍须执行。

- 仓库不存 node_modules / config.json / cloudbaserc.json（安全），由 prepare-deploy.py 动态生成。
- 发布后核对目标函数元数据、完整部署树与正式 pointer；线上读链验证与自然运行验收分别记录。
