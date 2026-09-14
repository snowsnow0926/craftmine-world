# Promotional combat component reuse

Status: accepted for implementation, 2026-09-15.

The existing promotional world has reusable GLBs and working combat behavior, but its fixed root paths combine six hornlings, heavyblade, trial and rifle. Installing that entire world to satisfy one item would introduce unrequested content. Old archives and templates remain immutable.

Each requested stage is a one-root source package with a distinct namespace. Monster child identities derive from the installer-assigned root identity before child initialization. GLBs are copied byte for byte and checked against their recorded hashes; adaptations retain source provenance rather than claiming new AI creation or verified generated-model licensing.

Identical invisible `core.gd` bytes accompany each stage. It reserves a unique context on the receiving world, attaches after PackedScene initialization and derives its stable persistent identity from the explicit player path. It holds original player health/recovery plus references and the unique equipment selection. It creates no monster, weapon model or arena. Package construction verifies helper hashes; runtime checks the explicit protocol and player/camera binding instead of requiring editor-only source access in exported scripts. Different bindings/protocols and duplicate weapon roles fail explicitly.

The monster stage retains the original hornling movement and damage behavior. It respects the player input gate as well as tree pause, so opening creation/chat does not leave hostile attacks running. It requires a declared flat footprint and finite receiving-world save bounds; it does not clear terrain, regenerate models or teleport players.

The planned heavyblade stage adapts the original duel action state and can hit hornlings without a trial. The separately installed hunt registers the original beast and arena; only then are trial entry controls available. AK has optional blade/hunt references and can install without either monsters or a boss. Later modules preserve existing component identities, life, monster deaths and ammunition. No component silently upgrades another installed version.

Validation combines immutable package/UID declarations, real source installation, and the pinned headless engine's component ledger, damage/pause/input/state checks. Native/player-visible validation remains a separate evidence stage and is not inferred from CPU checks.
