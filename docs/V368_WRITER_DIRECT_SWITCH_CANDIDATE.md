# 全调用方切换：直接调用候选

状态：**OFFLINE_CALLER_ADAPTER_NOT_DEPLOYABLE**，2026-11-02。本批没有修改生产入口、函数包、路由、timer、密钥、IAM或数据库，不新增部署台账。D-026的长转发失败以及6条HOLD现场保留；不以本地测试替代真实迁移或自然验收。

## 已实现的直接调用边界

`release/writer-direct-caller.js`把已识别调用方的一次逻辑调用直接发送到控制记录选定的旧或新worker，不引入稳定函数名门面产生的第二跳。环境、调用方函数名及Node主版本需匹配服务端运行身份，签名key必须显式提供且至少32字节，没有生产默认key。业务事件声称的owner、epoch、target、force、from不决定实际路由。

请求ID由已认证入口在外层捕获，解析器不接收业务载荷；可使用已有scheduled/manual/child身份函数。这个接口**尚不是实际Timer/HTTP身份适配器**：不能用context.request_id、交易日pipeline_run_id或payload.from填充缺口。原生Timer重试稳定性仍NOT_RUN，人工operation_id生成、认证和持久化仍待接线。

调用只发到一个已封存目标、显式retries0，不fallback。成功时仅剥离worker准入包装，保留原SDK的`{requestId,result}`及业务结果（含ok:false）。已有调用方读取的是SDK包装，不能把门面的裸业务返回直接替换进去。已知准入拒绝直接拒绝；投递/完成不明按同owner/epoch尝试HOLD并附hold_confirmed，原始传输错误message/cause保留；迟到worker不能重开HOLD。

传输预算由调用方明确提供，已有显式timeout可以保留。锁定SDK2.11.0的cloudbase.js默认配置timeout15000，httpRequest.js按opts→config→default取值；当前三条已下载入口初始化时仅指定env，测试使用15000并覆盖23000显式值。RDE函数120秒业务预算不缩短。**去掉额外门面不等于SDK支持120秒同步等待**：D-026失败事实仍成立，长调用仍可能UNKNOWN。这里保留原调用路径的超时/错误契约及安全关闭，不声称平台时限问题已经通过。

## 完整入口及共享数据库回放

- 直接worker回放：完整未改RDE返回、54次实际写入及全部落库载荷与基线相同；20路竞争仅一份业务加载；真实第一笔业务写暂停后模拟调用方失联，原错误文本保持、无fallback、迟到完成后HOLD保持。
- 完整调用方回放：未改物化→RDE、后台风险解除/风险触发/参数变更→RDE，共享同一个内存数据库，保留原payload、SDK包装、完整上游返回及写顺序/全部数据。物化链539写，三个后台案例各55写。没有只调用孤立的下游函数来宣称上游接线完成。
- 对adminGateway、materializeIndicators、runDecisionEngine三份历史独立下载执行同一回放，读取前后逐个核对原始map与全部字节，各包自己的common保持隔离，没有把4项旧common差异覆盖成canonical。Node22.22.2/Node24.20.0通过。这是合成输入/内存传输，不是生产数据执行。
- 真实SDK2.11.0函数JSON/response_data序列化在Node22/24通过，每次回放26个内存请求、网络0；不等于真实长调用通过。
- 回放器新增显式内存callFunction hook和额外入口/common路径映射，默认仍拒绝函数调用及https/越界文件读取。其受控验证文件LF指纹同步更新，旧锁和七类禁止错误不放宽。

## 不能遗漏的父入口写门禁

完整后台回放还刻意关闭了RDE准入：风险触发先写risk_events，再得到下游writer admission closed。该案例证明仅替换app.callFunction**不能**冻结后台业务写。它是缺口证据，不是维护模式PASS。真实后台401路径仍原样无业务写。

后续维护门禁必须在所有后台写副作用之前建立；不能只禁用UI按钮，也不能把RDE的HOLD当成后台已经关闭。父入口与子阶段若使用同一活动槽会嵌套死锁；需明确各阶段scope及全局切换协调，不能让parent持有RDE槽后再调用RDE抢同一槽。切换必须同时核验所有相关scope、在途调用和旧投递，未知时保持关闭。

## 已核对的调用面及完整目标

以下为仓内实际调用位置，不代表潜在外部SDK/IAM调用已经排除：

| 调用源 | 现有目标 | 切换时必须保持/补齐 |
|---|---|---|
| fetchDailyData/index.js | materializeIndicators | from原样、父请求身份和子阶段身份；旧22:00队列 |
| materializeIndicators/index.js | runDecisionEngine | 原pipeline载荷、SDK返回/错误，08:00与夜间独立身份 |
| adminGateway/postRisk(resolve) | runDecisionEngine | 更新风险前门禁、稳定operation_id、riskResolve语义 |
| adminGateway/postRisk(trigger) | runDecisionEngine | 新风险前门禁、riskTrigger语义 |
| adminGateway/updateParam | runDecisionEngine | 参数写前门禁、paramChange及冻结参数规则 |
| adminGateway/triggerFetch | fetchRealtimeData/fetchDailyData/fetchFundamentalNews/extractFundamental | 动态任务映射与默认daily；异步触发语义及写前维护门禁 |
| common/utils/intel-refresh.js | fetchFundamentalNews | 冷却判定与后台入口，不能只扫描云函数index |
| 原生timers与潜在外部SDK | 对应生产入口 | 真实身份、唯一timer、旧入口封闭/保留期排空 |

最后独立线上基线（D-026，非本轮云端复查）仍有以下9个本项目生产写函数使用Node16：runDecisionEngine120s、materializeIndicators120s、fetchDailyData120s、fetchRealtimeData60s、adminGateway60s、fetchFundamentalNews540s、extractFundamental180s、runGen1ShadowEod300s、runGen2ShadowEod300s。后四类不能因RDE已接线而自动记为迁移成功；冻结策略/模型的字节与业务期限须原样保留。与ETF无关的check-work及保留的旧只读API不冒充生产写链资格。

## 下一项实现与验收顺序

1. 在已认证的入口建立稳定父请求/人工operation身份，明确Timer重复投递证据；接入调用方的逐请求上下文，防并发串用身份或SDK全局污染。
2. 为后台所有写入口建立服务端维护/准入门禁，并给父子阶段分配可协调scope；实际完整入口回放必须证明关闭时第一笔写入都不会发生。
3. 对上述调用边逐一形成最小包overlay；继续独立下载和逐项保留common差异，准备新旧实现共同准入、生产namespace与密钥供应，补齐外部SDK/IAM/6小时队列封闭证据。
4. 绑定完整源码、包、配置与操作序列申请生产批次；全关闭、无未终结旧执行后才能切换，不采用超时自动接管。生产批次不得靠人工调用写函数验收。
5. 全部目标写函数迁移并在下一笔真实夜间、盘前及其他对应自然触发中独立核验运行时、唯一业务/准入回执、5+1发布与生产API一致性，才可关闭总目标。

本文件和当前adapter不构成部署资格或云端操作批准。
