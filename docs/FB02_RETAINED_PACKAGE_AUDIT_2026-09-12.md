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
