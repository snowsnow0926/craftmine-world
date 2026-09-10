# Host-bound immutable version comparisons

Status: accepted for the VM2 read-only slice, 2026-09-10.

## Context

Git history already supplies exact file changes and diffs, but the native panel
only lists commit subjects. Its read paths also create a task merely to obtain a
workspace context. Exposing raw Git methods would allow renderer-selected refs
and bypass the panel's selected-world and source-version boundaries.

## Decision

Reuse the core's existing trusted source-context query for reads. Keep mutation
tasks unchanged. Expose two finite Main navigation methods, backed by a bounded
in-memory host view of the history page. Bind formal and selected content OIDs,
recheck mutable world/branch pointers around reads, and accept diff paths only
from the actual change list. Return a fixed 32-file page and an honest 64 KiB
UTF-8 text prefix; display binary sizes from Git's binary classification.

Do not add renderer filesystem grants, generic property/RPC access, persistent
comparison records, authoring tasks, Git pins or AI interpretation. Losing a
view on process restart or eviction simply requires reloading history.

## Consequences

Diffs remain exact, finite and source-only. An unavailable context, pruned object,
oversized upstream diff or changed formal/branch identity produces an explicit
read error. Index recovery remains owned by existing core reads. This slice does
not automatically restore, merge, check or apply anything, and does not claim
semantic gameplay equivalence from a file diff.
