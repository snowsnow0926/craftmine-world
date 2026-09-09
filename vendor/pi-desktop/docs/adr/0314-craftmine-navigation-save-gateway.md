# ADR 0314: Route world navigation through the retained world view

The left world list previously had no production IPC path. A raw world.open
would bypass the live world's save, and raw world.create changed selection
before the running view was ready to switch.

The new main-window-only IPC admits a small read allowlist. Create and switch,
including the legacy world.open alias, invoke a fixed method on the retained
trusted plugin view. That method serializes operations, rejects busy requests,
saves the current world before changing selection and propagates failures.
Creating for navigation uses activate:false until the saved view selects it.
The same method serves the panel selector and create form.

No raw progress writes, application credentials or executor registration are
reachable through this renderer channel. Godot application prepare/commit
remain unavailable to plugin pages until a trusted runtime coordinator can
observe candidate startup and persist the complete world state. Godot worlds
are recognized by their durable scene format; they cannot fall into the voxel
loader or silently skip saving while the runtime adapter is incomplete.

Validation uses the real gateway, plugin/core and an isolated headless view.
Pure gateway tests verify denied channels, mutation routing and save failures.
These checks do not certify arbitrary Godot execution or a Windows installer.

The native audit also found that direct IPC succeeded while the rendered list
remained empty after bootstrap. Successful panel world mutations now notify the
main renderer through a dedicated event. The preload subscribes to that event
and plugin lifecycle changes; the real navigation bridge refreshes its host
facts. Native tests inspect the actual rows after bootstrap and navigation.
