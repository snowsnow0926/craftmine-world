# 可选中性自然环境组件

## 已确认的问题与本次范围

环境组冷重开截图中，五棵树与地被站在大面积亮青色平地上，地面几乎没有纹理，花草的层次较弱。对应 `creation_world.gd:126` 起的默认环境使用青蓝天空/地平线、青蓝环境光（能量 0.7）、纯色地面；正午太阳能量为 1.1。以上是可调节的真实来源，尚未通过同机前后对照量化每项对最终像素的贡献，不能将视觉问题全部归因于某一个参数。

新增 `desktop/godot/components/natural-daylight/` 可选资源组件，不修改底座默认源码、六组作品或用户存档。三个 `.tres` 提供灰绿草土地面、低饱和石色边界与中性日光环境。地面使用 Godot 原生 256×256 噪声纹理，材质为不透明 StandardMaterial3D，没有位移或自定义 Shader。

`natural_daylight.gd` 只接受显式的 WorldEnvironment、地面网格、原太阳和可选边界网格，整体验证参数后应用。每次创建独立资源副本，避免跨世界资源缓存污染。太阳仅调整色调，不夺取时间业务对能量、方向和阴影的管理。它不自行遍历场景、注册启动代码、安装素材或迁移旧世界；总控后续经正式素材/源码采用链集成。

## 验证

运行 `tests/godot-components/natural-daylight.mjs`，从未修改的 stock creation-sandbox 复制出一次性工程，用实际锁定 Godot `4.7.2.stable.official.ed1daf0bf` 完成导入和 headless 加载。19 项断言通过：组件资源可加载，原完整进度、几何、碰撞节点、暂停和输入状态不变；原日照时间控制与进度恢复仍正常；参数错误不改材质；重复应用资源独立。文件 SHA 与声明逐项核对。

结果：`D:/cm-natural-daylight-component-0912/test-results/natural-daylight-VLCQrH/report.json`。未发送模型请求、未打开前台、未请求 Pointer Lock。验证仅证明资源和底座行为兼容，`visualVerified=false`；最终外观需通过集成后的真实产品截图确认，未生成或加工验收图片。

所有组件文本固定 LF，`component.json` 固定每个交付文件的字节大小与 SHA-256。资源及脚本为项目原创，附独立 MIT 许可，不包含第三方美术资源。
