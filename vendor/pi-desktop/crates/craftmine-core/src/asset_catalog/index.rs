//! AL2 classification, search, tags and usage relations.
//!
//! Browsing metadata is mutable and stored apart from immutable version rows,
//! so renaming an asset can never change what a world runs. The index is a
//! rebuildable projection over the version tables, not a second source of
//! truth.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

use crate::durable::{fields, number, text};
use crate::TaskJournal;

use super::budget::SEARCH_SCAN_LIMIT;
use super::contract::{self, MediaKind, QueryScope, UsageKind};
use super::store::{self, VersionRow};

const SEARCH_METHOD: &str = "asset.search";

pub(super) fn applied_json(db: &Connection, asset_id: &str, version: u64) -> Result<Value> {
    let applied: Option<(String, String)> = db
        .query_row(
            "SELECT ref_id,detail FROM craftmine_asset_usage
             WHERE asset_id=?1 AND version=?2 AND ref_kind='world-current'
             ORDER BY ref_id LIMIT 1",
            params![asset_id, version as i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(match applied {
        Some((world_id, detail)) => json!({"worldId": world_id, "detail": detail}),
        None => Value::Null,
    })
}

struct Candidate {
    row: VersionRow,
    name: String,
    tags: Vec<String>,
    favorite: bool,
    notes: String,
    imported: bool,
}

fn candidates(db: &Connection) -> Result<Vec<Candidate>> {
    let mut statement = db.prepare(
        "SELECT v.asset_id,v.version,v.kind,v.content_hash,v.display_name,v.media_kind,v.bytes,
                v.file_count,v.origin,v.author,v.license,v.license_status,v.created_at,
                m.display_name,m.tags,m.favorite,m.notes,
                EXISTS(SELECT 1 FROM craftmine_asset_legacy_map l WHERE l.asset_id=v.asset_id AND l.version=v.version)
         FROM craftmine_asset_versions v
         LEFT JOIN craftmine_asset_metadata m ON m.asset_id=v.asset_id
         ORDER BY v.asset_id, v.version DESC LIMIT ?1",
    )?;
    let rows = statement.query_map([SEARCH_SCAN_LIMIT as i64], |row| {
        Ok((
            VersionRow {
                asset_id: row.get(0)?,
                version: row.get::<_, i64>(1)? as u64,
                kind: row.get(2)?,
                content_hash: row.get(3)?,
                display_name: row.get(4)?,
                media_kind: row.get(5)?,
                bytes: row.get::<_, i64>(6)? as u64,
                file_count: row.get::<_, i64>(7)? as u64,
                origin: row.get(8)?,
                author: row.get(9)?,
                license: row.get(10)?,
                license_status: row.get(11)?,
                created_at: row.get(12)?,
            },
            row.get::<_, Option<String>>(13)?,
            row.get::<_, Option<String>>(14)?,
            row.get::<_, Option<i64>>(15)?,
            row.get::<_, Option<String>>(16)?,
            row.get::<_, i64>(17)? == 1,
        ))
    })?;
    let mut result = Vec::new();
    for row in rows {
        let (row, metadata_name, tags, favorite, notes, imported) = row?;
        let name = metadata_name.unwrap_or_else(|| row.display_name.clone());
        let tags: Vec<String> = tags
            .as_deref()
            .map(|text| serde_json::from_str(text).unwrap_or_default())
            .unwrap_or_default();
        result.push(Candidate {
            row,
            name,
            tags,
            favorite: favorite.unwrap_or(0) == 1,
            notes: notes.unwrap_or_default(),
            imported,
        });
    }
    Ok(result)
}

fn matches_text(candidate: &Candidate, query: &str) -> bool {
    let needle = query.to_lowercase();
    candidate.name.to_lowercase().contains(&needle)
        || candidate.row.asset_id.to_lowercase().contains(&needle)
        || candidate.notes.to_lowercase().contains(&needle)
        || candidate
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(&needle))
}

fn item_json(db: &Connection, candidate: &Candidate) -> Result<Value> {
    Ok(json!({
        "assetId": candidate.row.asset_id,
        "version": candidate.row.version,
        "kind": candidate.row.kind,
        "mediaKind": candidate.row.media_kind,
        "contentHash": candidate.row.content_hash,
        "displayName": candidate.name,
        "tags": candidate.tags,
        "favorite": candidate.favorite,
        "bytes": candidate.row.bytes,
        "fileCount": candidate.row.file_count,
        "source": {
            "origin": candidate.row.origin,
            "author": candidate.row.author,
            "license": candidate.row.license,
            "licenseStatus": candidate.row.license_status,
        },
        "createdAt": candidate.row.created_at,
        "state": {
            "indexed": true,
            "previewable": db.query_row(
                "SELECT EXISTS(SELECT 1 FROM craftmine_asset_previews
                   WHERE asset_id=?1 AND content_hash=?2 AND status IN ('ok','partial'))",
                params![candidate.row.asset_id, candidate.row.content_hash],
                |row| row.get::<_, bool>(0),
            )?,
            "baseChecked": super::preview::check_json(db, &candidate.row.asset_id, candidate.row.version, &candidate.row.content_hash)?,
            "appliedToSource": applied_json(db, &candidate.row.asset_id, candidate.row.version)?,
        },
    }))
}

impl TaskJournal {
    pub fn asset_search(&self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "query",
                "kind",
                "mediaKind",
                "tags",
                "scope",
                "worldId",
                "favoritesOnly",
                "latestOnly",
                "offset",
                "limit",
            ],
        )?;
        let query = args["query"].as_str().unwrap_or("").to_string();
        ensure!(query.len() <= 120, "INVALID_SEARCH_QUERY");
        let kind = match args["kind"].as_str() {
            None | Some("") => None,
            Some(value) => Some(contract::AssetKind::parse(value)?),
        };
        let media_kind = match args["mediaKind"].as_str() {
            None | Some("") => None,
            Some(value) => Some(MediaKind::parse(value)?),
        };
        let scope = QueryScope::parse(args["scope"].as_str().context("scope: STRING_REQUIRED")?)?;
        let world_id = args["worldId"].as_str().unwrap_or("").to_string();
        if scope == QueryScope::CurrentWorld {
            ensure!(!world_id.is_empty(), "WORLD_ID_REQUIRED");
            crate::worlds::validate_id(&world_id)?;
        }
        let mut wanted_tags: Vec<String> = Vec::new();
        if let Some(list) = args["tags"].as_array() {
            ensure!(list.len() <= 32, "INVALID_ASSET_TAGS");
            for entry in list {
                let tag = entry
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("INVALID_ASSET_TAGS"))?;
                wanted_tags.push(tag.to_lowercase());
            }
        }
        let favorites_only = args["favoritesOnly"].as_bool().unwrap_or(false);
        let latest_only = args["latestOnly"].as_bool().unwrap_or(true);
        let offset = number(args, "offset", 10_000)?;
        let limit = number(args, "limit", super::budget::SEARCH_LIMIT as u64)?.max(1);

        let mut selected: Vec<Candidate> = Vec::new();
        let mut seen_assets: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for candidate in candidates(&self.db)? {
            if let Some(kind) = kind {
                if candidate.row.kind != kind.as_str() {
                    continue;
                }
            }
            if let Some(media_kind) = media_kind {
                if candidate.row.media_kind != media_kind.as_str() {
                    continue;
                }
            }
            if favorites_only && !candidate.favorite {
                continue;
            }
            if !wanted_tags
                .iter()
                .all(|wanted| candidate.tags.iter().any(|tag| tag.to_lowercase() == *wanted))
            {
                continue;
            }
            if !query.is_empty() && !matches_text(&candidate, &query) {
                continue;
            }
            match scope {
                QueryScope::LocalLibrary => {}
                QueryScope::ImportSource => {
                    if candidate.row.origin == "local" && !candidate.imported {
                        continue;
                    }
                }
                QueryScope::CurrentWorld => {
                    let used: bool = self.db.query_row(
                        "SELECT EXISTS(SELECT 1 FROM craftmine_asset_usage
                           WHERE asset_id=?1 AND version=?2 AND ref_kind='world-current' AND ref_id=?3)",
                        params![candidate.row.asset_id, candidate.row.version as i64, world_id],
                        |row| row.get(0),
                    )?;
                    if !used {
                        continue;
                    }
                }
            }
            if latest_only && !seen_assets.insert(candidate.row.asset_id.clone()) {
                continue;
            }
            selected.push(candidate);
        }
        selected.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.row.asset_id.cmp(&right.row.asset_id))
                .then_with(|| right.row.version.cmp(&left.row.version))
        });
        let total = selected.len();
        let mut items = Vec::new();
        for candidate in selected
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
        {
            items.push(item_json(&self.db, &candidate)?);
        }
        let indexed: i64 = self
            .db
            .query_row("SELECT COUNT(*) FROM craftmine_asset_versions", [], |row| {
                row.get(0)
            })?;
        Ok(json!({
            "method": SEARCH_METHOD,
            "scope": args["scope"],
            "items": items,
            "total": total,
            "truncated": indexed as usize > super::budget::SEARCH_SCAN_LIMIT,
            "nextOffset": if (offset as usize) + (limit as usize) < total { Some(offset + limit) } else { None },
        }))
    }

    /// Mutable browsing metadata only. Content hashes and version rows are not
    /// touched, so a rename never changes a running world.
    pub fn asset_annotate(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "operationId",
                "assetId",
                "displayName",
                "tags",
                "favorite",
                "notes",
            ],
        )?;
        let operation_id = text(args, "operationId", 240)?.to_string();
        let request_hash = crate::digest(&serde_json::to_string(args)?);
        if let Some(existing) =
            store::operation(&self.db, &operation_id, "asset.annotate", &request_hash)?
        {
            return Ok(existing);
        }
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?.to_string();
        let current: Option<String> = self
            .db
            .query_row(
                "SELECT content_hash FROM craftmine_asset_versions WHERE asset_id=?1
                 ORDER BY version DESC LIMIT 1",
                [asset_id.as_str()],
                |row| row.get(0),
            )
            .optional()?;
        let content_hash = current.context("ASSET_NOT_FOUND")?;
        let display_name = args["displayName"].as_str().map(str::to_string);
        if let Some(name) = &display_name {
            ensure!(
                !name.trim().is_empty() && name.len() <= 200 && !name.chars().any(char::is_control),
                "INVALID_ASSET_NAME"
            );
        }
        let tags = match args["tags"].as_array() {
            None => None,
            Some(list) => {
                ensure!(list.len() <= 32, "INVALID_ASSET_TAGS");
                let mut tags = Vec::new();
                for entry in list {
                    let tag = entry
                        .as_str()
                        .ok_or_else(|| anyhow::anyhow!("INVALID_ASSET_TAGS"))?;
                    ensure!(
                        !tag.trim().is_empty()
                            && tag.len() <= 40
                            && !tag.chars().any(char::is_control),
                        "INVALID_ASSET_TAGS"
                    );
                    tags.push(tag.to_string());
                }
                tags.sort();
                tags.dedup();
                Some(tags)
            }
        };
        let favorite = args["favorite"].as_bool();
        let notes = args["notes"].as_str().map(str::to_string);
        if let Some(notes) = &notes {
            ensure!(notes.len() <= 4000, "INVALID_ASSET_NOTES");
        }
        let updated_at = crate::worlds::timestamp()?;
        let tx = rusqlite::Transaction::new_unchecked(&self.db, TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT OR IGNORE INTO craftmine_asset_metadata(asset_id,display_name,tags,favorite,notes,updated_at)
             VALUES(?1,NULL,'[]',0,'',?2)",
            params![asset_id, updated_at],
        )?;
        if let Some(name) = &display_name {
            tx.execute(
                "UPDATE craftmine_asset_metadata SET display_name=?2,updated_at=?3 WHERE asset_id=?1",
                params![asset_id, name, updated_at],
            )?;
        }
        if let Some(tags) = &tags {
            tx.execute(
                "UPDATE craftmine_asset_metadata SET tags=?2,updated_at=?3 WHERE asset_id=?1",
                params![asset_id, serde_json::to_string(tags)?, updated_at],
            )?;
        }
        if let Some(favorite) = favorite {
            tx.execute(
                "UPDATE craftmine_asset_metadata SET favorite=?2,updated_at=?3 WHERE asset_id=?1",
                params![asset_id, if favorite { 1 } else { 0 }, updated_at],
            )?;
        }
        if let Some(notes) = &notes {
            tx.execute(
                "UPDATE craftmine_asset_metadata SET notes=?2,updated_at=?3 WHERE asset_id=?1",
                params![asset_id, notes, updated_at],
            )?;
        }
        let result = json!({
            "operationId": operation_id,
            "method": "asset.annotate",
            "assetId": asset_id,
            "contentHash": content_hash,
            "metadata": {
                "displayName": display_name,
                "tags": tags,
                "favorite": favorite,
                "notes": notes,
            },
            "replayed": false,
        });
        store::record_operation(
            &tx,
            &operation_id,
            "asset.annotate",
            &request_hash,
            &result,
            updated_at,
        )?;
        tx.commit()?;
        Ok(result)
    }

    /// Host-only usage relation. AL5 deletion protection reads this table.
    pub fn asset_record_usage(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["assetId", "version", "refKind", "refId", "detail"])?;
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?;
        let version = number(args, "version", contract::MAX_VERSION)?;
        let ref_kind = UsageKind::parse(args["refKind"].as_str().context("refKind: STRING_REQUIRED")?)?;
        let ref_id = text(args, "refId", 240)?;
        let detail = text(args, "detail", 240)?;
        let row = store::version_row(&self.db, asset_id, version)?.context("ASSET_NOT_FOUND")?;
        let created_at = crate::worlds::timestamp()?;
        self.db.execute(
            "INSERT OR REPLACE INTO craftmine_asset_usage(asset_id,version,ref_kind,ref_id,detail,created_at)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![asset_id, version as i64, ref_kind.as_str(), ref_id, detail, created_at],
        )?;
        Ok(json!({
            "assetId": asset_id,
            "version": version,
            "contentHash": row.content_hash,
            "refKind": ref_kind.as_str(),
            "refId": ref_id,
        }))
    }

    pub fn asset_usage(&self, args: &Value) -> Result<Value> {
        fields(args, &["assetId", "version"])?;
        let asset_id = text(args, "assetId", contract::MAX_ID_BYTES)?;
        let version = args["version"].as_u64();
        let mut statement = self.db.prepare(
            "SELECT version,ref_kind,ref_id,detail,created_at FROM craftmine_asset_usage
             WHERE asset_id=?1 AND (?2 IS NULL OR version=?2)
             ORDER BY ref_kind,ref_id,version",
        )?;
        let rows = statement.query_map(params![asset_id, version.map(|v| v as i64)], |row| {
            Ok(json!({
                "version": row.get::<_, i64>(0)? as u64,
                "refKind": row.get::<_, String>(1)?,
                "refId": row.get::<_, String>(2)?,
                "detail": row.get::<_, String>(3)?,
                "createdAt": row.get::<_, i64>(4)?,
            }))
        })?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(json!({"assetId": asset_id, "items": items, "total": items.len()}))
    }
}
