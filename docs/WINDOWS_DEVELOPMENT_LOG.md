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
- 合并完成：主分支已有 `90034d1` 及全部实现提交，合并后 274/274。程序与源码包移至 `desktop/build/windows-preview`，原始证据移至 `test-results/windows-batch-01`，Rust 构建缓存移至主项目 vendor 的 target。
- 清理例外：开发分支已删除，Git 工作树登记已移除；旧目录仍有残留，递归清理被自动执行审核以 “blocked by policy” 拒绝。保留残留，不以替代工具绕过，不自动重试。此事不阻断 W1/W2；下一批创建新的独立工作树。

## 2026-09-09：W1 关闭前保存确认

- 新工作树 `D:/Craftmine World-worktrees/pi-client-w1-20260909`，分支 `codex/pi-client-w1-20260909`。旧残留目录保持不动。
- 世界页面先冻结并清空待处理玩法事件，再让 Rust 保存，返回实际世界 ID、构建和版本后才关闭。切换世界、关闭标签、禁用世界插件与退出应用接入确认；世界页面不会被普通插件缓存淘汰。
- 保存失败或超时保留页面并恢复控制，取消一次退出不会让下一次原生关闭绕过保存。正常保存与关闭任务按顺序执行。
- `tests/desktop-worlds-browser.mjs` 14/14，真实游戏消息改变位置，注入保存失败后保留未提交进度，延迟确认后重试并重启 Rust 读回；证据 `docs/evidence/windows-batch-02/close-worlds.json`。Electron 页面传输仍是测试适配器。
- 退出流程回归 10/10，客户端类型检查通过。原生 Electron 窗口生命周期尚未验收，第一批程序目录也还没有更新为本次代码。下一步继续旧存档副本导入与原生无窗口验证。

## 2026-09-09：W1 旧世界副本导入

- 原生文件夹选择由宿主管理，页面伪造的路径不会转发给导入器。Rust 负责完整副本、文件清单、逐个哈希和导入事务。先校验当前场景、真实扩展代码、固定素材版本和进度，再创建独立桌面世界。
- 历史作品、未应用候选和未完成草稿完整保存在新客户端的备份目录。它们尚未接入新界面的作品管理和任务续作，不把“备份了”记作“已经能继续使用”。源目录从未被旧 ProjectStore 打开迁移；导入不会重新执行旧任务。
- Rust 10/10；旧世界导入 14/14，包含超过旧 2 MB 限制的实际 PNG、目标生命值 60→50、完整重启后保持 50、全部原文件与副本哈希一致、缺失扩展拒绝和 Windows junction 拒绝。源数据全部是隔离测试样本，未使用用户个人世界。证据见 `docs/evidence/windows-batch-02/legacy-worlds.json`。
- 实测同时修复扩展作品不能入库/安装，以及扩展源码错误被误报为过期消息。领域回归 275/275，扩展真实 Worker 检查 14/14。后者的模型评审和冻结世界钩子为测试数据，不计作真实模型验收。
- 客户端类型检查及插件/退出定向回归 15/15。完整 Electron 启动与原生关闭仍未验收；下一步建立严格离屏、隔离数据、无输入的运行入口后再测试。

## 2026-09-09：W1 原生运行与第二批交付

- 完成受严格隔离约束的原生 Electron 验收：独立 profile/目录与父进程通道，离屏且不可聚焦；初始化禁用 Pointer Lock 与 window.focus，拒绝真实输入、系统对话框、窗口显示和外部打开。真实插件 utility process、PI Rust 宿主、Craftmine Rust 服务和游戏均运行。
- 原生发现并修复首页工作台依赖已有会话、插件未收到 Rust 路径、早期 JSON 字段顺序哈希、关闭时重新创建已停止插件界面的问题。窄聊天栏的中文权限标签改为完整显示，工具组可以换行。
- `native-development.json` 与 `native-packaged.json` 各 17/17：真实 SQLite 写锁阻止退出、保留未保存游戏进度，释放写锁后正常保存退出，完整重启读回最后位置。两次退出的输入调用及未处理页面异常均为 0。原生桌面和世界分别截图，不把离屏表面当成可见窗口合成验收。
- 领域回归 276/276；Rust 10/10；桌面定向 47/47；实际 React 布局 9/9；类型及样式检查通过。包内任务探针 8/8、世界组件 14/14；旧世界导入重验 14/14。
- 构建实现提交 `7a2376d`；包内 EXE 验收脚本提交 `3490f46`。未签名程序目录保存到主目录 `desktop/build/windows-preview-batch-02`，带来源、许可证、源码归档与构建说明。EXE SHA256 `ddd29a53ae9a74778c4e52bf6483ee3fe962dc85d20e61ebfa9c86fddd7bf6f7`；源码 ZIP SHA256 `3b32766f3a741496bcc4e40c5e75ccdd4d831fe6d7849656f231f5b859273ef6`。
- 完整报告 `docs/WINDOWS_BATCH_02.md`，便携证据 `docs/evidence/windows-batch-02`，原始运行目录已保存到主项目 `test-results/windows-batch-02`。
- W1 核心运行自动验收通过，进入 W2 接线。仍未验收可见窗口合成、物理双击、安装器和新桌面的真实模型创作；没有复制个人凭据或操作用户世界。作品检索、候选界面和压缩后绿色收尾继续待办。
- 合并完成：`a5779f2` 及全部本批提交已进入本地 `master`。工作树登记与开发分支已删除；Git 删除目录返回 `Directory not empty`，随后针对本批残留的递归清理被自动执行审核以 `blocked by policy` 拒绝，未提供更具体原因。保留 `D:/Craftmine World-worktrees/pi-client-w1-20260909` 残留，不再自动删除或复用；不触碰先前已被拒绝清理的旧残留。此状态记录使用单独的轻量工作树提交，不在主目录直接开发。

## 2026-09-09：W2 会话草稿和真实 PI 创作

- 使用独立分支 codex/pi-client-w2-20260909、工作树 D:/Craftmine World-worktrees/pi-client-w2-20260909，从本地 master 6183279 开始。
- Rust 接管会话/世界绑定、草稿写入租约、不可变版本、读取来源、回执和停止记录；新轮次继承草稿，旧轮次与其他会话不能越权修改。
- PI 注册 project_inspect、capabilities_read、resource_read、workspace_patch；沿用纯世界编译/补丁逻辑。Electron 解析真实项目身份并检查当前轮次，停止和结束通过私有确认调用落到 Rust。
- 实现提交 bc5ff3a、b360559、d526ebb。Rust 16/16，插件草稿 16/16（含真实 SQLite 停止失败），核心探针 8/8，身份传递 5/5，原生开发版 23/23，领域回归 276/276；构建与类型检查通过。
- 真实 pi-agent-core/pi-ai 0.85.1 + DeepSeek 完成创建树、重启后保留树干放大树冠。首跑发现 appearance 格式混用和悬空树；修正契约并补接地检查后 6/6，11 次模型请求、10 次工具调用、0 次工具报错。两版几何在实际游戏沙箱渲染并检查截图。
- 本次真实模型使用隔离调用会话，不算实际桌面模型配置到应用的整条验收。候选、验收作业和作品复用继续待办；本批未更新 EXE 包，持续目标仍是 W0–W5。
- 完整报告 WINDOWS_BATCH_03.md，便携证据 docs/evidence/windows-batch-03，原始运行目录已复制到主项目 test-results/windows-batch-03。未操作真实输入、置前窗口或修改个人世界；未推送远程。
