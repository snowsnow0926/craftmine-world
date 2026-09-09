//! Scoped records retain provenance; a submitted evidence string is not proof.
use super::{
    durable::{fields, text},
    workspaces, worlds, TaskJournal, WorkspaceContext,
};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

pub(super) fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS craftmine_memories (
 scope_key TEXT NOT NULL,id TEXT NOT NULL,world_id TEXT,project_id TEXT NOT NULL,
 record TEXT NOT NULL,source_hash TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(scope_key,id));
 CREATE TABLE IF NOT EXISTS craftmine_memory_operations (operation_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS craftmine_memory_history (scope_key TEXT NOT NULL,id TEXT NOT NULL,record TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);")?;
    Ok(())
}
fn scope_key(scope: &Value) -> Result<String> {
    fields(scope, &["projectId", "worldId", "moduleId"])?;
    let project = text(scope, "projectId", 240)?;
    if let Some(world) = scope["worldId"].as_str() {
        worlds::validate_id(world)?;
        Ok(format!("world:{world}"))
    } else {
        Ok(format!("project:{project}"))
    }
}
fn safe_record(record: &Value) -> Result<()> {
    fields(
        record,
        &[
            "format",
            "id",
            "kind",
            "scope",
            "claim",
            "status",
            "sourceRefs",
            "appliesTo",
            "supersedes",
            "supersededBy",
            "tags",
            "createdAt",
            "lastVerifiedAt",
            "retiredReason",
        ],
    )?;
    let id = text(record, "id", 100)?;
    ensure!(
        id.contains(':')
            && id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b':' || c == b'-'),
        "INVALID_MEMORY_ID"
    );
    ensure!(
        matches!(
            record["kind"].as_str(),
            Some("project-rule" | "verified-experience" | "task-history" | "workflow")
        ),
        "INVALID_MEMORY_KIND"
    );
    let claim = text(record, "claim", 1600)?;
    ensure!(claim.chars().count() <= 400, "MEMORY_CLAIM_LIMIT");
    let lowered = claim.to_lowercase();
    ensure!(
        ![
            "api-key",
            "api_key",
            "apikey",
            "secret",
            "password",
            "passwd",
            "credential"
        ]
        .iter()
        .any(|word| lowered.contains(word)),
        "MEMORY_SECRET_REJECTED"
    );
    scope_key(&record["scope"])?;
    let refs = record["sourceRefs"]
        .as_array()
        .context("MEMORY_SOURCE_REQUIRED")?;
    ensure!(!refs.is_empty() && refs.len() <= 8, "MEMORY_SOURCE_LIMIT");
    for reference in refs {
        ensure!(
            reference.as_str().is_some_and(|s| s.contains(':')
                && s.len() <= 160
                && !s.chars().any(char::is_whitespace)),
            "INVALID_MEMORY_SOURCE"
        );
    }
    for (field, max) in [("tags", 12), ("supersedes", 8)] {
        if let Some(array) = record.get(field) {
            let values = array.as_array().context("MEMORY_ARRAY_REQUIRED")?;
            ensure!(
                values.len() <= max
                    && values
                        .iter()
                        .all(|v| v.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 128)),
                "MEMORY_ARRAY_LIMIT"
            );
        }
    }
    if let Some(applies) = record.get("appliesTo") {
        fields(applies, &["runtimeRange", "sourceHashes"])?;
        if let Some(hashes) = applies.get("sourceHashes") {
            let hashes = hashes.as_array().context("SOURCE_HASHES_REQUIRED")?;
            ensure!(
                hashes.len() <= 32
                    && hashes.iter().all(|h| {
                        h.as_str().is_some_and(|s| {
                            s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())
                        })
                    }),
                "INVALID_SOURCE_HASH"
            );
        }
    }
    Ok(())
}
fn validated_claim(db: &Connection, record: &Value, task: &str) -> Result<bool> {
    let claim = record["claim"].as_str().unwrap();
    for reference in record["sourceRefs"].as_array().unwrap() {
        let reference = reference.as_str().unwrap();
        if let Some(id) = reference.strip_prefix("user:") {
            let body:Option<String>=db.query_row("SELECT text FROM craftmine_task_requirements WHERE task_id=?1 AND request_id=?2",params![task,id],|r|r.get(0)).optional()?;
            if body.is_some_and(|body| body.trim() == claim.trim())
                && record["kind"] == "project-rule"
            {
                return Ok(true);
            }
        }
        // Only a frozen passed request assertion can attest its literal claim.
        if let Some(id) = reference.strip_prefix("evidence:") {
            let result:Option<(String,String)>=db.query_row("SELECT r.output,p.plan FROM craftmine_reviews r JOIN craftmine_review_plans p ON p.review_id=r.id JOIN craftmine_verifications v ON v.id=r.verification_id WHERE r.id=?1 AND r.status='completed' AND v.task_id=?2 AND json_extract(v.input,'$.draftHash')=(SELECT draft_hash FROM craftmine_tasks WHERE id=?2)",params![id,task],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
            if let Some((output, plan)) = result {
                let output: Value = serde_json::from_str(&output)?;
                let plan: Value = serde_json::from_str(&plan)?;
                if record["kind"] == "verified-experience"
                    && output["acceptance"]["passed"] == true
                    && plan["assertions"].as_array().is_some_and(|assertions| {
                        assertions.iter().any(|a| {
                            a["why"] == claim
                                && output["acceptance"]["assertions"].as_array().is_some_and(
                                    |results| {
                                        results
                                            .iter()
                                            .any(|r| r["id"] == a["id"] && r["passed"] == true)
                                    },
                                )
                        })
                    })
                {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}
impl TaskJournal {
    pub fn memory_propose(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["context", "operationId", "record"])?;
        let ctx: WorkspaceContext = serde_json::from_value(args["context"].clone())?;
        let operation = text(args, "operationId", 240)?;
        let input = &args["record"];
        safe_record(input)?;
        ensure!(
            input["status"].is_null() || input["status"] == "proposed",
            "MODEL_CANNOT_VALIDATE_MEMORY"
        );
        let request_hash = super::digest(&serde_json::to_string(args)?);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let snapshot = workspaces::inspect(&tx, &ctx)?;
        workspaces::assert_live(&tx, &snapshot)?;
        let prior: Option<(String, String)> = tx
            .query_row(
                "SELECT request_hash,result FROM craftmine_memory_operations WHERE operation_id=?1",
                [operation],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((old, result)) = prior {
            ensure!(old == request_hash, "REPLAY_MISMATCH");
            return Ok(serde_json::from_str(&result)?);
        }
        ensure!(
            input["scope"]["projectId"] == ctx.project_id,
            "PROJECT_BINDING_MISMATCH"
        );
        if input["scope"].get("worldId").is_some() {
            ensure!(
                input["scope"]["worldId"] == snapshot.world_id,
                "MEMORY_WORLD_MISMATCH"
            );
        }
        let mut record = input.clone();
        record["format"] = json!("craftmine.memory/1");
        record["scope"]["worldId"] = json!(snapshot.world_id);
        let scope = scope_key(&record["scope"])?;
        let id = text(&record, "id", 100)?.to_string();
        record["status"] = json!(
            if validated_claim(&tx, &record, &snapshot.task.binding.task_id)? {
                "validated"
            } else {
                "proposed"
            }
        );
        record["createdAt"] = json!(worlds::timestamp()?);
        record["lastVerifiedAt"] = if record["status"] == "validated" {
            record["createdAt"].clone()
        } else {
            Value::Null
        };
        let source_hash = snapshot.task.draft_hash.clone();
        if !record["appliesTo"].is_object() {
            record["appliesTo"] = json!({});
        }
        if record["kind"] == "verified-experience" {
            record["appliesTo"]["sourceHashes"] = json!([source_hash]);
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_memories WHERE scope_key=?1 AND id=?2)",
            params![scope, id],
            |r| r.get(0),
        )?;
        ensure!(!exists, "IMMUTABLE_MEMORY_ID_CONFLICT");
        let count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM craftmine_memories WHERE scope_key=?1",
            [&scope],
            |r| r.get(0),
        )?;
        ensure!(count < 2048, "MEMORY_LIMIT");
        let body = serde_json::to_string(&record)?;
        for old_id in record["supersedes"].as_array().unwrap_or(&Vec::new()) {
            let old_id = old_id.as_str().context("MEMORY_ID_REQUIRED")?;
            let old_body: String = tx
                .query_row(
                    "SELECT record FROM craftmine_memories WHERE scope_key=?1 AND id=?2",
                    params![scope, old_id],
                    |r| r.get(0),
                )
                .context("SUPERSEDED_MEMORY_NOT_FOUND")?;
            let mut old: Value = serde_json::from_str(&old_body)?;
            ensure!(old["status"] != "retired", "MEMORY_ALREADY_RETIRED");
            ensure!(
                old["status"] != "validated" || record["status"] == "validated",
                "MEMORY_SUPERSESSION_REQUIRES_VALIDATED_SOURCE"
            );
            old["supersededBy"] = json!(id);
            tx.execute("INSERT INTO craftmine_memory_history(scope_key,id,record,reason,created_at) VALUES(?1,?2,?3,'superseded',?4)",params![scope,old_id,old_body,worlds::timestamp()?])?;
            tx.execute(
                "UPDATE craftmine_memories SET record=?3 WHERE scope_key=?1 AND id=?2",
                params![scope, old_id, serde_json::to_string(&old)?],
            )?;
        }
        tx.execute("INSERT INTO craftmine_memories(scope_key,id,world_id,project_id,record,source_hash,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![scope,id,snapshot.world_id,ctx.project_id,body,source_hash,worlds::timestamp()?])?;
        tx.execute("INSERT INTO craftmine_memory_operations(operation_id,request_hash,result) VALUES(?1,?2,?3)",params![operation,request_hash,body])?;
        tx.commit()?;
        Ok(record)
    }
    pub fn memory_search(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "scope",
                "query",
                "kind",
                "includeInactive",
                "runtimeVersion",
                "sourceHashes",
                "offset",
                "limit",
            ],
        )?;
        let scope = scope_key(&args["scope"])?;
        let query = args["query"].as_str().unwrap_or("").to_lowercase();
        ensure!(query.len() <= 512, "QUERY_LIMIT");
        let offset = args["offset"].as_u64().unwrap_or(0);
        let limit = args["limit"].as_u64().unwrap_or(10);
        ensure!(limit > 0 && limit <= 50 && offset <= 2048, "PAGE_LIMIT");
        let rows=self.db.prepare("SELECT id,record FROM craftmine_memories WHERE scope_key=?1 ORDER BY created_at DESC LIMIT 2048")?.query_map([&scope],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let mut items = Vec::new();
        for (id, body) in rows {
            let mut record: Value = serde_json::from_str(&body)?;
            let hashes = args["sourceHashes"].as_array();
            let runtime = args["runtimeVersion"].as_str();
            let changed = hashes.is_some_and(|h| {
                !h.is_empty()
                    && record["appliesTo"]["sourceHashes"]
                        .as_array()
                        .is_some_and(|old| !old.iter().all(|hash| h.contains(hash)))
            }) || runtime.is_some_and(|r| {
                record["appliesTo"]["runtimeRange"]
                    .as_str()
                    .is_some_and(|old| old != r)
            });
            if changed && record["status"] == "validated" {
                record["status"] = json!("needs_revalidation");
                self.db.execute("INSERT INTO craftmine_memory_history(scope_key,id,record,reason,created_at) VALUES(?1,?2,?3,'source changed',?4)",params![scope,id,body,worlds::timestamp()?])?;
                self.db.execute(
                    "UPDATE craftmine_memories SET record=?3 WHERE scope_key=?1 AND id=?2",
                    params![scope, id, serde_json::to_string(&record)?],
                )?;
            }
            if args["includeInactive"] != true
                && (record["status"] == "retired" || record.get("supersededBy").is_some())
            {
                continue;
            }
            if args.get("kind").is_some() && args["kind"] != record["kind"] {
                continue;
            }
            let hay = format!(
                "{} {}",
                record["claim"].as_str().unwrap_or(""),
                record["tags"]
            )
            .to_lowercase();
            if !query.is_empty()
                && !hay.contains(&query)
                && !query.chars().any(|c| !c.is_whitespace() && hay.contains(c))
            {
                continue;
            }
            items.push(record);
        }
        let total = items.len();
        Ok(
            json!({"items":items.into_iter().skip(offset as usize).take(limit as usize).collect::<Vec<_>>(),"total":total,"offset":offset,"next":if offset+limit<total as u64{Some(offset+limit)}else{None}}),
        )
    }
    pub fn memory_retire(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["scope", "id", "reason"])?;
        let scope = scope_key(&args["scope"])?;
        let id = text(args, "id", 100)?;
        let reason = text(args, "reason", 800)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let body: String = tx
            .query_row(
                "SELECT record FROM craftmine_memories WHERE scope_key=?1 AND id=?2",
                params![scope, id],
                |r| r.get(0),
            )
            .context("MEMORY_NOT_FOUND")?;
        let mut record: Value = serde_json::from_str(&body)?;
        if record["status"] == "retired" {
            ensure!(record["retiredReason"] == reason, "REPLAY_MISMATCH");
            return Ok(record);
        }
        record["status"] = json!("retired");
        record["retiredReason"] = json!(reason);
        tx.execute("INSERT INTO craftmine_memory_history(scope_key,id,record,reason,created_at) VALUES(?1,?2,?3,?4,?5)",params![scope,id,body,reason,worlds::timestamp()?])?;
        tx.execute(
            "UPDATE craftmine_memories SET record=?3 WHERE scope_key=?1 AND id=?2",
            params![scope, id, serde_json::to_string(&record)?],
        )?;
        tx.commit()?;
        Ok(record)
    }
}
