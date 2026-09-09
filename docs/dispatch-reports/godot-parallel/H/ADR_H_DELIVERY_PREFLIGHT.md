# ADR: delivery preflight is read-only, fail-closed and condition-based

Status: accepted. Owner: task H. Date: 2026-09-09.

## Context

GD0 pinned Godot 4.7.2-stable and proved a fixed Web export, but the engine is still
`gd0-candidate-not-production-bundled`, the client already carries independent
LGPL-3.0-or-later obligations from PI-Desktop, and no per-base asset provenance
record existed. Licensing and packaging facts were spread across
`toolchain.lock.json`, `desktop/windows-NOTICES.md`, generated package output and
build logs. A green build could therefore ship without anyone checking that notices
were present, that the LGPL text had not been replaced by the Godot MIT text, or that
an undeclared asset had entered a base.

## Decision

1. **Read-only checker.** `desktop/delivery/preflight.mjs` only reads, hashes and
   compares. It never downloads, never runs an installer, never opens a window and
   never writes inside the inspected tree. Evidence is written only to an explicit
   `--evidence` path.
2. **Fail closed.** Any missing notice, missing asset, missing licence, byte or hash
   drift, undeclared file, or distribution/redistribution contradiction is a failure
   and a non-zero exit code. Missing optional inputs (cache/export/package) are
   reported as `skipped`, never as passed.
3. **Separate obligations.** The Godot MIT notice and the PI-Desktop LGPL notice are
   checked by different rules, and the LGPL entry carries a negative content
   assertion for the MIT grant sentence, so the two can never substitute for each
   other even if hashes are updated.
4. **Content assertions, not only hashes.** Pinned hashes alone would pass if someone
   replaced a licence with arbitrary text and updated the hash. Every notice entry
   therefore also asserts required and forbidden text.
5. **Condition-based engine obligation.** Godot notices are required only when the
   package actually contains an engine binary. This avoids both a false pass (engine
   shipped without notices) and a false failure (engine not yet bundled).
6. **Explicit unresolved state.** `project-authored` assets must state either a
   licence document or an explicit `outstanding` reason. An unresolved licence
   decision can never be silent.
7. **No auto-refresh.** The checker will not rewrite its own pinned hashes. New bytes
   require a reviewed manifest update, because the manifest is a provenance record,
   not a cache.
8. **A17 is gated, not simulated.** The Windows lifecycle script refuses to execute
   without an isolated-runner marker, an absolute install directory inside that
   runner root and a non-production profile directory. Without all of them it emits
   `a17Status: not-verified` and executes nothing.

## Consequences

- Release gating becomes possible with one command and one exit code.
- Base authors must update `desktop/delivery/base-assets/*.json` whenever they change
  pinned bytes; this is intentional friction that keeps provenance reviewed.
- The package check depends on the artifact-to-package mapping implemented by
  `desktop/windows-package-tools.mjs`. If that mapping changes, the checker must be
  updated in the same change (documented in `INTERFACE_H.md`).
- The checker proves byte identity and declared conditions. It is not a legal
  opinion, and it does not decide whether a licence fits a particular commercial use.
- A17 remains unverified until an isolated Windows machine is available.

## Alternatives rejected

- **Extend `windows-package-tools.mjs` directly.** Rejected: it is a public packaging
  entry point owned by another task; changes there were requested as interfaces
  instead.
- **Auto-generate manifests from the file tree.** Rejected: it would assign origins
  and licences by guesswork, which is exactly the failure mode the manifest exists to
  prevent.
- **Require Godot notices unconditionally.** Rejected: the engine is not yet bundled,
  so it would report a permanent false failure and train reviewers to ignore it.
- **Execute the installer to "prove" A17 in this session.** Rejected: the user's
  client must not be modified, and no isolated Windows environment exists.
