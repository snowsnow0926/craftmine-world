//! Desktop drafts are bound to host sessions, independent of the selected panel.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    assert_binding, digest, document, read_task, worlds, DraftReceipt, TaskBinding, TaskJournal,
    TaskSnapshot,
};

#[cfg(test)]
#[path = "workspaces_tests.rs"]
mod tests;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceContext {
    pub project_id: String,
    pub session_id: String,
    pub turn_id: String,
}

impl WorkspaceContext {
    pub(super) fn validate(&self) -> Result<()> {
        TaskBinding {
            project_id: self.project_id.clone(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
            task_id: "validation".into(),
            base_build: "validation".into(),
        }
        .validate()?;
        ensure!(!self.session_id.starts_with('@'), "HOST_SESSION_REQUIRED");
        Ok(())
    }

    fn task_id(&self) -> String {
        format!(
            "work-{}",
            digest(&serde_json::to_string(&json!([self.session_id, self.turn_id])).unwrap())
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub world_id: String,
    pub task: TaskSnapshot,
    pub resumed_from: Option<String>,
    pub reads: Value,
}

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_session_worlds (
        session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        world_id TEXT NOT NULL REFERENCES craftmine_worlds(id), head_task TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS craftmine_workspaces (
        task_id TEXT PRIMARY KEY REFERENCES craftmine_tasks(id),
        world_id TEXT NOT NULL REFERENCES craftmine_worlds(id), resumed_from TEXT
    );
    CREATE TABLE IF NOT EXISTS craftmine_world_leases (
        world_id TEXT PRIMARY KEY REFERENCES craftmine_worlds(id),
        task_id TEXT NOT NULL UNIQUE REFERENCES craftmine_workspaces(task_id)
    );
    CREATE TABLE IF NOT EXISTS craftmine_workspace_reads (
        task_id TEXT NOT NULL REFERENCES craftmine_workspaces(task_id),
        resource_key TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(task_id,resource_key)
    );
    CREATE TABLE IF NOT EXISTS craftmine_workspace_revisions (
        task_id TEXT NOT NULL REFERENCES craftmine_workspaces(task_id), revision INTEGER NOT NULL,
        draft TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(task_id,revision)
    );
    CREATE TABLE IF NOT EXISTS craftmine_ended_turns (
        session_id TEXT NOT NULL, turn_id TEXT NOT NULL, status TEXT NOT NULL,
        PRIMARY KEY(session_id,turn_id)
    );",
    )?;
    Ok(())
}

pub(super) fn inspect(db: &Connection, ctx: &WorkspaceContext) -> Result<WorkspaceSnapshot> {
    ctx.validate()?;
    let (project, world, head): (String, String, String) = db.query_row(
        "SELECT project_id,world_id,head_task FROM craftmine_session_worlds WHERE session_id=?1",
        [&ctx.session_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    ).context("WORKSPACE_NOT_OPEN")?;
    ensure!(project == ctx.project_id, "PROJECT_BINDING_MISMATCH");
    ensure!(head == ctx.task_id(), "STALE_TURN");
    let task = read_task(db, &head)?;
    ensure!(
        task.binding.turn_id == ctx.turn_id
            && task.binding.session_id == ctx.session_id
            && task.binding.project_id == ctx.project_id,
        "TASK_BINDING_MISMATCH"
    );
    let resumed_from: Option<String> = db
        .query_row(
            "SELECT resumed_from FROM craftmine_workspaces WHERE task_id=?1 AND world_id=?2",
            params![head, world],
            |r| r.get(0),
        )
        .context("WORKSPACE_BINDING_MISMATCH")?;
    let mut statement =
        db.prepare("SELECT resource_key,hash FROM craftmine_workspace_reads WHERE task_id=?1")?;
    let rows = statement.query_map([&head], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut reads = serde_json::Map::new();
    for row in rows {
        let (key, hash) = row?;
        reads.insert(key, Value::String(hash));
    }
    Ok(WorkspaceSnapshot {
        world_id: world,
        task,
        resumed_from,
        reads: Value::Object(reads),
    })
}

pub(super) fn assert_live(db: &Connection, snapshot: &WorkspaceSnapshot) -> Result<()> {
    ensure!(snapshot.task.status == "running", "TASK_INACTIVE");
    let binding = &snapshot.task.binding;
    let ended: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM craftmine_ended_turns WHERE session_id=?1 AND turn_id=?2)",
        params![binding.session_id, binding.turn_id],
        |r| r.get(0),
    )?;
    ensure!(!ended, "TURN_ENDED");
    let lease: Option<String> = db
        .query_row(
            "SELECT task_id FROM craftmine_world_leases WHERE world_id=?1",
            [&snapshot.world_id],
            |r| r.get(0),
        )
        .optional()?;
    ensure!(
        lease.as_deref() == Some(&binding.task_id),
        "WORLD_LEASE_LOST"
    );
    let world = worlds::read(db, &snapshot.world_id)?;
    ensure!(
        world.world.build["id"].as_str() == Some(&binding.base_build),
        "WORLD_BUILD_CONFLICT"
    );
    Ok(())
}

pub(super) fn call_id(id: &str) -> Result<()> {
    ensure!(
        !id.trim().is_empty() && id.len() <= 240 && !id.chars().any(char::is_control),
        "INVALID_CALL_ID"
    );
    Ok(())
}

fn receipt(
    db: &Connection,
    task: &str,
    call: &str,
    request: &Value,
) -> Result<Option<DraftReceipt>> {
    call_id(call)?;
    let hash = digest(&document(request)?);
    let prior: Option<(String,String)> = db.query_row(
        "SELECT request_hash,result FROM craftmine_receipts WHERE task_id=?1 AND tool_call_id=?2",
        params![task,call], |r| Ok((r.get(0)?,r.get(1)?)),
    ).optional()?;
    prior
        .map(|(stored, result)| {
            ensure!(stored == hash, "REPLAY_MISMATCH");
            Ok(serde_json::from_str(&result)?)
        })
        .transpose()
}

impl TaskJournal {
    /// The selected world is only a default for a previously unbound session.
    /// Later turns inherit a draft; old turn IDs can never reacquire its lease.
    pub fn workspace_open(
        &mut self,
        ctx: &WorkspaceContext,
        selected_world: &str,
    ) -> Result<WorkspaceSnapshot> {
        ctx.validate()?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let ended: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_ended_turns WHERE session_id=?1 AND turn_id=?2)",
            params![ctx.session_id, ctx.turn_id],
            |r| r.get(0),
        )?;
        ensure!(!ended, "TURN_ENDED");
        let prior: Option<(String,String,String)> = tx.query_row(
            "SELECT project_id,world_id,head_task FROM craftmine_session_worlds WHERE session_id=?1",
            [&ctx.session_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
        ).optional()?;
        let id = ctx.task_id();
        if let Some((project, _, head)) = &prior {
            ensure!(project == &ctx.project_id, "PROJECT_BINDING_MISMATCH");
            if head == &id {
                let snapshot = inspect(&tx, ctx)?;
                assert_live(&tx, &snapshot)?;
                return Ok(snapshot);
            }
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_tasks WHERE id=?1)",
            [&id],
            |r| r.get(0),
        )?;
        ensure!(!exists, "STALE_TURN");
        let world_id = prior
            .as_ref()
            .map(|p| p.1.as_str())
            .unwrap_or(selected_world);
        let world = worlds::read(&tx, world_id)?;
        let base = world.world.build["id"]
            .as_str()
            .context("BUILD_ID_REQUIRED")?;
        let prior_task = prior.as_ref().map(|p| read_task(&tx, &p.2)).transpose()?;
        let lease: Option<String> = tx
            .query_row(
                "SELECT task_id FROM craftmine_world_leases WHERE world_id=?1",
                [world_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(owner) = &lease {
            ensure!(
                prior_task
                    .as_ref()
                    .is_some_and(|task| &task.binding.task_id == owner),
                "WORLD_BUSY"
            );
        }
        let mut resumed_from = None;
        let draft = if let Some(previous) = &prior_task {
            // A finished turn is not an applied candidate. Preserve all edits
            // until publication advances the base or an explicit discard exists.
            if previous.binding.base_build == base {
                resumed_from = Some(previous.binding.task_id.clone());
                previous.draft.clone()
            } else {
                anyhow::bail!("DRAFT_BASE_CONFLICT");
            }
        } else {
            json!({"scene":world.world.build["scene"]})
        };
        let body = document(&draft)?;
        let binding = TaskBinding {
            project_id: ctx.project_id.clone(),
            session_id: ctx.session_id.clone(),
            turn_id: ctx.turn_id.clone(),
            task_id: id.clone(),
            base_build: base.into(),
        };
        if let Some(previous) = &prior_task {
            super::verification::cancel_task(&tx, &previous.binding.task_id)?;
            tx.execute(
                "UPDATE craftmine_tasks SET status='cancelled' WHERE id=?1 AND status='running'",
                [&previous.binding.task_id],
            )?;
            tx.execute(
                "DELETE FROM craftmine_world_leases WHERE task_id=?1",
                [&previous.binding.task_id],
            )?;
        }
        tx.execute("INSERT INTO craftmine_tasks(id,binding,status,revision,draft,draft_hash) VALUES(?1,?2,'running',0,?3,?4)",
            params![id,serde_json::to_string(&binding)?,body,digest(&body)])?;
        tx.execute(
            "INSERT INTO craftmine_workspaces(task_id,world_id,resumed_from) VALUES(?1,?2,?3)",
            params![id, world_id, resumed_from],
        )?;
        tx.execute("INSERT INTO craftmine_workspace_revisions(task_id,revision,draft,hash) VALUES(?1,0,?2,?3)", params![id,body,digest(&body)])?;
        tx.execute("INSERT INTO craftmine_session_worlds(session_id,project_id,world_id,head_task) VALUES(?1,?2,?3,?4)
            ON CONFLICT(session_id) DO UPDATE SET head_task=excluded.head_task", params![ctx.session_id,ctx.project_id,world_id,id])?;
        tx.execute(
            "INSERT INTO craftmine_world_leases(world_id,task_id) VALUES(?1,?2)",
            params![world_id, id],
        )?;
        tx.commit()?;
        self.workspace_inspect(ctx)
    }

    pub fn workspace_inspect(&self, ctx: &WorkspaceContext) -> Result<WorkspaceSnapshot> {
        inspect(&self.db, ctx)
    }

    pub fn workspace_record_read(
        &mut self,
        ctx: &WorkspaceContext,
        revision: u64,
        key: &str,
        hash: &str,
    ) -> Result<()> {
        ensure!(
            key.len() <= 100 && key.contains(':') && !key.chars().any(char::is_control),
            "INVALID_RESOURCE_KEY"
        );
        ensure!(
            hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit()),
            "INVALID_RESOURCE_HASH"
        );
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let snapshot = inspect(&tx, ctx)?;
        assert_live(&tx, &snapshot)?;
        ensure!(snapshot.task.revision == revision, "STALE_DRAFT");
        tx.execute(
            "INSERT INTO craftmine_workspace_reads(task_id,resource_key,hash) VALUES(?1,?2,?3)
            ON CONFLICT(task_id,resource_key) DO UPDATE SET hash=excluded.hash",
            params![snapshot.task.binding.task_id, key, hash],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn workspace_receipt(
        &self,
        ctx: &WorkspaceContext,
        call: &str,
        request: &Value,
    ) -> Result<Option<DraftReceipt>> {
        let snapshot = inspect(&self.db, ctx)?;
        assert_live(&self.db, &snapshot)?;
        receipt(&self.db, &snapshot.task.binding.task_id, call, request)
    }

    /// JS supplies compiler-checked pure transformations; Rust owns publication.
    pub fn workspace_commit(
        &mut self,
        ctx: &WorkspaceContext,
        binding: &TaskBinding,
        call: &str,
        revision: u64,
        request: &Value,
        next_draft: &Value,
    ) -> Result<DraftReceipt> {
        let body = document(next_draft)?;
        ensure!(next_draft["scene"].is_object(), "SCENE_REQUIRED");
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let snapshot = inspect(&tx, ctx)?;
        assert_binding(&snapshot.task, binding)?;
        assert_live(&tx, &snapshot)?;
        if let Some(prior) = receipt(&tx, &binding.task_id, call, request)? {
            return Ok(prior);
        }
        ensure!(snapshot.task.revision == revision, "STALE_DRAFT");
        let hash = digest(&body);
        ensure!(hash != snapshot.task.draft_hash, "NO_CHANGE");
        super::verification::cancel_task(&tx, &binding.task_id)?;
        let next = revision.checked_add(1).context("REVISION_LIMIT")?;
        let stored = i64::try_from(next).context("REVISION_LIMIT")?;
        let result = DraftReceipt {
            task_id: binding.task_id.clone(),
            tool_call_id: call.into(),
            revision: next,
            draft_hash: hash.clone(),
        };
        tx.execute(
            "UPDATE craftmine_tasks SET revision=?2,draft=?3,draft_hash=?4 WHERE id=?1",
            params![binding.task_id, stored, body, hash],
        )?;
        tx.execute("INSERT INTO craftmine_workspace_revisions(task_id,revision,draft,hash) VALUES(?1,?2,?3,?4)", params![binding.task_id,stored,body,hash])?;
        tx.execute("INSERT INTO craftmine_receipts(task_id,tool_call_id,request_hash,result) VALUES(?1,?2,?3,?4)",
            params![binding.task_id,call,digest(&document(request)?),serde_json::to_string(&result)?])?;
        tx.commit()?;
        Ok(result)
    }

    /// Called only by the host lifecycle, including before a workspace exists.
    pub fn workspace_end_turn(&mut self, session: &str, turn: &str, status: &str) -> Result<()> {
        WorkspaceContext {
            project_id: "validation".into(),
            session_id: session.into(),
            turn_id: turn.into(),
        }
        .validate()?;
        ensure!(
            matches!(status, "completed" | "aborted" | "error"),
            "INVALID_TURN_STATUS"
        );
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT OR IGNORE INTO craftmine_ended_turns(session_id,turn_id,status) VALUES(?1,?2,?3)",params![session,turn,status])?;
        let id = WorkspaceContext {
            project_id: String::new(),
            session_id: session.into(),
            turn_id: turn.into(),
        }
        .task_id();
        if status != "completed" {
            super::verification::cancel_task(&tx, &id)?;
        }
        tx.execute(
            "UPDATE craftmine_tasks SET status=?2 WHERE id=?1 AND status='running'",
            params![
                id,
                if status == "completed" {
                    "finished"
                } else {
                    "cancelled"
                }
            ],
        )?;
        tx.execute("DELETE FROM craftmine_world_leases WHERE task_id=?1", [&id])?;
        tx.commit()?;
        Ok(())
    }
}
