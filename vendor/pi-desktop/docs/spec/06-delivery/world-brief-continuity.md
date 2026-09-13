# World goals across authoring turns

The existing PI sidebar exposes a collapsible world-goal panel. It is scoped to
the selected real world, works before the first model turn, and reads Rust-owned
data. It preserves player-written goals and requirements to retain in later
edits. The current session, Composer, source, progress and task identity remain
owned by their existing services.

## Product operations

`world.brief` is a main-frame-only product route. `read` exposes goals, pending
advisory proposals, twelve excerpts of original host-journaled requests and the
latest native check's build identity. `add`, `update`, `remove`, `review`,
`accept-proposal` and `dismiss-proposal` require an operation ID and expected
brief revision. Rust rejects stale revisions, changed request reuse, foreign
world IDs and edits while the world has a write lease. Retrying the same saved
operation returns its original receipt. A selected-world change prevents late
results being shown in another world's panel.

`review` records only the player's explicit assertion that they played and
accepted that goal in the current formal build. It does not grant runtime
verification authority. A later build renders the old review as historical;
changing a goal clears its review. The latest native job is projected separately
and never declares all natural-language goals passed. The UI clears cached
current-build labels before reloading on a world change.

`Continue goal` prepares an appended draft in the existing current-world
Composer, after native conversation binding is checked. It does not submit a
model request, replace pending Composer text or change models.

## Agent context and tools

Every Rust `task.context` includes a bounded `worldBrief` projection for that
task's actual world. It includes the first eight player entries (with truncation
markers and a total) and three recent original requests from this world's task
history, retaining host request IDs and task IDs. Historical completed requests
are reference data, not tasks to repeat. The latest explicit player request
retains precedence over older preferences.

The registered `world_brief` tool provides `read`, `history`, and `propose`.
The host supplies workspace identity. `history` can page the exact Unicode text
of a request only from the same world. `propose` writes advisory entries, bound
to the current task and brief revision; it cannot edit goals, mark a player
review, or self-certify gameplay. The player may add the proposal to their goals
after the active turn ends. Stale proposals cannot overwrite later player edits.

There are at most 32 current goals and eight unresolved proposals. Text/page
bounds protect stored/UI data, not model-call counts or authoring time. World
goals do not become new runtime commands, permission grants or arbitrary check
assertions. They are local authoring notes and are not silently added to exported
templates or another player's profile.

## Verification

- Rust: cold persistence, operation replay/CAS, live-lease refusal, model-only
  proposal authority, exact historical Unicode, foreign-world isolation,
  build-bound human review and stale-proposal refusal.
- Main: fixed method surface, selected-world recheck, busy writes, error privacy.
- Actual React: exact text forms, draft handoff, manual review, stale-label
  invalidation during async refresh, edits clear review and world-switch reset.
- Context: same-world goals retained through creation/retry/review/summary;
  foreign-world data excluded.
- Final native acceptance must run multi-turn real authoring and cold reopening
  using the actual selected model; fixture tests do not prove gameplay success.
