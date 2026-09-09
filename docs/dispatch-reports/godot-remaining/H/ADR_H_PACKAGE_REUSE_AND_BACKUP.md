# ADR fragment: package reuse, declarative migration and complete backup

Task: `godot-remaining-20260910-H` (the main task assigns the final ADR number).

## Status

Proposed, implemented in `codex/godot-remaining-h-20260910`, not yet merged.

## Context

GD6 needs reusable works that can move to a second world, reliable upgrades
that keep play progress, a complete backup that separates non-rebuildable
content from rebuildable caches, and legacy conversion that only ever produces
a copy. The existing domain already had immutable library content, a whole
domain backup, and a read-only legacy archive with an atomic import commit.
What was missing: a fixed-version install contract, per-world instances with
their own identity and progress, declarative state migration, and a backup that
proves the on-disk content still matches its manifest.

## Decision

1. Keep `craftmine_library` as the only content store. Add
   `craftmine_packages` as an install contract that references an exact
   `{id,version,hash}` and never copies content. Resolution never falls back to
   another version.
2. Model reuse as instances in `craftmine_package_instances`. Each install
   allocates a new identity derived from the `operationId`; state is per
   instance, so two worlds reusing one fixed version keep independent progress
   and one-time reward ledgers. Copies record `origin` but share nothing.
3. Upgrade with declarative operations only. Any operation that would discard
   live data must declare the exact expected value, otherwise the upgrade is
   refused with `PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS`. A failed upgrade
   leaves the previous version, state and revision untouched.
4. Make the complete backup a portable domain archive plus a content manifest
   with per-file hashes, and name the excluded rebuildable caches explicitly.
   `backup.restore-full` verifies content before the atomic domain restore.
5. Make legacy conversion always produce a new `legacy-<12hex>` world and
   re-hash the sealed archive before and after the copy. Per-item status is
   reported; unsupported content is named instead of claimed.
6. Keep the schema version at 3. Archives written before the package tables
   existed are padded with the live column list, so frozen acceptance
   assertions about the domain schema stay valid.

## Consequences

- A package can be registered before its dependencies exist; a missing or
  cyclic dependency is reported at check/install/upgrade time.
- Instance progress is authoritative only for the instance; the world's own
  progress and build are never rewritten by install, upgrade or uninstall.
- The complete backup does not embed legacy archive bytes. It embeds their
  manifest and hashes, and verification fails loudly when the content store no
  longer matches, rather than producing a silently incomplete restore.
- Rebuildable caches stay out of the archive by design; a restore may rebuild
  them from source.

## Alternatives rejected

- A second content store for packages: would duplicate immutable content and
  break the single-hash identity used by library reads and backups.
- Automatic reset to the initial state when a migration cannot be applied:
  silently destroys progress and contradicts the acceptance criteria.
- Shipping legacy archive bytes inside the complete archive: would exceed the
  portable archive limit and mix content with the domain transaction.
- Bumping the domain schema version: would break frozen assertions owned by
  other tasks without changing the row format.
