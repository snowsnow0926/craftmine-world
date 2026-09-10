# Require explicit recovery after terminal world initialization

Date: 2026-09-10. Status: accepted for the terminal-initialization correction.

The c4af0d2 package preserved a failed import in the core, but listing that world
after restart started initialization again. The new attempt opened its former
session without recovery and a transient error replaced the durable reason.

Decision: automatic continuation resumes only recognized unfinished states.
Both the factory and initializer enforce this condition. Terminal or unknown
states require the existing explicit retry action, which retains task recovery
and all later source/build checks. This does not introduce a new retry protocol.

The trusted durable path-budget code takes precedence over transient recovery
exceptions. No attempt ledger, core task or original source is rewritten to
achieve this. A playable confirmed world also outranks stale transient errors.

Consequence: opening or listing a failed world cannot create work. Existing
pending creation continues automatically, including raw creation records that
omit the derived playable field. The player may explicitly retry a failure;
unchanged path constraints remain enforced and can fail again.
