# S6 接口说明｜模型工具的服务接线契约（给 S1/S2/R2/S7）

- 分支：`codex/godot-round3-s6-20260910`
- 工作树：`D:/Craftmine World-worktrees/godot-round3-s6-20260910`
- 契约模块：`plugins/craftmine-world/tool-services.cjs`（S6 独占，新增）
- 消费点：`plugins/craftmine-world/main.cjs`（S2）→ `createWorldTools(..., options)`
- 宿主提供方：`vendor/pi-desktop/apps/desktop/electron/main/craftmine-live-sample.ts`（新增）+ `plugin-host-process.mjs` / `plugin-runtime.ts` / `index.ts`

## 1 契约总表

`createWorldTools(core, getSettings, isEnded, verifications, reviews, options)` 的第六参数。每个键的声明（`SERVICE_PROVIDERS`）都带 `owner`、`hostMethod`、`provides`、`requiredFor`：

| 键 | 提供方 | 宿主方法 | 未接线时工具行为 |
| --- | --- | --- | --- |
| `sampleLiveState` | R2 | `craftmine.godotLiveState` | `godot_runtime_state scope=live` → `LIVE_OBSERVATION_NOT_WIRED`，字段保持 unknown |
| `budget` | R2+S1 | 核心 `budget.inspect` | `limits.available=false`，七类计数全部 unknown |
| `executorStatus` | S2 | 进程内执行器 | 回落到核心登记行并标注 `source:'core-registration'`、`liveProviderWired:false` |
| `executorEnqueue` | S2 | 进程内执行器 | `godot_build_start` 返回 `execution.enqueued=false, reason:'EXECUTOR_PROVIDER_NOT_WIRED', owner:'S2'` |
| `executorCancel` | S2 | 进程内执行器 | 取消只落到核心作业行，不返回 `execution` |
| `isDiscussionOnly` | R2 | 会话状态 | 回落读取插件设置 `discussionOnly/readOnlyTurn`（当前生效路径） |
| `historyMethods` | S1 | `content.*` | `godot_history` 按真实方法名调用并如实报缺口 |
| `libraryMethods` | S1+S3+S5 | `asset.*` / `package.*` | `asset_library`/`package_library` 报 `DEPENDENCY_NOT_WIRED` |
| `maxSampleAgeMs` | R2 | — | 默认 30000ms 新鲜度窗口 |

类型错误在构造期抛 `TOOL_SERVICE_INVALID`（不再静默降级）。`godot_capability_report` 新增 `services.wired` / `services.missing`，把“这个进程实际收到哪些提供方、缺的那个归谁、缺哪个宿主方法”直接交给模型与验收。

## 2 已实际合入的接线（含他人文件，请对应负责人确认/覆盖）

1. **S2 文件** `plugins/craftmine-world/main.cjs`：`createWorldTools` 第六参数已传入
   `{sampleLiveState, budget, executorStatus, executorEnqueue, executorCancel}`。
   - `budget: createCoreBudgetProvider(core)`：插件自己持有 core client，直接读本任务 `budget.inspect`，不需要第二个宿主通道。
   - `executorStatus/executorEnqueue/executorCancel`：直接调用本进程 `godotExecutor`，不经宿主。
   - `sampleLiveState`：`createHostProviders(method => pi.craftmine.godotLiveState(params))`。
2. **R2 文件**（新增 + 三处小改）：
   - 新增 `electron/main/craftmine-live-sample.ts`：读正式实例的 `observe-envelope`，用共享 `desktop/godot/shared/observation.mjs` 校验，返回宿主自身 `worldId/buildId/instanceId`；不匹配拒绝，实例未运行返回 `null`。
   - `plugin-host-process.mjs`：`pi.craftmine.godotLiveState(input)`。
   - `plugin-runtime.ts`：`craftmine.godotLiveState` 分支 + `PluginHostServices.craftmineLiveSample`（仅 `craftmine.world`，未注册服务时报 `UNSUPPORTED`）。
   - `index.ts`：`godotWorld` 构造后 `plugins.setServices({craftmineLiveSample: createCraftmineLiveSampler(() => godotWorld)})`。
3. **S2 文件** `desktop/build-world-plugin.mjs`：复制清单加入 `tool-services.cjs`。

## 3 S1 待登记（阻塞项，工具侧无需再改）

`main.rs` 分发表当前**没有** `asset.*`、`package.*`、`content.version/checkpoint/mergeCandidate/operationResult`；R7 的绑定已按交付方法名写好，登记后即可生效。`content.history`、`content.diff`、`task.recoverable/resume/discard`、`budget.inspect` 已存在。

`godot_history` 需要的 OperationContext 七字段来自 `workspace.open` 结果：`operationId/worldId/repoId/branchId/expectedHeadOid/expectedAppliedOid/expectedProgressRevision`（后三个允许 `null` 但必须存在）。请在登记时确认 `workspace.open` 返回这些字段，否则工具会如实返回 `OPERATION_CONTEXT_INCOMPLETE` 并列出缺项。

## 4 仍未完成（本任务未伪造）

| 项 | 原因 | 入口 |
| --- | --- | --- |
| 真实模型联合验收（运行观察→修改→编译→应用→再修改；三次真实压缩；重启接续） | 由 S7 统一安排 | 用本分支的 35 工具插件 + 正式客户端 + 真实模型 |
| 真实运行实例的采样端到端 | 需要引擎/窗口与真实世界实例 | 启动正式客户端，`godot_runtime_state scope=live` 应返回 `provenance:'host-instance-sample'` |
| 插件进程重启后回收已排队作业 | 核心无 `godotJob.pending`，`godot-executor.cjs:reconcile()` 因此永远空转 | S1 登记 `godotJob.pending`，或 S2 改 reconcile 的数据源 |
| `isDiscussionOnly` 宿主谓词 | 需要 R2 提供同步会话状态；当前用插件设置回落路径 | R2 传 `isDiscussionOnly` 或保持设置写入 |
| 真实核心回归 | 本会话未构建 Rust 二进制 | `CRAFTMINE_CORE_BIN=<built> node --test tests/godot-round2/R7/real-core-recovery.test.mjs` 等 |

## 5 验证入口

```powershell
node --test tests/godot-round3/S6/*.test.mjs tests/godot-remaining/L/*.test.mjs `
  tests/godot-round2/R7/jobs-and-recovery.test.mjs tests/godot-round2/R7/library-and-intents.test.mjs `
  tests/godot-round2/R7/context-injection.test.mjs
node desktop/build-world-plugin.mjs
```
