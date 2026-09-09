# ADR-B：崩溃恢复账本与可证明的运行期预算

状态：接受（2026-09-10）
范围：`desktop/godot/sandbox/**`
关联：[规格 B](../specs/godot-sandbox-recovery-and-budget-B.md)、
[协议 v1](../../desktop/godot/sandbox/BROKER_PROTOCOL_V1.md)、
[ADR A](ADR-godot-sandbox-execution-boundary-A.md)

## 背景

ADR A 决定用创建期 Job（`KILL_ON_JOB_CLOSE`）代替不兼容的
`PROCESS_CREATION_CHILD_PROCESS_RESTRICTED` 属性。该决定能保证子进程随 Job 消失，
但**不保证**清理：broker 被强杀时语言级析构不执行，AppContainer profile 与
任务可写目录会残留。A 的开放问题 3 只记录了"重试策略"，没有所有权证明。

同时 A 的"未验证"清单第 3 项承认磁盘配额缺失，且当时没有任何运行期磁盘限制：
产物/日志上限只在快照与交接阶段生效，超时与进程内存上限并不约束磁盘。

## 决策 1：恢复必须由持久账本 + 可重放的所有权证明驱动

在启动任何受限进程之前，broker 落盘一条父进程侧账本记录（`.recovery-journal/`），
并在任务根写入带随机 nonce 的身份标记。两者都不在授权给任务 SID 的目录内。

恢复入口是 broker 自带的 `recover <tasksRoot>`，它只做一件事：把一条记录与
可重新测得的证据对齐。任一项不成立就只报告、不删除。证据链是：

1. 记录的 `tasksRoot` canonical 化后等于命令行传入值；
2. 任务根恰为 `tasksRoot/<taskId>`，无 reparse 组件，canonical 化后一致；
3. 身份标记的 taskId 与 nonce 与记录一致；
4. profile SID 由记录名重新推导并与创建时记录的 SID 相等；
5. 若进程仍存活，PID **与**创建 FILETIME 同时匹配父进程写入的预恢复 sidecar，
   且映像位于本任务 `bin`。

**后果**：

- PID 复用不会误杀：创建时间不同即报 `pid-reused` 并跳过。
- 路径置换、跨任务、跨 tasksRoot 的目录不会被删除。
- 已退出的子进程（Job 关闭后的常态）走 `GetExitCodeProcess` 判定为 `gone`，
  不再尝试查询映像路径——早期实现正是在这里对已退出进程误报 os error 5。
- 恢复报告恒含 `finalReceiptObserved:false`，且**没有** `cleanup.verified` 字段。
  没有最终回包就永远不能声称清理成功。
- 账本只在最终回包之后删除；`recoveryJournal.cleared` 是唯一的"已退休"信号。

**被否决的替代方案**：

- 按 PID 或映像名枚举进程：会触碰非本任务的进程，且 PID 复用无法区分。
- 只按目录名回收：`tasksRoot` 可被替换，无法证明归属。
- 让恢复复用 broker 的正常 `finish()`：那需要 AppContainer profile 句柄，而强杀
  后它已随进程消失；且会掩盖"没有最终回包"这一事实。

## 决策 2：运行期预算用外部采样，并如实标注它不是文件系统配额

父进程在任务运行期间每 200 ms 采样任务 `work` 目录字节数与继承日志大小，
超过 1 GiB / 4 MiB 即终止整个 Job，并把实测最大值、采样次数和原因写入响应。

**后果**：

- `resourceEnforcement.hardFilesystemQuota` 恒为 `false`，`scope` 明示
  "sampled-task-work-directory-and-log-size; parent terminates the job on breach"。
- 越界幅度有界但不为零：固定膨胀用例实测 1 075 151 147 字节对
  1 073 741 824 上限，约 1.4 MiB。
- 采样必须容忍文件消失：Godot 编辑器持续创建/删除文件，瞬时 `NotFound`
  绝不能变成任务失败（这是实现期被真实用例抓到的缺陷）。
- 工程物化在任何进程启动前另设 4096 文件 / 256 MiB 单文件 / 512 MiB 合计上限，
  堵住"任务还没启动就已写满卷"的路径。

**被否决的替代方案**：

- 目录级硬配额：Windows 没有可对 AppContainer 单目录施加、且无需改动全机策略的
  机制；项目禁止修改全机防火墙/审计/配额策略来换取通过。
- 只靠 Job 内存上限：不约束磁盘与日志输出膨胀。
- 把采样预算写成"磁盘配额"：会伪造硬限制，禁止。

## 决策 3：Godot 侧的 socket 结果保持 `unknown`

固定引擎把 Winsock 失败折叠为通用 `error=1`，脚本只能记 `unknown`。OS 级证据
继续由每任务的原生预检提供（六项 TCP/UDP 显式 10013 + 宿主正向控制）。
本决策不把 `error=1` 改写成拒绝，也不据此关闭产品执行门。

## 开放问题

1. 真正的磁盘/CPU 配额仍需独立机制（卷级或容器级），不在本 crate 内。
2. 恢复依赖预恢复 sidecar 存在；若 broker 在 Godot 启动**之前**被强杀，
   sidecar 不存在，恢复只回收目录与 profile，进程字段记为 `not-recorded`。
   这在契约中是允许的结果，但消费方不得据此推断进程状态。
3. 恢复是宿主主动触发的；尚未决定产品层何时、以什么节奏调用（崩溃检测、
   启动时扫描或任务表对账），这属于 C 的执行器范围。
