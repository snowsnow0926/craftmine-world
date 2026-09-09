//! AL0-AL2 local asset and work-library foundation (agent N).
//!
//! * `contract`  — frozen AL0 types shared with the version-management plan.
//! * `lockfile`  — canonical lock file, dependency closure and lock hash.
//! * `store`     — content-addressed blobs and immutable version rows.
//! * `import`    — streaming player-file import, legacy mapping, body access.
//! * `index`     — classification, search, tags and usage relations.
//! * `preview`   — structural probe, preview states and base-check evidence.
//! * `budget`    — recommended and measured budgets, kept separate.
//!
//! Work installation and application stay with H/M/A/C/D: this module only
//! provides fixed resource bodies, lock parsing and read-only evidence.
use anyhow::Result;
use rusqlite::Connection;

mod budget;
mod contract;
mod import;
mod index;
mod lockfile;
mod preview;
mod scan;
mod store;
#[cfg(test)]
#[path = "asset_catalog_tests.rs"]
mod tests;

pub(super) fn migrate(db: &Connection) -> Result<()> {
    store::migrate(db)
}

/// Shared AL0 test vectors consumed by M's VM0 implementation and by these
/// tests. The canonical copy lives in `docs/dispatch-reports/godot-remaining/N`.
#[allow(dead_code)]
pub(super) const LOCK_VECTORS: &str =
    include_str!("vectors/assets-lock-vectors.json");
