# 真实模型验收报告（任务 I）

- 生成时间：2026-09-09T19:05:54.257Z
- 模式：live
- 冻结校验：通过（ok）
- 身份摘要：product=core@33620215ecd7 engine=4.7.2-stable base=unknown model=deepseek-v4.1-flash-expires-on-0910

## 汇总（不得只看通过数）

- 轮次：2，通过 0，失败 2，证据不足 0，尚未执行 0
- 真实模型调用：6；用量未知调用：0
- 人工介入：0
- 故事台账：已证实 0，失败 0，尚未执行 50，证据不足 0

## 逐轮结果

| 轮次 | 类别 | 判定 | 原因 | 证据 |
| --- | --- | --- | --- | --- |
| R15.1 | R15 | failed | I.R15.1.1: expected length >= 2, got 0; I.R15.1.2: expected a non-empty array at project.files; I.R15.1.3: expected true, got undefined; I.R15.1.4: expected true, got undefined; I.R15.1.5: expected true, got undefined; I.R15.1.6: expected >= 1, got 0; identity incomplete: base.version, project.treeHash | evidence/R15.1 |
| R15.2 | R15 | failed | I.R15.2.1: expected >= 1, got null; I.R15.2.2: expected true, got undefined; I.R15.2.3: expected true, got undefined; I.R15.2.4: expected true, got undefined; I.R15.2.5: expected >= 1, got 0; identity incomplete: base.version, project.treeHash | evidence/R15.2 |

## 硬失败（不能被其他通过抵消）

- R15.1 · model-wrong-behavior: I.R15.1.1: expected length >= 2, got 0
- R15.1 · model-wrong-behavior: I.R15.1.2: expected a non-empty array at project.files
- R15.1 · model-wrong-behavior: I.R15.1.3: expected true, got undefined
- R15.1 · model-wrong-behavior: I.R15.1.4: expected true, got undefined
- R15.1 · model-wrong-behavior: I.R15.1.5: expected true, got undefined
- R15.1 · model-wrong-behavior: I.R15.1.6: expected >= 1, got 0
- R15.2 · model-wrong-behavior: I.R15.2.1: expected >= 1, got null
- R15.2 · model-wrong-behavior: I.R15.2.2: expected true, got undefined
- R15.2 · model-wrong-behavior: I.R15.2.3: expected true, got undefined
- R15.2 · model-wrong-behavior: I.R15.2.4: expected true, got undefined
- R15.2 · model-wrong-behavior: I.R15.2.5: expected >= 1, got 0

## 台账

| 编号 | 状态 | 关联轮次 | 原因 |
| --- | --- | --- | --- |
| A01 | 尚未执行 | R01.1 R01.2 | 尚未执行 |
| A02 | 尚未执行 | R01.2 | 尚未执行 |
| A03 | 尚未执行 | R02.1 | 尚未执行 |
| A04 | 尚未执行 | R02.2 | 尚未执行 |
| A05 | 尚未执行 | R03.1 R03.2 | 尚未执行 |
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

- 真实产品适配器：PI agent runtime + craftmine.world 插件子进程 + craftmine-core.exe。
- 模型：deepseek/deepseek-v4.1-flash-expires-on-0910 thinking=high。
- 构建门禁：GODOT_BROKER_MISSING（构建/检查未通过不代表源码未写出）。
- 源级证据只证明模型写出了符合要求的源码，不代替 R02.1/R02.2 的运行时断言。
