# B 报告：Windows 隔离执行、取消与资源回收

任务标识：`godot-remaining-B-20260910`
基线：`e462147`（本地 master），分支 `codex/godot-remaining-b-20260910`，
工作树 `D:/Craftmine World/test-results/godot-remaining-b`
范围：`desktop/godot/sandbox/**`、`tests/godot-remaining/B/**`、本报告目录、独立 spec/ADR
交付提交：`c55ded1`（实现）、`9ca41b7`（夹具与证据）；文档提交见文末

## 0 交接来源与基线

只读来源 `test-results/g6-sandbox`（分支 `codex/godot-cycle06-sandbox`，HEAD `3f52ce6`）
的未提交内容已按文件逐个接续，未整树覆盖、未改动源树：

| 文件 | 来源 SHA-256（前 16 位） |
| --- | --- |
| `Cargo.toml` / `Cargo.lock` | `ac76e52023b7c206` / `adb4c627108b463d` |
| `README.md` / `BROKER_PROTOCOL_V1.md` | `5dfa4d1711de25a8` / `50d483b1a04d5090` |
| `src/{desktop,launch,lib,task}.rs` | `4bada6536f1720cd` / `fb4bf13a41effe33` / `745a0a3bc5d23003` / `582f0bafdec5670a` |
| `src/{broker,preflight,verification}.rs` | `150379c6b1294241` / `eee81cc7e80e3337` / `e4caa7f7841080e6` |
| `src/bin/godot-host-broker.rs` | `9ca08982141874b1` |

源树 `target/`、`out/`、`evidence/` 未带入。基线校验：接续后 `cargo build --offline`
与 `cargo test --offline` 通过（16 + 2 项），与交接报告一致。

## 1 逐条对照专责任务

### 1.1 保留固定私有协议，核验真实 Godot（**完成**）

- 请求结构 `deny_unknown_fields`，只有 `version`/`import`/`exportWeb`；无 shell、
  无自由参数、无能力/环境/哈希覆盖、无 `trusted` 标志。单元测试
  `request_cannot_claim_trust_or_supply_command_arguments` 覆盖。
- 每个任务先用同一 broker 副本跑原生预检，再启动 Godot；两者都以 suspended 创建，
  恢复前由宿主读取：包 SID、能力集合（恰好一个已启用的 `registryRead`）、完整性
  级别 Low、映像路径、PID 与创建 FILETIME、精确 Job 成员关系与限制标志。
- 不支持的能力查询 87 保留为 `lpacQueryValue:null,lpacQueryError:87`。
- 实测：`version`/`import`/`exportWeb` 全部 `processVerification.verified=true`、
  `verifiedBeforeResume=true`、`resumePreviousCount=1`。
- **不接受游戏打印的"已隔离"**：响应中的边界结论只来自结构化对象，日志是
  不可信诊断文本。

### 1.2 可信原生网络预检（**完成**）

- 每任务四项宿主 TCP/UDP 回环正向控制必须成功（`hostReceivedCounts` 记录增量），
  受限进程六项检查必须全部 `PermissionDenied`/10013，且任务 SID 无回环豁免。
- 超时、拒绝连接、缺失错误码、Winsock 初始化失败都不能通过：
  `observation.winsockStartup != 0` 或任一检查非 10013 即判失败。
- 未知查询值保留；`error=1` 的 Godot 结果不参与结论。
- 实测：8 个用例中每个执行用例的 `networkPreflight.verified=true`，
  含回环 TCP/UDP 的显式拒绝。

### 1.3 最终固定二进制上的 version/import/exportWeb/EOF + 取消/强杀/恶意插件（**完成**）

最终二进制 SHA-256
`76932e6909665321fd061e2a8a8e3c6cd7527de03259b15f282018730b892258`，单次运行九例全过
（`evidence/index-b-20260909170609698-173804.json`）：

| 用例 | 结果 |
| --- | --- |
| version | 退出 0，双证据 verified，cleanup verified，账本退休 |
| import | 退出 0，双证据 verified，cleanup verified |
| exportWeb | 退出 0，9 个产物交接，cleanup verified |
| EOF | `cancelled`（预检前），无进程回执，cleanup verified |
| cancel 运行中 | `cancelled` 退出码 `0x5d`，进程回执 verified、resume=1，子进程 PID 消失 |
| terminate 强杀 | 无最终回包；恢复验证身份、删除 profile（HRESULT 0）、回收任务根 |
| live-recover 运行中恢复 | 恢复报 `broker-still-running`，任务根与子进程保持，随后正常取消 |
| adversarial `@tool`/插件 | 哨兵读写与同级逃逸 denied、spawn `denied(error=-1)`、外部与回环 `unknown(error=1)`、宿主回环监听收到 0 连接 |
| inflation | 采样预算触发终止（1 074 226 570 / 1 073 741 824 字节，86 次采样） |

恶意用例只访问该任务新建的合成哨兵；不读取任何用户世界、凭据或真实工程。

### 1.4 杀后持久恢复账本（**完成**）

新增 `src/recovery.rs` + `godot-host-broker.exe recover <tasksRoot>`：

- 账本记录在任何受限进程启动前独占创建并 flush；任务根写入随机 nonce 身份标记，
  两者都不在授权目录内。
- 恢复只在以下全部成立时回收：tasksRoot canonical 相等、任务根恰为
  `tasksRoot/<taskId>` 且无 reparse、身份标记 taskId+nonce 相符、从记录名重推的
  profile SID 与创建时记录相符、存活进程 PID+创建 FILETIME 与父进程 sidecar 相符
  且映像在本任务 `bin`。
- PID 复用报 `pid-reused` 且不终止；未通过检查的条目只报告不删除。
- 报告恒含 `finalReceiptObserved:false`，**没有** `cleanup.verified`：
  没有最后回包就不声称 cleanup 成功。
- 实测强杀：`identityVerified=true`、`profileDeleted=true`、`taskRootRemoved=true`、
  `journalRemoved=true`、`childProcessState=gone`、`reclaimed=[work,bin,logs,artifacts]`。

### 1.5 运行期磁盘/资源控制（**部分完成，缺口显式**）

- 实现：运行中每 50 ms 采样任务 `work` 字节数与继承日志大小，超过 1 GiB / 4 MiB
  即终止整个 Job，任务 `failed`，响应记录实测最大值、采样次数与原因。命名 NTFS
  数据流用 `FindFirstStreamW` 计入，目录数同样限额。
- 工程物化另设 4096 文件 / 8192 目录 / 单文件 256 MiB / 合计 512 MiB 上限，在任何
  进程启动前生效。
- 诚实标注：`hardFilesystemQuota:false`，`scope` 说明是外部采样预算。
- **保留的缺口**：不是真正的文件系统配额；越界幅度由采样间隔决定，实测 474 KiB
  （50 ms 间隔），不承诺固定字节上限。CPU/GPU 速率限制未实现。Windows 没有可对
  AppContainer 单目录施加、且无需改动全机策略的硬配额，本项目禁止修改全机策略，
  因此不伪造硬限制。下一步入口：需要硬配额时在卷级（NTFS 磁盘配额）或容器级
  （独立卷 + 配额）实现，并把它作为新的 ADR 决策。

### 1.6 向 C 提供稳定接口（**完成**）

`INTERFACE_B.md` 给出：二进制来源与已验 SHA-256、严格协议调用方式、
源码快照摘要算法（排序记录 + 紧凑 UTF-8 JSON 的 SHA-256）、日志/产物语义、
清理与恢复语义、以及"沙箱成功 ≠ 编译成功"的边界。接口本身未修改协议版本号，
新增字段向后兼容（`resourceEnforcement`、`recoveryJournal`）。

## 2 验收覆盖（按派单要求）

| 要求 | 覆盖方式 |
| --- | --- |
| 导入插件执行阶段 | adversarial 用例：插件与 `@tool` 均在 `--import` 中运行并受约束 |
| 越权访问 | 合成哨兵读写、同级目录逃逸均 denied |
| 网络 | 每任务原生预检六项 10013 + 四项宿主正向控制；恶意用例宿主回环监听 0 连接 |
| 子进程 | `plugin_spawn=denied(error=-1)`；Job 活动进程上限 1 |
| 输出膨胀 | inflation 用例触发采样预算并终止 |
| 取消 | EOF 与运行中 `{"cancel":true}` 两例，子进程 PID 消失 |
| 恢复不误伤 | `live-recover`：运行中恢复被拒绝，任务与子进程保持 |
| 宿主崩溃恢复 | terminate 用例：强杀 broker → `recover` 回收并可核验 |
| 失败原文 | `evidence/` 保留全部中间失败（含全部已修复缺陷） |
| 未放宽 | 未修改任何冻结断言、未改全机防火墙/审计/配额、未扩大普通工程权限 |

## 3 过程中发现并修复的真实缺陷

前四项由实现与首轮验收暴露，其余由提交前的独立代码评审（`code-reviewer`）发现：

1. **恢复对已退出子进程误报 os error 5**：先查映像路径再判退出，导致
   `QueryFullProcessImageNameW` 在僵尸进程上失败并中断整轮恢复。改为先读退出码，
   已退出即 `gone`。
2. **HRESULT 被当作 BOOL**：`DeriveAppContainerSidFromAppContainerName` 返回 0 表示
   成功，却走了 `win()` 的失败分支，profile 未被删除。改为按 HRESULT 语义判断。
3. **采样在文件消失时失败任务**：目录遍历把瞬时 `NotFound` 当致命错误，
   使正常导入以 `os error 2` 失败。改为跳过消失条目与 reparse 点。
4. **物化无上限**（交接遗留）：`copy_tree` 原本无文件数/字节上限，可先写满卷再启动
   任务；已加限额与单元测试。
5. **恢复会杀掉正在运行的任务**：账本在任务开始时写入且没有存活标记，运行中执行
   `recover` 会终止子进程并删除任务根。账本现记录写入它的 broker 的 PID 与创建
   时间，恢复对存活 broker 直接报 `broker-still-running` 并跳过；新增
   `live-recover` 用例覆盖。
6. **存活判定用"能否打开进程"**：被强杀但尚未回收的进程仍可打开且保持创建时间，
   导致强杀任务被误判为"仍在运行"而永不回收。存活判定现在同时要求退出码仍为
   `STILL_ACTIVE`。
7. **账本清理与任务清理脱钩**：`Journal::clear` 用 `path.exists()` 判断，元数据读取
   失败时静默返回成功；且 `task.finish()` 失败后仍会删除账本，使泄漏的 profile
   再也无法恢复。现在只有在全部回收动作成功后才删除账本，且 `cleared` 反映真实
   删除结果。
8. **单个损坏账本中止整轮恢复**：被强杀在写入中途的截断文件会让每次 `recover` 直接
   失败。现在报告为 `unreadable` 并继续处理其余条目。
9. **账本存在前的物化失败无归属**：`Task::prepare` 在账本写入前失败会留下任务根。
   现在 `TaskRootGuard` 在失败时移除刚创建的任务根，保证"没有账本就没有任务根"。
10. **命名数据流可绕过预算**：`metadata.len()` 只统计未命名流。现在用
    `FindFirstStreamW` 计入命名流，并限额目录数（8192）。
11. **越界幅度被过度声称**：原文档声称"上限 + 单次写入块"，实测取决于采样间隔。
    采样间隔改为 50 ms，实测 474 KiB，并在 spec/协议/README 如实标注为
    "由采样间隔决定"。任务根已不存在时也不再声称身份已验证（保留账本与 profile）。

以上均保留首次失败原文；`evidence/README.md` 列出对应运行目录。

## 4 未完成项与下一步入口

| 未完成 | 现状 | 下一步入口 |
| --- | --- | --- |
| 真正的磁盘/CPU 配额 | 采样预算，非硬配额 | 卷级或容器级配额 + 新 ADR；`resourceEnforcement` 字段可直接扩展 |
| 真实模型工程 | 仅固定合成夹具 | C 接线后由真实任务驱动，B 提供 `projectRoot` 契约 |
| 浏览器内运行导出产物 | 只导出未运行 | 属于 C 的候选 Web 执行门 |
| 恢复触发时机 | 只有手工 `recover` | 属于 C 的执行器：崩溃检测/启动扫描/任务表对账 |
| UI/输入/剪贴板隔离 | 未验证 | 独立专项 |

## 5 验证命令（可复现）

```powershell
# 构建与单元测试（32 项：30 library + 2 native）
cargo build --offline --manifest-path desktop/godot/sandbox/Cargo.toml
cargo test  --offline --manifest-path desktop/godot/sandbox/Cargo.toml

# 全部九个真实用例（headless，无真实输入，独立数据目录）
node tests/godot-remaining/B/run_broker_cases.mjs

# 单个用例
node tests/godot-remaining/B/run_broker_cases.mjs --cases cancel,terminate

# 手工恢复
desktop/godot/sandbox/target/debug/godot-host-broker.exe recover <tasksRoot>
```

引擎来源：`D:/Craftmine World/desktop/build/godot/4.7.2-stable`（编辑器与四个模板
在每次运行前重新核对哈希）。

## 6 集成顺序

1. `c55ded1` 先合：沙箱实现自包含，不触碰共享入口与全局锁文件。
2. `9ca41b7` 次合：夹具与证据，只新增 `tests/godot-remaining/B/` 与本报告目录。
3. 文档提交（spec/ADR/接口/本报告）最后合，供主任务统一编号与汇入总表。
4. C 按 `INTERFACE_B.md` 接线；M、N 按 `M_AND_N_PROCESS_BOUNDARY_B.md` 约束。
5. 主任务负责 `electron/main/index.ts`、`plugins/craftmine-world/view.mjs`、
   全局依赖锁与总 E2E 文档；B 不修改这些文件。
