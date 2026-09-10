# Bind finite parameter expectations to the existing runtime check

Date: 2026-09-10. Status: accepted.

A source declaration of 500 milliseconds does not prove that a loaded scene
uses 500. Parent initialization or another script can override that property.
A status-only parameter warning also leaves an otherwise passing candidate
available for adoption.

Persist a finite, typed requirement on the existing core job. The private
descriptor carries its core hash through the existing executor to the isolated
verifier. Require actual post-load and running observations and a named passing
assertion in the existing finish result. Independently check their binding in
Rust; absent or contradictory evidence produces a failed job and rejected
candidate, with durable idempotent replay. Continue and backup preserve the
requirement. Older jobs remain compatible without inventing an expectation.

Use a fixed LF-delimited UTF-8 hash preimage for this one finite contract so
Rust and JavaScript agree without generic JSON canonicalization. Keep raw
finite observations and a fixed `1e-6` conversion tolerance. Do not introduce
arbitrary assertions, executable expressions, a second check system, or a
source parser that claims to prove all runtime behavior.

See [the contract](../spec/godot-check-requirements.md) for the wire shape,
failure behavior, and bounded observation limits. Authored core/protocol
fixtures and native observations must be reported separately.
