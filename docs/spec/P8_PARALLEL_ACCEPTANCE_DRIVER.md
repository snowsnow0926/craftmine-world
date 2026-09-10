# P8 parallel acceptance driver

Status: implemented. Owner: P4. Entry point:
`tests/player-feedback/P8/client-native.mjs`.

## Context

The P8 acceptance driver proved that a real model could author, build, check,
preview, adopt and replay a hammer and a dog. It ran both cases in one process on
one shared admission ledger, which made two things impossible:

1. two cases could not be accepted at the same time, because the ledger lock is
   exclusive and the dated unlimited phase pins one ledger for every checkout;
2. a single-case run could not be reported honestly, because the aggregate flags
   and the loop both assumed exactly two cases.

It also replayed fixed gameplay commands and recorded the raw results without
judging them, so "played" was a sequence, not a verified behaviour.

## Decision

The driver takes an explicit case selection and one ledger per run, and it
judges gameplay per mechanic from the evidence it already collects.

### Case selection

`CRAFTMINE_P8_CASES` lists `hammer`, `dog` or both. An empty, unknown or repeated
segment is refused rather than silently dropped, so a mistyped pair can never
become a single-case run that looks deliberate. The case loop and the aggregate
verdict are driven by that selection; the process itself still runs the cases in
the fixed order it names.

### One ledger per run

- default: `<run output>/ledger/requests.ndjson`, created fresh for this run;
- explicit: an absolute directory strictly inside `<source-root>/test-results/`,
  which must be newly created and hold neither a ledger nor a lock.

Any other location is refused, so one agent cannot record requests into another
agent's evidence range. The historical ledgers are opened read-only, counted
separately, and re-hashed after the run; a changed historical ledger invalidates
the run's accounting.

`admissionAccounting` reports `historicalTotal`, `priorInThisLedger` and
`thisRun` separately, and `total` as their sum. Request entries that already
existed are never presented as new requests.

### Verified gameplay

`gameplay-criteria.mjs` turns the raw command results, the observation envelopes
and the authored source of the checked candidate into per-criterion verdicts:

- `verified` — direct evidence;
- `failed` — contradicting evidence;
- `insufficient` — the run never produced the evidence.

All criteria are required, and `insufficient` is as fatal as `failed`. An equip
verdict reads only the equip command's own result, so a rejected equip cannot
inherit "the hammer is active" from a neighbouring sample. A `thunder_hammer`
identifier does not satisfy the lightning criterion by itself: a light or flash
construct must appear in a file that names the item.

The gameplay helper's command sequences are sized so the criteria are decidable:
the hammer sequence forces one attack, an immediate repeat inside the same
cooldown window, a wait longer than the required second, and enough walking for a
melee reach to connect. The dog sequence talks at spawn, walks a short way, and
then walks as far as the small town map allows (640x352 px) before talking again.

### Rounds and stops

Every round is retained with its request evidence, usage, tool calls, DOM metrics
and a progress sample, plus `requestTotals` across rounds; the report never shows
only the last round. A continuation is requested only after the previous turn
proved `completed`, never after a cancelled, failed or stopped turn.

A run-scoped stop file (`craftmine.p8-run-stop/1`) names this run and its case,
so an operator can stop a run without reading a turn id. Identity still comes from
the driver's own live binding: the file cannot select a session, method, path or
script, and a request for another run or case aborts nothing.

### Verdict

`singleCasePassed` and `combinedTwoCasePassed` are mutually exclusive by
construction. `passed` stays `false` with `reviewRequired: true`: the pipeline
and the gameplay verdicts are facts this driver proves, and a product, installer
or player acceptance is not one of them.

## Consequences

- P5 and P6 can run one case each, in parallel, with no shared state.
- A single-case pass can no longer be reported as both cases passing.
- Gameplay can no longer be satisfied by a green build or a command sequence.
- A stopped or failed case never starts the next case, and the restart phase is
  suppressed once a stop was requested.

## Verification

Offline only, 68 tests, no model request, window or OS input:
`case-failure`, `preflight`, `replay-contract`, `stop-control`, `parallel-run`,
`gameplay-criteria`, `run-stop`. Every required gameplay criterion has a negative
fixture, and the loop-exit predicate is evaluated from the real driver source.
