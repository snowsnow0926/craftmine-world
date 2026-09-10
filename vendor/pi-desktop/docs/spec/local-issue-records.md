# Local issue records and player followups (PP3a/PP3b)

Status: bounded Main service and notebook UI implemented. Full-client validation
of followups remains separate from the original create/read/delete acceptance.

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
| `issue.read` | `worldId, issueId` | `issue, followups, revision, playerStatus` |
| `issue.delete` | `worldId, issueId, operationId` | `status:'completed', issueId, deleted:true, replayed` |
| `issue.followupPrepare` | `worldId, issueId` | `issueId, revision, context, contextHash, playerStatus` |
| `issue.followup` | `worldId, issueId, operationId, revision, contextHash, kind, text` | `status:'completed', replayed, deleted, issue, followups, revision, playerStatus, followupId` |

A record contains `format:'craftmine.local-issue/1'`, generated `id`, original
`description`, ISO `createdAt`, projected `context`, `client`, `status:'recorded'`,
`scope:'local-only'`, `reproduction:'not-attempted'` and `attachments:[]`.
List summaries replace the description with a 160-code-point preview and are
ordered newest creation first. Listing defaults to 20 entries, at most 50.
The returned `total` belongs to the world; `usage` is the entire local notebook.
It counts `records`, `createdRecords` and `receipts`.
Summaries also report `playerStatus` and `followupCount`. Top-level
`remainingCreateSlots` accounts for followup receipts and reserved deletions;
it is a lifetime receipt upper bound, not a promise about remaining byte space.

Every character is preserved, including leading/trailing whitespace, newlines,
tabs, Unicode and markup. Empty/all-whitespace/NUL/ill-formed Unicode and over-limit
input reject. A future UI must use text rendering, not HTML or instructions.
No mutation channel exists for the original description or identity.

## Player supplements and retest state

The ledger writes `craftmine.local-issues/2` with an additional `followups` array.
Version 1 remains readable without rewriting its bytes; the next successful
mutation upgrades only the ledger container. Original `craftmine.local-issue/1`
records remain unchanged. An old client that cannot read v2 must preserve it as
unsupported/corrupt storage rather than overwrite it with an empty notebook.

Each `craftmine.local-issue-followup/1` entry contains a deterministic ID, issue
ID, increasing per-issue `revision`, `kind`, verbatim `text`, `createdAt`, its own
projected `context` and Main-owned `client` metadata. Its context may refer to a
new build/instance of the same world; it never replaces the original scene.

Kinds are exactly `note`, `still-present`, `player-resolved` and `reopened`.
Notes do not change player status. Only a player-resolved issue can be reopened;
other retest actions require an unresolved issue. No state means automated
reproduction, diagnosis, check success or a repair candidate. The original
`status:'recorded'` and `reproduction:'not-attempted'` remain unchanged.

Preparation captures the ready formal context twice without saving the world.
Its `contextHash` is SHA-256 of the projected context's fixed-key JSON encoding.
Submission supplies only this compare-and-swap digest and the last followup
revision, never a context or path. Main checks the current captured identity
against the digest and samples it again before appending. Changed issue history,
world, build, instance or readiness fails without appending.

Idempotency is checked before resampling context or comparing the new revision:
a lost reply retries the original parameters and receives the existing entry,
including after restart or subsequent followups. Replay after deletion returns
`deleted:true` and never recreates text. A note requires nonblank text; retest
actions may omit commentary by sending an empty string.

## Bounds and persistence

- At most 100 active records and 2 MiB serialized ledger bytes.
- The complete original description is at most 4096 UTF-16 units and 16384 UTF-8 bytes.
- At most 512 lifetime create receipts and 1024 total mutation receipts.
  One delete receipt slot is reserved per creation. Deleting records releases
  active-record/byte capacity but does not recycle operation identities.
- At most 32 followups per active issue, each at most 2048 UTF-16 units and
  8192 UTF-8 bytes. All entries share the existing 2 MiB ledger cap. Followups
  consume receipts only after preserving one deletion slot per live record;
  new creations reserve both their create and future delete receipts.
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

Deletion removes the description/identity record and all its followup bodies.
Minimal operation receipts
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
Followups add `ISSUE_REVISION_CHANGED`, `ISSUE_STATE_CONFLICT` and
`ISSUE_FOLLOWUP_CAPACITY_REACHED`.

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
candidates and the full PP-A15 repair loop remain outside this service. Manual
player retest state is implemented; it is not automated verification.
