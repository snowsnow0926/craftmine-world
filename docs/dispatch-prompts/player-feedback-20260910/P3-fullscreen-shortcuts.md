# P3：游玩全屏、退出全屏与焦点规则

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

对应 FB01-004。本轮默认把“退出”解释为退出全屏并继续游玩，不解释成结束整个客户端。需要清晰的快捷键提示；如另提供“返回创作/退出游玩”，必须作为不同动作显示。

已有 F11 全窗口全屏，不要重造一套互相冲突的机制。调查 packages/shared/src/keyboard-shortcuts.ts、apps/desktop/src/App.tsx、components/CraftmineLayoutControls.tsx 和 Main 的全屏路由。Godot 是独立 WebContentsView，游戏有焦点时主 React 页未必收到按键；必须覆盖此边界。

独占 App.tsx 的布局/快捷键区域、CraftmineLayoutControls.tsx、keyboard-shortcuts.ts 和新增有限输入协调模块；index.ts 最终接线由 P10，host/preload 生命周期挂点交 P1，插件 view.mjs/world.html 挂点交 P2。先提交键盘事件与焦点契约，不能抢改对方入口。

建议 F11 切换全屏；Esc 按层级处理当前弹窗/菜单或鼠标释放，再退出全屏，不一次跨多层。按实际现有行为确定最终优先级并记录，保持聊天输入、中文 IME、组合键和其他窗口功能正常。按住按键不连续翻转；监听随实例释放，切世界迟到事件无效。退出全屏不重建世界、不丢状态、不触发整个程序退出。若退出游玩，复用 pause/checkpoint 的真实保存回执后返回创作；隐藏 surface 本身不算保存成功，保存失败要保留现场与重试入口。

验收：先做事件状态机和受控 DOM/IPC 测试，再用独立无输入客户端验证状态与保存接线。覆盖世界/聊天/菜单焦点、Godot 子视图、无世界、加载中、预览中、保存失败、重入和监听释放。不得用真实键盘注入验收。多屏/DPI和玩家实际按键体验交 P11/用户复测，未测部分明确列出。
