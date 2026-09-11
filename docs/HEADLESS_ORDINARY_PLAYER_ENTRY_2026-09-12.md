# 普通玩家后台入口（2026-09-12）

新增 `playerSetup`、`playerPrompt`、`playerStatus`、`playerAbort` 四个测试控制方法，只安装于已验证隔离 profile 与父 IPC 的既有 headless 入口。没有普通桌面任意脚本接口；真实键鼠、焦点与 Pointer Lock 仍被原保护层禁止。

- `playerSetup` 接收原测试 `sessionId/worldId`、实际玩家非敏感配置快照和本地密钥，通过正常 UI 的 `providersCreate` 与 `sessionConfigure(id, config)` 为隔离 profile 配置选中模型。保留原会话消息，完整传递实际模型绑定（含图像/文档能力）及快照权限模式，不覆盖用户数据库，不用 provider 默认模型代替实际选中模型。密钥只给明确的 DeepSeek 官方终点。
- `playerPrompt` 接收实际玩家文本与消息 ID，调用正常 `godot.creationTarget` 后走普通 `agentPrompt`，同一进程不重复提交同消息 ID；不扩模型工具权限、不绕过源码、任务或采用边界。
- `playerStatus` 返回普通会话、active（含收尾事务）、绑定本次消息的 task metrics、真实观察、创作应用状态和最新检查任务。`playerAbort` 走原 UI 的取消接口。
- 显式拒绝与 `CRAFTMINE_CREATION_EVAL=1` 混用；不创建或更新评测账本，不添加 token、调用次数、整轮时限或输出上限。模型 contextWindow、maxTokens、thinkingLevels 和选中思考级别照实际配置快照传递。产品已有通用任务边界保持原样。

4 项离线测试通过：真实配置传递、历史与权限保留、正常提交/状态/取消链、错误终点及身份变更拒绝。未调用模型。后续薄驱动只需复用原测试世界和会话，通过这些方法输入原玩家目标；真实成品验收由总控构建后进行。
