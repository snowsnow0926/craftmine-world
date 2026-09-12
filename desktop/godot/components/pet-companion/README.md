# 可玩宠物组件合同

本组件负责平地跟随、碰撞停止、近距互动反馈及独立状态。产品包装绑定两份已审查的真实 `PackedScene`：`dog_visual` → `visuals/dog.glb`，`pomeranian_visual` → `visuals/pomeranian-white.glb`。入口为 `CharacterBody3D`，挂载 `scripts/pet_companion.gd`；安装器提供非空独立 `entity_id`。默认玩家路径 `../Player`。不在 `_ready` 随机分配身份。

`_ready` 将节点加入 `craftmine_persistent_components`，创建自己独占的碰撞资源和 `VisualPivot`。替换外观只替换后者子节点，根身份、脚底位置不变。普通犬圆柱半径 0.75 米、高 0.77 米；博美半径 0.36 米、高 0.48 米，中心均为高度的一半。保守圆形占地用于避免转身时鼻尾扫入墙；它会比实际身体更宽，首版不提供寻路、绕障碍或传送追赶。

`VisualPivot` 保持单位变换，动画仅为已验证的 `idle` / `walk`，每实例独立动画库、循环播放、零混合切换。互动只提供文字和信号，不额外摆动或缩放模型。增加其他动作或混合动画前必须重新证明包络。

## 状态和宿主接口

```json
{
  "format": "craftmine.pet-companion-state/1",
  "entityId": "pet-instance-id",
  "settings": {"name": "小伙伴", "appearanceKey": "dog", "following": true},
  "sourceSettings": {"name": "小伙伴", "appearanceKey": "dog", "following": true},
  "position": [0, 0, 3],
  "yaw": 0,
  "interactionCount": 0
}
```

- `snapshot() -> Dictionary` 返回 Godot JSON 正规化后的实际传输形式。`validate_state(Dictionary) -> String` 严格校验所有字段、身份、有限数值及源码默认配置。空字符串代表有效。`restore(Dictionary) -> String` 在全部验证后恢复，不迁移源码配置、不判断尚未恢复的其他角色。
- `_source_settings` 是 `_ready` 捕获的不可变默认值。宿主在候选迁移时，只把源码默认值确实变化的 `settings` 键更新为候选真实默认值；保留未变运行设置、位置、朝向、互动次数，并更新 `sourceSettings`。来源不匹配时本组件拒绝恢复。不能只改 export 后假定旧存档会自动更新。
- 宿主恢复所有组件和原生玩家后，调用 `validate_restored_state() -> String`。失败必须整体回滚玩家和所有组件；该方法本身不修改位置、不等待帧、不恢复游戏运行。
- 静态世界用实际圆柱的原生物理查询；圆柱径向缩进 2 毫米、上下各缩进 2 毫米，允许接地/接触数值余量。已恢复玩家及组件的服务器 broadphase 在同帧可能仍是旧位置，故排除其旧 RID 后，对实际形状与当前变换计算精确相交。仅支持直立、单位缩放的原生 `CylinderShape3D` / `CapsuleShape3D`，读取实际形状所有者，尊重禁用形状和碰撞层，不使用 metadata 或 AABB 代替几何。未知动态形状/倾斜/缩放明确拒绝。
- `interact(player) -> Dictionary` 再校验同一绑定玩家、距离、暂停状态和实际 LOS，成功增加本实例计数，返回 `feedback` 并发出 `feedback_emitted(entity_id, message)`。宿主负责将 E 和 adapter interact 统一为一次实际准星命中派发；组件不注册独立 `_unhandled_input`。
- `set_companion_name` / `set_appearance_key` / `set_following` 修改运行设置。批量恢复或变更外观占地时，宿主仍需完整状态事务和恢复后几何校验，不能把单独 setter 当作通过整体检查的证明。

## 独立验证

运行 `node tests/godot-components/pet-companion.mjs`。如固定引擎不在默认缓存，设置 `CRAFTMINE_GODOT_CACHE_DIR`。设置 `CRAFTMINE_CANINE_VISUALS` 为 `canine-visuals` 目录时，额外校验两份冻结 GLB 的 SHA-256，实际导入，采样关键帧/中点/240 Hz 动画顶点，验证真实碰撞包络和撞墙后的可见网格间隙。

测试用独立 headless 引擎和数据目录，无产品 profile、模型调用、真实输入、窗口激活或 Pointer Lock。行为 fixture 的空命名节点只测试外观资源独立性，不冒充犬外观；真实 GLB 的网格验证也不冒充产品截图或最终 E 接线验收。
