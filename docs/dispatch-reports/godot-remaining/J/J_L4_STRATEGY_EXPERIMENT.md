# J｜L4 创作策略对照实验方案

任务标识：`J-20260910`。实现：`desktop/godot/strategy/**`；测试：`tests/godot-remaining/J/strategy.test.mjs`。

## 1 目标与边界

目标：在**同一冻结需求集**上，对旧策略与新策略做同条件对照，分别记录首次成功、
修复后成功、失败分母、人工介入、token/缓存、耗时与回归。

边界：
* 评测题与评分由 I 冻结，策略不自行改通过条件（`runExperiment` 只引用 `scoringContract` 哈希）。
* 不新建世界数据库、模型循环或宽权限执行路径；执行由注入的 attempt 适配器完成。
* 不把某次提示词偶然成功当作模型自主升级；对照结论由 `compareRuns` 给出，且有硬性拒绝条件。

## 2 两条分支（只差策略，不差输入）

| 维度 | `baseline`（旧策略） | `candidate`（新策略） |
| --- | --- | --- |
| 底座过滤 | 只看 `baseId` | 看 `baseId` + `engineVersions` + `stateFormats` |
| 前置能力 | 忽略 | 缺少 `requires` 的能力即排除 |
| 失败经验 | 忽略 | 同一底座+版本上最近一次失败且之后无成功 → 排除 |
| 排序 | `toolId` 升序 | 历史成功率降序 → 成本等级升序 → `toolId` |
| 数量 | 全量 | 受 `maxTools` 限制 |

实现见 `desktop/godot/strategy/tool-selection.mjs`；`compareArms()` 用同一份输入同时跑两条分支。

## 3 检索契约（与 M/N 共用内容引用）

条目格式 `craftmine.godot-strategy-entry/1`，必须携带 `craftmine.godot-content-ref/1`
（`contentId/contentVersion/contentHash/baseId/baseVersion/stateFormat/engineVersion`）。

`query()` 返回命中项**和**每一条被排除的原因：

| 排除码 | 含义 |
| --- | --- |
| `engine-mismatch` | 引擎版本不同 |
| `base-mismatch` | 底座不同 |
| `state-format-mismatch` | 状态格式不同 |
| `base-version-incompatible` | 底座版本超出条目声明的兼容范围 |
| `tag-miss` | 标签不匹配 |
| `unresolved-content` | 内容哈希无法解析或与解析结果不符（**只存在指针的作品**） |
| `invalid` | 条目本身不合法（例如缺 `contentHash`，连索引都进不去） |

没有解析器时，默认不返回任何条目（除非显式 `allowUnverified: true`，用于离线准备，
并在返回项上标 `verified: false`）。

## 4 实验协议

1. **冻结输入**：I 提供 `craftmine.godot-strategy-taskset/1`，含 `frozen: true`、
   `frozenBy`、`frozenAt`、`scoringContract`，以及至少 10 条任务（`taskId/baseId/baseVersion/stateFormat/engineVersion/prompt/capabilityTags`）。
2. **执行**：`runExperiment({ taskSet, runAttempt, evidence })`。每条任务先跑第 1 轮；
   失败则跑第 2 轮修复轮；失败**留在分母**。
3. **适配器**：`runAttempt({ task, arm, attempt }) => { success, repairs, humanInterventions, tokens{input,output,cached,unknown}, cacheHits, durationMs, regressions, notes, toolSelection }`。
   没有适配器 → `status: 'blocked'`、`reason: 'no-attempt-adapter'`，不产生任何成功率。
4. **证据记账**：`evidence` 取 `logic-only / fixture / engine-headless / real-model / release-package`。
   逻辑样本或固定适配器只能记 `logic-only`，运行记录里会写明"不能当作真实模型或引擎验收结果"。
5. **记录**：`writeRunRecord(run, dir)` 写 `craftmine.godot-strategy-run/1` JSON；
   被阻断的运行**不写结果文件**。
6. **对照**：`compareRuns(baselineRun, candidateRun)` 的硬性拒绝条件：
   * 评测集 `digest` 不同 → `different-task-set`；
   * 证据类别不同 → `different-evidence`；
   * 有运行被阻断 → `incomplete-run`；
   * 任务数少于 `MIN_FROZEN_TASKS`（10）→ `insufficient-sample`，不宣布改善；
   * 任一任务出现回归或存在回归标记 → `regressed`（不能被"成功数不降"抵消）；
   * 只有"全部任务都有尝试 + 无回归 + 至少一项严格改善"才是 `improved`。

## 5 当前状态（诚实记录）

* 实验框架已实现并通过 9 项逻辑测试；**尚未执行任何真实对照**。
* 原因：没有 I 的冻结任务集（`evaluation-set-not-frozen`），没有 L 的真实 attempt 适配器
  （`no-attempt-adapter`）。两个原因都可由 `node tests/godot-remaining/J/gates.mjs` 复现。
* 因此本文档不含任何成功率、成本或耗时数字；没有数字就不写数字。

## 6 依赖与接口需求

| 依赖方 | 需要提供 | 本任务提供 |
| --- | --- | --- |
| I（冻结评测） | 冻结任务集 JSON + `scoringContract` 哈希 + 允许的失败分类 | `validateTaskSet` / `runExperiment` / `compareRuns` 的机器可读拒绝理由 |
| L（工具与上下文） | 真实 attempt 适配器；工具目录（含 `bases/engineVersions/stateFormats/requires/costClass`） | `selectTools` / `compareArms` 接口与调用示例 |
| M/N（内容引用） | `resolver(ref) -> {found, bytes|hash}` | `content-ref.mjs` 的引用格式与校验 |
| A/C（执行与恢复） | 每次尝试的真实结果与用量回包 | 统一的记录字段（token/cache/耗时/人工介入分开记） |
| K（性能与发行） | 预算阈值与采样口径 | `measureBudget` 的证据来源标注 |

## 7 集成顺序

1. I 冻结任务集 → 用 `validateTaskSet` 确认可解析；
2. L 接上 attempt 适配器与工具目录 → 先跑 `logic-only` 冒烟；
3. 用真实模型跑 `real-model` 两条分支 → 写运行记录；
4. `compareRuns` 给出结论；只有 `improved` 且无回归的策略才提交给 L 逐步集成。
