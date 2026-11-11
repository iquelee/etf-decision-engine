# V3 core 长任务：持久终态与只读对账

2026-11-11。本步补充新闻/抽取的持久终态证据，不改变原业务540/180秒预算。只在两个Core producer启用；Gen1/Gen2函数、模型、页面及功能保持，其他worker默认协议不变。无云端操作。

## 完成事务

`writer-completion.js`定义固定环境、仅新闻/抽取的不可变completion文档，以environment/scope/request_id/token/owner/epoch/target共同派生主键。严格schema限定在4KB：精确身份、调用COMPLETE、REPORTED_OK/REPORTED_FAILURE/UNCLASSIFIED、业务显式报告的问题数量及白名单整数计数。既有业务ok:true仍可能遗漏某些provider失败，所以REPORTED_OK不是全量成功证明。摘要不存原新闻、标题、prompt、错误文本、provider key、签名、完整业务返回或任意字段。

两个producer显式使用`createCoreCompletionStore`和`recordCompletion=true`；普通store和其他scope不能冒充支持原子摘要。worker在业务返回后生成摘要，先读新证据文档确认不存在，再在一次手动事务中写control、两个COMPLETE回执及completion。四文档同时提交且明确ACK后才返回调用COMPLETE。任何中间失败回滚，commit发出后不补偿、不重提；证据一旦存在不能修改/覆盖，也不通过重复业务生成新证据。业务抛错只保留原UNKNOWN/HOLD，没有完成摘要。

若调用方已因超时将子控制置HOLD，仍在执行的正确worker可按原身份完成：写双COMPLETE与摘要、释放自己的执行槽，但保留HOLD状态。迟到证据不解除父/子HOLD、不更新dispatch HOLD、不开放队列或重发。未确认完成的任务不因时间流逝就变成可重试。

## 精确只读对账

`writer-completion-inspector.js`仅接受精确dispatch ID和显式注入的SDK数据库/目标签名key。在单一只读快照事务中读取job、父/子control、父/子双索引以及completion，验证封存wire签名、父永久COMPLETE、子精确身份和摘要envelope。完成后rollback，不commit、不写文档、不调用业务或派发。一次rollback响应不明也不重试rollback，对账降为UNVERIFIABLE。

输出区分未派发、未观察、执行中、UNKNOWN、旧版COMPLETE无摘要及DURABLE_COMPLETE；并标明当前owner/epoch是否仍匹配、控制是否HOLD。旧代次的精确历史终态不被冒充当前代次资格。缺单索引、损坏/错代摘要、记录矛盾、错误key或不可读均不可确认。公开投影不返回token、签名或原业务文本。所有输出`can_release=false`、`can_retry=false`，快照不是解锁许可。

本步对账器尚未接后台HTTP、前端确认或任何云端Timer；仍无人工HOLD解除接口。新增摘要不回填历史任务，旧双COMPLETE无摘要保持独立分类。

## 验证与封包

`tests/writer-completion.test.js`覆盖脱敏白名单、原子四文档完成、ok:false/未分类、HOLD后迟到完成、finish提交前/后丢ACK、摘要插入拒绝、业务抛错、旧回执、代次变化、坏父/子索引、摘要/签名、矛盾占用、不可变证据及rollback失败。bootstrap回归验证仅新闻/抽取产生completion，其他producer不产生。最终组数和Node22/24/实际SDK结果见封存记录。

Core四包构建器给新闻/抽取额外加入封存`writer-completion.js`和对应源码指纹，其他两包不加入；离线新包、实际业务对照及独立ZIP核验结果另附。既有历史包和回放证据不覆盖。

## 资格限制

这一步让“worker已经结束”的事实不再只依赖转发返回，但没有解决长任务异步投递、原生Timer来源/重试、真实事务隔离和完整排空。现有15秒/最多135秒的同步派发宿主仍未获得承接新闻540秒/抽取180秒的资格，不能扩大本地超时或缩短业务预算冒充修复。后续需要接精确对账查询、冻结可审查的人工处置流程，再完成投递机制与平台隔离验证；任何云端执行继续绑定实际源码/ZIP/配置与资源范围。
