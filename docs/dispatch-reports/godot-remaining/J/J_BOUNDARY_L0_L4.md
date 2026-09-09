# J｜L0–L4 能力边界（Godot 路径）

任务标识：`J-20260910`。范围：只描述边界，不改变任何既有评分、权限或冻结文件。
依据：[总计划](../../GODOT_MULTIBASE_DEVELOPMENT_PLAN.md) 第 8、9 节；[自扩展方案](../../SELF_EXTENSION_PLAN.md)；
本轮实际代码 `desktop/godot/**`、`app/harness/**`。

## 1 为什么先写边界

本轮最容易被做坏的一件事，是把普通 GDScript 功能包装成"底层部件扩展"，用 L3 的名义
换来一张好看的能力清单。下面的规则和判定流程，就是为了让这种包装在接口层就通不过。

一句话规则：**能用普通工程代码（GDScript / 场景 / 资源）在项目内做完的，属于 L0–L2；
只有当能力必须位于 GDScript 之下（原生代码、引擎内核、宿主权限、存档协议）时才是 L3。**

## 2 分层定义与本仓库现状

| 层级 | 改什么 | 本仓库现状（可核对） | 什么不算这一层 |
| --- | --- | --- | --- |
| L0 数据与场景 | 场景、瓦片地图、房间、出生点、资源绑定 | 俯视 `MapRenderer` 直接构建真实 `TileMapLayer` 与碰撞体（`desktop/godot/bases/top-down/core/scripts/map_renderer.gd`）；三种底座都有空白起点与样例世界 | 改引擎、改存档格式 |
| L1 游戏玩法 | GDScript 脚本、交互、UI、战斗、人物、任务 | 三个底座的核心玩法脚本、HUD、准星、任务与商店；横版在 `--fixed-fps 60` 下用脚本输入源获得确定性（`desktop/godot/bases/side-view/scripts/player/scripted_input_source.gd:4`） | 需要打包成可复用扩展、需要改宿主 |
| L2 可复用能力扩展 | 新命令、组件、场景、规则打包成兼容包 | 旧运行器的扩展 ABI 与装载器（`app/harness/extension.mjs`、`app/harness/extension-loader.mjs`，格式 `craftmine.extension/…`）；Godot 侧底座以 `craftmine.godot-base/1`、`craftmine.godot-base-manifest/1` 声明 | 替换引擎内置部件、改验证标准 |
| L3 底层能力 | 渲染、性能组件或本地扩展；受控的可替换部件 | 旧运行器已有可替换部件（`app/harness/parts.mjs` 的 `renderPass/hudWidget/postProcess`、`app/harness/kernel.mjs` 的 `REPLACEABLE_PARTS` / `PartRegistry`，要求人审 + 冻结内核哈希 + 自带测试对空实现变红）。**Godot 路径本轮新增 `desktop/godot/extensions/**` 作为对应的元数据与生命周期层** | 普通脚本封装成"部件"；模型自行改引擎 |
| L4 创作策略 | 提示词、工具集、计划、记忆组织 | 已有记忆、压缩、恢复基础；本轮新增 `desktop/godot/strategy/**` 作为按底座/版本组织的检索、工具选择与对照实验层 | 模型自行改评分、权限或通过条件 |

## 3 判定流程（模型与人都用同一套）

1. **是不是已有但没查到？** 先读真实场景与系统状态。查到就直接用，不进 L3。
2. **是不是状态/工具没暴露？** 记录具体接口缺口和最小证据，交 L（工具与上下文）处理。
3. **普通 GDScript 能不能做？** 能，就是 L1。写成"部件"不改变它的层级。
4. **能不能打包成可复用扩展？** 能，就是 L2，走扩展包与独立检查。
5. **必须落在 GDScript 之下吗？** 只有这时才是 L3，并且必须先通过 `desktop/godot/extensions/candidate.mjs`
   的候选闸门：冻结输入、可解析证据、实测基线、预算、回退方案、止损条件齐全才允许开工。
6. **要动引擎源码、宿主权限、存档协议或验证标准吗？** 一律另立版本与专项评审，
   不属于普通创作的一轮执行，也不属于本任务。

## 4 本仓库里容易被误判为 L3 的东西（已核对，均不是 L3）

| 看起来像 L3 的点 | 实际层级 | 证据 |
| --- | --- | --- |
| 逐格绘制地图 | L0/L1，且引擎已代劳 | `map_renderer.gd` 用真实 `TileMapLayer.set_cell`，不是每帧脚本绘制 |
| 确定性运行与固定步长 | L1，引擎已支持 | `scripted_input_source.gd:4-5` 明确 `--fixed-fps 60` 下确定 |
| 准星绘制 | L1 | `first-person/scripts/ui/crosshair.gd:112` 的 `_draw()` 只画几条线段/圆 |
| 自动存档 | L1 | `top-down/core/scripts/game.gd:412` 的 `_process` 只是节流计时 |
| 瞄准射线查询 | L1 | `first-person/scripts/core/aim_query.gd:34` 已用 `probe_interval_frames` 节流 |
| 自定义资源导入器 | L2 | Godot 的 `EditorImportPlugin` 可用 GDScript 实现，不需要原生代码 |
| 世界状态序列化 | L1 | `top-down/core/scripts/world_state.gd` 是纯字典与稳定实体 id |

上表存在的意义是：当有人（包括模型）提出"要不要写个原生部件"时，先对照这里，
能落回 L0–L2 的一律落回。

## 5 越界与升级

* **原生/引擎范围**：`desktop/godot/extensions/**` 只做元数据与生命周期；`native: true` 的包
  必须携带 B/C/K 的专项验证记录（`{by, at, harness}`）才能装载，本层无法自己签发。
* **宿主权限与沙箱**：由 B/C 管理，本任务不新增执行路径、不新建世界数据库、不新建模型循环。
* **评分与通过条件**：由 I 冻结，`desktop/godot/strategy/experiment.mjs` 只引用 `scoringContract`
  哈希，不内置也不修改任何通过条件。
* **正式工具与上下文**：由 L 接入；本任务只提供 `selectTools` / 检索接口与调用示例。
* **许可与发行**：由 K 负责；本任务提供 `licenseReady()` 与来源字段，不代替许可核对。

## 6 与配套计划（M/N、版本管理）的关系

经验与作品检索使用 M/N 的固定内容引用（`desktop/godot/extensions/content-ref.mjs`，
格式 `craftmine.godot-content-ref/1`，字段 `contentId/contentVersion/contentHash/baseId/baseVersion/stateFormat/engineVersion`）。
没有可解析哈希的引用一律拒绝，避免检索到"只存在指针"或与当前底座不兼容的作品。
详见 [J_INTERFACE_NOTES.md](J_INTERFACE_NOTES.md) 第 4 节。
