# Godot Web 世界运行协议与接入接口（任务 C）

状态：实现中。本文件是任务 C 对外提供的接口契约，供任务 I 集成、供 E/F/G 实现底座适配。
代码事实以本文件为准；行为变更同步本 spec，架构决策见同目录 `ADR-C-godot-world-view-host.md`。

## 1 为什么需要真实来源

多线程 Godot Web 导出需要 `crossOriginIsolated`（`SharedArrayBuffer`）。跨源隔离要求顶层文档
带 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`。
插件工作面板视图当前由 `file://` 加载（`plugin-view-host.ts` 的 `pathToFileURL`），
`file://` 文档是不透明来源且无法携带响应头，因此：

- 游戏页面不能放在插件视图页面的 iframe 里（父文档不隔离，子框架也不会隔离）；
- 游戏页面必须是**自己的顶层文档**，由本地回环来源提供。

结论：每个世界运行实例独占一个回环来源（随机端口 + 256 位路径令牌），由
`desktop/godot/web/runtime.mjs` 提供，并以独立的 `WebContentsView` 承载。
该视图与插件视图是兄弟视图，位置由渲染进程测量的矩形决定（见 §4）。

## 2 运行协议 `craftmine.godot-runtime/2`

传输：宿主侧（Electron preload 或测试页脚本适配器）向页面暴露

```js
globalThis.craftmineRuntime = {
  scope: {worldId, buildId, instanceId},   // 固定，不可被页面消息改写
  post(message),                            // 页面 → 宿主
  on(handler),                              // 宿主 → 页面
  onDetach(handler),                        // 可选：视图被销毁
}
```

页面侧实现在 `desktop/godot/web/bridge.js`（同时保留 `craftmine.godot-preview/1`
的 MessageChannel 预览通道，固定预览夹具不受影响）。

所有消息都必须带 `{protocol, worldId, buildId, instanceId}`，任一项不匹配即丢弃且不改变状态。
这保证：重新加载的旧页面、上一实例、另一个世界都无法驱动当前运行实例。

| 方向 | 类型 | 负载 |
| --- | --- | --- |
| 页面 → 宿主 | `ready` | `{ops: string[]}` |
| 页面 → 宿主 | `response` | `{id, result}` 或 `{id, error}` |
| 页面 → 宿主 | `event` | `{name, detail}` |
| 页面 → 宿主 | `runtime-error` | `{error}` |
| 页面 → 宿主 | `exited` | `{exitCode}` |
| 宿主 → 页面 | `request` | `{id, op, args}` |

`id` 为 1 起的整数，同一时刻最多 16 个未完成请求；超限、超长（64 KiB）或畸形消息一律拒绝。

### 2.1 操作集

运行器自身实现的操作（`desktop/godot/probes/shared/web_bridge.gd`）：

| op | 语义 |
| --- | --- |
| `capabilities` | 返回协议版本、操作集、身份、暂停状态、`user://` 是否持久 |
| `load` | 交给底座：载入构建与快照 |
| `snapshot` | 交给底座：读取当前状态 |
| `save` | 运行器写入自己的 `user://` 进度副本，返回运行器确认回执 |
| `pause` / `resume` | 暂停/恢复 `SceneTree`，并转告底座（底座不支持时仍成功，错误放在 `baseResult`） |
| `acknowledge` | 宿主回报持久化结果（成功回执或失败） |
| `cancel` | 取消指定 `id` 的未完成请求；被取消方后续回包被丢弃 |
| `exit` | 引擎正常退出并回 `{exitCode}` |

其余 op 原样转发给底座的 `web_command(op, args)`。底座只需要实现自己的状态与玩法，
不需要重复实现身份、进度、暂停、退出。

### 2.2 三类写入状态必须分开

1. **写入请求**：宿主发出 `save`。
2. **运行器确认**：运行器返回
   `{status: "confirmed", runnerReceipt: {format: "craftmine.godot-progress/2", worldId, buildId, instanceId, path, bytes, sha256, savedAt}, snapshot, state}`。
   其中 `snapshot` 是底座的完整快照，`state` 是其中的状态对象；两者都提供，旧预览调用方
   继续按 `result.snapshot.state` 读取。运行器确认只证明运行器自己的 `user://` 副本写成功，
   **不是**耐久提交。
3. **已持久化回执**：宿主用自己的进度事务（Rust `world.saveProgress`）提交成功后，
   回传 `acknowledge {receipt: {format: "craftmine.progress-receipt/1", worldId, buildId, revision, contentHash, persistedAt}}`。
   运行器只接受与本世界/本构建匹配的回执。持久化失败时回传 `acknowledge {failed: true, error}`。

进度文件 `user://worlds/<sha256(worldId)>/progress.json`：
`{format: "craftmine.godot-progress/2", worldId, buildId, instanceId, state, savedAt}`。
读取时兼容旧的 `craftmine.godot-probe-progress/1`（仅校验 `worldId`）。
同一 `worldId` 但不同 `buildId` 的副本仍会返回，并带 `buildMismatch: true`：世界身份才决定
存档归属，新构建要载入什么由宿主的进度事务决定。

## 3 宿主模块 `createWorldRuntime(options)`

位置 `desktop/godot/web/runtime.mjs`（纯 Node ESM，Electron 主进程与测试共用）。

```js
const runtime = await createWorldRuntime({worldId, buildId, root, entry?, threads?, timeoutMs?});
```

- `root`：Web 导出目录（含 `index.html`）；`entry` 默认 `index.html`。
- 返回句柄：`{worldId, buildId, instanceId, url, origin, state, threads,
  waitReady(), attach(transport), receive(message), onEvent(fn), request(op, args),
  load/snapshot/save/pause/resume/cancel/acknowledge/exit/dispose, evidence()}`。
- `attach(fn)`：宿主把 `fn(message)` 送到页面；`receive(message)` 收页面消息。
- 响应头固定为 COOP `same-origin`、COEP `require-corp`、CORP `cross-origin`、
  `nosniff`、`no-store`、`Referrer-Policy: no-referrer`，以及
  `default-src 'none'` 起头的 CSP（含 `wasm-unsafe-eval`，多线程时 `worker-src 'self' blob:`）。
- 路径必须位于 `root` 内，扩展名在白名单内，否则 400/403/404/415；
  `dispose()` 后返回 410，令牌不符返回 404。
- `hashBuildDirectory(root)` 给出构建目录哈希，用于生成 `buildId`。

## 4 Electron 主进程接线（任务 I 集成）

新增模块 `vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts`
与 preload `vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts`。

```ts
const host = new GodotWorldViewHost({window: () => mainWindow, progress: (call) => ...});
host.ensure({worldId, buildId, root, threads});     // 幂等；同 worldId+buildId 复用实例
host.setBounds({x, y, width, height});              // 面板矩形，内部上边预留 WORLD_CHROME_HEIGHT
host.setVisible(true | false);
host.close();                                        // 保存并退出运行实例
await host.prepareForQuit();                         // 退出前快照 + 持久化
host.state;                                          // {worldId, buildId, instanceId, state, error}
host.broadcastState();                               // 推 godot-world:state 事件给插件视图
```

契约要点：

- 一个实例只服务一个 `worldId + buildId`；切换世界时旧实例必须先 `close()`，
  旧实例的迟到消息由协议层丢弃。
- `progress` 回调由任务 I 注入，用于把运行器确认交给 B 的进度事务：
  `progress({worldId, buildId, revision, runnerReceipt, snapshot})` →
  `{receipt} | {failed: true, error}`。主进程随后调用 `runtime.acknowledge(...)`。
- 退出顺序：`snapshot` → `progress` → `acknowledge` → `exit`；失败保留世界并报告可重试状态。
- 视图使用独立 session 分区与独立出网策略，只允许自己的回环来源，不继承插件分区。
- 视图全程 `offscreen`、`focusable:false`，不请求指针锁定（与 `AGENTS.md` 一致）。

任务 I 需要的 `index.ts` 改动（约 15 行，见 `INTEGRATION_C.md` 的补丁片段）：

1. `pluginViewOpen` 成功后，读取当前活动世界的 `world.build.engine`；
   `kind === "godot-web"` 时调用 `host.ensure(...)`。
2. `pluginViewSetBounds` / `pluginViewSetVisible` 转发给 `host`（同一矩形，内部自行预留顶栏）。
3. `before-quit` 调用 `host.prepareForQuit()`；`closePlugin("craftmine.world")` 时 `host.close()`。

## 5 世界文档中的引擎描述

任务 C 只读取、不写入。宿主接受的最小形状：

```json
{
  "id": "v-…",
  "engine": {
    "kind": "godot-web",
    "version": "4.7.2-stable",
    "buildId": "…",
    "root": "C:\\\\…\\\\exports\\\\first-person-initial",
    "entry": "index.html",
    "threads": true,
    "base": "first-person"
  }
}
```

`root` 必须位于宿主允许的构建根目录之内，否则拒绝启动并保留旧实例。
缺少 `engine` 的世界继续使用旧运行器（voxel `srcdoc`），行为不变。

## 6 插件视图（任务 C 的界面部分）

`plugins/craftmine-world/view.mjs` 与 `world.html`：

- 世界带 `build.engine.kind === "godot-web"` 时，视图页只渲染面板顶栏与占位区，
  游戏画面由 §4 的独立视图覆盖在占位区上；顶栏高度固定为 `WORLD_CHROME_HEIGHT = 76`。
- 视图页订阅 `pluginBridge.on("godot-world:state")` 显示载入/就绪/暂停/失败/保存状态；
  状态只来自主进程广播，视图不自行推断。
- 不带 `engine` 的世界继续使用原有 voxel 运行器，旧世界与玩家进度不受影响。
- 创作/游玩切换与面板缩放不重建实例：视图只改变矩形与可见性。

## 7 验收边界

已用真实 Godot Web 导出与真实 headless Chrome 验证：跨源隔离、响应头、CSP、
`ready/snapshot/save/acknowledge/pause/resume/cancel/exit/dispose`、异世界消息丢弃、
无效恢复拒绝。真实 Electron 视图、整进程重启、多世界存档隔离、迟到消息、保存失败、
候选构建加载失败见 `REPORT_C.md` 的验收章节与证据目录。
