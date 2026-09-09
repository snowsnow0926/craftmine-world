# H 接口契约（作品复用 / 旧世界转换 / 完整备份）

任务标识：`godot-remaining-20260910-H`
状态：**实现中**。本文件是 H 与 E/L/K、A/D/I 的共享契约，标识符与错误码是最终代码中的字面量。

## 0 归属与边界

- H 独占：`crates/craftmine-core/src/library.rs`、`library/packages.rs`、`library/reuse.rs`、`backups.rs`、`backups/complete.rs`、`legacy.rs`、`legacy/convert.rs`、`plugins/craftmine-world/reuse-service.mjs`。
- 不在 H 范围：`lib.rs` / `main.rs` 的方法登记、`TABLES` 之外的共享 schema、`plugins/craftmine-world/view.mjs`、`electron/main/index.ts`、`craftmine-operation-journal.ts`、`craftmine-panel-gateway.ts`。H 提供登记片段（`REGISTRATION_H.md`），由 A 与主任务接入。
- 内容存储只有一套：作品正文仍然存在 `craftmine_library`。`craftmine_packages` 只保存“可安装作品”的注册记录（引用 + 兼容声明 + 依赖 + 迁移），不复制正文。

## 1 包 manifest

`craftmine.package/1`，由 `package.register` 写入 `craftmine_packages`：

```jsonc
{
  "format": "craftmine.package/1",
  "ref": {"id": "saved-<32hex>", "version": 1, "hash": "<64hex>"},   // 必须已由 library.capture 落库，精确版本
  "kind": "creation|object|gameplay|component|scene",
  "name": "…",                       // ≤240
  "description": "…",                // ≤8000
  "stateVersion": 1,                 // 实例状态版本，正整数
  "compatibility": {
    "base": "top-down",              // 底座 id；与目标世界 build.scene.baseId 完全相等
    "baseVersion": "1.0.0",          // 语义化点分版本；目标世界需 ≥ 该版本
    "engine": "4.7.2-stable",        // 与目标世界 build.godot.engineVersion 相等
    "stateFormat": "craftmine.godot-progress/1",
    "sceneFormat": "craftmine.godot-scene/1"
  },
  "dependencies": [                  // 精确版本，禁止 latest
    {"id": "…", "version": 1, "hash": "<64hex>", "optional": false}
  ],
  "parts": {
    "scene":      [{"path": "scenes/door.tscn", "hash": "<64hex>"}],
    "source":     [{"path": "scripts/door.gd",  "hash": "<64hex>"}],
    "assets":     [{"id": "…", "version": 1, "hash": "<64hex>"}],
    "components": [{"id": "…", "version": 1, "hash": "<64hex>"}]
  },
  "initialState": {"format": "craftmine.package-state/1", "version": 1,
                   "entities": {"objects": {}, "behaviors": {}, "systems": {}},
                   "fields": {}, "once": []},
  "migration": {"from": [
    {"stateVersion": 1, "operations": [ /* 见 §5 */ ]}
  ]}
}
```

- 可重建缓存（Godot 导入缓存、构建产物）**不得**出现在 `parts` 中；它们按 `rebuildable` 单独声明，完整备份会明确排除。
- `ref.hash` 与 `parts.*[].hash` 均为 64 位十六进制；写入前逐项校验。

## 2 方法

所有方法通过既有 `dispatch` 暴露；参数校验失败一律 `bail!` 带错误码字符串。

| RPC | 参数 | 结果要点 |
| --- | --- | --- |
| `package.register` | `{operationId, ref, kind, name, description?, stateVersion, compatibility, dependencies, parts, initialState?, migration?}` | `{ref, packageHash, manifestHash, compatibility}` |
| `package.check` | `{ref, target:{base,baseVersion,engine,stateFormat}}` | `{ref, compatible, reasons[], closure[]}` |
| `package.install` | `{operationId, ref, worldId, mode:"initial"\|"copy", sourceInstanceId?, position?}` | `{instanceId, worldId, ref, packageHash, stateVersion, stateHash, revision, origin, closure, credentialsIncluded:false, sessionIncluded:false}` |
| `package.list` | `{worldId?, status?, offset, limit}` | `{items[], total, next}` |
| `package.read` | `{instanceId}` | 实例记录（含 `state`） |
| `package.progress` | `{operationId, instanceId, revision, state}` | `{instanceId, revision, stateVersion, stateHash}` |
| `package.grant` | `{operationId, instanceId, key, reward}` | `{instanceId, key, granted, once[]}` |
| `package.upgrade` | `{operationId, instanceId, toRef}` | `{instanceId, fromRef, toRef, fromStateVersion, toStateVersion, stateHash, revision, migration[], preservedOnce[]}` |
| `package.uninstall` | `{operationId, instanceId, expectedRevision}` | `{instanceId, status:"uninstalled", stateHash, restorable:true}` |
| `package.restore` | `{operationId, instanceId}` | `{instanceId, status:"installed", stateHash}` |
| `package.export` | `{operationId, instanceId}` | `{package:{format:"craftmine.work-package/1",…}, packageHash, credentialsIncluded:false, sessionIncluded:false, progressIncluded:false}` |
| `package.import` | `{operationId, package}` | `{ref, packageHash, imported:true}` |
| `package.usage` | `{ref}` | `{ref, instances[], count}` |
| `backup.export-full` | `{operationId}` | `{id, kind:"export-full", status, manifest, archive, rebuildableExcluded[], credentialsIncluded:false}` |
| `backup.verify` | `{archive}` | `{valid, hash, counts, missing[], mismatched[], rebuildable[], pathEscapes[]}` |
| `legacy.convert` | `{operationId, importId, title, compiled?}` | `{worldId, sourceUnchanged:true, report:{supported[],needsReview[],unsupported[]}}` |

## 3 固定版本与依赖

- 解析只用 `ref` 中的精确 `{id,version,hash}`。`package.check` 的 `closure` 是**解析后的精确依赖闭包**（按 `id@version` 排序）。
- 任何“跟随最新”行为都是缺陷：找不到精确版本时报 `PACKAGE_VERSION_NOT_FOUND`，不会退回同 id 的其他版本。
- 依赖闭包错误码：
  - `PACKAGE_DEPENDENCY_MISSING: <id>@<version>`（非 optional）
  - `PACKAGE_DEPENDENCY_CYCLE: a@1 -> b@2 -> a@1`
  - `PACKAGE_DEPENDENCY_HASH_MISMATCH: <id>@<version>`（注册的 hash 与声明不一致）
  - `PACKAGE_VERSION_CONFLICT: <id>@<version>`（同 id 同版本不同内容）
- 兼容性错误码：`PACKAGE_INCOMPATIBLE_BASE`、`PACKAGE_INCOMPATIBLE_BASE_VERSION`、`PACKAGE_INCOMPATIBLE_ENGINE`、`PACKAGE_INCOMPATIBLE_STATE_FORMAT`、`PACKAGE_INCOMPATIBLE_SCENE_FORMAT`。每条都带 `实际值/要求值` 文本，供 E 直接展示。

## 4 跨世界安装与实例身份

- 每次安装生成**新实例身份** `ins-<24hex>`（由 `operationId` 决定，重放得到同一身份；不同 `operationId` 必然不同）。
- `mode:"initial"` 从 `initialState` 创建；`mode:"copy"` 必须给出 `sourceInstanceId`，只复制该实例的状态，并记录 `origin:{instanceId, worldId}`。`origin` 只作来源记录，不共享状态。
- 两个世界的实例进度、任务、一次性奖励互相独立：`package.progress` / `package.grant` 只写 `craftmine_package_instances` 中对应 `instance_id` 行。
- 安装、导出、导入都**不携带**用户凭据、会话数据和世界进度：结果里显式返回 `credentialsIncluded:false`、`sessionIncluded:false`，`package.export` 另带 `progressIncluded:false`。
- 重复安装同一个 `ref` 到同一个世界：不同 `operationId` 会得到不同实例（允许多个实例），不会静默复用。

## 5 升级、卸载与失败恢复

- 升级使用**声明式迁移**，只在实例状态上执行，绝不改世界进度、绝不清空：
  - `{"op":"rename","target":"object|behavior|system","from":"a","to":"b"}`
  - `{"op":"add","target":"object|behavior|system","id":"x","value":{…}}`
  - `{"op":"remove","target":"object|behavior|system","id":"x","expected":{…}}`（实际值与 `expected` 不等 → 拒绝）
  - `{"op":"renameField","from":"a","to":"b"}` / `{"op":"addField","id":"x","value":…}` / `{"op":"removeField","id":"x","expected":…}`
  - `{"op":"preserve","path":"once"}`：保留一次性奖励/消耗账本
- 缺少从 `stateVersion` 到目标版本的迁移路径 → `PACKAGE_MIGRATION_MISSING: <from> -> <to>`。
- 迁移会丢弃仍有数据的字段或实体、且没有对应声明 → `PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS: <path>`。系统**不会**静默清空进度，也不会自动从初始状态重建。
- 升级失败时事务回滚：实例保持旧 `package_version` 与旧 `stateHash`（有测试断言）。
- 一次性奖励：`once` 账本在升级时保留，`package.grant` 以 key 幂等，升级前后同一 key 只发放一次。
- 卸载只改 `status='uninstalled'`，保留状态；`package.restore` 可恢复；若版本已不可用 → `PACKAGE_VERSION_UNAVAILABLE`。
- 同一 `operationId` 重放返回首次结果；不同参数复用同一 `operationId` → `REPLAY_MISMATCH`。

## 6 完整备份

- `backup.export-full` 产出 `craftmine.complete-backup/1`：
  - `domain`：与 `backup.export` 相同的域快照（世界、任务、进度、作品库、包注册、实例）。
  - `content`：不可重建内容的清单与哈希（作品正文、素材、依赖、包 manifest、旧世界封存归档的 manifest + 文件哈希、来源记录）。
  - `rebuildable`：明确列出的可重建缓存（Godot 导入缓存、构建产物、导出产物），带 `reason`，**不进入**归档字节。
  - `provenance`：来源世界/构建/应用/检查记录引用。
- `backup.verify` 逐项报告：`missing`（文件不存在）、`mismatched`（哈希不符）、`pathEscapes`（归档内路径逃逸）、`rebuildable`（已排除项）。任一 `missing`/`mismatched`/`pathEscapes` 非空时 `valid:false`，绝不静默通过。
- 恢复沿用既有原子事务；失败不改变当前域状态。

## 7 旧世界转换

- `legacy.convert` **只生成副本**：新 `worldId`（`legacy-<12hex>`），源归档与源世界字节不变，结果里 `sourceUnchanged:true`。
- 未给出 `compiled`（受信任兼容编译器产物）时，副本保留旧底座运行：报告把每一项标为 `kept-on-legacy`。
- 给出 `compiled` 时，逐项报告：
  - `supported`：简单几何/布局/碰撞、PNG/JPEG/静态 GLB、背包/生命/装备/任务（状态版本已知）
  - `needsReview`：会话/需求/记忆归属需要重新绑定
  - `unsupported`：带骨骼/动画 GLB、外链 glTF、FBX、MP3、旧 JS 玩法与扩展（保留旧底座），每项带 `code` 与 `detail`
- 归档损坏、哈希不符、路径逃逸 → 失败且不创建世界。

## 8 给 E/L/K 的失败原因

`plugins/craftmine-world/reuse-service.mjs` 提供 `explain(code)`，把上述错误码映射为 `{title, detail, action}` 中文可读文本；未知码返回原始码并标记 `unknown:true`。兼容矩阵用 `compatibilityMatrix(report)`，迁移报告用 `migrationReport(receipt)`。
