# 当前 Windows 测试交付

当前版本为 **0.14.4-preview.22**，基于原 PI Desktop 的 Windows x64 免安装测试版。
程序源码提交为 `20aad1fb7ec3fef14e1dbbc9fae0ab120b0195b8`，程序本体
2,188,090,237 字节（约 2.19 GB），包含 Godot、Blender、四个示例世界与素材库。

完整 ZIP 为 `D:/Craftmine Releases/FirstCreation-preview22-20aad1fb.zip`，
1,127,972,077 字节（约 1.13 GB）；含说明与模板的完整目录约 2.21 GB。
ZIP SHA-256：`2325dde3a4be7a39d47a82309397987f52e9c3075187cf92a28378183e78ef10`。
实际解压后的 8,451 个文件已逐一比对一致。

## 打开与开始使用

完整解压发行 ZIP，双击根目录的 **START-PLAYER-PREVIEW.cmd**。
本机交付目录为 `D:/Craftmine Releases/FirstCreation-preview22-20aad1fb`。
请保留完整目录，不要只复制 EXE。首次使用从“示例世界”或“新建世界”开始。

启动入口使用 `%LOCALAPPDATA%\CraftmineWorld-FirstCreationPreview22`；再次启动会继续
同一份档案，与 preview.21 试玩档案分开。无需先登录模型账号即可游玩、直接使用
兼容素材或导入模板。需要自然语言创作时，在设置中连接自己的 Codex CLI／账号，
并核对实际选中的模型和思考强度；CLI 和开发者账号不随包分发。

侧边栏“首次创作指引”覆盖打开／新建、素材加入、受支持的编辑、保存重开及分享。
参见 [简明操作指南](FIRST_CREATION_QUICKSTART_2026-09-13.md)。已有世界没有可信创作
对话时可点击“开始创作”，无需先发消息。需要升级观察组件时，使用界面明确提供的
“更新世界观察组件并检查”。任意导入的 GLB 不自动获得尺寸／颜色参数编辑能力；
完整闭环实际使用原有“在此放置”创建的树完成参数修改。

## 随包可复用内容

在“素材与作品库”→“我的模板”导入 `examples/` 中的 ZIP，再创建独立世界：

- `matched-courtyard.zip`：已验证的庭院组合。
- `companion-and-rain.zip`：博美与控雨组合。
- `first-creation-pom-tree.zip`：本版实际创作、编辑、保存并由独立档案导入过的博美＋树木世界。

这些是完整客户端使用的世界模板，不是独立游戏 EXE。导入模板和直接使用兼容素材
无需模型；原有 AI 修改入口保留。将自己的作品保存为世界模板时，需要明确选择是否
把已保存进度作为新世界起点，再从“我的模板”导出给朋友。

## 版本与验证

实际成品已完成新档案创作、空会话冷启动、放置与编辑、保存、导出、独立档案导入
游玩和再次冷启动的完整自动验证，模型调用为 0。本机该轮自动闭环约 4 分 8 秒；
直接加入博美的准备约 30 秒、采用约 5.4 秒。这是单次自动样本，不是真人完成时间。

`DELIVERY.json`、`seal.json`、`package-evidence.json` 记录成品身份；`EXTRAS.json`
记录附带材料的固定哈希。发行 ZIP 同目录下的 `.zip.sha256` 和 `.zip.json` 记录 ZIP
校验值及实际解压逐文件比对结果。证据内保留原构建路径，不是当前启动入口。
源码在 `output/win-unpacked/resources/source/`，Blender 对应源码在
`resources/blender/source/`，已有第三方说明在 `resources/licenses/`。

这是未签名的本地预览版，没有公开下载链接、签名安装器或干净外部 Windows
通过记录。5–8 位真实新玩家测试仍待执行；[评估包](FIRST_CREATION_PLAYER_EVALUATION_2026-09-13.md)
与[逐人记录](templates/FIRST_CREATION_SESSION.md)已准备好，未填造参与者结果。
GitHub 默认分支与远程发布不由本次开发自动修改；本轮提交合入本地 `main`，尚未推送。

[完整交付、成品验证与收尾记录](FIRST_CREATION_COMPLETION_DELIVERY_2026-09-14.md)与
[原生创作及旧世界升级证据](FIRST_CREATION_PACKAGED_ACCEPTANCE_2026-09-14.md)区分
实际程序源码提交、后续测试脚本和文档提交。ZIP 内说明生成于封包时；上面的 ZIP 哈希
记录于封包完成后，没有再改写已验证的发行物。

preview.21／`b8900d63` 及原有演示归档继续保留，历史结论不能替代本版成品验证。
