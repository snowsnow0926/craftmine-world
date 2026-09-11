# 宣传片开发：有限探索观察桥

日期：2026-09-12，基线 940c5a84。已核对 creation-sandbox 与 first-person 的共享适配器和 BaseOps 参数，实现受保护 headless 父进程专用的 godotExplore。

每次请求绑定真实 worldId/buildId/instanceId，完整校验有限动作序列后才调用既有控制器；动作前后与截图自身观察核对身份。仅支持 look/walk/wait/interact，16步、单步120帧、600动作帧预算和最多4张固定720p截图。无新增模型权限、状态赋值或游戏操作。

13 项合同测试、桌面 TypeScript 检查通过。真实 Godot 的动作、碰撞、截图和安装包验证交由总控；当前不宣称真实视觉或玩法成功。

接口与示例：vendor/pi-desktop/docs/spec/godot-bounded-exploration.md。
