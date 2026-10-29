# Node 24 API 单路由切流批次

状态：**准备中，未切流**。2026-10-29（北京时间）。D-019 已创建完整 `apiGatewayNode24`，独立下载 1,797 文件精确匹配、14 类固定 GET 和三个事件形式通过。原入口仍由 Nodejs16.13 的 `apiGateway` 服务。

## 唯一变更及身份

| 项目 | 绑定值 |
|---|---|
| 环境 | `tradingview-etf-d0fa42yy57cbc11b` |
| 域名 | `tradingview-etf-d0fa42yy57cbc11b-1253568636.tcloudbaseapp.com`（STATIC_STORE） |
| 路径 / 上游类型 | `/apiGateway` / SCF |
| 唯一写字段 | UpstreamResourceName：`apiGateway` → `apiGatewayNode24` |
| 迁移源码 / API 实现源码 | `c82e5b5c691f5aaf87ab7d3e0a85ff1812c2b423` / `49e7c765c586bb81dc707849992fa7386b9a663c` |
| 已部署目标 ZIP SHA256 | `86b5e7428bc3aeeebafba8d8ecf801c9ce966709aae075edfba55964fa372485` |

新增 [切流计划](../release/runtime24-api-cutover-plan.json) 和[纯校验模块](../release/api-route-cutover.js)。模块不联网、不调用函数，只验证完整原生路由快照、生成仅包含定位键及上游名称的增量载荷，并检查正向/回退后所有域名路由恰好只有目标上游变化。顺序和 RequestId 不影响比较；只允许目标域及目标路径的 UpdateTime 随变更更新，其他字段和旁路路由变化一律拒绝。缺域、重复路径、分页不完整、未知当前上游都失败。

保持 `Enable=true`、`EnableAuth=false`、`EnableSafeDomain=true`、`EnablePathTransmission=true`、PathRewrite/QPSPolicy 空对象；保留所有未声明字段（包括可能的上游版本）。不改 `/`、`/adminGateway`、其他域名、函数包、运行配置、前端文件/URL、权限、安全规则、timer、策略、ML 或生产数据。两个 API 函数和旧固定探针均保留。

## 执行前与切流后检查

1. 准备时重新独立下载旧/新 API，与已验收的 1,796/1,797 文件清单对拍；复核运行时、入口、环境、角色及代码元数据。完整原生 `DescribeHTTPServiceRoute` 不加 CLI 默认的 HTTPSERVICE 过滤，保存所有域名和路径。
2. 使用真实完整路由快照在内存做正向/回退校验，并捕获原生产域的 14 类固定 GET、响应状态/头和 payload 基线。新增回归必须拒绝根/后台/其他域路由、鉴权/透传/重写/限流字段变化，拒绝未知版本绑定、重复或截断清单。
3. owner 绑定本次干净源码、现有目标包、完整路由快照和正向/回退载荷指纹批准后，执行前再次核验函数及路由未漂移。原生接口无 CAS 事务保证；采用紧邻复读、单字段增量修改、写后全量比较及明确回退，不能声称具备原子切换或零传播延迟。
4. 仅调用 `ModifyHTTPServiceRoute` 增量更新这一个上游；不删除重建。观察到 API 返回失败或超时，先读取真实路由，判断写入是否发生，再决定验收/回退，不能盲目重试写操作。
5. 从**原生产域名与原 URL**重读全部固定 GET，核对完整路径透传、query（日/周、日期范围、include_provenance）、旧数组及原 notFound 契约；检查响应状态和浏览器所需响应头。前后 pin 同一 authority/source/context，核验五个正式 card、历史及数据库最新 K 线窗口。只排除明确逐请求生成的 `data.ml_shadow.generated_at`，校验其 ISO 格式和时间新鲜度，不宽泛忽略时间/业务字段。
6. 通过 CloudBase 鉴权函数通道，以固定 GET 事件同时取旧 API 基准，用旧函数调用前后夹住原域新入口响应，确认稳定 payload 一致。当前身份的原生 SCF Invoke 会 CAM 拒绝，不为此扩权限；使用 D-019 已证明的同一 API Key 的 CloudBase 通道，凭据仅在内存。调用对象仅新旧两个只读 API，明确排除任何生产写函数。
7. 浏览器检查原域首页、历史、K 线及 legacy 入口；再次核对全部函数、完整域名路由和 ETF 前端 67 个入口/依赖对象。共享托管 `kindle/` 并发变化分开记录，不声称全域不可变。

自然生产发布导致 pointer 合法变化时重新取比较基线，不冻结、手工调用或回写生产引擎；持续变动导致无法得到稳定比较时不得宣称验收成功。

## 同批授权中的故障回退

请求授权同时包括：若目标路由字段错误、公共 API/SDK 错误、前缀/query 不匹配或稳定权威/历史/K 线/payload 不一致，**将同一 Domain+Path 的 UpstreamResourceName 恢复为 `apiGateway`**。回退不部署旧代码，直接使用保留的旧函数，不删除新函数。

回退前读取当前上游：若仍为旧 API，记录无需回退；若为本批新 API，执行一次逆向增量更新；若已被他人改为未知上游，停止，保留诊断，不覆盖他人变更。回退后从原域验证旧入口并比较完整路由，若其他字段/路由仍有异常，明确报告未完全恢复，不通过扩大回退范围掩盖问题。

切流前配置/文件漂移、旧 API 无法作为回退基准、候选/源码不符、审批指纹不符时不写路由。本批源码和载荷在仓外 `runtime24-cutover/` 封存后才能形成最终授权请求。D-019 的创建授权不包含本批切流；此前准备计划状态保留为历史快照，不替代实际执行台账。
