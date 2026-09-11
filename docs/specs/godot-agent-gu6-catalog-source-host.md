# GU6 catalog source import: private host contract

The public panel operation is `package.request` with method
`importCatalogSource` and params exactly `{worldId, operationId, ref}`. The ref is
exactly `{assetId, version, contentHash}` for one immutable catalog version.
Neither the page nor a model may supply an owner, filesystem path, archive bytes,
execution context, provenance, or an installer method. The catalog proposal and
catalog metadata do not grant installation authority.

## Owner and acceptance boundary

The Main gateway supplies a private third callback argument containing fixed
`projectId`, nullable `sessionId`, selected `worldId`, and `assertCurrent()`.
Sessionless worlds use `world-<worldId>` as their owner project. The callback
rechecks selected world, viewing session, current project identity and active
turn across host asynchronous work. Main additionally checks its global active
turn/finalization and existing world-operation gates. The old file import API
and its picker grants remain compatible.

The host checks this owner after catalog reads and blob validation, immediately
before sending private `installSource`, and before confirming its response. The
private dispatch is the accepted operation boundary. Once accepted, the existing
installer owns an independent fixed-world transaction and lease; it may finish
the original world's source/check if the UI switches while that transaction is
running. It never changes destination to the new UI owner. A committed response
is retained, but the changed UI owner receives `PACKAGE_OWNER_CHANGED`, not
confirmation. The original owner can retry the same operation to recover it.
This does not apply the candidate to formal play progress automatically.

## Exact catalog and body checks

The host uses the existing private `asset.request/read` wrapper around canonical
`asset.read({assetId, version})`; no new raw read channel is added. It compares
all three version identity fields with the submitted ref, requires exactly one
file and `fileCount=1`, ZIP MIME `application/zip`, a positive bounded byte count
not exceeding 5 MiB, matching version total bytes, and a lowercase SHA-256.

It then uses the existing private `asset.bodyPath`. Asset/version/path/MIME/size/
SHA must equal the verified file metadata. Only this private response provides
the disk path. Ordinary-file checks reject linked path components and nonfiles;
a bounded read checks stable length/mtime, actual byte length and ZIP digest.
The original downloaded file is not needed. No catalog blob is executed here.
Verified bytes enter the original `installSource` CP0/CP1 unpack, source
requirements, plan, source transaction and isolated check pipeline. Existing
LPAC execution remains the only external-material engine path.

The catalog `contentHash`, entire ZIP SHA-256 and contained resource
`contentHash` are distinct. The first two are checked at the host boundary; the
third is checked by the unchanged original package parser and core planning.
An outer catalog hash or matching ZIP cannot substitute for a valid resource.

## Durable identity and retry

The existing installer's `intent.json` gains optional host provenance:

```json
{
  "format": "craftmine.catalog-source-install/1",
  "ref": {"assetId": "catalog-entry", "version": 1, "contentHash": "<catalog SHA>"},
  "archiveSha256": "<entire ZIP SHA>",
  "owner": {"projectId": "world-example", "sessionId": null, "worldId": "example"}
}
```

The host constructs it after validation; public fields cannot override it. The
installer validates its finite shape and checks its ZIP digest. It participates
in the existing request hash under the unchanged `(worldId, operationId)` key.
Before binding/planning a new catalog operation, the same intent file is written
as a provenance reservation; after planning it gains the ordinary apply/check
state. There is no second registry. A different ref or owner conflicts even when
the ZIP is identical, including after a restart or an early planning failure.
Legacy requests without provenance retain their prior request hash identity.

Same-operation retries coalesce in Main; cold retries revalidate the catalog blob
and reach the existing durable installer, which reuses its source receipt and
job. Temporary paths, timestamps and random grants are absent from provenance.
The returned catalog grant ID is deterministically derived from this fixed
operation identity, so a successful cold replay has the same projected receipt.
It cannot be used with the old `repeatImportSource` method. New independent
installation requires a new player-generated operation ID.

If a catalog grant expires after a lost response, an explicit same-operation
retry performs fresh asset.read/bodyPath/byte/owner checks and creates a new
valid grant for the same fixed ZIP. It never accepts the expired grant. The
operation retains its first verified ZIP hash in memory; the durable provenance
enforces the same hash after restart. Corrupt or changed data fails renewal.
Legacy file-picker grant expiry behavior is unchanged.

## Response and errors

Success keeps the existing bounded receipt fields: status, `applied:false`,
worldId, operationId, opaque grantId, instanceIds, archiveSha256, source revision/
manifest/commit/lock hashes, and a projected job id/status. It adds `catalogRef`.
Private context, blob path, base64, requests and source bodies are never returned.
Only `check-queued` and `source-saved-check-blocked` are successful dispatch
receipts; they do not claim functional validation or adoption.

Wrong catalog identity produces `PACKAGE_CATALOG_IDENTITY_MISMATCH`; a non-single
ZIP produces `PACKAGE_CATALOG_SINGLE_ZIP_REQUIRED`; invalid ZIP metadata produces
`PACKAGE_CATALOG_ZIP_INVALID`; mismatched private body metadata produces
`PACKAGE_CATALOG_BODY_MISMATCH`; actual corrupted bytes produce
`PACKAGE_CATALOG_BLOB_MISMATCH`. Operation/ref/owner conflicts are surfaced as
`PACKAGE_OPERATION_CONFLICT`, owner changes as `PACKAGE_OWNER_CHANGED`, and active
turns as `ACTIVE_TASK_EXISTS`. Other uncertain errors remain failures to confirm,
not a claim that no source was written.

Preflight errors prove only that this attempt did not dispatch the installer.
On an uncertain or cold retry an older durable operation may already exist;
those error codes alone must not be interpreted as `sourceSaved:false` or an
authorization to silently choose a new ref/operation. A new page is not given a
private provenance or arbitrary cancellation capability.
The UI may release only its own freshly generated operation after a first-attempt
exact preflight rejection with no prior uncertain outcome. Once any unknown
response, timeout or owner change has occurred, later preflight failure cannot
erase that uncertainty. The tests preserve a previously committed source while
subsequent expired-grant renewal fails on catalog/blob changes.

## Validation scope

`tests/godot-agent/catalog-source-host.test.mjs` uses the real host service,
gateway, static ZIP parser and installer with a real on-disk intent store. Its
core calls are explicitly fixture responses, not claimed engine evidence. It
tests deleted downloads, successful cold replay without duplicate source/job,
same-ZIP reference/owner conflicts across restart, lost or stale-owner replies,
all metadata/body/digest boundaries, inner resource hash rejection, asynchronous
owner/active transitions, expired/method-mismatched grants, early reservations,
linked/oversized blobs, provenance injection and malformed private receipts.

Existing file-import/export, caller, gateway and lease lifecycle regressions also
run against this change. Root integration owns the separate real packaged client
and core/LPAC check/application/cold-open validation. This host slice performs no
model calls, real input, focus manipulation or engine execution.

Validated on the independent `5ea4a7da` worktree: 32 tests passed (15 catalog-host,
six legacy native package, two original installer, six lease lifecycle, and three
gateway regressions), full desktop TypeScript checking passed, and the actual
plugin build completed. The first test ZIP lacked its required `.gd.uid` and
correctly failed draft planning; the fixture was repaired. Initial build/test
startup lacked the local built adapter and Babel dependency; the original build
was then run using existing verified workspace dependency directories. No failed
startup or malformed fixture was counted as successful verification.
