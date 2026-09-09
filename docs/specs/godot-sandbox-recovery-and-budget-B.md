# 规格：沙箱任务崩溃恢复与运行期资源预算（任务 B）

状态：已实现并在固定二进制上验证（2026-09-10）
范围：`desktop/godot/sandbox/**`
关联：[执行边界规格 A](godot-sandbox-execution-boundary-A.md)、
[协议](../../desktop/godot/sandbox/BROKER_PROTOCOL_V1.md)、
[ADR-B](../adr/ADR-godot-sandbox-recovery-ledger-B.md)

本规格只描述 A 规格未覆盖、由本轮补齐的两项行为：**broker 被强杀后的持久恢复**与
**运行期磁盘/输出预算**。A 规格的 B1–B14 继续有效，本文不修改、不放宽任何一条。

## 1 术语

- **任务根**：`tasksRoot/<taskId>`，由 `TaskLayout::create` 独占创建。
- **授权目录**：只包含任务根的 `bin`（读执行）与 `work`（读写执行删除）。
- **父进程侧位置**：任务根之外的 `.recovery-journal/`、以及任务根内的
  `task-identity.json`。两者都不在授权目录内。
- **最终回包**：broker 在 stdout 写出的唯一一行完整执行响应。

## 2 恢复账本（B-R）

| 编号 | 要求 | 可执行断言 |
| --- | --- | --- |
| B-R1 | 任何受限进程启动**之前**，必须已落盘一条独占创建的账本记录，并 flush。 | 强杀后账本文件存在；同一 taskId 二次写入被拒绝 |
| B-R2 | 账本记录必须包含 tasksRoot、任务根、profile 名与创建时测得 SID、身份 nonce，以及写入它的 broker 的 PID 与创建时间。 | 账本 JSON 字段完整且 `deny_unknown_fields` |
| B-R3 | 任务根必须有不被授权目录覆盖的身份标记，内容含 taskId 与同一 nonce。 | 标记文件位于任务根，非 bin/work 内 |
| B-R4 | 只有该任务的全部回收动作成功后才可删除账本记录；清理失败时必须保留以便重试。 | 正常回包含 `recoveryJournal.cleared=true`；`cleanup.verified=false` 时 `cleared=false` |
| B-R5 | 恢复不得触碰 broker 仍在运行的任务。 | 运行中恢复报 `broker-still-running`，任务根与子进程保持 |
| B-R6 | 恢复只允许回收 canonical 化后等于命令行传入 tasksRoot 的记录。 | 跨 tasksRoot 记录报 `tasks-root-mismatch` 且不删除 |
| B-R7 | 恢复只允许回收路径恰为 `tasksRoot/<taskId>` 且无 reparse 组件的任务根。 | 置换路径报 `task-root-mismatch` 且保留原目录 |
| B-R8 | 身份标记的 taskId 与 nonce 必须与账本一致，否则不删除任何内容。 | 标记缺失/不匹配报 `identity-marker-*`，目录保留 |
| B-R9 | 任务根已不存在时不得声称身份已验证，也不得仅凭名字删除 profile。 | 报 `task-root-already-absent; identity-unverifiable` 并保留账本 |
| B-R10 | 只有从记录名重新推导出的 SID 等于创建时记录的 SID，才可删除 profile。 | 不匹配报 `profile-sid-mismatch` |
| B-R11 | 只有 PID **与**创建 FILETIME 同时匹配父进程写入的预恢复 sidecar，且映像位于本任务 `bin`，才可终止进程。 | PID 复用报 `pid-reused` 且不终止；已退出报 `gone` |
| B-R12 | 未通过任何检查的条目只报告、不删除；恢复报告必须含 `finalReceiptObserved:false` 且不得含 `cleanup` 判定。 | 报告字段恒为 false；`skipped` 列出原因 |
| B-R13 | 截断/不可解析的账本文件必须报告为 `unreadable`，不得中止整轮恢复。 | 单元测试 `recovery_reports_a_truncated_entry_instead_of_aborting` |
| B-R14 | 目录删除对刚终止的子进程做有界重试；有任何未回收项时进程退出码非 0。 | 报告中出现 `task-root-removed-after-N-retries`；`skippedCount>0` 时退出 1 |

## 3 运行期资源预算（B-Q）

| 编号 | 要求 | 可执行断言 |
| --- | --- | --- |
| B-Q1 | 父进程必须在任务运行期间周期性采样任务 `work` 目录字节数与继承日志大小。 | `resourceEnforcement.samples > 0` |
| B-Q2 | 超过上限时必须终止整个任务 Job，任务终态为 failed，并记录原因。 | `enforced=true`、`reason` 含实测值、`job_active_processes=0` |
| B-Q3 | 采样必须容忍运行中文件消失，不得因瞬时 NotFound 使任务失败。 | 对抗/膨胀用例中任务不会以 `os error 2` 失败 |
| B-Q4 | 必须如实标注范围：这是外部采样预算，不是文件系统配额。 | `hardFilesystemQuota=false`，`scope` 明示 |
| B-Q5 | 越界幅度由采样间隔决定，必须实测记录而不是声称固定字节上限。 | 实测 1 074 226 570 / 1 073 741 824（474 KiB，50 ms 间隔，86 次采样） |
| B-Q6 | 工程物化必须在任何进程启动前限额：4096 文件 / 8192 目录 / 单文件 256 MiB / 合计 512 MiB。 | `copy_tree_bounded` 单元测试四种越界均拒绝 |
| B-Q7 | 命名 NTFS 数据流必须计入预算，不能只统计 `metadata.len()`。 | 单元测试 `directory_bytes_counts_alternate_data_streams` |
| B-Q8 | 进程内存与活动进程上限继续由 Job 强制（4 GiB / 1）。 | 既有 B9 断言不变 |

## 4 明确不覆盖

- 真正的磁盘配额、CPU/GPU 速率限制。Windows 没有可对 AppContainer 单目录施加、
  且无需改动全机策略的硬配额；本项目禁止修改全机策略，因此保留为显式缺口。
- Godot 自身 socket 错误的语义：固定引擎把 Winsock 失败折叠为 `error=1`，
  脚本侧只能记为 `unknown`。OS 级证据来自原生预检（六项 10013 拒绝）。
- 真实模型工程、浏览器内运行导出产物。

## 5 验收映射

| 断言 | 证据 |
| --- | --- |
| B-R1..B-R4 | `b-terminate-*` 强杀运行：账本存在 → 无回包 → 恢复后 `journalRemoved=true`；正常回包 `cleared=true` |
| B-R5 | `b-live-recover-*`：运行中恢复报 `broker-still-running`，任务根与子进程保持，任务随后正常取消 |
| B-R6..B-R8 | `src/recovery.rs` 单元测试（跨根、置换、标记不符、存活 broker） |
| B-R9 | 单元测试 `recovery_keeps_an_entry_when_the_task_root_is_already_absent` |
| B-R10, B-R11 | 强杀运行报告 `childProcessState=gone`，PID/creationTime 与 sidecar 一致 |
| B-R12, B-R13 | 强杀报告 `finalReceiptObserved:false` 且不含 `cleanup`；`recovery_reports_a_truncated_entry_instead_of_aborting` |
| B-R14 | 强杀报告 `task-root-removed-after-1-retries`；`recover` 在 `skippedCount>0` 时退出 1 |
| B-Q1..B-Q5 | `b-inflation-*`：86 次采样，1 074 226 570 字节触发，退出码 91 |
| B-Q6 | `task::tests::materialization_budget_rejects_an_oversized_source_tree` |
| B-Q7 | `task::tests::directory_bytes_counts_alternate_data_streams` |
| B-Q3 | `task::tests::directory_bytes_is_capped_and_ignores_missing_roots` |
| 全部 | `docs/dispatch-reports/godot-remaining/B/evidence/`（最终索引见该目录 README） |
