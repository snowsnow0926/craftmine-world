# 林间入口预制场景

本轮将已验证的 Kenney 精选素材组合为可选安装的单一 `scene` 包：`cw.scene.forest-gateway`。它是人工设计的可复用场景，不代表模型自主生成效果。不修改已有世界、六组测试作品或用户存档；产品包装接线由总控集成。

七棵橡树和松树形成前、中、后景，门洞朝向局部正负 Z，22 丛草、10 朵红花、4 丛灌木与 4 块石头放在通道两侧。没有新增替代树木或建筑的方盒，也没有增加地表网格。光照仍通过独立 `cw.environment.natural-daylight` 安装，场景内不包含太阳、环境、玩家或输入逻辑。

原始 GLB、纹理、最小无 LOD 导入配置和许可文件逐项按原精选清单校验 SHA256 并保留字节。所有依赖置于一个 addon 命名空间；子素材去掉各自身份脚本，只在组合根上保留 `entity_id: String`，使用新的引擎生成 UID。内部物件仍有清晰的 Node 路径。

固定 Godot 4.7.2 的真实 headless 导入和加载通过：160 个场景节点、48 个网格、6,040 个三角形、564 个碰撞三角形，0 个 LOD surface，外部城堡纹理正常加载。整体实际尺寸约为 12.807 × 6.668 × 18.374 米；原点按整体几何底部中心校准。

门洞首次草案偏窄，已在预制布局中增加均匀缩放。原模型柱脚使宽度边界比中部开口更窄，因此声明保守的 1.4 米净通行带。半径 0.3 米、高 1.8 米胶囊沿中心及左右偏移 0.4 米三条路线共 213 次查询全部通过；门柱和门楣射线仍会碰撞。更宽的偏移探索发现柱脚碰撞，未放松碰撞或把那组失败算作通过。

实际固定 `scene_mesh_picker.gd` 扫描整场景：162 个节点、48 个候选、6,040 个三角形，成功命中 `Trees/OakFrontLeft/Visual/tree_oak`；穿门洞射线返回 `none`，没有将包围盒当作实心门。该组件单份在现有限定范围内；多个实例叠加仍受世界整体拾取预算约束。

最终报告：`D:/cm-forest-gateway-prefab-0912/test-results/forest-gateway-engine-PuRXRN/report.json`。复验命令：设置 `CRAFTMINE_GODOT_CACHE_DIR` 为已锁定的主仓 Godot 缓存目录后，运行 `node tests/forest-gateway-engine.mjs`。所有测试使用独立目录，无模型调用、操作系统输入或前台窗口。

`component.json.sceneContract` 中的 `recommendedCamera`、`recommendedLookAt`、`gateCenter`、`pathStart` 和 `pathEnd` 均为局部米单位坐标。真实产品截图和最终观感由总控验收；headless 几何检查不替代视觉评价。
