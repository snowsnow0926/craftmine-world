//! Frozen AL0 contract shared with the player version-management plan.
//!
//! `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` section 5 owns the single
//! shared definition of `AssetRef`/`FileRef`/`ContentRef`/`BuildRef`/
//! `ProgressRef`/`OperationContext`. This module is the Rust implementation of
//! that definition plus the common test vectors under `vectors/`.
//!
//! The frozen structures stay compiled even when a later commit is the first
//! caller: the shared vectors exercise them today.
#![allow(dead_code)]
use anyhow::{bail, ensure, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(super) const ASSET_CONTRACT_FORMAT: &str = "craftmine.assets/1";
pub(super) const ASSET_LOCK_FORMAT: &str = "craftmine.assets-lock/1";
pub(super) const ASSET_CONTENT_FORMAT: &str = "craftmine.asset-content/1";
pub(super) const MAX_ID_BYTES: usize = 128;
pub(super) const MAX_PATH_BYTES: usize = 240;
pub(super) const MAX_VERSION: u64 = 1_000_000;
pub(super) const MAX_LOCK_ASSETS: usize = 10_000;

/// The four frozen asset types. A name is never an identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum AssetKind {
    Raw,
    Object,
    Creation,
    WorldTemplate,
}

impl AssetKind {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Raw => "raw",
            Self::Object => "object",
            Self::Creation => "creation",
            Self::WorldTemplate => "world-template",
        }
    }

    pub(super) fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "raw" => Self::Raw,
            "object" => Self::Object,
            "creation" => Self::Creation,
            "world-template" => Self::WorldTemplate,
            _ => bail!("INVALID_ASSET_KIND"),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum MediaKind {
    Image,
    Model,
    Audio,
    Package,
    Other,
}

impl MediaKind {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Model => "model",
            Self::Audio => "audio",
            Self::Package => "package",
            Self::Other => "other",
        }
    }

    pub(super) fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "image" => Self::Image,
            "model" => Self::Model,
            "audio" => Self::Audio,
            "package" => Self::Package,
            "other" => Self::Other,
            _ => bail!("INVALID_MEDIA_KIND"),
        })
    }
}

/// Query scope is a search range, never a second file format.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum QueryScope {
    CurrentWorld,
    LocalLibrary,
    ImportSource,
}

impl QueryScope {
    pub(super) fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "current-world" => Self::CurrentWorld,
            "local-library" => Self::LocalLibrary,
            "import-source" => Self::ImportSource,
            _ => bail!("INVALID_QUERY_SCOPE"),
        })
    }
}

/// Provenance rights are recorded, never guessed from a file name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum LicenseStatus {
    Verified,
    Unverified,
    Unknown,
}

impl LicenseStatus {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Verified => "verified",
            Self::Unverified => "unverified",
            Self::Unknown => "unknown",
        }
    }

    pub(super) fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "verified" => Self::Verified,
            "unverified" => Self::Unverified,
            "unknown" => Self::Unknown,
            _ => bail!("INVALID_LICENSE_STATUS"),
        })
    }
}

/// Usage relations block deletion. AL5 keeps them authoritative.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum UsageKind {
    WorldCurrent,
    WorldHistory,
    WorldDraft,
    CreationDependency,
    BackupRetention,
    ExportPackage,
}

impl UsageKind {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::WorldCurrent => "world-current",
            Self::WorldHistory => "world-history",
            Self::WorldDraft => "world-draft",
            Self::CreationDependency => "creation-dependency",
            Self::BackupRetention => "backup-retention",
            Self::ExportPackage => "export-package",
        }
    }

    pub(super) fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "world-current" => Self::WorldCurrent,
            "world-history" => Self::WorldHistory,
            "world-draft" => Self::WorldDraft,
            "creation-dependency" => Self::CreationDependency,
            "backup-retention" => Self::BackupRetention,
            "export-package" => Self::ExportPackage,
            _ => bail!("INVALID_USAGE_KIND"),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AssetRef {
    pub asset_id: String,
    pub version: u64,
    pub content_hash: String,
}

impl AssetRef {
    pub(super) fn new(asset_id: &str, version: u64, content_hash: &str) -> Result<Self> {
        let value = Self {
            asset_id: asset_id.to_string(),
            version,
            content_hash: content_hash.to_string(),
        };
        value.validate()?;
        Ok(value)
    }

    pub(super) fn validate(&self) -> Result<()> {
        valid_id(&self.asset_id, "INVALID_ASSET_ID")?;
        valid_version(self.version)?;
        valid_hash(&self.content_hash, "INVALID_ASSET_HASH")?;
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FileRef {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
    pub media_type: String,
}

impl FileRef {
    pub(super) fn validate(&self) -> Result<()> {
        valid_rel_path(&self.path)?;
        valid_hash(&self.sha256, "INVALID_FILE_HASH")?;
        ensure!(self.bytes > 0, "INVALID_FILE_BYTES");
        valid_media_type(&self.media_type)?;
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ContentRef {
    pub repo_id: String,
    pub commit_oid: String,
    pub asset_lock_hash: String,
}

impl ContentRef {
    pub(super) fn validate(&self) -> Result<()> {
        valid_id(&self.repo_id, "INVALID_REPO_ID")?;
        valid_commit_oid(&self.commit_oid)?;
        valid_hash(&self.asset_lock_hash, "INVALID_ASSET_LOCK_HASH")?;
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BuildRef {
    pub content: ContentRef,
    pub base_id: String,
    pub base_version: u64,
    pub engine_version: String,
    pub target: String,
    pub build_id: String,
}

impl BuildRef {
    pub(super) fn validate(&self) -> Result<()> {
        self.content.validate()?;
        valid_id(&self.base_id, "INVALID_BASE_ID")?;
        valid_version(self.base_version)?;
        valid_label(&self.engine_version, "INVALID_ENGINE_VERSION")?;
        valid_label(&self.target, "INVALID_TARGET")?;
        valid_label(&self.build_id, "INVALID_BUILD_ID")?;
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProgressRef {
    pub world_id: String,
    pub progress_id: String,
    pub revision: u64,
    pub build: BuildRef,
    pub state_schema_version: u64,
    pub content_hash: String,
}

impl ProgressRef {
    pub(super) fn validate(&self) -> Result<()> {
        super::super::worlds::validate_id(&self.world_id)?;
        valid_id(&self.progress_id, "INVALID_PROGRESS_ID")?;
        ensure!(self.revision > 0, "INVALID_PROGRESS_REVISION");
        self.build.validate()?;
        ensure!(self.state_schema_version > 0, "INVALID_STATE_SCHEMA");
        valid_hash(&self.content_hash, "INVALID_PROGRESS_HASH")?;
        Ok(())
    }
}

/// The host binds identity and old values. A model cannot switch target or
/// forge a receipt through this structure.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct OperationContext {
    pub operation_id: String,
    pub world_id: String,
    pub repo_id: String,
    pub branch_id: String,
    pub expected_head_oid: String,
    pub expected_applied_oid: String,
    pub expected_progress_revision: u64,
}

impl OperationContext {
    pub(super) fn validate(&self) -> Result<()> {
        super::super::workspaces::call_id(&self.operation_id)?;
        super::super::worlds::validate_id(&self.world_id)?;
        valid_id(&self.repo_id, "INVALID_REPO_ID")?;
        valid_label(&self.branch_id, "INVALID_BRANCH_ID")?;
        valid_commit_oid(&self.expected_head_oid)?;
        valid_commit_oid(&self.expected_applied_oid)?;
        Ok(())
    }
}

/// Indexed, previewable, base-checked and applied-to-source are separate
/// facts with separate evidence. One green label never means all four.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetState {
    pub indexed: bool,
    pub previewable: bool,
    pub base_checked: Option<Value>,
    pub applied_to_source: Option<Value>,
}

pub(super) fn valid_id(value: &str, code: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= MAX_ID_BYTES
            && value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.')),
        "{code}"
    );
    Ok(())
}

pub(super) fn valid_label(value: &str, code: &str) -> Result<()> {
    ensure!(
        !value.trim().is_empty()
            && value.len() <= MAX_PATH_BYTES
            && !value.chars().any(char::is_control),
        "{code}"
    );
    Ok(())
}

pub(super) fn valid_hash(value: &str, code: &str) -> Result<()> {
    ensure!(
        value.len() == 64
            && value
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
        "{code}"
    );
    Ok(())
}

pub(super) fn valid_commit_oid(value: &str) -> Result<()> {
    ensure!(
        (40..=64).contains(&value.len())
            && value
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
        "INVALID_COMMIT_OID"
    );
    Ok(())
}

pub(super) fn valid_version(version: u64) -> Result<()> {
    ensure!(
        version > 0 && version <= MAX_VERSION,
        "INVALID_ASSET_VERSION"
    );
    Ok(())
}

fn reserved_name(segment: &str) -> bool {
    let upper = segment
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (upper.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && matches!(upper.as_bytes()[3], b'1'..=b'9'))
}

/// Frozen path rule for `FileRef.path` and `AssetLockEntry.installPath`.
pub(super) fn valid_rel_path(path: &str) -> Result<()> {
    ensure!(
        !path.is_empty()
            && path.len() <= MAX_PATH_BYTES
            && !path.contains('\\')
            && !path.contains(':')
            && !path.starts_with('/')
            && path.split('/').count() <= 16
            && !path.chars().any(char::is_control),
        "INVALID_ASSET_PATH"
    );
    for segment in path.split('/') {
        ensure!(
            !segment.is_empty()
                && segment.len() <= 80
                && !segment.starts_with('.')
                && !segment.ends_with('.')
                && !segment.ends_with(' ')
                && !reserved_name(segment),
            "INVALID_ASSET_PATH"
        );
    }
    Ok(())
}

pub(super) fn valid_media_type(media_type: &str) -> Result<()> {
    ensure!(
        !media_type.is_empty()
            && media_type.len() <= 80
            && media_type
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'/' | b'+' | b'-' | b'.')),
        "INVALID_MEDIA_TYPE"
    );
    Ok(())
}

/// First-release format gate. Unsupported formats are reported, not promised.
pub(super) fn media_kind_of(media_type: &str) -> MediaKind {
    match media_type {
        "image/png" | "image/jpeg" => MediaKind::Image,
        "model/gltf-binary" => MediaKind::Model,
        "audio/wav" | "audio/ogg" => MediaKind::Audio,
        "application/x-godot-package" => MediaKind::Package,
        _ => MediaKind::Other,
    }
}

pub(super) fn supported_media_type(media_type: &str) -> bool {
    matches!(
        media_type,
        "image/png"
            | "image/jpeg"
            | "model/gltf-binary"
            | "audio/wav"
            | "audio/ogg"
            | "application/x-godot-package"
    )
}
