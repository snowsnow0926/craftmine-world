# J｜跨任务接口说明（给 H / L / K / M / N / I / B / C / F）

任务标识：`J-20260910`。以下接口都已实现并通过 `tests/godot-remaining/J/**` 的 24 项逻辑测试；
主任务按本文件接线即可，不需要改动本任务的文件。

---

## 1 给 H（作品复用、迁移与备份）：部件安装/升级/卸载/回退

```js
import { createPartManager, buildPartPackage, readPackageFromDirectory } from '../../desktop/godot/extensions/index.mjs';

const manager = createPartManager({
  root: '<部件库目录，独立于世界数据>',
  host: { engineVersion: '4.7.2-stable', apiVersion: 1 },   // engineVersion 取 desktop/godot/toolchain.lock.json 的 version
});

const target = { baseId: 'top-down', baseVersion: '1.0.0', stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable' };

manager.install(pkg, { target });                 // 只落盘，不生效
manager.activate('tile-batch-renderer', '0.1.0'); // 生效；上一版本进 history
manager.upgrade(pkgV2, { target });               // 安装并生效，保留上一版本
manager.rollback('renderPass');                   // 回到上一版本，没有则回内置 default
manager.uninstall('tile-batch-renderer', '0.2.0'); // 生效中的版本会被拒绝，必须先回退
manager.status();                                 // 当前生效版本 + 已安装列表 + journal 末尾
manager.verify('tile-batch-renderer', '0.1.0');   // 重新哈希磁盘文件，检测篡改
```

* 目录布局：`<root>/index.json`、`<root>/journal.jsonl`（append-only）、`<root>/packages/<partId>/<version>/{manifest.json,files/**}`。
* 全部写入是"临时文件 + rename"，失败不会留下半个包。
* 升级/回退语义与旧运行器 `app/harness/extension-loader.mjs` 的 stage/activate/rollback 一致，
  但**没有**修改那些冻结文件。
* H 需要做的：把部件库目录纳入备份范围（`packages/**` + `index.json` 不可重建，`journal.jsonl` 是审计记录）。

## 2 给 L（正式 PI 工具与上下文）

```js
import { selectTools, createRetrievalIndex } from '../../desktop/godot/strategy/index.mjs';
import { createPartManager } from '../../desktop/godot/extensions/index.mjs';

const retrieval = createRetrievalIndex({ entries, resolveContent: ref => assetLibrary.resolve(ref) });
const hits = retrieval.query({ baseId, baseVersion, stateFormat, engineVersion, tags, limit: 10 });
// hits.items：可用条目；hits.excluded：每条被排除的 reason（不要让模型猜为什么没检索到）

const arm = selectTools({ task, catalog, context, memory, arm: 'candidate', maxTools: 8 });
// arm.tools：本次可用工具；arm.excluded：每个工具被排除的 code
```

* 真实生效的部件版本通过 `createPartManager(...).status()` 读取，**不要让模型假设**。
* 模型看到的工具集应来自 `selectTools`，而不是"全量工具表"；排除原因要能解释。
* 需要 L 提供的：真实 attempt 适配器（签名见第 5 节）与工具目录字段
  `{ toolId, name, bases, engineVersions, stateFormats, capabilities, requires, costClass }`。

## 3 给 K（性能、许可与交付）

```js
import { measureBudget, summarizeBudgets, licenseReady } from '../../desktop/godot/extensions/index.mjs';

const report = measureBudget({
  declared: manifest.budgets,
  measured: { samplesMs, memoryBytes, packageBytes, source: 'release-package' },
});
```

* `source` 只能是 `logic-only / engine-headless / engine-rendered / release-package`；未测量一律 `unknown`，**不等于通过**。
* `licenseReady(manifest)` 只在 SPDX 已确认为真实许可时为真；`NOASSERTION/UNKNOWN` 的部件不得进发行包。
* 部件清单里的 `license.source` 是溯源字段，K 的逐模块清单可以直接消费。
* 部件包体大小可由 `buildPartPackage` 的 `packageBytes` 得到，与清单 `budgets.packageBytes` 对齐。

## 4 给 M / N（内容历史与素材库）：内容引用契约

```js
import { validateContentRef, resolveContentRef, hashContent } from '../../desktop/godot/extensions/index.mjs';

const ref = {
  format: 'craftmine.godot-content-ref/1',
  contentId: 'town-tiles', contentVersion: '1.0.0',
  contentHash: hashContent(bytes),          // 裸小写十六进制，与仓库既有 {path,bytes,sha256} 一致
  baseId: 'top-down', baseVersion: '1.0.0',
  stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable',
};
```

* 解析器签名：`resolveContent(ref) -> { found: boolean, bytes?: string|Buffer, hash?: string }`。
  只返回 `found` 而没有哈希会被判 `unverifiable-content`。
* 缺 `contentHash` 的引用直接判非法（"只存在指针的作品"）。
* 这是**提案**：如果 M/N 的最终字段名不同，请给 J 一个字段映射，本层可以加一层适配，
  但"必须可解析到哈希 + 必须声明底座/版本/状态格式"这两条不能放宽。

## 5 给 I（真实模型验收与冻结评分）

```js
import { runExperiment, compareRuns, writeRunRecord, validateTaskSet } from '../../desktop/godot/strategy/index.mjs';
```

* 冻结任务集格式：`craftmine.godot-strategy-taskset/1`，字段 `frozen/frozenBy/frozenAt/scoringContract/tasks[]`。
* `runAttempt({ task, arm, attempt }) => { success, repairs, humanInterventions, tokens{input,output,cached,unknown}, cacheHits, durationMs, regressions, notes, toolSelection }`。
* 评分与通过条件只在 I 手里：本层不定义断言、不改阈值，只引用 `scoringContract` 哈希。
* 对照拒绝条件见 [J_L4_STRATEGY_EXPERIMENT.md](J_L4_STRATEGY_EXPERIMENT.md) 第 4 节第 6 条。

## 6 给 B / C（隔离、执行器与验证）

* 本任务**不新增执行路径**：`desktop/godot/extensions/**` 不加载也不执行部件代码。
* `native: true` 的部件必须携带专项验证记录 `{ by, at, harness }` 才能通过
  `checkPartCompatibility`；本层无法自行签发。
* 部件代码真正装载时的沙箱、网络权限、Job 归属与清理仍由 B/C 负责。

## 7 给 F（底座与共享组件）

* 部件类型与接口（`desktop/godot/extensions/formats.mjs`）：
  `renderPass.run(ctx) / hudWidget.render(ctx) / postProcess.apply(frame) / perfComponent.step(ctx)`。
  与旧运行器 `app/harness/parts.mjs` 的 `renderPass/hudWidget/postProcess` 命名保持一致，
  新增 `perfComponent` 用于非视觉性能组件。
* 清单字段命名说明：第一人称用 `engine.version`、俯视/横版用 `godotVersion`；
  部件清单统一用 `engine: { name, version }`，引擎版本取值对齐 `desktop/godot/toolchain.lock.json` 的 `version`（`4.7.2-stable`），
  运行时自报为 `4.7.2.stable`，比对时按 lock 的写法。
* 若底座要新增可替换点，请给 J 一个"底座 → 部件类型"的映射，并说明该点在 GDScript 下为何不够用
  （否则按 L1 处理）。
