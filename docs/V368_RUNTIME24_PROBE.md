# Node 24 独立 API 探针批次

状态：准备中，未部署。目标仅新建 `apiGatewayRuntime24`；不覆盖同名资源，不设置 timer / HTTP 路由，不切换生产入口，不调用生产决策函数。

## 包与源码身份

探针由两部分组成：

- **原 API 与依赖**：复用 D-016 的源码 `49e7c765c586bb81dc707849992fa7386b9a663c`，原批准 ZIP SHA256 为 `0ea5509e8c0021a5159cbfc1acaa4d7df196145c2afe577ba3fbac7b2312b2ae`。本次重新独立下载生产 API，与该批准包的 1,796 个文件逐一原始 SHA256 对拍，无差异。API 的 `RELEASE_SOURCE.json` 保留原身份，不冒充新 wrapper 的提交。SDK 仍为 2.11.0，不在本批升级依赖。
- **固定探针入口**：[runtime24-probe.js](../release/runtime24-probe.js)，其提交和 SHA256 单独写入包内 `RUNTIME_PROBE_SOURCE.json`，与原 API 身份分开。另替换嵌入的 config.json，清空 triggers 和环境值，防止继承原生产路径配置；这属于部署元数据变化。API index.js、common 和 node_modules 的全部字节保留。

精确范围声明在 [runtime24-probe-plan.json](../release/runtime24-probe-plan.json)。最终 ZIP、文件清单、私有配置指纹和授权请求生成于仓外 `runtime24-probe/`。私有环境变量与角色从新鲜 API 元数据快照取得，不复制到 Git。部署时禁用云端依赖安装；[当前 CLI 帮助](https://docs.cloudbase.net/cli-v1/functions/deploy)明确 Node 22 及以后需自带依赖。

## 调用边界

新函数为 Event 类型，handler=`runtime-probe.main`、runtime=`Nodejs24.11`、256MB、30 秒。通过有权限的管理调用验证，无公开访问路径。生产 API 本身同为 Event 类型，因此保留事件调用模型，避免同时改为 HTTP server。

入口只接受一个字段 `case`，拒绝额外字段和未知用例；客户端不能传任意 path、body、method 或 query。以下事件由入口固定生成：

| case | 实际只读请求 | 核验 |
|---|---|---|
| constants | /api/constants | 权威 run / revision、API 源码身份及实际数据库读取 |
| dashboard | /api/dashboard | SDK 鉴权、权威结果及组合读链 |
| daily / weekly | 513310 日/周 K 线 | 最新窗口、升序、字段与同时段正式 API 一致 |
| history / legacyHistory | 513310，2026-10-01 至 10-27 | provenance 13 条与兼容数组；最终以调用时 pointer 及数据为准 |
| notFound | 固定不存在路径 | 原 API 404 契约 |

响应增加 probe 信息：process.version、随机实例 ID、该实例内调用序号和 handler 耗时；原 API 返回值原样放在 response 字段。实例内序号 1 只证明该模块第一次调用，handler 耗时不等于平台冷启动总耗时；不能把连续调用必定落同一实例当成通过条件。

## 执行与验收

1. 发布前复核干净 wrapper 提交、CI、原批准包及最终 ZIP 的所有指纹；检查同名目标不存在、原 API 配置和文件未漂移。环境/角色配置指纹与批准请求绑定，实际值留在私有文件。
2. owner 批准完整 wrapper SHA、最终包 hash 和新建资源范围后，只创建这一个 Event 函数。无覆盖参数；存在同名资源或平台不支持 Runtime 时停止，不回退成 Node 20 / 22、不删旧函数、不扩大权限。
3. 创建后立即独立下载逐文件核验，检查 Runtime、Handler、内存、timeout、环境/角色和零触发器。核验无额外 HTTP 路径及托管配置改变。
4. 只调用探针的固定用例，回传 Node 必须为 v24.*；SDK 500 / 缺 pointer / 日期窗口错误均不得通过。constants 前后两次 pin 对比，以相同权威 run 的读取结果作判断；发生自然发布则重取基准，不能把合法的新发布误判成探针写入。
5. 比较已有函数的代码及配置、路由/托管清单。自然生产运行导致的 pointer/runtime 变化单独解释，不把必须完全不变作为阻断自然管线的理由。

Node 16/22/24 的单元测试覆盖入口拒绝、固定 GET 路径、参数隔离、响应保留和实例计数；本机包验收只模拟数据库边界，不能代替云端 SDK 网络证明。云端验证完成后才能另行准备生产路由切换。验证失败时停止调用并留存诊断；新建探针的清理由独立明确操作处理，不删除任何原生产函数。
