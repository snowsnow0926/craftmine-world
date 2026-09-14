# Local six-stage ordinary-library acceptance

This is a zero-model functional acceptance route while the provider is unavailable. It does not prove DeepSeek selected or authored anything autonomously. Run it only when the native/GPU owner has released the lane.

```powershell
$env:CRAFTMINE_CREATION_OUTPUT_ROOT='D:/cm-promo-six-local'
node tests/direct-library-native.mjs --application-root 'ABSOLUTE_CHECKOUT' --packaged-root 'ABSOLUTE_SEALED_WIN_UNPACKED' --scenario promo-six-stage
```

`--resources` may explicitly name that exact package's `resources` directory; other resources are refused for this scenario. The launcher verifies the real executable, package inventory and headless/pointer guards. It uses a new isolated profile, no provider credentials and no user-profile copy.

The actual PI New World form creates a blank creation-sandbox world. The existing asset sheet selects and inspects the packaged broadleaf, meadow, hornlings, heavyblade, hunt and AK47 in that order, then uses its normal check/apply forms. The driver reads the sealed base's actual ground/camera source and verifies six ZIP hashes/root hashes before launch. The placement is limited to that verified 64 m floor: the tree lies outside the arena, the translated monster activity footprint stays on the floor, and the 22 by 28 m hunt footprint remains subject to the product's real physics guard.

Each adopted stage records the operation and exact asset/version reference, source revision/hash, independently assigned instance IDs, frozen before/after component and player progress, and a bound formal-view screenshot. It uses existing engine-only walk/look and normal J/H/2/B/R/3 input segments to inspect sword hits, beast attacks, rifle damage/ammunition and reload. It does not write source, coordinates, DB rows or snapshots. A failed action, release, save or capture remains explicit evidence and stops acceptance. Input records are written before post-input save so that a save failure cannot erase an already executed action.

The final save and normal shutdown are followed by a cold reopen through the ordinary world chooser; formal build, source IDs, all six durable applied operations and complete progress are compared. A failed cold equality is retained for diagnosis rather than silently relaxing the comparison. Cancellation uses the printed `cancel` file or SIGINT and releases active engine inputs before normal shutdown.

The legacy two-companion/cancellation scenario remains the default. The six-stage branch does not run those unrelated tests. Offline checks:

```powershell
node --check tests/direct-library-native.mjs
node --test tests/direct-library-promo-scenario.test.mjs
```
# 保存迁移与运行采样边界补充

LuT318 原报告在加入重剑后发现 6 只角怪位置变化约 0.806–0.845 米。原报告与截图保留。
只读 Core 的实际 applied application 表确认：应用前 previous_world、迁移输入与真实候选保存回执 output.snapshot 中，8 个旧组件和玩家状态完全相等；变化出现在后续关闭面板、恢复模拟和再次 freeze 之间。3 次 look 也确有物理计数前进，不能视为零模拟操作。

新的测试保留每阶段原 before/after live freeze、时序、截图与实际 physicsTick。所有阶段应用完成并正常关闭程序后，使用只读 SQLite 按 world/candidate/build/status 匹配唯一应用记录，对旧组件全部字段、玩家及已有世界进度严格比较，允许新增组件；没有 pose 容差。应用或迁移把旧位置、yaw、血量重置仍会失败。

冷开分别验证关闭后 Core 存档与关闭前冻结存档逐字段相等、新实例同 build、真实画面、来源实例及 applied 引用。冷开后的原始完整 snapshot 与完整差异仍记录。native 已经过物理帧时，角怪位置/yaw、玩家位置/落地状态、空闲重剑耐力和恢复计时、枪械冷却/换弹计时只标记精确恢复值未证实；其余字段（包括生命、身份、配置、库存）仍严格比较。未观测到物理帧却变化则报错。不得将此范围表述为零帧 native 完整状态恢复全部通过；现有 CPU 严格恢复验证只能互补。
