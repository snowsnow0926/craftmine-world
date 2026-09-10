# Local issue records (PP3a)

Status: main-process service implemented; client integration is owned by the parent change.

## Scope

The player may store an immutable description of a problem encountered in a
formally loaded Godot world. This is a local notebook, not an AI diagnosis or
a claim of reproduction. No model, network, screenshot, console, observation,
world snapshot, credential, export or world-save API is a dependency.

The host supplies the profile-owned directory, client version/optional source
commit and a `captureContext()` callback. The callback must reject candidate,
startup, restore, copy and switch transitions. It projects the selected formal
descriptor and live instance into:

```ts
type IssueContext = {
  phase: 'formal'; status: 'ready'; runtimeTarget: 'godot-web';
  worldId: string; buildId: string; baseId: string; baseVersion: string;
  instanceId: string; artifactManifestHash: string;
};
```

`baseVersion` is the verified formal snapshot's `baseVersion`; its `baseId`
must match the descriptor. The snapshot itself must not cross this interface.
An already loaded ready/paused/saved runtime can be projected to `ready` by
the trusted callback. A UI-selected world ID alone does not prove readiness.

On a new creation the service calls the callback twice, requires the requested
world and every projected field to match, and records that captured identity.
An identity change rejects the request; it never silently rebinds it. Each
callback has a five-second bound. No state mutation, save, pause or resume is
performed. Missing or unusable identity prevents creation; existing records
remain readable with no running runtime. The panel gateway must bind every
request, including reads/deletes, to the host's selected world.

## Contract

Factory: `createCraftmineIssueService({directory, client, captureContext, now?})`.
`fault` is a test dependency only and is not an IPC parameter.

| Channel | Parameters after host binding | Result |
| --- | --- | --- |
| `issue.create` | `worldId, operationId, description` | `status:'completed', replayed, issue:IssueRecord|null, deleted` |
| `issue.list` | `worldId, offset?, limit?` | `items, total, nextOffset, limits, usage, scope:'local-profile', backupIncluded:false` |
| `issue.read` | `worldId, issueId` | `issue:IssueRecord` |
| `issue.delete` | `worldId, issueId, operationId` | `status:'completed', issueId, deleted:true, replayed` |

A record contains `format:'craftmine.local-issue/1'`, generated `id`, original
`description`, ISO `createdAt`, projected `context`, `client`, `status:'recorded'`,
`scope:'local-only'`, `reproduction:'not-attempted'` and `attachments:[]`.
List summaries replace the description with a 160-code-point preview and are
ordered newest creation first. Listing defaults to 20 entries, at most 50.
The returned `total` belongs to the world; `usage` is the entire local notebook.
It counts `records`, `createdRecords` and `receipts`.

Every character is preserved, including leading/trailing whitespace, newlines,
tabs, Unicode and markup. Empty/all-whitespace/NUL/ill-formed Unicode and over-limit
input reject. A future UI must use text rendering, not HTML or instructions.
No mutation channel exists for the original description or identity.

## Bounds and persistence

- At most 100 active records and 2 MiB serialized ledger bytes.
- The complete original description is at most 4096 UTF-16 units and 16384 UTF-8 bytes.
- At most 512 lifetime create receipts and 1024 total mutation receipts.
  One delete receipt slot is reserved per creation. Deleting records releases
  active-record/byte capacity but does not recycle operation identities.
- At most 16 queued/running requests per canonical directory in the process.
  Factories share the queue and reread disk; responses are detached clones.

The dedicated directory contains one `issues.json` ledger. Unique files are
created exclusively with private-file mode, fully written and file-synced,
then atomically renamed over the ledger without first removing the old file.
Replies follow rename. A lost post-commit response is resolved with the same
operation ID and original parameters. Reusing an ID with different parameters
rejects. A create retried after deletion returns `issue:null, deleted:true`;
it never resurrects the description.

Process interruption before rename leaves the old ledger and a bounded owned
temporary file. The next operation validates and removes such temporaries.
Interruption after rename recovers the committed receipt. Corrupt/oversized
ledgers, hardlinks and symlink/junction ancestors fail closed. Cleanup never
follows links or removes unrecognized files. In-memory mutations are not cached
after failed writes. Filesystem errors are translated to path-free codes.

This store relies on Electron's existing exclusive ownership of a user profile.
Simultaneous writers in separate processes are not supported; this is not a new
cross-process lock service. File sync and atomic replacement were tested for
process interruption, not storage-controller loss or power-outage durability.
Same-user adversarial filesystem races are not an OS sandbox guarantee.

Deletion removes the description/identity record. Minimal operation receipts
(world, operation/issue identifiers, request hash) remain to prevent replay
resurrection. This is not forensic secure erasure. Lifetime receipt capacity
needs a future explicit archive/rotation design; the first slice neither drops
history automatically nor tells players deletion restores that capacity.

The notebook is local to the profile and excluded from existing domain backups,
portable restores and creation packages. Restoring world data neither imports
nor rewrites these original records; missing old builds are not reconstructed.

## Errors

`ISSUE_INVALID_INPUT`, `ISSUE_CONTEXT_UNAVAILABLE`, `ISSUE_CONTEXT_NOT_READY`,
`ISSUE_WORLD_CHANGED`, `ISSUE_NOT_FOUND`, `ISSUE_OPERATION_CONFLICT`,
`ISSUE_CAPACITY_REACHED`, `ISSUE_RECEIPT_CAPACITY_REACHED`, `ISSUE_BUSY`,
`ISSUE_STORAGE_INVALID`, `ISSUE_STORAGE_UNAVAILABLE`.

`ISSUE_RECEIPT_CAPACITY_REACHED` needs archive/rotation work, not a suggestion
to delete current records. A storage error never reports completion; a caller
must retain the operation ID and query by retry to resolve an uncertain commit.

## Offline acceptance and integration handoff

`tests/local-issues/service.mjs` exercises the real filesystem service and
separate Node child processes. It does not run Electron, input simulation or
model requests. Set `CRAFTMINE_DEPS_ROOT` to an existing agent-runtime package
directory containing esbuild; then run `node tests/local-issues/service.mjs`.
Every run creates a new ignored `test-results/local-issues-*` directory and
keeps a source-hashed JSON report. It never cleans previous runs.

Required client scenario for the integrating E2E owner: open a real formal
Godot world, record Unicode problem text, verify client/build/instance identity,
restart the entire client, read unchanged text, switch worlds and confirm
isolation, delete and retry without resurrection. Candidate/loading/switching
states reject creation. Diagnostics export and backups must remain unaffected.
Assert zero model/network requests, unchanged formal progress and zero focus,
keyboard, mouse or Pointer Lock violations in an isolated headless profile.

This implements only the local-record portion of PP-A12/A13/A25. Screenshots,
state attachments, semantic history, imported feedback, AI diagnosis, repair
candidates, player retest and PP-A15 are explicitly outside this service.
