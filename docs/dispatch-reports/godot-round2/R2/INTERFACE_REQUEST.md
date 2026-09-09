# R2 需要的接口与最小补丁

状态：R2 客户端侧已实现并验证到真实核心；下面每项都是 R2 无法自行落地的宿主路由或底座数据，按所有权分派。R2 不在自己的交付中夹带其他负责人的文件。

## 1 给 C（插件 `plugins/craftmine-world/host-requests.cjs`）：两行路由

R2 的客户端创建流程已经用真实 `craftmine-core.exe` 验证：它把底座目录里发布的初始状态包成
`craftmine.godot-progress/1`，调用 `godotWorld.initialize`，世界随即以
`runtimeKind: "godot"`、`build.godot.initializing: true` 登记，且 `initStatus.playable === false`。
证据：`tests/godot-round2/R2/creation-contract-core.mjs`（12/12，真实核心 stdio）。

唯一缺口是 Electron 主进程到核心的路由。`host-requests.cjs` 已有同样的映射表，请在其后追加两行：

```js
      'godotWorld.initialize':['worldId','title','baseId','baseBuild','snapshot'],
      'godotWorld.initStatus':['worldId'],
```

- 位置：`const applicationFields={...};` 内（C 已建立的私有路由白名单）。
- 语义：纯透传到 `core.call(method, params, 60000)`，不改写参数；Rust 已校验
  `worldId`、`title`、`baseId`、`baseBuild`、进度格式与 baseId 一致性。
- 不需要新增面板通道：R2 的 `godot-panel-coordinator.ts` 已拦截 `world.createOptions`、
  `world.create`、`world.list`，只把这两个方法经 `plugins.requestCraftmineHost` 送进来。
- `godotWorld.initialize` 只在 R2 的创建流程里被调用一次；页面无法直接调用它
  （导航网关 `craftmine-navigation-host.ts` 不暴露该方法）。

落地后 R2 的联测命令：

```powershell
$env:CRAFTMINE_CORE_BIN="<worktree>\vendor\pi-desktop\target\release\craftmine-core.exe"
node tests/godot-round2/R2/creation-e2e-client.mjs   # R2 在路由落地后补交的正式客户端链路
```

## 2 给 R3（底座与初始状态）：初始进度发布

R2 的创建流程要求每个已交付底座/起点在**物化后的工程里**发布一个初始进度正文，
读取顺序为 `world-build.json` → `world.json` → `craftmine_initial_state.json`
的 `initialProgress`/`initialState` 字段（`godot-world-creation.ts:readBaseInitialBody`）。

实测（`tests/godot-round2/R2/creation-contract-core.mjs`）：

| 底座 | blank | 示例 | 现状 |
| --- | --- | --- | --- |
| `top-down` | 有 `initialProgress` | 有 `initialProgress` | 可创建 |
| `first-person` | 无 | 无 | 报 `BASE_INITIAL_STATE_MISSING`，客户端**不会伪造**起始状态 |
| `side-view` | 无 | 无 | 同上 |

请为 `first-person` 与 `side-view` 的每个模板发布同样的初始进度正文（数值必须是该模板真实
起点，例如 first-person 的出生点、默认装备与空背包），或提供一个等价的机器可读入口并告知字段。
目录 `base-catalog.json` 的 `templates[].initialState` 目前含 `"spawn"`、`"catalog defaults"`
等描述性文本，不能直接作为进度正文。

## 3 给 R1：创建后的工程登记与首次构建顺序

R2 只负责到“世界已登记且不可游玩”。请确认并给出可消费的调用顺序：

1. 物化后的工程如何登记为世界 revision 0（`godotProject.create`？`godotProject.patch` 需要
   `OperationContext`，而新世界尚无 Git 仓库与 HEAD）。
2. 首个 `godotBuild.start {mode:"check"}` 由谁发起（主进程 host 还是模型任务），以及
   `godotJob.continue`/`godotExecutor.enqueue` 在首次构建中的角色。
3. `initStatus.status` 从 `pending` 走到 `drafting/building/checked/confirmed` 的每一步由谁推进。

R2 的 `initStatusToCreation` 已按 `pending/drafting/blocking/checked/confirmed/failed` 映射出
四个真实阶段（复制与登记、建立工程、首次构建、确认可加载），状态一旦变化界面即显示，
不需要新增通道。

## 4 给 R6：素材接线已完成，另有两个真实缺陷

R2 已按 `INTERFACE_R6.md` §3 完成宿主与导航接线（提交 `957bbe4`、`3cf57d6`）：

- `craftmine-navigation-host.ts` 读取白名单加入 `asset.search/read/versions/usage/scan/probe/previewRead`；
  `craftmine-panel-gateway.ts` 的主进程面板白名单同步加入同一批只读通道。
- `src/components/craftmine/AssetLibraryPanel` 挂在左侧“素材”入口的窗口面板里
  （`CraftmineNavigation.tsx` + `craftmine.css` 的 `.craftmine-asset-sheet`），
  `craftmine-aux.ts` 的 `assets` 行改为 `channel: "asset.search"`、`surface: {kind:"assets"}`。
- 宿主目录授权走新增的 `world.pickDirectory` → 保留视图的 `fs.requestDirectory`
  （与旧世界导入同一套授权），返回值直接喂给 `controller.scan`。
- 证据：`tests/godot-round2/R2/asset-navigation-ui.mjs`（真实组件 + 夹具宿主，9 项通过）。

**缺陷 1（已由 R2 最小修复，请 R6 复核）**：`AssetLibraryPanel.tsx` 的挂载 effect 依赖
`[controller]`，而 `useAssetLibrary` 每次渲染返回新对象 → 面板一打开就无限调用
`asset.search`（实测 6 秒 33,261 次，React 报 “Maximum update depth exceeded”）。
R2 改为依赖稳定的 `[controller.search]` 后恢复为 1 次调用。

**缺陷 2（未修，需 R6 改）**：`AssetLibrarySnapshot.scan`（扫描结果）与
`AssetLibraryActions.scan`（方法）同名，`useAssetLibrary` 的展开让方法覆盖结果，
面板在渲染时读取 `scan.items` 直接抛错并卸载整棵 React 树。
- 复现：打开素材面板 → 点“导入素材”（宿主授权与 `asset.scan` 都真实完成）。
- 原始错误：`Uncaught TypeError: Cannot read properties of undefined (reading 'find')`，
  栈顶 `AssetLibraryPanel`（`AssetLibraryPanel.tsx:211`）。
- 类型检查同样报错（R6 报告称未运行 tsc）：
  `AssetLibraryPanel.tsx(211,5) TS2774`、`use-asset-library.ts(712,5) TS2322`。
- 建议：把快照字段改名（例如 `scanResult`）或把动作改名（例如 `runScan`），
  并同步 `AssetLibraryPanel` 的读写点；改完请跑一次 `tsc --noEmit`。
- R2 未把这个失败写成通过：`asset-navigation-ui.report.json` 的 `defects` 记录了它。

**缺陷 3（缺后端）**：`asset-service.mjs` 还没有被插件注册（`workbench-service.cjs` /
`main.cjs` 的分发表里没有 `asset.*`）。因此真实主机目前返回
`PLUGIN_CALL_FAILED`（底层 `UNKNOWN_WORKBENCH_CHANNEL`），
`surface-navigation-e2e.mjs` 已把这条真实拒绝记为通过项，不伪造素材列表。
R6 的 INTERFACE 把注册写成 R2，但 `main.cjs`/`workbench-service.cjs` 属 C 的“私有插件后台”；
R2 未越权修改。请在 R6/C 之间确认由谁落这 3 行注册。

## 5 给 R5 与 R1：合并后出现一个跨模块失败

R2 集成 R1（`62a700f`）+ R5（`58f44ad`）后，`cargo test -p craftmine-core --release`
出现 1 项失败（R2 分支 226 通过 / 1 失败 / 3 忽略）：

```
backups::portable::tests::portable_archive_restores_into_a_new_directory_without_the_source
Error: GODOT_PROJECT_REVISION_NOT_INDEXED
  at godot_projects::read_project_file (godot_projects.rs:591)
```

- 根因：R5 的便携归档 `TABLES`（`backups.rs:30`）不含 `craftmine_godot_projects`、
  `craftmine_godot_project_commits` 与 `craftmine_content_*`；R1 的 Git 后端世界读工程
  需要这些行，恢复后世界仍被判为 Git 后端但缺少 commit 映射。
- 归属：归档表清单属 R5，表名与读取语义属 R1。R2 未修改 `backups.rs`。
- 复现：`cargo test -p craftmine-core --release backups::portable`。

## 6 给 R1/C：历史与素材面板通道（更新）

历史（`content.*`）仍缺面板路由；素材（`asset.*`）见 §4 缺陷 3。
R2 的导航接入点已就绪，通道落地后即可显示真实数据，不再需要改 `CraftmineNavigation.tsx`。
