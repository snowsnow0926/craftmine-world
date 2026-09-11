# Bind catalog source acceptance to existing durable operations

Status: accepted for the GU6 development branch, 2026-09-12.

The catalog stores opaque ZIP bytes, while source installation already validates
CP0/CP1 packages and writes versioned source. The older `package.install` handles
library bundles and must not be used for catalog source ZIPs. Add a narrow Main
acceptance method and reuse the existing source installer; do not create another
installation registry or a model-facing write method.

Main supplies a private owner and exact catalog/file provenance. The installer
reserves this provenance in its existing intent record before planning. This
extends only new catalog requests and preserves legacy request hashes. It makes
retries across service restarts distinguish the same accepted action from a
different catalog identity or owner even if their archive bytes are identical.

Source dispatch is the acceptance boundary. Work already accepted may complete
in the original world after a viewing-session change; only the original owner
can confirm its receipt. Preflight errors describe the current attempt, not the
nonexistence of a prior uncertain durable operation. Expired authorization must
be freshly verified during an explicit retry before consulting that operation.
No automatic world application, model write permission or new cancellation
authority is introduced.
