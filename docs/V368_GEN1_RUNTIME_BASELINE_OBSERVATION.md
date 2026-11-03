# 11-03 Gen1 写函数实际基线观察

这是只读观察，不是本轮部署或授权记录。最后本聊天实际执行批次仍为D-026；不能据此声称整个共享环境此后无人更新。

重新核验17函数的完整受控配置时，`runGen1ShadowEod` 的ModTime由2026-10-04 19:05:36变为2026-11-03 11:02:41，CodeSize由4079238变为3577646。其他受控字段（包括Nodejs16.13、角色、环境变量、预算和Timer）未变，其他16个函数的受控配置仍与上次现场一致。此变化不是本轮操作：本轮只有读取、下载、离线修复和Git推送，没有云函数代码更新或调用。

独立下载当前Gen1包共1632文件，其中1547个依赖文件，SDK2.11.0。原始文件map的SHA256为 `8686f7b5a8c3d9d73060d406caafffd5f3cd9b0048135eb5b0269948271e26d3`。包中未发现SOURCE_IDENTITY/RELEASE_SOURCE，不能仅凭修改时间或本地分支名称确定整包源码或部署人。

与已存在的F3分支源码 `d1c04c6b230e0ddf825f482b555a79c342b6620c` 比较：入口、冻结模型和新增 `common/utils/trading-freshness-gate.js` 三项原始字节匹配；另77项仅CRLF/LF不同，包括冻结manifest和推理文件。`common/schema.js`、`common/utils/datasource.js`、`common/utils/gen1-guarded-seal.js`、`common/utils/v361-run-context.js` 四项并非仅换行差异。config.json为无对应源码的配置文件。完整下载、map和比较结果保留于仓外 `production-drift-gen1-20261103/`。

这些证据证明当前包的物理指纹及部分源码对应关系，不能证明部署授权、部署人、整个包等于该源码或自然运行已经验收。本轮不修改这些文件、不回退Gen1，也不把本地F3分支自动合入生产候选。

后续Gen1 Node24派生包必须保留此次实际包的业务、依赖和冻结对象字节；不得沿用D-026代码大小或凭本地canonical common覆盖这四个差异。生产切换前仍须完成其实际派生包、资格和自然运行核验。当前独立隔离probe不导入或调用Gen1，更新后的申请以此次完整配置为“不改既有资源”的基线；执行前如再漂移则停止。
