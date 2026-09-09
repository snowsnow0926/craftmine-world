# Windows 客户端开发记录

## 2026-09-09：W0 启动

- 目标：持续完成计划 v2.1 的 W0–W5。用户追加 Rust 核心后端与保留完整 PI-Desktop 桌面体验，已合入主计划。
- 基线：Craftmine `3bdf52f`，固定 PI `ed0a75414e775eef4b4ee6c985cc9ddfe146ced2`。导入提交 `2920fc7`，来源见 `desktop/UPSTREAM.json`。
- 开发工作树：`D:/Craftmine World-worktrees/pi-client-20260909`，分支 `codex/pi-client-20260909`。主分支是 `master`。当前尚未合并回主目录。
- `pnpm install --frozen-lockfile` 成功；`cargo build --release --locked -p host-core` 成功；`pnpm build:js` 成功。日志位于工作树的 `test-results/pi-*.log`。未启动可见的 PI 窗口。
- 游戏接口：新增资源事务、共享扩展装载器、保留 Worker 的扩展依赖、重开和预览的扩展传递。`npm test`：274/274 通过。真实 headless Worker 与游戏页：7/7 通过，目标血量 60→50，重复事件不重复扣血。
- 尚未通过：真实模型扩展全链路与三次强制压缩后绿色收尾；固定测试成功不能替代这两项。
- W0 接入探针完成：Rust 事务核心 4/4；真实 PI 插件进程与 Rust 服务 8/8（`test-results/desktop-core-AzdSHs/report.json`）；隔离本地世界面板 6/6（`test-results/desktop-view-QT299T/report.json`）；插件调用身份回归 5/5。客户端类型检查、插件检查与构建均通过。
- 修复本地面板资源路径与 CommonJS 入口兼容性。游戏资源使用打包的 srcdoc 和精确脚本哈希，继续隔离玩法 Worker；未增加 Node 或插件桥访问权限。
- W0 领域回归复核：274/274；扩展真实 Worker 回归 7/7（`test-results/extension-behavior-rIRIaY/report.json`）。没有调用真实模型，没有运行可见 Electron 窗口。
- 进入 W1：独立产品身份与数据目录、完整 PI 界面中的世界入口、Rust 世界项目与进度存储、可重开的客户端。当前探针不等于正式客户端或安装包；W1–W5 尚未验收。

自动接续 `craftmine-windows` 每 30 分钟检查本线程；开发目标保持 active。阶段交付、实质失败或需输入时汇报。所有测试继续隔离且禁止真实输入和窗口置前。

## 2026-09-09：W1 世界存储第一批

- Rust 负责新的桌面世界、版本号与进度，单独创建的世界不串存档；保存拒绝旧版本覆盖、错误构建 ID 和损坏内容。兼容编译器与进度校验仍使用原有 JavaScript 契约。
- 面板可新建、切换、手动保存，每 10 秒保存一次，并在切换前保存；重新启动恢复上次选择。关闭前最后一次保存的确认屏障、旧存档迁移、实际 Electron 窗口和安装包尚未验收。
- `cargo test --locked -p craftmine-core`：7/7。`tests/desktop-worlds-browser.mjs`：8/8，证据 `test-results/desktop-worlds-wAa9sP/report.json`。使用独立 headless Chromium、真实 PI 插件进程、Rust 二进制和实际游戏，Electron 的页面传输层由测试适配器承接。

## 2026-09-09：W1 桌面外壳与 Windows 程序目录

- 独立应用名称、Windows App ID、数据目录与每个 profile 的实例锁；首次中文界面、世界侧栏入口、560px 默认工作面板和主题同步。保留 PI 桌面组件。上游应用更新关闭。
- 定向回归 21/21，客户端类型检查与样式检查通过。实际 React 组件的 headless 布局检查 7/7，人工查看深浅截图；会话与原生窗口传输为测试适配器，不能计作完整 Electron 验收。
- Windows `win-unpacked` 首次构建成功；实际包内插件宿主、插件与 Rust 程序的探针分别 8/8、9/9。最终构建流程增加许可证、来源与匹配源码归档，具体构建步骤见 `desktop/README.md`。
- 本批便携证据与截图已纳入 `docs/evidence/windows-batch-01`；总结见 `docs/WINDOWS_BATCH_01.md`。原始开发证据在合并整理时保存到主目录 `test-results/windows-batch-01`。内部程序目录保存在 `desktop/build/windows-preview`。
- 本批合并后清理自己的工作树和分支。下一轮按执行状态创建新的专用工作树继续 W1，目标与自动接续保持启用，不因本批报告完成而标记整个目标完成。
