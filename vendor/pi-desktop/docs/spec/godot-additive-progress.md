# Restricted additive progress contract

The private host derives a complete candidate snapshot from two complete progress envelopes: previous formal progress and actual freshly loaded candidate defaults. Only first-person base 0.1.0 and /body/targets, /body/interactables, /body/equipment/items may add entries, keyed by nonempty unique entry.id. Every old id must still exist. Existing entry key sets and value kinds must remain compatible; all old values are copied unchanged. Collections follow actual candidate default order, so array position is not entity identity. Every other previous envelope/body field remains unchanged. Unknown envelopes/body keys, unsupported identity/version, deleted old entities and duplicate IDs fail. The actual runtime must load the full result and return it unchanged; successful derivation alone is insufficient.

Both equipment blocks contain exactly `active` and `items`; `active` names an
entry in that block. Every item contains exactly `id`, `magazine` and `reserve`,
with integer ammunition in `0..99999`. Old ammunition and the old active
selection are retained. A newly authored equipment identity receives only the
defaults captured in a fresh candidate process. JavaScript and Rust independently
derive this fixed merge; rewriting an old item, hiding an addition, inflating new
ammunition or substituting the defaults makes the proof invalid. The native
regression demonstrates the original missing-equipment refusal, migration,
durable save and reopen, and actual damage with the newly added equipment.

Shared API desktop/godot/shared/progress-migration.mjs exports deriveAdditiveProgress(previousSnapshot,defaultsSnapshot), canonicalProgressJson and hashProgress. Result: {format:'craftmine.godot-additive-progress/1',previousSnapshotHash,defaultsSnapshotHash,snapshotHash,added:[{path,id}],snapshot}. Hashes are SHA256 of recursively key-sorted JSON with normal JavaScript JSON number serialization. Rust must validate JSON semantics explicitly rather than assuming serde float spellings match those bytes. The host check evidence also carries the exact defaultsSnapshot and candidate source/build identity.

Verifier should load null in a fresh isolated candidate, capture defaults, derive, load the derived state, and compare full native state. Core must independently recompute/validate this fixed rule against a trusted completed candidate check and current formal world revision/hash; no caller-supplied rules or arbitrary subset acceptance. Prepare/commit must bind the complete migrated snapshot, exact candidate check identity and old-formal CAS. A newer formal save requires fresh derivation from verified scene defaults. The original world is not changed until the usual durable application commit.

FPS WorldState retains complete collection cardinality and checks all scene and saved IDs for nonempty uniqueness. Restore resolves by stable id rather than input array position; unknown/missing IDs remain errors. Transactional rollback remains unchanged. No implicit default insertion or data dropping occurs in runtime restore.

## Source-owned creation progress

Creation-sandbox 1.0.0 also supports its fixed additive ledger/component rules.
Its player position is structurally an array of exactly three finite numbers;
the structural merge does not own room dimensions or impose a ground altitude.
JavaScript and Rust preserve all three coordinates exactly, including positions
outside the starter room and underground or elevated source-authored worlds.
They retain the existing exact envelope/body/player keys, world/base/version
identity, orientation/time constraints, ledger IDs/types/counts, component
schemas/depth/size limits and total JSON size limits. No other base contract
changes. The unchanged starter source still enforces its own room bounds.

Derivation is not restore approval. The verifier must still load the complete
derived state in the actual candidate and compare the entire resulting snapshot.
The current source's pose validation and pinned native collision guard remain
authoritative. Core independently validates the same derivation against the
trusted check/defaults and current formal progress, and application still needs
real runner receipts. Moving a player, resetting inventory or replacing progress
with candidate defaults makes the proof invalid. See
[the ownership decision](../adr/godot-source-owned-progress-20260913.md).

The isolated client acceptance controller has two finite gameplay sequences.
After checking an imported scene, `godotAdvance` uses real resume, equip and look
operations to leave different equipment and camera orientation from `godotPlay`.
It accepts no caller-selected actions, arguments, scripts or state. The complete
client test compares these fields against the check-time snapshot before testing
application and restart, so repeating the same final state is not accepted as
evidence that newer formal progress survived.
