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
