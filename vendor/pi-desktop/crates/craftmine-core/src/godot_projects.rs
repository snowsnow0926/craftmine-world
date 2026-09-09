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
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{digest, workspaces, worlds, TaskBinding, TaskJournal, WorkspaceContext};

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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IndexArgs {
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
    db.execute_batch("CREATE TABLE IF NOT EXISTS craftmine_godot_projects (
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
    );")?;
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
    let mut text = String::new();
    options
        .open(path)?
        .take(FILE_LIMIT as u64 + 1)
        .read_to_string(&mut text)
        .context("CORRUPT_PROJECT_FILE")?;
    ensure!(
        text.len() as u64 == entry.bytes && digest(&text) == entry.sha256,
        "CORRUPT_PROJECT_FILE"
    );
    Ok(text)
}

pub(super) fn blob_write(directory: &Path, world: &str, entry: &FileEntry, text: &str) -> Result<()> {
    let parent = blob_directory(directory, world, true)?;
    let target = parent.join(&entry.sha256);
    if fs::symlink_metadata(&target).is_ok() {
        blob_read(directory, world, entry)?;
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
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        drop(file);
        // The immediate SQLite transaction serializes writers across connections.
        // Existing immutable data is verified, never overwritten to repair corruption.
        if fs::symlink_metadata(&target).is_ok() {
            blob_read(directory, world, entry)?;
        } else {
            fs::rename(&temporary, &target)?;
        }
        #[cfg(unix)]
        {
            fs::File::open(&parent)?.sync_all()?;
        }
        blob_read(directory, world, entry)?;
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
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let workspace = scope(&tx, &args.context, &args.world_id, true)?;
        // A world switched to the managed Git backend must not create a second,
        // parallel source history through the legacy tables.
        super::content_history::migration::assert_legacy_writes_allowed(&tx, &args.world_id)?;
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
        for file in args.files {
            blob_write(
                &self.directory,
                &args.world_id,
                &manifest.files[&file.path],
                &file.text,
            )?;
        }
        let result = store(&tx, &manifest, &args.tool_call_id, &request_hash)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn godot_project_index(&self, args: &Value) -> Result<Value> {
        let args: IndexArgs = serde_json::from_value(args.clone())?;
        let workspace = scope(&self.db, &args.context, &args.world_id, false)?;
        ensure!(
            args.limit > 0
                && args.limit <= 32
                && args.revision.is_some() == args.manifest_hash.is_some(),
            "INVALID_PROJECT_PAGE"
        );
        let (manifest, hash) = load_manifest(&self.db, &args.world_id, args.revision)?;
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
            json!({"format":manifest.format,"worldId":manifest.world_id,"revision":manifest.revision,"manifestHash":hash,
            "baseBuild":manifest.base_build,"currentTaskId":workspace.task.binding.task_id,"lastWriter":manifest.task,
            "baseId":manifest.base_id,"engineVersion":manifest.engine_version,"language":manifest.language,"renderer":manifest.renderer,"target":manifest.target,
            "files":files,"totalFiles":manifest.files.len(),"nextOffset":(next<manifest.files.len()).then_some(next),
            "status":"source-only","verified":false,"applied":false,"executionAvailable":false,"binaryAssetsAvailable":false}),
        )
    }

    pub fn godot_project_read(&self, args: &Value) -> Result<Value> {
        let args: ReadArgs = serde_json::from_value(args.clone())?;
        scope(&self.db, &args.context, &args.world_id, false)?;
        source_path(&args.path)?;
        ensure!(
            args.limit > 0 && args.limit <= 16000,
            "INVALID_PROJECT_PAGE"
        );
        let (manifest, hash) = load_manifest(&self.db, &args.world_id, Some(args.revision))?;
        bound_version(&manifest, &hash, args.revision, &args.manifest_hash)?;
        let entry = manifest
            .files
            .get(&args.path)
            .context("PROJECT_FILE_NOT_FOUND")?;
        let source = blob_read(&self.directory, &args.world_id, entry)?;
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
        let request_hash = request_hash("godotProject.patch", args)?;
        let args: PatchArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.tool_call_id)?;
        ensure!(
            !args.operations.is_empty() && args.operations.len() <= 16,
            "INVALID_PROJECT_PATCH"
        );
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let workspace = scope(&tx, &args.context, &args.world_id, true)?;
        super::content_history::migration::assert_legacy_writes_allowed(&tx, &args.world_id)?;
        if let Some(result) = receipt(
            &tx,
            &workspace.task.binding.task_id,
            &args.tool_call_id,
            &request_hash,
        )? {
            return Ok(result);
        }
        let (mut manifest, hash) = load_manifest(&tx, &args.world_id, None)?;
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
        let mut text_files = Vec::new();
        for operation in args.operations {
            match operation {
                Operation::Put {
                    path,
                    text,
                    expected_hash,
                } => {
                    let entry = source_entry(&path, &text)?;
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
                    text_files.push(SourceFile { path, text });
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
            }
        }
        ensure!(
            text_files.iter().map(|file| file.text.len()).sum::<usize>() <= PATCH_LIMIT,
            "PROJECT_REQUEST_TOO_LARGE"
        );
        ensure!(manifest.files != original_files, "NO_CHANGE");
        manifest.revision = manifest.revision.checked_add(1).context("REVISION_LIMIT")?;
        manifest.task = workspace.task.binding;
        // A new immutable revision records the actual applied baseline this
        // writer used; older revisions keep their original baseline.
        if applied_lineage {
            manifest.base_build = manifest.task.base_build.clone();
        }
        validate_manifest(&manifest)?;
        // Every surviving reference is integrity checked, including unchanged files.
        for (path, entry) in &original_files {
            if manifest.files.get(path) == Some(entry) {
                blob_read(&self.directory, &args.world_id, entry)?;
            }
        }
        for file in text_files {
            blob_write(
                &self.directory,
                &args.world_id,
                &manifest.files[&file.path],
                &file.text,
            )?;
        }
        let result = store(&tx, &manifest, &args.tool_call_id, &request_hash)?;
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
                "godotProject.create" | "godotProject.patch"
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
