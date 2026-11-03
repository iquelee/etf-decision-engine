# 正式 API 的 Node 24 迁移准备

日期：2026-10-29（北京时间）。状态：**D-019 创建验收完成，D-020 已于12:49:50切换原生产API路由并验收通过**。当前原域 `/apiGateway` 指向 `apiGatewayNode24`（Nodejs24.11）；旧函数保留。详见 [切流结果](V368_RUNTIME24_API_CUTOVER.md)。下文创建阶段事实保留。

主引擎 D-018 已通过夜间与盘前自然运行验收；D-017 已证明固定只读探针在 Node v24.11.1 / SDK 2.11.0 下完成实际鉴权及数据库读取。本批准备完整 `index.main` API，保留现有正式函数及探针。工程发布仍为 V3.6.8，策略族 V3.6.1，无策略或 ML 权限变更。

## 已确认的线上入口

2026-10-29 只读调用 `DescribeHTTPServiceRoute`（不加 DomainType 过滤），取得两个域名的完整清单：静态托管域包含 `/`、`/adminGateway`、`/apiGateway`；HTTP 服务域包含 `/check-work`。生产前端使用静态托管域下的 `/apiGateway`。

CLI 3.8.5 的 `routes list` 实现固定增加 `DomainType=HTTPSERVICE`，因此仅列出 `/check-work`。此前台账中的“已列出的 HTTP 服务未变”仍只是该范围，不代表当时已核验所有域名路由。后续发布须对无该过滤的完整清单作前后比较。

生产 API 路由为：

| 字段 | 当前值 |
|---|---|
| Domain | `tradingview-etf-d0fa42yy57cbc11b-1253568636.tcloudbaseapp.com` |
| DomainType / Path | `STATIC_STORE` / `/apiGateway` |
| UpstreamResourceType / Name | `SCF` / `apiGatewayNode24`（D-020；切流前为 `apiGateway`） |
| Enable / EnableAuth / EnableSafeDomain | true / false / true |
| EnablePathTransmission / PathRewrite / QPSPolicy | true / `{}` / `{}` |

完整路径透传给 Event 函数；现有 `index.main` 会剥掉 `/apiGateway` 前缀。保留该行为和前端 URL，未来切流仅替换这条 Domain+Path 的上游名称。不能把 HTTP 服务默认域误作生产域，也不需要改动 `/` 或 `/adminGateway`。

## 两阶段执行范围

1. **创建与云端只读验收**：新建 `apiGatewayNode24`，Event / Nodejs24.11 / index.main / 30s / 256MB，零 timer，依赖安装关闭；沿用现有环境与角色，不扩大权限，无公开路由。真实 API/common/SDK/RELEASE_SOURCE 字节与新鲜独立下载的 D-016 基线一致；包只新增独立迁移身份、清空嵌入 config 的环境和触发器。API 源码身份继续为 D-016，不以迁移计划提交冒充 API 实现提交。
2. **生产路由切换**：先完成新函数独立下载、配置和全部固定 GET 事件验收，再针对确切路由差异单独申请批准。用增量更新将 `/apiGateway` 的 UpstreamResourceName 从 `apiGateway` 改为 `apiGatewayNode24`，其余字段不传、不变；旧函数保留。创建阶段授权不包含此操作。

创建/调用与后续切流均需完整源码 SHA、包指纹、私有配置指纹和具体范围绑定授权，见 [迁移计划](../release/runtime24-api-plan.json)。现有固定 case 探针不改为生产入口。

## 验证与回退

- 准备时独立下载正式 API，与 D-016 的 1,796 文件按原始 SHA256 对拍；新建目标必须不存在。私有完整配置、下载包、真实数据和基线清单留在仓外。
- 本地加载实际封包 API/SDK，数据库 I/O 使用离线快照；覆盖真实路由的透传/无前缀/事件别名、日周 K 线和错误响应。该回放不能代替新函数的实际云端鉴权与数据库读取。
- 创建后通过管理调用验证 constants、dashboard、ETF list/detail、daily/weekly、增强/旧数组 history、portfolio、review、fundamentals、intel、macro、notFound；固定 GET 事件，不调用生产写函数。当前 API 不按 method 拒绝已知只读路由，不能在本次迁移顺带改写这一既有契约。
- 前后 pin 同一 authority 与 source/context；比较五个 production card、历史 status/日期/行、完整 K 线 payload，另核对数据库最新日期窗口。观察到自然发布则重新取基线，不强制 pointer 不变。
- 未来切流后从原生产域名实际 GET 验证前缀和 query 映射、响应、CORS、原 notFound 契约，确认完整域名路由清单仅目标上游变化。直接管理调用通过不等于 HTTP 映射已通过。
- SDK 错误、日期/权威/payload 不符或映射不明即停止。未来切流失败，增量恢复同域同路径的旧上游 `apiGateway`，再从原域验证；不删除函数、路由或重建生产资源，不通过前端改地址代替恢复。

参考：[HTTP 网关路由管理](https://docs.cloudbase.net/cli-v1/routes)、[网关字段与路径透传](https://docs.cloudbase.net/cli-v1/gateway)。本机实际 CLI 3.8.5 未提供较新文档的 upstreamResourceVersion 参数，本批不引入版本绑定。

证据目录：仓外 `_v3-core-review-20261027/runtime24-api/`。前述为准备阶段设计；runtime24-api-plan.json 保留准备快照，实际创建与验收事实以下方 D-019 为准。生产切流尚未执行。

## D-019：完整入口 Node 24 API 创建与只读验收（2026-10-29）

owner 对迁移源码 `c82e5b5c691f5aaf87ab7d3e0a85ff1812c2b423`、包指纹及仅创建/固定只读范围回复“批准”。仅创建 `apiGatewayNode24` 一次、exit 0；AddTime/ModTime **2026-10-29 09:21:49**（北京时间），CodeSize **4455567**。Event / Nodejs24.11 / index.main / 30s / 256MB，零 timer、依赖安装 FALSE，环境和既有角色与批准私有配置一致。

候选 ZIP SHA256 **`86b5e7428bc3aeeebafba8d8ecf801c9ce966709aae075edfba55964fa372485`**。独立下载 **EXACT_MATCH 1797/1797**，原始 SHA256 零差异；相对新鲜核验的 D-016 API 仅 RUNTIME_MIGRATION_SOURCE.json / config.json 不同，API/common/SDK 2.11.0/RELEASE_SOURCE 字节未变，API 实现身份仍为 `49e7c765c586bb81dc707849992fa7386b9a663c`。独立回滚基线 ZIP SHA256 `50b181558d721c49f60f5bb00046d91ed03fce2479e48ed5f0f668850405722e`，未使用回滚、未作实际回滚演练。

14 类固定 GET 全部通过：constants、dashboard、ETF list/detail、日/周 K 线、增强/旧数组 history、portfolio、review、fundamentals、intel、macro、notFound。完整响应与原生产 HTTP API 前后稳定基线一致；仅排除源码中明确逐请求生成的 `ml_shadow.generated_at`（校验 ISO 格式及时间新鲜度），排除路径另存报告，不忽略其他业务字段。看板五个 production card、权威/source/context 保持一致，历史为 OK。三个声明的事件形式一致。共 **18 次成功鉴权调用**（17 次验收含首尾 constants，加一次诊断 constants）。

日线 **320 根，截至 2026-10-29**；周线 **212 根，截至 2026-10-28**。完整 payload、升序及最新数据库窗口匹配；增强历史 1 条 / OK，published_through=2026-10-28，旧数组兼容；notFound 保留 API code404。日线最新日期与正式决策交易日是不同轴，不用盘中 K 线日期改写正式发布身份。

原生 SCF Invoke 通道返回 CAM 鉴权失败（包括同一 API Key 新会话），发生在业务执行前；额外带 Stamp 的诊断被接口拒绝为 UnknownParameter。改用同一环境 API Key 的 CloudBase `functions.invokeFunction` 鉴权通道成功，凭据只在内存/子进程 stdin 中传递，不改 IAM/角色/安全规则/登录存储或云端依赖。上述原生通道失败不算成功调用，不据此归因 Node 24 或 SDK 业务不兼容。此处平台配置为 Nodejs24.11；未修改正式响应来额外暴露 process.version，也不把 D-017 的进程版本采样冒充本函数实测。

原 **12 个函数**列表代码/配置字段未变；六个重点函数的运行时/入口/超时/内存/环境/触发器/角色及代码元数据未变。完整两个域名的路由前后不变，ETF 前端 67 个入口/依赖对象元数据未变。共享托管清单观察到 `kindle/` 目录的并发变化，逐项保留在边界报告；本批没有托管上传，不能宣称全域所有对象不变，也不把这些变化归因于本批。pointer 是否变化=False，runtime 是否变化=False；自然变化不作人工冻结。

工程校验沿用绑定源码的本机 Node24 Stage A 85/85、实际封包 Node22/24 离线回放及 Actions #195 六组成功；CI portable83、两份私有历史回放及15段收据 NOT_RUN 的证明边界保留。额外本机 Python stage 中断不计通过。

**生产 `/apiGateway` 仍指向旧 `apiGateway`，未切流、未新增公共路由。** 本条证明独立完整入口及实际 SDK 鉴权读取；新函数公共 HTTP 映射尚未验证，须待另批路由授权并在原域验收。未更新现有函数、触碰 timer/策略/ML 权限或调用生产决策；未删除资源。

证据：仓外 `_v3-core-review-20261027/runtime24-api/execution/`（授权、独立下载、固定调用、HTTP 对照、原生通道诊断、完整路由和托管边界）。后续文档提交不改变已部署迁移或 API 实现源码身份；PR 保持 draft、未合并。
