# Legacy 备份恢复：修复 JSON 键顺序误判

日期：2026-09-12。基线：`43203d8e`。分支：`codex/legacy-snapshot-equality-20260912`。

## 已确认原因

失败恢复 profile `desktop-native-complete-sQOwnK` 的默认 legacy 世界已正常保存。只读读取 SQLite 快照，再通过生产 `GameplaySession` 和 `BehaviorState` 重建运行快照，两者值完全相等，但根层、gameplay 层和 behaviors 层的属性插入顺序不同。

旧视图在 mount 时把读库快照 `JSON.stringify` 存为 `lastSaved`，恢复前又把运行时重建的快照转成字符串比较。正常保存、退出、冷重开后，读库键序仍不同，因此不断触发 `BACKUP_PROGRESS_CHANGED_REINSPECT`，甚至尚未进入核心恢复任务创建阶段。

## 实际修复

复用既有 `app/canonical.mjs` 的纯 JavaScript `canonicalJSON`，统一用于 mount 已保存基线、save 的 dirty 比较和成功保存后的基线，以及 beginRestore 比较。该模块不依赖 Node，可随现有浏览器插件构建打包。

仅忽略 JSON 对象属性顺序，数组顺序、数组内容、数字／字符串类型、字段有无、玩家位置、库存、行为时间与快照版本全部继续比较。没有把 loaded 返回的快照设成“已保存”，没有忽略初始化奖励、进度升级或 pending 行为提交。首次 progress/1→progress/3 的新增字段仍需要正常保存后重新检查。

## 验证

- 6 项测试通过：5 项离线回归＋1 项真实失败数据库只读复现。测试执行实际 view 的 mount 基线、save 与 beginRestore 函数，验证排序等价、真实进度差异拒绝、失败解锁、保存失败不提前更新基线、显式保存后恢复放行。
- 真实样本：深度值比较为 true；原 JSON 字符串比较为 false；canonical 比较为 true，实际 beginRestore 比较分支通过。
- `node desktop/build-world-plugin.mjs --output test-results/legacy-snapshot-browser-bundle` 构建通过，确认浏览器打包兼容。
- 测试入口：`node --test tests/legacy-snapshot-equality.test.mjs`。额外真实样本通过 `CRAFTMINE_LEGACY_SNAPSHOT_DB` 指定只读数据库路径。

本轮没有启动原 profile、输入操作或修改数据库；未涉及备份服务／错误码映射。完整成品恢复仍待总控合入新包后执行，单元复现不代替备份端到端验收。
