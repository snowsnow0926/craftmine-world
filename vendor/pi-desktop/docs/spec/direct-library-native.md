# Direct use of a selected library asset

Date: 2026-09-13. The existing PI asset detail gains a bounded `library.direct`
product route. Its native service is separate from model tools and Composer.
The route never connects a model or creates an AI turn. Installation uses the
existing host-owned package installation turn and native candidate transaction.

The shared contract accepts only five actions: `inspect`, `start`, `status`,
`cancel`, and `apply`. Inspect/start name an exact catalog asset id, integer
version and content hash. Start also names a stable operation id and optional
finite x/y/z placement, each within the existing installer bounds of ±80.
Status/cancel/apply accept the world and operation ids only. No source, path,
archive, candidate token, context or renderer-supplied compatibility is accepted.

Inspection reads the immutable catalog body and Core source context without
creating a draft. Eligibility means exactly one installable scene root, matching
the source archive root; it does not certify target compatibility. Whole-world
templates retain their new-world flow. Raw resources and multi-root archives
cannot masquerade as directly installable objects.
Explicit placement is offered only when the declared script node or package-local
static scene root resolves to a 3D node; this does not execute package scripts.

Start freezes the target native build/instance and source revision/hash, saves
the operation, then invokes the existing package planner/materializer/check.
Checks and failures preserve formal content. The page sees preparing/checking,
then ready or an actionable failure with an honest retained-draft indicator.
Only an explicit apply request can invoke the native candidate coordinator. Its
ordinary current-progress checkpoint, actual first load and atomic adoption
remain mandatory. Cancellation, selection/native-instance changes, fixed asset
integrity and candidate/current-source authority are checked before commit.

Operation records live in the native product data directory, outside Rust-owned
world/catalog databases. Stable retries return the same record and never create
another instance. The private plugin can reconcile its existing installer intent
and Core check/candidate/adoption evidence after a lost reply. Startup marks
unfinished native work interrupted; it never silently reinstalls or applies.
An explicitly resumed ready operation can bind a restarted native instance only
when its original formal build still matches. A completed adoption is recovered
from Core evidence, including a commit whose acknowledgement was lost.
Orderly shutdown fences active work but retains a completed ready check for
explicit same-build adoption after restart.

Cancellation persists its fence before cancellation RPCs and cancels only its
own check. A late installation reply updates retained-draft facts but cannot
adopt. Atomic adoption that already committed is reported as applied based on
the durable Core record, never falsely described as rolled back.

Main wiring must preserve sender/active-world/global-operation/shutdown guards;
private `directInspect`, `directInstall`, and `directStatus` package methods are
not added to generic renderer package allowlists. Status/cancel can inspect a
retained operation after leaving its world. Main shutdown drains this service
before stopping the plugin/domain. Unit fixtures are protocol evidence only;
the integrated offscreen native player run remains a separate acceptance gate.
