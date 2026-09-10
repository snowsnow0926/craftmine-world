# PP2 target feedback: private authoring slice

Delivered: exact `fp.target.feedback/1` contract, instance-only TSCN patcher,
private source transaction/check service and three private host methods. The
root integration owns panel routing, UI and complete-client acceptance.

The allowed range is **1–1000 integer milliseconds**. Zero is rejected because
the unchanged base script would leave the flash material applied indefinitely.
No max health, inventory or progress field is writable through this service.

The service requires selected world/formal build identity, exact formal source
equal to main, source and target hashes, and existing core CAS. It submits one
scene write and one check, persists and reuses operation receipts, finalizes
owned turns through the existing lifecycle, and leaves explicit retained drafts
on failure. It neither adopts a candidate nor writes formal progress. A closed
preview retains the draft; this is not isolated instant preview or automatic
rollback.

## Evidence and limits

- `unit-tests.log`: **23/23**, consisting of 8 pure contract/patch tests,
  7 service tests, and 8 existing private-route contract regressions.
- `target-feedback-core-rLXaIf`: real Rust/SQLite/Git source/application setup,
  single parameter source write/check, unchanged formal build/full snapshot,
  cancellation and restart replay of the same job. Core SHA256
  `f05c6589ab8475a1cc48a6c01bd921bb776d74b9402b734ade2c442ffab85aa3`.
  The seed build uses a declared fixed executor fixture, not real Godot.
- `target-feedback-native-aH4bEI`: **3/3 actual Godot 4.7.2 headless** runs of
  patched scene instances (1/500/1000 ms), damage, remaining flash duration,
  midpoint material and restoration, with actual health/hit state. Process
  deltas are called deterministically on the unchanged runtime script. There
  is no window, input, screenshot, model or full client lifecycle claim.

`index.json` lists copied raw evidence with original paths, byte lengths and
SHA256 hashes checked against the original files. Original failed profiles
remain untouched:

- `core-TwnrwS`: an obsolete primary release rejected Godot progress.
- `core-C7okd8`: fixed fixture had omitted the required content applied-ref
  transaction; the fixture was corrected to use prepare/advance/confirm.
- `core-1o7PBA`: old intermediate binary lacked the current index branch field;
  switched to the current final release, without weakening validation.
- `native-tiKduP`: fixture GDScript inference error, fixed with explicit bool.
- `native-TshAJY`: exposed a real patch bug. An inserted exported property
  before `script` was reset by Godot to 120 ms. New properties now follow script
  binding at the end of the node block; existing override replacement remains
  exact, and pre-script property ambiguity is refused. Final native cases pass.

An attempted unrelated package-lifecycle regression entry did not start because
this isolated tree has no generated `desktop/build/craftmine.world` adapter.
Its missing-build failure is not counted as a product pass. The directly usable
private-route regressions above passed. Parent integration should run its normal
plugin build and full client adoption/restart checks.

## Integration notes

Private contracts are in `vendor/pi-desktop/docs/spec/target-feedback-service.md`.
The renderer must use `sourceBinding`; the root's bounded host wrapper maps it
to private `binding`, since global renderer contracts reserve `binding` for
trusted identity. Method outputs contain no private paths, source bytes or
task/executor tokens. No model capability has been added.

The only shared Electron file change is the three-method private allowlist in
`plugin-runtime.ts`. `main.cjs` creates the service and drains its submissions
before restore/core shutdown. Runtime shared JS imports are bundled through the
existing plugin builder; no runtime source path is accepted from the page.

Private operation files are bounded to 8 MiB, regular single-link files with
schema and identity checks; writes use unique exclusive temporary files and
sync before replacement. A persisted pre-turn request is re-derived and fully
compared before it can mutate source. Source-only interrupted work is reported
as requiring existing draft recovery, without reviving the old task lease.
