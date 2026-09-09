# Cycle 5 host evidence

The formal Godot host is connected to private Rust artifact/complete-state APIs
and the product Electron main/preload/panel sources. It does not open an arbitrary
Godot execution gate or implement candidate application UI.

## Verified

- Host lifecycle: 17/17 (deterministic runtime/view/store seams).
- Boundary/coordinator/bridge/adapter: 11/11. Includes real HTTP asset allowlist
  and same-length tamper rejection, BigInt/cycles/UTF-8 oversize, wrong-scope
  messages, bounded timeout, failed selection commit, double recovery failure,
  uncertain selection and strict formal descriptor/durable identity checks.
- Strict targeted host/adapter/coordinator/preload TypeScript: 0 diagnostics.
- Actual Rust adapter integration: initial 9/9 at
  `test-results/godot-runtime-core-LeEnbd/report.json`. Parent ran it because the
  subagent's first `CoreClient.start()` was denied with `spawn EPERM`. That denied
  attempt launched no core and is not a passing result. Later stricter receipt
  fields are covered by the final real native run and boundary regression.
- Actual fixed E base Web export, real Electron host/preload and real Rust:
  final 9/9 at `test-results/godot-runtime-native-mr2Pjt/report.json`. Equipment
  changed through a runtime message; a real runner receipt persisted in Rust;
  full state survived complete Electron and Rust restart. Storage failure blocked
  departure/quit, checks surface detached the native sibling, isolated rendering
  had no Node authority and guard counters remained zero.
- The previous native image in `godot-runtime-native-kCXVqG/native-world.png`
  was visually reviewed: training range, targets, boxes, HUD and practice sword
  were visible. The final run has its own `native-world.png`.

The test results above are under this task's worktree
`D:/Craftmine World/test-results/worktrees/gd5-host`. Compact final reports and
pure-test logs are copied alongside this file. Full native logs/screenshots stay
in the unique output directories for root integration evidence collection.

## Preserved failures and limitations

- `godot-runtime-native-ZblWUA`: import failed before any check because the test
  export preset omitted required include/exclude filters. Fixed the preset;
  strict Godot error detection was retained.
- `godot-runtime-native-kCXVqG`: seven checks passed, then exact restart equality
  exposed an E `savedAt` read that replaced its persisted timestamp. The bases
  owner fixed timestamp retention; the test did not omit or normalize the field.
  This partial run is not counted as an overall pass.
- Native executor/application registration is an explicitly authored fixture.
  The imported/exported source is a fixed repository-owned managed base. This is
  not actual model authorship, arbitrary-source sandbox or packaging evidence.
- The native harness constructs the same C host and private adapter. Actual
  `index.ts` compilation and complete product UI validation are root integration
  work and are not claimed by the harness's 9 passing checks.
- Selection write failure after successful replacement restores from durable
  state; the original instance is not retained until selection commit. A second
  failure hides and pauses the uncertain view and exposes both errors. Reopening
  the world is the supported retry. This is not an atomic two-phase native swap.
- Artifact per-request hashes/containment do not prove an OS sandbox or immunity
  to concurrent native filesystem mutation. The runtime Web bridge changes also
  require the delivery owner to refresh reviewed source hashes; no asset rights
  or licensing declarations were changed here.
