# Source-bound configuration belongs in the shared installer

Status: accepted for the downstream Craftmine product.

## Context

Companion v3 source archives require receiving-world save bounds. Composition
could describe this requirement, but ordinary search/read and installation did
not carry or apply it. A near-spawn check could therefore leave an instance at
legacy ±80 defaults and fail later in a larger world.

## Decision

Use a small structured `positionBounds` value, bound to the host-selected world's
current source revision/manifest. The shared package materializer handles author
single/group installation and both manual proposal confirmation routes. It
resolves configuration before planning or source writes, writes only the two
declared exports on new instances, and records their identities in the existing
intent/receipt. Exact stock source and entry pins can produce a plan; other
worlds require explicit source review. Do not add a Core RPC or runtime state
mutation for this configuration.

Historical versions lack the new mandatory declaration. They retain their
installation behavior and bytes, with a clear range warning instead of a new
world-wide installation ban. New required-config declarations fail closed when
unconfigured. Existing full-auto permission, source CAS and candidate checks
remain authoritative.

## Consequences

This removes silent default use from every v3 installation route. Explicit
configuration becomes stale after any source revision change; even a stock
scene changed by a previous installation needs fresh review. This conservative
rule is visible to the agent rather than reusing an old compatibility claim.
Numeric validation establishes a finite, well-formed domain, not semantic proof
that a custom world's chosen range is correct. Runtime pet-shape validation,
actual gameplay and save/reopen still supply that evidence.
