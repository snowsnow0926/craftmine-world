# J｜L3 候选部件档案（方案与证据状态）

任务标识：`J-20260910`。这份文档是**候选方案**，不是已完成实现。
每条候选都要先过 `desktop/godot/extensions/candidate.mjs` 的闸门；闸门结论由
`node tests/godot-remaining/J/gates.mjs` 可复现地打印出来。

## 1 结论先说

截至 2026-09-10，**没有任何一条候选达到 `evidence-ready`**。原因是可核对的：
GD7 可用基线尚未交付，真实模型创作（GD3–GD5）还没有跑过，因此"高频缺口"缺少
实测基线。两条候选都停在 `hypothesis`，闸门给出的失败项是
`证据可确认 / 冻结输入 / 当前基线实测 / 预算声明`（见
[evidence/gates-run.txt](evidence/gates-run.txt)）。

这不是推诿：如果现在就写一个原生部件，唯一能证明的只是"能装上"，而不是"解决了真实问题"。
总计划对 GD8 的要求正是"依据实际高频缺口选择少量 L3 部件扩展"。

## 2 选候选的流程

1. 从真实失败与真实测量里找重复出现的瓶颈，而不是从"听起来很底层"找。
2. 先尝试 L0–L2 解法（普通脚本/场景/资源/可复用扩展），并留下对照数据。
3. 只有当 L2 解法在**冻结阈值**内明确不达标时，才写 L3 候选档案。
4. 档案必须齐备：问题、证据（可解析哈希）、冻结输入（含复现命令）、当前基线实测、
   候选接口、预算、回退方案、止损条件、下一步入口。
5. 闸门未通过 → 不允许实现；闸门通过且 GD7 + I 冻结评测就绪 → 才进入实现与专项验证。

## 3 候选 J-L3-01：`world-snapshot-stream`（perfComponent）

| 项 | 内容 |
| --- | --- |
| 现状证据 | 完整进度正文被绑成单个文档交给 Rust 校验（`craftmine.godot-progress/1`，见 [GODOT_CYCLE_05.md](../../GODOT_CYCLE_05.md)）；状态按稳定实体 id 存在字典里（`top-down/core/scripts/world_state.gd`） |
| 缺失能力（假设） | 实体/任务/库存规模上升后，一次性序列化的耗时与内存峰值是否超阈值——**尚未测量** |
| 候选接口 | `step(ctx: Dictionary) -> Dictionary`（`perfComponent`），只做快照/增量写盘，不改存档协议 |
| 兼容要求 | 引擎 `4.7.2-stable`、宿主 ABI `1`、底座与 `stateFormat` 精确匹配；存档协议属于越界项，本候选不得修改 |
| 性能预算 | `frameMsP95`、`memoryBytes`、`packageBytes` 全部待 GD7 实测后填写（当前为 `null`，闸门因此判 `not-ready`） |
| 回退方案 | 卸载即回内置 `default`；`PartRegistry` 保留上一版本供 `rollback` |
| 止损条件 | GD7 最大支持世界规模下保存 p95 仍低于冻结阈值，或普通 GDScript 分块写盘即达标 → 候选作废并降级为 L1 |
| 下一步入口 | 用 GD7 固定包采集 `saveMsP95` / 内存峰值，回填 `evidence`、`frozenInput`、`currentBaseline` |

档案原文：`tests/godot-remaining/J/fixtures/l3-candidates.json`。

## 4 候选 J-L3-02：`collision-shape-batcher`（perfComponent）

| 项 | 内容 |
| --- | --- |
| 现状证据 | 碰撞按每个最大水平连续段生成一个 `RectangleShape2D`（`top-down/core/scripts/map_renderer.gd` 的 `_build_collision`），并且 `build_report` 已经统计 `collisionShapes`，天然可测 |
| 缺失能力（假设） | 大图上形状数量随行数线性增长，是否拖慢加载/内存——**尚未测量** |
| 候选接口 | `step(ctx: Dictionary) -> Dictionary`（`perfComponent`），只合并/批处理碰撞形状 |
| 兼容要求 | 同 J-L3-01；不得改变碰撞语义（不能为了少几个形状让墙变可穿） |
| 性能预算 | `frameMsP95`、`memoryBytes`、`packageBytes` 待实测填写 |
| 回退方案 | 内置 `default` 原样构建；`rollback` 回到上一版本 |
| 止损条件 | 一次普通 GDScript 纵向合并即可把形状数与加载耗时降到冻结阈值内 → 判为 L1 并关闭候选 |
| 下一步入口 | 在 GD7 固定包上采集 `collisionShapes`、加载耗时、内存，并先做纯 GDScript 合并对照 |

## 5 被否掉的候选（避免以后重复提出）

| 提案 | 判定 | 依据 |
| --- | --- | --- |
| "原生瓦片批量渲染器" | 否，L0/L1 | 底座已用真实 `TileMapLayer`，没有逐格脚本绘制 |
| "原生确定性步进" | 否，L1 | 引擎 `--fixed-fps` 已满足，见 `scripted_input_source.gd:4` |
| "原生准星渲染" | 否，L1 | `crosshair.gd:112` 的绘制量极小 |
| "原生资源导入器" | 否，L2 | `EditorImportPlugin` 可用 GDScript 实现 |
| "改引擎内核让权限拒绝可分辨" | 越界 | 属于 B/C/K 的隔离与专项验证范围，不属于普通创作路径 |

## 6 需要 GD7 与 I 提供什么，候选才能推进

1. **GD7**：固定包 + 同包验收 + 可复现的运行环境，用来采集真实基线（否则 `currentBaseline` 只能填 null）。
2. **I**：冻结的需求集与评分契约哈希（否则 L4 对照无意义，见 [J_L4_STRATEGY_EXPERIMENT.md](J_L4_STRATEGY_EXPERIMENT.md)）。
3. **K**：预算阈值来源与实测方法（帧时间、内存、包体的采样口径），以及发行许可结论。
4. **B/C**：如果候选最终确认为 `native: true`，需要专项验证记录 `{by, at, harness}`。

在上述输入到位之前，本任务只交付**可消费的接口与闸门**，不交付 L3 部件实现。
