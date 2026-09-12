# GU6 性能观察切片（2026-09-12）

最新进展：完整封存包 `56b5aeca` 已完成真实 Core、生产插件 IPC 注册工具及完整客户端冷重开验收，见 [完整产品证据](../vendor/pi-desktop/docs/spec/godot-performance-product-acceptance.md)。下文保留此前逐层验证的范围；早期夹具不能代替这份后续产品证据，产品通过也不代表规模优化完成。

## 已实现

新增 `plugins/craftmine-world/godot-performance-observation.mjs`，提供只读的身份绑定投影。观察必须同时匹配 `worldId/buildId/instanceId`，否则拒绝；数值必须是非负有限数。输出固定字段的 `measured/unknown` 状态和 `measurementHash`，不会把缺失数据补成零。

当前生产接线仅测量 Godot 所在 renderer 的 OS 进程工作集（`memoryWorkingSetMb`，单位 **MiB**），来源为 Electron `app.getAppMetrics()`。这是整个进程的内存，包括运行时开销，不能视为世界独占内存、JS heap 或 GPU 内存。引擎主循环、物理耗时、对象数及 GPU 耗时没有可信采样通道，全部保持 `unknown`。下述 scratch 引擎实验是另一条开发测量路径，不能代替当前模型工具的实时数据。

## 宿主与模型工具接线修正

本轮审计发现此前工具注册没有同时交付完整能力：投影文件未包含在正式插件产物中；实例比较使用样本自身的 ID；调用先打开 workspace 并可能取消其他作业；性能 provider 未登记到能力依赖。这些问题已修正：

- `GodotWorldViewHost.performanceProcess` 提供当前实例的 PID 和 WebContents ID，宿主在 OS 采样前后核对世界、构建、实例、PID、WebContents，过渡中拒绝采样。
- `craftmine.godotPerformance` RPC 限定 Craftmine 插件，`main.cjs` 将实际存在的 provider 传给工具；能力报告在 provider 缺失时显示不可用，未知接线显示未知。
- 工具从 `task.context` 取得世界，复核当前正式构建和独立 live 实例。30 秒以前或超前超过 5 秒的测量不会作为当前数据；这是采样新鲜度条件，不是玩家任务时长限制。
- 最后一次 Core 复核之后，宿主按已确认的实例 ID 再采样，随后直接返回该次结果；同构建在 Core 读取期间重启也会被拒绝，避免返回旧 renderer 读数。
- 工具只读，不打开 workspace、不读 UI 选中世界、不取消其他作业，不返回存档体。每次异步返回后检查 turn 是否结束。
- 打包后的生产 broker 测试实际加载投影文件并调用工具，覆盖切换实例、任务世界和构建、失效数据、取消、无 provider 和能力报告。

当前源码和测试接通了上述路径。实际 Godot Web 导出也已通过生产宿主、live adapter、OS sampler 与打包后 broker 的组合验证；Core/task 描述与快照存储为夹具，没有运行插件 IPC、完整封存桌面包或玩家模型。

## 4.7.2 实测

使用现有 `desktop/delivery/measure.mjs frame`，独立 scratch 项目、独立导入目录、Godot 4.7.2 stable headless，未触碰用户 profile 或输入。一次 300 帧运行结果保存在 `test-results/gu6-performance-frame.json`：

- `frame.time.ms`: 300 个真实引擎样本，p50 **6.899 ms**、p95 **6.964 ms**、最大 **6.997 ms**，阈值 16.67 ms，结果 pass。
- 这是空白 top-down authored scene 的 headless 主循环指标；不代表渲染帧率或 GPU 性能。
- 当前 runtime 没有安全的同一实例对象计数/物理步长/GPU 读取接口，因此这些字段在投影中为 `unknown`。不能把单次空场景读数称为优化收益。

建筑 A/B 的真实对照仍需把对象计数和实例标签作为同版本 runtime 事件发布后才能进行；在接口补齐前保持 unknown，比伪造对照更可靠。

## 验证

`node --test tests/godot-agent/performance-broker.test.mjs tests/godot-agent/godot-performance-observation.test.mjs tests/godot-round3/S6/tool-services.test.mjs tests/godot-round3/S6/live-and-execution-wiring.test.mjs vendor/pi-desktop/apps/desktop/test/craftmine-performance-sample.test.mjs`：42/42 通过。broker/Core 返回使用受控替身，此检查不构成玩家性能基准。

总控另运行生产宿主采样器与独立无窗口 Electron renderer，真实测得工作集 **61.09765625 MiB**，窗口、输入事件、焦点事件均为 0。报告归档到 `docs/evidence/gu6-performance-host-20260912/report.json`。这份测试页面是最小 HTML，**没有运行 Godot 游戏**；真实 Godot 组合验证另见下节。桌面 `pnpm exec tsc --noEmit` 通过。仍需完整客户端链路、玩家规模、三次同条件采样及保语义优化回归。

## 实际 Godot 与打包工具的组合验证

总控在提交 `9f6cce6c21a3f52996cfd2cade575839b7b25e94` 的干净源码构建插件，运行 `vendor/pi-desktop/apps/desktop/test/craftmine-performance-godot.mjs`，输入既有固定 collision-v2 Web 导出。结果归档于 `docs/evidence/gu6-performance-host-20260912/godot-broker-report.json`。

- 两次独立 Electron 进程、各自测试 profile 中，真实 Godot 实例运行、暂停后采样；broker 最终输出与同次真实宿主内存测量相等，分别为 **402.23046875 MiB**、**398.87109375 MiB**。它们是运行时进程读数，不是性能提升或工作负载对照。
- 冷重开产生不同实例，原始存档快照在本地文件夹具中完整保持；旧实例的请求与旧样本经 sampler/broker 拒绝。采样期间真实 dispose 也拒绝迟到结果。
- 源导出文件的字节数与 SHA-256 在运行前后验证不变；owner 窗口始终隐藏且不可聚焦，输入、Pointer Lock、focus 计数均为 0。
- 使用生产 GodotWorldViewHost、宿主采样器、打包后的 live adapter 和 broker；**Core 的 task/runtime 描述、本地文件快照持久化是夹具**，因此不是 Core 正式存档、插件 RPC 或完整客户端验收。

8 项真实 Core 构建工具回归也通过（`test-results/godot-build-tools-jJWSHg`），但那是独立回归组，不能与上述夹具组合宣称真实 Core 性能闭环。GA24 仍未证明：引擎指标采集、玩家规模的同条件测量和保语义优化均需继续开发。

独立只读复审确认 `97cf43b7` 关闭同构建重启竞态，未发现新的阻断问题。另一次真实 Godot 组合测试记录并断言两次采样参数：先 world/build，再 world/build/instance；最后一次宿主样本与 broker 输出完全一致，归档在 `vendor/pi-desktop/docs/evidence/gu6-packed-godot-performance-20260912/final-instance-report.json`。
