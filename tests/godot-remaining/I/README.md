# 任务 I：真实模型验收器（冻结需求 + 独立驱动 + 证据 + 台账）

本目录是任务 I 的独占范围。它证明的是**产品里的真实模型能不能通过已接入工具完成需求**，不是手写样例能不能跑。

- 冻结需求、断言、评分、失败分类、三份台账都在 `spec/`，并用 `spec/FREEZE.lock.json` 记录逐文件 sha256 与来源文档 sha256。
- 验收驱动 `run.mjs` 不发送任何真实输入，不自己写世界，不另建模型循环；它只读取产品自己的构建/检查/应用/保存链路。
- 证据、用量（含 unknown）、失败分类、人工介入、截图与哈希都落在每轮独立的证据目录里。

## 命令

```powershell
# 1) 验收器自检：冻结完整性、覆盖、判红能力、禁用真实输入、台账规则、退出码
node tests/godot-remaining/I/selfcheck.mjs

# 2) 逻辑测试（node:test）
node --test tests/godot-remaining/I/acceptance-runner.test.mjs

# 3) 审计：只输出冻结校验、覆盖与台账状态，不执行任何轮次
node tests/godot-remaining/I/run.mjs --mode audit --out test-results/i-audit

# 4) replay：用已记录的观测跑冻结断言，证明验收器本身
node tests/godot-remaining/I/run.mjs --mode replay --out test-results/i-replay

# 5) 反例夹具：证明断言会判红（应退出 1）
node tests/godot-remaining/I/run.mjs --mode replay --fixtures tests/godot-remaining/I/fixtures/negative --out test-results/i-negative

# 6) 真实模型（等待产品接口；接口未接通时全部记为尚未执行并退出 3）
$env:CRAFTMINE_I_PRODUCT_INTERFACE='http://127.0.0.1:<port>'
node tests/godot-remaining/I/run.mjs --mode live --confirm-live --out test-results/i-live
```

退出码：`0` 无硬失败；`1` 存在硬断言失败；`2` 拒绝执行（覆盖/输入守卫不通过，或 live 未加 `--confirm-live`）；`3` 产品接口未接通，轮次全部登记为尚未执行。

## 冻结内容

| 文件 | 内容 |
| --- | --- |
| `spec/acceptance-set.frozen.json` | 14 类需求 × 每类两轮 = 28 轮，覆盖 A01–A17 与额外显式要求 |
| `spec/assertions.frozen.json` | 128 条断言：machine 可执行判定，visual/human/accounting 必须有对应证据 |
| `spec/scoring.frozen.json` | 硬条件、判定规则、指标采样、禁止的归一化 |
| `spec/failure-classes.frozen.json` | 15 类失败与责任归属 |
| `spec/ledger.a01-a17.frozen.json` | Godot A01–A17 台账定义 |
| `spec/ledger.v01-v16.frozen.json` | 版本管理 V01–V16 台账定义 |
| `spec/ledger.al-a01-a17.frozen.json` | 素材库 AL-A01–AL-A17 台账定义（原文编号 A01–A17） |
| `spec/product-interface-contract.frozen.json` | 向 A/C/D/E/L/H/M/N 请求的只读消费契约 |
| `spec/FREEZE.lock.json` | 上述文件与来源文档的 sha256、来源根路径 |

重新冻结：`node tools/freeze.mjs`（可用 `CRAFTMINE_I_SOURCE_ROOT` 指向最新需求文档所在主目录）。只校验：`node tools/freeze.mjs --check`。

## 判定规则

- 轮次：任一 hard machine 断言失败 → 失败；machine 通过但缺截图/人工/账目证据或身份不全 → 证据不足；全部通过且证据齐备 → 通过；依赖未接通 → 尚未执行（blocked）。
- 故事：全部关联轮次通过才「已证实」；任一轮失败即「失败」；有证据不足即「证据不足」；否则「尚未执行」。**不能用总通过数抵消单条硬失败。**
- 用量：未上报的调用记 `unknown`，不写 0；缓存命中不折算成本。

## 真实输入禁令

用户偏好（`AGENTS.md`）与总计划都要求验收不得抢占鼠标键盘。本目录：

- `lib/input-guard.mjs` 在运行前扫描本目录源码中的禁用 API（`page.mouse`、`page.keyboard`、`page.click/fill/press`、locator 输入、`requestPointerLock`、窗口激活、`sendInputEvent`、OS 级输入库）；
- 提供 `guardPage()` 让任何浏览器页面的真实输入调用直接抛错并记账；
- 每份证据都带 `inputEventsSent/pointerLockRequests/focusSteals/blockedInputAttempts`，非 0 即整体拒绝。
- 不运行 `tests/browser.mjs`、`tests/modules-browser.mjs`。

## 现在还没有做的事

- 真实模型轮次**尚未执行**：产品接口（`spec/product-interface-contract.frozen.json`）还没有实现。live 模式会以退出码 3 结束，并把 28 轮全部登记为尚未执行。
- `fixtures/replay/**` 只证明验收器；它**不是**真实模型证据，报告里 `mode=replay` 会明示。
- 人工手感、可见窗口合成、独立 Windows 安装：没有真实玩家或独立环境时保留未验收。
