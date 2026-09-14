use super::*;
use crate::{WorkspaceContext, WorldDocument};
fn fixture() -> Result<(tempfile::TempDir, TaskJournal, WorkspaceContext, Value)> {
    let dir = tempfile::tempdir()?;
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    let scene = json!({"format":"craftmine.scene/2","title":"Test","night":false,"objects":[],"systems":[]});
    j.world_create("world-a","World A",&WorldDocument{build:json!({"id":"v-initial","scene":scene}),snapshot:json!({"format":"craftmine.progress/1","player":{"x":0,"y":6,"z":0,"yaw":0,"pitch":0}}),extensions:vec![]})?;
    let ctx = WorkspaceContext {
        project_id: "project-a".into(),
        session_id: "session-a".into(),
        turn_id: "turn-a".into(),
    };
    let workspace = j.workspace_open(&ctx, "world-a")?;
    let identity = json!({"binding":workspace.task.binding,"generation":1});
    Ok((dir, j, ctx, identity))
}
fn reserve(identity: &Value, id: &str) -> Value {
    let mut args = identity.clone();
    args["requestId"] = json!(id);
    args["purpose"] = json!("creation");
    args["estimatedInputTokens"] = json!(100);
    args["maxOutputTokens"] = json!(100);
    args
}
fn settle(identity: &Value, id: &str, status: &str) -> Value {
    let mut args = identity.clone();
    args["requestId"] = json!(id);
    args["status"] = json!(status);
    args
}
#[test]
fn accounting_is_idempotent_and_unknown_usage_remains_charged() -> Result<()> {
    let (_dir, mut j, _ctx, id) = fixture()?;
    let mut request = reserve(&id, "one");
    request["limits"] = json!({"maxRequests":3,"maxTokens":400});
    j.budget_call("budget.reserve", &request)?;
    j.budget_call("budget.reserve", &request)?;
    let unknown = settle(&id, "one", "unknown");
    j.budget_call("budget.settle", &unknown)?;
    j.budget_call("budget.settle", &unknown)?;
    j.budget_call("budget.reserve", &reserve(&id, "two"))?;
    let mut known = settle(&id, "two", "known");
    known["usage"] = json!({"inputTokens":20,"outputTokens":30,"totalTokens":50});
    j.budget_call("budget.settle", &known)?;
    let budget = j.budget_call("budget.inspect", &id)?;
    assert_eq!(budget["requestCount"], 2);
    assert_eq!(budget["actualTokens"], 50);
    assert_eq!(budget["reservedTokens"], 200);
    assert_eq!(budget["remainingTokens"], 150);
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "three"))
        .unwrap_err()
        .to_string()
        .contains("TOKEN_BUDGET"));
    known["usage"]["totalTokens"] = json!(51);
    assert!(j.budget_call("budget.settle", &known).is_err());
    let mut forged = id.clone();
    forged["binding"]["projectId"] = json!("other");
    assert!(j.budget_call("budget.inspect", &forged).is_err());
    Ok(())
}
#[test]
fn three_compactions_retain_ledger_and_requirements_across_explicit_recovery() -> Result<()> {
    let (dir, mut j, ctx, id) = fixture()?;
    j.task_record_context(
        &json!({"context":ctx,"requestId":"request-1","text":"Generate a tree","kind":"request"}),
    )?;
    for n in 0..3 {
        let mut args = id.clone();
        args["eventId"] = json!(format!("compaction-{n}"));
        args["kind"] = json!("compaction");
        j.budget_call("budget.boundary", &args)?;
        j.budget_call("budget.boundary", &args)?;
    }
    j.budget_call("budget.reserve", &reserve(&id, "pending"))?;
    let workspace = j.workspace_inspect(&ctx)?;
    let draft = json!({"scene":{"objects":[{"id":"tree","name":"Saved tree"}],"systems":[]}});
    j.workspace_commit(
        &ctx,
        &workspace.task.binding,
        "edit",
        0,
        &json!({"op":"create"}),
        &draft,
    )?;
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    j.task_recover()?;
    let mut next = ctx.clone();
    next.turn_id = "turn-resumed".into();
    assert!(j
        .workspace_open(&next, "world-a")
        .unwrap_err()
        .to_string()
        .contains("EXPLICIT_RECOVERY"));
    let result =
        j.task_resume(&json!({"taskId":id["binding"]["taskId"],"generation":1,"context":next}))?;
    assert_eq!(result["generation"], 2);
    assert_eq!(result["workspace"]["task"]["draft"], draft);
    assert_eq!(result["budget"]["compactionCount"], 3);
    assert_eq!(result["budget"]["reservedTokens"], 200);
    let late = json!({"binding":id["binding"],"generation":1,"requestId":"pending","status":"known","usage":{"inputTokens":10,"outputTokens":20,"totalTokens":30}});
    j.budget_call("budget.settle", &late)?;
    assert_eq!(j.budget_call("budget.inspect", &id)?["actualTokens"], 30);
    assert_eq!(
        j.task_resume(&json!({"taskId":id["binding"]["taskId"],"generation":1,"context":next}))?
            ["replayed"],
        true
    );
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "late"))
        .is_err());
    assert!(j
        .workspace_commit(
            &ctx,
            &workspace.task.binding,
            "late",
            1,
            &json!({}),
            &json!({"scene":{}})
        )
        .is_err());
    let facts = j.task_context(&json!({"context":next}))?;
    assert_eq!(facts["requirements"][0]["text"], "Generate a tree");
    assert_eq!(facts["modifiedResources"][0], "object:tree");
    Ok(())
}
#[test]
fn cancelled_task_accepts_only_reserved_settlement_and_discard_keeps_code() -> Result<()> {
    let (_dir, mut j, ctx, id) = fixture()?;
    j.budget_call("budget.reserve", &reserve(&id, "request"))?;
    j.workspace_end_turn(&ctx.session_id, &ctx.turn_id, "aborted")?;
    j.budget_call("budget.settle", &settle(&id, "request", "cancelled"))?;
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "late"))
        .is_err());
    assert!(j
        .budget_call("budget.settle", &settle(&id, "invented", "cancelled"))
        .is_err());
    let mut next = ctx.clone();
    next.turn_id = "next".into();
    assert!(j
        .workspace_open(&next, "world-a")
        .unwrap_err()
        .to_string()
        .contains("EXPLICIT_RECOVERY_REQUIRED"));
    j.task_resume(&json!({"context":next,"taskId":id["binding"]["taskId"],"generation":1}))?;
    let task = j.workspace_inspect(&next)?.task;
    j.task_recover()?;
    j.task_discard(
        &json!({"taskId":task.binding.task_id,"projectId":ctx.project_id,"generation":2}),
    )?;
    assert_eq!(j.inspect(&task.binding)?.draft, task.draft);
    next.turn_id = "fresh".into();
    assert!(j.workspace_open(&next, "world-a").is_ok());
    Ok(())
}
#[test]
fn request_limits_deadline_generation_and_unknown_fields_are_enforced() -> Result<()> {
    let (_dir, mut j, _ctx, id) = fixture()?;
    let mut request = reserve(&id, "expired");
    request["limits"] = json!({"deadlineAt":1});
    assert!(j.budget_call("budget.reserve", &request).is_err());
    request = reserve(&id, "first");
    request["generation"] = json!(2);
    assert!(j.budget_call("budget.reserve", &request).is_err());
    request["generation"] = json!(1);
    request["forged"] = json!(true);
    assert!(j.budget_call("budget.reserve", &request).is_err());
    request = reserve(&id, "first");
    request["limits"] = json!({"maxRequests":1});
    j.budget_call("budget.reserve", &request)?;
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "second"))
        .is_err());
    Ok(())
}

#[test]
fn requirements_keep_original_goal_and_three_latest_corrections() -> Result<()> {
    let (_dir, mut journal, context, _) = fixture()?;
    let original = format!(
        "{}FINAL REQUIREMENT: preserve movement",
        "树🌷".repeat(1200)
    );
    journal.task_record_context(
        &json!({"context":context,"requestId":"z-original","kind":"request","text":original}),
    )?;
    for id in ["z-fix", "y-fix", "x-fix", "w-fix", "v-fix", "u-fix"] {
        journal.task_record_context(&json!({"context":context,"requestId":id,"kind":"correction","text":format!("Correction {id}")}))?;
    }
    journal.task_record_context(&json!({"context":context,"requestId":"a-later-request","kind":"request","text":"An additional request does not displace the original goal"}))?;
    let facts = journal.task_context(&json!({"context":context}))?;
    let requirements = facts["requirements"].as_array().unwrap();
    assert_eq!(
        requirements
            .iter()
            .map(|item| item["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["z-original", "u-fix", "v-fix", "w-fix"]
    );
    assert_eq!(
        requirements[0]["text"].as_str().unwrap().chars().count(),
        1000
    );
    assert_eq!(requirements[0]["truncated"], true);
    assert!(requirements[1..]
        .iter()
        .all(|item| item["truncated"] == false));
    let mut recovered = String::new();
    let mut start = 0;
    loop {
        let page = journal.task_read_requirements(
            &json!({"context":context,"requestId":"z-original","start":start,"limit":713}),
        )?;
        for item in page["items"].as_array().unwrap() {
            recovered.push_str(item["text"].as_str().unwrap());
        }
        match page["next"].as_u64() {
            Some(next) => {
                assert!(next > start);
                start = next;
            }
            None => break,
        }
    }
    assert_eq!(recovered, original);
    assert!(recovered.ends_with("FINAL REQUIREMENT: preserve movement"));
    // Retrying an earlier correction cannot move it to the newest position.
    journal.task_record_context(&json!({"context":context,"requestId":"z-fix","kind":"correction","text":"Correction z-fix"}))?;
    assert_eq!(
        journal.task_context(&json!({"context":context}))?["requirements"],
        facts["requirements"]
    );
    Ok(())
}

#[test]
fn requirement_pages_bound_characters_segments_and_reject_forged_inputs() -> Result<()> {
    let (_dir, mut journal, context, _) = fixture()?;
    let empty = journal.task_read_requirements(&json!({"context":context}))?;
    assert_eq!(empty["totalRecords"], 0);
    assert_eq!(empty["next"], Value::Null);
    let mut expected = String::new();
    for index in 0..45 {
        let body = if index == 44 {
            "世界🌷".repeat(1400)
        } else {
            "🌷".into()
        };
        expected.push_str(&body);
        journal.task_record_context(&json!({"context":context,"requestId":format!("r-{index}"),"kind":if index==0 {"request"} else {"correction"},"text":body}))?;
    }
    let first = journal.task_read_requirements(&json!({"context":context}))?;
    assert_eq!(first["items"].as_array().unwrap().len(), 32);
    assert_eq!(first["next"], 32);
    let mut recovered = String::new();
    let mut start = 0;
    loop {
        let page = journal.task_read_requirements(&json!({"context":context,"start":start}))?;
        let items = page["items"].as_array().unwrap();
        assert!(items.len() <= 32);
        assert!(
            items
                .iter()
                .map(|item| item["text"].as_str().unwrap().chars().count())
                .sum::<usize>()
                <= 4000
        );
        for item in items {
            recovered.push_str(item["text"].as_str().unwrap());
        }
        match page["next"].as_u64() {
            Some(next) => {
                assert!(next > start);
                start = next;
            }
            None => break,
        }
    }
    assert_eq!(recovered, expected);
    assert_eq!(
        journal
            .task_read_requirements(&json!({"context":context,"start":expected.chars().count()}))?
            ["items"],
        json!([])
    );
    for extras in [
        json!({"limit":0}),
        json!({"limit":4001}),
        json!({"limit":1.5}),
        json!({"start":-1}),
        json!({"start":999999}),
        json!({"requestId":"missing"}),
        json!({"worldId":"world-other"}),
        json!({"taskId":"invented"}),
    ] {
        let mut args = extras;
        args["context"] = json!(context);
        assert!(
            journal.task_read_requirements(&args).is_err(),
            "accepted {args}"
        );
    }
    let mut forged = json!({"context":context});
    forged["context"]["sessionId"] = json!("someone-else");
    assert!(journal.task_read_requirements(&forged).is_err());
    forged = json!({"context":context});
    forged["context"]["worldId"] = json!("forged");
    assert!(journal.task_read_requirements(&forged).is_err());
    Ok(())
}

#[test]
fn requirements_survive_explicit_recovery_but_do_not_enter_ordinary_new_tasks() -> Result<()> {
    let (_dir, mut journal, context, identity) = fixture()?;
    let original = format!("{}KEEP THE ORIGINAL END", "原始目标".repeat(1100));
    journal.task_record_context(
        &json!({"context":context,"requestId":"original","kind":"request","text":original}),
    )?;
    for index in 0..7 {
        journal.task_record_context(&json!({"context":context,"requestId":format!("fix-{index}"),"kind":"correction","text":format!("Correction {index}")}))?;
    }
    let before = journal.task_context(&json!({"context":context}))?["requirements"].clone();
    journal.task_recover()?;
    let mut resumed = context.clone();
    resumed.turn_id = "resumed-turn".into();
    journal.task_resume(
        &json!({"taskId":identity["binding"]["taskId"],"generation":1,"context":resumed}),
    )?;
    assert_eq!(
        journal.task_context(&json!({"context":resumed}))?["requirements"],
        before
    );
    let tail = journal
        .task_read_requirements(&json!({"context":resumed,"requestId":"original","start":4000}))?;
    assert!(tail["items"][0]["text"]
        .as_str()
        .unwrap()
        .ends_with("KEEP THE ORIGINAL END"));
    journal.workspace_end_turn(&resumed.session_id, &resumed.turn_id, "completed")?;
    let mut next = resumed.clone();
    next.turn_id = "ordinary-new-turn".into();
    journal.workspace_open(&next, "world-a")?;
    assert_eq!(
        journal.task_context(&json!({"context":next}))?["requirements"],
        json!([])
    );
    assert_eq!(
        journal.task_read_requirements(&json!({"context":next}))?["totalRecords"],
        0
    );
    journal.task_record_context(&json!({"context":next,"requestId":"new-goal","kind":"request","text":"Independent new goal"}))?;
    assert_eq!(
        journal.task_context(&json!({"context":next}))?["requirements"][0]["id"],
        "new-goal"
    );
    assert!(journal
        .task_read_requirements(&json!({"context":next,"requestId":"original"}))
        .is_err());
    Ok(())
}
fn configure(id: &Value, operation: &str, max: Value) -> Value {
    json!({"projectId":id["binding"]["projectId"],"sessionId":id["binding"]["sessionId"],"worldId":"world-a","taskId":id["binding"]["taskId"],"generation":id["generation"],"operationId":operation,"maxTokens":max})
}
fn release_execution(id: &Value, operation: &str) -> Value {
    let mut request = configure(id, operation, Value::Null);
    request.as_object_mut().unwrap().remove("maxTokens");
    request
}

#[test]
fn player_releases_exhausted_execution_policy_without_erasing_tokens_or_history() -> Result<()> {
    let (dir, mut j, ctx, id) = fixture()?;
    let mut first = reserve(&id, "old-request");
    first["limits"] = json!({"maxRequests":80,"maxCompactions":8,"maxTokens":200,"deadlineAt":null});
    j.budget_call("budget.reserve", &first)?;
    for n in 0..8 {
        let mut event = id.clone();
        event["eventId"] = json!(format!("old-compaction-{n}"));
        event["kind"] = json!("compaction");
        j.budget_call("budget.boundary", &event)?;
    }
    j.task_interrupt(&json!({"context":ctx,"reason":"COMPACTION_BUDGET_EXHAUSTED"}))?;
    let before = j.budget_call("budget.inspect", &id)?;
    let original = j.workspace_inspect(&ctx)?;
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    // Loading does not guess that a persisted 80/8 policy was a default.
    assert_eq!(j.budget_call("budget.inspect", &id)?, before);
    let request = release_execution(&id, "player-release");
    assert!(j.budget_find_execution_release_receipt(&request)?.is_null());
    for (key, value) in [("projectId", json!("other")), ("sessionId", json!("other")), ("worldId", json!("other")), ("generation", json!(2))] {
        let mut forged = request.clone();
        forged[key] = value;
        assert!(j.budget_release_execution_limits(&forged).is_err());
    }
    assert!(j.budget_call("budget.releaseExecutionLimits", &request).is_err());
    let result = j.budget_release_execution_limits(&request)?;
    assert_eq!(result["previousLimits"], before["limits"]);
    let mut expected = before.clone();
    expected["limits"]["maxRequests"] = Value::Null;
    expected["limits"]["maxCompactions"] = Value::Null;
    assert_eq!(result["budget"], expected);
    assert_eq!(result["exhausted"], json!(["COMPACTION_BUDGET_EXHAUSTED"]));
    assert_eq!(j.budget_release_execution_limits(&request)?, result);
    assert_eq!(j.workspace_inspect(&ctx)?.task.draft, original.task.draft);
    assert!(j.task_context(&json!({"context":ctx}))?["receipts"].as_array().unwrap().iter().any(|r| r["reason"] == "COMPACTION_BUDGET_EXHAUSTED"));
    let mut next = ctx.clone();
    next.turn_id = "after-player-release".into();
    let resumed = j.task_resume(&json!({"context":next,"taskId":id["binding"]["taskId"],"generation":1}))?;
    assert_eq!(resumed["budget"], expected);
    let next_id = json!({"binding":resumed["workspace"]["task"]["binding"],"generation":2});
    let mut event = next_id.clone();
    event["eventId"] = json!("ninth-compaction");
    event["kind"] = json!("compaction");
    assert_eq!(j.budget_call("budget.boundary", &event)?["budget"]["compactionCount"], 9);
    // The explicit player token limit is still exhausted after recovery.
    assert!(j.budget_call("budget.reserve", &reserve(&next_id, "still-token-limited")).unwrap_err().to_string().contains("TOKEN_BUDGET_EXHAUSTED"));
    assert!(j.budget_release_execution_limits(&request).is_err(), "old head must be fenced after resume");
    assert_eq!(j.budget_find_execution_release_receipt(&request)?, result);
    let mut forged = request.clone();
    forged["sessionId"] = json!("other");
    assert!(j.budget_find_execution_release_receipt(&forged).is_err());
    let before_lookup = j.budget_call("budget.inspect", &next_id)?;
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(j.budget_find_execution_release_receipt(&request)?, result);
    assert_eq!(j.budget_call("budget.inspect", &next_id)?, before_lookup);
    validate_ledger(&j.db)?;
    Ok(())
}

#[test]
fn release_requires_interruption_and_an_actually_exhausted_execution_limit() -> Result<()> {
    let (_dir, mut j, ctx, id) = fixture()?;
    let request = release_execution(&id, "release");
    assert!(j.budget_release_execution_limits(&request).unwrap_err().to_string().contains("INTERRUPTED_TASK_REQUIRED"));
    let mut first = reserve(&id, "explicit");
    first["limits"] = json!({"maxRequests":2,"maxCompactions":2,"maxTokens":200});
    j.budget_call("budget.reserve", &first)?;
    j.task_interrupt(&json!({"context":ctx,"reason":"TOKEN_BUDGET_EXHAUSTED"}))?;
    assert!(j.budget_release_execution_limits(&request).unwrap_err().to_string().contains("EXECUTION_LIMIT_NOT_EXHAUSTED"));
    let mut injected = request.clone();
    injected["maxTokens"] = Value::Null;
    assert!(j.budget_release_execution_limits(&injected).unwrap_err().to_string().contains("UNKNOWN_FIELD"));
    assert_eq!(j.budget_call("budget.inspect", &id)?["limits"]["maxRequests"], 2);
    Ok(())
}

#[test]
fn player_can_release_request_or_deadline_exhaustion_only_after_stopping() -> Result<()> {
    for deadline in [false, true] {
        let (_dir, mut j, ctx, id) = fixture()?;
        let mut first = reserve(&id, "explicit");
        first["limits"] = json!({"maxRequests":1,"deadlineAt":null});
        j.budget_call("budget.reserve", &first)?;
        if deadline {
            // Time passage in an isolated test fixture, never a production write.
            j.db.execute("UPDATE craftmine_budget_limits SET limits=json_set(limits,'$.maxRequests',null,'$.deadlineAt',1) WHERE owner=?1", [id["binding"]["taskId"].as_str().unwrap()])?;
        }
        j.task_interrupt(&json!({"context":ctx,"reason":"TASK_DEADLINE_EXCEEDED"}))?;
        let released = j.budget_release_execution_limits(&release_execution(&id, "release"))?;
        assert_eq!(released["exhausted"], json!([if deadline { "TASK_DEADLINE_EXCEEDED" } else { "REQUEST_BUDGET_EXHAUSTED" }]));
        assert_eq!(released["limits"], default_limits());
        assert_eq!(released["budget"]["requestCount"], 1);
    }
    Ok(())
}

#[test]
fn unlimited_budget_keeps_other_boundaries_and_never_clears_usage() -> Result<()> {
    let (_dir, mut j, _ctx, id) = fixture()?;
    let mut request = reserve(&id, "large");
    request["estimatedInputTokens"] = json!(2_000_000);
    request["limits"] = json!({"maxTokens":null,"maxRequests":1,"maxCompactions":1});
    let result = j.budget_call("budget.reserve", &request)?;
    assert!(result["budget"]["remainingTokens"].is_null());
    assert!(result["budget"]["limits"]["maxTokens"].is_null());
    assert_eq!(result["budget"]["reservedTokens"], 2_000_100);
    assert!(j
        .budget_call("budget.reserve", &reserve(&id, "second"))
        .unwrap_err()
        .to_string()
        .contains("REQUEST_BUDGET"));
    let mut event = id.clone();
    event["eventId"] = json!("c1");
    event["kind"] = json!("compaction");
    j.budget_call("budget.boundary", &event)?;
    event["eventId"] = json!("c2");
    assert!(j
        .budget_call("budget.boundary", &event)
        .unwrap_err()
        .to_string()
        .contains("COMPACTION_BUDGET"));
    Ok(())
}
#[test]
fn player_removes_exhausted_limit_with_durable_bound_receipt_and_model_denial() -> Result<()> {
    let (dir, mut j, ctx, id) = fixture()?;
    let mut request = reserve(&id, "pending");
    request["limits"] = json!({"maxTokens":200});
    j.budget_call("budget.reserve", &request)?;
    j.budget_call("budget.settle", &settle(&id, "pending", "unknown"))?;
    j.task_interrupt(&json!({"context":ctx,"reason":"TOKEN_BUDGET_EXHAUSTED"}))?;
    let config = configure(&id, "player-unlimited", Value::Null);
    let result = j.budget_configure(&config)?;
    assert_eq!(result["budget"]["reservedTokens"], 200);
    assert_eq!(result["budget"]["unknownRequestCount"], 1);
    assert_eq!(result["budget"]["requestCount"], 1);
    assert_eq!(result["budget"]["ownerTaskId"], id["binding"]["taskId"]);
    assert_eq!(result["previousMaxTokens"], 200);
    assert_eq!(j.budget_configure(&config)?, result);
    let mut changed = config.clone();
    changed["maxTokens"] = json!(300);
    assert!(j
        .budget_configure(&changed)
        .unwrap_err()
        .to_string()
        .contains("REPLAY_MISMATCH"));
    for (key, value) in [
        ("sessionId", json!("foreign")),
        ("worldId", json!("foreign")),
        ("projectId", json!("foreign")),
        ("generation", json!(2)),
        ("maxTokens", json!(0)),
        ("maxTokens", json!(-1)),
        ("maxTokens", json!(9007199254740992u64)),
    ] {
        let mut bad = config.clone();
        bad[key] = value;
        assert!(j.budget_configure(&bad).is_err());
    }
    assert!(j
        .budget_call("budget.configure", &config)
        .unwrap_err()
        .to_string()
        .contains("UNKNOWN_METHOD"));
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(j.budget_configure(&config)?, result);
    let mut next = ctx.clone();
    next.turn_id = "budget-resume".into();
    let resumed =
        j.task_resume(&json!({"taskId":id["binding"]["taskId"],"generation":1,"context":next}))?;
    assert!(resumed["budget"]["limits"]["maxTokens"].is_null());
    assert_eq!(resumed["budget"]["reservedTokens"], 200);
    assert!(j.budget_configure(&config).is_err());
    Ok(())
}
#[test]
fn existing_owners_keep_policy_across_atomic_migration_and_reopen() -> Result<()> {
    let (dir, j, _ctx, id) = fixture()?;
    runtime(&j.db, id["binding"]["taskId"].as_str().unwrap())?;
    j.db.execute_batch("DROP TABLE craftmine_budget_configurations;")?;
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(
        j.budget_call("budget.inspect", &id)?["limits"]["maxTokens"],
        1_000_000
    );
    j.budget_configure(&configure(&id, "explicit", Value::Null))?;
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert!(j.budget_call("budget.inspect", &id)?["limits"]["maxTokens"].is_null());
    Ok(())
}
#[test]
fn legacy_backup_missing_limits_keeps_policy_and_schema_three_keeps_audit() -> Result<()> {
    let (_dir, mut j, ctx, id) = fixture()?;
    runtime(&j.db, id["binding"]["taskId"].as_str().unwrap())?;
    j.workspace_end_turn(&ctx.session_id, &ctx.turn_id, "completed")?;
    let exported = j.backup_export(&json!({"operationId":"budget-export"}))?;
    let mut archive = exported["archive"].clone();
    assert_eq!(archive["schemaVersion"], 3);
    archive["schemaVersion"] = json!(2);
    archive["tables"]
        .as_object_mut()
        .unwrap()
        .remove("craftmine_budget_configurations");
    archive["hash"] = json!(digest(&serde_json::to_string(&archive["tables"])?));
    assert_eq!(
        j.backup_inspect(&json!({"archive":archive}))?["valid"],
        true
    );
    let current = j.backup_status(&json!({}))?["currentHash"].clone();
    j.backup_restore(
        &json!({"operationId":"budget-legacy","archive":archive,"expectedCurrentHash":current}),
    )?;
    assert_eq!(
        j.budget_call("budget.inspect", &id)?["limits"]["maxTokens"],
        1_000_000
    );
    let config = configure(&id, "after-import", Value::Null);
    let result = j.budget_configure(&config)?;
    let new = j.backup_export(&json!({"operationId":"budget-export-new"}))?;
    assert_eq!(
        new["archive"]["tables"]["craftmine_budget_configurations"]["rows"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        j.backup_inspect(&json!({"archive":new["archive"]}))?["valid"],
        true
    );
    assert_eq!(j.budget_configure(&config)?, result);
    let mut future = new["archive"].clone();
    future["schemaVersion"] = json!(4);
    assert!(j
        .backup_inspect(&json!({"archive":future}))
        .unwrap_err()
        .to_string()
        .contains("VERSION_UNSUPPORTED"));
    Ok(())
}
#[test]
fn configured_first_request_initializes_deadline_once_without_changing_policy() -> Result<()> {
    let (_dir, mut j, _ctx, id) = fixture()?;
    j.budget_configure(&configure(&id, "before-first", Value::Null))?;
    let mut request = reserve(&id, "first");
    let at = worlds::timestamp()? + 60_000;
    request["limits"] = json!({"maxTokens":null,"deadlineAt":at});
    let first = j.budget_call("budget.reserve", &request)?;
    assert_eq!(first["budget"]["limits"]["deadlineAt"], at);
    j.budget_call("budget.settle", &settle(&id, "first", "unknown"))?;
    let mut second = reserve(&id, "second");
    second["limits"] = json!({"maxTokens":null,"deadlineAt":at+1});
    assert!(j
        .budget_call("budget.reserve", &second)
        .unwrap_err()
        .to_string()
        .contains("LIMITS_IMMUTABLE"));
    second["limits"] = json!({"maxTokens":null,"deadlineAt":at,"maxRequests":999});
    assert!(j
        .budget_call("budget.reserve", &second)
        .unwrap_err()
        .to_string()
        .contains("LIMITS_IMMUTABLE"));
    let after = j.budget_call("budget.inspect", &id)?;
    assert_eq!(after["reservedTokens"], 200);
    assert_eq!(after["unknownRequestCount"], 1);
    assert_eq!(after["requestCount"], 1);
    let (_dir, mut j, _ctx, id) = fixture()?;
    j.budget_call("budget.reserve", &reserve(&id, "without-clock"))?;
    let mut later = reserve(&id, "cannot-start-clock");
    later["limits"] = json!({"deadlineAt":at});
    assert!(j
        .budget_call("budget.reserve", &later)
        .unwrap_err()
        .to_string()
        .contains("LIMITS_IMMUTABLE"));
    assert!(j.budget_call("budget.inspect", &id)?["limits"]["deadlineAt"].is_null());
    Ok(())
}
#[test]
fn completed_budget_receipt_is_readable_after_head_advances_without_write_authority() -> Result<()>
{
    let (_dir, mut j, ctx, id) = fixture()?;
    let config = configure(&id, "find-original", Value::Null);
    assert!(j.budget_find_receipt(&config)?.is_null());
    let result = j.budget_configure(&config)?;
    j.workspace_end_turn(&ctx.session_id, &ctx.turn_id, "completed")?;
    let mut next = ctx.clone();
    next.turn_id = "later-player-task".into();
    j.workspace_open(&next, "world-a")?;
    let before = j.backup_status(&json!({}))?["currentHash"].clone();
    assert_eq!(j.budget_find_receipt(&config)?, result);
    assert!(j.budget_configure(&config).is_err());
    for (key, value) in [
        ("maxTokens", json!(300)),
        ("sessionId", json!("other")),
        ("worldId", json!("other")),
        ("projectId", json!("other")),
        ("generation", json!(2)),
        ("unexpected", json!(true)),
    ] {
        let mut changed = config.clone();
        changed[key] = value;
        assert!(j.budget_find_receipt(&changed).is_err());
    }
    let mut missing = config.clone();
    missing["operationId"] = json!("never-committed");
    assert!(j.budget_find_receipt(&missing)?.is_null());
    assert_eq!(j.backup_status(&json!({}))?["currentHash"], before);
    Ok(())
}
#[test]
fn malformed_backup_accounting_is_rejected_before_replacing_any_world() -> Result<()> {
    let (_dir, mut j, ctx, id) = fixture()?;
    j.budget_call("budget.reserve", &reserve(&id, "unknown"))?;
    j.budget_call("budget.settle", &settle(&id, "unknown", "unknown"))?;
    j.budget_call("budget.reserve", &reserve(&id, "known"))?;
    let mut known = settle(&id, "known", "known");
    known["usage"] = json!({"inputTokens":20,"outputTokens":30,"totalTokens":50});
    j.budget_call("budget.settle", &known)?;
    j.budget_configure(&configure(&id, "audit", Value::Null))?;
    j.workspace_end_turn(&ctx.session_id, &ctx.turn_id, "completed")?;
    let export = j.backup_export(&json!({"operationId":"integrity-export"}))?;
    let original = export["archive"].clone();
    let current = j.backup_status(&json!({}))?["currentHash"].clone();
    let corruptions = vec![
        (
            "craftmine_budget_limits",
            "limits",
            json!(serde_json::to_string(
                &json!({"maxTokens":null,"maxRequests":0,"maxCompactions":8,"deadlineAt":null})
            )?),
        ),
        (
            "craftmine_budget_limits",
            "limits",
            json!(serde_json::to_string(
                &json!({"maxTokens":null,"maxCompactions":8,"deadlineAt":null})
            )?),
        ),
        (
            "craftmine_budget_limits",
            "limits",
            json!(serde_json::to_string(
                &json!({"maxTokens":null,"maxRequests":80,"maxCompactions":false,"deadlineAt":null})
            )?),
        ),
        (
            "craftmine_budget_limits",
            "limits",
            json!(serde_json::to_string(
                &json!({"maxTokens":null,"maxRequests":80,"maxCompactions":8,"deadlineAt":null,"unknown":1})
            )?),
        ),
        ("craftmine_budget_requests", "estimate", json!(-1)),
        (
            "craftmine_budget_requests",
            "settlement",
            json!("{\"status\":\"unknown\",\"usage\":{\"totalTokens\":0}}"),
        ),
        ("craftmine_budget_requests", "status", json!("invented")),
        (
            "craftmine_budget_configurations",
            "result",
            json!("{\"operationId\":\"forged\"}"),
        ),
        (
            "craftmine_budget_configurations",
            "request",
            json!("{\"operationId\":\"forged\"}"),
        ),
    ];
    for (n, (table, column, value)) in corruptions.into_iter().enumerate() {
        let mut archive = original.clone();
        let index = archive["tables"][table]["columns"]
            .as_array()
            .unwrap()
            .iter()
            .position(|v| v == column)
            .unwrap();
        archive["tables"][table]["rows"][0][index] = value;
        archive["hash"] = json!(digest(&serde_json::to_string(&archive["tables"])?));
        assert!(
            j.backup_inspect(&json!({"archive":archive})).is_err(),
            "corruption {n}"
        );
        assert!(j.backup_restore(&json!({"operationId":format!("bad-{n}"),"archive":archive,"expectedCurrentHash":current})).is_err());
        assert_eq!(j.backup_status(&json!({}))?["currentHash"], current);
    }
    assert_eq!(
        j.backup_inspect(&json!({"archive":original}))?["valid"],
        true
    );
    j.backup_restore(
        &json!({"operationId":"valid-roundtrip","archive":original,"expectedCurrentHash":current}),
    )?;
    let budget = j.budget_call("budget.inspect", &id)?;
    assert_eq!(budget["reservedTokens"], 200);
    assert_eq!(budget["unknownRequestCount"], 1);
    assert_eq!(budget["actualTokens"], 50);
    Ok(())
}

#[test]
fn ordinary_requests_and_compactions_continue_without_cumulative_limits() -> Result<()> {
    let (dir, mut j, _ctx, id) = fixture()?;
    for n in 0..81 {
        j.budget_call("budget.reserve", &reserve(&id, &format!("default-{n}")))?;
    }
    for n in 0..9 {
        let mut event = id.clone();
        event["eventId"] = json!(format!("compaction-{n}"));
        event["kind"] = json!("compaction");
        j.budget_call("budget.boundary", &event)?;
        j.budget_call("budget.boundary", &event)?;
    }
    let before = j.budget_call("budget.inspect", &id)?;
    assert_eq!(before["requestCount"], 81);
    assert_eq!(before["compactionCount"], 9);
    assert_eq!(before["limits"], default_limits());
    drop(j);
    let mut j = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    assert_eq!(j.budget_call("budget.inspect", &id)?, before);
    j.budget_call("budget.reserve", &reserve(&id, "after-reopen"))?;
    assert_eq!(j.budget_call("budget.inspect", &id)?["requestCount"], 82);
    Ok(())
}

#[test]
fn an_authorized_unlimited_request_budget_continues_past_the_product_default() -> Result<()> {
    let (dir, mut j, _ctx, id) = fixture()?;
    let mut first = reserve(&id, "authorized-first");
    first["limits"] =
        json!({"maxRequests":null,"maxTokens":null,"maxCompactions":8,"deadlineAt":null});
    let authorized = j.budget_call("budget.reserve", &first)?;
    assert!(authorized["budget"]["limits"]["maxRequests"].is_null());
    // The boundary is removed for the whole task, not only for its first request:
    // eighty further admissions take the count past the product default of 80.
    for n in 0..80 {
        j.budget_call("budget.reserve", &reserve(&id, &format!("unlimited-{n}")))?;
    }
    let budget = j.budget_call("budget.inspect", &id)?;
    assert_eq!(budget["requestCount"], 81);
    assert!(budget["limits"]["maxRequests"].is_null());
    assert!(
        budget["remainingTokens"].is_null(),
        "an unlimited cumulative token budget keeps its existing null meaning"
    );
    // The authorized policy is durable: a reopened journal keeps both fields null
    // and still admits the next request.
    let mut reopened = TaskJournal::open(&dir.path().join("tasks.sqlite"))?;
    let after = reopened.budget_call("budget.inspect", &id)?;
    assert!(after["limits"]["maxRequests"].is_null());
    assert!(after["limits"]["maxTokens"].is_null());
    reopened.budget_call("budget.reserve", &reserve(&id, "after-reopen"))?;
    assert_eq!(
        reopened.budget_call("budget.inspect", &id)?["requestCount"],
        82
    );
    Ok(())
}

#[test]
fn omitted_limits_inherit_policy_and_malformed_fields_are_rejected() -> Result<()> {
    let (_dir, mut journal, _ctx, identity) = fixture()?;
    let mut omitted = reserve(&identity, "omitted");
    omitted["limits"] = json!({"maxTokens":null,"maxCompactions":8,"deadlineAt":null});
    let admitted = journal.budget_call("budget.reserve", &omitted)?;
    assert!(admitted["budget"]["limits"]["maxRequests"].is_null());
    assert_eq!(admitted["budget"]["requestCount"], 1);
    let cases = [
        (
            json!({"maxRequests":"80","maxTokens":null,"maxCompactions":8,"deadlineAt":null}),
            "maxRequests: INTEGER_REQUIRED",
        ),
        (
            json!({"maxRequests":-1,"maxTokens":null,"maxCompactions":8,"deadlineAt":null}),
            "maxRequests: INTEGER_REQUIRED",
        ),
        (
            json!({"maxRequests":true,"maxTokens":null,"maxCompactions":8,"deadlineAt":null}),
            "maxRequests: INTEGER_REQUIRED",
        ),
        (
            json!({"maxRequests":0,"maxTokens":null,"maxCompactions":8,"deadlineAt":null}),
            "INVALID_BUDGET_LIMIT",
        ),
        (
            json!({"maxRequests":10001,"maxTokens":null,"maxCompactions":8,"deadlineAt":null}),
            "NUMBER_LIMIT",
        ),
        (
            json!({"maxRequests":null,"maxTokens":null,"maxCompactions":false,"deadlineAt":null}),
            "maxCompactions: INTEGER_REQUIRED",
        ),
        (
            json!({"maxRequests":null,"maxTokens":null,"maxCompactions":0,"deadlineAt":null}),
            "INVALID_BUDGET_LIMIT",
        ),
        (
            json!({"maxRequests":null,"maxTokens":null,"maxCompactions":8,"deadlineAt":null,"extra":1}),
            "UNKNOWN_FIELD",
        ),
    ];
    for (limits, expected) in cases {
        let (_dir, mut j, _ctx, id) = fixture()?;
        let mut request = reserve(&id, "invalid");
        request["limits"] = limits.clone();
        let error = j
            .budget_call("budget.reserve", &request)
            .unwrap_err()
            .to_string();
        assert!(error.contains(expected), "{limits}: {error}");
        // Nothing was admitted, and the unknown caller left the product default
        // in place instead of widening the task.
        let budget = j.budget_call("budget.inspect", &id)?;
        assert_eq!(budget["requestCount"], 0, "{limits}");
        assert!(budget["limits"]["maxRequests"].is_null(), "{limits}");
    }
    Ok(())
}

#[test]
fn a_fixed_request_policy_cannot_be_rewritten_by_a_later_reservation() -> Result<()> {
    let (_dir, mut j, _ctx, id) = fixture()?;
    let mut first = reserve(&id, "first");
    first["limits"] = json!({"maxRequests":null});
    j.budget_call("budget.reserve", &first)?;
    // Repeating the authorized policy is the normal path for a caller that sends
    // it on every request and must stay allowed.
    let mut repeated = reserve(&id, "repeated");
    repeated["limits"] = json!({"maxRequests":null});
    j.budget_call("budget.reserve", &repeated)?;
    // Tightening or widening it afterwards is refused.
    let mut tightened = reserve(&id, "tightened");
    tightened["limits"] = json!({"maxRequests":80});
    let error = j
        .budget_call("budget.reserve", &tightened)
        .unwrap_err()
        .to_string();
    assert!(error.contains("LIMITS_IMMUTABLE"), "{error}");
    let after = j.budget_call("budget.inspect", &id)?;
    assert!(after["limits"]["maxRequests"].is_null());
    assert_eq!(after["requestCount"], 2);
    Ok(())
}

#[test]
fn the_player_token_configuration_cannot_change_the_request_boundary() -> Result<()> {
    let (_dir, mut j, _ctx, id) = fixture()?;
    let mut widen = configure(&id, "widen-requests", Value::Null);
    widen["maxRequests"] = json!(null);
    let error = j.budget_configure(&widen).unwrap_err().to_string();
    assert!(error.contains("UNKNOWN_FIELD"), "{error}");
    assert!(j.budget_call("budget.inspect", &id)?["limits"]["maxRequests"].is_null());
    Ok(())
}
#[test]
fn task_context_reports_bound_world_runtime_without_receipts() -> Result<()> {
    let (_dir, mut journal, _, _) = fixture()?;
    for (id, build, kind, base) in [
        ("godot-profile", json!({"id":"gbd-profile","scene":{"format":"craftmine.godot-scene/1","baseId":"creation-sandbox"},"godot":{"engineVersion":"4.7.2-stable"}}), json!("godot"), json!("creation-sandbox")),
        ("legacy-profile", json!({"id":"v-profile","scene":{"format":"craftmine.scene/3"}}), json!("legacy"), Value::Null),
        ("future-profile", json!({"id":"future","scene":{"format":"unknown/1"},"godot":{}}), Value::Null, Value::Null),
    ] {
        journal.world_create(id, id, &WorldDocument { build, snapshot:json!({"format":"craftmine.progress/1","player":{"x":0,"y":6,"z":0,"yaw":0,"pitch":0}}),extensions:vec![] })?;
        let context=WorkspaceContext{project_id:"profile-project".into(),session_id:id.into(),turn_id:"profile-turn".into()};
        journal.workspace_open(&context,id)?;
        let facts=journal.task_context(&json!({"context":context}))?;
        assert_eq!(facts["world"]["id"],id);
        assert_eq!(facts["world"]["runtimeKind"],kind);
        assert_eq!(facts["world"]["baseId"],base);
        assert_eq!(facts["receipts"],json!([]));
    }
    Ok(())
}
