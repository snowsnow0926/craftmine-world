# 中性自然日光（可选源码组件）

适用于希望从高亮青色平地转为温和草土与自然日光的 Godot 3D 场景。资源是项目原创的 StandardMaterial3D、程序化天空和小尺寸噪声纹理，无图片下载、ShaderMaterial、透明或位移效果；适配本项目 Godot 4.7.2 / Compatibility 路径。

## 接入

将本目录完整复制到工程中的同一目录，保留文件相对关系。读取实际场景源码，取得要修改的 **WorldEnvironment、可见地面 MeshInstance3D、现有 DirectionalLight3D**；在它们创建后显式调用：

```gdscript
const NaturalDaylight = preload("res://components/natural-daylight/natural_daylight.gd")

# 这三个变量必须绑定工程里实际创建的节点，不是约定的节点名。
var problem := NaturalDaylight.apply_to(environment_node, ground_mesh, sun)
if not problem.is_empty():
    push_error(problem)
```

可选第四参数是明确选中的边界可见网格列表。未传入的模型、树木和建筑材质不变。底座当前在 `_build_environment()` 内动态创建地面和 WorldEnvironment，不能假定它们有固定节点名；集成时保留真实引用，不按“第几个子节点”定位。

只更换指定节点的材质、环境资源与太阳色调；不增加或移动几何，不改变碰撞、遮挡、玩家输入、默认时间或存档。太阳方向、能量和阴影仍由原世界控制，`set_time()` 与进度恢复可以继续正常更新太阳。重复应用会创建独立资源副本，不共享可变调色状态。

这是显式选择的外观预设，会替换被选 WorldEnvironment 的原环境设置。已有自定义雾、天空等需要保留时，应先审阅并合并所需字段，不直接整体应用。

通用 helper 不会自行寻找世界或自动生效。配套的 `creation_sandbox_preset.gd` 用于玩家主动选择的内置素材包：宿主先验证标准造物底座源码哈希，采用后在父世界初始化完成时绑定唯一环境、地面和四面边界，再调用同一个 helper。缺少或重复目标时不修改资源。安装动作是明确的外观替换，不是启动时迁移所有旧世界。

## 外观意图与限制

- 灰绿草土与低对比度噪声形成地面层次，避免把整块平地染成亮青色。
- 降低青蓝环境染色，保留较暖的直射光与阴影，使草、花、石头轮廓更容易区分。
- 不开启仅部分渲染后端支持的 SSAO、辉光或体积雾。
- 预设不承诺修复模型造型、密度、精准拾取或所有场景曝光；应通过实际产品中的采用和截图判断最终效果。headless 加载与状态测试不是画面质量验收。

资源与脚本按本目录 LICENSE.txt 的 MIT 许可提供。所有纹理由 Godot 噪声资源生成，无第三方美术资源。
