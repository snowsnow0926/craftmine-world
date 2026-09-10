# 直接编辑的生产宿主接线与验收

直接编辑从主窗口主 frame 的 `godot.creationEdit` 进入。宿主核对当前查看会话、项目插件、
世界选择和未过期捕获；存在其他任务、采用、恢复、复制、导出或初始化时拒绝新编辑。
开启持久 session turn 并写入玩家编辑记录，固定 DirectCreationIntent 作为检查要求。
此任务不启动模型，原世界自动采用设置不能替代这次明确参数编辑的授权。

属性、删除和撤销调用既有工具完成源码 CAS、check 和正式采用。应用前与应用临界点均重新
核对宿主任务、session/world、正式 build/instance/source、冻结要求哈希、实际 passed job、
候选来源/check output hash、当前源码 revision/manifest/content。任何变化阻止采用。

`godot.creationEditHistory` 必须从 `godotRuntime.exportSource` 的正式 contentOid 读取
`world/creation-operations.json`。正文字节数及 SHA256 同时匹配正式文件元数据与 core
返回值，读取后复核正式构建；只有 `freezeUndoRequirements` 可验证的最近记录可撤销。
不读取工作稿日志作为撤销授权。

操作进展保存在隔离用户数据目录 `creation-edits`。`godot.creationEditStatus` 必须提交
operationId、sessionId、worldId；宿主验证当前 session/world 后才能重绑定 renderer owner。
冷启动未终态先显示中断；如果保留的 job/candidate 已由 core 确认通过且正式 build 与该 job
完全匹配，则只读返回 `reconciled:true, phase:applied`，不重放源码修改或模型调用。

新增固定自动验收 `tests/creation-edit-native.mjs`。它使用独立 headless Electron 和浏览器
profile，把实际 React 属性组件通过限定测试传输接入真实主窗口 IPC。测试只通过页面函数
触发组件状态，不使用浏览器 click/fill/keyboard/mouse。初始树由明确标注的固定作者样例经
相同源码/check/采用链创建，不计入模型能力。测试覆盖尺寸颜色、删除、撤销、完整进度、
新进程恢复、操作阶段故障后核对、跨世界拒绝及实际模型调用为零。物理操作和主观体验另验。

固定 acceptance 控制器只有在既有独立 profile guard 和 `CRAFTMINE_EDIT_ACCEPTANCE=1`
同时启用时安装，不能接收任意源码、任意 host RPC 或运行时状态设置。
