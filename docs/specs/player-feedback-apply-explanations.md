# FB01-003: finite application explanations

Baseline: eae279915094f09d987ef0eb747eba20ef92cd0e.

The plugin preview shows a persistent explanation immediately below its action
header. It distinguishes the current operation, an uncertain application receipt,
absent/loading/unavailable review, historical review, running/failed/cancelled/
interrupted review, incomplete acceptance, advisory findings, and an applicable
preview. Each explanation includes a concrete next step. Error details use text
nodes, never HTML. The refresh button reads existing review status only; it does
not start a model review. The existing explicit review retry retains its behavior.

`apply-presentation.mjs` is presentation-only. Its primary and advisory disabled
flags preserve the previous admission expressions. A completed review with false
acceptance still requires the separate advisory acknowledgement; missing results
never become permission. A Godot preview is explicitly described as uncommitted,
and its actual application remains subject to the host's existing transactions.
No property mutation, file access, new RPC or model capability is introduced.

Two lifecycle corrections are included:

1. A rejected review read belongs to its captured preview reference. It cannot
   clear another preview's review or display its old failure after a switch.
2. A repeated application request first reconciles an existing operation. For
   Godot, a host `candidateState` result of `preview` releases the local uncertain
   guard only when both worldId and candidateId match the original attempt. This
   covers a rejection before application starts. Unknown or mismatched states
   retain reconciliation; applied/aborted/closed paths keep existing behavior.

`godot.candidateState` is not a passive polling API: some phases recover or close
the candidate. It is therefore not newly polled for presentation. Only the existing
application reconciliation path calls it. Save failures are retained in the
preview's error details; the latest progress is still saved by the original path.

Validation: finite state/admission matrix plus actual plugin HTML/modules loaded
in isolated headless Chromium. The latter uses a bounded bridge and game protocol
fixture, verifies DOM actions without input simulation, lost replies, exact receipt
identities, stale read rejection, advisory acknowledgement, full fixture progress
(including savedAt), and reload persistence. It permits inline fixture scripts in
its served test HTML only; production CSP is unchanged. This is not actual Godot,
Core, model, OS restart, packaged-client or player acceptance. Those integrations,
including native sibling-view visibility, belong to P1/P8/P10's common client.

The existing plugin build bundles the new module through view.mjs; no shared
registry or additional public permission is required. P2 owns the preview HTML
and module; other agents must supply changes here through P2/P10.
