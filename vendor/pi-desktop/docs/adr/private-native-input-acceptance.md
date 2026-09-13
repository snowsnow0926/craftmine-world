# Reuse one fixed virtual-input controller for native acceptance

Status: Accepted, 2026-09-14.

The ordinary PI Desktop needs to verify gameplay controls created by its own
Agent. The existing bounded exploration helper only knows fixed walking and
interaction operations, so it cannot test an aircraft's throttle, pitch or a
weather key. The standalone Codex live service already has an identity-bound
finite virtual-input implementation with explicit releases.

Move that implementation into a shared desktop main module and preserve its old
script import as a re-export. Add a private parent-IPC adapter inside the existing
validated offscreen controller. Main supplies the actual formal runtime methods,
owner state and activity checks. No caller JavaScript, renderer/model route or
new gameplay mutation API is introduced.

Reuse the fixed DOM delivery program and retain normal Godot input handling.
Collect actual sequential evidence and keep semantic acceptance separate.
Cancellation and shutdown release inputs; unconfirmed release remains an error
that blocks another segment. The operator records partial failed evidence too.

This allows ordinary application gameplay acceptance without stealing focus or
touching the user's devices. It does not establish subjective control feel, and
it cannot claim a control was consumed merely because a DOM event was delivered.
