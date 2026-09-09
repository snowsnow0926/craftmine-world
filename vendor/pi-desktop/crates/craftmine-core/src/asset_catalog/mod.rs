//! AL0-AL2 local asset and work-library foundation (agent N).
//!
//! * `contract`  — frozen AL0 types shared with the version-management plan.
//! * `lockfile`  — canonical lock file, dependency closure and lock hash.
//! * `store`     — content-addressed blobs and immutable version rows.
//! * `import`    — streaming player-file import, legacy mapping, body access.
//! * `index`     — classification, search, tags and usage relations.
//! * `preview`   — structural probe, preview states and base-check evidence.
//! * `budget`    — recommended and measured budgets, kept separate.
//! * `reclaim`   — executes S1-approved reclamation entries, re-verified.
//!
//! Work installation and application stay with H/M/A/C/D: this module only
//! provides fixed resource bodies, lock parsing and read-only evidence.
use anyhow::Result;
use rusqlite::Connection;

mod budget;
mod contract;
mod dispatch;
mod import;
mod index;
mod lock;
mod preview;
mod reclaim;
mod scan;
mod store;
#[cfg(test)]
#[path = "asset_catalog_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "reclaim_tests.rs"]
mod reclaim_tests;

pub use dispatch::dispatch;

pub(super) fn migrate(db: &Connection) -> Result<()> {
    store::migrate(db)
}

/// Windows reports a file held by another process as a raw OS error (32 sharing
/// violation, 33 lock violation). The player needs an actionable code, and a
/// scan must never abort because one file in the tree is locked.
pub(super) fn source_io_error(path: &std::path::Path, error: anyhow::Error) -> anyhow::Error {
    let locked = error
        .chain()
        .find_map(|cause| cause.downcast_ref::<std::io::Error>())
        .and_then(|io| io.raw_os_error())
        .map(|code| code == 32 || code == 33)
        .unwrap_or(false);
    if locked {
        anyhow::anyhow!("ASSET_SOURCE_LOCKED: {}: {error}", path.display())
    } else {
        anyhow::anyhow!("ASSET_SOURCE_UNREADABLE: {}: {error}", path.display())
    }
}

/// Scan issue code for a per-file read failure, so one locked or unreadable
/// file is reported instead of failing the whole directory walk.
pub(super) fn source_io_code(error: &anyhow::Error) -> &'static str {
    if error.to_string().contains("ASSET_SOURCE_LOCKED") {
        "SOURCE_LOCKED"
    } else {
        "SOURCE_UNREADABLE"
    }
}
