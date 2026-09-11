# 隔离测试中的有限玩家澄清

日期：2026-09-12。基线：`dd6fdee4`。分支：`codex/headless-ask-20260912`。

怪物、飞机、城市测试出现模型停在 AskTool 等待玩家的情况。正常产品已有 `pendingAsks` 与 `resolveAsk → api.resolveAskTool → asktool.resolve`；缺口是隔离测试控制器不能读取和回答这些问题。

## 本轮实现

- 新增父 IPC 方法 `headlessAskPending`、`headlessAskResolve`。Main 必须仍拥有经过验证的隔离 profile 和已连接父进程，目标窗口必须 offscreen、不可见且不可聚焦。
- Renderer 只在 headless guard 已存在时安装有限桥。读取指定 session 的队首问题，只投影 requestId、sessionId、toolCallId、完整问题、选项和多选标志，不返回任意 store、模型配置或凭证。
- 答复仅允许**此前读取过且当前仍相同**的 requestId，以有限选项索引或 null 跳过映射到原文，然后调用现有正规 resolveAsk API。拒绝任意文本、脚本、方法名、额外字段、越界索引、单选多答、问题被替换、跨 session 和并发重答。成功后的同值重试返回原回执，不重复提交。
- 最多八题，每题最多十二选项；字符串及总记录大小有限。超限拒绝，不截断后冒充完整问题。

## Driver 显式选择

默认行为不变：`CRAFTMINE_PROMO_CLARIFICATION_MODE` 未设置或为 `off` 时不读取、不自动回答。

明确设置为 `recommended-or-first` 才启用模拟玩家：选择带“推荐”／“Recommended”标记的第一项，否则选择原列表第一项；多选题也只选一个默认项，不扩充未来愿望。不提供自由文本答案；没有选项时记录 `CLARIFICATION_DRIVER_BLOCKED`，正常终止并保留正式世界截图。

每轮最多八次澄清请求。报告新增 `playerClarification`，分别保留完整问题、选项、精确答案、选项索引、选择理由、发送／完成时间、失败状态、请求次数和问题数。确认回答后标记 `interactionPath=player-clarified`，不将这一过程冒充完全无需交流的首次成功。原 `wish` 文本保持不变；后续模型调用继续受本轮原预算与时限约束。

启用时先核验冻结包具有两个新入口。旧包不具备时拒绝启动新效果轮，不能运行中换包，也不能回头改写此前失败记录。

**选择默认答案只是模拟玩家策略，不代表这些提问合理。** 把底座接口、实现风险、技术选型交给玩家决定的体验问题仍需单独审查。

## 验证

10 项离线合同及模拟玩家测试通过，覆盖 headless 限制、有限字段投影、正式 API 映射、旧请求／并发／跨会话拒绝、无任意脚本入口、超限拒绝、默认关闭与推荐选择。桌面 TypeScript 检查通过；隔离工作树先补齐依赖类型声明，未构建产品。

prepare-only 输出确认 COM01 原句、40 请求上限和显式澄清模式，未启动模型。没有启动 profile、构建安装包、修改既有固定成品或进行真实输入；实际效果复验等待总控集成并冻结新包。
