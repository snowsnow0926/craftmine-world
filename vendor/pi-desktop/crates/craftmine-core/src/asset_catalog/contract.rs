//! Asset-catalog-owned definitions only.
//!
//! The shared reference contract (`AssetRef`, `FileRef`, `ContentRef`,
//! `BuildRef`, `ProgressRef`, `OperationContext`, `AssetLock`) is defined once
//! in [`crate::content_history::contract`] (task M/R1). This module must never
//! redefine those shapes; it re-exports them and adds only the catalog's own
//! vocabulary: the CP0 seven content categories, media classification, query
//! scope, licence state, usage relation and the asset content manifest.
use anyhow::{bail, ensure, Result};
use serde::{Deserialize, Serialize};

pub(super) use crate::content_history::contract::{
    validate_identifier, validate_relative_path, validate_sha256, AssetLock, AssetLockEntry,
    AssetOverrideRef, AssetRef, FileRef, PATH_BYTE_LIMIT,
};

pub(super) const ASSET_CONTENT_FORMAT: &str = "craftmine.asset-content/1";
/// Identifier limit is shared with [`validate_identifier`].
pub(super) const MAX_ID_BYTES: usize = 120;
pub(super) const MAX_VERSION: u64 = 1_000_000;

/// CP0's seven creation-package categories.
///
/// The AL plan's four library types map onto these: `raw` -> `raw`,
/// `object` -> `object`, `creation` -> `module` or `scene`,
/// `world-template` -> `world`. One package has exactly one primary category.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum AssetKind {
    Base,
    World,
    Module,
    Object,
    Scene,
    Raw,
    Data,
}

impl AssetKind {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Base => "base",
            Self::World => "world",
            Self::Module => "module",
            Self::Object => "object",
            Self::Scene => "scene",
            Self::Raw => "raw",
            Self::Data => "data",
        }
    }

    pub(super) fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "base" => Self::Base,
            "world" => Self::World,
            "module" => Self::Module,
            "object" => Self::Object,
            "scene" => Self::Scene,
            "raw" => Self::Raw,
            "data" => Self::Data,
            // AL round-one names stay readable while the catalog migrates.
            "creation" => Self::Module,
            "world-template" => Self::World,
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

/// Usage relations block deletion. R1 owns the total reclamation plan; the
/// catalog records the references it must protect.
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

/// A stable `AssetRef` from catalog storage. CP0 fixes resource versions as
/// positive integers, so the decimal form is the shared reference version.
/// Consumed by the install/upgrade layer (R4) and by the catalog tests.
#[allow(dead_code)]
pub(super) fn asset_ref(asset_id: &str, version: u64, content_hash: &str) -> Result<AssetRef> {
    let reference = AssetRef {
        asset_id: asset_id.to_string(),
        version: version.to_string(),
        content_hash: content_hash.to_string(),
    };
    reference.validate()?;
    Ok(reference)
}

/// Catalog versions are positive integers; CP0 display names are separate.
pub(super) fn valid_version(version: u64) -> Result<()> {
    ensure!(
        version > 0 && version <= MAX_VERSION,
        "INVALID_ASSET_VERSION"
    );
    Ok(())
}

/// First-release format gate. Unsupported formats are reported, not promised.
pub(super) fn media_kind_of(media_type: &str) -> MediaKind {
    match media_type {
        "image/png" | "image/jpeg" => MediaKind::Image,
        "model/gltf-binary" => MediaKind::Model,
        "audio/wav" | "audio/ogg" => MediaKind::Audio,
        "application/x-godot-package" | "application/zip" => MediaKind::Package,
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
            | "application/zip"
    )
}
