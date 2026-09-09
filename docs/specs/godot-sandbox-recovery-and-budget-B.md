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
| B-R2 | 账本记录必须包含 tasksRoot、任务根、profile 名与创建时测得 SID、身份 nonce。 | 账本 JSON 字段完整且 `deny_unknown_fields` |
| B-R3 | 任务根必须有不被授权目录覆盖的身份标记，内容含 taskId 与同一 nonce。 | 标记文件位于任务根，非 bin/work 内 |
| B-R4 | 只有 broker 产出最终回包后才可删除账本记录。 | 正常回包含 `recoveryJournal.cleared=true`；强杀后仍存在 |
| B-R5 | 恢复只允许回收 canonical 化后等于命令行传入 tasksRoot 的记录。 | 跨 tasksRoot 记录报 `tasks-root-mismatch` 且不删除 |
| B-R6 | 恢复只允许回收路径恰为 `tasksRoot/<taskId>` 且无 reparse 组件的任务根。 | 置换路径报 `task-root-mismatch` 且保留原目录 |
| B-R7 | 身份标记的 taskId 与 nonce 必须与账本一致，否则不删除任何内容。 | 标记缺失/不匹配报 `identity-marker-*`，目录保留 |
| B-R8 | 只有从记录名重新推导出的 SID 等于创建时记录的 SID，才可删除 profile。 | 不匹配报 `profile-sid-mismatch` |
| B-R9 | 只有 PID **与**创建 FILETIME 同时匹配父进程写入的预恢复 sidecar，且映像位于本任务 `bin`，才可终止进程。 | PID 复用报 `pid-reused` 且不终止；已退出报 `gone` |
| B-R10 | 未通过任何检查的条目只报告、不删除；恢复报告必须含 `finalReceiptObserved:false`。 | 报告字段恒为 false；`skipped` 列出原因 |
| B-R11 | 恢复**不得**声称 `cleanup.verified`。 | 恢复报告没有该字段；只有执行响应有 |
| B-R12 | 目录删除对刚终止的子进程做有界重试。 | 报告中出现 `task-root-removed-after-N-retries` 或成功 |

## 3 运行期资源预算（B-Q）

| 编号 | 要求 | 可执行断言 |
| --- | --- | --- |
| B-Q1 | 父进程必须在任务运行期间周期性采样任务 `work` 目录字节数与继承日志大小。 | `resourceEnforcement.samples > 0` |
| B-Q2 | 超过上限时必须终止整个任务 Job，任务终态为 failed，并记录原因。 | `enforced=true`、`reason` 含实测值、`job_active_processes=0` |
| B-Q3 | 采样必须容忍运行中文件消失，不得因瞬时 NotFound 使任务失败。 | 对抗/膨胀用例中任务不会以 `os error 2` 失败 |
| B-Q4 | 必须如实标注范围：这是外部采样预算，不是文件系统配额。 | `hardFilesystemQuota=false`，`scope` 明示 |
| B-Q5 | 越界幅度必须有界：不超过上限 + 单次写入块量级。 | 实测 1 075 151 147 / 1 073 741 824（约 1.4 MiB） |
| B-Q6 | 工程物化必须在任何进程启动前限额：4096 文件 / 单文件 256 MiB / 合计 512 MiB。 | `copy_tree_bounded` 单元测试三种越界均拒绝 |
| B-Q7 | 进程内存与活动进程上限继续由 Job 强制（4 GiB / 1）。 | 既有 B9 断言不变 |

## 4 明确不覆盖

- 真正的磁盘配额、CPU/GPU 速率限制。Windows 没有可对 AppContainer 单目录施加、
  且无需改动全机策略的硬配额；本项目禁止修改全机策略，因此保留为显式缺口。
- Godot 自身 socket 错误的语义：固定引擎把 Winsock 失败折叠为 `error=1`，
  脚本侧只能记为 `unknown`。OS 级证据来自原生预检（六项 10013 拒绝）。
- 真实模型工程、浏览器内运行导出产物。

## 5 验收映射

| 断言 | 证据 |
| --- | --- |
| B-R1..B-R4 | `b-terminate-*` 强杀运行：账本存在 → 无回包 → 恢复后 `journalRemoved=true` |
| B-R5..B-R8 | `src/recovery.rs` 单元测试 4 项（跨根、置换、标记不符、SID 推导） |
| B-R9 | 强杀运行报告 `childProcessState=gone`，PID/creationTime 与 sidecar 一致 |
| B-R10, B-R11 | 恢复报告 `finalReceiptObserved:false`、无 `cleanup` 字段 |
| B-R12 | 强杀运行报告 `task-root-removed-after-1-retries` |
| B-Q1..B-Q5 | `b-inflation-*`：22 次采样，1 075 151 147 字节触发，退出码 0x5b |
| B-Q6 | `task::tests::materialization_budget_rejects_an_oversized_source_tree` |
| B-Q3 | `task::tests::directory_bytes_is_capped_and_ignores_missing_roots` |
| 全部 | `docs/dispatch-reports/godot-remaining/B/evidence/` |
