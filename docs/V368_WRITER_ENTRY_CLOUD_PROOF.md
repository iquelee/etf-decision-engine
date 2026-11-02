# 真实Timer重试身份与长转发：有界隔离候选

当前结果：**D-026 / REAL_TIMER_LONG_FORWARD_FAILED_LATE_COMPLETION_HELD**，2026-11-02。D-025创建资源后配置被拒；D-026新批准的公开配置请求已接受，真实Timer首次发生时间匹配，worker完成115秒业务，但facade提前进入结果未知，端到端长转发未通过。迟到完成后HOLD保持；未执行预期原生重试或审计，不能计生产迁移或自然验收。以下拟执行序列与D-025记录保留历史范围，D-026实际结果见文末。

## 精确拟验证范围

| 资源 | 配置/作用 |
|---|---|
| 新函数writerEntryFacade24 | Event/Nodejs24.11/index.main/150秒/256MB；零公开路由/自定义环境变量，复用已有物化角色 |
| 新函数writerEntryWorker24 | Event/Nodejs24.11/index.main/120秒/256MB；零timer/路由/自定义环境变量，复用已有RDE角色 |
| 新隔离集合runtime24_journal_probe_entry_20261102 | 最终最多7主键：schedule、business、attempt-0、attempt-1和派生control/request/token；无生产数据 |
| 新timer writerEntryOnce20261102 | 只绑定新facade，一次发生；准备时刻之后180至240秒内的整UTC分钟，按Asia/Shanghai编译固定秒/分/时/日/月/年，星期必须为`?` |
| 仅新facade异步配置 | MsgTTL600；default RetryNum1/60秒，432 RetryNum0 |
| 仅新worker异步配置 | MsgTTL600；default和432均RetryNum0 |

两包各1714文件，其中1703依赖原字节来自绑定1799文件独立RDE包，不安装/升级依赖，SDK2.11.0/database1.4.1。部署源码只有四个既有准入/适配模块、writer-entry、固定proof和计划JSON；不导入任何生产业务。两个index的role固定在生成内容中，调用事件不能改变角色。

这是**公开合成签名key**的隔离fixture，仅允许固定scope/目标/业务body和由唯一schedule推导的请求身份，不能用作生产密钥或开放通用签名服务。没有生成或分发生产secret。

## 固定执行序列

1. 批准后重新检查旧函数/集合/路由/托管/生产pointer/runtime；仅创建上述两函数和空集合。独立下载两包逐字节核对，运行配置和新函数异步配置分别回读。此时不得绑定timer。
2. 只调用一次新facade的`prepare-entry-proof-v1`，传入按已封存算法计算的发生时刻；函数只接受距当前120..360秒、整分钟的UTC时刻。fixture已存在就拒绝，没有重置路径。生成新scope的HOLD控制记录并以fixture proof激活new/epoch1。
3. 只新建一次指定timer。CustomArgument为固定`entry-timer-proof-v1`，Enable OPEN，固定日期和年份。创建和回读期间若发生时刻余量不足，不补发/重提prepare或timer；保留现场并停止。参数见[官方CreateTrigger](https://cloud.tencent.com/document/api/583/18589)。cron的日期/星期采用`?`消除OR歧义；时区依据既有native触发器22:00配置、实际22:00运行及[官方SCF定时备份说明](https://cloud.tencent.com/document/product/436/56065)的UTC+8定义，不使用函数进程的UTC时区代替cron时区。
4. 首次真实Timer事件必须匹配Type、名称、Message和已准备发生时刻。若Time实际是创建时刻或其他值，记录FAILED/TIMER_TIME_MISMATCH后停止，**不能把不匹配当作通过**；不猜测或补造时间。
5. facade通过实际SDK签名转发一次，新worker在准入之后等待115秒，写一个固定business标记、完成回执并返回原fixture payload。等待发生在准入事务之外，不持有115秒数据库事务。转发预算135秒，facade150秒/worker120秒，密钥/owner/epoch/目标全部绑定。记录实际worker和forward elapsed以及worker运行时版本。
6. **仅确认首次业务完整返回后**，facade写SUCCESS并主动抛出唯一预期错误`EXPECTED_ENTRY_TIMER_RETRY`，让新facade的已核对RetryNum1触发一次平台重试。重试必须保留同一事件发生时刻，调用worker只命中ALREADY_COMPLETE，不再次加载业务；native request_id是否相同只记录事实，不作为业务身份依据。
7. 独立只读观测确认第二条attempt成功后，只手动调用一次`audit-entry-proof-v1`；再通过独立数据库通道核对全部7主键与control revision3/空槽/ACTIVE、两份COMPLETE索引、一个business标记、两次Timer元数据、worker真实耗时至少114秒。只有全部成立才计通过。

预期调用预算：facade准备1+timer2+审计1=4次，worker2次（一次业务、一次拒绝重复），总计6次；业务执行必须为1。115秒是worker固定代码，不接受事件传入耗时参数。平台意外重复投递应记录为异常，代码不追加业务；不把预期预算当成对平台投递次数的无条件保证。

除第6项确认完成后的一次**有意平台重试**，任何未知/异常都STOPPED，不重提SDK请求、不fallback、不重置fixture；先前RUNNING/FAILED不再转发。最坏无法确认时保留HOLD/活动槽，不自动接管。仅允许对本次新timer最多一次CLOSE停用应急操作；不删除资源，不改生产timer。失败时保留所有证据，不能通过“重跑直到成功”获得资格。

## 已有离线证明与仍缺的事实

`tests/writer-entry-proof.test.js`使用固定fixture回放准备、首次115秒**模拟**等待、唯一预期异常、重试去重、审计、超额投递关闭，以及错误Time/转发失联不再执行业务。也覆盖一次性cron跨午夜、跨年反向换算。锁定SDK的真实数据库和函数调用序列化可通过显式独立包参数回放；该测试的时间、Timer及平台重试全部是模型，不计真实115秒调用或native重试证据。

`release/prepare-entry-proof.js`在干净40位Git提交上导出明确七个源码文件、逐字节复制依赖，为两角色生成独立文件map、确定性ZIP和SOURCE_IDENTITY。实际两包main的离线回放另记录模拟等待与网络0；Node24必须通过，Node22实际入口应因runtime guard拒绝，不能伪称Node22生产入口兼容。

已完成只读预检：15函数/34集合，新两函数名和集合名均不存在；所需已有角色与前次SDK隔离角色一致。代码、私有配置、两个ZIP和timer/异步配置范围须封存后，按仓库要求另行取得完整SHA绑定批准，才可执行上述云操作。本文件本身不构成部署授权。

即使本批通过，生产仍需把观察过的native身份接到真实上游、建立管理操作ID、准备生产namespace和生产密钥/包overlay、封闭外部调用及6小时旧重试队列，再分批切换RDE/物化/抓取/后台/实时写入口并自然验收。旧D-021至D-024探针及全部fixture保留原样。

## D-025实际执行：配置被拒后停止

owner绑定源码`9ad435620057efa8d0c409c7848e70c77ba9b08c`、两个ZIP和申请SHA256 `572b913bc7b53c07ba54bfa391b978d44e9a26e819f062bf5cee7b841eb5d1f4`回复“批准上述精确范围”。最初管理通道invalid token导致预检停止、无云写；恢复现有账号设备登录后，新鲜15函数/34集合检查通过。没有IAM或资源权限修改。

- facade在北京时间14:26:31创建，CodeSize4067502，Nodejs24.11/index.main/150s/256MB。
- worker在14:27:00创建，CodeSize4067507，Nodejs24.11/index.main/120s/256MB。
- 两函数各1714文件独立下载全部匹配，1703份依赖原字节不变，角色/零自定义环境变量/零timer/无公开路由通过；这里只证明Runtime配置，未取得实际process.version。
- 新集合独立回查0条；新scope尚未初始化。

第一次、也是唯一一次`UpdateFunctionEventInvokeConfig`只针对新facade，返回`InvalidParameterValue.AsyncTriggerConfig`。随即停止：worker配置未提交，prepare/timer/audit/worker均未调用，无重提、重置、删除或应急CLOSE。独立回读两函数仍为默认MsgTTL21600、default RetryNum2/60、432 RetryNum-1/60。不得在这些默认配置下继续原定timer验证。

准备中误将读取返回的ErrorCode/RetryInterval也用于写请求；[官方RetryConfig输入结构](https://cloud.tencent.com/document/api/583/17244)仅声明RetryNum，[更新接口示例](https://cloud.tencent.com/document/api/583/53639)也仅使用RetryNum。服务端未细分具体无效字段，不能把推断当已验证根因。另外实测读取值位于`data.AsyncTriggerConfig`，原执行器直接读`data.MsgTTL`也需修复。不能在本批停止后试发不同请求来探测支持范围，亦不能声称公开接口能够将432重试设为0。

边界PASS：原15函数完整受控配置/代码元数据不变，函数15→17仅上述新增，集合34→35仅上述新增。旧282条journal原始内容全部不变，全部域名路由、已观察托管元数据、生产pointer/runtime不变。生产写链仍Node16，无生产调用或自然验收。

本批资格为**NOT_QUALIFIED**。下一步先按官方写入契约及实测包装修复离线请求构造/回读检查，明确平台432重试与队列存活的实际边界，再针对两个既有隔离函数准备新的配置/调用范围。不重建资源、不清理现场；旧批准不作为本批失败后的重试授权。仓外证据：`runtime24-entry-proof-v1/execution/DEPLOYMENT_REPORT.json`及完整授权/部署/下载/配置拒绝/独立回查/边界记录。

## 停止后的离线契约修复

`release/entry-proof-async-config.js`只生成两个固定隔离目标的公开写入结构：TTL600和单个`RetryNum`项（facade1、worker0），不复制ErrorCode/RetryInterval。回读必须解包`data.AsyncTriggerConfig`并核对default与432类别、TTL、次数和间隔；包装缺失、未知/重复类别、旧默认值和错误响应均拒绝。该模块不导入SDK，不执行云请求，不更新已部署代码。

[官方重试策略](https://cloud.tencent.com/document/product/583/41138)明确：异步432/系统错误按最长保留时间持续重试，运行错误才使用用户配置的次数。因此新的可行申请必须明确承认432 RetryNum-1及TTL600边界；预期6次调用不能宣称平台总调用数的硬上限，CLOSE timer也不能当作排空已有队列。原申请的432零重试未实现，不能悄然改为上述政策后继续。新构造和回读模型通过不等于真实配置请求已获接受；尚未发出第二次配置请求。

## D-026：真实长转发失败，迟到完成后保持关闭

owner另行批准配置源码`ff0f7205d23870278fc06cc33d21d0deeadcd5e2`和申请SHA256 `3910477dc47eb121649bfa8411beec1372b8bf70bdb3e57c5ef9b745ee6ae851`，明确接受432/系统错误重试至TTL、不保证平台总调用硬上限。既有两函数的部署源码仍为`9ad435620057efa8d0c409c7848e70c77ba9b08c`，无代码更新。前后再次独立下载两包，各1714文件全部匹配；未新建函数/集合、未重置旧scope。

通过连接器分别仅提交一次公开格式的配置更新，两次均成功，独立回读均TTL600/default RetryNum分别1和0/432 RetryNum-1/间隔60秒。CLI环境查询仍失败时使用已登录连接器的环境、集合及路由只读通道；CLI函数下载与原始EJSON数据库读取继续可用，没有重复登录或IAM修改。

prepare仅一次，在北京时间14:52:50返回PREPARED、实际Node v24.11.1。timer仅创建一次，创建时间14:53:10，固定cron `0 56 14 2 11 ? 2026`。真实事件在14:56:00发生；记录的Time与准备发生时刻一致，区别于创建时间。这只证明本次实际发生，不证明重试时Time稳定。

实际首次timer请求`c292098d-ed8d-4105-8f6d-06284cf793b9`原生日志耗时67332ms，在14:57:09.892以平台status200/retCode0返回业务STOPPED/FIRST_RESULT_NOT_CONFIRMED；attempt-0记录FAILED/WRITER_EXECUTION_UNKNOWN。与此同时worker请求`37eba246-345b-4cf5-b9bf-b292af11fa63`仍继续执行，14:58:02.766以COMPLETE返回，原生总耗时117909ms，业务标记实测等待115006ms，实际Node v24.11.1/SDK2.11.0。

facade将传输/解析异常统一折叠为UNKNOWN，没有保留底层错误码；因此**不能声称已证明统一60秒平台上限或某个确定HTTP错误**。事实是本次150s facade、120s worker、显式135s SDK预算的端到端转发失败，而worker成功迟到完成。不得用内存timeout覆盖测试或worker单点成功将其认定为长转发PASS，也不缩短原业务时限来凑通过。

异常后14:58:23发起唯一一次仅新timer的CLOSE，并独立回读Enable0。没有人工重提、fallback、第二个prepare、audit或worker调用；未触发“业务完整返回后抛错”的预期重试。持续只读观察超过15:06的TTL边界，日志只见prepare1+timer1+worker1，共3个执行请求，没有额外投递。重试身份稳定性与原生去重仍NOT_RUN。

最终独立回查正好6主键：schedule、FAILED attempt-0、一个business标记、control、两份COMPLETE索引；无attempt-1。control revision4/owner=new/epoch1/HOLD/active=null/receipts=[]。首次UNKNOWN时活动槽被保留，迟到完成清空槽但不重新开放HOLD；这一真实安全行为单独成立，不能替代迁移资格。

边界：原15函数受控配置/代码元数据不变，两隔离包前后各1714文件精确匹配，函数17/集合35名称不变，旧282条记录原始EJSON内容一致；路由、ETF67资源元数据及生产pointer/runtime不变。全托管2062对象中8个kindle/路径并发变化，本批无托管写入且未确认外部操作者；不声称全托管不变。CLI简化Trigger投影遗漏CustomArgument/Enable使原边界检查报KeyError，已用独立原生SCF完整回读验证同一timer的名称、Message、cron及Enable0，不通过改写投影伪造字段。

本批**NOT_QUALIFIED**。下一步按既有迁移路线准备**全调用方切换**，保留120秒业务契约、原包common边界及共同准入，逐个封闭调用源/旧队列；当前SDK长转发门面不可作为生产迁移已满足的前置条件。真实Timer重试稳定身份仍须独立补齐，生产主要写函数仍Node16。仓外`runtime24-entry-async-v1/execution/DEPLOYMENT_REPORT.json`保存实际授权、配置回读、前后下载、日志、6主键、应急停用、TTL后观察及边界证据。
