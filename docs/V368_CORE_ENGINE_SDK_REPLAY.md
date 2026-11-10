# V3 core：日线→物化→RDE实际 SDK 对照

2026-11-10。本轮完成三个真实业务入口相连的实际SDK离线对照。没有云端调用、发布、资源配置或生产数据写入；Gen1/Gen2代码、模型及功能未调整。

## 包和来源

物化、RDE和后台三个Core候选由既有Core范围守卫构建器，从干净源码 `749e05ca4ce445121446123cc72ecd59ac1394b7` 重建。后台是该工具固定的第三个输出，本轮未加载其业务入口，实际SDK回放仍为NOT_RUN。新收据为 `release/runtime24-writer-core-engine-candidates.json`。

原始输入依据10-29封存的raw文件清单。为了减少D盘小文件读取，从已核验SHA的旧84c766a候选ZIP恢复与raw map完全相同的文件，仅对不匹配项读取原始下载目录；逐文件验证原始SHA后，在C盘新临时目录构建。新包逐文件再次检查原依赖与业务替换边界；没有使用旧wrapper、当前统一common或重新安装依赖，不能当作11-10新鲜线上抓取。

独立Python直接检查新ZIP/map：12个wrapper模块等于749e05c Git blob；业务index保存为business.js及三个SDK require单点替换正确；其他原文件和依赖字节不变；新文件集合明确；原timeout、DECISION_ENV=prod保留，Timer移除，签名密钥不附包。RDE/物化/后台分别1814/1806/1808文件，1703/1701/1703依赖文件保持。业务预算分别120/120/60秒。

日线沿用已核验b91e791源码候选，未把新工具提交SHA写回旧ZIP。整链因此有两个明确的包源码身份。持久ZIP、map、构建与独立收据保存在仓外A目录的 `writer-core-engine-candidates-749e05c`，C盘输入/候选树位置见其中 `LOCAL_TREES_PRIVATE.json`；临时树可能被清理，不能直接假设仍存在。日线输入/证据树使用之前的独立指针。

## 实际执行的边界

`release/replay-core-engine-sdk.js`执行原日线→原物化→原RDE，与候选日线→候选物化→候选RDE。每包使用自己的SDK2.11.0/database1.4.1、common、数据库封装、指标和决策模块，没有替换business main、database()/collection()、db.query/upsert、指标计算或发布逻辑。

仅DBRequest.send接内存wire，SDK函数调用的HTTP传输在本地派发真实下游入口，Axios传输返回合成provider响应。数据库BSON/EJSON、functions.invokeFunction的请求JSON及返回解码仍由实际SDK执行。候选每次请求校验retries=0、keepalive=false；两条子调用核对固定目标、15000ms、零重试、签名派生身份及原业务payload。

本机实际Node24.20.0。子进程不继承真实凭据，三个producer分别使用不同的公开fixture签名key，FRED key也是合成字符串。HTTP/HTTPS/socket/TLS/DNS/fetch外联被拒绝，业务catch吞掉的未建模操作或transport异常仍单独记录并使对照失败。原/新完整文件树、map、ZIP和嵌入源码身份在运行前后核验。

## 七组原/新对照和一组故障

| 场景 | 每侧业务写入 | 真实下游调用 | 关键结果 |
|---|---:|---:|---|
| 签名RDE首次发布 | 54 | 0 | 五票决策、一组合、manifest校验、指针和history |
| 签名RDE更新已有同日指针 | 54 | 0 | 四字段条件更新，revision 7→8，supersedes留痕 |
| 签名物化→RDE | 539 | 1 | 实际指标、周线和实际RDE发布 |
| Timer物化→RDE | 539 | 1 | 同业务结果，双范围四回执 |
| 单票历史不足20根 | 414 | 1 | 四票物化，子业务ok:false保留，不生成active指针 |
| 非交易日物化 | 0 | 0 | 原日历fail-closed跳过，零业务写 |
| Timer日线→物化→RDE | 684 | 2 | 每侧22个模拟provider请求、五票完整发布、三范围六回执 |

七组每侧合计2284次业务写入。完整返回、逐笔SDK写载荷/顺序、最终所有业务集合一致。正常路径五票决策、一份组合、manifest validation_passed、history promoted及权威交易日均核验；三段链路中日线原生时刻派生物化请求，再派生RDE请求，不使用native request_id作业务去重身份。重投改变native request_id后，新增业务读写、provider及子调用均为零。

故障场景：真实RDE已经完成539写所在链路并提升指针，但SDK HTTP传输丢失返回。物化业务原本会catch；候选仍将父执行判为未知，物化与RDE范围均HOLD，父槽保留，父双回执UNKNOWN、子双回执COMPLETE，重投不再执行。这里明确验证了真实下游已执行，不再使用上一轮的子业务成功fixture；仍没有证明跨云实例、真实超时或平台重试。

## 内存模型的有限扩展

`writer-sdk-memory-wire.js`新增显式opt-in的条件指针更新：只接受active_run_pointer、固定production主键及scope、run_id、整数revision四字段、multi=true/upsert=false；匹配至多一个主键行。默认仍拒绝query更新、任意多行更新、其他集合的CAS及业务事务。单测覆盖陈旧revision零匹配不改指针、成功提升后旧身份再次零匹配、字段缺失/错误scope/错误主键/字符串revision拒绝。

这是单线程内存条件更新语义模型，用于检验实际SDK携带的条件，不能替代平台原子性或并发实证。原生产publish-store、决策和物化业务文件没有改动。

## 复现与证据

```powershell
$a = 'D:\AI-Projects\Codex\etf-decision-engine\_v3-core-review-20261027'
$p = Get-Content "$a\core-chain-fast-scratch-20261110.json" -Raw | ConvertFrom-Json
$d = Get-Content "$a\core-fast-scratch-20261110.json" -Raw | ConvertFrom-Json
node release/replay-core-engine-sdk.js --inputs $p.inputs --candidates $p.candidates --daily-inputs $d.inputs --daily-candidates $d.candidates
```

最终分key及回执断言日志 `A/core-engine-sdk-20261110-distinct-keys.log`，工具字节绑定收据 `A/writer-core-engine-candidates-749e05c/engine-sdk-distinct-keys-evidence.json`；此前共享fixture key的初版整链final日志和证据保留。旧实时、日线单节点证据和旧候选保留；本轮共用内存wire的新条件更新默认关闭，不扩大它们的操作范围。

本轮验证通过：完整Stage A 106/106（日志 `A/core-engine-sdk-20261110-regression.log`）、Stage E、不可变23文件、候选31文件、legacy差异门禁及负向自测；wire单测在Node22/24通过。新wire默认配置下，原实时六组/两故障和日线九组/一故障实际SDK回放也再次通过，日志为 `A/engine-wire-regression-20261110-*.log`。保留主工作树仍干净，业务目录相对本轮起点无改动，Gen1/Gen2业务及模型目录相对保留主工作树无改动。

当前仍未完成后台实际SDK闭包和持久派发、新闻/抽取闭包、真实平台来源/重试及长调用资格、最新线上漂移检查、配置供应、旧队列排空、批准后的切换和自然夜间/晨间验收。离线整链通过不等于生产准入。
