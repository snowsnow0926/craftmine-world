//! Immutable verification inputs and evidence. Only the trusted broker can
//! claim/complete work; neither a model nor a panel can report its own success.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

use super::{digest, document, read_task, workspaces, worlds, TaskJournal, WorkspaceContext};

#[cfg(test)]
#[path = "verification_tests.rs"]
mod tests;

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS craftmine_verifications (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES craftmine_worlds(id),
        task_id TEXT NOT NULL REFERENCES craftmine_workspaces(task_id),
        tool_call_id TEXT NOT NULL, request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','passed','failed','cancelled','interrupted')),
        input TEXT NOT NULL, input_hash TEXT NOT NULL, run_token TEXT,
        output TEXT, output_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(task_id,tool_call_id)
    );
    CREATE INDEX IF NOT EXISTS craftmine_verifications_world ON craftmine_verifications(world_id,created_at);")?;
    Ok(())
}

pub(super) fn read(db: &Connection, id: &str) -> Result<Value> {
    expire(db)?;
    let (status,input,hash,output,output_hash,created,updated): (String,String,String,Option<String>,Option<String>,i64,i64) = db.query_row(
        "SELECT status,input,input_hash,output,output_hash,created_at,updated_at FROM craftmine_verifications WHERE id=?1", [id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)),
    ).context("VERIFICATION_NOT_FOUND")?;
    ensure!(digest(&input) == hash, "CORRUPT_VERIFICATION_INPUT");
    let output: Option<Value> = output
        .map(|body| {
            ensure!(
                Some(digest(&body)) == output_hash,
                "CORRUPT_VERIFICATION_OUTPUT"
            );
            Ok(serde_json::from_str(&body)?)
        })
        .transpose()?;
    let input: Value = serde_json::from_str(&input)?;
    let current = assert_current(db, &input).is_ok();
    Ok(
        json!({"id":id,"status":status,"input":input,"inputHash":hash,
        "output":output,"outputHash":output_hash,"createdAt":created,"updatedAt":updated,
        "current":current,"publishingAvailable":false}),
    )
}

fn expire(db: &Connection) -> Result<()> {
    let now = worlds::timestamp()?;
    db.execute(
        "UPDATE craftmine_verifications SET status='interrupted',run_token=NULL,updated_at=?1
        WHERE status IN ('queued','running') AND updated_at < ?2",
        params![now, now - 60_000],
    )?;
    Ok(())
}

pub(super) fn assert_current(db: &Connection, input: &Value) -> Result<()> {
    let binding = &input["binding"];
    let id = binding["taskId"].as_str().context("TASK_ID_REQUIRED")?;
    let task = read_task(db, id)?;
    ensure!(task.status != "cancelled", "TASK_INACTIVE");
    let head: String = db.query_row(
        "SELECT head_task FROM craftmine_session_worlds WHERE session_id=?1",
        [binding["sessionId"].as_str().context("SESSION_REQUIRED")?],
        |r| r.get(0),
    )?;
    ensure!(head == id, "STALE_TURN");
    ensure!(
        task.draft_hash == input["draftHash"].as_str().unwrap_or(""),
        "STALE_DRAFT"
    );
    ensure!(
        Some(task.revision) == input["workspaceRevision"].as_u64(),
        "STALE_DRAFT"
    );
    let world = worlds::read(db, input["worldId"].as_str().context("WORLD_ID_REQUIRED")?)?;
    ensure!(
        world.world.build["id"] == binding["baseBuild"],
        "WORLD_BUILD_CONFLICT"
    );
    ensure!(
        serde_json::to_value(world.world.extensions)? == input["world"]["extensions"],
        "EXTENSIONS_CHANGED"
    );
    Ok(())
}

pub(super) fn cancel_task(db: &Connection, task: &str) -> Result<()> {
    db.execute(
        "UPDATE craftmine_verifications SET status='cancelled',run_token=NULL,updated_at=?2
        WHERE task_id=?1 AND status IN ('queued','running')",
        params![task, worlds::timestamp()?],
    )?;
    Ok(())
}

pub(super) fn summary(record: &Value) -> Value {
    let input = &record["input"];
    json!({"id":record["id"],"worldId":input["worldId"],"taskId":input["binding"]["taskId"],
        "workspaceRevision":input["workspaceRevision"],"baseBuild":input["binding"]["baseBuild"],
        "draftHash":input["draftHash"],"summary":input["summary"],"status":record["status"],
        "current":record["current"],"inputHash":record["inputHash"],"outputHash":record["outputHash"],
        "createdAt":record["createdAt"],"updatedAt":record["updatedAt"],"publishingAvailable":false})
}

impl TaskJournal {
    pub fn verification_submit(
        &mut self,
        ctx: &WorkspaceContext,
        call: &str,
        revision: u64,
        description: &str,
    ) -> Result<Value> {
        self.verification_submit_with_origin(ctx, call, revision, description, &Value::Null)
    }

    pub fn verification_submit_with_origin(
        &mut self,
        ctx: &WorkspaceContext,
        call: &str,
        revision: u64,
        description: &str,
        origin: &Value,
    ) -> Result<Value> {
        self.verification_submit_bound(ctx, call, revision, description, origin, None)
    }

    /// Host-only retry of the exact finished current draft. This does not
    /// create a turn, reacquire its writer lease or change the budget owner.
    pub fn verification_retry(&mut self, args: &Value) -> Result<Value> {
        super::durable::fields(
            args,
            &[
                "context",
                "toolCallId",
                "revision",
                "draftHash",
                "summary",
                "origin",
            ],
        )?;
        let ctx: WorkspaceContext = serde_json::from_value(args["context"].clone())?;
        let call = super::durable::text(args, "toolCallId", 240)?;
        let revision = super::durable::number(args, "revision", i64::MAX as u64)?;
        let hash = super::durable::text(args, "draftHash", 64)?;
        ensure!(
            hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "INVALID_DRAFT_HASH"
        );
        let description = super::durable::text(args, "summary", 3200)?;
        self.verification_submit_bound(
            &ctx,
            call,
            revision,
            description,
            args.get("origin").unwrap_or(&Value::Null),
            Some(hash),
        )
    }

    fn verification_submit_bound(
        &mut self,
        ctx: &WorkspaceContext,
        call: &str,
        revision: u64,
        description: &str,
        origin: &Value,
        retry_hash: Option<&str>,
    ) -> Result<Value> {
        workspaces::call_id(call)?;
        ensure!(
            !description.trim().is_empty() && description.chars().count() <= 800,
            "INVALID_SUMMARY"
        );
        let mut request = json!({"revision":revision,"summary":description,"origin":origin});
        if let Some(hash) = retry_hash {
            request["retryDraftHash"] = json!(hash);
        }
        let request_hash = digest(&document(&request)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        expire(&tx)?;
        let workspace = workspaces::inspect(&tx, ctx)?;
        if let Some(hash) = retry_hash {
            ensure!(
                workspace.task.status == "finished",
                "FINISHED_CURRENT_DRAFT_REQUIRED"
            );
            ensure!(workspace.task.draft_hash == hash, "STALE_DRAFT_HASH");
            super::applications::assert_idle(&tx, &workspace.world_id)?;
            let leased: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM craftmine_world_leases WHERE world_id=?1)",
                [&workspace.world_id],
                |row| row.get(0),
            )?;
            ensure!(!leased, "WORLD_LEASE_BUSY");
            let world = worlds::read(&tx, &workspace.world_id)?;
            ensure!(
                world.world.build["id"].as_str() == Some(&workspace.task.binding.base_build),
                "WORLD_BUILD_CONFLICT"
            );
        } else {
            workspaces::assert_live(&tx, &workspace)?;
        }
        let binding = &workspace.task.binding;
        let prior: Option<(String,String)> = tx.query_row(
            "SELECT id,request_hash FROM craftmine_verifications WHERE task_id=?1 AND tool_call_id=?2",
            params![binding.task_id,call], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((id, hash)) = prior {
            ensure!(request_hash == hash, "REPLAY_MISMATCH");
            return Ok(summary(&read(&tx, &id)?));
        }
        ensure!(workspace.task.revision == revision, "STALE_DRAFT");
        let world = worlds::read(&tx, &workspace.world_id)?;
        ensure!(
            workspace.task.draft["scene"] != world.world.build["scene"],
            "NO_CHANGE"
        );
        let active: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_verifications
            WHERE world_id=?1 AND status IN ('queued','running'))",
            [&workspace.world_id],
            |r| r.get(0),
        )?;
        ensure!(!active, "VERIFICATION_BUSY");
        let input = json!({"worldId":workspace.world_id,"binding":binding,"workspaceRevision":revision,
            "draftHash":workspace.task.draft_hash,"draft":workspace.task.draft,"world":world.world,"summary":description,"origin":origin});
        let body = serde_json::to_string(&input)?;
        ensure!(
            body.len() <= worlds::MAX_WORLD_BYTES + super::MAX_DOCUMENT_BYTES,
            "VERIFICATION_TOO_LARGE"
        );
        let id = format!(
            "check-{}",
            digest(&serde_json::to_string(&json!([binding.task_id, call]))?)
        );
        let now = worlds::timestamp()?;
        tx.execute("INSERT INTO craftmine_verifications(id,world_id,task_id,tool_call_id,request_hash,status,input,input_hash,created_at,updated_at)
            VALUES(?1,?2,?3,?4,?5,'queued',?6,?7,?8,?8)",
            params![id,workspace.world_id,binding.task_id,call,request_hash,body,digest(&body),now])?;
        tx.commit()?;
        Ok(summary(&read(&self.db, &id)?))
    }

    pub fn verification_claim(&mut self, id: &str, token: &str) -> Result<Value> {
        workspaces::call_id(token)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let record = read(&tx, id)?;
        ensure!(record["status"] == "queued", "VERIFICATION_INACTIVE");
        assert_current(&tx, &record["input"])?;
        tx.execute("UPDATE craftmine_verifications SET status='running',run_token=?2,updated_at=?3 WHERE id=?1",
            params![id,token,worlds::timestamp()?])?;
        tx.commit()?;
        read(&self.db, id)
    }

    pub fn verification_finish(&mut self, id: &str, token: &str, output: &Value) -> Result<Value> {
        let body = serde_json::to_string(output)?;
        ensure!(
            body.len() <= worlds::MAX_WORLD_BYTES + super::MAX_DOCUMENT_BYTES,
            "VERIFICATION_TOO_LARGE"
        );
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let record = read(&tx, id)?;
        let owner: Option<String> = tx.query_row(
            "SELECT run_token FROM craftmine_verifications WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        ensure!(
            owner.as_deref() == Some(token),
            "VERIFICATION_OWNER_MISMATCH"
        );
        if matches!(record["status"].as_str(), Some("passed" | "failed")) {
            ensure!(record["outputHash"] == digest(&body), "REPLAY_MISMATCH");
            return Ok(summary(&record));
        }
        ensure!(record["status"] == "running", "VERIFICATION_INACTIVE");
        assert_current(&tx, &record["input"])?;
        ensure!(
            output["inputHash"] == record["inputHash"],
            "VERIFICATION_INPUT_MISMATCH"
        );
        let evidence = &output["evidence"];
        document(evidence)?;
        ensure!(
            evidence["format"] == "craftmine.desktop-check/1",
            "INVALID_VERIFICATION_EVIDENCE"
        );
        // A failure is useful evidence. A success must carry the actual compiled
        // artifact and all machine gates, bound to this immutable input.
        let passed = evidence["passed"] == true;
        if passed {
            let artifact = &output["artifact"];
            let build = &artifact["build"];
            ensure!(
                build["scene"] == record["input"]["draft"]["scene"],
                "VERIFICATION_SCENE_MISMATCH"
            );
            ensure!(
                artifact["extensions"]
                    == record["input"]["draft"]
                        .get("extensions")
                        .unwrap_or(&record["input"]["world"]["extensions"])
                        .clone(),
                "EXTENSIONS_CHANGED"
            );
            if let Some(existing) = record["input"]["world"]["extensions"].as_array() {
                let loaded = artifact["extensions"]
                    .as_array()
                    .context("EXTENSIONS_REQUIRED")?;
                ensure!(
                    existing.iter().all(|old| loaded.contains(old)),
                    "EXISTING_EXTENSION_CHANGED"
                );
            }
            ensure!(
                build["hash"]
                    .as_str()
                    .is_some_and(|h| h.len() == 64 && h.bytes().all(|c| c.is_ascii_hexdigit())),
                "BUILD_HASH_REQUIRED"
            );
            ensure!(
                build["id"] == format!("v-{}", &build["hash"].as_str().unwrap()[..20]),
                "BUILD_ID_MISMATCH"
            );
            ensure!(
                evidence["compiler"]["passed"] == true
                    && evidence["behaviors"]["passed"] == true
                    && evidence["render"]["passed"] == true,
                "INCOMPLETE_VERIFICATION"
            );
            ensure!(
                evidence["behaviors"]["build"] == build["hash"]
                    && evidence["render"]["version"] == build["id"],
                "VERIFICATION_BUILD_MISMATCH"
            );
            let modules = evidence["behaviors"]["modules"]
                .as_array()
                .context("MODULE_EVIDENCE_REQUIRED")?;
            let artifacts = build["behaviors"]
                .as_array()
                .context("BEHAVIORS_REQUIRED")?;
            ensure!(modules.len() == artifacts.len(), "MODULE_EVIDENCE_MISMATCH");
            for (module, artifact) in modules.iter().zip(artifacts) {
                ensure!(
                    module["passed"] == true
                        && module["id"] == artifact["definition"]["id"]
                        && module["revision"] == artifact["id"],
                    "MODULE_EVIDENCE_MISMATCH"
                );
            }
        } else {
            ensure!(
                evidence["error"].is_string() || evidence["behaviors"]["passed"] == false,
                "FAILURE_EVIDENCE_REQUIRED"
            );
        }
        tx.execute("UPDATE craftmine_verifications SET status=?2,output=?3,output_hash=?4,updated_at=?5 WHERE id=?1",
            params![id,if passed {"passed"} else {"failed"},body,digest(&body),worlds::timestamp()?])?;
        tx.commit()?;
        Ok(summary(&read(&self.db, id)?))
    }

    pub fn verification_read(&self, id: &str, ctx: Option<&WorkspaceContext>) -> Result<Value> {
        let record = read(&self.db, id)?;
        if let Some(ctx) = ctx {
            ctx.validate()?;
            let binding = &record["input"]["binding"];
            ensure!(
                binding["projectId"] == ctx.project_id && binding["sessionId"] == ctx.session_id,
                "VERIFICATION_BINDING_MISMATCH"
            );
        }
        Ok(record)
    }

    pub fn verification_list(&self, world: &str, offset: u32, limit: u32) -> Result<Vec<Value>> {
        worlds::validate_id(world)?;
        ensure!(limit > 0 && limit <= 32 && offset <= 10000, "INVALID_PAGE");
        let mut statement = self.db.prepare("SELECT id FROM craftmine_verifications WHERE world_id=?1 ORDER BY created_at DESC,id DESC LIMIT ?2 OFFSET ?3")?;
        let ids = statement.query_map(params![world, limit, offset], |r| r.get::<_, String>(0))?;
        ids.map(|id| Ok(summary(&read(&self.db, &id?)?))).collect()
    }

    pub fn verification_cancel(
        &mut self,
        id: &str,
        ctx: Option<&WorkspaceContext>,
    ) -> Result<Value> {
        self.verification_read(id, ctx)?;
        self.db.execute(
            "UPDATE craftmine_verifications SET status='cancelled',run_token=NULL,updated_at=?2
            WHERE id=?1 AND status IN ('queued','running')",
            params![id, worlds::timestamp()?],
        )?;
        Ok(summary(&read(&self.db, id)?))
    }

    /// Only service startup calls this. Opening a second read/test connection
    /// must not interrupt the process that still owns a live verification.
    pub fn verification_recover(&mut self) -> Result<usize> {
        Ok(self.db.execute(
            "UPDATE craftmine_verifications SET status='interrupted',run_token=NULL,updated_at=?1
            WHERE status IN ('queued','running')",
            [worlds::timestamp()?],
        )?)
    }
}
