# Bundled source guidance within existing Craftmine tool authority

Date: 2026-09-11. Status: accepted for the bounded AI1 foundation.

The model can retrieve engine documentation, but has no versioned product recipe
or exact shipped interface reference catalog. Generic skill loaders would risk
presenting unrelated filesystem content as product guidance and do not establish
base applicability.

Add one read-only `godot_guidance` tool to the existing plugin manifest and broker.
It uses the same host session/workspace context and existing project index/read
methods. It serves only reviewed snapshots embedded in a bundled JSON corpus,
selected by exact skill/reference keys and content hashes. Match authoritative
base/engine metadata and pinned interface hashes before presenting applicability.

This adds no process execution, filesystem, network, host API, renderer IPC or
application authority. Guidance bodies cannot grant permissions or attest results.
The existing engine digest keeps its independent corpus/search identity. Source
guidance load metadata travels in the normal tool result and transcript.

Exact interface matching rejects some compatible customizations intentionally;
future broader compatibility needs explicit validated rules. The initial recipe
is source-derived and has deterministic route tests, not model-efficiency proof.
Undoing this feature means removing its manifest/routing/prompt entry; world
source and saved progress require no rollback or migration.
