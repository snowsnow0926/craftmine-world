# Actual native player feedback driver

`tests/playtest-feedback-client-native.mjs` launches only its own offscreen PI
Electron processes with independent author/friend profile directories. It uses
the real renderer forms, bound native world capture, dialogs' established
headless file grants, Rust feedback journal and normal quit/cold reopen.

The author creates the approved mainline example and saves/exports a template.
The friend starts with an empty profile, imports that ZIP, creates an independent
world, opts into a screenshot and previews the report. The driver writes the
displayed native PNG prepared before opening the sheet into evidence, requests normal progress save after preview,
then confirms export and compares PNG/text/build identity with the reviewed
payload. No injected image or replacement domain implementation is used.

The author previews/imports the report twice, proves no preview-side persistence
and idempotency, cold-reopens and reads it through the actual list. The AI-review
action must prepare an existing Composer draft containing exact feedback/source
IDs and untrusted-data framing; it must not submit a turn. A linked author reply
is exported, imported by the friend and verified after another normal restart.
Every session's persisted turn metrics are inspected; zero model calls is a
measured result only after successful completion.

Run only after the coordinator supplies integrated, stable binaries/resources:

```powershell
$env:CRAFTMINE_CREATION_OUTPUT_ROOT='D:/cm-product-feedback/test-results'
$env:CRAFTMINE_ELECTRON_BIN='<absolute Electron executable>'
$env:CRAFTMINE_EVAL_CORE='<absolute integrated craftmine-core.exe>'
$env:CRAFTMINE_EVAL_HOST='<absolute integrated pi-desktop-host-core.exe>'
node tests/playtest-feedback-client-native.mjs '<absolute integrated checkout>' '<absolute runtime resources>'
```

For packaged acceptance add `--packaged-root '<absolute win-unpacked>'`; the
runtime resource argument must be that exact `win-unpacked/resources` directory.
An external staging directory is rejected before launch, preventing package
acceptance from silently using source-checkout runtime assets. The
shared launcher verifies package identity/inventory. The report records source
bundle, native binary and driver hashes and all shutdown audits. Create the
printed `cancel` file to stop cooperatively. No whole-test/model/token budget is
introduced. Local RPC/transport watchdogs retain the established diagnostic
failure behavior.

The driver was prepared and syntax-checked before integrated runtime execution.
Terminal error text from a player form immediately fails the run even when its
diagnostic code also names a transient native condition such as capture busy.
For an explicitly reported missing pre-sheet frame only, the driver records the
failure and follows the visible close/reopen-library recovery once, verifies
unsaved fields survive, and again requires a real reviewed PNG. Both attempts
remain in the report. No raw prepared-frame injection or hidden capture fallback
is used; another failure ends acceptance.
Passing storage fixtures and React tests do not imply this native test passed.
Only an actual generated report with `passed: true` is acceptance evidence.

Final package command template (prepare now; execute only against the frozen
delivered directory). Replace the package directory with the coordinator's real
`win-unpacked` path. The test does not need a Codex account or submit model calls.

```powershell
$packageDirectory = 'D:/Craftmine Releases/<final-preview23>/output/win-unpacked'
$env:CRAFTMINE_CREATION_OUTPUT_ROOT = 'D:/cm-preview23-feedback/test-results'
node tests/playtest-feedback-client-native.mjs `
  'D:/Craftmine World' `
  (Join-Path $packageDirectory 'resources') `
  --packaged-root $packageDirectory
```

The package owns Core, host, app bundle and runtime resources. Source-mode
Core/host environment overrides are not package acceptance evidence. Keep the
two-profile result separate from the source T37 acceptance and from the operator's
later, explicitly submitted real AI repair turn.
