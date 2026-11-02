# 原生 Timer 本地准入入口候选

状态：**OFFLINE_NATIVE_ROOT_NOT_QUALIFIED**。本批没有云端部署、函数调用、定时器创建或生产写入，D-026 的停止状态及全部隔离数据保留。人工 HTTP 根入口和其他七个写函数的实际包接线尚未完成。

## 进入业务的路径

新增 `writer-timer-identity.js` 和 `writer-local-root.js`，并接入已有 worker bootstrap。物化的原生 Timer 在同一函数进程中构造签名、提交准入，再调用已有 worker；没有自调用 RPC、第二个门面函数或虚构的 135 秒传输预算。RDE 入口仍只接受签名 RPC，没有为它新增 Timer。

Timer 必须同时满足 SDK 无参数 `getCloudbaseContext()` 的环境和 `TRIGGER_SRC=timer`、原生 context.function_name、Node24、静态 producer/trigger 名、固定 Message `writer-root-timer-v1`、合法 UTC Time 和对应 UTC+8 计划。只兼容已观察过的空 tcbContext/userInfo，额外 force、mode、request_id、来源字段或非空元数据全部拒绝。错误身份在 SDK 初始化、存储访问和业务导入之前停止。进入 worker 后仍再次核对签名和运行身份。

Message 是未来新 Timer 的明确配置要求，**不是密钥，也不是可信来源证明**；仅靠事件 Type/Message 不能通过入口。这里的安全依赖还包括平台来源确实逐请求可靠、部署环境没有自定义覆盖 TRIGGER_SRC、外部 SDK/IAM 封闭和旧实例排空，尚待新批次验证。

静态表覆盖 D-026 配置快照中七个 producer 的九条 Timer：日线 22:00、物化 08:00、实时 5 分钟、两组 shadow、新闻的 16:30/半小时、提取的 16:40/半小时。表用于约束身份，不创建触发器，也不把历史快照当作本轮新鲜云端状态。bootstrap 实际包目前仍只覆盖 RDE/物化两项，其余静态身份测试不算对应函数迁移。

身份由环境、规范 producer、trigger 名和 UTC 计划时刻构成；不使用本次请求 ID、当前时钟、交易日、retry 序号或 from。`.000Z` 和 `Z` 等价，同一计划的不同原生 request_id 保持相同业务身份；不同发生时刻、同一时刻的不同 trigger 不同。原生四字段业务载荷保留，不注入 force。

本地 root 只执行自己的静态 owner。控制缺失、HOLD、活动槽未清或 owner 不符即拒绝，不转发旧实现、不重试、不自动初始化。明确完成时只移除准入包装，原业务 ok:false 等值保留；重复回执明确返回 ALREADY_COMPLETE，不伪造历史成功结果。异常或结果不明按同 owner/epoch 尝试 HOLD，迟到完成规则沿用现有 journal。

## 平台证据的限制

2026-11-02 重新核对[腾讯云环境变量说明](https://cloud.tencent.com/document/product/583/30228)：内置 TRIGGER_SRC 在定时触发时为 timer；但[Timer 入参说明](https://cloud.tencent.com/document/product/583/9708)仍将 Time 描述为创建时间。D-026 实测仅证明第一次 Time 匹配预先准备的发生时刻，没有执行到原定 native retry。因此，当前解析和 schedule 匹配是**待资格验证的候选假设**，不能据此打开生产 Timer。

下一次隔离验证必须直接覆盖：同一计划的首次及平台原生重试 Time/来源稳定性；不同请求 ID 不重复业务；正常 SDK 调用即使伪造完整 Timer payload 也被拒；一次 Timer 后的温热 SDK 调用不能继承错误的 timer 来源；无多余 occurrence、原队列终态或 TTL 观察、保留旧数据。没有这些事实，单凭来源文档或本地 fixture 不放行。

## 已验证的范围

`writer-native-timer.test.js` 覆盖九条静态计划、时区/日期/周末/非法时间、错来源/运行时/额外字段的存储前拒绝、请求 ID 改变及下一次发生身份、重复零新增业务、owner 不符无 fallback、异常 UNKNOWN/HOLD/占槽和错误本地响应关闭。

完整原物化与 RDE 在共享内存业务集合回放：由原生 Timer 入口驱动，总计 539 次业务写入，全部返回、写顺序和集合值与原入口一致；只有原有子业务 RPC 一次，root 自调用零次；同一计划重放没有新增业务或子调用。此为模型边界，真实平台来源/重试、业务数据库传输和长调用尚未通过。

离线构建器把新增两个模块加入源码绑定的包清单，继续保留各自独立依赖/common，输出无 Timer、无密钥的候选包。此前 `0d29536` 的 ZIP 与证据保留，不冒充包含本批接线的新包。
