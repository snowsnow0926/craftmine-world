# P7：新任务自动回收真实验证与测试磁盘控制

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

来自进度报告的临时引擎回收和本次磁盘经历。eae2799 已含回收/日志关闭保护，53 项 retirement/executor、36 项 broker 编译单测及完整 TS 已通过。本次人工删除178份旧副本不是新自动回收功能的验收，不应重复做批量清理。

独占 plugins/craftmine-world/godot-executor.cjs、godot-task-bin-retirement.cjs、desktop/godot/sandbox 相关 broker 回收实现及专项测试；共享服务注册/构建总入口由 P10。先复核现有实现再用新编译真实 broker、真实引擎和独立任务验证，只修发现的缺陷。

覆盖 preflight/import/export 成功：结果已被确认、实际引擎退出、stdio/log 收完后才回收自己的临时 bin。覆盖失败、未知退出、未确认回执、日志迟到、重复回收、重启恢复时的保留/幂等边界。不得按 PID 名称或不完整身份清理别人的进程；不要删工程、产物、日志、回执、存档或发行物。明确回收成功与可重试/保留状态，杜绝静默丢证据。

记录新任务前后目录与大小、原文件哈希、进程完整身份、回执和日志关闭时序。循环少量固定任务，证明成功后磁盘不会按每次一份引擎持续线性增长；异常证据保留会占空间，应可解释。记录逻辑大小和实际可用空间，不混作同一数值。

本轮所有新缓存/测试数据放 D 盘；大测试前检查空间并设置有限任务规模。只管理本次隔离目录，不删除既存旧测试、被审批拦截的 junction/SLXOaa，或其他工程缓存。P10 从同源码编译的新包里再跑适用回收场景，不能从开发 broker 推定包内 broker 已更新。
