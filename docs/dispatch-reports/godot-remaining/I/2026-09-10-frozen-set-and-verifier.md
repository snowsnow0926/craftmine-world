# 任务 I 交付报告：冻结需求 + 独立验收器（真实模型执行等待产品接口）

- 日期：2026-09-10
- 分支：`codex/godot-remaining-i-20260910`，工作树 `D:/Craftmine World-worktrees/godot-remaining-i-20260910`，基线 `e462147`
- 范围：`tests/godot-remaining/I/**`、`docs/dispatch-reports/godot-remaining/I/**`
- 结论：**需求已冻结、验收器已实现并自检通过；真实模型轮次尚未执行**（产品接口未接通，live 模式退出码 3，28 轮全部登记为尚未执行）

## 1. 已交付

| 路径 | 作用 |
| --- | --- |
| `tests/godot-remaining/I/spec/acceptance-set.frozen.json` | 14 类需求 × 每类两轮 = **28 轮**评测集合；每轮含原始需求文本、必须观察项、身份要求、失败分类与依赖模块 |
| `tests/godot-remaining/I/spec/assertions.frozen.json` | **128 条冻结断言**：machine 可执行判定 + visual/human/accounting 证据要求 |
| `tests/godot-remaining/I/spec/scoring.frozen.json` | 硬条件、轮次/故事判定规则、指标采样、禁止的归一化 |
| `tests/godot-remaining/I/spec/failure-classes.frozen.json` | 15 类失败与责任归属（模型/产品/引擎/验收器/环境/依赖） |
| `tests/godot-remaining/I/spec/ledger.a01-a17.frozen.json` | Godot A01–A17 台账定义 |
| `tests/godot-remaining/I/spec/ledger.v01-v16.frozen.json` | 版本管理 V01–V16 台账定义 |
| `tests/godot-remaining/I/spec/ledger.al-a01-a17.frozen.json` | 素材库 AL-A01–AL-A17 台账定义（原文编号 A01–A17，含 alias） |
| `tests/godot-remaining/I/spec/product-interface-contract.frozen.json` | 向 A/C/D/E/L/H/M/N 请求的只读消费契约 |
| `tests/godot-remaining/I/spec/FREEZE.lock.json` | 8 个冻结文件的 sha256 + 6 份来源文档的 sha256 与来源根 |
| `tests/godot-remaining/I/lib/*.mjs` | 断言求值器、冻结校验、禁用输入守卫、身份、证据、失败分类、台账、报告、覆盖检查、两种传输 |
| `tests/godot-remaining/I/run.mjs` | 验收驱动：`audit` / `replay` / `live` 三种模式 |
| `tests/godot-remaining/I/selfcheck.mjs` | 验收器自检：16 项 |
| `tests/godot-remaining/I/acceptance-runner.test.mjs` | `node:test` 逻辑测试：7 项 |
| `tests/godot-remaining/I/fixtures/**` | 7 个回放夹具 + 2 个反例夹具（用于证明验收器可判红） |

## 2. 冻结内容的硬约束

- 需求**不能全部等同于预制样例**：28 轮全部是真实模型需求，覆盖 A01–A17 以及三个模型自写 L2 扩展、版本管理、素材库、性能/成本/人工介入、许可与交付。
- 每条轮次定义：原始需求、必须观察到的状态/画面、通过条件（冻结断言）、模型/引擎/底座/工程/输入身份、失败分类。
- 冻结文件被改动即拒绝运行；来源文档（含主目录最新未提交计划）哈希记录在 `FREEZE.lock.json`，来源根为 `D:\Craftmine World`。
- 评分规则明确禁止：用总通过数抵消单条硬失败、把 blocked/not-run 计入通过、删失败分母、失败后放宽断言、把作者固定工程登记冒充产品模型创作、把离屏测试当作画面/手感/独立 Windows 安装通过。

## 3. 判定规则（可执行）

| 轮次判定 | 条件 |
| --- | --- |
| `passed` | 全部 hard machine 断言通过 **且** 声明的截图/人工/账目证据齐备 **且** 身份字段完整 |
| `failed` | 任一 hard machine 断言失败 |
| `insufficient` | machine 通过但缺证据或缺身份 |
| `blocked` / `not-run` | 依赖产品接口未接通 / 未执行 |

| 故事状态 | 条件 |
| --- | --- |
| 已证实 | 全部关联轮次 `passed` **且** 至少执行自 `live`（replay/audit 证据永远不能判已证实） |
| 失败 | 任一关联轮次 `failed` 或存在未分类硬失败 |
| 证据不足 | 存在 `insufficient` 轮次 |
| 尚未执行 | 存在 `blocked`/`not-run` 且无失败 |

退出码：`0` 无硬失败；`1` 有硬失败；`2` 拒绝执行（冻结/覆盖/输入守卫失败，或 live 未加 `--confirm-live`）；`3` 产品接口未接通。

## 4. 已执行的验证与原始证据

命令与原始证据都在 `docs/dispatch-reports/godot-remaining/I/evidence/`：

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `node tools/freeze.mjs` | 8 个冻结文件，覆盖 14 类/28 轮/128 断言 | `spec/FREEZE.lock.json` |
| `node tests/godot-remaining/I/selfcheck.mjs` | **16/16 PASS**，退出 0 | 见下节清单 |
| `node --test tests/godot-remaining/I/acceptance-runner.test.mjs` | **7/7 pass** | 终端输出 |
| `node run.mjs --mode audit` | 28 轮全部尚未执行，无模型调用 | `evidence/audit/report.{json,md}` |
| `node run.mjs --mode replay` | 28 轮：通过 6、证据不足 1、未执行 21；**已证实故事 0** | `evidence/replay/report.{json,md}` + 每轮 `evidence/replay/evidence/<round>/` |
| `node run.mjs --mode replay --fixtures fixtures/negative` | **2 轮判失败，退出码 1**（证明断言会判红） | `evidence/negative/report.{json,md}` |
| `node run.mjs --mode live --confirm-live` | **28 轮全部尚未执行，模型调用 0，退出码 3** | `evidence/live-blocked/report.{json,md}` + 每轮 `blocked.json` |
| `node run.mjs --mode live`（未加 `--confirm-live`） | 拒绝执行，退出码 2 | — |

自检 16 项：冻结完整性、覆盖（≥10 类、每类两轮、A01–A17 全覆盖）、断言可求值、**判红能力（8 个反例全部判红）**、visual/human/accounting 不能被 machine 判通过、缺证据判证据不足、**禁用真实输入（源码扫描 + 页面守卫 + 账目断言）**、台账四种状态、replay 不能判已证实、身份字段缺失识别、凭据拦截、live 探针、replay/反例/live 退出码、报告不含凭据、报告头不把未执行计入通过。

`replay` 夹具只是**验收器证据**，报告 `mode=replay` 明示；它不构成任何真实模型结论，也无法让任何故事变成已证实。

## 5. A01–A17 逐条状态（精确版本：基线 `e462147`，本轮无真实模型调用）

| 编号 | 故事 | 状态 | 关联轮次 | 阻断/原因 |
| --- | --- | --- | --- | --- |
| A01 | 打开客户端并进入世界 | 尚未执行 | R01.1 R01.2 | 尚未执行 |
| A02 | 展开游玩再返回创作 | 尚未执行 | R01.2 | 尚未执行 |
| A03 | 真实模型开发准星和持枪 | 尚未执行 | R02.1 | 尚未执行 |
| A04 | 切换枪与剑并攻击 | 尚未执行 | R02.2 | 尚未执行 |
| A05 | 连续修改已玩的武器世界 | 尚未执行 | R03.1 R03.2 | 尚未执行 |
| A06 | 创建俯视世界并增加商店 | 尚未执行 | R04.1 | 尚未执行 |
| A07 | 创建任务并完成后重启 | 尚未执行 | R04.2 | 尚未执行 |
| A08 | 在第二个世界复用作品 | 尚未执行 | R05.1 | 尚未执行 |
| A09 | 创作期间切换到另一世界 | 尚未执行 | R05.2 | 尚未执行 |
| A10 | 进程中断后恢复任务 | 尚未执行 | R06.1 | 尚未执行 |
| A11 | 连续三次压缩后继续修改 | 尚未执行 | R06.2 | 尚未执行 |
| A12 | 结束或过期任务后接续草稿 | 尚未执行 | R06.2 | 尚未执行 |
| A13 | 转换旧世界副本并导出导入 | 尚未执行 | R07.1 R07.2 | 尚未执行 |
| A14 | 坏候选、不兼容迁移或加载失败 | 尚未执行 | R08.1 R08.2 | 尚未执行 |
| A15 | 横版获得能力后回访旧房间 | 尚未执行 | R09.1 | 尚未执行 |
| A16 | 挖掘和放置后保存重开 | 尚未执行 | R09.2 | 尚未执行 |
| A17 | 安装升级和失败恢复 | 尚未执行 | R14.1 R14.2 | 需要独立 Windows 环境；第 5 轮预检 8 项失败不构成本轮通过依据 |

V01–V16 与 AL-A01–AL-A17 同样**全部尚未执行**；V16（远程同步）与 AL-A16/AL-A17 中的远程/社区部分保持未执行，不由本地通过覆盖。完整逐条状态见 `evidence/audit/report.md` 的台账表。

**没有任何一条被登记为已证实**，也没有任何一条用其他条目的通过抵消。

## 6. 需要其他模块交付的接口

`spec/product-interface-contract.frozen.json` 是**请求**，不是已实现的产品 API，也不新建世界数据库/模型循环/宽权限执行路径。live 轮次需要（拥有者）：

- `GET /acceptance/identity`（C/D/E/L）：产品/客户端/引擎/底座版本、模型身份、输入策略、端点清单
- `POST /acceptance/session`、`/acceptance/close`（E/D、C/D）：会话与初始世界身份
- `POST /acceptance/request`、`GET /acceptance/task/{id}`（L/A）：走产品自己的模型循环与工具，返回状态、草稿、候选、构建、usage（含 unknown）、错误
- `POST /acceptance/apply`（A/C/D）：返回 applied、progressRef、appliedOnce
- `POST /acceptance/observe`（C/D/F/G）：返回 `craftmine.i.observation/1` 观测文档，只报告实际运行状态，不接受调用方写预期状态
- `POST /acceptance/save`、`/acceptance/restart`（D/A）：保存与重启恢复
- `GET /acceptance/usage`（L）：创作/压缩/评审分账 token 与缓存

接通后执行：

```powershell
$env:CRAFTMINE_I_PRODUCT_INTERFACE='http://127.0.0.1:<port>'
node tests/godot-remaining/I/run.mjs --mode live --confirm-live --out test-results/i-live
```

## 7. 尚未完成（明确保留）

1. **真实模型轮次一次都没有跑**：产品接口未实现，`live` 只输出退出码 3 与 28 条尚未执行。
2. **画面证据与人工手感未产生**：visual 断言需要真实运行截图，human 断言需要真实玩家记录；`R14.2` 在回放中正是因此判「证据不足」，这条规则不允许被绕过。
3. **A17 / AL-A17 的独立 Windows 安装与许可清单核对**未执行，保留未验收。
4. **性能/成本基线**（R13.1/R13.2）尚未有真实样本，因此没有写任何阈值或提升承诺。
5. **未接线的消费端**：本目录不修改 `package.json`、`electron/main/index.ts`、`plugins/craftmine-world/view.mjs` 或任何锁文件。建议主任务在合并时加入脚本：
   ```json
   "test:i-acceptance": "node --test tests/godot-remaining/I/acceptance-runner.test.mjs",
   "test:i-selfcheck": "node tests/godot-remaining/I/selfcheck.mjs"
   ```

## 8. 复现命令

```powershell
cd D:\Craftmine World-worktrees\godot-remaining-i-20260910
$env:CRAFTMINE_I_SOURCE_ROOT='D:\Craftmine World'
node tests/godot-remaining/I/tools/freeze.mjs --check
node tests/godot-remaining/I/selfcheck.mjs
node --test tests/godot-remaining/I/acceptance-runner.test.mjs
node tests/godot-remaining/I/run.mjs --mode audit --out test-results/i-audit
node tests/godot-remaining/I/run.mjs --mode replay --out test-results/i-replay
node tests/godot-remaining/I/run.mjs --mode replay --fixtures tests/godot-remaining/I/fixtures/negative --out test-results/i-negative
```
