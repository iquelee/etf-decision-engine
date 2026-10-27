# Node 24 独立 API 探针批次

状态：**已部署并完成隔离只读验收（D-017）**。2026-10-27 18:11:43（北京时间）仅新建 `apiGatewayRuntime24`；无 timer / HTTP 路由，生产入口未切换。`runtime24-probe-plan.json` 保留当时的准备快照，不代表当前部署状态。

实际部署的 wrapper 源码为 `17144395c02571f6666e27010c4e9cec9a65cdc3`，API 基线源码仍为 `49e7c765c586bb81dc707849992fa7386b9a663c`。后续台账/文档提交不改变这两个云端身份。

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

## D-017 云端结果

- owner 在完整 SHA / 包指纹 / 范围请求后回复“继续”，按该范围记录授权并执行一次创建；未扩大到生产切流或写链迁移。
- Runtime=`Nodejs24.11`，实际 `process.version=v24.11.1`；handler=`runtime-probe.main`、30 秒、256MB、Event、零触发器，依赖安装关闭；环境和既有角色与私有批准配置相符。
- 候选 ZIP SHA256=`ce61dfb72521015cf08ca6ca77f686a0fc665865ab293bea6e18b27c68bd6d20`。创建后独立下载 **1,798/1,798 原始 SHA256 精确匹配**；CodeSize=4456487。
- 七类固定用例全部通过，共 8 次调用（含首尾两次 constants）。观察到 2 个实例，均回传 Node v24.11.1；没有假定连续调用始终命中同一实例，也不把少量采样当性能基准。
- 日线 **320 根，2025-07-02~2026-10-27**；周线 **210 根，2023-05-12~2026-10-26**。完整 payload 与正式 API 稳定的前后响应相同，日期另与数据库最新窗口对拍，均升序。
- history 增强响应 **13 条 / status=OK**，旧数组 **13 条**，均与正式 API 完全相同；notFound 返回原 API 的 404 契约。
- 看板 authority、version_identity 及五个 production card 对象与正式 API 一致。首尾常量及看板均指向 2026-10-26 的 revision 14 / COMPLETE，latest_fallback_used=false。SDK 2.11.0 已完成本批真实云端鉴权与多集合读取；未据此宣称 SDK 写入、所有函数或全部业务均兼容。
- 原 11 函数的列表代码/配置字段未变；五个重点函数的 Runtime、Handler、内存、超时、环境、触发器、角色及代码元数据逐项不变。托管对象、已列出的 HTTP 服务、生产 pointer/runtime 状态未变。无生产决策调用、无 timer/路由变更、无资源删除。
- 主引擎 `ffd2b4f…` 新 source 的 manifest/history 仍各 0 条，自然运行验收继续待办。部署源码的本机完整 Node 84/84、Actions #190 六组 CI 已通过。

报告和原始快照位于仓外 `_v3-core-review-20261027/runtime24-probe/{DEPLOYMENT_REPORT.json,DEPLOYMENT_REPORT.md,read-verification.json,creation-verification.json,probe-download/}`，不包含在 Git 中。

下一步准备实际生产 API 的 Node 24 候选及入口绑定方案。当前探针只接受固定 case，**不能直接接入现有前端 HTTP 请求**；须另行准备 `index.main` 的正式处理入口，验证现有 /apiGateway 路径和网关事件映射，再以独立范围安排切流和旧入口回退。主引擎写链迁移仍在自然运行验收之后。
