# C｜执行器与运行检查：对外接口

面向 R1 / R2 / R7 / L。所有接口都在本任务范围内实现并有原始证据；标注
**pending** 的部分依赖 A 的 Rust 契约或他人接线，已做特性探测。

## 1 插件后台服务

`plugins/craftmine-world/godot-executor.cjs` 在插件宿主进程内运行，由
`main.cjs` 注册为服务 `godot-executor`（manifest 只提交了 `services` 字段）。

```js
const executor = createGodotExecutor(core, {
  dataPath,                       // 插件数据目录；broker 任务根在其下
  verifier: pi.craftmine,         // {godotCheck(input), cancelGodotCheck(id)}
  logger,                         // 可选
  jobTimeoutMs,                   // 可选，默认 600000
});

await executor.start();           // 发现 + 预检 + 注册；返回 status()
await executor.stop();            // 取消全部作业 + 撤销注册；返回 {revoked, revokeReason}

executor.status();                // 只读实时状态
executor.enqueue({jobId, worldId, mode});   // mode: 'build' | 'check'
executor.cancel(jobId, reason);
executor.cancelTurn(context);     // 按 sessionId/turnId 取消
executor.cancelOtherTurns(context);
await executor.reconcile();       // pending：依赖 godotJob.pending
```

`status()` 关键字段：

```jsonc
{ "format":"craftmine.godot-executor-status/1", "state":"registered|unavailable|stopped",
  "available":true, "buildAvailable":true, "checkAvailable":true,
  "reason":null,                  // GODOT_BROKER_MISSING / GODOT_ENGINE_MISMATCH / ...
  "engineVersion":"4.7.2-stable", "isolation":"craftmine.windows.lpac-registry.v1",
  "evidenceHash":"<64hex>", "broker":{"sha256":"<64hex>"},
  "bridge":{"sha256":"<64hex>"},
  "preflight":{"processVerified":true,"networkVerified":true,"cleanupVerified":true,
    "networkChecks":[{"name":"tcp4","ok":false,"rawOsError":10013}, ...]},
  "jobs":["gjob-..."] }
```

`runtime_info` 的 `godotBuildAvailable` 现在等于 `status().available`，
并新增 `godotCheckAvailable` 与 `godotExecutor{state,reason,evidenceHash,preflight,...}`。

## 2 私有 host 路由（无面板、无模型通道）

| 方法 | 参数 | 行为 |
| --- | --- | --- |
| `godotExecutor.status` | 无 | 只读实时状态；已加入 `plugin-runtime.ts` 白名单 |
| `godotExecutor.enqueue` | `{jobId,worldId,mode}` | 由可信宿主调用；不暴露给渲染层 |
| `godotExecutor.cancel` | `{jobId}` | 同上 |
| `godotExecutor.revoke` | `{executorId}` | 转 core 并停服务（**pending**：core 未实现时返回错误） |
| `godotJob.checkDescriptor` | `{jobId,token,artifacts}` | 转 core（**pending**，见第 3 节兜底） |
| `godotApplication.*`、`world.read` | 见 `host-requests.cjs` | 60 秒超时白名单 |

## 3 给 R2 的候选检查契约（firstLoad / candidate check）

**输入**（执行器解析后交给 `GodotBuildVerifier.check`，字段与 A 的
`godotJob.checkDescriptor` 一致）：

```jsonc
{ "format":"craftmine.godot-check-descriptor/1", "phase":"check",
  "jobId":"gjob-<64hex>", "inputHash":"<64hex>",
  "worldId":"...", "buildId":"gbd-<64hex>", "baseId":"first-person|top-down|side-view",
  "root":"<核心管理的 artifacts 绝对路径>", "entry":"web/index.html", "threads":true,
  "artifacts":[{"path":"web/index.html","bytes":963,"sha256":"<64hex>"}, ...],
  "snapshot": { ... 正式进度快照 ... } | null }
```

**输出**：`craftmine.godot-runtime-check/1`，字段见
`vendor/pi-desktop/docs/spec/dispatch-managed-godot-executor.md` 第 5 节。
`passed` 仅在 ready、真实帧、无错误、快照一致、隔离、清理六项全真时为真。

**R2 需要做的接线**（片段，未提交到 R2 的文件）：

```ts
// electron/main/index.ts
import { GodotBuildVerifier } from "./godot-build-verifier";
const godotCheck = new GodotBuildVerifier({ deadlineMs: 180_000 });
pluginRuntime.setServices({
  ...,
  craftmineGodotCheck: {
    check: (input: unknown) => godotCheck.check(input),
    cancel: (id: string) => godotCheck.cancel(id),
  },
});
```

`plugin-host-process.mjs` 已经把 `pi.craftmine.godotCheck(input)` /
`cancelGodotCheck(id)` 暴露给插件宿主进程。

**首次加载（firstLoad）建议**：R2 打开 Godot 世界时，用与执行器相同的
`artifacts` 清单与 `entry: "web/index.html"`、`threads: true` 调
`createWorldRuntime`；`snapshot` 必须来自核心 `world.read` 的
`world.snapshot`（verbatim 根目录需先去掉 `\\?\` 前缀，见 ADR）。
基础启动检查（本任务）与玩法必需断言（任务 I）分开记账。

## 4 给 R7 / L 的模型工具接线

`godot_build_start` 返回后（含 `blocked` 状态）调用一次：

```js
// world-tools.cjs，godot_build_start 分支返回前
const result = await core.call('godotBuild.start', params);
if (result?.jobId) godotExecutor.enqueue({ jobId: result.jobId, worldId: workspace.worldId, mode: params.mode });
return result;
```

- 作业在注册前是 `blocked`：执行器会等待注册后自动转为可认领（实测
  `promotedJobs:1`）。
- 取消：`godot_build_cancel` 之后执行器自行收敛（broker 取消帧 + 终止）。
- **pending**：跨进程重启后遗留的 `queued` 作业需要 `godotJob.pending`
  才能自动重新入队；在此之前由 L 的调用路径负责。

## 5 构建与打包入口

- `desktop/build-world-plugin.mjs` 拷贝列表已加入 `godot-executor.cjs`。
- `electron.vite.config.ts` preload 输入已加入 `godot-check`。
- 两者都未在本工作树实际打包（无 `node_modules`），只做静态一致性校验。

## 6 配置项（宿主，不来自模型/页面）

| 变量 | 用途 |
| --- | --- |
| `CRAFTMINE_GODOT_BROKER_BIN` | broker 可执行文件（缺省查数据目录，再查开发路径） |
| `CRAFTMINE_GODOT_BROKER_SHA256` | 可选：强制校验 broker 哈希 |
| `CRAFTMINE_GODOT_ENGINE_ROOT` / `CRAFTMINE_GODOT_CACHE_DIR` | 固定引擎根 |
| `CRAFTMINE_GODOT_TOOLCHAIN_LOCK` | `toolchain.lock.json` |
| `CRAFTMINE_GODOT_BRIDGE_PATH` | 宿主固定 bridge.js |
