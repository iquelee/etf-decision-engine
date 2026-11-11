# V3 core：实时行情实际 SDK 回放

2026-11-10，范围严格为V3 core。本轮只重新封装日线、实时、新闻抓取、抽取四个Core候选，未读取或构建两个shadow业务包；Gen1/Gen2代码和功能不调整。没有云调用、部署或生产数据写入。

## Core候选与输入身份

`release/prepare-writer-core-workers.js`从干净源码 **b91e7913096c0a04782a1571f6f826ed5e306de3** 生成四个Core ZIP，收据见 `release/runtime24-writer-core-candidates.json`。四包分别保留120/60/540/180秒、256MB，仍是无Timer、无环境值/签名密钥的离线候选；输入是11-03捕获包，不能称为11-10新鲜线上代码。

新日线/实时/新闻/抽取候选分别为1782/1806/1740/1740文件。独立Python直接比较原/新ZIP：原依赖字节与文件类型、日线五个npm链接、原业务的单点SDK import替换、原Git wrapper模块、配置预算及无凭据值/Timer全部通过。没有混入当前统一common或修改业务逻辑。

逐文件前置核验在D盘遇到小文件I/O瓶颈，旧进程仍在读取时被明确停止，未生成候选目录。随后把**同一原ZIP和原map**解到本机C盘新临时目录，逐字节验证输入后用相同源码构建；不是跳过验证或改变输入。最终ZIP/map/构建及独立验证收据持久保存在仓外 `D:/AI-Projects/Codex/etf-decision-engine/_v3-core-review-20261027/writer-core-candidates-b91e791`。松散证据树的C盘位置记录在该目录 `LOCAL_TREES_PRIVATE.json`，可能被系统清理；可按持久ZIP重建新证据目录，不能删旧单次记录或假称旧临时树仍存在。日线本机证据树里的链接目标是普通文本，类型以ZIP为准，不直接从证据目录发布。

## 本轮实际走过的链路

`release/replay-core-realtime-sdk.js`比较：原包index→自己的SDK2.11/database1.4.1→原common/db/datasource，与候选index→实际bootstrap/签名准入/journal→自己的SDK/common/db/datasource。

原业务、行情解析、SDK init、database API及BSON/EJSON序列化均执行。仅两处外部边界注入合成fixture：DBRequest.send接严格内存数据库；Axios传输adapter返回腾讯格式的ASCII缓冲（继续经过原GBK解码和字段解析）。不替换db.query、fetchRealtime或业务main。子进程不继承真实凭据，HTTP/HTTPS/socket/TLS/DNS/fetch禁止外联；任何意外网络尝试或被业务catch的未建模数据库请求都会使回放失败。模拟原生来源仅用于本地接线，不是平台来源证明。

### 六组业务对照

| 场景 | 每侧业务写次数 | 模拟行情请求 | 核验 |
|---|---:|---:|---|
| 五只已有当日日线 | 6 | 5 | 更新realtime、保留原日线和未覆盖子字段 |
| 五只缺当日日线 | 6 | 5 | 插入实时暂存行，不编造成交量或定稿 |
| 两只已有行、其余缺行、一只响应不可解析 | 5 | 5 | 四只成功、partial日志与返回保持 |
| 注册时刻落在非盘中 | 0 | 0 | 原off_hours跳过保持 |
| 注册工作日落在国庆假期 | 0 | 0 | 原holiday跳过保持 |
| 非盘中的合法签名force | 6 | 5 | 仅经已认证的签名入口强制抓取 |

原/新每侧正向对照合计23写。全部返回、逐笔真实SDK写载荷/顺序、最终集合相等；每组双COMPLETE回执，重投改变native request_id仍零新增业务读写/HTTP请求。普通SDK伪造Timer在存储前拒绝。合成场景使用固定历史时刻，不能据此声称当前盘中行情新鲜或自然运行通过。

实际SDK把嵌套realtime更新序列化为点路径`$set`；第一次扁平模型因此拒绝五条更新，没有把失败计为通过。现对真实点路径语义增加模型及独立负向用例：保留未更新子字段，拒绝冲突父/子路径、原型污染路径、向标量/数组写子字段、主键变更和未知操作；非法更新不能部分修改行。模型拒绝记录不会被业务catch隐藏。

### 两组确认丢失故障

在实际候选SDK事务层模拟commit已经生效但ACK丢失：

- 准入commit丢ACK：业务零写/零HTTP，双回执RUNNING，控制HOLD并保留占用；重投拒绝。
- 完成commit丢ACK：业务6写已经完成，双回执COMPLETE，控制仍HOLD，入口返回执行未知而非成功；重投拒绝、零新增业务调用。

故障只注入一次，不自动重试或以时间流逝接管。这里仍是内存事务wire模型，不能替代云端提交不明/原生重试或跨实例平台实证。

## 运行与证据

从开发工作树执行，输入路径和候选路径应指向已验证的松散证据树；当前本机位置由上述private指针记录：

```powershell
$p = Get-Content 'D:\AI-Projects\Codex\etf-decision-engine\_v3-core-review-20261027\core-fast-scratch-20261110.json' -Raw | ConvertFrom-Json
node release/replay-core-realtime-sdk.js --inputs $p.inputs --candidates $p.candidates
```

当前真实执行为Node24.20.0 / SDK2.11.0 / database1.4.1。原始结果日志 `A/core-realtime-sdk-20261110.log` 为六场景；`A/core-realtime-sdk-20261110-with-faults.log` 为六场景加两组故障。脚本核验原/新map、ZIP及整个目录，前后均检查字节；凭据值不进入输出。打包源码b91e791与后续回放工具提交是两个身份，不把后者填回已有ZIP。

最终日志为 `A/core-realtime-sdk-20261110-final.log`，含六组对照、两组故障，以及每次候选SDK请求的retries=0、keepalive=false断言。对应工具字节身份保存在新证据 `writer-core-candidates-b91e791/realtime-sdk-final-evidence.json`，前述旧日志和证据保留。

本轮回归：Stage A 106/106、Stage E、不可变23文件、候选31文件、legacy差异门禁及其负向自测均通过；内存wire单测另在Node22通过。实际候选入口回放使用Node24，不把Node22工具单测当作候选运行资格。业务目录相对本轮起点无改动，Gen1/Gen2业务及模型目录相对保留主工作树无改动。

尚未完成：其余Core节点的实际SDK闭包回放、后台持久派发、真实原生来源/重试和请求头资格、配置供应/旧队列排空、批准后的生产切换及自然运行验收。旧RDE/物化/后台候选仍需按最终Core源码重建。本轮没有推进Gen1/Gen2候选SDK回放、功能变更或打包，也没有把离线结果升级为生产资格。
