# Embedded voxel-world shortcut handoff

Set `pluginViews.onWorldFullscreenShortcut` to the owning window's bounded
toggle/explicit-exit operation. No constructor signature change is needed.
Only the embedded `craftmine.world/world` view has this capability. The private
scope is minted per view and is unavailable through the public plugin bridge.

Validation: 3 plugin host/preload tests plus 4 Godot host/preload regression
tests passed. No OS input, focus activation, Pointer Lock or client startup.
Strict host/preload TypeScript is checked separately. P3's later shared-helper
editing refinement is integrated by the parent; this commit does not fork it.
