# Restored world foreground presentation (FB04-001)

## Regression

A loaded Godot view was still attached at its background staging index. Clearing
its background marker and lowering the application renderer could leave the
opaque plugin world placeholder above the game. Opening the pause menu detached
the surfaces; Continue then reattached the game at the top, masking the startup
ordering fault.

## Targeted automated checks

Run the pure host and native layer tests:

```text
node --test apps/desktop/test/godot-world-presentation.test.mjs apps/desktop/test/main-window-layers.test.mjs
```

The host fixture runs the actual attachment, bounds, candidate visibility, and
native layer methods against inert view objects. It does not launch Electron or
claim rendered-pixel or real-player acceptance.

1. Begin with an opaque plugin view above the trusted renderer in closed play.
   Attach a pending game at staging index zero; it cannot own native input.
   Promote the same view to current and apply its bounds. The final order must
   be renderer, plugin, game without any pause-menu or detach/reopen workaround.
2. Keep a preparing candidate behind the current game. Explicit preview must
   present the candidate above the plugin and retire the old displayed surface.
   Final promotion retains that exact native view above the plugin.
3. Repeat startup promotion while a trusted overlay blocks play. The renderer
   stays above the game and owns input. Repeated identical layout reports cause
   no child reorder and no focus call.
4. A background designation cannot be released by a presentation request alone;
   a detached foreign view is not attached by the layer helper.

## Integrated package check

In an independent hidden, unfocusable profile, retain an ordinary ready world and
the player's fullscreen play choice. Quit normally and cold-launch the packaged
application with that profile. Before any show-world, pause, Continue, or mode
transition, record the world identity, readiness, native child order, and actual
rendering evidence. The displayed game must be above the plugin placeholder and
below any open trusted overlay. Preserve a failed readback separately from scene
or ordering evidence. Then verify the normal pause/Continue flow preserves the
same runtime and world progress. Never use physical input, Pointer Lock, window
activation, the user's browser, or the user's live profile for this check.
