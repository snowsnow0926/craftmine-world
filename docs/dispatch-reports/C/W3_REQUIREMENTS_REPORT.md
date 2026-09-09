# C 追加任务：长任务保留原始要求

日期：2026-09-09。结论：ready_for_integration。G 明确授权修复 W3 原始目标被多次纠正挤出上下文的问题。

代码提交：747e6552f18f7c05c9840bb8ad55b5817584a5b8。之前从 G 已提交 651f6ed408106e0ef71c9d15a78436a5f6e41a9f 合入 C，merge 提交为648d119abd61e59ee80c36e6c7a2fe5c448f4c55。这项追加交付独立于已冻结的桌面 UI 报告。

现在压缩上下文始终保留第一次用户目标，另带最近三次纠正，每条仍有原始ID和truncated标记。需要详细内容时可按页读取原文，包括被缩短的末尾。单页最多4000个Unicode字符和32段，中文与emoji不会被拆坏。原文、预算和数据库结构均保留；新记录时间在单任务内单调，保证快速纠正与恢复后排序一致。

真实 Rust 全部35项单元/SQLite测试通过，新增3项覆盖：超过四次纠正仍保留原目标；长需求末尾完整读回；45条原文的字符与分段上限；错误参数/额外字段/伪造会话被拒绝；显式恢复保留目标与末尾，普通新任务不混入旧要求。旧预算/压缩/恢复测试保持通过。

完整命令：在 D:/Craftmine World-worktrees/parallel-c-20260909 执行 `cargo test -p craftmine-core --lib --manifest-path vendor/pi-desktop/Cargo.toml --target-dir D:/Craftmine\ World-worktrees/parallel-c-20260909/test-results/dispatch-c-rust-target`，路径含空格时应作为一个带引号参数传入。最终构建约0.99秒，测试0.59秒。原始成绩在 docs/evidence/dispatch/C/w3-requirements-rust.log，最终代码提交后运行。

开发失败已如实保留：首轮实现把SQLite整数读取为rusqlite不支持的u64，改为有检查的i64转换；一条测试夹具原文超过现有16000字节上限，修正为仍长于4000字符但在既有字节上限内的合法输入。首次编译目标相对路径多退一层，创建了独立的 dispatch-c-rust-target，未运行测试；最终全部编译/测试统一使用本工作树内明确绝对路径。没有修改共享target或用户数据。

仅改 durable.rs、durable_tests.rs，加英文vendor规格和本组接口文档。Rust router、工具注册、B 提示词属于 G，接线步骤见 W3_REQUIREMENTS_INTERFACE.md。未调用真实模型，尚未声称已从原生Agent实际调用新增工具，也没有改变预算或重放模型请求。

本工作树保留分支，未推送、未清理、未合并用户主项目。报告/证据提交紧随代码，仅含文档。下一步由G注册 task.readRequirements / requirements_read，并让B在truncated时按需读原文后运行原生续作验收。
