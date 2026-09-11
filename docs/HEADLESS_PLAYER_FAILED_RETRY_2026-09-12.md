# 普通玩家失败输入的有限重试入口

真实 qQcut9 视觉纠正被 `DRAFT_BASE_CONFLICT` 阻断时，原句已经入会话，模型请求为 0。直接再次调用普通 `playerPrompt` 会新增重复愿望，因此本批接入产品已有的“重试最后输入”语义；Rust 草稿基线修复由另一分支负责。

## 合同与实现

隔离 parent IPC 增加 `playerRetryFailedPrompt`，仅限既有 headless 普通玩家控制器，仍拒绝评测环境。它接受当前绑定的 session/world、新 messageId、failedMessageId 及原文；没有新增公开工具或任意历史裁剪入口。

宿主要求：最后一条消息必须正好是指定 user、正文完全一致、状态 complete、无附件；新旧 ID 不同。该 user 对应的真实 turn metrics 必须为 error、已结束、没有 pending 请求，且当前没有运行模型。获取新的 creationTarget 后，再核对同一世界、同一失败 turn 和会话末条，拒绝并发变更。

通过后只调用现有普通 `agentPrompt`，传 `truncateFromMessageId: failedMessageId` 以及新 capture。主进程沿原 `retryLastPrompt` 路径，先 `session.saveRevision` 归档失败分支，再 `session.replaceMessages` 去掉活动历史中的旧尾部，随后保存重试用户消息。新桥不直接调用归档、截断或数据库写接口；归档失败沿现有代码中止，原历史不被截断。

## 测试驱动

`tests/promo-real-player.mjs` 增加显式 `--retry-failed-message <id>`，输入报告必须是同一失败普通玩家报告、干净退出并已验证完整性，原文与失败 user ID 精确一致。它复用原 session，不允许 `--create-session`，也不把 interrupted 工作区恢复混入这条路径。新成品必须包含重试守卫，旧成品不能进入该 live 模式。

本次实际 prepare-only 已确认：

- 报告：`D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/player-a5c5afd2-98cb-4059-9e36-5dbbf606b66f.json`
- 失败 user：`363fe039-410b-43aa-978c-5ef7154362ba`
- 原 session：`3a43c719-8616-4393-a1fb-c8f3b283a785`
- 原句：“看看现在的城门效果，把挡住墙和塔的树挪开，门洞和花草保留。”

没有调用模型或启动成品，等待统一冻结 preview.14 后才恢复真实失败输入。原失败报告未修改。

## 验证

11 项 Node 测试通过，另有现有 transcript-truncation 的 5 项测试通过。新增测试覆盖错误 ID、非末条、原文变化、非失败、跨会话、有 pending、模型活动、附件及 capture 期间上下文变化。两项回归直接执行现有主进程 TypeScript 归档/截断代码段：确认先保存失败分支再替换活动历史，以及归档失败零截断，不以测试中的重复算法冒充产品行为。

`craftmine-headless-player.ts` 单文件 TypeScript noEmit 与完整 headless 入口 ESM 打包检查通过。没有扩大模型预算或改变正常首次 prompt 行为。

```powershell
node --test tests/headless-player.test.mjs tests/promo-player-retry.test.mjs tests/player-retry-revision-archive.test.mjs
node vendor/pi-desktop/packages/shared/node_modules/vitest/vitest.mjs run vendor/pi-desktop/packages/shared/src/transcript-truncation.test.ts
node vendor/pi-desktop/apps/desktop/node_modules/typescript/bin/tsc --noEmit --target es2022 --module nodenext --skipLibCheck vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-player.ts
```
