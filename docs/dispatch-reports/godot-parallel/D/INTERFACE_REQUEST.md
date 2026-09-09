# 任务 D 需要的接口与补丁说明

状态：渲染进程侧已实现并通过验收；下面 1、2 两项是**打包客户端里真正能切换世界**所缺的最后一段接线，属于共享入口（preload / main / 插件视图），按分工不由 D 直接修改。

渲染侧代码只依赖两个入口，缺任一即显示明确状态，不会用本地数据顶替：

- `src/lib/craftmine-worlds.ts`：`craftmineHostInvoker()` 依次解析
  `globalThis.__craftmineWorldBridge`（仅验收夹具）、`window.piDesktop.pluginPanelInvoke`。
- 通道清单见 `CRAFTMINE_REQUIRED_CHANNELS`。

## 1 渲染进程 → 插件面板通道（新增 IPC）

现状：`pluginBridge` 只暴露给插件面板页面（`electron/preload/plugin-panel.ts`），React 渲染进程没有任何途径调用 `craftmine.world` 的面板通道。

建议补丁（5 处，都很小）：

1. `vendor/pi-desktop/packages/shared/src/protocol.ts` 的 `IPC.invoke` 增加：

   ```ts
   pluginPanelInvoke: "pi-desktop/plugin/panel/invoke",
   ```

2. `vendor/pi-desktop/apps/desktop/electron/preload/index.ts`（暴露 `piDesktop` 的那个 preload）增加：

   ```ts
   pluginPanelInvoke: (pluginId: string, channel: string, payload?: Record<string, unknown>) =>
     ipcRenderer.invoke(IPC.invoke.pluginPanelInvoke, { pluginId, channel, payload: payload ?? {} }),
   ```

3. `vendor/pi-desktop/apps/desktop/src/lib/api.ts` 增加同名封装：

   ```ts
   pluginPanelInvoke: (pluginId: string, channel: string, payload: Record<string, unknown> = {}) =>
     invoke(IPC.invoke.pluginPanelInvoke, { pluginId, channel, payload }),
   ```

   （D 的代码已经做特性探测：`api.pluginPanelInvoke` 一旦出现即可用，无需 D 再改。）

4. `vendor/pi-desktop/apps/desktop/electron/main/index.ts` 注册处理器，要求：
   - 只接受主窗口 webContents（否则 `PERMISSION_DENIED`）；
   - `pluginId` 只允许 `"craftmine.world"`；
   - `channel` 走白名单：`world.list`、`world.create`、`world.open`、`world.saveProgress`、`world.switch`、`workbench.capabilities`、`task.current`、`verification.list`、`library.search`、`memory.search`、`backup.status`；
   - 除 `world.switch` 外直接 `return plugins.invokePanelBridge(pluginId, channel, payload)`；
   - `world.switch` 必须转发给**世界视图**（只有视图能冻结并抓取运行中的快照）：`pluginViews.broadcast("craftmine:world-switch", { id, requestId })`（该方法已存在，`plugin-view-host.ts:98`，走 `pi-plugin-panel-event:<event>`，视图侧用 `pluginBridge.on` 接收），并等待视图回执（见 2），超时返回 `WORLD_SWITCH_TIMEOUT`。

5. 回执落点：`plugins/craftmine-world/main.cjs` 的 `onPanelInvoke` 增加 `world.switchAck`（记录 `requestId → {ok, error, activeWorldId}`），main 用它解析 4 的等待。

## 2 世界视图必须提供 `world.switch`

现状：`view.mjs:374` 的切换逻辑（`save({freeze:true})` → `world.open` → `refreshList`）只挂在 `<select id="world-list">` 的 change 事件上，渲染进程无法触发；而且 `action()` 在 `busy` 时**静默丢弃**请求（`view.mjs:57`），这会在自动保存期间吞掉玩家的切换。

建议补丁（`plugins/craftmine-world/view.mjs`，复用现有序列，不新增逻辑）：

```js
bridge.on('craftmine:world-switch', async ({ id, requestId }) => {
  try {
    if (busy || closing || !loaded) throw Error('WORLD_BUSY');   // 明确返回忙，不要静默丢弃
    await action(async () => {
      await save({ freeze: true });
      mount(await bridge.invoke('world.open', { id }));
      await refreshList();
    });
    await bridge.invoke('world.switchAck', { requestId, ok: true, activeWorldId: id });
  } catch (error) {
    await bridge.invoke('world.switchAck', { requestId, ok: false, error: String(error?.message || error) });
  }
});
```

D 侧已经按“保存失败停留在原世界、任务不重定向、可重试”的语义实现并验收（见 `docs/evidence/godot-parallel-d/world-navigation.json`）。验收夹具正是驱动上面这条现有序列（真实冻结、真实保存、真实打开），并额外验证了 `WORLD_BUSY` 情形需要重试。

## 3 `world.list` 需要报告底座与来源（真实底座标签）

现状：Rust `WorldSummary` 只有 `id/title/revision/updatedAt`（`crates/craftmine-core/src/worlds.rs:24-31`），`world.list` 也就没有底座信息，左侧只能显示“底座未标注”。这是 D 无法在渲染进程补上的事实。

请求（插件侧最小改动，不必动 Rust 契约）：

```js
// main.cjs world.list
return {
  worlds: (await core.call('world.list')).map(record => ({
    ...record,
    base: { id: 'craftmine-web/5', label: '网页体素运行时', delivered: true },
    origin: legacyImportedIds.has(record.id) ? 'imported' : 'created',
  })),
  activeWorldId: (await pi.plugin.getSettings()).activeWorldId,
};
```

- 只有真的能打开并游玩的底座才允许 `delivered: true`；规划中的底座必须是 `delivered: false`，D 的界面会显示“规划中”且不可选。
- 旧世界导入标记来自 `craftmine_legacy_imports`，目前没有任何通道暴露它（`legacy.rs:35-40`）。
- 可选：`check: {status, at}` 用当前世界的最近一次检查结果填充；不填则列表不显示检查行。

## 4 `world.create` 需要接受底座与起点

现状：`main.cjs:107-111` 忽略一切参数，只创建 `emptyWorld(title)`（网页体素空白世界）。因此 D 的创建流程在真实主机上只开放“空白”，底座一栏明确写“主机尚未报告可选底座”。

请求：

- `world.create` 接受可选 `baseId`、`starterId`（D 已经在发送，未报告的字段不会发送）；
- 新增（或复用）一个 `world.createOptions` 通道返回：

  ```js
  { bases: [{ id, label, delivered }], starters: [{ id, label, delivered }], create: true }
  ```

  未报告的 `bases`/`starters` 视为空，界面只显示“空白”，不会出现任何未交付选项。

## 5 素材辅助区缺通道

“素材”一栏目前只能显示“接口未接入”。需要一个真实来源（例如 `world.assets` 返回当前世界构建里的素材清单）或明确的“不支持”结论；D 不使用 localStorage 假造素材列表。

## 6 已由 D 复用、不需要新增的通道

`library.search`（作品）、`verification.list`（检查）、`memory.search`（记忆）、`task.current`（任务）、`backup.status`（备份）——都已存在，D 直接读它们的真实结果作为展开行的摘要，深层界面仍在世界面板里打开。
