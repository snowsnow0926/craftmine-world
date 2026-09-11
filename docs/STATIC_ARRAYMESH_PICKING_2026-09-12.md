# 静态 ArrayMesh 的有限真实三角拾取

## 改动

原托管观察器遇到任何 ArrayMesh 都返回全局 fallback，真实 GLB 导入后的静态树木和建筑因此不能通过该网格路径被选中。本次增加原生、无附加脚本的静态 ArrayMesh 支持；不修改六组世界、模型作品或素材字节。

每个网格最多 8 个 surface，逐 surface 解析实际的 instance override、surface override 或网格材质，并使用各自的剔面设置。只接受普通不透明 StandardMaterial3D、三角 primitive、无 skin/blend shape/骨骼格式/动态顶点标记的几何。AnimationMixer、Skeleton3D、LOD、透明、位移、自定义脚本及未支持材质仍返回明确 fallback。

先遍历并检查所有候选的原生顶点/索引长度、格式、材质与全局预算；单网格 4096 三角/12288 顶点，总计 16384 三角/49152 顶点。预算通过后才调用锁定 Godot 的 RenderingServer surface 元数据确认没有 LOD，最后复制并校验实际顶点、索引，按真实三角计算交点与法线。没有新增碰撞体、资源缓存、状态写入或脚本虚方法调用。

ArrayMesh 的 AABB 可由工程覆盖，不能作为跳过近处几何的依据。本实现对所有预算内的 ArrayMesh 验证真实数组，不用 AABB 假命中或排除潜在遮挡。相应代价是预算按已遍历的 ArrayMesh 计算，包括屏幕外几何；大量装饰可能仍明确回退，不承诺无限规模或逐像素拾取。

## 实际证据

锁定 Godot 4.7.2 headless 回归保持既有 44 项检查通过。新增夹具的 25 项检查覆盖索引与非索引三角、多 surface 洞口、各 surface 材质/剔面与覆盖优先级、伪造 AABB、透明/Shader/skin/脚本/动画/LOD 拒绝、单网格及总预算、未引用顶点预算。原始报告位于 `D:/cm-static-arraymesh-pick-0912/test-results/arraymesh-pick-XydUry/report.json` 和 `test-results/mesh-pick-VwbPcX/report.json`。

另外直接复制首批 Kenney 原始 GLB 到独立测试工程，执行真实导入，不改其字节或默认导入设置：

- `tree_oak.glb`：2 surface、196 三角，真实射线命中。
- `rock_smallA.glb`：2 surface、16 三角，真实射线命中。
- `wall-doorway.glb`：500 三角，但 Godot 默认生成 LOD；明确 `array-mesh-lod` fallback，读取面数组计数为 0。这不能被说成已经支持门洞选中。

资源来源仍以素材 agent 的固定哈希/许可目录为准。测试驱动通过显式 `CRAFTMINE_CURATED_COMPONENT_ROOT` 读取可用资源，原文件哈希记入测试报告；没有调用模型、启动前台、鼠标捕获或 OS 输入。

## 保护与发布

源码继续处于 `godot_creation_probe::files()` 固定保护集合，观察器内容变化自动进入 probe hash 和构建身份。没有放松缺失/不匹配检查或改写旧成品。指导升至 1.6.2 并正常重建文本哈希，说明受支持范围与导入 LOD 边界。分发内容 pin 使用既有 `refresh-authored-pins.mjs`，由完整冻结源码生成。
