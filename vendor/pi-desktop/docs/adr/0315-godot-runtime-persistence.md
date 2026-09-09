# ADR 0315: Persist complete Godot state through the private host

Status: Accepted for implementation, 2026-09-09.

The existing progress validator models one voxel player with bounded 3D
coordinates. Mapping other bases into that player would omit quests, shops,
rewards, rooms and custom state. Game-supplied filesystem roots also cannot be
used to select runnable exports.

Add a versioned, bounded Godot progress envelope with base-owned body semantics.
Keep the entire body in the Rust world transaction and preserve the legacy path.
Bind the runner's exact snapshot text to a host-owned persistence result and
require complete restored-state evidence for new-format candidate application.
Resolve only applied artifacts through a private Rust descriptor, verified
against stored hashes, and require the HTTP host to check bytes on each serve.

This permits a real Electron/Godot/Rust path while leaving ordinary generated
project execution subject to its existing isolation gate. Future state migration,
base registration, backup/export and execution policy remain explicit work.

See [runtime persistence](../spec/godot-runtime-persistence.md) and scenario
CRAFTMINE-GODOT-021 in the E2E plan. Tests distinguish real SQLite persistence
from authored export fixtures and from actual sandbox/model acceptance.
