//! Managed Godot build inputs: binary asset store, per-build project copies and
//! deterministic build identity. No Godot process is started from this module.
//!
//! Source revisions stay authoritative in `godot_projects`; a build is a derived,
//! integrity-checked copy of one source revision plus one asset manifest.
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use anyhow::{ensure, Context, Result};
use base64::prelude::{Engine as _, BASE64_STANDARD};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    digest,
    godot_projects::{load_manifest, ordinary, valid_hash, Manifest},
    workspaces, worlds, TaskJournal, WorkspaceContext,
};

/// Largest single stored asset. The model tool limit is smaller because the
/// base64 payload travels inside one bounded tool call.
pub(super) const ASSET_BYTES: u64 = 512 * 1024;
pub(super) const ASSET_MODEL_BYTES: usize = 96 * 1024;
const ASSET_COUNT: i64 = 256;
const ASSET_TOTAL: u64 = 32 * 1024 * 1024;
pub(super) const BUILD_FILE_COUNT: usize = 4096;
pub(super) const BUILD_FILE_BYTES: u64 = 4 * 1024 * 1024;
pub(super) const BUILD_TOTAL: u64 = 64 * 1024 * 1024;
const BUILD_MANIFEST_LIMIT: usize = 2 * 1024 * 1024;
const ENGINE_VERSION: &str = "4.7.2-stable";
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
#[path = "godot_builds_tests.rs"]
mod tests;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AssetRow {
    pub sha256: String,
    pub name: String,
    pub path: String,
    pub media_type: String,
    pub bytes: u64,
}

/// Immutable identity of one build input set. Every field participates in
/// `build_id`, so a stale source revision or asset manifest cannot be reused as
/// the current candidate.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BuildIdentity {
    pub branch_id:String,
    pub world_id: String,
    pub build_id: String,
    pub base_id: String,
    pub base_build: String,
    pub source_revision: u64,
    pub manifest_hash: String,
    pub asset_manifest_hash: String,
    pub engine_version: String,
    pub renderer: String,
    pub target: String,
    /// Content commit for a world on the managed Git backend.
    pub content_oid: Option<String>,
    /// Canonical asset-lock hash for the same content.
    pub asset_lock_hash: Option<String>,
}

/// Where a build copy reads its authored files from. The managed Git backend is
/// the only content history for a switched world; legacy worlds keep blobs.
pub(super) enum SourceContent<'a> {
    Legacy,
    Git {
        store: &'a super::content_history::repo::RepositoryStore,
        layout: &'a super::content_history::repo::RepoLayout,
        commit: &'a str,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetPutArgs {
    context: WorkspaceContext,
    world_id: String,
    tool_call_id: String,
    name: String,
    media_type: String,
    sha256: String,
    bytes_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetListArgs {
    context: WorkspaceContext,
    world_id: String,
    #[serde(default)]
    offset: usize,
    #[serde(default = "asset_limit")]
    limit: usize,
}
fn asset_limit() -> usize {
    32
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuildStartArgs {
    #[serde(default="super::godot_projects::main_branch")]
    branch_id:String,
    context: WorkspaceContext,
    world_id: String,
    tool_call_id: String,
    revision: u64,
    manifest_hash: String,
    mode: String,
    #[serde(default)]
    check_requirements: Option<super::godot_jobs::requirements::Requirements>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuildReadArgs {
    world_id: String,
    job_id: String,
    #[serde(default)]
    context: Option<WorkspaceContext>,
    /// Optional cancellation reason code; only used by `godotBuild.cancel`.
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuildReceiptArgs {
    binding: super::TaskBinding,
    world_id: String,
    tool_call_id: String,
    method: String,
    request: Value,
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_godot_assets (
            world_id TEXT NOT NULL REFERENCES craftmine_worlds(id),
            sha256 TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
            media_type TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY(world_id,sha256), UNIQUE(world_id,path)
        );
        CREATE TABLE IF NOT EXISTS craftmine_godot_asset_receipts (
            task_id TEXT NOT NULL REFERENCES craftmine_tasks(id), tool_call_id TEXT NOT NULL,
            request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(task_id,tool_call_id)
        );
        CREATE TABLE IF NOT EXISTS craftmine_godot_builds (
            world_id TEXT NOT NULL REFERENCES craftmine_worlds(id), build_id TEXT NOT NULL,
            source_revision INTEGER NOT NULL, manifest_hash TEXT NOT NULL,
            asset_manifest_hash TEXT NOT NULL, base_id TEXT NOT NULL, base_build TEXT NOT NULL,
            engine_version TEXT NOT NULL, renderer TEXT NOT NULL, target TEXT NOT NULL,
            files INTEGER NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY(world_id,build_id)
        );        CREATE TABLE IF NOT EXISTS craftmine_godot_build_files (
            world_id TEXT NOT NULL, build_id TEXT NOT NULL, path TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('source','asset','host','cache','artifact')),
            sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
            PRIMARY KEY(world_id,build_id,path),
            FOREIGN KEY(world_id,build_id) REFERENCES craftmine_godot_builds(world_id,build_id)
        );
        CREATE TABLE IF NOT EXISTS craftmine_godot_build_receipts (
            task_id TEXT NOT NULL REFERENCES craftmine_tasks(id), tool_call_id TEXT NOT NULL,
            request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(task_id,tool_call_id)
        );",
    )?;
    // A build records the exact content commit and asset lock it was made from,
    // so a candidate can be judged stale when the branch moved.
    for (column, definition) in [
        ("content_oid", "TEXT"),
        ("asset_lock_hash", "TEXT"),
        ("branch_id", "TEXT NOT NULL DEFAULT 'main'"),
    ] {
        let present: bool = db.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('craftmine_godot_builds') WHERE name=?1",
            [column],
            |row| row.get::<_, i64>(0),
        )? > 0;
        if !present {
            db.execute_batch(&format!(
                "ALTER TABLE craftmine_godot_builds ADD COLUMN {column} {definition}"
            ))?;
        }
    }
    // Host files were added to build copies after the first builds shipped. The
    // original CHECK only allowed source/asset/cache/artifact, so a database
    // created before that must be rebuilt to record `host` rows instead of
    // failing the whole build with a constraint error.
    let legacy: Option<String> = db
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='craftmine_godot_build_files'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if legacy.is_some_and(|sql| !sql.contains("'host'")) {
        // The rebuild runs with foreign keys off so a legacy orphan cannot brick
        // startup; orphans are then rejected explicitly instead of silently kept.
        db.execute_batch("PRAGMA foreign_keys=OFF")?;
        let rebuild = db.execute_batch(
            "ALTER TABLE craftmine_godot_build_files RENAME TO craftmine_godot_build_files_legacy;
             CREATE TABLE craftmine_godot_build_files (
                world_id TEXT NOT NULL, build_id TEXT NOT NULL, path TEXT NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('source','asset','host','cache','artifact')),
                sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
                PRIMARY KEY(world_id,build_id,path),
                FOREIGN KEY(world_id,build_id) REFERENCES craftmine_godot_builds(world_id,build_id)
             );
             INSERT INTO craftmine_godot_build_files(world_id,build_id,path,kind,sha256,bytes)
                SELECT world_id,build_id,path,kind,sha256,bytes FROM craftmine_godot_build_files_legacy;
             DROP TABLE craftmine_godot_build_files_legacy;",
        );
        db.execute_batch("PRAGMA foreign_keys=ON")?;
        rebuild?;
        let orphans: i64 = db.query_row(
            "SELECT COUNT(*) FROM craftmine_godot_build_files f
             LEFT JOIN craftmine_godot_builds b ON b.world_id=f.world_id AND b.build_id=f.build_id
             WHERE b.build_id IS NULL",
            [],
            |row| row.get(0),
        )?;
        ensure!(orphans == 0, "GODOT_BUILD_FILE_ORPHAN");
    }
    Ok(())
}

pub(super) fn asset_path(name: &str) -> Result<String> {
    ensure!(
        !name.is_empty()
            && name.len() <= 80
            && !name.starts_with('.')
            && !name.ends_with('.')
            && name
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.' | b' ')),
        "INVALID_GODOT_ASSET_NAME"
    );
    let upper = name.split('.').next().unwrap().to_ascii_uppercase();
    ensure!(
        !matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            && !(upper.len() == 4
                && (upper.starts_with("COM") || upper.starts_with("LPT"))
                && matches!(upper.as_bytes()[3], b'1'..=b'9')),
        "INVALID_GODOT_ASSET_NAME"
    );
    Ok(format!("assets/{name}"))
}

fn media_type(name: &str, media_type: &str) -> Result<()> {
    let extension = name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let expected: &[&str] = match extension.as_str() {
        "png" => &["image/png"],
        "jpg" | "jpeg" => &["image/jpeg"],
        "webp" => &["image/webp"],
        "svg" => &["image/svg+xml"],
        "glb" => &["model/gltf-binary"],
        "gltf" => &["model/gltf+json"],
        "ogg" => &["audio/ogg"],
        "wav" => &["audio/wav"],
        "ttf" => &["font/ttf"],
        "otf" => &["font/otf"],
        "gd" | "tscn" | "tres" | "gdshader" | "json" | "txt" | "md" | "csv" => {
            &["application/octet-stream"]
        }
        _ => return Err(anyhow::anyhow!("UNSUPPORTED_GODOT_ASSET")),
    };
    ensure!(
        media_type.len() <= 80 && expected.contains(&media_type),
        "UNSUPPORTED_GODOT_ASSET"
    );
    Ok(())
}

fn text_asset(path: &str) -> bool {
    matches!(
        path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str(),
        "gd" | "tscn" | "tres" | "gdshader" | "json" | "txt" | "md" | "csv"
    )
}

pub(super) fn build_id(identity: &BuildIdentity) -> Result<String> {
    let body = serde_json::to_string(&json!({
        "format":"craftmine.godot-build/1","worldId":identity.world_id,"baseId":identity.base_id,
        "baseBuild":identity.base_build,"sourceRevision":identity.source_revision,
        "manifestHash":identity.manifest_hash,"assetManifestHash":identity.asset_manifest_hash,
        "engineVersion":identity.engine_version,"renderer":identity.renderer,"target":identity.target,
        "contentOid":identity.content_oid,"assetLockHash":identity.asset_lock_hash,
        "hostResourcesHash":super::godot_host_resources::hash()
    }))?;
    ensure!(body.len() <= 4096, "INVALID_GODOT_BUILD");
    Ok(format!("gbd-{}", digest(&body)))
}

pub(super) fn valid_build_id(value: &str) -> Result<()> {
    ensure!(
        value.len() == 68 && value.starts_with("gbd-"),
        "INVALID_GODOT_BUILD"
    );
    valid_hash(&value[4..])
}

fn world_key(world: &str) -> String {
    digest(world)
}

pub(super) fn build_root(directory: &Path, world: &str, id: &str, create: bool) -> Result<PathBuf> {
    worlds::validate_id(world)?;
    valid_build_id(id)?;
    ensure!(
        ordinary(directory, "GODOT_STORAGE_UNAVAILABLE")?.is_dir(),
        "GODOT_STORAGE_UNAVAILABLE"
    );
    let mut current = directory.to_path_buf();
    for component in ["godot-builds", world_key(world).as_str(), id] {
        current.push(component);
        if create && !current.try_exists()? {
            match fs::create_dir(&current) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        ensure!(
            ordinary(&current, "GODOT_STORAGE_UNAVAILABLE")?.is_dir(),
            "GODOT_STORAGE_UNAVAILABLE"
        );
    }
    Ok(current)
}

pub(super) fn asset_root(directory: &Path, world: &str, create: bool) -> Result<PathBuf> {
    worlds::validate_id(world)?;
    ensure!(
        ordinary(directory, "GODOT_STORAGE_UNAVAILABLE")?.is_dir(),
        "GODOT_STORAGE_UNAVAILABLE"
    );
    let mut current = directory.to_path_buf();
    for component in ["godot-assets", world_key(world).as_str()] {
        current.push(component);
        if create && !current.try_exists()? {
            match fs::create_dir(&current) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        ensure!(
            ordinary(&current, "GODOT_STORAGE_UNAVAILABLE")?.is_dir(),
            "GODOT_STORAGE_UNAVAILABLE"
        );
    }
    Ok(current)
}

fn ensure_dirs(base: &Path, relative: &str, code: &str) -> Result<PathBuf> {
    let mut current = base.to_path_buf();
    ensure!(ordinary(&current, code)?.is_dir(), "{code}");
    for part in relative.split('/').filter(|part| !part.is_empty()) {
        current.push(part);
        if !current.try_exists()? {
            match fs::create_dir(&current) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        ensure!(ordinary(&current, code)?.is_dir(), "{code}");
    }
    Ok(current)
}

pub(super) fn open_read(path: &Path) -> Result<std::fs::File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT.
    }
    Ok(options.open(path)?)
}

/// Immutable content-addressed write. Existing content is verified, never
/// overwritten, so a build copy cannot silently diverge from its manifest.
pub(super) fn binary_write(parent: &Path, hash: &str, bytes: &[u8]) -> Result<()> {
    valid_hash(hash)?;
    ensure!(
        ordinary(parent, "GODOT_STORAGE_UNAVAILABLE")?.is_dir(),
        "GODOT_STORAGE_UNAVAILABLE"
    );
    let target = parent.join(hash);
    if fs::symlink_metadata(&target).is_ok() {
        binary_read(&target, hash, bytes.len() as u64)?;
        return Ok(());
    }
    let temporary = parent.join(format!(
        "pending-{}-{}-{}",
        std::process::id(),
        worlds::timestamp()?,
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| -> Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x80000000); // FILE_FLAG_WRITE_THROUGH.
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if fs::symlink_metadata(&target).is_ok() {
            binary_read(&target, hash, bytes.len() as u64)?;
        } else {
            fs::rename(&temporary, &target)?;
        }
        binary_read(&target, hash, bytes.len() as u64)?;
        Ok(())
    })();
    if temporary.try_exists().unwrap_or(false) {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(super) fn binary_read(path: &Path, hash: &str, bytes: u64) -> Result<Vec<u8>> {
    valid_hash(hash)?;
    let meta = ordinary(path, "GODOT_STORAGE_UNAVAILABLE")?;
    ensure!(
        meta.is_file() && meta.len() == bytes && meta.len() <= ASSET_BYTES.max(BUILD_FILE_BYTES),
        "CORRUPT_GODOT_ASSET"
    );
    let mut content = Vec::new();
    open_read(path)?
        .take(bytes + 1)
        .read_to_end(&mut content)
        .context("CORRUPT_GODOT_ASSET")?;
    ensure!(
        content.len() as u64 == bytes && hex(&content) == hash,
        "CORRUPT_GODOT_ASSET"
    );
    Ok(content)
}

fn hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn asset_manifest(db: &Connection, world: &str) -> Result<(String, Vec<AssetRow>)> {    let mut statement = db.prepare(
        "SELECT sha256,name,path,media_type,bytes FROM craftmine_godot_assets WHERE world_id=?1 ORDER BY path",
    )?;
    let rows = statement
        .query_map([world], |row| {
            Ok(AssetRow {
                sha256: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                media_type: row.get(3)?,
                bytes: row.get::<_, i64>(4)?.try_into().unwrap_or(0),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let body = serde_json::to_string(&rows)?;
    ensure!(body.len() <= BUILD_MANIFEST_LIMIT, "GODOT_BUILD_TOO_LARGE");
    Ok((digest(&body), rows))
}

/// Canonical shared asset lock for a world's current assets.
///
/// The asset id is the content hash, so identical bytes installed at two paths
/// become one pinned reference with two install locations, and no entry can
/// reference `latest`. `None` means the world has no assets, which is a valid
/// source-only state rather than an empty lock file.
pub(super) fn asset_lock(
    assets: &[AssetRow],
) -> Result<Option<super::content_history::contract::AssetLock>> {
    use super::content_history::contract::{AssetLock, AssetLockEntry, AssetRef, FileRef};
    if assets.is_empty() {
        return Ok(None);
    }
    let mut entries = Vec::with_capacity(assets.len());
    for asset in assets {
        entries.push(AssetLockEntry {
            asset: AssetRef {
                asset_id: asset.sha256.clone(),
                version: "1".into(),
                content_hash: asset.sha256.clone(),
            },
            install_path: asset.path.clone(),
            files: vec![FileRef {
                path: asset.path.clone(),
                sha256: asset.sha256.clone(),
                bytes: asset.bytes,
                media_type: asset.media_type.clone(),
            }],
            dependencies: Vec::new(),
            overrides: Vec::new(),
        });
    }
    Ok(Some(AssetLock::new(entries)?))
}

/// Canonical asset-lock hash for a world, or the stable empty-lock hash when the
/// world has no assets at all.
pub(super) fn asset_lock_hash(db: &Connection, world: &str) -> Result<String> {
    let (_, assets) = asset_manifest(db, world)?;
    match asset_lock(&assets)? {
        Some(lock) => lock.asset_lock_hash(),
        None => super::content_history::contract::AssetLock::empty().asset_lock_hash(),
    }
}

fn scope(
    db: &Connection,
    ctx: &WorkspaceContext,
    world: &str,
    write: bool,
) -> Result<workspaces::WorkspaceSnapshot> {
    worlds::validate_id(world)?;
    let snapshot = workspaces::inspect(db, ctx)?;
    ensure!(snapshot.world_id == world, "PROJECT_WORLD_BINDING_MISMATCH");
    if write {
        workspaces::assert_live(db, &snapshot)?;
    }
    Ok(snapshot)
}

fn request_hash(method: &str, args: &Value) -> Result<String> {
    let body = serde_json::to_string(&json!({"method": method, "params": args}))?;
    ensure!(body.len() <= 32 * 1024 * 1024, "GODOT_REQUEST_TOO_LARGE");
    Ok(digest(&body))
}

fn receipt(db: &Connection, task: &str, call: &str, hash: &str) -> Result<Option<Value>> {
    workspaces::call_id(call)?;
    let prior: Option<(String, String)> = db
        .query_row(
            "SELECT request_hash,result FROM craftmine_godot_asset_receipts WHERE task_id=?1 AND tool_call_id=?2",
            params![task, call],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    prior
        .map(|(stored, result)| {
            ensure!(stored == hash, "REPLAY_MISMATCH");
            Ok(serde_json::from_str(&result)?)
        })
        .transpose()
}

fn build_receipt(db: &Connection, task: &str, call: &str, hash: &str) -> Result<Option<Value>> {
    workspaces::call_id(call)?;
    let prior: Option<(String, String)> = db
        .query_row(
            "SELECT request_hash,result FROM craftmine_godot_build_receipts WHERE task_id=?1 AND tool_call_id=?2",
            params![task, call],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    prior
        .map(|(stored, result)| {
            ensure!(stored == hash, "REPLAY_MISMATCH");
            Ok(serde_json::from_str(&result)?)
        })
        .transpose()
}

/// Materialize one immutable build copy: every source and asset file is read
/// back from the content store and verified before it is written, and existing
/// content is re-verified rather than overwritten.
pub(super) fn materialize(
    directory: &Path,
    world: &str,
    identity: &BuildIdentity,
    manifest: &Manifest,
    assets: &[AssetRow],
    source: &SourceContent<'_>,
    protect_creation: bool,
) -> Result<(Vec<Value>, u64)> {
    if protect_creation {super::godot_creation_probe::validate_manifest(manifest)?;}
    // The host owns these paths; a project may not declare a file that would
    // overwrite the export preset or the bridge the product injects.
    let host_files = super::godot_host_resources::files();
    for (reserved, _) in &host_files {
        ensure!(
            !manifest
                .files
                .keys()
                .any(|path| path.eq_ignore_ascii_case(reserved)),
            "GODOT_RESERVED_HOST_PATH: {reserved}"
        );
    }
    let root = build_root(directory, world, &identity.build_id, true)?;
    let source_root = ensure_dirs(&root, "source", "GODOT_STORAGE_UNAVAILABLE")?;
    let mut files = Vec::new();
    let mut total = 0u64;
    for (path, entry) in &manifest.files {
        let text = match source {
            SourceContent::Legacy => super::godot_projects::blob_read_bytes(directory, world, entry)?,
            SourceContent::Git {
                store,
                layout,
                commit,
            } => {
                let bytes = store.read_file(layout, commit, path)?;
                ensure!(
                    super::godot_projects::file_digest(&bytes) == entry.sha256,
                    "CORRUPT_GODOT_BUILD"
                );
                bytes
            }
        };
        if protect_creation && path=="project.godot" {super::godot_creation_probe::validate_project(&text)?;}
        let parent = match path.rsplit_once('/') {
            Some((parent, _)) => parent,
            None => "",
        };
        let target = ensure_dirs(&source_root, parent, "GODOT_STORAGE_UNAVAILABLE")?.join(
            path.rsplit('/').next().unwrap_or(path),
        );
        write_verified(&target, &entry.sha256, &text, "CORRUPT_GODOT_BUILD")?;
        total = total
            .checked_add(text.len() as u64)
            .context("GODOT_BUILD_TOO_LARGE")?;
        files.push(json!({"path":path,"kind":"source","sha256":entry.sha256,"bytes":entry.bytes}));
    }
    let assets_root = if assets.is_empty() {
        None
    } else {
        Some(asset_root(directory, world, false)?)
    };
    for asset in assets {
        let root = assets_root.as_ref().context("GODOT_STORAGE_UNAVAILABLE")?;
        let bytes = binary_read(&root.join(&asset.sha256), &asset.sha256, asset.bytes)
            .context("CORRUPT_GODOT_ASSET")?;
        let parent = asset.path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        let target = ensure_dirs(&source_root, parent, "GODOT_STORAGE_UNAVAILABLE")?
            .join(asset.path.rsplit('/').next().unwrap_or(&asset.path));
        write_verified(&target, &asset.sha256, &bytes, "CORRUPT_GODOT_BUILD")?;
        total = total
            .checked_add(asset.bytes)
            .context("GODOT_BUILD_TOO_LARGE")?;
        files.push(json!({"path":asset.path,"kind":"asset","sha256":asset.sha256,"bytes":asset.bytes}));
    }
    // Host files are fixed bytes, hashed into build identity, and written into
    // the same source tree the executor imports.
    for (path, text) in host_files {
        let sha256 = digest(&text);
        write_verified(&source_root.join(path), &sha256, text.as_bytes(), "CORRUPT_GODOT_BUILD")?;
        total = total.checked_add(text.len() as u64).context("GODOT_BUILD_TOO_LARGE")?;
        files.push(json!({"path":path,"kind":"host","sha256":sha256,"bytes":text.len()}));
    }
    ensure!(
        files.len() <= BUILD_FILE_COUNT && total <= BUILD_TOTAL,
        "GODOT_BUILD_TOO_LARGE"
    );
    let body = serde_json::to_string(&json!({
        "format":"craftmine.godot-build-manifest/1","buildId":identity.build_id,"worldId":identity.world_id,
        "baseId":identity.base_id,"baseBuild":identity.base_build,"sourceRevision":identity.source_revision,
        "manifestHash":identity.manifest_hash,"assetManifestHash":identity.asset_manifest_hash,
        "engineVersion":identity.engine_version,"renderer":identity.renderer,"target":identity.target,
        "files":files,"bytes":total
    }))?;
    ensure!(body.len() <= BUILD_MANIFEST_LIMIT, "GODOT_BUILD_TOO_LARGE");
    write_verified(&root.join("manifest.json"), &digest(&body), body.as_bytes(), "CORRUPT_GODOT_BUILD")?;
    Ok((files, total))
}

fn write_verified(target: &Path, hash: &str, bytes: &[u8], code: &str) -> Result<()> {
    valid_hash(hash)?;
    if fs::symlink_metadata(target).is_ok() {
        let meta = ordinary(target, code)?;
        ensure!(meta.is_file() && meta.len() == bytes.len() as u64, "{code}");
        let mut existing = Vec::new();
        open_read(target)?
            .take(bytes.len() as u64 + 1)
            .read_to_end(&mut existing)
            .context(code.to_string())?;
        ensure!(existing == bytes, "{code}");
        return Ok(());
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x80000000); // FILE_FLAG_WRITE_THROUGH.
    }
    let temporary = target.with_file_name(format!(".craftmine-pending-{}-{}-{}.tmp",
        std::process::id(), worlds::timestamp()?, TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
    let result = (|| -> Result<()> {
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // The SQLite IMMEDIATE transaction serializes cooperating materializers.
        // An unexpected pre-existing target is verified, never repaired silently.
        if fs::symlink_metadata(target).is_ok() {
            write_verified(target, hash, bytes, code)?;
        } else {
            fs::rename(&temporary, target)?;
        }
        Ok(())
    })();
    if fs::symlink_metadata(&temporary).is_ok() { let _ = fs::remove_file(&temporary); }
    result
}

fn store_receipt(
    db: &Connection,
    task: &str,
    call: &str,
    request_hash: &str,
    result: &Value,
) -> Result<()> {
    db.execute(
        "INSERT INTO craftmine_godot_asset_receipts(task_id,tool_call_id,request_hash,result) VALUES(?1,?2,?3,?4)",
        params![task, call, request_hash, serde_json::to_string(result)?],
    )?;
    Ok(())
}

impl TaskJournal {
    pub fn godot_asset_put(&mut self, args: &Value) -> Result<Value> {
        let request_hash = request_hash("godotAsset.put", args)?;
        let args: AssetPutArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.tool_call_id)?;
        let path = asset_path(&args.name)?;
        media_type(&args.name, &args.media_type)?;
        valid_hash(&args.sha256)?;
        ensure!(
            args.bytes_base64.len() <= ASSET_MODEL_BYTES * 4 / 3 + 64,
            "GODOT_ASSET_TOO_LARGE"
        );
        let bytes = BASE64_STANDARD
            .decode(args.bytes_base64.as_bytes())
            .context("INVALID_GODOT_ASSET_BASE64")?;
        ensure!(
            bytes.len() <= ASSET_MODEL_BYTES && !bytes.is_empty(),
            "GODOT_ASSET_TOO_LARGE"
        );
        // The declared hash is never trusted; it must match the actual payload.
        ensure!(hex(&bytes) == args.sha256, "CORRUPT_GODOT_ASSET");
        if text_asset(&path) {
            ensure!(
                std::str::from_utf8(&bytes).is_ok(),
                "INVALID_GODOT_ASSET_TEXT"
            );
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let workspace = scope(&tx, &args.context, &args.world_id, true)?;
        let task = workspace.task.binding.task_id.clone();
        if let Some(result) = receipt(&tx, &task, &args.tool_call_id, &request_hash)? {
            return Ok(result);
        }
        let existing: Option<(String, String, String, i64)> = tx
            .query_row(
                "SELECT name,path,media_type,bytes FROM craftmine_godot_assets WHERE world_id=?1 AND sha256=?2",
                params![args.world_id, args.sha256],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        if let Some((name, stored_path, stored_media, stored_bytes)) = existing {
            ensure!(
                name == args.name
                    && stored_path == path
                    && stored_media == args.media_type
                    && stored_bytes as u64 == bytes.len() as u64,
                "GODOT_ASSET_CONFLICT"
            );
        } else {
            // One path holds exactly one payload; replacing content in place
            // would silently change what an existing build copy contained.
            let taken: Option<String> = tx
                .query_row(
                    "SELECT sha256 FROM craftmine_godot_assets WHERE world_id=?1 AND path=?2",
                    params![args.world_id, path],
                    |row| row.get(0),
                )
                .optional()?;
            ensure!(taken.is_none(), "GODOT_ASSET_CONFLICT");
            let (count, total): (i64, i64) = tx.query_row(
                "SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM craftmine_godot_assets WHERE world_id=?1",
                [&args.world_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            ensure!(
                count < ASSET_COUNT && (total as u64) + bytes.len() as u64 <= ASSET_TOTAL,
                "GODOT_ASSET_LIMIT"
            );
        }
        let root = asset_root(&self.directory, &args.world_id, true)?;
        binary_write(&root, &args.sha256, &bytes)?;
        tx.execute(
            "INSERT OR IGNORE INTO craftmine_godot_assets(world_id,sha256,name,path,media_type,bytes,created_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![args.world_id, args.sha256, args.name, path, args.media_type, bytes.len() as i64, worlds::timestamp()?],
        )?;
        let (manifest_hash, _) = asset_manifest(&tx, &args.world_id)?;
        let result = json!({"worldId":args.world_id,"name":args.name,"path":path,"sha256":args.sha256,
            "mediaType":args.media_type,"bytes":bytes.len(),"assetManifestHash":manifest_hash,"replayed":false});
        store_receipt(&tx, &task, &args.tool_call_id, &request_hash, &result)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn godot_asset_list(&self, args: &Value) -> Result<Value> {
        let args: AssetListArgs = serde_json::from_value(args.clone())?;
        scope(&self.db, &args.context, &args.world_id, false)?;
        ensure!(args.limit > 0 && args.limit <= 32, "INVALID_PROJECT_PAGE");
        let (manifest_hash, rows) = asset_manifest(&self.db, &args.world_id)?;
        ensure!(args.offset <= rows.len(), "INVALID_PROJECT_PAGE");
        let items: Vec<Value> = rows
            .iter()
            .skip(args.offset)
            .take(args.limit)
            .map(|row| {
                json!({"name":row.name,"path":row.path,"sha256":row.sha256,"bytes":row.bytes,"mediaType":row.media_type})
            })
            .collect();
        let next = args.offset + items.len();
        Ok(json!({"worldId":args.world_id,"assetManifestHash":manifest_hash,"items":items,
            "totalAssets":rows.len(),"nextOffset":(next < rows.len()).then_some(next)}))
    }

    /// Create (or replay) the managed build job for one exact source revision.
    /// The per-build copy is materialized here; import/compile/check run in the
    /// registered isolated executor, never in this process.
    pub fn godot_build_start(&mut self, args: &Value) -> Result<Value> {
        let _operation_lock=crate::operation_lock::OperationLock::domain(&self.directory)?;
        let request_hash = request_hash("godotBuild.start", args)?;
        let args: BuildStartArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.tool_call_id)?;
        ensure!(matches!(args.mode.as_str(), "build" | "check"), "INVALID_GODOT_MODE");
        valid_hash(&args.manifest_hash)?;
        // Evaluate the executor gate before the write transaction so the
        // capability decision cannot depend on partially written state.
        let (queued, blocked_reason) = self.execution_gate(&args.mode);
        let git_backed = self.is_git_backed(&args.world_id)?;
        let git = if git_backed {
            Some(self.content_layout(&args.world_id)?)
        } else {
            None
        };
        scope(&self.db, &args.context, &args.world_id, false)?;
        let (manifest, manifest_hash) = self.project_manifest_for(&args.world_id, None,&args.branch_id)?;
        if let Some(requirements) = &args.check_requirements {
            requirements.validate(&manifest.base_id, &args.mode)?;
        }
        let content_oid = if git_backed {
            Some(
                super::godot_projects::git_commit_for(&self.db, &args.world_id, manifest.revision)?
                    .context("GODOT_PROJECT_REVISION_NOT_INDEXED")?,
            )
        } else {
            None
        };
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let workspace = scope(&tx, &args.context, &args.world_id, true)?;
        let task = workspace.task.binding.task_id.clone();
        if let Some(result) = build_receipt(&tx, &task, &args.tool_call_id, &request_hash)? {
            return Ok(result);
        }
        ensure!(
            manifest.revision == args.revision && manifest_hash == args.manifest_hash,
            "GODOT_SOURCE_STALE"
        );
        // The project must be authored against this world's current base. An
        // applied Godot build keeps its source lineage, so further development
        // continues instead of being blocked by its own build identity.
        let world = worlds::read(&tx, &args.world_id)?;
        let lineage = world.world.build["godot"]["baseBuild"].as_str();
        ensure!(
            manifest.base_build == workspace.task.binding.base_build
                || lineage == Some(manifest.base_build.as_str()),
            "WORLD_BUILD_CONFLICT"
        );
        let (asset_manifest_hash, assets) = asset_manifest(&tx, &args.world_id)?;
        let asset_lock_hash = if let Some((store,layout))=&git {
            let lock=store.asset_lock(layout,content_oid.as_deref().context("GODOT_BUILD_CONTENT_UNKNOWN")?)?
                .unwrap_or_else(super::content_history::contract::AssetLock::empty);
            Some(lock.asset_lock_hash()?)
        } else {
            None
        };
        let mut identity = BuildIdentity {
            branch_id:args.branch_id.clone(),
            world_id: args.world_id.clone(),
            build_id: String::new(),
            base_id: manifest.base_id.clone(),
            base_build: manifest.base_build.clone(),
            source_revision: manifest.revision,
            manifest_hash: manifest_hash.clone(),
            asset_manifest_hash: asset_manifest_hash.clone(),
            engine_version: manifest.engine_version.clone(),
            renderer: manifest.renderer.clone(),
            target: manifest.target.clone(),
            content_oid: content_oid.clone(),
            asset_lock_hash: asset_lock_hash.clone(),
        };
        identity.build_id = build_id(&identity)?;
        // A world's derived storage is capped so build history cannot grow
        // without bound. Reusing an identical immutable copy costs nothing.
        let reused: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2)",
            params![args.world_id, identity.build_id],
            |row| row.get(0),
        )?;
        if !reused {
            let used: i64 = tx.query_row(
                "SELECT COALESCE(SUM(bytes),0) FROM craftmine_godot_builds WHERE world_id=?1",
                [&args.world_id],
                |row| row.get(0),
            )?;
            let incoming = manifest.files.values().map(|entry| entry.bytes).sum::<u64>()
                + assets.iter().map(|asset| asset.bytes).sum::<u64>()
                + super::godot_host_resources::files()
                    .iter()
                    .map(|(_, text)| text.len() as u64)
                    .sum::<u64>();
            ensure!(
                u64::try_from(used)? + incoming <= super::godot_storage::WORLD_STORAGE_TOTAL,
                "GODOT_WORLD_STORAGE_LIMIT"
            );
        }
        let source = match (&git, &content_oid) {
            (Some((store, layout)), Some(commit)) => SourceContent::Git {
                store,
                layout,
                commit,
            },
            _ => SourceContent::Legacy,
        };
        if args.check_requirements.as_ref().is_some_and(|r|r.requires_passage()) {
            super::godot_creation_probe::validate_passage_manifest(&manifest)?;
        }
        if args.check_requirements.as_ref().is_some_and(|r|r.requires_controller_profile()) {
            super::godot_creation_probe::validate_controller_manifest(&manifest)?;
        }
        let (files, bytes) =
            materialize(&self.directory, &args.world_id, &identity, &manifest, &assets, &source,args.check_requirements.as_ref().is_some_and(|r|r.is_creation()))?;
        tx.execute(
            "INSERT OR IGNORE INTO craftmine_godot_builds(world_id,build_id,source_revision,manifest_hash,
                asset_manifest_hash,base_id,base_build,engine_version,renderer,target,files,bytes,created_at,
                content_oid,asset_lock_hash,branch_id)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![args.world_id, identity.build_id, i64::try_from(identity.source_revision)?, manifest_hash,
                asset_manifest_hash, identity.base_id, identity.base_build, identity.engine_version,
                identity.renderer, identity.target, files.len() as i64, bytes as i64, worlds::timestamp()?,
                identity.content_oid, identity.asset_lock_hash,identity.branch_id],
        )?;
        // The recorded file list is what an executor may read; it is the exact
        // set that was verified on disk above.
        for file in &files {
            tx.execute(
                "INSERT OR IGNORE INTO craftmine_godot_build_files(world_id,build_id,path,kind,sha256,bytes)
                 VALUES(?1,?2,?3,?4,?5,?6)",
                params![args.world_id, identity.build_id, file["path"].as_str().unwrap_or_default(),
                    file["kind"].as_str().unwrap_or_default(), file["sha256"].as_str().unwrap_or_default(),
                    file["bytes"].as_u64().unwrap_or(0) as i64],
            )?;
        }
        let job_id = format!(
            "gjob-{}",
            digest(&format!(
                "craftmine.godot-job/1|{}|{}|{}",
                args.world_id, task, args.tool_call_id
            ))
        );
        let status = if queued { "queued" } else { "blocked" };
        let now = worlds::timestamp()?;
        tx.execute(
            "INSERT OR IGNORE INTO craftmine_godot_jobs(id,world_id,task_id,tool_call_id,kind,build_id,
                source_revision,manifest_hash,asset_manifest_hash,base_id,base_build,request_hash,status,
                blocked_reason,progress,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,0,?15,?15)",
            params![job_id, args.world_id, task, args.tool_call_id, args.mode, identity.build_id,
                i64::try_from(identity.source_revision)?, manifest_hash, asset_manifest_hash, identity.base_id,
                identity.base_build, request_hash, status, blocked_reason, now],
        )?;
        super::godot_jobs::requirements::store(&tx, &job_id, args.check_requirements.as_ref())?;
        let mut result = json!({"jobId":job_id,"buildId":identity.build_id,"worldId":args.world_id,
            "kind":args.mode,"status":status,"executionAvailable":queued,"blockedReason":blocked_reason,
            "sourceRevision":identity.source_revision,"manifestHash":manifest_hash,
            "assetManifestHash":asset_manifest_hash,"materialized":{"files":files.len(),"bytes":bytes},
            "engineVersion":identity.engine_version,"renderer":identity.renderer,"target":identity.target,
            "baseId":identity.base_id,"baseBuild":identity.base_build,"replayed":false});
        super::godot_jobs::requirements::attach(&tx, &job_id, &mut result)?;
        tx.execute(
            "INSERT INTO craftmine_godot_build_receipts(task_id,tool_call_id,request_hash,result) VALUES(?1,?2,?3,?4)",
            params![task, args.tool_call_id, request_hash, serde_json::to_string(&result)?],
        )?;
        tx.commit()?;
        Ok(result)
    }

    /// Private host presentation query. Reading status does not create a task.
    pub fn godot_build_latest(&mut self, args: &Value) -> Result<Value> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct LatestArgs { world_id: String, #[serde(default)] session_id: Option<String> }
        let args: LatestArgs = serde_json::from_value(args.clone())?;
        super::godot_jobs::world_scope(&self.db, &args.world_id, None)?;
        if let Some(session) = &args.session_id { ensure!(!session.is_empty() && session.len() <= 240, "INVALID_SESSION_ID"); }
        let job: Option<String> = self.db.query_row(
            "SELECT j.id FROM craftmine_godot_jobs j JOIN craftmine_tasks t ON t.id=j.task_id WHERE j.world_id=?1 AND (?2 IS NULL OR json_extract(t.binding,'$.sessionId')=?2) ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1",
            params![&args.world_id, &args.session_id], |row| row.get(0),
        ).optional()?;
        match job {
            Some(job_id) => self.godot_build_read(&json!({"worldId":args.world_id,"jobId":job_id})),
            None => Ok(Value::Null),
        }
    }

    pub fn godot_build_read(&mut self, args: &Value) -> Result<Value> {
        let args: BuildReadArgs = serde_json::from_value(args.clone())?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        super::godot_jobs::world_scope(&tx, &args.world_id, args.context.as_ref())?;
        super::godot_jobs::expire(&tx)?;
        tx.commit()?;
        let record = super::godot_jobs::read_job(&self.db, &args.job_id)?;
        ensure!(
            record["worldId"] == args.world_id,
            "PROJECT_WORLD_BINDING_MISMATCH"
        );
        let current = super::godot_projects::branch_head_manifest(&self.db,&args.world_id,record["branchId"].as_str().unwrap_or("main"))
            .ok().map(|(manifest,hash)|(manifest.revision as i64,hash));
        let source_stale = current.as_ref().is_none_or(|(revision, hash)| {
            i64::try_from(record["sourceRevision"].as_u64().unwrap_or(u64::MAX)).ok() != Some(*revision)
                || record["manifestHash"].as_str() != Some(hash.as_str())
        });
        let mut result = record;
        result["sourceStale"] = json!(source_stale);
        result["artifacts"] = json!(super::godot_jobs::build_files(
            &self.db,
            &args.world_id,
            result["buildId"].as_str().context("INVALID_GODOT_BUILD")?,
            "artifact"
        )?);
        Ok(result)
    }

    pub fn godot_build_cancel(&mut self, args: &Value) -> Result<Value> {
        let args: BuildReadArgs = serde_json::from_value(args.clone())?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let caller = match args.context.as_ref() {
            Some(context) => Some(scope(&tx, context, &args.world_id, true)?.task.binding.task_id),
            None => {
                worlds::read(&tx, &args.world_id)?;
                None
            }
        };
        super::godot_jobs::expire(&tx)?;
        let (task, status): (String, String) = tx
            .query_row(
                "SELECT task_id,status FROM craftmine_godot_jobs WHERE id=?1 AND world_id=?2",
                params![args.job_id, args.world_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .context("GODOT_JOB_NOT_FOUND")?;
        ensure!(
            caller.is_none_or(|caller| caller == task),
            "GODOT_JOB_BINDING_MISMATCH"
        );
        // Cancelling twice is a replay, not an error: the caller may have lost
        // the first response.
        if status == "cancelled" {
            let mut record = super::godot_jobs::read_job(&tx, &args.job_id)?;
            record["replayed"] = json!(true);
            tx.commit()?;
            return Ok(record);
        }
        ensure!(
            matches!(
                status.as_str(),
                "blocked" | "queued" | "claimed" | "running"
            ),
            "GODOT_JOB_INACTIVE"
        );
        let reason = match args.reason.as_deref() {
            None => "GODOT_CANCELLED_BY_USER".to_string(),
            Some(reason)
                if !reason.is_empty()
                    && reason.len() <= 80
                    && reason
                        .bytes()
                        .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_') =>
            {
                reason.to_string()
            }
            Some(_) => anyhow::bail!("INVALID_INTERRUPT_REASON"),
        };
        tx.execute(
            "UPDATE craftmine_godot_jobs SET status='cancelled',run_token=NULL,executor_id=NULL,
                lease_expires_at=NULL,interrupt_reason=?3,updated_at=?2 WHERE id=?1",
            params![args.job_id, worlds::timestamp()?, reason],
        )?;
        super::godot_jobs::settle_usage(&tx)?;
        let mut record = super::godot_jobs::read_job(&tx, &args.job_id)?;
        record["replayed"] = json!(false);
        tx.commit()?;
        Ok(record)
    }

    pub fn godot_build_receipt(&self, args: &Value) -> Result<Value> {
        let args: BuildReceiptArgs = serde_json::from_value(args.clone())?;
        args.binding.validate()?;
        ensure!(
            matches!(args.method.as_str(), "godotBuild.start" | "godotAsset.put"),
            "INVALID_PROJECT_METHOD"
        );
        let task = super::read_task(&self.db, &args.binding.task_id)?;
        super::assert_binding(&task, &args.binding)?;
        let world: String = self.db.query_row(
            "SELECT world_id FROM craftmine_workspaces WHERE task_id=?1",
            [&args.binding.task_id],
            |row| row.get(0),
        )?;
        ensure!(world == args.world_id, "PROJECT_WORLD_BINDING_MISMATCH");
        let hash = request_hash(&args.method, &args.request)?;
        let result = if args.method == "godotAsset.put" {
            receipt(&self.db, &args.binding.task_id, &args.tool_call_id, &hash)?
        } else {
            build_receipt(&self.db, &args.binding.task_id, &args.tool_call_id, &hash)?
        };
        Ok(result.unwrap_or(Value::Null))
    }
}

/// ENGINE_VERSION is the only engine this build path accepts; a different
/// engine must be a separate, explicitly validated integration.
pub(super) fn engine_version() -> &'static str {
    ENGINE_VERSION
}
