//! Explicit recovery preserves drafts, while a fresh turn fences late writers.
use super::{
    digest,
    durable::{budget, fields, runtime, text},
    read_task, workspaces, worlds, TaskJournal, WorkspaceContext,
};
use anyhow::{ensure, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;

/// Call only after checking the current head and eligible recovery state.
/// The surrounding transaction owns the lifecycle event, leases and ledger.
pub(super) fn preserve_interrupted(db: &Connection, id: &str) -> Result<()> {
    runtime(db, id)?;
    db.execute("UPDATE craftmine_task_runtime SET recovery='interrupted' WHERE task_id=?1 AND recovery='none'", [id])?;
    db.execute(
        "UPDATE craftmine_tasks SET status='cancelled' WHERE id=?1 AND status='running'",
        [id],
    )?;
    super::verification::cancel_task(db, id)?;
    let now = worlds::timestamp()?;
    db.execute("UPDATE craftmine_reviews SET status='cancelled',token=NULL,updated_at=?2 WHERE status='running' AND verification_id IN (SELECT id FROM craftmine_verifications WHERE task_id=?1)", params![id,now])?;
    db.execute("UPDATE craftmine_applications SET status='aborted',token=NULL,updated_at=?2 WHERE status='prepared' AND verification_id IN (SELECT id FROM craftmine_verifications WHERE task_id=?1)", params![id,now])?;
    db.execute("DELETE FROM craftmine_world_leases WHERE task_id=?1", [id])?;
    Ok(())
}

impl TaskJournal {
    /// The host calls this before ending a resumed turn whose launch failed.
    /// The receipt is stored without advancing the draft or budget generation.
    pub fn task_interrupt(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["context", "reason"])?;
        let ctx: WorkspaceContext = serde_json::from_value(args["context"].clone())?;
        ctx.validate()?;
        let reason = text(args, "reason", 80)?;
        ensure!(
            reason.as_bytes()[0].is_ascii_uppercase()
                && reason
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'),
            "INVALID_INTERRUPT_REASON"
        );
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Inspect the current session head before reading a receipt: a replay
        // from an old generation must never interrupt the resumed successor.
        let workspace = workspaces::inspect(&tx, &ctx)?;
        let task = &workspace.task;
        let id = &task.binding.task_id;
        let call_id = "@host:interrupt";
        let request_hash = digest(&serde_json::to_string(
            &json!({"context":ctx,"reason":reason}),
        )?);
        let prior: Option<(String, String)> = tx.query_row(
            "SELECT request_hash,result FROM craftmine_receipts WHERE task_id=?1 AND tool_call_id=?2",
            params![id, call_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        if let Some((hash, receipt)) = prior {
            ensure!(hash == request_hash, "INTERRUPT_REPLAY_MISMATCH");
            return Ok(serde_json::from_str(&receipt)?);
        }
        let (generation, owner, recovery) = runtime(&tx, id)?;
        ensure!(
            task.status == "running" && recovery != "resumed",
            "TASK_INACTIVE"
        );
        let owns_lease: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_world_leases WHERE world_id=?1 AND task_id=?2)",
            params![workspace.world_id, id],
            |row| row.get(0),
        )?;
        ensure!(owns_lease, "WORLD_LEASE_LOST");
        tx.execute(
            "UPDATE craftmine_task_runtime SET recovery='interrupted' WHERE task_id=?1",
            [id],
        )?;
        tx.execute(
            "UPDATE craftmine_tasks SET status='cancelled' WHERE id=?1",
            [id],
        )?;
        super::verification::cancel_task(&tx, id)?;
        let now = worlds::timestamp()?;
        tx.execute(
            "UPDATE craftmine_reviews SET status='cancelled',token=NULL,updated_at=?2
             WHERE status='running' AND verification_id IN
               (SELECT id FROM craftmine_verifications WHERE task_id=?1)",
            params![id, now],
        )?;
        tx.execute(
            "UPDATE craftmine_applications SET status='aborted',token=NULL,updated_at=?2
             WHERE status='prepared' AND verification_id IN
               (SELECT id FROM craftmine_verifications WHERE task_id=?1)",
            params![id, now],
        )?;
        tx.execute("DELETE FROM craftmine_world_leases WHERE task_id=?1", [id])?;
        tx.execute(
            "UPDATE craftmine_budget_requests SET status='unknown',
             settlement=json_object('status','unknown','errorCode',?2)
             WHERE task_id=?1 AND status='reserved'",
            params![id, reason],
        )?;
        let result = json!({"kind":"task-interrupt","status":"interrupted","reason":reason,
            "taskId":id,"toolCallId":call_id,"revision":task.revision,"draftHash":task.draft_hash,
            "binding":task.binding,"generation":generation,"budget":budget(&tx,&owner)?,"modelReplay":false});
        tx.execute(
            "INSERT INTO craftmine_receipts(task_id,tool_call_id,request_hash,result) VALUES(?1,?2,?3,?4)",
            params![id, call_id, request_hash, serde_json::to_string(&result)?],
        )?;
        tx.commit()?;
        Ok(result)
    }
    /// Called once when the broker process starts, after job recovery.
    pub fn task_recover(&mut self) -> Result<Value> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Repair only current heads. Legacy errored turns released their lease
        // before recording recovery; their durable ended-turn row is the proof.
        let tasks = tx.prepare(
            "SELECT t.id FROM craftmine_tasks t
             JOIN craftmine_workspaces w ON w.task_id=t.id
             JOIN craftmine_session_worlds s ON s.head_task=t.id AND s.world_id=w.world_id
               AND s.session_id=json_extract(t.binding,'$.sessionId')
               AND s.project_id=json_extract(t.binding,'$.projectId')
             LEFT JOIN craftmine_task_runtime r ON r.task_id=t.id
             WHERE COALESCE(r.recovery,'none')='none' AND (
               (t.status='running' AND EXISTS(SELECT 1 FROM craftmine_world_leases l WHERE l.task_id=t.id AND l.world_id=w.world_id))
               OR (t.status='cancelled' AND EXISTS(SELECT 1 FROM craftmine_ended_turns e
                   WHERE e.session_id=s.session_id AND e.turn_id=json_extract(t.binding,'$.turnId') AND e.status IN ('error','aborted'))))
             ORDER BY t.id"
        )?.query_map([], |row|row.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        for task in &tasks {
            preserve_interrupted(&tx, task)?;
        }
        tx.execute("DELETE FROM craftmine_world_leases", [])?;
        tx.execute("UPDATE craftmine_budget_requests SET status='unknown',settlement=json_object('status','unknown','errorCode','HOST_INTERRUPTED') WHERE status='reserved'",[])?;
        tx.commit()?;
        Ok(json!({"interruptedTasks":tasks,"modelReplay":false}))
    }
    pub fn task_recoverable(&self, args: &Value) -> Result<Value> {
        fields(args, &["projectId", "worldId"])?;
        let project = text(args, "projectId", 240)?;
        let world = args.get("worldId").and_then(Value::as_str);
        let rows=self.db.prepare("SELECT r.task_id,r.generation,w.world_id FROM craftmine_task_runtime r JOIN craftmine_workspaces w ON w.task_id=r.task_id JOIN craftmine_tasks t ON t.id=r.task_id WHERE r.recovery='interrupted' ORDER BY r.rowid DESC LIMIT 64")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)? as u64,r.get::<_,String>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let mut items = Vec::new();
        for (id, generation, world_id) in rows {
            let task = read_task(&self.db, &id)?;
            if task.binding.project_id == project && world.is_none_or(|w| w == world_id) {
                items.push(json!({"taskId":id,"binding":task.binding,"generation":generation,"worldId":world_id,"draftRevision":task.revision,"draftHash":task.draft_hash,"status":"interrupted"}));
            }
        }
        Ok(json!({"items":items,"modelReplay":false}))
    }
    pub fn task_resume(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["taskId", "context", "generation", "renewRequestWindow"])?;
        let renew_request_window = match args.get("renewRequestWindow") {
            None => false,
            Some(Value::Bool(value)) => *value,
            _ => anyhow::bail!("INVALID_REQUEST_WINDOW_INTENT"),
        };
        let id = text(args, "taskId", 240)?;
        let ctx: WorkspaceContext = serde_json::from_value(args["context"].clone())?;
        ctx.validate()?;
        let old = read_task(&self.db, id)?;
        let (generation, owner, recovery) = runtime(&self.db, id)?;
        ensure!(
            args["generation"].as_u64() == Some(generation),
            "STALE_GENERATION"
        );
        if recovery == "resumed" {
            let snapshot = self.workspace_inspect(&ctx)?;
            let (new_generation, new_owner, _) = runtime(&self.db, &snapshot.task.binding.task_id)?;
            ensure!(
                new_generation == generation + 1 && new_owner == owner,
                "RECOVERY_REPLAY_MISMATCH"
            );
            return Ok(
                json!({"workspace":snapshot,"generation":new_generation,"budget":budget(&self.db,&owner)?,"modelReplay":false,"replayed":true}),
            );
        }
        ensure!(recovery == "interrupted", "TASK_NOT_RECOVERABLE");
        ensure!(
            ctx.project_id == old.binding.project_id && ctx.session_id == old.binding.session_id,
            "TASK_BINDING_MISMATCH"
        );
        ensure!(ctx.turn_id != old.binding.turn_id, "NEW_TURN_REQUIRED");
        let snapshot = self.workspace_open_recovery(&ctx, "", Some((id, generation, &owner, renew_request_window)))?;
        Ok(
            json!({"workspace":snapshot,"generation":generation+1,"budget":budget(&self.db,&owner)?,"modelReplay":false}),
        )
    }
    pub fn task_discard(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["taskId", "projectId", "generation"])?;
        let id = text(args, "taskId", 240)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task = read_task(&tx, id)?;
        ensure!(
            task.binding.project_id == text(args, "projectId", 240)?,
            "TASK_BINDING_MISMATCH"
        );
        let (generation, _, recovery) = runtime(&tx, id)?;
        ensure!(
            args["generation"].as_u64() == Some(generation),
            "STALE_GENERATION"
        );
        if recovery == "discarded" {
            return Ok(json!({"taskId":id,"discarded":true,"preservedDraft":true}));
        }
        ensure!(recovery == "interrupted", "TASK_NOT_RECOVERABLE");
        tx.execute(
            "UPDATE craftmine_task_runtime SET recovery='discarded' WHERE task_id=?1",
            [id],
        )?;
        tx.execute(
            "UPDATE craftmine_tasks SET status='cancelled' WHERE id=?1",
            [id],
        )?;
        tx.execute("DELETE FROM craftmine_world_leases WHERE task_id=?1", [id])?;
        tx.execute(
            "DELETE FROM craftmine_session_worlds WHERE head_task=?1",
            [id],
        )?;
        tx.execute("INSERT OR IGNORE INTO craftmine_ended_turns(session_id,turn_id,status) VALUES(?1,?2,'aborted')",params![task.binding.session_id,task.binding.turn_id])?;
        tx.commit()?;
        Ok(json!({"taskId":id,"discarded":true,"preservedDraft":true,"modelReplay":false}))
    }
}
