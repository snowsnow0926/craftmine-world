# GU4 有限场景判定内核与门碰撞切片

日期：2026-09-12。状态：隔离原型已实现；当前只接入可信原生 headless 夹具。没有注册新 Agent 工具，没有改变生产候选采用或正式存档路径。

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

当前可证明真实关闭阻挡、正常互动开启、打开后通行，以及自报开启而保留碰撞的负例可被检出。仍未证明渲染画面质量、Web 成品、玩家体验、钥匙条件、宝箱一次性奖励/冷重开、生产候选服务权限与取消，或 Agent 自主使用。这是 GU4 的 GA11/GA20 子切片，不能标记整项或完整 GU4 已交付。
