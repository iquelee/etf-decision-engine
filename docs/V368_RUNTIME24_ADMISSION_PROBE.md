# Node 24 准入适配器隔离验证候选

状态：**D-022已更新隔离入口，唯一固定云端SDK写/CAS验证及独立回读通过**。D-021首次调用失败记录保留。这是[写链迁移设计](V368_RUNTIME24_WRITER_MIGRATION.md)的下一批准备，不是生产RDE迁移，也不赋予原型长期写资格。

## D-021原创建范围（资源创建完成，调用验证失败）

配置以[探针计划](../release/runtime24-admission-probe-plan.json)为准：

- 环境：`tradingview-etf-d0fa42yy57cbc11b`。
- 仅新建Event函数`writerAdmissionRuntime24`，Nodejs24.11 / index.main / 30s / 256MB，SDK2.11.0依赖原字节恢复、不安装依赖；无timer、HTTP路由或前端入口。
- 仅新建验证集合`runtime24_admission_probe_20261029`，仅使用`probe:cas`、`probe:race`、`probe:drain`、`probe:unknown`、`probe:ack-lost`五个固定主键。
- 创建后仅一次鉴权调用，事件必须精确等于`{"case":"verify-admission-v1"}`。事件不接受集合、主键、函数名或任意写入参数。
- 任一目标资源已存在、源/包/配置指纹不符则中止。已插入fixture不重置、不删除，不因超时或确认丢失盲目重跑；部分完成保留诊断，后续另定批次。

沿用现有函数角色，不扩大IAM或安全规则；该角色本身的现有权限范围不能等同于数据库强制隔离。隔离由本批固定集合/主键代码及无生产函数导入约束实现，部署前后还要比较生产边界。无需复制生产环境变量至探针，私有配置只封存既有角色引用。没有更新现有函数、迁移timer、切生产调用方、清理资源或调用生产决策的范围。

## 适配器行为

`release/writer-admission-cloudbase.js`是仅允许验证集合前缀/主键的适配器，依赖注入database，不自行初始化SDK、创建集合或bootstrap记录。`read()`严格核对主键、环境、scope、状态信封和规范JSON；缺记录返回null并由协议拒绝执行。

更新使用`where({_id, ...完整旧信封}).update(新信封)`。信封包含revision/owner/epoch/state及完整`payload_json`字符串，条件覆盖完整旧控制状态，避免嵌套对象的部分合并。只接受精确`updated === 1`且无upsert的确认，并回读完整新状态；0、多条、字符串计数、异常、回读失败或漂移都不放行业务处理。没有无条件set/update、fallback或CAS重试。

此选型参考[官方Node SDK数据库文档](https://github.com/TencentCloudBase/node-sdk/blob/master/docs/database/database.md)，并核对独立包中SDK2.11.0 / database1.4.1的Query.update、Document.get及UpdateSerializer实现。当前代码仍须在目标云环境实测，不能由文档或内存回放推定云端原子性。

## 本地与拟云端验证

固定验证流程先确认五个fixture主键全不存在，然后以指定主键add初始HOLD记录；重复或并发重入不能覆盖既有fixture。随后验证旧快照CAS被拒、八路竞争唯一赢家、排空期间不能切owner、完成释放后owner/epoch切换、执行槽归null及回执完整替换、旧owner不执行、UNKNOWN与确认丢失保留执行槽。

自动测试还覆盖空记录不bootstrap、禁止生产集合、错误回读信封、错误updated确认及重复运行不重置。`scripts/admission-probe-sdk-replay.js`加载独立生产包内的真实数据库SDK序列化代码，仅替换request transport；已得到88个数据库请求的完整内存验证PASS。这是本地SDK线格式兼容证明，不是云端SDK鉴权/写权限或实际CAS证明。正式云调用失败时不得偷偷改走生产集合试写。

`scripts/prepare-admission-probe.js`只接受当前干净40位Git提交、新目录及由[写链清单](../release/runtime24-writer-inventory.json)绑定的独立1799文件包map。先核对全部原始字节，再仅恢复node_modules、导出明确四份Git源文件，生成受控入口、无环境值config、源码身份和确定性ZIP。包内不包含RDE/common/持仓/行情fixture。ZIP和文件map、部署私有配置指纹、只读资源缺席检查及CI证明将在仓外封存为具体授权请求；包构建不会上传。

## 上一批CI失败及修复

Actions #200六组均通过portable测试，但在V364 legacy surface gate失败：新增三个scripts验证工具未登记。此次继续增加工具后共七个脚本需要登记。未修改V364冻结锁、原61条声明或七类永不豁免错误；新增`writer-validation-files.json`按确切路径和LF-SHA256绑定七个验证工具，由现有candidate-aware校验单独分类，每个文件篡改及任何禁止错误仍失败。原五项V3.6.8声明单独保留。

由于修改了31文件合格面内的candidate-aware校验器，重新生成V368候选manifest；这是工具声明变更，非策略或云端部署。候选content SHA从`23102a6d…`变为`9969ae7472e6690af962cb6a2fb3e7d5c75a2a1a00d6934b82c440911d845aa1`，冻结23项指纹不改；不能继续声称本批候选content不变。新CI通过前不发布。

## 授权与验收边界

候选完整源码SHA、ZIP SHA256及私有配置指纹在仓外`APPROVAL_REQUEST.md`确定后，才请求创建函数/空验证集合和一次固定调用的授权。依据[仓库部署纪律](V365_RUN_LIFECYCLE_IMPLEMENTATION_ROADMAP.md)，部署要求owner逐位绑定40位SHA显式授权；先前D-020切流批准不覆盖本批新资源和SDK写入。

云端成功也只证明该隔离集合内SDK写入/条件更新及本批协议行为。生产准入接线、外部调用方与重试封闭、真实在途排空、长期回执存储、门面时限以及写链夜间/盘前自然验收仍未完成。若失败则停用探针调用、保留证据；没有自动删资源或修改生产配置的回退动作。

## D-021失败事实与入口修复候选

2026-10-29 17:55:40创建隔离函数、独立下载1711文件精确匹配后，仅作一次固定鉴权调用。CloudBase将事件封装为`{case:'verify-admission-v1', tcbContext:{}, userInfo:{}}`；旧main的全事件deepStrictEqual在SDK初始化之前抛错，返回FUNCTIONS_EXECUTE_FAIL。集合独立回查0条、生产边界PASS。没有重试或删除资源，SDK云写/CAS资格NOT_RUN；完整事实见[D-021台账](production-deployment-ledger.md)。

本地`validateEvent`仅剥离**确切为空对象**的tcbContext/userInfo，再要求其余事件精确等于固定case。空元数据的组合均有回归；非空/数组/null元数据、集合/主键/函数名/body等额外参数均拒绝。元数据内容不参与任何授权或数据库选择，正常CloudBase封装是这次修复的唯一兼容范围。

新批次拟只更新已建`writerAdmissionRuntime24`的入口修复包，并在已建且仍为空的`runtime24_admission_probe_20261029`作一次新的固定调用；不再创建资源，也不重置fixture。执行前须确认现有函数仍是D-021源码8898c0651f0f622bf227b9ebdb357846cfa52121、原1711文件及配置不漂移，集合0条；新源/ZIP/配置/一次调用范围另行封存请求。原一次调用额度已用，不能以“修复后重试”跳过新源码绑定。

## D-022执行结果（2026-10-29 19:18，北京时间）

owner批准新源5b3da41b2aa13a1031cf452f8eb3eae202e202aa后，只更新现有隔离探针；前后独立下载各1711文件精确匹配，原配置保持，ZIP SHA256 f7769f65e361a4a7a5cb27348e94add145fa41272d8e08d9129cbd85ffb16032。一次固定调用PASS，实际Node v24.11.1 / SDK2.11.0完成真实隔离add/get/条件update。独立回读恰好5固定主键，CAS拒旧、8路竞争唯一赢家、排空切换、空槽/完成回执、未知/确认丢失保留槽均通过；模拟异常不冒充真实网络故障，多实例及性能未测。

原13函数受控配置及代码元数据、完整路由、ETF前端67对象、托管、pointer/runtime不变，函数14/集合33名称清单不变；本批无新建/删除/重置/生产写函数调用，未使用回退。完整来源、时间及边界见[D-022台账](production-deployment-ledger.md)。隔离写资格通过不能替代生产准入接线、长期回执、队列与真实在途排空、门面时限或自然验收。准备计划保留封存时状态，不覆盖实际执行报告。
