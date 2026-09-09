//! Frozen shared content-reference contract for player-created worlds (VM0/AL0).
//!
//! This file is the single definition of `AssetRef`, `FileRef`, `ContentRef`,
//! `BuildRef`, `ProgressRef`, `OperationContext` and the canonical
//! `craftmine.assets-lock/1` form. The asset catalog and the content history
//! must import these types instead of defining parallel shapes; a second
//! definition of the same reference is a contract violation.
//!
//! Frozen decisions:
//! * Git object IDs are validated as 4..=64 lowercase hexadecimal characters.
//!   The protocol never assumes 40 characters and records the repository
//!   object format separately. Asset content hashes are SHA-256 in a different
//!   namespace.
//! * Lock files store relative, forward-slash paths only. Unicode NFC
//!   normalization is the producer's responsibility; the hash always covers
//!   the stored bytes, so a producer must normalize before writing.
//! * Canonical lock text is pretty JSON with two-space indentation, LF line
//!   endings and exactly one trailing newline. `assetLockHash` is the SHA-256
//!   of exactly those bytes.
//! * A mutable version selector such as `latest` is rejected; references are
//!   immutable.

use std::collections::BTreeMap;

use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Lock file name inside a world's source tree.
pub const ASSET_LOCK_FILE: &str = "craftmine.assets.lock.json";
/// Lock file format identifier.
pub const ASSET_LOCK_FORMAT: &str = "craftmine.assets-lock/1";
/// Maximum length of a stored relative path in bytes.
pub const PATH_BYTE_LIMIT: usize = 240;
/// Maximum number of `/` separated segments in a stored relative path.
pub const PATH_SEGMENT_LIMIT: usize = 16;
/// Maximum length of one path segment in bytes.
pub const PATH_PART_LIMIT: usize = 80;
/// Maximum accepted Git object ID length for the widest known object format.
pub const OID_LIMIT: usize = 64;

fn is_lower_hex(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Validate a Git object ID without assuming a fixed hash length.
pub fn validate_oid(oid: &str) -> Result<()> {
    ensure!(
        oid.len() >= 4 && oid.len() <= OID_LIMIT && is_lower_hex(oid),
        "INVALID_GIT_OID"
    );
    Ok(())
}

/// Validate an asset content hash. Deliberately separate from Git object IDs.
pub fn validate_sha256(hash: &str) -> Result<()> {
    ensure!(hash.len() == 64 && is_lower_hex(hash), "INVALID_SHA256");
    Ok(())
}

/// Validate a stable identifier (world, repo, branch, asset, progress, ...).
pub fn validate_identifier(value: &str, code: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 120
            && !value.chars().any(char::is_control)
            && value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':')
            }),
        "{code}"
    );
    Ok(())
}

fn reserved_device_name(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or(part);
    let upper = stem.to_ascii_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") {
        return true;
    }
    // COM0/COM1..COM9 and LPT0/LPT1..LPT9 are all reserved on Windows.
    upper.len() == 4
        && (upper.starts_with("COM") || upper.starts_with("LPT"))
        && upper.as_bytes()[3].is_ascii_digit()
}

/// Validate one stored relative path.
///
/// Rejects absolute paths, drive letters, backslashes, traversal, empty or
/// oversized segments, Windows device names, control characters, `.git`
/// components and the mutable case-collision shapes that break on Windows and
/// macOS. Case-insensitive collisions across a *set* of paths are checked by
/// [`detect_path_collisions`].
pub fn validate_relative_path(path: &str) -> Result<()> {
    ensure!(
        !path.is_empty() && path.len() <= PATH_BYTE_LIMIT,
        "INVALID_RELATIVE_PATH"
    );
    ensure!(
        !path.starts_with('/') && !path.contains('\\') && !path.contains(':'),
        "PATH_NOT_RELATIVE"
    );
    ensure!(!path.chars().any(char::is_control), "INVALID_RELATIVE_PATH");
    let parts: Vec<&str> = path.split('/').collect();
    ensure!(
        parts.len() <= PATH_SEGMENT_LIMIT && !parts.is_empty(),
        "PATH_TOO_DEEP"
    );
    for part in &parts {
        ensure!(
            !part.is_empty() && part.len() <= PATH_PART_LIMIT,
            "INVALID_RELATIVE_PATH"
        );
        ensure!(
            *part != "." && *part != "..",
            "PATH_TRAVERSAL"
        );
        ensure!(
            !part.starts_with(' ') && !part.ends_with(' ') && !part.ends_with('.'),
            "INVALID_RELATIVE_PATH"
        );
        ensure!(
            !part
                .bytes()
                .any(|byte| matches!(byte, b'<' | b'>' | b'"' | b'|' | b'?' | b'*' | 0)),
            "INVALID_RELATIVE_PATH"
        );
        ensure!(!reserved_device_name(part), "PATH_RESERVED_NAME");
        ensure!(
            !part.eq_ignore_ascii_case(".git") && !part.eq_ignore_ascii_case("git~1"),
            "PATH_TRAVERSAL"
        );
    }
    Ok(())
}

/// Reject two paths that only differ by case or Unicode length shape.
pub fn detect_path_collisions<'a>(paths: impl IntoIterator<Item = &'a str>) -> Result<()> {
    let mut seen: BTreeMap<String, &str> = BTreeMap::new();
    for path in paths {
        validate_relative_path(path)?;
        let key = path.to_lowercase();
        if let Some(previous) = seen.insert(key, path) {
            ensure!(previous == path, "PATH_COLLISION");
        }
    }
    Ok(())
}

/// Case-collision check restricted to one scope.
pub fn detect_scoped_path_collisions<'a>(
    entries: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Result<()> {
    let mut seen: BTreeMap<(String, String), &str> = BTreeMap::new();
    for (scope, path) in entries {
        validate_relative_path(path)?;
        let key = (scope.to_lowercase(), path.to_lowercase());
        if let Some(previous) = seen.insert(key, path) {
            ensure!(previous == path, "PATH_COLLISION");
        }
    }
    Ok(())
}

/// A logical asset at one immutable version.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetRef {
    pub asset_id: String,
    pub version: String,
    /// SHA-256 over the canonical content manifest of this version.
    pub content_hash: String,
}

impl AssetRef {
    pub fn validate(&self) -> Result<()> {
        validate_identifier(&self.asset_id, "INVALID_ASSET_ID")?;
        validate_identifier(&self.version, "INVALID_ASSET_VERSION")?;
        ensure!(
            !self.version.eq_ignore_ascii_case("latest")
                && !self.version.eq_ignore_ascii_case("head"),
            "ASSET_LOCK_MUTABLE_VERSION"
        );
        validate_sha256(&self.content_hash)
    }
}

/// One immutable file inside an asset version.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileRef {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
    pub media_type: String,
}

impl FileRef {
    pub fn validate(&self) -> Result<()> {
        validate_relative_path(&self.path)?;
        validate_sha256(&self.sha256)?;
        ensure!(
            !self.media_type.is_empty()
                && self.media_type.len() <= 120
                && !self.media_type.chars().any(char::is_control),
            "INVALID_MEDIA_TYPE"
        );
        Ok(())
    }
}

/// Source content: one repository commit plus the asset lock it was committed
/// with. Neither half alone identifies playable content.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentRef {
    pub repo_id: String,
    pub commit_oid: String,
    pub asset_lock_hash: String,
}

impl ContentRef {
    pub fn validate(&self) -> Result<()> {
        validate_identifier(&self.repo_id, "INVALID_REPO_ID")?;
        validate_oid(&self.commit_oid)?;
        validate_sha256(&self.asset_lock_hash)
    }
}

/// Everything a build identity binds besides its source content.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuildRef {
    pub content: ContentRef,
    pub base_id: String,
    pub base_version: String,
    pub engine_version: String,
    pub target: String,
    pub build_id: String,
}

impl BuildRef {
    pub fn validate(&self) -> Result<()> {
        self.content.validate()?;
        validate_identifier(&self.base_id, "INVALID_BASE_ID")?;
        validate_identifier(&self.base_version, "INVALID_BASE_VERSION")?;
        validate_identifier(&self.engine_version, "INVALID_ENGINE_VERSION")?;
        validate_identifier(&self.target, "INVALID_BUILD_TARGET")?;
        validate_identifier(&self.build_id, "INVALID_BUILD_ID")
    }
}

/// A confirmed play progress record. Progress is not content history and does
/// not move when branches are merged.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgressRef {
    pub world_id: String,
    pub progress_id: String,
    pub revision: u64,
    pub build: BuildRef,
    pub state_schema_version: u32,
    pub content_hash: String,
}

impl ProgressRef {
    pub fn validate(&self) -> Result<()> {
        validate_identifier(&self.world_id, "INVALID_WORLD_ID")?;
        validate_identifier(&self.progress_id, "INVALID_PROGRESS_ID")?;
        self.build.validate()?;
        validate_sha256(&self.content_hash)
    }
}

/// Host-bound operation identity. The model can never choose the target world
/// or forge the expected old values; the host fills this from trusted state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationContext {
    pub operation_id: String,
    pub world_id: String,
    pub repo_id: String,
    pub branch_id: String,
    /// Present but `null` when the operation may create the reference.
    #[serde(deserialize_with = "required_option")]
    pub expected_head_oid: Option<String>,
    /// Present but `null` when no content is applied yet.
    #[serde(deserialize_with = "required_option")]
    pub expected_applied_oid: Option<String>,
    /// Present but `null` when the world has no confirmed progress yet.
    #[serde(deserialize_with = "required_option")]
    pub expected_progress_revision: Option<u64>,
}

/// Deserialize an optional value while still requiring the key to be present.
fn required_option<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

impl OperationContext {
    pub fn validate(&self) -> Result<()> {
        validate_identifier(&self.operation_id, "INVALID_OPERATION_ID")?;
        validate_identifier(&self.world_id, "INVALID_WORLD_ID")?;
        validate_identifier(&self.repo_id, "INVALID_REPO_ID")?;
        validate_identifier(&self.branch_id, "INVALID_BRANCH_ID")?;
        if let Some(oid) = &self.expected_head_oid {
            validate_oid(oid)?;
        }
        if let Some(oid) = &self.expected_applied_oid {
            validate_oid(oid)?;
        }
        Ok(())
    }
}

/// Runtime override bound to one scope inside a world.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetOverrideRef {
    pub scope: String,
    pub path: String,
    pub content_hash: String,
}

impl AssetOverrideRef {
    pub fn validate(&self) -> Result<()> {
        validate_identifier(&self.scope, "INVALID_OVERRIDE_SCOPE")?;
        validate_relative_path(&self.path)?;
        validate_sha256(&self.content_hash)
    }
}

/// One locked asset: which immutable version, where it installs, its files and
/// its full fixed dependency closure.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetLockEntry {
    pub asset: AssetRef,
    pub install_path: String,
    #[serde(default)]
    pub files: Vec<FileRef>,
    #[serde(default)]
    pub dependencies: Vec<AssetRef>,
    #[serde(default)]
    pub overrides: Vec<AssetOverrideRef>,
}

impl AssetLockEntry {
    pub fn validate(&self) -> Result<()> {
        self.asset.validate()?;
        validate_relative_path(&self.install_path)?;
        detect_path_collisions(self.files.iter().map(|file| file.path.as_str()))?;
        for file in &self.files {
            file.validate()?;
        }
        for dependency in &self.dependencies {
            dependency.validate()?;
        }
        // Two scopes may override the same path; collisions are only invalid
        // inside one scope.
        detect_scoped_path_collisions(
            self.overrides
                .iter()
                .map(|item| (item.scope.as_str(), item.path.as_str())),
        )?;
        for item in &self.overrides {
            item.validate()?;
        }
        Ok(())
    }
}

/// The `craftmine.assets-lock/1` document committed next to the project.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetLock {
    pub format: String,
    pub assets: Vec<AssetLockEntry>,
}

impl AssetLock {
    /// Build a lock document from arbitrary input and canonicalize it.
    pub fn new(mut entries: Vec<AssetLockEntry>) -> Result<Self> {
        let mut lock = Self {
            format: ASSET_LOCK_FORMAT.to_string(),
            assets: std::mem::take(&mut entries),
        };
        lock.canonicalize()?;
        Ok(lock)
    }

    pub fn empty() -> Self {
        Self {
            format: ASSET_LOCK_FORMAT.to_string(),
            assets: Vec::new(),
        }
    }

    fn key(asset: &AssetRef) -> (String, String) {
        (asset.asset_id.clone(), asset.version.clone())
    }

    /// Sort, deduplicate and reject conflicting duplicates, dependency cycles
    /// and path collisions. Idempotent: canonical input stays byte-identical.
    pub fn canonicalize(&mut self) -> Result<()> {
        ensure!(self.format == ASSET_LOCK_FORMAT, "ASSET_LOCK_FORMAT_MISMATCH");
        let mut known: BTreeMap<(String, String), AssetRef> = BTreeMap::new();
        for entry in &self.assets {
            entry.validate()?;
            let key = Self::key(&entry.asset);
            if let Some(previous) = known.insert(key.clone(), entry.asset.clone()) {
                ensure!(
                    previous == entry.asset,
                    "ASSET_LOCK_VERSION_CONFLICT: {}/{}",
                    key.0,
                    key.1
                );
            }
        }
        for entry in &mut self.assets {
            entry.files.sort_by(|left, right| left.path.cmp(&right.path));
            entry.files.dedup();
            entry
                .dependencies
                .sort_by(|left, right| Self::key(left).cmp(&Self::key(right)));
            entry.dependencies.dedup();
            entry.overrides.sort_by(|left, right| {
                (left.scope.clone(), left.path.clone())
                    .cmp(&(right.scope.clone(), right.path.clone()))
            });
            entry.overrides.dedup();
        }
        self.assets.sort_by(|left, right| {
            Self::key(&left.asset)
                .cmp(&Self::key(&right.asset))
                .then_with(|| left.install_path.cmp(&right.install_path))
        });
        // Exact duplicates (same asset, files, dependencies, install path) are
        // collapsed; anything else would have been rejected above.
        self.assets.dedup();
        self.assert_dependencies_closed(&known)?;
        Ok(())
    }

    fn assert_dependencies_closed(
        &self,
        known: &BTreeMap<(String, String), AssetRef>,
    ) -> Result<()> {
        for entry in &self.assets {
            for dependency in &entry.dependencies {
                ensure!(
                    known.get(&Self::key(dependency)) == Some(dependency),
                    "ASSET_LOCK_DEPENDENCY_UNRESOLVED: {}/{}",
                    dependency.asset_id,
                    dependency.version
                );
            }
        }
        // Dependency cycles make a lock file unreproducible even when every
        // node resolves, so they are rejected rather than resolved silently.
        let mut state: BTreeMap<(String, String), u8> = BTreeMap::new();
        for entry in &self.assets {
            self.visit(&entry.asset, known, &mut state, &mut Vec::new())?;
        }
        Ok(())
    }

    fn visit(
        &self,
        node: &AssetRef,
        by_version: &BTreeMap<(String, String), AssetRef>,
        state: &mut BTreeMap<(String, String), u8>,
        stack: &mut Vec<String>,
    ) -> Result<()> {
        let key = Self::key(node);
        match state.get(&key).copied().unwrap_or(0) {
            2 => return Ok(()),
            1 => {
                stack.push(format!("{}/{}", key.0, key.1));
                anyhow::bail!("ASSET_LOCK_DEPENDENCY_CYCLE: {}", stack.join(" -> "));
            }
            _ => {}
        }
        state.insert(key.clone(), 1);
        stack.push(format!("{}/{}", key.0, key.1));
        if let Some(entry) = self.assets.iter().find(|entry| Self::key(&entry.asset) == key) {
            for dependency in &entry.dependencies {
                if let Some(target) = by_version.get(&Self::key(dependency)) {
                    self.visit(target, by_version, state, stack)?;
                }
            }
        }
        stack.pop();
        state.insert(key, 2);
        Ok(())
    }

    /// Canonical text: pretty JSON, LF endings, one trailing newline.
    pub fn canonical_text(&self) -> Result<String> {
        let mut text = serde_json::to_string_pretty(self)?;
        text.push('\n');
        Ok(text)
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>> {
        Ok(self.canonical_text()?.into_bytes())
    }

    /// `assetLockHash` used by `ContentRef`.
    pub fn asset_lock_hash(&self) -> Result<String> {
        Ok(Sha256::digest(self.canonical_bytes()?)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }

    /// Parse any document that matches the schema, then canonicalize it.
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        ensure!(bytes.len() <= 8 * 1024 * 1024, "ASSET_LOCK_TOO_LARGE");
        let text = std::str::from_utf8(bytes).context("ASSET_LOCK_NOT_UTF8")?;
        let mut lock: Self =
            serde_json::from_str(text).context("INVALID_ASSET_LOCK")?;
        lock.canonicalize()?;
        Ok(lock)
    }

    /// Parse and require that the stored bytes are already canonical.
    pub fn parse_canonical(bytes: &[u8]) -> Result<Self> {
        let lock = Self::parse(bytes)?;
        ensure!(
            lock.canonical_bytes()? == bytes,
            "ASSET_LOCK_NOT_CANONICAL"
        );
        Ok(lock)
    }
}
