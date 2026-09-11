# 候选预览使用当前进度

真实产品试验发现：正式世界已步行至 z≈10.83，重新打开候选预览却回到旧保存位置 z≈0.024。原因是预览入口仅暂停，再读取持久化 descriptor；直到采用时才 checkpoint。受影响的不只是视角，也包括当前尚未保存的背包、任务和其他进度。

预览现在先取得 selection hold，直接调用正常 `checkpoint({fresh:true})`。checkpoint 自己暂停并保留原暂停意图；coordinator 不提前调用 pause。保存成功后核对正式 descriptor 的 world/build/revision/snapshot 和当前 instance，确认与回执及保存快照一致，才准备、启动并确认候选。整个过程只保存正式进度，不采用候选内容，不推进 content.apply 或部署 commit。退出预览仍丢弃候选试玩变化，返回原正式实例。

保存失败且候选会话尚未建立时，只释放 selection hold 并返回错误，不调用 coordinator 原来的无条件 resume。原先正在游玩的世界由 checkpoint 的原失败恢复规则处理；原先暂停的世界保持暂停。不会恢复旧存档或丢弃尚未保存的内存进度。成功保存后的准备/启动失败继续沿既有候选恢复流程处理。

私有 `checkpoint` 增加可选 `fresh`，默认仍使用原冻结缓存。fresh 请求开始时先清除旧 frozen 成功回执，再沿原暂停、保存、确认流程执行；失败或被拒绝后不能再返回旧成功。已有 checkpointPromise 仍由并发调用共享，没有额外刷新队列。采用在丢弃候选后也明确使用 fresh，因此不会复用此次预览开始时的缓存。首次无正式世界的创建流程不调用该入口，保持原行为。

验证均为实际生产方法的离线故障注入，没有启动 Godot、Electron 档案或模型：

- 42 项 coordinator 测试通过，包含未保存位置与进度进入预览、原 playing/paused 状态下保存失败、world/build/revision/snapshot/instance 不匹配拒绝、预览不采用内容、采用使用之后的正式进度以及原有恢复/首次创建。
- 6 项真实 host checkpoint 方法测试通过：默认缓存、fresh 更新、失败/拒绝后旧缓存失效、并发共享，以及原 playing/paused 意图保留。测试直接执行生产 checkpoint 方法，避免只有“mock 永远返回新快照”的假证明。
- 3 项 additive 协议测试通过；预览新增保存带来预期 revision 增量，后续采用仍从最新输入合并。
- 工作区依赖构建与完整 desktop TypeScript 检查通过。

另外尝试既有 `tests/godot-host-lifecycle.mjs` 总套件时，其 VM fixture 没有提供早已新增的 `hasHeadlessController`，在创建 runtime 的旧入口失败，不能算本次通过证据；没有扩大范围修这个历史夹具。上述专用 checkpoint 测试避开构造器，执行的是未经重写的生产方法。新成品中的实际走动、重新预览与截图复验由总控继续，不将这些离线结果冒充实机验收。
