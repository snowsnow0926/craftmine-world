# GU1：工具接线与实时执行能力分离

日期：2026-09-12。范围：内置 Godot 能力提升计划 GU1 的增量实现。

## 问题与决策

核心握手的 `godotBuildJobs=true` 证明核心登记了作业接口，不能证明当前产品进程的执行器在线。`godot_jobs mode=status` 已经有真实宿主 provider，但能力清单此前未读取它。因此，工具能创建作业记录与当前能执行构建/检查会混为一谈。

保留 `craftmine.godot-capability/1` 和原有工具级 `wired/reachable/blockedBy` 字段，新增模式级执行状态，不改变任何调用授权、候选应用、取消、预算或执行器行为。报告是观测，不是执行许可；报告到调用之间宿主状态仍可能变化，实际调用结果优先。

## 已核对的真实接口

- `plugins/craftmine-world/main.cjs` 把 `executorStatus:()=>godotExecutor.status()` 传入 broker。
- `godot-executor.cjs` 的 `status()` 返回 `craftmine.godot-executor-status/1`，含 `available`、`buildAvailable`、`checkAvailable`、`state`、`reason`。
- `godot-jobs.cjs` 的 `executorStatus(core, options)` 优先读取这个 provider，包装为 `source=live-executor`；仅在 provider 缺失时读取核心注册，包装为 `source=core-registration`。
- 核心 `godot_jobs.rs` 的 `godot_executor_status()` 返回 `craftmine.godot-execution-status/1`，字段为 `build/check` 与各自原因。它不是当前宿主存活证据。
- 已有 `describeToolServices(options).wired` 可证明本 broker 收到了 `executorEnqueue`；有在线状态却无移交 provider 时，仍不能承诺执行。

## 增量契约

`godot_build_start.modes` 包含 `build/check`，`godot_jobs.modes` 包含 `status/usage/resume`。每项有 `hostMethod/kind/reachable/blockedBy`；需要执行器的模式额外有 `execution`。

```json
{
  "mode": "check",
  "hostMethod": "godotBuild.start",
  "reachable": true,
  "execution": {
    "state": "blocked",
    "available": false,
    "reason": "GODOT_CHECK_UNAVAILABLE",
    "source": "live-executor",
    "byJobKind": {
      "check": {"state": "blocked", "available": false, "reason": "GODOT_CHECK_UNAVAILABLE", "source": "live-executor"}
    }
  }
}
```

| 证据 | execution.state / available |
| --- | --- |
| 当前宿主 available=true、相应模式=true，且有 executorEnqueue | available / true |
| 当前宿主 available=false，或相应模式=false | blocked / false |
| provider 缺失、抛错、状态格式无效、所需布尔值缺失 | unknown / null |
| 只有核心注册，无论其 build/check 是否为 true | unknown / null |
| 宿主在线但 executorEnqueue 缺失 | unknown / null |
| 对应核心能力被禁用 | blocked / false，来源 core-handshake |
| 对应核心能力未报告 | unknown / null，来源 core-handshake |

provider 抛出 `GODOT_EXECUTOR_UNAVAILABLE` 也仅证明查询失败，不能替代一次明确的离线状态观测。

`resume` 的作业类型来自原始作业，能力报告没有 originJobId。它返回 `byJobKind.build/check`：两者都可用时整体可用；两者都阻塞时整体阻塞；只有一种可用时整体 unknown，原因为 `ORIGIN_JOB_KIND_REQUIRED`，并注明 `dependsOn=originJob.kind`。两者同为 unknown 且原因一致时保留原原因。原始作业是否允许恢复、身份和参数是否有效仍由现有接口判断。

`status/usage` 没有执行器依赖；`godot_build_read/cancel` 保留原行为。离线报告不拦截任何读取或取消。

每次 `godot_capability_report` 调用都重读 executorStatus，不使用跨调用缓存。当前 live provider 失败时不降级为“核心注册在线”，恢复后下一次查询能立即显示新的结果。清单查询不打开 workspace、不获取草稿租约、不调用 enqueue。

## 合同身份与权限边界

报告新增 `contract={format,algorithm,digest}`，格式为 `craftmine.godot-capability-contract/1`，SHA-256 对工具定义、路由、local 依赖、执行模式、host method 定义进行递归对象键排序后计算。数组顺序保留。任何 schema/路由变化可改变 digest，动态握手、世界绑定、预算、执行状态不会改变 digest。该摘要是接口身份，不是二进制校验或安全证明。

原有 `unreachableMethods` 保留以兼容读取方，并新增 `exposure=host-only`、`intentional=true`、`agentExposureDefect=false`。候选应用、令牌门控 worker 回执与备份由宿主工作流负责，未向 agent 暴露并不构成功能缺陷；本次未向 agent 开放相关命令或凭证。

## 验证与边界

新增单元契约验证模式枚举与真实 manifest 一致、禁用/缺失握手、摘要稳定性及 schema/路由变化。真实 `createWorldTools` broker 分支在独立临时目录中运行，domain/core/provider 使用确定性替身；覆盖 available → build-only → offline → recovered、查询失败 → 恢复、核心陈旧注册、provider 缺失/格式无效、enqueue 缺失、读取/取消持续可达。

这些检查没有浏览器、真实输入、窗口操作、Pointer Lock、模型请求或收费调用。它们证明报告与现有接口契约的接线和状态转换，不替代真实引擎构建、客户端安装包验收或真实玩家自然语言创作完成率。GU1 其余能力面、GU2 运行观察和后续玩法验收仍需分工作包推进。

复现入口：

```powershell
node --test tests/godot-remaining/L/capability.test.mjs tests/godot-round3/S6/live-and-execution-wiring.test.mjs
node --test tests/godot-remaining/L/broker-contract.test.mjs tests/godot-round3/S6/plugin-load.test.mjs tests/godot-round3/S6/tool-services.test.mjs tests/godot-round2/R7/jobs-and-recovery.test.mjs
```

实现验证结果：上述两组共 69 项通过，0 失败，0 跳过。回归过程中同步更新旧 broker 清单断言以包含新增只读 status 调用，并补齐 plugin-load 测试私有复制目录中缺失的 `creation-timing.cjs` 与 `creation-application-state.cjs` 依赖；没有修改这两个生产模块。
