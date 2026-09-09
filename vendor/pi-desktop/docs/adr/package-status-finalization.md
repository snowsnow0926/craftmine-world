# Bind package readiness to completed task finalization

The packaged continuous-import acceptance observed WORLD_BUSY when a second
import began after the first core check passed. The independent task poller
had not yet released the first installation lease.

The private package status route now awaits the owning lifecycle's terminal
finalization. Concurrent background and foreground finalization share one
promise. Failed finalization retains ownership for retry. The generic build
read stays a read, and renderer-supplied status cannot close any task.

Explicit world initialization retry also forwards the recovery setting through
the factory adapter and uses a bounded project/world recovery lookup before
generation-bound task resume. No new session bypasses an interrupted task.

Both private operations must be allowed by the production orchestrator adapter
as well as the plugin router. The adapter test executes that production method
and verifies forwarding and unknown-operation rejection. Actual profile retry
waits for the existing navigation controls to finish loading before submission.
