# Component library delivery

Implemented a Godot-only library page, managed-source component list/export,
native gateway contracts, exact base-script requirements and importer checks.
Root owns native picker/grants, service construction and final product routing.

`package-source-core.mjs` passed six real integration checks. The authored
fixture has a `PackageDoor` class extending the exact required `Interactable`
base class, a collision shape and a mesh. It is exported from a CRLF main
scene, installed twice into a different Git-backed world, materialized from
real core bytes, imported by hash-pinned Godot and interacted with independently.
Changing the required base script refuses installation with source revision
unchanged. Whole-world export refuses. The formal build remains unchanged and
real build checks are blocked because no executor was registered in this test.

Final fixture: `C:/Users/WINDOWS/AppData/Local/Temp/package-source-TqjHIz`.
Raw engine logs: `import-authored-door.log`, `interact-authored-doors.log` in
that fixture. Core result is retained in `package-source-core.log`.

Development failures retained in the tool transcript:

- An invented fallback base version 0.1.0 conflicted with a legacy fixture's
  installer version 1.0.0. Export now records a base version only if the source
  world actually declares it.
- The first exported script lacked a UID, correctly rejected as
  `DRAFT_MISSING_SCRIPT_UID`. Namespaced UID generation was added and confirmed
  by real Godot import; the validator was not weakened.
- A static ZIP import made the staged ESM graph contain top-level await and
  Node refused the plugin's `require`. Moving that import inside the async
  export method restored synchronous plugin loading. Final standalone source
  exporter/installer and browser workbench builds passed in
  `test-results/reuse-bundle-7s48F4`.

`package-ui-headless.mjs` passed six checks in independent headless Chromium:
native route/arguments, exact retry after a lost result, a new operation for
repeat install, opaque grant usage, text escaping and zero focus/Pointer Lock
calls. Tests use page-script form submission, never input simulation.
Fixture report/screenshot: `C:/Users/WINDOWS/AppData/Local/Temp/package-ui-NGxQw0`.
The screenshot was inspected; final application styling comes from the existing
workbench classes. This UI harness does not substitute for root's full product
gateway/model acceptance.
