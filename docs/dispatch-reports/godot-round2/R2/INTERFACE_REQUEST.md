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

## 4 给 R1/C：历史与素材面板通道

R2 已把左侧“作品/检查/记忆/任务/备份”入口接到真实面板（`world.surface`，见
`tests/godot-round2/R2/surface-navigation-e2e.mjs` 12/12）。历史与素材还需要两个真实读取通道：

- R1 的 `content.status` / `content.history` / `content.changes` / `content.readFile`
  （`docs/dispatch-reports/godot-round2/R1/INTERFACE.md` §1–3）需要一个面板路由；
  建议沿用第 1 节的映射表方式加白名单，或由 R1 明确它们经 `workbench.request` 暴露。
- R6 的素材浏览通道就绪后，R2 在 `src/lib/craftmine-aux.ts` 的 `CRAFTMINE_AUX_SECTIONS`
  增加一条记录即可接入导航（唯一接入点，不改 `CraftmineNavigation.tsx`）。

在通道落地前，R2 不会为它们放“假成功”按钮：左侧只显示已接通的入口。
