# 任务 F 报告：2D 俯视底座与小镇示例

## 交付范围

只新增 `desktop/godot/bases/top-down/**` 与本报告目录
`docs/dispatch-reports/godot-parallel/F/**`。
没有修改共享协议、UI、Rust 核心、第一人称底座、横版底座、全局 Goal、总计划或
`docs/DEVELOPMENT_STATUS.json`。

分支：`codex/godot-parallel-f-20260909`
工作树：`D:\Craftmine World-worktrees\godot-parallel-f-20260909`
基线：`46739d2`

## 做出来的东西

一个可以直接用 Godot 4.7.2 打开的 2D 俯视底座，加一个"一条路、一间商店、一位 NPC、
一个采集交付任务"的小镇示例。

```
desktop/godot/bases/top-down/
  manifest.json              底座清单（baseId=top-down, baseVersion=1.0.0, 协议号=1）
  core/scripts/*.gd          17 个脚本：玩家、方向动画、交互、区域、商店、任务、
                             对话、场景路由、存档、地图渲染、探针接口
  core/assets/**             6 个原创像素素材（瓦片图集 + 三张 4 方向行走图 + TileSet）
  core/project.godot.template
  templates/{blank,town}/    空白起点与小镇示例的模板（场景、地图、数据）
  worlds/{blank,town}/       由模板生成、可直接打开的示例工程
  tools/                     5 个工具：生成素材、创建世界、同步校验、headless 验收、截图
  docs/                      行为规范、架构决策、给 B/C 的接口说明
```

小镇短流程：出生点 → 沿路 → 南边草药丛采集（最多 5 次）→ 交给米拉换 30 金币 + 1 苹果
（只能一次）→ 走到商店门口自动进店 → 柜台买面包/药水/苹果/绳子 → 出店回小镇，
金币、背包、库存、任务状态全程保持。

## 关键实现选择

1. **一个世界 = 一个独立 Godot 工程**。世界从模板复制，带自己的 `project.godot`、
   `world.json`、底座脚本副本、数据和素材。世界之间没有隐式共享目录。
2. **状态只有一个权威对象**。自动加载单例 `Game` 持有 `WorldState`；商店、任务、采集、
   探针改的是同一个对象，没有第二份状态。
3. **内容外置成 JSON**。商品/价格/库存、任务需求与奖励、NPC 台词、地图、初始进度
   都在 JSON 里，脚本只实现规则。地图是字符行 + 图例，避免二进制 `tile_map_data`。
4. **碰撞由地图数据生成**。`collision` 层里带 `solid: true` 的字符合并成矩形，
   挂到场景的 `StaticBody2D`；示例大地图 48 个形状。
5. **每个动作自己重新做几何检查**。`Shop.buy`、`Npc.talk`、`QuestManager.deliver`、
   `GatherZone.gather` 都要求调用时与目标区域真实重叠，所以探针、脚本、将来的 UI
   都无法从远处成交。
6. **一次性奖励用双账本**。`quests[id].rewarded` 与
   `grantedRewards["<id>#reward"]` 同时写、同时校验，且在扣材料之前检查。
7. **新世界只从 `initialProgress` 开始**。`new-world.mjs` 在写盘后校验模板，
   出现 `rewarded: true` 或非空奖励账本就失败退出。
8. **每实例独立 `user://`**。`custom_user_dir_name = craftmine-topdown-<worldId>`，
   进度再按 `worldId` 哈希分目录，文件内还带 `worldId`。
9. **内部测试接口与游戏共用代码路径**。探针只在 `--probe` 时启用，`move` 只提供
   输入向量，位移/碰撞/动画由真实物理产生。

## 实际验证

### 逻辑验收（独立 headless 进程、独立数据目录）

```
node desktop/godot/bases/top-down/tools/verify.mjs
→ 30/30 通过
```

覆盖：空白起点可跑、真实碰撞、区域进入/离开、范围外购买被拒、钱物库存一致、
库存为 0 与金币不足边界、任务奖励仅一次、跨场景保持、完整进程重启保持、
两个实例独立、从示例新建世界不继承奖励、四方向动画。

原始证据：`evidence/verify/report.json`、`evidence/verify/evidence/*.json`
（每个世界实例的探针请求、响应与进程日志）。
逐条对应关系见 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md)。

### 同步校验

```
node desktop/godot/bases/top-down/tools/check-sync.mjs
→ worlds/blank 与 worlds/town 均与生成器逐文件哈希一致
```

### 画面证据（与逻辑证据分开记账）

Web 导出后在独立 headless 浏览器里截图，不发送任何输入：

- `evidence/screens/overworld.png`：320×180，29 色，草地 39843 px、道路 8279 px
- `evidence/screens/shop-interior.png`：320×180，28 色，木地板/砖墙/柜台/地毯可辨认
- 两次都是 0 条页面错误（`evidence/screens/*-capture.json`）

### 引擎版本

`4.7.2.stable.official.ed1daf0bf`（与 `desktop/godot/toolchain.lock.json` 一致）

## 过程中修掉的问题（保留记录）

1. `MapRenderer` 的图例默认 `solid = true`，导致整张地图都变成实心，玩家出生就被
   挤开；改为默认非实心，只有显式 `"solid": true` 才碰撞。
2. `decor` 层用 `.` 当空白，而 `.` 在图例里是草地，于是装饰层把整张地图盖成草地，
   道路和建筑都看不见；改用不在图例里的空格。
3. Godot 4.7 把"从 Variant 推断类型"当错误；把 `:=` 换成显式类型。
4. 探针的 `_set_position` 是协程但没有 `await`；补上。
5. 退出时的自动保存没有触发；改为 `_exit_tree` + `NOTIFICATION_WM_CLOSE_REQUEST` +
   `NOTIFICATION_PREDELETE`，并增加"状态变更后最多 1 秒写回"。
6. 验收脚本用固定 `worldId`，第二次运行会读到上一次的 `%APPDATA%` 进度；
   改为每次运行生成唯一 `worldId`，并在结束时清理对应目录。
7. PowerShell 重写 `.tscn` 时把中文提示串写成 `?`，Godot 解析失败；改用 UTF-8 写入。

## 未完成 / 边界

- 这是短流程示例，**没有**战斗、四季农场、大量剧情、无限地图。
- 场景切换是重新加载场景，不是任意脚本热更新。
- 本底座**不提供** OS 级隔离；AppContainer 仍在 GD0 的 0xC0000142 未解状态，
  本报告不声称解决隔离。
- 没有真实鼠标键盘、窗口合成、手柄手感验收（按项目约定不自动执行）。
- Web 导出预设没有提交固定文件，避免把本机绝对路径写进工程；
  `tools/capture-web.mjs` 里生成最小预设。
- 世界之间的作品复用、兼容标签、底座升级迁移属于 GD6，本次不做。

## 需要其他任务提供

给 B（构建）与 C（运行/保存）的接口写在
`desktop/godot/bases/top-down/docs/INTERFACE_BC.md`，要点：

- 世界创建入口、`world-build.json` 回执格式、导入/运行/导出命令；
- 探针协议与进度文件格式、路径与保存时机；
- 需要 B/C 补齐的：受管理目录与进程、工程版本登记、应用事务、OS 隔离、停止/取消。

## 给任务 I（真实模型创作）的独立验收起点

模型要做的三件事都落在数据上，不需要改底座：

| 需求 | 落点 |
| --- | --- |
| 新增商品 / 改价 / 改库存 | `data/shops/general.json` 的 `items[]` |
| 调整规则（采集上限、任务需求数量） | `data/quests/*.json`、场景里 `GatherZone.max_charges` |
| 创建任务 | 新增 `data/quests/<id>.json` + NPC 节点的 `quest_id` |

验收入口：`node tools/verify.mjs`（30 项）与 `node tools/check-sync.mjs`。
模型改完后重跑即可；新增内容需要任务 I 自己补断言，而不是放宽现有断言。
