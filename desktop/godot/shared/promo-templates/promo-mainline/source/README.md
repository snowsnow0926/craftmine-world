# 沉浸式造物世界底座

本底座是独立的真实 3D 世界，使用固定 Godot 4.7.2、CharacterBody3D 行走、StaticBody3D 碰撞与相机射线。空白模板不预置任务、武器、宝箱或机关。

`world/creation.json` 保存物件身份、类型、位置、朝向、尺寸、颜色和源码规则声明。支持树、岩石、宝箱、门、标记。规则脚本必须存在且 SHA-256 与声明一致；顺序机关拥有的门不能直接按 E 绕过。

运行中的世界不轮询磁盘源码。所有创造修改通过候选检查、进度迁移和采用进入下一实例，防止未检查的内容直接改变正式世界。

进度合同 `craftmine.creation-progress/1` 保留玩家姿态、时间、物品、已开宝箱、门与规则状态。宝箱通过稳定 ID 的账本保证一次奖励；已移除物件的账本也保留，恢复同一身份不会重复奖励。新增门与规则必须由主机将真实候选的初始状态合并后再恢复，不能静默添加。`sourceTimeOfDay` 记录已采用的源码时间默认值，源码时间变化才更新已保存时间。

观察接口返回 `creation.target`（实体 ID、世界坐标、法线、表面与版本）、实际碰撞 AABB、物件定义和玩家范围。未命中使用空目标。操作通过桥的 `walk`、`look`、`interact`、`wait`、`set-time` 完成；无真实输入的测试使用同一控制器与碰撞。

验证：`node --test desktop/godot/bases/creation-sandbox/tests/contract.test.mjs`；完整引擎故事：`node desktop/godot/bases/creation-sandbox/tests/headless.mjs`。引擎测试始终 headless，使用独立配置目录并禁用输入捕获。
