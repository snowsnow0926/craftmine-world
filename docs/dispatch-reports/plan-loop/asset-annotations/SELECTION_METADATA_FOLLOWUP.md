# Selection metadata race follow-up

Root review of `5864296` found and this controlled regression reproduced:

1. `select(A)` captures favorite=false and waits for the body read.
2. Annotation sets favorite=true and its host search refresh completes.
3. The refresh replaces the cards and retires the acknowledgement cache.
4. The old body read returns and restores the captured favorite=false detail,
   although the current card correctly says true.

The original targeted test failed exactly `false !== true`; its raw output is
retained in `evidence/selection-race-before.txt`. The fix re-resolves matching
current metadata after the existing generation guard and before emitting the
selection. Current cards/selection precede the captured row; retained confirmed
annotation fields remain an overlay when a filtered card is absent.

Validation: original 28 regressions plus 2 controlled ordering cases passed,
including favorite and tags after a completed refresh, and an old A read after
new selection B. Strict UI TypeScript checking passed. Raw 30-test output is
`evidence/selection-race-after.txt`.

The previous actual React/Core eight-step report remains evidence for the
earlier `5864296` UI hashes. No browser, Electron, Godot or engine work was rerun
for this narrow follow-up; the added ordering is verified with the actual
controller and controlled host promises. Original reports are not rewritten.
