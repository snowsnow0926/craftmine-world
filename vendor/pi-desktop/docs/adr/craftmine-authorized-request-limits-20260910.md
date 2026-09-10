# Explicit unlimited requests for authorized Craftmine acceptance

Status: accepted for the existing dated native P8 authorization.

The outer acceptance relay had unlimited requests, but the inner task still
stopped at 80. Request-null is now an explicit durable policy, fixed at the first
reservation. Only trusted runtime configuration supplies that policy; model
tools do not gain a limits argument. Normal callers retain the finite default,
omitted values retain the existing policy, and malformed values are rejected.
The parent verifies the dated phase before forwarding it to its isolated child;
the sidecar inherits it and the real runtime constructor wires the reservation.

Preview 6 additionally carries one validated policy bit through the minimal
built-in plugin environment. The private broker continues owning durable limits:
it accepts only an exact sidecar echo of that policy and never arbitrary limits.
This closes the previously omitted plugin boundary without exposing parent
credentials or giving model tools a new budget interface.

See `../spec/craftmine-preview5-completion.md` for the call chain, diagnostic
gate and tests. Existing token-null semantics and task immutability are retained.
