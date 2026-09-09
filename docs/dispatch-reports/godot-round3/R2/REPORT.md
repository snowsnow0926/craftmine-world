# R2 第三轮交付报告：客户端闭环收尾

日期：2026-09-10。分支 `codex/godot-round2-r2-20260910`，HEAD `bfbb5ee`，基线 `c2e592f`
（第二轮 R1/C/R3/R4/R5/R6/R7/R8/R9 已保留历史合入）。未推送、未合并，主目录与其他工作树未改动。

## 1 审计点名的问题已修

| 审计问题 | 修复 | 证据 |
| --- | --- | --- |
| `index.ts` 把路径转成 `file:` URL 后 `loadMaterializer` 再次 `pathToFileURL`（双重编码） | `loadMaterializer(modulePath)` 现在只接受绝对路径、校验存在与导出，唯一一次转换在函数内；`index.ts` 传 `join(godotRoot, "shared", "materialize.mjs")`。测试用**真实模块**物化 top-down 工程并读出真实初始进度 | `godot-world-creation.test.mjs` "the shipped materializer loads from an absolute path exactly once"、"the main process passes a path, never a pre-converted URL" |
| 工厂对所有异常一律删除物化目录（核心已提交但回包丢失会删源码） | 异常后先查 `godotWorld.initStatus`：有耐久记录→按该记录返回成功、**不删目录**；核心明确回答“未初始化/世界不存在”→才释放本次操作创建的目录；查询本身失败→保留源码并抛 `WORLD_CREATE_UNCERTAIN`（带 `worldId`/`operationId` 供重试） | 三个用例："a lost reply is reconciled…"、"an unknown outcome keeps the source…"、"a world the core never registered releases its managed copy" |
| 新建世界没有稳定操作身份 | `operationId` 由创建面板每个对话框生成一次（`useRef`），经导航网关校验后传到工厂；`worldId = "world-" + sha256("craftmine.godot-world-op/1\|" + operationId)[0:12]`，重试命中同一个世界 | "world ids are stable per operation…"、"the create panel keeps one stable operation id for retries" |
| `main/index.ts` 未构造并注入 `GodotBuildVerifier` | `index.ts` 构造 `new GodotBuildVerifier()` 并以 `godotVerification:{check,cancel}` 注入 `PluginRuntime`，退出前 `cancelAll()`；`plugin-runtime.ts` 增加 `craftmine.godotCheck`/`craftmine.cancelGodotCheck` 路由与 `godotVerification?` 服务槽 | "the main process injects the isolated Godot build verifier" |
| 物化模块/底座目录从真实主进程位置解析 | 新增用例从 `apps/desktop/out/main` 向上解析到 `<repo>/desktop/godot`，并覆盖 packaged `resources/godot` 与 `CRAFTMINE_GODOT_BASES` 覆盖 | "the shipped Godot root resolves from the compiled main process directory" |
| 运行观察缺少世界/构建/实例身份 | `view.mjs` 记录宿主广播的 `{worldId,buildId,instanceId}`，`craftmineView.snapshot()` 在 Godot 世界返回 `identity`；切世界清空 | 插件重编后 D 的原生候选测试仍 **7/7** |

## 2 验证（全部独立 headless/offscreen、独立数据、无真实输入）

| 验证 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 客户端单元（创建/映射/网关/世界模型） | `node --test test/godot-world-creation.test.mjs test/craftmine-navigation-host.test.mjs test/craftmine-world-navigation.test.mjs` | **45/45** | `evidence/client-unit-tests.txt` |
| 创建契约（真实核心 stdio） | `node tests/godot-round2/R2/creation-contract-core.mjs` | **12/12** | `evidence/creation-contract-core.report.json` |
| 左侧面板真实导航 | `node tests/godot-round2/R2/surface-navigation-e2e.mjs` | **13/13** | `evidence/surface-navigation-e2e.report.json` |
| 素材库导航（真实 R6 组件） | `node tests/godot-round2/R2/asset-navigation-ui.mjs` | **9/9** + 1 项 R6 缺陷记录 | `evidence/asset-navigation-ui.report.json` |
| D 原生候选闭环（真实 Electron+Godot+Rust） | `node tests/godot-remaining/D/godot-candidate-native.mjs` | **7/7** | `evidence/candidate-native-with-verifier.report.json` |
| 上一轮创建/切换/重启回归 | `node tests/godot-remaining/e/world-create-e2e.mjs` | **19/19** | `test-results/godot-remaining-e-create-*` |
| 上一轮创建流程 UI 回归 | `node tests/godot-remaining/e/create-flow-ui.mjs` | **23/23** | 同上 |
| Rust 核心 | `cargo test -p craftmine-core --release` | 226 通过 / 1 失败 / 3 忽略 | `evidence/rust-core-tests.txt` |
| 桌面端全量契约 | `node --test test/*.test.mjs` | 1248/1264，14 项失败；与 `bcebeb1` 基线逐项相同，**新增回归 0** | `evidence/desktop-suite-baseline-comparison.json` |

引擎身份：`craftmine-core.exe` SHA-256 `8925d553a987f7bd4ca61709013fddfd66279cca9c676a9b8c008cc8736cca98`
（本工作树 `cargo build --release -p craftmine-core`）；Electron 43.4.0；Godot 导出固定副本
`index.wasm` SHA-256 `F6090F055E16765BCEF5DC3A031F68AB40C151D9E7F0541D9D7EB61E92DC5051`。
每份报告断言页面未请求 Pointer Lock 与焦点；未运行 `tests/browser.mjs`、`tests/modules-browser.mjs`。

## 3 仍未完成（逐项保留，附负责人与入口）

| 要求 | 状态 | 缺口 |
| --- | --- | --- |
| 2 完整创建流程（物化→登记→首次构建→检查→firstLoad→可玩） | **未完成** | S2 需在 `host-requests.cjs` 加 `godotWorld.initialize`/`initStatus` 两行路由（第三轮已请求，分支尚未包含）；S1 需确认“物化工程登记为 revision 0 → `godotBuild.start{check}` → `firstLoad`”的调用顺序与入口。R2 侧已就绪并在真实核心上验证了 `initialize` 载荷 |
| 4 Git 分支修改/应用、内容恢复、进度恢复 | 未开始 | 依赖 S1 的 `content.*` RPC 与面板通道；R2 的导航接入点已就绪（`CRAFTMINE_AUX_SECTIONS` + `world.surface`） |
| 5 采样/预算使用 S2/S6 正式接口 | 部分 | 已注入检查器并暴露运行身份；模型侧观察通道属 S6 |
| 6 历史分支/差异/恢复界面 | 未开始 | 依赖 S1 通道 |
| 6 素材/作品/草稿/备份入口 | 已接 | 素材面板见 §2；作品安装、草稿接续、备份导出/恢复沿用既有 workbench 面板（`world.surface`） |
| 7 四底座机器可读初始进度 | **部分** | `top-down`、`mining-sandbox` 可创建；`first-person`/`side-view` 的目录 `initialState` 仍是描述文本（`"spawn"`、`"catalog defaults"`、`"scene authored health"`），物化工程内无 `initialProgress`。客户端明确报 `BASE_INITIAL_STATE_MISSING` 而不伪造。需 S3 为这两类底座发布具体数值 |
| R6 缺陷（S5 修） | 已记录未放行 | `AssetLibraryPanel` 的 `scan` 结果/方法同名导致导入流程崩溃；`useAssetLibrary` 每次渲染返回新对象（R2 已最小修复挂载 effect 依赖） |
| R5×S1 缺陷（S4/S1 修） | 已记录未放行 | 便携归档表清单缺 Godot/Git 表 → `GODOT_PROJECT_REVISION_NOT_INDEXED` |

**不能把“客户端到核心初始化返回成功”当成“首次创建可游玩已经完成”**：R2 的工厂在
`godotWorld.initialize` 成功后返回 `initializing`，界面按真实 `initStatus` 显示四个阶段，
只有核心报告 `confirmed/playable` 才标记可游玩。首次检查与 firstLoad 的接线在 S2/S1 落地后
由 R2 联合复验。

## 4 提交（本轮）

- `1b45d06` `fix(godot-host): load the materializer from a path, keep a stable create identity and inject the build verifier`
- `bfbb5ee` `feat(craftmine-view): expose the host-reported live world/build/instance identity`

## 5 复现

```powershell
cd "D:/Craftmine World-worktrees/godot-round2-r2-20260910"
cargo build --release -p craftmine-core --manifest-path vendor/pi-desktop/Cargo.toml
node desktop/build-world-plugin.mjs
$env:CRAFTMINE_CORE_BIN="$PWD/vendor/pi-desktop/target/release/craftmine-core.exe"
node --test vendor/pi-desktop/apps/desktop/test/godot-world-creation.test.mjs
node tests/godot-round2/R2/creation-contract-core.mjs
node tests/godot-round2/R2/surface-navigation-e2e.mjs
node tests/godot-remaining/e/world-create-e2e.mjs
# 原生候选（需 Electron 43.4.0 与固定 Godot 导出）
$env:CRAFTMINE_ELECTRON_BIN="<electron-43.4.0>\electron.exe"
$env:CRAFTMINE_CANDIDATE_EXPORT="<fixed first-person export>"
node tests/godot-remaining/D/godot-candidate-native.mjs
```
