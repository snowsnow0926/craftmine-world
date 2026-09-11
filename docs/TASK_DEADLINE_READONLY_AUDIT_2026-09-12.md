# 普通玩家任务截止时间只读核查

2026-09-12。范围仅为核查，不修改产品策略、不调用模型。

结论：累计 token 不限不等于整任务无限。`plugins/craftmine-world/host-requests.cjs:56` 在首次真实请求前固定 30 分钟绝对截止，既有 `tests/dispatch/batch07/budget-host.test.mjs` 明确验证重试沿用截止。普通玩家驱动没有额外添加该时间限制。

`workbench-ui.mjs:208` 明确说明解除累计 token 上限仍保留请求次数、压缩次数、截止时间和模型单次限制。`durable.rs` 的玩家预算配置只更新 `maxTokens`。因此 `maxTokens:null` 生效不能解释为取消所有保护。

停止、退出和恢复不暂停时钟：`recovery.rs::task_resume` 及 `workspaces.rs` 保留同一个预算 owner，只增加 generation；下一次 `budget.reserve` 在 `durable.rs` 检查截止并返回 `TASK_DEADLINE_EXCEEDED`。此处并非到点直接掐断已发出的请求。

真实只读证据：`desktop-native-complete-gZUpyt/player-3fc3f124-1ef4-41d5-b9a7-56a8a00f37ac.json` 的旧任务为 `maxTokens:null`、`maxRequests:80`，截止北京时间 03:01:50；新操作时间 03:49:11。正常入口结束旧任务的回执为 `preservedDraft:true`。

本轮保持 30 分钟产品策略，处理范围仅为已实际打断持续输出的 120 秒问题和 prop 输入缺陷。后续如改进过期恢复，应先显示准确原因及已有保留草稿入口；如需产品时间预算配置，另行定义可见、可审计的语义，不能由测试驱动暗自延长或重置账本。
