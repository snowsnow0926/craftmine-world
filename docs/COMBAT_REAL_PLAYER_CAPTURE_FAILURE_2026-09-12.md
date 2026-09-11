# COMBAT 普通玩家跟进：捕获阶段失败（2026-09-12）

输入为“这些怪物应该会追着我攻击，我要和它们战斗。”。本次使用真实玩家保存的 `deepseek-v4.1-flash-expires-on-0910`、`max` 与完整模型配置，复用静态怪物世界 `world-9c77672f23a8`、会话 `bce3d5ec-cf1b-432f-a0a2-c875eb0b4cdb`，固定成品为 `32cd879d364d-c0acf0e3-b793-467e-9dcb-1b8572953512`。

结果：**没有发出新模型请求，战斗改造尚未开始。** 正常 setup 和 status 成功，随后 `playerPrompt` 内的 `godot.creationTarget` 抛出 `CREATION_OBSERVATION_INVALID`。本次 messageId `b294fb91-d4f2-4a44-8bd3-5426a2e02bbe` 不在结束时会话消息中，报告中的旧 metrics（11 次）属于前一次静态怪物任务，不能归入本次用量。

真实目标返回 `surface="prop"`、`entityId=null`，位置和法线均有效；同时观察中有 `Monsters/Monster_3` 的 `StaticBody3D` 场景引用，其祖先 `Monsters` 来源为 `res://scripts/monsters.gd`。宿主 `creation-target-service.ts` 的 capture 校验只允许 `ground/entity/boundary/none`，因此在后续 generic 场景引用信任校验之前就拒绝了这个目标。这里记录实际接口不一致，不将其归咎于模型造物失败，也没有改写返回值绕过校验。

原报告：`D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/player-21cd0faa-02bc-44df-9219-b32b7302e97e.json`。

正式原世界截图：`D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/player-21cd0faa-02bc-44df-9219-b32b7302e97e-formal-world.png`。

报告最终 `RUN_FAILED`、`stateIntegrityVerified=true`，退出审计三项为空。无新 patch/check、无采用，未调整怪物源码、用户资料、权限模式或受测包。未启用评测额度、未发送真实键鼠、未抢焦点或请求 Pointer Lock。已向总控报告，尚未盲重试或把这个问题标为已修。
