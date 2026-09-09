# 真实模型验收报告（任务 I）

- 生成时间：2026-09-09T17:06:03.313Z
- 模式：replay
- 冻结校验：通过（ok）
- 身份摘要：product=replay-fixture engine=replay-fixture base=replay-fixture model=replay-fixture

## 汇总（不得只看通过数）

- 轮次：28，通过 0，失败 2，证据不足 0，尚未执行 26
- 真实模型调用：0；用量未知调用：0
- 人工介入：0
- 故事台账：已证实 0，失败 2，尚未执行 48，证据不足 0

## 逐轮结果

| 轮次 | 类别 | 判定 | 原因 | 证据 |
| --- | --- | --- | --- | --- |
| R01.1 | R01 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R01.1.json | — |
| R01.2 | R01 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R01.2.json | — |
| R02.1 | R02 | failed | I.R02.1.1: element 2 failed: expected <= 0.5, got 4; I.R02.1.2: expected true, got false; I.R02.1.3: expected length >= 4, got 2; missing evidence: I.R02.1.5/screenshot-artifact | evidence/R02.1 |
| R02.2 | R02 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R02.2.json | — |
| R03.1 | R03 | failed | I.R03.1.2: expected {} to equal progress.inventoryBefore ({"wood":4,"coin":12}); missing evidence: I.R03.1.5/screenshot-artifact | evidence/R03.1 |
| R03.2 | R03 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R03.2.json | — |
| R04.1 | R04 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R04.1.json | — |
| R04.2 | R04 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R04.2.json | — |
| R05.1 | R05 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R05.1.json | — |
| R05.2 | R05 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R05.2.json | — |
| R06.1 | R06 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R06.1.json | — |
| R06.2 | R06 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R06.2.json | — |
| R07.1 | R07 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R07.1.json | — |
| R07.2 | R07 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R07.2.json | — |
| R08.1 | R08 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R08.1.json | — |
| R08.2 | R08 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R08.2.json | — |
| R09.1 | R09 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R09.1.json | — |
| R09.2 | R09 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R09.2.json | — |
| R10.1 | R10 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R10.1.json | — |
| R10.2 | R10 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R10.2.json | — |
| R11.1 | R11 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R11.1.json | — |
| R11.2 | R11 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R11.2.json | — |
| R12.1 | R12 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R12.1.json | — |
| R12.2 | R12 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R12.2.json | — |
| R13.1 | R13 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R13.1.json | — |
| R13.2 | R13 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R13.2.json | — |
| R14.1 | R14 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R14.1.json | — |
| R14.2 | R14 | not-run | no replay fixture at tests\godot-remaining\I\fixtures\negative\R14.2.json | — |

## 硬失败（不能被其他通过抵消）

- R02.1 · model-wrong-behavior: I.R02.1.1: element 2 failed: expected <= 0.5, got 4
- R02.1 · model-wrong-behavior: I.R02.1.2: expected true, got false
- R02.1 · model-wrong-behavior: I.R02.1.3: expected length >= 4, got 2
- R03.1 · model-wrong-behavior: I.R03.1.2: expected {} to equal progress.inventoryBefore ({"wood":4,"coin":12})

## 尚未执行 / 被依赖阻断

- R01.1（依赖：E, D）
- R01.2（依赖：E, D）
- R02.2（依赖：L, F, C）
- R03.2（依赖：A, D, H, L）
- R04.1（依赖：E, F, L, C）
- R04.2（依赖：F, A, D, L）
- R05.1（依赖：H, A, E, L）
- R05.2（依赖：A, E, L, D）
- R06.1（依赖：A, B, C, D, L）
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
- R12.2（依赖：N, H, M, A, C, D）
- R13.1（依赖：L, A, C）
- R13.2（依赖：A, L, C, D）
- R14.1（依赖：K, root）
- R14.2（依赖：K, root）

## 台账

| 编号 | 状态 | 关联轮次 | 原因 |
| --- | --- | --- | --- |
| A01 | 尚未执行 | R01.1 R01.2 | 尚未执行 |
| A02 | 尚未执行 | R01.2 | 尚未执行 |
| A03 | 失败 | R02.1 | 至少一轮硬断言失败 |
| A04 | 尚未执行 | R02.2 | 尚未执行 |
| A05 | 失败 | R03.1 R03.2 | 至少一轮硬断言失败 |
| A06 | 尚未执行 | R04.1 | 尚未执行 |
| A07 | 尚未执行 | R04.2 | 尚未执行 |
| A08 | 尚未执行 | R05.1 | 尚未执行 |
| A09 | 尚未执行 | R05.2 | 尚未执行 |
| A10 | 尚未执行 | R06.1 | 尚未执行 |
| A11 | 尚未执行 | R06.2 | 尚未执行 |
| A12 | 尚未执行 | R06.2 | 尚未执行 |
| A13 | 尚未执行 | R07.1 R07.2 | 尚未执行 |
| A14 | 尚未执行 | R08.1 R08.2 | 尚未执行 |
| A15 | 尚未执行 | R09.1 | 尚未执行 |
| A16 | 尚未执行 | R09.2 | 尚未执行 |
| A17 | 尚未执行 | R14.1 R14.2 | 尚未执行 |
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
| AL-A05 | 尚未执行 | R12.2 | 尚未执行 |
| AL-A06 | 尚未执行 | R12.2 | 尚未执行 |
| AL-A07 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A08 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A09 | 尚未执行 | R12.2 | 尚未执行 |
| AL-A10 | 尚未执行 | R12.2 | 尚未执行 |
| AL-A11 | 尚未执行 | R12.2 | 尚未执行 |
| AL-A12 | 尚未执行 | R12.2 | 尚未执行 |
| AL-A13 | 尚未执行 | R12.2 | 尚未执行 |
| AL-A14 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A15 | 尚未执行 | R12.1 | 尚未执行 |
| AL-A16 | 尚未执行 | R12.2 | 尚未执行 |
| AL-A17 | 尚未执行 | R14.2 | 尚未执行 |

## 备注

- 冻结校验：通过；来源文档漂移 0 项，缺失 0 项（来源根 D:\Craftmine World）。
- 覆盖检查：14 类 / 28 轮 / 128 条断言。
- replay 只证明验收器本身；它不构成任何真实模型结论。
