# 俯视底座行为规范（top-down spec）

规范版本：`baseProtocolVersion: 1`；状态版本：`stateVersion: 1`。
实现位于 `core/scripts/`，每个世界工程里有一份副本。

## 1 身份

| 概念 | 来源 | 约束 |
| --- | --- | --- |
| 世界身份 `worldId` | `world.json` | `^[a-z0-9][a-z0-9-]{1,47}$`，由创建工具写入 |
| 实体身份 `entity_id` | 场景节点上的导出属性 | 场景内唯一；重复会在启动时报错并记录在快照 |
| 数据身份 `id` | `data/**/*.json` | 商品、任务、NPC、地图各自唯一 |
| 区域身份 `zone_id` | 区域节点 | 用于采集与门；状态里的 flag 键为 `zone.<zone_id>.gathered` |

状态永远按这些 id 存取，不按节点路径、数组下标或节点顺序。因此重排节点、改场景
层级、给节点改名都不会丢失进度；只有改 id 才会。

## 2 移动与碰撞

- 玩家是 `CharacterBody2D`，每物理帧设置 `velocity` 后调用 `move_and_slide()`。
- 碰撞体来自地图的 `collision` 层：每行连续的实心格合并成一个 `RectangleShape2D`，
  放在场景的 `StaticBody2D` 下。因此撞墙、卡门口、绕过木箱都是真实物理，不是脚本判定。
- 朝向由移动向量的主轴决定（`|dx| >= |dy|` 取左右，否则取上下）；静止时保持上一次朝向。
- 方向动画：`DirectionalSprite` 用一张 4×4 行走图，行 = 下/左/右/上，列 = 4 帧；
  移动时按 `frame_time` 推进，静止时回到第 0 帧。

## 3 交互与范围

- 可交互物是 `Area2D`（`Interactable` 及其子类：`Shop`、`Npc`）。
- 玩家有一个 `InteractRange` 区域（半径 22）用来算"当前焦点"，只影响提示与 UI。
- **所有动作自己重新做几何检查**：`Shop.buy`、`Npc.talk`、`QuestManager.deliver`
  都要求 `area.overlaps_body(player)` 为真。任何调用方（脚本、探针、将来的 UI）
  都无法绕过这一点。距离外调用返回 `out_of_range`，且不改变任何状态。
- 区域（`TopDownZone`）报告真实的 `body_entered` / `body_exited`，并支持
  `contains(body)` 即时查询。门和采集点都建立在这上面。

## 4 商店

数据：`data/shops/<shop_id>.json`

```json
{ "id": "general", "title": "杂货铺",
  "items": [ { "id": "bread", "price": 6, "stock": 3 } ] }
```

`buy(item_id, actor)` 的判定顺序（全部通过才提交）：

1. `enabled` 为真，否则 `shop_disabled`
2. `actor` 与柜台区域真实重叠，否则 `out_of_range`
3. 商品在目录里，否则 `unknown_item`
4. `stock > 0`，否则 `out_of_stock`
5. `price >= 0`，否则 `invalid_price`
6. `coins >= price`，否则 `not_enough_coins`

通过后**一次性**提交：`coins -= price`、`inventory[item] += 1`、`stock -= 1`。
三者要么都变，要么都不变；返回值带提交后的 `coins`、`inventory`、`stock`，便于对账。
库存不会低于 0（`set_stock` 里有 `maxi(0, ...)`）。

## 5 任务与一次性奖励

数据：`data/quests/<quest_id>.json`

```json
{ "id": "herb-delivery", "giver": "npc-mira",
  "requires": { "itemId": "herb", "count": 3 },
  "reward": { "coins": 30, "items": [ { "id": "apple", "count": 1 } ] } }
```

`deliver(quest_id, giver, actor)` 的判定顺序：

1. 任务数据存在，否则 `unknown_quest`
2. `actor` 与发布者区域真实重叠，否则 `out_of_range`
3. `giver` 的 `entity_id` 等于任务声明的 `giver`（声明为空时不检查），否则 `wrong_giver`
   —— 这一条挡住"把任务 id 传给另一个 NPC 再领一次"的路径
4. 确保任务记录存在（`ensure_quest`），使后续账本写入不可能中途失败
5. **奖励尚未发放**：`quests[id].rewarded == false`、`grantedRewards["<id>#reward"]`
   不存在、且 `quests[id].status != "completed"`，否则 `already_rewarded`
   —— 这一步在扣除物品之前，所以重复交付不会吞掉玩家材料
6. 需求物品和数量配置合法，否则 `quest_is_misconfigured`
7. 背包数量足够，否则 `missing_items`

通过后一次性提交：扣材料 → 加金币 → 加奖励物品 → 同时写
`quests[id].rewarded = true` 与 `grantedRewards["<id>#reward"] = true`
→ 状态置为 `completed`。

**两个账本互相独立**：只改任务标志而漏掉奖励账本（或反过来）的实现会被另一个账本挡住，
所以新增的第三方任务脚本也不可能重复发奖。两个账本都在存档里，因此完整重启后仍然
只发一次。

NPC 台词由 `data/npcs/<id>.json` 的 `lines` 决定，按顺序取第一条
`when` 等于当前任务状态（`inactive` / `active` / `completed`）或 `always` 的台词。

## 6 场景切换

- 门是 `DoorZone`（区域 + `trigger_on_enter`），玩家真实进入即切换场景。
- 切换前把当前场景的玩家位置记进 `state.scenePositions[<sceneId>]`。
- 到达新场景时：优先用 `spawn_id` 指定的出生点；否则用该场景上次记录的位置；
  否则用场景里玩家节点的初始位置。
- 切换用 `SceneTree.change_scene_to_file`，属于可解释的重新加载；金币、背包、库存、
  任务、采集次数都在自动加载单例 `Game` 里，因此跨场景保持。
- 出生点故意放在离返回门一段距离处，避免来回弹跳。

## 7 存档与恢复

- 路径：`user://worlds/<sha256(worldId)>/progress.json`
- 外层：`{ format: "craftmine.godot-topdown-progress/1", worldId, savedAt, state }`
- 内层 `state`：`{ format, stateVersion, worldId, coins, inventory, shops, quests,
  grantedRewards, flags, scenePositions, player }`
- 载入时逐字段校验类型与范围（金币与库存非负整数、朝向枚举、坐标有限数等），
  任一字段非法则**整体拒绝**并保留原状态，同时记录 `bootError`。
- `worldId` 与文件内 `worldId` 不一致时拒绝，避免把别的世界的进度套进来。
- 保存时机：显式 `save()`；状态变更后最多 1 秒的写回；进程退出时（`_exit_tree` /
  `NOTIFICATION_WM_CLOSE_REQUEST` / `NOTIFICATION_PREDELETE`）。
- `user://` 目录名由 `application/config/custom_user_dir_name` 决定，
  创建工具写成 `craftmine-topdown-<worldId>`，因此两个世界实例天然隔离。

## 8 内部测试接口（探针）

仅当命令行带 `-- --probe --probe-request=<文件> --probe-response=<文件>` 时启用，
由 `core/scripts/probe.gd` 实现。它调用的是游戏自己的方法，不发送任何 OS 输入事件。

请求：

```json
{ "format": "craftmine.godot-topdown-probe/1", "saveOnExit": true,
  "commands": [ { "op": "move", "args": { "dx": 0, "dy": -1, "steps": 40 } } ] }
```

操作：`snapshot`、`wait`、`move`、`set-position`、`focus`、`interact`、`buy`、
`talk`、`gather`、`deliver`、`change-scene`、`save`、`restore`、`reset-to-initial`、`quit`。

- `move` 只设置玩家下一帧的输入向量，位移、碰撞、动画都由真实物理产生。
- `set-position` 是**场景搭建**用的瞬移，规范里任何玩法规则都不得依赖它；
  移动之后所有动作仍要重新做真实重叠检查。
- 每个操作返回 `ok` 和（拒绝时的）`reason`，大多数操作附带提交后的 `snapshot`。
- 响应里的 `finalSnapshot` 含：状态、场景 id、重复实体 id、`bootError`、
  真实重叠表 `physical.overlaps`、地图构建报告、精灵朝向与帧号。

## 9 错误码

| 错误码 | 含义 |
| --- | --- |
| `out_of_range` | 与目标区域没有真实重叠 |
| `unknown_item` / `unknown_shop` / `unknown_npc` / `unknown_zone` | id 不在当前场景或数据里 |
| `out_of_stock` | 库存为 0 |
| `not_enough_coins` | 金币不足 |
| `already_rewarded` | 该任务奖励已发放，或任务状态已是 `completed` |
| `missing_items` | 交付所需物品不足 |
| `wrong_giver` | 把任务交给了不是它声明的发布者 |
| `quest_is_misconfigured` | 任务数据缺少合法的 `requires` |
| `shop_disabled` / `disabled` | 交互物被禁用 |
| `invalid_price` | 商品价格为负 |
| `unsupported_op` | 探针收到未知操作 |
| `scene_not_bound` | 场景切换后新场景未在超时内完成绑定 |

## Integration audit persistence requirements

See [the shared authored-base audit contract](../../tests/PERSISTENCE_AUDIT.md) and
[the state-boundary decision](../../tests/ADR-0001-audit-state-boundary.md).
Foreign or rejected progress must not mutate live state or overwrite the prior save.
The audit regression entry point is `desktop/godot/bases/tests/audit-persistence.mjs`.
