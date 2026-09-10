# c4af packaged client checkpoint

Source: `c4af0d28492980697c3ca89bf595ae1c8fa6bffc`. Build manifest SHA256:
`8f7fd77255b21215e37d22db9ab55f587d7e14045ff75890acb20be726e2c2f1`.
The installer payload and portable extraction were verified against the same
source build, and the sealed bytes were verified again after execution.

| Actual packaged acceptance | Passed steps | Audited client exits | Result |
| --- | ---: | ---: | --- |
| Four bases, gameplay, reuse, independent copies, backup and restore | 55/55 | 8 | Passed |
| Parameter editor and optional guide from the portable ZIP | 20/20 | 3 | Passed |
| Local issue followups and player retest states | 22/22 | 3 | Passed |
| Main/React history comparison and stale view refusal | 9/9 | 1 | Passed |
| Standalone Windows game export, save and reopen | 8/8 | 1 | Passed |
| Excessive task path, first failure and full client restart | 4/5 | 2 | Failed |

All listed client exits returned zero with empty input violations, renderer
errors and owned-shutdown failures. Logs retain expected refusal diagnostics and
Electron warnings; they are not claimed to contain no diagnostics. The separate
exported game also ran and saved in two native processes.

## Release blocker found in the actual package

The 266 UTF-16-unit task cache path is refused before an import directory or
engine task is created. The first client correctly displays
`GODOT_TASK_PATH_TOO_LONG` at the build stage. After restart, a status read
automatically starts initialization for an already failed world. Its existing
task requires explicit recovery; the transient `EXPLICIT_RECOVERY_REQUIRED`
error then overwrites the precise durable error in the client projection.

This package therefore remains a failed release candidate. Core-only restart
evidence did not cover the desktop factory's eager automatic startup. The fix
must prevent automatic terminal-state initialization while preserving explicit
recovery, and must pass the unchanged packaged restart assertion in a new build.

## Artifact identities and limits

- Installer: 343411223 bytes, SHA256
  `04ad0511847a636596e0e41f02a4953f8d69ac2710b75df810d3bc204d7f854c`.
- Portable ZIP: 441018968 bytes, SHA256
  `23c4681c0ec421c579edea92e95766072de61fff857a1b0232399fd731671aff`.
- Source ZIP: 53621785 bytes, SHA256
  `b4fae3c7a50c6338acd3d21f85d8caecc4330f7ffc3453fa3fab7ecdf0b9cd2a`.

The client and installer are unsigned local previews. Preflight reported zero
failures and 154 warnings. Installer execution, clean-Windows installation,
upgrade and uninstall were not tested. Real-model acceptance is not run because
the requested external transmission and billing authorization remains pending;
fixed inputs cannot substitute for it.

Four actual offscreen game captures were inspected. They show the first-person,
top-down, side-view and mining worlds rendering rather than a blank surface.
The side-view and mining worlds still use simple prototype visuals. Functional
acceptance does not establish finished art, player comfort or engaging gameplay.

The six original reports are preserved byte-for-byte under `raw`, with their
source paths and hashes in `raw-evidence-index.json`. The immutable release's
`delivery` directory also retains build logs, complete runtime logs, game-only
captures, identity manifests, the Chinese delivery report and the explicit
real-model NOT_RUN record. The next PP2 default-value feature is not in this
package. The primary checkout's ten user plan documents remain unchanged.
