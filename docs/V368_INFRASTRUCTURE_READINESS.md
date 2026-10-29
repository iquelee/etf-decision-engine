# V3.6.8 基础设施核验与下一批次

核验日期：2026-10-27（北京时间）。首批完成本地生成器、测试和 CI 更新；后续 D-017 已新建并验收独立 Node 24 只读 API 探针。生产入口和原有函数运行时保持不变。

## 运行时迁移路径

线上本次观察的五个函数仍为 `Nodejs16.13`。CloudBase 的[运行环境支持](https://docs.cloudbase.net/cloud-function/runtime-support)将 24.11 列为 Active LTS（推荐）、22.21 列为 Maintenance LTS；[CLI 配置文档](https://docs.cloudbase.net/cli-v1/functions/configs)仍把这两项标为公测并推荐 20.19，两处表述有差异。按前者明确声明的权威入口，选择 **Nodejs24.11 作为待验证目标**，实际环境能否创建仍需云端验证。[Node.js 发布状态](https://nodejs.org/en/about/previous-releases)显示 20、18、16 已 EOL，因此不把 20.19 作为新的长期迁移目标。

[SCF UpdateFunctionConfiguration](https://cloud.tencent.com/document/product/583/18580)明确说明 Runtime 在创建时指定，目前不支持修改。不能通过把现有配置中的字符串改成 Nodejs24.11，宣称现有函数已原地升级；也不能删除现有函数再重建来绕过此限制。

下一步执行顺序：

1. **本批本地验证**：CI 增加 Node 24，保留 Node 16 / 22；每个版本仍运行 Python 3.11 / 3.12 两组，portable 历史证据边界不变。Node 24.20.0 本机完整 Node 测试 **83/83** 通过；它不是云端精确 24.11 的运行证明。
2. **独立 API 探针批次**：以当前只读 API 的已审核源码和精确依赖快照构建独立 `apiGatewayRuntime24`，目标 Nodejs24.11、runtime-probe.main、256MB、30 秒。固定用例入口转调原 index.main，另回传实际 Node 版本及实例首次调用标识；详见 [探针批次](V368_RUNTIME24_PROBE.md)。先验证新建能力、SDK 鉴权/数据库读取、首次加载、错误响应、权威 pointer 一致性、历史与最新 K 线响应。此阶段不设 timer、不绑定生产路径、不改已有五个函数或前端。环境变量/角色来自新鲜的受控快照，不写入 Git。本文件不是该资源的部署授权；部署请求仍须给出完整源码 SHA、包 hash 和新建资源范围。
3. **API 入口切换批次（下一步）**：D-017 已完成独立探针的真实云端验证，实际 Node v24.11.1、1,798 文件精确匹配、七类用例通过。探针只接受固定 case，不能直接承接前端 HTTP 请求。先准备 `index.main` 的正式 API 候选，核对现有 /apiGateway 绑定和事件映射，再准备路由前后差异与可恢复旧路由的回退包，另行申请精确范围的发布。回退首先恢复旧 API 路由，旧函数保留。
4. **生产写链迁移批次**：先完成当前 V3.6.8 主引擎自然运行验收，再梳理 materializeIndicators / runDecisionEngine 及行情抓取的调用方、timer 和函数名依赖。候选写链不得与原 timer 并行写生产；必须给出明确的调用切换和防重复运行方案。Gen-1 等其余函数随后逐一处理，不随 API 探针全量迁移。

首批本机加载只证明模块兼容；后续 D-017 已用原 `@cloudbase/node-sdk=2.11.0` 完成真实云端鉴权和本批 API 多集合读取，范围见 [探针结果](V368_RUNTIME24_PROBE.md)。它不证明所有 SDK 能力或生产写链均兼容。迁移运行时和升级 SDK 分批进行，避免同时改变两个变量。

## 日历与生成器

现有日历 `cn-a-share-2026.1` 覆盖至 **2026-12-31**。以 10-27 为基准还有 65 个自然日；12-01 进入 30 天预警，2027-01-04 返回 `CALENDAR_OUT_OF_RANGE`、expected_trade_date=null，阻断机制保留。

本次限定 SSE / SZSE 官方站点检索未找到可用于生成的 2027 年年度休市通知；检索未命中不证明公告绝对不存在。下一年度须取得两所正式通知、交叉核对、生成新版本 artifact 和 manifest，验证跨年 cutoff、春节/调休周末与覆盖边界后再进入发布。没有以普通工作日或第三方假期表延长当前 coverage。

独立重算发现旧生成器用 source 文件的原始 CRLF 字节算 hash，并把磁盘 CRLF 与生成的 LF 直接比较，导致 Windows `--check` 失败。LF 归一后来源及 artifact 与封存指纹均相符，日期内容没有差异。本批修复生成器的来源 hash 与检查口径，检查明确输出 `LF-BYTE-EQUIVALENT`；`--check` 不写文件。新增回归覆盖 LF/CRLF 稳定重算、只读检查，以及 source/artifact/manifest 内容篡改必须失败。

当前 artifact、manifest、source 原始文件和旧 V365 / V361 / V364 冻结件未改写。artifact 的规范 SHA 仍为 `5edb6d4a0a9d7361d2794399a64f5882a7970a14ce4581aae05addb3c6eef786`。新 V368 候选 manifest 因 CI 文件变化重出，身份仍为 CANDIDATE。

## 生产自然运行验收

10-28 早间只读复查确认：10-27 22:01 的新 source 自然 run 已发布，正式 pointer 为交易日 2026-10-27、revision 15，manifest/history/source/context 及 5+1 候选记录一致。主引擎无独立 timer；除 materializeIndicators 的早间 timer，fetchDailyData 也会链式调用物化→决策，因此已有夜间自然发布记录。

10-28 08:00 run 又因发布日期错位被 mixed_date_detected 拒绝，pointer 保持 revision 15。D-018 已部署交易日修复（独立下载 1,799 文件精确匹配，原运行时/配置不变）；10-28 夜间与 10-29 盘前自然验收均通过（revision 16 / 17）。根因及修复见 [发布交易日补丁](V368_PUBLISH_TRADE_DATE_FIX.md)；先修复并完成自然运行验收，再继续正式 API 切流及写链迁移，未关闭持续运行验收项。

后续验收须同时核对 source_commit、release_version、input_context_sha256、COMPLETE / validation_passed，以及 promoted history 与 pointer 的一致性。不得仅凭 runtime.updated_at 或上传成功关闭验收项，也不为验证而人工调用生产主引擎。

本机原始观察与测试日志保存在仓外 `_v3-core-review-20261027/infrastructure-20261027/` 及同级 `infrastructure-node24-*.log`；下载源码、完整配置和数据快照未加入 Git。一次参数误用导致测试进入不需要重跑的 Python 阶段，已中止，该次运行不计为通过；最终 Node 24 完整 Stage A 为 83/83。Python 代码和依赖未变，本批由新增 CI 矩阵继续验证。

2026-10-29 后续：D-018 自然验收已通过，现准备完整 index.main API 候选及静态托管域 /apiGateway 的独立切流/回退范围，见 [正式 API 迁移准备](V368_RUNTIME24_API_MIGRATION.md)。创建与切流尚未执行。
