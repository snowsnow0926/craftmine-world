# Runtime pause ownership during an immersion overlay

The Electron-independent `createImmersionPauseController` combines per-instance
manual pause (initially true) with a global overlay hold. Effective pause intent
is `manualPaused || overlay`. Closing the overlay resumes only instances that
were explicitly marked manually running.

`attach(token, {pause, resume})` enforces the initial pause and returns its
acknowledgement promise. Tokens are nonempty strings or object identities and may
never be reused, even after detach. Use one fresh token for each runtime instance.
`setManual(token, boolean)` and `setOverlay(boolean)` return promises which settle
after each affected instance has reconciled the latest intent. `detach(token)`
is idempotent and disables all further dispatch to that instance. `paused(token)`
returns intended pause, not a claim about observed physical runtime state.

Only one pause/resume callback is in flight for each token. Rapid changes during
an acknowledgement are coalesced and reconciled before waiting callers resolve.
A callback failure rejects all waiting callers, marks acknowledged state unknown
and latches manual pause. Overlay changes cannot automatically resume that
instance after failure; an explicit manual resume is required. A pending callback
cannot be cancelled by this helper, but its late acknowledgement after detach
rejects and can never dispatch to a different instance. The host must provide
callbacks bound to the exact runtime represented by the token.

No Electron, game, IPC or runtime bridge dependency exists in this helper. Host
integration remains responsible for its lifecycle, checkpoint operations and
error reporting. Tests drive deferred promises and isolated callbacks only.

Central E2E scenario for host integration: **IW-PAUSE-01**. Open/close the overlay
while a runtime is manually paused and while it is manually running; preserve
manual pause and resume only the latter. Repeat rapid toggles with delayed
acknowledgements, switch runtime identity while a callback waits, and inject a
pause/resume failure. No stale runtime callback may affect the current instance;
failures remain visible and must not trigger an automatic resume.
