# P5：任务统计展示与取消 PI 版本外链

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

对应 FB01-002 和 FB01-005 的界面侧。两项都属于产品信息展示，由同一人处理以减少公共 UI 冲突。

独占 apps/desktop/src/components/Sidebar.tsx 的版本区域、ChatTranscript.tsx 的统计挂点、专用任务统计组件及样式/文案。P4 提供真实统计 DTO 和聚合逻辑；P3 拥有 App.tsx/快捷键，P10 拥有 Main index.ts。若更新服务必须调整，向 P10 交最小接线修改，不扩成自动更新重构。

取消版本入口导向 PI Desktop 的外链及隐式更新请求，保留本产品真实版本；可提供非跳转的构建身份详情以区分同为0.14.3的旧包和新包。事实需核对：当前 Sidebar 调用 updatesCheck，Main 配置 enabled:false，updater.ts 仍含 PI releases 地址；截图无法证明运行包的具体调用链。验收必须覆盖实际封包入口，而不是仅删一个源码字符串。不要改成随意猜测的项目网址，也不删除许可/署名文件。

在本次操作的可见摘要中展示总 Token、TPS、总耗时、实际模型；运行中和结束后均可查看。具体位置由现有界面和可读性决定，用户没有把它限定在“检查记录”页。明确“本次操作”范围，切换会话/历史记录展示各自历史数据。多模型、部分用量、未报告、估算分别可辨；没有数据用“—/未报告”，不是 0。TPS 附简短口径，耗时不得只取最后一条回复。详细 token 拆分和分模型信息可以展开，默认不堆技术参数。

可先用显式夹具开发展示，但最终必须接 P4 正式数据，夹具不能进入生产回退。测试覆盖正常/运行/取消/未知/部分/多模型/历史/长文本/窄窗口；在受控组件环境调用事件处理器并捕获路由，确认版本标识不触发 updatesCheck/openReleases/openExternal。禁止真实点击和键盘模拟。P10 在新包里复核最终行为。
