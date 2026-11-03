# 其余六个写函数的实际包与 Gen2 Timer 适配

2026-11-03 只读观察；未部署、未调用云函数、未执行生产写入。脱敏记录见 [六函数清单](../release/runtime24-writer-six-inventory.json)，原始 ZIP、完整逐文件 map、配置和下载前后回读存于仓外 `writer-six-packages-20261103`。检查基于独立工作分支；主分支及待批原生隔离申请所绑定的 `5a448533c175ad4dd0296fc23f577f918717db0e` 保持不变。

| 函数 | 原运行时 | 超时 / 内存 | 实际包文件数 | 入口与仓库 LF 归一后一致 |
|---|---|---|---|---|
| fetchDailyData | Node16.13 | 120秒 / 256MB | 1767 | 是 |
| fetchRealtimeData | Node16.13 | 60秒 / 256MB | 1791 | 是 |
| fetchFundamentalNews | Node16.13 | 540秒 / 256MB | 1725 | 是 |
| extractFundamental | Node16.13 | 180秒 / 256MB | 1725 | 是 |
| runGen1ShadowEod | Node16.13 | 300秒 / 512MB | 1632 | 否 |
| runGen2ShadowEod | Node16.13 | 300秒 / 256MB | 1624 | 否 |

合计10264个文件；六个 ZIP 的原始 SHA256 均与平台 `codeSha256` 一致，逐条 ZIP 内容与本地证据文件及 map 一致，下载前后控制配置一致。六包均为 SDK2.11.0 / database1.4.1，未安装或升级依赖。Gen1 的当前1632文件 map 与当日已记录的实际基线完全相等。

日线原 ZIP 含五个 `node_modules/.bin` 符号链接。下载检查最初因禁止符号链接而停止；后续独立确认只有已列明的 npm 命令入口、相对目标均在 node_modules 内。保留原 ZIP 和链接属性，证据目录仅把链接目标文本落为普通文件，不创建或执行符号链接。逐文件内容 map 不能表达文件类型，因此该目录不能直接当部署树；未来封包必须保留原 ZIP 链接类型，不能以普通文件 hash 相等冒充类型相等。

Gen2 包不含 config.json。其300秒/256MB来自云端实际配置；现有三包打包器假设配置文件存在、index.js 必有 SDK import，也不适用于两个 shadow 入口。后者只经 common/db 和 common/intel-refresh 引用 SDK。不能直接套用三包打包器，也不能用仓库中不同的入口替换线上业务后宣称只迁移运行时。

归档 config 的环境变量名与线上实际环境变量名并非完全一致：例如日线归档另列 TUSHARE_TOKEN/AKSHARE_PROXY，新闻归档另列 OPENDART_API_KEY；只读线上配置没有这些项。新清单分开记录实际变量名与可公开的 DECISION_ENV=prod，未来密钥供应以新鲜线上配置为准。候选不携带数据源凭据值或签名密钥。六包预检首次因错误的统一256MB断言而停止；更正为保留清单中的实际内存，尤其 Gen1 512MB，没有生成该次候选目录或改云资源。

## 实际 Gen2 的 Timer 业务契约

Gen2 线上入口包含仓库当前版本没有的 Timer Message JSON解析、版本闸门和显式模式契约。通用候选原先给全部生产者传固定文本 `writer-root-timer-v1`；在实际 Gen2 中，这会在读取行情前返回 `EVENT_PARAM_INVALID`，写三条诊断/blocked 记录。协议层正常完成、去重成功并不代表 shadow 业务完成。

依据[官方 ListTriggers 接口](https://cloud.tencent.com.cn/document/api/583/44268)取得原生配置：`gen2-eod-weekdays-2230` 当前 Enable=1、Qualifier=$LATEST、CustomArgument 精确为 `{"mode":"REPLAY"}`。这是只读观察，不据此推断该 Timer 每次均运行成功，也不改为 LIVE。

离线 `writer-timer-identity.messageFor('runGen2ShadowEod')` 现在只接受上述精确 JSON 字符串，并原样传给业务；其他生产者仍使用各自候选的既有固定文本。实际 SDK 来源、固定函数名/环境/Node24、注册 TriggerName、固定时刻和重投身份检查继续生效。泛用文本、LIVE、附加字段或未封存的另一种 JSON 字节表示均拒绝，不在运行时替调用方猜模式。

`scripts/writer-gen2-timer-compatibility.js` 要求显式实际包和 map，绑定清单中的 map/入口 hash，回放前后核对全部1624文件。它通过 VM 仅开放实际 bundle 的只读文件接口、常量及内存 DB，不加载实际 SDK、不联网：先复现原泛用文本的三写 blocked，再对保持 REPLAY 的完整真实 main 比较加入口前后的业务返回、31次行情读取和98次写操作全部 payload。30条排名、31条候选腿及结果保持，重复入口零新增读写。这里的合成历史只是离线机制 fixture，不是当前自然行情或业务资格升格。

本地完整 Stage A 103/103、敏感扫描和冻结23项通过；实际 Gen2 入口回放及 Timer 回归在 Node22/24 均通过。原生来源与重试尚未执行，这些结果不替代真实 SDK/平台验证。

尚需其余实际包的完整业务回放、保留类型和依赖的候选封包、后台异步持久派发、真实原生来源/重试与请求头证明、密钥及控制记录供应、旧调用闭包/队列排空和九节点自然运行验收。现有三包构建物也须更新入口修复后重建；本轮没有形成生产发布申请。
