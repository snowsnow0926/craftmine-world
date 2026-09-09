//! Portable, self-contained streaming archives.
//!
//! One archive file carries three things that must agree with each other:
//! the domain snapshot (database tables), every non-rebuildable content body
//! (source blobs, asset bodies, sealed legacy imports, Git carriers) and the
//! consistency boundary that records which snapshot the bodies belong to.
//!
//! Bodies are streamed, never buffered as one JSON document, so the 32 MiB
//! limit of the bounded domain archive does not apply. Everything that cannot
//! be rebuilt is copied and hash-verified; rebuildable caches are declared and
//! excluded instead of being shipped.
//!
//! A restore only needs the archive and an empty target directory. The source
//! data directory is never opened, so a lost, moved or unreadable origin cannot
//! block recovery, and a failed restore cannot damage the original world.

use super::super::{
    content_history::{
        git::{GitAdapter, GitIdentity},
        repo::RepositoryStore,
    },
    digest,
    durable::{fields, text},
    worlds, TaskJournal,
};
use anyhow::{bail, ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Map, Value};
use sha2::{Digest as _, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Read, Write},
    path::{Component, Path, PathBuf},
};

#[cfg(test)]
#[path = "portable_tests.rs"]
mod tests;

pub(super) const FORMAT: &str = "craftmine.portable-archive/1";
pub(super) const SCHEMA_VERSION: u64 = 1;
const MAGIC: &[u8] = b"CRAFTMINE-PORTABLE-ARCHIVE/1\n";
/// One metadata line. Entry bodies are streamed and are not bounded by this.
const LINE_LIMIT: usize = 8 * 1024 * 1024;
const DOMAIN_LIMIT: u64 = 1024 * 1024 * 1024;
const ENTRY_LIMIT: u64 = 4 * 1024 * 1024 * 1024;
const TOTAL_LIMIT: u64 = 256 * 1024 * 1024 * 1024;
const ENTRY_COUNT_LIMIT: usize = 2_000_000;
const COPY_BUFFER: usize = 128 * 1024;
/// Operational tables never travel inside a user archive. Receipts and
/// protection pins describe the local installation, not the user's world.
const OPERATIONAL_TABLES: &[&str] = &["craftmine_backup_jobs", "craftmine_backup_pins"];

/// Caches that a restore rebuilds instead of receiving. They are declared so an
/// operator can see exactly what was left out and why.
const REBUILDABLE: &[(&str, &str)] = &[
    (
        "godot-builds/<worldKey>/<buildId>/source",
        "materialized project source, rebuilt from the archived source blobs",
    ),
    (
        "godot-builds/<worldKey>/<buildId>/artifacts",
        "export artifacts, rebuilt by the managed build job from the archived source and the fixed toolchain",
    ),
    (
        "godot-builds/<worldKey>/<buildId>/cache",
        "per-build scratch space, never a source of truth",
    ),
    (
        "content-history/repos/<repoKey>/copies",
        "materialized worktrees, rebuilt from the archived Git objects",
    ),
    (
        "git-config",
        "local Git configuration, recreated by the Git adapter",
    ),
];

fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn sha256_file(path: &Path) -> Result<(u64, String)> {
    let mut file = super::super::godot_builds::open_read(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; COPY_BUFFER];
    let mut bytes = 0u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        bytes = bytes.checked_add(read as u64).context("BACKUP_SIZE_OVERFLOW")?;
    }
    Ok((bytes, hex(hasher.finalize())))
}

/// A regular file, never a link or reparse point. Returns its length.
fn ordinary_file(path: &Path, code: &str) -> Result<u64> {
    let meta = super::super::godot_projects::ordinary(path, code)?;
    ensure!(meta.is_file(), "{code}");
    Ok(meta.len())
}

/// Archive-relative path. Rejects absolute paths, drive letters, separators and
/// any `..` component so a crafted archive can never write outside the target.
fn relative_path(name: &str) -> Result<()> {
    ensure!(
        !name.is_empty() && name.len() <= 1024 && !name.contains(['\\', ':']),
        "INVALID_ARCHIVE_PATH"
    );
    ensure!(
        !name.starts_with('/') && name.split('/').all(|part| !part.is_empty()),
        "INVALID_ARCHIVE_PATH"
    );
    let path = Path::new(name);
    ensure!(
        path.components()
            .all(|part| matches!(part, Component::Normal(_))),
        "INVALID_ARCHIVE_PATH"
    );
    Ok(())
}

fn read_line_limited(reader: &mut impl BufRead) -> Result<String> {
    let mut raw = Vec::new();
    let read = (&mut *reader)
        .take(LINE_LIMIT as u64 + 1)
        .read_until(b'\n', &mut raw)?;
    ensure!(read > 0, "BACKUP_ARCHIVE_TRUNCATED");
    ensure!(
        raw.len() <= LINE_LIMIT && raw.last() == Some(&b'\n'),
        "BACKUP_ARCHIVE_LINE_TOO_LARGE"
    );
    raw.pop();
    String::from_utf8(raw).context("BACKUP_ARCHIVE_NOT_UTF8")
}

fn tables(db: &Connection) -> Result<Vec<String>> {
    let names = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'craftmine_*' ORDER BY name")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(names
        .into_iter()
        .filter(|name| !OPERATIONAL_TABLES.contains(&name.as_str()))
        .collect())
}

fn columns(db: &Connection, table: &str) -> Result<Vec<String>> {
    Ok(db
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |row| row.get(1))?
        .collect::<rusqlite::Result<_>>()?)
}

/// Full row-level snapshot of every registered `craftmine_*` table. The table
/// list is discovered from the live schema, so a module that registers its
/// tables later is covered without editing the backup module.
fn snapshot(db: &Connection, names: &[String]) -> Result<Value> {
    let mut tables = Map::new();
    for table in names {
        let columns = columns(db, table)?;
        let mut statement = db.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
        let mut rows = statement.query([])?;
        let mut records = Vec::new();
        while let Some(row) = rows.next()? {
            let mut cells = Vec::new();
            for index in 0..columns.len() {
                cells.push(match row.get_ref(index)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => json!(n),
                    rusqlite::types::ValueRef::Real(n) => json!(n),
                    rusqlite::types::ValueRef::Text(s) => json!(std::str::from_utf8(s)?),
                    rusqlite::types::ValueRef::Blob(_) => anyhow::bail!("BACKUP_UNSUPPORTED_BLOB"),
                });
            }
            records.push(Value::Array(cells));
        }
        tables.insert(table.clone(), json!({"columns":columns,"rows":records}));
    }
    Ok(Value::Object(tables))
}

fn fingerprint(db: &Connection) -> Result<String> {
    let names = tables(db)?;
    Ok(digest(&serde_json::to_string(&snapshot(db, &names)?)?))
}

fn partial_path(path: &Path) -> Result<PathBuf> {
    let name = path
        .file_name()
        .context("BACKUP_ARCHIVE_PATH_INVALID")?
        .to_string_lossy()
        .to_string();
    Ok(path.with_file_name(format!("{name}.partial")))
}

fn staging_path(path: &Path, id: &str) -> Result<PathBuf> {
    let name = path
        .file_name()
        .context("BACKUP_ARCHIVE_PATH_INVALID")?
        .to_string_lossy()
        .to_string();
    Ok(path.with_file_name(format!(
        "{name}.staging-{}-{}-{}",
        std::process::id(),
        worlds::timestamp()?,
        &digest(id)[..12]
    )))
}

/// Hashes every byte that passes through, so the footer can attest the whole
/// stream without keeping it in memory.
struct StreamWriter<W: Write> {
    inner: W,
    hasher: Sha256,
    bytes: u64,
}

impl<W: Write> StreamWriter<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            bytes: 0,
        }
    }

    fn raw(&mut self, buffer: &[u8]) -> Result<()> {
        self.hasher.update(buffer);
        self.inner.write_all(buffer)?;
        self.bytes = self
            .bytes
            .checked_add(buffer.len() as u64)
            .context("BACKUP_SIZE_OVERFLOW")?;
        ensure!(self.bytes <= TOTAL_LIMIT, "BACKUP_ARCHIVE_TOO_LARGE");
        Ok(())
    }

    fn line(&mut self, value: &Value) -> Result<()> {
        let text = serde_json::to_string(value)?;
        self.raw_line(&text)
    }

    /// Writes one already-serialized JSON line.
    fn raw_line(&mut self, text: &str) -> Result<()> {
        ensure!(!text.contains('\n'), "BACKUP_ARCHIVE_LINE_INVALID");
        ensure!(text.len() <= LINE_LIMIT, "BACKUP_ARCHIVE_LINE_TOO_LARGE");
        self.raw(text.as_bytes())?;
        self.raw(b"\n")
    }

    /// Streams one body, hashing it in a single pass.
    fn body(&mut self, path: &Path) -> Result<(u64, String)> {
        let mut file = super::super::godot_builds::open_read(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; COPY_BUFFER];
        let mut bytes = 0u64;
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            self.raw(&buffer[..read])?;
            bytes = bytes.checked_add(read as u64).context("BACKUP_SIZE_OVERFLOW")?;
            ensure!(bytes <= ENTRY_LIMIT, "BACKUP_ENTRY_TOO_LARGE");
        }
        Ok((bytes, hex(hasher.finalize())))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Body {
    /// A file already on disk under the data directory.
    File(PathBuf),
    /// A Git bundle staged before the header is written, because the header
    /// records the size and hash of every body.
    Staged(PathBuf),
}

#[derive(Clone, Debug)]
struct ContentEntry {
    /// Archive-relative path. For `content-repo` this is a logical label; the
    /// repository is materialized into its own layout instead.
    path: String,
    kind: &'static str,
    owner: &'static str,
    world: Option<String>,
    bytes: u64,
    sha256: String,
    refs: Vec<String>,
    body: Option<Body>,
    repo_id: Option<String>,
    object_format: Option<String>,
    oid: Option<String>,
    object_type: Option<String>,
}

impl ContentEntry {
    fn to_json(&self) -> Value {
        json!({
            "path": self.path, "kind": self.kind, "owner": self.owner,
            "world": self.world, "bytes": self.bytes, "sha256": self.sha256,
            "refs": self.refs, "repoId": self.repo_id,
            "objectFormat": self.object_format, "oid": self.oid,
            "objectType": self.object_type, "body": self.body.is_some(),
        })
    }
}

#[derive(Clone, Debug)]
struct Pin {
    kind: &'static str,
    reference: String,
    world: Option<String>,
}

/// Git cannot read configuration through a Windows extended-length path
/// (`\\?\C:\...`), which is exactly what `canonicalize` returns. Strip the
/// prefix before handing any path to the Git adapter.
fn git_safe_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

fn repository_store(directory: &Path) -> Result<RepositoryStore> {
    let directory = git_safe_path(directory);
    let git = GitAdapter::discover(
        &directory.join("git-config"),
        &[],
        GitIdentity::local("Craftmine Backup", "craftmine-backup")?,
    )?;
    RepositoryStore::open(&directory.join("content-history"), git)
}

/// Every non-rebuildable body, enumerated from durable rows rather than by
/// copying directories. Content-addressed stores are immutable once written, so
/// a body either verifies or the archive fails; nothing is guessed.
fn enumerate_content(
    db: &Connection,
    directory: &Path,
    pins: &mut Vec<Pin>,
) -> Result<Vec<ContentEntry>> {
    let mut entries: Vec<ContentEntry> = Vec::new();

    // Sealed legacy imports: manifest plus every listed source file.
    let imports = db
        .prepare("SELECT id,manifest,manifest_hash,world_id FROM craftmine_legacy_imports ORDER BY id")?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, manifest, manifest_hash, world_id) in imports {
        ensure!(digest(&manifest) == manifest_hash, "CORRUPT_IMPORT_MANIFEST");
        let root = directory.join("legacy-imports").join(&id);
        let manifest_path = root.join("manifest.json");
        let bytes = ordinary_file(&manifest_path, "BACKUP_CONTENT_MISSING")?;
        entries.push(ContentEntry {
            path: format!("legacy-imports/{id}/manifest.json"),
            kind: "legacy-import",
            owner: "R5",
            world: world_id.clone(),
            bytes,
            sha256: manifest_hash.clone(),
            refs: vec![format!("legacy-import/{id}")],
            body: Some(Body::File(manifest_path)),
            repo_id: None,
            object_format: None,
            oid: None,
            object_type: None,
        });
        pins.push(Pin {
            kind: "legacy-import",
            reference: id.clone(),
            world: world_id.clone(),
        });
        let value: Value = serde_json::from_str(&manifest)?;
        let files = value["files"].as_object().context("BACKUP_FILES_REQUIRED")?;
        for (name, record) in files {
            relative_path(name)?;
            let sha = record["sha256"]
                .as_str()
                .or_else(|| record["hash"].as_str())
                .context("BACKUP_HASH_REQUIRED")?
                .to_owned();
            ensure!(sha.len() == 64, "BACKUP_HASH_REQUIRED");
            let size = record["bytes"].as_u64().context("BACKUP_BYTES_REQUIRED")?;
            let path = root.join("source").join(name);
            let on_disk = ordinary_file(&path, "BACKUP_CONTENT_MISSING")?;
            ensure!(on_disk == size, "BACKUP_CONTENT_CHANGED: legacy-imports/{id}/source/{name}");
            entries.push(ContentEntry {
                path: format!("legacy-imports/{id}/source/{name}"),
                kind: "legacy-import",
                owner: "R5",
                world: world_id.clone(),
                bytes: size,
                sha256: sha,
                refs: vec![format!("legacy-import/{id}")],
                body: Some(Body::File(path)),
                repo_id: None,
                object_format: None,
                oid: None,
                object_type: None,
            });
        }
    }

    // Godot source blobs: content-addressed by SHA-256, referenced by revisions.
    let revisions = db
        .prepare("SELECT world_id,manifest FROM craftmine_godot_revisions ORDER BY world_id,revision")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut seen_source: BTreeSet<(String, String)> = BTreeSet::new();
    for (world_id, manifest) in revisions {
        let value: Value = serde_json::from_str(&manifest)?;
        let files = value["files"].as_object().context("BACKUP_FILES_REQUIRED")?;
        for (_, record) in files {
            let sha = record["sha256"]
                .as_str()
                .context("BACKUP_HASH_REQUIRED")?
                .to_owned();
            let size = record["bytes"].as_u64().context("BACKUP_BYTES_REQUIRED")?;
            if !seen_source.insert((world_id.clone(), sha.clone())) {
                continue;
            }
            let path = directory
                .join("godot-source")
                .join(digest(&world_id))
                .join("blobs")
                .join(&sha);
            let on_disk = ordinary_file(&path, "BACKUP_CONTENT_MISSING")?;
            ensure!(on_disk == size, "BACKUP_CONTENT_CHANGED: godot-source blob {sha}");
            entries.push(ContentEntry {
                path: format!("godot-source/{}/blobs/{sha}", digest(&world_id)),
                kind: "godot-source-blob",
                owner: "R1",
                world: Some(world_id.clone()),
                bytes: size,
                sha256: sha.clone(),
                refs: vec![format!("world/{world_id}")],
                body: Some(Body::File(path)),
                repo_id: None,
                object_format: None,
                oid: None,
                object_type: None,
            });
            pins.push(Pin {
                kind: "godot-source-blob",
                reference: sha,
                world: Some(world_id.clone()),
            });
        }
    }

    // Godot world asset bodies: uploaded player files, content-addressed by
    // SHA-256 under the world's storage directory.
    let world_assets = db
        .prepare("SELECT world_id,sha256,bytes FROM craftmine_godot_assets ORDER BY world_id,sha256")?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (world_id, sha, size) in world_assets {
        ensure!(sha.len() == 64 && size >= 0, "BACKUP_HASH_REQUIRED");
        let path = directory
            .join("godot-assets")
            .join(digest(&world_id))
            .join(&sha);
        let on_disk = ordinary_file(&path, "BACKUP_CONTENT_MISSING")?;
        ensure!(
            on_disk == size as u64,
            "BACKUP_CONTENT_CHANGED: godot-assets {sha}"
        );
        entries.push(ContentEntry {
            path: format!("godot-assets/{}/{sha}", digest(&world_id)),
            kind: "godot-asset-body",
            owner: "R1",
            world: Some(world_id.clone()),
            bytes: on_disk,
            sha256: sha.clone(),
            refs: vec![format!("world/{world_id}")],
            body: Some(Body::File(path)),
            repo_id: None,
            object_format: None,
            oid: None,
            object_type: None,
        });
        pins.push(Pin {
            kind: "godot-asset-body",
            reference: sha,
            world: Some(world_id),
        });
    }

    // Asset library bodies: content-addressed by SHA-256 under a two-hex shard.
    let assets = db
        .prepare("SELECT DISTINCT sha256,bytes FROM craftmine_asset_files ORDER BY sha256")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (sha, size) in assets {
        ensure!(sha.len() == 64, "BACKUP_HASH_REQUIRED");
        ensure!(size >= 0, "BACKUP_BYTES_REQUIRED");
        let path = directory
            .join("asset-catalog")
            .join("blobs")
            .join(&sha[..2])
            .join(&sha);
        let on_disk = ordinary_file(&path, "BACKUP_CONTENT_MISSING")?;
        ensure!(
            on_disk == size as u64,
            "BACKUP_CONTENT_CHANGED: asset blob {sha}"
        );
        entries.push(ContentEntry {
            path: format!("asset-catalog/blobs/{}/{sha}", &sha[..2]),
            kind: "asset-blob",
            owner: "R6",
            world: None,
            bytes: on_disk,
            sha256: sha.clone(),
            refs: vec![format!("asset/{sha}")],
            body: Some(Body::File(path)),
            repo_id: None,
            object_format: None,
            oid: None,
            object_type: None,
        });
        pins.push(Pin {
            kind: "asset-blob",
            reference: sha,
            world: None,
        });
    }

    // Builds are derived data and are not shipped, but a retained archive pins
    // them so a restore can replay a world without an avoidable rebuild.
    let builds = db
        .prepare("SELECT world_id,build_id FROM craftmine_godot_builds ORDER BY world_id,build_id")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (world_id, build_id) in builds {
        pins.push(Pin {
            kind: "build",
            reference: build_id,
            world: Some(world_id),
        });
    }

    Ok(entries)
}

fn table_exists(db: &Connection, name: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |row| row.get(0),
    )?)
}

/// Git carriers.
///
/// A bare repository is not copied file by file and no repository command
/// outside the managed whitelist is used. Every object reachable from the
/// snapshot's references is read with `cat-file --batch`, stored as one
/// content-addressed entry, and recreated at restore with `hash-object -w`
/// plus `update-ref`. Recomputing each object id proves the restored history is
/// the archived history, not a lookalike.
fn enumerate_repositories(
    db: &Connection,
    directory: &Path,
    staging: &Path,
    pins: &mut Vec<Pin>,
) -> Result<Vec<ContentEntry>> {
    if !table_exists(db, "craftmine_content_repositories")? {
        return Ok(Vec::new());
    }
    let repos = db
        .prepare("SELECT repo_id,object_format,world_id FROM craftmine_content_repositories WHERE backend='git' ORDER BY repo_id")?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if repos.is_empty() {
        return Ok(Vec::new());
    }
    let store = repository_store(directory)?;
    let mut entries = Vec::new();
    for (repo_id, object_format, world_id) in repos {
        let layout = store.layout(&repo_id)?;
        let refs = store.git().list_refs(&layout.git_dir, "refs/")?;
        let key = RepositoryStore::repo_key(&repo_id)?;
        let ref_names: Vec<String> = refs.iter().map(|entry| entry.name.clone()).collect();
        entries.push(ContentEntry {
            path: format!("content-history/repos/{key}/refs.json"),
            kind: "content-repo",
            owner: "R1",
            world: None,
            bytes: 0,
            sha256: digest(&format!("refs|{repo_id}|{}", ref_names.join(","))),
            refs: refs
                .iter()
                .map(|entry| format!("{}|{}", entry.name, entry.oid))
                .collect(),
            body: None,
            repo_id: Some(repo_id.clone()),
            object_format: Some(object_format.clone()),
            oid: None,
            object_type: None,
        });
        for entry in &refs {
            pins.push(Pin {
                kind: "git-ref",
                reference: format!("{repo_id}|{}|{}", entry.name, entry.oid),
                world: world_id.clone(),
            });
        }
        pins.push(Pin {
            kind: "repository",
            reference: repo_id.clone(),
            world: world_id.clone(),
        });
        if ref_names.is_empty() {
            continue;
        }
        let listed = store
            .git()
            .repo(&layout.git_dir, &["rev-list", "--objects", "--all"])?
            .ensure_ok("GIT_REV_LIST_FAILED")?;
        let mut oids: Vec<String> = Vec::new();
        let mut seen = BTreeSet::new();
        for line in listed.stdout_text()?.lines() {
            if let Some(oid) = line.split(' ').next().filter(|oid| !oid.is_empty()) {
                if seen.insert(oid.to_owned()) {
                    oids.push(oid.to_owned());
                }
            }
        }
        let mut stdin = oids.join("\n").into_bytes();
        stdin.push(b'\n');
        let batch = store
            .git()
            .repo_stdin(&layout.git_dir, &["cat-file", "--batch"], &stdin)?
            .ensure_ok("GIT_CAT_FILE_FAILED")?;
        let mut cursor = 0usize;
        for oid in &oids {
            let newline = batch.stdout[cursor..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|at| cursor + at)
                .context("BACKUP_GIT_TRUNCATED")?;
            let header = std::str::from_utf8(&batch.stdout[cursor..newline])
                .context("BACKUP_GIT_INVALID")?;
            let parts: Vec<&str> = header.split(' ').collect();
            ensure!(parts.len() == 3, "BACKUP_GIT_OBJECT_MISSING: {header}");
            ensure!(parts[0] == oid, "BACKUP_GIT_OBJECT_MISMATCH");
            let size: usize = parts[2].parse().context("BACKUP_GIT_INVALID")?;
            let start = newline + 1;
            let end = start.checked_add(size).context("BACKUP_SIZE_OVERFLOW")?;
            ensure!(
                end < batch.stdout.len() && batch.stdout[end] == b'\n',
                "BACKUP_GIT_TRUNCATED"
            );
            let body = &batch.stdout[start..end];
            let staged = staging.join(format!("object-{}", entries.len()));
            fs::write(&staged, body).context("BACKUP_STAGING_WRITE_FAILED")?;
            let (bytes, sha256) =
                sha256_file(&staged).with_context(|| format!("BACKUP_OBJECT_UNREADABLE: {oid}"))?;
            entries.push(ContentEntry {
                path: format!("content-history/repos/{key}/objects/{oid}"),
                kind: "content-repo-object",
                owner: "R1",
                world: None,
                bytes,
                sha256,
                refs: vec![format!("{repo_id}|{oid}")],
                body: Some(Body::Staged(staged)),
                repo_id: Some(repo_id.clone()),
                object_format: Some(object_format.clone()),
                oid: Some(oid.clone()),
                object_type: Some(parts[1].to_owned()),
            });
            cursor = end + 1;
        }
    }
    Ok(entries)
}

fn rebuildable() -> Value {
    json!(REBUILDABLE
        .iter()
        .map(|(kind, reason)| json!({"kind": kind, "reason": reason, "excluded": true}))
        .collect::<Vec<_>>())
}

fn archive_path(args: &Value) -> Result<PathBuf> {
    let path = PathBuf::from(text(args, "archivePath", 4096)?);
    ensure!(path.is_absolute(), "BACKUP_ABSOLUTE_PATH_REQUIRED");
    Ok(path)
}

fn target_directory(args: &Value) -> Result<PathBuf> {
    let path = PathBuf::from(text(args, "targetDirectory", 4096)?);
    ensure!(path.is_absolute(), "BACKUP_ABSOLUTE_PATH_REQUIRED");
    Ok(path)
}

/// Canonical form of a path that may not exist yet: canonicalize the deepest
/// existing ancestor and re-append the remainder, so `..` cannot hide a target
/// inside the live data directory.
fn resolve_target(path: &Path) -> PathBuf {
    let mut suffix: Vec<std::ffi::OsString> = Vec::new();
    let mut current = path.to_path_buf();
    loop {
        if current.try_exists().unwrap_or(false) {
            let mut base = fs::canonicalize(&current).unwrap_or_else(|_| current.clone());
            for part in suffix.iter().rev() {
                base.push(part);
            }
            return base;
        }
        match current.file_name() {
            Some(name) => {
                suffix.push(name.to_os_string());
                if !current.pop() {
                    return path.to_path_buf();
                }
            }
            None => return path.to_path_buf(),
        }
    }
}

fn inside(parent: &Path, child: &Path) -> bool {    let parent = parent.to_string_lossy().to_lowercase();
    let child = child.to_string_lossy().to_lowercase();
    child == parent || child.starts_with(&(parent.trim_end_matches(['\\', '/']).to_owned() + "\\"))
        || child.starts_with(&(parent.trim_end_matches(['\\', '/']).to_owned() + "/"))
}

fn mark_pins(db: &Connection, id: &str, status: &str, archive_hash: Option<&str>) -> Result<()> {
    db.execute(
        "UPDATE craftmine_backup_pins SET status=?2,archive_hash=COALESCE(?3,archive_hash),updated_at=?4 WHERE archive_id=?1",
        params![id, status, archive_hash, worlds::timestamp()?],
    )?;
    Ok(())
}

impl TaskJournal {
    /// Streams a complete archive to `archivePath`. The archive is written next
    /// to the target and only renamed into place once every body verified, so a
    /// crash or a full disk leaves no file that could be mistaken for a backup.
    pub fn backup_export_portable(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "archivePath"])?;
        let id = text(args, "operationId", 240)?.to_owned();
        let path = archive_path(args)?;
        ensure!(
            !inside(&self.directory, &path),
            "BACKUP_ARCHIVE_INSIDE_DATA_DIR"
        );
        let request_hash = digest(&serde_json::to_string(args)?);
        if let Some((old, status, receipt)) = self
            .db
            .query_row(
                "SELECT request_hash,status,receipt FROM craftmine_backup_jobs WHERE id=?1 AND kind='export-portable'",
                [&id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
            )
            .optional()?
        {
            ensure!(old == request_hash, "REPLAY_MISMATCH");
            ensure!(status != "streaming", "BACKUP_ALREADY_STREAMING");
            if status == "completed" {
                return Ok(serde_json::from_str(&receipt)?);
            }
            let tx = self
                .db
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute(
                "DELETE FROM craftmine_backup_jobs WHERE id=?1 AND kind='export-portable'",
                [&id],
            )?;
            tx.execute(
                "DELETE FROM craftmine_backup_pins WHERE archive_id=?1 AND status!='retained'",
                [&id],
            )?;
            tx.commit()?;
        }

        let staging = staging_path(&path, &id)?;
        let partial = partial_path(&path)?;
        let result = (|| -> Result<Value> {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::create_dir(&staging).context("BACKUP_STAGING_EXISTS")?;
            let created_at = worlds::timestamp()?;

            // Snapshot and protection pins commit together, before any body is
            // read. A reclaimer that runs afterwards already sees the pins.
            let mut pins: Vec<Pin> = Vec::new();
            let (names, tables_snapshot, entries) = {
                let tx = self
                    .db
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                let names = tables(&tx)?;
                let tables_snapshot = snapshot(&tx, &names)?;
                let entries = enumerate_content(&tx, &self.directory, &mut pins)?;
                let repos = enumerate_repositories(&tx, &self.directory, &staging, &mut pins)?;
                let mut all = entries;
                all.extend(repos);
                for pin in &pins {
                    tx.execute(
                        "INSERT OR REPLACE INTO craftmine_backup_pins(archive_id,kind,ref,world_id,status,archive_hash,archive_path,created_at,updated_at)
                         VALUES(?1,?2,?3,?4,'streaming',NULL,?5,?6,?6)",
                        params![id, pin.kind, pin.reference, pin.world, path.to_string_lossy(), created_at],
                    )?;
                }
                tx.execute(
                    "INSERT INTO craftmine_backup_jobs(id,kind,status,request_hash,receipt,created_at)
                     VALUES(?1,'export-portable','streaming',?2,'{}',?3)",
                    params![id, request_hash, created_at],
                )?;
                tx.commit()?;
                (names, tables_snapshot, all)
            };
            let mut entries = entries;
            entries.sort_by(|left, right| left.path.cmp(&right.path));

            let domain_text = serde_json::to_string(&tables_snapshot)?;
            let domain_hash = digest(&domain_text);
            ensure!(
                domain_text.len() as u64 <= DOMAIN_LIMIT,
                "BACKUP_DOMAIN_TOO_LARGE"
            );
            ensure!(
                entries.len() <= ENTRY_COUNT_LIMIT,
                "BACKUP_ENTRY_COUNT_LIMIT"
            );
            let domain_path = staging.join("domain.json");
            fs::write(&domain_path, domain_text.as_bytes())?;

            let consistency = json!({
                "snapshotHash": domain_hash,
                "tables": names.len(),
                "boundary": "one immediate transaction over the domain database; every body is immutable content-addressed or sealed data read after that snapshot, and each body is re-hashed while streaming",
                "contentRoots": entries.iter().map(|entry| entry.owner).collect::<BTreeSet<_>>().into_iter().collect::<Vec<_>>(),
                "builds": pins.iter().filter(|pin| pin.kind == "build").count(),
                "sourceBlobs": pins.iter().filter(|pin| pin.kind == "godot-source-blob").count(),
                "assetBlobs": pins.iter().filter(|pin| pin.kind == "asset-blob").count(),
                "gitRefs": pins.iter().filter(|pin| pin.kind == "git-ref").count(),
                "legacyImports": pins.iter().filter(|pin| pin.kind == "legacy-import").count(),
                "credentialsIncluded": false,
                "sessionRowsIncluded": true,
                "sessionNote": "local session and world-lease routing rows travel with the domain snapshot; they hold no credentials or tokens",
            });
            let domain_entry = ContentEntry {
                path: "domain.json".to_owned(),
                kind: "domain",
                owner: "R5",
                world: None,
                bytes: domain_text.len() as u64,
                sha256: domain_hash.clone(),
                refs: Vec::new(),
                body: Some(Body::Staged(domain_path)),
                repo_id: None,
                object_format: None,
                oid: None,
                object_type: None,
            };
            let mut all_entries = vec![domain_entry];
            all_entries.extend(entries);

            let header = json!({
                "format": FORMAT,
                "schemaVersion": SCHEMA_VERSION,
                "createdAt": created_at,
                "sourceDigest": digest(&self.directory.to_string_lossy()),
                "entryCount": all_entries.len(),
                "rebuildable": rebuildable(),
                "consistency": consistency,
            });
            // The entry table is one JSON line per entry, so a large history
            // never has to fit in a single line. `archiveHash` binds the header
            // and the whole entry table.
            let mut entry_lines = Vec::with_capacity(all_entries.len());
            for entry in &all_entries {
                entry_lines.push(serde_json::to_string(&entry.to_json())?);
            }
            let mut archive_hasher = Sha256::new();
            let header_text = serde_json::to_string(&header)?;
            archive_hasher.update(header_text.as_bytes());
            archive_hasher.update(b"\n");
            for line in &entry_lines {
                archive_hasher.update(line.as_bytes());
                archive_hasher.update(b"\n");
            }
            let archive_hash = hex(archive_hasher.finalize());

            let file = File::create(&partial)?;
            let mut writer = StreamWriter::new(BufWriter::with_capacity(COPY_BUFFER, file));
            writer.raw(MAGIC)?;
            writer.raw_line(&header_text)?;
            for line in &entry_lines {
                writer.raw_line(line)?;
            }
            let mut content_bytes = 0u64;
            for entry in &all_entries {
                let Some(body) = entry.body.as_ref() else {
                    // Declared-only entries (an empty managed repository) carry
                    // no bytes; anything else must have a body.
                    ensure!(entry.bytes == 0, "BACKUP_BODY_REQUIRED: {}", entry.path);
                    continue;
                };
                let path = match body {
                    Body::File(path) | Body::Staged(path) => path,
                };
                let (bytes, sha256) = writer.body(path)?;
                ensure!(
                    bytes == entry.bytes && sha256 == entry.sha256,
                    "BACKUP_CONTENT_CHANGED: {}",
                    entry.path
                );
                content_bytes = content_bytes
                    .checked_add(bytes)
                    .context("BACKUP_SIZE_OVERFLOW")?;
            }
            let mut footer = json!({
                "format": FORMAT,
                "entryCount": all_entries.len(),
                "contentBytes": content_bytes,
                "archiveHash": archive_hash,
            });
            writer.line(&footer)?;
            let (file, stream_bytes, stream_hash) = {
                let mut inner = writer.inner;
                inner.flush()?;
                (
                    inner.into_inner().map_err(|error| error.into_error())?,
                    writer.bytes,
                    hex(writer.hasher.finalize()),
                )
            };
            file.sync_all()?;
            drop(file);
            footer["streamBytes"] = json!(stream_bytes);
            footer["streamSha256"] = json!(stream_hash);

            fs::rename(&partial, &path).context("BACKUP_ARCHIVE_RENAME_FAILED")?;
            fs::remove_dir_all(&staging).ok();

            let receipt = json!({
                "id": id,
                "kind": "export-portable",
                "status": "completed",
                "archivePath": path.to_string_lossy(),
                "manifest": {
                    "hash": footer["archiveHash"],
                    "streamSha256": footer["streamSha256"],
                    "bytes": footer["streamBytes"],
                    "contentBytes": content_bytes,
                    "entries": all_entries.len(),
                    "schemaVersion": SCHEMA_VERSION,
                    "domainHash": domain_hash,
                },
                "content": {
                    "files": all_entries.len(),
                    "legacyImports": pins.iter().filter(|pin| pin.kind == "legacy-import").count(),
                    "sourceBlobs": pins.iter().filter(|pin| pin.kind == "godot-source-blob").count(),
                    "assetBlobs": pins.iter().filter(|pin| pin.kind == "asset-blob").count(),
                    "godotAssetBodies": pins.iter().filter(|pin| pin.kind == "godot-asset-body").count(),
                    "gitRefs": pins.iter().filter(|pin| pin.kind == "git-ref").count(),
                    "gitObjects": all_entries.iter().filter(|entry| entry.kind == "content-repo-object").count(),
                },
                "rebuildableExcluded": rebuildable(),
                "consistency": consistency,
                "protectedRefs": {
                    "builds": pins.iter().filter(|pin| pin.kind == "build").count(),
                    "gitRefs": pins.iter().filter(|pin| pin.kind == "git-ref").count(),
                },
                "credentialsIncluded": false,
                "sessionRowsIncluded": true,
                "sessionNote": "local session and world-lease routing rows travel with the domain snapshot; they hold no credentials or tokens",
            });
            let tx = self
                .db
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute(
                "UPDATE craftmine_backup_jobs SET status='completed',archive_hash=?2,receipt=?3 WHERE id=?1",
                params![id, footer["archiveHash"].as_str(), serde_json::to_string(&receipt)?],
            )?;
            mark_pins(&tx, &id, "retained", footer["archiveHash"].as_str())?;
            tx.commit()?;
            Ok(receipt)
        })();

        if result.is_err() {
            let published = path.try_exists().unwrap_or(false);
            let _ = fs::remove_file(&partial);
            let _ = fs::remove_dir_all(&staging);
            if published {
                // The archive is complete on disk; keep the pins so a reclaimer
                // cannot delete the bodies it holds. Startup recovery promotes
                // them once the job row is reconciled.
                let _ = self.db.execute(
                    "UPDATE craftmine_backup_jobs SET status='completed' WHERE id=?1 AND kind='export-portable' AND status='streaming'",
                    [&id],
                );
            } else {
                let _ = mark_pins(&self.db, &id, "abandoned", None);
                let _ = self.db.execute(
                    "UPDATE craftmine_backup_jobs SET status='failed' WHERE id=?1 AND kind='export-portable' AND status='streaming'",
                    [&id],
                );
            }
        }
        result
    }

    /// Reads the magic, header and entry table without touching any content
    /// body. Bodies and the footer are only proven by `backup.verifyPortable`.
    pub fn backup_inspect_portable(&self, args: &Value) -> Result<Value> {
        fields(args, &["archivePath"])?;
        let path = archive_path(args)?;
        let file = File::open(&path).context("BACKUP_ARCHIVE_MISSING")?;
        let mut reader = BufReader::with_capacity(COPY_BUFFER, file);
        let (header, entries, archive_hash) = read_archive_head(&mut reader)?;
        Ok(json!({
            "format": FORMAT,
            "schemaVersion": SCHEMA_VERSION,
            "createdAt": header["createdAt"],
            "entries": entries.len(),
            "archiveHash": archive_hash,
            "rebuildable": header["rebuildable"],
            "consistency": header["consistency"],
            "headerValid": true,
            "bodiesVerified": false,
            "note": "run backup.verifyPortable to prove every body and the footer",
            "credentialsIncluded": false,
        }))
    }

    /// Streams the whole archive and re-hashes every body. Read-only.
    pub fn backup_verify_portable(&self, args: &Value) -> Result<Value> {
        fields(args, &["archivePath"])?;
        let path = archive_path(args)?;
        let report = verify_archive(&path)?;
        Ok(report)
    }

    /// Restores an archive into a data directory. The source data directory of
    /// the archive is never opened.
    ///
    /// A fresh installation may restore into its own (empty) data directory,
    /// which is the "new computer" case. Restoring anywhere else requires a
    /// separate empty directory so a live world can never be overwritten.
    pub fn backup_restore_portable(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["operationId", "archivePath", "targetDirectory"])?;
        let id = text(args, "operationId", 240)?.to_owned();
        let archive = archive_path(args)?;
        let target = target_directory(args)?;
        // `TaskJournal::open` canonicalizes its own directory, so the target
        // must be compared in the same form even when it does not exist yet.
        let resolved = resolve_target(&target);
        let in_place = resolved == self.directory;
        if in_place {
            ensure!(self.installation_empty()?, "BACKUP_TARGET_NOT_EMPTY");
        } else {
            ensure!(
                !inside(&self.directory, &resolved) && !inside(&resolved, &self.directory),
                "BACKUP_TARGET_OVERLAP"
            );
            if resolved.try_exists()? {
                // A crashed restore may have left its own staging directory.
                for entry in fs::read_dir(&resolved)? {
                    let entry = entry?;
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with(".portable-staging-") {
                        fs::remove_dir_all(entry.path()).ok();
                    } else {
                        bail!("BACKUP_TARGET_NOT_EMPTY");
                    }
                }
            }
        }
        let restored = restore_archive(&target, &archive, in_place.then_some(&self.db))?;
        let report = json!({
            "id": id,
            "kind": "restore-portable",
            "status": "completed",
            "targetDirectory": target.to_string_lossy(),
            "restoredInPlace": in_place,
            "archiveHash": restored["archiveHash"],
            "domainHash": restored["domainHash"],
            "currentHash": restored["currentHash"],
            "entries": restored["entries"],
            "contentBytes": restored["contentBytes"],
            "verifiedFiles": restored["verifiedFiles"],
            "repositories": restored["repositories"],
            "rebuildRequired": restored["rebuildRequired"],
            "importedProvenance": true,
            "credentialsIncluded": false,
        });
        Ok(report)
    }

    /// True when this installation holds no user data yet, so an in-place
    /// restore of an archive cannot destroy anything. Every registered table is
    /// counted, not a hardcoded subset.
    fn installation_empty(&self) -> Result<bool> {
        let mut total = 0i64;
        for table in tables(&self.db)? {
            let count: i64 = self
                .db
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?;
            total += count;
        }
        Ok(total == 0)
    }

    /// Content bodies that retained archives still protect. R1 and R6 consume
    /// this instead of keeping their own list; there is no third deletion path.
    pub fn backup_protected_refs(&self, args: &Value) -> Result<Value> {
        fields(args, &["worldId"])?;
        let world: Option<String> = args["worldId"].as_str().map(str::to_owned);
        let mut statement = self.db.prepare(
            "SELECT archive_id,kind,ref,world_id FROM craftmine_backup_pins WHERE status IN ('streaming','retained') ORDER BY kind,ref",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut builds = BTreeSet::new();
        let mut source_blobs = BTreeSet::new();
        let mut asset_blobs = BTreeSet::new();
        let mut godot_asset_bodies = BTreeSet::new();
        let mut git_refs = Vec::new();
        let mut legacy_imports = BTreeSet::new();
        let mut repositories = BTreeSet::new();
        let mut archives = BTreeSet::new();
        for (archive_id, kind, reference, row_world) in rows {
            if let Some(world) = &world {
                if row_world.as_deref() != Some(world.as_str()) && kind != "asset-blob" {
                    continue;
                }
            }
            archives.insert(archive_id);
            match kind.as_str() {
                "build" => {
                    builds.insert(reference);
                }
                "godot-source-blob" => {
                    source_blobs.insert(reference);
                }
                "asset-blob" => {
                    asset_blobs.insert(reference);
                }
                "godot-asset-body" => {
                    godot_asset_bodies.insert(reference);
                }
                "legacy-import" => {
                    legacy_imports.insert(reference);
                }
                "repository" => {
                    repositories.insert(reference);
                }
                "git-ref" => {
                    let mut parts = reference.split('|');
                    if let (Some(repo), Some(name), Some(oid)) =
                        (parts.next(), parts.next(), parts.next())
                    {
                        git_refs.push(json!({"repoId": repo, "ref": name, "oid": oid}));
                    }
                }
                _ => {}
            }
        }
        Ok(json!({
            "format": "craftmine.backup-protection/1",
            "worldId": world,
            "archives": archives.len(),
            "builds": builds.into_iter().collect::<Vec<_>>(),
            "sourceBlobs": source_blobs.into_iter().collect::<Vec<_>>(),
            "assetBlobs": asset_blobs.into_iter().collect::<Vec<_>>(),
            "godotAssetBodies": godot_asset_bodies.into_iter().collect::<Vec<_>>(),
            "legacyImports": legacy_imports.into_iter().collect::<Vec<_>>(),
            "repositories": repositories.into_iter().collect::<Vec<_>>(),
            "gitRefs": git_refs,
            "ownedByOthers": ["assetBodies", "gitHistory", "buildCopies"],
        }))
    }

    /// Drops the protection of one archive once its bytes are stored somewhere
    /// the local installation no longer depends on.
    pub fn backup_release_portable(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["archiveId"])?;
        let id = text(args, "archiveId", 240)?.to_owned();
        let changed = self.db.execute(
            "UPDATE craftmine_backup_pins SET status='released',updated_at=?2 WHERE archive_id=?1 AND status!='released'",
            params![id, worlds::timestamp()?],
        )?;
        Ok(json!({"archiveId": id, "released": changed}))
    }

    /// Startup sweep. A pin is retained only when its export job completed or
    /// its archive file is still present at the recorded path; anything else was
    /// interrupted before the archive was proven and must not keep protecting
    /// content that no archive holds. A retained pin whose archive disappeared
    /// is released for the same reason. No age or mtime heuristic is used.
    pub fn backup_recover(&mut self) -> Result<usize> {
        let rows = self
            .db
            .prepare("SELECT archive_id,status,MAX(archive_path) FROM craftmine_backup_pins WHERE status IN ('streaming','retained') GROUP BY archive_id,status")?
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut abandoned = 0;
        for (archive_id, status, archive_path) in rows {
            let completed: bool = self.db.query_row(
                "SELECT EXISTS(SELECT 1 FROM craftmine_backup_jobs WHERE id=?1 AND kind='export-portable' AND status='completed')",
                [&archive_id],
                |row| row.get(0),
            )?;
            let present = archive_path
                .as_deref()
                .is_some_and(|path| Path::new(path).is_file());
            let next = match status.as_str() {
                "streaming" if completed || present => "retained",
                "streaming" => "abandoned",
                "retained" if !present => "abandoned",
                _ => continue,
            };
            if next == "abandoned" {
                abandoned += 1;
            }
            mark_pins(&self.db, &archive_id, next, None)?;
        }
        Ok(abandoned)
    }
}

/// Reads the magic line, the header line and the whole entry table, hashing
/// them exactly as the writer did.
fn read_archive_head(reader: &mut impl BufRead) -> Result<(Value, Vec<Value>, String)> {
    let mut magic = vec![0u8; MAGIC.len()];
    reader
        .read_exact(&mut magic)
        .context("BACKUP_ARCHIVE_TRUNCATED")?;
    ensure!(magic == MAGIC, "BACKUP_FORMAT_UNSUPPORTED");
    let header_text = read_line_limited(reader)?;
    let header: Value = serde_json::from_str(&header_text).context("BACKUP_HEADER_INVALID")?;
    ensure!(
        header["format"] == FORMAT && header["schemaVersion"].as_u64() == Some(SCHEMA_VERSION),
        "BACKUP_VERSION_UNSUPPORTED"
    );
    let count = header["entryCount"]
        .as_u64()
        .context("BACKUP_ENTRY_COUNT_REQUIRED")? as usize;
    ensure!(
        count > 0 && count <= ENTRY_COUNT_LIMIT,
        "BACKUP_ENTRY_COUNT_LIMIT"
    );
    let mut hasher = Sha256::new();
    hasher.update(header_text.as_bytes());
    hasher.update(b"\n");
    let mut entries = Vec::with_capacity(count);
    let mut seen = BTreeSet::new();
    let mut declared = 0u64;
    for _ in 0..count {
        let text = read_line_limited(reader)?;
        hasher.update(text.as_bytes());
        hasher.update(b"\n");
        let entry: Value = serde_json::from_str(&text).context("BACKUP_ENTRY_INVALID")?;
        let name = entry["path"].as_str().context("BACKUP_PATH_REQUIRED")?;
        relative_path(name)?;
        let kind = entry["kind"].as_str().context("BACKUP_KIND_REQUIRED")?;
        ensure!(kind_matches_path(kind, name), "INVALID_ARCHIVE_PATH: {name}");
        ensure!(seen.insert(name.to_owned()), "BACKUP_DUPLICATE_ENTRY");
        let bytes = entry["bytes"].as_u64().context("BACKUP_BYTES_REQUIRED")?;
        entry["sha256"].as_str().context("BACKUP_HASH_REQUIRED")?;
        declared = declared.checked_add(bytes).context("BACKUP_SIZE_OVERFLOW")?;
        ensure!(declared <= TOTAL_LIMIT, "BACKUP_ARCHIVE_TOO_LARGE");
        entries.push(entry);
    }
    Ok((header, entries, hex(hasher.finalize())))
}

/// Every entry must live under the root implied by its kind, so an archive can
/// never overwrite the database or an unrelated file.
fn kind_matches_path(kind: &str, path: &str) -> bool {
    match kind {
        "domain" => path == "domain.json",
        "legacy-import" => path.starts_with("legacy-imports/"),
        "godot-source-blob" => path.starts_with("godot-source/"),
        "godot-asset-body" => path.starts_with("godot-assets/"),
        "asset-blob" => path.starts_with("asset-catalog/blobs/"),
        "content-repo" | "content-repo-object" => path.starts_with("content-history/repos/"),
        _ => false,
    }
}

/// Verifies an archive end to end without restoring it.
fn verify_archive(path: &Path) -> Result<Value> {
    let file = File::open(path).context("BACKUP_ARCHIVE_MISSING")?;
    let mut reader = BufReader::with_capacity(COPY_BUFFER, file);
    let (header, entries, archive_hash) = read_archive_head(&mut reader)?;
    let mut content_bytes = 0u64;
    let mut verified = 0u64;
    let mut buffer = vec![0u8; COPY_BUFFER];
    for entry in &entries {
        if entry["body"] != true {
            continue;
        }
        let name = entry["path"].as_str().context("BACKUP_PATH_REQUIRED")?;
        let bytes = entry["bytes"].as_u64().context("BACKUP_BYTES_REQUIRED")?;
        let sha256 = entry["sha256"].as_str().context("BACKUP_HASH_REQUIRED")?;
        let mut hasher = Sha256::new();
        let mut remaining = bytes;
        while remaining > 0 {
            let want = remaining.min(buffer.len() as u64) as usize;
            let read = reader.read(&mut buffer[..want])?;
            ensure!(read > 0, "BACKUP_ARCHIVE_TRUNCATED");
            hasher.update(&buffer[..read]);
            remaining -= read as u64;
        }
        ensure!(hex(hasher.finalize()) == sha256, "BACKUP_HASH_MISMATCH: {name}");
        content_bytes = content_bytes.checked_add(bytes).context("BACKUP_SIZE_OVERFLOW")?;
        verified += 1;
    }
    let footer: Value = serde_json::from_str(&read_line_limited(&mut reader)?)?;
    ensure!(footer["format"] == FORMAT, "BACKUP_FORMAT_UNSUPPORTED");
    ensure!(
        footer["entryCount"].as_u64() == Some(entries.len() as u64)
            && footer["contentBytes"].as_u64() == Some(content_bytes),
        "BACKUP_FOOTER_MISMATCH"
    );
    ensure!(
        footer["archiveHash"].as_str() == Some(archive_hash.as_str()),
        "BACKUP_HASH_MISMATCH"
    );
    let domain_entry = entries
        .iter()
        .find(|entry| entry["kind"] == "domain")
        .context("BACKUP_DOMAIN_MISSING")?;
    ensure!(
        header["consistency"]["snapshotHash"] == domain_entry["sha256"],
        "BACKUP_DOMAIN_HASH_MISMATCH"
    );
    let mut extra = Vec::new();
    reader.read_to_end(&mut extra)?;
    ensure!(extra.is_empty(), "BACKUP_ARCHIVE_TRAILING_BYTES");
    Ok(json!({
        "format": FORMAT,
        "valid": true,
        "archiveHash": footer["archiveHash"],
        "entries": entries.len(),
        "verifiedFiles": verified,
        "contentBytes": content_bytes,
        "createdAt": header["createdAt"],
        "consistency": header["consistency"],
        "rebuildable": header["rebuildable"],
        "credentialsIncluded": false,
    }))
}

/// Restores into a directory. Everything is staged and verified first; the
/// domain is applied inside one transaction that is committed only after every
/// body is in place, so a failure leaves the target as it was.
fn restore_archive(target: &Path, archive: &Path, existing: Option<&Connection>) -> Result<Value> {
    let staging = target.join(format!(
        ".portable-staging-{}-{}",
        std::process::id(),
        worlds::timestamp()?
    ));
    let created_database = existing.is_none();
    let mut placed: Vec<PathBuf> = Vec::new();
    let mut created_dirs: Vec<PathBuf> = Vec::new();
    let mut touched_repository_store = false;
    let result = (|| -> Result<Value> {
        fs::create_dir_all(target)?;
        fs::create_dir(&staging).context("BACKUP_STAGING_EXISTS")?;
        let file = File::open(archive).context("BACKUP_ARCHIVE_MISSING")?;
        let mut reader = BufReader::with_capacity(COPY_BUFFER, file);
        let (header, entries, archive_hash) = read_archive_head(&mut reader)?;
        let mut domain: Option<Value> = None;
        let mut staged: Vec<(String, PathBuf)> = Vec::new();
        let mut repositories: Vec<(String, String, Vec<(String, String)>)> = Vec::new();
        let mut repo_objects: Vec<(String, String, String, PathBuf)> = Vec::new();
        let mut content_bytes = 0u64;
        let mut verified = 0u64;
        let mut staged_index = 0usize;
        for entry in &entries {
            let name = entry["path"].as_str().context("BACKUP_PATH_REQUIRED")?;
            let bytes = entry["bytes"].as_u64().context("BACKUP_BYTES_REQUIRED")?;
            let sha256 = entry["sha256"].as_str().context("BACKUP_HASH_REQUIRED")?;
            let kind = entry["kind"].as_str().context("BACKUP_KIND_REQUIRED")?;
            if entry["body"] != true {
                ensure!(bytes == 0, "BACKUP_BODY_REQUIRED");
                if kind == "content-repo" {
                    let refs = entry["refs"]
                        .as_array()
                        .context("BACKUP_REFS_REQUIRED")?
                        .iter()
                        .map(|value| {
                            let text = value.as_str().context("BACKUP_REF_REQUIRED")?;
                            let (name, oid) = text.split_once('|').context("BACKUP_REF_REQUIRED")?;
                            Ok((name.to_owned(), oid.to_owned()))
                        })
                        .collect::<Result<Vec<_>>>()?;
                    repositories.push((
                        entry["repoId"]
                            .as_str()
                            .context("BACKUP_REPO_REQUIRED")?
                            .to_owned(),
                        entry["objectFormat"]
                            .as_str()
                            .context("BACKUP_OBJECT_FORMAT_REQUIRED")?
                            .to_owned(),
                        refs,
                    ));
                }
                continue;
            }
            let staged_path = staging.join(format!("entry-{staged_index}"));
            staged_index += 1;
            let mut output = BufWriter::with_capacity(COPY_BUFFER, File::create(&staged_path)?);
            let mut hasher = Sha256::new();
            let mut remaining = bytes;
            let mut buffer = vec![0u8; COPY_BUFFER];
            while remaining > 0 {
                let want = remaining.min(buffer.len() as u64) as usize;
                let read = reader.read(&mut buffer[..want])?;
                ensure!(read > 0, "BACKUP_ARCHIVE_TRUNCATED");
                hasher.update(&buffer[..read]);
                output.write_all(&buffer[..read])?;
                remaining -= read as u64;
            }
            output.flush()?;
            output
                .into_inner()
                .map_err(|error| error.into_error())?
                .sync_all()?;
            ensure!(hex(hasher.finalize()) == sha256, "BACKUP_HASH_MISMATCH: {name}");
            content_bytes = content_bytes.checked_add(bytes).context("BACKUP_SIZE_OVERFLOW")?;
            verified += 1;
            match kind {
                "domain" => {
                    ensure!(
                        header["consistency"]["snapshotHash"] == json!(sha256),
                        "BACKUP_DOMAIN_HASH_MISMATCH"
                    );
                    let value: Value = serde_json::from_slice(&fs::read(&staged_path)?)
                        .context("BACKUP_DOMAIN_INVALID")?;
                    domain = Some(value);
                }
                "content-repo-object" => repo_objects.push((
                    entry["repoId"]
                        .as_str()
                        .context("BACKUP_REPO_REQUIRED")?
                        .to_owned(),
                    entry["oid"].as_str().context("BACKUP_OID_REQUIRED")?.to_owned(),
                    entry["objectType"]
                        .as_str()
                        .context("BACKUP_OBJECT_TYPE_REQUIRED")?
                        .to_owned(),
                    staged_path,
                )),
                _ => staged.push((name.to_owned(), staged_path)),
            }
        }
        let footer: Value = serde_json::from_str(&read_line_limited(&mut reader)?)?;
        ensure!(
            footer["entryCount"].as_u64() == Some(entries.len() as u64)
                && footer["contentBytes"].as_u64() == Some(content_bytes)
                && footer["archiveHash"].as_str() == Some(archive_hash.as_str()),
            "BACKUP_FOOTER_MISMATCH"
        );
        let mut extra = Vec::new();
        reader.read_to_end(&mut extra)?;
        ensure!(extra.is_empty(), "BACKUP_ARCHIVE_TRAILING_BYTES");
        let domain = domain.context("BACKUP_DOMAIN_MISSING")?;

        // The domain is written inside this transaction but committed only
        // after every body is in place, so a failure rolls the database back.
        let journal;
        let db: &Connection = match existing {
            Some(db) => db,
            None => {
                journal = TaskJournal::open(&target.join("tasks.sqlite"))?;
                &journal.db
            }
        };
        let tx = db.unchecked_transaction()?;
        apply_domain_rows(&tx, &domain)?;

        for (name, staged_path) in &staged {
            let destination = target.join(name);
            if let Some(parent) = destination.parent() {
                let mut missing = Vec::new();
                let mut current = parent.to_path_buf();
                while !current.exists() {
                    missing.push(current.clone());
                    match current.parent() {
                        Some(parent) => current = parent.to_path_buf(),
                        None => break,
                    }
                }
                fs::create_dir_all(parent)?;
                missing.reverse();
                created_dirs.extend(missing);
            }
            fs::rename(staged_path, &destination)
                .with_context(|| format!("BACKUP_CONTENT_PLACE_FAILED: {name}"))?;
            placed.push(destination);
        }

        let mut repo_report = Vec::new();
        if !repositories.is_empty() {
            touched_repository_store = true;
        }
        for (repo_id, object_format, refs) in &repositories {
            let store = repository_store(target)?;
            let layout = store
                .create(repo_id, object_format, None)
                .with_context(|| format!("BACKUP_REPO_CREATE_FAILED: {repo_id}"))?;
            let mut objects = 0u64;
            for (owner, oid, object_type, staged_path) in &repo_objects {
                if owner != repo_id {
                    continue;
                }
                let body = fs::read(staged_path)
                    .with_context(|| format!("BACKUP_OBJECT_STAGED_MISSING: {oid}"))?;
                let written = store
                    .git()
                    .repo_stdin(
                        &layout.git_dir,
                        &["hash-object", "-w", "--stdin", "-t", object_type],
                        &body,
                    )?
                    .ensure_ok("BACKUP_OBJECT_RESTORE_FAILED")?
                    .trimmed()?;
                ensure!(written == *oid, "BACKUP_OBJECT_ID_MISMATCH: {oid}");
                objects += 1;
            }
            for (name, oid) in refs {
                store
                    .git()
                    .repo(&layout.git_dir, &["update-ref", name, oid])?
                    .ensure_ok("BACKUP_REF_RESTORE_FAILED")?;
            }
            repo_report.push(json!({
                "repoId": repo_id,
                "objectFormat": object_format,
                "objects": objects,
                "refs": store.git().list_refs(&layout.git_dir, "refs/")?.len(),
            }));
        }

        super::validate_integrity(&tx)?;
        let current_hash = fingerprint(&tx)?;
        let rebuild_required = tx
            .prepare("SELECT DISTINCT build_id FROM craftmine_godot_builds ORDER BY build_id")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        tx.commit()?;
        fs::remove_dir_all(&staging).ok();
        Ok(json!({
            "archiveHash": footer["archiveHash"],
            "domainHash": header["consistency"]["snapshotHash"],
            "currentHash": current_hash,
            "entries": entries.len(),
            "contentBytes": content_bytes,
            "verifiedFiles": verified,
            "repositories": repo_report,
            "rebuildRequired": rebuild_required,
        }))
    })();
    if result.is_err() {
        for path in placed.iter().rev() {
            let _ = fs::remove_file(path);
        }
        for dir in created_dirs.iter().rev() {
            let _ = fs::remove_dir(dir);
        }
        if touched_repository_store {
            let _ = fs::remove_dir_all(target.join("content-history"));
        }
        if created_database {
            for name in ["tasks.sqlite", "tasks.sqlite-wal", "tasks.sqlite-shm"] {
                let _ = fs::remove_file(target.join(name));
            }
        }
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Replaces every registered domain table with the archive rows inside the
/// caller's transaction. Every live table must be present in the archive, so an
/// older archive can never silently drop a table that was added since.
fn apply_domain_rows(db: &Connection, domain: &Value) -> Result<()> {
    let map = domain.as_object().context("BACKUP_TABLES_REQUIRED")?;
    let live = tables(db)?;
    db.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
    for table in &live {
        ensure!(
            map.contains_key(table),
            "BACKUP_SCHEMA_MISMATCH: {table} missing from the archive"
        );
    }
    for table in &live {
        db.execute(&format!("DELETE FROM {table}"), [])?;
    }
    for (table, data) in map {
        ensure!(live.contains(table), "BACKUP_SCHEMA_MISMATCH: {table}");
        let archive_columns: Vec<String> = data["columns"]
            .as_array()
            .context("BACKUP_COLUMNS_REQUIRED")?
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .context("BACKUP_COLUMNS_REQUIRED")
            })
            .collect::<Result<Vec<_>>>()?;
        let live_columns = columns(db, table)?;
        for column in &archive_columns {
            ensure!(
                live_columns.contains(column),
                "BACKUP_COLUMNS_MISMATCH: {table}.{column}"
            );
        }
        let rows = data["rows"].as_array().context("BACKUP_ROWS_REQUIRED")?;
        let placeholders = (1..=archive_columns.len())
            .map(|n| format!("?{n}"))
            .collect::<Vec<_>>()
            .join(",");
        let mut statement = db.prepare(&format!(
            "INSERT INTO {table} ({}) VALUES({placeholders})",
            archive_columns.join(",")
        ))?;
        for row in rows {
            let row = row.as_array().context("BACKUP_ROW_REQUIRED")?;
            ensure!(
                row.len() == archive_columns.len(),
                "BACKUP_ROW_WIDTH_MISMATCH"
            );
            let values = row
                .iter()
                .map(|value| match value {
                    Value::Null => Ok(rusqlite::types::Value::Null),
                    Value::String(text) => Ok(rusqlite::types::Value::Text(text.clone())),
                    Value::Number(number) => {
                        if let Some(int) = number.as_i64() {
                            Ok(rusqlite::types::Value::Integer(int))
                        } else if let Some(real) = number.as_f64() {
                            Ok(rusqlite::types::Value::Real(real))
                        } else {
                            anyhow::bail!("BACKUP_INVALID_NUMBER")
                        }
                    }
                    _ => anyhow::bail!("BACKUP_INVALID_VALUE"),
                })
                .collect::<Result<Vec<_>>>()?;
            statement.execute(rusqlite::params_from_iter(values))?;
        }
    }
    Ok(())
}

/// The archive table list, exposed so a caller can report what a restore will
/// replace without opening an archive.
#[cfg(test)]
pub(super) fn registered_tables(db: &Connection) -> Result<Vec<String>> {
    tables(db)
}
