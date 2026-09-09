# ADR: durable restore operations with proven ownership

Status: accepted (S4, third Godot round).
Supersedes nothing; it completes the restore half of the R5 portable archive
(`docs/adr/dispatch-r5-portable-archive.md`) after the round-two audit found the
restore could not survive a process ending at a persistent boundary.

## Context

The round-two audit (`docs/audits/godot-round2-20260910/REPORT.md` §3.4) found:

* the restore moved content into its final place and only then committed the
  database, and relied on an in-memory list plus the error path to clean up, so
  a killed process left a half-populated target and a retry was refused with
  `BACKUP_TARGET_NOT_EMPTY`;
* a directory was deleted purely because its name started with
  `.portable-staging-`, with no proof it belonged to this operation;
* a restore had no durable receipt, so a lost reply could not be confirmed;
* protection references were still converted by hand in tests instead of being
  consumed by the reclaimer.

## Decisions

### 1. A restore is a durable operation, not a function call

`backup.restore-portable` takes an `operationId` and commits a
`craftmine_backup_jobs` row (`kind='restore-portable'`, `status='restoring'`,
request hash, archive hash and the exact target) before any body moves. The
receipt is stored on the same row when the restore completes. Querying the id,
retrying the id and cancelling the id therefore all operate on durable state
rather than on a live call.

### 2. Ownership is proven, never guessed

Staging lives at `<target>/.craftmine-restore-<digest(operationId)>` and carries
`owner.json` (`craftmine.restore-ownership/1`). A directory is removed only when
that record names the operation *and* the job row for it exists in this
database; symlinks and Windows reparse points are refused instead of followed.
A directory that merely looks similar makes the target non-empty and is left
untouched. Export staging got the same owner record, so no deletion path in the
backup module depends on a name prefix.

### 3. Journal before acting, receipt and commit mark before committing

Every filesystem action is appended to `journal.jsonl` inside the staging area
before it happens, so recovery replays the journal in reverse and undoes exactly
this operation's work. The final receipt is written and flushed to
`<target>/.craftmine-restore-receipt.json` *before* the database commit, and the
same transaction inserts a `craftmine_restore_marks` row (operation id, archive
hash, domain hash). After a kill, recovery reads that mark from the target
database: present means the commit happened and the restore is promoted;
absent *and the database readable* means it did not and the journal is rolled
back; unreadable means nothing is deleted and the state is reported unverified.
A commit is never rolled back and an uncommitted restore is never promoted.

### 4. Cancellation is cooperative and durable

`backup.cancelPortable` writes a durable cancel request; the restore checks it
at every persistent boundary and rolls back if present. A request against a
finished operation returns the final receipt instead of rewriting history.

### 5. The allowlist is complete and drift-detected

The domain snapshot covers every registered `craftmine_*` table except the two
operational backup tables, including the Godot project/commit indexes and the
content-history tables. A live table missing from the allowlist fails the export
with `BACKUP_SCHEMA_DRIFT`; older archives are padded with the added tables so
they restore as "no data for tables that did not exist yet".

## Consequences

* Recovery is testable against real killed processes: one child process per
  persistent boundary (`after-claim`, `after-stage`, `after-content`,
  `after-git`, `after-commit`), each ended abruptly inside the restore.
* A retry with the same operation id converges instead of being blocked by
  leftover staging.
* Git object bodies and archive bodies are streamed, so the object store is no
  longer captured as one buffered allocation and no longer truncated at 64 MiB.
* Cost: the restore writes and flushes a small journal line per filesystem
  action and one receipt marker. That is the price of proving what happened
  after the process is gone.
