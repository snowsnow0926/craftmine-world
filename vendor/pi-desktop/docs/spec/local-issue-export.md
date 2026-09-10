# Selected local issue JSON export

PP6 first slice exports one explicitly selected local issue from the notebook
detail view. It is not a complete diagnostic bundle, a backup, or a reproduction
certificate. There is no import, upload, automatic external transmission, or
collection of additional evidence.

## Product entry and authority

The detail action **Export this record (JSON)** opens the existing native save
picker. The panel sends only `issue.export` with
`{worldId, issueId, revision, operationId}`. Main owns the picker, selection
reader, issue service, filesystem path and writer. Extra request fields,
including paths, bytes and context, are rejected. The native panel gateway
requires the currently selected world; the exporter checks selection again.

`revision` is the detail revision the player selected (integer 0 through 32),
not a request to read the latest revision silently. A changed or deleted record
is refused. The player must reopen the latest detail to make a new selection.
Original and followup identities are the identities recorded at their respective
creation times; exporting does not capture a new runtime identity or save a world.

## File format

The UTF-8 JSON file ends in a newline and has format
`craftmine.local-issue-export/1`, scope `selected-record`, export `createdAt`,
`record`, `followups`, selected `revision`, `playerStatus`, and `exclusions`.

`record` explicitly projects `format`, `id`, original `description`, original
`createdAt`, `context`, `status`, `scope`, `reproduction`, empty `attachments`,
and `client`. Each followup explicitly projects `format`, `id`, `issueId`,
`revision`, `kind`, exact `text`, `createdAt`, `context`, and `client`.
The context allowlist is `phase`, `status`, `worldId`, `buildId`, `baseId`,
`baseVersion`, `instanceId`, `runtimeTarget`, and `artifactManifestHash`.
Client fields are `version` and optional `commit`. Original whitespace and
newlines are preserved. No complete service response is spread into the file.

Exclusions name credentials, chat, system logs, screenshots, world source,
progress snapshots and other issues. No file paths, error stacks or uncollected
attachments are added. Player retest status remains a player statement; it does
not certify an automated check or a fix.

## Write, retry and limits

The exporter freezes the selected projection, timestamp and exact output bytes
before opening the picker. It rereads selection and the issue before writing
and in the awaited pre-commit callback. A mismatch raises
`ISSUE_WORLD_CHANGED`, `ISSUE_REVISION_CHANGED`, or `ISSUE_NOT_FOUND` without
replacing the destination. The shared writer creates an exclusive sibling
temporary file, writes and syncs it, revalidates the native-selected destination,
awaits the pre-commit callback, and renames. A caught failure removes only that
new temporary file. Existing issue storage is never mutated.

One export may be active at a time. At most 32 operation IDs are retained per
process, without eviction; output is capped at 512 KiB, including retries.
The same ID and request share an in-flight operation or replay its terminal
receipt. Changing the request under that ID is `ISSUE_OPERATION_CONFLICT`.
After a write failure, retry retains the original bytes and original picker
authorization. A confirmed cancellation writes nothing and is replayable; a
later deliberate export uses a fresh ID and picker. A successful receipt is
`{status:'completed', operationId, issueId, revision, scope, bytes, sha256}`;
a cancellation has the same identity fields and no bytes/hash. No path or body
returns to the panel. Completed replay reports the historical write, not that a
user has left the exported file unchanged afterward.

Disk errors expose `ISSUE_EXPORT_WRITE_FAILED`, not private paths or stacks.
An unknown reply keeps the original UI operation for retry. UI epochs prevent a
late reply from changing another world's notebook. Receipts are in memory only:
there is no cross-restart exactly-once guarantee. A process crash may leave an
owned temporary file; this slice does not claim power-loss recovery or automatic
temporary-file cleanup after a crash.

## Validation

Run `node --test tests/plan-loop/issue-export.test.mjs` and
`node tests/plan-loop/issue-export-headless.mjs` from the project root with the
existing `CRAFTMINE_DEPS_ROOT` dependency location when needed. The former uses
the real issue service, gateway, exporter and filesystem. The latter mounts the
actual issue UI in isolated headless Chromium against loopback HTTP and the real
service, with a fixed owned picker callback. Neither uses a model, external
network, real input, focus or Pointer Lock. This is not native Electron dialog,
packaged-client or signed-release acceptance.

`tests/plan-loop/issue-export-client-native.mjs` prepares separate actual Main
channel acceptance using a matching compiled client or pinned package. It runs
one authored-world build, creates a record and two followups, checks exact file
and receipt content, refuses stale/unknown requests, and verifies raw ledger,
export and complete progress through two strict clean exits. It uses the fixed
headless save authorization, not an interactive OS dialog. Its preparation is
not a native passing result; run instructions and boundaries are recorded in
the PP6 dispatch report's `NATIVE-PREPARATION.md`.
