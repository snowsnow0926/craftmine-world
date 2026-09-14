# Ordinary player execution limits

Use independent test data and no physical input, focus or Pointer Lock.

1. Begin an ordinary world task without P8 environment flags. Verify all four
   cumulative policy fields are null. Admit 81 requests and 9 compactions; retain
   their counts and exact replay semantics across journal reopen.
2. Load an old capped task. Verify startup and ordinary resume do not rewrite
   limits or erase the recorded failure. Interrupt at a real persisted execution
   boundary, then use the explicitly labelled player recovery action.
3. Verify previous/new policies and reasons in the original task receipt, same
   owner/draft and usage, null execution limits, and unchanged explicit token
   budget. Resume normally and permit the ninth compaction. If the token budget
   is exhausted, the next provider request remains refused.
4. Lose the action response and resume/restart. Read the exact historical receipt
   without a second mutation. Reject foreign worlds/sessions, stale generation,
   extra raw-limit fields and attempts from the model budget dispatcher.
5. Independently exercise the selected real provider through the ordinary UI.
   Core fixture tests establish durable policy behavior, not model quality or
   native gameplay acceptance; report those separately.

## Focused verification

- Rust durable suite: 23 passed, including the explicit recovery and historical
  receipt tests. Recovery suite and standalone Core build passed.
- Shared and agent-runtime TypeScript builds passed.
- Plugin host-policy plus dated authorization suites: 10 passed.
- Actual runtime, gateway, private plugin, and standalone Core integration:
  2 passed (ordinary and dated acceptance), each admitting request 81 and
  compaction 9 with null cumulative limits. These calls use an isolated ledger
  and do not send provider traffic.

Commands: `cargo test -p craftmine-core durable::tests --lib`,
`cargo test -p craftmine-core recovery::tests --lib`,
`cargo build -p craftmine-core`;
`node --test tests/dispatch/batch07/budget-host.test.mjs tests/player-feedback/P8/authorized-limits.test.mjs`;
`node --experimental-transform-types --test tests/player-feedback/P8/host-budget-route.test.mjs`
with `CRAFTMINE_CORE_BIN` pointing at the freshly built Core. Build the plugin,
shared, plugin-sdk, and agent-runtime packages first. Native TypeScript parameter
properties require the transform-types flag on the local Node 24 runtime.
## Resumed creation target regression

`tests/player-resume-creation-target.test.mjs` executes the actual Main resume
callback with the real creation-target service and isolated filesystem records.
It verifies capture binding before provider dispatch, a fresh snapshot after
cancelled ancestry, manual-mode preservation, wrong-world/generation/lease
rejection, cancellation during sampling, and unchanged legacy resume behavior.
The provider callback and runtime observations are controlled CPU fixtures; they
do not claim actual native automatic adoption. The 5 new scenarios and 25
existing creation-target scenarios pass together.
