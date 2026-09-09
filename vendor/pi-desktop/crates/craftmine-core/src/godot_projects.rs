//! Managed, non-executable Godot source revisions in the existing domain journal.
//! A manifest is an authoring file set, never a verified or applied game build.
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    content_history::repo::{self, ContentFile},
    digest, godot_builds, workspaces, worlds, TaskBinding, TaskJournal, WorkspaceContext,
};

const FILE_LIMIT: usize = 4 * 1024 * 1024;
const PATCH_LIMIT: usize = 8 * 1024 * 1024;
const PROJECT_LIMIT: u64 = 64 * 1024 * 1024;
const FILE_COUNT: usize = 4096;
const MANIFEST_LIMIT: usize = 2 * 1024 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
#[path = "godot_projects_tests.rs"]
mod tests;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FileEntry {
    pub(super) sha256: String,
    pub(super) bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Manifest {
    pub(super) format: String,
    pub(super) world_id: String,
    pub(super) base_build: String,
    pub(super) base_id: String,
    pub(super) engine_version: String,
    pub(super) language: String,
    pub(super) renderer: String,
    pub(super) target: String,
    pub(super) revision: u64,
    pub(super) task: TaskBinding,
    pub(super) files: BTreeMap<String, FileEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceFile {
    path: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateArgs {
    context: WorkspaceContext,
    world_id: String,
    tool_call_id: String,
    base_build: String,
    base_id: String,
    files: Vec<SourceFile>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum Operation {
    PutBytes {
        path: String,
        #[serde(rename = "bytesBase64")]
        bytes_base64: String,
        #[serde(rename = "expectedHash", deserialize_with = "required_optional_hash")]
        expected_hash: Option<String>,
    },
    Put {
        path: String,
        text: String,
        #[serde(rename = "expectedHash", deserialize_with = "required_optional_hash")]
        expected_hash: Option<String>,
    },
    Remove {
        path: String,
        #[serde(rename = "expectedHash")]
        expected_hash: String,
    },
}

fn required_optional_hash<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PatchArgs {
    context: WorkspaceContext,
    world_id: String,
    tool_call_id: String,
    revision: u64,
    manifest_hash: String,
    operations: Vec<Operation>,
    /// Required for a world on the Git backend: the host binds the exact branch
    /// and commit the patch was prepared against.
    #[serde(default)]
    operation: Option<super::content_history::contract::OperationContext>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IndexArgs {
    #[serde(default="main_branch")]
    branch_id:String,
    context: WorkspaceContext,
    world_id: String,
    revision: Option<u64>,
    manifest_hash: Option<String>,
    #[serde(default)]
    offset: usize,
    #[serde(default = "index_limit")]
    limit: usize,
}
fn index_limit() -> usize {
    32
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadArgs {
    #[serde(default="main_branch")]
    branch_id:String,
    context: WorkspaceContext,
    world_id: String,
    revision: u64,
    manifest_hash: String,
    path: String,
    #[serde(default)]
    offset: usize,
    #[serde(default = "text_limit")]
    limit: usize,
}
fn text_limit() -> usize {
    16000
}
pub(super) fn main_branch()->String { repo::MAIN_BRANCH.to_owned() }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptArgs {
    binding: TaskBinding,
    world_id: String,
    tool_call_id: String,
    method: String,
    request: Value,
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_godot_projects (
        world_id TEXT PRIMARY KEY REFERENCES craftmine_worlds(id),
        revision INTEGER NOT NULL CHECK(revision>=0), manifest TEXT NOT NULL, hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS craftmine_godot_revisions (
        world_id TEXT NOT NULL REFERENCES craftmine_worlds(id), revision INTEGER NOT NULL,
        task_id TEXT NOT NULL REFERENCES craftmine_tasks(id), manifest TEXT NOT NULL, hash TEXT NOT NULL,
        PRIMARY KEY(world_id,revision)
    );
    CREATE TABLE IF NOT EXISTS craftmine_godot_receipts (
        task_id TEXT NOT NULL REFERENCES craftmine_tasks(id), tool_call_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(task_id,tool_call_id)
    );
    -- Revision index for the managed Git backend: the commit is the content, the
    -- manifest row above is only the path/hash index of the head revision.
    CREATE TABLE IF NOT EXISTS craftmine_godot_project_commits (
        world_id TEXT NOT NULL REFERENCES craftmine_worlds(id),
        revision INTEGER NOT NULL CHECK(revision>=0),
        commit_oid TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        asset_lock_hash TEXT NOT NULL,
        task_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(world_id,revision)
    );",
    )?;
    let has_manifest: bool=db.query_row("SELECT COUNT(*) FROM pragma_table_info('craftmine_godot_project_commits') WHERE name='manifest'",[],|row|Ok(row.get::<_,i64>(0)?>0))?;
    if !has_manifest { db.execute_batch("ALTER TABLE craftmine_godot_project_commits ADD COLUMN manifest TEXT")?; }
    let has_branch: bool=db.query_row("SELECT COUNT(*) FROM pragma_table_info('craftmine_godot_project_commits') WHERE name='branch_id'",[],|row|Ok(row.get::<_,i64>(0)?>0))?;
    if !has_branch { db.execute_batch("ALTER TABLE craftmine_godot_project_commits ADD COLUMN branch_id TEXT NOT NULL DEFAULT 'main'")?; }
    Ok(())
}

pub(super) fn valid_hash(hash: &str) -> Result<()> {
    ensure!(
        hash.len() == 64
            && hash
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
        "INVALID_PROJECT_HASH"
    );
    Ok(())
}

fn source_path(path: &str) -> Result<()> {
    ensure!(
        !path.is_empty() && path.len() <= 240 && path.split('/').count() <= 16,
        "INVALID_PROJECT_PATH"
    );
    for part in path.split('/') {
        ensure!(
            !part.is_empty()
                && part.len() <= 80
                && !part.starts_with('.')
                && !part.ends_with('.')
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.')),
            "INVALID_PROJECT_PATH"
        );
        let upper = part.split('.').next().unwrap().to_ascii_uppercase();
        ensure!(
            !matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(upper.len() == 4
                    && (upper.starts_with("COM") || upper.starts_with("LPT"))
                    && matches!(upper.as_bytes()[3], b'1'..=b'9')),
            "INVALID_PROJECT_PATH"
        );
    }
    let extension = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    ensure!(
        matches!(
            extension.as_str(),
            "godot"
                | "gd"
                | "tscn"
                | "tres"
                | "gdshader"
                | "gdshaderinc"
                | "json"
                | "cfg"
                | "txt"
                | "md"
                | "csv"
                | "svg"
                | "obj"
                | "mtl"
                | "uid"
                | "png" | "jpg" | "jpeg" | "webp" | "wav" | "ogg" | "glb"
        ),
        "UNSUPPORTED_PROJECT_FILE"
    );
    Ok(())
}

fn source_entry(path: &str, text: &str) -> Result<FileEntry> {
    source_path(path)?;
    ensure!(
        text.len() <= FILE_LIMIT && !text.contains('\0'),
        "INVALID_PROJECT_TEXT"
    );
    Ok(FileEntry {
        sha256: digest(text),
        bytes: text.len() as u64,
    })
}

fn validate_manifest(manifest: &Manifest) -> Result<()> {
    worlds::validate_id(&manifest.world_id)?;
    manifest.task.validate()?;
    ensure!(
        manifest.format == "craftmine.godot-project/1"
            && manifest.base_build == manifest.task.base_build
            && manifest.engine_version == "4.7.2-stable"
            && manifest.language == "GDScript"
            && manifest.renderer == "gl_compatibility"
            && manifest.target == "web",
        "INVALID_PROJECT_MANIFEST"
    );
    ensure!(
        matches!(
            manifest.base_id.as_str(),
            "first-person" | "top-down" | "side-view"
        ),
        "INVALID_BASE_ID"
    );
    ensure!(
        !manifest.files.is_empty()
            && manifest.files.len() <= FILE_COUNT
            && manifest.files.contains_key("project.godot"),
        "PROJECT_CONFIG_REQUIRED"
    );
    let mut names = BTreeSet::new();
    let mut bytes = 0u64;
    for (path, entry) in &manifest.files {
        source_path(path)?;
        valid_hash(&entry.sha256)?;
        ensure!(entry.bytes <= FILE_LIMIT as u64, "PROJECT_FILE_TOO_LARGE");
        bytes = bytes
            .checked_add(entry.bytes)
            .context("PROJECT_TOO_LARGE")?;
        ensure!(
            names.insert(path.to_ascii_lowercase()),
            "PROJECT_PATH_COLLISION"
        );
    }
    for path in &names {
        let mut prefix = String::new();
        for part in path.split('/').take(path.split('/').count() - 1) {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            ensure!(!names.contains(&prefix), "PROJECT_PATH_COLLISION");
        }
    }
    ensure!(bytes <= PROJECT_LIMIT, "PROJECT_TOO_LARGE");
    Ok(())
}

pub(super) fn ordinary(path: &Path, code: &str) -> Result<fs::Metadata> {
    let meta = fs::symlink_metadata(path).context(code.to_string())?;
    ensure!(!meta.file_type().is_symlink(), "{code}");
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        ensure!(meta.file_attributes() & 0x400 == 0, "{code}");
    }
    Ok(meta)
}

fn blob_directory(directory: &Path, world: &str, create: bool) -> Result<PathBuf> {
    worlds::validate_id(world)?;
    // Only Rust-computed identifiers become filesystem components. Source paths
    // are virtual manifest entries and never passed to OpenOptions.
    ensure!(ordinary(directory, "PROJECT_STORAGE_UNAVAILABLE")?.is_dir(), "PROJECT_STORAGE_UNAVAILABLE");
    let mut current = directory.to_path_buf();
    // SQLite world IDs are case-sensitive; Windows directory names are not.
    // Hash the full identity rather than aliasing worlds such as "a" and "A".
    let world_key = digest(world);
    for component in ["godot-source", world_key.as_str(), "blobs"] {
        current.push(component);
        if create && !current.try_exists()? {
            match fs::create_dir(&current) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        ensure!(ordinary(&current, "PROJECT_STORAGE_UNAVAILABLE")?.is_dir(), "PROJECT_STORAGE_UNAVAILABLE");
    }
    Ok(current)
}

pub(super) fn blob_read(directory: &Path, world: &str, entry: &FileEntry) -> Result<String> {
    String::from_utf8(blob_read_bytes(directory,world,entry)?).context("CONTENT_NOT_UTF8")
}

pub(super) fn blob_read_bytes(directory: &Path, world: &str, entry: &FileEntry) -> Result<Vec<u8>> {
    valid_hash(&entry.sha256)?;
    let path = blob_directory(directory, world, false)?.join(&entry.sha256);
    let meta = ordinary(&path, "PROJECT_STORAGE_UNAVAILABLE")?;
    ensure!(
        meta.is_file() && meta.len() == entry.bytes && meta.len() <= FILE_LIMIT as u64,
        "CORRUPT_PROJECT_FILE"
    );
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT.
    }
    let mut text = Vec::new();
    options
        .open(path)?
        .take(FILE_LIMIT as u64 + 1)
        .read_to_end(&mut text)
        .context("CORRUPT_PROJECT_FILE")?;
    ensure!(
        text.len() as u64 == entry.bytes && digest_bytes(&text) == entry.sha256,
        "CORRUPT_PROJECT_FILE"
    );
    Ok(text)
}

pub(super) fn blob_write(directory: &Path, world: &str, entry: &FileEntry, text: &str) -> Result<()> {
    blob_write_bytes(directory,world,entry,text.as_bytes())
}

pub(super) fn blob_write_bytes(directory: &Path, world: &str, entry: &FileEntry, text: &[u8]) -> Result<()> {
    let parent = blob_directory(directory, world, true)?;
    let target = parent.join(&entry.sha256);
    if fs::symlink_metadata(&target).is_ok() {
        blob_read_bytes(directory, world, entry)?;
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
        file.write_all(text)?;
        file.sync_all()?;
        drop(file);
        // The immediate SQLite transaction serializes writers across connections.
        // Existing immutable data is verified, never overwritten to repair corruption.
        if fs::symlink_metadata(&target).is_ok() {
            blob_read_bytes(directory, world, entry)?;
        } else {
            fs::rename(&temporary, &target)?;
        }
        #[cfg(unix)]
        {
            fs::File::open(&parent)?.sync_all()?;
        }
        blob_read_bytes(directory, world, entry)?;
        Ok(())
    })();
    if temporary.try_exists().unwrap_or(false) {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(super) fn load_manifest(
    db: &Connection,
    world: &str,
    revision: Option<u64>,
) -> Result<(Manifest, String)> {
    let (stored_revision, body, hash): (i64, String, String) = if let Some(revision) = revision {
        db.query_row("SELECT revision,manifest,hash FROM craftmine_godot_revisions WHERE world_id=?1 AND revision=?2", params![world,i64::try_from(revision)?], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
    } else {
        db.query_row("SELECT revision,manifest,hash FROM craftmine_godot_projects WHERE world_id=?1", [world], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
    }.context("GODOT_PROJECT_NOT_FOUND")?;
    ensure!(
        body.len() <= MANIFEST_LIMIT && digest(&body) == hash,
        "CORRUPT_PROJECT_MANIFEST"
    );
    let manifest: Manifest = serde_json::from_str(&body).context("CORRUPT_PROJECT_MANIFEST")?;
    validate_manifest(&manifest)?;
    ensure!(
        manifest.world_id == world
            && u64::try_from(stored_revision).ok() == Some(manifest.revision)
            && revision.is_none_or(|value| value == manifest.revision),
        "CORRUPT_PROJECT_MANIFEST"
    );
    Ok((manifest, hash))
}

// ---- managed Git content backend -------------------------------------------
//
// A world switched to the Git backend keeps only a head index in SQLite: the
// manifest is the path/hash/byte index and the project metadata. File bytes,
// history, branches and versions live in the managed repository, so there is
// exactly one content history per world.

/// Commit a stored revision maps to. `None` means the revision was never
/// committed (a legacy row that has not been migrated).
pub(super) fn git_commit_for(
    db: &Connection,
    world: &str,
    revision: u64,
) -> Result<Option<String>> {
    let revision = i64::try_from(revision)?;
    let own: Option<String> = db
        .query_row(
            "SELECT commit_oid FROM craftmine_godot_project_commits WHERE world_id=?1 AND revision=?2",
            params![world, revision],
            |row| row.get(0),
        )
        .optional()?;
    if own.is_some() {
        return Ok(own);
    }
    // A revision imported by the legacy migration is indexed by the content
    // history's own map; both tables are indexes into the same Git repository.
    Ok(db
        .query_row(
            "SELECT commit_oid FROM craftmine_content_revision_map WHERE world_id=?1 AND legacy_revision=?2",
            params![world, revision],
            |row| row.get(0),
        )
        .optional()?)
}

fn record_git_commit(
    db: &Connection,
    world: &str,
    revision: u64,
    commit_oid: &str,
    manifest_hash: &str,
    asset_lock_hash: &str,
    task_id: &str,
    tool_call_id: &str,
) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO craftmine_godot_project_commits(world_id,revision,commit_oid,
            manifest_hash,asset_lock_hash,task_id,tool_call_id,created_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            world,
            i64::try_from(revision)?,
            commit_oid,
            manifest_hash,
            asset_lock_hash,
            task_id,
            tool_call_id,
            worlds::timestamp()?
        ],
    )?;
    Ok(())
}

/// Commit subject and trailers for one authored revision.
fn project_commit_message(revision: u64, request: &str, task: &str) -> String {
    format!("Craftmine project revision {revision}\n\nCraftmine-Request: {request}\nCraftmine-Task: {task}\nCraftmine-Revision: {revision}\n")
}

/// The Git head for a world, reconciling a commit that landed before the SQLite
/// index could record it. Git is authoritative for content, so an adopted head
/// is re-indexed rather than overwritten.
fn reconcile_git_head(
    journal: &TaskJournal,
    world: &str,
    stored_revision: u64,
    stored_commit: Option<&str>,
) -> Result<Option<(u64, String)>> {
    let (store, layout) = journal.content_layout(world)?;
    let head = store.branch_head(&layout, repo::MAIN_BRANCH)?;
    match (head, stored_commit) {
        (None, None) => Ok(None),
        (Some(head), Some(stored)) if head == stored => Ok(Some((stored_revision, head))),
        (Some(head), _) => {
            // The commit exists but the index did not record it (crash between
            // the Git ref update and the SQLite commit). Adopt it.
            let message = store.git().repo(
                &layout.git_dir,
                &["log", "-1", "--format=%B", &head],
            )?;
            ensure!(message.ok(), "GIT_LOG_FAILED: {}", message.stderr.trim());
            let revision = message
                .stdout_text()?
                .lines()
                .find_map(|line| line.strip_prefix("Craftmine-Revision: "))
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(stored_revision + 1);
            Ok(Some((revision, head)))
        }
        (None, Some(_)) => anyhow::bail!("GODOT_PROJECT_HEAD_MISSING"),
    }
}

/// Exact bytes for every file of a manifest plus the canonical asset lock. Files
/// not in `changed` are read back from the current commit and re-hashed.
fn git_content_files(
    store: &repo::RepositoryStore,
    layout: &repo::RepoLayout,
    db: &Connection,
    world: &str,
    manifest: &Manifest,
    head: Option<&str>,
    changed: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<ContentFile>> {
    let mut files = Vec::with_capacity(manifest.files.len() + 1);
    for (path, entry) in &manifest.files {
        let bytes = match changed.get(path) {
            Some(text) => text.clone(),
            None => {
                let head = head.context("GODOT_PROJECT_HEAD_MISSING")?;
                let bytes = store.read_file(layout, head, path)?;
                ensure!(
                    digest_bytes(&bytes) == entry.sha256,
                    "CORRUPT_PROJECT_FILE"
                );
                bytes
            }
        };
        files.push(ContentFile {
            path: path.clone(),
            bytes,
        });
    }
    let (_, assets) = godot_builds::asset_manifest(db, world)?;
    if let Some(file) = files.iter().find(|file| file.path == super::content_history::contract::ASSET_LOCK_FILE) {
        let lock: super::content_history::contract::AssetLock = serde_json::from_slice(&file.bytes)?;
        ensure!(lock.canonical_bytes()? == file.bytes, "INVALID_ASSET_LOCK");
    } else if let Some(lock) = godot_builds::asset_lock(&assets)? {
        files.push(ContentFile::asset_lock(&lock)?);
    }
    Ok(files)
}

fn committed_lock_hash(files:&[ContentFile])->Result<String> {
    if let Some(file)=files.iter().find(|file|file.path==super::content_history::contract::ASSET_LOCK_FILE) {
        let lock:super::content_history::contract::AssetLock=serde_json::from_slice(&file.bytes)?;
        lock.asset_lock_hash()
    } else { super::content_history::contract::AssetLock::empty().asset_lock_hash() }
}

/// Exact bytes for a world, read from Git when the world uses the Git backend.
fn read_project_file(
    journal: &TaskJournal,
    world: &str,
    revision: u64,
    path: &str,
    entry: &FileEntry,
) -> Result<String> {
    read_indexed_file(journal, world, revision, path, entry)
}

/// Exact text of one indexed file at one revision.
///
/// A Git-backed world has no blob store: the commit is the content, so the file
/// is read from the commit and its digest re-checked. A legacy world reads the
/// immutable blob. Consumers that materialize a copy or a backup descriptor use
/// this instead of assuming the blob store exists.
pub(super) fn read_indexed_file(
    journal: &TaskJournal,
    world: &str,
    revision: u64,
    path: &str,
    entry: &FileEntry,
) -> Result<String> {
    String::from_utf8(read_indexed_bytes(journal,world,revision,path,entry)?).context("CONTENT_NOT_UTF8")
}

pub(super) fn read_indexed_bytes(journal: &TaskJournal,world: &str,revision: u64,path: &str,entry: &FileEntry) -> Result<Vec<u8>> {
    if journal.is_git_backed(world)? {
        let (store, layout) = journal.content_layout(world)?;
        let commit = git_commit_for(&journal.db, world, revision)?
            .context("GODOT_PROJECT_REVISION_NOT_INDEXED")?;
        let bytes = store.read_file(&layout, &commit, path)?;
        ensure!(digest_bytes(&bytes) == entry.sha256, "CORRUPT_PROJECT_FILE");
        return Ok(bytes);
    }
    blob_read_bytes(&journal.directory, world, entry)
}

/// Every indexed file of a manifest with its exact text, using the backend the
/// world really uses. Returned in path order so a copy is deterministic.
pub(super) fn read_manifest_files(
    journal: &TaskJournal,
    world: &str,
    manifest: &Manifest,
) -> Result<Vec<(String, FileEntry, Vec<u8>)>> {
    let mut files = Vec::with_capacity(manifest.files.len());
    for (path, entry) in &manifest.files {
        let text = read_indexed_bytes(journal, world, manifest.revision, path, entry)?;
        files.push((path.clone(), entry.clone(), text));
    }
    Ok(files)
}

pub(super) fn digest_bytes(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Digest of exact file bytes, shared with build materialization.
pub(super) fn file_digest(bytes: &[u8]) -> String {
    digest_bytes(bytes)
}

/// Persist the head index for a Git-backed revision. No `craftmine_godot_revisions`
/// row is written: history comes from the repository, not from a parallel table.
fn store_git_index(
    db: &Connection,
    manifest: &Manifest,
    call: &str,
    request_hash: &str,
    commit_oid: &str,
    asset_lock_hash: &str,
    branch: &str,
) -> Result<Value> {
    let body = serde_json::to_string(manifest)?;
    ensure!(body.len() <= MANIFEST_LIMIT, "PROJECT_MANIFEST_TOO_LARGE");
    let hash = digest(&body);
    if branch==repo::MAIN_BRANCH { db.execute(
        "INSERT INTO craftmine_godot_projects(world_id,revision,manifest,hash) VALUES(?1,?2,?3,?4)
         ON CONFLICT(world_id) DO UPDATE SET revision=excluded.revision,manifest=excluded.manifest,hash=excluded.hash",
        params![manifest.world_id, i64::try_from(manifest.revision)?, body, hash],
    )?; }
    record_git_commit(
        db,
        &manifest.world_id,
        manifest.revision,
        commit_oid,
        &hash,
        asset_lock_hash,
        &manifest.task.task_id,
        call,
    )?;
    db.execute("UPDATE craftmine_godot_project_commits SET manifest=?3,branch_id=?4 WHERE world_id=?1 AND revision=?2",
        params![manifest.world_id,i64::try_from(manifest.revision)?,body,branch])?;
    let result = json!({"revision":manifest.revision,"manifestHash":hash,"baseBuild":manifest.base_build,
        "fileCount":manifest.files.len(),"currentTaskId":manifest.task.task_id,"lastWriter":manifest.task,
        "commitOid":commit_oid,"assetLockHash":asset_lock_hash,"branchId":branch});
    db.execute(
        "INSERT INTO craftmine_godot_receipts(task_id,tool_call_id,request_hash,result) VALUES(?1,?2,?3,?4)",
        params![manifest.task.task_id, call, request_hash, serde_json::to_string(&result)?],
    )?;
    Ok(result)
}

impl TaskJournal {
    /// Return an existing world-bound session head for trusted source readers.
    /// This does not create a task, acquire a write lease, or mutate Git.
    pub fn godot_project_source_context(&self, args: &Value) -> Result<Value> {
        #[derive(Deserialize)]
        #[serde(rename_all="camelCase", deny_unknown_fields)]
        struct Args { world_id: String }
        let args: Args=serde_json::from_value(args.clone())?;
        worlds::read(&self.db,&args.world_id)?;
        let exists: bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_godot_projects WHERE world_id=?1)",
            [&args.world_id],|row|row.get(0))?;
        ensure!(exists,"GODOT_PROJECT_NOT_FOUND");
        let binding: Option<String>=self.db.query_row(
            "SELECT t.binding FROM craftmine_session_worlds s JOIN craftmine_tasks t ON t.id=s.head_task
             JOIN craftmine_workspaces w ON w.task_id=t.id AND w.world_id=s.world_id
             WHERE s.world_id=?1 ORDER BY t.rowid DESC LIMIT 1",[&args.world_id],|row|row.get(0)).optional()?;
        let binding: TaskBinding=serde_json::from_str(&binding.context("GODOT_SOURCE_CONTEXT_UNAVAILABLE")?)?;
        let context=WorkspaceContext {project_id:binding.project_id,session_id:binding.session_id,turn_id:binding.turn_id};
        let snapshot=workspaces::inspect(&self.db,&context)?;
        ensure!(snapshot.world_id==args.world_id,"PROJECT_WORLD_BINDING_MISMATCH");
        Ok(json!({"context":context}))
    }

    /// Manifest for the head (or an indexed revision) of a world, adopting a Git
    /// commit that landed before the SQLite index could record it. Git is
    /// authoritative for content, so the index is rebuilt from the commit rather
    /// than the commit being overwritten.
    pub(super) fn project_manifest(
        &self,
        world: &str,
        revision: Option<u64>,
    ) -> Result<(Manifest, String)> {
        self.project_manifest_for(world,revision,repo::MAIN_BRANCH)
    }

    pub(super) fn project_manifest_for(&self, world:&str,revision:Option<u64>,branch:&str)->Result<(Manifest,String)> {
        super::content_history::contract::validate_identifier(branch,"INVALID_BRANCH_ID")?;
        if !self.is_git_backed(world)? {
            ensure!(branch==repo::MAIN_BRANCH,"CONTENT_BRANCH_REQUIRES_GIT");
            return load_manifest(&self.db, world, revision);
        }
        if branch!=repo::MAIN_BRANCH {
            let (store,layout)=self.content_layout(world)?;
            let head=store.branch_head(&layout,branch)?.context("CONTENT_BRANCH_NOT_FOUND")?;
            let indexed:Option<(String,String,String)>=self.db.query_row(
                "SELECT manifest,manifest_hash,commit_oid FROM craftmine_godot_project_commits WHERE world_id=?1 AND branch_id=?2 AND manifest IS NOT NULL AND (?3 IS NULL OR revision=?3) ORDER BY revision DESC LIMIT 1",
                params![world,branch,revision.map(i64::try_from).transpose()?],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
            if let Some((body,hash,oid))=&indexed {
                if revision.is_some() || oid==&head {
                    ensure!(digest(body)==*hash,"CORRUPT_PROJECT_MANIFEST");
                    let manifest:Manifest=serde_json::from_str(body)?; validate_manifest(&manifest)?;
                    return Ok((manifest,hash.clone()));
                }
            }
            ensure!(revision.is_none(),"GODOT_PROJECT_REVISION_NOT_INDEXED");
            let mut manifest=if let Some((body,_,_))=indexed {serde_json::from_str::<Manifest>(&body)?}else{load_manifest(&self.db,world,None)?.0};
            manifest.revision=next_git_revision(&self.db,world)?;
            manifest.files.clear();
            for entry in store.tree_entries(&layout,&head)? {
                ensure!(matches!(entry.mode.as_str(),"100644"|"100755"),"CONTENT_COPY_UNSUPPORTED_ENTRY");
                source_path(&entry.path)?;
                let bytes=store.read_file(&layout,&head,&entry.path)?;
                manifest.files.insert(entry.path,FileEntry{sha256:digest_bytes(&bytes),bytes:bytes.len() as u64});
            }
            validate_manifest(&manifest)?;
            let body=serde_json::to_string(&manifest)?; let hash=digest(&body);
            let lock=store.asset_lock(&layout,&head)?.unwrap_or_else(super::content_history::contract::AssetLock::empty);
            record_git_commit(&self.db,world,manifest.revision,&head,&hash,&lock.asset_lock_hash()?,&manifest.task.task_id,"branch-index")?;
            self.db.execute("UPDATE craftmine_godot_project_commits SET manifest=?3,branch_id=?4 WHERE world_id=?1 AND revision=?2",
                params![world,i64::try_from(manifest.revision)?,body,branch])?;
            return Ok((manifest,hash));
        }
        let (manifest, hash) = load_manifest(&self.db, world, None)?;
        if let Some(revision)=revision {
            if revision==manifest.revision { return Ok((manifest,hash)); }
            let indexed:Option<(String,String)>=self.db.query_row(
                "SELECT manifest,manifest_hash FROM craftmine_godot_project_commits WHERE world_id=?1 AND revision=?2 AND branch_id='main' AND manifest IS NOT NULL",
                params![world,i64::try_from(revision)?],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
            if let Some((body,hash))=indexed {
                ensure!(digest(&body)==hash,"CORRUPT_PROJECT_MANIFEST");
                let manifest:Manifest=serde_json::from_str(&body)?;
                validate_manifest(&manifest)?;
                ensure!(manifest.world_id==world && manifest.revision==revision,"CORRUPT_PROJECT_MANIFEST");
                return Ok((manifest,hash));
            }
            return load_manifest(&self.db,world,Some(revision));
        }
        let stored = git_commit_for(&self.db, world, manifest.revision)?;
        let (store, layout) = self.content_layout(world)?;
        let head = store.branch_head(&layout, repo::MAIN_BRANCH)?;
        if head == stored {
            return Ok((manifest, hash));
        }
        let head = head.context("GODOT_PROJECT_HEAD_MISSING")?;
        let message = store
            .git()
            .repo(&layout.git_dir, &["log", "-1", "--format=%B", &head])?;
        ensure!(message.ok(), "GIT_LOG_FAILED: {}", message.stderr.trim());
        let mut revision = message
            .stdout_text()?
            .lines()
            .find_map(|line| line.strip_prefix("Craftmine-Revision: "))
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(next_git_revision(&self.db,world)?);
        let collision:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_godot_project_commits WHERE world_id=?1 AND revision=?2 AND (commit_oid<>?3 OR branch_id<>'main'))",
            params![world,i64::try_from(revision)?,head],|r|r.get(0))?;
        if collision {revision=next_git_revision(&self.db,world)?;}
        let mut files = BTreeMap::new();
        for entry in store.tree_entries(&layout, &head)? {
            ensure!(
                matches!(entry.mode.as_str(), "100644" | "100755"),
                "CONTENT_COPY_UNSUPPORTED_ENTRY: {}",
                entry.path
            );
            let bytes = store.read_file(&layout, &head, &entry.path)?;
            files.insert(
                entry.path,
                FileEntry {
                    sha256: digest_bytes(&bytes),
                    bytes: bytes.len() as u64,
                },
            );
        }
        let mut adopted = manifest;
        adopted.files = files;
        adopted.revision = revision;
        validate_manifest(&adopted)?;
        let lock_hash = godot_builds::asset_lock_hash(&self.db, world)?;
        store_git_index(
            &self.db,
            &adopted,
            &format!("@host:adopt-{head}"),
            &digest(&head),
            &head,
            &lock_hash,
            repo::MAIN_BRANCH,
        )?;
        let body = serde_json::to_string(&adopted)?;
        Ok((adopted, digest(&body)))
    }

    pub(super) fn project_file_text(
        &self,
        world: &str,
        revision: u64,
        path: &str,
        entry: &FileEntry,
    ) -> Result<String> {
        read_project_file(self, world, revision, path, entry)
    }

    pub(super) fn project_is_git_backed(&self, world: &str) -> Result<bool> {
        self.is_git_backed(world)
    }
}

fn next_git_revision(db:&Connection,world:&str)->Result<u64> {
    let max:i64=db.query_row("SELECT MAX(revision) FROM (SELECT revision FROM craftmine_godot_projects WHERE world_id=?1 UNION ALL SELECT revision FROM craftmine_godot_project_commits WHERE world_id=?1)",[world],|row|row.get(0))?;
    u64::try_from(max.checked_add(1).context("REVISION_LIMIT")?).context("REVISION_LIMIT")
}

pub(super) fn branch_head_manifest(db:&Connection,world:&str,branch:&str)->Result<(Manifest,String)> {
    if branch==repo::MAIN_BRANCH {return load_manifest(db,world,None)}
    let (body,hash):(String,String)=db.query_row("SELECT manifest,manifest_hash FROM craftmine_godot_project_commits WHERE world_id=?1 AND branch_id=?2 AND manifest IS NOT NULL ORDER BY revision DESC LIMIT 1",params![world,branch],|r|Ok((r.get(0)?,r.get(1)?))).context("CONTENT_BRANCH_NOT_INDEXED")?;
    ensure!(digest(&body)==hash,"CORRUPT_PROJECT_MANIFEST");
    let manifest=serde_json::from_str(&body)?;validate_manifest(&manifest)?;Ok((manifest,hash))
}

fn scope(
    db: &Connection,
    ctx: &WorkspaceContext,
    world: &str,
    write: bool,
) -> Result<workspaces::WorkspaceSnapshot> {    worlds::validate_id(world)?;
    let snapshot = workspaces::inspect(db, ctx)?;
    ensure!(snapshot.world_id == world, "PROJECT_WORLD_BINDING_MISMATCH");
    if write {
        workspaces::assert_live(db, &snapshot)?;
    }
    Ok(snapshot)
}

fn bound_version(manifest: &Manifest, hash: &str, revision: u64, expected: &str) -> Result<()> {
    valid_hash(expected)?;
    ensure!(
        manifest.revision == revision && hash == expected,
        "GODOT_PROJECT_REVISION_CONFLICT"
    );
    Ok(())
}

fn request_hash(method: &str, args: &Value) -> Result<String> {
    let body = serde_json::to_string(&json!({"method":method,"params":args}))?;
    // This limit is independent of the old 2 MB scene-draft document limit.
    ensure!(
        body.len() <= PATCH_LIMIT + 128 * 1024,
        "PROJECT_REQUEST_TOO_LARGE"
    );
    Ok(digest(&body))
}

fn receipt(db: &Connection, task: &str, call: &str, hash: &str) -> Result<Option<Value>> {
    workspaces::call_id(call)?;
    let prior: Option<(String, String)> = db.query_row("SELECT request_hash,result FROM craftmine_godot_receipts WHERE task_id=?1 AND tool_call_id=?2", params![task,call], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
    prior
        .map(|(stored, result)| {
            ensure!(stored == hash, "REPLAY_MISMATCH");
            Ok(serde_json::from_str(&result)?)
        })
        .transpose()
}

fn store(db: &Connection, manifest: &Manifest, call: &str, request_hash: &str) -> Result<Value> {
    validate_manifest(manifest)?;
    let body = serde_json::to_string(manifest)?;
    ensure!(body.len() <= MANIFEST_LIMIT, "PROJECT_MANIFEST_TOO_LARGE");
    let hash = digest(&body);
    let revision = i64::try_from(manifest.revision)?;
    db.execute("INSERT INTO craftmine_godot_revisions(world_id,revision,task_id,manifest,hash) VALUES(?1,?2,?3,?4,?5)",params![manifest.world_id,revision,manifest.task.task_id,body,hash])?;
    db.execute("INSERT INTO craftmine_godot_projects(world_id,revision,manifest,hash) VALUES(?1,?2,?3,?4)
        ON CONFLICT(world_id) DO UPDATE SET revision=excluded.revision,manifest=excluded.manifest,hash=excluded.hash",params![manifest.world_id,revision,body,hash])?;
    let result = json!({"worldId":manifest.world_id,"taskId":manifest.task.task_id,"toolCallId":call,
        "revision":manifest.revision,"manifestHash":hash,"baseBuild":manifest.base_build,"fileCount":manifest.files.len(),
        "bytes":manifest.files.values().map(|file|file.bytes).sum::<u64>(),"status":"source-only","verified":false,"applied":false});
    db.execute("INSERT INTO craftmine_godot_receipts(task_id,tool_call_id,request_hash,result) VALUES(?1,?2,?3,?4)",params![manifest.task.task_id,call,request_hash,serde_json::to_string(&result)?])?;
    Ok(result)
}

impl TaskJournal {
    pub fn godot_project_create(&mut self, args: &Value) -> Result<Value> {
        let _operation_lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let request_hash = request_hash("godotProject.create", args)?;
        let args: CreateArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.tool_call_id)?;
        ensure!(
            !args.files.is_empty() && args.files.len() <= 16,
            "INVALID_PROJECT_PATCH"
        );
        let mut files = BTreeMap::new();
        for file in &args.files {
            ensure!(!files.contains_key(&file.path), "PROJECT_PATH_COLLISION");
            files.insert(file.path.clone(), source_entry(&file.path, &file.text)?);
        }
        ensure!(
            files.values().map(|entry| entry.bytes).sum::<u64>() <= PATCH_LIMIT as u64,
            "PROJECT_REQUEST_TOO_LARGE"
        );
        let git_backed = self.is_git_backed(&args.world_id)?;
        let git = if git_backed {
            Some(self.content_layout(&args.world_id)?)
        } else {
            None
        };
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let workspace = scope(&tx, &args.context, &args.world_id, true)?;
        if !git_backed {
            // A world switched to the managed Git backend must not create a
            // second, parallel source history through the legacy tables.
            super::content_history::migration::assert_legacy_writes_allowed(&tx, &args.world_id)?;
        }
        if let Some(result) = receipt(
            &tx,
            &workspace.task.binding.task_id,
            &args.tool_call_id,
            &request_hash,
        )? {
            return Ok(result);
        }
        ensure!(
            args.base_build == workspace.task.binding.base_build,
            "WORLD_BUILD_CONFLICT"
        );
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_godot_projects WHERE world_id=?1)",
            [&args.world_id],
            |r| r.get(0),
        )?;
        ensure!(!exists, "GODOT_PROJECT_ALREADY_EXISTS");
        let manifest = Manifest {
            format: "craftmine.godot-project/1".into(),
            world_id: args.world_id.clone(),
            base_build: args.base_build,
            base_id: args.base_id,
            engine_version: "4.7.2-stable".into(),
            language: "GDScript".into(),
            renderer: "gl_compatibility".into(),
            target: "web".into(),
            revision: 0,
            task: workspace.task.binding,
            files,
        };
        validate_manifest(&manifest)?;
        let result = if let Some((store, layout)) = &git {
            let changed: BTreeMap<String, Vec<u8>> = args
                .files
                .iter()
                .map(|file| (file.path.clone(), file.text.as_bytes().to_vec()))
                .collect();
            let content = git_content_files(store, layout, &tx, &args.world_id, &manifest, None, &changed)?;
            let lock_hash = committed_lock_hash(&content)?;
            let message = project_commit_message(
                0,
                &args.tool_call_id,
                &manifest.task.task_id,
            );
            let oid = store.commit(layout, repo::MAIN_BRANCH, None, &content, &message)?;
            store_git_index(
                &tx,
                &manifest,
                &args.tool_call_id,
                &request_hash,
                &oid,
                &lock_hash,
                repo::MAIN_BRANCH,
            )?
        } else {
            for file in args.files {
                blob_write(
                    &self.directory,
                    &args.world_id,
                    &manifest.files[&file.path],
                    &file.text,
                )?;
            }
            store(&tx, &manifest, &args.tool_call_id, &request_hash)?
        };
        tx.commit()?;
        Ok(result)
    }

    pub fn godot_project_index(&self, args: &Value) -> Result<Value> {
        let _operation_lock=crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: IndexArgs = serde_json::from_value(args.clone())?;
        let workspace = scope(&self.db, &args.context, &args.world_id, false)?;
        ensure!(
            args.limit > 0
                && args.limit <= 32
                && args.revision.is_some() == args.manifest_hash.is_some(),
            "INVALID_PROJECT_PAGE"
        );
        let (manifest, hash) = self.project_manifest_for(&args.world_id, args.revision,&args.branch_id)?;
        if let (Some(revision), Some(expected)) = (args.revision, args.manifest_hash) {
            bound_version(&manifest, &hash, revision, &expected)?;
        }
        ensure!(args.offset <= manifest.files.len(), "INVALID_PROJECT_PAGE");
        let files: Vec<Value> = manifest
            .files
            .iter()
            .skip(args.offset)
            .take(args.limit)
            .map(|(path, file)| json!({"path":path,"sha256":file.sha256,"bytes":file.bytes}))
            .collect();
        let next = args.offset + files.len();
        Ok(
            json!({"format":manifest.format,"worldId":manifest.world_id,"branchId":args.branch_id,"revision":manifest.revision,"manifestHash":hash,
            "baseBuild":manifest.base_build,"currentTaskId":workspace.task.binding.task_id,"lastWriter":manifest.task,
            "baseId":manifest.base_id,"engineVersion":manifest.engine_version,"language":manifest.language,"renderer":manifest.renderer,"target":manifest.target,
            "files":files,"totalFiles":manifest.files.len(),"nextOffset":(next<manifest.files.len()).then_some(next),
            "status":"source-only","verified":false,"applied":false,"executionAvailable":false,"binaryAssetsAvailable":false}),
        )
    }

    pub fn godot_project_read(&self, args: &Value) -> Result<Value> {
        let _operation_lock=crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: ReadArgs = serde_json::from_value(args.clone())?;
        scope(&self.db, &args.context, &args.world_id, false)?;
        source_path(&args.path)?;
        ensure!(
            args.limit > 0 && args.limit <= 16000,
            "INVALID_PROJECT_PAGE"
        );
        let (manifest, hash) = self.project_manifest_for(&args.world_id, Some(args.revision),&args.branch_id)?;
        bound_version(&manifest, &hash, args.revision, &args.manifest_hash)?;
        let entry = manifest
            .files
            .get(&args.path)
            .context("PROJECT_FILE_NOT_FOUND")?;
        if matches!(args.path.rsplit('.').next(),Some("png"|"jpg"|"jpeg"|"webp"|"wav"|"ogg"|"glb")) {
            let bytes=read_indexed_bytes(self,&args.world_id,manifest.revision,&args.path,entry)?;
            ensure!(args.offset<=bytes.len(),"INVALID_PROJECT_PAGE");
            let end=(args.offset+args.limit).min(bytes.len());
            return Ok(json!({"worldId":args.world_id,"revision":manifest.revision,"manifestHash":hash,"path":args.path,
                "sha256":entry.sha256,"bytes":entry.bytes,"offset":args.offset,"encoding":"base64",
                "bytesBase64":STANDARD.encode(&bytes[args.offset..end]),"totalBytes":bytes.len(),"nextOffset":(end<bytes.len()).then_some(end)}));
        }
        let source = self.project_file_text(&args.world_id, manifest.revision, &args.path, entry)?;
        let total = source.chars().count();
        ensure!(args.offset <= total, "INVALID_PROJECT_PAGE");
        let text: String = source.chars().skip(args.offset).take(args.limit).collect();
        let next = args.offset + text.chars().count();
        Ok(
            json!({"worldId":args.world_id,"revision":manifest.revision,"manifestHash":hash,"path":args.path,
            "sha256":entry.sha256,"bytes":entry.bytes,"offset":args.offset,"text":text,"totalCharacters":total,"nextOffset":(next<total).then_some(next)}),
        )
    }

    pub fn godot_project_patch(&mut self, args: &Value) -> Result<Value> {
        self.project_patch_bytes(args, &request_hash("godotProject.patch", args)?, 16)
    }

    /// Private host installation transaction; bytes keep their project paths.
    pub fn godot_project_apply_files(&mut self, args: &Value) -> Result<Value> {
        #[derive(Deserialize)]
        #[serde(rename_all="camelCase",deny_unknown_fields)]
        struct File {path:String,bytes_base64:String,#[serde(deserialize_with="required_optional_hash")] expected_hash:Option<String>}
        #[derive(Deserialize)]
        #[serde(rename_all="camelCase",deny_unknown_fields)]
        struct Args { context: WorkspaceContext,world_id:String,tool_call_id:String,revision:u64,manifest_hash:String,
            operation:Option<super::content_history::contract::OperationContext>,files:Vec<File> }
        let hash=request_hash("godotProject.applyFiles",args)?;
        let parsed:Args=serde_json::from_value(args.clone())?;
        let operations:Vec<Value>=parsed.files.into_iter().map(|file|json!({"op":"putBytes","path":file.path,
            "bytesBase64":file.bytes_base64,"expectedHash":file.expected_hash})).collect();
        self.project_patch_bytes(&json!({"context":parsed.context,"worldId":parsed.world_id,"toolCallId":parsed.tool_call_id,
            "revision":parsed.revision,"manifestHash":parsed.manifest_hash,"operation":parsed.operation,"operations":operations}),&hash,FILE_COUNT)
    }

    fn project_patch_bytes(&mut self, args:&Value, request_hash:&str, operation_limit:usize) -> Result<Value> {
        let _operation_lock = crate::operation_lock::OperationLock::domain(&self.directory)?;
        let args: PatchArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.tool_call_id)?;
        ensure!(
            !args.operations.is_empty() && args.operations.len() <= operation_limit,
            "INVALID_PROJECT_PATCH"
        );
        let git_backed = self.is_git_backed(&args.world_id)?;
        let git = if git_backed {
            Some(self.content_layout(&args.world_id)?)
        } else {
            None
        };
        // Binding is checked before any content read, so a foreign world context
        // reports the binding mismatch rather than a missing project.
        scope(&self.db, &args.context, &args.world_id, false)?;
        // Loading before the transaction reconciles a commit that landed before
        // its SQLite index row; the Git CAS below is the real write guard.
        let branch=args.operation.as_ref().map(|op|op.branch_id.as_str()).unwrap_or(repo::MAIN_BRANCH);
        let (mut manifest, hash) = self.project_manifest_for(&args.world_id, None,branch)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let workspace = scope(&tx, &args.context, &args.world_id, true)?;
        if !git_backed {
            super::content_history::migration::assert_legacy_writes_allowed(&tx, &args.world_id)?;
        }
        if let Some(result) = receipt(
            &tx,
            &workspace.task.binding.task_id,
            &args.tool_call_id,
            &request_hash,
        )? {
            return Ok(result);
        }
        bound_version(&manifest, &hash, args.revision, &args.manifest_hash)?;
        // Continuing to edit an applied world must bind the *current* formal
        // build. The old lineage is accepted only when the world document really
        // carries it, so a forged base string cannot unlock a foreign project.
        let world = worlds::read(&tx, &args.world_id)?;
        let applied_lineage = world.world.build["scene"]["format"] == "craftmine.godot-scene/1"
            && world.world.build["id"] == workspace.task.binding.base_build
            && world.world.build["godot"]["baseBuild"] == manifest.base_build;
        ensure!(
            manifest.base_build == workspace.task.binding.base_build || applied_lineage,
            "WORLD_BUILD_CONFLICT"
        );
        let original_files = manifest.files.clone();
        let mut touched = BTreeSet::new();
        let mut text_files: BTreeMap<String,Vec<u8>> = BTreeMap::new();
        for operation in args.operations {
            let operation = match operation {
                Operation::Put{path,text,expected_hash} => {
                    source_entry(&path,&text)?;
                    Operation::PutBytes{path,bytes_base64:STANDARD.encode(text.as_bytes()),expected_hash}
                },
                other=>other,
            };
            match operation {
                Operation::PutBytes {
                    path,
                    bytes_base64,
                    expected_hash,
                } => {
                    source_path(&path)?;
                    let bytes=STANDARD.decode(bytes_base64).context("INVALID_PROJECT_BASE64")?;
                    ensure!(bytes.len()<=FILE_LIMIT,"PROJECT_FILE_TOO_LARGE");
                    if !matches!(path.rsplit('.').next(),Some("png"|"jpg"|"jpeg"|"webp"|"wav"|"ogg"|"glb")) {
                        source_entry(&path,std::str::from_utf8(&bytes).context("CONTENT_NOT_UTF8")?)?;
                    }
                    let entry=FileEntry{sha256:digest_bytes(&bytes),bytes:bytes.len() as u64};
                    if path==super::content_history::contract::ASSET_LOCK_FILE {
                        let lock:super::content_history::contract::AssetLock=serde_json::from_slice(&bytes)?;
                        ensure!(lock.canonical_bytes()?==bytes,"INVALID_ASSET_LOCK");
                    }
                    ensure!(
                        touched.insert(path.to_ascii_lowercase()),
                        "PROJECT_PATH_COLLISION"
                    );
                    if let Some(hash) = &expected_hash {
                        valid_hash(hash)?;
                    }
                    ensure!(
                        manifest.files.get(&path).map(|entry| &entry.sha256)
                            == expected_hash.as_ref(),
                        "PROJECT_FILE_CONFLICT"
                    );
                    manifest.files.insert(path.clone(), entry);
                    text_files.insert(path,bytes);
                }
                Operation::Remove {
                    path,
                    expected_hash,
                } => {
                    source_path(&path)?;
                    valid_hash(&expected_hash)?;
                    ensure!(
                        touched.insert(path.to_ascii_lowercase()),
                        "PROJECT_PATH_COLLISION"
                    );
                    ensure!(
                        manifest
                            .files
                            .get(&path)
                            .is_some_and(|entry| entry.sha256 == expected_hash),
                        "PROJECT_FILE_CONFLICT"
                    );
                    manifest.files.remove(&path);
                }
                Operation::Put{..}=>unreachable!(),
            }
        }
        ensure!(
            text_files.values().map(|file| file.len()).sum::<usize>() <= PATCH_LIMIT,
            "PROJECT_REQUEST_TOO_LARGE"
        );
        ensure!(manifest.files != original_files, "NO_CHANGE");
        let previous_revision=manifest.revision;
        manifest.revision = if git_backed {next_git_revision(&tx,&args.world_id)?} else {manifest.revision.checked_add(1).context("REVISION_LIMIT")?};
        manifest.task = workspace.task.binding;
        // A new immutable revision records the actual applied baseline this
        // writer used; older revisions keep their original baseline.
        if applied_lineage {
            manifest.base_build = manifest.task.base_build.clone();
        }
        validate_manifest(&manifest)?;
        let result = if let Some((store, layout)) = &git {
            let previous = previous_revision;
            let head = git_commit_for(&tx, &args.world_id, previous)?
                .context("GODOT_PROJECT_HEAD_MISSING")?;
            // The host binds the exact commit it read; a model cannot write over
            // a branch that moved underneath it, and only `main` is writable.
            let operation = args
                .operation
                .as_ref()
                .context("CONTENT_OPERATION_CONTEXT_REQUIRED")?;
            operation.validate()?;
            ensure!(
                operation.world_id == args.world_id,
                "CONTENT_CONTEXT_MISMATCH"
            );
            ensure!(operation.repo_id==layout.repo_id,"CONTENT_CONTEXT_MISMATCH");
            ensure!(
                operation.expected_head_oid.as_deref() == Some(head.as_str()),
                "CONTENT_EXPECTED_HEAD_MISMATCH"
            );
            let changed = text_files.clone();
            let content = git_content_files(store, layout, &tx, &args.world_id, &manifest, Some(&head), &changed)?;
            let lock_hash = committed_lock_hash(&content)?;
            let message = project_commit_message(
                manifest.revision,
                &args.tool_call_id,
                &manifest.task.task_id,
            );
            let oid = store.commit(
                layout,
                branch,
                Some(&head),
                &content,
                &message,
            )?;
            store_git_index(
                &tx,
                &manifest,
                &args.tool_call_id,
                &request_hash,
                &oid,
                &lock_hash,
                branch,
            )?
        } else {
            // Every surviving reference is integrity checked, including unchanged files.
            for (path, entry) in &original_files {
                if manifest.files.get(path) == Some(entry) {
                    blob_read_bytes(&self.directory, &args.world_id, entry)?;
                }
            }
            for (path,bytes) in text_files {
                blob_write_bytes(
                    &self.directory,
                    &args.world_id,
                    &manifest.files[&path],
                    &bytes,
                )?;
            }
            store(&tx, &manifest, &args.tool_call_id, &request_hash)?
        };
        tx.commit()?;
        Ok(result)
    }

    /// Read an exact receipt after turn completion/restart without reopening a
    /// lease or allowing a late mutation. The binding comes from trusted host state.
    pub fn godot_project_receipt(&self, args: &Value) -> Result<Value> {
        let args: ReceiptArgs = serde_json::from_value(args.clone())?;
        args.binding.validate()?;
        ensure!(
            matches!(
                args.method.as_str(),
                "godotProject.create" | "godotProject.patch" | "godotProject.applyFiles"
            ),
            "INVALID_PROJECT_METHOD"
        );
        let task = super::read_task(&self.db, &args.binding.task_id)?;
        super::assert_binding(&task, &args.binding)?;
        let world: String = self.db.query_row(
            "SELECT world_id FROM craftmine_workspaces WHERE task_id=?1",
            [&args.binding.task_id],
            |r| r.get(0),
        )?;
        ensure!(world == args.world_id, "PROJECT_WORLD_BINDING_MISMATCH");
        Ok(receipt(
            &self.db,
            &args.binding.task_id,
            &args.tool_call_id,
            &request_hash(&args.method, &args.request)?,
        )?
        .unwrap_or(Value::Null))
    }
}
