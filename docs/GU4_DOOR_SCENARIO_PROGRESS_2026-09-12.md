# GU4 首个门碰撞切片

实施工作树：`D:/cm-gu4-scenario-0912`，分支 `codex/gu4-scenario-20260912`，起点 `d25e2911`。只增加有限场景内核、可信夹具、验证与文档；没有改生产 Agent 工具或采用流程。

## 已完成的证据

- 新增内核 9 项纯逻辑测试，以及既有探索 8 项回归，共 17 项通过。
- `godot-scenario-verdict.ts` 使用项目 TypeScript 5.9.3、Node 类型 24.13.3，按 strict 模式单文件检查通过；不是全桌面类型检查。
- 实际引擎 `4.7.2.stable.official.ed1daf0bf`。现有固定工具链校验通过，每个变体均完成导入、独立 GDScript 解析与真实物理运行。
- 冻结场景需求 SHA-256：`e55e23c92c20583b1ead0cef802daca424177b31789f244e14c396cfd282c2f2`。

| 观测 | 正常夹具 | 自报开门但保留碰撞 |
|---|---|---|
| 关门行走后玩家 Z | 0.550026595592499 | 0.550026595592499 |
| 正常射线互动 | 命中 gate | 命中 gate |
| 项目开门自报 | true | true |
| 固定 observer 实际 solid | false | true |
| 再次前行后玩家 Z | -5.92997121810913 | 0.550026595592499 |
| 12 条断言 | 全通过 | 碰撞释放、实际开门、通行三项失败 |
| 判定 | passed | failed，符合负例预期 |

完整原始证据在 `D:/cm-gu4-scenario-0912/test-results/godot-door-scenario-ICCkrx`，包括 `report.json`、两个变体逐步 transcript、verdict、完整源码清单、导入/解析/运行日志。引擎、profile、项目均在该独立目录内。

正常夹具源码清单哈希：`81e755b537d9963ce91b417d4648cc232a8ad27d5a838d99f8e200988dface14`；负例：`784320814d5e79b74d6f351124e52b416f10aeb52443ecb877f17259031427a6`。哈希覆盖完整已物化工程与固定驱动，不仅是发生注入的世界脚本。

初轮 `godot-door-scenario-YLhBip` 已跑通两个实际变体；随后扩大身份清单到完整源码、增加固定 observer 开门几何断言，重跑产生上述最终证据。类型检查首次因定位不到 Node 类型定义中断；改用已有 pnpm 中真实类型目录后通过，没有改代码绕过类型约束。这些初始记录保留。

## 交付边界

这是 GU4 的 GA11/GA20 子切片：真实控制器关闭阻挡、正常射线开门、实际通行，以及不能靠项目自报通过。尚未接入候选作业与 Agent 工具，没有新安装包、Web 验证、截图视觉验收、钥匙门、一次性奖励冷重开或玩家模型任务。本次没有模型调用或真实鼠标、键盘、前台焦点、Pointer Lock 操作。

后续先固定候选/需求/源码/运行身份和可信收集器，再接入原作业体系；不得直接把可改状态的动作开放到正式世界，也不能把通用内核当作对任意项目数据的反作弊保证。

协议与可复现命令见 [有限场景说明](../vendor/pi-desktop/docs/spec/godot-finite-scenario-verdict.md)。

## 第二切片：可选生产诊断收集接口

从第一切片提交 `d6776be3` 继续，增加 `godot-scenario-collector.ts` 和生产 `GodotBuildVerifier` 构造器的可选 `scenarioDiagnostics`。选择器仅宿主进程可配置，默认关闭，计划来自宿主，运行实例来自当前已验证 descriptor 的独立 check。只读采样加 walk/look/wait/interact，没有正式进度写入、任意路径或代码 API。

诊断绑定 job/inputHash/world/build/instance 与单独的冻结需求哈希，返回 passed/failed/inconclusive；只保留断言所需有限标量。它不进入权威 assertions，也不作为 candidate readiness 依据。原取消/截止信号传播到 pending 动作；补上总结果 `!halted`，避免在基础断言完成后被取消的任务仍然通过。

### 最终验收

- 32 项 collector、判定、探索和实际 verifier 类模拟回归通过。
- 完整桌面 `tsc -p tsconfig.json --noEmit` 通过；复用主树已安装依赖的只读 junction。
- 固定 Godot `4.7.2.stable.official.ed1daf0bf` 真实 Web 导入、导出、独立 headless Chromium 通过；5 个实际 runtime 页面观察的 Pointer Lock/focus 调用均为 0。
- 最终 Web/集成报告：`D:/cm-gu4-scenario-0912/test-results/godot-scenario-collector-web-c9o8bb/report.json`。
- 当前生产验证器隐藏 offscreen 报告：同目录下 `offscreen-tCqfKD/offscreen-report.json`。
- 本批冻结 Web 需求 SHA-256：`7801e46bad39e9e25f106207e4a5c7b8389d4e6f478e1e23c68a52dcb1f4637e`。

| 实际场景 | 返回结果 | 证据边界 |
|---|---|---|
| Web 正常门 | diagnostic passed | 实际关门阻挡、射线互动、开门通行 |
| Web 保留碰撞 | diagnostic failed | 固定观察及实际通行失败 |
| 实际 walk 中取消 | inconclusive / SCENARIO_CANCELLED | 不再发 interact，旧 pending 回复不追加 |
| 切到第二个真实 runtime | inconclusive / IDENTITY_CHANGED | 新实例未收到后续动作且初始位置不变 |
| 生产 verifier 默认关闭 | 基础 passed，无 diagnostic | 兼容原路径 |
| 生产 verifier 成功诊断 | 基础 passed，diagnostic passed | 诊断没有新增权威断言 |
| 生产 verifier 失败诊断 | 基础 passed，diagnostic failed | 扩展失败只作诊断，不冒充核心玩法门槛 |
| 生产 verifier 收集中取消 | 基础 failed，diagnostic inconclusive | error=GODOT_CHECK_CANCELLED，正常清理 |
| 生产 verifier 原快照格式错误 | 基础 failed，没有调用选择器 | 不能靠扩展计划覆盖原失败 |

最后一项在 guard 采样前已按预期拒绝，因此 guard 保留未采样，不能把该项称为完整隔离检查通过；其窗口隐藏/不可聚焦和清理均有实际记录。其余 offscreen 运行隔离、零 guard 调用与清理检查通过。

准备过程保留：首次 Web provider 报告 `godot-scenario-collector-web-YBJusS` 已通过；新增 offscreen 的首轮 `godot-scenario-collector-web-Kb9aH6` 因测试错误地要求“早期快照拒绝也须有已采样 guard”而失败。纠正这个测试范围后，独立重跑和最终整套重跑均通过，没有弱化产品判定或覆盖原失败日志。首次需要现有 Electron 包自动补齐其缺失的固定版本二进制，未修改受测产品源码绕过环境问题。

该批仍是 authored descriptors 的生产类验收，未运行 Rust 发放/finish、候选注册与采用，也未启用普通产品默认诊断、持久查询或 Agent 调用。完整候选权限链与新增核心冻结要求留待后续；没有真实模型调用、玩家额外额度或真实输入操作。
