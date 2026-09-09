# 任务 E 交付报告：可继续修改的 Godot 第一人称底座

- 任务：E —— 交付可继续修改的 Godot 第一人称底座
- 工作树：`D:\Craftmine World-worktrees\godot-parallel-e-20260909`
- 分支：`codex/godot-parallel-e-20260909`
- 基线：`46739d222ceefc654b596725c96288a4087993b3`（与本次分发的 master 一致，未回退）
- 实现提交：`baead90`（底座实现与说明）；Web 像素验收与本报告在同一交付提交中（哈希见交付说明）
- 修改范围：仅新增 `desktop/godot/bases/first-person/**` 与 `docs/dispatch-reports/godot-parallel/E/**`

未修改共享运行协议、UI、Rust 核心、其他底座，也未改动
`desktop/godot/probes/first-person`（继续作为 GD0 固定夹具）。
未合并 master、未推送、未清理工作树，符合本次并行协作的统一集成要求。

---

## 1 交付物

新增目录 `desktop/godot/bases/first-person/`，是一个**源码优先**的 Godot
4.7.2-stable 工程，而不是只能调用几个专用命令的封闭演示：

```
base_manifest.json          底座 id、版本、入口场景、状态格式、参数与适配器清单
project.godot               引擎配置、输入映射、物理层命名
scenes/blank_start.tscn     空白起点：玩家、摄像机、准星、装备、存档
scenes/training_range.tscn  训练靶场：3 个靶、掩体、弹药箱、拾取物、任务
scenes/actors|props|ui/     玩家/摄像机/挂点、靶子、道具、HUD
scripts/core/*.gd           玩法与状态（16 个脚本）
scripts/ui/*.gd             准星与 HUD
scripts/adapters/*.gd       薄适配层（见第 4 节）
data/equipment|ui|quests|balance/*.tres   全部可读可改的参数
assets/meshes/*.obj         原创低模几何，纯文本
assets/materials/*.tres     原创材质
assets/provenance/          素材来源与许可记录
licenses/                   原创素材 MIT 许可全文
tools/generate_meshes.mjs   几何生成器（OBJ 同时也是源码）
tests/                      独立验收
docs/                       行为规范、状态格式、模型题目、架构决策记录
```

场景、脚本、资源、参数全部是纯文本，可读取、修改、另存；`.obj` 既是生成
产物也是可直接编辑的源文件，`node tools/generate_meshes.mjs --check` 会在两者
不一致时报错。

### 1.1 同一真实状态

`EquipmentState` 是"当前装备"的唯一持有者。它通过 `equipment_changed(id,
definition)` 把激活的 `EquipmentDefinition` 交给所有消费者：

| 消费者 | 从同一份定义派生 |
| --- | --- |
| `EquipmentVisuals` | 显示网格、材质、相机挂点位移/旋转/缩放 |
| `Crosshair` | 准星显隐、形状、尺寸、间隙、颜色 |
| `AttackDispatcher` | 攻击方式、伤害、冷却、射程、弹丸数、散布、近战弧度、命中层 |
| `Hud` | 名称、攻击方式、弹匣容量 |
| `AimQuery` | 命中层（指向交互） |

底座里不存在第二份"当前装备/武器显隐/准星显隐"状态。切剑时模型、准星与攻击
方式由同一次状态变化同时更新，因此不会互相矛盾。`try_begin_attack()` 在行为执行
**之前**扣弹并起冷却，没有"不付代价造成伤害"的路径。

### 1.2 屏幕中央准星

准星是铺满视口的 `Control`，绘制几何由 `size * 0.5` 计算，不写死屏幕坐标；
`measure()` 返回与 `_draw()` 完全相同的几何（`segments`、`center`、
`viewportCenter`、`offsetFromViewportCenter`），因此验收断言与真实绘制不会分离。
命中闪红、冷却/换弹变色、按键位面切换都由实时状态驱动。

### 1.3 相机挂点

显示模型是真实 `Camera3D` 的子节点，位置来自装备定义的 `mount_offset`。相机
转动时模型的**局部**变换不变、全局变换跟随相机（`attachedToCamera`），朝向与
相机一致（`forwardDot == 1`）。

### 1.4 移动、碰撞与指向交互

`CharacterBody3D` + 重力 + 地面/空中加速 + 跳跃 + `move_and_slide()`；摄像机偏航
在 rig、俯仰在 pivot。`AimQuery` 每个物理帧从相机发射真实射线，驱动 HUD 提示、
可交互判定与 `interact()`。**脚本化验收的 `walk()` 走的是与键盘相同的
`_read_move_axis()` 路径**，因此验收测的是真实加速、碰撞和滑动，而不是瞬移。

### 1.5 伤害反馈

`TargetDummy.apply_damage()` 返回 `{applied, remaining, destroyed}` 并触发材质闪光；
`AttackDispatcher` 再发出 `damage_dealt`，准星显示命中标记、HUD 弹出伤害数字并
实时更新任务进度。

---

## 2 版本化状态格式

`craftmine.godot-base-state/1`，`stateVersion = 1`，完整规范见
`desktop/godot/bases/first-person/docs/STATE_FORMAT.md`。

保留内容：玩家位置/朝向、装备（激活项 + 每件弹匣与备弹）、背包、靶子（血量、
是否摧毁、命中数、累计伤害）、可交互物（剩余次数/是否已取）、任务（状态、进度、
一次性奖励是否已发）。

**刻意不进入状态**：伤害、冷却、射程、弹匣容量、网格、材质、挂点、准星样式。
它们是源码，不是进度。这样"修改伤害后继续原进度"不需要状态迁移，也不会被存档
覆盖回旧值。

读取路径 `user://worlds/<sha256(worldId)>/state.json`：先校验信封与每个区块，全部
合法才应用；任一区块失败则回滚到应用前的快照并返回原因，世界保持原样。写入先写
`state.json.tmp`、确认写入结果、再替换正式文件，中断写入不会留下半个存档。
迁移入口只有 `WorldState._migrate()`，当前只接受版本 1，不接受猜测缺失字段。

---

## 3 实际验证与原始证据

### 3.1 独立 headless 验收（52 项断言，全部通过）

命令：

```powershell
$env:CRAFTMINE_GODOT_CACHE_DIR = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable'
node desktop/godot/bases/first-person/tests/acceptance_headless.mjs
```

运行方式：固定哈希校验后的真实 Godot 4.7.2-stable、`--headless`、独立
`APPDATA/LOCALAPPDATA/TEMP` 配置目录、每次把工程复制到临时目录后真实导入。
不使用真实鼠标键盘、不请求 Pointer Lock、不激活或置前任何窗口；脚本化操作只通过
`probe_runner.gd` 的 JSON 命令表驱动真实节点。

证据目录：`D:\Craftmine World-worktrees\test-results\godot-first-person-base-1nUONI\report.json`
（最终全绿运行，52/52）。关键断言与观测：

| 验收项 | 断言 | 实测 |
| --- | --- | --- |
| 中心准星与分辨率 | 1280×720 / 800×600 / 1920×1080 下 `offsetFromViewportCenter` ≤ 0.5 px，且准星尺寸 == 视口尺寸 | 三次均为 `[0, 0]`；视口依次为 `[1280,720]`、`[800,600]`、`[1920,1080]` |
| 相机转动后持枪相对位置 | `local` 不变、`global` 改变、`attachedToCamera`、`alignedWithCamera`、`forwardDot > 0.99` | `local` 恒为 `[0.24,-0.2,-0.42]`；`forwardDot = 1` |
| 切剑后显隐与攻击同步 | 剑：`meshPath=weapon_sword.obj`、`crosshair.visible=false`、`segments=[]`、`attackMode=MELEE`、不耗弹 | 全部满足；空弹匣切换回枪后弹匣仍为 6/备弹 12 |
| 实际命中与弹药消耗 | 命中 `target_b`、伤害 12、弹匣 6→5；紧接一枪被冷却拒绝；冷却结束再命中，目标 50→26 | 观测到 `cooling-down`、`magazine=4`、`health=26` |
| 换弹 | 备弹 12→10、弹匣 4→6 | 满足 |
| 真实碰撞 | 向右持续移动 400 帧后 x 落在墙内侧 | `x = 19.05`（墙内面 19.4） |
| 保存重启 | 新进程 `restore` 复原位置、朝向、弹匣、备弹、靶子血量、`hasSave` | 全部一致 |
| 修改伤害后继续原进度 | 源码 `damage 12→7`、重新导入、`restore` → 旧进度保留、下一发伤害 7 | 备弹仍 10、`target_b` 仍 26 → 19 → 12 |
| 近战真实可达 | 走近后瞄准，球扫命中 `target_a`、伤害 20 | `health 50→30` |
| 任务与一次性奖励 | 摧毁两个靶 → 任务完成、备弹 +12、背包获得 `marksman_badge`；重启后不重复发放 | 备弹 18、徽章 ×1，重启后一致 |
| 指向交互 | 瞄准弹药箱得到真实命中与提示，交互后备弹 +12，重启后剩余次数为 2 | 满足 |
| 非法状态 | 缺字段与更高版本均被拒绝，且世界状态逐字节不变 | 两次拒绝后快照与拒绝前完全相同 |
| 中途失败回滚 | 玩家/装备/背包合法但目标区块非法的状态被拒绝，且已应用的玩家位置与背包被完整回滚 | 拒绝前后快照逐字节相同 |
| 攻击阻断原因 | `cooling-down`、`reloading`、`empty`、`no-attack` 均可达且正确 | 四种原因实测均出现 |
| 准星颜色优先级 | 就绪=样式色、命中=hit_color、冷却=cooldown_color | 三态实测与样式资源一致 |
| 世界隔离 | 无存档的 worldId 无法读取其它世界进度 | 返回 "Progress is missing" |
| 空白起点 | 作为独立场景运行：无靶子、无可交互物、可移动、可开火、可存读 | `levelTitle = "Blank start"` |

原始证据同时保存在 `report.json` 的 `checks`（逐项断言与实测值）与
`observations`（每个场景的完整操作序列与快照）中。

### 3.2 真实渲染像素验收（21 项断言，全部通过）

命令：

```powershell
$env:CRAFTMINE_GODOT_CACHE_DIR = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable'
node desktop/godot/bases/first-person/tests/acceptance_web.mjs
```

运行方式：真实 `--export-release Web`（线程化模板 `web_release.zip`），宿主与游戏
分别在两个 `127.0.0.1` 源上（不同源、COOP/COEP/CSP 齐备），独立浏览器 profile、
headless Chromium + SwiftShader。初始化脚本让 `requestPointerLock` 直接抛错并记录
任何 focus / pointer-lock 尝试；**全程不发送任何鼠标或键盘事件**。

证据：`test-results\first-person-web-HWfjtg\report.json`（21/21 通过），同目录截图
`crosshair-1280x720.png`、`crosshair-800x600.png`、`crosshair-1920x1080.png`、
`sword.png`、`pistol.png`。

| 验收项 | 断言 | 实测 |
| --- | --- | --- |
| 真实导出 | 线程化 Web 构建、wasm > 1 MB、pck、bridge.js、Godot 许可随包 | buildId `2088725b…`，39,464,573 字节，`threaded=true` |
| 真实合成准星存在 | 居中 21×21 窗口内近白像素 ≥ 24 | 三种分辨率均 **56** 像素 |
| 准星居中 | 近白像素质心与包围盒中心相对位图中心 ≤ 1.5 px | 质心 `(-0.5,-0.5)`，包围盒 `20×20` 居中 |
| 分辨率变化 | 1280×720 / 800×600 / 1920×1080 下画布尺寸与视口一致，偏移 ≤ 0.5 px | 三次均 `offsetFromViewportCenter = [0,0]` |
| 切剑隐藏 | 居中窗口近白像素 = 0，`meshPath=weapon_sword.obj` | 0 像素 |
| 切回枪恢复 | ≥ 24 像素、`weapon_pistol.obj`、准星可见 | 通过 |
| 报告几何确实被绘制 | 每个 `segments` 中点采样为近白 | 4/4 |
| 相机转动 | `global` 改变且 `attachedToCamera`、`alignedWithCamera` | 通过 |
| 真实命中与耗弹 | 伤害 12、弹匣 6→5、`target_b` 50→38 | 通过 |
| 保存 + 完整浏览器重启 | 新浏览器实例 `restore` 复原装备、弹药与靶子血量 | 通过 |
| 无输入抢占 | 全程 0 次 focus / pointer lock 请求 | 通过 |

### 3.3 独立对抗式代码评审与修复

实现完成后，另起一个只读评审（不修改任何文件）对 `desktop/godot/bases/first-person/**`
做了对抗式复查：确认"同一真实状态""代价先于行为""准星几何无漂移""信封校验"
"存档耐久""脚本化移动与键盘同路径""适配层集中""验收不可造假"八项主张成立，
同时指出若干真实缺陷。已全部修复：

| 缺陷 | 影响 | 修复 |
| --- | --- | --- |
| `equip()` 清零冷却与换弹计时 | 切枪可跳过冷却，换弹可被免费取消 | 冷却/换弹改为按装备 id 存储，切枪不再重置 |
| 回滚结果被丢弃 | 回滚自身失败时仍报告"未改变" | 检查回滚结果并把两次失败合并上报 |
| 背包可超出格式上限 9999 | 可能写出自己读不回的存档 | `add()` 按 9999 截断并返回实际数量 |
| 还原时按当前上限拒绝而非截断 | 模型调小弹匣/血量后旧存档整体作废 | 弹匣、目标血量、弹药箱次数按当前上限截断 |
| 目标/可交互物按节点名排序且不校验 id | 同名节点可能错位应用 | 改按场景路径排序，并校验存档 id 与节点 `state_id()` |
| 手持无弹药装备时任务奖励被吞 | 奖励永久丢失 | 先发放后完成；发放失败则保持进行中并重试 |
| 存档先删后改名 | 崩溃窗口内可能同时丢失新旧存档 | 改为"备份→提交→删备份"，提交失败时回滚备份 |
| 近战只查直接子节点 | 嵌套碰撞体退回按原点测角 | 递归查找全部 `CollisionShape3D` 并取平均中心 |
| 散布按 tan 分量实现 | 实际散布大于配置，且朝上时基退化 | 改为圆盘内均匀取样，`spread_degrees` 即最大偏角 |

并补齐评审指出的验收盲区：新增 `cooling-down` / `reloading` / `empty` / `no-attack`
四种阻断原因、准星三态颜色、**中途失败后的完整回滚**、世界 id 隔离，共 13 项断言。
`base_manifest.json` 的 `preserved`、`BASE_SPEC` 关于 `AimQuery` 命中层的表述、
`crosshair_style.size_px` 的注释等口径也已与实现对齐。

评审指出的 `no-equipment` 分支（场景未配置装备目录）没有加运行时断言，只由代码
路径保证；这是有意保留的防御分支，不作为已验收行为。

为覆盖 `no-attack` 路径，目录中新增了一个 `inspection_tool`：无攻击、无模型、
无准星，同时用于证明"无攻击装备"下模型与准星由同一状态一起消失。

---

## 4 共享接口适配（当前集中在薄模块）

B 的工程/构建清单与 C 的运行协议尚未冻结，因此所有耦合只在
`scripts/adapters/` 与 `tests/` 中，场景与玩法脚本不引用任何传输：

- `base_manifest.json`：底座 id、版本、引擎版本、入口场景（空白/示例）、状态格式
  id 与版本、参数文件清单、核心脚本清单、适配器路径、验收入口。B 可直接消费。
- `scripts/adapters/base_ops.gd`：操作集实现一次，供两个适配器共用。
- `scripts/adapters/preview_bridge.gd`：Web 预览传输适配（线协议
  `craftmine.godot-preview/1`，与 GD0 夹具同形）。C 可整体替换此文件。
- `scripts/adapters/probe_runner.gd`：headless 驱动，执行 JSON 命令表并输出
  `CRAFTMINE_FP_BASE=<json>` 一行，供 I 的冻结断言复用。

给 C 的接口建议：本底座的请求/响应形状已与
`desktop/godot/probes/shared/web_bridge.gd` 保持一致（`id`、`worldId`、
`op`、`args` → `{id, result|error}`），差异只在于底座用 `BaseOps` 而不是夹具
自己的 `web_command`。若 C 冻结出不同的协议，只需改 `preview_bridge.gd`。

给 B 的接口建议：`base_manifest.json` 中的 `engine`、`entryScenes`、`stateFormat`、
`parameters`、`adapters`、`acceptance` 字段即为本底座对外可声明的全部身份信息；
如果 B 的清单需要不同的字段名，请在 B 的清单冻结后告知，我这边只改这一个 JSON。

---

## 5 模型验收题目（交付给 I，未预先实现）

`desktop/godot/bases/first-person/docs/MODEL_ACCEPTANCE_TASKS.md` 给出三道从空白
起点开始的模型题目与冻结断言：

- **M1 三连发精确射手步枪**：新增装备资源、独立网格/材质/准星样式、连发三发、
  弹匣 12、备弹 24、冷却 ≥ 0.75 s；断言 M1.A1–M1.A10（连发命中数与耗弹、冷却
  拒绝、不足三发整体拒绝、换弹、跨进程存读、改伤害后继续原进度、手枪与剑行为
  不变、切换一致性）。
- **M2 巡逻移动靶**：真实物理巡逻、可命中可摧毁、位置与状态入档、计入任务；
  断言 M2.A1–M2.A6（位移、路径偏差、伤害、摧毁后静止、跨重启位置、任务计数）。
- **M3 由真实状态驱动的准星**：移动时张开、冷却/命中变色、无第二份状态；
  断言 M3.A1–M3.A5（静止/移动包围盒、冷却与命中颜色、分辨率居中、可回退）。

这些题目**在底座里没有实现**，底座只提供起点、运行时与断言范式。文档同时列出
"不算通过"的替代做法（用 HUD 文字当准星、瞬移的移动靶、把连发做成一次射线、
第二份弹药来源、改断言或手写 report.json 等）。

---

## 6 素材来源与许可

`assets/provenance/ASSET_PROVENANCE.md` + `licenses/ORIGINAL_ASSETS_LICENSE.txt`：

- 全部几何由 `tools/generate_meshes.mjs` 原创生成（轴对齐盒体组合的低模），顶点
  数据写在生成器里，OBJ 同时作为源码提交，可用 `--check` 校验一致性。
- 材质、准星样式、装备、任务、平衡参数均为手写 Godot 资源，只含数值与颜色。
- 未使用任何第三方贴图、HDRI、字体、音效、着色器，**未复制任何商业游戏资源**。
- 原创素材按 MIT 授权；Godot 引擎自身的 MIT 声明与 `COPYRIGHT.txt` 由仓库
  `desktop/godot/licenses/` 与打包流程负责，本目录不重复声明、也不代替整体客户端
  的许可审查。

---

## 7 首次失败与修复记录（保留在实现过程中）

1. **复制工程时排除了 `project.godot`**：过滤器写成了 `!path.includes('.godot')`，
   把 `project.godot` 一起排除，引擎报 "no main scene defined"。改为只排除
   `.godot` 目录名。
2. **7 处 GDScript 解析错误**：`global_basis()` 当成方法、`Node` 上不存在
   `get_world_3d()`、`intersect_ray/intersect_shape` 返回类型无法推断、
   子类重复声明父类 `prompt`、协程函数未 `await`。逐条按引擎报错修正。
3. **准星朝向断言符号写反**：把"模型朝向与相机一致"写成 `-basis.z · basis.z`，
   恒为 -1。改为比较两侧 `basis.z`，并额外输出 `forwardDot` 便于取证。
4. **脚本化移动与 `_physics_process` 互相打架**：`walk()` 自己循环
   `move_and_slide()`，而 `_physics_process` 每帧把速度拉回 0，结果 60 帧只走了
   0.23 m。改为 `walk()` 只设置输入覆盖轴，由同一条移动代码路径消费。
5. **近战弧度按节点原点计算**：靶子原点在地面，瞄准方向到脚下原点的夹角 40.07°
   刚好超过 40° 弧度上限，真实贴脸也判不中。改为对碰撞形状中心测角，方向才代表
   "指向目标本体"。
6. **弹药箱从未拿到 `EquipmentState`**：交互物没有绑定入口。改为 `BaseWorld._ready`
   对 `base_interactables` 组统一 `bind_world()`。
7. **验收脚本自身的排序错误**（把墙碰撞走位与后续射击放在同一世界、把任务场景
   放在改伤害之后）：调整为独立世界与最后执行改源操作，断言不动。
8. **像素断言实际测的是准星样式而不是位置**：最初照搬 GD0 夹具的"居中 9×9 内
   ≥20 白像素"，而本底座的精确准星带 3 px 间隙，该窗口内只有 12 个像素——这条断言
   只能区分"有没有照抄夹具的样式"，区分不了"有没有画在屏幕中心"。改为：居中 21×21
   窗口内近白像素 ≥24（证明真的画出来）+ 近白像素质心与包围盒中心相对位图中心
   ≤1.5 px（证明真的居中），并保留"每个报告线段中点都被真实绘制"的采样。三种分辨率
   实测均为 56 像素、质心 `(-0.5,-0.5)`、包围盒 `20×20` 居中。修改后断言对"没画"
   和"画偏"都更敏感，没有放宽验收目标。

以上都是实现或验收脚本的缺陷，没有通过放宽断言来消除。

---

## 8 未完成项与边界

- 本底座是**开发者编写的参考底座**，不构成"真实产品模型已完成 A03/GD3"的证据。
  模型题目（第 5 节）尚未由任何模型完成。
- 未做世界管理 UI、世界切换、旧运行器世界迁移；底座只提供 `worldId` 与按世界
  命名空间的存档路径。
- 未做热更新：修改工程后验收一律重启进程，这也正是"保存重启后继续"需要证明的
  行为。
- 未做联网、存档加密、反作弊。
- 隔离边界未变：现有 AppContainer 原型仍在 `main` 前以 `0xC0000142` 退出，本任务
  不改变该结论，也不把"独立目录/独立进程"当作完整隔离。
- 可见合成、硬件 GPU 性能与玩家手感需另行验收；headless 与 Web 像素都不能代替。

---

## 9 需要其他任务提供的接口

| 任务 | 需要的接口 | 当前状态 |
| --- | --- | --- |
| B 工程/构建清单 | 清单字段名与工程身份字段；若与 `base_manifest.json` 不同，请给出目标字段 | 未冻结；本底座用 `base_manifest.json` 自描述，改动只涉及该 JSON |
| C 运行协议 | 请求/响应信封、生命周期、退出与错误语义 | 未冻结；本底座用 `preview_bridge.gd` 实现 `craftmine.godot-preview/1`，可整体替换 |
| I 冻结断言 | 断言编号与失败计入分母的规则 | 已提供 M1–M3 题目与断言 id；底座自带 39 项 headless 断言作为范式 |
| 产品接线 | 世界身份、进度写入与回执的权威归属 | 本底座把 `worldId` 作为存档命名空间键，等待 Rust 契约统一 |

如果上述接口冻结结果与本报告假设不同，我这边需要改动的位置仅限于
`base_manifest.json`、`scripts/adapters/*.gd` 与 `tests/*.mjs`。
