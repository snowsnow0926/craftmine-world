//! S5-side asset-body reclamation executor.
//!
//! The catalog never guesses which bodies are unused and never scans the blob
//! directory to decide. It publishes a read-only candidate plan built from the
//! AL5 deletion-protection table (`craftmine_asset_usage`) and it only deletes
//! entries that an approval list explicitly names. S1's total recycler owns the
//! approval policy (and S4 owns the backup pins); this module owns execution and
//! re-verifies every approved entry against durable rows immediately before
//! deleting it.
use std::collections::{BTreeMap, BTreeSet};

use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, TransactionBehavior};
use serde_json::{json, Value};

use crate::durable::{fields, number, text};
use crate::TaskJournal;

use super::contract;
use super::store;

pub(super) const RECLAIM_COMMIT_METHOD: &str = "asset.reclaimCommit";
/// Plan format shared with S1's total recycler. A changed shape is a new format.
pub(super) const RECLAIM_PLAN_FORMAT: &str = "craftmine.asset-reclaim-plan/1";
/// Who may approve entries. The catalog never approves its own plan.
pub(super) const RECLAIM_APPROVAL_SOURCE: &str = "S1 total recycler (pins from S4)";
/// One commit may not name more versions than a search can scan, so a hostile or
/// buggy approval list cannot turn into an unbounded delete loop.
const MAX_APPROVALS: usize = super::budget::SEARCH_SCAN_LIMIT;

struct Candidate {
    asset_id: String,
    version: u64,
    content_hash: String,
    bytes: u64,
    media_kind: String,
    /// Every file hash of the version, sorted. Duplicates are kept because the
    /// plan describes the files, not a set.
    sha256: Vec<String>,
}

impl Candidate {
    fn json(&self) -> Value {
        json!({
            "assetId": self.asset_id,
            "version": self.version,
            "contentHash": self.content_hash,
            "bytes": self.bytes,
            "sha256": self.sha256,
            "mediaKind": self.media_kind,
        })
    }
}

struct Approval {
    asset_id: String,
    version: u64,
    sha256: BTreeSet<String>,
}

/// Versions with no usage row are the only ones S1 may consider. Candidates and
/// every file hash come from durable rows; the filesystem is never consulted to
/// decide what is unused.
pub(super) fn plan(db: &Connection) -> Result<Value> {
    let mut statement = db.prepare(
        "SELECT v.asset_id,v.version,v.content_hash,v.bytes,v.media_kind
         FROM craftmine_asset_versions v
         WHERE NOT EXISTS(SELECT 1 FROM craftmine_asset_usage u
             WHERE u.asset_id=v.asset_id AND u.version=v.version)
         ORDER BY v.asset_id,v.version",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)? as u64,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)? as u64,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut files =
        db.prepare("SELECT sha256 FROM craftmine_asset_files WHERE asset_id=?1 AND version=?2")?;
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut total_bytes: u64 = 0;
    for row in rows {
        let (asset_id, version, content_hash, bytes, media_kind) = row?;
        let mut sha256: Vec<String> = files
            .query_map(params![asset_id, version as i64], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        sha256.sort();
        total_bytes = total_bytes
            .checked_add(bytes)
            .context("ASSET_RECLAIM_UNMEASURABLE")?;
        candidates.push(Candidate {
            asset_id,
            version,
            content_hash,
            bytes,
            media_kind,
            sha256,
        });
    }
    candidates.sort_by(|left, right| {
        left.asset_id
            .cmp(&right.asset_id)
            .then_with(|| left.version.cmp(&right.version))
    });
    let candidate_json: Vec<Value> = candidates.iter().map(Candidate::json).collect();
    let plan_hash = crate::digest(&serde_json::to_string(&json!({
        "format": RECLAIM_PLAN_FORMAT,
        "candidates": candidate_json,
    }))?);
    let plan_id = format!("arc-{}", &plan_hash[..16]);
    let protected_versions: i64 = db.query_row(
        "SELECT COUNT(*) FROM craftmine_asset_versions v WHERE EXISTS(
            SELECT 1 FROM craftmine_asset_usage u
            WHERE u.asset_id=v.asset_id AND u.version=v.version)",
        [],
        |row| row.get(0),
    )?;
    Ok(json!({
        "format": RECLAIM_PLAN_FORMAT,
        "planId": plan_id,
        "planHash": plan_hash,
        "candidates": candidate_json,
        "candidateCount": candidates.len(),
        "totalBytes": total_bytes,
        "protectedVersions": protected_versions,
        "requiresApprovalFrom": RECLAIM_APPROVAL_SOURCE,
    }))
}

fn approvals_of(value: &Value) -> Result<Vec<Approval>> {
    let list = value.as_array().context("approvals: ARRAY_REQUIRED")?;
    ensure!(list.len() <= MAX_APPROVALS, "ASSET_RECLAIM_TOO_MANY_APPROVALS");
    let mut approvals = Vec::with_capacity(list.len());
    for entry in list {
        fields(entry, &["assetId", "version", "sha256"])?;
        let asset_id = text(entry, "assetId", contract::MAX_ID_BYTES)?.to_string();
        let version = number(entry, "version", contract::MAX_VERSION)?;
        let hashes = entry["sha256"].as_array().context("sha256: ARRAY_REQUIRED")?;
        let mut sha256 = BTreeSet::new();
        for hash in hashes {
            let hash = hash.as_str().context("sha256: STRING_REQUIRED")?;
            contract::validate_sha256(hash)?;
            sha256.insert(hash.to_string());
        }
        ensure!(!sha256.is_empty(), "sha256: ARRAY_REQUIRED");
        approvals.push(Approval {
            asset_id,
            version,
            sha256,
        });
    }
    Ok(approvals)
}

impl TaskJournal {
    /// Read-only candidate plan for S1's total recycler. It measures capacity
    /// (`totalBytes`) and the protected set instead of inferring either from
    /// directory sizes.
    pub fn asset_reclaim_plan(&self, args: &Value) -> Result<Value> {
        fields(args, &[])?;
        plan(&self.db)
    }

    /// Executes an approval list. The plan is re-derived inside one immediate
    /// transaction, so a usage row added after the plan was handed out makes the
    /// call `ASSET_RECLAIM_PLAN_STALE` instead of deleting live data. Entries
    /// that are not named in `approvals` are never touched.
    pub fn asset_reclaim_commit(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &["operationId", "planId", "planHash", "approvals"],
        )?;
        let operation_id = text(args, "operationId", 240)?.to_string();
        let request_hash = crate::digest(&serde_json::to_string(args)?);
        if let Some(existing) = store::operation(
            &self.db,
            &operation_id,
            RECLAIM_COMMIT_METHOD,
            &request_hash,
        )? {
            return Ok(existing);
        }
        let plan_id = text(args, "planId", 240)?.to_string();
        let plan_hash = text(args, "planHash", 240)?.to_string();
        let approvals = approvals_of(&args["approvals"])?;

        let tx = rusqlite::Transaction::new_unchecked(&self.db, TransactionBehavior::Immediate)?;
        let current = plan(&tx)?;
        ensure!(
            current["planHash"].as_str() == Some(plan_hash.as_str())
                && current["planId"].as_str() == Some(plan_id.as_str()),
            "ASSET_RECLAIM_PLAN_STALE"
        );
        let mut candidates: BTreeMap<(String, u64), (u64, BTreeSet<String>)> = BTreeMap::new();
        for candidate in current["candidates"]
            .as_array()
            .context("INVALID_RECLAIM_PLAN")?
        {
            let asset_id = candidate["assetId"]
                .as_str()
                .context("INVALID_RECLAIM_PLAN")?
                .to_string();
            let version = candidate["version"]
                .as_u64()
                .context("INVALID_RECLAIM_PLAN")?;
            let bytes = candidate["bytes"].as_u64().context("INVALID_RECLAIM_PLAN")?;
            let sha256: BTreeSet<String> = candidate["sha256"]
                .as_array()
                .context("INVALID_RECLAIM_PLAN")?
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect();
            candidates.insert((asset_id, version), (bytes, sha256));
        }

        // Re-verify every approval before deleting anything: a protected version
        // is refused first, then the entry must be a candidate of the freshly
        // derived plan with exactly the version's real file hashes.
        let mut selected: BTreeMap<(String, u64), (u64, BTreeSet<String>)> = BTreeMap::new();
        for approval in &approvals {
            let protected: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM craftmine_asset_usage
                   WHERE asset_id=?1 AND version=?2)",
                params![approval.asset_id, approval.version as i64],
                |row| row.get(0),
            )?;
            ensure!(!protected, "ASSET_RECLAIM_PROTECTED");
            let key = (approval.asset_id.clone(), approval.version);
            let (bytes, actual) = candidates
                .get(&key)
                .context("ASSET_RECLAIM_NOT_APPROVED")?;
            ensure!(actual == &approval.sha256, "ASSET_RECLAIM_NOT_APPROVED");
            selected.insert(key, (*bytes, actual.clone()));
        }

        let mut reclaimed = Vec::new();
        let mut reclaimed_bytes: u64 = 0;
        let mut blob_hashes: BTreeSet<String> = BTreeSet::new();
        for ((asset_id, version), (bytes, sha256)) in &selected {
            tx.execute(
                "DELETE FROM craftmine_asset_files WHERE asset_id=?1 AND version=?2",
                params![asset_id, *version as i64],
            )?;
            tx.execute(
                "DELETE FROM craftmine_asset_versions WHERE asset_id=?1 AND version=?2",
                params![asset_id, *version as i64],
            )?;
            // Browsing metadata belongs to a logical asset, not a version; it
            // only goes away when no version of that asset remains.
            let remaining: i64 = tx.query_row(
                "SELECT COUNT(*) FROM craftmine_asset_versions WHERE asset_id=?1",
                [asset_id],
                |row| row.get(0),
            )?;
            if remaining == 0 {
                tx.execute(
                    "DELETE FROM craftmine_asset_metadata WHERE asset_id=?1",
                    [asset_id],
                )?;
            }
            blob_hashes.extend(sha256.iter().cloned());
            reclaimed_bytes = reclaimed_bytes
                .checked_add(*bytes)
                .context("ASSET_RECLAIM_UNMEASURABLE")?;
            reclaimed.push(json!({
                "assetId": asset_id,
                "version": version,
                "bytes": bytes,
            }));
        }

        // Accounting rows move inside the transaction; the body files are
        // removed after commit because the filesystem is not transactional. A
        // blob still referenced by any surviving version keeps both its row and
        // its file.
        let mut blobs_deleted = 0usize;
        for sha256 in &blob_hashes {
            if store::delete_unreferenced_blob_row(&tx, sha256)? {
                blobs_deleted += 1;
            }
        }
        let result = json!({
            "operationId": operation_id,
            "method": RECLAIM_COMMIT_METHOD,
            "planId": plan_id,
            "planHash": plan_hash,
            "reclaimed": reclaimed,
            "reclaimedBytes": reclaimed_bytes,
            "blobsDeleted": blobs_deleted,
            "replayed": false,
        });
        store::record_operation(
            &tx,
            &operation_id,
            RECLAIM_COMMIT_METHOD,
            &request_hash,
            &result,
            crate::worlds::timestamp()?,
        )?;
        tx.commit()?;

        if !blob_hashes.is_empty() {
            let blobs = store::blob_root(&self.directory, false)?;
            for sha256 in &blob_hashes {
                store::discard_blob(&self.db, &blobs, sha256)?;
            }
        }
        Ok(result)
    }
}
