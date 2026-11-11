# V3 core：后台实际 SDK 与持久派发事务计划

2026-11-10。本轮没有修改业务源码、Gen1/Gen2代码、模型或功能，没有云端操作。后台及RDE实际SDK对照使用上一批749e05c候选，ZIP和输入map不变。本轮新派发模块是**离线事务计划，还未接入存储、运行时或调度器**，后台异步派发缺口仍然开放。

11-11后续进展：[存储适配器与单次执行器](V368_CORE_DISPATCH_STORE_EXECUTOR.md)已实现并完成实际SDK内存边界验证，后台运行时和调度器仍未接线。本文保留11-10事务计划及实际后台包的历史证据范围。

## 后台实际 SDK 对照

`release/replay-core-admin-sdk.js`加载原后台/RDE和各自候选的真实入口、各自common、SDK2.11.0/database1.4.1，在Node24.20.0执行。数据库只替换DBRequest.send；函数调用只替换SDK的HTTP传输并实际执行RDE下游。没有替换database()/collection()、会话查询、业务main或发布逻辑。

| 对照场景 | 每侧业务写入 | 实际RDE执行 |
|---|---:|---:|
| 风险新增 | 55 | 1 |
| 风险解除 | 55 | 1 |
| 参数更新 | 55 | 1 |
| 失败登录计数 | 2 | 0 |
| 有效会话只读查询（无维护记录） | 0 | 0 |
| 新闻刷新冷却跳过 | 0 | 0 |

六组每侧167写，完整原业务返回、逐笔实际SDK写载荷/顺序和最终集合一致。候选新增operation_id/writer_outcome按已定义人工提交协议单独核验，不从对照中隐藏业务字段变化。前三组RDE五票决策、一份组合、active指针及promoted history均核验，子请求ID从固定后台动作与操作ID派生；后台和RDE用不同公开fixture key。

重复及同操作ID改body均不新增业务写入或下游调用；HTTP根入口可以重读admin_token执行鉴权，该只读查询明确允许，不能声称后台重复调用零数据库读取。失败登录不会再次累计。维护关闭、维护记录缺失、错误token、缺操作ID四组均为零业务写及零准入修改。子进程不继承真实凭据，外联被禁止；原/新完整树、map、ZIP及包源码身份前后核验。

### 异步缺口的实际观察

- triggerFetch：候选未派发下游，父任务UNKNOWN/HOLD且占槽；原失败回调额外写一条fetch_log。重复不再增加该日志。
- intel-refresh：候选未派发下游，父任务UNKNOWN/HOLD且占槽；没有业务写。重复不重跑。

这两条不是成功派发测试，不能把原triggered:true记为任务完成。本地用setImmediate等待原拒绝回调结算，不意味着证明任意云端后台回调已排空。真实API路由、CORS/preflight、密钥和IAM仍未验证。

## 新增的派发事务计划

`release/writer-dispatch-plan.js`实现纯计划：固定adminGateway父范围，仅接受日线、实时、新闻抓取、抽取四个Core目标和已审核task别名；拒绝Gen1/Gen2及未知目标。它不生成随机ID或用时钟去重；job ID绑定父请求和目标，子请求从父身份和固定dispatch动作派生。父token或载荷变化不会覆盖已有记录。

状态只能为PREPARED→CLAIMED→COMPLETE/HOLD，attempt至多1、revision固定0/1/2。PREPARED只代表持久接单，不代表已执行；CLAIMED不会因重启、时间流逝、重复请求或ACK丢失被自动重新发送；HOLD和COMPLETE没有重置/删除/重试接口。

claim必须取得同一事务视图中的父控制、父request/token双永久回执、子控制、维护记录及job。父必须双COMPLETE且索引逐位一致，父/子为new、ACTIVE、无占槽、V2 journal控制；父owner/epoch必须匹配原任务，维护OPEN。缺项、UNKNOWN、HOLD、旧epoch、非法revision等均拒绝。计划返回**父控制revision fence、子控制revision fence、维护revision fence、CLAIMED job**四笔原子写；子wire根据fence后的子revision签名。

未来适配器必须在**同一数据库事务**中读取上述视图并提交全部四笔写，借写冲突阻止owner/epoch、维护关闭或竞争准入变化。只读检查或把四笔写拆开不能满足此契约。只有收到确定的durable commit ACK之后才允许发送保存的wire；commit不明不得通过回读自动推断可发送。父业务必须先等待PREPARED持久写确认，再让自己的journal完成；若父仍UNKNOWN，消费者不得派发。

settle只接受与保存wire的request_id/token/owner/epoch逐位一致、executed=true/outcome=COMPLETE且有result的协议响应。业务ok:false仍是一次已完成执行；超时、缺响应、身份不符、ALREADY_COMPLETE或拒绝均转HOLD，留给人工核验，不自动补发。

`tests/writer-dispatch-plan.test.js`在Node22/24验证四目标及别名、稳定身份、重复prepare、冲突载荷、三fence、正确子签名、各类父/子/维护拒绝、终态不变、陈旧claim不能恢复和结果不明HOLD。这是纯状态/事务计划模型，**没有证明实际持久性、事务并发、平台ACK、调度器或执行器已经存在**。本模块未加入已有候选ZIP，也未接入bootstrap或SDK调用拦截。

## 证据和复现

```powershell
$p = Get-Content 'D:\AI-Projects\Codex\etf-decision-engine\_v3-core-review-20261027\core-chain-fast-scratch-20261110.json' -Raw | ConvertFrom-Json
node release/replay-core-admin-sdk.js --inputs $p.inputs --candidates $p.candidates
node tests/writer-dispatch-plan.test.js
```

后台最终日志 `A/core-admin-sdk-20261110-final.log`，工具字节收据 `A/writer-core-engine-candidates-749e05c/admin-sdk-final-evidence.json`。A是仓外审计目录；源候选749e05c与本轮工具提交是不同身份，不改旧ZIP来源。

本轮完整回归通过：Stage A 107/107（`A/core-admin-sdk-20261110-regression.log`）、Stage E、不可变23文件、候选31文件、legacy差异门禁及负向自测；派发计划单测另在Node22通过。业务目录相对ec7853c无改动，Gen1/Gen2业务及模型目录相对保留主工作树无差异；保留主工作树仍干净并保持5a44853。

下一步实现并验证事务适配器、确定提交确认后的单次执行器、运行时拦截和父完成顺序，以及接单/完成前端语义；再验证新闻/抽取实际SDK闭包。新资源、索引、IAM、生产配置和调度方案必须形成单独可审查申请，现有历史授权不自动覆盖。Gen1/Gen2不进入这些计划或完成条件，生产切换及自然验收仍未完成。
