# 造物沙盒武器组件

直接挂在世界根节点下；这是独立 GDScript 组件，不依赖 first-person 的 EquipmentState 或 TargetDummy。玩家通过 `player_path`（默认 `../Player`）绑定。同一个世界/玩家出现两件此组武器时，双方攻击和保存校验都拒绝。

- `entity_id`：稳定组件身份；同时加入 `craftmine_player_weapons`、`craftmine_persistent_components`。
- 源码配置：`damage` 默认 20（0..999999，排除 0），`range_meters` 默认 30（0.5..80），`cooldown_seconds` 默认 0.35（0.05..60），`max_ammo` 默认 12（整数 1..999999）。
- `attack(player: Node3D) -> Dictionary`：返回 `fired/reason/entityId/hit/targetId/damage/ammo/remainingCooldown/shotsFired`。`hit` 表示选中合规伤害目标，不等于实际扣血；实际扣血读 `damage`。
- 目标必须在最近实际碰撞节点或其祖先，属于 `craftmine_damageable_targets`，且实现 `apply_damage(amount: float, player: Node3D) -> {applied: 数值}`。有效 applied 范围是 0..本次 damage。不穿过其他碰撞体，不通过标签名称、静态元数据或脚本名猜测宠物为怪物。
- 同玩家必须有唯一 `craftmine_player_vitals` 节点（`_player` 绑定、`health` 数值）。暂停、死亡、空弹匣、冷却、未知玩家相机均拒绝，拒绝不扣弹。射线从当前玩家 Camera3D 画面中心发出；未命中或被阻挡仍消耗一次已开火的弹药和冷却。
- 鼠标入口仅在玩家已捕获鼠标时调用同一 `attack`；组件不请求捕获、不发送输入。枪身、圆柱枪管和握把由三个原创 PrimitiveMesh 组成，延后到 current_scene 绑定后挂到已有 Camera3D/WeaponMount；初始化幂等。未提供完整枪械动画或音效。

`craftmine.sandbox-weapon-state/1` 保存 `format/entityId/settings/sourceSettings/ammo/remainingCooldown/shotsFired`。所有数字通过 JSON 往返规范化；`validate_state` 无副作用，`restore` 完整校验后一次性赋值。`settings`、`sourceSettings` 为已绑定源码配置，变更源码时需显式迁移，不能用旧存档覆盖新伤害参数。不提供宿主补弹/修改容量入口。

验证：`node tests/godot-components/sandbox-weapon-headless.mjs`，设置 `CRAFTMINE_GODOT_CACHE_DIR` 指向固定工具链缓存。复制沙盒与实际 vitals/registry 到独立临时工程，用真实 Godot headless 碰撞、射线与物理帧，无鼠标键盘事件。第二独立进程通过实际 ComponentState.restore 恢复第一次进程写入的 ledger，确认非零冷却、余弹及次数一致。测试使用独立伤害目标夹具；未宣称完整怪物产品集成、玩家手感或画面美术验收已完成。
