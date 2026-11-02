# 真实Timer重试身份与长转发：有界隔离候选

状态：**LOCAL_CANDIDATE_NOT_DEPLOYED**，2026-11-02。目标是一次闭合入口接线的两个平台证据缺口，不替代生产迁移或夜间/盘前自然验收。本候选尚未创建云资源、设置timer、修改重试配置或调用函数。

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
