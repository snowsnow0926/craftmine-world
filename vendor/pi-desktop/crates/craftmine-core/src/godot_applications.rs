//! Player-initiated application of a verified Godot candidate.
//!
//! The transaction keeps the newest formal progress, stores the previous world
//! document, and only publishes after a real new-instance launch confirmed the
//! exact build identity. A failed or stale candidate can never replace the
//! formal world.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    digest,
    godot_builds::valid_build_id,
    godot_jobs::require_ready_candidate,
    workspaces, worlds, TaskJournal,
};

#[cfg(test)]
#[path = "godot_applications_tests.rs"]
mod tests;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareArgs {
    id: String,
    token: String,
    candidate_id: String,
    world_id: String,
    revision: u64,
    snapshot: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitArgs {
    id: String,
    token: String,
    evidence: Evidence,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Evidence {
    format: String,
    input_hash: String,
    launch: Launch,
    player: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    snapshot: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Launch {
    passed: bool,
    build_id: String,
    instance_id: String,
    state_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadArgs {
    id: String,
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_godot_applications (
            id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES craftmine_worlds(id),
            candidate_id TEXT NOT NULL, build_id TEXT NOT NULL, author_task_id TEXT NOT NULL,
            request_hash TEXT NOT NULL, input TEXT NOT NULL, input_hash TEXT NOT NULL,
            previous_world TEXT NOT NULL, previous_hash TEXT NOT NULL,
            status TEXT NOT NULL, token TEXT, output TEXT, output_hash TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS craftmine_godot_applications_world
            ON craftmine_godot_applications(world_id,created_at);
        CREATE TABLE IF NOT EXISTS craftmine_godot_applied_drafts (
            task_id TEXT PRIMARY KEY REFERENCES craftmine_workspaces(task_id),
            draft_hash TEXT NOT NULL, application_id TEXT NOT NULL REFERENCES craftmine_godot_applications(id)
        );",
    )?;
    Ok(())
}

fn expire(db: &Connection) -> Result<()> {
    db.execute(
        "UPDATE craftmine_godot_applications SET status='interrupted',token=NULL,updated_at=?1
         WHERE status='prepared' AND updated_at < ?2",
        params![worlds::timestamp()?, worlds::timestamp()? - 600_000],
    )?;
    Ok(())
}

pub(super) fn assert_idle(db: &Connection, world: &str) -> Result<()> {
    expire(db)?;
    let active: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM craftmine_godot_applications WHERE world_id=?1 AND status='prepared')",
        [world],
        |row| row.get(0),
    )?;
    ensure!(!active, "WORLD_APPLICATION_BUSY");
    Ok(())
}

pub(super) fn read(db: &Connection, id: &str) -> Result<Value> {
    expire(db)?;
    let (world_id, candidate_id, build_id, author_task, input, input_hash, status, output,
        output_hash, created, updated): (String, String, String, String, String, String, String,
        Option<String>, Option<String>, i64, i64) = db
        .query_row(
            "SELECT world_id,candidate_id,build_id,author_task_id,input,input_hash,status,output,
                output_hash,created_at,updated_at FROM craftmine_godot_applications WHERE id=?1",
            [id],
            |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?,
                    row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?))
            },
        )
        .context("GODOT_APPLICATION_NOT_FOUND")?;
    ensure!(
        digest(&input) == input_hash,
        "CORRUPT_APPLICATION_INPUT"
    );
    let output: Option<Value> = output
        .map(|body| {
            ensure!(
                Some(digest(&body)) == output_hash,
                "CORRUPT_APPLICATION_OUTPUT"
            );
            Ok(serde_json::from_str(&body)?)
        })
        .transpose()?;
    Ok(json!({"id":id,"worldId":world_id,"candidateId":candidate_id,"buildId":build_id,
        "authorTaskId":author_task,"input":serde_json::from_str::<Value>(&input)?,
        "inputHash":input_hash,"status":status,"output":output,"outputHash":output_hash,
        "createdAt":created,"updatedAt":updated}))
}

/// Progress from the formal world, never from a preview or panel copy.
fn assert_player_unchanged(before: &worlds::WorldRecord, snapshot: &Value) -> Result<()> {
    ensure!(
        snapshot["player"] == before.world.snapshot["player"],
        "APPLICATION_PLAYER_CHANGED"
    );
    ensure!(snapshot == &before.world.snapshot, "APPLICATION_PROGRESS_CHANGED");
    Ok(())
}

impl TaskJournal {
    /// Prepare an application against the current formal world. Nothing is
    /// published here: the candidate must first prove itself in a new instance.
    pub fn godot_application_prepare(&mut self, args: &Value) -> Result<Value> {
        let args: PrepareArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.id)?;
        workspaces::call_id(&args.token)?;
        worlds::validate_id(&args.world_id)?;
        let request = json!({"candidateId":args.candidate_id,"worldId":args.world_id,
            "revision":args.revision,"snapshot":args.snapshot});
        let request_hash = digest(&serde_json::to_string(&request)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior: Option<String> = tx
            .query_row(
                "SELECT request_hash FROM craftmine_godot_applications WHERE id=?1",
                [&args.id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(hash) = prior {
            ensure!(hash == request_hash, "REPLAY_MISMATCH");
            return read(&tx, &args.id);
        }
        assert_idle(&tx, &args.world_id)?;
        let candidate = require_ready_candidate(&tx, &args.candidate_id, &args.world_id)?;
        let before = worlds::read(&tx, &args.world_id)?;
        ensure!(
            before.summary.revision == args.revision,
            "WORLD_REVISION_CONFLICT"
        );
        assert_player_unchanged(&before, &args.snapshot)?;
        worlds::validate_progress(&args.snapshot)?;
        let build_id = candidate["buildId"].as_str().context("INVALID_GODOT_BUILD")?;
        let prepared = worlds::WorldDocument {
            build: godot_build_document(&tx, &candidate)?,
            snapshot: before.world.snapshot.clone(),
            extensions: before.world.extensions.clone(),
        };
        // Encoding proves the resulting world document is valid before anything
        // is recorded, so a bad snapshot cannot leave a half-prepared record.
        worlds::encode(&prepared)?;
        let author_task = tx.query_row(
            "SELECT task_id FROM craftmine_godot_jobs WHERE id=?1",
            [candidate["checkJobId"].as_str().context("INVALID_GODOT_JOB")?],
            |row| row.get::<_, String>(0),
        )?;
        let input = json!({"candidateId":args.candidate_id,"worldId":args.world_id,
            "revision":args.revision,"worldHash":before.content_hash,"baseBuild":before.world.build["id"],
            "buildId":build_id,"snapshot":args.snapshot,"authorTaskId":author_task,
            "checkJobId":candidate["checkJobId"],"checkOutputHash":candidate["checkOutputHash"],
            "sourceRevision":candidate["sourceRevision"],"manifestHash":candidate["manifestHash"]});
        let body = serde_json::to_string(&input)?;
        let previous = worlds::encode(&before.world)?;
        let now = worlds::timestamp()?;
        tx.execute(
            "INSERT INTO craftmine_godot_applications(id,world_id,candidate_id,build_id,author_task_id,
                request_hash,input,input_hash,previous_world,previous_hash,status,token,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'prepared',?11,?12,?12)",
            params![args.id, args.world_id, args.candidate_id, build_id, author_task, request_hash,
                body, digest(&body), previous, digest(&previous), args.token, now],
        )?;
        tx.commit()?;
        read(&self.db, &args.id)
    }

    /// Commit only after a real new instance confirmed this exact build. The
    /// previous world document and its progress stay recoverable.
    pub fn godot_application_commit(&mut self, args: &Value) -> Result<Value> {
        let args: CommitArgs = serde_json::from_value(args.clone())?;
        workspaces::call_id(&args.id)?;
        workspaces::call_id(&args.token)?;
        let mut evidence_value = json!({"format":args.evidence.format,
            "inputHash":args.evidence.input_hash,"launch":{"passed":args.evidence.launch.passed,
            "buildId":args.evidence.launch.build_id,"instanceId":args.evidence.launch.instance_id,
            "stateHash":args.evidence.launch.state_hash},"player":args.evidence.player});
        if let Some(snapshot) = &args.evidence.snapshot { evidence_value["snapshot"] = snapshot.clone(); }
        let evidence_body = serde_json::to_string(&evidence_value)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let receipt = read(&tx, &args.id)?;
        let owner: Option<String> = tx.query_row(
            "SELECT token FROM craftmine_godot_applications WHERE id=?1",
            [&args.id],
            |row| row.get(0),
        )?;
        ensure!(
            owner.as_deref() == Some(args.token.as_str()),
            "GODOT_APPLICATION_OWNER_MISMATCH"
        );
        if receipt["status"] == "applied" {
            ensure!(
                receipt["outputHash"] == digest(&evidence_body),
                "REPLAY_MISMATCH"
            );
            return Ok(receipt);
        }
        ensure!(
            receipt["status"] == "prepared",
            "GODOT_APPLICATION_INACTIVE"
        );
        let input = receipt["input"].clone();
        let world_id = input["worldId"].as_str().context("WORLD_ID_REQUIRED")?;
        let candidate = require_ready_candidate(
            &tx,
            input["candidateId"].as_str().context("INVALID_GODOT_CANDIDATE")?,
            world_id,
        )?;
        let before = worlds::read(&tx, world_id)?;
        ensure!(
            input["revision"] == before.summary.revision
                && input["worldHash"] == before.content_hash,
            "WORLD_REVISION_CONFLICT"
        );
        ensure!(
            matches!(args.evidence.format.as_str(), "craftmine.godot-application/1" | "craftmine.godot-application/2")
                && args.evidence.input_hash == receipt["inputHash"],
            "APPLICATION_EVIDENCE_MISMATCH"
        );
        ensure!(
            args.evidence.launch.passed
                && input["buildId"].as_str() == Some(args.evidence.launch.build_id.as_str())
                && valid_build_id(&args.evidence.launch.build_id).is_ok(),
            "GODOT_LAUNCH_REQUIRED"
        );
        ensure!(
            !args.evidence.launch.instance_id.trim().is_empty()
                && args.evidence.launch.instance_id.len() <= 240,
            "GODOT_LAUNCH_REQUIRED"
        );
        ensure!(
            args.evidence.launch.state_hash.len() == 64
                && args.evidence.launch.state_hash.bytes().all(|b| b.is_ascii_hexdigit()),
            "GODOT_LAUNCH_REQUIRED"
        );
        assert_player_unchanged(&before, &input["snapshot"])?;
        if input["snapshot"]["format"] == super::godot_runtime::PROGRESS_FORMAT {
            ensure!(args.evidence.format == "craftmine.godot-application/2"
                && args.evidence.snapshot.as_ref() == Some(&input["snapshot"]), "APPLICATION_PROGRESS_CHANGED");
        }
        ensure!(
            args.evidence.player == input["snapshot"]["player"],
            "APPLICATION_PLAYER_CHANGED"
        );
        let world = worlds::WorldDocument {
            build: godot_build_document(&tx, &candidate)?,
            snapshot: before.world.snapshot.clone(),
            extensions: before.world.extensions.clone(),
        };
        let body = worlds::encode(&world)?;
        let revision: i64 = before
            .summary
            .revision
            .checked_add(1)
            .context("REVISION_OVERFLOW")?
            .try_into()?;
        let now = worlds::timestamp()?;
        tx.execute(
            "UPDATE craftmine_worlds SET document=?2,content_hash=?3,revision=?4,updated_at=?5 WHERE id=?1",
            params![world_id, body, digest(&body), revision, now],
        )?;
        tx.execute(
            "UPDATE craftmine_godot_applications SET status='applied',output=?2,output_hash=?3,updated_at=?4 WHERE id=?1",
            params![args.id, evidence_body, digest(&evidence_body), now],
        )?;
        tx.execute(
            "UPDATE craftmine_godot_candidates SET status='applied',updated_at=?2 WHERE id=?1",
            params![
                receipt["candidateId"].as_str().context("INVALID_GODOT_CANDIDATE")?,
                now
            ],
        )?;
        // The authoring draft is superseded by the applied build; otherwise the
        // next turn would resume a scene draft against a different base build.
        let author = input["authorTaskId"].as_str().context("TASK_REQUIRED")?;
        let draft_hash: Option<String> = tx
            .query_row(
                "SELECT draft_hash FROM craftmine_tasks WHERE id=?1",
                [author],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(draft_hash) = draft_hash {
            tx.execute(
                "INSERT OR IGNORE INTO craftmine_godot_applied_drafts(task_id,draft_hash,application_id) VALUES(?1,?2,?3)",
                params![author, draft_hash, args.id],
            )?;
        }
        tx.execute(
            "UPDATE craftmine_tasks SET status='finished' WHERE id=?1 AND status='running'",
            [author],
        )?;
        tx.execute(
            "DELETE FROM craftmine_world_leases WHERE task_id=?1",
            [author],
        )?;
        tx.commit()?;
        read(&self.db, &args.id)
    }

    pub fn godot_application_read(&self, args: &Value) -> Result<Value> {
        let args: ReadArgs = serde_json::from_value(args.clone())?;
        read(&self.db, &args.id)
    }

    pub fn godot_application_abort(&mut self, args: &Value) -> Result<Value> {
        let args: ReadArgs = serde_json::from_value(args.clone())?;
        self.db.execute(
            "UPDATE craftmine_godot_applications SET status='aborted',token=NULL,updated_at=?2
             WHERE id=?1 AND status='prepared'",
            params![args.id, worlds::timestamp()?],
        )?;
        read(&self.db, &args.id)
    }

    /// Startup sweep. A prepared application whose process died never confirmed
    /// a new instance, so the formal world keeps its previous document.
    pub fn godot_application_recover(&mut self) -> Result<usize> {
        Ok(self.db.execute(
            "UPDATE craftmine_godot_applications SET status='interrupted',token=NULL,updated_at=?1
             WHERE status='prepared'",
            [worlds::timestamp()?],
        )?)
    }
}

/// Formal world build descriptor for an applied Godot candidate. The scene
/// format is explicit so the legacy runner does not mistake it for its own.
pub(super) fn godot_build_document(db: &Connection, candidate: &Value) -> Result<Value> {
    let build_id = candidate["buildId"].as_str().context("INVALID_GODOT_BUILD")?;
    valid_build_id(build_id)?;
    let world_id = candidate["worldId"].as_str().context("WORLD_ID_REQUIRED")?;
    let (engine, renderer, target): (String, String, String) = db
        .query_row(
            "SELECT engine_version,renderer,target FROM craftmine_godot_builds WHERE world_id=?1 AND build_id=?2",
            params![world_id, build_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .context("INVALID_GODOT_BUILD")?;
    Ok(json!({
        "id": build_id,
        "scene": {"format":"craftmine.godot-scene/1","baseId":candidate["baseId"],
            "projectHash":candidate["manifestHash"],"entry":"res://main.tscn"},
        "godot": {"engineVersion":engine,"renderer":renderer,"target":target,"baseBuild":candidate["baseBuild"],
            "sourceRevision":candidate["sourceRevision"],"manifestHash":candidate["manifestHash"],
            "assetManifestHash":candidate["assetManifestHash"]}
    }))
}
