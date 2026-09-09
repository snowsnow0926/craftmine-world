# Raw broker evidence (task B)

Every file here is produced by `tests/godot-remaining/B/run_broker_cases.mjs`
driving the pinned `godot-host-broker.exe`. Nothing in this directory is
hand-written; failures from intermediate builds are kept on purpose.

## Final run

`index-b-20260909170609698-173804.json` is the single run in which all nine
cases passed on one binary:

- broker SHA-256 `76932e6909665321fd061e2a8a8e3c6cd7527de03259b15f282018730b892258`
- engine `D:/Craftmine World/desktop/build/godot/4.7.2-stable`, editor and all
  four templates re-hashed before the run
- cases: `version`, `import`, `exportWeb`, `eof`, `cancel`, `terminate`,
  `live-recover`, `adversarial`, `inflation`

Per case, `<taskId>.request.json` is the exact request frame,
`<taskId>.stdout.json` the final private response (empty for `terminate`),
`<taskId>.stderr.log` the broker diagnostics, `<taskId>.task.log` a bounded copy
of the untrusted Godot log, `<taskId>.summary.json` the harness assertions and
`<taskId>.recovery.json` the recovery report (terminate only).

## Earlier failures kept for the record

Runs before the final index document real defects and their fixes:

- `b-20260909164833583-252068` (terminate) — recovery aborted with
  `QueryFullProcessImageNameW: os error 5` on an already-exited child, and
  `DeriveAppContainerSidFromAppContainerName` was misread as a failure because
  the HRESULT helper used BOOL semantics. Both fixed; the child exit status now
  decides before any image query.
- `b-20260909165040922-235968` (adversarial) — the runtime watchdog failed the
  task with `os error 2` because the directory walk treated a file that vanished
  mid-walk as fatal. The walk now ignores transient `NotFound` entries.
- the first `live-recover` runs — recovery classified a hard-killed broker as
  still running, because a terminated-but-not-yet-reaped process still opens and
  keeps its creation time. Liveness now also requires `STILL_ACTIVE`.

## What is not evidence here

- No model-authored project was used; the projects are freshly created
  synthetic copies of `desktop/godot/sandbox/fixtures/web-sample`.
- The adversarial case only touches a synthetic sentinel created for that task.
  It never reads a user world, credential or real project.
- Godot's own socket error is recorded as `unknown(error=1)`; it is never
  upgraded into an OS denial.
