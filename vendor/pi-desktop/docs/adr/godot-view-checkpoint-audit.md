# ADR: checkpoint Godot views before replacement

Status: implemented in the isolated Godot lifecycle audit repair.

The original C host could dispose a world after a descriptor read failed or after
opening a different world without persisting its latest state. Its example
adapter guessed revisions and accepted incomplete durable receipts. Independent
view fixtures hid the mismatch with Rust's optimistic revision and progress format.

The host now separates checkpoint, replacement and forceful teardown. A successful
checkpoint pauses the old instance and obtains a real host receipt before a new
runtime can replace it; failures retain and resume the old instance. Descriptor
failure preserves the current world. Concurrent startup/save and teardown are
bounded by host state, preventing duplicate instances and startup resurrection.

World documents describe build identity, not host filesystem authority. A separate
trusted artifact resolver owns runtime paths; canonical root checks supplement
this boundary. B-style formal Godot build metadata is recognized without passing
through document-provided paths. Progress envelopes and host-selection rollback
remain integration responsibilities and cannot be inferred from view fixtures.

The API and validation boundary are specified in
`../spec/godot-host-lifecycle-audit.md`. New deterministic failure tests execute the
real host class without Electron, input, or a claim of actual Rust persistence.
No engine process execution or second world database is introduced.
