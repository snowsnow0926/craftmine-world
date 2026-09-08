# Harness 参考研究：Codex、Claude Code 与 DeepSeek Harness

研究日期：2026-09-09。服务于 [新的项目开发计划书](HARNESS_DEVELOPMENT_PLAN.md)。

本文区分三件事：外部项目公开说明的机制、我们实际检查过的本地实现，以及适合 craftmine world / 最中幻想的设计建议。第三类仍需开发与验收，不能当成已经具备的功能。

## 1. 研究方法与可复查范围

- Codex：阅读 OpenAI 官方 App Server、AGENTS.md 与 API Compaction 文档。原 developers.openai.com 的两份 Codex 文档在本次访问时跳转至 learn.chatgpt.com。
- Claude Code：阅读 Anthropic 官方 Agent 循环、项目记忆、缓存、Agent SDK 循环与自定义工具文档；不推测未公开的内部源码。
- DeepSeek Harness：阅读官方仓库 README、架构、压缩与提示词文档，并核对压缩实现、配置、检查点及 SDK 客户端说明。
- DeepSeek 固定研究提交：**5dda764ed3aa172535a7967b06ff95d9cbfe536a**，提交时间为 2026-09-08 15:25:45 UTC；对应发布提交说明 dsh 0.1.5-alpha.1。本文的仓库链接固定在该提交，避免以后主分支变化造成误解。
- 本地基线：Git HEAD **b7dbdad**；结合差距评估、持续开发记录，以及 Agent、记忆、项目上下文、状态和试玩代码。
- 本轮是文档研究，没有安装或运行其他 Harness，没有做三家效果、速度或费用的横向实测。一次本地 Codex CLI 帮助探测被执行环境以 EPERM 拒绝，未取得版本与协议信息；因此当前机器能否接入新接口仍列入 P0 验证，不把官网能力当成本机已接通。

## 2. 已核实的机制及适配结论

| 来源 | 已核实的公开机制 | 对本项目的设计启发 | 需要保留的边界 |
| --- | --- | --- | --- |
| Codex App Server | 提供会话、执行轮次、条目事件、恢复与压缩接口；动态工具存在实验性接口。[S01][s01] | 用事件驱动工作台，把模型接入放在独立适配器内 | 版本与协议要锁定；本次官方页面对 App Server 命令及 WebSocket 标注实验性限制，不能直接承诺生产稳定 |
| Codex AGENTS.md | 按全局和项目目录层次组织指令，并有限定的加载预算。[S02][s02] | 项目规则要有范围、来源、优先级和预算 | 本产品的规则由自己的配置与界面管理，不能依赖用户电脑上偶然存在的文件 |
| OpenAI API Compaction | 支持服务端压缩及独立压缩端点；返回的压缩项是不可读的加密状态。[S03][s03] | 适配器可保留供应商原生续接状态 | 这不是可跨模型迁移的作品记忆；不能把 Responses API 接口直接当作 Codex CLI 接口 |
| Claude Code 工作方式 | 按需用工具；接近窗口上限时清理旧工具输出并摘要；技能可按需加载，子任务可隔离上下文。[S04][s04] | 先控制进入窗口的内容，再压缩；领域说明按需读取 | 不能靠不断总结解决反复读入同一巨大文件的问题 |
| Claude Code 记忆 | 用户规则与自动记忆分工；小型 MEMORY.md 索引常驻、主题文件按需读取；用户可编辑删除。[S05][s05] | 建立可管理的项目约定与经验索引 | 文本指令本身不等于权限控制；模型经验不能改写宿主事实 |
| Claude Agent SDK | 提供循环、限制、会话恢复及压缩事件；自定义函数可通过进程内 MCP 暴露。[S06][s06]、[S07][s07] | 可作为未来完整 Agent 后端，接我们的领域工具 | SDK 自己已有循环，接入时必须明确谁负责调度和压缩；allowedTools 的自动批准含义不能误读成完整沙箱 |
| Claude Code 缓存 | 稳定前缀有利于缓存；压缩会改写对话部分，生成摘要本身也有成本。[S08][s08] | 稳定规则与变化现场分开，不每步重写大提示词 | 缓存命中、减少上下文、长期记忆是不同指标 |
| DeepSeek 架构 | Cordis 插件组合；会话事实、运行事件、工具、模型和提示词有明确接口。[S09][s09] | 借鉴接口分工和可追溯事件 | 当前项目规模不需要整体搬入其插件体系；游戏代码不能获得宿主插件权限 |
| DeepSeek 压缩 | 工具输出裁减后重新测量，再选择可压缩区域；记录压缩生命周期，边界维护工具调用与结果配对。[S10][s10] | 压缩做成有版本、可恢复的操作，原始证据另存 | 对游戏存档、模块源码、候选产物做摘要不能代替保存原件 |
| DeepSeek 提示词 | 分别组织有顺序的提示段、工具描述和动态上下文。[S11][s11] | 建立可测试的提示词编译器 | 稳定顺序是工程策略；不能承诺每个模型都有同样的缓存行为 |
| DeepSeek 长期记忆示例 | 官方提供默认关闭的第三方记忆 MCP 连接示例，存储与检索能力取决于实际服务。[S12][s12] | 把记忆定义为独立服务接口 | 不能说安装 DSH 就自动获得冲突处理、语义检索或我们的作品模块库 |
| DeepSeek SDK | 客户端启动完整 Harness 子进程，通过 stdio JSON-RPC 驱动；高层结果以收到输入至 Agent 空闲的区间收集。[S13][s13] | 学习子进程生命周期和输入回执关联 | 文档说明该版本双向请求尚未实现，不能假设它已提供任意客户端工具回调或完整审批桥 |

## 3. DeepSeek 源码中最有价值的具体例子

**压缩策略可以配置，而且按实际模型容量计算。** config.ts 在这一提交中使用默认阈值比例 0.8、尾部保留比例 0.16，同时支持指定 provider/model 的覆盖配置。这些是参考项目的当前默认值，主计划里的阈值是我们自己的待测方案。[S14][s14]

**溢出后重试需要有进展证据。** compaction-basic 在步骤之前处理压力，在请求溢出后处理恢复；当压缩或裁减确实改变了可见上下文，才允许相应的有限重试。这个模式适合避免“报错—原样重试—继续报错”。[S15][s15]

**摘要需要面向续做。** summarizer.ts 使用结构化检查点，包含目标、关键文件、错误、未完成事项和下一步；截断到输出上限的摘要会被视为失败。我们需要把这类结构改成世界、源码、验收、候选和最新进度引用。[S16][s16]

**原件与模型看到的内容分开。** 工具输出裁减组件保留完整日志，在模型上下文里呈现有上限的内容；它明确承认简单保留首尾不能保证保留中间的语义重点。游戏测试应直接提供“失败断言+关联状态”，而不是盲裁原始日志。[S17][s17]

**检查点有身份。** checkpoint.ts 为一次压缩关联 compactionId 和来源，便于跨记录识别同一操作。本项目还需要把任务检查点与实际草稿版本关联，避免“记得做过”却找不到对应产物。[S18][s18]

## 4. 我们的综合判断

建议采用 **领域宿主掌握事实与提交，Agent 后端通过适配器工作** 的架构。

借鉴 Codex 的会话与工具事件接口、Claude Code 的分层记忆和按需加载、DeepSeek 的可替换服务与压缩记录。继续使用我们已经有的世界版本、Worker、模块、素材、候选应用和进度恢复机制。

当前优先实现的能力是：按需读取与局部修改、实际试玩、可恢复任务，以及在它们之上的上下文和记忆管理。先跑通一条真实创作链，再决定是否值得接入第二套完整 Agent 后端。采用哪个后端，不改变作品数据的归属和格式。

这属于项目设计建议，没有证据表明整体替换为某一外部框架会自动提高本项目成功率。

## 5. 来源清单

下列均为本轮实际阅读的官方文档或官方仓库文件；引用编号与主计划共用。网页内容可能变化，仓库内容固定到上述提交。

- [S01 · Codex App Server][s01]
- [S02 · Codex AGENTS.md][s02]
- [S03 · OpenAI Compaction][s03]
- [S04 · How Claude Code works][s04]
- [S05 · How Claude remembers your project][s05]
- [S06 · Claude Agent SDK agent loop][s06]
- [S07 · Claude Agent SDK custom tools][s07]
- [S08 · Claude Code prompt caching][s08]
- [S09 · DeepSeek Harness architecture][s09]
- [S10 · DeepSeek compaction subsystem][s10]
- [S11 · DeepSeek system prompt assembly][s11]
- [S12 · DeepSeek third-party memory examples][s12]
- [S13 · DeepSeek TypeScript SDK client][s13]
- [S14 · DeepSeek compaction configuration source][s14]
- [S15 · DeepSeek automatic compaction source][s15]
- [S16 · DeepSeek summarizer source][s16]
- [S17 · DeepSeek tool result pruner][s17]
- [S18 · DeepSeek checkpoint source][s18]
- [S19 · DeepSeek README：developer preview 声明][s19]

[s01]: https://learn.chatgpt.com/docs/app-server
[s02]: https://learn.chatgpt.com/docs/agent-configuration/agents-md
[s03]: https://developers.openai.com/api/docs/guides/compaction
[s04]: https://code.claude.com/docs/en/how-claude-code-works
[s05]: https://code.claude.com/docs/en/memory
[s06]: https://code.claude.com/docs/en/agent-sdk/agent-loop
[s07]: https://code.claude.com/docs/en/agent-sdk/custom-tools
[s08]: https://code.claude.com/docs/en/prompt-caching
[s09]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/architecture.md
[s10]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/compaction.md
[s11]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/system-prompt.md
[s12]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/user/guide/mcp-memory.md
[s13]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/sdk/client/README.md
[s14]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/compaction/compaction-basic/src/config.ts
[s15]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/compaction/compaction-basic/src/index.ts
[s16]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/compaction/compaction-basic/src/summarizer.ts
[s17]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/compaction/compaction-tool-result-pruner/README.md
[s18]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/compaction/compaction/src/checkpoint.ts
[s19]: https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/README.md
