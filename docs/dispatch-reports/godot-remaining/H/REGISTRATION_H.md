# H 登记补丁（由 A 与主任务接入，H 未修改这些文件）

任务标识：`godot-remaining-20260910-H`
H 的分支：`codex/godot-remaining-h-20260910`

H 的模块是既有模块的**子模块**，因此 `lib.rs` **不需要**新增 `mod` 或 `migrate` 调用：

- `library.rs` 顶部已有 `mod packages; mod reuse;`，`library::migrate` 已调用两者（H 内完成）。
- `backups.rs` 顶部已有 `mod complete;`（H 内完成）。
- `legacy.rs` 顶部已有 `mod convert;`，`legacy::migrate` 已调用 `convert::migrate`（H 内完成）。
- `backups.rs` 的 `TABLES` 已加入 `craftmine_packages`、`craftmine_package_operations`、`craftmine_package_instances`、`craftmine_package_instance_operations`、`craftmine_legacy_conversions`；旧归档缺少这些表时用**实时列定义**补空表，因此 `SCHEMA_VERSION` 保持 3，未改动 `durable_tests.rs` / `memory_receipt_tests.rs` 的冻结断言。

## 1 `vendor/pi-desktop/crates/craftmine-core/src/main.rs`

在第一个 `match method {`（现有 `library.*` 附近）加入：

```rust
        "package.register" => return journal.package_register(params),
        "package.check" => return journal.package_check(params),
        "package.install" => return journal.package_install(params),
        "package.list" => return journal.package_list(params),
        "package.read" => return journal.package_read(params),
        "package.progress" => return journal.package_progress(params),
        "package.grant" => return journal.package_grant(params),
        "package.upgrade" => return journal.package_upgrade(params),
        "package.uninstall" => return journal.package_uninstall(params),
        "package.restore" => return journal.package_restore(params),
        "package.export" => return journal.package_export(params),
        "package.import" => return journal.package_import(params),
        "package.usage" => return journal.package_usage(params),
```

在现有 `backup.*` 分支后加入：

```rust
        "backup.export-full" => return journal.backup_export_full(params),
        "backup.verify" => return journal.backup_verify(params),
        "backup.restore-full" => return journal.backup_restore_full(params),
        "backup.content-usage" => return journal.backup_content_usage(params),
```

在第二个 `match`（现有 `legacy.*` 分支）加入：

```rust
        "legacy.convert" => return journal.legacy_convert(params),
```

方法签名全部是 `fn(&mut self, &Value) -> Result<Value>`（`backup.verify` / `package.read` 等只读方法是 `&self`），与既有写法一致。

## 2 `plugins/craftmine-world/workbench-service.cjs`（E / 主任务）

`channels` 映射加入下列条目（`worldId` 由该服务从已校验的选择中取出，**不**出现在这些字段里）：

```js
  'package.check':['ref','target'],
  'package.register':['operationId','ref','kind','name','description','stateVersion','compatibility','dependencies','parts','initialState','migration'],
  'package.install':['operationId','ref','mode','sourceInstanceId','position'],
  'package.list':['status','offset','limit'],
  'package.read':['instanceId'],
  'package.progress':['operationId','instanceId','revision','state'],
  'package.grant':['operationId','instanceId','key','reward'],
  'package.upgrade':['operationId','instanceId','toRef'],
  'package.uninstall':['operationId','instanceId','expectedRevision'],
  'package.restore':['operationId','instanceId'],
  'package.export':['operationId','instanceId'],
  'package.import':['operationId','package'],
  'package.usage':['ref'],
```

调用示例（`world` 是 `selected(host,payload.worldId)` 的结果，`args` 已去掉 `worldId`）：

```js
if (channel.startsWith('package.')) {
  const args = { ...payloadWithoutWorldId };
  if (channel === 'package.install') args.worldId = world.world.id;
  if (channel === 'package.list') args.worldId = world.world.id;
  return reuse[method](args);   // reuse = createReuseService({call})
}
```

`plugins/craftmine-world/domain-adapter.mjs` 追加一行（与既有 library/memory 并列）：

```js
export {createReuseService} from './reuse-service.mjs';
```

## 3 `vendor/pi-desktop/apps/desktop/electron/main/craftmine-panel-gateway.ts`

`CRAFTMINE_PANEL_CHANNELS` 加入：

```
"package.register", "package.check", "package.install", "package.list", "package.read",
"package.progress", "package.grant", "package.upgrade", "package.uninstall", "package.restore",
"package.export", "package.import", "package.usage",
"backup.export-full", "backup.verify", "backup.restore-full", "backup.content-usage",
"legacy.convert",
```

`backup.*` 前缀路由已经会剥掉 `worldId` 并转发给 `options.backup`，新增的 `backup.export-full` / `backup.verify` / `backup.restore-full` / `backup.content-usage` 因此无需额外分支。`legacy.convert` 走 `workbench(channel)`，与 `library.*` 相同。

## 4 `vendor/pi-desktop/apps/desktop/electron/main/craftmine-operation-journal.ts`

`allowed`（持久化操作）建议加入：

```ts
  "package.install": ["ref", "mode", "sourceInstanceId", "position"],
  "package.upgrade": ["instanceId", "toRef"],
  "package.uninstall": ["instanceId", "expectedRevision"],
  "package.restore": ["instanceId"],
  "package.import": ["package"],
  "backup.export-full": [],
  "backup.restore-full": ["expectedCurrentHash"],
```

`identity()` 无需特例：`package.install` 的参数里没有易变的 revision。

`receipt()` 的 `keys` 允许列表必须追加 H 的收据字段，否则收据会被判为 `INVALID_OPERATION_RECEIPT`：

```
instanceId, worldId, ref, packageHash, manifestHash, stateVersion, stateHash, revision, status,
origin, position, closure, fromRef, toRef, fromStateVersion, toStateVersion, migration,
preservedOnce, key, granted, once, restorable, imported, needsRevalidation, contentHash,
report, keptOnLegacyBase, sourceUnchanged, sourceImportId, sourceManifestHash, manifest,
rebuildableExcluded, archive, format, valid, schemaVersion, domainHash, counts, missing,
mismatched, pathEscapes, verified, rebuildable, restore, contentVerified, verifiedFiles,
sessionIncluded
```

## 5 未接入时的行为

上述登记未完成时：Rust 单元测试、`tests/godot-remaining/H/reuse-service.test.mjs` 与 `node --test` 均按 H 交付物独立通过；只有 `package.*` / `backup.*-full` / `backup.verify` / `legacy.convert` 的端到端 RPC 通道不可用。H 不把这部分计为已完成，见 `REPORT_H.md` 的“未完成项”。
