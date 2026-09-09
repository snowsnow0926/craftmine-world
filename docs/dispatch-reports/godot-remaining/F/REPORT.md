# F 交付报告：三种可编辑底座、空白起点与通用组件

- 任务：`F-editable-bases-and-components`（GD3–GD5 固定工程基础）
- 分支：`codex/godot-remaining-f-20260910`，继承 `564e43a32ade84b8af1739a2e9f4a999ab97620d`
- 工作树：`D:/Craftmine World-worktrees/godot-remaining-f-20260910`
- 提交：`9fdc7e1`、`9ca9c36`、`eb196ac`、`1955962`、`7873ebc`（本报告与 ADR 为最后一次提交）
- 引擎：官方 Godot `4.7.2.stable.official.ed1daf0bf`，`gl_compatibility`，全部 `--headless`，独立存档与 profile 目录
- 证据目录：`docs/dispatch-reports/godot-remaining/F/evidence/`（`environment.json` 记录引擎、二进制哈希、源码身份）

**结论：本轮把三个底座接入同一份版本化契约、创建清单和组件库，修好横版空白起点与门槛，补齐第一人称的创建工具和按键绑定。三套真实引擎验收全部通过（第一人称 52/52、俯视 40/40、横版 89/89）。仍未完成的是产品级 Web/Electron/Rust 全链路复跑（本机缺 electron/esbuild 依赖）与真实模型创作验收，逐项列在文末。**

## 1 交付内容（逐条对照专责任务）

### 任务 1：空白起点 + 短小可玩样例 + 版本化契约

| 底座 | 空白起点 | 样例 | 契约 |
| --- | --- | --- | --- |
| first-person | `blank`（`scenes/blank_start.tscn`，0 目标/0 交互物/0 任务，新加 `data/balance/blank_start.tres`） | `training-range`（3 目标、2 交互物、1 任务） | `base_manifest.json` 新增 `contract`/`protocols`/`templates`/`components` |
| top-down | `blank`（空房间，`coins 0`、无商店/任务/奖励） | `town`（一条路、一间商店、一位 NPC、一个采集交付任务） | `manifest.json` 新增同名字段并修正 `tools.syncBase` |
| side-view | `blank`（**本轮改为真正空白**：删掉检查点与奖励木桩） | `ruins`（3 房间、一次性宝箱、木桩、可破坏箱、二段跳拾取、190 px 高台） | `manifest.json` 新增同名字段与 `assets/ASSET_MANIFEST.json` |

- `craftmine.godot-base-contract/1` 统一引擎、世界/状态/进度/探针格式、状态保留字段与迁移表、素材清单与许可、模板与组件。校验器会拒绝缺少状态契约、缺少素材清单或组件文件越界的清单。
- 创建守卫 `assertTemplateInitialState`：空白起点一旦带已完成任务、已领奖励、检查点、目标或能力即拒绝。`bases/tests` 与 F 测试都覆盖。
- 创建时分配新身份：三个底座都写 `worldId`；横版额外写 `templateId` 并修正此前把模板 id 当世界 id 的问题。

### 任务 2：可查看、修改、另存、拆出复用 + E/H 接口

- `desktop/godot/bases/base-catalog.json`（`craftmine.godot-base-catalog/1`）：给 E 的创建清单——每个底座的两个模板、入口场景、初始状态、创建命令、世界 id 规则、`materializeBase` 调用示例、验收命令。
- `desktop/godot/bases/component-catalog.json`（`craftmine.godot-component-catalog/1`）：给 H 的打包输入——22 个组件的文件清单（含字节数与 SHA-256）、稳定身份字段、持久字段、初始状态、兼容底座。
- `desktop/godot/shared/tools/build-base-catalog.mjs` 从清单生成这两份文件，`--check` 在漂移时退出 1；`contracts.test.mjs` 每次比对磁盘与生成结果。
- 源码、场景、资源、参数全部为文本；`desktop/godot/bases/README.md` 给出创建与组件库用法。

### 任务 3：3D 真实相机/准星/挂点/装备/攻击

沿用并验证已有实现（`camera_rig.gd`、`crosshair.gd`、`equipment_visuals.gd` 挂在真实 `Camera3D` 下、`attack_dispatcher.gd`/`ranged_attack.gd`/`melee_attack.gd`、`equipment_state.gd` 单一装备来源、弹药/冷却/伤害）。本轮补齐：

- `BaseWorld._unhandled_input` 实现此前只在 `project.godot` 声明却无人处理的 `reload`/`interact`/`equip_primary`/`equip_secondary`/`equip_next`/`quicksave`，全部走真实系统。
- `Interactable` 新增 `@export var entity_id`，`state_id()` 回退节点名——组件身份稳定且不破坏既有存档。
- 空白起点接入 `data/balance/blank_start.tres`。
- 第一人称 `tools/new-world.mjs`：`--template blank|training-range`，写 `world.json`（`craftmine.godot-first-person-world/1`）与哈希化的 `world-build.json`（`craftmine.godot-world-build/1`），拒绝带已完成进度的模板。

### 任务 4：横版运动/跳跃/平台/战斗/检查点/房间/二段跳回访

- **空白起点真正空白**：`worlds/blank/world.json` 删除 `cp_start` 与奖励木桩 `dummy_start`；G 场景改为断言无奖励、无金币、无检查点、无能力。
- **门槛运行时强制**：`SideViewRoomManager.gate_blocks_room()` 与 `required_ability_for()` 在进入被 gate 解锁的房间前检查能力并发出 `gate_blocked`；`room_door.gd` 在进门时同样先判定。跳高被调参或脚本直接请求换房都无法假通过。
- 新增 `I_gate_guard` 真机场景：直接向房间管理器请求进入 vault（无二段跳），断言被拒且未离开入口房间。
- 探索分支与 G 的挖掘分支边界写入 `docs/sandbox-branch-interface.md` 第 6 节：F 独占横版基础与共享层，G 另建分支，只能读取本底座的脚本/契约/组件目录，不得改运动、房间生命周期或共享适配器。

### 任务 5：可组合组件 + 稳定身份 + 可迁移状态

- 22 个组件声明在三个底座清单中：`fp.interactable`/`pickup-item`/`ammo-crate`/`target-dummy`/`equipment-item`/`quest`/`crosshair`、`td.door`/`interactable`/`npc-dialogue`/`shop`/`quest`/`gather-zone`/`spawn-marker`/`player`、`sv.room-door`/`checkpoint`/`ability-pickup`/`reward-pickup`/`target`/`hazard`/`spawn`。
- `components.mjs`：`componentPackageInput`（H）、`extractInstance`（从真实世界读实例）、`planInstallation`/`applyInstallation`（分配新实体 id、从初始状态实例化）。数据驱动组件真实写入 `world.json` / `data/**.json`；场景节点组件返回显式 `sceneEdits`，**从不改写 `.tscn`**。
- 新持久字段同步规则：本轮未新增持久字段，`stateVersion` 保持 1；测试比对全部字段，未删除或归一化任何字段。

### 任务 6：只读观察 + 有界操作接口

- `craftmine.godot-observation/1`：`worldId/buildId/instanceId/baseId/baseVersion/sampledAt/payload`。`runtime_bridge.gd` 新增**增量** `observe-envelope` op，原 `observe` 形状不变（cycle-06 消费方不受影响）。
- `observation.mjs` 按底座声明有界操作（参数名与真实适配器一致），拒绝全部写状态操作（`restore-state`、`set-world-id`、`teleport`、`set-health`、`grant-reward` 等）。
- 第一人称托管适配器从“转发全部 BaseOps”改为显式白名单，并把 `walk`/`wait` 限制在 600 物理帧；F 测试交叉校验三个适配器白名单与共享 schema 完全一致。

## 2 验证结果

| 验证 | 结果 | 性质 |
| --- | --- | --- |
| `node --test tests/godot-remaining/F/*.test.mjs` | **32/32** | 纯逻辑：契约、目录漂移、组件提取/安装、观察与有界操作、创建工具 |
| `node desktop/godot/bases/first-person/tests/acceptance_headless.mjs` | **52/52，退出 0** | 真实引擎：导入、准星居中、持枪挂点、射击/冷却/换弹/伤害、任务一次性奖励、空白起点、跨进程恢复、世界隔离、源码修改保留进度 |
| `node desktop/godot/bases/top-down/tools/verify.mjs --godot <console.exe>` | **40/40** | 真实引擎：商店边界、采集、一次性任务奖励、方向动画、跨进程重启、双实例独立、空白起点无继承、场景位置恢复 |
| `node desktop/godot/bases/side-view/tools/verify.mjs` | **89/89**（A–I 九场景） | 真实引擎：房间切换、门槛物理、能力拾取、跨进程二段跳进 vault、回访不重复奖励、危险重生、空白起点为空、**I 门槛运行时拒绝** |
| `node desktop/godot/bases/side-view/tools/gate-metrics.mjs` | `GATE_METRICS_OK` | 单跳 136.1 px 被挡、双跳 249.9 px 通过 |
| 生成世界真机冒烟 | blank：0 目标/0 交互物/0 任务；training-range：3/2/1 | 真实引擎探针（`creation-smoke.json`） |
| 共享 GDScript 编译检查 | `state_guard.gd`、`runtime_bridge.gd`、`base_adapter.gd` 均退出 0 | 在 `materializeBase` 生成的真实托管第一人称工程中 `--check-only`（含 import） |
| 托管工程生成 | `craftmine.managed-base-source/1`，68 个文件 | `materializeBase` 真实产出 |

复现命令（引擎缓存来自主目录只读缓存）：

```powershell
$env:CRAFTMINE_GODOT_CACHE_DIR = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable'
node --test tests/godot-remaining/F/contracts.test.mjs tests/godot-remaining/F/components.test.mjs tests/godot-remaining/F/observation.test.mjs tests/godot-remaining/F/base-creation.test.mjs
node desktop/godot/bases/first-person/tests/acceptance_headless.mjs
$env:CRAFTMINE_GODOT_BIN = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable\editor\Godot_v4.7.2-stable_win64_console.exe'
node desktop/godot/bases/side-view/tools/verify.mjs
node desktop/godot/bases/top-down/tools/verify.mjs --godot $env:CRAFTMINE_GODOT_BIN --out <dir> --work <dir>
```

证据：`evidence/first-person-headless.json`、`evidence/top-down-verify.json`、`evidence/side-view-verify.json`、`evidence/creation-smoke.json`、`evidence/environment.json`。

## 3 给其他任务的接口

| 任务 | 输入 |
| --- | --- |
| E（界面/创建） | `desktop/godot/bases/base-catalog.json`：模板 id、入口场景、初始状态、创建命令、世界 id 规则、`materializeBase` 参数；`desktop/godot/bases/README.md` |
| H（复用/打包） | `desktop/godot/bases/component-catalog.json` + `components.mjs` 的 `componentPackageInput`/`extractInstance`；每组件文件哈希、身份字段、持久字段、初始状态 |
| L（模型工具） | `observation.mjs` 的有界操作 schema 与 `components.mjs` 的解析接口；`craftmine.godot-observation/1` 信封 |
| I（独立验收） | `observe-envelope`（含 buildId/sampledAt）+ 写状态操作拒绝清单；三个底座的真机验收命令 |
| G（挖掘沙盒） | `side-view/docs/sandbox-branch-interface.md` 第 6 节：只读复用范围与不可改文件 |

## 4 保留的失败与限制

- 首次运行 `first-person/tools/new-world.mjs` 时复制函数丢失子目录层级，生成工程 `res://scenes/blank_start.tscn` 打不开；已修正并重跑生成 + 真机冒烟。原始失败输出未归档（临时目录已清理），失败现象与修复记录在本报告。
- 首次 `base-creation.test.mjs` 的 top-down `--check-template` 传了相对路径被二次拼接，测试失败；已改为相对底座目录的 `templates/blank`。
- `runtime_bridge.gd` 的 `observe-envelope` 只在 Web 导出内可用（`OS.has_feature("web")`）。本机没有 electron/esbuild 依赖（`tests/godot-runtime-native.mjs` 需要 `CRAFTMINE_NATIVE_DEPENDENCY_ROOT`、`CRAFTMINE_ELECTRON_BIN`、`CRAFTMINE_CORE_BIN`），因此**未复跑**产品 Web/Electron/Rust 42 项链路；本报告不声称该链路通过。已用真实引擎 `--check-only` 证明共享脚本可编译，用纯逻辑测试证明信封字段与白名单一致。
- 场景节点组件（俯视的门/商店/NPC、第一人称的拾取物/目标）只生成安装计划与手动步骤，不自动改写 `.tscn`。这是有意的边界，不是已完成项。
- 未做真实模型创作验收（属 I）；未验证可见窗口合成、玩家手感、OS 隔离；`baseVersion` 未升版（改动为增量，无持久字段变化）。
- 侧视 `tools/verify.mjs` 的 `README.md` 旧“69 项/7 场景”描述已更正为实际 9 场景；检查数由脚本输出决定（当前 89）。

## 5 未完成项与下一步入口

1. **产品全链路复跑**：等主任务/集成树提供 electron/esbuild/Rust 依赖后运行
   `node tests/godot-runtime-native.mjs`（三底座 Web/Electron/Rust，含 `observe`/`save`/重启）。需要环境变量见 `desktop/godot/shared/README.md`。
2. **E 的实际创建接线**：用 `base-catalog.json` 驱动“选择底座 → 空白/样例 → 命名 → 创建”，并调用各底座 `new-world.mjs` 或 `materializeBase`。
3. **H 的组件安装闭环**：用 `componentPackageInput` + `planInstallation`/`applyInstallation` 做跨世界自动门两实例、一实例变色、宝箱/商店升级保持奖励。
4. **I 的真实模型验收**：在 `first-person`/`top-down` 上按 GD3/GD4 冻结断言执行。
5. **场景节点安装自动化**：需要独立的 `.tscn` 编辑契约与校验（建议由主任务决定是否立项），当前只提供手动步骤。
6. **baseVersion 升版与迁移表**：如集成时确认需要对外区分版本，再按 `state.migrations` 增加显式迁移步骤。

## 6 集成顺序建议

1. 先合入 `desktop/godot/shared/**`（契约、组件库、观察、适配器）与三份底座清单；
2. 再合入三个底座的 `new-world.mjs`、横版空白/门槛修复、第一人称按键绑定；
3. 最后合入 `tests/godot-remaining/F/**` 与 `docs/dispatch-reports/godot-remaining/F/**`，并把 ADR-F01 编号并入总表。

本树交付时保持干净，未推送、未修改主目录、未操作其他工作树或用户存档。
