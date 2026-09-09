# ADR S6｜实时观察与预算只经正式服务接线，缺口对模型可见

状态：本轮 S6 实现；vendor 侧对应 `vendor/pi-desktop/docs/adr/dispatch-s6-live-observation-bridge.md`。

## 背景

第二轮审计发现工具层已接受 `sampleLiveState`/`budget`/`isDiscussionOnly`，但 `plugins/craftmine-world/main.cjs` 构造时未传第六参数，正式产品里 `godot_runtime_state scope=live` 恒为 `LIVE_OBSERVATION_NOT_WIRED`；模型 `godot_build_start` 产生的排队作业没有交给托管执行器。

## 决定

1. 新增 S6 独占的 `tool-services.cjs` 作为唯一契约：每个提供方声明 `owner/hostMethod/requiredFor`；类型错误在构造期失败，未接线在运行期如实报 unknown。
2. 实时样本只来自宿主 `craftmine.godotLiveState`（正式实例的 `observe-envelope` + 宿主身份 + 共享模式校验），插件二次校验身份后展平；进度正文、跨世界/构建/实例、超时样本一律拒绝。
3. 七类限额直接读本任务耐久行 `budget.inspect`，不再增加第二个宿主通道；`context/service/resource` 无计数则 unknown，任务接续沿用同一 `ownerTaskId`。
4. 执行器门禁与作业交接使用进程内 `godotExecutor`；无提供方时回报缺口与 owner，不静默跳过。
5. `godot_capability_report.services` 暴露实际接线状态，使“缺哪个提供方、归谁、缺哪个宿主方法”成为模型与验收都能读到的机器事实。

## 影响

- 模型不能把存档当实时状态、把缺失计数当 0、把排队作业当已执行。
- 宿主新增一个受 `craftmine.world` 门禁的只读能力，不新增权限、令牌或进程。
- 未接通项（`asset.*`/`package.*`/`content.*` 登记、`godotJob.pending`、真实模型与真实实例）保持明确未完成，不用测试数字顶替。
