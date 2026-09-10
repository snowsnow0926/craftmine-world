# Private target feedback authoring service

This is the bounded PP2 **generate an adjustment draft and check it** flow. It
is not isolated instant preview. The only adjustable property remains the
integer `hitFlashMilliseconds` declared by `fp.target.feedback/1`; the patcher
and source identity rules are specified in `target-feedback-configuration.md`.

## Private calls

`targetFeedback.describe({worldId})` requires the selected Godot first-person
0.1.0 world. It returns `worldId`, formal `buildId`, `targets`, `unsupported`
and `scope: "instance"`. Each target has `targetId`, its node-name `label`,
the exact configuration declaration, current `values`, and a binding:

```json
{
  "format": "craftmine.target-feedback-source/1",
  "worldId": "selected-world",
  "buildId": "formal-build",
  "contentOid": "formal-source-oid",
  "revision": 1,
  "manifestHash": "source-manifest-sha256",
  "targetId": "target_a",
  "targetHash": "opaque-target-and-dependencies-sha256"
}
```

`targetFeedback.submit({worldId,operationId,targetId,binding,values})` accepts
that exact binding and `values: {hitFlashMilliseconds: integer}`. The caller
keeps the same operation ID and exact payload when retrying a lost reply. A
different request with the same operation ID is rejected. A no-op has a durable
`unchanged` receipt and starts neither a source transaction nor a check.

`targetFeedback.status({worldId,operationId})` reads this service's own durable
operation and waits for any in-flight submission. It uses the existing package
job lifecycle, including end-turn finalization before exposing terminal status.
The response contains `worldId`, `operationId`, `targetId`, `status`,
`applied: false`, `draftRetained`, source revision/hash, and a projected `job`
with `jobId`, `status`, `buildId`, and nullable `candidateId`. No private task
binding, source bytes, filesystem path, executor token or arbitrary RPC is
exposed. No model tool is added.

## Source transaction and replay

Description and fresh submission require Git `main == applied`, and exact
formal export identity must match the current world build. The service obtains
an existing read-only source context, reads the pinned main source index in
bounded pages/chunks, validates all file hashes, and compares its complete file
inventory with the formal export. Main scene and target resolution are private.

One edit starts an owned task, calls `godotProject.applyFiles` with one scene
file, expected file hash, source revision/hash, expected main/applied OIDs and
formal progress revision, then calls `godotBuild.start` once in check mode. It
uses the existing executor and candidate path. The parameter flow never calls
application or progress mutation APIs.

The exact transaction, task binding, receipts and job request are persisted in
the private plugin data directory using synced temporary-file replacement.
On retry, source/job receipts are queried **before** a fresh head check, so an
already-written draft cannot turn a lost reply into a duplicate edit. Replays
reuse the same job. A failure after source commit but before a check receipt
returns `interrupted`, `draftRetained: true`, and
`TARGET_FEEDBACK_CHECK_REQUIRES_DRAFT_RECOVERY`; it does not revive an ended
task or create a second check. A failure before any turn may be retried with
the same operation. New operations reject any unapplied draft.

## UI and remaining integration

The UI must say “生成调整草稿并检查”. After a passed job it may use the existing
candidate preview and explicit adopt flow. Closing candidate play retains the
draft; it must not automatically roll back unrelated work. There is no parameter
cancel endpoint. Failed/blocked checks retain their draft and need the existing
draft/history recovery flow before another parameter edit. This limited service
does not provide a new isolated branch or rollback system.

The platform's existing version-adoption checks still protect latest formal
progress after asynchronous checks. The UI, real engine hit-flash observation,
candidate adopt/cancel and complete client restart are integration acceptance,
not claimed by the service tests.

## Validation

```text
node --test tests/player-product/target-feedback-configuration.test.mjs tests/player-product/target-feedback-service.test.mjs
CRAFTMINE_CORE_BIN=<current-core-executable> node tests/player-product/target-feedback-core.mjs
```

The latter uses real Rust/SQLite/Git transactions and receipts with an explicitly
fixed executor fixture. It does not run Godot or claim a real engine check. It
proves one adjustment write/check, unchanged formal build and full progress,
draft refusal and same-operation restart replay. It leaves the owned temporary
profile and complete `calls.json` evidence rather than deleting failures.
