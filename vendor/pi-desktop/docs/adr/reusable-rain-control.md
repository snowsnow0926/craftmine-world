# Reuse rain as a scoped persistent source component

Date: 2026-09-13
Status: Accepted for the authorized reusable-content work

The accepted rain demonstration mixes weather skills with a courtyard, player
world root, environment replacement and a startup audit. Importing that world
into an existing creation would overwrite unrelated content and can duplicate
weather ownership. Reusing only a static rain mesh would not provide the skill.

Ship an independent module using the existing source-package and component-ledger
contracts. Preserve the accepted simulation/distribution and water shader, own
only a local rain volume and HUD, and keep the target's player and environment.
One weather owner per world is an explicit contract, enforced during ordinary
component validation. Existing legacy rain ownership is recognized too.

Use unhandled configurable unmodified letter keys with no InputMap writes. This
avoids the original R/reload collision and allows the authoring agent to reconcile
direct-script key bindings from target source. Respect ordinary world pause.

No host privileges, model tools, storage authority or source-adoption bypass is
added. Package metadata describes capabilities, controls, precise compatibility,
lineage and limits. Native physics and persistent-state checks remain separate
from final client rendering evidence; production performs no startup self-test.
