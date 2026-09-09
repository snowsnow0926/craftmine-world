//! AL1 authorized-directory scanning. Produces new-version hints only.
//!
//! The scan never imports, never registers a version and never touches a world
//! or a running client. Directory watching is deliberately left to the host as
//! a repeated scan so that a filesystem event can never mutate a world.
use std::path::{Path, PathBuf};

use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};

use crate::durable::{fields, number, text};
use crate::TaskJournal;

use super::budget::IMPORT_CHUNK_BYTES;
use super::contract;

fn optional_number(args: &Value, key: &str, max: u64, default: u64) -> Result<u64> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(_) => number(args, key, max),
    }
}

const SCAN_FILES: u64 = 20_000;
const SCAN_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const SCAN_HASH_BYTES: u64 = 512 * 1024 * 1024;
const SCAN_DEPTH: usize = 16;

fn media_type_of(name: &str) -> Option<&'static str> {
    let extension = name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "glb" => Some("model/gltf-binary"),
        "wav" => Some("audio/wav"),
        "ogg" => Some("audio/ogg"),
        "tscn" | "tres" | "gd" => Some("application/x-godot-package"),
        _ => None,
    }
}

fn relative(root: &Path, path: &Path) -> Result<String> {
    let suffix = path.strip_prefix(root).context("ASSET_SCAN_UNAVAILABLE")?;
    let mut parts = Vec::new();
    for component in suffix.components() {
        let text = component
            .as_os_str()
            .to_str()
            .context("ASSET_SCAN_UNAVAILABLE")?;
        parts.push(text.to_string());
    }
    Ok(parts.join("/"))
}

fn hash_file(path: &Path, budget: &mut u64) -> Result<Option<String>> {
    let meta = crate::godot_projects::ordinary(path, "ASSET_SCAN_UNAVAILABLE")?;
    if meta.len() > *budget {
        return Ok(None);
    }
    let mut reader = crate::godot_builds::open_read(path)
        .map_err(|error| super::source_io_error(path, error))?;
    let mut hasher = <sha2::Sha256 as sha2::Digest>::new();
    let mut buffer = vec![0u8; IMPORT_CHUNK_BYTES];
    let mut total: u64 = 0;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        ensure!(total <= meta.len(), "ASSET_SCAN_UNAVAILABLE");
        sha2::Digest::update(&mut hasher, &buffer[..read]);
    }
    *budget = budget.saturating_sub(total);
    Ok(Some(
        sha2::Digest::finalize(hasher)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    ))
}

use std::io::Read;

struct Walk {
    root: PathBuf,
    items: Vec<Value>,
    issues: Vec<Value>,
    files: u64,
    bytes: u64,
    hash_budget: u64,
    truncated: bool,
    max_files: u64,
    max_bytes: u64,
    lookup_files: std::collections::BTreeMap<String, (String, i64)>,
}

impl Walk {
    fn visit(&mut self, directory: &Path, depth: usize) -> Result<()> {
        if depth > SCAN_DEPTH || self.truncated {
            self.truncated = true;
            return Ok(());
        }
        let mut entries: Vec<PathBuf> = Vec::new();
        for entry in std::fs::read_dir(directory).context("ASSET_SCAN_UNAVAILABLE")? {
            entries.push(entry?.path());
            // Bound memory for very large directories; the walk is already
            // budget-limited, so a partial listing is reported as truncated.
            if entries.len() as u64 > self.max_files {
                self.truncated = true;
                break;
            }
        }
        entries.sort();
        for path in entries {
            if self.truncated {
                return Ok(());
            }
            let meta = match crate::godot_projects::ordinary(&path, "ASSET_SCAN_UNAVAILABLE") {
                Ok(meta) => meta,
                Err(_) => {
                    self.issues
                        .push(json!({"path": relative(&self.root, &path)?, "code": "LINK_SKIPPED"}));
                    continue;
                }
            };
            if meta.is_dir() {
                self.visit(&path, depth + 1)?;
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            if self.files >= self.max_files || self.bytes >= self.max_bytes {
                self.truncated = true;
                return Ok(());
            }
            self.files += 1;
            self.bytes = self.bytes.saturating_add(meta.len());
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_string();
            let relative_path = match relative(&self.root, &path) {
                Ok(value) => value,
                Err(_) => {
                    self.issues.push(json!({
                        "path": Value::Null,
                        "code": "NON_UTF8_PATH",
                    }));
                    continue;
                }
            };
            let media_type = media_type_of(&name);
            let mut item = json!({
                "path": relative_path,
                "bytes": meta.len(),
                "supported": media_type.is_some(),
                "mediaType": media_type,
            });
            if contract::validate_relative_path(&relative_path).is_err() {
                self.issues.push(json!({
                    "path": relative_path,
                    "code": "INVALID_ASSET_PATH",
                }));
            }
            let Some(media_type) = media_type else {
                self.issues.push(json!({
                    "path": relative_path,
                    "code": "UNSUPPORTED_MEDIA_TYPE",
                }));
                self.items.push(item);
                continue;
            };
            let hash = match hash_file(&path, &mut self.hash_budget) {
                Ok(hash) => hash,
                Err(error) => {
                    // One locked or unreadable file must not fail the whole
                    // authorized scan; it is reported as an issue instead.
                    self.issues.push(json!({
                        "path": item["path"].clone(),
                        "code": super::source_io_code(&error),
                    }));
                    item["known"] = Value::Null;
                    self.items.push(item);
                    continue;
                }
            };
            match hash {
                Some(sha256) => {
                    let known: Option<(String, i64)> = self.lookup(&sha256)?;
                    item["sha256"] = json!(sha256);
                    item["known"] = json!(known.is_some());
                    if let Some((asset_id, version)) = known {
                        item["assetId"] = json!(asset_id);
                        item["version"] = json!(version as u64);
                    }
                }
                None => {
                    item["known"] = Value::Null;
                    self.issues.push(json!({
                        "path": item["path"].clone(),
                        "code": "HASH_BUDGET_EXHAUSTED",
                    }));
                }
            }
            item["mediaType"] = json!(media_type);
            self.items.push(item);
        }
        Ok(())
    }

    fn lookup(&self, sha256: &str) -> Result<Option<(String, i64)>> {
        Ok(self
            .lookup_files
            .get(sha256)
            .map(|(asset_id, version)| (asset_id.clone(), *version)))
    }
}

impl TaskJournal {
    /// Scans one player-authorized directory and reports what would become a
    /// new version. Nothing is registered and no world is modified.
    pub fn asset_scan(&self, args: &Value) -> Result<Value> {
        fields(
            args,
            &["sourceRoot", "maxFiles", "maxBytes", "hashBytes"],
        )?;
        let root = std::fs::canonicalize(text(args, "sourceRoot", 4096)?)
            .context("ASSET_SCAN_UNAVAILABLE")?;
        ensure!(
            crate::godot_projects::ordinary(&root, "ASSET_SCAN_UNAVAILABLE")?.is_dir(),
            "ASSET_SCAN_UNAVAILABLE"
        );
        let max_files = optional_number(args, "maxFiles", SCAN_FILES, SCAN_FILES)?.max(1);
        let max_bytes = optional_number(args, "maxBytes", SCAN_BYTES, SCAN_BYTES)?.max(1);
        let hash_bytes = optional_number(args, "hashBytes", SCAN_HASH_BYTES, SCAN_HASH_BYTES)?;

        let mut known = std::collections::BTreeMap::new();
        let mut statement = self.db.prepare(
            "SELECT sha256,asset_id,version FROM craftmine_asset_files ORDER BY sha256,asset_id,version",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (sha256, asset_id, version) = row?;
            known.entry(sha256).or_insert((asset_id, version));
        }

        let mut walk = Walk {
            root: root.clone(),
            items: Vec::new(),
            issues: Vec::new(),
            files: 0,
            bytes: 0,
            hash_budget: hash_bytes,
            truncated: false,
            max_files,
            max_bytes,
            lookup_files: known,
        };
        walk.visit(&root, 0)?;
        let new_versions = walk
            .items
            .iter()
            .filter(|item| item["known"] == Value::Bool(false))
            .count();
        let unchanged = walk
            .items
            .iter()
            .filter(|item| item["known"] == Value::Bool(true))
            .count();
        let unsupported = walk
            .items
            .iter()
            .filter(|item| item["supported"] == Value::Bool(false))
            .count();
        Ok(json!({
            "root": root.to_string_lossy(),
            "scanned": walk.files,
            "bytes": walk.bytes,
            "truncated": walk.truncated,
            "maxFiles": max_files,
            "maxBytes": max_bytes,
            "items": walk.items,
            "issues": walk.issues,
            "hints": {
                "newVersions": new_versions,
                "unchanged": unchanged,
                "unsupported": unsupported,
            },
            "worldUpdated": false,
        }))
    }

}
