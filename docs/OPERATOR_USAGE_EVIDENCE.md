# 实际 Codex 创作耗时和 token 的提取口径

本说明只解释本项目当前代码和已落盘证据，不推算 ChatGPT 订阅账单，也不估算
美元成本。`tests/operator-usage-export.mjs` 是独立只读提取器，不导入操作驱动、
不连接应用、不调用模型、不改变模型或整轮预算。

```powershell
node tests/operator-usage-export.mjs `
  --report '当前 operator 报告的绝对路径.json' `
  --output '新的交付证据文件绝对路径.json' `
  --require-final
```

输出同名 JSON 与中文 Markdown。文件必须尚不存在，不能覆盖输入报告。
`--require-final` 仅检查证据是否完整：存在仍在运行的轮次、缺失/冲突的终态
usage 或读取中变化的文件时，保留带有缺失原因的报告并返回退出码 2；它不会
停止或限制正在运行的模型。请在人工轮和自动修复轮全部结束、主机完成落盘之后用于最终交付。

提取器读取所选报告及其 `previousReport` 链、同目录 `agent-events.ndjson`、
`session.json` 与 `turns/*.json`。所有输入保留 SHA-256、字节数、来源文件和
字段/事件行号。运行中日志的未完成末行不会冒充完整事件；最终汇总暂不生成。

## 字段含义

| 字段 | 当前代码中的含义 | 如何计数 |
|---|---|---|
| Codex 原始 `tokenUsage.total` | Codex 线程累计量，可能跨多个应用轮次 | 提取器不直接叠加，也不再次做差 |
| desktop `inputTokens` | 原始本轮输入差值，减去已报告的 cache read/write 后的输入，代码约定为未缓存输入 | 单独展示；若缓存字段缺失，不假定缓存就是 0 |
| `cacheReadTokens` | 本轮已报告缓存输入差值 | 已包含于提供方总量，不再加到 `totalTokens` |
| `cacheWriteTokens` | 本轮已报告缓存写入差值 | 缺失保留 null；明确报告 0 才是 0 |
| `outputTokens` | Codex 原始输出的本轮差值 | 保留原值，不另行加推理明细 |
| `reasoningTokens` | 来自 `reasoningOutputTokens` 的本轮明细 | 作为推理输出明细展示，不再加到总量 |
| `totalTokens` | Codex 原始总量减去已保存上一轮 baseline 的结果 | 每个 session/turn 只汇总一次，保留提供方原值 |
| `codexUsage.lastRequest` | 最后一次请求的 usage，用于上下文占用展示 | 不是额外一轮，更不能另计费用 |
| `transportUsage.scope=current-turn` | 当前轮到此刻的累计快照 | 后一张替代前一张，绝不把多张相加 |
| 终态消息的 `codexUsage.scope=current-turn` + `usage` | 整个当前应用轮次的汇总 | 优先取持久化消息，事件作为交叉核对；同一个汇总的副本去重 |

语义来源是
[codexTurnUsage 与 status/finish 处理](../vendor/pi-desktop/packages/agent-runtime/src/codex-desktop-runtime.ts)、
[UiMessage/MessageUsage 类型](../vendor/pi-desktop/packages/shared/src/types.ts) 和
[累计 baseline 回归测试](../vendor/pi-desktop/packages/agent-runtime/src/codex-desktop-runtime.test.ts)。
提取器消费的是该适配器已经归一化的本轮数值，不能再把上一轮扣除一次。

## 为什么主机 metrics 的 calls=0 不代表零模型调用

[主机记录器](../vendor/pi-desktop/apps/desktop/electron/main/task-metrics-recorder.ts)
只写入 `model_call` 事件。
[Rust 汇总](../vendor/pi-desktop/crates/host-core/src/task_metrics.rs) 在没有已报告
调用 usage 时返回 `coverage:"unknown"` 和 `usage:null`。当前 Codex 适配器
通过 transport usage 和终态消息提供 token，不因此制造逐次 `model_call` 记录。

所以 `observed:0, reported:0, coverage:"unknown"` 的导出结果是
`modelCalls.value:null`，不是 0。只有完整的逐调用主机记录才能输出该口径的
调用数。工具调用数、usage 更新次数、聊天气泡数都不是物理模型调用次数。

## 时间与恢复

耗时优先采用同一 session/turn 的主机 `wallTimeMs`，终态时对应真实主机
开始与结束边界。它包括该轮工具等待和澄清等时间，不是纯模型生成时间，也不
包含轮与轮之间人工审核、源码组件安装、采用和模板导出的全部操作耗时。

主机在恢复中断场景下会特意返回 `wallTimeMs:null`；即使存在开始/结束字段，
提取器也不会重新相减而抹掉这种不确定性。只有完全没有主机 metrics 时，才可
使用驱动记录的开始/完成时刻，并明确标为包含轮询延迟的操作侧观测时间。

没有主机metrics也没有驱动边界的事件发现轮，可用唯一`agent_start`与唯一
`agent_end`时间相减，标为`event-observed-turn-boundaries`；它是应用事件观测
口径，不伪称主机wallTime或纯模型耗时。多个不同开始/结束时间可能是恢复，
耗时保持null；已存在metrics且wallTime为null时仍不采用事件重建。

轮次以 `(sessionId,turnId)` 为唯一键，重复报告、冷启动保存的整会话副本、
重复状态和重复终态消息不重复累计。消息归属优先用事件中的精确 message ID；
缺少事件时使用持久化消息顺序，但遇到未知用户消息立即停止沿用上一轮归属。
同一轮出现互相矛盾的终态汇总时保留冲突，不能选择较大值或相加。

只要任何已观察轮次尚未结束，中文表格不显示该轮最终 token，且不产生
`finalAggregate`。JSON 中的 `lastObservedUsage` 明确标为 provisional，方便
诊断，不能当作完整创作总量。没有费用来源时 `cost.usd` 始终为 null。

## 全自动检查修复的轮次覆盖

`report.turns`只记录显式提交，不能作为完整轮数。提取器一直会从同一已知
session的事件包创建额外turn，因此自动修复即使没有manual report条目，仍
参与“运行中不得合计”和最终去重计算。终态用量仍须有精确turn事件归属的
`message_end`/持久化`codexUsage`消息及`agent_end`，不能拿最后一个transport
快照补成终值。不存在物理model_call账本时，调用次数仍为null。

补充覆盖保护：持久化的未知用户消息若所在消息区段只有一个精确事件turn
所有者，可将用户边界关联到该turn，记录原文件/字段及association；不根据
“自动”字样、时间接近程度或前一轮猜测。若下一自动轮刚创建而事件还没落盘，
未知用户消息本身会产生`UNMAPPED_SESSION_USER_TURN`并阻止人工轮小计被宣称
完整总量，即使这条消息尚未产生usage。多个事件所有者时同样保留未映射。

2026-09-14只读审计中，人工第四轮`eb3dfa3a-0a81-4467-b5af-e45c26f76a87`
终值为12,490,104 tokens；自动第五轮`1b35731f-8dbf-4e6c-a9ad-88a160ce3b58`
没有report.turns条目，但已由事件2290/2291开始边界发现。原提取器实际输出
5轮、4轮结束、finalAggregate=null，未漏掉正在运行的自动轮。本文不报告未
完成全流程的总量；最终导出应使用全部自动轮落盘后的新证据文件。
