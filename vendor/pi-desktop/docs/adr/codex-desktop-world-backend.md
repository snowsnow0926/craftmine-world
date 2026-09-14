# Opt-in local Codex backend inside the existing world conversation

Date: 2026-09-13. Status: implemented experimentally.

Addendum: [player-owned connection](codex-player-connection.md) extends the
existing Settings row without changing this author runtime or storage boundary.

The project author CLI already called local Codex, but the desktop conversation
still ran the PI loop. An OpenAI account/provider label would not close this
gap. Replace only the world author loop behind the existing prompt protocol with
`CodexDesktopRuntime` when explicitly selected in Settings. Keep PI as the default
and for generic coding/Plan. This is a scoped exception to the baseline's single
PI sidecar runtime, not a wholesale runtime or storage replacement.

The adapter shares the packaged restricted app-server transport with the CLI,
without using the CLI's independent world/session initialization. Electron binds
native turns and maps short Codex names to registered plugin tools; Rust permission
evaluation, native source validation and product application remain authoritative.
No second CoreClient, world database or general-purpose model tool is added.

Codex rollout metadata is opaque, stored through private main/host RPC in the
existing Rust SQLite KV store. Canonical transcript hashes gate resume. Interrupted
or divergent transport history can be rebuilt from Rust's transcript into a new
opaque thread without creating another visible conversation or replaying writes.
World-binding/catalog changes fail closed. Native recovery permissions remain
separate. Checkpoint writes use the exact still-active durable turn.

Usage is reported as cumulative-delta tokens with unknown cost, rather than
fabricating PI per-request calls or counting previous turns again. Explicit PNG/
JPEG attachments and actual capture results retain image content. Cancellation
closes owned processes and revokes native authority before late tools can run.

Consequences: the actual desktop world composer can now call Codex, but Plan,
manual PI compaction, PI asktool cards and auxiliary provider completions are not
Codex capabilities. Exact alpha CLI compatibility is intentionally checked;
incompatible upgrades require reviewed schema/policy validation. Details and
commands: [desktop backend spec](../spec/codex-desktop-world-backend.md).

2026-09-14 recovery amendment: an externally visible native interrupted journal
does not prove the adapter received its terminal acknowledgement. Keep the
restricted transport open through the interrupt RPC and matching terminal, then
use [close/drain semantics](codex-app-server-close-drain.md). Existing submitted
but unsynchronized aborted checkpoints may resume only through read-only native
API tail comparison against Rust's digest and prior turn metrics, repeated after
ordinary resume. Uncertain verification has an explicit Continue retry and never
silently rebuilds the complete history. This preserves native compaction while
leaving the original Rust transcript, model and world state intact. The exact
criteria and partial-injection boundary are in the backend specification.
