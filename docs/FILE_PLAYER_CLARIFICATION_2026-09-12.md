# 按真实问题选择答案的文件通道

日期：2026-09-12。基线：`b9fbd8f1`。分支：`codex/file-clarification-20260912`。

新增明确启用的 `file-response` 模式。它不选择推荐项或首项，而是先保存真实问题，等待测试 agent 根据原玩家目标选择实际提供的选项。原 `off` 默认和历史 `recommended-or-first` helper 行为保持兼容；本轮没有启动任何自动选择或模型试验。

按用户最新要求，**本文件通道不增加 token、请求次数或十分钟时限**。等待以明确取消的 `AbortSignal` 结束。每条报文的字段、长度、选项索引仍遵守已有正规 AskTool 合同，这些是输入校验，不是对话试验额度。

## Driver 接入接口

模块：`tests/helpers/promo-file-clarification.mjs`。本提交没有修改 `promo-wish-native.mjs` 或其他 driver。

```js
const exchange = createFileClarificationExchange({
  directory: absoluteFreshDirectory,
  signal: stopController.signal,
});
const ticket = exchange.publish(actualAsk, sessionId);
// 此时完整问题已持久化；向测试 agent 显示 ticket.requestFile。
const selected = await exchange.waitForResponse(ticket);
stopController.signal.throwIfAborted();
// 调用原正规答复 API；该接口再次检查当前 requestId 与选项。
await normalAskResolve({
  sessionId: selected.ask.sessionId,
  requestId: selected.ask.requestId,
  choices: selected.choices,
});
```

目录必须是父目录已存在的全新绝对目录，不能复用旧应答目录。`ticket` 返回 `requestFile`、`responseFile`、`receiptFile`、`sessionId`、`requestId`。文件名由会话和请求 ID 哈希生成，不接受问题文字作为路径。

`selected` 保持现有选择 helper 的形状：`ask`、`choices`、`answers`、`selectionReasons`，另含 `responseReceipt`。原问题和选项完整保留，答案来自原选项文本。文件消费回执状态为 `consumed-not-submitted`，**不能冒充模型已经收到答案**；driver 应在正规 API 确认后才增加 `playerClarification` 答复计数。等待中取消则保留 `cancelled-not-submitted` 回执。

## 测试 agent 应答

先读取 `ticket.requestFile`，结合原宣传目标选择真实提供的玩法或范围。不要通过默认第一项把怪物变为装饰，或把整座城市缩为入口；也不写代码、接口提示或未来愿望。

```js
writeFileClarificationResponse(absoluteFreshDirectory, {
  sessionId: actualSessionId,
  requestId: actualRequestId,
  choices: [[2], [1]], // 从 0 开始：每个数组对应一道真实问题。
});
```

应答文件严格只有 `sessionId`、`requestId`、`choices`。`null` 仅保留原合同的跳过语义；不是自由文本入口。提供的 writer 先写完临时文件，再通过同目录硬链接原子发布，不覆盖已有应答。不要用分段写入的 JSON 代替该 writer。

模块不调用模型、不恢复任务、不修改预算、不访问凭据或产品源码。读取有字节上限，并拒绝目录链接、文件链接、旧票据、跨会话、错请求、越界／自由文本、被修改的问题及重复消费；取消后不提交迟到答案。产品侧问题已取消或被替换的最终判定仍由正规答复 API 完成。

## 验证

`node --test tests/promo-file-clarification.test.mjs tests/promo-player-clarification.test.mjs`：10 项通过，涵盖完整问题先落盘、原子答复、一次消费、非法输入、问题修改、明确取消、文件限界与无额外对话次数限制。

没有构建产品、启动模型、修改既有问答或历史试验。后续普通玩家输入 driver 由总控另一条工作线接入。
