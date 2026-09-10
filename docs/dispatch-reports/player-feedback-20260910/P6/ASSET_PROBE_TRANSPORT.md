# Finite asset acceptance transport repair

Frozen package `b9c0c0d5bdf371280d1a9814773d614e02920e16` passed the
default-parameter driver (28 checks, four strict shutdowns) and selected-issue
export (11 checks, two strict shutdowns). Its asset driver failed after four
checks, before import/preview. Original evidence remains at root
`test-results/desktop-native-assets-kCOw0p/report.json` without modification.

The asset probe threw expected ownership/readiness errors inside the renderer.
Electron replaced their text with a generic execution error and the strict exit
audit correctly retained the uncaught renderer errors. This is not a passing
asset acceptance result.

The private acceptance helper now transports only five exact expected guard
codes as structured data. Main validates/unwraps this transport and raises the
original finite error outside the renderer. Opening before the actual form is
available returns `ready: false, open: false`; polling still requires the real
sheet. Unexpected exceptions continue to reject in the renderer. Product asset
permissions, authorization, validation and user-facing errors are unchanged.

Six pure transport regressions passed, including unknown exceptions and malformed
transport. Sixteen actual React/headless DOM fixture checks passed with zero
page errors and no focus/Pointer Lock. Logs and the DOM report are beside this
document. This does not replace the failed packaged run: a newly compiled,
identity-bound package must rerun the actual asset driver with strict shutdowns.
