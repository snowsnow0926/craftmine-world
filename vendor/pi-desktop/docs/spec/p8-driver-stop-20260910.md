# P8 acceptance driver: owned stop and continued authorization

This is a test-driver contract, not a new product command or network service.
The driver retains its clean-source, exact runner, package manifest, owned
profile, offscreen, Pointer Lock and strict shutdown guards.

After the real product accepts one fixed case, its fresh output directory
contains `control.json`. Copy its `request` object to the adjacent fixed
`stop-request.json` file using UTF-8. For example:

```json
{"format":"craftmine.p8-stop/1","action":"abort","caseId":"hammer","turnId":"<exact current turn UUID>"}
```

Use the actual UUID from `control.json`, not this placeholder. Write to a new
temporary file in that same owned directory and rename it to the request name
to avoid a partially written JSON document. No file contents select an IPC
method, session, filesystem destination, script, or provider. The driver
accepts only this four-field shape, at most 1 KiB, in an ordinary single-link
file with ordinary parents. Unknown fields, stale identity and invalid files
produce bounded diagnostics and do not invoke abort. No stop file is removed.

The model-task polling loop checks for this request before each snapshot.
It first verifies the bound session/turn through the actual helper snapshot,
then invokes the existing product `agentAbort` through its own child IPC.
Only the exact pre-dispatch `P8_BUSY` error can retry within 30 seconds.
Unknown/lost abort replies are retained and never cause another abort request.
The product's unwrapped acknowledgment is `{ok:true}`. An acknowledgment alone
is insufficient: the same turn must become inactive with a terminal metrics
status and zero pending metric calls within 90 seconds. No new case, candidate
application, or restart exercise runs after an accepted stop. The run reports
`stopped`, not creation success. Usage and strict exit audits remain required.
Abort failure or timeout remains a failed report; fallback child termination
cannot become a successful clean exit. Repeated valid stop reads share the
same operation promise. This bounded control is available during the model
turn and the final pre-application check, not as a general UI control plane.

## Authorization phases

The legacy driver mode and its regression tests retain the original default
16-request cap. Explicit `CRAFTMINE_P8_AUTHORIZATION_PHASE=unlimited-20260910`
selects the user's subsequently approved unlimited-request phase, with no
cumulative token cap. The relay/journal take `requestLimit:null`; endpoint,
exact requested model, payload, output reservation, credentials-in-memory,
pre-forward admission persistence, ordering and exclusive journal lock remain
unchanged. There is no model fallback. The journal is the fixed sibling of
source checkouts, `D:/p8-unlimited-20260910.ndjson` when source roots are on D.
Changing from one D source checkout to another does not reset that ledger.
Unknown phase names fail closed. Never run two active relays.

The old 16 admissions and the following 34 admissions are immutable historical
evidence, not erased quota. The report records `previousPhaseAdmissions:50`
and cumulative admissions as 50 plus the new shared journal count. Old
V35GyJ/phase-two files are not opened for writing. Runtime credentials still
come only from the explicitly authorized desktop text file; tests below use
synthetic configuration and a local forward stub instead.

## Verification and limits

Run `node tests/player-feedback/P8/stop-control.test.mjs` from the source root.
It directly exercises the real controller and journal/relay with synthetic
callbacks: delayed terminal state, lost reply, busy retry, hangs, repeated and
stale requests, oversized/hard-linked files and continued admissions beyond
16 across a journal reopen. It performs no external model request and no
Electron launch. The upcoming same-source packaged run must still prove a
normal live abort. These tests do not reclassify the prior forced-exit failure
or establish success for either requested creative case.
