# ADR：受管理 Godot 构建进程的执行边界（任务 A）

- 状态：接受（2026-09-09）
- 决策范围：`desktop/godot/sandbox`
- 关联：`docs/specs/godot-sandbox-execution-boundary-A.md`、`desktop/godot/sandbox/README.md`

## 背景

历史七次尝试都能创建 AppContainer 进程（`TokenIsAppContainer=1`），但子进程在 `main` 之前以 `0xC0000142` 退出，日志为空。旧结论把最后加载的 `KernelBase.dll` 当作疑点，但没有任何证据。产品因此长期停在 source-only：不能让模型自动构建、运行、导入或导出 Godot 工程。

## 决策 1：根因定位方式——单变量差分，而不是继续猜测

用 `sandbox-diag matrix` 对每个启动条件做单变量对照，同时记录退出码、子进程是否到达 `main`、以及子进程自身的 token/站/桌面报告。

结果：唯一充分且必要的变量是 `PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED`。

- 带该属性：`0xC0000142`（含 `cmd.exe`、无 AppContainer、无 Job 等所有组合）。
- 不带该属性：`0x0` 且到达 `main`（含 AppContainer + Job + 任务桌面 + 句柄列表 + 最小环境）。
- 值 2（`PROCESS_CREATION_CHILD_PROCESS_OVERRIDE`）：`0x0`。

**决策**：移除该属性；`LaunchSpec::child_process_policy` 保留字段但文档化为“本平台必须为 `None`”，仅诊断二进制可设置，便于将来 OS 修复后重新验证。

**后果**：子进程控制必须由 Job 承担（决策 2）。若未来 Windows 修复该属性，可以重新评估，但要重新跑矩阵。

## 决策 2：子进程控制改用 Job 活动进程上限

`JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1` + `KILL_ON_JOB_CLOSE`：任务进程本身占满名额，任何派生尝试失败，实测 `ERROR_NOT_ENOUGH_QUOTA`（1816），在原生探针和 Godot `OS.create_process` 两处都得到拒绝证据。

**后果**：语义从“子进程被显式限制”变为“任务 Job 只能有一个进程”。这仍满足“子进程受控”，但拒绝码是 1816 而不是 5/1260，验收断言必须接受该码并记录。

## 决策 3：crate 结构 = 库 + 固定门禁 + 诊断

- `lib`：`profile` / `desktop` / `acl` / `launch` / `task` / `report` / `loader`。
- `craftmine-godot-sandbox-probe`：固定验收门禁，不接受参数。
- `boundary-probe`：固定原生探针，输出机读证据。
- `sandbox-diag`：差分与取消诊断。

**理由**：验收必须可重复且不能接受任意命令；产品接口必须与验收工具分离，避免把“能跑固定探针”误当作“能跑任意工程”。

**后果**：产品若需把边界作为库依赖，需要在共享构建入口加 path 依赖（本任务未修改共享入口，见 `INTERFACE_A.md` 第 5 节）。

## 决策 4：预算必须诚实，默认 4 GiB

512 MiB 进程内存上限会让 Godot 编辑器在导入阶段出现 `alloc_static` 失败并以非零退出（不是清晰报错）。默认预算改为 4 GiB，由 `TaskBudget` 显式承担。

## 决策 5：不使用引擎自包含模式

`_sc_` 会让编辑器在只读引擎目录旁创建 `editor_data` 而失败。改为不写 `_sc_`，让编辑器数据落到被重定向到任务可写目录的 `APPDATA`。

## 决策 6：回环网络不宣称被阻断

实测无能力 AppContainer 允许 `127.0.0.1` 连接与绑定；非回环出站被拒（10013）。普通用户无法添加 WFP 过滤或防火墙规则。

**决策**：把“回环放行”作为显式已知缺口记录在 spec/README/报告，不通过放宽或伪造断言来“变绿”。产品需要管理员预置策略或更强隔离（LPAC/容器）时再单独决策。

## 决策 7：产物交接与日志可信度

- 日志写在任务不可写的父侧目录，任务无法伪造日志。
- 产物由任务写入 `work/export`，父进程复制到 `artifacts` 并重新哈希；内容仍视为不可信模型输出。

## 未决问题

1. 回环网络的最终策略（管理员 WFP/防火墙规则、LPAC 或容器）。
2. 是否把该 crate 提升为共享 workspace 成员（需要负责共享入口的 Agent 决策）。
3. 创建失败偶发一次 `ERROR_ACCESS_DENIED`（1/8，未复现）的根因与重试策略。
4. UI/输入隔离、reparse point/句柄竞态、CPU/磁盘配额。
