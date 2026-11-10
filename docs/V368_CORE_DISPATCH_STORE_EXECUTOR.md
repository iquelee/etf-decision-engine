# V3 core：派发存储适配器和单次执行器

2026-11-11。本轮实现上一轮[事务计划](V368_CORE_ADMIN_SDK_DISPATCH.md)所需的存储适配器及单次执行器，并通过模型和实际SDK内存wire验证。没有修改业务目录、Gen1/Gen2代码、模型或功能，没有云端调用、资源创建或发布。**尚未接入后台bootstrap、SDK异步调用拦截、队列扫描或实际Timer。**

## 存储边界

`release/writer-dispatch-cloudbase.js`只接受显式database对象，核对固定环境、SDK retries=0/keepalive=false；没有SDK init、建表、seed、删除、自动重试或任意collection参数。使用已规划的 `writer_admission_journal_v1`，增加独立 `dispatch:<hash>` 主键和严格dispatch envelope。该新增文档类型和权限仍需纳入未来资源申请，不被旧隔离授权覆盖。

读写通过实际SDK的doc get/create/update和手动startTransaction/commit/rollback，不用runTransaction隐式重试。job envelope的环境、scope、ID、revision、state和canonical payload逐位校验；父/子控制和双回执复用现有V2 journal编解码。

- prepare：新任务必须对应ACTIVE且正在执行的认证父请求，父request/token双索引为同一RUNNING。一次事务中写父revision fence及PREPARED任务，冲突父完成/UNKNOWN切换。已有相同任务幂等返回，不覆盖冲突载荷。
- claim：同一事务读取job、父/子控制、父双永久回执和维护记录。计划要求父双COMPLETE、双方new/ACTIVE/无占槽、同owner/epoch及维护OPEN；原子写父fence、子fence、维护fence、CLAIMED任务四笔。子wire依据fence后的子revision签名。
- settle：只可结算与持久CLAIMED记录逐位相同、签名正确的认领。结果完整且与保存wire身份匹配则COMPLETE；缺响应、超时、错身份等转HOLD。同一事务将仍属原owner/epoch的父/子控制置HOLD，保留可能仍在执行的槽。若某控制已经换epoch，不覆盖新owner状态，返回hold_confirmed=false，任务仍HOLD。

任何commit发送后ACK不明，适配器都不rollback、不补偿、不重提，也不回读推断可发送。commit前错误最多尝试一次rollback；rollback确认丢失也不重试。SDK对执行结果的确认必须包含非空requestId，本轮补充了缺失该确认时HOLD的断言。

## 单次执行边界

`release/writer-dispatch-executor.js`要求显式store、callFunction、readKey、runtimeIdentity和传输预算。未来宿主预期为固定环境的Node24 `writerDispatchNode24` Timer；当前仅通过注入的本机身份fixture验证，**未创建该云函数、未证明原生来源**。

执行器先读持久job；只有PREPARED可尝试claim，只有获得acknowledged=true且claimed=true的确定提交结果，重新核验同一spec及wire签名后，才允许一次固定目标调用。没有第二目标、fallback、重试或TTL接管。callFunction明确传retryOptions.retries=0。之后只尝试一次settle；结算确认不明不会再次发送。

返回sent=true只表示已经尝试调用传输，不证明请求到达。settle失败可能保留CLAIMED，不能把这种情况称为父/子均已确认HOLD；执行器返回settled=false并要求核验，不回滚已经发生的子业务。

认领后、发送前崩溃会留下CLAIMED，重启不发送。这保障单次尝试，**不承诺每个已接单任务最终一定送达**；该窗口需要核验与人工处置。COMPLETE只表示调用已执行完成，业务ok:false仍可COMPLETE，不能据此展示“抓取成功”或数据新鲜。业务结果展示与核对协议仍待接线。

claim只是一个有待完成的派发，不是父/子control.active槽。未来关闭维护、换owner、排空旧队列和宣告静默时，必须同时检查CLAIMED/HOLD任务及执行器实例；仅看control.active为空不能算排空。三fence防止事务内竞争，不能把数据库提交与稍后的网络发送说成一个原子动作。

测试显式使用15000ms传输预算，不修改原Core函数业务预算，也不证明新闻540秒等长任务的传输资格。真实资源、IAM、密钥供应、长调用和平台重试仍需独立方案及实证。

## 30组验证

`tests/writer-dispatch-store.test.js`默认使用事务冲突模型，另支持封存SDK2.11.0/database1.4.1模式。实际SDK模式运行真实数据库事务/API/BSON/EJSON及正常函数调用的JSON编解码，外部DBRequest和HTTP仍为严格内存边界；下游是实际准入/journal协议加合成业务计数器，**不是四个抓取/抽取函数的真实业务回放**。

覆盖四Core目标、父RUNNING禁止派发、正常持久接单→父完成→认领→一次子协议执行→结算、并发单发送者、重复接单与重复消费、prepare/claim/settle提交前后ACK丢失、四笔写中途失败整笔回滚、维护竞争冲突、父HOLD/子BUSY/双索引不一致等拒绝、认领后崩溃重启、发送前失败/业务完成后丢响应、业务ok:false完成、换epoch不误HOLD新owner、rollback确认丢失不重试、缺认领ACK和篡改wire零发送。

模型对全部写使用保守的版本冲突规则，比真实平台更粗。测试还核对claim四笔更新主键和单一事务调用顺序，但**不把内存冲突模型称为平台隔离或持久性实证**。所有测试外联和云调用为零；不继承真实凭据。

```powershell
node tests/writer-dispatch-plan.test.js
node tests/writer-dispatch-store.test.js
$p = Get-Content 'D:\AI-Projects\Codex\etf-decision-engine\_v3-core-review-20261027\core-chain-fast-scratch-20261110.json' -Raw | ConvertFrom-Json
node tests/writer-dispatch-store.test.js --sdk-root (Join-Path $p.candidates 'adminGatewayNode24')
```

实际SDK来自749e05c后台候选，其完整map/ZIP在验证前后核对。该包和输入未重建或更改；本轮适配器/执行器不在旧候选ZIP内。仓外证据位于 `A/dispatch-store-executor-20261111`，A为 `_v3-core-review-20261027`。

最终代码字节及结果见 `evidence-final.json`、`model-final.log`、`actual-sdk-final.log`、`node22-final.log`。初版evidence.json保留；复核发现旧wire fault helper的after选项只对commit生效，不能证明abort后的ACK丢失。现改为真正完成abort后抛错，并断言故障确实触发，修正后30组全部重跑通过。

本轮全量Stage A 108/108、Stage E、不可变23文件、候选31文件、legacy差异门禁及负向自测通过，日志为同目录regression.log。最后补强的abort后故障注入单测另在Node22/24及实际SDK模式通过。业务目录相对9d77c6f无改动，Gen1/Gen2业务及模型目录相对保留主工作树无差异，主工作树仍干净且保持5a44853。

下一步把后台异步请求接到prepare，确保其持久ACK先于父journal完成；补充队列发现/执行器宿主、claim与排空协调、前端接单/完成核对语义，再进行真实Core业务闭包验证。当前候选的triggerFetch/intel-refresh仍保持原UNKNOWN/HOLD，不把离线组件通过当成已修复线上功能。
