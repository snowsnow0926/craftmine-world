# Managed Windows execution boundary for Godot builds

Independent Rust crate that runs Godot **as a restricted task process** for the
product. It is the only place that creates a restricted process; it accepts no
free-form command line. Callers describe a task through `task::Task`, and the
crate owns the profile, desktop, directory permissions, budget, logs,
cancellation and artifact handoff.

Cycle 6 adds the versioned host verification candidate described in
[BROKER_PROTOCOL_V1.md](BROKER_PROTOCOL_V1.md). Historical observations below
remain evidence of their particular builds, not a reusable authorization for
new tasks. Cycle 5 corrected the old `None == success` network error mistake,
measured explicit TCP denials for LPAC plus `registryRead`, and ran pinned Godot
import/export successfully while its legacy script-only gate remained unknown.

The private `godot-host-broker.exe run` now repeats TCP and UDP native preflight
for every task. Both native preflight and actual Godot are created suspended
inside a creation-time Job, and the host verifies package SID, the exact single
registry capability, Low integrity, executable identity and actual Job limits
before resuming. Unsupported LPAC query 87 is recorded explicitly. The host
constructs the receipt; a model cannot submit a `trusted` flag or a receipt.

Godot socket creation converts Windows failures to generic `FAILED` in the
pinned engine. Under this v1 contract its `error=1` is diagnostic/compatibility
evidence, not an independent OS proof. It is never rewritten to 10013. The
proof obligation is instead the reviewed fixed creation policy, host-read
actual process identity and the matching per-task native TCP/UDP denial tests.

Use `Task::run_with_preflight` for this full candidate result. `Task::run` alone
performs suspended host verification but has no network receipt and is
insufficient for broker/core acceptance. The private CLI additionally fixes
engine/template hashes, snapshots actual inputs and owns cancellation/cleanup.
This crate does not enable the product executor; core and browser gates remain
independent requirements.

## Layout

| Path | Role |
| --- | --- |
| `src/lib.rs` | shared helpers (`wide`, `win`, `Handle`, `Result`) |
| `src/acl.rs` | scoped directory grants + integrity label inspection |
| `src/desktop.rs` | task desktop on a non-interactive window station |
| `src/profile.rs` | fresh profile per run; recorded normal/cooperative cleanup |
| `src/launch.rs` | creation-time boundary: AppContainer, job, handle list, env |
| `src/task.rs` | product API: prepare / run / cancel / logs / artifacts |
| `src/verification.rs` | host token, image and Job checks before resume |
| `src/preflight.rs` | fixed native TCP/UDP observations and host echo controls |
| `src/recovery.rs` | persistent journal, task identity marker and host recovery pass |
| `src/broker.rs` | bounded strict request/response and pinned task execution |
| `src/bin/godot-host-broker.rs` | private JSON line transport and cancellation |
| `src/report.rs` | read-only identity and environment reports |
| `src/loader.rs` | bounded, read-only loader diagnostics |
| `src/main.rs` | fixed trusted acceptance gate (no arguments) |
| `src/probe.rs` | fixed native child probe (`boundary-probe`) |
| `src/bin/sandbox-diag.rs` | differential diagnostics and cancellation harness |
| `fixtures/web-sample` | fixed fixture project with `@tool` + plugin probes |
| `evidence/` | raw logs and results of the runs below |

## Root cause of the historic `0xC0000142` (isolated, not guessed)

Cycles 2 and 3 saw the restricted child exit with `0xC0000142` before `main`,
with empty logs. The loader trace ended at `KernelBase.dll`; that file was **not**
the cause. A differential matrix (`evidence/child-policy-matrix.log`, plus the
first 13-variant pass) changed exactly one launch condition at a time:

| Variant | Result |
| --- | --- |
| AppContainer + job + task desktop + handle list + minimal env | exit `0x0`, reached `main` |
| no task desktop / current station / WinSta0 desktop / extra desktop SID | `0xC0000142` (all) |
| no job, no handle list, full environment | `0x0` |
| **`PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY` = 1** with job | `0xC0000142` |
| same attribute without a job, without AppContainer, with `cmd.exe` | `0xC0000142` |
| same attribute with value 2 (`PROCESS_CREATION_CHILD_PROCESS_OVERRIDE`) | `0x0` |

The single sufficient and necessary variable is
`PROCESS_CREATION_CHILD_PROCESS_RESTRICTED`. AppContainer, the desktop, the job,
the handle list and the environment are all irrelevant to that failure. The
attribute is therefore **not used**; `LaunchSpec::child_process_policy` documents
this and only the diagnostic binary can set it.

Child containment is instead enforced by the task job
(`JOB_OBJECT_LIMIT_ACTIVE_PROCESS` = 1): a restricted child that tries to spawn
gets `ERROR_NOT_ENOUGH_QUOTA` (1816), measured from the native probe and from
Godot's own `OS.create_process`.

Two further findings from real engine runs:

- A 512 MiB job memory limit is too small for the editor: import aborted with
  `alloc_static` failures. The default budget is 4 GiB.
- The engine must **not** run in self-contained mode (`_sc_` marker) when its
  directory is read-only for the task; without the marker it keeps editor data
  under the redirected `APPDATA` (the task's own writable directory).

## What the boundary enforces

- One fresh `craftmine.godot.task.<task_id>` AppContainer profile per run, no
  reuse. The v1 broker uses LPAC with exactly `registryRead`; the older baseline
  diagnostic used no capabilities. Normal and cooperative cancellation paths
  delete the profile with a recorded HRESULT. Hard broker termination requires
  later recovery of profile/work state and cannot claim completed cleanup.
- A task desktop created on the logon session's non-interactive station
  (`Service-0x0-…$`, `WSF_VISIBLE` false). `WinSta0` is refused for the
  default-station path, and no existing station ACL is modified.
- Only directories created for this task are granted to the task SID: `bin`
  read/execute, `work` read/write/execute/delete. The work label is read and
  rejected above Medium; it is never relabelled.
- Engine and export templates are SHA-256-pinned before being copied in.
- Job: kill-on-close, one active process, 4 GiB process memory, and a wait bound
  per launch. Cancellation and timeout terminate the whole job.
- Only the log and `NUL` handles are inherited; the environment is minimal
  (`APPDATA`/`TEMP`/`USERPROFILE` redirected to the task work directory).
- Artifacts are hashed by the parent and stay untrusted model output.

## Crash recovery and the runtime budget

A hard-terminated broker cannot run destructors, so every task first writes a
parent-owned journal entry to `<tasksRoot>/.recovery-journal/<taskId>.json` and
a random-nonce identity marker to `<tasksRoot>/<taskId>/task-identity.json`.
Neither path is inside a directory granted to the task SID. The entry is retired
only after the broker produced its final response.

`godot-host-broker.exe recover <absolute tasksRoot> [--json-out <path>]` reclaims
a task only when the owning broker no longer runs (the entry records the broker
PID and creation FILETIME), the journal root, the task root, the identity nonce,
the AppContainer SID re-derived from the recorded profile name, and (when a child
still runs) the PID *plus* creation FILETIME all match host-written evidence.
A reused PID is reported and left alone; anything unverifiable is reported under
`skipped` and never deleted, and the entry is kept so a later pass can retry.
Truncated entries are reported under `unreadable` instead of aborting the pass,
and the command exits 1 when anything was left unreconciled. The report always
states `finalReceiptObserved:false` and never claims `cleanup.verified`, because
by definition no final response arrived.

While a task runs, the parent samples the task's `work` directory and its
inherited log file every 50 ms against a 1 GiB / 4 MiB budget and terminates the
whole job on breach. `resourceEnforcement.hardFilesystemQuota` is `false` on
purpose: this is an externally sampled budget, not a per-directory filesystem
quota. The overshoot is bounded by one sampling interval of writes; the fixed
inflation case measured 474 KiB above the limit. Named NTFS streams are counted
(`FindFirstStreamW`), so `metadata.len()` cannot hide bytes. Project
materialisation is separately bounded to 4096 files, 8192 directories, 256 MiB
per file and 512 MiB total before any process starts.

## Verified on 2026-09-09

Raw evidence: `evidence/gate-run1.txt`, `evidence/gate-run2.txt`,
`evidence/child-policy-matrix.log`, `evidence/cancellation.log`,
`evidence/task-api.log`, `evidence/parent-environment.log`, `evidence/tests.log`.

- `probe.allowed_dir_write=passed`
- `probe.denied_read_error=Some(5)`, `probe.denied_write_error=Some(5)`
  (synthetic sibling sentinel, never granted)
- `probe.denied_interactive_station_error=Some(5)`,
  `probe.child_station_visible=false`
- `probe.net_external_connect_error=Some(10013)` (TEST-NET-1 target, policy
  denial, not a routing timeout) with a host loopback positive control
- `probe.child_spawn_error=Some(1816)` (job active-process limit)
- `godot_version_output="4.7.2.stable.official.ed1daf0bf"`
- `godot_import` exit `0x0`, `.godot/` produced
- Web export exit `0x0`, 9 artifacts hashed by the parent
  (`index.html`, `index.js`, `index.wasm`, `index.pck`, worklets, icons)
- editor-time boundary (`fixtures/web-sample`): `plugin_ran=true`,
  `tool_init_ran=true`, sentinel read/write and sibling escape `denied`,
  external connect `denied`, `plugin_spawn=denied(error=-1)`
- cancellation: `cancel_timed_out=true`, `cancel_job_active_processes=Some(0)`,
  `cancel_pid_alive_after=false`
- product API (`task::Task`, `evidence/task-api.log`): `Version`, `Import` and
  `ExportWeb` all `Succeeded`, 9 artifacts handed off with parent hashes, and a
  2-second budget ended `Cancelled` with `job_active_processes=Some(0)`
- `cargo test --offline`: 7 unit tests (task-id validation, fixed argument sets,
  pin mismatch rejection, argument quoting, environment block, path containment)

## Verified on the final broker binary (2026-09-10)

Broker SHA-256 `76932e6909665321fd061e2a8a8e3c6cd7527de03259b15f282018730b892258`.
Raw request/response/log/recovery files:
`docs/dispatch-reports/godot-remaining/B/evidence/`, driven by
`tests/godot-remaining/B/run_broker_cases.mjs` (headless, no real input).

| Case | Observed result |
| --- | --- |
| `version` | exit 0, process and per-task network receipts verified, cleanup verified |
| `import` | exit 0, both receipts verified, cleanup verified, journal retired |
| `exportWeb` | exit 0, 9 artifacts handed off, cleanup verified |
| `eof` (immediate stdin close) | `cancelled` before preflight, no process receipt, cleanup verified |
| `cancel` mid-run | `cancelled` exit `0x5d`, process receipt verified, resume count 1, child PID gone, cleanup verified |
| `terminate` (broker killed) | no final response; recovery verified identity, profile deleted (HRESULT 0), task root reclaimed, child `gone` |
| `live-recover` (recovery during a live task) | recovery refused with `broker-still-running`, task root and child untouched, task then cancelled normally |
| `adversarial` `@tool`/editor plugin | sentinel read/write and sibling write denied, spawn denied, external and loopback connect `unknown(error=1)`, host loopback listener received 0 connections |
| `inflation` | sampled work budget enforced at 1,074,226,570 bytes over a 1,073,741,824 limit (474 KiB overshoot, 86 samples), job terminated, cleanup verified |

## Not verified

- **Godot-level network denial is not an OS proof.** The pinned engine collapses
  Winsock failures into generic `error=1`, so editor-time script output can only
  ever be recorded as `unknown`. The OS-level evidence is the native preflight,
  which returns explicit `PermissionDenied`/10013 for all six TCP/UDP checks
  under the same package SID, plus the host positive controls. The product
  execution gate stays closed until core accepts that split.
- UI/input isolation, clipboard and DPI behaviour.
- Reparse-point and handle-race attacks; CPU/GPU rate quotas and true disk
  exhaustion. The work-directory budget is sampled by an external parent, not a
  filesystem quota, and `resourceEnforcement.hardFilesystemQuota` says so.
- Real model-authored projects (only the fixed fixture was used).
- The web build was exported, not run in a browser.
- Non-Windows platforms: the crate is `#![cfg(windows)]`.

## Build and run

```powershell
# build only (no profile creation, no process execution)
cargo build --offline --manifest-path desktop/godot/sandbox/Cargo.toml

# unit tests
cargo test --offline --manifest-path desktop/godot/sandbox/Cargo.toml

# differential diagnostics (creates scoped profiles and task desktops)
& desktop/godot/sandbox/target/debug/sandbox-diag.exe matrix out\matrix
& desktop/godot/sandbox/target/debug/sandbox-diag.exe cancel out\cancel
& desktop/godot/sandbox/target/debug/sandbox-diag.exe parent out\parent\parent.txt

# fixed acceptance gate: native probe + real Godot version/import/Web export
& desktop/godot/sandbox/target/debug/craftmine-godot-sandbox-probe.exe
```

The gate and the probe accept no arguments; paths, hashes and the fixture are
fixed in `src/main.rs`. Automatic verification never synthesizes mouse or
keyboard input, never requests pointer lock and never activates or foregrounds a
window.

## Product interface

`task::Task` is the interface for the executor and PI tools: prepare, run,
cancel flag, status, log path, artifact handoff, finish. See
`docs/dispatch-reports/godot-parallel/A/INTERFACE_A.md` for the exact signatures
and the handoff contract, and
`docs/specs/godot-sandbox-execution-boundary-A.md` for the behavioural
requirements.

## Primary references

- [Microsoft AppContainer launch](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)
- [Creation-time process attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
- [Job objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Godot code executing in the editor](https://docs.godotengine.org/en/stable/tutorials/plugins/running_code_in_the_editor.html)
- [Chromium standard-user station fallback](https://raw.githubusercontent.com/chromium/chromium/main/sandbox/win/src/window.cc)


## Integration audit hardening

Task roots require an existing absolute ordinary parent and exclusive creation. Existing ids are refused, including previous failed runs: retry with a fresh id. Reject reparse components and reserved Windows device names. Verify pins after copy and retain the exact engine path. Managed budgets require one active process and positive time/memory. Tasks run once; startup errors become Failed. Only successful tasks hand off regular artifacts. Work/profile cleanup failures are returned.

The inherited stdout file handle remains writable by the child. Its entire log is untrusted diagnostic text, not an authenticated execution receipt. The host must mint structured outcomes and independently verify artifacts. This hardening does not close loopback networking, prove hostile-project isolation, or enable product execution.
