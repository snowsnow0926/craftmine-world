//! AL1 content-addressed storage, immutable versions and operation receipts.
//!
//! Large bodies are stored once per content hash and never rewritten. Version
//! rows are immutable; display metadata lives in its own table so renaming an
//! asset can never change what a world runs.
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::budget::{ImportLimits, IMPORT_CHUNK_BYTES};
use super::contract::{self, FileRef, ASSET_CONTENT_FORMAT};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn digest_bytes(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_asset_versions (
            asset_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL,
            content_hash TEXT NOT NULL, display_name TEXT NOT NULL, media_kind TEXT NOT NULL,
            bytes INTEGER NOT NULL, file_count INTEGER NOT NULL,
            origin TEXT NOT NULL, author TEXT NOT NULL, license TEXT NOT NULL,
            license_status TEXT NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY(asset_id,version)
        );
        CREATE TABLE IF NOT EXISTS craftmine_asset_files (
            asset_id TEXT NOT NULL, version INTEGER NOT NULL, path TEXT NOT NULL,
            sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, media_type TEXT NOT NULL,
            PRIMARY KEY(asset_id,version,path),
            FOREIGN KEY(asset_id,version) REFERENCES craftmine_asset_versions(asset_id,version)
        );
        CREATE TABLE IF NOT EXISTS craftmine_asset_blobs (
            sha256 TEXT PRIMARY KEY, bytes INTEGER NOT NULL, media_kind TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS craftmine_asset_metadata (
            asset_id TEXT PRIMARY KEY, display_name TEXT, tags TEXT NOT NULL DEFAULT '[]',
            favorite INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS craftmine_asset_operations (
            operation_id TEXT PRIMARY KEY, method TEXT NOT NULL, request_hash TEXT NOT NULL,
            result TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS craftmine_asset_usage (
            asset_id TEXT NOT NULL, version INTEGER NOT NULL, ref_kind TEXT NOT NULL,
            ref_id TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY(asset_id,version,ref_kind,ref_id)
        );
        CREATE TABLE IF NOT EXISTS craftmine_asset_previews (
            asset_id TEXT NOT NULL, version INTEGER NOT NULL, content_hash TEXT NOT NULL,
            previewer_version TEXT NOT NULL, engine_version TEXT NOT NULL,
            settings_hash TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL,
            facts TEXT NOT NULL, created_at INTEGER NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0, claim_id TEXT NOT NULL DEFAULT '',
            claim_owner TEXT NOT NULL DEFAULT '', claim_deadline INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(asset_id,version,content_hash,previewer_version,engine_version,settings_hash)
        );
        CREATE TABLE IF NOT EXISTS craftmine_asset_checks (
            asset_id TEXT NOT NULL, version INTEGER NOT NULL, content_hash TEXT NOT NULL,
            base_id TEXT NOT NULL, base_version INTEGER NOT NULL, engine_version TEXT NOT NULL,
            target TEXT NOT NULL, checker_version TEXT NOT NULL, status TEXT NOT NULL,
            detail TEXT NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY(asset_id,version,content_hash,base_id,base_version,engine_version,target,checker_version)
        );
        CREATE TABLE IF NOT EXISTS craftmine_asset_legacy_map (
            legacy_kind TEXT NOT NULL, legacy_id TEXT NOT NULL, legacy_version TEXT NOT NULL,
            asset_id TEXT NOT NULL, version INTEGER NOT NULL, detail TEXT NOT NULL,
            created_at INTEGER NOT NULL, PRIMARY KEY(legacy_kind,legacy_id,legacy_version)
        );
        CREATE INDEX IF NOT EXISTS craftmine_asset_versions_by_kind
            ON craftmine_asset_versions(kind,media_kind,asset_id);",
    )?;
    // Attempt identity for preview slots. A database written before the claim
    // columns existed keeps its rows; `duplicate column name` means migrated.
    for statement in [
        "ALTER TABLE craftmine_asset_previews ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE craftmine_asset_previews ADD COLUMN claim_id TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE craftmine_asset_previews ADD COLUMN claim_owner TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE craftmine_asset_previews ADD COLUMN claim_deadline INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = db.execute(statement, []);
    }
    Ok(())
}

pub(super) fn blob_root(directory: &Path, create: bool) -> Result<PathBuf> {
    ensure!(
        super::super::godot_projects::ordinary(directory, "ASSET_STORAGE_UNAVAILABLE")?.is_dir(),
        "ASSET_STORAGE_UNAVAILABLE"
    );
    let current = directory.join("asset-catalog").join("blobs");
    if create && !current.try_exists()? {
        match fs::create_dir_all(&current) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
    }
    ensure!(
        super::super::godot_projects::ordinary(&current, "ASSET_STORAGE_UNAVAILABLE")?.is_dir(),
        "ASSET_STORAGE_UNAVAILABLE"
    );
    Ok(current)
}

pub(super) fn blob_path(root: &Path, sha256: &str) -> Result<PathBuf> {
    contract::validate_sha256(sha256)?;
    Ok(root.join(&sha256[..2]).join(sha256))
}

pub(super) struct Streamed {
    pub sha256: String,
    pub bytes: u64,
    pub deduplicated: bool,
}

/// Streams one player file into the content store while hashing it. The blob
/// only becomes visible after a complete, fsynced temporary file is renamed.
/// A failure leaves no blob at the final path and no version row.
pub(super) fn stream_blob(root: &Path, source: &Path, limits: &ImportLimits) -> Result<Streamed> {
    let meta = super::super::godot_projects::ordinary(source, "ASSET_SOURCE_UNAVAILABLE")?;
    ensure!(meta.is_file(), "ASSET_SOURCE_UNAVAILABLE");
    ensure!(
        meta.len() <= limits.file_bytes,
        "ASSET_FILE_TOO_LARGE"
    );
    let mut reader = super::super::godot_builds::open_read(source)
        .map_err(|error| super::source_io_error(source, error))?;
    let temporary = root.join(format!(
        "pending-{}-{}-{}",
        std::process::id(),
        super::super::worlds::timestamp()?,
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| -> Result<Streamed> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x80000000); // FILE_FLAG_WRITE_THROUGH.
        }
        let mut writer = options.open(&temporary)?;
        let mut hasher = Sha256::new();
        let mut bytes: u64 = 0;
        let mut buffer = vec![0u8; IMPORT_CHUNK_BYTES];
        loop {
            let read = reader.read(&mut buffer).context("ASSET_SOURCE_UNAVAILABLE")?;
            if read == 0 {
                break;
            }
            bytes = bytes.saturating_add(read as u64);
            ensure!(bytes <= limits.file_bytes, "ASSET_FILE_TOO_LARGE");
            hasher.update(&buffer[..read]);
            writer.write_all(&buffer[..read])?;
        }
        writer.sync_all()?;
        drop(writer);
        ensure!(bytes > 0, "ASSET_FILE_EMPTY");
        let sha256 = hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let target = blob_path(root, &sha256)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        if target.try_exists()? {
            verify_blob(&target, &sha256, bytes)?;
            fs::remove_file(&temporary)?;
            return Ok(Streamed {
                sha256,
                bytes,
                deduplicated: true,
            });
        }
        fs::rename(&temporary, &target)?;
        Ok(Streamed {
            sha256,
            bytes,
            deduplicated: false,
        })
    })();
    if temporary.try_exists().unwrap_or(false) {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(super) fn verify_blob(path: &Path, sha256: &str, bytes: u64) -> Result<()> {
    let meta = super::super::godot_projects::ordinary(path, "CORRUPT_ASSET_BLOB")?;
    ensure!(
        meta.is_file() && meta.len() == bytes,
        "CORRUPT_ASSET_BLOB"
    );
    let mut reader = super::super::godot_builds::open_read(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; IMPORT_CHUNK_BYTES];
    let mut total: u64 = 0;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        ensure!(total <= bytes, "CORRUPT_ASSET_BLOB");
        hasher.update(&buffer[..read]);
    }
    let actual = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    ensure!(total == bytes && actual == sha256, "CORRUPT_ASSET_BLOB");
    Ok(())
}

pub(super) fn blob_read(root: &Path, sha256: &str, bytes: u64) -> Result<Vec<u8>> {
    let path = blob_path(root, sha256)?;
    verify_blob(&path, sha256, bytes)?;
    let mut content = Vec::with_capacity(bytes.min(4 * 1024 * 1024) as usize);
    super::super::godot_builds::open_read(&path)?
        .take(bytes + 1)
        .read_to_end(&mut content)?;
    ensure!(content.len() as u64 == bytes, "CORRUPT_ASSET_BLOB");
    Ok(content)
}

/// Removes staging files left by a killed import. A file younger than
/// `older_than_ms` may still belong to a live writer, so it is kept.
pub(super) fn sweep_pending(root: &Path, older_than_ms: i64) -> Result<usize> {
    if !root.try_exists()? {
        return Ok(0);
    }
    let now = crate::worlds::timestamp()?;
    let mut removed = 0usize;
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string();
        if !name.starts_with("pending-") {
            continue;
        }
        let age = now.saturating_sub(
            crate::godot_projects::ordinary(&path, "ASSET_STORAGE_UNAVAILABLE")?
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_millis() as i64)
                .unwrap_or(now),
        );
        if age >= older_than_ms {
            fs::remove_file(&path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Removes a blob that no version row references, used when a registration
/// transaction fails after the body was already renamed into place. A blob that
/// any version still references is never deleted.
pub(super) fn discard_blob(db: &Connection, root: &Path, sha256: &str) -> Result<()> {
    contract::validate_sha256(sha256)?;
    let referenced: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM craftmine_asset_files WHERE sha256=?1)",
        [sha256],
        |row| row.get(0),
    )?;
    if referenced {
        return Ok(());
    }
    let path = blob_path(root, sha256)?;
    if path.try_exists()? {
        fs::remove_file(&path)?;
    }
    Ok(())
}

/// Reads a verified prefix for structural probing. The full blob hash is still
/// verified when the blob is smaller than the prefix limit.
pub(super) fn blob_read_prefix(
    root: &Path,
    sha256: &str,
    bytes: u64,
    limit: u64,
) -> Result<Vec<u8>> {
    ensure!(limit > 0, "INVALID_PROBE_LIMIT");
    let path = blob_path(root, sha256)?;
    // A probe must never report facts derived from bytes that do not match the
    // requested content identity, so the full blob hash is verified first.
    verify_blob(&path, sha256, bytes)?;
    let mut content = Vec::new();
    super::super::godot_builds::open_read(&path)?
        .take(limit)
        .read_to_end(&mut content)?;
    ensure!(!content.is_empty(), "CORRUPT_ASSET_BLOB");
    Ok(content)
}

/// Frozen content manifest: one canonical line per file, sorted by path.
pub(super) fn content_hash(files: &[FileRef]) -> Result<String> {
    ensure!(!files.is_empty(), "ASSET_FILES_REQUIRED");
    let mut sorted = files.to_vec();
    sorted.sort_by(|left, right| left.path.cmp(&right.path));
    let mut seen: BTreeMap<String, &str> = BTreeMap::new();
    let mut canonical = String::from(ASSET_CONTENT_FORMAT);
    canonical.push('\n');
    for file in &sorted {
        file.validate()?;
        let key = file.path.to_ascii_lowercase();
        ensure!(
            seen.insert(key, file.path.as_str()).is_none(),
            "ASSET_CONTENT_PATH_CONFLICT"
        );
        canonical.push_str(&file.path);
        canonical.push('\n');
        canonical.push_str(&file.sha256);
        canonical.push('\n');
        canonical.push_str(&file.bytes.to_string());
        canonical.push('\n');
        canonical.push_str(&file.media_type);
        canonical.push('\n');
    }
    Ok(digest_bytes(canonical.as_bytes()))
}

#[derive(Clone, Debug)]
pub(super) struct VersionRow {
    pub asset_id: String,
    pub version: u64,
    pub kind: String,
    pub content_hash: String,
    pub display_name: String,
    pub media_kind: String,
    pub bytes: u64,
    pub file_count: u64,
    pub origin: String,
    pub author: String,
    pub license: String,
    pub license_status: String,
    pub created_at: i64,
}

pub(super) fn version_row(db: &Connection, asset_id: &str, version: u64) -> Result<Option<VersionRow>> {
    Ok(db
        .query_row(
            "SELECT asset_id,version,kind,content_hash,display_name,media_kind,bytes,file_count,
                    origin,author,license,license_status,created_at
             FROM craftmine_asset_versions WHERE asset_id=?1 AND version=?2",
            params![asset_id, version as i64],
            |row| {
                Ok(VersionRow {
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
                })
            },
        )
        .optional()?)
}

pub(super) fn files_of(db: &Connection, asset_id: &str, version: u64) -> Result<Vec<FileRef>> {
    let mut statement = db.prepare(
        "SELECT path,sha256,bytes,media_type FROM craftmine_asset_files
         WHERE asset_id=?1 AND version=?2 ORDER BY path",
    )?;
    let rows = statement.query_map(params![asset_id, version as i64], |row| {
        Ok(FileRef {
            path: row.get(0)?,
            sha256: row.get(1)?,
            bytes: row.get::<_, i64>(2)? as u64,
            media_type: row.get(3)?,
        })
    })?;
    let mut files = Vec::new();
    for row in rows {
        files.push(row?);
    }
    Ok(files)
}

pub(super) fn insert_version(
    tx: &Transaction<'_>,
    row: &VersionRow,
    files: &[FileRef],
) -> Result<()> {
    let existing: Option<String> = tx
        .query_row(
            "SELECT content_hash FROM craftmine_asset_versions WHERE asset_id=?1 AND version=?2",
            params![row.asset_id, row.version as i64],
            |result| result.get(0),
        )
        .optional()?;
    if let Some(existing) = existing {
        ensure!(existing == row.content_hash, "ASSET_VERSION_CONFLICT");
        return Ok(());
    }
    tx.execute(
        "INSERT INTO craftmine_asset_versions(asset_id,version,kind,content_hash,display_name,
            media_kind,bytes,file_count,origin,author,license,license_status,created_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            row.asset_id,
            row.version as i64,
            row.kind,
            row.content_hash,
            row.display_name,
            row.media_kind,
            row.bytes as i64,
            row.file_count as i64,
            row.origin,
            row.author,
            row.license,
            row.license_status,
            row.created_at
        ],
    )
    .context("ASSET_VERSION_CONFLICT")?;
    for file in files {
        tx.execute(
            "INSERT INTO craftmine_asset_files(asset_id,version,path,sha256,bytes,media_type)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                row.asset_id,
                row.version as i64,
                file.path,
                file.sha256,
                file.bytes as i64,
                file.media_type
            ],
        )?;
    }
    Ok(())
}

pub(super) fn record_blob(
    tx: &Transaction<'_>,
    sha256: &str,
    bytes: u64,
    media_kind: &str,
    created_at: i64,
) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO craftmine_asset_blobs(sha256,bytes,media_kind,created_at)
         VALUES(?1,?2,?3,?4)",
        params![sha256, bytes as i64, media_kind, created_at],
    )?;
    Ok(())
}

pub(super) fn operation(
    db: &Connection,
    operation_id: &str,
    method: &str,
    request_hash: &str,
) -> Result<Option<Value>> {
    let stored: Option<(String, String)> = db
        .query_row(
            "SELECT request_hash,result FROM craftmine_asset_operations WHERE operation_id=?1",
            [operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((stored_hash, result)) = stored else {
        return Ok(None);
    };
    ensure!(stored_hash == request_hash, "OPERATION_CONFLICT");
    let mut value: Value = serde_json::from_str(&result)?;
    if let Some(object) = value.as_object_mut() {
        object.insert("replayed".to_string(), Value::Bool(true));
        object.insert("method".to_string(), Value::String(method.to_string()));
    }
    Ok(Some(value))
}

pub(super) fn record_operation(
    tx: &Transaction<'_>,
    operation_id: &str,
    method: &str,
    request_hash: &str,
    result: &Value,
    created_at: i64,
) -> Result<()> {
    tx.execute(
        "INSERT INTO craftmine_asset_operations(operation_id,method,request_hash,result,created_at)
         VALUES(?1,?2,?3,?4,?5)",
        params![
            operation_id,
            method,
            request_hash,
            serde_json::to_string(result)?,
            created_at
        ],
    )?;
    Ok(())
}
