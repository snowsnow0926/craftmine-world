# C｜自动 Godot 执行器与独立运行检查

你是“最中幻想 / Craftmine World”本轮并行开发的专责 agent。用户已授权开发，请完成实现、适当验证和交付，不要只给方案。你只负责下文指定范围，其余由其他 agent 和主任务处理。

先读：
- D:/Craftmine World/AGENTS.md。
- D:/Craftmine World/docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md（主目录有尚未提交的最新内容，必须只读这里的版本）。
- D:/Craftmine World/docs/PROGRESS_REPORT_2026-09-10.md、docs/GODOT_CYCLE_05.md。
- 涉及 vendor/pi-desktop 时，再读该目录 AGENTS.md 和相关 spec/ADR。
- 再读主目录 docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md 与 docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md，二者已加入总计划；内容历史与素材引用按 M/N 共同契约接入。未加前缀的 A01–A17 指 Godot 总计划；素材库验收写成 AL-A01–AL-A17，版本管理写 V01–V16，避免同号混淆。
- 许可与导出有关工作另读主目录 docs/LICENSING_STRATEGY.md，不把决策记录当作已完成的许可适用。

共同执行约定：
1. 启动时核对最新本地 master、Git 状态和工作树。分发时 master 是 92c98b2，实际开发以最新已集成提交为准。新建自己唯一的 codex/ 分支及独立工作树；禁止在主目录或别人的工作树开发。不要让多个 agent 并行 pull、合并或清理主目录，统一由主任务集成。
2. 下文旧树只作为只读交接来源。已有提交保留提交历史；尚未提交的成果，确认源已停止修改后，仅在自己的新树接续被明确分给你的文件差异及新增文件，记录来源、文件哈希和基线。不要整树覆盖、遗漏未跟踪源码或把缓存/数据一并带入；不得修改、删除旧树。稳定交接未齐时先完成不依赖它的工作。
3. 主目录 README.md、docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md、docs/LICENSING_STRATEGY.md 以及其他现存未提交文件（包括新增版本管理、素材库计划）属于其他任务的工作，禁止覆盖或顺手提交。不要操作历史残留工作树、用户存档、共享引擎缓存或正在使用的客户端。
4. 自动验证仅使用独立 headless/offscreen 进程及独立数据目录，初始化禁止 requestPointerLock 和抢焦点。禁止真实鼠标键盘、Playwright mouse/keyboard/click/fill、激活窗口或操控用户浏览器；禁止运行 tests/browser.mjs、tests/modules-browser.mjs。通过页面脚本、HTTP、纯逻辑或受限测试接口验证；不能直接写“预期状态”冒充真实玩法执行。
5. 每个模块只保留一位写入负责人。跨范围需求提交精确接口说明或小补丁建议给对应负责人。共享主入口 electron/main/index.ts、plugins/craftmine-world/view.mjs、全局依赖锁文件以及总 E2E 文档由主任务合并接线；你提供可合并片段和调用示例，不在自己的交付中夹带另一位 agent 的整份修改。Rust main.rs/lib.rs 由 A 管理。不得另建一套世界数据库、模型循环或宽权限执行路径。
6. 本轮任务报告放 docs/dispatch-reports/godot-remaining/<你的字母>/，专属测试优先放 tests/godot-remaining/<你的字母>/。行为变化同步独立 spec，架构/协议变化写独立 ADR；vendor 内文档、代码注释和提交信息使用英文。ADR/E2E 用唯一任务标识准备片段，主任务统一编号和汇入总表。
7. 保存首次失败、重试及最终成功原始证据；标明源代码、引擎、二进制、构建和数据身份。逻辑测试、预制样例、真实引擎、正式客户端、真实产品模型和人工手感分别记账。不能把 mock、固定样例或退出码 0 当作整个功能验收通过，不能放宽冻结断言或改通过标准掩盖失败。
8. 依赖未齐可先开发模块、契约及测试，但最终必须完成实际接线验证才可宣称该条完成。发现环境权限拒绝，保留原始错误和明确的待执行命令交主任务，不绕过限制或反复换方式；同时继续独立工作。
9. 每个完整逻辑改动单独提交，只提交自己的范围，不推送。交付分支、提交号、改动文件、接口、验证命令及原始证据、未完成项、依赖和集成顺序。本次由主任务统一审计合并；你的树交付时保持干净，合并确认后的清理只涉及你自己的新树。

## 专责任务

你的目标：把“AI 已保存工程和构建任务”接成“系统实际调用 Godot、检查结果、形成可信候选”，这是当前关键路径。

独占 plugins/craftmine-world/godot-executor.cjs（可新增）、host-requests.cjs、main.cjs 的服务生命周期接线；Electron main/plugin-runtime.ts、plugin-host-process.mjs、可新增 godot-build-verifier.ts、preload/godot-check.ts、electron.vite.config.ts 的检查入口；desktop/build-world-plugin.mjs 的模块打包。L 独占 world-tools.cjs 的模型工具注册，你向 L 提供 enqueue/read/cancel 等接口；D 独占运行宿主，shared index.ts 交 root 接线。

接续 D:/cm-g6-root 中你拥有的私有白名单修改，只读其 spec 和 Rust 契约，由 A 交付 API。B 的 BROKER_PROTOCOL_V1.md 已有草案和真实证据；不能继续以“协议还没有”为理由重写另一套启动器。正式产品 runtime_info 目前仍存在 godotBuildAvailable:false，必须让最终状态来自实际可用服务而非改成常量 true。

必须完成：
1. 宿主发现并核验固定 Godot/broker/模板；真实预检成立后注册执行能力。动态状态反映不可用原因；重启后旧能力不能永久有效。
2. 从 A 领取真实作业，核验源码和宿主资源清单，调用 B 的固定 import/exportWeb，比较实际测量的 source files/digest、inputHash 和任务绑定，读取可信私有回包及日志。
3. 严格区分已知固定引擎原生隔离诊断与脚本/编译失败。现有受限环境会产生部分原生 ERROR；若必须分类，应按固定引擎位置与完整消息建立窄规则，任何 GDScript 回溯、未知 ERROR 或模型编译失败不得被 blanket ignore。
4. 把产物复制到核心管理目录再独立验哈希，补宿主固定 bridge，拒绝路径逃逸、重复文件、不完整产物和伪造结果；作业心跳、取消、超时、插件卸载、宿主退出与晚到回包有确定语义。
5. 对 A 的未通过产物私有 checkDescriptor 启动独立 Electron 检查实例：无焦点、非零尺寸、独立临时 session、严格消息/网络边界、初始化禁用输入抢占。检查 ready、实际画面、错误、状态快照及必要恢复，不写正式世界进度。基础启动检查与 I 的玩法必需断言分别记录。
6. 完成真实 core → B → Godot 导入导出 → Electron 检查 → core 候选的全链路，分别跑正常工程、语法错误、运行错误、伪造回包、取消及进程中断。编译通过不能替代必须执行的玩法验收。
7. 支持 A/E 第一次新建 Godot 世界时的工程构建与检查，初始快照来自 F 的正式契约，不要求先存在一个由测试人工登记的正式 Godot 世界。与 D 对齐首次加载确认和失败清理。

依赖 A/B/D 接口；可以先并行实现严格协议消费者与独立检查器，最终验收必须实际接线。给 L 提供模型工具可查询/取消的后台服务，给 D 提供真实候选，给 K 提供打包配置。

新增配套计划的接口分工：构建输入接 M/N 的 ContentRef、固定资产锁与完整正文，构建副本排除 Git 元数据和项目自带宿主配置。源码与素材锁任何变化都要重新检查；给 N 的脚本/场景预览提供隔离检查服务，不把基础预览成功当作品兼容通过。

交付判定：逐条对照以上任务，不以“测试很多”“接口已定义”或“已写完报告”代替实现。确实未完成的条目逐项保留，并给出下一步可执行入口。先交付可消费的接口和逻辑提交，最终再给完整报告。
