# 正式 API 的 Node 24 迁移准备

日期：2026-10-29（北京时间）。状态：**候选准备，尚未创建函数或切流**。

主引擎 D-018 已通过夜间与盘前自然运行验收；D-017 已证明固定只读探针在 Node v24.11.1 / SDK 2.11.0 下完成实际鉴权及数据库读取。本批准备完整 `index.main` API，保留现有正式函数及探针。工程发布仍为 V3.6.8，策略族 V3.6.1，无策略或 ML 权限变更。

## 已确认的线上入口

2026-10-29 只读调用 `DescribeHTTPServiceRoute`（不加 DomainType 过滤），取得两个域名的完整清单：静态托管域包含 `/`、`/adminGateway`、`/apiGateway`；HTTP 服务域包含 `/check-work`。生产前端使用静态托管域下的 `/apiGateway`。

CLI 3.8.5 的 `routes list` 实现固定增加 `DomainType=HTTPSERVICE`，因此仅列出 `/check-work`。此前台账中的“已列出的 HTTP 服务未变”仍只是该范围，不代表当时已核验所有域名路由。后续发布须对无该过滤的完整清单作前后比较。

生产 API 路由为：

| 字段 | 当前值 |
|---|---|
| Domain | `tradingview-etf-d0fa42yy57cbc11b-1253568636.tcloudbaseapp.com` |
| DomainType / Path | `STATIC_STORE` / `/apiGateway` |
| UpstreamResourceType / Name | `SCF` / `apiGateway` |
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

证据目录：仓外 `_v3-core-review-20261027/runtime24-api/`。此文档为准备记录，未宣称创建、真实云端完整 API 验收或生产切流已完成。
