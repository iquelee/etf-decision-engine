# 盘前发布交易日错位修复（D-018 已部署，自然验收待完成）

日期：2026-10-28（北京时间）。范围仅 `runDecisionEngine` 的 lifecycle_writer 区段；沿用 V3.6.8 工程版本，以新源码/包指纹区分补丁。API、前端、Node 24 探针、策略计算和运行时迁移不在本批发布范围。

## 现场事实与原因

昨晚 22:01 的自然 run 已成功发布，正式 pointer 为 revision 15、交易日 2026-10-27；manifest/history 为 V3.6.8、source=`ffd2b4ff626c124629af4c4073cc42066952d3b4`，校验通过、promoted=true、写后回读一致。五条决策和一条组合记录绑定同一 run，正式 API 显示相同版本/来源。

今早 08:00 的 run 执行完成，但 validation_reason=`mixed_date_detected`、promoted=false，pointer 保持 revision 15。只读查询确认：

| 字段 | 实际值 |
|---|---|
| 日历 / RunContext 应到交易日 | 2026-10-27（盘前使用上一已完成交易日） |
| 五条 decision_date / calc_date | 全部 2026-10-27 |
| manifest.expected_trade_date | 错误使用北京时间当天：2026-10-28 |
| candidate portfolio.snapshot_date | 同样使用 2026-10-28 |

RDE 在输入门使用正确的日历权威，但创建发布 manifest 时重新使用 `snapshotDate`（北京时间自然日）。混日校验按真实规则拒绝这组数据；不是放宽校验就能修复。此外，只改 manifest 会让历史 resolver 拒绝 portfolio 日期，因此两处正式发布元数据须一致。

## 修复边界

- manifest.expected_trade_date 直接使用已有 `v365Envelope.expected_trade_date`，不重新计算、不以 latest/max 输入日期或 wall-clock 回退。
- ENFORCE 发布组合使用原快照的副本，仅把其 snapshot_date 设为同一个权威交易日；首次 candidate 写入和 publishCandidateFirst 使用同一副本。
- 原 `v365SnapshotDoc`、LEGACY 快照的自然日语义、决策日期、run identity、运行时间戳、输入 hash/指纹和策略计算保持原样；不修改已有生产记录。
- 输入日期门、mixed-date 校验、candidate-first/CAS 协议、历史 reader 和冻结锁不改。真正异日的决策仍失败，不会通过改写 decision_date 来消除错误。

## 验证

新增 `tests/rde-publish-trade-date.test.js` 直接执行 RDE 两段真实 writer zone，使用实际日历、RunContext、发布验证/CAS、权威读取及历史 validateRun，只有存储边界是内存。原代码在 2026-10-28 08:00 case 明确失败；修复后覆盖 08:00 / 15:59 / 16:00 / 22:00、周末、国庆休市日，均能按正确交易日发布并被历史读链消费。异日决策保持 `mixed_date_detected` 且 pointer 不变；LEGACY 仍以自然日写快照。

本机完整 Node **85/85** 通过，所有改动位于声明 writer zone，候选 manifest 31 文件、reader gate 8/8、immutable 和 legacy divergence 检查通过。V368 候选 manifest 因 RDE 字节变化重出；旧 V365 manifest / V361 / V364 / Gen-1 / Gen-2 冻结件未改。

另用今早失败批次的真实五条 candidate decision 和一条 portfolio 快照，在仓外离线执行原/新 writer：原代码重现 mixed_date_detected、不提升、历史不可读；修复后 expected_trade_date / portfolio.snapshot_date 均为 10-27、提升成功且历史可读。整个过程只操作内存，没有调用生产决策或回写失败批次。

重新下载线上主引擎，1,799 文件与已验收 D-014 包精确匹配，作为本批新鲜依赖/回滚基线。最终候选从干净提交 archive 构建；owner 已绑定完整源码 SHA、单函数范围、候选和回滚指纹批准发布。对应远端 CI 六组通过，上传后独立下载逐文件核验通过，详见下方 D-018 回执。

## 发布后验收

仅上传 runDecisionEngine；保留 Nodejs16.13 / index.main / 120s / 256MB 和现有环境/触发器/角色。不能同时把本补丁当作 Node 24 写链迁移。

新源码的自然 run 需验证：盘前 manifest/五条决策/候选组合均指向日历应到交易日，validation_passed=true、promoted=true，history 与 pointer/前台读链一致。部署包验收不代替自然运行证明；不为验收人工调用主引擎，不补改历史失败行或强推 pointer。同日重跑的 supersede 仍按既有协议留痕。

仓外证据：`_v3-core-review-20261027/status-20261028/`（现网状态）及 `morning-date-fix/`（失败快照、A/B 回放、测试、独立下载和包指纹）。真实持仓、配置和下载包不提交 Git。

## D-018 发布验收（2026-10-28）

owner 对完整源码 `7627356b9cc0441d52368a96e60105254b19f2aa`、候选包和单函数范围回复“批准”后，执行一次 runDecisionEngine 更新，exit 0。ModTime `2026-10-28 09:44:24`（北京时间），CodeSize `4475917`。

上传后独立下载 **EXACT_MATCH 1799/1799**，原始 SHA256 零差异；相对旧包仅 index.js / RELEASE_SOURCE.json 改变。保留 Nodejs16.13 / index.main / 120s / 256MB，以及环境变量、触发器、角色；其余五个已观察函数的配置和代码元数据未变。托管对象、已列出的 HTTP 服务未变。

候选 ZIP SHA256：`7f88b3fc0c20f76facb3a44e79ff54d9cebf35891340c2c7fef8902a54035358`；回滚 ZIP SHA256：`46300f09ddab2496cc48e6a89975d40a89d86af794fc30e5bc04b1f9d2420441`，未使用回滚、未进行实际回滚演练。本机完整 Node 85/85、源码 Actions #193 六组 CI 通过，portable 的私有历史 NOT_RUN 边界保留。

部署前后 pointer 相同，runtime 记录相同。未人工调用生产决策、未回写历史记录；新源码自然运行验收 **PENDING**。后续核验交易日一致、validation_passed/promoted、history 与 pointer/前台读链一致，不能把包核验当作业务验收。
