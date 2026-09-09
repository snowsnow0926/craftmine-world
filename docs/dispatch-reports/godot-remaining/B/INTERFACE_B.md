# INTERFACE_B：沙箱执行边界给产品执行器（C）的稳定接口

任务标识：`godot-remaining-B-20260910`
适用消费方：C 的产品执行器、M 的受管理 Git 调用、N 的导入/预览路径
契约来源：[BROKER_PROTOCOL_V1.md](../../../desktop/godot/sandbox/BROKER_PROTOCOL_V1.md)（v1）

## 1 二进制来源与哈希

| 项 | 值 |
| --- | --- |
| 源 | `desktop/godot/sandbox`（Rust crate `craftmine-godot-sandbox-probe`，`#![cfg(windows)]`） |
| 构建 | `cargo build --offline --manifest-path desktop/godot/sandbox/Cargo.toml` |
| 二进制 | `desktop/godot/sandbox/target/debug/godot-host-broker.exe` |
| 已验证 SHA-256 | `76932e6909665321fd061e2a8a8e3c6cd7527de03259b15f282018730b892258` |
| 引擎 | `Godot_v4.7.2-stable_win64.exe`，SHA-256 `ab1824f8…b22424`（broker 内编译期固定） |
| 模板 | `version.txt`、`web_nothreads_debug.zip`、`web_nothreads_release.zip`、`web_release.zip`，四个哈希均编译期固定 |

消费方**必须**在启动前独立核对 broker 的 SHA-256，并与响应里的 `brokerSha256` 比较。
响应中的哈希是自测值，不是授权。

## 2 调用方式

```text
godot-host-broker.exe run          # stdin 一行 JSON 请求，stdout 一行 JSON 响应
godot-host-broker.exe recover <绝对 tasksRoot> [--json-out <路径>]   # 崩溃恢复
```

- `run` 不接受任何其他参数；无 shell、无自由参数、无能力/环境/哈希覆盖。
- 请求只允许 `schemaVersion=1`、`requestId`、`taskId`、`operation`
  （`version`/`import`/`exportWeb`）、`projectRoot`、`tasksRoot`、`engineRoot`、
  `sourceBinding`、`inputHash`；未知字段直接拒绝。
- stdin 写入首帧后**保持打开**；EOF 或任何后续输入都触发取消，文档化取消帧为
  `{"cancel":true}`。响应写出后 broker 退出，此时可关闭 stdin。
- 传输层退出码**不是**结论：必须同时检查 `state` 与各项证据字段。

## 3 源码快照摘要算法（C 必须自行复算）

1. 递归遍历 `projectRoot`（拒绝 reparse point 与非普通文件）。
2. 每个文件记录 `{path, bytes, sha256}`：`path` 为相对 `projectRoot`、用 `/` 分隔；
   字段顺序固定为 `path,bytes,sha256`。
3. 按 `path` 升序排序。
4. `sourceSnapshotDigest` = 上述数组的**紧凑 UTF-8 JSON**（无空格）的 SHA-256。

broker 在物化后立即重算一次并比对；不一致直接失败。C 必须用自己从 Git 得到的
文件集合复算并与响应比对，不能把 `sourceBinding`/`inputHash` 当作测量结果。

## 4 日志与产物

- `logs`：`[{path,bytes,sha256}]`，相对 `logsRoot`，通常是 `preflight.json` 与
  `task.log`；每个日志上限 4 MiB，超出即判失败。
- `artifacts`：相对 `artifactsRoot`，**没有** `web/` 前缀；C 负责复制进自己的
  `web/` 目录并重新哈希。
- 引擎 stdout/stderr 与工程自写文件全部是**不可信诊断文本**，即使记录了哈希。
- 边界证据不在日志里：它来自 `processVerification`、`networkPreflight`、
  `resourceEnforcement`、`cleanup`、`recoveryJournal` 五个结构化对象。

## 5 清理与恢复语义

- 正常/取消/超时路径：`cleanup.verified=true` 表示 profile 删除 HRESULT ≥ 0 且
  `work` 目录已移除。
- 强杀路径：**没有**最终回包，也**没有** `cleanup`。C 必须调用
  `recover <tasksRoot>`，并只在报告里 `identityVerified=true` 且
  `journalRemoved=true` 时认为该任务已被回收。该命令在 `skippedCount>0` 或存在
  `unreadable` 条目时退出 1；对仍在运行的 broker 的任务会报
  `broker-still-running` 并保持原样，这不是错误。
- 恢复报告永远含 `finalReceiptObserved:false`，永远不含 `cleanup.verified`。
  不得把恢复成功当作"该次构建成功"。
- 任务完成后 `recoveryJournal.cleared=true`；若为 false，说明账本未退休
  （清理未验证或删除失败），后续恢复仍会尝试处理该任务。

## 6 资源与网络结论的边界

- `networkPreflight.verified=true` 表示：四项宿主 TCP/UDP 回环正向控制成功，
  受限任务六项 TCP/UDP 全部 `PermissionDenied`/10013，宿主未收到受限流量，
  且该任务 SID 没有回环豁免。
- Godot 自身的 socket 结果**不能**作为 OS 证据：固定引擎折叠为 `error=1`，
  只能记为 `unknown`。
- `resourceEnforcement` 是**采样**预算（默认 1 GiB work / 4 MiB log / 200 ms），
  `hardFilesystemQuota=false`。需要硬配额时由卷级或容器级机制另行提供。
- 沙箱成功**不等于**编译成功：GDScript/场景错误仍由 C 的编译门判定，
  退出码 0 也不是编译通过证明。

## 7 集成顺序建议

1. C 先按第 1 节核对二进制哈希，再按第 2 节实现私有管道调用。
2. C 用第 3 节算法复算快照摘要；不一致时拒绝该响应。
3. C 解析五个结构化对象；缺任一必需字段按失败处理，不要回退到日志文本。
4. C 在检测到 broker 非正常结束时调用 `recover`，并把恢复报告与任务表对账。
5. 主任务接线 `electron/main/index.ts` 与全局依赖锁；B 不修改共享入口。
