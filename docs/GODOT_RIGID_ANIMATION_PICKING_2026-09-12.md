# 刚性分件动画的真实目标拾取

本轮解决首批宠物使用分件节点动画时，场景中出现 AnimationPlayer 就让整片森林网格拾取失效的问题。生产改动仅在固定 `scene_mesh_picker.gd`；没有修改底座持久化、交互适配器、宠物行为或玩家存档。

AnimationMixer、AnimationPlayer 和 Skeleton3D 节点本身不绘制表面，不能仅因为它们存在就全局拒绝。现在继续遍历其子节点，对每个实际可见 MeshInstance3D 使用当前原生 global_transform 和实际三角形。观察器不推进动画、不 seek、不调用项目脚本、不修改状态，也不缓存旧姿态。输出覆盖名称改为 `bounded-rigid-mesh-triangles`，仍明确 `pixelAccurate=false`。

原有几何、遮挡与预算没有放松：真实 skin、blend shape、Shader/位移、透明材质、动态 ArrayMesh、LOD、脚本网格、负缩放等继续走明确回退。不能用 rest pose、任意角色 AABB 或忽略未知遮挡来假造角色表面。非渲染 Skeleton 节点可以存在，不代表其蒙皮几何已得到支持；真正蒙皮出现时仍拒绝。

## 原生接口调查与选择

[Godot MeshInstance3D 文档](https://docs.godotengine.org/en/4.6/classes/class_meshinstance3d.html) 提供 `bake_mesh_from_current_skeleton_pose` 与 `get_skin_reference`。文档说明前者要求已注册骨架，会忽略 blend shape，且不复制材质。锁定 `4.7.2.stable.official.ed1daf0bf` 的实际 ClassDB 已确认这两个方法存在。

实际 headless 夹具建立了一根骨骼、Skin 和带骨骼权重的网格。SkinReference 存在，但当前渲染骨架 RID 无效，原生 bake 明确报错；不能把 native bone pose 的数值计算当作已验证的渲染蒙皮。最终调查入口在调用前检查真实 RID，记录 `registered-renderer-skeleton-unavailable`。报告：`D:/cm-dynamic-mesh-selection-0912/test-results/pose-api-8EB8gb/report.json`。这不等于断言正常 Web 渲染不能 bake，而是本批没有骨骼 posed 拾取的完整证据，因此不启用该分支。

首批狗与白色博美明确采用无蒙皮的分件节点动画，本次有限实现覆盖这一真实资产需求。后续若加入骨骼动画，应另行验证当前渲染姿态、材质、绑定和预算，不沿用本轮证据扩大支持声明。

## 验证

`tests/mesh-pick/rigid-animation.gd` 通过原生 AnimationPlayer 播放/推进位置轨道：开始时射线命中宠物分件的真实三角形；关节移出射线后，同场静态树仍被准确选中。重复观察不改变动画时间或关节姿态。另验证前方物理/网格遮挡、剔面、隐藏部件，以及透明、蒙皮、blend shape、Shader、负缩放仍明确拒绝。

锁定引擎的 17 项新增断言、44 项原 Box 拾取断言和 23 项 ArrayMesh 断言全部通过。证据分别保留在本工作树 `test-results/rigid-animation-IlRVSs`、`mesh-pick-cwvapi`、`arraymesh-pick-ZsWhtW`。这证明实际引擎分件动画的拾取，不冒充最终宠物外观、跟随、存档或玩家手感验收。

复验命令：设置 `CRAFTMINE_GODOT_CACHE_DIR` 指向锁定缓存后，运行 `node --test tests/mesh-pick/rigid-animation.test.mjs tests/mesh-pick/headless.test.mjs tests/mesh-pick/arraymesh.test.mjs`。全程独立 headless 项目，没有操作系统输入、Pointer Lock、前台窗口或模型调用。

64 个候选/512 节点/16,384 三角形等预算原样保留。完整森林已有 48 个 mesh，加底座约 49 个候选；若要求两犬同场，资产需合并不独立运动的细节，避免仅候选数量就超限。真实犬导入的最终规模与同场验收另行记录。

发布集成需按既有机制刷新固定 helper 的哈希与打包材料，并将创作指导里的笼统“动画不支持”改为本轮精确覆盖范围；由总控与底座状态改动统一更新。不得降低旧世界 observer 的完整性门槛。
