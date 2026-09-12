# Preserve retained drafts during ordinary source compatibility migration

Date: 2026-09-12. Status: accepted.

FB03-007 exposed an incompatible pair of invariants: background maintenance
correctly preserves main by adopting on an isolated branch, but ordinary
creative entry required main to equal formal before upgrading legacy runtime
files. The actual main branch retained an unapplied Pomeranian while formal
contained only the stock ground maintenance change. No model call occurred.

Replace whole-tree equality for ordinary creative requests with exact-file
compatibility merging. The migration is computed on the current main manifest,
retains unrelated authored files, and uses the existing revision/head/per-file
CAS and durable receipt. Carry forward only an exactly recognized adopted
stock ground repair. Keep protected-file and fixed-selector conflicts, and
keep whole-content scope for standalone observer-only upgrades.

This amends the legacy draft-equality rule noted in
`current-creation-cohort-migration.md`. It does not change the current-cohort
no-op rule, source ownership, normal permission mode, model choice, application
checks, formal content or progress storage. The host remains an orchestrator of
Rust-owned transactions; it never writes the player's source or database files
directly.

See [the behavior and regression scenario](../spec/creation-retained-draft-migration.md).
