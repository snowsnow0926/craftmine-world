# 全部派工提示词合订本

本文件由11份独立提示词原样合订。每个任务有自己的完整边界；按标题分发，P9为后置可选。当前只准备文档，没有启动开发。先看同目录README的并行顺序和文件负责人。

# P1：世界初始化、加载与故障解释

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

对应 FB01-001。调查第一人称 1111 和俯视 111 不能进入的问题，分别验证，不预设同因。先确认实际可复现链路，再修复；不能只加大超时、忽略报错或把 90% 改为成功。

独占 vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts、godot-world-initialization.ts、godot-candidate-coordinator.ts，electron/preload/godot-world.ts，desktop/godot/web/runtime.mjs、shared/runtime_bridge.gd 及本任务测试。index.ts、godot-world-creation.ts 的共享路由由 P10 接；plugins/craftmine-world/view.mjs、world.html 属 P2；P3 全屏使用你的公开接口，不自行改 host。

关键线索：host 的 load catch 可能先 retireInstance 再 describeFailure，后者选择最后 fault；因此 renderer-destroyed 可能来自主动清理。requests=15/15 是 HTTP 请求统计，不能替代 load 应答。旧报告中同样的零尺寸 WebGL 警告也出现在成功离屏样本，不能直接归因为显卡问题。

记录同一 world/build/instance/request 下的 ready、load 发送/接收/应答、surface/viewport 尺寸、首次画面、超时/异常、清理时序。分离首因与清理后果；检查隐藏、最小化/恢复、DPI/尺寸更新和 renderer 生命周期。保留未初始化世界原始错误与显式重试入口，不自动覆盖原世界或反复造新工程。

验收：第一人称和俯视首次创建→真实 load/快照回执→可玩；其余两底座回归；切世界、隐藏恢复、主动重试、重启；失败、迟到回包和缺回执不得误报就绪或误删源码。复用并先审查 tests/godot-remaining/D/godot-candidate-host.mjs、godot-runtime-abort.mjs、godot-candidate-renderer.mjs，tests/godot-runtime*.mjs、tests/godot-final/client-initialization-retry.mjs，以及 desktop/test/godot-initialization-terminal.test.mjs。纯逻辑、真实隔离客户端和人工显示验收分开记。


---

# P2：解释为何不能应用，并打通符合条件的采用流程

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

对应 FB01-003。小狗/雷神之锤有预览效果，应用按钮却灰掉。先查按钮实际禁用分支与正式服务状态，不擅自认为全部是评审失败，也不要取消验证来“修好按钮”。

独占 plugins/craftmine-world/view.mjs、world.html、相关预览/评审展示模块及专项测试。现有 controls()、refreshReview()、applyCandidate()、reconcileApplication() 是调查入口。Godot 与旧体素分支都要分清；P1 的 host/候选协调器由 P1 改，核心事务与共享 RPC 接线通过 P10 协调。P3 所需插件侧全屏/退出提示挂点、P6 发现的工作台问题统一由你接，避免双写。

在按钮旁显示简短、真实、持续可见的原因与可行下一步：正在操作/保存、未完成检查或评审、历史草稿、结果过期、检查失败、服务不可用、正在确认采用结果等。可展开查看技术细节，但不把内部 ID 堆给玩家。不能只做 disabled 按钮的 hover title。基于权威状态推导，与后台准入一致；检查通过、预览存在、正式应用成功分别显示。

允许应用时保持原有事务、当前草稿校验、最新游玩进度、重复点击幂等和丢回包对账；未知结果先查原操作回执，不再次创建应用。历史检查应指向“检查当前草稿”，不得把旧结果套到新草稿。建议性评审与硬性错误沿用既有规则，不能把建议全部升级为阻断或把硬错降级。

验收矩阵覆盖所有实际禁用原因、缺数据/读错、过期候选、取消/重试、重复应用和应用成功后重启；Godot 和旧体素路径各有适用案例。原世界与进度保持正确，界面原因随真实状态更新。模型请求由 P8 统一安排，不能为复现随意复用玩家密钥；小狗/锤子原提示未提供时，新增标准案例明确标为重建案例。


---

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


---

# P4：本次操作的真实 Token、TPS、耗时和模型数据

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

对应 FB01-005 的数据侧。先提交一份 P5 可直接消费的字段契约和正常/部分/未知/运行中/终态样例，随后完成真实持久链路；不能让 UI 自行发明累计器。

建议“一次操作”定义为一次用户提交触发的完整 Agent turn，包含该 turn 的多轮模型调用和工具链，优先使用持久 sessionId+turnId。它与跨多次用户输入的创作任务、视觉消息分组及整个会话累计不同。若产品已有正式更细 task ID，映射写清；不要默默改变统计范围。

真实入口：packages/shared/src/types.ts 的 MessageUsage 与 modelId/providerId、responseDurationMs/responseOutputTokens；packages/agent-runtime/src/runtime.ts；apps/desktop/src/lib/assistant-turns.ts；electron/main/craftmine-telemetry.ts；crates/host-core/src/sessions.rs 的 turn/usage_json。独占统计合同、归属/去重算法、runtime 必要字段、host-core 持久查询与上述聚合适配；Main index.ts session.endTurn 的最终接线由 P10。P5 独占展示组件。

总 Token 汇总每个实际模型调用的 usage，明确缓存读写/推理是否已包含在 total，防止重复相加。部分调用缺 usage 时标“部分统计”，全缺时标“未报告”，不能填 0。重试中的实际新请求算新调用，同一回执重放不能重复计入；子任务归属显式定义，不能同时计父已汇总数和子明细。估算只可单独标注估算，不冒充提供商精确数据。

任务时间为开始至终态的墙钟总时间（含工具和等待），与模型流式时间分开。TPS 默认输出 Token/对应模型生成秒数，给出统计窗口；并发、多模型不得把速度简单相加，无法可靠归属时显示分模型或未知。模型使用当时实际绑定的 provider/model，不能拿当前输入框选项代替历史型号。运行中显示可更新快照，完成/失败/取消/中断后持久可查。

验收采用真实事件格式的可重复回放：多轮工具、重试、重复事件、缺 usage、估算中止、并发/子任务、多模型、跨会话迟到、重启。校验不串任务、不漏/重计、不把模型流式耗时当总耗时。P8 负责获授权后的真实模型对账；本任务无需为统计测试调用收费模型。


---

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


---

# P6：素材入口及已实现增量的真实客户端验收

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

来自用户指定进度报告的素材、参数默认值、问题导出待办。先读 Git closeout：素材 Main 接线/收藏标签已在 eae2799 合入；43 项定向检查通过。参数默认值与单条问题导出也已实现并有开发客户端证据，不能重新写一套。

从共同源码的完整隔离客户端测试素材浏览、支持格式预览、标签、收藏、清空、错误解释、重启持久化、切世界的过期响应；同时回归恢复底座默认参数的来源与检查/预览/采用、单条问题导出仅包含选中问题及其原始补充/版本。P10 提供有固定源码/载荷身份的开发客户端；包内最终回归再用 P10 的新候选包。

独占素材专属组件、plugins/craftmine-world/asset-service.mjs 及专项验收脚本中实际发现缺陷的最小修复；共同导航/入口交 P10，view.mjs/world.html/workbench 接口交 P2。只改自己发现且可证实的失败，不能按旧报告“待合并”重复搬旧提交。

验收必须从产品入口到实际 core/持久数据走通，组件夹具和正式客户端结果分开；覆盖至少一个支持格式的完整导入→预览→选择→复用→保存重开，对格式差异列清支持与未验范围。素材元数据成功不等于素材在世界内使用成功。无需读取玩家私有目录；用新的 D 盘有限样例。

不扩成远程素材库、全格式导入、通用作品升级或总库删除。输出逐项矩阵及真实身份，失败回传相应负责人，当前包无此功能时不能拿源测试宣称包内通过。


---

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


---

# P8：真实模型创作与故障验收记录

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

对应 FB01-001/003/005，也补齐进度报告明确未完成的真实产品模型闭环。先准备案例、证据格式和隔离数据；待 P1/P2/P4/P5 接入共同客户端、P10 给出明确候选后执行。不能用固定脚本替代模型作品。

先核对当前会话已有的模型、发送数据和费用授权；只在明确范围内发请求。旧报告明确该授权当时未取得，本派工文档不自动授予读取密钥、复制玩家 profile 或无限模型预算。缺少必要授权时先完成全部离线准备，再列出具体模型、发送内容、次数/费用上限供用户决定；不要仅因常规本地测试需要就重复询问。

用新的 D 盘测试世界和合成数据，通过正式聊天/工具链完成：自然语言创建或修改→读工程/写入→构建/运行反馈→必要修错→预览→正式采用→继续游玩→保存重开。选一个第一人称和一个俯视世界；小狗及雷神之锤各设有限明确效果与行为断言。原提示未提供，必须标记为重建案例，不能说完全复现玩家原提示。

记录当时真实 provider/model、原提示、每次实际请求/工具/重试、usage 的完整/部分/缺失情况、TPS 口径、模型与任务耗时、每次失败及恢复。核对 P4/P5 显示与真实事件一致。中断、缺回执、初始化失败、过期候选、采用失败要有安全且有限的故障注入；保护现有世界，不能改评分使失败消失。

独占验收驱动、样例需求和证据，产品缺陷交回 P1–P7，修复后仅重验受影响范围。最终对 P10 同一候选包验收，完整记录源码/包/引擎/broker/plugin 和 profile 身份；若源码变化，旧包成功保持历史身份。输出“通过/失败/未运行/待授权/需人工复测”，不写虚构通过率，也不把用户没复测的体验写成已验收。


---

# P9：四底座有限示例内容与新手试玩路线（后置可选）

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

来自进度报告的原型内容与体验待办。本任务是后置可选任务：用户可在核心创建/采用问题修复后分发；不阻塞当前修复包，也不把完整农场、泰拉瑞亚或银河城纳入一次任务。

先审查 desktop/godot/bases 四底座现有可玩样例和 docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md，复用已实现行为，不把现有商店/采集/房间/采矿重写。每底座最多补一个可在约5分钟内体验的明确目标、结束反馈和可修改入口；优先补缺少引导/反馈的地方，资源量与新增系统保持有限。示例必须独立、可恢复、可复用，不自动替换玩家世界。

独占新增样例/教学数据与其说明、专项场景测试。共享 player controller/runtime_bridge、主生成/初始化逻辑由 P1/P3 协调；新手公共入口交 P2/P10；不要同时改全套底座主运行脚本。自制资源明确来源及许可，不移植提到的商业游戏素材；无素材来源时交原创简单资源并说明画面范围，不冒充最终美术。

验收每个新增样例创建→目标行为→保存重开→参数或对象修改→预览采用→再次游玩；新增内容可选且不破坏空白起点、旧世界和已有实例。通过图片/离屏截图记录视觉结果，真实手感留给用户。P10 决定此批是否纳入新包；若后置，报告不得写成主修复包已经包含。


---

# P10：统一集成、正式接线与同源码 Windows 修复包

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

作为本轮唯一集成人，可先协调基线/接口，不替其他负责人同时写其模块。目标是把五项反馈修复及验收通过的后续增量组成一版可明确识别的新客户端，并从同一源码重建交付。P9 内容是否纳入需明确记录，不让它无限拖延核心修复。

起点为 eae2799；先保留并核对其已合并参数默认值、问题导出、素材 Main 接线、回收修复。7a089d6 与 eae2799 只有文档证据差异，现有定向成绩可作该源码背景，不能充当新包终验。master5195ef5和冻结827包是不同身份。

独占 electron/main/index.ts、共享 IPC/服务构造/导航最后接线、全局锁文件/版本/打包入口和综合测试入口。P1/P3先交 runtime/快捷键挂点，P2交应用原因与插件挂点，P4先交统计合同供P5，P6/P7交真实验证及修复。接收各自提交后做有审查的集成；每个公共文件只允许一个在写的负责人。未经用户新授权不合并master、不推送和发布，先交可审查分支。

阶段顺序：共同开发客户端→P1–P7验证→明确范围并冻结唯一提交→从该提交构建setup、portable、source与全部载荷→P8真实模型与故障/P11隔离安装性能→最终报告。不要等“全包验收通过”才开始制作待验候选造成互锁。若修复改变载荷，重新生成明确身份并重验影响部分。

给新候选可辨的本产品版本/构建ID，避免继续仅用0.14.3混淆；统一修改版本位置，记录方案。完整核 ASAR/core/host/broker/plugin/runtime/固定Godot及安装器实际payload、源归档和便携包对应关系。构建及解压输出放D盘，不覆盖封存827、用户启动器或存档。

验收至少覆盖FB01五项、四底座创建/切换、预览采用保存/重开、复制复用、备份恢复和P6/P7新增行为。原包121项、旧失败、各开发测试、新包结果分表，不把旧数字相加。交付可测试包路径、唯一commit、哈希清单、逐项证据和未验项、用户试玩步骤、干净环境验收状态。不能宣称社区/L3/L4或完整成熟产品完成；结束后停止。


---

# P11：隔离 Windows 安装生命周期、发行检查与性能

## 执行边界（完整提示词的一部分）

这是用户准备分发的开发任务；只有收到用户分发或明确执行指令后才开工。本轮编写提示词不代表已经开发。派工资料固定在 D:/Craftmine World/docs/dispatch-prompts/player-feedback-20260910/，先读该处 README.md、D:/Craftmine World/AGENTS.md、D:/Craftmine World/docs/USER_FEEDBACK_BATCH_001_2026-09-10.md 和 D:/Craftmine World/docs/GIT_CLOSEOUT_2026-09-10.md；这些新文档不要求已经存在于你随后新建的代码工作树。用户的“不抢鼠标”和手工分发要求优先。

统一开发起点为已存在的 codex/integration-next-20260910，固定提交 eae279915094f09d987ef0eb747eba20ef92cd0e；由 P10 确认共同基线。若其后已有提交，先核祖先与变更，不能重置别人的成果。每人使用 D 盘独立 codex/ 分支与工作树、独立测试数据/输出/Cargo target；不要在 C 盘另建大量缓存。不要修改 C:/cm-playtest-827、封存的 827 发行目录或用户正在使用的客户端。

验证不得操控真实鼠标键盘、置前窗口、申请 Pointer Lock 或使用个人浏览器；浏览器仅独立 headless/offscreen，初始化禁用 requestPointerLock，使用 HTTP、页面脚本和纯逻辑验证，禁止 Playwright mouse/keyboard/click/fill。不得运行 tests/browser.mjs、tests/modules-browser.mjs；其他历史测试先审查入口，不能仅凭文件名判断安全。进程控制只针对自己的明确身份测试实例。

只做本任务范围。共享入口、锁文件、版本和总测试入口由 P10 协调，不能多人同时改。需要其他负责人接线时交出具体契约和最小接线提交；接线前标“待集成”，不要假定下一位会补完。提交自己分支后报告并停止，不自行合并 master、推送、上传发行物或恢复循环开发。报告放 docs/dispatch-reports/player-feedback-20260910/本任务编号/REPORT.md，含基线/HEAD、改动、接口、真实命令与原始证据、失败、未验项及集成依赖。历史成功不能计入新版本；未获得人工复测不能写“玩家已验收”。

## 本任务要完成的工作

来自进度报告的干净环境、安装器、154条历史预检警告、权利材料和性能待办。可与开发并行准备环境/矩阵，最终运行必须使用P10的冻结候选。旧154是旧包的历史数量，新包重新检查，不能原样当成当前警告清单。

独占独立安装/升级/卸载与性能验收脚本、结果和发行检查整理；包制作/产品版本/总构建入口由P10。只用明确隔离的干净Windows VM/测试设备和测试用户，不能在玩家当前系统直接执行破坏性安装卸载或注册全局关联。若无隔离环境，先完成可执行驱动、样例、安装器静态材料核对，明确缺少哪项环境，不把静态解包写成安装通过。

验收首装启动、重开、同用户升级、数据迁移与保留、卸载/重装预期、独立导出游戏在无开发工具环境启动保存。使用合成存档，不复制玩家密钥。保留安装日志、退出码、实际载荷、用户数据前后身份；保存失败和权限失败保持可恢复。

性能采用明确设备/OS/GPU/分辨率/场景/候选，记录冷/热启动、初始化/构建/保存耗时、内存、磁盘增长与可采集的帧表现。性能与“功能能运行”分开；离屏软件渲染不能冒充真实显卡帧率，多屏/全屏/IME/实际键盘手感留独立设备或用户人工测试，不违反不抢输入偏好。

重新分类发行警告，区分缺文件/版本错误等可修阻断、已知预览限制与确需权利人或签名输入的事项；不要擅自替换总许可证、删除第三方声明或声称未核素材已获授权。未签名本地预览与正式公开发行分开标注；不上传、购买证书或自动联系第三方。

交付与P10同一commit/包哈希的逐项结果、真实环境说明、待补材料及实际阻断。能证明多少写多少，报告完成不等于所有安装/设备项目均通过。


---

