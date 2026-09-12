//! Rust owns desktop worlds and progress. The trusted compatibility compiler
//! supplies builds; no agent tool may call the unverified creation entry point.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use super::{digest, TaskJournal};

// Asset packages may contain 32 MiB of binary data encoded as base64.
// Task drafts keep their separate, smaller limit.
pub const MAX_WORLD_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldDocument {
    pub build: Value,
    pub snapshot: Value,
    pub extensions: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSummary {
    pub id: String,
    pub title: String,
    pub revision: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_kind: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldRecord {
    #[serde(flatten)]
    pub summary: WorldSummary,
    pub world: WorldDocument,
    pub content_hash: String,
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_worlds (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision >= 0),
        updated_at INTEGER NOT NULL, document TEXT NOT NULL, content_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS craftmine_world_archives (
        world_id TEXT PRIMARY KEY REFERENCES craftmine_worlds(id),
        archived_at INTEGER NOT NULL
    );",
    )?;
    Ok(())
}

pub(super) fn validate_id(id: &str) -> Result<()> {
    ensure!(
        !id.is_empty()
            && id.len() <= 80
            && id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'),
        "INVALID_WORLD_ID"
    );
    Ok(())
}

pub(super) fn assert_not_archived(db: &Connection, id: &str) -> Result<()> {
    let archived: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_world_archives WHERE world_id=?1)", [id], |row| row.get(0))?;
    ensure!(!archived, "WORLD_ARCHIVED");
    Ok(())
}

pub(super) fn timestamp() -> Result<i64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?)
}

pub(super) fn validate_progress(snapshot: &Value) -> Result<()> {
    if snapshot["format"] == super::godot_runtime::PROGRESS_FORMAT {
        return super::godot_runtime::validate_progress(snapshot);
    }
    ensure!(
        matches!(
            snapshot["format"].as_str(),
            Some("craftmine.progress/1" | "craftmine.progress/2" | "craftmine.progress/3")
        ),
        "INVALID_PROGRESS"
    );
    for (name, min, max) in [
        ("x", -47.4, 47.4),
        ("z", -47.4, 47.4),
        ("y", 6.0, 38.0),
        ("yaw", -1e6, 1e6),
        ("pitch", -1.52, 1.52),
    ] {
        let value = snapshot["player"][name]
            .as_f64()
            .context("INVALID_PLAYER")?;
        ensure!(
            value.is_finite() && value >= min && value <= max,
            "INVALID_PLAYER"
        );
    }
    Ok(())
}

pub(super) fn encode(world: &WorldDocument) -> Result<String> {
    ensure!(
        world.build["id"]
            .as_str()
            .is_some_and(|id| !id.is_empty() && id.len() <= 240),
        "BUILD_ID_REQUIRED"
    );
    ensure!(world.build["scene"].is_object(), "SCENE_REQUIRED");
    validate_progress(&world.snapshot)?;
    super::godot_runtime::validate_binding(world, None)?;
    let body = serde_json::to_string(world)?;
    ensure!(body.len() <= MAX_WORLD_BYTES, "WORLD_DOCUMENT_TOO_LARGE");
    Ok(body)
}

/// Navigation metadata comes only from the persisted build format. Unknown
/// formats remain unknown; this is not a runtime permission or readiness grant.
fn build_metadata(world: &WorldDocument) -> (Option<String>, Option<String>) {
    match world.build["scene"]["format"].as_str() {
        Some("craftmine.godot-scene/1") if world.build["godot"].is_object() => {
            let base = world.build["scene"]["baseId"].as_str()
                .filter(|id| !id.is_empty() && id.len() <= 80).map(str::to_owned);
            (base, Some("godot".into()))
        }
        Some("craftmine.scene/1" | "craftmine.scene/2" | "craftmine.scene/3") => (None, Some("legacy".into())),
        _ => (None, None),
    }
}

pub(super) fn read(db: &Connection, id: &str) -> Result<WorldRecord> {
    validate_id(id)?;
    let (title, revision, updated, body, hash): (String, i64, i64, String, String) = db.query_row(
        "SELECT title,revision,updated_at,document,content_hash FROM craftmine_worlds WHERE id=?1", [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).context("WORLD_NOT_FOUND")?;
    ensure!(digest(&body) == hash, "CORRUPT_WORLD");
    let world: WorldDocument = serde_json::from_str(&body)?;
    super::godot_runtime::validate_binding(&world, Some(id))?;
    let (base_id, runtime_kind) = build_metadata(&world);
    Ok(WorldRecord {
        summary: WorldSummary {
            id: id.into(),
            title,
            revision: revision.try_into()?,
            updated_at: updated.try_into()?,
            base_id,
            runtime_kind,
        },
        world,
        content_hash: hash,
    })
}

impl TaskJournal {
    pub fn world_create(
        &mut self,
        id: &str,
        title: &str,
        world: &WorldDocument,
    ) -> Result<WorldRecord> {
        insert(&self.db, id, title, world)?;
        read(&self.db, id)
    }

    pub fn world_list(&self) -> Result<Vec<WorldSummary>> {
        list(&self.db, false)
    }

    pub fn world_archived_list(&self) -> Result<Vec<WorldSummary>> {
        list(&self.db, true)
    }

    pub fn world_archive_status(&self, id: &str) -> Result<Value> {
        read(&self.db, id)?;
        let archived: bool = self.db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_world_archives WHERE world_id=?1)", [id], |row| row.get(0))?;
        Ok(serde_json::json!({"worldId":id,"archived":archived}))
    }

    /// Reversible player removal. No world, source, session, job or Git history
    /// is deleted. Admission and CAS run against durable facts, not UI labels.
    pub fn world_archive_failed(&mut self, args: &Value) -> Result<Value> {
        #[derive(Deserialize)]
        #[serde(rename_all="camelCase", deny_unknown_fields)]
        struct Input { id: String, revision: u64, base_build: String }
        let input: Input = serde_json::from_value(args.clone())?;
        if self.world_archive_status(&input.id)?["archived"] == true {
            return self.world_archive_status(&input.id);
        }
        let initialization = self.godot_world_init_status(&serde_json::json!({"worldId":input.id}))?;
        ensure!(matches!(initialization["status"].as_str(),Some("failed"|"blocked")), "WORLD_REMOVAL_REQUIRES_FAILED_INITIALIZATION");
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let world = read(&tx, &input.id)?;
        ensure!(world.summary.revision == input.revision, "WORLD_REVISION_CONFLICT");
        ensure!(world.world.build["id"] == input.base_build, "WORLD_BUILD_CONFLICT");
        super::applications::assert_idle(&tx, &input.id)?;
        super::godot_applications::assert_idle(&tx, &input.id)?;
        let busy: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_world_leases WHERE world_id=?1)
            OR EXISTS(SELECT 1 FROM craftmine_godot_jobs WHERE world_id=?1 AND status IN ('queued','claimed','running'))", [&input.id], |row| row.get(0))?;
        ensure!(!busy, "WORLD_REMOVAL_BUSY");
        // Re-check the stored init row within the same write transaction.
        let failed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_godot_world_init WHERE world_id=?1 AND status IN ('failed','blocked'))", [&input.id], |row| row.get(0))?;
        ensure!(failed, "WORLD_REMOVAL_REQUIRES_FAILED_INITIALIZATION");
        tx.execute("INSERT INTO craftmine_world_archives(world_id,archived_at) VALUES(?1,?2)",params![input.id,timestamp()?])?;
        tx.commit()?;
        self.world_archive_status(&input.id)
    }

    pub fn world_restore_archived(&mut self, id: &str) -> Result<Value> {
        read(&self.db, id)?;
        self.db.execute("DELETE FROM craftmine_world_archives WHERE world_id=?1", [id])?;
        self.world_archive_status(id)
    }
}

pub(super) fn insert(db: &Connection, id: &str, title: &str, world: &WorldDocument) -> Result<()> {
    validate_id(id)?;
    super::godot_runtime::validate_binding(world, Some(id))?;
    ensure!(
        !title.trim().is_empty()
            && title.chars().count() <= 80
            && !title.chars().any(char::is_control),
        "INVALID_WORLD_TITLE"
    );
    let body = encode(world)?;
    db.execute("INSERT INTO craftmine_worlds(id,title,revision,updated_at,document,content_hash) VALUES(?1,?2,0,?3,?4,?5)", params![id,title,timestamp()?,body,digest(&body)])?;
    Ok(())
}

fn list(db: &Connection, archived: bool) -> Result<Vec<WorldSummary>> {
    let mut statement = db.prepare(
        "SELECT id,title,revision,updated_at,document,content_hash FROM craftmine_worlds
         WHERE EXISTS(SELECT 1 FROM craftmine_world_archives WHERE world_id=craftmine_worlds.id)=?1 ORDER BY updated_at DESC,id",
    )?;
    let rows = statement.query_map([archived], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;
    rows.map(|row| {
        let (id, title, revision, updated, body, hash) = row?;
        ensure!(digest(&body) == hash, "CORRUPT_WORLD");
        let world: WorldDocument = serde_json::from_str(&body)?;
        let (base_id, runtime_kind) = build_metadata(&world);
        Ok(WorldSummary {
            id,
            title,
            revision: revision.try_into()?,
            updated_at: updated.try_into()?,
            base_id,
            runtime_kind,
        })
    })
    .collect()
}

impl TaskJournal {
    pub fn world_read(&self, id: &str) -> Result<WorldRecord> {
        read(&self.db, id)
    }

    /// Saving play progress cannot replace the build or extension catalogue.
    /// Revision and build checks prevent a stale view from overwriting a newer world.
    pub fn world_save_progress(
        &mut self,
        id: &str,
        expected_revision: u64,
        base_build: &str,
        snapshot: &Value,
    ) -> Result<WorldRecord> {
        validate_progress(snapshot)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut current = read(&tx, id)?;
        assert_not_archived(&tx, id)?;
        super::applications::assert_idle(&tx, id)?;
        if current.world.snapshot["format"] == super::godot_runtime::PROGRESS_FORMAT {
            super::godot_applications::assert_idle(&tx, id)?;
        }
        ensure!(
            current.summary.revision == expected_revision,
            "WORLD_REVISION_CONFLICT"
        );
        ensure!(
            current.world.build["id"].as_str() == Some(base_build),
            "WORLD_BUILD_CONFLICT"
        );
        if current.world.snapshot == *snapshot {
            return Ok(current);
        }
        if current.world.snapshot["format"] == super::godot_runtime::PROGRESS_FORMAT {
            ensure!(snapshot["format"] == super::godot_runtime::PROGRESS_FORMAT,
                "GODOT_PROGRESS_MIGRATION_REQUIRED");
            ensure!(snapshot["baseVersion"] == current.world.snapshot["baseVersion"]
                && snapshot["stateVersion"] == current.world.snapshot["stateVersion"],
                "GODOT_PROGRESS_VERSION_MISMATCH");
            // Godot progress may only be written for a build the host actually
            // applied after a verified check and a confirmed first launch. A
            // world document that merely claims a build id is not enough, and
            // there is no test-only exception for the initialising world: that
            // path is confirmed by its own real application before it is playable.
            let applied: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM craftmine_godot_applications
                    WHERE world_id=?1 AND build_id=?2 AND status='applied')",
                params![id, base_build],
                |row| row.get(0),
            )?;
            ensure!(applied, "GODOT_BUILD_NOT_APPLIED");
        }
        current.world.snapshot = snapshot.clone();
        super::godot_runtime::validate_binding(&current.world, Some(id))?;
        let body = encode(&current.world)?;
        let revision: i64 = current
            .summary
            .revision
            .checked_add(1)
            .context("REVISION_OVERFLOW")?
            .try_into()?;
        tx.execute("UPDATE craftmine_worlds SET revision=?1,updated_at=?2,document=?3,content_hash=?4 WHERE id=?5",params![revision,timestamp()?,body,digest(&body),id])?;
        let result = read(&tx, id)?;
        tx.commit()?;
        Ok(result)
    }
}

#[cfg(test)]
#[path = "world_archive_tests.rs"]
mod archive_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn world() -> WorldDocument {
        WorldDocument {
            build: json!({"id":"build-a","scene":{"format":"craftmine.scene/3","objects":[]}}),
            snapshot: json!({"format":"craftmine.progress/1","player":{"x":0.5,"y":6,"z":12.5,"yaw":0,"pitch":0}}),
            extensions: vec![],
        }
    }
    #[test]
    fn progress_and_independent_worlds_survive_process_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("domain.sqlite");
        let mut db = TaskJournal::open(&path).unwrap();
        db.world_create("first", "First", &world()).unwrap();
        db.world_create("second", "Second", &world()).unwrap();
        let mut progress = world().snapshot;
        progress["player"]["x"] = json!(8);
        db.world_save_progress("first", 0, "build-a", &progress)
            .unwrap();
        drop(db);
        let db = TaskJournal::open(&path).unwrap();
        assert_eq!(db.world_read("first").unwrap().world.snapshot, progress);
        assert_eq!(
            db.world_read("second").unwrap().world.snapshot,
            world().snapshot
        );
        assert_eq!(db.world_list().unwrap().len(), 2);
    }
    #[test]
    fn competing_views_cannot_overwrite_newer_progress_or_builds() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("domain.sqlite");
        let mut first = TaskJournal::open(&path).unwrap();
        let mut other = TaskJournal::open(&path).unwrap();
        first.world_create("world", "World", &world()).unwrap();
        let mut progress = world().snapshot;
        progress["player"]["x"] = json!(8);
        first
            .world_save_progress("world", 0, "build-a", &progress)
            .unwrap();
        assert!(other
            .world_save_progress("world", 0, "build-a", &world().snapshot)
            .unwrap_err()
            .to_string()
            .contains("REVISION_CONFLICT"));
        assert!(other
            .world_save_progress("world", 1, "wrong-build", &world().snapshot)
            .unwrap_err()
            .to_string()
            .contains("BUILD_CONFLICT"));
        assert_eq!(other.world_read("world").unwrap().world.snapshot, progress);
    }
    #[test]
    fn corruption_and_invalid_progress_are_reported_without_resetting_worlds() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = TaskJournal::open(&dir.path().join("domain.sqlite")).unwrap();
        db.world_create("world", "World", &world()).unwrap();
        let mut bad = world().snapshot;
        bad["player"]["y"] = json!(-100);
        assert!(db.world_save_progress("world", 0, "build-a", &bad).is_err());
        assert_eq!(db.world_read("world").unwrap().summary.revision, 0);
        db.db
            .execute(
                "UPDATE craftmine_worlds SET document='{}' WHERE id='world'",
                [],
            )
            .unwrap();
        assert!(db
            .world_read("world")
            .unwrap_err()
            .to_string()
            .contains("CORRUPT_WORLD"));
    }
}

#[cfg(test)]
mod metadata_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn persisted_build_metadata_is_consistent_and_unknown_formats_stay_unknown() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut journal = TaskJournal::open(&dir.path().join("worlds.sqlite"))?;
        let mut world = WorldDocument { build:json!({"id":"legacy","scene":{"format":"craftmine.scene/3"}}),
            snapshot:json!({"format":"craftmine.progress/1","player":{"x":0,"y":6,"z":0,"yaw":0,"pitch":0}}), extensions:vec![] };
        journal.world_create("legacy", "Legacy", &world)?;
        world.build = json!({"id":"godot","scene":{"format":"craftmine.godot-scene/1","baseId":"top-down"},"godot":{"engineVersion":"4.7.2-stable"}});
        journal.world_create("godot", "Godot", &world)?;
        world.build = json!({"id":"future","scene":{"format":"unknown/1","baseId":"voxel"},"godot":{}});
        journal.world_create("future", "Future", &world)?;
        for summary in journal.world_list()? { assert_eq!(summary, journal.world_read(&summary.id)?.summary); }
        assert_eq!(journal.world_read("godot")?.summary.base_id.as_deref(), Some("top-down"));
        assert_eq!(journal.world_read("godot")?.summary.runtime_kind.as_deref(), Some("godot"));
        assert_eq!(journal.world_read("legacy")?.summary.runtime_kind.as_deref(), Some("legacy"));
        let unknown = serde_json::to_value(journal.world_read("future")?.summary)?;
        assert!(unknown.get("runtimeKind").is_none());
        assert!(unknown.get("baseId").is_none());
        Ok(())
    }
}
