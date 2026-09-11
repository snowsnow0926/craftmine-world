# 普通物件 prop 捕获兼容修复（2026-09-12）

COMBAT 普通玩家输入“这些怪物应该会追着我攻击，我要和它们战斗。”在提交模型之前失败。真实观察返回 `target.surface="prop"`、`entityId=null`，同时固定观察器提供 `Monsters/Monster_3` 的 `StaticBody3D` 引用和 `scripts/monsters.gd` 祖先来源。宿主最前面的 surface 枚举校验拒绝 prop，因此未进入已有场景对象验证链。

原始失败报告：`D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/player-21cd0faa-02bc-44df-9219-b32b7302e97e.json`。本次消息没有进入会话，不能把旧任务 metrics 当作这次模型调用。

## 修复行为

允许 prop 先通过普通的世界、构建、实例、源码版本、时间及有限位置/法线校验，但必须继续经过原有完整验证链：

- 正式源码中的五个固定观察器文件哈希全部匹配当前托管合同。
- 固定观察提供合法的 sceneObjectTarget，包括实际实例 ID、节点路径、祖先和正式源码允许的引用。
- 新采样的 sceneObjectRefs 确认同一实例及来源仍有效；在 validate/bind 时继续复核，替换或过期必须重新捕获。
- 没有绑定对象、观察器旧版/篡改、fallback 不确定射线、无效实体或向量均拒绝；未知 surface 仍拒绝。

成功的 prop 使用已有普通场景对象上下文，最终结构化 target 为 none，不把 prop 变成 creation_operation entity 或“这里”的放置落点，不从名称或 metadata 生成身份。自动采用仍为 false，需求仍要求普通源码检查。未更改 Godot adapter、保护 pins、生成怪物源码、权限或已有结构化目标规则。

## 验证

`scene-object-target.test.mjs` 加入真实失败形态：实际怪物节点/祖先、位置/法线、surface=prop 和 physics 优先的 selection。测试确认 capture → validate → bind 成功进入普通源码上下文，并保留实例作用域及不得自动采用的边界。

另外覆盖：缺失对象/refs、伪造或替换实例、非法路径/向量、prop 冒充 entity、fallback、五个固定源分别篡改、旧三源观察器，以及捕获后祖先或构建变化。连同原 `creation-target-service` 与 `creation-recent-results`，共 **30 项通过**。

本次只跑针对性离线回归，未继续模型任务、未用转头掩盖原目标问题。修复后的冻结成品仍需在同一怪物目标、同一句输入上真实复验。
