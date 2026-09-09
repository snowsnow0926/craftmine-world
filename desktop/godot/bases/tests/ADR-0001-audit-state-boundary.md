# ADR: reject progress before assignment and keep replacement recovery

Status: accepted for the authored base implementations.

Parallel bases implemented incompatible persistence details. The audit found direct
primary-file truncation, foreign state accepted through a bridge, and failed loads
followed by automatic default saves. These violate the existing world isolation and
candidate rollback requirements even when positive gameplay tests pass.

Each base keeps its versioned schema, while all reject identity/type errors before
assignment and retain an intact prior save on replacement failure. A boot failure
must inhibit saving or stop before gameplay creates a save. No conversion is guessed.
The host remains responsible for immutable build identity, candidate-only save roots,
latest-progress transfer, explicit apply, cancellation and rollback transactions.

Materialized side-view worlds receive a distinct instance identifier; the template
selector no longer doubles as the instance identifier. This only changes newly
materialized projects; existing direct example saves remain readable.

Remaining work includes top-down saved-scene routing, first-person entity migration,
OS-enforced isolation, host bridge adapters, Windows install acceptance and licensed
asset inventory coverage for these new bases. This decision grants no new license.
