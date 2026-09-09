//! Read-only capture of legacy projects. Rust owns both the sealed archive and
//! the imported world transaction; the compatibility compiler only validates.
use super::{digest, worlds, TaskJournal, WorldDocument, WorldRecord};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

const MAX_FILES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct FileRecord {
    bytes: u64,
    hash: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Manifest {
    format: String,
    files: BTreeMap<String, FileRecord>,
    directories: BTreeSet<String>,
    bytes: u64,
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_legacy_imports (
      id TEXT PRIMARY KEY, manifest TEXT NOT NULL, manifest_hash TEXT NOT NULL,
      world_hash TEXT, world_id TEXT REFERENCES craftmine_worlds(id)
    );",
    )?;
    Ok(())
}

fn ordinary(path: &Path) -> Result<fs::Metadata> {
    let meta = fs::symlink_metadata(path)?;
    ensure!(!meta.file_type().is_symlink(), "LEGACY_LINK_REFUSED");
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        ensure!(
            meta.file_attributes() & 0x400 == 0,
            "LEGACY_REPARSE_POINT_REFUSED"
        );
    }
    ensure!(
        meta.is_dir() || meta.is_file(),
        "LEGACY_SPECIAL_FILE_REFUSED"
    );
    Ok(meta)
}

fn relative_path(name: &str) -> Result<PathBuf> {
    ensure!(
        !name.is_empty() && !name.contains(['\\', ':']),
        "INVALID_ARCHIVE_PATH"
    );
    let path = Path::new(name);
    ensure!(
        path.components()
            .all(|part| matches!(part, Component::Normal(_))),
        "INVALID_ARCHIVE_PATH"
    );
    Ok(path.into())
}

fn file_bytes(path: &Path) -> Result<Vec<u8>> {
    let meta = ordinary(path)?;
    ensure!(
        meta.is_file() && meta.len() <= MAX_FILE_BYTES,
        "LEGACY_FILE_TOO_LARGE"
    );
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= MAX_FILE_BYTES,
        "LEGACY_FILE_TOO_LARGE"
    );
    Ok(bytes)
}

fn bytes_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn scan(
    source: &Path,
    relative: &Path,
    destination: Option<&Path>,
    manifest: &mut Manifest,
    depth: usize,
) -> Result<()> {
    ensure!(depth <= 32, "LEGACY_PATH_TOO_DEEP");
    let directory = source.join(relative);
    ensure!(ordinary(&directory)?.is_dir(), "LEGACY_DIRECTORY_REQUIRED");
    for entry in fs::read_dir(&directory)? {
        ensure!(
            manifest.files.len() + manifest.directories.len() < MAX_FILES,
            "LEGACY_TOO_MANY_ENTRIES"
        );
        let entry = entry?;
        let child = relative.join(entry.file_name());
        let name = child
            .to_str()
            .context("LEGACY_PATH_ENCODING")?
            .replace('\\', "/");
        relative_path(&name)?;
        let meta = ordinary(&source.join(&child))?;
        if meta.is_dir() {
            manifest.directories.insert(name);
            if let Some(root) = destination {
                fs::create_dir(root.join(&child))?;
            }
            scan(source, &child, destination, manifest, depth + 1)?;
        } else {
            ensure!(
                meta.len() <= MAX_FILE_BYTES && manifest.bytes + meta.len() <= MAX_ARCHIVE_BYTES,
                "LEGACY_ARCHIVE_TOO_LARGE"
            );
            let bytes = file_bytes(&source.join(&child))?;
            manifest.bytes += bytes.len() as u64;
            ensure!(
                manifest.bytes <= MAX_ARCHIVE_BYTES,
                "LEGACY_ARCHIVE_TOO_LARGE"
            );
            manifest.files.insert(
                name,
                FileRecord {
                    bytes: bytes.len() as u64,
                    hash: bytes_hash(&bytes),
                },
            );
            if let Some(root) = destination {
                write_new(&root.join(&child), &bytes)?;
            }
        }
    }
    Ok(())
}

fn contains_path(parent: &Path, child: &Path) -> bool {
    #[cfg(windows)]
    {
        let parent = parent.to_string_lossy().to_lowercase();
        let child = child.to_string_lossy().to_lowercase();
        child == parent || child.starts_with(&(parent.trim_end_matches('\\').to_owned() + "\\"))
    }
    #[cfg(not(windows))]
    {
        child.starts_with(parent)
    }
}

impl TaskJournal {
    fn archive_path(&self, id: &str) -> Result<PathBuf> {
        worlds::validate_id(id)?;
        Ok(self.directory.join("legacy-imports").join(id))
    }

    fn legacy_manifest(&self, id: &str) -> Result<Manifest> {
        let (body, hash): (String, String) = self
            .db
            .query_row(
                "SELECT manifest,manifest_hash FROM craftmine_legacy_imports WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .context("LEGACY_IMPORT_NOT_FOUND")?;
        ensure!(digest(&body) == hash, "CORRUPT_IMPORT_MANIFEST");
        Ok(serde_json::from_str(&body)?)
    }

    pub fn legacy_capture(&mut self, id: &str, selected: &Path) -> Result<Value> {
        ensure!(selected.is_absolute(), "LEGACY_ABSOLUTE_PATH_REQUIRED");
        ensure!(ordinary(selected)?.is_dir(), "LEGACY_DIRECTORY_REQUIRED");
        let source = if selected.join("project.json").is_file() {
            selected.to_path_buf()
        } else {
            selected.join(".craftmine")
        };
        ensure!(
            ordinary(&source)
                .context("LEGACY_PROJECT_NOT_FOUND")?
                .is_dir(),
            "LEGACY_DIRECTORY_REQUIRED"
        );
        let source = fs::canonicalize(source)?;
        ensure!(
            !contains_path(&source, &self.directory) && !contains_path(&self.directory, &source),
            "LEGACY_PROFILE_OVERLAP"
        );
        let project: Value = serde_json::from_slice(&file_bytes(&source.join("project.json"))?)?;
        ensure!(
            project["format"] == "craftmine.project/1",
            "LEGACY_PROJECT_FORMAT"
        );
        let archive = self.archive_path(id)?;
        fs::create_dir_all(archive.parent().context("ARCHIVE_PARENT")?)?;
        ordinary(archive.parent().context("ARCHIVE_PARENT")?)?;
        fs::create_dir(&archive).context("LEGACY_IMPORT_ID_EXISTS")?;
        fs::create_dir(archive.join("source"))?;
        let empty = || Manifest {
            format: "craftmine.legacy-archive/1".into(),
            files: BTreeMap::new(),
            directories: BTreeSet::new(),
            bytes: 0,
        };
        let mut captured = empty();
        scan(
            &source,
            Path::new(""),
            Some(&archive.join("source")),
            &mut captured,
            0,
        )?;
        // Existing immutable build IDs plus a second full digest pass reject a
        // source being changed by the old application during capture.
        let mut rechecked = empty();
        scan(&source, Path::new(""), None, &mut rechecked, 0)?;
        ensure!(captured == rechecked, "LEGACY_SOURCE_CHANGED_RETRY");
        let body = serde_json::to_string(&captured)?;
        write_new(&archive.join("manifest.json"), body.as_bytes())?;
        self.db.execute(
            "INSERT INTO craftmine_legacy_imports(id,manifest,manifest_hash) VALUES(?1,?2,?3)",
            params![id, body, digest(&body)],
        )?;
        Ok(
            json!({"id":id,"files":captured.files.len(),"bytes":captured.bytes,"manifestHash":digest(&body),"project":self.legacy_read(id,"project.json")?}),
        )
    }

    pub fn legacy_read(&self, id: &str, name: &str) -> Result<Value> {
        let relative = relative_path(name)?;
        let manifest = self.legacy_manifest(id)?;
        let record = manifest
            .files
            .get(name)
            .context("LEGACY_FILE_NOT_IN_MANIFEST")?;
        let root = self.archive_path(id)?.join("source");
        let mut checked = root.clone();
        ordinary(&checked)?;
        for part in relative.components() {
            checked.push(part);
            ordinary(&checked)?;
        }
        let bytes = file_bytes(&root.join(relative))?;
        ensure!(
            record.bytes == bytes.len() as u64 && record.hash == bytes_hash(&bytes),
            "CORRUPT_LEGACY_FILE"
        );
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn legacy_commit(
        &mut self,
        id: &str,
        title: &str,
        world: &WorldDocument,
    ) -> Result<WorldRecord> {
        // The bridge has checked the scene, extension ABI, asset hashes and
        // snapshot against this sealed project. Keep its provenance durable.
        let sealed = self.legacy_manifest(id)?;
        let mut checked = Manifest {
            format: sealed.format.clone(),
            files: BTreeMap::new(),
            directories: BTreeSet::new(),
            bytes: 0,
        };
        scan(
            &self.archive_path(id)?.join("source"),
            Path::new(""),
            None,
            &mut checked,
            0,
        )?;
        ensure!(sealed == checked, "CORRUPT_LEGACY_ARCHIVE");
        let body = worlds::encode(world)?;
        let hash = digest(&body);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let previous: Option<String> = tx.query_row(
            "SELECT world_hash FROM craftmine_legacy_imports WHERE id=?1",
            [id],
            |row| row.get(0),
        )?;
        if let Some(previous) = previous {
            ensure!(previous == hash, "LEGACY_IMPORT_CONFLICT");
            return worlds::read(&tx, id);
        }
        worlds::insert(&tx, id, title, world)?;
        tx.execute(
            "UPDATE craftmine_legacy_imports SET world_hash=?2,world_id=?1 WHERE id=?1",
            params![id, hash],
        )?;
        tx.commit()?;
        worlds::read(&self.db, id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, PathBuf, TaskJournal) {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("legacy");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("project.json"), r#"{"format":"craftmine.project/1","candidate":{"id":"pending"},"tasks":[{"status":"running"}]}"#).unwrap();
        fs::create_dir(source.join("tasks")).unwrap();
        fs::write(source.join("tasks/draft.json"), r#"{"code":"unfinished"}"#).unwrap();
        let db = TaskJournal::open(&dir.path().join("desktop/tasks.sqlite")).unwrap();
        (dir, source, db)
    }
    #[test]
    fn captures_every_file_without_mutating_or_restarting_legacy_tasks() {
        let (dir, source, mut db) = setup();
        let before = fs::read(source.join("project.json")).unwrap();
        let result = db.legacy_capture("import-1", &source).unwrap();
        assert_eq!(result["files"], 2);
        assert_eq!(result["project"]["tasks"][0]["status"], "running");
        assert_eq!(fs::read(source.join("project.json")).unwrap(), before);
        drop(db);
        let db = TaskJournal::open(&dir.path().join("desktop/tasks.sqlite")).unwrap();
        assert_eq!(
            db.legacy_read("import-1", "tasks/draft.json").unwrap()["code"],
            "unfinished"
        );
        assert!(db.world_list().unwrap().is_empty());
    }
    #[test]
    fn corrupt_archives_and_paths_cannot_escape_or_publish() {
        let (_dir, source, mut db) = setup();
        assert!(db.legacy_capture("../escape", &source).is_err());
        assert!(db
            .legacy_capture("same-profile", &db.directory.clone())
            .is_err());
        db.legacy_capture("copy", &source).unwrap();
        for name in [
            "../project.json",
            "/project.json",
            "C:/private",
            "tasks/../../project.json",
        ] {
            assert!(db.legacy_read("copy", name).is_err());
        }
        fs::write(
            db.archive_path("copy").unwrap().join("source/project.json"),
            "{}",
        )
        .unwrap();
        assert!(db
            .legacy_read("copy", "project.json")
            .unwrap_err()
            .to_string()
            .contains("CORRUPT_LEGACY_FILE"));
        assert!(db.world_list().unwrap().is_empty());
    }

    #[test]
    fn import_commit_is_atomic_and_replay_does_not_reset_play_progress() {
        let (dir, source, mut db) = setup();
        db.legacy_capture("import", &source).unwrap();
        let world: WorldDocument = serde_json::from_value(json!({
            "build":{"id":"build-a","scene":{},"assetPayload":"x".repeat(2_100_000)},
            "snapshot":{"format":"craftmine.progress/1","player":{"x":0.5,"y":6,"z":12.5,"yaw":0,"pitch":0}},
            "extensions":[]
        })).unwrap();
        assert!(db.legacy_commit("import", "", &world).is_err());
        assert!(db.world_list().unwrap().is_empty());
        db.legacy_commit("import", "Imported", &world).unwrap();
        let mut progress = world.snapshot.clone();
        progress["player"]["x"] = json!(8);
        db.world_save_progress("import", 0, "build-a", &progress)
            .unwrap();
        drop(db);
        let mut db = TaskJournal::open(&dir.path().join("desktop/tasks.sqlite")).unwrap();
        let replay = db.legacy_commit("import", "Imported", &world).unwrap();
        assert_eq!(replay.world.snapshot, progress);
        assert_eq!(db.world_list().unwrap().len(), 1);
        let mut different = world.clone();
        different.build["id"] = json!("other");
        assert!(db
            .legacy_commit("import", "Imported", &different)
            .unwrap_err()
            .to_string()
            .contains("IMPORT_CONFLICT"));
        fs::write(
            db.archive_path("import")
                .unwrap()
                .join("source/tasks/draft.json"),
            "{}",
        )
        .unwrap();
        assert!(db
            .legacy_commit("import", "Imported", &world)
            .unwrap_err()
            .to_string()
            .contains("CORRUPT_LEGACY_ARCHIVE"));
    }
}
