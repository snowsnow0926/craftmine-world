//! AL0 lock-file canonicalization, dependency closure and hashing.
//!
//! Frozen rules (shared with VM0):
//! 1. `assets` sorted by `(assetId, version)`; `dependencies` sorted the same.
//! 2. Identical repeated references are merged; the same `(assetId, version)`
//!    with a different `contentHash` is a conflict, never an overwrite.
//! 3. `installPath` uses the frozen relative-path rule and must be unique
//!    case-insensitively across entries.
//! 4. `assetLockHash` is SHA-256 over the canonical UTF-8 JSON bytes, where
//!    canonical means compact separators, struct field order and no trailing
//!    newline.
use std::collections::BTreeMap;

use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};

use super::contract::{self, AssetKind, AssetRef, ASSET_LOCK_FORMAT, MAX_LOCK_ASSETS};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AssetLock {
    pub format: String,
    pub assets: Vec<AssetLockEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AssetLockEntry {
    pub asset: AssetRef,
    pub kind: AssetKind,
    pub install_path: String,
    #[serde(default)]
    pub dependencies: Vec<AssetRef>,
    #[serde(default)]
    pub overrides: Vec<String>,
}

impl AssetLock {
    /// Canonicalizes in place: sorts, merges identical references and rejects
    /// conflicting ones.
    pub(super) fn canonicalize(mut self) -> Result<Self> {
        ensure!(self.format == ASSET_LOCK_FORMAT, "ASSET_LOCK_FORMAT");
        ensure!(
            self.assets.len() <= MAX_LOCK_ASSETS,
            "ASSET_LOCK_TOO_LARGE"
        );
        for entry in &mut self.assets {
            entry.asset.validate()?;
            contract::valid_rel_path(&entry.install_path)?;
            for dependency in &entry.dependencies {
                dependency.validate()?;
            }
            for override_path in &entry.overrides {
                contract::valid_rel_path(override_path)?;
            }
            entry.dependencies = dedupe_refs(std::mem::take(&mut entry.dependencies))?;
            entry.overrides.sort();
            entry.overrides.dedup();
        }
        self.assets.sort_by(|left, right| left.asset.cmp(&right.asset));
        let mut merged: Vec<AssetLockEntry> = Vec::with_capacity(self.assets.len());
        for entry in self.assets.into_iter() {
            match merged.last_mut() {
                Some(previous)
                    if previous.asset.asset_id == entry.asset.asset_id
                        && previous.asset.version == entry.asset.version =>
                {
                    ensure!(
                        previous.asset.content_hash == entry.asset.content_hash
                            && previous.kind == entry.kind
                            && previous.install_path == entry.install_path
                            && previous.dependencies == entry.dependencies
                            && previous.overrides == entry.overrides,
                        "ASSET_LOCK_CONFLICT"
                    );
                }
                _ => merged.push(entry),
            }
        }
        let mut seen: BTreeMap<String, (String, String)> = BTreeMap::new();
        for entry in &merged {
            let key = entry.install_path.to_ascii_lowercase();
            let owner = format!("{}@{}", entry.asset.asset_id, entry.asset.version);
            match seen.get(&key) {
                Some((path, other_owner)) => ensure!(
                    path == &entry.install_path && other_owner == &owner,
                    "ASSET_LOCK_PATH_CONFLICT"
                ),
                None => {
                    seen.insert(key, (entry.install_path.clone(), owner));
                }
            }
        }
        self.assets = merged;
        Ok(self)
    }

    pub(super) fn canonical_bytes(&self) -> Result<Vec<u8>> {
        let canonical = self.clone().canonicalize()?;
        Ok(serde_json::to_vec(&canonical)?)
    }

    pub(super) fn lock_hash(&self) -> Result<String> {
        Ok(super::store::digest_bytes(&self.canonical_bytes()?))
    }
}

fn dedupe_refs(refs: Vec<AssetRef>) -> Result<Vec<AssetRef>> {
    let mut sorted = refs;
    sorted.sort();
    let mut result: Vec<AssetRef> = Vec::with_capacity(sorted.len());
    for reference in sorted.into_iter() {
        match result.last() {
            Some(previous)
                if previous.asset_id == reference.asset_id
                    && previous.version == reference.version =>
            {
                ensure!(
                    previous.content_hash == reference.content_hash,
                    "ASSET_LOCK_CONFLICT"
                );
            }
            _ => result.push(reference),
        }
    }
    Ok(result)
}

pub(super) fn parse_lock(text: &str) -> Result<AssetLock> {
    let lock: AssetLock = serde_json::from_str(text)?;
    lock.canonicalize()
}

/// Resolves the complete fixed dependency closure. Missing dependencies and
/// cycles are errors: a partially assembled asset must never look installable.
pub(super) fn resolve_closure(lock: &AssetLock, roots: &[AssetRef]) -> Result<Vec<AssetRef>> {
    let mut edges: BTreeMap<AssetRef, Vec<AssetRef>> = BTreeMap::new();
    for entry in &lock.assets {
        edges.insert(entry.asset.clone(), entry.dependencies.clone());
    }
    let mut resolved: Vec<AssetRef> = Vec::new();
    let mut done: BTreeMap<AssetRef, bool> = BTreeMap::new();
    for root in roots {
        visit(root, &edges, &mut done, &mut resolved, &mut Vec::new())?;
    }
    resolved.sort();
    resolved.dedup();
    Ok(resolved)
}

fn visit(
    node: &AssetRef,
    edges: &BTreeMap<AssetRef, Vec<AssetRef>>,
    done: &mut BTreeMap<AssetRef, bool>,
    resolved: &mut Vec<AssetRef>,
    stack: &mut Vec<AssetRef>,
) -> Result<()> {
    if done.get(node).copied().unwrap_or(false) {
        return Ok(());
    }
    ensure!(!stack.contains(node), "ASSET_DEPENDENCY_CYCLE");
    let dependencies = edges.get(node).ok_or_else(|| {
        anyhow::anyhow!(if stack.is_empty() {
            "ASSET_NOT_IN_LOCK".to_string()
        } else {
            "ASSET_DEPENDENCY_MISSING".to_string()
        })
    })?;
    stack.push(node.clone());
    for dependency in dependencies {
        visit(dependency, edges, done, resolved, stack)?;
    }
    stack.pop();
    done.insert(node.clone(), true);
    resolved.push(node.clone());
    Ok(())
}

/// Same-cycle report used by the shared vectors: returns the normalized cycle
/// path when one exists.
#[allow(dead_code)]
pub(super) fn find_cycle(lock: &AssetLock) -> Option<Vec<AssetRef>> {
    let mut edges: BTreeMap<AssetRef, Vec<AssetRef>> = BTreeMap::new();
    for entry in &lock.assets {
        edges.insert(entry.asset.clone(), entry.dependencies.clone());
    }
    for entry in &lock.assets {
        let mut stack = Vec::new();
        let mut path = Vec::new();
        if cycle_from(&entry.asset, &edges, &mut stack, &mut path) {
            path.sort();
            return Some(path);
        }
    }
    None
}

fn cycle_from(
    node: &AssetRef,
    edges: &BTreeMap<AssetRef, Vec<AssetRef>>,
    stack: &mut Vec<AssetRef>,
    path: &mut Vec<AssetRef>,
) -> bool {
    if stack.contains(node) {
        path.push(node.clone());
        return true;
    }
    let Some(dependencies) = edges.get(node) else {
        return false;
    };
    stack.push(node.clone());
    for dependency in dependencies {
        if cycle_from(dependency, edges, stack, path) {
            stack.pop();
            return true;
        }
    }
    stack.pop();
    false
}
