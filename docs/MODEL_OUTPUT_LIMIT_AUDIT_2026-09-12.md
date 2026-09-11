# 模型空输出与真实玩家配置审计

## 已确认的试验事实

FLIGHT01 澄清复验（冻结成品 964d96d0）实际注册 `deepseek-flash`，contextWindow=1,000,000、maxTokens=16,384、thinkingLevels=off/low/high，会话为 high。来源是隔离 profile 的 providers.config_json.models 与 creation-evaluation-sessions.json；models 表为空。16,384 来自 `craftmine-creation-evaluation.ts` initialize 的硬编码，不是供应商最大输出，也不是产品通用默认值（通用回退为 8,192）。

实际第 7、8 次调用均记录 outputTokens=reasoningTokens=16,384，正文和工具调用均为空。第 7 次耗时 71,750 毫秒，第 8 次 74,802 毫秒。日志先出现 outcome=silent，随后出现 EMPTY_MODEL_RESPONSE。原因是产品第一次遇到空响应会删去末尾空 assistant、追加 silent-turn nudge，然后以同样的配置继续一次；第二次空响应才停止。两次都计入请求账本，合计约 146.6 秒。

已修正 FLIGHT01 记录：「测试驱动没有追加重试」不等于「产品内部没有自动重试」。旧报告没有持久化 provider finish_reason，因此不能给历史记录补造 length 值；后续判断必须使用运行时收到的明确 stopReason。

## 请求参数链

正常会话和评测均经 modelConfigWithBinding，将实际绑定 maxTokens 放到 model.maxTokens。Craftmine guard 使用 `min(options.maxTokens ?? model.maxTokens, model.maxTokens)` 并保持真实用量／请求记账。冻结 sidecar 的 DeepSeek URL 兼容分支选择 max_tokens，不使用 max_completion_tokens；high 对应开启 thinking，并发送 reasoning_effort。

该 DeepSeek 路径没有启用单独的 thinking_token_budget 字段。pi-ai 虽有高思考默认预算和预留回答空间的通用计算，但其结果不能当作已经发送给 DeepSeek 的独立思考额度。思考与可见输出共享单次输出空间。

请求 model 保留所选 ID；本地没有把 deepseek-flash 改写成 v4-flash。底层库可接收 responseModel，但本产品当前持久化的 metrics.modelIdentity 是 runtime-binding，无法据此确认服务端别名最终解析成哪个版本。

## 用户真实桌面设置

只读 `C:/Users/WINDOWS/AppData/Local/CraftmineWorld/pi.sqlite` 的正规配置：

- 最近会话「世界项目信息查询」更新时间为北京时间 2026-09-11 21:04:36.828，实际选择 `deepseek-v4.1-flash-expires-on-0910`，思考强度 max；之前的「飞行控制添加」也是这个模型与强度。
- provider.config_json 中该模型的 contextWindow=1,000,000、maxTokens=384,000，思考选项包含 medium/high/max/off。
- provider 与 kv.app 的默认模型是 deepseek-v4-pro，但不能用默认值覆盖实际会话已选择的 v4.1-flash/max。模型名称带 expires 也不是擅自替换的理由；可用性需由实际请求另行确认。
- 正常启动路径优先使用 session 的模型和思考选择，再读取对应 provider binding。384,000 没有被评测的 16,384 二次压低；实际请求还受真实上下文剩余空间约束。

领域账本中最新两项真实任务的 maxTokens=null，说明累计 token 不限。但现有实现仍有遗留边界：maxRequests=80、maxCompactions=8、首请求后约 30 分钟 deadline；guardedStream 还有每次 120 秒超时。它们与评测另加的 40 请求／10 分钟不同，不能声称当前所有维度都无限。已将准确设置和来源同步总控与普通会话入口负责人；没有改用户配置。

用户要求贴近真实玩家路径，当前不再推进输出额度对照，也不增加新的限制。此前用不同模型 ID、high、16,384 单次容量和评测停止条件的结果，不能直接等同于用户正常会话效果。

本轮只恢复真实玩家传参和移除评测额外配置，不修改已有 80 请求、30 分钟或 120 秒通用保护。给普通入口负责人的机器可读非敏感快照位于 `D:/cm-reasoning-length-stop-0912/test-results/player-config-snapshot.json`，明确区分最近会话选择与 provider 默认，凭据不在快照内。

## 保留的最小错误修复

只在无正文、无工具调用、无既有错误／中止且 stopReason 明确为 length 时，报告 MODEL_OUTPUT_LIMIT_REACHED：「模型达到单次输出上限，尚未形成结果。可以在当前任务中继续。」不再自动消耗一次相同上限的 silent-turn nudge。

没有长度证据的空响应仍保留原一次恢复逻辑；已有正文或工具调用的长度截断保持原行为。使用量和已发生请求正常记录。没有修改模型 ID、思考强度、单次容量、总请求限制或任何旧账本，也没有付费复测。定向行为测试验证这些边界，未模拟真实模型成功。

已完成代码仅保留为独立提交供后续审查，没有继续扩大修复：运行时与 provider retry 回归共 158 项通过，agent-runtime 与 i18n TypeScript 检查通过。优先事项仍是忠实普通玩家入口。
