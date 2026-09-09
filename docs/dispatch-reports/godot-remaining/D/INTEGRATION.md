# D｜共享入口与面板接线片段（交主任务，未在本分支应用）

本目录的 `.patch` 是从只读交接树 `test-results/g6-host` 提取的**最小接线片段**，
不包含另一位负责人的完整修改，也未在本分支提交（共享文件由主任务合并）。

## 1 `snippets/index.ts.patch`（`vendor/pi-desktop/apps/desktop/electron/main/index.ts`）

包含：

- 引入并构造 `createGodotCandidateCoordinator({host: godotWorld, adapter: godotAdapter,
  selection: godotSelection, domain: (method, params) => plugins.requestCraftmineHost(method, params)})`。
- 插件面板桥：`godot.candidate*`（除 `godot.candidateList` / `godot.candidateRead`）
  交给协调器；候选活动期间阻止 `world.open` / `godot.runtimeSave` /
  `godot.runtimeResume` / `godot.runtimeSurface`。
- 应用成功后广播 `craftmineWorldChanged`：`godot.candidateApply` /
  `godot.candidateState` / `godot.candidateClose` 返回 `status === "applied"`。
- 退出/禁用/卸载/关闭世界视图前先 `godotCandidates.closeForDeparture()`。

主任务还需补：首载确认由初始化事务在主进程调用
`coordinator.firstLoad(worldId, candidateId)`（已实现；**刻意不作为页面路由**，
避免页面绕过预览直接提交）。

## 2 `snippets/view.mjs.patch`（`plugins/craftmine-world/view.mjs`）

包含：Godot 检查列表改为候选列表、预览按钮走 `godot.candidatePreview`、
应用走 `godot.candidateApply`、关闭走 `godot.candidateClose`、
面板重载/挂载先 `godot.candidateClose` 再 `godot.runtimeState`、
`godot.candidateState` 用于确认丢失回包的应用结果、
预览头部多 46 像素（原生视图内缩量）。

## 3 私有 API 合同（本分支已实现）

| 接口 | 参数 | 语义 |
| --- | --- | --- |
| `godot.candidatePreview` | `{worldId,candidateId}` | 独立候选预览；要求已有正式实例 |
| `godot.candidateApply` | `{worldId,candidateId}` | 丢弃预览→checkpoint 最新正式进度→新候选确认→提交→提升 |
| `godot.candidateClose` | `{worldId}` | 中止并只销毁候选，恢复原实例 |
| `godot.candidateState` | `{worldId,candidateId}` | 回包丢失/重载后按身份恢复结果，不混淆其他候选 |
| `godot.candidateFirstLoad` | `{worldId,candidateId}` | 首个世界加载确认；**不对外路由**，仅主进程初始化事务调用 `coordinator.firstLoad()` |
| `host.diagnostics("formal"\|"candidate")` | — | 有界 renderer console / 故障 / 请求证据 + 实例身份 |

UI 可恢复状态：应用不确定时协调器暂停并隐藏候选视图、保留原实例与事务所有权，
面板可再次调用 `godot.candidateState` 确认；首载失败回到可恢复创建状态，
不伪造旧实例。
