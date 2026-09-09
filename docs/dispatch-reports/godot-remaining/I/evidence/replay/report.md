# 真实模型验收报告（任务 I）

- 生成时间：2026-09-09T16:59:11.970Z
- 模式：replay
- 冻结校验：通过（ok）
- 身份摘要：product=replay-fixture engine=replay-fixture base=replay-fixture model=replay-fixture

## 汇总（不得只看通过数）

- 轮次：28，通过 6，失败 0，证据不足 1，尚未执行 21
- 真实模型调用：0；用量未知调用：0
- 人工介入：0
- 故事台账：已证实 0，失败 0，尚未执行 48，证据不足 2

## 逐轮结果

| 轮次 | 类别 | 判定 | 原因 | 证据 |
| --- | --- | --- | --- | --- |
| R01.1 | R01 | passed |  | evidence/R01.1 |
| R01.2 | R01 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R01.2.json | — |
| R02.1 | R02 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R02.1.json | — |
| R02.2 | R02 | passed |  | evidence/R02.2 |
| R03.1 | R03 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R03.1.json | — |
| R03.2 | R03 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R03.2.json | — |
| R04.1 | R04 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R04.1.json | — |
| R04.2 | R04 | passed |  | evidence/R04.2 |
| R05.1 | R05 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R05.1.json | — |
| R05.2 | R05 | passed |  | evidence/R05.2 |
| R06.1 | R06 | passed |  | evidence/R06.1 |
| R06.2 | R06 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R06.2.json | — |
| R07.1 | R07 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R07.1.json | — |
| R07.2 | R07 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R07.2.json | — |
| R08.1 | R08 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R08.1.json | — |
| R08.2 | R08 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R08.2.json | — |
| R09.1 | R09 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R09.1.json | — |
| R09.2 | R09 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R09.2.json | — |
| R10.1 | R10 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R10.1.json | — |
| R10.2 | R10 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R10.2.json | — |
| R11.1 | R11 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R11.1.json | — |
| R11.2 | R11 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R11.2.json | — |
| R12.1 | R12 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R12.1.json | — |
| R12.2 | R12 | passed |  | evidence/R12.2 |
| R13.1 | R13 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R13.1.json | — |
| R13.2 | R13 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R13.2.json | — |
| R14.1 | R14 | not-run | no replay fixture at D:\Craftmine World-worktrees\godot-remaining-i-20260910\tests\godot-remaining\I\fixtures\replay\R14.1.json | — |
| R14.2 | R14 | insufficient | missing evidence: I.R14.2.4/human-review | evidence/R14.2 |

## 尚未执行 / 被依赖阻断

- R01.2（依赖：E, D）
- R02.1（依赖：L, F, C）
- R03.1（依赖：A, D, H, L）
- R03.2（依赖：A, D, H, L）
- R04.1（依赖：E, F, L, C）
- R05.1（依赖：H, A, E, L）
- R06.2（依赖：L, A, E）
- R07.1（依赖：H, F, A, E）
- R07.2（依赖：H, F, A, E）
- R08.1（依赖：A, B, C, D, H）
- R08.2（依赖：A, B, C, D, H）
- R09.1（依赖：F, G）
- R09.2（依赖：G, F, H, A）
- R10.1（依赖：L, A, C）
- R10.2（依赖：L, A, C, H）
- R11.1（依赖：M, A, C, D, H）
- R11.2（依赖：M, A, C, D, H）
- R12.1（依赖：N, H, L, C, D）
- R13.1（依赖：L, A, C）
- R13.2（依赖：A, L, C, D）
- R14.1（依赖：K, root）

## 台账

| 编号 | 状态 | 关联轮次 | 原因 |
| --- | --- | --- | --- |
| A01 | 尚未执行 | R01.1 R01.2 | 尚未执行 |
| A02 | 尚未执行 | R01.2 | 尚未执行 |
| A03 | 尚未执行 | R02.1 | 尚未执行 |
| A04 | 尚未执行 | R02.2 | 仅有 replay 证据，真实模型尚未执行 |
| A05 | 尚未执行 | R03.1 R03.2 | 尚未执行 |
| A06 | 尚未执行 | R04.1 | 尚未执行 |
| A07 | 尚未执行 | R04.2 | 仅有 replay 证据，真实模型尚未执行 |
| A08 | 尚未执行 | R05.1 | 尚未执行 |
| A09 | 尚未执行 | R05.2 | 仅有 replay 证据，真实模型尚未执行 |
| A10 | 尚未执行 | R06.1 | 仅有 replay 证据，真实模型尚未执行 |
| A11 | 尚未执行 | R06.2 | 尚未执行 |
| A12 | 尚未执行 | R06.2 | 尚未执行 |
| A13 | 尚未执行 | R07.1 R07.2 | 尚未执行 |
| A14 | 尚未执行 | R08.1 R08.2 | 尚未执行 |
| A15 | 尚未执行 | R09.1 | 尚未执行 |
| A16 | 尚未执行 | R09.2 | 尚未执行 |
| A17 | 证据不足 | R14.1 R14.2 | 存在证据不足的轮次 |
| V01 | 尚未执行 | R11.1 | 尚未执行 |
| V02 | 尚未执行 | R11.2 | 尚未执行 |
| V03 | 尚未执行 | R11.2 | 尚未执行 |
| V04 | 尚未执行 | R11.1 | 尚未执行 |
| V05 | 尚未执行 | R11.1 | 尚未执行 |
| V06 | 尚未执行 | R11.2 | 尚未执行 |
| V07 | 尚未执行 | R11.2 | 尚未执行 |
| V08 | 尚未执行 | R11.2 | 尚未执行 |
| V09 | 尚未执行 | R11.2 | 尚未执行 |
| V10 | 尚未执行 | R11.2 | 尚未执行 |
| V11 | 尚未执行 | R11.2 | 尚未执行 |
| V12 | 尚未执行 | R11.2 | 尚未执行 |
| V13 | 尚未执行 | R11.2 | 尚未执行 |
| V14 | 尚未执行 | R11.2 | 尚未执行 |
| V15 | 尚未执行 | R11.2 | 尚未执行 |
| V16 | 尚未执行 | R11.2 | 尚未执行 |
| AL-A01 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A02 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A03 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A04 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A05 | 尚未执行 | R12.2 | 仅有 replay 证据，真实模型尚未执行 |
| AL-A06 | 尚未执行 | R12.2 | 仅有 replay 证据，真实模型尚未执行 |
| AL-A07 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A08 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A09 | 尚未执行 | R12.2 | 仅有 replay 证据，真实模型尚未执行 |
| AL-A10 | 尚未执行 | R12.2 | 仅有 replay 证据，真实模型尚未执行 |
| AL-A11 | 尚未执行 | R12.2 | 仅有 replay 证据，真实模型尚未执行 |
| AL-A12 | 尚未执行 | R12.2 | 仅有 replay 证据，真实模型尚未执行 |
| AL-A13 | 尚未执行 | R12.2 | 仅有 replay 证据，真实模型尚未执行 |
| AL-A14 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A15 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A16 | 尚未执行 | R12.2 | 仅有 replay 证据，真实模型尚未执行 |
| AL-A17 | 证据不足 | R14.2 | 存在证据不足的轮次 |

## 备注

- 冻结校验：通过；来源文档漂移 0 项。
- 覆盖检查：14 类 / 28 轮 / 128 条断言。
- replay 只证明验收器本身；它不构成任何真实模型结论。
