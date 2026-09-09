# ADR 0303: Import an independently archived legacy world

- Status: Accepted for the downstream Craftmine distribution
- Date: 2026-09-09

Legacy save exports omit activated extension code. Opening the original ProjectStore also migrates data and interrupts running tasks. Neither behavior is suitable for a migration that must preserve the user's source project and unsubmitted work.

Use the existing native directory picker and its runtime-owned selected root. The Craftmine-only panel channel replaces any caller-supplied source with that root and requires `fs.read`. It is not an Agent tool or a generic filesystem proxy. The Rust domain service owns copying, content manifests, archive reads and the world/provenance transaction. The JavaScript compatibility compiler receives only sealed JSON resources and performs the same scene, progress and asset checks used by existing projects, together with extension ABI/dependency checks.

The imported world gets a new desktop identity while retaining its compiled build identity and runtime state. Unapplied candidates, historical modules and task drafts remain in a complete archive and do not silently become accepted world changes or resumed tasks. A repeated commit with the same import ID and content returns the existing world without resetting subsequent gameplay; different content under that ID is rejected. Corrupt archives cannot commit.

Bound archive size and traversal, refuse links/reparse points, reject profile overlap, and check source digests again after capture. A changed source requires a fresh attempt. Failed or incomplete copies may remain in the isolated import directory for diagnosis; they are not listed as playable worlds. A future maintenance action can collect these without touching source directories.

The 64 MiB world-document and 72 MiB private RPC bounds accommodate the existing 32 MiB binary world-asset budget after base64 encoding. This does not increase the task draft limit. Import is currently one bounded operation; later long-running build/verification jobs retain their separate cancellation and recovery requirements.
