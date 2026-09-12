# 精选静态素材首批

本目录提供 16 个真实模型、26 个可实例化包装场景和清晰的来源清单，供既有 `packStaticPackage` 打包与 `asset.import` 注册使用。`manifest.json` 是内部素材构建清单，不是新的公共安装包协议。

素材原文件来自总控下载的 Kenney Nature Kit 2.1 和 Castle Kit 2.0。全部 GLB 保持 ZIP 内原字节，来源页面、ZIP 名称/大小/SHA-256、文件原路径/大小/SHA-256 和版本均在清单中。两个 ZIP 的原始 License.txt 原样保留为各自 CC0 声明。原创包装场景和仅导出 `entity_id: String` 的公共脚本另附范围明确的 MIT 许可证，不重新授权客户端或第三方内容。

| 组别 | 内容 | 用途 |
| --- | --- | --- |
| 自然 | 橡树、繁茂阔叶树、圆冠松树 | 约 4.9–5.5 米高的静态环境树木 |
| 地表 | 草丛、红花、灌木、小岩石 | 约 0.5–1.2 米的小型地表装饰 |
| 木结构 | 木桥、木围栏 | 约 3 米模块，用于道路或场景边界 |
| 城堡 | 城墙直段、转角、门洞、木门、方塔基座/中段/垛口 | 分块拼接的静态建筑结构 |

每项 `entryScene` 使用 `res://addons/<资产ID>/...` 路径，完整相对文件集合在 `files`。根节点只承载实例标识，没有 `_ready`、AI、采集、机关或战斗行为。静态木门没有开门功能；塔段应按尺寸叠放，不是整栋城堡。

身份脚本代码相同，但每包使用 `scripts/<资产ID>.gd` 和独立 `.gd.uid`。16 个稳定 UID 来自第一次实际引擎导入，回收到各包后再次完整导入通过，避免公共脚本固定 UID 在多个 addon 中冲突，也满足现有草稿安装器的脚本 UID 要求。

Nature 的 9 个 GLB 自包含；Castle 的 7 个 GLB 使用同目录 `Textures/colormap.png`，该图片已原样保留并列入每个城堡组件文件依赖，不能省略。已核对官方包内预览，选择统一低多边形、暖木色/砖色与青绿植物风格；不重画原模型或覆盖材质。

## 尺寸、碰撞与成本

原 GLB 保持自身节点变换；包装场景统一接地到根节点 y=0，水平中心对齐根节点。清单记录原始边界、包装缩放、毫米整数尺寸与偏移。默认树木、草花和灌木均可穿过，未用整片树冠的粗略碰撞堵路。

岩石、桥、围栏及城堡模块默认带静态三角网格碰撞，同时提供 `visualScene` 无碰撞版本。碰撞从原 mesh 的真实三角形及节点变换派生，不封死门洞或栏杆间隙，只用于 StaticBody3D，不适合高速动态刚体。它们不被宣称为完整导航或玩家通过性验证。

16 个 GLB 共 225,584 字节、2,700 个三角形。总文件/字节数由 `manifest.totals` 给出，包含共享纹理、许可、身份脚本及碰撞/视觉包装；导入后的具体节点、材质及纹理统计另见 `engine-validation.json`。

## 已完成验证与限制

使用项目既有 `createGodotProbeEnvironment`：核对锁定 Godot 4.7.2 引擎哈希，在独立 headless profile 中仅运行本仓可信静态夹具。26 个场景均真实导入、实例化、身份赋值、材质加载成功；尺寸、接地高度、三角数与静态碰撞三角数符合清单。门洞穿透射线为空，门柱及门楣实际射线命中，证明碰撞没有用 AABB 封洞。没有运行用户生成代码、OS 键鼠、前台窗口或 Pointer Lock。

Godot 默认导入曾为 6 个入选模型自动生成 LOD（松树、草、木桥、门洞、木门、塔基座），按场景重复统计为 13 个 surface。这与原 GLB 不含 skins/animations 是两回事。为保持这些低多边形素材的最高细节，现每个 GLB 随包携带最小 `.glb.import`：只声明 scene/PackedScene 导入器和 `meshes/generate_lods=false`。不携机器路径、缓存目标、UID 或 `.godot` 内容；GLB 原始字节和许可不变，派生配置单独列在每项 `importConfiguration/files`。

这份配置由普通 Godot 导入器处理，玩家、Web、测试使用同一路径，没有 headless 分支，也没有运行时修改 mesh 的脚本。全新无缓存工程复验 26 个包装全部导入、纹理与碰撞正常，实际 LOD surface 数从 13 降到 0。GLB 原字节不变、参数在引擎重写后的 `.import` 中仍保留为 false。

上述原生静态导入未经过完整产品 broker 的 expectedFiles/PCK 验证；Godot 会扩写 `.import`，不能仅凭这项成功就宣称托管安装检查通过。一次普通包安装夹具尝试在其准备阶段遇到 `INVALID_WORLD_ID`，尚未到达包安装，不能据此判断 sidecar 的托管安装结果。该层及精准对象选择交由总控在新成品真实复验，不放宽生产观察器的信任或几何校验。

复建：`node scripts/build-curated-starter.mjs <保存原 ZIP 的绝对目录>`。验证：`node --test tests/curated-starter.test.mjs`；实际引擎验证：设置现有 `CRAFTMINE_GODOT_CACHE_DIR` 后运行 `node tests/curated-starter-engine.mjs`。修改清单/包装后需要重新执行引擎验证并更新对应记录。
