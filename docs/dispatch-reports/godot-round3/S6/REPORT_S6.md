# S6 交付报告｜模型工具接线、实时观察与恢复上下文

- 任务：`docs/dispatch-prompts/godot-round3-20260910/S6-model-context-and-live-state.md`
- 分支：`codex/godot-round3-s6-20260910`（未推送）
- 工作树：`D:/Craftmine World-worktrees/godot-round3-s6-20260910`
- 起点：`2fa3c7c`（R2 已提交集成头），历史地合入 R7 `bba7847`（`4880552`）
- 提交：`b6fb3f1`（契约与接线）、`b00a8b8`（宿主桥）、`8a33570`（测试与文档）、`6c0b05a`（报告）、`8f55851`（证据刷新）、`d804da5`（可选覆盖项与缺失提供方分离）
- 用户指示：先做接线，联合真模型由 S7 安排

## 1 结论摘要

已完成的接线（本会话实际合入，非未应用补丁）：

1. **服务契约落地**：新增 S6 独占 `tool-services.cjs`，声明 `sampleLiveState/budget/executorStatus/executorEnqueue/executorCancel/isDiscussionOnly/historyMethods/libraryMethods/maxSampleAgeMs` 的 `owner/hostMethod/requiredFor`；类型错误构造期失败，未接线运行期如实报 unknown；有默认值的覆盖项单列 `optionalMissing`，不把“有默认值”报成“能力缺失”。
2. **生产构造实际传参**：`main.cjs` 现在把 `sampleLiveState/budget/executorStatus/executorEnqueue/executorCancel` 传给 `createWorldTools`（审计原文的“未传第六参数”已消除）。预算直接读本任务 `budget.inspect` 耐久行，无需第二个宿主通道。
3. **实时观察宿主桥**：新增 `craftmine-live-sample.ts` + `pi.craftmine.godotLiveState` + `PluginRuntime` 分支与服务注册；只读正式实例的 `observe-envelope`，用共享 observation 模式校验，返回宿主自身 `worldId/buildId/instanceId`；未运行返回 null，跨世界/构建/实例拒绝。
4. **作业真正交给执行器**：`godot_build_start` 在 `executionAvailable:true` 时当轮把作业交给进程内 `godotExecutor`；`godot_jobs mode=resume` 续跑同样交接；`godot_build_cancel` 同时取消执行器 worker；无提供方时回报 `EXECUTOR_PROVIDER_NOT_WIRED`（owner S2）。
5. **门禁来自活体执行器**：`godot_jobs mode=status` 优先 `source:'live-executor'`，仅在无提供方时回落核心登记行并标注 `liveProviderWired:false`。
6. **能力报告暴露真实接线状态**：`godot_capability_report.services` 给出 `wired/missing/optionalMissing` 与 owner；`HOST_METHODS`/`LOCAL_TOOLS` 的 owner 更新为 round-three 的 S1/S2/S3/S4/S5/S6，并补入 `asset.*/package.*/content.*/budget.inspect/godotExecutor.status/godotJob.usage/continue`。
7. **耐久事实注入回归**：请求 hook 每次请求重建 `godotFacts`；测试证明连续三次压缩与换模型后同一事实重建、且不含实时装备。
8. **生产入口本身被验证**：`plugin-load.test.mjs` 用 stub core 与 stub 宿主 API 真实执行 `main.cjs:onLoad`，证明注册 35 工具、`services.complete:true`、活体采样确实经 `pi.craftmine.godotLiveState` 到达。

明确未完成（见 §5）：真实模型联合验收、真实运行实例端到端、真实核心回归、`asset.*/package.*/content.*` 登记、插件重启后回收排队作业、`isDiscussionOnly` 宿主谓词。

## 2 改动文件

新增：

| 文件 | 作用 |
| --- | --- |
| `plugins/craftmine-world/tool-services.cjs` | 服务契约、宿主适配、七类预算映射、observation 展平 |
| `vendor/pi-desktop/apps/desktop/electron/main/craftmine-live-sample.ts` | 宿主实时采样器（只读正式实例） |
| `tests/godot-round3/S6/{plugin-load,tool-services,live-and-execution-wiring,host-live-sample,host-bridge,context-recovery}.test.mjs` | 32 项新测试 |
| `docs/dispatch-reports/godot-round3/S6/{SPEC,ADR,INTERFACE_NOTE,E2E,REPORT}` + `evidence/` | 本任务文档与证据 |
| `vendor/pi-desktop/docs/adr/dispatch-s6-live-observation-bridge.md` | vendor ADR |

修改：`plugins/craftmine-world/{world-tools,godot-observe,godot-jobs,godot-capability,godot-routing,main}.cjs`、`desktop/build-world-plugin.mjs`、`vendor/pi-desktop/apps/desktop/electron/main/{plugin-host-process.mjs,plugin-runtime.ts,index.ts}`、`vendor/pi-desktop/docs/spec/03-runtime/02-agent-runtime.md`（§5.1a）、`vendor/pi-desktop/docs/spec/06-delivery/04-e2e-test-plan.md`（CRAFTMINE-GODOT-023）、继承测试 `tests/godot-remaining/L/{broker-contract,capability}.test.mjs`（新增模块复制项、owner 期望更新为 round-three）。

## 3 正式调用入口

- 插件工具：`createWorldTools(core, getSettings, isEnded, verifications, reviews, options)`（`plugins/craftmine-world/world-tools.cjs`）
- 契约校验：`validateToolServices(options)` / `describeToolServices(options)`
- 宿主能力：`pi.craftmine.godotLiveState({worldId,buildId,instanceId})` → `PluginRuntime.services.craftmineLiveSample` → `createCraftmineLiveSampler(() => godotWorld)`
- 构造点：`plugins/craftmine-world/main.cjs:onLoad`（第六参数）

## 4 验收与证据（分别记账）

| 账目 | 内容 | 证据 |
| --- | --- | --- |
| 逻辑/契约 | 129 tests，124 pass，0 fail，5 skipped（S6 新 32 项 + 继承 97 项） | `evidence/tests-logic.log` |
| 生产入口 | `main.cjs:onLoad` 注册 35 工具，`services.complete:true`，活体采样经宿主 API 到达 | `tests/godot-round3/S6/plugin-load.test.mjs` |
| 插件构建 | 35 工具，`tool-services.cjs` 随包，模块可 require | `evidence/plugin-build.log`、`evidence/built-tool-surface.json` |
| 源码身份 | 13 个改动文件 SHA-256 | `evidence/source-hashes.txt` |
| 宿主桥 | 真实 `PluginRuntime.dispatchHostCall` 门禁与转发 | `tests/godot-round3/S6/host-bridge.test.mjs` |
| TS 检查 | `craftmine-live-sample.ts` 单独 `tsc --noEmit` 通过；三个改动 TS 文件 esbuild 转换通过 | 本报告 §6 |
| 起点/状态 | 起点提交、工作树状态 | `evidence/baseline-commit.txt`、`evidence/worktree-status.txt` |

**没有证明**：真实模型行为、真实运行实例采样、引擎渲染、真实编译/检查结果、真实产品端到端、Windows 安装包。5 项 skipped 为需要 `CRAFTMINE_CORE_BIN` 的真实核心测试，本会话未构建核心二进制。未运行 `tests/browser.mjs`/`tests/modules-browser.mjs`，未发送真实输入、未请求 Pointer Lock、未激活窗口。

## 5 逐条对照“必须完成”

| # | 要求 | 结果 |
| --- | --- | --- |
| 1 | 交付采样/budget/作业/域服务契约；推动 S2 传参、R2 接宿主桥；主进程取得当前 world/build/base/instance/时间绑定的实时相机、装备、实体、任务状态 | **契约与传参已合入**；R2 宿主桥已实现（新增采样器 + `craftmine.godotLiveState` + 服务注册），生产入口测试证明链路成立。真实运行实例未验证（无引擎/窗口）。 |
| 2 | 构建/排队/取消/恢复调用 S2 服务；能力来自真实运行状态；未知结果查询原操作；新世界与已有 Git 工程用 S1 正式顺序；讨论模式不改世界；权限与检查权不交模型 | **构建/取消/恢复已接活体执行器**，门禁优先活体；讨论模式写入与草稿接续被拒；令牌方法不入工具面。`asset.*/package.*/content.*` 仍待 S1 登记。 |
| 3 | 接 S1 分支/恢复/草稿接续、S3 固定作品安装提案、S5 资源检索/预览；区分五种意图并绑定 OperationContext | 绑定与五种意图已就绪（R7 交付 + 本轮 owner/方法名核对）；**登记未完成**，工具如实报 `DEPENDENCY_NOT_WIRED`。`asset_library` 目前只有 search/read/versions，**没有预览入口**（S5 预览为受信主进程服务，模型侧方法未登记）。 |
| 4 | 请求 hook 自动注入耐久事实；三次真实压缩、换模型、任务/进程中断后恢复原工程任务继续修改；恢复/discard 后新建分别验证 | 自动注入与三次压缩/换模型的**逻辑级**验证通过；真实压缩、真实重启接续由 S7 安排。 |
| 5 | 累计 token/缓存/请求/压缩/服务/墙钟/资源预算与 S1 接通；未知保留；接续不重置成本 | 七类映射接通耐久行；context/service/resource 保持 unknown；`ownerTaskId` 证明接续不重置。缓存/服务/资源计数核心尚无字段。 |
| 6 | 使用产品正式系统提示、工具筛选与文档入口；S7 适配器复用同一代码 | 未改系统提示绕过；`CRAFTMINE_SYSTEM_PROMPT`/`isCraftmineToolAllowed` 保持为唯一入口，S7 应直接复用。 |
| 7 | 依真实模型错误改善工具说明；完成至少一条武器/商店需求修复 | **未开始**（需要真实模型；S7 安排后执行）。 |

## 6 命令与身份

```powershell
cd D:\Craftmine World-worktrees\godot-round3-s6-20260910
node --test tests/godot-round3/S6/*.test.mjs tests/godot-remaining/L/*.test.mjs `
  tests/godot-round2/R7/jobs-and-recovery.test.mjs tests/godot-round2/R7/library-and-intents.test.mjs `
  tests/godot-round2/R7/context-injection.test.mjs
node desktop/build-world-plugin.mjs
node <agent-runtime>/node_modules/typescript/bin/tsc -p <scratch>/s6-tsconfig.json   # craftmine-live-sample.ts
```

- 引擎版本：`4.7.2-stable`（固定常量，本会话未启动引擎）
- 核心二进制：**本会话未构建**（真实核心账目为空，不填造）
- 插件身份：35 工具，源码哈希见 `evidence/source-hashes.txt`
- 依赖复用：junction 只读复用 `batch07-delivery-20260909/vendor/pi-desktop` 的 `node_modules`（根、agent-runtime、apps/desktop 三处），未安装/修改/复制

## 7 已定位但未解决

| 项 | 精确责任 | 下一步 |
| --- | --- | --- |
| `asset.*`（含预览）/`package.*`/`content.version|checkpoint|mergeCandidate|operationResult` 无核心分发 | S1 登记，S3/S5 提供实现 | 登记后工具无需改动即生效 |
| `workspace.open` 是否返回 `repoId/branchId/expected*` 未验证 | S1 | 真实核心下调用 `godot_history`，确认不是 `OPERATION_CONTEXT_INCOMPLETE` |
| 插件重启后回收已排队作业：核心无 `godotJob.pending`，`godot-executor.cjs:reconcile()` 空转 | S1 登记方法或 S2 改数据源 | 重启场景需 S7 联合验证 |
| `isDiscussionOnly` 宿主谓词未接（当前走插件设置回落） | R2 | 传同步会话状态，或保持设置写入 |
| 真实模型“观察→修改→编译→应用→再修改”、三次真实压缩、重启接续 | S7 | 用本分支插件 + 正式客户端 + 真实模型 |
| 缓存/服务/资源三类预算计数核心无字段 | S1 | 有计数后 `budgetKindsFromLedger` 直接扩展 |
