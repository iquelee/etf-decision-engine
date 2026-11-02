# 写链入口接线候选（2026-11-02）

状态：**OFFLINE_ENTRY_CANDIDATE_NOT_DEPLOYABLE**。D-024隔离事务验证已完成；本批新增真实业务入口之前的身份、签名、准入与单次转发代码，没有改生产入口、配置、角色、定时器或数据库，不追加部署台账。

## 当前代码

`release/writer-entry.js`可组合旧/新worker及稳定转发入口，复用D-024验证过的四个协议/适配模块，未修改它们。

- scheduledRequest以环境、producer、trigger和**显式提供的计划发生时刻**生成身份，不使用交易日、当前时钟或attempt；夜间和盘前分开，同一计划发生时刻的重传保持相同身份。manualRequest要求上游稳定operation_id，不同操作/动作分开；childRequest从父请求和子阶段派生，关联ID继续保留原用途。
- 转发侧从控制记录取得owner/epoch/revision和静态目标映射，忽略调用事件中的owner/target声明；对完整业务payload、身份和目标生成HMAC。签名密钥是必填依赖，无默认值；本批只用了公开的合成测试Buffer，未生成或配置生产密钥。
- worker核对签名、环境、函数名、静态owner和运行时major（new=24/old=16）；准入事务明确确认前，连原业务模块也不加载。仅兼容D-022/D-024已观察到的两项空平台元数据；篡改业务、身份、目标、额外字段或非空元数据均拒绝。
- 正常终结时转发侧只去掉SDK及准入两层包装，原样返回业务payload，保留业务ok:false。重复/不准入明确返回错误，**不会伪造此前业务成功结果**；当前回执不缓存历史完整响应。
- 每次转发仅一个目标、一个callFunction请求，显式retries=0和transport timeout；失败/确认不明不回落旧worker。超时后按同owner/epoch尝试HOLD，明确返回hold_confirmed；写HOLD失败不能声称已关闭。迟到worker正常结束也不重新开放HOLD；尚未准入的迟到投递因revision/state变化无法进入业务。
- D-024已验证的DATABASE_TRANSACTION_CONFLICT只在**尚未执行handler**时归类为明确拒绝，避免普通竞争把获胜任务误锁入HOLD。未知确认仍保留槽并HOLD。观察器仅透传原store，不重试或更改事务。

## 已验证

自动发现的`tests/writer-entry.test.js`覆盖签名/环境/运行时错误首次写前拒绝、调用方伪造owner被忽略、身份稳定/合法操作区分、历史重复及同ID变更业务拒绝、正常业务失败原样返回、20路竞争一个业务执行且不误HOLD、提交确认丢失保留槽、错误SDK包装及迟到投递关闭。

完整未修改RDE和真实common/db/决策/日历/发布代码在合成数据、固定时钟、内存SDK边界下回放。正常转发的完整业务返回、54次写入顺序及各集合所有payload与无准入基线相同。暂停真实第一笔配置写，模拟caller超时，竞争被关闭；worker随后完成同样54写，槽清空但HOLD保留。

显式绑定1799文件独立RDE包，执行前后核对原字节；Node22.22.2/Node24.20.0实际使用SDK2.11.0的`functions/index.js`请求JSON和response_data解析，验证单层result、显式135000ms选项确实覆盖默认timeout，内存中28次函数请求、零网络。该回放没有执行SDK认证/HTTP传输，也不是实际云端135秒嵌套调用证明。完整本地Stage A **92/92**。原31文件候选资格不能自动扩展到新入口文件。

## 新鲜只读状态及排空约束

2026-11-02北京时间09:18读取七个函数配置及生产pointer/runtime：RDE、物化、日线抓取、后台和实时抓取仍为Nodejs16.13；API和隔离探针为Nodejs24.11。这里只核对运行配置/代码元数据，没有把旧下载当作新鲜独立字节证明。证据在仓外`writer-entry-20261102/`，生产调用/写入均为0。

还直接读取了三个timer生产者的`GetFunctionEventInvokeConfig`：fetchDailyData、materializeIndicators、fetchRealtimeData均为MsgTTL=21600、default RetryNum=2/RetryInterval=60、432 RetryNum=-1/RetryInterval=60。这是实际配置，不是文档默认值；未修改。异步重试配置字段见[官方接口](https://cloud.tencent.com/document/product/583/53640)。因此**停timer或只等120秒不能证明旧队列/延迟重试已排空**。后续生产切换必须显式封闭旧入口并核对队列/重试，或以经批准的拒绝旧投递与完整保留窗口方案替代；不能按执行槽TTL强行接管。

## 尚未闭合的生产接线

1. **真实上游身份适配。**现有调用源尚未调用本模块；identify/runtimeIdentity仍是依赖接口。必须把已验证的native事件/平台上下文接到计划发生身份，管理操作在客户端/入口建立稳定operation_id，再贯穿fetch→materializer→RDE；不能拿pipeline_run_id、每次随机UUID或当前时钟代替。官方[Timer事件结构](https://cloud.tencent.com/document/product/583/9708)的Time字段描述为创建时间，尚不能据此确认它就是每次计划发生时刻；本候选故意没有从event.Time猜测scheduled_for。也没有证据证明每次平台重试保持同一个context.request_id。
2. **签名信任与实际打包。**需确定可信签名入口、密钥供应/轮换、worker环境绑定，证明直接SDK旁路没有未受保护入口；新wrapper和完整业务包overlay必须分别绑定实际依赖/common边界。当前store仍只允许隔离集合，没有生产namespace适配器或生产密钥配置，不可直接上线。
3. **平台时限。**样例预算worker120s、transport135s、facade150s及reserve5s仅验证算术关系；现有RDE120s不能直接充当该facade。实际配置、云端嵌套服务限制、HTTP后台期限及失败包装须实证。若不可满足，按既有路线选择全调用方切换方案并重新列明范围，不能静默削减业务时限或扩大部署。
4. **排空和回退。**必须处理已观察到的6小时消息保留及平台重试、外部SDK/IAM、旧热实例/在途DB操作；proof三个布尔值不是事实。HOLD/UNKNOWN不得自动重开，旧、新业务实现必须共同受控。
5. **完整生产链和自然验收。**RDE迁移后还需分别审核物化4项、抓取40项common差异，处理后台/实时等写入口及唯一timer，封存精确源码/包/配置批准，再验证Node24夜间与盘前自然运行。当前所有生产写链仍旧运行时，目标未完成。
