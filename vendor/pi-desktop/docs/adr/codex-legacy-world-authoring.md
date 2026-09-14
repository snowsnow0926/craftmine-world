# Runtime-scoped Codex tools for legacy worlds

Date: 2026-09-14. Status: implemented; packaged player acceptance is separate.

The preview23 world composer allowed a player to select the Codex backend in a
new legacy voxel world, but its adapter rejected the first request with
`CODEX_GODOT_WORLD_REQUIRED`. The reported request ended in 24 ms, before a model
turn began. Requiring the player to switch models or silently creating a Godot
world would not honor their selected backend and world.

Extend the existing restricted `CodexDesktopRuntime` with a fixed legacy tool
catalog, selected from authoritative host context before connecting to the CLI.
Main supplies registered definitions from the union; the model receives only its
world runtime's catalog. Existing Rust-owned voxel inspection, atomic draft
patches, library operations and machine verification already run through the
same `tools.execute` host permission and plugin dispatcher boundary. No new Core
RPC or direct database owner is needed.

The Godot catalog stays byte-for-byte compatible, including ordering, descriptions
and schemas. Its existing checkpoint tool digest therefore stays unchanged.
Legacy receives its own digest and instructions. Missing required tools, unknown
runtime kinds, cross-runtime requests and changed world bindings fail closed.
Generic shell/filesystem, Codex built-in tools, native operator calls and candidate
application remain unavailable. Neither model choice nor persisted world content
is changed by transport selection.

Machine verification, request review and player application remain separate;
a model reply is not proof of an applied tree. Inspection of the real preview
handler found that machine verification alone cannot unlock application: the
legacy UI also requires a completed review. Add a narrowly scoped, host-owned,
tool-free Codex completion only for that current frozen legacy review. It uses
the exact original model/effort and existing strict plan/actual renderer/assertion
pipeline; it does not weaken any application condition or add generic auxiliary
completions. Native review cancellation remains available without the generic
advisor's whole-request timer. Actual successful and failed usage is retained,
with unknown values explicit. This amendment changes only the world authoring scope of
the [original decision](codex-desktop-world-backend.md), preserving its identity,
storage, sandbox, cancellation, usage and transcript ownership decisions.

Targeted mocked app-server regression also exposed a callback that used the
mutable current client after disposal. Bind each request callback to its owning
client so rejected late calls cannot crash on an absent client or answer on a
replacement transport.
