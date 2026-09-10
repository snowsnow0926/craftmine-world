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
