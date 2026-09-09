# G｜横版挖掘、放置与有限地图沙盒 — 交付报告

日期：2026-09-10
任务：`docs/dispatch-prompts/godot-remaining-20260910/G-mining-sandbox.md`
阶段：GD5 / 验收故事 A16
分支：`codex/godot-remaining-g-20260910`
工作树：`D:/Craftmine World-worktrees/godot-remaining-g-20260910`
基线：master `e462147852e36bdfcaf897d3f915c5809fb88670`（分发文档写 92c98b2，实际按最新已集成提交）
独占目录：`desktop/godot/bases/mining-sandbox/**`（新建，无同类成果可继承）
专属测试：`tests/godot-remaining/G/**`
未推送，未合并主目录，未操作任何历史工作树、用户存档或共享引擎缓存。

## 1 结论

底座可真实运行、可挖掘/放置/制作、分块持久化，并且由**独立**验收矩阵逐条检查：
`37/37` 条 A16 断言通过，底座自带冒烟 `14/14` 通过，`check-sync` 确认两个提交的世界与
模板/核心/参数逐字节一致。全部使用独立 headless 进程与独立数据目录，没有真实鼠标键盘、
没有窗口置前、没有 Pointer Lock。

**但本条不能算“整条完成”**：产品侧接入（F 的共享适配器、K 的发行清单、A/H 的存储与
备份登记、E 的创建入口）尚未落地，真实模型创作验收（I）未执行。下面第 6 节逐项列出。

## 2 交付物

| 路径 | 内容 |
| --- | --- |
| `desktop/godot/bases/mining-sandbox/manifest.json` | 底座身份、协议号、世界模板、复用声明 |
| `.../core/scripts/*.gd`（18 个） | 确定性生成、地形服务、分块存档、背包、制作、状态、存档、玩家、渲染、碰撞、制作台、探针 |
| `.../core/scenes/main.tscn`、`core/project.godot.template` | 世界工程入口与工程模板 |
| `.../params/mining_sandbox_params.json` | 运动/网格/交互/限额唯一来源（运动数值复用 side-view 1.0.0） |
| `.../templates/blank`、`.../templates/mine-camp` | 空白起点模板、采矿营地模板 |
| `.../worlds/blank`、`.../worlds/mine-camp` | 可直接打开的空白起点与采矿—制作—建造短样例 |
| `.../tools/new-world.mjs` | 从模板创建世界，校验初始进度/地形块并写 `world-build.json` |
| `.../tools/check-sync.mjs` | 校验 `worlds/` 与模板+核心+参数完全一致 |
| `.../tools/verify.mjs` | 底座自带冒烟检查（14 项，独立于 A16 矩阵） |
| `.../docs/SPEC.md` | **冻结契约**：数据格式、拒绝码、探针 op 表、G01–G36 断言 |
| `.../docs/ADR-0001-mining-sandbox.md` | 11 条架构决策与协议变更规则 |
| `.../docs/INTERFACE_BC.md` | 给 B/C/F/A/H/E/K 的接口与最小可合并片段 |
| `.../docs/REUSE.md` | 复用 side-view 1.0.0 的来源路径与 SHA-256 |
| `.../ASSET_SOURCES.md` | 无第三方素材；引擎许可说明 |
| `.../contracts/shared-adapter.mining-sandbox.gd` | 交给 F 放进 `shared/adapters/` 的适配器参考实现 |
| `.../delivery/make-base-assets.mjs` | 生成给 K 的发行/许可清单 |
| `tests/godot-remaining/G/a16-acceptance.mjs` | **独立** A16 验收矩阵（37 条） |
| `docs/dispatch-reports/godot-remaining/G/` | 本报告、接口文档、DELIVERY_G.json、原始证据、发行清单 |

## 3 逐条对照派单要求

| 要求 | 状态 | 证据 |
| --- | --- | --- |
| 1 从 F 固定版本横版基础复用运动/摄像机/交互，声明版本依赖；先做有限地图 | **完成** | `docs/REUSE.md`（7 个源文件 SHA-256，G34 每次运行重新校验）；运动数值逐项复用；`generation.mapSize` 固定有限地图；ADR D1/D10 |
| 2 可复现地形生成与分块标识；破坏/放置有范围、目标、碰撞及占用规则，不能靠直接改最终地图验证 | **完成** | 纯整数哈希生成 + JS 侧独立复现交叉校验（G01/G01b/G02）；分块 id `<tx/16>_<ty/16>`，含部分边界块（G03/G24）；唯一变更路径 `TerrainService.set_tile`，全部拒绝码（G04–G09、G12–G17）；探针只调用真实方法（G32） |
| 3 掉落、背包获得、放置消耗、至少一条真实制作流程；重复/取消/失败不重复发物或扣材料；人物不被埋进实心块 | **完成** | 挖掘掉落（G05）、幂等与取消（G10/G11/G20）、制作消耗（G18/G19）、放置消耗（G12/G13）、埋人拒绝与载入救援（G16/G30） |
| 4 分块变化、物品、位置、实体状态持久化；保存重开完全一致；验证未改块、多块、边界块、坏档、缺块、版本变化、写入失败 | **完成** | G21（重开一致）、G22（未改块无文件且重建一致）、G23（多块）、G24（边界块）、G25–G28（坏档/坏块/缺块/版本）、G29（真实写失败且旧档完好） |
| 5 交付空白起点与采矿—制作—建造短样例；源码与参数可被 AI 继续改动；提供只读观察与受限验收操作 | **完成** | `worlds/blank`、`worlds/mine-camp`；`snapshot()` 只读（G31）；探针 19 个 op；`tools/new-world.mjs` 与 JSON 数据全部可改；`tools/verify.mjs` 供后续作者自检 |
| 6 按 A/F/H 统一协议接入正式运行与保存，向 E/K 提供真实 manifest 与入口；未接入时清楚标记 | **部分完成** | 已实现 SPEC 5.10 的 `capture_managed/restore_managed`（G36）与 SPEC 9 宿主接口；**F 的共享适配器、A/H 的存储登记、E 的创建入口、K 的发行清单尚未落地**，见第 6 节 |
| 验收核心：实际规则挖掘→获得→制作→放置→保存重启一致；非法距离/材料不足/重复消息/保存失败有明确结果 | **完成** | G05/G18/G12/G21 串起完整链路；G06/G13/G10/G29 覆盖四类失败 |

## 4 验证命令与结果

引擎身份：Godot `4.7.2-stable`（`desktop/godot/toolchain.lock.json`），
二进制 `D:\Craftmine World\desktop\build\godot\4.7.2-stable\editor\Godot_v4.7.2-stable_win64_console.exe`
（工作树内没有 `desktop/build`，通过 `CRAFTMINE_GODOT_BIN` 指向主目录的固定引擎，只读使用）。

```powershell
cd D:\Craftmine World-worktrees\godot-remaining-g-20260910
$env:CRAFTMINE_GODOT_BIN = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable\editor\Godot_v4.7.2-stable_win64_console.exe'

# 1 底座自带冒烟：14/14
node desktop/godot/bases/mining-sandbox/tools/verify.mjs `
  --evidence docs/dispatch-reports/godot-remaining/G/evidence/verify

# 2 独立 A16 矩阵：37/37
node tests/godot-remaining/G/a16-acceptance.mjs `
  --evidence docs/dispatch-reports/godot-remaining/G/evidence/a16

# 3 世界与模板一致性
node desktop/godot/bases/mining-sandbox/tools/check-sync.mjs

# 4 发行清单生成（给 K）
node desktop/godot/bases/mining-sandbox/delivery/make-base-assets.mjs
```

原始证据：`evidence/a16/`（`report.json` + 每次探针的请求/响应/进程输出）、
`evidence/verify/`、`evidence/implementation/`（实现阶段的迭代日志，含首次失败）。

## 5 实现要点（可被 AI 继续改动）

- **生成**：`terrain_generator.gd` 的 `hash3(x,y,salt)` 是唯一的随机来源，全部为 64 位
  整数运算；地表行、矿脉、洞穴按 SPEC 2 的固定顺序求值。改 `world.json` 的 `generation`
  即可得到不同但可复现的地图；`terrain_hash()` 是确定性指纹。
- **存档**：只写与生成结果不同的格子，按 `(ty,tx)` 排序，每块一个文件，索引最后落盘并
  记录每块的 SHA-256/字节数。未改块没有文件。载入整体拒绝。
- **规则**：`TerrainService.dig/place` 校验范围→目标→工具等级→距离→占用→埋人→相邻，
  每个拒绝都有稳定 reason 码；`InventoryService` 是唯一背包入口；`requestId` 幂等账本
  持久化在存档里（FIFO 上限 1024，淘汰计数记录）。
- **人机同一路径**：键盘光标（IJKL）+ `F` 挖 / `G` 放 / `E` 制作，调用的是与探针完全
  相同的服务方法；不使用鼠标、指针锁定或 OS 级输入捕获。
- **接入面**：`capture_managed()` 把状态与全部地形改动打包成自包含 body（受共享
  `state_guard` 1 MiB 限制，超限报 `managed_body_too_large` 而不是截断），`restore_managed()`
  整体校验后原子应用。

## 6 未完成与依赖（不得当成已完成）

| 项 | 归属 | 现状 | 下一步入口 |
| --- | --- | --- | --- |
| 共享适配器 `desktop/godot/shared/adapters/mining-sandbox.gd` | F | **未落地** | 复制 `contracts/shared-adapter.mining-sandbox.gd`；契约见 INTERFACE_BC §4 |
| `shared/materialize.mjs` 的 `configs` 登记 | F | **未落地** | 一行：`'mining-sandbox': { version: '1.0.0', examples: ['blank','mine-camp'] }`，走 top-down 的 `--template` 分支 |
| `shared/tests/progress.mjs` 底座矩阵 | F | **未落地** | 加 `['mining-sandbox','mine-camp']` 与一个专属坏状态 |
| 托管进度在真实宿主中的端到端验证 | A/C/D | **未执行** | 底座侧 body 已通过 G36；需真实 broker/宿主跑一次 `craftmine.godot-progress/1` |
| 产品底座枚举 `plugins/craftmine-world/manifest.json`、`main.cjs` | C/L/root | **未登记** | INTERFACE_BC §6 的两行片段 |
| 发行/许可清单 `desktop/delivery/base-assets/mining-sandbox.json` | K | **未落地** | 复制 `docs/dispatch-reports/godot-remaining/G/delivery/base-assets.mining-sandbox.json`（85 条 + 2 份引擎声明，哈希已核对）；另需 `preflight-selftest.mjs` 的夹具与底座数组 |
| `desktop/godot/bases/tests/audit-persistence.mjs` 的沙盒用例 | F/H | **未登记** | 按 side-view 段的写法加一段断言块 |
| 作品复用/备份/迁移 | H | **未接入** | 分块地形属于进度不是源码；复制世界必须换 `worldId`（INTERFACE_BC §5） |
| Git 内容历史与素材固定引用 | M/N | **未接入** | 世界源码进 Git、地形进度不进；贴图无第三方素材（`ASSET_SOURCES.md`） |
| 真实模型创作验收 | I | **未执行** | 样例是本任务手写的，不是模型产物；I 需按冻结断言独立跑一遍 |
| 可见窗口、GPU、手感 | 人工 | **未验证** | headless 逻辑验收不等于渲染/合成/手感 |

已知缺陷（如实保留）：

1. `world_state.gd` 的 `clone()` 用 `load("res://scripts/base/world_state.gd")` 硬编码世界
   工程路径，在底座目录内直接调用会失败（世界工程内正常）。当前无调用点依赖它，但应改为
   `get_script()` 或去掉。
2. 地形渲染是 `draw_rect` 纯色块（无美术素材）。视觉质量不是本任务验收项，但真实玩家
   体验需要美术或至少更好的程序化绘制。
3. 相邻规则只要求 4 邻域任一非空气或位于地图底部，没有实现"必须有支撑"的更严格结构规则。
4. 光照、液体、无限世界、多人均未实现（计划内非目标）。

## 7 记账区分

| 类别 | 本次结果 |
| --- | --- |
| 纯逻辑 | JS 侧独立复现生成规则并与引擎逐格比对（G01b 抽样 160 格全等） |
| 预制样例 | `worlds/blank`、`worlds/mine-camp` 由本任务手写，非模型生成 |
| 真实引擎 | Godot 4.7.2-stable headless，真实物理与真实文件写入/拒绝 |
| 正式客户端 | **未执行**：未通过 Electron 客户端创建/游玩该世界 |
| 真实产品模型 | **未执行**：无模型调用 |
| 人工手感 | **未执行**：未做可见窗口试玩 |

## 8 集成顺序建议

1. 先合入本分支的底座与测试（自包含，不依赖其他 agent）。
2. F 落共享适配器与物化器登记 → 跑 `shared/tests/progress.mjs`。
3. A/C/D 用真实宿主跑一次托管进度端到端（`capture_managed` → 回执 → `restore_managed`）。
4. E/L 登记产品创建入口，K 落发行清单并重跑预检。
5. I 冻结 A16 断言后做真实模型创作验收；人工试玩单独记账。

分支与提交号见 `DELIVERY_G.json`。合并确认前不清理本工作树。
