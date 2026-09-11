# COM01 新成品复验：三只静态怪物已交付

日期：2026-09-12。产品／驱动基线：`964d96d0`。这是新包、新 profile 的独立复验，保留此前 10 请求摸底和等待澄清超时两轮的原始记录。

**原句“给我生成一些怪物。”已在一次三问澄清后交付三只绿色带角方块角色，真实检查、采用、保存和冷重开通过。此次明确选择了静态摆设，不证明追逐、攻击或完整战斗能力。**

## 实际截图

![近景：三只静态绿色怪物](D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/exploration-c3fa6585-6430-4258-af76-344074c2d261/view-2.png)

[侧面截图](D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/exploration-c3fa6585-6430-4258-af76-344074c2d261/view-3.png) · [采用后原始截图](D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/adoption-2fa49718-50d9-410f-952e-eebcbfcbc58a/adopted.png)

均为固定成品 headless API 的真实 1280×720 截图；近景和侧面由有限正常步行／转向取得，没有设置角色位置或替换源码。已人工查看，可辨识三个绿色、白色角的方块角色及实体侧面。

## 澄清与用量

显式开启 `recommended-or-first`。本轮三个问题没有推荐标记，策略选择各自首项：

1. **静态摆设：只站着、不动、不攻击**。
2. 3 只、小型约 1 米高、绿色。
3. 当前瞄准落点附近，即玩家面前。

完整问题、选项与答案保留于报告 `playerClarification`，请求次数 1、问题数 3、`interactionPath=player-clarified`。该默认策略把目标简化为静态内容，不能代表宣传战斗目标；“最快／不影响玩法”及技术化提问也不因驱动能回答就算良好产品体验。

| 项目 | 实际值 |
|---|---|
| 模型与强度 | DeepSeek `deepseek-flash`／high |
| 请求 | 11／40，剩余 29 |
| 总 token | 705,269 |
| 输入／缓存读取／输出 | 221,348／459,776／24,145 |
| 推理 token | 18,584，包含于输出 |
| 模型任务／总驱动时间 | 122.675 秒／约 149.4 秒 |
| 采用及两轮探索追加模型请求 | 0，原账本未改变 |
| 检查、采用、保存冷重开 | 均有成功回执 |
| 退出与隔离 | violations、pageErrors、shutdownFailures 全为空 |

固定包 inventory SHA-256：`d9852acab6c6d8c191ef2eed0f877e478b5cc76f496ed7995380ad405d735b63`。采用与探索核验包未改、原世界和检查构建身份一致。没有执行追逐、受击、击杀、掉落、巨大怪物或 AK47 测试，也没有手工修模型作品。

## 原始证据

- [模型报告与问答](D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/report.json)
- [采用及保存冷重开](D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/adoption-2fa49718-50d9-410f-952e-eebcbfcbc58a/report.json)
- [四方向观察](D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/exploration-09e55daa-ff10-4980-a4b5-499319c71ea6/report.json)
- [近景与侧面步行观察](D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/exploration-c3fa6585-6430-4258-af76-344074c2d261/report.json)

## 同世界继续创作的只读评估

可增加一个薄 follow-up driver，复用当前隔离 profile、同一冻结包及正常会话入口。原 session 为 `bce3d5ec-cf1b-432f-a0a2-c875eb0b4cdb`，世界为 `world-9c77672f23a8`。现 evaluator 已支持 `CRAFTMINE_EVAL_SESSION` 的重新初始化与新 wish ID；下一条清单 COM02 是“我想玩怪猎。”，应通过正常玩家澄清确定实际挑战范围。

启动前验证无活动模型、当前已采用构建和账本 11／40；显式保留 `REQUEST_LIMIT=40`，不能改为 29、删账本或重置计数。`createEvaluationBudget` 会延续原请求集合，愿望 journal 会拒绝重复提交同一 ID。后续报告应放原输出目录同级，保持原报告不变，记录起始累计、最终累计和本次增量，并确认原 11 个请求仍为账本前缀。

现有 `promo-wish-checkpoint-live.mjs` 硬编码新 profile、零预算、10 次及 PET A05，不能直接冒用。此处仅只读提出复用路径，没有发送后续愿望或追加付费调用。
