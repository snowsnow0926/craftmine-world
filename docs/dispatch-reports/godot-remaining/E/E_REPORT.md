# 任务 E 交付报告：世界居中界面、多世界创建与完整使用流程

日期：2026-09-10。分支 `codex/godot-remaining-e-20260910`，工作树
`D:/Craftmine World-worktrees/godot-remaining-e-20260910`，基线 `e462147`。
本报告只覆盖 E 的独占范围；未推送、未合并、未修改主目录与任何其他工作树。

## 1 结论先说

- 界面侧“选择底座 → 空白/样例 → 命名 → 创建”的**完整流程已经实现并用真实产品路径验证**：
  真实 React 面板 → 真实导航网关 → 真实保留插件视图 → 真实 `craftmine.world` 插件 → 真实 Rust 核心，
  包含插件与核心的完整重启。
- **“新建 Godot 世界”本身仍未完成**，原因不在界面：主机目前只提供 `craftmine-web/5` 一个已交付底座，
  `world.create` 对任何 Godot `baseId` 直接拒绝，且没有任何通道报告工程创建/导入/首次构建的进度。
  这些属于 A/C/D/F，接口见同目录 `INTERFACE_REQUEST.md`。
- 我没有用界面代码绕过这一限制：未交付底座显示为“规划中”且不可选，初始化中的世界显示主机真实步骤、
  不可游玩、不切换，失败世界只显示主机报告的错误与恢复动作。没有假成功按钮，也没有本地世界数据库。

## 2 本次改了什么（只改 E 独占文件）

| 文件 | 改动 |
| --- | --- |
| `src/lib/craftmine-worlds.ts` | 世界模型新增 `state` 与 `creation`（operationId/stage/stages/progress/error/actions）；解析器只接受主机显式上报的字段；新增 `isWorldPlayable`、`hasInitializingWorld`、`creationStageText`、`creationProgressText`、`creationActions`、`worldStateLabel`；`create` 返回 `state`/`creation`；新增 `creationAction` 通道；**修复：没有任何世界时也读取 `world.createOptions`**（此前全新安装拿不到可选底座） |
| `src/lib/craftmine-worlds-text.ts` | 初始化状态、恢复动作、恢复默认布局等中英文文案 |
| `src/lib/craftmine-layout.ts` | `CRAFTMINE_LAYOUT_DEFAULTS` 与 `resetCraftmineLayout`（保留当前模式） |
| `src/lib/craftmine-aux.ts` | 任务行在主机提供 `task.recoverable` 时显示“可接续 N 项草稿”，未提供时回退不报错 |
| `src/hooks/use-craftmine-worlds.ts` | 创建结果非 `ready` 时不切换世界；有界轮询（2.5s × 120 次）；`creationAction`；点击未完成世界只提示 |
| `src/components/craftmine/WorldCreatePanel.tsx` | 底座/起点显示主机说明与交付状态；规划中不可选；无已交付底座时禁用提交 |
| `src/components/craftmine/WorldListPanel.tsx` | 行状态徽标、阶段与进度、失败原因、主机报告的恢复按钮与详情展开 |
| `src/components/CraftmineLayoutControls.tsx` | 新增“恢复默认布局”，游玩/创作模式不变 |
| `src/styles/craftmine.css` | 新增状态、恢复、详情与窄窗样式 |
| `apps/desktop/test/craftmine-world-navigation.test.mjs` | 同步契约并新增 4 组用例（状态解析、排序、恢复通道、无世界时的能力读取、可接续草稿） |

App.tsx 与 Sidebar.tsx 未改：`CraftmineNavigation` 已由既有代码挂载，E 只扩展其独占组件与模型。
`plugins/craftmine-world/*`、`electron/main/index.ts`、`view.mjs` 均未修改。

## 3 验证与证据

全部自动验证使用独立 headless 浏览器与独立数据目录，初始化禁用 Pointer Lock，不发送鼠标/键盘，
不激活窗口；每份报告都断言 `requestPointerLock`/`focus` 计数为 0。未运行 `tests/browser.mjs`、
`tests/modules-browser.mjs`。

| 验证 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 真实产品路径创建/切换/重启 | `node tests/godot-remaining/e/world-create-e2e.mjs` | 19/19 通过 | `evidence/world-create-e2e.report.json`、`evidence/world-create-e2e.panel.png` |
| 创建流程契约（当前主机还产生不了的状态） | `node tests/godot-remaining/e/create-flow-ui.mjs` | 23/23 通过 | `evidence/create-flow-ui.report.json`、`evidence/create-flow-ui.png` |
| 世界模型/导航单元测试 | `node --test vendor/pi-desktop/apps/desktop/test/craftmine-world-navigation.test.mjs` | 24/24 通过 | `evidence/craftmine-world-navigation.test.txt` |
| 既有布局回归 | `node tests/batch07-desktop/layout-headless.mjs` | 10/10 通过 | `test-results/batch07-layout-*` |
| 类型检查 | `npx tsc -p tsconfig.json --noEmit`（`vendor/pi-desktop/apps/desktop`） | 0 错误 | 见提交说明 |
| 桌面端源码契约全量回归 | `node --test test/*.test.mjs`（`vendor/pi-desktop/apps/desktop`） | 1231/1247 通过；14 项失败均为既有基线失败 | 失败文件为 `window-menu`、`work-panel`、`context-compaction`、`packaging-footprint`、`startup-splash-motion`、macOS 发布与打包类，`git diff --name-only e462147..HEAD` 不含其断言的任何源码文件，且这些测试不引用 craftmine |

真实链路细节（`world-create-e2e.mjs`）：真实 `PluginRuntime` + 真实
`craftmine-navigation-host.ts` + 真实 `views/world.html`（`craftmineView.navigate`）+ 真实
`craftmine-core.exe`（SHA-256 `EF3C4E253E4C960687B497D4298C45027F354F80B12A85749482F25EC7AE0D57`，
与本工作树 `crates/` 同源，主目录该目录无未提交改动）。验证内容包括：面板列出真实 Rust 世界、
表单创建经网关与保留视图落到 Rust、`world.list` 确认两个世界与真实标题、面板行点击触发受管理切换、
插件与核心全部重启后世界仍在。

**夹具边界**：`create-flow-ui.mjs` 的主机是契约夹具，只用于覆盖当前主机还产生不了的
`initializing`/`failed`/规划中底座/恢复动作；它不替代真实链路验收，两者分别记账。
未调用真实模型、未生成安装包、未验证可见窗口合成与手感。

## 4 仍未完成 / 被依赖阻塞（逐项保留）

| 任务项 | 状态 | 阻塞与下一步 |
| --- | --- | --- |
| 2 新建流程：选择已交付底座 → 空白/样例 → 创建 | 界面完成；真实 Godot 底座不可用 | 需要 A 的持久化 `world.create` + `creationAction`、C 的 `createOptions`/`world.create`/`world.list` 透传、F 的底座与起点目录。接口见 `INTERFACE_REQUEST.md` §2–§4、§6 |
| 2 初始化成功后才登记可游玩世界、失败展示可恢复进度 | 渲染与轮询完成；主机尚无进度可报 | 同上；`view.mjs` 必须停止无条件 `mount` 非 `ready` 世界（root 合并） |
| 3 多世界分别保留名称/底座/进度/会话/记忆/任务 | 名称、进度、会话、任务已按世界显示与绑定；底座标签受主机缺字段影响 | `world.list` 需为每个世界返回 `base`（当前新建世界返回“底座未标注”）与最新 `check` |
| 4 创作/游玩切换、伸缩、宽度记忆、恢复默认 | 完成并回归通过 | 缩放与真实浅色主题下的可见合成仍需人工/真机确认 |
| 5 正式世界/草稿预览/检查/等待失败/恢复动作展示 | 世界状态与检查状态已在左侧显示；候选预览与应用在插件面板（D 范围） | 主窗口没有候选预览入口；如需在主窗口显示需 D 提供只读候选摘要通道 |
| 6 历史草稿接续、过期原因、预算类型、用量 unknown、作品导入复用、备份恢复入口 | 任务行可显示主机报告的可接续草稿；其余入口已存在 | `task.recoverable` 需加入 `NAVIGATION_READ_CHANNELS`；过期原因、实际耗尽预算类型与用量 unknown 属 A/L；历史/素材页属 M/N |
| M/N 导航接入 | 已给出唯一接入点与验收要求 | 等 M/N 提供组件与真实读取通道；E 负责联调与整体验收 |
| A01/A02/A09–A12 联合验收 | A01、A02 相关布局与切换回归通过；A09 的任务归属逻辑有单元与界面证据 | 仍需 I 用真实模型任务与真实 Godot 世界复验 |

## 5 提交与集成顺序

提交（本分支，未推送）：

- `651dd85` `feat(craftmine-ui): track real world initialization before a world is playable`
- `27b36e5` `test(craftmine-ui): verify world creation against the real host and contract fixtures`
- `04101e3` `test(craftmine-ui): cover zoom, narrow window and resumable draft summaries`

两份 `report.json` 的 `sourceCommit` 均为 `04101e3`，证据与代码一致。

集成顺序建议：先并入 A/C 的创建事务与通道，再并入 D/root 的网关与 `view.mjs` 最小接线
（`world.creationAction`、`create` 非 `ready` 不 mount），最后用本分支的两个脚本复跑；
主任务统一给 ADR/E2E 编号并汇入总表（片段见 `ADR-E-world-creation-states.md`、
`SPEC-E-world-creation-states.md`、`E2E-E-world-creation-states.md`）。

## 6 复现命令

```powershell
cd "D:/Craftmine World-worktrees/godot-remaining-e-20260910"
pnpm install --frozen-lockfile --dir vendor/pi-desktop
pnpm --dir vendor/pi-desktop -r --if-present build
node desktop/build-world-plugin.mjs
node tests/godot-remaining/e/world-create-e2e.mjs
node tests/godot-remaining/e/create-flow-ui.mjs
node --test vendor/pi-desktop/apps/desktop/test/craftmine-world-navigation.test.mjs
node tests/batch07-desktop/layout-headless.mjs
```

`world-create-e2e.mjs` 默认使用本工作树的
`vendor/pi-desktop/target/release/craftmine-core.exe`；本工作树未构建时回退到主目录同名二进制并在
`report.json` 记录 SHA-256（本次回退，见 §3）。
