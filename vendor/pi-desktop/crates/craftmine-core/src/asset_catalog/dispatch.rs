//! The asset catalog's RPC entry point.
//!
//! Ownership: `asset_catalog/**` belongs to task S5; the core binary's dispatch
//! table and `lib.rs` re-export belong to task S1. This module keeps every
//! asset method in the catalog's own files so the S1 wiring stays a two-line
//! hook:
//!
//! ```ignore
//! // lib.rs (S1)
//! pub use asset_catalog::dispatch as asset_catalog_dispatch;
//! // main.rs (S1), after `let params = request.get("params")...`
//! if let Some(result) = asset_catalog_dispatch(journal, method, params) {
//!     return result;
//! }
//! ```
//!
//! A method outside the catalog returns `None`, so the host falls through to
//! its own dispatch and `UNKNOWN_METHOD` behaviour is unchanged.
use anyhow::Result;
use serde_json::Value;

use crate::TaskJournal;

/// Dispatches one `asset.*` method. Returns `None` when the method does not
/// belong to the catalog.
pub fn dispatch(journal: &mut TaskJournal, method: &str, params: &Value) -> Option<Result<Value>> {
    Some(match method {
        "asset.import" => journal.asset_import(params),
        "asset.read" => journal.asset_read(params),
        "asset.versions" => journal.asset_versions(params),
        "asset.bodyPath" => journal.asset_body_path(params),
        "asset.search" => journal.asset_search(params),
        "asset.scan" => journal.asset_scan(params),
        "asset.annotate" => journal.asset_annotate(params),
        "asset.usage" => journal.asset_usage(params),
        "asset.recordUsage" => journal.asset_record_usage(params),
        "asset.previewBegin" => journal.asset_preview_begin(params),
        "asset.previewFinish" => journal.asset_preview_finish(params),
        "asset.previewRead" => journal.asset_preview_read(params),
        "asset.probe" => journal.asset_probe(params),
        "asset.recordCheck" => journal.asset_record_check(params),
        "asset.mapLegacy" => journal.asset_map_legacy(params),
        "asset.resolveLegacy" => journal.asset_resolve_legacy(params),
        "asset.reclaimPlan" => journal.asset_reclaim_plan(params),
        "asset.reclaimCommit" => journal.asset_reclaim_commit(params),
        _ => return None,
    })
}
