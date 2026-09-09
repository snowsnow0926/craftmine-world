# 任务 A 报告：受管理 Godot 构建进程的 Windows 执行边界

- 分支：`codex/godot-parallel-a-20260909`
- 工作树：`D:\Craftmine World-worktrees\godot-parallel-a-20260909`
- 提交：`01d3082c421c27f5d8468d873f3700f1a877ac43`（未合并 master、未推送、未清理他人工作树）
- 修改范围：`desktop/godot/sandbox/**`、`docs/dispatch-reports/godot-parallel/A/**`、`docs/specs/godot-sandbox-execution-boundary-A.md`、`docs/adr/ADR-godot-sandbox-execution-boundary-A.md`
- 验收环境：普通用户（`token_is_elevated=0`）、会话 1、辅助进程位于 `WinSta0\Default`；证据 `desktop/godot/sandbox/evidence/parent-environment.log`

## 1. 结论先说

1. **历史七次尝试的 `0xC0000142` 已定位到唯一变量**，不是 AppContainer、不是桌面、不是 Job 限额、不是句柄列表、不是环境、更不是“最后加载的 KernelBase.dll”。
2. 真正的触发条件是 **`PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED`**。只要带这个创建属性，任何子进程（本机探针、`cmd.exe`；带或不带 AppContainer、Job、桌面）都会在加载器初始化阶段以 `0xC0000142` 退出。
3. 去掉该属性后，**受管理边界端到端可用**：真实 Godot 4.7.2 的 `--version`、headless 导入、Web 导出全部成功；文件越界、交互站、非回环网络、子进程创建均拿到明确的拒绝错误码；取消/超时后无残留进程。
4. 子进程控制改用 **Job 的 `JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1`** 实现，实测拒绝码 `1816`（`ERROR_NOT_ENOUGH_QUOTA`），不需要那个有害的创建属性。
5. **未通过的项必须记账**：回环（loopback）网络默认**允许**，这是当前边界最大的真实缺口，普通用户无法通过 WFP/防火墙修复，见第 6 节。

## 2. 定位过程（只做有新变量的尝试）

### 2.1 先量父进程与启动条件

`evidence/parent-environment.log`：`token_user=S-1-5-21-…-1004`、`token_integrity_rid=8192`、`token_is_appcontainer=0`、`token_is_elevated=0`、`token_session_id=1`、`station_name=WinSta0`、`desktop_name=Default`。即产品普通用户运行环境，不是提权或服务身份。

### 2.2 第一轮 13 变量差分

`src/bin/sandbox-diag.rs` 每次只改一个启动条件，并同时记录退出码、子进程是否到达 `main`（标记文件）与子进程自身身份报告。第一轮结果（原始：`out/matrix-*/matrix.txt`）：

- 失败组（全部 `0xC0000142`、`reached_main=false`、日志 0 字节）：baseline、no-desktop、current-station-desktop、winsta0-desktop、desktop-all-application-packages、no-handle-list、full-env、no-appcontainer、no-appcontainer-no-desktop、cmd-child、baseline-diagnose。
- **通过组**：`no-job`、`no-child-restriction`（退出 `0x0`，`reached_main=true`，且子进程身份报告可读）。

两组的唯一共同差异是：通过组**没有** `PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY`。注意 `no-appcontainer`（普通 token + Job + 该属性）同样失败，说明与 AppContainer 无关。

### 2.3 第二轮 8 变量聚焦

把该属性从 Job 中解耦后单独控制（原始：`evidence/child-policy-matrix.log`，连续 4 次运行结果一致）：

| 变量 | 结果 |
| --- | --- |
| baseline（AppContainer + Job + 任务桌面 + 句柄列表 + 最小环境，无该属性） | `0x0`，到达 `main` |
| child-policy-1-with-job | `0xC0000142` |
| child-policy-1-no-job | `0xC0000142` |
| child-policy-1-normal-token（无 AppContainer） | `0xC0000142` |
| child-policy-1-normal-token-job | `0xC0000142` |
| child-policy-1-cmd（子进程换成 cmd.exe） | `0xC0000142` |
| child-policy-2-with-job（值 2 = `PROCESS_CREATION_CHILD_PROCESS_OVERRIDE`） | `0x0`，到达 `main` |
| no-job | `0x0`，到达 `main` |

**充分且必要的变量只有一个**：属性值 1。因此该属性被彻底移除；`LaunchSpec::child_process_policy` 保留但文档化“本平台必须为 None”，只有诊断二进制可设置。旧的 loader 追踪停在 `KernelBase.dll` 只是因为它在崩溃前恰好是最后一个被加载的镜像，**没有**证据表明它是根因——README 与旧日志的这一说法已纠正。

### 2.4 真实引擎暴露的两个新问题（均已修）

1. **Job 内存上限 512 MiB 太小**：Godot 编辑器导入时出现 `alloc_static` 分配失败并以非零退出。默认预算改为 4 GiB，并由调用方通过 `TaskBudget` 明确承担。
2. **不能对任务启用引擎的自包含模式**：若引擎目录对任务是只读的，`_sc_` 会让编辑器尝试在引擎目录旁创建 `editor_data` 并失败（`Could not create editor data directory`）。现在不写 `_sc_`，编辑器数据落在被重定向到任务可写目录的 `APPDATA` 下。

## 3. 实现

`desktop/godot/sandbox` 重构为库 + 三个二进制：

- `src/lib.rs`：公共类型与 `Result`。
- `src/profile.rs`：每轮新建、绝不复用的 AppContainer profile，显式删除并记录 HRESULT。
- `src/desktop.rs`：在登录会话的非交互窗口站上创建**新建**任务桌面（`StationChoice::{SessionDefault, Current, Named}`），默认路径拒绝 `WinSta0`，从不修改既有站 ACL。
- `src/acl.rs`：只对本轮新建目录授权；读取（绝不改写）工作目录完整性标签，>Medium 直接拒绝。
- `src/launch.rs`：`start()` 返回可跨线程取消的 `RunningProcess`（含 `pid`、`TaskJob`、`wait`、`terminate`、`is_running`）；`launch()` 是“启动 + 限时等待 + 超时终止”的封装。Job 使用 kill-on-close、活动进程 1、进程内存预算。
- `src/task.rs`：**给 B 的产品接口**（见 `INTERFACE_A.md`）：`Task::prepare/run/cancel_flag/status/log_path/collect_artifacts/hand_off_artifacts/finish`；任务 id 白名单校验；引擎与模板按 SHA-256 固定后才复制；项目源复制时拒绝 reparse point。
- `src/main.rs`：固定验收门禁（不接受任何参数）。
- `src/probe.rs`：固定原生探针 `boundary-probe`，输出 `probe.*` 机读证据。
- `src/bin/sandbox-diag.rs`：`parent` / `matrix` / `cancel` / `repeat` 诊断。
- `fixtures/web-sample`：固定小工程，含**启用中的编辑器插件**与 **@tool 资源**，两者在编辑器阶段就尝试越界读写、外部连接与创建子进程。

自动验收全程不发送真实鼠标键盘、不请求 Pointer Lock、不激活或置前窗口；未运行 `tests/browser.mjs` 与 `tests/modules-browser.mjs`。

## 4. 实际验证与原始证据

原始日志已提交在 `desktop/godot/sandbox/evidence/`：

| 证据文件 | 内容 |
| --- | --- |
| `gate-run1.txt`、`gate-run2.txt` | 两次完整门禁（原生探针 + 真实 Godot 版本/导入/Web 导出 + 编辑器阶段边界 + 产物哈希） |
| `child-policy-matrix.log` | 8 变量差分矩阵（根因） |
| `cancellation.log` | 取消/超时无残留进程（底层启动原语） |
| `task-api.log` | **产品 API `Task` 端到端**：Version/Import/ExportWeb 三任务成功 + 9 个产物交接 + 取消路径 `Cancelled`/空 Job + profile 清理 |
| `parent-environment.log` | 父进程 token/站/桌面实际身份 |
| `build.log`、`tests.log` | 离线构建与 7 个单元测试 |
| `results.json` | 结构化结论、已验证/未验证清单 |

关键原始行（两次门禁一致）：

```
probe.allowed_dir_write=passed
probe.denied_read_error=Some(5)
probe.denied_write_error=Some(5)
probe.denied_interactive_station_error=Some(5)
probe.child_station_visible=false
probe.net_loopback_connect_error=None
probe.net_loopback_bind_error=None
probe.net_external_connect_error=Some(10013)
probe.child_spawn_error=Some(1816)
probe.native_boundary_probe=passed
godot_version_output="4.7.2.stable.official.ed1daf0bf\r\n"
godot_import_exit=0x0
godot_export_exit=0x0
artifact=index.html bytes=5447 sha256=29b2778a7f773aca4d1b753e7a46642882c608a8f2e950c0a632b95ac44e44ac
artifact=index.wasm bytes=39514754 sha256=fc74679e3b97f76878947fcd4fbe1268cbfa6188182a2e33bbc3f5dc9bfa57d0
editor_time_probe=
plugin_ran=true
plugin_file_read=denied
plugin_file_write=denied
plugin_sibling_write=denied
plugin_external_connect=denied(timeout)
plugin_spawn=denied(error=-1)
tool_init_ran=true
tool_init_file_read=denied
profile_cleanup_hresult=0x0
```

取消证据 `evidence/cancellation.log`：

```
cancel_timed_out=true
cancel_exit=0x5c
cancel_job_active_processes=Some(0)
cancel_pid_alive_after=false
cancel_no_leftover_process=passed
```

验收对照：

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 允许的任务目录确实可读写 | 通过 | `probe.allowed_dir_write=passed`，导出产物写出 |
| 合成的越界文件访问被拒 | 通过 | `denied_read/write_error=Some(5)`（同层哨兵目录从未授权） |
| 网络有正向控制与实际拒绝证据 | **部分通过** | 正向：`host_loopback_control=passed`；拒绝：非回环 `10013`；**回环仍允许**（见第 6 节） |
| 子进程受控 | 通过 | 原生探针 `1816`；编辑器插件 `OS.create_process` 失败并报 `Could not create child process` |
| 取消/超时后没有遗留任务进程 | 通过 | `cancel_job_active_processes=Some(0)`、`cancel_pid_alive_after=false` |
| Godot 导入导出实际成功 | 通过 | 导入 `0x0`、Web 导出 `0x0`、9 个产物由父进程独立哈希 |
| @tool / 插件阶段执行代码 | 通过 | `plugin_ran=true`、`tool_init_ran=true`，且同类拒绝仍成立 |
| 产品 API 可用（给 B） | 通过 | `evidence/task-api.log`：三任务 `Succeeded`、9 产物交接、取消任务 `Cancelled` 且 `job_active_processes=Some(0)` |

## 5. 产物交接

- 导出产物写在任务可写目录 `work/export/`，由父进程 `Task::hand_off_artifacts()` 复制到父侧 `artifacts/` 并**重新哈希校验**。
- **产物是不可信模型输出**：父进程只负责完整性与路径，不负责内容安全；下游必须按不可信输入处理。
- 日志写在父侧 `logs/task.log`（任务对日志目录无写权限），因此任务无法伪造自己的日志。

## 6. 未完成项与真实缺口（不得当作已通过）

1. **回环网络默认放行**：原生探针成功连接并绑定 `127.0.0.1`（`net_loopback_connect_error=None`、`net_loopback_bind_error=None`）。无能力的 AppContainer 只阻断非回环出口。普通用户无法添加 WFP 过滤或防火墙规则，因此本任务**不宣称**回环被拒绝；产品需要管理员预置策略或改用更强隔离（LPAC/容器）才能覆盖。当前语义：任务可以访问本机服务。
2. LPAC 未实现；UI/输入/剪贴板隔离未验证。
3. 未验证 reparse point / 句柄竞态攻击、CPU/磁盘/GPU 配额、磁盘耗尽。
4. 只用固定样本工程验证；**未**验证真实模型创作工程。
5. Web 产物只验证导出成功与哈希，**未**在浏览器中运行。
6. 观察到的偶发：矩阵首轮曾出现 1 次 `no-job` 变体 `CreateProcessW` 返回 `5`（1/8），之后 4 次矩阵与 4 次重复运行均未复现。已记录，未归因；产品侧应对创建失败做有记录的有限重试，而不是放宽边界。
7. 仅 Windows；crate 为 `#![cfg(windows)]`。

## 7. 需要其他任务/任务 I 配合的接口

1. **共享入口**：`desktop/godot/sandbox` 目前是独立 crate（自带 `[workspace]`），没有任何共享构建脚本引用它。若产品需要把 `craftmine-godot-sandbox-probe` 作为库依赖，需要负责 `desktop/` 构建入口的 Agent 增加 path 依赖；本任务**未**修改任何共享入口文件，具体补丁建议见 `INTERFACE_A.md` 第 5 节。
2. **文档同步**：`docs/GODOT_INTEGRATION_DECISION.md` 第 56–62 行仍写着“操作系统隔离：未通过 / 原因尚未定位”。该文件不属于本任务范围，请由负责该文件的 Agent 或任务 I 更新为：根因已定位（child-process policy 属性）、受管理边界已端到端验证、回环网络仍放行。
3. **任务 B** 需要消费的接口：启动、状态、日志、取消、退出、产物交接，签名与契约见 `INTERFACE_A.md`。
4. **产品策略**：回环网络放行需要管理员级策略（WFP/防火墙）或隔离升级决策，属于产品/架构决策，不在本任务权限内。
