# V3 core：后台持久接单运行时接线

2026-11-11。本步在后台候选的SDK调用代理接入[派发存储适配器](V368_CORE_DISPATCH_STORE_EXECUTOR.md)，不修改原后台业务index/common。Gen1/Gen2代码、模型、功能与包保持，不创建或操作云资源。当前仍不能作为生产发布资格。

## 父任务完成顺序

只有new owner、固定production/adminGateway范围可传dispatchStore。后台四个已声明抓取/抽取目标被转换为prepare；RDE仍走原有等待式子调用。后台不允许unmanaged或Gen派发边。其他producer不启用该接线，也不额外等待空的接单队列。

prepare的parent身份直接来自已认证的wire，不从HTTP body、native requestId或时钟生成。SDK代理不在后台请求内调用抓取/抽取函数，只持久创建PREPARED任务。父业务返回后，worker先等待prepare的确定ACK，再允许父journal完成；父双COMPLETE之前，执行器仍不得认领。

旧业务使用callFunction(...).catch(...)而未await。代理保留Promise的then/catch/finally语义，并跟踪这些显式注册的后续Promise链；父任务等待接单和原拒绝回调结束，才可以COMPLETE或UNKNOWN。等待逻辑不会把自身登记为新回调。prepare失败、ACK不明、回调失败、业务抛错或不合法接单回应均保留UNKNOWN/HOLD，不把被业务catch的失败变成成功。

此处不是任意后台setTimeout/异步作业的通用排空证明；只覆盖审核过的原调用和显式注册的Promise链。真实宿主、实例排空和队列扫描仍需验证。

## 返回契约

成功只表示持久接单，原code/data/message保持，新增顶层：

```json
{"writer_dispatch":{"schema":1,"state":"QUEUED","jobs":[{"job_id":"dispatch:<hash>","target":"fetchDailyData","state":"PREPARED"}]}}
```

HTTP人工提交协议的writer_outcome=COMPLETE只表示本次后台请求完成接单，不表示抓取或抽取完成。原triggered:true也不能被显示为“数据已更新”。前端QUEUED显示、任务状态查询与核对尚未接线，不能单独上线新后台。

只接受已审核任务别名daily/fetchDailyData/realtime/news/extract；intel-refresh使用news。未知task、覆盖传输选项、重复同目标或伪造接单元数据均拒绝并保持UNKNOWN，不静默回退或伪造接单成功。原业务对未知task的fallback不属于本候选通过范围，需要发布前明确客户端输入契约。

## 构建和验证

三包构建器只在后台包增加writer-dispatch-plan.js、writer-dispatch-cloudbase.js及Core范围JS/JSON。RDE/物化保持原模块集合；其他Core包的bootstrap不会加载后台专用模块。构建器为来源和收据显式标记V3_CORE_ONLY，依然只接受干净40位SHA和新的仓外输出目录。

`tests/writer-dispatch-enqueue.test.js`验证父槽在持久ACK前保持RUNNING、确认后才有QUEUED和父双COMPLETE、零原生下游调用、重复不创建新job、提交前后ACK丢失、异步拒绝回调尚未结束时父不得结束、then/finally链、业务失败和Core范围拒绝。原后台HTTP整入口模型更新为接单，不把旧UNKNOWN断言改成下游执行成功。

源码封存前全量Stage A 109/109通过；`release/replay-core-admin-enqueue-sdk.js`用于源码封存并重建后的实际后台/RDE包验证，必须显式绑定构建收据。实际SDK结果和包身份在后续证据段记录，不能用未封存源码覆盖旧ZIP。

尚待：前端接单/完成语义、任务查询、队列发现和执行器宿主、排空协调、实际抓取/抽取闭包、最新线上漂移、长调用及原生来源资格、精确审批后的切换和自然验收。当前没有部署或自然运行通过的结论。
