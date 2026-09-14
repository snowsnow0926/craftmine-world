# Source library hints evidence — 2026-09-14

Run:

```powershell
node --test tests/source-library-read-hints.test.mjs tests/godot-final-install-assets/source-library.test.mjs tests/world-composition.test.mjs
node desktop/build-world-plugin.mjs --output test-results/source-reference-plugin
$env:CRAFTMINE_SOURCE_LIBRARY_PLUGIN = (Resolve-Path test-results/source-reference-plugin).Path
node --test tests/godot-final-install-assets/source-library.test.mjs
```

The 25 focused tests cover exact catalog identity, explicit inner-ref warnings,
pinned pagination, changed/foreign source replies, cancellation, every required
path/profile, unknown capability gaps and unchanged immutable installer guards.
Existing installation/group/retry tests continue to reject altered archives,
forged source identities and stale proposals.
The 13 service/installer contracts also pass against the actual bundled plugin
selected through `CRAFTMINE_SOURCE_LIBRARY_PLUGIN`, not only source modules.

The original city turn `b90c466b-be07-41a0-95e2-03d24d090655` provided two matching
index pages at revision 4 with 45 files and manifest
`94a62a6931a3505ff638c15d7e865340a97f5cfe099a24be52d4e9bed19f7536`.
A pure replay of its validated archive descriptions reports pet-companion v2
as `adaptation-required`, while approved-pomeranian v2 and rain-control v2 have
matched source prerequisites. Their distinct archive/root hashes remain intact.
Detailed local evidence is `test-results/source-library-hints-real-city.json`.
This does not rewrite the running profile, re-run the model or claim fresh
installation/gameplay acceptance. No model, GPU or user input was used.
