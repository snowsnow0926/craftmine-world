# GU4 有限场景判定内核与门碰撞切片

日期：2026-09-12。状态：第一切片原生 headless 夹具已通过；第二切片增加生产验证器可选诊断接点，并完成真实 Web/offscreen 验证。没有注册新 Agent 工具，没有改变生产候选采用或正式存档路径。第二切片接口与边界见文末。

## 协议与所有权

`godot-scenario-verdict.ts` 提供纯函数 `scenarioRequirementsHash` 和 `adjudicateGodotScenario`。宿主持有场景计划和预期世界、构建、实例；运行数据不能修改计划、减少断言或自行选择预期身份。计划包括 `fixtureRef`、有限动作序列和断言，其规范 JSON 的 SHA-256 为 `requirementsHash`。

场景支持 `walk`、`wait`、`look`、`interact` 数据动作及标量等值、数值闭区间断言，没有表达式、脚本、任意函数调用、传送或状态设置。32 步、单步 120 帧、总 1200 帧、128 条断言为短场景资源保护，不涉及玩家普通任务的 token、模型请求次数或整轮时长，也不授权给玩家评测添加额外上限。

运行记录含顶层世界/构建/实例、需求哈希、fixture 引用，以及每步实际动作、相同身份与需求哈希、确认结果、递增物理 tick、观察。数量不完整、动作替换、身份漂移、哈希不符、时钟重放均 `inconclusive`。动作明确失败或已有合法观测违反断言为 `failed`；缺字段、非有限数或不支持的观测类型均不能通过。所有断言都有实际结果且通过才 `passed`。若同时存在确定失败和缺失项，总结果保持 `failed`，逐断言保留缺失。

所有返回内容标记 `untrusted-project-data`。宿主 envelope 证明记录归属，不证明项目自报状态真实。此纯内核不是反作弊证明器：若调用者把项目可修改的计划或伪造 transcript 作为受信输入，协议本身不能修复信任错误。后续生产接线必须固定可信 runner/observer，冻结原需求，验证候选、源码和运行身份，并按原作业取消及恢复规则收集证据。内核不会自行启动引擎或授予正式世界写权限。

## 门场景 GA11/GA20

固定夹具在引擎启动前把玩家初始场景放在 `(0,0.9,3)`，门在原点。这个源码设置作为 setup 单独记录；运行后不修改玩家位置、门开关、背包或断言。

1. 等待物理稳定，记录初始位置、关门自报值和真实碰撞。
2. 用底座 `PlayerController.walk` 经真实 `move_and_slide` 正向移动，确认玩家被关门挡在门前且没有侧向绕过。
3. 用固定 adapter 的 `interact` 走实际相机射线与 `interact_target`，断言真正命中 `gate`。
4. 等待物理更新，同时检查项目自报已开、固定 observer 所见碰撞释放与门铰链几何状态。
5. 再次用同一真实控制器行走，确认实际穿过门。

负例在隔离夹具源码中预先注入“开门仍保持碰撞”，正常交互仍设置项目的 open 状态和门铰链。自报开门断言通过，但固定观察和实际通行失败，整体必须 `failed`。不通过试验脚本直接写门或玩家状态制造结论。

## 证据和运行

`tests/godot-door-scenario-headless.mjs` 复用现有 `createGodotProbeEnvironment`，验证固定引擎哈希，以 `--headless`、`windowsHide` 和独立 profile 启动，执行真实导入、独立脚本解析和玩法。每个变体使用新进程/实例。构建标识由引擎版本及完整已物化源码、固定控制器/observer、资源与可信驱动的清单哈希产生；含该标识的 `scenario.json` 单独保存以避免循环哈希。

```powershell
node --test tests/godot-scenario-verdict.test.mjs
$env:CRAFTMINE_GODOT_CACHE_DIR='D:/Craftmine World/desktop/build/godot/4.7.2-stable'
node tests/godot-door-scenario-headless.mjs
```

结果写入独立 `test-results/godot-door-scenario-*`，包括两个变体的源码清单、原始引擎日志、逐步 transcript、逐断言 verdict 和总报告。命令无真实键鼠、浏览器或窗口焦点操作；不调用模型。原生 headless 没有 Web Pointer Lock 路径。

第一切片证明真实关闭阻挡、正常互动开启、打开后通行，以及自报开启而保留碰撞的负例可被检出。当时未证明渲染画面质量、Web 成品、玩家体验、钥匙条件、宝箱一次性奖励/冷重开、生产候选服务权限与取消，或 Agent 自主使用。这是 GU4 的 GA11/GA20 子切片，不能标记整项或完整 GU4 已交付；后续新增范围在下面单独记录。

## 第二切片：生产验证器的可选诊断收集器

`GodotBuildVerifier` 构造器新增仅进程内可传的 `scenarioDiagnostics(binding)` 选择器，默认不存在。它只收到已解析且完成工件校验的当前 check 所属 `jobId / inputHash / worldId / buildId / baseId / checkRequirementsHash`，不收到路径、renderer 回调或原始 runtime。没有新 IPC、模型工具、任意路径或 eval API，也不从 descriptor、模型回复或运行页面读取扩展计划。

选择器在当前权威启动、快照、运行画面、原有限需求检查之后执行。它可以选择一个宿主计划，`collectGodotScenarioDiagnostic` 会在第一次 await 前克隆并校验整份计划，生成独立需求哈希，然后只对验证器已创建的那个可丢弃 runtime 调用 `observe-envelope / walk / wait / look / interact`。不得把正式世界 runtime 传入此 provider。收集器没有 `load / save / acknowledge / cancel` 存档或恢复接口，不初始化进度、不传送、不将 `fixtureRef` 解析为路径；fixtureRef 只记录当前场景预期起点的宿主引用。

每次动作前后核对 host runtime 身份和 envelope 世界/构建/实例/base、新鲜时间及物理 tick。即时动作通过只读采样等到后续物理帧，不增加隐藏的玩法动作。缺失时钟、实例变化、不支持的底座、超大响应、断开的 transport 和缺字段返回 `inconclusive`；确定观测违反断言返回 `failed`。只保留断言引用的有限标量，不把完整自报场景反复塞入证据。

### 诊断与权威结果严格分开

返回字段是 `scenarioDiagnostic`，其中 `authority=diagnostic-only`、`affectsCandidateReadiness=false`。扩展计划哈希与核心 `checkRequirementsHash` 分列；既有 `requirementsEvidence` 和核心要求不会被替换。该字段不加入 `assertions`，`passed` 不读取诊断的成功或失败。普通脚本发出的真实 runtime-error、隔离故障和取消仍执行已有失败策略；不能因诊断开关忽略这些宿主故障。

当前 `godot-executor.cjs` 的 `finish` 只向核心提交原 requirementsEvidence 和迁移结果，没有将本扩展变为 `godotJob.finish` 的权威输入，也没有新增持久诊断查询工具。本次完成的是生产类中的可选收集接点和独立诊断返回，默认产品调用没有启用它。后续要形成可靠自动采用门槛，必须由核心冻结和绑定新增要求，再独立验收；不能把本函数的任意 caller assertions 升格为已满足玩家需求。

### 取消与迟到结果

验证器已有 cancel/cancelAll/截止的 halt 路径传播 AbortSignal。收集器对每个 transport promise 做取消竞速，取消后不再发下一动作、不追加迟到记录。已发出的动作可能在隔离实例关闭前短暂继续，实例由验证器 finally 正常退出并销毁。不会向正式存档发送取消/恢复操作。补上 `!halted` 总通过条件，防止基础断言已经完成但扩展期间被取消的 check 仍返回 passed。

### 验收

```powershell
node --test tests/godot-scenario-collector.test.mjs tests/godot-scenario-verdict.test.mjs
$env:CRAFTMINE_GODOT_CACHE_DIR='D:/Craftmine World/desktop/build/godot/4.7.2-stable'
node tests/godot-scenario-collector-web.mjs
```

Web 入口使用固定引擎真实导出、独立 Chromium headless profile，并在初始化时禁用 Pointer Lock/focus；全部动作走运行桥，没有 Playwright 输入模拟。覆盖正常门、碰撞负例、实际 walk 期间取消，以及切换到第二个真实 runtime 后不得向新实例继续发送动作。

随后编译并启动独立隐藏 Electron 程序，直接执行当前生产 `GodotBuildVerifier` 与固定 preload，覆盖默认关闭、成功诊断、失败诊断、取消和原权威检查失败。正常/失败扩展诊断都不能改变原六项通过；取消必须失败；原快照格式失败不能被诊断通过替代，甚至不会调用选择器。正式错误早于 guard 采样时，guard 未验部分保留为空，不把这种预期拒绝记为完整隔离验收。

这些是实际 Web/offscreen 引擎与生产类验证，descriptor 是明确标记的可信 authored fixture。没有运行 Rust 发放/finish、真实候选注册/自动采用、Windows 安装包或真实玩家模型，因此仍不能宣称整条正式候选链已交付。
