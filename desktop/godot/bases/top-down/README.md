# 2D 俯视底座与小镇示例（top-down）

本目录是 Godot 多底座计划里 **2D 俯视底座（GD4）** 的独立交付物。它只负责俯视这一条线，
不改动共享协议、UI、Rust 核心、第一人称底座或横版底座。

底座提供一个**空白起点**和一个**可玩小镇示例**，两者都是可以直接用 Godot 4.7.2 打开的
独立工程。场景、脚本、瓦片地图、数据表和素材全部可读可改。

```
desktop/godot/bases/top-down/
  manifest.json          底座清单：版本、协议号、世界模板
  core/                  底座运行时（会被复制进每个世界工程）
    scripts/             玩家、交互、区域、商店、任务、对话、存档、内部测试接口
    assets/              原创像素素材（PNG + TileSet）
    project.godot.template
    icon.svg
  templates/
    blank/               空白起点模板（场景 + 地图）
    town/                小镇示例模板（场景 + 地图 + 商品/任务/NPC 数据）
  worlds/
    blank/               由模板生成的空白起点世界（可提交、可直接打开）
    town/                由模板生成的小镇示例世界
  tools/
    make-assets.mjs      生成原创像素素材与 TileSet
    new-world.mjs        从模板创建新世界（写入初始进度）
    check-sync.mjs       校验 worlds/ 与模板一致
    verify.mjs           独立 headless 验收
    capture-web.mjs      Web 导出 + 无输入截图（画面证据）
  docs/
    SPEC.md              行为规范
    ADR-0001-top-down-base.md  架构决策
    INTERFACE_BC.md      给构建/保存/运行服务（B/C）的接口说明
```

## 短流程（小镇示例）

一条路 → 一间商店 → 一位 NPC → 采集交付任务：

1. 从出生点沿路走到南边草药丛，走进草丛按交互采集草药（最多 5 次，每次 1 份）。
2. 回到路上的米拉处，交付 3 份草药，得到 30 金币和 1 个苹果（**只能领一次**）。
3. 走到商店门口自动进入店内，靠近柜台购买面包 / 药水 / 苹果 / 绳子；
   离开柜台范围就不能购买，库存为 0 时不能购买，金币不够时不能购买。
4. 走出门口回到小镇，金币、背包、库存、任务状态都保持；关掉进程重开也一样。

## 运行

需要一个 Godot 4.7.2-stable 编辑器构建（仓库已有的固定版本）：

```powershell
$env:CRAFTMINE_GODOT_BIN = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable\editor\Godot_v4.7.2-stable_win64_console.exe'
& $env:CRAFTMINE_GODOT_BIN --path desktop/godot/bases/top-down/worlds/town
```

第一次打开前先导入一次资源：

```powershell
& $env:CRAFTMINE_GODOT_BIN --headless --path desktop/godot/bases/top-down/worlds/town --import
```

无窗口逻辑验收（不发送真实鼠标键盘，不创建或激活窗口）：

```powershell
node desktop/godot/bases/top-down/tools/verify.mjs
```

它会用临时目录创建 4 个世界实例、真实导入并跑完整检查，输出 `report.json` 与原始探针记录。

画面证据（Web 导出 + 独立 headless 浏览器截图，同样不发送任何输入）：

```powershell
node desktop/godot/bases/top-down/tools/capture-web.mjs --out <目录>
node desktop/godot/bases/top-down/tools/capture-web.mjs --out <目录> --scene res://scenes/shop_interior.tscn --shot shop-interior.png
```

## 修改一个世界

世界是独立的 Godot 工程，`worlds/town` 可以直接改；要新建世界用：

```powershell
node desktop/godot/bases/top-down/tools/new-world.mjs `
  --template town --world-id my-town --name "我的小镇" --out D:\worlds\my-town
```

**新世界只带初始进度**：`new-world.mjs` 在写盘后会校验模板的 `initialProgress`，
只要出现 `rewarded: true`、`status: "completed"`、非空 `grantedRewards`、负数金币或
负数背包数量就直接失败。所以从示例创建的新世界不会继承示例作者已经领过的奖励。
单独检查某个模板可以运行 `node tools/new-world.mjs --check-template templates/town`。

常见修改点：

| 想改什么 | 改哪里 |
| --- | --- |
| 商品、价格、库存 | `data/shops/general.json`（`items[].id/price/stock`） |
| 物品名称 | `data/items.json` |
| 任务需求与奖励 | `data/quests/herb-delivery.json` |
| NPC 台词（按任务状态） | `data/npcs/mira.json`、`data/npcs/shopkeeper.json` |
| 地图、道路、建筑、碰撞 | `data/maps/town-overworld.json`、`data/maps/town-shop-interior.json` |
| 出生点、可采集点、门、NPC 位置 | `scenes/overworld.tscn`、`scenes/shop_interior.tscn` |
| 人物和瓦片外观 | `assets/characters/*.png`、`assets/tiles/town_tiles.png`（保持 16×16 网格） |
| 初始金币 / 背包 / 任务状态 | `world.json` 的 `initialProgress` |

地图是文本：`layers[].rows` 每行一个字符串，`legend` 把字符映射到图集坐标；
`"collision": true` 的层里带 `"solid": true` 的字符会被合并成矩形碰撞体。

## 稳定身份与状态版本

- 每个实体在场景里声明稳定的 `entity_id`（如 `npc-mira`、`shop-general`、`zone-herb-patch`），
  状态按 id 存取，不按节点路径；同一场景出现重复 id 会在启动时报错并记录。
- 世界身份是 `world.json` 的 `worldId`；`user://` 目录名由它派生
  （`craftmine-topdown-<worldId>`），因此两个世界实例的进度天然隔离。
- 存档格式 `craftmine.godot-topdown-progress/1`，状态版本 `stateVersion: 1`。
  载入时逐字段校验，任何一个字段非法就整体拒绝，不做部分应用。

## 已知边界

- 这是**短流程示例**，不是完整 RPG：没有战斗、没有四季农场、没有大量剧情。
- 底座提供的是普通 GDScript 与场景/数据创作面；引擎本身的隔离仍由 GD0 的
  AppContainer 工作负责，本目录不声称解决了 OS 级隔离。
- headless 逻辑验收不等于 GPU 渲染或玩家手感；画面证据只证明对应构建确实出图。
- 场景切换是重新加载场景（可解释的加载），不做任意脚本热更新。

素材来源与许可见 [ASSET_SOURCES.md](ASSET_SOURCES.md)。
行为细节见 [docs/SPEC.md](docs/SPEC.md)。
给 B/C 的接口见 [docs/INTERFACE_BC.md](docs/INTERFACE_BC.md)。
