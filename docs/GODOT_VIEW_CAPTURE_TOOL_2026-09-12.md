# 正常世界视觉工具通路

本轮增加正常 `godot_view_capture` 的服务桥和插件结果编码，不启动模型或玩家档案。公开工具注册由总控集成；只读宿主截图由独立实现提供，本提交不修改 `godot-world-view-host.ts`。

## 输入与权限

公开参数只允许 `buildId`、`instanceId` 和可选 `candidateId`；`worldId` 来自该工具调用的正式 `workspace.open` 绑定。正式截图必填 `instanceId`；候选截图可用 `candidateId + buildId` 省略实例 ID，由主机从当前真实 `candidateInstance` 解析并在前后核对，返回实际实例 ID。模型不需要猜测无法通过现有候选读取接口获得的实例 ID。插件内部调用 `captureGodotView({context, worldId, args, services, assertActive})`，使用 `services.captureView`。

宿主 RPC 为 `craftmine.godotViewCapture`，通过已有 plugin-host-process IPC 传 `{context:{projectId,sessionId,turnId},worldId,buildId,instanceId,candidateId?}`。只有 `craftmine.world` 正在执行的同会话 `godot_view_capture` 调用可以访问；未知字段、其他会话、其他工具或无正在执行的工具均被拒绝。主服务在截图前后核对活跃 turn、项目身份、绑定世界、当前显示会话和维护忙碌状态。宿主截图再校验具体正式或候选实例。

候选 ID 由正常 coordinator 的 `prepare` 传入 `stageCandidate`；不能只相信截图请求自报的 ID。截图不授予预览、采用、输入、任意页面或文件访问能力。

## 模型与图片交付

主服务只缓存正常 `resolveAgentRuntimeLaunch` 已解析的非敏感模型信息：provider ID、model ID 和有效图片输入能力。它不重新读取密钥、不发送能力探测、不切模型。无图片声明时先返回 `unavailable / not-delivered`，不调用截图。模型在截图期间变化时丢弃结果并明确说明没有交付。

插件验证宿主返回的世界、build、instance、候选、PNG 头部尺寸、实际 SHA256、原始/输出尺寸和缩放声明，返回 `{text, images:[{data,mimeType:"image/png"}]}`。`text` 保留身份、时间、哈希、尺寸与证据边界；不包含 base64。`image-block-ready` 表示图片已交给正常运行层，不能称为 provider 已接收或理解。

运行层仅对完整工具名 `plugin_craftmine_world_godot_view_capture` 增加前后能力检查；无图模型、空图或异常图片块返回 `not-delivered` 并通过现有 afterToolCall 错误通路标记失败，不能静默丢图后算作工具成功。其他工具和历史处理不重构。实际 pi-ai Chat Completions 适配器将工具图片变为后续 `user` 的 `image_url` data URI；无图模型重放旧工具历史时不编码旧图片。

## 单图边界与证据层次

宿主保留实际窗口和游戏视图大小，只可对已经捕获的 NativeImage 等比缩小。源图最多 16 Mi 像素、单边 8192；输出最大 1920×1080、PNG 最大 4 MiB。结果分别记录 `viewWidth/viewHeight`、`sourceWidth/sourceHeight`、`width/height` 和 `resized`，不把缩小输出说成原始屏幕分辨率。输出 SHA256 对应实际附图字节。没有同一 physics tick 的观察承诺，也不因为有截图就证明行为正确。

插件 Node IPC、host-core `plugins.resolveExecution` 和 sidecar 正常管道未发现对本结果的默认文本裁断；64 KiB bus 限制不属于这条通路。历史多图仍可能碰到 provider HTTP body 或已有上下文限制；本轮不增加累计预算、不修改现有估算、不偷偷丢历史图片或用总结替代本次图像。

实际玩家绑定 `deepseek-v4.1-flash-expires-on-0910` 声明 `supportsImages:true`，仅说明产品配置。官方标准视觉模型文档明确介绍 `deepseek-v4-flash-vision-exp`，没有找到该 expires 别名的明确视觉合同，不能以标准命名推断未知路由必然不支持，也不能宣称已经验证服务端支持。参见 [DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)。本轮未修改实际玩家设置、未探测 endpoint、未调用模型。

现有运行层 `details.imageCount`、工具 SHA 和离线实际适配编码测试能证明“附图和编码链”。实际 provider 是否接受、是否能正确识别画面须另记真实试验。未来可在现有 onPayload 边界添加仅含 requestId、图片数量/哈希及 bodyBytes 的安全发送前遥测，本轮不修改预算核心。

## 验证

`tests/godot-view-capture-tools.test.mjs` 覆盖正常身份、跨会话/额外参数/候选混淆拒绝、能力关闭时零截图、途中结束或实例变化丢弃、PNG哈希/尺寸/缩放契约以及异常信息脱敏。其中 PNG 头部为明确的协议夹具，不能作为真实引擎截图证据；原生解码/捕获由宿主测试独立覆盖。

运行层行为测试实际执行工具：无图模型在 host 前拒绝，切换能力后不交付，空图/坏块不算成功；正常图片经实际 `convertMessages` 产生 `user.image_url`，同份旧工具历史经无图模型编码后不含图片。没有真实模型请求。

与宿主提交 `c77a23fa` 联合后，27 项宿主/服务/插件契约测试和全部 138 项 runtime 测试通过，工作区依赖 TypeScript 构建与完整 desktop TypeScript 检查通过。候选测试覆盖省略实例后的真实解析，以及错误世界/build/candidate、预览替换的拒绝。尚未把此结果当作已冻结成品的真实截图或模型视觉验收。
