# 后台人工操作入口候选

状态：**OFFLINE_ADMIN_HTTP_NOT_QUALIFIED**。本批没有云端部署、调用、建表、路由或生产写入。最后云端实证仍为 D-026 的隔离长转发失败。本文件不构成上线授权。

`writer-admin-http.js` 已接到 `writer-worker-bootstrap.js` 的第三个静态目标 `adminGatewayNode24`，原后台业务预算保持 60 秒。包仍不附 HTTP 路由或 trigger，也没有签名密钥。新密钥来自 `WRITER_ADMIN_SIGNING_KEY_HEX`；RDE 子调用还需 RDE 密钥。当前候选所有入口（包括读请求）都要求相关密钥配置及正确 Node24/环境/函数身份，否则拒绝；生产切换前必须验证密钥供应与读可用性。

## 人工身份和鉴权

潜在写请求必须带 `X-Writer-Operation-Id`，格式为 UUIDv4，大小写归一；HTTP 路径前缀、方法和潜在写分类与已审核原后台一致。登录即使使用 GET 或其他原入口允许的方法也属于写请求。操作身份绑定固定 producer、规范方法/路径和操作 ID，不使用网关 requestId、当前时间、随机服务端 ID 或 body.from。同一动作/ID 的改载荷或传输 requestId 改变不能重执行业务，不同动作单独命名。

只接受普通 JSON，头名归为小写，重复大小写拼写的头被拒。普通写请求先只读验证现有 admin_token，拒绝缺失/冲突/错误 token、过期或非法/缺失 expiry；这比旧入口对非法 expiry 的宽松行为更严格，不把旧异常值当成新信任凭据。原业务仍再次执行原鉴权，不删其校验。登录不预先验证密码或跳过失败记录：原密码校验、失败限流、迁移密码及会话写入在 worker 准入之后执行，重传不会重复累计同次登录失败。

输入/操作 ID 无效返回 400，普通写鉴权失败返回 401，二者均不写准入回执。维护拒绝返回 503，不导入业务、不消耗操作 ID。维护恢复后同一被拒 ID 可进入。完成后重复返回 409/ALREADY_COMPLETE，提示刷新核对，不重放或伪造原业务结果；UNKNOWN 返回 409 并保留 HOLD/占槽和 hold_confirmed。普通业务返回（含失败）完整保留。

## 维护状态和存储

独立的固定只读入口读取 `writer_admission_journal_v1` 中的 `rollout:adminGateway`，期望 `{schema:1, environment, scope:'production/writer-rollout', revision, state:'OPEN'|'CLOSED'}`；缺失、错误形状、错环境/scope 或读取失败均关闭。没有自动建表、初始化或打开记录。该额外 rollout 主键和九个生产控制范围都尚未创建/配置，未来资源申请必须明确包含它，不能沿用隔离批准。

维护检查同时在 HTTP 根入口及 signed worker 的准入前执行。只读路径不读取维护记录或占用准入，但仍进入原鉴权；关闭维护不会因此把读请求开放给匿名用户。它仍不是旧实例排空证明。父、子使用 admin/RDE 两个范围；原业务第一笔写前必须获得父准入，旧队列、外部 SDK/IAM 及全局切换协调仍未闭合。

## 实际包及验证边界

离线构建器现覆盖 RDE、物化、后台三包，全部输入分别绑定 inventory 原始 map，保持各自 common/依赖。后台原 SDK 为 2.11.0；只更换三个 SDK import 和入口，移除原 /adminGateway HTTP trigger，保留 DECISION_ENV=prod 与 60 秒。所有新包增加根入口及维护模块，不运行依赖安装、不改旧包。

`writer-admin-http.test.js` 用实际 bootstrap、完整原后台及 RDE、共享内存业务集合验证：14 类维护拒绝零业务/准入写；缺操作 ID 在 SDK init 前拒绝；鉴权失败不占槽；风险新增/解除、参数更新三条完整链各 55 写，所有返回、写顺序及集合值与原入口一致；相同操作改 requestId 或载荷均不新增写；无 rollout 时认证读仍可用；失败登录保留原 guard 写且同 ID 不重复累计。Node22/24 模型通过，不是平台或真实业务 SDK 数据库写入证据。

后台 triggerFetch/intel-refresh 的 fire-and-forget 和失败回调仍未完成持久化派发接线。候选保持 UNKNOWN/HOLD/占槽，不把 triggered:true 当成父业务完成，不能据此发布完整后台写服务。

## 上线前剩余项

当前前端 `web/src/api/request.js` **尚未发送新操作 ID**。必须补齐持久的提交/重试身份和结果不明时的核对流程，避免一次超时后的重试自动变成新操作；同时检查 CORS/preflight 对新请求头的实际支持。不能先切新后台再让前端写请求全部失败。

还需完成异步持久派发、生产密钥和维护记录供应、旧实例/所有调用面封闭与排空、完整精确授权、真实平台资格及自然验收。现有 Timer 来源/重试资格缺口也保留，不因人工入口模型通过而关闭。
