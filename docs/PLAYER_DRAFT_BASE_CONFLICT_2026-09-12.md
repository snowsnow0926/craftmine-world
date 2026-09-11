# preview.13 真实视觉纠正：模型调用前的草稿基线冲突

在已保存的门前视角、原会话 `3a43c719-8616-4393-a1fb-c8f3b283a785` 中，使用最终冻结 `12f31f17f815 / 0.14.4-preview.13` 提交唯一一次自然输入：

> 看看现在的城门效果，把挡住墙和塔的树挪开，门洞和花草保留。

**本轮在模型调用前失败，错误 `DRAFT_BASE_CONFLICT`。** 用户消息已经进入历史，ID 为 `363fe039-410b-43aa-978c-5ef7154362ba`；新增记录只有这一条 user，无 assistant、tool 或图像。主机本轮指标 observed/reported/pending 请求数均为 0、`models:[]`、状态 error、耗时 11 毫秒，usage 为 null。没有产生实际 imageCount 字段，也没有供应商图像响应，不能把它归为供应商拒图或模型视觉失败。

产品正常退出 code 0，隔离/页面/关闭审计均为空，原报告及 marker 完整性通过。没有重复提交原句、换模型、去掉图片重试，也没有改档案或草稿。

## 已确认的持久状态

只读查看真实 `tasks.sqlite`：该会话仍只有旧任务 `work-498d645f9d721db1cf37e429308b45a7f04de63c2f246aa766152fbc6dcd94e3`，状态 finished、draft revision 0、generation 1、recovery none；世界 lease 为空。失败的这次 turn 没有成功创建新的核心工作区任务。

旧任务绑定原森林 build `gbd-266a02b8…`，草稿只包含原 Godot scene 描述，projectHash `1e770fa0…`，draftHash `76c2d7ba…`。当前正式作品已经是已采用城门 `gbd-a96e9793…`，源码 revision 4 / manifestHash `8199b2c4…`，玩家进度 revision 9。

核心 `vendor/pi-desktop/crates/craftmine-core/src/workspaces.rs` 的 `workspace_open_recovery` 仅在旧任务拥有已采用回执，或旧 baseBuild 仍等于当前正式 build 时继续；本例两项均不满足，在第 343 行拒绝。正常完成任务仍可能有未采用编辑，因此不能直接删除这个保护。精确只读状态已交负责通用修复的 agent，本分支没有改产品逻辑。

## 正常恢复入口

当前 `task.recoverable` 返回空列表，旧任务也不是 interrupted，因此不能假装通过 `task.resume` 恢复新输入。

现有正常 UI 入口为 `ChatSurface.tsx` 的“重试”→`app-store.ts:2456` 的 `retryLastPrompt`。它取最后一条 user 的原文，调用普通 `api.prompt` 并传 `truncateFromMessageId`。主进程 `index.ts:8524` 起先通过 `session.saveRevision` 归档被替代分支，再截断重发；这保留失败历史，同时不向主会话追加第二条相同愿望。

现有有限 headless `playerPrompt` 不支持这项重试字段。修复草稿基线后应接入同一正规重试语义，精确绑定上述失败 user ID，并重新捕获当前世界上下文；不直接改数据库，不把旧失败报告改成成功。**本轮未执行重试。**

完整冻结包身份、原始报告绝对路径与哈希、零请求指标、用户消息、旧任务和新正式作品状态见 [阻断证据](evidence/PLAYER_DRAFT_BASE_CONFLICT_2026-09-12.json)。
