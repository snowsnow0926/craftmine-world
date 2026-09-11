# 旧原版世界升级契约

范围和证据见仓库根 `docs/CREATION_STOCK_MIGRATION_2026-09-11.md`。

`bindCraftmineTurn` 先绑定正式捕获，再调用 `createCreationSourceMigration`。保护集合为三个
共享运行时文件；可变世界/契约源码仅在确定原版且需要兼容升级时替换。用户已使用本版
保护文件的自定义世界不应被迁移拦截。源码升级调用现有 `godotProject.patch`，具有文件
expectedHash、工程 revision/manifest 和 Git expectedHeadOid，所有替换同事务完成。

`CreationCapture.sourceMigration` 只由宿主记录，包含原正式身份、精确新 source pin、升级
编号与原回执 pin。`creation-source-service` 仅把匹配原捕获的这一 source pin 加入本任务
允许的源码进度；玩家位置、目标和正式 build/instance 的原有检查仍执行。

宿主迁移记录在 `creation-migrations` 目录。写入前落原请求，丢回包查相同 binding/toolCallId
回执；跨 turn 恢复必须整树与确定升级结果一致。额外未采用改动、未知旧保护版本、未知旧
可变核心文件、重复固定入口、回执缺失或校验不符都不覆盖数据，并给出可解释错误。

验收入口为 `node tests/creation-migration-native.mjs`。从 c1660f12 源码独立 materialize
旧世界，再以新客户端正常升级、检查、采用及重开。不得用个人安装/个人存档代替此 fixture。
# 已发布观察器的显式维护入口（2026-09-12）

32cd879d / 594f698b 的完整固定观察器集合可以按精确 LF/CRLF 哈希升级至当前版本。旧普通对象字段仍不可信；目标捕获只返回不可编辑的 `upgradeId`，`captureId` 与目标为空，普通聊天不绑定旧对象。未知、缺失、别名或被改写的观察器不获得维护句柄。

玩家在现有目标面板明确点击更新后，复用 creationEdit 的操作 ID、状态、关闭和检查/采用流程。仅此维护 action 能消费句柄。既有 CAS 迁移保留所有普通源码和进度；有未采用修改或身份变化时拒绝，不覆盖草稿。采用必须对应迁移回执的准确源码、通过的 check、未变化的候选/分支和原正式世界。成功后重新捕获当前实例，不沿用旧对象身份。维护不调用模型，不新增平行事务或放宽观察器信任。
