# FB02 保留世界与 Windows 交付复查

用户实际运行的是 `2dc7748e570a` 便携包，反馈“没有加载画面没有进入全屏，地板颜色没有改变，F2 ESC 均无效”。该反馈有效；不能再仅凭包内包含某段新源码宣布修复成功。

## 已确认的问题

1. 保留世界启动先等待 `world.open` 完成，随后才挂载视图。这个 RPC 会等待原生 Godot 加载结束，所以挂载后的加载提示覆盖不到最初的黑屏。现将带进度条的加载卡片放在插件 HTML 第一帧，并在挂载之前接收资源校验、引擎启动和场景恢复状态。没有真实百分比时显示不定进度，不编造百分比；错误必须结束动画并显示具体失败。
2. 游玩工作区占满客户区域不等于系统全屏。原包实际 `isFullScreen=false`。新版通过幂等原生动作进入全屏，避免依赖可能错过的初始窗口事件。
3. 玩家保留世界仍运行自己的旧正式构建。替换应用模板不会改变它；其真实渲染确实是用户图中的亮青地面。新版仅对完整哈希确认的发行 stock 脚本建立独立修复分支，实际构建校验后通过已有存档/候选应用事务自动采用。主分支未采用草稿、历史、自定义源码和存档均保留。自定义脚本不自动改色。
4. 原包部分 F2 回调实际上可工作，未完整复现物理按键失效条件。新版统一主窗口原生 F2 路径，并补充更换原生子视图时的输入交接。对话关闭后的 Esc 增加真正的暂停、设置、返回工作台、保存退出菜单。

## 验证原则

- 只读复制玩家世界、内容仓库和布局；SQLite 用一致性备份。所有运行写入独立 `test-results` profile，未启动真实玩家 profile，未发送系统鼠标键盘、Pointer Lock 或置前窗口。
- 真 Electron 窗口始终隐藏、不可聚焦；检查真实全屏状态、原生子视图顺序、实际渲染内容和存档退出结果。
- Playwright 默认 CDP 会污染隐藏页面的焦点状态，已用真实 Electron A/B 证明。审计连接改为 `noDefaults:true`；产品焦点安全检查没有放松。
- 加载协议单测、真实 HTML/React 检查、真 Godot 渲染、真 Rust 分支事务、完整桌面运行分别记录，不将一个层面的结果冒充另一层。

## 开发构建证据

- `test-results/desktop-native-fb02-WmsM1e`：旧世界在真实执行器中导出、校验 passed、维护 applied，新正式构建 `gbd-7f7cfc1c4e6a9254386e191cb5b9d81b07e00831a29b9f9c47cc17a55bb698a9`。退出 0，无输入、页面或保存违例。该次末尾捕获器要求 1280×720，却收到全屏 2560×1440，因此捕获失败，不能把该报告当最终游戏截图验收。
- `test-results/desktop-native-fb02-xFfD9V/shortcuts-development-report.json`：实际全屏 2560×1440；主原生、主 DOM、插件、Godot F2 打开并绘制对话；Esc 关闭对话、暂停及恢复；菜单保存退出 0。
- `test-results/godot-startup-loading-83rRZd`：加载 HTML 和真实控制器 13 项通过，包括 `world.open` 尚未返回、挂载后 RPC 失败及恢复。
- 最后集成复跑 `test-results/desktop-native-fb02-rBgZJn/retained-world-report.json` 为 `passed:true`：真实启动进度可见，旧世界自动构建并应用，`adopted-world.png` 已逐图检查，地面为柔和绿色，退出 0，焦点请求、页面错误、保存失败均为零。该复跑抓出了启动 `candidateClose` 被误认为新玩家写入并取消维护的回归；已明确区分启动收尾/同世界重开与真正的切换、创作或采用操作。
- 旧地面与修正地面同视角真实渲染、精确源码判定和草稿保护详见 [地面审计](FB02_GROUND_RUNTIME_AUDIT_2026-09-12.md)。快捷键物理输入边界详见 [沉浸审计](FB02_IMMERSION_RUNTIME_AUDIT_2026-09-12.md)。

## 发布门槛

Windows `preview.16` 必须从干净 Git 提交构建；运行时资源 hash、源码档、ASAR、安装包和便携 ZIP 走现有校验与封装流程。封装后再次运行：

```text
node tests/fb02-packaged-retained-world.mjs APP_DIRECTORY SOURCE_PROFILE WORLD_ID
node tests/fb02-packaged-shortcuts-native.mjs APP_DIRECTORY ISOLATED_TEST_DIRECTORY --expect-fixed
```

第一条从只读副本验证保留世界首次加载、真实自动修复和最终渲染；第二条使用同一个已完成升级的隔离副本验证快捷键、全屏、暂停和保存退出。最终包路径及结果另行追加。反馈状态保持“工程修复，待真人复测”，不自行登记为玩家验收通过。

## preview.16 最终成品结果

- 产品源码提交：`6fb1dc01b4e364227d01e8ac47ca323131b93d0b`。本节与测试截图是封装后的审计证据，不改该成品。
- 发布目录：`D:\Craftmine World\desktop\build\releases\6fb1dc01b4e3-de84cc42-3599-4468-a3cf-c6bf493bb23f`。
- ZIP：该目录下 `portable-72b75b74-1834-40db-9e61-21619ce29ed4\Craftmine-World-portable-6fb1dc01b4e3.zip`，1,028,083,279 字节，SHA256 `62d8b8fd803a1b235a0e18efbd9722554d468d231cdf3398cfd8f012a44194c0`。
- 安装包：`output\Craftmine-World-Setup-0.14.4-preview.16.exe`，SHA256 `a0f42be2a196688c8f21b04044e36a32fb2cbcf5c8ecd91c2fc88f3b8866153e`。
- 安装包完整载荷校验通过；ZIP 全部 1,656 个载荷文件在解压后与封装证据一致。测试启动的是这个 ZIP 的 `extracted\Craftmine World.exe`。
- 81 项相关单元/事务/焦点策略测试、TypeScript 检查通过；加载 HTML/控制器 13 项、独立 React 暂停菜单验证另行通过。这些数字不包含旧版 304 项历史结果。

**真实旧世界首次运行**：`test-results/desktop-native-fb02-ZNyMrV/retained-world-report.json` 为 `passed:true`，真实加载进度可见，维护构建通过并自动采用，新正式构建 `gbd-fef3d5fdc40ab26f3b398ce3dddc722f8aae36bc39ca3edfddf3f122573791dc`；世界状态 `ready`，2560×1440，焦点/Pointer Lock 请求为零，正常退出。地面截图已逐图检查，原相机视角保留，地面为柔和绿色。

**存档与草稿**：同副本的 `profile/ground-retained-audit.json` 确认 gameplay snapshot 和 extensions 完全相等；两个 main 分支 head 不变，全部 7 个旧提交仍在。原玩家 profile 未被启动或修改。首次打开精确旧 stock 世界时会自动做一次构建升级；自定义脚本保持不动。

**F2 / Esc / 全屏 / 保存退出**：`test-results/desktop-native-fb02-rBgZJn/shortcuts-package-report.json` 为 `passed:true`。四条 F2 路径均显示实际对话并正确排列原生子视图；Esc 菜单让宿主 `paused → ready`；菜单保存退出 code 0。页面错误、焦点违例和保存失败均为空。物理键盘和可见系统合成窗口仍未通过自动输入验收，不能将有限回调测试写成真人验收。

**实际加载卡截图补验**：`test-results/desktop-native-fb02-VYzlfG/retained-world-report.json` 再次为 `passed:true`。2184ms 捕获实际插件加载页：加载层 2560×1440、display:flex、visible、opacity:1、aria-hidden:false；进度条 370×7，祖先与 viewport 交集检查通过。该次也完成旧世界自动升级和正常退出，未修改成品。

成品截图：[加载画面](assets/user-feedback-20260912/FB02-preview16-loading-verified.png)、[地面](assets/user-feedback-20260912/FB02-preview16-ground-verified.png)、[F2 对话](assets/user-feedback-20260912/FB02-preview16-f2-verified.png)、[Esc 暂停菜单](assets/user-feedback-20260912/FB02-preview16-pause-verified.png)。菜单截图仅含主渲染图层，黑色透明背景不代表底层游戏画面消失。

## 本次复盘仍保留的开发事项

- **FB02-007：完整全自动尚未贯通。** 内置工具免权限卡已有修复，但 `creation-target-service.ts` 的每世界自动采用策略默认 false，`creation-auto-apply-service.ts` 会因此进入 manual；当前 UI 仍提供独立勾选。下一步需将用户所选全自动含义贯通到检查与正式应用，再走实际选中模型的普通创作流程验证。不得重复询问已经明确的授权，也不能称本次包实现了全部零操作。
- **FB02-005：工作台输入后世界消失** 仍需复现并定位布局/原生视图切换；此次系统全屏和子视图焦点修复不能替代该项验收。
- **FB02-004：世界入口的信息架构** 仍是待开发项。
- **FB02-008/009：预览与应用** 已有控制条和候选身份修正，仍需最终包完整预览→采用→返回路径证据。

因此本次结论仅覆盖上述已实测项目，FB02 批次整体没有结案。
