# C 桌面工作台接口 v1

本组使用既有 `pluginBridge.invoke(channel,payload)`，没有直接 Rust RPC、任意文件路径、原生 eval 或第二套持久世界资料。新增纯 UI 模块 `plugins/craftmine-world/workbench-ui.mjs` 被 view.mjs 导入，原 bundler 会自动纳入 view.js，无需复制额外运行文件。

## 能力与身份

`workbench.capabilities({worldId}) -> {channels:string[]}` 必须仅列已接通的业务通道。未提供的方法显示“尚未连接”或禁用按钮，不能返回伪造成功。每次世界切换重新获取能力和任务。

下表所有调用均带 current 正式世界的 `worldId`。UI 不发送 projectId/sessionId/turnId，G 从宿主当前查看会话核对世界并绑定。异步结果只更新发起时的 world/epoch；世界切换取消旧展示结果。G 仍需再次进行租约、代际、世界版本检查。

| 通道 | worldId 以外的请求字段 | 响应消费 |
| --- | --- | --- |
| task.current | 无 | `{context:null|A任务上下文,active:boolean}`；兼容直接 binding 上下文 |
| library.search | query,kind?（object/gameplay/creation）,offset,limit=12 | `{items:[{ref,name,kind,description,dependencies,scope,evidence}],next,total}` |
| library.read | 精确 ref{id,version,hash},start,limit=12000 | 元数据 + `source:{text,start,next,totalChars}` |
| library.install | ref,revision?（当前 context.draft.revision）,operationId | 必须返回 receipt；UI 只说明加入草稿，仍需检查/评审/应用。active=true 禁用 |
| library.capture | operationId,kind,resourceId,tags,applicationId? | G 提取/核对真实应用来源，缺少证据须拒绝；返回 ref |
| memory.search | query,includeInactive,offset,limit=12 | `{items:memoryRecords,next,total}`；scope 和 sourceRefs 都来自宿主 |
| memory.propose | operationId,kind(project-rule/workflow),claim,tags,replaceId? | G 构造真实用户操作来源和 scope，不能凭 UI 指定 validated |
| memory.retire | id,reason | 显式玩家停用的回执 |
| task.recoverable | 无 | 数组，或 `{items:[{taskId,generation,reason?,summary?}]}` |
| task.resume/discard/stop | taskId,generation | G 绑定真实会话。resume 不由 UI 发明 turnId；stop 后重新读取状态，不凭“已发请求”宣称已停止 |
| backup.export | operationId | E `{status:completed/cancelled,scope:profile,...}` |
| backup.inspect | 无 | E `{status:ready/cancelled,grantId,expectedCurrentHash,counts,scope:profile}`；UI 不接收路径或 archive body |
| backup.restore | grantId,expectedCurrentHash,operationId | E/A 真实恢复回执；同一次未确定恢复保留原 operationId |
| backup.status | operationId | 查询原恢复记录；失败/未知不会显示成功 |
| diagnostics.status | 无 | `{credentials:{status:protected/fallback/unavailable},summary?,...}`，不得含密钥 |
| diagnostics.export | operationId | 已脱敏导出回执 status=completed/cancelled |
| diagnostics.help（可选） | 无 | 宿主打开实际 Windows 指南，缺能力不显示按钮 |
| selection.set | build{id,hash},objectId,selectionRevision | G 再校验真实世界、对象和宿主来源并更新当前需求上下文 |
| selection.clear | 无 | 明确移除当前世界的需求对象 |

## 与 A 的适配

UI 使用 kind/resourceId 选择真实 scene.objects、systems、behaviors。creation 传行为 ID，不能把选中对象 ID 当 creation group ID。applicationId 只在宿主任务回执可用时携带，否则 G 应从当前世界的真实应用记录导出，不能信任任意模型来源。

`replaceId` 应映射为 A 的 `record.supersedes`，保留 A 对验证来源和原子替代的约束。仅保存 proposed 新记录不能自动停用 validated 旧规则。面板的独立“停用”是玩家明确操作。

library.install 的 operationId 供 G 绑定持久幂等 action；A service install 的 toolCallId 由 G 衍生，去掉 UI 包装的 worldId/operationId 后再传 `{ref,revision,position?}`。没有活跃任务时 G 可创建宿主所有的短操作任务；模型正在创作时 UI 禁用安装，G 也必须拒绝竞态。

## D 选择事件

view.mjs 在正式游戏 load 增加 host 当前 record.id 的 worldId。接收消息先核对真实 iframe source、既有 nonce、channel，再核对 worldId、build.id/hash、actual scene.objects、严格递增 selectionRevision。需要等待能力初始化时只暂存最新合法选择；异步旧回执不能覆盖后来的选择。旧版本、未知对象和其他世界在 UI 侧拒绝，G 仍做宿主复核。

清除/重新选择只管理本次需求上下文，不修改世界。世界切换清空 chip。预览 iframe 没有进入此监听器。

## E 备份恢复

备份范围明确为 **此客户端全部世界和作品**。检查备份前先完成现有 world.saveProgress 并冻结游戏；随后 E 取得 expectedCurrentHash。确认恢复前不再重复保存改变该 hash。恢复期间保留 inspection grant 和 operationId；失败可查询既有记录，不伪造成功或生成另一个重复操作。

恢复成功后调用 world.list/world.open 重新装载实际正式世界，而非继续用旧内存记录。恢复 active 任务时按钮禁用。没有路径输入框，不传用户任意文件路径；原生 picker 由 E/G 所有。

## PI 创作/游玩布局

真实 React 组件 CraftmineLayoutControls 使用既有 app-store.openWorkPanelTab/setWorkPanelWidth，默认创作 480px、游玩 720px。两个模式分别记住用户调整的宽度，沿用 PI 244–720px 限制。只存 UI 偏好 `craftmine.desktop.layout.v1`；窗口重开仍保留，聊天、session、工具/file/review tabs 不清空。

它不是全屏或第二个桌面壳，也不会调用 Pointer Lock/focus。游戏控制仍须玩家点击原“进入世界”。原 PI 项目、设置、聊天、停止和多面板流程保留。

## 验证边界

`tests/dispatch/c/ui-headless.mjs` 使用实际构建 world.html/view.js + 真实 game iframe，bridge 为明确的领域响应夹具；不声称新 Rust 通道已接入。selection 测试由隔离 game frame 发消息，是 UI 消息协议测试，实际 raycast 已由 D 覆盖。

`tests/dispatch/c/layout-headless.mjs` 渲染实际 React 布局组件，store/i18n 为夹具，验证选择模式、宽度保存和 session/tab 保留契约。整个可见桌面合成、模型流式停止、所有 PI 对话入口与真实 A/E/G 联合验收仍由 G/F 执行。

## 真实业务服务（G 授权扩展）

`workbench-service.cjs` 导出 `createWorkbenchService(core,{library,memory,verifications,reviews,getSettings})`，返回 `{handle,validatedContext,selectionRead}`。library/memory 为 A 真实工厂结果；core 为现有 Rust CoreClient。main 从真实查看会话注入 `host:{projectId,sessionId,selectedWorld,active,context?,previous?,origin?}`，不允许 renderer 任意构造 host。

`handle(channel,payload,host)` 拒绝未声明的字段，要求 worldId 同时等于 getSettings().activeWorldId 和 host.selectedWorld。任务当前值从 workspace.current/task.context 获取。作品检索属于整个本机作品库，允许跨世界复用；记忆严格使用当前世界 scope。capture 要求当前构建的实际 applied 回执，注入其 binding.projectId，A 再核验 artifact 来源。selectionRead 每次再次核对正式 world/build/object，validatedContext 只提供当前 draft 仍存在的选中对象及 validated、未被替代的记忆。

main 对 library.install/memory.propose 先执行私有 `handle('workbench.prepareAction',{channel,payload:原请求},host)`，有回执则直接返回；否则新建宿主拥有的实际短 action turn 后调用正常 channel。不得把 prepareAction 注册为 renderer 能力。library 使用旧 task.context 放入 host.previous 校验 UI revision，新 action workspace revision 必须为 0；真实编译和提交后 enqueue verification，origin 由宿主注入。提交回执重放会返回 verificationStatus=query-required，不能假设模型评审或检查已完成。

memory.prepareAction 依赖 E/G 新增 Rust `memory.findReceipt({projectId,sessionId,worldId,operationId,request:{kind,claim,tags,supersedes}})`。普通 propose 把玩家此次按钮操作中的原文 claim 记录到 task.recordContext，再调用 A memory.propose，sourceRefs 使用实际 requestId。只有 project-rule 的字面用户来源能验证；workflow 仍为 proposed。替代使用 supersedes 的原子校验，没有先行 retire。main 必须阻止模型活跃期间插入这些手工 action turn；service 自身对 capture/retire 的 host.active 也拒绝。

`validatedContext(context) -> {worldId,memories,selection,build}` 供 B 请求上下文使用；context 必须由宿主提供，且当前选中世界等于其 workspace 世界。`selectionRead(host)` 用于当前宿主会话的选中对象展示，失效返回 null。

本服务 capabilities 只列自己的实际方法。G 需合并已经接通的 task.recoverable/resume/discard/stop 与 E backup/diagnostics，不能默认全部可用。resume 支持 `{continuation:'running'}` 显示正在续作，以及 send-message 显示等待玩家对话；两者都不自动重放旧 provider 请求。

`tests/dispatch/c/service-domain.test.mjs` 调用真实 A 服务、编译器和独立 Rust 进程。起始应用来源使用明确的 durable evidence fixture，未运行模型/评审/渲染器；后续 capture、跨世界 install、receipt 重放、记忆验证/替代/停用均是真实实现。临时复制 G 的二进制与 domain bundle，SHA256 见 DELIVERY_C；没有修改共享文件或共享测试 profile。
