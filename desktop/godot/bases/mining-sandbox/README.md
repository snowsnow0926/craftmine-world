# 2D 横版挖掘沙盒底座（mining-sandbox）

本目录是 Godot 多底座计划里 **GD5 可挖掘沙盒分支** 的独立交付物，对应验收故事
**A16**。它只负责这一条线：有限地图、瓦片破坏与放置、材料与制作、分块持久化。
它不改动共享协议、界面、Rust 核心、第一人称/俯视底座，也不扩展 F 的横版底座。

底座提供一个**空白起点**和一个**采矿—制作—建造短样例**，两者都是可以直接用
Godot 4.7.2 打开的独立工程。地形由 `world.json` 的参数确定性地生成，破坏和放置
记录在分块存档里；场景、脚本、参数、材料、物品、配方全部可读可改。

```text
desktop/godot/bases/mining-sandbox/
  manifest.json          底座清单：版本、协议号、世界模板、复用的横版基础
  core/                  底座运行时（会被复制进每个世界工程）
    scripts/             地形生成/服务、分块存档、背包、制作、状态、玩家、探针
    scenes/main.tscn     唯一入口场景
    project.godot.template
  params/
    mining_sandbox_params.json   运动/交互/网格/限额的唯一来源
  templates/
    blank/               空白起点模板（只含 world.json 参数）
    mine-camp/           采矿营地模板（矿脉、配方、制作台）
  worlds/
    blank/               由模板生成的空白起点世界（可提交、可直接打开）
    mine-camp/           由模板生成的采矿营地世界
  tools/
    new-world.mjs        从模板创建新世界（校验初始进度并写 world-build.json）
    check-sync.mjs       校验 worlds/ 与模板/核心/参数完全一致
  docs/
    SPEC.md              冻结的行为规范、数据格式与 A16 断言表
    ADR-0001-mining-sandbox.md   架构决策
    INTERFACE_BC.md      给 B/C/F/A/H/E/K 的接口与登记片段
    REUSE.md             复用 side-view 1.0.0 的来源与哈希
  contracts/
    shared-adapter.mining-sandbox.gd   交给 F 放进 shared/adapters/ 的适配器
  delivery/
    make-base-assets.mjs              生成给 K 的发行/许可清单（输出在报告目录）
  tests/godot-remaining/G/             独立 A16 验收矩阵（在仓库 tests/ 下）
```

## 短流程（采矿营地示例）

出生在地表 → 徒手挖土和石头 → 用 3 石头 + 2 木头制作石镐 → 石镐可以挖煤和铁矿 →
到营地熔炉处用 3 铁矿 + 1 煤熔炼铁锭 → 2 铁锭 + 2 木头制作铁镐 → 铁镐才能挖深层石 →
用 2 石头制作石砖并放置建造。破坏会掉落到背包，放置会消耗材料；关掉进程重开，
地形、数量和位置都保持一致。

规则要点（完整见 [docs/SPEC.md](docs/SPEC.md)）：

- 挖掘和放置都受 **距离**（默认 5 格）、**目标**（是否实心/是否空气）、**占用**
  （材料是否可放置）和 **相邻**（放置点旁边必须有实心块）约束。
- 不同材料有 **工具等级** 门槛：徒手挖不动煤矿/铁矿，石镐挖不动深层石。
- 放置永远不会把人物埋进实心块（`would_bury_player`）；存档里出现重叠时会在载入
  时把人移到上方最近的空位并上报，不会静默处理。
- 同一个 `requestId` 重复提交不会重复发物品或扣材料；已取消的请求不会再生效。

## 运行

需要一个 Godot 4.7.2-stable 编辑器构建（仓库固定版本）：

```powershell
$env:CRAFTMINE_GODOT_BIN = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable\editor\Godot_v4.7.2-stable_win64_console.exe'
& $env:CRAFTMINE_GODOT_BIN --path desktop/godot/bases/mining-sandbox/worlds/mine-camp
```

第一次打开前先导入一次：

```powershell
& $env:CRAFTMINE_GODOT_BIN --headless --path desktop/godot/bases/mining-sandbox/worlds/mine-camp --import
```

控制：`A`/`←` 与 `D`/`→` 左右移动，`Space`/`W`/`↑` 跳跃；`I`/`J`/`K`/`L` 移动格子光标，
`F` 挖掘光标所在格，`G` 放置当前可放置材料，`E` 制作（会尝试世界里的配方，需要制作台时
必须站在制作台附近）。这些动作在运行时注册，不写进 `project.godot`；不使用鼠标、指针锁定
或任何 OS 级输入捕获。

无窗口逻辑验收（不发送真实鼠标键盘，不创建或激活窗口）：

```powershell
node tests/godot-remaining/G/a16-acceptance.mjs
```

它是**独立**验收矩阵：自己用 JavaScript 重新实现一遍确定性地形生成来交叉校验引擎，
只通过探针接口驱动玩法，覆盖 SPEC 里冻结的 A16 断言（G01–G36）。

```powershell
node desktop/godot/bases/mining-sandbox/tools/check-sync.mjs
```

确认 `worlds/` 与模板、核心、参数完全一致；改过 `core/`、`params/` 或 `templates/`
之后必须重跑。

## 新建与修改一个世界

```powershell
node desktop/godot/bases/mining-sandbox/tools/new-world.mjs `
  --template mine-camp --world-id my-mine --name "我的矿场" --out D:\worlds\my-mine
```

**新世界只带初始进度**：工具会拒绝携带已领奖励、开局工具、零/负数物品、越界出生点或
未知矿石/配方的模板，所以从示例创建的世界不会继承作者玩过的进度。

常见修改点：

| 想改什么 | 改哪里 |
| --- | --- |
| 地图大小、地表高度、土层/岩层、矿脉、洞穴 | `world.json` 的 `generation` |
| 材料颜色、硬度门槛、掉落物、是否可放置 | `world.json` 的 `materials` |
| 物品与工具等级 | `world.json` 的 `items` |
| 配方与制作台 | `world.json` 的 `recipes`、`entities` |
| 出生点、初始背包 | `world.json` 的 `initialProgress` |
| 运动/跳跃/摄像机/距离/限额 | `params/mining_sandbox_params.json` |
| 玩法代码 | `scripts/base/*.gd`（每个世界工程里各有一份） |

## 稳定身份与状态版本

- 地形按 `tileSize = 16` 的整数网格寻址；分块 id 是 `"<tx/16>_<ty/16>"`，
  地图尺寸不是 16 的倍数时最后一列/最后一行是**部分块**。
- 地形是 `(seed, tx, ty, generation)` 的纯整数函数，不含浮点、不含引擎随机数、
  不含时间，因此同一 `generation` 块必然生成同一张地图（`terrainHash` 相同）。
- 存档只保存**与生成结果不同的瓦片**，按 `(ty, tx)` 排序；未改动的块没有文件，
  重开时按生成规则重建。
- 存档格式 `craftmine.godot-mining-sandbox-progress/1` + 分块
  `craftmine.godot-mining-sandbox-chunk/1`，状态版本 `stateVersion: 1`。
  载入逐字段校验并**整体拒绝**：坏档、缺块、哈希不符、版本变化都不会被部分应用。
- 进度目录可用环境变量 `CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT` 重定向，
  只用于验证真实写入失败，不是玩法开关。

## 已知边界

- **有限地图**：不做无限世界、液体、光照传播、多人或物理材质。
- 这是**开发时编写的样例**，不是真实 AI 创作结果；真实模型创作验收属于任务 I。
- headless 逻辑验收不等于 GPU 渲染、可见窗口合成或玩家手感。
- 引擎的 OS 级隔离属于 GD0/B，本目录不声称提供沙箱。
- 共享适配器（`desktop/godot/shared/adapters/mining-sandbox.gd`）、物化器登记、
  产品底座枚举和发行清单**由对应负责人接入**；未接入前本底座不会被登记为
  “已交付底座”。接口与可合并片段见 [docs/INTERFACE_BC.md](docs/INTERFACE_BC.md)。

素材来源与许可见 [ASSET_SOURCES.md](ASSET_SOURCES.md)。
行为细节见 [docs/SPEC.md](docs/SPEC.md)。
架构决策见 [docs/ADR-0001-mining-sandbox.md](docs/ADR-0001-mining-sandbox.md)。
复用的横版基础见 [docs/REUSE.md](docs/REUSE.md)。
