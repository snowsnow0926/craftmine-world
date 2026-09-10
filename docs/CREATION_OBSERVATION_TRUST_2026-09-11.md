# 造物观测信任边界修复

日期：2026-09-11。

## 问题与实际反例

原 creation adapter 直接返回可编辑 world.observe 的实体事实。独立 Web 反例保持真实树为一倍尺寸且关闭碰撞，却让 world.observe 返回二倍/solid=true；旧要求检查因此可能被同一份受测代码误导。

## 修复

creation adapter 从实际场景根节点的 Entity_* 子节点独立采样 global transform、真正可见的 MeshInstance3D、主 StandardMaterial3D 颜色、实际启用 PhysicsBody3D/CollisionShape3D 的包围盒。实体种类和声明参数来自 world/creation.json，实体存在性、尺寸、材质、可见性、碰撞与门/宝箱实际节点姿态从引擎读取；覆盖 world.observe 的 entities/obstacles。目标点来自实际摄像机射线；玩家位置来自实际节点；库存和虚拟时间读取实际世界变量；物理时钟由 adapter 自己在未暂停的物理帧计数。普通脚本仍负责规则与游戏行为。

带 creation 要求的核心 check 在材料化时强制三个受保护源码文件与编译进 core 的完整 LF 或 CRLF 字节摘要一致：base_adapter.gd、runtime_bridge.gd、state_guard.gd。同时验证 project.godot 的固定 autoload 与 adapter 路径，拒绝重复/别名/重定向。受保护代码摘要加入已有 hostResourcesHash，因此更新采样契约会改变构建身份。没有在不可变 build-copy 中偷偷覆盖 Git 源码，正式导出/复制的逐字节校验保持原义。

已有旧世界的受保护接口必须由宿主在正常源事务中按精确 stock 身份升级；没有 creation 要求的原始初始化检查保持兼容。修改过的自定义受保护文件不被静默覆盖，返回明确 SOURCE_MISMATCH。旧世界升级由 NB3 集成；导出后 PCK 脚本和实际入口字节验证由 NB2 在可信执行器补齐，这两者有独立证据。

## 验证与范围

原反例实际 Web 复验 5 项通过：world.observe 继续谎报，但固定 adapter 返回真实一倍/无碰撞，loaded/running 均拒绝。正常 30 项 Web 复制/属性/时间/门检查和 8 项普通采伐脚本检查通过。核心反例验证替换三个受保护文件、重定向入口不会创建检查作业；相关 Godot 核心回归通过，历史既有跳过项独立保留。

一次增量 rustc 编译发生 STATUS_ACCESS_VIOLATION，关闭增量并以单任务重新编译后完成核心回归，保留原失败日志。这是受保护的有界运行采样，不宣称对任意恶意反射脚本或视觉语义作形式化证明。

## 已声明行为的动态进度

最终审查发现：采伐树仍隐藏时提交无关放置愿望，如果模型检查前树自然长回，旧冻结规则会把合法最新进度当作错误。修复后可信 adapter 仅依据正式 scene.rules 的 entity-behavior.entityIds 标记 `presenceMutable` 捕获元信息；已有这类对象的瞬时 visible/solid 不作为冻结要求。静态对象仍严格保留 presence；新增物件仍必须可见且有碰撞；ID、位置、尺度、颜色和数量继续核对。撤销的未涉及对象同样处理。元信息不进入核心要求契约，也不能由模型请求指定。

真实 Web 10 项回归通过，包含实际砍伐隐藏 → 冻结无关 18 点愿望 → 自然重生 → 真实采样仍满足愿望，同时错误奖励、提前重生、丢失恢复继续拒绝；12 项要求单测及桌面类型检查通过。

门的碰撞状态与普通开门进度独立处理：adapter 给 door 标记 capture-only solidMutable，仅允许其 solid 随门状态变化，visible 仍固定。entity-behavior 的 presenceMutable 则允许声明的可见/碰撞投影按保存进度变化。主材质颜色在可见性过滤之前读取，因此隐藏的树仍保留真实颜色约束，不因生长阶段把颜色验收省略。
