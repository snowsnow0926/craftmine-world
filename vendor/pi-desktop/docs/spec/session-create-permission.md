# Initial session permission persistence

Date: 2026-09-13

The `session.create` RPC accepts the existing `permissionMode` selector and
persists it in the same SQL insert as the new session. The returned session,
subsequent `session.get`, and database reopen must agree before the first
prompt can execute. Session creation must not acknowledge Auto and leave an
inherited Ask session on disk.

Accepted values are `inherit`, `ask`, `accept-edits`, and `auto`. Missing or
null permission keeps the backward-compatible `inherit` default. Unknown
strings and non-string values return `INVALID_PARAMS` without inserting a
session. The service layer independently validates the same allowlist.

The host does not infer a new global default or override player preferences.
World-entry code supplies its existing creation default; explicit Ask and
Accept-edits choices remain intact. Model/provider/thinking selectors keep
their current behavior. Legacy Rust creation helpers retain their signatures
and default to inherited permission through a compatibility wrapper.

Regression coverage executes the real RPC and database, rather than mocking
`api.createSession`: create each accepted mode, read it through `session.get`,
close and reopen the database, and confirm identical stored values. Invalid
inputs must leave the session table empty.

The revision-2e6f5b64 packaged forest run exposed this missing persistence:
the normal new-world UI requested automatic creation, but the host ignored
the field. Its selected Pro/medium request was cancelled by the acceptance
driver after detecting inherited Ask. That interrupted request is retained
as a product configuration failure, not a conclusion about model ability.
