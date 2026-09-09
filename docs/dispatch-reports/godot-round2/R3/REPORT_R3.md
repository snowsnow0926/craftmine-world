# R3｜三底座与挖掘沙盒接入正式产品 — 交付报告

日期：2026-09-10
任务：`docs/dispatch-prompts/godot-round2-20260910/R3-bases-and-mining.md`
分支：`codex/godot-round2-r3-20260910`
工作树：`D:/Craftmine World-worktrees/godot-round2-r3-20260910`
基线：`bcebeb1`，保留历史地合入 G `c906f3e`（`d20af00`）与 F `d7db302`（`aaabf58`，含其继承的 `564e43a`）
独占范围：`desktop/godot/bases/**`、`desktop/godot/shared/**`、物化/创建清单与组件生成器
未推送、未合并主目录；其他 agent 的工作树只读，未改写、未清理。

## 1 结论

本轮把 R3 的四项实质工作做成了可运行的代码，并用真实引擎逐项验证：

| R3 要求 | 状态 | 证据 |
| --- | --- | --- |
| 1 参考适配器 → 真实受管理适配器，接共享生命周期/创建清单/快照/正式存储 | **完成（模块级）** | `shared/adapters/mining-sandbox.gd`、`materialize.mjs` 登记、两份目录、`shared/tests/progress.mjs` **26/26**、`bases/tests/audit-persistence.mjs` **4 底座全通过** |
| 2 修复堆叠上限、哈希/修订重启一致性、保存失败；源码/素材版本与地形游玩状态分离 | **完成** | 新断言 G37–G41，A16 矩阵 **45/45**；两阶段提交（内容寻址分块）在 G29b 用真实索引阶段失败复现 |
| 3 用 R1/R2/C 同版本重跑三底座+沙盒的真实 Web/Electron/Rust | **部分完成，明确阻塞** | 真实引擎层全部通过（见第 3 节）；完整 Web/Electron/Rust 同版本链路**未执行**，依赖项与命令见第 5 节 |
| 4 22 个组件目录 → R4 可实际调用的场景组件物化器；两实例独立修改 | **完成** | `shared/scene_materializer.mjs` + 8 个组件的 `install` 声明 + `tests/godot-round2/R3/scene-install.mjs` **8/8（14 次真实引擎运行）** |
| 5 为 R7 接带身份采样、为 R8 提供受限真实操作、不给任意 setter | **完成（接口级）** | 适配器 `observe()`（含 station/工具/地块身份）与 10 个有界 op 白名单；`observation.test.mjs` 交叉校验白名单与共享 schema 一致 |
| 6 与 CP 形成官方/玩家底座 SDK 与检查接口；未验证底座不能进入可用列表 | **部分完成** | 统一 `craftmine.godot-base-contract/1` 校验 + 两份生成目录；契约不合规的底座无法进入目录。完整 CP 治理（玩家导入底座逐项开放）**未完成** |

**不能说 R3 整条完成**：完整同版本原生链路（Web 导出 → 隔离 Electron → 宿主适配器 → Rust 持久）尚未跑通，R4 的完整新目录包往返联调未做，真实模型创作验收属 R8。

## 2 逐条实现

### 2.1 mining-sandbox 成为真实受管理底座（要求 1）

- `manifest.json` 补齐统一契约：`contract.format/assets/state`（保留字段清单 + 空迁移表）、`templates[]`（blank/mine-camp，各带 `initialState`）、6 个组件、`acceptance`。
- `assets/ASSET_MANIFEST.json` + `ASSET_SOURCES.md` 作为素材清单与许可来源，通过 `validateBaseContract` 的 `missing-asset-*` 检查。
- `shared/materialize.mjs` 增加 `configs['mining-sandbox']` 并把 `--template` 路由抽成 `TEMPLATE_BASES`（否则会走 `--world` 分支直接失败——上一轮接口文档这条描述是错的，已修正）。
- `shared/adapters/mining-sandbox.gd` 实现与另外三个底座相同的成员集：`runtime/is_ready/bind_world/capture/restore/observe/command`，并显式声明 `ALLOWED_OPERATIONS`（与 `observation.mjs` 的 `BOUNDED_OPERATIONS` 由测试交叉校验）。
- `restore()` 先对克隆校验、拒绝未知字段（`Guard.omitted`），再应用；`restore_managed()` 拒绝未知 body/state 字段，并校验“声明的地形哈希 == 分块实际产生的哈希”，不一致时回滚。
- `shared/tests/progress.mjs` 增加 mining-sandbox 矩阵项与 4 个专属坏状态：**26/26 通过**（真实引擎，完整进程重启、暂停活恢复、回执确认、原子拒绝）。
- `bases/tests/audit-persistence.mjs` 增加 `mining-sandbox/worlds/mine-camp` 用例（状态整体拒绝、仅修订块接受、矛盾块拒绝、路径逃逸拒绝、`auto:` 不进持久账本）：**4 底座全通过**。

### 2.2 已知缺陷修复（要求 2）

| 缺陷 | 修复 | 新断言 |
| --- | --- | --- |
| `items[].stack` / `maxStack` 未生效 | `stack_size()` 取 `min(声明值, maxStack)`；`_apply_grant` 返回溢出量；掉落/制作报告 `overflow`；输出放不下时在消耗前拒绝 | G37、G38 |
| `apply_chunk` 不记录已提交哈希 → 重启后 `snapshot.chunks[].sha256` 变形 | `apply_chunk` 接收并保存文件哈希 | G40 |
| 编辑被全部还原的块 revision 丢失 | 索引保留 `{revision, file:"", cells:0}`，不写文件；`known_chunk_ids()` 同时返回有编辑与仅有修订的块 | G39 |
| 保存失败可能让上一次存档不可加载 | 分块文件内容寻址 + 索引为唯一提交点（上一轮已修，本轮补 G29b 真实复现） | G29b |
| 源码/素材版本与地形游玩状态混淆 | `progress.json`/`chunks/` 只落在进度根；G41 断言世界工程目录内没有任何进度/分块文件；`INTERFACE_BC.md` §5 明确 Git 不保存地形进度、分支合并不合并它 | G41 |

### 2.3 场景组件物化器（要求 4）

`desktop/godot/shared/scene_materializer.mjs`：

- `parseScene` / `planSceneInsertion` / `applySceneInsertion`：把组件节点插入真实 `.tscn`。
- 关键工程细节（都是先失败、再修正的）：
  - Godot 解析要求 `type` 在 `parent` 之前，且 `instance=` 用 `ExtResource` 引用；
  - `ext_resource` id 从场景已有编号分配，脚本有 `.gd.uid` 时写入真实 `uid://`；
  - 普通字符串必须写成 GDScript 字面量（`"res://..."`），`StringName` 用 `&"..."`；
  - 节点名或身份值已存在 → **写盘前拒绝**；
  - 只追加：原有 ext_resource、节点与作者改动逐行保留（`preservesLines` 断言）；
  - 组件声明的输入动作缺失时补进 `project.godot`。
- 8 个实体组件在各自清单声明 `install` 块（first-person 4 个、top-down 4 个），`build-base-catalog.mjs` 把 `install` 带进 `component-catalog.json`，`components.mjs` 的 `planInstallation/applyInstallation` 直接产出并应用真实场景编辑。
- `tests/godot-round2/R3/scene-install.mjs`（真实引擎，8 项）：写入 `.tscn`、同组件装两次得到两个独立实例、引擎加载并报出两个身份、改一个不影响另一个、first-person 的 `StringName` 身份与各自覆盖值、缺失输入动作补回、重复身份拒绝且场景字节不变、目录里每个声明 install 的组件都能生成真实编辑计划。

### 2.4 观察与受限操作（要求 5）

- `observation.mjs` 增加 mining-sandbox 的有界操作 schema：只读 `snapshot/tile/inventory/hash/chunk`，可变 `move/wait/dig/place/craft/cancel`；**没有** `set-position`、`restore-managed`、`reset-to-initial`、`set-*`。
- 适配器 `observe()` 返回带身份的采样：玩家位置/地块/朝向/工具等级/已装备、背包、`stations[]`（稳定 id、类型、地块、配方）、chunk id 列表、编辑数、地形哈希、世界修订、最后动作。
- `observation.test.mjs` 的适配器白名单交叉校验已扩展到 mining-sandbox 并全绿。

### 2.5 目录与 SDK（要求 6）

- `base-catalog.json` / `component-catalog.json` 现为 4 底座 / 28 组件（含 8 个带 `install`），由 `build-base-catalog.mjs --check` 保证不漂移。
- `validateBaseContract` 的 20+ 条拒绝条件覆盖引擎、协议、状态契约、素材清单与许可、模板（恰好一个 blank-start 且 `initialState` 合法）、组件文件存在与越界；不合规的底座无法进入目录，即无法被创建清单消费。

## 3 验证结果（全部真实 Godot 4.7.2-stable headless，独立进程/目录，无鼠标键盘、无窗口、无 Pointer Lock）

| 套件 | 结果 | 证据 |
| --- | --- | --- |
| `tests/godot-remaining/F/*.test.mjs` | **32/32** | `evidence/regression/05-f-tests.log` |
| `shared/tests/progress.mjs`（4 底座托管生命周期） | **26/26** | `evidence/regression/07-managed-progress.log` |
| `bases/tests/audit-persistence.mjs`（4 底座原生存档拒绝） | **4/4 底座** | `evidence/regression/06-audit-persistence.log` |
| `tests/godot-remaining/G/a16-acceptance.mjs`（沙盒） | **45/45** | `evidence/a16/report.json` |
| `tests/godot-round2/R3/scene-install.mjs`（场景物化） | **8/8**（14 次引擎运行） | `evidence/scene-install/report.json` |
| `bases/mining-sandbox/tools/verify.mjs` | **14/14** | `evidence/mining-smoke/report.json` |
| `bases/first-person/tests/acceptance_headless.mjs` | 退出 0（52 项） | `evidence/regression/01-first-person-acceptance_headless.log` |
| `bases/top-down/tools/verify.mjs` | **40/40** | `evidence/regression/03-top-down-verify.log` |
| `bases/side-view/tools/verify.mjs` | **89/89** | `evidence/regression/02-side-view-verify.log` |
| `bases/mining-sandbox/tools/check-sync.mjs` | 2 世界逐字节一致 | `evidence/regression/08-check-sync.log` |
| `build-base-catalog.mjs --check` | 目录不漂移 | 随 F 测试 |

说明：`side-view` 首次由并行 runner 运行时报 `project.importClean` 失败，单独重跑 89/89 通过——那是并发导入同一缓存目录造成的瞬时干扰，不是代码回归；两种结果都保留在证据里。

## 4 关键提交

| 提交 | 内容 |
| --- | --- |
| `d20af00` | 保留历史地合入 G 的挖掘沙盒交付 |
| `aaabf58` | 保留历史地合入 F 的底座/组件交付（含 564e43a） |
| `f913feb` | 堆叠上限、修订/哈希重启一致性、G37–G41 |
| `bf48b25` | mining-sandbox 接入统一契约、目录与受管理生命周期 |
| `95de732` | 场景组件物化器 + 8 个 install 声明 + 真实引擎验证 |
| `6d8578b` | 探针托管 body 干净化、文档、持久化审计用例、回归证据 |

## 5 未完成与依赖（不得当成已完成）

1. **完整 Web/Electron/Rust 同版本链路（要求 3 的剩余部分）**：本机可用二进制不在本树——esbuild 在 `D:\Craftmine World-worktrees\godot-round2-r2-20260910\vendor\pi-desktop\packages\agent-runtime\node_modules\esbuild`，Electron 在 `...\batch07-native-20260909\vendor\pi-desktop\apps\desktop\node_modules\electron\dist\electron.exe`，`craftmine-core.exe` 在 r2 树（`vendor\pi-desktop\target\release`，构建时间晚于其 HEAD），Godot 缓存在主目录。而 R1 的 Rust（`content.rs` 等 17 个提交）与 C 的 `godot-build-verifier.ts`/`godot-executor.cjs` **不在本树**，所以“同版本”必须先把 `codex/godot-round2-r2-20260910`（已含 R1/C/R4/R5/R6 与本轮之前的 R3 快照）合入后再重编核心。命令与变量：
   ```powershell
   $env:CRAFTMINE_NATIVE_DEPENDENCY_ROOT='<含 vendor/pi-desktop/packages/agent-runtime/node_modules/esbuild 的根>'
   $env:CRAFTMINE_ELECTRON_BIN='<electron.exe>'
   $env:CRAFTMINE_CORE_BIN='<craftmine-core.exe>'
   $env:CRAFTMINE_MANAGED_BASE_ROOT='<repo>/desktop/godot/shared/materialize.mjs'
   $env:CRAFTMINE_GODOT_HOST_ROOT='<repo>/electron/main/godot-world-view-host.ts'
   $env:CRAFTMINE_GODOT_CACHE_DIR='D:\Craftmine World\desktop\build\godot\4.7.2-stable'
   node tests/godot-runtime-native.mjs --base first-person|top-down|side-view
   ```
   `tests/godot-runtime-native.mjs` 目前只覆盖三个底座；mining-sandbox 需要在该测试里加一条底座分支（本轮未改，因为它是 C/主任务范围的共享测试，且同版本前提未满足）。
2. **R4 完整新目录包往返**：物化器与 `component-catalog.json`（含 `install`）已可供 R4 直接调用；两个实例安装与独立修改已由 R3 验证，但“打包 → 新目录安装 → 往返一致”必须由 R4 联合验收。
3. **R7 实时观察消费**：`observe()` 已就绪，但 `observe-envelope` 目前只在 Web 导出内可用（F 的说明），真实 R7 消费未跑。
4. **CP 玩家底座治理**：统一契约与目录已就绪；玩家导入底座的逐项开放、兼容标签与社区阶段属 CP/R12，未实现。
5. **可见窗口、GPU 合成、手感**：未验证；真实模型创作属 R8。

## 6 给其他任务的可消费接口

- **R4**：`desktop/godot/bases/component-catalog.json` 的 `install` 块 + `components.mjs` 的 `planInstallation/applyInstallation`（现在真的写场景）；`scene_materializer.mjs` 可单独用于 `.tscn` 插入。
- **R2/E**：`base-catalog.json` 新增 `mining-sandbox`（模板、入口场景、创建命令、世界 id 规则）；`materializeBase` 已支持该底座。
- **R7**：`observation.mjs` 的 mining-sandbox schema + 适配器 `observe()`；`components.mjs` 的解析接口。
- **R8**：受限 op 白名单与“无任意状态 setter”的适配器；沙盒验收矩阵 `tests/godot-remaining/G/a16-acceptance.mjs`。
- **R9/K**：`desktop/godot/bases/mining-sandbox/delivery/make-base-assets.mjs` 生成发行清单；`assets/ASSET_MANIFEST.json` 声明无第三方素材。
- **主任务**：本轮所有改动集中在 `desktop/godot/bases/**`、`desktop/godot/shared/**` 与 `tests/godot-round2/R3/**`；`electron/`、`plugins/`、Rust 与全局锁文件未改。

详见 `INTERFACE_R3.md` 与 `DELIVERY_R3.json`。
