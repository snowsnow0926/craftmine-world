//! AL1 streaming import, immutable versions, legacy mapping and body access.
use std::path::Path;

use anyhow::{ensure, Context, Result};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

use crate::durable::{fields, number, text};
use crate::TaskJournal;

use super::budget::ImportLimits;
use super::contract::{self, AssetKind, FileRef, LicenseStatus, MediaKind};
use super::store::{self, VersionRow};

pub(super) const IMPORT_METHOD: &str = "asset.import";
pub(super) const MAP_LEGACY_METHOD: &str = "asset.mapLegacy";

struct Source {
    origin: String,
    author: String,
    license: String,
    license_status: String,
}

fn source_of(value: &Value) -> Result<Source> {
    let object = value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("INVALID_ASSET_SOURCE"))?;
    for key in object.keys() {
        ensure!(
            matches!(key.as_str(), "origin" | "author" | "license" | "licenseStatus"),
            "UNKNOWN_FIELD"
        );
    }
    Ok(Source {
        origin: text(value, "origin", 120)?.to_string(),
        author: text(value, "author", 120)?.to_string(),
        license: text(value, "license", 200)?.to_string(),
        license_status: LicenseStatus::parse(
            value["licenseStatus"]
                .as_str()
                .context("licenseStatus: STRING_REQUIRED")?,
        )?
        .as_str()
        .to_string(),
    })
}

fn tags_of(value: &Value) -> Result<Vec<String>> {
    if value.is_null() {
        return Ok(Vec::new());
    }
    let list = value
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("INVALID_ASSET_TAGS"))?;
    ensure!(list.len() <= 32, "INVALID_ASSET_TAGS");
    let mut tags = Vec::with_capacity(list.len());
    for entry in list {
        let tag = entry
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("INVALID_ASSET_TAGS"))?;
        ensure!(
            !tag.trim().is_empty() && tag.len() <= 40 && !tag.chars().any(char::is_control),
            "INVALID_ASSET_TAGS"
        );
        tags.push(tag.to_string());
    }
    tags.sort();
    tags.dedup();
    Ok(tags)
}

fn files_json(files: &[FileRef]) -> Value {
    Value::Array(
        files
            .iter()
            .map(|file| {
                json!({
                    "path": file.path,
                    "sha256": file.sha256,
                    "bytes": file.bytes,
                    "mediaType": file.media_type,
                })
            })
            .collect(),
    )
}

fn version_json(row: &VersionRow, files: &[FileRef]) -> Value {
    json!({
        "assetId": row.asset_id,
        "version": row.version,
        "kind": row.kind,
        "mediaKind": row.media_kind,
        "contentHash": row.content_hash,
        "displayName": row.display_name,
        "bytes": row.bytes,
        "fileCount": row.file_count,
        "source": {
            "origin": row.origin,
            "author": row.author,
            "license": row.license,
            "licenseStatus": row.license_status,
        },
        "createdAt": row.created_at,
        "files": files_json(files),
    })
}

fn previewable(db: &rusqlite::Connection, asset_id: &str, content_hash: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM craftmine_asset_previews
           WHERE asset_id=?1 AND content_hash=?2 AND status IN ('ok','partial'))",
        params![asset_id, content_hash],
        |row| row.get(0),
    )?)
}

fn state_json(db: &rusqlite::Connection, row: &VersionRow) -> Result<Value> {
    Ok(json!({
        "indexed": true,
        "previewable": previewable(db, &row.asset_id, &row.content_hash)?,
        "baseChecked": super::preview::check_json(db, &row.asset_id, row.version, &row.content_hash)?,
        "appliedToSource": super::index::applied_json(db, &row.asset_id, row.version)?,
    }))
}

impl TaskJournal {
    /// Streams one authorized player file into the library as one immutable
    /// version. The same operation id always returns the same result; the same
    /// version with different content is refused.
    pub fn asset_import(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "operationId",
                "sourceRoot",
                "sourcePath",
                "assetId",
                "version",
                "kind",
                "mediaKind",
                "path",
                "mediaType",
                "displayName",
                "source",
                "tags",
                "budget",
            ],
        )?;
        let operation_id = text(args, "operationId", 240)?.to_string();
        let request_hash = crate::digest(&serde_json::to_string(args)?);
        if let Some(existing) =
            store::operation(&self.db, &operation_id, IMPORT_METHOD, &request_hash)?
        {
            return Ok(existing);
        }
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?.to_string();
        contract::valid_id(&asset_id, "INVALID_ASSET_ID")?;
        let version = number(args, "version", contract::MAX_VERSION)?;
        contract::valid_version(version)?;
        let kind = AssetKind::parse(args["kind"].as_str().context("kind: STRING_REQUIRED")?)?;
        let media_kind =
            MediaKind::parse(args["mediaKind"].as_str().context("mediaKind: STRING_REQUIRED")?)?;
        let media_type = text(args, "mediaType", 80)?.to_string();
        ensure!(
            contract::supported_media_type(&media_type),
            "UNSUPPORTED_MEDIA_TYPE"
        );
        ensure!(
            contract::media_kind_of(&media_type) == media_kind,
            "MEDIA_KIND_MISMATCH"
        );
        let path = text(args, "path", contract::MAX_PATH_BYTES)?.to_string();
        contract::valid_rel_path(&path)?;
        let display_name = text(args, "displayName", 200)?.to_string();
        let source = source_of(&args["source"])?;
        let tags = tags_of(&args["tags"])?;
        let limits = ImportLimits::from_args(&args["budget"])?;

        let root = std::fs::canonicalize(text(args, "sourceRoot", 4096)?)
            .context("ASSET_SOURCE_UNAVAILABLE")?;
        let file = std::fs::canonicalize(text(args, "sourcePath", 4096)?)
            .context("ASSET_SOURCE_UNAVAILABLE")?;
        ensure!(
            file.starts_with(&root) && file != root,
            "ASSET_SOURCE_OUTSIDE_ROOT"
        );

        let blobs = store::blob_root(&self.directory, true)?;
        let streamed = store::stream_blob(&blobs, &file, &limits)?;
        let files = vec![FileRef {
            path: path.clone(),
            sha256: streamed.sha256.clone(),
            bytes: streamed.bytes,
            media_type: media_type.clone(),
        }];
        let content_hash = store::content_hash(&files)?;

        if let Some(existing) = store::version_row(&self.db, &asset_id, version)? {
            ensure!(
                existing.content_hash == content_hash,
                "ASSET_VERSION_CONFLICT"
            );
            let existing_files = store::files_of(&self.db, &asset_id, version)?;
            return Ok(json!({
                "operationId": operation_id,
                "method": IMPORT_METHOD,
                "assetId": asset_id,
                "version": version,
                "contentHash": content_hash,
                "bytes": existing.bytes,
                "fileCount": existing.file_count,
                "deduplicated": streamed.deduplicated,
                "replayed": false,
                "existing": true,
                "preview": {"state": "cached"},
                "version_": version_json(&existing, &existing_files),
                "state": state_json(&self.db, &existing)?,
            }));
        }

        let created_at = crate::worlds::timestamp()?;
        let row = VersionRow {
            asset_id: asset_id.clone(),
            version,
            kind: kind.as_str().to_string(),
            content_hash: content_hash.clone(),
            display_name: display_name.clone(),
            media_kind: media_kind.as_str().to_string(),
            bytes: streamed.bytes,
            file_count: files.len() as u64,
            origin: source.origin.clone(),
            author: source.author.clone(),
            license: source.license.clone(),
            license_status: source.license_status.clone(),
            created_at,
        };
        let result = json!({
            "operationId": operation_id,
            "method": IMPORT_METHOD,
            "assetId": asset_id,
            "version": version,
            "kind": kind.as_str(),
            "mediaKind": media_kind.as_str(),
            "contentHash": content_hash,
            "bytes": streamed.bytes,
            "fileCount": files.len(),
            "deduplicated": streamed.deduplicated,
            "replayed": false,
            "existing": false,
            "preview": {"state": "pending"},
            "version_": version_json(&row, &files),
            "state": {"indexed": true, "previewable": false, "baseChecked": null, "appliedToSource": null},
        });

        let tx = rusqlite::Transaction::new_unchecked(&self.db, TransactionBehavior::Immediate)?;
        store::record_blob(
            &tx,
            &streamed.sha256,
            streamed.bytes,
            media_kind.as_str(),
            created_at,
        )?;
        store::insert_version(&tx, &row, &files)?;
        if !tags.is_empty() {
            tx.execute(
                "INSERT OR IGNORE INTO craftmine_asset_metadata(asset_id,display_name,tags,favorite,notes,updated_at)
                 VALUES(?1,NULL,?2,0,'',?3)",
                params![asset_id, serde_json::to_string(&tags)?, created_at],
            )?;
        }
        store::record_operation(
            &tx,
            &operation_id,
            IMPORT_METHOD,
            &request_hash,
            &result,
            created_at,
        )?;
        tx.commit()?;
        Ok(result)
    }

    /// Reads one immutable version record plus its separated state facts.
    pub fn asset_read(&self, args: &Value) -> Result<Value> {
        fields(args, &["assetId", "version"])?;
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?;
        let version = number(args, "version", contract::MAX_VERSION)?;
        let row = store::version_row(&self.db, asset_id, version)?.context("ASSET_NOT_FOUND")?;
        let files = store::files_of(&self.db, asset_id, version)?;
        Ok(json!({
            "version_": version_json(&row, &files),
            "state": state_json(&self.db, &row)?,
        }))
    }

    /// Lists every immutable version of one logical asset, newest first.
    pub fn asset_versions(&self, args: &Value) -> Result<Value> {
        fields(args, &["assetId", "offset", "limit"])?;
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?;
        let offset = number(args, "offset", 10_000)?;
        let limit = number(args, "limit", 100)?.max(1);
        let mut statement = self.db.prepare(
            "SELECT version FROM craftmine_asset_versions WHERE asset_id=?1
             ORDER BY version DESC LIMIT ?2 OFFSET ?3",
        )?;
        let rows = statement.query_map(
            params![asset_id, limit as i64, offset as i64],
            |row| row.get::<_, i64>(0),
        )?;
        let mut items = Vec::new();
        for row in rows {
            let version = row? as u64;
            let version_row =
                store::version_row(&self.db, asset_id, version)?.context("ASSET_NOT_FOUND")?;
            let files = store::files_of(&self.db, asset_id, version)?;
            items.push(json!({
                "version_": version_json(&version_row, &files),
                "state": state_json(&self.db, &version_row)?,
            }));
        }
        let total: i64 = self.db.query_row(
            "SELECT COUNT(*) FROM craftmine_asset_versions WHERE asset_id=?1",
            [asset_id],
            |row| row.get(0),
        )?;
        Ok(json!({
            "assetId": asset_id,
            "items": items,
            "total": total,
            "nextOffset": if (offset as i64) + (limit as i64) < total { Some(offset + limit) } else { None },
        }))
    }

    /// Host-side body access. Returns the absolute blob path and hashes so a
    /// large body never travels through chat as base64.
    pub fn asset_body_path(&self, args: &Value) -> Result<Value> {
        fields(args, &["assetId", "version", "path"])?;
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?;
        let version = number(args, "version", contract::MAX_VERSION)?;
        let path = text(args, "path", contract::MAX_PATH_BYTES)?;
        store::version_row(&self.db, asset_id, version)?.context("ASSET_NOT_FOUND")?;
        let file = store::files_of(&self.db, asset_id, version)?
            .into_iter()
            .find(|file| file.path == path)
            .context("ASSET_FILE_NOT_FOUND")?;
        let blobs = store::blob_root(&self.directory, false)?;
        let path_on_disk = store::blob_path(&blobs, &file.sha256)?;
        store::verify_blob(&path_on_disk, &file.sha256, file.bytes)?;
        Ok(json!({
            "assetId": asset_id,
            "version": version,
            "path": file.path,
            "sha256": file.sha256,
            "bytes": file.bytes,
            "mediaType": file.media_type,
            "blobPath": path_on_disk.to_string_lossy(),
        }))
    }

    /// Registers the mapping from a legacy `asset id/version/hash` record to a
    /// new immutable version without rewriting the old bundle.
    pub fn asset_map_legacy(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "operationId",
                "legacyKind",
                "legacyId",
                "legacyVersion",
                "assetId",
                "version",
                "detail",
            ],
        )?;
        let operation_id = text(args, "operationId", 240)?.to_string();
        let request_hash = crate::digest(&serde_json::to_string(args)?);
        if let Some(existing) =
            store::operation(&self.db, &operation_id, MAP_LEGACY_METHOD, &request_hash)?
        {
            return Ok(existing);
        }
        let legacy_kind = text(args, "legacyKind", 40)?.to_string();
        let legacy_id = text(args, "legacyId", 120)?.to_string();
        let legacy_version = text(args, "legacyVersion", 80)?.to_string();
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?.to_string();
        let version = number(args, "version", contract::MAX_VERSION)?;
        let detail = text(args, "detail", 240)?.to_string();
        let row = store::version_row(&self.db, &asset_id, version)?.context("ASSET_NOT_FOUND")?;
        let created_at = crate::worlds::timestamp()?;
        let result = json!({
            "operationId": operation_id,
            "method": MAP_LEGACY_METHOD,
            "legacy": {"kind": legacy_kind, "id": legacy_id, "version": legacy_version},
            "assetId": asset_id,
            "version": version,
            "contentHash": row.content_hash,
            "replayed": false,
        });
        let tx = rusqlite::Transaction::new_unchecked(&self.db, TransactionBehavior::Immediate)?;
        let existing: Option<(String, i64)> = tx
            .query_row(
                "SELECT asset_id,version FROM craftmine_asset_legacy_map
                 WHERE legacy_kind=?1 AND legacy_id=?2 AND legacy_version=?3",
                params![legacy_kind, legacy_id, legacy_version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((mapped_asset, mapped_version)) = existing {
            ensure!(
                mapped_asset == asset_id && mapped_version == version as i64,
                "LEGACY_MAPPING_CONFLICT"
            );
        } else {
            tx.execute(
                "INSERT INTO craftmine_asset_legacy_map(legacy_kind,legacy_id,legacy_version,
                    asset_id,version,detail,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![
                    legacy_kind,
                    legacy_id,
                    legacy_version,
                    asset_id,
                    version as i64,
                    detail,
                    created_at
                ],
            )?;
        }
        store::record_operation(
            &tx,
            &operation_id,
            MAP_LEGACY_METHOD,
            &request_hash,
            &result,
            created_at,
        )?;
        tx.commit()?;
        Ok(result)
    }

    pub fn asset_resolve_legacy(&self, args: &Value) -> Result<Value> {
        fields(args, &["legacyKind", "legacyId", "legacyVersion"])?;
        let legacy_kind = text(args, "legacyKind", 40)?;
        let legacy_id = text(args, "legacyId", 120)?;
        let legacy_version = text(args, "legacyVersion", 80)?;
        let mapped: Option<(String, i64, String)> = self
            .db
            .query_row(
                "SELECT m.asset_id,m.version,v.content_hash FROM craftmine_asset_legacy_map m
                 JOIN craftmine_asset_versions v ON v.asset_id=m.asset_id AND v.version=m.version
                 WHERE m.legacy_kind=?1 AND m.legacy_id=?2 AND m.legacy_version=?3",
                params![legacy_kind, legacy_id, legacy_version],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        Ok(match mapped {
            Some((asset_id, version, content_hash)) => json!({
                "mapped": true,
                "assetId": asset_id,
                "version": version,
                "contentHash": content_hash,
            }),
            None => json!({"mapped": false}),
        })
    }

    pub(super) fn blob_directory(&self, create: bool) -> Result<std::path::PathBuf> {
        store::blob_root(Path::new(&self.directory), create)
    }
}
