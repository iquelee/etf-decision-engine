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

归档 config 的环境变量名与线上实际环境变量名并非完全一致：例如日线归档另列 TUSHARE_TOKEN/AKSHARE_PROXY，新闻归档另列 OPENDART_API_KEY；只读线上配置没有这些项。新清单记录实际变量名；连接器将值隐藏，当前 public_environment 为空，不能从归档值推断线上值，连 DECISION_ENV 也留待精确供应。候选不携带数据源凭据值或签名密钥。六包预检首次因错误的统一256MB断言而停止；更正为保留清单中的实际内存，尤其 Gen1 512MB，没有生成该次候选目录或改云资源。

## 实际 Gen2 的 Timer 业务契约

Gen2 线上入口包含仓库当前版本没有的 Timer Message JSON解析、版本闸门和显式模式契约。通用候选原先给全部生产者传固定文本 `writer-root-timer-v1`；在实际 Gen2 中，这会在读取行情前返回 `EVENT_PARAM_INVALID`，写三条诊断/blocked 记录。协议层正常完成、去重成功并不代表 shadow 业务完成。

依据[官方 ListTriggers 接口](https://cloud.tencent.com.cn/document/api/583/44268)取得原生配置：`gen2-eod-weekdays-2230` 当前 Enable=1、Qualifier=$LATEST、CustomArgument 精确为 `{"mode":"REPLAY"}`。这是只读观察，不据此推断该 Timer 每次均运行成功，也不改为 LIVE。

离线 `writer-timer-identity.messageFor('runGen2ShadowEod')` 现在只接受上述精确 JSON 字符串，并原样传给业务；其他生产者仍使用各自候选的既有固定文本。实际 SDK 来源、固定函数名/环境/Node24、注册 TriggerName、固定时刻和重投身份检查继续生效。泛用文本、LIVE、附加字段或未封存的另一种 JSON 字节表示均拒绝，不在运行时替调用方猜模式。

`scripts/writer-gen2-timer-compatibility.js` 要求显式实际包和 map，绑定清单中的 map/入口 hash，回放前后核对全部1624文件。它通过 VM 仅开放实际 bundle 的只读文件接口、常量及内存 DB，不加载实际 SDK、不联网：先复现原泛用文本的三写 blocked，再对保持 REPLAY 的完整真实 main 比较加入口前后的业务返回、31次行情读取和98次写操作全部 payload。30条排名、31条候选腿及结果保持，重复入口零新增读写。这里的合成历史只是离线机制 fixture，不是当前自然行情或业务资格升格。

本地完整 Stage A 103/103、敏感扫描和冻结23项通过；实际 Gen2 入口回放及 Timer 回归在 Node22/24 均通过。原生来源与重试尚未执行，这些结果不替代真实 SDK/平台验证。

尚需六候选的完整 SDK 业务回放、后台异步持久派发、真实原生来源/重试与请求头证明、密钥及控制记录供应、旧调用闭包/队列排空和九节点自然运行验收。现有三个早期构建物也须更新入口修复后重建；本轮没有形成生产发布申请。

## 六个实际派生包已离线生成

`release/prepare-writer-six-workers.js` 绑定完整干净源码 `9cbad9ea19e5d9918caad79ec27679647dd24bbc`，逐包从上述实际 ZIP/文件map派生候选；不安装依赖、不调用云 API。新增的 `writer-preserve-zip.py` 从封存 Git 源码执行，保留原 ZIP 文件类型、权限和五个日线 npm 链接。SDK import 仅在明确列出的文件中替换，Gen1/Gen2 的 business.js 与实际原 index.js 逐字节相等；不把当前仓库中不同的业务混入。原生 Timer 的候选入口保留 Gen2 REPLAY 契约；配置内 Timer 列表为空，尚无供应的环境值/签名密钥全部缺省拒绝。

候选文件数分别为日线1782、实时1806、新闻1740、抽取1740、Gen1 1647、Gen2 1640。超时逐包保持120/60/540/180/300/300秒；内存保持256/256/256/256/512/256MB。见[脱敏构建收据](../release/runtime24-writer-six-candidates.json)。没有产生可执行的 CloudBase 发布配置。

独立 Python 校验直接读取原/新两个 ZIP，核对全部内容、依赖字节及文件属性、原业务与单点 import 替换、各 wrapper 的 Git blob、配置无 Timer/凭据值和资源预算；六包通过。三个输入配置内可检查的长数据源凭据值，在候选所有非依赖文件中均未出现。六个实际 Node24 包分别加载了自己的 SDK2.11，并在禁止网络的子进程中确认：缺签名密钥时，SDK init 为零、业务模块不可取得。这只是负向加载验证，尚未证明六候选经真实 SDK 的完整业务写链。

第一份生成尝试还发现 Python CLI 参数个数断言错误，只有日线部分目录和map，没有 ZIP/总收据；保留失败目录。修复后新增隔离临时目录中的 ZIP 专项测试，验证命令行调用、可执行权限、符号链接、重命名业务字节及路径/链接越界拒绝，通过后在全新 v2 目录完成全部六包；没有把失败产物补写成通过。以上均为离线过程。

新增 ZIP 测试后，本地完整 Stage A 104/104、敏感扫描通过，ZIP 专项在 Node22/24 均通过；待批原生隔离申请再次封存核验通过，云调用零次。包来源源码保持上述9cbad9e完整SHA，后续文档提交不改变这些 ZIP 的嵌入身份。

草稿 PR70 的首次远端 Actions231 六组均通过测试、冻结及 reader 门禁，但最终 legacy 检查拒绝新增 Gen2 回放脚本未登记。现将该脚本加入既有逐文件哈希的隔离验证清单，只接受精确路径、错误类别和脚本 hash；新增篡改、未知相邻路径及全部七种永久禁止项的负向断言。因为登记器本身属于31项候选面，仅更新 V368 候选中该登记器的一项 hash，其余30项保持；候选内容指纹由9969ae7472e6690af962cb6a2fb3e7d5c75a2a1a00d6934b82c440911d845aa1变为45a435293a806a45b203d50a03db2fc2eac2bbd6266679b7989076c6f6cd8d54，仍为CANDIDATE。旧 V365 manifest、V361/V364 锁、基准61项和七种永久禁止错误均未改。候选31项与完整 legacy 负向自检已在本地重新通过；新远端结果须另行观察，不能把首轮失败计为通过。这不改变主分支5a的清单或待批申请。
