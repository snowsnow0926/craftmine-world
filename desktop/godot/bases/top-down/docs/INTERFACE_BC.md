# 俯视底座 ↔ 构建 / 保存 / 运行服务（B / C）接口说明

本文件只描述**本底座对外提供什么**和**需要对方提供什么**，不修改共享协议文件。
所有路径相对 `desktop/godot/bases/top-down/`。

## 1 底座对外承诺

| 项 | 值 |
| --- | --- |
| `baseId` | `top-down` |
| `baseVersion` | `1.0.0` |
| `baseProtocolVersion` | `1` |
| Godot | `4.7.2-stable`（仓库 `desktop/godot/toolchain.lock.json` 固定版本） |
| 语言 / 渲染 | GDScript / `gl_compatibility` |
| 世界格式 | `craftmine.godot-topdown-world/1` |
| 状态格式 | `craftmine.godot-topdown-state/1` |
| 存档格式 | `craftmine.godot-topdown-progress/1` |
| 探针格式 | `craftmine.godot-topdown-probe/1` |
| 状态版本 | `1` |

这些常量在 `core/scripts/base_contract.gd` 里，改任何一个都算协议变更，必须更新
`docs/ADR-0001-top-down-base.md`。

## 2 构建侧（B）

### 2.1 创建世界

```powershell
node tools/new-world.mjs --template town|blank --world-id <id> --name "<名称>" --out <目录>
```

- `world-id` 必须匹配 `^[a-z0-9][a-z0-9-]{1,47}$`。
- 目标目录已存在时必须显式 `--force`。
- 工具会拒绝 `initialProgress` 里带已领奖励的模板。
- 退出码非 0 表示没有产出可用工程。

### 2.2 构建回执 `world-build.json`

每个世界工程根目录都有 `world-build.json`，格式 `craftmine.godot-world-build/1`
（写在 `new-world.mjs` 里，字段以实际文件为准）：

```json
{
  "format": "craftmine.godot-world-build/1",
  "baseId": "top-down", "baseVersion": "1.0.0", "baseProtocolVersion": 1,
  "worldFormat": "...", "stateFormat": "...", "progressFormat": "...", "probeFormat": "...",
  "godotVersion": "4.7.2-stable",
  "worldId": "my-town", "template": "town", "entryScene": "res://scenes/overworld.tscn",
  "stateVersion": 1, "initialProgress": { ... },
  "userDirName": "craftmine-topdown-my-town",
  "files": [ { "path": "scenes/overworld.tscn", "bytes": 1234, "sha256": "..." } ]
}
```

`files` 覆盖除 `world-build.json` 自身以外的全部文件，按路径排序，可直接用于
"内容哈希 → 工程版本"的映射。B 侧如果已经有自己的工程版本概念，请把
`worldId + baseVersion + files 哈希` 一起记账。

### 2.3 导入与导出

```powershell
# 首次导入（资源、类名缓存）；改过素材后必须重跑
<godot> --headless --path <world> --import

# 运行（无窗口逻辑）
<godot> --headless --path <world>

# Web 导出（需要 4.7.2 的 web 模板）
<godot> --headless --path <world> --export-release Web <out>/index.html
```

注意事项：

- 用编辑器构建（`Godot_v4.7.2-stable_win64_console.exe`）才能 `--import` 和导出。
- **每次重新创建或覆盖世界目录后必须重新 `--import`**：`.godot/` 缓存被删掉时，
  贴图和全局类名都不可用，直接运行会报 "No loader found for resource"。
- 导出预设见 `tools/capture-web.mjs` 里生成的最小 `export_presets.cfg`；
  本底座没有提交固定的 `export_presets.cfg`，避免把本机绝对路径写进工程。
- 本底座没有原生插件、GDExtension 或工具脚本，导入阶段不执行第三方代码。

## 3 运行与保存侧（C）

### 3.1 无窗口逻辑运行

```powershell
<godot> --headless --path <world> -- --probe --probe-request=<req.json> --probe-response=<res.json>
```

- 只有同时给 `--probe` 和两个文件参数时探针才启用；普通运行不受影响。
- 请求 / 响应格式见 `docs/SPEC.md` 第 8 节。
- 探针调用的是游戏自己的方法，不发送 OS 鼠标键盘事件、不创建窗口、不请求 Pointer Lock。
- 进程退出码：`0` 探针跑完并写出响应；`64/65/66` 探针基础设施失败；
  **玩法断言是否通过由调用方读响应文件判定**，预期中的拒绝（如 `out_of_range`）
  不会让进程失败。

### 3.2 进度读写

- 路径：`user://worlds/<sha256(worldId)>/progress.json`，
  真实位置 = `<custom_user_dir_name>/worlds/<hash>/progress.json`。
- `custom_user_dir_name` 在 `project.godot` 里，等于 `craftmine-topdown-<worldId>`。
- Windows 下 `user://` 解析到 `%APPDATA%\<custom_user_dir_name>\`。
- 外层与内层格式见 `docs/SPEC.md` 第 7 节；载入是**全字段校验、整体拒绝**。
- 保存时机：显式 `save()`、状态变更后最多 1 秒写回、进程退出。
- 运行服务如果要"读取当前进度再应用候选"，请**先停实例再读文件**；
  本底座不提供跨进程的文件锁，两个进程同时写同一世界会产生后写覆盖。

### 3.3 场景内可查询事实

`snapshot` 返回：完整状态、当前 `sceneId`、重复实体 id、`bootError`、
真实重叠表 `physical.overlaps`、地图构建报告 `maps`、精灵朝向与帧号 `sprite`。
这些是**上报数据**，不是授权凭证；调用方不应据此跳过自己的校验。

## 4 需要 B / C 提供（本底座未实现）

1. **受管理的目录与进程**：本底座的工具直接在目标目录创建工程、直接调用引擎。
   正式路径需要由构建/运行服务分配目录、限制写范围、跟踪进程句柄与终态。
2. **工程版本登记**：把 `world-build.json` 的 `files` 哈希映射到 Rust 侧的工程版本、
   回执与恢复记录；本底座只保证回执内容可复现。
3. **应用事务**：候选预览实例与正式世界之间的事务、旧版本备份、失败回滚。
   本底座提供状态格式与"候选不得写回正式世界"的约定，但不实现事务。
4. **隔离**：GD0 的 OS 级访问范围与网络策略。本底座不声称提供沙箱。
5. **停止/取消**：本底座的探针是短进程；长运行实例需要运行服务负责终止与清理。

## 5 给任务 I（真实模型创作）的起点

模型要做的三件事，各自的落点：

| 需求 | 落点 | 不需要改底座 |
| --- | --- | --- |
| 新增商品 / 改价 / 改库存 | `data/shops/general.json` 的 `items[]` | 是 |
| 调整规则（例如采集上限、任务需求数量） | `data/quests/*.json`、场景里 `GatherZone.max_charges` | 是 |
| 创建任务 | 新增 `data/quests/<id>.json` + 在 NPC 节点上设 `quest_id` | 是 |

独立验收起点：

```powershell
node tools/verify.mjs          # 40 项行为检查，含商店边界、一次性奖励、重启、双实例
node tools/check-sync.mjs      # 确认 worlds/ 与模板一致
```

模型改完之后，`verify.mjs` 可以直接重跑；新增商品和任务应当反映在
`shop-*`、`quest-*` 这些检查上，如果只是改了 JSON 而没有对应断言，
应当由任务 I 自己补断言，而不是放宽现有断言。
