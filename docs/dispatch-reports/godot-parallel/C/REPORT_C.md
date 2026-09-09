# 任务 C 报告：把 Godot Web 世界接入真实 Electron 客户端中央区域

分支：`codex/godot-parallel-c-20260909`
工作树：`D:\Craftmine World-worktrees\godot-parallel-c-20260909`（基于 `46739d2` 新建，未合并、未推送）
提交：见同目录 `DELIVERY_C.json`
接口契约：`GODOT_WEB_RUNTIME_PROTOCOL.md`；架构决策：`ADR-C-godot-world-view-host.md`；
集成补丁：`integration.patch` 与 `INTEGRATION_C.md`。

## 1 解决了什么接线缺口

此前 33 项 Web 验收使用真实 Godot 与真实 React，但原生视图传输是夹具：
`tests/fixtures/godot-react-shell.mjs` 伪造 `pluginViewOpen/SetBounds/SetVisible`，
并把游戏作为 `body` 下的普通 iframe 插入。真实客户端里插件工作面板视图由
`file://` 加载（`plugin-view-host.ts` 的 `pathToFileURL`），而多线程 Godot Web 导出
需要 `crossOriginIsolated`，`file://` 顶层文档既是不透明来源也无法携带 COOP/COEP 响应头。

本任务补齐的部分：

1. **真实来源与响应头**：每个世界运行实例独占一个回环来源
   `http://127.0.0.1:<随机端口>/w/<256 位令牌>/`，由 `desktop/godot/web/runtime.mjs`
   提供，固定返回 COOP `same-origin`、COEP `require-corp`、CORP `cross-origin`、
   `nosniff`、`no-store`、`Referrer-Policy: no-referrer` 和以 `default-src 'none'` 起头的 CSP
   （`wasm-unsafe-eval`、内联引导、多线程时 `worker-src 'self' blob:`）。
2. **资源服务与路径约束**：只服务构建目录内、扩展名白名单内的文件；`..`、反斜杠、
   盘符、其他令牌一律 400/403/404/415；`dispose()` 后返回 410。
3. **真实 Electron 视图**：`godot-world-view-host.ts` 用 `WebContentsView` 承载游戏页面，
   独立 session 分区 `persist:pi-godot-world`，出网只允许本实例来源，所有权限（含
   `pointerLock`）拒绝；视图与插件视图是兄弟视图，位置为面板矩形减去顶栏
   `WORLD_CHROME_HEIGHT = 76`。
4. **稳定身份**：`worldId + buildId + instanceId`，由宿主在页面创建前铸造并通过 preload
   `additionalArguments` 固定；协议层逐条比对，异世界/旧实例消息在改变任何状态前丢弃。
5. **统一运行协议**：`craftmine.godot-runtime/2` 提供 `load`、`ready`、`snapshot`、`save`、
   `pause`、`resume`、`acknowledge`、`cancel`、`exit`、`capabilities`；其余 op 转发给底座的
   `web_command(op,args)`。底座只需实现自己的状态与玩法。
6. **写入三阶段分离**：宿主写入请求 → 运行器确认（`runnerReceipt`）→ 宿主进度事务提交后的
   持久化回执（`craftmine.progress-receipt/1`）。持久化失败时回传 `acknowledge{failed:true}`，
   世界保留、状态可重试。
7. **事务性切换**：新世界/新构建先 ready 再停旧实例；候选构建加载失败时旧世界继续运行并报告原因。
8. **面板与实例保持**：创作/游玩切换、面板缩放、隐藏/重现都只改变矩形与可见性，不重建实例；
   面板塌陷到 0×0 时不上报，避免游戏视图被挪到 0 尺寸。
9. **旧运行器继续可用**：不带 `build.engine` 的世界仍走 voxel `srcdoc` 与
   `craftmine-host/1`/`craftmine-game/1`；`bridge.js` 同时保留旧预览通道
   `craftmine.godot-preview/1`。

## 2 修改范围

| 文件 | 变更 |
| --- | --- |
| `desktop/godot/web/runtime.mjs` | 新增：回环来源宿主、隔离响应头、资源服务、协议、身份、生命周期 |
| `desktop/godot/web/runtime.d.mts` | 新增：上述模块的类型声明（供 Electron 主进程 TS 引用） |
| `desktop/godot/web/bridge.js` | 新增 v2 传输与操作集；保留 v1 MessageChannel 预览通道 |
| `desktop/godot/probes/shared/web_bridge.gd` | 统一操作集、身份绑定、进度三阶段回执、暂停时仍可应答；兼容 v1 请求形状 |
| `vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts` | 新增：真实视图宿主、身份、事务、生命周期 |
| `vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts` | 新增：运行页面唯一 IPC 通道 |
| `vendor/pi-desktop/apps/desktop/electron/shared/godot-world-chrome.ts` | 新增：通道名与 scope 参数 |
| `vendor/pi-desktop/apps/desktop/src/components/workpanel/PluginViewTab.tsx` | 塌陷不上报、记录测量状态 |
| `plugins/craftmine-world/view.mjs`、`world.html` | Godot 世界：顶栏 + `#godot-surface` 占位区、`godot-world:state` 状态显示；voxel 路径原样保留 |
| `tests/godot-runtime.mjs` | 新增：真实导出 + 真实 headless 浏览器的运行宿主验收（23 项） |
| `tests/godot-world-view.mjs`、`tests/godot-world-view/**` | 新增：真实 Electron 视图验收（24 项） |

未修改：`App.tsx`、`Sidebar.tsx`、`craftmine.css`、Rust 核心、插件 `main.cjs`/`manifest.json`、
`desktop/build-world-plugin.mjs`。

## 3 实际验证与原始证据

全部命令在 `D:\Craftmine World-worktrees\godot-parallel-c-20260909` 下执行，
`CRAFTMINE_GODOT_CACHE_DIR` 指向已核对的 4.7.2-stable 缓存（本工作树无 `desktop/build`）。
所有自动化运行都是独立 headless/offscreen 进程、独立数据目录，禁用指针锁定，
未发送鼠标/键盘输入、未激活或置前窗口、未运行 `tests/browser.mjs` 或 `tests/modules-browser.mjs`。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `node tests/godot-runtime.mjs` | 23/23 | [godot-runtime.json](evidence/godot-runtime.json) |
| `node tests/godot-world-view.mjs`（真实 Electron） | 24/24 | [godot-world-view.json](evidence/godot-world-view.json)、[electron-first-person.png](evidence/electron-first-person.png) |
| `node tests/godot-web.mjs`（第 2 轮 33 项预览回归） | 33/33 | [godot-web-preview.json](evidence/godot-web-preview.json) |
| `node tests/godot-web-transport.mjs` | 21/21 | 控制台输出（无文件证据） |
| `node tests/godot-headless.mjs`（原生引擎回归） | 13/13 | `test-results/godot-headless-Eqa1jz` |
| `node tests/desktop-view-probe.mjs`（插件视图页回归） | 6/6 | `test-results/desktop-view-tc0boL` |
| `node desktop/build-world-plugin.mjs` | 通过 | 输出 `desktop/build/craftmine.world` |
| `pnpm build:js` | 通过 | 含桌面 renderer 构建 |
| 集成补丁 `integration.patch` + `tsc --noEmit -p tsconfig.json` | 通过（0 错误） | 补丁先在临时副本 `git apply --check` 通过，再应用到本工作树验证后回退 |
| 集成补丁 + `electron-vite build` | 通过 | `out/preload/godot-world.cjs` 生成；`out/main/index.js` 含 `craftmine.godot-runtime/2` 与 `Cross-Origin-Embedder-Policy` |

真实 Electron 验收覆盖（`tests/godot-world-view.mjs`，24 项全部通过）：

- 真实 Electron 进程、真实 `BrowserWindow`、真实 `WebContentsView`、真实 4.7.2 Web 导出；
  窗口离屏且不可聚焦，全程 `pointer-lock = 0`、`window-focus = 0`。
- 游戏页面 `crossOriginIsolated === true`；视图像素里存在渲染出的白色准星；
  视图矩形 `y = 76`、`height = 784`。
- 隐藏/重现、面板缩放后 `instanceId` 不变（同一实例）；`fire` 造成弹药 6→5、目标血量 50→38。
- `save` 同时给出运行器回执（sha256）与宿主持久化回执（revision 4）。
- 异世界消息、上一世界的迟到消息都被丢弃，状态不变。
- 候选构建（非 Godot 目录）加载失败：`ensure` 报错并提示保留旧世界，旧实例继续 `ready`。
- 切换世界：新 `instanceId`、新端口；第二个世界初始状态独立。
- 持久化失败：`save` 返回 failed、状态 `failed`、世界继续可快照。
- 整进程退出并重启：新实例载入宿主持久化的进度 `{coins:15, apples:2, position:[120,80]}`；
  重启前创建的另一个世界仍以自己的存档启动。

## 4 未完成项与限制

1. **产品入口未接线**：`electron/main/index.ts` 与 `electron.vite.config.ts` 的改动属于任务 I。
   本任务提供可直接 `git apply` 的 `integration.patch`（已在临时副本验证可应用，
   并已用打补丁后的工作树跑通 `tsc` 与 `electron-vite build`，随后回退）。
   未接线前，Godot 世界在面板里只有顶栏与占位区。
2. **进度事务是夹具**：Electron 验收里的 `progress` 回调是测试实现；真实
   `world.saveProgress` → 回执的链路需要任务 I 按 §INTEGRATION_C 接线后另行验收。
3. **世界文档需要 `build.engine`**：`{kind:"godot-web", buildId, root, entry, threads}`。
   由世界构建方写入；缺失时按旧运行器处理。宿主只接受白名单构建根目录内的 `root`。
4. **渲染路径**：验收在离屏软件渲染（SwiftShader）下完成，只能证明真实画面与真实物理，
   不能作为 GPU 性能或玩家手感证据。
5. **草稿预览**：Godot 世界暂不支持面板内草稿预览（按钮禁用并说明原因）；旧运行器预览不变。
6. **运行器自身存档跨实例不共享**：每次切换世界都会换端口，`user://` 的 IndexedDB 随来源变化；
   耐久进度以宿主事务为准，新实例通过 `load` 载入。这是设计取舍，已在 ADR 记录。
7. 未验证：真实模型创作、Windows 发行包、安装生命周期、多人并发下的长期稳定性。

## 5 需要其他任务提供的接口

| 任务 | 需要提供 |
| --- | --- |
| I | 按 `INTEGRATION_C.md`/`integration.patch` 接线：preload 入口、宿主构造、bounds/visible 转发、退出前保存、`world.saveProgress` 进度桥 |
| B | `world.saveProgress` 返回真实 `revision`/`contentHash`（现有签名即可） |
| D | 创作/游玩切换与缩放时继续上报面板矩形（现有 IPC 即可） |
| 世界构建方 | 在世界文档 `world.build.engine` 写入 Godot 构建描述 |
| E/F/G | 底座实现 `web_command(op,args)`；建议实现 `load`，否则运行器回退到 `restore-state` |

## 6 与验收边界的对应

| 任务要求 | 状态 |
| --- | --- |
| 真实 Electron 内容视图加载固定构建 | 通过（`tests/godot-world-view.mjs`） |
| 游戏与有权限宿主隔离 | 通过（独立来源、无 preload 插件桥、独立 session、权限全拒） |
| 多线程 Web 的响应头、来源、CSP、资源服务 | 通过（`tests/godot-runtime.mjs`） |
| worldId/buildId/实例身份，切换世界后旧消息不可进入 | 通过 |
| 加载/就绪/快照/保存/暂停/恢复/退出/失败/取消 | 通过 |
| 与 B 对齐主机进度、区分三类写入状态 | 协议与宿主已实现，真实事务待 I 接线 |
| 创作/游玩与缩放保持同一实例、旧运行器可用 | 通过（33 项预览回归 + 6 项插件视图回归） |
| 为 E/F/G 提供统一运行协议 | 通过（协议文档 + 转发 + `load` 回退） |
| 实际画面、整进程重启、多世界隔离、迟到消息、保存失败、候选加载失败 | 通过（Electron 验收 24 项） |
