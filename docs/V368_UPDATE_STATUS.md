# V3.6.8 工程候选更新记录

日期：2026-10-27（北京时间）。分支：`codex/v3-core-convergence`。

当前线上仍是 **V3.6.7 工程发布 / V3.6.1 策略族**。本文件记录本地 **V3.6.8 CANDIDATE**；不表示已部署、已冻结、已通过生产晋升或 ML 已生效。

## 按顺序完成的代码工作

### 1. 收敛源码与部署入口

- 集成提交 `0257e14` 同时保留生产后端树 `20487fe` 与前端 `f30d918`；原分支保留。
- `release/production-baseline.json` 记录线上观察时刻、策略/发布版本、逐函数批次及两个必需祖先。
- `scripts/release-preflight.js` 为统一入口，默认只生成本地计划；必须指定前端或函数列表，不再自动 pull master、隐式全量部署或改写凭证/代理环境。
- 实际上传要求干净提交、祖先关系、完整测试、候选 manifest、reader gate 和本候选 legacy divergence 检查通过。准备期间 HEAD 或文件指纹变化即停止。
- 后端依赖从明确选择的 ZIP 重新恢复；计划包含 ZIP 指纹，准备前后复核。旧依赖目录在确认属于本仓输出目录后重建，防止缓存与指定快照不一致。
- `RELEASE_SOURCE.json` 随每个构建包生成，记录实际构建提交、脏工作树状态和公共源码指纹。脏构建不能被 API 或新 run 宣称为一个干净 source commit。

### 2. 补齐历史读取

- 新增 `production-history.js`：一次 pin 当前 pointer revision，只消费不高于该 revision 的 production/promoted/COMPLETE 历史；每交易日选择最高 revision。
- 切换日 `2026-09-30` 已通过线上首笔 promoted history 验证。切换日前读 legacy，之后按 run_id 读取候选；每行携带来源，增强响应包含分段与覆盖信息。
- 缺 manifest、缺票、重复 code、跨 run、错误日期、缺 portfolio、索引不可用均显式报告。当天新 run 数据无效时不回退到旧同日 run。
- 用 canonical 交易日历识别遗漏交易日，节假日不虚报缺口；输出 `published_through`，不声称覆盖晚于最近正式发布的日期。
- 每票旧数组响应保留；新前端显式请求 `include_provenance=1` 并展示缺口/截断提示。
- 复盘改用同一读链。实际持仓仍来自原有持仓证据，不把 run 的目标仓位当实际成交；历史覆盖不完整时不输出完整汇总统计。
- 只读审计的 7 条 buy 记录中，未发现切换日后缺失 `add_mode` 的记录。本批 **不修改 cooldown 算法或历史成交**，保留其 legacy 回退依赖登记。

### 3. 版本与溯源

- 策略版本、生产 run 发布版本、API 包版本分别表达。网关先部署 V3.6.8 时，读取到的 V3.6.7 run 仍报告 V3.6.7。
- 旧 `input_hash='engine:'+run_id` 保留兼容，并明确标为 run identity；新增 `input_context_sha256` 表达 run context 元数据指纹。它不是完整行情内容 hash。
- 新 run manifest/history 可记录构建提交与 context hash；旧 run 的未知提交/指纹显示 null，禁止猜填。
- 增加 `reader-source-audit.js`：显式指定下载源码、外部记录的源码指纹和观察时间，分别检查当前读链与历史读链；错误/陈旧快照不得静默通过。
- 对 10-27 下载的 API 源码复核：**当前五个 reader 已迁移，历史读链仍为旧实现**。这纠正了 10-26 bundle 中基于旧主目录扫描的 PENDING 解释。
- **正式 V6 采集入口、授权锁与历史 bundle 未修改。** 新工具是补充核验 sidecar，不能冒充正式 evidence；若接入正式入口，须依契约做工具版本与入口重锁验证。

## 候选与历史冻结件

新身份清单：`ml/manifests/V368_CANDIDATE_MANIFEST.json`，状态 **CANDIDATE**，独立声明当前合格文件。

旧 `V365_CANDIDATE_MANIFEST.json`、V361/V364 锁、Gen-1 模型/阈值/管线锁保持原样。原 V364 verifier 与 61 项承认清单也保持原样。

V3.6.8 增加的五项 legacy 残差由 `release/verify-legacy-divergence.js` 单独逐项处理：`scripts/test-all.js`、`scripts/release-preflight.js`、`scripts/tools/reader-source-audit.js`、`production-history.js`、`release-identity.js`。每项要求命中精确错误类别/路径，并与新 candidate 的文件 hash 一致；永久禁止的七类结构错误、未知新增文件和字节篡改仍失败。这是显式新候选差异检查，不是把 V364 不变量重写为通过。

测试基础设施修复包括：历史 C-021 证明改为核验其封存 archive/日志，而非拿历史快照比较不断演进的工作树；前端历史 fixture 使用固定测试时钟；Python 解释器需真实可执行，并统一 UTF-8 与测试线程数。没有修改历史 evidence 以消除失败。

## 验证与证明范围

- Node 22 的 **81/81 个 Node 测试文件**通过，包含新增部署/历史/身份/sidecar/残差反向测试。
- Python 全量 `unittest discover ml/gen2/tests` 已通过。首次默认多线程运行过慢，被停止；单线程重跑完成，不把中断运行计为通过。
- 跨语言 360 行 parity、Gen-1 冻结/管线检查、11 个函数构建 common parity、Gen-2 构建冻结件及 Gen-1 32 项生产门禁均有独立日志。
- 前端 23 个 suite 与 Vite 构建已执行。
- 对线上只读导出的 14 个正式 run 离线执行新历史 resolver：**70 条决策、14 个 portfolio、0 缺口**。
- 对实际构建的 apiGateway handler 作离线集成调用：10-01 至 10-27 的 513310 历史返回 **13 条**，旧数组契约仍可用；API 包 V3.6.8 没有把生产 run 的 V3.6.7 身份覆盖。
- 尚未做新候选的生产部署、自然运行验收或实际回滚演练；未声称在线新接口已经修复。Node 16 兼容性保留 CI matrix 验证，本地另在 Node 22 执行门禁。

本机复核制品位于代码仓之外 `_v3-core-review-20261027/`。其中下载包、配置和真实持仓数据不作为可分享源码或 Git 提交。

## 后续顺序

1. **先发布与验收本工程批次**：部署函数集合拟为 `apiGateway`、`runDecisionEngine`；前端单独发布。需新鲜、逐函数绑定的依赖/回滚包和上传后全量对拍。新主引擎的元数据须由自然运行验证，不能为验收人工调用生产决策函数。
2. **第 4 项基础设施批次单独推进**：`release/operational-readiness.js` 已提供只读检查。现有日历覆盖至 2026-12-31；2027-01-04 反向核验返回 `CALENDAR_COVERAGE_OUT_OF_RANGE`，未放宽 fail-closed。下一年度日历必须来自官方交易所通知并另出版本。运行时目标须先核验平台支持及 SDK 兼容，不能因本地 Node 22 通过就声称云端运行时已升级。
3. **第 5 项策略研究仍受证据条件约束**：本批不调整策略阈值、Grace、Fast Path 或 Gen-1 权限。先补真实执行/冷静期分支覆盖，再做暴露不足的 OOS/WF 单因素实验；旧 RPG-F2-B 的 PARTIAL 状态和 30 独立事件要求不因本次工程修复自动关闭。
