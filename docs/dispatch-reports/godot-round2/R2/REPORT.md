# R2 交付报告：客户端、预览、历史与恢复界面

日期：2026-09-10。分支 `codex/godot-round2-r2-20260910`，工作树
`D:/Craftmine World-worktrees/godot-round2-r2-20260910`，基线 `bcebeb1`（D `b903269`、
E `6bc9ec3` 已保留历史合入）。未推送、未合并，主目录与其他工作树未改动。

## 1 结论

- **D/E 的共享入口片段已实际应用**：`index.ts` 里的候选协调器、`view.mjs` 的
  Godot 预览/应用/取消/回包丢失恢复全部落地，`tsc` 0 错误。
- **D 原先被挡住的真实原生候选闭环已跑通**：用 R1 新核心重跑
  `tests/godot-remaining/D/godot-candidate-native.mjs`，**7/7 通过**（预览不污染正式进度、
  取消保留原实例、保存失败保留原实例、应用读取最新进度、回包丢失只查一次、Electron+Rust
  重启后新构建与完整进度保留）。D 报告里“被 A 的来源校验挡住”的理由已过期。
- **首个 Godot 世界的客户端创建链路已实现并用真实核心验证**：客户端读取随包底座目录、
  物化底座源码、用底座自己发布的初始状态组成 `craftmine.godot-progress/1`，调用核心的
  `godotWorld.initialize`。世界以 `runtimeKind: godot`、`initializing: true` 登记，
  `initStatus.playable === false`，`godotRuntime.describe` 拒绝把它当成可运行世界。
  没有手工 seed 已应用记录。
- **左侧辅助入口从死事件变成真实面板**：作品/检查/记忆/任务/备份现在通过
  `world.surface` 打开真实工作台标签，任务行能读到真实可接续草稿。
- **桌面端 14 项失败全部是基线既有**：在干净 `bcebeb1` 工作树重跑同一套件，
  失败集合与 R2 分支**逐项相同**，无新增回归。

## 2 本轮改了什么

| 文件 | 改动 |
| --- | --- |
| `electron/main/index.ts` | 应用 D 的候选协调器接线；构造 Godot 创建工厂；退出/禁用/卸载前先关闭候选 |
| `electron/main/plugin-view-host.ts` | 新增 `showCraftmineSurface`（导航到保留视图的面板表面） |
| `electron/main/craftmine-navigation-host.ts` | 新增 `world.surface` 路由与校验；读取白名单加入 `task.recoverable` |
| `electron/main/godot-world-creation.ts` | **新增**：底座目录读取、请求校验、可移植世界 ID、初始进度读取与封装、`godotWorld.initialize` 编排、`initStatus` → 界面状态映射 |
| `electron/main/godot-panel-coordinator.ts` | 拦截 `world.createOptions`（合并已交付 Godot 底座）、`world.create`（Godot 底座走真实初始化事务）、`world.list`（补真实 `state`/`creation`） |
| `plugins/craftmine-world/view.mjs` | 应用 D 的 Godot 预览/应用片段；新增 `craftmineView.showSurface` |
| `src/components/CraftmineNavigation.tsx` | 辅助入口改走真实通道并显示失败原因 |
| `apps/desktop/test/*` | 新增 `godot-world-creation.test.mjs`；扩展导航网关测试 |

## 3 验证（全部 headless/offscreen、独立目录、无真实输入）

| 验证 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 客户端创建契约（真实核心 stdio） | `node tests/godot-round2/R2/creation-contract-core.mjs` | **12/12** | `evidence/creation-contract-core.report.json` |
| 左侧面板真实导航（真实网关+插件+核心） | `node tests/godot-round2/R2/surface-navigation-e2e.mjs` | **12/12** | `evidence/surface-navigation-e2e.report.json`、`evidence/surface-navigation.png` |
| 客户端单元（创建映射/协调器/导航网关/世界模型） | `node --test test/godot-world-creation.test.mjs test/craftmine-navigation-host.test.mjs test/craftmine-world-navigation.test.mjs` | **36/36** | `evidence/client-unit-tests.txt` |
| D 原生候选闭环（R1 核心） | `node tests/godot-remaining/D/godot-candidate-native.mjs` | **7/7** | `evidence/candidate-native-with-r1-core.report.json` |
| 上一轮真实创建/切换/重启回归 | `node tests/godot-remaining/e/world-create-e2e.mjs` | **19/19** | `evidence/client-create-e2e-regression.report.json` |
| 上一轮创建流程 UI 回归 | `node tests/godot-remaining/e/create-flow-ui.mjs` | **23/23** | `test-results/godot-remaining-e-create-ui-*` |
| Rust 核心 | `cargo test -p craftmine-core --release` | **172 通过**，2 忽略 | `evidence/rust-core-tests.txt` |
| 桌面端全量源码契约 | `node --test test/*.test.mjs` | 1239/1255，14 项失败 | `evidence/desktop-suite-baseline-comparison.json` |
| 基线对照 | 干净 `bcebeb1` 工作树同一命令 | 失败集合逐项相同，新增回归 **0** | 同上 |

引擎身份：`craftmine-core.exe` SHA-256 `071EFAB692987810D4647E70AB51F8950582340B62125FA91B166B0A26A3CB7C`
（本工作树 `cargo build --release -p craftmine-core`，源码 = R1 `5c98e75` + 本轮基线）；
Electron 43.4.0；Godot 导出固定副本 `index.wasm` SHA-256 `F6090F055E16765BCEF5DC3A031F68AB40C151D9E7F0541D9D7EB61E92DC5051`。
每份报告都断言页面未请求 Pointer Lock 与焦点；未运行 `tests/browser.mjs`、`tests/modules-browser.mjs`。

## 4 仍未完成（逐项保留）

| 任务项 | 状态 | 缺口与下一步 |
| --- | --- | --- |
| 1 接 R1 初始化 / R3 底座 / C 构建检查 / firstLoad | 客户端侧完成并验证到核心；**未接入正式路由** | C 的 `host-requests.cjs` 需加两行映射（`godotWorld.initialize`、`godotWorld.initStatus`），见 `INTERFACE_REQUEST.md` §1。R3 需为 first-person / side-view 发布初始进度正文（§2），否则创建会明确报 `BASE_INITIAL_STATE_MISSING` 而不是伪造 |
| 2 同一客户端完成创建→游玩→对话修改→检查→预览/取消→应用→退出重开 | 预览/取消/应用/重启已用真实 Electron + Rust 跑通（D 的 7/7）；创建与“首次构建→可游玩”之间仍缺工程登记与首个构建的调用顺序 | R1 确认 §3 的三步顺序；C 落地路由后 R2 补 `creation-e2e-client.mjs` 跑完整故事 |
| 3 重跑原生候选测试、崩溃快速失败 | 已重跑通过；渲染进程崩溃诊断沿用 D 的实现 | 重复预览/取消/最新进度/回包丢失/保存失败/重启已覆盖；`firstLoad` 仍只在单测中 |
| 4 界面真实验收（居中/右侧/窄窗/中文/缩放/主题/记忆/返回/会话） | 上一轮 23/23 + 本轮 19/19 回归通过 | 可见合成与手感仍需人工/真机；本轮未新增主窗口候选界面（候选界面在插件面板内） |
| 5 历史/素材/作品安装/草稿接续/备份入口 | 作品/检查/记忆/任务/备份入口已接真实面板；任务行显示真实可接续草稿 | 历史（R1 `content.*`）与素材（R6）面板通道未落地，R2 未放假按钮；通道就绪后按 §4 接入 |
| 6 核对 14 项桌面失败 | 已证明全部为基线既有 | 无本轮回归；其中 1 项是 Windows 无法创建符号链接（`EPERM`，环境限制），其余为 vendored 源码与断言漂移，均不在 R2 改动文件内 |

## 5 提交

- `ac2798a` `feat(craftmine-ui): open world panel surfaces and resumable drafts from the left column`
- `36603ab` `feat(godot-host): create Godot worlds from the shipped base catalog through the core transaction`
- `923a36f` `docs(godot): record R2 client wiring, creation contract evidence and interface request`

合并记录（保留历史）：`9449932` D、`99d030c` E、`2e4fafb` R1、`0ba…` F、`48a4e9b` G、
`3ba33fa` C、`2f7f068` R3、`5957c8b` R1 最新。

## 6 复现

```powershell
cd "D:/Craftmine World-worktrees/godot-round2-r2-20260910"
pnpm install --frozen-lockfile --dir vendor/pi-desktop
pnpm --dir vendor/pi-desktop -r --if-present build
cargo build --release -p craftmine-core --manifest-path vendor/pi-desktop/Cargo.toml
node desktop/build-world-plugin.mjs
$env:CRAFTMINE_CORE_BIN="$PWD/vendor/pi-desktop/target/release/craftmine-core.exe"
node tests/godot-round2/R2/creation-contract-core.mjs
node tests/godot-round2/R2/surface-navigation-e2e.mjs
node tests/godot-remaining/e/world-create-e2e.mjs
node tests/godot-remaining/e/create-flow-ui.mjs
node --test vendor/pi-desktop/apps/desktop/test/godot-world-creation.test.mjs
# 原生候选（需固定 Godot 导出与 Electron 43.4.0）
$env:CRAFTMINE_ELECTRON_BIN="<electron-43.4.0>\electron.exe"
$env:CRAFTMINE_CANDIDATE_EXPORT="<fixed first-person export>"
node tests/godot-remaining/D/godot-candidate-native.mjs
```
