# Honor the initial permission selector atomically

Date: 2026-09-13

The renderer's existing session creation payload includes `permissionMode`,
but the host RPC previously passed only the thinking selector to the Rust
creation service. The database therefore silently defaulted to `inherit`.
This broke new-world automatic creation even though the UI's finite API
tests observed an Auto argument. Retained-world sending happened to perform
a later configuration update and concealed the backend omission there.

The host now validates the optional permission at the RPC boundary and
inserts it atomically with the session. Existing Rust helpers delegate to a
new configuration-aware helper with no permission override. This preserves
their compatibility and leaves global permission policy unchanged.

A renderer-side second configuration request was rejected as the primary
fix: it leaves an interval in which the session is selectable with the wrong
permission and introduces another acknowledgement/cancellation boundary.
Real RPC, readback, invalid-input, and database-reopen tests cover the actual
persistence path. Packaged ordinary new-world acceptance must subsequently
verify that Auto is effective without a harness permission override.
