# 创作指导的适用性与写入权限澄清

日期：2026-09-12。基线 b2ba3984。由宣传片宠物首次任务的真实推理误读触发，修改为通用指导，不加入特定宠物实现或验收答案。

## 核实的调用链

1. godot-guidance.cjs 仅按 requiredInterface 选择引用，调用 godotProject.read 比对文件 SHA-256。该标记没有进入 godotProject.patch。
2. Godot 源码事务实际检查绑定世界、任务租约、revision/manifestHash、旧文件 expectedHash、路径/扩展名、大小和 CAS；普通 authored scene 与脚本仍可开发。
3. 托管内容另有实际检查：godot_host_resources 的导出预设、Web shell/bridge 由宿主注入；带 creation 检查要求时，godot_creation_probe 固定验证三个共享采样/运行桥接文件与 project.godot 内的指定桥接入口。不能将此解释为所有引用文件或整个 project.godot 都只读。

## 完成调整

- catalog/read 明确返回 requiredInterfacePolicy；哈希不匹配仍返回原错误码，附“指导覆盖不匹配，不是写权限拒绝”的说明和当前源码重读路径。
- 更新两个实际技能模板，强调由 godot_project_patch 与宿主写入/构建策略决定可写范围，并保留持久化 capture/validate/restore 的要求。
- 生成器与目录升为 1.5.0；creation-sandbox.authoring 升 1.5.0，first-person.equipment-parameters 升 1.0.1，修复此前正文版本落后于目录的问题。
- 未改变任一底座源码、引用快照、acceptedSourceHashes、interfaceHash、requiredInterface 布尔值、写入权限或验收标准。

## 验证

9 项指导测试通过。覆盖实际 broker 的 catalog/read 输出、原有错误码与哈希拒绝、技能正文和版本一致、身份及权限边界。两个技能的完整 references 与 interfaceHash 均与提交前一致。连续重跑生成器的 catalog SHA-256 一致。

同步前一轮初始工具测试断言：已展示 guidance 直接调用，ToolSearch 仅发现未展示工具。没有改变该已实现行为。

未调用真实模型、Godot 或用户输入。本轮证明指导含义和接口一致性，后续真实模型能否改善由总控复测。
