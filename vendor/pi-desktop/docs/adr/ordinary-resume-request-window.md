# Renew a finite request window for explicit interrupted-work continuation

An interrupted task keeps its budget owner and accounting across application
restart. Its original finite wall-clock deadline also keeps advancing while
the app is closed. A player returning after that deadline can successfully
resume the draft but cannot send another request, even with requests and tokens
remaining. This is a continuation failure, not evidence that the model cannot
perform the work.

The existing trusted `turn.begin({resumeInterrupted:true})` fallback now asks
Core `task.resume` for `renewRequestWindow:true`. This is a boolean intent,
never a caller-selected timestamp or limit. The general private `task.resume`
router and model recovery helper do not accept or forward it. No public tool
or player setting gains a budget-writing capability.

Only a newly created recovery generation can renew the window. Core checks
the exact session/project/head, generation, owner, base and lease as before.
Inside the same SQLite transaction that creates the successor, it advances a
finite deadline to at least the current time plus the existing 30-minute
production request window. An existing later deadline is not shortened. A null
deadline stays null. Replaying a successful resume returns the existing state
without extending it, including a replay that adds the intent after a generic
resume. Failure before commit leaves both lifecycle and budget untouched.

All request/token/compaction limits, request counts, usage, unknown reservations,
budget owner and previous settlements remain unchanged. A durable
`@host:resume-request-window` receipt on the successor records previous and new
limits. Drafts, original requirements and source history remain preserved.
Exhausted request or token budgets still reject requests after renewal.

This deliberately uses a new explicit-request window instead of retroactively
estimating active execution time. Existing records do not establish every
pause interval reliably enough for active-time accounting. Automatic retries,
polling, restoration, or merely reopening the app do not renew a deadline.

Validation uses actual Core recovery tests with an explicitly authored expired
clock fixture, and the private-router-to-Core regression. The latter proves
an expired interrupted task resumes through normal `turn.begin` and admits its
next reservation while retaining the earlier accounting. Native ordinary-player
validation of the retained expired fixture remains a separate release gate.
