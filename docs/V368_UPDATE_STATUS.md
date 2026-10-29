# V3.6.8 工程候选更新记录

日期：2026-10-29（北京时间）。分支：`codex/v3-core-convergence`。

当前已发布 **V3.6.8**：`apiGateway` 的 K 线窗口补丁源码为 `49e7c765c586bb81dc707849992fa7386b9a663c`（D-016）；`runDecisionEngine` 日期补丁源码为 `7627356b9cc0441d52368a96e60105254b19f2aa`（D-018）；前端源码为 `ddc8f32ba38bf67bbabd6636fbde82022a0b2d30`（D-015）。10-27 22:01 自然 run 已发布 **V3.6.8 / V3.6.1 策略族** 的正式结果，pointer revision 15、交易日 10-27；该正式结果 source 为 D-014 的 `ffd2b4f…`，source/context 指纹及 5+1 记录核验通过。部署事实不表示资格升格、冻结或 ML 生效。

10-28 08:00 的自然 run 因发布清单/组合日期使用当天、决策使用上一已完成交易日而被 mixed_date_detected 拒绝，正式 pointer 保持不变。[日期错位修复](V368_PUBLISH_TRADE_DATE_FIX.md)已完成本地代码与 85/85 Node 回归，已按批准范围仅更新主引擎，独立下载 1,799 文件精确匹配、配置保持不变；10-28 22:01 和 10-29 08:00 两次自然运行均正式发布，revision 16 / 17；五条决策、清单和组合交易日一致，API/history 回读通过。本补丁自然验收 PASS；正式 API 已完成 D-019 创建及 D-020 切流，见 [迁移方案](V368_RUNTIME24_API_MIGRATION.md)。

基础设施 D-017 已新建并验收独立 `apiGatewayRuntime24`：wrapper 源码 `17144395c02571f6666e27010c4e9cec9a65cdc3`，复用上述 D-016 API，实际 Node **v24.11.1**。1,798 文件精确匹配，七类固定只读用例通过；生产入口和原函数未切换。后续 D-019 / D-020 已完成完整入口创建和切流，详见 [探针结果](V368_RUNTIME24_PROBE.md)。

**当前生产入口（D-020）**：2026-10-29 12:49:50，原域 `/apiGateway` 已切至 `apiGatewayNode24` / Nodejs24.11，API实现源码仍为D-016的49e7c765…；14类原域GET和浏览器看板/历史/K线/Legacy验收通过。旧函数保留、未用回退，生产写链仍保持原运行时。写链依赖、timer、四份独立包及防重复执行设计已梳理，见 [写链迁移设计](V368_RUNTIME24_WRITER_MIGRATION.md)。离线准入/排空及完整RDE入口回放现已通过：Node22/24、1799文件独立包，54次写入及完整payload与未加准入基线一致。本机Stage A 88/88，新增边界另行重测通过；原型未接入生产。下一项为云端准入适配器与隔离验证候选准备，尚未形成写链部署候选。

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

1. **优先修复盘前发布日期错位**：D-014 / D-015 / D-016 已上线，首笔 V3.6.8 自然结果已通过；10-28 盘前发现日期错位，补丁已由 D-018 发布，包/配置核验及夜间、盘前两次自然验收均通过；下一步准备正式 API 迁移。不能为验收人工调用生产决策函数。
2. **第 4 项基础设施批次已推进本地验证**：CI 增加 Node 24，本机完整 Node 24 测试 83/83；修复日历生成器的 CRLF 指纹和只读检查口径，冻结 artifact 不变。日历仍覆盖至 2026-12-31，2027 年官方通知未取得，越界继续阻断。CloudBase 文档支持 Nodejs24.11，但现有函数 Runtime 不支持原地修改；下一步先做独立只读 API 探针，再分批切换入口和写链。详见 [基础设施核验与迁移路线](V368_INFRASTRUCTURE_READINESS.md)，本机加载不等于云端 SDK 兼容证明。
3. **第 5 项策略研究仍受证据条件约束**：本批不调整策略阈值、Grace、Fast Path 或 Gen-1 权限。先补真实执行/冷静期分支覆盖，再做暴露不足的 OOS/WF 单因素实验；旧 RPG-F2-B 的 PARTIAL 状态和 30 独立事件要求不因本次工程修复自动关闭。

## 正式 API 运行时迁移进度（2026-10-29）

D-019 已创建独立 `apiGatewayNode24`（完整 index.main / Nodejs24.11），独立下载 1,797 文件精确匹配、14 类固定 GET 和三个事件形式通过，共18次成功鉴权调用。原生 SCF Invoke 通道 CAM 拒绝，已用同一环境 API Key 的 CloudBase 鉴权通道完成验证，无权限改动。现有正式 API、完整生产路由及 ETF 前端资源保持原状；下一步针对静态托管域 `/apiGateway` 仅替换上游名称准备独立切流授权与原域验收。详见 [完整入口迁移结果](V368_RUNTIME24_API_MIGRATION.md)。

单路由批次已完成本地纯校验/正反向载荷、真实完整路由内存回放、新旧 API 新鲜独立下载及原生产域 14 类 GET 基线准备。本机完整 Node24 Stage A **86/86**（新增路由边界回归），冻结件和候选清单未变；云端路由尚未写入，需绑定新源码、目标包和正向/回退指纹另行授权。见 [单路由切流方案](V368_RUNTIME24_API_CUTOVER.md)。

准入适配器后续准备：已实现仅供隔离集合验证的CloudBase条件CAS适配器及固定五主键探针，Node22/24内存测试和真实SDK序列化/内存传输回放通过（88个数据库请求）。新鲜只读检查目标函数与集合均不存在。上一批Actions #200在legacy脚本管控面失败，已用七个明确路径/SHA256声明及负向测试修复，未改旧锁与禁止错误；工具校验器变更使V368候选content重生为9969ae74…，需新CI确认。生产写链仍未接线。详见 [隔离验证候选](V368_RUNTIME24_ADMISSION_PROBE.md)。

D-021结果（17:57）：隔离探针/空集合已建，1711文件精确对拍；一次固定调用被入口拒绝，原因是CloudBase注入tcbContext/userInfo空对象。SDK数据库验证未运行、集合0条，原13函数及路由/ETF前端/pointer/runtime不变，未重试。入口修复已在本地，尚未更新云端；当前不计云端写资格通过。

D-022当前结果（19:18）：入口修复已按批准范围仅更新隔离探针，一次固定SDK云端写/CAS验证PASS，实际Node v24.11.1、SDK2.11.0，独立回查五个固定主键状态全部一致。原13函数、路由、ETF前端、正式pointer/runtime不变；无资源创建/删除。隔离资格通过，生产写链尚未迁移；下一步准备长期回执与生产准入接线离线候选。详见 [隔离验证结果](V368_RUNTIME24_ADMISSION_PROBE.md)。

长期回执与生产准入接线已新增离线 V2 契约候选：永久回执账本与执行槽原子提交，300 条历史去重、跨 epoch、20 路竞争、提交确认故障及完整 RDE 54 次写入对拍通过。仅内存事务参考验证，无生产接线或云端部署；下一步核对锁定 SDK 的跨记录事务/唯一性能力。见 [候选边界与后续顺序](V368_WRITER_JOURNAL_CANDIDATE.md)。

后续进展：已核对生产锁定 SDK 的手动事务实现并完成隔离命名空间适配器，Node22/24 真实 SDK 序列化/内存传输回放通过；固定探针最终 279 文档双索引一致。完整本地测试 91/91。准备下一批独立函数/集合与最多29次固定调用的源码/包绑定申请，尚未操作云端；生产 Node24 写链迁移与自然验收仍待后续批次。
