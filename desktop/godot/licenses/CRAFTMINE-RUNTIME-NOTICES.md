# Craftmine World export runtime notices

The accompanying `CRAFTMINE-RUNTIME-MIT.txt` licenses the project's original
runtime code in these source scopes, recursively:

- Files ending in `.gd`, `.tscn`, `.tres`, or `.godot` under
  `desktop/godot/bases/`, `components/`, `shared/`, `probes/`, and `sandbox/`.
- `desktop/godot/web/bridge.js` and `desktop/godot/web/shell.html` only.

This includes original runtime code copied from those scopes into the exported
project. Preserve its MIT copyright and permission notice when distributing it.
The full source is included in `source/` in a standalone Windows game export.

This grant covers original project-owned code and scene/resource definitions,
not every file in an exported world. References to models, textures, fonts,
audio, or other resources do not license those resources. Existing third-party
licenses and more specific file notices continue to govern their own material.
User-authored or independently generated code and content do not automatically
receive this MIT license. Their applicable rights must be assessed separately.

Host-side creation code, native build brokers, and `web/runtime.mjs` are outside
this runtime grant. Including AGPL, LGPL, GPL, or other separately licensed code
in a work requires following its applicable terms. Merely using the creation
tool does not assign the tool's license to the work it creates.

Godot retains its own MIT license and third-party notices in
`GODOT_LICENSE.txt` and `GODOT_COPYRIGHT.txt`. No trademark rights or blanket
permission for imported assets are granted here. This notice does not certify
the rights of the entire exported game.
