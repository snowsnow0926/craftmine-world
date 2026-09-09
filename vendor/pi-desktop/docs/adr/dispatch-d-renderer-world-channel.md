# ADR: renderer channel for world navigation

Status: accepted (task D). The renderer side is implemented; the host side of
`world.switch` is an interface request, see
`docs/dispatch-reports/godot-parallel/D/INTERFACE_REQUEST.md`.

## Context

The world list lives in the React renderer, but worlds, progress and the live
game instance live behind the `craftmine.world` plugin and the Rust core. The
renderer has no channel to a plugin panel today: `pluginBridge` is only exposed
to plugin panel pages (`electron/preload/plugin-panel.ts`), and the world
surface is a `WebContentsView` that owns the live snapshot.

## Decision

1. The renderer talks to the world plugin through one documented seam:
   `globalThis.piDesktop.pluginPanelInvoke(pluginId, channel, payload)`, with a
   test-only `globalThis.__craftmineWorldBridge` override used by headless
   acceptance. `src/lib/craftmine-worlds.ts` resolves the seam and validates
   every response; a missing seam is a visible state, not a fallback dataset.
2. World selection is not performed by the renderer. The renderer calls the
   `world.switch` channel, which the world view must handle, because only the
   view can freeze the running game and snapshot it before saving. The renderer
   never calls `world.saveProgress` itself.
3. A running task is never redirected: the switch path only calls world
   channels. Task/session identity stays with the host gateway, which already
   rejects work for a world that is not selected.
4. Auxiliary sections read existing gateway channels (`library.search`,
   `verification.list`, `memory.search`, `task.current`, `backup.status`) and
   open the existing surface in the world panel; they do not duplicate it.
5. The panel drops a switch request while its own save is in flight. The
   renderer reports the host error and the player can retry; the host handler is
   expected to return a busy error rather than silently ignoring the request.
6. Creating a world and opening it are two steps. Because `world.create` makes
   the new world the host selection itself, a failed open is corrected by
   `world.open` back to the world the view is still running, so the list and the
   view never disagree. The create form reports failure in that case.
7. Capability and summary reads carry the selected `worldId`, because the panel
   gateway rejects any call for a world that is not selected.

## Consequences

- One new IPC channel is required (interface request) before the list can switch
  worlds in the packaged client. Until then the panel works for listing,
  creating and inspection, and says so when a switch is unavailable.
- Base labels stay unreported until the host reports them; the UI never invents
  a base and never promotes a planned base.