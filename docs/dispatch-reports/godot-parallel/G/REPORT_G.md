# 任务 G 报告：Godot 横版底座与最小能力解锁探索样例

状态：**独立开发与独立验收完成；未接入统一工作台，未注册为产品已交付底座。**
基线：`46739d2`（本次分工 master）。分支 `codex/godot-parallel-g-20260909`，工作树 `D:/Craftmine World-worktrees/godot-parallel-g-20260909`。

## 1 交付范围

只新增以下路径，未改动共享协议、UI、Rust 核心、其他底座或全局状态文件：

- `desktop/godot/bases/side-view/**`（底座本体、两个世界、工具、文档）
- `docs/dispatch-reports/godot-parallel/G/**`（本报告与证据）

没有修改 `DEVELOPMENT_STATUS.json`、`GODOT_MULTIBASE_DEVELOPMENT_PLAN.md`、`GODOT_DEVELOPMENT_LOG.md`、`docs/parallel-w2-w5/**`、`app/**`、`desktop/godot/sandbox/**`、`desktop/godot/bases/top-down/**`（F 的俯视底座保持原样，GD4 主线顺序未受影响）。

## 2 实现内容

引擎 `4.7.2-stable`、GDScript、`gl_compatibility`、60 Hz 物理。入口 `res://scenes/main.tscn`。

| 要求 | 实现 |
| --- | --- |
| 重力、跳跃、平台碰撞 | `CharacterBody2D` 真实物理；`scripts/player/side_view_player.gd` |
| 摄像机 | 随房间边界钳制的 `Camera2D`，带平滑与前瞻 |
| 基础攻击 | `Area2D` 命中盒，按真实重叠结算 `receive_hit`，冷却 0.35s |
| 检查点 | `Area2D` 触发即成为重生点，持久化 |
| 两个以上相连房间与返回路径 | `entrance ↔ ruins ↔ vault` 三室，全部双向门 |
| 普通跳跃无法通过的区域 | `ruins` 右侧 190 px 高台，单跳 136.1 px 不可达 |
| 二段跳后进入 | 拾取 `double_jump` 后总升程 249.9 px，可上高台进入 `vault` |
| 能力/检查点/房间/一次性奖励持久 | `state.json` 原子写 + 备份恢复，稳定字符串 id |
| 空白起点与小型遗迹样例 | `worlds/blank`、`worlds/ruins` |
| 参数可继续创作 | 全部数值集中在 `params/side_view_params.json`，运行时/工具/文档同源 |
| 可挖掘沙盒 | 仅 `docs/sandbox-branch-interface.md` 接口与待办，**未实现**，未与类银河城混做，未宣称 A16 |

### 2.1 门控是几何事实，不是脚本开关

高台实体占 `x 820..960, y 250..440`，左侧面是从地面到台面的整面墙。门控值直接来自参数：

- 单跳升程 `700² / (2×1800) = 136.111 px` → 距 190 px 差 **53.889 px**，不可达
- 二段跳总升程 `136.111 + 640²/3600 = 249.889 px` → 富余 **59.889 px**，可达

`tools/gate-metrics.mjs` 独立重算两个余量并设 16 px 最低余量阈值；物理验收再实测一遍。

## 3 实际验证与原始证据

命令（Windows PowerShell，独立 headless 进程、独立数据目录、固定步长）：

```powershell
$env:CRAFTMINE_GODOT_BIN = "D:\Craftmine World\desktop\build\godot\4.7.2-stable\editor\Godot_v4.7.2-stable_win64_console.exe"
$env:CRAFTMINE_SIDEVIEW_TEST_ROOT = "<隔离目录>"
node tools/gate-metrics.mjs
node tools/verify.mjs
```

结果：**80/80 通过**，连续两次独立运行（`sv-acc-8`、`sv-acc-9`）逐项指标完全一致，物理过程确定。

证据文件：`evidence/verify-report.json`、`evidence/gate-metrics.json`、`evidence/run-facts.json`（含每次运行的终态、事件时间线、56 个源文件哈希与源码树哈希 `cfe96726e1621d530d672f9d7d24395f151089e36bd33ca87a522c6e2f13db60`）。

### 3.1 关键实测轨迹（来自 `evidence/run-facts.json`）

| 运行 | 场景 | 终态事实 |
| --- | --- | --- |
| A | 从空白入口靠真实操作走到遗迹 | `room=ruins`、`cp_ruins` 激活、一次性宝箱已领取、金币 5、**无能力** |
| B | 未解锁时满高度单跳撞墙 6 秒 | 全程未进入 `vault`，无 `double_jump`，`ruins` 内最高脚底 `y=314.03`（台面 250），未越过 |
| C | 跳上低平台拾取能力 | `ability_gained{abilityId:double_jump, source:pickup}`，落点在平台（`y<380`），磁盘 `state.json` 已写入 |
| D | **新进程重启后**进入高台 | 首帧 `doubleJumpUnlocked=true`；t=1 地面跳、t=26 二段跳、t=52 从 `y=208.9`（台面上方）穿过 `door_vault` 进入 `vault` |
| E | 原路返回旧房间 | 能力保留，金币 `15→15` 未重复发放，`entrance/ruins/vault` 进入次数递增，检查点保持 |
| F | 走入尖刺 | `player_died{cause:hazard:spikes_entrance}` → `player_respawned{checkpointId:cp_entrance}` |
| G | 空白起点 | 跑、跳、攻击击破木桩并只发一次奖励，无能力 |
| H | 宿主物化目录 | `new-world.mjs` 产出的独立工程导入后直接跑通并进入 `ruins` |

### 3.2 反作弊约束（同一套验收里强制）

- **无坐标写入**：源码扫描断言 `side_view_player.gd` 中唯一写 `position` 的函数是 `place_at`，且 `place_at` 只被房间管理器与死亡重生调用。
- **测试接口不可写状态**：扫描断言 `headless_verifier.gd` 不含 `grant_ability / collect_reward / activate_checkpoint / add_counter / place_at / position =`。
- **无瞬移**：逐帧位移上限（水平 ≤5 px/tick、垂直 ≤32 px/tick），只有房间切换与重生的合法落位被排除。
- **能力只来自拾取**：断言 `ability_gained.source == "pickup"`，且落点在平台上。
- **重启是新进程**：D 场景为独立进程，`boot.loaded=true` 且首帧即持有能力。

> 该约束在开发中真的抓到过缺陷：脚本输入源曾把重叠段累加导致 `move_axis=2`（玩家 520 px/s），逐帧位移检查报 `dx/tick=8.667` 并阻断，修复后为 4.333。

## 4 接口与宿主边界

- 底座只声明身份：`baseId=side-view`、`baseVersion=1.0.0`、`stateVersion=1`、`entryScene=res://scenes/main.tscn`，见 `manifest.json`。
- 对齐任务 B：`probe().stateHash` 覆盖持久事实（走位不改变），`progress_dict()` 输出 `craftmine.progress/1`（平面映射到 x/y，z=yaw=pitch=0），可直接作为 `godotApplication.commit` 的 launch 证据字段。
- 对齐任务 C：存档根由 `CRAFTMINE_SIDEVIEW_SAVE_DIR` 注入，未设置时退回 `user://save/<worldId>`；**待 C 决定逐世界存档根并传入**。
- 宿主权限分离：底座不构建、不导出、不启动 Godot、不读凭据、不写存档目录以外任何位置；headless 验证器只在 `CRAFTMINE_SIDEVIEW_INPUT_PLAN` 存在时激活。
- 物化入口：`node tools/new-world.mjs --world <blank|ruins> --out <dir>` 产出任务 B 需要的 `source/` 形状；首次需一次 `--import`（`verify.mjs` 已内置，B 的 `import` 作业本来就有这一步）。
- 详细契约见 `docs/dispatch-reports/godot-parallel/G/INTERFACE_G.md` 与 `desktop/godot/bases/side-view/docs/host-integration.md`。

## 5 素材来源

本底座**不含任何第三方素材**：所有可见元素（角色、平台、尖刺、拾取物、木桩、门、检查点）都是运行时用 `Polygon2D`/`ImageTexture` 生成的纯色图形，背景由 `_draw()` 绘制。无图片、音频、模型、字体、瓦片集，因此没有需要核对的素材许可。引擎为项目已锁定的 Godot 4.7.2（MIT），其声明由宿主打包任务处理。详见 `desktop/godot/bases/side-view/docs/assets-and-provenance.md`。

## 6 未完成项与边界

1. **未接入统一工作台**：未跑工作台集成与统一验收，因此按分工要求**不注册为产品已交付底座**，不改 `DEVELOPMENT_STATUS.json`。
2. **未做宿主接线**：`godotBuild.start` / `godotApplication.*` 的实际调用、逐世界存档根、世界列表底座标签由 B/C/I 负责。
3. **可挖掘沙盒未实现**：只有接口与待办，A16 未宣称。
4. **未验证项**：GPU 渲染、可见窗口合成、真实手感、音效与动画、原生 Electron 视图均未涉及；headless 通过不等于这些通过。
5. **已知限制**：状态版本不一致时拒绝加载而不迁移（迁移归宿主）；单一房间同时只存在一个，挖掘型分支需要不同的生命周期。

## 7 需要其他任务提供的接口

| 任务 | 需求 |
| --- | --- |
| B | 构建输入与场景记录接受 `baseId=side-view`；确认 launch 回执是否需要底座自报实例标记 |
| C | 传入逐世界存档根；按 `build.scene.baseId` 显示底座标签；从 probe 读取检查点/能力摘要 |
| I | 在工作台集成中运行本底座验收矩阵后再登记交付 |

## 8 提交与工作树

- 工作树：`D:/Craftmine World-worktrees/godot-parallel-g-20260909`
- 分支：`codex/godot-parallel-g-20260909`
- 提交哈希：见 `DELIVERY_G.json`
- 未合并 master、未推送、未清理其他工作树。
