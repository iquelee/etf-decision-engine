# V3 core：队列执行宿主、发现与前端接单核对

2026-11-11。本轮实现候选宿主工厂、分页发现、批次占用/回执及前端QUEUED流程。没有创建函数、Timer、控制记录或IAM，没有云端调用/发布。宿主还没有独立可部署ZIP或平台资格，任务状态只读查询API仍未实现。Gen1/Gen2函数、模型、页面及业务逻辑保持。

## 有界执行与恢复边界

`writer-dispatch-host.js`仅允许固定环境的Node24 writerDispatchNode24、SDK无参数上下文TRIGGER_SRC=timer和固定writerDispatchMinute-v1事件。Message固定writer-dispatch-queue-v1，Time必须是合法ISO分钟边界；空tcbContext/userInfo元数据允许，非空拒绝。周期身份只由原定时发生身份生成，不用native requestId或当前时钟。测试注入了可信上下文fixture，**没有证明平台来源或Timer Time的原生重试稳定性**。

`writer-dispatch-queue.js`在固定writer_admission_journal_v1中使用显式配置的dispatch-queue:control及永久dispatch-cycle回执。控制缺失或损坏立即关闭，不自动初始化。OPEN→BUSY占用和RUNNING周期回执在同一手动事务持久确认之后，才允许发现任务。相同周期重投、BUSY/HOLD及占用后崩溃重启均不重新消费；无租约、TTL接管或自动释放。

发现仅查询固定环境/父scope/kind=dispatch/state=PREPARED，按job_id升序，每批显式1～10条。使用严格大于游标的keyset分页，尾部空页最多回绕一次；不会因状态变化使用offset跳过任务。被父/子门禁阻止的PREPARED不会删除，游标仍可前进，后续回绕再核验，避免固定队首长期挡住其他任务。

执行器向claim传批次reservation。claim在原父/子/维护三fence及job之外，同一事务再写队列revision fence；认领确认后才更新本地permit并允许一次发送。批次完成与游标、周期COMPLETE回执原子提交。结果不明或job HOLD时尝试将批次置HOLD；若确认不明仍可能BUSY，两者都阻止新周期继续。

批次结尾确认丢失有不同边界：若OPEN和周期COMPLETE实际上已提交，不能再声称队列确认HOLD。旧周期仍由永久回执拒绝，已完成job不再被发现；新周期可处理其他PREPARED。测试明确覆盖这一分支，不以回读授权补发。发现页是候选清单，不是执行许可，执行前始终重新做job/父/子/维护/队列的事务核验。

只有宿主路径使用批次fence；之前单次执行器的无reservation接口仍用于组件测试，不能作为另一个不受队列协调的生产入口。部署/owner切换/排空必须同时核对BUSY/HOLD周期、CLAIMED/HOLD job、执行器和子函数实例；不能只看业务控制active为空。

批次规模和传输预算必须显式提供，测试为2条/15000ms。传输上限仍为135000ms，不代表540秒新闻或180秒抽取的长任务已闭合；没有缩短原业务预算，也没有取得异步平台派发/完成核对资格。长任务方案仍是生产前置项。

## 前端只确认接单，不推断执行完成

只针对/api/admin/fetch和/api/admin/intel/refresh校验QUEUED确认：schema/state、四Core目标、1～4个唯一job ID和PREPARED状态。缺少或畸形接单确认保留UNCERTAIN；明确冷却且未创建任务可正常结束。非Core端点不走新分支，返回原data引用，Gen页面/接口语义不调整。

两套API客户端均保留经校验的writer_dispatch元数据。已接单后，原操作记录变为QUEUED，刷新和跨页仍阻止重提；只持久化已有操作元数据及job ID/目标/状态，不保存body、密码、token或指纹。此前不明操作后来确认接单时，旧的核对勾选失效，必须重新核对执行结果。

共用核对提示和数据管理页明确显示“已接单，等待执行”，不把triggered:true或后台请求COMPLETE显示成抓取成功。用户仍需主动查看完整日志/核对并确认，关闭本地记录不取消任务、不改服务端job、不解除HOLD。尚无精确job状态查询或自动完成推断；本轮没有宣称完成闭环查询。

## 验证与依赖

宿主10组模型和实际SDK内存wire验证，覆盖四任务两批分页/尾部回绕、旧周期重投、缺控制/错来源、占用后崩溃、reserve/claim确认丢失零发送、下游完成后丢响应HOLD、门禁恢复后的游标公平性、竞争宿主只一个批次执行、结尾OPEN提交后ACK丢失不重发。实际SDK为封存39e032a包的2.11.0/database1.4.1库；数据库及HTTP传输仍为内存fixture，下游业务为准入/journal加合成计数器。不是实际抓取/抽取全链或平台事务证明。

前端协议测试直接加载两套请求客户端及操作跟踪器，覆盖QUEUED刷新防重提、坏确认不清操作、冷却、重新核对、隐私字段不落盘和非Core返回不变。宿主与前端新增测试在Node22/24运行；前端23套件及Vite构建、全量Stage A 111/111和既有门禁的结果由本轮日志记录。

工作树原先缺Vue/Vite依赖；主工作树lock不同，未复用其node_modules，使用本工作树原package-lock执行npm ci。package.json/package-lock未修改。构建产物仅在本机，没有上传或发布。前端验证是Node协议/现有渲染套件和构建，未新增真实浏览器或网关/CORS资格。

代码及SDK输入字节证据在仓外 `A/dispatch-host-client-20261111`，A为_v3-core-review-20261027。既有后台候选39e032a及其任务仍不被改写；新宿主尚未打包为云函数，未来资源申请必须列明新控制/周期文档、查询索引、固定Timer、IAM和密钥。

下一步补精确任务状态只读查询和宿主封包，验证新闻/抽取实际SDK业务闭包、长任务完成与排空协调，再准备完整源码/包/配置绑定的云端资格申请。生产切换和自然验收仍未完成。
