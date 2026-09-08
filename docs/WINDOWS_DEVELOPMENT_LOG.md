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
