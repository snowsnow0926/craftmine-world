# Native component file service

`createCraftminePackageService({domainCall,selection,pickFile})` exposes
`request('package.request', {worldId,method,params:{worldId,...}})` and `dispose()`.
`selection()` returns the selected world ID asynchronously. The picker receives
`{kind:'export-source'|'open-source',suggestedName?}` and returns a selected
absolute path or null. Root owns this construction and native gateway routing.

`sourceList` and `exportSource` forward to the trusted plugin with
`domainCall('package.request',{method,args})`. The exporter hashes and saves the
private returned bytes using the existing fsynced temporary-file writer.
The renderer receives only export metadata. Source listing is capped at 512
objects with an explicit truncated indication, not silent completeness.

`importSource({worldId,operationId})` selects and reads a ZIP; its opaque grant
binds world, file SHA-256 and a ten-minute expiry. `repeatImportSource` accepts
that `grantId` with a fresh `operationId`. Both forward only to private
`installSource`, using base64 internally. Every retry verifies the original
file and preserves the original operation; it never silently opens a different
file after an uncertain install result. Receipts are projected to source hashes,
revision, commit, instance IDs and public job status; private task bindings,
request bodies and artifact paths are not sent to the page.

Bounds are 5 MiB per ZIP, eight grants and 64 operation records per service
lifetime. Selection is rechecked around awaits. Every path component is checked
for links; regular files are read through bounded handles and hashed. Unknown
errors are reduced to a path-free public code. The native service never unpacks
or runs an imported project. The trusted installer has its own archive limits,
content/path checks, atomic source transaction and real executor admission.

Grants and native operation records are process-local. A full client restart
requires a new file selection; the installer's durable source intent survives,
but this service does not claim a cross-restart native grant recovery UI.
Root's final product acceptance must retain/recover the original install
operation before offering a new installation after an unknown result.

## Evidence

`package-native.test.mjs`: five passing groups covering lost-result retry,
fresh repeat IDs, world/hash/expiry rejection, response projection, path
injection, 5 MiB limit, an actual junction to another task-owned temp directory,
export bytes and disposal. Nothing outside the new fixture is modified.

`package-source-core.mjs` now includes this compiled native service. Seven
checks pass through native export, native file grant, real source/ZIP/Rust
transactions and hash-pinned headless Godot interaction with two independent
authored doors. There is no test executor registration and the real check job
is explicitly blocked. This does not claim final product/model acceptance.

## 持久源码安装请求期限（2026-09-12）

私有 `package.request` 中，只有 `installSource` 与 `installSourceProposal` 使用现有源码事务的 60 秒传输等待期限。普通包读取、查询和导出保持原来的 15 秒；不改变模型预算、权限或安装语义。原生 `importSource`/`repeatImportSource` 会正常映射到私有 installSource。

请求超时仅表示调用方没有及时取得回执，不证明底层未保存、未排队或已回滚。禁止据此自动重复安装；保留原 operationId、源码版本和检查任务，先通过正常状态/历史入口核对。本次调整解决已复现的约 16.5 秒安装超过旧 15 秒传输期限，不能承诺任意规模项目都在 60 秒内完成。
