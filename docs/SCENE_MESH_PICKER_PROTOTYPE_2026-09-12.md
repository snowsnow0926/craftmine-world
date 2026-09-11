# 无碰撞 Mesh 三角形拾取原型

日期：2026-09-12。源码基线：38618cac。新增固定 helper：`desktop/godot/shared/scene_mesh_picker.gd`。

## 当前交付范围

在实际当前透视 Camera3D 的中心射线上，选取有限场景中最近的内建 BoxMesh 三角形。支持普通 MeshInstance3D、无碰撞体、父节点平移/旋转/正向非等比缩放，以及多个节点共享同一 Mesh 资源。这覆盖 PET02 身体使用的 BoxMesh 与父节点姿态动画方式；夹具是独立构造，不等于实际 PET02 产品验收。

包围盒只做粗筛和未知遮挡的保守边界，最终命中来自 `Geometry3D.segment_intersects_triangle`。比较世界空间距离，法线使用逆转置变换，按实际材质 cull_mode 过滤三角形；最近背面被剔除时继续检查其余三角形。薄盒按真实表面测试，不补厚度。重合的不同实例不能任意挑一个。

这不是 GPU 深度/ID 缓冲拾取，不声明屏幕像素准确。固定 helper 尚未接入 adapter、托管源保护、迁移或成品；集成由总控完成。

## 固定 adapter 集成约定

```gdscript
var result = Picker.new().pick(world_root, actual_current_camera, exclude_nodes, actual_physics_hit)
```

- `world_root` 必须在当前场景树，camera 必须在其子树中且 `is_current()`，首版仅透视投影。不主动切换或修改相机。
- `exclude_nodes` 最多 8 个真实子节点实例。固定 adapter 可传 Player、实际辅助 marker、selection_box，排除其整个子树；helper 返回 excludedObjectIds。不能根据项目自报 metadata 或名称任意跳过普通物件。总控负责核实辅助成员的真实对象和形状。
- `actual_physics_hit` 来自同一当前相机中心射线的真实物理查询（排除玩家和必要辅助对象），不能传旧 UI target 的位置。较近物理命中阻止返回后方 mesh。helper 自己不新增物理体或改变玩法碰撞。
- `hit` 返回实际 MeshInstance3D 的 `node`、十进制实例 `objectId`、世界 position/normal、triangleIndex、distance。node 只在同进程供固定 adapter 即时投影；不得原样序列化成模型权限。
- adapter 以 `_scene_node(node)`、`weakref(node)` 和 `_scene_ancestors(node)` 接入已有 sceneObjectTarget/sceneObjectRefs。脚本/祖先身份变化及跨 world/build/instance 按现有重捕获规则处理；引用仍是 runtime-instance、context-only，不变成 creation_operation entity。
- `blocked` 表示前方真实物理体阻挡；`none` 表示在声明范围内无命中；`fallback` 表示无法完整确定最近目标，并携带 `blockRaySelection=true`。fallback 时不能使用本次已扫描子集、旧目标，或直接选未知遮挡后面的 collider 冒充最近对象。
- mesh 命中与既有 stock entity 的归属应通过真实节点/祖先身份合并，不能仅比较坐标接近就认作同一物件。

## 预算与拒绝语义

每次最多检查 512 个遍历节点、64 个粗筛候选、单 BoxMesh 4096 个三角形、合计 16384 个三角形。最远 80 米并受相机 far 限制。超限一律 fallback，不截断后从剩余集合宣称最近。

BoxMesh 先读取内建的 subdivision 数值，设 w/h/d 为额外细分数加一，三角数为 `4 * (w*h + w*d + h*d)`；整数上界与总预算全部通过后才调用 get_faces。实际引擎夹具确认该计数与生成面数相同，超限 counts.facesRead 为 0。这个预算约束观察代码的读取与复制，不能阻止项目本身创建大资源。

首版没有 helper 几何缓存，每次取当前资源及 global_transform，因此不假设 RID 永远不可变；已验证原地修改共享 mesh.size 后结果即时更新。后续若增加缓存，须正确监听资源变化和失效，不能只按 RID。

建议仅在明确捕获时按需执行，HUD 轮询另做节流与帧耗时验收。本机 20 个独立 BoxMesh、240 个三角形的夹具，50 次重复均值约 0.24 毫秒；这不是复杂场景或用户设备的性能保证，最大预算场景尚未做产品帧率验收。

## 保守降级

- hidden 树、相机不包含的 render layer、仅投射阴影的几何直接排除。
- ArrayMesh（含 BlendShape/LOD）、MultiMesh、负缩放、Skin、可见距离/父级依赖等不在首版选取范围。部分无法安全界定的类型直接全局 fallback。
- 普通透明材质及内建 Sphere/Capsule/Cylinder 不被当作命中；只用已知内建尺寸形成保守遮挡范围。若其可能位于已知命中之前，fallback；位于命中之后可继续返回前方真实三角。
- ShaderMaterial、项目脚本 Mesh/Material/Geometry 节点、overlay、顶点增长、billboard/fixed-size/FOV覆盖、自定义深度行为等可能改变可见几何，直接 fallback。检查 `get_script()` 在任何 mesh 虚函数读取之前完成；自定义资源夹具证明 observer 没调用 `_get_aabb`。
- Native Label3D 不是选取对象；以可围住其 billboard 的粗范围作为未知遮挡，不把文本包围盒或空白字形区域当作像素命中。项目脚本字体资源不执行。
- 未支持情况未来可使用明确的对象列表选择；本轮没有用伪造 position/normal 填充列表引用。

## 验证证据

`tests/mesh-pick/headless.test.mjs` 使用已核验 SHA-256 的 Godot 4.7.2、独立副本和临时用户目录运行 `probe.gd`。40 项引擎断言通过：最近三角/法线、隐藏与 layer、当前 camera、显式辅助排除、父变换、共享资源与实时修改、AABB假阳性不命中、薄片与背面剔除、透明/Shader/Skin、自定义资源虚函数不执行、ArrayMesh/BlendShape/MultiMesh、未知前后遮挡、节点/候选/单mesh/总三角预算、同位置多实例歧义以及真实 StaticBody3D 物理遮挡。

本轮最终证据目录：`D:/cm-promo-mesh-pick-0912/test-results/mesh-pick-GMvftd`。初次验证发现材质属性名是 grow 而非 grow_enabled，已按实际引擎修正。所有最终断言无失败；未使用浏览器、真实鼠标键盘、Pointer Lock、模型调用或个人存档。

API依据：[BoxMesh细分定义](https://docs.godotengine.org/en/stable/classes/class_boxmesh.html)、[三角线段相交](https://docs.godotengine.org/en/stable/classes/class_geometry3d.html)、[材质剔除与深度设置](https://docs.godotengine.org/en/stable/classes/class_basematerial3d.html)。另已在固定引擎确认 ArrayMesh 有 surface_get_array_len/index_len，可为后续扩展做复制前预算；本轮未因此宣称支持 ArrayMesh。
