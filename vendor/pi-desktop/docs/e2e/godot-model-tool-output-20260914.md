# Godot model output regression evidence — 2026-09-14

Build the real plugin, then run the focused read-only contracts:

```powershell
node desktop/build-world-plugin.mjs --output test-results/native-diagnostics-plugin
node --test tests/godot-tool-output.test.mjs tests/godot-diagnostics.test.mjs tests/godot-agent/recovery-facts.test.mjs tests/godot-native-diagnostics.test.mjs
```

The new contracts check unchanged stored values, passed-job error observations,
distinct/stale source diagnostics, occurrence/evidence accounting, raw-log
hashes, historic task scope, application authority, the packaged default read
and its exact explicit full-read counterpart. Existing native diagnostic tests
explicitly request full representation when asserting original logs and
per-item source equality; their host-native evidence validation is unchanged.

An independent pure projection of original turn
`13f568f7-a73a-4796-8322-d7594c843fa7` retained exact source transcript bytes
and compared all 22 facts/build text blocks. Core identity, verdict, staleness,
application guidance and diagnostic occurrence count were preserved.
Local evidence: `test-results/godot-tool-output-real-turn.json`.
Text totals changed from 1,214,116 to 663,257 characters. Final facts text changed
from 61,667 to 41,043; final build text from 52,000 to 20,671 characters. These
are actual model text blocks, not the larger duplicated persisted UI envelope,
token savings or predicted compaction counts. A fresh real model continuation
is the root agent's separate acceptance step.

No model, GPU, mouse, keyboard, focus changes or Pointer Lock were used here.
Focused results: 68 tests, 67 passed and one pre-existing assertion failed.
The old native diagnostic packaging assertion expects a production
`executorNativeDiagnosticEvidence` callback absent at baseline `59af14d2`;
its failure is retained and is outside this projection change.
The baseline and current normalized main source SHA-256 are identical; the
source proof is `test-results/godot-tool-output-baseline-assertion.json` and the
unmodified failure output is in `test-results/godot-tool-output-tests.log`.

Integration follow-up `76ea1547` restored the production callback to the
existing managed executor. The same 68 tests now pass; the root evidence is
`test-results/integrated-godot-evidence-fixed.log`. The earlier missing-callback
failure remains historical evidence rather than a current unresolved failure.
