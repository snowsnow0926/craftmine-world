# Retained city navigation: native acceptance

This is a developer-authored source repair, not an AI creation or a new blank
world acceptance. No model request, OS input, position injection, database edit
or sealed-package modification was used.

The isolated retained city `world-30f58e6991be` was opened with
`Demo-preview25-96eb7b45/output/win-unpacked`. All four pinned source hashes
matched; its complete index contained 62 files at revision 15. The existing
history editor's CAS saved only `scripts/pet_companion.gd`, producing revision
16. The normalized repair SHA-256 was
`15e4085b8404c551ac2c4f2e3e117527bfa96376af52a63439810278159c636b`.
The other 61 file entries stayed equal. The actual check passed with
`sourceStale: false`; normal preview and apply adopted build
`gbd-735135b2a962fee53aea8ef2d810689abfd8c7a129a290baf2fb2ff89c720d8c`.

雪球 moved from `[32.0687256, 0.0303273, -103.6084824]` to
`[44.3383331, 8.8021889, -127.2199020]`. 小麦's complete waiting state and position,
both names, interaction counts 3/1, follow settings, the player's high-ground
position, four collected relics and four opened chests remained exact. Twenty
ordinary wait segments, 120 physics ticks each, then confirmed arrival stability.

The first wait request accidentally included an unsupported `capture` field and
was rejected. `runtimeResume` had already succeeded and the world continued
simulating, so arrival was observed on the subsequent cold open. The native run
does not claim uninterrupted approach-frame evidence; the separate CPU test
owns that evidence. The rejected command is preserved.

Normal save returned a `snapshotHash` equal to the SHA-256 of the complete saved
snapshot. After cold entry, all gameplay fields matched exactly. Strict full
JSON comparison failed: the existing rain component's `heights`, `phaseAge` and
`rainClock` advanced 0.25 seconds during normal play entry. Later `world.read`
confirmed the same durable gameplay state with continuing rain animation.
No validator was weakened, weather stopped, or state rewritten to force equality.

The ordinary library UI published **双博美城市 · 跟随与寻宝**, with a description
identifying the developer repair and retained 4/4 test progress. Its exported ZIP
is 9,525,420 bytes, SHA-256
`5968532581cd6d544529210f75a3d1540e322db5d06cf7eeb13751b8700a6bb3`.
The prior headless picker ZIP was preserved and restored after normal app exit;
the sealed Demo examples were untouched. All final shutdown audit arrays were
empty and package inventory checks passed.

## Evidence and reproduction boundaries

Evidence is archived at
`D:/Craftmine Archives/demo-readiness-20260915/entry/test-results`.
The archive's `LOCATION.json` and file inventory preserve its original locations
and verify every file's bytes and SHA-256:

- `city-navigation-native-tLMrc9`: initial read-only preflight.
- `city-navigation-native-UnwUC1`: full before state, CAS, check, preview/apply,
  rejected first wait and normal exit.
- `city-navigation-native-t4N3Ux`: actual arrival, 2,400 stability ticks,
  save/cold snapshots, explicit differences, durable read, engine screenshot,
  publication receipt and `dual-pomeranian-city-navigation-verified.zip`.

`tests/city-navigation-repair-native.mjs` requires the exact isolated profile,
sealed package and repair repository as absolute arguments. Its mailbox accepts
explicit prepare/apply/observe/wait/save-cold/quit commands; prepare refuses changed
source pins. Do not repeat prepare on the repaired world. An optional fourth
argument continues an already adopted report after a clean stop, preserving the
earlier evidence. `tests/city-navigation-publish-native.mjs` uses actual React
forms and verifies the recorded save/cold/durable gameplay evidence before export.
It preserves the old picker ZIP before export; restore that ZIP only after the
app exits, with both hashes checked. These are scoped native acceptance drivers,
not a general player-facing repair API or a default unit-test command.
