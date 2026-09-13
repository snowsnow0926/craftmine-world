# 当前 Windows 测试交付

当前已验收成品是 **`0.14.4-preview.21`**，Windows x64 未签名文件夹版。
程序源码提交为 `b8900d63f857eeff63c3125a0a534f9abdd403cc`，程序本体约
**2.19 GB**，包含 Godot、Blender 和四个示例世界。

## 取得和打开

本机保留目录：`D:/Craftmine Releases/PlayerLibrary-preview21-b8900d63`。
双击其中的 **`START-PLAYER-PREVIEW.cmd`**。它使用
`%LOCALAPPDATA%\CraftmineWorld-PlayerLibraryPreview21`，与旧测试档案分开；
再次运行会继续同一份 preview.21 档案，不会每次清空。请保留整个目录，
仅复制 `output/win-unpacked/Craftmine World.exe` 不能运行。

这里的磁盘路径只适用于交付电脑，不是 GitHub 下载链接。其他玩家需要取得完整
文件夹或另行打包的完整发行物。本记录不声称已有公开下载、签名安装器或干净
Windows 安装／升级／卸载验收。GitHub 源码 ZIP 也不是可运行的 Windows 成品。

## 第一次使用

1. 从原 PI Desktop 的“示例世界”打开博美、飞行、控雨或城市，等待准备完成；
   以后从“我的世界”继续。已有世界游玩不要求登录模型账号。
2. 使用 WASD 移动；F2 打开对话，Esc 暂停、切换世界或保存退出。首次示例副本
   准备实测约 23–31 秒、已有世界切换约 11–16 秒，只是本机样本，非速度保证。
3. 在“素材与作品库”查找内容；“保存对象”可保留名称、别名、用途和固定版本。
   **当前成品的素材详情加入操作仍通过 AI；新的直接加入入口正在开发。**
4. “保存世界模板”明确勾选保存进度后，可在“我的模板”创建独立世界或导出 ZIP。
   同处可以导入 `examples/matched-courtyard.zip`（庭院）或
   `examples/companion-and-rain.zip`（博美＋控雨）。模板导入／复制无需模型。
5. 若要 AI 创作，在设置 → General → World authoring backend 连接自己的兼容
   Codex CLI 和账号，核对选中的模型与思考强度。已验收模型为
   `gpt-6-astra / xhigh`；CLI 和开发者账号不随成品分发。

这是玩家手动操作说明。自动验证始终使用独立后台进程，不控制玩家鼠标键盘、
请求 Pointer Lock 或置前窗口。新玩家测试请使用独立测试档案，不删除个人存档。

## 版本与证据

- [六项工作包交付、功能边界与原生验收](PLAYER_LIBRARY_DELIVERY_2026-09-13.md)。
- [合并和空间清理记录](MAIN_MERGE_AND_SPACE_CLEANUP_2026-09-13.md)。源码已进入
  `main`，合并清理文档提交为 `475bc6a5`；它不是重新构建的应用版本。
- 成品目录内的 `seal.json`、`package-evidence.json`、`packaged-client-report.json`
  记录实际打包验证；`LOCATION.json` 记录搬迁位置。`run.json`、`DELIVERY.json`
  中旧工作树路径属于原始交付记录，不能当成当前运行路径。
- GitHub 默认分支仍为 `master`（2026-09-13 `git ls-remote --symref origin HEAD`
  只读核对）。当前源码请选择 [main](https://github.com/snowsnow0926/craftmine-world/tree/main)；
  调整默认分支仍待单独处理，本次文档更新不更改仓库设置。
- [下一阶段自主创作方案](FIRST_INDEPENDENT_CREATION_PLAN_2026-09-13.md) 和
  [真实新玩家评估包](FIRST_CREATION_PLAYER_EVALUATION_2026-09-13.md) 描述后续开发。
  **新增直接使用流程尚未包含在上述成品；真人及干净外部 Windows 结果尚未取得。**

## 历史交付

preview.20（`03bc893a0243a4845ef1865164dab26dcffcaeed`）已经被替代，
其 [复盘和原始证据](TWO_WORLD_PREVIEW20_RETROSPECTIVE_2026-09-13.md) 与
[双世界玩家说明](TWO_WORLD_PLAYER_GUIDE.md) 保留追溯。旧 ZIP SHA-256 为
`7cfa508d0d8daca6ad052ebb1238dc59591eb58b4eebf2d42af00f2aa4c5252b`。
旧程序及工作树已按清理记录处理，历史报告中的本地路径不保证仍可直接打开；
它们不再是当前下载或启动入口。
