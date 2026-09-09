# 并行派工共同规则 v1

本规则是本次派工约定。用户要求各 Agent 完成后回传，再由协调者验收；因此各组提交自己的分支，**不自行合并主分支、不删除未合并工作树、不推送远端**。这是为执行本次用户回传验收流程所做的安排；vendor 中一般的立即合并/清理流程在本次统一由 G 收尾。其余适用 AGENTS.md 继续遵守。

## 产品与已完成部分

产品为 craftmine world / 最中幻想，首先服务 Windows 本机个人用户。保留并强化 PI-Desktop 完整桌面；持久创作事实与事务由 Rust 管理；pi 是唯一主 Agent 循环；现有游戏渲染和受控 Worker 继续使用。DeepSeek 是当前模型供应商，供应商选择与 Harness 底座分开。

代码基线 `07969ec`，派工引用 `dispatch/w2-w5-v1`。先核对引用存在且包含代码基线；不存在时核对收到的源码版本与本包，不自行切到上游最新代码。不能重做已完成的第 5 批流程或替换整个引擎来规避缺口。

## 工作方式

- 同机工作树示例：`D:/Craftmine World-worktrees/dispatch-a-<唯一后缀>`；分支示例：`codex/dispatch-a-<唯一后缀>`。各自从统一派工引用建立，不更改他人的分支、索引、文件或测试数据。
- 本仓库主分支为 `master`。只读核对主目录，不在主目录开发。此批无上游拉取、依赖整体升级、远端发布或自动化调度任务。
- 先阅读根 AGENTS.md、相关 vendor AGENTS.md、本组提示词、接口约定和第 5 批报告，再实施。中文产品文案；vendor 下代码注释、提交、规范和 ADR 按其规则使用英文。
- 每组只提交自己的文件。逻辑改动分别提交，不能 `git add .` 混入别人产物、个人配置或测试档案。
- 不编辑全局 `DEVELOPMENT_STATUS.json`、开发总日志和主计划来宣称全局完成；只写本组报告。最终由 G 更新全局状态。
- 文档落点按组隔离：`docs/dispatch-reports/<ID>/`、`docs/evidence/dispatch/<ID>/`。vendor 规范/ADR/E2E 新文件使用 `dispatch-<id>-...` 前缀；共同规范索引由 G 汇总，避免多组追加同一文件。
- 不创建更多自动循环或子 Agent。用户正在手工分发这六项任务。

## 不抢输入与个人数据

严格遵守根 AGENTS.md：禁止真实鼠标/键盘、Pointer Lock、显示/置前/激活测试窗口、操控用户正在使用的浏览器。浏览器和原生验收必须独立 headless/offscreen 进程、独立 profile，初始化禁用 requestPointerLock 和 window.focus；用 HTTP、受信页面脚本和纯逻辑验证，不用 mouse/keyboard/click/fill。

不得运行 `tests/browser.mjs`、`tests/modules-browser.mjs`。新增测试先检查是否符合这些限制；本派工要求的无输入验收才是授权测试范围。需要用户操作的视觉或安装项列出清单，不能为了验收临时抢鼠标。

个人 `D:/pi/PI-Desktop`、项目 `.craftmine`、端口 8787 服务及正在使用的桌面档案保持原状。测试数据由自己创建；从真实配置读取模型凭据只用已有授权测试入口，不能打印、提交或写入报告/摘要/作品。没有授权配置时完成离线测试，报告真实模型验证缺口，不虚构成绩或索取密钥进聊天。

状态文件中的五个旧残留目录不可清理或复用：`pi-client-20260909`、`pi-client-w1-20260909`、`pi-client-w2-20260909`、`pi-candidates-20260909`、`pi-apply-20260909`，均在 `D:/Craftmine World-worktrees/` 下。

## 文件所有权与共同入口

| 组 | 可写主范围 |
| --- | --- |
| A | `vendor/pi-desktop/crates/craftmine-core/`；`app/memory.mjs`、`app/creation.mjs`、`app/harness/memory-*.mjs`；新建 `plugins/craftmine-world/library-*`、`memory-*`、`recovery-*`、`backup-domain-*` 适配模块 |
| B | `vendor/pi-desktop/packages/agent-runtime/src/`；新建 Electron `craftmine-context-*`、`craftmine-budget-*`、`craftmine-recovery-*` 模块；`plugins/craftmine-world/review-jobs.cjs` 和新建 `context-*` 模块 |
| C | `plugins/craftmine-world/view.mjs`、`world.html` 和新增纯 UI 文件；`vendor/pi-desktop/apps/desktop/src/`（排除包配置及自动生成文件） |
| D | `app/game.js`、`game.css`、`game.html`、`gameplay.mjs`、`behavior-*.mjs`、`scene.mjs`、`geometry.mjs`、`preview-probe.mjs`；`app/harness/extension-*.mjs`、`render-extension.mjs`、`capabilities.mjs`；`plugins/craftmine-world/verify-view.mjs`、`applications.cjs`；`examples/dispatch-d/` |
| E | `desktop/build-client.ps1`、新增 `desktop/windows-*`；desktop 包的 `package.json`/专属打包配置/品牌资源；Rust `host-core/src/secrets.rs`、新增 Windows 凭据模块及 host-core `Cargo.toml`；新增备份/诊断 Electron 模块 |
| F | `tests/dispatch/f/`、新建 `electron/main/craftmine-acceptance-f-*` 测试辅助模块；只读审查其他实现 |

所有组可新增 `tests/dispatch/<小写组ID>/` 测试和自己命名的规范/证据。超出清单的现有文件默认归 G 接线；不能把“可能需要”当成可以重写公共入口的许可。

**G 独占以下共同入口的最终修改：** Electron `index.ts`、`plugin-runtime.ts`、`plugin-host-process.mjs`、`plugin-view-host.ts`、`agent-sidecar.ts`；plugin-sdk 的 `src/index.ts`；Craftmine 插件 `main.cjs`、`manifest.json`、`world-tools.cjs`、`domain-adapter.mjs`、`core-client.cjs`；`desktop/build-world-plugin.mjs`、`prepare-client.mjs`；根 package.json；共享协议、Cargo 工作区配置和各锁文件；`app/static-files.mjs`、冻结内核/断言清单；全局计划与规范索引。E 修改 desktop 的包配置时不升级公共依赖。

需要共同入口时，交付 `docs/dispatch-reports/<ID>/integration.patch` 和接线说明：基线 blob/hash、调用位置、导入、权限、生命周期、测试命令。可在自己的隔离工作树临时应用接线进行验证；报告必须记录该 overlay 的 SHA256 和完整源码状态，提交前仅撤销自己对共同入口的临时改动。若提交本身尚未接线，状态只能是 `ready_for_integration`。G 审查并实际接线后再复验。不得将多组接线补丁无审查地逐个强制应用。

如需新增依赖，优先用现有依赖完成；确有必要时记录名称、固定版本、目的和许可证，锁文件差异作为接线附件由 G 统一处理。不能为避免编译失败提交忽略锁文件/权限/验证的临时开关。

## 接口、验证与交付

- 新接口按 02 文档，已有字段与序列化保持兼容。接口变化先写本组 `INTERFACE_<ID>.md`，列出与约定的差异及影响；不悄悄让使用方猜测。
- 每组用独立 `CARGO_TARGET_DIR` 和测试输出目录。同机并行不能重建另一组正在运行的 Rust EXE。不要共用可写的 `target/`、profile、报告路径、固定测试端口或打包输出目录；可以复用只读下载缓存。
- 现有模型 ID/思考强度来自用户配置；到期、失效或超限要明确报错，不能静默换模型。真实测试设置调用、时限和压缩预算，失败不无限重复。
- 评审必须执行，设计意见只作建议。语法、ABI、实际需求断言、隔离运行、冻结回归、权限、冲突和世界编译才是可复核门槛。不得通过放松断言来凑通过数。
- 分开标记：逻辑测试、契约夹具、组件集成、原生离屏、真实模型、程序包、人工验证。没运行就写未运行；失败证据保留。只看 HUD、返回 JSON 或截图不等于玩法实际有效。
- 必须交付 `REPORT_<ID>.md` 与 `DELIVERY_<ID>.json`，模板见 03。保留未合并分支/工作树，等协调者验收。异机交付附可校验 Git bundle 或 `git format-patch --binary` 补丁，不只给一个不可访问的提交哈希。

交付后停止本组工作，等待反馈；不擅自扩展为其他组任务。用户或协调者后续明确派发修订时再继续。
