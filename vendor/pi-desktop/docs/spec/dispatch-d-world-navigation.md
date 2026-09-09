# Spec: left-column world navigation

Status: task D renderer implementation plus the production navigation gateway
from the integration audit (ADR 0314). Reads use the real plugin; create and
switch run in the retained view and save before changing selection. Busy and
save failures propagate to the caller. Only the delivered voxel blank starter
is selectable until Godot execution, progress and runtime adapters are complete.

## Problem

The left column still shows only a single "World" button plus the generic PI
session/project navigation. Players cannot see which worlds exist, what they run
on, when they were last saved, or which session belongs to the selected world.
Creating a second world is only possible inside the world panel.

## Behaviour

1. The left column lists every world the host reports, with:
   - the world title,
   - the base/runtime label when the host reports one (`底座未标注` when it does not),
   - save recency derived from the host `updatedAt`,
   - the latest check status when the host reports one,
   - the active marker, and a marker for the world that owns a running task.
   The active world sorts first, then the most recently saved.
2. Selecting another world goes through the host's freeze-save-open switch.
   A failed save keeps the previous world active and shows the host error.
3. Selecting a world never rebinds the PI session or the running task. While a
   task is running, the switch is allowed and the list states that the task
   keeps its own world.
4. "New world" opens a create form with base, start point and name. Only bases
   and start points the host reports as delivered are selectable; planned or
   unreported options stay visible but disabled. A failed create keeps the
   previous world and shows the full host error. When the world is created but
   the view cannot open it, the host selection is put back to the world the view
   is still running, the form stays open and the real switch error is shown.
   The panel stays busy until the refreshed list reflects the result.
5. Auxiliary surfaces (works, assets, checks, memory, tasks, backups) are
   collapsed by default. Expanding one reads its real host summary for the
   current world (a summary read for another world is never shown) and opens the
   world panel instead of duplicating the surface. Section routing into the panel
   is a host request; until it lands the button says "open the world panel".
   Expansion is remembered in the existing craftmine layout preference.
6. The session bound to the current world is shown under the list; the existing
   session and project navigation below it is unchanged.
7. Narrow windows: the world list scrolls, rows wrap, the chat input stays
   reachable, and the column stays inside the viewport down to the 240px
   sidebar minimum. Play mode hides the list and the chat but keeps both React
   trees mounted, so returning to creation preserves the input and the world.

## Data ownership

Every fact comes from the `craftmine.world` host (Rust core through the plugin).
The renderer keeps no world database: with no host channel the panel renders an
explicit unavailable state and offers no create button. Planned bases are never
presented as available.

## Verification

- `vendor/pi-desktop/apps/desktop/test/craftmine-world-navigation.test.mjs`
  (14 unit/contract tests).
- `tests/godot-parallel-d/world-navigation.mjs` (headless acceptance with the
  real React components, the real plugin and the real Rust core).
