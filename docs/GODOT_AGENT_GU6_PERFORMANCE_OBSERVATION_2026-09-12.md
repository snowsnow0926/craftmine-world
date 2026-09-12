# GU6 性能观察切片（2026-09-12）

## 已实现

新增 `plugins/craftmine-world/godot-performance-observation.mjs`，提供只读的身份绑定投影。观察必须同时匹配 `worldId/buildId/instanceId`，否则拒绝；数值必须是非负有限数。输出固定字段的 `measured/unknown` 状态和 `measurementHash`，不会把缺失数据补成零。

当前可表达的真实字段：Godot 主循环帧间隔（`frameTimeMs`）、物理步长（`physicsStepMs`）、对象数（`objectCount`）和进程工作集（`memoryWorkingSetMb`）。GPU 时间明确保持 `unknown`，因为现有 runtime/LPAC 通道没有 GPU counter；不能从 headless 帧间隔推断 GPU。

## 4.7.2 实测

使用现有 `desktop/delivery/measure.mjs frame`，独立 scratch 项目、独立导入目录、Godot 4.7.2 stable headless，未触碰用户 profile 或输入。一次 300 帧运行结果保存在 `test-results/gu6-performance-frame.json`：

- `frame.time.ms`: 300 个真实引擎样本，p50 **6.899 ms**、p95 **6.964 ms**、最大 **6.997 ms**，阈值 16.67 ms，结果 pass。
- 这是空白 top-down authored scene 的 headless 主循环指标；不代表渲染帧率或 GPU 性能。
- 当前 runtime 没有安全的同一实例对象计数/物理步长/GPU 读取接口，因此这些字段在投影中为 `unknown`。不能把单次空场景读数称为优化收益。

建筑 A/B 的真实对照仍需把对象计数和实例标签作为同版本 runtime 事件发布后才能进行；在接口补齐前保持 unknown，比伪造对照更可靠。

## 验证

`node --test tests/godot-agent/godot-performance-observation.test.mjs`：2/2 通过，覆盖身份串线拒绝、非法值拒绝、真实字段与 unknown 字段投影。
