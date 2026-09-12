# Formal client cold-open scheduling

The first sealed `2a584796` catalog run completed both actual package checks and
adoptions, then its one-shot cold `world.open` returned `WORLD_BUSY` immediately
after switching into create mode. The report is retained at
`test-results/desktop-native-complete-KBwIZW/report.json`; it is a failed full
trial, with both processes exiting zero and clean audits.

The test driver now waits for the ordinary world selector's enabled state before
requesting the same saved world. It retries only the exact `WORLD_BUSY` refusal,
recording each such wait. The coordinator/host guards refuse a concurrent open;
this does not justify replaying source writes, installs, sessions, candidate
commits or uncertain operations. Timeouts, lost replies and other failures still
stop the trial. The startup wait remains cancellable and finite, unrelated to
ordinary player model token/call/whole-turn limits.

Three tests cover selector readiness, explicit busy scheduling, rejection of
uncertain retry, cancellation and deadline exhaustion. Actual cold-open success
still requires a new completed sealed-client report; the scheduling tests alone
do not establish it. No product guard was removed or weakened.
