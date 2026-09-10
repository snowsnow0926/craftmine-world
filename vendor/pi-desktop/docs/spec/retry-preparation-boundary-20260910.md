# Retry preparation is not the lifetime of initialization

The factory previously displayed preparation whenever its retry promise was
pending. A new failed Core job could therefore disappear behind preparation
while `workspace.endTurn` was still awaited, including when no status poll had
observed the short-lived building state. The factory also expected `start()` to
reject, whereas the production initializer records errors and resolves.

The initializer now exposes an in-memory `preparation(worldId)` observation:
`{attempt, pending, error, status}`. The attempt increases on each newly started
initialization. `status` is the Core snapshot read during preparation, updated
after a successful launch-failure retry. It is neither a durable intent nor a
new RPC or permission. A newly constructed initializer has no such observation.

Preparation ends **before** calling `godotBuild.start`, because submission can
commit even if its response is lost. It also ends before first-loading an
existing checked candidate. Build polling, application and end-turn finalization
cannot turn a newer Core failure back into preparation. Concurrent factory
retries still share a promise, installed before callbacks execute, and wait for
any existing initialization before scheduling their single recovery.

After a resolved start, the factory reads the actual preparation error. Its
presentation is bound to that initializer attempt and Core status identity
fields. A changed Core status or a later initializer attempt invalidates the
remembered error. Trusted durable path/initial-load codes and stages remain
unchanged; their message additionally explains a failure of this explicit retry.
Host first-load errors without a durable Core failure remain visible. No Core
records, source files, recovery permissions, or engine exit rules are changed.

Validation: run the following from the checkout, with TEMP and TMP inside its
owned D-drive test-results directory:

```
node --test tests/player-feedback/P1/retry-presentation.test.mjs tests/player-feedback/P1/initializer-launch-retry.test.mjs vendor/pi-desktop/apps/desktop/test/godot-initialization-terminal.test.mjs
```

23 checks passed. Four added cases use the actual factory and initializer,
small owned managed-source files and controlled Core-shaped responses: a fast
terminal job during blocked endTurn, a resolved preparation rejection against
the old durable reason, stale-error invalidation by another initializer attempt,
and first-load rejection of an existing candidate. Existing concurrency,
restart, explicit recovery and durable path-code regressions remain intact.
These are host logic tests, not real Core persistence, Godot, packaged-client,
or native access-violation recovery evidence. No engine, debugger, model, or
real input was started for this change.
