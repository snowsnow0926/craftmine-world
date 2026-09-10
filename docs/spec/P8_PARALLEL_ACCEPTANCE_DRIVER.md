# P8 parallel acceptance driver

Status: implemented. Owner: P4. Entry point:
`tests/player-feedback/P8/client-native.mjs`.

## Context

The P8 acceptance driver proves that a real model can author, build, check,
preview, adopt and replay a hammer and a dog. It originally ran both cases in one
process on one shared admission ledger, and it replayed fixed gameplay commands
without judging them, so "played" was a sequence rather than a verified behaviour.

P5's and P6's independent read-only reviews of the frozen driver found four
defects that could change a real conclusion, and this document describes the
driver after those fixes.

## Decision

The driver takes an explicit case selection and one journal per run, and it grades
gameplay per mechanic from the evidence it already collects. It never claims more
than its evidence supports, and it never reports a driver limitation as a product
failure.

### Case selection and one journal per run

`--case <id>`, `CRAFTMINE_P8_CASE` or `CRAFTMINE_P8_CASES` names one case or both,
and only one mechanism may be used. The driver consumes `--case` before the shared
parameter parser sees the arguments, so that parser stays unchanged.

The journal is `<run output>/journal/requests.ndjson` by default, or
`CRAFTMINE_P8_JOURNAL=<absolute file or directory>` strictly inside
`<source-root>/test-results/`. A named journal may be appended to by a later run;
an already held lock fails closed. The historical journals are refused by name and
opened read-only, counted separately and re-hashed after the run.

### Verified, failed, insufficient or deferred

| verdict | meaning |
| --- | --- |
| `verified` | direct, machine-checkable proof of the stated claim |
| `failed` | evidence that contradicts the claim |
| `insufficient` | the run never produced the evidence, or the driver could not measure it |
| `review-required` | evidence exists, but a machine cannot settle the claim |

A case is `verified` only when every criterion is `verified` by machine and none
is deferred. `review-merge.mjs` lets a named reviewer close only what the driver
deferred, citing evidence held by that criterion; it cannot overturn a machine
failure, it never raises `pipelinePassed`, it preserves exit and page-error fields
verbatim, and the merged report still says `passed: false`. The CLI writes a
separate file and refuses to overwrite the original report.

### Claims that must be earned separately

- **Pickup.** `pickup-source-hint` (the source places the item) and
  `pickup-actual` (an ordinary `interact` really put it in the inventory) are
  separate. Directly equipping is never pickup evidence. `pickup-actual` is
  `failed` only on a real contradiction — the interact reported the hammer and the
  bag did not gain it, or the ray was on the hammer's own pickup and the product
  refused it — and `insufficient` when the scan never pointed at an interactable,
  because that is an untested claim rather than a product defect.
- **The attack gate is a diagnostic.** The requirement is the lightning effect's
  own cooldown; the product exposes no channel for it. `attack-gate-diagnostic`
  therefore reports the ordinary attack gate and can never be `failed`. The gap is
  the real gap between two adjacent attack commands with no capture between them,
  and nothing is subtracted from it: if a capture really sat between them, real
  time really passed and the criterion is `insufficient`.
- **The dog's follow.** `bounded-follow-observed` needs the player to have really
  outwalked the interaction radius with contact still reported;
  `far-out-of-contact-observed` needs a real travelled distance, a lost contact
  and a refusal; `approach-recontact-observed` is `verified` only when the walk
  back re-establishes contact and the dog answers, `failed` when the retrace
  covered the whole outbound path without ever touching it, and `insufficient`
  when the retrace ran out of budget.

Deferred on purpose, because no product channel reports them and the observation
schema may not be widened for a test: the lightning effect's visibility and its own
cooldown, and the dog's visible stop.

### Plans that survive real geometry

- The pickup scan is a bounded ladder: eight pitches whose rays meet the ground
  from about 0.7 m to 3.6 m (a negative pitch looks down, since the aim ray is the
  camera's -Z), three headings, at two distances, stopping on a real pickup. It
  cannot aim at every point in the world, which is exactly why a miss is
  `insufficient`.
- The dog's return leg is sized from the distance the outbound leg *really*
  covered. A wall-truncated leg understates the speed, so the nominal pixels per
  step come from the fastest observed leg, and the leg is walked in chunks until
  contact or until it is back on the outbound row. A fixed step count would have
  walked through the row and into the opposite wall.
- The westward sweep advances in chunks smaller than the contact area, so it
  cannot step over the dog.

### Rounds and stops

Every round is retained with its request evidence, usage, tool calls and a
progress sample, plus `requestTotals`. A continuation is requested only after the
previous turn proved `completed`. A run-scoped stop file names the run and its
case, so an operator can stop a run without reading a turn id, and after a stop no
further case starts.

### Evidence kept

The initial build's source snapshot is retained before any model work, beside the
candidate's source. The report records full run identity together with the hashes
of the frozen driver files. Frames are written to disk with their own hashes, the
real command and capture times, the attack they belong to and the real offsets.

## Consequences

- P5 and P6 can run one case each, in parallel, with no shared state.
- A single-case pass can no longer be reported as both cases passing.
- The summary reads the verdict the driver really writes
  (`item.gameplay.verdict`), so a real failure can never become an empty list.
- A claim the product cannot report — or that the driver could not test — stays
  deferred or unproven instead of becoming a pass.

## Verification

Offline only, no model request, window or OS input. Every machine-checkable
criterion has a negative fixture; the loop-exit predicate is evaluated from the
real driver source; the summary is regression-tested against the real
`evaluateGameplay` output and through a review merge; and
`gameplay-recording.test.mjs` runs the real TypeScript plan against stubs that
reproduce the base's aiming geometry, the town's small walled map with a small
contact area, and a cooldown gate. That regression is mutation-tested: removing
the action-recording push fails most of its tests.
