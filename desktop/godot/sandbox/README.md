# Windows AppContainer prototype — compatibility blocked

This is a fixed, trusted GD0 experiment, not the production execution boundary.
It does not accept model/user projects or arbitrary commands. **Do not route LLM
imports, @tool scripts, addons or exports through it.**

## What is implemented

- Independent Rust crate, compiled offline with cached windows-sys 0.61.2 and sha2 0.11.
- A new unique `craftmine.gd0.probe.<pid>.<milliseconds>` AppContainer profile per run,
  no capabilities, and no profile reuse. A drop guard deletes only this newly created
  profile. Profile creation and directory permissions require scoped authorization.
- New directories only under this crate's `out/`: the task SID gets read/execute on
  `bin` and read/write on `work`. No existing workspace, desktop or system ACL is
  modified, and no ALL APPLICATION PACKAGES grant is created.
- Job attachment at process creation, kill-on-close, one active process and 512 MiB
  process memory limit; child creation restriction; only log/NUL handles inherited.
  Each launch has a 15-second bound. Parent verifies TokenIsAppContainer before
  accepting any result. Standard AppContainer is used; LPAC is not implemented.
- Fixed native child probe intends to prove permitted task-file access, denied
  access to a synthetic sibling sentinel, denied connection to a host-created
  loopback listener, and denied fixed no-window child creation. These probes never
  touch credentials, clipboard, user input or another application.
- Only if all native checks pass, copy and run the SHA-256-pinned Godot 4.7.2
  executable with exactly `--headless --version`. The original cache is read-only.

## Actual result on 2026-09-09

Offline compilation passed. Two precisely scoped, approved executions created an
AppContainer process (TokenIsAppContainer = 1), but the native child terminated
before its first application output with status `0xC0000142` (3221225794, DLL
initialization failed). Both logs are empty. Attempt 2 separated the child probe
from the parent's userenv/profile-management imports; it had the same result.
The cause has **not** been isolated. Do not claim that DLL import separation fixed
it, or that a desktop ACL change is necessary from this evidence alone.

Both newly created profiles were deleted successfully (HRESULT 0). No Godot
process was started because the native gate failed. **File/network/child denial,
Godot startup, LPAC, import, addons, export and UI isolation remain unverified.**
The synthetic files and scoped ACLs remain only in these ignored evidence folders:

- `out/craftmine.gd0.probe.220548.1788953192498`
- `out/craftmine.gd0.probe.250596.1788953266431`

The initial build exposed a sha2 0.11 hexadecimal formatting incompatibility; this
was fixed by formatting digest bytes explicitly before the successful builds.
`evidence/results.json` records the observed outcomes; `evidence/build.log` records
the final offline compile. No missing/empty runtime log is replaced by success.

## Reproduce after reviewing the compatibility blocker

Build only (no profile creation or process execution):

```powershell
cargo build --offline --manifest-path desktop/godot/sandbox/Cargo.toml
```

Runtime experiment (creates scoped profile and new output ACLs; not ordinary build):

```powershell
& desktop/godot/sandbox/target/debug/craftmine-godot-sandbox-probe.exe
```

The cached engine path and hash are intentionally fixed in `src/main.rs`; this is
not a portable delivery launcher. The child binary must be built alongside it.
A separate investigation should identify the process-initialization failure using
read-only loader diagnostics or an isolated non-interactive desktop created for
that experiment. Never weaken the default desktop ACL or silently remove sandbox
restrictions. Keep UI/headless compatibility, LPAC, non-loopback network denial,
reparse-point/handle attacks, resource exhaustion, import/export correctness and
model-authored projects as separate pending acceptance work.

## Primary references

- [Microsoft AppContainer launch](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)
- [Creation-time security, child-process and job attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
- [Job Objects and their limits](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Godot code executing in the editor](https://docs.godotengine.org/en/stable/tutorials/plugins/running_code_in_the_editor.html)
