# 本次更新范围：仅 V3 core

2026-11-10 owner明确：**“这次的升级只涉及V3 core，关于Gen-1和Gen-2的代码和功能不要进行调整。”** 本文件和 `release/runtime24-v3-core-scope.json` 是本次后续实施的范围；此前九writer/六包/交接文档中的Gen1、Gen2计划已从当前升级移除。

当前Core写链为runDecisionEngine、materializeIndicators、adminGateway、fetchDailyData、fetchRealtimeData、fetchFundamentalNews、extractFundamental。只读apiGatewayNode24已在此前迁移，不因本范围记录自动追加变更。

runGen1ShadowEod、runGen2ShadowEod及其Node24候选不属于本次打包、部署、代码/功能、Timer/配置或模型调整目标。既有原始包、失败现场及离线候选保留为历史证据；不继续其SDK回放，不把它们纳入本轮完成条件。任何Core共享模块改动也不能借统一构建覆盖Gen1/Gen2部署包。

本轮恢复时刚启动了一个未提交的Gen2 SDK离线回放。收到范围指令后已停止其父子Node进程、移除该未提交驱动；没有云调用、函数部署或生产业务执行。可复用于Core的纯内存SDK wire模型保留，不包含Gen1/Gen2业务。核对开发分支相对封存主分支，两个shadow函数源码及ml/gen1、ml/gen2目录没有差异。

现有三包构建器仍只为RDE/物化/后台生成候选，并校验Core范围。历史六包构建器的默认入口因含Gen1/Gen2而在读取源码或创建输出前拒绝；新入口 `release/prepare-writer-core-workers.js` 只从历史捕获中选择日线、实时、新闻和抽取四个Core包，保留各自业务、依赖和预算。历史六包输入清单本身不改写，新构建收据明确标记V3_CORE_ONLY。

下一步：完成Core七节点实际SDK业务回放（含日线→物化→RDE），实现后台triggerFetch/intel-refresh的持久派发，再准备Core调用闭包、配置供应、旧队列排空、切换及夜间/盘前等自然验收。Core业务返回不变、未知执行HOLD、不重复写等要求继续适用。Gen1/Gen2代码和功能保持，不以本迁移提升ML或策略资格。

本范围声明不批准任何云端写入；尚未批准的单次原生隔离申请与封存主工作树仍保持原身份。生产代码和云端配置需要重新只读核验，11-03观察不能作为11-10新鲜线上基线。

验证：Core范围正/负向门禁、历史六包入口拒绝、Core可复用SDK wire模型与bootstrap回归通过；完整本地Stage A 106/106、敏感扫描和冻结23项通过。没有修改cloudfunctions、src/common、ml中的业务源码；Gen2离线驱动进程已终止，未提交驱动已移除。历史Gen1/Gen2模型回归仅作为既有代码不变性检查，不代表本次更新这些功能。
