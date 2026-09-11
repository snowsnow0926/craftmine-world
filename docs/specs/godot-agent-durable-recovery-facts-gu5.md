# GU5 持久作业恢复事实切片

基线 `2ae18b25`。本切片沿用 `godot_project_facts` 和 `godot_jobs mode=usage`，只改 observe/jobs 模块及测试，不增加工具、schema、模型额度或第二套持久账本。

## 已复现的缺口

使用真实 core 返回形状构造只读 fixture，原实现的实际输出为：

1. godotCandidate.list 返回 candidateId，但 facts 按 id 读取，候选标识变成 undefined。
2. godotRuntime.describe 已返回正式构建的 sourceRevision/manifestHash，facts 却丢弃；world revision 与源码 revision 无法清楚区分。
3. facts 不调用已存在的 godotBuild.latest。压缩/换模型后若没有记住 jobId，无法从 facts 取回最新失败及其诊断指纹。
4. usageSummary 丢弃 core 返回的 limits 与 unknown 字段。

这些缺口通过纯函数/RPC fixture 复现，没有用模型写的摘要代表当前状态。

## 生产接口

`projectFacts` 自动增加 `recovery`，由 `godot-jobs.cjs::readRecoveryFacts` 读取既有 core 数据：

1. `task.context({context})`：核对 world.id 以及 binding 的 project/session/turn，获得当前 task/generation/status、task draft 元数据和实际 budget。
2. `godotBuild.latest({worldId,sessionId})`：sessionId 只取自刚核对的宿主 binding。当前 core SQL JOIN task.binding，按 sessionId 过滤并按 created_at/rowid 选择最新作业；不会降级成 world-latest。
3. 若最新 job 有 candidateId，再通过 `godotCandidate.read` 核对 world/build/job/outputHash 链，恢复该具体候选的状态与源码身份。

所有数据来自已有记录，不创建任务、重试作业、准备采用、预留 token 或改写 verdict。现有核心 read 路径自身的过期检查、usage 结算语义保持原样。

### 任务与预算

currentTask 仅返回核实的 binding/generation/status 与 task draft 元数据，不复制 requirements/receipts 中的模型摘要。task draft revision 明确不是 Godot source revision。

budget.value 保留 task.context.budget 的原字段、null、已知/预留/未知计数及 ownerTaskId。恢复后的 budget owner 可以是旧 task，这是既有累计记账，不重置为当前 task。这里不重新计算 remaining、添加 limits 或决定停止。

原工具的 limits（宿主 provider 归一化视图）与新 recovery.budget（core 原始视图）均保留来源，不合并成新的预算。

### 最新作业和失败证据

- selection=core-session-latest；job.taskId 等于当前 task 时 scope=current-task。
- 同 session 的其他 task 标 same-session-other-task；不把它的失败或次数归给当前任务。
- 旧记录缺 taskId 时 scope=task-identity-unknown；接口缺失/错误为 unavailable，不把未知值当 0 或没有任务。
- core 明确返回 null 时，才表示该 session 没有匹配 job。
- 使用已有 diagnoseGodotBuildRead 从最新持久 output 即时重建诊断与 fingerprint，不持久化派生结果，不信任模型 summary，也不改变原 output/hash/status。
- job source、project 查询快照与正式 runtime source 分开呈现。sourceComparison 的 same-source/different-source/different-branch/unknown 只比较已提供的 revision/hash/branch，不把旧任务源码替换成当前 head。
- 缺少正式 sourceRevision 时保持 null，不能用正式世界 revision 代替。

facts.block 增加当前任务、最新 session job、诊断指纹及原始预算计数的简短行，便于上下文重建；完整证据仍在结构化字段中。没有自动重复失败计数器或修复上限。

### 候选与应用

修复真实 candidateId 的读取，同时保留兼容旧 id 的别名字段。候选 sourceRevision/manifestHash 与 checkOutputHash 不再丢弃。

latestJob.candidate 由该 job 的具体候选记录恢复，不能用列表首个候选代替。错误 world/build/job/hash 关联拒绝。

正式 runtime 的 build/source 身份保留；latestJob.formalBuildMatch 仅表示最新 job 的 build 是否与正式 descriptor 相同。它不是一次新应用事务完成回执。

core job 里没有可发现的 pending/applying 队列回执，本切片将 application.available=false、applicationQueue=unknown 明确返回。没有把 passed check 变成 applied，也没有捏造 applicationId。已有 godot_build_read 的宿主 creationApplication 回执路径继续保留。

## 范围和真实性

- 只恢复核实 session 的最新 job，不扫描全部历史失败；coverage.olderFailureHistory=not-scanned。
- 多个 core read 不构成原子事务，snapshotConsistency=independent-core-reads；所有原身份保留，源比较针对本次 project 快照。
- 再次调用从 core 重新读取，不依赖原模型、内存 cache 或前一次事实文本。
- job usage 的 limits/unknown 原样恢复，并明确 limitsScope=last-recorded-job-usage，不能当作当前玩家模型预算。
- 这证明恢复接口可以重建事实，不等于已经用真实模型完成压缩/换模型后的自主续作验收。

## 验证

```powershell
node --test tests/godot-agent/recovery-facts.test.mjs tests/godot-remaining/L/observe.test.mjs tests/godot-remaining/L/broker-contract.test.mjs tests/godot-round3/S6/live-and-execution-wiring.test.mjs
$env:CRAFTMINE_CORE_BIN='D:/cm-agent-godot-0912/vendor/pi-desktop/target/release/craftmine-core.exe'
node --test tests/godot-agent/recovery-facts-core.test.mjs
```

共 60 项通过（59 项逻辑/现有回归与工具路由，1 项真实核心）。覆盖真实字段形状、候选 ID、草稿/正式源码区分、无记忆 job 恢复、历史 task 标记、原预算/null/unknown、错误身份拒绝、缺接口不降级、应用状态未知与动态重读。

真实核心测试只在独立临时目录创建 source/job，用明确的 synthetic executor 输出登记 failed check，再修改源码 head、停止并重新打开核心。重开后仍恢复同一个 failed job、rejected candidate、outputHash、fingerprint、sourceStale 和原 budget owner/值；没有重新判定或修改原失败结果。不同 session 的 latest 真实返回 null。

受测核心 SHA-256：`fe5582a61d3200e4d6a17a2406bf2a91e5146961e330fb624f1ec71febb0676e`。测试打印核心路径/hash、隔离目录和证据标识。这是 `real-core-synthetic-executor`，不是一次 Godot/LPAC 执行；没有模型、浏览器、真实输入或玩家 profile 操作。
