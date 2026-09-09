# Spec: asset preview attempt identity and reclaim approval

Owner: task S5 (asset catalog, preview service, asset panel components).
Consumers: S1 (core entry point, total recycler), S2 (plugin service wiring),
R2 (panel/navigation channels), S4 (backup pins).

## 1. Two identities, never one

A preview has two independent identities:

* **Cache identity** — `contentHash + previewerVersion + engineVersion +
  settingsHash`. It answers "have we already decoded exactly these bytes with
  exactly these settings". It is the durable row key in
  `craftmine_asset_previews`.
* **Execution identity** — `(attempt, claimId)`, issued by the core. It answers
  "which run owns the right to write a result". It is never derived from the
  caller and never reused across attempts.

## 2. `asset.previewBegin`

Input `{assetId, version, settingsHash?, owner?, force?}`.

* No row: create attempt 1, claim, deadline `now + PREVIEW_CLAIM_TTL_MS`.
* Live pending claim and not forced: return the **same** claim with
  `cached:true, resumed:true`. Two hosts can never run the same decode twice.
* `ok`/`partial` and not forced: `cached:true, claim:null`; the decoder is not
  re-run.
* `failed`/`timeout`/`cancelled`/expired, or `force:true`: attempt + 1 with a
  new claim, `retried:true`.

A pending claim older than the TTL is swept to `failed` /
`PREVIEW_CLAIM_EXPIRED` by `asset_preview_sweep`, called before every
begin/finish/read, so a crash or restart can never leave a permanent pending
row.

## 3. `asset.previewFinish`

Input adds the mandatory `claimId` and `attempt`.

* Same `operationId` + identical args: idempotent replay, `replayed:true`.
* `claimId`/`attempt` not the live claim, or the slot already terminal: returns
  `{applied:false, stale:true, reason:"STALE_PREVIEW_ATTEMPT"}` as a **normal
  result**. A late worker result, a superseded attempt or a fabricated claim
  never becomes an `OPERATION_CONFLICT` and never overwrites the current state.
* Owning attempt: writes status/facts, clears the claim, records the operation.
  `ok`/`partial` still require decoder evidence (`decoder` + sha256 `digest`).

Cancel is `previewFinish` with `status:"cancelled"` from the owning attempt: it
is that attempt's terminal state. The plugin service additionally aborts the
live worker (`AbortSignal`), and `runPreviewInWorker` terminates the worker.

## 4. Service and panel contract

* Plugin service (`plugins/craftmine-world/asset-service.mjs`):
  `preview()` runs begin -> body -> worker -> finish bound to one claim and uses
  `preview-<cacheKey>-a<attempt>-<claimId>` as the operation id; `cancel()`
  aborts the live worker and closes the attempt; a `NO_ACTIVE_ATTEMPT` result
  never rewrites a cached ok preview.
* Panel (`src/components/craftmine/assets/`): calls the service channels
  `asset.preview` and `asset.cancel`; snapshot data and action names are
  disjoint (`scanResult` vs `scan`); superseded preview results are dropped by
  generation, not hidden.

## 5. GLB preview

Accessor/topology parsing and the rendered picture are separate facts:
`accessorParsed:true` plus `geometryDigest` describe the structure;
`rendered:true`, `renderer:'glb-software-raster/1'`, `renderWidth/Height` and a
pixel `digest` describe a real offscreen software raster. A structure that
cannot be rendered is `partial` with `picture:false` and a `renderReason`; it is
never reported as a rendered model.

## 6. Reclaim approval

`asset.reclaimPlan` (read-only) lists versions with **no usage relation** and a
canonical `planHash`/`planId`. `asset.reclaimCommit` re-derives the plan and
refuses a stale hash (`ASSET_RECLAIM_PLAN_STALE`), an entry that is not a
candidate (`ASSET_RECLAIM_NOT_APPROVED`) or a version with a usage row
(`ASSET_RECLAIM_PROTECTED`), then deletes only the approved rows and only
unreferenced bodies. The approval policy, the pin aggregation and the
"callers cannot forge protected refs" hardening belong to S1; pins that must
protect an asset are recorded as usage rows (for example
`refKind:"backup-retention"`).
