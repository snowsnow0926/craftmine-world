# 复制世界后继续创造：会话交接修复

## 问题与边界

CA07 原始失败记录保留在 `desktop-native-complete-K7eooB/CA07-continuation-partial.json`：实际世界和目标捕获已是副本，聊天仍使用原会话，`workspace.open` 按持久绑定返回原世界，宿主因此以 `CREATION_TARGET_STALE` 拒绝。拒绝发生在发送模型前，累计预算仍为 31 次。这不是模型创作失败，也不是源码描述符改变造成的失效。

## 产品行为与决策

复制按钮在宿主确认副本独立构建、检查和采用后，为副本创建并选中真正的新空会话，右侧工作台也切到该会话。原会话的历史与固定世界绑定保留。新会话遵循现有“新任务”的项目、默认模型和思考强度规则，不能复用已绑定原世界的空会话。自动采用仍由副本独立授权。

不改变 core 的 `workspace.open` 语义，也不放宽跨世界、构建、实例或目标有效性检查。创建会话前后均核对实际选中的世界；期间切换世界必须报错，不能显示副本已打开。创建会话失败后的重试继续使用原复制操作 ID，避免把副本再次复制。

评测专用 `copy-world` 方法调用真实按钮的 React 回调，不使用鼠标、键盘、焦点或 Pointer Lock。它等到实际导航 DOM 选中新会话后返回新 `sessionId/worldId` 并更新评测闭包；沿用评测明确选择的模型配置和会话标题，允许 `EVAL_SESSION` 重开。同一 profile 的请求预算保持累计，方法本身不发送模型。外层 runner 必须采用返回的会话 ID。

## 验收方法

- `node tests/creation-copy-session-ui-headless.mjs`：真实导航组件、复制按钮与 store，fixture 宿主传输；验证新会话选中、默认配置、保留原会话、失败重试幂等，以及创建期间切世界的反例。独立 headless 浏览器，无真实输入。
- 设置 `CRAFTMINE_CREATION_COPY_SESSION=1` 运行 `tests/creation-managed-executor.mjs`：固定作者，真实 core、LPAC 导出、Web 检查及候选采用。复制前后的会话绑定分别检查；副本捕获目标后经生产造物事务添加树和机关，检查并采用，重启 core 后核对完整进度，原世界保持原构建和进度。该测试不代表新的模型测试，也不替换 CA07 原失败报告。

测试日志与 profile 仅存独立 `test-results`，不提交数据库、凭据、模型源码或原始失败 profile。
