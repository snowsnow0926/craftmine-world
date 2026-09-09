# Managed Windows execution boundary for Godot builds

Independent Rust crate that runs Godot **as a restricted task process** for the
product. It is the only place that creates a restricted process; it accepts no
free-form command line. Callers describe a task through `task::Task`, and the
crate owns the profile, desktop, directory permissions, budget, logs,
cancellation and artifact handoff.

Status on 2026-09-09 (standard user, session 1, not elevated): the boundary
works end to end for real Godot 4.7.2 — native denial probes, `--version`,
headless import and Web export — and editor-time code (`@tool` resource and an
enabled editor plugin) stays inside the same boundary. See
[Verified](#verified-on-2026-09-09) and [Not verified](#not-verified).

## Layout

| Path | Role |
| --- | --- |
| `src/lib.rs` | shared helpers (`wide`, `win`, `Handle`, `Result`) |
| `src/acl.rs` | scoped directory grants + integrity label inspection |
| `src/desktop.rs` | task desktop on a non-interactive window station |
| `src/profile.rs` | one fresh AppContainer profile per run, always deleted |
| `src/launch.rs` | creation-time boundary: AppContainer, job, handle list, env |
| `src/task.rs` | product API: prepare / run / cancel / logs / artifacts |
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
  capabilities, no reuse; deleted with a recorded HRESULT.
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

## Not verified

- **Loopback isolation remains unverified.** Earlier evidence recorded
  `net_loopback_connect_error=None` and incorrectly interpreted it as success.
  That expression conflated `Ok` with `Err` having no raw OS error (including
  Rust-created timeouts). Cycle 5's event completion and echo probes have not
  demonstrated a cross-container data connection or an explicit policy denial.
  Binding a listener alone proves neither. The product execution gate stays closed.
- LPAC (Less Privileged AppContainer), UI/input isolation, clipboard.
- Reparse-point and handle-race attacks; CPU/disk/GPU quotas; disk exhaustion.
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
