# 任务 G 接口说明：横版底座（side-view）

状态：已发布，供 B、C、I 对接。以本文件与代码提交为准。
基线：`46739d2`。分支 `codex/godot-parallel-g-20260909`。工作树 `D:/Craftmine World-worktrees/godot-parallel-g-20260909`。
底座根：`desktop/godot/bases/side-view/`。

## 0 边界

- 底座只负责游戏侧：运动、碰撞、摄像机、攻击、检查点、房间切换、存档、只读探针。
- 底座**不**构建、不导出、不启动 Godot、不读宿主凭据、不写存档目录以外任何位置。
- 底座**不**新增世界数据库、不新增 Agent 循环、不参与身份与事务。
- 未接入统一工作台前**不登记为已交付底座**；`DEVELOPMENT_STATUS.json` 未改。

## 1 身份

| 字段 | 值 |
| --- | --- |
| `baseId` | `side-view` |
| `baseVersion` | `1.0.0` |
| `stateVersion` | `1` |
| `entryScene` | `res://scenes/main.tscn` |
| `godotVersion` | `4.7.2-stable` |
| `renderer` | `gl_compatibility` |

宿主场景记录可直接使用 `build.scene.baseId = "side-view"`、`build.scene.entry = "res://scenes/main.tscn"`；世界列表标签取 `build.godot.baseId` / `build.scene.baseId`，字段缺失按旧运行器处理。

## 2 物化 `source/`

```powershell
node tools/new-world.mjs --world <blank|ruins> --out <dir> [--force]
```

复制共享运行时（`project.godot`、`manifest.json`、`params/`、`scripts/`、`scenes/`）+ 单个世界目录，并写入 `worlds/default.json` 与 `MATERIALIZED.json`（含 `worldId`、`kind`、`stateVersion`、`entryScene`）。

注意：Godot 的全局 `class_name` 由 `.godot/global_script_class_cache.cfg` 解析，首次运行前需要一次 `--import`（幂等、可缓存，属于任务 B 的 `import` 作业范围）。`tools/verify.mjs` 已内置该步骤；`.godot/` 已 gitignore，不进入源码清单。

## 3 只读探针与进度映射

`SideView.probe()`（格式 `craftmine.godot-sideview-probe/1`）字段：

| 字段 | 含义 |
| --- | --- |
| `stateHash` | 持久事实的 SHA-256（abilities / checkpoints / activeCheckpoint / rewards / counters / inventory）；走位不改变 |
| `abilities` | `{abilityId: true}` |
| `checkpoints.activated` / `checkpoints.active` | 已激活集合 / 当前重生点 |
| `rewards` | 已领取的一次性奖励 id |
| `rooms` | `{roomId: {visited, entries}}` |
| `counters` / `inventory` | 计数与物品 |
| `player` | `{room, x, y, facing}` |

`SideView.progress_dict()` 输出 `craftmine.progress/1`：

```json
{ "format": "craftmine.progress/1",
  "player": { "x": 809.9, "y": 439.9, "z": 0.0, "yaw": 0.0, "pitch": 0.0 } }
```

横版平面映射到 `x`/`y`，`z`/`yaw`/`pitch` 固定 0，可直接填入任务 B §6.2 的 `evidence.player`。

**没有 setter**：探针只能读，模型与验收都无法通过它写状态。

## 4 存档

- 根目录：`CRAFTMINE_SIDEVIEW_SAVE_DIR`（存在时）→ `<root>/<worldId>/state.json`；否则 `user://save/<worldId>/state.json`。
- 原子写：临时文件 → 旧文件转 `state.json.bak` → 重命名提交；重命名失败回滚，崩溃后可从 `.bak` 恢复。
- 状态版本不一致时**拒绝加载**，不静默清空；迁移归宿主。
- 待 C 提供：逐世界存档根，使进度与宿主世界身份绑定。

## 5 测试接口与隔离

`SideViewVerifier` 自动加载脚本在 `CRAFTMINE_SIDEVIEW_INPUT_PLAN` 未设置时完全休眠。激活后只能按脚本按键并读取探针，无任何写入玩家状态的入口（`verify.mjs` 有源码扫描断言）。

验收命令见 `REPORT_G.md` 第 3 节；运行方式为 `--headless --fixed-fps 60`、独立存档目录、固定引擎版本，不发送真实鼠标键盘、不请求 Pointer Lock、不激活窗口、不触碰用户数据。

## 6 需要 B/C/I 提供的接口

| 任务 | 需求 | 现状 |
| --- | --- | --- |
| B | 构建输入与场景记录接受 `baseId=side-view` | 待确认 |
| B | launch 回执是否需要底座自报 `instanceId` | 未实现，可加 |
| C | 传入逐世界存档根 | 未接 |
| C | 世界列表底座标签取 `build.scene.baseId` | 未接 |
| C | 从 probe 展示检查点/能力摘要 | 未接 |
| I | 统一工作台集成与验收后登记交付 | 未做 |

## 7 本文件不声称

宿主构建/应用接线、Electron 世界视图、世界列表 UI、安装包内容、可挖掘沙盒均不在本底座范围。可挖掘沙盒只有 `desktop/godot/bases/side-view/docs/sandbox-branch-interface.md` 的接口提案，未实现，A16 未宣称。
