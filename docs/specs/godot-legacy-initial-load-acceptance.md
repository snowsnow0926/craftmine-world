# Legacy first-load recovery acceptance

This fixed two-phase acceptance creates its own first-person training-range
world. It never reads an installed world, a player profile, or credentials.
All new profiles, temporary data, exports, logs and fixture compilation live on D.

The fixture uses the production factory, Core, executor, actual offscreen build
check, runtime adapter and candidate coordinator. Its sole authored source
variation is the exact historical `runtime_bridge.gd` Git blob, SHA-256
`318fdb30c40a6165a2080ff12190571fada156ba321f83c3264bae91e4052c76`.
The newly authored managed inventory honestly records those legacy bytes.
The fixture changes the host's test-bundle headless predicate to false so its
detached child is native; the owner remains hidden, offscreen and non-focusable.
There is no product startup hook, synthetic load error, fake coordinator reply,
new RPC, or input event. An unexpected successful load is a failed reproduction.
The original check must pass; the actual load must time out; Core must persist
the aborted application and `GODOT_INITIAL_LOAD_FAILED`. Failure evidence remains.

After all fixture processes close, the full compiled client starts on that same
isolated profile. Existing finite IPC invokes world list/open/creationRetry and
runtime capture/save/snapshot. The explicit retry must create a new source
revision, successful check job and candidate, then confirm the application.
Only the known bridge may change to
`faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2`.
Old source remains readable at its exact revision/hash, the old aborted receipt
remains unchanged, and the managed base directory remains byte-identical.
Two full-client closes require exit zero and empty input, page-error and shutdown
failure audits. Complete saved progress is compared after restart; only transport
metadata is excluded. Native failure and offscreen recovery are separate modes,
not a claim that an offscreen child reproduces the native frame-stall failure.

Run after integrating the driver and freezing/rebuilding a clean source:

```powershell
node tests/player-feedback/P1/legacy-retry-client.mjs --source-root D:/cm-fb-20260910 --runtime-source D:/cm-fb-20260910/desktop/godot --deps-app C:/cm-plan-next-20260910/vendor/pi-desktop/apps/desktop
```

For a release, replace `--runtime-source` with `--packaged-root`,
`--expected-commit` and `--expected-build-manifest-sha256`. Every package launch
revalidates the explicit immutable package inventory. The fixture still compiles
the matching production host modules into a separate test Electron app and
records its Electron identity; it is not itself the packaged main process.
The full-client phase uses only the package EXE, Core, plugins and runtime.

Bounded native follow-up: one successful explicit legacy repair; one unknown
bridge rejection preserving all bytes; one repeated retry after confirmed apply
that must not make a repair revision. Cross-world/stale application CAS belongs
to actual Core tests and need not each launch another full engine instance.
Contract unit tests only verify acceptance rejection rules, not native recovery.
No recovery success is claimed until the native report and both client launches
pass against the newly compiled candidate. The previous 827 package is ineligible.

On restart, the client automatically reopens its persisted selection. The test
waits for an actual observation with the expected protocol, world, build and
instance identity, then checks the selected ready world. It does not race that
startup with a redundant world.open or query a not-yet-mounted navigation view.
Only the two observed exact absent-runtime message forms are pending, within a
120-second deadline; malformed/foreign observations never satisfy the wait.
Other errors, including WORLD_BUSY and runtime load timeouts, still fail.
Controlled deadline and schema tests cover these acceptance-only rules.
