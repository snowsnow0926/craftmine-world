# 任务 B 交付报告：受管理的 Godot 构建、检查、候选与应用

日期：2026 年 9 月 9 日。基线 `46739d2`。分支 `codex/godot-parallel-b-20260909`。
工作树：`D:/Craftmine World-worktrees/godot-parallel-b-20260909`。未合并 master、未推送、未清理任何工作树。

## 1 提交

| 提交 | 内容 |
| --- | --- |
| `301872d` | `docs(godot): publish managed build, job, candidate and application interfaces` |
| `379ca2f` | `feat(godot): manage isolated build, check and candidate transactions` |
| `62d1841` | `feat(godot): expose managed build and candidate tools through PI` |

## 2 修改范围

**Rust（`vendor/pi-desktop/crates/craftmine-core/`）**
- 新增：`src/godot_builds.rs`（资产库、每构建工程副本、构建身份）、`src/godot_jobs.rs`（执行器门禁、作业生命周期、候选）、`src/godot_applications.rs`（候选应用事务）。
- 新增测试：`godot_builds_tests.rs`、`godot_jobs_tests.rs`、`godot_applications_tests.rs`、`godot_test_support.rs`（共 27 项新测试）。
- 修改：`src/lib.rs`（注册模块与表、`executors` 字段）、`src/main.rs`（19 个 RPC 方法、启动恢复、hello 能力位）、`src/godot_projects.rs`（共享 helper 可见性、`ordinary` 增加错误码参数）、`src/applications.rs`（`was_applied` 同时识别 Godot 应用记录）、`src/worlds.rs`（`validate_progress` 可见性）、`Cargo.toml`（base64 0.23，已在 Cargo.lock 中）。

**PI 插件（`plugins/craftmine-world/`）**：`manifest.json`（7 个新工具声明）、`world-tools.cjs`（方法映射、幂等回执恢复）、`main.cjs`（能力位、面板通道）。

**测试**：新增 `tests/godot-build-tools.mjs`；`tests/godot-project-tools.mjs` 的工具清单断言由 4 个更新为 11 个。

**文档**：`docs/dispatch-reports/godot-parallel/B/INTERFACE_B.md`（接口，先发布）、`vendor/pi-desktop/docs/adr/0313-managed-godot-build-jobs.md`、`vendor/pi-desktop/docs/spec/dispatch-managed-godot-build.md`。

未修改：Electron 世界视图与布局、底座工程与示例内容、A 的隔离实现、`DEVELOPMENT_STATUS.json`、全局 Goal 与总计划。

## 3 实际验证与原始证据

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `cargo test -p craftmine-core --offline` | 96 通过 / 0 失败 / 1 忽略（历史 Windows junction 夹具，非本轮引入） | `evidence/rust-core-tests.txt` |
| `node --test tests/godot-build-tools.mjs tests/godot-project-tools.mjs` | 12 通过 / 0 失败（真实 broker 打包 + 真实 Rust 二进制 + 独立数据目录 + 模拟隔离执行器走进程协议） | `evidence/pi-plugin-integration-tests.txt` |

覆盖的验收项（全部有断言，不是声明）：

- **跨世界与旧 turn 拒绝**：`PROJECT_WORLD_BINDING_MISMATCH`、`TASK_INACTIVE`、`STALE_TURN`；面板切换世界不会改变已绑定工程（集成测试第 2 项）。
- **陈旧源码拒绝**：`GODOT_SOURCE_STALE`（Rust 与插件各一层）。
- **实际编译错误**：执行器声明 `passed:true` 但 `compile.errors` 非空时，作业仍记 `failed`，候选为 `rejected`，应用被拒。
- **重复调用**：同 `toolCallId` 同请求返回同一回执；不同请求体 `REPLAY_MISMATCH`；重复 `finish` 返回同一 `outputHash` 且不重复应用。
- **提交后丢响应**：注入传输失败后 broker 只读回执、不重放写入（资产与构建各一次，调用计数被断言）。
- **取消后迟到结果**：`GODOT_JOB_INACTIVE`，无候选产生。
- **核心重启恢复**：`claimed/running` → `interrupted`，执行器注册失效，迟到结果被拒；`prepared` 应用 → `interrupted`，正式世界不变。
- **资源损坏**：资产 blob 与构建副本被篡改时报告 `CORRUPT_GODOT_ASSET` / `CORRUPT_GODOT_BUILD`，不自动“修复”。
- **失败候选不能替换正式世界**：`rejected` 候选无法 prepare；提交证据不匹配、世界版本变化、玩家状态变化时正式世界与进度保持原样。
- **执行器门禁**：无注册执行器时作业 `blocked`、`executionAvailable:false`、`claim` 被拒；注册后才 `queued`。核心从不自己启动 Godot。

未运行的项（如实记录）：

- `pnpm build:js`、桌面 `tsc --noEmit`：本工作树没有安装 node_modules（主仓库与历史工作树同样缺失），离线无法执行。插件文件为纯 CJS/JSON，已由真实 stdio 集成测试加载执行。
- 真实 Godot 导入/编译/检查：需要 A 的隔离执行器；本轮用进程协议上的模拟执行器验证接线与门禁，不声称引擎已跑通。
- `cargo test -p host-core`：13 项失败，全部是 Windows 路径分隔符 / `\\?\` 规范化断言。`host-core` 不依赖 `craftmine-core`（Cargo.toml 与源码均无引用），与本轮改动无关，属既有环境问题。
- 真实鼠标键盘 / Pointer Lock / 激活或置前窗口：本轮测试完全未涉及；未运行 `tests/browser.mjs`、`tests/modules-browser.mjs`。

## 4 未完成项

1. **A 的真实隔离执行器**未接入：本轮只有协议、门禁与模拟执行器；`evidenceHash` 的真实隔离证据由 A 提供，核心不代其宣称。
2. **共享导入缓存**未实现：每个构建有独立 `cache/`，跨构建复用缓存、缓存体积与清理策略未做。
3. **存储生命周期**：资产与构建副本没有总量配额、没有垃圾回收；历史构建与孤儿 blob 会累积。
4. **资产不可删除/替换**：同一路径只能有一个内容；改素材需要新文件名。缺少 `godotAsset.remove`。
5. **作业列表工具**：只能按 `jobId` 读取单个作业，没有“列出本世界作业”的模型工具（面板也依赖已知 jobId）。
6. **候选应用只做了核心与通道**：面板 UI、预览与玩家交互属 C；本轮未做界面验收。
7. **未做**：真实模型创作验收、画面/手感验收、发行打包；这些按项目要求分别记账。

## 5 需要其他任务提供的接口

- **A**：实现 `godotExecutor.register` / `godotJob.claim|progress|heartbeat|finish` 的隔离执行器；声明真实 `isolation` 与 `evidenceHash`；把产物写入 `claim.artifactsRoot` 并回填 `inputHash`。缺注册即不可执行，这是有意的门禁，不要走未隔离后门。
- **C**：使用 `godot.*` 面板通道（见 `INTERFACE_B.md` §3.1）与 `godotApplication.*`；世界列表底座标签取 `build.scene.baseId` 或 `build.godot.baseId`。应用成功后作者任务被关闭，同一轮后续工具调用会得到 `TASK_INACTIVE`，界面应把“应用”放在轮次末尾。旧运行器必须忽略 `scene.format: craftmine.godot-scene/1` 的世界。
- **E**：把执行器二进制与 `CRAFTMINE_GODOT_EXECUTOR` 配置纳入安装包；备份策略应排除 `godot-builds/*/cache` 与 `artifacts`（可重建），保留 `source/` 与资产库或按 `buildId` 重建。
- **F / G**：以 `INTERFACE_B.md` §4/§6 的状态机为断言来源；失败候选、取消后迟到结果、重启恢复都必须验证正式世界不变。
- **I**：本轮已由我改动 `plugins/craftmine-world/main.cjs` 与 `manifest.json`（任务 B 拥有该权限）；如需再接线，接口已固定，无需其他人改这两个文件。
