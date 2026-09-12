# Ordinary creation after retained-world maintenance

Date: 2026-09-12. Feedback: FB03-007.

## Required behavior

A normal creative request may continue the main draft even when automatic
maintenance has advanced the formal world on a separate branch. The host must
not require the complete main and formal trees to be identical before a model
can start. The existing main-draft authoring semantics remain in effect; no new
turn branch or implicit candidate adoption is introduced.

The reported world had an unapplied Pomeranian script and scene node on main,
while formal had an independently adopted stock ground repair. The prior
whole-tree equality check rejected the request with
`CREATION_MIGRATION_DRAFT_CONFLICT` before any model call. A direct replica of
that divergence is the required regression scenario.

## Migration boundary

1. Identify the formal build and its complete released compatibility policy as
   before. Unknown formal runtime bytes remain unsupported.
2. Read the entire current main manifest under one revision/hash identity.
3. Preserve every draft file outside the reviewed migration operations. Each
   touched path must have its exact expected source hash or already have the
   destination bytes backed by the original migration receipt.
4. Protected files not named by an operation, and the fixed project selectors,
   must still match formal. A same-name authored helper is a conflict, not
   permission to overwrite it.
5. If formal already has the exact released stock ground repair and main still
   has the exact old stock script, include that reviewed repair. Never replace
   customized gameplay code by matching color or text fragments.
6. Perform one normal project patch with revision, manifest, Git-head and
   per-file compare-and-swap checks. Store the baseline manifest and expected
   result in the host receipt record. Verify every resulting file before
   advancing the capture's source identity.
7. Recover a lost patch reply through its original receipt. Subsequent ordinary
   draft edits remain intact; unknown protected edits and partial migrations
   still fail. Cancellation and source changes during the transaction prevent
   a successful advance.
8. A standalone observer-upgrade action retains the stricter requirement: it
   cannot silently include unrelated draft gameplay in a later adoption.

Formal content, the applied Git reference, saved progress and existing history
are unchanged by this preparatory service. Any resulting candidate still needs
normal checks and application guards. Existing permission precedence and model
configuration remain independent; the recorded failing session used an
inherited effective Ask setting and had zero model calls, despite having a
configured Flash model with maximum thinking.

## Validation and end-to-end scenario

Unit coverage includes ordinary draft additions, unknown touched files,
untouched protected-file conflicts, helper expected absence, lost receipts,
subsequent draft work, standalone observer-only scope, cancellation and a
concurrent source change.

`tests/fb03-retained-draft-migration-core.mjs` copies the original domain through
read-only filesystem/SQLite access and executes the production TypeScript
migration against real Rust APIs in that copy. It checks preservation of the
Pomeranian source and scene bytes, the adopted ground script, formal world,
complete progress, applied reference and receipt replay. It launches neither
the model nor the Godot runtime.

The integrated product scenario must submit the same ordinary creation request
in a copy of this retained world, using its actual session configuration. It
must reach normal model work without deleting the draft or manually applying a
candidate. Model capability and weapon gameplay require their own subsequent
verification; passing the preparatory migration is not that evidence.
