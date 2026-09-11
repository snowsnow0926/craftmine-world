# 有限 Godot 探索输入与多角度观察

日期：2026-09-12。范围：已有受保护 headless 控制器；不是模型工具或玩家新操作契约。

## 接口与身份

只在通过 `readHeadlessProfile` 路径、token、隔离目录和父进程 IPC 检查后注册 `godotExplore`。请求固定为 `{type:"craftmine-headless", id, method:"godotExplore", payload}`。payload 仅允许：

```json
{
  "worldId": "实际世界 ID",
  "buildId": "实际构建 ID",
  "instanceId": "当前实例 ID",
  "steps": [
    {"op":"look","args":{"yaw":0.4,"pitch":-0.2},"capture":true},
    {"op":"walk","args":{"forward":1,"right":0,"frames":30}},
    {"op":"wait","args":{"frames":10}},
    {"op":"interact","args":{},"capture":true}
  ]
}
```

示例身份为说明占位，调用方必须使用 `godotObserve` 的真实值。支持 creation-sandbox、first-person。look 为绝对弧度 yaw/pitch，不是增量。沿用已有 GodotGameplayAccess.action 调用，移动经历实际控制器与碰撞；交互沿用目标交互系统。无传送、属性赋值、脚本执行、自动恢复暂停、装备或时间修改。

动作前后、截图前后及截图自身携带的 viewportObservation 必须与请求的三项身份、首次观察到的 baseId 一致。身份变化立即中断后续动作，不生成成功报告，不重放。所有步骤先完整校验并复制，才接触运行时；一个探索序列执行中拒绝另一探索请求。父控制器须顺序执行探索与其他既有控制操作。

## 限制

- 1–16 步，walk/wait 每步 1–120 个整数物理帧。
- forward/right 范围 -1…1；yaw 范围 -π…π，pitch 范围 -1.55…1.55；拒绝 NaN/Infinity 和未知参数。
- 整个请求最多 600 个动作物理帧预算。walk 按 frames+1 计入第一人称控制器额外等待；look/interact 保守计 1；wait 按 frames 计。
- 最多 4 张固定 1280×720 截图；使用已有真实 headlessCapture，要求 PNG、尺寸、视口和截图观察身份相符，返回像素 SHA-256。
- 预算约束发出的动作，不代表停止游戏物理时钟。观察、截图及已编写玩法本身仍可自然推进物理帧。

返回 `craftmine.godot-exploration/1`，包含原始动作结果、动作前后观察、截图自身观察和前后总观察。它证明采集到什么，不自动宣称愿望验收、视觉质量或正式采用通过。

## 验证边界

13 项探索与既有游戏验收合同测试通过；桌面 TypeScript noEmit 通过。测试用替身观察和 PNG 头验证限制与身份，不冒充真实游戏或视觉结果。总控负责独立真实 Godot 控制、截图及成品验证。没有操作个人存档、真实鼠标/键盘或请求 Pointer Lock。
