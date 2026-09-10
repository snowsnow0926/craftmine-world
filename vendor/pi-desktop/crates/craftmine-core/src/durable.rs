//! Host-owned request accounting and short authoritative task facts.
use super::{
    assert_binding, digest, document, read_task, workspaces, worlds, TaskBinding, TaskJournal,
    WorkspaceContext,
};
use anyhow::{bail, ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
#[cfg(test)]
#[path = "durable_tests.rs"]
mod tests;

pub(super) fn migrate(db: &Connection) -> Result<()> {
    let tx = rusqlite::Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
    let configured: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='craftmine_budget_configurations')", [], |r| r.get(0))?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_task_runtime (
      task_id TEXT PRIMARY KEY REFERENCES craftmine_tasks(id), generation INTEGER NOT NULL,
      budget_owner TEXT NOT NULL, recovery TEXT NOT NULL DEFAULT 'none');
    CREATE TABLE IF NOT EXISTS craftmine_budget_limits (
      owner TEXT PRIMARY KEY, limits TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS craftmine_budget_requests (
      owner TEXT NOT NULL, request_id TEXT NOT NULL, task_id TEXT NOT NULL,
      generation INTEGER NOT NULL, purpose TEXT NOT NULL, request_hash TEXT NOT NULL,
      estimate INTEGER NOT NULL, status TEXT NOT NULL, settlement TEXT,
      PRIMARY KEY(owner,request_id));
    CREATE TABLE IF NOT EXISTS craftmine_budget_events (
      owner TEXT NOT NULL,event_id TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(owner,event_id));
    CREATE TABLE IF NOT EXISTS craftmine_budget_settlement_history (
      owner TEXT NOT NULL,request_id TEXT NOT NULL,previous TEXT NOT NULL,updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner,request_id));
    CREATE TABLE IF NOT EXISTS craftmine_task_requirements (
      task_id TEXT NOT NULL,request_id TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,
      created_at INTEGER NOT NULL,PRIMARY KEY(task_id,request_id));",
    )?;
    if !configured {
        tx.execute("INSERT OR IGNORE INTO craftmine_task_runtime(task_id,generation,budget_owner) SELECT id,1,id FROM craftmine_tasks", [])?;
        tx.execute("INSERT OR IGNORE INTO craftmine_budget_limits(owner,limits) SELECT DISTINCT budget_owner,?1 FROM craftmine_task_runtime", [serde_json::to_string(&legacy_limits())?])?;
    }
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS craftmine_budget_configurations (
      owner TEXT NOT NULL,operation_id TEXT NOT NULL,request TEXT NOT NULL,result TEXT NOT NULL,
      created_at INTEGER NOT NULL,PRIMARY KEY(owner,operation_id));",
    )?;
    tx.commit()?;
    Ok(())
}
pub(super) fn legacy_limits() -> Value {
    json!({"maxRequests":DEFAULT_MAX_REQUESTS,"maxTokens":1000000,"maxCompactions":8,"deadlineAt":null})
}
const MAX_TOKEN_LIMIT: u64 = 9_007_199_254_740_991;
fn token_limit(value: &Value) -> Result<Option<u64>> {
    if value.is_null() {
        return Ok(None);
    }
    let n = value.as_u64().context("INVALID_BUDGET_LIMIT")?;
    ensure!(n > 0 && n <= MAX_TOKEN_LIMIT, "INVALID_BUDGET_LIMIT");
    Ok(Some(n))
}

/// The request boundary a task keeps when no authorized budget was fixed. It is
/// the product default and never changes because a caller stayed silent.
const DEFAULT_MAX_REQUESTS: u64 = 80;
const MAX_REQUEST_LIMIT: u64 = 10_000;
/// An explicit null (authorized unlimited requests) is kept distinct from a
/// missing or mistyped field, which is never treated as unlimited.
fn request_limit(value: &Value) -> Result<Option<u64>> {
    if value.is_null() {
        return Ok(None);
    }
    let n = value.as_u64().context("maxRequests: INTEGER_REQUIRED")?;
    ensure!(n <= MAX_REQUEST_LIMIT, "NUMBER_LIMIT");
    ensure!(n > 0, "INVALID_BUDGET_LIMIT");
    Ok(Some(n))
}

pub(super) fn fields(value: &Value, allowed: &[&str]) -> Result<()> {
    let object = value.as_object().context("PARAMS_OBJECT_REQUIRED")?;
    ensure!(
        object.keys().all(|key| allowed.contains(&key.as_str())),
        "UNKNOWN_FIELD"
    );
    Ok(())
}
pub(super) fn text<'a>(v: &'a Value, key: &str, max: usize) -> Result<&'a str> {
    let s = v[key].as_str().context(format!("{key}: STRING_REQUIRED"))?;
    ensure!(
        !s.trim().is_empty()
            && s.len() <= max
            && !s.chars().any(|c| c.is_control() && c != '\n' && c != '\t'),
        "INVALID_TEXT"
    );
    Ok(s)
}
pub(super) fn number(v: &Value, key: &str, max: u64) -> Result<u64> {
    let n = v[key]
        .as_u64()
        .context(format!("{key}: INTEGER_REQUIRED"))?;
    ensure!(n <= max, "NUMBER_LIMIT");
    Ok(n)
}
pub(super) fn runtime(db: &Connection, task: &str) -> Result<(u64, String, String)> {
    read_task(db, task)?;
    db.execute("INSERT OR IGNORE INTO craftmine_task_runtime(task_id,generation,budget_owner) VALUES(?1,1,?1)",[task])?;
    Ok(db.query_row(
        "SELECT generation,budget_owner,recovery FROM craftmine_task_runtime WHERE task_id=?1",
        [task],
        |r| Ok((r.get::<_, i64>(0)? as u64, r.get(1)?, r.get(2)?)),
    )?)
}
fn identity(db: &Connection, args: &Value, live: bool) -> Result<(TaskBinding, String)> {
    let binding: TaskBinding = serde_json::from_value(args["binding"].clone())?;
    binding.validate()?;
    let task = read_task(db, &binding.task_id)?;
    assert_binding(&task, &binding)?;
    let (generation, owner, recovery) = runtime(db, &binding.task_id)?;
    ensure!(
        args["generation"].as_u64() == Some(generation),
        "STALE_GENERATION"
    );
    if live {
        let review = args["purpose"] == "review";
        let maintenance = args["purpose"] == "summary" || args["kind"] == "compaction";
        ensure!(
            (task.status == "running" || (review || maintenance) && task.status == "finished")
                && recovery == "none",
            "TASK_INACTIVE"
        );
        let ctx = WorkspaceContext {
            project_id: binding.project_id.clone(),
            session_id: binding.session_id.clone(),
            turn_id: binding.turn_id.clone(),
        };
        let snapshot = workspaces::inspect(db, &ctx)?;
        if review {
            let current:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM craftmine_verifications WHERE task_id=?1 AND status='passed' AND json_extract(input,'$.draftHash')=?2)",params![binding.task_id,task.draft_hash],|r|r.get(0))?;
            ensure!(current, "REVIEW_CHECK_REQUIRED");
            let world = worlds::read(db, &snapshot.world_id)?;
            ensure!(
                world.world.build["id"] == binding.base_build,
                "WORLD_BUILD_CONFLICT"
            );
        } else if !(maintenance && task.status == "finished") {
            workspaces::assert_live(db, &snapshot)?;
        }
    }
    Ok((binding, owner))
}
fn limits(db: &Connection, owner: &str) -> Result<Value> {
    let stored: Option<String> = db
        .query_row(
            "SELECT limits FROM craftmine_budget_limits WHERE owner=?1",
            [owner],
            |r| r.get(0),
        )
        .optional()?;
    let value = stored
        .map(|s| serde_json::from_str(&s))
        .transpose()?
        .unwrap_or(json!({"maxRequests":DEFAULT_MAX_REQUESTS,"maxTokens":null,"maxCompactions":8,"deadlineAt":null}));
    validate_limits(&value)?;
    Ok(value)
}
fn validate_limits(value: &Value) -> Result<()> {
    fields(
        value,
        &["maxRequests", "maxTokens", "maxCompactions", "deadlineAt"],
    )?;
    // `null` is the only authorized way to remove the request boundary; a
    // missing field stays an error so an unknown caller cannot widen a task.
    request_limit(
        value
            .get("maxRequests")
            .context("maxRequests: INTEGER_REQUIRED")?,
    )?;
    ensure!(
        number(value, "maxCompactions", 100)? > 0,
        "INVALID_BUDGET_LIMIT"
    );
    token_limit(value.get("maxTokens").context("MAX_TOKENS_REQUIRED")?)?;
    let deadline = value.get("deadlineAt").context("DEADLINE_REQUIRED")?;
    if !deadline.is_null() {
        number(value, "deadlineAt", i64::MAX as u64)?;
    }
    Ok(())
}
fn validate_settlement(value: &Value, status: &str) -> Result<()> {
    fields(value, &["status", "usage", "errorCode"])?;
    ensure!(
        value["status"] == status && ["known", "unknown", "cancelled"].contains(&status),
        "CORRUPT_SETTLEMENT"
    );
    if status == "known" {
        fields(
            &value["usage"],
            &["inputTokens", "outputTokens", "totalTokens"],
        )?;
        let input = number(&value["usage"], "inputTokens", 100_000_000)?;
        let output = number(&value["usage"], "outputTokens", 100_000_000)?;
        let total = number(&value["usage"], "totalTokens", 200_000_000)?;
        ensure!(total >= input && total >= output, "INVALID_USAGE_TOTAL");
    } else {
        ensure!(
            value.get("usage").is_none_or(Value::is_null),
            "UNKNOWN_USAGE_MUST_BE_ABSENT"
        );
    }
    if value.get("errorCode").is_some() {
        text(value, "errorCode", 120)?;
    }
    Ok(())
}
fn configuration_identity(db: &Connection, args: &Value) -> Result<(String, String)> {
    fields(
        args,
        &[
            "projectId",
            "sessionId",
            "worldId",
            "taskId",
            "generation",
            "operationId",
            "maxTokens",
        ],
    )?;
    let operation = text(args, "operationId", 240)?.to_owned();
    let task_id = text(args, "taskId", 240)?;
    token_limit(args.get("maxTokens").context("MAX_TOKENS_REQUIRED")?)?;
    let task = read_task(db, task_id)?;
    ensure!(
        args["projectId"] == task.binding.project_id
            && args["sessionId"] == task.binding.session_id,
        "TASK_BINDING_MISMATCH"
    );
    let world: String = db.query_row(
        "SELECT world_id FROM craftmine_workspaces WHERE task_id=?1",
        [task_id],
        |r| r.get(0),
    )?;
    ensure!(args["worldId"] == world, "WORLD_BINDING_MISMATCH");
    let runtime: Option<(i64, String)> = db
        .query_row(
            "SELECT generation,budget_owner FROM craftmine_task_runtime WHERE task_id=?1",
            [task_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (generation, owner) = runtime.unwrap_or((1, task_id.to_owned()));
    ensure!(
        generation > 0 && args["generation"].as_i64() == Some(generation),
        "STALE_GENERATION"
    );
    Ok((owner, operation))
}
fn validate_configuration_result(
    db: &Connection,
    request: &Value,
    result: &Value,
    owner: &str,
) -> Result<()> {
    fields(result, &["operationId", "budget", "previousMaxTokens"])?;
    ensure!(
        result["operationId"] == request["operationId"],
        "CORRUPT_CONFIGURATION_RECEIPT"
    );
    token_limit(
        result
            .get("previousMaxTokens")
            .context("CORRUPT_CONFIGURATION_RECEIPT")?,
    )?;
    let value = &result["budget"];
    fields(
        value,
        &[
            "ownerTaskId",
            "requestCount",
            "toolCallCount",
            "compactionCount",
            "actualTokens",
            "reservedTokens",
            "unknownRequestCount",
            "chargedTokens",
            "remainingTokens",
            "limits",
        ],
    )?;
    ensure!(
        value["ownerTaskId"] == owner && value["limits"]["maxTokens"] == request["maxTokens"],
        "CORRUPT_CONFIGURATION_RECEIPT"
    );
    validate_limits(&value["limits"])?;
    let current = budget(db, owner)?;
    for key in [
        "requestCount",
        "toolCallCount",
        "compactionCount",
        "actualTokens",
    ] {
        ensure!(
            number(value, key, MAX_TOKEN_LIMIT)? <= number(&current, key, MAX_TOKEN_LIMIT)?,
            "CORRUPT_CONFIGURATION_RECEIPT"
        );
    }
    for key in [
        "requestCount",
        "toolCallCount",
        "compactionCount",
        "actualTokens",
        "reservedTokens",
        "unknownRequestCount",
        "chargedTokens",
    ] {
        number(value, key, MAX_TOKEN_LIMIT)?;
    }
    ensure!(
        value["unknownRequestCount"].as_u64() <= value["requestCount"].as_u64(),
        "CORRUPT_CONFIGURATION_RECEIPT"
    );
    let charged = value["actualTokens"]
        .as_u64()
        .unwrap()
        .checked_add(value["reservedTokens"].as_u64().unwrap())
        .context("CORRUPT_CONFIGURATION_RECEIPT")?;
    ensure!(
        value["chargedTokens"].as_u64() == Some(charged)
            && value.get("remainingTokens")
                == Some(&json!(token_limit(&value["limits"]["maxTokens"])?
                    .map(|max| max.saturating_sub(charged)))),
        "CORRUPT_CONFIGURATION_RECEIPT"
    );
    Ok(())
}
/// Validate imported accounting before replacement, not on the next model call.
pub(super) fn validate_ledger(db: &Connection) -> Result<()> {
    let owners=db.prepare("SELECT budget_owner FROM craftmine_task_runtime UNION SELECT owner FROM craftmine_budget_limits UNION SELECT owner FROM craftmine_budget_requests UNION SELECT owner FROM craftmine_budget_events UNION SELECT owner FROM craftmine_budget_configurations UNION SELECT owner FROM craftmine_budget_settlement_history")?.query_map([],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    for owner in owners {
        read_task(db, &owner)?;
        budget(db, &owner)?;
    }
    for row in db
        .prepare("SELECT owner,task_id,generation,purpose FROM craftmine_budget_requests")?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?
    {
        let (owner, task, generation, purpose) = row?;
        read_task(db, &task)?;
        let stored: (i64, String) = db.query_row(
            "SELECT generation,budget_owner FROM craftmine_task_runtime WHERE task_id=?1",
            [task],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        ensure!(
            generation > 0
                && stored == (generation, owner)
                && ["creation", "summary", "review", "retry"].contains(&purpose.as_str()),
            "CORRUPT_BUDGET_BINDING"
        );
    }
    for kind in db
        .prepare("SELECT kind FROM craftmine_budget_events")?
        .query_map([], |r| r.get::<_, String>(0))?
    {
        ensure!(
            ["compaction", "tool"].contains(&kind?.as_str()),
            "CORRUPT_BUDGET_EVENT"
        );
    }
    for row in db.prepare("SELECT owner,operation_id,request,result,created_at FROM craftmine_budget_configurations")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?)))? {
        let (owner,operation,request,result,created)=row?;
        let request: Value=serde_json::from_str(&request)?;
        ensure!(configuration_identity(db,&request)?==(owner.clone(),operation) && created>=0,"CORRUPT_CONFIGURATION_RECEIPT");
        validate_configuration_result(db,&request,&serde_json::from_str(&result)?,&owner)?;
    }
    for previous in db
        .prepare("SELECT previous FROM craftmine_budget_settlement_history")?
        .query_map([], |r| r.get::<_, String>(0))?
    {
        let value: Value = serde_json::from_str(&previous?)?;
        let status = value["status"].as_str().context("CORRUPT_SETTLEMENT")?;
        ensure!(
            ["unknown", "cancelled"].contains(&status),
            "CORRUPT_SETTLEMENT"
        );
        validate_settlement(&value, status)?;
    }
    Ok(())
}
pub(super) fn budget(db: &Connection, owner: &str) -> Result<Value> {
    let mut requests = db.prepare(
        "SELECT status,estimate,settlement FROM craftmine_budget_requests WHERE owner=?1",
    )?;
    let rows = requests.query_map([owner], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    let (mut count, mut actual, mut reserved, mut unknown) = (0u64, 0u64, 0u64, 0u64);
    for row in rows {
        let (status, estimate, settlement) = row?;
        let estimate = u64::try_from(estimate).context("CORRUPT_BUDGET")?;
        ensure!(estimate > 0 && estimate <= 200_000_000, "CORRUPT_BUDGET");
        ensure!(
            ["known", "reserved", "unknown", "cancelled"].contains(&status.as_str()),
            "CORRUPT_BUDGET"
        );
        if status == "reserved" {
            ensure!(settlement.is_none(), "CORRUPT_SETTLEMENT");
        } else {
            validate_settlement(
                &serde_json::from_str::<Value>(
                    settlement.as_deref().context("CORRUPT_SETTLEMENT")?,
                )?,
                &status,
            )?;
        }
        count += 1;
        if status == "known" {
            let value: Value = serde_json::from_str(&settlement.context("CORRUPT_BUDGET")?)?;
            actual += value["usage"]["totalTokens"]
                .as_u64()
                .context("CORRUPT_BUDGET")?;
        } else {
            reserved += estimate;
            if status != "reserved" {
                unknown += 1;
            }
        }
    }
    let count_kind = |kind: &str| -> Result<u64> {
        Ok(db.query_row(
            "SELECT COUNT(*) FROM craftmine_budget_events WHERE owner=?1 AND kind=?2",
            params![owner, kind],
            |r| r.get::<_, i64>(0),
        )? as u64)
    };
    let limits = limits(db, owner)?;
    Ok(
        json!({"ownerTaskId":owner,"requestCount":count,"toolCallCount":count_kind("tool")?,"compactionCount":count_kind("compaction")?,"actualTokens":actual,"reservedTokens":reserved,"unknownRequestCount":unknown,"chargedTokens":actual+reserved,"remainingTokens":token_limit(&limits["maxTokens"])? .map(|max| max.saturating_sub(actual+reserved)),"limits":limits}),
    )
}
impl TaskJournal {
    /// Resolve a committed player receipt without authorizing another mutation.
    pub fn budget_find_receipt(&self, args: &Value) -> Result<Value> {
        let (owner, operation) = configuration_identity(&self.db, args)?;
        let row: Option<(String,String)> = self.db.query_row("SELECT request,result FROM craftmine_budget_configurations WHERE owner=?1 AND operation_id=?2",params![owner,operation],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        let Some((request, result)) = row else {
            return Ok(Value::Null);
        };
        ensure!(request == document(args)?, "REPLAY_MISMATCH");
        let result: Value = serde_json::from_str(&result)?;
        validate_configuration_result(&self.db, args, &result, &owner)?;
        Ok(result)
    }
    /// Player-only entry point, deliberately absent from the model budget dispatcher.
    pub fn budget_configure(&mut self, args: &Value) -> Result<Value> {
        fields(
            args,
            &[
                "projectId",
                "sessionId",
                "worldId",
                "taskId",
                "generation",
                "operationId",
                "maxTokens",
            ],
        )?;
        let operation = text(args, "operationId", 240)?;
        let task_id = text(args, "taskId", 240)?;
        let max_tokens = token_limit(args.get("maxTokens").context("MAX_TOKENS_REQUIRED")?)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task = read_task(&tx, task_id)?;
        ensure!(
            args["projectId"] == task.binding.project_id
                && args["sessionId"] == task.binding.session_id,
            "TASK_BINDING_MISMATCH"
        );
        let ctx = WorkspaceContext {
            project_id: task.binding.project_id.clone(),
            session_id: task.binding.session_id.clone(),
            turn_id: task.binding.turn_id.clone(),
        };
        let snapshot = workspaces::inspect(&tx, &ctx)?;
        ensure!(
            args["worldId"] == snapshot.world_id,
            "WORLD_BINDING_MISMATCH"
        );
        let (generation, owner, _) = runtime(&tx, task_id)?;
        ensure!(
            args["generation"].as_u64() == Some(generation),
            "STALE_GENERATION"
        );
        let request = document(args)?;
        let prior: Option<(String,String)> = tx.query_row("SELECT request,result FROM craftmine_budget_configurations WHERE owner=?1 AND operation_id=?2",params![owner,operation],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((old, result)) = prior {
            ensure!(old == request, "REPLAY_MISMATCH");
            return Ok(serde_json::from_str(&result)?);
        }
        let previous = limits(&tx, &owner)?;
        let mut updated = previous.clone();
        updated["maxTokens"] = json!(max_tokens);
        tx.execute("INSERT INTO craftmine_budget_limits(owner,limits) VALUES(?1,?2) ON CONFLICT(owner) DO UPDATE SET limits=excluded.limits",params![owner,serde_json::to_string(&updated)?])?;
        let result = json!({"operationId":operation,"budget":budget(&tx,&owner)?,"previousMaxTokens":previous["maxTokens"]});
        tx.execute("INSERT INTO craftmine_budget_configurations(owner,operation_id,request,result,created_at) VALUES(?1,?2,?3,?4,?5)",params![owner,operation,request,serde_json::to_string(&result)?,worlds::timestamp()?])?;
        tx.commit()?;
        Ok(result)
    }
    pub fn budget_call(&mut self, method: &str, args: &Value) -> Result<Value> {
        let allowed = match method {
            "budget.inspect" => vec!["binding", "generation"],
            "budget.reserve" => vec![
                "binding",
                "generation",
                "requestId",
                "purpose",
                "estimatedInputTokens",
                "maxOutputTokens",
                "limits",
            ],
            "budget.settle" => vec![
                "binding",
                "generation",
                "requestId",
                "status",
                "usage",
                "errorCode",
            ],
            "budget.boundary" => vec!["binding", "generation", "eventId", "kind"],
            _ => bail!("UNKNOWN_METHOD"),
        };
        fields(args, &allowed)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (binding, owner) = identity(
            &tx,
            args,
            matches!(method, "budget.reserve" | "budget.boundary"),
        )?;
        if method == "budget.inspect" {
            return budget(&tx, &owner);
        }
        if method == "budget.reserve" {
            let request = text(args, "requestId", 240)?;
            let purpose = text(args, "purpose", 20)?;
            ensure!(
                ["creation", "summary", "review", "retry"].contains(&purpose),
                "INVALID_PURPOSE"
            );
            let estimate = number(args, "estimatedInputTokens", 100_000_000)?
                + number(args, "maxOutputTokens", 100_000_000)?;
            ensure!(estimate > 0, "EMPTY_RESERVATION");
            let hash = digest(&document(args)?);
            let prior:Option<String>=tx.query_row("SELECT request_hash FROM craftmine_budget_requests WHERE owner=?1 AND request_id=?2",params![owner,request],|r|r.get(0)).optional()?;
            if let Some(prior) = prior {
                ensure!(prior == hash, "REPLAY_MISMATCH");
            } else {
                if let Some(input) = args.get("limits") {
                    fields(
                        input,
                        &["maxRequests", "maxTokens", "maxCompactions", "deadlineAt"],
                    )?;
                    let mut normalized = limits(&tx, &owner)?;
                    if input.get("maxRequests").is_some() {
                        // Only an explicit null removes the request boundary, and
                        // the first reservation fixes it for the whole task. The
                        // product default stays in force for anything else.
                        normalized["maxRequests"] = json!(request_limit(&input["maxRequests"])?);
                    }
                    if input.get("maxCompactions").is_some() {
                        let n = number(input, "maxCompactions", 100)?;
                        ensure!(n > 0, "INVALID_BUDGET_LIMIT");
                        normalized["maxCompactions"] = json!(n);
                    }
                    if let Some(value) = input.get("maxTokens") {
                        normalized["maxTokens"] = json!(token_limit(value)?);
                    }
                    if input.get("deadlineAt").is_some() {
                        normalized["deadlineAt"] = if input["deadlineAt"].is_null() {
                            Value::Null
                        } else {
                            json!(number(input, "deadlineAt", i64::MAX as u64)?)
                        };
                    }
                    let prior: Option<String> = tx
                        .query_row(
                            "SELECT limits FROM craftmine_budget_limits WHERE owner=?1",
                            [&owner],
                            |r| r.get(0),
                        )
                        .optional()?;
                    if let Some(old) = prior {
                        let old: Value = serde_json::from_str(&old)?;
                        if old != normalized {
                            // Player configuration may precede the first model request.
                            // Initialize its clock once without replacing any policy.
                            let count: i64 = tx.query_row(
                                "SELECT COUNT(*) FROM craftmine_budget_requests WHERE owner=?1",
                                [&owner],
                                |r| r.get(0),
                            )?;
                            ensure!(
                                count == 0
                                    && old["deadlineAt"].is_null()
                                    && normalized["deadlineAt"].as_i64().is_some()
                                    && ["maxRequests", "maxTokens", "maxCompactions"]
                                        .iter()
                                        .all(|key| old[*key] == normalized[*key]),
                                "BUDGET_LIMITS_IMMUTABLE"
                            );
                            tx.execute(
                                "UPDATE craftmine_budget_limits SET limits=?2 WHERE owner=?1",
                                params![owner, serde_json::to_string(&normalized)?],
                            )?;
                        }
                    } else {
                        tx.execute(
                            "INSERT INTO craftmine_budget_limits(owner,limits) VALUES(?1,?2)",
                            params![owner, serde_json::to_string(&normalized)?],
                        )?;
                    }
                }
                let current = budget(&tx, &owner)?;
                let l = &current["limits"];
                ensure!(
                    request_limit(&l["maxRequests"])?.is_none_or(|max| current["requestCount"]
                        .as_u64()
                        .unwrap_or(0)
                        < max),
                    "REQUEST_BUDGET_EXHAUSTED"
                );
                ensure!(
                    token_limit(&l["maxTokens"])?.is_none_or(|max| current["chargedTokens"]
                        .as_u64()
                        .unwrap()
                        + estimate
                        <= max),
                    "TOKEN_BUDGET_EXHAUSTED"
                );
                ensure!(
                    l["deadlineAt"]
                        .as_i64()
                        .is_none_or(|at| at > worlds::timestamp().unwrap_or(i64::MAX)),
                    "TASK_DEADLINE_EXCEEDED"
                );
                tx.execute(
                    "INSERT OR IGNORE INTO craftmine_budget_limits(owner,limits) VALUES(?1,?2)",
                    params![owner, serde_json::to_string(l)?],
                )?;
                tx.execute("INSERT INTO craftmine_budget_requests(owner,request_id,task_id,generation,purpose,request_hash,estimate,status) VALUES(?1,?2,?3,?4,?5,?6,?7,'reserved')",params![owner,request,binding.task_id,args["generation"].as_i64(),purpose,hash,estimate as i64])?;
            }
        } else if method == "budget.settle" {
            let request = text(args, "requestId", 240)?;
            let status = text(args, "status", 20)?;
            ensure!(
                ["known", "unknown", "cancelled"].contains(&status),
                "INVALID_SETTLEMENT"
            );
            let (task,generation,prior):(String,u64,Option<String>)=tx.query_row("SELECT task_id,generation,settlement FROM craftmine_budget_requests WHERE owner=?1 AND request_id=?2",params![owner,request],|r|Ok((r.get(0)?,r.get::<_,i64>(1)? as u64,r.get(2)?))).context("RESERVATION_NOT_FOUND")?;
            ensure!(
                task == binding.task_id && Some(generation) == args["generation"].as_u64(),
                "RESERVATION_BINDING_MISMATCH"
            );
            let mut settlement = json!({"status":status});
            if status == "known" {
                let usage = &args["usage"];
                fields(usage, &["inputTokens", "outputTokens", "totalTokens"])?;
                let input = number(usage, "inputTokens", 100_000_000)?;
                let output = number(usage, "outputTokens", 100_000_000)?;
                let total = if usage.get("totalTokens").is_some() {
                    number(usage, "totalTokens", 200_000_000)?
                } else {
                    input + output
                };
                ensure!(total >= input && total >= output, "INVALID_USAGE_TOTAL");
                settlement["usage"] =
                    json!({"inputTokens":input,"outputTokens":output,"totalTokens":total});
            } else {
                ensure!(
                    args.get("usage").is_none_or(Value::is_null),
                    "UNKNOWN_USAGE_MUST_BE_ABSENT"
                );
            }
            if args.get("errorCode").is_some() {
                settlement["errorCode"] = json!(text(args, "errorCode", 120)?);
            }
            if let Some(prior) = prior {
                let previous: Value = serde_json::from_str(&prior)?;
                if previous != settlement {
                    ensure!(
                        status == "known"
                            && matches!(previous["status"].as_str(), Some("unknown" | "cancelled")),
                        "SETTLEMENT_MISMATCH"
                    );
                    tx.execute("INSERT INTO craftmine_budget_settlement_history(owner,request_id,previous,updated_at) VALUES(?1,?2,?3,?4)",params![owner,request,prior,worlds::timestamp()?])?;
                    tx.execute("UPDATE craftmine_budget_requests SET status=?3,settlement=?4 WHERE owner=?1 AND request_id=?2",params![owner,request,status,serde_json::to_string(&settlement)?])?;
                }
            } else {
                tx.execute("UPDATE craftmine_budget_requests SET status=?3,settlement=?4 WHERE owner=?1 AND request_id=?2",params![owner,request,status,serde_json::to_string(&settlement)?])?;
            }
        } else {
            let event = text(args, "eventId", 240)?;
            let kind = text(args, "kind", 20)?;
            ensure!(["compaction", "tool"].contains(&kind), "INVALID_BOUNDARY");
            let prior: Option<String> = tx
                .query_row(
                    "SELECT kind FROM craftmine_budget_events WHERE owner=?1 AND event_id=?2",
                    params![owner, event],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(old) = prior {
                ensure!(old == kind, "REPLAY_MISMATCH");
            } else {
                let current = budget(&tx, &owner)?;
                if kind == "compaction" {
                    ensure!(
                        current["compactionCount"].as_u64().unwrap()
                            < current["limits"]["maxCompactions"].as_u64().unwrap(),
                        "COMPACTION_BUDGET_EXHAUSTED"
                    );
                }
                tx.execute(
                    "INSERT INTO craftmine_budget_events(owner,event_id,kind) VALUES(?1,?2,?3)",
                    params![owner, event, kind],
                )?;
            }
        }
        let result = json!({"requestId":args["requestId"],"status":args.get("status").cloned().unwrap_or(json!("reserved")),"budget":budget(&tx,&owner)?});
        tx.commit()?;
        Ok(result)
    }
    pub fn task_context(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["context"])?;
        let ctx: WorkspaceContext = serde_json::from_value(args["context"].clone())?;
        let snapshot = workspaces::inspect(&self.db, &ctx)?;
        let task = &snapshot.task;
        let (generation, owner, recovery) = runtime(&self.db, &task.binding.task_id)?;
        let world = worlds::read(&self.db, &snapshot.world_id)?;
        let mut modified = Vec::new();
        for (kind, group) in [
            ("object", "objects"),
            ("behavior", "behaviors"),
            ("system", "systems"),
        ] {
            let empty = Vec::new();
            let before = world.world.build["scene"][group]
                .as_array()
                .unwrap_or(&empty);
            let after = task.draft["scene"][group].as_array().unwrap_or(&empty);
            for item in after {
                if !before.contains(item) {
                    if let Some(id) = item["id"].as_str() {
                        modified.push(format!("{kind}:{id}"));
                    }
                }
            }
            for item in before {
                if !after.iter().any(|a| a["id"] == item["id"]) {
                    if let Some(id) = item["id"].as_str() {
                        modified.push(format!("{kind}:{id}"));
                    }
                }
            }
        }
        // Keep the original goal even after many corrections. The timestamp/ID
        // order also survives recovery, which copies rows into a new task.
        let requirements = self
            .db
            .prepare(
                "SELECT request_id,kind,text FROM craftmine_task_requirements
             WHERE task_id=?1 AND (
               request_id=(SELECT request_id FROM craftmine_task_requirements
                 WHERE task_id=?1 AND kind='request'
                 ORDER BY created_at ASC,request_id ASC LIMIT 1)
               OR request_id IN (SELECT request_id FROM craftmine_task_requirements
                 WHERE task_id=?1 AND kind='correction'
                 ORDER BY created_at DESC,request_id DESC LIMIT 3))
             ORDER BY CASE kind WHEN 'request' THEN 0 ELSE 1 END,
               created_at DESC,request_id DESC",
            )?
            .query_map([&task.binding.task_id], |row| {
                let body: String = row.get(2)?;
                Ok(
                    json!({"id":row.get::<_,String>(0)?,"kind":row.get::<_,String>(1)?,
                "text":body.chars().take(1000).collect::<String>(),
                "truncated":body.chars().count()>1000}),
                )
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let receipts=self.db.prepare("SELECT result FROM craftmine_receipts WHERE task_id=?1 ORDER BY rowid DESC LIMIT 12")?.query_map([&task.binding.task_id],|r|r.get::<_,String>(0))?.map(|r|Ok(serde_json::from_str::<Value>(&r?)?)).collect::<Result<Vec<_>>>()?;
        let jobs=self.db.prepare("SELECT id,status FROM craftmine_verifications WHERE task_id=?1 ORDER BY created_at DESC LIMIT 8")?.query_map([&task.binding.task_id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"status":r.get::<_,String>(1)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let owned: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM craftmine_world_leases WHERE task_id=?1)",
            [&task.binding.task_id],
            |r| r.get(0),
        )?;
        Ok(
            json!({"binding":task.binding,"generation":generation,"status":task.status,"recovery":recovery,"world":{"id":snapshot.world_id,"revision":world.summary.revision,"buildId":world.world.build["id"],"hash":world.content_hash},"draft":{"revision":task.revision,"hash":task.draft_hash},"modifiedResources":modified,"requirements":requirements,"receipts":receipts,"jobs":jobs,"lease":{"owned":owned},"budget":budget(&self.db,&owner)?}),
        )
    }
    /// Read original host-journaled requirements for this exact workspace.
    /// Offsets count Unicode scalar values across the filtered journal; this
    /// preserves code points and permits bounded reads of every original tail.
    pub fn task_read_requirements(&self, args: &Value) -> Result<Value> {
        fields(args, &["context", "requestId", "start", "limit"])?;
        let ctx: WorkspaceContext = serde_json::from_value(args["context"].clone())?;
        let snapshot = workspaces::inspect(&self.db, &ctx)?;
        let task_id = &snapshot.task.binding.task_id;
        let request_id = if args.get("requestId").is_some() {
            Some(text(args, "requestId", 240)?)
        } else {
            None
        };
        let start = if args.get("start").is_some() {
            number(args, "start", i64::MAX as u64)?
        } else {
            0
        };
        let limit = if args.get("limit").is_some() {
            number(args, "limit", 4000)?
        } else {
            4000
        };
        ensure!(limit > 0, "INVALID_PAGE_LIMIT");
        let (total_records, total_chars): (i64, i64) = self.db.query_row(
            "SELECT COUNT(*),COALESCE(SUM(length(text)),0)
             FROM craftmine_task_requirements WHERE task_id=?1
             AND (?2 IS NULL OR request_id=?2)",
            params![task_id, request_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let total_chars = u64::try_from(total_chars).context("INVALID_REQUIREMENT_LENGTH")?;
        ensure!(
            request_id.is_none() || total_records > 0,
            "REQUIREMENT_NOT_FOUND"
        );
        ensure!(start <= total_chars, "INVALID_PAGE_START");
        let mut statement = self.db.prepare(
            "SELECT request_id,kind,length(text) FROM craftmine_task_requirements
             WHERE task_id=?1 AND (?2 IS NULL OR request_id=?2)
             ORDER BY created_at ASC,request_id ASC",
        )?;
        let rows = statement.query_map(params![task_id, request_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        let (mut skip, mut remaining, mut cursor) = (start, limit, start);
        let mut items = Vec::new();
        for row in rows {
            if remaining == 0 || items.len() == 32 {
                break;
            }
            let (id, kind, length) = row?;
            let length = u64::try_from(length).context("INVALID_REQUIREMENT_LENGTH")?;
            if skip >= length {
                skip -= length;
                continue;
            }
            let taken = remaining.min(length - skip);
            let body: String = self.db.query_row(
                "SELECT substr(text,?3,?4) FROM craftmine_task_requirements
                 WHERE task_id=?1 AND request_id=?2",
                params![task_id, id, i64::try_from(skip + 1)?, i64::try_from(taken)?],
                |row| row.get(0),
            )?;
            items.push(json!({"id":id,"kind":kind,"text":body,"start":skip,
                "totalChars":length,"truncated":skip > 0 || taken < length}));
            cursor += taken;
            remaining -= taken;
            skip = 0;
        }
        let next = (cursor < total_chars).then_some(cursor);
        Ok(
            json!({"binding":snapshot.task.binding,"worldId":snapshot.world_id,
            "items":items,"start":start,"next":next,
            "totalChars":total_chars,"totalRecords":total_records}),
        )
    }
    pub fn task_record_context(&mut self, args: &Value) -> Result<Value> {
        fields(args, &["context", "requestId", "text", "kind"])?;
        let ctx: WorkspaceContext = serde_json::from_value(args["context"].clone())?;
        let task = workspaces::inspect(&self.db, &ctx)?;
        workspaces::assert_live(&self.db, &task)?;
        let id = text(args, "requestId", 240)?;
        let body = text(args, "text", 16000)?;
        let kind = text(args, "kind", 20)?;
        ensure!(
            ["request", "correction"].contains(&kind),
            "INVALID_REQUIREMENT_KIND"
        );
        let prior:Option<(String,String)>=self.db.query_row("SELECT kind,text FROM craftmine_task_requirements WHERE task_id=?1 AND request_id=?2",params![task.task.binding.task_id,id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((old_kind, old_body)) = prior {
            ensure!(old_kind == kind && old_body == body, "REPLAY_MISMATCH");
        } else {
            // Monotonic per-task times retain actual insertion order for fast
            // corrections and remain stable after task recovery. No schema change.
            let previous: Option<i64> = self.db.query_row(
                "SELECT MAX(created_at) FROM craftmine_task_requirements WHERE task_id=?1",
                [&task.task.binding.task_id],
                |row| row.get(0),
            )?;
            let created_at =
                worlds::timestamp()?.max(previous.map_or(0, |at| at.saturating_add(1)));
            self.db.execute("INSERT INTO craftmine_task_requirements(task_id,request_id,kind,text,created_at) VALUES(?1,?2,?3,?4,?5)",params![task.task.binding.task_id,id,kind,body,created_at])?;
        }
        Ok(json!({"id":id,"recorded":true}))
    }
}
