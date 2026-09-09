# 任务 D 交付报告：左侧世界列表 / 中央世界 / 右侧对话的产品体验

日期：2026 年 9 月 9 日。基线 `46739d2`（最新 master），本轮起点核对后未回退。

- 分支：`codex/godot-parallel-d-20260909`
- 工作树：`D:/Craftmine World/test-results/worktrees/godot-parallel-d`
- 实现提交：`8819c6f`（`feat(craftmine): add left-column world navigation with host-backed data`）
- 按分工只提交自己的改动：**没有**合并 master、没有推送、没有清理工作树。

## 1 修改范围

只改任务 D 分配的文件，未触碰 C 的 `PluginViewTab`、游戏视图协议、Electron 运行器，也未改 Rust 与插件共享入口。

| 文件 | 变更 |
| --- | --- |
| `vendor/pi-desktop/apps/desktop/src/lib/craftmine-worlds.ts` | 新增：世界列表模型、桥接契约与解析、底座/来源/状态文案、排序、切换计划、错误映射、`CRAFTMINE_REQUIRED_CHANNELS` |
| `vendor/pi-desktop/apps/desktop/src/lib/craftmine-aux.ts` | 新增：作品/素材/检查/记忆/任务/备份六个辅助区定义与真实摘要读取 |
| `vendor/pi-desktop/apps/desktop/src/lib/craftmine-worlds-text.ts` | 新增：中英文文案集中表 |
| `vendor/pi-desktop/apps/desktop/src/hooks/use-craftmine-worlds.ts` | 新增：加载/切换/创建控制器（加载错误与操作错误分开，失败不覆盖） |
| `vendor/pi-desktop/apps/desktop/src/components/craftmine/WorldListPanel.tsx` | 新增：世界列表（名称、底座、最近状态、检查、当前/任务标记） |
| `vendor/pi-desktop/apps/desktop/src/components/craftmine/WorldCreatePanel.tsx` | 新增：底座 → 空白/示例 → 命名，只开放已交付选项 |
| `vendor/pi-desktop/apps/desktop/src/components/craftmine/WorldAuxSections.tsx` | 新增：按需展开的辅助区 |
| `vendor/pi-desktop/apps/desktop/src/components/CraftmineNavigation.tsx` | 改为承载世界列表、世界会话行、辅助区，保留 `data-nav="world"` 与世界面板入口 |
| `vendor/pi-desktop/apps/desktop/src/lib/craftmine-layout.ts` | 增加 `aux` 展开状态（向后兼容，旧存储仍可读） |
| `vendor/pi-desktop/apps/desktop/src/styles/craftmine.css` | 世界列表/创建/辅助区样式：窄栏换行、深浅主题、长中文与长错误 |
| `vendor/pi-desktop/apps/desktop/test/craftmine-world-navigation.test.mjs` | 新增：19 项单元/契约测试 |
| `tests/godot-parallel-d/world-navigation.mjs` | 新增：真实组件 + 真实插件 + 真实 Rust 核心的 headless 验收 |
| `vendor/pi-desktop/docs/spec/dispatch-d-world-navigation.md`、`docs/adr/dispatch-d-renderer-world-channel.md` | 独立 spec 与 ADR |
| `docs/dispatch-reports/godot-parallel/D/INTERFACE_REQUEST.md` | 接口与补丁说明 |

## 2 实现要点

1. **左侧世界列表**：真实 `world.list` 的名称、版本、`updatedAt` 推导的最近保存、可选的最近检查状态；当前世界排最前并标记，正在运行任务所属世界标“任务在这里”，其下显示当前世界绑定的会话（原有会话/项目导航完整保留）。
2. **真实底座标签**：主机报告 `base` 时显示；未报告时显示“底座未标注”，规划中的底座显示“规划中”且不可选。**没有**把任何规划底座显示成可用。
3. **创建流程**：底座（只列主机报告且 `delivered` 的）、起点（主机未报告时只有“空白”）、命名（去空白、上限 80 字、空名拒绝）。创建失败保留原世界并显示完整主机错误。
4. **切换接入已有保存与绑定**：切换只调用世界通道，由世界视图执行“冻结 → 保存 → 打开”；保存失败停留在原世界并显示主机错误；**不重定向运行中的任务**（切换期间不调用任何 task/session 变更通道，会话与任务归属不变）。
5. **辅助区**：默认折叠，展开时读真实通道（`library.search`、`verification.list`、`memory.search`、`task.current`、`backup.status`），深层界面仍在世界面板打开；展开状态记进现有布局偏好。素材区没有真实通道，明确显示“接口未接入”。
6. **布局**：窄窗口下列表滚动、行换行、输入框可达、无横向溢出，直到 240px 侧栏最小宽度；游玩模式隐藏列表与对话但两棵 React 树保持挂载，返回创作后输入与世界实例不变；深浅主题均可读；长中文与长错误不撑破列。
7. **不造假数据**：渲染进程不保存世界数据库；主机通道缺失时显示“世界列表接口尚未接入，这里不会用本地数据代替”，创建入口禁用。

## 3 实际验证与原始证据

### 3.1 单元与契约测试

`node --test test/craftmine-world-navigation.test.mjs` → **19/19 通过**。覆盖解析与容错、底座三态、最近保存分档、排序、切换计划（noop/忙/不支持/任务留原世界）、标题规范化、错误映射、桥接通道名与失败语义、辅助区摘要与缺失通道、展开持久化与损坏存储、组件契约、以及“渲染进程没有第二套世界数据库”。

### 3.2 回归对照（证明不是本任务引入）

- 本工作树：`apps/desktop` 全量 `node --test test/*.test.mjs` → **1238 项，1222 通过，14 失败**。
- 基线对照：同一命令在 `46739d2` 的干净工作树 → **1219 项，1203 通过，14 失败**（失败项完全相同：打包/发行/macOS/compaction 等既有失败）。
- `tsc -p tsconfig.json --noEmit` 通过；`pnpm build:js` 通过。

### 3.3 真实 headless 验收

`node tests/godot-parallel-d/world-navigation.mjs` → **28/28 通过，0 错误**，退出码 0（连续三次运行结果一致）。

- 真实 `PluginRuntime` + 真实 `craftmine.world` 插件构建 + 本地编译的 `craftmine-core`（`cargo build --release -p craftmine-core`）驱动真实世界数据；真实 React 组件在同一独立 headless 浏览器进程中渲染；世界面板为真实 `views/world.html`。
- 全程只用页面脚本、DOM 事件与面板桥：无鼠标键盘、无 Pointer Lock、无窗口激活；用例末尾专门断言 `__inputRequests === 0`。
- 覆盖：真实世界列表与排序、底座未标注的真实显示、最近保存、创建（真实 Rust 持久化并打开）、创建失败（400+ 字错误换行且不撑破列）、保存失败停留在原世界（UI 与 Rust 两侧一致）、任务运行时切换的提示与会话不变、切换不产生任何任务/会话变更调用、辅助区折叠/真实摘要/打开深层界面/展开记忆、游玩与返回的实例保持、窄窗与 240px 侧栏、浅色主题、主机通道缺失时的显式状态、无未处理异常。
- 证据：[world-navigation.json](../evidence/godot-parallel-d/world-navigation.json)（含 28 项检查、commit、插件与核心路径）、[深色](../evidence/godot-parallel-d/world-list-dark.png)、[窄窗](../evidence/godot-parallel-d/world-list-narrow.png)、[浅色](../evidence/godot-parallel-d/world-list-light.png)。SHA256 前 16 位：json `59DDA9D6000FE5B1`、dark `7DF5EA59168355F3`、narrow `B669CE6967F876EF`、light `15A70AF3BDB02F58`。
- 未运行 `tests/browser.mjs`、`tests/modules-browser.mjs`，也未运行任何输入模拟。
- **完整客户端集成回归**：`node tests/desktop-shell-browser.mjs` → **15/15 通过**（真实 `App` + 真实样式 + 世界面板），包含“会话侧栏与世界入口仍在”“默认世界居中、对话在右”“游玩展开保留同一世界与对话实例”“窄窗与更窄窗输入可达”“未请求真实输入或焦点”“无未处理异常”。说明 `CraftmineNavigation` 重写没有破坏既有布局与会话能力。

### 3.4 验收项对应

| 要求 | 证据 |
| --- | --- |
| A01 UI 部分（默认世界居中、对话在右、窄窗可输入与返回） | 窄窗与 240px 侧栏检查、输入框可达检查、游玩/返回实例保持检查 |
| A02 UI 部分（展开游玩再返回保持世界、进度与会话） | 游玩隐藏但两棵树挂载、返回后输入与世界列表同一实例 |
| A09 UI 部分（创作期间切换世界不重定向任务） | 任务标记、提示文案、会话不变、无任务/会话变更调用四项检查；主机侧 `SELECTED_WORLD_CHANGED` 由既有网关测试覆盖 |
| 创建失败 | 长主机错误检查（世界数不变、当前世界不变、错误完整显示且换行） |
| 保存失败 | 真实注入保存失败（真实冻结与保存路径），UI 与 Rust 都停留在原世界 |
| 任务仍运行时切换 | 同上 A09 |
| 窄窗输入与返回入口 | 窄窗与 240px 检查、返回创作检查 |

## 4 独立审查与修复

实现完成后由独立审查子代理复核了全部改动，发现并已修复以下问题（提交见下一条）：

1. **创建成功但打开失败会被误记为成功**：`world.create` 会把新世界设为主机当前选择，原实现先刷新再切换，切换失败时列表已把新世界标成“当前”，而世界视图仍停在旧世界。现在切换失败会把主机选择用 `world.open` 放回视图仍在运行的世界，表单保持打开并显示真实错误，列表与视图始终一致。
2. **辅助区摘要跨世界串用**：摘要现在带 `worldId`，切换世界即清空，迟到的响应被丢弃。
3. **能力读取缺少 `worldId`**：面板网关会拒绝非当前世界的调用，已改为携带当前 `worldId`；底座/起点仍只认主机显式 `delivered: true`，静默主机不再被当成已交付。
4. **创建表单可能提交过期底座**：提交时按当前能力重新解析，未交付或已消失的选项不会发送。
5. **重复提交**：`busy` 用同步 ref 保护，`create` 期间不再可能创建两个世界；`busy` 直到列表刷新完成才解除，避免按钮在陈旧状态上重新可用。
6. **辅助区按钮承诺了未实现的页签跳转**：文案改为“打开世界面板”，区段跳转作为接口请求提出（INTERFACE_REQUEST 第 5 节）。
7. 其他：桥接在只有 `onChanged` 而无 invoker 时返回 `null` 而不是半成品；世界列表按 id 去重；行不再覆盖无障碍名称；新增 `parseWorldCapabilities`、`planWorldSwitch(saving)`、排序并列/重复、能力请求携带 worldId 等 5 项单元测试，并新增“创建成功但无法打开”的验收用例。

## 5 未完成项与边界

1. **打包客户端里真正切换世界还差一段共享入口接线**：渲染进程目前没有调用插件面板通道的 IPC。D 侧已完整实现并验收（验收夹具驱动的正是世界视图现有的“冻结→保存→打开”序列），缺的是 `pluginPanelInvoke` IPC 与视图侧 `craftmine:world-switch` 处理，补丁见 [INTERFACE_REQUEST.md](INTERFACE_REQUEST.md) 第 1、2 节。在此之前，列表、创建、检查与辅助区可用；切换会显示“主机尚未提供安全切换”。
2. **底座与来源标签**：Rust `WorldSummary` 没有底座字段，旧世界导入标记也没有通道暴露，因此真实主机下显示“底座未标注”。已给出插件侧最小改动建议（第 3 节），未报告时 UI 绝不编造。
3. **创建选项**：`world.create` 目前忽略参数、只创建网页体素空白世界，因此真实主机下只开放“空白”，底座一栏写明“主机尚未报告可选底座”。建议的 `baseId`/`starterId`/`world.createOptions` 见第 4 节。
4. **素材辅助区**：无真实通道，显示“接口未接入”，见第 5 节。
5. **未验收**：真实产品模型在左侧列表下连续创作、真实多世界并发任务的端到端体验；本任务只覆盖 UI 与世界/会话绑定的可验证部分。视觉与手感由玩家试玩确认，未用截图冒充操作手感。

## 6 需要其他任务提供的接口

见 [INTERFACE_REQUEST.md](INTERFACE_REQUEST.md)。简要：

- 任务 C / I：`pluginPanelInvoke` IPC（protocol + preload + main + api.ts）与世界视图的 `craftmine:world-switch` 处理（复用现有序列，`busy` 时明确返回忙而不是静默丢弃）。
- 插件侧：`world.list` 增加 `base`/`origin`（可选 `check`），`world.create` 接受 `baseId`/`starterId` 并新增 `world.createOptions`。
- 后端：素材清单通道，或明确的“不支持”结论。
