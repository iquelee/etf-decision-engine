# V3 core：精确任务查询与宿主封包

2026-11-11。本步增加精确只读查询、前端核验和离线宿主构建器。没有云端操作，Gen1/Gen2函数、模型、页面及功能不调整。源码封存并重建后的包身份和实际SDK证据在后续段记录；不能把源代码工厂或本机ZIP视作生产资格。

## 只读状态接口

后台候选新增GET /api/admin/dispatch/status，仅接受一个严格dispatch:<64位小写hex> job_id。复用现有admin_token的值、有效expiry和冲突头校验，未认证不会读job；POST返回405，不消耗操作ID或进入业务/准入。查询不依赖维护OPEN，可在HOLD或维护记录缺失时用于核验。

状态来自单个持久job文档的严格envelope解码，不用日志最新行、时钟或provider结果猜测。只返回schema/job_id/target/state/attempt/execution_status/business_status/reconciliation_required八字段，排除parent、token、wire、签名和业务载荷。未找到404、损坏或不可读503，不在错误中回传私有字段。

PREPARED=尚未开始、CLAIMED=执行未确认、COMPLETE=调用已完成、HOLD=结果不明。business_status始终NOT_OBSERVED，COMPLETE不等于业务成功或数据新鲜。它不是跨多个控制/回执的全局排空证明。

前端只向构建配置的ADMIN_BASE发送GET，不从可编辑的本地操作记录URL推导目标。请求no-store，20秒只读等待上限，无自动重试；返回必须与每个接单job ID及target逐位匹配并满足严格公开schema。旧/错/坏响应均保留待核对。

两套入口共用的核对提示可主动核验这些精确任务。排队、CLAIMED、HOLD、404/503或鉴权失败都不会开放QUEUED记录的结束确认；只有本页新查询确认所有调用COMPLETE，才开放人工业务日志核对勾选。刷新后验证标记不持久保留，必须重新读状态；旧的并发查询结果不能覆盖新查询。关闭本地记录仍不取消任务、不解除服务端HOLD。非Core操作仍走原核对流程。

## 离线宿主构建器

`release/prepare-writer-dispatch-host.js`只接受干净40位SHA、已绑定原始map的admin SDK输入及新仓外输出目录。只取封存node_modules的1703个文件，逐字节保留；不安装依赖、不复制原后台业务/common或任何ML包。生成固定index、最小package.json、无触发器/环境值的config、源码身份及map/ZIP。所有宿主/队列/执行器/协议/范围文件从指定Git blob取字节。

候选为writerDispatchNode24 / Nodejs24.11，显式batch=2、传输15000ms、函数timeout=120秒、内存规划256MB；不附Timer、IAM、四目标签名key或生产初始化。主依赖SDK精确2.11.0，vendored database1.4.1核验；禁止部署时重新安装并漂移依赖。该profile没有解决新闻540秒/抽取180秒长任务资格，不能缩短其原业务预算来迁就宿主。

宿主加载及运行验证支持 `tests/writer-dispatch-host.test.js --host-package <root>`，实际加载封存包index，使用自己的SDK、宿主和队列模块，外部数据库/HTTP仍为内存fixture。它不同于此前只把SDK传给源码工厂的测试，也不证明平台事务或原生Timer来源。

后台三包构建器只给admin增加新的公开摘要模块；其他Core模块依赖通过懒加载保持闭包，不给Gen1/Gen2构建任何候选。

## 运行方式

```powershell
node tests/writer-dispatch-status.test.js
node release/prepare-writer-dispatch-host.js --source <40位SHA> --inventory-root <已核验输入目录> --out <新目录>
node tests/writer-dispatch-host.test.js --host-package <新目录/writerDispatchNode24>
```

新增状态单测覆盖四状态、会话/方法/参数拒绝、公开字段白名单、零准入/业务写、损坏记录和前端精确身份绑定。实际网关缓存、CORS、鉴权转发和原生元数据仍需平台实证，尤其不能假定客户端no-store已经替代网关缓存配置。

后续仍需新闻/抽取实际SDK闭包、长任务完成协议、队列/实例排空及最新线上漂移检查，再形成全部源码/包/配置与资源初始化的精确授权申请。没有部署或自然验收通过的结论。
