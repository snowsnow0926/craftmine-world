# 造物连续任务的基础工具目录

## PI Godot source index amendment (2026-09-14)

After authoritative host facts identify a Godot world, the initial PI tool
profile also includes the existing registered `godot_project_index` read tool.
Project/source guidance already requires its revision and manifest hashes; the
first call must not fail merely because ToolSearch has not activated it yet.
Expose the actual host-supplied manifest schema unchanged: `limit` is an integer
from 1 through 32, default 32, and `nextOffset` is used for pagination.

This adds no tool implementation or authority. An unregistered tool stays absent;
legacy and unknown runtime profiles do not receive it automatically. Summary,
review and finished-task closeout remain tool-free. The executor's offered tools
and the provider request schema remain identical. Codex has its independent
tool list and is unchanged by this PI-only profile amendment.

## Embedded Blender first-call availability (2026-09-14)

The same authoritative Godot profile includes registered `blender_generate` and
`blender_job_read` beside the existing `blender_status`. Retained conversations
refer to these ordinary modeling actions before a new turn has rediscovered
them. Expose their actual host-supplied parameter schemas on the first request;
do not require a redundant ToolSearch round merely to activate known tools.

This only changes discoverability. Generation remains the existing asynchronous
host-bound action with its original authorization, exact revision/manifest and
expected-hash requirements. Reading a job retains the original world/ownership
checks. No tool is invented when the host has not registered it, no other deferred
Blender actions are activated, and no model argument can authorize a write.
Legacy/unknown worlds, summaries, reviews and finished-task closeout do not gain
these initial tools. Codex's independent tool profile is unchanged.

每个模型请求先读取宿主当前任务快照。Rust 在现有绑定世界摘要中投影 `runtimeKind` 与 `baseId`，不根据玩家文字、构建 ID 前缀、目标快照或旧会话推测运行时，也不额外读取完整世界。

确认 Godot 后，基础目录加入已注册的 `godot_file_read`、`godot_project_query`、`godot_project_patch`，保留工程事实、能力报告、指导和检查入口；legacy 的 `project_inspect`、`capabilities_read` 改为按需发现。确认 legacy 时使用其两项检查入口，Godot 工具按需发现。运行时未知保持原来的保守目录，不自动增加源码修改工具。

工具集合只与宿主已提供的实际定义求交，在预算估算之前同时更新 PI 执行器与供应商请求。任务或世界运行时变化时重建目录并清除旧的延迟激活状态；每轮重置、压缩和运行时重建后重新读取权威身份。摘要、评审和已结束任务收尾不提供工具。原有世界作用域、任务租约、预算、源码身份和采用权限保持由宿主检查，新增 schema 不产生权限。

已展示的工具可以直接调用，额外工具才使用 ToolSearch。引擎文档、实时采样、作业控制、素材与包库仍按需发现。

验收：原生 PI 循环无需 ToolSearch 即可调用读取、修改、检查；没有注册的名称不出现，执行器集合与供应商 schema 一致。覆盖 Godot/legacy/未知世界切换、提示重置、压缩摘要、任务结束和进程重建；通用 Bash/Task 权限不扩展。
