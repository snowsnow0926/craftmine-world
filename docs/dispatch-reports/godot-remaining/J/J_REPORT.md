# J｜L3 受控部件扩展与 L4 创作策略：交付报告

* 任务标识：`J-20260910`
* 交付分支：`codex/godot-remaining-j-20260910`（独立工作树 `D:\Craftmine World-worktrees\godot-remaining-j-20260910`）
* 基线：`e462147`（分发说明中的 `92c98b2` 之后又有两个已集成提交，实际以最新为准）
* 代码提交：`71735c0`（新增），`cbe3df0`（评审修复）
* 报告提交：见交付消息中的最新提交号（本文件单独提交，未推送）
* 证据目录：[evidence/](evidence/)

## 0 本轮做了什么、没做什么

本轮按用户要求**先准备部件方案与实验**，并明确 **GD8 最终通过依赖 GD7 可用基线与 I 的冻结评测集**。

做了：
1. L0–L4 边界与判定流程（可核对到文件行号），并列出 7 条容易被误判为 L3 的点。
2. L3 候选部件档案：2 条有真实代码路径证据的候选 + 5 条被否掉的提案；候选闸门可复跑。
3. L3 部件生命周期元数据层：清单校验、兼容闸门、原子落盘、安装/生效/升级/回退/卸载、预算记账、内容引用。
4. L4 策略实验层：按底座/版本检索（含排除原因）、旧/新两条工具选择分支、冻结任务集闸门、诚实的对照结论。
5. 33 项纯逻辑测试 + 1 个可复跑的闸门证据脚本；原始输出已落盘。
6. 一轮对抗式只读评审，并按结论修复 2 个高危、4 个中等、若干低危缺陷（见第 5 节）。

没做（**不是遗漏，是被依赖卡住，理由可复现**）：
* 没有实现任何 L3 部件（闸门判定两条候选均为 `not-ready`）。
* 没有跑任何 L4 对照（`evaluation-set-not-frozen`、`no-attempt-adapter`）。
* 没有启动 Godot、没有真实输入、没有改任何冻结文件或他人的范围。

## 1 逐条对照专责任务

| 条目 | 状态 | 证据 |
| --- | --- | --- |
| 1 梳理 L0–L4 边界，普通 GDScript 不得包装成 L3 | 已完成 | [J_BOUNDARY_L0_L4.md](J_BOUNDARY_L0_L4.md)；测试 `PART_KINDS stays the host-owned list` |
| 2 选少量有证据的 L3 缺口，写冻结输入/缺失能力/候选接口/预算/回退 | 已完成（候选状态=hypothesis） | [J_L3_CANDIDATES.md](J_L3_CANDIDATES.md)；`fixtures/l3-candidates.json`；闸门输出 `l3-candidate:*:not-ready` |
| 3 按底座/版本组织的检索与工具选择策略，与 L/H 正式接口对接，数据/成本独立 | 已完成（接口与框架） | `desktop/godot/strategy/**`；[J_INTERFACE_NOTES.md](J_INTERFACE_NOTES.md) |
| 4 实现至少一个有真实价值、可独立版本化和回退的 L3 部件 | **未完成，依赖 GD7** | 闸门 `not-ready`；缺 `currentBaseline` 实测与冻结输入 |
| 5 旧/新策略同条件 L4 对照，记录全部指标 | **未完成，依赖 I + L** | 闸门 `evaluation-set-not-frozen`、`no-attempt-adapter` |
| 6 仅对有独立改善证据的策略逐步集成 | 机制已就绪 | `compareRuns` 的 `improved/regressed/insufficient-sample/inconclusive` 判定 |
| 7 部件安装/升级/卸载与回退给 H，策略接口给 L，依赖与许可给 K | 已完成（接口说明 + 代码） | [J_INTERFACE_NOTES.md](J_INTERFACE_NOTES.md) 第 1/2/3 节 |

## 2 文件清单（sha256 前 16 位，取自 `cbe3df0`）

```
4428ac99c6efbf43  desktop/godot/extensions/README.md
7cef332be164cfa8  desktop/godot/extensions/budget.mjs
1d4b54695ce0a5d8  desktop/godot/extensions/candidate.mjs
5628bea24f5926e2  desktop/godot/extensions/compat.mjs
8e567e85391aecf5  desktop/godot/extensions/content-ref.mjs
3ff1459d6e2ec8a0  desktop/godot/extensions/formats.mjs
6fced17c3e0c5017  desktop/godot/extensions/index.mjs
716e9f1af85b4949  desktop/godot/extensions/lifecycle.mjs
f95bdf32cb3da0aa  desktop/godot/extensions/manifest.mjs
45851d08a97d0589  desktop/godot/extensions/package.mjs
52b3c2815a8f4fb1  desktop/godot/extensions/store.mjs
df233df98db0c420  desktop/godot/strategy/README.md
44ce51ff16a53166  desktop/godot/strategy/experiment.mjs
74ce1506e9cbaff3  desktop/godot/strategy/formats.mjs
6eda14c8e1d29a2f  desktop/godot/strategy/index.mjs
1856f9d3970885e3  desktop/godot/strategy/retrieval.mjs
16ed5ff6408642ce  desktop/godot/strategy/tool-selection.mjs
949d198def60f34e  tests/godot-remaining/J/README.md
dc40021bf2415c58  tests/godot-remaining/J/extensions.test.mjs
5e21ef89bcf3486f  tests/godot-remaining/J/strategy.test.mjs
dc1eb6fb667cdefd  tests/godot-remaining/J/gates.mjs
97e1b41215d9ae72  tests/godot-remaining/J/fixtures/l3-candidates.json
```

完整哈希可用 `git ls-tree -r cbe3df0` + `Get-FileHash` 复算。

## 3 验证命令与结果

```powershell
node --test "tests/godot-remaining/J/*.test.mjs"
# 33 tests / 33 pass / 0 fail（原始输出：evidence/tests-final.txt）

node tests/godot-remaining/J/gates.mjs
# 8 条闸门，5 条预期阻断（原始输出：evidence/gates-run.txt）
```

`gates.mjs` 实际输出要点：

```
l3-candidate:world-snapshot-stream   not-ready  [证据可确认, 冻结输入, 当前基线实测, 预算声明]
l3-candidate:collision-shape-batcher not-ready  [证据可确认, 冻结输入, 当前基线实测, 预算声明]
l3-native-without-validation         refused
l3-budget-unmeasured                 unknown
l4-run-without-frozen-set            evaluation-set-not-frozen
l4-run-without-adapter               no-attempt-adapter
l4-candidate-filters                 baseline 1 / candidate 0
l4-compare-different-task-sets       different-task-set
```

环境身份：Node `v24.14.0`；分支 `codex/godot-remaining-j-20260910`；基线提交 `e462147852e36bdfcaf897d3f915c5809fb88670`。
未启动 Godot、未启动浏览器、未发送任何输入。

## 4 首次失败与修复（保留记录）

* 首次运行 `node --test tests/godot-remaining/J/strategy.test.mjs`：8 通过、1 失败。
* 失败断言：`comparison reports improvement, regression and refusal to overclaim`
  —— 期望 `regressedTasks = ['task-03']`，实际 `['task-03','task-03']`。
* 原因：同一条任务同时触发"首次成功退化"和"修复后成功退化"，各 push 一次。
* 修复：同一任务的说明合并为一条。复跑通过。
* **说明：首次失败的原始终端日志未在修复前落盘，此处按实际断言差异转述；
  修复后的完整原始输出保存在 `evidence/tests-final.txt`。**

## 5 评审发现与修复（`cbe3df0`）

对抗式只读评审（独立子代理）给出 12 条发现，逐条处理如下：

| 级别 | 发现 | 修复 |
| --- | --- | --- |
| 高 | 篡改文件并同步改写包内 `manifest.json` 后仍能激活（激活期只比对"文件 vs 清单"） | `store.verifyPackage` 增加 `expectedDigest`，激活/回退/`verify` 一律与安装时记录的清单摘要比对 |
| 高 | 声明了多项预算但只测其中一项时，`measureBudget` 会给出 `pass`，且 summary 出现 `p95 nullms` | 只有**每一项已声明预算都有对应测量且未超限**才是 `pass`，否则 `unknown`；summary 不再插入空值 |
| 中高 | `rollback` 不做完整性校验，可把被篡改或已卸载的版本变成生效版本 | 回退前逐条校验"仍已安装 + 完整性通过"，不可用条目记入 `skipped`；卸载时同步清理回退历史 |
| 中 | `native:false` 的包可通过 `files[]` 夹带 `.so/.dll` 绕过原生验证 | 清单校验拒绝非原生包中的原生库文件 |
| 中 | `target` 省略 `apiVersion` 即可跳过宿主 ABI 检查 | ABI 必须显式匹配；`createPartManager` 用宿主 ABI 补齐缺省值 |
| 中 | `rateStatus` 永远 `measured`；适配器抛错会中断整轮；`compareRuns` 轻信自报字段 | 适配器异常按任务记录为"未执行"并留在分母；成功率不可用；`compareRuns` 重新推导完整性，不完整即 `incomplete-run` |
| 中 | `readPackageFromDirectory` 会跟随清单里的 `../` 路径 | 加入安全相对路径校验 + 目录包含性检查 |
| 低中 | 安装可静默替换生效中版本的字节 | 生效中的 `partId@version` 拒绝覆盖 |
| 低 | `licenseReady` 接受 `TBD`/`proprietary` 等占位写法 | 占位写法拒绝，SPDX 语法校验通过才为真（最终权利确认仍归 K） |
| 低 | 异步解析器被误报为"内容不存在" | 新增 `async-resolver-unsupported` 原因 |
| 低 | `allowUnverified` 未在 README 说明、无测试 | 已在 README 说明并新增测试 |
| 低 | 文档计数与注释不符 | 测试计数改为 22+11=33；修正 `store.mjs` 关于"索引可重建"的注释 |

新增/加强的回归测试（共 9 项）确保这些缺陷不会回退。

## 6 依赖与阻塞（交给主任务的明确入口）

| 阻塞项 | 需要的输入 | 解除后可执行的命令 |
| --- | --- | --- |
| L3 候选推进 | GD7 固定包 + 真实测量（帧时间/内存/包体），回填候选档案的 `evidence/frozenInput/currentBaseline/budget` | `node tests/godot-remaining/J/gates.mjs` 应变为 `evidence-ready` |
| L4 对照 | I 的冻结任务集（`craftmine.godot-strategy-taskset/1`，含 `scoringContract`）+ L 的真实 attempt 适配器 | 按 [J_L4_STRATEGY_EXPERIMENT.md](J_L4_STRATEGY_EXPERIMENT.md) 第 7 节执行 |
| 原生部件 | B/C/K 的专项验证记录 `{by, at, harness}` | `checkPartCompatibility(..., { nativeValidation })` 通过 |
| 发行 | K 的许可结论与预算阈值 | `licenseReady` + `measureBudget({ source: 'release-package' })` |

**GD8 最终判定必须等 GD7 与冻结评测集就绪；本层提供的是可消费接口与可复现的阻断理由，
不是"能力已扩展"的结论。**

## 7 集成顺序建议

1. 主任务合并 `71735c0` + `cbe3df0`（纯新增目录，不触碰共享入口、冻结内核、Rust 与既有文件）。
2. H 接部件生命周期（[J_INTERFACE_NOTES.md](J_INTERFACE_NOTES.md) 第 1 节），把部件库目录纳入备份。
3. L 接 `selectTools` / 检索接口，并把 `createPartManager(...).status()` 作为"当前生效部件版本"的事实来源。
4. I 冻结任务集后，L 提供适配器，按实验方案执行对照。
5. K 提供预算阈值与许可结论后，才允许把候选档案推进到实现阶段。

## 8 未完成项（逐项保留）

1. 无任何 L3 部件实现（候选闸门未通过）。
2. 无任何真实 L4 对照运行（缺冻结任务集与适配器）。
3. 无原生专项验证（本层不签发）。
4. 内容引用字段名仍是提案，待 M/N 确认后可能需要一层映射。
5. `perfComponent` 这一新增部件类型待 F 确认；若不接受，需给替代方案。
