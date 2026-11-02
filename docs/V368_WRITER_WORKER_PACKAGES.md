# Node24 写链函数包候选

状态：**OFFLINE_SIGNED_RPC_CANDIDATE_NOT_QUALIFIED**。本批没有部署、配置、调用或创建云资源，不追加部署台账。生产迁移和自然运行验收仍未完成；最后云端批次是 D-026，长转发失败后保持 HOLD，不能重用该批批准。

`release/writer-worker-bootstrap.js` 把现有签名准入和调用上下文接到两个静态目标：`runDecisionEngineNode24`、`materializeIndicatorsNode24`。这是仅接收签名 RPC 的入口，没有 Timer 或 HTTP 根入口适配。运行时使用 SDK 无参数 `getCloudbaseContext()` 读取环境，并核对原生 context.function_name 和 Node major 24；事件内环境或函数名不作为运行身份。

密钥分别来自 `WRITER_RDE_SIGNING_KEY_HEX`、`WRITER_MATERIALIZER_SIGNING_KEY_HEX`，要求显式 32 字节十六进制值。没有默认生产密钥，仓库和包内不生成密钥。物化还需要 RDE 密钥来签子调用。每次调用重新检查密钥，热实例内密钥变化会拒绝请求，不能据此声称已经实现轮换协议。错误运行身份、缺密钥和签名错误在 SDK init、存储访问和业务导入前被拒绝。

生产存储候选使用独立的 `createProductionStore`，固定环境 `tradingview-etf-d0fa42yy57cbc11b`、集合 `writer_admission_journal_v1`，只接受九个 `production/<函数名>` 范围：日线、实时、物化、RDE、后台、新闻、提取、Gen1/Gen2 shadow。它不接受自定义集合、额外选项或未声明范围。集合及其控制记录**尚未创建或初始化**；缺记录会拒绝，不自动建表、seed 或开放准入。原 `createStore` 仍只允许隔离集合。

本批修改了 `writer-journal-cloudbase.js` 的命名空间封装，事务主体保持原算法：同一控制主键冲突互斥、双回执索引、一次 commit、确认未知不补偿或重试。不能再称本批全部四个协议/适配文件与 D-024 字节相同，也不能把隔离实证扩展为生产集合/IAM 资格。

业务 SDK 通过包内 shim 接入调用上下文，不修改原 SDK.init。shim 固定环境及 retries=0/keepalive=false，保留业务指定的 timeout；RDE 子调用默认仍是 15000ms。物化和 RDE 分开准入范围，子请求从父身份及固定动作派生。该设置**没有解决或证明长调用传输期限**，也没有缩短原函数 120 秒业务预算。

## 离线构建与核验

`release/prepare-writer-workers.js` 只接受当前干净的完整 40 位源码 SHA、新的仓外输出目录，以及独立下载包和原始文件 map。两个输入 map 必须匹配既有 inventory，逐文件核对全部内容、拒绝符号链接，构建后再次核对原包。

每包保留自己的 common 和依赖，不运行安装，不叠加仓库 canonical common。仅将原 index 保存为 business.js，并对它及 common/utils/db.js、common/utils/intel-refresh.js 的唯一 SDK require 做明确替换；扫描到额外 SDK 引用即停止。新增签名入口、shim 和八个模块。保留原配置的 DECISION_ENV=prod 和 120 秒 timeout，去掉全部 triggers；新包不附带签名密钥。原 RELEASE_SOURCE 等历史文件保留，新的 SOURCE_IDENTITY.json 明确它是派生候选。输出逐文件 SHA、固定时间戳 ZIP 和构建收据，不调用云 API。

`tests/writer-worker-bootstrap.test.js` 使用内存事务模型验证九个范围的缺记录拒绝、固定命名空间、鉴权先于存储、业务延迟导入、业务 ok:false 保留、永久重复拒绝、热实例密钥变化拒绝，以及物化到 RDE 的两个范围和签名子请求。这些是模型证据，不是实际包整体业务对拍或真实 SDK 传输证明。

## 下一步

用封存源码生成两个实际包，核对全部依赖和改动清单，执行包入口拒绝路径及完整业务对拍。之后仍需补齐 Timer/人工根身份、后台持久任务确认、所有调用方与旧队列封闭、密钥供应和存储权限验证，才能准备新一批精确授权。最后才是生产迁移和夜间/盘前自然验收。既有 D-026 失败不能因离线测试通过而改记为合格。
