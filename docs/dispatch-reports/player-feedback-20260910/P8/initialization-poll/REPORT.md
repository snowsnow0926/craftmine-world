# P8 driver: one transient read timeout must not end the case

Worktree `D:/cm-pi-p4-driver-20260910`, branch `codex/pi-p4-driver-20260910`,
baseline `2453f9cf24403b874a256e8ed86f43c30c0f1ecb`. Narrow scope: the
initialization read poll in `client-native.mjs` and its own test. Nothing else
in the tree was changed by this round.

## The defect, from the recorded run

Evidence `D:/cm-pi-p0-dog-run-20260910/test-results/desktop-native-p8-BkChEs`:
`create fresh dog world` passed, then the `world.list` initialization poll threw
`Craftmine Rust request timed out` and the whole case was filed as
`outcome: failed` with zero model requests. The re-run `C9K8vT` passed the same
step and produced and adopted a model candidate.

The message comes from `plugins/craftmine-world/core-client.cjs:46`
(`reject(Error('Craftmine Rust request timed out'))`), whose default read
timeout is 5000 ms. A world that is still doing its first build/check can
therefore make a healthy list read expire. The old poll called `until(...)`
once, so a single expired read was indistinguishable from "the world failed to
build".

## The change

`tests/player-feedback/P8/initialization-poll.mjs` (new) owns the distinction:

- `INITIALIZATION_DEADLINE_MS = 900000` — the existing budget, unchanged.
- `TRANSIENT_READ_TIMEOUT = /^(?:Error: )?Craftmine Rust request timed out$/`
  and `isTransientReadTimeout(error)` — a real `Error` whose message is exactly
  that, with or without the host's `Error: ` prefix. A thrown string, a wrapped
  timeout, or another subsystem's timeout (`P8_RPC_TIMEOUT:worldNavigation`)
  is not this error.
- `terminalState(row)` — `failed` / `cancelled` / `interrupted`, thrown at once,
  never retried.
- `pollWorldInitialization({read, worldId, deadline, retryDelayMs, sleep, now, onRetry})`
  returns `{row, reads, retries}`; throws `P8_INITIALIZATION_TERMINAL:<state>:<json>`,
  `P8_INITIALIZATION_TIMEOUT:<json>`, or rethrows anything else. `deadline` is an
  absolute timestamp, re-checked on loop entry and before sleeping, so a retry
  can never extend the budget.
- The helper only ever knows a `read` callback. It contains no `world.create`,
  `world.open`, `panel(` or `rpc(` — "never retry a mutating operation" is
  structural, not a comment.

`tests/player-feedback/P8/client-native.mjs`: one import line, and the
`actual initialization build/check` step now polls the read-only list inside the
same 900000 ms deadline, recording `item.initialization = {reads, retries, state}`
and every retry in `report.initializationRetries`. No call timeout was touched:
`rpc` stays at `30000`, `quit` at `10000`, `worldNavigation`/`worldPanel` at
`180000`, and the helper adds no timeout of its own.

Diff against the P0 tree is exactly those two hunks (`git diff --no-index`
P0 → P4: `@@ -24,3 +24,3 @@` the import, `@@ -178,3 +178,10 @@` the poll).

## Validation performed in this worktree

- `node --check` on `initialization-poll.mjs`, `initialization-poll.test.mjs`,
  `client-native.mjs`: pass.
- `node --test tests/player-feedback/P8/initialization-poll.test.mjs`: **9/9 pass**.
  Coverage with an injected clock: timeout → ready (2 retries, 5 reads, both
  retries reported); the host-prefixed form accepted; six near-miss errors and a
  thrown string rejected on the first read; each terminal state rejected without
  a second read; a transient timeout followed by `failed` still reports the
  terminal state; the 10 s deadline bounds the retry count and the clock; a retry
  that cannot fit is refused with no sleep; an incomplete list is polled; and the
  driver contract (list read only, deadline as written, no enlarged timeout,
  helper knows no product command).
- Mutation checks on a scratch copy of the helper, each caught:
  never retry the timeout → 4 failures; retry every error → 1; deadline no
  longer bounds the retry → 1; retry a terminal state → 2.
- Full P8 suite, 10 files: 89 tests, 79 pass, 10 fail. All 10 failures are in
  files whose copies in this tree are stale and already fixed in the P0 tree;
  none is attributable to this change:
  - 9 failures (`gameplay-recording.test.mjs` 7, `preflight.test.mjs` 2) are
    `ReferenceError: byOp is not defined`. The only difference between the P0 and
    P4 copies of
    `vendor/pi-desktop/apps/desktop/electron/main/craftmine-acceptance-p8-gameplay.ts`
    is P0 line 189, `const byOp = (op: string) => actions.filter(action => action.op === op).length;`,
    which is absent here.
  - 1 failure is `tests/player-feedback/P8/review-merge.test.mjs` failing to
    parse (a duplicated tail block at lines 84-88). The P0 copy passes
    `node --check`.
  With preflight and review-merge excluded (8 files): 73 tests, 66 pass, 7 fail —
  all seven are `gameplay-recording.test.mjs`'s `byOp` failures, so no failure
  remains that is not caused by the stale gameplay TypeScript.

## Handoff

P0 owns import, test and commit. Take from here only:
`tests/player-feedback/P8/initialization-poll.mjs`,
`tests/player-feedback/P8/initialization-poll.test.mjs`, and the two
`client-native.mjs` hunks. Do not take this tree's copies of the gameplay
TypeScript or `review-merge.test.mjs`; P0's versions are the correct ones.

Recommended commands:

```powershell
node --check tests/player-feedback/P8/initialization-poll.mjs
node --check tests/player-feedback/P8/initialization-poll.test.mjs
node --test  tests/player-feedback/P8/initialization-poll.test.mjs
node --test  tests/player-feedback/P8/case-failure.test.mjs tests/player-feedback/P8/preflight.test.mjs tests/player-feedback/P8/replay-contract.test.mjs tests/player-feedback/P8/stop-control.test.mjs tests/player-feedback/P8/parallel-run.test.mjs tests/player-feedback/P8/gameplay-criteria.test.mjs tests/player-feedback/P8/gameplay-recording.test.mjs tests/player-feedback/P8/review-merge.test.mjs tests/player-feedback/P8/run-stop.test.mjs tests/player-feedback/P8/initialization-poll.test.mjs
```
