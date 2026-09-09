# Portable backup activation

The native backup service uses `backup.exportPortable`, `backup.inspectPortable`
and `backup.verifyPortable`. It never serializes the legacy domain-only JSON as
a complete backup. Native file selection stays private; the panel receives an
expiring grant bound to the file hash and verified archive hash. File hashing
streams through a 1 MiB buffer with the core's 256 GiB archive ceiling.

The private plugin service is constructed as
`createPortableRestoreService({core, rootDirectory: pluginDataPath})`.
`backup.restorePortableActive` forwards only
`{operationId, archivePath, archiveHash, expectedCurrentHash}` to `restore`.
The native grant supplies the path; this is not a panel/model RPC.
Portable core calls need a bounded 120-second timeout rather than the normal
5-second interactive timeout. Large archives exceeding that duration remain a
job/progress integration limitation, not a claimed cancellable background job.

The service restores into a controlled sibling
`.craftmine-restored/<root digest>/<operation digest>/data`. Full root and
request identities remain in `activation.json`; shortened directory names
reduce Windows Git path pressure, and any hash-name collision fails identity
validation. No existing data directory is overwritten or deleted.

`CoreClient.exclusive` rejects in-flight/new callers, drains earlier ordered
requests through a barrier, then permits the private transition. The old core
is stopped before the restored core starts. A restored core must prove the
exact `operationId`, `archiveHash` and `domainHash` through
`backup.restoreProof`, which reads the mark committed with the restore
transaction. The returned initial `currentHash` is not required to equal a
post-startup fingerprint: recovery metadata legitimately changes it.

After proof succeeds, an fsynced temporary file atomically replaces the small
relative activation pointer in the original plugin data root. Future
`CoreClient(binary, originalPluginDataPath)` instances resolve the pointer,
validate its controlled path and host marker, and verify the core's durable
restore proof before returning ready. Links and arbitrary pointer paths are
refused. Failure during activation attempts to restore the previous pointer
and restart the prior core. A failed rollback is surfaced explicitly; neither
directory is deleted. Marker flushes do not claim all storage-controller or
Windows directory-metadata power-loss guarantees.

## Native lifecycle integration

The index constructs the native service with:

- `beforeRestore({operationId, worldId?})`: pause/checkpoint/close the current
  runtime and stop old tasks/executor admission before returning. If the
  checkpoint changes the hash the user inspected, restore fails stale; obtain
  a fresh grant instead of silently rebasing that confirmation.
- `afterRestore({operationId, activated, result?})`: when activated, clear old
  workspace/runtime bindings and refresh/reopen the restored profile. Existing
  interrupted tasks still require the normal explicit recovery protocol;
  restoration never invokes a model. When not confirmed, inspect the actual
  core state before reopening anything: a transport failure can hide a
  successful activation, so `activated:false` is not proof of the old profile.

Missing lifecycle hooks refuse restore. The success projection includes
`activated:true`, `currentHash` and `rebuildRequired`, with no private paths.
Restored export/check artifacts remain rebuild-required according to core
policy. The service does not automatically rebuild or apply them.

Cancellation is supported before starting the core operation. Once streaming
or activation starts, the service returns `BACKUP_OPERATION_NOT_CANCELLABLE`
rather than claiming an abort it cannot deliver through the serial core
connection. An explicit retry preserves the exact operation and grant. A
completed activation is recoverable after a lost response or client restart.

## Acceptance

`tests/godot-final-install-assets/portable-core.mjs` compiles the real native
service and runs it against a fixed real Rust binary in fresh temporary data.
It verifies body/Git export, header versus full verification, opaque grants,
callback order, activation, new-client restart, explicit task recovery/source
reads, exclusive admission, injected new-core startup failure and rollback,
forged pointer rejection, and preservation of the original directory.
This is service integration, not an assertion that the final Electron index
callbacks or a user model session have already passed.
