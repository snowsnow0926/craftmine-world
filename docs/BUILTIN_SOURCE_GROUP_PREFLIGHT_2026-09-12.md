# 内置素材成组安装真实核心预检

2026-09-12 使用冻结成品 `fc58b4237f5a` 内的实际 ZIP、标准 `creation_world.gd` 和 `craftmine-core.exe`，验证新成组安装器。源码测试夹具为隔离最小 creation-sandbox 项目；没有打开玩家 profile、启动游戏/引擎或调用模型。

| 组 | 输入 | 结果 |
| --- | --- | --- |
| 1 | 自然日光、林间入口、左右两棵同包橡树 | 4 个独立实例，3 个共享资源锁条目；源码 revision 1 |
| 2 | 城墙直段、方塔基座 | 总计 6 个实例、5 个锁条目；源码 revision 2；第一组实例、位置和素材正文保留 |

每组实际调用一次 `godotProject.applyFiles` 和一次 `godotBuild.start`。两次检查均为 `blocked / GODOT_EXECUTION_UNAVAILABLE`，因为本预检没有注册执行器；不能称为实机、画面或引擎检查通过。

最终 64 个已安装素材文件均按冻结 ZIP 清单核对正文长度及 SHA-256，6 个脚本/资源 UID 无跨路径重复；标准底座源码未变。重复橡树分配不同实例身份，位置分别为 `(-6,0,-5)`、`(6,0,-5)`。安装前后完整 `world.read` 记录相同，SHA-256 均为 `3509037b3013711aba83849d17b2f295f6e8d2dec75318a56cd36bc184cd892c`，未偷偷采用或更改玩家进度。

原始报告保留在 `D:/cm-group-source-install-0912/test-results/builtin-group-rlwKzC/report.json`；正文副本见 [实测证据](evidence/BUILTIN_SOURCE_GROUP_PREFLIGHT_2026-09-12.json)，包含精确冻结目录、每包哈希、实例 ID、源码与检查回执。只提交报告，不提交临时数据库。

复验命令：

```powershell
node tests/builtin-source-group-native.mjs 'D:/cm-promo-loop-0912/desktop/build/releases/fc58b4237f5a-9efd801e-dfc5-45cc-8b15-04583b907eb0/output/win-unpacked'
```

本次只运行上述两组，没有重跑全库逐包测试，也未修改冻结成品。
