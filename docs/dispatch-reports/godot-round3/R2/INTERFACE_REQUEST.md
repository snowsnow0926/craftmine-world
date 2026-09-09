# R2 第三轮需要的接口与补丁

状态：R2 已修完审计点名的客户端缺陷（物化模块路径、稳定操作身份、丢回包不删源码、
检查器注入、运行身份暴露）。下面每项都是 R2 无法自行落地的部分，按第三轮所有权分派。

## 1 给 S2：两行私有路由（阻塞完整创建流程）

`plugins/craftmine-world/host-requests.cjs` 的 `applicationFields` 映射后追加：

```js
      'godotWorld.initialize':['worldId','title','baseId','baseBuild','snapshot'],
      'godotWorld.initStatus':['worldId'],
```

- 语义：纯透传到 `core.call(method, params, 60000)`；Rust 已校验世界/标题/底座/构建身份与
  进度一致性，无需改写参数。
- R2 侧已就绪：`godot-panel-coordinator.ts` 拦截 `world.createOptions`/`world.create`/`world.list`，
  工厂经 `plugins.requestCraftmineHost("godotWorld.initialize"/"initStatus")` 调用；
  `tests/godot-round2/R2/creation-contract-core.mjs` 已用真实核心证明载荷被接受。
- 路由落地后 R2 可立即跑通“创建 → 真实 initStatus 阶段 → 可玩”，无需再改客户端。

## 2 给 S1：创建后的登记与首次构建顺序

R2 目前只做到“世界已登记为 Godot 初始化中”。请给出可消费顺序：

1. 物化工程（`<data>/godot-worlds/<worldId>`，由 R2 在初始化前写入）如何登记为世界 revision 0：
   `godotProject.create` 还是带 `OperationContext` 的 `godotProject.patch`？新世界尚无 Git 仓库与 HEAD。
2. 首个 `godotBuild.start {mode:"check"}` 由谁发起（主进程宿主还是模型任务），
   `godotJob.checkDescriptor`/`godotJob.continue` 在其中承担什么。
3. `initStatus.status` 由 `pending → drafting → building → checked → confirmed` 的每一步由谁推进，
   以及 `firstLoad(worldId, candidateId)` 应在何时由主进程调用（D 的协调器方法已存在）。

R2 的 `initStatusToCreation` 已把每个状态映射成四个真实阶段与进度，不需要新增通道。

## 3 给 S1：历史界面通道

`content.status/history/changes/readFile/branch.*/version.*/checkpoint.*` 需要一个面板路由
（沿用 §1 的映射表，或经 `workbench.request` 暴露）。R2 的导航接入点已就绪：
在 `src/lib/craftmine-aux.ts` 的 `CRAFTMINE_AUX_SECTIONS` 增加一条记录并在窗口面板里渲染
S1 的历史组件即可，不需要改 `CraftmineNavigation.tsx` 的结构。

## 4 给 S3：first-person / side-view 的机器可读初始进度

R2 的创建流程读取物化工程里的 `world-build.json` / `world.json` / `craftmine_initial_state.json`
的 `initialProgress`/`initialState`。当前：

| 底座 | 物化工程里有具体初始进度？ |
| --- | --- |
| `top-down` | 有（`initialProgress`，可创建） |
| `mining-sandbox` | 有 |
| `first-person` | 无；目录 `initialState` 是 `"spawn"`、`"catalog defaults"` 等描述文本 |
| `side-view` | 无；目录 `initialState` 只有房间名与空数组，工程里无 `initialProgress` |

请为这两类底座/模板发布具体数值（例如 first-person 的出生点坐标、默认装备与空背包；
side-view 的起始房间、出生点与空进度账本）。在此之前客户端明确报
`BASE_INITIAL_STATE_MISSING`，不把描述文本当成进度写进世界。

## 5 给 S5：素材面板两个缺陷

1. **导入流程崩溃（未修，S5 修）**：`AssetLibrarySnapshot.scan`（扫描结果）与
   `AssetLibraryActions.scan`（方法）同名，`useAssetLibrary` 的展开让方法覆盖结果，
   面板渲染时读取 `scan.items` 抛 `Cannot read properties of undefined (reading 'find')`，
   整棵 React 树被卸载。`tsc` 同步报 `AssetLibraryPanel.tsx(211,5) TS2774` 与
   `use-asset-library.ts(712,5) TS2322`。建议把快照字段改名（`scanResult`）或把动作改名
   （`runScan`）并同步读写点，然后跑一次 `tsc --noEmit`。
   复现：`node tests/godot-round2/R2/asset-navigation-ui.mjs`（报告 `defects[]`）。
2. **`asset-service.mjs` 未注册**：`workbench-service.cjs`/`main.cjs` 的分发表没有 `asset.*`，
   真实主机返回 `PLUGIN_CALL_FAILED`（底层 `UNKNOWN_WORKBENCH_CHANNEL`）。
   R2 已完成导航白名单（`craftmine-navigation-host.ts`、`craftmine-panel-gateway.ts`）
   与窗口面板挂载；插件侧注册属 S2/S5，R2 不越权修改 `main.cjs`。

R2 已做的唯一改动是 `AssetLibraryPanel.tsx` 的挂载 effect 依赖（`[controller]` → `[controller.search]`），
用于消除无限请求；S5 可自行替换为更合适的写法。

## 6 给 S4 / S1：便携归档缺表

`backups.rs` 的 `TABLES`/`PACKAGE_TABLES` 不含 `craftmine_godot_projects`、
`craftmine_godot_project_commits` 与 `craftmine_content_*`，恢复后 Git 后端世界缺 commit 映射：

```
backups::portable::tests::portable_archive_restores_into_a_new_directory_without_the_source
Error: GODOT_PROJECT_REVISION_NOT_INDEXED  (godot_projects.rs:591)
```

复现：`cargo test -p craftmine-core --release backups::portable`。R2 未修改 `backups.rs`。

## 7 给 S7：合并顺序

R2 的两笔提交 `1b45d06`、`bfbb5ee` 可直接合入；它们只改
`electron/main/{index.ts,godot-world-creation.ts,plugin-runtime.ts,craftmine-navigation-host.ts}`、
`src/lib/craftmine-worlds.ts`、`src/components/craftmine/WorldCreatePanel.tsx`、
`plugins/craftmine-world/view.mjs` 与两个测试文件。
建议顺序：先合 S2 的私有路由与 S1 的登记/首次构建，再复跑
`creation-contract-core.mjs`、`surface-navigation-e2e.mjs`、D 的原生候选测试。
