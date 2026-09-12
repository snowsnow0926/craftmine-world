# 原创普通犬与白博美视觉原型

基线 `402c887a`，独立工作区 `D:/cm-canine-resource-0912`。本批只交外观资源与独立加载/渲染证据，不修改真实作品、产品注册或行为组件。

## 来源与制作条件

保留此前官方 Drive 配额失败记录 `QUATERNIUS_CANINE_DOWNLOAD_BLOCKED_2026-09-12.md`。再次检查作者[官方 itch 主页](https://quaternius.itch.io/)，动物入口仍为旧六动物农场包；它不是包含柴犬/哈士奇的 Ultimate 包。Ultimate [官方网站](https://quaternius.com/packs/ultimateanimatedanimals.html) 的实际下载仍指向同一 Drive，没有找到该包的其他官方公开下载。没有绕过登录、付费或配额，也没有使用不明转载源或把巴哥换白冒称博美。

本地 Node 24.14.0、锁定 Godot 4.7.2 与 Web 模板已存在。PATH 和常见安装目录没有发现 Blender，因此未安装新工具。总控批准后，使用可编辑 Node 建模源创建真实三角面 GLB：自定义躯干/头脸截面、耳片、脚掌与连续变径尾部，不读取或改造六组模型产物，不使用外部图片代替 3D。

`scripts/generate-canine-visuals.mjs` 保存几何、色板、关节与动画参数；`node scripts/generate-canine-visuals.mjs` 可确定性重建两个 GLB 与来源 manifest。`desktop/godot/components/canine-visuals/LICENSE.txt` 为本批原创网格/生成源/数据提供 MIT，允许随成品及作品导出源素材；不重新授权客户端或第三方内容。

## 资源接口

目录：`desktop/godot/components/canine-visuals/`。

| appearanceKey / GLB | 原始字节 | 三角形 | 实际 MeshInstance | 静止尺寸 X/Y/Z（米） |
| --- | ---: | ---: | ---: | --- |
| `dog` / `dog.glb` | 126696 | 1472 | 7 | 0.388 / 0.758148 / 1.398 |
| `pomeranian-white` / `pomeranian-white.glb` | 137208 | 1656 | 7 | 0.363 / 0.467998 / 0.622323 |

两者脚底 Y=0、上方 +Y、前方 -Z，以米为单位。普通犬为长躯干、垂耳、较长吻部；白博美独立建模为紧凑躯干、短腿、尖耳、短吻、厚颈鬃和贴背卷尾，不是普通犬材质替换。首次博美珠串尾/过圆两颊/小眼睛经过实际图片审阅，改成同一个连续 tail mesh，眼睛略大前移、缩小两颊；首轮图保留。

每犬为躯干、头（耳/眼/鼻合并为多 surface）、尾、四肢共 7 个刚性网格。静态细节没有各自增加 MeshInstance；无需放宽全场拾取预算。所有网格为 ArrayMesh/StandardMaterial3D；原始 GLB 自包含，无纹理、外部 URI、脚本或 shader。旁置最小 `.glb.import` 仅禁用自动 LOD。

导入后根场景可直接 PackedScene 实例化，内部为 `PetVisual` 节点与 BodyPivot/HeadPivot/TailPivot/ForeL/HindL/ForeR/HindR。运行组件在自己固定的 VisualPivot 下切换这两个场景，entity_id、碰撞及进度应留在行为根；本外观资源不自行管理这些状态。

两个实际动画名均为 `idle`（2.4 秒）与 `walk`（0.8 秒），原地循环姿态、四肢/头/尾节点关键帧，**不是骨骼蒙皮动画**，没有 Skeleton3D。Godot 原生导入 `loop_mode=0`，glTF extras 中的循环意图不会自动设置引擎循环；运行组件应复制每实例的动画资源后，将这两个 clip 设为 LOOP_LINEAR，避免修改共享资源。已告知行为 agent，资源不偷偷执行额外行为。

视觉 AABB 包含头尾，不能用胶囊身体碰撞宣称全视觉永不入墙：普通犬 X范围[-0.194,0.194]、Z范围[-0.678,0.720]；白博美 X范围[-0.1815,0.1815]、Z范围约[-0.34575,0.276573]。manifest 包含可复核的 restBoundsMetres、毫米尺寸与当前原文件 SHA。

## 真实导入和图像证据

`tests/canine-visuals-native.mjs` 使用既有 `createGodotProbeEnvironment`：核对锁定引擎/模板 SHA，复制到独立 profile，使用可信原创测试项目导入和 Compatibility Web 导出。浏览器为独立 headless Chrome，初始化禁用 Pointer Lock 与焦点调用；不发送 mouse/keyboard/click/fill。测试只通过自有页面的有限展示回调切换动物、相机角度与动画相位，不访问产品或玩家档案。

最终报告：`D:/cm-canine-resource-0912/test-results/canine-visuals-Bts41J/report.json`，`passed:true`。真实导入均为 7 mesh、0 Skeleton、0 LOD surface；Idle/Walk 均存在并确实改变节点 transform，最终各为 11 个导入轨道。Web 产生 12 张真实 960×800 PNG，正面、3/4、侧面、背面，以及 walk 0.25/0.75 相位。几何/材质与已审阅的 tNu2k9 版本一致，最终仅增加下述 walk 抬脚补偿；图像不是生成示意图。

- 普通犬：同目录 `dog-three-quarter-idle-0.png`、`dog-side-idle-0.png`。
- 白博美：同目录 `pomeranian-white-front-idle-0.png`、`pomeranian-white-three-quarter-idle-0.png`、`pomeranian-white-side-idle-0.png`。
- 动画：同目录 `pomeranian-white-three-quarter-walk-0.25.png`、`pomeranian-white-three-quarter-walk-0.75.png`；可见四肢交替，不把移动整个模型冒称走路动画。

保留迭代证据：FnOE5y 首次导入通过，但独立 export preset 缺 include/exclude_filter，导出判失败；补全后 cMeRWQ 通过但原生网页 canvas 默认300×150；buZuW7 为960×800且白毛/浅背景过曝；6KrWjf 改布光/底色清晰但博美珠串尾待改；Hk2Xxy 为连续尾中间版；tNu2k9 使用连续尾及眼颊修正并获首版外观认可；yPzopl/QFEYFt 为抬脚补偿前的实际运动范围。所有这些目录都在同工作区 test-results 下，没有改写旧报告。

## 动画包络与互动约定

`motion-evidence.json` 保留最终原生引擎逐顶点测量与对应 GLB SHA，`manifest.json` 中每项 motionEnvelope 列连续时间的解析保守界与假设。两个 clip 均采全部原生关键帧、相邻 key 中点及每 1/240 秒均匀点：Idle 664 姿态、Walk 239 姿态；普通犬 3,987,648 次顶点采样，博美 4,486,104 次。样本界不是任意时刻证明；另给下述解析界。

| 外观 | 实际样本最大水平半径 | 最终样本 Y范围 | 解析水平半径上界 | 解析 Y范围 |
| --- | ---: | --- | ---: | --- |
| dog | 0.721100390 | [0, 0.758147895] | 0.737791133 | [0, 0.758157913] |
| pomeranian-white | 0.345766783 | [0, 0.467997968] | 0.345776805 | [0, 0.468007973] |

解析方式：躯干仅沿 Y 平移，头绕 Y、尾绕 Z、腿绕 X；使用每个顶点的旋转轴圆轨道以及三角不等式约束 XZ 半径。尾部 Y 极值在实际 ±0.23/±0.17 弧度区间内求导取端点和临界点；腿的 Y 用完整圆轨道保守包络。包络包含原 GLB 的均匀缩放，半径/Y上界增加10微米数值余量。离线测试核对真实动画只使用上述轴、尾角度和位移范围，所有真实采样也逐项落入解析界。此界适用于 clip 内关键帧之间的连续插值，不把离散样本冒充完整证明。

补偿前 Walk 的脚掌会低于Y0：普通犬约2.34毫米、博美约5.34毫米，原报告保留。根据总控要求，只在 Walk 的四腿 translation 增加普通犬本地3毫米、博美本地8毫米（含GLB比例后为6毫米），不常驻抬整只宠物，不改根/VisualPivot，也不改变 Idle。补偿后 Walk 最低Y分别为 +0.000661433、+0.000659347 米，Idle仍精确接地Y0；解析下界同样为0。

行为 agent 已明确互动不额外摆动 VisualPivot、不加偏移/缩放，互动仅改变反馈/计数并继续当前 Idle/Walk；朝向只在实体根绕Y，水平圆半径不变。因此 CylinderShape3D 可取普通犬 radius=0.75、height=0.80，博美 radius=0.36、height=0.50，centerY=height/2，均留余量且底面0。这里只提供可用于碰撞配置的几何界，尚未验证实际跟随/碰撞玩法。以后新增互动摆动、非Y根旋转、缩放、跨clip混合或新动画，需重新核对包络，不能无条件沿用。

当前完成的是两个小而完整的原创视觉原型、真实导入和 Web 渲染。未把它们直接注册成产品预制模块，也不宣称跟随、抚摸、保存、碰撞或玩家愿望已整体通过；行为/选中/成品集成由各自负责路径另验。
