//! AL0/AL1 budgets. Recommended values and measured values are recorded
//! separately; a documented recommendation is not a measured guarantee.
use anyhow::{ensure, Result};
use serde_json::Value;

use super::contract;

/// The legacy single-file limit this library replaces for player imports.
pub(super) const LEGACY_ASSET_BYTES: u64 = 512 * 1024;
/// Recommended player-import budget, separated per resource.
pub(super) const IMPORT_FILE_BYTES: u64 = 64 * 1024 * 1024;
pub(super) const IMPORT_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
pub(super) const IMPORT_FILES: usize = 4096;
pub(super) const IMPORT_CHUNK_BYTES: usize = 64 * 1024;
pub(super) const PREVIEW_PARALLEL: usize = 4;
pub(super) const PREVIEW_TIMEOUT_MS: u64 = 20_000;
pub(super) const SEARCH_LIMIT: usize = 100;
pub(super) const SEARCH_SCAN_LIMIT: usize = 20_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ImportLimits {
    pub file_bytes: u64,
    pub total_bytes: u64,
    pub files: usize,
}

impl Default for ImportLimits {
    fn default() -> Self {
        Self {
            file_bytes: IMPORT_FILE_BYTES,
            total_bytes: IMPORT_TOTAL_BYTES,
            files: IMPORT_FILES,
        }
    }
}

impl ImportLimits {
    /// A caller may lower the budget but never raise it above the frozen one.
    pub(super) fn from_args(value: &Value) -> Result<Self> {
        let mut limits = Self::default();
        if value.is_null() {
            return Ok(limits);
        }
        let object = value.as_object().ok_or_else(|| {
            anyhow::anyhow!("INVALID_IMPORT_BUDGET")
        })?;
        for key in object.keys() {
            ensure!(
                matches!(key.as_str(), "maxFileBytes" | "maxTotalBytes" | "maxFiles"),
                "UNKNOWN_FIELD"
            );
        }
        if let Some(raw) = object.get("maxFileBytes") {
            let value = raw
                .as_u64()
                .ok_or_else(|| anyhow::anyhow!("INVALID_IMPORT_BUDGET"))?;
            ensure!(value > 0 && value <= IMPORT_FILE_BYTES, "INVALID_IMPORT_BUDGET");
            limits.file_bytes = value;
        }
        if let Some(raw) = object.get("maxTotalBytes") {
            let value = raw
                .as_u64()
                .ok_or_else(|| anyhow::anyhow!("INVALID_IMPORT_BUDGET"))?;
            ensure!(
                value > 0 && value <= IMPORT_TOTAL_BYTES,
                "INVALID_IMPORT_BUDGET"
            );
            limits.total_bytes = value;
        }
        if let Some(raw) = object.get("maxFiles") {
            let value = raw
                .as_u64()
                .ok_or_else(|| anyhow::anyhow!("INVALID_IMPORT_BUDGET"))?;
            ensure!(
                value > 0 && value as usize <= IMPORT_FILES,
                "INVALID_IMPORT_BUDGET"
            );
            limits.files = value as usize;
        }
        Ok(limits)
    }

    pub(super) fn check_media(&self, media_type: &str) -> Result<()> {
        contract::valid_media_type(media_type)
    }
}
