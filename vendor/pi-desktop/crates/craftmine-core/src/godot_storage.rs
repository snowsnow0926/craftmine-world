//! Long-term Godot storage: per-category accounting, a per-world quota and
//! reference-checked reclamation of core-owned derived data.
//!
//! Only data this core owns is deleted: immutable build copies and the rows that
//! describe them. Asset bodies belong to the asset library and Git history
//! belongs to the version store, so they are measured and reported here but
//! never removed by this module. Every deletion is planned from durable rows,
//! re-derived before it runs, and journalled so a crash can be completed.
use std::path::{Path, PathBuf};

use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{digest, godot_builds, godot_projects::ordinary, worlds, TaskJournal, WorkspaceContext};

#[cfg(test)]
#[path = "godot_storage_tests.rs"]
mod tests;

/// Hard cap on one world's derived Godot storage (build copies + asset blobs +
/// source blobs). Exported Web builds dominate this number.
pub(super) const WORLD_STORAGE_TOTAL: u64 = 512 * 1024 * 1024;
const WALK_LIMIT: u64 = 200_000;
const KEEP_RECENT_BUILDS: usize = 2;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatusArgs {
    world_id: String,
    #[serde(default)]
    context: Option<WorkspaceContext>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanArgs {
    world_id: String,
    #[serde(default)]
    context: Option<WorkspaceContext>,
    /// Builds a caller (works, backups, Git history) still pins. They are never
    /// reclaimed even when this core sees no local reference.
    #[serde(default)]
    protected_builds: Vec<String>,
    #[serde(default)]
    keep_recent_builds: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitArgs {
    world_id: String,
    #[serde(default)]
    context: Option<WorkspaceContext>,
    plan_id: String,
    plan_hash: String,
    #[serde(default)]
    protected_builds: Vec<String>,
    #[serde(default)]
    keep_recent_builds: Option<usize>,
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_godot_reclaims (
            id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES craftmine_worlds(id),
            plan_hash TEXT NOT NULL, status TEXT NOT NULL, builds INTEGER NOT NULL,
            bytes INTEGER NOT NULL, detail TEXT NOT NULL,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS craftmine_godot_reclaims_world
            ON craftmine_godot_reclaims(world_id,created_at);",
    )?;
    Ok(())
}

fn source_blob_root(directory: &Path, world: &str) -> PathBuf {
    directory.join("godot-source").join(digest(world)).join("blobs")
}

fn builds_parent(directory: &Path, world: &str) -> PathBuf {
    directory.join("godot-builds").join(digest(world))
}

fn asset_dir(directory: &Path, world: &str) -> PathBuf {
    directory.join("godot-assets").join(digest(world))
}

/// Path to one build copy. Ids are validated before they are joined so a crafted
/// id can never escape the world's storage directory.
fn build_dir(directory: &Path, world: &str, build: &str) -> Result<PathBuf> {
    worlds::validate_id(world)?;
    godot_builds::valid_build_id(build)?;
    Ok(builds_parent(directory, world).join(build))
}

/// Bounded, symlink-refusing size walk. A link, device or unreadable entry is a
/// hard error rather than silently ignored bytes.
fn measure(root: &Path) -> Result<(u64, u64)> {
    if !root.try_exists()? {
        return Ok((0, 0));
    }
    ensure!(
        ordinary(root, "GODOT_STORAGE_UNAVAILABLE")?.is_dir(),
        "GODOT_STORAGE_UNAVAILABLE"
    );
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current).context("GODOT_STORAGE_UNAVAILABLE")? {
            let entry = entry.context("GODOT_STORAGE_UNAVAILABLE")?;
            let meta = ordinary(&entry.path(), "GODOT_STORAGE_UNAVAILABLE")?;
            if meta.is_dir() {
                stack.push(entry.path());
                continue;
            }
            ensure!(meta.is_file(), "GODOT_STORAGE_UNAVAILABLE");
            files += 1;
            bytes = bytes.checked_add(meta.len()).context("GODOT_STORAGE_UNMEASURABLE")?;
            ensure!(files <= WALK_LIMIT, "GODOT_STORAGE_UNMEASURABLE");
        }
    }
    Ok((files, bytes))
}

fn count(db: &Connection, sql: &str, world: &str) -> Result<i64> {
    Ok(db.query_row(sql, [world], |row| row.get(0))?)
}

impl TaskJournal {
    /// Per-category accounting for one world. Nothing is deleted here.
    pub fn godot_storage_status(&self, args: &Value) -> Result<Value> {
        let args: StatusArgs = serde_json::from_value(args.clone())?;
        super::godot_jobs::world_scope(&self.db, &args.world_id, args.context.as_ref())?;
        let world = &args.world_id;
        let revisions = count(&self.db, "SELECT COUNT(*) FROM craftmine_godot_revisions WHERE world_id=?1", world)?;
        let assets = count(&self.db, "SELECT COUNT(*) FROM craftmine_godot_assets WHERE world_id=?1", world)?;
        let builds = count(&self.db, "SELECT COUNT(*) FROM craftmine_godot_builds WHERE world_id=?1", world)?;
        let (source_files, source_bytes) = measure(&source_blob_root(&self.directory, world))?;
        let (asset_files, asset_bytes) = measure(&asset_dir(&self.directory, world))?;
        let mut build_files = 0u64;
        let mut build_bytes = 0u64;
        let mut artifact_files = 0u64;
        let mut artifact_bytes = 0u64;
        let mut cache_files = 0u64;
        let mut cache_bytes = 0u64;
        for id in build_ids(&self.db, world)? {
            let root = build_dir(&self.directory, world, &id)?;
            let (files, bytes) = measure(&root)?;
            build_files += files;
            build_bytes = build_bytes.checked_add(bytes).context("GODOT_STORAGE_UNMEASURABLE")?;
            let (af, ab) = measure(&root.join("artifacts"))?;
            artifact_files += af;
            artifact_bytes = artifact_bytes.checked_add(ab).context("GODOT_STORAGE_UNMEASURABLE")?;
            let (cf, cb) = measure(&root.join("cache"))?;
            cache_files += cf;
            cache_bytes = cache_bytes.checked_add(cb).context("GODOT_STORAGE_UNMEASURABLE")?;
        }
        let used = build_bytes
            .checked_add(asset_bytes)
            .and_then(|total| total.checked_add(source_bytes))
            .context("GODOT_STORAGE_UNMEASURABLE")?;
        let plan = plan(&self.db, &self.directory, world, &[], KEEP_RECENT_BUILDS)?;
        Ok(json!({
            "format":"craftmine.godot-storage/1","worldId":world,
            "categories":{
                "sourceHistory":{"revisions":revisions,"files":source_files,"bytes":source_bytes},
                "assetBlobs":{"assets":assets,"files":asset_files,"bytes":asset_bytes},
                "buildHistory":{"builds":builds,"files":build_files,"bytes":build_bytes},
                "artifacts":{"files":artifact_files,"bytes":artifact_bytes},
                "cache":{"files":cache_files,"bytes":cache_bytes}
            },
            "quota":{"limitBytes":WORLD_STORAGE_TOTAL,"usedBytes":used,
                "remainingBytes":WORLD_STORAGE_TOTAL.saturating_sub(used)},
            "reclaimable":{"builds":plan["deletable"].as_array().map(Vec::len).unwrap_or(0),
                "bytes":plan["freedBytes"]},
            "unreferencedDirectories":plan["unreferencedDirectories"],
            "ownedByOthers":["assetBodies","gitHistory","backups"]
        }))
    }

    /// Compute what could be reclaimed. Pure read: no rows and no files change.
    pub fn godot_storage_reclaim_plan(&self, args: &Value) -> Result<Value> {
        let args: PlanArgs = serde_json::from_value(args.clone())?;
        super::godot_jobs::world_scope(&self.db, &args.world_id, args.context.as_ref())?;
        let keep = args.keep_recent_builds.unwrap_or(KEEP_RECENT_BUILDS);
        ensure!(keep <= 64, "INVALID_RECLAIM_KEEP");
        for id in &args.protected_builds {
            godot_builds::valid_build_id(id)?;
        }
        plan(
            &self.db,
            &self.directory,
            &args.world_id,
            &args.protected_builds,
            keep,
        )
    }

    /// Execute a previously computed plan. The plan is recomputed first, so a
    /// reference created in between makes the call `GODOT_RECLAIM_PLAN_STALE`
    /// instead of deleting data that is now in use.
    pub fn godot_storage_reclaim_commit(&mut self, args: &Value) -> Result<Value> {
        let args: CommitArgs = serde_json::from_value(args.clone())?;
        super::godot_jobs::world_scope(&self.db, &args.world_id, args.context.as_ref())?;
        let keep = args.keep_recent_builds.unwrap_or(KEEP_RECENT_BUILDS);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = plan(&tx, &self.directory, &args.world_id, &args.protected_builds, keep)?;
        ensure!(
            current["planId"] == args.plan_id && current["planHash"] == args.plan_hash,
            "GODOT_RECLAIM_PLAN_STALE"
        );
        let deletable: Vec<String> = current["deletable"]
            .as_array()
            .context("INVALID_RECLAIM_PLAN")?
            .iter()
            .filter_map(|item| item["buildId"].as_str().map(str::to_string))
            .collect();
        let now = worlds::timestamp()?;
        if deletable.is_empty() {
            tx.commit()?;
            return Ok(json!({"planId":args.plan_id,"planHash":args.plan_hash,"status":"empty",
                "removedBuilds":0,"freedBytes":0}));
        }
        let id = format!(
            "grcl-{}",
            digest(&format!("craftmine.godot-reclaim/1|{}|{}", args.world_id, args.plan_hash))
        );
        tx.execute(
            "INSERT OR REPLACE INTO craftmine_godot_reclaims(id,world_id,plan_hash,status,builds,bytes,
                detail,created_at,updated_at) VALUES(?1,?2,?3,'planned',?4,?5,?6,?7,?7)",
            params![id, args.world_id, args.plan_hash, deletable.len() as i64,
                current["freedBytes"].as_i64().unwrap_or(0), serde_json::to_string(&deletable)?, now],
        )?;
        for build in &deletable {
            tx.execute(
                "DELETE FROM craftmine_godot_build_files WHERE world_id=?1 AND build_id=?2",
                params![args.world_id, build],
            )?;
            tx.execute(
                "DELETE FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",
                params![args.world_id, build],
            )?;
        }
        tx.commit()?;
        let pending = remove_build_dirs(&self.directory, &args.world_id, &deletable)?;
        self.db.execute(
            "UPDATE craftmine_godot_reclaims SET status=?2,updated_at=?3 WHERE id=?1",
            params![
                id,
                if pending == 0 { "completed" } else { "pendingCleanup" },
                worlds::timestamp()?
            ],
        )?;
        Ok(json!({"planId":args.plan_id,"planHash":args.plan_hash,
            "status":if pending == 0 { "completed" } else { "pendingCleanup" },
            "reclaimId":id,"removedBuilds":deletable.len(),
            "freedBytes":current["freedBytes"],"pendingDirectories":pending}))
    }

    /// Startup sweep: finish directory removal for a reclaim that committed its
    /// rows before the process died. Rows are already gone, so this only removes
    /// now-unreferenced directories and is safe to repeat.
    pub fn godot_storage_recover(&mut self) -> Result<usize> {
        let pending: Vec<(String, String, String)> = self
            .db
            .prepare(
                "SELECT id,world_id,detail FROM craftmine_godot_reclaims WHERE status='pendingCleanup'",
            )?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut completed = 0;
        for (id, world, detail) in pending {
            let builds: Vec<String> = serde_json::from_str(&detail).unwrap_or_default();
            if remove_build_dirs(&self.directory, &world, &builds)? == 0 {
                self.db.execute(
                    "UPDATE craftmine_godot_reclaims SET status='completed',updated_at=?2 WHERE id=?1",
                    params![id, worlds::timestamp()?],
                )?;
                completed += 1;
            }
        }
        Ok(completed)
    }
}

fn build_ids(db: &Connection, world: &str) -> Result<Vec<String>> {
    // Insertion order is the recency order; created_at has one-second
    // resolution and would make "keep the newest" ambiguous.
    Ok(db
        .prepare("SELECT build_id FROM craftmine_godot_builds WHERE world_id=?1 ORDER BY rowid")?
        .query_map([world], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Remove build directories that no longer have a row. Returns how many are left.
fn remove_build_dirs(directory: &Path, world: &str, builds: &[String]) -> Result<usize> {
    let mut pending = 0;
    for build in builds {
        if godot_builds::valid_build_id(build).is_err() {
            continue;
        }
        let root = build_dir(directory, world, build)?;
        if !root.try_exists()? {
            continue;
        }
        match std::fs::remove_dir_all(&root) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => pending += 1,
        }
    }
    Ok(pending)
}

/// Build the reclaim plan from durable rows only.
fn plan(
    db: &Connection,
    directory: &Path,
    world: &str,
    caller_protected: &[String],
    keep_recent: usize,
) -> Result<Value> {
    let all = build_ids(db, world)?;
    let mut protected: Vec<(String, &'static str)> = Vec::new();
    let formal = worlds::read(db, world)?;
    if let Some(id) = formal.world.build["id"].as_str() {
        if godot_builds::valid_build_id(id).is_ok() {
            protected.push((id.to_string(), "FORMAL_WORLD"));
        }
    }
    for (sql, reason) in [
        ("SELECT build_id FROM craftmine_godot_candidates WHERE world_id=?1", "CANDIDATE"),
        ("SELECT build_id FROM craftmine_godot_applications WHERE world_id=?1", "APPLICATION"),
        ("SELECT build_id FROM craftmine_godot_jobs WHERE world_id=?1 AND status NOT IN ('failed','cancelled','interrupted')", "ACTIVE_OR_PASSED_JOB"),
        // A copied world shares the source build id, so the build must survive
        // as long as either side references it.
        ("SELECT source_build_id FROM craftmine_godot_world_copies WHERE source_world_id=?1 OR target_world_id=?1", "WORLD_COPY"),
    ] {
        for id in db
            .prepare(sql)?
            .query_map([world], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
        {
            protected.push((id, reason));
        }
    }
    // Durable portable-archive pins are owned by the backup module. The core
    // aggregates them itself so a caller that omits (or forges) `protectedBuilds`
    // cannot unprotect a build that a retained archive still carries. A pin with
    // no world is protected everywhere, which is the conservative reading.
    let pinned: Vec<(String, Option<String>)> = db
        .prepare(
            "SELECT ref,world_id FROM craftmine_backup_pins
             WHERE kind='build' AND status IN ('streaming','retained')",
        )?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, pinned_world) in pinned {
        if godot_builds::valid_build_id(&id).is_err() {
            continue;
        }
        if pinned_world.as_deref().is_none_or(|value| value == world) {
            protected.push((id, "BACKUP_PINNED"));
        }
    }
    for id in caller_protected {
        protected.push((id.clone(), "CALLER_PINNED"));
    }
    for id in all.iter().rev().take(keep_recent) {
        protected.push((id.clone(), "RECENT"));
    }
    let protected_ids: std::collections::BTreeSet<&str> =
        protected.iter().map(|(id, _)| id.as_str()).collect();
    let mut deletable = Vec::new();
    let mut freed = 0u64;
    for id in &all {
        if protected_ids.contains(id.as_str()) {
            continue;
        }
        let (files, bytes) = measure(&build_dir(directory, world, id)?)?;
        freed = freed.checked_add(bytes).context("GODOT_STORAGE_UNMEASURABLE")?;
        deletable.push(json!({"buildId":id,"files":files,"bytes":bytes}));
    }
    let mut orphans = Vec::new();
    let parent = builds_parent(directory, world);
    if parent.try_exists()? {
        for entry in std::fs::read_dir(&parent).context("GODOT_STORAGE_UNAVAILABLE")? {
            let entry = entry.context("GODOT_STORAGE_UNAVAILABLE")?;
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = ordinary(&entry.path(), "GODOT_STORAGE_UNAVAILABLE")?;
            if meta.is_dir() && !all.iter().any(|id| id == &name) {
                let (files, bytes) = measure(&entry.path())?;
                orphans.push(json!({"buildId":name,"files":files,"bytes":bytes}));
            }
        }
    }
    let plan_hash = digest(&serde_json::to_string(&json!({
        "format":"craftmine.godot-reclaim-plan/1","worldId":world,
        "deletable":deletable.iter().filter_map(|item| item["buildId"].as_str()).collect::<Vec<_>>()
    }))?);
    let plan_id = format!("gpln-{}", digest(&format!("{world}|{plan_hash}")));
    let protected: Vec<Value> = protected
        .into_iter()
        .map(|(build_id, reason)| json!({"buildId":build_id,"reason":reason}))
        .collect();
    Ok(json!({"format":"craftmine.godot-reclaim-plan/1","worldId":world,"planId":plan_id,
        "planHash":plan_hash,"deletable":deletable,"protected":protected,"freedBytes":freed,
        "unreferencedDirectories":orphans,
        "limits":{"keepRecentBuilds":keep_recent,"ownedByOthers":["assetBodies","gitHistory","backups"]}}))
}
