# 任务 E 需要的接口与补丁说明

状态：React 界面侧已完成并经过真实产品路径验证；下面每一项都是**渲染进程无法自行实现**的主机契约，按所有权分派给 A/C/D/F/root/M/N。E 不在自己的交付中夹带其他 agent 的整份修改。

渲染进程只依赖已存在的宿主通道，缺任一都显示明确状态，不用本地数据顶替：

- `src/lib/craftmine-worlds.ts` 的 `craftmineHostInvoker()` 依次解析
  `globalThis.__craftmineWorldBridge`（验收夹具）、`window.piDesktop.pluginPanelInvoke`。
- 必需通道见 `CRAFTMINE_REQUIRED_CHANNELS`：`world.list`、`world.create`、`world.saveProgress`、
  `world.switch`、`world.creationAction`、`workbench.capabilities`、`verification.list`。
- 读取通道经 `electron/main/craftmine-navigation-host.ts` 的 `NAVIGATION_READ_CHANNELS` 白名单。

## 1 为什么现在仍不能“选择底座新建 Godot 世界”

实测（`tests/godot-remaining/e/world-create-e2e.mjs`，真实插件 + 真实 Rust）：

1. `world.createOptions`（`plugins/craftmine-world/main.cjs:132`）只返回
   `craftmine-web/5` 与 `blank`，三个 Godot 底座从不出现。
2. `world.create`（`main.cjs:137`）对 `baseId !== 'craftmine-web/5'` 直接
   `WORLD_BASE_UNAVAILABLE`，正文固定 `emptyWorld(title)`。
3. `world.list` 对新建世界**不返回 `base`**，界面因此只能显示“底座未标注”
   （E 不会伪造底座标签）。
4. 没有任何通道报告“工程创建 → 导入 → 首次构建 → 确认可加载”的初始化过程，
   也没有失败后的恢复动作。

E 已把这些状态的渲染、轮询、恢复与拒绝逻辑全部实现并测试；下面是要接通它们的契约。

## 2 给 A（Rust 核心，`crates/craftmine-core`）

1. `world.create` 接受并校验 `baseId`、`starterId`；只允许已交付底座。创建必须是
   持久化事务：先落世界记录与工程副本，再登记 revision 0；失败不得留下可游玩的半成品。
2. `world.create` 返回 `{id, title, state, creation?}`，其中
   - `state`: `"ready" | "initializing" | "failed"`；
   - `creation`:
     ```jsonc
     {
       "operationId": "gcreate-<uuid>",
       "stage": "import",                       // 与 stages[].id 对应
       "stages": [{"id":"materialize","label":"复制底座文件","status":"passed"},
                  {"id":"register","label":"登记世界","status":"passed"},
                  {"id":"import","label":"导入资源","status":"running"},
                  {"id":"build","label":"首次构建","status":"pending"}],
       "progress": 40,                          // 0..100，单调
       "error": null,                           // 失败时 {code,message,stage,recoverable}
       "actions": []                            // 见第 5 节
     }
     ```
3. `world.list` 的每个世界必须带 `state`；初始化中/失败的世界带 `creation`；
   所有世界必须带 `base`（`{id,label,delivered}`）与最新 `check`
   （`{status,at}`），否则列表无法显示底座标签与检查状态。
4. 新增持久化 RPC `world.creationAction {worldId, action}`：`retry` 重新执行未完成的
   初始化；`discard-draft` 删除未登记的草稿工程并回收空间。两个动作都要幂等、
   可重放、绑定世界身份，且不得改动其他世界。
5. 初始化在后台作业中执行（与 `godotBuild` 作业同一套预算/取消/恢复原则），
   进程中断后 `state` 必须是 `failed` 或 `initializing`，绝不能回到 `ready`。

## 3 给 C（插件 `plugins/craftmine-world/main.cjs`）

1. `world.createOptions` 返回完整目录，字段如下（`description` 为玩家可见说明）：
   ```jsonc
   {"create":true,"switch":true,"createActions":true,
    "bases":[{"id":"craftmine-web/5","label":"网页体素","description":"…","delivered":true},
             {"id":"first-person","label":"3D 第一人称","description":"…","delivered":true},
             {"id":"top-down","label":"2D 俯视","description":"…","delivered":true},
             {"id":"side-view","label":"2D 横版","description":"…","delivered":false}],
    "starters":[{"id":"blank","label":"空白","description":"…","delivered":true},
                {"id":"range","label":"训练靶场","description":"…","delivered":true}]}
   ```
   未交付的底座/起点必须 `delivered:false`；E 会显示为“规划中”且不可选、不会提交。
2. `world.create` 透传 `baseId`/`starterId` 到 `core.call('world.create')`，直接返回核心记录；
   删除本地 `WORLD_BASE_UNAVAILABLE`/`WORLD_STARTER_UNAVAILABLE` 白名单。
3. `world.list` 原样透传 `state`、`creation`、`base`、`check`，不再只按
   `runtimeKind` 猜测底座。
4. 新增面板通道 `world.creationAction` → `core.call('world.creationAction', payload)`；
   载荷只允许 `{worldId, action}`，动作白名单 `retry|discard-draft`。
5. `createActions` 只有在第 4 项可用时才返回 `true`；E 只渲染主机报告的动作，
   没有它就不显示任何恢复按钮。

## 4 给 D / root（Electron 网关与保留视图）

1. `electron/main/craftmine-navigation-host.ts`
   - 新增变更路由：`world.creationAction` → `deps.navigate({operation:"creationAction", worldId, action})`，
     校验 `worldId` 为字符串且 ≤128，`action ∈ {retry, discard-draft}`，其他一律 `PERMISSION_DENIED`。
   - 读取白名单 `NAVIGATION_READ_CHANNELS` 增加 `task.recoverable`（E 的任务行用它显示
     “可接续 N 项草稿”；缺失时 E 已回退到只显示绑定任务，不会报错）。
2. `plugins/craftmine-world/view.mjs`（root 合并）
   - `navigate()` 支持 `operation:"creationAction"`，串行化后调用 `world.creationAction`，
     与 create/switch 共用 busy/失败语义。
   - **`operation:"create"` 返回 `state !== "ready"` 时不得 `mount()` 该世界**：
     保持原世界与玩家进度，返回 `{id,title,state,creation}`，由 React 列表显示进度。
     现在 `view.mjs:239-246` 会无条件 `world.open` + `mount`，这会让未初始化的
     Godot 世界进入载入失败状态。
3. 若采用第 2 项的替代方案（由主机在初始化完成后再通知切换），请在
   `craftmineWorldChanged` 事件里带上 `{worldId, state}`，E 的列表已按 `world.list` 轮询，
   两种方案都能工作。

## 5 E 已实现的渲染行为（不需要主机配合即可复现）

| 行为 | 位置 | 依据 |
| --- | --- | --- |
| 未交付底座/起点显示“规划中”且禁用、永不提交 | `WorldCreatePanel.tsx` | `delivered !== true` |
| 初始化中的世界显示主机步骤与进度、不可游玩、不切换 | `WorldListPanel.tsx` / `use-craftmine-worlds.ts` | `state==="initializing"` |
| 初始化失败显示主机错误原文与 `creation.error.code` | `WorldListPanel.tsx` | `creation.error` |
| 恢复按钮只来自 `creation.actions` + `capabilities.createActions` | `WorldListPanel.tsx` | 无报告则无按钮 |
| 列表按 `world.list` 有界轮询（2.5s ×120 次）直到完成 | `use-craftmine-worlds.ts` | `hasInitializingWorld` |
| 点击未完成世界只提示、不发切换请求 | `use-craftmine-worlds.ts` `select` | `isWorldPlayable` |
| 主机未标注底座时显示“底座未标注” | `craftmine-worlds.ts` `worldBaseLabel` | 不伪造 |
| 恢复默认布局（保留当前模式） | `CraftmineLayoutControls.tsx` | `resetCraftmineLayout` |

## 6 给 F（底座与起点目录）

每个已交付底座需要提供 E 能展示的元数据，并落到 `world.createOptions`：

- `baseId`（与 `godot_project_create` 的 `baseId` 一致）、玩家可见 `label`、一句 `description`；
- 该底座下**已交付**的起点清单：`blank` 与至少一个示例（示例要能从初始进度创建，
  不继承作者存档）；
- 空白起点只含进入与创作所需的最小控制，示例内容可查看/修改/另存/拆分。

## 7 给 M / N（导航接入点）

E 只负责导航与整体验收，历史与素材组件由 M/N 各自实现。接入点唯一：

- 在 `src/lib/craftmine-aux.ts` 的 `CRAFTMINE_AUX_SECTIONS` 增加**一条**记录：
  ```ts
  {id, label:{zh,en}, surface:{kind:"workbench",tab:"<你的 tab>"}, channel:"<真实读取通道>", note:{zh,en}}
  ```
  `channel` 必须能在当前世界上下文返回真实摘要；`loadAuxSummary` 已支持新增分支，
  未接入时行内显示“接口未接入”，不会伪造数据。
- 需要新增 `CraftmineAuxSectionId` 成员时同步 `CRAFTMINE_AUX_SECTION_IDS`。
- M 的历史组件必须区分“恢复此创作版本”“回到这个存档”“从这里创建新方案”三种操作
  （VM 计划第 3 节）；N 的素材页必须显示固定版本、预览/兼容状态与局部覆盖，
  不把库中新增版本自动应用到世界（AL 计划第 7 节）。
- 两边都不要改 `CraftmineNavigation.tsx`；导航由该表驱动，E 负责联调与验收。
