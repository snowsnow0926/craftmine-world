# ADR 0317: Bind execution to host resources and private runtime checks

Status: accepted for the core contract; worker delivery still requires real
native execution and runtime validation.

A real check must load exports before marking them passed. Authored export
settings must not replace the trusted browser bridge or choose another target.
Include the preset/shell/bridge hash in new build identities, and store them as
verified host files. Resolve staged exports only for the live private owner,
without publishing. Registration stays ephemeral; revocation interrupts owned
work. Existing applied worlds retain their artifact identities.

The native broker owns OS evidence. The private plugin correlates it with actual
input files and the core claim; the Electron verifier owns runtime observations.
Game code cannot publish itself with a permission claim or snapshot. Candidate
application remains a separate player-driven transaction.
