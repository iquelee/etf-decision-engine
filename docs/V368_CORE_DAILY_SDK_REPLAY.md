# V3 core：日线实际 SDK 回放

2026-11-10。本轮只增加Core日线的离线回放工具与证据，没有调整业务代码、Gen1/Gen2代码或功能，没有云端操作。使用已封存的四Core候选之一；包源码仍是 `b91e7913096c0a04782a1571f6f826ed5e306de3`，不是本轮工具提交。输入仍是11-03捕获包，不能当作当前线上基线。

后续同日进展：实际物化/RDE已接入[整链SDK回放](V368_CORE_ENGINE_SDK_REPLAY.md)。本文仍保留原单节点验证范围和子响应fixture的历史说明。

## 执行边界

`release/replay-core-daily-sdk.js`分别加载原包和候选的完整index，以及各自的真实SDK2.11.0、database1.4.1、common/db/datasource。候选同时运行实际bootstrap、Timer/签名入口、准入和journal。Node为24.20.0。

仅数据库DBRequest.send、Axios传输adapter、云函数调用的HTTP传输返回内存fixture；业务main、fetchDaily、db.query/upsert、行情解析、SDK数据库序列化和callFunction的JSON编解码均实际执行。候选每次数据库请求核验retries=0、keepalive=false。子调用核验目标materializeIndicatorsNode24、真实签名、稳定派生请求ID、15000ms和零重试选项。

**物化子函数的响应是显式协议fixture，未执行物化或RDE业务。** 本轮不是日线→物化→RDE整链通过，也不是15秒传输期限、真实来源或平台重试资格。子控制记录仅为本地内存seed，不创建生产集合。

子进程不继承生产凭据；FRED使用公开的合成字符串。HTTP/HTTPS/socket/TLS/DNS/fetch禁止外联；意外数据库操作或provider/child请求即使被业务catch也被保留并导致断言失败。整个原/新目录、map、ZIP及包源码身份在运行前后核验。

## 业务对照

| 场景 | 每侧业务写入 | 模拟provider请求 | 核验重点 |
|---|---:|---:|---|
| 收盘后插入 | 145 | 22 | 20根×6标的、定稿、折溢价、辅助数据与日志 |
| 收盘后覆盖未定稿行 | 145 | 22 | 更新旧行，保留未覆盖字段 |
| Main5就绪、既有基准数据缺失 | 40 | 12 | Main5不重抓、不抓折溢价，仅补缺失数据 |
| 全部当日定稿 | 0 | 0 | 原幂等跳过，不调用下游 |
| 显式配置节假日 | 0 | 0 | HOLIDAYS输入令原业务跳过 |
| 合法签名盘中force | 139 | 22 | 只回补历史，当天bar不写入 |
| 主源不足20根回退 | 145 | 23 | 原腾讯→新浪回退和解析实际执行 |
| 可选存储价格响应不可解析 | 143 | 22 | 原失败日志、其余抓取继续 |
| 无FRED key | 143 | 21 | 不请求FRED、不编造实际利率 |

九组每侧合计900写，完整返回、逐笔SDK写载荷和顺序、最终全部业务集合一致。每组双COMPLETE回执；换native request_id重投仍零新增业务读写、provider及子调用。普通SDK伪造Timer在存储和业务前拒绝。

日线包内原有510300数据抓取分支保持原样，仅核验其既有行为，没有调用或构建Gen1/Gen2函数。主清单保持五只ETF，disabled标的不进入抓取。辅助路径实际覆盖合成FRED利率、美元指数、DRAM/NAND、GLD、三个市场指数和四个海外快照的原解析及写入。

另加一组子调用响应丢失：日线145写后，协议fixture抛出传输异常；即使原业务catch并构造chained.error，候选也不将父任务记成COMPLETE。父、子范围均HOLD，父执行槽保留，重投不再执行业务或子调用。该故障没有模拟真实下游执行，不能据此断言下游已经完成。

捕获的日线isTradingDay依赖周末和显式HOLIDAYS列表，捕获的实时包使用另一版common日期逻辑。回放显式设置合成HOLIDAYS=2026-10-01，未统一或修复业务common。生产配置供应与日历行为需在上线前逐包核对；不能由该fixture推断线上已经配置节假日。

## 复现与后续

输入路径与候选路径沿用四Core候选的private指针，详见[实时SDK回放](V368_CORE_REALTIME_SDK_REPLAY.md)。运行：

```powershell
$p = Get-Content 'D:\AI-Projects\Codex\etf-decision-engine\_v3-core-review-20261027\core-fast-scratch-20261110.json' -Raw | ConvertFrom-Json
node release/replay-core-daily-sdk.js --inputs $p.inputs --candidates $p.candidates
```

持久证据：仓外A目录的 `core-daily-sdk-20261110-final.log`，以及 `writer-core-candidates-b91e791/daily-sdk-final-evidence.json`。本轮没有改动原ZIP、map或旧单次证据。

本轮完整回归通过：Stage A 106/106、Stage E、不可变23文件、候选31文件、legacy差异门禁及其负向自测。完整Stage A日志为 `A/core-daily-sdk-20261110-regression.log`。业务目录相对本轮起点无改动，Gen1/Gen2业务及模型目录相对保留主工作树无改动。

下一步按最终Core源码重建物化/RDE/后台候选，验证物化和RDE实际SDK业务，再连接实际下游进行全链对照。后台持久派发、其余Core抓取/抽取、真实原生来源/重试、配置供应、旧队列排空、批准后的生产切换和自然验收仍未完成。
