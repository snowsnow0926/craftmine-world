# 任务 B 接口说明：受管理的 Godot 构建 / 检查 / 候选 / 应用

状态：已发布（供 C、E、F、G 对接）。本文件是契约，实施以本文件与代码提交为准。
基线：`46739d2`。分支 `codex/godot-parallel-b-20260909`。工作树 `D:/Craftmine World-worktrees/godot-parallel-b-20260909`。

## 0 边界与复用

- 复用现有 `tasks.sqlite`、`craftmine_worlds`、`craftmine_tasks`、`craftmine_workspaces`、世界租约、回执与启动恢复。**不新增第二套世界数据库，不新增 Agent 循环。**
- Rust 核心**从不自己执行 Godot**。导入 / 构建 / 检查由 A 的隔离执行器进程完成；执行器必须先在核心注册（`godotExecutor.register`）。未注册合格执行器时，`godotBuild.start` 创建 `blocked` 作业并返回 `executionAvailable:false` / `blockedReason:"GODOT_EXECUTION_UNAVAILABLE"`，`godotJob.claim` 一律拒绝。不存在未隔离后门。
- 源码（`godotProject.*`）仍是 source-only；构建作业**不会**改写源码版本。构建产物与导入缓存不混入源码清单。
- 二进制素材走独立资产库，不进入旧 2 MB 草稿 JSON。

## 1 身份

| 字段 | 产生方 | 说明 |
| --- | --- | --- |
| `worldId` | 宿主绑定 | 现有世界 id（`craftmine_worlds.id`） |
| `baseId` | 源码清单 | `first-person` / `top-down` / `side-view` |
| `baseBuild` | `craftmine_worlds.document.build.id` | 正式世界当前构建身份 |
| `sourceRevision` / `manifestHash` | `godotProject.*` | 现有源码版本与清单哈希 |
| `assetManifestHash` | 核心 | 世界资产清单哈希 |
| `buildId` | 核心计算 | `gbd-` + 规范 JSON 的 sha256（见下），相同输入必得相同值 |
| `jobId` | 核心计算 | `gjob-` + `sha256("craftmine.godot-job/1"|worldId|taskId|toolCallId)`，同一 toolCallId 幂等 |
| `candidateId` | 核心计算 | `gcan-` + `sha256("craftmine.godot-candidate/1"|worldId|buildId|checkJobId)` |
| `executorId` | A | 执行器身份，长度 ≤ 120 |
| `token` | JS broker（`randomUUID`） | 认领 / 提交令牌；核心只校验格式与相等性，不生成 |

`buildId` 规范输入（按 key 升序序列化 UTF-8 后 sha256）：

```json
{"format":"craftmine.godot-build/1","worldId":"...","baseId":"first-person","baseBuild":"...",
 "sourceRevision":0,"manifestHash":"<64hex>","assetManifestHash":"<64hex>",
 "engineVersion":"4.7.2-stable","renderer":"gl_compatibility","target":"web"}
```

`buildId` 绑定源码版本、资产清单、底座、正式世界基线与引擎组合；任何一项变化都会产生新 buildId，因此陈旧构建无法被当成当前候选应用。

## 2 磁盘布局（每 build 独立工程副本）

`<core data dir>/godot-builds/<sha256(worldId)>/<buildId>/`

| 子目录 | 内容 | 性质 |
| --- | --- | --- |
| `source/` | 从源码 blob + 资产 blob 物化的工程文件 | 只读输入，等价于源码版本 |
| `cache/` | Godot 导入缓存 | 可重建，永不当作源码 |
| `artifacts/` | 构建 / 导出产物 | 可重建，永不当作源码 |
| `manifest.json` | 构建清单（原子写） | 身份 + `files[{path,kind,sha256,bytes}]`，`kind ∈ source\|asset\|cache\|artifact` |

- 世界目录名用 `sha256(worldId)`，避免 Windows 大小写折叠导致 `a`/`A` 互相覆盖（沿用源码 blob 的做法）。
- 物化是幂等的：重复调用校验既有文件哈希后返回同一 `buildId`，不覆盖、不“修复”已有内容。
- 物化是同步且有界的（文件数 / 单文件 / 总量见 §8），不启动任何 Godot 进程；真正的导入、编译、检查是后台作业。

## 3 模型工具（PI，`plugins/craftmine-world`）

所有工具都由 broker 注入宿主身份；工具 schema **不含** `worldId` / `context` / `toolCallId` / `baseBuild`。

| 工具 | 核心方法 | 风险 | 主要参数 | 返回要点 |
| --- | --- | --- | --- | --- |
| `godot_asset_put` | `godotAsset.put` | medium | `name`, `mediaType`, `sha256`, `bytesBase64` | `sha256`, `bytes`, `assetManifestHash`, `replayed` |
| `godot_asset_list` | `godotAsset.list` | low | `offset`, `limit` | `items[{name,path,sha256,bytes,mediaType}]`, `assetManifestHash`, `nextOffset` |
| `godot_build_start` | `godotBuild.start` | medium | `revision`, `manifestHash`, `mode`(`build`\|`check`) | `jobId`, `buildId`, `status`, `executionAvailable`, `blockedReason`, `materialized` |
| `godot_build_read` | `godotBuild.read` | low | `jobId` | 作业记录 + `currentSource` |
| `godot_build_cancel` | `godotBuild.cancel` | low | `jobId` | 作业记录 |
| `godot_candidate_read` | `godotCandidate.read` | low | `candidateId` | 候选 + 构建身份 + 检查摘要 |
| `godot_candidate_list` | `godotCandidate.list` | low | `offset`, `limit` | 候选列表 |

`godot_build_start` / `godot_asset_put` 是幂等写操作：同一 `toolCallId` 重放返回同一回执，不同请求体返回 `REPLAY_MISMATCH`；传输失败后由 broker 用 `godotBuild.receipt` / `godotAsset.receipt` 恢复，不重放写入。

## 4 作业状态机

```
blocked ──(执行器注册)──> queued ──claim──> claimed ──progress──> running ──finish──> passed | failed
   │                        │                 │                     │
   └────────────── cancel ──┴─────────────────┴─────────────────────┴──> cancelled
                            └── 启动恢复 / 租约过期 ──> interrupted
```

- 终态：`passed` / `failed` / `cancelled` / `interrupted`（`interrupted` 可重新 `start` 生成新作业）。
- `godotJob.finish` 在作业已 `cancelled` 或 `interrupted` 时返回 `GODOT_JOB_INACTIVE`，**丢弃迟到结果**，不写回任何状态。
- 租约：`claimed`/`running` 默认 120 秒；`godotJob.heartbeat` 续期；`godotBuild.read` 触发 `expire`，过期作业转 `interrupted`。
- `queued` 超过 600 秒转 `blocked`，`blockedReason:"GODOT_EXECUTOR_TIMEOUT"`。
- 核心重启：所有 `claimed`/`running` 转 `interrupted`，执行器注册全部失效（必须重新注册）。

## 5 执行器契约（A 提供）

A 的隔离执行器进程通过核心 RPC 交互；这些方法**不是**模型工具，模型无法注册或伪造执行器。

### 5.1 `godotExecutor.register`

```json
{"executorId":"...","attestation":{
  "format":"craftmine.godot-executor/1","isolation":"appcontainer|job-object|...",
  "evidenceHash":"<64hex>","engineVersion":"4.7.2-stable",
  "capabilities":{"import":true,"build":true,"check":true}}}
```

返回 `{executorId,registered:true,executionAvailable:true,attestationHash,capabilities}`。
核心校验：`format` 精确、`isolation` 非空且 ≤ 60、`evidenceHash` 为 64 位十六进制、`engineVersion` 必须等于 `4.7.2-stable`。不满足 → `INVALID_EXECUTOR_ATTESTATION`。
`evidenceHash` 指向 A 的隔离验证证据（不进入核心数据库）；核心只记录身份与哈希，**不声称自己验证了 OS 隔离**。

### 5.2 `godotJob.claim {jobId, token, executorId}`

返回执行描述（Rust 已物化，路径均为绝对路径，位于核心数据目录内）：

```json
{"jobId":"gjob-...","buildId":"gbd-...","kind":"build","worldId":"...","token":"...",
 "projectRoot":"...\\godot-builds\\<worldKey>\\gbd-...\\source",
 "cacheRoot":"...\\cache","artifactsRoot":"...\\artifacts",
 "engineVersion":"4.7.2-stable","renderer":"gl_compatibility","target":"web","baseId":"first-person",
 "sourceRevision":0,"manifestHash":"<64hex>","assetManifestHash":"<64hex>",
 "files":[{"path":"project.godot","kind":"source","sha256":"<64hex>","bytes":123}],
 "mode":"build","leaseExpiresAt":1699999999999}
```

拒绝：执行器未注册 / 不匹配 → `GODOT_EXECUTOR_UNAVAILABLE`；作业非 `queued` → `GODOT_JOB_INACTIVE`；token 格式非法 → `INVALID_CALL_ID`。

### 5.3 `godotJob.progress {jobId, token, stage, percent}`

`stage` ≤ 60 字符，`percent` 0..100 单调不减。返回 `{jobId,status,stage,progress,leaseExpiresAt}`。

### 5.4 `godotJob.heartbeat {jobId, token}`

返回 `{jobId,status,leaseExpiresAt}`。非本人 token → `GODOT_JOB_OWNER_MISMATCH`。

### 5.5 `godotJob.finish {jobId, token, output}`

`output` 必须为对象且满足：

```json
{"format":"craftmine.godot-job-result/1","inputHash":"<作业创建时的 requestHash>",
 "passed":true,
 "import":{"passed":true,"log":"..."},"compile":{"passed":true,"errors":[],"warnings":[]},
 "check":{"passed":true,"assertions":[{"id":"crosshair.center","passed":true,"detail":"..."}]},
 "artifacts":[{"path":"web/index.html","sha256":"<64hex>","bytes":123}],
 "engine":{"version":"4.7.2-stable","isolation":"appcontainer","evidenceHash":"<64hex>"}}
```

- `inputHash` 必须等于作业的 `requestHash`，否则 `GODOT_JOB_INPUT_MISMATCH`。
- `passed` 为 true 且 `compile.errors` 为空、`check.assertions` 全部通过时才允许 `passed`；否则作业记 `failed`（编译错误就是真实失败，不能凭 `passed:true` 掩盖）。
- 产物条目由核心校验路径 / 哈希 / 大小后写入 `craftmine_godot_build_files`（`kind='artifact'`）。
- 作业 `kind='check'` 且 `passed` 时，核心自动生成 `candidateId`（`status='ready'`）；失败则生成 `status='rejected'` 的候选记录，`godotApplication.prepare` 拒绝。

## 6 候选与应用事务（C 对接）

### 6.1 候选

`craftmine_godot_candidates` 记录：`candidateId, worldId, buildId, sourceRevision, manifestHash, baseId, baseBuild, checkJobId, checkOutputHash, status, createdAt, updatedAt`。
`status ∈ draft|ready|rejected|superseded|applied|failed`。候选身份绑定 `buildId`（因此绑定源码版本 + 资产清单 + 基线），不存在“陈旧候选替换正式世界”的路径。

### 6.2 宿主 RPC（面板 / 编排器，非模型工具）

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `godotApplication.prepare` | `id`, `token`, `candidateId`, `worldId`, `revision`, `snapshot` | 校验候选 `ready` + 检查作业 `passed` 且仍是当前源码；读取正式世界最新进度；`revision` / `worldHash` 必须匹配；玩家状态必须与传入 `snapshot.player` 一致；保存 `previous_world` 完整副本 |
| `godotApplication.commit` | `id`, `token`, `evidence` | 必须携带**新实例确认证据**（见下）；通过后一个事务内更新世界并写回执 |
| `godotApplication.read` | `id` | 记录 + 状态 |
| `godotApplication.abort` | `id` | `prepared → aborted`，正式世界不变 |

`evidence` 形状：

```json
{"format":"craftmine.godot-application/1","inputHash":"<prepare 的 inputHash>",
 "launch":{"passed":true,"buildId":"gbd-...","instanceId":"...","stateHash":"<64hex>"},
 "player":{"format":"craftmine.progress/1","player":{"x":0,"y":6,"z":0,"yaw":0,"pitch":0}}}
```

`commit` 在以下情况拒绝并保持正式世界不变：`inputHash` 不符（`APPLICATION_EVIDENCE_MISMATCH`）、`launch.buildId` 不等于候选 `buildId`（`GODOT_LAUNCH_BUILD_MISMATCH`）、`launch.passed` 非 true（`GODOT_LAUNCH_REQUIRED`）、玩家状态变化（`APPLICATION_PLAYER_CHANGED`）、世界已被更新（`WORLD_REVISION_CONFLICT`）、令牌不符（`GODOT_APPLICATION_OWNER_MISMATCH`）、状态不是 `prepared`（`GODOT_APPLICATION_INACTIVE`）。
提交成功后世界文档的 `build` 变为：

```json
{"id":"gbd-...","scene":{"format":"craftmine.godot-scene/1","baseId":"first-person",
  "projectHash":"<64hex>","entry":"res://main.tscn"},
 "godot":{"engineVersion":"4.7.2-stable","renderer":"gl_compatibility","target":"web",
  "sourceRevision":0,"manifestHash":"<64hex>","assetManifestHash":"<64hex>"}}
```

`snapshot` 原样保留（仍是 `craftmine.progress/*`，满足 `worlds::encode`），旧版本保存在 `previous_world`，失败 / 中止 / 中断都不写正式世界。
核心重启时 `godotApplication.recover` 把所有 `prepared` 置为 `interrupted`。

### 6.3 C 需要做的事

1. 玩家点“应用”时：`godotApplication.prepare` → 启动候选实例（独立进程 / 独立数据目录）→ 收集 `launch` 证据 → `godotApplication.commit`。
2. 提交传输失败时用 `godotApplication.read` 恢复，**不要**重放 commit。
3. 界面展示 `candidate.status`、`buildId`、检查摘要与 `previous_world` 存在性；不要自行推断应用成功。
4. 世界列表的底座标签取 `build.godot.baseId` / `build.scene.baseId`；旧世界没有该字段时按旧运行器处理。

## 7 E / F / G 需要做的事

- **E（Windows 交付）**：把 A 的执行器二进制与 `CRAFTMINE_GODOT_EXECUTOR` 配置纳入安装包；`runtime_info` 会报告 `godotBuildAvailable` / `godotExecutorRequired`。构建目录在核心数据目录内，需随备份策略排除 `godot-builds/*/cache` 与 `artifacts`（可重建）。
- **F（原生验收）**：用真实执行器跑 `godotBuild.start` + `godotJob.*`，验收脚本只走进程协议 / HTTP，不发送真实输入、不激活窗口。
- **G（集成验收）**：以本文件 §4/§6 的状态机为断言来源；失败候选、取消后迟到结果、重启恢复都必须保持正式世界不变。

## 8 上限与错误码

| 项 | 值 | 错误码 |
| --- | --- | --- |
| 单资产 | 512 KiB（模型工具 96 KiB） | `GODOT_ASSET_TOO_LARGE` |
| 资产数量 / 单世界总量 | 256 / 32 MiB | `GODOT_ASSET_LIMIT` |
| 资产哈希不符 | — | `CORRUPT_GODOT_ASSET` |
| 构建文件数 / 单文件 / 总量 | 4096 / 4 MiB / 64 MiB | `GODOT_BUILD_TOO_LARGE` |
| 源码陈旧 | `revision`+`manifestHash` 必须等于工程头 | `GODOT_SOURCE_STALE` |
| 跨世界 / 旧 turn | 复用 `workspaces::inspect` / `assert_live` | `PROJECT_WORLD_BINDING_MISMATCH` / `STALE_TURN` / `TURN_ENDED` |
| 重复调用 | 同 `toolCallId` 同请求返回回执 | `REPLAY_MISMATCH`（请求不同） |
| 取消后迟到结果 | 丢弃 | `GODOT_JOB_INACTIVE` |
| 未注册执行器 | 不执行 | `GODOT_EXECUTION_UNAVAILABLE` |

## 9 `hello` 能力位（变更）

```json
{"godotProjects":true,"godotExecution":false,"godotBuildJobs":true,"godotExecutorGate":true}
```

`godotExecution:false` 的含义是“核心自身不执行游戏进程”，保持不变；构建能力由 `godotBuildJobs` + 执行器注册共同决定。`runtime_info` 的 `godotBuildAvailable` 改为读取 `godotBuildJobs`。

## 10 未在本轮范围

- 具体 Godot 导入 / 导出命令、AppContainer 隔离实现与真实引擎证据属于 A；本任务只做接线与门禁。
- Electron 世界视图、布局、底座工程与示例内容属于 C / E。
- 真实模型创作、画面手感与发行打包分别记账，不由本文件声称完成。
