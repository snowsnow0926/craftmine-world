# 任务 C 集成说明（交给任务 I）

本文件只描述任务 C 需要别人接线的最小改动，不包含任务 C 自己的文件。
任务 C 的实现与验收见 `REPORT_C.md`、`GODOT_WEB_RUNTIME_PROTOCOL.md`、
`ADR-C-godot-world-view-host.md`。

任务 C 已交付、可直接使用的模块：

| 文件 | 作用 |
| --- | --- |
| `desktop/godot/web/runtime.mjs` | 每个世界实例一个回环来源、隔离响应头、资源服务、运行协议宿主端 |
| `desktop/godot/web/runtime.d.mts` | 上述模块的类型声明 |
| `desktop/godot/web/bridge.js` | 页面侧协议（新增 `craftmine.godot-runtime/2`，保留旧预览通道） |
| `desktop/godot/probes/shared/web_bridge.gd` | GDScript 侧统一操作集、身份、进度三阶段回执 |
| `vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts` | 真实 Electron `WebContentsView` 宿主（身份、事务、生命周期） |
| `vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts` | 运行页面唯一的 IPC 通道 |
| `vendor/pi-desktop/apps/desktop/electron/shared/godot-world-chrome.ts` | 通道名与实例 scope 参数 |
| `plugins/craftmine-world/view.mjs`、`world.html` | 面板顶栏 + 占位区、`godot-world:state` 状态显示 |
| `tests/godot-world-view.mjs` | 真实 Electron 验收（24 项） |

## 1 `electron.vite.config.ts`

preload 输入必须增加一行（否则打包后的 `godot-world.cjs` 不存在，运行视图会没有传输通道）：

```diff
         input: {
           index: resolve(__dirname, "electron/preload/index.ts"),
           "plugin-panel": resolve(__dirname, "electron/preload/plugin-panel.ts"),
           "craftmine-headless": resolve(__dirname, "electron/preload/craftmine-headless.ts"),
+          "godot-world": resolve(__dirname, "electron/preload/godot-world.ts"),
         },
```

`entryFileNames` 只把 `plugin-panel` 改成 `.js`，因此新入口会输出 `out/preload/godot-world.cjs`，
与 `godot-world-view-host.ts` 中的 `join(__dirname, "../preload/godot-world.cjs")` 一致。

## 2 `electron/main/index.ts`

### 2.1 import（文件顶部 import 区）

```ts
import { GodotWorldViewHost, godotEngineOf } from "./godot-world-view-host";
```

### 2.2 构造宿主（`const pluginViews = new PluginViewHost(...)` 之后，约 863 行）

```ts
// Godot Web 世界视图：真实游戏画面在自己的回环来源与独立 WebContentsView 中运行。
const godotWorld = new GodotWorldViewHost({
  window: () => mainWindow,
  allowedRoots: () => godotWorldBuildRoots(),          // 见 2.3
  descriptor: () => readGodotWorldDescriptor(),         // 见 2.4
  progress: async (call) => {                           // 见 2.5，与任务 B 的进度事务对齐
    const record = await plugins.invokePanelBridge("craftmine.world", "world.saveProgress", {
      id: call.worldId,
      revision: call.revision,
      baseBuild: call.buildId,
      snapshot: call.snapshot,
    }) as { revision?: number; contentHash?: string } | undefined;
    return {
      receipt: {
        format: "craftmine.progress-receipt/1",
        worldId: call.worldId,
        buildId: call.buildId,
        revision: Number(record?.revision ?? call.revision + 1),
        contentHash: record?.contentHash,
        persistedAt: Math.floor(Date.now() / 1000),
      },
    };
  },
  onState: (state) => {
    pluginViews.broadcast("godot-world:state", state);
  },
});
```

失败分支必须原样返回 `{ failed: true, error }`（不要抛异常），宿主会把失败回执转给运行器并保留世界。

### 2.3 允许的构建根目录

`engine.root` 只能位于这些目录内，否则 `ensure()` 直接拒绝：

```ts
const godotWorldBuildRoots = () => {
  const roots = new Set<string>();
  const configured = process.env.CRAFTMINE_GODOT_BUILD_ROOT;
  if (configured) roots.add(resolve(configured));
  roots.add(join(app.getPath("userData"), "godot-builds"));   // 产品默认位置
  return [...roots];
};
```

### 2.4 活动世界描述符

```ts
const readGodotWorldDescriptor = async () => {
  if (!plugins.getLoaded("craftmine.world")) return null;
  const list = await plugins.invokePanelBridge("craftmine.world", "world.list", {}) as {
    worlds?: { id: string }[];
    activeWorldId?: string;
  } | undefined;
  const id = list?.activeWorldId ?? list?.worlds?.[0]?.id;
  if (!id) return null;
  const record = await plugins.invokePanelBridge("craftmine.world", "world.open", { id }) as {
    id?: string;
    world?: { build?: unknown; snapshot?: unknown };
  } | undefined;
  const engine = godotEngineOf(record?.world?.build);
  if (!engine?.root || !engine?.buildId) return null;
  return {
    worldId: String(record?.id ?? id),
    buildId: engine.buildId,
    root: engine.root,
    entry: engine.entry,
    threads: engine.threads,
    build: record?.world?.build,
    snapshot: record?.world?.snapshot,
  };
};
```

### 2.5 视图 IPC 接线

```diff
       pluginViews.open({ ... });
+      if (pluginId === "craftmine.world" && viewId === "world") void godotWorld.sync();
       if (isBrowserView && location) { ... }

   handle(IPC.invoke.pluginViewSetBounds, async (payload) => {
     pluginViews.setBounds(payload ?? { x: 0, y: 0, width: 0, height: 0 });
+    godotWorld.setBounds(payload ?? { x: 0, y: 0, width: 0, height: 0 });
     return { ok: true };
   });

   handle(IPC.invoke.pluginViewSetVisible, async (payload) => {
     ...
     pluginViews.setVisible(pluginId, viewId, payload?.visible === true);
+    godotWorld.setVisible(pluginId === "craftmine.world" && viewId === "world" && payload?.visible === true);
     return { ok: true };
   });
```

`setBounds` / `setVisible` 内部会调用 `sync()`，所以世界切换不需要额外事件。

### 2.6 禁用/卸载/退出

```diff
   handle(IPC.invoke.pluginDisable, async (id) => {
     if (!host) throw new Error("host unavailable");
     if (id === "craftmine.world") await pluginViews.prepareCraftmineForQuit();
+    if (id === "craftmine.world") await godotWorld.close();
     pluginViews.closePlugin(id);
```

`before-quit` 里的 `craftmineQuitPreparation` 需要先保存 Godot 运行实例：

```diff
-    craftmineQuitPreparation = pluginViews.prepareCraftmineForQuit();
+    craftmineQuitPreparation = (async () => {
+      const godot = await godotWorld.prepareForQuit();
+      if (!godot.ok) throw new Error(godot.error ?? "Godot world was not saved");
+      await pluginViews.prepareCraftmineForQuit();
+    })();
```

保存失败时抛错会走原有分支：保留世界、提示用户重试、不退出。这与第 3 轮
`world checkpoint blocked application quit` 的既有行为一致。

## 3 任务 B / D / E/F/G 需要提供的接口

| 任务 | 需要提供 | 用途 |
| --- | --- | --- |
| B | `world.saveProgress` 返回真实 `revision` / `contentHash`（当前已存在） | 生成 `craftmine.progress-receipt/1` |
| D | 面板矩形（`pluginViewSetBounds`）在创作/游玩切换与缩放时照常上报 | 保持同一运行实例 |
| 世界构建方 | 世界文档 `world.build.engine = {kind:"godot-web", buildId, root, entry, threads}` | 宿主识别并启动 Godot 运行实例 |
| E/F/G | 底座在自己的 `world.gd` 实现 `web_command(op,args)`，可选实现 `load` | 玩法适配；未实现 `load` 时运行器回退到 `restore-state` |

`engine.root` 必须是构建产物目录的绝对路径；宿主只接受 §2.3 白名单内的路径。

## 4 未接线时的行为

没有本文件 §1/§2 的改动时：

- 插件视图、旧 voxel 运行器、旧预览通道全部照常工作（已回归验证）；
- Godot 世界只在面板里显示顶栏与占位区，不会有游戏画面；
- `tests/godot-world-view.mjs` 用自带测试主进程验证同一模块，不代表产品入口已接线。
