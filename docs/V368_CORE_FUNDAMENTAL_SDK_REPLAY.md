# V3 core 新闻与抽取：实际 SDK 离线业务对照

2026-11-11。本步仅验证 fetchFundamentalNews / extractFundamental，未改两者原始业务、common、预算、Gen1/Gen2或任何云资源。新增仓外包回放工具，修复离线数据库模型在载入历史快照后生成重复主键的问题；显式传入重复主键仍被拒绝。

## 包与证据边界

使用既有 Core 四包中的新闻、抽取两包，源码均为 `b91e7913096c0a04782a1571f6f826ed5e306de3`；不将本步工具提交冒充包源码，也不将它们与最新后台/宿主包视为同一发布批次。原始输入绑定历史下载 ZIP/map，不是11-11新采集的线上状态。

| 目标 | 文件数 / 原依赖文件数 | 原函数预算 | ZIP SHA256 |
| --- | --- | --- | --- |
| fetchFundamentalNewsNode24 | 1740 / 1701 | 540秒 | `b63834c09f4c08ec252d240b0b405bed37b4a959b5e8986f5ccc3508189bd80b` |
| extractFundamentalNode24 | 1740 / 1701 | 180秒 | `afc39c42643ec7a7360bdee1fe3a5e4f0c16da90499a2cb437ffb901c87aa14d` |

独立 Python 核验直接读取 ZIP：全部 map/ZIP 摘要、12个 Git 封存模块、原始依赖及其他未改业务字节匹配；三个 SDK import 各只替换一次；原目录项和文件模式保持，business.js继承原index模式，新增模块为普通文件，时间固定1980。候选 envVariables 为绑定清单要求的空对象，triggers为空，没有供应真实provider或签名key。没有重建或覆盖历史包。

仓外证据位于 `_v3-core-review-20261027/core-fundamental-sdk-20261111`：两份ZIP/map、独立核验器、结构化实际SDK报告、最终原始日志及试跑日志。公开收据为 `release/runtime24-writer-core-fundamental-sdk.json`。

回放使用 Node24.20.0、包内 CloudBase SDK2.11.0 / database1.4.1 / BSON / Axios，实际加载两侧 index/common/db/datasource/解析/聚合代码。只在 DBRequest.send 和 Axios adapter 提供内存数据；新闻确实由HTML/JSON/JSONP解析入库，抽取确实解析LLM JSON、校验指标/持仓并聚合，不替换datasource函数或业务返回。

子进程只继承系统运行路径，provider/signing值全部为明确fixture；禁用HTTP、HTTPS、socket、DNS及fetch外连，最终网络尝试和云调用为0。所有业务表预先存在，ensureCollection仅模拟“已存在”响应并单独比对，没有创建资源。固定时钟和加速sleep只用于确定性对照，不证明耗时/并发/预算真实可用。

## 实际业务对照

| 新闻场景 | 每侧业务写 | provider fixture请求 |
| --- | ---: | ---: |
| 完整抓取，含DART | 66 | 59 |
| 已有表更新及SEC增量跳过 | 49 | 59 |
| DART key缺失 | 62 | 56 |
| 新鲜running跳过 | 0 | 0 |
| 过期running收尾 | 63 | 56 |
| 剩余预算不足的partial | 16 | 11 |
| 快讯provider失败 | 61 | 56 |
| 单家SEC保存 | 1 | 1 |
| 仅港股收入 | 2 | 1 |

九组共每侧320次写。完整场景解析4条跨市场持仓、29条公告/事件、16家SEC财报、2家DART、港股收入、4条生物医药事件和4项宏观数据；港交所月报及无关快讯被原逻辑排除。快讯失败仍可能由原业务返回ok:true且errors为空，但fetch_log记录fail；本步保留这一行为，进一步说明调用COMPLETE和业务ok均不能单独作为全量成功证明。

| 抽取场景 | 每侧业务写 | provider fixture请求 |
| --- | ---: | ---: |
| key缺失 | 1 | 0 |
| 无待处理新闻 | 26 | 0 |
| 有效证据及硬指标/跨赛道保护 | 36 | 3 |
| LLM空结果 | 32 | 3 |
| LLM JSON损坏 | 28 | 3 |
| 财报传导 | 40 | 5 |
| 硬数据与既有证据重聚合 | 29 | 0 |
| 新闻输出表→实际抽取入口 | 73 | 23 |

八组共每侧265次写。正常混合新闻只生成两条合法证据，既有dram_price=123保持；鲁抗core_sales、跨赛道海力士、硬指标与未知indicator被排除。空结果保留extract_empty，损坏JSON记录组错误；rollup_all实际重聚合1个合法格子，同时过滤圈外证据。共享表场景取完整新闻场景的原样快照，保持已有ID和全部集合，再分别交给两侧实际抽取入口；处理6条有效结果，财报/硬数据累计9项。它是顺序共享表业务闭包，没有通过部署的Timer或宿主触发两个业务。

17组的完整业务返回、写入payload/顺序及所有最终表逐位相同；逐项重复相同签名请求均无新增业务/HTTP。坏会话、真实LLM质量、上游实时可达性和数据真实性不由这些合成响应证明。

## 确认丢失

新闻与抽取各验证准入commit实际成功但丢ACK、完成commit实际成功但丢ACK，共4组。前者业务零执行、双回执RUNNING；后者分别完成66/36次业务写，完整写入及最终表与未加准入基线相同、双回执COMPLETE。两类由封存调用方协议进入HOLD，重投不发第二次子调用、不增加业务。

这里明确区分签名worker与native timer入口：签名worker报告不确定状态，调用方负责HOLD；不能把worker直接返回当作timer facade行为。故障用包内createFacade及单次内存传输桥覆盖调用方协议，其静态预算参数仅为fixture校验，不是部署配置、实际SDK长转发或函数预算缩短。两包540/180秒原配置保持。

## 验证与下一步

完整Stage A为112/112；数据库模型新增历史快照主键回归在Node22/24通过。当前候选敏感扫描、冻结23项、31文件清单、legacy扩展及负向证明另由发布检查记录。

下一步是长任务完成协议与异常对账。现有宿主15秒传输和最多135秒允许值不能据此承接新闻540秒/抽取180秒；此前115秒隔离转发丢响应也不能当作业务失败或允许重发。需要把“已派发”“worker持久终态”“业务摘要”分开，按精确请求/token/owner/epoch读取并原子核验；未知执行不自动重发，不凭worker COMPLETE解除其他HOLD或排空占用。业务摘要若要新增持久字段，必须先形成独立离线协议和包，再申请精确云端范围。

随后还需统一七个Core包源码、宿主接实际child、队列/实例排空、原生Timer/HTTP网关与最新线上漂移核验。当前没有生产迁移、自然运行或云端长任务验收通过的结论。
