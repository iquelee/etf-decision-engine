# Node24 写链函数包候选

状态：**OFFLINE_WORKER_CANDIDATE_NOT_QUALIFIED**。本批没有部署、配置、调用或创建云资源，不追加部署台账。生产迁移和自然运行验收仍未完成；最后云端批次是 D-026，长转发失败后保持 HOLD，不能重用该批批准。

`release/writer-worker-bootstrap.js` 把现有签名准入和调用上下文接到两个静态目标：`runDecisionEngineNode24`、`materializeIndicatorsNode24`。`0d29536` 封存版仅接收签名 RPC；后续新增了[原生 Timer 本地准入候选](V368_WRITER_NATIVE_ROOT.md)，尚未取得平台重试/来源资格或接上生产触发器。HTTP 根入口仍未接线。运行时使用 SDK 无参数 `getCloudbaseContext()` 读取环境，并核对原生 context.function_name 和 Node major 24；事件内环境或函数名不作为运行身份。

密钥分别来自 `WRITER_RDE_SIGNING_KEY_HEX`、`WRITER_MATERIALIZER_SIGNING_KEY_HEX`，要求显式 32 字节十六进制值。没有默认生产密钥，仓库和包内不生成密钥。物化还需要 RDE 密钥来签子调用。每次调用重新检查密钥，热实例内密钥变化会拒绝请求，不能据此声称已经实现轮换协议。错误运行身份、缺密钥和签名错误在 SDK init、存储访问和业务导入前被拒绝。

生产存储候选使用独立的 `createProductionStore`，固定环境 `tradingview-etf-d0fa42yy57cbc11b`、集合 `writer_admission_journal_v1`，只接受九个 `production/<函数名>` 范围：日线、实时、物化、RDE、后台、新闻、提取、Gen1/Gen2 shadow。它不接受自定义集合、额外选项或未声明范围。集合及其控制记录**尚未创建或初始化**；缺记录会拒绝，不自动建表、seed 或开放准入。原 `createStore` 仍只允许隔离集合。

本批修改了 `writer-journal-cloudbase.js` 的命名空间封装，事务主体保持原算法：同一控制主键冲突互斥、双回执索引、一次 commit、确认未知不补偿或重试。不能再称本批全部四个协议/适配文件与 D-024 字节相同，也不能把隔离实证扩展为生产集合/IAM 资格。

业务 SDK 通过包内 shim 接入调用上下文，不修改原 SDK.init。shim 固定环境及 retries=0/keepalive=false，保留业务指定的 timeout；RDE 子调用默认仍是 15000ms。物化和 RDE 分开准入范围，子请求从父身份及固定动作派生。该设置**没有解决或证明长调用传输期限**，也没有缩短原函数 120 秒业务预算。

## 离线构建与核验

`release/prepare-writer-workers.js` 只接受当前干净的完整 40 位源码 SHA、新的仓外输出目录，以及独立下载包和原始文件 map。两个输入 map 必须匹配既有 inventory，逐文件核对全部内容、拒绝符号链接，构建后再次核对原包。

每包保留自己的 common 和依赖，不运行安装，不叠加仓库 canonical common。仅将原 index 保存为 business.js，并对它及 common/utils/db.js、common/utils/intel-refresh.js 的唯一 SDK require 做明确替换；扫描到额外 SDK 引用即停止。新增入口、shim 和协议模块（`0d29536` 八个；后续 Timer 候选十个）。保留原配置的 DECISION_ENV=prod 和 120 秒 timeout，去掉全部 triggers；新包不附带签名密钥。原 RELEASE_SOURCE 等历史文件保留，新的 SOURCE_IDENTITY.json 明确它是派生候选。输出逐文件 SHA、固定时间戳 ZIP 和构建收据，不调用云 API。

`tests/writer-worker-bootstrap.test.js` 使用内存事务模型验证九个范围的缺记录拒绝、固定命名空间、鉴权先于存储、业务延迟导入、业务 ok:false 保留、永久重复拒绝、热实例密钥变化拒绝，以及物化到 RDE 的两个范围和签名子请求。这些是模型证据，不是实际包整体业务对拍或真实 SDK 传输证明。

## 封存及实际包离线结果

代码及包来源均为 `0d29536e4ad5dd5b8e7c303ae4b4119b71967d1c`。本地完整 Stage A 99/99、冻结 23 项、候选 31 文件、legacy 自检及显式敏感扫描通过；Actions [217](https://github.com/iquelee/etf-decision-engine/actions/runs/41444383871) 六个 Node16/22/24 × Python3.11/3.12 任务全部通过。既有候选 content `9969ae7472e6690af962cb6a2fb3e7d5c75a2a1a00d6934b82c440911d845aa1` 保持，不扩大其资格面。

| 派生包 | 原包 / 输出文件 | 原依赖逐字节保持 | ZIP SHA256 |
|---|---|---|---|
| RDE | 1799 / 1810 | 1703 | `faeb29c3cce333608c018775f86f42af73094e50b3d7b0b8cb100197b2eb0a78` |
| 物化 | 1791 / 1802 | 1701 | `27724bc1ac163f99a9d834e63e4accfc99ded9944d632daa95f5edb4ced4b304` |

RDE 原 config 已无触发器，生成后其字节也保持；物化 config 仅移除原 timer。所有原包输入在构建后逐文件复核不变。

实际生成包在 Node24.20.0 上经原生 Node require 加载 bootstrap 和业务模块，使用各包自己的 SDK2.11/database1.4.1。缺控制记录/HOLD 的请求走真实 SDK 数据库序列化、内存请求边界，未加载业务、未初始化控制；Node22.22.2 在访问存储前拒绝。防护回放初版拦截 Db.reqClass 被 SDK.database() 重设，未通过；修正到 DBRequest.send 边界后两版运行时通过，不把失败初版计为证据。

另一份独立包回放使用固定时钟、公开合成密钥/数据、共享内存业务集合；控制事务和物化子调用分别经过实际 SDK 序列化，所有网络连接均禁止。原生业务完整返回、RDE 54 次及物化链 539 次业务写入顺序和所有集合值与未修改独立原包基线完全相同；完成后重放同身份零新增业务写入。首次对拍的两个 fixture SDK requestId 不一致导致断言失败，统一模拟 requestId 后完整比较通过，没有删字段或忽略业务差异。原包和两个派生目录结束后再次逐字节核对。

这不是实际 SDK 业务数据库传输、生产集合权限、平台长调用、Timer 重试身份或自然运行证明。完整源码归档和外置核验脚本、两包、逐文件 map、构建收据及 JSON 结果保留于仓外 `writer-workers-0d29536/` 及相邻审计脚本，未放入依赖或凭据到 Git。

## 下一步

继续补齐 Timer/人工根身份和其实际包接线，然后处理后台持久任务确认、所有调用方与旧队列封闭、密钥供应和存储权限验证，才能准备新一批精确授权。最后才是生产迁移和夜间/盘前自然验收。既有 D-026 失败不能因离线测试通过而改记为合格。
