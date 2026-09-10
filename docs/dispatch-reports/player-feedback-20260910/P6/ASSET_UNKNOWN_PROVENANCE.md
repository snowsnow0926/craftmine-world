# Blank provenance import repair

The actual `beb66d76c00a102c755ec7aeaed59b19cf5c68a9` packaged asset run
passed six checks, including native directory grant/scan, then failed on the
unchanged default import form with `INVALID_TEXT`. Core requires nonempty source
origin, author and licence; the UI initialized author/licence to empty strings.
Original failure: `D:/cm-fb2-20260910/test-results/desktop-native-assets-ocBkgp/report.json`.

Import request construction now records empty/whitespace source text as literal
`unknown`. An absent licence always uses `licenseStatus: unknown`, including if
the form still selected verified. Supplied source text and status are preserved
apart from surrounding whitespace. The UI explicitly explains blank/unknown
provenance. No licence grant is inferred, and Core validation is unchanged.

Validation: four tests passed, including an actual frozen packaged Core
import/read/full process restart with exact image bytes and unknown metadata.
The original blank request was also rejected by that same Core. Seventeen
actual React/headless DOM fixture checks passed, including the visible hint and
the exact real confirmation-form payload. Logs and reports are archived beside
this document. No input/focus/Pointer Lock or model call was used.

This code has not yet been accepted through a rebuilt package. The old package
remains failed for default UI import. A separately identified exploratory
driver may use explicit generated provenance through the authorized Main import
route to inspect the downstream PNG decoder, but cannot count as this UI fix's
packaged acceptance.
