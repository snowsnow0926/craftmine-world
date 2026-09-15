# Project license distribution verification

The license application affects future builds and standalone exports. Sealed
preview.27 packages were not opened for mutation or rebuilt in this task.

## Executed checks

`node --test tests/project-license-distribution.test.mjs` from the repository
root exercises the production notice writer and client license verifier without
an engine, model request, GUI or user input. The fixtures check exact copied
bytes, missing runtime MIT rejection, changed runtime scope/license rejection,
and client builder mappings. Changed or absent texts cannot pass verification.

`tests/godot-remaining/K/release-manifest.test.mjs` checks that release provenance
maps the actual `desktop/windows-NOTICES.md` package source and every project
license file, while retaining old generated audit notices as repository evidence.

## Future native delivery scenario

Build a new client from a clean licensed commit. Verify the root scope documents
and license texts in `resources/licenses/` against that commit. Export a supported
saved Godot world through the normal product action, and check the two runtime
notices beside the two unchanged engine notices, `game.exe`, `game.pck`, and
`source/`. Read `README.txt` and `EXPORT.json`: original project runtime has MIT
terms, while full-game content rights are not certified. Preserve all existing
source, progress, isolation, cancellation and publication checks.

This task executed pure logic tests, not the future native delivery scenario.
