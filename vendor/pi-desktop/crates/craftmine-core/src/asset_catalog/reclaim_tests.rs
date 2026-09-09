//! S5 reclamation tests: the executor deletes only entries an approval list
//! names, re-derives the plan, and re-verifies every hash before deleting.
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::Result;
use serde_json::{json, Value};

use super::store;
use crate::TaskJournal;

fn journal() -> Result<(tempfile::TempDir, PathBuf, TaskJournal)> {
    let (dir, path) = crate::godot_test_support::temp()?;
    let journal = TaskJournal::open(&path)?;
    Ok((dir, path, journal))
}

fn source_root(dir: &Path) -> Result<PathBuf> {
    let root = dir.join("player");
    std::fs::create_dir_all(&root)?;
    Ok(root)
}

/// A real PNG-shaped body; the importer only needs bytes plus a media type.
fn png(seed: u8, length: usize) -> Vec<u8> {
    let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
    for index in 0..length {
        bytes.push(seed.wrapping_add((index % 251) as u8));
    }
    bytes
}

fn import_png(
    journal: &mut TaskJournal,
    root: &Path,
    asset: &str,
    version: u64,
    name: &str,
    bytes: &[u8],
) -> Result<Value> {
    let file = root.join(format!("{name}.png"));
    std::fs::write(&file, bytes)?;
    journal.asset_import(&json!({
        "operationId": format!("op-{asset}-{version}"),
        "sourceRoot": root.to_string_lossy(),
        "sourcePath": file.to_string_lossy(),
        "assetId": asset,
        "version": version,
        "kind": "raw",
        "mediaKind": "image",
        "path": format!("textures/{name}.png"),
        "mediaType": "image/png",
        "displayName": name,
        "source": {
            "origin": "local",
            "author": "player",
            "license": "unknown",
            "licenseStatus": "unverified",
        },
        "tags": [],
    }))
}

fn sha_of(imported: &Value) -> String {
    imported["version_"]["files"][0]["sha256"]
        .as_str()
        .unwrap()
        .to_string()
}

fn approval(asset: &str, version: u64, sha256: &[String]) -> Value {
    json!({"assetId": asset, "version": version, "sha256": sha256})
}

fn blob_file(journal: &TaskJournal, sha256: &str) -> Result<PathBuf> {
    let blobs = store::blob_root(&journal.directory, false)?;
    store::blob_path(&blobs, sha256)
}

fn blob_row_exists(journal: &TaskJournal, sha256: &str) -> Result<bool> {
    Ok(journal.db.query_row(
        "SELECT EXISTS(SELECT 1 FROM craftmine_asset_blobs WHERE sha256=?1)",
        [sha256],
        |row| row.get(0),
    )?)
}

fn version_exists(journal: &TaskJournal, asset: &str, version: u64) -> Result<bool> {
    Ok(store::version_row(&journal.db, asset, version)?.is_some())
}

#[test]
fn reclaim_plan_lists_only_versions_without_usage_rows() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let unused = import_png(&mut journal, &root, "unused", 1, "unused", &png(1, 512))?;
    let used = import_png(&mut journal, &root, "used", 1, "used", &png(2, 512))?;
    journal.asset_record_usage(&json!({
        "assetId": "used",
        "version": 1,
        "refKind": "world-current",
        "refId": "world-1",
        "detail": "applied",
    }))?;

    let plan = journal.asset_reclaim_plan(&json!({}))?;
    assert_eq!(plan["format"], "craftmine.asset-reclaim-plan/1");
    assert_eq!(
        plan["requiresApprovalFrom"],
        "S1 total recycler (pins from S4)"
    );
    assert_eq!(plan["candidateCount"], 1);
    assert_eq!(plan["protectedVersions"], 1);
    let candidates = plan["candidates"].as_array().unwrap();
    assert_eq!(candidates.len(), 1);
    let candidate = &candidates[0];
    assert_eq!(candidate["assetId"], "unused");
    assert_eq!(candidate["version"], 1);
    assert_eq!(candidate["contentHash"], unused["contentHash"]);
    assert_eq!(candidate["bytes"], unused["bytes"]);
    assert_eq!(candidate["mediaKind"], "image");
    let sha = sha_of(&unused);
    assert_eq!(candidate["sha256"], json!([sha]));
    assert_eq!(plan["totalBytes"], unused["bytes"]);
    assert_eq!(plan["planId"].as_str().unwrap().len(), "arc-".len() + 16);
    // The hash is over the canonical `{format, candidates}` document, so S1 can
    // recompute it from the response without a private schema.
    let recomputed = crate::digest(&serde_json::to_string(&json!({
        "format": plan["format"],
        "candidates": plan["candidates"],
    }))?);
    assert_eq!(recomputed, plan["planHash"]);
    // A plan is read-only: both versions survive it.
    assert!(version_exists(&journal, "unused", 1)?);
    assert!(version_exists(&journal, "used", 1)?);
    assert_ne!(unused["contentHash"], used["contentHash"]);
    Ok(())
}

#[test]
fn reclaim_commit_refuses_a_stale_or_unknown_plan() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let imported = import_png(&mut journal, &root, "only", 1, "only", &png(3, 512))?;
    let sha = sha_of(&imported);
    let plan = journal.asset_reclaim_plan(&json!({}))?;

    let wrong_hash = journal
        .asset_reclaim_commit(&json!({
            "operationId": "op-stale-hash",
            "planId": plan["planId"],
            "planHash": "0".repeat(64),
            "approvals": [approval("only", 1, std::slice::from_ref(&sha))],
        }))
        .unwrap_err();
    assert!(
        wrong_hash.to_string().contains("ASSET_RECLAIM_PLAN_STALE"),
        "{wrong_hash}"
    );

    let wrong_id = journal
        .asset_reclaim_commit(&json!({
            "operationId": "op-stale-id",
            "planId": "arc-0000000000000000",
            "planHash": plan["planHash"],
            "approvals": [approval("only", 1, std::slice::from_ref(&sha))],
        }))
        .unwrap_err();
    assert!(
        wrong_id.to_string().contains("ASSET_RECLAIM_PLAN_STALE"),
        "{wrong_id}"
    );

    assert!(version_exists(&journal, "only", 1)?);
    assert!(blob_file(&journal, &sha)?.is_file());
    Ok(())
}

#[test]
fn reclaim_commit_deletes_only_approved_versions() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let keep = import_png(&mut journal, &root, "keep", 1, "keep", &png(4, 512))?;
    let drop = import_png(&mut journal, &root, "drop", 1, "drop", &png(5, 512))?;
    let keep_sha = sha_of(&keep);
    let drop_sha = sha_of(&drop);
    let plan = journal.asset_reclaim_plan(&json!({}))?;
    assert_eq!(plan["candidateCount"], 2);

    let result = journal.asset_reclaim_commit(&json!({
        "operationId": "op-subset",
        "planId": plan["planId"],
        "planHash": plan["planHash"],
        "approvals": [approval("drop", 1, std::slice::from_ref(&drop_sha))],
    }))?;
    assert_eq!(result["reclaimed"].as_array().unwrap().len(), 1);
    assert_eq!(result["reclaimed"][0]["assetId"], "drop");
    assert_eq!(result["reclaimed"][0]["version"], 1);
    assert_eq!(result["reclaimedBytes"], drop["bytes"]);
    assert_eq!(result["blobsDeleted"], 1);
    assert_eq!(result["replayed"], false);

    assert!(!version_exists(&journal, "drop", 1)?);
    assert!(!blob_file(&journal, &drop_sha)?.exists());
    assert!(version_exists(&journal, "keep", 1)?);
    assert!(blob_file(&journal, &keep_sha)?.is_file());
    let kept = journal.asset_read(&json!({"assetId": "keep", "version": 1}))?;
    assert_eq!(kept["version_"]["contentHash"], keep["contentHash"]);
    Ok(())
}

#[test]
fn reclaim_commit_never_deletes_a_protected_version() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let protected = import_png(&mut journal, &root, "protected", 1, "protected", &png(6, 512))?;
    journal.asset_record_usage(&json!({
        "assetId": "protected",
        "version": 1,
        "refKind": "world-current",
        "refId": "world-1",
        "detail": "applied",
    }))?;
    let sha = sha_of(&protected);
    let plan = journal.asset_reclaim_plan(&json!({}))?;
    assert_eq!(plan["candidateCount"], 0);
    assert_eq!(plan["protectedVersions"], 1);

    let error = journal
        .asset_reclaim_commit(&json!({
            "operationId": "op-protected",
            "planId": plan["planId"],
            "planHash": plan["planHash"],
            "approvals": [approval("protected", 1, std::slice::from_ref(&sha))],
        }))
        .unwrap_err();
    assert!(
        error.to_string().contains("ASSET_RECLAIM_PROTECTED"),
        "{error}"
    );

    assert!(version_exists(&journal, "protected", 1)?);
    assert!(blob_file(&journal, &sha)?.is_file());
    assert!(blob_row_exists(&journal, &sha)?);
    Ok(())
}

#[test]
fn reclaim_commit_removes_rows_and_blob_then_replays() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let solo = import_png(&mut journal, &root, "solo", 1, "solo", &png(7, 1024))?;
    let other = import_png(&mut journal, &root, "other", 1, "other", &png(8, 1024))?;
    let solo_sha = sha_of(&solo);
    let other_sha = sha_of(&other);
    journal.asset_annotate(&json!({
        "operationId": "op-annotate",
        "assetId": "solo",
        "displayName": "Solo",
        "tags": ["a"],
    }))?;
    assert!(blob_file(&journal, &solo_sha)?.is_file());

    let plan = journal.asset_reclaim_plan(&json!({}))?;
    let args = json!({
        "operationId": "op-reclaim",
        "planId": plan["planId"],
        "planHash": plan["planHash"],
        "approvals": [approval("solo", 1, std::slice::from_ref(&solo_sha))],
    });
    let first = journal.asset_reclaim_commit(&args)?;
    assert_eq!(first["method"], "asset.reclaimCommit");
    assert_eq!(first["replayed"], false);
    assert_eq!(first["reclaimedBytes"], solo["bytes"]);
    assert_eq!(first["blobsDeleted"], 1);
    assert!(!version_exists(&journal, "solo", 1)?);
    assert!(store::files_of(&journal.db, "solo", 1)?.is_empty());
    assert!(!blob_file(&journal, &solo_sha)?.exists());
    assert!(!blob_row_exists(&journal, &solo_sha)?);
    // Browsing metadata only goes away when the asset has no version left.
    let metadata: i64 = journal.db.query_row(
        "SELECT COUNT(*) FROM craftmine_asset_metadata WHERE asset_id='solo'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(metadata, 0);

    let second = journal.asset_reclaim_commit(&args)?;
    assert_eq!(second["replayed"], true);
    assert_eq!(second["reclaimed"], first["reclaimed"]);
    assert_eq!(second["reclaimedBytes"], first["reclaimedBytes"]);
    assert_eq!(second["blobsDeleted"], first["blobsDeleted"]);
    assert!(!blob_file(&journal, &solo_sha)?.exists());
    assert!(version_exists(&journal, "other", 1)?);
    assert!(blob_file(&journal, &other_sha)?.is_file());
    Ok(())
}

#[test]
fn reclaim_commit_refuses_unapproved_and_mismatched_entries() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let imported = import_png(&mut journal, &root, "only", 1, "only", &png(9, 512))?;
    let sha = sha_of(&imported);
    let plan = journal.asset_reclaim_plan(&json!({}))?;

    let mismatched = journal
        .asset_reclaim_commit(&json!({
            "operationId": "op-mismatch",
            "planId": plan["planId"],
            "planHash": plan["planHash"],
            "approvals": [approval("only", 1, &["a".repeat(64)])],
        }))
        .unwrap_err();
    assert!(
        mismatched.to_string().contains("ASSET_RECLAIM_NOT_APPROVED"),
        "{mismatched}"
    );

    let unapproved = journal
        .asset_reclaim_commit(&json!({
            "operationId": "op-unapproved",
            "planId": plan["planId"],
            "planHash": plan["planHash"],
            "approvals": [approval("ghost", 1, std::slice::from_ref(&sha))],
        }))
        .unwrap_err();
    assert!(
        unapproved.to_string().contains("ASSET_RECLAIM_NOT_APPROVED"),
        "{unapproved}"
    );

    assert!(version_exists(&journal, "only", 1)?);
    assert!(blob_file(&journal, &sha)?.is_file());
    assert!(blob_row_exists(&journal, &sha)?);
    Ok(())
}

#[test]
fn reclaim_plan_measures_capacity_within_a_generous_bound() -> Result<()> {
    let (dir, _path, mut journal) = journal()?;
    let root = source_root(dir.path())?;
    let mut expected_bytes: u64 = 0;
    for index in 0..5u8 {
        let name = format!("bulk-{index}");
        let imported = import_png(&mut journal, &root, &name, 1, &name, &png(index + 10, 2048))?;
        expected_bytes += imported["bytes"].as_u64().unwrap();
    }

    let started = Instant::now();
    let plan = journal.asset_reclaim_plan(&json!({}))?;
    let elapsed = started.elapsed();
    println!(
        "asset.reclaimPlan: {} candidates, {} bytes in {} ms",
        plan["candidateCount"],
        plan["totalBytes"],
        elapsed.as_millis()
    );
    assert_eq!(plan["candidateCount"], 5);
    assert_eq!(plan["totalBytes"], expected_bytes);
    assert!(
        elapsed.as_millis() < 2000,
        "plan took {} ms",
        elapsed.as_millis()
    );
    Ok(())
}
