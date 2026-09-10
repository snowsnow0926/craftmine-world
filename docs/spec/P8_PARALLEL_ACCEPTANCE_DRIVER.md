# P8 parallel acceptance driver

Status: implemented. Owner: P4. Entry point:
`tests/player-feedback/P8/client-native.mjs`.

## Context

The P8 acceptance driver proves that a real model can author, build, check,
preview, adopt and replay a hammer and a dog. It originally ran both cases in one
process on one shared admission ledger, which made two things impossible:

1. two cases could not be accepted at the same time, because the ledger lock is
   exclusive and the dated unlimited phase pins one ledger for every checkout;
2. a single-case run could not be reported honestly, because the aggregate flags
   and the loop both assumed exactly two cases.

It also replayed fixed gameplay commands and recorded the raw results without
judging them, so "played" was a sequence, not a verified behaviour.

## Decision

The driver takes an explicit case selection and one journal per run, and it
grades gameplay per mechanic from the evidence it already collects.

### Case selection

`--case <id>`, `CRAFTMINE_P8_CASE` or `CRAFTMINE_P8_CASES` names one case or
both, and only one mechanism may be used. The driver consumes `--case` before the
shared parameter parser sees the arguments, so that parser stays unchanged and an
unknown argument still fails there. The case loop and the aggregate verdict follow
the selection; `report.pipelinePassedForSelectedCase` and
`summary.singleCasePassed` / `combinedTwoCasePassed` make a single-case result
impossible to read as a two-case pass.

### One journal per run

- default: `<run output>/journal/requests.ndjson`, created fresh for this run;
- named: `CRAFTMINE_P8_JOURNAL=<absolute file or directory>` strictly inside
  `<source-root>/test-results/`. A named journal may be appended to by a later
  run; an already held lock fails closed.

Any other location is refused, and the historical journals are refused by name, so
one agent cannot record requests into another agent's evidence range or into the
shared history. The history is opened read-only, counted separately, and
re-hashed after the run; a changed historical journal invalidates the run's
accounting. `admissionAccounting` reports `phaseOneAdmissions`, `priorAdmissions`,
`newAdmissions` and `cumulativeAdmissions`, plus the finer
`historicalTotal`/`priorInThisLedger` split.

### Verified, failed, insufficient or deferred

`gameplay-criteria.mjs` turns the raw command results, the observation envelopes
and the authored source into per-criterion verdicts. All four verdicts are
distinct:

| verdict | meaning |
| --- | --- |
| `verified` | direct, machine-checkable proof of the stated claim |
| `failed` | evidence that contradicts the claim |
| `insufficient` | the run never produced the evidence |
| `review-required` | evidence exists, but a machine cannot settle the claim |

A case is `verified` only when every criterion is `verified` by machine and none
is deferred. `review-required` is never a pass. `review-merge.mjs` lets a named
reviewer close only what the driver deferred, citing evidence present in the
report; it cannot overturn a machine failure, and the merged report still says
`passed: false`.

Two mechanics are deliberately deferred because the product exposes no channel for
a model-authored effect, and the observation schema may not be widened for a test:

- `lightning-visible-in-frames` — needs a reviewer to read the frames and the
  authored effect;
- `lightning-cooldown-at-least-one-second` — the ordinary attack gate's timing is
  evidence about the attack command, not about the lightning effect;
- `dog-visible-in-frames` and `dog-stop-not-continuing` — the overlap report
  proves presence, and no channel reports the dog's position over time.

### Claims that must be earned separately

- `pickup-source-hint` (source says the item is placed) and `pickup-actual` (an
  ordinary `interact` really put it in the inventory, with the aim, the interact
  return and the inventory/interactables around it recorded) are separate
  criteria. Directly equipping is never pickup evidence, and a run with no
  interact step is `insufficient` rather than silently satisfied.
- `attack-gate-refused-within-one-second` and
  `attack-gate-accepted-after-one-second` are measured from the recorded receipt
  times: the wall clock is an upper bound on the game time, and the declared
  physics frames are a lower bound. Both must agree before the gate is called
  reopened.
- The dog's follow is proven only by the product's own
  `physical.overlaps[<entity_id>]` after the player really outwalked the
  interaction radius; the far stop needs a real travelled distance, a lost
  contact and a refusal, all before the walk back; and the approach needs contact
  restored plus an answer. `talk` resolves its argument by `entity_id`, and the
  returned `npcId` is the data id, so it is recorded but never required to match.

### Rounds and stops

Every round is retained with its request evidence, usage, tool calls and a
progress sample, plus `requestTotals`; the report never shows only the last round.
A continuation is requested only after the previous turn proved `completed`, never
after a cancelled, failed or stopped turn. A run-scoped stop file
(`craftmine.p8-run-stop/1`) names the run and its case, so an operator can stop a
run without reading a turn id, and after a stop no further case starts.

### Evidence kept

The initial build's source snapshot is retained before any model work, beside the
candidate's source, so the map and the existing characters can be compared
directly. The report records full run identity (commit, runtime sources, package
and binary hashes, world/build/candidate identity, session) together with the
hashes of the frozen driver files themselves. Frames are written to disk with
their own hashes, real capture times and the attack they belong to.

## Consequences

- P5 and P6 can run one case each, in parallel, with no shared state.
- A single-case pass can no longer be reported as both cases passing.
- Gameplay can no longer be satisfied by a green build or a command sequence, and
  a claim the product cannot report stays deferred instead of becoming a pass.
- A stopped or failed case never starts the next case.

## Verification

Offline, 79 tests, no model request, window or OS input. Every machine-checkable
criterion has a negative fixture, the loop-exit predicate is evaluated from the
real driver source, and `gameplay-recording.test.mjs` runs the real TypeScript
plan against injected product shapes. That regression is mutation-tested: removing
the action-recording push fails four of its five tests.
