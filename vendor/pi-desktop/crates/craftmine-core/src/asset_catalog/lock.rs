//! Builds R1/M's canonical `AssetLock` from catalog rows.
//!
//! The lock document, its canonical text, its hash, path rules and dependency
//! closure rules are defined once in `content_history::contract`. This module
//! only assembles a lock from immutable catalog versions and resolves the fixed
//! closure for installation; it never re-implements the format.
use anyhow::Result;

use super::contract::{AssetLock, AssetLockEntry, AssetOverrideRef, AssetRef, FileRef};

pub(super) fn entry(
    asset: AssetRef,
    install_path: &str,
    files: Vec<FileRef>,
    dependencies: Vec<AssetRef>,
    overrides: Vec<AssetOverrideRef>,
) -> Result<AssetLockEntry> {
    let entry = AssetLockEntry {
        asset,
        install_path: install_path.to_string(),
        files,
        dependencies,
        overrides,
    };
    entry.validate()?;
    Ok(entry)
}

/// Canonical lock for a set of entries. R1's `canonicalize` rejects unresolved
/// dependencies and cycles, so a partially assembled asset can never become
/// installable.
pub(super) fn build(entries: Vec<AssetLockEntry>) -> Result<AssetLock> {
    AssetLock::new(entries)
}

/// Fixed transitive closure of `roots` inside an already canonical lock.
pub(super) fn resolve_closure(lock: &AssetLock, roots: &[AssetRef]) -> Result<Vec<AssetRef>> {
    let mut resolved: Vec<AssetRef> = Vec::new();
    for root in roots {
        let entry = lock
            .assets
            .iter()
            .find(|entry| entry.asset == *root)
            .ok_or_else(|| anyhow::anyhow!("ASSET_LOCK_DEPENDENCY_UNRESOLVED"))?;
        collect(entry, lock, &mut resolved);
    }
    resolved.sort();
    resolved.dedup();
    Ok(resolved)
}

fn collect(entry: &AssetLockEntry, lock: &AssetLock, out: &mut Vec<AssetRef>) {
    if out.contains(&entry.asset) {
        return;
    }
    out.push(entry.asset.clone());
    for dependency in &entry.dependencies {
        if let Some(next) = lock.assets.iter().find(|item| item.asset == *dependency) {
            collect(next, lock, out);
        }
    }
}
