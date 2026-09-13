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

Start reserves the exact operation synchronously, before disk reads or asynchronous
native preflight. Same-id status and retry requests join that reservation. An early
cancel fences it before persistence and prevents installation. Main dispatches
start/apply after synchronous sender/shutdown checks and supplies asynchronous
maintenance/selection/busy preflight through the reserved service's `prepare`
callback. Unknown persisted ids return `DIRECT_LIBRARY_OPERATION_NOT_FOUND`.
Every public action projects thrown failures to a bounded code without local paths,
transport messages, causes or native stacks.
An initialization reservation also excludes adoption of a different ready
operation until initialization settles; same-id callers still join their owner.

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

The main-frame navigation gateway validates the shared request before dispatch.
Only inspect/start/apply require the selected world; retained status and cancel
remain available after a world switch. Start/apply stop stock maintenance and
recheck global busy state. The captured native instance must match Core's formal
build before installation and immediately before adoption. A duplicate apply
may join the service's own in-flight operation; arbitrary candidate authority
is never admitted. Ordinary edit/turn-start and maintenance yield during direct
service work. Quit preparation refuses an in-flight installation/adoption, and
final shutdown drains the service before disposing plugin and Core owners.

## Measured waiting and duplicate reads (preview.22)

Direct-use progress may expose a bounded native stage and its actual integer
percent: claimed, import, export, reuse-export, stage-artifacts or check. Unknown
worker stages are omitted; the UI retains its generic checking state. These are
executor progress reports, not predicted completion times.

Optional persisted timings record preparation from native request admission to
Core's terminal check timestamp, excluding later polling and player decision
wait. Adoption duration uses an in-process monotonic clock around the explicit
apply path. Recovered historical operations without an observed duration do not
invent one. Old receipts without timing fields remain readable.

Simultaneous identical inspections and per-operation status reads share only
the currently running read. Results are not cached across subsequent requests;
new source/asset identity checks and all native builds/adoption guards remain.
Cancellation is rechecked after installation-turn finalization. Native shutdown
drains these shared reads before their plugin owner disappears.
