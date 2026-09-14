# Immutable build identity for each explicit export attempt

Status: implemented, 2026-09-14. Scope: Rust `godotBuild.start` identity only.

The previous build ID covered source/assets/base/engine inputs but not an export
attempt. This coupled distinct complete exports to one immutable artifact root.
Godot exports are not byte deterministic: unchanged source can produce different
PCK bytes. A packaged broker rebuild also changes the exact executor attestation,
correctly preventing continuation from claiming old export authority. A normal
fresh build then collided with the old artifact root. Editing player source,
overwriting old PCK bytes or weakening attestation are not valid recovery paths.

New builds use `craftmine.godot-build/2`, adding the existing deterministic job ID
to all previous identity inputs. The job ID already binds the host-owned world,
durable task and tool-call ID. One logical call therefore gets one build/root;
another explicit complete build gets a distinct root under either the same or
a different toolchain. The receipt check precedes new identity/materialization,
so exact retries preserve the recorded result and changed payloads still fail.

No database migration, public tool schema, provider catalog or runtime descriptor
format changes. Existing job/build/candidate links already use opaque IDs. Old
rows, receipts, manifests and artifacts retain their IDs and bytes. Continuation
still references the exact origin build and validates its engine evidence; all
new executor claims/checks/finishes retain their existing attestation and lease
checks. Source revisions, content commits, asset manifests and formal bases are
unchanged by a fresh export. Candidate application remains a separate verified
operation. Existing storage accounting and explicit cleanup continue to apply;
this change does not automatically delete old builds.

Rust integration tests use actual temporary SQLite/files to stage distinct bytes,
obtain private check descriptors, settle candidates, apply with fixture launch
evidence and reopen. They are not an actual engine/GPU acceptance test. The
[native E2E procedure](../e2e/godot-export-attempt-identities.md) independently
checks ordinary export/reuse and old evidence immutability.
