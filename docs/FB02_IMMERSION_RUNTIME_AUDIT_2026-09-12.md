# FB02 全屏、F2 与 Esc 运行时复查

## 对原 `2dc7748e570a` 便携包的检查

使用用户实际解压目录中的可执行文件、独立 headless 数据目录，以及用户保留世界和 Local Storage 的副本。没有操作用户正在运行的窗口，没有发送系统鼠标/键盘输入，没有调用 `sendInputEvent`、窗口激活或 Pointer Lock。

- 原包进入游玩后，真实 Electron 窗口 `isFullScreen=false`，尺寸仍为 `1200×800`。原包没有自动进入系统全屏的实现；工作区占满不等于系统全屏。
- 在独立进程中直接调用 Godot/WebContents 注册的原生按键回调，F2 经 IPC 抵达 React 后能打开 `compact` 对话；主渲染 DOM 路径、插件原生 F2 路径也能工作。
- F2 后真实原生子视图次序由 `[主渲染, 插件, Godot]` 变为 `[插件, Godot, 主渲染]`，主渲染截图中能看见实际对话控件。因此本次并没有复现用户物理 F2 按键无响应的全部条件，不能把模态入口或 IPC 通道断链当作已确认根因。
- 原包在对话已关闭时按 Esc 只返回工作台，没有反馈要求的暂停/设置/退出菜单。

原包运行证据位于 `test-results/desktop-native-fb02-xFfD9V/shortcuts-original-report.json`。原包首次窗口为 `1200×800`，复用隔离测试窗口配置再跑后为 `1204×802`，均没有进入系统全屏。报告及截图使用 original/development/package 前缀分别保留。

## 修正

- 进入游玩使用幂等的 `enterFullScreen` 原生动作，不依赖可能早于 React 订阅的初始窗口事件，也不使用 `toggle`，避免重复调用反向退出。
- 保存过的创作和游玩布局均可恢复；新配置仍保留首次模式选择。修复同一个保留世界恢复自动游玩时被导航层提前返回的情况。
- 主渲染的原生 F2 与插件、Godot 使用相同有限动作通道，消费原生事件以免后续 DOM 再切换一次。Esc 保留 DOM 高层菜单和输入法的处理顺序。这是路径一致性增强，不是对用户物理按键失效原因的定论。
- 补齐可见子视图替换时的内部焦点交接。此前焦点同步只发生于主窗口获焦或沉浸状态改变，新 Godot 实例挂载后没有对应交接；焦点若仍归旧实例，旧实例的可见性守卫会拒绝快捷键。新同步器只在输入 owner 改变时工作，保留高层对话框优先级；每次内部交接均要求宿主窗口已经获焦且不是 headless，绝不主动显示或激活主窗口。这个代码缺口已补齐，但它是否造成用户本次物理按键失效仍未证实。
- 对话关闭后的 Esc 打开可信主渲染暂停菜单：继续游玩、回到工作台、设置、保存并退出。打开菜单使用现有 immersion 暂停路径。退出调用 `app.quit()` 的既有有序保存流程，不继承关闭到托盘的偏好。

## 开发构建的实际验证

`tests/fb02-packaged-shortcuts-native.mjs --development --expect-fixed` 在独立保留世界副本中运行，报告为 `test-results/desktop-native-fb02-xFfD9V/shortcuts-development-report.json`，`passed=true`。

- 窗口保持不可见、不可聚焦，系统全屏状态为 true，实际尺寸 `2560×1440`。
- 主渲染原生 F2、主渲染 DOM F2、插件 F2 和 Godot F2 均打开实际绘制的对话，并把主渲染原生子视图移到最上层。
- 插件私有 scope 的 Esc 通道、Godot Esc 和主渲染 DOM Esc 均按预期关闭对话。
- 对话已关闭时，Godot Esc 显示四项暂停菜单；宿主 `godot.runtimeState` 返回 `state: paused`。主渲染 Esc 能关闭菜单并恢复世界视图。
- 通过实际菜单 React 回调选择“保存并退出”，进程正常退出，exit code 为 0；`violations`、`pageErrors`、`shutdownFailures` 均为空数组。
- `tests/fb02-immersion-startup.test.mjs` 的 5 项策略/真实处理函数检查通过，暂停菜单实际 React/hook 无界面输入验证也通过。
- 输入交接纯逻辑检查覆盖已聚焦 owner 替换、detach 后回退、对话框优先、后台无交接、真实窗口重新获焦时恢复、headless 严格禁止、重复几何更新无额外交接及销毁保护。测试使用普通 JavaScript 对象和计数器，没有创建或聚焦任何真实窗口。关联 main-window/layers、宿主及启动失败测试共 24 项通过。

这些证据覆盖真实 Electron、主渲染、IPC、原生子视图次序和实际控件绘制。它们不是用户设备物理按键或可见系统合成画面的验收。最终便携包仍需按同一脚本再跑一次后才能把开发构建结论用于交付包。
