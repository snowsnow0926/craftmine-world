# Base persistence audit contract

The integration audit rejects foreign or malformed progress before mutating live
state. First-person `restore-state` validates `worldId`, including direct bridge
calls. Side-view validates every ledger, numeric value and player block, and
returns a structured refusal without assigning any field. A rejected side-view
boot exits with code 3 before room creation can autosave default progress.

Top-down saves write and flush a temporary file, preserve the previous file as a
backup, then rename the temporary file. A missing primary can recover its backup;
a present but rejected primary is never silently replaced with older progress.
Top-down boot errors inhibit all saves, and failed saves retain the dirty flag.
Quest rewards reject malformed/negative amounts before consuming quest items.
First-person preserves a sole backup when the next replacement fails.

Side-view template identity (`blank`/`ruins`) is separate from materialized world
instance identity. `new-world.mjs --world-id <id>` accepts a caller identity;
omitting it creates a UUID. `worlds/default.json.instanceId` and the materialization
receipt agree. `CRAFTMINE_SIDEVIEW_INSTANCE_ID` can override it for managed launch.
Direct repository examples retain their old identity for existing save continuity.
The materializer refuses links and nonempty output directories, even with `--force`.
Runtime identities and template selectors must be portable single path components.

Run `node desktop/godot/bases/tests/audit-persistence.mjs` with the pinned cache
configured. It tests the actual Godot persistence classes, failed replacements,
foreign/malformed state refusal without partial changes, distinct materialized
identities, refusal to remove existing output, and rejected boot preserving disk
bytes. Every process is headless with isolated profiles; there is no input capture.
The complete gameplay suites are separate regression evidence. Editor shutdown
resource leak diagnostics in the side-view base are retained as unresolved facts,
not rewritten into a clean import claim.

These checks do not establish hardware rendering, player feel, real model authoring,
product application transactions, arbitrary schema migration or power-loss durability.
