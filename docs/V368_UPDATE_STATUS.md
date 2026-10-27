# V3.6.8 工程候选更新记录

日期：2026-10-27（北京时间）。分支：`codex/v3-core-convergence`。

当前已发布 **V3.6.8**：`apiGateway` 的 K 线窗口补丁源码为 `49e7c765c586bb81dc707849992fa7386b9a663c`（D-016）；`runDecisionEngine` 源码仍为 `ffd2b4ff626c124629af4c4073cc42066952d3b4`（D-014）；前端源码为 `ddc8f32ba38bf67bbabd6636fbde82022a0b2d30`（D-015）。现有正式结果仍来自 **V3.6.7 发布 / V3.6.1 策略族**，新主引擎的自然运行身份尚待验收。部署事实不表示资格升格、冻结或 ML 生效。

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

第二轮远端检查（Actions #183）测试矩阵及 reader/候选门禁已通过，但旧 `v364-legacy-ack-gate --selftest` 的还原前提是仅有原 61 项差异，无法把当前 66 项树当成该旧前提。旧脚本及 61 项清单不改；CI 改调新候选 wrapper 的 `--selftest`：先核验真实候选和恰好 5 项扩展，再分别验证空白名单、未知 hash/新增文件、全部七类永久禁止错误、候选字节篡改必须拒绝，恢复后必须通过。它不声称旧原始自测在新树上通过。

旧 `V365_CANDIDATE_MANIFEST.json`、V361/V364 锁、Gen-1 模型/阈值/管线锁保持原样。原 V364 verifier 与 61 项承认清单也保持原样。

V3.6.8 增加的五项 legacy 残差由 `release/verify-legacy-divergence.js` 单独逐项处理：`scripts/test-all.js`、`scripts/release-preflight.js`、`scripts/tools/reader-source-audit.js`、`production-history.js`、`release-identity.js`。每项要求命中精确错误类别/路径，并与新 candidate 的文件 hash 一致；永久禁止的七类结构错误、未知新增文件和字节篡改仍失败。这是显式新候选差异检查，不是把 V364 不变量重写为通过。

测试基础设施修复包括：历史 C-021 证明改为核验其封存 archive/日志，而非拿历史快照比较不断演进的工作树；前端历史 fixture 使用固定测试时钟；Python 解释器需真实可执行，并统一 UTF-8 与测试线程数。没有修改历史 evidence 以消除失败。

## 验证与证明范围

远端首次验证（PR #68 / Actions #182）发现五项测试依赖本机环境，当时尚未部署。修复后的 CI 显式使用 `node scripts/test-all.js --portable`：首批 79 个 Node 文件运行，后续 K 线回归新增一文件后为 80 个；两个依赖受治理私有历史的 RPG 回放文件标记 `NOT_RUN`，prospective 的机制负向检查照常运行，15 个历史证据段单列 `NOT_RUN`。这不是完整历史回放资格。默认 `npm test` 和 `release-preflight --apply` 不接受 portable 模式，完整模式首批 81 文件、当前 82 文件及全部历史证据；runner 会覆盖继承的测试环境变量，防止发布意外使用 portable 模式。

授权/分类测试的子进程采用测试专用、内存中的确定性合成 OHLCV，实际执行原 replay 和决策代码；不复制私有行情或成交至 GitHub，不修改生产 replay harness。仓外依赖过滤测试使用自己的临时 probe 脚本验证，不再要求宿主注入 shim。本机修复后 81/81，独立干净 checkout（无 deliverables）portable 79/79。历史文件缺失时完整模式必须失败，不能以 portable 绿色代替发布门禁。修复改变提交及构建身份，原 `3eae94a` 授权不会自动转移到新提交。

- Node 22 的 **81/81 个 Node 测试文件**通过，包含新增部署/历史/身份/sidecar/残差反向测试。
- Python 全量 `unittest discover ml/gen2/tests` 已通过。首次默认多线程运行过慢，被停止；单线程重跑完成，不把中断运行计为通过。
- 跨语言 360 行 parity、Gen-1 冻结/管线检查、11 个函数构建 common parity、Gen-2 构建冻结件及 Gen-1 32 项生产门禁均有独立日志。
- 前端 23 个 suite 与 Vite 构建已执行。
- 对线上只读导出的 14 个正式 run 离线执行新历史 resolver：**70 条决策、14 个 portfolio、0 缺口**。
- 对实际构建的 apiGateway handler 作离线集成调用：10-01 至 10-27 的 513310 历史返回 **13 条**，旧数组契约仍可用；API 包 V3.6.8 没有把生产 run 的 V3.6.7 身份覆盖。
- 后端部署后独立下载 1,796 / 1,799 个文件，均与批准包 EXACT_MATCH；只读历史接口返回预期 13 条，旧数组契约兼容，生产 pointer revision 14 保持不变。Actions #184 的 Node16/22 × Python3.11/3.12 四组 CI 已通过。本机完整 Node 测试 81/81，远端 portable 不替代私有历史证据。
- 未人工调用生产决策。自然运行验收和实际回滚演练尚未执行；未将上传验证当成新 run 已完成。

## 前端独立批次（2026-10-27，已发布）

- 线上三个入口最近修改于 2026-10-01；根入口已使用 Rewrite。候选必须显式 `VITE_ENABLE_REWRITE_ENTRY=1` 构建，避免默认设置把根入口切回 Legacy；`legacy.html` / `rewrite.html` 保留。
- 已捕获三个入口、递归资源闭包和候选会覆盖的已有文件，共 67 文件；逐个匹配提供方大小及 MD5，并封装回滚 ZIP。范围是当前站点依赖与覆盖目标，不声称备份了全部 2,025 个历史孤立资源。
- 前端 23/23 suite 和显式 Rewrite 根入口构建通过，Actions #185 四组 CI 通过。owner 批准后于 13:11:38（上海）更新三个入口，CLI `--entry legacy.html,rewrite.html,index.html --verify` 成功。生产域名独立下载 67 个候选文件，原始 SHA256 全量 EXACT_MATCH；旧 2,025 key 保留，新增 36 项；托管配置、范围外对象及五个已观察后端函数和生产状态未变。
- 浏览器生产域名首页正常读取数据，版本分轴正确；513310 显示 47 条历史，覆盖至 2026-10-26；Legacy 入口正常。CloudBase 测试域名有平台自带访问提示，确认后访问；未更改域名/安全配置。完整报告及生产截图：仓外 `frontend-ddc8f32/DEPLOYMENT_REPORT.md`。回滚快照仍位于 `frontend-ffd2b4f/`，未使用。
- 只读查询尚无 `source_commit=ffd2b4f…` 的新 manifest/history；主引擎无自身 timer，当前由 `materializeIndicators` 的工作日 08:00 管线调用。保留自然运行待验收，不人工造数。
- 前端验收时发现 `getKline` 升序 LIMIT 取最早窗口，图表截至 2024-08-27，但数据库最新日为 2026-10-27。已由后续 D-016 的 API 单函数补丁修复；未在前端拼接/伪造行情，也未据旧图表窗口推导策略输入陈旧。

本机复核制品位于代码仓之外 `_v3-core-review-20261027/`。其中下载包、配置和真实持仓数据不作为可分享源码或 Git 提交。

## 后续顺序

### K 线窗口补丁（2026-10-27，已发布并验收）

- 已复现：原 `getKline` 日/周线升序 LIMIT 取得最早窗口。仅修改 `apiGateway.getKline`：数据库按日期降序选最新日线 320 根 / 周线 260 根，再逆序输出，保持图表的升序日期和原响应字段。
- 日线原有 `close != null` 过滤保留，仍在已选 raw window 内过滤，不从更早行情补齐。空/短历史、代码隔离和读取失败语义保持不变；未触碰策略、主引擎、行情写入或前端。
- 新增实际 HTTP handler 回归：超过上限、恰好上限、短/空历史、其他标的隔离、payload、null close 与错误响应。原代码在 321 根日线 case 确认失败，修复后通过；本机完整 Node **82/82** 通过。
- 本候选重新生成 V368 manifest；V361/V364、旧 V365 manifest、策略冻结件不改。目标发布范围仅 `apiGateway`，沿用 V3.6.8 工程版本，以新源码提交和包指纹区分；不会把 API 补丁版本写入旧生产 run。
- 重新下载当时 V3.6.8 API 完整文件树作为依赖/回滚基线；Actions #187 四组 CI 和实际构建包真实行情离线验收通过后，owner 绑定 `49e7c765c586bb81dc707849992fa7386b9a663c` 批准，仅部署 apiGateway。ModTime=2026-10-27 13:40:33，CodeSize=4455196；上传后独立下载 1,796 文件，原始 SHA256 EXACT_MATCH，0 差异。
- 线上日线 320 根，2025-07-02~2026-10-27；周线 210 根，止于 2026-10-26，均与最新数据库窗口一致且升序。浏览器 K 线显示“数据新鲜”；历史 13 条、旧数组响应、版本分轴、正式 pointer 回归通过。
- API 配置/触发器、其他四个已观察函数、前端全部托管对象、生产 pointer/runtime 记录未变。未人工调用主引擎、未使用回滚。报告：仓外 `kline-window/DEPLOYMENT_REPORT.md`；台账 D-016。

1. **先发布与验收本工程批次**：部署函数集合拟为 `apiGateway`、`runDecisionEngine`；前端单独发布。需新鲜、逐函数绑定的依赖/回滚包和上传后全量对拍。新主引擎的元数据须由自然运行验证，不能为验收人工调用生产决策函数。
2. **第 4 项基础设施批次单独推进**：`release/operational-readiness.js` 已提供只读检查。现有日历覆盖至 2026-12-31；2027-01-04 反向核验返回 `CALENDAR_COVERAGE_OUT_OF_RANGE`，未放宽 fail-closed。下一年度日历必须来自官方交易所通知并另出版本。运行时目标须先核验平台支持及 SDK 兼容，不能因本地 Node 22 通过就声称云端运行时已升级。
3. **第 5 项策略研究仍受证据条件约束**：本批不调整策略阈值、Grace、Fast Path 或 Gen-1 权限。先补真实执行/冷静期分支覆盖，再做暴露不足的 OOS/WF 单因素实验；旧 RPG-F2-B 的 PARTIAL 状态和 30 独立事件要求不因本次工程修复自动关闭。
