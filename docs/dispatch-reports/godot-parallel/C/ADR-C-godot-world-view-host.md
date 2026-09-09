# ADR-C：Godot Web 世界视图作为独立顶层文档与兄弟视图

状态：已实施（任务 C）。范围：`desktop/godot/web/**`、`desktop/godot/probes/shared/web_bridge.gd`、
`vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts`、
`electron/preload/godot-world.ts`、`electron/shared/godot-world-chrome.ts`、
`PluginViewTab.tsx`、`plugins/craftmine-world/view.mjs`、`world.html`。
不涉及 `App.tsx`、`Sidebar.tsx`、`craftmine.css`、Rust 核心、插件 `main/manifest`。

## 背景

固定样本的实际多线程 Web 导出已通过验收，但它运行在 `tests/godot-web.mjs` 的夹具里：
宿主页面与游戏页面都由测试用 `http.createServer` 提供，原生视图传输是夹具。
真实客户端里插件工作面板视图由 `file://` 加载（`plugin-view-host.ts` 的 `pathToFileURL`）。

多线程 Godot Web 导出需要 `crossOriginIsolated`，即顶层文档必须带
`Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`。
`file://` 文档是不透明来源、无法携带响应头，因此：

- 把游戏放进插件页面的 iframe 不会隔离（父文档不隔离，子框架也不会隔离）；
- 用 `sandbox="allow-scripts allow-same-origin"` 的 iframe 需要游戏页有独立来源，
  而 `file://` 无法提供响应头，`srcdoc` 又会继承父来源。

## 决策

1. **每个世界运行实例独占一个回环来源**：`http://127.0.0.1:<随机端口>/w/<256 位令牌>/`，
   由 `desktop/godot/web/runtime.mjs` 提供服务。响应头固定为 COOP `same-origin`、
   COEP `require-corp`、CORP `cross-origin`、`nosniff`、`no-store`，CSP 从
   `default-src 'none'` 起，只放行引擎所需（`wasm-unsafe-eval`、内联引导、
   多线程时的 `worker-src 'self' blob:`）。
2. **游戏页面是该来源的顶层文档**，由 `WebContentsView` 承载，因此天然跨源隔离。
   它不再嵌在插件页面里，也不继承插件的 preload 与 `pluginBridge`。
3. **游戏视图与插件视图是兄弟视图**：插件页面负责顶栏、模式、检查、工作台与占位区，
   `GodotWorldViewHost` 把游戏视图放在面板矩形内、顶栏之下（预留
   `WORLD_CHROME_HEIGHT = 76`）。插件页面用 `--godot-chrome: 76px` 预留同一高度。
4. **实例身份 = worldId + buildId + instanceId**，由宿主在页面创建前铸造，通过
   preload 的 `additionalArguments` 固定，页面无法改写。协议层逐条比对，不匹配即丢弃。
5. **独立 session 分区与出网策略**：`persist:pi-godot-world`，只允许本实例来源，
   所有权限（含 `pointerLock`）一律拒绝。游戏页面没有文件系统、没有插件桥、没有额外 IPC。
6. **切换世界是事务性的**：先让新实例 ready，再停旧实例。候选构建失败时旧世界继续运行，
   并报告失败原因。

## 考虑过的替代方案

| 方案 | 否决原因 |
| --- | --- |
| 游戏放在插件页面的 iframe 里 | 父文档 `file://` 无法隔离；若给游戏同源则能读到宿主的 `pluginBridge` |
| 把插件页面本身改由回环来源提供 | 需要放宽插件出网策略（`plugin-panel-host.ts` 的 `PANEL_LOCAL_SCHEMES`）并重写插件声明的 CSP，改动跨模块且扩大信任面 |
| 自定义协议 + `protocol.handle` | 需要 `registerSchemesAsPrivileged` 等主进程全局注册，且 `crossOriginIsolated` 行为未经本机验证 |
| 单线程 Web 模板 | 第 2 轮已记录退出任务组错误，且用户要求多线程候选 |
| 用 DOM 尺寸或 iframe 替身推断画面 | 验收明确不允许；本方案直接抓真实视图像素 |

## 后果

- 游戏与宿主之间只有一条受控通道（preload + 协议），隔离面清晰，可单独测试。
- 面板顶栏高度成为两边的显式契约（76 像素），由 `WORLD_CHROME_HEIGHT` 与
  `--godot-chrome` 两处常量承载；任一处改动都必须同步，否则游戏画面会错位。
- 游戏视图是独立 web contents：崩溃、退出、保存失败都要由宿主处理，不能靠页面重载。
- 每次切换世界都会换端口与令牌，因此运行器自己的 IndexedDB 副本不会跨实例共享；
  耐久进度始终以宿主的进度事务为准，新实例通过 `load` 载入宿主确认过的快照。
- 旧 voxel 运行器与旧预览通道不受影响：不带 `build.engine` 的世界仍走原路径，
  `tests/godot-web.mjs`（33 项）与 `tests/godot-web-transport.mjs`（21 项）继续通过。

## 边界

- 本 ADR 不覆盖产品入口接线（任务 I），不覆盖真实模型创作、GPU 性能、发行打包。
- 游戏视图的可见性由渲染进程测量的面板矩形驱动，与既有 `PluginViewHost` 的可见性权威一致。
- 自动化验收全程离屏、不可聚焦、禁用指针锁定，遵守项目 `AGENTS.md`。
