# D｜预览应用、世界画面与保存生命周期

你是“最中幻想 / Craftmine World”本轮并行开发的专责 agent。用户已授权开发，请完成实现、适当验证和交付，不要只给方案。你只负责下文指定范围，其余由其他 agent 和主任务处理。

先读：
- D:/Craftmine World/AGENTS.md。
- D:/Craftmine World/docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md（主目录有尚未提交的最新内容，必须只读这里的版本）。
- D:/Craftmine World/docs/PROGRESS_REPORT_2026-09-10.md、docs/GODOT_CYCLE_05.md。
- 涉及 vendor/pi-desktop 时，再读该目录 AGENTS.md 和相关 spec/ADR。
- 许可与导出有关工作另读主目录 docs/LICENSING_STRATEGY.md，不把决策记录当作已完成的许可适用。

共同执行约定：
1. 启动时核对最新本地 master、Git 状态和工作树。分发时 master 是 92c98b2，实际开发以最新已集成提交为准。新建自己唯一的 codex/ 分支及独立工作树；禁止在主目录或别人的工作树开发。不要让多个 agent 并行 pull、合并或清理主目录，统一由主任务集成。
2. 下文旧树只作为只读交接来源。已有提交保留提交历史；尚未提交的成果，确认源已停止修改后，仅在自己的新树接续被明确分给你的文件差异及新增文件，记录来源、文件哈希和基线。不要整树覆盖、遗漏未跟踪源码或把缓存/数据一并带入；不得修改、删除旧树。稳定交接未齐时先完成不依赖它的工作。
3. 主目录 README.md、docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md 和 docs/LICENSING_STRATEGY.md 属于其他任务的现存修改，禁止覆盖或顺手提交。不要操作历史残留工作树、用户存档、共享引擎缓存或正在使用的客户端。
4. 自动验证仅使用独立 headless/offscreen 进程及独立数据目录，初始化禁止 requestPointerLock 和抢焦点。禁止真实鼠标键盘、Playwright mouse/keyboard/click/fill、激活窗口或操控用户浏览器；禁止运行 tests/browser.mjs、tests/modules-browser.mjs。通过页面脚本、HTTP、纯逻辑或受限测试接口验证；不能直接写“预期状态”冒充真实玩法执行。
5. 每个模块只保留一位写入负责人。跨范围需求提交精确接口说明或小补丁建议给对应负责人。共享主入口 electron/main/index.ts、plugins/craftmine-world/view.mjs、全局依赖锁文件以及总 E2E 文档由主任务合并接线；你提供可合并片段和调用示例，不在自己的交付中夹带另一位 agent 的整份修改。Rust main.rs/lib.rs 由 A 管理。不得另建一套世界数据库、模型循环或宽权限执行路径。
6. 本轮任务报告放 docs/dispatch-reports/godot-remaining/<你的字母>/，专属测试优先放 tests/godot-remaining/<你的字母>/。行为变化同步独立 spec，架构/协议变化写独立 ADR；vendor 内文档、代码注释和提交信息使用英文。ADR/E2E 用唯一任务标识准备片段，主任务统一编号和汇入总表。
7. 保存首次失败、重试及最终成功原始证据；标明源代码、引擎、二进制、构建和数据身份。逻辑测试、预制样例、真实引擎、正式客户端、真实产品模型和人工手感分别记账。不能把 mock、固定样例或退出码 0 当作整个功能验收通过，不能放宽冻结断言或改通过标准掩盖失败。
8. 依赖未齐可先开发模块、契约及测试，但最终必须完成实际接线验证才可宣称该条完成。发现环境权限拒绝，保留原始错误和明确的待执行命令交主任务，不绕过限制或反复换方式；同时继续独立工作。
9. 每个完整逻辑改动单独提交，只提交自己的范围，不推送。交付分支、提交号、改动文件、接口、验证命令及原始证据、未完成项、依赖和集成顺序。本次由主任务统一审计合并；你的树交付时保持干净，合并确认后的清理只涉及你自己的新树。

## 专责任务

你的目标：修稳 GD1/GD2 的真实游戏视图、候选预览和应用，保证失败时旧世界及最新进度可靠保留。

独占 Electron main/godot-world-view-host.ts、godot-runtime-adapter.ts、godot-candidate-coordinator.ts、preload/godot-world.ts、shared/godot-world-chrome.ts，以及 desktop/godot/web/** 的运行桥/呈现生命周期。godot-build-verifier.ts 和 godot-check.ts 属 C。旧成果里的 electron/main/index.ts 与插件 view.mjs 仅提取自己的最小接线片段交 root，不在分支中覆盖共享文件。

接续只读 D:/Craftmine World/test-results/g6-host 的未提交成果：两阶段候选、取消预览保留原实例、提交/面板回包丢失恢复、非零 pending viewport、13 项协调测试、4 项宿主测试。真实候选首次因来源校验失败，A 已有修复；第二次 T1e3bp 在后续预览 ready 超时，仍失败。最新 bounded destroyed 等待与 renderer 生命周期诊断尚待真实重跑，不能宣布问题解决。

必须完成：
1. 复现并定位连续预览超时，保留 renderer console、did-fail-load、render-process-gone、destroyed 及实例身份。不得通过扩大超时、删掉重复预览或只看纯逻辑测试隐藏问题。
2. 预览使用独立候选实例和状态；取消恢复原实例。确认应用时读取最新正式进度、暂停并迁移、确认新实例正确后提交和提升；未确定成功时两侧保留并提供明确恢复路径。
3. 区分 core 提交回包丢失、host 提升失败、panel 回复丢失。仅按完整世界/候选/构建/实例/输入身份查询回执；重复操作不重复应用，不把其他候选成功当当前成功。
4. 正式世界间切换也保留旧实例直到新世界加载/保存确认，失败可恢复；隐藏面板、切游玩、窗口缩放、退出、崩溃和插件重载都遵守保存/暂停/清理边界。
5. 和 E 完成中央区域尺寸、可见/隐藏、创作/游玩保留状态。实际离屏画面不能替代可见合成和玩家手感，记录剩余 WebGL 警告及其影响，不把 visible=true 当实际可见。
6. 配合 A/C/F 完成真实候选循环以及三底座完整退出重启、失败保护的最终同版本测试。
7. 补充尚无正式 Godot 世界时的首次加载确认接口，配合 A 的初始化事务、F 的初始状态和 C 的真实产物。不要将“必须已有正式 Godot 世界”保留为新建流程的前置死循环；首次创建失败回到可恢复创建状态，不假装旧实例存在。

验收对应 A02、A05、A14，支持 A01/A09。新增原生测试严格无真实输入，不使用旧用户进程和数据。交付旧 index/view 接线片段、私有 API 与 UI 可恢复状态合同。

交付判定：逐条对照以上任务，不以“测试很多”“接口已定义”或“已写完报告”代替实现。确实未完成的条目逐项保留，并给出下一步可执行入口。先交付可消费的接口和逻辑提交，最终再给完整报告。
