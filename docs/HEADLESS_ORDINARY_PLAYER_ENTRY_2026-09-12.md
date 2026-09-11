# 普通玩家后台入口（2026-09-12）

新增 `playerSetup`、`playerPrompt`、`playerStatus`、`playerAbort` 四个测试控制方法，只安装于已验证隔离 profile 与父 IPC 的既有 headless 入口。没有普通桌面任意脚本接口；真实键鼠、焦点与 Pointer Lock 仍被原保护层禁止。

- `playerSetup` 接收原测试 `sessionId/worldId`、实际玩家非敏感配置快照和本地密钥，通过正常 UI 的 `providersCreate` 与 `sessionConfigure(id, config)` 为隔离 profile 配置选中模型。保留原会话消息，完整传递实际模型绑定（含图像/文档能力）及快照权限模式，不覆盖用户数据库，不用 provider 默认模型代替实际选中模型。密钥只给明确的 DeepSeek 官方终点。
- `playerPrompt` 接收实际玩家文本与消息 ID，调用正常 `godot.creationTarget` 后走普通 `agentPrompt`，同一进程不重复提交同消息 ID；不扩模型工具权限、不绕过源码、任务或采用边界。
- `playerStatus` 返回普通会话、active（含收尾事务）、绑定本次消息的 task metrics、真实观察、创作应用状态和最新检查任务。`playerAbort` 走原 UI 的取消接口。
- 显式拒绝与 `CRAFTMINE_CREATION_EVAL=1` 混用；不创建或更新评测账本，不添加 token、调用次数、整轮时限或输出上限。模型 contextWindow、maxTokens、thinkingLevels 和选中思考级别照实际配置快照传递。产品已有通用任务边界保持原样。

4 项离线测试通过：真实配置传递、历史与权限保留、正常提交/状态/取消链、错误终点及身份变更拒绝。未调用模型。后续薄驱动只需复用原测试世界和会话，通过这些方法输入原玩家目标；真实成品验收由总控构建后进行。

## 薄驱动

`node tests/promo-real-player.mjs <旧报告绝对路径> <真实配置快照绝对路径> <玩家文本文件绝对路径> --packaged-root <新成品目录> [--live]`

默认只准备并显示实际型号、思考级别、窗口、输出配置及原样输入；`--live` 才启动成品并读取 `CRAFTMINE_LIVE_CONFIG` 的本地密钥。没有 `CRAFTMINE_CREATION_EVAL`，不读取或写入旧评测账本，不添加整轮时长或模型次数上限。每次调用只发一次文本文件中的正常玩家输入，消息使用 UUID，使用普通任务 metrics。进程信号可正常取消；120 秒 RPC 超时仅用于失去回应的控制调用，不是整轮任务时限。

实际澄清写入独立 `player-questions-UUID` 目录，等待测试 agent 依据原玩家目标提交 file-response；不选默认或首项、不自动回复。真实权限仍由产品的普通权限流程决定，没有改成 auto。

普通权限请求通过 `headlessPermissionPending` 读当前队首，写入独立 `player-permissions-UUID/*.request.json`，包含真实工具名称、风险、参数预览、原因及 `responseFile` 路径。测试 agent 审阅后向对应 responseFile 原子写入 `{ "sessionId": "原值", "requestId": "原值", "decision": "allow-once" }` 或 `deny`，driver 再调用 `headlessPermissionResolve` 并校验完整回执。没有自动全批、allow-session 或权限升级。等待期间产品若撤销/过期/改变队首会立即保留错误，不能对新请求套用旧批准。产品入口由独立权限桥提交提供，薄驱动 live 会先确认成品包含该桥。

报告格式为 `craftmine.promo-player/1`，位置为原 profile 父目录 `player-UUID.json`，包含 worldId、sessionId、packageIdentity、submittedAt、完整 before/latest（含 active/job/metrics/observation）、endedAt、exitReport、stateIntegrityVerified；不伪造 budget 字段。采用前仍须核对本次提交后的新检查与世界身份。原报告、marker、输入文件、配置快照和成品未被改写且退出审计干净，才将 stateIntegrityVerified 标为 true。

FLIGHT 旧报告的 prepare-only 已验证能解析原会话与世界，显示保存的 `deepseek-v4.1-flash-expires-on-0910`、`max`、1,000,000 上下文和 384,000 输出配置，输入为“继续完成刚才的歼20，我要能实际驾驶它飞起来。”。仅用了旧固定目录作参数解析演示，未启动旧包或模型；live 必须使用含新入口的成品。入口及文件问答现有检查共 11 项通过，薄驱动语法检查通过。
