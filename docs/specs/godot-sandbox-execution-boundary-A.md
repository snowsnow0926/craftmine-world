# Spec A：受管理 Godot 构建进程的 Windows 执行边界

- 状态：已实现并在固定样本上验证（2026-09-09），**部分验收项未通过**（见第 6 节）
- 范围：`desktop/godot/sandbox`（库 + 固定验收门禁 + 诊断）
- 关联：`docs/adr/ADR-godot-sandbox-execution-boundary-A.md`、`docs/dispatch-reports/godot-parallel/A/REPORT_A.md`

## 1. 目标

在**产品普通用户**运行环境下，让模型/编辑器/导出阶段执行的 Godot 代码运行在一个可验证的 Windows 执行边界内：文件访问被限定在任务目录、交互桌面不可达、非回环网络被拒、不能创建子进程、资源有预算、取消后无残留。

## 2. 输入契约

1. 任务由 `TaskKind` 描述：`Version`、`Import`、`ExportWeb`，参数集固定，**不接受任意命令行**。
2. 任务 id 必须通过 `validate_task_id`（`[A-Za-z0-9._-]`，1..=96，不以 `.` 起止）。
3. 引擎与导出模板必须以 `PinnedInput`（源路径 + SHA-256 + 文件名）提供；哈希不符则拒绝。
4. 项目源以目录形式提供，复制进任务目录；含 reparse point 时拒绝。
5. 预算由调用方给出（超时、活动进程上限、进程内存）。Godot 编辑器需要 4 GiB 级内存预算。

## 3. 边界要求（每条都对应可测断言）

| 编号 | 要求 | 断言 |
| --- | --- | --- |
| B1 | 每轮新建 AppContainer profile，无能力，不复用，结束即删 | `profile_cleanup_hresult=0x0` |
| B2 | 任务桌面位于非交互窗口站，`WSF_VISIBLE=false`，默认路径拒绝 `WinSta0` | `probe.child_station_visible=false` |
| B3 | 不修改任何既有工作区/桌面/系统 ACL；只授权本轮新建目录 | `default_desktop_acl_modified=false` |
| B4 | 任务可写自己的 `work` | `probe.allowed_dir_write=passed` |
| B5 | 任务不可读/写任务目录之外的合成哨兵 | `denied_read_error=Some(5)`、`denied_write_error=Some(5)` |
| B6 | 任务不可访问交互站 | `denied_interactive_station_error=Some(5)` |
| B7 | 非回环出站被拒（策略拒绝而非路由超时） | `net_external_connect_error=Some(10013)` + 主机正向控制 |
| B8 | 任务不可创建子进程 | `child_spawn_error=Some(1816)` |
| B9 | 资源预算：活动进程 1、进程内存上限、单次等待上限 | Job 配置 + 超时终止 |
| B10 | 取消/超时后无残留进程 | `job_active_processes=Some(0)`、PID 不存在 |
| B11 | 真实引擎可启动、导入、导出 Web | 版本串、导入 `0x0`、导出 `0x0` + 产物哈希 |
| B12 | `@tool`、资源导入、编辑器插件阶段执行代码时边界同样成立 | 插件与 @tool 探针的拒绝行 |
| B13 | 只继承日志与 `NUL` 句柄；最小环境 | 句柄列表 + 最小环境构造 |
| B14 | 产物由父进程独立哈希，内容视为不可信 | `artifact=… sha256=…` |

## 4. 明确禁止

- **禁止设置** `PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY = 1`。实测：任何子进程都会在加载器初始化阶段以 `0xC0000142` 退出（带/不带 AppContainer、Job、桌面均如此）。子进程控制改用 B9/B8 的 Job 活动进程上限。
- 禁止以“关闭隔离”“放宽 ACL”“修改默认桌面”作为通过手段。
- 禁止用任意 I/O 错误当作隔离成功：拒绝断言必须匹配明确错误码。
- 禁止在自动验收中发送真实鼠标/键盘、请求 Pointer Lock、激活或置前窗口。

## 5. 运行形态

- `craftmine-godot-sandbox-probe`：固定验收门禁，不接受参数。
- `boundary-probe`：固定原生子探针，只输出 `probe.*` 机读行。
- `sandbox-diag`：`parent` / `matrix` / `cancel` / `repeat` 诊断模式。

## 6. 已知未满足/未验证

1. **B7 只覆盖非回环**：回环（`127.0.0.1`）连接与绑定**被允许**（实测 `None`）。无能力 AppContainer 默认只阻断非回环出口；普通用户无法配置 WFP/防火墙。此项未通过，需管理员策略或隔离升级。
2. LPAC、UI/输入/剪贴板隔离未验证。
3. reparse point / 句柄竞态、CPU/磁盘/GPU 配额、磁盘耗尽未验证。
4. 仅固定样本工程；真实模型创作工程未验证。
5. 导出产物未在浏览器中运行。
6. 矩阵首轮出现 1 次创建失败 `5`（1/8），未复现、未归因；产品侧应做有记录的有限重试，不得放宽边界。
